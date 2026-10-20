//! OAuth 2.1 storage for remote MCP clients (migration 4): registered clients,
//! one-time authorization codes and rotating refresh grants. Tokens are stored as
//! sha256 only; the access token of a connection is an ordinary API key.
use crate::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// A registered OAuth client.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Client {
    pub client_id: String,
    pub name: String,
    pub redirect_uris: Vec<String>,
    /// `dcr` (RFC 7591), `cimd` (metadata document URL) or `manual` (owner).
    pub kind: String,
    pub created_at: i64,
    /// When a `cimd` document was last fetched.
    pub fetched_at: Option<i64>,
}

/// At most this many dynamically registered clients are kept.
pub const MAX_CLIENTS: i64 = 500;

fn client_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Client> {
    let uris: String = r.get(2)?;
    Ok(Client {
        client_id: r.get(0)?,
        name: r.get(1)?,
        redirect_uris: serde_json::from_str(&uris).unwrap_or_default(),
        kind: r.get(3)?,
        created_at: r.get(4)?,
        fetched_at: r.get(5)?,
    })
}

const CLIENT_COLS: &str = "client_id, name, redirect_uris, kind, created_at, fetched_at";

pub fn get_client(conn: &Connection, id: &str) -> Result<Option<Client>> {
    Ok(conn
        .query_row(
            &format!("SELECT {CLIENT_COLS} FROM oauth_client WHERE client_id = ?1"),
            [id],
            client_row,
        )
        .optional()?)
}

