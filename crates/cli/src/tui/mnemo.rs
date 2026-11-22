//! `/mnemo`: chat with Mnemo, the notes agent, from the console.
//!
//! There is one Mnemo. The console talks to the running server's own Mnemo routes
//! (`/api/assistant/*`), so chats, models, keys and settings are the same ones the
//! browser shows, and every action Mnemo takes is recorded in Activity under its name.
//! For that the console opens a short-lived owner session on this machine
//! (shown in /sessions as "console") and ends it when you leave the chat.

use crate::{ok, store, Ctx};
use anyhow::{anyhow, bail, Context, Result};
use console::style;
use dialoguer::theme::ColorfulTheme;
use dialoguer::{Confirm, Input, Password, Select};
use memora_state::session;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

const NAME: &str = "Mnemo";

/// A signed-in link to the local server, for the length of one `/mnemo`.
struct Link {
    base: String,
    cookie: String,
    sid_hash: String,
    agent: ureq::Agent,
}

impl Link {
    fn open(ctx: &Ctx) -> Result<Link> {
        if ctx.server.is_none() {
            bail!("{NAME} runs inside the server, and no server is running. Start it with /start.");
        }
        if ctx.owner()?.is_none() {
            bail!("there is no owner account yet. Run /setup first.");
        }
        let addr = crate::lifecycle::listen_addr(ctx);
        let base = format!("http://{addr}");
        let raw = new_sid();
        let sid_hash = memora_gateway::hash_api_key(&raw);
        let h = sid_hash.clone();
        store::write(ctx, move |tx| {
            let s = memora_state::settings::get(tx)?;
            let new = session::NewSession {
                sid_hash: h,
                source: "console".into(),
                ip: Some("127.0.0.1".into()),
                user_agent: Some(format!("Memora console ({NAME})")),
            };
            session::create(
                tx,
                &new,
                s.session_ttl,
                s.session_max_age,
                memora_state::now(),
            )?;
            store::log(tx, "mnemo_console", "terminal chat opened")?;
            Ok(())
        })?;
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout_read(Duration::from_secs(300))
            .build();
        let link = Link {
            base,
            cookie: format!("memora_sess={raw}"),
            sid_hash,
            agent,
        };
        // Fail early, with a clear message, when the server cannot be reached.
        link.get("/api/assistant/state")
            .with_context(|| format!("could not reach the server at {}", link.base))?;
        Ok(link)
    }

    fn close(&self, ctx: &Ctx) {
        let h = self.sid_hash.clone();
        let _ = store::write(ctx, move |tx| {
            session::revoke(tx, &h)?;
            Ok(())
        });
    }

    fn req(&self, method: &str, path: &str) -> ureq::Request {
        self.agent
            .request(method, &format!("{}{path}", self.base))
            .set("Cookie", &self.cookie)
            .set("Origin", &self.base)
            .set("X-Memora-Client", "console")
            .set("Accept", "application/json")
    }

    fn get_text(&self, path: &str) -> Result<String> {
        match self.req("GET", path).call() {
            Ok(r) => Ok(r.into_string()?),
            Err(e) => Err(http_error(e)),
        }
    }

    fn get(&self, path: &str) -> Result<Value> {
        read_json(self.req("GET", path).call())
    }

    fn post(&self, path: &str, body: Value) -> Result<Value> {
        read_json(
            self.req("POST", path)
                .set("Content-Type", "application/json")
                .send_string(&body.to_string()),
        )
    }

    /// POST raw bytes (an image) and read the JSON reply.
    fn upload(&self, path: &str, bytes: &[u8]) -> Result<Value> {
        read_json(
            self.req("POST", path)
                .set("Content-Type", "application/octet-stream")
                .send_bytes(bytes),
        )
    }

    /// POST and read the reply as server-sent events, one JSON value per event.
    fn stream(&self, path: &str, body: Value, mut on: impl FnMut(&Value)) -> Result<()> {
        // No body: watch a running reply (`/live`, GET); else start one (POST).
        let resp = if body.is_null() {
            self.req("GET", path)
                .set("Accept", "text/event-stream")
                .call()
        } else {
            self.req("POST", path)
                .set("Accept", "text/event-stream")
                .set("Content-Type", "application/json")
                .send_string(&body.to_string())
        };
        let resp = match resp {
            Ok(r) => r,
            Err(e) => return Err(http_error(e)),
        };
        let reader = BufReader::new(resp.into_reader());
        for line in reader.lines() {
            let line = line?;
            if let Some(data) = line.strip_prefix("data:") {
                if let Ok(v) = serde_json::from_str::<Value>(data.trim_start()) {
                    on(&v);
                }
            }
        }
        Ok(())
    }
}

fn new_sid() -> String {
    let hex = |k: String| k.rsplit('_').next().unwrap_or("").to_string();
    format!(
        "{}{}",
        hex(memora_gateway::generate_key()),
        hex(memora_gateway::generate_key())
    )
}

fn http_error(e: ureq::Error) -> anyhow::Error {
    match e {
        ureq::Error::Status(code, r) => {
            let msg = r
                .into_string()
                .ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .and_then(|v| v["error"].as_str().map(str::to_string))
                .unwrap_or_else(|| format!("HTTP {code}"));
            anyhow!(msg)
        }
        other => anyhow!("{other}"),
    }
}

fn read_json(r: std::result::Result<ureq::Response, ureq::Error>) -> Result<Value> {
    let resp = r.map_err(http_error)?;
    let text = resp.into_string()?;
    Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
}

/// `/mnemo [setup]`.
pub(crate) fn run(ctx: &Ctx, theme: &ColorfulTheme, arg: Option<&str>) -> Result<()> {
    let link = Link::open(ctx)?;
    let res = match arg {
        Some("setup" | "settings" | "models") => setup(&link, theme),
        Some(other) => {
            println!(
                "{} {} takes {} or nothing.",
                style("?").yellow().bold(),
                style("/mnemo").cyan(),
                style("setup").cyan()
            );
            let _ = other;
            Ok(())
        }
        None => chat(&link, theme),
    };
    link.close(ctx);
    res
}

// ---------------- chat ----------------

struct Chat {
    id: Option<String>,
    title: String,
    model: String,
    /// Notes, folders and images attached to the next message.
    attach: Vec<Value>,
}

