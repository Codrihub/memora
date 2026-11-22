//! Models for each job besides the chat model: one that reads images, one that makes them,
//! one that reads aloud and one that listens; and sub-agents, other models Mnemo hands a task
//! to (several at once) and hears back from.
//!
//! All kept as assistant preferences: `roles` `{vision, image, tts, stt}` (model keys),
//! `voice` (for reading aloud). Sub-agents need no setup: Mnemo names them as it starts them.

use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::post,
    Extension, Router,
};
use memora_state::assistant::Store;
use serde_json::{json, Value};
use std::collections::HashMap;

use super::providers::{self, Endpoint, Img, Msg, Options, ToolCall, ToolDef};
use super::{browser_only, endpoint, fail, store, uploads, NAME};
use crate::api::{bad, csrf_fail, csrf_ok};
use crate::{ApiKeyCaller, AppState};

pub(crate) const ROLES: &str = "roles";
pub(crate) const VOICE: &str = "voice";
pub(crate) const SUBAGENTS: &str = "subagents";
/// The owner's pick of model for a sub-agent in one chat (from its card): `{chat: {agent: key}}`.
pub(crate) const SUB_MODELS: &str = "sub_models";

/// The model the owner switched a sub-agent to in chat `chat`, if any.
pub(crate) fn sub_model(store: &Store, chat: &str, agent: &str) -> Option<String> {
    prefs(store)
        .get(SUB_MODELS)
        .and_then(|m| m[chat][agent.to_lowercase()].as_str().map(str::to_string))
        .filter(|k| k.contains('/'))
}

/// `POST /api/assistant/sessions/{id}/subagent-model` `{agent, model}`: switch a sub-agent's
/// model in this chat, like the chat's own model; it takes over from the sub-agent's next step
/// (also while it runs) and for follow-ups. An empty model goes back to Auto.
async fn h_sub_model(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
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
    let agent: String = b["agent"]
        .as_str()
        .unwrap_or("")
        .trim()
        .chars()
        .take(24)
        .collect();
    let model = b["model"].as_str().unwrap_or("").trim().to_string();
    if agent.is_empty() || (!model.is_empty() && !is_key(&json!(model))) {
        return bad("send {agent, model} (model as provider/model, or empty for Auto)");
    }
    if store.session(&id).ok().flatten().is_none() {
        return fail(StatusCode::NOT_FOUND, "chat not found");
    }
    let mut all = prefs(store)
        .get(SUB_MODELS)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let chat = all.entry(id.clone()).or_insert_with(|| json!({}));
    if let Some(o) = chat.as_object_mut() {
        if model.is_empty() {
            o.remove(&agent.to_lowercase());
        } else {
            o.insert(agent.to_lowercase(), json!(model));
        }
    }
    all.retain(|_, v| v.as_object().is_some_and(|o| !o.is_empty()));
    let v = if all.is_empty() {
        Value::Null
    } else {
        Value::Object(all)
    };
    if let Err(e) = store.set_pref(SUB_MODELS, &v) {
        return bad(&e);
    }
    Json(json!({"ok": true, "agent": agent, "model": model})).into_response()
}

/// Ask the owner before sub-agents run (default yes): they spend tokens of their own.
pub(crate) const CONFIRM: &str = "confirm_subagents";

pub(crate) const DESCRIBE_IMAGE: &str = "describe_image";
pub(crate) const GENERATE_IMAGE: &str = "generate_image";
pub(crate) const DELEGATE: &str = "delegate";

const ROLE_NAMES: &[&str] = &["vision", "image", "tts", "stt"];
const VOICES: &[&str] = &[
    "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse",
];
/// Steps a sub-agent may take for one task.
const SUB_STEPS: usize = 16;
const SPEAK_MAX: usize = 4_096;
const AUDIO_MAX: usize = 25 * 1_048_576;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/assistant/sessions/{id}/subagent-model",
            post(h_sub_model),
        )
        .route("/api/assistant/speak", post(h_speak))
        .route(
            "/api/assistant/transcribe",
            post(h_transcribe).layer(axum::extract::DefaultBodyLimit::max(AUDIO_MAX + 1024)),
        )
}

fn prefs(store: &Store) -> serde_json::Map<String, Value> {
    store.prefs().unwrap_or_default()
}

fn is_key(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|x| x.contains('/') && x.len() <= 260)
}

/// Check one of this module's preferences (`None`: not one of them).
pub(crate) fn valid_pref(_store: &Store, k: &str, v: &Value) -> Option<bool> {
    Some(match k {
        ROLES => {
            v.is_null()
                || v.as_object().is_some_and(|o| {
                    o.iter().all(|(r, m)| {
                        ROLE_NAMES.contains(&r.as_str())
                            && (m.is_null() || m.as_str() == Some("") || is_key(m))
                    })
                })
        }
        VOICE => v.is_null() || v.as_str().is_some_and(|x| VOICES.contains(&x)),
        CONFIRM => v.is_null() || v.is_boolean(),
        // Named sub-agents set up in Settings are gone (2.2.1): only clearing the old value.
        SUBAGENTS => v.is_null(),
        _ => return None,
    })
}

/// The model key set for a job, if any.
pub(crate) fn role(store: &Store, job: &str) -> Option<String> {
    prefs(store)
        .get(ROLES)
        .and_then(|r| r[job].as_str())
        .filter(|k| k.contains('/'))
        .map(str::to_string)
}

