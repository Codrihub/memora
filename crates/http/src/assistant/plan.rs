//! Mnemo's plan for a chat: a checklist that belongs to the chat, not to one reply. Mnemo
//! writes it with `update_plan` (the whole list, or adding, editing, checking and removing
//! single steps), the owner sees it above the message box as it changes, and it stays as it
//! is when a reply is stopped, so the next reply carries on from it. Once every step is
//! done it closes. Kept as a preference (`plans`: `{chat: [{text, status}]}`).

use super::live;
use memora_state::assistant::Store;
use serde_json::{json, Map, Value};

use super::providers::ToolDef;

pub(crate) const UPDATE_PLAN: &str = "update_plan";
pub(crate) const PLANS: &str = "plans";
const PLAN_MAX: usize = 12;
const STATUSES: [&str; 3] = ["pending", "in_progress", "done"];

fn all(store: &Store) -> Map<String, Value> {
    store
        .prefs()
        .ok()
        .and_then(|p| p.get(PLANS).and_then(Value::as_object).cloned())
        .unwrap_or_default()
}

/// The chat's open plan (empty when there is none).
pub(crate) fn get(store: &Store, chat: &str) -> Vec<Value> {
    all(store)
        .get(chat)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn put(store: &Store, chat: &str, steps: &[Value]) {
    let mut m = all(store);
    if steps.is_empty() {
        m.remove(chat);
    } else {
        m.insert(chat.to_string(), json!(steps));
    }
    let _ = store.set_pref(PLANS, &Value::Object(m));
}

/// Close the chat's plan (the owner cleared it, or the chat was deleted), telling every tab.
pub(crate) fn clear(store: &Store, chat: &str) {
    if get(store, chat).is_empty() {
        return;
    }
    put(store, chat, &[]);
    live::notify(chat, &json!({"type": "plan", "steps": []}));
}

pub(crate) fn def() -> ToolDef {
    ToolDef {
        name: UPDATE_PLAN.into(),
        description: format!(
            "Your plan for this chat, shown to the owner as a live checklist above the message box. Use it for a \
task of three or more steps (an audit of many notes, a reorganisation, a long edit). The plan belongs to the \
chat: it stays when a reply is stopped and you see it again next turn, so carry on from it, change it or clear \
it. Write the whole list with steps, or change it a little: add new steps (after a step number, default at the \
end), set a step's text or status by its number, remove steps by number, or clear it. Mark a step in_progress \
as you start it and done as soon as it is done, one call per change, so the owner follows along; when every \
step is done the plan closes by itself. At most {PLAN_MAX} steps of a few words each, in the owner's language. \
Skip it for short tasks."
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "maxItems": PLAN_MAX,
                    "description": "The whole plan, replacing the one there is",
                    "items": step_schema()
                },
                "add": {
                    "type": "array",
                    "description": "Steps to add",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string", "description": "The step, a few words"},
                            "status": {"type": "string", "enum": STATUSES},
                            "after": {"type": "integer", "description": "Put it after this step number (0: first); default last"}
                        },
                        "required": ["text"],
                        "additionalProperties": false
                    }
                },
                "set": {
                    "type": "array",
                    "description": "Steps to change, by number (1 is the first)",
                    "items": {
                        "type": "object",
                        "properties": {
                            "n": {"type": "integer"},
                            "text": {"type": "string"},
                            "status": {"type": "string", "enum": STATUSES}
                        },
                        "required": ["n"],
                        "additionalProperties": false
                    }
                },
                "remove": {"type": "array", "items": {"type": "integer"}, "description": "Step numbers to take out"},
                "clear": {"type": "boolean", "description": "true: close the plan (the task changed or was dropped)"}
            },
            "additionalProperties": false
        }),
    }
}

fn step_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "The step, a few words"},
            "status": {"type": "string", "enum": STATUSES}
        },
        "required": ["text", "status"],
        "additionalProperties": false
    })
}

fn text_of(v: &Value) -> Result<String, String> {
    let t: String = v
        .as_str()
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(120)
        .collect();
    if t.is_empty() {
        Err("each step needs text".into())
    } else {
        Ok(t)
    }
}

fn status_of(v: &Value, default: &str) -> Result<String, String> {
    match v.as_str() {
        None => Ok(default.to_string()),
        Some(s) if STATUSES.contains(&s) => Ok(s.to_string()),
        Some(_) => Err("a status is pending, in_progress or done".into()),
    }
}

