//! Provider adapters for Mnemo: OpenAI Chat Completions, OpenAI Responses, Anthropic
//! Messages, and any OpenAI-compatible endpoint (custom). Each streams one model turn,
//! calling `on_text` for every piece of reply text, and returns the whole turn: its
//! text, the tool calls it asked for and the tokens it used.

use memora_state::assistant::ListedModel;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read};
use std::time::Duration;

/// One message of the provider-neutral history.
#[derive(Debug, Clone)]
pub enum Msg {
    User(String),
    /// A user turn with pictures the model should see (their bytes are filled in just
    /// before the request; `data` empty means not loaded).
    UserImages {
        text: String,
        images: Vec<Img>,
    },
    Assistant {
        text: String,
        calls: Vec<ToolCall>,
        /// The provider's own content blocks for this reply (Anthropic: thinking, text and
        /// tool_use in order), replayed verbatim so thinking stays valid across tool calls.
        raw: Option<Value>,
    },
    Tool {
        call_id: String,
        name: String,
        output: String,
    },
}

#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// Where and how to call: the provider's kind, API style, base URL and key.
#[derive(Debug, Clone)]
pub struct Endpoint {
    pub kind: String,
    pub style: String,
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Default)]
pub struct Options {
    pub temperature: Option<f64>,
    pub max_output: Option<u64>,
    /// Ask for the model's thinking (summaries) where the provider offers it.
    pub think: bool,
    /// How hard the model thinks (`low`, `medium`, `high`); `None` = the model's own default.
    pub effort: Option<String>,
}

/// Models that refused an effort field: asked without one from then on.
fn no_effort() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static SET: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    SET.get_or_init(Default::default)
}

fn takes_effort(model: &str) -> bool {
    !no_effort().lock().is_ok_and(|s| s.contains(model))
}

fn refuse_effort(model: &str) {
    if let Ok(mut s) = no_effort().lock() {
        s.insert(model.to_string());
    }
}

/// Whether a model can think (so the chat offers a thinking level): Claude models from 3.7
/// on, OpenAI's reasoning models, and the open reasoning models known by name. A model that
/// refused the thinking field is left out.
pub fn can_think(kind: &str, style: &str, model: &str) -> bool {
    if !thinks(model) {
        return false;
    }
    let m = model
        .rsplit('/')
        .next()
        .unwrap_or(model)
        .to_ascii_lowercase();
    if kind == "anthropic" || style == "messages" || m.starts_with("claude") {
        return !(m.starts_with("claude-3-") && !m.starts_with("claude-3-7"))
            && !m.starts_with("claude-2")
            && !m.starts_with("claude-instant");
    }
    if reasoning_model(&m) {
        return true;
    }
    [
        "think",
        "reason",
        "-r1",
        "r1-",
        "qwq",
        "qwen3",
        "deepseek",
        "gemini-2.5",
        "gemini-3",
        "grok-3-mini",
        "grok-4",
        "glm-4.5",
        "glm-4.6",
        "glm-5",
        "magistral",
        "minimax-m",
        "kimi-k2",
        "gpt-oss",
        "o3",
        "o4",
        "sonar-reasoning",
        "phi-4-reasoning",
        "nemotron",
    ]
    .iter()
    .any(|k| m.contains(k))
}

/// What streams out of a reply: its text, and the model's thinking where it shows it.
pub enum Stream<'a> {
    Text(&'a str),
    Think(&'a str),
}

/// Models that refused a thinking or reasoning field: asked without it from then on.
fn no_think() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static SET: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    SET.get_or_init(Default::default)
}

fn thinks(model: &str) -> bool {
    !no_think().lock().is_ok_and(|s| s.contains(model))
}

fn refuse_thinking(model: &str) {
    if let Ok(mut s) = no_think().lock() {
        s.insert(model.to_string());
    }
}

/// A 400 that names a field we sent for thinking or reasoning.
fn rejects_field(err: &str, field: &str) -> bool {
    let e = err.to_ascii_lowercase();
    e.contains("answered 400") && e.contains(field) && !e.contains("signature")
}

#[derive(Debug, Clone, Default)]
pub struct Turn {
    pub text: String,
    pub calls: Vec<ToolCall>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    /// The thinking the provider showed (summaries), for the chat view.
    pub thinking: String,
    /// The provider's own content blocks (see `Msg::Assistant::raw`).
    pub raw: Option<Value>,
}

/// The base URL a provider kind uses when none is given.
pub fn default_base(kind: &str) -> &'static str {
    match kind {
        "anthropic" => "https://api.anthropic.com/v1",
        "openai" => "https://api.openai.com/v1",
        // An OpenAI-compatible server has no default: the owner gives its address.
        _ => "",
    }
}

/// The type's name, for a provider saved without one.
pub fn kind_name(kind: &str) -> &'static str {
    match kind {
        "anthropic" => "Anthropic",
        "openai" => "OpenAI",
        _ => "OpenAI-compatible",
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(180))
        .user_agent(concat!("Memora/", env!("CARGO_PKG_VERSION")))
        .build()
}

