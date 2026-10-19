//! Interactive console, opened by `memora-cli` with no arguments on a terminal.
//!
//! Reads slash commands (`/guide`, `/setup`, `/help`, ...) until `/quit` or
//! Ctrl-D. Ctrl-C quits from anywhere; a SIGINT guard restores the terminal
//! (echo, cursor) that the prompts may have changed.

mod commands;
pub(crate) mod docs;
mod welcome;

use crate::store::{self, Snapshot};
use crate::{
    ack_suffix, clear_cooldowns, close_window, create_vault_dir, fmt_secs, mark, ok, open_window,
    save_vault, unlock_instance, vault_owner_warning, writable_label, Ctx, DEFAULT_MINUTES,
    MAX_MINUTES,
};
use commands::{help, pick_command};
use console::style;
use dialoguer::theme::ColorfulTheme;
use dialoguer::{Confirm, Input, Password, Select};
use memora_state::arm::ArmMode;
use memora_state::{config, owner};
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::sync::OnceLock;

type Result<T> = anyhow::Result<T>;

/// Terminal settings at startup, restored by the SIGINT guard.
#[cfg(unix)]
static SAVED_TERMIOS: OnceLock<libc::termios> = OnceLock::new();

/// SIGINT handler: restore the terminal, show the cursor, exit 130.
/// Only async-signal-safe calls are used.
#[cfg(unix)]
extern "C" fn on_sigint(_: libc::c_int) {
    if let Some(t) = SAVED_TERMIOS.get() {
        unsafe { libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, t) };
    }
    let msg = b"\x1b[?25h\n";
    unsafe {
        libc::write(libc::STDERR_FILENO, msg.as_ptr().cast(), msg.len());
        libc::_exit(130);
    }
}

/// Windows: the console input mode (echo, line input) belongs to the console,
/// not to this process, so a prompt that turned echo off (a password) would
/// leave the shell without echo after Ctrl+C. The mode at startup is saved
/// and put back by the Ctrl+C handler, which also shows the cursor again.
#[cfg(windows)]
fn install_sigint_guard() {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
    #[link(name = "kernel32")]
    extern "system" {
        fn SetConsoleCtrlHandler(handler: extern "system" fn(u32) -> i32, add: i32) -> i32;
        fn GetStdHandle(which: u32) -> *mut c_void;
        fn GetConsoleMode(h: *mut c_void, mode: *mut u32) -> i32;
        fn SetConsoleMode(h: *mut c_void, mode: u32) -> i32;
    }
    /// STD_INPUT_HANDLE ((DWORD)-10).
    const STD_INPUT_HANDLE: u32 = 0xFFFF_FFF6;
    /// The console input handle and its mode at startup (0: not a console).
    static INPUT: AtomicIsize = AtomicIsize::new(0);
    static MODE: AtomicU32 = AtomicU32::new(0);

    extern "system" fn on_ctrl(_: u32) -> i32 {
        let h = INPUT.load(Ordering::SeqCst);
        if h != 0 {
            // SAFETY: the handle was a valid console input handle at startup.
            unsafe { SetConsoleMode(h as *mut c_void, MODE.load(Ordering::SeqCst)) };
        }
        eprintln!("\x1b[?25h");
        std::process::exit(130);
    }
    // SAFETY: plain console calls on this process's standard input handle; the
    // handler has the right signature and stays registered for the process lifetime.
    unsafe {
        let h = GetStdHandle(STD_INPUT_HANDLE);
        let mut mode = 0;
        if !h.is_null() && h as isize != -1 && GetConsoleMode(h, &mut mode) != 0 {
            MODE.store(mode, Ordering::SeqCst);
            INPUT.store(h as isize, Ordering::SeqCst);
        }
        SetConsoleCtrlHandler(on_ctrl, 1);
    }
}

/// Remember the terminal settings and install the SIGINT guard.
#[cfg(unix)]
fn install_sigint_guard() {
    let mut t = std::mem::MaybeUninit::<libc::termios>::uninit();
    if unsafe { libc::tcgetattr(libc::STDIN_FILENO, t.as_mut_ptr()) } == 0 {
        let _ = SAVED_TERMIOS.set(unsafe { t.assume_init() });
    }
    let handler = on_sigint as extern "C" fn(libc::c_int);
    unsafe { libc::signal(libc::SIGINT, handler as libc::sighandler_t) };
}

const BANNER: &str = r"
  ███╗   ███╗███████╗███╗   ███╗ ██████╗ ██████╗  █████╗
  ████╗ ████║██╔════╝████╗ ████║██╔═══██╗██╔══██╗██╔══██╗
  ██╔████╔██║█████╗  ██╔████╔██║██║   ██║██████╔╝███████║
  ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██║   ██║██╔══██╗██╔══██║
  ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║╚██████╔╝██║  ██║██║  ██║
  ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝";

