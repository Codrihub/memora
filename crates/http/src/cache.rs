//! State-database glue: caches of the hot tables (reloaded per changed domain),
//! browser sessions (never cached, so a CLI sign-out applies at once), type
//! conversions to `memora-gateway`, and the background tasks.

use crate::AppState;
use axum::http::HeaderMap;
use memora_state::arm::{ArmStatus, ArmWindow};
use memora_state::keys::{ApiKey, Scope};
use memora_state::{Db, Domain};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Mutex, RwLock, RwLockReadGuard};
use std::time::Duration;

/// Name of the session cookie (holds the raw session id; the DB stores its sha256).
pub const SESSION_COOKIE: &str = "memora_sess";

/// Cached copies of the tables read on (almost) every request.
#[derive(Debug)]
pub struct Caches {
    pub owner: RwLock<Option<memora_state::owner::Owner>>,
    /// Live (not trashed) API keys.
    pub keys: RwLock<Vec<ApiKey>>,
    pub settings: RwLock<memora_state::settings::Settings>,
    pub arm: RwLock<ArmWindow>,
    /// Converted for evaluation (`memora_gateway::AccessStack::evaluate`).
    pub access: RwLock<memora_gateway::AccessStack>,
}

/// Poison-tolerant read lock.
pub fn rd<T>(l: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    l.read().unwrap_or_else(|e| e.into_inner())
}

fn put<T>(l: &RwLock<T>, v: T) {
    *l.write().unwrap_or_else(|e| e.into_inner()) = v;
}

/// Poison-tolerant mutex lock.
pub fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Caches {
    /// Load every cache from `db`.
    pub fn load(db: &Db) -> memora_state::Result<Caches> {
        db.read(|c| {
            Ok(Caches {
                owner: RwLock::new(memora_state::owner::get(c)?),
                keys: RwLock::new(memora_state::keys::list(c)?),
                settings: RwLock::new(memora_state::settings::get(c)?),
                arm: RwLock::new(memora_state::arm::get(c)?),
                access: RwLock::new(access_from_db(memora_state::access::load(c)?)),
            })
        })
    }
}

/// Reload the cache of one domain from the database. Errors keep the old cache.
pub fn reload(st: &AppState, domain: Domain) {
    let db = &st.db;
    let c = &st.cache;
    let res = match domain {
        Domain::Auth => db.read(memora_state::owner::get).map(|v| put(&c.owner, v)),
        Domain::Keys => db.read(memora_state::keys::list).map(|v| put(&c.keys, v)),
        Domain::Tools => {
            st.mcp.reload_tools();
            Ok(())
        }
        Domain::Access => db
            .read(memora_state::access::load)
            .map(|v| put(&c.access, access_from_db(v))),
        Domain::Settings => db.read(memora_state::settings::get).map(|v| {
            let vault = v.vault_path.clone();
            put(&c.settings, v);
            // A vault chosen elsewhere (memora-cli vault) is picked up at runtime.
            if let Some(v) = vault {
                if st.vault_path().as_deref() != Some(v.as_str()) {
                    tracing::info!(vault = %v, "vault changed in the state database");
                    apply_vault(st, Path::new(&v));
                }
            }
        }),
        Domain::Arm => db.read(memora_state::arm::get).map(|v| put(&c.arm, v)),
    };
    if let Err(e) = res {
        tracing::error!(%domain, "could not reload from the state database: {e}");
    }
}

/// Reload every cache (`reload_all` control request).
pub fn reload_all(st: &AppState) {
    for d in Domain::ALL {
        reload(st, d);
    }
}

/// Reload the domains another connection changed since the last check. Costs one
/// `PRAGMA data_version` when nothing changed.
pub fn refresh(st: &AppState) {
    match st.db.changed_domains() {
        Ok(changed) => {
            for d in changed {
                tracing::debug!(%d, "state changed, reloading");
                reload(st, d);
            }
        }
        Err(e) => tracing::error!("state database change check failed: {e}"),
    }
}

/// Switch the running server to the vault folder `path`: the store is replaced in
/// place (MCP shares the same `Arc`) and realtime events go to the new vault.
pub fn apply_vault(st: &AppState, path: &Path) {
    let vault = path.to_string_lossy().to_string();
    {
        // Swap under the store lock so no request sees the new path with old events.
        let mut store = lock(&st.store);
        // The privacy hook (rules follow renames and moves) stays installed.
        let hook = store.path_hook();
        *store = memora_core::MemoryStore::new(path);
        store.set_path_hook(hook);
        let hub = memora_core::events::hub();
        hub.set_events_path(path.join(".events.jsonl"));
        hub.clear_replay();
        *st.vault.write().unwrap_or_else(|e| e.into_inner()) = Some(vault.clone());
    }
    memora_core::events::hub()
        .publish(serde_json::json!({"type": "vault_changed", "vault": vault}));
}

