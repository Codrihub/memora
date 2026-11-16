//! Images given to Mnemo in a chat. They wait in `<state>/assistant-uploads/` until Mnemo
//! places one beside a note (`place_image`, which goes through the MCP `upload_image` tool so
//! it shows in Activity), and are removed after a week either way (the chat shows them to the model meanwhile).
//!
//! * `POST /api/assistant/uploads?name=<file>` (image bytes) -> `{id, name, bytes, url}`
//! * `GET /api/assistant/uploads/{id}` -> the image (for the chat's thumbnails)

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path as UrlPath, Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Extension, Router,
};
use memora_core::vault::image_max_bytes;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use super::{browser_only, fail};
use crate::api::{bad, csrf_fail, csrf_ok};
use crate::{ApiKeyCaller, AppState};

const DIR: &str = "assistant-uploads";
/// Staged images older than this are removed.
const KEEP_SECS: u64 = 7 * 24 * 3600;
const CAP: usize = 50 * 1024 * 1024 + 4096;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/assistant/uploads",
            post(h_upload).layer(DefaultBodyLimit::max(CAP)),
        )
        .route("/api/assistant/uploads/{id}", get(h_get))
}

fn dir(st: &AppState) -> PathBuf {
    st.db.state_dir().join(DIR)
}

/// PNG, JPEG, WebP or GIF by their first bytes: `(extension, media type)`.
pub fn sniff(b: &[u8]) -> Option<(&'static str, &'static str)> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else if b.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("jpg", "image/jpeg"))
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some(("gif", "image/gif"))
    } else {
        None
    }
}

fn valid_id(id: &str) -> bool {
    id.len() == 13 && id.starts_with('u') && id[1..].bytes().all(|c| c.is_ascii_hexdigit())
}

/// A file name that is safe to keep: the base name, no control or path characters.
fn clean_name(name: &str, ext: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let mut out: String = base
        .chars()
        .filter(|c| {
            !c.is_control()
                && !matches!(
                    c,
                    ':' | '*' | '?' | '"' | '<' | '>' | '|' | '#' | '[' | ']' | '^'
                )
        })
        .collect();
    out = out
        .trim()
        .trim_start_matches('.')
        .chars()
        .take(80)
        .collect();
    let stem = Path::new(&out)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let stem = if stem.is_empty() {
        "image".to_string()
    } else {
        stem
    };
    format!("{stem}.{ext}")
}

fn prune(d: &Path) {
    let Ok(rd) = std::fs::read_dir(d) else { return };
    let now = std::time::SystemTime::now();
    for e in rd.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age.as_secs() > KEEP_SECS);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

async fn h_upload(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let name = crate::query_value(req.uri(), "name").unwrap_or_else(|| "image".into());
    let bytes = match axum::body::to_bytes(req.into_body(), CAP).await {
        Ok(b) => b,
        Err(_) => return bad("the image is larger than the highest upload limit (50 MB)"),
    };
    let max = image_max_bytes();
    if bytes.len() > max {
        return bad(&format!(
            "the image is {:.1} MB; the largest allowed is {:.1} MB (Settings, Images)",
            bytes.len() as f64 / 1_048_576.0,
            max as f64 / 1_048_576.0
        ));
    }
    let Some((ext, _)) = sniff(&bytes) else {
        return bad("only PNG, JPEG, WebP or GIF images");
    };
    let d = dir(&st);
    let res = crate::blocking(move || -> Result<Value, String> {
        std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o700));
        }
        prune(&d);
        let id = format!("u{}", &memora_gateway::hash_api_key(&memora_gateway::generate_key())[..12]);
        let file = clean_name(&name, ext);
        std::fs::write(d.join(format!("{id}.{ext}")), &bytes).map_err(|e| e.to_string())?;
        std::fs::write(d.join(format!("{id}.json")), json!({"name": file, "ext": ext, "bytes": bytes.len()}).to_string())
            .map_err(|e| e.to_string())?;
        Ok(json!({"id": id, "name": file, "bytes": bytes.len(), "url": format!("/api/assistant/uploads/{id}")}))
    })
    .await;
    match res {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("could not keep the image: {e}"),
        ),
    }
}

/// A staged image: `(file name, extension, bytes)`.
pub fn read(st: &AppState, id: &str) -> Result<(String, String, Vec<u8>), String> {
    if !valid_id(id) {
        return Err(format!("{id} is not an image from this chat"));
    }
    let d = dir(st);
    let meta: Value = std::fs::read_to_string(d.join(format!("{id}.json")))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or_else(|| {
            format!("the image {id} is gone (images wait a week); ask the owner to attach it again")
        })?;
    let ext = meta["ext"].as_str().unwrap_or("png").to_string();
    let bytes = std::fs::read(d.join(format!("{id}.{ext}")))
        .map_err(|_| format!("the image {id} is gone"))?;
    Ok((
        meta["name"].as_str().unwrap_or("image.png").to_string(),
        ext,
        bytes,
    ))
}

pub fn remove(st: &AppState, id: &str) {
    if !valid_id(id) {
        return;
    }
    let d = dir(st);
    if let Ok(rd) = std::fs::read_dir(&d) {
        for e in rd.flatten() {
            if e.file_name()
                .to_string_lossy()
                .starts_with(&format!("{id}."))
            {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

async fn h_get(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    match crate::blocking(move || read(&st, &id)).await {
        Ok((_, _, bytes)) => {
            let ty = sniff(&bytes).map_or("application/octet-stream", |(_, t)| t);
            (
                [
                    (header::CONTENT_TYPE, ty),
                    (header::CACHE_CONTROL, "private, max-age=3600"),
                    (
                        header::CONTENT_SECURITY_POLICY,
                        "default-src 'none'; sandbox",
                    ),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                ],
                Body::from(bytes),
            )
                .into_response()
        }
        Err(e) => fail(StatusCode::NOT_FOUND, &e),
    }
}

/// Standard base64, for handing a staged image to `upload_image` inside the server.
pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(
            memora_core::vault::decode_base64(&base64(&[0, 255, 7, 128, 9])).unwrap(),
            vec![0, 255, 7, 128, 9]
        );
    }

    #[test]
    fn names_and_ids_are_kept_safe() {
        assert_eq!(clean_name("../../etc/pass?wd.png", "png"), "passwd.png");
        assert_eq!(clean_name("", "jpg"), "image.jpg");
        assert_eq!(clean_name("photo.HEIC", "jpg"), "photo.jpg");
        assert!(valid_id("u0123456789ab") && !valid_id("u../../x") && !valid_id("x0123456789ab"));
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\nrest"), Some(("png", "image/png")));
        assert!(sniff(b"<svg>").is_none());
    }
}
