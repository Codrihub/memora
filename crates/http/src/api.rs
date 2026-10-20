//! JSON API surface for the Memora web UI.
//!
//! This module holds the axum handlers behind `/api/*` and a single public
//! entry point, [`api_router()`]. The router it returns deliberately does not
//! call `.with_state()`, so the parent router can attach shared state:
//!
//! ```ignore
//! Router::new().merge(api::api_router()).with_state(st)
//! ```
//!
//! `lib.rs::build_router()` already registers
//! `GET /api/{stats,graph,tree,search,access,keys,aliases}` and
//! `POST /api/access/test`; they are not registered again here, because
//! `Router::merge` panics when two handlers claim the same method and path.
//!
//! Vault mutations go through the `*_impl` methods on `MemoryStore` and never
//! touch the vault filesystem directly. Passwords are hashed with argon2id,
//! API keys with SHA-256.

use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Extension, Router,
};
use memora_gateway::{AccessAction, AccessRule, RuleKind};
use memora_state::arm::{ArmStatus, CodeCheck};
use memora_state::owner::Owner;
use memora_state::{Domain, Transaction};
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::cache::{self, rd, WebSession};
use crate::{ApiKeyCaller, AppState};

/// Longest password accepted anywhere, in bytes: argon2 cost grows with the
/// input, so an unbounded password is a cheap way to burn CPU.
pub(crate) const MAX_PASSWORD_BYTES: usize = 1024;
/// Request body cap for the auth and settings endpoints.
const AUTH_BODY_LIMIT: usize = 16 * 1024;

/// Serialises the account-creating and account-replacing handlers (setup and
/// reset), so two concurrent submits of one window cannot both pass the
/// "no account yet" / "window open" checks across the argon2 await.
static ACCOUNT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn too_long_password() -> Response {
    bad(&format!(
        "password must be at most {MAX_PASSWORD_BYTES} bytes"
    ))
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

fn realm(st: &AppState) -> String {
    rd(&st.cache.settings).realm.clone()
}

fn min_password_len(st: &AppState) -> usize {
    usize::try_from(rd(&st.cache.settings).min_password_len).unwrap_or(10)
}

fn session_ttl(st: &AppState) -> i64 {
    cache::session_limits(st).0
}

/// A failed state database call, as an HTTP answer: invalid input 400, a missing row
/// 404 (with `not_found` as the message), a conflict 409, anything else 500.
pub(crate) fn db_err(e: memora_state::Error, not_found: &str) -> Response {
    use memora_state::Error as E;
    match e {
        E::Invalid { .. } => bad(&e.to_string()),
        E::NotFound(_) => {
            (StatusCode::NOT_FOUND, Json(json!({"error": not_found}))).into_response()
        }
        E::Conflict(msg) => (StatusCode::CONFLICT, Json(json!({"error": msg}))).into_response(),
        other => {
            tracing::error!("state database: {other}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "state database error"})),
            )
                .into_response()
        }
    }
}

/// Append an activity row inside `tx` (so it commits with the change it describes).
pub(crate) fn act_tx(
    tx: &Transaction<'_>,
    headers: &HeaderMap,
    event: &str,
    user: Option<&str>,
    detail: &str,
) -> memora_state::Result<()> {
    let ip = client_ip(headers);
    let ev = memora_state::activity::NewActivity {
        event,
        ip: ip.as_deref(),
        actor: user,
        detail,
    };
    memora_state::activity::log(tx, &ev, memora_state::now()).map(|_| ())
}

/// Start a browser session inside `tx` and return the raw session id for the cookie.
/// A session id the browser arrived with is ended first (session fixation).
fn create_session(
    tx: &Transaction<'_>,
    st: &AppState,
    headers: &HeaderMap,
) -> memora_state::Result<String> {
    if let Some(old) = super::cookie_value(headers, cache::SESSION_COOKIE) {
        memora_state::session::revoke(tx, &cache::sid_hash(&old))?;
    }
    let raw = cache::new_sid();
    let (ttl, max_age) = cache::session_limits(st);
    let new = memora_state::session::NewSession {
        sid_hash: cache::sid_hash(&raw),
        source: "web".into(),
        ip: client_ip(headers),
        user_agent: user_agent(headers),
    };
    memora_state::session::create(tx, &new, ttl, max_age, memora_state::now())?;
    Ok(raw)
}

fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// The owner, when `name` is its username (case-insensitive).
fn find_user(st: &AppState, name: &str) -> Option<Owner> {
    rd(&st.cache.owner)
        .as_ref()
        .filter(|o| o.username == name || o.username.eq_ignore_ascii_case(name))
        .cloned()
}

pub(crate) fn client_ip(headers: &HeaderMap) -> Option<String> {
    crate::guard::header_ip(headers).map(|ip| ip.to_string())
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({"error": "not authenticated"})),
    )
        .into_response()
}

pub(crate) fn bad(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"error": msg}))).into_response()
}

fn forbidden(msg: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({"error": msg}))).into_response()
}

/// JSON response with an optional `Set-Cookie` header.
fn with_cookie(code: StatusCode, body: Value, set_cookie: Option<String>) -> Response {
    let mut resp = (code, Json(body)).into_response();
    if let Some(c) = set_cookie {
        if let Ok(v) = HeaderValue::from_str(&c) {
            resp.headers_mut().insert(header::SET_COOKIE, v);
        }
    }
    resp
}

/// CSRF check for cookie-authenticated writes; delegates to `super::origin_ok`.
pub(crate) fn csrf_ok(headers: &HeaderMap) -> bool {
    super::origin_ok(headers)
}

/// CSRF check for the public auth forms (login CSRF); see `super::origin_ok_public`.
fn csrf_public_ok(headers: &HeaderMap) -> bool {
    super::origin_ok_public(headers)
}

pub(crate) fn csrf_fail() -> Response {
    forbidden("origin mismatch")
}

/// Map a `MemoryStore` error to an appropriate HTTP status.
fn mem_err(e: memora_core::vault::MemoryErr) -> Response {
    let msg = e.to_string();
    let low = msg.to_lowercase();
    let code = if low.contains("not found") || low.contains("permission") {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::BAD_REQUEST
    };
    // Strip em dashes from text shown to users.
    (code, Json(json!({"error": msg.replace('\u{2014}', "-")}))).into_response()
}

pub(crate) fn body_str(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// The `password` field exactly as sent, or `None` when missing or blank.
/// Never trimmed: setup, reset, login, the password change and the CLI must all
/// hash and check the same bytes.
fn body_password(b: &Value) -> Option<String> {
    b.get("password")
        .and_then(|x| x.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
}

// ---------------------------------------------------------------------------
// Handler - vault / data (GET)
// ---------------------------------------------------------------------------

/// `GET /api/note?path=X` -> `{path,name,content,html,tags,frontmatter,backlinks,size,mtime}`
async fn h_api_note(State(st): State<AppState>, req: Request) -> Response {
    let path = super::query_value(req.uri(), "path").unwrap_or_default();
    if path.trim().is_empty() {
        return bad("no path");
    }
    let key = req.extensions().get::<ApiKeyCaller>().cloned();
    let read = crate::blocking(move || crate::snapshot_as(&st, key.as_ref()).read_note_impl(&path));
    match read.await {
        Ok(v) => Json(v).into_response(),
        Err(e) => mem_err(e),
    }
}

/// Largest vault image `/api/vault/file` serves.
const VAULT_FILE_MAX: u64 = 10 * 1024 * 1024;

/// CSP for served vault images: nothing loads and nothing runs, even when an
/// SVG is opened directly in a tab.
const VAULT_FILE_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/// Whether `b` starts like a file of type `mime` (magic numbers).
fn looks_like(mime: &str, b: &[u8]) -> bool {
    match mime {
        "image/png" => b.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => b.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/gif" => b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a"),
        "image/webp" => b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP",
        "image/avif" => {
            b.len() >= 12 && &b[4..8] == b"ftyp" && (&b[8..12] == b"avif" || &b[8..12] == b"avis")
        }
        "image/bmp" => b.starts_with(b"BM"),
        "image/x-icon" => b.starts_with(&[0, 0, 1, 0]),
        _ => false,
    }
}

/// `GET /api/vault/file?path=<vault-relative>` -> the bytes of one image file
/// in the vault (png, jpg, gif, webp, avif, bmp, ico; never svg). The path must
/// resolve inside the vault after symlinks; other file types are refused.
async fn h_api_vault_file(State(st): State<AppState>, req: Request) -> Response {
    use memora_core::vault::{image_mime, VaultFileErr};
    let path = super::query_value(req.uri(), "path").unwrap_or_default();
    let key = req.extensions().get::<ApiKeyCaller>().cloned();
    let found = crate::store_as(&st, key.as_ref()).vault_image_file(&path);
    let full = match found {
        Ok(p) => p,
        Err(e) => {
            let (code, msg) = match e {
                VaultFileErr::Invalid => (StatusCode::BAD_REQUEST, "invalid path"),
                VaultFileErr::Forbidden => (StatusCode::FORBIDDEN, "path not allowed"),
                VaultFileErr::NotImage => (StatusCode::UNSUPPORTED_MEDIA_TYPE, "not an image"),
                VaultFileErr::NotFound => (StatusCode::NOT_FOUND, "not found"),
            };
            return (code, Json(json!({"error": msg}))).into_response();
        }
    };
    let Some(mime) = image_mime(&path) else {
        return (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Json(json!({"error": "not an image"})),
        )
            .into_response();
    };
    let Ok(meta) = tokio::fs::metadata(&full).await else {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not found"}))).into_response();
    };
    if meta.len() > VAULT_FILE_MAX {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error": "file too large"})),
        )
            .into_response();
    }
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let etag = format!("\"{:x}-{:x}\"", meta.len(), mtime);
    let base = [
        (header::CACHE_CONTROL, "private, max-age=300"),
        (header::CONTENT_SECURITY_POLICY, VAULT_FILE_CSP),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
    ];
    let fresh = req
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(',').any(|t| t.trim() == etag || t.trim() == "*"));
    if fresh {
        return (StatusCode::NOT_MODIFIED, base, [(header::ETAG, etag)]).into_response();
    }
    match tokio::fs::read(&full).await {
        // Pixels only: the bytes must be the format the name claims (a script
        // or page renamed to .png is refused).
        Ok(body) if !looks_like(mime, &body) => (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Json(json!({"error": "not an image"})),
        )
            .into_response(),
        Ok(body) if body.len() as u64 <= VAULT_FILE_MAX => (
            base,
            [
                (header::CONTENT_TYPE, mime.to_string()),
                (header::ETAG, etag),
            ],
            body,
        )
            .into_response(),
        Ok(_) => (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error": "file too large"})),
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, Json(json!({"error": "not found"}))).into_response(),
    }
}

/// `GET /api/folder-meta` -> `{"<Folder>":{"color?","icon?","desc?"}}`
async fn h_api_folder_meta(State(st): State<AppState>, req: Request) -> Response {
    let folder = super::query_value(req.uri(), "folder").filter(|f| !f.trim().is_empty());
    let key = req.extensions().get::<ApiKeyCaller>().cloned();
    match crate::store_as(&st, key.as_ref()).get_folder_meta_impl(folder.as_deref()) {
        Ok(meta) => Json(meta).into_response(),
        Err(e) => mem_err(e),
    }
}

