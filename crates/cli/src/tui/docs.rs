//! `/docs` and `memora-cli docs [topic]`: the handbook in the terminal.
//!
//! Each topic is a list of [`Block`]s rendered to lines that fit the terminal
//! width: headings, paragraphs, bullets and code. Code blocks are never
//! wrapped, so they stay copy-pasteable; `inline code` in prose is coloured.

use super::commands::COMMANDS;
use crate::Ctx;
use anyhow::Result;
use console::{style, Term};
use dialoguer::theme::ColorfulTheme;
use dialoguer::Select;

/// Short instructions for clients with a small instructions field.
/// Mirrors `AGENT_PROMPT_SHORT` in web/src/docs/agent-prompt.ts; keep them in sync.
pub(crate) const AGENT_PROMPT_SHORT: &str = r#"Use Memora (MCP server "memora") as your long-term memory. Before answering, search_memory for the topic and read_memory the relevant notes. When you learn something worth keeping (a decision, a preference, a fact about me or my projects, a fix), save it with patch_memory or create_memory as short Markdown with [[wikilinks]] and #tags. Search before creating, update instead of duplicating, and never store secrets."#;

/// The full agent instructions, for a system prompt, project rules or custom instructions.
/// Mirrors `AGENT_PROMPT` in web/src/docs/agent-prompt.ts; keep them in sync.
pub(crate) const AGENT_PROMPT: &str = r#"From now on, use Memora as your second brain: a shared, long-term memory that you and my other AI agents read and write through the Memora MCP server.

Recall
- At the start of a task, search_memory for the topic, project, person or error you are working on, then read_memory the most relevant notes before you answer.
- Use search_by_tag (for example #decision, #todo) and get_neighbors to follow related notes.
- If a note answers the question, say so and use it instead of guessing.

Remember
- Save what is worth keeping: decisions and their reasons, my preferences, facts about my projects and people, fixes that worked, open todos.
- Update an existing note with patch_memory (append a dated line, add a tag) or save_memory; create_memory a new note only when nothing fits.
- Keep notes short Markdown: a clear title, a few bullet points, [[wikilinks]] to related notes and #tags such as #decision #todo #howto.
- Put notes in the right folder (for example Projects/<name>, People, Decisions, Journal).

Rules
- Search before creating, and update instead of duplicating.
- Never store secrets: passwords, API keys, tokens or private keys.
- Do not save small talk or anything I ask you not to remember.
- At the end of a longer session, append a two or three line summary to the project's note."#;

/// Placeholder for an API key in the client snippets (same as the web guide).
const KEY: &str = "<YOUR_MEMORA_KEY>";

/// Widest page, even on a very wide terminal: long lines are hard to read.
const MAX_WIDTH: usize = 100;

/// A documentation topic.
pub(crate) struct Topic {
    pub id: &'static str,
    pub title: &'static str,
    pub summary: &'static str,
}

pub(crate) const TOPICS: &[Topic] = &[
    Topic {
        id: "getting-started",
        title: "Getting started",
        summary: "install, one-time code, vault, first agent",
    },
    Topic {
        id: "connecting-agents",
        title: "Connecting agents",
        summary: "MCP endpoint, OAuth, configs for every client",
    },
    Topic {
        id: "agent-instructions",
        title: "Agent instructions",
        summary: "the recommended prompt, ready to copy",
    },
    Topic {
        id: "keys-permissions",
        title: "Keys & permissions",
        summary: "scopes, per-key tools, privacy, access rules",
    },
    Topic {
        id: "commands",
        title: "Commands",
        summary: "every console command in one line",
    },
    Topic {
        id: "backups-updates",
        title: "Backups & updates",
        summary: "db backup, restore, check; /update; Docker",
    },
    Topic {
        id: "troubleshooting",
        title: "Troubleshooting",
        summary: "401, -32003, unreachable server, locked",
    },
    Topic {
        id: "more",
        title: "Full documentation",
        summary: "the docs in the web app and the repository",
    },
];

/// One piece of a page.
enum Block {
    /// Section heading.
    H(String),
    /// Paragraph, wrapped.
    P(String),
    /// Bullet, wrapped with a hanging indent.
    Li(String),
    /// Code, never wrapped.
    Code(String),
    /// Dim side note, wrapped.
    Note(String),
    /// Term and its description (command lists).
    Def(String, String),
    /// Text printed exactly as it is, for copying.
    Raw(String),
}
use Block::*;

fn p(s: impl Into<String>) -> Block {
    P(s.into())
}
fn li(s: impl Into<String>) -> Block {
    Li(s.into())
}
fn h(s: impl Into<String>) -> Block {
    H(s.into())
}
fn code(s: impl Into<String>) -> Block {
    Code(s.into())
}
fn note(s: impl Into<String>) -> Block {
    Note(s.into())
}

/// Find a topic by id, id prefix, title word or number (1-based).
pub(crate) fn find(arg: &str) -> Option<&'static Topic> {
    let a = arg.trim().trim_start_matches('/').to_lowercase();
    if a.is_empty() {
        return None;
    }
    if let Ok(n) = a.parse::<usize>() {
        return n.checked_sub(1).and_then(|i| TOPICS.get(i));
    }
    let alias = match a.as_str() {
        "prompt" | "instructions" | "agent-prompt" => "agent-instructions",
        "mcp" | "connect" | "agents" => "connecting-agents",
        "keys" | "permissions" | "scopes" | "privacy" => "keys-permissions",
        "backup" | "backups" | "update" | "updates" | "db" => "backups-updates",
        "errors" | "help" | "trouble" => "troubleshooting",
        "start" | "setup" | "install" => "getting-started",
        "docs" | "web" | "full" => "more",
        _ => "",
    };
    TOPICS
        .iter()
        .find(|t| t.id == a || t.id == alias)
        .or_else(|| TOPICS.iter().find(|t| t.id.starts_with(&a)))
        .or_else(|| TOPICS.iter().find(|t| t.title.to_lowercase().contains(&a)))
}

