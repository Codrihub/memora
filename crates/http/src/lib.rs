//! HTTP + MCP server for the Memora memory vault.
//!
//! Every access path (public domain, LAN IP, VPN IP) enters through this server:
//!   * `/healthz`              - liveness probe
//!   * `/.well-known/mcp.json` - discovery card for agents (MCP auto-detection)
//!   * `/mcp`                  - MCP streamable HTTP (JSON-RPC 2.0)
//!   * `/tools`                - human-readable tool catalog
//!   * `/api/*`                - JSON API for the web UI (requires an API key)
//!   * `/`                     - static web UI
//!
//! Middleware runs in order: guard (caller IP, rate limits, cooldowns) ->
//! access stack (IP/domain) -> API key -> lock gate -> vault gate (409 on
//! vault routes until a vault folder is chosen).

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Request, State,
    },
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Json, Response},
    routing::{any, get, post},
    Router,
};
use memora_core::MemoryStore;
use memora_gateway::AccessAction;
use memora_mcp::{detect_client, discovery_card, McpServer, RpcRequest, SERVER_VERSION};
use memora_state::arm::ArmStatus;
use memora_state::Db;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::broadcast;

pub mod api;
mod assets;
pub mod cache;
pub mod guard;
pub mod oauth;
pub mod privacy;
pub mod release;
pub mod secrets;

use cache::rd;
pub use cache::{session_of, Caches, WebSession};
use guard::{Bucket, Guard};

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<Mutex<MemoryStore>>,
    pub mcp: Arc<McpServer>,
    /// The state database (`<MEMORA_STATE>/memora.db`).
    pub db: Db,
    /// Owner, keys, settings, arm window and access stack, reloaded on change
    /// (see [`cache`]).
    pub cache: Arc<Caches>,
    /// Key usage and key events, written in batches by a background task.
    pub usage: Arc<Mutex<memora_state::usage::UsageBuffer>>,
    /// Session `last_seen` updates, written in batches by a background task.
    pub last_seen: Arc<Mutex<memora_state::session::LastSeenBuffer>>,
    /// Directory holding the web UI assets (index.html, app.css, app.js, login.html, login.css).
    pub assets: String,
    /// The configured vault folder (`settings.vault_path`); `None` until one is
    /// chosen. Switched at runtime from Settings or by `memora-cli vault`.
    pub vault: Arc<RwLock<Option<String>>>,
    /// Rate limits, failure cooldowns and bounded argon2.
    pub guard: Arc<Guard>,
    /// Hostnames allowed to reach the server (`MEMORA_DOMAIN` / `MEMORA_BASE_URL`);
    /// empty means any host.
    pub domains: Arc<Vec<String>>,
}

impl AppState {
    /// State for `db`: loads the caches; the vault comes from `settings.vault_path`.
    /// `store` must point at that vault (or nowhere when none is configured).
    pub fn new(
        db: Db,
        store: Arc<Mutex<MemoryStore>>,
        assets: String,
        guard: Guard,
        domains: Vec<String>,
    ) -> memora_state::Result<AppState> {
        let cache = Caches::load(&db)?;
        let vault = rd(&cache.settings).vault_path.clone();
        let mcp = Arc::new(McpServer::new(store.clone(), db.clone()));
        Ok(AppState {
            store,
            mcp,
            db,
            cache: Arc::new(cache),
            usage: Arc::default(),
            last_seen: Arc::default(),
            assets,
            vault: Arc::new(RwLock::new(vault)),
            guard: Arc::new(guard),
            domains: Arc::new(domains),
        })
    }

    /// The current vault folder, or `None` when no vault is configured yet.
    pub fn vault_path(&self) -> Option<String> {
        self.vault.read().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// The API key behind a request, attached by `mw_auth` as a request
/// extension. Absent for browser sessions (full access).
#[derive(Debug, Clone)]
pub struct ApiKeyCaller {
    pub id: String,
    pub name: String,
    pub perms: memora_gateway::KeyPermissions,
    pub ip: String,
}

/// The vault store locked for one request: an API key works under its privacy view
/// (hidden notes and folders do not exist for it; fail closed), a browser session sees
/// everything. The view is cleared when the guard drops.
pub fn store_as<'a>(
    st: &'a AppState,
    key: Option<&ApiKeyCaller>,
) -> memora_core::privacy::Viewed<'a> {
    let view = key.and_then(|k| memora_mcp::privacy::view_for_key(&st.db, &k.id));
    memora_core::privacy::lock_as(&st.store, view)
}

/// Scope an API key needs for `method path`, or `None` when the route does
/// not take keys into account (public or session-only routes).
/// `mcp` for /mcp; `admin` for tool, key and access-stack management;
/// `read` for other GET /api routes; `write` for other mutating /api routes.
pub fn required_scope(method: &axum::http::Method, path: &str) -> Option<&'static str> {
    if path == "/mcp" || path.starts_with("/mcp/") {
        return Some("mcp");
    }
    let rest = path.strip_prefix("/api/")?;
    let admin = [
        "tools",
        "keys",
        "access",
        "logs/settings",
        "oauth/clients",
        "privacy",
    ]
    .iter()
    .any(|p| rest == *p || rest.starts_with(&format!("{p}/")));
    if admin {
        return Some("admin");
    }
    if matches!(*method, axum::http::Method::GET | axum::http::Method::HEAD) {
        Some("read")
    } else {
        Some("write")
    }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/// The caller IP resolved by `mw_guard` (forwarding headers are honoured only
/// from a trusted proxy), falling back to the TCP peer.
fn client_ip(req: &Request, peer: Option<SocketAddr>) -> String {
    guard::header_ip(req.headers())
        .map(|ip| ip.to_string())
        .or_else(|| peer.map(|p| p.ip().to_string()))
        .unwrap_or_default()
}

/// Front-door guard, the outermost layer: refuse hosts outside the domain
/// allow-list, resolve the caller IP, apply the
/// per-IP token buckets and refuse callers that are cooling down after
/// failed attempts. Requests from this machine itself are not limited.
async fn mw_guard(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    mut req: Request,
    next: Next,
) -> Response {
    // A request for any other domain gets a bare 404, as if nothing were here.
    // HTTP/2 carries the host in `:authority` (the URI) instead of `Host`.
    let host = request_host(&req);
    if !memora_gateway::host_allowed(&st.domains, &host) {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    // Forwarding headers are believed only from a trusted proxy: drop the
    // scheme/host hints an outside caller sent, so `is_https` (cookie Secure,
    // HSTS), the CSRF host check and the OAuth base URL cannot be steered by a
    // direct client.
    if !st.guard.trusted_peer(peer) {
        let h = req.headers_mut();
        for name in [
            "x-forwarded-proto",
            "x-forwarded-host",
            "x-forwarded-ssl",
            "forwarded",
            "cf-visitor",
        ] {
            h.remove(name);
        }
    }
    let ip = st.guard.client_ip(peer, req.headers());
    guard::set_header_ip(req.headers_mut(), &ip);
    let path = req.uri().path().to_string();
    if path == "/healthz" || ip.is_loopback() {
        return next.run(req).await;
    }
    if let Err(wait) = st.guard.take(Bucket::Global, &ip) {
        return guard::too_many(wait, false);
    }
    // Match the rate-limited routes on a canonical form of the path, so a
    // variant (trailing slash, doubled slash, case, %-escapes) can never reach
    // an auth handler without passing the auth buckets.
    let canon = canonical_path(&path);
    let auth_write = req.method() == axum::http::Method::POST
        && matches!(
            canon.as_str(),
            "/api/auth/login"
                | "/api/auth/bootstrap"
                | "/api/auth/reset"
                | "/api/auth/verify"
                | "/api/auth/profile"
                | "/api/settings/password"
                | "/api/settings/username"
        );
    if auth_write {
        if let Some(wait) = st.guard.blocked(&ip) {
            return guard::too_many(wait, true);
        }
        if let Err(wait) = st.guard.take(Bucket::AuthWrite, &ip) {
            return guard::too_many(wait, false);
        }
    } else if canon == "/api/auth/state" {
        if let Err(wait) = st.guard.take(Bucket::AuthRead, &ip) {
            return guard::too_many(wait, false);
        }
    } else if (path.starts_with("/api/") || path.starts_with("/mcp"))
        && extract_key(req.headers()).is_some()
    {
        // An IP that kept presenting bad API keys waits out its cooldown.
        if let Some(wait) = st.guard.cooldown(&guard::ip_key(&ip)) {
            return guard::too_many(wait, true);
        }
    }
    next.run(req).await
}

/// The host the request is for: the `Host` header, else the URI authority
/// (HTTP/2 `:authority`). Empty when neither is present.
fn request_host(req: &Request) -> String {
    req.headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .map(str::to_string)
        .or_else(|| req.uri().authority().map(|a| a.as_str().to_string()))
        .unwrap_or_default()
}

/// Lowercase, percent-decoded path with repeated and trailing slashes removed;
/// used only to decide which rate-limit bucket a request falls in.
fn canonical_path(path: &str) -> String {
    let decoded = percent_decode(&path.replace('+', "%2B")).to_ascii_lowercase();
    let mut out = String::with_capacity(decoded.len());
    for seg in decoded.split('/').filter(|s| !s.is_empty()) {
        out.push('/');
        out.push_str(seg);
    }
    if out.is_empty() {
        out.push('/');
    }
    out
}

/// Access-control middleware: IP / range / CIDR / domain rules. Loopback always passes.
async fn mw_access(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    if path == "/healthz" {
        return next.run(req).await;
    }
    // Changes made by memora-cli (owner, keys, tools, access, settings, arm) take
    // effect on the next request: one PRAGMA when nothing changed.
    cache::refresh(&st);
    let ip = client_ip(&req, Some(peer));
    // Host without port; IPv6 literals keep their address (`[::1]:80` -> `::1`).
    let domain = memora_gateway::url_host(&request_host(&req));
    let action = rd(&st.cache.access).evaluate(Some(&ip), domain.as_deref());
    if action == AccessAction::Block {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"access denied by stack rule","ip":ip})),
        )
            .into_response();
    }
    next.run(req).await
}