/// `GET /api/actors` -> `{actors:[{actor,alias,display,events,tools,last_ip,last_ts,seen_minutes_ago}]}`
async fn h_api_actors(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
) -> Response {
    let (base, events) = {
        let store = crate::store_as(&st, key.as_deref());
        (store.list_actors_impl(), store.read_events())
    };
    let base_actors = base
        .get("actors")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let now = now_secs();
    let actors: Vec<Value> = base_actors
        .iter()
        .map(|a| {
            let id = a.get("actor").and_then(|v| v.as_str()).unwrap_or("");
            let mut count = 0usize;
            let mut tools: Vec<String> = Vec::new();
            let mut last_ip: Option<String> = None;
            let mut last_ts = 0.0f64;
            for e in &events {
                if e.get("actor").and_then(|v| v.as_str()).unwrap_or("") != id {
                    continue;
                }
                count += 1;
                let tool = e
                    .get("tool")
                    .or_else(|| e.get("action"))
                    .or_else(|| e.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !tool.is_empty() && !tools.iter().any(|t| t == tool) {
                    tools.push(tool.to_string());
                }
                if let Some(ip) = e.get("ip").and_then(|v| v.as_str()) {
                    if !ip.is_empty() {
                        last_ip = Some(ip.to_string());
                    }
                }
                let ts = e.get("_ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if ts > last_ts {
                    last_ts = ts;
                }
            }
            json!({
                "actor": id,
                "alias": a.get("alias").cloned().unwrap_or(Value::Null),
                "display": a.get("display").cloned().unwrap_or(json!(id)),
                "events": count,
                "tools": tools,
                "last_ip": last_ip,
                "last_ts": if last_ts > 0.0 { json!(last_ts) } else { Value::Null },
                "seen_minutes_ago": if last_ts > 0.0 {
                    json!(((now - last_ts) / 60.0).round().max(0.0) as i64)
                } else {
                    json!(-1)
                },
            })
        })
        .collect();
    Json(json!({"actors": actors, "count": actors.len()})).into_response()
}

/// `GET /api/logs?range=1d|7d&limit=N` -> `{range,count,events:[...]}`
async fn h_api_logs(State(st): State<AppState>, req: Request) -> Response {
    let mut range = super::query_value(req.uri(), "range").unwrap_or_default();
    if range.trim().is_empty() {
        range = super::query_value(req.uri(), "days")
            .and_then(|d| d.trim().parse::<f64>().ok())
            .map(|n| format!("{}d", n.min(7.0)))
            .unwrap_or_else(|| "1d".to_string());
    }
    let limit = super::query_value(req.uri(), "limit")
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(400);
    let actor = super::query_value(req.uri(), "actor").unwrap_or_default();
    let q = super::query_value(req.uri(), "q").unwrap_or_default();
    // `since` / `until` (unix seconds) pick an exact window, e.g. one local day.
    let num = |k: &str| super::query_value(req.uri(), k).and_then(|v| v.trim().parse::<f64>().ok());
    let (since, until) = (num("since"), num("until"));
    let window = (since.is_some() || until.is_some()).then_some((since, until));
    let key = req.extensions().get::<ApiKeyCaller>().cloned();
    let out =
        crate::store_as(&st, key.as_ref()).get_logs_between(&range, window, &q, &actor, limit);
    Json(out).into_response()
}

/// `GET /api/logs/settings` -> `{max_mb, max_days, stats:{bytes,lines,oldest,newest}}`.
async fn h_api_log_settings(State(st): State<AppState>) -> Response {
    match st.db.read(memora_state::settings::log_limits) {
        Ok((mb, days)) => Json(json!({
            "max_mb": mb, "max_days": days,
            "stats": memora_core::events::hub().log_stats(),
        }))
        .into_response(),
        Err(e) => db_err(e, "settings not found"),
    }
}

/// `POST /api/logs/settings` `{max_mb, max_days}` -> same as GET. The new limits
/// apply at once: the log is trimmed to them right away.
async fn h_api_log_settings_set(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let cur = st
        .db
        .read(memora_state::settings::log_limits)
        .unwrap_or((8, 0));
    let mb = b.get("max_mb").and_then(|v| v.as_i64()).unwrap_or(cur.0);
    let days = b.get("max_days").and_then(|v| v.as_i64()).unwrap_or(cur.1);
    let user = actor_name(&st, &headers, &key);
    let res = st.db.write(|tx| {
        let r = memora_state::settings::set_log_limits(tx, mb, days, memora_state::now())?;
        act_tx(
            tx,
            &headers,
            "log_limits",
            user.as_deref(),
            &format!("{mb} MB, {days} days"),
        )?;
        Ok(r)
    });
    if let Err(e) = res {
        return db_err(e, "settings not found");
    }
    cache::apply_log_limits(&st);
    h_api_log_settings(State(st)).await
}

/// `GET /api/config` -> `{realm,min_password_len,session_ttl,vault,version,gateway,update}`
/// (`update`: the cached release check, see [`crate::release::status`]).
async fn h_api_config(State(st): State<AppState>) -> Response {
    Json(json!({
        "realm": realm(&st),
        "min_password_len": min_password_len(&st),
        "session_ttl": session_ttl(&st),
        "vault": st.vault_path(),
        "version": crate::release::CURRENT,
        "gateway": true,
        "update": crate::release::status(),
    }))
    .into_response()
}

/// `GET /api/auth/state` -> public; returns no sensitive data.
async fn h_auth_state(State(st): State<AppState>, headers: HeaderMap) -> Response {
    let s = cache::arm_window(&st);
    let armed = s.status == ArmStatus::Armed;
    let bootstrap = rd(&st.cache.owner).is_none();
    let hint = std::env::var("MEMORA_SETUP_HINT")
        .ok()
        .filter(|h| !h.trim().is_empty())
        .unwrap_or_else(|| "memora-cli setup (run on the server)".to_string());
    let checks = readiness(&st);
    let ready = checks.values().all(|v| v.as_bool() == Some(true));
    let cooldown = crate::guard::header_ip(&headers).and_then(|ip| st.guard.blocked(&ip));
    let mut out = json!({
        "bootstrap": bootstrap,
        "realm": realm(&st),
        "min_password_len": min_password_len(&st),
        "gateway": true,
        "armed": armed,
        "locked": s.status == ArmStatus::Locked,
        "setup_hint": hint,
        "ready": ready,
        "checks": checks,
        "code_required": true,
        "cooldown": cooldown.unwrap_or(0),
    });
    // Only whether a vault is configured: the path and the suggested folder
    // are for the signed-in owner (`/api/settings`), not for anyone who can
    // reach the login page.
    if let Some(o) = out.as_object_mut() {
        o.insert("vault_configured".into(), json!(st.vault_path().is_some()));
    }
    // A browser holding a cookie whose session was ended on purpose (password
    // changed or signed out from another device) learns why, once per page.
    if let Some(reason) = signed_out_reason(&st, &headers) {
        if let Some(o) = out.as_object_mut() {
            o.insert("signed_out".into(), json!(reason));
        }
    }
    if armed {
        if let Some(o) = out.as_object_mut() {
            o.insert(
                "mode".into(),
                json!(s.mode.map(|m| m.as_str()).unwrap_or("")),
            );
            o.insert("expires_in".into(), json!(s.remaining(memora_state::now())));
            o.insert("ttl".into(), json!(s.ttl));
        }
    }
    Json(out).into_response()
}

/// Instance checks that must all pass before the setup form may open. Nothing
/// is written: this runs on every `/api/auth/state` poll.
///
/// `vault` passes when no vault is configured yet: the folder is chosen after
/// the account exists, so a missing vault must not block the account setup.
/// `state` needs a database opened read-write and a writable state folder.
fn readiness(st: &AppState) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    let vault_ok = st.vault_path().is_none_or(|v| dir_writable(Path::new(&v)));
    m.insert("vault".into(), json!(vault_ok));
    let db_ok = st
        .db
        .read(|c| Ok(c.is_readonly("main")?))
        .is_ok_and(|ro| !ro);
    m.insert(
        "state".into(),
        json!(db_ok && dir_writable(st.db.state_dir())),
    );
    m
}

/// Whether this process may create files in `dir`, asked with `access(2)`
/// (`W_OK | X_OK`; honours read-only mounts and ACLs) instead of writing a probe.
#[cfg(windows)]
fn dir_writable(dir: &Path) -> bool {
    // No access(2) on Windows: honour the read-only attribute of the folder.
    std::fs::metadata(dir).is_ok_and(|m| m.is_dir() && !m.permissions().readonly())
}

