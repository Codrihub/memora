//! Mnemo, the notes agent built into Memora. It talks to a model the owner sets up
//! (OpenAI, Anthropic or one OpenAI-compatible provider, by API key) and looks after the
//! notes with a fixed set of note tools, run through the MCP server under its own name so
//! every action shows in Activity. It has no web, shell, admin or delete-forever tools.
//!
//! Browser session only (API keys are refused). Routes under `/api/assistant/`:
//! `state`, `providers`, `providers/delete`, `models/fetch`, `models`, `models/delete`,
//! `prefs`, `sessions`, `sessions/{id}`, `sessions/{id}/delete`, `sessions/{id}/chat` (SSE).

pub mod docs;
pub mod live;
pub mod mentions;
pub mod providers;
pub mod uploads;

use axum::{
    extract::{Path as UrlPath, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Extension, Router,
};
use memora_gateway::{KeyPermissions, ToolGrant};
use memora_mcp::Caller;
use memora_state::assistant::{NewMessage, Store};
use providers::{Endpoint, Msg, Options, ToolCall, ToolDef};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::sync::OnceLock;
use std::time::Instant;

use crate::api::{bad, csrf_fail, csrf_ok};
use crate::{ApiKeyCaller, AppState};

/// The agent's name, in the UI and in Activity.
pub const NAME: &str = "Mnemo";
const ACTOR_ID: &str = "mnemo";

/// The tools Mnemo may use: reading, searching and looking after notes, folders, tags,
/// links, pins, history and the trash. Nothing that deletes for good, reaches outside the
/// notes or changes the server.
const TOOLS: &[&str] = &[
    "list_memory",
    "read_memory",
    "search_memory",
    "get_stats",
    "query_memory",
    "find_similar",
    "suggest_links",
    "list_tags",
    "get_tags",
    "search_by_tag",
    "list_folders",
    "folder_stats",
    "get_folder_meta",
    "get_neighbors",
    "get_subgraph",
    "find_path",
    "get_hubs",
    "get_isolated",
    "link_stats",
    "broken_links",
    "get_history",
    "get_note_at",
    "diff",
    "list_trash",
    "get_todos",
    "follow_ups",
    "validate_memory",
    "list_pins",
    "list_images",
    "stale_detection",
    "digest",
    "create_memory",
    "save_memory",
    "patch_memory",
    "move_memory",
    "rename_memory",
    "add_tags",
    "remove_tags",
    "set_tags",
    "rename_tag",
    "merge_tag",
    "create_folder",
    "rename_folder",
    "move_folder",
    "set_folder_meta",
    "restore_memory",
    "soft_delete",
    "restore_trash",
    "batch_create",
    "duplicate_memory",
    "merge_memory",
    "template_create",
    "pin",
    "unpin",
];

/// Defaults when the owner chose nothing.
const DEFAULT_CONTEXT: i64 = 32_000;
const DEFAULT_MAX_OUTPUT: u64 = 4096;
const DEFAULT_STEPS: usize = 25;
/// Steps per reply in Auto mode: long jobs finish without "continue".
const AUTO_STEPS: usize = 40;
/// A tool result is cut here before it goes back to the model.
const TOOL_RESULT_MAX: usize = 16_000;

static STORE: OnceLock<Store> = OnceLock::new();

#[allow(clippy::result_large_err)] // the error is the ready-made reply
fn store(st: &AppState) -> Result<&'static Store, Response> {
    if STORE.get().is_none() {
        match Store::open(st.db.state_dir()) {
            Ok(s) => {
                let _ = STORE.set(s);
            }
            Err(e) => {
                return Err(fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("could not open the assistant store: {e}"),
                ))
            }
        }
    }
    Ok(STORE.get().expect("set above"))
}

fn fail(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({"error": msg}))).into_response()
}

fn browser_only(key: &Option<Extension<ApiKeyCaller>>) -> Option<Response> {
    key.as_ref().map(|_| {
        fail(
            StatusCode::FORBIDDEN,
            "Mnemo is for the signed-in browser only",
        )
    })
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/assistant/state", get(h_state))
        .route("/api/assistant/providers", post(h_provider_save))
        .route("/api/assistant/providers/delete", post(h_provider_delete))
        .route("/api/assistant/providers/test", post(h_provider_test))
        .route("/api/assistant/models/fetch", post(h_models_fetch))
        .route("/api/assistant/models", post(h_model_set))
        .route("/api/assistant/models/delete", post(h_model_delete))
        .route("/api/assistant/prefs", post(h_prefs))
        .route(
            "/api/assistant/sessions",
            get(h_sessions).post(h_session_new),
        )
        .route(
            "/api/assistant/sessions/{id}",
            get(h_session).post(h_session_set),
        )
        .route(
            "/api/assistant/sessions/{id}/delete",
            post(h_session_delete),
        )
        .route("/api/assistant/sessions/prune", post(h_prune))
        .route("/api/assistant/skills", get(h_skills))
        .route(
            "/api/assistant/suggestions",
            get(h_suggestions).post(h_suggestions_set),
        )
        .route(
            "/api/assistant/suggestions/refresh",
            post(h_suggestions_refresh),
        )
        .route("/api/assistant/sessions/{id}/seen", post(h_seen))
        .route("/api/assistant/sessions/{id}/chat", post(h_chat))
        .route("/api/assistant/sessions/{id}/compact", post(h_compact))
        .route("/api/assistant/search", get(h_search))
        .route("/api/assistant/sessions/{id}/rerun", post(h_rerun))
        .route("/api/assistant/sessions/{id}/live", get(h_live))
        .route("/api/assistant/sessions/{id}/stop", post(h_stop))
        .route("/api/assistant/sessions/{id}/steer", post(h_steer))
        .route(
            "/api/assistant/sessions/{id}/queue",
            get(h_queue).post(h_queue_add),
        )
        .route("/api/assistant/sessions/{id}/queue/{qid}", post(h_queue_op))
        .route("/api/assistant/sessions/{id}/watch", get(h_watch))
        .route("/api/assistant/sessions/{id}/export", get(h_export))
        .merge(uploads::router())
}

fn s(b: &Value, k: &str) -> Option<String> {
    b.get(k)
        .and_then(Value::as_str)
        .map(|v| v.trim().to_string())
}

fn new_id() -> String {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut b = [0u8; 9];
    for (i, x) in b.iter_mut().enumerate() {
        *x = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos())
            .wrapping_shr((i * 7) as u32)
            ^ (std::process::id() as u128).wrapping_mul(i as u128 + 31)) as u8;
    }
    let mut h: u64 = 0xcbf2_9ce4_8422_2325 ^ seq.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    for x in b {
        h = (h ^ x as u64).wrapping_mul(0x100_0000_01b3);
    }
    format!("c{:012x}", h & 0xffff_ffff_ffff)
}

// ---------------- state, providers, models, prefs ----------------

async fn h_state(State(st): State<AppState>, key: Option<Extension<ApiKeyCaller>>) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let providers = store.providers().unwrap_or_default();
    let models = store.models().unwrap_or_default();
    let prefs = store.prefs().unwrap_or_default();
    let ready = resolve_model(store, None, None).is_ok();
    Json(json!({
        "name": NAME, "ready": ready, "providers": providers, "models": models, "prefs": prefs,
        "tools": TOOLS, "defaults": {"context_tokens": DEFAULT_CONTEXT, "max_output_tokens": DEFAULT_MAX_OUTPUT, "max_steps": DEFAULT_STEPS},
    }))
    .into_response()
}

async fn h_provider_save(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    // An existing provider keeps every field the request leaves out (so {id, enabled}
    // switches it on or off); a new one needs a type, and gets an id from its name.
    let prev = s(&b, "id").and_then(|id| store.provider(&id).ok().flatten());
    let kind = s(&b, "kind")
        .filter(|k| !k.is_empty())
        .or_else(|| prev.as_ref().map(|p| p.kind.clone()))
        .unwrap_or_default();
    if !matches!(kind.as_str(), "openai" | "anthropic" | "custom") {
        return bad("kind must be openai, anthropic or custom (any OpenAI-compatible server)");
    }
    let label: String = s(&b, "label")
        .filter(|l| !l.is_empty())
        .or_else(|| prev.as_ref().map(|p| p.label.clone()))
        .unwrap_or_else(|| providers::kind_name(&kind).to_string())
        .chars()
        .take(60)
        .collect();
    let id = match (&prev, s(&b, "id").filter(|i| !i.is_empty())) {
        (Some(p), _) => p.id.clone(),
        (None, Some(id)) => id,
        (None, None) => {
            let taken: Vec<String> = store
                .providers()
                .unwrap_or_default()
                .into_iter()
                .map(|p| p.id)
                .collect();
            unique_id(&slug(&label), &taken)
        }
    };
    if !valid_id(&id) {
        return bad("id: 1-32 characters of a-z, 0-9 and '-', starting with a letter or digit");
    }
    if prev.is_none() && store.providers().map(|v| v.len()).unwrap_or(0) >= MAX_PROVIDERS {
        return bad(&format!(
            "{NAME} keeps at most {MAX_PROVIDERS} providers; delete one first"
        ));
    }
    let style = s(&b, "api_style")
        .filter(|x| !x.is_empty())
        .or_else(|| {
            prev.as_ref()
                .filter(|p| p.kind == kind)
                .map(|p| p.api_style.clone())
        })
        .unwrap_or_else(|| {
            if kind == "anthropic" {
                "messages".into()
            } else {
                "chat".into()
            }
        });
    let style_ok = match kind.as_str() {
        "anthropic" => style == "messages",
        _ => style == "chat" || style == "responses",
    };
    if !style_ok {
        return bad("api_style: OpenAI and OpenAI-compatible use chat or responses; Anthropic uses messages");
    }
    let base = s(&b, "base_url")
        .filter(|u| !u.is_empty())
        .or_else(|| {
            prev.as_ref()
                .filter(|p| p.kind == kind)
                .map(|p| p.base_url.clone())
        })
        .unwrap_or_else(|| providers::default_base(&kind).to_string());
    if base.is_empty() {
        return bad("an OpenAI-compatible provider needs its base_url (its /v1 address)");
    }
    let lower = base.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://"))
        || base.chars().any(char::is_whitespace)
    {
        return bad("base_url must be an http(s) address");
    }
    let plain = b.get("api_key").and_then(Value::as_str).map(str::trim);
    if plain.is_some_and(|k| k.len() > 4096 || k.chars().any(char::is_control)) {
        return bad("api_key looks wrong (control characters or too long)");
    }
    let sealed = match plain {
        None => None,
        Some("") => Some(String::new()),
        Some(k) => match crate::secrets::seal(st.db.state_dir(), k) {
            Some(x) => Some(x),
            None => {
                return fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "could not seal the API key",
                )
            }
        },
    };
    let enabled = b
        .get("enabled")
        .and_then(Value::as_bool)
        .or_else(|| prev.as_ref().map(|p| p.enabled))
        .unwrap_or(true);
    match store.save_provider(
        &id,
        &kind,
        &label,
        &base,
        &style,
        sealed.as_deref().zip(plain),
        enabled,
        memora_state::now(),
    ) {
        Ok(()) => {
            let mut v = state_json(store);
            v["saved"] = json!(id);
            Json(v).into_response()
        }
        Err(e) => bad(&e),
    }
}

/// Most providers one Mnemo keeps.
const MAX_PROVIDERS: usize = 20;

fn valid_id(id: &str) -> bool {
    (1..=32).contains(&id.len())
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        && !id.starts_with('-')
}

/// `My OpenRouter!` -> `my-openrouter`.
fn slug(label: &str) -> String {
    let mut out = String::new();
    for c in label.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_end_matches('-').chars().take(28).collect();
    if out.is_empty() {
        "provider".into()
    } else {
        out
    }
}

fn unique_id(base: &str, taken: &[String]) -> String {
    if !taken.iter().any(|t| t == base) {
        return base.to_string();
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|c| !taken.contains(c))
        .expect("some free id")
}

/// `POST /api/assistant/providers/test {id}`: can Mnemo reach the provider with its key?
/// Lists the models as the cheapest call every provider answers.
async fn h_provider_test(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let Some(id) = s(&b, "id") else {
        return bad("id is required");
    };
    let ep = match endpoint(&st, store, &id) {
        Ok(e) => e,
        Err(e) => return Json(json!({"ok": false, "error": e})).into_response(),
    };
    let started = Instant::now();
    let res = crate::blocking(move || providers::list_models(&ep)).await;
    let ms = started.elapsed().as_millis() as u64;
    match res {
        Ok(list) => Json(json!({"ok": true, "models": list.len(), "ms": ms})).into_response(),
        Err(e) => Json(json!({"ok": false, "error": e, "ms": ms})).into_response(),
    }
}

async fn h_provider_delete(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let Some(id) = s(&b, "id") else {
        return bad("id is required");
    };
    let _ = store.delete_provider(&id);
    h_state(State(st), None).await
}

/// The provider's endpoint with its key unsealed.
fn endpoint(st: &AppState, store: &Store, id: &str) -> Result<Endpoint, String> {
    let p = store
        .provider(id)?
        .ok_or_else(|| format!("no provider {id}; set it up in Settings, Mnemo"))?;
    let key = if p.api_key.is_empty() {
        String::new()
    } else {
        crate::secrets::open(st.db.state_dir(), &p.api_key)
            .ok_or("the stored API key could not be opened; enter it again")?
    };
    if key.is_empty() && p.kind != "custom" {
        return Err(format!("{} has no API key yet", p.label));
    }
    Ok(Endpoint {
        kind: p.kind,
        style: p.api_style,
        base_url: p.base_url,
        api_key: key,
    })
}

async fn h_models_fetch(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let Some(id) = s(&b, "provider") else {
        return bad("provider is required");
    };
    let ep = match endpoint(&st, store, &id) {
        Ok(e) => e,
        Err(e) => return bad(&e),
    };
    let list = crate::blocking(move || providers::list_models(&ep)).await;
    match list {
        Ok(list) if list.is_empty() => bad("the provider listed no models; add one by hand"),
        Ok(list) => match store.replace_fetched(&id, &list) {
            Ok(n) => {
                let mut v = state_json(store);
                v["fetched"] = json!(n);
                Json(v).into_response()
            }
            Err(e) => bad(&e),
        },
        Err(e) => fail(StatusCode::BAD_GATEWAY, &e),
    }
}

fn state_json(store: &Store) -> Value {
    let mut prefs = store.prefs().unwrap_or_default();
    for k in [SEEN, FLEETING, OWN_SUGGESTIONS, AI_SUGGESTIONS, THINKERS] {
        prefs.remove(k);
    }
    let seen_thinking = thinkers(store);
    let provs = store.providers().unwrap_or_default();
    // Each model says whether it can think (the chat then offers a thinking level).
    let models: Vec<Value> = store
        .models()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let p = provs.iter().find(|p| p.id == m.provider_id);
            let thinks = seen_thinking.contains(&format!("{}/{}", m.provider_id, m.model_id))
                || providers::may_think(
                    p.map_or("", |p| p.kind.as_str()),
                    p.map_or("", |p| p.api_style.as_str()),
                    &m.model_id,
                );
            let mut v = serde_json::to_value(&m).unwrap_or(Value::Null);
            v["thinks"] = json!(thinks);
            v
        })
        .collect();
    json!({
        "name": NAME,
        "ready": resolve_model(store, None, None).is_ok(),
        "providers": provs,
        "models": models,
        "prefs": prefs,
        "tools": TOOLS,
        "defaults": {"context_tokens": DEFAULT_CONTEXT, "max_output_tokens": DEFAULT_MAX_OUTPUT, "max_steps": DEFAULT_STEPS},
    })
}

fn opt_int(b: &Value, k: &str) -> Option<Option<i64>> {
    match b.get(k) {
        None => None,
        Some(Value::Null) => Some(None),
        Some(v) => Some(v.as_i64().filter(|n| *n > 0)),
    }
}

async fn h_model_set(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let (Some(p), Some(m)) = (s(&b, "provider"), s(&b, "model")) else {
        return bad("provider and model are required");
    };
    if m.is_empty() || m.len() > 200 || m.chars().any(char::is_control) {
        return bad("model must be 1-200 printable characters");
    }
    if store.provider(&p).ok().flatten().is_none() {
        return bad("set up that provider first");
    }
    let label = s(&b, "label");
    let res = store.set_model(
        &p,
        &m,
        label.as_deref(),
        opt_int(&b, "context_window"),
        opt_int(&b, "max_output"),
        b.get("pinned").and_then(Value::as_bool),
        b.get("hidden").and_then(Value::as_bool),
    );
    match res {
        Ok(()) => Json(state_json(store)).into_response(),
        Err(e) => bad(&e),
    }
}

async fn h_model_delete(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let (Some(p), Some(m)) = (s(&b, "provider"), s(&b, "model")) else {
        return bad("provider and model are required");
    };
    let _ = store.delete_model(&p, &m);
    Json(state_json(store)).into_response()
}

/// Preferences: `default_model` (`provider/model`), `system_prompt`, `temperature` (0-2 or
/// null for the model's own), `max_output_tokens`, `context_tokens`, `max_steps`, `launcher`.
async fn h_prefs(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let Some(obj) = b.as_object() else {
        return bad("send an object of preferences");
    };
    for (k, v) in obj {
        let ok = match k.as_str() {
            "default_model" => {
                v.is_null()
                    || v.as_str()
                        .is_some_and(|x| x.contains('/') && x.len() <= 260)
            }
            "system_prompt" => v.is_null() || v.as_str().is_some_and(|x| x.chars().count() <= 4000),
            "temperature" => v.is_null() || v.as_f64().is_some_and(|x| (0.0..=2.0).contains(&x)),
            "max_output_tokens" => {
                v.is_null() || v.as_i64().is_some_and(|x| (64..=200_000).contains(&x))
            }
            "context_tokens" => {
                v.is_null() || v.as_i64().is_some_and(|x| (2_000..=2_000_000).contains(&x))
            }
            "max_steps" => v.is_null() || v.as_i64().is_some_and(|x| (1..=60).contains(&x)),
            "permission" => v.is_null() || v.as_str().is_some_and(|x| x == "ask" || x == "auto"),
            "launcher" => v.is_null() || v.is_boolean(),
            THINKING => {
                v.is_null()
                    || v.as_str()
                        .is_some_and(|x| ["auto", "off", "low", "medium", "high"].contains(&x))
            }
            FALLBACKS => {
                v.is_null()
                    || v.as_array().is_some_and(|a| {
                        a.len() <= 5
                            && a.iter().all(|x| {
                                x.as_str()
                                    .is_some_and(|x| x.contains('/') && x.len() <= 260)
                            })
                    })
            }
            other => return bad(&format!("unknown preference: {other}")),
        };
        if !ok {
            return bad(&format!("{k} is out of range"));
        }
    }
    for (k, v) in obj {
        if let Err(e) = store.set_pref(k, v) {
            return bad(&e);
        }
    }
    Json(state_json(store)).into_response()
}

