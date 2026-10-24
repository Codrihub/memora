//! Requests from `memora-cli` to the running server for server-memory state
//! (`control_request`). Unanswered requests are marked [`EXPIRED`] so they never run late.

use crate::{Db, Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::str::FromStr;
use std::time::{Duration, Instant};

/// `result` of a request that timed out in [`wait_for_ack`] without a server answer.
pub const EXPIRED: &str = "expired";
/// How often [`wait_for_ack`] polls.
const POLL_EVERY: Duration = Duration::from_millis(50);
const MAX_REQUESTED_BY: usize = 64;
const MAX_RESULT: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlKind {
    /// Clear rate-limit buckets and login cooldowns.
    LimiterReset,
    /// Reload every cache regardless of revisions.
    ReloadAll,
}

impl ControlKind {
    pub const ALL: [ControlKind; 2] = [ControlKind::LimiterReset, ControlKind::ReloadAll];

    pub fn as_str(self) -> &'static str {
        match self {
            ControlKind::LimiterReset => "limiter_reset",
            ControlKind::ReloadAll => "reload_all",
        }
    }
}

impl FromStr for ControlKind {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        ControlKind::ALL
            .into_iter()
            .find(|k| k.as_str() == s)
            .ok_or_else(|| Error::invalid("control kind", s.to_string()))
    }
}

/// One `control_request` row.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ControlRequest {
    pub id: i64,
    pub kind: ControlKind,
    pub requested_at: i64,
    /// e.g. `cli:root`, 1-64 chars.
    pub requested_by: String,
    pub done_at: Option<i64>,
    /// e.g. `cleared 3 cooldowns`, `expired`; at most 500 chars.
    pub result: Option<String>,
}

impl ControlRequest {
    /// True when this request was answered by a server (not merely expired).
    pub fn acknowledged(&self) -> bool {
        self.done_at.is_some() && self.result.as_deref() != Some(EXPIRED)
    }

    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        let kind: String = r.get(1)?;
        let kind = kind.parse().map_err(|e: Error| {
            rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(e))
        })?;
        Ok(ControlRequest {
            id: r.get(0)?,
            kind,
            requested_at: r.get(2)?,
            requested_by: r.get(3)?,
            done_at: r.get(4)?,
            result: r.get(5)?,
        })
    }
}

const COLUMNS: &str = "id, kind, requested_at, requested_by, done_at, result";

/// Queue a request; returns its id. `Error::Invalid` when `requested_by` is not 1-64
/// chars.
pub fn request(
    tx: &Transaction<'_>,
    kind: ControlKind,
    requested_by: &str,
    now: i64,
) -> Result<i64> {
    let len = requested_by.chars().count();
    if len == 0 || len > MAX_REQUESTED_BY {
        return Err(Error::invalid(
            "requested_by",
            format!("must be 1-{MAX_REQUESTED_BY} chars"),
        ));
    }
    tx.execute(
        "INSERT INTO control_request (kind, requested_at, requested_by) VALUES (?1, ?2, ?3)",
        params![kind.as_str(), now, requested_by],
    )?;
    Ok(tx.last_insert_rowid())
}

/// Requests not yet done, oldest first (index `control_request_pending`).
pub fn pending(conn: &Connection) -> Result<Vec<ControlRequest>> {
    let sql = format!("SELECT {COLUMNS} FROM control_request WHERE done_at IS NULL ORDER BY id");
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map([], ControlRequest::from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: i64) -> Result<Option<ControlRequest>> {
    let sql = format!("SELECT {COLUMNS} FROM control_request WHERE id = ?1");
    Ok(conn
        .query_row(&sql, [id], ControlRequest::from_row)
        .optional()?)
}

/// Mark done with a short result (server side; truncated to 500 chars). The first
/// completion wins. `Error::NotFound` for an unknown id.
pub fn complete(tx: &Transaction<'_>, id: i64, result: &str, now: i64) -> Result<()> {
    let result: String = result.chars().take(MAX_RESULT).collect();
    let n = tx.execute(
        "UPDATE control_request SET done_at = ?2, result = ?3 WHERE id = ?1 AND done_at IS NULL",
        params![id, now, result],
    )?;
    if n == 0 {
        let exists: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM control_request WHERE id = ?1)",
            [id],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(Error::NotFound(format!("control request {id}")));
        }
    }
    Ok(())
}

/// Poll request `id` until done or `timeout` (CLI side). `None` = no server answered; the
/// request is then marked [`EXPIRED`]. `Error::NotFound` for an unknown id.
pub fn wait_for_ack(db: &Db, id: i64, timeout: Duration) -> Result<Option<ControlRequest>> {
    let deadline = Instant::now() + timeout;
    loop {
        let req = db
            .read(|c| get(c, id))?
            .ok_or_else(|| Error::NotFound(format!("control request {id}")))?;
        if req.done_at.is_some() {
            return Ok(req.acknowledged().then_some(req));
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        std::thread::sleep(left.min(POLL_EVERY));
    }
    // Expire it unless the server completed it meanwhile (same transaction, one outcome).
    db.write(|tx| {
        complete(tx, id, EXPIRED, crate::now())?;
        let req = get(tx, id)?.ok_or_else(|| Error::NotFound(format!("control request {id}")))?;
        Ok(req.acknowledged().then_some(req))
    })
}