#[cfg(unix)]
fn dir_writable(dir: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    if !dir.is_dir() {
        return false;
    }
    let Ok(c) = std::ffi::CString::new(dir.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: `c` is a valid NUL-terminated path that outlives the call.
    unsafe { libc::access(c.as_ptr(), libc::W_OK | libc::X_OK) == 0 }
}

/// A failed password or setup code: count it, and say so with a cooldown once
/// the limit is reached.
fn failed_attempt(st: &AppState, headers: &HeaderMap, status: StatusCode, msg: &str) -> Response {
    act(st, headers, "auth_fail", None, msg);
    if let Some(ip) = crate::guard::header_ip(headers) {
        if let Some(wait) = st.guard.fail_login(&ip) {
            act(
                st,
                headers,
                "cooldown",
                None,
                &format!("{} minutes", wait / 60),
            );
            return crate::guard::too_many(wait, true);
        }
    }
    (status, Json(json!({"error": msg}))).into_response()
}

/// Record a security event in the `activity` table (read by `memora-cli /activity`).
fn act(st: &AppState, headers: &HeaderMap, event: &str, user: Option<&str>, detail: &str) {
    let ip = client_ip(headers);
    memora_state::activity::log_activity(&st.db, event, ip.as_deref(), user, detail);
}

/// The browser / device that sent the request.
fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

fn succeeded(st: &AppState, headers: &HeaderMap) {
    if let Some(ip) = crate::guard::header_ip(headers) {
        st.guard.succeed(&ip);
    }
}

/// A wrong setup code. It spends the caller's small per-IP budget
/// ([`crate::guard::CODE_IP_LIMIT`], then a cooldown) instead of closing the
/// window at once, which let anyone who could reach `/login` keep the owner
/// from ever finishing setup. Only after
/// [`crate::guard::CODE_WINDOW_LIMIT`] wrong codes in all is the window closed
/// and the code voided ([`burn_window`]). The code stays single-use and the
/// window time-limited.
fn wrong_code(st: &AppState, headers: &HeaderMap) -> Response {
    let armed_at = cache::arm_window(st).armed_at.unwrap_or(0);
    let ip = crate::guard::header_ip(headers)
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
    let (wait, close) = st.guard.code_miss(&ip, armed_at);
    if close {
        return burn_window(st, headers);
    }
    act(st, headers, "code_wrong", None, "wrong setup code");
    tracing::warn!(%ip, "wrong setup code");
    if let Some(wait) = wait {
        act(
            st,
            headers,
            "cooldown",
            None,
            &format!("{} minutes", wait / 60),
        );
        return crate::guard::too_many(wait, true);
    }
    (
        StatusCode::FORBIDDEN,
        Json(json!({
            "error": "Wrong setup code. Check the code shown on the server and try again.",
            "burned": false,
        })),
    )
        .into_response()
}

/// Too many wrong codes for this window: void the code and close the window;
/// the operator has to open a new one (`/web`) on the server.
fn burn_window(st: &AppState, headers: &HeaderMap) -> Response {
    let ip = crate::guard::header_ip(headers)
        .map(|i| i.to_string())
        .unwrap_or_else(|| "?".into());
    let burned = st.db.write(|tx| {
        memora_state::arm::burn(tx, &ip, memora_state::now())?;
        act_tx(
            tx,
            headers,
            "code_burned",
            None,
            "too many wrong codes; window closed",
        )
    });
    if let Err(e) = burned {
        tracing::error!("could not close the window after a wrong code: {e}");
    }
    cache::reload(st, Domain::Arm);
    tracing::warn!(%ip, "too many wrong setup codes: window closed, code voided");
    (
        StatusCode::FORBIDDEN,
        Json(json!({
            "error": "Too many wrong setup codes. For safety the code is now void and the window is closed. Open a new one on the server: memora-cli, then /web.",
            "burned": true,
        })),
    )
        .into_response()
}

/// sha256 of the setup code in the body (`code`); empty when missing (never matches).
fn body_code_hash(b: &Value) -> String {
    body_str(b, "code")
        .map(|c| cache::code_hash(&c))
        .unwrap_or_default()
}

/// Check the setup code of the open window (`code` in the body) without using it up.
fn code_ok(st: &AppState, b: &Value) -> bool {
    let hash = body_code_hash(b);
    let now = memora_state::now();
    let res = st
        .db
        .write(|tx| memora_state::arm::verify_code(tx, &hash, now));
    cache::reload(st, Domain::Arm);
    match res {
        Ok(c) => c == CodeCheck::Valid,
        Err(e) => {
            tracing::error!("setup code check failed: {e}");
            false
        }
    }
}

/// `POST /api/auth/verify` `{code}` -> `{ok, mode, expires_in, user?}`.
///
/// The browser checks the code shown in the server terminal before the setup
/// or reset form is revealed. The code is checked again on submit.
async fn h_auth_verify(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_public_ok(&headers) {
        return csrf_fail();
    }
    let s = cache::arm_window(&st);
    if s.status != ArmStatus::Armed {
        return forbidden("no setup or reset window is open; run memora-cli on the server");
    }
    if !readiness(&st).values().all(|v| v.as_bool() == Some(true)) {
        return forbidden("instance is not ready: the vault or state folder is not writable");
    }
    if !code_ok(&st, &b) {
        return wrong_code(&st, &headers);
    }
    let mode = s.mode.map(|m| m.as_str()).unwrap_or("");
    act(&st, &headers, "code_ok", None, mode);
    let user = rd(&st.cache.owner).as_ref().map(|o| o.username.clone());
    Json(json!({
        "ok": true, "mode": mode, "expires_in": s.remaining(memora_state::now()), "user": user,
    }))
    .into_response()
}

/// `GET /api/auth/me` -> `{user,role,expires_in,...}` / `401`.
async fn h_auth_me(State(st): State<AppState>, headers: HeaderMap) -> Response {
    let Some(sess) = super::session_of(&st, &headers) else {
        return unauthorized();
    };
    let expires_in = cache::remaining(&st, &sess);
    let rec = find_user(&st, &sess.user);
    let enabled = match &rec {
        Some(u) => u.enabled,
        None => true,
    };
    // Identity is the username only; display name and role are not exposed.
    Json(json!({
        "authenticated": true,
        "user": sess.user,
        "enabled": enabled,
        "expires_in": expires_in,
    }))
    .into_response()
}

/// `GET /api/auth/events?limit=N` -> `{events:[...],count}` (audit trail, read-only).
async fn h_auth_events(State(st): State<AppState>, req: Request) -> Response {
    if super::session_of(&st, req.headers()).is_none() {
        return unauthorized();
    }
    let limit = super::query_value(req.uri(), "limit")
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(200)
        .clamp(1, 2000);
    let q = super::query_value(req.uri(), "q").unwrap_or_default();
    let q = q.trim();
    let q = (!q.is_empty()).then_some(q);
    match st.db.read(|c| memora_state::activity::recent(c, limit, q)) {
        Ok(rows) => {
            let keys = rd(&st.cache.keys).clone();
            let events: Vec<Value> = rows
                .iter()
                .map(|e| {
                    let mut v = e.to_json();
                    let (actor, kind, id) = resolve_actor(&keys, e.actor.as_deref());
                    v["actor"] = json!(actor);
                    v["actor_kind"] = json!(kind);
                    v["actor_id"] = json!(id);
                    v
                })
                .collect();
            Json(json!({"events": events, "count": events.len()})).into_response()
        }
        Err(e) => db_err(e, "not found"),
    }
}

// ---------------------------------------------------------------------------
// Handler - vault (POST)
// ---------------------------------------------------------------------------

/// `POST /api/save` `{path,content}` -> `{ok:true,path}`
async fn h_api_save(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let (Some(path), Some(content)) = (
        body_str(&b, "path"),
        b.get("content").and_then(|x| x.as_str()),
    ) else {
        return bad("path and content are required");
    };
    match crate::store_as(&st, key.as_deref()).save_impl(&path, content) {
        Ok(()) => Json(json!({"ok": true, "path": path})).into_response(),
        Err(e) => mem_err(e),
    }
}

/// `POST /api/create` `{title,folder}` -> `{ok:true,path}`
async fn h_api_create(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(title) = body_str(&b, "title") else {
        return bad("title is required");
    };
    let folder = body_str(&b, "folder").unwrap_or_default();
    let content = b.get("content").and_then(|x| x.as_str());
    match crate::store_as(&st, key.as_deref()).create_impl(&title, &folder, content) {
        Ok(path) => Json(json!({"ok": true, "path": path})).into_response(),
        Err(e) => mem_err(e),
    }
}

/// `POST /api/rename` `{path,name}` -> `{ok:true,path,links_updated}` (wikilinks to
/// the note are rewritten)
async fn h_api_rename(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let (Some(path), Some(name)) = (body_str(&b, "path"), body_str(&b, "name")) else {
        return bad("path and name are required");
    };
    match crate::store_as(&st, key.as_deref()).rename_note(&path, &name) {
        Ok((new_path, links)) => {
            Json(json!({"ok": true, "path": new_path, "links_updated": links})).into_response()
        }
        Err(e) => mem_err(e),
    }
}

/// `POST /api/move` `{path,folder}` -> `{ok:true,path,links_updated}` (wikilinks to
/// the note are rewritten)
async fn h_api_move(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(path) = body_str(&b, "path") else {
        return bad("path is required");
    };
    let folder = body_str(&b, "folder").unwrap_or_default();
    match crate::store_as(&st, key.as_deref()).move_note(&path, &folder) {
        Ok((new_path, links)) => {
            Json(json!({"ok": true, "path": new_path, "links_updated": links})).into_response()
        }
        Err(e) => mem_err(e),
    }
}

/// `POST /api/delete` `{path}` -> `{ok:true}`
async fn h_api_delete(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(path) = body_str(&b, "path") else {
        return bad("path is required");
    };
    match crate::store_as(&st, key.as_deref()).delete_impl(&path) {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => mem_err(e),
    }
}

/// `POST /api/folder` `{name}` -> `{ok:true,path}`
async fn h_api_folder_create(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(name) = body_str(&b, "name") else {
        return bad("name is required");
    };
    match crate::store_as(&st, key.as_deref()).create_folder_impl(&name) {
        Ok(path) => Json(json!({"ok": true, "path": path})).into_response(),
        Err(e) => mem_err(e),
    }
}

/// `POST /api/folder/rename` `{folder,name}`, `/api/folder/move` `{folder,into}`
/// (`into` "" = top level) and `/api/folder/move-contents` `{folder,into}` ->
/// `{ok,from,to,...}`. Browsers are told to reload their tree.
async fn h_api_folder_op(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    uri: axum::http::Uri,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(folder) = body_str(&b, "folder") else {
        return bad("folder is required");
    };
    let into = b
        .get("into")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let res = {
        let store = crate::store_as(&st, key.as_deref());
        match uri.path().rsplit('/').next().unwrap_or("") {
            "rename" => match body_str(&b, "name") {
                Some(name) => store.rename_folder_impl(&folder, &name),
                None => return bad("name is required"),
            },
            "move" => store.move_folder_impl(&folder, &into),
            _ => store.move_folder_contents_impl(&folder, &into),
        }
    };
    match res {
        Ok(v) => {
            let actor = actor_name(&st, &headers, &key).unwrap_or_default();
            memora_core::events::hub()
                .publish(json!({"type": "folder_changed", "actor": actor, "detail": v}));
            Json(v).into_response()
        }
        Err(e) => mem_err(e),
    }
}

/// `POST /api/delete-folder` `{folder, into?, mode?}` -> `{ok:true,moved_to,moved,links_updated,moved_to_root?}`;
/// `into` = destination folder for the notes (default: the parent; `Root` = top level),
/// `mode: "trash"` = move every note to `.Trash` instead (`{ok,mode,count,trashed}`).
async fn h_api_delete_folder(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(folder) = body_str(&b, "folder") else {
        return bad("folder is required");
    };
    let into = body_str(&b, "into");
    let mode = body_str(&b, "mode");
    match crate::store_as(&st, key.as_deref()).delete_folder_with(
        &folder,
        into.as_deref(),
        mode.as_deref(),
    ) {
        Ok(v) => {
            let mut out = json!({"ok": true});
            if let (Some(o), Some(src)) = (out.as_object_mut(), v.as_object()) {
                for (k, val) in src {
                    o.insert(k.clone(), val.clone());
                }
            }
            Json(out).into_response()
        }
        Err(e) => mem_err(e),
    }
}

/// `POST /api/folder-meta` `{folder,color?,icon?,desc?}` -> `{ok:true}`
async fn h_api_folder_meta_set(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(folder) = body_str(&b, "folder") else {
        return bad("folder is required");
    };
    let color = b.get("color").and_then(|x| x.as_str());
    let icon = b.get("icon").and_then(|x| x.as_str());
    let desc = b.get("desc").and_then(|x| x.as_str());
    match crate::store_as(&st, key.as_deref()).set_folder_meta_impl(&folder, color, icon, desc) {
        Ok(_) => Json(json!({"ok": true, "folder": folder})).into_response(),
        Err(e) => mem_err(e),
    }
}

// ---------------------------------------------------------------------------
// Handler - keys (POST)
// ---------------------------------------------------------------------------

/// Who made a management request, for the activity log: `key:<id>` for an
/// API key, the session user for a browser.
pub(crate) fn actor_name(
    st: &AppState,
    headers: &HeaderMap,
    key: &Option<Extension<ApiKeyCaller>>,
) -> Option<String> {
    match key {
        Some(Extension(k)) => Some(format!("key:{}", k.id)),
        None => cache::session_of(st, headers).map(|s| s.user),
    }
}

/// Validate the optional `tools` / `scopes` fields of a key request.
/// Unknown tool or scope names are an error (400).
#[allow(clippy::type_complexity)]
fn key_permission_fields(
    b: &Value,
) -> Result<(Option<memora_gateway::ToolGrant>, Option<Vec<String>>), Box<Response>> {
    let invalid = |msg: &str| Box::new(bad(msg));
    let tools = match b.get("tools") {
        None | Some(Value::Null) => None,
        Some(v) => {
            let g = memora_gateway::ToolGrant::parse_strict(v).map_err(|e| invalid(&e))?;
            if let memora_gateway::ToolGrant::Only(names) = &g {
                if let Some(n) = names.iter().find(|n| !memora_mcp::is_catalog_tool(n)) {
                    return Err(invalid(&format!("unknown tool: {n}")));
                }
            }
            Some(g)
        }
    };
    let scopes = match b.get("scopes") {
        None | Some(Value::Null) => None,
        Some(v) => Some(memora_gateway::parse_scopes_strict(v).map_err(|e| invalid(&e))?),
    };
    Ok((tools, scopes))
}

fn permissions_detail(id: &str, tools: &memora_gateway::ToolGrant, scopes: &[String]) -> String {
    let t = match tools {
        memora_gateway::ToolGrant::All => "*".to_string(),
        memora_gateway::ToolGrant::Only(s) => s.iter().cloned().collect::<Vec<_>>().join(","),
    };
    format!("{id} tools=[{t}] scopes=[{}]", scopes.join(","))
}

/// `POST /api/keys` `{name}` -> `{ok:true,id,key}` (the key is shown ONCE).
async fn h_api_key_create(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let (tools, scopes) = match key_permission_fields(&b) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    let name = body_str(&b, "name").unwrap_or_else(|| "key".to_string());
    let raw = memora_gateway::generate_key();
    let hash = memora_gateway::hash_api_key(&raw);
    let id = format!("k_{}", &hash[..8]);
    // An empty scope list from the UI means "use the defaults".
    let scope_list = scopes.filter(|s| !s.is_empty()).unwrap_or_else(|| {
        memora_gateway::DEFAULT_KEY_SCOPES
            .iter()
            .map(|s| s.to_string())
            .collect()
    });
    let grant = tools.unwrap_or_default();
    let custom = b.get("tools").is_some_and(|v| !v.is_null())
        || b.get("scopes").is_some_and(|v| !v.is_null());
    let new = memora_state::keys::NewApiKey {
        id: id.clone(),
        name: name.clone(),
        hash,
        prefix: memora_gateway::key_prefix(&raw),
        scopes: cache::scopes_from_names(&scope_list),
        tools: cache::grant_to_db(&grant),
    };
    let color = body_str(&b, "color");
    let user = actor_name(&st, &headers, &key);
    let res = st.db.write(|tx| {
        let mut k = memora_state::keys::create(tx, &new, memora_state::now())?;
        if let Some(sealed) = crate::secrets::seal(st.db.state_dir(), &raw) {
            memora_state::keys::put_secret(tx, &id, &sealed)?;
        }
        if color.is_some() {
            k = memora_state::keys::set_color(tx, &id, color.as_deref())?;
        }
        act_tx(tx, &headers, "key_created", user.as_deref(), &id)?;
        if custom {
            let scopes = cache::scope_names(&k.scopes);
            let detail = permissions_detail(&id, &cache::grant_from_db(&k.tools), &scopes);
            act_tx(tx, &headers, "key_permissions", user.as_deref(), &detail)?;
        }
        Ok(k)
    });
    let k = match res {
        Ok(k) => k,
        Err(e) => return db_err(e, "key not found"),
    };
    cache::reload(&st, Domain::Keys);
    Json(json!({
        "ok": true, "id": id, "key": raw, "name": name,
        "prefix": k.prefix, "persisted": true, "color": k.color,
        "tools": cache::grant_from_db(&k.tools).to_value(),
        "scopes": cache::scope_names(&k.scopes),
    }))
    .into_response()
}

/// Wrong-password limit for showing key secrets: 5 misses per user and IP, then a
/// 5 minute pause. In memory only; separate from the login cooldown.
mod reveal_limit {
    use std::collections::HashMap;
    use std::sync::Mutex;

    const MAX: u32 = 5;
    const PAUSE: i64 = 300;
    static SLOTS: Mutex<Option<HashMap<String, (u32, i64)>>> = Mutex::new(None);

    /// Seconds left in the pause, if any.
    pub fn blocked(slot: &str) -> Option<i64> {
        let g = SLOTS.lock().unwrap();
        let (n, until) = *g.as_ref()?.get(slot)?;
        let now = memora_state::now();
        (n >= MAX && until > now).then(|| until - now)
    }

    pub fn fail(slot: &str) {
        let mut g = SLOTS.lock().unwrap();
        let map = g.get_or_insert_with(HashMap::new);
        let now = memora_state::now();
        map.retain(|_, (_, until)| *until > now);
        let e = map.entry(slot.to_string()).or_insert((0, now + PAUSE));
        e.0 += 1;
        e.1 = now + PAUSE;
    }

    pub fn clear(slot: &str) {
        if let Some(m) = SLOTS.lock().unwrap().as_mut() {
            m.remove(slot);
        }
    }
}

/// `POST /api/keys/reveal` `{id, current}` (signed-in owner, current password
/// again) -> `{key}`: the secret of a key created or rolled from the dashboard.
/// Keys from before migration 5, from the CLI or from OAuth have none (404).
async fn h_api_key_reveal(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(sess) = cache::session_of(&st, &headers) else {
        return unauthorized();
    };
    let Some(id) = body_str(&b, "id") else {
        return bad("id is required");
    };
    // Wrong passwords here have their own small limit and never trigger the
    // login cooldown (that would lock the owner out of signing in).
    let Some(rec) = find_user(&st, &sess.user) else {
        return unauthorized();
    };
    let current = b.get("current").and_then(|x| x.as_str()).unwrap_or("");
    if current.is_empty() || current.len() > MAX_PASSWORD_BYTES {
        return bad("enter your password");
    }
    let slot = format!("{}|{}", sess.user, client_ip(&headers).unwrap_or_default());
    if let Some(wait) = reveal_limit::blocked(&slot) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error": format!("too many wrong passwords for showing keys; try again in {} min", (wait + 59) / 60)})),
        )
            .into_response();
    }
    match st
        .guard
        .verify_password(current.to_string(), rec.password_hash.clone())
        .await
    {
        None => return crate::guard::busy(),
        Some(false) => {
            reveal_limit::fail(&slot);
            act(&st, &headers, "key_reveal_fail", Some(&sess.user), &id);
            return forbidden("password is incorrect");
        }
        Some(true) => reveal_limit::clear(&slot),
    }
    let sealed = st
        .db
        .read(|c| memora_state::keys::get_secret(c, &id))
        .ok()
        .flatten();
    let Some(raw) = sealed.and_then(|s| crate::secrets::open(st.db.state_dir(), &s)) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "not_stored", "message": "this key's secret is not stored; roll it to get a new one"})),
        )
            .into_response();
    };
    let _ = st
        .db
        .write(|tx| act_tx(tx, &headers, "key_revealed", Some(&sess.user), &id));
    let mut r = Json(json!({"ok": true, "id": id, "key": raw})).into_response();
    r.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

