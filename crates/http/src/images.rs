//! Images beside notes: upload, galleries, storage and the upload limit.
//!
//! * `POST /api/vault/image?note=<path>&name=<file>` (image bytes) -> `{path, name, bytes, url, markdown}`
//! * `POST /api/vault/image/delete` `{path}` -> `{ok, deleted}`
//! * `GET /api/vault/images?folder=<folder>` -> `{folder, images:[...]}` (that folder only)
//! * `GET /api/vault/images?note=<path>` -> `{note, folder, images, folder_images}`
//! * `GET /api/vault/storage` -> `{notes, note_bytes, images, image_bytes, total_bytes, max_image_bytes}`
//! * `GET|POST /api/settings/media` `{max_image_mb}` (admin) -> `{max_image_mb, max_image_bytes}`

use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Extension, Router,
};
use memora_core::vault::{image_max_bytes, set_image_max_bytes, DEFAULT_IMAGE_MAX};
use serde_json::{json, Value};

use crate::api::{bad, body_str, csrf_fail, csrf_ok, db_err};
use crate::{ApiKeyCaller, AppState};

/// The settings document that holds the upload limit.
pub const MEDIA_LAYOUT: &str = "srv-media";
/// The limit an admin may choose, in MB.
const MAX_MB_RANGE: std::ops::RangeInclusive<f64> = 0.1..=50.0;
/// Upload bodies are capped at the highest limit; the chosen limit is checked inside.
const UPLOAD_CAP: usize = 50 * 1024 * 1024 + 4096;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/vault/image",
            post(h_upload).layer(DefaultBodyLimit::max(UPLOAD_CAP)),
        )
        .route("/api/vault/image/delete", post(h_delete))
        .route("/api/vault/images", get(h_list))
        .route("/api/vault/storage", get(h_storage))
        .route("/api/settings/media", get(h_media_get).post(h_media_set))
}

/// Load the saved upload limit into the core (at start and after a change).
pub fn load_media_settings(st: &AppState) {
    let mb = st
        .db
        .read(|c| memora_state::ui_layout::get(c, MEDIA_LAYOUT))
        .ok()
        .flatten()
        .and_then(|l| serde_json::from_str::<Value>(&l.data).ok())
        .and_then(|v| v["max_image_mb"].as_f64())
        .filter(|mb| MAX_MB_RANGE.contains(mb));
    set_image_max_bytes(mb.map_or(DEFAULT_IMAGE_MAX, |mb| (mb * 1_048_576.0) as usize));
}

fn mb(bytes: usize) -> f64 {
    (bytes as f64 / 1_048_576.0 * 10.0).round() / 10.0
}

fn mem_err(e: memora_core::vault::MemoryErr) -> Response {
    let msg = e.to_string();
    let code = if msg.to_lowercase().contains("not found") {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::BAD_REQUEST
    };
    (code, Json(json!({"error": msg}))).into_response()
}

async fn h_upload(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let note = crate::query_value(req.uri(), "note").unwrap_or_default();
    let name = crate::query_value(req.uri(), "name").unwrap_or_else(|| "image".to_string());
    if note.trim().is_empty() {
        return bad("note is required: the image is kept beside that note");
    }
    let bytes = match axum::body::to_bytes(req.into_body(), UPLOAD_CAP).await {
        Ok(b) => b,
        Err(_) => return bad("the image is larger than the highest upload limit (50 MB)"),
    };
    let key = key.map(|Extension(k)| k);
    let saved = crate::blocking(move || {
        crate::store_as(&st, key.as_ref()).save_image_impl(
            note.trim(),
            &name,
            &bytes,
            image_max_bytes(),
        )
    })
    .await;
    match saved {
        Ok(v) => Json(v).into_response(),
        Err(e) => mem_err(e),
    }
}

async fn h_delete(
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
    let key = key.map(|Extension(k)| k);
    match crate::blocking(move || crate::store_as(&st, key.as_ref()).delete_image_impl(&path)).await
    {
        Ok(v) => Json(v).into_response(),
        Err(e) => mem_err(e),
    }
}

async fn h_list(State(st): State<AppState>, req: Request) -> Response {
    let note = crate::query_value(req.uri(), "note").filter(|s| !s.trim().is_empty());
    let folder = crate::query_value(req.uri(), "folder").unwrap_or_default();
    let key = req.extensions().get::<ApiKeyCaller>().cloned();
    let res = crate::blocking(move || {
        let store = crate::store_as(&st, key.as_ref());
        match note {
            Some(n) => store.note_images_impl(n.trim()),
            None => store
                .folder_images_impl(folder.trim())
                .map(|images| json!({"folder": folder.trim(), "images": images})),
        }
    })
    .await;
    match res {
        Ok(v) => Json(v).into_response(),
        Err(e) => mem_err(e),
    }
}

async fn h_storage(State(st): State<AppState>, req: Request) -> Response {
    let key = req.extensions().get::<ApiKeyCaller>().cloned();
    let mut v = crate::blocking(move || crate::store_as(&st, key.as_ref()).storage_impl()).await;
    v["max_image_bytes"] = json!(image_max_bytes());
    Json(v).into_response()
}

async fn h_media_get() -> Response {
    let n = image_max_bytes();
    Json(json!({"max_image_mb": mb(n), "max_image_bytes": n})).into_response()
}

async fn h_media_set(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let Some(want) = b.get("max_image_mb").and_then(Value::as_f64) else {
        return bad("send max_image_mb");
    };
    if !MAX_MB_RANGE.contains(&want) {
        return bad("max_image_mb must be between 0.1 and 50");
    }
    let doc = json!({"max_image_mb": want}).to_string();
    let now = memora_state::now();
    match st
        .db
        .write(|tx| memora_state::ui_layout::put(tx, MEDIA_LAYOUT, &doc, now))
    {
        Ok(_) => {
            load_media_settings(&st);
            h_media_get().await
        }
        Err(e) => db_err(e, "settings not found"),
    }
}
