//! Saved UI layouts (table `ui_layout`, migration 2): one JSON document per layout name,
//! e.g. `canvas` (card positions / frames) or `graph` (pinned node positions).
//!
//! The schema is the backstop (name shape, `json_valid`, size); [`put`] validates first so
//! callers get a readable [`Error::Invalid`].

use crate::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// Longest layout name (`[a-z0-9_-]{1,40}`).
pub const NAME_MAX: usize = 40;
/// Largest stored document, in bytes of serialized JSON (512 KiB).
pub const DATA_MAX: usize = 512 * 1024;

/// A stored layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub name: String,
    /// Serialized JSON, as stored.
    pub data: String,
    pub updated_at: i64,
}

/// Whether `name` is a valid layout name: 1..=40 chars of `[a-z0-9_-]`.
pub fn valid_name(name: &str) -> bool {
    (1..=NAME_MAX).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

fn check_name(name: &str) -> Result<()> {
    if valid_name(name) {
        Ok(())
    } else {
        Err(Error::Invalid {
            field: "name",
            reason: "must be 1-40 characters of a-z, 0-9, '_' or '-'".into(),
        })
    }
}

/// The layout called `name`, or `None` when it was never saved.
pub fn get(conn: &Connection, name: &str) -> Result<Option<Layout>> {
    check_name(name)?;
    Ok(conn
        .query_row(
            "SELECT name, data, updated_at FROM ui_layout WHERE name = ?1",
            params![name],
            |r| {
                Ok(Layout {
                    name: r.get(0)?,
                    data: r.get(1)?,
                    updated_at: r.get(2)?,
                })
            },
        )
        .optional()?)
}

/// Insert or replace the layout `name` with the serialized JSON `data`; returns `now`
/// (the new `updated_at`).
pub fn put(tx: &Transaction<'_>, name: &str, data: &str, now: i64) -> Result<i64> {
    check_name(name)?;
    if data.len() > DATA_MAX {
        return Err(Error::Invalid {
            field: "data",
            reason: format!("larger than {DATA_MAX} bytes"),
        });
    }
    if serde_json::from_str::<serde_json::Value>(data).is_err() {
        return Err(Error::Invalid {
            field: "data",
            reason: "not valid JSON".into(),
        });
    }
    tx.execute(
        "INSERT INTO ui_layout (name, data, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        params![name, data, now],
    )?;
    Ok(now)
}

/// Remove the layout `name`; returns whether it existed.
pub fn delete(tx: &Transaction<'_>, name: &str) -> Result<bool> {
    check_name(name)?;
    Ok(tx.execute("DELETE FROM ui_layout WHERE name = ?1", params![name])? > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Db;

    #[test]
    fn names() {
        for ok in ["canvas", "graph", "a", "x_y-z09", &"a".repeat(40)] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in ["", "Canvas", "a b", "a/b", "é", "a.b", &"a".repeat(41)] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn get_put_roundtrip_and_replace() {
        let db = Db::open_temp().unwrap();
        assert_eq!(db.read(|c| get(c, "canvas")).unwrap(), None);
        let at = db
            .write(|tx| put(tx, "canvas", r#"{"cards":[1,2]}"#, 100))
            .unwrap();
        assert_eq!(at, 100);
        let l = db.read(|c| get(c, "canvas")).unwrap().unwrap();
        assert_eq!(
            (l.name.as_str(), l.data.as_str(), l.updated_at),
            ("canvas", r#"{"cards":[1,2]}"#, 100)
        );
        db.write(|tx| put(tx, "canvas", "null", 200)).unwrap();
        let l = db.read(|c| get(c, "canvas")).unwrap().unwrap();
        assert_eq!((l.data.as_str(), l.updated_at), ("null", 200));
        // Other names are independent.
        assert_eq!(db.read(|c| get(c, "graph")).unwrap(), None);
        assert!(db.write(|tx| delete(tx, "canvas")).unwrap());
        assert!(!db.write(|tx| delete(tx, "canvas")).unwrap());
    }

    #[test]
    fn invalid_input_is_rejected_before_sql() {
        let db = Db::open_temp().unwrap();
        let inv = |r: Result<i64>| matches!(r, Err(Error::Invalid { .. }));
        assert!(inv(db.write(|tx| put(tx, "Bad Name", "{}", 1))));
        assert!(inv(db.write(|tx| put(tx, "canvas", "{oops", 1))));
        let big = format!("\"{}\"", "x".repeat(DATA_MAX));
        assert!(inv(db.write(|tx| put(tx, "canvas", &big, 1))));
        let max = format!("\"{}\"", "x".repeat(DATA_MAX - 2));
        assert!(db.write(|tx| put(tx, "canvas", &max, 1)).is_ok());
        assert!(matches!(
            db.read(|c| get(c, "../x")),
            Err(Error::Invalid { .. })
        ));
    }

    #[test]
    fn schema_is_the_backstop() {
        let db = Db::open_temp().unwrap();
        let raw = |name: &str, data: &str| {
            db.write(|tx| {
                Ok(tx.execute(
                    "INSERT INTO ui_layout (name, data, updated_at) VALUES (?1, ?2, 1)",
                    params![name, data],
                )?)
            })
        };
        for (name, data) in [
            ("UPPER", "{}"),
            ("", "{}"),
            ("a b", "{}"),
            ("a/b", "{}"),
            (&"a".repeat(41) as &str, "{}"),
            ("ok", "{not json"),
        ] {
            let r = raw(name, data);
            assert!(
                r.as_ref().is_err_and(|e| e.is_constraint()),
                "{name:?} {data:?}: {r:?}"
            );
        }
        let big = format!("\"{}\"", "x".repeat(DATA_MAX));
        assert!(raw("big", &big).is_err_and(|e| e.is_constraint()));
        assert!(raw("ok_name-1", "[]").is_ok());
    }
}
