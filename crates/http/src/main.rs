//! `memora` - HTTP and MCP server entry point for the Memora memory vault.
//!
//! Env:
//!   MEMORA_VAULT   suggested vault folder only (in Docker: the mounted volume). The
//!                  vault itself is `settings.vault_path` in the state database, chosen
//!                  in the web UI or with memora-cli; until then vault routes answer 409.
//!   MEMORA_STATE   (default state) - holds `memora.db` (docs/DATABASE.md)
//!   MEMORA_PORT    (default 8400)
//!   MEMORA_BIND    (default 127.0.0.1) - single entry point: bind loopback and let the proxy expose it
//!   MEMORA_ARM_TTL (default 300)
//!   MEMORA_TRUSTED_PROXIES (comma separated IPs whose forwarding headers are
//!                  trusted; loopback is always trusted)
//!   MEMORA_BASE_URL, MEMORA_DOMAIN, MEMORA_ADMIN_USER, MEMORA_ADMIN_PASSWORD[_FILE],
//!   MEMORA_API_KEY[_FILE], MEMORA_VAULT_AUTO - see `memora_gateway::EnvConfig`
//!
//! Every setting except the two secrets can also be stored in the database
//! (`memora-cli config`); a stored value wins over the process environment.

use memora_core::MemoryStore;
use memora_http::guard::Guard;
use memora_http::{build_router, cache, init_tracing, AppState};
use memora_state::Db;
use std::path::Path;
use std::sync::{Arc, Mutex};

fn env_or(k: &str, d: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| d.to_string())
}

/// Resolve the UI asset directory: `MEMORA_ASSETS`, then an `assets` folder next
/// to the executable (an unpacked release zip or tarball), then `<crate>/assets`,
/// then `memora/crates/http/assets` relative to the working directory.
fn find_assets(explicit: &str) -> String {
    if !explicit.is_empty() && Path::new(explicit).is_dir() {
        return explicit.to_string();
    }
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join("assets")))
        .filter(|d| d.join("index.html").is_file())
    {
        return dir.to_string_lossy().into_owned();
    }
    let candidates = [
        concat!(env!("CARGO_MANIFEST_DIR"), "/assets"),
        "memora/crates/http/assets",
    ];
    for c in candidates {
        if Path::new(c).is_dir() {
            return c.to_string();
        }
    }
    candidates[0].to_string()
}

/// Startup work done before the async runtime exists (it changes the process
/// environment, which must happen before any other thread runs). Returns the open
/// database and the lines to log once tracing is set up.
fn open_state(state: &Path) -> anyhow::Result<(Db, Vec<String>)> {
    let mut log = Vec::new();
    let db = Db::open(state).map_err(|e| {
        anyhow::anyhow!(
            "cannot open the state database in {} (it must be writable by this user): {e}",
            state.display()
        )
    })?;
    // The catalog first: imported per-key tool lists reference it.
    let sync = memora_mcp::sync_catalog(&db)?;
    if !sync.is_empty() {
        log.push(format!(
            "tool catalog synced: {} added, retired {:?}, revived {:?}",
            sync.added.len(),
            sync.retired,
            sync.revived
        ));
    }
    let report = memora_state::legacy::import_legacy(&db, state)?;
    match report.status {
        memora_state::legacy::ImportStatus::Imported => log.push(format!(
            "legacy JSON state imported: rows {:?}, skipped {:?}, secrets dropped {:?}, archived to {}",
            report.rows,
            report.skipped,
            report.dropped_secrets,
            report
                .archived_to
                .as_deref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "-".into()),
        )),
        status => log.push(format!("legacy JSON import: {status:?}")),
    }
    let applied = db.read(memora_state::config::apply_to_env)?;
    log.push(format!(
        "settings applied from the state database: {applied:?}"
    ));
    for line in provision(&db)? {
        log.push(line);
    }
    Ok((db, log))
}

