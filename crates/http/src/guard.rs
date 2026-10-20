//! Front-door protection: caller IP resolution, rate limiting, failure
//! cooldowns and bounded password hashing.
//!
//! Everything here runs in-process, so the instance stays safe when it is
//! exposed directly (no CAPTCHA or WAF in front):
//!   * the caller IP only comes from forwarding headers when the TCP peer is a
//!     trusted proxy (loopback, e.g. cloudflared, or `MEMORA_TRUSTED_PROXIES`),
//!     so spoofed `X-Forwarded-For` cannot buy a fresh bucket per request
//!   * token buckets per IP cap how fast anyone can call the auth endpoints
//!   * failed attempts (password, setup code, API key) put the IP, and after
//!     many failures the owner account, on a cooldown that grows 5 -> 10 -> 15
//!     minutes and is cleared by a successful attempt
//!   * argon2 runs on the blocking pool behind a small semaphore, so a login
//!     flood cannot starve the async runtime that serves agents

use axum::{
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde_json::json;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

/// Header the guard middleware writes with the resolved caller IP. Any copy
/// sent by the client is removed first, so handlers can trust it.
pub const CLIENT_IP_HEADER: &str = "x-memora-client-ip";

/// Failures inside this window count towards a cooldown.
const FAIL_WINDOW: Duration = Duration::from_secs(15 * 60);
/// Failures per IP before a cooldown.
const IP_FAIL_LIMIT: u32 = 5;
/// Failures across all IPs before the owner account itself cools down.
const ACCOUNT_FAIL_LIMIT: u32 = 20;
/// Cooldown per strike: 5, 10, then 15 minutes at most.
const COOLDOWN_STEP: Duration = Duration::from_secs(5 * 60);
const COOLDOWN_MAX_STRIKES: u32 = 3;
/// A clean hour forgets earlier strikes.
const STRIKE_DECAY: Duration = Duration::from_secs(60 * 60);
/// Hard upper bound on tracked keys per map, so a flood of addresses cannot
/// exhaust memory.
const MAX_ENTRIES: usize = 50_000;
/// A full map is swept at most this often; between sweeps, new keys are
/// refused (buckets) or not tracked (failures), so no request pays for an
/// O(n) sweep more than once per interval.
const SWEEP_EVERY: Duration = Duration::from_secs(10);
/// Concurrent argon2 operations.
const HASH_PERMITS: usize = 2;

/// Key for the account-wide failure counter (Memora has a single owner).
pub const ACCOUNT_KEY: &str = "account";

#[derive(Clone, Copy)]
pub enum Bucket {
    /// POST login / setup / reset / code check.
    AuthWrite,
    /// GET /api/auth/state, polled by the login page.
    AuthRead,
    /// Every request from one IP.
    Global,
}

impl Bucket {
    /// (burst capacity, tokens refilled per minute)
    fn rate(self) -> (f64, f64) {
        match self {
            Bucket::AuthWrite => (10.0, 10.0),
            Bucket::AuthRead => (30.0, 60.0),
            Bucket::Global => (300.0, 1200.0),
        }
    }
    fn tag(self) -> &'static str {
        match self {
            Bucket::AuthWrite => "w",
            Bucket::AuthRead => "r",
            Bucket::Global => "g",
        }
    }
}

struct TokenBucket {
    tokens: f64,
    at: Instant,
}

#[derive(Default)]
struct Failures {
    count: u32,
    first: Option<Instant>,
    strikes: u32,
    last_strike: Option<Instant>,
    blocked_until: Option<Instant>,
}

pub struct Guard {
    trusted: Vec<IpAddr>,
    buckets: Mutex<HashMap<String, TokenBucket>>,
    failures: Mutex<HashMap<String, Failures>>,
    hashing: Arc<Semaphore>,
    bucket_sweep: Mutex<Option<Instant>>,
    failure_sweep: Mutex<Option<Instant>>,
}

