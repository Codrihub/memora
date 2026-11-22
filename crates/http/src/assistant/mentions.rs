//! `@mnemo:` in a note asks Mnemo for something right there.
//!
//! A line with `@mnemo: <request>` (anywhere in the line, also inside a quote or a list
//! item, never in code) is a pending mention. A few seconds after the note is saved by the
//! owner in the browser, or changed by an agent's tool call (`mention_agent` with agent
//! `mnemo` writes one, and so do Mnemo's own edits from a chat or the console), Mnemo runs the request in the note's own chat (one per note,
//! listed with the other chats), then answers in the note: the request is struck through (`~~@mnemo: …~~`) and its
//! reply goes right under it as a quote. A struck mention is done and never runs again.

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use memora_state::assistant::NewMessage;

use super::{
    caller_for, endpoint, new_id, resolve_model, run_agent, store, store as store_of,
    system_prompt, NAME,
};
use crate::AppState;

/// Title prefix of the chats that answer a request written in a note.
pub const TITLE_PREFIX: &str = "@mnemo · ";

/// What the model is told with a request from a note.
pub fn instruction(path: &str, line: i64) -> String {
    format!(
        "(Asked with @mnemo in the note {path}, line {line}. Do what it asks with your tools. Your last \
reply is written into that note right under the request, so keep it short Markdown without headings, \
and say what you changed.)"
    )
}

/// The word that asks Mnemo, followed by `:`.
pub const TAG: &str = "@mnemo:";
/// Wait after a change before reading the note, so a burst of saves runs once.
const SETTLE: Duration = Duration::from_secs(3);
/// Mentions answered per note per pass (the rest wait for the next change).
const PER_PASS: usize = 3;
/// Longest request taken from one line.
const MAX_REQUEST: usize = 2000;

/// One pending mention: its line index, the text before the tag, and the request.
#[derive(Debug, Clone, PartialEq)]
pub struct Pending {
    pub line: usize,
    pub before: String,
    pub request: String,
}

/// Byte offset of `@mnemo:` in `line` (any case), if it is a live mention: not struck
/// (`~~` right before it) and not inside inline code.
fn tag_at(line: &str) -> Option<usize> {
    let lower = line.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find(TAG) {
        let at = from + i;
        let before = &line[..at];
        let struck = before.ends_with("~~");
        let in_code = before.matches('`').count() % 2 == 1;
        if !struck && !in_code {
            return Some(at);
        }
        from = at + TAG.len();
    }
    None
}

/// Every pending mention in a note's text, outside fenced code blocks.
pub fn pending(text: &str) -> Vec<Pending> {
    let mut out = Vec::new();
    let mut fence: Option<&str> = None;
    for (n, line) in text.lines().enumerate() {
        let t = line.trim_start().trim_start_matches(['>', ' ']);
        for f in ["```", "~~~"] {
            if t.starts_with(f) {
                fence = match fence {
                    Some(open) if open == f => None,
                    None => Some(f),
                    other => other,
                };
            }
        }
        if fence.is_some() || t.starts_with("```") || t.starts_with("~~~") {
            continue;
        }
        let Some(at) = tag_at(line) else { continue };
        let request: String = line[at + TAG.len()..]
            .trim()
            .chars()
            .take(MAX_REQUEST)
            .collect();
        if request.is_empty() {
            continue;
        }
        out.push(Pending {
            line: n,
            before: line[..at].to_string(),
            request,
        });
    }
    out
}

/// What goes in front of each reply line: the mention line's quote markers, list markers
/// turned into spaces (so the reply sits inside the item).
fn reply_indent(before: &str) -> String {
    let lead: String = before
        .chars()
        .take_while(|c| {
            c.is_whitespace()
                || c.is_ascii_digit()
                || matches!(c, '>' | '-' | '*' | '+' | '.' | ')' | '[' | ']' | 'x' | 'X')
        })
        .collect();
    lead.chars()
        .map(|c| {
            if c == '>' || c == ' ' || c == '\t' {
                c
            } else {
                ' '
            }
        })
        .collect()
}