/// Apply one update_plan call to chat `chat`: the plan as it is now, numbered, for Mnemo, and
/// `steps` for the checklist (empty once it closed). Every tab of the chat hears of it.
pub(crate) fn run(store: &Store, chat: &str, args: &Value) -> Result<Value, String> {
    let mut steps: Vec<Value> = get(store, chat);
    let mut touched = false;
    if args["clear"].as_bool() == Some(true) {
        steps.clear();
        touched = true;
    }
    if let Some(list) = args["steps"].as_array() {
        steps = list
            .iter()
            .map(|s| {
                Ok(json!({"text": text_of(&s["text"])?, "status": status_of(&s["status"], "pending")?}))
            })
            .collect::<Result<_, String>>()?;
        touched = true;
    }
    // Numbers refer to the plan as it was before this call: set, then remove, then add.
    if let Some(list) = args["set"].as_array() {
        for s in list {
            let n = s["n"].as_u64().unwrap_or(0) as usize;
            let Some(step) = n.checked_sub(1).and_then(|i| steps.get_mut(i)) else {
                return Err(format!("there is no step {n}"));
            };
            if !s["text"].is_null() {
                step["text"] = json!(text_of(&s["text"])?);
            }
            if !s["status"].is_null() {
                step["status"] = json!(status_of(&s["status"], "pending")?);
            }
            touched = true;
        }
    }
    if let Some(list) = args["remove"].as_array() {
        let mut ns: Vec<usize> = list
            .iter()
            .filter_map(Value::as_u64)
            .map(|n| n as usize)
            .collect();
        ns.sort_unstable();
        ns.dedup();
        for n in ns.into_iter().rev() {
            if n == 0 || n > steps.len() {
                return Err(format!("there is no step {n}"));
            }
            steps.remove(n - 1);
            touched = true;
        }
    }
    if let Some(list) = args["add"].as_array() {
        // Added from the last so each "after" still points at the step it named.
        let mut adds: Vec<(usize, Value)> = Vec::new();
        for s in list {
            let at = s["after"]
                .as_u64()
                .map(|n| (n as usize).min(steps.len()))
                .unwrap_or(steps.len());
            adds.push((
                at,
                json!({"text": text_of(&s["text"])?, "status": status_of(&s["status"], "pending")?}),
            ));
        }
        for (k, (at, v)) in adds.into_iter().enumerate() {
            steps.insert((at + k).min(steps.len()), v);
            touched = true;
        }
    }
    if !touched {
        return Err("give steps, add, set, remove or clear".into());
    }
    if steps.len() > PLAN_MAX {
        return Err(format!("a plan has at most {PLAN_MAX} steps"));
    }
    let done = steps.iter().filter(|s| s["status"] == "done").count();
    let closed = !steps.is_empty() && done == steps.len();
    let total = steps.len();
    let numbered: Vec<Value> = steps
        .iter()
        .enumerate()
        .map(|(i, s)| json!({"n": i + 1, "text": s["text"], "status": s["status"]}))
        .collect();
    let kept: Vec<Value> = if closed { Vec::new() } else { steps };
    put(store, chat, &kept);
    live::notify(chat, &json!({"type": "plan", "steps": kept}));
    Ok(json!({
        "ok": true,
        "plan": numbered,
        "steps": kept,
        "done": done,
        "total": total,
        "closed": closed || total == 0,
        "note": if closed { "every step is done: the plan is closed" } else if total == 0 { "the plan is closed" } else { "" },
    }))
}

/// The open plan, for Mnemo's system prompt, so a stopped or earlier reply's plan carries on.
pub(crate) fn prompt_text(store: &Store, chat: &str) -> Option<String> {
    let steps = get(store, chat);
    if steps.is_empty() {
        return None;
    }
    let lines: Vec<String> = steps
        .iter()
        .enumerate()
        .map(|(i, s)| {
            format!(
                "{}. [{}] {}",
                i + 1,
                s["status"].as_str().unwrap_or("pending"),
                s["text"].as_str().unwrap_or("")
            )
        })
        .collect();
    Some(format!(
        "Your plan in this chat, still open (the owner sees it above the message box; keep it true with \
update_plan, or clear it if the owner moved on):\n{}",
        lines.join("\n")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_and_closes() {
        let store = Store::open_memory().unwrap();
        let r = run(
            &store,
            "c",
            &json!({"steps": [{"text": "a", "status": "in_progress"}, {"text": "b", "status": "pending"}]}),
        )
        .unwrap();
        assert_eq!(r["total"], 2);
        run(&store, "c", &json!({"add": [{"text": "x", "after": 1}]})).unwrap();
        let p = get(&store, "c");
        assert_eq!(p[1]["text"], "x");
        run(
            &store,
            "c",
            &json!({"remove": [2], "set": [{"n": 1, "text": "A"}]}),
        )
        .unwrap();
        let p = get(&store, "c");
        assert_eq!(p.len(), 2);
        assert_eq!(p[0]["text"], "A");
        let r = run(
            &store,
            "c",
            &json!({"set": [{"n": 1, "status": "done"}, {"n": 2, "status": "done"}]}),
        )
        .unwrap();
        assert_eq!(r["closed"], true);
        assert!(get(&store, "c").is_empty());
        assert!(run(&store, "c", &json!({"set": [{"n": 5, "status": "done"}]})).is_err());
    }
}
