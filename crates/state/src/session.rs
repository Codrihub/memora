//! Browser sessions (`session`), keyed by `sha256(sid)` hex. Each request does a PK
//! [`lookup`]; `last_seen` writes are buffered ([`LastSeenBuffer`]) to once a minute.

use crate::{Db, Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::collections::BTreeMap;

/// Most sessions kept at once; the oldest by `last_seen` is dropped beyond this.
pub const MAX_SESSIONS: usize = 1000;
/// Shortest `sid_hash` prefix the CLI may use to select a session.
pub const MIN_PREFIX_LEN: usize = 8;
/// `last_seen` is persisted at most this often per session (seconds).
pub const LAST_SEEN_EVERY: i64 = 60;

/// Length of a `sid_hash` (sha256 hex).
const HASH_LEN: usize = 64;
const MAX_SOURCE: usize = 32;
const MAX_ALIAS: usize = 64;
const MAX_IP: usize = 45;
const MAX_USER_AGENT: usize = 300;

const COLUMNS: &str = "sid_hash, source, alias, ip, user_agent, created_at, last_seen";

/// One `session` row.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Session {
    pub sid_hash: String,
    /// Where it was created (`password`, `setup`, ...), 1-32 chars.
    pub source: String,
    pub alias: Option<String>,
    pub ip: Option<String>,
    /// Browser / device, at most 300 chars.
    pub user_agent: Option<String>,
    pub created_at: i64,
    pub last_seen: i64,
}

impl Session {
    /// Alive under the idle `ttl` and absolute `max_age` (0 = none) at `now`.
    pub fn is_live(&self, ttl: i64, max_age: i64, now: i64) -> bool {
        now - self.last_seen <= ttl && !(max_age > 0 && now - self.created_at > max_age)
    }

    /// Seconds left before the idle timeout.
    pub fn remaining(&self, ttl: i64, now: i64) -> i64 {
        (self.last_seen + ttl - now).max(0)
    }

    /// The short id shown to operators (`/sessions`) and accepted by [`revoke_prefix`].
    pub fn short_id(&self) -> &str {
        &self.sid_hash[..MIN_PREFIX_LEN.min(self.sid_hash.len())]
    }

    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Session {
            sid_hash: r.get(0)?,
            source: r.get(1)?,
            alias: r.get(2)?,
            ip: r.get(3)?,
            user_agent: r.get(4)?,
            created_at: r.get(5)?,
            last_seen: r.get(6)?,
        })
    }
}

/// Input for [`create`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSession {
    pub sid_hash: String,
    pub source: String,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
}

fn is_lower_hex(s: &str) -> bool {
    s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn valid_hash(s: &str) -> bool {
    s.len() == HASH_LEN && is_lower_hex(s)
}

fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Insert a session for the owner, pruning expired ones and enforcing [`MAX_SESSIONS`].
/// `Error::Invalid` for malformed input; the user agent is truncated to 300 chars.
pub fn create(
    tx: &Transaction<'_>,
    new: &NewSession,
    ttl: i64,
    max_age: i64,
    now: i64,
) -> Result<Session> {
    if !valid_hash(&new.sid_hash) {
        return Err(Error::invalid(
            "sid_hash",
            "expected 64 lowercase hex chars (sha256)",
        ));
    }
    let source_len = new.source.chars().count();
    if source_len == 0 || source_len > MAX_SOURCE {
        return Err(Error::invalid(
            "source",
            format!("must be 1-{MAX_SOURCE} chars"),
        ));
    }
    if new
        .ip
        .as_deref()
        .is_some_and(|ip| ip.chars().count() > MAX_IP)
    {
        return Err(Error::invalid("ip", format!("longer than {MAX_IP} chars")));
    }
    prune(tx, ttl, max_age, now)?;
    let count: i64 = tx.query_row("SELECT count(*) FROM session", [], |r| r.get(0))?;
    let excess = count - MAX_SESSIONS as i64 + 1;
    if excess > 0 {
        tx.execute(
            "DELETE FROM session WHERE sid_hash IN
               (SELECT sid_hash FROM session ORDER BY last_seen, created_at, sid_hash LIMIT ?1)",
            [excess],
        )?;
    }
    let session = Session {
        sid_hash: new.sid_hash.clone(),
        source: new.source.clone(),
        alias: None,
        ip: new.ip.clone(),
        user_agent: new
            .user_agent
            .as_deref()
            .map(|a| truncate(a, MAX_USER_AGENT)),
        created_at: now,
        last_seen: now,
    };
    tx.execute(
        "INSERT INTO session (sid_hash, owner_id, source, ip, user_agent, created_at, last_seen)
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?5)",
        params![
            session.sid_hash,
            session.source,
            session.ip,
            session.user_agent,
            now
        ],
    )?;
    Ok(session)
}