/// Motto shown under the banner.
const MOTTO: &str = "Second brain for your AI";
/// What Memora is, in two sentences.
const DESCRIPTION: &str = "A self-hosted memory vault: your notes as plain Markdown, wired into a \
living brain that your AI agents read and write over MCP. What they learn stays.";
/// Why one shared memory: set up once, use everywhere.
const ONCE: &str = "Set up once, use everywhere: connect each agent once and they all share the \
same memory, on your local network or over the internet.";
/// Where the name comes from.
const NAME_NOTE: &str =
    "Memora is memory, advanced: built to remember what you and your AI learn, and to remember more the more you use it.";

/// Greedy word wrap of `text` to lines of at most `width` characters.
pub(crate) fn wrap(text: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut cur = String::new();
    for word in text.split_whitespace() {
        if !cur.is_empty() && cur.chars().count() + 1 + word.chars().count() > width {
            lines.push(std::mem::take(&mut cur));
        }
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(word);
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    lines
}

/// Run the console until the operator quits.
pub fn run(ctx: &Ctx) -> Result<()> {
    install_sigint_guard();
    let theme = ColorfulTheme::default();
    // First start on this instance: the introduction before anything else.
    if !welcome::seen(ctx) {
        welcome::run(ctx)?;
    }
    intro(ctx);
    loop {
        let Some(line) = read_command()? else {
            println!();
            return Ok(());
        };
        let cmd = line.trim();
        if cmd.is_empty() {
            continue;
        }
        if !cmd.starts_with('/') {
            println!(
                "{} commands start with {}. Try {}, {} or {}.",
                style("?").yellow().bold(),
                style("/").cyan(),
                style("/guide").cyan(),
                style("/help").cyan(),
                style("/docs").cyan()
            );
            continue;
        }
        let mut parts = cmd.split_whitespace();
        let mut name = parts.next().unwrap_or("").to_string();
        let arg = parts.next().map(str::to_string);
        // A lone "/" opens a picker, so nobody has to remember the names.
        if name == "/" {
            match pick_command(&theme)? {
                Some(n) => name = n,
                None => continue,
            }
        }
        let result = match name.as_str() {
            "/guide" => guide(ctx, &theme),
            "/welcome" => welcome::run(ctx).map(|_| intro(ctx)),
            "/setup" => setup(ctx, &theme),
            "/web" => open_web_window(ctx, &theme),
            "/reset" => match ctx.owner() {
                Ok(None) => {
                    println!(
                        "No owner account yet. Use {} first.",
                        style("/setup").cyan()
                    );
                    Ok(())
                }
                Ok(Some(o)) => reset_password(ctx, &theme, o),
                Err(e) => Err(e),
            },
            "/vault" => change_vault(ctx, &theme).map(|_| ()),
            "/status" => print_header(ctx, true).map(|_| ()),
            "/close" => close_window(ctx).map(|_| ok("Window closed (no lock applied).")),
            "/unlock" => unlock(ctx),
            "/config" => config(ctx, &theme),
            "/start" => crate::lifecycle::start(ctx).map(|_| ()),
            "/shutdown" | "/stop" => {
                let force = matches!(arg.as_deref(), Some("force" | "--force"));
                crate::lifecycle::stop(ctx, Some(&theme), force).map(|_| ())
            }
            "/restart" => crate::lifecycle::restart(ctx, Some(&theme), false).map(|_| ()),
            "/uninstall" => {
                match crate::lifecycle::uninstall(ctx, Some(&theme), &Default::default()) {
                    // the program or its folders are gone: nothing left to manage here
                    Ok(done) if done.went_ahead => {
                        println!("Leaving the console.");
                        return Ok(());
                    }
                    other => other.map(|_| ()),
                }
            }
            "/cooldowns" => cooldowns(ctx),
            "/update" => {
                crate::update::run(Some(&theme), false, false);
                Ok(())
            }
            "/backup" => crate::db::console_backup(ctx),
            "/db" => crate::db::console(ctx, arg.as_deref()),
            "/clear" => {
                let _ = console::Term::stdout().clear_screen();
                Ok(())
            }
            "/help" | "/?" => {
                help(arg.as_deref());
                Ok(())
            }
            "/keys" => crate::manage::keys(ctx, &theme),
            "/tools" => crate::manage::tools(ctx, &theme),
            "/sessions" => crate::manage::sessions(ctx, &theme),
            "/logout" => crate::manage::logout(ctx, &theme, arg.as_deref()),
            "/activity" => crate::manage::activity(ctx, arg.as_deref()),
            "/mcp" => crate::manage::mcp_guide(ctx),
            "/docs" => docs::run(ctx, &theme, arg.as_deref()),
            "/quit" | "/exit" | "/q" => return Ok(()),
            other => {
                println!(
                    "{} unknown command {}. Type {} to see them all.",
                    style("?").yellow().bold(),
                    style(other).cyan(),
                    style("/help").cyan()
                );
                Ok(())
            }
        };
        if let Err(e) = result {
            println!("{} {e:#}", style("error:").red().bold());
        }
        println!();
    }
}

/// Banner, welcome and the one next step that matters right now.
fn intro(ctx: &Ctx) {
    println!("{}", style(BANNER).cyan().bold());
    println!(
        "  {}  {}",
        style(format!("Memora v{}", env!("CARGO_PKG_VERSION"))).bold(),
        style(format!("· {MOTTO} · by Codrihub Tech")).dim()
    );
    println!();
    for line in wrap(DESCRIPTION, 72) {
        println!("  {line}");
    }
    for line in wrap(ONCE, 72) {
        println!("  {line}");
    }
    for line in wrap(NAME_NOTE, 72) {
        println!("  {}", style(line).dim());
    }
    println!();
    println!("  Welcome. This console manages the memora server on this machine:");
    println!("  the owner account, one-time codes for the browser and the vault folder.");
    println!();
    let snap = match print_header(ctx, false) {
        Ok(s) => s,
        Err(e) => {
            println!("  {} {e:#}", style("error:").red().bold());
            println!();
            return;
        }
    };
    let next = if snap.arm.locked() {
        format!(
            "The instance is LOCKED. Type {} to see how to recover.",
            style("/guide").cyan().bold()
        )
    } else if snap.owner.is_none() {
        format!(
            "Not set up yet. Type {} for a walkthrough, {} to start right away, {} to read.",
            style("/guide").cyan().bold(),
            style("/setup").cyan().bold(),
            style("/docs").cyan().bold()
        )
    } else {
        format!(
            "Ready. Type {} for commands, {} for a walkthrough, {} for the docs.",
            style("/help").cyan().bold(),
            style("/guide").cyan().bold(),
            style("/docs").cyan().bold()
        )
    };
    println!("  {next}");
    println!();
}

/// Read one line at the `memora ›` prompt. `None` on Ctrl-D.
fn read_command() -> Result<Option<String>> {
    use std::io::Write;
    print!("{} ", style("memora ›").cyan().bold());
    std::io::stdout().flush()?;
    let mut line = String::new();
    if std::io::stdin().read_line(&mut line)? == 0 {
        return Ok(None);
    }
    Ok(Some(line))
}

/// A walkthrough that follows the state of this instance.
fn guide(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    let snap = ctx.snapshot()?;
    let url = ctx.login_url(&snap);
    let step = |n: u8, text: String| println!("  {}  {text}", style(format!("{n}.")).cyan().bold());
    println!("{}", style("Guide").bold());
    println!();
    if snap.arm.locked() {
        println!("  A setup or reset window expired before it was finished, so the");
        println!("  instance is LOCKED: the API and agents are on hold until you recover.");
        println!();
        step(
            1,
            format!(
                "Type {} to open a new window (or {} to just lift the lock).",
                style("/web").cyan(),
                style("/unlock").cyan()
            ),
        );
        step(2, format!("Open {url} and enter the one-time code."));
        step(3, "Finish the form before the window closes.".into());
        return Ok(());
    }
    let Some(owner) = snap.owner.clone() else {
        println!("  Memora has a single owner account and no sign-up page. Creating it");
        println!("  needs this terminal, so access to the web port alone cannot claim it.");
        println!();
        step(
            1,
            format!(
                "Fastest: type {} and finish in the browser. Or {} to do it all here.",
                style("/web").cyan(),
                style("/setup").cyan()
            ),
        );
        step(
            2,
            format!("Browser: open {url} and enter the one-time code"),
        );
        println!("      shown here, then choose a username and password. One try only:");
        println!("      a wrong code voids the window. It stays open {DEFAULT_MINUTES} minutes");
        println!("      (you can choose 1-{MAX_MINUTES}); the page shows the countdown.");
        step(
            3,
            "Sign in. The app then asks for the vault folder, the folder of".into(),
        );
        println!("      markdown notes on this server (in Docker: the mounted volume,");
        println!("      e.g. /data).");
        step(
            4,
            "Connect agents with an API key from the app (Keys).".into(),
        );
        println!();
        let go = Confirm::with_theme(theme)
            .with_prompt("Start /setup now?")
            .default(true)
            .interact_opt()?;
        if go == Some(true) {
            return setup(ctx, theme);
        }
        return Ok(());
    };
    println!(
        "  This instance is set up. Owner: {}.",
        style(owner).green()
    );
    println!();
    step(1, format!("Sign in at {url}."));
    step(
        2,
        format!(
            "Forgot the password? {} sets a new one here, or opens a browser window.",
            style("/reset").cyan()
        ),
    );
    step(
        3,
        format!(
            "Vault folder: change it in the app's Settings, or with {}.",
            style("/vault").cyan()
        ),
    );
    step(
        4,
        format!(
            "Too many failed logins? Wait out the cooldown or type {}.",
            style("/cooldowns").cyan()
        ),
    );
    step(5, "Run and manage the server:".into());
    for (cmd, what) in [
        ("/start", "start the server"),
        ("/shutdown", "stop it (also /stop)"),
        ("/restart", "stop, then start; loads changed settings"),
        (
            "/uninstall",
            "remove Memora; your settings and notes stay unless you pick them",
        ),
    ] {
        println!("      {}  {what}", style(format!("{cmd:<11}")).cyan());
    }
    println!("      {}", style("Details: /docs manage").dim());
    if snap.vault_configured.is_none() {
        println!();
        println!(
            "  {} no vault folder chosen yet; the app asks for it after sign-in.",
            style("note:").yellow()
        );
    }
    Ok(())
}

/// `/setup`: first-run setup, refused once an owner exists.
fn setup(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    if let Some(owner) = ctx.owner()? {
        println!(
            "Already set up (owner {}). Use {} to change the password.",
            style(owner).green(),
            style("/reset").cyan()
        );
        return Ok(());
    }
    initialize(ctx, theme)
}

/// The status block. `explain` adds a plain-language line under each field.
/// Returns the snapshot it showed.
fn print_header(ctx: &Ctx, explain: bool) -> Result<Snapshot> {
    let snap = ctx.snapshot()?;
    let st = &snap.arm;
    let vault = ctx.vault(&snap);
    let vault_mark = if memora_gateway::dir_writable(&vault) {
        style(writable_label(&vault)).green()
    } else {
        style(writable_label(&vault)).red()
    };
    let window = if st.armed() {
        style(format!(
            "open: {}, {} left",
            st.mode.as_deref().unwrap_or("?"),
            fmt_secs(st.remaining)
        ))
        .yellow()
    } else {
        style("closed".to_string()).dim()
    };
    let lock = if st.locked() {
        style("yes".to_string()).red().bold()
    } else {
        style("no".to_string()).green()
    };
    let owner = match snap.owner.clone() {
        Some(o) => style(o).green(),
        None => style("none".to_string()).yellow(),
    };
    let why = |text: &str| {
        if explain {
            println!("              {}", style(text).dim());
        }
    };
    println!(
        "  state dir : {} {}",
        ctx.state.display(),
        style(format!("({})", ctx.source)).dim()
    );
    why("The server's private files: the state database (account, API keys,");
    why("sessions, settings, window) and its backups. Not your notes.");
    if snap.vault_configured.is_some() {
        println!("  vault     : {} {}", vault.display(), vault_mark);
    } else {
        println!(
            "  vault     : {} {}",
            style("not chosen yet").yellow(),
            style(format!("(suggested {})", vault.display())).dim()
        );
    }
    why("Your markdown notes: the memory the app and every agent read and");
    why("write. Chosen in the browser after the first sign-in, or with /vault.");
    println!("  owner     : {owner}");
    why("The one account that can sign in to the web app (\"none\": not set up).");
    println!("  window    : {window}");
    why("A short opening (/web) in which the browser can create the owner or");
    why("reset the password with a one-time code. Closed the rest of the time.");
    println!("  locked    : {lock}");
    why("\"yes\" when a window expired unfinished: the web app, the API and");
    why("agents are on hold until you open a new window (/web) or /unlock.");
    if let Some((at, ip, mode)) = &st.burn {
        let ago = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64 - at)
            .unwrap_or(0);
        println!(
            "  {} a wrong {} code from {} voided the last window {} ago.",
            style("warning:").red().bold(),
            if mode.as_deref() == Some("reset") {
                "reset"
            } else {
                "setup"
            },
            style(ip).bold(),
            fmt_secs(ago.max(0))
        );
        why("One wrong code closes the window. Type /web for a new code.");
    }
    println!();
    Ok(snap)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/// First-run setup: vault folder, then the owner account (terminal or web).
fn initialize(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    println!("Step 1 of 2: the vault folder (where your markdown notes live).");
    let when = Select::with_theme(theme)
        .with_prompt("When do you want to choose it?")
        .items(&[
            "Later, in the browser after sign-in",
            "Now, here in the terminal",
        ])
        .default(0)
        .interact_opt()?;
    match when {
        Some(1) => {
            if !change_vault(ctx, theme)? {
                return Ok(());
            }
        }
        Some(_) => {}
        None => return Ok(()),
    }
    println!();
    println!("Step 2 of 2: create the owner account.");
    let choice = Select::with_theme(theme)
        .with_prompt("How do you want to create the owner account?")
        .items(&[
            "Here in the terminal",
            "In the browser, with a one-time code",
        ])
        .default(0)
        .interact_opt()?;
    match choice {
        Some(0) => set_password_here(ctx, theme, None),
        Some(_) => web_window(ctx, theme, ArmMode::Bootstrap),
        None => Ok(()),
    }
}

/// Reset the owner password, here or through a web window.
fn reset_password(ctx: &Ctx, theme: &ColorfulTheme, owner: String) -> Result<()> {
    let sure = Confirm::with_theme(theme)
        .with_prompt(format!(
            "Reset the password of {owner}? Every signed-in device will be signed out."
        ))
        .default(false)
        .interact_opt()?;
    if sure != Some(true) {
        println!("Nothing changed.");
        return Ok(());
    }
    let choice = Select::with_theme(theme)
        .with_prompt("Reset the password")
        .items(&["Set a new password here", "Open a password reset window"])
        .default(0)
        .interact_opt()?;
    match choice {
        Some(0) => set_password_here(ctx, theme, Some(owner)),
        Some(_) => web_window(ctx, theme, ArmMode::Reset),
        None => Ok(()),
    }
}

/// `/web`: a setup window without an owner, a password reset window otherwise.
fn open_web_window(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    let mode = if ctx.owner()?.is_none() {
        ArmMode::Bootstrap
    } else {
        ArmMode::Reset
    };
    web_window(ctx, theme, mode)
}

/// Ask for the window length, open the window and print its one-time code.
fn web_window(ctx: &Ctx, theme: &ColorfulTheme, mode: ArmMode) -> Result<()> {
    let minutes: i64 = Input::with_theme(theme)
        .with_prompt(format!("Window length in minutes (1-{MAX_MINUTES})"))
        .default(DEFAULT_MINUTES)
        .validate_with(|m: &i64| {
            if (1..=MAX_MINUTES).contains(m) {
                Ok(())
            } else {
                Err(format!("enter a number from 1 to {MAX_MINUTES}"))
            }
        })
        .interact_text()?;
    open_window(ctx, mode, minutes * 60)
}

/// Create or replace the owner account from the terminal. `current` is the
/// existing owner name (offered as the default), `None` on first setup.
fn set_password_here(ctx: &Ctx, theme: &ColorfulTheme, current: Option<String>) -> Result<()> {
    if current.is_some() {
        println!(
            "  {}",
            style("Username: press Enter to keep it. Password: leave it empty to cancel.").dim()
        );
    }
    let mut input = Input::<String>::with_theme(theme)
        .with_prompt("Username")
        .validate_with(|n: &String| {
            if memora_gateway::valid_username(n.trim()) {
                Ok(())
            } else {
                Err("1-32 characters: letters, digits, - _ .")
            }
        });
    if let Some(c) = &current {
        input = input.default(c.clone());
    }
    let username = input.interact_text()?.trim().to_lowercase();

    let snap = ctx.snapshot()?;
    let min = snap.min_password_len;
    let password = Password::with_theme(theme)
        .with_prompt(format!(
            "New password (min {min} characters, empty to cancel)"
        ))
        .allow_empty_password(true)
        .validate_with(move |p: &String| {
            if p.is_empty() || p.chars().count() >= min {
                Ok(())
            } else {
                Err(format!("at least {min} characters required"))
            }
        })
        .interact()?;
    if password.is_empty() {
        println!("Cancelled. Nothing changed.");
        return Ok(());
    }
    let again = Password::with_theme(theme)
        .with_prompt("Repeat the new password")
        .allow_empty_password(true)
        .interact()?;
    if again != password {
        println!(
            "{} the two passwords differ. Nothing changed; try again.",
            style("error:").red().bold()
        );
        return Ok(());
    }
    if let Some(old) = &current {
        let what = if *old == username {
            format!("Save the new password for {username}?")
        } else {
            format!("Rename {old} to {username} and save the new password?")
        };
        let save = Confirm::with_theme(theme)
            .with_prompt(format!("{what} Every signed-in device will be signed out."))
            .default(false)
            .interact_opt()?;
        if save != Some(true) {
            println!("Nothing changed.");
            return Ok(());
        }
    }

    println!("Hashing password...");
    let hash = memora_gateway::hash_password(&password)?;
    // One transaction: the account, the sign-outs, the window / lock and the log rows.
    let expected = current.clone();
    let signed_out: usize = store::write(ctx, |tx| {
        let now = memora_state::now();
        let existing = owner::owner_name(tx)?;
        if existing != expected {
            return Err(memora_state::Error::Conflict(format!(
                "the owner account changed meanwhile (now {}); nothing saved, try again",
                existing.as_deref().unwrap_or("none")
            )));
        }
        let sessions = memora_state::session::list(tx)?.len();
        // creates the owner, or replaces it and signs out every device
        owner::set_owner(tx, &username, &hash, now)?;
        // the account is complete: a pending window or lock no longer applies
        memora_state::arm::disarm(tx)?;
        memora_state::arm::unlock(tx)?;
        match &expected {
            None => store::log(
                tx,
                "setup_done",
                &format!("owner {username} created in the terminal"),
            )?,
            Some(old) => {
                if *old != username {
                    store::log(tx, "username_changed", &format!("{old} -> {username}"))?;
                }
                store::log(
                    tx,
                    "password_reset",
                    &format!("password of {username} set in the terminal; {sessions} session(s) signed out"),
                )?;
            }
        }
        Ok(if expected.is_some() { sessions } else { 0 })
    })?;
    match current {
        Some(old) if old != username => ok(&format!(
            "Owner renamed {old} -> {username} and password updated."
        )),
        Some(_) => ok(&format!("Password updated for {username}.")),
        None => ok(&format!("Owner account {username} created.")),
    }
    if signed_out > 0 {
        println!("{signed_out} signed-in device(s) were signed out.");
    }
    println!("Sign in at {}", ctx.login_url(&snap));
    Ok(())
}

fn unlock(ctx: &Ctx) -> Result<()> {
    unlock_instance(ctx)?;
    ok("Instance UNLOCKED (owner account unchanged).");
    Ok(())
}

fn cooldowns(ctx: &Ctx) -> Result<()> {
    println!("Asking the running server to clear every login cooldown...");
    match clear_cooldowns(ctx)? {
        Some(result) => ok(&format!(
            "Login cooldowns cleared by the running server{}.",
            ack_suffix(&result)
        )),
        None => {
            println!("No running server answered within 5 seconds, so nothing was cleared.");
            println!("Cooldowns live only in a running server's memory: a stopped server");
            println!("has none, and a restart clears them too.");
        }
    }
    Ok(())
}

/// Pick and save a vault folder. Returns false when cancelled.
fn change_vault(ctx: &Ctx, theme: &ColorfulTheme) -> Result<bool> {
    let snap = ctx.snapshot()?;
    let current = ctx.vault(&snap);
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let start = current
        .parent()
        .filter(|p| p.is_dir())
        .map(Path::to_path_buf)
        .unwrap_or(cwd);
    let Some(dir) = pick_folder(ctx, theme, start)? else {
        println!("Vault unchanged.");
        return Ok(false);
    };
    let saved = save_vault(ctx, &dir)?;
    ok(&format!(
        "Vault set to {} (state database).",
        saved.display()
    ));
    if let Some(w) = vault_owner_warning(ctx, &saved) {
        println!("{w}");
    }
    if ctx.server.is_some() {
        println!(
            "{}",
            style("The running server keeps its vault until it restarts (/restart).").yellow()
        );
    } else {
        println!("The server uses this vault the next time it starts.");
    }
    Ok(true)
}

/// Entries of the folder picker.
enum Pick {
    Use,
    Up,
    Into(PathBuf),
    Type,
    Create,
}

/// Browse directories and return the chosen one; `None` when cancelled (Esc).
fn pick_folder(ctx: &Ctx, theme: &ColorfulTheme, start: PathBuf) -> Result<Option<PathBuf>> {
    let mut cur = start;
    loop {
        let mut entries = vec![(format!("✓ Use this folder: {}", cur.display()), Pick::Use)];
        if cur.parent().is_some() {
            entries.push(("⬆ ..".to_string(), Pick::Up));
        }
        match subdirs(&cur) {
            Ok(dirs) => {
                for d in dirs {
                    let name = d.file_name().map(|n| n.to_string_lossy().to_string());
                    entries.push((format!("  {}/", name.unwrap_or_default()), Pick::Into(d)));
                }
            }
            Err(e) => println!("{} cannot list {}: {e}", style("!").yellow(), cur.display()),
        }
        entries.push(("✎ Type a path…".to_string(), Pick::Type));
        entries.push(("+ Create a new folder here…".to_string(), Pick::Create));

        let labels: Vec<&str> = entries.iter().map(|(l, _)| l.as_str()).collect();
        let Some(i) = Select::with_theme(theme)
            .with_prompt(format!("Vault folder: {}  (Esc to cancel)", cur.display()))
            .items(&labels)
            .default(0)
            .max_length(15)
            .interact_opt()?
        else {
            return Ok(None);
        };
        match &entries[i].1 {
            Pick::Use => {
                if memora_gateway::dir_writable(&cur) {
                    return Ok(Some(cur));
                }
                println!(
                    "{} {} is not writable; choose another folder.",
                    style(mark(false)).red(),
                    cur.display()
                );
            }
            Pick::Up => {
                if let Some(p) = cur.parent() {
                    cur = p.to_path_buf();
                }
            }
            Pick::Into(d) => cur = d.clone(),
            Pick::Type => {
                let typed: String = Input::with_theme(theme)
                    .with_prompt("Path")
                    .with_initial_text(cur.to_string_lossy())
                    .interact_text()?;
                let p = cur.join(expand_home(typed.trim()));
                if p.is_dir() {
                    cur = p;
                } else if p.exists() {
                    println!(
                        "{} {} is not a directory.",
                        style(mark(false)).red(),
                        p.display()
                    );
                } else if Confirm::with_theme(theme)
                    .with_prompt(format!("{} does not exist. Create it?", p.display()))
                    .default(true)
                    .interact()?
                {
                    create_vault_dir(ctx, &p)?;
                    cur = p;
                }
            }
            Pick::Create => {
                let name: String = Input::with_theme(theme)
                    .with_prompt("New folder name")
                    .validate_with(|n: &String| {
                        let n = n.trim();
                        if n.is_empty() || n == "." || n == ".." || n.contains('/') {
                            Err("enter a single folder name")
                        } else {
                            Ok(())
                        }
                    })
                    .interact_text()?;
                let p = cur.join(name.trim());
                create_vault_dir(ctx, &p)?;
                ok(&format!("Created {}", p.display()));
                cur = p;
            }
        }
    }
}

/// Visible subdirectories of `dir`, sorted by name.
fn subdirs(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)?
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    v.sort();
    Ok(v)
}

