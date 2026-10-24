//! `memora-cli db ...`, `/backup` and `/db`: operations on the state database.
//!
//! As root, database work runs in a forked child dropped to the state dir owner
//! ([`as_owner`]), so SQLite never creates root-owned files; the CLI is single-threaded.

use crate::sys::{self, MetadataExt, OpenOptionsExt};
use crate::{fmt_secs, mark, store, Ctx};
use anyhow::{anyhow, bail, Context, Result};
use memora_state::{Connection, Db, APPLICATION_ID, DB_FILE, SCHEMA_VERSION};
use serde_json::{json, Value};
#[cfg(unix)]
use std::io::Read;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Backups kept in `state/backups/` by default.
pub(crate) const DEFAULT_KEEP: usize = 10;
/// Backup folder inside the state dir.
pub(crate) const BACKUP_DIR: &str = "backups";

pub(crate) const DB_HELP: &str = "\
Usage: memora-cli db <COMMAND> [OPTIONS]

  backup [--to PATH] [--keep N]
                 consistent copy of the database, safe while the server runs;
                 default state/backups/memora-<UTC time>.db, mode 0600;
                 keeps the newest N there (default 10)
  restore FILE [--force]
                 verify a backup and replace the database with it; the
                 server must be stopped (--force skips that check); the
                 current database is kept in state/backups/ first
  check          integrity, foreign keys, schema version, permissions, sizes,
                 last backup age; exit status 1 on any problem
  vacuum         drop old rows, optimize, compact, truncate the WAL
  shell [--write]
                 open the database in the sqlite3 shell, read-only unless
                 --write (writes bypass Memora's checks and activity log)
  export-json [DIR]
                 write the database back as the old JSON files (rollback to
                 the previous release); default DIR is the state dir
  help           show this help

Run as root, every command works as the owner of the state dir, so no
root-owned memora.db* files appear.
";

// ---------------------------------------------------------------------------
// Privilege drop
// ---------------------------------------------------------------------------

/// uid / gid the DB work must run as, or `None` to run in-process.
#[cfg(windows)]
fn drop_target(_state: &Path) -> Result<Option<(u32, u32)>> {
    Ok(None)
}

#[cfg(windows)]
fn drop_to(_uid: u32, _gid: u32) -> Result<()> {
    bail!("dropping privileges is not supported on Windows")
}

#[cfg(windows)]
pub(crate) fn as_owner(_state: &Path, f: impl FnOnce() -> Result<Value>) -> Result<Value> {
    f()
}

#[cfg(unix)]
fn drop_target(state: &Path) -> Result<Option<(u32, u32)>> {
    if !sys::is_root() {
        return Ok(None);
    }
    let meta =
        std::fs::metadata(state).with_context(|| format!("state dir {}", state.display()))?;
    if meta.uid() == 0 {
        return Ok(None);
    }
    Ok(Some((
        meta.uid(),
        primary_gid(meta.uid()).unwrap_or(meta.gid()),
    )))
}

/// The primary group of `uid` from the passwd database.
#[cfg(unix)]
fn primary_gid(uid: u32) -> Option<u32> {
    let mut pw: libc::passwd = unsafe { std::mem::zeroed() };
    let mut out: *mut libc::passwd = std::ptr::null_mut();
    let mut buf = vec![0 as libc::c_char; 16 * 1024];
    let rc = unsafe { libc::getpwuid_r(uid, &mut pw, buf.as_mut_ptr(), buf.len(), &mut out) };
    (rc == 0 && !out.is_null()).then_some(pw.pw_gid)
}

/// Irreversibly become `uid:gid` (no supplementary groups), umask 077.
#[cfg(unix)]
fn drop_to(uid: u32, gid: u32) -> Result<()> {
    unsafe {
        if libc::setgroups(0, std::ptr::null()) != 0 {
            bail!("setgroups: {}", std::io::Error::last_os_error());
        }
        if libc::setgid(gid) != 0 {
            bail!("setgid({gid}): {}", std::io::Error::last_os_error());
        }
        if libc::setuid(uid) != 0 {
            bail!("setuid({uid}): {}", std::io::Error::last_os_error());
        }
        if libc::geteuid() != uid || libc::getegid() != gid || libc::setuid(0) == 0 {
            bail!("could not drop privileges to {uid}:{gid}");
        }
        libc::umask(0o077);
    }
    Ok(())
}

#[cfg(unix)]
fn flush_stdio() {
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
}

/// Run `f` as the owner of `state` (see the module docs). `f` may print; its
/// result or error comes back to the caller.
#[cfg(unix)]
pub(crate) fn as_owner(state: &Path, f: impl FnOnce() -> Result<Value>) -> Result<Value> {
    let Some((uid, gid)) = drop_target(state)? else {
        return f();
    };
    let mut fds = [0 as libc::c_int; 2];
    if unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) } != 0 {
        bail!("pipe: {}", std::io::Error::last_os_error());
    }
    flush_stdio();
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        bail!("fork: {}", std::io::Error::last_os_error());
    }
    if pid == 0 {
        // child: drop privileges, run, report, _exit (never return)
        unsafe { libc::close(fds[0]) };
        let out = drop_to(uid, gid).and_then(|_| {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
                .unwrap_or_else(|p| Err(anyhow!("internal error: {}", panic_text(&p))))
        });
        let msg = match out {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "err": format!("{e:#}") }),
        };
        flush_stdio();
        let mut pipe = unsafe { <std::fs::File as std::os::fd::FromRawFd>::from_raw_fd(fds[1]) };
        let _ = pipe.write_all(msg.to_string().as_bytes());
        drop(pipe);
        unsafe { libc::_exit(0) };
    }
    unsafe { libc::close(fds[1]) };
    let mut pipe = unsafe { <std::fs::File as std::os::fd::FromRawFd>::from_raw_fd(fds[0]) };
    let mut raw = String::new();
    let read = pipe.read_to_string(&mut raw);
    let mut status = 0;
    unsafe { libc::waitpid(pid, &mut status, 0) };
    read.context("reading the result of the database worker")?;
    let v: Value = serde_json::from_str(&raw).map_err(|_| {
        anyhow!("database worker (running as uid {uid}) died unexpectedly (wait status {status})")
    })?;
    match (v.get("ok"), v.get("err")) {
        (Some(ok), _) => Ok(ok.clone()),
        (_, Some(e)) => {
            let e = e.as_str().unwrap_or("unknown error");
            if e.contains("Permission denied") {
                bail!(
                    "{e}\n  (database work runs as uid {uid}, the owner of the state dir {};\n  \
                     that user needs access to the paths involved)",
                    state.display()
                );
            }
            bail!("{e}")
        }
        _ => bail!("database worker sent an invalid reply"),
    }
}

