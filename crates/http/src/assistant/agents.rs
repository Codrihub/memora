//! The sub-agents of a chat, as Mnemo manages them: each has a name, its own instructions and
//! model, and a state the owner sees in the Agents panel: running, idle (it answered and can
//! take another task), done (its work is over), or removed from the list altogether.
//!
//! Mnemo starts one with `delegate` (waiting for its answer, or in the background) and runs
//! the rest with the `agents` tool: create one ahead of its task, edit its instructions or
//! model (a running one takes them from its next step), send a running one a message, wait for
//! it, stop it, mark it done, reuse an idle one, or remove it.
//!
//! Kept as a preference (`agents`: `{chat: {name: {name, instructions, state, task, answer,
//! at}}}`); what runs now lives in memory.

use memora_state::assistant::Store;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use super::providers::ToolDef;
use super::NAME;

pub(crate) const AGENTS_TOOL: &str = "agents";
pub(crate) const AGENTS: &str = "agents";
const KEEP: usize = 40;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One read-modify-write of the registry at a time (sub-agents finish on their own threads).
fn reg_lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(Default::default)
}

fn all(store: &Store) -> Map<String, Value> {
    store
        .prefs()
        .ok()
        .and_then(|p| p.get(AGENTS).and_then(Value::as_object).cloned())
        .unwrap_or_default()
}

fn save(store: &Store, m: Map<String, Value>) {
    let mut m = m;
    m.retain(|_, v| v.as_object().is_some_and(|o| !o.is_empty()));
    let v = if m.is_empty() {
        Value::Null
    } else {
        Value::Object(m)
    };
    let _ = store.set_pref(AGENTS, &v);
}

