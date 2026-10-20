//! How this copy of Memora was installed ([`Origin`]), shared by `update`,
//! `uninstall`, `start` / `stop` / `restart` and the console.
//!
//! The answer comes from, in order:
//! 1. `MEMORA_INSTALL` (`npm`, `docker`, `native`, `zip`, `source`). The npm
//!    launcher sets `npm` for both binaries and the Docker image sets
//!    `docker`, so these installs never depend on path guessing;
//! 2. `/.dockerenv`;
//! 3. the binary's path (`node_modules/@codrihub/memora-<platform>/bin`) or
//!    the npm platform package's `package.json` next to it;
//! 4. a `cargo build` output folder (`target/release`, `target/debug`) inside
//!    a checkout;
//! 5. install.sh's saved copy (the native installer);
//! 6. anything else: a plain folder of program files (an older release zip,
//!    or copied by hand).

use std::path::{Path, PathBuf};

/// The environment variable that names the install method.
pub(crate) const ENV: &str = "MEMORA_INSTALL";
/// The npm package.
pub(crate) const NPM_PACKAGE: &str = "@codrihub/memora";

/// Where the program files came from.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Origin {
    /// The `@codrihub/memora` npm package.
    Npm,
    /// A Docker image.
    Docker,
    /// The native installer (install.sh, a systemd service).
    Native,
    /// A plain folder of program files: an older release zip or a manual copy.
    #[default]
    Folder,
    /// Built from a source checkout with cargo.
    Source,
}

/// What the machine says; the input of [`origin`].
#[derive(Debug, Default, Clone)]
pub(crate) struct Facts {
    /// The value of `MEMORA_INSTALL`.
    pub declared: Option<String>,
    /// `/.dockerenv` exists.
    pub in_docker: bool,
    /// This binary belongs to the npm platform package.
    pub npm: bool,
    /// This binary is a cargo build output inside a checkout.
    pub source: bool,
    /// install.sh's saved copy.
    pub installer: Option<PathBuf>,
}

/// `MEMORA_INSTALL` as an [`Origin`]; unknown values are ignored.
pub(crate) fn parse_declared(v: &str) -> Option<Origin> {
    match v.trim().to_ascii_lowercase().as_str() {
        "npm" => Some(Origin::Npm),
        "docker" | "container" => Some(Origin::Docker),
        "native" | "installer" | "install.sh" | "systemd" => Some(Origin::Native),
        "zip" | "release" | "folder" | "manual" => Some(Origin::Folder),
        "source" | "cargo" => Some(Origin::Source),
        _ => None,
    }
}

/// The install method, from [`Facts`] (see the module docs for the order).
pub(crate) fn origin(f: &Facts) -> Origin {
    if let Some(o) = f.declared.as_deref().and_then(parse_declared) {
        return o;
    }
    if f.in_docker {
        Origin::Docker
    } else if f.npm {
        Origin::Npm
    } else if f.source {
        Origin::Source
    } else if f.installer.is_some() {
        Origin::Native
    } else {
        Origin::Folder
    }
}