fn usable_models(state: &Value) -> Vec<(String, String, bool)> {
    let providers = state["providers"].as_array().cloned().unwrap_or_default();
    let ok = |p: &str| {
        providers.iter().any(|x| {
            x["id"] == p
                && x["enabled"] == true
                && (x["key_hint"].as_str().is_some_and(|h| !h.is_empty()) || x["kind"] == "custom")
        })
    };
    let mut out: Vec<(String, String, bool)> = state["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["hidden"] != true && ok(m["provider_id"].as_str().unwrap_or("")))
        .map(|m| {
            let key = format!(
                "{}/{}",
                m["provider_id"].as_str().unwrap_or(""),
                m["model_id"].as_str().unwrap_or("")
            );
            let label = m["label"]
                .as_str()
                .filter(|l| !l.is_empty())
                .or(m["model_id"].as_str())
                .unwrap_or("")
                .to_string();
            (key, label, m["pinned"] == true)
        })
        .collect();
    // Pinned first, then provider and model: the order the server and the browser use.
    let parts = |k: &str| {
        k.split_once('/')
            .map(|(p, m)| (p.to_string(), m.to_string()))
    };
    out.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| parts(&a.0).cmp(&parts(&b.0))));
    out
}

fn default_model(state: &Value) -> String {
    let list = usable_models(state);
    let d = state["prefs"]["default_model"].as_str().unwrap_or("");
    if list.iter().any(|m| m.0 == d) {
        return d.to_string();
    }
    list.first().map(|m| m.0.clone()).unwrap_or_default()
}

fn chat(link: &Link, theme: &ColorfulTheme) -> Result<()> {
    let mut state = link.get("/api/assistant/state")?;
    if usable_models(&state).is_empty() {
        println!(
            "{} {NAME} has no model yet. Connect OpenAI, Anthropic or an OpenAI-compatible server first.",
            style("!").yellow().bold()
        );
        let go = Confirm::with_theme(theme)
            .with_prompt("Set one up now?")
            .default(true)
            .interact_opt()?;
        if go != Some(true) {
            return Ok(());
        }
        setup(link, theme)?;
        state = link.get("/api/assistant/state")?;
        if usable_models(&state).is_empty() {
            return Ok(());
        }
    }
    let Some(mut c) = pick_chat(link, theme, &state)? else {
        return Ok(());
    };
    banner(&c, &state);
    while let Ok(line) = Input::<String>::with_theme(theme)
        .with_prompt(style("you").cyan().bold().to_string())
        .allow_empty(true)
        .interact_text()
    {
        let text = line.trim();
        if text.is_empty() {
            continue;
        }
        match text {
            "/exit" | "/quit" | "/q" | "/back" => break,
            "/help" | "/?" => {
                chat_help();
                continue;
            }
            "/new" => {
                // A new chat starts with the default (pinned) model, like in the browser.
                state = link.get("/api/assistant/state").unwrap_or(state);
                c = Chat {
                    id: None,
                    title: "New chat".into(),
                    model: default_model(&state),
                    attach: Vec::new(),
                };
                ok(&format!(
                    "New chat with {}: your next message starts it.",
                    c.model
                ));
                continue;
            }
            "/auto" | "/ask" => {
                let auto = text == "/auto";
                link.post(
                    "/api/assistant/prefs",
                    json!({ "permission": if auto { "auto" } else { "ask" } }),
                )?;
                state = link.get("/api/assistant/state").unwrap_or(state);
                ok(if auto {
                    "Auto: Mnemo makes changes without asking and keeps going until done."
                } else {
                    "Ask first: Mnemo asks before it changes your notes."
                });
                continue;
            }
            "/pin" | "/default" | "/unpin" => {
                let model = if c.model.is_empty() {
                    default_model(&state)
                } else {
                    c.model.clone()
                };
                let off = text == "/unpin";
                link.post(
                    "/api/assistant/prefs",
                    json!({ "default_model": if off { Value::Null } else { json!(model) } }),
                )?;
                state = link.get("/api/assistant/state").unwrap_or(state);
                if off {
                    ok("New chats use the first pinned model again.");
                } else {
                    ok(&format!(
                        "New chats now start with {model}, here and in the browser."
                    ));
                }
                continue;
            }
            t if t == "/search" || t.starts_with("/search ") => {
                let q = t.strip_prefix("/search").unwrap_or("").trim();
                if q.is_empty() {
                    println!(
                        "  {} /search words from any earlier chat",
                        style("usage:").dim()
                    );
                    continue;
                }
                if let Some(next) = search_chats(link, theme, &state, q)? {
                    c = next;
                    banner(&c, &state);
                }
                continue;
            }
            t if t == "/export" || t.starts_with("/export ") => {
                // The chat as a Markdown file, in this folder unless a path is given.
                let Some(id) = c.id.clone() else {
                    ok("Nothing to export yet: send a message first.");
                    continue;
                };
                let md = link.get_text(&format!("/api/assistant/sessions/{id}/export"))?;
                let given = t.strip_prefix("/export").unwrap_or("").trim();
                let file = if given.is_empty() {
                    let stem: String = c
                        .title
                        .chars()
                        .map(|ch| {
                            if ch.is_alphanumeric() || ch == '-' {
                                ch
                            } else {
                                ' '
                            }
                        })
                        .collect::<String>()
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join("-");
                    format!(
                        "{}.md",
                        if stem.is_empty() {
                            "mnemo-chat".into()
                        } else {
                            stem.chars().take(60).collect::<String>()
                        }
                    )
                } else {
                    given.to_string()
                };
                match std::fs::write(&file, md) {
                    Ok(()) => ok(&format!("Saved the chat to {file}")),
                    Err(e) => println!(
                        "{} could not write {file}: {e}",
                        style("error:").red().bold()
                    ),
                }
                continue;
            }
            "/details" => {
                match last_error().lock().ok().and_then(|e| e.clone()) {
                    Some(e) if !e.is_empty() => println!("{e}"),
                    _ => ok("No error in this session."),
                }
                continue;
            }
            "/retry" | "/regenerate" => {
                // The last message again: its reply is replaced by a new one.
                let Some(id) = c.id.clone() else {
                    ok("Nothing to run again yet: send a message first.");
                    continue;
                };
                let mut body = json!({});
                if !c.model.is_empty() {
                    body["model"] = json!(c.model);
                }
                stream_reply(link, &format!("/api/assistant/sessions/{id}/rerun"), body)?;
                continue;
            }
            "/activity" => {
                // What Mnemo did lately, and who it was for (the same log as the browser).
                let r = link.get("/api/logs?range=7d&actor=Mnemo&limit=60")?;
                let rows: Vec<&Value> = r["events"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|e| e["type"] == "ai_activity" && e["phase"] == "start")
                    .take(15)
                    .collect();
                if rows.is_empty() {
                    ok("Mnemo has done nothing in the last 7 days.");
                }
                for e in rows {
                    let mark = match e["ok"].as_bool() {
                        Some(false) => style("✗").red().to_string(),
                        _ => style("·").cyan().to_string(),
                    };
                    println!(
                        "  {mark} {}  {} {}  {}",
                        style(e["time"].as_str().unwrap_or("")).dim(),
                        tool_words(e["action"].as_str().unwrap_or("")),
                        e["label"].as_str().unwrap_or(""),
                        style(
                            e["for"]
                                .as_str()
                                .map(|f| format!("for {f}"))
                                .unwrap_or_default()
                        )
                        .dim()
                    );
                }
                continue;
            }
            "/compact" | "/memory" => {
                let Some(id) = c.id.clone() else {
                    ok("Nothing to compact yet: this chat has no messages.");
                    continue;
                };
                if text == "/compact" {
                    println!("  {}", style("compacting the chat's memory…").dim());
                    match link.post(&format!("/api/assistant/sessions/{id}/compact"), json!({})) {
                        Ok(r) if r["ok"] == true => ok(&format!(
                            "{} older messages compacted into a summary.",
                            r["messages"].as_u64().unwrap_or(0)
                        )),
                        Ok(r) => ok(r["reason"].as_str().unwrap_or("Nothing to compact yet.")),
                        Err(e) => println!("{} {e:#}", style("error:").red().bold()),
                    }
                }
                let r = link.get(&format!("/api/assistant/sessions/{id}"))?;
                let cx = &r["context"];
                if let (Some(u), Some(w)) = (cx["used"].as_i64(), cx["window"].as_i64()) {
                    println!(
                        "  {} {} of {} tokens ({}%) with {}. Near {} the older messages are compacted into a summary{}.",
                        style("memory").cyan(),
                        tokens(u),
                        tokens(w),
                        if w > 0 { u * 100 / w } else { 0 },
                        cx["model"].as_str().unwrap_or(""),
                        tokens(cx["compact_at"].as_i64().unwrap_or(0)),
                        match cx["compactions"].as_u64().unwrap_or(0) {
                            0 => String::new(),
                            1 => " (compacted once so far)".into(),
                            n => format!(" (compacted {n} times so far)"),
                        }
                    );
                }
                continue;
            }
            "/chats" => {
                if let Some(next) = pick_chat(link, theme, &state)? {
                    c = next;
                    banner(&c, &state);
                }
                continue;
            }
            "/model" => {
                state = link.get("/api/assistant/state")?;
                if let Some(m) = pick_model(theme, &state, &c.model)? {
                    c.model = m;
                    if let Some(id) = &c.id {
                        let _ = link.post(
                            &format!("/api/assistant/sessions/{id}"),
                            json!({ "model": c.model }),
                        );
                    }
                    ok(&format!("Model: {}", c.model));
                }
                continue;
            }
            "/setup" => {
                setup(link, theme)?;
                state = link.get("/api/assistant/state")?;
                continue;
            }
            "/detach" => {
                c.attach.clear();
                ok("Nothing attached.");
                continue;
            }
            t if t.starts_with("/attach") || t.starts_with("/image") => {
                let arg = t.split_once(' ').map(|(_, a)| a.trim()).unwrap_or("");
                if arg.is_empty() {
                    println!(
                        "  {} /attach Folder/Note.md, /attach Folder (a whole folder) or /image /path/to/picture.png",
                        style("usage:").dim()
                    );
                    continue;
                }
                match attach_item(link, t.starts_with("/image"), arg) {
                    Ok(item) => {
                        println!(
                            "  {} {} {}",
                            style("+").green().bold(),
                            item["title"].as_str().unwrap_or(arg),
                            style("goes with your next message (/detach to drop)").dim()
                        );
                        c.attach.push(item);
                    }
                    Err(e) => println!("{} {e:#}", style("error:").red().bold()),
                }
                continue;
            }
            t if t.starts_with('/') => {
                println!(
                    "{} in a chat: /attach, /image, /detach, /model, /pin, /memory, /compact, /activity, /search, /retry, /export, /auto, /ask, /new, /chats, /setup, /help, /exit.",
                    style("?").yellow().bold()
                );
                continue;
            }
            _ => {}
        }
        if c.id.is_none() {
            let r = link.post(
                "/api/assistant/sessions",
                json!({ "scope": "global", "model": c.model }),
            )?;
            c.id = r["session"]["id"].as_str().map(str::to_string);
        }
        let id =
            c.id.clone()
                .ok_or_else(|| anyhow!("the chat could not be started"))?;
        let att = std::mem::take(&mut c.attach);
        send(link, &id, text, &c.model, &att)?;
        answer_asks(link, theme, &id, &c.model)?;
        if c.title == "New chat" {
            c.title = text.chars().take(60).collect();
        }
    }
    Ok(())
}

