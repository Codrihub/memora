//! `/api/privacy`: manage the per-agent privacy rules of notes and folders
//! (`memora_state::privacy`). Signed-in owner session or an API key with the `admin`
//! scope (enforced by `required_scope`); writes are CSRF-checked for cookie sessions and
//! written to the activity log.
//!
//! * `GET /api/privacy` -> `{count, rules:[{id,kind,path,mode,keys:[{id,name,color}],..}],
//!   agents:[{id,name,color,enabled}]}`
//! * `GET /api/privacy/path?path=&kind=` -> the path's own rule, inherited folder rules and
//!   per-agent visibility (`memora_mcp::privacy::describe`). `kind` (`node` | `folder`)
//!   defaults to what the path is on disk.
//! * `PUT /api/privacy/path` `{path, kind, mode: "deny"|"allow_only", keys:[key id]}` ->
//!   replaces the rule; same answer as GET. `deny` with no keys removes it.
//! * `DELETE /api/privacy/path?path=&kind=` -> removes the rule; same answer as GET.

use axum::{
    extract::{Request, State},
    http::HeaderMap,
    response::{IntoResponse, Json, Response},
    routing::get,
    Extension, Router,
};
use memora_state::privacy::{Kind, Mode};
use serde_json::{json, Value};

use crate::api::{actor_name as actor, bad, client_ip as ip, csrf_fail, csrf_ok, db_err};
use crate::{ApiKeyCaller, AppState};

pub fn router() -> Router<AppState> {
    Router::new().route("/api/privacy", get(h_list)).route(
        "/api/privacy/path",
        get(h_path_get).put(h_path_put).delete(h_path_delete),
    )
}

/// The rule kind: as given, else a folder when the path is a folder on disk.
fn kind_of(st: &AppState, path: &str, given: Option<&str>) -> Result<Kind, Box<Response>> {
    if let Some(k) = given.map(str::trim).filter(|k| !k.is_empty()) {
        return k
            .parse()
            .map_err(|e: memora_state::Error| Box::new(bad(&e.to_string())));
    }
    let norm =
        memora_state::privacy::normalize_path(path).map_err(|e| Box::new(bad(&e.to_string())))?;
    let root = st
        .store
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .root()
        .to_path_buf();
    Ok(if root.join(&norm).is_dir() {
        Kind::Folder
    } else {
        Kind::Node
    })
}

/// Tell signed-in browsers to refresh their lock marks.
fn changed(actor: Option<&str>, path: &str) {
    memora_core::events::hub().publish(json!({
        "type": "privacy_changed", "actor": actor.unwrap_or(""), "path": path,
    }));
}

async fn h_list(State(st): State<AppState>) -> Response {
    match st.db.read(memora_mcp::privacy::list_json) {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_err(e, "not found"),
    }
}

async fn h_path_get(State(st): State<AppState>, req: Request) -> Response {
    let path = crate::query_value(req.uri(), "path").unwrap_or_default();
    if path.trim().is_empty() {
        return bad("path is required");
    }
    let given = crate::query_value(req.uri(), "kind");
    let kind = match kind_of(&st, &path, given.as_deref()) {
        Ok(k) => k,
        Err(r) => return *r,
    };
    match st
        .db
        .read(|c| memora_mcp::privacy::describe(c, &path, kind))
    {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_err(e, "not found"),
    }
}

async fn h_path_put(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let path = b
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if path.trim().is_empty() {
        return bad("path is required");
    }
    let kind = match kind_of(&st, &path, b.get("kind").and_then(|v| v.as_str())) {
        Ok(k) => k,
        Err(r) => return *r,
    };
    let mode: Mode = match b
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("deny")
        .parse()
    {
        Ok(m) => m,
        Err(e) => return bad(&e.to_string()),
    };
    let keys: Vec<String> = match b.get("keys") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) if a.iter().all(Value::is_string) => a
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        Some(_) => return bad("keys must be a list of key ids"),
    };
    let who = actor(&st, &headers, &key);
    let ip = ip(&headers);
    match memora_mcp::privacy::set_rule(
        &st.db,
        kind,
        &path,
        mode,
        &keys,
        who.as_deref(),
        ip.as_deref(),
    ) {
        Ok(v) => {
            changed(who.as_deref(), &path);
            Json(v).into_response()
        }
        Err(e) => db_err(e, "not found"),
    }
}

async fn h_path_delete(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let path = crate::query_value(req.uri(), "path").unwrap_or_default();
    if path.trim().is_empty() {
        return bad("path is required");
    }
    let given = crate::query_value(req.uri(), "kind");
    let kind = match kind_of(&st, &path, given.as_deref()) {
        Ok(k) => k,
        Err(r) => return *r,
    };
    let who = actor(&st, &headers, &key);
    let ip = ip(&headers);
    match memora_mcp::privacy::clear_rule(&st.db, kind, &path, who.as_deref(), ip.as_deref()) {
        Ok(v) => {
            changed(who.as_deref(), &path);
            Json(v).into_response()
        }
        Err(e) => db_err(e, "not found"),
    }
}