/// The arm window. An expired window (or a lock taken on expiry by an older
/// version) is reset to idle, so an unused code never locks the instance.
pub fn arm_window(st: &AppState) -> ArmWindow {
    let now = memora_state::now();
    let w = rd(&st.cache.arm).clone();
    let end = w.armed_at.zip(w.ttl).map(|(at, ttl)| at + ttl);
    let stale = match (w.status, end) {
        (ArmStatus::Armed, Some(end)) => end < now,
        (ArmStatus::Locked, Some(end)) => w.locked_at.is_some_and(|l| l > end),
        _ => false,
    };
    if !stale {
        return w;
    }
    match st.db.write(|tx| memora_state::arm::state(tx, now)) {
        Ok(fresh) => {
            put(&st.cache.arm, fresh.clone());
            fresh
        }
        Err(e) => {
            // Fail closed for the code (no window), never with a lock.
            tracing::error!("could not close the expired window: {e}");
            ArmWindow {
                status: ArmStatus::Idle,
                locked_at: None,
                ..w
            }
        }
    }
}

/// sha256 hex of a normalised setup code (`K7QF-29XM` == `k7qf29xm`); the form the
/// arm window stores. Empty input stays empty (never matches).
pub fn code_hash(code: &str) -> String {
    let n = memora_gateway::normalize_code(code);
    if n.is_empty() {
        String::new()
    } else {
        memora_gateway::hash_api_key(&n)
    }
}

/// A signed-in browser.
#[derive(Debug, Clone)]
pub struct WebSession {
    /// sha256 hex of the raw cookie value (`session.sid_hash`).
    pub sid_hash: String,
    /// The owner's username.
    pub user: String,
    pub created_at: i64,
}

/// sha256 hex of a raw session id (the cookie value).
pub fn sid_hash(raw: &str) -> String {
    memora_gateway::hash_api_key(raw)
}

/// A new random session id: 256 bits from the CSPRNG, hex.
pub fn new_sid() -> String {
    let a = memora_gateway::generate_key();
    let b = memora_gateway::generate_key();
    let hex = |k: &str| k.rsplit('_').next().unwrap_or("").to_string();
    format!("{}{}", hex(&a), hex(&b))
}

/// `(session_ttl, session_max_age)` from the settings.
pub fn session_limits(st: &AppState) -> (i64, i64) {
    let s = rd(&st.cache.settings);
    (s.session_ttl, s.session_max_age)
}

/// Seconds until a session that was just used expires.
pub fn remaining(st: &AppState, s: &WebSession) -> i64 {
    let (ttl, max_age) = session_limits(st);
    if max_age > 0 {
        ttl.min(s.created_at + max_age - memora_state::now()).max(0)
    } else {
        ttl
    }
}

/// The live session behind the `memora_sess` cookie, if any. Records the use for the
/// buffered `last_seen` update (sliding TTL).
pub fn session_of(st: &AppState, headers: &HeaderMap) -> Option<WebSession> {
    let raw = crate::cookie_value(headers, SESSION_COOKIE)?;
    let hash = sid_hash(&raw);
    let (ttl, max_age) = session_limits(st);
    let user = rd(&st.cache.owner).as_ref()?.username.clone();
    let now = memora_state::now();
    let sess = match st
        .db
        .read(|c| memora_state::session::lookup(c, &hash, ttl, max_age, now))
    {
        Ok(s) => s?,
        Err(e) => {
            tracing::error!("session lookup failed: {e}");
            return None;
        }
    };
    lock(&st.last_seen).note(&sess, now);
    Some(WebSession {
        sid_hash: hash,
        user,
        created_at: sess.created_at,
    })
}

/// Evaluation form of a stored access stack.
pub fn access_from_db(s: memora_state::access::AccessStack) -> memora_gateway::AccessStack {
    use memora_gateway::{AccessAction as A, RuleKind as K};
    use memora_state::access::{AccessAction as SA, RuleKind as SK};
    memora_gateway::AccessStack {
        default_allow: s.default_allow,
        rules: s
            .rules
            .into_iter()
            .map(|r| memora_gateway::AccessRule {
                id: r.id,
                kind: match r.kind {
                    SK::Ip => K::Ip,
                    SK::Range => K::Range,
                    SK::Cidr => K::Cidr,
                    SK::Domain => K::Domain,
                    SK::All => K::All,
                },
                value: r.value,
                action: match r.action {
                    SA::Allow => A::Allow,
                    SA::Block => A::Block,
                },
                enabled: r.enabled,
                note: r.note,
            })
            .collect(),
    }
}