fn banner(c: &Chat, state: &Value) {
    println!();
    println!(
        "  {}  {}",
        style(NAME).cyan().bold(),
        style("· your notes agent, the same one as in the browser").dim()
    );
    println!(
        "  {} {}   {} {}",
        style("chat").dim(),
        c.title,
        style("model").dim(),
        if c.model.is_empty() {
            default_model(state)
        } else {
            c.model.clone()
        }
    );
    println!(
        "  {}",
        style("Type a message. /model switches the model, /pin makes it the default, /memory shows how full the chat is, /new starts over, /exit leaves.").dim()
    );
    println!();
}

fn chat_help() {
    for (c, d) in [
        (
            "/attach",
            "attach a note (Folder/Note.md) or a folder to your next message",
        ),
        (
            "/image",
            "attach a picture file; Mnemo can put it beside a note",
        ),
        ("/detach", "drop what you attached"),
        ("/model", "choose the model for this chat (pinned first)"),
        (
            "/pin",
            "use this chat's model for new chats too (browser as well); /unpin undoes it",
        ),
        ("/memory", "how full this chat's memory is for its model"),
        ("/compact", "fold the older messages into a summary now"),
        ("/activity", "what Mnemo did lately, and who it was for"),
        ("/search", "find words in any earlier chat and open it"),
        (
            "/auto",
            "let Mnemo change notes without asking; /ask asks first again",
        ),
        (
            "/retry",
            "run your last message again (a new reply replaces the old one)",
        ),
        ("/details", "the full error of the last failed reply"),
        (
            "/export",
            "save this chat as a Markdown file (here, or /export path.md)",
        ),
        ("/new", "start a new chat"),
        (
            "/chats",
            "open one of your chats (the same list as the browser)",
        ),
        ("/setup", "providers, keys, models and behaviour"),
        ("/exit", "leave the chat (Ctrl+C works too)"),
    ] {
        println!("  {:<8} {}", style(c).cyan(), d);
    }
}

