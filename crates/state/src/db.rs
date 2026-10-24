//! Opening the state database, connection pragmas, file permissions, and the transaction
//! helpers [`Db::write`] / [`Db::read`] (one write and one read connection, WAL mode).

use crate::watch::WatchState;
use crate::{migrate, Error, Result};
use rusqlite::{Connection, Transaction, TransactionBehavior};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

/// File name of the database inside the state directory.
pub const DB_FILE: &str = "memora.db";

/// How long a writer waits for another process's write lock before failing with
/// `SQLITE_BUSY`.
pub const BUSY_TIMEOUT: Duration = Duration::from_millis(5000);

/// `PRAGMA journal_size_limit`: the WAL is truncated back to this size after checkpoints.
const JOURNAL_SIZE_LIMIT: i64 = 4 * 1024 * 1024;

/// Handle to `<state>/memora.db`. Cheap to clone (shared connections); `Send + Sync`.
#[derive(Clone)]
pub struct Db {
    inner: Arc<Inner>,
}

/// The read connection together with the change-detection state that is checked on it.
pub(crate) struct Reader {
    pub(crate) conn: Connection,
    pub(crate) watch: WatchState,
}

struct Inner {
    path: PathBuf,
    writer: Mutex<Connection>,
    reader: Mutex<Reader>,
    // Declared last: the connections close before a temp directory is removed.
    _temp: Option<TempDir>,
}

impl std::fmt::Debug for Db {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Db")
            .field("path", &self.inner.path)
            .finish()
    }
}

impl Db {
    /// Open (or create) `<state_dir>/memora.db` owner-only and run pending migrations.
    /// Fails on foreign SQLite files and newer schemas. Needs a local filesystem (WAL).
    pub fn open(state_dir: &Path) -> Result<Db> {
        Self::open_in(state_dir, None)
    }

    /// A fresh database in a new private temporary directory, removed when the last clone
    /// of the handle is dropped. For tests (here and in dependent crates).
    pub fn open_temp() -> Result<Db> {
        let tmp = TempDir::new()?;
        let dir = tmp.0.clone();
        Self::open_in(&dir, Some(tmp))
    }

    fn open_in(state_dir: &Path, temp: Option<TempDir>) -> Result<Db> {
        ensure_private_dir(state_dir)?;
        let path = state_dir.join(DB_FILE);
        ensure_private_file(&path)?;

        let mut writer = open_connection(&path)?;
        // Identify the file before changing anything in it (journal mode included).
        migrate::check_identity(&writer, &path)?;
        enable_wal(&writer, &path)?;
        migrate::run(&mut writer, &path)?;

        let reader = open_connection(&path)?;
        reader.pragma_update(None, "query_only", true)?;
        restrict_db_files(&path);

        let watch = WatchState::new(&reader)?;
        Ok(Db {
            inner: Arc::new(Inner {
                path,
                writer: Mutex::new(writer),
                reader: Mutex::new(Reader {
                    conn: reader,
                    watch,
                }),
                _temp: temp,
            }),
        })
    }

    /// Path of the database file.
    pub fn path(&self) -> &Path {
        &self.inner.path
    }

    /// The state directory holding the database.
    pub fn state_dir(&self) -> &Path {
        self.inner.path.parent().unwrap_or_else(|| Path::new("."))
    }

    /// Run `f` in one `BEGIN IMMEDIATE` write transaction (waits up to [`BUSY_TIMEOUT`] for
    /// another writer). Commits on `Ok`, rolls back on `Err`.
    pub fn write<T>(&self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T> {
        let mut conn = lock(&self.inner.writer);
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    /// Run `f` on the read connection inside one deferred (read) transaction, so several
    /// queries see one consistent snapshot. The connection is `query_only`.
    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let mut reader = lock(&self.inner.reader);
        let tx = reader
            .conn
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    pub(crate) fn reader(&self) -> MutexGuard<'_, Reader> {
        lock(&self.inner.reader)
    }
}

/// Poison-tolerant lock: a panic inside a closure already rolled its transaction back
/// (the `Transaction` guard is dropped while unwinding), so the connection is reusable.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Open one connection with the pragmas every Memora connection uses (section 2,
/// "Connection pragmas"); `journal_mode=WAL` is set once by [`enable_wal`].
fn open_connection(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    // First, so the pragmas below also wait for a lock held by another process.
    conn.busy_timeout(BUSY_TIMEOUT)?;
    conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    conn.pragma_update(None, "trusted_schema", false)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "secure_delete", true)?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    conn.pragma_update(None, "journal_size_limit", JOURNAL_SIZE_LIMIT)?;
    Ok(conn)
}

/// Switch the file to WAL (persistent in the file header, so later connections inherit it).
fn enable_wal(conn: &Connection, path: &Path) -> Result<()> {
    let mode: String = conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get(0))?;
    if !mode.eq_ignore_ascii_case("wal") {
        return Err(Error::Conflict(format!(
            "{}: cannot enable WAL (journal_mode={mode}); the state directory must be on a \
             local filesystem",
            path.display()
        )));
    }
    Ok(())
}

/// Create the state folder owner-only (0700), or tighten an existing one (best effort:
/// a folder owned by another user is left as it is).
fn ensure_private_dir(dir: &Path) -> Result<()> {
    if dir.is_dir() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(dir) {
                if meta.permissions().mode() & 0o077 != 0 {
                    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
                }
            }
        }
        return Ok(());
    }
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Create the database file owner-only before SQLite does (SQLite would use 0644 & umask).
fn ensure_private_file(path: &Path) -> Result<()> {
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    match opts.open(path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Best effort: `memora.db`, `-wal`, `-shm` to 0600. Fails silently for files owned by
/// another user (opening already proved they are usable).
fn restrict_db_files(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for suffix in ["", "-wal", "-shm"] {
            let mut p = path.as_os_str().to_owned();
            p.push(suffix);
            let p = PathBuf::from(p);
            if let Ok(meta) = std::fs::metadata(&p) {
                if meta.permissions().mode() & 0o777 != 0o600 {
                    let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
                }
            }
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// A private temporary directory removed on drop (no extra dependency for tests).
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Result<Self> {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "memora-state-{}-{}-{nanos}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
        }
        Ok(TempDir(dir))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(all(test, unix))]
mod perm_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// An existing state folder that others can read is tightened to 0700 when
    /// the database opens: it holds the database and the sealing key.
    #[test]
    fn an_open_state_folder_is_tightened() {
        let dir = std::env::temp_dir().join(format!(
            "memora-state-perm-{}-{}",
            std::process::id(),
            std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        let db = Db::open(&dir).unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
