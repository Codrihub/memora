//! What Mnemo knows about the owner: short notes it keeps by itself (how to answer them, who
//! they are, what they like), learned from the conversation, never a system prompt. The owner
//! sees, edits and deletes them in Settings; Mnemo keeps them current with its own tools.
//!
//! Kept as one assistant preference (no schema change). Each message the owner sends carries
//! a snapshot of the notes when they changed since the last one in that chat, so what the
//! model saw earlier in a chat never shifts under it.

use axum::{
    extract::{Path as UrlPath, State},
    http::HeaderMap,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Extension, Router,
};
use memora_state::assistant::Store;
use serde_json::{json, Value};

use super::providers::ToolDef;
use super::{browser_only, fail, store};
use crate::api::{bad, csrf_fail, csrf_ok};
use crate::{ApiKeyCaller, AppState};

/// The notes: `{items: [{id, text, kind, by, at}], seq}`.
pub(crate) const KEY: &str = "owner_memory";
/// Whether Mnemo may learn about the owner (default yes).
pub(crate) const LEARN: &str = "learn_me";

pub(crate) const REMEMBER: &str = "remember_owner";
pub(crate) const UPDATE: &str = "update_owner_memory";
pub(crate) const FORGET: &str = "forget_owner_memory";

const KINDS: &[&str] = &["style", "about", "prefers"];
const MAX_ITEMS: usize = 80;
const MAX_TEXT: usize = 300;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/assistant/memory", get(h_list).post(h_add))
        .route("/api/assistant/memory/{id}", post(h_edit))
        .route("/api/assistant/memory/{id}/delete", post(h_delete))
}

fn load(store: &Store) -> (Vec<Value>, u64) {
    let v = store
        .prefs()
        .ok()
        .and_then(|p| p.get(KEY).cloned())
        .unwrap_or(Value::Null);
    let items = v["items"].as_array().cloned().unwrap_or_default();
    (items, v["seq"].as_u64().unwrap_or(0))
}

fn save(store: &Store, items: &[Value], seq: u64) -> Result<(), String> {
    store.set_pref(KEY, &json!({"items": items, "seq": seq}))
}

pub(crate) fn items(store: &Store) -> Vec<Value> {
    load(store).0
}

pub(crate) fn learning(store: &Store) -> bool {
    store
        .prefs()
        .ok()
        .and_then(|p| p.get(LEARN).and_then(Value::as_bool))
        .unwrap_or(true)
}

fn clean_text(t: &str) -> Result<String, String> {
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        return Err("text is required".into());
    }
    if t.chars().count() > MAX_TEXT {
        return Err(format!("keep it under {MAX_TEXT} characters"));
    }
    Ok(t)
}

fn clean_kind(k: Option<&str>) -> Result<String, String> {
    let k = k.unwrap_or("about");
    if KINDS.contains(&k) {
        Ok(k.to_string())
    } else {
        Err("kind is style, about or prefers".into())
    }
}

pub(crate) fn add(
    store: &Store,
    text: &str,
    kind: Option<&str>,
    by: &str,
) -> Result<Value, String> {
    let text = clean_text(text)?;
    let kind = clean_kind(kind)?;
    let (mut items, seq) = load(store);
    if items.iter().any(|i| {
        i["text"]
            .as_str()
            .is_some_and(|t| t.eq_ignore_ascii_case(&text))
    }) {
        return Err("that is already noted".into());
    }
    if items.len() >= MAX_ITEMS {
        return Err(format!(
            "{MAX_ITEMS} notes is the most: merge or forget older ones first"
        ));
    }
    let seq = seq + 1;
    let item = json!({"id": format!("m{seq}"), "text": text, "kind": kind, "by": by, "at": memora_state::now()});
    items.push(item.clone());
    save(store, &items, seq)?;
    Ok(item)
}

pub(crate) fn edit(
    store: &Store,
    id: &str,
    text: Option<&str>,
    kind: Option<&str>,
    by: &str,
) -> Result<Value, String> {
    let (mut items, seq) = load(store);
    let Some(i) = items.iter_mut().find(|i| i["id"] == id) else {
        return Err(format!("no note {id} about the owner"));
    };
    if let Some(t) = text {
        i["text"] = json!(clean_text(t)?);
    }
    if kind.is_some() {
        i["kind"] = json!(clean_kind(kind)?);
    }
    i["by"] = json!(by);
    i["at"] = json!(memora_state::now());
    let out = i.clone();
    save(store, &items, seq)?;
    Ok(out)
}

pub(crate) fn remove(store: &Store, id: &str) -> Result<(), String> {
    let (mut items, seq) = load(store);
    let n = items.len();
    items.retain(|i| i["id"] != id);
    if items.len() == n {
        return Err(format!("no note {id} about the owner"));
    }
    save(store, &items, seq)
}

/// The notes as the model reads them, grouped, each with its id; empty when there are none.
pub(crate) fn prompt_text(store: &Store) -> String {
    let items = items(store);
    let mut out = String::new();
    for (kind, title) in [
        ("style", "How to answer them"),
        ("about", "About them"),
        ("prefers", "What they like"),
    ] {
        let lines: Vec<String> = items
            .iter()
            .filter(|i| i["kind"] == kind)
            .map(|i| {
                format!(
                    "- [{}] {}{}",
                    i["id"].as_str().unwrap_or(""),
                    i["text"].as_str().unwrap_or(""),
                    if i["by"] == "owner" {
                        " (set by the owner)"
                    } else {
                        ""
                    }
                )
            })
            .collect();
        if !lines.is_empty() {
            out.push_str(&format!("{title}:\n{}\n", lines.join("\n")));
        }
    }
    out.trim_end().to_string()
}

