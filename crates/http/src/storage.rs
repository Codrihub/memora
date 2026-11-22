//! How full each kind of storage is (notes, images, chats), each against its own room: the
//! owner's limit for it when one is set, otherwise what it uses plus the free space left on
//! its disk. At 90% it is almost full and at 99% full; the web app shows it, and every MCP
//! tool result carries a `storage` notice then, so any agent knows (and tells the owner).
//!
//! Measured in the background every few minutes (walking the vault is not free) and kept;
//! readers only ever see the last measurement.

use axum::{
    extract::{Request, State},
    http::HeaderMap,
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;

use crate::api::{bad, csrf_fail, csrf_ok};
use crate::{ApiKeyCaller, AppState};

/// The owner's limits `{notes_mb, images_mb, chats_mb}` (each optional), as a layout doc.
const LIMITS_LAYOUT: &str = "srv-storage";
const ALMOST: f64 = 90.0;
const FULL: f64 = 99.0;
const EVERY_SECS: u64 = 300;
const KINDS: &[&str] = &["notes", "images", "chats"];

fn last() -> &'static Mutex<Option<(u64, Value)>> {
    static L: std::sync::OnceLock<Mutex<Option<(u64, Value)>>> = std::sync::OnceLock::new();
    L.get_or_init(|| Mutex::new(None))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/storage/health", get(h_health).post(h_limits))
        .route("/api/vault/images/all", get(h_all_images))
}

/// Measure now and then every few minutes; MCP tool results read the last measurement.
pub fn spawn(st: &AppState) {
    let st2 = st.clone();
    memora_mcp::set_result_note(Box::new(notice_for));
    tokio::spawn(async move {
        loop {
            let s = st2.clone();
            let _ = tokio::task::spawn_blocking(move || measure(&s)).await;
            tokio::time::sleep(std::time::Duration::from_secs(EVERY_SECS)).await;
        }
    });
}

fn limits(st: &AppState) -> Value {
    st.db
        .read(|c| memora_state::ui_layout::get(c, LIMITS_LAYOUT))
        .ok()
        .flatten()
        .and_then(|l| serde_json::from_str::<Value>(&l.data).ok())
        .unwrap_or_else(|| json!({}))
}

/// Free and total bytes of the disk holding `p`.
#[cfg(not(unix))]
fn disk(_p: &Path) -> Option<(u64, u64)> {
    None
}

/// Free and total bytes of the disk holding `p`.
#[cfg(unix)]
fn disk(p: &Path) -> Option<(u64, u64)> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(p.as_os_str().as_bytes()).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a valid NUL-terminated path and `s` a writable statvfs.
    if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
        return None;
    }
    let unit = s.f_frsize as u64;
    Some((s.f_bavail as u64 * unit, s.f_blocks as u64 * unit))
}

fn vault_root(st: &AppState) -> std::path::PathBuf {
    st.store
        .lock()
        .map(|s| s.root().to_path_buf())
        .unwrap_or_default()
}

fn dir_bytes(p: &Path) -> u64 {
    walkdir::WalkDir::new(p)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .map(|e| e.metadata().map_or(0, |m| m.len()))
        .sum()
}

fn label(kind: &str) -> &'static str {
    match kind {
        "notes" => "Notes",
        "images" => "Images",
        _ => "Chats",
    }
}

fn advice(kind: &str) -> &'static str {
    match kind {
        "notes" => "Delete or archive notes you no longer need, or empty the Trash.",
        "images" => "Delete images you no longer need (Settings, Images shows them all and where they are used).",
        _ => "Delete or clean up old Mnemo chats (Mnemo, View all chats).",
    }
}

