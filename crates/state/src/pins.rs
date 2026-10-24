//! The owner's pinned notes and folders (`pin`): an ordered list shared by every browser.
//! Paths are vault-relative (notes with `.md`); [`rename_path`] and [`forget`] keep pins
//! on their items when the store renames, moves or deletes them.

use crate::{Error, Result};
use rusqlite::{params, Connection, Transaction};

/// Most pins kept.
pub const MAX_PINS: usize = 200;
/// Longest pinned path (characters; schema CHECK).
pub const MAX_PATH: usize = 1024;

/// What a pin points at.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Note,
    Folder,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Note => "note",
            Kind::Folder => "folder",
        }
    }
}

impl std::str::FromStr for Kind {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "note" | "node" => Ok(Kind::Note),
            "folder" => Ok(Kind::Folder),
            _ => Err(Error::invalid("kind", "must be note or folder")),
        }
    }
}

/// One pin, in display order.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Pin {
    pub kind: Kind,
    pub path: String,
    /// 0-based display position.
    pub position: usize,
    pub created_at: i64,
}

/// `path` if it is a valid vault path for a pin of `kind`: relative, no empty, `.`, `..`
/// or hidden segment, no control character or `\`, at most [`MAX_PATH`] chars; notes end in `.md`.
pub fn check_path(kind: Kind, path: &str) -> Result<()> {
    let bad = |reason: &str| Err(Error::invalid("path", reason));
    if path.is_empty() {
        return bad("is required");
    }
    if path.chars().count() > MAX_PATH {
        return bad(&format!("at most {MAX_PATH} characters"));
    }
    if path.chars().any(char::is_control) || path.contains('\\') {
        return bad("must not contain control characters or '\\'");
    }
    if path.starts_with('/') {
        return bad("must be relative to the vault");
    }
    for seg in path.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return bad("must stay inside the vault (no empty, '.' or '..' segments)");
        }
        if seg.starts_with('.') {
            return bad("hidden files and folders cannot be pinned");
        }
    }
    if kind == Kind::Note && !path.ends_with(".md") {
        return bad("a note path ends in .md");
    }
    Ok(())
}

/// Every pin, in display order.
pub fn list(conn: &Connection) -> Result<Vec<Pin>> {
    let mut st = conn.prepare_cached(
        "SELECT kind, path, position, created_at FROM pin ORDER BY position, created_at, path",
    )?;
    let rows = st.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(3)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (kind, path, created_at) = row?;
        let kind = kind.parse()?;
        out.push(Pin {
            kind,
            path,
            position: out.len(),
            created_at,
        });
    }
    Ok(out)
}

/// Rewrite the table as `pins` (duplicates after the first dropped, positions made
/// dense). Callers validate first; the schema is the backstop.
fn store(tx: &Transaction<'_>, pins: Vec<Pin>) -> Result<Vec<Pin>> {
    let mut out: Vec<Pin> = Vec::with_capacity(pins.len());
    for p in pins {
        if out.iter().any(|o| o.kind == p.kind && o.path == p.path) {
            continue;
        }
        let position = out.len();
        out.push(Pin { position, ..p });
    }
    tx.execute("DELETE FROM pin", [])?;
    let mut st = tx.prepare_cached(
        "INSERT INTO pin (kind, path, position, created_at) VALUES (?1, ?2, ?3, ?4)",
    )?;
    for p in &out {
        st.execute(params![
            p.kind.as_str(),
            p.path,
            p.position as i64,
            p.created_at
        ])?;
    }
    Ok(out)
}

fn too_many() -> Error {
    Error::invalid("pins", format!("at most {MAX_PINS} pins"))
}

/// Replace every pin with `items`, in that order (reorder, remove, or a first upload).
/// Duplicates are dropped; pins already present keep their `created_at`.
pub fn replace(tx: &Transaction<'_>, items: &[(Kind, String)], now: i64) -> Result<Vec<Pin>> {
    if items.len() > MAX_PINS {
        return Err(too_many());
    }
    for (kind, path) in items {
        check_path(*kind, path)?;
    }
    let old = list(tx)?;
    let pins = items
        .iter()
        .map(|(kind, path)| Pin {
            kind: *kind,
            path: path.clone(),
            position: 0,
            created_at: old
                .iter()
                .find(|o| o.kind == *kind && &o.path == path)
                .map_or(now, |o| o.created_at),
        })
        .collect();
    store(tx, pins)
}

/// Pin `(kind, path)` at `position` (default: the end), or move it there when it is
/// already pinned. Returns the new list.
pub fn pin(
    tx: &Transaction<'_>,
    kind: Kind,
    path: &str,
    position: Option<usize>,
    now: i64,
) -> Result<Vec<Pin>> {
    check_path(kind, path)?;
    let mut pins = list(tx)?;
    let existing = pins
        .iter()
        .position(|p| p.kind == kind && p.path == path)
        .map(|i| pins.remove(i));
    if existing.is_none() && pins.len() >= MAX_PINS {
        return Err(too_many());
    }
    let at = position.unwrap_or(pins.len()).min(pins.len());
    let created_at = existing.map_or(now, |p| p.created_at);
    pins.insert(
        at,
        Pin {
            kind,
            path: path.to_string(),
            position: at,
            created_at,
        },
    );
    store(tx, pins)
}