/// Show an opened chat; a reply still running in it (left in the browser, or an @mnemo
/// request) shows up to its question, then streams live.
fn open_replay(link: &Link, id: &str, full: &Value) -> Result<()> {
    if full["running"] != true {
        replay(&full["messages"]);
        return Ok(());
    }
    let msgs = full["messages"].as_array().cloned().unwrap_or_default();
    let upto = msgs
        .iter()
        .rposition(|m| m["role"] == "user")
        .map_or(msgs.len(), |i| i + 1);
    replay(&Value::Array(msgs[..upto].to_vec()));
    println!(
        "  {}",
        style(format!("{NAME} is still working on this…")).dim()
    );
    stream_reply(
        link,
        &format!("/api/assistant/sessions/{id}/live"),
        Value::Null,
    )
}

/// `/search`: every chat that said the words; pick a hit to open its chat.
fn search_chats(
    link: &Link,
    theme: &ColorfulTheme,
    state: &Value,
    q: &str,
) -> Result<Option<Chat>> {
    let r = link.get(&format!("/api/assistant/search?q={}&limit=40", urlenc(q)))?;
    let hits: Vec<&Value> = r["hits"].as_array().into_iter().flatten().collect();
    if hits.is_empty() {
        ok(&format!("Nothing in your chats says \"{q}\"."));
        return Ok(None);
    }
    let items: Vec<String> = hits
        .iter()
        .map(|h| {
            let who = match h["role"].as_str() {
                Some("user") => "you",
                Some("assistant") => NAME,
                _ => "title",
            };
            format!(
                "{}  {}",
                h["title"].as_str().unwrap_or("Chat"),
                style(format!("{who}: {}", h["snippet"].as_str().unwrap_or(""))).dim()
            )
        })
        .collect();
    let Some(i) = Select::with_theme(theme)
        .with_prompt(format!("{} hits for \"{q}\" (Esc to go back)", hits.len()))
        .items(&items)
        .default(0)
        .interact_opt()?
    else {
        return Ok(None);
    };
    let id = hits[i]["chat"].as_str().unwrap_or("").to_string();
    let full = link.get(&format!("/api/assistant/sessions/{id}"))?;
    open_replay(link, &id, &full)?;
    let sess = &full["session"];
    Ok(Some(Chat {
        id: Some(id),
        title: sess["title"].as_str().unwrap_or("Chat").to_string(),
        model: sess["model"]
            .as_str()
            .filter(|m| !m.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| default_model(state)),
        attach: Vec::new(),
    }))
}

fn pick_chat(link: &Link, theme: &ColorfulTheme, state: &Value) -> Result<Option<Chat>> {
    let list = link.get("/api/assistant/sessions")?;
    let mut sessions: Vec<Value> = list["sessions"].as_array().cloned().unwrap_or_default();
    sessions.sort_by(|a, b| {
        (b["pinned"] == true)
            .cmp(&(a["pinned"] == true))
            .then(b["updated_at"].as_i64().cmp(&a["updated_at"].as_i64()))
    });
    sessions.truncate(15);
    let mut items = vec![format!("{}  New chat", style("+").green().bold())];
    for s in &sessions {
        let scope = s["scope"].as_str().unwrap_or("global");
        let about = if let Some(p) = scope.strip_prefix("note:") {
            format!("note {}", p.trim_end_matches(".md"))
        } else if let Some(f) = scope.strip_prefix("folder:") {
            format!("folder {f}")
        } else {
            "whole vault".into()
        };
        items.push(format!(
            "{}  {}  {}",
            if s["pinned"] == true { "★" } else { " " },
            s["title"].as_str().unwrap_or("Chat"),
            style(format!(
                "· {about} · {} messages",
                s["messages"].as_i64().unwrap_or(0)
            ))
            .dim()
        ));
    }
    let Some(i) = Select::with_theme(theme)
        .with_prompt(format!("{NAME}: pick a chat (Esc to go back)"))
        .items(&items)
        .default(0)
        .interact_opt()?
    else {
        return Ok(None);
    };
    if i == 0 {
        return Ok(Some(Chat {
            id: None,
            title: "New chat".into(),
            model: default_model(state),
            attach: Vec::new(),
        }));
    }
    let s = &sessions[i - 1];
    let id = s["id"].as_str().unwrap_or("").to_string();
    let full = link.get(&format!("/api/assistant/sessions/{id}"))?;
    open_replay(link, &id, &full)?;
    let model = s["model"]
        .as_str()
        .filter(|m| !m.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| default_model(state));
    Ok(Some(Chat {
        id: Some(id),
        title: s["title"].as_str().unwrap_or("Chat").to_string(),
        model,
        attach: Vec::new(),
    }))
}

/// The last few turns of a chat, so you know where it stands.
fn replay(messages: &Value) {
    let msgs: Vec<&Value> = messages
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["role"] != "tool" && !m["content"].as_str().unwrap_or("").is_empty())
        .collect();
    let start = msgs.len().saturating_sub(6);
    if start > 0 {
        println!("  {}", style(format!("… {start} earlier messages")).dim());
    }
    for m in &msgs[start..] {
        let text = m["content"].as_str().unwrap_or("");
        if m["role"] == "user" {
            println!("{} {}", style("you").cyan().bold(), text);
        } else {
            println!("{} {}", style(NAME).magenta().bold(), text);
        }
    }
}

fn pick_model(theme: &ColorfulTheme, state: &Value, current: &str) -> Result<Option<String>> {
    let list = usable_models(state);
    if list.is_empty() {
        println!("No model is ready. Use /setup.");
        return Ok(None);
    }
    let def = default_model(state);
    let items: Vec<String> = list
        .iter()
        .map(|(k, l, pinned)| {
            format!(
                "{} {l}  {}{}",
                if *pinned { "★" } else { " " },
                style(k).dim(),
                if *k == def {
                    style("  default").cyan().to_string()
                } else {
                    String::new()
                }
            )
        })
        .collect();
    let at = list.iter().position(|m| m.0 == current).unwrap_or(0);
    Ok(Select::with_theme(theme)
        .with_prompt("Model")
        .items(&items)
        .default(at)
        .interact_opt()?
        .map(|i| list[i].0.clone()))
}

fn tool_words(name: &str) -> &str {
    match name {
        "search_memory" => "Searched notes",
        "read_memory" => "Read a note",
        "list_memory" => "Listed notes",
        "create_memory" => "Created a note",
        "save_memory" => "Saved a note",
        "patch_memory" => "Edited a note",
        "move_memory" => "Moved a note",
        "rename_memory" => "Renamed a note",
        "soft_delete" => "Moved to the Trash",
        "restore_trash" => "Restored from the Trash",
        "add_tags" | "set_tags" => "Tagged",
        "list_folders" => "Listed folders",
        "get_stats" => "Checked the vault",
        other => other,
    }
}