/// One kind against its room.
fn entry(kind: &str, used: u64, count: u64, limit_mb: Option<f64>, free: Option<u64>) -> Value {
    let (room, source) = match (limit_mb, free) {
        (Some(mb), _) => (((mb * 1_048_576.0) as u64).max(1), "limit"),
        (None, Some(f)) => ((used + f).max(1), "disk"),
        (None, None) => (0, "unknown"),
    };
    let pct = if room > 0 {
        (used as f64 * 100.0 / room as f64).min(100.0)
    } else {
        0.0
    };
    let pct = (pct * 10.0).round() / 10.0;
    let level = if pct >= FULL {
        "full"
    } else if pct >= ALMOST {
        "almost"
    } else {
        "ok"
    };
    let message = match level {
        "full" => Some(format!(
            "{} storage is full ({pct}% of {}). {}",
            label(kind),
            if source == "limit" {
                "its limit"
            } else {
                "the space left for it on the disk"
            },
            advice(kind)
        )),
        "almost" => Some(format!(
            "{} storage is almost full ({pct}% of {}). {}",
            label(kind),
            if source == "limit" {
                "its limit"
            } else {
                "the space left for it on the disk"
            },
            advice(kind)
        )),
        _ => None,
    };
    json!({"kind": kind, "used_bytes": used, "count": count, "room_bytes": room, "room": source,
           "limit_mb": limit_mb, "percent": pct, "level": level, "message": message})
}

/// Measure every kind now and keep it.
pub fn measure(st: &AppState) -> Value {
    let lim = limits(st);
    let vault = crate::store_as(st, None).storage_impl();
    let vault_dir = vault_root(st);
    let state_dir = st.db.state_dir().to_path_buf();
    let vfree = disk(&vault_dir).map(|x| x.0);
    let sfree = disk(&state_dir).map(|x| x.0);
    // Chats: the assistant database and the pictures staged for chats.
    let chat_bytes: u64 = std::fs::read_dir(&state_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("assistant.sqlite3")
        })
        .map(|e| e.metadata().map_or(0, |m| m.len()))
        .sum::<u64>()
        + dir_bytes(&state_dir.join("assistant-uploads"));
    let chats = crate::assistant::chat_count(st);
    let n = |k: &str| vault[k].as_u64().unwrap_or(0);
    let mb = |k: &str| lim[k].as_f64().filter(|x| *x > 0.0);
    let kinds = vec![
        entry("notes", n("note_bytes"), n("notes"), mb("notes_mb"), vfree),
        entry(
            "images",
            n("image_bytes"),
            n("images"),
            mb("images_mb"),
            vfree,
        ),
        entry("chats", chat_bytes, chats, mb("chats_mb"), sfree),
    ];
    let warnings: Vec<Value> = kinds
        .iter()
        .filter(|k| k["level"] != "ok")
        .cloned()
        .collect();
    let v = json!({
        "at": memora_state::now(),
        "kinds": kinds,
        "warnings": warnings,
        "disk": disk(&vault_dir).map(|(f, t)| json!({"free_bytes": f, "total_bytes": t})),
        "limits": lim,
    });
    if let Ok(mut l) = last().lock() {
        *l = Some((memora_state::now() as u64, v.clone()));
    }
    v
}

/// The last measurement, if any.
pub fn latest() -> Option<Value> {
    last()
        .lock()
        .ok()
        .and_then(|l| l.as_ref().map(|x| x.1.clone()))
}

/// For an MCP tool result: the warnings that matter to this tool (images for image tools,
/// notes for the rest, chats for Mnemo's chat tools), or none.
fn notice_for(tool: &str) -> Option<Value> {
    let v = latest()?;
    let want: &[&str] = if tool.contains("image") {
        &["images"]
    } else if tool.contains("chat") {
        &["chats"]
    } else {
        &["notes", "images"]
    };
    let hits: Vec<Value> = v["warnings"]
        .as_array()?
        .iter()
        .filter(|w| w["kind"].as_str().is_some_and(|k| want.contains(&k)))
        .map(|w| {
            json!({"kind": w["kind"], "level": w["level"], "percent": w["percent"], "message": w["message"],
                   "tell_owner": true})
        })
        .collect();
    (!hits.is_empty()).then(|| json!(hits))
}

