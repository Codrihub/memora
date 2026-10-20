//! Run and remove the server: `start`, `stop`, `restart` and `uninstall`, and
//! the console's /start, /shutdown (/stop), /restart and /uninstall.
//!
//! What they do depends on how this install runs ([`Kind`], from [`detect`]):
//! * a systemd service is driven with `systemctl` (root only);
//! * inside a Docker container nothing can start, stop or remove its own
//!   container, so the host commands are printed instead;
//! * anything else (npm, a release zip, Windows, a source build) is a plain
//!   process: `start` launches the `memora` next to this binary in the
//!   background, with `<state>/memora.pid` and `<state>/memora.log`, and
//!   `stop` asks that process to end and waits for it.
//!
//! `uninstall` removes the program parts of the install kind and keeps the
//! state folder and the vault unless the operator selects them ([`build_plan`]).

use crate::install::{Origin, NPM_PACKAGE};
use crate::{ok, Ctx};
use anyhow::{Context, Result};
use console::style;
use dialoguer::theme::ColorfulTheme;
use dialoguer::{Confirm, Input, MultiSelect};
use memora_state::DB_FILE;
use std::io::{IsTerminal, Read, Seek, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Pid of a server started by `memora-cli start`, in the state dir.
const PID_FILE: &str = "memora.pid";
/// That server's stdout and stderr, in the state dir.
const LOG_FILE: &str = "memora.log";
/// Past this size, `start` moves the log to `memora.log.1` (replacing an older one) and
/// begins a new file, so a server restarted now and then never fills the disk.
const LOG_ROTATE_BYTES: u64 = 16 * 1024 * 1024;
/// The running server's token for `POST /_stop`, in the state dir
/// (`memora_http::shutdown::STOP_TOKEN_FILE`).
const STOP_TOKEN_FILE: &str = "stop.token";
/// The unit install.sh writes, and where.
const UNIT_NAME: &str = "memora.service";
const UNIT_FILE: &str = "/etc/systemd/system/memora.service";
/// How long `stop` waits for a graceful exit before it reports.
const STOP_WAIT: Duration = Duration::from_secs(10);
/// How long `start` waits for /healthz to answer.
const START_WAIT: Duration = Duration::from_secs(15);
/// Exit code when root is needed (same as `update`).
const NEEDS_ROOT: i32 = 6;

/// The lifecycle subcommands of `memora-cli`.
pub(crate) const SUBCOMMANDS: &[&str] = &["start", "stop", "restart", "uninstall"];

// ---------------------------------------------------------------------------
// Install kind
// ---------------------------------------------------------------------------

/// How this install runs the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Kind {
    /// A systemd unit. `installer` is install.sh's saved copy when the unit is
    /// the one it wrote.
    Service {
        unit: String,
        installer: Option<PathBuf>,
    },
    /// Inside a Docker container.
    Docker,
    /// A plain process: from the npm package, or program files (release zip,
    /// Windows, source build).
    Process { npm: bool },
}

/// What the machine says about the install; the input of [`detect`].
#[derive(Debug, Default, Clone)]
pub(crate) struct Probe {
    /// The systemd unit of the running server.
    pub running_unit: Option<String>,
    /// How the program files were installed ([`crate::install::detect`]).
    pub origin: Origin,
    /// install.sh's unit file exists.
    pub unit_installed: bool,
    /// That unit's MEMORA_STATE is the state dir in use.
    pub unit_state_matches: bool,
    /// The state dir is the fallback `./state` (no flag, env or server).
    pub state_is_default: bool,
    /// install.sh's saved copy.
    pub installer: Option<PathBuf>,
}

/// The install kind. Docker first (a container never drives systemd), then a
/// running unit, then install.sh's unit when it serves this state dir (or no
/// state dir was named, as with a stopped service and plain `sudo memora-cli`)
/// and this copy is not an npm or source one.
pub(crate) fn detect(p: &Probe) -> Kind {
    let npm = p.origin == Origin::Npm;
    if p.origin == Origin::Docker {
        return Kind::Docker;
    }
    if let Some(unit) = &p.running_unit {
        let installer = p.installer.clone().filter(|_| unit == UNIT_NAME);
        return Kind::Service {
            unit: unit.clone(),
            installer,
        };
    }
    if p.unit_installed
        && (p.unit_state_matches || p.state_is_default)
        && !matches!(p.origin, Origin::Npm | Origin::Source)
    {
        return Kind::Service {
            unit: UNIT_NAME.to_string(),
            installer: p.installer.clone(),
        };
    }
    Kind::Process { npm }
}

/// Probe this machine for [`detect`].
fn probe(ctx: &Ctx) -> Probe {
    let unit_text = std::fs::read_to_string(UNIT_FILE).ok();
    let unit_state = unit_text
        .as_deref()
        .and_then(|t| unit_env(t, "MEMORA_STATE"));
    Probe {
        running_unit: ctx.server_unit(),
        origin: crate::install::detect(),
        unit_installed: unit_text.is_some(),
        unit_state_matches: unit_state.is_some_and(|s| crate::same_path(Path::new(&s), &ctx.state)),
        state_is_default: ctx.source.starts_with("default"),
        installer: crate::update::installer(),
    }
}

/// Exit code when the target is refused (another install's server).
const REFUSED: i32 = 2;

/// Whether `start` / `stop` / `restart` / `uninstall` may act on `kind`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Guard {
    /// The state folder was named (`--state`, `MEMORA_STATE`) or is the default.
    Go,
    /// The state folder was taken from a running server: say so, then go on.
    Notice(String),
    /// The running server belongs to another kind of install: refuse.
    Refuse(String),
}

/// The decision behind [`checked_kind`]. `adopted` means neither `--state`
/// nor `MEMORA_STATE` was given and the state folder came from a running
/// server. A systemd service or a container found that way is only driven
/// when this binary is the same kind of install (a native install for a
/// service, the image for a container); an npm, source or release copy that
/// merely sees a service on the machine must not restart or remove it.
pub(crate) fn guard(adopted: bool, kind: &Kind, origin: Origin, state: &Path) -> Guard {
    if !adopted {
        return Guard::Go;
    }
    let target = match kind {
        Kind::Service { unit, .. } => format!("the systemd service {unit}"),
        Kind::Docker => "this Docker container".to_string(),
        Kind::Process { .. } => "the memora process using it".to_string(),
    };
    let notice = format!(
        "No --state or MEMORA_STATE given: using the running server's state folder {} ({target}).",
        state.display()
    );
    let mismatch = match kind {
        Kind::Service { .. } => origin != Origin::Native,
        Kind::Docker => origin != Origin::Docker,
        Kind::Process { .. } => false,
    };
    if !mismatch {
        return Guard::Notice(notice);
    }
    let how = match kind {
        Kind::Service { unit, .. } => {
            format!("run systemctl yourself (sudo systemctl restart {unit})")
        }
        _ => "run docker on the host (docker restart memora)".to_string(),
    };
    Guard::Refuse(format!(
        "{notice}\nThis memora-cli is {} install, not the one that runs {target}, so it will not \
         act on it. Pass --state <DIR> (or set MEMORA_STATE) for the server you mean, or {how}.",
        origin_name(origin)
    ))
}

/// `an npm`, `a source`, ... for [`guard`]'s message.
fn origin_name(o: Origin) -> &'static str {
    match o {
        Origin::Npm => "an npm",
        Origin::Docker => "a Docker",
        Origin::Native => "a native",
        Origin::Folder => "a release-folder",
        Origin::Source => "a source-build",
    }
}

/// The install kind, after [`guard`]: prints the notice, or the refusal and
/// returns its exit code. Never asks, so it is safe without a terminal.
fn checked_kind(ctx: &Ctx) -> std::result::Result<Kind, i32> {
    let p = probe(ctx);
    let kind = detect(&p);
    let adopted = ctx.source.starts_with("running memora server");
    match guard(adopted, &kind, p.origin, &ctx.state) {
        Guard::Go => Ok(kind),
        Guard::Notice(n) => {
            println!("{}", style(n).dim());
            Ok(kind)
        }
        Guard::Refuse(msg) => {
            let mut lines = msg.lines();
            if let Some(first) = lines.next() {
                println!("{first}");
            }
            for l in lines {
                println!("{} {l}", style("refused:").red().bold());
            }
            Err(REFUSED)
        }
    }
}