/// The note with mention `p` struck through and `reply` quoted under it. `None` when the
/// line changed since it was read (the owner edited it meanwhile).
pub fn answered(text: &str, p: &Pending, reply: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let line = *lines.get(p.line)?;
    let at = tag_at(line)?;
    if line[..at] != p.before {
        return None;
    }
    let rest = line[at + TAG.len()..].trim_end();
    if rest.trim() != p.request.as_str() && !rest.trim().starts_with(p.request.as_str()) {
        return None;
    }
    let struck = format!("{}~~@mnemo: {}~~", p.before, rest.trim());
    let ind = reply_indent(&p.before);
    // A reply never asks again: its own "@mnemo:" is broken with a zero-width space.
    let safe = reply
        .replace(TAG, "@\u{200b}mnemo:")
        .replace("@Mnemo:", "@\u{200b}Mnemo:");
    let mut body: Vec<String> = Vec::new();
    for (i, l) in safe.trim().lines().enumerate() {
        let l = l.trim_end();
        let lead = if i == 0 {
            format!("**{NAME}:** ")
        } else {
            String::new()
        };
        body.push(if l.is_empty() && i > 0 {
            format!("{ind}>")
        } else {
            format!("{ind}> {lead}{l}")
        });
    }
    let mut out: Vec<String> = lines.iter().map(|s| s.to_string()).collect();
    out[p.line] = struck;
    // The reply goes after the mention's quoted continuation lines (mention_agent writes
    // a multi-line message as one quote).
    let mut end = p.line + 1;
    if p.before.trim_start().starts_with('>') {
        while end < lines.len() {
            let l = lines[end];
            if l.trim().is_empty() || !l.trim_start().starts_with('>') || tag_at(l).is_some() {
                break;
            }
            end += 1;
        }
    }
    for (i, b) in body.into_iter().enumerate() {
        out.insert(end + i, b);
    }
    let mut s = out.join("\n");
    if text.ends_with('\n') {
        s.push('\n');
    }
    Some(s)
}

// ---------------- running them ----------------

#[derive(Default)]
struct Queue {
    /// Bumped by every change of a note; a pass only runs if no newer change came.
    gen: HashMap<String, u64>,
    /// Notes being answered right now, and the ones changed meanwhile (run again after).
    running: HashSet<String>,
    again: HashMap<String, String>,
    /// Notes whose request could not be answered (the provider was down): how many tries so
    /// far. The request stays in the note and is tried again later (see `retry_later`).
    tries: HashMap<String, u32>,
}

fn queue() -> &'static Mutex<Queue> {
    static Q: OnceLock<Mutex<Queue>> = OnceLock::new();
    Q.get_or_init(Default::default)
}

fn lock() -> std::sync::MutexGuard<'static, Queue> {
    queue().lock().unwrap_or_else(|e| e.into_inner())
}

/// A note changed (`by` changed it): look for mentions once it settles.
pub fn poke(st: &AppState, path: &str, by: &str) {
    if !path.to_ascii_lowercase().ends_with(".md") {
        return;
    }
    let g = {
        let mut q = lock();
        if q.running.contains(path) {
            q.again.insert(path.to_string(), by.to_string());
            return;
        }
        let g = q.gen.entry(path.to_string()).or_insert(0);
        *g += 1;
        *g
    };
    let (st, path, by) = (st.clone(), path.to_string(), by.to_string());
    tokio::spawn(async move {
        tokio::time::sleep(SETTLE).await;
        {
            let mut q = lock();
            if q.gen.get(&path) != Some(&g) || q.running.contains(&path) {
                return;
            }
            q.running.insert(path.clone());
        }
        let st2 = st.clone();
        let (p2, b2) = (path.clone(), by.clone());
        crate::blocking(move || answer_all(&st2, &p2, &b2)).await;
        let again = {
            let mut q = lock();
            q.running.remove(&path);
            q.again.remove(&path)
        };
        if let Some(by) = again {
            poke(&st, &path, &by);
        }
    });
}

