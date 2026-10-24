//! The security activity log, table `activity`.
//!
//! [`log_activity`] takes `&Db` and never fails the caller; multi-step operations log with
//! [`log`] inside their own transaction instead. Size is bounded by [`crate::retention`].

use crate::{Db, Error, Result};
use rusqlite::types::Value as SqlValue;
use rusqlite::{params_from_iter, Connection, Row, Transaction};

/// Maximum `detail` length in characters (schema CHECK).
pub const DETAIL_MAX: usize = 2000;
/// Maximum `actor` length in characters (schema CHECK).
pub const ACTOR_MAX: usize = 64;
/// Maximum `ip` length in characters (schema CHECK; longest textual IPv6 is 45).
pub const IP_MAX: usize = 45;
/// Maximum `event` length (schema CHECK).
pub const EVENT_MAX: usize = 48;

/// Events that record a failed or refused attempt (the CLI's `/activity fail` and the
/// UI's red rows).
pub const FAILURE_EVENTS: &[&str] = &[
    "auth_fail",
    "login_fail",
    "cooldown",
    "code_burned",
    "key_fail",
];

/// True for an event listed in [`FAILURE_EVENTS`].
pub fn is_failure(event: &str) -> bool {
    FAILURE_EVENTS.contains(&event)
}

/// One `activity` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityEvent {
    pub id: i64,
    pub at: i64,
    /// `[a-z0-9_]`, 1-48 chars, e.g. `signin`, `key_created`, `signout_cli`.
    pub event: String,
    pub ip: Option<String>,
    /// Username, key id or `cli`.
    pub actor: Option<String>,
    pub detail: String,
}

impl ActivityEvent {
    /// The legacy `activity.jsonl` line shape the UI and CLI consume:
    /// `{"at","event","ip","user","detail"}` (`user` = `actor`).
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "at": self.at, "event": self.event, "ip": self.ip,
            "user": self.actor, "detail": self.detail,
        })
    }

    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(ActivityEvent {
            id: r.get(0)?,
            at: r.get(1)?,
            event: r.get(2)?,
            ip: r.get(3)?,
            actor: r.get(4)?,
            detail: r.get(5)?,
        })
    }
}

/// Input for [`log`]. `detail` is truncated to 2000 chars, `actor` to 64, `ip` to 45.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NewActivity<'a> {
    pub event: &'a str,
    pub ip: Option<&'a str>,
    pub actor: Option<&'a str>,
    pub detail: &'a str,
}

/// Check an event name against the schema shape (`[a-z0-9_]{1,48}`).
pub fn validate_event(event: &str) -> Result<()> {
    if event.is_empty() || event.len() > EVENT_MAX {
        return Err(Error::invalid(
            "event",
            format!("must be 1-{EVENT_MAX} chars"),
        ));
    }
    if !event
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(Error::invalid(
            "event",
            format!("{event:?}: only a-z, 0-9 and _"),
        ));
    }
    Ok(())
}

/// First `max` characters of `s` (SQLite `length()` counts characters).
fn truncate(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

/// Insert one event inside `tx`; returns its id. Rejects a malformed event name
/// (`Error::Invalid`); over-long fields are truncated, empty `ip` / `actor` become NULL.
pub fn log(tx: &Transaction<'_>, ev: &NewActivity<'_>, now: i64) -> Result<i64> {
    validate_event(ev.event)?;
    let ip = ev.ip.filter(|s| !s.is_empty()).map(|s| truncate(s, IP_MAX));
    let actor = ev
        .actor
        .filter(|s| !s.is_empty())
        .map(|s| truncate(s, ACTOR_MAX));
    let detail = truncate(ev.detail, DETAIL_MAX);
    tx.execute(
        "INSERT INTO activity (at, event, ip, actor, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![now, ev.event, ip, actor, detail],
    )?;
    Ok(tx.last_insert_rowid())
}

/// Standalone append in its own short transaction. Never fails the caller: errors drop
/// the event silently.
pub fn log_activity(db: &Db, event: &str, ip: Option<&str>, actor: Option<&str>, detail: &str) {
    let ev = NewActivity {
        event,
        ip,
        actor,
        detail,
    };
    let _ = db.write(|tx| log(tx, &ev, crate::now()));
}

/// Filter for [`query`]. `Default` = everything.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ActivityQuery<'a> {
    /// Case-insensitive (ASCII) substring on event, ip, actor and detail.
    pub text: Option<&'a str>,
    /// Only these event names (empty = any).
    pub events: &'a [&'a str],
    /// Only [`FAILURE_EVENTS`] (intersected with `events` when both are set).
    pub failures_only: bool,
    /// Only events strictly older than this `(at, id)` cursor (paging).
    pub before: Option<(i64, i64)>,
}