/// Storage form of an access stack.
pub fn access_to_db(s: &memora_gateway::AccessStack) -> memora_state::access::AccessStack {
    use memora_gateway::{AccessAction as A, RuleKind as K};
    use memora_state::access::{AccessAction as SA, RuleKind as SK};
    memora_state::access::AccessStack {
        default_allow: s.default_allow,
        rules: s
            .rules
            .iter()
            .map(|r| memora_state::access::AccessRule {
                id: r.id.clone(),
                kind: match r.kind {
                    K::Ip => SK::Ip,
                    K::Range => SK::Range,
                    K::Cidr => SK::Cidr,
                    K::Domain => SK::Domain,
                    K::All => SK::All,
                },
                value: r.value.clone(),
                action: match r.action {
                    A::Allow => SA::Allow,
                    A::Block => SA::Block,
                },
                enabled: r.enabled,
                note: r.note.clone(),
            })
            .collect(),
    }
}

/// Scope names in display order.
pub fn scope_names(s: &BTreeSet<Scope>) -> Vec<String> {
    s.iter().map(|x| x.as_str().to_string()).collect()
}

/// Scopes from names already checked by `memora_gateway::parse_scopes_strict`.
pub fn scopes_from_names(names: &[String]) -> BTreeSet<Scope> {
    names.iter().filter_map(|n| n.parse().ok()).collect()
}

pub fn grant_to_db(g: &memora_gateway::ToolGrant) -> memora_state::keys::ToolGrant {
    match g {
        memora_gateway::ToolGrant::All => memora_state::keys::ToolGrant::All,
        memora_gateway::ToolGrant::Only(s) => memora_state::keys::ToolGrant::Only(s.clone()),
    }
}

pub fn grant_from_db(g: &memora_state::keys::ToolGrant) -> memora_gateway::ToolGrant {
    match g {
        memora_state::keys::ToolGrant::All => memora_gateway::ToolGrant::All,
        memora_state::keys::ToolGrant::Only(s) => memora_gateway::ToolGrant::Only(s.clone()),
    }
}

/// What a stored key may do, in the form MCP and the scope gate use.
pub fn perms_of(k: &ApiKey) -> memora_gateway::KeyPermissions {
    memora_gateway::KeyPermissions {
        enabled: k.enabled,
        scopes: scope_names(&k.scopes),
        tools: grant_from_db(&k.tools),
    }
}

/// The enabled live key matching the raw `key`: sha256 keys by hash, legacy argon2id
/// keys by verification.
pub fn find_key(st: &AppState, key: &str) -> Option<ApiKey> {
    if key.is_empty() {
        return None;
    }
    let hash = memora_gateway::hash_api_key(key);
    let keys = rd(&st.cache.keys);
    if let Some(k) = keys
        .iter()
        .find(|k| k.enabled && memora_gateway::constant_time_eq(k.hash.as_bytes(), hash.as_bytes()))
    {
        return Some(k.clone());
    }
    keys.iter()
        .find(|k| {
            k.enabled && k.hash.starts_with("$argon2") && memora_gateway::verify_key(key, &k.hash)
        })
        .cloned()
}

/// How often the change watcher runs when no request triggers a check.
const WATCH_EVERY: Duration = Duration::from_secs(1);
/// How often pending control requests (`memora-cli` limiter reset, reload) are served.
const CONTROL_EVERY: Duration = Duration::from_secs(2);
/// How often buffered `last_seen` updates are written.
const LAST_SEEN_EVERY: Duration = Duration::from_secs(5);
/// Buffered key usage is written every this many `LAST_SEEN_EVERY` ticks (30 s).
const USAGE_TICKS: u32 = 6;
/// Retention pruning.
const PRUNE_EVERY: Duration = Duration::from_secs(3600);

/// Write buffered key usage. On failure the batch goes back into the buffer.
pub fn flush_usage(st: &AppState) {
    let mut batch = lock(&st.usage).take();
    if batch.is_empty() {
        return;
    }
    if let Err(e) = batch.flush(&st.db) {
        tracing::error!("could not write key usage: {e}");
        lock(&st.usage).merge(batch);
    }
}

