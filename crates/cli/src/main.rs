//! `memora-cli`: owner and setup-window tool for the memora server.
//!
//! Every command reads and writes the state database `state/memora.db`
//! (`store.rs`). Run as root, database work happens as the owner of the state
//! dir (`db.rs`), so no root-owned `memora.db*` files appear.

mod db;
mod manage;
mod store;
mod sys;
mod tui;
mod update;

use memora_state::arm::{self, ArmMode};
use memora_state::{control, owner, settings};
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use store::Snapshot;

/// Default window length, in minutes.
pub(crate) const DEFAULT_MINUTES: i64 = 5;
/// Longest window accepted, in minutes.
pub(crate) const MAX_MINUTES: i64 = 60;

const HELP: &str = "\
memora-cli - Memora's server console
Second brain for your AI

Sets up and looks after the Memora server on this machine: the owner
account, browser sign-in codes, the vault folder, the database and updates.

Usage: memora-cli [COMMAND] [OPTIONS]

With no command, an interactive console opens on a terminal; without a
terminal, no command means `status`.

Get started:
  setup               open the first-run setup window, print its one-time code
  status              show state dir, vault, owner, window and lock
  vault [PATH]        show the vault folder, or set it (restart the server
                      afterwards)

Access & accounts:
  reset-password      open a password reset window, print its one-time code
  disarm              close the open window without locking
  unlock              lift the lock; the owner account stays as it is
  list                list the owner and the API keys
  clear-cooldowns     make the running server clear all login cooldowns
                      (waits up to 5 s for its answer)

Data & backups (state/memora.db):
  db backup [--to PATH] [--keep N]
                      safe copy while the server runs; default
                      state/backups/memora-<UTC time>.db, keeps the newest 10
  db restore FILE [--force]
                      verify a backup and put it in place (stop the server
                      first); the replaced database is kept in state/backups
  db check            integrity, permissions, sizes, last backup; exit 1 on
                      problems (for timers and health checks)
  db vacuum           drop old log rows, compact the file, truncate the WAL
  db shell [--write]  sqlite3 shell, read-only unless --write
  db export-json [DIR]
                      write the database back as the old JSON files
                      (rollback)
  db help             details
  Run as root, every db command works as the owner of the state dir, so the
  server can still open every memora.db* file.

Updates:
  update [--check] [--yes]
                      check for a newer release and upgrade this install
  version             print the version

Help:
  docs [TOPIC|all]    read the docs in the terminal: getting-started,
                      connecting-agents, agent-instructions, keys-permissions,
                      commands, backups-updates, troubleshooting, more
  help                show this help

