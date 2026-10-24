//! Per-agent privacy on the MCP side: the [`PathView`] an API-key caller works under
//! (fail closed), rule upkeep on store path events, and the JSON shapes shared by the
//! admin tools and `/api/privacy`.

use memora_core::privacy::{PathEvent, PathView};
use memora_state::keys::ApiKey;
use memora_state::privacy::{self as rules, KeyView, Kind, Mode, Rule};
use memora_state::{Connection, Db, Transaction};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::sync::Arc;

/// [`KeyView`] as the store's [`PathView`].
struct View(KeyView);

impl PathView for View {
    fn visible(&self, rel: &str) -> bool {
        self.0.visible(rel)
    }
    fn mentions_hidden(&self, text: &str) -> bool {
        self.0.mentions_hidden(text)
    }
}

/// The view an agent (API key `key_id`) works under: `None` when no rule hides anything
/// from it, a deny-everything view when the rules cannot be read.
pub fn view_for_key(db: &Db, key_id: &str) -> Option<Arc<dyn PathView>> {
    let v = db
        .read(|c| rules::view_for(c, key_id))
        .unwrap_or_else(|_| KeyView::deny_all());
    if v.is_unrestricted() {
        None
    } else {
        Some(Arc::new(View(v)))
    }
}

/// Apply one store path event to the rules (inside `tx`).
pub fn apply_event(tx: &Transaction<'_>, ev: &PathEvent) -> memora_state::Result<usize> {
    let now = memora_state::now();
    match ev {
        PathEvent::Moved { from, to, carry } => {
            let mut n = 0;
            if *carry {
                n += rules::carry(tx, from, to, now)?;
            }
            n += rules::rename_path(tx, from, to, now)?;
            if n > 0 {
                let detail = format!("{from} -> {to} ({n} rule(s))");
                let ev = memora_state::activity::NewActivity {
                    event: "privacy_follow",
                    ip: None,
                    actor: None,
                    detail: &detail,
                };
                memora_state::activity::log(tx, &ev, now)?;
            }
            Ok(n)
        }
        PathEvent::Deleted { path } => rules::forget(tx, path),
    }
}

// ---------------------------------------------------------------------------
// Management (admin tools and /api/privacy)
// ---------------------------------------------------------------------------

/// `{id, name, color}` of a key id (name falls back to the id for unknown keys).
fn key_ref(keys: &[ApiKey], id: &str) -> Value {
    match keys.iter().find(|k| k.id == id) {
        Some(k) => json!({"id": k.id, "name": k.name, "color": k.color}),
        None => json!({"id": id, "name": id, "color": null}),
    }
}

/// One rule as JSON, with key names.
pub fn rule_json(r: &Rule, keys: &[ApiKey]) -> Value {
    json!({
        "id": r.id, "kind": r.kind, "path": r.path, "mode": r.mode,
        "keys": r.keys.iter().map(|k| key_ref(keys, k)).collect::<Vec<_>>(),
        "created_at": r.created_at, "updated_at": r.updated_at,
    })
}

/// `{count, rules:[...], agents:[...]}`: every rule (`GET /api/privacy`, `privacy_list`).
pub fn list_json(conn: &Connection) -> memora_state::Result<Value> {
    let keys = memora_state::keys::list(conn)?;
    let all = rules::list(conn)?;
    Ok(json!({
        "count": all.len(),
        "rules": all.iter().map(|r| rule_json(r, &keys)).collect::<Vec<_>>(),
        "agents": agents_json(&keys),
    }))
}

fn agents_json(keys: &[ApiKey]) -> Vec<Value> {
    keys.iter()
        .map(|k| json!({"id": k.id, "name": k.name, "color": k.color, "enabled": k.enabled}))
        .collect()
}

/// The privacy state of one note or folder: its own rule, the folder rules it inherits,
/// and for every agent whether it can see the path and which rules hide it.
pub fn describe(conn: &Connection, path: &str, kind: Kind) -> memora_state::Result<Value> {
    let p = rules::normalize_path(path)?;
    let keys = memora_state::keys::list(conn)?;
    let covering = rules::covering(conn, &p)?;
    let own_ids: BTreeSet<i64> = rules::get(conn, kind, &p)?.iter().map(|r| r.id).collect();
    let own: Vec<&Rule> = covering
        .iter()
        .filter(|r| own_ids.contains(&r.id))
        .collect();
    let inherited: Vec<&Rule> = covering
        .iter()
        .filter(|r| !own_ids.contains(&r.id))
        .collect();
    let agents: Vec<Value> = keys
        .iter()
        .map(|k| {
            let by: Vec<Value> = covering
                .iter()
                .filter(|r| r.hides_from(&k.id))
                .map(|r| json!({"path": r.path, "kind": r.kind, "own": own_ids.contains(&r.id)}))
                .collect();
            json!({
                "id": k.id, "name": k.name, "color": k.color, "enabled": k.enabled,
                "can_see": by.is_empty(), "hidden_by": by,
            })
        })
        .collect();
    // The rule as the panel edits it: the first own rule (saving replaces them all).
    let editable = own
        .first()
        .map(|r| json!({"mode": r.mode, "keys": r.keys.iter().collect::<Vec<_>>()}));
    Ok(json!({
        "path": p, "kind": kind,
        "own": editable,
        "own_rules": own.iter().map(|r| rule_json(r, &keys)).collect::<Vec<_>>(),
        "inherited": inherited.iter().map(|r| rule_json(r, &keys)).collect::<Vec<_>>(),
        "agents": agents,
        "private": agents.iter().any(|a| a["can_see"] == false),
    }))
}