/// Environment defaults (owner, API key, vault) applied to the database. Never
/// overwrites an existing owner or a configured vault.
fn provision(db: &Db) -> anyhow::Result<Vec<String>> {
    let cfg = memora_gateway::env_config();
    let mut lines = Vec::new();
    let mut input = memora_state::config::Provision::default();
    if let Some(pw) = &cfg.admin_password {
        if let Some(owner) = db.read(memora_state::owner::owner_name)? {
            lines.push(format!(
                "MEMORA_ADMIN_PASSWORD ignored: owner {owner} already exists"
            ));
        } else if pw.chars().count() < 10 {
            lines.push(
                "MEMORA_ADMIN_PASSWORD is shorter than 10 characters; no owner created".into(),
            );
        } else {
            input.owner = Some((cfg.admin_user.clone(), memora_gateway::hash_password(pw)?));
        }
    }
    if let Some(key) = &cfg.api_key {
        if key.len() < 24 {
            lines.push("MEMORA_API_KEY is shorter than 24 characters; ignored".into());
        } else {
            input.api_key = Some(memora_state::config::ProvisionKey {
                hash: memora_gateway::hash_api_key(key),
                prefix: memora_gateway::key_prefix(key),
            });
        }
    }
    if cfg.vault_auto && db.read(memora_state::settings::configured_vault)?.is_none() {
        match db.read(memora_state::settings::suggested_vault)? {
            Some(v) => {
                let p = Path::new(&v);
                let _ = std::fs::create_dir_all(p);
                if memora_gateway::dir_writable(p) {
                    input.vault_auto = Some(v);
                } else {
                    lines.push(format!(
                        "MEMORA_VAULT_AUTO: {v} is not writable; vault left unset"
                    ));
                }
            }
            None => lines.push("MEMORA_VAULT_AUTO is set but MEMORA_VAULT is empty".into()),
        }
    }
    let now = memora_state::now();
    lines.extend(db.write(|tx| memora_state::config::provision(tx, &input, now))?);
    Ok(lines)
}

/// A setting: stored row, else process environment, else the built-in default.
fn setting(db: &Db, key: &str, default: &str) -> String {
    db.read(|c| memora_state::config::effective(c, key))
        .ok()
        .flatten()
        .unwrap_or_else(|| default.to_string())
}

const USAGE: &str = "\
memora - HTTP + MCP server for a Memora markdown vault (web UI, /mcp, /ws on one port)

Usage: memora [--help | --version]

Configured through the environment (most settings can also be stored in the
state database with `memora-cli config`; a stored value wins):
  MEMORA_STATE      state folder holding memora.db (default: ./state)
  MEMORA_VAULT      suggested vault folder (MEMORA_VAULT_AUTO=true to use it)
  MEMORA_PORT       listen port (default 8400)
  MEMORA_BIND       listen address (default 127.0.0.1)
  MEMORA_ASSETS     web UI asset folder
  MEMORA_ADMIN_USER, MEMORA_ADMIN_PASSWORD[_FILE]  owner created at first start
  MEMORA_API_KEY[_FILE]                            API key installed at start
  MEMORA_BASE_URL, MEMORA_DOMAIN, MEMORA_TRUSTED_PROXIES, MEMORA_ARM_TTL, RUST_LOG

Options:
  -h, --help        print this help and exit
  -V, --version     print the version and exit

Operator console (setup codes, keys, sessions, backups): memora-cli
";

/// What the command line asks for. Checked before any state is opened.
#[derive(Debug, PartialEq, Eq)]
enum ArgAction {
    Run,
    Help,
    Version,
    Unknown(String),
}

fn parse_args(args: impl IntoIterator<Item = String>) -> ArgAction {
    let mut action = ArgAction::Run;
    for a in args {
        match a.as_str() {
            "-h" | "--help" | "help" => return ArgAction::Help,
            "-V" | "--version" => action = ArgAction::Version,
            _ => return ArgAction::Unknown(a),
        }
    }
    action
}

fn main() -> anyhow::Result<()> {
    match parse_args(std::env::args().skip(1)) {
        ArgAction::Run => {}
        ArgAction::Help => {
            print!("{USAGE}");
            return Ok(());
        }
        ArgAction::Version => {
            println!("memora {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        ArgAction::Unknown(a) => {
            eprintln!("memora: unknown option: {a}\n");
            eprint!("{USAGE}");
            std::process::exit(2);
        }
    }
    let state = env_or("MEMORA_STATE", "state");
    let (db, startup_log) = open_state(Path::new(&state))?;
    // RUST_LOG may come from the database, so tracing starts after apply_to_env.
    init_tracing();
    for line in &startup_log {
        tracing::info!("{line}");
    }
    tokio::runtime::Runtime::new()?.block_on(serve(state, db))
}

/// Resolves on Ctrl-C, SIGTERM (systemd stop) or a shutdown asked for in the browser.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = term => {},
        _ = memora_http::shutdown::requested() => {},
    }
    tracing::info!("shutting down");
}