/// The live session with this hash, if any (no write; a malformed hash finds nothing).
/// Combine with [`LastSeenBuffer`] for the sliding window.
pub fn lookup(
    conn: &Connection,
    sid_hash: &str,
    ttl: i64,
    max_age: i64,
    now: i64,
) -> Result<Option<Session>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM session
         WHERE sid_hash = ?1 AND last_seen >= ?2 - ?3
           AND (?4 <= 0 OR created_at >= ?2 - ?4)"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    Ok(stmt
        .query_row(params![sid_hash, now, ttl, max_age], Session::from_row)
        .optional()?)
}

/// Every session, newest `last_seen` first (CLI / settings page).
pub fn list(conn: &Connection) -> Result<Vec<Session>> {
    let sql =
        format!("SELECT {COLUMNS} FROM session ORDER BY last_seen DESC, created_at DESC, sid_hash");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], Session::from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Set the browser / device; truncated to 300 chars. A session that is gone (logged out
/// meanwhile) is silently ignored.
pub fn set_user_agent(
    tx: &Transaction<'_>,
    sid_hash: &str,
    user_agent: Option<&str>,
) -> Result<()> {
    let ua = user_agent.map(|a| truncate(a, MAX_USER_AGENT));
    tx.execute(
        "UPDATE session SET user_agent = ?2 WHERE sid_hash = ?1",
        params![sid_hash, ua],
    )?;
    Ok(())
}

/// Name a device. `Error::Invalid` over 64 chars (an empty alias clears it),
/// `Error::NotFound` when the session does not exist.
pub fn set_alias(tx: &Transaction<'_>, sid_hash: &str, alias: Option<&str>) -> Result<()> {
    let alias = alias.map(str::trim).filter(|a| !a.is_empty());
    if alias.is_some_and(|a| a.chars().count() > MAX_ALIAS) {
        return Err(Error::invalid(
            "alias",
            format!("longer than {MAX_ALIAS} chars"),
        ));
    }
    let n = tx.execute(
        "UPDATE session SET alias = ?2 WHERE sid_hash = ?1",
        params![sid_hash, alias],
    )?;
    if n == 0 {
        return Err(Error::NotFound("session".into()));
    }
    Ok(())
}

/// Write buffered `last_seen` values (never moves one backwards). Sessions deleted
/// meanwhile are skipped. Returns rows updated.
pub fn touch_many(tx: &Transaction<'_>, last_seen: &BTreeMap<String, i64>) -> Result<usize> {
    let mut stmt = tx.prepare_cached(
        "UPDATE session SET last_seen = ?2 WHERE sid_hash = ?1 AND last_seen < ?2",
    )?;
    let mut n = 0;
    for (sid_hash, at) in last_seen {
        n += stmt.execute(params![sid_hash, at])?;
    }
    Ok(n)
}

/// Browser logout. Returns true if a row was deleted.
pub fn revoke(tx: &Transaction<'_>, sid_hash: &str) -> Result<bool> {
    Ok(tx.execute("DELETE FROM session WHERE sid_hash = ?1", [sid_hash])? > 0)
}

/// Delete every session. Returns how many.
pub fn revoke_all(tx: &Transaction<'_>) -> Result<usize> {
    Ok(tx.execute("DELETE FROM session", [])?)
}

/// Delete every session except `keep_sid_hash` (after a password change).
pub fn revoke_others(tx: &Transaction<'_>, keep_sid_hash: &str) -> Result<usize> {
    Ok(tx.execute("DELETE FROM session WHERE sid_hash <> ?1", [keep_sid_hash])?)
}

/// CLI sign-out by `sid_hash` prefix ([`MIN_PREFIX_LEN`]..=64 hex). An ambiguous prefix
/// is `Error::Conflict`. Returns how many ended (1 or 0).
pub fn revoke_prefix(tx: &Transaction<'_>, prefix: &str) -> Result<usize> {
    let prefix = prefix.trim().to_ascii_lowercase();
    if prefix.len() < MIN_PREFIX_LEN || prefix.len() > HASH_LEN || !is_lower_hex(&prefix) {
        return Err(Error::invalid(
            "session id",
            format!("expected {MIN_PREFIX_LEN}-{HASH_LEN} hex chars"),
        ));
    }
    // Hex sorts below 'g', so [prefix, prefix || 'g') is exactly the prefix range: a
    // primary-key range scan, no LIKE (whose '_' / '%' would need escaping).
    let matches: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT sid_hash FROM session WHERE sid_hash >= ?1 AND sid_hash < ?1 || 'g' LIMIT 2",
        )?;
        let rows = stmt.query_map([&prefix], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    match matches.as_slice() {
        [] => Ok(0),
        [one] => Ok(tx.execute("DELETE FROM session WHERE sid_hash = ?1", [one])?),
        _ => Err(Error::Conflict(format!(
            "session id {prefix} matches more than one session; use more characters"
        ))),
    }
}

/// Delete sessions idle longer than `ttl` or older than `max_age` (0 = none).
pub fn prune(tx: &Transaction<'_>, ttl: i64, max_age: i64, now: i64) -> Result<usize> {
    let mut n = tx.execute(
        "DELETE FROM session WHERE last_seen < ?1 - ?2",
        params![now, ttl],
    )?;
    if max_age > 0 {
        n += tx.execute(
            "DELETE FROM session WHERE created_at < ?1 - ?2",
            params![now, max_age],
        )?;
    }
    Ok(n)
}

/// How long the reason a session was ended is remembered (seconds), so a browser that
/// still holds the dead cookie can be told why it was signed out.
pub const REVOKED_REASON_TTL: i64 = 7 * 24 * 3600;
/// Most remembered reasons; the oldest are dropped beyond this.
const MAX_REVOKED_REASONS: usize = 2 * MAX_SESSIONS;
/// Longest reason code kept.
const MAX_REASON: usize = 48;

/// `sid_hash` -> (reason code, when). Process memory only: after a restart a dead
/// cookie is simply "signed out" without a reason.
static REVOKED: std::sync::Mutex<BTreeMap<String, (String, i64)>> =
    std::sync::Mutex::new(BTreeMap::new());

fn revoked_map() -> std::sync::MutexGuard<'static, BTreeMap<String, (String, i64)>> {
    REVOKED.lock().unwrap_or_else(|e| e.into_inner())
}

