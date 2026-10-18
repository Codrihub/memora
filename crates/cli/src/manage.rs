//! Console commands for access control: API keys, tool switches, signed-in
//! devices, the security activity log and the MCP connection guide.
//!
//! Changes go straight to the state database (`store.rs`), logged in the same
//! transaction. The running server picks them up on its next request.

use crate::store::{self, KeyView, SessionView};
use crate::{fmt_secs, ok, Ctx};
use console::style;
use dialoguer::theme::ColorfulTheme;
use dialoguer::{Confirm, Input, MultiSelect, Select};
use memora_state::{keys, session, tools};
use std::collections::BTreeSet;

type Result<T> = anyhow::Result<T>;

fn now() -> i64 {
    memora_state::now()
}

/// "3m 05s ago", "2h ago", "4d ago" or "never".
fn ago(ts: i64) -> String {
    if ts <= 0 {
        return "never".into();
    }
    let s = (now() - ts).max(0);
    if s < 3600 {
        format!("{} ago", fmt_secs(s))
    } else if s < 86_400 {
        format!("{}h ago", s / 3600)
    } else {
        format!("{}d ago", s / 86_400)
    }
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

fn print_keys(rows: &[KeyView], disabled: &BTreeSet<String>) {
    if rows.is_empty() {
        println!("  No API keys yet. Pick \"Create a new key\" below.");
        return;
    }
    let total = catalog_names().len();
    println!(
        "  {}",
        style(format!(
            "{:<3} {:<20} {:<14} {:<6} {:<20} {:<11} {:<12} {:<16} {}",
            "#", "name", "prefix", "status", "may", "tools", "last used", "last IP", "calls"
        ))
        .dim()
    );
    for (i, r) in rows.iter().enumerate() {
        let status = if r.enabled {
            style("on".to_string()).green()
        } else {
            style("off".to_string()).red()
        };
        let may = if r.scopes.is_empty() {
            "nothing".to_string()
        } else {
            r.scopes.join(",")
        };
        let may = if r.scopes.iter().any(|s| s == "admin") {
            style(format!("{may:<20}")).yellow()
        } else {
            style(format!("{may:<20}"))
        };
        println!(
            "  {:<3} {:<20} {:<14} {:<6} {} {:<11} {:<12} {:<16} {}",
            i + 1,
            truncate(&r.name, 20),
            r.prefix,
            status,
            may,
            tools_label(&r.tools, total),
            ago(r.last_used),
            r.last_ip,
            r.count
        );
    }
    println!(
        "  {}",
        style("may: mcp = use MCP tools, read = read notes over the HTTP API,").dim()
    );
    println!(
        "  {}",
        style("     write = change notes (HTTP API and MCP write tools), admin = manage tools and keys.")
            .dim()
    );
    let off = disabled.len();
    if off > 0 {
        println!(
            "  {}",
            style(format!(
                "{off} tool(s) are switched off for every key (see /tools)."
            ))
            .dim()
        );
    }
    println!(
        "  {}",
        style("Usage figures refresh about every 5 seconds while agents work.").dim()
    );
}

/// "all tools" or "5 of 21".
fn tools_label(tools: &Option<Vec<String>>, total: usize) -> String {
    match tools {
        None => "all tools".into(),
        Some(list) => format!("{} of {total}", list.len()),
    }
}

/// At most `n` characters, with `…` when cut.
fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n - 1).collect::<String>())
    }
}

/// `/keys`: list API keys, then create, turn on/off, delete or restore one.
pub fn keys(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    loop {
        let list = store::key_list(ctx)?;
        let rows = &list.live;
        println!("{}", style("API keys").bold());
        print_keys(rows, &list.disabled_tools);
        println!();
        let mut items: Vec<String> = vec!["Create a new key".into()];
        items.extend(rows.iter().map(|r| {
            format!(
                "Manage {} ({})",
                r.name,
                if r.enabled { "on" } else { "off" }
            )
        }));
        let has_trash = !list.trash.is_empty();
        if has_trash {
            items.push(format!(
                "Trash ({} deleted key(s), restore one)",
                list.trash.len()
            ));
        }
        items.push("Done".into());
        let Some(i) = Select::with_theme(theme)
            .with_prompt("What next? (Esc to go back)")
            .items(&items)
            .default(items.len() - 1)
            .interact_opt()?
        else {
            return Ok(());
        };
        if i == items.len() - 1 {
            return Ok(());
        }
        let done = if i == 0 {
            create_key(ctx, theme)?
        } else if has_trash && i == items.len() - 2 {
            trash(ctx, theme, &list.trash)?
        } else {
            manage_key(ctx, theme, &rows[i - 1])?
        };
        if !done {
            // Esc or "no" at any step: back to the prompt, nothing saved.
            return Ok(());
        }
        println!();
    }
}