async fn serve(state: String, db: Db) -> anyhow::Result<()> {
    let port: u16 = setting(&db, "MEMORA_PORT", "8400").parse().unwrap_or(8400);
    let bind = setting(&db, "MEMORA_BIND", "127.0.0.1");
    let trusted = setting(&db, "MEMORA_TRUSTED_PROXIES", "");
    let domains = memora_gateway::env_config().domains;
    let vault = db.read(memora_state::settings::configured_vault)?;

    // Without a configured vault the store points nowhere; the vault gate keeps
    // every route that would read it closed until a folder is chosen, and the
    // store is then replaced in place (MCP shares this same Arc).
    let store = Arc::new(Mutex::new(MemoryStore::new(vault.as_deref().unwrap_or(""))));

    // Realtime hub: the `.events.jsonl` write point plus the WebSocket fan-out.
    if let Some(v) = &vault {
        memora_core::events::hub().set_events_path(std::path::PathBuf::from(format!(
            "{}/.events.jsonl",
            v.trim_end_matches('/')
        )));
    } else {
        let suggested = db
            .read(memora_state::settings::suggested_vault)
            .ok()
            .flatten();
        tracing::warn!(
            suggested = %suggested.unwrap_or_default(),
            "no vault configured: choose one in the web UI (Settings) or with memora-cli vault"
        );
    }

    let assets = find_assets(&env_or("MEMORA_ASSETS", ""));
    let app_state = AppState::new(db, store, assets.clone(), Guard::new(&trusted), domains)?;
    tracing::info!(
        vault = %vault.as_deref().unwrap_or("(not configured)"), state = %state, port, bind, assets = %assets,
        keys = cache::rd(&app_state.cache.keys).len(),
        owner = cache::rd(&app_state.cache.owner).is_some(),
        rules = cache::rd(&app_state.cache.access).rules.len(),
        "Memora HTTP server starting"
    );
    cache::spawn_background(&app_state);
    memora_http::release::spawn();

    let router = build_router(app_state.clone());
    let addr = format!("{bind}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("listening on http://{addr}");
    let state_dir = std::path::PathBuf::from(&state);
    if let Err(e) = memora_http::shutdown::publish_stop_token(&state_dir) {
        tracing::warn!("cannot write the stop token for memora-cli stop: {e}");
    }
    let served = axum::serve(
        listener,
        router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await;
    memora_http::shutdown::withdraw_stop_token(&state_dir);
    served?;
    // Buffered key usage and session activity are written before exit.
    let st = app_state.clone();
    let _ = tokio::task::spawn_blocking(move || cache::flush_all(&st)).await;
    Ok(())
}

#[cfg(test)]
mod args_tests {
    use super::{parse_args, ArgAction};

    fn p(a: &[&str]) -> ArgAction {
        parse_args(a.iter().map(|s| s.to_string()))
    }

    #[test]
    fn help_version_and_unknown_are_handled_before_start() {
        assert_eq!(p(&[]), ArgAction::Run);
        assert_eq!(p(&["--help"]), ArgAction::Help);
        assert_eq!(p(&["-h"]), ArgAction::Help);
        assert_eq!(p(&["--version"]), ArgAction::Version);
        assert_eq!(p(&["-V"]), ArgAction::Version);
        assert_eq!(p(&["--port"]), ArgAction::Unknown("--port".into()));
        assert_eq!(p(&["serve"]), ArgAction::Unknown("serve".into()));
        assert_eq!(p(&["-V", "--bogus"]), ArgAction::Unknown("--bogus".into()));
        assert_eq!(
            p(&["--bogus", "--help"]),
            ArgAction::Unknown("--bogus".into())
        );
    }
}