// ---------------- sessions ----------------

/// The preference that remembers, per chat, how many messages the owner has seen (on any
/// device): `{chat id: count}`. Kept out of the preferences the web app edits.
const SEEN: &str = "seen";

fn seen_map(store: &Store) -> Option<serde_json::Map<String, Value>> {
    store
        .prefs()
        .ok()?
        .get(SEEN)
        .and_then(Value::as_object)
        .cloned()
}

/// Fleeting chats (`{chat id: started}`): kept only while the owner is in them. They are left
/// out of the chat list, search and Mnemo's look-back tools, and deleted (with the images
/// sent in them) when the owner leaves, or after half an hour without activity.
const FLEETING: &str = "fleeting";
const FLEETING_IDLE: i64 = 30 * 60;

fn fleeting_ids(store: &Store) -> BTreeSet<String> {
    store
        .prefs()
        .ok()
        .and_then(|p| p.get(FLEETING).and_then(Value::as_object).cloned())
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

fn set_fleeting(store: &Store, id: &str, on: bool) {
    let mut m = store
        .prefs()
        .ok()
        .and_then(|p| p.get(FLEETING).and_then(Value::as_object).cloned())
        .unwrap_or_default();
    if on {
        m.insert(id.to_string(), json!(memora_state::now()));
    } else if m.remove(id).is_none() {
        return;
    }
    let v = if m.is_empty() {
        Value::Null
    } else {
        Value::Object(m)
    };
    let _ = store.set_pref(FLEETING, &v);
}

/// Delete a chat with the images sent in it (a picture already placed in a note is a copy in
/// the vault and stays).
fn drop_chat(st: &AppState, store: &Store, id: &str) -> bool {
    live::queue_clear(id);
    for m in store.messages(id).unwrap_or_default() {
        // Pictures Mnemo opened from the vault were staged copies; the vault keeps its own.
        if m.tool_name.as_deref() == Some(VIEW_IMAGE) {
            if let Some(up) = serde_json::from_str::<Value>(&m.content)
                .ok()
                .and_then(|v| v["image"].as_str().map(str::to_string))
            {
                uploads::remove(st, &up);
            }
        }
        for a in m
            .meta
            .as_ref()
            .and_then(|v| v["attach"].as_array())
            .into_iter()
            .flatten()
        {
            if a["kind"] == "image" {
                if let Some(up) = a["path"].as_str() {
                    uploads::remove(st, up);
                }
            }
        }
    }
    set_fleeting(store, id, false);
    store.delete_session(id).unwrap_or(false)
}

/// Fleeting chats nobody is in any more: gone after FLEETING_IDLE without activity.
fn sweep_fleeting(st: &AppState, store: &Store) {
    let ids = fleeting_ids(store);
    if ids.is_empty() {
        return;
    }
    let all = store.sessions().unwrap_or_default();
    let stale = memora_state::now() - FLEETING_IDLE;
    for id in ids {
        match all.iter().find(|x| x.id == id) {
            None => set_fleeting(store, &id, false),
            Some(x) if x.updated_at < stale && !live::running(&x.id) => {
                drop_chat(st, store, &id);
            }
            _ => {}
        }
    }
}

async fn h_sessions(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    match store(&st) {
        Ok(s) => {
            sweep_fleeting(&st, s);
            let hidden = fleeting_ids(s);
            let mut all = s.sessions().unwrap_or_default();
            all.retain(|x| !hidden.contains(&x.id));
            // First list after the update: everything there now counts as seen.
            let seen = seen_map(s).unwrap_or_else(|| {
                let m: serde_json::Map<String, Value> = all
                    .iter()
                    .map(|x| (x.id.clone(), json!(x.messages)))
                    .collect();
                let _ = s.set_pref(SEEN, &Value::Object(m.clone()));
                m
            });
            // `?about=<path>`: only the chats about that note or folder, newest first.
            if let Some(p) = q.get("about").map(|p| p.trim()).filter(|p| !p.is_empty()) {
                let ids = s.sessions_about(p).unwrap_or_default();
                all.retain(|x| ids.contains(&x.id));
                all.sort_by_key(|x| ids.iter().position(|i| i == &x.id));
            }
            let list: Vec<Value> = all
                .into_iter()
                .map(|x| {
                    let mut v = json!(x);
                    v["running"] = json!(live::running(&x.id));
                    v["seen"] = json!(seen.get(&x.id).and_then(Value::as_i64).unwrap_or(0));
                    v
                })
                .collect();
            Json(json!({"sessions": list})).into_response()
        }
        Err(r) => r,
    }
}

/// The owner has seen a chat up to `messages`: unread counts agree on every device.
async fn h_seen(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let Some(n) = b
        .get("messages")
        .and_then(Value::as_i64)
        .filter(|n| *n >= 0)
    else {
        return bad("messages is required");
    };
    let all = store.sessions().unwrap_or_default();
    let Some(chat) = all.iter().find(|x| x.id == id) else {
        return bad("no such chat");
    };
    let mut seen = seen_map(store).unwrap_or_default();
    // Never past what the chat holds, never back.
    let n = n.min(chat.messages);
    let had = seen.get(&id).and_then(Value::as_i64).unwrap_or(0);
    if n > had {
        seen.insert(id.clone(), json!(n));
        // Forget chats that are gone.
        seen.retain(|k, _| all.iter().any(|x| &x.id == k));
        if let Err(e) = store.set_pref(SEEN, &Value::Object(seen)) {
            return bad(&e);
        }
    }
    Json(json!({"ok": true, "seen": n.max(had)})).into_response()
}

async fn h_session_new(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let scope = s(&b, "scope").unwrap_or_else(|| "global".into());
    if !(scope == "global" || scope.starts_with("note:") || scope.starts_with("folder:"))
        || scope.len() > 1100
    {
        return bad("scope must be global, note:<path> or folder:<path>");
    }
    let title = s(&b, "title")
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "New chat".into());
    // Every chat remembers its model from the start, so changing the default later only
    // changes new chats.
    let model = s(&b, "model")
        .filter(|m| !m.is_empty())
        .or_else(|| {
            resolve_model(store, None, None)
                .ok()
                .map(|(p, m)| format!("{p}/{m}"))
        })
        .unwrap_or_default();
    let id = new_id();
    match store.create_session(
        &id,
        &title.chars().take(80).collect::<String>(),
        &scope,
        &model,
        memora_state::now(),
    ) {
        Ok(()) => {
            let fleeting = b.get("fleeting").and_then(Value::as_bool) == Some(true);
            if fleeting {
                set_fleeting(store, &id, true);
            }
            Json(json!({"session": store.session(&id).ok().flatten(), "fleeting": fleeting}))
                .into_response()
        }
        Err(e) => bad(&e),
    }
}

async fn h_session(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    match store.session(&id) {
        Ok(Some(sess)) => {
            let messages = store.messages(&id).unwrap_or_default();
            if sess.model.is_empty() {
                if let Some(m) = messages
                    .iter()
                    .rev()
                    .filter(|m| m.role == "assistant")
                    .find_map(|m| m.meta.as_ref()?["model"].as_str().map(str::to_string))
                    .filter(|m| m.contains('/'))
                {
                    let _ = store.update_session(&id, None, Some(&m), None, None);
                }
            }
            let st2 = st.clone();
            let context = crate::blocking(move || session_context(&st2, store, &sess.id))
                .await
                .unwrap_or(Value::Null);
            let sess = store.session(&id).ok().flatten();
            let running = live::running(&id);
            let fleeting = fleeting_ids(store).contains(&id);
            let queue = live::queue_json(&id);
            Json(json!({"session": sess, "messages": messages, "context": context, "running": running, "fleeting": fleeting, "queue": queue}))
                .into_response()
        }
        _ => fail(StatusCode::NOT_FOUND, "chat not found"),
    }
}

/// The chat's memory for the model it would use now (`None` without a usable model).
fn session_context(st: &AppState, store: &Store, id: &str) -> Option<Value> {
    let sess = store.session(id).ok().flatten()?;
    let (p, m) = resolve_model(
        store,
        None,
        Some(sess.model.as_str()).filter(|m| !m.is_empty()),
    )
    .ok()?;
    let stp = setup(st, store, id, &sess.scope, &p, &m);
    Some(context_json(
        &stp,
        &store.messages(id).unwrap_or_default(),
        &format!("{p}/{m}"),
    ))
}

/// `POST /api/assistant/sessions/{id}/compact`: fold the older turns into a summary now.
async fn h_compact(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let Some(sess) = store.session(&id).ok().flatten() else {
        return fail(StatusCode::NOT_FOUND, "chat not found");
    };
    let (provider, model) = match resolve_model(
        store,
        None,
        Some(sess.model.as_str()).filter(|m| !m.is_empty()),
    ) {
        Ok(x) => x,
        Err(e) => return bad(&e),
    };
    let ep = match endpoint(&st, store, &provider) {
        Ok(e) => e,
        Err(e) => return bad(&e),
    };
    if !claim(&id) {
        return fail(
            StatusCode::CONFLICT,
            "Mnemo is still answering in this chat",
        );
    }
    let (st2, id2) = (st.clone(), id.clone());
    let res = crate::blocking(move || {
        let stp = setup(&st2, store, &id2, &sess.scope, &provider, &model);
        let r = compact(store, &id2, &provider, &model, &ep, &stp, &mut |_| true);
        let ctx = context_json(
            &stp,
            &store.messages(&id2).unwrap_or_default(),
            &format!("{provider}/{model}"),
        );
        r.map(|x| (x, ctx))
    })
    .await;
    unclaim(&id);
    match res {
        Ok((Some((n, t, summary)), ctx)) => {
            live::notify(&id, &json!({"type": "compacted"}));
            Json(json!({"ok": true, "messages": n, "tokens": t, "summary": summary, "context": ctx}))
                .into_response()
        }
        Ok((None, ctx)) => Json(json!({"ok": false, "reason": "There is nothing older to compact yet.", "context": ctx})).into_response(),
        Err(e) => bad(&format!("could not compact the chat: {e}")),
    }
}

async fn h_session_set(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let title = s(&b, "title")
        .filter(|t| !t.is_empty())
        .map(|t| t.chars().take(80).collect::<String>());
    let model = s(&b, "model");
    let pinned = b.get("pinned").and_then(Value::as_bool);
    match store.update_session(&id, title.as_deref(), model.as_deref(), pinned, None) {
        Ok(true) => Json(json!({"session": store.session(&id).ok().flatten()})).into_response(),
        Ok(false) => fail(StatusCode::NOT_FOUND, "chat not found"),
        Err(e) => bad(&e),
    }
}

/// Delete many chats at once: `{ids}` (the ones picked), `{older_than_days}` (not touched for
/// that long) or `{all: true}`; `keep_pinned` (default true) spares pinned chats when deleting
/// by age or all. A chat answering right now is left alone. `{deleted, skipped}`.
async fn h_prune(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let all = store.sessions().unwrap_or_default();
    let keep_pinned = b
        .get("keep_pinned")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let picked: Vec<&memora_state::assistant::Session> =
        if let Some(ids) = b.get("ids").and_then(Value::as_array) {
            let ids: BTreeSet<&str> = ids.iter().filter_map(Value::as_str).collect();
            all.iter().filter(|x| ids.contains(x.id.as_str())).collect()
        } else if let Some(days) = b.get("older_than_days").and_then(Value::as_i64) {
            if !(1..=3650).contains(&days) {
                return bad("older_than_days is 1 to 3650");
            }
            let before = memora_state::now() - days * 86_400;
            all.iter()
                .filter(|x| x.updated_at < before && !(keep_pinned && x.pinned))
                .collect()
        } else if b.get("all").and_then(Value::as_bool) == Some(true) {
            all.iter().filter(|x| !(keep_pinned && x.pinned)).collect()
        } else {
            return bad("send ids, older_than_days or all");
        };
    let (mut deleted, mut skipped) = (0, 0);
    for x in picked {
        if live::running(&x.id) {
            skipped += 1;
        } else if drop_chat(&st, store, &x.id) {
            deleted += 1;
        }
    }
    Json(json!({"deleted": deleted, "skipped": skipped})).into_response()
}

async fn h_session_delete(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    match store(&st) {
        Ok(s) => Json(json!({"ok": drop_chat(&st, s, &id)})).into_response(),
        Err(r) => r,
    }
}

// ---------------- the agent ----------------

/// The model to use: the request's, the chat's, the default, or the first pinned (then any)
/// visible model of an enabled provider. Returns `(provider id, model id)`.
fn resolve_model(
    store: &Store,
    asked: Option<&str>,
    session: Option<&str>,
) -> Result<(String, String), String> {
    let providers = store.providers()?;
    let usable = |p: &str| {
        providers
            .iter()
            .any(|x| x.id == p && x.enabled && (!x.api_key.is_empty() || x.kind == "custom"))
    };
    let prefs = store.prefs()?;
    let known = store.models()?;
    // A chat keeps the model it was given (picked by hand, or the default when it began);
    // only when that model is gone or its provider cannot answer does it take the default,
    // then the fallback models, then the first pinned or visible model.
    let is_known = |p: &str, m: &str| known.iter().any(|x| x.provider_id == p && x.model_id == m);
    let default = prefs
        .get("default_model")
        .and_then(Value::as_str)
        .map(str::to_string);
    let fallbacks: Vec<String> = prefs
        .get(FALLBACKS)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    for cand in [
        asked.map(str::to_string),
        session.map(str::to_string),
        default,
    ]
    .into_iter()
    .flatten()
    .chain(fallbacks)
    {
        if let Some((p, m)) = cand.split_once('/') {
            if !m.is_empty() && usable(p) && is_known(p, m) {
                return Ok((p.to_string(), m.to_string()));
            }
        }
    }
    let mut models: Vec<_> = store
        .models()?
        .into_iter()
        .filter(|m| !m.hidden && usable(&m.provider_id))
        .collect();
    // The same order the web app and the TUI list them in: pinned first, then by name.
    models.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| a.provider_id.cmp(&b.provider_id))
            .then_with(|| a.model_id.cmp(&b.model_id))
    });
    models
        .first()
        .map(|m| (m.provider_id.clone(), m.model_id.clone()))
        .ok_or_else(|| {
            "Mnemo has no model yet: add a provider and its models in Settings, Mnemo".to_string()
        })
}

/// Mnemo as a tool caller, acting for `on_behalf` (shown with its activity).
fn caller_for(on_behalf: &str) -> Caller {
    caller().on_behalf_of(on_behalf)
}

fn caller() -> Caller {
    let perms = KeyPermissions {
        enabled: true,
        scopes: vec!["mcp".into(), "read".into(), "write".into()],
        // upload_image is not offered to the model: place_image calls it with a staged image.
        tools: ToolGrant::Only(
            TOOLS
                .iter()
                .copied()
                .chain(["upload_image"])
                .map(str::to_string)
                .collect::<BTreeSet<_>>(),
        ),
    };
    Caller::key(ACTOR_ID, perms, None).named(NAME)
}

/// Mnemo's own tool: put an image the owner attached in a chat beside a note.
const PLACE_IMAGE: &str = "place_image";

const VIEW_IMAGE: &str = "view_image";

fn view_image_def() -> ToolDef {
    ToolDef {
        name: VIEW_IMAGE.into(),
        description: "Look at a picture in the vault, for example one shown in a note (![alt](path)), to describe it, \
read text in it or compare it. Give its vault path, or the path as the note writes it together with the note's path. \
A picture on the web (an http or https address) cannot be opened: you have no browser."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "The picture's path in the vault (or as the note writes it)"},
                "note": {"type": "string", "description": "The note that shows it, when the path is relative to the note's folder"}
            },
            "required": ["path"],
            "additionalProperties": false
        }),
    }
}

/// Open a picture from the vault for the model: it is staged like an image the owner sent and
/// goes to the model with the next step (see `history_within`).
fn view_image(st: &AppState, args: &Value) -> Result<Value, String> {
    let raw = args["path"].as_str().unwrap_or("").trim();
    let raw = raw
        .trim_start_matches('<')
        .trim_end_matches('>')
        .split(['#', '?'])
        .next()
        .unwrap_or("");
    if raw.is_empty() {
        return Err("path is required".into());
    }
    let lower = raw.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("//") {
        return Ok(json!({
            "ok": false,
            "url": raw,
            "message": "This picture is on the web (a URL), not in the vault, and I have no browser or web access, so I \
        cannot open it. Tell the owner: download it and send it here in the chat, or put it in the note (paste or drop it), \
        then ask again."
        }));
    }
    let decoded = raw.replace("%20", " ");
    let path = decoded.trim_start_matches("./").trim_start_matches('/');
    let note_dir = args["note"]
        .as_str()
        .and_then(|n| n.trim().rsplit_once('/').map(|(d, _)| d.to_string()))
        .unwrap_or_default();
    let candidates: Vec<String> =
        if note_dir.is_empty() || path.starts_with(&format!("{note_dir}/")) {
            vec![path.to_string()]
        } else {
            vec![format!("{note_dir}/{path}"), path.to_string()]
        };
    let found = candidates.iter().find_map(|p| {
        let full = crate::store_as(st, None).resolve(p).ok()?;
        full.is_file().then(|| (p.clone(), full))
    });
    let Some((rel, full)) = found else {
        return Err(format!(
            "no picture at {raw} in the vault (list_images shows the pictures there)"
        ));
    };
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    let Some((ext, _)) = uploads::sniff(&bytes) else {
        return Err("only PNG, JPEG, WebP or GIF pictures can be looked at".into());
    };
    if bytes.len() > 20 * 1_048_576 {
        return Err("the picture is larger than 20 MB".into());
    }
    let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
    let (id, _) = uploads::stage(st, &name, ext, &bytes)?;
    Ok(
        json!({"ok": true, "path": rel, "image": id, "bytes": bytes.len(), "message": "The picture comes with this result for you to look at."}),
    )
}