/// `POST /api/keys/roll` `{id}` -> `{ok:true,id,key}` (new key material, same id).
async fn h_api_key_roll(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(id) = body_str(&b, "id") else {
        return bad("id is required");
    };
    let raw = memora_gateway::generate_key();
    let hash = memora_gateway::hash_api_key(&raw);
    let prefix = memora_gateway::key_prefix(&raw);
    let user = actor_name(&st, &headers, &key);
    let res = st.db.write(|tx| {
        memora_state::keys::roll(tx, &id, &hash, &prefix)?;
        if let Some(sealed) = crate::secrets::seal(st.db.state_dir(), &raw) {
            memora_state::keys::put_secret(tx, &id, &sealed)?;
        }
        act_tx(tx, &headers, "key_rolled", user.as_deref(), &id)
    });
    if let Err(e) = res {
        return db_err(e, "key not found");
    }
    cache::reload(&st, Domain::Keys);
    Json(json!({
        "ok": true, "id": id, "key": raw, "prefix": prefix, "persisted": true,
    }))
    .into_response()
}

/// `POST /api/keys/update` `{id, name?, enabled?, tools?: "*"|[names], scopes?: [..]}`
/// -> `{ok, id, name, enabled, tools, scopes, persisted}`. Unknown tool or
/// scope names -> 400.
async fn h_api_key_update(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(id) = body_str(&b, "id") else {
        return bad("id is required");
    };
    let (tools, scopes) = match key_permission_fields(&b) {
        Ok(x) => x,
        Err(r) => return *r,
    };
    // Create treats an empty list as "the defaults"; an update never silently
    // turns a key into one that can do nothing.
    if scopes.as_ref().is_some_and(|s| s.is_empty()) {
        return bad("scopes must not be empty");
    }
    let perms_changed = tools.is_some() || scopes.is_some();
    let patch = memora_state::keys::KeyPatch {
        name: body_str(&b, "name"),
        enabled: b.get("enabled").and_then(|x| x.as_bool()),
        scopes: scopes.as_deref().map(cache::scopes_from_names),
        tools: tools.as_ref().map(cache::grant_to_db),
    };
    // `color`: a hex string sets it, "" or null clears it, absent leaves it.
    let color = b.get("color").map(|v| v.as_str().unwrap_or("").to_string());
    let user = actor_name(&st, &headers, &key);
    let res = st.db.write(|tx| {
        let mut k = memora_state::keys::update(tx, &id, &patch)?;
        if let Some(c) = &color {
            k = memora_state::keys::set_color(tx, &id, Some(c))?;
        }
        act_tx(tx, &headers, "key_updated", user.as_deref(), &id)?;
        if perms_changed {
            let scopes = cache::scope_names(&k.scopes);
            let detail = permissions_detail(&id, &cache::grant_from_db(&k.tools), &scopes);
            act_tx(tx, &headers, "key_permissions", user.as_deref(), &detail)?;
        }
        Ok(k)
    });
    let out = match res {
        Ok(k) => k,
        Err(e) => return db_err(e, "key not found"),
    };
    cache::reload(&st, Domain::Keys);
    Json(json!({
        "ok": true, "id": id, "name": out.name, "enabled": out.enabled, "color": out.color,
        "tools": cache::grant_from_db(&out.tools).to_value(),
        "scopes": cache::scope_names(&out.scopes), "persisted": true,
    }))
    .into_response()
}

/// `GET /api/tools` -> `{tools: [{name, category, description, enabled}]}`
async fn h_api_tools(State(st): State<AppState>) -> Response {
    Json(memora_mcp::tools_status(&st.mcp.disabled_tools())).into_response()
}

/// `POST /api/tools` `{name, enabled}` -> `{ok, name, enabled}`.
/// Unknown tool -> 400.
async fn h_api_tools_set(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(name) = body_str(&b, "name") else {
        return bad("name is required");
    };
    let Some(enabled) = b.get("enabled").and_then(|x| x.as_bool()) else {
        return bad("enabled (boolean) is required");
    };
    if !memora_mcp::is_catalog_tool(&name) {
        return bad(&format!("unknown tool: {name}"));
    }
    let user = actor_name(&st, &headers, &key);
    let ip = client_ip(&headers);
    match st
        .mcp
        .set_tool_enabled(&name, enabled, ip.as_deref(), user.as_deref())
    {
        Ok(()) => Json(json!({"ok": true, "name": name, "enabled": enabled})).into_response(),
        Err(e) => {
            tracing::error!(tool = %name, "could not switch the tool: {e:#}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "could not save the tool switch"})),
            )
                .into_response()
        }
    }
}

/// `POST /api/keys/delete` `{id}` -> `{ok:true}` (moves the key to the trash).
async fn h_api_key_delete(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(id) = body_str(&b, "id") else {
        return bad("id is required");
    };
    let user = actor_name(&st, &headers, &key);
    let res = st.db.write(|tx| {
        memora_state::keys::trash(tx, &id, memora_state::now())?;
        act_tx(tx, &headers, "key_deleted", user.as_deref(), &id)
    });
    if let Err(e) = res {
        return db_err(e, "key not found");
    }
    cache::reload(&st, Domain::Keys);
    Json(json!({"ok": true, "id": id, "persisted": true})).into_response()
}