/// Chats follow their note: when a note (or its folder) is renamed, moved, sent to the Trash
/// or restored, the chats about it point at the new place, and a note's @mnemo chat takes the
/// note's new name. Installed beside the store's own hook (privacy rules and pins).
pub fn follow_moves(st: &AppState) {
    let state = st.clone();
    let mut g = crate::cache::lock(&st.store);
    let inner = g.path_hook();
    g.set_path_hook(Some(std::sync::Arc::new(
        move |ev: &memora_core::privacy::PathEvent| {
            if let Some(h) = &inner {
                h(ev);
            }
            if let memora_core::privacy::PathEvent::Moved { from, to, .. } = ev {
                let Ok(store) = store(&state) else { return };
                match store.move_scopes(from, to) {
                    Ok(moved) => retitle(store, &moved),
                    Err(e) => tracing::warn!("chats did not follow {from} -> {to}: {e}"),
                }
            }
        },
    )));
}

/// A note's @mnemo chat is titled after the note: keep it so after a rename.
fn retitle(store: &memora_state::assistant::Store, moved: &[(String, String)]) {
    let Ok(all) = store.sessions() else { return };
    for (id, scope) in moved {
        let Some(path) = scope.strip_prefix("note:") else {
            continue;
        };
        let Some(s) = all.iter().find(|x| &x.id == id) else {
            continue;
        };
        if !s.title.starts_with(TITLE_PREFIX) {
            continue;
        }
        let name = path
            .rsplit('/')
            .next()
            .unwrap_or(path)
            .trim_end_matches(".md");
        let title: String = format!("{TITLE_PREFIX}{name}").chars().take(80).collect();
        if title != s.title {
            let _ = store.update_session(id, Some(&title), None, None, None);
        }
    }
}

/// Waits before trying a note's unanswered request again: 1, 3, 10 and 30 minutes, then hourly
/// (up to a day of tries; the next change of the note starts over).
const RETRY_WAITS: [u64; 4] = [60, 180, 600, 1800];
const RETRY_MAX: u32 = 28;

fn retry_later(st: &AppState, path: &str, by: &str) {
    let n = {
        let mut q = lock();
        let n = q.tries.entry(path.to_string()).or_insert(0);
        *n += 1;
        *n
    };
    if n > RETRY_MAX {
        lock().tries.remove(path);
        return;
    }
    let wait = RETRY_WAITS.get(n as usize - 1).copied().unwrap_or(3600);
    let (st, path, by) = (st.clone(), path.to_string(), by.to_string());
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(wait)).await;
        // Still waiting (an answer or a newer change would have cleared or restarted it).
        if lock().tries.get(&path).copied() == Some(n) {
            poke(&st, &path, &by);
        }
    });
}

/// Agents' tool calls that changed notes (from the realtime hub) are changes too.
pub fn watch(st: &AppState) {
    let mut rx = memora_core::events::hub().subscribe();
    let st = st.clone();
    tokio::spawn(async move {
        loop {
            let line = match rx.recv().await {
                Ok(l) => l,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => return,
            };
            let Ok(ev) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if ev["type"] != "ai_activity" || ev["phase"] != "end" || ev["ok"] != true {
                continue;
            }
            let actor = ev["actor"].as_str().unwrap_or("");
            let tool = ev["action"].as_str().unwrap_or("");
            if memora_mcp::activity::is_read_only(tool) || !asks_again(actor, ev["for"].as_str()) {
                continue;
            }
            for p in ev["paths"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                poke(&st, p, actor);
            }
        }
    });
}

/// Whether a change can ask Mnemo: anyone's, Mnemo's own too (a chat or the console asking it
/// to write `@mnemo:` into a note works like the owner writing it), except Mnemo's work on a
/// note's request, so a request never sets off another one by itself.
fn asks_again(actor: &str, on_behalf: Option<&str>) -> bool {
    actor != NAME || !on_behalf.is_some_and(|f| f.contains("@mnemo in "))
}

fn note_text(st: &AppState, path: &str) -> Option<String> {
    crate::store_as(st, None)
        .read_note_impl(path)
        .ok()
        .and_then(|v| v["content"].as_str().map(str::to_string))
}

