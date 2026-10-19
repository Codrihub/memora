//! `memora-cli update` and `/update`: check GitHub Releases for a newer
//! version and upgrade a native install through the installer it came with.
//!
//! The installer (`install.sh`) does the real work: download, sha256 check,
//! atomic binary swap and service restart. Docker and npm installs are updated
//! by pulling a new image or package, so for them this only prints the commands.

use crate::ok;
use console::style;
use dialoguer::theme::ColorfulTheme;
use dialoguer::Confirm;
use std::path::PathBuf;
use std::process::Command;

/// The installer copies itself here so updates can run it again.
fn installer() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    let prefix = exe.parent()?.parent()?;
    [
        prefix.join("share/memora/install.sh"),
        PathBuf::from("/usr/local/share/memora/install.sh"),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

/// True when this binary came from the `@codrihub/memora` npm package (it then
/// lives in `node_modules/@codrihub/memora-<platform>/bin`).
fn npm_install() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok())
        .is_some_and(|p| {
            p.to_string_lossy()
                .contains("/node_modules/@codrihub/memora-")
        })
}

/// `(major, minor, patch)` of a plain semantic version; pre-releases sort
/// below their release. Anything but `[0-9A-Za-z.-]` after an optional `v` is
/// rejected, since the version comes from the network and is handed to the installer.
fn parse(v: &str) -> Option<(u64, u64, u64, bool)> {
    let v = v.trim().trim_start_matches('v');
    if v.is_empty()
        || !v
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'))
    {
        return None;
    }
    let (core, pre) = match v.split_once('-') {
        Some((c, _)) => (c, true),
        None => (v, false),
    };
    let mut it = core.split('.').map(|p| p.parse::<u64>().ok());
    let parsed = (it.next()??, it.next()??, it.next()??, !pre);
    it.next().is_none().then_some(parsed)
}

fn newer(latest: &str, installed: &str) -> bool {
    match (parse(latest), parse(installed)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

/// Run `install.sh --check`; returns `(latest, installed)`.
fn check(script: &PathBuf) -> Result<(String, String), String> {
    let out = Command::new("sh")
        .arg(script)
        .arg("--check")
        .output()
        .map_err(|e| format!("could not run the installer: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let field = |k: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(k))
            .map(|v| v.trim().to_string())
            .unwrap_or_else(|| "unknown".into())
    };
    let latest = field("MEMORA_LATEST=");
    let installed = field("MEMORA_INSTALLED=");
    if latest == "unknown" {
        return Err(
            "could not reach GitHub Releases (offline, or no release published yet)".into(),
        );
    }
    if parse(&latest).is_none() {
        return Err(format!(
            "unexpected release version from GitHub: {latest:?}"
        ));
    }
    Ok((latest.trim_start_matches('v').to_string(), installed))
}

fn is_root() -> bool {
    // SAFETY: geteuid has no preconditions.
    unsafe { libc::geteuid() == 0 }
}

/// Shared by the subcommand and the console. `confirm` asks before upgrading;
/// `None` means non-interactive (needs `--yes` to upgrade). Returns the exit code.
pub fn run(theme: Option<&ColorfulTheme>, yes: bool, check_only: bool) -> i32 {
    let current = env!("CARGO_PKG_VERSION");
    println!("Installed: memora {current}");

    if std::path::Path::new("/.dockerenv").exists() {
        println!("This is a Docker install. Update it from the host:");
        println!(
            "  {}",
            style("docker compose pull && docker compose up -d").cyan()
        );
        println!("The state database is migrated automatically on start.");
        return 0;
    }
    if npm_install() {
        println!("This copy was installed with npm. Update it with:");
        println!(
            "  {}",
            style("npm install -g @codrihub/memora@latest").cyan()
        );
        println!("The state database is migrated automatically on start.");
        return 0;
    }
    let Some(script) = installer() else {
        println!(
            "This copy was not installed with install.sh (built from source or copied by hand)."
        );
        println!("Update it the same way it was installed, for example:");
        println!("  {}", style("git pull && cargo build --release").cyan());
        println!("or switch to the installer: https://github.com/Codrihub/memora#install");
        return 0;
    };

    let (latest, installed) = match check(&script) {
        Ok(v) => v,
        Err(e) => {
            println!("{} {e}", style("!").yellow().bold());
            return 4;
        }
    };
    let installed = if installed == "unknown" {
        current.to_string()
    } else {
        installed
    };
    if !newer(&latest, &installed) {
        ok(&format!("Up to date (latest release is {latest})."));
        return 0;
    }
    println!(
        "{} memora {installed} -> {}",
        style("Update available:").bold(),
        style(&latest).green().bold()
    );
    println!("  Release notes: https://github.com/Codrihub/memora/releases/tag/v{latest}");
    if check_only {
        return 0;
    }
    if !is_root() {
        println!(
            "Run it as root to upgrade: {}",
            style("sudo memora-cli update").cyan()
        );
        return 6;
    }
    let go = match theme {
        Some(t) => Confirm::with_theme(t)
            .with_prompt(format!(
                "Upgrade to {latest}? The server restarts; your data stays (take /backup first if unsure)."
            ))
            .default(true)
            .interact_opt()
            .ok()
            .flatten()
            == Some(true),
        None => yes,
    };
    if !go {
        println!("Nothing changed.");
        if theme.is_none() {
            println!("Add --yes to upgrade without a prompt.");
        }
        return 0;
    }

    let status = Command::new("sh")
        .arg(&script)
        .args(["--upgrade", "--yes", "--version", &latest])
        .status();
    match status.map(|s| s.code().unwrap_or(1)) {
        Ok(0) => {
            ok(&format!("Upgraded to {latest}. The server was restarted."));
            if theme.is_some() {
                println!("Leave this console (/quit) and open it again to use the new version.");
            }
            0
        }
        Ok(3) => {
            ok("Already up to date.");
            0
        }
        Ok(code) => {
            let why = match code {
                4 => "download failed",
                5 => "checksum mismatch: the download was NOT installed",
                6 => "needs root",
                7 => "unsupported platform",
                _ => "installer error",
            };
            println!(
                "{} upgrade failed ({why}, exit {code}). The installed version is unchanged.",
                style("error:").red().bold()
            );
            code
        }
        Err(e) => {
            println!(
                "{} could not run the installer: {e}",
                style("error:").red().bold()
            );
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_order() {
        assert!(newer("0.0.2", "0.0.1"));
        assert!(newer("0.1.0", "0.0.9"));
        assert!(newer("v1.0.0", "0.9.9"));
        assert!(newer("0.2.0", "0.2.0-rc.1"));
        assert!(!newer("0.0.1", "0.0.1"));
        assert!(!newer("0.0.1", "0.0.2"));
        assert!(!newer("garbage", "0.0.1"));
        assert!(!newer("1.2.3.4", "0.0.1"));
        assert!(!newer("9.9.9-$(id)", "0.0.1"));
        assert!(!newer("9.9.9 x", "0.0.1"));
    }
}
