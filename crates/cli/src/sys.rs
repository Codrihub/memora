//! The few OS calls the CLI makes, with Windows stand-ins (no root, no uid/gid; modes
//! reported as private).

#[cfg(unix)]
pub(crate) use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

#[cfg(windows)]
pub(crate) use win::{MetadataExt, OpenOptionsExt};

/// Stand-in uid of the current user (and of every file) on Windows.
#[cfg(windows)]
const WIN_UID: u32 = 1000;

/// The effective uid of this process (`geteuid`).
pub(crate) fn euid() -> u32 {
    #[cfg(unix)]
    // SAFETY: geteuid has no preconditions.
    return unsafe { libc::geteuid() };
    #[cfg(windows)]
    WIN_UID
}

/// Whether this process runs as root (never on Windows).
pub(crate) fn is_root() -> bool {
    euid() == 0
}

/// Restrict a folder to its owner (chmod 700); a no-op on Windows, where the
/// user profile ACLs already keep it private.
pub(crate) fn make_private_dir(dir: &std::path::Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
    }
    #[cfg(windows)]
    {
        let _ = dir;
        Ok(())
    }
}

/// Separator of the entries in $PATH.
pub(crate) const PATH_LIST_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// Whether `p` is a file this process can run.
pub(crate) fn is_executable(p: &std::path::Path) -> bool {
    let Ok(m) = std::fs::metadata(p) else {
        return false;
    };
    #[cfg(unix)]
    return m.is_file() && m.mode() & 0o111 != 0;
    #[cfg(windows)]
    m.is_file()
}

/// Replace this process with `cmd` (Unix `exec`). On Windows the command runs
/// as a child and this process exits with its status. Returns only on error.
pub(crate) fn exec(cmd: &mut std::process::Command) -> std::io::Error {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.exec()
    }
    #[cfg(windows)]
    match cmd.status() {
        Ok(s) => std::process::exit(s.code().unwrap_or(1)),
        Err(e) => e,
    }
}

/// Default SIGPIPE handling, so piping into `head` exits quietly (Unix only).
pub(crate) fn default_sigpipe() {
    #[cfg(unix)]
    // SAFETY: restoring the default disposition of SIGPIPE.
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_DFL);
    }
}

#[cfg(windows)]
mod win {
    use super::WIN_UID;

    /// The `uid`/`mode` subset of `std::os::unix::fs::MetadataExt`.
    pub(crate) trait MetadataExt {
        fn uid(&self) -> u32;
        fn mode(&self) -> u32;
    }

    impl MetadataExt for std::fs::Metadata {
        fn uid(&self) -> u32 {
            WIN_UID
        }
        fn mode(&self) -> u32 {
            if self.is_dir() {
                0o40700
            } else if self.permissions().readonly() {
                0o100400
            } else {
                0o100600
            }
        }
    }

    /// `OpenOptionsExt::mode`: accepted and ignored (files inherit the folder ACL).
    pub(crate) trait OpenOptionsExt {
        fn mode(&mut self, mode: u32) -> &mut Self;
    }

    impl OpenOptionsExt for std::fs::OpenOptions {
        fn mode(&mut self, _mode: u32) -> &mut Self {
            self
        }
    }
}