/// Open the existing database as the state dir owner and run `f` on it.
pub(crate) fn with_db_as_owner(
    state: &Path,
    f: impl FnOnce(&Db) -> Result<Value>,
) -> Result<Value> {
    let state = state.to_path_buf();
    as_owner(&state.clone(), move || f(&open_existing(&state)?))
}

/// Open (creating and migrating if needed) the state database as the state dir owner,
/// then run `f` on it. As root, the state dir must already exist.
pub(crate) fn with_state_db(state: &Path, f: impl FnOnce(&Db) -> Result<Value>) -> Result<Value> {
    if sys::is_root() && !state.is_dir() {
        bail!(
            "state dir {} does not exist; start the memora server once (it creates it) \
             or pass --state",
            state.display()
        );
    }
    let dir = state.to_path_buf();
    as_owner(state, move || {
        let db =
            Db::open(&dir).with_context(|| format!("opening {}", dir.join(DB_FILE).display()))?;
        let report = memora_state::legacy::import_legacy(&db, &dir)
            .context("importing the legacy JSON state files")?;
        if report.status == memora_state::legacy::ImportStatus::Imported {
            let rows: Vec<String> = report
                .rows
                .iter()
                .map(|(t, n)| format!("{t} {n}"))
                .collect();
            eprintln!(
                "{} imported the old JSON state into {} ({}){}",
                mark(true),
                DB_FILE,
                if rows.is_empty() {
                    "nothing to copy".to_string()
                } else {
                    rows.join(", ")
                },
                report
                    .archived_to
                    .as_ref()
                    .map(|p| format!("; old files moved to {}", p.display()))
                    .unwrap_or_default()
            );
            if !report.dropped_secrets.is_empty() {
                eprintln!(
                    "  note: {} from the old env file {} not stored (secrets never are);\n  \
                     use /setup, /reset or /config -> create a default API key",
                    report.dropped_secrets.join(", "),
                    if report.dropped_secrets.len() == 1 {
                        "was"
                    } else {
                        "were"
                    }
                );
            }
        }
        f(&db)
    })
}

/// [`Db::open`] for an existing database only (`db ...` never creates one).
fn open_existing(state: &Path) -> Result<Db> {
    require_db(state)?;
    Db::open(state).with_context(|| format!("opening {}", state.join(DB_FILE).display()))
}

/// Path of the database file; an error when it does not exist.
fn require_db(state: &Path) -> Result<PathBuf> {
    let path = state.join(DB_FILE);
    std::fs::metadata(state).with_context(|| format!("state dir {}", state.display()))?;
    if !path.is_file() {
        bail!(
            "no state database at {} (the memora server creates it on its first start)",
            path.display()
        );
    }
    Ok(path)
}

/// A plain connection, for statements that cannot run inside the transactions
/// [`Db`] uses (VACUUM, VACUUM INTO, some pragmas).
fn raw_conn(path: &Path) -> Result<Connection> {
    let c = Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
    c.busy_timeout(memora_state::db::BUSY_TIMEOUT)?;
    Ok(c)
}