/// Create a key and show it once. Returns false when cancelled.
fn create_key(ctx: &Ctx, theme: &ColorfulTheme) -> Result<bool> {
    let name: String = Input::with_theme(theme)
        .with_prompt("Name for the key (who or what uses it)")
        .default("agent".into())
        .validate_with(|n: &String| {
            if (1..=80).contains(&n.trim().chars().count()) {
                Ok(())
            } else {
                Err("1-80 characters")
            }
        })
        .interact_text()?;
    let name = name.trim().to_string();
    println!(
        "  {}",
        style("Default: use every MCP tool, read and write notes over the HTTP API.").dim()
    );
    let Some(defaults) = Confirm::with_theme(theme)
        .with_prompt("Default permissions (everything except admin)?")
        .default(true)
        .interact_opt()?
    else {
        println!("Cancelled. No key created.");
        return Ok(false);
    };
    let p = if defaults {
        default_perms()
    } else {
        match permissions_questionnaire(ctx, theme, &name, &default_perms())? {
            Some(p) => p,
            None => {
                println!("Cancelled. No key created.");
                return Ok(false);
            }
        }
    };
    let k = store::new_key(
        &name,
        store::parse_scopes(&p.scopes)?,
        store::grant(&p.tools),
    );
    let new = k.new.clone();
    let detail = perms_detail(&name, &p);
    store::write(ctx, |tx| {
        store::sync_catalog(tx)?;
        keys::create(tx, &new, now())?;
        store::log(tx, "key_created", &format!("{} ({})", new.name, new.id))?;
        if !defaults {
            store::log(tx, "key_permissions", &detail)?;
        }
        Ok(())
    })?;
    println!();
    println!(
        "  {} {}",
        style("New API key:").bold(),
        style(&k.raw).green().bold()
    );
    println!(
        "  {}",
        style("Copy it now: it is shown only once and stored only as a hash.").yellow()
    );
    println!(
        "  {}",
        style("Type /mcp to see how to connect an agent with it.").dim()
    );
    Ok(true)
}

/// Permissions, on/off or delete for one key. Returns false when cancelled.
fn manage_key(ctx: &Ctx, theme: &ColorfulTheme, k: &KeyView) -> Result<bool> {
    println!(
        "  {} {}  prefix {}  last used {} from {}",
        style(&k.name).bold(),
        style(&k.id).dim(),
        k.prefix,
        ago(k.last_used),
        k.last_ip
    );
    let current = Perms {
        scopes: k.scopes.clone(),
        tools: k.tools.clone(),
    };
    print_perms(&current);
    let toggle = if k.enabled {
        "Turn off (agents using it are refused until you turn it back on)"
    } else {
        "Turn on"
    };
    let Some(a) = Select::with_theme(theme)
        .with_prompt("Action (Esc to go back)")
        .items(&[
            "Permissions (what it may do, which tools it may use)",
            toggle,
            "Delete (moved to the trash; restore it from /keys -> Trash)",
            "Back",
        ])
        .default(0)
        .interact_opt()?
    else {
        return Ok(false);
    };
    match a {
        0 => {
            let Some(p) = permissions_questionnaire(ctx, theme, &k.name, &current)? else {
                println!("Nothing changed.");
                return Ok(false);
            };
            let patch = keys::KeyPatch {
                scopes: Some(store::parse_scopes(&p.scopes)?),
                tools: Some(store::grant(&p.tools)),
                ..Default::default()
            };
            let detail = perms_detail(&k.name, &p);
            store::write(ctx, |tx| {
                store::sync_catalog(tx)?;
                keys::update(tx, &k.id, &patch)?;
                store::log(tx, "key_permissions", &detail)
            })?;
            ok(&format!(
                "Permissions of {} saved. The server applies them on the next request.",
                k.name
            ));
        }
        1 => {
            let on = !k.enabled;
            let patch = keys::KeyPatch {
                enabled: Some(on),
                ..Default::default()
            };
            store::write(ctx, |tx| {
                keys::update(tx, &k.id, &patch)?;
                store::log(
                    tx,
                    if on { "key_enabled" } else { "key_disabled" },
                    &format!("{} ({})", k.name, k.id),
                )
            })?;
            ok(&format!(
                "{} is now {}.",
                k.name,
                if on { "on" } else { "off" }
            ));
        }
        2 => {
            let sure = Confirm::with_theme(theme)
                .with_prompt(format!(
                    "Delete key {}? Agents using it stop working at once.",
                    k.name
                ))
                .default(false)
                .interact_opt()?;
            if sure != Some(true) {
                println!("Kept.");
                return Ok(false);
            }
            store::write(ctx, |tx| {
                keys::trash(tx, &k.id, now())?;
                store::log(tx, "key_deleted", &format!("{} ({})", k.name, k.id))
            })?;
            ok(&format!(
                "{} deleted (in the trash: /keys -> Trash restores it).",
                k.name
            ));
        }
        _ => {}
    }
    Ok(true)
}