/// Answer the pending mentions of one note, oldest line first.
fn answer_all(st: &AppState, path: &str, by: &str) {
    let Some(text) = note_text(st, path) else {
        return;
    };
    let todo: Vec<Pending> = pending(&text).into_iter().take(PER_PASS).collect();
    if todo.is_empty() {
        return;
    }
    let Ok(store) = store(st) else { return };
    // No usable model yet: the mentions wait and are tried again later.
    let Ok((provider, model)) = resolve_model(store, None, None) else {
        retry_later(st, path, by);
        return;
    };
    let Ok(ep) = endpoint(st, store, &provider) else {
        retry_later(st, path, by);
        return;
    };
    let name = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".md");
    for p in todo {
        let reply = match ask(st, store, path, name, by, &p, &provider, &model, &ep) {
            Ok(r) => {
                lock().tries.remove(path);
                r
            }
            // The provider could not answer: the request stays open and is tried again.
            Err(e) => {
                tracing::warn!(path, "@mnemo request not answered yet: {e}");
                retry_later(st, path, by);
                return;
            }
        };
        // Read again: the note may have changed while Mnemo worked (also by Mnemo's tools).
        let Some(now) = note_text(st, path) else {
            return;
        };
        let Some(m) = pending(&now)
            .into_iter()
            .find(|x| x.request == p.request && x.before == p.before)
        else {
            continue;
        };
        let Some(next) = answered(&now, &m, &reply) else {
            continue;
        };
        let who = caller_for(&format!("{by} · @mnemo in {name}"));
        let args = json!({"path": path, "content": next});
        if let Err(e) = st.mcp.call_tool_by("save_memory", &args, &who) {
            tracing::warn!(path, "could not write Mnemo's reply: {e}");
        }
    }
}

/// The note's own @mnemo chat (the newest), unless it is answering right now.
fn note_chat(store: &memora_state::assistant::Store, scope: &str) -> Option<String> {
    store
        .sessions()
        .ok()?
        .into_iter()
        .filter(|x| x.scope == scope && x.title.starts_with(TITLE_PREFIX))
        .max_by_key(|x| x.updated_at)
        .filter(|x| !super::live::running(&x.id))
        .map(|x| x.id)
}