/// The message of a caught panic.
#[cfg(unix)]
fn panic_text(p: &Box<dyn std::any::Any + Send>) -> String {
    p.downcast_ref::<String>()
        .cloned()
        .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_else(|| "panic".into())
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/// `YYYYMMDD-HHMMSS` in UTC.
pub(crate) fn utc_stamp(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    // civil_from_days (H. Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}{m:02}{d:02}-{:02}{:02}{:02}",
        sod / 3600,
        sod % 3600 / 60,
        sod % 60
    )
}

/// `512 B`, `1.5 KiB`, ...
fn human_bytes(n: u64) -> String {
    const U: [&str; 4] = ["B", "KiB", "MiB", "GiB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < U.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{n} B")
    } else {
        format!("{v:.1} {}", U[i])
    }
}

/// `4m 05s`, `5h 03m` or `3 days`.
fn human_age(secs: i64) -> String {
    match secs {
        s if s < 3600 => fmt_secs(s.max(0)),
        s if s < 2 * 86_400 => format!("{}h {:02}m", s / 3600, s % 3600 / 60),
        s => format!("{} days", s / 86_400),
    }
}

/// `path` with `suffix` appended to the file name.
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut p = path.as_os_str().to_owned();
    p.push(suffix);
    PathBuf::from(p)
}

fn fsync_dir(dir: &Path) {
    if let Ok(f) = std::fs::File::open(dir) {
        let _ = f.sync_all();
    }
}

/// Create an empty 0600 file (VACUUM INTO accepts an existing empty file and keeps its mode).
fn create_private(path: &Path) -> Result<()> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .with_context(|| format!("creating {}", path.display()))?;
    Ok(())
}

/// Windows has no /proc: the pid of the server `memora-cli start` launched.
#[cfg(windows)]
fn db_holders(db: &Path) -> Vec<u32> {
    db.parent()
        .and_then(crate::lifecycle::started_pid)
        .into_iter()
        .collect()
}

/// Pids of other processes holding `memora.db*` open (only our own processes
/// unless run as root).
#[cfg(unix)]
fn db_holders(db: &Path) -> Vec<u32> {
    let names: Vec<PathBuf> = ["", "-wal", "-shm"]
        .iter()
        .map(|s| {
            let p = with_suffix(db, s);
            p.canonicalize().unwrap_or(p)
        })
        .collect();
    let me = std::process::id();
    let mut pids = Vec::new();
    let Ok(procs) = std::fs::read_dir("/proc") else {
        return pids;
    };
    for e in procs.flatten() {
        let Some(pid) = e.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        if pid == me {
            continue;
        }
        let Ok(fds) = std::fs::read_dir(e.path().join("fd")) else {
            continue;
        };
        if fds
            .flatten()
            .filter_map(|fd| std::fs::read_link(fd.path()).ok())
            .any(|t| names.contains(&t))
        {
            pids.push(pid);
        }
    }
    pids
}

// ---------------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------------

/// Consistent online copy via `VACUUM INTO`, integrity-checked, mode 0600.
/// Runs as the owner; returns `{path, size, keep, removed}`.
pub(crate) fn backup(ctx: &Ctx, to: Option<&Path>, keep: usize) -> Result<Value> {
    let state = ctx.state.clone();
    let to = to.map(|p| std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf()));
    as_owner(&ctx.state, move || {
        backup_inner(&state, to.as_deref(), keep)
    })
}

fn backup_inner(state: &Path, to: Option<&Path>, keep: usize) -> Result<Value> {
    let db = open_existing(state)?;
    let src = db.path().to_path_buf();
    drop(db);
    let default_dir = state.join(BACKUP_DIR);
    let stamp = utc_stamp(memora_state::now());
    let target = match to {
        Some(p) if p.is_dir() => unique(&p.join(format!("memora-{stamp}.db"))),
        Some(p) => {
            if p.exists() {
                bail!("{} already exists; choose another name", p.display());
            }
            p.to_path_buf()
        }
        None => {
            std::fs::create_dir_all(&default_dir)?;
            sys::make_private_dir(&default_dir)?;
            unique(&default_dir.join(format!("memora-{stamp}.db")))
        }
    };
    copy_db(&src, &target)?;
    let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    let mut removed = Vec::new();
    let rotated = target.parent() == Some(default_dir.as_path());
    if rotated {
        let mut all = rotation_set(&default_dir);
        // oldest first: by modification time, then name
        all.sort_by_key(|p| {
            (
                std::fs::metadata(p).and_then(|m| m.modified()).ok(),
                p.clone(),
            )
        });
        while all.len() > keep.max(1) {
            let old = all.remove(0);
            if std::fs::remove_file(&old).is_ok() {
                removed.push(old.display().to_string());
            }
        }
    }
    Ok(json!({
        "path": target.display().to_string(),
        "size": size,
        "keep": rotated.then_some(keep),
        "removed": removed,
    }))
}

/// `path`, or `path` with `-2`, `-3`, ... before `.db` when it already exists.
fn unique(path: &Path) -> PathBuf {
    let mut p = path.to_path_buf();
    let stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let mut n = 2;
    while p.exists() {
        p = path.with_file_name(format!("{stem}-{n}.db"));
        n += 1;
    }
    p
}

