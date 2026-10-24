//! Setup / reset window, LOCKED state and the last burned window (`arm_state`, one row).
//! Setup codes arrive as sha256 hex; an expired window only closes, never locks.

use crate::{Error, Result};
use rusqlite::{params, Connection, Transaction};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArmMode {
    Bootstrap,
    Reset,
}

impl ArmMode {
    pub fn as_str(self) -> &'static str {
        match self {
            ArmMode::Bootstrap => "bootstrap",
            ArmMode::Reset => "reset",
        }
    }

    /// Inverse of [`ArmMode::as_str`].
    pub fn parse(s: &str) -> Option<ArmMode> {
        match s {
            "bootstrap" => Some(ArmMode::Bootstrap),
            "reset" => Some(ArmMode::Reset),
            _ => None,
        }
    }
}

/// Allowed window lengths in seconds (schema CHECK).
pub const TTL_RANGE: std::ops::RangeInclusive<i64> = 30..=86400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArmStatus {
    Idle,
    Armed,
    Locked,
}

/// The `arm_state` row without the code hash.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ArmWindow {
    pub status: ArmStatus,
    /// Set while armed, and kept after the window expired unused (see
    /// [`ArmWindow::expired`]) until the next window, disarm or burn.
    pub mode: Option<ArmMode>,
    pub armed_at: Option<i64>,
    pub ttl: Option<i64>,
    /// Set while locked.
    pub locked_at: Option<i64>,
    /// The last voided window, until a new window opens.
    pub last_burn: Option<ArmBurn>,
}

impl ArmWindow {
    /// Seconds left in an open window, 0 otherwise.
    pub fn remaining(&self, now: i64) -> i64 {
        match (self.status, self.armed_at, self.ttl) {
            (ArmStatus::Armed, Some(at), Some(ttl)) => (at + ttl - now).max(0),
            _ => 0,
        }
    }