/// Run one mention in the note's chat; the reply text (or why there is none).
#[allow(clippy::too_many_arguments)]
fn ask(
    st: &AppState,
    store: &memora_state::assistant::Store,
    path: &str,
    name: &str,
    by: &str,
    p: &Pending,
    provider: &str,
    model: &str,
    ep: &super::Endpoint,
) -> Result<String, String> {
    let now = memora_state::now();
    let scope = format!("note:{path}");
    // One chat per note: every request written in it goes to the same chat (the newest one
    // for this note), so the requests and answers read as one conversation. A new one starts
    // only when there is none yet or that chat is answering something else right now.
    let title: String = format!("{TITLE_PREFIX}{name}").chars().take(80).collect();
    let sid = match note_chat(store, &scope) {
        Some(id) => {
            let _ = store.update_session(&id, Some(&title), None, None, Some(now));
            id
        }
        None => {
            let id = new_id();
            if store
                .create_session(&id, &title, &scope, &format!("{provider}/{model}"), now)
                .is_err()
            {
                return Err("could not start a chat for this".into());
            }
            id
        }
    };
    let extra = store
        .prefs()
        .unwrap_or_default()
        .get("system_prompt")
        .and_then(Value::as_str)
        .map(str::to_string);
    let system = system_prompt(st, &scope, extra.as_deref());
    // The chat shows the request as the owner wrote it, with the note as a chip; how to
    // answer goes to the model with the message (see `history_within`).
    let meta = json!({
        "system": system,
        "mention": {"path": path, "line": p.line + 1, "by": by},
        // Written in a note on purpose: Mnemo may change notes for it in either mode.
        "approved": true,
        "attach": [{"kind": "note", "path": path, "title": name}],
    });
    let text = p.request.clone();
    // Tried before and not answered (the provider was down): run that same message again
    // instead of asking twice.
    let msgs = store.messages(&sid).unwrap_or_default();
    let retry = msgs
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .filter(|m| {
            m.content == text
                && m.meta
                    .as_ref()
                    .is_some_and(|v| v["mention"]["path"] == path)
                && !msgs
                    .iter()
                    .any(|x| x.id > m.id && x.role == "assistant" && !x.content.trim().is_empty())
        })
        .map(|m| m.id);
    let uid = match retry {
        Some(uid) => {
            let _ = store.delete_after(&sid, uid);
            uid
        }
        None => store
            .append(
                &sid,
                &NewMessage {
                    role: "user".into(),
                    content: text,
                    meta: Some(meta),
                    ..Default::default()
                },
                now,
            )
            .map_err(|_| "could not start a chat for this".to_string())?,
    };
    let owner = super::take_over(&sid);
    // A live run, so the owner can watch it on the Mnemo page while it works.
    let tx = super::live::start(&sid);
    let out = run_agent(
        st,
        store,
        &sid,
        &scope,
        provider,
        model,
        ep,
        &tx,
        &format!("{by} · @mnemo in {name}"),
    );
    let cut = tx.is_closed();
    drop(tx);
    // Only what came after this request counts (the note's chat holds earlier ones too).
    let error = store
        .messages(&sid)
        .unwrap_or_default()
        .into_iter()
        .rev()
        .find(|m| m.role == "assistant" && m.id > uid)
        .and_then(|m| m.meta.and_then(|v| v["error"].as_str().map(str::to_string)));
    // Cut by a steer or Stop in the chat: what came next owns it now.
    let mine = !cut && super::release(&sid, owner);
    if mine {
        super::live::notify(
            &sid,
            &serde_json::json!({"type": "idle", "outcome": "mention"}),
        );
    }
    // Messages the owner queued in this chat meanwhile go out now.
    if mine && super::live::queued(&sid) {
        if let Ok(s) = store_of(st) {
            super::kick(
                st,
                s,
                &sid,
                "owner · chat".into(),
                out == super::Outcome::Failed,
                true,
            );
        }
    }
    let last = store
        .messages(&sid)
        .unwrap_or_default()
        .into_iter()
        .rev()
        .find(|m| m.role == "assistant" && m.id > uid && !m.content.trim().is_empty())
        .map(|m| m.content);
    match (last, error) {
        (Some(t), _) => Ok(t),
        (None, Some(e)) => Err(e),
        (None, None) => Ok("Done.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentions_are_found_outside_code_and_strikes() {
        let t = "# Plan\n@mnemo: tidy this note\n> @Mnemo: summarise\n~~@mnemo: done already~~\n`@mnemo: code`\n```\n@mnemo: in a fence\n```\n- [ ] @mnemo:   \n- item @mnemo: tag it #x\n";
        let p = pending(t);
        let req: Vec<&str> = p.iter().map(|x| x.request.as_str()).collect();
        assert_eq!(req, vec!["tidy this note", "summarise", "tag it #x"]);
        assert_eq!(p[1].before, "> ");
        assert_eq!(p[2].before, "- item ");
    }

    #[test]
    fn a_reply_strikes_the_request_and_sits_under_it() {
        assert!(super::asks_again("claude", None));
        assert!(super::asks_again(NAME, Some("owner · chat")));
        assert!(super::asks_again(NAME, Some("owner · console")));
        assert!(!super::asks_again(NAME, Some("owner · @mnemo in Plan")));
        let t = "intro\n@mnemo: what is due?\nafter\n";
        let p = &pending(t)[0];
        let out = answered(t, p, "Two tasks.\n\n- A\n- B").unwrap();
        assert_eq!(
            out,
            "intro\n~~@mnemo: what is due?~~\n> **Mnemo:** Two tasks.\n>\n> - A\n> - B\nafter\n"
        );
        assert!(
            pending(&out).is_empty(),
            "answered mentions never run again"
        );
        // A reply that says @mnemo: itself does not ask again.
        let again = answered(t, p, "write @mnemo: more").unwrap();
        assert!(pending(&again).is_empty());
        // In a list item the reply is indented into the item; in a quote it stays quoted.
        let l = "- [ ] @mnemo: check\n";
        assert_eq!(
            answered(l, &pending(l)[0], "ok").unwrap(),
            "- [ ] ~~@mnemo: check~~\n      > **Mnemo:** ok\n"
        );
        let q = "> @mnemo: first\n> second line\nnext\n";
        assert_eq!(
            answered(q, &pending(q)[0], "ok").unwrap(),
            "> ~~@mnemo: first~~\n> second line\n> > **Mnemo:** ok\nnext\n"
        );
        // The owner changed the line meanwhile: nothing is written.
        assert!(answered("@mnemo: other\n", p, "x").is_none());
    }
}