/// Backups subject to rotation: `memora-<stamp>.db` (pre-restore copies are kept).
fn rotation_set(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    let n = p.file_name().unwrap_or_default().to_string_lossy();
                    n.starts_with("memora-") && n.ends_with(".db") && !n.contains("pre-restore")
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `VACUUM INTO target` (0600), switch the copy to rollback journal mode so it
/// is self-contained, then `integrity_check` it. Removes the target on failure.
fn copy_db(src: &Path, target: &Path) -> Result<()> {
    create_private(target)?;
    let res = (|| -> Result<()> {
        let conn = raw_conn(src)?;
        conn.execute("VACUUM INTO ?1", [target.to_string_lossy()])
            .context("VACUUM INTO")?;
        drop(conn);
        let copy = raw_conn(target)?;
        let _: String = copy.query_row("PRAGMA journal_mode=DELETE", [], |r| r.get(0))?;
        let ic: String = copy.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        if ic != "ok" {
            bail!("integrity_check of the copy failed: {ic}");
        }
        drop(copy);
        // Opened for writing: Windows refuses to flush a read-only handle.
        std::fs::OpenOptions::new()
            .write(true)
            .open(target)?
            .sync_all()?;
        Ok(())
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(target);
        let _ = std::fs::remove_file(with_suffix(target, "-journal"));
    }
    if let Some(dir) = target.parent() {
        fsync_dir(dir);
    }
    res
}

/// Report of a finished backup.
fn print_backup(v: &Value) {
    println!(
        "{} Backup written: {} ({})",
        mark(true),
        v["path"].as_str().unwrap_or("?"),
        human_bytes(v["size"].as_u64().unwrap_or(0))
    );
    println!("  Consistent snapshot, checked with integrity_check, mode 0600.");
    if let Some(k) = v["keep"].as_u64() {
        let removed = v["removed"].as_array().map(Vec::len).unwrap_or(0);
        print!("  The newest {k} backups in this folder are kept");
        if removed > 0 {
            println!("; removed {removed} older one(s).");
        } else {
            println!(".");
        }
    }
    println!("  Restore with `memora-cli db restore <file>` (stop the server first).");
}

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

/// Verify `file` and put it in place of `memora.db`. Returns the exit code.
fn restore(ctx: &Ctx, file: &Path, force: bool) -> Result<i32> {
    // read as the caller: root may read backups the server user cannot
    let bytes = std::fs::read(file).with_context(|| format!("reading {}", file.display()))?;
    let db = ctx.state.join(DB_FILE);
    let holders = db_holders(&db);
    if ctx.server.is_some() || !holders.is_empty() {
        let mut who: Vec<String> = holders.iter().map(|p| p.to_string()).collect();
        if let Some(s) = &ctx.server {
            if !holders.contains(&s.pid) {
                who.push(s.pid.to_string());
            }
        }
        let stop = ctx
            .server_unit()
            .map(|u| format!("systemctl stop {u}"))
            .unwrap_or_else(|| {
                "stop the memora server (memora-cli stop, systemctl stop <unit> or docker stop)"
                    .into()
            });
        if !force {
            eprintln!(
                "{} The database is in use (pid {}). A restore must not replace it under\n  \
                 a running server: the server would keep using the old file and could\n  \
                 write into the new one inconsistently.\n  \
                 Stop it first: {stop}\n  \
                 then run this again and start the server afterwards.\n  \
                 (--force skips this check; use it only if nothing is running.)",
                mark(false),
                who.join(", ")
            );
            return Ok(1);
        }
        eprintln!(
            "WARNING: --force: pid {} still has the database open; restart it right after.",
            who.join(", ")
        );
    }
    let state = ctx.state.clone();
    let src = file.display().to_string();
    let v = as_owner(&ctx.state, move || restore_inner(&state, &src, &bytes))?;
    println!(
        "{} Restored {} into {}",
        mark(true),
        file.display(),
        v["db"].as_str().unwrap_or("?")
    );
    println!(
        "  Checked first: Memora application_id, schema version {} (this binary\n  \
         supports {SCHEMA_VERSION}), integrity_check ok, no foreign key errors.",
        v["version"]
    );
    match v["previous"].as_str() {
        Some(p) => println!("  The database it replaced is kept at {p}"),
        None => println!("  There was no previous database to keep."),
    }
    if ctx.server.is_some() {
        println!("  Restart the server now so it uses the restored database.");
    } else {
        println!("  Start the server when ready.");
    }
    Ok(0)
}

/// Verify a candidate database file: `Ok(user_version)` or a plain-language error.
fn verify_candidate(path: &Path) -> Result<i64> {
    let c = raw_conn(path)?;
    c.pragma_update(None, "query_only", true)?;
    let app: i64 = c
        .query_row("PRAGMA application_id", [], |r| r.get(0))
        .context("not an SQLite database (or badly damaged)")?;
    if app != APPLICATION_ID {
        bail!(
            "not a Memora state database (application_id {app:#x}, expected {APPLICATION_ID:#x})"
        );
    }
    let ver: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if ver > SCHEMA_VERSION {
        bail!(
            "schema version {ver} is newer than this memora-cli supports \
             ({SCHEMA_VERSION}); use the matching release"
        );
    }
    let ic = integrity(&c)?;
    if ic != ["ok"] {
        bail!("integrity_check failed: {}", ic.join("; "));
    }
    let fk = fk_errors(&c)?;
    if fk > 0 {
        bail!("foreign_key_check found {fk} broken reference(s)");
    }
    Ok(ver)
}

/// Write `bytes` next to the database, verify them, keep the old database in
/// the backup folder and swap the new one in. Runs as the owner.
fn restore_inner(state: &Path, src: &str, bytes: &[u8]) -> Result<Value> {
    std::fs::metadata(state).with_context(|| format!("state dir {}", state.display()))?;
    let db = state.join(DB_FILE);
    let tmp = with_suffix(&db, ".restore");
    for s in ["", "-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(with_suffix(&tmp, s));
    }
    create_private(&tmp)?;
    let check = (|| -> Result<i64> {
        let mut f = std::fs::OpenOptions::new().write(true).open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        verify_candidate(&tmp)
    })();
    let version = match check {
        Ok(v) => v,
        Err(e) => {
            for s in ["", "-wal", "-shm", "-journal"] {
                let _ = std::fs::remove_file(with_suffix(&tmp, s));
            }
            bail!("{src} was NOT restored, nothing was changed: {e:#}");
        }
    };
    // keep the database being replaced
    let mut previous = None;
    if db.exists() {
        let dir = state.join(BACKUP_DIR);
        std::fs::create_dir_all(&dir)?;
        sys::make_private_dir(&dir)?;
        let keep = unique(&dir.join(format!(
            "memora-{}-pre-restore.db",
            utc_stamp(memora_state::now())
        )));
        if let Err(e) = copy_db(&db, &keep) {
            // damaged database: keep the raw files instead
            eprintln!(
                "note: could not snapshot the current database ({e:#}); keeping its raw files"
            );
            for s in ["", "-wal"] {
                let from = with_suffix(&db, s);
                if from.exists() {
                    std::fs::copy(&from, with_suffix(&keep, s))
                        .with_context(|| format!("keeping {}", from.display()))?;
                }
            }
        }
        previous = Some(keep.display().to_string());
    }
    // the old database's WAL / SHM must not be applied to the new one
    for s in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(with_suffix(&db, s));
    }
    if let Err(e) = std::fs::rename(&tmp, &db) {
        let _ = std::fs::remove_file(&tmp);
        // Windows: a database another process has open cannot be replaced.
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            bail!(
                "{} is in use, so it was not replaced (is the memora server still running? \
                 stop it first); the current database is unchanged",
                db.display()
            );
        }
        return Err(anyhow!(e).context("putting the restored database in place"));
    }
    let _ = std::fs::remove_file(with_suffix(&tmp, "-journal"));
    fsync_dir(state);
    // Db::open migrates an older backup.
    let opened = Db::open(state).context("opening the restored database")?;
    let detail: String = format!("restored from {src}").chars().take(2000).collect();
    opened.write(|tx| store::log(tx, "state_restored", &detail))?;
    Ok(json!({ "db": db.display().to_string(), "version": version, "previous": previous }))
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

/// `integrity_check` rows (`["ok"]` when healthy).
fn integrity(c: &Connection) -> Result<Vec<String>> {
    let mut st = c.prepare("PRAGMA integrity_check(20)")?;
    let rows = st.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Number of `foreign_key_check` violations.
fn fk_errors(c: &Connection) -> Result<usize> {
    let mut st = c.prepare("PRAGMA foreign_key_check")?;
    let mut rows = st.query([])?;
    let mut n = 0;
    while rows.next()?.is_some() {
        n += 1;
    }
    Ok(n)
}

/// Newest `*.db` in `state/backups/` and its age in seconds.
fn last_backup(state: &Path) -> Option<(PathBuf, i64)> {
    let newest = std::fs::read_dir(state.join(BACKUP_DIR))
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "db"))
        .filter_map(|e| Some((e.path(), e.metadata().ok()?.modified().ok()?)))
        .max_by_key(|(_, t)| *t)?;
    let age = newest.1.elapsed().map(|d| d.as_secs() as i64).unwrap_or(0);
    Some((newest.0, age))
}

