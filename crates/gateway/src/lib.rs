//! Gateway: stateless auth primitives and access rules (hashing, key generation, access
//! stack, per-key permissions, environment config). Persistent state is in `memora-state`.

use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use rand_core::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::net::IpAddr;
use std::path::Path;

pub type Result<T> = anyhow::Result<T>;

// ---------------------------------------------------------------------------
// Password hashing (argon2id)
// ---------------------------------------------------------------------------

pub fn hash_password(pw: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("hashing failed: {e}"))?
        .to_string())
}

/// Verify a password against an argon2id hash.
pub fn verify_password(pw: &str, stored: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(stored) else {
        return false;
    };
    Argon2::default()
        .verify_password(pw.as_bytes(), &parsed)
        .is_ok()
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/// Key shape: `memora_live_<32 hex>` - 128 random bits from the CSPRNG.
pub fn generate_key() -> String {
    let mut buf = [0u8; 16];
    OsRng.fill_bytes(&mut buf);
    let hex: String = buf.iter().map(|b| format!("{b:02x}")).collect();
    format!("memora_live_{hex}")
}

/// An opaque secret `<prefix>_<64 hex>` (256 random bits): OAuth codes and
/// refresh tokens. Store only its [`hash_api_key`].
pub fn random_token(prefix: &str) -> String {
    let mut buf = [0u8; 32];
    OsRng.fill_bytes(&mut buf);
    let hex: String = buf.iter().map(|b| format!("{b:02x}")).collect();
    format!("{prefix}_{hex}")
}

/// Unpadded base64url (RFC 4648 section 5), as PKCE and JOSE use it.
pub fn base64url(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        out.push(A[(n >> 18) as usize & 63] as char);
        out.push(A[(n >> 12) as usize & 63] as char);
        if c.len() > 1 {
            out.push(A[(n >> 6) as usize & 63] as char);
        }
        if c.len() > 2 {
            out.push(A[n as usize & 63] as char);
        }
    }
    out
}

/// PKCE `S256` (RFC 7636): does `verifier` hash to `challenge`? Verifiers must be
/// 43-128 unreserved characters.
pub fn pkce_s256_matches(verifier: &str, challenge: &str) -> bool {
    use sha2::{Digest, Sha256};
    let ok_len = (43..=128).contains(&verifier.len());
    let ok_chars = verifier
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~'));
    if !ok_len || !ok_chars {
        return false;
    }
    let digest = Sha256::digest(verifier.as_bytes());
    let got = base64url(&digest);
    // Constant time over the (fixed 43-char) encoding.
    got.len() == challenge.len()
        && got
            .bytes()
            .zip(challenge.bytes())
            .fold(0u8, |a, (x, y)| a | (x ^ y))
            == 0
}

/// Identifying prefix stored alongside a key (safe to display).
pub fn key_prefix(key: &str) -> String {
    key.chars().take(12).collect()
}

/// Hash an API key as sha256 hex (keys use sha256; passwords use argon2id).
pub fn hash_api_key(raw: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(raw.trim().as_bytes());
    format!("{:x}", h.finalize())
}

/// Constant-time comparison so differences do not leak through timing.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Verify an API key against its stored hash (sha256 hex or argon2id); any other format
/// fails closed.
pub fn verify_key(plain: &str, stored_hash: &str) -> bool {
    if plain.is_empty() || stored_hash.is_empty() {
        return false;
    }
    if stored_hash.starts_with("$argon2") {
        return verify_password(plain, stored_hash);
    }
    if stored_hash.len() == 64 && stored_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        let computed = hash_api_key(plain);
        return constant_time_eq(computed.as_bytes(), stored_hash.to_lowercase().as_bytes());
    }
    false
}