fn place_image_def() -> ToolDef {
    ToolDef {
        name: PLACE_IMAGE.into(),
        description: "Put an image the owner attached in this chat into the vault, in the folder of the note it belongs to, \
and (by default) add it to the end of that note's text as ![alt](path:name). Use the upload id from the <attached kind=\"image\"> \
block. Ask which note when it is not clear. To show it somewhere else in the note, move the line with patch_memory afterwards."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "upload": {"type": "string", "description": "The upload id, e.g. u1a2b3c4d5e6f"},
                "note": {"type": "string", "description": "The note the image belongs to, e.g. 'Projects/Plan.md'; the image goes in its folder"},
                "name": {"type": "string", "description": "File name to keep, e.g. 'site-plan.png' (default: the attached file's name)"},
                "alt": {"type": "string", "description": "Alt text for the image line"},
                "append": {"type": "boolean", "description": "Add the image line to the end of the note (default true)"}
            },
            "required": ["upload", "note"],
            "additionalProperties": false
        }),
    }
}

/// Mnemo's own tool to hand the owner things from the vault: cards in its reply that open
/// a note, a folder, an image or the vault on a tap.
const SHOW_ITEMS: &str = "show_items";
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"];

fn show_items_def() -> ToolDef {
    ToolDef {
        name: SHOW_ITEMS.into(),
        description: "Hand the owner notes, folders, images or the whole vault as cards in your reply that open with a \
tap (like attachments). Use it whenever your answer points at specific notes, folders or images (ones you found, \
made or changed), instead of only naming them. Paths are vault paths: a note ends in .md, a folder is its path \
('' is the top level), an image is its file path."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "maxItems": 12,
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["note", "folder", "image", "vault"]},
                            "path": {"type": "string"}
                        },
                        "required": ["kind"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["items"],
            "additionalProperties": false
        }),
    }
}

/// Check the items Mnemo wants to show: each one that exists, with a title.
fn show_items(st: &AppState, args: &Value) -> Result<Value, String> {
    let list = args["items"].as_array().ok_or("items is required")?;
    let store = crate::store_as(st, None);
    let mut shown = Vec::new();
    let mut missing = Vec::new();
    for it in list.iter().take(12) {
        let kind = it["kind"].as_str().unwrap_or("");
        let path = it["path"]
            .as_str()
            .unwrap_or("")
            .trim()
            .trim_matches('/')
            .to_string();
        let name = path.rsplit('/').next().unwrap_or(&path).to_string();
        let ok = match kind {
            "vault" => true,
            "note" => store.read_note_impl(&path).is_ok(),
            "folder" => path.is_empty() || store.resolve(&path).is_ok_and(|p| p.is_dir()),
            "image" => {
                let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
                IMAGE_EXTS.contains(&ext.as_str())
                    && store.resolve(&path).is_ok_and(|p| p.is_file())
            }
            _ => false,
        };
        if ok {
            let title = match kind {
                "vault" => "Your vault".to_string(),
                "folder" if path.is_empty() => "All notes".to_string(),
                "note" => name.trim_end_matches(".md").to_string(),
                _ => name,
            };
            shown.push(json!({"kind": kind, "path": path, "title": title}));
        } else {
            missing.push(format!("{kind} {path}"));
        }
    }
    if shown.is_empty() {
        return Err(format!("none of these exist: {}", missing.join(", ")));
    }
    Ok(json!({"shown": shown, "missing": missing}))
}

/// Mnemo asks the owner something with options to tap (and room for another answer).
const ASK_OWNER: &str = "ask_owner";

fn ask_owner_def() -> ToolDef {
    ToolDef {
        name: ASK_OWNER.into(),
        description: "Ask the owner a question with 2 to 5 short options to tap (they can also type another \
answer). Use it when a choice is theirs, when something is unclear, and in Ask first mode before changing notes \
(mark the option that approves the change with approve: true). Your reply ends here; their answer is the next \
message."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "question": {"type": "string"},
                "options": {
                    "type": "array",
                    "minItems": 2,
                    "maxItems": 5,
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "description": "A few words"},
                            "description": {"type": "string"},
                            "approve": {"type": "boolean", "description": "Choosing this lets you make the changes you described"}
                        },
                        "required": ["label"],
                        "additionalProperties": false
                    }
                },
                "allow_other": {"type": "boolean", "description": "Offer \"Other\" for a typed answer (default true)"}
            },
            "required": ["question", "options"],
            "additionalProperties": false
        }),
    }
}

/// The question as the chat shows it, or why it cannot be asked.
fn ask_check(args: &Value) -> Result<Value, String> {
    let q = args["question"].as_str().unwrap_or("").trim();
    if q.is_empty() {
        return Err("question is required".into());
    }
    let opts: Vec<Value> = args["options"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|o| {
            let label: String = o["label"].as_str()?.trim().chars().take(80).collect();
            (!label.is_empty()).then(|| {
                json!({
                    "label": label,
                    "description": o["description"].as_str().map(|d| d.trim().chars().take(200).collect::<String>()),
                    "approve": o["approve"] == true,
                })
            })
        })
        .take(5)
        .collect();
    if opts.len() < 2 {
        return Err("give at least two options".into());
    }
    Ok(json!({
        "question": q.chars().take(500).collect::<String>(),
        "options": opts,
        "allow_other": args["allow_other"] != false,
    }))
}

/// Mnemo's clock: the time now where the owner is (their browser says its zone).
const CURRENT_TIME: &str = "current_time";

fn current_time_def() -> ToolDef {
    ToolDef {
        name: CURRENT_TIME.into(),
        description:
            "The current date, time, weekday and the owner's time zone (from their device). Use it \
whenever the answer depends on today, the time or the day of the week."
                .into(),
        parameters: json!({"type": "object", "properties": {}, "additionalProperties": false}),
    }
}

const WEEKDAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];
const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// `(weekday, "16 November 2026", "13:45")` for a unix time already shifted to local time.
fn clock(local: i64) -> (&'static str, String, String) {
    let days = local.div_euclid(86_400);
    let ymd = civil_date(local);
    let (y, m, d) = (
        &ymd[0..4],
        ymd[5..7].parse::<usize>().unwrap_or(1),
        ymd[8..10].trim_start_matches('0'),
    );
    let t = local.rem_euclid(86_400);
    (
        WEEKDAYS[(days + 4).rem_euclid(7) as usize],
        format!("{d} {} {y}", MONTHS[(m - 1).min(11)]),
        format!("{:02}:{:02}", t / 3600, (t / 60) % 60),
    )
}

fn current_time(store: &Store, id: &str) -> Value {
    let now = memora_state::now();
    let msgs = store.messages(id).unwrap_or_default();
    let meta = msgs
        .iter()
        .rev()
        .filter(|m| m.role == "user")
        .find_map(|m| {
            m.meta
                .clone()
                .filter(|v| v.get("tz_offset").is_some() || v.get("tz").is_some())
        });
    let off = meta.as_ref().and_then(|v| v["tz_offset"].as_i64());
    let tz = meta
        .as_ref()
        .and_then(|v| v["tz"].as_str().map(str::to_string));
    let (uw, ud, ut) = clock(now);
    let mut out = json!({
        "utc": format!("{uw}, {ud}, {ut} UTC"),
        "unix": now,
    });
    match off {
        Some(o) => {
            let (w, d, t) = clock(now + o * 60);
            let sign = if o < 0 { '-' } else { '+' };
            let zone = format!("UTC{sign}{:02}:{:02}", o.abs() / 60, o.abs() % 60);
            out["local"] = json!(format!("{w}, {d}, {t}"));
            out["weekday"] = json!(w);
            out["date"] = json!(d);
            out["time"] = json!(t);
            out["time_zone"] = json!(match &tz {
                Some(n) => format!("{n} ({zone})"),
                None => zone,
            });
        }
        None => {
            out["weekday"] = json!(uw);
            out["note"] =
                json!("The owner's time zone is unknown (no browser told it); this is UTC.");
        }
    }
    out
}

/// Mnemo's own tools over its chats: find and read earlier conversations.
const SEARCH_CHATS: &str = "search_chats";
const READ_CHAT: &str = "read_chat";
const LIST_CHATS: &str = "list_chats";
const LIST_ARTIFACTS: &str = "list_artifacts";
const READ_ARTIFACT: &str = "read_artifact";

/// One HTML or SVG page written in a reply (a ```html / ```svg block), as the web app shows it.
struct Page {
    kind: &'static str,
    title: String,
    code: String,
    at: i64,
}

/// The pages in a chat's replies, oldest first. Its <title> names a page; the same title again is
/// a newer version of the same file.
fn pages_in(msgs: &[memora_state::assistant::Message]) -> Vec<Page> {
    let mut out = Vec::new();
    for m in msgs.iter().filter(|m| m.role == "assistant") {
        let mut lines = m.content.lines();
        while let Some(l) = lines.next() {
            let t = l.trim_start();
            let Some(lang) = t.strip_prefix("```") else {
                continue;
            };
            let lang = lang.trim().to_ascii_lowercase();
            let kind = match lang.as_str() {
                "html" | "htm" => "html",
                "svg" => "svg",
                _ => {
                    // Skip any other fenced block whole.
                    for x in lines.by_ref() {
                        if x.trim_start().starts_with("```") {
                            break;
                        }
                    }
                    continue;
                }
            };
            let mut code = Vec::new();
            for x in lines.by_ref() {
                if x.trim_start().starts_with("```") {
                    break;
                }
                code.push(x);
            }
            let code = code.join("\n");
            let lower = code.to_ascii_lowercase();
            let title = lower
                .find("<title>")
                .and_then(|a| {
                    lower[a + 7..]
                        .find("</title>")
                        .map(|b| code[a + 7..a + 7 + b].trim().to_string())
                })
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| {
                    if kind == "svg" {
                        "Image".into()
                    } else {
                        "Page".into()
                    }
                });
            out.push(Page {
                kind,
                title,
                code,
                at: m.created_at,
            });
        }
    }
    out
}

fn chat_tool_defs() -> [ToolDef; 5] {
    [
        ToolDef {
            name: LIST_ARTIFACTS.into(),
            description: "List the pages (HTML or SVG files: charts, diagrams, small pages) you wrote in the owner's \
chats, newest first: the chat they live in, title, kind, how many versions. They belong to their chat (deleting \
the chat deletes them). Use it to find a page to reuse or rework, from this chat or another; then read_artifact."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "chat": {"type": "string", "description": "Only this chat's pages (a chat id)"},
                    "title": {"type": "string", "description": "Only pages whose title contains this (any case)"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Most pages (default 20)"}
                },
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: READ_ARTIFACT.into(),
            description: "Read one page you wrote (from list_artifacts): its full HTML or SVG source, the latest version \
unless you ask for another. Start from it to change or tidy that page, or to build on it in another chat."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "chat": {"type": "string", "description": "The chat id the page is in"},
                    "title": {"type": "string", "description": "The page title"},
                    "version": {"type": "integer", "minimum": 1, "description": "1 for the first version; default the latest"}
                },
                "required": ["chat", "title"],
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: LIST_CHATS.into(),
            description: "List your chats with the owner, most recently active first: id, title, what it is about \
(scope), when it was last active and how many messages it has. Use it to see which other chats exist (\"the chat \
from yesterday\", \"what else did we talk about\") and to connect this chat with earlier ones; then read_chat."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Only chats whose title contains this (any case)"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Most chats (default 20)"}
                },
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: SEARCH_CHATS.into(),
            description: "Search your earlier chats with the owner (their messages and your replies, and chat titles) \
for every word of a query, newest first. Use it when the owner refers to something discussed before; then \
read_chat for the whole conversation."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Words that must all appear"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 30, "description": "Most hits (default 10)"}
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: READ_CHAT.into(),
            description: "Read one of your earlier chats by its id (from search_chats or list_chats): the owner's \
messages and your replies, oldest first (long ones are cut). The newest 60 come first; page 1, 2, ... reads \
further back."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "The chat id"},
                    "page": {"type": "integer", "minimum": 0, "description": "0 for the newest messages (default), 1 for the 60 before them, ..."}
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        },
    ]
}

/// A piece of `text` around the first of `words` found (any case), at most ~170 characters.
fn snippet(text: &str, q: &str) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = flat.to_lowercase();
    let hit = q
        .split_whitespace()
        .filter_map(|w| lower.find(&w.to_lowercase()))
        .min()
        .unwrap_or(0);
    // Back up ~60 characters to a char boundary.
    let start = flat[..hit.min(flat.len())]
        .char_indices()
        .rev()
        .nth(59)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let body: String = flat[start..].chars().take(170).collect();
    format!(
        "{}{body}{}",
        if start > 0 { "…" } else { "" },
        if flat[start..].chars().count() > 170 {
            "…"
        } else {
            ""
        }
    )
}

fn search_json(
    store: &Store,
    q: &str,
    limit: usize,
    current: Option<&str>,
) -> Result<Value, String> {
    // Fleeting chats stay out of search (the one asking may find itself).
    let hidden = fleeting_ids(store);
    let hits: Vec<_> = store
        .search(q, limit + hidden.len().min(20))?
        .into_iter()
        .filter(|h| !hidden.contains(&h.session_id) || current == Some(h.session_id.as_str()))
        .take(limit)
        .collect();
    Ok(json!({
        "query": q,
        "hits": hits.iter().map(|h| json!({
            "chat": h.session_id,
            "title": h.title,
            "scope": h.scope,
            "message_id": h.message_id,
            "role": h.role,
            "snippet": if h.text.is_empty() { String::new() } else { snippet(&h.text, q) },
            "at": h.at,
            "current": current == Some(h.session_id.as_str()),
        })).collect::<Vec<_>>(),
    }))
}

/// Run one of Mnemo's chat tools.
fn chat_tool(store: &Store, name: &str, args: &Value, current: &str) -> Result<Value, String> {
    if name == SEARCH_CHATS {
        let q = args["query"].as_str().unwrap_or("").trim();
        if q.is_empty() {
            return Err("query is required".into());
        }
        let limit = args["limit"].as_u64().unwrap_or(10).clamp(1, 30) as usize;
        return search_json(store, q, limit, Some(current));
    }
    if name == LIST_ARTIFACTS {
        let only = args["chat"]
            .as_str()
            .map(str::trim)
            .filter(|x| !x.is_empty());
        let want = args["title"].as_str().unwrap_or("").trim().to_lowercase();
        let limit = args["limit"].as_u64().unwrap_or(20).clamp(1, 50) as usize;
        let mut found: Vec<(i64, Value)> = Vec::new();
        let hidden = fleeting_ids(store);
        for x in store.sessions()? {
            if only.is_some_and(|c| c != x.id) || (hidden.contains(&x.id) && x.id != current) {
                continue;
            }
            let pages = pages_in(&store.messages(&x.id)?);
            let mut seen: Vec<(&str, &str)> = Vec::new();
            for p in pages.iter().rev() {
                if seen.contains(&(p.kind, p.title.as_str()))
                    || (!want.is_empty() && !p.title.to_lowercase().contains(&want))
                {
                    continue;
                }
                seen.push((p.kind, &p.title));
                let versions = pages
                    .iter()
                    .filter(|q| q.kind == p.kind && q.title == p.title)
                    .count();
                found.push((
                    p.at,
                    json!({
                        "chat": x.id,
                        "chat_title": x.title,
                        "current_chat": x.id == current,
                        "title": p.title,
                        "kind": p.kind,
                        "versions": versions,
                        "lines": p.code.lines().count(),
                        "at": p.at,
                    }),
                ));
            }
        }
        found.sort_by_key(|(at, _)| std::cmp::Reverse(*at));
        let total = found.len();
        let pages: Vec<Value> = found.into_iter().take(limit).map(|(_, v)| v).collect();
        return Ok(json!({"artifacts": pages, "total": total}));
    }
    if name == READ_ARTIFACT {
        let chat = args["chat"].as_str().unwrap_or("").trim();
        let title = args["title"].as_str().unwrap_or("").trim();
        store
            .session(chat)?
            .ok_or_else(|| format!("no chat with id {chat}"))?;
        let all: Vec<Page> = pages_in(&store.messages(chat)?)
            .into_iter()
            .filter(|p| p.title.eq_ignore_ascii_case(title))
            .collect();
        if all.is_empty() {
            return Err(format!(
                "no page titled {title} in that chat (list_artifacts shows them)"
            ));
        }
        let v = args["version"]
            .as_u64()
            .map(|v| v as usize)
            .unwrap_or(all.len())
            .clamp(1, all.len());
        let p = &all[v - 1];
        return Ok(json!({
            "chat": chat,
            "title": p.title,
            "kind": p.kind,
            "version": v,
            "versions": all.len(),
            "source": clip(&p.code, 60_000),
        }));
    }
    if name == LIST_CHATS {
        let want = args["title"].as_str().unwrap_or("").trim().to_lowercase();
        let limit = args["limit"].as_u64().unwrap_or(20).clamp(1, 50) as usize;
        let hidden = fleeting_ids(store);
        let mut all = store.sessions()?;
        all.retain(|x| !hidden.contains(&x.id) || x.id == current);
        all.sort_by_key(|x| std::cmp::Reverse(x.updated_at));
        let total = all.len();
        let chats: Vec<Value> = all
            .iter()
            .filter(|x| want.is_empty() || x.title.to_lowercase().contains(&want))
            .take(limit)
            .map(|x| {
                json!({
                    "chat": x.id,
                    "title": x.title,
                    "scope": x.scope,
                    "messages": x.messages,
                    "pinned": x.pinned,
                    "active_at": x.updated_at,
                    "current": x.id == current,
                })
            })
            .collect();
        return Ok(json!({"chats": chats, "total": total}));
    }
    let id = args["id"].as_str().unwrap_or("").trim();
    let sess = store
        .session(id)?
        .ok_or_else(|| format!("no chat with id {id}"))?;
    let msgs: Vec<Value> = store
        .messages(id)?
        .iter()
        .filter(|m| (m.role == "user" || m.role == "assistant") && !m.content.trim().is_empty())
        .map(|m| {
            json!({
                "role": if m.role == "user" { "owner" } else if is_compact(m) { "summary" } else { NAME },
                "text": clip(&m.content, 1500),
                "at": m.created_at,
            })
        })
        .collect();
    let page = args["page"].as_u64().unwrap_or(0) as usize;
    let end = msgs.len().saturating_sub(page.saturating_mul(60));
    let skip = end.saturating_sub(60);
    Ok(json!({
        "chat": sess.id,
        "title": sess.title,
        "scope": sess.scope,
        "page": page,
        "messages": &msgs[skip..end],
        "older_left_out": skip,
        "next_page": if skip > 0 { json!(page + 1) } else { Value::Null },
    }))
}

const NEW_TITLE: &str = "New chat";
const TITLE_SYSTEM: &str = "You name chats. Write a short title (2 to 6 words) for the chat below, in the \
language the owner wrote in, saying what it is about. Plain words only: no quotes, no trailing punctuation, \
no emoji, nothing else.";