/// The provider, model and endpoint behind a model key.
fn open(st: &AppState, store: &Store, key: &str) -> Result<(String, Endpoint), String> {
    let (p, m) = key
        .split_once('/')
        .ok_or_else(|| format!("{key} is not a model"))?;
    let ep = endpoint(st, store, p)?;
    Ok((m.to_string(), ep))
}

fn open_role(
    st: &AppState,
    store: &Store,
    job: &str,
    what: &str,
) -> Result<(String, String, Endpoint), String> {
    let key = role(store, job).ok_or_else(|| {
        format!("no model is set to {what} (Settings, {NAME}, Models for each job)")
    })?;
    let (m, ep) = open(st, store, &key)?;
    Ok((key, m, ep))
}

/// The tools for the jobs that have a model (`sub`: for a sub-agent, which cannot delegate).
pub(crate) fn defs(_st: &AppState, store: &Store, sub: bool) -> Vec<ToolDef> {
    let mut out = Vec::new();
    if role(store, "vision").is_some() {
        out.push(ToolDef {
            name: DESCRIBE_IMAGE.into(),
            description: "Have the image model look at a picture in the vault and tell you what it shows, read its \
text or answer a question about it (check a design, audit a screenshot, compare with a note). Use it when you \
cannot see pictures yourself, or for a careful second look."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "The picture's vault path (or as the note writes it)"},
                    "note": {"type": "string", "description": "The note that shows it, when the path is relative to it"},
                    "question": {"type": "string", "description": "What to look for; default: describe it fully, with any text in it"}
                },
                "required": ["path"],
                "additionalProperties": false
            }),
        });
    }
    if role(store, "image").is_some() {
        out.push(ToolDef {
            name: GENERATE_IMAGE.into(),
            description: "Make a new picture from a description with the image model. It shows in the chat; give \
note to also put it in that note's folder and at the end of the note."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "What the picture shows: subject, style, colours, framing"},
                    "size": {"type": "string", "enum": ["1024x1024", "1536x1024", "1024x1536"], "description": "Default 1024x1024"},
                    "note": {"type": "string", "description": "A note to keep it in (optional)"},
                    "name": {"type": "string", "description": "File name to keep, e.g. 'cover.png'"}
                },
                "required": ["prompt"],
                "additionalProperties": false
            }),
        });
    }
    if !sub {
        out.push(ToolDef {
            name: DELEGATE.into(),
            description: format!(
                "Hand one task to a sub-agent: another model run with the same vault tools that works on it alone \
and answers you. Call it several times in one step to have several work at the same time (say one note or folder \
each). Give everything it needs in task (paths, what to look for, the form of the answer); it cannot see this \
chat or ask the owner, but it may ask you a question, which you answer. Send a follow-up (follow_up: true) to \
talk with the same sub-agent again. The owner may be asked to OK the extra tokens first; when they say yes, call \
delegate again with the same tasks. Then answer the owner from what they found.\n\
Name it with a short name of your choosing (Reader, Audit-1, Helper).\n\
Which model it runs on: leave model out and it runs like a chat does: the owner's default model, then their \
fallback models. Give model only when the owner asks for a specific one: the exact id from the list below, \
or the name as the owner says it (for example a model id without its provider). Never swap in a different \
model when the one asked for is not in the list; tell the owner instead.\n\
{}",
                models_text(store)
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "agent": {"type": "string", "description": "A sub-agent's name, or a short name for a general helper"},
                    "task": {"type": "string", "description": "The whole task, self-contained"},
                    "model": {"type": "string", "description": "Only when the owner asked for a model: its id from the models available (provider/model), or the model name as the owner wrote it"},
                    "follow_up": {"type": "boolean", "description": "true: go on with this sub-agent's earlier conversation in this chat (a correction, a next step, an answer to what it said); default false starts fresh"}
                },
                "required": ["agent", "task"],
                "additionalProperties": false
            }),
        });
    }
    out
}

/// Every model a sub-agent can run on (pinned first, hidden ones left out), as
/// `provider/model`.
fn usable_keys(store: &Store) -> Vec<String> {
    let providers = store.providers().unwrap_or_default();
    let mut ms: Vec<_> = store
        .models()
        .unwrap_or_default()
        .into_iter()
        .filter(|m| {
            !m.hidden
                && providers.iter().any(|p| {
                    p.id == m.provider_id
                        && p.enabled
                        && (!p.api_key.is_empty() || p.kind == "custom")
                })
        })
        .collect();
    ms.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| a.provider_id.cmp(&b.provider_id))
            .then_with(|| a.model_id.cmp(&b.model_id))
    });
    ms.into_iter()
        .take(MODELS_LISTED)
        .map(|m| format!("{}/{}", m.provider_id, m.model_id))
        .collect()
}

/// Models listed to Mnemo for its sub-agents (a router can carry hundreds).
const MODELS_LISTED: usize = 400;

