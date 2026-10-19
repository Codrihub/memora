//! The console's command table, `/help` and the `/` command picker.

use anyhow::Result;
use console::style;
use dialoguer::theme::ColorfulTheme;
use dialoguer::Select;

/// A console command: name, arguments, one-line summary for the list, and the
/// longer explanation shown by `/help <command>`.
pub(super) struct Cmd {
    pub name: &'static str,
    pub args: &'static str,
    pub group: &'static str,
    pub short: &'static str,
    pub long: &'static str,
}

#[rustfmt::skip]
pub(super) const COMMANDS: &[Cmd] = &[
    Cmd { name: "/welcome", args: "", group: "Start here",
        short: "what Memora is and why: set up once, use everywhere",
        long: "Five short screens, the same as /welcome in the browser: what Memora is,\n\
               why one shared memory beats setting up every agent again, how to reach it\n\
               from anywhere (local network or a tunnel), what is inside, and where to\n\
               start. Enter or the right arrow moves on, left goes back, s skips.\n\
               It opens by itself the first time the console starts." },
    Cmd { name: "/guide", args: "", group: "Start here",
        short: "step-by-step walkthrough for this instance",
        long: "Reads the current state (not set up, set up or locked) and tells you\n\
               the next steps. When nothing is set up yet, it offers to start /setup." },
    Cmd { name: "/docs", args: "[topic]", group: "Start here",
        short: "documentation: setup, agents, prompts, keys, fixes",
        long: "Opens a menu of topics (arrow keys, Enter to read, Esc to close):\n\
               getting started, connecting agents, the recommended agent instructions,\n\
               keys and permissions, commands, backups and updates, running and\n\
               removing the server, troubleshooting.\n\
               /docs <topic> prints one directly, e.g. /docs prompt or /docs 7.\n\
               The same pages: `memora-cli docs [topic|all]`. Full docs: <base>/docs." },
    Cmd { name: "/web", args: "", group: "Start here",
        short: "one-time code to set up or reset in the browser",
        long: "Opens a window (default 5 minutes, 1-60) and prints a one-time code.\n\
               Open the login page, enter the code, then choose username and password.\n\
               Without an owner it is a setup window, otherwise a password reset window.\n\
               One try only: a wrong code voids the window; run /web again." },
    Cmd { name: "/setup", args: "", group: "Start here",
        short: "create the owner account (terminal or browser)",
        long: "First-run setup. Choose the vault folder now or later in the browser,\n\
               then create the owner here (username and password) or through a\n\
               browser window (/web)." },
    Cmd { name: "/status", args: "", group: "Start here",
        short: "owner, vault, window and lock, explained",
        long: "State dir, vault, owner, window and lock, each with a short explanation." },
    Cmd { name: "/reset", args: "", group: "Account and access",
        short: "set a new owner password (asks first)",
        long: "Sets a new owner password here, or opens a password reset window.\n\
               Username: press Enter to keep it. Password: leave it empty to cancel.\n\
               A reset signs out every device (recorded in /activity)." },
    Cmd { name: "/keys", args: "", group: "Account and access",
        short: "API keys: create, permissions, on/off, delete",
        long: "Lists every API key: what it may do, how many tools it may use, and\n\
               when and from which IP it was last used. Create a key (shown once),\n\
               turn one off without deleting it, or delete it (it goes to the trash;\n\
               Trash in the same menu restores it).\n\
               Manage -> Permissions asks what the key may do (use MCP tools, read\n\
               notes over the HTTP API, change notes over HTTP and MCP, admin) and\n\
               which tools it may use (all, or only the ones you tick). MCP tools\n\
               that change the vault also need write. New keys get everything\n\
               except admin unless you answer No when creating them.\n\
               Tools switched off in /tools stay off for every key." },
    Cmd { name: "/sessions", args: "", group: "Account and access",
        short: "signed-in devices; sign out one or all",
        long: "Lists every browser session (device, IP, sign-in time, last activity).\n\
               Pick one to sign it out, or sign out every device. The id column is\n\
               the short session id that /logout also accepts." },
    Cmd { name: "/logout", args: "<#|id|all>", group: "Account and access",
        short: "sign out device # or id from /sessions, or all",
        long: "Examples:  /logout 2         signs out device #2 from /sessions\n\
               \x20          /logout 3fa9c2d1  signs out the session with that id\n\
               \x20                            (8 or more characters)\n\
               \x20          /logout all       signs out every device (asks first)\n\
               The device is signed out at once; its next request needs a new sign-in." },
    Cmd { name: "/activity", args: "[N|fail]", group: "Account and access",
        short: "security log: sign-ins, failures, changes",
        long: "Newest first, with time, IP and user. /activity 100 shows more;\n\
               /activity fail shows only failures (wrong passwords, wrong codes,\n\
               invalid API keys)." },
    Cmd { name: "/close", args: "", group: "Account and access",
        short: "close an open setup/reset window (code stops working)",
        long: "Closes the window without locking. Use it when you opened one by\n\
               mistake or no longer need it." },
    Cmd { name: "/unlock", args: "", group: "Account and access",
        short: "lift the lock after a window expired unfinished",
        long: "When a window expires before the form is done, the instance is LOCKED.\n\
               /unlock lifts the lock; the owner account and password stay as they are." },
    Cmd { name: "/cooldowns", args: "", group: "Account and access",
        short: "end the login cooldown after failed attempts",
        long: "Wrong passwords or codes put the caller on a 5, 10, then 15 minute\n\
               cooldown. Use this when it was you. The running server confirms within\n\
               a few seconds; cooldowns live only in its memory, so with no server\n\
               running there is nothing to clear." },
    Cmd { name: "/mcp", args: "", group: "Agents",
        short: "connect AI agents: MCP endpoint and client configs",
        long: "Prints the MCP endpoint and copy-paste configs for common MCP clients." },
    Cmd { name: "/tools", args: "", group: "Agents",
        short: "MCP tools: switch tools on/off for every agent",
        long: "Lists every MCP tool by category, with ✓ on / ✗ off and what it does.\n\
               Tick the tools that stay on (one category at a time), enable all, or\n\
               switch off a whole category. A tool switched off is hidden from every\n\
               agent and API key and refused if called. Saved in the state database;\n\
               the running server applies it on the next request, no restart.\n\
               To limit a single key instead: /keys -> Permissions." },
    Cmd { name: "/vault", args: "", group: "Data and backups",
        short: "choose the vault folder (your markdown notes)",
        long: "Folder picker for the vault, saved in the state database. The running\n\
               server keeps its current vault until it restarts (/restart); the app's\n\
               Settings switch it at once." },
    Cmd { name: "/backup", args: "", group: "Data and backups",
        short: "back up the state database now",
        long: "Copies state/memora.db to state/backups/memora-<time>.db while the\n\
               server keeps running. The copy is checked for damage and readable only\n\
               by the server user. The newest 10 are kept. To restore a copy: stop\n\
               the server, then run `memora-cli db restore <file>`." },
    Cmd { name: "/db", args: "[check|vacuum|backup]", group: "Data and backups",
        short: "check the database for damage, compact or back it up",
        long: "/db check   looks for damage, wrong file owners or permissions, size and\n\
               \x20           the age of the last backup; ✗ marks a problem, ! a warning.\n\
               /db vacuum  drops old log rows and compacts the file.\n\
               /db backup  same as /backup.\n\
               All of these are safe while the server runs. Restoring needs the server\n\
               stopped (see `memora-cli db help`)." },
    Cmd { name: "/config", args: "", group: "Server settings",
        short: "server settings (port, domain, base URL...)",
        long: "Server settings are stored in the state database and override the\n\
               server's environment. After a change, /config offers /restart so the\n\
               server loads the new values. Secrets are never stored: \"create a\n\
               default API key\" makes a key and shows it once (it then lives in\n\
               /keys); the owner password is set with /setup or /reset." },
    Cmd { name: "/start", args: "", group: "Run the server",
        short: "start the server",
        long: "Systemd service: systemctl start (needs root, sudo memora-cli).\n\
               npm, release zip, Windows or source: runs memora in the background\n\
               with this console's settings; log in state/memora.log, pid in\n\
               state/memora.pid. Refused when a server already answers on the port.\n\
               Docker: prints the host command (docker start memora).\n\
               Same as `memora-cli start`." },
    Cmd { name: "/shutdown", args: "[force]", group: "Run the server",
        short: "stop the server (also /stop)",
        long: "Systemd service: systemctl stop (needs root).\n\
               Started with /start: asks it to stop and waits up to 10 seconds;\n\
               if it is still running it asks before ending it (/shutdown force\n\
               ends it without asking). A server started by hand in a terminal is\n\
               stopped with Ctrl+C there. Docker: prints docker stop memora.\n\
               Same as `memora-cli stop [--force]`." },
    Cmd { name: "/restart", args: "", group: "Run the server",
        short: "stop, then start; loads changed settings",
        long: "Restarts the systemd unit running memora (needs root), or stops and\n\
               starts the server that /start launched. In Docker it prints the\n\
               command to run on the host. Same as `memora-cli restart`." },
    Cmd { name: "/uninstall", args: "", group: "Run the server",
        short: "remove Memora; settings and notes stay unless picked",
        long: "Explains what goes for this install, then asks what else to delete:\n\
               settings and accounts (the state folder) and the vault notes, both\n\
               unticked, so by default only the program goes. Deleting the state\n\
               writes a final database backup first; deleting the vault asks you to\n\
               type its folder name. Native installs run install.sh --uninstall;\n\
               npm installs end with npm uninstall -g @codrihub/memora; in Docker\n\
               it prints the host commands. Same as `memora-cli uninstall`." },
    Cmd { name: "/update", args: "", group: "Updates",
        short: "check for a newer release and upgrade this install",
        long: "Checks GitHub Releases. On a native install it shows what is new, asks,\n\
               then runs the installer: download, checksum, atomic swap, server\n\
               restart. Your data stays. In Docker it prints the docker compose\n\
               commands instead. Needs root to upgrade (sudo memora-cli)." },
    Cmd { name: "/clear", args: "", group: "Console",
        short: "clear this terminal screen", long: "" },
    Cmd { name: "/help", args: "[command]", group: "Console",
        short: "this list; /help <command> explains one", long: "" },
    Cmd { name: "/quit", args: "", group: "Console",
        short: "leave the console (also /exit or Ctrl-D)", long: "" },
];