/// Print the health report. Runs as the owner; returns `{problems, warnings}`.
pub(crate) fn check(ctx: &Ctx) -> Result<Value> {
    let state = ctx.state.clone();
    as_owner(&ctx.state, move || check_inner(&state))
}

fn check_inner(state: &Path) -> Result<Value> {
    let mut problems = 0;
    let mut warnings = 0;
    let mut line = |ok: Option<bool>, what: &str, detail: String| {
        let m = match ok {
            Some(true) => "✓",
            Some(false) => {
                problems += 1;
                "✗"
            }
            None => {
                warnings += 1;
                "!"
            }
        };
        println!("{m} {what:<18} {detail}");
    };
    let db = state.join(DB_FILE);
    println!("Database: {}", db.display());
    let dir_meta =
        std::fs::metadata(state).with_context(|| format!("state dir {}", state.display()))?;
    let dir_mode = dir_meta.mode() & 0o777;
    line(
        if dir_mode & 0o077 == 0 {
            Some(true)
        } else {
            None
        },
        "state dir",
        format!(
            "mode {dir_mode:o}, owner uid {}{}",
            dir_meta.uid(),
            if dir_mode & 0o077 == 0 {
                ""
            } else {
                " (recommended 700: chmod 700)"
            }
        ),
    );
    if !db.is_file() {
        line(
            Some(false),
            "database",
            "missing (the server creates it on its first start)".into(),
        );
        return Ok(json!({ "problems": problems, "warnings": warnings }));
    }
    let mut total = 0u64;
    for s in ["", "-wal", "-shm"] {
        let p = with_suffix(&db, s);
        let Ok(m) = std::fs::metadata(&p) else {
            continue;
        };
        total += m.len();
        let mode = m.mode() & 0o777;
        let name = format!("{DB_FILE}{s}");
        let mut issues = Vec::new();
        if mode & 0o077 != 0 {
            issues.push(format!("readable by others (chmod 600 {})", p.display()));
        }
        if m.uid() != dir_meta.uid() {
            issues.push(format!(
                "owned by uid {} but the state dir by uid {}; the server may not open it (chown {} {})",
                m.uid(), dir_meta.uid(), dir_meta.uid(), p.display()
            ));
        }
        let size = human_bytes(m.len());
        if issues.is_empty() {
            line(
                Some(true),
                &name,
                format!("{size}, mode {mode:o}, uid {}", m.uid()),
            );
        } else {
            line(
                Some(false),
                &name,
                format!("{size}, mode {mode:o}: {}", issues.join("; ")),
            );
        }
        if s == "-wal" && m.len() > 64 * 1024 * 1024 {
            line(
                None,
                "WAL size",
                format!("{size} is large; `memora-cli db vacuum` truncates it"),
            );
        }
    }
    line(Some(true), "total size", human_bytes(total));

    let c = match raw_conn(&db).and_then(|c| {
        c.pragma_update(None, "query_only", true)?;
        Ok(c)
    }) {
        Ok(c) => c,
        Err(e) => {
            line(Some(false), "open", format!("{e:#}"));
            return Ok(json!({ "problems": problems, "warnings": warnings }));
        }
    };
    match c.query_row("PRAGMA application_id", [], |r| r.get::<_, i64>(0)) {
        Ok(a) if a == APPLICATION_ID => {
            line(Some(true), "application_id", format!("{a:#x} (Memora)"))
        }
        Ok(a) => line(
            Some(false),
            "application_id",
            format!("{a:#x}: not a Memora database"),
        ),
        Err(e) => line(Some(false), "application_id", format!("unreadable: {e}")),
    }
    match c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)) {
        Ok(v) if v == SCHEMA_VERSION => {
            line(Some(true), "schema version", format!("{v} (current)"))
        }
        Ok(v) if v < SCHEMA_VERSION => line(
            None,
            "schema version",
            format!("{v}; upgraded to {SCHEMA_VERSION} on the next open"),
        ),
        Ok(v) => line(
            Some(false),
            "schema version",
            format!("{v}, newer than this binary ({SCHEMA_VERSION}); update memora-cli"),
        ),
        Err(e) => line(Some(false), "schema version", format!("unreadable: {e}")),
    }
    match integrity(&c) {
        Ok(r) if r == ["ok"] => line(Some(true), "integrity_check", "ok".into()),
        Ok(r) => line(
            Some(false),
            "integrity_check",
            format!("DAMAGED: {}", r.join("; ")),
        ),
        Err(e) => line(Some(false), "integrity_check", format!("DAMAGED: {e}")),
    }
    match fk_errors(&c) {
        Ok(0) => line(Some(true), "foreign_key_check", "ok".into()),
        Ok(n) => line(
            Some(false),
            "foreign_key_check",
            format!("{n} broken reference(s)"),
        ),
        Err(e) => line(Some(false), "foreign_key_check", format!("failed: {e}")),
    }
    let counts = (|| -> Result<Vec<(String, i64)>> {
        let mut st = c.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?;
        let names: Vec<String> = st.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        names
            .into_iter()
            .map(|n| {
                let q = format!("SELECT count(*) FROM \"{}\"", n.replace('"', "\"\""));
                Ok((n, c.query_row(&q, [], |r| r.get(0))?))
            })
            .collect()
    })();
    match counts {
        Ok(v) => {
            let s: Vec<String> = v
                .iter()
                .filter(|(_, n)| *n > 0)
                .map(|(t, n)| format!("{t} {n}"))
                .collect();
            line(
                Some(true),
                "rows",
                if s.is_empty() {
                    "all tables empty".into()
                } else {
                    s.join(", ")
                },
            );
        }
        Err(e) => line(Some(false), "rows", format!("could not count: {e:#}")),
    }
    match last_backup(state) {
        Some((p, age)) if age <= 7 * 86_400 => line(
            Some(true),
            "last backup",
            format!("{} ago ({})", human_age(age), p.display()),
        ),
        Some((p, age)) => line(
            None,
            "last backup",
            format!(
                "{} ago ({}); run `memora-cli db backup`",
                human_age(age),
                p.display()
            ),
        ),
        None => line(
            None,
            "last backup",
            "none in state/backups; run `memora-cli db backup`".into(),
        ),
    }
    Ok(json!({ "problems": problems, "warnings": warnings }))
}