/// The last `Environment=KEY=value` of a unit file (`Environment="KEY=value"` too).
fn unit_env(text: &str, key: &str) -> Option<String> {
    let want = format!("{key}=");
    text.lines()
        .filter_map(|l| l.trim().strip_prefix("Environment="))
        .filter_map(|v| {
            v.trim_matches('"')
                .strip_prefix(want.as_str())
                .map(str::to_string)
        })
        .next_back()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// The last `KEY=value` line of a unit file, e.g. `WorkingDirectory`.
fn unit_value(text: &str, key: &str) -> Option<String> {
    let want = format!("{key}=");
    text.lines()
        .filter_map(|l| l.trim().strip_prefix(want.as_str()))
        .next_back()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

/// Options of the lifecycle subcommands.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct Flags {
    /// stop / restart: end the server if it does not stop in time.
    pub force: bool,
    /// uninstall: also delete the state folder.
    pub delete_config: bool,
    /// uninstall: also delete the vault folder.
    pub delete_vault: bool,
    /// uninstall: do not ask.
    pub yes: bool,
}

/// Parse the options of `cmd` (one of [`SUBCOMMANDS`]).
pub(crate) fn parse_flags(cmd: &str, args: &[String]) -> std::result::Result<Flags, String> {
    let mut f = Flags::default();
    for a in args {
        match (cmd, a.as_str()) {
            ("stop" | "restart", "--force" | "-f") => f.force = true,
            ("uninstall", "--delete-config") => f.delete_config = true,
            ("uninstall", "--delete-vault") => f.delete_vault = true,
            ("uninstall", "--yes" | "-y") => f.yes = true,
            (_, o) if o.starts_with('-') => {
                return Err(format!("unknown option `{o}` for {cmd}"));
            }
            (_, o) => return Err(format!("`{cmd}` does not take `{o}`")),
        }
    }
    Ok(f)
}

/// `memora-cli start|stop|restart|uninstall`. Returns the exit code.
pub(crate) fn cli(ctx: &Ctx, cmd: &str, f: &Flags) -> Result<i32> {
    let interactive = std::io::stdin().is_terminal() && std::io::stderr().is_terminal();
    let theme = ColorfulTheme::default();
    let theme = interactive.then_some(&theme);
    match cmd {
        "start" => start(ctx),
        "stop" => stop(ctx, theme, f.force),
        "restart" => restart(ctx, theme, f.force),
        _ => Ok(uninstall(ctx, theme.filter(|_| !f.yes), f)?.code),
    }
}

// ---------------------------------------------------------------------------
// start / stop / restart
// ---------------------------------------------------------------------------

/// `start` / `/start`.
pub(crate) fn start(ctx: &Ctx) -> Result<i32> {
    let kind = match checked_kind(ctx) {
        Ok(k) => k,
        Err(code) => return Ok(code),
    };
    match kind {
        Kind::Docker => {
            docker_hint("start");
            Ok(0)
        }
        Kind::Service { unit, .. } => systemctl("start", &unit),
        Kind::Process { npm } => proc_start(ctx, npm),
    }
}

/// `stop` / `/shutdown`. `theme` lets it ask before forcing.
pub(crate) fn stop(ctx: &Ctx, theme: Option<&ColorfulTheme>, force: bool) -> Result<i32> {
    let kind = match checked_kind(ctx) {
        Ok(k) => k,
        Err(code) => return Ok(code),
    };
    match kind {
        Kind::Docker => {
            docker_hint("stop");
            Ok(0)
        }
        Kind::Service { unit, .. } => systemctl("stop", &unit),
        Kind::Process { .. } => Ok(match proc_stop(ctx, theme, force)? {
            StopResult::Failed(code) => code,
            _ => 0,
        }),
    }
}

/// `restart` / `/restart`: stop, then start (a stopped server is just started).
pub(crate) fn restart(ctx: &Ctx, theme: Option<&ColorfulTheme>, force: bool) -> Result<i32> {
    let kind = match checked_kind(ctx) {
        Ok(k) => k,
        Err(code) => return Ok(code),
    };
    match kind {
        Kind::Docker => {
            docker_hint("restart");
            Ok(0)
        }
        Kind::Service { unit, .. } => systemctl("restart", &unit),
        Kind::Process { npm } => match proc_stop(ctx, theme, force)? {
            StopResult::Failed(code) => Ok(code),
            StopResult::NotRunning => {
                println!("Starting it.");
                proc_start(ctx, npm)
            }
            StopResult::Stopped => proc_start(ctx, npm),
        },
    }
}

/// After /config changed a setting: offer a restart where one is possible,
/// otherwise say how the new values get loaded.
pub(crate) fn after_change(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    let ask = |what: &str| -> Result<bool> {
        let go = Confirm::with_theme(theme)
            .with_prompt(format!("Restart {what} now to load the new settings?"))
            .default(true)
            .interact_opt()?;
        if go != Some(true) {
            println!(
                "Later: type {} when you are ready.",
                style("/restart").cyan()
            );
        }
        Ok(go == Some(true))
    };
    let Ok(kind) = checked_kind(ctx) else {
        return Ok(());
    };
    match kind {
        Kind::Docker => docker_hint("restart"),
        Kind::Service { unit, .. } => {
            let active = Command::new("systemctl")
                .args(["is-active", "--quiet", &unit])
                .status()
                .is_ok_and(|s| s.success());
            if !active {
                println!(
                    "{unit} is not running; it loads the new settings when it starts (/start)."
                );
            } else if !crate::sys::is_root() || ask(&unit)? {
                // without root this only prints the sudo command
                systemctl("restart", &unit)?;
            }
        }
        Kind::Process { npm } => {
            let state = absolute(&ctx.state);
            if read_pid(&state).is_some_and(is_memora) {
                if ask("the server")?
                    && matches!(proc_stop(ctx, Some(theme), false)?, StopResult::Stopped)
                {
                    proc_start(ctx, npm)?;
                }
            } else if ctx.server.as_ref().is_some_and(|s| is_memora(s.pid))
                || health(listen_addr(ctx)) == Some(200)
            {
                println!("Restart the server to load the new settings: stop it where it runs");
                println!("(Ctrl+C in its terminal, or its service manager) and start it again.");
            } else {
                println!(
                    "The server is not running; it loads the new settings when it starts (/start)."
                );
            }
        }
    }
    Ok(())
}

/// `start` -> `starting`, ...
fn ing(verb: &str) -> String {
    match verb {
        "stop" => "stopping".into(),
        v => format!("{v}ing"),
    }
}

/// `start` -> `started`, ...
fn past(verb: &str) -> String {
    match verb {
        "stop" => "stopped".into(),
        v => format!("{v}ed"),
    }
}

/// Run `systemctl <verb> <unit>` as root; otherwise print the sudo command.
fn systemctl(verb: &str, unit: &str) -> Result<i32> {
    let cmd = format!("sudo systemctl {verb} {unit}");
    if !crate::sys::is_root() {
        println!(
            "The server runs as the systemd service {unit}; {} it needs root. Run:",
            ing(verb)
        );
        println!("  {}", style(cmd).cyan());
        return Ok(NEEDS_ROOT);
    }
    let status = Command::new("systemctl")
        .args([verb, unit])
        .status()
        .context("running systemctl")?;
    if status.success() {
        ok(&format!("{unit} {}.", past(verb)));
        Ok(0)
    } else {
        println!(
            "{} systemctl {verb} {unit} failed. See: {}",
            style("error:").red().bold(),
            style(format!("journalctl -u {unit} -n 30")).cyan()
        );
        Ok(1)
    }
}

/// Inside Docker: the host commands for `verb` (start, stop, restart).
fn docker_hint(verb: &str) {
    if verb == "start" {
        println!("The server is running: this console runs inside its Docker container.");
        println!("A container cannot start itself; when it is stopped, start it on the host:");
    } else {
        println!(
            "Memora runs in a Docker container, which cannot {verb} itself. On the host, run:"
        );
    }
    println!("  {}", style(format!("docker {verb} memora")).cyan());
    println!(
        "  {}  {}",
        style(format!("docker compose {verb}")).cyan(),
        style("(Docker Compose, in the folder of docker-compose.yml)").dim()
    );
    println!(
        "{}",
        style("Use your container name if it is not memora.").dim()
    );
}

/// `path` made absolute against the current directory.
fn absolute(p: &Path) -> PathBuf {
    std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf())
}

/// `path` with symlinks resolved, or absolute when it does not exist.
fn resolve(p: &Path) -> PathBuf {
    memora_state::canonical_path(p).unwrap_or_else(|_| absolute(p))
}

/// The pid of the server `memora-cli start` launched on `state`, when it
/// still runs (`db restore` on Windows, which has no /proc to ask).
#[cfg(windows)]
pub(crate) fn started_pid(state: &Path) -> Option<u32> {
    read_pid(state).filter(|p| is_memora(*p))
}

/// The pid in `<state>/memora.pid`.
fn read_pid(state: &Path) -> Option<u32> {
    std::fs::read_to_string(state.join(PID_FILE))
        .ok()?
        .trim()
        .parse()
        .ok()
        .filter(|p| *p > 0)
}