/// `POST /api/keys/restore` `{id}` -> `{ok:true}` (back out of the trash).
async fn h_api_key_restore(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(id) = body_str(&b, "id") else {
        return bad("id is required");
    };
    let user = actor_name(&st, &headers, &key);
    let res = st.db.write(|tx| {
        memora_state::keys::restore(tx, &id)?;
        act_tx(tx, &headers, "key_restored", user.as_deref(), &id)
    });
    if let Err(e) = res {
        return db_err(e, "no deleted key with that id");
    }
    cache::reload(&st, Domain::Keys);
    Json(json!({"ok": true, "id": id, "persisted": true})).into_response()
}

// ---------------------------------------------------------------------------
// Handler - access rules (POST)
// ---------------------------------------------------------------------------

fn parse_kind(s: &str) -> Option<RuleKind> {
    match s.trim().to_lowercase().as_str() {
        "ip" => Some(RuleKind::Ip),
        "range" => Some(RuleKind::Range),
        "cidr" => Some(RuleKind::Cidr),
        "domain" => Some(RuleKind::Domain),
        "all" | "*" => Some(RuleKind::All),
        _ => None,
    }
}

fn parse_action(s: &str) -> Option<AccessAction> {
    match s.trim().to_lowercase().as_str() {
        "allow" | "permit" => Some(AccessAction::Allow),
        "block" | "deny" => Some(AccessAction::Block),
        _ => None,
    }
}

/// `POST /api/access/rules` `{op:"add"|"remove",kind,value,action}` -> `{ok:true}`
async fn h_api_access_rules(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let op = body_str(&b, "op").unwrap_or_else(|| "add".to_string());
    let kind_raw = body_str(&b, "kind").unwrap_or_default();
    let value = body_str(&b, "value").unwrap_or_default();
    // Edit a copy; the stored stack (validated by the repository) is the truth.
    let mut stack = rd(&st.cache.access).clone();

    match op.as_str() {
        "add" => {
            let Some(kind) = parse_kind(&kind_raw) else {
                return bad("kind must be one of: ip, range, cidr, domain, all");
            };
            let Some(action) =
                parse_action(&body_str(&b, "action").unwrap_or_else(|| "block".into()))
            else {
                return bad("action must be allow or block");
            };
            if !matches!(kind, RuleKind::All) && value.is_empty() {
                return bad("value is required");
            }
            let id = format!("r_{}", (now_secs() * 1000.0) as u64);
            stack.rules.push(AccessRule {
                id,
                kind,
                value,
                action,
                enabled: true,
                note: String::new(),
            });
        }
        "remove" => {
            // Without kind and value the filter below would match every rule.
            if kind_raw.is_empty() && value.is_empty() {
                return bad("kind or value is required to remove a rule");
            }
            let kind = parse_kind(&kind_raw);
            if kind.is_none() && !kind_raw.is_empty() {
                return bad("kind must be one of: ip, range, cidr, domain, all");
            }
            let before = stack.rules.len();
            stack.rules.retain(|r| {
                let kind_ok = kind.as_ref().map(|k| k == &r.kind).unwrap_or(true);
                let value_ok = value.is_empty() || r.value == value;
                !(kind_ok && value_ok)
            });
            if stack.rules.len() == before {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error": "rule not found"})),
                )
                    .into_response();
            }
        }
        other => return bad(&format!("unknown op: {other}")),
    }

    let count = stack.rules.len();
    let stored = cache::access_to_db(&stack);
    let user = actor_name(&st, &headers, &key);
    let res = st.db.write(|tx| {
        memora_state::access::save(tx, &stored)?;
        act_tx(
            tx,
            &headers,
            "access_rules",
            user.as_deref(),
            &format!("{op}: {count} rule(s)"),
        )
    });
    if let Err(e) = res {
        return db_err(e, "rule not found");
    }
    cache::reload(&st, Domain::Access);
    Json(json!({"ok": true, "count": count, "persisted": true})).into_response()
}

// ---------------------------------------------------------------------------
// Handler - auth (POST)
// ---------------------------------------------------------------------------

/// `POST /api/auth/login` `{username,password}` -> `200` / `401` / `423` locked.
async fn h_auth_login(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_public_ok(&headers) {
        return csrf_fail();
    }
    if cache::arm_window(&st).status == ArmStatus::Locked {
        return (
            StatusCode::LOCKED,
            Json(json!({
                "error": "instance locked; run memora-cli setup or reset-password on the server",
                "locked": true,
            })),
        )
            .into_response();
    }
    let (Some(username), Some(password)) = (body_str(&b, "username"), body_password(&b)) else {
        return bad("username and password are required");
    };
    if password.len() > MAX_PASSWORD_BYTES || username.len() > 64 {
        return failed_attempt(
            &st,
            &headers,
            StatusCode::UNAUTHORIZED,
            "invalid credentials",
        );
    }
    // Slow mode (many failures from several addresses): every attempt waits a
    // little, which costs a guesser far more than the owner.
    if st.guard.account_hot() {
        tokio::time::sleep(crate::guard::HOT_LOGIN_DELAY).await;
    }
    let rec = find_user(&st, &username);
    // An unknown username still pays for one argon2 verify, so response time
    // does not reveal whether the account exists.
    let hash = rec
        .as_ref()
        .filter(|r| !r.password_hash.is_empty())
        .map(|r| r.password_hash.clone())
        .unwrap_or_else(crate::guard::dummy_hash);
    let Some(matches) = st.guard.verify_password(password, hash).await else {
        return crate::guard::busy();
    };
    let rec = match rec {
        Some(r) if matches => r,
        _ => {
            return failed_attempt(
                &st,
                &headers,
                StatusCode::UNAUTHORIZED,
                "invalid credentials",
            );
        }
    };
    if !rec.enabled {
        return forbidden("account disabled");
    }
    succeeded(&st, &headers);
    let ttl = session_ttl(&st);
    // Never keep using a session id the browser arrived with: a fresh id is
    // issued and any presented one is ended (session fixation).
    let sid = st.db.write(|tx| {
        act_tx(tx, &headers, "login_ok", Some(&rec.username), "")?;
        create_session(tx, &st, &headers)
    });
    let sid = match sid {
        Ok(s) => s,
        Err(e) => return db_err(e, "user not found"),
    };
    let cookie = super::session_cookie_header(&sid, ttl, super::is_https(&headers));
    with_cookie(
        StatusCode::OK,
        json!({
            "ok": true, "user": rec.username,
            "expires_in": ttl, "redirect": "/",
        }),
        Some(cookie),
    )
}

/// `POST /api/auth/logout` `{}` -> `{ok:true}` and clears the session cookie.
async fn h_auth_logout(State(st): State<AppState>, headers: HeaderMap) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    if let Some(sid) = super::cookie_value(&headers, cache::SESSION_COOKIE) {
        let user = rd(&st.cache.owner).as_ref().map(|o| o.username.clone());
        let hash = cache::sid_hash(&sid);
        let res = st.db.write(|tx| {
            if memora_state::session::revoke(tx, &hash)? {
                act_tx(tx, &headers, "logout", user.as_deref(), "")?;
            }
            Ok(())
        });
        if let Err(e) = res {
            tracing::error!("could not end the session: {e}");
        }
    }
    with_cookie(
        StatusCode::OK,
        json!({"ok": true}),
        Some(super::clear_cookie_header()),
    )
}

/// `POST /api/auth/bootstrap` `{username,password}` -> `{ok:true}` (403 when the setup window is not armed).
async fn h_auth_bootstrap(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_public_ok(&headers) {
        return csrf_fail();
    }
    // Held to the end: a second submit waits, then finds the window closed.
    let _account = ACCOUNT_LOCK.lock().await;
    if cache::arm_window(&st).status != ArmStatus::Armed {
        return forbidden("setup window is not open; run memora-cli setup on the server");
    }
    if !code_ok(&st, &b) {
        return wrong_code(&st, &headers);
    }
    if !readiness(&st).values().all(|v| v.as_bool() == Some(true)) {
        return forbidden("instance is not ready: the vault or state folder is not writable");
    }
    if rd(&st.cache.owner).is_some() {
        return forbidden("an account already exists; use reset-password");
    }
    let (Some(username), Some(password)) = (body_str(&b, "username"), body_password(&b)) else {
        return bad("username and password are required");
    };
    if !memora_gateway::valid_username(&username) {
        return bad("invalid username: use letters, digits, '-', '_' or '.', at most 32");
    }
    let minlen = min_password_len(&st);
    if password.chars().count() < minlen {
        return bad(&format!("password must be at least {minlen} characters"));
    }
    if password.len() > MAX_PASSWORD_BYTES {
        return too_long_password();
    }
    let Some(hash) = st.guard.hash_password(password).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "password hashing failed"})),
        )
            .into_response();
    };
    let user = username.to_lowercase();
    let code = body_code_hash(&b);
    // One transaction: the code is checked again and consumed together with the
    // owner it creates, so it works at most once; the CLI may have created the
    // owner while argon2 ran (single owner, never a second account).
    let res = st.db.write(|tx| {
        let now = memora_state::now();
        if memora_state::arm::verify_code(tx, &code, now)? != CodeCheck::Valid {
            return Ok(Err(false));
        }
        if memora_state::owner::get(tx)?.is_some() {
            return Ok(Err(true));
        }
        memora_state::owner::set_owner(tx, &user, &hash, now)?;
        memora_state::arm::disarm(tx)?;
        act_tx(
            tx,
            &headers,
            "setup_done",
            Some(&user),
            "owner created in the browser",
        )?;
        create_session(tx, &st, &headers).map(Ok)
    });
    cache::reload(&st, Domain::Arm);
    cache::reload(&st, Domain::Auth);
    let sid = match res {
        Ok(Ok(sid)) => sid,
        Ok(Err(true)) => return forbidden("an account already exists; use reset-password"),
        Ok(Err(false)) => {
            return forbidden("setup window is not open; run memora-cli setup on the server")
        }
        Err(e) => return db_err(e, "not found"),
    };
    succeeded(&st, &headers);
    let ttl = session_ttl(&st);
    let cookie = super::session_cookie_header(&sid, ttl, super::is_https(&headers));
    with_cookie(
        StatusCode::OK,
        json!({"ok": true, "user": user, "redirect": "/", "persisted": true}),
        Some(cookie),
    )
}

/// `POST /api/auth/reset` `{username,password}` -> `{ok:true}` (403 when the reset window is not armed).
async fn h_auth_reset(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_public_ok(&headers) {
        return csrf_fail();
    }
    let _account = ACCOUNT_LOCK.lock().await;
    if cache::arm_window(&st).status != ArmStatus::Armed {
        return forbidden("reset window is not open; run memora-cli reset-password on the server");
    }
    if !code_ok(&st, &b) {
        return wrong_code(&st, &headers);
    }
    let (Some(username), Some(password)) = (body_str(&b, "username"), body_password(&b)) else {
        return bad("username and password are required");
    };
    if !memora_gateway::valid_username(&username) {
        return bad("invalid username: use letters, digits, '-', '_' or '.', at most 32");
    }
    let minlen = min_password_len(&st);
    if password.chars().count() < minlen {
        return bad(&format!("password must be at least {minlen} characters"));
    }
    if password.len() > MAX_PASSWORD_BYTES {
        return too_long_password();
    }
    if rd(&st.cache.owner).is_none() {
        return forbidden("no account exists yet; run memora-cli setup instead");
    }
    let Some(hash) = st.guard.hash_password(password).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "password hashing failed"})),
        )
            .into_response();
    };
    // Single owner: the reset applies to the one account, and may rename it.
    // Code check, owner update, sign-out of every device and closing the window
    // commit together.
    let user = username.to_lowercase();
    let code = body_code_hash(&b);
    let res = st.db.write(|tx| {
        let now = memora_state::now();
        if memora_state::arm::verify_code(tx, &code, now)? != CodeCheck::Valid {
            return Ok(Err(false));
        }
        if memora_state::owner::get(tx)?.is_none() {
            return Ok(Err(true));
        }
        memora_state::owner::set_owner(tx, &user, &hash, now)?;
        memora_state::session::revoke_all(tx)?;
        memora_state::arm::disarm(tx)?;
        act_tx(
            tx,
            &headers,
            "password_reset",
            Some(&user),
            "reset in the browser; every device signed out",
        )?;
        Ok(Ok(()))
    });
    cache::reload(&st, Domain::Arm);
    cache::reload(&st, Domain::Auth);
    match res {
        Ok(Ok(())) => {}
        Ok(Err(true)) => return forbidden("no account exists yet; run memora-cli setup instead"),
        Ok(Err(false)) => {
            return forbidden(
                "reset window is not open; run memora-cli reset-password on the server",
            )
        }
        Err(e) => return db_err(e, "not found"),
    }
    succeeded(&st, &headers);
    Json(json!({"ok": true, "user": user, "persisted": true})).into_response()
}