/// The first line of a chat's first question (at most 60 characters): its title until the
/// model names it.
fn first_words(store: &Store, id: &str) -> String {
    store
        .messages(id)
        .unwrap_or_default()
        .iter()
        .find(|m| m.role == "user")
        .and_then(|m| m.content.lines().next())
        .unwrap_or("")
        .trim()
        .chars()
        .take(60)
        .collect()
}

/// A short title for a chat from its first exchange (the model writes it).
fn chat_title(store: &Store, id: &str, model: &str, ep: &Endpoint) -> String {
    let msgs = store.messages(id).unwrap_or_default();
    let ask = msgs
        .iter()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();
    let first_line: String = ask
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(60)
        .collect();
    let fallback = if first_line.is_empty() {
        NEW_TITLE.to_string()
    } else {
        first_line
    };
    let reply = msgs
        .iter()
        .rev()
        .find(|m| m.role == "assistant" && !m.content.trim().is_empty() && !is_compact(m))
        .map(|m| m.content.clone())
        .unwrap_or_default();
    // Room for models that think before they answer (a small budget can end before the
    // title is written); the title itself stays a few words.
    let opts = Options {
        temperature: None,
        max_output: Some(600),
        think: false,
        effort: None,
    };
    let prompt = format!(
        "Owner: {}\n\n{NAME}: {}",
        clip(&ask, 800),
        clip(&reply, 800)
    );
    for _ in 0..2 {
        if let Some(t) = title_from(providers::run(
            ep,
            model,
            TITLE_SYSTEM,
            &[Msg::User(prompt.clone())],
            &[],
            &opts,
            &mut |_| true,
        )) {
            return t;
        }
    }
    fallback
}

/// The title in a model's answer, cleaned; None when it wrote nothing usable.
fn title_from(r: Result<providers::Turn, String>) -> Option<String> {
    match r {
        Ok(t) => {
            let line = t
                .text
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .unwrap_or("");
            let clean: String = line
                .trim_matches(|c: char| {
                    matches!(c, '"' | '\'' | '*' | '#' | '`' | '“' | '”' | '«' | '»')
                })
                .trim_end_matches(['.', '!', '?', ':', ';'])
                .trim()
                .chars()
                .take(60)
                .collect();
            if clean.is_empty() || clean.eq_ignore_ascii_case(NEW_TITLE) {
                None
            } else {
                Some(clean)
            }
        }
        Err(_) => None,
    }
}

/// A chat as Markdown: what the owner asked, what Mnemo did (its steps) and answered.
fn chat_markdown(store: &Store, id: &str) -> Result<(String, String), String> {
    let sess = store.session(id)?.ok_or("chat not found")?;
    let msgs = store.messages(id)?;
    let model = msgs
        .iter()
        .rev()
        .find_map(|m| {
            m.meta
                .as_ref()
                .and_then(|v| v["model"].as_str().map(str::to_string))
        })
        .unwrap_or_else(|| sess.model.clone());
    let about = match sess.scope.split_once(':') {
        Some(("note", p)) => format!("about the note {p}"),
        Some(("folder", p)) => format!("about the folder {p}"),
        _ => "about the whole vault".into(),
    };
    let mut md = format!(
        "# {}\n\n*{NAME} chat {about} · started {} · model {}*\n",
        sess.title,
        stamp(sess.created_at),
        if model.is_empty() { "-" } else { &model }
    );
    let mut steps: Vec<String> = Vec::new();
    let mut said = String::new();
    let mut at = 0i64;
    let flush = |md: &mut String, steps: &mut Vec<String>, said: &mut String, at: i64| {
        if steps.is_empty() && said.trim().is_empty() {
            return;
        }
        md.push_str(&format!("\n**{NAME}** · {}\n\n", stamp(at)));
        if !steps.is_empty() {
            md.push_str(&format!("> Steps: {}\n\n", steps.join(" · ")));
        }
        if !said.trim().is_empty() {
            md.push_str(said.trim());
            md.push('\n');
        }
        steps.clear();
        said.clear();
    };
    for m in &msgs {
        match m.role.as_str() {
            "user" => {
                flush(&mut md, &mut steps, &mut said, at);
                md.push_str(&format!(
                    "\n---\n\n**You** · {}\n\n{}\n",
                    stamp(m.created_at),
                    m.content.trim()
                ));
                let att: Vec<&str> = m
                    .meta
                    .as_ref()
                    .and_then(|v| v["attach"].as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(|a| a["title"].as_str().or(a["path"].as_str()))
                    .collect();
                if !att.is_empty() {
                    md.push_str(&format!("\n*Attached: {}*\n", att.join(", ")));
                }
            }
            "assistant" if is_compact(m) => {
                flush(&mut md, &mut steps, &mut said, at);
                md.push_str(&format!(
                    "\n> *Older messages were compacted into this summary:*\n> {}\n",
                    m.content.trim().replace('\n', "\n> ")
                ));
            }
            "assistant" => {
                at = m.created_at;
                if let Some(e) = m.meta.as_ref().and_then(|v| v["error"].as_str()) {
                    said.push_str(&format!("\n*Did not answer: {e}*\n"));
                }
                if !m.content.trim().is_empty() {
                    said.push_str(&format!("\n{}\n", m.content.trim()));
                }
            }
            _ if m.tool_name.as_deref() == Some(SHOW_ITEMS) => {
                let items: Vec<String> = serde_json::from_str::<Value>(&m.content)
                    .ok()
                    .and_then(|v| v["shown"].as_array().cloned())
                    .unwrap_or_default()
                    .iter()
                    .map(|i| match i["kind"].as_str() {
                        Some("note") => format!(
                            "[[{}]]",
                            i["path"].as_str().unwrap_or("").trim_end_matches(".md")
                        ),
                        Some("image") => format!("![[{}]]", i["path"].as_str().unwrap_or("")),
                        Some("folder") => format!("folder `{}`", i["path"].as_str().unwrap_or("")),
                        _ => "the vault".to_string(),
                    })
                    .collect();
                if !items.is_empty() {
                    said.push_str(&format!("\n*Shown:* {}\n", items.join(", ")));
                }
            }
            _ => {
                let line = m
                    .meta
                    .as_ref()
                    .and_then(|v| v["summary"].as_str())
                    .unwrap_or("");
                let name = m.tool_name.as_deref().unwrap_or("tool");
                steps.push(if line.is_empty() {
                    name.to_string()
                } else {
                    format!("{name} ({})", clip(line, 60))
                });
            }
        }
    }
    flush(&mut md, &mut steps, &mut said, at);
    Ok((sess.title, md))
}

/// `GET /api/assistant/sessions/{id}/export` -> the chat as a Markdown file.
async fn h_export(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    match chat_markdown(store, &id) {
        Ok((title, md)) => {
            let name: String = title
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == ' ' || c == '-' {
                        c
                    } else {
                        ' '
                    }
                })
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join("-");
            let name = if name.is_empty() {
                "mnemo-chat".to_string()
            } else {
                name.chars().take(60).collect()
            };
            (
                [
                    (
                        axum::http::header::CONTENT_TYPE,
                        "text/markdown; charset=utf-8".to_string(),
                    ),
                    (
                        axum::http::header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{}.md\"", name.replace('"', "")),
                    ),
                ],
                md,
            )
                .into_response()
        }
        Err(e) => fail(StatusCode::NOT_FOUND, &e),
    }
}