Options:
  --state <DIR>       state dir (default: $MEMORA_STATE, else the running
                      memora server's state dir, else ./state)
  --minutes <N>       window length for setup / reset-password, 1-60
                      (default 5)
  --ttl <SECONDS>     window length in seconds (legacy; prefer --minutes)
  --create            vault: create PATH if it does not exist
  -V, --version       print the version
  -h, --help          show this help and do nothing else

Examples:
  memora-cli setup --minutes 10       first-run window open for 10 minutes
  memora-cli status                   where this instance stands
  memora-cli vault /srv/notes --create
                                      create and use /srv/notes as the vault
  memora-cli db backup --keep 20      back up now, keep the newest 20
  memora-cli update --check           only check for a newer release
  memora-cli docs agent-instructions  print the prompt to give your agents

In the browser, open http://<host>:<port>/login, enter the one-time code and
fill in the form before the window closes. If it expires unfinished, the
instance is LOCKED until `memora-cli unlock`, `setup` or `reset-password`.
";

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

/// Parsed command line.
#[derive(Default)]
struct Opts {
    state: Option<PathBuf>,
    ttl: Option<i64>,
    minutes: Option<i64>,
    create: bool,
    cmd: Option<String>,
    args: Vec<String>,
}

/// Print an error and exit with status 2 (usage error).
fn usage_error(msg: &str) -> ! {
    eprintln!("memora-cli: {msg}");
    eprintln!("Try `memora-cli help`.");
    std::process::exit(2);
}

/// Parse a positive integer option value.
fn parse_num(flag: &str, v: &str) -> i64 {
    match v.parse::<i64>() {
        Ok(n) if n > 0 => n,
        _ => usage_error(&format!("{flag} expects a positive number, got `{v}`")),
    }
}

/// Parse the arguments. `-h`/`--help` anywhere prints help and exits before
/// anything else is looked at; unknown flags are a usage error.
fn parse_args(raw: &[String]) -> Opts {
    if raw.iter().any(|a| a == "-h" || a == "--help") {
        print!("{HELP}");
        std::process::exit(0);
    }
    if raw.iter().any(|a| a == "-V" || a == "--version")
        || raw.first().is_some_and(|a| a == "version")
    {
        println!("memora-cli {}", env!("CARGO_PKG_VERSION"));
        std::process::exit(0);
    }
    let mut o = Opts::default();
    let mut it = raw.iter();
    while let Some(a) = it.next() {
        if a == "--" {
            o.args.extend(it.by_ref().cloned());
            break;
        }
        let state_flag = a == "--state" || a.starts_with("--state=");
        if matches!(o.cmd.as_deref(), Some("db") | Some("update")) && !state_flag {
            o.args.push(a.clone());
            continue;
        }
        if !a.starts_with('-') || a == "-" {
            if o.cmd.is_none() {
                o.cmd = Some(a.clone());
            } else {
                o.args.push(a.clone());
            }
            continue;
        }
        let (flag, inline) = match a.split_once('=') {
            Some((f, v)) => (f, Some(v.to_string())),
            None => (a.as_str(), None),
        };
        let mut value = || -> String {
            inline
                .clone()
                .or_else(|| it.next().cloned())
                .unwrap_or_else(|| usage_error(&format!("{flag} needs a value")))
        };
        match flag {
            "--state" => o.state = Some(PathBuf::from(value())),
            "--ttl" => o.ttl = Some(parse_num(flag, &value())),
            "--minutes" => o.minutes = Some(parse_num(flag, &value())),
            "--create" if inline.is_none() => o.create = true,
            _ => usage_error(&format!("unknown option `{a}`")),
        }
    }
    o
}

/// Window length in seconds: `--minutes` wins over the legacy `--ttl`.
fn window_secs(o: &Opts) -> i64 {
    match (o.minutes, o.ttl) {
        (Some(m), _) if m > MAX_MINUTES => {
            usage_error(&format!("--minutes must be between 1 and {MAX_MINUTES}"))
        }
        (Some(m), _) => m * 60,
        (None, Some(t)) if t > MAX_MINUTES * 60 => usage_error(&format!(
            "--ttl must be at most {} seconds",
            MAX_MINUTES * 60
        )),
        (None, Some(t)) => t,
        (None, None) => DEFAULT_MINUTES * 60,
    }
}

// ---------------------------------------------------------------------------
// State dir resolution
// ---------------------------------------------------------------------------

/// A running `memora` server found in /proc.
#[derive(Clone)]
pub(crate) struct Server {
    pub pid: u32,
    /// The server's state dir (absolute when its cwd could be read).
    pub state: PathBuf,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
}

impl Server {
    /// A non-empty variable from the server's environment.
    fn var(&self, key: &str) -> Option<&str> {
        self.env
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
            .filter(|v| !v.is_empty())
    }

    /// Resolve a path the way the server process sees it (relative to its cwd).
    pub fn absolute(&self, p: &Path) -> PathBuf {
        match &self.cwd {
            Some(c) if p.is_relative() => c.join(p),
            _ => p.to_path_buf(),
        }
    }
}

/// The state dir in use and the server running on it, if any.
pub(crate) struct Ctx {
    pub state: PathBuf,
    /// Human-readable source of `state` (flag, env, server pid, default).
    pub source: String,
    pub server: Option<Server>,
}

/// Running `memora` servers found in /proc. Processes we cannot inspect
/// (other users, not root) are skipped.
fn detect_servers() -> Vec<Server> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return found;
    };
    let me = std::process::id();
    let mut pids: Vec<u32> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.parse().ok())
        .filter(|p| *p != me)
        .collect();
    pids.sort_unstable();
    for pid in pids {
        if let Some(s) = inspect_process(pid) {
            found.push(s);
        }
    }
    found
}