/// What the delegate tool says about models: the owner's default and fallbacks (what a
/// sub-agent runs on when no model is asked for), then every model it may be given.
fn models_text(store: &Store) -> String {
    let p = prefs(store);
    let default = p
        .get("default_model")
        .and_then(Value::as_str)
        .filter(|m| m.contains('/'))
        .map(str::to_string);
    let fallbacks: Vec<String> = p
        .get(super::FALLBACKS)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    let all = usable_keys(store);
    let mut out = format!(
        "The owner's default model: {}. Fallback models: {}.\n",
        default.as_deref().unwrap_or("none set"),
        if fallbacks.is_empty() {
            "none".to_string()
        } else {
            fallbacks.join(", ")
        }
    );
    if all.is_empty() {
        out.push_str("Models available: only the chat's own model.");
    } else {
        out.push_str(&format!(
            "Models available ({}, the full list): {}",
            all.len(),
            all.join(", ")
        ));
    }
    out
}

/// A model the owner named, as `provider/model`: an exact id, or the name without its provider
/// (the model id without its provider), or a model's label; any letter case. `None` when no usable
/// model matches, or the name fits several.
pub(crate) fn find_model(store: &Store, name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let keys = usable_keys(store);
    if let Some(k) = keys.iter().find(|k| k.eq_ignore_ascii_case(name)) {
        return Some(k.clone());
    }
    let labels = store.models().unwrap_or_default();
    let hits: Vec<&String> = keys
        .iter()
        .filter(|k| {
            k.split_once('/')
                .is_some_and(|(_, m)| m.eq_ignore_ascii_case(name))
                || labels.iter().any(|m| {
                    !m.label.is_empty()
                        && m.label.eq_ignore_ascii_case(name)
                        && format!("{}/{}", m.provider_id, m.model_id) == **k
                })
        })
        .collect();
    (hits.len() == 1).then(|| hits[0].clone())
}

/// The model asked for in a delegate call, checked: `Ok(None)` when none was asked,
/// `Err` (for Mnemo, with near names) when it is not a model here.
fn asked_model(store: &Store, args: &Value) -> Result<Option<String>, String> {
    let Some(name) = args["model"]
        .as_str()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    else {
        return Ok(None);
    };
    if let Some(k) = find_model(store, name) {
        return Ok(Some(k));
    }
    let low = name.to_lowercase();
    let near: Vec<String> = usable_keys(store)
        .into_iter()
        .filter(|k| k.to_lowercase().contains(&low))
        .take(8)
        .collect();
    Err(if near.is_empty() {
        format!("Not started: there is no model \"{name}\" here. Tell the owner, or leave model out to use their default model.")
    } else {
        format!(
            "Not started: \"{name}\" fits more than one model or none exactly. Close ones: {}. Ask the owner which, or give the exact id.",
            near.join(", ")
        )
    })
}

/// Look at a vault picture with the image model.
pub(crate) fn describe_image(st: &AppState, store: &Store, args: &Value) -> Result<Value, String> {
    let (key, model, ep) = open_role(st, store, "vision", "read images")?;
    // Find and stage it the way view_image does, then hand it over.
    let staged = super::view_image(st, args)?;
    let Some(up) = staged["image"].as_str().map(str::to_string) else {
        return Ok(staged);
    };
    let (_, _, bytes) = uploads::read(st, &up)?;
    uploads::remove(st, &up);
    let media = uploads::sniff(&bytes)
        .map(|(_, m)| m)
        .unwrap_or("image/png");
    let question = args["question"]
        .as_str()
        .filter(|q| !q.trim().is_empty())
        .unwrap_or("Describe this picture fully: what it shows, its layout, and every piece of text in it, word for word.");
    let opts = Options {
        temperature: None,
        max_output: Some(1500),
        think: false,
        effort: None,
    };
    let turn = providers::run(
        &ep,
        &model,
        "You look at one picture for an assistant that cannot see it. Answer its question precisely and plainly; \
say what you are unsure about.",
        &[Msg::UserImages {
            text: question.to_string(),
            images: vec![Img {
                id: up,
                media: media.into(),
                data: uploads::base64(&bytes),
            }],
        }],
        &[],
        &opts,
        &mut |_| true,
    )?;
    Ok(json!({"model": key, "path": staged["path"], "text": turn.text.trim()}))
}

/// For a chat model that cannot see: the image model describes the pictures in the history
/// (the newest few) and each turns into text. How many it described.
pub(crate) fn describe_history(st: &AppState, store: &Store, history: &mut [Msg]) -> usize {
    let Ok((key, model, ep)) = open_role(st, store, "vision", "read images") else {
        return 0;
    };
    let opts = Options {
        temperature: None,
        max_output: Some(1200),
        think: false,
        effort: None,
    };
    let mut left = 4usize;
    let mut done = 0;
    for m in history.iter_mut().rev() {
        let Msg::UserImages { text, images } = m else {
            continue;
        };
        let mut notes = Vec::new();
        let mut seen = 0;
        for img in images.iter() {
            // Each picture is described once (its upload never changes).
            if let Some(d) = described()
                .lock()
                .ok()
                .and_then(|c| c.get(&img.id).cloned())
            {
                seen += 1;
                notes.push(format!("(Image {}, as {key} sees it: {d})", img.id));
                continue;
            }
            if left == 0 || img.data.is_empty() {
                notes.push(format!("(Image {}: not described.)", img.id));
                continue;
            }
            left -= 1;
            let r = providers::run(
                &ep,
                &model,
                "Describe this picture for an assistant that cannot see it: what it shows, its layout, and every \
piece of text in it, word for word. Plain and precise.",
                &[Msg::UserImages {
                    text: "Describe it.".into(),
                    images: vec![img.clone()],
                }],
                &[],
                &opts,
                &mut |_| true,
            );
            match r {
                Ok(t) => {
                    seen += 1;
                    let d = t.text.trim().to_string();
                    if let Ok(mut c) = described().lock() {
                        if c.len() > 500 {
                            c.clear();
                        }
                        c.insert(img.id.clone(), d.clone());
                    }
                    notes.push(format!("(Image {}, as {key} sees it: {d})", img.id));
                }
                Err(_) => notes.push(format!(
                    "(Image {}: the image model could not read it.)",
                    img.id
                )),
            }
        }
        // Only a message with at least one picture described turns into text here; the rest
        // fall back to their names.
        if seen > 0 {
            done += seen;
            *m = Msg::User(format!("{text}\n\n{}", notes.join("\n")));
        }
    }
    done
}