/// Expand a leading `~/` to $HOME.
fn expand_home(p: &str) -> PathBuf {
    match (p.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(h)) => PathBuf::from(h).join(rest),
        _ if p == "~" => std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default(),
        _ => PathBuf::from(p),
    }
}

// ---------------------------------------------------------------------------
// Server settings and restart
// ---------------------------------------------------------------------------

/// The current value of a setting and where it comes from.
fn shown_value(ctx: &Ctx, snap: &Snapshot, key: &str) -> String {
    if let Some(v) = snap.config.get(key).filter(|v| !v.is_empty()) {
        return style(v).green().to_string();
    }
    if let Some(v) = ctx.server.as_ref().and_then(|s| s.var(key)) {
        return style(format!("{v} (server environment)")).dim().to_string();
    }
    match (
        std::env::var(key).ok().filter(|v| !v.trim().is_empty()),
        config::default_value(key),
    ) {
        (Some(v), _) => style(format!("{v} (environment)")).dim().to_string(),
        (None, Some(d)) => style(format!("{d} (default)")).dim().to_string(),
        (None, None) => style("(not set)").dim().to_string(),
    }
}

/// `/config`: list every setting, edit any of them, then offer a restart.
fn config(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    let mut changed = false;
    loop {
        let snap = ctx.snapshot()?;
        println!(
            "{} {}",
            style("Settings").bold(),
            style("(state database; the server loads them when it starts)").dim()
        );
        let n = config::CONFIG_KEYS.len();
        let mut items: Vec<String> = config::CONFIG_KEYS
            .iter()
            .map(|(k, _)| format!("{k:<24} {}", shown_value(ctx, &snap, k)))
            .collect();
        items.push(format!(
            "{:<24} {}",
            "MEMORA_API_KEY",
            style("not stored: create a default API key now").dim()
        ));
        items.push(format!(
            "{:<24} {}",
            "MEMORA_ADMIN_PASSWORD",
            style("not stored: set the password with /setup or /reset").dim()
        ));
        items.push(if changed {
            "Done (restart to apply)".to_string()
        } else {
            "Done".to_string()
        });
        let Some(i) = Select::with_theme(theme)
            .with_prompt("Pick a setting to edit")
            .items(&items)
            .default(items.len() - 1)
            .interact_opt()?
        else {
            break;
        };
        if i == n {
            default_api_key(ctx, theme)?;
            println!();
            continue;
        }
        if i == n + 1 {
            println!(
                "  {}",
                style("The owner password is never a setting; only its hash is stored.").dim()
            );
            println!(
                "  Set it with {} (first setup) or {} (signs out every device).",
                style("/setup").cyan(),
                style("/reset").cyan()
            );
            println!();
            continue;
        }
        if i > n + 1 {
            break;
        }
        let (key, help) = config::CONFIG_KEYS[i];
        println!("  {}", style(help).dim());
        let v = edit_value(&snap, theme, key)?.trim().to_string();
        let old = snap.config.get(key).cloned();
        let stored: Option<String> = store::write(ctx, |tx| {
            config::set(
                tx,
                key,
                (!v.is_empty()).then_some(v.as_str()),
                memora_state::now(),
            )?;
            let new = config::get(tx, key)?;
            if new != old {
                let detail = match &new {
                    Some(n) => format!("{key} = {n}"),
                    None => format!("{key} cleared"),
                };
                store::log(tx, "config_changed", &detail)?;
            }
            Ok(new)
        })?;
        if stored == old {
            println!("No change.");
        } else {
            ok(&format!(
                "{key} {}.",
                if v.is_empty() { "cleared" } else { "saved" }
            ));
            changed = true;
        }
        println!();
    }
    if changed {
        crate::lifecycle::after_change(ctx, theme)?;
    }
    Ok(())
}