/// Whether a full map may be swept now (at most once per `SWEEP_EVERY`).
fn sweep_due(last: &Mutex<Option<Instant>>, now: Instant) -> bool {
    let mut l = last.lock().unwrap();
    if l.is_some_and(|t| now.duration_since(t) < SWEEP_EVERY) {
        return false;
    }
    *l = Some(now);
    true
}

impl Guard {
    /// `trusted` is the `MEMORA_TRUSTED_PROXIES` list (comma separated IPs).
    pub fn new(trusted: &str) -> Self {
        Self {
            trusted: trusted
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect(),
            buckets: Mutex::new(HashMap::new()),
            failures: Mutex::new(HashMap::new()),
            hashing: Arc::new(Semaphore::new(HASH_PERMITS)),
            bucket_sweep: Mutex::new(None),
            failure_sweep: Mutex::new(None),
        }
    }

    // -- caller IP ------------------------------------------------------------

    /// Whether the TCP peer is a proxy whose forwarding headers we believe
    /// (loopback, e.g. cloudflared, or `MEMORA_TRUSTED_PROXIES`).
    pub fn trusted_peer(&self, peer: SocketAddr) -> bool {
        let p = peer.ip();
        // An IPv4-mapped IPv6 peer (dual-stack listener) counts as its IPv4 form.
        let p = match p {
            IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(p),
            v4 => v4,
        };
        p.is_loopback() || self.trusted.contains(&p)
    }