fn described() -> &'static std::sync::Mutex<HashMap<String, String>> {
    static D: std::sync::OnceLock<std::sync::Mutex<HashMap<String, String>>> =
        std::sync::OnceLock::new();
    D.get_or_init(Default::default)
}

/// Make a picture with the image model: staged for the chat, and kept in a note when asked.
pub(crate) fn generate_image(
    st: &AppState,
    store: &Store,
    who: &memora_mcp::Caller,
    args: &Value,
) -> Result<Value, String> {
    let (key, model, ep) = open_role(st, store, "image", "make images")?;
    let prompt = args["prompt"].as_str().unwrap_or("").trim();
    if prompt.is_empty() {
        return Err("prompt is required".into());
    }
    let size = args["size"].as_str().unwrap_or("1024x1024");
    let bytes = providers::image(&ep, &model, prompt, size)?;
    let Some((ext, _)) = uploads::sniff(&bytes) else {
        return Err(
            "the image model sent something that is not a PNG, JPEG, WebP or GIF picture".into(),
        );
    };
    let stem: String = args["name"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| {
            prompt
                .split_whitespace()
                .take(5)
                .collect::<Vec<_>>()
                .join("-")
        })
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .take(60)
        .collect();
    let stem = if stem.is_empty() {
        "image".to_string()
    } else {
        stem
    };
    let (up, name) = uploads::stage(st, &stem, ext, &bytes)?;
    let mut out = json!({"ok": true, "upload": up, "name": name, "model": key, "prompt": prompt});
    if let Some(note) = args["note"].as_str().filter(|n| !n.trim().is_empty()) {
        // A copy goes into the vault; the staged one stays for the chat to show.
        match super::place_image(
            st,
            who,
            &json!({"upload": up, "note": note, "name": name, "alt": prompt}),
        ) {
            Ok(v) => out["placed"] = v,
            Err(e) => out["placed_error"] = json!(e),
        }
    } else {
        out["message"] =
            json!("Shown in the chat. To keep it in a note, call place_image with this upload id.");
    }
    Ok(out)
}

pub(crate) fn confirm_first(store: &Store) -> bool {
    prefs(store)
        .get(CONFIRM)
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

fn tokens_label(n: i64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{}k", (n + 500) / 1_000)
    } else {
        n.to_string()
    }
}

/// The delegate calls of a step turned into one question for the owner (as an ask_owner call
/// with the first call's id): which sub-agents, on which models, and roughly what they cost.
/// Other calls of the step stay as they are.
pub(crate) fn confirm_calls(store: &Store, calls: &[ToolCall], fixed: i64) -> Vec<ToolCall> {
    let subs: Vec<&ToolCall> = calls.iter().filter(|c| c.name == DELEGATE).collect();
    let lines: Vec<String> = subs
        .iter()
        .map(|c| {
            let n = c.arguments["agent"].as_str().unwrap_or("?");
            let model = match asked_model(store, &c.arguments) {
                Err(_) => "a model that is not here".to_string(),
                Ok(asked) => super::resolve_model(store, asked.as_deref(), None)
                    .map(|(p, m)| format!("{p}/{m}"))
                    .unwrap_or_else(|_| "no model".into()),
            };
            let task: String = c.arguments["task"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(90)
                .collect();
            format!("{n} ({model}): {task}")
        })
        .collect();
    // Each step resends the sub-agent's prompt, tools and work so far: a short task takes a
    // few steps, a long one up to a dozen.
    let per = fixed.max(4_000) + 1_500;
    let (low, high) = (subs.len() as i64 * per * 2, subs.len() as i64 * per * 10);
    let count = if subs.len() == 1 {
        "1 sub-agent".to_string()
    } else {
        format!("{} sub-agents at once", subs.len())
    };
    let question = format!(
        "Run {count}? Each works on its own and uses its own tokens, roughly {} to {} in total.\n{}",
        tokens_label(low),
        tokens_label(high),
        lines.join("\n")
    );
    let ask = ToolCall {
        id: subs[0].id.clone(),
        name: super::ASK_OWNER.into(),
        arguments: json!({
            "question": question,
            "options": [
                {"label": "Run them", "description": "Use the extra tokens (changes to notes still follow the chat's mode)", "approve": true},
                {"label": "Not now", "description": format!("{NAME} goes on without sub-agents")}
            ],
            "allow_other": true,
            "subagents": true
        }),
    };
    let mut out: Vec<ToolCall> = calls
        .iter()
        .filter(|c| c.name != DELEGATE)
        .cloned()
        .collect();
    out.push(ask);
    out
}

/// The reply's own model, for a sub-agent's questions to Mnemo.
pub(crate) struct Main<'a> {
    pub model: &'a str,
    pub ep: &'a Endpoint,
    pub stp: &'a super::Setup,
    pub key: &'a str,
}

