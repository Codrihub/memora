//! Per-caller path visibility and path-change hooks for [`MemoryStore`].
//!
//! * A [`PathView`] hides vault paths from the current caller (an agent). While a view
//!   is set ([`lock_as`]), every listing of the store skips hidden notes (`walk`, search,
//!   images, events, logs, locks, folder metadata), every path the caller names is
//!   resolved as "not found" when hidden (reads and write targets alike), and folder
//!   operations that would carry hidden items along are refused. The owner (no view)
//!   sees everything.
//! * A [`PathHook`] hears about every rename, move and delete the store performs, so the
//!   server can keep privacy rules attached to the notes and folders they protect.

use crate::MemoryStore;
use serde_json::Value;
use std::ops::{Deref, DerefMut};
use std::sync::{Arc, Mutex, MutexGuard};

/// Which vault paths the current caller may see.
pub trait PathView: Send + Sync {
    /// Whether `rel` (vault-relative note, folder or file path, any spelling) is visible.
    fn visible(&self, rel: &str) -> bool;
    /// Whether free text (an event field, a commit message) names a hidden path.
    fn mentions_hidden(&self, text: &str) -> bool;
}

/// A rename, move or delete done by the store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathEvent {
    /// `from` (a note, or a folder with everything in it) is now at `to`. With `carry`,
    /// the move was implicit (into the trash, out of a deleted folder) and the item keeps
    /// the protection of the folder it left.
    Moved {
        from: String,
        to: String,
        carry: bool,
    },
    /// `path` (a note, or a folder with everything in it) is gone for good.
    Deleted { path: String },
}

/// Called after each [`PathEvent`] (with the store locked).
pub type PathHook = Arc<dyn Fn(&PathEvent) + Send + Sync>;

/// The store locked for one caller: the view is set while the guard lives and cleared
/// when it drops (also on panic), so it can never leak into another request.
pub struct Viewed<'a> {
    guard: MutexGuard<'a, MemoryStore>,
}

impl Deref for Viewed<'_> {
    type Target = MemoryStore;
    fn deref(&self) -> &MemoryStore {
        &self.guard
    }
}

impl DerefMut for Viewed<'_> {
    fn deref_mut(&mut self) -> &mut MemoryStore {
        &mut self.guard
    }
}

impl Drop for Viewed<'_> {
    fn drop(&mut self) {
        self.guard.view = None;
    }
}

/// Lock `store` for a caller with `view` (`None` = the owner, sees everything).
pub fn lock_as(store: &Mutex<MemoryStore>, view: Option<Arc<dyn PathView>>) -> Viewed<'_> {
    let mut guard = store.lock().unwrap_or_else(|e| e.into_inner());
    guard.view = view;
    Viewed { guard }
}

impl MemoryStore {
    /// Whether the current caller may see `rel` (always true without a view).
    pub fn visible(&self, rel: &str) -> bool {
        self.view.as_ref().is_none_or(|v| v.visible(rel))
    }

    /// Whether a view restricts the current caller.
    pub fn restricted(&self) -> bool {
        self.view.is_some()
    }

    /// Whether text names a path hidden from the current caller.
    pub fn mentions_hidden(&self, text: &str) -> bool {
        self.view.as_ref().is_some_and(|v| v.mentions_hidden(text))
    }

    /// Whether an event / log entry may be shown to the current caller: none of its
    /// strings (at any depth) names a hidden path.
    pub fn value_visible(&self, v: &Value) -> bool {
        let Some(view) = self.view.as_ref() else {
            return true;
        };
        fn walk(view: &dyn PathView, v: &Value) -> bool {
            match v {
                Value::String(s) => {
                    !view.mentions_hidden(s) && (s.chars().any(char::is_control) || view.visible(s))
                }
                Value::Array(a) => a.iter().all(|x| walk(view, x)),
                Value::Object(o) => o
                    .iter()
                    .all(|(k, x)| !view.mentions_hidden(k) && walk(view, x)),
                _ => true,
            }
        }
        walk(view.as_ref(), v)
    }

    /// Install the path-change hook (kept across vault switches by the server).
    pub fn set_path_hook(&mut self, hook: Option<PathHook>) {
        self.hook = hook;
    }

    /// The installed path-change hook.
    pub fn path_hook(&self) -> Option<PathHook> {
        self.hook.clone()
    }

    /// Tell the hook (if any) about a rename / move / delete.
    pub(crate) fn path_event(&self, ev: PathEvent) {
        if let Some(h) = &self.hook {
            h(&ev);
        }
    }

