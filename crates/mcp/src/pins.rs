//! The owner's pinned notes and folders (see `memora_state::pins`) on the MCP side:
//!
//! * [`apply_event`]: keeps pins on their notes and folders when the store renames, moves,
//!   trashes or deletes them (run by the path hook, [`crate::path_hook`], in the same
//!   transaction as the privacy rules).
//! * [`list_json`], [`pin`], [`unpin`]: the shapes and checks shared by the MCP tools
//!   (`list_pins`, `pin`, `unpin`) and the HTTP API (`/api/pins`).
//!
//! Every function that reads the vault takes the store as the caller sees it: an agent
//! whose privacy rules hide a path never sees, adds or removes a pin on it.

use memora_core::privacy::PathEvent;
use memora_core::MemoryStore;
use memora_state::pins::{self, Kind, Pin};
use memora_state::{Db, Transaction};
use serde_json::{json, Value};

/// Apply one store path event to the pins (inside `tx`); returns how many changed.
pub fn apply_event(tx: &Transaction<'_>, ev: &PathEvent) -> memora_state::Result<usize> {
    match ev {
        // Into the trash (or any hidden folder) `rename_path` drops the pins instead.
        PathEvent::Moved { from, to, .. } => pins::rename_path(tx, from, to),
        PathEvent::Deleted { path } => pins::forget(tx, path),
    }
}

/// Tell signed-in browsers to reload their pins. Carries nothing else: the list is
/// fetched from `/api/pins`.
pub fn publish_changed() {
    memora_core::events::hub().publish(json!({"type": "pins_changed"}));
}

/// Whether the pinned item exists for this caller (hidden paths answer like missing ones).
fn exists(store: &MemoryStore, kind: Kind, path: &str) -> bool {
    store.resolve(path).is_ok_and(|p| match kind {
        Kind::Note => p.is_file(),
        Kind::Folder => p.is_dir(),
    })
}

/// `{count, pins:[{kind, path, position, missing}]}` for the pins `store`'s caller may
/// see, in order. `missing`: the path no longer exists (renamed or deleted outside
/// Memora).
pub fn pins_json(store: &MemoryStore, all: &[Pin]) -> Value {
    let shown: Vec<Value> = all
        .iter()
        .filter(|p| store.visible(&p.path))
        .enumerate()
        .map(|(i, p)| {
            json!({
                "kind": p.kind, "path": p.path, "position": i,
                "missing": !exists(store, p.kind, &p.path),
            })
        })
        .collect();
    json!({"count": shown.len(), "pins": shown})
}

/// [`pins_json`] of the stored list.
pub fn list_json(db: &Db, store: &MemoryStore) -> memora_state::Result<Value> {
    let all = db.read(pins::list)?;
    Ok(pins_json(store, &all))
}

/// The kind and stored path of an item the caller names: `kind` as given, else what the
/// path is on disk (a folder, or a note; `Plan` finds `Plan.md`).
pub fn resolve_item(
    store: &MemoryStore,
    path: &str,
    kind: Option<&str>,
) -> memora_state::Result<(Kind, String)> {
    let path = path.trim().trim_end_matches('/');
    let given: Option<Kind> = match kind.map(str::trim).filter(|k| !k.is_empty()) {
        Some(k) => Some(k.parse()?),
        None => None,
    };
    let with_md = |p: &str| {
        if p.ends_with(".md") {
            p.to_string()
        } else {
            format!("{p}.md")
        }
    };
    let (kind, path) = match given {
        Some(Kind::Folder) => (Kind::Folder, path.to_string()),
        Some(Kind::Note) if exists(store, Kind::Note, path) => (Kind::Note, path.to_string()),
        Some(Kind::Note) => (Kind::Note, with_md(path)),
        None if exists(store, Kind::Folder, path) => (Kind::Folder, path.to_string()),
        None if exists(store, Kind::Note, path) || path.ends_with(".md") => {
            (Kind::Note, path.to_string())
        }
        None => (Kind::Note, with_md(path)),
    };
    pins::check_path(kind, &path)?;
    Ok((kind, path))
}

fn not_found(kind: Kind, path: &str) -> memora_state::Error {
    memora_state::Error::NotFound(format!("{} {path}", kind.as_str()))
}

/// Pin an existing note or folder at `position` (among the pins the caller sees; default:
/// the end), or move it there. Returns [`pins_json`].
pub fn pin(
    db: &Db,
    store: &MemoryStore,
    kind: Kind,
    path: &str,
    position: Option<usize>,
) -> memora_state::Result<Value> {
    pins::check_path(kind, path)?;
    if !exists(store, kind, path) {
        return Err(not_found(kind, path));
    }
    let all = db.write(|tx| {
        // A position counts the pins the caller sees: it maps to the slot of the visible
        // pin there, so a restricted caller can neither see nor count hidden ones.
        let at = match position {
            None => None,
            Some(want) => {
                let cur: Vec<Pin> = pins::list(tx)?
                    .into_iter()
                    .filter(|p| !(p.kind == kind && p.path == path))
                    .collect();
                let slot = cur
                    .iter()
                    .enumerate()
                    .filter(|(_, p)| store.visible(&p.path))
                    .map(|(i, _)| i)
                    .nth(want);
                Some(slot.unwrap_or(cur.len()))
            }
        };
        pins::pin(tx, kind, path, at, memora_state::now())
    })?;
    publish_changed();
    Ok(pins_json(store, &all))
}