    /// The caller IP. Forwarding headers are honoured only from a trusted proxy.
    ///
    /// `X-Forwarded-For` comes first, read from the right past every hop that is
    /// itself a trusted proxy: nginx (`$proxy_add_x_forwarded_for`), Caddy and
    /// Cloudflare all append the address they saw, so that entry cannot be chosen
    /// by the client. `CF-Connecting-IP` and `X-Real-IP` are only a fallback when
    /// there is no such entry: a proxy that does not set them passes a
    /// client-sent value straight through. A header never yields a loopback or
    /// unspecified address, so no outside caller can claim to be local (and skip
    /// the rate limits that local callers skip).
    pub fn client_ip(&self, peer: SocketAddr, headers: &HeaderMap) -> IpAddr {
        let p = peer.ip();
        if !self.trusted_peer(peer) {
            return p;
        }
        let usable = |ip: IpAddr| !is_local_ip(ip);
        let header_ip = |name: &str| {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.trim().parse::<IpAddr>().ok())
                .filter(|ip| usable(*ip))
        };
        let forwarded = headers
            .get_all("x-forwarded-for")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|s| s.split(','))
            .collect::<Vec<_>>();
        let mut from_xff = None;
        for hop in forwarded.iter().rev() {
            let Ok(ip) = hop.trim().parse::<IpAddr>() else {
                break;
            };
            let hop_peer = SocketAddr::new(ip, 0);
            if self.trusted_peer(hop_peer) || !usable(ip) {
                continue;
            }
            from_xff = Some(ip);
            break;
        }
        from_xff
            .or_else(|| header_ip("cf-connecting-ip"))
            .or_else(|| header_ip("x-real-ip"))
            .unwrap_or(p)
    }

    // -- token buckets ----------------------------------------------------------

    /// Take one token; `Err(seconds)` says how long until the next one.
    pub fn take(&self, bucket: Bucket, ip: &IpAddr) -> Result<(), u64> {
        let (cap, per_min) = bucket.rate();
        let per_sec = per_min / 60.0;
        let now = Instant::now();
        let key = format!("{}:{}", bucket.tag(), ip_net(ip));
        let mut map = self.buckets.lock().unwrap();
        if map.len() >= MAX_ENTRIES && !map.contains_key(&key) {
            if sweep_due(&self.bucket_sweep, now) {
                // Drop buckets that have refilled completely; they hold no state.
                map.retain(|k, b| {
                    let (cap, per_min) = rate_for_key(k);
                    b.tokens + now.duration_since(b.at).as_secs_f64() * per_min / 60.0 < cap
                });
            }
            if map.len() >= MAX_ENTRIES {
                // Still full: fail closed for callers we are not tracking yet.
                return Err(SWEEP_EVERY.as_secs());
            }
        }
        let b = map.entry(key).or_insert(TokenBucket {
            tokens: cap,
            at: now,
        });
        b.tokens = (b.tokens + now.duration_since(b.at).as_secs_f64() * per_sec).min(cap);
        b.at = now;
        if b.tokens >= 1.0 {
            b.tokens -= 1.0;
            Ok(())
        } else {
            Err(((1.0 - b.tokens) / per_sec).ceil().max(1.0) as u64)
        }
    }

    // -- failure cooldowns --------------------------------------------------------

    /// Forget every failure, cooldown and rate bucket (`memora-cli` limiter reset,
    /// delivered as a `limiter_reset` control request).
    pub fn reset(&self) {
        self.failures.lock().unwrap().clear();
        self.buckets.lock().unwrap().clear();
    }

    /// Seconds left on a cooldown for `key`, if one is active.
    pub fn cooldown(&self, key: &str) -> Option<u64> {
        let map = self.failures.lock().unwrap();
        let until = map.get(key)?.blocked_until?;
        let now = Instant::now();
        (until > now).then(|| until.duration_since(now).as_secs().max(1))
    }

    /// Longest active cooldown among the IP and the account.
    pub fn blocked(&self, ip: &IpAddr) -> Option<u64> {
        let a = self.cooldown(&ip_key(ip));
        let b = self.cooldown(ACCOUNT_KEY);
        a.max(b)
    }

    /// Record a failed attempt; returns the cooldown it started, if any.
    pub fn fail(&self, key: &str) -> Option<u64> {
        let limit = if key == ACCOUNT_KEY {
            ACCOUNT_FAIL_LIMIT
        } else {
            IP_FAIL_LIMIT
        };
        let now = Instant::now();
        let mut map = self.failures.lock().unwrap();
        if map.len() >= MAX_ENTRIES && !map.contains_key(key) {
            if sweep_due(&self.failure_sweep, now) {
                map.retain(|k, f| {
                    k == ACCOUNT_KEY
                        || f.blocked_until.is_some_and(|u| u > now)
                        || f.first.is_some_and(|t| now.duration_since(t) < FAIL_WINDOW)
                });
            }
            // Still full: do not track this IP (the account counter, which
            // always exists once any failure happened, keeps counting).
            if map.len() >= MAX_ENTRIES && key != ACCOUNT_KEY {
                return None;
            }
        }
        let f = map.entry(key.to_string()).or_default();
        if f.first.is_none_or(|t| now.duration_since(t) > FAIL_WINDOW) {
            f.first = Some(now);
            f.count = 0;
        }
        if f.last_strike
            .is_some_and(|t| now.duration_since(t) > STRIKE_DECAY)
        {
            f.strikes = 0;
        }
        f.count += 1;
        if f.count < limit {
            return None;
        }
        f.strikes = (f.strikes + 1).min(COOLDOWN_MAX_STRIKES);
        f.last_strike = Some(now);
        f.count = 0;
        f.first = None;
        let d = COOLDOWN_STEP * f.strikes;
        f.blocked_until = Some(now + d);
        tracing::warn!(
            key,
            minutes = d.as_secs() / 60,
            "too many failed attempts, cooling down"
        );
        Some(d.as_secs())
    }

    /// Record a failure for both the IP and the account.
    pub fn fail_login(&self, ip: &IpAddr) -> Option<u64> {
        let a = self.fail(&ip_key(ip));
        let b = self.fail(ACCOUNT_KEY);
        a.max(b)
    }

    /// A successful attempt clears the counters and strikes for these keys.
    pub fn succeed(&self, ip: &IpAddr) {
        let mut map = self.failures.lock().unwrap();
        map.remove(&ip_key(ip));
        map.remove(ACCOUNT_KEY);
    }

    // -- argon2 -----------------------------------------------------------------

    /// Verify on the blocking pool. `None` means every hashing slot is busy.
    pub async fn verify_password(&self, pw: String, hash: String) -> Option<bool> {
        let permit = self.hashing.clone().try_acquire_owned().ok()?;
        let ok = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            memora_gateway::verify_password(&pw, &hash)
        })
        .await
        .unwrap_or(false);
        Some(ok)
    }

    /// Hash on the blocking pool, waiting for a slot (setup and reset only).
    pub async fn hash_password(&self, pw: String) -> Option<String> {
        let permit = self.hashing.clone().acquire_owned().await.ok()?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            memora_gateway::hash_password(&pw).ok()
        })
        .await
        .ok()
        .flatten()
    }
}