/// `path` with `/` separators and lower case, for the path checks (Windows
/// paths use backslashes and are case-insensitive).
fn norm(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// True for a binary inside the npm platform package
/// (`node_modules/@codrihub/memora-<platform>/bin/memora-cli[.exe]`).
pub(crate) fn npm_path(exe: &Path) -> bool {
    norm(exe).contains("/node_modules/@codrihub/memora")
}

/// True when `text` is the `package.json` of a Memora npm package.
pub(crate) fn npm_manifest(text: &str) -> bool {
    text.lines().any(|l| {
        let l = l.trim();
        l.starts_with("\"name\"") && l.contains("\"@codrihub/memora")
    })
}

/// The cargo checkout a build output lives in: the folder above `target` in
/// `<checkout>/target/[<triple>/]{release,debug}/<binary>`.
pub(crate) fn source_checkout(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;
    let profile = dir.file_name()?.to_string_lossy().to_lowercase();
    if profile != "release" && profile != "debug" {
        return None;
    }
    dir.ancestors()
        .skip(1)
        .take(2)
        .find(|a| {
            a.file_name()
                .is_some_and(|n| n.eq_ignore_ascii_case("target"))
        })
        .and_then(Path::parent)
        .map(Path::to_path_buf)
}

/// This binary's path, as given and canonicalized (either one may be the one
/// that shows the npm folder: a junction or 8.3 short name hides it in one).
fn exe_paths() -> Vec<PathBuf> {
    let Ok(exe) = std::env::current_exe() else {
        return Vec::new();
    };
    let mut v = vec![exe.clone()];
    if let Ok(c) = exe.canonicalize() {
        if c != exe {
            v.push(c);
        }
    }
    v
}

/// Probe this machine for [`origin`].
pub(crate) fn facts() -> Facts {
    let exes = exe_paths();
    let npm = exes.iter().any(|e| {
        npm_path(e)
            || e.parent()
                .and_then(Path::parent)
                .and_then(|pkg| std::fs::read_to_string(pkg.join("package.json")).ok())
                .is_some_and(|t| npm_manifest(&t))
    });
    let source = exes
        .iter()
        .filter_map(|e| source_checkout(e))
        .any(|c| c.join("Cargo.toml").is_file());
    Facts {
        declared: std::env::var(ENV).ok().filter(|v| !v.trim().is_empty()),
        in_docker: Path::new("/.dockerenv").exists(),
        npm,
        source,
        installer: crate::update::installer(),
    }
}

/// The install method of this copy.
pub(crate) fn detect() -> Origin {
    origin(&facts())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declared_value_wins() {
        let f = Facts {
            declared: Some("npm".into()),
            in_docker: true,
            source: true,
            installer: Some("/usr/local/share/memora/install.sh".into()),
            ..Facts::default()
        };
        assert_eq!(origin(&f), Origin::Npm);
        for (v, want) in [
            ("NPM ", Origin::Npm),
            ("docker", Origin::Docker),
            ("native", Origin::Native),
            ("zip", Origin::Folder),
            ("source", Origin::Source),
        ] {
            assert_eq!(parse_declared(v), Some(want), "{v}");
        }
        // an unknown value falls through to the checks
        let f = Facts {
            declared: Some("brew".into()),
            in_docker: true,
            ..Facts::default()
        };
        assert_eq!(origin(&f), Origin::Docker);
    }

    #[test]
    fn checks_in_order() {
        let installer = Some(PathBuf::from("/usr/local/share/memora/install.sh"));
        let mut f = Facts {
            in_docker: true,
            npm: true,
            source: true,
            installer: installer.clone(),
            ..Facts::default()
        };
        assert_eq!(origin(&f), Origin::Docker);
        f.in_docker = false;
        assert_eq!(origin(&f), Origin::Npm);
        f.npm = false;
        // a cargo build on a machine that also has the native install
        assert_eq!(origin(&f), Origin::Source);
        f.source = false;
        assert_eq!(origin(&f), Origin::Native);
        f.installer = None;
        assert_eq!(origin(&f), Origin::Folder);
    }

    #[test]
    fn npm_paths() {
        assert!(npm_path(Path::new(
            r"C:\Users\Budi\AppData\Roaming\npm\node_modules\@codrihub\memora-win32-x64\bin\memora-cli.exe"
        )));
        assert!(npm_path(Path::new(
            r"\\?\C:\Users\Budi\AppData\Roaming\npm\NODE_MODULES\@Codrihub\memora\node_modules\@codrihub\memora-win32-x64\bin\memora-cli.exe"
        )));
        assert!(npm_path(Path::new(
            "/usr/lib/node_modules/@codrihub/memora-linux-x64/bin/memora-cli"
        )));
        assert!(!npm_path(Path::new("/usr/local/bin/memora-cli")));
        assert!(!npm_path(Path::new(r"C:\memora\memora-cli.exe")));
        assert!(npm_manifest(
            "{\n  \"name\": \"@codrihub/memora-win32-x64\",\n  \"version\": \"1.3.0\"\n}"
        ));
        assert!(!npm_manifest("{\n  \"name\": \"something-else\"\n}"));
    }

    #[test]
    fn source_paths() {
        assert_eq!(
            source_checkout(Path::new("/home/me/memora/target/release/memora-cli")),
            Some(PathBuf::from("/home/me/memora"))
        );
        assert_eq!(
            source_checkout(Path::new(
                "/home/me/memora/target/x86_64-unknown-linux-musl/debug/memora-cli"
            )),
            Some(PathBuf::from("/home/me/memora"))
        );
        assert_eq!(
            source_checkout(Path::new("/usr/local/bin/memora-cli")),
            None
        );
        assert_eq!(source_checkout(Path::new("/opt/release/memora-cli")), None);
    }
}
