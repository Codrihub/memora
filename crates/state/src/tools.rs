//! MCP tool catalog mirror and global switches, tables `tool`, `tool_disabled`.
//!
//! The catalog is synced from `memora_mcp::catalog()` at server start ([`sync_catalog`])
//! so `tool_disabled` and `api_key_tool` can reference it.
//!
//! Tools that disappear from the catalog are marked `retired`, never deleted: the FKs from
//! `api_key_tool` / `tool_disabled` stay valid and nothing is cascaded away. A retired
//! tool is not in [`catalog`] / [`disabled`], cannot be granted or switched, and is hidden
//! from `keys::ApiKey::tools` (its grants are dormant). If it returns to the catalog it is
//! revived with its old grants and switch.
//!
//! Note: the `tool` table has no revision trigger; [`sync_catalog`] runs at server start,
//! before the caches load, so no change notification is needed for it.

use crate::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::BTreeSet;

/// One catalog tool with its global switch.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ToolInfo {
    pub name: String,
    /// No longer in the server's catalog.
    pub retired: bool,
    /// Globally disabled since this time.
    pub disabled_at: Option<i64>,
}

/// What [`sync_catalog`] changed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CatalogSync {
    pub added: Vec<String>,
    pub retired: Vec<String>,
    pub revived: Vec<String>,
}

impl CatalogSync {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.retired.is_empty() && self.revived.is_empty()
    }
}

/// Same rule as the `tool.name` CHECK: `[a-z][a-z0-9_]*`, plus at most 64 chars.
fn valid_name(name: &str) -> bool {
    let b = name.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_lowercase()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
}

/// Make `tool` match `names`: insert new names, retire missing ones, un-retire returning
/// ones. Writes only rows that change. An invalid name fails the whole sync
/// (`Error::Invalid`) before anything is written. Lists in the result are sorted.
pub fn sync_catalog(tx: &Transaction<'_>, names: &[&str]) -> Result<CatalogSync> {
    if let Some(bad) = names.iter().find(|n| !valid_name(n)) {
        return Err(Error::invalid("tool", format!("bad catalog name: {bad:?}")));
    }
    let wanted: BTreeSet<&str> = names.iter().copied().collect();
    let mut out = CatalogSync::default();
    let current: Vec<(String, bool)> = {
        let mut st = tx.prepare("SELECT name, retired FROM tool ORDER BY name")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let known: BTreeSet<&str> = current.iter().map(|(n, _)| n.as_str()).collect();
    for (name, retired) in &current {
        let keep = wanted.contains(name.as_str());
        if keep && *retired {
            tx.execute("UPDATE tool SET retired = 0 WHERE name = ?1", [name])?;
            out.revived.push(name.clone());
        } else if !keep && !*retired {
            tx.execute("UPDATE tool SET retired = 1 WHERE name = ?1", [name])?;
            out.retired.push(name.clone());
        }
    }
    for name in wanted.iter().filter(|n| !known.contains(*n)) {
        tx.execute("INSERT INTO tool (name) VALUES (?1)", [name])
            .map_err(|e| crate::keys::map_constraint(e, "tool"))?;
        out.added.push(name.to_string());
    }
    Ok(out)
}

/// Every known tool (retired ones included), by name.
pub fn list(conn: &Connection) -> Result<Vec<ToolInfo>> {
    let mut st = conn.prepare_cached(
        "SELECT t.name, t.retired, d.disabled_at FROM tool t
         LEFT JOIN tool_disabled d ON d.tool_name = t.name ORDER BY t.name",
    )?;
    let rows = st.query_map([], |r| {
        Ok(ToolInfo {
            name: r.get(0)?,
            retired: r.get(1)?,
            disabled_at: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Names of the non-retired catalog tools (for validating per-key lists before writing).
pub fn catalog(conn: &Connection) -> Result<BTreeSet<String>> {
    let mut st = conn.prepare_cached("SELECT name FROM tool WHERE retired = 0")?;
    let rows = st.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Globally disabled (non-retired) tool names.
pub fn disabled(conn: &Connection) -> Result<BTreeSet<String>> {
    let mut st = conn.prepare_cached(
        "SELECT d.tool_name FROM tool_disabled d JOIN tool t ON t.name = d.tool_name
         WHERE t.retired = 0",
    )?;
    let rows = st.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Enable or disable one tool globally. Unknown or retired names -> `Error::NotFound`.
/// Idempotent: no row changes (and no `tools` revision bump) when the switch is already in
/// the requested position; re-disabling keeps the original `disabled_at`.
pub fn set_enabled(tx: &Transaction<'_>, name: &str, enabled: bool, now: i64) -> Result<()> {
    let retired: Option<bool> = tx
        .query_row("SELECT retired FROM tool WHERE name = ?1", [name], |r| {
            r.get(0)
        })
        .optional()?;
    if retired != Some(false) {
        return Err(Error::NotFound(format!("tool {name}")));
    }
    if enabled {
        tx.execute("DELETE FROM tool_disabled WHERE tool_name = ?1", [name])?;
    } else {
        tx.execute(
            "INSERT INTO tool_disabled (tool_name, disabled_at) VALUES (?1, ?2)
             ON CONFLICT(tool_name) DO NOTHING",
            params![name, now],
        )?;
    }
    Ok(())
}