/// The trash: deleted keys, newest first; restore one. Returns false when cancelled.
fn trash(ctx: &Ctx, theme: &ColorfulTheme, rows: &[KeyView]) -> Result<bool> {
    println!("{}", style("Deleted API keys").bold());
    println!(
        "  {}",
        style(format!(
            "{:<3} {:<20} {:<14} {:<14} {}",
            "#", "name", "prefix", "deleted", "last used"
        ))
        .dim()
    );
    for (i, r) in rows.iter().enumerate() {
        println!(
            "  {:<3} {:<20} {:<14} {:<14} {}",
            i + 1,
            truncate(&r.name, 20),
            r.prefix,
            ago(r.deleted_at.unwrap_or(0)),
            ago(r.last_used)
        );
    }
    println!(
        "  {}",
        style("Deleted keys are refused. Restoring brings a key back with its").dim()
    );
    println!(
        "  {}",
        style("permissions; the server purges the trash after 90 days.").dim()
    );
    let mut items: Vec<String> = rows
        .iter()
        .map(|r| format!("Restore {} ({})", r.name, r.prefix))
        .collect();
    items.push("Back".into());
    let Some(i) = Select::with_theme(theme)
        .with_prompt("Restore a key? (Esc to go back)")
        .items(&items)
        .default(items.len() - 1)
        .interact_opt()?
    else {
        return Ok(false);
    };
    let Some(k) = rows.get(i) else {
        return Ok(true);
    };
    let sure = Confirm::with_theme(theme)
        .with_prompt(format!(
            "Restore {}? Agents holding it can use it again at once.",
            k.name
        ))
        .default(true)
        .interact_opt()?;
    if sure != Some(true) {
        println!("Nothing changed.");
        return Ok(false);
    }
    store::write(ctx, |tx| {
        keys::restore(tx, &k.id)?;
        store::log(tx, "key_restored", &format!("{} ({})", k.name, k.id))
    })?;
    ok(&format!(
        "{} restored ({}).",
        k.name,
        if k.enabled {
            "on"
        } else {
            "off: turn it on in Manage"
        }
    ));
    Ok(true)
}

// ---------------------------------------------------------------------------
// Tool switches and per-key permissions
// ---------------------------------------------------------------------------

/// Every scope, with the plain label used in the questionnaire.
const SCOPES: &[(&str, &str)] = &[
    (
        "mcp",
        "Use MCP tools (read-only ones unless write is ticked too)",
    ),
    ("read", "Read notes over the HTTP API"),
    ("write", "Change notes (HTTP API and MCP write tools)"),
    ("admin", "Admin: manage tools and keys"),
];

/// What one API key may do: its scopes and its tools (`None` = every tool).
#[derive(Clone)]
struct Perms {
    scopes: Vec<String>,
    tools: Option<Vec<String>>,
}

/// Scopes and tools of a new key.
fn default_perms() -> Perms {
    Perms {
        scopes: keys::Scope::DEFAULT
            .iter()
            .map(|s| s.as_str().to_string())
            .collect(),
        tools: None,
    }
}

/// Activity-log detail for a permission change.
fn perms_detail(name: &str, p: &Perms) -> String {
    let scopes = if p.scopes.is_empty() {
        "none".to_string()
    } else {
        p.scopes.join(",")
    };
    let tools = match &p.tools {
        None => "all".to_string(),
        Some(t) if t.is_empty() => "none".to_string(),
        Some(t) => t.join(","),
    };
    format!("{name}: scopes {scopes}; tools {tools}")
}

/// The tool catalog grouped by category, categories in catalog order.
fn catalog_by_category() -> Vec<(&'static str, Vec<memora_mcp::ToolSpec>)> {
    let mut out: Vec<(&'static str, Vec<memora_mcp::ToolSpec>)> = Vec::new();
    for t in memora_mcp::catalog() {
        match out.iter_mut().find(|(c, _)| *c == t.category) {
            Some((_, v)) => v.push(t),
            None => out.push((t.category, vec![t])),
        }
    }
    out
}

/// Names of every tool in the catalog.
fn catalog_names() -> Vec<&'static str> {
    memora_mcp::catalog().iter().map(|t| t.name).collect()
}

/// First sentence of a tool description, at most `n` characters.
fn one_line(desc: &str, n: usize) -> String {
    let line = desc.lines().next().unwrap_or("");
    let line = match line.find(". ") {
        Some(i) => &line[..=i],
        None => line,
    };
    truncate(line.trim(), n)
}

/// Every tool by category, with its on/off switch.
fn print_tools(disabled: &BTreeSet<String>) {
    let cats = catalog_by_category();
    let total: usize = cats.iter().map(|(_, v)| v.len()).sum();
    let on = cats
        .iter()
        .flat_map(|(_, v)| v)
        .filter(|t| !disabled.contains(t.name))
        .count();
    println!(
        "{} {}",
        style("MCP tools").bold(),
        style(format!("({on} of {total} on)")).dim()
    );
    for (cat, list) in &cats {
        let cat_on = list.iter().filter(|t| !disabled.contains(t.name)).count();
        println!(
            "  {} {}",
            style(cat).bold().cyan(),
            style(format!("{cat_on}/{}", list.len())).dim()
        );
        for t in list {
            let (m, name) = if disabled.contains(t.name) {
                (
                    style("✗").red().bold(),
                    style(format!("{:<22}", t.name)).dim(),
                )
            } else {
                (style("✓").green().bold(), style(format!("{:<22}", t.name)))
            };
            println!(
                "    {m} {name} {}",
                style(one_line(t.description, 70)).dim()
            );
        }
    }
}

