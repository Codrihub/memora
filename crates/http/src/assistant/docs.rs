//! Memora's own documentation for Mnemo: the Markdown the Docs page shows (written by the
//! web build to `<assets>/mnemo-docs.json`), cut into sections at its headings, so Mnemo can
//! answer questions about Memora and link the right page.

use serde_json::{json, Value};
use std::sync::OnceLock;

use crate::AppState;

const REPO: &str = "https://github.com/Codrihub/memora/blob/main/";

#[derive(Debug, Clone)]
pub struct Section {
    pub slug: String,
    pub page: String,
    pub file: String,
    pub heading: String,
    pub anchor: String,
    pub text: String,
}

/// A heading's anchor, as the Docs page makes it (lowercase words joined by dashes).
pub fn anchor(heading: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in heading.trim().to_lowercase().chars() {
        if c.is_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

/// Cut one Markdown file into sections at `#`, `##` and `###` headings (not in code).
pub fn sections(slug: &str, page: &str, file: &str, md: &str) -> Vec<Section> {
    let mut out: Vec<Section> = Vec::new();
    let mut cur = Section {
        slug: slug.into(),
        page: page.into(),
        file: file.into(),
        heading: page.into(),
        anchor: String::new(),
        text: String::new(),
    };
    let mut fence = false;
    for line in md.lines() {
        if line.trim_start().starts_with("```") {
            fence = !fence;
        }
        let h = line.trim_start_matches('#');
        let level = line.len() - h.len();
        if !fence && (1..=3).contains(&level) && h.starts_with(' ') {
            if !cur.text.trim().is_empty() || !out.is_empty() {
                out.push(cur.clone());
            }
            let heading = h.trim().to_string();
            cur = Section {
                anchor: if level == 1 {
                    String::new()
                } else {
                    anchor(&heading)
                },
                heading,
                text: String::new(),
                ..cur
            };
            continue;
        }
        cur.text.push_str(line);
        cur.text.push('\n');
    }
    out.push(cur);
    out.retain(|s| !s.text.trim().is_empty());
    out
}

fn all(st: &AppState) -> &'static [Section] {
    static DOCS: OnceLock<Vec<Section>> = OnceLock::new();
    DOCS.get_or_init(|| {
        let raw = std::fs::read_to_string(std::path::Path::new(&st.assets).join("mnemo-docs.json"))
            .unwrap_or_default();
        let list: Vec<Value> = serde_json::from_str(&raw).unwrap_or_default();
        list.iter()
            .flat_map(|d| {
                sections(
                    d["slug"].as_str().unwrap_or(""),
                    d["title"].as_str().unwrap_or(""),
                    d["file"].as_str().unwrap_or(""),
                    d["text"].as_str().unwrap_or(""),
                )
            })
            .collect()
    })
}

fn links(s: &Section) -> (String, String) {
    let hash = if s.anchor.is_empty() {
        String::new()
    } else {
        format!("#{}", s.anchor)
    };
    (
        format!("/docs/{}{hash}", s.slug),
        format!("{REPO}{}{hash}", s.file),
    )
}

/// Sections holding the most of the query's words (headings count triple), best first.
pub fn search<'a>(list: &'a [Section], q: &str, limit: usize) -> Vec<(i64, &'a Section)> {
    let words: Vec<String> = q
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|w| w.chars().count() > 1)
        .map(str::to_lowercase)
        .collect();
    if words.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<(i64, &Section)> = list
        .iter()
        .filter_map(|s| {
            let head = s.heading.to_lowercase();
            let body = s.text.to_lowercase();
            let mut score = 0i64;
            let mut found = 0;
            for w in &words {
                let h = head.matches(w.as_str()).count() as i64;
                let b = body.matches(w.as_str()).count().min(8) as i64;
                if h + b > 0 {
                    found += 1;
                }
                score += h * 3 + b;
            }
            (found > 0).then_some((score * found, s))
        })
        .collect();
    hits.sort_by_key(|a| std::cmp::Reverse(a.0));
    hits.truncate(limit);
    hits
}