/// Whether `pid` is a live `memora` process (not a reused pid). Reaps it
/// first when it is an exited child of this process (the console starts the
/// server as its child, and a zombie would still look alive).
#[cfg(unix)]
fn is_memora(pid: u32) -> bool {
    let Ok(p) = libc::pid_t::try_from(pid) else {
        return false;
    };
    let mut status = 0;
    // SAFETY: WNOHANG never blocks; for a pid that is not our child it fails with ECHILD.
    if unsafe { libc::waitpid(p, &mut status, libc::WNOHANG) } == p {
        return false;
    }
    if Path::new("/proc/self").exists() {
        return std::fs::read_link(format!("/proc/{pid}/exe"))
            .ok()
            .and_then(|e| e.file_name().map(|n| n.to_string_lossy().to_string()))
            .is_some_and(|n| n.trim_end_matches(" (deleted)") == "memora");
    }
    // SAFETY: signal 0 only checks that the process exists.
    unsafe { libc::kill(p, 0) == 0 }
}

/// Windows: whether `pid` is a running `memora.exe`, asked from `tasklist`
/// (one CSV row per match, or an INFO line when nothing matches).
#[cfg(windows)]
fn is_memora(pid: u32) -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .stderr(Stdio::null())
        .output()
        .is_ok_and(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_ascii_lowercase()
                .contains("\"memora.exe\"")
        })
}

/// Ask `pid` to stop (SIGTERM), or end it at once with `hard` (SIGKILL).
#[cfg(unix)]
fn terminate(pid: u32, hard: bool) -> Result<()> {
    let p = libc::pid_t::try_from(pid).context("invalid pid")?;
    let sig = if hard { libc::SIGKILL } else { libc::SIGTERM };
    // SAFETY: plain kill(2) on a pid we checked is a memora process.
    if unsafe { libc::kill(p, sig) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

/// Windows: `taskkill /PID <pid>` asks the process to close; `hard` adds /F
/// (TerminateProcess). The server started by `start` has no window, so
/// Windows may refuse the polite request; `--force` is then the way.
#[cfg(windows)]
fn terminate(pid: u32, hard: bool) -> Result<()> {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string()]);
    if hard {
        cmd.arg("/F");
    }
    let out = cmd.output().context("running taskkill")?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr).trim().to_string();
        anyhow::bail!("taskkill: {why}");
    }
    Ok(())
}

/// Start the server in its own session (Unix): no controlling terminal, so
/// Ctrl-C in this console and closing the terminal do not reach it.
#[cfg(unix)]
fn detach(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    // SAFETY: setsid is async-signal-safe and touches no memory.
    unsafe {
        cmd.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

/// Windows: no console window (the server outlives this one) and its own
/// process group (Ctrl+C here does not reach it).
#[cfg(windows)]
fn detach(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    /// Win32 `DETACHED_PROCESS`: the child gets no console.
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    /// Win32 `CREATE_NEW_PROCESS_GROUP`.
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
}

/// Spawn the detached server. Unix: a plain spawn.
#[cfg(unix)]
fn spawn_detached(cmd: &mut Command) -> std::io::Result<std::process::Child> {
    cmd.spawn()
}

/// Windows: a child inherits every inheritable handle of this process,
/// including the stdin/stdout/stderr this console got from its caller. The
/// server would then hold the caller's pipe open for as long as it runs, so a
/// script, wrapper or CI step reading `memora-cli start` would wait until the
/// server exits. Those three handles are made non-inheritable for the spawn
/// (the server gets its log file and NUL explicitly) and restored afterwards.
#[cfg(windows)]
fn spawn_detached(cmd: &mut Command) -> std::io::Result<std::process::Child> {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(which: u32) -> *mut c_void;
        fn GetHandleInformation(h: *mut c_void, flags: *mut u32) -> i32;
        fn SetHandleInformation(h: *mut c_void, mask: u32, flags: u32) -> i32;
    }
    /// STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE ((DWORD)-10, -11, -12).
    const STD: [u32; 3] = [0xFFFF_FFF6, 0xFFFF_FFF5, 0xFFFF_FFF4];
    const HANDLE_FLAG_INHERIT: u32 = 1;
    let mut saved = Vec::new();
    for which in STD {
        // SAFETY: GetStdHandle has no preconditions; null and INVALID_HANDLE_VALUE
        // (-1) are skipped, and the flags are only read and set on a valid handle.
        unsafe {
            let h = GetStdHandle(which);
            if h.is_null() || h as isize == -1 {
                continue;
            }
            let mut flags = 0;
            if GetHandleInformation(h, &mut flags) != 0 && flags & HANDLE_FLAG_INHERIT != 0 {
                SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0);
                saved.push(h);
            }
        }
    }
    let child = cmd.spawn();
    for h in saved {
        // SAFETY: restores the flag on the same valid handle.
        unsafe { SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) };
    }
    child
}

/// Move `log` aside to `<log>.1` when it is larger than `max` bytes (the previous `.1`
/// is replaced). Errors leave the log where it is.
fn rotate_log(log: &Path, max: u64) {
    if std::fs::metadata(log).is_ok_and(|m| m.len() > max) {
        let mut old = log.as_os_str().to_owned();
        old.push(".1");
        let _ = std::fs::rename(log, PathBuf::from(old));
    }
}

/// The `memora` server binary next to this `memora-cli` (native install, npm
/// platform package, release zip and `cargo build` all put them together).
fn server_binary() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let exe = memora_state::canonical_path(&exe).unwrap_or(exe);
    let bin = exe.with_file_name(format!("memora{}", std::env::consts::EXE_SUFFIX));
    if !crate::sys::is_executable(&bin) {
        anyhow::bail!(
            "cannot find the memora server program next to memora-cli ({})",
            bin.display()
        );
    }
    Ok(bin)
}

/// The web app of the npm package: `node_modules/@codrihub/memora/assets`,
/// next to the platform package (hoisted) or above it (nested). The npm
/// launcher sets MEMORA_ASSETS the same way when it starts `memora`.
fn npm_assets(bin: &Path) -> Option<PathBuf> {
    let pkg = bin.parent()?.parent()?;
    let scope = pkg.parent()?;
    let nested = scope.parent()?.parent().map(|m| m.join("assets"));
    [Some(scope.join("memora").join("assets")), nested]
        .into_iter()
        .flatten()
        .find(|d| d.join("index.html").is_file())
}

/// Where the server listens, as an address to connect to: settings as the
/// server sees them (stored row, environment, default 127.0.0.1:8400), with
/// 0.0.0.0 / :: replaced by loopback.
fn listen_addr(ctx: &Ctx) -> SocketAddr {
    let snap = ctx
        .state
        .join(DB_FILE)
        .is_file()
        .then(|| ctx.snapshot().ok())
        .flatten();
    let get = |key: &str| {
        snap.as_ref()
            .and_then(|s| ctx.setting(s, key))
            .or_else(|| std::env::var(key).ok())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };
    let port = get("MEMORA_PORT")
        .and_then(|p| p.parse().ok())
        .unwrap_or(8400);
    let ip = match get("MEMORA_BIND").and_then(|b| b.parse::<IpAddr>().ok()) {
        Some(IpAddr::V4(v)) if v.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        Some(IpAddr::V6(v)) if v.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        Some(ip) => ip,
        None => IpAddr::V4(Ipv4Addr::LOCALHOST),
    };
    SocketAddr::new(ip, port)
}

/// HTTP status of `GET /healthz` on `addr`; `None` when nothing answers.
fn health(addr: SocketAddr) -> Option<u16> {
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(1)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    s.set_write_timeout(Some(Duration::from_secs(2))).ok()?;
    write!(
        s,
        "GET /healthz HTTP/1.0\r\nHost: {addr}\r\nConnection: close\r\n\r\n"
    )
    .ok()?;
    let mut buf = [0u8; 64];
    let n = s.read(&mut buf).ok()?;
    parse_status(&buf[..n])
}

/// Ask the server on `addr` to stop gracefully: `POST /_stop` with the token
/// the server wrote to `<state>/stop.token` (see `memora_http::shutdown`).
/// True when it accepted. Works the same on every OS; on Windows it is the
/// only polite way, since a server without a console ignores `taskkill`.
fn ask_stop(state: &Path, addr: SocketAddr) -> bool {
    let Ok(token) = std::fs::read_to_string(state.join(STOP_TOKEN_FILE)) else {
        return false;
    };
    let token = token.trim();
    if token.is_empty()
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return false;
    }
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_secs(1)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(2)));
    if write!(
        s,
        "POST /_stop HTTP/1.0\r\nHost: {addr}\r\nX-Memora-Stop-Token: {token}\r\n\
         Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 64];
    let n = s.read(&mut buf).unwrap_or(0);
    parse_status(&buf[..n]) == Some(200)
}