/// Read the key from the `Authorization: Bearer` header, or from `X-API-Key`.
fn extract_key(h: &HeaderMap) -> Option<String> {
    if let Some(v) = h.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(rest) = v.strip_prefix("Bearer ") {
            return Some(rest.trim().to_string());
        }
    }
    h.get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
}

/// Authentication gate: API key (agents/MCP) or session cookie (browser).
///
/// Static assets and a small set of `/api/auth/*` endpoints are deliberately
/// public, so the login page can load and the recovery form stays reachable
/// while the instance is locked.
async fn mw_auth(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    mut req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();

    // Static assets are always public: a locked login page still needs its
    // CSS/JS in order to render the CLI instructions.
    let is_asset = path.starts_with("/assets/")
        || matches!(
            path.as_str(),
            "/app.css"
                | "/app.js"
                | "/login.css"
                | "/favicon.ico"
                | "/favicon.svg"
                | "/manifest.webmanifest"
                | "/sw.js"
                | "/robots.txt"
                | "/icon-192.png"
                | "/icon-512.png"
                | "/icon-maskable-512.png"
                | "/apple-touch-icon.png"
                | "/offline.html"
        );

    // Lock gate: while the instance is LOCKED the UI is redirected to the lock
    // screen and API calls are rejected.
    // IMPORTANT: never create a redirect loop; `/login` is the terminal
    // destination while LOCKED.
    if cache::arm_window(&st).status == ArmStatus::Locked
        && !memora_gateway::lock_allows(&path)
        && !is_asset
    {
        // Machine endpoints (API, MCP, OAuth token/registration, discovery)
        // get JSON; only pages a browser opens are sent to the lock screen.
        let machine = path.starts_with("/api/")
            || path.starts_with("/mcp")
            || path.starts_with("/.well-known/")
            || (path.starts_with("/oauth/") && path != "/oauth/authorize");
        if machine {
            return (
                StatusCode::LOCKED,
                Json(json!({
                    "error": "instance LOCKED: open a setup/reset session via the CLI on the server",
                    "locked": true,
                    "hint": "run the CLI to open a setup/reset session, then finish it in the browser"
                })),
            )
                .into_response();
        }
        return redirect("/login?locked=1");
    }

    // Public paths: healthz, discovery, tools, the login page, static assets,
    // and only the auth endpoints that are meant to run without a session.
    // IMPORTANT: match exactly rather than by the `/api/auth/` prefix - a loose
    // prefix would let /api/auth/me, /api/auth/profile and /api/auth/events
    // through unauthenticated.
    if oauth::is_public(&path)
        || path == "/healthz"
        || path == "/.well-known/mcp.json"
        || path == "/tools"
        || path == "/login"
        || path == "/logout"
        || path == "/_bus"
        || path == "/"
        || path == "/index.html"
        || path.starts_with("/assets/")
        || matches!(
            path.as_str(),
            "/api/auth/state"
                | "/api/auth/login"
                | "/api/auth/logout"
                | "/api/auth/bootstrap"
                | "/api/auth/reset"
                | "/api/auth/verify"
                | "/app.css"
                | "/app.js"
                | "/login.css"
                | "/favicon.ico"
        )
    {
        return next.run(req).await;
    }

    // The realtime stream carries note paths and actor names: it needs a
    // signed-in browser, and the upgrade must come from our own origin
    // (cross-site WebSocket hijacking sends the cookie along).
    if path == "/ws" {
        if session_of(&st, req.headers()).is_none() {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "not authenticated", "authenticated": false})),
            )
                .into_response();
        }
        if !origin_ok(req.headers()) {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "origin mismatch"})),
            )
                .into_response();
        }
        return next.run(req).await;
    }

    // Browser session from the cookie: when valid, refresh the sliding TTL and continue.
    if let Some(sess) = session_of(&st, req.headers()) {
        tracing::debug!(user = %sess.user, path = %path, "browser session");
        return next.run(req).await;
    }

    // Auth UI endpoints reached here have no valid session. Answer with a plain
    // 401 so the client routes to sign-in; the API-key message below is meant
    // for agents and only confuses a browser.
    if path.starts_with("/api/auth/") {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "not authenticated", "authenticated": false})),
        )
            .into_response();
    }

    // Everything else (/api and /mcp) requires an API key.
    if path.starts_with("/api/") || path.starts_with("/mcp") {
        let Some(key) = extract_key(req.headers()) else {
            let mut resp = (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error":"API key required: Authorization: Bearer <key> or X-API-Key: <key>"})),
            )
                .into_response();
            // MCP clients that speak OAuth (Claude, ChatGPT) start sign-in from here.
            if path.starts_with("/mcp") {
                resp.headers_mut().insert(
                    header::WWW_AUTHENTICATE,
                    oauth::mcp_challenge(req.headers()),
                );
            }
            return resp;
        };
        match cache::find_key(&st, &key) {
            Some(k) => {
                let id = k.id.clone();
                let caller = ApiKeyCaller {
                    id: id.clone(),
                    name: k.name.clone(),
                    perms: cache::perms_of(&k),
                    ip: String::new(),
                };
                // Per-key usage (buffered; written every 30 s).
                let ip = client_ip(&req, Some(peer));
                {
                    let mut usage = cache::lock(&st.usage);
                    let new_ip = st
                        .db
                        .read(|c| memora_state::usage::is_new_ip_buffered(c, &usage, &id, &ip))
                        .unwrap_or(false);
                    if new_ip {
                        tracing::warn!(key_id = %id, ip = %ip, "API key used from a new IP address");
                    }
                    usage.record(&id, Some(ip.clone()), &path, None, memora_state::now());
                }
                // Scope gate: the key must carry the scope this route needs.
                if let Some(scope) = required_scope(req.method(), &path) {
                    if !caller.perms.has_scope(scope) {
                        return (
                            StatusCode::FORBIDDEN,
                            Json(json!({
                                "error": format!("API key lacks the '{scope}' scope"),
                                "required_scope": scope,
                            })),
                        )
                            .into_response();
                    }
                }
                req.extensions_mut().insert(ApiKeyCaller { ip, ..caller });
            }
            None => {
                let ip = client_ip(&req, Some(peer));
                memora_state::activity::log_activity(&st.db, "key_fail", Some(&ip), None, &path);
                if let Ok(ip) = ip.parse() {
                    if let Some(wait) = st.guard.fail(&guard::ip_key(&ip)) {
                        return guard::too_many(wait, true);
                    }
                }
                let mut resp = (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({"error":"invalid API key"})),
                )
                    .into_response();
                // A revoked or rolled OAuth token: tell the client to sign in again.
                if path.starts_with("/mcp") {
                    resp.headers_mut().insert(
                        header::WWW_AUTHENTICATE,
                        oauth::mcp_challenge(req.headers()),
                    );
                }
                return resp;
            }
        }
    }

    next.run(req).await
}

