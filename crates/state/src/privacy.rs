//! Per-agent privacy rules, tables `privacy_rule` and `privacy_rule_key` (migration 6).
//!
//! A rule hides one vault path from agents (API keys; every OAuth connection is a key):
//! * [`Kind::Folder`]: the folder itself and everything below it.
//! * [`Kind::Node`]: one note (path with its `.md`).
//!
//! and has a [`Mode`]:
//! * [`Mode::Deny`]: hidden from the listed keys (the usual case: "agent C cannot see").
//! * [`Mode::AllowOnly`]: hidden from every key that is not listed, including keys
//!   created later.
//!
//! Rules add up: a path is hidden from a key when ANY rule covering it hides it (its own
//! node rule, or a folder rule on the folder or any parent). The signed-in owner is never
//! filtered; this module only answers for keys.
//!
//! Paths are vault-relative, normalized by [`normalize_path`] (`\` -> `/`, empty and `.`
//! segments dropped, `..` and control characters refused) and matched
//! case-insensitively, always by full path, never by bare note name. A node rule matches
//! with or without the `.md` suffix (`Notes/x` and `Notes/x.md` are the same node).
//!
//! Rename / move / delete of notes and folders keep rules in step: [`rename_path`]
//! (node rules follow their node, folder renames rewrite every rule below), [`carry`]
//! (a note leaving a protected folder implicitly, e.g. into the trash, keeps the folder's
//! protection as node rules) and [`forget`] (hard delete).
//!
//! Enforcement lives with the callers: [`view_for`] compiles the rules that hide paths from
//! one key into a [`KeyView`] (fast `visible(path)` checks); any error building it must be
//! treated as [`KeyView::deny_all`] (fail closed).

use crate::{Error, Result};
use rusqlite::{params, Connection, Transaction};
use std::collections::{BTreeMap, BTreeSet};

/// Longest stored path (characters; schema CHECK).
pub const MAX_PATH: usize = 1024;
/// Most keys listed on one rule.
pub const MAX_KEYS: usize = 1000;

/// What a rule protects.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// A folder and everything inside it.
    Folder,
    /// One note.
    Node,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Folder => "folder",
            Kind::Node => "node",
        }
    }
}

impl std::str::FromStr for Kind {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "folder" => Ok(Kind::Folder),
            "node" | "note" => Ok(Kind::Node),
            _ => Err(Error::invalid("kind", "must be folder or node")),
        }
    }
}

/// How the listed keys are read.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Hidden from the listed keys.
    Deny,
    /// Hidden from every key that is not listed.
    AllowOnly,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Deny => "deny",
            Mode::AllowOnly => "allow_only",
        }
    }
}

impl std::str::FromStr for Mode {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "deny" => Ok(Mode::Deny),
            "allow_only" | "allow" | "only" => Ok(Mode::AllowOnly),
            _ => Err(Error::invalid("mode", "must be deny or allow_only")),
        }
    }
}

/// One rule with its key list.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Rule {
    pub id: i64,
    pub kind: Kind,
    /// Normalized vault-relative path (case as given).
    pub path: String,
    pub mode: Mode,
    /// Key ids: hidden from these (`deny`) or visible only to these (`allow_only`).
    pub keys: BTreeSet<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Former paths (before renames and moves), newest last. Only events and log lines
    /// naming them are kept from the hidden agents; files there now are not hidden.
    pub trail: Vec<String>,
}

/// Most former paths kept per rule.
pub const MAX_TRAIL: usize = 64;

impl Rule {
    /// Whether this rule applies to `path` (any case, any spelling [`canon`] accepts).
    /// An invalid path is covered by every rule (fail closed).
    pub fn covers(&self, path: &str) -> bool {
        match canon(path) {
            Some(q) => covers_lower(self.kind, &self.path.to_lowercase(), &q.to_lowercase()),
            None => true,
        }
    }