/// `GET /api/storage/health`: how full notes, images and chats are (`?fresh=1` measures now).
async fn h_health(State(st): State<AppState>, req: Request) -> Response {
    let age = latest()
        .and_then(|v| v["at"].as_i64())
        .map(|at| memora_state::now() - at);
    // `fresh` measures now, but never more than once in 15 seconds (it walks the vault).
    let fresh = crate::query_value(req.uri(), "fresh").is_some() && age.is_none_or(|a| a >= 15);
    let stale = age.is_none_or(|a| a > 60);
    let v = if fresh || stale {
        crate::blocking(move || measure(&st)).await
    } else {
        latest().unwrap_or(Value::Null)
    };
    Json(v).into_response()
}

/// `POST /api/storage/health` `{notes_mb?, images_mb?, chats_mb?}`: the owner's limits (`null`
/// or 0 for none: the disk is the limit).
async fn h_limits(
    State(st): State<AppState>,
    key: Option<axum::Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    // The owner's own setting: not for API keys.
    if key.is_some() {
        return (
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "storage limits are set in the signed-in browser"})),
        )
            .into_response();
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let mut out = serde_json::Map::new();
    for k in KINDS {
        let key = format!("{k}_mb");
        match b.get(&key) {
            None | Some(Value::Null) => {}
            Some(v) => match v.as_f64() {
                Some(0.0) => {}
                Some(x) if (1.0..=10_000_000.0).contains(&x) => {
                    out.insert(key, json!(x));
                }
                _ => return bad(&format!("{key} is 1 to 10000000 MB, or 0 for none")),
            },
        }
    }
    let doc = Value::Object(out).to_string();
    let now = memora_state::now();
    if let Err(e) = st
        .db
        .write(|tx| memora_state::ui_layout::put(tx, LIMITS_LAYOUT, &doc, now))
    {
        return bad(&e.to_string());
    }
    let v = crate::blocking(move || measure(&st)).await;
    Json(v).into_response()
}

/// `GET /api/vault/images/all`: every image in the vault (each folder's, with the notes that
/// show it) and the pictures staged for Mnemo's chats (with the chats that use them).
async fn h_all_images(State(st): State<AppState>, req: Request) -> Response {
    let key = req.extensions().get::<ApiKeyCaller>().cloned();
    let v = crate::blocking(move || {
        // The vault lock is taken per folder below and never twice at once: asking for the
        // root while holding it would wait for ever.
        let root = vault_root(&st);
        let mut images: Vec<Value> = Vec::new();
        let mut folders = vec![String::new()];
        for e in walkdir::WalkDir::new(&root)
            .min_depth(1)
            .into_iter()
            .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_dir())
        {
            if let Ok(rel) = e.path().strip_prefix(&root) {
                folders.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
        for f in folders {
            let arg = if f.is_empty() { "Root".to_string() } else { f };
            let listed = crate::store_as(&st, key.as_ref()).folder_images_impl(&arg);
            if let Ok(list) = listed {
                images.extend(list);
            }
        }
        // Owner-only extra: what Mnemo's chats hold (an API key never sees chats).
        let chats = if key.is_none() {
            crate::assistant::staged_images(&st)
        } else {
            Vec::new()
        };
        let bytes: u64 = images.iter().filter_map(|i| i["bytes"].as_u64()).sum();
        json!({"images": images, "bytes": bytes, "chat_images": chats})
    })
    .await;
    Json(v).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_kind_is_measured_against_its_own_room() {
        let mb = 1_048_576u64;
        let e = entry("images", 99 * mb, 10, Some(100.0), Some(10_000 * mb));
        assert_eq!(
            (e["level"].as_str(), e["room"].as_str()),
            (Some("full"), Some("limit"))
        );
        assert!(e["message"]
            .as_str()
            .unwrap()
            .starts_with("Images storage is full (99%"));
        let e = entry("notes", 91 * mb, 3, None, Some(9 * mb));
        assert_eq!(
            (e["level"].as_str(), e["percent"].as_f64()),
            (Some("almost"), Some(91.0))
        );
        let e = entry("chats", mb, 1, None, Some(100 * mb));
        assert_eq!(e["level"], "ok");
        assert!(e["message"].is_null());
    }
}