/// `/tools`: list every MCP tool with its switch; turn tools on or off for everyone.
pub fn tools(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    println!("  Tools are what agents can do over MCP. A tool you switch off disappears for");
    println!(
        "  {}: it is hidden from their tool list and refused if called.",
        style("every agent and every API key").bold()
    );
    println!("  The running server applies a change on its next request; no restart needed.");
    println!(
        "  {}",
        style("To limit a single key instead, use /keys -> Manage -> Permissions.").dim()
    );
    println!();
    loop {
        let disabled = store::disabled_tools(ctx)?;
        print_tools(&disabled);
        println!();
        let items = [
            "Choose which tools are on, one category at a time",
            "Enable all tools",
            "Disable a whole category",
            "Done",
        ];
        let Some(i) = Select::with_theme(theme)
            .with_prompt("What next? (Esc to go back)")
            .items(&items)
            .default(0)
            .interact_opt()?
        else {
            return Ok(());
        };
        let cats = catalog_by_category();
        let new = match i {
            0 => {
                let Some(c) = pick_category(theme, &cats, &disabled, "Which category?")? else {
                    println!("Nothing changed.");
                    return Ok(());
                };
                let list = &cats[c].1;
                let labels: Vec<String> = list
                    .iter()
                    .map(|t| format!("{:<22} {}", t.name, one_line(t.description, 60)))
                    .collect();
                let checked: Vec<bool> = list.iter().map(|t| !disabled.contains(t.name)).collect();
                println!(
                    "  {}",
                    style("Ticked = on. Space ticks, a = all/none, Enter saves, Esc cancels.")
                        .dim()
                );
                let Some(on) = MultiSelect::with_theme(theme)
                    .with_prompt(format!("Tools in {} that are on", cats[c].0))
                    .items(&labels)
                    .defaults(&checked)
                    .max_length(15)
                    .interact_opt()?
                else {
                    println!("Nothing changed.");
                    return Ok(());
                };
                let mut new = disabled.clone();
                for (j, t) in list.iter().enumerate() {
                    if on.contains(&j) {
                        new.remove(t.name);
                    } else {
                        new.insert(t.name.to_string());
                    }
                }
                new
            }
            1 => BTreeSet::new(),
            2 => {
                let Some(c) = pick_category(
                    theme,
                    &cats,
                    &disabled,
                    "Switch off every tool in which category?",
                )?
                else {
                    println!("Nothing changed.");
                    return Ok(());
                };
                let mut new = disabled.clone();
                new.extend(cats[c].1.iter().map(|t| t.name.to_string()));
                new
            }
            _ => return Ok(()),
        };
        if !apply_switches(ctx, theme, &disabled, &new)? {
            return Ok(());
        }
        println!();
    }
}