/// The server's public origin, read from the state database when there is one.
fn base_url(ctx: &Ctx) -> String {
    let fallback = || "http://<server-ip>:8400".to_string();
    if !ctx.state.join("memora.db").exists() {
        return fallback();
    }
    ctx.snapshot()
        .map(|snap| crate::manage::public_base(ctx, &snap))
        .unwrap_or_else(|_| fallback())
}

/// Terminal width for rendering, capped at [`MAX_WIDTH`].
fn width() -> usize {
    let term = Term::stdout();
    let w = if term.is_term() {
        term.size().1 as usize
    } else {
        80
    };
    w.clamp(20, MAX_WIDTH)
}

fn print_page(topic: &Topic, base: &str) {
    for line in render(topic, base, width()) {
        println!("{line}");
    }
}

/// `/docs [topic]`: print a topic, or open the topic menu.
pub(super) fn run(ctx: &Ctx, theme: &ColorfulTheme, arg: Option<&str>) -> Result<()> {
    let base = base_url(ctx);
    if let Some(a) = arg {
        return match find(a) {
            Some(t) => {
                print_page(t, &base);
                Ok(())
            }
            None => {
                println!("No docs topic {a}. Topics:");
                print_index();
                Ok(())
            }
        };
    }
    let items: Vec<String> = TOPICS
        .iter()
        .map(|t| format!("{:<20} {}", t.title, style(t.summary).dim()))
        .collect();
    let mut at = 0;
    loop {
        let pick = Select::with_theme(theme)
            .with_prompt("Docs: pick a topic (Esc to close)")
            .items(&items)
            .default(at)
            .interact_opt()?;
        let Some(i) = pick else {
            return Ok(());
        };
        println!();
        print_page(&TOPICS[i], &base);
        println!();
        at = (i + 1) % TOPICS.len();
    }
}

/// `memora-cli docs [topic]`: print a topic (or `all`), else the menu on a
/// terminal or the topic list without one. Returns the exit code.
pub(crate) fn cli(ctx: &Ctx, arg: Option<&str>) -> Result<i32> {
    let base = base_url(ctx);
    match arg {
        Some("all") => {
            for t in TOPICS {
                print_page(t, &base);
                println!();
            }
            Ok(0)
        }
        Some(a) => match find(a) {
            Some(t) => {
                print_page(t, &base);
                Ok(0)
            }
            None => {
                eprintln!("memora-cli: no docs topic `{a}`. Topics:");
                print_index();
                Ok(2)
            }
        },
        None if Term::stdout().is_term() && std::io::IsTerminal::is_terminal(&std::io::stdin()) => {
            run(ctx, &ColorfulTheme::default(), None)?;
            Ok(0)
        }
        None => {
            println!("Usage: memora-cli docs <topic|all>");
            println!();
            print_index();
            Ok(0)
        }
    }
}

