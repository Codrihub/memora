//! One-shot import of the legacy JSON state directory, and the rollback export.
//!
//! The import is strict for auth data (any violation aborts it) and lenient for logs,
//! sessions and access rules (skipped and counted). Imported files whose sha256 still
//! matches are then moved into `state/legacy-json-<unix time>/`, never deleted.

use crate::{Db, Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// `meta` key recording the import: `<unix time> <file>=<sha256 hex> ...`, or `'none'`.
pub const META_LEGACY_IMPORT: &str = "legacy_import";

/// Legacy files read by the importer and archived afterwards, relative to the state dir.
/// (`memora.env` may instead live at `MEMORA_ENV_FILE`.)
pub const LEGACY_FILES: &[&str] = &[
    "gateway.json",
    "config.json",
    "memora.env",
    "tools.json",
    "access_stack.json",
    "sessions.json",
    "signout.json",
    "arm.json",
    "lock.json",
    "arm-burned.json",
    "key-usage.json",
    "limiter.reset",
    "activity.jsonl",
    "activity.jsonl.1",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportStatus {
    /// `meta('legacy_import')` already present (any pending archive move was finished).
    AlreadyImported,
    /// No legacy files: recorded `'none'`.
    FreshInstall,
    /// Imported in this call.
    Imported,
}

/// Summary for the startup log line.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ImportReport {
    pub status: ImportStatus,
    /// Rows inserted per table.
    pub rows: BTreeMap<String, usize>,
    /// Unparsable log lines (activity) and expired sessions skipped.
    pub skipped: BTreeMap<String, usize>,
    /// Secrets found in `memora.env` and dropped (`MEMORA_ADMIN_PASSWORD`, `MEMORA_API_KEY`).
    pub dropped_secrets: Vec<String>,
    /// `state/legacy-json-<unix time>/` the files were moved to.
    pub archived_to: Option<PathBuf>,
}

impl ImportReport {
    fn new(status: ImportStatus) -> Self {
        ImportReport {
            status,
            rows: BTreeMap::new(),
            skipped: BTreeMap::new(),
            dropped_secrets: Vec::new(),
            archived_to: None,
        }
    }
    fn row(&mut self, table: &str, n: usize) {
        if n > 0 {
            *self.rows.entry(table.to_string()).or_default() += n;
        }
    }
    fn skip(&mut self, what: &str) {
        *self.skipped.entry(what.to_string()).or_default() += 1;
    }
}

/// Scopes a legacy key record without `scopes` had (`DEFAULT_KEY_SCOPES`).
const DEFAULT_SCOPES: &[&str] = &["mcp", "read", "write"];
/// Every scope, in display order.
const KNOWN_SCOPES: &[&str] = &["mcp", "read", "write", "admin"];
/// `prefix` for key records that never had one (keys trashed / restored through the API).
const UNKNOWN_PREFIX: &str = "(unknown)";

/// Where a legacy file lives: the state dir, except `memora.env` (`MEMORA_ENV_FILE`).
fn legacy_path(state_dir: &Path, name: &str) -> PathBuf {
    if name == "memora.env" {
        if let Some(p) = std::env::var_os("MEMORA_ENV_FILE").filter(|v| !v.is_empty()) {
            return PathBuf::from(p);
        }
    }
    state_dir.join(name)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn mtime(path: &Path) -> Option<i64> {
    let m = std::fs::metadata(path).ok()?.modified().ok()?;
    m.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

/// One legacy file read from disk.
struct Source {
    bytes: Vec<u8>,
    mtime: i64,
}

/// Read every present legacy file (with its sha256 for the meta marker).
fn read_sources(state_dir: &Path, now: i64) -> Result<BTreeMap<&'static str, Source>> {
    let mut out = BTreeMap::new();
    for &name in LEGACY_FILES {
        let path = legacy_path(state_dir, name);
        match std::fs::read(&path) {
            Ok(bytes) => {
                let mtime = mtime(&path).unwrap_or(now);
                out.insert(name, Source { bytes, mtime });
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(out)
}

/// Run the one-shot import (steps 1-7 of section 4). Strict failures return
/// `Error::Invalid` naming the file and field; nothing is half-imported.
pub fn import_legacy(db: &Db, state_dir: &Path) -> Result<ImportReport> {
    enum Outcome {
        Done(String),
        Fresh,
        Imported(ImportReport, String),
    }
    let outcome = db.write(|tx| {
        let marker: Option<String> = tx
            .query_row(
                "SELECT value FROM meta WHERE key = ?1",
                [META_LEGACY_IMPORT],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(m) = marker {
            return Ok(Outcome::Done(m));
        }
        let now = crate::now();
        let sources = read_sources(state_dir, now)?;
        if sources.is_empty() {
            tx.execute(
                "INSERT INTO meta (key, value) VALUES (?1, 'none')",
                [META_LEGACY_IMPORT],
            )?;
            return Ok(Outcome::Fresh);
        }
        let mut report = ImportReport::new(ImportStatus::Imported);
        import_all(tx, &sources, now, &mut report)?;
        let mut marker = now.to_string();
        for (name, src) in &sources {
            marker.push_str(&format!(" {name}={}", sha256_hex(&src.bytes)));
        }
        let mut counts = Map::new();
        counts.insert("rows".into(), json!(report.rows));
        counts.insert("skipped".into(), json!(report.skipped));
        counts.insert("dropped_secrets".into(), json!(report.dropped_secrets));
        tx.execute(
            "INSERT INTO activity (at, event, ip, actor, detail)
             VALUES (?1, 'state_imported', NULL, NULL, ?2)",
            params![now, Value::Object(counts).to_string()],
        )?;
        tx.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)",
            params![META_LEGACY_IMPORT, marker],
        )?;
        Ok(Outcome::Imported(report, marker))
    })?;

    match outcome {
        Outcome::Fresh => Ok(ImportReport::new(ImportStatus::FreshInstall)),
        Outcome::Done(marker) => {
            let mut report = ImportReport::new(ImportStatus::AlreadyImported);
            if marker != "none" {
                report.archived_to = archive(state_dir, &marker, &mut report)?;
            }
            Ok(report)
        }
        Outcome::Imported(mut report, marker) => {
            report.archived_to = archive(state_dir, &marker, &mut report)?;
            Ok(report)
        }
    }
}

/// Step 6: move the files recorded in `marker` into `legacy-json-<time>/` when they are
/// still the imported version. Idempotent (re-running after a crash completes the move).
fn archive(state_dir: &Path, marker: &str, report: &mut ImportReport) -> Result<Option<PathBuf>> {
    let mut parts = marker.split_whitespace();
    let Some(ts) = parts.next() else {
        return Ok(None);
    };
    let dir = state_dir.join(format!("legacy-json-{ts}"));
    let mut moved = false;
    for part in parts {
        let Some((name, hash)) = part.split_once('=') else {
            continue;
        };
        if !LEGACY_FILES.contains(&name) {
            continue;
        }
        let src = legacy_path(state_dir, name);
        if src.parent() != Some(state_dir) {
            // memora.env at MEMORA_ENV_FILE: imported, left where the operator put it.
            if src.exists() {
                report.skip("memora_env_external_not_archived");
            }
            continue;
        }
        let Ok(bytes) = std::fs::read(&src) else {
            continue; // already moved (or gone)
        };
        if sha256_hex(&bytes) != hash {
            report.skip("archive_changed_since_import");
            continue;
        }
        if !dir.is_dir() {
            #[cfg_attr(not(unix), allow(unused_mut))]
            let mut b = std::fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                b.mode(0o700);
            }
            match b.create(&dir) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.into()),
            }
        }
        std::fs::rename(&src, dir.join(name))?;
        moved = true;
    }
    if moved {
        sync_dir(&dir);
        sync_dir(state_dir);
    }
    Ok(dir.is_dir().then_some(dir))
}

/// Best-effort `fsync` of a directory (makes renames durable).
fn sync_dir(dir: &Path) {
    if let Ok(f) = std::fs::File::open(dir) {
        let _ = f.sync_all();
    }
}

// ---------------------------------------------------------------------------
// Import (inside the one transaction)
// ---------------------------------------------------------------------------

fn parse_json(name: &'static str, src: &Source) -> Result<Value> {
    serde_json::from_slice(&src.bytes)
        .map_err(|e| Error::invalid(name, format!("not valid JSON: {e}")))
}

/// Wrap an SQL error of a strict insert so the message names the file and record.
fn strict<'a>(field: &'static str, what: &'a str) -> impl FnOnce(rusqlite::Error) -> Error + 'a {
    move |e| Error::invalid(field, format!("{what}: {e}"))
}

fn import_all(
    tx: &Transaction<'_>,
    src: &BTreeMap<&'static str, Source>,
    now: i64,
    rep: &mut ImportReport,
) -> Result<()> {
    // gateway.json: owner, keys, settings.
    let mut owner: Option<String> = None;
    let mut session_ttl = 10800;
    let mut session_max_age = 0;
    let mut record_usage: BTreeMap<String, (i64, Option<String>, i64)> = BTreeMap::new();
    if let Some(s) = src.get("gateway.json") {
        let g = parse_json("gateway.json", s)?;
        let g = g
            .as_object()
            .ok_or_else(|| Error::invalid("gateway.json", "not a JSON object"))?;
        owner = import_owner(tx, g, s.mtime, rep)?;
        import_keys(tx, g, s.mtime, &mut record_usage, rep)?;
        (session_ttl, session_max_age) = import_settings(tx, g, now, rep)?;
    }
    if let Some(s) = src.get("config.json") {
        import_vault(tx, &parse_json("config.json", s)?, now, rep)?;
    }
    if let Some(s) = src.get("memora.env") {
        import_env(tx, s, now, rep)?;
    }
    if let Some(s) = src.get("tools.json") {
        import_tool_switches(tx, &parse_json("tools.json", s)?, s.mtime, rep)?;
    }
    if let Some(s) = src.get("access_stack.json") {
        match serde_json::from_slice::<Value>(&s.bytes) {
            Ok(v) => import_access(tx, &v, rep)?,
            Err(_) => rep.skip("access_stack_unreadable"),
        }
    }
    import_arm(tx, src, now, rep)?;
    import_usage(tx, src.get("key-usage.json"), record_usage, rep)?;
    if let Some(s) = src.get("sessions.json") {
        let signout = src
            .get("signout.json")
            .and_then(|s| serde_json::from_slice::<Value>(&s.bytes).ok());
        let limits = (session_ttl, session_max_age);
        import_sessions(tx, s, owner.as_deref(), signout.as_ref(), limits, now, rep)?;
    }
    // Oldest first, so activity ids follow time.
    for name in ["activity.jsonl.1", "activity.jsonl"] {
        if let Some(s) = src.get(name) {
            import_activity(tx, s, rep)?;
        }
    }
    Ok(())
}

fn import_owner(
    tx: &Transaction<'_>,
    g: &Map<String, Value>,
    mtime: i64,
    rep: &mut ImportReport,
) -> Result<Option<String>> {
    const F: &str = "gateway.json users";
    let users = match g.get("users") {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Object(m)) => m,
        Some(_) => return Err(Error::invalid(F, "not an object")),
    };
    if users.len() > 1 {
        let names: Vec<&str> = users.keys().map(String::as_str).collect();
        return Err(Error::invalid(
            F,
            format!(
                "Memora has a single owner but {} accounts exist ({}); remove all but one \
                 from gateway.json and restart",
                names.len(),
                names.join(", ")
            ),
        ));
    }
    let Some((name, rec)) = users.iter().next() else {
        return Ok(None);
    };
    let rec = rec
        .as_object()
        .ok_or_else(|| Error::invalid(F, format!("{name}: record is not an object")))?;
    let password = rec
        .get("password")
        .and_then(Value::as_str)
        .filter(|p| p.starts_with("$argon2id$"))
        .ok_or_else(|| Error::invalid(F, format!("{name}: password is not an argon2id hash")))?;
    let enabled = match rec.get("enabled") {
        None | Some(Value::Null) => true,
        Some(Value::Bool(b)) => *b,
        Some(_) => {
            return Err(Error::invalid(
                F,
                format!("{name}: enabled is not a boolean"),
            ))
        }
    };
    let display = match rec.get("display_name") {
        None | Some(Value::Null) => "",
        Some(Value::String(s)) => s.as_str(),
        Some(_) => {
            return Err(Error::invalid(
                F,
                format!("{name}: display_name is not a string"),
            ))
        }
    };
    let created = rec.get("created").and_then(time_value).unwrap_or(mtime);
    // `password_changed` is written by export_json; legacy records only have the mtime.
    let changed = rec
        .get("password_changed")
        .and_then(time_value)
        .unwrap_or(mtime);
    tx.execute(
        "INSERT INTO owner (id, username, password_hash, enabled, display_name, created_at,
                            password_changed_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            name,
            password,
            enabled as i64,
            display,
            created,
            changed.max(created)
        ],
    )
    .map_err(strict(F, name))?;
    rep.row("owner", 1);
    Ok(Some(name.clone()))
}

