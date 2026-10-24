//! API keys (`api_key`, `api_key_scope`, `api_key_tool`). Keys arrive hashed; rolling
//! replaces the hash at once. Grants of retired tools stay dormant until the tool returns.
//! Constraint errors map to [`Error::Conflict`] (duplicates) or [`Error::Invalid`].

use crate::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::BTreeSet;

/// A key scope (`api_key_scope.scope`).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Mcp,
    Read,
    Write,
    Admin,
}

impl Scope {
    pub const ALL: [Scope; 4] = [Scope::Mcp, Scope::Read, Scope::Write, Scope::Admin];
    /// Scopes of a new key (`DEFAULT_KEY_SCOPES`).
    pub const DEFAULT: [Scope; 3] = [Scope::Mcp, Scope::Read, Scope::Write];

    pub fn as_str(self) -> &'static str {
        match self {
            Scope::Mcp => "mcp",
            Scope::Read => "read",
            Scope::Write => "write",
            Scope::Admin => "admin",
        }
    }

    /// [`Scope::DEFAULT`] as a set.
    pub fn default_set() -> BTreeSet<Scope> {
        Scope::DEFAULT.into_iter().collect()
    }
}

impl std::str::FromStr for Scope {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        Scope::ALL
            .into_iter()
            .find(|x| x.as_str() == s)
            .ok_or_else(|| Error::invalid("scope", format!("unknown scope: {s}")))
    }
}

/// Which tools a key may call over MCP (`api_key.tools_all` + `api_key_tool`).
/// Same meaning as `memora_gateway::ToolGrant`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ToolGrant {
    /// `"tools": "*"` (`tools_all = 1`).
    #[default]
    All,
    /// Only these catalog names (`tools_all = 0`); may be empty.
    Only(BTreeSet<String>),
}

impl ToolGrant {
    pub fn allows(&self, name: &str) -> bool {
        match self {
            ToolGrant::All => true,
            ToolGrant::Only(s) => s.contains(name),
        }
    }
}

/// One `api_key` row with its scopes and tools.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiKey {
    /// `k_...`, 3-40 chars (today `k_<first 8 hex of the hash>`, or `k_env`).
    pub id: String,
    pub name: String,
    /// sha256 hex or legacy argon2id. Never sent to clients.
    pub hash: String,
    /// Display prefix of the raw key (4-16 chars).
    pub prefix: String,
    pub enabled: bool,
    pub scopes: BTreeSet<Scope>,
    /// Live catalog tools only (grants of retired tools are dormant, see module docs).
    pub tools: ToolGrant,
    pub created_at: i64,
    /// Unused: rolls take effect immediately (always `None`; column kept).
    pub grace_until: Option<i64>,
    /// Set when in the trash.
    pub deleted_at: Option<i64>,
    /// Display color `#rrggbb`; `None` = derived from the name in the UI.
    pub color: Option<String>,
}

impl ApiKey {
    pub fn has_scope(&self, scope: Scope) -> bool {
        self.scopes.contains(&scope)
    }
}

/// Input for [`create`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewApiKey {
    pub id: String,
    pub name: String,
    pub hash: String,
    pub prefix: String,
    pub scopes: BTreeSet<Scope>,
    pub tools: ToolGrant,
}

/// Partial update for [`update`]; `None` = unchanged.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KeyPatch {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub scopes: Option<BTreeSet<Scope>>,
    pub tools: Option<ToolGrant>,
}

// ---------------------------------------------------------------------------
// Effective MCP access (docs/contracts/tools-permissions.md)
// ---------------------------------------------------------------------------

/// Why a tool call is refused (same as `memora_gateway::ToolDenial`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolDenial {
    /// Globally disabled (`tool_disabled`).
    Disabled,
    /// The key is disabled, lacks the `mcp` scope, or its tool list does not include it.
    NotAllowed,
}

