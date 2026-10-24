//! Typed access to the state database for the console and the subcommands. Closures run
//! as the state dir owner (possibly in a forked child) and return serde types; never
//! prompt inside them.

use crate::Ctx;
use anyhow::Result;
use memora_state::{activity, arm, config, keys, owner, session, settings, tools, usage};
use memora_state::{Connection, Db, Transaction};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// `activity.actor` of every row this CLI writes.
pub(crate) const ACTOR: &str = "memora-cli";

/// Run `f` on the open database (as the state dir owner) and bring its result back.
pub(crate) fn with_db<T: Serialize + DeserializeOwned>(
    ctx: &Ctx,
    f: impl FnOnce(&Db) -> Result<T>,
) -> Result<T> {
    let v = crate::db::with_state_db(&ctx.state, |db| Ok(serde_json::to_value(f(db)?)?))?;
    Ok(serde_json::from_value(v)?)
}

/// One read snapshot ([`Db::read`]).
pub(crate) fn read<T: Serialize + DeserializeOwned>(
    ctx: &Ctx,
    f: impl FnOnce(&Connection) -> memora_state::Result<T>,
) -> Result<T> {
    with_db(ctx, |db| Ok(db.read(f)?))
}

/// One write transaction ([`Db::write`], `BEGIN IMMEDIATE`; all or nothing).
pub(crate) fn write<T: Serialize + DeserializeOwned>(
    ctx: &Ctx,
    f: impl FnOnce(&Transaction<'_>) -> memora_state::Result<T>,
) -> Result<T> {
    with_db(ctx, |db| Ok(db.write(f)?))
}

/// Append an activity row (actor `memora-cli`) inside `tx`.
pub(crate) fn log(tx: &Transaction<'_>, event: &str, detail: &str) -> memora_state::Result<()> {
    activity::log(
        tx,
        &activity::NewActivity {
            event,
            ip: None,
            actor: Some(ACTOR),
            detail,
        },
        memora_state::now(),
    )?;
    Ok(())
}

/// Sync the stored tool catalog with this binary's, so tools can be switched
/// and granted before the server has ever run.
pub(crate) fn sync_catalog(tx: &Transaction<'_>) -> memora_state::Result<()> {
    let names: Vec<&str> = memora_mcp::catalog().iter().map(|t| t.name).collect();
    tools::sync_catalog(tx, &names)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Status snapshot
// ---------------------------------------------------------------------------

/// The setup / reset window (`arm_state`), expiry applied.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct ArmView {
    /// `idle`, `armed` or `locked`.
    pub status: String,
    /// `bootstrap` or `reset`.
    pub mode: Option<String>,
    pub ttl: i64,
    pub remaining: i64,
    /// The last window voided by a wrong code: (at, ip, mode).
    pub burn: Option<(i64, String, Option<String>)>,
}

impl ArmView {
    pub fn armed(&self) -> bool {
        self.status == "armed"
    }
    pub fn locked(&self) -> bool {
        self.status == "locked"
    }
}

/// Everything the status displays need, read in one transaction.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct Snapshot {
    pub owner: Option<String>,
    pub min_password_len: usize,
    /// The vault chosen in the browser or with `/vault` / `vault PATH`.
    pub vault_configured: Option<String>,
    /// Stored `server_config` rows.
    pub config: BTreeMap<String, String>,
    /// `config::effective` for every known key (stored row, environment, default).
    pub effective: BTreeMap<String, String>,
    pub arm: ArmView,
}

fn arm_view(w: &arm::ArmWindow, now: i64) -> ArmView {
    ArmView {
        status: match w.status {
            arm::ArmStatus::Idle => "idle",
            arm::ArmStatus::Armed => "armed",
            arm::ArmStatus::Locked => "locked",
        }
        .to_string(),
        mode: w.mode.map(|m| m.as_str().to_string()),
        ttl: w.ttl.unwrap_or(0),
        remaining: w.remaining(now),
        burn: w
            .last_burn
            .as_ref()
            .map(|b| (b.at, b.ip.clone(), b.mode.map(|m| m.as_str().to_string()))),
    }
}

/// Owner, settings, server config and the window. A write transaction, because
/// reading the window locks it when it has expired.
pub(crate) fn snapshot(ctx: &Ctx) -> Result<Snapshot> {
    write(ctx, |tx| {
        let now = memora_state::now();
        let w = arm::state(tx, now)?;
        let s = settings::get(tx)?;
        let mut effective = BTreeMap::new();
        for (k, _) in config::CONFIG_KEYS {
            if let Some(v) = config::effective(tx, k)? {
                effective.insert(k.to_string(), v);
            }
        }
        Ok(Snapshot {
            owner: owner::owner_name(tx)?,
            min_password_len: usize::try_from(s.min_password_len).unwrap_or(10),
            vault_configured: s.vault_path.filter(|v| !v.is_empty()),
            config: config::list(tx)?
                .into_iter()
                .map(|e| (e.key, e.value))
                .collect(),
            effective,
            arm: arm_view(&w, now),
        })
    })
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/// One API key as the console shows it.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct KeyView {
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub enabled: bool,
    pub scopes: Vec<String>,
    /// `None` = every tool, `Some(names)` = only these.
    pub tools: Option<Vec<String>>,
    pub created_at: i64,
    pub deleted_at: Option<i64>,
    pub last_used: i64,
    pub last_ip: String,
    pub count: u64,
}