pub fn list_clients(conn: &Connection) -> Result<Vec<Client>> {
    let mut st = conn.prepare(&format!(
        "SELECT {CLIENT_COLS} FROM oauth_client ORDER BY created_at DESC"
    ))?;
    let rows = st
        .query_map([], client_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn count_clients(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT count(*) FROM oauth_client", [], |r| r.get(0))?)
}

/// Insert or replace a client (a refetched metadata document replaces the row).
pub fn put_client(tx: &Transaction<'_>, c: &Client) -> Result<()> {
    if c.redirect_uris.is_empty() || c.redirect_uris.len() > 10 {
        return Err(Error::invalid("redirect_uris", "1-10 redirect URIs"));
    }
    tx.execute(
        "INSERT INTO oauth_client (client_id, name, redirect_uris, kind, created_at, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(client_id) DO UPDATE SET name = excluded.name,
           redirect_uris = excluded.redirect_uris, fetched_at = excluded.fetched_at",
        params![
            c.client_id,
            c.name.chars().take(200).collect::<String>(),
            serde_json::to_string(&c.redirect_uris).unwrap_or_else(|_| "[]".into()),
            c.kind,
            c.created_at,
            c.fetched_at
        ],
    )?;
    Ok(())
}

pub fn delete_client(tx: &Transaction<'_>, id: &str) -> Result<bool> {
    tx.execute("DELETE FROM oauth_grant WHERE client_id = ?1", [id])?;
    Ok(tx.execute("DELETE FROM oauth_client WHERE client_id = ?1", [id])? > 0)
}

/// A pending authorization code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Code {
    pub code_hash: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub challenge: String,
    pub resource: Option<String>,
    pub user: String,
    pub expires_at: i64,
}

pub fn put_code(tx: &Transaction<'_>, c: &Code) -> Result<()> {
    tx.execute(
        "INSERT INTO oauth_code (code_hash, client_id, redirect_uri, challenge, resource, user, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![c.code_hash, c.client_id, c.redirect_uri, c.challenge, c.resource, c.user, c.expires_at],
    )?;
    Ok(())
}

/// Consume a code (single use): the row is deleted whether or not it is still valid.
pub fn take_code(tx: &Transaction<'_>, code_hash: &str, now: i64) -> Result<Option<Code>> {
    let c = tx
        .query_row(
            "SELECT code_hash, client_id, redirect_uri, challenge, resource, user, expires_at
             FROM oauth_code WHERE code_hash = ?1",
            [code_hash],
            |r| {
                Ok(Code {
                    code_hash: r.get(0)?,
                    client_id: r.get(1)?,
                    redirect_uri: r.get(2)?,
                    challenge: r.get(3)?,
                    resource: r.get(4)?,
                    user: r.get(5)?,
                    expires_at: r.get(6)?,
                })
            },
        )
        .optional()?;
    tx.execute("DELETE FROM oauth_code WHERE code_hash = ?1", [code_hash])?;
    Ok(c.filter(|c| c.expires_at > now))
}

pub fn put_grant(
    tx: &Transaction<'_>,
    refresh_hash: &str,
    key_id: &str,
    client_id: &str,
    now: i64,
) -> Result<()> {
    tx.execute(
        "INSERT INTO oauth_grant (refresh_hash, key_id, client_id, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![refresh_hash, key_id, client_id, now],
    )?;
    Ok(())
}

/// Consume a refresh token: `(key_id, client_id)` of its grant, which is removed.
pub fn take_grant(tx: &Transaction<'_>, refresh_hash: &str) -> Result<Option<(String, String)>> {
    let g = tx
        .query_row(
            "SELECT key_id, client_id FROM oauth_grant WHERE refresh_hash = ?1",
            [refresh_hash],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    tx.execute(
        "DELETE FROM oauth_grant WHERE refresh_hash = ?1",
        [refresh_hash],
    )?;
    Ok(g)
}

/// `key_id -> client_id` of every OAuth connection (the Agents page labels them).
pub fn connections(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut st = conn.prepare("SELECT DISTINCT key_id, client_id FROM oauth_grant")?;
    let rows = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Drop expired codes, dynamic clients unused for 30 days and cached client
/// metadata documents not fetched for 30 days, unless a grant uses them.
/// Returns rows removed.
pub fn prune(tx: &Transaction<'_>, now: i64) -> Result<usize> {
    let codes = tx.execute("DELETE FROM oauth_code WHERE expires_at <= ?1", [now])?;
    let clients = tx.execute(
        "DELETE FROM oauth_client WHERE client_id NOT IN (SELECT client_id FROM oauth_grant)
           AND ((kind = 'dcr' AND created_at < ?1)
             OR (kind = 'cimd' AND COALESCE(fetched_at, created_at) < ?1))",
        [now - 30 * 86_400],
    )?;
    Ok(codes + clients)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Db;

    fn client(id: &str, kind: &str, created_at: i64, fetched_at: Option<i64>) -> Client {
        Client {
            client_id: id.into(),
            name: "c".into(),
            redirect_uris: vec!["https://e.example/cb".into()],
            kind: kind.into(),
            created_at,
            fetched_at,
        }
    }

    /// Cached metadata clients (fetchable without signing in) age out like
    /// dynamic registrations, so they cannot fill the table for good.
    #[test]
    fn prune_drops_stale_metadata_clients_too() {
        let db = Db::open_temp().unwrap();
        let now = 1_700_000_000;
        let old = now - 31 * 86_400;
        db.write(|tx| {
            put_client(tx, &client("dcr-old-client", "dcr", old, None))?;
            put_client(tx, &client("https://a.example/old", "cimd", old, Some(old)))?;
            put_client(tx, &client("https://a.example/new", "cimd", old, Some(now)))?;
            put_client(tx, &client("manual-old-client", "manual", old, None))?;
            prune(tx, now)?;
            Ok(())
        })
        .unwrap();
        let left: Vec<String> = db
            .read(|c| {
                let mut st = c.prepare("SELECT client_id FROM oauth_client ORDER BY client_id")?;
                let rows = st
                    .query_map([], |r| r.get(0))?
                    .collect::<rusqlite::Result<Vec<String>>>()?;
                Ok(rows)
            })
            .unwrap();
        assert_eq!(left, ["https://a.example/new", "manual-old-client"]);
    }
}