/// Key ids for a list of key ids or names (exact id, else a unique case-insensitive
/// name among live keys).
pub fn resolve_keys(
    conn: &Connection,
    wanted: &[String],
) -> memora_state::Result<BTreeSet<String>> {
    let keys = memora_state::keys::list(conn)?;
    let mut out = BTreeSet::new();
    for w in wanted {
        let w = w.trim();
        if w.is_empty() {
            continue;
        }
        if let Some(k) = keys.iter().find(|k| k.id == w) {
            out.insert(k.id.clone());
            continue;
        }
        let named: Vec<&ApiKey> = keys
            .iter()
            .filter(|k| k.name.trim().eq_ignore_ascii_case(w))
            .collect();
        match named.as_slice() {
            [k] => {
                out.insert(k.id.clone());
            }
            [] => {
                return Err(memora_state::Error::invalid(
                    "keys",
                    format!("no agent named {w:?}"),
                ))
            }
            _ => {
                return Err(memora_state::Error::invalid(
                    "keys",
                    format!("several agents are named {w:?}; use the key id"),
                ))
            }
        }
    }
    Ok(out)
}

/// Set (replace) the rule on `(kind, path)` and log it; returns [`describe`].
#[allow(clippy::too_many_arguments)]
pub fn set_rule(
    db: &Db,
    kind: Kind,
    path: &str,
    mode: Mode,
    wanted: &[String],
    actor: Option<&str>,
    ip: Option<&str>,
) -> memora_state::Result<Value> {
    db.write(|tx| {
        let keys = resolve_keys(tx, wanted)?;
        let now = memora_state::now();
        let rule = rules::set(tx, kind, path, mode, &keys, now)?;
        let p = rules::normalize_path(path)?;
        let detail = match &rule {
            Some(r) => format!(
                "{} {p}: {} [{}]",
                kind.as_str(),
                mode.as_str(),
                r.keys.iter().cloned().collect::<Vec<_>>().join(", ")
            ),
            None => format!("{} {p}: visible to every agent", kind.as_str()),
        };
        let ev = memora_state::activity::NewActivity {
            event: "privacy_set",
            ip,
            actor,
            detail: &detail,
        };
        memora_state::activity::log(tx, &ev, now)?;
        describe(tx, &p, kind)
    })
}

/// Remove the rule on `(kind, path)` and log it; returns [`describe`] plus `removed`
/// (whether there was a rule to remove).
pub fn clear_rule(
    db: &Db,
    kind: Kind,
    path: &str,
    actor: Option<&str>,
    ip: Option<&str>,
) -> memora_state::Result<Value> {
    db.write(|tx| {
        let p = rules::normalize_path(path)?;
        let n = rules::delete(tx, kind, &p)?;
        if n > 0 {
            let detail = format!("{} {p}", kind.as_str());
            let ev = memora_state::activity::NewActivity {
                event: "privacy_clear",
                ip,
                actor,
                detail: &detail,
            };
            memora_state::activity::log(tx, &ev, memora_state::now())?;
        }
        let mut out = describe(tx, &p, kind)?;
        if let Some(o) = out.as_object_mut() {
            o.insert("removed".into(), json!(n > 0));
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_events_move_and_drop_rules() {
        let db = Db::open_temp().unwrap();
        db.write(|tx| {
            memora_state::keys::create(
                tx,
                &memora_state::keys::NewApiKey {
                    id: "k_c".into(),
                    name: "C".into(),
                    hash: format!("{:064x}", 7),
                    prefix: "mem_c".into(),
                    scopes: memora_state::keys::Scope::default_set(),
                    tools: memora_state::keys::ToolGrant::All,
                },
                1,
            )?;
            rules::set(
                tx,
                Kind::Node,
                "A/x.md",
                Mode::Deny,
                &["k_c".to_string()].into(),
                1,
            )?;
            Ok(())
        })
        .unwrap();
        let hook = crate::path_hook(db.clone());
        hook(&PathEvent::Moved {
            from: "A/x.md".into(),
            to: "B/y.md".into(),
            carry: false,
        });
        let v = view_for_key(&db, "k_c").unwrap();
        assert!(v.visible("A/x.md"));
        assert!(!v.visible("B/y.md"));
        hook(&PathEvent::Deleted {
            path: "B/y.md".into(),
        });
        assert!(view_for_key(&db, "k_c").is_none());
        let d = db.read(|c| describe(c, "B/y.md", Kind::Node)).unwrap();
        assert_eq!(d["private"], false);
        assert_eq!(d["agents"][0]["can_see"], true);
    }
}
