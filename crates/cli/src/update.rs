//! `memora-cli update` and `/update`: check GitHub Releases for a newer
//! version and upgrade a native install through the installer it came with.
//!
//! The installer (`install.sh`) does the real work: download, sha256 check,
//! atomic binary swap and service restart. Other installs (npm, Docker, a
//! release folder, a source build) cannot update themselves, so for them this
//! prints the commands for that install ([`manual_steps`]).

use crate::install::Origin;
use crate::ok;
use console::style;
use dialoguer::theme::ColorfulTheme;
use dialoguer::Confirm;
use std::path::PathBuf;
use std::process::Command;

/// The installer copies itself here so updates (and uninstall) can run it again.
pub(crate) fn installer() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    let prefix = exe.parent()?.parent()?;
    [
        prefix.join("share/memora/install.sh"),
        PathBuf::from("/usr/local/share/memora/install.sh"),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

const NPM_UPDATE: &str = "npm install -g @codrihub/memora@latest";
const INSTALL_SH: &str =
    "curl -fsSL https://raw.githubusercontent.com/Codrihub/memora/main/scripts/install.sh | sudo sh";
const GUIDE: &str = "https://github.com/Codrihub/memora/blob/main/docs/INSTALL.md#update";

/// How to update an install this command cannot upgrade itself, one line per
/// item; `None` for the native installer, which `run` upgrades.
pub(crate) fn manual_steps(origin: Origin) -> Option<Vec<String>> {
    let cmd = |c: &str| format!("  {}", style(c).cyan());
    let lines = match origin {
        Origin::Native => return None,
        Origin::Npm => vec![
            "This copy was installed with npm. Update it with:".into(),
            cmd(NPM_UPDATE),
            "then restart the server so it runs the new version:".into(),
            cmd("memora-cli restart"),
            "(or stop it with Ctrl+C where it runs and start `memora` again).".into(),
            "Your settings and notes stay; the state database is migrated on start.".into(),
        ],
        Origin::Docker => vec![
            "This is a Docker install. Update it from the host:".into(),
            cmd("docker compose pull && docker compose up -d"),
            "or, for a container started with docker run:".into(),
            cmd("docker pull ghcr.io/codrihub/memora:latest"),
            "then remove and re-create the container with the same volumes.".into(),
            "The state database is migrated automatically on start.".into(),
        ],
        Origin::Folder => vec![
            "This copy runs from a plain folder of program files (an older release zip,".into(),
            "or copied by hand), which cannot update itself.".into(),
            "Memora now installs with npm on Windows and Linux (Node.js 22 or newer). To switch:".into(),
            "  1. stop the server: memora-cli stop (or Ctrl+C where it runs)".into(),
            format!("  2. {}", style(format!("npm install -g {}", crate::install::NPM_PACKAGE)).cyan()),
            "  3. start it with the same folders, so settings and notes carry over:".into(),
            cmd("MEMORA_STATE=<your state folder> MEMORA_VAULT=<your vault> memora"),
            "     (PowerShell: $env:MEMORA_STATE = '<your state folder>'; $env:MEMORA_VAULT = '<your vault>'; memora)".into(),
            "  4. delete the old program folder (only the program files, not state or vault).".into(),
            "On a Linux server you can use the native installer instead:".into(),
            cmd(INSTALL_SH),
        ],
        Origin::Source => vec![
            "This copy was built from source. Update the checkout and rebuild:".into(),
            cmd("git pull && cargo build --release"),
            "then restart the server:".into(),
            cmd("memora-cli restart"),
        ],
    };
    let mut lines = lines;
    lines.push(format!("Details: {GUIDE}"));
    Some(lines)
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
    crate::sys::is_root()
}

/// Shared by the subcommand and the console. `confirm` asks before upgrading;
/// `None` means non-interactive (needs `--yes` to upgrade). Returns the exit code.
pub fn run(theme: Option<&ColorfulTheme>, yes: bool, check_only: bool) -> i32 {
    let current = env!("CARGO_PKG_VERSION");
    println!("Installed: memora {current}");

    let origin = crate::install::detect();
    if let Some(lines) = manual_steps(origin) {
        for l in lines {
            println!("{l}");
        }
        return 0;
    }
    let Some(script) = installer() else {
        println!("This copy is a native install, but install.sh's saved copy is missing.");
        println!("Run the installer again to update it (your data stays):");
        println!("  {}", style(INSTALL_SH).cyan());
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
    fn steps_per_install() {
        console::set_colors_enabled(false);
        let text = |o| manual_steps(o).unwrap().join("\n");
        assert!(manual_steps(Origin::Native).is_none());
        let npm = text(Origin::Npm);
        assert!(npm.contains(NPM_UPDATE) && npm.contains("memora-cli restart"));
        assert!(
            !npm.contains("cargo"),
            "never tell an npm user to cargo build"
        );
        let docker = text(Origin::Docker);
        assert!(docker.contains("docker compose pull") && !docker.contains("cargo"));
        let folder = text(Origin::Folder);
        assert!(folder.contains("npm install -g @codrihub/memora"));
        assert!(folder.contains("MEMORA_STATE") && folder.contains("MEMORA_VAULT"));
        assert!(!folder.contains("cargo"));
        assert!(text(Origin::Source).contains("cargo build --release"));
    }

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