/// The status code of an HTTP status line.
fn parse_status(head: &[u8]) -> Option<u16> {
    let text = String::from_utf8_lossy(head);
    let mut it = text.split_whitespace();
    it.next().filter(|v| v.starts_with("HTTP/"))?;
    it.next()?.parse().ok()
}

/// The last `n` lines of a log file (only its tail is read).
fn tail(path: &Path, n: usize) -> Vec<String> {
    let Ok(mut f) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(std::io::SeekFrom::Start(len.saturating_sub(8192)));
    let mut raw = Vec::new();
    let _ = f.read_to_end(&mut raw);
    let text = String::from_utf8_lossy(&raw);
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..]
        .iter()
        .map(|l| l.to_string())
        .collect()
}

/// Start `memora` in the background with this console's environment.
fn proc_start(ctx: &Ctx, npm: bool) -> Result<i32> {
    let state = absolute(&ctx.state);
    if let Some(pid) = read_pid(&state) {
        if is_memora(pid) {
            println!("The server is already running (pid {pid}, started by memora-cli).");
            return Ok(0);
        }
        let _ = std::fs::remove_file(state.join(PID_FILE));
    }
    // ctx.server was found when this command (or the console) started
    if let Some(s) = ctx.server.as_ref().filter(|s| is_memora(s.pid)) {
        println!(
            "A memora server already runs on this state dir (pid {}); not starting another.",
            s.pid
        );
        return Ok(1);
    }
    let addr = listen_addr(ctx);
    if TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_ok() {
        let what = if health(addr) == Some(200) {
            "a server answers /healthz there"
        } else {
            "something listens there"
        };
        println!(
            "Port {} is already in use ({what}, {addr}); not starting another server.",
            addr.port()
        );
        println!("Stop that one first, or choose another port (MEMORA_PORT or /config).");
        return Ok(1);
    }
    // As root, a server would create root-owned files in a user's state dir.
    {
        use crate::sys::MetadataExt;
        if let Some(uid) = std::fs::metadata(&state)
            .ok()
            .map(|m| m.uid())
            .filter(|uid| crate::sys::is_root() && *uid != 0)
        {
            println!(
                "{} the state dir {} belongs to uid {uid}. Start the server as that user, not as root,",
                style("error:").red().bold(),
                state.display()
            );
            println!("so its files keep the right owner.");
            return Ok(2);
        }
    }
    let bin = server_binary()?;
    std::fs::create_dir_all(&state).with_context(|| format!("creating {}", state.display()))?;
    let log_path = state.join(LOG_FILE);
    rotate_log(&log_path, LOG_ROTATE_BYTES);
    let mut log = {
        use crate::sys::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(&log_path)
            .with_context(|| format!("opening {}", log_path.display()))?
    };
    let _ = writeln!(
        log,
        "--- memora-cli start, {} UTC ---",
        crate::db::utc_stamp(memora_state::now())
    );
    let mut cmd = Command::new(&bin);
    cmd.env("MEMORA_STATE", &state)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    if npm
        && std::env::var("MEMORA_ASSETS")
            .unwrap_or_default()
            .is_empty()
    {
        if let Some(a) = npm_assets(&bin) {
            cmd.env("MEMORA_ASSETS", a);
        }
    }
    detach(&mut cmd);
    let child = spawn_detached(&mut cmd).with_context(|| format!("starting {}", bin.display()))?;
    let pid = child.id();
    // not waited for: it runs on after this process; is_memora reaps it
    drop(child);
    std::fs::write(state.join(PID_FILE), format!("{pid}\n"))
        .with_context(|| format!("writing {}", state.join(PID_FILE).display()))?;
    println!("Starting memora (pid {pid}); log: {}", log_path.display());
    let deadline = Instant::now() + START_WAIT;
    while Instant::now() < deadline {
        if !is_memora(pid) {
            let _ = std::fs::remove_file(state.join(PID_FILE));
            println!(
                "{} the server stopped right away. Last lines of {}:",
                style("error:").red().bold(),
                log_path.display()
            );
            for l in tail(&log_path, 15) {
                println!("  {}", style(l).dim());
            }
            return Ok(1);
        }
        if health(addr) == Some(200) {
            ok(&format!("memora is running (pid {pid}) on http://{addr}"));
            println!(
                "Stop it with {} (in the console: /shutdown).",
                style("memora-cli stop").cyan()
            );
            return Ok(0);
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    println!(
        "memora started (pid {pid}), but /healthz did not answer within {} s; check {}",
        START_WAIT.as_secs(),
        log_path.display()
    );
    Ok(0)
}

/// Result of [`proc_stop`].
enum StopResult {
    NotRunning,
    Stopped,
    /// Still running, or not ours to stop; the exit code.
    Failed(i32),
}

/// Wait until `pid` is gone; true when it is.
fn wait_exit(pid: u32, within: Duration) -> bool {
    let deadline = Instant::now() + within;
    while Instant::now() < deadline {
        if !is_memora(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    !is_memora(pid)
}

/// Stop the server that `start` launched: ask, wait up to 10 s, then report
/// (or end it with `force`, or after asking when `theme` is given).
fn proc_stop(ctx: &Ctx, theme: Option<&ColorfulTheme>, force: bool) -> Result<StopResult> {
    let state = absolute(&ctx.state);
    let pid_file = state.join(PID_FILE);
    let Some(pid) = read_pid(&state) else {
        let other = ctx
            .server
            .as_ref()
            .filter(|s| is_memora(s.pid))
            .map(|s| format!(" (pid {})", s.pid))
            .or_else(|| (health(listen_addr(ctx)) == Some(200)).then(String::new));
        if let Some(pid) = other {
            println!(
                "A memora server is running{pid}, but memora-cli did not start it (no {}).",
                pid_file.display()
            );
            println!("Stop it where it runs: Ctrl+C in its terminal, or its service manager.");
            return Ok(StopResult::Failed(1));
        }
        println!("The server is not running.");
        return Ok(StopResult::NotRunning);
    };
    if !is_memora(pid) {
        let _ = std::fs::remove_file(&pid_file);
        println!("The server is not running (removed the stale pid file).");
        return Ok(StopResult::NotRunning);
    }
    println!("Stopping memora (pid {pid})...");
    let asked = if ask_stop(&state, listen_addr(ctx)) {
        Ok(())
    } else {
        terminate(pid, false)
    };
    if let Err(e) = &asked {
        println!(
            "{} could not ask it to stop: {e:#}",
            style("!").yellow().bold()
        );
    }
    if asked.is_ok() && wait_exit(pid, STOP_WAIT) {
        let _ = std::fs::remove_file(&pid_file);
        ok("memora stopped.");
        return Ok(StopResult::Stopped);
    }
    let force = force
        || match theme {
            Some(t) => {
                println!("It is still running.");
                Confirm::with_theme(t)
                    .with_prompt("End it now? Activity of the last seconds may not be saved.")
                    .default(false)
                    .interact_opt()?
                    == Some(true)
            }
            None => false,
        };
    if !force {
        println!(
            "memora (pid {pid}) is still running. To end it at once: {}",
            style("memora-cli stop --force").cyan()
        );
        return Ok(StopResult::Failed(1));
    }
    terminate(pid, true)?;
    if wait_exit(pid, Duration::from_secs(5)) {
        let _ = std::fs::remove_file(&pid_file);
        ok("memora stopped (forced).");
        return Ok(StopResult::Stopped);
    }
    println!(
        "{} memora (pid {pid}) is still running.",
        style("error:").red().bold()
    );
    Ok(StopResult::Failed(1))
}

// ---------------------------------------------------------------------------
// Uninstall: the plan
// ---------------------------------------------------------------------------

/// Where things are, resolved (symlinks followed), for [`build_plan`].
#[derive(Debug, Clone, Default)]
pub(crate) struct Layout {
    /// The state folder.
    pub state: PathBuf,
    /// The vault folder, when one is set and exists.
    pub vault: Option<PathBuf>,
    /// The vault setting is an absolute path (a relative one is never deleted).
    pub vault_absolute: bool,
    /// install.sh's data dir (its unit's WorkingDirectory).
    pub data_dir: Option<PathBuf>,
    /// install.sh's prefix (`<prefix>/share/memora/install.sh`).
    pub prefix: Option<PathBuf>,
    /// The folder holding this program.
    pub program_dir: Option<PathBuf>,
    /// The home folder of the user running this.
    pub home: Option<PathBuf>,
}

/// What the operator chose to delete besides the program.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Selection {
    pub state: bool,
    pub vault: bool,
}

/// What an uninstall does.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Plan {
    /// Program parts removed.
    pub remove: Vec<String>,
    /// Folders memora-cli deletes itself.
    pub delete: Vec<PathBuf>,
    /// install.sh `--purge` deletes this data dir (and the memora user).
    pub purge: Option<PathBuf>,
    /// What stays.
    pub keep: Vec<String>,
    /// Commands for the operator to run afterwards (or on the Docker host).
    pub after: Vec<String>,
    /// Notes printed with them.
    pub notes: Vec<String>,
}

/// Why `p` must never be deleted, or `None`. `p` is resolved already. Refused:
/// relative paths, the root and top-level folders, system trees, home
/// folders themselves (and their parents), and folders holding this program.
pub(crate) fn unsafe_to_delete(
    p: &Path,
    home: Option<&Path>,
    program: Option<&Path>,
) -> Option<String> {
    if !p.is_absolute() {
        return Some("not an absolute path".into());
    }
    if p.components().any(|c| c == Component::ParentDir) {
        return Some("the path contains `..`".into());
    }
    let parts: Vec<String> = p
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect();
    match parts.len() {
        0 => return Some("it is the root of a drive or file system".into()),
        1 => return Some("it is a top-level system folder".into()),
        _ => {}
    }
    const SYSTEM: &[&str] = &[
        "bin",
        "boot",
        "dev",
        "etc",
        "lib",
        "lib32",
        "lib64",
        "libx32",
        "proc",
        "run",
        "sbin",
        "sys",
        "usr",
        "windows",
        "program files",
        "program files (x86)",
        "programdata",
        "system",
        "library",
        "applications",
    ];
    if SYSTEM.contains(&parts[0].as_str()) {
        return Some(format!("it is inside the system folder /{}", parts[0]));
    }
    if parts.len() == 2 && matches!(parts[0].as_str(), "home" | "users" | "var") {
        return Some("it is a home folder or a system folder".into());
    }
    if home.is_some_and(|h| h.starts_with(p)) {
        return Some("it is (or holds) your home folder".into());
    }
    if program.is_some_and(|d| d.starts_with(p)) {
        return Some("it holds the Memora program itself".into());
    }
    None
}

/// What uninstalling `kind` with `sel` does. Errors when the selection cannot
/// be done safely (nothing is deleted then).
pub(crate) fn build_plan(
    kind: &Kind,
    sel: Selection,
    l: &Layout,
) -> std::result::Result<Plan, String> {
    let mut plan = Plan::default();
    if sel.vault {
        let Some(v) = &l.vault else {
            return Err("no vault folder was found, so there is none to delete".into());
        };
        if !l.vault_absolute {
            return Err(format!(
                "the vault setting is a relative path; check where it is and delete {} yourself",
                v.display()
            ));
        }
        if !sel.state && l.state.starts_with(v) {
            return Err(format!(
                "the state folder {} is inside the vault, so deleting the vault deletes it too; \
                 select both, or neither",
                l.state.display()
            ));
        }
    }
    if let Some(v) = l.vault.as_ref().filter(|_| sel.state && !sel.vault) {
        if v.starts_with(&l.state) {
            return Err(format!(
                "the vault {} is inside the state folder, so deleting the state deletes it too; \
                 select both, or neither",
                v.display()
            ));
        }
    }
    let state_label = format!("settings and accounts (state folder {})", l.state.display());
    let vault_label = l
        .vault
        .as_ref()
        .map(|v| format!("vault notes ({})", v.display()));
    match kind {
        Kind::Docker => {
            plan.after.push("docker rm -f memora".into());
            if sel.state {
                plan.after.push("docker volume rm memora-state".into());
            }
            if sel.vault {
                plan.after.push("docker volume rm memora-data".into());
            }
            plan.notes.push(
                "Docker Compose: `docker compose down` in the folder of docker-compose.yml \
                 (it keeps the data folders)."
                    .into(),
            );
            if sel.state {
                plan.notes.push(
                    "Then delete the host folder mounted at /state (./state by default).".into(),
                );
            }
            if sel.vault {
                plan.notes.push(
                    "Then delete the host folder mounted at /data (./data by default).".into(),
                );
            }
        }
        Kind::Service {
            unit,
            installer: Some(_),
        } => {
            let prefix = l
                .prefix
                .clone()
                .unwrap_or_else(|| PathBuf::from("/usr/local"));
            plan.remove.push(format!(
                "the {unit} service (stopped, disabled, unit file deleted)"
            ));
            plan.remove.push(format!(
                "the programs memora and memora-cli in {}",
                prefix.join("bin").display()
            ));
            plan.remove.push(format!(
                "{} (web app, installer copy)",
                prefix.join("share").join("memora").display()
            ));
            if let (true, true, Some(d), Some(v)) = (sel.state, sel.vault, &l.data_dir, &l.vault) {
                if l.state == d.join("state") && *v == d.join("vault") {
                    plan.purge = Some(d.clone());
                }
            }
        }
        Kind::Service {
            unit,
            installer: None,
        } => {
            plan.remove.push(format!(
                "the running server: {unit} was not set up by install.sh, so it is only stopped"
            ));
            plan.after
                .push(format!("sudo systemctl disable --now {unit}"));
            plan.notes.push(
                "Then delete its unit file and the program files the way they were installed."
                    .into(),
            );
        }
        Kind::Process { npm: true } => {
            plan.remove
                .push("the running server (stopped; you remove the npm package afterwards)".into());
            plan.after.push(format!("npm uninstall -g {NPM_PACKAGE}"));
        }
        Kind::Process { npm: false } => {
            plan.remove.push(
                "the running server (stopped; you delete the program files afterwards)".into(),
            );
            if let Some(d) = &l.program_dir {
                plan.notes.push(format!(
                    "Delete the program folder {} (or the source checkout) when you are done.",
                    d.display()
                ));
            }
        }
    }
    if !matches!(kind, Kind::Docker) && plan.purge.is_none() {
        if sel.state {
            plan.delete.push(l.state.clone());
        }
        if let (true, Some(v)) = (sel.vault, &l.vault) {
            plan.delete.push(v.clone());
        }
    }
    for p in plan.delete.iter().chain(plan.purge.iter()) {
        if let Some(why) = unsafe_to_delete(p, l.home.as_deref(), l.program_dir.as_deref()) {
            return Err(format!("refusing to delete {}: {why}", p.display()));
        }
    }
    if !sel.state {
        plan.keep.push(state_label);
    }
    if let (false, Some(v)) = (sel.vault, vault_label) {
        plan.keep.push(v);
    }
    Ok(plan)
}

// ---------------------------------------------------------------------------
// Uninstall: doing it
// ---------------------------------------------------------------------------

/// Result of [`uninstall`].
pub(crate) struct Outcome {
    /// Something was removed or deleted (the console then closes).
    pub went_ahead: bool,
    pub code: i32,
}

impl Outcome {
    fn nothing(code: i32) -> Self {
        Outcome {
            went_ahead: false,
            code,
        }
    }
}

/// The configured vault: `(setting as written, resolved path)`.
fn vault_setting(ctx: &Ctx, unit_text: Option<&str>) -> Option<(String, PathBuf)> {
    if ctx.state.join(DB_FILE).is_file() {
        if let Ok(snap) = ctx.snapshot() {
            let raw = snap
                .vault_configured
                .clone()
                .or_else(|| ctx.setting(&snap, "MEMORA_VAULT"))?;
            return Some((raw, ctx.vault(&snap)));
        }
    }
    let raw = ctx
        .server
        .as_ref()
        .and_then(|s| s.var("MEMORA_VAULT").map(str::to_string))
        .or_else(|| std::env::var("MEMORA_VAULT").ok())
        .or_else(|| unit_text.and_then(|t| unit_env(t, "MEMORA_VAULT")))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())?;
    let p = PathBuf::from(&raw);
    let abs = match &ctx.server {
        Some(s) => s.absolute(&p),
        None => absolute(&p),
    };
    Some((raw, abs))
}

/// Gather the [`Layout`] of this install.
fn layout(ctx: &Ctx, kind: &Kind) -> Layout {
    let installer = match kind {
        Kind::Service {
            installer: Some(i), ..
        } => Some(i.clone()),
        _ => None,
    };
    let unit_text = installer
        .as_ref()
        .and_then(|_| std::fs::read_to_string(UNIT_FILE).ok());
    let vault = vault_setting(ctx, unit_text.as_deref());
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .filter(|h| !h.is_empty())
        .map(|h| resolve(Path::new(&h)));
    Layout {
        state: resolve(&ctx.state),
        vault_absolute: vault
            .as_ref()
            .is_some_and(|(raw, _)| memora_state::is_absolute_path(raw)),
        vault: vault.map(|(_, p)| resolve(&p)).filter(|p| p.exists()),
        data_dir: unit_text
            .as_deref()
            .and_then(|t| unit_value(t, "WorkingDirectory"))
            .map(|d| resolve(Path::new(&d))),
        // <prefix>/share/memora/install.sh
        prefix: installer
            .as_deref()
            .and_then(|i| i.parent()?.parent()?.parent())
            .map(Path::to_path_buf),
        program_dir: std::env::current_exe()
            .ok()
            .map(|e| resolve(&e))
            .and_then(|e| e.parent().map(Path::to_path_buf)),
        home,
    }
}

/// `• text` lines under a heading.
fn bullets(head: &str, items: &[String]) {
    if items.is_empty() {
        return;
    }
    println!("  {}", style(head).bold());
    for i in items {
        println!("    • {i}");
    }
}

/// What uninstall means for this install kind, before anything is chosen.
fn explain(kind: &Kind, base: &Plan, l: &Layout) {
    let intro = match kind {
        Kind::Service {
            unit,
            installer: Some(_),
        } => {
            format!("Memora was installed with install.sh and runs as the systemd service {unit}.")
        }
        Kind::Service { unit, .. } => format!(
            "Memora runs as the systemd service {unit}, which install.sh did not set up: \
             uninstall stops it, and you remove the service and program files yourself."
        ),
        Kind::Docker => "Memora runs in a Docker container. Nothing can be removed from inside \
                         it: choose what to delete and you get the commands to run on the host."
            .to_string(),
        Kind::Process { npm: true } => {
            "Memora was installed with npm. Uninstall stops the server; \
                                        you then remove the package with npm."
                .to_string()
        }
        Kind::Process { npm: false } => format!(
            "Memora runs from {} (a release download or a source build). Uninstall stops the \
             server; you then delete that folder.",
            l.program_dir
                .as_deref()
                .map(|d| d.display().to_string())
                .unwrap_or_else(|| "its program folder".into())
        ),
    };
    for line in crate::tui::wrap(&intro, 74) {
        println!("  {line}");
    }
    println!();
    if !matches!(kind, Kind::Docker) {
        bullets("Uninstall removes:", &base.remove);
    }
    bullets("It keeps, unless you select them below:", &base.keep);
    println!();
}

/// Ask which folders to delete as well. `None` when cancelled (Esc).
fn choose(theme: &ColorfulTheme, l: &Layout, f: &Flags) -> Result<Option<Selection>> {
    let mut items = vec![format!(
        "Settings and accounts (state folder: {}: database, keys, sessions)",
        l.state.display()
    )];
    let mut defaults = vec![f.delete_config];
    let offer_vault = l.vault.is_some() && l.vault_absolute;
    if let Some(v) = l.vault.as_ref().filter(|_| offer_vault) {
        items.push(format!("Vault notes ({})", v.display()));
        defaults.push(f.delete_vault);
    } else if let Some(v) = &l.vault {
        println!(
            "  {} the vault setting is a relative path, so uninstall leaves {} alone.",
            style("note:").yellow(),
            v.display()
        );
    }
    let picked = MultiSelect::with_theme(theme)
        .with_prompt("Also delete (space to select, Enter to continue)")
        .items(&items)
        .defaults(&defaults)
        .interact_opt()?;
    Ok(picked.map(|p| Selection {
        state: p.contains(&0),
        vault: offer_vault && p.contains(&1),
    }))
}

/// The plan, spelled out before the final question.
fn summary(plan: &Plan) {
    println!();
    println!("{}", style("Summary").bold());
    bullets("Removed:", &plan.remove);
    let mut deleted: Vec<String> = plan
        .delete
        .iter()
        .map(|p| format!("{} (for good)", p.display()))
        .collect();
    if let Some(d) = &plan.purge {
        deleted.push(format!(
            "{}: the state, the vault and everything else in it, and the memora system user",
            d.display()
        ));
    }
    bullets("Deleted:", &deleted);
    bullets("Kept:", &plan.keep);
    if !plan.after.is_empty() {
        println!("  {}", style("Afterwards, run:").bold());
        for c in &plan.after {
            println!("    {}", style(c).cyan());
        }
    }
    for n in &plan.notes {
        println!("  {}", style(n).dim());
    }
    println!();
}

/// Copy the state database out of the folders being deleted: a fresh backup
/// (`db backup`, consistent while the server runs), copied to the current
/// folder or else the home folder.
fn final_backup(ctx: &Ctx, plan: &Plan, home: Option<&Path>) -> Result<PathBuf> {
    let gone: Vec<&PathBuf> = plan.delete.iter().chain(plan.purge.iter()).collect();
    let dest = [
        std::env::current_dir().ok().map(|d| resolve(&d)),
        home.map(Path::to_path_buf),
    ]
    .into_iter()
    .flatten()
    .find(|d| d.is_dir() && !gone.iter().any(|g| d.starts_with(g)))
    .context("no folder outside the deleted ones to write it to (current or home folder)")?;
    let made = crate::db::backup(ctx, None, usize::MAX)?;
    let src = PathBuf::from(made["path"].as_str().context("the backup has no path")?);
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().replacen("memora-", "memora-final-", 1))
        .unwrap_or_else(|| "memora-final.db".into());
    let mut target = dest.join(&name);
    let mut n = 2;
    while target.exists() {
        target = dest.join(format!("{n}-{name}"));
        n += 1;
    }
    std::fs::copy(&src, &target).with_context(|| format!("copying to {}", target.display()))?;
    ok(&format!("Final backup written to {}", target.display()));
    Ok(target)
}