/// Whether a path needs the vault. Account, settings, keys, the access stack
/// and the UI work without one; notes, the graph, logs and MCP do not.
fn needs_vault(path: &str) -> bool {
    if path == "/mcp" || path.starts_with("/mcp/") {
        return true;
    }
    let Some(rest) = path.strip_prefix("/api/") else {
        return false;
    };
    let free = rest.starts_with("auth/")
        || rest == "settings"
        || rest.starts_with("settings/")
        || rest == "config"
        || rest == "keys"
        || rest.starts_with("keys/")
        || rest == "tools"
        || rest.starts_with("tools/")
        || rest == "access"
        || rest.starts_with("access/")
        || rest.starts_with("ui/")
        || rest.starts_with("oauth/")
        || rest == "logs/settings";
    !free
}

/// Vault gate: until a vault folder is configured, every vault route answers
/// `409 {"needs_vault":true}` so the UI can show the vault chooser.
async fn mw_vault(State(st): State<AppState>, req: Request, next: Next) -> Response {
    if needs_vault(req.uri().path()) && st.vault_path().is_none() {
        return (
            StatusCode::CONFLICT,
            Json(json!({"error": "vault not configured", "needs_vault": true})),
        )
            .into_response();
    }
    next.run(req).await
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/// `/healthz`. Anyone gets `{ok, server}`; the vault path, version and window
/// state are only shown to a signed-in browser or a caller on this machine, so
/// an outside prober learns nothing about the install.
async fn h_health(State(st): State<AppState>, headers: HeaderMap) -> Json<Value> {
    let local = guard::header_ip(&headers).is_some_and(|ip| ip.is_loopback());
    if !local && session_of(&st, &headers).is_none() {
        return Json(json!({"ok": true, "server": "memora"}));
    }
    // Where agents reach this server (MEMORA_BASE_URL, else this request's host).
    let public = oauth::base_url(&headers);
    let s = cache::arm_window(&st);
    let vault = st.vault_path();
    Json(json!({
        "ok": true,
        "server": "memora",
        "version": SERVER_VERSION,
        "vault_configured": vault.is_some(),
        "vault": vault,
        "armed": s.status == ArmStatus::Armed,
        "locked": s.status == ArmStatus::Locked,
        "base_url": public,
        "base_url_configured": oauth::configured_base().is_some(),
    }))
}

async fn h_discovery(State(st): State<AppState>) -> Json<Value> {
    Json(discovery_card("/mcp", &st.mcp.disabled_tools()))
}

/// `/tools`: the app shell for a signed-in browser (the UI's Tools page is a
/// client-side route), the public HTML tool catalog for everyone else.
async fn h_tools(State(st): State<AppState>, headers: HeaderMap) -> Response {
    if session_of(&st, &headers).is_some() {
        return h_index(State(st), headers).await;
    }
    h_tools_catalog(&st).into_response()
}

fn h_tools_catalog(st: &AppState) -> Html<String> {
    Html(format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Tool catalog</title>\
         <style>body{{font:14px/1.6 system-ui;max-width:900px;margin:40px auto;padding:0 16px;\
         background:#0f1115;color:#e6e9ef}}h1{{font-size:22px}}h2{{font-size:15px;color:#8ea1c0;\
         margin-top:28px;text-transform:uppercase;letter-spacing:.06em}}code{{background:#1b1f28;\
         padding:2px 6px;border-radius:4px;color:#7dd3fc}}em{{color:#93a4bd}}</style></head>\
         <body><h1>Memora MCP Tool Catalog</h1><p>{} tools. Endpoint: <code>/mcp</code></p>{}</body></html>",
        memora_mcp::catalog().len(),
        markdown_to_simple_html(&memora_mcp::catalog_markdown(&st.mcp.disabled_tools()))
    ))
}

/// Render catalog markdown as simple HTML (h1/h2/h3/p/em/code).
fn markdown_to_simple_html(md: &str) -> String {
    let mut out = String::new();
    for line in md.lines() {
        if let Some(r) = line.strip_prefix("### ") {
            out.push_str(&format!("<h3>{}</h3>", esc(r)));
        } else if let Some(r) = line.strip_prefix("## ") {
            out.push_str(&format!("<h2>{}</h2>", esc(r)));
        } else if let Some(r) = line.strip_prefix("# ") {
            out.push_str(&format!("<h1>{}</h1>", esc(r)));
        } else if line.starts_with('_') && line.ends_with('_') && line.len() > 2 {
            out.push_str(&format!("<em>{}</em>", esc(&line[1..line.len() - 1])));
        } else if !line.trim().is_empty() {
            out.push_str(&format!("<p>{}</p>", inline_code(&esc(line))));
        }
    }
    out
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn inline_code(s: &str) -> String {
    let mut out = String::new();
    let mut parts = s.split('`');
    if let Some(first) = parts.next() {
        out.push_str(first);
    }
    let mut on = true;
    for p in parts {
        if on {
            out.push_str(&format!("<code>{p}</code>"));
        } else {
            out.push_str(p);
        }
        on = !on;
    }
    out
}

/// `/mcp` - MCP streamable HTTP: accepts JSON-RPC and replies with JSON-RPC.
async fn h_mcp(
    State(st): State<AppState>,
    key: Option<axum::Extension<ApiKeyCaller>>,
    method: axum::http::Method,
    headers: HeaderMap,
    body: String,
) -> Response {
    // Streamable HTTP: requests are POSTed; there is no server-initiated stream
    // (GET) and no session to end (DELETE).
    if method != axum::http::Method::POST {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            [(header::ALLOW, "POST")],
            Json(json!({"error": "use POST for MCP requests"})),
        )
            .into_response();
    }
    // A browser session may reach /mcp (its tools write notes), so it gets the
    // same CSRF check as the JSON API; API-key clients send no cookie.
    if !origin_ok(&headers) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error": "origin mismatch"})),
        )
            .into_response();
    }
    let parsed: Result<Value, _> = serde_json::from_str(&body);
    let Ok(json_body) = parsed else {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}),
            ),
        )
            .into_response();
    };

    let hdrs: Vec<(String, String)> = headers
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let kind = detect_client("/mcp", &hdrs, Some(&json_body));
    tracing::info!(client = ?kind, "MCP request");

    let req: RpcRequest = match serde_json::from_value(json_body) {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":format!("invalid request: {e}")}})),
            )
                .into_response();
        }
    };

    // API keys get their own permissions; a browser session has full access.
    let caller = match key {
        Some(axum::Extension(k)) => {
            memora_mcp::Caller::key(k.id, k.perms, Some(k.ip)).named(k.name)
        }
        None => {
            let user = session_of(&st, &headers)
                .map(|s| s.user)
                .unwrap_or_else(|| "owner".to_string());
            let mut c = memora_mcp::Caller::full(user);
            c.ip = guard::header_ip(&headers).map(|ip| ip.to_string());
            c
        }
    };
    // Notifications (no id) get no JSON-RPC answer, just 202 Accepted.
    if req.id.is_none() && req.method.starts_with("notifications/") {
        return StatusCode::ACCEPTED.into_response();
    }
    let resp = st.mcp.handle_as(&req, &caller);
    // A key changed its own color: the key cache feeds /api/keys.
    if req.method == "tools/call"
        && req.params.get("name").and_then(|v| v.as_str()) == Some("set_my_color")
    {
        cache::reload(&st, memora_state::Domain::Keys);
    }
    Json(serde_json::to_value(resp).unwrap()).into_response()
}

/// `/api/stats` - note, link and folder counts for the web UI.
async fn h_stats(
    State(st): State<AppState>,
    key: Option<axum::Extension<ApiKeyCaller>>,
) -> Json<Value> {
    let s = store_as(&st, key.as_deref()).stats();
    Json(json!({"notes": s.notes, "links": s.links, "folders": s.folders}))
}

async fn h_graph(
    State(st): State<AppState>,
    key: Option<axum::Extension<ApiKeyCaller>>,
) -> Json<Value> {
    let g = store_as(&st, key.as_deref()).graph();
    Json(json!({"nodes": g.nodes, "links": g.links}))
}

async fn h_tree(
    State(st): State<AppState>,
    key: Option<axum::Extension<ApiKeyCaller>>,
) -> Json<Value> {
    let t = store_as(&st, key.as_deref()).tree();
    Json(serde_json::to_value(t).unwrap())
}