/// Create an API key with the default permissions and show it once (instead
/// of storing `MEMORA_API_KEY`).
fn default_api_key(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    println!(
        "  {}",
        style("Secrets are never stored as settings. Create an API key instead:").dim()
    );
    println!(
        "  {}",
        style("it is shown once, stored as a hash and managed in /keys.").dim()
    );
    let name: String = Input::with_theme(theme)
        .with_prompt("Name for the key")
        .default("default".into())
        .validate_with(|n: &String| {
            if (1..=80).contains(&n.trim().chars().count()) {
                Ok(())
            } else {
                Err("1-80 characters")
            }
        })
        .interact_text()?;
    let name = name.trim().to_string();
    let go = Confirm::with_theme(theme)
        .with_prompt(format!(
            "Create key \"{name}\" (use every MCP tool, read and write notes; no admin)?"
        ))
        .default(true)
        .interact_opt()?;
    if go != Some(true) {
        println!("Nothing changed.");
        return Ok(());
    }
    let k = store::new_key(
        &name,
        memora_state::keys::Scope::default_set(),
        memora_state::keys::ToolGrant::All,
    );
    let new = k.new.clone();
    store::write(ctx, |tx| {
        memora_state::keys::create(tx, &new, memora_state::now())?;
        store::log(tx, "key_created", &format!("{} ({})", new.name, new.id))
    })?;
    println!();
    println!(
        "  {} {}",
        style("API key:").bold(),
        style(&k.raw).green().bold()
    );
    println!(
        "  {}",
        style("Shown only now. Agents send it as Authorization: Bearer <key>. See /mcp.").dim()
    );
    Ok(())
}