    /// Whether this rule hides its paths from `key_id`.
    pub fn hides_from(&self, key_id: &str) -> bool {
        match self.mode {
            Mode::Deny => self.keys.contains(key_id),
            Mode::AllowOnly => !self.keys.contains(key_id),
        }
    }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// Canonical spelling of a vault-relative path: `\` -> `/`, empty and `.` segments
/// dropped. `Some("")` is the vault root; `None` for `..` or control characters.
pub fn canon(raw: &str) -> Option<String> {
    if raw.chars().any(char::is_control) {
        return None;
    }
    let s = raw.replace('\\', "/");
    let mut segs: Vec<&str> = Vec::new();
    for seg in s.split('/') {
        match seg {
            "" | "." => {}
            ".." => return None,
            other => segs.push(other),
        }
    }
    Some(segs.join("/"))
}

/// A path as stored on a rule: [`canon`], not the root, at most [`MAX_PATH`] chars.
pub fn normalize_path(raw: &str) -> Result<String> {
    let Some(p) = canon(raw) else {
        return Err(Error::invalid("path", "must stay inside the vault"));
    };
    if p.is_empty() {
        return Err(Error::invalid("path", "the vault root cannot be private"));
    }
    if p.chars().count() > MAX_PATH {
        return Err(Error::invalid(
            "path",
            format!("at most {MAX_PATH} characters"),
        ));
    }
    Ok(p)
}

fn strip_md(p: &str) -> &str {
    p.strip_suffix(".md").unwrap_or(p)
}

/// Rule matching on lower-cased canonical paths.
fn covers_lower(kind: Kind, rule: &str, q: &str) -> bool {
    match kind {
        Kind::Folder => {
            q == rule
                || (q.len() > rule.len() && q.starts_with(rule) && q[rule.len()..].starts_with('/'))
        }
        Kind::Node => strip_md(q) == strip_md(rule),
    }
}

/// `path` with its first `prefix_segs` segments replaced by `new_prefix`.
fn reprefix(path: &str, prefix_segs: usize, new_prefix: &str) -> String {
    let rest: Vec<&str> = path.split('/').skip(prefix_segs).collect();
    if rest.is_empty() {
        new_prefix.to_string()
    } else {
        format!("{new_prefix}/{}", rest.join("/"))
    }
}

// ---------------------------------------------------------------------------
// Per-key view (enforcement)
// ---------------------------------------------------------------------------

/// The rules hiding paths from one key, compiled for fast checks.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KeyView {
    /// `(kind, lower-cased canonical path)` of every rule that hides from the key.
    hidden: Vec<(Kind, String)>,
    /// Lower-cased former paths of those rules (text matching only).
    trail: Vec<(Kind, String)>,
    /// Hide everything (the rules could not be read: fail closed).
    deny_all: bool,
}

impl KeyView {
    /// A view that hides every path (used when the rules cannot be read).
    pub fn deny_all() -> Self {
        KeyView {
            hidden: Vec::new(),
            trail: Vec::new(),
            deny_all: true,
        }
    }

    /// The view of `key_id` under `rules`.
    pub fn from_rules(rules: &[Rule], key_id: &str) -> Self {
        let mut hidden: Vec<(Kind, String)> = rules
            .iter()
            .filter(|r| r.hides_from(key_id))
            .map(|r| (r.kind, r.path.to_lowercase()))
            .collect();
        hidden.sort();
        hidden.dedup();
        let mut trail: Vec<(Kind, String)> = rules
            .iter()
            .filter(|r| r.hides_from(key_id))
            .flat_map(|r| r.trail.iter().map(move |p| (r.kind, p.to_lowercase())))
            .collect();
        trail.sort();
        trail.dedup();
        KeyView {
            hidden,
            trail,
            deny_all: false,
        }
    }

    /// True when nothing is hidden from this key (no filtering needed).
    pub fn is_unrestricted(&self) -> bool {
        !self.deny_all && self.hidden.is_empty()
    }

    /// Whether this key may see `path` (a note, folder or file; vault-relative, any
    /// spelling). The vault root is visible unless everything is hidden; an invalid path
    /// (`..`, control characters) is not.
    pub fn visible(&self, path: &str) -> bool {
        if self.deny_all {
            return false;
        }
        if self.hidden.is_empty() {
            return true;
        }
        let Some(q) = canon(path) else {
            return false;
        };
        if q.is_empty() {
            return true;
        }
        let q = q.to_lowercase();
        !self.hidden.iter().any(|(k, p)| covers_lower(*k, p, &q))
    }

