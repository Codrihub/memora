//! `/api/pins`: the owner's pinned notes and folders (`memora_state::pins`), saved on the
//! server so every browser and device shows the same "Pinned" list. Signed-in browser
//! session only (API keys are refused like the UI layouts; agents use the MCP tools
//! `list_pins`, `pin`, `unpin`); writes are same-origin checked.
//!
//! * `GET /api/pins` -> `{count, pins:[{kind:"note"|"folder", path, position, missing}]}`
//!   in display order; `missing` is true when the path no longer exists.
//! * `PUT /api/pins` `{pins:[{kind, path}]}` -> replaces the whole ordered list
//!   (reorder, remove, first upload); paths need not exist. Same answer as GET.
//! * `POST /api/pins/pin` `{kind, path, position?}` -> pins an existing note or folder at
//!   `position` (default: the end) or moves it there. Same answer as GET.
//! * `POST /api/pins/unpin` `{kind, path}` -> removes it; same answer plus `removed`.
//!
//! Every change publishes `pins_changed` (no data) so open browsers reload the list.

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Extension, Router,
};
use memora_state::pins::{Kind, MAX_PINS};
use serde_json::{json, Map, Value};

use crate::api::{bad, csrf_fail, csrf_ok, db_err};
use crate::{ApiKeyCaller, AppState};

/// Body cap for `PUT /api/pins`: [`MAX_PINS`] pins of the longest path, with room for
/// the JSON around them.
const LIST_BODY_LIMIT: usize = 256 * 1024;
/// Body cap for one pin or unpin.
const ONE_BODY_LIMIT: usize = 8 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/pins",
            get(h_list)
                .put(h_replace)
                .layer(DefaultBodyLimit::max(LIST_BODY_LIMIT)),
        )
        .route(
            "/api/pins/pin",
            post(h_pin).layer(DefaultBodyLimit::max(ONE_BODY_LIMIT)),
        )
        .route(
            "/api/pins/unpin",
            post(h_unpin).layer(DefaultBodyLimit::max(ONE_BODY_LIMIT)),
        )
}

fn browser_only() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({"error": "pins are for the signed-in browser; agents use the MCP pin tools"})),
    )
        .into_response()
}

/// The checks every write shares: browser session, same origin, a JSON object body.
fn write_gate(
    key: &Option<Extension<ApiKeyCaller>>,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<Map<String, Value>, Box<Response>> {
    if key.is_some() {
        return Err(Box::new(browser_only()));
    }
    if !csrf_ok(headers) {
        return Err(Box::new(csrf_fail()));
    }
    match serde_json::from_slice::<Value>(body) {
        Ok(Value::Object(m)) => Ok(m),
        _ => Err(Box::new(bad("body must be a JSON object"))),
    }
}

/// `{kind, path}` of one pin in a request.
fn item(v: &Value) -> Result<(Kind, String), Box<Response>> {
    let kind = v
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| Box::new(bad("kind is required: note or folder")))?
        .parse::<Kind>()
        .map_err(|e| Box::new(bad(&e.to_string())))?;
    let path = v
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| Box::new(bad("path is required")))?;
    memora_state::pins::check_path(kind, path).map_err(|e| Box::new(bad(&e.to_string())))?;
    Ok((kind, path.to_string()))
}

async fn h_list(State(st): State<AppState>, key: Option<Extension<ApiKeyCaller>>) -> Response {
    if key.is_some() {
        return browser_only();
    }
    let store = crate::store_as(&st, None);
    match memora_mcp::pins::list_json(&st.db, &store) {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_err(e, "not found"),
    }
}

async fn h_replace(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let b = match write_gate(&key, &headers, &body) {
        Ok(b) => b,
        Err(r) => return *r,
    };
    let Some(list) = b.get("pins").and_then(Value::as_array) else {
        return bad("pins must be a list of {kind, path}");
    };
    if list.len() > MAX_PINS {
        return bad(&format!("at most {MAX_PINS} pins"));
    }
    let mut items = Vec::with_capacity(list.len());
    for v in list {
        match item(v) {
            Ok(it) => items.push(it),
            Err(r) => return *r,
        }
    }
    let store = crate::store_as(&st, None);
    match memora_mcp::pins::replace(&st.db, &store, &items) {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_err(e, "not found"),
    }
}

async fn h_pin(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let b = match write_gate(&key, &headers, &body) {
        Ok(b) => b,
        Err(r) => return *r,
    };
    let (kind, path) = match item(&Value::Object(b.clone())) {
        Ok(it) => it,
        Err(r) => return *r,
    };
    let position = match b.get("position") {
        None | Some(Value::Null) => None,
        Some(v) => match v.as_u64() {
            Some(n) => Some(usize::try_from(n).unwrap_or(usize::MAX)),
            None => return bad("position must be a whole number from 0"),
        },
    };
    // The store stays locked while the pin is written: no rename can slip in between
    // the existence check and the row.
    let store = crate::store_as(&st, None);
    match memora_mcp::pins::pin(&st.db, &store, kind, &path, position) {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_err(e, "no such note or folder"),
    }
}

async fn h_unpin(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let b = match write_gate(&key, &headers, &body) {
        Ok(b) => b,
        Err(r) => return *r,
    };
    let (kind, path) = match item(&Value::Object(b)) {
        Ok(it) => it,
        Err(r) => return *r,
    };
    let store = crate::store_as(&st, None);
    match memora_mcp::pins::unpin(&st.db, &store, kind, &path) {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_err(e, "not found"),
    }
}