/// Ask for a new value (empty clears the setting).
fn edit_value(snap: &Snapshot, theme: &ColorfulTheme, key: &'static str) -> Result<String> {
    let current = snap.config.get(key).cloned().unwrap_or_default();
    let v: String = Input::with_theme(theme)
        .with_prompt(format!("{key} (empty to clear)"))
        .with_initial_text(current)
        .allow_empty(true)
        .validate_with(move |v: &String| validate_setting(key, v.trim()))
        .interact_text()?;
    Ok(v)
}

/// The state crate's check, with friendlier hints for a few keys.
fn validate_setting(key: &str, v: &str) -> std::result::Result<(), String> {
    if v.is_empty() {
        return Ok(());
    }
    match key {
        "MEMORA_BIND" if v.parse::<std::net::IpAddr>().is_err() => {
            return Err("an IP address such as 0.0.0.0 or 127.0.0.1".into())
        }
        "MEMORA_BASE_URL" if !(v.starts_with("http://") || v.starts_with("https://")) => {
            return Err("starts with http:// or https://".into())
        }
        "MEMORA_VAULT" if !memora_state::is_absolute_path(v) => {
            return Err("an absolute path".into())
        }
        _ => {}
    }
    config::validate(key, v).map(|_| ()).map_err(|e| match e {
        memora_state::Error::Invalid { reason, .. } => reason,
        other => other.to_string(),
    })
}