async fn h_search(State(st): State<AppState>, req: Request) -> Json<Value> {
    let key = req.extensions().get::<ApiKeyCaller>().cloned();
    let q = req
        .uri()
        .query()
        .and_then(|qs| {
            qs.split('&')
                .find_map(|kv| kv.strip_prefix("q=").map(percent_decode))
        })
        .unwrap_or_default();
    let hits = store_as(&st, key.as_ref()).search(&q, 20);
    Json(json!({"q": q, "count": hits.len(), "hits": hits}))
}

/// `/api/access` - inspect the access stack.
async fn h_access_get(State(st): State<AppState>) -> Json<Value> {
    let stack = rd(&st.cache.access);
    Json(json!({
        "default_allow": stack.default_allow,
        "rules": stack.rules,
        "count": stack.rules.len()
    }))
}

async fn h_access_test(State(st): State<AppState>, body: String) -> Json<Value> {
    let v: Value = serde_json::from_str(&body).unwrap_or(json!({}));
    let ip = v.get("ip").and_then(|x| x.as_str());
    let domain = v.get("domain").and_then(|x| x.as_str());
    let stack = rd(&st.cache.access);
    let action = stack.evaluate(ip, domain);
    let lockout = ip.map(|i| stack.would_lock_out(i)).unwrap_or(false);
    Json(json!({"action": action, "would_lock_out_caller": lockout}))
}

/// `/api/keys` - list API keys with their tracked activity.
async fn h_keys(State(st): State<AppState>) -> Json<Value> {
    /// Recent events per key shown as `used_tools`.
    const RECENT: usize = 200;
    let keys = rd(&st.cache.keys).clone();
    let stored = st.db.read(|c| {
        let usage = memora_state::usage::all_usage(c)?;
        let mut events = std::collections::BTreeMap::new();
        for k in &keys {
            events.insert(
                k.id.clone(),
                memora_state::usage::events_for_key(c, &k.id, RECENT)?,
            );
        }
        Ok((usage, events))
    });
    let (usage, mut events) = stored.unwrap_or_else(|e| {
        tracing::error!("could not read key usage: {e}");
        Default::default()
    });
    let sealed = st
        .db
        .read(memora_state::keys::sealed_ids)
        .unwrap_or_default();
    let pending = cache::lock(&st.usage);
    let out: Vec<Value> = keys
        .iter()
        .map(|k| {
            let db_use = usage.get(&k.id);
            let buf_use = pending.pending_usage.get(&k.id);
            let uses = db_use.map_or(0, |u| u.use_count) + buf_use.map_or(0, |u| u.use_count);
            let last_ip = buf_use
                .and_then(|u| u.last_ip.clone())
                .or_else(|| db_use.and_then(|u| u.last_ip.clone()));
            // Oldest first.
            let mut used: Vec<String> = events
                .remove(&k.id)
                .unwrap_or_default()
                .into_iter()
                .rev()
                .map(|e| e.tool)
                .collect();
            used.extend(
                pending
                    .pending_events
                    .iter()
                    .filter(|e| e.key_id == k.id)
                    .map(|e| e.tool.clone()),
            );
            json!({
                "id": k.id, "name": k.name, "enabled": k.enabled,
                "scopes": cache::scope_names(&k.scopes),
                "tools": cache::grant_from_db(&k.tools).to_value(),
                "prefix": k.prefix, "created": k.created_at, "color": k.color,
                // The secret can be shown again on the Agents page.
                "revealable": sealed.contains(&k.id),
                "uses": uses, "last_ip": last_ip,
                // Routes / tools this key used recently.
                "used_tools": used,
            })
        })
        .collect();
    Json(json!({"count": out.len(), "keys": out}))
}

/// `GET /api/aliases` -> `{aliases:[{alias,key_id,key_name,first_seen,last_seen,
/// connections,actor,actor_kind}]}`: one record per API key that opened an MCP
/// connection. `key_name` / `actor` are the key's current name (fallback: the name
/// at connect time, then the key id).
async fn h_aliases(State(st): State<AppState>) -> Json<Value> {
    let keys = cache::rd(&st.cache.keys).clone();
    let list: Vec<Value> = st
        .mcp
        .aliases()
        .into_iter()
        .map(|r| {
            let name = api::key_name(&keys, &r.key_id).or_else(|| r.key_name.clone());
            let actor = name.clone().unwrap_or_else(|| r.key_id.clone());
            let mut v = serde_json::to_value(&r).unwrap_or_else(|_| json!({}));
            v["key_name"] = json!(name);
            v["actor"] = json!(actor);
            v["actor_kind"] = json!("agent");
            v
        })
        .collect();
    Json(json!({"aliases": list}))
}

/// `/login` - login page rendered from the UI assets (`login.html`).
///
/// Design note: while the instance is LOCKED the login page is the terminal
/// destination. It must not redirect to `/`, because `/` redirects back to
/// `/login`, which would form a redirect loop. Only a caller that already has a
/// session on an unlocked instance is sent on to `/`.
///
/// When the assets are not installed it falls back to a minimal status page so
/// an operator can still see why the instance is locked.
async fn h_login_page(
    State(st): State<AppState>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    let s = cache::arm_window(&st);
    let locked = s.status == ArmStatus::Locked;
    let signed_in = session_of(&st, &headers).is_some();
    // An app connecting over OAuth: the page shows its consent card even when signed in.
    let oauth = query_value(&uri, "oauth").is_some();
    if signed_in && !locked && !oauth {
        return redirect("/");
    }
    if let Some(body) = read_asset(&st, "login.html") {
        return html_page(body);
    }
    let status = if locked {
        "LOCKED - run `memora-cli unlock` or `memora-cli setup` on the server"
    } else if s.status == ArmStatus::Armed {
        "setup session open - please complete the form"
    } else {
        "closed - run `memora-cli setup` on the server"
    };
    Html(format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Memora</title>\
         <style>body{{font:14px/1.6 system-ui;display:grid;place-items:center;height:100vh;margin:0;\
         background:#0c0d0f;color:#e6e9ef}}div{{text-align:center}}</style></head>\
         <body><div><h1 style=\"font-size:20px;font-weight:600\">Memora</h1>\
         <p style=\"color:#93a4bd\">Status: {status}</p></div></body></html>"
    ))
    .into_response()
}

/// MIME type for a UI asset filename, or `None` when the extension is unknown.
fn asset_type(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()? {
        "html" => Some("text/html; charset=utf-8"),
        "css" => Some("text/css; charset=utf-8"),
        "js" => Some("application/javascript; charset=utf-8"),
        "json" => Some("application/json; charset=utf-8"),
        "webmanifest" => Some("application/manifest+json; charset=utf-8"),
        "txt" => Some("text/plain; charset=utf-8"),
        "svg" => Some("image/svg+xml"),
        "ico" => Some("image/x-icon"),
        "png" => Some("image/png"),
        "woff2" => Some("font/woff2"),
        _ => None,
    }
}

/// Whether an asset name may be served (explicit whitelist).
///
/// Covers the PWA files (manifest, service worker, icons, offline page) and
/// `robots.txt`. The whitelist is explicit, so no other file in the asset
/// directory can be read from outside.
fn asset_allowed(name: &str) -> bool {
    matches!(
        name,
        "index.html"
            | "app.css"
            | "app.js"
            | "login.html"
            | "login.css"
            | "offline.html"
            | "favicon.ico"
            | "favicon.svg"
            | "manifest.webmanifest"
            | "sw.js"
            | "robots.txt"
            | "icon-192.png"
            | "icon-512.png"
            | "icon-maskable-512.png"
            | "apple-touch-icon.png"
            | "shortcut-brain.png"
            | "shortcut-nodes.png"
            | "shortcut-activity.png"
    )
}

/// Read an asset as raw bytes.
///
/// PWA assets include PNG icons, which are not valid UTF-8. Every asset goes
/// through this path so HTML, CSS, JS and PNG are all returned intact.
fn read_asset(st: &AppState, name: &str) -> Option<Vec<u8>> {
    if !asset_allowed(name) {
        return None;
    }
    std::fs::read(std::path::Path::new(&st.assets).join(name)).ok()
}

/// `/logout` - revoke the session cookie and return to the login page.
async fn h_logout(State(st): State<AppState>, headers: HeaderMap) -> Response {
    // A cross-site page must not be able to sign the owner out (logout CSRF
    // via a top-level link); the cookie is still cleared in that browser only.
    if cross_site_fetch(&headers) {
        return logout_response();
    }
    if let Some(sid) = cookie_value(&headers, cache::SESSION_COOKIE) {
        let hash = cache::sid_hash(&sid);
        if let Err(e) = st.db.write(|tx| memora_state::session::revoke(tx, &hash)) {
            tracing::error!("could not end the session: {e}");
        }
    }
    logout_response()
}

/// 302 redirect helper.
fn redirect(to: &str) -> Response {
    (
        StatusCode::FOUND,
        [(header::LOCATION, to.to_string())],
        String::new(),
    )
        .into_response()
}

/// `/` - the vault UI. Requires a session (or an API key); otherwise the caller
/// is redirected to `/login`.
///
/// Design note: keep this redirect one-way. While LOCKED, `/login` is the
/// terminal destination, so `/` must not bounce back and forth with it.
async fn h_index(State(st): State<AppState>, headers: HeaderMap) -> Response {
    if session_of(&st, &headers).is_none() {
        return redirect("/login");
    }
    match read_asset(&st, "index.html") {
        // The shell references the bundle, so it must never be cached
        // (html_page sets no-store).
        Some(body) => html_page(body),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Html(
                "<!doctype html><meta charset=utf-8><body style=\"font:15px system-ui;padding:32px;\
                 background:#0b0e14;color:#e6e9ef\"><h1>UI assets not installed</h1>\
                 <p>Place <code>index.html</code>, <code>app.css</code>, <code>app.js</code> in the \
                 asset directory (env <code>MEMORA_ASSETS</code>).</p></body>",
            ),
        )
            .into_response(),
    }
}