/// Remember why these sessions were ended (`reason` is a short code such as
/// `password_changed`). Call after the rows were deleted.
pub fn remember_revoked<I>(sid_hashes: I, reason: &str, now: i64)
where
    I: IntoIterator<Item = String>,
{
    let reason: String = reason.chars().take(MAX_REASON).collect();
    let mut m = revoked_map();
    m.retain(|_, (_, at)| now - *at <= REVOKED_REASON_TTL);
    for h in sid_hashes {
        if valid_hash(&h) {
            m.insert(h, (reason.clone(), now));
        }
    }
    if m.len() > MAX_REVOKED_REASONS {
        let mut by_age: Vec<(i64, String)> =
            m.iter().map(|(k, (_, at))| (*at, k.clone())).collect();
        by_age.sort();
        let excess = m.len() - MAX_REVOKED_REASONS;
        for (_, k) in by_age.into_iter().take(excess) {
            m.remove(&k);
        }
    }
}

/// Why the session with this hash was ended, if it was ended on purpose within
/// [`REVOKED_REASON_TTL`].
pub fn revoked_reason(sid_hash: &str, now: i64) -> Option<String> {
    let m = revoked_map();
    m.get(sid_hash)
        .filter(|(_, at)| now - *at <= REVOKED_REASON_TTL)
        .map(|(r, _)| r.clone())
}

/// Pending `last_seen` updates (sid_hash -> time), at most [`MAX_SESSIONS`] entries.
#[derive(Debug, Default)]
pub struct LastSeenBuffer {
    pub pending: BTreeMap<String, i64>,
}

impl LastSeenBuffer {
    /// Note a request on `session`; buffers an update when the stored `last_seen` is at least
    /// [`LAST_SEEN_EVERY`] seconds old. Returns true if buffered.
    pub fn note(&mut self, session: &Session, now: i64) -> bool {
        if let Some(at) = self.pending.get_mut(&session.sid_hash) {
            *at = (*at).max(now);
            return true;
        }
        if now - session.last_seen < LAST_SEEN_EVERY || self.pending.len() >= MAX_SESSIONS {
            return false;
        }
        self.pending.insert(session.sid_hash.clone(), now);
        true
    }

    /// [`touch_many`] in one transaction and clear. Returns rows written. On error the
    /// pending updates are kept for the next flush.
    pub fn flush(&mut self, db: &Db) -> Result<usize> {
        if self.pending.is_empty() {
            return Ok(0);
        }
        let batch = std::mem::take(&mut self.pending);
        match db.write(|tx| touch_many(tx, &batch)) {
            Ok(n) => Ok(n),
            Err(e) => {
                for (sid, at) in batch {
                    let slot = self.pending.entry(sid).or_insert(at);
                    *slot = (*slot).max(at);
                }
                Err(e)
            }
        }
    }
}