fn rate_for_key(k: &str) -> (f64, f64) {
    match k.split(':').next() {
        Some("w") => Bucket::AuthWrite.rate(),
        Some("r") => Bucket::AuthRead.rate(),
        _ => Bucket::Global.rate(),
    }
}

/// The unit rate limits and cooldowns apply to: the IPv4 address, or the
/// IPv6 /64 (one host can hold a whole /64 and rotate through it).
/// IPv4-mapped IPv6 addresses count as their IPv4 form.
pub fn ip_net(ip: &IpAddr) -> String {
    match ip {
        IpAddr::V4(v4) => v4.to_string(),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => v4.to_string(),
            None => {
                let s = v6.segments();
                format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
            }
        },
    }
}

pub fn ip_key(ip: &IpAddr) -> String {
    format!("ip:{}", ip_net(ip))
}

/// A fixed argon2id hash used when the username does not exist, so a wrong
/// username costs the same time as a wrong password.
pub fn dummy_hash() -> String {
    static H: OnceLock<String> = OnceLock::new();
    H.get_or_init(|| memora_gateway::hash_password("memora-dummy-password").unwrap_or_default())
        .clone()
}

/// The resolved caller IP written by the guard middleware.
pub fn header_ip(headers: &HeaderMap) -> Option<IpAddr> {
    headers
        .get(CLIENT_IP_HEADER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
}

pub fn set_header_ip(headers: &mut HeaderMap, ip: &IpAddr) {
    headers.remove(CLIENT_IP_HEADER);
    if let Ok(v) = HeaderValue::from_str(&ip.to_string()) {
        headers.insert(CLIENT_IP_HEADER, v);
    }
}

/// `429` with `Retry-After` and a human message the login page can show.
pub fn too_many(retry_after: u64, cooldown: bool) -> Response {
    let mins = retry_after.div_ceil(60);
    let msg = if cooldown {
        format!(
            "Too many failed attempts. Try again in {mins} minute{}.",
            if mins == 1 { "" } else { "s" }
        )
    } else {
        "Too many requests. Slow down and try again shortly.".to_string()
    };
    (
        StatusCode::TOO_MANY_REQUESTS,
        [(header::RETRY_AFTER, retry_after.to_string())],
        Json(json!({
            "error": msg,
            "limited": true,
            "cooldown": cooldown,
            "retry_after": retry_after,
        })),
    )
        .into_response()
}

/// `503` when every hashing slot is taken.
pub fn busy() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [(header::RETRY_AFTER, "2".to_string())],
        Json(json!({"error": "server busy, try again in a moment", "retry_after": 2})),
    )
        .into_response()
}

/// Whether the request carries any proxy forwarding header.
pub fn forwarded(headers: &HeaderMap) -> bool {
    [
        "forwarded",
        "x-forwarded-for",
        "x-real-ip",
        "cf-connecting-ip",
    ]
    .iter()
    .any(|h| headers.contains_key(*h))
}