/// Live keys, trashed keys and the globally disabled tools, in one snapshot.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct KeyList {
    pub live: Vec<KeyView>,
    pub trash: Vec<KeyView>,
    pub disabled_tools: BTreeSet<String>,
}

fn key_view(k: &keys::ApiKey, u: Option<&usage::KeyUsage>) -> KeyView {
    KeyView {
        id: k.id.clone(),
        name: k.name.clone(),
        prefix: k.prefix.clone(),
        enabled: k.enabled,
        scopes: k.scopes.iter().map(|s| s.as_str().to_string()).collect(),
        tools: match &k.tools {
            keys::ToolGrant::All => None,
            keys::ToolGrant::Only(t) => Some(t.iter().cloned().collect()),
        },
        created_at: k.created_at,
        deleted_at: k.deleted_at,
        last_used: u.map(|u| u.last_used).unwrap_or(0),
        last_ip: u
            .and_then(|u| u.last_ip.clone())
            .unwrap_or_else(|| "-".into()),
        count: u.map(|u| u.use_count).unwrap_or(0),
    }
}

/// Every API key with its usage, plus the globally disabled tools.
pub(crate) fn key_list(ctx: &Ctx) -> Result<KeyList> {
    read(ctx, |c| {
        let use_map = usage::all_usage(c)?;
        let mut live: Vec<KeyView> = keys::list(c)?
            .iter()
            .map(|k| key_view(k, use_map.get(&k.id)))
            .collect();
        live.sort_by(|a, b| b.last_used.cmp(&a.last_used).then(a.name.cmp(&b.name)));
        let trash = keys::list_trash(c)?
            .iter()
            .map(|k| key_view(k, use_map.get(&k.id)))
            .collect();
        Ok(KeyList {
            live,
            trash,
            disabled_tools: tools::disabled(c)?,
        })
    })
}

/// Globally disabled tools (`tool_disabled`).
pub(crate) fn disabled_tools(ctx: &Ctx) -> Result<BTreeSet<String>> {
    read(ctx, tools::disabled)
}

/// Parse scope names coming from the questionnaire.
pub(crate) fn parse_scopes(list: &[String]) -> memora_state::Result<BTreeSet<keys::Scope>> {
    list.iter().map(|s| s.parse()).collect()
}

/// `None` = every tool.
pub(crate) fn grant(tools: &Option<Vec<String>>) -> keys::ToolGrant {
    match tools {
        None => keys::ToolGrant::All,
        Some(t) => keys::ToolGrant::Only(t.iter().cloned().collect()),
    }
}

/// A freshly generated key: raw secret (shown once), id, hash and prefix.
pub(crate) struct NewKey {
    pub raw: String,
    pub new: keys::NewApiKey,
}

pub(crate) fn new_key(name: &str, scopes: BTreeSet<keys::Scope>, tools: keys::ToolGrant) -> NewKey {
    let raw = memora_gateway::generate_key();
    let hash = memora_gateway::hash_api_key(&raw);
    NewKey {
        new: keys::NewApiKey {
            id: format!("k_{}", &hash[..8]),
            name: name.to_string(),
            prefix: memora_gateway::key_prefix(&raw),
            hash,
            scopes,
            tools,
        },
        raw,
    }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/// One live browser session.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct SessionView {
    pub sid_hash: String,
    pub short_id: String,
    pub source: String,
    pub ip: String,
    pub user_agent: String,
    pub created: i64,
    pub last_seen: i64,
}

/// Live sessions (idle timeout and absolute cap applied), most recently active first.
pub(crate) fn sessions(ctx: &Ctx) -> Result<Vec<SessionView>> {
    read(ctx, |c| {
        let s = settings::get(c)?;
        let now = memora_state::now();
        let mut rows: Vec<SessionView> = session::list(c)?
            .into_iter()
            .filter(|x| x.is_live(s.session_ttl, s.session_max_age, now))
            .map(|x| SessionView {
                short_id: x.short_id().to_string(),
                source: x.source.clone(),
                ip: x.ip.clone().unwrap_or_else(|| "-".into()),
                user_agent: x.user_agent.clone().unwrap_or_default(),
                created: x.created_at,
                last_seen: x.last_seen,
                sid_hash: x.sid_hash,
            })
            .collect();
        rows.sort_by_key(|r| std::cmp::Reverse(r.last_seen));
        Ok(rows)
    })
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/// One activity log row.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct EventView {
    pub at: i64,
    pub event: String,
    pub ip: Option<String>,
    pub actor: Option<String>,
    pub detail: String,
}

/// Newest `limit` events, or only failures.
pub(crate) fn activity(ctx: &Ctx, limit: usize, failures_only: bool) -> Result<Vec<EventView>> {
    read(ctx, |c| {
        let rows = if failures_only {
            activity::recent_failures(c, limit)?
        } else {
            activity::query(c, limit, &activity::ActivityQuery::default())?
        };
        Ok(rows
            .into_iter()
            .map(|e| EventView {
                at: e.at,
                event: e.event,
                ip: e.ip,
                actor: e.actor,
                detail: e.detail,
            })
            .collect())
    })
}