/// The server behind `pid`, if it is a readable `memora` process.
fn inspect_process(pid: u32) -> Option<Server> {
    let base = PathBuf::from(format!("/proc/{pid}"));
    let exe = std::fs::read_link(base.join("exe")).ok()?;
    let name = exe.file_name()?.to_string_lossy().to_string();
    // a replaced binary shows up as "memora (deleted)"
    if name.trim_end_matches(" (deleted)") != "memora" {
        return None;
    }
    let raw = std::fs::read(base.join("environ")).ok()?;
    let env: Vec<(String, String)> = raw
        .split(|b| *b == 0)
        .filter_map(|kv| {
            let s = String::from_utf8_lossy(kv);
            let (k, v) = s.split_once('=')?;
            Some((k.to_string(), v.to_string()))
        })
        .collect();
    let cwd = std::fs::read_link(base.join("cwd")).ok();
    let mut srv = Server {
        pid,
        state: PathBuf::new(),
        cwd,
        env,
    };
    let state = PathBuf::from(srv.var("MEMORA_STATE").unwrap_or("state"));
    srv.state = srv.absolute(&state);
    Some(srv)
}

/// State dir precedence: `--state` > $MEMORA_STATE > running server > `state`.
fn resolve_ctx(flag: Option<PathBuf>) -> Ctx {
    let servers = detect_servers();
    let server = servers.first().cloned();
    let (state, source) = if let Some(p) = flag {
        (p, "--state".to_string())
    } else if let Some(p) = std::env::var_os("MEMORA_STATE").filter(|v| !v.is_empty()) {
        (PathBuf::from(p), "$MEMORA_STATE".to_string())
    } else if let Some(s) = &server {
        let mut src = format!("running memora server, pid {}", s.pid);
        if servers.len() > 1 {
            src.push_str(&format!(" ({} servers found, use --state)", servers.len()));
        }
        (s.state.clone(), src)
    } else {
        (PathBuf::from("state"), "default ./state".to_string())
    };
    // only keep the server when it actually uses this state dir
    let server = servers.into_iter().find(|s| same_path(&s.state, &state));
    Ctx {
        state,
        source,
        server,
    }
}

/// Compare two paths after canonicalization (falls back to plain equality).
fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

// ---------------------------------------------------------------------------
// Shared helpers (also used by the console)
// ---------------------------------------------------------------------------

impl Ctx {
    /// Owner, settings, server config and window, from the state database.
    pub fn snapshot(&self) -> anyhow::Result<Snapshot> {
        store::snapshot(self)
    }

    /// The owner's username, if there is one.
    pub fn owner(&self) -> anyhow::Result<Option<String>> {
        store::read(self, owner::owner_name)
    }

    /// A setting as the server sees it at its next start: stored row, then
    /// the running server's environment, then ours, then the default.
    pub fn setting(&self, snap: &Snapshot, key: &str) -> Option<String> {
        snap.config
            .get(key)
            .filter(|v| !v.is_empty())
            .cloned()
            .or_else(|| {
                self.server
                    .as_ref()
                    .and_then(|s| s.var(key))
                    .map(str::to_string)
            })
            .or_else(|| snap.effective.get(key).cloned())
    }

    /// The effective vault folder: the chosen one, else MEMORA_VAULT, else the
    /// default; absolute against the server's cwd.
    pub fn vault(&self, snap: &Snapshot) -> PathBuf {
        let v = snap
            .vault_configured
            .clone()
            .or_else(|| {
                self.setting(snap, "MEMORA_VAULT")
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
            })
            .unwrap_or_else(|| settings::DEFAULT_VAULT.to_string());
        let p = PathBuf::from(v);
        match &self.server {
            Some(s) => s.absolute(&p),
            None => std::path::absolute(&p).unwrap_or(p),
        }
    }