/// `GET /api/assistant/search?q=&limit=` -> `{query, hits: [{chat, title, scope, message_id, role, snippet, at}]}`.
async fn h_search(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    req: axum::extract::Request,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let q = crate::query_value(req.uri(), "q").unwrap_or_default();
    let limit = crate::query_value(req.uri(), "limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(60);
    match search_json(store, q.trim(), limit, None) {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

/// Run `place_image`: the staged bytes go through MCP `upload_image` under Mnemo's name.
fn place_image(st: &AppState, who: &Caller, args: &Value) -> Result<Value, String> {
    let upload = args["upload"].as_str().unwrap_or("").trim();
    let note = args["note"].as_str().unwrap_or("").trim();
    if upload.is_empty() || note.is_empty() {
        return Err("place_image needs upload and note".into());
    }
    let (file, ext, bytes) = uploads::read(st, upload)?;
    let name = args["name"]
        .as_str()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| {
            let stem = n.rsplit(['/', '\\']).next().unwrap_or(n);
            let stem = stem.rsplit_once('.').map_or(stem, |(s, _)| s);
            format!("{stem}.{ext}")
        })
        .unwrap_or(file);
    let mut call = json!({
        "path": note,
        "name": name,
        "data": uploads::base64(&bytes),
        "append": args["append"].as_bool().unwrap_or(true),
    });
    if let Some(alt) = args["alt"].as_str().filter(|a| !a.trim().is_empty()) {
        call["alt"] = json!(alt);
    }
    let v = st
        .mcp
        .call_tool_by("upload_image", &call, who)
        .map_err(|e| e.to_string())?;
    uploads::remove(st, upload);
    Ok(v)
}

fn tool_defs(st: &AppState) -> Vec<ToolDef> {
    let off = st.mcp.disabled_tools();
    let mut defs: Vec<ToolDef> = memora_mcp::catalog()
        .into_iter()
        .filter(|t| TOOLS.contains(&t.name) && !off.contains(t.name))
        .map(|t| ToolDef {
            name: t.name.to_string(),
            description: format!("{} {}", t.description, t.when).trim().to_string(),
            parameters: t.input_schema.clone(),
        })
        .collect();
    // place_image hands its image to upload_image: off when that tool is off.
    if !off.contains("upload_image") {
        defs.push(place_image_def());
    }
    defs.extend(chat_tool_defs());
    defs.push(view_image_def());
    defs.push(show_items_def());
    defs.push(current_time_def());
    defs.push(ask_owner_def());
    defs.extend(docs::defs());
    defs
}

/// What Mnemo can tell the owner about itself (its features change with Memora). Chats
/// keep the prompt they began with; one from before this text gets it added once, at the
/// end, so it stays the same for the rest of that chat.
const FEATURES_MARK: &str = "[Mnemo features 12]";
const FEATURES: &str = "[Mnemo features 12] What you can do in Memora (explain it when the owner asks):\n\
- @mnemo in notes: a line `@mnemo: <request>` anywhere in a note (also in a list item or a quote) asks you. \
A few seconds after the note is saved you run the request in that note's chat, titled \"@mnemo · <note>\" (one chat \
per note: later requests in the same note join it); writing `@mnemo: <request>` into a note yourself (from a chat) asks \
you there too; \
when you are done the request is struck through (~~@mnemo: ...~~) and your reply is quoted right under it in the \
note. The note editor suggests `@mnemo:` when the owner types @ or /mn. Other agents ask you the same way with \
their mention_agent tool and agent \"mnemo\". So yes: mentioning you in a note works on its own.\n\
- Replies keep running on the server when the owner leaves the chat or the page; the chat shows a spinner and \
they can come back to it. Regenerate and Try again run a turn again.\n\
- Each chat keeps the whole conversation for its model; only when it is full the older part is compacted into a \
summary (the memory ring in the composer shows how full it is).\n\
- While you answer, the owner can queue messages (they go out one by one as each reply ends, on every device), \
send one now (your reply is cut where it is and you answer the new message), or stop you (what you wrote stays). \
The chat follows live on every device the owner has it open on.\n\
- The owner picks how hard you think (Auto, Off, Low, Medium, High) for models that can think, and can line up \
fallback models in Settings, Mnemo: when the chat's model fails, the next one carries on.\n\
- Chats are connected: list_chats shows the owner's other chats, search_chats finds words in any of them \
(titles and messages) and read_chat reads one. When the owner points at another chat or something said before, \
look it up instead of guessing, and say which chat it came from. Every chat can also be searched from the chat \
list's search box, downloaded, or saved as a Markdown note from its menu.\n\
- Skills: reusable instructions kept as notes in the folder \"Skills\" (one note per skill; the file name is \
the skill's name, e.g. Skills/tidy-meeting.md, then a line `description: <what it is for>`, then the steps). The \
owner runs one by typing /<name> in the chat (the composer lists them after a slash); its steps then come with \
the message. When asked, make, change or remove skills with your note tools (create_memory, save_memory, \
rename_memory, soft_delete moves one to the Trash); write steps that are clear and reusable.\n\
- Fleeting chats: the owner can start a chat that is not kept; it disappears (with the images sent in it) when \
they leave it, and it is left out of search and of list_chats. Changes you make to notes in it stay.\n\
- Pictures: view_image lets you look at a picture in the vault (one a note shows: its path, or the path as written \
plus the note). A picture on the web (an http address) cannot be opened, as you have no browser: say so, and ask the \
owner to download it and send it in the chat or put it in the note.\n\
- show_items puts notes, folders, images or the vault in your reply as cards that open on a tap.\n\
- ask_owner asks the owner a question with options to tap (and Other); there are two permission modes, \
Ask first (changes wait for an approving answer) and Auto (changes go ahead, long jobs keep going).\n\
- current_time tells the date, time, weekday and the owner's time zone; search_docs and read_docs read \
Memora's own documentation (link the page you used).\n\
- Your tool calls show in Activity under your name, marked with who you worked for (chat, console or a note \
mention); the Mnemo page has your own Activity view.\n\
- The console has you too: /mnemo in the Memora terminal app, with the same chats, models and keys.\n\
- Visuals: when a chart, graph, diagram, timeline or small mock-up explains better than text, you may add one \
self-contained ```html block (inline CSS and JavaScript, or SVG; scripts from https CDNs are allowed). It cannot \
fetch anything, so put the data in the page. Once your reply is done the web app shows it as a file card that \
opens the page beside the chat (full screen on phones), with Preview, Code, Copy and Download. Use it only when it helps, \
keep it light, and never in a reply written into a note. Each page is a file the owner keeps working on, like an \
artifact: its <title> names it. When they ask to change, fix, tidy or restyle a page you made in this chat, start from \
your latest version of it (in this chat, or list_artifacts and read_artifact for one from another chat) and write the whole page again with the same \
<title>, keeping what they did not ask to change: the app shows it as the next version of the same file and opens \
it. Give a page a new <title> only when they ask for a new, separate one.";

fn system_prompt(st: &AppState, scope: &str, extra: Option<&str>) -> String {
    let (stats, note) = {
        let store = crate::store_as(st, None);
        let note = scope
            .strip_prefix("note:")
            .and_then(|p| store.read_note_impl(p).ok())
            .and_then(|v| v["content"].as_str().map(str::to_string));
        (store.stats(), note)
    };
    let today = chrono_today();
    let mut p = format!(
        "You are {NAME}, the agent built into Memora, a self-hosted vault of Markdown notes. You look after \
the owner's notes: find, read, summarise, organise, create, edit, tag, link, move and tidy them with your tools. \
You cannot browse the web, run commands or reach anything outside the notes.\n\n\
Rules:\n\
- Look things up with your tools; never invent note contents, paths or results.\n\
- For a clear request, do it and report briefly what changed. Before moving, merging or trashing several notes, \
say what you will do and ask.\n\
- Images the owner attaches arrive as uploads: put each beside the note it belongs to with place_image (ask \
which note when it is not clear).
- When the owner refers to an earlier conversation, look it up with search_chats and read_chat.\n\
- When your answer is about particular notes, folders or images, hand them over with show_items so they appear \
as cards the owner can open (still name them in your text).\n\
- Prefer patch_memory for small edits. You cannot delete for good; soft_delete moves a note to the Trash, which \
the owner can undo.\n\
- Name notes as [[Note title]] wikilinks and folders by their path.\n\
- Answer in the language the owner writes in. Be concise and concrete, and use Markdown.\n\n\
This chat began on {today} (UTC); for the current date, time, weekday or time zone call current_time. \
For questions about Memora itself (installing, agents and MCP, settings, the API, what changed) use search_docs \
and read_docs, and link the page you used as [its title](its link). The vault has {} notes in {} folders with {} links.\n\n{FEATURES}",
        stats.notes, stats.folders, stats.links
    );
    if let Some(path) = scope.strip_prefix("note:") {
        let body = note;
        p.push_str(&format!(
            "\n\nThe owner opened this chat from the note \"{path}\"."
        ));
        if let Some(b) = body {
            let cut: String = b.chars().take(12_000).collect();
            p.push_str(&format!(
                " Its current text{}:\n<note path=\"{path}\">\n{cut}\n</note>",
                if cut.len() < b.len() {
                    " (cut short; read_memory gives all of it)"
                } else {
                    ""
                }
            ));
        }
    } else if let Some(folder) = scope.strip_prefix("folder:") {
        p.push_str(&format!("\n\nThe owner opened this chat from the folder \"{folder}\"; start there when they say \"here\"."));
    }
    if let Some(x) = extra.filter(|x| !x.trim().is_empty()) {
        p.push_str(&format!("\n\nThe owner's own instructions:\n{}", x.trim()));
    }
    p
}

fn chrono_today() -> String {
    civil_date(memora_state::now())
}

/// `YYYY-MM-DD HH:MM UTC` for a unix time.
fn stamp(secs: i64) -> String {
    let t = secs.rem_euclid(86_400);
    format!(
        "{} {:02}:{:02} UTC",
        civil_date(secs),
        t / 3600,
        (t / 60) % 60
    )
}

fn civil_date(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

fn approx_tokens(text: &str) -> i64 {
    (text.chars().count() as i64 + 3) / 4
}

fn msg_tokens(m: &Msg) -> i64 {
    match m {
        Msg::User(x) => approx_tokens(x),
        // A picture costs roughly this much on the common providers.
        Msg::UserImages { text, images } => approx_tokens(text) + 1100 * images.len() as i64,
        Msg::Assistant { text, calls, .. } => {
            approx_tokens(text)
                + calls
                    .iter()
                    .map(|c| approx_tokens(&c.arguments.to_string()) + 10)
                    .sum::<i64>()
        }
        Msg::Tool { output, .. } => approx_tokens(output),
    }
}

/// Most images sent with one request, from the newest messages back; older ones stay text.
const IMAGES_PER_REQUEST: usize = 6;
/// Largest picture sent to a model (the strictest common limit is 5 MB).
const IMAGE_SEND_MAX: usize = 4_500_000;

/// Load the pictures of the newest user turns for the model; the rest (older, gone after
/// a week, or too large) become a line of text so the model knows one was there.
fn fill_images(st: &AppState, history: &mut [Msg]) {
    let mut left = IMAGES_PER_REQUEST;
    for m in history.iter_mut().rev() {
        let Msg::UserImages { text, images } = m else {
            continue;
        };
        let mut notes = Vec::new();
        for img in images.iter_mut() {
            if left == 0 {
                notes.push(format!("(An earlier image, {}, is not shown again; ask the owner to attach it again if needed.)", img.id));
                continue;
            }
            match uploads::read(st, &img.id) {
                Ok((name, _, bytes)) if bytes.len() <= IMAGE_SEND_MAX => {
                    if let Some((_, media)) = uploads::sniff(&bytes) {
                        img.media = media.to_string();
                        img.data = uploads::base64(&bytes);
                        left -= 1;
                    } else {
                        notes.push(format!("(The image {name} could not be read.)"));
                    }
                }
                Ok((name, _, _)) => notes.push(format!(
                    "(The image {name} is too large to show to the model.)"
                )),
                Err(_) => notes.push(format!("(The image {} is no longer available.)", img.id)),
            }
        }
        if !notes.is_empty() {
            text.push_str("\n\n");
            text.push_str(&notes.join("\n"));
        }
    }
}

/// Turn every picture into text (for models that cannot take images).
fn strip_images(history: &mut [Msg]) -> bool {
    let mut any = false;
    for m in history.iter_mut() {
        if let Msg::UserImages { text, images } = m {
            if images.iter().any(|i| !i.data.is_empty()) {
                any = true;
            }
            let t = format!(
                "{text}\n\n(The owner attached {} image(s); this model cannot look at images.)",
                images.len()
            );
            *m = Msg::User(t);
        }
    }
    any
}

/// Whether a provider error says the model does not take images.
/// Seconds to wait before each new try when the provider is briefly unavailable.
const RETRY_WAITS: [u64; 3] = [3, 8, 20];

/// A failure worth trying again: the provider busy or down for a moment, or the connection lost.
fn transient(e: &str) -> bool {
    let m = e.to_ascii_lowercase();
    // A router may wrap a refusal in a 5xx: no amount of waiting fixes a quota or a key.
    if hopeless(&m) {
        return false;
    }
    if let Some(code) = m
        .split("answered ")
        .nth(1)
        .and_then(|r| r.get(..3))
        .and_then(|d| d.parse::<u16>().ok())
    {
        return matches!(code, 408 | 425 | 429 | 500 | 502 | 503 | 504 | 520..=529);
    }
    m.starts_with("could not reach the provider")
        && [
            "timed out",
            "timeout",
            "reset",
            "refused",
            "broken pipe",
            "connection",
            "dns",
        ]
        .iter()
        .any(|w| m.contains(w))
}

/// Errors no retry fixes: quota or package run out, key refused, model not there.
fn hopeless(lower: &str) -> bool {
    [
        "insufficient_quota",
        "quota",
        "package",
        "billing",
        "credit",
        "[401]",
        "[403]",
        "[404]",
        "answered 401",
        "answered 403",
        "answered 404",
        "no active credentials",
        "model_not_found",
        "does not exist",
        "invalid api key",
        "invalid_api_key",
    ]
    .iter()
    .any(|w| lower.contains(w))
}

/// A few words on why a model failed, for the line where another model takes over.
fn why_failed(e: &str) -> String {
    let m = e.to_ascii_lowercase();
    let short = if m.contains("quota")
        || m.contains("package")
        || m.contains("billing")
        || m.contains("credit")
    {
        "out of quota"
    } else if m.contains("401") || m.contains("403") || m.contains("api key") {
        "its key was refused"
    } else if m.contains("404") || m.contains("not found") || m.contains("does not exist") {
        "model not found"
    } else if m.contains("429") || m.contains("rate") {
        "too busy"
    } else if m.contains("timed out") || m.contains("timeout") {
        "no answer in time"
    } else if m.starts_with("could not reach") {
        "unreachable"
    } else {
        "the provider failed"
    };
    short.to_string()
}

fn refuses_images(e: &str) -> bool {
    let l = e.to_ascii_lowercase();
    ["image", "vision", "multimodal", "image_url", "input_image"]
        .iter()
        .any(|w| l.contains(w))
        && [
            "support",
            "not",
            "invalid",
            "unknown",
            "allowed",
            "cannot",
            "unexpected",
        ]
        .iter()
        .any(|w| l.contains(w))
}

/// Tokens the chat's history takes now (after its latest compaction), before any trimming.
fn history_tokens(messages: &[memora_state::assistant::Message]) -> i64 {
    history_within(messages, i64::MAX)
        .0
        .iter()
        .map(msg_tokens)
        .sum()
}

/// A summary Mnemo wrote of the older part of a chat; it stands in for every message before
/// its `keep_from` message id.
fn is_compact(m: &memora_state::assistant::Message) -> bool {
    m.role == "assistant" && m.meta.as_ref().is_some_and(|v| v["compact"] == true)
}

const COMPACT_INTRO: &str =
    "Summary of this chat so far (older messages were compacted to fit the model's memory):";

/// The stored chat as provider-neutral history: after the latest compaction (its summary goes
/// in front of the first kept message), oldest turns dropped until it fits `budget` tokens
/// (a turn starts at a user message, so calls and their results stay together).
/// The pictures view_image opened, as a message with the images (after the tool results).
fn opened_pictures(seen: &mut Vec<(String, String)>) -> Msg {
    let names: Vec<String> = seen.iter().map(|(p, _)| p.clone()).collect();
    let images = seen
        .drain(..)
        .map(|(_, id)| providers::Img {
            id,
            media: String::new(),
            data: String::new(),
        })
        .collect();
    Msg::UserImages {
        text: format!(
            "(The picture{} you opened with view_image: {}.)",
            if names.len() == 1 { "" } else { "s" },
            names.join(", ")
        ),
        images,
    }
}

fn history_within(messages: &[memora_state::assistant::Message], budget: i64) -> (Vec<Msg>, bool) {
    let (summary, keep_from, marker_id) = match messages.iter().rev().find(|m| is_compact(m)) {
        Some(c) => (
            c.content.clone(),
            c.meta
                .as_ref()
                .and_then(|v| v["keep_from"].as_i64())
                .unwrap_or(0),
            c.id,
        ),
        None => (String::new(), 0, 0),
    };
    let mut seen_images: Vec<(String, String)> = Vec::new();
    let mut prefixed = summary.is_empty();
    let mut turns: Vec<Vec<Msg>> = Vec::new();
    for m in messages {
        if is_compact(m) || m.id < keep_from {
            continue;
        }
        // A failed turn is stored for the chat view only; it never goes back to the model.
        if m.role == "assistant" && m.content.is_empty() && m.tool_calls.is_none() {
            continue;
        }
        let msg = match m.role.as_str() {
            "user" => {
                turns.push(Vec::new());
                let mut text = match m.meta.as_ref().and_then(|v| v["context"].as_str()).filter(|c| !c.is_empty()) {
                    Some(ctx) => format!(
                        "The owner attached these from the vault (a snapshot taken when they sent this message; \
read_memory gives the current text):\n{ctx}\n\n{}",
                        m.content
                    ),
                    None => m.content.clone(),
                };
                if let Some(sk) = m
                    .meta
                    .as_ref()
                    .map(|v| &v["skill"])
                    .filter(|v| v.is_object())
                {
                    text = format!(
                        "(The owner ran the skill /{} kept in the note {}. Follow its steps for this request; \
the rest of the message after the skill name is what to apply it to.)\n<skill>\n{}\n</skill>\n\n{text}",
                        sk["name"].as_str().unwrap_or(""),
                        sk["path"].as_str().unwrap_or(""),
                        sk["text"].as_str().unwrap_or("")
                    );
                }
                match m.meta.as_ref().and_then(|v| v["mode"].as_str()) {
                    Some("auto") => text.push_str("\n\n(Mode: Auto. Go ahead with changes without asking, and keep going until the job is done; report what you changed.)"),
                    Some("ask") => text.push_str("\n\n(Mode: Ask first. Read and look freely, but before changing notes ask me with ask_owner and an option marked approve.)"),
                    _ => {}
                }
                if let Some(mn) = m
                    .meta
                    .as_ref()
                    .map(|v| &v["mention"])
                    .filter(|v| v.is_object())
                {
                    let (path, line) = (
                        mn["path"].as_str().unwrap_or(""),
                        mn["line"].as_i64().unwrap_or(0),
                    );
                    text = format!("{text}\n\n{}", mentions::instruction(path, line));
                }
                if !prefixed {
                    text = format!("{COMPACT_INTRO}\n{summary}\n\n---\n\n{text}");
                    prefixed = true;
                }
                // Pictures the owner attached go to the model as images (bytes added later).
                let images: Vec<providers::Img> = m
                    .meta
                    .as_ref()
                    .and_then(|v| v["attach"].as_array())
                    .into_iter()
                    .flatten()
                    .filter(|a| a["kind"] == "image")
                    .filter_map(|a| a["path"].as_str())
                    .map(|id| providers::Img {
                        id: id.to_string(),
                        media: String::new(),
                        data: String::new(),
                    })
                    .collect();
                if images.is_empty() {
                    Msg::User(text)
                } else {
                    Msg::UserImages { text, images }
                }
            }
            "assistant" => Msg::Assistant {
                text: m.content.clone(),
                calls: m
                    .tool_calls
                    .as_ref()
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .map(|c| ToolCall {
                                id: c["id"].as_str().unwrap_or("").to_string(),
                                name: c["name"].as_str().unwrap_or("").to_string(),
                                arguments: c["arguments"].clone(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                // Thinking from before a compaction was bound to the old history.
                raw: m
                    .meta
                    .as_ref()
                    .map(|v| v["raw"].clone())
                    .filter(|r| r.is_array() && m.id > marker_id),
            },
            _ => {
                // A picture view_image opened goes to the model after this step's results.
                if m.tool_name.as_deref() == Some(VIEW_IMAGE) {
                    if let Ok(v) = serde_json::from_str::<Value>(&m.content) {
                        if let Some(id) = v["image"].as_str() {
                            seen_images.push((
                                v["path"].as_str().unwrap_or("").to_string(),
                                id.to_string(),
                            ));
                        }
                    }
                }
                Msg::Tool {
                    call_id: m.tool_call_id.clone().unwrap_or_default(),
                    name: m.tool_name.clone().unwrap_or_default(),
                    output: m.content.clone(),
                }
            }
        };
        if turns.is_empty() {
            turns.push(Vec::new());
        }
        let is_tool = matches!(msg, Msg::Tool { .. });
        let turn = turns.last_mut().expect("pushed");
        if !is_tool && !seen_images.is_empty() {
            turn.push(opened_pictures(&mut seen_images));
        }
        turn.push(msg);
    }
    if !seen_images.is_empty() {
        if turns.is_empty() {
            turns.push(Vec::new());
        }
        turns
            .last_mut()
            .expect("pushed")
            .push(opened_pictures(&mut seen_images));
    }
    let size = |t: &Vec<Msg>| -> i64 { t.iter().map(msg_tokens).sum() };
    let mut total: i64 = turns.iter().map(size).sum();
    let mut trimmed = false;
    while turns.len() > 1 && total > budget {
        total -= size(&turns[0]);
        turns.remove(0);
        trimmed = true;
    }
    let mut out: Vec<Msg> = turns.into_iter().flatten().collect();
    if trimmed {
        // Leaving out earlier turns changes what thinking blocks were bound to: send none.
        for m in &mut out {
            if let Msg::Assistant { raw, .. } = m {
                *raw = None;
            }
        }
    }
    (out, trimmed)
}

/// Most items one message may attach, and how much of them goes to the model.
const ATTACH_MAX: usize = 8;
const ATTACH_NOTE_CHARS: usize = 8_000;
const ATTACH_TOTAL_CHARS: usize = 30_000;
const ATTACH_FOLDER_NOTES: usize = 200;

/// `attach: [{kind: "note"|"folder", path}]` from a chat request.
fn parse_attach(b: &Value) -> Result<Vec<(String, String)>, String> {
    let Some(list) = b.get("attach").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    if list.len() > ATTACH_MAX {
        return Err(format!("attach at most {ATTACH_MAX} notes or folders"));
    }
    let mut out = Vec::new();
    for a in list {
        let kind = a["kind"].as_str().unwrap_or("");
        let path = a["path"].as_str().unwrap_or("").trim().to_string();
        if !matches!(kind, "note" | "folder" | "image")
            || path.len() > 1024
            || path.chars().any(char::is_control)
        {
            return Err("attach items are {kind: note|folder|image, path}".into());
        }
        if !out.iter().any(|(k, p)| k == kind && *p == path) {
            out.push((kind.to_string(), path));
        }
    }
    Ok(out)
}

/// What the model gets for the attached items, and the items as the chat shows them.
fn attach_snapshot(st: &AppState, wanted: &[(String, String)]) -> Result<(Value, String), String> {
    let store = crate::store_as(st, None);
    let mut items = Vec::new();
    let mut text = String::new();
    for (kind, path) in wanted {
        let room = ATTACH_TOTAL_CHARS.saturating_sub(text.chars().count());
        if room < 200 {
            break;
        }
        if kind == "image" {
            let (name, _, bytes) = uploads::read(st, path)?;
            text.push_str(&format!(
                "<attached kind=\"image\" upload=\"{path}\" name=\"{name}\" bytes=\"{}\">An image the owner attached. It is not in \
the vault yet: call place_image with upload \"{path}\" to put it beside the note it belongs to (and into that note's text).</attached>\n",
                bytes.len()
            ));
            items.push(json!({"kind": "image", "path": path, "title": name, "bytes": bytes.len()}));
        } else if kind == "note" {
            let v = store
                .read_note_impl(path)
                .map_err(|e| format!("{path}: {e}"))?;
            let body = v["content"].as_str().unwrap_or("");
            let take = room.min(ATTACH_NOTE_CHARS);
            let cut: String = body.chars().take(take).collect();
            let more = body.chars().count() > take;
            let title = path
                .rsplit('/')
                .next()
                .unwrap_or(path)
                .trim_end_matches(".md")
                .to_string();
            text.push_str(&format!(
                "<attached kind=\"note\" path=\"{path}\">\n{cut}{}\n</attached>\n",
                if more {
                    "\n… (cut short; read_memory gives all of it)"
                } else {
                    ""
                }
            ));
            items.push(json!({"kind": "note", "path": path, "title": title}));
        } else {
            let folder = path.trim_matches('/');
            let prefix = if folder.is_empty() || folder.eq_ignore_ascii_case("root") {
                String::new()
            } else {
                format!("{folder}/")
            };
            let mut notes: Vec<String> = store
                .tree()
                .into_values()
                .flatten()
                .map(|n| n.path)
                .filter(|p| p.starts_with(&prefix))
                .collect();
            if notes.is_empty() && !prefix.is_empty() {
                return Err(format!("{folder}: no such folder, or it has no notes"));
            }
            notes.sort();
            let n = notes.len();
            let list: String = notes
                .iter()
                .take(ATTACH_FOLDER_NOTES)
                .map(|p| format!("- {p}\n"))
                .collect::<String>()
                .chars()
                .take(room.saturating_sub(120))
                .collect();
            // Only the list goes along: Mnemo reads the notes itself, one at a time, so a big
            // folder (or the whole vault) never floods the model's memory.
            let how = if n > 25 {
                format!(
                    "Work through these one note at a time with read_memory, in this order, as far as the request \
needs; with this many ({n}), go in batches, keep short notes of what you found, and say how far you got and what \
is left. list_memory with folder \"{folder}\" pages through the rest.\n"
                )
            } else {
                "Read the ones the request needs with read_memory, one at a time.\n".to_string()
            };
            text.push_str(&format!(
                "<attached kind=\"folder\" path=\"{folder}\" notes=\"{n}\">\n{how}{list}{}</attached>\n",
                if n > ATTACH_FOLDER_NOTES {
                    format!("… and {} more\n", n - ATTACH_FOLDER_NOTES)
                } else {
                    String::new()
                }
            ));
            let title = if folder.is_empty() {
                "All notes".to_string()
            } else {
                folder.rsplit('/').next().unwrap_or(folder).to_string()
            };
            items.push(json!({"kind": "folder", "path": folder, "title": title, "notes": n}));
        }
    }
    Ok((json!(items), text))
}

/// Chats with a run in progress (one run per chat at a time).
fn busy() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static BUSY: OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    BUSY.get_or_init(Default::default)
}

fn send(tx: &tokio::sync::mpsc::UnboundedSender<String>, v: Value) -> bool {
    tx.send(v.to_string()).is_ok()
}

/// A short line about a tool result for the chat's tool card.
fn summary(v: &Value) -> String {
    if let Some(a) = v.as_array() {
        return format!("{} result{}", a.len(), if a.len() == 1 { "" } else { "s" });
    }
    for k in [
        "path", "restored", "trashed", "to", "name", "count", "total",
    ] {
        if let Some(x) = v.get(k) {
            if let Some(s) = x.as_str() {
                return format!("{k}: {s}");
            }
            if x.is_number() {
                return format!("{k}: {x}");
            }
        }
    }
    if v.get("ok").and_then(Value::as_bool) == Some(true) {
        return "done".into();
    }
    String::new()
}

// ---------------- skills ----------------

/// Skills are notes in this folder of the vault, one per skill: the file name is the name the
/// owner types after a slash (`/tidy-meeting`), a `description:` line (or the first line) says
/// what it is for, and the rest are the steps. Mnemo makes and keeps them with its note tools.
pub const SKILLS: &str = "Skills";

struct Skill {
    name: String,
    path: String,
    description: String,
}

fn vault_dir(st: &AppState) -> Option<std::path::PathBuf> {
    st.vault.read().ok()?.as_ref().map(std::path::PathBuf::from)
}

fn skills(st: &AppState) -> Vec<Skill> {
    let Some(dir) = vault_dir(st).map(|v| v.join(SKILLS)) else {
        return Vec::new();
    };
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<Skill> = rd
        .flatten()
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().to_string();
            let name = file.strip_suffix(".md")?.to_string();
            if name.starts_with('.') || !e.path().is_file() {
                return None;
            }
            let text = std::fs::read_to_string(e.path()).unwrap_or_default();
            Some(Skill {
                description: skill_description(&text),
                path: format!("{SKILLS}/{file}"),
                name,
            })
        })
        .collect();
    out.sort_by_key(|s| s.name.to_lowercase());
    out
}

/// A skill's `description:` (front matter or a line of its own), else its first plain line.
fn skill_description(text: &str) -> String {
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    if let Some(d) = lines.iter().find_map(|l| l.strip_prefix("description:")) {
        return clip(d.trim().trim_matches('"'), 140);
    }
    // Past the front matter, the first line that is not a heading.
    let body = match lines.first() {
        Some(&"---") => lines
            .iter()
            .skip(1)
            .position(|l| *l == "---")
            .map_or(&lines[..0], |end| &lines[end + 2..]),
        _ => &lines[..],
    };
    let line = body
        .iter()
        .find(|l| !l.is_empty() && !l.starts_with('#'))
        .copied()
        .unwrap_or("");
    clip(line, 140)
}

/// `/name rest` at the start of a message: the skill it runs, with its text.
fn skill_for(st: &AppState, text: &str) -> Option<(Skill, String)> {
    let name = text.strip_prefix('/')?.split_whitespace().next()?;
    let sk = skills(st)
        .into_iter()
        .find(|s| s.name.eq_ignore_ascii_case(name))?;
    let body = crate::store_as(st, None)
        .read_note_impl(&sk.path)
        .ok()
        .and_then(|v| v["content"].as_str().map(str::to_string))?;
    Some((sk, body))
}

async fn h_skills(State(st): State<AppState>, key: Option<Extension<ApiKeyCaller>>) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    let st2 = st.clone();
    let list = crate::blocking(move || skills(&st2)).await;
    Json(json!({
        "folder": SKILLS,
        "skills": list.iter().map(|s| json!({"name": s.name, "path": s.path, "description": s.description})).collect::<Vec<_>>(),
    }))
    .into_response()
}

// ---------------- suggestions on a new chat ----------------

/// The owner's own suggestions (`suggestions`: a list of strings) and Mnemo's (`ai_suggestions`:
/// `{at, items}`, written from the vault's recent notes at most every SUGGEST_EVERY seconds).
const OWN_SUGGESTIONS: &str = "suggestions";
const AI_SUGGESTIONS: &str = "ai_suggestions";
const SUGGEST_EVERY: i64 = 12 * 3600;

async fn h_suggestions(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let prefs = store.prefs().unwrap_or_default();
    let own = prefs.get(OWN_SUGGESTIONS).cloned().unwrap_or(json!([]));
    let ai = prefs.get(AI_SUGGESTIONS).cloned().unwrap_or(json!({}));
    let stale = ai["at"].as_i64().unwrap_or(0) < memora_state::now() - SUGGEST_EVERY;
    if stale {
        // Write new ones in the background; this answer has the ones from before.
        let st2 = st.clone();
        tokio::task::spawn_blocking(move || {
            refresh_suggestions(&st2);
        });
    }
    Json(json!({"own": own, "ai": ai["items"].clone()})).into_response()
}

async fn h_suggestions_set(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let Some(list) = b.get("own").and_then(Value::as_array) else {
        return bad("send {own: [text, ...]}");
    };
    let own: Vec<String> = list
        .iter()
        .filter_map(Value::as_str)
        .map(|t| t.trim().chars().take(200).collect::<String>())
        .filter(|t| !t.is_empty())
        .take(30)
        .collect();
    let v = if own.is_empty() {
        Value::Null
    } else {
        json!(own)
    };
    if let Err(e) = store.set_pref(OWN_SUGGESTIONS, &v) {
        return bad(&e);
    }
    Json(json!({"own": own})).into_response()
}

/// The names of the notes changed most recently (skills left out).
fn recent_titles(st: &AppState, n: usize) -> Vec<String> {
    let notes = crate::store_as(st, None).walk();
    let mut dated: Vec<(std::time::SystemTime, String)> = notes
        .into_iter()
        .filter(|(rel, _, _)| !rel.starts_with(&format!("{SKILLS}/")))
        .filter_map(|(_, name, full)| Some((std::fs::metadata(&full).ok()?.modified().ok()?, name)))
        .collect();
    dated.sort_by_key(|d| std::cmp::Reverse(d.0));
    dated.into_iter().take(n).map(|(_, name)| name).collect()
}

/// "Fresh ideas": write Mnemo's suggestions again now (the owner's own stay as they are).
async fn h_suggestions_refresh(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let st2 = st.clone();
    let fresh = crate::blocking(move || refresh_suggestions(&st2)).await;
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let prefs = store.prefs().unwrap_or_default();
    Json(json!({
        "own": prefs.get(OWN_SUGGESTIONS).cloned().unwrap_or(json!([])),
        "ai": prefs.get(AI_SUGGESTIONS).map(|v| v["items"].clone()).unwrap_or(json!([])),
        "fresh": fresh,
    }))
    .into_response()
}

static SUGGESTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Ask the default model for a few things worth asking, from the titles of recent notes.
fn refresh_suggestions(st: &AppState) -> bool {
    use std::sync::atomic::Ordering;
    if SUGGESTING.swap(true, Ordering::SeqCst) {
        return false;
    }
    let run = || -> Option<Vec<String>> {
        let store = store(st).ok()?;
        let (provider, model) = resolve_model(store, None, None).ok()?;
        let ep = endpoint(st, store, &provider).ok()?;
        let recent = recent_titles(st, 40);
        if recent.is_empty() {
            return None;
        }
        let prompt = format!(
            "Recently changed notes in the owner's vault:\n{}\n\nWrite 6 short requests (at most 12 words each) the owner \
might ask {NAME}, their notes agent, about these notes right now: finding, summarising, linking, tidying, planning. \
Write them in the language most of the titles are in. One per line, no numbers, no quotes, nothing else.",
            recent.join("\n")
        );
        let opts = Options {
            temperature: None,
            max_output: Some(800),
            think: false,
            effort: None,
        };
        let t = providers::run(
            &ep,
            &model,
            "You suggest useful requests. Plain lines only.",
            &[Msg::User(prompt)],
            &[],
            &opts,
            &mut |_| true,
        )
        .ok()?;
        let items: Vec<String> = t
            .text
            .lines()
            .map(|l| {
                l.trim()
                    .trim_start_matches(['-', '*', '•', ' '])
                    .trim_matches('"')
                    .trim()
            })
            .filter(|l| l.len() > 6 && l.chars().count() <= 120)
            .take(6)
            .map(str::to_string)
            .collect();
        (!items.is_empty()).then_some(items)
    };
    let items = run();
    let fresh = items.is_some();
    if let Ok(store) = store(st) {
        let old = store
            .prefs()
            .unwrap_or_default()
            .get(AI_SUGGESTIONS)
            .cloned()
            .unwrap_or(json!({}));
        // Tried either way, so a model that fails is not asked on every new chat.
        let items = items
            .map(|i| json!(i))
            .unwrap_or_else(|| old["items"].clone());
        let _ = store.set_pref(
            AI_SUGGESTIONS,
            &json!({"at": memora_state::now(), "items": items}),
        );
    }
    SUGGESTING.store(false, Ordering::SeqCst);
    fresh
}

/// A turn ready to run: the owner's message is stored, the model is picked.
struct Prepared {
    scope: String,
    provider: String,
    model: String,
    ep: Endpoint,
}

type Refusal = (StatusCode, String);

/// Store the owner's message in chat `id` from a `/chat` request body (also a queued one)
/// and pick the model for its reply. Every device with the chat open hears the message.
fn prepare_turn(
    st: &AppState,
    store: &'static Store,
    id: &str,
    b: &Value,
    via: &str,
) -> Result<Prepared, Refusal> {
    let badr = |m: &str| (StatusCode::BAD_REQUEST, m.to_string());
    let Some(text) = s(b, "text").filter(|t| !t.is_empty()) else {
        return Err(badr("text is required"));
    };
    if text.chars().count() > 40_000 {
        return Err(badr("the message is too long (40000 characters at most)"));
    }
    let Some(sess) = store.session(id).ok().flatten() else {
        return Err((StatusCode::NOT_FOUND, "chat not found".into()));
    };
    let asked = s(b, "model").filter(|m| !m.is_empty());
    let (provider, model) = resolve_model(
        store,
        asked.as_deref(),
        Some(&sess.model)
            .filter(|m| !m.is_empty())
            .map(String::as_str),
    )
    .map_err(|e| badr(&e))?;
    let ep = endpoint(st, store, &provider).map_err(|e| badr(&e))?;
    // Notes and folders the owner attached from the vault: a snapshot goes with this message
    // (and stays in the chat's context for later turns).
    let wanted = parse_attach(b).map_err(|e| badr(&e))?;
    let mut meta = if wanted.is_empty() {
        None
    } else {
        let (items, context) = attach_snapshot(st, &wanted).map_err(|e| badr(&e))?;
        Some(json!({"attach": items, "context": context}))
    };
    // An answer to one of Mnemo's questions (a tapped option or "Other").
    if let Some(a) = b.get("answer").filter(|a| a.is_object()) {
        let m = meta.get_or_insert_with(|| json!({}));
        m["answer"] = json!({
            "to": a["to"].as_str().map(|t| t.chars().take(80).collect::<String>()),
            "approve": a["approve"] == true,
            "other": a["other"] == true,
        });
    }
    // The permission mode this message was sent in (Mnemo is told with it).
    let prefs = store.prefs().unwrap_or_default();
    let mode = if prefs.get("permission").and_then(Value::as_str) == Some("auto") {
        "auto"
    } else {
        "ask"
    };
    meta.get_or_insert_with(|| json!({}))["mode"] = json!(mode);
    if via != "chat" {
        meta.get_or_insert_with(|| json!({}))["via"] = json!(via);
    }
    // The owner's time zone (from the browser), for current_time.
    let tz = s(b, "tz").filter(|t| {
        t.len() <= 64
            && t.chars()
                .all(|c| c.is_ascii_alphanumeric() || "/_+-".contains(c))
    });
    let off = b
        .get("tz_offset")
        .and_then(Value::as_i64)
        .filter(|o| o.abs() <= 16 * 60);
    if tz.is_some() || off.is_some() {
        let m = meta.get_or_insert_with(|| json!({}));
        if let Some(t) = tz {
            m["tz"] = json!(t);
        }
        if let Some(o) = off {
            m["tz_offset"] = json!(o);
        }
    }
    // `/name ...` runs one of the owner's skills: its steps go with this message.
    if let Some((sk, body)) = skill_for(st, &text) {
        meta.get_or_insert_with(|| json!({}))["skill"] =
            json!({"name": sk.name, "path": sk.path, "text": clip(&body, 20_000)});
    }
    // The chat's first message carries the system prompt it will keep for its whole life.
    if store.messages(id).map(|m| m.is_empty()).unwrap_or(false) {
        let extra = prefs
            .get("system_prompt")
            .and_then(Value::as_str)
            .map(str::to_string);
        let prompt = system_prompt(st, &sess.scope, extra.as_deref());
        meta.get_or_insert_with(|| json!({}))["system"] = json!(prompt);
    }
    let now = memora_state::now();
    let shown = meta.as_ref().map(|m| {
        let mut m = m.clone();
        if let Some(o) = m.as_object_mut() {
            o.remove("system");
            o.remove("context");
            if let Some(sk) = o.get_mut("skill").and_then(Value::as_object_mut) {
                sk.remove("text");
            }
        }
        m
    });
    let uid = store
        .append(
            id,
            &NewMessage {
                role: "user".into(),
                content: text.clone(),
                meta,
                ..Default::default()
            },
            now,
        )
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "could not store the message".to_string(),
            )
        })?;
    // The title stays "New chat" until the first reply: Mnemo names the chat then. A chat
    // with no model of its own keeps the one that answers now.
    if let Some(a) = &asked {
        let _ = store.update_session(id, None, Some(a), None, None);
    } else if sess.model.is_empty() {
        let _ = store.update_session(id, None, Some(&format!("{provider}/{model}")), None, None);
    }
    live::notify(
        id,
        &json!({"type": "user", "via": via, "client": s(b, "client"),
            "message": {"id": uid, "session_id": id, "role": "user", "content": text, "meta": shown, "created_at": now}}),
    );
    Ok(Prepared {
        scope: sess.scope,
        provider,
        model,
        ep,
    })
}

