//! Per-key usage counters and events (`api_key_usage`, `api_key_event`), buffered in a
//! [`UsageBuffer`] and flushed periodically in one transaction.

use crate::{Db, Result};
use rusqlite::{params, Connection, Transaction};
use std::collections::BTreeMap;

/// Most events held in a [`UsageBuffer`]; beyond this the oldest are dropped.
pub const MAX_PENDING_EVENTS: usize = 10_000;
/// Most distinct keys with pending usage in a [`UsageBuffer`]; uses of further keys only
/// count in [`UsageBuffer::dropped`] until the next flush.
pub const MAX_PENDING_KEYS: usize = 4_096;

/// Column limits of `api_key_event` / `api_key_usage` (characters).
const TOOL_MAX: usize = 64;
const PATH_MAX: usize = 1024;
const IP_MAX: usize = 45;

/// `api_key_usage` row.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct KeyUsage {
    pub last_used: i64,
    pub last_ip: Option<String>,
    pub use_count: u64,
}

/// `api_key_event` row. `id` is `None` until stored.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct KeyEvent {
    pub id: Option<i64>,
    pub key_id: String,
    pub at: i64,
    pub ip: Option<String>,
    /// MCP tool or HTTP route name, 1-64 chars.
    pub tool: String,
    pub path: Option<String>,
}

/// In-memory buffer of uses not yet written, bounded by [`MAX_PENDING_EVENTS`] and
/// [`MAX_PENDING_KEYS`]; strings are cut to the column limits on record.
#[derive(Debug, Default)]
pub struct UsageBuffer {
    /// Per key: uses since the last flush (`use_count` is the delta), last time and IP.
    pub pending_usage: BTreeMap<String, KeyUsage>,
    pub pending_events: Vec<KeyEvent>,
    /// Uses or events discarded because a bound was hit (since this buffer was created).
    pub dropped: u64,
}

fn cut(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_string(),
        None => s.to_string(),
    }
}

fn clean_ip(ip: Option<String>) -> Option<String> {
    ip.filter(|s| !s.is_empty() && s.chars().count() <= IP_MAX)
}

fn clean_tool(tool: &str) -> String {
    if tool.is_empty() {
        "unknown".to_string()
    } else {
        cut(tool, TOOL_MAX)
    }
}

impl UsageBuffer {
    /// Record one use. No I/O. A use without an IP keeps the last known IP in the usage
    /// row.
    pub fn record(
        &mut self,
        key_id: &str,
        ip: Option<String>,
        tool: &str,
        path: Option<String>,
        now: i64,
    ) {
        let ip = clean_ip(ip);
        if self.pending_usage.len() >= MAX_PENDING_KEYS && !self.pending_usage.contains_key(key_id)
        {
            self.dropped += 1;
            return;
        }
        let u = self.pending_usage.entry(key_id.to_string()).or_default();
        u.last_used = u.last_used.max(now);
        if ip.is_some() {
            u.last_ip = ip.clone();
        }
        u.use_count += 1;
        if self.pending_events.len() >= MAX_PENDING_EVENTS {
            // Drop the oldest tenth at once, so a full buffer costs O(1) amortised.
            let n = (MAX_PENDING_EVENTS / 10).max(1);
            self.pending_events.drain(..n);
            self.dropped += n as u64;
        }
        self.pending_events.push(KeyEvent {
            id: None,
            key_id: key_id.to_string(),
            at: now,
            ip,
            tool: clean_tool(tool),
            path: path.map(|p| cut(&p, PATH_MAX)),
        });
    }

    /// True when buffered events already show `ip` for `key_id` (complements
    /// [`is_new_ip`], which only sees flushed events; [`is_new_ip_buffered`] combines both).
    pub fn has_ip(&self, key_id: &str, ip: &str) -> bool {
        self.pending_events
            .iter()
            .any(|e| e.key_id == key_id && e.ip.as_deref() == Some(ip))
    }

    /// True when buffered events of `key_id` carry any IP.
    pub fn has_any_ip(&self, key_id: &str) -> bool {
        self.pending_events
            .iter()
            .any(|e| e.key_id == key_id && e.ip.is_some())
    }

    pub fn is_empty(&self) -> bool {
        self.pending_usage.is_empty() && self.pending_events.is_empty()
    }

    /// Move everything out (leaving this buffer empty, `dropped` included), so the caller
    /// can release its lock before [`flush`](Self::flush)ing the returned batch.
    pub fn take(&mut self) -> UsageBuffer {
        std::mem::take(self)
    }

    /// Put a batch back (after a failed flush), respecting the bounds. `other`'s events
    /// are older than this buffer's.
    pub fn merge(&mut self, mut other: UsageBuffer) {
        self.dropped += other.dropped;
        for (k, u) in std::mem::take(&mut other.pending_usage) {
            if let Some(cur) = self.pending_usage.get_mut(&k) {
                cur.use_count += u.use_count;
                if cur.last_ip.is_none() {
                    cur.last_ip = u.last_ip;
                }
                cur.last_used = cur.last_used.max(u.last_used);
            } else if self.pending_usage.len() < MAX_PENDING_KEYS {
                self.pending_usage.insert(k, u);
            } else {
                self.dropped += u.use_count;
            }
        }
        other.pending_events.append(&mut self.pending_events);
        if other.pending_events.len() > MAX_PENDING_EVENTS {
            let n = other.pending_events.len() - MAX_PENDING_EVENTS;
            other.pending_events.drain(..n);
            self.dropped += n as u64;
        }
        self.pending_events = other.pending_events;
    }

