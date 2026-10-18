//! Pruning of logs, events and expired sessions (docs/DATABASE.md section 5,
//! "Retention"). Run hourly by the server in small batches, and by `memora-cli db vacuum`.
use crate::{keys, Db, Result};
use rusqlite::{params, Transaction};

/// Retention limits; `Default` is the documented policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionPolicy {
    /// `activity`: keep this many days ...
    pub activity_days: i64,
    /// ... and at most this many rows (whichever keeps less).
    pub activity_max_rows: i64,
    pub key_event_days: i64,
    pub key_event_max_rows: i64,
    /// Hard-delete trashed keys this many days after `deleted_at`.
    pub key_trash_days: i64,
    /// Delete done control requests this long after `done_at` (seconds).
    pub control_done_secs: i64,
    /// Mark un-acked control requests `result='expired'` after this long (seconds).
    pub control_expire_secs: i64,
    /// Rows deleted per statement, so a prune never holds the write lock for long.
    pub batch: i64,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            activity_days: 365,
            activity_max_rows: 200_000,
            key_event_days: 30,
            key_event_max_rows: 100_000,
            key_trash_days: 90,
            control_done_secs: 86_400,
            control_expire_secs: 3_600,
            batch: 5_000,
        }
    }
}

/// Rows affected per table by one prune.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct PruneReport {
    pub activity: usize,
    pub key_events: usize,
    pub sessions: usize,
    pub keys_purged: usize,
    pub control_deleted: usize,
    pub control_expired: usize,
}

impl PruneReport {
    /// Rows touched in total.
    pub fn total(&self) -> usize {
        self.activity
            + self.key_events
            + self.sessions
            + self.keys_purged
            + self.control_deleted
            + self.control_expired
    }

    fn add(&mut self, o: &PruneReport) {
        self.activity += o.activity;
        self.key_events += o.key_events;
        self.sessions += o.sessions;
        self.keys_purged += o.keys_purged;
        self.control_deleted += o.control_deleted;
        self.control_expired += o.control_expired;
    }
}

/// Delete at most `batch` rows of `table` that are older than `cutoff` (`at < cutoff`)
/// or beyond the newest `max_rows` (ordered by `at DESC, id DESC`). `table` is a constant.
fn prune_log(
    tx: &Transaction<'_>,
    table: &str,
    cutoff: i64,
    max_rows: i64,
    batch: i64,
) -> Result<usize> {
    // The (at, id) of the oldest row still inside the row cap, if the table exceeds it.
    let keep_from: Option<(i64, i64)> = if max_rows > 0 {
        let mut stmt = tx.prepare_cached(&format!(
            "SELECT at, id FROM {table} ORDER BY at DESC, id DESC LIMIT 1 OFFSET ?1"
        ))?;
        let mut rows = stmt.query(params![max_rows - 1])?;
        match rows.next()? {
            Some(r) => Some((r.get(0)?, r.get(1)?)),
            None => None,
        }
    } else {
        None
    };
    let n = match keep_from {
        Some((at, id)) => tx.execute(
            &format!(
                "DELETE FROM {table} WHERE id IN (SELECT id FROM {table}
                   WHERE at < ?1 OR at < ?2 OR (at = ?2 AND id < ?3) LIMIT ?4)"
            ),
            params![cutoff, at, id, batch],
        )?,
        None => tx.execute(
            &format!(
                "DELETE FROM {table} WHERE id IN (SELECT id FROM {table} WHERE at < ?1 LIMIT ?2)"
            ),
            params![cutoff, batch],
        )?,
    };
    Ok(n)
}

const DAY: i64 = 86_400;

/// One bounded pass (at most `policy.batch` rows per table) in `tx`. Sessions use the
/// `session_ttl` / `session_max_age` from `settings`.
///
/// Trashed keys are hard-deleted through [`keys::purge`] (which cascades their scopes,
/// tools, usage and events), at most `batch` keys per pass.
pub fn prune_batch(
    tx: &Transaction<'_>,
    policy: &RetentionPolicy,
    now: i64,
) -> Result<PruneReport> {
    let batch = policy.batch.max(1);
    let mut rep = PruneReport {
        activity: prune_log(
            tx,
            "activity",
            now - policy.activity_days * DAY,
            policy.activity_max_rows,
            batch,
        )?,
        key_events: prune_log(
            tx,
            "api_key_event",
            now - policy.key_event_days * DAY,
            policy.key_event_max_rows,
            batch,
        )?,
        ..Default::default()
    };

    // Sessions: same rule as `session::Session::is_live` (idle > ttl, or age > max_age).
    let (ttl, max_age): (i64, i64) = tx.query_row(
        "SELECT session_ttl, session_max_age FROM settings WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    rep.sessions = tx.execute(
        "DELETE FROM session WHERE sid_hash IN (SELECT sid_hash FROM session
           WHERE ?1 - last_seen > ?2 OR (?3 > 0 AND ?1 - created_at > ?3) LIMIT ?4)",
        params![now, ttl, max_age, batch],
    )?;

    // Trash: hard delete `key_trash_days` after `deleted_at`.
    let ids: Vec<String> = {
        let mut stmt = tx.prepare_cached(
            "SELECT id FROM api_key WHERE deleted_at IS NOT NULL AND deleted_at < ?1
             ORDER BY deleted_at LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![now - policy.key_trash_days * DAY, batch], |r| {
            r.get(0)
        })?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for id in &ids {
        if keys::purge(tx, id)? {
            rep.keys_purged += 1;
        }
    }

    // Control requests: expire un-acked ones, delete old done ones.
    rep.control_expired = tx.execute(
        "UPDATE control_request SET done_at = ?1, result = 'expired'
         WHERE id IN (SELECT id FROM control_request
                      WHERE done_at IS NULL AND requested_at < ?2 LIMIT ?3)",
        params![now, now - policy.control_expire_secs, batch],
    )?;
    rep.control_deleted = tx.execute(
        "DELETE FROM control_request WHERE id IN (SELECT id FROM control_request
           WHERE done_at IS NOT NULL AND done_at < ?1 LIMIT ?2)",
        params![now - policy.control_done_secs, batch],
    )?;
    Ok(rep)
}

/// Repeat [`prune_batch`], one short transaction each, until nothing is left to prune
/// (a pass in which no table reached `policy.batch`). Other writers get the lock between
/// passes.
pub fn prune(db: &Db, policy: &RetentionPolicy, now: i64) -> Result<PruneReport> {
    let batch = usize::try_from(policy.batch.max(1)).unwrap_or(usize::MAX);
    let mut total = PruneReport::default();
    loop {
        let rep = db.write(|tx| prune_batch(tx, policy, now))?;
        total.add(&rep);
        let more = [
            rep.activity,
            rep.key_events,
            rep.sessions,
            rep.keys_purged,
            rep.control_deleted,
            rep.control_expired,
        ]
        .iter()
        .any(|&n| n >= batch);
        if !more {
            return Ok(total);
        }
    }
}
