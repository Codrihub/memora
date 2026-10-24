//! Static UI files cached in memory with ETag and gzip, so a reload costs a 304.
//! `no-cache` still revalidates every load, so a redeploy shows up at once.

use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use flate2::{write::GzEncoder, Compression};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

#[derive(Clone)]
struct Body {
    etag: String,
    raw: Arc<Vec<u8>>,
    gz: Option<Arc<Vec<u8>>>,
}

struct Entry {
    stamp: (u64, Option<SystemTime>),
    body: Body,
}

fn cache() -> &'static Mutex<HashMap<String, Entry>> {
    static C: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// FNV-1a 64: enough to tell two builds apart, no extra dependency.
fn fnv(b: &[u8]) -> u64 {
    b.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, &x| {
        (h ^ x as u64).wrapping_mul(0x100_0000_01b3)
    })
}

fn compressible(ct: &str) -> bool {
    ct.starts_with("text/")
        || ct.contains("javascript")
        || ct.contains("json")
        || ct.contains("svg")
        || ct.contains("manifest")
}

/// Load (or reuse) the file; `None` when it cannot be read.
fn load(path: &Path, ct: &str) -> Option<Body> {
    let md = std::fs::metadata(path).ok()?;
    let stamp = (md.len(), md.modified().ok());
    let key = path.to_string_lossy().into_owned();
    if let Some(e) = cache().lock().ok()?.get(&key) {
        if e.stamp == stamp {
            return Some(e.body.clone());
        }
    }
    let raw = Arc::new(std::fs::read(path).ok()?);
    let etag = format!("\"{:x}-{:x}\"", raw.len(), fnv(&raw));
    let gz = (compressible(ct) && raw.len() > 1024)
        .then(|| {
            let mut enc = GzEncoder::new(Vec::with_capacity(raw.len() / 3), Compression::new(6));
            enc.write_all(&raw).ok()?;
            enc.finish().ok()
        })
        .flatten()
        .map(Arc::new);
    let body = Body { etag, raw, gz };
    if let Ok(mut c) = cache().lock() {
        c.insert(
            key,
            Entry {
                stamp,
                body: body.clone(),
            },
        );
    }
    Some(body)
}

fn accepts_gzip(h: &HeaderMap) -> bool {
    h.get(header::ACCEPT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',')
                .any(|p| p.trim().split(';').next() == Some("gzip"))
        })
}

/// Serve one file with ETag/304 and gzip when the client takes it.
pub fn serve(
    path: &Path,
    ct: &'static str,
    cache_control: &'static str,
    req: &HeaderMap,
) -> Response {
    let Some(Body { etag, raw, gz }) = load(path, ct) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    let tag = HeaderValue::from_str(&etag).unwrap_or(HeaderValue::from_static("\"0\""));
    let matched = req
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',')
                .any(|t| t.trim().trim_start_matches("W/") == etag)
        });
    let base = [
        (
            header::CACHE_CONTROL,
            HeaderValue::from_static(cache_control),
        ),
        (header::ETAG, tag),
        (header::VARY, HeaderValue::from_static("Accept-Encoding")),
    ];
    if matched {
        return (StatusCode::NOT_MODIFIED, base).into_response();
    }
    let ctv = HeaderValue::from_static(ct);
    match gz.filter(|_| accepts_gzip(req)) {
        Some(gz) => (
            base,
            [
                (header::CONTENT_TYPE, ctv),
                (header::CONTENT_ENCODING, HeaderValue::from_static("gzip")),
            ],
            gz.as_ref().clone(),
        )
            .into_response(),
        None => (base, [(header::CONTENT_TYPE, ctv)], raw.as_ref().clone()).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etag_304_and_gzip() {
        let d = std::env::temp_dir().join(format!("memora-assets-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("app.js");
        std::fs::write(&p, "console.log(1);".repeat(200)).unwrap();
        let mut h = HeaderMap::new();
        h.insert(
            header::ACCEPT_ENCODING,
            HeaderValue::from_static("br, gzip"),
        );
        let r = serve(&p, "text/javascript", "no-cache", &h);
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()[header::CONTENT_ENCODING], "gzip");
        let etag = r.headers()[header::ETAG].clone();
        h.insert(header::IF_NONE_MATCH, etag.clone());
        assert_eq!(
            serve(&p, "text/javascript", "no-cache", &h).status(),
            StatusCode::NOT_MODIFIED
        );
        // A new build gets a new tag.
        std::fs::write(&p, "console.log(2);".repeat(300)).unwrap();
        let r = serve(&p, "text/javascript", "no-cache", &h);
        assert_eq!(r.status(), StatusCode::OK);
        assert_ne!(r.headers()[header::ETAG], etag);
        std::fs::remove_dir_all(&d).ok();
    }
}