fn import_keys(
    tx: &Transaction<'_>,
    g: &Map<String, Value>,
    mtime: i64,
    usage: &mut BTreeMap<String, (i64, Option<String>, i64)>,
    rep: &mut ImportReport,
) -> Result<()> {
    let mut seen = BTreeSet::new();
    for (field, deleted) in [
        ("gateway.json api_keys", false),
        ("gateway.json api_keys_deleted", true),
    ] {
        let map_name = if deleted {
            "api_keys_deleted"
        } else {
            "api_keys"
        };
        let map = match g.get(map_name) {
            None | Some(Value::Null) => continue,
            Some(Value::Object(m)) => m,
            Some(_) => return Err(Error::invalid(field, "not an object")),
        };
        for (id, rec) in map {
            if !seen.insert(id.clone()) {
                return Err(Error::invalid(
                    field,
                    format!("{id}: present in both api_keys and api_keys_deleted"),
                ));
            }
            import_key(tx, field, id, rec, deleted, mtime, usage, rep)?;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn import_key(
    tx: &Transaction<'_>,
    field: &'static str,
    id: &str,
    rec: &Value,
    deleted: bool,
    mtime: i64,
    usage: &mut BTreeMap<String, (i64, Option<String>, i64)>,
    rep: &mut ImportReport,
) -> Result<()> {
    let bad = |what: &str| Error::invalid(field, format!("{id}: {what}"));
    let rec = rec
        .as_object()
        .ok_or_else(|| bad("record is not an object"))?;
    let name = match rec.get("name") {
        None | Some(Value::Null) => id,
        Some(Value::String(s)) => s.as_str(),
        Some(_) => return Err(bad("name is not a string")),
    };
    let hash = rec
        .get("hash")
        .and_then(Value::as_str)
        .filter(|h| !h.is_empty())
        .ok_or_else(|| bad("hash is missing"))?;
    // Same normalisation as `verify_key` (it compares sha256 hex case-insensitively).
    let hash = if hash.starts_with('$') {
        hash.to_string()
    } else {
        hash.to_ascii_lowercase()
    };
    let prefix = match rec.get("prefix") {
        None | Some(Value::Null) => {
            rep.skip("key_prefix_missing");
            UNKNOWN_PREFIX
        }
        Some(Value::String(s)) => s.as_str(),
        Some(_) => return Err(bad("prefix is not a string")),
    };
    let enabled = match rec.get("enabled") {
        None | Some(Value::Null) => true,
        Some(Value::Bool(b)) => *b,
        Some(_) => return Err(bad("enabled is not a boolean")),
    };
    let created = match rec.get("created") {
        None | Some(Value::Null) => {
            rep.skip("key_created_missing");
            mtime
        }
        Some(v) => time_value(v).ok_or_else(|| bad("created is not a time"))?,
    };
    // Keys have a single hash and no roll grace in the DB: a legacy `grace_until` is dropped.
    if rec.get("grace_until").is_some_and(|g| !g.is_null()) {
        rep.skip("key_grace_until_dropped");
    }
    let grace: Option<i64> = None;
    let deleted_at = if deleted {
        // `deleted_at` is written by export_json; legacy trash records only have the mtime.
        let at = match rec.get("deleted_at") {
            None | Some(Value::Null) => mtime,
            Some(v) => time_value(v).ok_or_else(|| bad("deleted_at is not a time"))?,
        };
        Some(at.max(created))
    } else {
        None
    };
    let scopes: Vec<&str> = match rec.get("scopes") {
        None | Some(Value::Null) => DEFAULT_SCOPES.to_vec(),
        Some(Value::Array(a)) => {
            let mut out = Vec::new();
            for s in a {
                let s = s.as_str().ok_or_else(|| bad("scopes must be strings"))?;
                if !KNOWN_SCOPES.contains(&s) {
                    return Err(bad(&format!("unknown scope {s:?}")));
                }
                if !out.contains(&s) {
                    out.push(s);
                }
            }
            out
        }
        Some(_) => return Err(bad("scopes is not a list")),
    };
    let tools: Option<Vec<&str>> = match rec.get("tools") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "*" => None,
        Some(Value::Array(a)) => Some(
            a.iter()
                .map(|t| t.as_str().ok_or_else(|| bad("tools must be strings")))
                .collect::<Result<_>>()?,
        ),
        Some(_) => return Err(bad("tools must be \"*\" or a list of names")),
    };
    tx.execute(
        "INSERT INTO api_key (id, name, hash, prefix, enabled, tools_all, created_at,
                              grace_until, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            name,
            hash,
            prefix,
            enabled as i64,
            tools.is_none() as i64,
            created,
            grace,
            deleted_at
        ],
    )
    .map_err(strict(field, id))?;
    rep.row("api_key", 1);
    for s in scopes {
        tx.execute(
            "INSERT INTO api_key_scope (key_id, scope) VALUES (?1, ?2)",
            params![id, s],
        )
        .map_err(strict(field, id))?;
        rep.row("api_key_scope", 1);
    }
    for t in tools.unwrap_or_default() {
        if !ensure_tool(tx, t, rep)? {
            rep.skip("key_tools_invalid_name");
            continue;
        }
        rep.row(
            "api_key_tool",
            tx.execute(
                "INSERT OR IGNORE INTO api_key_tool (key_id, tool_name) VALUES (?1, ?2)",
                params![id, t],
            )
            .map_err(strict(field, id))?,
        );
    }
    // Usage once kept in the key record itself (old gateway); key-usage.json wins.
    let last_used = rec.get("last_used").and_then(time_value);
    let count = rec
        .get("use_count")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    if let Some(at) = last_used {
        let ip = rec
            .get("last_ip")
            .and_then(Value::as_str)
            .map(str::to_string);
        usage.insert(id.to_string(), (at, ip, count));
    }
    Ok(())
}

/// Make sure `name` exists in `tool` (inserted as retired when the catalog does not have it
/// yet). False when `name` cannot be a tool name.
fn ensure_tool(tx: &Transaction<'_>, name: &str, rep: &mut ImportReport) -> Result<bool> {
    let shaped = name.len() <= 64
        && name.starts_with(|c: char| c.is_ascii_lowercase())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    if !shaped {
        return Ok(false);
    }
    let n = tx.execute(
        "INSERT OR IGNORE INTO tool (name, retired) VALUES (?1, 1)",
        [name],
    )?;
    if n > 0 {
        rep.row("tool", n);
        rep.skip("tools_unknown_added_retired");
    }
    Ok(true)
}

const SETTINGS_KEYS: &[&str] = &[
    "realm",
    "session_ttl",
    "session_max_age",
    "min_password_len",
];

fn import_settings(
    tx: &Transaction<'_>,
    g: &Map<String, Value>,
    now: i64,
    rep: &mut ImportReport,
) -> Result<(i64, i64)> {
    const F: &str = "gateway.json settings";
    let s = match g.get("settings") {
        None | Some(Value::Null) => return Ok((10800, 0)),
        Some(Value::Object(m)) => m,
        Some(_) => return Err(Error::invalid(F, "not an object")),
    };
    for k in s.keys() {
        if !SETTINGS_KEYS.contains(&k.as_str()) {
            rep.skip("gateway_settings_ignored");
        }
    }
    let realm = match s.get("realm") {
        None | Some(Value::Null) => None,
        Some(Value::String(r)) => Some(r.clone()),
        Some(_) => return Err(Error::invalid(F, "realm is not a string")),
    };
    let int = |k: &str| -> Result<Option<i64>> {
        match s.get(k) {
            None | Some(Value::Null) => Ok(None),
            Some(v) => v
                .as_i64()
                .map(Some)
                .ok_or_else(|| Error::invalid(F, format!("{k} is not an integer"))),
        }
    };
    let (ttl, max_age, minlen) = (
        int("session_ttl")?,
        int("session_max_age")?,
        int("min_password_len")?,
    );
    if realm.is_none() && ttl.is_none() && max_age.is_none() && minlen.is_none() {
        return Ok((10800, 0));
    }
    tx.execute(
        "UPDATE settings SET realm = coalesce(?1, realm), session_ttl = coalesce(?2, session_ttl),
                session_max_age = coalesce(?3, session_max_age),
                min_password_len = coalesce(?4, min_password_len), updated_at = ?5
         WHERE id = 1",
        params![realm, ttl, max_age, minlen, now],
    )
    .map_err(strict(
        F,
        "realm / session_ttl / session_max_age / min_password_len",
    ))?;
    rep.row("settings", 1);
    Ok(tx.query_row(
        "SELECT session_ttl, session_max_age FROM settings WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

fn import_vault(tx: &Transaction<'_>, c: &Value, now: i64, rep: &mut ImportReport) -> Result<()> {
    const F: &str = "config.json vault";
    let vault = match c.get("vault") {
        None | Some(Value::Null) => return Ok(()),
        Some(Value::String(v)) => v.trim(),
        Some(_) => return Err(Error::invalid(F, "not a string")),
    };
    if vault.is_empty() {
        return Ok(());
    }
    let mut path = PathBuf::from(vault);
    if !crate::is_absolute_path(vault) {
        // The old server resolved it against its working directory.
        path = std::env::current_dir()?.join(path);
        rep.skip("vault_path_made_absolute");
    }
    let path = path
        .to_str()
        .ok_or_else(|| Error::invalid(F, "not valid UTF-8"))?
        .to_string();
    tx.execute(
        "UPDATE settings SET vault_path = ?1, updated_at = ?2 WHERE id = 1",
        params![path, now],
    )
    .map_err(strict(F, &path))?;
    rep.row("settings", 1);
    Ok(())
}

/// `KEY=value` lines as `read_env_file` parses them (comments, `export`, quotes).
fn parse_env(raw: &str) -> Vec<(String, String)> {
    raw.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() || l.starts_with('#') {
                return None;
            }
            let (k, v) = l.split_once('=')?;
            let k = k.trim().trim_start_matches("export ").trim();
            let v = v.trim();
            let v = v
                .strip_prefix('"')
                .and_then(|x| x.strip_suffix('"'))
                .or_else(|| v.strip_prefix('\'').and_then(|x| x.strip_suffix('\'')))
                .unwrap_or(v);
            Some((k.to_string(), v.to_string()))
        })
        .collect()
}

fn import_env(tx: &Transaction<'_>, s: &Source, now: i64, rep: &mut ImportReport) -> Result<()> {
    const F: &str = "memora.env";
    let raw = String::from_utf8_lossy(&s.bytes);
    // Later lines win, as with `apply_env_file`.
    let mut values: BTreeMap<String, String> = BTreeMap::new();
    for (k, v) in parse_env(&raw) {
        if crate::config::SECRET_ENV_KEYS.contains(&k.as_str()) {
            if !v.is_empty() && !rep.dropped_secrets.contains(&k) {
                rep.dropped_secrets.push(k);
            }
            continue;
        }
        if !crate::config::is_known_key(&k) {
            rep.skip("env_unknown_keys");
            continue;
        }
        values.insert(k, v);
    }
    for (k, v) in values {
        if v.is_empty() {
            continue; // empty = "not set"
        }
        tx.execute(
            "INSERT INTO server_config (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![k, v, now],
        )
        .map_err(strict(F, &k))?;
        rep.row("server_config", 1);
    }
    Ok(())
}

fn import_tool_switches(
    tx: &Transaction<'_>,
    t: &Value,
    mtime: i64,
    rep: &mut ImportReport,
) -> Result<()> {
    const F: &str = "tools.json disabled";
    let list = match t.get("disabled") {
        None | Some(Value::Null) => return Ok(()),
        Some(Value::Array(a)) => a,
        Some(_) => return Err(Error::invalid(F, "not a list")),
    };
    // `disabled_at` is written by export_json; legacy files only have the mtime.
    let at = t.get("disabled_at").and_then(Value::as_object);
    for name in list {
        let Some(name) = name.as_str() else {
            rep.skip("tools_disabled_invalid_name");
            continue;
        };
        if !ensure_tool(tx, name, rep)? {
            rep.skip("tools_disabled_invalid_name");
            continue;
        }
        rep.row(
            "tool_disabled",
            tx.execute(
                "INSERT OR IGNORE INTO tool_disabled (tool_name, disabled_at) VALUES (?1, ?2)",
                params![
                    name,
                    at.and_then(|m| m.get(name))
                        .and_then(time_value)
                        .unwrap_or(mtime)
                ],
            )?,
        );
    }
    Ok(())
}

/// Lenient: a malformed file or rule is skipped and counted. Each rule is checked with
/// [`crate::access::validate_rule`], as `access::save` does.
fn import_access(tx: &Transaction<'_>, a: &Value, rep: &mut ImportReport) -> Result<()> {
    let Some(a) = a.as_object() else {
        rep.skip("access_stack_unreadable");
        return Ok(());
    };
    match a.get("default_allow") {
        Some(Value::Bool(b)) => {
            tx.execute(
                "UPDATE access_policy SET default_allow = ?1 WHERE id = 1",
                [*b as i64],
            )?;
            rep.row("access_policy", 1);
        }
        _ => rep.skip("access_default_allow_invalid"),
    }
    let Some(rules) = a.get("rules").and_then(Value::as_array) else {
        rep.skip("access_stack_unreadable");
        return Ok(());
    };
    let mut pos: i64 = 0;
    for r in rules {
        let rule = match serde_json::from_value::<crate::access::AccessRule>(r.clone()) {
            Ok(rule) if crate::access::validate_rule(&rule).is_ok() => rule,
            _ => {
                rep.skip("access_rules_invalid");
                continue;
            }
        };
        let r = tx.execute(
            "INSERT INTO access_rule (id, position, kind, value, action, enabled, note)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                rule.id,
                pos,
                rule.kind.as_str(),
                rule.value,
                rule.action.as_str(),
                rule.enabled as i64,
                rule.note
            ],
        );
        match r {
            Ok(n) => {
                rep.row("access_rule", n);
                pos += 1;
            }
            Err(e) if is_constraint(&e) => rep.skip("access_rules_invalid"),
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

fn import_arm(
    tx: &Transaction<'_>,
    src: &BTreeMap<&'static str, Source>,
    now: i64,
    rep: &mut ImportReport,
) -> Result<()> {
    let mut state = "idle";
    let (mut mode, mut armed_at, mut ttl, mut code_hash, mut locked_at) = (
        None::<String>,
        None::<i64>,
        None::<i64>,
        None::<String>,
        None::<i64>,
    );
    if let Some(s) = src.get("lock.json") {
        state = "locked";
        let v: Value = serde_json::from_slice(&s.bytes).unwrap_or(Value::Null);
        locked_at = Some(v.get("at").and_then(time_value).unwrap_or(s.mtime));
    }
    if let Some(s) = src.get("arm.json") {
        const F: &str = "arm.json";
        let v = parse_json(F, s)?;
        let m = v.get("mode").and_then(Value::as_str).unwrap_or("");
        let at = v.get("armed_at").and_then(Value::as_i64);
        let t = v.get("ttl").and_then(Value::as_i64);
        let mode_ok = matches!(m, "bootstrap" | "reset");
        // Legacy semantics: a window that is over (or unreadable) means LOCKED.
        match (at, t) {
            (Some(at), Some(t)) if now <= at.saturating_add(t) => {
                let hash = v
                    .get("code_hash")
                    .and_then(Value::as_str)
                    .ok_or_else(|| Error::invalid(F, "open window without code_hash"))?;
                if !mode_ok {
                    return Err(Error::invalid(
                        F,
                        format!("mode {m:?} is not bootstrap or reset"),
                    ));
                }
                state = "armed";
                (mode, armed_at, ttl, code_hash) = (
                    Some(m.into()),
                    Some(at),
                    Some(t),
                    Some(hash.to_ascii_lowercase()),
                );
                locked_at = None;
            }
            (at, t) => {
                state = "locked";
                let end = at.unwrap_or(0).saturating_add(t.unwrap_or(0));
                locked_at = Some(locked_at.unwrap_or(if end > 0 { end.min(now) } else { s.mtime }));
                mode = mode_ok.then(|| m.to_string());
                armed_at = at;
                ttl = t.filter(|t| (30..=86400).contains(t));
            }
        }
    }
    let mut burned: (Option<i64>, Option<String>, Option<String>) = (None, None, None);
    if let Some(s) = src.get("arm-burned.json") {
        const F: &str = "arm-burned.json";
        let v = parse_json(F, s)?;
        let at = v
            .get("at")
            .and_then(time_value)
            .ok_or_else(|| Error::invalid(F, "at is missing"))?;
        let ip = v
            .get("ip")
            .and_then(Value::as_str)
            .unwrap_or("?")
            .to_string();
        let m = v.get("mode").and_then(Value::as_str).unwrap_or("");
        let m = match m {
            "" => None,
            "bootstrap" | "reset" => Some(m.to_string()),
            _ => {
                return Err(Error::invalid(
                    F,
                    format!("mode {m:?} is not bootstrap or reset"),
                ))
            }
        };
        burned = (Some(at), Some(ip), m);
    }
    if state == "idle" && burned.0.is_none() {
        return Ok(());
    }
    tx.execute(
        "UPDATE arm_state SET state = ?1, mode = ?2, armed_at = ?3, ttl = ?4, code_hash = ?5,
                locked_at = ?6, burned_at = ?7, burned_ip = ?8, burned_mode = ?9 WHERE id = 1",
        params![state, mode, armed_at, ttl, code_hash, locked_at, burned.0, burned.1, burned.2],
    )
    .map_err(strict("arm.json / lock.json / arm-burned.json", state))?;
    rep.row("arm_state", 1);
    Ok(())
}

fn import_usage(
    tx: &Transaction<'_>,
    file: Option<&Source>,
    mut usage: BTreeMap<String, (i64, Option<String>, i64)>,
    rep: &mut ImportReport,
) -> Result<()> {
    if let Some(s) = file {
        match serde_json::from_slice::<Value>(&s.bytes) {
            Ok(Value::Object(m)) => {
                for (id, u) in m {
                    let Some(at) = u.get("last_used").and_then(time_value) else {
                        rep.skip("key_usage_bad_entries");
                        continue;
                    };
                    let ip = u.get("last_ip").and_then(Value::as_str).map(str::to_string);
                    let count = u.get("count").and_then(Value::as_i64).unwrap_or(0).max(0);
                    usage.insert(id, (at, ip, count));
                }
            }
            _ => rep.skip("key_usage_unreadable"),
        }
    }
    for (id, (at, ip, count)) in usage {
        let ip = ip.filter(|i| i.len() <= 45);
        let r = tx.execute(
            "INSERT INTO api_key_usage (key_id, last_used, last_ip, use_count)
             SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM api_key WHERE id = ?1)",
            params![id, at, ip, count],
        )?;
        if r == 0 {
            rep.skip("key_usage_unknown_key");
        }
        rep.row("api_key_usage", r);
    }
    Ok(())
}

fn is_constraint(e: &rusqlite::Error) -> bool {
    matches!(e, rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation)
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn import_sessions(
    tx: &Transaction<'_>,
    s: &Source,
    owner: Option<&str>,
    signout: Option<&Value>,
    (ttl, max_age): (i64, i64),
    now: i64,
    rep: &mut ImportReport,
) -> Result<()> {
    let list: Vec<Value> = match serde_json::from_slice::<Value>(&s.bytes) {
        Ok(Value::Array(a)) => a,
        Ok(Value::Object(m)) => m.into_values().collect(), // old gateway: {sid: record}
        _ => {
            rep.skip("sessions_file_unreadable");
            return Ok(());
        }
    };
    let signout_all = signout.and_then(|v| v.get("all")).and_then(Value::as_bool) == Some(true);
    let signout_prefixes: Vec<String> = signout
        .and_then(|v| v.get("sids"))
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    for v in list {
        let text = |k: &str| v.get(k).and_then(Value::as_str);
        let (Some(sid), Some(user), Some(created), Some(last_seen)) = (
            text("sid").filter(|s| !s.is_empty()),
            text("user"),
            v.get("created").and_then(time_value),
            v.get("last_seen").and_then(time_value),
        ) else {
            rep.skip("sessions_bad_records");
            continue;
        };
        if now.saturating_sub(last_seen) > ttl
            || (max_age > 0 && now.saturating_sub(created) > max_age)
        {
            rep.skip("sessions_expired");
            continue;
        }
        if owner != Some(user) {
            rep.skip("sessions_not_owner");
            continue;
        }
        let hash = sha256_hex(sid.as_bytes());
        if signout_all
            || signout_prefixes.iter().any(|p| {
                !p.is_empty() && (sid.starts_with(p.as_str()) || hash.starts_with(p.as_str()))
            })
        {
            rep.skip("sessions_signed_out");
            continue;
        }
        let r = tx.execute(
            "INSERT OR IGNORE INTO session (sid_hash, owner_id, source, alias, ip, user_agent,
                                            created_at, last_seen)
             VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                hash,
                text("source").unwrap_or("password"),
                text("alias").map(|a| truncate(a, 64)),
                text("ip"),
                text("agent").map(|a| truncate(a, 300)),
                created,
                last_seen.max(created),
            ],
        );
        match r {
            Ok(n) => rep.row("session", n),
            Err(e) if is_constraint(&e) => rep.skip("sessions_bad_records"),
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

fn import_activity(tx: &Transaction<'_>, s: &Source, rep: &mut ImportReport) -> Result<()> {
    let raw = String::from_utf8_lossy(&s.bytes);
    let mut stmt = tx.prepare(
        "INSERT INTO activity (at, event, ip, actor, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            rep.skip("activity_bad_lines");
            continue;
        };
        let (Some(at), Some(event)) = (
            v.get("at").and_then(time_value),
            v.get("event").and_then(Value::as_str),
        ) else {
            rep.skip("activity_bad_lines");
            continue;
        };
        let text = |k: &str| v.get(k).and_then(Value::as_str);
        let detail = truncate(text("detail").unwrap_or(""), 2000);
        match stmt.execute(params![at, event, text("ip"), text("user"), detail]) {
            Ok(n) => rep.row("activity", n),
            Err(e) if is_constraint(&e) => rep.skip("activity_bad_lines"),
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Time parsing (legacy records hold unix seconds, floats, or RFC 3339 strings)
// ---------------------------------------------------------------------------

/// Unix seconds from an integer, a float, a numeric string or an RFC 3339 string.
fn time_value(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f.floor() as i64)),
        Value::String(s) => s
            .trim()
            .parse::<i64>()
            .ok()
            .or_else(|| parse_rfc3339(s.trim())),
        _ => None,
    }
}

/// `YYYY-MM-DD[T ]HH:MM:SS[.frac][Z|±HH:MM|±HHMM]` (no offset = UTC).
fn parse_rfc3339(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |from: usize, to: usize| -> Option<i64> {
        let part = s.get(from..to)?;
        part.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| part.parse().ok())?
    };
    if b[4] != b'-'
        || b[7] != b'-'
        || !matches!(b[10], b'T' | b't' | b' ')
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, se) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    let mut rest = &s[19..];
    if let Some(r) = rest.strip_prefix('.') {
        let digits = r.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        rest = &r[digits..];
    }
    let offset = match rest {
        "" | "Z" | "z" => 0,
        _ => {
            let sign = match rest.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let r = &rest[1..];
            let (oh, om) = match r.len() {
                5 if r.as_bytes()[2] == b':' => (r.get(0..2)?, r.get(3..5)?),
                4 => (r.get(0..2)?, r.get(2..4)?),
                _ => return None,
            };
            let (oh, om): (i64, i64) = (oh.parse().ok()?, om.parse().ok()?);
            sign * (oh * 3600 + om * 60)
        }
    };
    // Days from civil (H. Hinnant).
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days * 86400 + h * 3600 + mi * 60 + se - offset)
}

// ---------------------------------------------------------------------------
// Export (rollback)
// ---------------------------------------------------------------------------

/// Everything export_json needs, read in one snapshot.
struct Snapshot {
    owner: Option<(String, String, bool, String, i64, i64)>,
    keys: Vec<(String, Map<String, Value>, bool)>,
    settings: (String, i64, i64, i64, Option<String>),
    config: Vec<(String, String)>,
    disabled: Vec<(String, i64)>,
    access: Value,
    arm: ArmRow,
    usage: Map<String, Value>,
    activity: Vec<Value>,
}

struct ArmRow {
    state: String,
    mode: Option<String>,
    armed_at: Option<i64>,
    ttl: Option<i64>,
    code_hash: Option<String>,
    locked_at: Option<i64>,
    burned: Option<(i64, String, Option<String>)>,
}

fn snapshot(conn: &Connection) -> Result<Snapshot> {
    let owner = conn
        .query_row(
            "SELECT username, password_hash, enabled, display_name, created_at, password_changed_at
             FROM owner WHERE id = 1",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get::<_, i64>(2)? == 1,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .optional()?;

    let mut scopes: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for row in conn
        .prepare("SELECT key_id, scope FROM api_key_scope")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
    {
        let (k, s) = row?;
        scopes.entry(k).or_default().push(s);
    }
    let mut tools: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for row in conn
        .prepare("SELECT key_id, tool_name FROM api_key_tool ORDER BY tool_name")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
    {
        let (k, t) = row?;
        tools.entry(k).or_default().push(t);
    }
    let mut keys = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT id, name, hash, prefix, enabled, tools_all, created_at, grace_until, deleted_at
         FROM api_key ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)? == 1,
            r.get::<_, i64>(5)? == 1,
            r.get::<_, i64>(6)?,
            r.get::<_, Option<i64>>(7)?,
            r.get::<_, Option<i64>>(8)?,
        ))
    })?;
    for row in rows {
        let (id, name, hash, prefix, enabled, tools_all, created, grace, deleted) = row?;
        let mut sc = scopes.remove(&id).unwrap_or_default();
        sc.sort_by_key(|s| KNOWN_SCOPES.iter().position(|k| k == s));
        let mut rec = Map::new();
        rec.insert("name".into(), json!(name));
        rec.insert("hash".into(), json!(hash));
        rec.insert("prefix".into(), json!(prefix));
        rec.insert("enabled".into(), json!(enabled));
        rec.insert("scopes".into(), json!(sc));
        rec.insert(
            "tools".into(),
            if tools_all {
                json!("*")
            } else {
                json!(tools.remove(&id).unwrap_or_default())
            },
        );
        rec.insert("created".into(), json!(created));
        if let Some(g) = grace {
            rec.insert("grace_until".into(), json!(g));
        }
        if let Some(d) = deleted {
            rec.insert("deleted_at".into(), json!(d));
        }
        keys.push((id, rec, deleted.is_some()));
    }

    let settings = conn.query_row(
        "SELECT realm, session_ttl, session_max_age, min_password_len, vault_path
         FROM settings WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )?;
    let config = conn
        .prepare("SELECT key, value FROM server_config")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<Vec<(String, String)>>>()?;
    let disabled = conn
        .prepare("SELECT tool_name, disabled_at FROM tool_disabled ORDER BY tool_name")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<Vec<(String, i64)>>>()?;

    let default_allow: i64 = conn.query_row(
        "SELECT default_allow FROM access_policy WHERE id = 1",
        [],
        |r| r.get(0),
    )?;
    let rules = conn
        .prepare(
            "SELECT id, kind, value, action, enabled, note FROM access_rule ORDER BY position",
        )?
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?,
                "value": r.get::<_, String>(2)?, "action": r.get::<_, String>(3)?,
                "enabled": r.get::<_, i64>(4)? == 1, "note": r.get::<_, String>(5)?,
            }))
        })?
        .collect::<rusqlite::Result<Vec<Value>>>()?;
    let access = json!({"rules": rules, "default_allow": default_allow == 1});

    let arm = conn.query_row(
        "SELECT state, mode, armed_at, ttl, code_hash, locked_at, burned_at, burned_ip, burned_mode
         FROM arm_state WHERE id = 1",
        [],
        |r| {
            let burned_at: Option<i64> = r.get(6)?;
            let burned_ip: Option<String> = r.get(7)?;
            let burned_mode: Option<String> = r.get(8)?;
            Ok(ArmRow {
                state: r.get(0)?,
                mode: r.get(1)?,
                armed_at: r.get(2)?,
                ttl: r.get(3)?,
                code_hash: r.get(4)?,
                locked_at: r.get(5)?,
                burned: burned_at.zip(burned_ip).map(|(a, i)| (a, i, burned_mode)),
            })
        },
    )?;

    let mut usage = Map::new();
    for row in conn
        .prepare("SELECT key_id, last_used, last_ip, use_count FROM api_key_usage ORDER BY key_id")?
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                json!({"last_used": r.get::<_, i64>(1)?, "last_ip": r.get::<_, Option<String>>(2)?,
                       "count": r.get::<_, i64>(3)?}),
            ))
        })?
    {
        let (k, v) = row?;
        usage.insert(k, v);
    }
    let activity = conn
        .prepare("SELECT at, event, ip, actor, detail FROM activity ORDER BY id")?
        .query_map([], |r| {
            Ok(json!({
                "at": r.get::<_, i64>(0)?, "event": r.get::<_, String>(1)?,
                "ip": r.get::<_, Option<String>>(2)?, "user": r.get::<_, Option<String>>(3)?,
                "detail": r.get::<_, String>(4)?,
            }))
        })?
        .collect::<rusqlite::Result<Vec<Value>>>()?;

    Ok(Snapshot {
        owner,
        keys,
        settings,
        config,
        disabled,
        access,
        arm,
        usage,
        activity,
    })
}