fn subject(args: &Value) -> String {
    if let Some(q) = args["query"].as_str() {
        return format!("“{q}”");
    }
    for k in ["path", "folder", "tag", "name", "title"] {
        if let Some(v) = args[k].as_str().filter(|v| !v.is_empty()) {
            return v.trim_end_matches(".md").to_string();
        }
    }
    String::new()
}

/// A note (`.md`), a folder, or (`image`) a picture file on this machine, ready to attach.
fn attach_item(link: &Link, image: bool, arg: &str) -> Result<Value> {
    if image {
        let path = std::path::Path::new(arg);
        let bytes = std::fs::read(path).with_context(|| format!("could not read {arg}"))?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("image.png");
        let r = link.upload(
            &format!("/api/assistant/uploads?name={}", urlenc(name)),
            &bytes,
        )?;
        let id = r["id"]
            .as_str()
            .ok_or_else(|| anyhow!("the server kept no image"))?;
        return Ok(
            json!({"kind": "image", "path": id, "title": r["name"].as_str().unwrap_or(name)}),
        );
    }
    let p = arg.trim_matches('/');
    if p.to_ascii_lowercase().ends_with(".md") {
        Ok(
            json!({"kind": "note", "path": p, "title": p.rsplit('/').next().unwrap_or(p).trim_end_matches(".md")}),
        )
    } else {
        Ok(
            json!({"kind": "folder", "path": p, "title": if p.is_empty() { "All notes" } else { p.rsplit('/').next().unwrap_or(p) }}),
        )
    }
}

fn urlenc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The full error of the last failed reply, shown by `/details`.
fn last_error() -> &'static std::sync::Mutex<Option<String>> {
    static ERR: std::sync::OnceLock<std::sync::Mutex<Option<String>>> = std::sync::OnceLock::new();
    ERR.get_or_init(Default::default)
}

/// A provider error in plain words (HTTP codes and raw bodies stay in `/details`).
fn friendly_error(msg: &str) -> String {
    let m = msg.to_ascii_lowercase();
    // The status the provider answered with decides first: numbers inside a body can be anything.
    let status: u16 = m
        .split("answered ")
        .nth(1)
        .and_then(|r| r.get(..3))
        .and_then(|d| d.parse().ok())
        .unwrap_or(0);
    let head: String = m.chars().take(400).collect();
    let code = |c: &str| {
        let n = c.parse::<u16>().ok();
        match n {
            Some(n) => status == n || (status == 0 && head.contains(c)),
            None => head.contains(c),
        }
    };
    if status >= 500 {
        "The AI provider is not answering right now. Try again in a moment.".into()
    } else if code("401")
        || code("403")
        || code("unauthori")
        || code("forbidden")
        || code("api key")
        || code("invalid key")
    {
        "The AI provider did not accept the key. Check it in /setup.".into()
    } else if code("404") || code("not found") || code("no such model") || code("model_not_found") {
        "The AI provider could not find this model or address. Check it in /setup.".into()
    } else if code("429") || code("rate limit") || code("quota") || code("too many") {
        "The AI provider is busy or out of quota. Try again in a moment.".into()
    } else if code("500")
        || code("502")
        || code("503")
        || code("504")
        || code("overload")
        || code("unavailable")
        || code("bad gateway")
    {
        "The AI provider is not answering right now. Try again in a moment.".into()
    } else if code("timed out")
        || code("timeout")
        || code("connect")
        || code("network")
        || code("dns")
        || code("unreachable")
    {
        "Could not reach the AI provider. Check the connection and try again.".into()
    } else if m.trim().is_empty() {
        "No reply came back.".into()
    } else if status == 0
        && msg.trim().chars().count() <= 160
        && !msg.contains(['{', '}', '<', '>'])
        && !msg
            .split(|c: char| !c.is_ascii_digit())
            .any(|d| d.len() == 3)
    {
        // Memora's own short messages are already plain; raw provider bodies are not.
        msg.trim().to_string()
    } else {
        "Something went wrong with this reply.".into()
    }
}

/// The question Mnemo asked in the last reply (answered right after it).
fn last_ask() -> &'static std::sync::Mutex<Option<Value>> {
    static ASK: std::sync::OnceLock<std::sync::Mutex<Option<Value>>> = std::sync::OnceLock::new();
    ASK.get_or_init(Default::default)
}

/// Mnemo asked something: pick an option (or type another answer) and send it, as often as
/// it asks again.
fn answer_asks(link: &Link, theme: &ColorfulTheme, id: &str, model: &str) -> Result<()> {
    loop {
        let Some(q) = last_ask().lock().ok().and_then(|mut a| a.take()) else {
            return Ok(());
        };
        let opts: Vec<&Value> = q["options"].as_array().into_iter().flatten().collect();
        let mut items: Vec<String> = opts
            .iter()
            .map(|o| {
                let label = o["label"].as_str().unwrap_or("");
                match o["description"].as_str() {
                    Some(d) if !d.is_empty() => format!("{label}  {}", style(d).dim()),
                    _ => label.to_string(),
                }
            })
            .collect();
        if q["allow_other"] != false {
            items.push("Other (type your answer)".into());
        }
        let Some(i) = Select::with_theme(theme)
            .with_prompt(q["question"].as_str().unwrap_or("Mnemo asks"))
            .items(&items)
            .default(0)
            .interact_opt()?
        else {
            return Ok(());
        };
        let to = q["id"].as_str().unwrap_or("");
        let (text, answer) = if i < opts.len() {
            (
                opts[i]["label"].as_str().unwrap_or("").to_string(),
                json!({"to": to, "approve": opts[i]["approve"] == true}),
            )
        } else {
            let t: String = Input::with_theme(theme)
                .with_prompt("your answer")
                .interact_text()?;
            (t, json!({"to": to, "other": true}))
        };
        let mut body = json!({"text": text, "answer": answer});
        if !model.is_empty() {
            body["model"] = json!(model);
        }
        stream_reply(link, &format!("/api/assistant/sessions/{id}/chat"), body)?;
    }
}

fn send(link: &Link, id: &str, text: &str, model: &str, attach: &[Value]) -> Result<()> {
    let mut body = json!({ "text": text });
    if !model.is_empty() {
        body["model"] = json!(model);
    }
    if !attach.is_empty() {
        body["attach"] = json!(attach
            .iter()
            .map(|a| json!({"kind": a["kind"], "path": a["path"]}))
            .collect::<Vec<_>>());
    }
    stream_reply(link, &format!("/api/assistant/sessions/{id}/chat"), body)
}