// ---------------------------------------------------------------------------
// Access control: ordered STACK
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccessAction {
    Allow,
    Block,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuleKind {
    Ip,
    Range,
    Cidr,
    Domain,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessRule {
    pub id: String,
    pub kind: RuleKind,
    pub value: String,
    pub action: AccessAction,
    pub enabled: bool,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AccessStack {
    pub rules: Vec<AccessRule>,
    /// true = allow when no rule matches.
    pub default_allow: bool,
}

impl AccessStack {
    /// Evaluate top-down: the first matching rule wins.
    /// Loopback is always allowed to prevent lockout.
    pub fn evaluate(&self, ip: Option<&str>, domain: Option<&str>) -> AccessAction {
        // On a dual-stack listener IPv4 peers arrive as `::ffff:a.b.c.d`; match
        // them as the IPv4 address they are.
        let canon = ip
            .and_then(|i| i.trim().parse::<IpAddr>().ok())
            .map(|a| a.to_canonical());
        if canon.is_some_and(|a| a.is_loopback()) {
            return AccessAction::Allow;
        }
        let canon_s = canon.map(|a| a.to_string());
        let ip = canon_s.as_deref().or(ip);
        for r in &self.rules {
            if !r.enabled {
                continue;
            }
            if rule_matches(r, ip, domain) {
                return r.action.clone();
            }
        }
        if self.default_allow {
            AccessAction::Allow
        } else {
            AccessAction::Block
        }
    }

    /// Anti-lockout check: would this stack block the caller's own IP?
    pub fn would_lock_out(&self, caller_ip: &str) -> bool {
        matches!(self.evaluate(Some(caller_ip), None), AccessAction::Block)
    }
}

fn rule_matches(r: &AccessRule, ip: Option<&str>, domain: Option<&str>) -> bool {
    match r.kind {
        RuleKind::All => true,
        RuleKind::Ip => ip.is_some_and(|i| ip_eq(&r.value, i)),
        RuleKind::Cidr => ip.map(|i| cidr_contains(&r.value, i)).unwrap_or(false),
        RuleKind::Range => ip.map(|i| range_contains(&r.value, i)).unwrap_or(false),
        RuleKind::Domain => domain.map(|d| domain_matches(&r.value, d)).unwrap_or(false),
    }
}

/// Same address, whatever the spelling (`::1` / `0:0::1`, IPv4-mapped IPv6).
fn ip_eq(rule: &str, ip: &str) -> bool {
    match (rule.trim().parse::<IpAddr>(), ip.parse::<IpAddr>()) {
        (Ok(a), Ok(b)) => a.to_canonical() == b.to_canonical(),
        _ => rule.trim() == ip,
    }
}

fn cidr_contains(cidr: &str, ip: &str) -> bool {
    let Some((net, bits)) = cidr.split_once('/') else {
        return false;
    };
    let (Ok(net), Ok(bits)) = (net.trim().parse::<IpAddr>(), bits.trim().parse::<u8>()) else {
        return false;
    };
    let Ok(addr) = ip.parse::<IpAddr>() else {
        return false;
    };
    match (net, addr) {
        (IpAddr::V4(n), IpAddr::V4(a)) => {
            if bits > 32 {
                return false;
            }
            let mask = if bits == 0 {
                0
            } else {
                u32::MAX << (32 - bits)
            };
            u32::from(n) & mask == u32::from(a) & mask
        }
        (IpAddr::V6(n), IpAddr::V6(a)) => {
            if bits > 128 {
                return false;
            }
            let mask = if bits == 0 {
                0u128
            } else {
                u128::MAX << (128 - bits)
            };
            u128::from(n) & mask == u128::from(a) & mask
        }
        _ => false,
    }
}

fn range_contains(range: &str, ip: &str) -> bool {
    let Some((a, b)) = range.split_once('-') else {
        return false;
    };
    let (Ok(a), Ok(b), Ok(x)) = (
        a.trim().parse::<std::net::Ipv4Addr>(),
        b.trim().parse::<std::net::Ipv4Addr>(),
        ip.parse::<std::net::Ipv4Addr>(),
    ) else {
        return false;
    };
    let (a, b, x) = (u32::from(a), u32::from(b), u32::from(x));
    x >= a.min(b) && x <= a.max(b)
}

fn domain_matches(pattern: &str, domain: &str) -> bool {
    let pattern = pattern.trim().to_lowercase();
    let domain = domain.trim().to_lowercase();
    if let Some(suffix) = pattern.strip_prefix("*.") {
        return domain == suffix || domain.ends_with(&format!(".{suffix}"));
    }
    pattern == domain
}

// ---------------------------------------------------------------------------
// LOCKED state: routes that stay reachable
// ---------------------------------------------------------------------------

/// Paths that remain reachable while the instance is LOCKED: recovery routes and the
/// health check only.
pub const LOCK_ALLOWED: &[&str] = &[
    "/login",
    "/logout",
    "/api/auth/state",
    "/api/auth/verify",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/bootstrap",
    "/api/auth/reset",
    "/healthz",
    "/favicon.ico",
    // memora-cli stop (loopback and the state dir token only)
    "/_stop",
];

/// Exact match only (not any `/api/auth/*`).
pub fn lock_allows(path: &str) -> bool {
    LOCK_ALLOWED.contains(&path)
}

// ---------------------------------------------------------------------------
// Setup codes, usernames and filesystem helpers
// ---------------------------------------------------------------------------

/// Unambiguous alphabet: no 0/O, 1/I/L.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/// A one-time setup code such as `K7QF-29XM`.
pub fn generate_setup_code() -> String {
    let mut buf = [0u8; 8];
    OsRng.fill_bytes(&mut buf);
    let chars: String = buf
        .iter()
        .map(|b| CODE_ALPHABET[*b as usize % CODE_ALPHABET.len()] as char)
        .collect();
    format!("{}-{}", &chars[..4], &chars[4..])
}

/// Uppercase and drop separators, so `k7qf 29xm` matches `K7QF-29XM`.
pub fn normalize_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

/// Validate a username for the owner account.
pub fn valid_username(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 32
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// When run as root (e.g. `sudo memora-cli`), hand a written file to the owner
/// of its directory so the server, which runs as that user, can still rewrite it.
pub fn match_dir_owner(path: &Path, dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(d), Ok(f)) = (std::fs::metadata(dir), std::fs::metadata(path)) {
            if f.uid() == 0 && d.uid() != 0 {
                let _ = std::os::unix::fs::chown(path, Some(d.uid()), Some(d.gid()));
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (path, dir);
    }
}

/// True when `dir` exists and a file can be created in it.
pub fn dir_writable(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let probe = dir.join(format!(".memora-probe-{}", std::process::id()));
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

// ---------------------------------------------------------------------------
// Environment config and Host allow-list
// ---------------------------------------------------------------------------

/// Settings read from the environment. Every one is optional.
#[derive(Debug, Clone, Default)]
pub struct EnvConfig {
    /// `MEMORA_BASE_URL`: public URL; its host is also an allowed domain.
    pub base_url: Option<String>,
    /// `MEMORA_DOMAIN`: comma-separated allowed hostnames (`*.example.com` allowed).
    pub domains: Vec<String>,
    /// `MEMORA_ADMIN_USER`: owner created at startup when none exists.
    pub admin_user: String,
    /// `MEMORA_ADMIN_PASSWORD[_FILE]`.
    pub admin_password: Option<String>,
    /// `MEMORA_API_KEY[_FILE]`: a default API key for agents.
    pub api_key: Option<String>,
    /// `MEMORA_VAULT_AUTO`: use `MEMORA_VAULT` without the browser step.
    pub vault_auto: bool,
}

/// `NAME`, or the trimmed contents of the file named by `NAME_FILE`.
fn env_secret(name: &str) -> Option<String> {
    if let Ok(path) = std::env::var(format!("{name}_FILE")) {
        if let Ok(v) = std::fs::read_to_string(path.trim()) {
            let v = v.trim().to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Host part of a URL such as `https://memory.example.com:8443/x`.
pub fn url_host(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit('@').next()?;
    let host = if host.starts_with('[') {
        host.split(']').next()?.trim_start_matches('[')
    } else {
        host.split(':').next()?
    };
    (!host.is_empty()).then(|| host.to_lowercase())
}

pub fn env_config() -> EnvConfig {
    let base_url = std::env::var("MEMORA_BASE_URL")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty());
    let mut domains: Vec<String> = std::env::var("MEMORA_DOMAIN")
        .unwrap_or_default()
        .split(',')
        .map(|d| d.trim().to_lowercase())
        .filter(|d| !d.is_empty())
        .collect();
    if let Some(h) = base_url.as_deref().and_then(url_host) {
        if !domains.contains(&h) {
            domains.push(h);
        }
    }
    EnvConfig {
        base_url,
        domains,
        admin_user: std::env::var("MEMORA_ADMIN_USER")
            .ok()
            .map(|v| v.trim().to_lowercase())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "admin".to_string()),
        admin_password: env_secret("MEMORA_ADMIN_PASSWORD"),
        api_key: env_secret("MEMORA_API_KEY"),
        vault_auto: matches!(
            std::env::var("MEMORA_VAULT_AUTO")
                .unwrap_or_default()
                .trim()
                .to_lowercase()
                .as_str(),
            "1" | "true" | "yes" | "on"
        ),
    }
}

/// Whether a request for `host` (Host header, port allowed) may be served. No configured
/// domains allows every host; loopback names are always allowed.
pub fn host_allowed(domains: &[String], host: &str) -> bool {
    if domains.is_empty() {
        return true;
    }
    let h = url_host(host).unwrap_or_default();
    if h == "localhost" || h.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()) {
        return true;
    }
    domains.iter().any(|d| domain_matches(d, &h))
}

// ---------------------------------------------------------------------------
// Per-key permissions
// ---------------------------------------------------------------------------

/// Scopes a key gets when it is created without explicit scopes.
pub const DEFAULT_KEY_SCOPES: [&str; 3] = ["mcp", "read", "write"];

/// Every scope a key may carry.
pub const KNOWN_SCOPES: [&str; 4] = ["mcp", "read", "write", "admin"];

/// Which tools a key may call: every tool (`"*"`) or only the listed names.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ToolGrant {
    #[default]
    All,
    Only(BTreeSet<String>),
}

impl ToolGrant {
    /// Strict parse for API input: `"*"` or an array of strings.
    pub fn parse_strict(v: &Value) -> std::result::Result<Self, String> {
        match v {
            Value::String(s) if s == "*" => Ok(ToolGrant::All),
            Value::Array(a) => {
                let mut set = BTreeSet::new();
                for x in a {
                    match x.as_str() {
                        Some(s) => {
                            set.insert(s.to_string());
                        }
                        None => return Err("tools must be \"*\" or a list of names".into()),
                    }
                }
                Ok(ToolGrant::Only(set))
            }
            _ => Err("tools must be \"*\" or a list of names".into()),
        }
    }

    pub fn to_value(&self) -> Value {
        match self {
            ToolGrant::All => json!("*"),
            ToolGrant::Only(s) => json!(s.iter().collect::<Vec<_>>()),
        }
    }

    pub fn allows(&self, name: &str) -> bool {
        match self {
            ToolGrant::All => true,
            ToolGrant::Only(s) => s.contains(name),
        }
    }
}

/// Strict parse for API input: an array of known scope names (deduplicated).
pub fn parse_scopes_strict(v: &Value) -> std::result::Result<Vec<String>, String> {
    let a = v.as_array().ok_or("scopes must be a list")?;
    let mut out: Vec<String> = Vec::new();
    for x in a {
        let s = x.as_str().ok_or("scopes must be a list of strings")?;
        if !KNOWN_SCOPES.contains(&s) {
            return Err(format!("unknown scope: {s}"));
        }
        if !out.iter().any(|o| o == s) {
            out.push(s.to_string());
        }
    }
    Ok(out)
}

/// What an API key is allowed to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyPermissions {
    pub enabled: bool,
    pub scopes: Vec<String>,
    pub tools: ToolGrant,
}

impl Default for KeyPermissions {
    fn default() -> Self {
        Self {
            enabled: true,
            scopes: DEFAULT_KEY_SCOPES.iter().map(|s| s.to_string()).collect(),
            tools: ToolGrant::All,
        }
    }
}

impl KeyPermissions {
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.iter().any(|s| s == scope)
    }
}

/// Why a tool call is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolDenial {
    /// Globally disabled on this server.
    Disabled,
    /// The key is disabled, lacks the `mcp` scope, or its `tools` list
    /// does not include the tool.
    NotAllowed,
}

impl ToolDenial {
    /// JSON-RPC error message for `tools/call`.
    pub fn message(self, name: &str) -> String {
        match self {
            ToolDenial::Disabled => format!("tool disabled on this server: {name}"),
            ToolDenial::NotAllowed => format!("tool not allowed for this API key: {name}"),
        }
    }
}

/// Effective MCP access to tool `name`: key enabled, `mcp` scope, not globally disabled,
/// and granted. `perms == None` is a full-access caller (global switches still apply).
pub fn tool_access(
    perms: Option<&KeyPermissions>,
    disabled: &BTreeSet<String>,
    name: &str,
) -> std::result::Result<(), ToolDenial> {
    if let Some(p) = perms {
        if !p.enabled || !p.has_scope("mcp") {
            return Err(ToolDenial::NotAllowed);
        }
    }
    if disabled.contains(name) {
        return Err(ToolDenial::Disabled);
    }
    match perms {
        Some(p) if !p.tools.allows(name) => Err(ToolDenial::NotAllowed),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_s256_rfc7636_vector() {
        // RFC 7636 appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert!(pkce_s256_matches(
            verifier,
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        ));
        assert!(!pkce_s256_matches(
            verifier,
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cN"
        ));
        assert!(!pkce_s256_matches("short", "x"));
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"foobar"), "Zm9vYmFy");
    }

    fn set(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn argon2_verifies_stored_hash() {
        // A stored argon2id hash must verify against its plaintext and reject any other.
        let h = "$argon2id$v=19$m=19456,t=2,p=1$/llzV2PYl6h+/+YBNg3lhw$+zG+WijJq1kC22J0d15Km2LhhQz3EdLInWzcy0dvGkw";
        assert!(verify_password("correct horse battery staple", h));
        assert!(!verify_password("wrong", h));
    }

    #[test]
    fn argon2_roundtrip() {
        let h = hash_password("Str0ngT3stP@ss").unwrap();
        assert!(verify_password("Str0ngT3stP@ss", &h));
        assert!(!verify_password("wrong", &h));
    }

    #[test]
    fn cidr_and_range() {
        assert!(cidr_contains("10.0.0.0/24", "10.0.0.55"));
        assert!(!cidr_contains("10.0.0.0/24", "10.0.1.55"));
        assert!(range_contains("10.0.0.1-10.0.0.254", "10.0.0.7"));
        assert!(!range_contains("10.0.0.1-10.0.0.254", "10.0.1.7"));
    }

    #[test]
    fn domain_wildcard() {
        assert!(domain_matches("*.example.com", "a.example.com"));
        assert!(domain_matches("*.example.com", "example.com"));
        assert!(!domain_matches("*.example.com", "notexample.com"));
    }

    #[test]
    fn loopback_never_blocked() {
        let stack = AccessStack {
            rules: vec![AccessRule {
                id: "r1".into(),
                kind: RuleKind::All,
                value: "*".into(),
                action: AccessAction::Block,
                enabled: true,
                note: String::new(),
            }],
            default_allow: false,
        };
        assert_eq!(stack.evaluate(Some("127.0.0.1"), None), AccessAction::Allow);
        assert_eq!(stack.evaluate(Some("8.8.8.8"), None), AccessAction::Block);
    }

    #[test]
    fn ipv4_mapped_peers_match_ipv4_rules() {
        let rule = |kind, value: &str| AccessRule {
            id: "r".into(),
            kind,
            value: value.into(),
            action: AccessAction::Allow,
            enabled: true,
            note: String::new(),
        };
        for r in [
            rule(RuleKind::Ip, "203.0.113.7"),
            rule(RuleKind::Cidr, "203.0.113.0/24"),
            rule(RuleKind::Range, "203.0.113.1-203.0.113.9"),
        ] {
            let stack = AccessStack {
                rules: vec![r],
                default_allow: false,
            };
            assert_eq!(
                stack.evaluate(Some("::ffff:203.0.113.7"), None),
                AccessAction::Allow
            );
            assert_eq!(
                stack.evaluate(Some("::ffff:203.0.114.7"), None),
                AccessAction::Block
            );
        }
        let stack = AccessStack::default();
        assert_eq!(
            stack.evaluate(Some("::ffff:127.0.0.1"), None),
            AccessAction::Allow
        );
    }

    #[test]
    fn first_match_wins() {
        let stack = AccessStack {
            rules: vec![
                AccessRule {
                    id: "allow-lan".into(),
                    kind: RuleKind::Cidr,
                    value: "10.0.0.0/24".into(),
                    action: AccessAction::Allow,
                    enabled: true,
                    note: String::new(),
                },
                AccessRule {
                    id: "block-all".into(),
                    kind: RuleKind::All,
                    value: "*".into(),
                    action: AccessAction::Block,
                    enabled: true,
                    note: String::new(),
                },
            ],
            default_allow: false,
        };
        assert_eq!(stack.evaluate(Some("10.0.0.5"), None), AccessAction::Allow);
        assert_eq!(stack.evaluate(Some("1.2.3.4"), None), AccessAction::Block);
    }

    #[test]
    fn api_key_sha256_hash_format() {
        let raw = "memora_abcdefghijklmnopqrstuvwxyz012345";
        let h = hash_api_key(raw);
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(h, hash_api_key(raw));
        // Surrounding whitespace is trimmed.
        assert_eq!(h, hash_api_key(&format!("  {raw}  ")));
        assert!(!verify_key("memora_wrong", &h));
        assert!(verify_key(raw, &h));
        // Unknown hash formats and empty input fail closed.
        assert!(!verify_key(raw, "not-a-hash"));
        assert!(!verify_key(raw, ""));
        assert!(!verify_key("", &h));
    }

    #[test]
    fn key_format_and_prefix() {
        let k = generate_key();
        assert!(k.starts_with("memora_live_"));
        assert_eq!(k.len(), "memora_live_".len() + 32);
        assert_eq!(key_prefix(&k).len(), 12);
        assert_ne!(generate_key(), generate_key());
    }

    #[test]
    fn setup_code_format_and_normalize() {
        let code = generate_setup_code();
        assert_eq!(code.len(), 9);
        assert_eq!(&code[4..5], "-");
        assert_eq!(
            normalize_code(&code.to_lowercase().replace('-', " ")),
            normalize_code(&code)
        );
        assert_eq!(normalize_code("k7qf-29xm"), "K7QF29XM");
    }

    #[test]
    fn username_rules() {
        assert!(valid_username("owner_1.x"));
        assert!(!valid_username("a b"));
        assert!(!valid_username(""));
        assert!(!valid_username(&"a".repeat(33)));
    }

    #[test]
    fn host_allow_list() {
        let d = vec![
            "memory.example.com".to_string(),
            "*.lan.example".to_string(),
        ];
        assert!(host_allowed(&d, "memory.example.com"));
        assert!(host_allowed(&d, "Memory.Example.com:443"));
        assert!(host_allowed(&d, "box.lan.example:8400"));
        assert!(host_allowed(&d, "127.0.0.1:8400"));
        assert!(host_allowed(&d, "localhost"));
        assert!(!host_allowed(&d, "10.0.0.5:8400"));
        assert!(!host_allowed(&d, "evil.com"));
        assert!(host_allowed(&[], "anything"));
        assert_eq!(
            url_host("https://memory.example.com:8443/x").as_deref(),
            Some("memory.example.com")
        );
    }

    #[test]
    fn lock_allows_precise_paths() {
        assert!(lock_allows("/api/auth/state"));
        assert!(lock_allows("/api/auth/reset"));
        assert!(lock_allows("/api/auth/verify"));
        assert!(lock_allows("/_stop"));
        assert!(!lock_allows("/api/auth/me"));
        assert!(!lock_allows("/api/export"));
    }

    #[test]
    fn grant_and_scope_parsing() {
        assert_eq!(ToolGrant::All.to_value(), json!("*"));
        assert_eq!(
            ToolGrant::parse_strict(&json!(["a", "b"])).unwrap(),
            ToolGrant::Only(set(&["a", "b"]))
        );
        assert_eq!(
            ToolGrant::parse_strict(&json!("*")).unwrap(),
            ToolGrant::All
        );
        assert!(ToolGrant::parse_strict(&json!("all")).is_err());
        assert!(ToolGrant::parse_strict(&json!([1])).is_err());
        assert_eq!(
            parse_scopes_strict(&json!(["mcp", "admin", "mcp"])).unwrap(),
            vec!["mcp", "admin"]
        );
        assert!(parse_scopes_strict(&json!(["root"])).is_err());
    }

    #[test]
    fn effective_access() {
        let none = BTreeSet::new();
        let off = set(&["delete_memory"]);
        let def = KeyPermissions::default();
        assert_eq!(tool_access(Some(&def), &none, "delete_memory"), Ok(()));
        assert_eq!(
            tool_access(Some(&def), &off, "delete_memory"),
            Err(ToolDenial::Disabled)
        );
        assert_eq!(
            tool_access(None, &off, "delete_memory"),
            Err(ToolDenial::Disabled)
        );
        assert_eq!(tool_access(None, &off, "get_stats"), Ok(()));

        let only = KeyPermissions {
            tools: ToolGrant::Only(set(&["get_stats"])),
            ..def.clone()
        };
        assert_eq!(tool_access(Some(&only), &none, "get_stats"), Ok(()));
        assert_eq!(
            tool_access(Some(&only), &none, "read_memory"),
            Err(ToolDenial::NotAllowed)
        );

        let no_mcp = KeyPermissions {
            scopes: vec!["read".into()],
            ..def.clone()
        };
        assert_eq!(
            tool_access(Some(&no_mcp), &none, "get_stats"),
            Err(ToolDenial::NotAllowed)
        );
        let disabled_key = KeyPermissions {
            enabled: false,
            ..def
        };
        assert_eq!(
            tool_access(Some(&disabled_key), &none, "get_stats"),
            Err(ToolDenial::NotAllowed)
        );
        assert_eq!(
            ToolDenial::NotAllowed.message("x"),
            "tool not allowed for this API key: x"
        );
        assert_eq!(
            ToolDenial::Disabled.message("x"),
            "tool disabled on this server: x"
        );
    }
}