    /// Whether free text (an event label, a log line, a commit message) names a hidden
    /// path: a hidden folder path or note path (without `.md`) at word boundaries,
    /// case-insensitive.
    pub fn mentions_hidden(&self, text: &str) -> bool {
        if self.deny_all {
            return true;
        }
        if self.hidden.is_empty() || text.is_empty() {
            return false;
        }
        let hay = text.to_lowercase().replace('\\', "/");
        self.hidden.iter().chain(self.trail.iter()).any(|(k, p)| {
            let needle = match k {
                Kind::Folder => p.as_str(),
                Kind::Node => strip_md(p),
            };
            contains_at_boundary(&hay, needle)
        })
    }
}

/// Word characters for [`contains_at_boundary`].
fn wordish(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

/// `needle` occurs in `hay` with no word character right before or after it.
fn contains_at_boundary(hay: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let mut from = 0;
    while let Some(i) = hay[from..].find(needle) {
        let at = from + i;
        let end = at + needle.len();
        let before = hay[..at].chars().next_back();
        let after = hay[end..].chars().next();
        if !before.is_some_and(wordish) && !after.is_some_and(wordish) {
            return true;
        }
        from = at + needle.chars().next().map_or(1, char::len_utf8);
        if from >= hay.len() {
            break;
        }
    }
    false
}

/// The view of `key_id`. Callers turn an `Err` into [`KeyView::deny_all`].
pub fn view_for(conn: &Connection, key_id: &str) -> Result<KeyView> {
    Ok(KeyView::from_rules(&list(conn)?, key_id))
}

/// Whether `key_id` may see `path` (the one-shot form of [`view_for`]); fails closed.
pub fn visible(conn: &Connection, key_id: &str, path: &str) -> bool {
    view_for(conn, key_id)
        .unwrap_or_else(|_| KeyView::deny_all())
        .visible(path)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// Every rule, ordered by path, kind and id.
pub fn list(conn: &Connection) -> Result<Vec<Rule>> {
    let mut keys: BTreeMap<i64, BTreeSet<String>> = BTreeMap::new();
    {
        let mut st = conn.prepare_cached("SELECT rule_id, key_id FROM privacy_rule_key")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (id, key) = row?;
            keys.entry(id).or_default().insert(key);
        }
    }
    let mut trails: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    {
        let mut st =
            conn.prepare_cached("SELECT rule_id, path FROM privacy_trail ORDER BY rowid")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (id, p) = row?;
            trails.entry(id).or_default().push(p);
        }
    }
    let mut st = conn.prepare_cached(
        "SELECT id, kind, path, mode, created_at, updated_at FROM privacy_rule
         ORDER BY path COLLATE NOCASE, kind, id",
    )?;
    let rows = st.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, i64>(5)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, kind, path, mode, created_at, updated_at) = row?;
        out.push(Rule {
            id,
            kind: kind.parse()?,
            path,
            mode: mode.parse()?,
            keys: keys.remove(&id).unwrap_or_default(),
            created_at,
            updated_at,
            trail: trails.remove(&id).unwrap_or_default(),
        });
    }
    Ok(out)
}

/// The rules set on exactly this path and kind (usually zero or one; several after a
/// rename onto a protected path, which add up).
pub fn get(conn: &Connection, kind: Kind, path: &str) -> Result<Vec<Rule>> {
    let p = normalize_path(path)?.to_lowercase();
    Ok(list(conn)?
        .into_iter()
        .filter(|r| r.kind == kind && same_path(kind, &r.path.to_lowercase(), &p))
        .collect())
}

fn same_path(kind: Kind, a: &str, b: &str) -> bool {
    match kind {
        Kind::Folder => a == b,
        Kind::Node => strip_md(a) == strip_md(b),
    }
}

/// Whether a rule on `rule` (lower-cased) names the item a vault event reports at `event`
/// (lower-cased, as the store gives it: notes with `.md`, folders without). A node rule
/// written without `.md` still follows its note, but never a folder that shares the name.
fn names_event_path(kind: Kind, rule: &str, event: &str) -> bool {
    match kind {
        Kind::Node if !event.ends_with(".md") => rule == event,
        _ => same_path(kind, rule, event),
    }
}