/// Whether a request path (raw or percent-decoded) holds NUL or another control
/// character; such deep links are refused with 400.
fn has_control_chars(path: &str) -> bool {
    path.chars().any(char::is_control)
        || percent_decode(&path.replace('+', "%2B"))
            .chars()
            .any(char::is_control)
}

/// Client-side routes of the web app (`/brain`, `/graph`, `/node/<path>`, ...): the
/// same app shell as `/`, behind the same session gate (no session: 302 `/login`).
/// The path is only checked for control characters; it is never used to read a
/// file (the vault path in `/node/...` is resolved by the browser through the API).
async fn h_app_route(
    State(st): State<AppState>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    if has_control_chars(uri.path()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "invalid path"})),
        )
            .into_response();
    }
    // Signed out: sign in, then come back here (`/login?r=<this path>`).
    if session_of(&st, &headers).is_none() {
        return redirect(&login_return(&uri));
    }
    h_index(State(st), headers).await
}

/// `/login?r=<path and query>` for a page the browser asked for, or plain
/// `/login` when the path is not a clean local one. The value is fully
/// percent-encoded; the login page checks it again before following it.
fn login_return(uri: &axum::http::Uri) -> String {
    let path = uri.path();
    let ok = path.starts_with('/')
        && !path.starts_with("//")
        && !path.contains('\\')
        && path.len() <= 1024
        && path != "/"
        && path != "/login"
        && path != "/logout";
    if !ok {
        return "/login".to_string();
    }
    let full = match uri.query() {
        Some(q) if q.len() <= 1024 => format!("{path}?{q}"),
        _ => path.to_string(),
    };
    let mut enc = String::with_capacity(full.len() * 3);
    for b in full.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'/') {
            enc.push(b as char);
        } else {
            enc.push_str(&format!("%{b:02X}"));
        }
    }
    format!("/login?r={enc}")
}

/// Serve a generated HTML page (login.html, index.html, offline.html) with a
/// per-response CSP nonce: every inline `<script>` the build emits gets the
/// nonce, so the policy can forbid any other inline or injected script.
fn html_page(body: Vec<u8>) -> Response {
    let nonce = csp_nonce();
    let html = String::from_utf8_lossy(&body)
        .replace("<script>", &format!("<script nonce=\"{nonce}\">"))
        .replace("<script src=", &format!("<script nonce=\"{nonce}\" src="));
    let mut res = (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
        ],
        html,
    )
        .into_response();
    if let Ok(v) = header::HeaderValue::from_str(&page_csp(&nonce)) {
        res.headers_mut().insert(header::CONTENT_SECURITY_POLICY, v);
    }
    res
}

/// 128-bit random nonce (hex) for one HTML response.
fn csp_nonce() -> String {
    let k = memora_gateway::generate_key();
    k.rsplit('_').next().unwrap_or(&k).to_string()
}

/// sha256 of the one inline handler the offline page uses
/// (`onclick="location.reload()"`), allowed by hash rather than unsafe-inline.
const OFFLINE_RELOAD_HASH: &str = "sha256-9gOBGqEQINNDuds+tkXbNzih6klbz+KeCyxEj4KRLeM=";

/// CSP for the app and login pages. Styles stay `'unsafe-inline'` (the pages
/// and the UI set `style=` attributes); scripts need the nonce or same origin.
fn page_csp(nonce: &str) -> String {
    format!(
        "default-src 'self'; script-src 'self' 'nonce-{nonce}' 'unsafe-hashes' '{OFFLINE_RELOAD_HASH}'; style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; \
         manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; \
         form-action 'self'; frame-ancestors 'none'"
    )
}

/// CSP for every other response (JSON, plain text, the small fallback pages):
/// nothing may load except inline styles of the fallback pages.
const DEFAULT_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; \
     base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

