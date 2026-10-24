//! Change detection across processes: `PRAGMA data_version` signals a commit, then the
//! trigger-maintained `revision` table says which [`Domain`]s changed.

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
    /// Domains whose data changed since the previous call (or since [`Db::open`]), in
    /// [`Domain::ALL`] order. Cheap when nothing was committed.
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