/// Every rule that applies to `path`: its own rules and those of its parent folders.
pub fn covering(conn: &Connection, path: &str) -> Result<Vec<Rule>> {
    let p = normalize_path(path)?;
    Ok(list(conn)?.into_iter().filter(|r| r.covers(&p)).collect())
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

fn map_constraint(e: rusqlite::Error) -> Error {
    let e = Error::from(e);
    if e.is_constraint() {
        Error::invalid("keys", "unknown key id")
    } else {
        e
    }
}

/// Replace the rules on `(kind, path)` with one rule. A `deny` rule with no keys
/// restricts nothing: the path's rules are removed and `None` returned.
pub fn set(
    tx: &Transaction<'_>,
    kind: Kind,
    path: &str,
    mode: Mode,
    keys: &BTreeSet<String>,
    now: i64,
) -> Result<Option<Rule>> {
    let path = normalize_path(path)?;
    if keys.len() > MAX_KEYS {
        return Err(Error::invalid("keys", format!("at most {MAX_KEYS} keys")));
    }
    // An edited rule keeps the former paths of the rule(s) it replaces.
    let mut trail: Vec<String> = get(tx, kind, &path)?
        .into_iter()
        .flat_map(|r| r.trail)
        .collect();
    trail.dedup();
    delete(tx, kind, &path)?;
    if mode == Mode::Deny && keys.is_empty() {
        return Ok(None);
    }
    tx.execute(
        "INSERT INTO privacy_rule (kind, path, mode, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![kind.as_str(), path, mode.as_str(), now],
    )?;
    let id = tx.last_insert_rowid();
    {
        let mut st =
            tx.prepare_cached("INSERT INTO privacy_rule_key (rule_id, key_id) VALUES (?1, ?2)")?;
        for k in keys {
            st.execute(params![id, k]).map_err(map_constraint)?;
        }
    }
    for p in &trail {
        add_trail(tx, id, p)?;
    }
    Ok(Some(Rule {
        id,
        kind,
        path,
        mode,
        keys: keys.clone(),
        created_at: now,
        updated_at: now,
        trail,
    }))
}

/// Remember a former path of rule `id` (keeps the newest [`MAX_TRAIL`]).
fn add_trail(tx: &Transaction<'_>, id: i64, path: &str) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO privacy_trail (rule_id, path) VALUES (?1, ?2)",
        params![id, path],
    )?;
    tx.execute(
        "DELETE FROM privacy_trail WHERE rule_id = ?1 AND rowid NOT IN
           (SELECT rowid FROM privacy_trail WHERE rule_id = ?1 ORDER BY rowid DESC LIMIT ?2)",
        params![id, MAX_TRAIL as i64],
    )?;
    Ok(())
}

/// Remove the rules on `(kind, path)`; returns how many were removed.
pub fn delete(tx: &Transaction<'_>, kind: Kind, path: &str) -> Result<usize> {
    let ids: Vec<i64> = get(tx, kind, path)?.iter().map(|r| r.id).collect();
    let mut st = tx.prepare_cached("DELETE FROM privacy_rule WHERE id = ?1")?;
    for id in &ids {
        st.execute([id])?;
    }
    Ok(ids.len())
}

/// `old` was renamed or moved to `new` (a note, or a folder with everything in it):
/// rules on `old` and below it follow. Returns how many rules changed. Paths that are
/// not valid vault paths change nothing.
pub fn rename_path(tx: &Transaction<'_>, old: &str, new: &str, now: i64) -> Result<usize> {
    let (Some(o), Ok(n)) = (canon(old), normalize_path(new)) else {
        return Ok(0);
    };
    if o.is_empty() {
        return Ok(0);
    }
    let ol = o.to_lowercase();
    let o_segs = o.split('/').count();
    let mut st =
        tx.prepare_cached("UPDATE privacy_rule SET path = ?1, updated_at = ?2 WHERE id = ?3")?;
    let mut changed = 0;
    for r in list(tx)? {
        let rl = r.path.to_lowercase();
        let to = if names_event_path(r.kind, &rl, &ol) {
            match r.kind {
                Kind::Folder => n.clone(),
                // Keep the node's suffix style: a rule written without `.md` stays so.
                Kind::Node if !rl.ends_with(".md") => strip_md(&n).to_string(),
                Kind::Node => n.clone(),
            }
        } else if covers_lower(Kind::Folder, &ol, &rl) {
            reprefix(&r.path, o_segs, &n)
        } else {
            continue;
        };
        if to != r.path {
            st.execute(params![to, now, r.id])?;
            add_trail(tx, r.id, &r.path)?;
            changed += 1;
        }
    }
    Ok(changed)
}