    /// The login page URL (`MEMORA_BASE_URL` or `http://<host>:<port>`).
    pub fn login_url(&self, snap: &Snapshot) -> String {
        if let Some(base) = self.setting(snap, "MEMORA_BASE_URL") {
            return format!("{}/login", base.trim_end_matches('/'));
        }
        let port = self
            .setting(snap, "MEMORA_PORT")
            .unwrap_or_else(|| "<port>".to_string());
        format!("http://<host>:{port}/login")
    }

    /// The systemd unit running the detected server, read from its cgroup.
    pub fn server_unit(&self) -> Option<String> {
        let pid = self.server.as_ref()?.pid;
        let raw = std::fs::read_to_string(format!("/proc/{pid}/cgroup")).ok()?;
        raw.lines()
            .filter_map(|l| l.rsplit('/').next())
            .find(|u| u.ends_with(".service"))
            .map(str::to_string)
    }
}

/// Progress bar plus remaining time, e.g. `[████░░…] 4m 05s`.
pub(crate) fn bar(remaining: i64, ttl: i64) -> String {
    let filled = if ttl > 0 {
        ((remaining as f64 / ttl as f64) * 20.0).round() as usize
    } else {
        0
    };
    format!(
        "[{}{}] {}",
        "█".repeat(filled.min(20)),
        "░".repeat(20usize.saturating_sub(filled)),
        fmt_secs(remaining)
    )
}

/// `4m 05s` style duration.
pub(crate) fn fmt_secs(s: i64) -> String {
    if s >= 60 {
        format!("{}m {:02}s", s / 60, s % 60)
    } else {
        format!("{s}s")
    }
}

/// Open a window and print its one-time code. Only the hash of the
/// normalized code is stored, the form the server checks against.
pub(crate) fn open_window(ctx: &Ctx, mode: ArmMode, ttl: i64) -> anyhow::Result<()> {
    if !arm::TTL_RANGE.contains(&ttl) {
        anyhow::bail!(
            "window length must be {}-{} seconds",
            arm::TTL_RANGE.start(),
            arm::TTL_RANGE.end()
        );
    }
    let code = memora_gateway::generate_setup_code();
    let hash = memora_gateway::hash_api_key(&memora_gateway::normalize_code(&code));
    let bootstrap = mode == ArmMode::Bootstrap;
    let what = if bootstrap {
        "Setup window"
    } else {
        "Password reset window"
    };
    store::write(ctx, |tx| {
        arm::arm(tx, mode, ttl, &hash, memora_state::now())?;
        store::log(
            tx,
            "window_opened",
            &format!("{} for {}", what.to_lowercase(), fmt_secs(ttl)),
        )
    })?;
    let snap = ctx.snapshot()?;
    let form = if bootstrap {
        "username, password, confirmation"
    } else {
        "username, new password, confirmation"
    };
    let line = "═".repeat(36);
    println!();
    println!("{what} OPEN for {}.", fmt_secs(ttl));
    println!();
    println!("  ╔{line}╗");
    println!("  ║{:^36}║", "ONE-TIME CODE");
    println!("  ║{:^36}║", "");
    println!("  ║{:^36}║", code);
    println!("  ╚{line}╝");
    println!();
    println!("  1. Open {}", ctx.login_url(&snap));
    println!("  2. Enter the code above");
    println!("  3. Fill in the form ({form})");
    println!();
    println!("The code is shown only here and only once. If the window expires");
    println!("before you finish, the instance is LOCKED (run `memora-cli unlock`).");
    Ok(())
}

/// Close an open window without locking.
pub(crate) fn close_window(ctx: &Ctx) -> anyhow::Result<()> {
    store::write(ctx, |tx| {
        let was_open = arm::state(tx, memora_state::now())?.status == arm::ArmStatus::Armed;
        arm::disarm(tx)?;
        if was_open {
            store::log(tx, "window_closed", "closed without locking")?;
        }
        Ok(())
    })
}