/// The chat's sub-agents as kept, by lower-case name.
pub(crate) fn of_chat(store: &Store, chat: &str) -> Map<String, Value> {
    all(store)
        .get(chat)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

/// One sub-agent as kept.
pub(crate) fn get(store: &Store, chat: &str, agent: &str) -> Option<Value> {
    of_chat(store, chat).get(&agent.to_lowercase()).cloned()
}

/// Change one sub-agent's record (created when missing); `None` from `f` removes it.
pub(crate) fn update(
    store: &Store,
    chat: &str,
    agent: &str,
    f: impl FnOnce(Option<Value>) -> Option<Value>,
) -> Option<Value> {
    let _g = lock(reg_lock());
    let mut m = all(store);
    let mut c = m
        .get(chat)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let k = agent.to_lowercase();
    let mut out = f(c.get(&k).cloned());
    // Every sub-agent gets a short id of its own that never changes (a1, a2, …), so Mnemo
    // and the owner can name it by id whatever it is called.
    if let Some(v) = out.as_mut().filter(|_| !k.starts_with('~')) {
        if v["id"].as_str().unwrap_or("").is_empty() {
            let n = c
                .values()
                .filter_map(|x| x["id"].as_str()?.strip_prefix('a')?.parse::<u32>().ok())
                .max()
                .unwrap_or(0);
            v["id"] = json!(format!("a{}", n + 1));
        }
    }
    match &out {
        Some(v) => {
            c.insert(k, v.clone());
        }
        None => {
            c.remove(&k);
        }
    }
    // A chat keeps its newest few dozen.
    if c.len() > KEEP {
        let mut by: Vec<(String, i64)> = c
            .iter()
            .map(|(k, v)| (k.clone(), v["at"].as_i64().unwrap_or(0)))
            .collect();
        by.sort_by_key(|x| x.1);
        for (k, _) in by.into_iter().take(c.len() - KEEP) {
            c.remove(&k);
        }
    }
    m.insert(chat.to_string(), Value::Object(c));
    save(store, m);
    out
}

/// A sub-agent's own instructions from Mnemo (empty when none).
pub(crate) fn instructions(store: &Store, chat: &str, agent: &str) -> String {
    get(store, chat, agent)
        .and_then(|v| v["instructions"].as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Forget every sub-agent of a deleted chat.
pub(crate) fn forget_chat(store: &Store, chat: &str) {
    let _g = lock(reg_lock());
    let mut m = all(store);
    if m.remove(chat).is_some() {
        save(store, m);
    }
    lock(running()).retain(|(c, _), _| c != chat);
}

// ---- what runs now ----

/// A sub-agent at work: how to stop it, messages from Mnemo for its next step, and its
/// answer once it has one (for `wait`).
#[derive(Clone, Default)]
pub(crate) struct Live {
    pub stop: Arc<AtomicBool>,
    pub inbox: Arc<Mutex<Vec<String>>>,
    pub call: String,
    pub result: Arc<Mutex<Option<Result<Value, String>>>>,
    pub background: bool,
}

type Running = Mutex<HashMap<(String, String), Live>>;

fn running() -> &'static Running {
    static R: OnceLock<Running> = OnceLock::new();
    R.get_or_init(Default::default)
}

/// Mark a sub-agent as started (its stop flag and inbox).
pub(crate) fn begin(chat: &str, agent: &str, call: &str, background: bool) -> Live {
    let l = Live {
        call: call.to_string(),
        background,
        ..Default::default()
    };
    lock(running()).insert((chat.to_string(), agent.to_lowercase()), l.clone());
    l
}

/// The sub-agent finished (or stopped): its answer is kept for `wait`, then it is idle.
pub(crate) fn finish(
    store: &Store,
    chat: &str,
    agent: &str,
    call: &str,
    r: &Result<Value, String>,
) {
    let k = (chat.to_string(), agent.to_lowercase());
    let keep_running = {
        let mut m = lock(running());
        match m.get(&k) {
            // A newer run of the same name took over: leave it be.
            Some(l) if l.call != call => true,
            Some(l) => {
                *lock(&l.result) = Some(r.clone());
                // Cut with its reply: nothing for a later wait to collect.
                if !l.background || matches!(r, Err(e) if e == "stopped") {
                    m.remove(&k);
                }
                false
            }
            None => false,
        }
    };
    if keep_running {
        return;
    }
    let answer: String = match r {
        Ok(v) => v["answer"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(600)
            .collect(),
        Err(e) => format!("({e})"),
    };
    update(store, chat, agent, |old| {
        // Removed while it ran: it stays gone.
        let mut v = old?;
        if v["state"] != "done" {
            v["state"] = json!("idle");
        }
        v["answer"] = json!(answer);
        v["at"] = json!(memora_state::now());
        Some(v)
    });
}

/// Whether a sub-agent is running now.
pub(crate) fn is_running(chat: &str, agent: &str) -> bool {
    lock(running())
        .get(&(chat.to_string(), agent.to_lowercase()))
        .is_some_and(|l| lock(&l.result).is_none())
}

/// The sub-agent at work under this name, if any.
pub(crate) fn live(chat: &str, agent: &str) -> Option<Live> {
    lock(running())
        .get(&(chat.to_string(), agent.to_lowercase()))
        .cloned()
}

/// Messages from Mnemo waiting for this sub-agent's next step.
pub(crate) fn take_inbox(live: &Live) -> Vec<String> {
    std::mem::take(&mut *lock(&live.inbox))
}

/// Background sub-agents of this chat whose answers Mnemo has not collected yet (finished or
/// not), oldest first: `(agent, call)`.
pub(crate) fn pending(chat: &str) -> Vec<(String, String)> {
    lock(running())
        .iter()
        .filter(|((c, _), l)| c == chat && l.background)
        .map(|((_, a), l)| (a.clone(), l.call.clone()))
        .collect()
}

/// Wait for these background sub-agents (all of the chat's when `names` is empty) up to
/// `secs`, or until `gone()`; their answers, collected (a finished one leaves the list).
pub(crate) fn wait(
    store: &Store,
    chat: &str,
    names: &[String],
    secs: u64,
    gone: &dyn Fn() -> bool,
) -> Value {
    let want: Vec<String> = if names.is_empty() {
        pending(chat).into_iter().map(|x| x.0).collect()
    } else {
        names.iter().map(|n| n.to_lowercase()).collect()
    };
    let until = std::time::Instant::now() + std::time::Duration::from_secs(secs.clamp(1, 900));
    loop {
        let open = want
            .iter()
            .filter(|a| live(chat, a).is_some_and(|l| l.background && lock(&l.result).is_none()))
            .count();
        if open == 0 || gone() || std::time::Instant::now() >= until {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
    let mut results = Vec::new();
    let mut still = Vec::new();
    for a in &want {
        let Some(l) = live(chat, a) else {
            continue;
        };
        if !l.background {
            continue;
        }
        let got = lock(&l.result).clone();
        let name = get(store, chat, a)
            .and_then(|v| v["name"].as_str().map(str::to_string))
            .unwrap_or_else(|| a.clone());
        match got {
            Some(r) => {
                lock(running()).remove(&(chat.to_string(), a.clone()));
                results.push(match r {
                    Ok(v) => json!({"agent": name, "call_id": l.call, "ok": true, "answer": v["answer"], "model": v["model"], "steps": v["steps"]}),
                    Err(e) => json!({"agent": name, "call_id": l.call, "ok": false, "error": e}),
                });
            }
            None => still.push(json!(name)),
        }
    }
    json!({"results": results, "still_running": still})
}

// ---- the agents tool ----

pub(crate) fn def() -> ToolDef {
    ToolDef {
        name: AGENTS_TOOL.into(),
        description: format!(
            "Manage your sub-agents in this chat (start them with delegate). The owner sees each one in the \
Agents panel as running, idle (answered, can take another task) or done.\n\
action:\n\
- list: every sub-agent with its state, model, instructions, last task and answer.\n\
- create: set up a named sub-agent before its first task (instructions, model); it waits idle.\n\
- edit: change its instructions, model (provider/model, or \"default\") or name; a running one takes the \
change from its next step. Leave a field empty to keep it.\n\
- message: tell a running sub-agent something (a correction, more detail); it reads it at its next step. For \
an idle one, give it a new task with delegate (follow_up: true keeps its earlier conversation).\n\
- wait: wait for sub-agents started with delegate wait: false and get their answers (agents: names, default \
all; seconds, default 300).\n\
- stop: stop running sub-agents at once; they become idle and can be reused.\n\
- done: its work is over; it moves to Done and is not reused (a later delegate with the same name brings it \
back).\n\
- remove: take it off the list altogether (stopping it if it runs) and forget its conversation.\n\
Every sub-agent has an id that never changes (a1, a2, …; list shows them): point at one with id, or at several \
with agents (ids, or [\"all\"] for every one); a name works too. Rename freely with edit rename.\n\
Keep the list tidy: when a sub-agent's work is finished and you will not need it again in this chat, mark it \
done; remove ones that were a mistake. {NAME} alone manages them; sub-agents cannot."
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "create", "edit", "message", "wait", "stop", "done", "remove"]},
                "id": {"type": "string", "description": "The sub-agent's id from list (a1, a2, …): the surest way to point at one"},
                "agent": {"type": "string", "description": "create: its name. Otherwise its name when you do not give id"},
                "agents": {"type": "array", "items": {"type": "string"}, "description": "stop/done/remove/wait: several ids (or names) at once ([\"all\"]: every one); wait defaults to every one in the background"},
                "instructions": {"type": "string", "description": "create/edit: how it should work (its role, rules, the form of its answers)"},
                "model": {"type": "string", "description": "create/edit: provider/model from the delegate list, or \"default\"; empty keeps it"},
                "rename": {"type": "string", "description": "edit: a new name"},
                "text": {"type": "string", "description": "message: what to tell it"},
                "seconds": {"type": "integer", "description": "wait: the longest to wait, default 300"}
            },
            "required": ["action"],
            "additionalProperties": false
        }),
    }
}

/// The sub-agent an action is for: by id (preferred), else by name.
fn pick(store: &Store, chat: &str, args: &Value) -> Result<String, String> {
    if let Some(i) = args["id"].as_str().map(str::trim).filter(|i| !i.is_empty()) {
        return resolve(store, chat, i).ok_or_else(|| {
            format!(
                "there is no sub-agent {i} in this chat. Sub-agents in this chat: {}",
                known(store, chat)
            )
        });
    }
    let given = name_of(args)?;
    Ok(resolve(store, chat, &given).unwrap_or(given))
}

fn name_of(args: &Value) -> Result<String, String> {
    let n: String = args["agent"]
        .as_str()
        .unwrap_or("")
        .trim()
        .chars()
        .take(24)
        .collect();
    if n.is_empty() {
        Err("give agent, the sub-agent's name".into())
    } else {
        Ok(n)
    }
}

fn clip(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

/// The kept sub-agent a name means, as its own name: exact (any case), else the name before
/// stray words ("Reader (idle)", "Audit-1 n/a"), else the only one it starts with.
pub(crate) fn resolve(store: &Store, chat: &str, given: &str) -> Option<String> {
    let m = of_chat(store, chat);
    let names: Vec<String> = m
        .iter()
        .filter(|(k, _)| !k.starts_with('~'))
        .map(|(k, v)| v["name"].as_str().unwrap_or(k).to_string())
        .collect();
    let g = given
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'' || c == '`' || c == '#')
        .to_lowercase();
    if g.is_empty() {
        return None;
    }
    if let Some((k, v)) = m.iter().find(|(k, v)| {
        !k.starts_with('~') && v["id"].as_str().is_some_and(|i| i.eq_ignore_ascii_case(&g))
    }) {
        return Some(v["name"].as_str().unwrap_or(k).to_string());
    }
    if let Some(n) = names.iter().find(|n| n.to_lowercase() == g) {
        return Some(n.clone());
    }
    let head = g
        .split(|c: char| c.is_whitespace() || c == '(' || c == ',')
        .next()
        .unwrap_or("");
    if let Some(n) = names
        .iter()
        .find(|n| !head.is_empty() && n.to_lowercase() == head)
    {
        return Some(n.clone());
    }
    let starts: Vec<&String> = names
        .iter()
        .filter(|n| g.starts_with(&n.to_lowercase()))
        .collect();
    if starts.len() == 1 {
        return Some(starts[0].clone());
    }
    None
}

/// Every name kept for the chat (for an error that helps Mnemo pick the right one).
fn known(store: &Store, chat: &str) -> String {
    let mut v: Vec<String> = of_chat(store, chat)
        .iter()
        .filter(|(k, _)| !k.starts_with('~'))
        .map(|(k, v)| {
            format!(
                "{} ({})",
                v["id"].as_str().unwrap_or("?"),
                v["name"].as_str().unwrap_or(k)
            )
        })
        .collect();
    v.sort();
    if v.is_empty() {
        "none yet".into()
    } else {
        v.join(", ")
    }
}

/// The sub-agents a stop, done or remove is for: the names in agents (or "all"), else agent.
fn targets(store: &Store, chat: &str, args: &Value) -> Result<Vec<String>, String> {
    let mut asked: Vec<String> = args["agents"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if asked.is_empty() {
        if let Some(i) = args["id"].as_str().filter(|i| !i.trim().is_empty()) {
            asked.push(i.to_string());
        } else {
            asked.push(args["agent"].as_str().unwrap_or("").to_string());
        }
    }
    let all = asked.iter().any(|a| {
        matches!(
            a.trim().to_lowercase().as_str(),
            "all" | "*" | "every" | "everyone"
        )
    });
    if all {
        let mut v: Vec<String> = of_chat(store, chat)
            .iter()
            .filter(|(k, _)| !k.starts_with('~'))
            .map(|(k, v)| v["name"].as_str().unwrap_or(k).to_string())
            .collect();
        v.sort();
        return Ok(v);
    }
    let mut out = Vec::new();
    let mut missing = Vec::new();
    for a in asked.iter().map(|a| a.trim()).filter(|a| !a.is_empty()) {
        match resolve(store, chat, a) {
            Some(n) if !out.contains(&n) => out.push(n),
            Some(_) => {}
            None => missing.push(a.to_string()),
        }
    }
    if out.is_empty() {
        return Err(if missing.is_empty() {
            format!(
                "give agent (a name) or agents (names, or [\"all\"]). Sub-agents in this chat: {}",
                known(store, chat)
            )
        } else {
            format!(
                "no sub-agent named {} in this chat. Sub-agents in this chat: {}",
                missing.join(", "),
                known(store, chat)
            )
        });
    }
    Ok(out)
}

/// One call of the agents tool. `emit` tells the chat (the Agents panel) what changed.
pub(crate) fn run(
    st: &crate::AppState,
    store: &Store,
    chat: &str,
    args: &Value,
    gone: &dyn Fn() -> bool,
    emit: &dyn Fn(Value),
) -> Result<Value, String> {
    let action = args["action"].as_str().unwrap_or("");
    let now = memora_state::now();
    seed(store, chat);
    match action {
        "list" => {
            let m = of_chat(store, chat);
            let mut list: Vec<Value> = m
                .iter()
                .filter(|(k, _)| !k.starts_with('~'))
                .map(|(_, v)| {
                    let name = v["name"].as_str().unwrap_or("");
                    let state = if is_running(chat, name) {
                        "running"
                    } else {
                        v["state"].as_str().unwrap_or("idle")
                    };
                    json!({
                        "id": v["id"],
                        "agent": name,
                        "state": state,
                        "model": super::roles::sub_model(store, chat, name).unwrap_or_else(|| "default".into()),
                        "instructions": v["instructions"],
                        "last_task": clip(v["task"].as_str().unwrap_or(""), 200),
                        "last_answer": clip(v["answer"].as_str().unwrap_or(""), 300),
                    })
                })
                .collect();
            list.sort_by_key(|a| {
                a["id"]
                    .as_str()
                    .and_then(|i| i.trim_start_matches('a').parse::<u32>().ok())
                    .unwrap_or(0)
            });
            Ok(json!({"agents": list}))
        }
        "create" | "edit" => {
            let name = pick(store, chat, args)?;
            let exists = get(store, chat, &name).is_some();
            if action == "edit" && !exists {
                return Err(format!(
                    "there is no sub-agent {name} in this chat. Sub-agents in this chat: {}",
                    known(store, chat)
                ));
            }
            // An empty field means "leave it"; "default" puts the model back to the default.
            if let Some(m) = args["model"]
                .as_str()
                .map(str::trim)
                .filter(|m| !m.is_empty())
            {
                let m = if m.eq_ignore_ascii_case("default") {
                    ""
                } else {
                    m
                };
                super::roles::set_sub_model(st, store, chat, &name, m)?;
            }
            let mut new_name = name.clone();
            if let Some(r) = args["rename"]
                .as_str()
                .map(|r| clip(r, 24))
                .filter(|r| !r.is_empty())
            {
                if r.to_lowercase() != name.to_lowercase() {
                    if get(store, chat, &r).is_some() {
                        return Err(format!("{r} is taken already"));
                    }
                    if is_running(chat, &name) {
                        return Err(format!("{name} is running; rename it once it answered"));
                    }
                    let old = update(store, chat, &name, |_| None);
                    super::roles::rename_thread(chat, &name, &r);
                    super::roles::move_sub_model(store, chat, &name, &r);
                    update(store, chat, &r, |_| old.clone());
                }
                new_name = r;
            }
            let ins = args["instructions"]
                .as_str()
                .map(|s| clip(s, 4000))
                .filter(|s| !s.is_empty());
            let v = update(store, chat, &new_name, |old| {
                let mut v =
                    old.unwrap_or_else(|| json!({"state": "idle", "task": "", "answer": ""}));
                v["name"] = json!(new_name);
                if let Some(i) = &ins {
                    v["instructions"] = json!(i);
                }
                v["at"] = json!(now);
                Some(v)
            })
            .unwrap_or(Value::Null);
            emit(
                json!({"phase": "meta", "id": v["id"], "agent": new_name, "from": name, "instructions": v["instructions"], "state": if is_running(chat, &new_name) { "running" } else { v["state"].as_str().unwrap_or("idle") }, "model": super::roles::sub_model(store, chat, &new_name)}),
            );
            Ok(json!({"ok": true, "id": v["id"], "agent": new_name, "created": !exists}))
        }
        "message" => {
            let name = pick(store, chat, args)?;
            let text = clip(args["text"].as_str().unwrap_or(""), 4000);
            if text.is_empty() {
                return Err("give text".into());
            }
            match live(chat, &name).filter(|l| lock(&l.result).is_none()) {
                Some(l) => {
                    lock(&l.inbox).push(text.clone());
                    emit(json!({"phase": "message", "agent": name, "call": l.call, "text": text}));
                    Ok(json!({"ok": true, "note": "it reads it at its next step"}))
                }
                None => Err(format!(
                    "{name} is not running; give it a task with delegate (follow_up: true to go on with its conversation)"
                )),
            }
        }
        "wait" => {
            let names: Vec<String> = args["agents"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let secs = args["seconds"].as_u64().unwrap_or(300);
            Ok(wait(store, chat, &names, secs, gone))
        }
        "stop" | "done" | "remove" => {
            let names = targets(store, chat, args)?;
            let mut done = Vec::new();
            let mut skipped = Vec::new();
            for name in names {
                let running_now = live(chat, &name).filter(|l| lock(&l.result).is_none());
                match action {
                    "stop" => match running_now {
                        Some(l) => {
                            l.stop.store(true, Ordering::SeqCst);
                            done.push(name);
                        }
                        None => skipped.push(json!({"agent": name, "why": "not running"})),
                    },
                    "done" => {
                        if let Some(l) = running_now {
                            l.stop.store(true, Ordering::SeqCst);
                        }
                        let v = update(store, chat, &name, |old| {
                            let mut v = old?;
                            v["state"] = json!("done");
                            v["at"] = json!(now);
                            Some(v)
                        });
                        if v.is_some() {
                            emit(json!({"phase": "state", "agent": name, "state": "done"}));
                            done.push(name);
                        }
                    }
                    _ => {
                        if let Some(l) = live(chat, &name) {
                            l.stop.store(true, Ordering::SeqCst);
                        }
                        lock(running()).remove(&(chat.to_string(), name.to_lowercase()));
                        update(store, chat, &name, |_| None);
                        super::roles::forget_thread(chat, &name);
                        let _ = super::roles::set_sub_model(st, store, chat, &name, "");
                        // Its cards leave the panel (and stay away after a reload).
                        update(store, chat, &format!("~{}", name.to_lowercase()), |_| {
                            Some(json!({"name": name, "state": "removed", "at": now}))
                        });
                        emit(json!({"phase": "state", "agent": name, "state": "removed"}));
                        done.push(name);
                    }
                }
            }
            let state = match action {
                "stop" => "stopped (now idle)",
                "done" => "done",
                _ => "removed",
            };
            Ok(
                json!({"ok": !done.is_empty(), "action": action, "agents": done, "state": state, "skipped": skipped}),
            )
        }
        _ => Err("action is list, create, edit, message, wait, stop, done or remove".into()),
    }
}

/// Sub-agents the chat ran before their list was kept (their delegate calls are in the chat):
/// added to the list as idle, with their last task and answer, so Mnemo can manage them.
pub(crate) fn seed(store: &Store, chat: &str) {
    let have = of_chat(store, chat);
    let msgs = store.messages(chat).unwrap_or_default();
    // name -> (task, call id, time), the latest run of each name.
    let mut runs: HashMap<String, (String, String, String, i64)> = HashMap::new();
    for m in &msgs {
        if m.role != "assistant" {
            continue;
        }
        for c in m
            .tool_calls
            .as_ref()
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if c["name"] != super::roles::DELEGATE {
                continue;
            }
            let args = &c["arguments"];
            let raw = args["agent"].as_str().unwrap_or("").trim();
            let name: String = if raw.is_empty() { "Helper" } else { raw }
                .chars()
                .take(24)
                .collect();
            runs.insert(
                name.to_lowercase(),
                (
                    name,
                    clip(args["task"].as_str().unwrap_or(""), 2000),
                    c["id"].as_str().unwrap_or("").to_string(),
                    m.created_at,
                ),
            );
        }
    }
    let mut runs: Vec<_> = runs.into_iter().collect();
    // Oldest first, so the ids follow the order they were started in.
    runs.sort_by_key(|(_, r)| r.3);
    for (k, (name, task, call, at)) in runs {
        if have.contains_key(&k) || have.contains_key(&format!("~{k}")) {
            continue;
        }
        let answer: String = msgs
            .iter()
            .find(|m| m.role == "tool" && m.tool_call_id.as_deref() == Some(call.as_str()))
            .and_then(|m| serde_json::from_str::<Value>(&m.content).ok())
            .and_then(|v| v["answer"].as_str().map(|a| clip(a, 600)))
            .unwrap_or_default();
        update(store, chat, &name, |old| {
            old.or_else(|| {
                Some(json!({"name": name, "state": "idle", "instructions": "", "task": task, "answer": answer, "at": at}))
            })
        });
    }
}

/// A sub-agent starts a task: its record (created when new) says running, with the task.
pub(crate) fn started(store: &Store, chat: &str, agent: &str, task: &str) {
    let now = memora_state::now();
    // A name used again after it was removed comes back.
    update(store, chat, &format!("~{}", agent.to_lowercase()), |_| None);
    update(store, chat, agent, |old| {
        let mut v = old.unwrap_or_else(|| json!({"instructions": ""}));
        v["name"] = json!(agent);
        v["state"] = json!("running");
        v["task"] = json!(clip(task, 2000));
        v["answer"] = json!("");
        v["at"] = json!(now);
        Some(v)
    });
}

/// What the chat's page needs for its Agents panel: each kept sub-agent's state and
/// instructions, and the names removed from the list.
pub(crate) fn panel_json(store: &Store, chat: &str) -> Value {
    let m = of_chat(store, chat);
    let mut agents = Vec::new();
    let mut removed = Vec::new();
    for (k, v) in &m {
        let name = v["name"].as_str().unwrap_or(k).to_string();
        if k.starts_with('~') {
            removed.push(json!(name));
            continue;
        }
        let state = if is_running(chat, &name) {
            "running".to_string()
        } else {
            match v["state"].as_str() {
                Some("running") | None => "idle".to_string(),
                Some(s) => s.to_string(),
            }
        };
        agents.push(json!({"id": v["id"], "agent": name, "state": state, "instructions": v["instructions"]}));
    }
    json!({"agents": agents, "removed": removed})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_states() {
        let store = Store::open_memory().unwrap();
        started(&store, "c", "Reader", "read it");
        assert_eq!(get(&store, "c", "reader").unwrap()["state"], "running");
        begin("c", "Reader", "k1", true);
        finish(&store, "c", "Reader", "k1", &Ok(json!({"answer": "fine"})));
        assert_eq!(get(&store, "c", "Reader").unwrap()["state"], "idle");
        let w = wait(&store, "c", &[], 1, &|| false);
        assert_eq!(w["results"][0]["answer"], "fine");
        assert!(pending("c").is_empty());
        let p = panel_json(&store, "c");
        assert_eq!(p["agents"][0]["state"], "idle");
    }

    #[test]
    fn bulk_done_and_loose_names() {
        let store = Store::open_memory().unwrap();
        started(&store, "c", "Audit-Referensi", "a");
        started(&store, "c", "Deep-01", "b");
        assert_eq!(
            resolve(&store, "c", "Audit-Referensi n/a").as_deref(),
            Some("Audit-Referensi")
        );
        assert_eq!(resolve(&store, "c", "deep-01").as_deref(), Some("Deep-01"));
        assert_eq!(get(&store, "c", "Deep-01").unwrap()["id"], "a2");
        assert_eq!(resolve(&store, "c", "A2").as_deref(), Some("Deep-01"));
        let t = targets(&store, "c", &json!({"agent": "x", "agents": ["all"]})).unwrap();
        assert_eq!(t.len(), 2);
        assert!(targets(&store, "c", &json!({"agent": "nobody"}))
            .unwrap_err()
            .contains("Deep-01"));
    }

    #[test]
    fn seeds_from_the_chat() {
        use memora_state::assistant::NewMessage;
        let store = Store::open_memory().unwrap();
        let sid = "s1".to_string();
        store.create_session(&sid, "t", "global", "", 1).unwrap();
        store
            .append(
                &sid,
                &NewMessage {
                    role: "assistant".into(),
                    tool_calls: Some(json!([{"id": "d1", "name": "delegate", "arguments": {"agent": "Audit-1", "task": "check"}}])),
                    ..Default::default()
                },
                2,
            )
            .unwrap();
        seed(&store, &sid);
        let v = get(&store, &sid, "audit-1").unwrap();
        assert_eq!(v["state"], "idle");
        assert_eq!(v["task"], "check");
    }
}
