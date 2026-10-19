//! Shutting the server down from the signed-in browser (Settings).
//!
//! `POST /api/server/shutdown` answers first, then asks the server to stop
//! gracefully, the same way Ctrl-C or SIGTERM does, so it exits with status 0.
//! A supervisor that restarts a cleanly exited process (systemd `Restart=always`,
//! Docker `--restart unless-stopped`) starts it again; `GET` tells the browser
//! so the confirmation can say how to stop it for good.
//!
//! `POST /_stop` is the same graceful stop for `memora-cli stop` on this
//! machine. Windows has no SIGTERM, and `taskkill` without `/F` cannot close a
//! server started without a console, so the CLI asks over HTTP first. Only a
//! loopback caller that is not behind a proxy and sends the token from
//! `<state>/stop.token` (written at startup, readable by the server user only)
//! is accepted.

use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use serde_json::{json, Value};
use tokio::sync::Notify;

use crate::api::{client_ip, csrf_fail, csrf_ok};
use crate::{ApiKeyCaller, AppState};

/// File in the state dir holding the token `POST /_stop` requires.
pub const STOP_TOKEN_FILE: &str = "stop.token";
/// Request header carrying that token.
pub const STOP_TOKEN_HEADER: &str = "x-memora-stop-token";

fn stop_token() -> &'static Mutex<Option<String>> {
    static T: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    T.get_or_init(|| Mutex::new(None))
}

/// Accept `token` on `POST /_stop` from now on (`None`: refuse every request).
pub fn set_stop_token(token: Option<String>) {
    *stop_token().lock().unwrap_or_else(|e| e.into_inner()) = token;
}

/// Create a fresh token, write it to `<state>/stop.token` (mode 0600) and
/// accept it on `POST /_stop`. Called once the port is bound, so a second
/// server that fails to start never replaces the running one's token.
pub fn publish_stop_token(state_dir: &Path) -> std::io::Result<()> {
    use std::io::Write;
    let token = memora_gateway::random_token("stop");
    let path = state_dir.join(STOP_TOKEN_FILE);
    let _ = std::fs::remove_file(&path);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(&path)?.write_all(token.as_bytes())?;
    set_stop_token(Some(token));
    Ok(())
}

/// Forget the token and remove `<state>/stop.token` (on exit).
pub fn withdraw_stop_token(state_dir: &Path) {
    set_stop_token(None);
    let _ = std::fs::remove_file(state_dir.join(STOP_TOKEN_FILE));
}

fn notify() -> &'static Notify {
    static N: OnceLock<Notify> = OnceLock::new();
    N.get_or_init(Notify::new)
}

/// Ask the running server to stop gracefully.
pub fn request() {
    notify().notify_one();
}

/// Resolves once [`request`] was called (it keeps the request if nobody waits yet).
pub async fn requested() {
    notify().notified().await;
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/server/shutdown", get(h_info).post(h_shutdown))
        .route("/_stop", post(h_stop))
}

/// `POST /_stop`: graceful stop for `memora-cli stop` on this machine (see the
/// module docs). Refused with 403 unless the caller is loopback, not
/// forwarded by a proxy, and sends the current stop token.
async fn h_stop(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let resolved = crate::guard::header_ip(&headers).unwrap_or(peer.ip());
    let forwarded = [
        "forwarded",
        "x-forwarded-for",
        "x-real-ip",
        "cf-connecting-ip",
    ]
    .iter()
    .any(|h| headers.contains_key(*h));
    let sent = headers
        .get(STOP_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token_ok = stop_token()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_deref()
        .is_some_and(|t| {
            !sent.is_empty() && memora_state::constant_time_eq(t.as_bytes(), sent.as_bytes())
        });
    if !crate::ip_is_loopback(peer.ip())
        || !crate::ip_is_loopback(resolved)
        || forwarded
        || !token_ok
    {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "forbidden"}))).into_response();
    }
    memora_state::activity::log_activity(
        &st.db,
        "server_shutdown",
        Some(&peer.ip().to_string()),
        None,
        "from memora-cli",
    );
    tracing::warn!("shutdown requested by memora-cli");
    tokio::spawn(async {
        tokio::time::sleep(Duration::from_millis(200)).await;
        request();
    });
    Json(json!({"ok": true})).into_response()
}

fn browser_only() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({"error": "the server is shut down from the signed-in browser or memora-cli"})),
    )
        .into_response()
}

async fn h_info(key: Option<Extension<ApiKeyCaller>>) -> Response {
    if key.is_some() {
        return browser_only();
    }
    Json(supervisor()).into_response()
}

async fn h_shutdown(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
) -> Response {
    if key.is_some() {
        return browser_only();
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let user = crate::cache::session_of(&st, &headers).map(|s| s.user);
    let ip = client_ip(&headers);
    memora_state::activity::log_activity(
        &st.db,
        "server_shutdown",
        ip.as_deref(),
        user.as_deref(),
        "from the browser",
    );
    tracing::warn!(user = ?user, "shutdown requested from the browser");
    // Answer first: the request is stopped by the graceful shutdown otherwise.
    tokio::spawn(async {
        tokio::time::sleep(Duration::from_millis(400)).await;
        request();
    });
    let mut v = supervisor();
    v["ok"] = json!(true);
    Json(v).into_response()
}

/// What happens after a clean exit: `{"restarts": null}` when the server stays
/// down, `"systemd"` (with `unit`) or `"docker"` when it is started again.
fn supervisor() -> Value {
    if std::path::Path::new("/.dockerenv").exists() {
        return json!({"restarts": "docker", "stop": "docker stop memora"});
    }
    if std::env::var_os("INVOCATION_ID").is_some() {
        if let Some(unit) = std::fs::read_to_string("/proc/self/cgroup")
            .ok()
            .and_then(|c| unit_from_cgroup(&c))
        {
            let policy = std::process::Command::new("systemctl")
                .args(["show", "-p", "Restart", "--value", &unit])
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            if restarts_after_clean_exit(&policy) {
                return json!({
                    "restarts": "systemd",
                    "unit": unit,
                    "stop": format!("sudo systemctl stop {unit}"),
                });
            }
        }
    }
    json!({"restarts": null})
}

/// The service unit in a `/proc/self/cgroup` listing (`0::/system.slice/memora.service`).
fn unit_from_cgroup(cgroup: &str) -> Option<String> {
    cgroup
        .lines()
        .filter_map(|l| l.rsplit('/').next())
        .find(|u| u.ends_with(".service"))
        .filter(|u| {
            u.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.@:".contains(c))
        })
        .map(str::to_string)
}

/// systemd `Restart=` values that start the unit again after exit status 0.
fn restarts_after_clean_exit(policy: &str) -> bool {
    matches!(policy, "always" | "on-success")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_is_read_from_the_cgroup() {
        assert_eq!(
            unit_from_cgroup("0::/system.slice/codrihub-memory.service\n").as_deref(),
            Some("codrihub-memory.service")
        );
        assert_eq!(
            unit_from_cgroup("0::/user.slice/user-1000.slice/session-2.scope\n"),
            None
        );
        assert_eq!(
            unit_from_cgroup("0::/system.slice/a;rm -rf.service\n"),
            None
        );
    }

    #[test]
    fn only_always_and_on_success_restart_a_clean_exit() {
        assert!(restarts_after_clean_exit("always"));
        assert!(restarts_after_clean_exit("on-success"));
        assert!(!restarts_after_clean_exit("on-failure"));
        assert!(!restarts_after_clean_exit("no"));
        assert!(!restarts_after_clean_exit(""));
    }
}