/// Delete one planned folder, checking it again first. False when it was gone.
fn delete_dir(p: &Path, l: &Layout) -> Result<bool> {
    if !p.exists() {
        return Ok(false);
    }
    let now = resolve(p);
    if now != p {
        anyhow::bail!("{} now points elsewhere ({})", p.display(), now.display());
    }
    if let Some(why) = unsafe_to_delete(&now, l.home.as_deref(), l.program_dir.as_deref()) {
        anyhow::bail!("refusing to delete {}: {why}", p.display());
    }
    std::fs::remove_dir_all(&now).with_context(|| format!("deleting {}", now.display()))?;
    Ok(true)
}

/// Docker: print the host commands (after an optional final backup).
fn docker_uninstall(
    ctx: &Ctx,
    theme: Option<&ColorfulTheme>,
    sel: Selection,
    plan: &Plan,
) -> Result<Outcome> {
    let mut cp = None;
    if sel.state && ctx.state.join(DB_FILE).is_file() {
        let want = match theme {
            Some(t) => {
                Confirm::with_theme(t)
                    .with_prompt("Make a final backup of the database first (to copy out)?")
                    .default(true)
                    .interact_opt()?
                    == Some(true)
            }
            None => true,
        };
        if want {
            match crate::db::backup(ctx, None, usize::MAX) {
                Ok(v) => cp = v["path"].as_str().map(str::to_string),
                Err(e) => println!("{} backup failed: {e:#}", style("!").yellow().bold()),
            }
        }
    }
    println!();
    println!("Run these on the host (use your container name if it is not memora):");
    if let Some(p) = &cp {
        println!(
            "  {}",
            style(format!("docker cp memora:{p} ./memora-final.db")).cyan()
        );
    }
    for c in &plan.after {
        println!("  {}", style(c).cyan());
    }
    for n in &plan.notes {
        println!("  {}", style(n).dim());
    }
    bullets("Kept:", &plan.keep);
    Ok(Outcome::nothing(0))
}