async fn h_asset(
    State(st): State<AppState>,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Response {
    let Some(ct) = asset_type(&name) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    match read_asset(&st, &name) {
        Some(body) if name.ends_with(".html") => html_page(body),
        Some(body) => ([(header::CONTENT_TYPE, ct)], body).into_response(),
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

/// Read a single cookie from the `Cookie` header.
pub fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in raw.split(';') {
        let p = part.trim();
        if let Some(v) = p.strip_prefix(&format!("{name}=")) {
            let v = v.trim_matches('"');
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Helpers shared with the `api` module
// ---------------------------------------------------------------------------

/// Redirect to the login page and clear the session cookie. Callers revoke the
/// server-side session themselves.
pub(crate) fn logout_response() -> Response {
    (
        StatusCode::FOUND,
        [
            (header::LOCATION, "/login".to_string()),
            (header::SET_COOKIE, clear_cookie_header()),
        ],
        String::new(),
    )
        .into_response()
}

/// `Set-Cookie` header for a new session. HttpOnly + SameSite=Lax.
///
/// `Secure` is added when the request arrived over HTTPS (X-Forwarded-Proto),
/// so the cookie survives behind a TLS-terminating proxy.
pub(crate) fn session_cookie_header(sid: &str, ttl: i64, https: bool) -> String {
    let secure = if https { "; Secure" } else { "" };
    format!(
        "{}={sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age={ttl}{secure}",
        cache::SESSION_COOKIE
    )
}

/// `Set-Cookie` header that clears the session (logout).
pub(crate) fn clear_cookie_header() -> String {
    format!(
        "{}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        cache::SESSION_COOKIE
    )
}

/// Whether the request arrived over HTTPS (drives the cookie `Secure` flag).
pub(crate) fn is_https(headers: &HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("https"))
        .unwrap_or(false)
}

/// Whether `url` (an `Origin` or `Referer` value) names the same host:port as
/// the request's `Host`. `null`, opaque and malformed origins never match.
fn same_host(url: &str, host: &str) -> bool {
    let s = url.trim();
    let Some((scheme, rest)) = s.split_once("://") else {
        return false;
    };
    if !matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https") {
        return false;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // Userinfo (`https://host@evil`) is never part of a real Origin.
    if authority.is_empty() || authority.contains('@') {
        return false;
    }
    authority.eq_ignore_ascii_case(host.trim())
}

/// `Sec-Fetch-Site: cross-site` is sent by every current browser and cannot be
/// set by page script.
fn cross_site_fetch(headers: &HeaderMap) -> bool {
    headers
        .get("sec-fetch-site")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("cross-site"))
}

/// Same-origin test on `Origin` (or, without it, `Referer`) against `Host`.
/// `None` when the request carries neither header.
fn origin_matches(headers: &HeaderMap) -> Option<bool> {
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let pick = |name| {
        headers
            .get(name)
            .and_then(|v: &header::HeaderValue| v.to_str().ok())
    };
    let given = pick(header::ORIGIN).or_else(|| pick(header::REFERER))?;
    // `X-Forwarded-Host` only survives mw_guard when a trusted proxy sent it
    // (a proxy that rewrites `Host` to the upstream address).
    let fwd = headers
        .get("x-forwarded-host")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .unwrap_or("");
    Some(
        (!host.is_empty() && same_host(given, host))
            || (!fwd.trim().is_empty() && same_host(given, fwd)),
    )
}

/// CSRF guard for cookie-authenticated writes: when a session cookie is present,
/// `Origin`/`Referer` must be same-origin with `Host` (a missing pair fails).
/// Without a cookie the check passes, because a browser cannot forge an
/// API-key request on its own.
pub(crate) fn origin_ok(headers: &HeaderMap) -> bool {
    if cookie_value(headers, cache::SESSION_COOKIE).is_none() {
        return true;
    }
    if cross_site_fetch(headers) {
        return false;
    }
    origin_matches(headers) == Some(true)
}

/// CSRF guard for the public auth forms (login, code check, setup, reset),
/// which run before any cookie exists (login CSRF). A browser always sends
/// `Origin` on these POSTs, so a foreign or `null` Origin is refused; a
/// request with neither header (curl, the CLI) passes, since it cannot carry
/// a victim's browser state.
pub(crate) fn origin_ok_public(headers: &HeaderMap) -> bool {
    if cross_site_fetch(headers) {
        return false;
    }
    origin_matches(headers) != Some(false) && origin_ok(headers)
}

/// Read `key` from the query string (`?key=X`), URL-decoded.
pub(crate) fn query_value(uri: &axum::http::Uri, key: &str) -> Option<String> {
    let q = uri.query()?;
    for pair in q.split('&') {
        let (k, v) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        if k == key {
            return Some(percent_decode(v));
        }
    }
    None
}

/// Decode percent escapes (`%20`) and `+` into spaces.
pub(crate) fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            // Two hex digits exactly (`from_str_radix` alone would also take `%+5`).
            b'%' if i + 2 < b.len()
                && b[i + 1].is_ascii_hexdigit()
                && b[i + 2].is_ascii_hexdigit() =>
            {
                let hex = std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("0");
                out.push(u8::from_str_radix(hex, 16).unwrap_or(b'%'));
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Middleware: forbid search-engine indexing on every response.
///
/// The vault UI is private, so the header is sent unconditionally rather than
/// relying on the page's meta tags alone.
async fn mw_noindex(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    res.headers_mut().insert(
        header::HeaderName::from_static("x-robots-tag"),
        header::HeaderValue::from_static("noindex, nofollow, noarchive, nosnippet, noimageindex"),
    );
    res
}

/// Middleware: attach the security headers every response should carry.
///
/// Installed as the outermost layer, so 404s from the host allow-list, 429s
/// from the guard, 403s from the access stack, 401/423/redirects from the auth
/// gate and the 408 timeout all carry them too.
async fn mw_security_headers(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    // HTTPS only counts when the connection came through a trusted proxy that
    // says so; this server itself speaks plain HTTP.
    let https = st.guard.trusted_peer(peer) && is_https(req.headers());
    let path = req.uri().path().to_string();
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    if !h.contains_key(header::CONTENT_SECURITY_POLICY) {
        h.insert(
            header::CONTENT_SECURITY_POLICY,
            header::HeaderValue::from_static(DEFAULT_CSP),
        );
    }
    h.insert(
        header::HeaderName::from_static("permissions-policy"),
        header::HeaderValue::from_static(
            "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
        ),
    );
    h.insert(
        header::HeaderName::from_static("cross-origin-opener-policy"),
        header::HeaderValue::from_static("same-origin"),
    );
    h.insert(
        header::HeaderName::from_static("cross-origin-resource-policy"),
        header::HeaderValue::from_static("same-origin"),
    );
    if https {
        h.insert(
            header::STRICT_TRANSPORT_SECURITY,
            header::HeaderValue::from_static("max-age=31536000"),
        );
    }
    // Auth, settings and every other JSON answer are private and per-user.
    if (path.starts_with("/api/")
        || path == "/healthz"
        || path == "/login"
        || path == "/logout"
        || path == "/mcp")
        && !h.contains_key(header::CACHE_CONTROL)
    {
        h.insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-store"),
        );
    }
    h.insert(
        header::HeaderName::from_static("x-content-type-options"),
        header::HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::HeaderName::from_static("x-frame-options"),
        header::HeaderValue::from_static("DENY"),
    );
    h.insert(
        header::HeaderName::from_static("referrer-policy"),
        header::HeaderValue::from_static("no-referrer"),
    );
    res
}

/// Fallback handler for unmatched routes.
/// No route: a page the browser navigates to (GET, wants HTML, not an API or
/// file path) gets the app, which shows its "page not found" view; anything
/// else gets a JSON 404.
async fn h_notfound(
    State(st): State<AppState>,
    method: axum::http::Method,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    let path = uri.path();
    let page = method == axum::http::Method::GET
        && headers
            .get(header::ACCEPT)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|a| a.contains("text/html"))
        && !path.starts_with("/api/")
        && !path.starts_with("/mcp")
        && !path.starts_with("/oauth")
        && !path.starts_with("/.well-known")
        && !path.rsplit('/').next().unwrap_or("").contains('.');
    if page {
        return h_app_route(State(st), uri, headers).await;
    }
    (StatusCode::NOT_FOUND, Json(json!({"error":"not found"}))).into_response()
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn build_router(st: AppState) -> Router {
    Router::new()
        .route("/healthz", get(h_health))
        .route("/.well-known/mcp.json", get(h_discovery))
        .route("/tools", get(h_tools))
        .route("/mcp", any(h_mcp))
        // Web UI: static login page plus the vault UI
        .route("/login", get(h_login_page))
        .route("/logout", any(h_logout))
        .route("/", get(h_index))
        .route("/index.html", get(h_index))
        // Client-side routes (History API): the app shell, nothing else.
        .route("/brain", get(h_app_route))
        .route("/nodes", get(h_app_route))
        .route("/graph", get(h_app_route))
        .route("/canvas", get(h_app_route))
        .route("/tags", get(h_app_route))
        .route("/activity", get(h_app_route))
        .route("/agents", get(h_app_route))
        .route("/access", get(h_app_route))
        .route("/settings", get(h_app_route))
        .route("/overview", get(h_app_route))
        .route("/welcome", get(h_app_route))
        // Older page names the web app still understands.
        .route("/home", get(h_app_route))
        .route("/vault", get(h_app_route))
        .route("/logs", get(h_app_route))
        .route("/keys", get(h_app_route))
        .route("/node/", get(h_app_route))
        .route("/node/{*vault_path}", get(h_app_route))
        .route("/assets/{name}", get(h_asset))
        .route("/app.css", get(h_asset_root))
        .route("/app.js", get(h_asset_root))
        .route("/login.css", get(h_asset_root))
        .route("/favicon.ico", get(h_favicon))
        .route("/favicon.svg", get(h_asset_root))
        // PWA files: manifest, service worker, icons, offline page, robots.txt
        .route("/manifest.webmanifest", get(h_asset_root))
        .route("/sw.js", get(h_asset_root))
        .route("/robots.txt", get(h_asset_root))
        .route("/icon-192.png", get(h_asset_root))
        .route("/icon-512.png", get(h_asset_root))
        .route("/icon-maskable-512.png", get(h_asset_root))
        .route("/apple-touch-icon.png", get(h_asset_root))
        .route("/offline.html", get(h_asset_root))
        // Realtime: one WebSocket channel plus the event intake bus, both on this port
        .route("/ws", get(h_ws))
        .route("/_bus", post(h_bus))
        .route("/api/stats", get(h_stats))
        .route("/api/graph", get(h_graph))
        .route("/api/tree", get(h_tree))
        .route("/api/search", get(h_search))
        .route("/api/access", get(h_access_get))
        .route("/api/access/test", post(h_access_test))
        .route("/api/keys", get(h_keys))
        .route("/api/aliases", get(h_aliases))
        .merge(api::api_router())
        .merge(privacy::router())
        .merge(oauth::router())
        .fallback(h_notfound)
        .layer(middleware::from_fn_with_state(st.clone(), mw_vault))
        .layer(middleware::from_fn_with_state(st.clone(), mw_auth))
        .layer(middleware::from_fn_with_state(st.clone(), mw_access))
        .layer(middleware::from_fn_with_state(st.clone(), mw_guard))
        .layer(tower_http::timeout::TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            std::time::Duration::from_secs(30),
        ))
        .layer(tower::limit::GlobalConcurrencyLimitLayer::new(1024))
        // Outermost: every response, including ones the layers above produce
        // on their own (404 host, 429, 403, 401, 423, 408), gets these headers.
        .layer(middleware::from_fn(mw_noindex))
        .layer(middleware::from_fn_with_state(
            st.clone(),
            mw_security_headers,
        ))
        .with_state(st)
}

/// Serve root-level assets (`/app.css`, `/app.js`, `/login.css`, ...).
async fn h_asset_root(State(st): State<AppState>, req: Request) -> Response {
    let name = req.uri().path().trim_start_matches('/').to_string();
    let Some(ct) = asset_type(&name) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    if name.ends_with(".html") {
        return match read_asset(&st, &name) {
            Some(body) => html_page(body),
            None => (StatusCode::NOT_FOUND, "not found").into_response(),
        };
    }
    if !asset_allowed(&name) {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    // Code is revalidated on every load (ETag, so usually a 304): a cached
    // bundle must never keep serving the previous UI after a redeploy. Only
    // images and the manifest, which change rarely, get a short cache.
    let cacheable = name.ends_with(".png")
        || name.ends_with(".svg")
        || name.ends_with(".ico")
        || name == "manifest.webmanifest";
    let cc = if cacheable {
        "public, max-age=300"
    } else {
        "no-cache"
    };
    assets::serve(
        &std::path::Path::new(&st.assets).join(&name),
        ct,
        cc,
        req.headers(),
    )
}

async fn h_favicon() -> Response {
    (StatusCode::NO_CONTENT, "").into_response()
}

// ---------------------------------------------------------------------------
// Realtime: WS fan-out + intake /_bus
// ---------------------------------------------------------------------------

/// Most concurrent WebSocket clients. The global concurrency limit does not
/// cover upgraded connections (the upgrade request completes immediately), so
/// without this a flood of sockets would each hold a task and a receiver.
const WS_MAX_CLIENTS: usize = 512;
/// Largest inbound WebSocket message. Clients never need to send anything
/// substantial (the server ignores their messages); the axum default is 64 MiB.
const WS_MAX_MESSAGE: usize = 16 * 1024;
/// A send that cannot complete in this time means the client stopped reading.
const WS_SEND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
/// Ping interval; also the cadence of the idle check.
const WS_PING_EVERY: std::time::Duration = std::time::Duration::from_secs(30);
/// Close a client from which nothing (not even a pong) arrived for this long:
/// half-open TCP connections otherwise keep their task alive forever.
const WS_IDLE: std::time::Duration = std::time::Duration::from_secs(75);
/// Largest `/_bus` body.
const BUS_MAX_BODY: usize = 64 * 1024;

/// `GET /ws` - one realtime channel per browser.
///
/// The WebSocket endpoint and the event intake bus share this port, so no
/// second port has to be opened or proxied.
async fn h_ws(ws: WebSocketUpgrade) -> Response {
    if memora_core::events::hub().clients() >= WS_MAX_CLIENTS {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "too many realtime clients"})),
        )
            .into_response();
    }
    ws.max_message_size(WS_MAX_MESSAGE)
        .max_frame_size(WS_MAX_MESSAGE)
        .on_upgrade(ws_session)
}