fn print_index() {
    for (i, t) in TOPICS.iter().enumerate() {
        println!(
            "  {:>2}. {}  {}",
            i + 1,
            style(format!("{:<20}", t.id)).cyan(),
            style(t.summary).dim()
        );
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/// Render `topic` to styled lines no wider than `width` (code excepted).
pub(crate) fn render(topic: &Topic, base: &str, width: usize) -> Vec<String> {
    let width = width.max(20);
    let mut out = vec![
        style(topic.title).cyan().bold().to_string(),
        style("─".repeat(topic.title.chars().count().min(width)))
            .cyan()
            .to_string(),
    ];
    let blocks = page(topic.id, base);
    for (n, b) in blocks.iter().enumerate() {
        let after_text = n > 0 && !matches!(blocks[n - 1], H(_) | Def(..));
        match b {
            H(t) => {
                out.push(String::new());
                for l in super::wrap(t, width) {
                    out.push(style(l).bold().to_string());
                }
            }
            P(t) => {
                out.push(String::new());
                push_wrapped(&mut out, t, width, "  ", "  ", |s| s);
            }
            Li(t) => {
                if n > 0 && matches!(blocks[n - 1], Def(..)) {
                    out.push(String::new());
                }
                push_wrapped(&mut out, t, width, "  • ", "    ", |s| s);
            }
            Note(t) => {
                if n > 0 && !matches!(blocks[n - 1], H(_) | P(_)) {
                    out.push(String::new());
                }
                push_wrapped(&mut out, t, width, "  ", "  ", |s| {
                    style(s).dim().to_string()
                });
            }
            Code(t) => {
                for l in t.lines() {
                    out.push(format!("    {}", style(l).green()));
                }
            }
            Def(term, text) => {
                if after_text {
                    out.push(String::new());
                }
                let left = 22;
                if width >= left + 24 {
                    let mut in_code = false;
                    for (i, l) in super::wrap(text, width - left).iter().enumerate() {
                        let head = if i == 0 {
                            style(format!("  {term:<w$}", w = left - 2))
                                .cyan()
                                .to_string()
                        } else {
                            " ".repeat(left)
                        };
                        out.push(format!("{head}{}", inline_code(l, &mut in_code)));
                    }
                } else {
                    out.push(format!("  {}", style(term).cyan()));
                    push_wrapped(&mut out, text, width, "    ", "    ", |s| s);
                }
            }
            Raw(t) => {
                out.push(style("----- copy from here -----").dim().to_string());
                out.extend(t.lines().map(str::to_string));
                out.push(style("----- to here -----").dim().to_string());
            }
        }
    }
    out
}

/// Wrap `text` with a first-line and a continuation prefix; `` `code` ``
/// spans are coloured, also when they run across a line break.
fn push_wrapped(
    out: &mut Vec<String>,
    text: &str,
    width: usize,
    first: &str,
    rest: &str,
    paint: impl Fn(String) -> String,
) {
    let avail = width.saturating_sub(first.chars().count()).max(10);
    let mut in_code = false;
    for (i, line) in super::wrap(text, avail).into_iter().enumerate() {
        let prefix = if i == 0 { first } else { rest };
        out.push(format!(
            "{prefix}{}",
            paint(inline_code(&line, &mut in_code))
        ));
    }
}

/// Colour the `` `code` `` spans of one line and drop the backticks.
fn inline_code(line: &str, in_code: &mut bool) -> String {
    let mut s = String::new();
    for (i, part) in line.split('`').enumerate() {
        if i > 0 {
            *in_code = !*in_code;
        }
        if part.is_empty() {
            continue;
        }
        if *in_code {
            s.push_str(&style(part).cyan().to_string());
        } else {
            s.push_str(part);
        }
    }
    s
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

fn page(id: &str, base: &str) -> Vec<Block> {
    let mut b = match id {
        "getting-started" => getting_started(base),
        "connecting-agents" => connecting_agents(base),
        "agent-instructions" => agent_instructions(),
        "keys-permissions" => keys_permissions(),
        "commands" => commands(),
        "backups-updates" => backups_updates(),
        "troubleshooting" => troubleshooting(base),
        _ => return more(base),
    };
    b.push(note(format!(
        "More: /docs for other topics, the full docs at {base}/docs."
    )));
    b
}

fn getting_started(base: &str) -> Vec<Block> {
    vec![
        p("Memora is one server on your machine: a vault of Markdown notes that your AI \
           agents read and write over MCP. Four steps get you from nothing to a connected agent."),
        h("1. Install"),
        p("Native (Linux with systemd): the installer sets up the `memora` service and this console."),
        code("curl -fsSL https://raw.githubusercontent.com/Codrihub/memora/main/scripts/install.sh | sudo sh"),
        p("Docker: clone the repository, then start it and open the console inside the container."),
        code("git clone https://github.com/Codrihub/memora.git && cd memora\n\
              mkdir -p data state && sudo chown -R 1000:1000 data state\n\
              docker compose up -d\n\
              docker compose exec -it gateway memora-cli"),
        h("2. Create the owner with a one-time code"),
        li("Type `/web` here (or run `memora-cli setup`). It opens a setup window, 5 minutes by \
            default (1-60), and prints a one-time code."),
        li(format!("Open `{base}/login`, enter the code, then choose a username and password.")),
        li("One try only: a wrong code voids the window, so run `/web` again. If the window \
            expires unfinished the instance is locked; `/unlock` lifts it."),
        li("Rather stay in the terminal? `/setup` creates the owner right here."),
        h("3. Choose the vault"),
        li("After the first sign-in the app asks for the vault folder: the folder of Markdown \
            notes on this server. In Docker that is the mounted volume, `/data`."),
        li("From the console: `/vault` (the running server picks it up after `/restart`)."),
        h("4. Connect an agent"),
        li("Claude and ChatGPT: add a custom connector with the URL below and sign in (OAuth). \
            No key to paste."),
        li("Every other client: create a key with `/keys` (or Agents & API keys in the app) and \
            paste its config. See the Connecting agents topic."),
        li("Give the agent the recommended instructions (Agent instructions topic) so it \
            actually uses its memory."),
        code(format!("{base}/mcp")),
    ]
}

fn connecting_agents(base: &str) -> Vec<Block> {
    let url = format!("{base}/mcp");
    vec![
        p("Memora speaks the Model Context Protocol over Streamable HTTP. Every client that \
           supports remote MCP servers can connect."),
        Def("Endpoint".into(), url.clone()),
        Def(
            "Auth".into(),
            "OAuth sign-in, or the header `Authorization: Bearer <key>`".into(),
        ),
        Def("Keys".into(), "`/keys` here, or Agents & API keys in the app".into()),
        note(format!(
            "The endpoint comes from MEMORA_BASE_URL (/config). Replace {KEY} below with the \
             agent's key."
        )),
        h("Claude (web or desktop) - OAuth"),
        li("Settings > Connectors > Add custom connector."),
        li("Fill in the name and URL below. Authentication: Sign in now. OAuth client: Use \
            Claude's published identity (or Register automatically)."),
        li("Claude opens Memora: sign in and press Allow. The connection shows up as an agent \
            marked OAuth."),
        code(format!("Name:            Memora\nMCP server URL:  {url}")),
        note("No OAuth? Pick No sign-in and add the header `Authorization: Bearer <key>` instead."),
        h("ChatGPT - OAuth"),
        li("Settings > Apps & Connectors > Advanced: turn on Developer mode."),
        li("Create, fill in the name and URL below. Authentication: OAuth, client ID and secret \
            left empty."),
        li("ChatGPT opens Memora: sign in and press Allow. ChatGPT only signs in with OAuth; it \
            cannot send a key header."),
        code(format!(
            "Name:            Memora\nMCP server URL:  {url}\nAuthentication:  OAuth"
        )),
        h("Claude Code"),
        li("Run this in a terminal (add `--scope user` to use it in every project):"),
        code(format!(
            "claude mcp add --transport http memora {url} \\\n  --header \"Authorization: Bearer {KEY}\""
        )),
        li("Check it with `claude mcp list`; Memora should show as connected."),
        h("Cursor"),
        li("Open `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project) and add:"),
        code(json_entry("mcpServers", &[], "url", &url)),
        li("In Cursor Settings > MCP, Memora turns green with its tools listed."),
        h("VS Code / Copilot"),
        li("MCP: Open User Configuration (or `.vscode/mcp.json`). VS Code uses `servers`, not \
            `mcpServers`:"),
        code(json_entry("servers", &[("type", "http")], "url", &url)),
        li("Press Start above the entry, then use Memora from Copilot Chat in agent mode."),
        h("Windsurf"),
        li("Windsurf Settings > Cascade > MCP servers > View raw config \
            (`~/.codeium/windsurf/mcp_config.json`). Windsurf uses `serverUrl`:"),
        code(json_entry("mcpServers", &[], "serverUrl", &url)),
        li("Press Refresh; Memora appears in the MCP list."),
        h("Codex CLI"),
        li("Add this to `~/.codex/config.toml`, export the key in the shell that starts Codex, \
            then check with `codex mcp list`:"),
        code(format!(
            "[mcp_servers.memora]\nurl = \"{url}\"\nbearer_token_env_var = \"MEMORA_KEY\"\n\n# in your shell:\nexport MEMORA_KEY={KEY}"
        )),
        h("Gemini CLI"),
        li("Open `~/.gemini/settings.json` (or `.gemini/settings.json`). Streamable HTTP uses \
            `httpUrl`:"),
        code(json_entry("mcpServers", &[], "httpUrl", &url)),
        li("Restart Gemini CLI and run `/mcp` to see Memora and its tools."),
        h("Claude Desktop (config file)"),
        li("Only for older builds without connectors. Settings > Developer > Edit Config (needs \
            Node.js for mcp-remote), then restart Claude Desktop:"),
        code(format!(
            "{{\n  \"mcpServers\": {{\n    \"memora\": {{\n      \"command\": \"npx\",\n      \"args\": [\n        \"-y\",\n        \"mcp-remote\",\n        \"{url}\",\n        \"--header\",\n        \"Authorization:${{MEMORA_AUTH}}\"\n      ],\n      \"env\": {{\n        \"MEMORA_AUTH\": \"Bearer {KEY}\"\n      }}\n    }}\n  }}\n}}"
        )),
        h("Any client: test with curl"),
        code(format!(
            "curl -s {url} \\\n  -H \"Authorization: Bearer {KEY}\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Accept: application/json, text/event-stream\" \\\n  -d '{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}}'"
        )),
        note("A JSON list of tools means the key works. `/mcp` prints the short version of this page."),
    ]
}

/// A client config the way the web guide prints it (`JSON.stringify(v, null, 2)`):
/// `{ <root>: { memora: { <extra...>, <url_key>: url, headers: {...} } } }`.
fn json_entry(root: &str, extra: &[(&str, &str)], url_key: &str, url: &str) -> String {
    let mut s = format!("{{\n  \"{root}\": {{\n    \"memora\": {{\n");
    for (k, v) in extra {
        s.push_str(&format!("      \"{k}\": \"{v}\",\n"));
    }
    s.push_str(&format!(
        "      \"{url_key}\": \"{url}\",\n      \"headers\": {{\n        \"Authorization\": \"Bearer {KEY}\"\n      }}\n    }}\n  }}\n}}"
    ));
    s
}

fn agent_instructions() -> Vec<Block> {
    vec![
        p(
            "Connecting an agent gives it the tools; these instructions make it use them. Paste \
           the full version where the client keeps standing instructions, or the short one \
           where space is tight.",
        ),
        h("Full instructions"),
        Raw(AGENT_PROMPT.to_string()),
        h("Short version"),
        Raw(AGENT_PROMPT_SHORT.to_string()),
        h("Where to paste it"),
        li("Claude: a Project's instructions, or Settings > Profile > personal preferences."),
        li("ChatGPT: Settings > Personalization > Custom instructions, or a custom GPT."),
        li("Claude Code: `CLAUDE.md` in the project (or `~/.claude/CLAUDE.md` for every project)."),
        li("Cursor: Rules (`.cursor/rules` in a project, or User Rules in settings)."),
        li("VS Code / Copilot: `.github/copilot-instructions.md`."),
        li("Windsurf: Rules (`.windsurfrules`, or global rules in settings)."),
        li("Codex CLI: `AGENTS.md` in the project (or `~/.codex/AGENTS.md`)."),
        li("Gemini CLI: `GEMINI.md` in the project (or `~/.gemini/GEMINI.md`)."),
        li("Your own agent: the system prompt."),
        note("The same text is on the Docs page of the web app, with a copy button."),
    ]
}

fn keys_permissions() -> Vec<Block> {
    vec![
        p("Each agent connects with its own API key (or its own OAuth sign-in), so you can see \
           what it does and limit or revoke it on its own."),
        h("Scopes"),
        Def("mcp".into(), "use MCP tools at all (`/mcp` endpoint)".into()),
        Def("read".into(), "read notes over the HTTP API".into()),
        Def(
            "write".into(),
            "change notes over HTTP, and use MCP tools that change the vault".into(),
        ),
        Def(
            "admin".into(),
            "admin tools: switch tools, privacy rules; off by default".into(),
        ),
        note("New keys get mcp, read and write. A key without write only sees read-only tools."),
        h("Per-key tools"),
        li("`/keys` -> Manage -> Permissions: allow every tool, or only the ones you tick."),
        li("`/tools` switches a tool off for every key and agent at once; per-key grants cannot \
            turn it back on."),
        li("A tool the key may not use is hidden from `tools/list` and refused with `-32003`."),
        h("Privacy per agent"),
        li("In the app, open a note's or folder's menu -> Privacy: visible to all agents, all \
            except some, or only some."),
        li("Hidden notes do not exist for that agent: not in search, listings, links or reads. \
            You, the owner, always see everything."),
        li("Rules follow notes when they are renamed or moved."),
        h("Access rules"),
        li("Access rules in the app: an ordered list of IP, range, CIDR and domain rules, checked \
            top-down before anything else. The first match wins; the default decides the rest."),
        li("This machine (loopback) is always allowed, so you cannot lock yourself out."),
        h("Keeping an eye on agents"),
        li("`/keys` shows when and from which IP each key was last used; `/activity` is the \
            security log. Turning a key off stops it at once without deleting it."),
    ]
}

fn commands() -> Vec<Block> {
    let mut b = vec![p(
        "Type a command at the `memora ›` prompt, or / alone to pick one from a menu. \
         `/help <command>` explains one in detail.",
    )];
    let mut group = "";
    for c in COMMANDS {
        if c.group != group {
            group = c.group;
            b.push(h(group));
        }
        let term = if c.args.is_empty() {
            c.name.to_string()
        } else {
            format!("{} {}", c.name, c.args)
        };
        b.push(Def(term, c.short.to_string()));
    }
    b.push(note(
        "Outside the console: `memora-cli help` lists the subcommands (setup, status, db, \
         update, docs...).",
    ));
    b
}

fn backups_updates() -> Vec<Block> {
    vec![
        p("Notes are plain Markdown files in the vault folder; back that folder up like any \
           other. Accounts, keys, settings and logs live in the state database \
           `state/memora.db`."),
        h("Back up the database"),
        li("`/backup` (or `memora-cli db backup`) copies it to `state/backups/memora-<time>.db` \
            while the server keeps running. The newest 10 are kept."),
        code("memora-cli db backup --keep 20\nmemora-cli db backup --to /path/to/memora.db"),
        h("Check and compact"),
        li("`/db check` looks for damage, wrong owners or permissions, and the age of the last \
            backup. As `memora-cli db check` it exits 1 on problems, for timers and health checks."),
        li("`/db vacuum` drops old log rows and compacts the file."),
        h("Restore"),
        li("Stop the server first, restore, then start it again. The replaced database is kept \
            in `state/backups`."),
        code("sudo systemctl stop memora\nsudo memora-cli db restore state/backups/memora-<time>.db\nsudo systemctl start memora"),
        h("Update"),
        li("`/update` (or `sudo memora-cli update`) checks GitHub Releases, shows what is new, \
            then downloads, verifies the checksum, swaps the binary and restarts the server. \
            Your data stays."),
        code("memora-cli update --check"),
        h("Docker"),
        li("Update by pulling the new image; the data stays in `./data` and `./state`."),
        code("docker compose pull && docker compose up -d\ndocker compose exec gateway memora-cli db backup\ndocker compose exec gateway memora-cli db check"),
    ]
}

fn troubleshooting(base: &str) -> Vec<Block> {
    vec![
        h("401 Unauthorized"),
        li("The key is missing, mistyped, turned off, deleted or replaced by a roll. Check it \
            in `/keys`; `/activity fail` lists invalid key attempts."),
        li("The header must be `Authorization: Bearer <key>` (or `X-API-Key: <key>`)."),
        li("OAuth clients get a 401 first on purpose: it starts the sign-in."),
        h("-32003 tool not allowed"),
        li("`tool not allowed for this API key`: the key's tool list leaves it out, or it lacks \
            the mcp scope. Fix it in `/keys` -> Manage -> Permissions."),
        li("`API key lacks the 'write' scope`: the tool changes the vault; give the key write."),
        li("`tool disabled on this server`: switched off for everyone in `/tools`."),
        h("403"),
        li("The key lacks the mcp scope, or an access rule blocks the caller's IP or domain."),
        h("Can't reach the server"),
        li(format!(
            "Open `{base}/healthz` from the agent's machine. `/status` shows the port; \
             `/config` the domain and base URL."
        )),
        li("With MEMORA_DOMAIN or MEMORA_BASE_URL set, use that host: other hosts get 404."),
        li("From the internet you need a tunnel or reverse proxy; check firewalls and access rules."),
        h("Setup window, locked, cooldowns"),
        li("Code rejected: one try per window. Run `/web` for a new one."),
        li("Window expired unfinished: the instance is locked. `/web` opens a new window, \
            `/unlock` only lifts the lock."),
        li("Too many failed sign-ins: wait 5 to 15 minutes, or `/cooldowns` if it was you."),
        li("Forgot the password: `/reset`."),
        h("Still stuck"),
        li("`/db check` and `/status`, then the server log (`journalctl -u memora` or \
            `docker compose logs gateway`)."),
    ]
}

fn more(base: &str) -> Vec<Block> {
    vec![
        p("These pages are the short version. The full documentation lives in two places."),
        Def("Web app".into(), format!("{base}/docs")),
        Def(
            "Repository".into(),
            "https://github.com/Codrihub/memora/tree/main/docs".into(),
        ),
        li("INSTALL.md: native and Docker installs, upgrades, uninstall."),
        li("CONFIGURATION.md: every setting and environment variable."),
        li("MCP.md: the protocol, every tool, errors and permissions."),
        li("API.md, DATABASE.md, DEPLOYMENT.md, ARCHITECTURE.md."),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "https://memory.example.com";

    #[test]
    fn every_topic_renders_narrow_and_wide() {
        for t in TOPICS {
            for w in [0, 20, 40, 80, 200] {
                let lines = render(t, BASE, w);
                assert!(lines.len() > 3, "{} at {w}", t.id);
            }
        }
    }

    #[test]
    fn prose_fits_the_width() {
        console::set_colors_enabled(false);
        for t in TOPICS {
            for l in render(t, BASE, 40) {
                if console::measure_text_width(&l) <= 40 {
                    continue;
                }
                // Code (indented four) and copyable text (not indented) never
                // wrap; prose only overflows for a single word longer than a line.
                let code_or_raw = l.starts_with("    ") || !l.starts_with(' ');
                let long_word = l.split_whitespace().any(|w| w.chars().count() > 30);
                assert!(code_or_raw || long_word, "{}: {l:?}", t.id);
            }
        }
    }

    #[test]
    fn agent_prompts_are_present() {
        for p in [AGENT_PROMPT, AGENT_PROMPT_SHORT] {
            assert!(!p.trim().is_empty());
            assert!(p.contains("search_memory"));
        }
        let page = render(find("agent-instructions").unwrap(), BASE, 80).join("\n");
        assert!(page.contains(AGENT_PROMPT_SHORT));
        assert!(page.contains("Put notes in the right folder"));
    }

    #[test]
    fn commands_page_lists_every_command() {
        let page = render(find("commands").unwrap(), BASE, 120).join("\n");
        for c in COMMANDS {
            assert!(page.contains(c.name), "{} missing", c.name);
        }
        assert!(page.contains("/docs"));
    }

    #[test]
    fn topics_resolve() {
        assert_eq!(find("agent-instructions").unwrap().id, "agent-instructions");
        assert_eq!(find("prompt").unwrap().id, "agent-instructions");
        assert_eq!(find("3").unwrap().id, "agent-instructions");
        assert_eq!(find("trouble").unwrap().id, "troubleshooting");
        assert_eq!(find("Keys").unwrap().id, "keys-permissions");
        assert!(find("nope-nothing").is_none());
        assert!(find("0").is_none());
        assert!(find("").is_none());
    }

    #[test]
    fn inline_code_spans_cross_lines() {
        console::set_colors_enabled(false);
        let mut in_code = false;
        assert_eq!(inline_code("run `a b", &mut in_code), "run a b");
        assert!(in_code);
        assert_eq!(inline_code("c` now", &mut in_code), "c now");
        assert!(!in_code);
    }
}