/// Newest `limit` events, newest first; `query` filters case-insensitively on event, ip,
/// actor and detail.
pub fn recent(conn: &Connection, limit: usize, query: Option<&str>) -> Result<Vec<ActivityEvent>> {
    self::query(
        conn,
        limit,
        &ActivityQuery {
            text: query,
            ..Default::default()
        },
    )
}

/// Only the failure events ([`FAILURE_EVENTS`]), newest first (`/activity fail`).
pub fn recent_failures(conn: &Connection, limit: usize) -> Result<Vec<ActivityEvent>> {
    query(
        conn,
        limit,
        &ActivityQuery {
            failures_only: true,
            ..Default::default()
        },
    )
}

/// Newest `limit` events matching `q`, newest first (`at DESC, id DESC`).
pub fn query(conn: &Connection, limit: usize, q: &ActivityQuery<'_>) -> Result<Vec<ActivityEvent>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut sql = String::from("SELECT id, at, event, ip, actor, detail FROM activity WHERE 1");
    let mut args: Vec<SqlValue> = Vec::new();

    let mut names: Vec<&str> = q.events.to_vec();
    if q.failures_only {
        if names.is_empty() {
            names = FAILURE_EVENTS.to_vec();
        } else {
            names.retain(|n| is_failure(n));
            if names.is_empty() {
                return Ok(Vec::new());
            }
        }
    }
    if !names.is_empty() {
        sql.push_str(" AND event IN (");
        for (i, n) in names.iter().enumerate() {
            if i > 0 {
                sql.push(',');
            }
            args.push(SqlValue::Text((*n).to_string()));
            sql.push_str(&format!("?{}", args.len()));
        }
        sql.push(')');
    }
    if let Some(text) = q.text.map(str::trim).filter(|t| !t.is_empty()) {
        let mut pat = String::from("%");
        for c in text.to_ascii_lowercase().chars() {
            if matches!(c, '%' | '_' | '\\') {
                pat.push('\\');
            }
            pat.push(c);
        }
        pat.push('%');
        // LIKE is ASCII case-insensitive in SQLite.
        args.push(SqlValue::Text(pat));
        let n = args.len();
        sql.push_str(&format!(
            " AND (event LIKE ?{n} ESCAPE '\\' OR coalesce(ip,'') LIKE ?{n} ESCAPE '\\' \
             OR coalesce(actor,'') LIKE ?{n} ESCAPE '\\' OR detail LIKE ?{n} ESCAPE '\\')"
        ));
    }
    if let Some((at, id)) = q.before {
        let n = args.len() + 1;
        sql.push_str(&format!(
            " AND (at < ?{n} OR (at = ?{n} AND id < ?{}))",
            n + 1
        ));
        args.push(SqlValue::Integer(at));
        args.push(SqlValue::Integer(id));
    }
    sql.push_str(&format!(
        " ORDER BY at DESC, id DESC LIMIT ?{}",
        args.len() + 1
    ));
    args.push(SqlValue::Integer(i64::try_from(limit).unwrap_or(i64::MAX)));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args), ActivityEvent::from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Total rows in `activity`.
pub fn count(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT count(*) FROM activity", [], |r| r.get(0))?)
}