/// `POST /api/auth/profile` `{display_name?, current?, password?, confirm?}` -> `{ok:true}`.
///
/// A password change needs the current password and goes through the same
/// path as `POST /api/settings/password`.
async fn h_auth_profile(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    let Some(sess) = super::session_of(&st, &headers) else {
        return unauthorized();
    };
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    if b.get("password")
        .and_then(|x| x.as_str())
        .is_some_and(|p| !p.is_empty())
    {
        return change_password(&st, &headers, &sess, &b).await;
    }
    let Some(rec) = find_user(&st, &sess.user) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "user not found"})),
        )
            .into_response();
    };
    let Some(dn) = b
        .get("display_name")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().chars().take(48).collect::<String>())
    else {
        return Json(json!({"ok": true, "changed": false})).into_response();
    };
    if let Err(e) = st
        .db
        .write(|tx| memora_state::owner::set_display_name(tx, &dn))
    {
        return db_err(e, "user not found");
    }
    cache::reload(&st, Domain::Auth);
    Json(json!({
        "ok": true, "changed": true, "persisted": true,
        "user": rec.username, "password_changed": false,
    }))
    .into_response()
}

// ---------------------------------------------------------------------------
// Handler - settings (signed-in browser session only)
// ---------------------------------------------------------------------------

/// Vault fields for `/api/settings` (signed-in only; `/api/auth/state` shows
/// just `vault_configured`).
fn vault_info(st: &AppState) -> serde_json::Map<String, Value> {
    let vault = st.vault_path();
    let mut m = serde_json::Map::new();
    m.insert("vault_configured".into(), json!(vault.is_some()));
    m.insert("vault".into(), json!(vault));
    let suggested = st
        .db
        .read(memora_state::settings::suggested_vault)
        .unwrap_or(None);
    m.insert("vault_suggested".into(), json!(suggested));
    m
}

/// Check a folder offered as the vault: an absolute path without `..`, that is
/// (or, with `create`, becomes) a directory the server can write. Returns the
/// canonical path, or a message for the user.
pub(crate) fn validate_vault_path(
    raw: &str,
    create: bool,
    state_dir: &Path,
) -> Result<(PathBuf, bool), String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("enter a folder path".into());
    }
    if raw.chars().any(|c| c.is_control()) {
        return Err("the path contains control characters".into());
    }
    let p = Path::new(raw);
    if !p.is_absolute() {
        return Err(if cfg!(windows) {
            "use an absolute path, such as C:\\Users\\you\\memora".into()
        } else {
            "use an absolute path, starting with /".into()
        });
    }
    if p.components().any(|c| c == Component::ParentDir) {
        return Err("the path must not contain '..'".into());
    }
    let Some(parent) = p.parent() else {
        return Err("the filesystem root cannot be the vault".into());
    };
    let mut created = false;
    if !p.exists() {
        if !create {
            return Err(format!(
                "{raw} does not exist; tick \"create folder if missing\" to create it"
            ));
        }
        if !parent.is_dir() {
            return Err(format!(
                "the parent folder {} does not exist",
                parent.display()
            ));
        }
        // Checked before anything is created, so a refused path leaves nothing behind.
        if let (Ok(real_parent), Some(name)) = (canonical(parent), p.file_name()) {
            reserved_vault_path(&real_parent.join(name), state_dir)?;
        }
        fs::create_dir(p).map_err(|e| format!("cannot create {raw}: {e}"))?;
        memora_gateway::match_dir_owner(p, parent);
        created = true;
    }
    if !p.is_dir() {
        return Err(format!("{raw} is not a folder"));
    }
    if !memora_gateway::dir_writable(p) {
        return Err(format!("{raw} is not writable by the server"));
    }
    let abs = canonical(p).unwrap_or_else(|_| p.to_path_buf());
    reserved_vault_path(&abs, state_dir)?;
    Ok((abs, created))
}

/// `canonicalize` without the Windows `\\?\` prefix ([`memora_state::canonical_path`]).
fn canonical(p: &Path) -> std::io::Result<PathBuf> {
    memora_state::canonical_path(p)
}

/// Refuse a vault (symlinks already resolved in `abs`) that is, contains or sits
/// inside the state folder, or lies in a system folder.
fn reserved_vault_path(abs: &Path, state_dir: &Path) -> Result<(), String> {
    if let Ok(state) = canonical(state_dir) {
        if state.starts_with(abs) || abs.starts_with(&state) {
            return Err("the vault cannot be, contain or sit inside the state folder".into());
        }
    }
    #[cfg(unix)]
    const SYSTEM: &[&str] = &[
        "/proc", "/sys", "/dev", "/boot", "/etc", "/bin", "/sbin", "/usr", "/lib", "/lib64",
    ];
    #[cfg(windows)]
    let system: Vec<PathBuf> = [
        "SystemRoot",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
    ]
    .iter()
    .filter_map(std::env::var_os)
    .map(PathBuf::from)
    .collect();
    #[cfg(unix)]
    let system: Vec<PathBuf> = SYSTEM.iter().map(PathBuf::from).collect();
    if abs.parent().is_none() || system.iter().any(|d| inside(abs, d, cfg!(windows))) {
        return Err("a system folder cannot be the vault".into());
    }
    Ok(())
}

/// Whether `p` is `dir` or below it. Windows paths are case-insensitive and
/// `%SystemRoot%` is often `C:\WINDOWS` while the folder reads `C:\Windows`,
/// so there each component is compared ignoring case.
fn inside(p: &Path, dir: &Path, ignore_case: bool) -> bool {
    if !ignore_case {
        return p.starts_with(dir);
    }
    let low = |c: std::path::Component| c.as_os_str().to_string_lossy().to_lowercase();
    let mut pc = p.components();
    dir.components()
        .all(|d| pc.next().is_some_and(|c| low(c) == low(d)))
}

/// Note, link and folder counts of the current vault, computed off the async
/// runtime (it walks every note).
async fn vault_stats(st: &AppState) -> Option<Value> {
    st.vault_path()?;
    let store = st.store.clone();
    tokio::task::spawn_blocking(move || {
        let s = cache::lock(&store).stats();
        json!({"notes": s.notes, "links": s.links, "folders": s.folders})
    })
    .await
    .ok()
}

/// `GET /api/settings` -> `{user, vault_configured, vault, vault_suggested,
/// vault_writable, stats, min_password_len, expires_in, session_ttl,
/// session_max_age, state_dir}`.
async fn h_settings_get(State(st): State<AppState>, headers: HeaderMap) -> Response {
    let Some(sess) = super::session_of(&st, &headers) else {
        return unauthorized();
    };
    let expires_in = cache::remaining(&st, &sess);
    let mut out = vault_info(&st);
    let writable = st.vault_path().map(|v| dir_writable(Path::new(&v)));
    out.insert("user".into(), json!(sess.user));
    out.insert("vault_writable".into(), json!(writable));
    out.insert("stats".into(), json!(vault_stats(&st).await));
    out.insert("min_password_len".into(), json!(min_password_len(&st)));
    out.insert("expires_in".into(), json!(expires_in));
    let (ttl, max_age) = cache::session_limits(&st);
    out.insert("session_ttl".into(), json!(ttl));
    out.insert("session_max_age".into(), json!(max_age));
    out.insert(
        "state_dir".into(),
        json!(st.db.state_dir().to_string_lossy()),
    );
    Json(Value::Object(out)).into_response()
}

/// Verify the signed-in owner's current password (`current` in the body).
/// `Err` carries the response to return: missing, wrong (counted as a failed
/// attempt) or the hashing pool is busy.
async fn check_current(
    st: &AppState,
    headers: &HeaderMap,
    sess: &WebSession,
    b: &Value,
) -> Result<Owner, Box<Response>> {
    let Some(rec) = find_user(st, &sess.user) else {
        return Err(Box::new(unauthorized()));
    };
    let current = b.get("current").and_then(|x| x.as_str()).unwrap_or("");
    if current.is_empty() {
        return Err(Box::new(bad("enter your current password")));
    }
    if current.len() > MAX_PASSWORD_BYTES {
        return Err(Box::new(failed_attempt(
            st,
            headers,
            StatusCode::FORBIDDEN,
            "current password is incorrect",
        )));
    }
    match st
        .guard
        .verify_password(current.to_string(), rec.password_hash.clone())
        .await
    {
        None => Err(Box::new(crate::guard::busy())),
        Some(false) => Err(Box::new(failed_attempt(
            st,
            headers,
            StatusCode::FORBIDDEN,
            "current password is incorrect",
        ))),
        Some(true) => Ok(rec),
    }
}

/// Change the owner password; every other session is signed out.
async fn change_password(
    st: &AppState,
    headers: &HeaderMap,
    sess: &WebSession,
    b: &Value,
) -> Response {
    let pw = b.get("password").and_then(|x| x.as_str()).unwrap_or("");
    let confirm = b.get("confirm").and_then(|x| x.as_str()).unwrap_or("");
    let minlen = min_password_len(st);
    if pw.chars().count() < minlen {
        return bad(&format!(
            "the new password must be at least {minlen} characters"
        ));
    }
    if pw.len() > MAX_PASSWORD_BYTES {
        return too_long_password();
    }
    if pw != confirm {
        return bad("the new password and its confirmation do not match");
    }
    let rec = match check_current(st, headers, sess, b).await {
        Ok(r) => r,
        Err(resp) => return *resp,
    };
    if b.get("current").and_then(|x| x.as_str()) == Some(pw) {
        return bad("the new password is the same as the current one");
    }
    succeeded(st, headers);
    let Some(hash) = st.guard.hash_password(pw.to_string()).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "password hashing failed"})),
        )
            .into_response();
    };
    // Password, sign-out of every other device and the activity row commit together.
    let ip = client_ip(headers);
    let now = memora_state::now();
    let res = st.db.write(|tx| {
        // The sessions about to end, so their browsers can be told why.
        let others: Vec<String> = memora_state::session::list(tx)?
            .into_iter()
            .map(|s| s.sid_hash)
            .filter(|h| *h != sess.sid_hash)
            .collect();
        let n = memora_state::owner::change_password(
            tx,
            &hash,
            Some(&sess.sid_hash),
            ip.as_deref(),
            now,
        )?;
        Ok((n, others))
    });
    let revoked = match res {
        Ok((n, others)) => {
            memora_state::session::remember_revoked(others, REASON_PASSWORD_CHANGED, now);
            n
        }
        Err(e) => return db_err(e, "user not found"),
    };
    cache::reload(st, Domain::Auth);
    tracing::info!(user = %rec.username, revoked, "password changed");
    Json(json!({
        "ok": true, "user": rec.username, "password_changed": true,
        "revoked_sessions": revoked, "persisted": true,
    }))
    .into_response()
}