/// Category picker showing how many tools of each are on.
fn pick_category(
    theme: &ColorfulTheme,
    cats: &[(&'static str, Vec<memora_mcp::ToolSpec>)],
    disabled: &BTreeSet<String>,
    prompt: &str,
) -> Result<Option<usize>> {
    let labels: Vec<String> = cats
        .iter()
        .map(|(c, v)| {
            let on = v.iter().filter(|t| !disabled.contains(t.name)).count();
            format!("{c:<10} {on} of {} on", v.len())
        })
        .collect();
    Ok(Select::with_theme(theme)
        .with_prompt(format!("{prompt} (Esc to cancel)"))
        .items(&labels)
        .default(0)
        .interact_opt()?)
}

/// Show what changes, confirm, save and log. Returns false when cancelled.
fn apply_switches(
    ctx: &Ctx,
    theme: &ColorfulTheme,
    old: &BTreeSet<String>,
    new: &BTreeSet<String>,
) -> Result<bool> {
    let turn_on: Vec<&String> = old.difference(new).collect();
    let turn_off: Vec<&String> = new.difference(old).collect();
    if turn_on.is_empty() && turn_off.is_empty() {
        println!("No change: those tools were already set that way.");
        return Ok(true);
    }
    let join = |v: &[&String]| v.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ");
    println!("{}", style("Summary").bold());
    if !turn_on.is_empty() {
        println!(
            "  {} {}",
            style("switch ON :").green().bold(),
            join(&turn_on)
        );
    }
    if !turn_off.is_empty() {
        println!(
            "  {} {}",
            style("switch OFF:").red().bold(),
            join(&turn_off)
        );
        println!(
            "  {}",
            style("Every agent loses these tools, whatever its key allows.").yellow()
        );
    }
    let total = catalog_names().len();
    let on_after = catalog_names()
        .iter()
        .filter(|n| !new.contains(**n))
        .count();
    println!(
        "  {}",
        style(format!("Afterwards {on_after} of {total} tools are on.")).dim()
    );
    if Confirm::with_theme(theme)
        .with_prompt("Save?")
        .default(true)
        .interact_opt()?
        != Some(true)
    {
        println!("Nothing changed.");
        return Ok(false);
    }
    store::write(ctx, |tx| {
        store::sync_catalog(tx)?;
        let t = now();
        for n in &turn_on {
            tools::set_enabled(tx, n, true, t)?;
            store::log(tx, "tool_enabled", n)?;
        }
        for n in &turn_off {
            tools::set_enabled(tx, n, false, t)?;
            store::log(tx, "tool_disabled", n)?;
        }
        Ok(())
    })?;
    ok("Saved (state database). The running server applies it on the next request.");
    Ok(true)
}

/// The permission lines shown in Manage and in the questionnaire summary.
fn print_perms(p: &Perms) {
    let label = |s: &str| {
        SCOPES
            .iter()
            .find(|(k, _)| *k == s)
            .map(|(_, l)| *l)
            .unwrap_or(s)
            .to_string()
    };
    let may: Vec<String> = SCOPES
        .iter()
        .filter(|(k, _)| p.scopes.iter().any(|s| s == k))
        .map(|(k, _)| label(k))
        .collect();
    let may_not: Vec<String> = SCOPES
        .iter()
        .filter(|(k, _)| !p.scopes.iter().any(|s| s == k))
        .map(|(k, _)| label(k))
        .collect();
    println!(
        "  may       : {}",
        if may.is_empty() {
            style("nothing (refused everywhere)".to_string()).red()
        } else {
            style(may.join(", ")).green()
        }
    );
    if !may_not.is_empty() {
        println!("  may not   : {}", style(may_not.join(", ")).dim());
    }
    let total = catalog_names().len();
    let tools = match &p.tools {
        None => format!("all tools ({total}, and any added by future updates)"),
        Some(t) if t.is_empty() => "none".to_string(),
        Some(t) => format!("{} of {total}: {}", t.len(), t.join(", ")),
    };
    if p.scopes.iter().any(|s| s == "mcp") {
        println!("  MCP tools : {tools}");
    } else {
        println!(
            "  MCP tools : {}",
            style(format!("{tools} (unused: MCP is not allowed)")).dim()
        );
    }
}

/// Two questions: what may the key do, and which tools may it use. Ends with
/// a summary and a confirmation. `None` when cancelled (Esc or "no").
fn permissions_questionnaire(
    ctx: &Ctx,
    theme: &ColorfulTheme,
    name: &str,
    current: &Perms,
) -> Result<Option<Perms>> {
    let disabled = store::disabled_tools(ctx)?;
    println!();
    println!(
        "{} {}",
        style("Permissions for").bold(),
        style(name).bold().cyan()
    );
    println!("  {}", style("Step 1 of 2: what may this key do?").bold());
    println!(
        "  {}",
        style("Space ticks, Enter goes on, Esc cancels without saving.").dim()
    );
    let labels: Vec<String> = SCOPES.iter().map(|(k, l)| format!("{l} [{k}]")).collect();
    let checked: Vec<bool> = SCOPES
        .iter()
        .map(|(k, _)| current.scopes.iter().any(|s| s == k))
        .collect();
    let Some(picked) = MultiSelect::with_theme(theme)
        .with_prompt("This key may")
        .items(&labels)
        .defaults(&checked)
        .interact_opt()?
    else {
        return Ok(None);
    };
    let scopes: Vec<String> = picked.iter().map(|&i| SCOPES[i].0.to_string()).collect();
    if scopes.is_empty() {
        println!(
            "  {} nothing ticked: every request with this key will be refused.",
            style("note:").yellow().bold()
        );
    }
    if scopes.iter().any(|s| s == "admin") {
        println!(
            "  {} {}",
            style("⚠ admin:").red().bold(),
            style("this key can switch tools on/off for everyone and create, change or delete")
                .yellow()
        );
        println!(
            "  {}",
            style("API keys (its own included) over the HTTP API and the MCP admin tools.")
                .yellow()
        );
        println!(
            "  {}",
            style("Give it only to an agent you fully trust.").yellow()
        );
    }
    println!();
    let tools = if scopes.iter().any(|s| s == "mcp") {
        println!(
            "  {}",
            style("Step 2 of 2: which MCP tools may it use?").bold()
        );
        let Some(mode) = Select::with_theme(theme)
            .with_prompt("Tool access (Esc cancels)")
            .items(&[
                "All tools (default; also tools added by future updates)",
                "Only selected tools",
            ])
            .default(usize::from(current.tools.is_some()))
            .interact_opt()?
        else {
            return Ok(None);
        };
        if mode == 0 {
            None
        } else {
            match pick_tools(theme, &disabled, &current.tools)? {
                Some(t) => Some(t),
                None => return Ok(None),
            }
        }
    } else {
        println!(
            "  {}",
            style("Step 2 of 2 skipped: without MCP the tool list does not matter.").dim()
        );
        current.tools.clone()
    };
    let p = Perms { scopes, tools };
    println!();
    println!(
        "{} {}",
        style("Summary for").bold(),
        style(name).bold().cyan()
    );
    print_perms(&p);
    let blocked: Vec<String> = match &p.tools {
        None => catalog_names()
            .into_iter()
            .filter(|n| disabled.contains(*n))
            .map(str::to_string)
            .collect(),
        Some(t) => t
            .iter()
            .filter(|n| disabled.contains(*n))
            .cloned()
            .collect(),
    };
    if !blocked.is_empty() && p.scopes.iter().any(|s| s == "mcp") {
        println!(
            "  {}",
            style(format!(
                "Switched off for everyone in /tools (unusable for now): {}",
                blocked.join(", ")
            ))
            .dim()
        );
    }
    let save = Confirm::with_theme(theme)
        .with_prompt("Save these permissions?")
        .default(true)
        .interact_opt()?;
    Ok((save == Some(true)).then_some(p))
}

/// Tick the tools a key may use, grouped by category. `None` on Esc.
fn pick_tools(
    theme: &ColorfulTheme,
    disabled: &BTreeSet<String>,
    current: &Option<Vec<String>>,
) -> Result<Option<Vec<String>>> {
    let all: Vec<memora_mcp::ToolSpec> = catalog_by_category()
        .into_iter()
        .flat_map(|(_, v)| v)
        .collect();
    let labels: Vec<String> = all
        .iter()
        .map(|t| {
            let off = if disabled.contains(t.name) {
                " (off for everyone)"
            } else {
                ""
            };
            format!(
                "{:<8} {:<22} {}{off}",
                t.category,
                t.name,
                one_line(t.description, 48)
            )
        })
        .collect();
    let checked: Vec<bool> = all
        .iter()
        .map(|t| {
            current
                .as_ref()
                .is_none_or(|c| c.iter().any(|n| n == t.name))
        })
        .collect();
    println!(
        "  {}",
        style("Ticked = allowed. Space ticks, a = all/none, Enter goes on, Esc cancels.").dim()
    );
    let Some(picked) = MultiSelect::with_theme(theme)
        .with_prompt("Tools this key may use (grouped by category)")
        .items(&labels)
        .defaults(&checked)
        .max_length(15)
        .interact_opt()?
    else {
        return Ok(None);
    };
    if picked.is_empty() {
        println!(
            "  {} no tool ticked: the key can connect over MCP but use no tool.",
            style("note:").yellow().bold()
        );
    }
    Ok(Some(
        picked.iter().map(|&i| all[i].name.to_string()).collect(),
    ))
}

// ---------------------------------------------------------------------------
// Signed-in devices
// ---------------------------------------------------------------------------

/// A short "Chrome on Windows" style label from a User-Agent.
fn device_name(ua: &str) -> String {
    if ua.is_empty() {
        return "unknown device".into();
    }
    let browser = if ua.contains("Edg/") {
        "Edge"
    } else if ua.contains("OPR/") {
        "Opera"
    } else if ua.contains("Firefox/") {
        "Firefox"
    } else if ua.contains("Chrome/") {
        "Chrome"
    } else if ua.contains("Safari/") {
        "Safari"
    } else if ua.starts_with("curl/") {
        "curl"
    } else {
        "browser"
    };
    let os = if ua.contains("Android") {
        "Android"
    } else if ua.contains("iPhone") || ua.contains("iPad") {
        "iOS"
    } else if ua.contains("Windows") {
        "Windows"
    } else if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        "macOS"
    } else if ua.contains("Linux") {
        "Linux"
    } else {
        "unknown OS"
    };
    format!("{browser} on {os}")
}

/// The signed-in devices table.
fn print_sessions(rows: &[SessionView]) {
    if rows.is_empty() {
        println!("  Nobody is signed in.");
        return;
    }
    println!(
        "  {}",
        style(format!(
            "{:<3} {:<10} {:<10} {:<20} {:<16} {:<14} {}",
            "#", "id", "via", "device", "IP", "signed in", "last active"
        ))
        .dim()
    );
    for (i, r) in rows.iter().enumerate() {
        println!(
            "  {:<3} {:<10} {:<10} {:<20} {:<16} {:<14} {}",
            i + 1,
            r.short_id,
            truncate(&r.source, 10),
            truncate(&device_name(&r.user_agent), 20),
            r.ip,
            ago(r.created),
            ago(r.last_seen)
        );
    }
}

/// `/sessions`: signed-in devices, with sign-out of one or all.
pub fn sessions(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    let rows = store::sessions(ctx)?;
    println!("{}", style("Signed-in devices").bold());
    print_sessions(&rows);
    if rows.is_empty() {
        return Ok(());
    }
    println!();
    let mut items: Vec<String> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            format!(
                "Sign out #{} ({}, {})",
                i + 1,
                device_name(&r.user_agent),
                r.ip
            )
        })
        .collect();
    items.push("Sign out every device".into());
    items.push("Done".into());
    let Some(i) = Select::with_theme(theme)
        .with_prompt("What next? (Esc to go back)")
        .items(&items)
        .default(items.len() - 1)
        .interact_opt()?
    else {
        return Ok(());
    };
    if i == items.len() - 1 {
        return Ok(());
    }
    if i == items.len() - 2 {
        return logout_all(ctx, theme);
    }
    let r = &rows[i];
    sign_out(
        ctx,
        theme,
        &r.sid_hash,
        &format!("#{} {} ({})", i + 1, device_name(&r.user_agent), r.short_id),
    )
}