/// Claim chat `id` for one reply (`false`: one is already running or starting).
fn claim(id: &str) -> bool {
    busy().lock().is_ok_and(|mut b| b.insert(id.to_string()))
}

fn unclaim(id: &str) {
    if let Ok(mut b) = busy().lock() {
        b.remove(id);
    }
}

async fn h_chat(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    if store.session(&id).ok().flatten().is_none() {
        return fail(StatusCode::NOT_FOUND, "chat not found");
    }
    if !claim(&id) {
        return fail(
            StatusCode::CONFLICT,
            "Mnemo is still answering in this chat",
        );
    }
    let (st2, id2) = (st.clone(), id.clone());
    match crate::blocking(move || prepare_turn(&st2, store, &id2, &b, "chat")).await {
        Ok(p) => {
            begin_run(&st, store, &id, p, on_behalf(&st, &headers));
            live::sse(&id).unwrap_or_else(|| {
                fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "the reply could not start",
                )
            })
        }
        Err((code, e)) => {
            unclaim(&id);
            fail(code, &e)
        }
    }
}

/// Who Mnemo works for in a browser or console request (for Activity).
fn on_behalf(st: &AppState, headers: &HeaderMap) -> String {
    let user = crate::cache::session_of(st, headers)
        .map(|w| w.user)
        .unwrap_or_else(|| "owner".into());
    let via = if headers
        .get("x-memora-client")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("console"))
    {
        "console"
    } else {
        "chat"
    };
    format!("{user} · {via}")
}

/// Run Mnemo on chat `id` (already claimed) in the background: the reply goes on without a
/// viewer (see `live`). When it ends, the chat's queue goes on: the next message is sent the
/// same way, until the queue is empty or paused after a failed reply.
fn begin_run(st: &AppState, store: &'static Store, id: &str, p: Prepared, on_behalf: String) {
    let tx = live::start(id);
    let (st2, id2) = (st.clone(), id.to_string());
    tokio::task::spawn_blocking(move || {
        let (mut tx, mut p) = (tx, p);
        loop {
            let out = run_agent(
                &st2,
                store,
                &id2,
                &p.scope,
                &p.provider,
                &p.model,
                &p.ep,
                &tx,
                &on_behalf,
            );
            drop(tx);
            live::notify(&id2, &json!({"type": "idle", "outcome": out.word()}));
            let Some(q) = live::queue_next(&id2, out == Outcome::Failed, true) else {
                break;
            };
            match prepare_turn(&st2, store, &id2, &q.body, "queue") {
                Ok(np) => {
                    p = np;
                    tx = live::start(&id2);
                }
                Err((_, e)) => {
                    live::requeue(&id2, q, true);
                    live::notify(&id2, &json!({"type": "queue_error", "message": e}));
                    break;
                }
            }
        }
        unclaim(&id2);
    });
}

/// Start the next queued message of chat `id` when no reply is running (it was sent now,
/// or the queue was resumed). A failed reply before it holds it unless `forced`.
pub(crate) fn kick(
    st: &AppState,
    store: &'static Store,
    id: &str,
    on_behalf: String,
    failed: bool,
    after_run: bool,
) {
    if !claim(id) {
        return;
    }
    let Some(q) = live::queue_next(id, failed, after_run) else {
        unclaim(id);
        return;
    };
    match prepare_turn(st, store, id, &q.body, "queue") {
        Ok(p) => begin_run(st, store, id, p, on_behalf),
        Err((_, e)) => {
            live::requeue(id, q, true);
            live::notify(id, &json!({"type": "queue_error", "message": e}));
            unclaim(id);
        }
    }
}

/// How a reply ended.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Outcome {
    Done,
    Stopped,
    Failed,
}

impl Outcome {
    fn word(self) -> &'static str {
        match self {
            Outcome::Done => "done",
            Outcome::Stopped => "stopped",
            Outcome::Failed => "failed",
        }
    }
}

/// `GET /api/assistant/sessions/{id}/live`: watch the reply running in this chat (its
/// events from the start, then live, as server-sent events); `204` when none is running.
async fn h_live(key: Option<Extension<ApiKeyCaller>>, UrlPath(id): UrlPath<String>) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    live::sse(&id).unwrap_or_else(|| StatusCode::NO_CONTENT.into_response())
}

/// `POST /api/assistant/sessions/{id}/steer` `{text, attach?, model?, tz?, client?}`: send
/// this message now. A reply running is cut where it is (what it wrote so far stays) and
/// Mnemo answers this message as a new turn; with no reply running it is sent at once.
async fn h_steer(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let Some(text) = s(&b, "text").filter(|t| !t.is_empty()) else {
        return bad("text is required");
    };
    if store.session(&id).ok().flatten().is_none() {
        return fail(StatusCode::NOT_FOUND, "chat not found");
    }
    live::enqueue(&id, &text, b, true);
    live::force_next(&id);
    go_now(&st, &headers, store, &id).await;
    Json(json!({"ok": true, "queue": live::queue_json(&id)})).into_response()
}

/// The first queued message goes now: cut the reply running for it, or start it.
async fn go_now(st: &AppState, headers: &HeaderMap, store: &'static Store, id: &str) {
    if !live::cancel(id) {
        let (st2, id2, who) = (st.clone(), id.to_string(), on_behalf(st, headers));
        crate::blocking(move || kick(&st2, store, &id2, who, false, false)).await;
    }
}

/// `POST /api/assistant/sessions/{id}/stop`: end the reply running in this chat. What it
/// wrote so far stays; the next queued message (if any) goes out.
async fn h_stop(
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    Json(json!({"stopped": live::cancel(&id)})).into_response()
}

/// `GET /api/assistant/sessions/{id}/queue`: the messages waiting for this chat's reply.
async fn h_queue(key: Option<Extension<ApiKeyCaller>>, UrlPath(id): UrlPath<String>) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    Json(live::queue_json(&id)).into_response()
}

/// `POST /api/assistant/sessions/{id}/queue` `{text, attach?, model?, tz?, client?}`: add a
/// message that goes out when the reply running ends (at once when none is running).
async fn h_queue_add(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let Some(text) = s(&b, "text").filter(|t| !t.is_empty()) else {
        return bad("text is required");
    };
    if text.chars().count() > 40_000 {
        return bad("the message is too long (40000 characters at most)");
    }
    if store.session(&id).ok().flatten().is_none() {
        return fail(StatusCode::NOT_FOUND, "chat not found");
    }
    let qid = live::enqueue(&id, &text, b, false);
    // The reply may have ended meanwhile: then this goes now (unless the queue is paused).
    if !live::running(&id) {
        let (st2, id2, who) = (st.clone(), id.clone(), on_behalf(&st, &headers));
        crate::blocking(move || kick(&st2, store, &id2, who, false, false)).await;
    }
    Json(json!({"id": qid, "queue": live::queue_json(&id)})).into_response()
}