/// `POST /api/settings/password` `{current, password, confirm}` ->
/// `{ok, revoked_sessions}`; `400` invalid, `403` wrong current password.
async fn h_settings_password(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    let Some(sess) = super::session_of(&st, &headers) else {
        return unauthorized();
    };
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    change_password(&st, &headers, &sess, &b).await
}

/// `POST /api/settings/username` `{username, current}` -> `{ok, user}`.
///
/// Single owner rename. Sessions follow the account, so this browser (and any
/// other) stays signed in.
async fn h_settings_username(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    let Some(sess) = super::session_of(&st, &headers) else {
        return unauthorized();
    };
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(username) = body_str(&b, "username") else {
        return bad("enter a username");
    };
    if !memora_gateway::valid_username(&username) {
        return bad("invalid username: use letters, digits, '-', '_' or '.', at most 32");
    }
    let new = username.to_lowercase();
    let rec = match check_current(&st, &headers, &sess, &b).await {
        Ok(r) => r,
        Err(resp) => return *resp,
    };
    succeeded(&st, &headers);
    if new == rec.username {
        return Json(json!({"ok": true, "user": new, "changed": false})).into_response();
    }
    // Sessions belong to the single owner row, so every device stays signed in.
    let res = st.db.write(|tx| {
        memora_state::owner::rename(tx, &new)?;
        act_tx(
            tx,
            &headers,
            "username_changed",
            Some(&new),
            &format!("was {}", rec.username),
        )
    });
    if let Err(e) = res {
        return db_err(e, "user not found");
    }
    cache::reload(&st, Domain::Auth);
    tracing::info!(from = %rec.username, to = %new, "owner renamed");
    Json(json!({"ok": true, "user": new, "changed": true, "persisted": true})).into_response()
}

/// Reason code for sessions ended by a password change.
const REASON_PASSWORD_CHANGED: &str = "password_changed";
/// Reason code for a session signed out from another device's settings page.
const REASON_SIGNED_OUT_REMOTELY: &str = "signed_out_remotely";
/// Characters of `sid_hash` used as a session id in the settings page.
const SESSION_ID_LEN: usize = 16;

/// Why the session cookie in `headers` no longer works, when it was ended on purpose.
/// `None` without a cookie or while the session is still live.
fn signed_out_reason(st: &AppState, headers: &HeaderMap) -> Option<String> {
    let raw = super::cookie_value(headers, cache::SESSION_COOKIE)?;
    if super::session_of(st, headers).is_some() {
        return None;
    }
    memora_state::session::revoked_reason(&cache::sid_hash(&raw), memora_state::now())
}

/// The session whose id (a `sid_hash` prefix from `GET /api/settings/sessions`) is `id`.
/// `Err` is the response to return: missing, unknown or ambiguous id.
fn find_session(
    st: &AppState,
    id: Option<&str>,
) -> Result<memora_state::session::Session, Box<Response>> {
    let id = id
        .map(|x| x.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if id.len() < memora_state::session::MIN_PREFIX_LEN
        || id.len() > 64
        || !id.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(Box::new(bad("session id is required")));
    }
    let rows = match st.db.read(memora_state::session::list) {
        Ok(r) => r,
        Err(e) => return Err(Box::new(db_err(e, "session not found"))),
    };
    let mut hits = rows.into_iter().filter(|s| s.sid_hash.starts_with(&id));
    match (hits.next(), hits.next()) {
        (Some(one), None) => Ok(one),
        (None, _) => Err(Box::new(
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "that session has already ended"})),
            )
                .into_response(),
        )),
        _ => Err(Box::new(bad("session id matches more than one session"))),
    }
}

/// `GET /api/settings/sessions` -> `{sessions:[{id, current, source, alias, ip,
/// user_agent, created_at, last_seen, expires_in}]}`, newest first. Browser sessions
/// only; API keys are not sessions and never appear here.
async fn h_settings_sessions(State(st): State<AppState>, headers: HeaderMap) -> Response {
    let Some(sess) = super::session_of(&st, &headers) else {
        return unauthorized();
    };
    let (ttl, max_age) = cache::session_limits(&st);
    let now = memora_state::now();
    let rows = match st.db.read(memora_state::session::list) {
        Ok(r) => r,
        Err(e) => return db_err(e, "not found"),
    };
    let list: Vec<Value> = rows
        .iter()
        .filter(|s| s.is_live(ttl, max_age, now))
        .map(|s| {
            let current = s.sid_hash == sess.sid_hash;
            // This request is newer than the buffered last_seen.
            let last_seen = if current { now } else { s.last_seen };
            json!({
                "id": &s.sid_hash[..SESSION_ID_LEN.min(s.sid_hash.len())],
                "current": current,
                "source": s.source,
                "alias": s.alias,
                "ip": s.ip,
                "user_agent": s.user_agent,
                "created_at": s.created_at,
                "last_seen": last_seen,
                "expires_in": if current { cache::remaining(&st, &sess) } else { s.remaining(ttl, now) },
            })
        })
        .collect();
    Json(json!({"sessions": list, "count": list.len()})).into_response()
}

/// `POST /api/settings/sessions/revoke` `{id}` or `{others: true}` -> `{ok, revoked}`.
/// Signs other browsers out (they are told why on their next visit). The current
/// session is ended with `POST /api/auth/logout` instead. API keys are untouched.
async fn h_settings_session_revoke(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    let Some(sess) = super::session_of(&st, &headers) else {
        return unauthorized();
    };
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let now = memora_state::now();
    let targets: Vec<String> = if b.get("others").and_then(|x| x.as_bool()) == Some(true) {
        match st.db.read(memora_state::session::list) {
            Ok(rows) => rows
                .into_iter()
                .map(|s| s.sid_hash)
                .filter(|h| *h != sess.sid_hash)
                .collect(),
            Err(e) => return db_err(e, "not found"),
        }
    } else {
        match find_session(&st, b.get("id").and_then(|x| x.as_str())) {
            Ok(s) if s.sid_hash == sess.sid_hash => {
                return bad("this is your current session; use sign out instead")
            }
            Ok(s) => vec![s.sid_hash],
            Err(resp) => return *resp,
        }
    };
    let res = st.db.write(|tx| {
        let mut gone = Vec::new();
        for h in &targets {
            if memora_state::session::revoke(tx, h)? {
                gone.push(h.clone());
            }
        }
        if !gone.is_empty() {
            act_tx(
                tx,
                &headers,
                "sessions_revoked",
                Some(&sess.user),
                &format!("{} session(s) signed out from settings", gone.len()),
            )?;
        }
        Ok(gone)
    });
    match res {
        Ok(gone) => {
            let n = gone.len();
            memora_state::session::remember_revoked(gone, REASON_SIGNED_OUT_REMOTELY, now);
            tracing::info!(revoked = n, "sessions signed out from settings");
            Json(json!({"ok": true, "revoked": n})).into_response()
        }
        Err(e) => db_err(e, "session not found"),
    }
}