/// Remove the pin on `(kind, path)`; returns whether there was one.
pub fn unpin(tx: &Transaction<'_>, kind: Kind, path: &str) -> Result<bool> {
    check_path(kind, path)?;
    let n = tx.execute(
        "DELETE FROM pin WHERE kind = ?1 AND path = ?2",
        params![kind.as_str(), path],
    )?;
    if n > 0 {
        let pins = list(tx)?;
        store(tx, pins)?;
    }
    Ok(n > 0)
}

/// Whether `path` is `base` or below it.
fn under(path: &str, base: &str) -> bool {
    path == base
        || (path.len() > base.len()
            && path.starts_with(base)
            && path[base.len()..].starts_with('/'))
}

/// `old` (a note, or a folder with everything in it) is now at `new`: pins follow, or are
/// dropped when `new` cannot be pinned (trash, hidden folder). Returns how many changed.
pub fn rename_path(tx: &Transaction<'_>, old: &str, new: &str) -> Result<usize> {
    if old.is_empty() || old == new {
        return Ok(0);
    }
    if check_path(Kind::Folder, new).is_err() {
        return forget(tx, old);
    }
    let mut pins = list(tx)?;
    let mut changed = 0;
    for p in pins.iter_mut() {
        if under(&p.path, old) {
            let to = format!("{new}{}", &p.path[old.len()..]);
            if check_path(p.kind, &to).is_ok() {
                p.path = to;
                changed += 1;
            }
        }
    }
    if changed > 0 {
        store(tx, pins)?;
    }
    Ok(changed)
}