/// Stream one reply (from `/chat` or `/rerun`) to the terminal.
fn stream_reply(link: &Link, path: &str, body: Value) -> Result<()> {
    let mut out = std::io::stdout();
    let mut started = false;
    let mut at_line_start = true;
    let head = |out: &mut std::io::Stdout, started: &mut bool| {
        if !*started {
            let _ = write!(out, "{} ", style(NAME).magenta().bold());
            *started = true;
        }
    };
    // What the reply did, for the one-line summary at the end.
    let (mut steps, mut failed, mut thinking) = (0u32, 0u32, false);
    let started_at = std::time::Instant::now();
    let res = link.stream(path, body, |ev| match ev["type"].as_str().unwrap_or("") {
        "text" => {
            if thinking {
                let _ = writeln!(out);
                at_line_start = true;
                thinking = false;
            }
            head(&mut out, &mut started);
            let d = ev["delta"].as_str().unwrap_or("");
            let _ = write!(out, "{d}");
            at_line_start = d.ends_with('\n');
            let _ = out.flush();
        }
        "thinking" => {
            let d = ev["delta"].as_str().unwrap_or("");
            if !thinking {
                if !at_line_start {
                    let _ = writeln!(out);
                }
                let _ = write!(out, "  {} ", style("thinking:").dim().italic());
                thinking = true;
            }
            let _ = write!(out, "{}", style(d.replace('\n', "\n  ")).dim());
            at_line_start = false;
            let _ = out.flush();
        }
        // Notes, folders and images Mnemo hands over: a list under the reply, not a step.
        "tool_start" if ev["name"] == "show_items" => {}
        "tool_end" if ev["name"] == "show_items" => {
            if !at_line_start {
                let _ = writeln!(out);
            }
            for it in ev["shown"].as_array().into_iter().flatten() {
                let kind = it["kind"].as_str().unwrap_or("");
                let path = it["path"].as_str().unwrap_or("");
                let _ = writeln!(
                    out,
                    "  {} {:<6} {}",
                    style("↳").cyan(),
                    kind,
                    if kind == "vault" {
                        "your notes"
                    } else if path.is_empty() {
                        "All notes"
                    } else {
                        path
                    }
                );
            }
            at_line_start = true;
        }
        "tool_start" => {
            steps += 1;
            thinking = false;
            if !at_line_start {
                let _ = writeln!(out);
            }
            let name = ev["name"].as_str().unwrap_or("");
            let sub = subject(&ev["args"]);
            let _ = write!(
                out,
                "  {} {}{}",
                style("⚙").dim(),
                style(tool_words(name)).dim(),
                if sub.is_empty() {
                    String::new()
                } else {
                    style(format!(" {sub}")).dim().to_string()
                }
            );
            let _ = out.flush();
            at_line_start = false;
        }
        "tool_end" => {
            let ok = ev["ok"] == true;
            if !ok {
                failed += 1;
            }
            let line = ev["summary"].as_str().unwrap_or("");
            let ms = ev["ms"].as_u64().unwrap_or(0);
            let mark = if ok {
                style("✓").green()
            } else {
                style("✗").red()
            };
            let _ = writeln!(out, "  {mark} {}", style(format!("{line} · {ms} ms")).dim());
            at_line_start = true;
        }
        "ask" => {
            if !at_line_start {
                let _ = writeln!(out);
            }
            let _ = writeln!(
                out,
                "  {} {}",
                style("?").cyan().bold(),
                style(ev["question"].as_str().unwrap_or("")).bold()
            );
            if let Ok(mut a) = last_ask().lock() {
                *a = Some(ev.clone());
            }
            at_line_start = true;
        }
        "steered" => {
            if !at_line_start {
                let _ = writeln!(out);
            }
            let _ = writeln!(
                out,
                "  {} {}",
                style("↪ you").cyan(),
                ev["text"].as_str().unwrap_or("")
            );
            at_line_start = true;
        }
        "compacting" | "compacted" => {
            if !at_line_start {
                let _ = writeln!(out);
            }
            let line = if ev["type"] == "compacting" {
                "compacting the chat's memory…".to_string()
            } else {
                format!(
                    "{} older messages compacted into a summary",
                    ev["messages"].as_u64().unwrap_or(0)
                )
            };
            let _ = writeln!(out, "  {} {}", style("↻").cyan(), style(line).dim());
            at_line_start = true;
        }
        "notice" => {
            if !at_line_start {
                let _ = writeln!(out);
            }
            let _ = writeln!(out, "  {}", style(ev["text"].as_str().unwrap_or("")).dim());
            at_line_start = true;
        }
        // A sub-agent at work: one dim line for each thing it does.
        "sub" => {
            let agent = ev["agent"].as_str().unwrap_or("sub-agent");
            let line = match ev["phase"].as_str().unwrap_or("") {
                "start" => Some(format!(
                    "{agent} ({}) starts",
                    ev["model"].as_str().unwrap_or("")
                )),
                "tool" => Some(format!("{agent}: {}", ev["name"].as_str().unwrap_or(""))),
                "ask" => Some(format!(
                    "{agent} asks: {}",
                    ev["question"].as_str().unwrap_or("")
                )),
                "answer" => Some(format!(
                    "Mnemo answers {agent}: {}",
                    ev["answer"].as_str().unwrap_or("")
                )),
                "done" => Some(format!("{agent} is done ({} steps)", ev["steps"])),
                "error" => Some(format!(
                    "{agent} failed: {}",
                    ev["message"].as_str().unwrap_or("")
                )),
                _ => None,
            };
            if let Some(line) = line {
                if !at_line_start {
                    let _ = writeln!(out);
                }
                let _ = writeln!(out, "    {} {}", style("·").dim(), style(line).dim());
                at_line_start = true;
            }
        }
        "fallback" => {
            if !at_line_start {
                let _ = writeln!(out);
            }
            let line = format!(
                "{} did not answer ({}); carrying on with {}",
                ev["from"].as_str().unwrap_or("the model"),
                ev["reason"].as_str().unwrap_or("error"),
                ev["model"].as_str().unwrap_or("the next model")
            );
            let _ = writeln!(out, "  {} {}", style("↪").yellow(), style(line).dim());
            at_line_start = true;
        }
        "error" => {
            if !at_line_start {
                let _ = writeln!(out);
            }
            // A short, plain message; the provider's full error waits for /details.
            let full = ev["message"].as_str().unwrap_or("").to_string();
            let short = friendly_error(&full);
            if let Ok(mut e) = last_error().lock() {
                *e = Some(full);
            }
            let _ = writeln!(out, "{} {short}", style("error:").red().bold());
            let _ = writeln!(
                out,
                "  {}",
                style("/retry to try again · /details for the full error").dim()
            );
            at_line_start = true;
        }
        "done" => {
            if !at_line_start {
                let _ = writeln!(out);
            }
            let (i, o) = (
                ev["input_tokens"].as_u64().unwrap_or(0),
                ev["output_tokens"].as_u64().unwrap_or(0),
            );
            let mut bits = Vec::new();
            if steps > 0 {
                bits.push(format!("{steps} step{}", if steps == 1 { "" } else { "s" }));
            }
            if failed > 0 {
                bits.push(format!("{failed} failed"));
            }
            bits.push(format!("{:.1} s", started_at.elapsed().as_secs_f64()));
            if i + o > 0 {
                bits.push(format!("{i} in · {o} out"));
            }
            if let (Some(u), Some(w)) = (
                ev["context"]["used"].as_i64(),
                ev["context"]["window"].as_i64(),
            ) {
                if w > 0 {
                    bits.push(format!(
                        "memory {}/{} ({}%)",
                        tokens(u),
                        tokens(w),
                        u * 100 / w
                    ));
                }
            }
            let _ = writeln!(out, "  {}", style(bits.join(" · ")).dim());
            at_line_start = true;
        }
        _ => {}
    });
    if !at_line_start {
        println!();
    }
    res
}