/// `POST /api/assistant/sessions/{id}/queue/{qid}` `{op: del|up|down|move|send, to?}`:
/// change a queued message; `send` sends it now (cutting the reply running).
async fn h_queue_op(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath((id, qid)): UrlPath<(String, String)>,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let op = s(&b, "op").unwrap_or_default();
    let to = b.get("to").and_then(Value::as_u64).unwrap_or(0) as usize;
    match qid.as_str() {
        "clear" => live::queue_clear(&id),
        "resume" => {
            live::queue_resume(&id);
            if !live::running(&id) {
                go_now(&st, &headers, store, &id).await;
            }
        }
        q => {
            let Ok(n) = q.parse::<u64>() else {
                return bad("unknown queued message");
            };
            if !["del", "up", "down", "move", "send"].contains(&op.as_str()) {
                return bad("op must be del, up, down, move or send");
            }
            if !live::queue_op(&id, n, &op, to) {
                return fail(StatusCode::NOT_FOUND, "that message is no longer queued");
            }
            if op == "send" {
                go_now(&st, &headers, store, &id).await;
            }
        }
    }
    Json(live::queue_json(&id)).into_response()
}

/// `GET /api/assistant/sessions/{id}/watch`: what happens in this chat from now on, as
/// server-sent events (new messages from any device, replies starting and ending, the
/// queue), so every device with the chat open stays in step.
async fn h_watch(key: Option<Extension<ApiKeyCaller>>, UrlPath(id): UrlPath<String>) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    live::watch(&id)
}

/// `POST /api/assistant/sessions/{id}/rerun` `{message_id, model?}`: run the turn of one of
/// the owner's messages again. Everything after that message goes (replies, later turns),
/// then the reply streams like `/chat`.
async fn h_rerun(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let Some(sess) = store.session(&id).ok().flatten() else {
        return fail(StatusCode::NOT_FOUND, "chat not found");
    };
    if busy().lock().is_ok_and(|b| b.contains(&id)) {
        return fail(
            StatusCode::CONFLICT,
            "Mnemo is still answering in this chat",
        );
    }
    let msgs = store.messages(&id).unwrap_or_default();
    let mid = b.get("message_id").and_then(Value::as_i64);
    let Some(user) = mid
        .and_then(|m| msgs.iter().find(|x| x.id == m))
        .or_else(|| {
            if mid.is_none() {
                msgs.iter().rev().find(|x| x.role == "user")
            } else {
                None
            }
        })
        .filter(|x| x.role == "user")
    else {
        return bad("message_id must be one of the owner's messages in this chat");
    };
    let asked = s(&b, "model").filter(|m| !m.is_empty());
    let (provider, model) = match resolve_model(
        store,
        asked.as_deref(),
        Some(&sess.model)
            .filter(|m| !m.is_empty())
            .map(String::as_str),
    ) {
        Ok(x) => x,
        Err(e) => return bad(&e),
    };
    let ep = match endpoint(&st, store, &provider) {
        Ok(e) => e,
        Err(e) => return bad(&e),
    };
    if !claim(&id) {
        return fail(
            StatusCode::CONFLICT,
            "Mnemo is still answering in this chat",
        );
    }
    if let Err(e) = store.delete_after(&id, user.id) {
        unclaim(&id);
        return fail(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    if let Some(a) = &asked {
        let _ = store.update_session(&id, None, Some(a), None, None);
    }
    // Other devices drop the replaced turns.
    live::notify(&id, &json!({"type": "reload"}));
    let p = Prepared {
        scope: sess.scope,
        provider,
        model,
        ep,
    };
    begin_run(&st, store, &id, p, on_behalf(&st, &headers));
    live::sse(&id).unwrap_or_else(|| {
        fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "the reply could not start",
        )
    })
}

/// What one model gets in one chat: its limits, the chat's frozen prompt, the tools and the
/// tokens left for history.
struct Setup {
    ctx: i64,
    max_out: u64,
    system: String,
    tools: Vec<ToolDef>,
    fixed: i64,
    budget: i64,
}

fn setup(
    st: &AppState,
    store: &Store,
    id: &str,
    scope: &str,
    provider: &str,
    model: &str,
) -> Setup {
    let prefs = store.prefs().unwrap_or_default();
    let m = store
        .models()
        .unwrap_or_default()
        .into_iter()
        .find(|x| x.provider_id == provider && x.model_id == model);
    let ctx = m
        .as_ref()
        .and_then(|x| x.context_window)
        .or_else(|| prefs.get("context_tokens").and_then(Value::as_i64))
        .unwrap_or(DEFAULT_CONTEXT);
    let max_out = m
        .as_ref()
        .and_then(|x| x.max_output)
        .map(|n| n as u64)
        .or_else(|| prefs.get("max_output_tokens").and_then(Value::as_u64))
        .unwrap_or(DEFAULT_MAX_OUTPUT)
        // A reply never gets more than a quarter of a small model's window.
        .min((ctx as u64 / 4).max(1024));
    // The prompt written when the chat began, so it never changes under the conversation
    // (a rebuilt prompt would void the model's earlier thinking); older chats rebuild it.
    let system = store
        .messages(id)
        .unwrap_or_default()
        .iter()
        .find_map(|m| {
            m.meta
                .as_ref()
                .and_then(|v| v["system"].as_str())
                .map(str::to_string)
        })
        .map(|s| {
            if s.contains(FEATURES_MARK) {
                s
            } else {
                format!("{s}\n\n{FEATURES}")
            }
        })
        .unwrap_or_else(|| {
            system_prompt(
                st,
                scope,
                prefs.get("system_prompt").and_then(Value::as_str),
            )
        });
    let tools = tool_defs(st);
    let fixed = approx_tokens(&system)
        + approx_tokens(
            &serde_json::to_string(&tools.iter().map(|t| &t.parameters).collect::<Vec<_>>())
                .unwrap_or_default(),
        );
    let budget = (ctx - max_out as i64 - fixed).max(1_000);
    Setup {
        ctx,
        max_out,
        system,
        tools,
        fixed,
        budget,
    }
}

/// How full the chat's memory is for this model.
fn context_json(stp: &Setup, messages: &[memora_state::assistant::Message], model: &str) -> Value {
    json!({
        "used": stp.fixed + history_tokens(messages),
        "window": stp.ctx,
        "reserved_output": stp.max_out,
        "compact_at": stp.fixed + stp.budget * COMPACT_AT / 100,
        "compactions": messages.iter().filter(|m| is_compact(m)).count(),
        "model": model,
    })
}

/// Compaction starts when the history passes this share (%) of the tokens it may use: only
/// once the chat truly fills the model's context (what is left is kept for the reply).
const COMPACT_AT: i64 = 100;
const COMPACT_SYSTEM: &str = "You compact a chat between the owner of a notes vault and Mnemo, \
the agent that looks after it. Write a faithful summary that lets Mnemo carry on without the \
original messages: what the owner asked for and decided, their preferences, the notes and \
folders involved (exact paths), what Mnemo found and changed (exact paths), open questions and \
what was about to happen next. Short bullet points, in the language the owner wrote in. No \
preamble, no closing line.";

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(max).collect::<String>())
    }
}

/// Fold the older part of a chat into a summary written by the chat's model, keeping the
/// latest turn(s) as they are. `Ok(None)` when there is nothing older to fold.
fn compact(
    store: &Store,
    id: &str,
    provider: &str,
    model: &str,
    ep: &Endpoint,
    stp: &Setup,
    on: &mut dyn FnMut(&str) -> bool,
) -> Result<Option<(usize, i64, String)>, String> {
    let msgs = store.messages(id).map_err(|e| e.to_string())?;
    let (summary, keep_from) = match msgs.iter().rev().find(|m| is_compact(m)) {
        Some(c) => (
            c.content.clone(),
            c.meta
                .as_ref()
                .and_then(|v| v["keep_from"].as_i64())
                .unwrap_or(0),
        ),
        None => (String::new(), 0),
    };
    let active: Vec<&memora_state::assistant::Message> = msgs
        .iter()
        .filter(|m| !is_compact(m) && m.id >= keep_from)
        .collect();
    let users: Vec<i64> = active
        .iter()
        .filter(|m| m.role == "user")
        .map(|m| m.id)
        .collect();
    if users.len() < 2 {
        return Ok(None);
    }
    // Keep the last two turns, or only the last one when two would crowd the window.
    let size_from = |from: i64| -> i64 {
        active
            .iter()
            .filter(|m| m.id >= from)
            .map(|m| approx_tokens(&m.content))
            .sum()
    };
    let mut keep = users[users.len() - 2];
    if size_from(keep) > stp.budget / 2 {
        keep = users[users.len() - 1];
    }
    let older: Vec<_> = active.iter().filter(|m| m.id < keep).collect();
    let mut t = String::new();
    if !summary.is_empty() {
        t.push_str(&format!("Summary of what came before:\n{summary}\n\n"));
    }
    for m in &older {
        match m.role.as_str() {
            "user" => {
                t.push_str(&format!("Owner: {}\n", m.content));
                if let Some(a) = m.meta.as_ref().and_then(|v| v["attach"].as_array()) {
                    let names: Vec<&str> = a.iter().filter_map(|x| x["path"].as_str()).collect();
                    if !names.is_empty() {
                        t.push_str(&format!("(attached: {})\n", names.join(", ")));
                    }
                }
            }
            "assistant" => {
                if !m.content.is_empty() {
                    t.push_str(&format!("Mnemo: {}\n", m.content));
                }
                for c in m
                    .tool_calls
                    .as_ref()
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    t.push_str(&format!(
                        "Mnemo used {} {}\n",
                        c["name"].as_str().unwrap_or(""),
                        clip(&c["arguments"].to_string(), 240)
                    ));
                }
            }
            _ => t.push_str(&format!(
                "Result of {}: {}\n",
                m.tool_name.as_deref().unwrap_or("a tool"),
                clip(&m.content, 500)
            )),
        }
    }
    // The newest part matters most when even the transcript is too long for the model.
    let cap = ((stp.budget * 4 * 7) / 10).max(8_000) as usize;
    let n = t.chars().count();
    if n > cap {
        t = format!("…{}", t.chars().skip(n - cap).collect::<String>());
    }
    let opts = Options {
        temperature: None,
        max_output: Some(1500),
        think: false,
        effort: None,
    };
    let turn = providers::run(
        ep,
        model,
        COMPACT_SYSTEM,
        &[Msg::User(t)],
        &[],
        &opts,
        &mut |part| match part {
            providers::Stream::Text(t) => on(t),
            providers::Stream::Think(_) => true,
        },
    )?;
    let text = turn.text.trim().to_string();
    if text.is_empty() {
        return Err("the model wrote an empty summary".into());
    }
    let tokens = approx_tokens(&text);
    store
        .append(
            id,
            &NewMessage {
                role: "assistant".into(),
                content: text.clone(),
                meta: Some(json!({"compact": true, "keep_from": keep, "messages": older.len(), "model": format!("{provider}/{model}")})),
                ..Default::default()
            },
            memora_state::now(),
        )
        .map_err(|e| e.to_string())?;
    Ok(Some((older.len(), tokens, text)))
}

#[allow(clippy::too_many_arguments)]
fn run_agent(
    st: &AppState,
    store: &Store,
    id: &str,
    scope: &str,
    provider: &str,
    model: &str,
    ep: &Endpoint,
    tx: &tokio::sync::mpsc::UnboundedSender<String>,
    on_behalf: &str,
) -> Outcome {
    let prefs = store.prefs().unwrap_or_default();
    let (mut provider, mut model, mut ep) = (provider.to_string(), model.to_string(), ep.clone());
    let mut stp = setup(st, store, id, scope, &provider, &model);
    // How hard the model thinks: the owner's pick in the chat (off, low, medium, high), or
    // the model's own default.
    let level = prefs
        .get(THINKING)
        .and_then(Value::as_str)
        .unwrap_or("auto")
        .to_string();
    let mut opts = Options {
        temperature: prefs.get("temperature").and_then(Value::as_f64),
        max_output: Some(stp.max_out),
        think: level != "off",
        effort: ["low", "medium", "high"]
            .contains(&level.as_str())
            .then(|| level.clone()),
    };
    // Models to carry on with when this one fails, in the owner's order.
    let mut fallbacks = fallback_chain(store, &provider, &model).into_iter();
    // The model that failed before a fallback took over (noted on the next stored reply).
    let mut fell_from: Option<String> = None;
    let auto = prefs.get("permission").and_then(Value::as_str) == Some("auto");
    let steps = prefs
        .get("max_steps")
        .and_then(Value::as_u64)
        .map_or(if auto { AUTO_STEPS } else { DEFAULT_STEPS }, |n| {
            n as usize
        });
    // Ask first: changes wait for the owner's OK, given by answering an ask_owner question
    // with an option marked approve; that OK holds for this reply.
    let approved = auto
        || store
            .messages(id)
            .unwrap_or_default()
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .and_then(|m| m.meta.as_ref())
            .is_some_and(|v| v["answer"]["approve"] == true || v["approved"] == true);
    let budget = stp.budget;
    // Near full: fold the older turns into a summary before this turn (the whole chat stays
    // in memory, just shorter). If that fails, the oldest turns are left out instead.
    let full = history_tokens(&store.messages(id).unwrap_or_default()) > budget * COMPACT_AT / 100;
    if full {
        if !send(tx, json!({"type": "compacting"})) {
            return Outcome::Stopped;
        }
        // The summary streams into the divider as it is written.
        let mut on_sum = |t: &str| send(tx, json!({"type": "compact_text", "delta": t}));
        match compact(store, id, &provider, &model, &ep, &stp, &mut on_sum) {
            Ok(Some((n, t, summary))) => {
                send(
                    tx,
                    json!({"type": "compacted", "messages": n, "tokens": t, "summary": summary}),
                );
                live::notify(id, &json!({"type": "compacted"}));
            }
            Ok(None) => {}
            Err(e) => {
                send(
                    tx,
                    json!({"type": "notice", "text": format!("Could not compact the chat ({e}); older messages are left out instead.")}),
                );
            }
        }
    }
    let who = caller_for(on_behalf);
    let (mut tin, mut tout) = (0u64, 0u64);
    let mut key = format!("{provider}/{model}");
    let start = json!({"type": "start", "model": key, "context": context_json(&stp, &store.messages(id).unwrap_or_default(), &key)});
    if !send(tx, start) {
        return Outcome::Stopped;
    }
    let mut step = 0;
    while step < steps {
        let stored = store.messages(id).unwrap_or_default();
        let (mut history, trimmed) = history_within(&stored, stp.budget);
        fill_images(st, &mut history);
        if trimmed && (step == 0 || full) {
            send(
                tx,
                json!({"type": "notice", "text": "Older messages were left out to fit the model's context."}),
            );
        }
        let got = std::cell::Cell::new(false);
        // What this step wrote so far: kept when the owner stops or cuts the reply.
        let partial = std::cell::RefCell::new(String::new());
        let mut on = |part: providers::Stream| {
            got.set(true);
            match part {
                providers::Stream::Text(t) => {
                    partial.borrow_mut().push_str(t);
                    send(tx, json!({"type": "text", "delta": t}))
                }
                providers::Stream::Think(t) => send(tx, json!({"type": "thinking", "delta": t})),
            }
        };
        let (system, tools) = (&stp.system, &stp.tools);
        let mut res = providers::run(&ep, &model, system, &history, tools, &opts, &mut on);
        // A provider that is briefly down or busy (502, 503, 429, a dropped connection) is
        // asked again a few times, over about half a minute, before the owner sees an error;
        // only while nothing of this step has streamed yet, so no text is repeated.
        // With a fallback model lined up, one quick retry, then the next model takes over.
        let waits: &[u64] = if fallbacks.len() > 0 {
            &RETRY_WAITS[..1]
        } else {
            &RETRY_WAITS
        };
        for (n, wait) in waits.iter().enumerate() {
            match &res {
                Err(e) if transient(e) && !got.get() => {
                    let note = format!(
                        "{model} did not answer ({}); trying again in {wait} s ({}/{})…",
                        why_failed(e),
                        n + 1,
                        waits.len()
                    );
                    if !send(tx, json!({"type": "notice", "text": note})) {
                        return Outcome::Stopped;
                    }
                    std::thread::sleep(std::time::Duration::from_secs(*wait));
                    res = providers::run(&ep, &model, system, &history, tools, &opts, &mut on);
                }
                _ => break,
            }
        }
        // A model without eyes: say so and ask again with the pictures as text.
        if let Err(e) = &res {
            if refuses_images(e) && strip_images(&mut history) {
                send(
                    tx,
                    json!({"type": "notice", "text": format!("{model} cannot look at images; it got their names instead. Pick a vision model to have them seen.")}),
                );
                res = providers::run(&ep, &model, system, &history, tools, &opts, &mut on);
            }
        }
        let turn = match res {
            Ok(t) => t,
            Err(e) if e == "stopped" => {
                // Stopped or cut for a newer message: what it wrote so far stays in the chat.
                let text = partial.into_inner();
                if !text.trim().is_empty() {
                    let _ = store.append(
                        id,
                        &NewMessage {
                            role: "assistant".into(),
                            content: text.trim_end().to_string(),
                            meta: Some(json!({"model": key, "stopped": true})),
                            ..Default::default()
                        },
                        memora_state::now(),
                    );
                }
                return Outcome::Stopped;
            }
            Err(e) if fallbacks.len() > 0 => {
                // Carry on with the next model the owner lined up; what the failed one
                // started writing is dropped (the new one answers the step again).
                let mut next = None;
                for (p, m) in fallbacks.by_ref() {
                    if let Ok(x) = endpoint(st, store, &p) {
                        next = Some((p, m, x));
                        break;
                    }
                }
                let Some((p, m, x)) = next else {
                    return fail_turn(store, id, tx, &model, &e);
                };
                let to = format!("{p}/{m}");
                if !send(
                    tx,
                    json!({"type": "fallback", "from": key, "model": to, "reason": why_failed(&e), "detail": providers::condense_error(&e)}),
                ) {
                    return Outcome::Stopped;
                }
                // The chat keeps the model that answered from now on.
                let _ = store.update_session(id, None, Some(&to), None, None);
                fell_from = Some(key.clone());
                (provider, model, ep, key) = (p, m, x, to);
                stp = setup(st, store, id, scope, &provider, &model);
                opts.max_output = Some(stp.max_out);
                continue;
            }
            Err(e) => return fail_turn(store, id, tx, &model, &e),
        };
        tin += turn.input_tokens.unwrap_or(0);
        tout += turn.output_tokens.unwrap_or(0);
        let calls_json = (!turn.calls.is_empty()).then(|| {
            json!(turn
                .calls
                .iter()
                .map(|c| json!({"id": c.id, "name": c.name, "arguments": c.arguments}))
                .collect::<Vec<_>>())
        });
        let mut meta = json!({"model": format!("{provider}/{model}"), "input_tokens": turn.input_tokens, "output_tokens": turn.output_tokens});
        if let Some(f) = fell_from.take() {
            meta["fallback_from"] = json!(f);
        }
        // A model that showed its thinking can think: the chat offers it a thinking level.
        if !turn.thinking.trim().is_empty() {
            learn_thinker(store, &key);
        }
        if !turn.thinking.trim().is_empty() {
            meta["thinking"] = json!(turn.thinking.trim());
        }
        if let Some(raw) = &turn.raw {
            meta["raw"] = raw.clone();
        }
        let _ = store.append(
            id,
            &NewMessage {
                role: "assistant".into(),
                content: turn.text.clone(),
                tool_calls: calls_json,
                meta: Some(meta),
                ..Default::default()
            },
            memora_state::now(),
        );
        if turn.calls.is_empty() {
            break;
        }
        let mut asked = false;
        for c in &turn.calls {
            if !send(
                tx,
                json!({"type": "tool_start", "id": c.id, "name": c.name, "args": c.arguments}),
            ) {
                return Outcome::Stopped;
            }
            let started = Instant::now();
            let off = st.mcp.disabled_tools();
            let allowed = TOOLS.contains(&c.name.as_str()) && !off.contains(&c.name);
            let writes = c.name == PLACE_IMAGE
                || (TOOLS.contains(&c.name.as_str())
                    && !memora_mcp::activity::is_read_only(&c.name));
            let res = if writes && !approved {
                Err(format!(
                    "Not done: {NAME} is in Ask first mode, so changes wait for the owner's OK. Ask with ask_owner \
(say what you will change; give an option with approve: true such as \"Yes, go ahead\"), then make the change \
after they approve."
                ))
            } else if c.name == ASK_OWNER {
                match ask_check(&c.arguments) {
                    Ok(q) => {
                        asked = true;
                        let mut ev = q.clone();
                        ev["type"] = json!("ask");
                        ev["id"] = json!(c.id);
                        send(tx, ev);
                        Ok(
                            json!({"asked": true, "note": "The owner's answer comes as their next message."}),
                        )
                    }
                    Err(e) => Err(e),
                }
            } else if c.name == VIEW_IMAGE {
                view_image(st, &c.arguments)
            } else if c.name == PLACE_IMAGE && !off.contains("upload_image") {
                place_image(st, &who, &c.arguments)
            } else if c.name == SHOW_ITEMS {
                show_items(st, &c.arguments)
            } else if c.name == CURRENT_TIME {
                Ok(current_time(store, id))
            } else if c.name == docs::SEARCH || c.name == docs::READ {
                docs::run(st, &c.name, &c.arguments)
            } else if [
                SEARCH_CHATS,
                READ_CHAT,
                LIST_CHATS,
                LIST_ARTIFACTS,
                READ_ARTIFACT,
            ]
            .contains(&c.name.as_str())
            {
                chat_tool(store, &c.name, &c.arguments, id)
            } else if allowed {
                st.mcp
                    .call_tool_by(&c.name, &c.arguments, &who)
                    .map_err(|e| e.to_string())
            } else {
                Err(format!("{} is not one of {NAME}'s tools", c.name))
            };
            let ms = started.elapsed().as_millis() as u64;
            let (ok, output, line) = match &res {
                Ok(v) => {
                    let mut out = v.to_string();
                    if out.len() > TOOL_RESULT_MAX {
                        out = format!(
                            "{}… (cut at {TOOL_RESULT_MAX} characters)",
                            out.chars().take(TOOL_RESULT_MAX).collect::<String>()
                        );
                    }
                    (true, out, summary(v))
                }
                Err(e) => (false, json!({"error": e}).to_string(), e.clone()),
            };
            let _ = store.append(
                id,
                &NewMessage {
                    role: "tool".into(),
                    content: output,
                    tool_call_id: Some(c.id.clone()),
                    tool_name: Some(c.name.clone()),
                    meta: Some(json!({"ok": ok, "ms": ms, "summary": line})),
                    ..Default::default()
                },
                memora_state::now(),
            );
            let mut end = json!({"type": "tool_end", "id": c.id, "name": c.name, "ok": ok, "summary": line, "ms": ms});
            // Cards to show right away (the chat draws them from this).
            if c.name == SHOW_ITEMS {
                if let Ok(v) = &res {
                    end["shown"] = v["shown"].clone();
                }
            }
            if !send(tx, end) {
                return Outcome::Stopped;
            }
        }
        // A question for the owner ends the reply: their answer is the next message.
        if asked {
            break;
        }
        step += 1;
        if step == steps {
            send(
                tx,
                json!({"type": "notice", "text": format!("{NAME} stopped after {steps} steps; say \"continue\" to go on.")}),
            );
        }
    }
    // A chat still called "New chat", or still named by the first words of its question (the
    // model could not name it before), gets a short title from the model: what it is about,
    // in the owner's language. The first words stand in only while that fails.
    if store
        .session(id)
        .ok()
        .flatten()
        .is_some_and(|s| s.title == NEW_TITLE || s.title == first_words(store, id))
    {
        let t = chat_title(store, id, &model, &ep);
        let _ = store.update_session(id, Some(&t), None, None, None);
    }
    let title = store.session(id).ok().flatten().map(|s| s.title);
    let context = context_json(&stp, &store.messages(id).unwrap_or_default(), &key);
    send(
        tx,
        json!({"type": "done", "input_tokens": tin, "output_tokens": tout, "title": title, "context": context}),
    );
    Outcome::Done
}