/// Write `bytes` to `path` atomically (temp file + rename), owner-only.
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// The `gateway.json` to merge into: the target's own, else the newest archived one (keeps
/// fields the DB does not model, e.g. rate limits, for the old binary).
fn gateway_base(dir: &Path) -> Map<String, Value> {
    let read = |p: &Path| -> Option<Map<String, Value>> {
        serde_json::from_slice::<Value>(&std::fs::read(p).ok()?)
            .ok()?
            .as_object()
            .cloned()
    };
    if let Some(m) = read(&dir.join("gateway.json")) {
        return m;
    }
    let newest = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let ts: i64 = name.strip_prefix("legacy-json-")?.parse().ok()?;
            Some((ts, e.path()))
        })
        .max_by_key(|(ts, _)| *ts);
    newest
        .and_then(|(_, p)| read(&p.join("gateway.json")))
        .unwrap_or_default()
}

/// Write the current DB back into the legacy formats in `state_dir` for rollback. Returns
/// the files written; `sessions.json` is written empty (only session hashes are stored).
pub fn export_json(db: &Db, state_dir: &Path) -> Result<Vec<PathBuf>> {
    let snap = db.read(snapshot)?;
    if !state_dir.is_dir() {
        let mut b = std::fs::DirBuilder::new();
        b.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            b.mode(0o700);
        }
        b.create(state_dir)?;
    }
    let mut written = Vec::new();
    let mut put = |name: &str, bytes: Vec<u8>| -> Result<()> {
        let p = state_dir.join(name);
        write_private(&p, &bytes)?;
        written.push(p);
        Ok(())
    };
    let pretty = |v: &Value| serde_json::to_vec_pretty(v).map_err(|e| Error::Io(e.into()));

    // gateway.json
    let mut g = gateway_base(state_dir);
    let mut users = Map::new();
    if let Some((name, hash, enabled, display, created, changed)) = &snap.owner {
        users.insert(
            name.clone(),
            json!({
                "password": hash,
                "role": "owner",
                "enabled": enabled,
                "display_name": display,
                "created": created,
                "password_changed": changed,
            }),
        );
    }
    g.insert("users".into(), Value::Object(users));
    let (mut live, mut trash) = (Map::new(), Map::new());
    for (id, rec, deleted) in snap.keys {
        if deleted { &mut trash } else { &mut live }.insert(id, Value::Object(rec));
    }
    g.insert("api_keys".into(), Value::Object(live));
    g.insert("api_keys_deleted".into(), Value::Object(trash));
    let (realm, ttl, max_age, minlen, vault) = snap.settings;
    let mut settings = g
        .get("settings")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    settings.insert("realm".into(), json!(realm));
    settings.insert("session_ttl".into(), json!(ttl));
    settings.insert("session_max_age".into(), json!(max_age));
    settings.insert("min_password_len".into(), json!(minlen));
    g.insert("settings".into(), Value::Object(settings));
    put("gateway.json", pretty(&Value::Object(g))?)?;

    // config.json
    let config = match vault {
        Some(v) => json!({"vault": v}),
        None => json!({}),
    };
    put("config.json", pretty(&config)?)?;

    // memora.env (in the order of the legacy ENV_KEYS)
    let mut env = String::from(
        "# Memora settings, exported from memora.db by `memora-cli db export-json`.\n",
    );
    let mut config = snap.config;
    config.sort_by_key(|(k, _)| crate::config::CONFIG_KEYS.iter().position(|(c, _)| c == k));
    for (k, v) in config {
        env.push_str(&format!("{k}={v}\n"));
    }
    put("memora.env", env.into_bytes())?;

    let names: Vec<&str> = snap.disabled.iter().map(|(n, _)| n.as_str()).collect();
    let at: Map<String, Value> = snap
        .disabled
        .iter()
        .map(|(n, t)| (n.clone(), json!(t)))
        .collect();
    put(
        "tools.json",
        pretty(&json!({"disabled": names, "disabled_at": at}))?,
    )?;
    put("access_stack.json", pretty(&snap.access)?)?;
    put("sessions.json", b"[]".to_vec())?;
    put("key-usage.json", pretty(&Value::Object(snap.usage))?)?;

    // arm.json / lock.json / arm-burned.json
    let arm = snap.arm;
    let mut stale = vec!["arm.json", "lock.json", "arm-burned.json"];
    match arm.state.as_str() {
        "armed" => {
            put(
                "arm.json",
                pretty(&json!({
                    "armed": true, "mode": arm.mode, "armed_at": arm.armed_at, "ttl": arm.ttl,
                    "code_hash": arm.code_hash,
                }))?,
            )?;
            stale.retain(|f| *f != "arm.json");
        }
        "locked" => {
            put(
                "lock.json",
                pretty(&json!({"locked": true, "at": arm.locked_at}))?,
            )?;
            stale.retain(|f| *f != "lock.json");
        }
        _ => {}
    }
    if let Some((at, ip, mode)) = arm.burned {
        put(
            "arm-burned.json",
            pretty(&json!({"at": at, "ip": ip, "mode": mode.unwrap_or_default()}))?,
        )?;
        stale.retain(|f| *f != "arm-burned.json");
    }
    for f in stale {
        match std::fs::remove_file(state_dir.join(f)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }

    let mut log = String::new();
    for a in &snap.activity {
        log.push_str(&a.to_string());
        log.push('\n');
    }
    put("activity.jsonl", log.into_bytes())?;

    sync_dir(state_dir);
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("2026-10-14T20:49:30+09:00"), Some(1791978570));
        assert_eq!(
            parse_rfc3339("2026-10-14T11:49:30.123456Z"),
            Some(1791978570)
        );
        assert_eq!(parse_rfc3339("2026-10-14 11:49:30"), Some(1791978570));
        assert_eq!(parse_rfc3339("2026-10-14T13:49:30+0200"), Some(1791978570));
        assert_eq!(parse_rfc3339("2000-02-29T00:00:00-01:00"), Some(951786000));
        assert_eq!(parse_rfc3339("2026-13-14T11:49:30Z"), None);
        assert_eq!(parse_rfc3339("garbage"), None);
        assert_eq!(time_value(&json!(1791978570.7)), Some(1791978570));
        assert_eq!(time_value(&json!("1791978570")), Some(1791978570));
    }

    #[test]
    fn env_parsing() {
        let v =
            parse_env("# c\nexport MEMORA_PORT=\"8080\"\n\nRUST_LOG='info'\nBAD\nMEMORA_BIND=\n");
        assert_eq!(
            v,
            vec![
                ("MEMORA_PORT".to_string(), "8080".to_string()),
                ("RUST_LOG".to_string(), "info".to_string()),
                ("MEMORA_BIND".to_string(), String::new()),
            ]
        );
    }
}