/// `path` (a note, or a folder with everything in it) is gone: drop its pin and every
/// pin below it. Returns how many were removed.
pub fn forget(tx: &Transaction<'_>, path: &str) -> Result<usize> {
    if path.is_empty() {
        return Ok(0);
    }
    let pins = list(tx)?;
    let before = pins.len();
    let kept: Vec<Pin> = pins.into_iter().filter(|p| !under(&p.path, path)).collect();
    let removed = before - kept.len();
    if removed > 0 {
        store(tx, kept)?;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Db;

    fn paths(v: &[Pin]) -> Vec<String> {
        v.iter()
            .map(|p| format!("{}:{}", p.kind.as_str(), p.path))
            .collect()
    }

    #[test]
    fn path_validation() {
        for ok in ["a.md", "Work/Plan.md", "Ünï/cödé.md", "a b/c d.md"] {
            assert!(check_path(Kind::Note, ok).is_ok(), "{ok}");
        }
        for ok in ["Work", "Work/Plans", "x.md"] {
            assert!(check_path(Kind::Folder, ok).is_ok(), "{ok}");
        }
        let long = format!("{}.md", "a".repeat(MAX_PATH));
        for bad in [
            "",
            "/etc/passwd.md",
            "../x.md",
            "a/../b.md",
            "a//b.md",
            "./a.md",
            "a/.md",
            ".Trash/x.md",
            ".git/config.md",
            "a\0b.md",
            "a\nb.md",
            "a\\b.md",
            "a/",
            "plain",
            &long,
        ] {
            assert!(check_path(Kind::Note, bad).is_err(), "{bad:?}");
        }
        assert!(check_path(Kind::Folder, "a/").is_err());
        assert!(check_path(Kind::Folder, "..").is_err());
        assert!("bogus".parse::<Kind>().is_err());
        assert_eq!("node".parse::<Kind>().unwrap(), Kind::Note);
    }

    #[test]
    fn pin_unpin_reorder() {
        let db = Db::open_temp().unwrap();
        db.write(|tx| pin(tx, Kind::Note, "A/x.md", None, 1))
            .unwrap();
        db.write(|tx| pin(tx, Kind::Folder, "B", None, 2)).unwrap();
        let v = db
            .write(|tx| pin(tx, Kind::Note, "y.md", Some(0), 3))
            .unwrap();
        assert_eq!(paths(&v), ["note:y.md", "note:A/x.md", "folder:B"]);
        assert_eq!(v.iter().map(|p| p.position).collect::<Vec<_>>(), [0, 1, 2]);
        // Pinning again moves it and keeps created_at.
        let v = db
            .write(|tx| pin(tx, Kind::Note, "A/x.md", Some(9), 4))
            .unwrap();
        assert_eq!(paths(&v), ["note:y.md", "folder:B", "note:A/x.md"]);
        assert_eq!(v[2].created_at, 1);
        assert!(db.write(|tx| unpin(tx, Kind::Folder, "B")).unwrap());
        assert!(!db.write(|tx| unpin(tx, Kind::Folder, "B")).unwrap());
        let v = db.read(list).unwrap();
        assert_eq!(paths(&v), ["note:y.md", "note:A/x.md"]);
        assert_eq!(v[1].position, 1);
        // Replace: order, duplicates dropped, created_at kept.
        let v = db
            .write(|tx| {
                replace(
                    tx,
                    &[
                        (Kind::Note, "A/x.md".into()),
                        (Kind::Folder, "C".into()),
                        (Kind::Note, "A/x.md".into()),
                    ],
                    5,
                )
            })
            .unwrap();
        assert_eq!(paths(&v), ["note:A/x.md", "folder:C"]);
        assert_eq!((v[0].created_at, v[1].created_at), (1, 5));
        // Invalid input is refused before SQL, and nothing changes.
        assert!(db
            .write(|tx| pin(tx, Kind::Note, "../x.md", None, 6))
            .is_err());
        assert!(db
            .write(|tx| replace(tx, &[(Kind::Note, "/abs.md".into())], 6))
            .is_err());
        assert_eq!(db.read(list).unwrap().len(), 2);
    }

    #[test]
    fn pin_count_is_capped() {
        let db = Db::open_temp().unwrap();
        let many: Vec<(Kind, String)> = (0..MAX_PINS)
            .map(|i| (Kind::Note, format!("n{i}.md")))
            .collect();
        db.write(|tx| replace(tx, &many, 1)).unwrap();
        assert!(db
            .write(|tx| pin(tx, Kind::Note, "more.md", None, 2))
            .is_err());
        // Moving an existing pin is still fine.
        db.write(|tx| pin(tx, Kind::Note, "n5.md", Some(0), 2))
            .unwrap();
        let mut over = many.clone();
        over.push((Kind::Note, "more.md".into()));
        assert!(db.write(|tx| replace(tx, &over, 2)).is_err());
    }

    #[test]
    fn renames_and_deletes_follow() {
        let db = Db::open_temp().unwrap();
        db.write(|tx| {
            replace(
                tx,
                &[
                    (Kind::Note, "Work/Plan.md".into()),
                    (Kind::Folder, "Work".into()),
                    (Kind::Folder, "Work/Sub".into()),
                    (Kind::Note, "Work/Sub/deep.md".into()),
                    (Kind::Note, "Workshop.md".into()),
                ],
                1,
            )
        })
        .unwrap();
        // A note rename.
        assert_eq!(
            db.write(|tx| rename_path(tx, "Work/Plan.md", "Work/Roadmap.md"))
                .unwrap(),
            1
        );
        // A folder move carries every pin below it, notes included; Workshop.md is
        // not inside Work.
        assert_eq!(
            db.write(|tx| rename_path(tx, "Work", "Archive/Work"))
                .unwrap(),
            4
        );
        assert_eq!(
            paths(&db.read(list).unwrap()),
            [
                "note:Archive/Work/Roadmap.md",
                "folder:Archive/Work",
                "folder:Archive/Work/Sub",
                "note:Archive/Work/Sub/deep.md",
                "note:Workshop.md"
            ]
        );
        // Into the trash: the pin goes.
        assert_eq!(
            db.write(|tx| rename_path(tx, "Workshop.md", ".Trash/Workshop.md"))
                .unwrap(),
            1
        );
        // Deleting a folder drops every pin under it.
        assert_eq!(db.write(|tx| forget(tx, "Archive/Work/Sub")).unwrap(), 2);
        assert_eq!(
            paths(&db.read(list).unwrap()),
            ["note:Archive/Work/Roadmap.md", "folder:Archive/Work"]
        );
        // Unrelated or empty paths change nothing.
        assert_eq!(db.write(|tx| rename_path(tx, "Nope", "Else")).unwrap(), 0);
        assert_eq!(db.write(|tx| forget(tx, "")).unwrap(), 0);
        assert_eq!(db.write(|tx| rename_path(tx, "", "x")).unwrap(), 0);
    }

    #[test]
    fn schema_is_the_backstop() {
        let db = Db::open_temp().unwrap();
        let raw = |kind: &str, path: &str, pos: i64| {
            db.write(|tx| {
                Ok(tx.execute(
                    "INSERT INTO pin (kind, path, position, created_at) VALUES (?1, ?2, ?3, 1)",
                    params![kind, path, pos],
                )?)
            })
        };
        for (k, p, pos) in [
            ("file", "a.md", 0),
            ("note", "", 0),
            ("note", "/a.md", 0),
            ("folder", "a/", 0),
            ("note", "a.md", -1),
        ] {
            assert!(
                raw(k, p, pos).is_err_and(|e| e.is_constraint()),
                "{k} {p:?} {pos}"
            );
        }
        assert!(raw("note", "a.md", 0).is_ok());
        assert!(raw("note", "a.md", 1).is_err_and(|e| e.is_constraint()));
    }
}