    /// Write everything buffered in one transaction and clear the buffer; on error the buffer
    /// is left unchanged. Usage of purged keys is dropped. Returns rows written.
    pub fn flush(&mut self, db: &Db) -> Result<usize> {
        if self.is_empty() {
            return Ok(0);
        }
        let n = db.write(|tx| write_batch(tx, &self.pending_usage, &self.pending_events))?;
        self.pending_usage.clear();
        self.pending_events.clear();
        Ok(n)
    }
}

/// Upsert usage deltas and insert events (the body of [`UsageBuffer::flush`]), skipping
/// unknown key ids.
pub fn write_batch(
    tx: &Transaction<'_>,
    usage: &BTreeMap<String, KeyUsage>,
    events: &[KeyEvent],
) -> Result<usize> {
    let mut written = 0;
    let mut up = tx.prepare_cached(
        "INSERT INTO api_key_usage (key_id, last_used, last_ip, use_count)
         SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM api_key WHERE id = ?1)
         ON CONFLICT(key_id) DO UPDATE SET
           last_used = max(last_used, excluded.last_used),
           last_ip   = coalesce(excluded.last_ip, last_ip),
           use_count = use_count + excluded.use_count",
    )?;
    for (key_id, u) in usage {
        let count = i64::try_from(u.use_count).unwrap_or(i64::MAX);
        written += up.execute(params![
            key_id,
            u.last_used,
            clean_ip(u.last_ip.clone()),
            count
        ])?;
    }
    let mut ev = tx.prepare_cached(
        "INSERT INTO api_key_event (key_id, at, ip, tool, path)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM api_key WHERE id = ?1)",
    )?;
    for e in events {
        written += ev.execute(params![
            e.key_id,
            e.at,
            clean_ip(e.ip.clone()),
            clean_tool(&e.tool),
            e.path.as_deref().map(|p| cut(p, PATH_MAX)),
        ])?;
    }
    Ok(written)
}

fn usage_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<KeyUsage> {
    Ok(KeyUsage {
        last_used: r.get(0)?,
        last_ip: r.get(1)?,
        use_count: r.get::<_, i64>(2)?.max(0) as u64,
    })
}

/// Usage of every key that has been used.
pub fn all_usage(conn: &Connection) -> Result<BTreeMap<String, KeyUsage>> {
    let mut st =
        conn.prepare_cached("SELECT last_used, last_ip, use_count, key_id FROM api_key_usage")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(3)?, usage_row(r)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Usage of one key.
pub fn usage(conn: &Connection, key_id: &str) -> Result<Option<KeyUsage>> {
    use rusqlite::OptionalExtension;
    let mut st = conn.prepare_cached(
        "SELECT last_used, last_ip, use_count FROM api_key_usage WHERE key_id = ?1",
    )?;
    Ok(st.query_row([key_id], usage_row).optional()?)
}

/// Newest `limit` events of one key, newest first (index `api_key_event_key_at`).
pub fn events_for_key(conn: &Connection, key_id: &str, limit: usize) -> Result<Vec<KeyEvent>> {
    let mut st = conn.prepare_cached(
        "SELECT id, key_id, at, ip, tool, path FROM api_key_event
         WHERE key_id = ?1 ORDER BY at DESC, id DESC LIMIT ?2",
    )?;
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);
    let rows = st.query_map(params![key_id, limit], |r| {
        Ok(KeyEvent {
            id: r.get(0)?,
            key_id: r.get(1)?,
            at: r.get(2)?,
            ip: r.get(3)?,
            tool: r.get(4)?,
            path: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Anomaly flag: the key has stored events with an IP, none from `ip`.
pub fn is_new_ip(conn: &Connection, key_id: &str, ip: &str) -> Result<bool> {
    let (any, seen): (bool, bool) = conn
        .prepare_cached(
            "SELECT EXISTS (SELECT 1 FROM api_key_event WHERE key_id = ?1 AND ip >= ''),
                    EXISTS (SELECT 1 FROM api_key_event WHERE key_id = ?1 AND ip = ?2)",
        )?
        .query_row(params![key_id, ip], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(any && !seen)
}

/// [`is_new_ip`] over stored *and* buffered events: some IP is known for the key and `ip`
/// is not among them.
pub fn is_new_ip_buffered(
    conn: &Connection,
    buf: &UsageBuffer,
    key_id: &str,
    ip: &str,
) -> Result<bool> {
    if buf.has_ip(key_id, ip) {
        return Ok(false);
    }
    if is_new_ip(conn, key_id, ip)? {
        return Ok(true);
    }
    // Not new in the DB: either seen there, or the DB has no IP for the key at all.
    let any_stored: bool = conn
        .prepare_cached(
            "SELECT EXISTS (SELECT 1 FROM api_key_event WHERE key_id = ?1 AND ip >= '')",
        )?
        .query_row([key_id], |r| r.get(0))?;
    if any_stored {
        // Stored IPs exist and is_new_ip said "not new", so ip was seen.
        return Ok(false);
    }
    Ok(buf.has_any_ip(key_id))
}