/// A reply that failed (no model left to try): the error is stored, so the chat shows it
/// with Try again, and a chat with no title yet is named by its question's first words.
fn fail_turn(
    store: &Store,
    id: &str,
    tx: &tokio::sync::mpsc::UnboundedSender<String>,
    model: &str,
    e: &str,
) -> Outcome {
    let _ = store.append(
        id,
        &NewMessage {
            role: "assistant".into(),
            content: String::new(),
            meta: Some(json!({"error": e, "model": model})),
            ..Default::default()
        },
        memora_state::now(),
    );
    send(tx, json!({"type": "error", "message": e}));
    if store
        .session(id)
        .ok()
        .flatten()
        .is_some_and(|s| s.title == NEW_TITLE)
    {
        let first = first_words(store, id);
        if !first.is_empty() {
            let _ = store.update_session(id, Some(&first), None, None, None);
        }
    }
    Outcome::Failed
}

/// The preference with the models seen thinking (`["provider/model", …]`): their chat offers
/// a thinking level even when the name says nothing.
const THINKERS: &str = "thinkers";

/// Models known to think: the ones seen thinking (learned once from the stored chats).
fn thinkers(store: &Store) -> BTreeSet<String> {
    let prefs = store.prefs().unwrap_or_default();
    if let Some(a) = prefs.get(THINKERS).and_then(Value::as_array) {
        return a
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
    }
    let mut out = BTreeSet::new();
    for sess in store.sessions().unwrap_or_default() {
        for m in store.messages(&sess.id).unwrap_or_default() {
            if let Some(meta) = m.meta.as_ref() {
                if meta["thinking"]
                    .as_str()
                    .is_some_and(|t| !t.trim().is_empty())
                {
                    if let Some(k) = meta["model"].as_str() {
                        out.insert(k.to_string());
                    }
                }
            }
        }
    }
    let _ = store.set_pref(THINKERS, &json!(out.iter().collect::<Vec<_>>()));
    out
}

fn learn_thinker(store: &Store, key: &str) {
    let mut t = thinkers(store);
    if t.insert(key.to_string()) {
        let list: Vec<&String> = t.iter().rev().take(300).collect();
        let _ = store.set_pref(THINKERS, &json!(list));
    }
}

/// The preference with the models to carry on with when a chat's model fails, in order
/// (`["provider/model", …]`, five at most).
const FALLBACKS: &str = "fallback_models";
/// The preference with how hard models think: `auto` (the model's own), `off`, `low`,
/// `medium` or `high`.
const THINKING: &str = "thinking";

/// The fallback models for a reply on `provider/model`: the owner's list, without that model,
/// only providers that can be used now.
fn fallback_chain(store: &Store, provider: &str, model: &str) -> Vec<(String, String)> {
    let me = format!("{provider}/{model}");
    let providers = store.providers().unwrap_or_default();
    let mut out: Vec<(String, String)> = Vec::new();
    for k in store
        .prefs()
        .unwrap_or_default()
        .get(FALLBACKS)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        let Some((p, m)) = k.split_once('/') else {
            continue;
        };
        let ok = providers
            .iter()
            .any(|x| x.id == p && x.enabled && (!x.api_key.is_empty() || x.kind == "custom"));
        if k != me && ok && !m.is_empty() && !out.iter().any(|(a, b)| a == p && b == m) {
            out.push((p.to_string(), m.to_string()));
        }
    }
    out
}

#[cfg(test)]
mod tests {

    #[test]
    fn a_skill_says_what_it_is_for() {
        use super::skill_description as d;
        assert_eq!(
            d("---\ntags: x\ndescription: Tidy a meeting note\n---\n# Steps\n1. a"),
            "Tidy a meeting note"
        );
        assert_eq!(d("description: \"Short\"\nsteps"), "Short");
        assert_eq!(
            d("---\ntags: x\n---\n# Tidy\n\nMake it neat.\n"),
            "Make it neat."
        );
        assert_eq!(d("# Only a heading"), "");
    }

    #[test]
    fn pages_in_replies_are_found_with_their_titles_and_versions() {
        let msg = |role: &str, content: &str, at: i64| memora_state::assistant::Message {
            id: at,
            session_id: "c1".into(),
            role: role.into(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            tool_name: None,
            meta: None,
            created_at: at,
        };
        let msgs = vec![
            msg("user", "```html\n<title>Not mine</title>\n```", 1),
            msg("assistant", "Here:\n```html\n<html><title>Sales</title></html>\n```\n```js\nlet x = 1;\n```", 2),
            msg("assistant", "Tidied:\n```HTML\n<TITLE> Sales </TITLE><p>v2</p>\n```\nand\n```svg\n<svg></svg>\n```", 3),
        ];
        let p = super::pages_in(&msgs);
        assert_eq!(p.len(), 3);
        assert_eq!((p[0].kind, p[0].title.as_str()), ("html", "Sales"));
        assert_eq!((p[1].title.as_str(), p[1].at), ("Sales", 3));
        assert!(p[1].code.contains("<p>v2</p>"));
        assert_eq!((p[2].kind, p[2].title.as_str()), ("svg", "Image"));
    }

    #[test]
    fn provider_ids_are_slugs_and_unique() {
        assert_eq!(slug("My OpenRouter!"), "my-openrouter");
        assert_eq!(slug("  ***  "), "provider");
        assert!(
            valid_id("groq-2")
                && !valid_id("-x")
                && !valid_id("A")
                && !valid_id("a/b")
                && !valid_id("")
        );
        let taken = vec!["openai".to_string(), "openai-2".to_string()];
        assert_eq!(unique_id("openai", &taken), "openai-3");
        assert_eq!(unique_id("groq", &taken), "groq");
    }

    use super::*;

    #[test]
    fn only_passing_failures_are_tried_again() {
        assert!(transient(
            "the provider answered 503: [x] [502]: holver.id | 502: Bad gateway (reset after 30s)"
        ));
        assert!(transient("the provider answered 429: rate limited"));
        assert!(transient(
            "could not reach the provider: Connection reset by peer"
        ));
        assert!(!transient(
            "the provider answered 404: No active credentials for provider: tokenrouter"
        ));
        assert!(!transient("the provider answered 401: bad key"));
        assert!(!transient("stopped"));
    }
    use memora_state::assistant::Message;

    fn msg(role: &str, content: &str) -> Message {
        Message {
            id: 0,
            session_id: "s".into(),
            role: role.into(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            tool_name: None,
            meta: None,
            created_at: 0,
        }
    }

    #[test]
    fn attachments_are_checked_and_replayed_with_their_message() {
        assert!(parse_attach(&json!({})).unwrap().is_empty());
        let two = parse_attach(&json!({"attach": [{"kind": "note", "path": "A.md"}, {"kind": "note", "path": "A.md"}, {"kind": "folder", "path": "P"}]})).unwrap();
        assert_eq!(two.len(), 2, "duplicates are dropped");
        assert!(parse_attach(&json!({"attach": [{"kind": "file", "path": "x"}]})).is_err());
        let many: Vec<Value> = (0..9)
            .map(|i| json!({"kind": "note", "path": format!("{i}.md")}))
            .collect();
        assert!(parse_attach(&json!({"attach": many})).is_err());
        let mut m = msg("user", "Summarise it");
        m.meta = Some(
            json!({"attach": [{"kind": "note", "path": "A.md"}], "context": "<attached kind=\"note\" path=\"A.md\">hello</attached>"}),
        );
        let (h, _) = history_within(&[m], 100_000);
        match &h[0] {
            Msg::User(t) => assert!(t.contains("<attached") && t.ends_with("Summarise it")),
            _ => panic!("a user turn"),
        }
    }

    #[test]
    fn old_turns_go_first_and_the_newest_always_stays() {
        let long = "x".repeat(4000);
        let m = vec![
            msg("user", &long),
            msg("assistant", &long),
            msg("user", "short question"),
        ];
        let (h, trimmed) = history_within(&m, 100);
        assert!(trimmed);
        assert_eq!(h.len(), 1);
        assert!(matches!(&h[0], Msg::User(t) if t == "short question"));
        let (all, t2) = history_within(&m, 1_000_000);
        assert_eq!(all.len(), 3);
        assert!(!t2);
    }

    #[test]
    fn mnemo_never_has_delete_forever_web_or_admin_tools() {
        for t in [
            "delete_memory",
            "bulk_delete",
            "delete_folder",
            "admin_set_tool",
            "privacy_set",
            "export_memory",
            "import_memory",
        ] {
            assert!(!TOOLS.contains(&t), "{t}");
        }
        let names: Vec<&str> = memora_mcp::catalog().iter().map(|t| t.name).collect();
        let extra: Vec<String> = memora_mcp::tools::extra_specs()
            .iter()
            .map(|t| t.name.to_string())
            .collect();
        for t in TOOLS {
            assert!(
                names.contains(t) || extra.iter().any(|e| e == t),
                "{t} is not a catalog tool"
            );
        }
    }

    #[test]
    fn a_compaction_summary_stands_in_for_everything_before_it() {
        let with = |id: i64, role: &str, content: &str, meta: Option<Value>| {
            let mut m = msg(role, content);
            m.id = id;
            m.meta = meta;
            m
        };
        let m = vec![
            with(1, "user", "old question", None),
            with(
                2,
                "assistant",
                "old answer",
                Some(json!({"raw": [{"type": "thinking"}]})),
            ),
            with(3, "user", "kept question", None),
            with(
                4,
                "assistant",
                "kept answer",
                Some(json!({"raw": [{"type": "thinking"}]})),
            ),
            with(
                5,
                "assistant",
                "- owner asked an old question",
                Some(json!({"compact": true, "keep_from": 3})),
            ),
            with(6, "user", "new question", None),
        ];
        let (h, trimmed) = history_within(&m, 1_000_000);
        assert!(!trimmed);
        assert_eq!(
            h.len(),
            3,
            "the summary, the kept turn and the new question"
        );
        assert!(
            matches!(&h[0], Msg::User(t) if t.starts_with(COMPACT_INTRO) && t.contains("owner asked") && t.ends_with("kept question"))
        );
        assert!(
            matches!(&h[1], Msg::Assistant { raw: None, .. }),
            "thinking from before the compaction is not replayed"
        );
        assert!(matches!(&h[2], Msg::User(t) if t == "new question"));
    }

    #[test]
    fn a_chat_exports_as_markdown_with_its_steps() {
        let store = Store::open_memory().unwrap();
        store
            .create_session("c", "Plan talk", "note:Plan.md", "p/m", 0)
            .unwrap();
        let add = |role: &str, content: &str, meta: Option<Value>, tool: Option<&str>| {
            store
                .append(
                    "c",
                    &NewMessage {
                        role: role.into(),
                        content: content.into(),
                        meta,
                        tool_name: tool.map(str::to_string),
                        ..Default::default()
                    },
                    3600,
                )
                .unwrap();
        };
        add(
            "user",
            "What is due?",
            Some(json!({"attach": [{"kind": "note", "path": "Plan.md", "title": "Plan"}]})),
            None,
        );
        add("assistant", "", Some(json!({"model": "p/m"})), None);
        add(
            "tool",
            "{}",
            Some(json!({"summary": "3 results"})),
            Some("search_memory"),
        );
        add("assistant", "Two tasks.", None, None);
        let (title, md) = chat_markdown(&store, "c").unwrap();
        assert_eq!(title, "Plan talk");
        assert!(md.starts_with("# Plan talk\n"));
        assert!(md.contains("about the note Plan.md") && md.contains("1970-01-01 01:00 UTC"));
        assert!(
            md.contains("**You** · ")
                && md.contains("What is due?")
                && md.contains("*Attached: Plan*")
        );
        assert!(md.contains("> Steps: search_memory (3 results)") && md.contains("Two tasks."));
    }

    #[test]
    fn search_snippets_show_the_words_in_context() {
        let long = format!(
            "{} the launch date is set {}",
            "intro ".repeat(40),
            "tail ".repeat(60)
        );
        let s = snippet(&long, "LAUNCH");
        assert!(s.starts_with('…') && s.ends_with('…') && s.contains("launch date"));
        assert_eq!(snippet("short text", "zzz"), "short text");
        assert!(snippet("ünïcödé ñ launch", "launch").contains("launch"));
    }

    #[test]
    fn the_clock_reads_weekday_date_and_time() {
        // 2026-11-16 06:45 UTC is a Monday; +7 h makes it 13:45 the same day.
        let t = 1_794_811_500;
        assert_eq!(
            clock(t),
            (
                "Monday",
                "16 November 2026".to_string(),
                "06:45".to_string()
            )
        );
        assert_eq!(clock(t + 7 * 3600).2, "13:45");
        assert_eq!(clock(0).0, "Thursday");
    }

    #[test]
    fn questions_need_text_and_two_options() {
        assert!(
            ask_check(&json!({"question": "", "options": [{"label": "a"}, {"label": "b"}]}))
                .is_err()
        );
        assert!(ask_check(&json!({"question": "Which?", "options": [{"label": "a"}]})).is_err());
        let q = ask_check(&json!({"question": "Merge these tags?", "options": [{"label": "Yes, merge", "approve": true}, {"label": "No"}, {"label": "  "}]})).unwrap();
        assert_eq!(
            q["options"].as_array().unwrap().len(),
            2,
            "blank options are dropped"
        );
        assert_eq!(q["options"][0]["approve"], true);
        assert_eq!(q["allow_other"], true);
    }

    #[test]
    fn dates_are_civil() {
        assert_eq!(chrono_today().len(), 10);
    }
}