fn url(ep: &Endpoint, path: &str) -> String {
    format!(
        "{}/{}",
        ep.base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn authed(ep: &Endpoint, req: ureq::Request) -> ureq::Request {
    if ep.kind == "anthropic" {
        req.set("x-api-key", &ep.api_key)
            .set("anthropic-version", "2023-06-01")
    } else if ep.api_key.is_empty() {
        req
    } else {
        req.set("Authorization", &format!("Bearer {}", ep.api_key))
    }
}

/// An error body made short and readable: an HTML error page (a proxy's 502, say) becomes
/// its title, whatever wrapped it stays, spaces are folded and the length is capped.
pub(crate) fn condense_error(msg: &str) -> String {
    let low = msg.to_ascii_lowercase();
    let mut out = msg.to_string();
    if let Some(start) = ["<!doctype", "<html"]
        .iter()
        .filter_map(|t| low.find(t))
        .min()
    {
        let end = low
            .rfind("</html>")
            .map(|i| i + "</html>".len())
            .unwrap_or(msg.len());
        let page = &low[start..end];
        let title = page
            .find("<title>")
            .and_then(|a| page[a + 7..].find("</title>").map(|b| (a + 7, a + 7 + b)))
            .map(|(a, b)| msg[start + a..start + b].trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| "an HTML error page".to_string());
        out = format!("{}{}{}", &msg[..start], title, &msg[end..]);
    }
    let folded = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if folded.chars().count() > 400 {
        folded.chars().take(400).collect::<String>() + "…"
    } else {
        folded
    }
}

/// The error a failed call reads as: the provider's own message when it sent one.
fn call_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| {
                    v["error"]["message"]
                        .as_str()
                        .or_else(|| v["error"].as_str())
                        .or_else(|| v["message"].as_str())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| body.clone());
            format!("the provider answered {code}: {}", condense_error(&msg))
        }
        ureq::Error::Transport(t) => format!("could not reach the provider: {t}"),
    }
}

/// The first whole number found at any of these paths (`a.b` = nested field).
fn first_int(m: &Value, paths: &[&str]) -> Option<i64> {
    paths.iter().find_map(|p| {
        let mut v = m;
        for k in p.split('.') {
            v = v.get(k)?;
        }
        v.as_i64()
            .or_else(|| v.as_f64().map(|f| f as i64))
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            .filter(|n| *n > 0)
    })
}

