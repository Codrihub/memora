//! The owner's pins on the MCP side: [`apply_event`] keeps them on renamed or moved items,
//! and [`pin`], [`unpin`] and friends are shared by the MCP tools and `/api/pins`. Vault
//! reads use the caller's privacy view, so hidden paths are never seen or changed.

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

/// Tell signed-in browsers to reload their pins. Carries no paths: the list is fetched
/// from `/api/pins`.
pub fn publish_changed() {
    publish_changed_by(None);
}

/// [`publish_changed`] naming who changed the pins over MCP (`by`), so the web UI can say
/// who pinned what. Still no paths.
pub fn publish_changed_by(by: Option<&crate::Caller>) {
    let ev = match by {
        Some(c) => json!({
            "type": "pins_changed",
            "actor": c.actor(),
            "actor_id": c.id,
            "actor_kind": c.actor_kind(),
        }),
        None => json!({"type": "pins_changed"}),
    };
    memora_core::events::hub().publish(ev);
}

/// Whether the pinned item exists for this caller (hidden paths answer like missing ones).
fn exists(store: &MemoryStore, kind: Kind, path: &str) -> bool {
    store.resolve(path).is_ok_and(|p| match kind {
        Kind::Note => p.is_file(),
        Kind::Folder => p.is_dir(),
    })
}

/// `{count, pins:[{kind, path, position, missing}]}` for the pins `store`'s caller may
/// see, in order; `missing` means the path no longer exists.
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

