//! Opening the state database, connection pragmas, file permissions, and the
//! transaction helpers [`Db::write`] / [`Db::read`].
//!
//! Connection model (docs/DATABASE.md section 3.2): one write connection behind a mutex,
//! one read connection behind a mutex. Operations take microseconds, so no pool is needed.
//! Other processes (`memora-cli`) open their own [`Db`] on the same file; WAL gives them
//! concurrent readers and `BEGIN IMMEDIATE` + `busy_timeout` serialise writers.

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
    /// Open (or create) `<state_dir>/memora.db` and bring the schema up to date.
    ///
    /// * creates `state_dir` (mode 0700) when it does not exist;
    /// * creates the database file with mode 0600, and tightens `memora.db`, `-wal`,
    ///   `-shm` to 0600 (SQLite creates `-wal`/`-shm` with the database file's mode);
    /// * refuses foreign SQLite files ([`Error::ForeignFile`]) and schemas newer than this
    ///   binary ([`Error::TooNew`]);
    /// * runs pending migrations, each in its own `BEGIN IMMEDIATE` transaction.
    ///
    /// The database must be on a local filesystem (WAL needs shared memory).
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

    /// Run `f` in one write transaction started with `BEGIN IMMEDIATE` (the write lock is
    /// taken up front, so there is no read-to-write upgrade deadlock; a concurrent writer
    /// in another process makes this wait up to [`BUSY_TIMEOUT`]).
    ///
    /// Commits when `f` returns `Ok`, rolls back when it returns `Err`. Compose several
    /// repository calls inside one closure to make a multi-step operation atomic.
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

fn ensure_private_dir(dir: &Path) -> Result<()> {
    if dir.is_dir() {
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