// ---------------- setup ----------------

/// 128000 -> "128k", 1000000 -> "1M".
fn tokens(n: i64) -> String {
    if n >= 1_000_000 {
        format!("{}M", (n as f64 / 1_000_000.0 * 10.0).round() / 10.0)
    } else if n >= 1000 {
        format!("{}k", n / 1000)
    } else {
        n.to_string()
    }
}

fn kind_name(kind: &str) -> &'static str {
    match kind {
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        _ => "OpenAI-compatible",
    }
}

fn setup(link: &Link, theme: &ColorfulTheme) -> Result<()> {
    loop {
        let state = link.get("/api/assistant/state")?;
        let providers = state["providers"].as_array().cloned().unwrap_or_default();
        let mut items: Vec<String> = providers
            .iter()
            .map(|p| {
                let id = p["id"].as_str().unwrap_or("");
                let hint = p["key_hint"].as_str().unwrap_or("");
                let models = state["models"]
                    .as_array()
                    .map_or(0, |m| m.iter().filter(|x| x["provider_id"] == id).count());
                format!(
                    "{} {}  {}",
                    if p["enabled"] == true {
                        style("●").green()
                    } else {
                        style("○").dim()
                    },
                    p["label"].as_str().unwrap_or(id),
                    style(format!(
                        "{} · {} · {models} models · {id}",
                        kind_name(p["kind"].as_str().unwrap_or("")),
                        if hint.is_empty() {
                            "no key".to_string()
                        } else {
                            format!("key ••••{hint}")
                        },
                    ))
                    .dim()
                )
            })
            .collect();
        let n = items.len();
        items.push(format!("{}  Add provider", style("+").green().bold()));
        items.push("Models: pin, hide, default, add".to_string());
        items.push(format!(
            "Default model: {}",
            state["prefs"]["default_model"]
                .as_str()
                .unwrap_or("first pinned")
        ));
        items.push("Done".to_string());
        let Some(i) = Select::with_theme(theme)
            .with_prompt(format!(
                "{NAME} setup (the same settings as Settings, Mnemo in the browser)"
            ))
            .items(&items)
            .default(n)
            .interact_opt()?
        else {
            return Ok(());
        };
        if i < n {
            provider_menu(link, theme, &providers[i])?;
        } else if i == n {
            add_provider(link, theme, None)?;
        } else if i == n + 1 {
            models(link, theme)?;
        } else if i == n + 2 {
            if let Some(m) = pick_model(
                theme,
                &state,
                state["prefs"]["default_model"].as_str().unwrap_or(""),
            )? {
                link.post("/api/assistant/prefs", json!({ "default_model": m }))?;
                ok(&format!("Default model: {m}"));
            }
        } else {
            return Ok(());
        }
    }
}

fn provider_menu(link: &Link, theme: &ColorfulTheme, p: &Value) -> Result<()> {
    let id = p["id"].as_str().unwrap_or("").to_string();
    let label = p["label"].as_str().unwrap_or(&id).to_string();
    let on = p["enabled"] == true;
    let acts = [
        "Test the connection",
        "Fetch models",
        if on {
            "Turn off (hide its models in chats)"
        } else {
            "Turn on"
        },
        "Edit name, address or key",
        "Delete",
        "Back",
    ];
    let Some(a) = Select::with_theme(theme)
        .with_prompt(&label)
        .items(&acts)
        .default(0)
        .interact_opt()?
    else {
        return Ok(());
    };
    match a {
        0 => {
            let r = link.post("/api/assistant/providers/test", json!({ "id": id }))?;
            if r["ok"] == true {
                ok(&format!(
                    "Connected in {} ms · {} models available",
                    r["ms"].as_u64().unwrap_or(0),
                    r["models"].as_u64().unwrap_or(0)
                ));
            } else {
                println!(
                    "{} {}",
                    style("✗").red().bold(),
                    r["error"].as_str().unwrap_or("the provider did not answer")
                );
            }
        }
        1 => fetch(link, &id)?,
        2 => {
            link.post(
                "/api/assistant/providers",
                json!({ "id": id, "enabled": !on }),
            )?;
            ok(if on {
                "Off: its models are hidden in chats."
            } else {
                "On."
            });
        }
        3 => add_provider(link, theme, Some(p))?,
        4 if Confirm::with_theme(theme)
            .with_prompt(format!("Delete {label}, its key and its models?"))
            .default(false)
            .interact_opt()?
            == Some(true) =>
        {
            link.post("/api/assistant/providers/delete", json!({ "id": id }))?;
            ok("Deleted.");
        }
        _ => {}
    }
    Ok(())
}

