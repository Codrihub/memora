//! Background check for the newest GitHub release, reported through `/api/config`.
//! `MEMORA_UPDATE_CHECK=false` disables it (no network call).

use serde_json::{json, Value};
use std::io::Read;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// The version this binary was built as.
pub const CURRENT: &str = env!("CARGO_PKG_VERSION");

pub const RELEASES_URL: &str = "https://github.com/Codrihub/memora/releases";
const LATEST_API: &str = "https://api.github.com/repos/Codrihub/memora/releases/latest";
const REPO_API: &str = "https://api.github.com/repos/Codrihub/memora";
pub const REPO_URL: &str = "https://github.com/Codrihub/memora";

/// First check this long after start, so it never competes with startup.
const FIRST_CHECK: Duration = Duration::from_secs(30);
/// Refresh interval after a successful check.
const REFRESH: Duration = Duration::from_secs(6 * 3600);
/// Retry interval after a failed check.
const RETRY: Duration = Duration::from_secs(3600);
const TIMEOUT: Duration = Duration::from_secs(8);
const MAX_BYTES: u64 = 256 * 1024;

/// Outcome of the last check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// GitHub answered with this release version (no leading `v`).
    Latest(String),
    /// The repository has no published release yet.
    NoRelease,
    /// The check failed (offline, rate limited, unexpected answer).
    Failed(String),
}

struct Cached {
    outcome: Outcome,
    checked_at: i64,
}

static CACHE: Mutex<Option<Cached>> = Mutex::new(None);
static ATTEMPTS: AtomicU64 = AtomicU64::new(0);
/// GitHub stars of the repository from the last check; -1 = not known.
static STARS: AtomicI64 = AtomicI64::new(-1);

/// `stargazers_count` of a GitHub repository answer.
pub fn star_count(doc: &Value) -> Option<i64> {
    doc.get("stargazers_count")?.as_i64().filter(|n| *n >= 0)
}

/// A GET request to the GitHub API.
fn request(url: &str) -> ureq::Request {
    ureq::AgentBuilder::new()
        .timeout(TIMEOUT)
        .user_agent(concat!("memora/", env!("CARGO_PKG_VERSION")))
        .build()
        .get(url)
        .set("Accept", "application/vnd.github+json")
}

/// The response body, capped at `MAX_BYTES`.
fn read_body(resp: ureq::Response) -> std::io::Result<String> {
    let mut raw = String::new();
    resp.into_reader()
        .take(MAX_BYTES)
        .read_to_string(&mut raw)?;
    Ok(raw)
}

/// One blocking request for the repository's star count (kept when it fails).
fn fetch_stars() {
    let Ok(resp) = request(REPO_API).call() else {
        return;
    };
    let Ok(raw) = read_body(resp) else {
        return;
    };
    if let Some(n) = serde_json::from_str::<Value>(&raw)
        .ok()
        .as_ref()
        .and_then(star_count)
    {
        STARS.store(n, Ordering::Relaxed);
    }
}

/// False when `MEMORA_UPDATE_CHECK` is `false`, `0`, `no` or `off`.
pub fn enabled() -> bool {
    !matches!(
        std::env::var("MEMORA_UPDATE_CHECK")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "false" | "0" | "no" | "off"
    )
}

/// Number of network checks started by this process.
pub fn attempts() -> u64 {
    ATTEMPTS.load(Ordering::Relaxed)
}

/// `(major, minor, patch, is_release)` of a plain semantic version with an
/// optional leading `v`; a pre-release (`-rc.1`) sorts below its release.
/// Anything outside `[0-9A-Za-z.-]` is rejected (the value comes from the network).
pub fn parse(v: &str) -> Option<(u64, u64, u64, bool)> {
    let v = v.trim();
    let v = v.strip_prefix('v').unwrap_or(v);
    if v.is_empty()
        || !v
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'))
    {
        return None;
    }
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) if !p.is_empty() => (c, true),
        Some(_) => return None,
        None => (v, false),
    };
    let mut it = core.split('.').map(|p| {
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
            None
        } else {
            p.parse::<u64>().ok()
        }
    });
    let parsed = (it.next()??, it.next()??, it.next()??, !pre);
    it.next().is_none().then_some(parsed)
}