/// `/help` lists every command; `/help <command>` explains one.
pub(super) fn help(topic: Option<&str>) {
    if let Some(t) = topic {
        let mut want = if t.starts_with('/') {
            t.to_string()
        } else {
            format!("/{t}")
        };
        if want == "/stop" {
            want = "/shutdown".into();
        }
        match COMMANDS.iter().find(|c| c.name == want) {
            Some(c) => {
                println!("{} {}", style(c.name).cyan().bold(), style(c.args).cyan());
                println!("  {}", c.short);
                for l in c.long.lines() {
                    println!("  {}", style(l).dim());
                }
            }
            None => println!("No command {want}. Type /help for the list."),
        }
        return;
    }
    let mut group = "";
    for c in COMMANDS {
        if c.group != group {
            group = c.group;
            println!();
            println!("{}", style(group).bold());
        }
        let left = format!(
            "{}{}{}",
            c.name,
            if c.args.is_empty() { "" } else { " " },
            c.args
        );
        println!("  {}  {}", style(format!("{left:<20}")).cyan(), c.short);
    }
    println!();
    println!("{}", style("Examples").bold());
    for (ex, what) in [
        ("/guide", "what to do next on this instance"),
        ("/docs prompt", "instructions to paste into your agent"),
        ("/web", "get a one-time code, finish in the browser"),
        ("/keys", "create an API key for an agent"),
        ("/logout all", "sign out every device"),
    ] {
        println!(
            "  {}  {}",
            style(format!("{ex:<20}")).cyan(),
            style(what).dim()
        );
    }
    println!();
    println!(
        "{}",
        style("Type / alone to pick a command from a menu.").dim()
    );
    println!(
        "{}",
        style("/help <command> explains one, e.g. /help web.").dim()
    );
}

/// Menu of every command; returns the chosen name.
pub(super) fn pick_command(theme: &ColorfulTheme) -> Result<Option<String>> {
    let items: Vec<String> = COMMANDS
        .iter()
        .map(|c| format!("{:<11} {}", c.name, c.short))
        .collect();
    Ok(Select::with_theme(theme)
        .with_prompt("Pick a command (Esc to cancel)")
        .items(&items)
        .default(0)
        .max_length(12)
        .interact_opt()?
        .map(|i| COMMANDS[i].name.to_string()))
}