/// A sub-agent's conversation per chat, kept while the server runs so Mnemo can follow up
/// with the same sub-agent: `(chat, agent) -> messages`.
type Threads = std::sync::Mutex<HashMap<(String, String), Vec<Msg>>>;

fn threads() -> &'static Threads {
    static T: std::sync::OnceLock<Threads> = std::sync::OnceLock::new();
    T.get_or_init(Default::default)
}

/// Forget the sub-agent conversations of a deleted chat.
pub(crate) fn forget_threads(chat: &str) {
    if let Ok(mut t) = threads().lock() {
        t.retain(|(c, _), _| c != chat);
    }
}

const ASK_MAIN: &str = "ask_mnemo";

fn ask_main_def() -> ToolDef {
    ToolDef {
        name: ASK_MAIN.into(),
        description: format!(
            "Ask {NAME} (who gave you the task and knows the conversation with the owner) a short question when \
the task is unclear or you need a decision. You get its answer back; keep working after."
        ),
        parameters: json!({
            "type": "object",
            "properties": {"question": {"type": "string"}},
            "required": ["question"],
            "additionalProperties": false
        }),
    }
}

/// Run every delegate call of a step at the same time: `{call id: result}`. Their tool cards
/// start together and follow each sub-agent live (`sub` events: what it does, its model and
/// tokens); a cut reply stops them at their next step.
#[allow(clippy::too_many_arguments)]
pub(crate) fn delegate_all(
    st: &AppState,
    store: &Store,
    id: &str,
    on_behalf: &str,
    approved: bool,
    calls: &[ToolCall],
    tx: &tokio::sync::mpsc::UnboundedSender<String>,
    main: Main,
) -> HashMap<String, Result<Value, String>> {
    let mine: Vec<&ToolCall> = calls.iter().filter(|c| c.name == DELEGATE).collect();
    let mut out = HashMap::new();
    if mine.is_empty() {
        return out;
    }
    // Switched off for Mnemo: a model that still calls it (from earlier turns) is refused.
    if super::tools_off(store, false).contains(DELEGATE) {
        for c in &mine {
            out.insert(
                c.id.clone(),
                Err(format!(
                    "Not done: the owner switched {DELEGATE} off for {NAME} (Settings, {NAME})."
                )),
            );
        }
        return out;
    }
    for c in &mine {
        if tx
            .send(
                json!({"type": "tool_start", "id": c.id, "name": c.name, "args": c.arguments})
                    .to_string(),
            )
            .is_err()
        {
            return out;
        }
    }
    let main = &main;
    std::thread::scope(|sc| {
        let hs: Vec<_> = mine
            .iter()
            .map(|c| {
                sc.spawn(move || {
                    let r = run_sub(st, store, id, on_behalf, approved, c, tx, main);
                    (c.id.clone(), r)
                })
            })
            .collect();
        for h in hs {
            if let Ok((k, v)) = h.join() {
                out.insert(k, v);
            }
        }
    });
    out
}