/// How the snapshot reads at the top of the owner's message.
pub(crate) fn intro(notes: &str, learn: bool) -> String {
    let keep = if learn {
        " Keep them current quietly as you learn more: remember_owner for something new and lasting, \
update_owner_memory when it changed, forget_owner_memory when it is wrong. Never mention these tools or \
the notes unless asked."
    } else {
        " The owner turned learning off: use these, do not add to them."
    };
    if notes.is_empty() {
        format!("(Your notes about the owner are empty now.{keep})")
    } else {
        format!(
            "(Your own notes about the owner, learned over time; let them shape how you answer, they are soft \
and may be out of date.{keep}\n{notes})"
        )
    }
}

pub(crate) fn defs() -> Vec<ToolDef> {
    let kind = json!({"type": "string", "enum": KINDS, "description": "style: how they want answers (length, tone, steps, language); about: who they are, their work, people and places; prefers: tastes and habits"});
    vec![
        ToolDef {
            name: REMEMBER.into(),
            description: "Note something lasting you learned about the owner, to answer them better from now on: \
how they like answers (short, step by step, language, tone), who they are, what they like. Only things that will \
still be true next week, in one short sentence; never passwords, keys or other secrets. Do it quietly, without \
telling them, unless they asked you to remember."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {"text": {"type": "string", "description": "One short sentence, e.g. 'Wants one step at a time, not the whole list'"}, "kind": kind},
                "required": ["text", "kind"],
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: UPDATE.into(),
            description: "Change one of your notes about the owner (by its id, e.g. m3) when it changed or was only half right.".into(),
            parameters: json!({
                "type": "object",
                "properties": {"id": {"type": "string"}, "text": {"type": "string"}, "kind": kind},
                "required": ["id"],
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: FORGET.into(),
            description: "Drop one of your notes about the owner (by its id) when it is wrong or they ask you to forget it.".into(),
            parameters: json!({
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": false
            }),
        },
    ]
}

/// Run one of the memory tools for Mnemo.
pub(crate) fn run(store: &Store, name: &str, args: &Value) -> Result<Value, String> {
    let s = |k: &str| args[k].as_str();
    match name {
        REMEMBER => add(store, s("text").unwrap_or(""), s("kind"), "mnemo")
            .map(|i| json!({"ok": true, "item": i})),
        UPDATE => edit(store, s("id").unwrap_or(""), s("text"), s("kind"), "mnemo")
            .map(|i| json!({"ok": true, "item": i})),
        FORGET => {
            let id = s("id").unwrap_or("");
            let text = items(store)
                .into_iter()
                .find(|i| i["id"] == id)
                .and_then(|i| i["text"].as_str().map(str::to_string));
            remove(store, id).map(|_| json!({"ok": true, "id": id, "text": text}))
        }
        _ => Err(format!("{name} is not a memory tool")),
    }
}

async fn h_list(State(st): State<AppState>, key: Option<Extension<ApiKeyCaller>>) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    Json(json!({"items": items(store), "learn": learning(store)})).into_response()
}

async fn h_add(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    match add(
        store,
        b["text"].as_str().unwrap_or(""),
        b["kind"].as_str(),
        "owner",
    ) {
        Ok(i) => Json(json!({"item": i})).into_response(),
        Err(e) => bad(&e),
    }
}

async fn h_edit(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
    Json(b): Json<Value>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    match edit(store, &id, b["text"].as_str(), b["kind"].as_str(), "owner") {
        Ok(i) => Json(json!({"item": i})).into_response(),
        Err(e) => fail(axum::http::StatusCode::NOT_FOUND, &e),
    }
}

async fn h_delete(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if let Some(r) = browser_only(&key) {
        return r;
    }
    if !csrf_ok(&headers) {
        return csrf_fail();
    }
    let store = match store(&st) {
        Ok(s) => s,
        Err(r) => return r,
    };
    match remove(store, &id) {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => fail(axum::http::StatusCode::NOT_FOUND, &e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_about_the_owner_are_added_edited_listed_and_forgotten() {
        let s = Store::open_memory().unwrap();
        assert!(prompt_text(&s).is_empty());
        let a = add(&s, "  Wants one step   at a time ", Some("style"), "mnemo").unwrap();
        assert_eq!(a["text"], "Wants one step at a time");
        assert!(
            add(&s, "wants one step at a time", Some("style"), "owner").is_err(),
            "no duplicates"
        );
        assert!(
            add(&s, "x", Some("mood"), "owner").is_err(),
            "known kinds only"
        );
        let b = add(&s, "Runs a farm business", None, "owner").unwrap();
        let text = prompt_text(&s);
        assert!(text.contains("How to answer them:\n- [m1] Wants one step at a time"));
        assert!(text.contains("About them:\n- [m2] Runs a farm business (set by the owner)"));
        let e = edit(&s, "m1", Some("Wants short answers"), None, "owner").unwrap();
        assert_eq!(
            (e["text"].as_str(), e["by"].as_str()),
            (Some("Wants short answers"), Some("owner"))
        );
        run(&s, FORGET, &json!({"id": b["id"]})).unwrap();
        assert_eq!(items(&s).len(), 1);
        assert!(remove(&s, "m9").is_err());
        assert!(learning(&s), "learning is on by default");
    }
}