/// Send one message, giving up after `WS_SEND_TIMEOUT` (slow / stuck reader).
async fn ws_send(socket: &mut WebSocket, msg: Message) -> bool {
    matches!(
        tokio::time::timeout(WS_SEND_TIMEOUT, socket.send(msg)).await,
        Ok(Ok(()))
    )
}

/// Mark a serialized event (always a JSON object) as a replay.
fn ws_mark_replay(ev: &str) -> String {
    match ev.strip_suffix('}') {
        Some(head) if head.len() > 1 => format!("{head},\"replay\":true}}"),
        _ => ev.to_string(),
    }
}

async fn ws_session(mut socket: WebSocket) {
    let hub = memora_core::events::hub();
    let mut rx = hub.subscribe();
    ws_pump(&mut socket, &mut rx).await;
    // Unsubscribe before announcing the new count, so it excludes this client.
    drop(rx);
    let _ = ws_send(&mut socket, Message::Close(None)).await;
    drop(socket);
    // Tell the remaining clients the new client count.
    hub.publish(json!({"type": "presence", "clients": hub.clients()}));
}

async fn ws_pump(socket: &mut WebSocket, rx: &mut broadcast::Receiver<Arc<str>>) {
    let hub = memora_core::events::hub();
    // Greeting followed by a replay of the most recent buffered events.
    let hello = json!({"type": "hello", "clients": hub.clients()});
    if !ws_send(socket, Message::Text(hello.to_string().into())).await {
        return;
    }
    for ev in hub.replay() {
        if !ws_send(socket, Message::Text(ws_mark_replay(&ev).into())).await {
            return;
        }
    }

    let mut ping =
        tokio::time::interval_at(tokio::time::Instant::now() + WS_PING_EVERY, WS_PING_EVERY);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last_heard = tokio::time::Instant::now();
    loop {
        tokio::select! {
            ev = rx.recv() => match ev {
                Ok(v) => {
                    if !ws_send(socket, Message::Text(v.as_ref().into())).await {
                        return;
                    }
                }
                // Client fell behind: skip the missed events instead of disconnecting.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return,
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                Some(Ok(_)) => last_heard = tokio::time::Instant::now(),
            },
            _ = ping.tick() => {
                if last_heard.elapsed() > WS_IDLE {
                    return;
                }
                if !ws_send(socket, Message::Ping(Default::default())).await {
                    return;
                }
            }
        }
    }
}

/// Loopback check that also accepts IPv4-mapped IPv6 loopback (`::ffff:127.0.0.1`).
fn ip_is_loopback(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V6(v6) => v6
            .to_ipv4_mapped()
            .map(|v4| v4.is_loopback())
            .unwrap_or(v6.is_loopback()),
        v4 => v4.is_loopback(),
    }
}