pub const SEARCH: &str = "search_docs";
pub const READ: &str = "read_docs";

pub fn defs() -> [super::ToolDef; 2] {
    [
        super::ToolDef {
            name: SEARCH.into(),
            description:
                "Search Memora's own documentation (install, setup, agents and MCP, settings, \
API, deployment, security, what changed) for a question about Memora itself. Gives sections with a \
link into the app's Docs page and on GitHub; read_docs gives a section in full."
                    .into(),
            parameters: json!({
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
                "additionalProperties": false
            }),
        },
        super::ToolDef {
            name: READ.into(),
            description: "Read a section of Memora's documentation by page slug and heading (from \
search_docs); without a heading, the page's list of headings."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {"page": {"type": "string"}, "heading": {"type": "string"}},
                "required": ["page"],
                "additionalProperties": false
            }),
        },
    ]
}

pub fn run(st: &AppState, name: &str, args: &Value) -> Result<Value, String> {
    let list = all(st);
    if list.is_empty() {
        return Err("the documentation is not available on this server".into());
    }
    if name == SEARCH {
        let q = args["query"].as_str().unwrap_or("").trim();
        let hits = search(list, q, 6);
        if hits.is_empty() {
            return Ok(json!({"hits": [], "note": "nothing in the docs matches; try other words"}));
        }
        return Ok(json!({"hits": hits.iter().map(|(_, s)| {
            let (app, github) = links(s);
            let snippet: String = s.text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(320).collect();
            json!({"page": s.slug, "page_title": s.page, "heading": s.heading, "link": app, "github": github, "snippet": snippet})
        }).collect::<Vec<_>>()}));
    }
    let page = args["page"].as_str().unwrap_or("").trim();
    let of_page: Vec<&Section> = list.iter().filter(|s| s.slug == page).collect();
    if of_page.is_empty() {
        let pages: std::collections::BTreeSet<&str> =
            list.iter().map(|s| s.slug.as_str()).collect();
        return Err(format!(
            "no docs page {page}; pages: {}",
            pages.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    match args["heading"]
        .as_str()
        .map(str::trim)
        .filter(|h| !h.is_empty())
    {
        None => Ok(
            json!({"page": page, "title": of_page[0].page, "headings": of_page.iter().map(|s| json!({"heading": s.heading, "link": links(s).0})).collect::<Vec<_>>()}),
        ),
        Some(h) => {
            let want = h.to_lowercase();
            let s = of_page
                .iter()
                .find(|s| s.heading.to_lowercase() == want || s.anchor == anchor(h))
                .or_else(|| of_page.iter().find(|s| s.heading.to_lowercase().contains(&want)))
                .ok_or_else(|| format!("no heading \"{h}\" in {page}; call read_docs without a heading for the list"))?;
            let (app, github) = links(s);
            let text: String = s.text.chars().take(7000).collect();
            Ok(
                json!({"page": page, "heading": s.heading, "link": app, "github": github, "text": text}),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docs_split_at_headings_and_search_finds_the_right_one() {
        let md = "# Memora\nIntro text.\n\n## Connect an agent\nUse an MCP key with Claude.\n```\n## not a heading\n```\n### API keys\nKeys have scopes.\n";
        let s = sections("mcp", "MCP tools", "docs/MCP.md", md);
        let heads: Vec<&str> = s.iter().map(|x| x.heading.as_str()).collect();
        assert_eq!(heads, vec!["Memora", "Connect an agent", "API keys"]);
        assert_eq!(s[1].anchor, "connect-an-agent");
        assert!(
            s[1].text.contains("## not a heading"),
            "headings in code stay text"
        );
        let hits = search(&s, "how do I connect claude", 3);
        assert_eq!(hits[0].1.heading, "Connect an agent");
        assert_eq!(links(hits[0].1).0, "/docs/mcp#connect-an-agent");
        assert_eq!(anchor("Set up: TLS & proxies"), "set-up-tls-proxies");
    }
}