/// Add a provider, or edit `prev` (its id stays).
fn add_provider(link: &Link, theme: &ColorfulTheme, prev: Option<&Value>) -> Result<()> {
    let kinds = ["openai", "anthropic", "custom"];
    let names: Vec<&str> = kinds.iter().map(|k| kind_name(k)).collect();
    let cur = prev
        .and_then(|p| kinds.iter().position(|k| p["kind"] == *k))
        .unwrap_or(0);
    let Some(k) = Select::with_theme(theme)
        .with_prompt("Type")
        .items(&names)
        .default(cur)
        .interact_opt()?
    else {
        return Ok(());
    };
    let kind = kinds[k];
    let label: String = Input::with_theme(theme)
        .with_prompt("Name")
        .default(
            prev.and_then(|p| p["label"].as_str())
                .unwrap_or(kind_name(kind))
                .to_string(),
        )
        .interact_text()?;
    let mut body = json!({ "kind": kind, "label": label.trim() });
    if let Some(p) = prev {
        body["id"] = p["id"].clone();
    } else {
        let id: String = Input::with_theme(theme)
            .with_prompt("ID (a-z, 0-9, '-'; empty = made from the name)")
            .allow_empty(true)
            .interact_text()?;
        if !id.trim().is_empty() {
            body["id"] = json!(id.trim().to_lowercase());
        }
    }
    if kind != "anthropic" {
        let styles = ["Chat Completions", "Responses API"];
        let cur = prev.map_or(0, |p| usize::from(p["api_style"] == "responses"));
        let Some(st) = Select::with_theme(theme)
            .with_prompt("API")
            .items(&styles)
            .default(cur)
            .interact_opt()?
        else {
            return Ok(());
        };
        body["api_style"] = json!(if st == 1 { "responses" } else { "chat" });
    }
    let base_default = prev
        .and_then(|p| p["base_url"].as_str())
        .unwrap_or(match kind {
            "openai" => "https://api.openai.com/v1",
            "anthropic" => "https://api.anthropic.com/v1",
            _ => "",
        })
        .to_string();
    let base: String = Input::with_theme(theme)
        .with_prompt(if kind == "custom" {
            "Base URL (the server's /v1 address)"
        } else {
            "Base URL"
        })
        .default(base_default)
        .allow_empty(kind != "custom")
        .interact_text()?;
    body["base_url"] = json!(base.trim());
    let key = Password::with_theme(theme)
        .with_prompt(if prev.is_some() {
            "API key (empty keeps the saved one)"
        } else {
            "API key"
        })
        .allow_empty_password(true)
        .interact()?;
    if !key.trim().is_empty() {
        body["api_key"] = json!(key.trim());
    }
    let r = link.post("/api/assistant/providers", body)?;
    ok("Saved. The key is sealed on the server and never shown again.");
    if prev.is_none() {
        if let Some(id) = r["saved"].as_str() {
            fetch(link, id)?;
        }
    }
    Ok(())
}

fn fetch(link: &Link, id: &str) -> Result<()> {
    match link.post("/api/assistant/models/fetch", json!({ "provider": id })) {
        Ok(v) => ok(&format!(
            "{} models listed, with the limits the provider reports. Pin the ones you use in Models.",
            v["fetched"].as_u64().unwrap_or(0)
        )),
        Err(e) => println!(
            "{} could not list the models: {e:#}. Add them by name in Models.",
            style("!").yellow().bold()
        ),
    }
    Ok(())
}

fn models(link: &Link, theme: &ColorfulTheme) -> Result<()> {
    loop {
        let state = link.get("/api/assistant/state")?;
        let list: Vec<Value> = state["models"].as_array().cloned().unwrap_or_default();
        let def = state["prefs"]["default_model"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let mut items = vec!["+ Add a model by name".to_string()];
        for m in &list {
            let key = format!(
                "{}/{}",
                m["provider_id"].as_str().unwrap_or(""),
                m["model_id"].as_str().unwrap_or("")
            );
            let limits = [
                m["context_window"]
                    .as_i64()
                    .map(|n| format!("{} context", tokens(n))),
                m["max_output"]
                    .as_i64()
                    .map(|n| format!("{} reply", tokens(n))),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" · ");
            items.push(format!(
                "{} {}{}{}{}",
                if m["pinned"] == true { "★" } else { " " },
                key,
                if limits.is_empty() {
                    String::new()
                } else {
                    style(format!(" · {limits}")).dim().to_string()
                },
                if m["hidden"] == true {
                    style(" · hidden").dim().to_string()
                } else {
                    String::new()
                },
                if key == def {
                    style(" · default").green().to_string()
                } else {
                    String::new()
                }
            ));
        }
        items.push("Back".into());
        let Some(i) = Select::with_theme(theme)
            .with_prompt("Models")
            .items(&items)
            .default(0)
            .max_length(18)
            .interact_opt()?
        else {
            return Ok(());
        };
        if i == items.len() - 1 {
            return Ok(());
        }
        if i == 0 {
            let providers: Vec<String> = state["providers"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|p| p["id"].as_str().map(str::to_string))
                .collect();
            if providers.is_empty() {
                println!("Set up a provider first.");
                continue;
            }
            let Some(p) = Select::with_theme(theme)
                .with_prompt("Provider")
                .items(&providers)
                .default(0)
                .interact_opt()?
            else {
                continue;
            };
            let id: String = Input::with_theme(theme)
                .with_prompt("Model id")
                .interact_text()?;
            if !id.trim().is_empty() {
                link.post(
                    "/api/assistant/models",
                    json!({ "provider": providers[p], "model": id.trim(), "pinned": true }),
                )?;
                ok("Added and pinned.");
            }
            continue;
        }
        let m = &list[i - 1];
        let (p, id) = (
            m["provider_id"].as_str().unwrap_or(""),
            m["model_id"].as_str().unwrap_or(""),
        );
        let key = format!("{p}/{id}");
        let pinned = m["pinned"] == true;
        let hidden = m["hidden"] == true;
        let acts = [
            if pinned { "Unpin" } else { "Pin" },
            if hidden {
                "Show in chats"
            } else {
                "Hide from chats"
            },
            if key == def {
                "Stop using as default"
            } else {
                "Make default"
            },
            "Remove",
            "Back",
        ];
        let Some(a) = Select::with_theme(theme)
            .with_prompt(key.clone())
            .items(&acts)
            .default(0)
            .interact_opt()?
        else {
            continue;
        };
        match a {
            0 => {
                link.post(
                    "/api/assistant/models",
                    json!({ "provider": p, "model": id, "pinned": !pinned }),
                )?;
            }
            1 => {
                link.post(
                    "/api/assistant/models",
                    json!({ "provider": p, "model": id, "hidden": !hidden }),
                )?;
            }
            2 => {
                let v = if key == def { Value::Null } else { json!(key) };
                link.post("/api/assistant/prefs", json!({ "default_model": v }))?;
            }
            3 => {
                link.post(
                    "/api/assistant/models/delete",
                    json!({ "provider": p, "model": id }),
                )?;
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::friendly_error;

    #[test]
    fn provider_errors_read_plainly() {
        assert!(
            friendly_error("provider answered 503 Service Unavailable: {\"error\":\"x\"}")
                .contains("not answering")
        );
        assert!(friendly_error("HTTP 404: model gpt-x not found").contains("could not find"));
        assert!(friendly_error("401 Unauthorized").contains("key"));
        assert!(friendly_error("429 Too Many Requests").contains("busy"));
        assert!(friendly_error("error sending request: connection refused").contains("reach"));
        assert_eq!(
            friendly_error("Stopped before it finished."),
            "Stopped before it finished."
        );
        assert_eq!(
            friendly_error("{\"weird\":true}"),
            "Something went wrong with this reply."
        );
        assert!(friendly_error(
            "the provider answered 503: [x] [502]: proxy.example | 502: Bad gateway, Ray 4011ab"
        )
        .contains("not answering"));
    }
}