/// `uninstall` / `/uninstall`. `theme` is `None` when it must not ask
/// (`--yes`, or no terminal): then only the flags decide what is deleted.
pub(crate) fn uninstall(ctx: &Ctx, theme: Option<&ColorfulTheme>, f: &Flags) -> Result<Outcome> {
    let kind = match checked_kind(ctx) {
        Ok(k) => k,
        Err(code) => return Ok(Outcome::nothing(code)),
    };
    if theme.is_none() && !f.yes {
        println!("memora-cli uninstall needs a terminal to ask, or --yes to go ahead without one.");
        println!("With --yes only the program is removed, plus what --delete-config and");
        println!("--delete-vault name.");
        return Ok(Outcome::nothing(2));
    }
    if let Kind::Service { unit, .. } = &kind {
        if !crate::sys::is_root() {
            println!("Memora runs as the systemd service {unit}; removing it needs root. Run:");
            println!("  {}", style("sudo memora-cli uninstall").cyan());
            return Ok(Outcome::nothing(NEEDS_ROOT));
        }
    }
    let l = layout(ctx, &kind);
    let base = build_plan(&kind, Selection::default(), &l).map_err(anyhow::Error::msg)?;
    println!("{}", style("Uninstall Memora").bold());
    explain(&kind, &base, &l);
    let sel = match theme {
        Some(t) => match choose(t, &l, f)? {
            Some(s) => s,
            None => {
                println!("Nothing changed.");
                return Ok(Outcome::nothing(0));
            }
        },
        None => Selection {
            state: f.delete_config,
            vault: f.delete_vault,
        },
    };
    let plan = match build_plan(&kind, sel, &l) {
        Ok(p) => p,
        Err(e) => {
            println!("{} {e}", style("error:").red().bold());
            println!("Nothing changed.");
            return Ok(Outcome::nothing(1));
        }
    };
    if matches!(kind, Kind::Docker) {
        return docker_uninstall(ctx, theme, sel, &plan);
    }
    summary(&plan);
    if let Some(t) = theme {
        let go = Confirm::with_theme(t)
            .with_prompt("Uninstall now?")
            .default(false)
            .interact_opt()?;
        if go != Some(true) {
            println!("Nothing changed.");
            return Ok(Outcome::nothing(0));
        }
        if let (true, Some(v)) = (sel.vault, &l.vault) {
            let name = v
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| v.display().to_string());
            let typed: String = Input::with_theme(t)
                .with_prompt(format!(
                    "This deletes every note in the vault for good. Type its folder name ({name}) to confirm"
                ))
                .allow_empty(true)
                .interact_text()?;
            if typed.trim() != name {
                println!("The name does not match. Nothing changed.");
                return Ok(Outcome::nothing(1));
            }
        }
    }
    if sel.state && ctx.state.join(DB_FILE).is_file() {
        let want = match theme {
            Some(t) => {
                Confirm::with_theme(t)
                    .with_prompt(
                        "Write a final backup of the database outside the state folder first?",
                    )
                    .default(true)
                    .interact_opt()?
                    == Some(true)
            }
            None => true,
        };
        if want {
            if let Err(e) = final_backup(ctx, &plan, l.home.as_deref()) {
                println!(
                    "{} final backup failed: {e:#}",
                    style("error:").red().bold()
                );
                let go_on = match theme {
                    Some(t) => {
                        Confirm::with_theme(t)
                            .with_prompt("Continue without a backup?")
                            .default(false)
                            .interact_opt()?
                            == Some(true)
                    }
                    None => false,
                };
                if !go_on {
                    println!("Nothing changed.");
                    return Ok(Outcome::nothing(1));
                }
            }
        }
    }
    // Stop the server before its folders go.
    match &kind {
        Kind::Service {
            installer: Some(_), ..
        } => {} // install.sh stops and disables it
        Kind::Service { unit, .. } => {
            if systemctl("stop", unit)? != 0 {
                println!("The service is still running, so nothing was deleted.");
                return Ok(Outcome::nothing(1));
            }
        }
        Kind::Process { .. } => {
            if let StopResult::Failed(code) = proc_stop(ctx, theme, false)? {
                println!("The server is still running, so nothing was deleted.");
                return Ok(Outcome::nothing(code));
            }
        }
        Kind::Docker => unreachable!("handled above"),
    }
    if let Kind::Service {
        installer: Some(script),
        ..
    } = &kind
    {
        let mut cmd = Command::new("sh");
        cmd.arg(script).arg("--uninstall");
        if let Some(p) = &l.prefix {
            cmd.arg("--prefix").arg(p);
        }
        if let Some(d) = &plan.purge {
            cmd.args(["--purge", "--yes", "--data-dir"]).arg(d);
        }
        println!("Running {} --uninstall...", script.display());
        let status = cmd.status().context("running the installer")?;
        if !status.success() {
            println!(
                "{} the installer failed (exit {}). Your folders were not touched.",
                style("error:").red().bold(),
                status.code().unwrap_or(1)
            );
            return Ok(Outcome {
                went_ahead: true,
                code: 1,
            });
        }
    }
    let mut failed = false;
    for p in &plan.delete {
        match delete_dir(p, &l) {
            Ok(true) => ok(&format!("Deleted {}", p.display())),
            Ok(false) => println!("{} was already gone.", p.display()),
            Err(e) => {
                failed = true;
                println!("{} {e:#}", style("error:").red().bold());
            }
        }
    }
    println!();
    if failed {
        println!("Uninstall finished with errors (see above).");
    } else {
        ok("Memora is uninstalled.");
    }
    for k in &plan.keep {
        println!("  Kept: {k}");
    }
    if !plan.after.is_empty() {
        println!("  To finish, run:");
        for c in &plan.after {
            println!("    {}", style(c).cyan());
        }
    }
    for n in &plan.notes {
        println!("  {}", style(n).dim());
    }
    Ok(Outcome {
        went_ahead: true,
        code: i32::from(failed),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_large_log_is_moved_aside_on_start() {
        let d = std::env::temp_dir().join(format!("memora-logrot-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let log = d.join(LOG_FILE);
        std::fs::write(&log, "small").unwrap();
        rotate_log(&log, 10);
        assert!(log.is_file(), "a small log stays");
        std::fs::write(d.join("memora.log.1"), "older").unwrap();
        std::fs::write(&log, "x".repeat(11)).unwrap();
        rotate_log(&log, 10);
        assert!(!log.exists());
        assert_eq!(
            std::fs::read_to_string(d.join("memora.log.1")).unwrap(),
            "x".repeat(11),
            "the previous .1 is replaced"
        );
        rotate_log(&log, 10); // no log at all: nothing happens
        std::fs::remove_dir_all(&d).ok();
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn kind_detection() {
        let installer = Some(PathBuf::from("/usr/local/share/memora/install.sh"));
        let mut p = Probe {
            running_unit: Some("memora.service".into()),
            installer: installer.clone(),
            ..Probe::default()
        };
        assert_eq!(
            detect(&p),
            Kind::Service {
                unit: "memora.service".into(),
                installer: installer.clone()
            }
        );
        // another unit is not install.sh's, even with the installer around
        p.running_unit = Some("codrihub-memory.service".into());
        assert_eq!(
            detect(&p),
            Kind::Service {
                unit: "codrihub-memory.service".into(),
                installer: None
            }
        );
        // Docker wins over everything
        p.origin = Origin::Docker;
        assert_eq!(detect(&p), Kind::Docker);
        // stopped native service: its unit file serves this (or the default) state dir
        let mut p = Probe {
            unit_installed: true,
            unit_state_matches: true,
            installer: installer.clone(),
            ..Probe::default()
        };
        assert!(matches!(detect(&p), Kind::Service { .. }));
        p.unit_state_matches = false;
        assert_eq!(detect(&p), Kind::Process { npm: false });
        p.state_is_default = true;
        assert!(matches!(detect(&p), Kind::Service { .. }));
        // ...but an npm or source copy runs its own process
        p.origin = Origin::Npm;
        assert_eq!(detect(&p), Kind::Process { npm: true });
        p.origin = Origin::Source;
        assert_eq!(detect(&p), Kind::Process { npm: false });
        // plain processes
        let p = Probe {
            origin: Origin::Npm,
            ..Probe::default()
        };
        assert_eq!(detect(&p), Kind::Process { npm: true });
        assert_eq!(detect(&Probe::default()), Kind::Process { npm: false });
    }

    #[test]
    fn guard_against_another_installs_server() {
        let state = Path::new("/var/lib/memora/state");
        let service = Kind::Service {
            unit: "codrihub-memory.service".into(),
            installer: None,
        };
        // a named state folder (flag, env, default) is never second-guessed
        assert_eq!(guard(false, &service, Origin::Npm, state), Guard::Go);
        // adopted from a running service: only a native install drives it
        let g = guard(true, &service, Origin::Native, state);
        assert!(
            matches!(&g, Guard::Notice(n) if n.contains("/var/lib/memora/state")
            && n.contains("codrihub-memory.service"))
        );
        for o in [Origin::Npm, Origin::Source, Origin::Folder, Origin::Docker] {
            let g = guard(true, &service, o, state);
            assert!(
                matches!(&g, Guard::Refuse(m) if m.contains("--state")
                    && m.contains("systemctl") && m.contains("codrihub-memory.service")),
                "{o:?}: {g:?}"
            );
        }
        // a container is only driven from its own image
        assert!(matches!(
            guard(true, &Kind::Docker, Origin::Docker, state),
            Guard::Notice(_)
        ));
        assert!(matches!(
            guard(true, &Kind::Docker, Origin::Npm, state),
            Guard::Refuse(_)
        ));
        // a plain process: say which state folder, then go on
        assert!(matches!(
            guard(true, &Kind::Process { npm: true }, Origin::Npm, state),
            Guard::Notice(_)
        ));
    }

    #[test]
    fn unit_file_values() {
        let unit =
            "[Service]\nWorkingDirectory=/var/lib/memora\nEnvironment=HOME=/var/lib/memora\n\
                    Environment=MEMORA_STATE=/var/lib/memora/state\n\
                    Environment=\"MEMORA_VAULT=/srv/notes\"\n";
        assert_eq!(
            unit_env(unit, "MEMORA_STATE").as_deref(),
            Some("/var/lib/memora/state")
        );
        assert_eq!(
            unit_env(unit, "MEMORA_VAULT").as_deref(),
            Some("/srv/notes")
        );
        assert_eq!(unit_env(unit, "MEMORA_PORT"), None);
        assert_eq!(
            unit_value(unit, "WorkingDirectory").as_deref(),
            Some("/var/lib/memora")
        );
    }

    #[test]
    fn flags() {
        assert_eq!(parse_flags("start", &[]), Ok(Flags::default()));
        assert!(parse_flags("start", &s(&["--force"])).is_err());
        assert!(parse_flags("stop", &s(&["--force"])).unwrap().force);
        assert!(parse_flags("restart", &s(&["-f"])).unwrap().force);
        let f = parse_flags(
            "uninstall",
            &s(&["--delete-config", "--delete-vault", "--yes"]),
        )
        .unwrap();
        assert!(f.delete_config && f.delete_vault && f.yes && !f.force);
        assert!(parse_flags("uninstall", &s(&["-y"])).unwrap().yes);
        assert!(parse_flags("uninstall", &s(&["--force"])).is_err());
        assert!(parse_flags("uninstall", &s(&["--purge"])).is_err());
        assert!(parse_flags("stop", &s(&["now"])).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn deletion_safety() {
        let home = Some(Path::new("/home/alice"));
        let prog = Some(Path::new("/opt/memora/bin"));
        let bad = |p: &str| unsafe_to_delete(Path::new(p), home, prog).is_some();
        for p in [
            "/",
            "/home",
            "/home/alice",
            "/home/bob",
            "/root",
            "/var",
            "/var/lib",
            "/etc/memora",
            "/usr/local/share/memora",
            "/proc/1",
            "/srv",
            "relative/state",
            "/srv/../etc",
            "/opt/memora",
        ] {
            assert!(bad(p), "{p} must be refused");
        }
        for p in [
            "/home/alice/memora/state",
            "/var/lib/memora/state",
            "/var/lib/memora",
            "/srv/notes",
            "/tmp/memora-lc-test/vault",
            "/opt/memora/state",
        ] {
            assert!(!bad(p), "{p} must be allowed");
        }
        // a home folder elsewhere is protected too
        assert!(
            unsafe_to_delete(Path::new("/data/me"), Some(Path::new("/data/me")), None).is_some()
        );
    }

    #[cfg(windows)]
    #[test]
    fn deletion_safety_on_windows() {
        let home = Some(Path::new(r"C:\Users\Alice Smith"));
        let prog = Some(Path::new(r"C:\Tools\memora-1.3.3"));
        let bad = |p: &str| unsafe_to_delete(Path::new(p), home, prog).is_some();
        for p in [
            r"C:\",
            r"D:\",
            r"C:\Users",
            r"C:\Users\Alice Smith",
            r"C:\Users\Bob",
            r"C:\Windows",
            r"C:\Windows\System32\memora",
            r"C:\WINDOWS\Temp\vault",
            r"C:\Program Files\Memora",
            r"C:\ProgramData\memora",
            r"C:\Tools",
            r"C:\Tools\memora-1.3.3",
            r"C:\Users\Alice Smith\..\Bob\vault",
            r"relative\state",
            r"\\?\C:\",
        ] {
            assert!(bad(p), "{p} must be refused");
        }
        for p in [
            r"C:\Users\Alice Smith\memora\state",
            r"C:\Users\Alice Smith\Documents\vault",
            r"D:\notes\memora",
            r"C:\Tools\memora-data\state",
        ] {
            assert!(!bad(p), "{p} must be allowed");
        }
    }

    #[cfg(unix)]
    fn layout_at(root: &str) -> Layout {
        Layout {
            state: PathBuf::from(format!("{root}/state")),
            vault: Some(PathBuf::from(format!("{root}/vault"))),
            vault_absolute: true,
            data_dir: Some(PathBuf::from(root)),
            prefix: Some(PathBuf::from("/usr/local")),
            program_dir: Some(PathBuf::from("/usr/local/bin")),
            home: Some(PathBuf::from("/root")),
        }
    }

    #[cfg(unix)]
    #[test]
    fn plan_per_kind_and_selection() {
        let native = Kind::Service {
            unit: "memora.service".into(),
            installer: Some("/usr/local/share/memora/install.sh".into()),
        };
        let l = layout_at("/var/lib/memora");
        let none = Selection::default();
        let state = Selection {
            state: true,
            vault: false,
        };
        let both = Selection {
            state: true,
            vault: true,
        };

        // defaults keep everything
        let p = build_plan(&native, none, &l).unwrap();
        assert!(p.delete.is_empty() && p.purge.is_none());
        assert_eq!(p.keep.len(), 2);
        assert_eq!(p.remove.len(), 3);

        // state only: deleted by memora-cli, vault kept
        let p = build_plan(&native, state, &l).unwrap();
        assert_eq!(p.delete, vec![PathBuf::from("/var/lib/memora/state")]);
        assert!(p.purge.is_none());
        assert_eq!(p.keep.len(), 1);

        // both inside the installer's data dir: install.sh --purge
        let p = build_plan(&native, both, &l).unwrap();
        assert_eq!(p.purge, Some(PathBuf::from("/var/lib/memora")));
        assert!(p.delete.is_empty() && p.keep.is_empty());

        // both, but the vault lives elsewhere: no purge, two deletes
        let mut moved = l.clone();
        moved.vault = Some(PathBuf::from("/srv/notes"));
        let p = build_plan(&native, both, &moved).unwrap();
        assert!(p.purge.is_none());
        assert_eq!(p.delete.len(), 2);

        // npm: delete what was chosen, then npm uninstall
        let user = layout_at("/home/alice/memora");
        let npm = Kind::Process { npm: true };
        let p = build_plan(&npm, state, &user).unwrap();
        assert_eq!(p.delete, vec![PathBuf::from("/home/alice/memora/state")]);
        assert_eq!(
            p.after,
            vec!["npm uninstall -g @codrihub/memora".to_string()]
        );

        // Docker: never deletes, only prints host commands
        let p = build_plan(&Kind::Docker, both, &layout_at("/srv/docker")).unwrap();
        assert!(p.delete.is_empty() && p.purge.is_none() && p.remove.is_empty());
        assert!(p
            .after
            .contains(&"docker volume rm memora-state".to_string()));
        assert!(p
            .after
            .contains(&"docker volume rm memora-data".to_string()));
        let p = build_plan(&Kind::Docker, none, &layout_at("/srv/docker")).unwrap();
        assert_eq!(p.after, vec!["docker rm -f memora".to_string()]);

        // a custom unit is only stopped; the operator removes it
        let custom = Kind::Service {
            unit: "my-memora.service".into(),
            installer: None,
        };
        let p = build_plan(&custom, none, &l).unwrap();
        assert!(p.after[0].contains("disable --now my-memora.service"));
    }

    #[cfg(unix)]
    #[test]
    fn plan_refuses_unsafe_selections() {
        let files = Kind::Process { npm: false };
        let vault_only = Selection {
            state: false,
            vault: true,
        };
        let state_only = Selection {
            state: true,
            vault: false,
        };
        // state inside the vault: deleting the vault alone would take it
        let mut l = layout_at("/srv/memora");
        l.vault = Some(PathBuf::from("/srv/memora"));
        assert!(build_plan(&files, vault_only, &l).is_err());
        // vault inside the state folder
        let mut l = layout_at("/srv/memora");
        l.vault = Some(PathBuf::from("/srv/memora/state/notes"));
        assert!(build_plan(&files, state_only, &l).is_err());
        // relative vault setting, or no vault at all
        let mut l = layout_at("/srv/memora");
        l.vault_absolute = false;
        assert!(build_plan(&files, vault_only, &l).is_err());
        l.vault = None;
        assert!(build_plan(&files, vault_only, &l).is_err());
        // a vault that is the home folder, or holds the program
        let mut l = layout_at("/home/alice/memora");
        l.vault = Some(PathBuf::from("/home/alice"));
        l.home = Some(PathBuf::from("/home/alice"));
        assert!(build_plan(&files, vault_only, &l).is_err());
        let mut l = layout_at("/opt/memora");
        l.vault = Some(PathBuf::from("/opt/memora"));
        l.program_dir = Some(PathBuf::from("/opt/memora/bin"));
        assert!(build_plan(&files, vault_only, &l).is_err());
        // keeping both never fails
        assert!(build_plan(&files, Selection::default(), &l).is_ok());
    }

    #[test]
    fn http_status_line() {
        assert_eq!(parse_status(b"HTTP/1.1 200 OK\r\n"), Some(200));
        assert_eq!(parse_status(b"HTTP/1.0 404 Not Found"), Some(404));
        assert_eq!(parse_status(b"SSH-2.0-OpenSSH"), None);
        assert_eq!(parse_status(b""), None);
    }

    #[test]
    fn verbs() {
        assert_eq!(ing("stop"), "stopping");
        assert_eq!(ing("restart"), "restarting");
        assert_eq!(past("stop"), "stopped");
        assert_eq!(past("start"), "started");
    }
}