/// `POST /_bus` - local event intake, used by other processes on the same host
/// to inject activity.
///
/// Only loopback callers are accepted, so nothing on the network can forge
/// agent activity. A loopback TCP peer is not enough on its own: a local
/// reverse proxy / tunnel (cloudflared) also connects from loopback, so the
/// caller IP resolved by `mw_guard` from the forwarding headers must be
/// loopback too. The body is capped at `BUS_MAX_BODY`.
async fn h_bus(ConnectInfo(peer): ConnectInfo<SocketAddr>, req: Request) -> Response {
    let resolved = guard::header_ip(req.headers()).unwrap_or(peer.ip());
    let forwarded = [
        "forwarded",
        "x-forwarded-for",
        "x-real-ip",
        "cf-connecting-ip",
    ]
    .iter()
    .any(|h| req.headers().contains_key(*h));
    if !ip_is_loopback(peer.ip()) || !ip_is_loopback(resolved) || forwarded {
        return (StatusCode::FORBIDDEN, Json(json!({"error":"forbidden"}))).into_response();
    }
    let body = match axum::body::to_bytes(req.into_body(), BUS_MAX_BODY).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({"error": format!("body larger than {BUS_MAX_BODY} bytes")})),
            )
                .into_response()
        }
    };
    match serde_json::from_slice::<Value>(&body) {
        Ok(v) if v.is_object() => match memora_core::events::hub().try_publish(v) {
            Ok(()) => Json(json!({"ok": true})).into_response(),
            Err(e) => (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({"error": format!("event rejected: {e:?}")})),
            )
                .into_response(),
        },
        _ => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"body is not a JSON object"})),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod ws_bus_tests {
    use super::{ip_is_loopback, ws_mark_replay};

    #[test]
    fn replay_marker_keeps_valid_json() {
        let v: serde_json::Value =
            serde_json::from_str(&ws_mark_replay(r#"{"type":"x","_ts":1}"#)).unwrap();
        assert_eq!(v["replay"], true);
        assert_eq!(v["type"], "x");
    }

    #[test]
    fn loopback_includes_mapped_v4() {
        assert!(ip_is_loopback("127.0.0.1".parse().unwrap()));
        assert!(ip_is_loopback("::1".parse().unwrap()));
        assert!(ip_is_loopback("::ffff:127.0.0.1".parse().unwrap()));
        assert!(!ip_is_loopback("::ffff:10.0.0.1".parse().unwrap()));
        assert!(!ip_is_loopback("192.168.1.2".parse().unwrap()));
    }
}

pub fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .try_init();
}

#[cfg(test)]
mod front_door_tests {
    use super::*;
    use axum::http::HeaderValue;

    fn hdrs(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn rate_limit_paths_are_canonicalised() {
        for p in [
            "/api/auth/login",
            "/api/auth/login/",
            "//api//auth/login",
            "/API/Auth/Login",
            "/api/auth/%6Cogin",
            "/api/auth%2Flogin",
        ] {
            assert_eq!(canonical_path(p), "/api/auth/login", "{p}");
        }
        assert_eq!(canonical_path("/"), "/");
        assert_eq!(canonical_path("/a+b"), "/a+b");
    }

    #[test]
    fn percent_decode_needs_two_hex_digits() {
        assert_eq!(percent_decode("a%20b+c"), "a b c");
        assert_eq!(percent_decode("%41%4a"), "AJ");
        assert_eq!(percent_decode("%+5x"), "% 5x");
        assert_eq!(percent_decode("%-1"), "%-1");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%4"), "%4");
    }

    #[test]
    fn cookie_csrf_needs_a_same_origin_header() {
        let c = ("cookie", "memora_sess=abc");
        let host = ("host", "memory.example.com");
        assert!(origin_ok(&hdrs(&[
            c,
            host,
            ("origin", "https://memory.example.com")
        ])));
        assert!(origin_ok(&hdrs(&[
            c,
            host,
            ("referer", "https://memory.example.com/x?y")
        ])));
        // Missing, null, foreign, look-alike, userinfo and non-http origins fail.
        assert!(!origin_ok(&hdrs(&[c, host])));
        assert!(!origin_ok(&hdrs(&[c, host, ("origin", "null")])));
        assert!(!origin_ok(&hdrs(&[
            c,
            host,
            ("origin", "https://evil.example")
        ])));
        assert!(!origin_ok(&hdrs(&[
            c,
            host,
            ("origin", "https://memory.example.com.evil.example")
        ])));
        assert!(!origin_ok(&hdrs(&[
            c,
            host,
            ("origin", "https://memory.example.com@evil.example")
        ])));
        assert!(!origin_ok(&hdrs(&[
            c,
            host,
            ("origin", "file://memory.example.com")
        ])));
        assert!(!origin_ok(&hdrs(&[
            c,
            host,
            ("referer", "memory.example.com")
        ])));
        // A matching Origin cannot save a cross-site fetch.
        assert!(!origin_ok(&hdrs(&[
            c,
            host,
            ("origin", "https://memory.example.com"),
            ("sec-fetch-site", "cross-site"),
        ])));
        // A bad Origin is not rescued by a good Referer.
        assert!(!origin_ok(&hdrs(&[
            c,
            host,
            ("origin", "https://evil.example"),
            ("referer", "https://memory.example.com/"),
        ])));
        // No cookie: API-key and CLI callers are not browser-forgeable.
        assert!(origin_ok(&hdrs(&[host])));
    }

    #[test]
    fn public_auth_forms_refuse_foreign_origins() {
        let host = ("host", "memory.example.com:8471");
        assert!(origin_ok_public(&hdrs(&[host])));
        assert!(origin_ok_public(&hdrs(&[
            host,
            ("origin", "http://memory.example.com:8471")
        ])));
        assert!(!origin_ok_public(&hdrs(&[
            host,
            ("origin", "http://memory.example.com")
        ])));
        assert!(!origin_ok_public(&hdrs(&[
            host,
            ("origin", "https://evil.example")
        ])));
        assert!(!origin_ok_public(&hdrs(&[host, ("origin", "null")])));
        assert!(!origin_ok_public(&hdrs(&[
            host,
            ("sec-fetch-site", "cross-site")
        ])));
    }

    #[test]
    fn pages_get_a_nonce_csp() {
        let body = b"<html><script>boot()</script><script src=\"app.js\"></script></html>".to_vec();
        let res = html_page(body);
        let csp = res.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .to_string();
        let nonce = csp
            .split("'nonce-")
            .nth(1)
            .unwrap()
            .split('\'')
            .next()
            .unwrap()
            .to_string();
        assert_eq!(nonce.len(), 32);
        for d in [
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
        ] {
            assert!(csp.contains(d), "{d}");
        }
        assert!(!csp.contains("script-src 'self' 'unsafe-inline'"));
        assert_eq!(
            res.headers()[header::CACHE_CONTROL],
            "no-cache, no-store, must-revalidate"
        );
        assert_ne!(csp_nonce(), csp_nonce());
    }

    #[test]
    fn session_cookie_flags() {
        let c = session_cookie_header("sid", 60, true);
        for f in ["HttpOnly", "SameSite=Lax", "Path=/", "Secure", "Max-Age=60"] {
            assert!(c.contains(f), "{f}");
        }
        assert!(!session_cookie_header("sid", 60, false).contains("Secure"));
        assert!(clear_cookie_header().contains("Max-Age=0"));
    }

    #[test]
    fn host_for_access_rules_handles_ipv6_and_ports() {
        assert_eq!(
            memora_gateway::url_host("[::1]:8471").as_deref(),
            Some("::1")
        );
        assert_eq!(
            memora_gateway::url_host("Memory.Example.com:443").as_deref(),
            Some("memory.example.com")
        );
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn login_return_keeps_only_clean_local_paths() {
        use super::login_return;
        let u = |p: &str| p.parse::<axum::http::Uri>().unwrap();
        assert_eq!(
            login_return(&u("/node/Projects/Launch%20plan")),
            "/login?r=/node/Projects/Launch%2520plan"
        );
        assert_eq!(
            login_return(&u("/brain?mode=graph")),
            "/login?r=/brain%3Fmode%3Dgraph"
        );
        assert_eq!(login_return(&u("/")), "/login");
        assert_eq!(login_return(&u("//evil.example/x")), "/login");
        assert_eq!(login_return(&u("/login")), "/login");
        assert_eq!(login_return(&u("/a%5C..%5Cb")), "/login?r=/a%255C..%255Cb");
    }
    use super::needs_vault;

    #[test]
    fn vault_gate_covers_vault_routes_only() {
        for p in [
            "/mcp",
            "/api/stats",
            "/api/graph",
            "/api/note",
            "/api/vault/file",
            "/api/save",
            "/api/logs",
            "/api/aliases",
        ] {
            assert!(needs_vault(p), "{p} should need the vault");
        }
        for p in [
            "/",
            "/login",
            "/healthz",
            "/ws",
            "/app.js",
            "/api/auth/state",
            "/api/auth/me",
            "/api/settings",
            "/api/settings/vault",
            "/api/config",
            "/api/keys",
            "/api/keys/roll",
            "/api/access",
            "/api/access/test",
            "/api/oauth/request",
            "/api/oauth/clients",
            "/api/logs/settings",
        ] {
            assert!(!needs_vault(p), "{p} should work without a vault");
        }
        assert!(needs_vault("/api/settingsx"));
    }

    #[test]
    fn key_scope_per_route() {
        use super::required_scope;
        use axum::http::Method;
        assert_eq!(required_scope(&Method::POST, "/mcp"), Some("mcp"));
        assert_eq!(required_scope(&Method::GET, "/api/graph"), Some("read"));
        assert_eq!(
            required_scope(&Method::GET, "/api/vault/file"),
            Some("read")
        );
        assert_eq!(
            required_scope(&Method::HEAD, "/api/vault/file"),
            Some("read")
        );
        assert_eq!(
            required_scope(&Method::POST, "/api/vault/file"),
            Some("write")
        );
        assert_eq!(required_scope(&Method::POST, "/api/save"), Some("write"));
        assert_eq!(required_scope(&Method::GET, "/api/tools"), Some("admin"));
        assert_eq!(required_scope(&Method::POST, "/api/tools"), Some("admin"));
        assert_eq!(required_scope(&Method::GET, "/api/keys"), Some("admin"));
        assert_eq!(
            required_scope(&Method::POST, "/api/keys/update"),
            Some("admin")
        );
        assert_eq!(
            required_scope(&Method::POST, "/api/access/rules"),
            Some("admin")
        );
        assert_eq!(required_scope(&Method::GET, "/api/toolsx"), Some("read"));
        assert_eq!(required_scope(&Method::GET, "/healthz"), None);
        assert!(!needs_vault("/api/tools"));
    }
}