/// Loopback or unspecified, IPv4-mapped IPv6 included.
fn is_local_ip(ip: IpAddr) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(ip),
        v4 => v4,
    };
    ip.is_loopback() || ip.is_unspecified()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guard() -> Guard {
        Guard::new("10.0.0.9")
    }

    #[test]
    fn forwarded_headers_need_a_trusted_peer() {
        let g = guard();
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", "1.2.3.4".parse().unwrap());
        let outside: SocketAddr = "8.8.8.8:5000".parse().unwrap();
        assert_eq!(g.client_ip(outside, &h).to_string(), "8.8.8.8");
        let local: SocketAddr = "127.0.0.1:5000".parse().unwrap();
        assert_eq!(g.client_ip(local, &h).to_string(), "1.2.3.4");
        let proxy: SocketAddr = "10.0.0.9:5000".parse().unwrap();
        let mut h = HeaderMap::new();
        h.insert("cf-connecting-ip", "5.6.7.8".parse().unwrap());
        assert_eq!(g.client_ip(proxy, &h).to_string(), "5.6.7.8");
    }

    /// Behind a proxy that passes client headers through (nginx and Caddy do
    /// for `CF-Connecting-IP`, Caddy for `X-Real-IP`), an outside caller must
    /// not pick its own address, least of all a loopback one: local callers
    /// skip every rate limit, so that would allow unlimited password guessing.
    #[test]
    fn spoofed_forwarding_headers_cannot_choose_the_caller_ip() {
        let g = guard();
        let local: SocketAddr = "127.0.0.1:5000".parse().unwrap();
        // nginx: client-sent CF-Connecting-IP passes through, XFF gets the
        // real address appended.
        let mut h = HeaderMap::new();
        h.insert("cf-connecting-ip", "127.0.0.1".parse().unwrap());
        h.insert("x-real-ip", "203.0.113.9".parse().unwrap());
        h.insert("x-forwarded-for", "127.0.0.1, 203.0.113.9".parse().unwrap());
        assert_eq!(g.client_ip(local, &h).to_string(), "203.0.113.9");
        // Rotating a fake CF-Connecting-IP does not change the caller either.
        h.insert("cf-connecting-ip", "198.51.100.1".parse().unwrap());
        assert_eq!(g.client_ip(local, &h).to_string(), "203.0.113.9");
        // Proxy hops (loopback, trusted proxies) are skipped from the right.
        let mut h = HeaderMap::new();
        h.insert(
            "x-forwarded-for",
            "203.0.113.9, 10.0.0.9, 127.0.0.1".parse().unwrap(),
        );
        assert_eq!(g.client_ip(local, &h).to_string(), "203.0.113.9");
        // A header alone never makes a caller local.
        for name in ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"] {
            for v in ["127.0.0.1", "::1", "::ffff:127.0.0.1", "0.0.0.0"] {
                let mut h = HeaderMap::new();
                h.insert(name, v.parse().unwrap());
                let proxy: SocketAddr = "10.0.0.9:5000".parse().unwrap();
                assert_eq!(
                    g.client_ip(proxy, &h).to_string(),
                    "10.0.0.9",
                    "{name}: {v}"
                );
            }
        }
        // Without X-Forwarded-For the single-value headers still work.
        let mut h = HeaderMap::new();
        h.insert("x-real-ip", "203.0.113.5".parse().unwrap());
        assert_eq!(g.client_ip(local, &h).to_string(), "203.0.113.5");
    }

    #[test]
    fn untrusted_peer_cannot_spoof_any_forwarding_header() {
        let g = guard();
        let mut h = HeaderMap::new();
        h.insert("cf-connecting-ip", "1.1.1.1".parse().unwrap());
        h.insert("x-real-ip", "2.2.2.2".parse().unwrap());
        h.insert("x-forwarded-for", "3.3.3.3, 4.4.4.4".parse().unwrap());
        let outside: SocketAddr = "203.0.113.7:1234".parse().unwrap();
        assert!(!g.trusted_peer(outside));
        assert_eq!(g.client_ip(outside, &h).to_string(), "203.0.113.7");
        // Right-most X-Forwarded-For entry wins from a trusted proxy.
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", "6.6.6.6, 4.4.4.4".parse().unwrap());
        let local: SocketAddr = "127.0.0.1:1".parse().unwrap();
        assert_eq!(g.client_ip(local, &h).to_string(), "4.4.4.4");
        // IPv4-mapped trusted proxy is still trusted.
        let mapped: SocketAddr = "[::ffff:10.0.0.9]:1".parse().unwrap();
        assert!(g.trusted_peer(mapped));
    }

    #[test]
    fn cooldown_after_five_failures_and_reset_on_success() {
        let g = guard();
        let ip: IpAddr = "8.8.8.8".parse().unwrap();
        for _ in 0..4 {
            assert!(g.fail(&ip_key(&ip)).is_none());
        }
        assert_eq!(g.fail(&ip_key(&ip)), Some(300));
        assert!(g.blocked(&ip).is_some());
        g.succeed(&ip);
        assert!(g.blocked(&ip).is_none());
    }

    #[test]
    fn cooldown_grows_per_strike() {
        let g = guard();
        let key = ip_key(&"9.9.9.9".parse().unwrap());
        let mut last = None;
        for _ in 0..(IP_FAIL_LIMIT * 4) {
            if let Some(d) = g.fail(&key) {
                last = Some(d);
            }
        }
        assert_eq!(last, Some(15 * 60));
    }

    #[test]
    fn ipv6_is_limited_per_64() {
        let g = guard();
        let a: IpAddr = "2001:db8:1:2::1".parse().unwrap();
        let b: IpAddr = "2001:db8:1:2:ffff::9".parse().unwrap();
        assert_eq!(ip_key(&a), ip_key(&b));
        for _ in 0..10 {
            assert!(g.take(Bucket::AuthWrite, &a).is_ok());
        }
        // Rotating within the /64 does not buy a fresh bucket.
        assert!(g.take(Bucket::AuthWrite, &b).is_err());
        let other: IpAddr = "2001:db8:1:3::1".parse().unwrap();
        assert!(g.take(Bucket::AuthWrite, &other).is_ok());
    }

    #[test]
    fn full_maps_are_hard_capped() {
        let g = guard();
        let now = Instant::now();
        {
            let mut m = g.buckets.lock().unwrap();
            for i in 0..MAX_ENTRIES {
                m.insert(
                    format!("w:x{i}"),
                    TokenBucket {
                        tokens: 0.0,
                        at: now,
                    },
                );
            }
        }
        let fresh: IpAddr = "198.51.100.1".parse().unwrap();
        // Nothing refilled, so the sweep frees nothing: a new key is refused
        // and the map does not grow.
        assert!(g.take(Bucket::AuthWrite, &fresh).is_err());
        assert_eq!(g.buckets.lock().unwrap().len(), MAX_ENTRIES);
        {
            let mut f = g.failures.lock().unwrap();
            for i in 0..MAX_ENTRIES {
                f.insert(
                    format!("ip:x{i}"),
                    Failures {
                        first: Some(now),
                        ..Default::default()
                    },
                );
            }
        }
        assert!(g.fail(&ip_key(&fresh)).is_none());
        assert_eq!(g.failures.lock().unwrap().len(), MAX_ENTRIES);
    }

    #[test]
    fn bucket_runs_dry() {
        let g = guard();
        let ip: IpAddr = "7.7.7.7".parse().unwrap();
        for _ in 0..10 {
            assert!(g.take(Bucket::AuthWrite, &ip).is_ok());
        }
        assert!(g.take(Bucket::AuthWrite, &ip).is_err());
    }
}