    /// The mode of a window that expired before it was used, while no other window is
    /// open (the instance is idle). Display only: nothing is locked.
    pub fn expired(&self) -> Option<ArmMode> {
        match (self.status, self.armed_at, self.ttl) {
            (ArmStatus::Idle, Some(_), Some(_)) => self.mode,
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ArmBurn {
    pub at: i64,
    pub ip: String,
    pub mode: Option<ArmMode>,
}

/// Result of [`verify_code`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeCheck {
    /// Matches the open window.
    Valid,
    /// A window is open but the code is wrong (caller then calls [`burn`]).
    Wrong,
    /// No open window (idle, locked, or expired): fails closed.
    NoWindow,
}

fn mode_from_sql(v: Option<String>) -> rusqlite::Result<Option<ArmMode>> {
    match v {
        None => Ok(None),
        Some(s) => ArmMode::parse(&s).map(Some).ok_or_else(|| bad_text(s)),
    }
}

fn bad_text(s: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        format!("unexpected arm_state value {s:?}").into(),
    )
}

/// Read the row as stored (no expiry applied).
pub fn get(conn: &Connection) -> Result<ArmWindow> {
    Ok(conn.query_row(
        "SELECT state, mode, armed_at, ttl, locked_at, burned_at, burned_ip, burned_mode
         FROM arm_state WHERE id = 1",
        [],
        |r| {
            let status = match r.get::<_, String>(0)?.as_str() {
                "idle" => ArmStatus::Idle,
                "armed" => ArmStatus::Armed,
                "locked" => ArmStatus::Locked,
                other => return Err(bad_text(other.to_string())),
            };
            let burned_at: Option<i64> = r.get(5)?;
            let burned_ip: Option<String> = r.get(6)?;
            let burned_mode = mode_from_sql(r.get(7)?)?;
            Ok(ArmWindow {
                status,
                mode: mode_from_sql(r.get(1)?)?,
                armed_at: r.get(2)?,
                ttl: r.get(3)?,
                locked_at: r.get(4)?,
                last_burn: match (burned_at, burned_ip) {
                    (Some(at), Some(ip)) => Some(ArmBurn {
                        at,
                        ip,
                        mode: burned_mode,
                    }),
                    _ => None,
                },
            })
        },
    )?)
}

/// Close an expired window: back to idle with the code dropped; mode, `armed_at` and `ttl`
/// stay for display. Also lifts a legacy expiry lock. Returns true if a row changed.
pub fn expire(tx: &Transaction<'_>, now: i64) -> Result<bool> {
    let n = tx.execute(
        "UPDATE arm_state SET state = 'idle', locked_at = NULL, code_hash = NULL
         WHERE id = 1 AND armed_at IS NOT NULL AND ttl IS NOT NULL AND (
           (state = 'armed' AND armed_at + ttl < ?1)
           OR (state = 'locked' AND locked_at > armed_at + ttl))",
        [now],
    )?;
    Ok(n > 0)
}

/// [`expire`] then [`get`].
pub fn state(tx: &Transaction<'_>, now: i64) -> Result<ArmWindow> {
    expire(tx, now)?;
    get(tx)
}

/// True for a lowercase sha256 hex string.
fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Open a window with `code_hash` (sha256 hex) for `ttl` seconds, clearing the lock and the
/// last burn. Replaces an open window.
pub fn arm(tx: &Transaction<'_>, mode: ArmMode, ttl: i64, code_hash: &str, now: i64) -> Result<()> {
    if !TTL_RANGE.contains(&ttl) {
        return Err(Error::invalid("ttl", "30-86400 seconds"));
    }
    if !is_sha256_hex(code_hash) {
        return Err(Error::invalid("code_hash", "expected lowercase sha256 hex"));
    }
    tx.execute(
        "UPDATE arm_state SET state = 'armed', mode = ?1, armed_at = ?2, ttl = ?3,
           code_hash = ?4, locked_at = NULL,
           burned_at = NULL, burned_ip = NULL, burned_mode = NULL
         WHERE id = 1",
        params![mode.as_str(), now, ttl, code_hash],
    )?;
    Ok(())
}

/// Compare `code_hash` with the open window in constant time, after [`expire`]. On
/// [`CodeCheck::Valid`] the caller calls [`disarm`] in the same `tx` (single use).
pub fn verify_code(tx: &Transaction<'_>, code_hash: &str, now: i64) -> Result<CodeCheck> {
    expire(tx, now)?;
    let (state, stored): (String, Option<String>) = tx.query_row(
        "SELECT state, code_hash FROM arm_state WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let Some(stored) = stored.filter(|_| state == "armed") else {
        return Ok(CodeCheck::NoWindow);
    };
    if !code_hash.is_empty() && crate::constant_time_eq(code_hash.as_bytes(), stored.as_bytes()) {
        Ok(CodeCheck::Valid)
    } else {
        Ok(CodeCheck::Wrong)
    }
}

/// A wrong code: close the window without locking and record when and from where. A
/// LOCKED instance stays locked.
pub fn burn(tx: &Transaction<'_>, ip: &str, now: i64) -> Result<()> {
    expire(tx, now)?;
    tx.execute(
        "UPDATE arm_state SET
           burned_at = ?1, burned_ip = ?2, burned_mode = mode, code_hash = NULL,
           state    = CASE WHEN state = 'armed' THEN 'idle' ELSE state END,
           mode     = CASE WHEN state = 'locked' THEN mode ELSE NULL END,
           armed_at = CASE WHEN state = 'locked' THEN armed_at ELSE NULL END,
           ttl      = CASE WHEN state = 'locked' THEN ttl ELSE NULL END
         WHERE id = 1",
        params![now, ip],
    )?;
    Ok(())
}

/// Close the window (back to idle, code dropped; an expiry notice goes too). A LOCKED
/// instance stays locked (use [`unlock`]).
pub fn disarm(tx: &Transaction<'_>) -> Result<()> {
    tx.execute(
        "UPDATE arm_state SET state = 'idle', mode = NULL, armed_at = NULL, ttl = NULL,
           code_hash = NULL
         WHERE id = 1 AND state <> 'locked'",
        [],
    )?;
    Ok(())
}

/// Enter LOCKED (the only way in). An open window is closed; its mode, `armed_at` and
/// `ttl` stay for display. Locking again refreshes `locked_at`.
pub fn lock(tx: &Transaction<'_>, now: i64) -> Result<()> {
    expire(tx, now)?;
    tx.execute(
        "UPDATE arm_state SET state = 'locked', locked_at = ?1, code_hash = NULL,
           mode     = CASE WHEN state = 'armed' THEN mode ELSE NULL END,
           armed_at = CASE WHEN state = 'armed' THEN armed_at ELSE NULL END,
           ttl      = CASE WHEN state = 'armed' THEN ttl ELSE NULL END
         WHERE id = 1",
        [now],
    )?;
    Ok(())
}

/// Leave LOCKED (back to idle). No-op unless locked; an open window stays open.
pub fn unlock(tx: &Transaction<'_>) -> Result<()> {
    tx.execute(
        "UPDATE arm_state SET state = 'idle', locked_at = NULL, mode = NULL, armed_at = NULL,
           ttl = NULL
         WHERE id = 1 AND state = 'locked'",
        [],
    )?;
    Ok(())
}