    /// For a restricted caller: whether everything inside the folder directory `dir`
    /// (files and sub folders, at any depth) is visible. Folder operations that would
    /// carry hidden items along are refused otherwise.
    pub(crate) fn subtree_visible(&self, dir: &std::path::Path) -> bool {
        if self.view.is_none() {
            return true;
        }
        if !self.visible(&self.rel_of(dir)) {
            return false;
        }
        walkdir::WalkDir::new(dir)
            .follow_links(false)
            .min_depth(1)
            .into_iter()
            .all(|e| match e {
                Ok(e) => self.visible(&self.rel_of(e.path())),
                Err(_) => false,
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Hides `Private/` and the note `Notes/secret.md`.
    struct TestView;
    impl PathView for TestView {
        fn visible(&self, rel: &str) -> bool {
            let l = rel.trim_start_matches(['/', '.']).to_lowercase();
            let l = l.replace("//", "/");
            !(l == "private"
                || l.starts_with("private/")
                || l.trim_end_matches(".md") == "notes/secret")
        }
        fn mentions_hidden(&self, text: &str) -> bool {
            let t = text.to_lowercase();
            t.contains("private/") || t.contains("notes/secret")
        }
    }

    fn vault(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("memora-priv-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        for f in ["Private", "Notes", "Public", "Mixed"] {
            std::fs::create_dir_all(d.join(f)).unwrap();
        }
        std::fs::write(d.join("Private/plan.md"), "# Plan\nsecret words [[hub]]\n").unwrap();
        std::fs::write(
            d.join("Notes/secret.md"),
            "# S\nsecret words #hidden [[hub]]\n",
        )
        .unwrap();
        std::fs::write(
            d.join("Notes/open.md"),
            "# O\nopen words [[secret]] [[plan]]\n",
        )
        .unwrap();
        std::fs::write(d.join("Public/hub.md"), "# Hub\nhub words\n").unwrap();
        std::fs::write(
            d.join("Public/secret.md"),
            "# Other secret\nsame name, other folder\n",
        )
        .unwrap();
        std::fs::write(d.join("Mixed/a.md"), "a").unwrap();
        d
    }

    fn view() -> Option<Arc<dyn PathView>> {
        Some(Arc::new(TestView))
    }

    #[test]
    fn a_view_filters_listings_and_reads() {
        let d = vault("read");
        let m = Mutex::new(MemoryStore::new(&d));
        m.lock().unwrap().reindex().unwrap();
        {
            let s = lock_as(&m, view());
            let paths: Vec<String> = s.walk().into_iter().map(|w| w.0).collect();
            assert!(!paths
                .iter()
                .any(|p| p.starts_with("Private") || p == "Notes/secret.md"));
            assert!(paths.contains(&"Public/secret.md".to_string()));
            assert_eq!(s.stats().notes, 4);
            let hits = s.search("words", 10);
            assert_eq!(hits.len(), 2, "{hits:?}");
            assert!(hits
                .iter()
                .all(|h| !h.path.starts_with("Private") && h.path != "Notes/secret.md"));
            assert!(s.search("hidden", 10).is_empty());
            assert!(!s
                .graph()
                .nodes
                .iter()
                .any(|n| n.path.starts_with("Private")));
            assert!(!s.tree().contains_key("Private"));
            // Reads of hidden paths look exactly like missing ones.
            for p in [
                "Private/plan.md",
                "private/plan.md",
                "Notes/secret.md",
                "./Notes//secret.md",
            ] {
                let e = s.read_note_impl(p).unwrap_err().to_string();
                assert_eq!(e, format!("not found: {p}"), "{p}");
            }
            let missing = s.read_note_impl("Nope/none.md").unwrap_err().to_string();
            assert_eq!(missing, "not found: Nope/none.md");
            // Backlinks and wikilinks: hidden notes do not show up.
            let hub = s.read_note_impl("Public/hub.md").unwrap();
            assert!(!hub.to_string().contains("Private/plan.md"));
            assert!(!hub.to_string().contains("Notes/secret.md"));
            let open = s.read_note_impl("Notes/open.md").unwrap();
            let html = open["html"].as_str().unwrap();
            assert!(!html.contains("Private/plan"), "{html}");
            assert!(!html.contains("Notes/secret"), "{html}");
            // Tags only from visible notes.
            assert!(!s.list_tags_impl().iter().any(|t| t["tag"] == "hidden"));
        }
        // The guard cleared the view: the owner sees everything again.
        let s = m.lock().unwrap();
        assert_eq!(s.stats().notes, 6);
        assert_eq!(s.search("words", 10).len(), 4);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_view_blocks_writes_into_and_onto_hidden_paths() {
        let d = vault("write");
        std::fs::write(d.join("Mixed/hidden-inside.md"), "x").unwrap();
        let m = Mutex::new(MemoryStore::new(&d));
        let s = lock_as(&m, view());
        assert!(s.create_impl("new", "Private", None).is_err());
        assert!(s.save_impl("Private/plan.md", "x").is_err());
        assert!(s.move_impl("Public/hub.md", "Private").is_err());
        assert!(s.rename_impl("Notes/open.md", "secret").is_err());
        assert!(s.delete_impl("Notes/secret.md").is_err());
        assert!(s.create_folder_impl("Private/Sub").is_err());
        assert!(s.rename_folder_impl("Public", "Private").is_err());
        assert!(s.move_folder_impl("Public", "Private").is_err());
        assert!(s.rename_folder_impl("Private", "Open").is_err());
        assert!(s.delete_folder_impl("Private").is_err());
        assert!(s
            .set_folder_meta_impl("Private", Some("#ff0000"), None, None)
            .is_err());
        // A visible folder that holds a hidden note cannot be moved or deleted.
        assert!(s.rename_folder_impl("Notes", "Renamed").is_err());
        assert!(s.delete_folder_impl("Notes").is_err());
        assert!(s.move_folder_contents_impl("Notes", "Public").is_err());
        assert!(s.soft_delete_impl("Notes/secret.md").is_err());
        assert!(s.get_note_at_impl("Notes/secret.md", "HEAD").is_err());
        assert!(s.vault_image_file("Private/x.png").is_err());
        // A hidden note is refused exactly like a missing one.
        let hidden = s
            .bulk_delete_impl(Some(&[json!("Notes/secret.md")]), None)
            .unwrap_err();
        let missing = s
            .bulk_delete_impl(Some(&[json!("Notes/nope.md")]), None)
            .unwrap_err();
        assert_eq!(
            hidden.0.replace("secret", "X"),
            missing.0.replace("nope", "X")
        );
        drop(s);
        assert!(d.join("Private/plan.md").is_file());
        assert!(d.join("Notes/secret.md").is_file());
        assert!(!d.join("Private/new.md").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn events_naming_hidden_paths_are_filtered() {
        let d = vault("events");
        let m = Mutex::new(MemoryStore::new(&d));
        let s = lock_as(&m, view());
        assert!(
            !s.value_visible(&json!({"type": "node_updated", "node": {"path": "Private/plan.md"}}))
        );
        assert!(!s.value_visible(&json!({"paths": ["Public/a.md", "notes/SECRET.md"]})));
        assert!(!s.value_visible(&json!({"label": "./Private//plan.md"})));
        assert!(
            s.value_visible(&json!({"type": "node_updated", "node": {"path": "Public/hub.md"}}))
        );
        drop(s);
        let s = m.lock().unwrap();
        assert!(s.value_visible(&json!({"path": "Private/plan.md"})));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_hook_hears_moves_and_deletes() {
        let d = vault("hook");
        let m = Mutex::new(MemoryStore::new(&d));
        let seen: Arc<Mutex<Vec<PathEvent>>> = Arc::default();
        let log = seen.clone();
        m.lock()
            .unwrap()
            .set_path_hook(Some(Arc::new(move |e: &PathEvent| {
                log.lock().unwrap().push(e.clone())
            })));
        let s = m.lock().unwrap();
        s.rename_impl("Public/hub.md", "center").unwrap();
        s.move_impl("Public/center.md", "Notes").unwrap();
        s.rename_folder_impl("Mixed", "Blend").unwrap();
        s.soft_delete_impl("Notes/open.md").unwrap();
        s.restore_trash_impl("open.md", "Public").unwrap();
        s.delete_impl("Public/open.md").unwrap();
        s.delete_folder_impl("Private").unwrap();
        drop(s);
        let ev = seen.lock().unwrap().clone();
        let mv = |f: &str, t: &str, c: bool| PathEvent::Moved {
            from: f.into(),
            to: t.into(),
            carry: c,
        };
        assert_eq!(ev[0], mv("Public/hub.md", "Public/center.md", false));
        assert_eq!(ev[1], mv("Public/center.md", "Notes/center.md", false));
        assert_eq!(ev[2], mv("Mixed", "Blend", false));
        assert_eq!(ev[3], mv("Notes/open.md", ".Trash/open.md", true));
        assert_eq!(ev[4], mv(".Trash/open.md", "Public/open.md", false));
        assert_eq!(
            ev[5],
            PathEvent::Deleted {
                path: "Public/open.md".into()
            }
        );
        assert_eq!(ev[6], mv("Private/plan.md", "plan.md", true));
        assert_eq!(
            ev[7],
            PathEvent::Deleted {
                path: "Private".into()
            }
        );
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_trash_list_skips_hidden_origins() {
        let d = vault("trashlist");
        let m = Mutex::new(MemoryStore::new(&d));
        {
            let s = m.lock().unwrap();
            s.soft_delete_impl("Private/plan.md").unwrap();
            s.soft_delete_impl("Public/hub.md").unwrap();
            assert_eq!(s.list_trash_impl().len(), 2);
        }
        let s = lock_as(&m, view());
        let names: Vec<Value> = s
            .list_trash_impl()
            .into_iter()
            .map(|e| e["name"].clone())
            .collect();
        assert_eq!(names, [json!("hub.md")]);
        drop(s);
        let _ = std::fs::remove_dir_all(&d);
    }
}