/// Lift the lock (and close any window); credentials stay as they are.
pub(crate) fn unlock_instance(ctx: &Ctx) -> anyhow::Result<()> {
    store::write(ctx, |tx| {
        let was_locked = arm::state(tx, memora_state::now())?.status == arm::ArmStatus::Locked;
        arm::unlock(tx)?;
        arm::disarm(tx)?;
        if was_locked {
            store::log(tx, "unlocked", "lock lifted, credentials unchanged")?;
        }
        Ok(())
    })
}

/// Validate a vault folder and store it, absolute, in the state database.
/// A running server picks it up at its next start.
pub(crate) fn save_vault(ctx: &Ctx, path: &Path) -> anyhow::Result<PathBuf> {
    let abs = path
        .canonicalize()
        .map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
    if !abs.is_dir() {
        anyhow::bail!("{} is not a directory", abs.display());
    }
    if !memora_gateway::dir_writable(&abs) {
        anyhow::bail!("{} is not writable", abs.display());
    }
    let text = abs.to_string_lossy().to_string();
    store::write(ctx, |tx| {
        let old = settings::configured_vault(tx)?;
        settings::set_vault(tx, Some(&text), memora_state::now())?;
        if old.as_deref() != Some(text.as_str()) {
            store::log(
                tx,
                "vault_changed",
                &format!("{} -> {text}", old.as_deref().unwrap_or("(none)")),
            )?;
        }
        Ok(())
    })?;
    Ok(abs)
}

/// Create a vault folder, handing it to the state dir owner when run as root.
pub(crate) fn create_vault_dir(ctx: &Ctx, path: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(path)?;
    memora_gateway::match_dir_owner(path, &ctx.state);
    Ok(())
}

/// A warning when the vault and the state dir have different owners, so the
/// server user may not be able to write the vault.
pub(crate) fn vault_owner_warning(ctx: &Ctx, vault: &Path) -> Option<String> {
    use crate::sys::MetadataExt;
    let v = std::fs::metadata(vault).ok()?;
    let s = std::fs::metadata(&ctx.state).ok()?;
    (v.uid() != s.uid() && s.uid() != 0).then(|| {
        format!(
            "note: {} is owned by uid {}, the state dir by uid {};\n      \
             make sure the server user can write it.",
            vault.display(),
            v.uid(),
            s.uid()
        )
    })
}

/// The unix user running this CLI (the sudo caller when run through sudo).
fn invoking_user() -> String {
    std::env::var("SUDO_USER")
        .ok()
        .or_else(|| std::env::var("USER").ok())
        .or_else(|| std::env::var("USERNAME").ok())
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| format!("uid {}", sys::euid()))
}

/// How long `clear_cooldowns` waits for the server's acknowledgement.
const COOLDOWN_ACK_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

/// Ask the running server to clear every login cooldown (a control request)
/// and wait for its answer. `None` when no server answered in time.
pub(crate) fn clear_cooldowns(ctx: &Ctx) -> anyhow::Result<Option<String>> {
    let by: String = format!("cli:{}", invoking_user())
        .chars()
        .take(64)
        .collect();
    store::with_db(ctx, |db| {
        let id = db.write(|tx| {
            control::request(
                tx,
                control::ControlKind::LimiterReset,
                &by,
                memora_state::now(),
            )
        })?;
        let ack = control::wait_for_ack(db, id, COOLDOWN_ACK_WAIT)?;
        Ok(ack.map(|r| r.result.unwrap_or_default()))
    })
}

/// One-line window description for status displays.
pub(crate) fn window_line(snap: &Snapshot) -> String {
    let a = &snap.arm;
    if a.armed() {
        format!(
            "open ({}), {}",
            a.mode.as_deref().unwrap_or("?"),
            bar(a.remaining, a.ttl)
        )
    } else {
        "closed".to_string()
    }
}

/// `✓` or `✗`.
pub(crate) fn mark(ok: bool) -> &'static str {
    if ok {
        "✓"
    } else {
        "✗"
    }
}

/// Print a success line: `✓ msg`.
pub(crate) fn ok(msg: &str) {
    println!("{} {msg}", console::style("✓").green().bold());
}