/// `/logout <#|id|all>`.
pub fn logout(ctx: &Ctx, theme: &ColorfulTheme, arg: Option<&str>) -> Result<()> {
    match arg {
        Some("all") => logout_all(ctx, theme),
        Some(n)
            if n.len() >= session::MIN_PREFIX_LEN && n.chars().all(|c| c.is_ascii_hexdigit()) =>
        {
            sign_out(
                ctx,
                theme,
                n,
                &format!("session {}", n.to_ascii_lowercase()),
            )
        }
        Some(n) => {
            let rows = store::sessions(ctx)?;
            let Some(r) = n
                .trim_start_matches('#')
                .parse::<usize>()
                .ok()
                .and_then(|i| rows.get(i.wrapping_sub(1)))
            else {
                println!(
                    "No device #{n}. Type {} to see the numbers and ids",
                    style("/sessions").cyan()
                );
                println!(
                    "(an id needs at least {} characters).",
                    session::MIN_PREFIX_LEN
                );
                return Ok(());
            };
            sign_out(
                ctx,
                theme,
                &r.sid_hash,
                &format!(
                    "#{} {} ({})",
                    n.trim_start_matches('#'),
                    device_name(&r.user_agent),
                    r.short_id
                ),
            )
        }
        None => sessions(ctx, theme),
    }
}

