//! Change detection across processes (docs/DATABASE.md section 3.3).
//!
//! `PRAGMA data_version` on the read connection changes whenever any *other* connection
//! (another process, or this process's own write connection) commits. Only then is the
//! small `revision` table read and compared with the revisions seen last time. Triggers
//! bump the counters, so no write path can forget to signal a change.
//!
//! Usage in the server: load caches right after [`Db::open`], then call
//! [`Db::changed_domains`] at most once a second (lazily on requests plus a 1 s ticker)
//! and reload only the domains it returns. The server's own writes are reported too,
//! which is harmless (a reload of what it just wrote).

use crate::{Db, Domain, Result};
use rusqlite::Connection;
use std::collections::BTreeMap;

/// What the read connection saw last time.
pub(crate) struct WatchState {
    data_version: i64,
    revs: BTreeMap<Domain, i64>,
}

impl WatchState {
    /// Baseline taken at open: changes are reported relative to the state at open time.
    pub(crate) fn new(conn: &Connection) -> Result<Self> {
        Ok(Self {
            data_version: data_version(conn)?,
            revs: revisions(conn)?,
        })
    }
}

/// `PRAGMA data_version` of this connection.
pub fn data_version(conn: &Connection) -> Result<i64> {
    Ok(conn.pragma_query_value(None, "data_version", |r| r.get(0))?)
}

/// Current revision counter of every domain.
pub fn revisions(conn: &Connection) -> Result<BTreeMap<Domain, i64>> {
    let mut stmt = conn.prepare_cached("SELECT domain, rev FROM revision")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    let mut out = BTreeMap::new();
    for row in rows {
        let (domain, rev) = row?;
        out.insert(domain.parse()?, rev);
    }
    Ok(out)
}

impl Db {
    /// Domains whose data changed since the previous call (or since [`Db::open`] for the
    /// first call), in [`Domain::ALL`] order. Costs one pragma when nothing was committed;
    /// safe to call often.
    pub fn changed_domains(&self) -> Result<Vec<Domain>> {
        let mut reader = self.reader();
        let dv = data_version(&reader.conn)?;
        if dv == reader.watch.data_version {
            return Ok(Vec::new());
        }
        let revs = revisions(&reader.conn)?;
        let changed = Domain::ALL
            .into_iter()
            .filter(|d| revs.get(d) != reader.watch.revs.get(d))
            .collect();
        reader.watch = WatchState {
            data_version: dv,
            revs,
        };
        Ok(changed)
    }

    /// Current revision counters (e.g. for `memora-cli db check`).
    pub fn revisions(&self) -> Result<BTreeMap<Domain, i64>> {
        self.read(revisions)
    }
}