/// True when `latest` is a newer version than `installed`; false if either is invalid.
pub fn newer(latest: &str, installed: &str) -> bool {
    match (parse(latest), parse(installed)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

/// The release version in a `releases/latest` answer (`tag_name` without the `v`).
pub fn tag_version(doc: &Value) -> Option<String> {
    let tag = doc.get("tag_name")?.as_str()?.trim();
    parse(tag)?;
    Some(tag.strip_prefix('v').unwrap_or(tag).to_string())
}

/// One blocking request to GitHub.
fn fetch() -> Outcome {
    ATTEMPTS.fetch_add(1, Ordering::Relaxed);
    let resp = match request(LATEST_API).call() {
        Ok(r) => r,
        Err(ureq::Error::Status(404, _)) => return Outcome::NoRelease,
        Err(ureq::Error::Status(code, _)) => {
            return Outcome::Failed(format!("GitHub answered HTTP {code}"))
        }
        Err(e) => return Outcome::Failed(format!("cannot reach GitHub: {e}")),
    };
    let raw = match read_body(resp) {
        Ok(raw) => raw,
        Err(e) => return Outcome::Failed(format!("cannot read the answer: {e}")),
    };
    match serde_json::from_str::<Value>(&raw)
        .ok()
        .as_ref()
        .and_then(tag_version)
    {
        Some(v) => Outcome::Latest(v),
        None => Outcome::Failed("unexpected answer from GitHub".into()),
    }
}

fn store(outcome: Outcome) {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    *c = Some(Cached {
        outcome,
        checked_at: memora_state::now(),
    });
}

/// Start the background check (first run shortly after start, then every 6 h,
/// hourly after a failure). Does nothing when the check is disabled.
pub fn spawn() {
    if !enabled() {
        tracing::info!("release check disabled (MEMORA_UPDATE_CHECK)");
        return;
    }
    tokio::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            let outcome = tokio::task::spawn_blocking(|| {
                let o = fetch();
                fetch_stars();
                o
            })
            .await
            .unwrap_or_else(|e| Outcome::Failed(e.to_string()));
            let wait = match &outcome {
                Outcome::Failed(why) => {
                    tracing::warn!("release check failed: {why}");
                    RETRY
                }
                Outcome::Latest(v) if newer(v, CURRENT) => {
                    tracing::info!(current = CURRENT, latest = %v, "a newer Memora release is available");
                    REFRESH
                }
                _ => REFRESH,
            };
            store(outcome);
            tokio::time::sleep(wait).await;
        }
    });
}

/// `{current, latest, available, url, checked_at, state, repo, stars}` for the UI;
/// `state` is `ok`, `none`, `error`, `disabled` or `pending`.
pub fn status() -> Value {
    if !enabled() {
        return report(None, None, "disabled");
    }
    let c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    match c.as_ref() {
        None => report(None, None, "pending"),
        Some(Cached {
            outcome,
            checked_at,
        }) => match outcome {
            Outcome::Latest(v) => report(Some(v), Some(*checked_at), "ok"),
            Outcome::NoRelease => report(None, Some(*checked_at), "none"),
            Outcome::Failed(_) => report(None, Some(*checked_at), "error"),
        },
    }
}

fn report(latest: Option<&str>, checked_at: Option<i64>, state: &str) -> Value {
    let available = latest.is_some_and(|v| newer(v, CURRENT));
    let url = match latest {
        Some(v) if available => format!("{RELEASES_URL}/tag/v{v}"),
        _ => RELEASES_URL.to_string(),
    };
    let stars = STARS.load(Ordering::Relaxed);
    json!({
        "current": CURRENT,
        "latest": latest,
        "available": available,
        "url": url,
        "checked_at": checked_at,
        "state": state,
        "repo": REPO_URL,
        "stars": (stars >= 0).then_some(stars),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn star_count_reads_the_repository_answer() {
        assert_eq!(star_count(&json!({"stargazers_count": 128})), Some(128));
        assert_eq!(star_count(&json!({"stargazers_count": -1})), None);
        assert_eq!(star_count(&json!({"name": "memora"})), None);
    }

    #[test]
    fn parses_strict_versions() {
        assert_eq!(parse("1.2.3"), Some((1, 2, 3, true)));
        assert_eq!(parse("v1.2.3"), Some((1, 2, 3, true)));
        assert_eq!(parse(" v0.10.0 "), Some((0, 10, 0, true)));
        assert_eq!(parse("1.0.0-rc.1"), Some((1, 0, 0, false)));
        for bad in [
            "",
            "v",
            "1.2",
            "1.2.3.4",
            "1..3",
            "1.2.x",
            "+1.2.3",
            "1.2.3-",
            "vv1.2.3",
            "1.2.3 x",
            "9.9.9-$(id)",
            "1.2.3/../x",
        ] {
            assert_eq!(parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn compares_versions() {
        assert!(newer("1.0.1", "1.0.0"));
        assert!(newer("1.1.0", "1.0.9"));
        assert!(newer("2.0.0", "1.99.99"));
        assert!(newer("v1.10.0", "1.9.0"));
        assert!(newer("1.0.0", "1.0.0-rc.1"));
        assert!(!newer("1.0.0-rc.1", "1.0.0"));
        assert!(!newer("1.0.0", "1.0.0"));
        assert!(!newer("v1.0.0", "1.0.0"));
        assert!(!newer("0.9.9", "1.0.0"));
        assert!(!newer("garbage", "1.0.0"));
        assert!(!newer("1.0.1", "garbage"));
    }

    #[test]
    fn reads_tag_name() {
        assert_eq!(
            tag_version(&json!({"tag_name": "v1.2.0", "draft": false})),
            Some("1.2.0".into())
        );
        assert_eq!(
            tag_version(&json!({"tag_name": "1.2.0"})),
            Some("1.2.0".into())
        );
        assert_eq!(tag_version(&json!({"tag_name": "latest"})), None);
        assert_eq!(tag_version(&json!({"tag_name": 5})), None);
        assert_eq!(tag_version(&json!({})), None);
    }

    #[test]
    fn report_shape() {
        let r = report(Some("999.0.0"), Some(10), "ok");
        assert_eq!(r["available"], true);
        assert_eq!(r["url"], format!("{RELEASES_URL}/tag/v999.0.0"));
        assert_eq!(r["current"], CURRENT);
        let r = report(Some(CURRENT), Some(10), "ok");
        assert_eq!(r["available"], false);
        assert_eq!(r["url"], RELEASES_URL);
        let r = report(None, None, "disabled");
        assert_eq!(r["latest"], Value::Null);
        assert_eq!(r["available"], false);
    }
}