/// `POST /api/settings/sessions/rename` `{id, alias}` -> `{ok, alias}`: name a device
/// (an empty alias clears it; at most 64 characters).
async fn h_settings_session_rename(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if super::session_of(&st, &headers).is_none() {
        return unauthorized();
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let target = match find_session(&st, b.get("id").and_then(|x| x.as_str())) {
        Ok(s) => s,
        Err(resp) => return *resp,
    };
    let alias = b.get("alias").and_then(|x| x.as_str()).unwrap_or("");
    if alias.chars().any(char::is_control) {
        return bad("the device name cannot contain control characters");
    }
    let alias = alias.trim();
    let res = st
        .db
        .write(|tx| memora_state::session::set_alias(tx, &target.sid_hash, Some(alias)));
    match res {
        Ok(()) => {
            Json(json!({"ok": true, "alias": (!alias.is_empty()).then_some(alias)})).into_response()
        }
        Err(e) => db_err(e, "that session has already ended"),
    }
}

/// `GET /api/settings/sessions/activity?id=` -> `{events:[...], ip, since}`: account
/// activity recorded from this session's IP address since it signed in (sign-ins,
/// settings changes, failed attempts). Agent (API key) events are left out. Newest first.
async fn h_settings_session_activity(State(st): State<AppState>, req: Request) -> Response {
    if super::session_of(&st, req.headers()).is_none() {
        return unauthorized();
    }
    let id = super::query_value(req.uri(), "id");
    let target = match find_session(&st, id.as_deref()) {
        Ok(s) => s,
        Err(resp) => return *resp,
    };
    let since = target.created_at - 60;
    let rows = match st
        .db
        .read(|c| memora_state::activity::recent(c, 2000, None))
    {
        Ok(r) => r,
        Err(e) => return db_err(e, "not found"),
    };
    let events: Vec<Value> = rows
        .iter()
        .filter(|e| e.at >= since)
        .filter(|e| target.ip.is_some() && e.ip == target.ip)
        .filter(|e| !e.actor.as_deref().is_some_and(|a| a.starts_with("key:")))
        .take(200)
        .map(|e| e.to_json())
        .collect();
    Json(json!({
        "events": events, "count": events.len(),
        "ip": target.ip, "since": target.created_at,
    }))
    .into_response()
}

/// `POST /api/settings/vault` `{path, create?}` -> `{ok, vault, created, stats}`.
///
/// Validates the folder, stores it in the state database and switches the
/// running server to it: the store is replaced in place (MCP shares the same
/// `Arc`) and realtime events are written to the new vault.
async fn h_settings_vault(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    let Some(sess) = super::session_of(&st, &headers) else {
        return unauthorized();
    };
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let raw = b
        .get("path")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let create = b.get("create").and_then(|x| x.as_bool()).unwrap_or(false);
    let state = st.db.state_dir().to_path_buf();
    let checked =
        tokio::task::spawn_blocking(move || validate_vault_path(&raw, create, &state)).await;
    let (path, created) = match checked {
        Ok(Ok(v)) => v,
        Ok(Err(msg)) => return bad(&msg),
        Err(_) => return bad("could not check the folder"),
    };
    let vault = path.to_string_lossy().to_string();

    let res = st.db.write(|tx| {
        memora_state::settings::set_vault(tx, Some(&vault), memora_state::now())?;
        act_tx(tx, &headers, "vault_changed", Some(&sess.user), &vault)
    });
    if let Err(e) = res {
        return db_err(e, "not found");
    }
    // Switch first, then reload: the reload then sees the same vault and does nothing.
    cache::apply_vault(&st, &path);
    cache::reload(&st, Domain::Settings);
    tracing::info!(user = %sess.user, vault = %vault, created, "vault switched");
    Json(json!({
        "ok": true, "vault": vault, "created": created,
        "stats": vault_stats(&st).await,
    }))
    .into_response()
}

// ---------------------------------------------------------------------------
// Actor names
// ---------------------------------------------------------------------------

/// The live API key's name for `id`, if the key still exists.
pub(crate) fn key_name(keys: &[memora_state::keys::ApiKey], id: &str) -> Option<String> {
    keys.iter()
        .find(|k| k.id == id)
        .map(|k| k.name.clone())
        .filter(|n| !n.trim().is_empty())
}

/// Display identity of a stored activity actor: `key:<id>` rows (API-key calls) become
/// `(key name or id, "agent", id)`, anything else `(actor, "user", actor)`; no actor
/// stays null.
pub(crate) fn resolve_actor(
    keys: &[memora_state::keys::ApiKey],
    actor: Option<&str>,
) -> (Option<String>, Option<&'static str>, Option<String>) {
    match actor {
        None => (None, None, None),
        Some(a) => match a.strip_prefix("key:") {
            Some(id) => (
                Some(key_name(keys, id).unwrap_or_else(|| id.to_string())),
                Some("agent"),
                Some(id.to_string()),
            ),
            None => (Some(a.to_string()), Some("user"), Some(a.to_string())),
        },
    }
}

// ---------------------------------------------------------------------------
// Handler - vault event log
// ---------------------------------------------------------------------------

/// `GET /api/events?since=<unix>&folder=&actor=&limit=N` -> `{events:[...],count}`:
/// the vault event log (`.events.jsonl`: `ai_activity` starts and node events), oldest
/// first, newest `limit` (default 100, max 2000). `actor` is the key NAME for API-key
/// calls (newer events also carry `actor_kind` and `actor_id`).
async fn h_api_events(State(st): State<AppState>, req: Request) -> Response {
    let q = |k: &str| super::query_value(req.uri(), k).filter(|v| !v.trim().is_empty());
    let since = q("since").and_then(|v| v.trim().parse::<f64>().ok());
    let limit = q("limit")
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(100)
        .clamp(1, 2000);
    let key = req.extensions().get::<ApiKeyCaller>().cloned();
    let events = crate::store_as(&st, key.as_ref()).get_events_impl(
        since,
        q("folder").as_deref(),
        q("actor").as_deref(),
        limit,
    );
    Json(json!({"events": events, "count": events.len()})).into_response()
}

// ---------------------------------------------------------------------------
// Handler - UI layout persistence
// ---------------------------------------------------------------------------

/// Request body cap for `PUT /api/ui/layout/{name}` (the stored document is capped at
/// 512 KiB; the rest is the `{"data": ...}` envelope and whitespace).
pub(crate) const LAYOUT_BODY_LIMIT: usize = 600 * 1024;

/// Layouts belong to the signed-in browser: API keys are refused (403).
fn layout_gate(key: &Option<Extension<ApiKeyCaller>>, name: &str) -> Option<Response> {
    if key.is_some() {
        return Some(forbidden("UI layouts are for the signed-in browser only"));
    }
    if !memora_state::ui_layout::valid_name(name) {
        return Some(bad(
            "invalid layout name: use 1-40 characters of a-z, 0-9, '_' or '-'",
        ));
    }
    None
}

/// `GET /api/ui/layout/{name}` -> `{name, data: <json>|null, updated_at: <unix>|null}`.
async fn h_ui_layout_get(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Response {
    if let Some(r) = layout_gate(&key, &name) {
        return r;
    }
    match st.db.read(|c| memora_state::ui_layout::get(c, &name)) {
        Ok(Some(l)) => {
            let data: Value = serde_json::from_str(&l.data).unwrap_or(Value::Null);
            Json(json!({"name": name, "data": data, "updated_at": l.updated_at})).into_response()
        }
        Ok(None) => Json(json!({"name": name, "data": null, "updated_at": null})).into_response(),
        Err(e) => db_err(e, "layout not found"),
    }
}

/// `PUT /api/ui/layout/{name}` `{data: <json>}` -> `{ok:true, updated_at}`.
/// Browser session only, same-origin, `data` at most 512 KiB serialized (413).
async fn h_ui_layout_put(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    axum::extract::Path(name): axum::extract::Path<String>,
    body: axum::body::Bytes,
) -> Response {
    if key.is_some() {
        return forbidden("UI layouts are for the signed-in browser only");
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    if let Some(r) = layout_gate(&key, &name) {
        return r;
    }
    let Ok(Value::Object(mut b)) = serde_json::from_slice::<Value>(&body) else {
        return bad("body must be a JSON object {\"data\": ...}");
    };
    let Some(data) = b.remove("data") else {
        return bad("missing field: data");
    };
    let raw = data.to_string();
    if raw.len() > memora_state::ui_layout::DATA_MAX {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error": format!(
                "layout larger than {} bytes",
                memora_state::ui_layout::DATA_MAX
            )})),
        )
            .into_response();
    }
    let now = memora_state::now();
    match st
        .db
        .write(|tx| memora_state::ui_layout::put(tx, &name, &raw, now))
    {
        Ok(at) => Json(json!({"ok": true, "updated_at": at})).into_response(),
        Err(e) => db_err(e, "layout not found"),
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/// Router for the web UI JSON API.
///
/// The parent router attaches it with shared state:
/// ```ignore
/// Router::new().merge(api::api_router()).with_state(st)
/// ```
/// Routes already registered by `build_router()` are not added again, because
/// merging two handlers for the same method and path panics.
pub fn api_router() -> Router<AppState> {
    Router::new()
        // GET
        .route("/api/note", get(h_api_note))
        .route("/api/vault/file", get(h_api_vault_file))
        .route("/api/folder-meta", get(h_api_folder_meta))
        .route("/api/actors", get(h_api_actors))
        .route("/api/logs", get(h_api_logs))
        .route(
            "/api/logs/settings",
            get(h_api_log_settings).post(h_api_log_settings_set),
        )
        .route("/api/config", get(h_api_config))
        .route("/api/auth/state", get(h_auth_state))
        .route("/api/auth/me", get(h_auth_me))
        .route("/api/auth/events", get(h_auth_events))
        .route("/api/events", get(h_api_events))
        .route(
            "/api/ui/layout/{name}",
            get(h_ui_layout_get)
                .put(h_ui_layout_put)
                .layer(DefaultBodyLimit::max(LAYOUT_BODY_LIMIT)),
        )
        // POST - vault
        .route("/api/save", post(h_api_save))
        .route("/api/create", post(h_api_create))
        .route("/api/rename", post(h_api_rename))
        .route("/api/move", post(h_api_move))
        .route("/api/delete", post(h_api_delete))
        .route("/api/folder", post(h_api_folder_create))
        .route("/api/folder/rename", post(h_api_folder_op))
        .route("/api/folder/move", post(h_api_folder_op))
        .route("/api/folder/move-contents", post(h_api_folder_op))
        .route("/api/delete-folder", post(h_api_delete_folder))
        .route("/api/folder-meta", post(h_api_folder_meta_set))
        // POST - keys
        .route("/api/keys", post(h_api_key_create))
        .route("/api/keys/roll", post(h_api_key_roll))
        .route("/api/keys/reveal", post(h_api_key_reveal))
        .route("/api/keys/update", post(h_api_key_update))
        .route("/api/keys/delete", post(h_api_key_delete))
        .route("/api/keys/restore", post(h_api_key_restore))
        // Global MCP tool switches (browser session or admin key)
        .route("/api/tools", get(h_api_tools).post(h_api_tools_set))
        // POST - access rules
        .route("/api/access/rules", post(h_api_access_rules))
        // POST - auth
        .route(
            "/api/auth/login",
            post(h_auth_login).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        .route(
            "/api/auth/verify",
            post(h_auth_verify).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        .route(
            "/api/auth/logout",
            post(h_auth_logout).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        .route(
            "/api/auth/bootstrap",
            post(h_auth_bootstrap).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        .route(
            "/api/auth/reset",
            post(h_auth_reset).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        .route(
            "/api/auth/profile",
            post(h_auth_profile).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        // Settings (signed-in browser session)
        .route("/api/settings", get(h_settings_get))
        .route(
            "/api/settings/password",
            post(h_settings_password).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        .route(
            "/api/settings/username",
            post(h_settings_username).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        .route(
            "/api/settings/vault",
            post(h_settings_vault).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        .route("/api/settings/sessions", get(h_settings_sessions))
        .route(
            "/api/settings/sessions/revoke",
            post(h_settings_session_revoke).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        .route(
            "/api/settings/sessions/rename",
            post(h_settings_session_rename).layer(DefaultBodyLimit::max(AUTH_BODY_LIMIT)),
        )
        .route(
            "/api/settings/sessions/activity",
            get(h_settings_session_activity),
        )
}

#[cfg(test)]
mod tests {
    #[test]
    fn system_folder_check_ignores_case_when_asked() {
        use std::path::Path;
        let win = Path::new("/C/WINDOWS");
        assert!(super::inside(Path::new("/C/Windows/System32"), win, true));
        assert!(!super::inside(Path::new("/C/Windows/System32"), win, false));
        assert!(!super::inside(Path::new("/C/Win/x"), win, true));
        assert!(!super::inside(Path::new("/C"), win, true));
        assert!(super::inside(Path::new("/etc/x"), Path::new("/etc"), false));
    }

    use std::path::{Path, PathBuf};

    /// Every call checks against a state folder that does not exist.
    fn validate_vault_path(raw: &str, create: bool) -> Result<(PathBuf, bool), String> {
        super::validate_vault_path(raw, create, Path::new("/nonexistent-memora-state"))
    }

    /// A fresh scratch folder under the system temp dir.
    fn scratch(name: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("memora-vault-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn rejects_relative_empty_and_parent_paths() {
        assert!(validate_vault_path("", false).is_err());
        assert!(validate_vault_path("   ", false).is_err());
        assert!(validate_vault_path("data", false).is_err());
        assert!(validate_vault_path("./data", false).is_err());
        assert!(validate_vault_path("/tmp/../etc", false).is_err());
        assert!(validate_vault_path("/", false).is_err());
    }

    #[test]
    fn existing_writable_folder_is_accepted() {
        let d = scratch("ok");
        let (p, created) = validate_vault_path(d.to_str().unwrap(), false).unwrap();
        assert_eq!(p, super::canonical(&d).unwrap());
        assert!(!created);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn missing_folder_needs_create_and_an_existing_parent() {
        let d = scratch("create");
        let target = d.join("vault");
        let t = target.to_str().unwrap();
        assert!(validate_vault_path(t, false).is_err());
        assert!(!target.exists());
        let (p, created) = validate_vault_path(t, true).unwrap();
        assert!(created && p.is_dir());
        // Only one level is created: a missing parent is refused.
        let deep = d.join("a/b");
        assert!(validate_vault_path(deep.to_str().unwrap(), true).is_err());
        assert!(!d.join("a").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    #[cfg(unix)]
    fn system_state_and_control_paths_are_refused() {
        assert!(validate_vault_path("/proc/self", false).is_err());
        assert!(validate_vault_path("/etc", false).is_err());
        assert!(validate_vault_path("/tmp/a\0b", true).is_err());
        assert!(validate_vault_path("/tmp/a\nb", true).is_err());
        // A symlink to a system folder resolves to it and is refused.
        let d = scratch("link");
        let link = d.join("sys");
        std::os::unix::fs::symlink("/proc", &link).unwrap();
        assert!(validate_vault_path(link.to_str().unwrap(), false).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn refused_folder_is_not_created() {
        let state = scratch("state");
        let target = state.join("vault");
        let res = super::validate_vault_path(target.to_str().unwrap(), true, &state);
        assert!(res.is_err());
        assert!(!target.exists());
        let _ = std::fs::remove_dir_all(&state);
    }

    #[test]
    fn a_file_is_not_a_vault() {
        let d = scratch("file");
        let f = d.join("note.md");
        std::fs::write(&f, "x").unwrap();
        assert!(validate_vault_path(f.to_str().unwrap(), false).is_err());
        assert!(validate_vault_path(f.to_str().unwrap(), true).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }
}