/// Remove the pin on `(kind, path)` (a pin hidden from the caller answers "not found").
/// Returns [`pins_json`] with `removed`.
pub fn unpin(db: &Db, store: &MemoryStore, kind: Kind, path: &str) -> memora_state::Result<Value> {
    pins::check_path(kind, path)?;
    if !store.visible(path) {
        return Err(not_found(kind, path));
    }
    let removed = db.write(|tx| pins::unpin(tx, kind, path))?;
    if removed {
        publish_changed();
    }
    let mut v = list_json(db, store)?;
    v["removed"] = json!(removed);
    Ok(v)
}

/// Replace every pin with `items` (reorder, remove, first upload). Owner only (no
/// view): paths need not exist, so a missing pin can be kept or removed. Returns
/// [`pins_json`].
pub fn replace(
    db: &Db,
    store: &MemoryStore,
    items: &[(Kind, String)],
) -> memora_state::Result<Value> {
    let all = db.write(|tx| pins::replace(tx, items, memora_state::now()))?;
    publish_changed();
    Ok(pins_json(store, &all))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn vault(tag: &str) -> (std::path::PathBuf, Arc<Mutex<MemoryStore>>) {
        let dir =
            std::env::temp_dir().join(format!("memora-mcp-pins-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Work/Sub")).unwrap();
        std::fs::write(dir.join("Work/Plan.md"), "# Plan\n").unwrap();
        std::fs::write(dir.join("Work/Sub/deep.md"), "# Deep\n").unwrap();
        std::fs::write(dir.join("top.md"), "# Top\n").unwrap();
        let store = Arc::new(Mutex::new(MemoryStore::new(&dir)));
        (dir, store)
    }

    fn listed(v: &Value) -> Vec<String> {
        v["pins"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                format!(
                    "{}:{}{}",
                    p["kind"].as_str().unwrap(),
                    p["path"].as_str().unwrap(),
                    if p["missing"] == true {
                        " (missing)"
                    } else {
                        ""
                    }
                )
            })
            .collect()
    }

    #[test]
    fn store_operations_carry_pins_along() {
        let (dir, store) = vault("ops");
        let db = Db::open_temp().unwrap();
        store
            .lock()
            .unwrap()
            .set_path_hook(Some(crate::path_hook(db.clone())));
        let s = store.lock().unwrap();
        pin(&db, &s, Kind::Note, "Work/Plan.md", None).unwrap();
        pin(&db, &s, Kind::Note, "Work/Sub/deep.md", None).unwrap();
        pin(&db, &s, Kind::Folder, "Work/Sub", None).unwrap();
        pin(&db, &s, Kind::Note, "top.md", Some(0)).unwrap();
        // Not on disk: refused.
        assert!(matches!(
            pin(&db, &s, Kind::Note, "nope.md", None),
            Err(memora_state::Error::NotFound(_))
        ));

        // Note rename, folder rename, then a folder move with pinned notes inside.
        let renamed = s.rename_impl("Work/Plan.md", "Roadmap").unwrap();
        assert_eq!(renamed, "Work/Roadmap.md");
        s.rename_folder_impl("Work", "Projects").unwrap();
        s.move_folder_impl("Projects", "Archive").unwrap();
        assert_eq!(
            listed(&list_json(&db, &s).unwrap()),
            [
                "note:top.md",
                "note:Archive/Projects/Roadmap.md",
                "note:Archive/Projects/Sub/deep.md",
                "folder:Archive/Projects/Sub"
            ]
        );

        // Trash and delete drop pins; deleting a folder drops the folder pins under it,
        // while a note inside moves to Root and its pin follows.
        s.soft_delete_impl("top.md").unwrap();
        s.delete_impl("Archive/Projects/Roadmap.md").unwrap();
        s.delete_folder_impl("Archive/Projects/Sub").unwrap();
        let v = list_json(&db, &s).unwrap();
        assert_eq!(listed(&v), ["note:deep.md"]);

        // Renamed outside Memora: the pin stays, marked missing.
        std::fs::rename(dir.join("deep.md"), dir.join("elsewhere.md")).unwrap();
        assert_eq!(
            listed(&list_json(&db, &s).unwrap()),
            ["note:deep.md (missing)"]
        );
        let v = unpin(&db, &s, Kind::Note, "deep.md").unwrap();
        assert_eq!(v["removed"], true);
        assert_eq!(v["count"], 0);
        drop(s);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn items_resolve_by_disk() {
        let (dir, store) = vault("resolve");
        let s = store.lock().unwrap();
        let r = |p: &str, k: Option<&str>| resolve_item(&s, p, k).map_err(|e| e.to_string());
        assert_eq!(r("Work", None).unwrap(), (Kind::Folder, "Work".into()));
        assert_eq!(r("Work/", None).unwrap(), (Kind::Folder, "Work".into()));
        assert_eq!(
            r("Work/Plan", None).unwrap(),
            (Kind::Note, "Work/Plan.md".into())
        );
        assert_eq!(
            r("Work/Plan.md", Some("note")).unwrap(),
            (Kind::Note, "Work/Plan.md".into())
        );
        assert!(r("../etc/passwd", None).is_err());
        assert!(r("/abs", Some("folder")).is_err());
        assert!(r(".Trash/x.md", None).is_err());
        assert!(r("x", Some("file")).is_err());
        drop(s);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