/// Pin an existing note or folder at `position` among the visible pins (default: the
/// end), or move it there. `by`: the MCP caller, `None` for the browser.
pub fn pin(
    db: &Db,
    store: &MemoryStore,
    kind: Kind,
    path: &str,
    position: Option<usize>,
    by: Option<&crate::Caller>,
) -> memora_state::Result<Value> {
    pins::check_path(kind, path)?;
    if !exists(store, kind, path) {
        return Err(not_found(kind, path));
    }
    let mut already = false;
    let all = db.write(|tx| {
        let cur = pins::list(tx)?;
        let existing = cur.iter().position(|p| p.kind == kind && p.path == path);
        already = existing.is_some();
        // A position counts only the pins the caller sees, so hidden ones stay uncounted.
        let at = match position {
            // Pinning again without a position keeps the pin where it is.
            None => existing,
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
    publish_changed_by(by);
    let mut v = pins_json(store, &all);
    v["already_pinned"] = json!(already);
    Ok(v)
}

/// [`pin`] for an item the caller names ([`resolve_item`]); without `kind`, a path that
/// is neither a note nor a folder answers "note or folder <path> not found".
pub fn pin_item(
    db: &Db,
    store: &MemoryStore,
    path: &str,
    kind: Option<&str>,
    position: Option<usize>,
    by: Option<&crate::Caller>,
) -> memora_state::Result<Value> {
    let (k, p) = resolve_item(store, path, kind)?;
    if kind_given(kind) || exists(store, k, &p) {
        return pin(db, store, k, &p, position, by);
    }
    Err(memora_state::Error::NotFound(format!(
        "note or folder {}",
        path.trim().trim_end_matches('/')
    )))
}

/// [`unpin`] for an item the caller names ([`resolve_item`]). Without `kind`, a missing
/// path matches a pin on that path of either kind.
pub fn unpin_item(
    db: &Db,
    store: &MemoryStore,
    path: &str,
    kind: Option<&str>,
    by: Option<&crate::Caller>,
) -> memora_state::Result<Value> {
    let (k, p) = resolve_item(store, path, kind)?;
    if !kind_given(kind) && !exists(store, k, &p) {
        let raw = path.trim().trim_end_matches('/');
        let all = db.read(pins::list)?;
        let hit = all
            .iter()
            .find(|x| x.path == raw)
            .or_else(|| all.iter().find(|x| x.kind == Kind::Note && x.path == p));
        if let Some(x) = hit {
            return unpin(db, store, x.kind, &x.path, by);
        }
    }
    unpin(db, store, k, &p, by)
}

fn kind_given(kind: Option<&str>) -> bool {
    kind.is_some_and(|k| !k.trim().is_empty())
}

/// Remove the pin on `(kind, path)` (a pin hidden from the caller answers "not found").
/// Returns [`pins_json`] with `removed`.
pub fn unpin(
    db: &Db,
    store: &MemoryStore,
    kind: Kind,
    path: &str,
    by: Option<&crate::Caller>,
) -> memora_state::Result<Value> {
    pins::check_path(kind, path)?;
    if !store.visible(path) {
        return Err(not_found(kind, path));
    }
    let removed = db.write(|tx| pins::unpin(tx, kind, path))?;
    if removed {
        publish_changed_by(by);
    }
    let mut v = list_json(db, store)?;
    v["removed"] = json!(removed);
    Ok(v)
}

/// Replace every pin with `items` (reorder, remove, first upload). Owner only; paths need
/// not exist. Returns [`pins_json`].
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
        pin(&db, &s, Kind::Note, "Work/Plan.md", None, None).unwrap();
        pin(&db, &s, Kind::Note, "Work/Sub/deep.md", None, None).unwrap();
        pin(&db, &s, Kind::Folder, "Work/Sub", None, None).unwrap();
        pin(&db, &s, Kind::Note, "top.md", Some(0), None).unwrap();
        // Not on disk: refused.
        assert!(matches!(
            pin(&db, &s, Kind::Note, "nope.md", None, None),
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

        // Trash and delete drop pins; a note inside a deleted folder moves up and keeps its pin.
        s.soft_delete_impl("top.md").unwrap();
        s.delete_impl("Archive/Projects/Roadmap.md").unwrap();
        s.delete_folder_impl("Archive/Projects/Sub").unwrap();
        let v = list_json(&db, &s).unwrap();
        assert_eq!(listed(&v), ["note:Archive/Projects/deep.md"]);

        // Renamed outside Memora: the pin stays, marked missing.
        std::fs::rename(
            dir.join("Archive/Projects/deep.md"),
            dir.join("Archive/Projects/elsewhere.md"),
        )
        .unwrap();
        assert_eq!(
            listed(&list_json(&db, &s).unwrap()),
            ["note:Archive/Projects/deep.md (missing)"]
        );
        let v = unpin(&db, &s, Kind::Note, "Archive/Projects/deep.md", None).unwrap();
        assert_eq!(v["removed"], true);
        assert_eq!(v["count"], 0);
        drop(s);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pin_and_unpin_by_name_without_kind() {
        let (dir, store) = vault("by-name");
        let db = Db::open_temp().unwrap();
        let s = store.lock().unwrap();
        pin_item(&db, &s, "Work/Sub", None, None, None).unwrap();
        pin_item(&db, &s, "top", None, None, None).unwrap();
        pin_item(&db, &s, "Work/Plan.md", None, None, None).unwrap();
        // Pinning again without a position keeps the place, and says it was pinned.
        let v = pin_item(&db, &s, "Work/Sub", None, None, None).unwrap();
        assert_eq!(v["already_pinned"], true);
        assert_eq!(
            listed(&v),
            ["folder:Work/Sub", "note:top.md", "note:Work/Plan.md"]
        );
        // With a position it moves.
        let v = pin_item(&db, &s, "Work/Sub", None, Some(2), None).unwrap();
        assert_eq!(listed(&v)[2], "folder:Work/Sub");
        // Neither a note nor a folder.
        let e = pin_item(&db, &s, "Nope", None, None, None)
            .unwrap_err()
            .to_string();
        assert_eq!(e, "note or folder Nope not found");
        // A folder renamed outside Memora: its pin is missing, unpin finds it by path.
        std::fs::rename(dir.join("Work/Sub"), dir.join("Work/Moved")).unwrap();
        let v = unpin_item(&db, &s, "Work/Sub", None, None).unwrap();
        assert_eq!(v["removed"], true);
        // Same for a note named without .md.
        std::fs::rename(dir.join("top.md"), dir.join("gone.md")).unwrap();
        let v = unpin_item(&db, &s, "top", None, None).unwrap();
        assert_eq!(v["removed"], true);
        assert_eq!(listed(&v), ["note:Work/Plan.md"]);
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