/// Write buffered session `last_seen` updates. On failure they go back into the buffer.
pub fn flush_last_seen(st: &AppState) {
    let pending = std::mem::take(&mut lock(&st.last_seen).pending);
    if pending.is_empty() {
        return;
    }
    if let Err(e) = st
        .db
        .write(|tx| memora_state::session::touch_many(tx, &pending))
    {
        tracing::error!("could not write session activity: {e}");
        let mut buf = lock(&st.last_seen);
        for (k, v) in pending {
            let at = buf.pending.entry(k).or_insert(v);
            *at = (*at).max(v);
        }
    }
}

/// Flush every write buffer (periodically and at shutdown).
pub fn flush_all(st: &AppState) {
    flush_last_seen(st);
    flush_usage(st);
}

/// Serve pending control requests from `memora-cli`.
pub fn serve_control(st: &AppState) {
    use memora_state::control::{self, ControlKind};
    let pending = match st.db.read(control::pending) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("could not read control requests: {e}");
            return;
        }
    };
    for req in pending {
        let result = match req.kind {
            ControlKind::LimiterReset => {
                st.guard.reset();
                tracing::warn!(by = %req.requested_by, "login cooldowns cleared from the CLI");
                "cleared"
            }
            ControlKind::ReloadAll => {
                reload_all(st);
                tracing::info!(by = %req.requested_by, "caches reloaded on request");
                "reloaded"
            }
        };
        let now = memora_state::now();
        if let Err(e) = st.db.write(|tx| control::complete(tx, req.id, result, now)) {
            tracing::error!(id = req.id, "could not acknowledge a control request: {e}");
        }
    }
}

/// Run `f` on the blocking pool (database calls may wait up to the busy timeout).
async fn blocking(st: &AppState, f: fn(&AppState)) {
    let st = st.clone();
    let _ = tokio::task::spawn_blocking(move || f(&st)).await;
}

/// Spawn the background tasks: change watcher (1 s), control requests (2 s), buffered
/// writes (5 s / 30 s) and retention (hourly, first run at start).
pub fn spawn_background(st: &AppState) {
    let s = st.clone();
    tokio::spawn(async move {
        let mut t = tokio::time::interval(WATCH_EVERY);
        t.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            t.tick().await;
            blocking(&s, refresh).await;
        }
    });
    let s = st.clone();
    tokio::spawn(async move {
        let mut t = tokio::time::interval(CONTROL_EVERY);
        t.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            t.tick().await;
            blocking(&s, serve_control).await;
        }
    });
    let s = st.clone();
    tokio::spawn(async move {
        let mut t = tokio::time::interval(LAST_SEEN_EVERY);
        t.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut n: u32 = 0;
        loop {
            t.tick().await;
            blocking(&s, flush_last_seen).await;
            n += 1;
            if n.is_multiple_of(USAGE_TICKS) {
                blocking(&s, flush_usage).await;
            }
        }
    });
    let s = st.clone();
    tokio::spawn(async move {
        let mut t = tokio::time::interval(PRUNE_EVERY);
        t.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            t.tick().await;
            blocking(&s, prune).await;
        }
    });
}

/// Push the event log limits from the settings row to the hub and drop events past
/// the age limit. Run at start, hourly with the prune, and when Settings change them.
pub fn apply_log_limits(st: &AppState) {
    match st.db.read(memora_state::settings::log_limits) {
        Ok((mb, days)) => {
            let hub = memora_core::events::hub();
            hub.set_log_limits(mb.max(1) as u64 * 1024 * 1024, days.max(0) as u64);
            let dropped = hub.prune_log_age();
            if dropped > 0 {
                tracing::info!(dropped, "event log: old events pruned");
            }
        }
        Err(e) => tracing::error!("could not read the event log limits: {e}"),
    }
}

/// One retention pass (docs/DATABASE.md section 5).
pub fn prune(st: &AppState) {
    apply_log_limits(st);
    if let Err(e) = st
        .db
        .write(|tx| memora_state::oauth::prune(tx, memora_state::now()))
    {
        tracing::error!("oauth prune failed: {e}");
    }
    let policy = memora_state::retention::RetentionPolicy::default();
    match memora_state::retention::prune(&st.db, &policy, memora_state::now()) {
        Ok(rep) if rep.total() > 0 => tracing::info!(?rep, "retention: old rows pruned"),
        Ok(_) => {}
        Err(e) => tracing::error!("retention prune failed: {e}"),
    }
}