/// One model from a provider's standard model list (`GET <base>/models`).
fn listed(m: &Value) -> Option<ListedModel> {
    let id = m["id"]
        .as_str()
        .or_else(|| m["name"].as_str())?
        .trim()
        .to_string();
    if id.is_empty() {
        return None;
    }
    let label = m["display_name"]
        .as_str()
        .or_else(|| m["name"].as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    Some(ListedModel {
        label: if label == id { String::new() } else { label },
        // Anthropic: max_input_tokens; OpenRouter/Together: context_length; Groq:
        // context_window; Mistral/LM Studio: max_context_length; vLLM: max_model_len.
        context_window: first_int(
            m,
            &[
                "max_input_tokens",
                "context_length",
                "context_window",
                "max_context_length",
                "max_model_len",
                "top_provider.context_length",
                "limits.context",
                "input_token_limit",
            ],
        ),
        // Anthropic: max_tokens; Groq/OpenRouter: max_completion_tokens.
        max_output: first_int(
            m,
            &[
                "max_tokens",
                "max_completion_tokens",
                "max_output_tokens",
                "top_provider.max_completion_tokens",
                "output_token_limit",
                "limits.output",
            ],
        ),
        id,
    })
}

/// Every model the provider lists, with the context window and reply limit it reports.
pub fn list_models(ep: &Endpoint) -> Result<Vec<ListedModel>, String> {
    let mut out: Vec<ListedModel> = Vec::new();
    let mut after: Option<String> = None;
    // Anthropic pages its list (`limit`, `has_more`, `after_id`); others answer at once.
    for _ in 0..20 {
        let mut path = if ep.kind == "anthropic" {
            "models?limit=1000".to_string()
        } else {
            "models".to_string()
        };
        if let Some(a) = &after {
            path.push_str(&format!("&after_id={a}"));
        }
        let resp = authed(ep, agent().get(&url(ep, &path)))
            .call()
            .map_err(call_error)?;
        let v: Value = serde_json::from_reader(resp.into_reader().take(8 << 20))
            .map_err(|e| format!("the model list is not JSON: {e}"))?;
        let items = v["data"]
            .as_array()
            .or_else(|| v["models"].as_array())
            .cloned()
            .unwrap_or_default();
        out.extend(items.iter().filter_map(listed));
        let more = v["has_more"].as_bool() == Some(true);
        after = v["last_id"].as_str().map(str::to_string);
        if ep.kind != "anthropic" || !more || after.is_none() {
            break;
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out.dedup_by(|a, b| a.id == b.id);
    Ok(out)
}

/// Run one model turn with streaming.
pub fn run(
    ep: &Endpoint,
    model: &str,
    system: &str,
    history: &[Msg],
    tools: &[ToolDef],
    opts: &Options,
    on: &mut dyn FnMut(Stream) -> bool,
) -> Result<Turn, String> {
    match (ep.kind.as_str(), ep.style.as_str()) {
        ("anthropic", _) | (_, "messages") => {
            anthropic(ep, model, system, history, tools, opts, on)
        }
        (_, "responses") => {
            let think = opts.think && reasoning_model(model) && thinks(model);
            match responses(ep, model, system, history, tools, opts, think, on) {
                Err(e) if think && rejects_field(&e, "reasoning") => {
                    refuse_thinking(model);
                    responses(ep, model, system, history, tools, opts, false, on)
                }
                other => other,
            }
        }
        _ => {
            // OpenAI-compatible servers (OpenRouter, LiteLLM routers…) send a model's raw
            // reasoning when asked; one that refuses the field is not asked again.
            let ask = opts.think && ep.kind == "custom" && thinks(model);
            let mut o = opts.clone();
            if !opts.think || !takes_effort(model) {
                o.effort = None;
            }
            match chat(ep, model, system, history, tools, &o, ask, on) {
                // Any 400 while asking: once more without the fields; remember which when that
                // works (the effort first, when one was sent).
                Err(e)
                    if (ask || o.effort.is_some())
                        && (rejects_field(&e, "reasoning")
                            || e.to_ascii_lowercase().contains("answered 400")) =>
                {
                    if o.effort.is_some() {
                        let mut o2 = o.clone();
                        o2.effort = None;
                        let again = chat(ep, model, system, history, tools, &o2, ask, on);
                        if again.is_ok() {
                            refuse_effort(model);
                            return again;
                        }
                    }
                    let mut o3 = o.clone();
                    o3.effort = None;
                    let again = chat(ep, model, system, history, tools, &o3, false, on);
                    if again.is_ok() && ask {
                        refuse_thinking(model);
                    }
                    again
                }
                other => other,
            }
        }
    }
}

/// OpenAI reasoning models (they can return reasoning summaries on the Responses API).
fn reasoning_model(model: &str) -> bool {
    let m = model
        .rsplit('/')
        .next()
        .unwrap_or(model)
        .to_ascii_lowercase();
    m.starts_with("o1") || m.starts_with("o3") || m.starts_with("o4") || m.starts_with("gpt-5")
}

/// Read a server-sent event stream: `on_event(event name, data)` for each event; stops when
/// it returns false (the browser went away).
fn read_sse(
    resp: ureq::Response,
    mut on_event: impl FnMut(&str, &str) -> bool,
) -> Result<(), String> {
    let reader = BufReader::new(resp.into_reader());
    let mut event = String::new();
    let mut data = String::new();
    for line in reader.lines() {
        let line = line.map_err(|e| format!("the stream broke off: {e}"))?;
        if line.is_empty() {
            if !data.is_empty() {
                let keep = on_event(&event, &data);
                data.clear();
                event.clear();
                if !keep {
                    return Ok(());
                }
            }
            continue;
        }
        if let Some(v) = line.strip_prefix("event:") {
            event = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(v.trim_start());
        }
    }
    if !data.is_empty() {
        on_event(&event, &data);
    }
    Ok(())
}

fn args_value(raw: &str) -> Value {
    if raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(raw).unwrap_or_else(|_| json!({"_raw": raw}))
    }
}

/// An image in a user turn: the staged upload's id, its media type and base64 bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct Img {
    pub id: String,
    pub media: String,
    pub data: String,
}

impl Img {
    fn data_url(&self) -> String {
        format!("data:{};base64,{}", self.media, self.data)
    }
}

// ---------------- OpenAI Chat Completions (and custom providers) ----------------

fn chat_messages(system: &str, history: &[Msg]) -> Vec<Value> {
    let mut out = vec![json!({"role": "system", "content": system})];
    for m in history {
        match m {
            Msg::User(t) => out.push(json!({"role": "user", "content": t})),
            Msg::UserImages { text, images } => {
                let mut parts = vec![json!({"type": "text", "text": text})];
                parts.extend(
                    images
                        .iter()
                        .filter(|i| !i.data.is_empty())
                        .map(|i| json!({"type": "image_url", "image_url": {"url": i.data_url()}})),
                );
                out.push(json!({"role": "user", "content": parts}));
            }
            Msg::Assistant { text, calls, .. } => {
                let mut v = json!({"role": "assistant", "content": if text.is_empty() { Value::Null } else { json!(text) }});
                if !calls.is_empty() {
                    v["tool_calls"] = json!(calls
                        .iter()
                        .map(|c| json!({"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.arguments.to_string()}}))
                        .collect::<Vec<_>>());
                }
                out.push(v);
            }
            Msg::Tool {
                call_id, output, ..
            } => out.push(json!({"role": "tool", "tool_call_id": call_id, "content": output})),
        }
    }
    out
}

/// Splits streamed text into the answer and the model's raw thinking, which open models
/// (DeepSeek-R1, Qwen, Hermes…) write inline as `<think>…</think>` (also `<thinking>`,
/// `<reasoning>`). A tag cut between two chunks is held back until it is whole.
#[derive(Default)]
struct ThinkSplit {
    inside: bool,
    held: String,
}

const THINK_TAGS: &[&str] = &["think", "thinking", "reasoning"];

impl ThinkSplit {
    /// The chunk as `(is_thinking, text)` pieces, in order.
    fn feed(&mut self, chunk: &str) -> Vec<(bool, String)> {
        let mut buf = std::mem::take(&mut self.held);
        buf.push_str(chunk);
        let mut out: Vec<(bool, String)> = Vec::new();
        let mut push = |think: bool, t: &str| {
            if t.is_empty() {
                return;
            }
            match out.last_mut() {
                Some((k, s)) if *k == think => s.push_str(t),
                _ => out.push((think, t.to_string())),
            }
        };
        let mut rest: &str = &buf;
        loop {
            let want: Vec<String> = THINK_TAGS
                .iter()
                .map(|t| {
                    if self.inside {
                        format!("</{t}>")
                    } else {
                        format!("<{t}>")
                    }
                })
                .collect();
            let lower = rest.to_ascii_lowercase();
            let hit = want
                .iter()
                .filter_map(|w| lower.find(w.as_str()).map(|i| (i, w.len())))
                .min();
            match hit {
                Some((i, n)) => {
                    push(self.inside, &rest[..i]);
                    self.inside = !self.inside;
                    rest = &rest[i + n..];
                }
                None => {
                    // Hold back a tail that could be the start of a tag ("<thi").
                    let keep = rest
                        .rfind('<')
                        .filter(|&i| {
                            let tail = rest[i..].to_ascii_lowercase();
                            tail.len() < 13 && want.iter().any(|w| w.starts_with(tail.as_str()))
                        })
                        .unwrap_or(rest.len());
                    push(self.inside, &rest[..keep]);
                    self.held = rest[keep..].to_string();
                    break;
                }
            }
        }
        out
    }

    /// Whatever was held back at the end of the stream.
    fn finish(&mut self) -> Option<(bool, String)> {
        let t = std::mem::take(&mut self.held);
        (!t.is_empty()).then_some((self.inside, t))
    }
}

/// Reasoning text in a streamed delta, in the field each server uses.
fn delta_reasoning(delta: &Value) -> String {
    // DeepSeek, vLLM, LM Studio: reasoning_content; OpenRouter, Groq, Ollama: reasoning;
    // some proxies: reasoning_text or thinking; OpenRouter also reasoning_details[].
    for k in [
        "reasoning_content",
        "reasoning",
        "reasoning_text",
        "thinking",
    ] {
        if let Some(t) = delta[k].as_str().filter(|t| !t.is_empty()) {
            return t.to_string();
        }
    }
    delta["reasoning_details"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|d| d["text"].as_str().or(d["summary"].as_str()))
                .collect::<String>()
        })
        .unwrap_or_default()
}

#[allow(clippy::too_many_arguments)]
fn chat(
    ep: &Endpoint,
    model: &str,
    system: &str,
    history: &[Msg],
    tools: &[ToolDef],
    opts: &Options,
    ask_reasoning: bool,
    on: &mut dyn FnMut(Stream) -> bool,
) -> Result<Turn, String> {
    let mut body = json!({
        "model": model,
        "messages": chat_messages(system, history),
        "stream": true,
        "stream_options": {"include_usage": true},
    });
    if !tools.is_empty() {
        body["tools"] = json!(tools
            .iter()
            .map(|t| json!({"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}))
            .collect::<Vec<_>>());
    }
    if let Some(t) = opts.temperature {
        body["temperature"] = json!(t);
    }
    if ask_reasoning {
        body["reasoning"] = match &opts.effort {
            Some(e) => json!({"effort": e}),
            None => json!({"enabled": true}),
        };
    } else if let Some(e) = &opts.effort {
        // OpenAI and OpenAI-style routers: the standard field.
        body["reasoning_effort"] = json!(e);
    }
    if let Some(n) = opts.max_output {
        // OpenAI's newer models only take max_completion_tokens; compatible servers take max_tokens.
        body[if ep.kind == "openai" {
            "max_completion_tokens"
        } else {
            "max_tokens"
        }] = json!(n);
    }
    let resp = authed(ep, agent().post(&url(ep, "chat/completions")))
        .set("Accept", "text/event-stream")
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(call_error)?;
    let mut turn = Turn::default();
    let mut parts: Vec<(String, String, String)> = Vec::new();
    let mut stopped = false;
    let mut split = ThinkSplit::default();
    read_sse(resp, |_, data| {
        if data == "[DONE]" {
            return false;
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            return true;
        };
        if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
            turn.input_tokens = u["prompt_tokens"].as_u64();
            turn.output_tokens = u["completion_tokens"].as_u64();
        }
        let delta = &v["choices"][0]["delta"];
        let r = delta_reasoning(delta);
        if !r.is_empty() {
            turn.thinking.push_str(&r);
            if !on(Stream::Think(&r)) {
                stopped = true;
                return false;
            }
        }
        if let Some(t) = delta["content"].as_str() {
            for (think, piece) in split.feed(t) {
                let ok = if think {
                    turn.thinking.push_str(&piece);
                    on(Stream::Think(&piece))
                } else {
                    turn.text.push_str(&piece);
                    on(Stream::Text(&piece))
                };
                if !ok {
                    stopped = true;
                    return false;
                }
            }
        }
        if let Some(calls) = delta["tool_calls"].as_array() {
            for c in calls {
                let i = c["index"].as_u64().unwrap_or(parts.len() as u64) as usize;
                while parts.len() <= i {
                    parts.push(Default::default());
                }
                if let Some(id) = c["id"].as_str() {
                    parts[i].0 = id.to_string();
                }
                if let Some(n) = c["function"]["name"].as_str() {
                    parts[i].1.push_str(n);
                }
                if let Some(a) = c["function"]["arguments"].as_str() {
                    parts[i].2.push_str(a);
                }
            }
        }
        true
    })?;
    if stopped {
        return Err("stopped".into());
    }
    if let Some((think, t)) = split.finish() {
        if think {
            turn.thinking.push_str(&t);
            on(Stream::Think(&t));
        } else {
            turn.text.push_str(&t);
            on(Stream::Text(&t));
        }
    }
    // A model that thinks first may leave blank lines between its thinking and its answer.
    if !turn.thinking.is_empty() {
        let trimmed = turn.text.trim_start().to_string();
        turn.text = trimmed;
    }
    turn.calls = parts
        .into_iter()
        .enumerate()
        .filter(|(_, p)| !p.1.is_empty())
        .map(|(i, (id, name, args))| ToolCall {
            id: if id.is_empty() {
                format!("call_{i}")
            } else {
                id
            },
            name,
            arguments: args_value(&args),
        })
        .collect();
    Ok(turn)
}

// ---------------- OpenAI Responses ----------------

fn responses_input(history: &[Msg]) -> Vec<Value> {
    let mut out = Vec::new();
    for m in history {
        match m {
            Msg::User(t) => out.push(json!({"role": "user", "content": t})),
            Msg::UserImages { text, images } => {
                let mut parts = vec![json!({"type": "input_text", "text": text})];
                parts.extend(
                    images
                        .iter()
                        .filter(|i| !i.data.is_empty())
                        .map(|i| json!({"type": "input_image", "image_url": i.data_url()})),
                );
                out.push(json!({"role": "user", "content": parts}));
            }
            Msg::Assistant { text, calls, .. } => {
                if !text.is_empty() {
                    out.push(json!({"role": "assistant", "content": text}));
                }
                for c in calls {
                    out.push(json!({"type": "function_call", "call_id": c.id, "name": c.name, "arguments": c.arguments.to_string()}));
                }
            }
            Msg::Tool {
                call_id, output, ..
            } => out.push(
                json!({"type": "function_call_output", "call_id": call_id, "output": output}),
            ),
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn responses(
    ep: &Endpoint,
    model: &str,
    system: &str,
    history: &[Msg],
    tools: &[ToolDef],
    opts: &Options,
    think: bool,
    on: &mut dyn FnMut(Stream) -> bool,
) -> Result<Turn, String> {
    let mut body = json!({
        "model": model,
        "instructions": system,
        "input": responses_input(history),
        "stream": true,
        "store": false,
    });
    if !tools.is_empty() {
        body["tools"] = json!(tools
            .iter()
            .map(|t| json!({"type": "function", "name": t.name, "description": t.description, "parameters": t.parameters}))
            .collect::<Vec<_>>());
    }
    if let Some(t) = opts.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(n) = opts.max_output {
        body["max_output_tokens"] = json!(n);
    }
    if think {
        body["reasoning"] = json!({"summary": "auto"});
        if let Some(e) = &opts.effort {
            body["reasoning"]["effort"] = json!(e);
        }
    }
    let resp = authed(ep, agent().post(&url(ep, "responses")))
        .set("Accept", "text/event-stream")
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(call_error)?;
    let mut turn = Turn::default();
    let mut stopped = false;
    let mut failure: Option<String> = None;
    read_sse(resp, |event, data| {
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            return true;
        };
        let kind = v["type"].as_str().unwrap_or(event);
        match kind {
            "response.output_text.delta" => {
                if let Some(t) = v["delta"].as_str() {
                    turn.text.push_str(t);
                    if !on(Stream::Text(t)) {
                        stopped = true;
                        return false;
                    }
                }
            }
            "response.reasoning_summary_text.delta" => {
                if let Some(t) = v["delta"].as_str() {
                    turn.thinking.push_str(t);
                    if !on(Stream::Think(t)) {
                        stopped = true;
                        return false;
                    }
                }
            }
            "response.reasoning_summary_part.done" => turn.thinking.push_str("\n\n"),
            "response.output_item.done" if v["item"]["type"] == "function_call" => {
                let it = &v["item"];
                turn.calls.push(ToolCall {
                    id: it["call_id"].as_str().unwrap_or("call").to_string(),
                    name: it["name"].as_str().unwrap_or("").to_string(),
                    arguments: args_value(it["arguments"].as_str().unwrap_or("")),
                });
            }
            "response.completed" | "response.incomplete" => {
                let u = &v["response"]["usage"];
                turn.input_tokens = u["input_tokens"].as_u64();
                turn.output_tokens = u["output_tokens"].as_u64();
                return false;
            }
            "response.failed" | "error" => {
                failure = Some(
                    v["response"]["error"]["message"]
                        .as_str()
                        .or_else(|| v["message"].as_str())
                        .unwrap_or("the provider stopped the reply")
                        .to_string(),
                );
                return false;
            }
            _ => {}
        }
        true
    })?;
    if stopped {
        return Err("stopped".into());
    }
    if let Some(f) = failure {
        return Err(f);
    }
    Ok(turn)
}

// ---------------- Anthropic Messages ----------------

fn anthropic_messages(history: &[Msg], replay: bool) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut push = |role: &str, block: Value| {
        if let Some(last) = out.last_mut() {
            if last["role"] == role {
                if let Some(arr) = last["content"].as_array_mut() {
                    arr.push(block);
                    return;
                }
            }
        }
        out.push(json!({"role": role, "content": [block]}));
    };
    for m in history {
        match m {
            Msg::User(t) => push("user", json!({"type": "text", "text": t})),
            Msg::UserImages { text, images } => {
                for i in images.iter().filter(|i| !i.data.is_empty()) {
                    push(
                        "user",
                        json!({"type": "image", "source": {"type": "base64", "media_type": i.media, "data": i.data}}),
                    );
                }
                push("user", json!({"type": "text", "text": text}));
            }
            Msg::Assistant {
                raw: Some(Value::Array(blocks)),
                ..
            } if replay && !blocks.is_empty() => {
                // The reply exactly as the model gave it, thinking blocks included.
                for b in blocks {
                    push("assistant", b.clone());
                }
            }
            Msg::Assistant { text, calls, .. } => {
                if !text.is_empty() {
                    push("assistant", json!({"type": "text", "text": text}));
                }
                for c in calls {
                    push(
                        "assistant",
                        json!({"type": "tool_use", "id": c.id, "name": c.name, "input": c.arguments}),
                    );
                }
            }
            Msg::Tool {
                call_id, output, ..
            } => push(
                "user",
                json!({"type": "tool_result", "tool_use_id": call_id, "content": output}),
            ),
        }
    }
    out
}

/// Anthropic Messages: adaptive thinking with summaries where the model takes it, earlier
/// replies replayed verbatim. If the API refuses a replayed thinking block (the history
/// changed), it is asked once more with every thinking block left out, as Anthropic advises.
fn anthropic(
    ep: &Endpoint,
    model: &str,
    system: &str,
    history: &[Msg],
    tools: &[ToolDef],
    opts: &Options,
    on: &mut dyn FnMut(Stream) -> bool,
) -> Result<Turn, String> {
    let mut think = opts.think && thinks(model);
    let mut replay = true;
    let mut opts = opts.clone();
    if !takes_effort(model) {
        opts.effort = None;
    }
    for _ in 0..4 {
        match anthropic_once(ep, model, system, history, tools, &opts, think, replay, on) {
            Err(e) if replay && e.contains("answered 400") && e.contains("signature") => {
                replay = false
            }
            Err(e)
                if opts.effort.is_some()
                    && (rejects_field(&e, "effort") || rejects_field(&e, "output_config")) =>
            {
                refuse_effort(model);
                opts.effort = None;
            }
            Err(e) if think && rejects_field(&e, "thinking") => {
                refuse_thinking(model);
                think = false;
            }
            other => return other,
        }
    }
    anthropic_once(ep, model, system, history, tools, &opts, false, false, on)
}

#[allow(clippy::too_many_arguments)]
fn anthropic_once(
    ep: &Endpoint,
    model: &str,
    system: &str,
    history: &[Msg],
    tools: &[ToolDef],
    opts: &Options,
    think: bool,
    replay: bool,
    on: &mut dyn FnMut(Stream) -> bool,
) -> Result<Turn, String> {
    let mut body = json!({
        "model": model,
        "system": system,
        "messages": anthropic_messages(history, replay),
        "max_tokens": opts.max_output.unwrap_or(16_000),
        "stream": true,
    });
    if !tools.is_empty() {
        body["tools"] = json!(tools
            .iter()
            .map(|t| json!({"name": t.name, "description": t.description, "input_schema": t.parameters}))
            .collect::<Vec<_>>());
    }
    if think {
        body["thinking"] = json!({"type": "adaptive", "display": "summarized"});
        if let Some(e) = &opts.effort {
            body["output_config"] = json!({"effort": e});
        }
    } else if let Some(t) = opts.temperature {
        body["temperature"] = json!(t.min(1.0));
    }
    let resp = authed(ep, agent().post(&url(ep, "messages")))
        .set("Accept", "text/event-stream")
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(call_error)?;
    let mut turn = Turn::default();
    // The reply's content blocks by index, and each tool_use block's partial JSON.
    let mut blocks: Vec<Value> = Vec::new();
    let mut partial: Vec<String> = Vec::new();
    let mut stopped = false;
    let mut failure: Option<String> = None;
    read_sse(resp, |event, data| {
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            return true;
        };
        let kind = v["type"].as_str().unwrap_or(event);
        match kind {
            "message_start" => turn.input_tokens = v["message"]["usage"]["input_tokens"].as_u64(),
            "content_block_start" => {
                let i = v["index"].as_u64().unwrap_or(0) as usize;
                while blocks.len() <= i {
                    blocks.push(Value::Null);
                    partial.push(String::new());
                }
                blocks[i] = v["content_block"].clone();
            }
            "content_block_delta" => {
                let i = v["index"].as_u64().unwrap_or(0) as usize;
                let d = &v["delta"];
                let Some(b) = blocks.get_mut(i) else {
                    return true;
                };
                match d["type"].as_str().unwrap_or("") {
                    "text_delta" => {
                        let t = d["text"].as_str().unwrap_or("");
                        b["text"] = json!(format!("{}{t}", b["text"].as_str().unwrap_or("")));
                        turn.text.push_str(t);
                        if !on(Stream::Text(t)) {
                            stopped = true;
                            return false;
                        }
                    }
                    "thinking_delta" => {
                        let t = d["thinking"].as_str().unwrap_or("");
                        b["thinking"] =
                            json!(format!("{}{t}", b["thinking"].as_str().unwrap_or("")));
                        turn.thinking.push_str(t);
                        if !t.is_empty() && !on(Stream::Think(t)) {
                            stopped = true;
                            return false;
                        }
                    }
                    "signature_delta" => {
                        let sig = d["signature"].as_str().unwrap_or("");
                        b["signature"] =
                            json!(format!("{}{sig}", b["signature"].as_str().unwrap_or("")));
                    }
                    "input_json_delta" => {
                        partial[i].push_str(d["partial_json"].as_str().unwrap_or(""))
                    }
                    _ => {}
                }
            }
            "content_block_stop" => {
                let i = v["index"].as_u64().unwrap_or(0) as usize;
                if blocks.get(i).is_some_and(|b| b["type"] == "thinking")
                    && !turn.thinking.is_empty()
                    && !turn.thinking.ends_with("\n\n")
                {
                    turn.thinking.push_str("\n\n");
                }
            }
            "message_delta" => {
                turn.output_tokens = v["usage"]["output_tokens"].as_u64().or(turn.output_tokens)
            }
            "message_stop" => return false,
            "error" => {
                failure = Some(
                    v["error"]["message"]
                        .as_str()
                        .unwrap_or("the provider stopped the reply")
                        .to_string(),
                );
                return false;
            }
            _ => {}
        }
        true
    })?;
    if stopped {
        return Err("stopped".into());
    }
    if let Some(f) = failure {
        return Err(f);
    }
    for (i, b) in blocks.iter_mut().enumerate() {
        if b["type"] == "tool_use" {
            b["input"] = args_value(&partial[i]);
            turn.calls.push(ToolCall {
                id: b["id"].as_str().unwrap_or("").to_string(),
                name: b["name"].as_str().unwrap_or("").to_string(),
                arguments: b["input"].clone(),
            });
        }
    }
    blocks.retain(|b| !b.is_null());
    // Kept only when the reply carried thinking: then it must go back exactly as it came.
    if blocks
        .iter()
        .any(|b| matches!(b["type"].as_str(), Some("thinking" | "redacted_thinking")))
    {
        turn.raw = Some(Value::Array(blocks));
    }
    Ok(turn)
}

#[cfg(test)]
mod tests {

    #[test]
    fn model_lists_give_limits_in_every_common_shape() {
        let anthropic = listed(&json!({"id": "claude-opus-5-5", "display_name": "Claude Opus 5.5", "max_input_tokens": 1000000, "max_tokens": 128000})).unwrap();
        assert_eq!(
            (
                anthropic.label.as_str(),
                anthropic.context_window,
                anthropic.max_output
            ),
            ("Claude Opus 5.5", Some(1_000_000), Some(128_000))
        );
        let openrouter = listed(&json!({"id": "x/y", "name": "x/y", "context_length": 65536, "top_provider": {"max_completion_tokens": 8192}})).unwrap();
        assert_eq!(
            (
                openrouter.label.as_str(),
                openrouter.context_window,
                openrouter.max_output
            ),
            ("", Some(65536), Some(8192))
        );
        let groq =
            listed(&json!({"id": "g", "context_window": 131072, "max_completion_tokens": 32768}))
                .unwrap();
        assert_eq!(
            (groq.context_window, groq.max_output),
            (Some(131_072), Some(32_768))
        );
        let vllm = listed(&json!({"id": "v", "max_model_len": 32768})).unwrap();
        assert_eq!((vllm.context_window, vllm.max_output), (Some(32_768), None));
        let openai = listed(&json!({"id": "gpt-x", "object": "model"})).unwrap();
        assert_eq!((openai.context_window, openai.max_output), (None, None));
        assert!(listed(&json!({"object": "model"})).is_none());
    }

    use super::*;

    #[test]
    fn an_html_error_page_reads_as_its_title() {
        let raw = "[x/deepseek] [502]: <!DOCTYPE html> <html lang=\"en\"> <head> <title>holver.id | 502: Bad gateway</title> </head> <body> Ray 4011 </body> </html> (reset after 30s)";
        assert_eq!(
            condense_error(raw),
            "[x/deepseek] [502]: holver.id | 502: Bad gateway (reset after 30s)"
        );
        assert_eq!(
            condense_error("plain  message\n here"),
            "plain message here"
        );
        assert!(condense_error(&"a".repeat(900)).chars().count() <= 401);
    }

    #[test]
    fn inline_think_tags_become_thinking_even_split_across_chunks() {
        let mut sp = ThinkSplit::default();
        let mut think = String::new();
        let mut text = String::new();
        for chunk in [
            "<thi",
            "nk>The user wants ",
            "a plan.</th",
            "ink>\n\nHere is ",
            "the plan.",
            " a < b",
        ] {
            for (k, t) in sp.feed(chunk) {
                if k {
                    think.push_str(&t)
                } else {
                    text.push_str(&t)
                }
            }
        }
        if let Some((k, t)) = sp.finish() {
            if k {
                think.push_str(&t)
            } else {
                text.push_str(&t)
            }
        }
        assert_eq!(think, "The user wants a plan.");
        assert_eq!(text, "\n\nHere is the plan. a < b");
        let mut sp2 = ThinkSplit::default();
        let got = sp2.feed("<Thinking>hmm</Thinking>ok");
        assert_eq!(
            got,
            vec![(true, "hmm".to_string()), (false, "ok".to_string())]
        );
    }

    #[test]
    fn reasoning_is_read_from_every_common_field() {
        assert_eq!(delta_reasoning(&json!({"reasoning_content": "a"})), "a");
        assert_eq!(delta_reasoning(&json!({"reasoning": "b"})), "b");
        assert_eq!(
            delta_reasoning(
                &json!({"reasoning_details": [{"type": "reasoning.text", "text": "c"}]})
            ),
            "c"
        );
        assert_eq!(delta_reasoning(&json!({"content": "x"})), "");
    }

    #[test]
    fn pictures_go_to_each_api_in_its_own_shape() {
        let img = Img {
            id: "u1".into(),
            media: "image/png".into(),
            data: "QUJD".into(),
        };
        let gone = Img {
            id: "u2".into(),
            media: String::new(),
            data: String::new(),
        };
        let h = vec![Msg::UserImages {
            text: "what is this?".into(),
            images: vec![img, gone],
        }];
        let c = chat_messages("sys", &h);
        assert_eq!(c[1]["content"][0]["text"], "what is this?");
        assert_eq!(
            c[1]["content"][1]["image_url"]["url"],
            "data:image/png;base64,QUJD"
        );
        assert_eq!(
            c[1]["content"].as_array().unwrap().len(),
            2,
            "an image without bytes is left out"
        );
        let r = responses_input(&h);
        assert_eq!(r[0]["content"][1]["type"], "input_image");
        let a = anthropic_messages(&h, false);
        assert_eq!(a[0]["content"][0]["source"]["media_type"], "image/png");
        assert_eq!(a[0]["content"][1]["text"], "what is this?");
    }

    fn history() -> Vec<Msg> {
        vec![
            Msg::User("find my plan".into()),
            Msg::Assistant {
                text: "Looking.".into(),
                calls: vec![ToolCall {
                    id: "c1".into(),
                    name: "search_memory".into(),
                    arguments: json!({"q": "plan"}),
                }],
                raw: None,
            },
            Msg::Tool {
                call_id: "c1".into(),
                name: "search_memory".into(),
                output: "[]".into(),
            },
        ]
    }

    #[test]
    fn chat_history_carries_tool_calls_and_results() {
        let m = chat_messages("sys", &history());
        assert_eq!(m[0]["role"], "system");
        assert_eq!(m[2]["tool_calls"][0]["function"]["name"], "search_memory");
        assert_eq!(
            m[2]["tool_calls"][0]["function"]["arguments"],
            "{\"q\":\"plan\"}"
        );
        assert_eq!(m[3]["role"], "tool");
        assert_eq!(m[3]["tool_call_id"], "c1");
    }

    #[test]
    fn responses_history_uses_function_call_items() {
        let m = responses_input(&history());
        assert_eq!(m[2]["type"], "function_call");
        assert_eq!(m[3]["type"], "function_call_output");
        assert_eq!(m[3]["call_id"], "c1");
    }

    #[test]
    fn anthropic_history_alternates_and_puts_results_in_user_turns() {
        let m = anthropic_messages(&history(), true);
        assert_eq!(m.len(), 3);
        assert_eq!(m[1]["content"][1]["type"], "tool_use");
        assert_eq!(m[2]["role"], "user");
        assert_eq!(m[2]["content"][0]["type"], "tool_result");
    }

    #[test]
    fn claude_replies_with_thinking_go_back_exactly_unless_stripped() {
        let raw = json!([
            {"type": "thinking", "thinking": "Search first.", "signature": "sig=="},
            {"type": "tool_use", "id": "c1", "name": "search_memory", "input": {"q": "plan"}}
        ]);
        let mut h = history();
        if let Msg::Assistant { raw: r, .. } = &mut h[1] {
            *r = Some(raw.clone());
        }
        let kept = anthropic_messages(&h, true);
        assert_eq!(
            kept[1]["content"], raw,
            "replayed block for block, signature included"
        );
        let stripped = anthropic_messages(&h, false);
        assert!(stripped[1]["content"]
            .as_array()
            .unwrap()
            .iter()
            .all(|b| b["type"] != "thinking"));
        assert_eq!(stripped[1]["content"][1]["type"], "tool_use");
        assert!(
            reasoning_model("gpt-5.5")
                && reasoning_model("openai/o3-mini")
                && !reasoning_model("gpt-4.1")
        );
        assert!(rejects_field(
            "the provider answered 400: thinking: unknown field",
            "thinking"
        ));
        assert!(!rejects_field(
            "the provider answered 400: Invalid `signature` in `thinking` block",
            "thinking"
        ));
    }

    #[test]
    fn broken_tool_arguments_are_kept_rather_than_lost() {
        assert_eq!(args_value(""), json!({}));
        assert_eq!(args_value("{\"a\":1}"), json!({"a": 1}));
        assert_eq!(args_value("{oops"), json!({"_raw": "{oops"}));
    }
}