/// Sign out every device, after confirmation.
fn logout_all(ctx: &Ctx, theme: &ColorfulTheme) -> Result<()> {
    let sure = Confirm::with_theme(theme)
        .with_prompt("Sign out every device, including your own browser?")
        .default(false)
        .interact_opt()?;
    if sure != Some(true) {
        println!("Nothing changed.");
        return Ok(());
    }
    let n: usize = store::write(ctx, |tx| {
        // count only live sessions; expired rows are removed silently
        let s = memora_state::settings::get(tx)?;
        let t = now();
        let n = session::list(tx)?
            .iter()
            .filter(|x| x.is_live(s.session_ttl, s.session_max_age, t))
            .count();
        session::revoke_all(tx)?;
        store::log(tx, "signout_cli", &format!("all devices ({n} session(s))"))?;
        Ok(n)
    })?;
    ok(&format!(
        "Every device is signed out ({n} session(s) ended)."
    ));
    Ok(())
}

/// Sign out the one session whose id starts with `prefix` (8-64 hex characters),
/// after confirmation. A prefix shared by several sessions is refused.
fn sign_out(ctx: &Ctx, theme: &ColorfulTheme, prefix: &str, label: &str) -> Result<()> {
    let sure = Confirm::with_theme(theme)
        .with_prompt(format!("Sign out {label}?"))
        .default(false)
        .interact_opt()?;
    if sure != Some(true) {
        println!("Nothing changed.");
        return Ok(());
    }
    let res: std::result::Result<usize, String> = store::with_db(ctx, |db| {
        let r = db.write(|tx| {
            let n = session::revoke_prefix(tx, prefix)?;
            if n > 0 {
                store::log(tx, "signout_cli", label)?;
            }
            Ok(n)
        });
        match r {
            Ok(n) => Ok(Ok(n)),
            Err(e @ (memora_state::Error::Conflict(_) | memora_state::Error::Invalid { .. })) => {
                Ok(Err(e.to_string()))
            }
            Err(e) => Err(e.into()),
        }
    })?;
    match res {
        Ok(0) => {
            println!("{label} is not signed in (already signed out or expired). Nothing changed.")
        }
        Ok(_) => ok(&format!("{label} is signed out.")),
        Err(msg) => println!(
            "{} {msg}. Nothing changed; type {} to see the ids.",
            style("!").yellow().bold(),
            style("/sessions").cyan()
        ),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

/// Plain-language label for an event name (unknown names are shown as they are).
fn describe(event: &str) -> &str {
    match event {
        "login_ok" | "signin" => "signed in",
        "logout" | "signout" => "signed out",
        "auth_fail" => "wrong password / credentials",
        "login_fail" => "sign-in failed",
        "cooldown" => "cooldown started (too many failures)",
        "code_ok" => "one-time code accepted",
        "code_burned" => "WRONG one-time code: window closed",
        "setup_done" => "owner account created",
        "password_reset" => "password reset (all devices signed out)",
        "password_changed" => "password changed",
        "username_changed" => "username changed",
        "vault_changed" => "vault folder changed",
        "key_created" => "API key created",
        "key_rolled" => "API key rolled (new secret)",
        "key_updated" => "API key updated",
        "key_deleted" => "API key deleted",
        "key_restored" => "API key restored",
        "key_enabled" => "API key turned on",
        "key_disabled" => "API key turned off",
        "key_permissions" => "API key permissions changed",
        "tool_enabled" => "tool switched on for every agent",
        "tool_disabled" => "tool switched off for every agent",
        "key_fail" => "invalid API key presented",
        "signout_cli" => "devices signed out from memora-cli",
        "window_opened" => "setup / reset window opened",
        "window_closed" => "setup / reset window closed",
        "unlocked" => "instance unlocked",
        "config_changed" => "server setting changed",
        "state_imported" => "old JSON state imported into the database",
        "state_restored" => "database restored from a backup",
        other => other,
    }
}

/// `/activity [N|fail]`: newest security events first.
pub fn activity(ctx: &Ctx, arg: Option<&str>) -> Result<()> {
    let only_bad = matches!(arg, Some("fail") | Some("failed") | Some("bad"));
    let limit = arg
        .and_then(|a| a.parse::<usize>().ok())
        .unwrap_or(30)
        .clamp(1, 500);
    let events = store::activity(ctx, limit, only_bad)?;
    println!(
        "{} {}",
        style("Security activity").bold(),
        style(if only_bad {
            "(failures only, newest first)"
        } else {
            "(newest first)"
        })
        .dim()
    );
    if events.is_empty() {
        println!("  Nothing recorded yet.");
        return Ok(());
    }
    for e in &events {
        let label = describe(&e.event).to_string();
        let label = if memora_state::activity::is_failure(&e.event) {
            style(label).red().bold()
        } else if matches!(
            e.event.as_str(),
            "login_ok" | "signin" | "logout" | "signout" | "code_ok"
        ) {
            style(label).green()
        } else {
            style(label).yellow()
        };
        let mut extra = Vec::new();
        if let Some(u) = e.actor.as_deref() {
            extra.push(if u == store::ACTOR {
                format!("by {u}")
            } else {
                format!("user {u}")
            });
        }
        if let Some(ip) = &e.ip {
            extra.push(format!("from {ip}"));
        }
        if !e.detail.is_empty() {
            extra.push(e.detail.clone());
        }
        println!(
            "  {:<10} {}  {}",
            style(ago(e.at)).dim(),
            label,
            style(extra.join(" · ")).dim()
        );
    }
    println!(
        "  {}",
        style("Tip: /activity 100 shows more, /activity fail shows only failures.").dim()
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// MCP connection guide
// ---------------------------------------------------------------------------

/// `/mcp`: how to connect common MCP clients to this server.
pub fn mcp_guide(ctx: &Ctx) -> Result<()> {
    let snap = ctx.snapshot()?;
    let base = ctx
        .setting(&snap, "MEMORA_BASE_URL")
        .map(|b| b.trim_end_matches('/').to_string())
        .unwrap_or_else(|| {
            format!(
                "http://<server-ip>:{}",
                ctx.setting(&snap, "MEMORA_PORT")
                    .unwrap_or_else(|| "8400".into())
            )
        });
    let url = format!("{base}/mcp");
    let h = |t: &str| println!("{}", style(t).bold().cyan());
    let code = |t: &str| {
        for l in t.lines() {
            println!("    {}", style(l).green());
        }
    };
    let note = |t: &str| println!("  {}", style(t).dim());

    h("Connect an agent over MCP");
    println!("  Memora speaks the standard Model Context Protocol: JSON-RPC 2.0 over the");
    println!("  Streamable HTTP transport. Every MCP client that supports remote HTTP");
    println!("  servers can connect.");
    println!();
    println!("  Endpoint : {}", style(&url).bold());
    println!("  Auth     : header  Authorization: Bearer <API key>   (or X-API-Key: <key>)");
    println!("  Discovery: {base}/.well-known/mcp.json   Tool list: {base}/tools");
    println!();
    note("Step 1. Get an API key: /keys -> Create a new key (shown once).");
    note("Step 2. Add the server to your client with one of the snippets below.");
    println!();
    h("Claude Code (terminal)");
    code(&format!(
        "claude mcp add --transport http memora {url} \\\n  --header \"Authorization: Bearer <API key>\""
    ));
    println!();
    h("Cursor, Windsurf, VS Code and other JSON configs (mcp.json / mcpServers)");
    code(&format!(
        "{{\n  \"mcpServers\": {{\n    \"memora\": {{\n      \"type\": \"http\",\n      \"url\": \"{url}\",\n      \"headers\": {{ \"Authorization\": \"Bearer <API key>\" }}\n    }}\n  }}\n}}"
    ));
    note("VS Code uses the key \"servers\" instead of \"mcpServers\" in .vscode/mcp.json.");
    println!();
    h("Clients that only run local (stdio) servers, e.g. Claude Desktop config file");
    code(&format!(
        "{{\n  \"mcpServers\": {{\n    \"memora\": {{\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"mcp-remote\", \"{url}\",\n               \"--header\", \"Authorization: Bearer <API key>\"]\n    }}\n  }}\n}}"
    ));
    note("mcp-remote (npm) bridges stdio to the HTTP endpoint; it needs Node.js.");
    println!();
    h("Test from a shell");
    code(&format!(
        "curl -s {url} -H \"Authorization: Bearer <API key>\" \\\n  -H 'Content-Type: application/json' \\\n  -d '{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}}'"
    ));
    println!();
    note("If the server sets MEMORA_DOMAIN or MEMORA_BASE_URL, use that domain:");
    note("other hosts get 404.");
    note("Watch what agents do with /keys (last used, IP, calls) and /activity.");
    Ok(())
}