/// A note moves from `from` to `to` without the user choosing to take it out of its
/// folder (into the trash, or out of a deleted folder): every folder rule that covers
/// `from` but not `to` is copied onto `to` as a node rule, so the note stays hidden from
/// the same agents. Call before [`rename_path`]. Returns how many rules were added.
pub fn carry(tx: &Transaction<'_>, from: &str, to: &str, now: i64) -> Result<usize> {
    let (Ok(f), Ok(t)) = (normalize_path(from), normalize_path(to)) else {
        return Ok(0);
    };
    let mut added = 0;
    for r in list(tx)? {
        if r.kind != Kind::Folder || !r.covers(&f) || r.covers(&t) {
            continue;
        }
        tx.execute(
            "INSERT INTO privacy_rule (kind, path, mode, created_at, updated_at)
             VALUES ('node', ?1, ?2, ?3, ?3)",
            params![t, r.mode.as_str(), now],
        )?;
        let id = tx.last_insert_rowid();
        for k in &r.keys {
            tx.execute(
                "INSERT OR IGNORE INTO privacy_rule_key (rule_id, key_id) VALUES (?1, ?2)",
                params![id, k],
            )?;
        }
        add_trail(tx, id, &f)?;
        added += 1;
    }
    Ok(added)
}

/// `path` (a note, or a folder with everything in it) was deleted for good: drop its
/// rules and every rule below it. Returns how many were removed.
pub fn forget(tx: &Transaction<'_>, path: &str) -> Result<usize> {
    let Some(p) = canon(path) else {
        return Ok(0);
    };
    if p.is_empty() {
        return Ok(0);
    }
    let pl = p.to_lowercase();
    let mut st = tx.prepare_cached("DELETE FROM privacy_rule WHERE id = ?1")?;
    let mut n = 0;
    for r in list(tx)? {
        let rl = r.path.to_lowercase();
        if names_event_path(r.kind, &rl, &pl) || covers_lower(Kind::Folder, &pl, &rl) {
            st.execute([r.id])?;
            n += 1;
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::{NewApiKey, Scope, ToolGrant};
    use crate::Db;

    fn db_with_keys(ids: &[&str]) -> Db {
        let db = Db::open_temp().unwrap();
        db.write(|tx| {
            for (i, id) in ids.iter().enumerate() {
                crate::keys::create(
                    tx,
                    &NewApiKey {
                        id: id.to_string(),
                        name: format!("agent {id}"),
                        hash: format!("{:064x}", i + 1),
                        prefix: format!("mem_{i}"),
                        scopes: Scope::default_set(),
                        tools: ToolGrant::All,
                    },
                    1,
                )?;
            }
            Ok(())
        })
        .unwrap();
        db
    }

    fn keys(ids: &[&str]) -> BTreeSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    fn vis(db: &Db, key: &str, path: &str) -> bool {
        db.read(|c| Ok(visible(c, key, path))).unwrap()
    }

    #[test]
    fn canon_and_normalize() {
        assert_eq!(canon("a//b/./c.md").as_deref(), Some("a/b/c.md"));
        assert_eq!(canon("/a\\b").as_deref(), Some("a/b"));
        assert_eq!(canon("./").as_deref(), Some(""));
        assert_eq!(canon("a/../b"), None);
        assert_eq!(canon("a\nb"), None);
        assert!(normalize_path("").is_err());
        assert!(normalize_path("/").is_err());
        assert!(normalize_path("../x").is_err());
        assert_eq!(normalize_path("Work/").unwrap(), "Work");
    }

    #[test]
    fn deny_hides_from_listed_keys_only() {
        let db = db_with_keys(&["k_a", "k_b", "k_c"]);
        db.write(|tx| {
            set(tx, Kind::Folder, "Private", Mode::Deny, &keys(&["k_c"]), 1)?;
            set(
                tx,
                Kind::Node,
                "Notes/secret.md",
                Mode::Deny,
                &keys(&["k_b"]),
                1,
            )?;
            Ok(())
        })
        .unwrap();
        assert!(vis(&db, "k_a", "Private/x.md"));
        assert!(vis(&db, "k_b", "Private/x.md"));
        assert!(!vis(&db, "k_c", "Private/x.md"));
        assert!(!vis(&db, "k_c", "Private"));
        assert!(!vis(&db, "k_c", "Private/Sub/deep.md"));
        // Spelling and case variants of the same path.
        for p in [
            "private/X.md",
            "./Private//x.md",
            "PRIVATE",
            "Private/",
            "\\Private\\x.md",
        ] {
            assert!(!vis(&db, "k_c", p), "{p}");
        }
        // A sibling with a common prefix is not inside the folder.
        assert!(vis(&db, "k_c", "Private2/x.md"));
        assert!(vis(&db, "k_c", "PrivateNotes.md"));
        // Node rule: by full path, not by bare name.
        assert!(!vis(&db, "k_b", "Notes/secret.md"));
        assert!(!vis(&db, "k_b", "notes/Secret"));
        assert!(
            vis(&db, "k_b", "Other/secret.md"),
            "same name, other folder"
        );
        assert!(vis(&db, "k_b", "secret.md"));
        assert!(vis(&db, "k_a", "Notes/secret.md"));
        // Traversal is never visible; the root is.
        let v = db.read(|c| view_for(c, "k_c")).unwrap();
        assert!(!v.visible("a/../b"));
        assert!(v.visible(""));
    }

    #[test]
    fn allow_only_and_rules_add_up() {
        let db = db_with_keys(&["k_a", "k_b", "k_c"]);
        db.write(|tx| {
            set(
                tx,
                Kind::Folder,
                "Team",
                Mode::AllowOnly,
                &keys(&["k_a", "k_b"]),
                1,
            )?;
            set(
                tx,
                Kind::Node,
                "Team/plan.md",
                Mode::Deny,
                &keys(&["k_b"]),
                1,
            )?;
            Ok(())
        })
        .unwrap();
        assert!(vis(&db, "k_a", "Team/plan.md"));
        assert!(
            !vis(&db, "k_b", "Team/plan.md"),
            "node rule adds to the folder rule"
        );
        assert!(vis(&db, "k_b", "Team/other.md"));
        assert!(!vis(&db, "k_c", "Team/other.md"));
        // A key created later is outside an allow list.
        assert!(!vis(&db, "k_new", "Team"));
        // allow_only with no keys hides from every agent.
        db.write(|tx| {
            set(
                tx,
                Kind::Folder,
                "Vault",
                Mode::AllowOnly,
                &BTreeSet::new(),
                1,
            )
        })
        .unwrap();
        assert!(!vis(&db, "k_a", "Vault/x.md"));
        // deny with no keys is no rule at all.
        let r = db
            .write(|tx| set(tx, Kind::Folder, "Team", Mode::Deny, &BTreeSet::new(), 2))
            .unwrap();
        assert!(r.is_none());
        assert!(vis(&db, "k_c", "Team/other.md"));
    }

    #[test]
    fn set_replaces_and_validates() {
        let db = db_with_keys(&["k_a", "k_b"]);
        db.write(|tx| set(tx, Kind::Node, "a/x.md", Mode::Deny, &keys(&["k_a"]), 1))
            .unwrap();
        db.write(|tx| set(tx, Kind::Node, "A/X.md", Mode::Deny, &keys(&["k_b"]), 2))
            .unwrap();
        let all = db.read(list).unwrap();
        assert_eq!(all.len(), 1, "{all:?}");
        assert_eq!(all[0].keys, keys(&["k_b"]));
        assert_eq!(db.read(|c| get(c, Kind::Node, "a/x")).unwrap().len(), 1);
        // Unknown key ids and bad paths are refused; nothing half-written stays.
        let e = db
            .write(|tx| set(tx, Kind::Node, "b.md", Mode::Deny, &keys(&["k_zz"]), 3))
            .unwrap_err();
        assert!(matches!(e, Error::Invalid { field: "keys", .. }), "{e}");
        assert!(db
            .write(|tx| set(tx, Kind::Folder, "../etc", Mode::Deny, &keys(&["k_a"]), 3))
            .is_err());
        assert_eq!(db.read(list).unwrap().len(), 1);
        assert_eq!(db.write(|tx| delete(tx, Kind::Node, "a/x.md")).unwrap(), 1);
        assert!(db.read(list).unwrap().is_empty());
    }

    #[test]
    fn rules_follow_renames_and_moves() {
        let db = db_with_keys(&["k_a"]);
        let k = keys(&["k_a"]);
        db.write(|tx| {
            set(tx, Kind::Node, "Notes/secret.md", Mode::Deny, &k, 1)?;
            set(tx, Kind::Folder, "Work/Hidden", Mode::Deny, &k, 1)?;
            set(tx, Kind::Node, "Work/plan.md", Mode::Deny, &k, 1)?;
            set(tx, Kind::Node, "Work2/plan.md", Mode::Deny, &k, 1)?;
            Ok(())
        })
        .unwrap();
        // Note rename / move.
        db.write(|tx| rename_path(tx, "Notes/secret.md", "Notes/renamed.md", 2))
            .unwrap();
        assert!(vis(&db, "k_a", "Notes/secret.md"));
        assert!(!vis(&db, "k_a", "Notes/renamed.md"));
        db.write(|tx| rename_path(tx, "notes/renamed.md", "Archive/renamed.md", 3))
            .unwrap();
        assert!(!vis(&db, "k_a", "Archive/renamed.md"));
        // Folder rename rewrites rules inside it, but not in a look-alike sibling.
        let n = db
            .write(|tx| rename_path(tx, "Work", "Projects/Work", 4))
            .unwrap();
        assert_eq!(n, 2);
        assert!(!vis(&db, "k_a", "Projects/Work/Hidden/x.md"));
        assert!(!vis(&db, "k_a", "Projects/Work/plan.md"));
        assert!(vis(&db, "k_a", "Work/plan.md"));
        assert!(!vis(&db, "k_a", "Work2/plan.md"));
        // Invalid paths change nothing.
        assert_eq!(db.write(|tx| rename_path(tx, "../x", "y", 5)).unwrap(), 0);
        assert_eq!(db.write(|tx| rename_path(tx, "", "y", 5)).unwrap(), 0);
    }

    #[test]
    fn former_paths_stay_out_of_text_but_not_files() {
        let db = db_with_keys(&["k_b"]);
        db.write(|tx| {
            set(
                tx,
                Kind::Node,
                "Notes/secret.md",
                Mode::Deny,
                &keys(&["k_b"]),
                1,
            )
        })
        .unwrap();
        db.write(|tx| rename_path(tx, "Notes/secret.md", "Archive/renamed.md", 2))
            .unwrap();
        let v = db.read(|c| view_for(c, "k_b")).unwrap();
        assert!(v.mentions_hidden("read: Notes/secret.md"));
        assert!(
            v.visible("Notes/secret.md"),
            "a new note at the old path is not hidden"
        );
        assert!(!v.visible("Archive/renamed.md"));
        // Editing the rule keeps the trail.
        db.write(|tx| {
            set(
                tx,
                Kind::Node,
                "Archive/renamed.md",
                Mode::AllowOnly,
                &BTreeSet::new(),
                3,
            )
        })
        .unwrap();
        let r = db.read(list).unwrap();
        assert_eq!(r[0].trail, vec!["Notes/secret.md".to_string()]);
        // Bounded.
        db.write(|tx| {
            for i in 0..(MAX_TRAIL + 5) {
                let from = if i == 0 {
                    "Archive/renamed.md".to_string()
                } else {
                    format!("T/{}.md", i - 1)
                };
                rename_path(tx, &from, &format!("T/{i}.md"), 4)?;
            }
            Ok(())
        })
        .unwrap();
        assert_eq!(db.read(list).unwrap()[0].trail.len(), MAX_TRAIL);
    }

    #[test]
    fn carry_and_forget() {
        let db = db_with_keys(&["k_a", "k_b"]);
        db.write(|tx| {
            set(tx, Kind::Folder, "Private", Mode::Deny, &keys(&["k_a"]), 1)?;
            set(
                tx,
                Kind::Node,
                "Private/x.md",
                Mode::Deny,
                &keys(&["k_b"]),
                1,
            )?;
            Ok(())
        })
        .unwrap();
        // Into the trash: the folder's protection is carried as a node rule.
        db.write(|tx| {
            carry(tx, "Private/x.md", ".Trash/x.md", 2)?;
            rename_path(tx, "Private/x.md", ".Trash/x.md", 2)
        })
        .unwrap();
        assert!(!vis(&db, "k_a", ".Trash/x.md"));
        assert!(!vis(&db, "k_b", ".Trash/x.md"));
        // A plain move out of the folder does not carry anything.
        db.write(|tx| {
            set(
                tx,
                Kind::Node,
                "Private/y.md",
                Mode::Deny,
                &keys(&["k_b"]),
                3,
            )
        })
        .unwrap();
        db.write(|tx| rename_path(tx, "Private/y.md", "Public/y.md", 3))
            .unwrap();
        assert!(vis(&db, "k_a", "Public/y.md"));
        assert!(!vis(&db, "k_b", "Public/y.md"));
        // Forget a folder: its rule and every rule below it go.
        db.write(|tx| {
            set(
                tx,
                Kind::Node,
                "Private/z.md",
                Mode::Deny,
                &keys(&["k_b"]),
                4,
            )
        })
        .unwrap();
        assert_eq!(db.write(|tx| forget(tx, "private")).unwrap(), 2);
        assert!(vis(&db, "k_a", "Private/q.md"));
        assert_eq!(db.write(|tx| forget(tx, "Public/y.md")).unwrap(), 1);
    }

    #[test]
    fn folder_events_leave_a_same_named_note_alone() {
        // `Plan.md` and the folder `Plan` live side by side.
        let db = db_with_keys(&["k_a"]);
        let k = keys(&["k_a"]);
        db.write(|tx| set(tx, Kind::Node, "Work/Plan.md", Mode::Deny, &k, 1))
            .unwrap();
        assert_eq!(
            db.write(|tx| rename_path(tx, "Work/Plan", "Archive/Plan", 2))
                .unwrap(),
            0
        );
        assert!(!vis(&db, "k_a", "Work/Plan.md"));
        assert_eq!(db.write(|tx| forget(tx, "Work/Plan")).unwrap(), 0);
        assert!(!vis(&db, "k_a", "Work/Plan.md"));
        // The note itself still carries its rule along.
        assert_eq!(
            db.write(|tx| rename_path(tx, "Work/Plan.md", "Archive/Plan.md", 3))
                .unwrap(),
            1
        );
        assert!(!vis(&db, "k_a", "Archive/Plan.md"));
    }

    #[test]
    fn deleting_a_key_drops_it_from_rules() {
        let db = db_with_keys(&["k_a", "k_b"]);
        db.write(|tx| {
            set(
                tx,
                Kind::Folder,
                "P",
                Mode::AllowOnly,
                &keys(&["k_a", "k_b"]),
                1,
            )
        })
        .unwrap();
        db.write(|tx| crate::keys::purge(tx, "k_b").map(|_| ()))
            .unwrap();
        let r = db.read(list).unwrap();
        assert_eq!(r[0].keys, keys(&["k_a"]));
    }

    #[test]
    fn views_and_text_mentions() {
        let db = db_with_keys(&["k_a"]);
        db.write(|tx| {
            set(tx, Kind::Folder, "Work", Mode::Deny, &keys(&["k_a"]), 1)?;
            set(
                tx,
                Kind::Node,
                "Notes/Secret Plan.md",
                Mode::Deny,
                &keys(&["k_a"]),
                1,
            )
        })
        .unwrap();
        let v = db.read(|c| view_for(c, "k_a")).unwrap();
        assert!(!v.is_unrestricted());
        assert!(v.mentions_hidden("move: Work/a.md -> Done/a.md"));
        assert!(v.mentions_hidden("edit: notes/secret plan.md"));
        assert!(v.mentions_hidden("WORK"));
        assert!(!v.mentions_hidden("homework/x.md"));
        assert!(!v.mentions_hidden("my-work/x.md"));
        assert!(!v.mentions_hidden("Notes/Secret Planning.md"));
        let other = db.read(|c| view_for(c, "k_other")).unwrap();
        assert!(other.is_unrestricted());
        assert!(other.visible("Work/a.md"));
        let closed = KeyView::deny_all();
        assert!(!closed.visible("") && !closed.visible("a.md"));
        assert!(closed.mentions_hidden("anything"));
    }

    #[test]
    fn migration_is_idempotent() {
        let db = Db::open_temp().unwrap();
        db.write(|tx| {
            tx.execute_batch(crate::migrate::MIGRATIONS[5])?;
            Ok(())
        })
        .unwrap();
    }
}