/// `✓ writable` or `✗ not writable` for a folder.
pub(crate) fn writable_label(dir: &Path) -> String {
    if memora_gateway::dir_writable(dir) {
        format!("{} writable", mark(true))
    } else {
        format!("{} not writable", mark(false))
    }
}

/// Server answer of `clear_cooldowns`, as ` (answer)` or nothing.
pub(crate) fn ack_suffix(result: &str) -> String {
    if result.is_empty() {
        String::new()
    } else {
        format!(" ({result})")
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

pub(crate) fn cmd_status(ctx: &Ctx) -> anyhow::Result<()> {
    let snap = ctx.snapshot()?;
    let vault = ctx.vault(&snap);
    let locked = snap.arm.locked();
    println!("state dir : {} ({})", ctx.state.display(), ctx.source);
    if snap.vault_configured.is_some() {
        println!("vault     : {} {}", vault.display(), writable_label(&vault));
    } else {
        println!(
            "vault     : not chosen yet (suggested {});\n            \
             choose it in the browser after sign-in",
            vault.display()
        );
    }
    println!(
        "owner     : {}",
        snap.owner.clone().unwrap_or_else(|| "none".to_string())
    );
    println!("window    : {}", window_line(&snap));
    if let Some((_, ip, _)) = &snap.arm.burn {
        println!("last code : voided by a wrong code from {ip}; open a new window");
    }
    println!("locked    : {}", if locked { "yes" } else { "no" });
    if locked {
        println!("=> instance LOCKED. Run `memora-cli unlock` (or `reset-password`).");
    } else if snap.owner.is_none() && !snap.arm.armed() {
        println!("=> no owner yet. Run `memora-cli setup` (or `memora-cli` alone).");
    }
    Ok(())
}

fn cmd_list(ctx: &Ctx) -> anyhow::Result<()> {
    let o: Option<(String, bool)> =
        store::read(ctx, |c| Ok(owner::get(c)?.map(|o| (o.username, o.enabled))))?;
    let k = store::key_list(ctx)?;
    println!("== owner ==");
    match o {
        Some((name, enabled)) => println!("  {name} (enabled={enabled})"),
        None => println!("  none"),
    }
    println!("== api keys ==");
    let mut live = k.live;
    live.sort_by_key(|r| r.created_at);
    for r in &live {
        println!(
            "  {} name={} prefix={} enabled={} scopes={} tools={}",
            r.id,
            r.name,
            r.prefix,
            r.enabled,
            if r.scopes.is_empty() {
                "-".to_string()
            } else {
                r.scopes.join(",")
            },
            match &r.tools {
                None => "all".to_string(),
                Some(t) => t.len().to_string(),
            }
        );
    }
    if !k.trash.is_empty() {
        println!("== api keys in the trash ==");
        for r in &k.trash {
            println!("  {} name={} prefix={}", r.id, r.name, r.prefix);
        }
    }
    Ok(())
}

/// `vault` shows the folder; `vault PATH` validates and stores it.
fn cmd_vault(ctx: &Ctx, path: Option<&String>, create: bool) -> anyhow::Result<()> {
    let Some(p) = path else {
        let snap = ctx.snapshot()?;
        let v = ctx.vault(&snap);
        println!("vault : {} {}", v.display(), writable_label(&v));
        println!(
            "from  : {}",
            if snap.vault_configured.is_some() {
                "state database (chosen in the app or with `memora-cli vault`)"
            } else {
                "$MEMORA_VAULT or the default (no vault chosen yet)"
            }
        );
        return Ok(());
    };
    let p = PathBuf::from(p);
    if !p.exists() {
        let ask = !create && std::io::stdin().is_terminal() && std::io::stderr().is_terminal();
        let ok = create
            || (ask
                && dialoguer::Confirm::new()
                    .with_prompt(format!("{} does not exist. Create it?", p.display()))
                    .default(true)
                    .interact()?);
        if !ok {
            anyhow::bail!("{} does not exist (use --create to create it)", p.display());
        }
        create_vault_dir(ctx, &p)?;
        println!("Created {}.", p.display());
    }
    let abs = save_vault(ctx, &p)?;
    println!("Vault set to {} (state database).", abs.display());
    if let Some(w) = vault_owner_warning(ctx, &abs) {
        println!("{w}");
    }
    println!("Restart the memora server for the new vault to take effect.");
    Ok(())
}

/// Reject extra positional arguments for commands that take none.
fn no_args(cmd: &str, o: &Opts, max: usize) {
    if o.args.len() > max {
        usage_error(&format!("`{cmd}` does not take `{}`", o.args[max]));
    }
}

fn main() -> anyhow::Result<()> {
    // exit quietly instead of panicking when piped into `head` and the like
    sys::default_sigpipe();
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let o = parse_args(&raw);
    let interactive = std::io::stdin().is_terminal() && std::io::stdout().is_terminal();
    let cmd = match o.cmd.clone() {
        Some(c) => c,
        None if interactive => {
            let ctx = resolve_ctx(o.state.clone());
            return tui::run(&ctx);
        }
        None => "status".to_string(),
    };
    let known = [
        "setup",
        "reset-password",
        "status",
        "disarm",
        "unlock",
        "list",
        "clear-cooldowns",
        "vault",
        "db",
        "update",
        "docs",
        "help",
    ];
    if !known.contains(&cmd.as_str()) {
        usage_error(&format!("unknown command `{cmd}`"));
    }
    if cmd == "update" {
        let mut yes = false;
        let mut check = false;
        for a in &o.args {
            match a.as_str() {
                "--yes" | "-y" => yes = true,
                "--check" => check = true,
                other => usage_error(&format!("unknown option `{other}` for update")),
            }
        }
        std::process::exit(update::run(None, yes, check));
    }
    if cmd == "db" {
        let ctx = resolve_ctx(o.state.clone());
        let code = db::cli(&ctx, &o.args)?;
        std::process::exit(code);
    }
    no_args(
        &cmd,
        &o,
        if cmd == "vault" || cmd == "docs" {
            1
        } else {
            0
        },
    );
    if o.create && cmd != "vault" {
        usage_error("--create only applies to `vault`");
    }
    if (o.minutes.is_some() || o.ttl.is_some()) && cmd != "setup" && cmd != "reset-password" {
        usage_error("--minutes / --ttl only apply to `setup` and `reset-password`");
    }
    if cmd == "help" {
        print!("{HELP}");
        return Ok(());
    }
    if cmd == "docs" {
        let ctx = resolve_ctx(o.state.clone());
        std::process::exit(tui::docs::cli(&ctx, o.args.first().map(String::as_str))?);
    }
    let ttl = window_secs(&o);
    let ctx = resolve_ctx(o.state.clone());

    match cmd.as_str() {
        "setup" => {
            if let Some(owner) = ctx.owner()? {
                eprintln!("An owner account already exists ({owner}).");
                eprintln!("Use `memora-cli reset-password` instead.");
                std::process::exit(1);
            }
            open_window(&ctx, ArmMode::Bootstrap, ttl)?;
        }
        "reset-password" => {
            if ctx.owner()?.is_none() {
                println!("note: no owner account yet; the browser will create one.");
            }
            open_window(&ctx, ArmMode::Reset, ttl)?;
        }
        "status" => cmd_status(&ctx)?,
        "disarm" => {
            close_window(&ctx)?;
            println!("Window closed (no lock applied).");
        }
        "unlock" => {
            unlock_instance(&ctx)?;
            println!("Instance UNLOCKED (owner account unchanged).");
            println!("Run `memora-cli setup` or `reset-password` to open a new window.");
        }
        "list" => cmd_list(&ctx)?,
        "clear-cooldowns" => match clear_cooldowns(&ctx)? {
            Some(result) => println!(
                "Login cooldowns cleared by the running server{}.",
                ack_suffix(&result)
            ),
            None => {
                println!("No running server answered within 5 seconds, so nothing was cleared.");
                println!("Cooldowns live only in a running server's memory.");
            }
        },
        "vault" => cmd_vault(&ctx, o.args.first(), o.create)?,
        _ => unreachable!(),
    }
    Ok(())
}