/// One sub-agent's task: its own short agent loop with the vault tools, answered as text.
/// Its progress streams as `sub` events under the delegate card.
#[allow(clippy::too_many_arguments)]
fn run_sub(
    st: &AppState,
    store: &Store,
    id: &str,
    on_behalf: &str,
    approved: bool,
    call: &ToolCall,
    tx: &tokio::sync::mpsc::UnboundedSender<String>,
    main: &Main,
) -> Result<Value, String> {
    let args = &call.arguments;
    let gone = || tx.is_closed();
    let name = args["agent"].as_str().unwrap_or("").trim();
    let task = args["task"].as_str().unwrap_or("").trim();
    if task.is_empty() {
        return Err("task is required".into());
    }
    let agent_name: String = if name.is_empty() { "Helper" } else { name }
        .chars()
        .take(24)
        .collect();
    // Its model, the way a chat picks one: the owner's switch on the sub-agent's card, else
    // the model asked for in the chat (by id or by name; one that is not here stops it), else
    // the default model, then the fallbacks; when it fails, the next fallback carries on.
    let switched = sub_model(store, id, &agent_name);
    let asked = match switched {
        Some(k) => Some(k),
        None => asked_model(store, args)?,
    };
    let (p0, m0) = super::resolve_model(store, asked.as_deref(), None)?;
    let mut chain = super::fallback_chain(store, &p0, &m0).into_iter();
    let mut key = format!("{p0}/{m0}");
    let (mut model, mut ep) = open(st, store, &key)?;
    let window_of = |k: &str| {
        store
            .models()
            .unwrap_or_default()
            .into_iter()
            .find(|m| format!("{}/{}", m.provider_id, m.model_id) == k)
            .and_then(|m| m.context_window)
    };
    let mut window = window_of(&key);
    let current = std::cell::RefCell::new(key.clone());
    let emit = |mut v: Value| {
        v["type"] = json!("sub");
        v["id"] = json!(call.id);
        v["agent"] = json!(agent_name);
        v["model"] = json!(current.borrow().clone());
        let _ = tx.send(v.to_string());
    };
    let who = super::caller_for(&format!("{on_behalf} · {agent_name}"));
    // Its tools: the vault and the helpers, plus asking Mnemo; never asking the owner,
    // delegating, or the owner's memory, which belong to Mnemo itself.
    let mut tools: Vec<ToolDef> = super::tool_defs(st)
        .into_iter()
        .filter(|t| {
            t.name != super::ASK_OWNER
                && t.name != super::VIEW_IMAGE
                && t.name != super::UPDATE_PLAN
        })
        .collect();
    tools.extend(defs(st, store, true));
    let off = super::tools_off(store, true);
    tools.retain(|t| !off.contains(&t.name));
    tools.push(ask_main_def());
    let system = format!(
        "You are {agent_name}, a sub-agent of {NAME}, the assistant inside Memora, the owner's notes vault.\n\
{NAME} gives you tasks. Do each with the tools, then answer {NAME} with what you found or did: complete and \
concise, with the vault paths of the notes you used or changed. You cannot see {NAME}'s chat and cannot ask the \
owner; ask {NAME} with {ASK_MAIN} when you really need a decision, otherwise choose the sensible reading and say \
so.{}",
        if approved {
            ""
        } else {
            " The chat is in Ask first mode: do not change notes, say what should change."
        }
    );
    let opts = Options {
        temperature: None,
        max_output: Some(4096),
        think: false,
        effort: None,
    };
    // A follow-up goes on with the same sub-agent's earlier conversation in this chat.
    let tkey = (id.to_string(), agent_name.to_lowercase());
    let follow = args["follow_up"].as_bool().unwrap_or(false);
    let mut history = if follow {
        threads()
            .lock()
            .ok()
            .and_then(|t| t.get(&tkey).cloned())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let followed = !history.is_empty();
    history.push(Msg::User(task.to_string()));
    emit(json!({"phase": "start", "follow_up": followed, "window": window}));
    let (mut tin, mut tout, mut used) = (0u64, 0u64, 0u64);
    let mut log: Vec<Value> = Vec::new();
    for step in 0..SUB_STEPS {
        if gone() {
            return Err("stopped".into());
        }
        // Switched on its card meanwhile: the new model takes the next step.
        if let Some(k) = sub_model(store, id, &agent_name).filter(|k| *k != key) {
            if let Ok((m2, e2)) = open(st, store, &k) {
                emit(json!({"phase": "switched", "from": key, "to": k}));
                (key, model, ep) = (k, m2, e2);
                *current.borrow_mut() = key.clone();
                window = window_of(&key);
                chain = super::fallback_chain(
                    store,
                    key.split_once('/').map(|x| x.0).unwrap_or(""),
                    &model,
                )
                .into_iter();
            }
        }
        emit(json!({"phase": "step", "step": step + 1}));
        let mut buf = String::new();
        let turn = loop {
            let r = providers::run(&ep, &model, &system, &history, &tools, &opts, &mut |part| {
                if let providers::Stream::Text(t) = part {
                    buf.push_str(t);
                    if buf.len() >= 160 {
                        emit(json!({"phase": "text", "delta": std::mem::take(&mut buf)}));
                    }
                }
                !gone()
            });
            match r {
                Ok(t) => break t,
                Err(e) if e == "stopped" || gone() => return Err("stopped".into()),
                Err(e) => {
                    // The next fallback model carries on, like in a chat.
                    let next = chain.by_ref().find_map(|(p, m)| {
                        let k = format!("{p}/{m}");
                        open(st, store, &k).ok().map(|(m2, e2)| (k, m2, e2))
                    });
                    let Some((k, m2, e2)) = next else {
                        emit(json!({"phase": "error", "message": e}));
                        return Err(e);
                    };
                    emit(
                        json!({"phase": "fallback", "from": key, "to": k, "reason": super::why_failed(&e)}),
                    );
                    (key, model, ep) = (k, m2, e2);
                    *current.borrow_mut() = key.clone();
                    window = window_of(&key);
                    buf.clear();
                }
            }
        };
        if !buf.is_empty() {
            emit(json!({"phase": "text", "delta": buf}));
        }
        tin += turn.input_tokens.unwrap_or(0);
        tout += turn.output_tokens.unwrap_or(0);
        used = turn.input_tokens.unwrap_or(used) + turn.output_tokens.unwrap_or(0);
        emit(
            json!({"phase": "usage", "input_tokens": tin, "output_tokens": tout, "context": used, "window": window}),
        );
        // Near its model's window, the sub-agent folds its own earlier work into a summary
        // (written by its own model) and carries on: the chat and Mnemo stay untouched.
        let room = window.unwrap_or(32_000) as u64;
        if used > room * 70 / 100 && history.len() > 4 && !turn.calls.is_empty() {
            emit(json!({"phase": "compacting", "context": used, "window": window}));
            match fold_history(&ep, &model, task, &mut history) {
                Ok(n) => {
                    log.push(json!({"kind": "compact", "messages": n}));
                    emit(json!({"phase": "compacted", "messages": n}));
                }
                Err(e) => emit(
                    json!({"phase": "notice", "text": format!("could not compact its work: {e}")}),
                ),
            }
        }
        let last = turn.calls.is_empty() || step + 1 == SUB_STEPS;
        history.push(Msg::Assistant {
            text: turn.text.clone(),
            calls: if last { Vec::new() } else { turn.calls.clone() },
            raw: None,
        });
        if last {
            if let Ok(mut t) = threads().lock() {
                if t.len() > 200 {
                    t.clear();
                }
                t.insert(tkey, history);
            }
            let answer = turn.text.trim().to_string();
            emit(json!({"phase": "done", "steps": step + 1}));
            return Ok(json!({
                "agent": agent_name,
                "model": key,
                "answer": answer,
                "steps": step + 1,
                "input_tokens": tin,
                "output_tokens": tout,
                "context": used,
                "window": window,
                "follow_up": followed,
                "log": log,
            }));
        }
        for c in &turn.calls {
            if gone() {
                return Err("stopped".into());
            }
            let res = if c.name == ASK_MAIN {
                let q = c.arguments["question"]
                    .as_str()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                emit(json!({"phase": "ask", "question": q}));
                let a = ask_main(store, id, main, &agent_name, task, &q);
                let text = a
                    .clone()
                    .unwrap_or_else(|e| format!("({NAME} could not answer: {e})"));
                emit(json!({"phase": "answer", "answer": text}));
                log.push(json!({"kind": "ask", "question": q, "answer": text}));
                a.map(|t| json!({"answer": t}))
            } else {
                emit(json!({"phase": "tool", "name": c.name, "args": c.arguments}));
                let r = super::exec_tool(st, store, id, &who, approved, c, Some(&agent_name));
                let line = match &r {
                    Ok(v) => super::summary(v),
                    Err(e) => e.clone(),
                };
                emit(
                    json!({"phase": "tool_end", "name": c.name, "ok": r.is_ok(), "summary": line}),
                );
                log.push(json!({"kind": "tool", "name": c.name, "ok": r.is_ok(), "summary": line}));
                r
            };
            let mut output = match res {
                Ok(v) => v.to_string(),
                Err(e) => json!({"error": e}).to_string(),
            };
            if output.len() > super::TOOL_RESULT_MAX {
                output = output.chars().take(super::TOOL_RESULT_MAX).collect();
            }
            history.push(Msg::Tool {
                call_id: c.id.clone(),
                name: c.name.clone(),
                output,
            });
        }
    }
    Err("the sub-agent ran out of steps".into())
}

/// Fold a sub-agent's earlier work into a summary written by its own model: the task, the
/// summary, then its latest step (its tool calls with their results) stay. How many messages
/// were folded.
fn fold_history(
    ep: &Endpoint,
    model: &str,
    task: &str,
    history: &mut Vec<Msg>,
) -> Result<usize, String> {
    // Keep the newest step whole: from the last assistant message on.
    let keep_from = history
        .iter()
        .rposition(|m| matches!(m, Msg::Assistant { .. }))
        .unwrap_or(history.len());
    if keep_from <= 1 {
        return Ok(0);
    }
    let mut t = String::new();
    for m in &history[1..keep_from] {
        match m {
            Msg::User(x) | Msg::UserImages { text: x, .. } => {
                t.push_str(&format!("Task note: {}\n", super::clip(x, 1500)))
            }
            Msg::Assistant { text, calls, .. } => {
                if !text.is_empty() {
                    t.push_str(&format!("You: {}\n", super::clip(text, 1500)));
                }
                for c in calls {
                    t.push_str(&format!(
                        "You used {} {}\n",
                        c.name,
                        super::clip(&c.arguments.to_string(), 300)
                    ));
                }
            }
            Msg::Tool { name, output, .. } => {
                t.push_str(&format!("Result of {name}: {}\n", super::clip(output, 800)))
            }
        }
    }
    let opts = Options {
        temperature: None,
        max_output: Some(1200),
        think: false,
        effort: None,
    };
    let turn = providers::run(
        ep,
        model,
        "Summarise the work so far on the task below for yourself, to carry on from it: what is done, what was \
found (with vault paths and the key facts), what is left. Plain and complete, no preamble.",
        &[Msg::User(format!("Task:\n{task}\n\nWork so far:\n{t}"))],
        &[],
        &opts,
        &mut |_| true,
    )?;
    let folded = keep_from - 1;
    let tail: Vec<Msg> = history.drain(keep_from..).collect();
    // One opening message (the task and the summary), then the latest step: the turns still
    // alternate the way every provider wants.
    history.clear();
    history.push(Msg::User(format!(
        "{task}\n\n(Your work on it so far, summarised by you:)\n{}",
        turn.text.trim()
    )));
    history.extend(tail);
    Ok(folded)
}

/// A sub-agent's question, answered by the reply's own model with the chat as context.
fn ask_main(
    store: &Store,
    id: &str,
    main: &Main,
    agent: &str,
    task: &str,
    q: &str,
) -> Result<String, String> {
    if q.is_empty() {
        return Err("question is required".into());
    }
    let (mut history, _) =
        super::history_within(&store.messages(id).unwrap_or_default(), main.stp.budget / 2);
    // Pictures stay out of this side question.
    for m in history.iter_mut() {
        if let Msg::UserImages { text, .. } = m {
            *m = Msg::User(text.clone());
        }
    }
    let history = super::paired(history);
    let mut history = history;
    history.push(Msg::User(format!(
        "(Not from the owner.) Your sub-agent {agent}, working on the task you gave it:\n{task}\n\nasks you:\n{q}\n\n\
Answer it in a few lines from the conversation and what the owner wants; if you do not know, say what it should \
assume. Do not use tools."
    )));
    let opts = Options {
        temperature: None,
        max_output: Some(800),
        think: false,
        effort: None,
    };
    let _ = main.key;
    let turn = providers::run(
        main.ep,
        main.model,
        &main.stp.system,
        &history,
        &[],
        &opts,
        &mut |_| true,
    )?;
    Ok(turn.text.trim().to_string())
}

/// `POST /api/assistant/speak` `{text}`: the text read aloud by the speech model (audio).
async fn h_speak(
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
    let text: String = b["text"]
        .as_str()
        .unwrap_or("")
        .chars()
        .take(SPEAK_MAX)
        .collect();
    if text.trim().is_empty() {
        return bad("text is required");
    }
    let (_, model, ep) = match open_role(&st, store, "tts", "read aloud") {
        Ok(x) => x,
        Err(e) => return bad(&e),
    };
    let voice = prefs(store)
        .get(VOICE)
        .and_then(Value::as_str)
        .unwrap_or("alloy")
        .to_string();
    match crate::blocking(move || providers::speech(&ep, &model, &voice, &text)).await {
        Ok((bytes, mime)) => (
            [
                (header::CONTENT_TYPE, mime),
                (header::CACHE_CONTROL, "no-store".to_string()),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => fail(StatusCode::BAD_GATEWAY, &e),
    }
}

/// `POST /api/assistant/transcribe` (the recorded audio as the body): `{text}`.
async fn h_transcribe(
    State(st): State<AppState>,
    key: Option<Extension<ApiKeyCaller>>,
    headers: HeaderMap,
    body: Bytes,
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
    if body.is_empty() {
        return bad("send the recording as the body");
    }
    if body.len() > AUDIO_MAX {
        return bad("the recording is larger than 25 MB");
    }
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("audio/webm")
        .split(';')
        .next()
        .unwrap_or("audio/webm")
        .trim()
        .to_string();
    if !mime.starts_with("audio/") && mime != "video/webm" {
        return bad("send an audio recording");
    }
    let (_, model, ep) = match open_role(&st, store, "stt", "listen") {
        Ok(x) => x,
        Err(e) => return bad(&e),
    };
    let data = body.to_vec();
    match crate::blocking(move || providers::transcribe(&ep, &model, &data, &mime)).await {
        Ok(text) => Json(json!({"text": text})).into_response(),
        Err(e) => fail(StatusCode::BAD_GATEWAY, &e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_models_and_voices_are_checked() {
        let s = Store::open_memory().unwrap();
        let ok = |k: &str, v: Value| valid_pref(&s, k, &v);
        assert_eq!(ok(ROLES, json!({"vision": "p/m", "tts": ""})), Some(true));
        assert_eq!(ok(ROLES, json!({"video": "p/m"})), Some(false));
        assert_eq!(ok(VOICE, json!("nova")), Some(true));
        assert_eq!(ok(VOICE, json!("robot")), Some(false));
        assert_eq!(
            ok(SUBAGENTS, Value::Null),
            Some(true),
            "the old list can be cleared"
        );
        assert_eq!(
            ok(SUBAGENTS, json!([{"name": "Reader"}])),
            Some(false),
            "no named sub-agents any more"
        );
        assert_eq!(ok("other", json!(1)), None);
        s.set_pref(ROLES, &json!({"vision": "p/m"})).unwrap();
        assert_eq!(role(&s, "vision").as_deref(), Some("p/m"));
        assert!(role(&s, "image").is_none());
    }

    #[test]
    fn a_model_is_found_by_id_name_or_label_and_unknown_ones_stop() {
        use memora_state::assistant::ListedModel;
        let s = Store::open_memory().unwrap();
        s.save_provider(
            "acme",
            "custom",
            "Router",
            "http://x/v1",
            "chat",
            None,
            true,
            1,
        )
        .unwrap();
        let m = |id: &str, label: &str| ListedModel {
            id: id.into(),
            label: label.into(),
            context_window: None,
            max_output: None,
        };
        s.replace_fetched(
            "acme",
            &[
                m("smart", ""),
                m("team/gpt-x", "GPT Six"),
                m("team/gpt-x2", ""),
                m("quick", ""),
            ],
        )
        .unwrap();
        s.set_pref("default_model", &json!("acme/smart")).unwrap();
        s.set_pref(super::super::FALLBACKS, &json!(["acme/quick"]))
            .unwrap();
        assert_eq!(find_model(&s, "acme/smart").as_deref(), Some("acme/smart"));
        assert_eq!(
            find_model(&s, "SMART").as_deref(),
            Some("acme/smart"),
            "the name without its provider"
        );
        assert_eq!(
            find_model(&s, "gpt six").as_deref(),
            Some("acme/team/gpt-x"),
            "a label"
        );
        assert_eq!(find_model(&s, "gpt"), None);
        assert_eq!(asked_model(&s, &json!({})), Ok(None));
        assert_eq!(
            asked_model(&s, &json!({"model": "smart"})),
            Ok(Some("acme/smart".into()))
        );
        let e = asked_model(&s, &json!({"model": "gpt-x"})).unwrap_err();
        assert!(
            e.contains("acme/team/gpt-x") && e.contains("acme/team/gpt-x2"),
            "{e}"
        );
        assert!(asked_model(&s, &json!({"model": "llama"}))
            .unwrap_err()
            .contains("no model"));
        let t = models_text(&s);
        assert!(
            t.contains("default model: acme/smart") && t.contains("Fallback models: acme/quick"),
            "{t}"
        );
        assert!(t.contains("(4, the full list)"), "{t}");
    }
}
