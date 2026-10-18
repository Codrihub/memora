//! `/welcome`: the same five-step introduction as the browser's /welcome page,
//! one screen per step. Enter or → moves on, ← goes back, s skips.
//!
//! Shown once on the first console start; "seen" is stored in the state
//! database (`ui_layout` row `welcome_cli`, the browser keeps its own
//! `welcome`), so it does not come back on the next run.

use super::Ctx;
use super::{wrap, DESCRIPTION, MOTTO, NAME_NOTE, ONCE};
use crate::store;
use anyhow::Result;
use console::{style, Key, Term};

/// `ui_layout` row that records that the console welcome was seen.
const FLAG: &str = "welcome_cli";

/// Text width of a step.
const WIDTH: usize = 70;

/// Whether the console welcome was seen before. Unreadable state counts as
/// seen: better to skip it than to show it on every start.
pub(super) fn seen(ctx: &Ctx) -> bool {
    store::read(ctx, |c| {
        memora_state::ui_layout::get(c, FLAG).map(|l| l.is_some())
    })
    .unwrap_or(true)
}

fn mark_seen(ctx: &Ctx) {
    let now = memora_state::now();
    let data = format!("{{\"seen_at\":{now}}}");
    let _ = store::write(ctx, |tx| memora_state::ui_layout::put(tx, FLAG, &data, now));
}

fn para(text: &str) {
    for line in wrap(text, WIDTH) {
        println!("  {line}");
    }
    println!();
}

fn title(eyebrow: &str, head: &str) {
    println!("  {}", style(eyebrow).cyan());
    println!("  {}", style(head).bold());
    println!();
}

fn step(i: usize, owner: bool) {
    match i {
        0 => {
            println!("{}", style(super::BANNER).cyan().bold());
            println!();
            title("Welcome to Memora", MOTTO);
            para(DESCRIPTION);
            for line in wrap(NAME_NOTE, WIDTH) {
                println!("  {}", style(line).dim().italic());
            }
            println!();
        }
        1 => {
            title("Why Memora", "Set up once. Use it everywhere.");
            para(
                "Every agent usually starts from zero: the same instructions pasted into Claude, \
                 the same skills set up again in Cursor, the same background handed to ChatGPT and \
                 to your own scripts. Memora keeps it in one place. Connect each agent once and \
                 they all read the same vault and write back to it, so what one learns, the \
                 others can use.",
            );
            let c = |s: &str| style(s.to_string()).cyan().to_string();
            let m = style("[ Memora ]").cyan().bold().to_string();
            println!("        Claude ─┐                  ┌─ this computer");
            println!("        Cursor ─┤                  ├─ local network");
            println!("       ChatGPT ─┼──{} {m} {}──┤", c("▶"), c("▶"));
            println!("    your agent ─┘                  └─ internet (tunnel)");
            println!();
        }
        2 => {
            title("Your server, your reach", "Reachable from anywhere");
            para(
                "Run Memora on your laptop, a home server or a VPS. Use it on the local network, or \
                 forward it to the internet through a tunnel or a reverse proxy. Agents connect over \
                 MCP with their own key; you sign in from any browser, desktop or phone.",
            );
            println!(
                "  {}",
                style("localhost · LAN · Cloudflare Tunnel · Tailscale · ngrok · nginx / Caddy")
                    .dim()
            );
            println!();
        }
        3 => {
            title("What's inside", "Everything in one vault");
            let item = |name: &str, text: &str| {
                println!("  {} {}", style("•").cyan(), style(name).bold());
                for line in wrap(text, WIDTH - 4) {
                    println!("    {line}");
                }
            };
            item("Vault", "Your notes stay plain Markdown files in a folder you choose. Nothing is locked in.");
            item(
                "Brain, Graph, Canvas",
                "See how every note connects: in 3D, as a graph, or laid out on a board.",
            );
            item(
                "Agents & keys",
                "One key per agent, with its own permissions. Revoke any of them at any time.",
            );
            item(
                "Activity",
                "Every read and write by an agent shows up live, so you always know who did what.",
            );
            println!();
        }
        _ => {
            title("You're all set", "Where would you like to start?");
            let cmd = |c: &str, text: &str| println!("  {:<10} {text}", style(c).cyan().bold());
            if owner {
                cmd("/keys", "create a key for Claude, Cursor or any MCP app");
                cmd("/mcp", "copy-paste configs to connect your agents");
                cmd("/web", "a one-time code to finish something in the browser");
            } else {
                cmd("/guide", "a walkthrough for this instance");
                cmd("/setup", "create the owner account");
                cmd(
                    "/web",
                    "or finish setup in the browser with a one-time code",
                );
            }
            cmd("/docs", "guides, agent instructions and troubleshooting");
            cmd("/help", "every command, grouped by what it is for");
            println!();
            para(ONCE);
            println!(
                "  {}",
                style(
                    "Open this again any time with /welcome; the browser has it at /welcome too."
                )
                .dim()
            );
            println!();
        }
    }
}

const STEPS: usize = 5;

/// Run the steps. Returns when the operator finishes or skips.
pub(super) fn run(ctx: &Ctx) -> Result<()> {
    mark_seen(ctx);
    let term = Term::stdout();
    if !term.is_term() {
        for i in 0..STEPS {
            step(i, true);
        }
        return Ok(());
    }
    let owner = ctx.owner().ok().flatten().is_some();
    let mut at = 0;
    loop {
        let _ = term.clear_screen();
        println!();
        step(at, owner);
        let dots: String = (0..STEPS)
            .map(|k| if k == at { "●" } else { "○" })
            .collect::<Vec<_>>()
            .join(" ");
        let last = at + 1 == STEPS;
        let next = if last { "Enter  done" } else { "Enter  next" };
        let back = if at > 0 { "   ←  back" } else { "" };
        println!(
            "  {}   {}{}   {}",
            style(dots).cyan(),
            style(next).bold(),
            style(back).dim(),
            style("s skip").dim()
        );
        // Other keys are ignored without redrawing the step.
        let go = loop {
            match term.read_key() {
                Ok(Key::Enter | Key::ArrowRight | Key::Char(' ') | Key::Char('n')) => {
                    break Some(1)
                }
                Ok(Key::ArrowLeft | Key::Char('b')) if at > 0 => break Some(-1),
                Ok(Key::Escape | Key::Char('s') | Key::Char('q')) | Err(_) => break None,
                Ok(_) => {}
            }
        };
        match go {
            Some(1) if last => break,
            Some(1) => at += 1,
            Some(_) => at -= 1,
            None => break,
        }
    }
    let _ = term.clear_screen();
    Ok(())
}