impl ToolDenial {
    /// JSON-RPC error message for `tools/call` (code -32003).
    pub fn message(self, name: &str) -> String {
        match self {
            ToolDenial::Disabled => format!("tool disabled on this server: {name}"),
            ToolDenial::NotAllowed => format!("tool not allowed for this API key: {name}"),
        }
    }
}

/// Effective MCP access to tool `name`, identical to `memora_gateway::tool_access`
/// (including check order). `key == None` is a full-access caller.
pub fn tool_access(
    key: Option<&ApiKey>,
    disabled: &BTreeSet<String>,
    name: &str,
) -> std::result::Result<(), ToolDenial> {
    if let Some(k) = key {
        if !k.enabled || !k.has_scope(Scope::Mcp) {
            return Err(ToolDenial::NotAllowed);
        }
    }
    if disabled.contains(name) {
        return Err(ToolDenial::Disabled);
    }
    match key {
        Some(k) if !k.tools.allows(name) => Err(ToolDenial::NotAllowed),
        _ => Ok(()),
    }
}

/// The tools `tools/list` shows to `key`: live catalog tools passing [`tool_access`].
pub fn allowed_tools(conn: &Connection, key: Option<&ApiKey>) -> Result<BTreeSet<String>> {
    let disabled = crate::tools::disabled(conn)?;
    Ok(crate::tools::catalog(conn)?
        .into_iter()
        .filter(|t| tool_access(key, &disabled, t).is_ok())
        .collect())
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const KEY_COLS: &str =
    "id, name, hash, prefix, enabled, tools_all, created_at, grace_until, deleted_at, color";

/// Row of `api_key` before scopes/tools are attached (`tools_all` in the bool).
fn key_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<(ApiKey, bool)> {
    Ok((
        ApiKey {
            id: r.get(0)?,
            name: r.get(1)?,
            hash: r.get(2)?,
            prefix: r.get(3)?,
            enabled: r.get(4)?,
            scopes: BTreeSet::new(),
            tools: ToolGrant::All,
            created_at: r.get(6)?,
            grace_until: r.get(7)?,
            deleted_at: r.get(8)?,
            color: r.get(9)?,
        },
        r.get(5)?,
    ))
}

/// Attach scopes and (for `tools_all = 0`) the live granted tools.
fn complete(conn: &Connection, (mut key, tools_all): (ApiKey, bool)) -> Result<ApiKey> {
    let mut st = conn.prepare_cached("SELECT scope FROM api_key_scope WHERE key_id = ?1")?;
    let scopes = st.query_map([&key.id], |r| r.get::<_, String>(0))?;
    for s in scopes {
        key.scopes.insert(s?.parse()?);
    }
    if !tools_all {
        let mut st = conn.prepare_cached(
            "SELECT t.tool_name FROM api_key_tool t JOIN tool ON tool.name = t.tool_name
             WHERE t.key_id = ?1 AND tool.retired = 0",
        )?;
        let names = st
            .query_map([&key.id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<BTreeSet<_>>>()?;
        key.tools = ToolGrant::Only(names);
    }
    Ok(key)
}

fn query_keys(
    conn: &Connection,
    where_order: &str,
    args: &[&dyn rusqlite::ToSql],
) -> Result<Vec<ApiKey>> {
    let mut st = conn.prepare_cached(&format!("SELECT {KEY_COLS} FROM api_key {where_order}"))?;
    let rows = st
        .query_map(args, key_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter().map(|r| complete(conn, r)).collect()
}

/// Live keys (not in the trash), ordered by `created_at`.
pub fn list(conn: &Connection) -> Result<Vec<ApiKey>> {
    query_keys(
        conn,
        "WHERE deleted_at IS NULL ORDER BY created_at, id",
        &[],
    )
}

/// Keys in the trash, newest deletion first.
pub fn list_trash(conn: &Connection) -> Result<Vec<ApiKey>> {
    query_keys(
        conn,
        "WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id",
        &[],
    )
}

/// Any key by id, live or trashed.
pub fn get(conn: &Connection, id: &str) -> Result<Option<ApiKey>> {
    Ok(query_keys(conn, "WHERE id = ?1", &[&id])?.pop())
}

/// The live key with this hash (sha256 keys; legacy argon2id keys are verified by the
/// caller against [`list`]). Read-only.
pub fn find_by_hash(conn: &Connection, hash: &str) -> Result<Option<ApiKey>> {
    let mut st = conn.prepare_cached(&format!(
        "SELECT {KEY_COLS} FROM api_key WHERE hash = ?1 AND deleted_at IS NULL"
    ))?;
    let row = st.query_row([hash], key_row).optional()?;
    row.map(|r| complete(conn, r)).transpose()
}

fn get_live(tx: &Transaction<'_>, id: &str) -> Result<ApiKey> {
    match get(tx, id)? {
        Some(k) if k.deleted_at.is_none() => Ok(k),
        _ => Err(Error::NotFound(format!("key {id}"))),
    }
}

// ---------------------------------------------------------------------------
// Validation and constraint mapping
// ---------------------------------------------------------------------------

fn validate_id(id: &str) -> Result<()> {
    if !id.starts_with("k_") || !(3..=40).contains(&id.chars().count()) {
        return Err(Error::invalid(
            "id",
            "must start with k_ and be 3-40 characters",
        ));
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<()> {
    if !(1..=80).contains(&name.chars().count()) {
        return Err(Error::invalid("name", "must be 1-80 characters"));
    }
    Ok(())
}

fn validate_hash(hash: &str) -> Result<()> {
    let sha = hash.len() == 64 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if !sha && !hash.starts_with("$argon2id$") {
        return Err(Error::invalid(
            "hash",
            "must be lowercase sha256 hex or argon2id",
        ));
    }
    Ok(())
}

fn validate_prefix(prefix: &str) -> Result<()> {
    if !(4..=16).contains(&prefix.chars().count()) {
        return Err(Error::invalid("prefix", "must be 4-16 characters"));
    }
    Ok(())
}

/// Every name must be a live catalog tool.
fn validate_tools(tx: &Transaction<'_>, grant: &ToolGrant) -> Result<()> {
    if let ToolGrant::Only(names) = grant {
        let mut st = tx.prepare_cached("SELECT retired FROM tool WHERE name = ?1")?;
        for n in names {
            let retired: Option<bool> = st.query_row([n], |r| r.get(0)).optional()?;
            if retired != Some(false) {
                return Err(Error::invalid("tools", format!("unknown tool: {n}")));
            }
        }
    }
    Ok(())
}

/// Map a constraint violation to `Invalid` / `Conflict`; other errors pass through.
pub(crate) fn map_constraint(e: rusqlite::Error, field: &'static str) -> Error {
    use rusqlite::ffi;
    if let rusqlite::Error::SqliteFailure(f, msg) = &e {
        if f.code == rusqlite::ErrorCode::ConstraintViolation {
            let reason = msg.clone().unwrap_or_else(|| f.to_string());
            return match f.extended_code {
                ffi::SQLITE_CONSTRAINT_UNIQUE | ffi::SQLITE_CONSTRAINT_PRIMARYKEY => {
                    Error::Conflict(format!("{field} already exists ({reason})"))
                }
                _ => Error::invalid(field, reason),
            };
        }
    }
    Error::Sqlite(e)
}

fn write_scopes(tx: &Transaction<'_>, id: &str, scopes: &BTreeSet<Scope>) -> Result<()> {
    tx.execute("DELETE FROM api_key_scope WHERE key_id = ?1", [id])?;
    let mut st = tx.prepare_cached("INSERT INTO api_key_scope (key_id, scope) VALUES (?1, ?2)")?;
    for s in scopes {
        st.execute(params![id, s.as_str()])
            .map_err(|e| map_constraint(e, "scopes"))?;
    }
    Ok(())
}

/// Replace the tool grant (already validated). `tools_all = 1` clears the list by trigger.
fn write_tools(tx: &Transaction<'_>, id: &str, grant: &ToolGrant) -> Result<()> {
    match grant {
        ToolGrant::All => {
            tx.execute(
                "UPDATE api_key SET tools_all = 1 WHERE id = ?1 AND tools_all = 0",
                [id],
            )?;
        }
        ToolGrant::Only(names) => {
            tx.execute(
                "UPDATE api_key SET tools_all = 0 WHERE id = ?1 AND tools_all = 1",
                [id],
            )?;
            tx.execute("DELETE FROM api_key_tool WHERE key_id = ?1", [id])?;
            let mut st =
                tx.prepare_cached("INSERT INTO api_key_tool (key_id, tool_name) VALUES (?1, ?2)")?;
            for n in names {
                st.execute(params![id, n])
                    .map_err(|e| map_constraint(e, "tools"))?;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/// Insert a key with its scopes and tools. Unknown tool names fail (`Error::Invalid`);
/// a duplicate id or hash (live or trashed) is `Error::Conflict`.
pub fn create(tx: &Transaction<'_>, key: &NewApiKey, now: i64) -> Result<ApiKey> {
    validate_id(&key.id)?;
    validate_name(&key.name)?;
    validate_hash(&key.hash)?;
    validate_prefix(&key.prefix)?;
    validate_tools(tx, &key.tools)?;
    let tools_all = matches!(key.tools, ToolGrant::All);
    tx.execute(
        "INSERT INTO api_key (id, name, hash, prefix, enabled, tools_all, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
        params![key.id, key.name, key.hash, key.prefix, tools_all, now],
    )
    .map_err(|e| map_constraint(e, "key"))?;
    write_scopes(tx, &key.id, &key.scopes)?;
    if !tools_all {
        write_tools(tx, &key.id, &key.tools)?;
    }
    get_live(tx, &key.id)
}

/// Update name / enabled / scopes / tools. `Error::NotFound` for unknown or trashed ids.
pub fn update(tx: &Transaction<'_>, id: &str, patch: &KeyPatch) -> Result<ApiKey> {
    get_live(tx, id)?;
    if let Some(name) = &patch.name {
        validate_name(name)?;
        tx.execute(
            "UPDATE api_key SET name = ?2 WHERE id = ?1",
            params![id, name],
        )
        .map_err(|e| map_constraint(e, "name"))?;
    }
    if let Some(enabled) = patch.enabled {
        tx.execute(
            "UPDATE api_key SET enabled = ?2 WHERE id = ?1",
            params![id, enabled],
        )?;
    }
    if let Some(scopes) = &patch.scopes {
        write_scopes(tx, id, scopes)?;
    }
    if let Some(tools) = &patch.tools {
        validate_tools(tx, tools)?;
        write_tools(tx, id, tools)?;
    }
    get_live(tx, id)
}

/// Normalize a display color: `#rgb` / `#rrggbb` (any case) -> `#rrggbb` lowercase.
pub fn normalize_color(c: &str) -> Result<String> {
    let h = c.trim().strip_prefix('#').unwrap_or("");
    if !h.bytes().all(|b| b.is_ascii_hexdigit()) || !(h.len() == 3 || h.len() == 6) {
        return Err(Error::invalid("color", "must be a hex color like #3b82f6"));
    }
    let full: String = if h.len() == 3 {
        h.chars().flat_map(|ch| [ch, ch]).collect()
    } else {
        h.to_string()
    };
    Ok(format!("#{}", full.to_ascii_lowercase()))
}

/// Set (`Some`) or clear (`None` / empty) a live key's display color.
pub fn set_color(tx: &Transaction<'_>, id: &str, color: Option<&str>) -> Result<ApiKey> {
    get_live(tx, id)?;
    let c = match color.map(str::trim).filter(|c| !c.is_empty()) {
        Some(c) => Some(normalize_color(c)?),
        None => None,
    };
    tx.execute(
        "UPDATE api_key SET color = ?2 WHERE id = ?1",
        params![id, c],
    )?;
    get_live(tx, id)
}

/// New key material for the same id: replace hash + prefix and re-enable; the old hash
/// stops working at commit. The same hash again is `Error::Invalid`.
pub fn roll(tx: &Transaction<'_>, id: &str, hash: &str, prefix: &str) -> Result<ApiKey> {
    validate_hash(hash)?;
    validate_prefix(prefix)?;
    let old = get_live(tx, id)?;
    if old.hash == hash {
        return Err(Error::invalid("hash", "a roll needs new key material"));
    }
    // A sealed copy of the old secret would now show the wrong key.
    drop_secret(tx, id)?;
    tx.execute(
        "UPDATE api_key SET hash = ?2, prefix = ?3, enabled = 1, grace_until = NULL WHERE id = ?1",
        params![id, hash, prefix],
    )
    .map_err(|e| map_constraint(e, "hash"))?;
    get_live(tx, id)
}

/// Move to the trash (`deleted_at = now`, clamped to `created_at`); the key stops
/// authenticating. `Error::NotFound` for unknown or already trashed ids.
pub fn trash(tx: &Transaction<'_>, id: &str, now: i64) -> Result<()> {
    let n = tx.execute(
        "UPDATE api_key SET deleted_at = max(?2, created_at) WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if n == 0 {
        return Err(Error::NotFound(format!("key {id}")));
    }
    Ok(())
}

/// Take out of the trash (scopes and tools as they were). `Error::NotFound` when the id is
/// not in the trash.
pub fn restore(tx: &Transaction<'_>, id: &str) -> Result<()> {
    let n = tx.execute(
        "UPDATE api_key SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
        [id],
    )?;
    if n == 0 {
        return Err(Error::NotFound(format!("deleted key {id}")));
    }
    Ok(())
}

/// Hard delete, live or trashed (cascades scopes, tools, usage, events). Used by retention
/// (trash older than the retention period) and the CLI. Returns whether a row existed.
pub fn purge(tx: &Transaction<'_>, id: &str) -> Result<bool> {
    Ok(tx.execute("DELETE FROM api_key WHERE id = ?1", [id])? > 0)
}

/// Ids of trashed keys deleted before `cutoff` (for the retention job, which then calls
/// [`purge`] on each).
pub fn trashed_before(conn: &Connection, cutoff: i64) -> Result<Vec<String>> {
    let mut st = conn.prepare_cached(
        "SELECT id FROM api_key WHERE deleted_at IS NOT NULL AND deleted_at < ?1 ORDER BY deleted_at",
    )?;
    let ids = st
        .query_map([cutoff], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(ids)
}

// ---------------------------------------------------------------------------
// Sealed secrets (migration 5)
// ---------------------------------------------------------------------------

/// Store the sealed (encrypted) secret of a key, replacing an older one.
pub fn put_secret(tx: &Transaction<'_>, id: &str, sealed: &str) -> Result<()> {
    tx.execute(
        "INSERT INTO api_key_secret (key_id, sealed) VALUES (?1, ?2)
         ON CONFLICT(key_id) DO UPDATE SET sealed = excluded.sealed",
        params![id, sealed],
    )?;
    Ok(())
}

/// Forget a key's sealed secret (a roll outside the dashboard makes it stale).
pub fn drop_secret(tx: &Transaction<'_>, id: &str) -> Result<()> {
    tx.execute("DELETE FROM api_key_secret WHERE key_id = ?1", [id])?;
    Ok(())
}

pub fn get_secret(conn: &Connection, id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT sealed FROM api_key_secret WHERE key_id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?)
}

/// Ids of keys whose secret can be shown again.
pub fn sealed_ids(conn: &Connection) -> Result<BTreeSet<String>> {
    let mut st = conn.prepare("SELECT key_id FROM api_key_secret")?;
    let ids = st
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}