/// Summary line of `check`; true when healthy.
fn print_check_summary(v: &Value) -> bool {
    let p = v["problems"].as_u64().unwrap_or(1);
    let w = v["warnings"].as_u64().unwrap_or(0);
    if p == 0 {
        println!(
            "\n{} Database healthy{}.",
            mark(true),
            if w > 0 {
                format!(" ({w} warning(s) marked !)")
            } else {
                String::new()
            }
        );
    } else {
        println!(
            "\n{} {p} problem(s) found (marked ✗). Fix them, or restore a backup with\n  \
             `memora-cli db restore <file>` (stop the server first).",
            mark(false)
        );
    }
    p == 0
}

// ---------------------------------------------------------------------------
// vacuum
// ---------------------------------------------------------------------------

/// Drop old rows, `optimize`, `VACUUM`, `wal_checkpoint(TRUNCATE)`. Runs as the
/// owner.
pub(crate) fn vacuum(ctx: &Ctx) -> Result<Value> {
    with_db_as_owner(&ctx.state, |db| {
        let path = db.path().to_path_buf();
        let size = |p: &Path| -> u64 {
            ["", "-wal"]
                .iter()
                .filter_map(|s| std::fs::metadata(with_suffix(p, s)).ok())
                .map(|m| m.len())
                .sum()
        };
        let before = size(&path);
        let policy = memora_state::retention::RetentionPolicy::default();
        let r = memora_state::retention::prune(db, &policy, memora_state::now())?;
        println!(
            "{} Dropped old rows: activity {}, key events {}, sessions {},\n  \
             trashed keys {}, control requests {}",
            mark(true),
            r.activity,
            r.key_events,
            r.sessions,
            r.keys_purged,
            r.control_deleted + r.control_expired
        );
        let c = raw_conn(&path)?;
        c.execute_batch("PRAGMA optimize; VACUUM;")
            .context("VACUUM")?;
        let _: (i64, i64, i64) = c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?;
        drop(c);
        let after = size(&path);
        println!(
            "{} Compacted: {} -> {} (optimize, VACUUM, WAL checkpoint+truncate)",
            mark(true),
            human_bytes(before),
            human_bytes(after)
        );
        Ok(json!({ "before": before, "after": after }))
    })
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

/// An executable named `bin` on $PATH.
fn find_in_path(bin: &str) -> Option<PathBuf> {
    std::env::var_os("PATH")?
        .to_string_lossy()
        .split(sys::PATH_LIST_SEP)
        .map(|d| Path::new(d).join(format!("{bin}{}", std::env::consts::EXE_SUFFIX)))
        .find(|p| sys::is_executable(p))
}

/// `db shell`: exec `sqlite3` on the database as the state dir owner.
fn shell(ctx: &Ctx, write: bool) -> Result<i32> {
    let db = require_db(&ctx.state)?;
    let Some(bin) = find_in_path("sqlite3") else {
        eprintln!(
            "{} The sqlite3 command-line shell is not installed.\n  Debian/Ubuntu: apt install sqlite3\n  Fedora/RHEL:   dnf install sqlite\n  Alpine:        apk add sqlite\n  Then run `memora-cli db shell` again.",
            mark(false)
        );
        return Ok(1);
    };
    if write {
        eprintln!(
            "\n  !!! WRITE MODE !!!\n  \
             Changes made here bypass Memora's checks and are NOT recorded in the\n  \
             activity log. Take a backup first (`memora-cli db backup`) and prefer\n  \
             the memora-cli commands for changes.\n"
        );
    } else {
        eprintln!(
            "Read-only shell on {} (--write allows changes).\n\
             Try .tables, .schema <table>, .quit",
            db.display()
        );
    }
    if let Some((uid, gid)) = drop_target(&ctx.state)? {
        drop_to(uid, gid)?;
    }
    let mut cmd = std::process::Command::new(bin);
    if !write {
        cmd.arg("-readonly");
    }
    cmd.arg(&db);
    Err(anyhow!("running sqlite3: {}", sys::exec(&mut cmd)))
}

// ---------------------------------------------------------------------------
// export-json
// ---------------------------------------------------------------------------

/// `db export-json [DIR]`: write the database back as the old JSON files.
fn export_json(ctx: &Ctx, dir: Option<&Path>) -> Result<i32> {
    let target = dir
        .map(|p| std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf()))
        .unwrap_or_else(|| ctx.state.clone());
    let v = with_db_as_owner(&ctx.state, move |db| {
        if !target.is_dir() {
            bail!("{} is not a directory", target.display());
        }
        let files = memora_state::legacy::export_json(db, &target)?;
        let files: Vec<String> = files.iter().map(|p| p.display().to_string()).collect();
        Ok(json!({ "files": files }))
    })?;
    println!("{} Wrote the old JSON files:", mark(true));
    for f in v["files"].as_array().into_iter().flatten() {
        println!("  {}", f.as_str().unwrap_or("?"));
    }
    Ok(0)
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/// Print a `db` usage error and exit with status 2.
fn sub_usage(msg: &str) -> ! {
    eprintln!("memora-cli db: {msg}");
    eprintln!("Try `memora-cli db help`.");
    std::process::exit(2);
}

/// `memora-cli db <sub> ...`; `args` are everything after `db` except `--state`.
/// Returns the process exit code.
pub(crate) fn cli(ctx: &Ctx, args: &[String]) -> Result<i32> {
    let Some(sub) = args.first() else {
        eprint!("{DB_HELP}");
        return Ok(2);
    };
    let mut pos: Vec<&str> = Vec::new();
    let (mut to, mut keep, mut force, mut write) = (None, DEFAULT_KEEP, false, false);
    let mut it = args[1..].iter();
    while let Some(a) = it.next() {
        let (flag, inline) = match a.split_once('=') {
            Some((f, v)) if f.starts_with("--") => (f, Some(v.to_string())),
            _ => (a.as_str(), None),
        };
        let mut value = || {
            inline
                .clone()
                .or_else(|| it.next().cloned())
                .unwrap_or_else(|| sub_usage(&format!("{flag} needs a value")))
        };
        match (sub.as_str(), flag) {
            ("backup", "--to") => to = Some(PathBuf::from(value())),
            ("backup", "--keep") => {
                keep = value()
                    .parse()
                    .ok()
                    .filter(|n| *n > 0)
                    .unwrap_or_else(|| sub_usage("--keep expects a positive number"))
            }
            ("restore", "--force") if inline.is_none() => force = true,
            ("shell", "--write") if inline.is_none() => write = true,
            (_, f) if f.starts_with('-') && f != "-" => {
                sub_usage(&format!("`{sub}` does not take `{a}`"))
            }
            _ => pos.push(a),
        }
    }
    let max_pos = match sub.as_str() {
        "restore" | "export-json" | "backup" => 1,
        _ => 0,
    };
    if pos.len() > max_pos {
        sub_usage(&format!("`{sub}` does not take `{}`", pos[max_pos]));
    }
    match sub.as_str() {
        "help" => {
            print!("{DB_HELP}");
            Ok(0)
        }
        "backup" => {
            // `db backup PATH` is the same as `--to PATH`
            let to = to.or_else(|| pos.first().map(PathBuf::from));
            print_backup(&backup(ctx, to.as_deref(), keep)?);
            Ok(0)
        }
        "restore" => {
            let Some(file) = pos.first() else {
                sub_usage("restore needs the backup FILE")
            };
            restore(ctx, Path::new(file), force)
        }
        "check" => Ok(if print_check_summary(&check(ctx)?) {
            0
        } else {
            1
        }),
        "vacuum" => {
            vacuum(ctx)?;
            Ok(0)
        }
        "shell" => shell(ctx, write),
        "export-json" => export_json(ctx, pos.first().map(Path::new)),
        other => sub_usage(&format!("unknown db command `{other}`")),
    }
}

/// Console `/backup`.
pub(crate) fn console_backup(ctx: &Ctx) -> Result<()> {
    print_backup(&backup(ctx, None, DEFAULT_KEEP)?);
    Ok(())
}

/// Console `/db [check|vacuum|backup]`.
pub(crate) fn console(ctx: &Ctx, arg: Option<&str>) -> Result<()> {
    match arg {
        Some("check") => {
            print_check_summary(&check(ctx)?);
        }
        Some("vacuum") => {
            vacuum(ctx)?;
        }
        Some("backup") => console_backup(ctx)?,
        other => {
            if let Some(o) = other {
                println!("Unknown /db command `{o}`.");
            }
            println!("State database {}:", ctx.state.join(DB_FILE).display());
            println!("  /db check   health check: damage, permissions, sizes, last backup");
            println!("  /db backup  safe copy now (same as /backup)");
            println!("  /db vacuum  tidy up: drop old log rows, compact the file");
            println!("Restore, shell and export-json: see `memora-cli db help`.");
        }
    }
    Ok(())
}
