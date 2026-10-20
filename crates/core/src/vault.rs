//! Vault store: note/folder CRUD, tags and frontmatter, markdown rendering,
//! git-backed history, zip export/import, soft locks, activity log, actor
//! aliases, trash, and retagging.
//!
//! Implemented as inherent `impl` blocks on [`MemoryStore`], split across files;
//! `MemoryStore` remains a single type.

use crate::privacy::PathEvent;
use crate::{folder_of, re_tag, re_wikilink, MemoryStore};

/// Refusal for a folder operation that would carry items hidden from the caller.
const PROTECTED_INSIDE: &str = "permission denied: the folder holds items you cannot access";
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

/// A regex compiled once per call site (the renderer runs per line; compiling its
/// patterns on every call dominated the cost of rendering a note).
macro_rules! static_re {
    ($pat:expr) => {{
        static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        RE.get_or_init(|| Regex::new($pat).unwrap())
    }};
}

// ---------------------------------------------------------------------------
// Expected errors (user-facing, not bugs)
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct MemoryErr(pub String);

impl std::fmt::Display for MemoryErr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for MemoryErr {}

pub type MResult<T> = Result<T, MemoryErr>;

pub fn err<T>(m: impl Into<String>) -> MResult<T> {
    Err(MemoryErr(m.into()))
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

/// Frontmatter `status` values that `follow_ups` reports (still awaiting action).
pub const FOLLOW_UP_STATUSES: &[&str] = &[
    "pending",
    "open",
    "todo",
    "in-progress",
    "waiting",
    "blocked",
];

/// Whether note `rel` is in `folder` or one of its subfolders. Case-sensitive, like
/// vault paths; slashes around `folder` are ignored; `Root` means the top level;
/// an empty folder matches every note.
pub fn in_folder(rel: &str, folder: &str) -> bool {
    let f = folder.trim().trim_matches('/');
    if f.is_empty() {
        return true;
    }
    if f == "Root" && !rel.contains('/') {
        return true;
    }
    rel.strip_prefix(f)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// Bidi controls (overrides, embeddings, isolates, marks) and zero-width characters:
/// invisible, and able to make a displayed name read differently from what it is.
pub fn is_invisible_format(c: char) -> bool {
    matches!(
        c,
        '\u{061C}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{2069}'
            | '\u{FEFF}'
    )
}

pub fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// Current local time with offset, second resolution.
pub fn now_iso() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

/// `#rrggbb`.
pub fn is_hex_color(c: &str) -> bool {
    let h = c.strip_prefix('#').unwrap_or("");
    h.len() == 6 && h.bytes().all(|b| b.is_ascii_hexdigit())
}

/// One folder name segment: word characters, spaces (as `_`) and dashes.
pub fn clean_segment(name: &str) -> MResult<String> {
    let re = static_re!(r"[^\w\s-]");
    let seg = re.replace_all(name, "").trim().replace(' ', "_");
    if seg.is_empty() || seg.starts_with('.') {
        return err(format!("invalid folder name: {name}"));
    }
    // The filesystem's limit per name; past it a folder cannot be created.
    if seg.len() > MAX_SEGMENT_BYTES {
        return err(format!(
            "folder name is too long ({} bytes; at most {MAX_SEGMENT_BYTES} per folder name)",
            seg.len()
        ));
    }
    Ok(seg)
}

/// Longest folder name (one path segment) in bytes.
pub const MAX_SEGMENT_BYTES: usize = 255;

/// Longest folder description (`desc` in folder metadata), in characters.
pub const MAX_FOLDER_DESC: usize = 500;

/// Folder icon names the web UI draws (`web/src/vault/icons.ts`, `FOLDER_ICONS`).
#[rustfmt::skip]
pub const FOLDER_ICONS: &[&str] = &[
    "star", "book", "code", "brain", "flask", "briefcase", "archive", "inbox", "user", "users",
    "calendar", "bulb", "heart", "credit-card", "wallet", "cpu", "key", "lock", "shield",
    "server", "database", "terminal", "cloud", "globe", "home", "settings", "tag", "mail",
    "chart", "dollar", "cart", "rocket", "wrench", "image", "music", "map", "school", "file",
];

/// Other names the web UI accepts for the same icons (`ICON_ALIASES` there).
#[rustfmt::skip]
const FOLDER_ICON_ALIASES: &[&str] = &[
    "creditcard", "card", "billing", "payment", "money", "finance", "dollar-sign",
    "circle-dollar-sign", "chip", "key-round", "shield-check", "hard-drive", "bar-chart",
    "chart-bar", "line-chart", "shopping-cart", "gear", "cog", "house", "graduation-cap",
    "lightbulb", "idea", "notebook", "book-open", "person", "people", "file-text", "photo",
    "tool", "tools", "calendar-days", "work", "email", "world", "flask-conical", "beaker",
];

/// Whether `icon` is a folder icon: an icon name the web UI knows (any case, with or
/// without a `lucide:`/`icon:` prefix, as the UI reads it) or a single emoji.
pub fn is_folder_icon(icon: &str) -> bool {
    let k = icon.trim().to_lowercase();
    let k = k
        .strip_prefix("lucide:")
        .or_else(|| k.strip_prefix("lucide-"))
        .or_else(|| k.strip_prefix("icon:"))
        .or_else(|| k.strip_prefix("icon-"))
        .unwrap_or(&k);
    let k = k
        .split([' ', '_'])
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if FOLDER_ICONS.contains(&k.as_str())
        || FOLDER_ICON_ALIASES.contains(&k.as_str())
        || FOLDER_ICON_ALIASES.contains(&k.replace('-', "").as_str())
    {
        return true;
    }
    // One emoji: a few code points (skin tones, ZWJ sequences, flags), no letters,
    // digits or spaces, and at least one pictographic (non-ASCII) character.
    let n = icon.chars().count();
    // Base pictographs: joiners, variation selectors and skin tones attach to one;
    // a flag is a pair of regional indicators. More than one base is two emoji.
    let bases = icon
        .chars()
        .filter(|&c| {
            let u = c as u32;
            u >= 0x2000
                && u != 0x200D
                && !(0xFE00..=0xFE0F).contains(&u)
                && !(0x1F3FB..=0x1F3FF).contains(&u)
                && !(0x1F1E6..=0x1F1FF).contains(&u)
        })
        .count();
    let flags = icon
        .chars()
        .filter(|&c| (0x1F1E6..=0x1F1FF).contains(&(c as u32)))
        .count();
    let zwj = icon.contains('\u{200D}');
    let one = if flags > 0 {
        flags == 2 && bases == 0
    } else {
        bases == 1 || (zwj && bases >= 1)
    };
    one && (1..=10).contains(&n)
        && icon.chars().any(|c| (c as u32) >= 0x2000)
        && !icon
            .chars()
            .any(|c| c.is_alphanumeric() || c.is_whitespace() || c.is_ascii())
}

/// A folder path the caller names (a folder to act on or a destination), checked
/// before any cleaning: relative to the vault, `/`-separated, no `.`, `..`, empty
/// or hidden segment. Returns it trimmed, without a trailing `/`.
pub fn folder_arg(path: &str) -> MResult<String> {
    let p = path.trim();
    if is_absolute_input(p) {
        return err(format!(
            "folder path must be relative to the vault (no leading /): {path}"
        ));
    }
    if p.contains('\\') || p.chars().any(char::is_control) {
        return err(format!(
            "invalid folder path (use / between folders, no control characters): {path:?}"
        ));
    }
    let p = p.trim_end_matches('/');
    if p.is_empty() {
        return Ok(String::new());
    }
    for seg in p.split('/') {
        if seg.trim().is_empty() {
            return err(format!("invalid folder path (empty folder name): {path}"));
        }
        if seg == "." || seg == ".." {
            return err(format!(
                "folder path must stay inside the vault (no '.' or '..'): {path}"
            ));
        }
        if seg.trim().starts_with('.') {
            return err(format!(
                "invalid folder path (names starting with '.' are reserved): {path}"
            ));
        }
    }
    Ok(p.to_string())
}

/// Whether `path` names the top level: empty, or `Root` in any case.
pub fn is_root_alias(path: &str) -> bool {
    let p = path.trim();
    p.is_empty() || p.eq_ignore_ascii_case("root")
}

/// Refuse a new folder path whose top-level name is `Root` (any case): `Root` means
/// the top level of the vault, so such a folder could never be addressed.
fn refuse_root_name(path: &str) -> MResult<()> {
    let first = path.split('/').next().unwrap_or("");
    if first.eq_ignore_ascii_case("root") {
        return err("'Root' is reserved for the top level of the vault; pick another folder name");
    }
    Ok(())
}

/// What the caller is told when cleaning changed the folder name they asked for.
fn renamed_note(asked: &str, got: &str) -> Option<String> {
    let asked = asked.trim().trim_end_matches('/');
    (asked != got).then(|| {
        format!(
            "'{asked}' was saved as '{got}' (spaces become _; characters other than \
             letters, digits, _ and - are dropped)"
        )
    })
}

/// A folder path (`A/B/C`) with every segment cleaned by [`clean_segment`].
pub fn clean_folder_path(path: &str) -> MResult<String> {
    let segs: Vec<String> = path
        .split('/')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(clean_segment)
        .collect::<MResult<_>>()?;
    if segs.is_empty() || segs.len() > 12 {
        return err(format!("invalid folder path: {path}"));
    }
    Ok(segs.join("/"))
}

/// Turn a note title into a filesystem-safe filename (at most 80 characters).
pub fn safe_filename(title: &str) -> MResult<String> {
    let re = static_re!(r"[^\w\s-]");
    let name = re.replace_all(title, "").trim().replace(' ', "_");
    if name.is_empty() {
        return err("title produces an empty filename");
    }
    let out: String = name.chars().take(80).collect();
    Ok(out)
}

/// The file name a note title makes (see [`note_filename`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteName {
    /// File name without `.md`.
    pub file: String,
    /// The title as given, trimmed and without a trailing `.md`.
    pub title: String,
}

impl NoteName {
    /// Whether characters were removed or the name was cut to make the file name
    /// (spaces becoming `_` does not count).
    pub fn changed(&self) -> bool {
        self.file != self.title.replace(' ', "_")
    }
}

/// The file name for a note title: a trailing `.md` is dropped (`Ideas.md` is the
/// note `Ideas`), then [`safe_filename`] applies. A title that looks like a path
/// (`/`, `\`, a leading `..`) is refused rather than quietly flattened.
pub fn note_filename(title: &str) -> MResult<NoteName> {
    let mut t = title.trim();
    if t.len() > 3
        && t.is_char_boundary(t.len() - 3)
        && t[t.len() - 3..].eq_ignore_ascii_case(".md")
    {
        t = t[..t.len() - 3].trim_end();
    }
    if t.contains('/') || t.contains('\\') {
        return err(format!(
            "title `{title}` contains `/` or `\\`; give the folder in `folder` and only the name in `title`"
        ));
    }
    if t.starts_with("..") {
        return err(format!("title `{title}` cannot start with `..`"));
    }
    Ok(NoteName {
        file: safe_filename(t)?,
        title: t.to_string(),
    })
}

/// `(renamed_from, note)` for a create reply when the title had to change to make
/// the file name, so the caller learns the note's real name.
pub fn title_notice(title: &str, path: &str) -> Option<(String, String)> {
    let n = note_filename(title).ok()?;
    n.changed().then(|| {
        (
            title.to_string(),
            format!(
                "the title was changed to make a safe file name (at most 80 letters, digits, `_` and `-`; spaces become `_`); the note is `{path}`"
            ),
        )
    })
}

/// A note path from a caller with `\` read as `/` and no leading `/`
/// (`Notes\Ideas.md` -> `Notes/Ideas.md`), so replies echo the stored path.
pub fn norm_note_path(path: &str) -> String {
    path.trim()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string()
}

/// Whether a caller's path is absolute (`/etc`, `\\host`, `C:\x`, `C:/x`).
pub fn is_absolute_input(path: &str) -> bool {
    let p = path.trim();
    let b = p.as_bytes();
    p.starts_with(['/', '\\']) || (b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic())
}

/// Whether a real (canonical, vault-relative) path is one of the store's own
/// entries: any segment starting with `.`, except the trash folder at the top.
fn reserved_real_path(real_rel: &str) -> bool {
    real_rel
        .split('/')
        .enumerate()
        .any(|(i, seg)| seg.starts_with('.') && !(i == 0 && seg == ".Trash"))
}

/// A path segment Windows would not store as written: a stream or drive
/// (`:`), a trailing dot or space (silently dropped, so `Private.` opens
/// `Private`), a short-name alias (`GIT~1`), or a reserved device name
/// (`CON`, `nul.md`, `COM1.txt` ...).
pub fn windows_unsafe_segment(seg: &str) -> bool {
    if seg.is_empty() || seg == "." {
        return false;
    }
    if seg.contains(':') || seg.ends_with('.') || seg.ends_with(' ') {
        return true;
    }
    let stem = seg.split('.').next().unwrap_or("").trim_end();
    if let Some((_, n)) = stem.rsplit_once('~') {
        if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) {
            return true;
        }
    }
    let up = stem.to_uppercase();
    let device_digit = |rest: &str| {
        matches!(
            rest,
            "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
        ) || matches!(rest, "\u{b9}" | "\u{b2}" | "\u{b3}")
    };
    matches!(
        up.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"]
        .iter()
        .any(|p| up.strip_prefix(p).is_some_and(device_digit))
}

/// The folder holding a note path, in full (`Projects/Atlas/Overview.md` ->
/// `Projects/Atlas`); `""` for a note at the top level.
pub fn parent_folder(rel: &str) -> &str {
    rel.rsplit_once('/').map_or("", |(d, _)| d)
}

/// Whether `s` is a date (`YYYY-MM-DD`) or a date and time (ISO 8601 / RFC 3339,
/// with or without an offset).
pub fn is_date_like(s: &str) -> bool {
    use chrono::{DateTime, NaiveDate, NaiveDateTime};
    let s = s.trim();
    NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
        || DateTime::parse_from_rfc3339(s).is_ok()
        || [
            "%Y-%m-%dT%H:%M:%S%.f",
            "%Y-%m-%d %H:%M:%S%.f",
            "%Y-%m-%dT%H:%M",
            "%Y-%m-%d %H:%M",
        ]
        .iter()
        .any(|f| NaiveDateTime::parse_from_str(s, f).is_ok())
}

/// Why a note's frontmatter cannot be read, if it is malformed: it opens with
/// `---` but never closes, or a top-level line is not `key: value`.
pub fn frontmatter_problem(content: &str) -> Option<String> {
    if !content.starts_with("---") {
        return None;
    }
    let mut lines = content.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return Some("the first line must be exactly `---`".into());
    }
    let Some(fm) = lines
        .clone()
        .position(|l| l.trim_end() == "---")
        .map(|end| lines.take(end))
    else {
        return Some("no closing `---` line".into());
    };
    for line in fm {
        let t = line.trim();
        let continuation = line.starts_with([' ', '\t', '-']);
        if t.is_empty() || t.starts_with('#') || continuation {
            continue;
        }
        if !line.contains(':') {
            return Some(format!("line `{t}` is not `key: value`"));
        }
    }
    None
}

/// Split frontmatter from body. Frontmatter is non-empty only when the note
/// starts with `---`.
pub fn split_frontmatter(content: &str) -> (String, String) {
    if let Some(after) = content.strip_prefix("---") {
        let parts: Vec<&str> = after.splitn(2, "---").collect();
        if parts.len() >= 2 {
            return (parts[0].to_string(), parts[1].to_string());
        }
    }
    (String::new(), content.to_string())
}

/// Parse a frontmatter value: `[a, b]` becomes an array, anything else a string.
pub fn parse_fm_value(v: &str) -> Value {
    let v = v.trim();
    if v.starts_with('[') && v.ends_with(']') {
        let inner = &v[1..v.len() - 1];
        if inner.trim().is_empty() {
            return json!([]);
        }
        let items: Vec<Value> = inner
            .split(',')
            .map(|x| x.trim().trim_matches('"').trim_matches('\''))
            .filter(|x| !x.is_empty())
            .map(|x| json!(x))
            .collect();
        return Value::Array(items);
    }
    json!(v.trim_matches('"').trim_matches('\''))
}

/// Parse frontmatter into an ordered list of `(key, value)` pairs.
pub fn parse_frontmatter(fm_text: &str) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    for line in fm_text.trim().split('\n') {
        if let Some((k, v)) = line.split_once(':') {
            out.push((k.trim().to_string(), parse_fm_value(v)));
        }
    }
    out
}

/// Render a note to `(html, tags, frontmatter)`. Vault-relative images are not
/// resolved here (no file lookup); see [`render_markdown_ctx`].
pub fn render_markdown(
    text: &str,
    resolve: &dyn Fn(&str) -> Option<String>,
) -> (String, Vec<String>, Value) {
    let ctx = RenderCtx {
        note: resolve,
        file: &|_, _| None,
        note_dir: "",
    };
    render_markdown_ctx(text, &ctx)
}

/// Render a note to `(html, tags, frontmatter)` with the full resolver set.
pub fn render_markdown_ctx(text: &str, ctx: &RenderCtx) -> (String, Vec<String>, Value) {
    let (fm_text, mut body) = split_frontmatter(text);
    let mut fm = Map::new();
    for (k, v) in parse_frontmatter(&fm_text) {
        fm.insert(k, v);
    }
    if text.starts_with("---") {
        // split_frontmatter already drops the head; make sure the body does not
        // start with the trailing '---' delimiter.
        body = body.trim_start_matches(['\r', '\n']).to_string();
    }

    let tags = body_and_fm_tags(&body, &fm);
    let html = render_body(&body, ctx);
    (html, tags, Value::Object(fm))
}

/// Inline `#tags` of `body`, then the frontmatter `tags` list, without
/// duplicates (ignoring case; the first spelling stays).
fn body_and_fm_tags(body: &str, fm: &Map<String, Value>) -> Vec<String> {
    let mut tags = inline_tags(body);
    for t in fm_tag_values(fm) {
        let t = t.trim_start_matches('#').trim();
        if !t.is_empty() {
            tags.push(t.to_string());
        }
    }
    let mut seen = HashSet::new();
    tags.retain(|t| seen.insert(t.to_lowercase()));
    tags
}

/// Inline `#tags` of a note body in first-seen order, without duplicates
/// (ignoring case; the first spelling stays). See [`inline_tag_spans`] for
/// what counts as a tag.
pub fn inline_tags(body: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    inline_tag_spans(body)
        .into_iter()
        .map(|r| body[r].to_string())
        .filter(|t| seen.insert(t.to_lowercase()))
        .collect()
}

/// Byte ranges of the names (after the `#`) of every inline `#tag` in `body`,
/// in order, repeats included. The one tag scanner behind note tags, the
/// search cache and tag renames.
///
/// A tag is `#` + a letter/digit/`_` + letters, digits, `_`, `-`, `/` (a
/// trailing `/` is not part of it). The `#` must start a line or follow a
/// space or punctuation such as `(` `,` `*` `"`; it never counts after a
/// letter, digit or one of `_ / \ # & = + @ . - : ) ] } % $ ^`. `# Heading`
/// is no tag. Nothing inside fenced code blocks (```` ``` ```` / `~~~`), inline
/// code spans, markdown link targets, `<autolinks>`, bare URLs or
/// `[[wikilinks]]` counts, so `[[Note#Heading]]` and `https://x.y/#frag` give
/// no tag.
pub fn inline_tag_spans(body: &str) -> Vec<std::ops::Range<usize>> {
    let masked = tag_scan_mask(body);
    let mut out = Vec::new();
    for c in re_tag().captures_iter(&masked) {
        let (whole, name) = (c.get(0).unwrap(), c.get(1).unwrap());
        if let Some(p) = masked[..whole.start()].chars().next_back() {
            let blocked = p.is_alphanumeric()
                || matches!(
                    p,
                    '_' | '/'
                        | '\\'
                        | '#'
                        | '&'
                        | '='
                        | '+'
                        | '@'
                        | '.'
                        | '-'
                        | ':'
                        | ')'
                        | ']'
                        | '}'
                        | '%'
                        | '$'
                        | '^'
                        | '`'
                );
            if blocked {
                continue;
            }
        }
        let end = name.start() + name.as_str().trim_end_matches('/').len();
        // Like Obsidian, a tag needs at least one non-digit: `PR #2` or `#2026` is not a tag.
        if masked[name.start()..end]
            .chars()
            .all(|ch| ch.is_ascii_digit() || ch == '/')
        {
            continue;
        }
        out.push(name.start()..end);
    }
    out
}

/// `text` with every place that cannot hold an inline tag blanked to spaces
/// (newlines kept, same byte length, so offsets match `text`): fenced code
/// blocks, inline code spans, then link targets, autolinks, bare URLs and
/// wikilinks.
fn tag_scan_mask(text: &str) -> String {
    fn blank(b: &mut [u8], ranges: &[std::ops::Range<usize>]) {
        for r in ranges {
            for x in &mut b[r.clone()] {
                if *x != b'\n' {
                    *x = b' ';
                }
            }
        }
    }
    let mut b = text.as_bytes().to_vec();
    blank(&mut b, &fence_ranges(text));
    let spans = code_span_ranges(&b);
    blank(&mut b, &spans);
    // Every blanked range starts and ends on an ASCII byte or a line edge, so
    // the bytes stay valid UTF-8.
    let s = String::from_utf8(b).unwrap_or_else(|_| text.to_string());
    let links = static_re!(
        r"(?i)\]\([^)\n]*\)|<[a-z][a-z0-9+.-]{1,31}:[^\s<>]*>|<[^\s<>@]+@[^\s<>]+>|\b[a-z][a-z0-9+.-]*://[^\s<>]*|\bwww\.[^\s<>]*|\b(?:mailto|tel):[^\s<>]*|!?\[\[[^\]\n]*\]\]"
    );
    let ranges: Vec<_> = links.find_iter(&s).map(|m| m.range()).collect();
    let mut b = s.into_bytes();
    blank(&mut b, &ranges);
    String::from_utf8(b).unwrap_or_else(|_| text.to_string())
}

/// Byte ranges of fenced code blocks (```` ``` ```` or `~~~`, three or more,
/// also inside lists and blockquotes), fences included. An unclosed fence runs
/// to the end of the text.
fn fence_ranges(text: &str) -> Vec<std::ops::Range<usize>> {
    let mut out = Vec::new();
    let mut open: Option<(u8, usize, usize)> = None; // (fence char, length, start)
    let mut pos = 0;
    for line in text.split_inclusive('\n') {
        let start = pos;
        pos += line.len();
        let t = line.trim_start_matches([' ', '\t', '>']);
        let ch = t.bytes().next();
        let run = match ch {
            Some(c @ (b'`' | b'~')) => t.bytes().take_while(|&x| x == c).count(),
            _ => 0,
        };
        match open {
            None if run >= 3 => {
                let c = ch.unwrap_or(b'`');
                // A backtick fence's info string holds no backtick.
                if c == b'~' || !t[run..].contains('`') {
                    open = Some((c, run, start));
                }
            }
            Some((c, n, s)) if ch == Some(c) && run >= n && t[run..].trim().is_empty() => {
                out.push(s..pos);
                open = None;
            }
            _ => {}
        }
    }
    if let Some((_, _, s)) = open {
        out.push(s..text.len());
    }
    out
}

/// Byte ranges of inline code spans: a run of N backticks up to the next run of
/// exactly N, not across a blank line. A run without a closer is literal text.
fn code_span_ranges(b: &[u8]) -> Vec<std::ops::Range<usize>> {
    let blank_line_after = |j: usize| {
        let mut k = j + 1;
        while k < b.len() && matches!(b[k], b' ' | b'\t' | b'\r') {
            k += 1;
        }
        k == b.len() || b[k] == b'\n'
    };
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'`' {
            i += 1;
            continue;
        }
        let start = i;
        while i < b.len() && b[i] == b'`' {
            i += 1;
        }
        let n = i - start;
        if start > 0 && b[start - 1] == b'\\' {
            continue;
        }
        let mut j = i;
        while j < b.len() {
            if b[j] == b'`' {
                let k = j;
                while j < b.len() && b[j] == b'`' {
                    j += 1;
                }
                if j - k == n {
                    out.push(start..j);
                    i = j;
                    break;
                }
                continue;
            }
            if b[j] == b'\n' && blank_line_after(j) {
                break;
            }
            j += 1;
        }
    }
    out
}

/// A note's tags exactly as [`render_markdown`] reports them (inline `#tags` plus
/// frontmatter `tags`), without rendering HTML.
pub fn note_tags(text: &str) -> Vec<String> {
    let (fm_text, mut body) = split_frontmatter(text);
    let mut fm = Map::new();
    for (k, v) in parse_frontmatter(&fm_text) {
        fm.insert(k, v);
    }
    if text.starts_with("---") {
        body = body.trim_start_matches(['\r', '\n']).to_string();
    }
    body_and_fm_tags(&body, &fm)
}

/// Resolvers the renderer needs to turn links and images into vault paths.
pub struct RenderCtx<'a> {
    /// Wikilink target -> vault-relative note path.
    pub note: &'a dyn Fn(&str) -> Option<String>,
    /// `(candidate, by_name)` -> vault-relative path of an existing image file.
    /// With `by_name == false` the candidate is an exact vault-relative path;
    /// with `true` it is a file name (or partial path) looked up anywhere in
    /// the vault, like an Obsidian `![[embed]]`.
    pub file: &'a dyn Fn(&str, bool) -> Option<String>,
    /// Folder of the note being rendered ("" for the vault root).
    pub note_dir: &'a str,
}

/// Why `/api/vault/file` refuses a path.
#[derive(Debug, PartialEq, Eq)]
pub enum VaultFileErr {
    /// Empty, control characters, backslashes or empty segments.
    Invalid,
    /// Absolute, `..`, hidden, or resolving outside the vault.
    Forbidden,
    /// Not an image extension.
    NotImage,
    NotFound,
}

/// Obsidian-style lookup of an embed target in a list of vault image paths:
/// an exact path, then a path suffix (`img/a.png`), then the bare file name,
/// all case-insensitive.
pub fn find_image_by_name(list: &[String], target: &str) -> Option<String> {
    let t = target.trim_start_matches('/').to_lowercase();
    let suffix = format!("/{t}");
    let name = t.rsplit('/').next().unwrap_or(&t).to_string();
    list.iter()
        .find(|p| p.to_lowercase() == t)
        .or_else(|| list.iter().find(|p| p.to_lowercase().ends_with(&suffix)))
        .or_else(|| {
            list.iter()
                .find(|p| p.rsplit('/').next().unwrap_or(p).to_lowercase() == name)
        })
        .cloned()
}

/// Image extensions the renderer embeds and `/api/vault/file` serves, with
/// their media type.
pub fn image_mime(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let (_, ext) = name.rsplit_once('.')?;
    Some(match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        // No SVG: it is a document that can carry script, not just pixels.
        _ => return None,
    })
}

/// Whether a URL's path (query and fragment ignored) names an image file.
fn url_is_image(url: &str) -> bool {
    let base = url.split(['#', '?']).next().unwrap_or(url);
    image_mime(base).is_some()
}

/// Escape a value for a double-quoted HTML attribute (or text).
fn attr(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&#39;"),
            c if c.is_control() => {}
            c => o.push(c),
        }
    }
    o
}

/// Undo the `&`, `<`, `>` escaping `inline_md` applies up front.
fn unesc(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Decode `%XX` escapes (no `+` handling: these are paths, not form data).
fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%'
            && i + 2 < b.len()
            && b[i + 1].is_ascii_hexdigit()
            && b[i + 2].is_ascii_hexdigit()
        {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("00");
            out.push(u8::from_str_radix(hex, 16).unwrap_or(0));
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Percent-encode a vault path for a query string (keeps `/` readable).
pub fn pct_encode_path(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for &c in s.as_bytes() {
        if c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.' | b'_' | b'~' | b'/') {
            o.push(c as char);
        } else {
            o.push_str(&format!("%{c:02X}"));
        }
    }
    o
}

/// Join `p` onto `base` (a vault folder) and normalise `.`/`..`; `None` when
/// the result would leave the vault. A leading `/` means the vault root.
fn normalize_rel(base: &str, p: &str) -> Option<String> {
    let p = p.replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    let joined;
    let full: &str = if let Some(rest) = p.strip_prefix('/') {
        rest
    } else if base.is_empty() {
        &p
    } else {
        joined = format!("{base}/{p}");
        &joined
    };
    for seg in full.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

/// Where an image's bytes come from, after the URL policy.
enum ImgSrc {
    /// Safe URL to put in `src` (http(s), allowed data: images, the vault endpoint).
    Url(String),
    /// A vault image that does not exist.
    Missing(String),
    /// A scheme or form that is never embedded.
    Blocked(String),
}

fn re_data_img() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(?i:data:image/(?:png|jpeg|jpg|gif|webp);base64,)[A-Za-z0-9+/=]+$").unwrap()
    })
}

fn re_scheme() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z][A-Za-z0-9+.\-]*:").unwrap())
}

/// Vault endpoint URL for a vault-relative image path.
pub fn vault_file_url(rel: &str) -> String {
    format!("/api/vault/file?path={}", pct_encode_path(rel))
}

/// Apply the URL policy to a raw image source: http(s) and small inline
/// raster `data:` images pass; vault paths resolve relative to the note's
/// folder, then the vault root (and, for embeds, by file name anywhere);
/// every other scheme is blocked.
fn image_src(raw: &str, ctx: &RenderCtx, by_name: bool) -> ImgSrc {
    let t = raw.trim();
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        if t.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return ImgSrc::Blocked(t.to_string());
        }
        // No user:password@host: images never carry credentials.
        let authority = t
            .split_once("://")
            .map_or("", |(_, r)| r.split(['/', '?', '#']).next().unwrap_or(""));
        if authority.contains('@') {
            return ImgSrc::Blocked(t.to_string());
        }
        // Pixels only, from anywhere: an .svg is a document, not an image.
        let path = t.split(['?', '#']).next().unwrap_or(t).to_ascii_lowercase();
        if path.ends_with(".svg") || path.ends_with(".svgz") {
            return ImgSrc::Blocked(t.to_string());
        }
        return ImgSrc::Url(t.to_string());
    }
    if lower.starts_with("data:") {
        let compact: String = t.chars().filter(|c| !c.is_whitespace()).collect();
        return if re_data_img().is_match(&compact) {
            ImgSrc::Url(compact)
        } else {
            ImgSrc::Blocked("data: URL".to_string())
        };
    }
    if t.starts_with("//") || re_scheme().is_match(t) {
        return ImgSrc::Blocked(t.to_string());
    }
    let path = pct_decode(t);
    if path.chars().any(|c| c.is_control()) || image_mime(&path).is_none() {
        return ImgSrc::Missing(path);
    }
    let mut cands: Vec<String> = Vec::new();
    if !path.starts_with('/') {
        if let Some(c) = normalize_rel(ctx.note_dir, &path) {
            cands.push(c);
        }
    }
    if let Some(c) = normalize_rel("", &path) {
        if !cands.contains(&c) {
            cands.push(c);
        }
    }
    for c in &cands {
        if let Some(rel) = (ctx.file)(c, false) {
            return ImgSrc::Url(vault_file_url(&rel));
        }
    }
    if by_name {
        if let Some(c) = normalize_rel("", &path) {
            if let Some(rel) = (ctx.file)(&c, true) {
                return ImgSrc::Url(vault_file_url(&rel));
            }
        }
    }
    ImgSrc::Missing(path)
}

/// `<img>` (inline) or `<figure>` (standalone) for a resolved source; a
/// placeholder span when the image is missing or blocked. All values are
/// raw (unescaped) and get attribute-escaped here.
fn image_html(
    src: ImgSrc,
    alt: &str,
    title: &str,
    size: Option<(u32, Option<u32>)>,
    figure: bool,
) -> String {
    if figure && !matches!(src, ImgSrc::Url(_)) {
        // A standalone placeholder still sits in its own paragraph.
        return format!("<p>{}</p>", image_html(src, alt, title, size, false));
    }
    let url = match src {
        ImgSrc::Url(u) => u,
        ImgSrc::Missing(name) => {
            return format!(
                r#"<span class="md-img-missing">image not found: {}</span>"#,
                attr(&name)
            )
        }
        ImgSrc::Blocked(name) => {
            return format!(
                r#"<span class="md-img-missing">image blocked: {}</span>"#,
                attr(&name)
            )
        }
    };
    let mut extra = String::new();
    if !title.is_empty() {
        extra.push_str(&format!(r#" title="{}""#, attr(title)));
    }
    if let Some((w, h)) = size {
        extra.push_str(&format!(r#" width="{w}""#));
        if let Some(h) = h {
            extra.push_str(&format!(r#" height="{h}""#));
        }
    }
    let img = |class: &str| {
        format!(
            r#"<img{class} loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="{}" src="{}"{extra}>"#,
            attr(alt),
            attr(&url)
        )
    };
    if figure {
        let cap = if alt.trim().is_empty() {
            String::new()
        } else {
            format!("<figcaption>{}</figcaption>", attr(alt))
        };
        format!(r#"<figure class="md-img">{}{cap}</figure>"#, img(""))
    } else {
        img(r#" class="md-img-i""#)
    }
}

/// `![[target|300]]` / `![[target|300x200]]` / `![[target|alt]]` (escaped text).
fn re_embed() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r"!\[\[([^\]|]+?)\\?(?:\|([^\]]*))?\]\]").unwrap())
}

/// `![alt](src "title")`, `![alt](&lt;path with spaces&gt;)`, `![alt](a b.png)`
/// on `&<>`-escaped text.
fn re_md_image() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"!\[([^\]]*)\]\(\s*(?:&lt;([^)]*?)&gt;|([^)]*?))(?:\s+"([^"]*)")?\s*\)"#)
            .unwrap()
    })
}

fn re_bare_image_url() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^https?://\S+$").unwrap())
}

/// HTML for an Obsidian embed capture, or `None` when the target is not an image
/// (then it stays a wikilink).
fn embed_html(c: &regex::Captures, ctx: &RenderCtx, figure: bool) -> Option<String> {
    let target = unesc(c.get(1).map(|m| m.as_str()).unwrap_or("").trim());
    if !url_is_image(&target) {
        return None;
    }
    let opt = unesc(c.get(2).map(|m| m.as_str()).unwrap_or("").trim());
    let size_re = static_re!(r"^(\d{1,4})(?:x(\d{1,4}))?$");
    let (size, alt) = match size_re.captures(&opt) {
        Some(s) => (
            Some((
                s[1].parse().unwrap_or(0),
                s.get(2).and_then(|m| m.as_str().parse().ok()),
            )),
            String::new(),
        ),
        None => (None, opt),
    };
    let src = image_src(&target, ctx, true);
    Some(image_html(src, &alt, "", size, figure))
}

fn md_image_html(c: &regex::Captures, ctx: &RenderCtx, figure: bool) -> String {
    let alt = unesc(c.get(1).map(|m| m.as_str()).unwrap_or(""));
    let raw = c
        .get(2)
        .or_else(|| c.get(3))
        .map(|m| unesc(m.as_str()))
        .unwrap_or_default();
    let title = unesc(c.get(4).map(|m| m.as_str()).unwrap_or(""));
    if raw.trim().is_empty() {
        return image_html(ImgSrc::Missing(String::new()), &alt, "", None, figure);
    }
    image_html(image_src(&raw, ctx, false), &alt, &title, None, figure)
}

/// Escape `&`, `<`, `>` (quotes are left alone; attribute values are escaped
/// separately where they are built) and drop NULs, which mark placeholders.
fn esc_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\u{0}' => {}
            c => out.push(c),
        }
    }
    out
}

/// A paragraph line that is exactly one image (`![..](..)`, `![[x.png]]` or a
/// bare image URL) renders as a `<figure>` with a caption.
fn standalone_image(line: &str, ctx: &RenderCtx) -> Option<String> {
    let s = esc_text(line.trim());
    let whole = |m: regex::Match| m.start() == 0 && m.end() == s.len();
    if let Some(c) = re_embed().captures(&s) {
        if whole(c.get(0).unwrap()) {
            return embed_html(&c, ctx, true);
        }
    }
    if let Some(c) = re_md_image().captures(&s) {
        if whole(c.get(0).unwrap()) {
            return Some(md_image_html(&c, ctx, true));
        }
    }
    let raw = line.trim();
    if re_bare_image_url().is_match(raw) && url_is_image(raw) {
        return Some(image_html(image_src(raw, ctx, false), "", "", None, true));
    }
    None
}

fn inline_md(s: &str, ctx: &RenderCtx) -> String {
    let resolve = ctx.note;
    let mut out = esc_text(s);

    // Protect inline code spans from further inline processing.
    let code_re = static_re!(r"`([^`]+)`");
    let mut codes: Vec<String> = Vec::new();
    out = code_re
        .replace_all(&out, |c: &regex::Captures| {
            codes.push(c.get(1).unwrap().as_str().to_string());
            format!("\u{0}C{}\u{0}", codes.len() - 1)
        })
        .to_string();
    // Code placeholders inside an attribute value turn back into their text.
    let code_ph = static_re!("\u{0}C(\\d+)\u{0}");
    let detok = |t: &str| -> String {
        code_ph
            .replace_all(t, |c: &regex::Captures| {
                let i: usize = c[1].parse().unwrap_or(0);
                format!("`{}`", codes.get(i).cloned().unwrap_or_default())
            })
            .into_owned()
    };

    // Finished HTML fragments (images, link tags) are parked behind
    // placeholders so the later passes (wikilinks, emphasis) never touch
    // their attribute values.
    let mut frags: Vec<String> = Vec::new();
    let park = |frags: &mut Vec<String>, h: String| {
        frags.push(h);
        format!("\u{0}H{}\u{0}", frags.len() - 1)
    };

    out = re_embed()
        .replace_all(&out, |c: &regex::Captures| {
            let detoked = detok(c.get(0).unwrap().as_str());
            // A code span restored inside the target (`![[a`]`b]]`) can stop the
            // text from matching again: leave it as written rather than panic.
            match re_embed()
                .captures(&detoked)
                .and_then(|c2| embed_html(&c2, ctx, false))
            {
                Some(h) => park(&mut frags, h),
                None => c.get(0).unwrap().as_str().to_string(),
            }
        })
        .to_string();

    out = re_md_image()
        .replace_all(&out, |c: &regex::Captures| {
            let detoked = detok(c.get(0).unwrap().as_str());
            match re_md_image().captures(&detoked) {
                Some(c2) => {
                    let h = md_image_html(&c2, ctx, false);
                    park(&mut frags, h)
                }
                None => c.get(0).unwrap().as_str().to_string(),
            }
        })
        .to_string();

    let link_re = static_re!(r"\[([^\]]+)\]\((https?://[^)\s]+)[^)]*\)");
    out = link_re
        .replace_all(&out, |c: &regex::Captures| {
            let href = unesc(&detok(&c[2]));
            let open = park(
                &mut frags,
                format!(
                    r#"<a href="{}" target="_blank" rel="noopener noreferrer">"#,
                    attr(&href)
                ),
            );
            let mut h = format!("{open}{}</a>", &c[1]);
            if url_is_image(&href) {
                let img = image_html(ImgSrc::Url(href.clone()), "", "", None, false).replacen(
                    r#"class="md-img-i""#,
                    r#"class="md-img-i md-img-link""#,
                    1,
                );
                h.push_str(&park(&mut frags, img));
            }
            h
        })
        .to_string();

    out = re_wikilink()
        .replace_all(&out, |c: &regex::Captures| {
            let target = c.get(1).map(|m| m.as_str()).unwrap_or("");
            let display = c
                .get(2)
                .map(|m| m.as_str().to_string())
                .unwrap_or_else(|| target.rsplit('/').next().unwrap_or(target).to_string());
            let open = match resolve(target) {
                Some(p) => format!(r#"<a class="wl" data-path="{}">"#, attr(&p)),
                None => r#"<a class="wl broken" >"#.to_string(),
            };
            format!("{}{display}</a>", park(&mut frags, open))
        })
        .to_string();

    let bold = static_re!(r"\*\*([^*]+)\*\*");
    out = bold.replace_all(&out, "<strong>$1</strong>").to_string();
    let del = static_re!(r"~~([^~]+)~~");
    out = del.replace_all(&out, "<del>$1</del>").to_string();
    out = emphasize(&out);

    let frag_ph = static_re!("\u{0}H(\\d+)\u{0}");
    out = frag_ph
        .replace_all(&out, |c: &regex::Captures| {
            let i: usize = c[1].parse().unwrap_or(0);
            frags.get(i).cloned().unwrap_or_default()
        })
        .to_string();

    out = code_ph
        .replace_all(&out, |c: &regex::Captures| {
            let i: usize = c[1].parse().unwrap_or(0);
            let raw = codes.get(i).cloned().unwrap_or_default();
            // Already `&<>`-escaped when the span was captured.
            format!("<code>{raw}</code>")
        })
        .to_string();
    out
}

/// Emit `<em>...</em>` for single-asterisk emphasis.
///
/// Implemented as a manual scan because Rust's regex crate has no look-around,
/// so the `(?<![\*\w])\*(?!\*)([^*\n]+?)\*(?!\*)` pattern cannot be expressed directly.
fn emphasize(s: &str) -> String {
    let b: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == '*' {
            let prev_ok =
                i == 0 || (!b[i - 1].is_alphanumeric() && b[i - 1] != '_' && b[i - 1] != '*');
            let next_ok = i + 1 < b.len() && b[i + 1] != '*';
            if prev_ok && next_ok {
                // Find the closing '*': not followed by '*', with no '*' or
                // newline in between.
                let mut j = i + 1;
                let mut ok = false;
                while j < b.len() && b[j] != '\n' {
                    if b[j] == '*' {
                        if j + 1 >= b.len() || b[j + 1] != '*' {
                            ok = true;
                        }
                        break;
                    }
                    j += 1;
                }
                if ok && j > i + 1 {
                    out.push_str("<em>");
                    out.extend(&b[i + 1..j]);
                    out.push_str("</em>");
                    i = j + 1;
                    continue;
                }
            }
        }
        out.push(b[i]);
        i += 1;
    }
    out
}

/// Split a table row into trimmed cells. A `|` separates cells except inside
/// a `[[wikilink]]` (its alias), inside a `code span`, or escaped as `\|`
/// (the escape is dropped), as in Obsidian and GitHub tables.
fn table_cells(line: &str) -> Vec<String> {
    let t = line.trim();
    let t = t.strip_prefix('|').unwrap_or(t);
    let t = if t.ends_with('|') && !t.ends_with("\\|") {
        &t[..t.len() - 1]
    } else {
        t
    };
    let b = t.as_bytes();
    let mut cells = Vec::new();
    let mut cur = String::new();
    let (mut link, mut code) = (0usize, false);
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'\\' && b.get(i + 1) == Some(&b'|') {
            cur.push('|');
            i += 2;
            continue;
        }
        if c == b'`' {
            code = !code;
        } else if !code && c == b'[' && b.get(i + 1) == Some(&b'[') {
            link += 1;
            cur.push_str("[[");
            i += 2;
            continue;
        } else if !code && link > 0 && c == b']' && b.get(i + 1) == Some(&b']') {
            link -= 1;
            cur.push_str("]]");
            i += 2;
            continue;
        } else if c == b'|' && link == 0 && !code {
            cells.push(cur.trim().to_string());
            cur.clear();
            i += 1;
            continue;
        }
        // Copy the whole UTF-8 character.
        let w = t[i..].chars().next().map_or(1, char::len_utf8);
        cur.push_str(&t[i..i + w]);
        i += w;
    }
    cells.push(cur.trim().to_string());
    cells
}

/// Give a body row exactly `width` cells: short rows get empty cells, extra
/// cells are joined into the last one so no text is lost.
fn fit_row(mut row: Vec<String>, width: usize) -> Vec<String> {
    if width == 0 {
        return row;
    }
    if row.len() > width {
        let rest = row.split_off(width - 1).join(" | ");
        row.push(rest);
    }
    row.resize(width, String::new());
    row
}

fn render_body(text: &str, ctx: &RenderCtx) -> String {
    let table_sep = static_re!(r"^\s*\|?[\s:]*-{2,}[\s:|-]*\|?\s*$");
    let list_re = static_re!(r"^(\s*)([-*+]|\d+[.)])\s+(.+)$");
    let head_re = static_re!(r"^(#{1,6})\s+(.+)$");
    let hr_re = static_re!(r"^\s*((-\s*){3,}|(\*\s*){3,}|(_\s*){3,})$");

    let lines: Vec<&str> = text.split('\n').collect();
    let n = lines.len();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    let inl = |s: &str| inline_md(s, ctx);

    while i < n {
        let line = lines[i];
        let s = line.trim();

        if s.starts_with("```") || s.starts_with("~~~") {
            let fence = &s[..3];
            let mut buf: Vec<&str> = Vec::new();
            i += 1;
            while i < n && !lines[i].trim().starts_with(fence) {
                buf.push(lines[i]);
                i += 1;
            }
            i += 1;
            let joined = buf.join("\n");
            let esc = joined
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            out.push(format!("<pre><code>{esc}</code></pre>"));
            continue;
        }

        if line.contains('|') && i + 1 < n && table_sep.is_match(lines[i + 1]) {
            let header = table_cells(s);
            i += 2;
            let mut rows: Vec<Vec<String>> = Vec::new();
            while i < n && lines[i].contains('|') && !lines[i].trim().is_empty() {
                rows.push(fit_row(table_cells(lines[i]), header.len()));
                i += 1;
            }
            let th: String = header
                .iter()
                .map(|h| format!("<th>{}</th>", inl(h)))
                .collect();
            let body: String = rows
                .iter()
                .map(|r| {
                    format!(
                        "<tr>{}</tr>",
                        r.iter()
                            .map(|c| format!("<td>{}</td>", inl(c)))
                            .collect::<String>()
                    )
                })
                .collect();
            out.push(format!(
                r#"<div class="table-wrap"><table><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>"#
            ));
            continue;
        }

        if s.starts_with('>') {
            let mut buf: Vec<String> = Vec::new();
            while i < n && lines[i].trim().starts_with('>') {
                buf.push(lines[i].trim()[1..].trim().to_string());
                i += 1;
            }
            out.push(format!("<blockquote>{}</blockquote>", inl(&buf.join(" "))));
            continue;
        }

        if hr_re.is_match(s) {
            out.push("<hr>".to_string());
            i += 1;
            continue;
        }

        if let Some(hm) = head_re.captures(s) {
            let lvl = hm[1].len();
            out.push(format!("<h{lvl}>{}</h{lvl}>", inl(&hm[2])));
            i += 1;
            continue;
        }

        if let Some(lm) = list_re.captures(line) {
            let ordered = lm[2]
                .chars()
                .next()
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false);
            let ltype = if ordered { "ol" } else { "ul" };
            let mut items: Vec<String> = Vec::new();
            while i < n {
                match list_re.captures(lines[i]) {
                    None => break,
                    Some(m) => {
                        let o2 = m[2]
                            .chars()
                            .next()
                            .map(|c| c.is_ascii_digit())
                            .unwrap_or(false);
                        if (if o2 { "ol" } else { "ul" }) != ltype {
                            break;
                        }
                        items.push(format!("<li>{}</li>", inl(&m[3])));
                        i += 1;
                    }
                }
            }
            out.push(format!("<{ltype}>{}</{ltype}>", items.join("")));
            continue;
        }

        if s.is_empty() {
            i += 1;
            continue;
        }

        if let Some(fig) = standalone_image(s, ctx) {
            // Two or more images in a row (blank lines between are fine)
            // become one gallery.
            let mut figs = vec![fig];
            let mut j = i + 1;
            loop {
                let mut k = j;
                while k < n && lines[k].trim().is_empty() {
                    k += 1;
                }
                match (k < n)
                    .then(|| standalone_image(lines[k].trim(), ctx))
                    .flatten()
                {
                    Some(f) if f.starts_with("<figure") => {
                        figs.push(f);
                        j = k + 1;
                    }
                    _ => break,
                }
            }
            let shown = figs.iter().filter(|f| f.starts_with("<figure")).count();
            if shown >= 2 {
                out.push(format!(
                    r#"<div class="md-gallery" data-n="{shown}">{}</div>"#,
                    figs.join("")
                ));
                i = j;
                continue;
            }
            out.push(figs.remove(0));
        } else {
            out.push(format!("<p>{}</p>", inl(s)));
        }
        i += 1;
    }
    out.join("\n")
}

/// Refuse a regex replacement naming a group the pattern does not define (the
/// regex crate would expand it to nothing). `$$` is a literal `$`; `$1a` names
/// the group `1a`, so `${1}a` is needed there.
/// Largest note a replacement (`bulk_replace`, patch `replace`, template
/// variables) may produce, and the most all edits of one `bulk_replace` may
/// hold in memory together. Without a bound, a one-character `find` with a
/// long replacement multiplies across every match and runs the server out of
/// memory (which aborts the process).
pub const MAX_REPLACED_NOTE: usize = 16 * 1024 * 1024;
const MAX_REPLACED_TOTAL: usize = 256 * 1024 * 1024;

/// Length of `text` with every `find` replaced by `with`, without building it.
fn literal_replaced_len(text: &str, find: &str, with: &str) -> usize {
    let n = text.matches(find).count();
    (text.len() - n * find.len()).saturating_add(n.saturating_mul(with.len()))
}

/// An upper bound on the length of `text` after `pat.replace_all(text, with)`:
/// each match becomes at most the template plus, per `$` reference, the match.
fn regex_replaced_len_bound(pat: &Regex, text: &str, with: &str) -> usize {
    let refs = with.bytes().filter(|&b| b == b'$').count();
    let mut len = text.len();
    for m in pat.find_iter(text) {
        len = len
            .saturating_sub(m.len())
            .saturating_add(with.len())
            .saturating_add(refs.saturating_mul(m.len()));
        if len > MAX_REPLACED_NOTE {
            break;
        }
    }
    len
}

/// Refuse a replacement whose result would pass [`MAX_REPLACED_NOTE`].
fn replaced_size_ok(len: usize, rel: &str) -> MResult<()> {
    if len > MAX_REPLACED_NOTE {
        return err(format!(
            "the replacement would make {rel} larger than {} MiB; use a shorter replacement or a narrower find",
            MAX_REPLACED_NOTE / (1024 * 1024)
        ));
    }
    Ok(())
}

fn replace_groups_ok(pat: &Regex, replace: &str) -> MResult<()> {
    let names: HashSet<&str> = pat.capture_names().flatten().collect();
    let groups = pat.captures_len();
    let b = replace.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'$' {
            i += 1;
            continue;
        }
        if b.get(i + 1) == Some(&b'$') {
            i += 2;
            continue;
        }
        let (name, next) = if b.get(i + 1) == Some(&b'{') {
            match replace[i + 2..].find('}') {
                Some(end) => (&replace[i + 2..i + 2 + end], i + 3 + end),
                None => (&replace[0..0], i + 1),
            }
        } else {
            let mut j = i + 1;
            while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
                j += 1;
            }
            (&replace[i + 1..j], j)
        };
        let known = match name.parse::<usize>() {
            Ok(n) => n < groups,
            Err(_) => name.is_empty() || names.contains(name),
        };
        if !known {
            let mut have = if groups > 1 {
                format!("$0-${}", groups - 1)
            } else {
                "only $0".to_string()
            };
            if !names.is_empty() {
                let mut ns: Vec<&str> = names.iter().copied().collect();
                ns.sort_unstable();
                have.push_str(&format!(" and names {}", ns.join(", ")));
            }
            return err(format!(
                "replace refers to group `{name}`, which find does not define (it has {have}); \
                 write ${{1}} when letters or digits follow a group, and $$ for a literal $"
            ));
        }
        i = next;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Wikilink resolution and rewriting
// ---------------------------------------------------------------------------

/// The note among `rels` (vault-relative `.md` paths) that `[[target]]`, written in
/// a note of folder `from_dir`, points at (see [`MemoryStore::resolve_wikilink_from`]).
fn pick_wikilink<I, S>(rels: I, target: &str, from_dir: &str) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let t = target.trim().trim_start_matches('/');
    let t = t.strip_suffix(".md").unwrap_or(t).to_lowercase();
    let name = t.rsplit('/').next().unwrap_or(&t).to_string();
    let qualified = t.contains('/');
    let suffix = format!("/{t}");
    let mut best: Option<(u8, usize, String)> = None;
    for rel in rels {
        let rel = rel.as_ref();
        let low = rel.to_lowercase();
        let stem = low.strip_suffix(".md").unwrap_or(&low);
        if stem.rsplit('/').next().unwrap_or(stem) != name {
            continue;
        }
        let rank = if qualified {
            if stem == t {
                0
            } else if stem.ends_with(&suffix) {
                1
            } else {
                continue;
            }
        } else {
            let dir = rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
            if dir.eq_ignore_ascii_case(from_dir) {
                0
            } else {
                2
            }
        };
        let cand = (rank, rel.matches('/').count(), rel.to_string());
        if best.as_ref().is_none_or(|b| cand < *b) {
            best = Some(cand);
        }
    }
    best.map(|b| b.2)
}

/// Note paths grouped by lowercase name, to resolve many wikilinks quickly.
struct LinkIndex(HashMap<String, Vec<String>>);

impl LinkIndex {
    fn new<I: IntoIterator<Item = String>>(rels: I) -> Self {
        let mut m: HashMap<String, Vec<String>> = HashMap::new();
        for rel in rels {
            let low = rel.to_lowercase();
            let stem = low.strip_suffix(".md").unwrap_or(&low);
            let name = stem.rsplit('/').next().unwrap_or(stem).to_string();
            m.entry(name).or_default().push(rel);
        }
        Self(m)
    }

    fn resolve(&self, target: &str, from_dir: &str) -> Option<String> {
        let t = target.trim().trim_start_matches('/');
        let t = t.strip_suffix(".md").unwrap_or(t).to_lowercase();
        let name = t.rsplit('/').next().unwrap_or(&t);
        pick_wikilink(self.0.get(name)?, target, from_dir)
    }
}

/// `content` with the target of every wikilink replaced by what `f` returns for it
/// (`None` keeps it); aliases, `\|` escapes and brackets stay as they are. Links in
/// `{{...}}` placeholders and code spans are skipped, as
/// [`MemoryStore::link_targets`] skips them. `None` when nothing changed.
fn rewrite_links_in(content: &str, mut f: impl FnMut(&str) -> Option<String>) -> Option<String> {
    let blank = |s: &str, re: &Regex| {
        let mut out = s.to_string();
        for m in re.find_iter(s) {
            out.replace_range(m.range(), &" ".repeat(m.len()));
        }
        out
    };
    let masked = blank(content, crate::re_placeholder());
    let masked = blank(&masked, crate::re_code_span());
    let mut out = String::with_capacity(content.len());
    let mut last = 0;
    for cap in re_wikilink().captures_iter(&masked) {
        let Some(m) = cap.get(1) else { continue };
        // Part of the link was masked: it is not a link `link_targets` sees.
        if content[m.range()] != masked[m.range()] {
            continue;
        }
        if let Some(new) = f(m.as_str()) {
            out.push_str(&content[last..m.start()]);
            out.push_str(&new);
            last = m.end();
        }
    }
    if last == 0 {
        return None;
    }
    out.push_str(&content[last..]);
    Some(out)
}

/// The new target text for wikilink target `raw` (written in a note that was in
/// folder `old_dir` and is now in `new_dir`) after the notes in `moves` (old path ->
/// new path) moved, or `None` when it still names the note it named before. A link
/// keeps its form where it can: a bare name stays bare (renamed when its note was)
/// unless that would name another note; otherwise it becomes the full path. `#heading`
/// and a written `.md` are kept.
fn relinked_target(
    raw: &str,
    old: &LinkIndex,
    new: &LinkIndex,
    moves: &HashMap<String, String>,
    old_dir: &str,
    new_dir: &str,
) -> Option<String> {
    let (target, anchor) = match raw.find('#') {
        Some(i) => raw.split_at(i),
        None => (raw, ""),
    };
    let target = target.trim();
    if target.is_empty() || image_mime(target).is_some() {
        return None;
    }
    let was = old.resolve(target, old_dir)?;
    let want = moves.get(&was).cloned().unwrap_or(was);
    if new.resolve(target, new_dir).as_deref() == Some(want.as_str()) {
        return None;
    }
    let stem = want.strip_suffix(".md").unwrap_or(&want);
    let base = stem.rsplit('/').next().unwrap_or(stem);
    let bare_ok = !target.trim_start_matches('/').contains('/')
        && new.resolve(base, new_dir).as_deref() == Some(want.as_str());
    let mut out = if bare_ok { base } else { stem }.to_string();
    if target.to_lowercase().ends_with(".md") {
        out.push_str(".md");
    }
    out.push_str(anchor);
    Some(out)
}

// ---------------------------------------------------------------------------
// Path resolution (a resolved path may never escape the vault)
// ---------------------------------------------------------------------------

impl MemoryStore {
    pub fn resolve(&self, rel_path: &str) -> MResult<PathBuf> {
        if rel_path.chars().any(|c| c.is_control()) {
            return err(format!("invalid path: {rel_path:?}"));
        }
        let clean = rel_path.replace('\\', "/");
        let clean = clean.trim_start_matches('/');
        // `C:x` / `C:/x` would replace the vault root when joined on Windows.
        if is_absolute_input(clean) {
            return err(format!("path escapes the vault: {rel_path}"));
        }
        for (i, seg) in clean.split('/').enumerate() {
            if seg == ".." {
                return err(format!("path escapes the vault: {rel_path}"));
            }
            if cfg!(windows) && windows_unsafe_segment(seg) {
                return err(format!("path not allowed: {rel_path}"));
            }
            // Hidden entries are the store's own files (.locks.json,
            // .events.jsonl, .git ...); only the trash folder is addressable.
            if seg.starts_with('.') && seg != "." && !(i == 0 && seg == ".Trash") {
                return err(format!("path not allowed: {rel_path}"));
            }
        }
        // A path hidden from the caller answers exactly like a missing one.
        if !self.visible(clean) {
            return err(format!("not found: {rel_path}"));
        }
        let full = self.root().join(clean);
        // A symlink inside the vault must not lead outside it: check the
        // nearest existing ancestor (the file itself when it exists).
        if let Ok(root) = fs::canonicalize(self.root()) {
            let mut probe = full.as_path();
            loop {
                // `symlink_metadata`, not `exists`: a dangling symlink must be
                // checked too (writing through it would create its target).
                if fs::symlink_metadata(probe).is_ok() {
                    match fs::canonicalize(probe) {
                        Ok(real) if real.starts_with(&root) => {
                            let tail = full.strip_prefix(probe).unwrap_or(Path::new(""));
                            let real_rel = real
                                .join(tail)
                                .strip_prefix(&root)
                                .map(|p| p.to_string_lossy().replace('\\', "/"))
                                .unwrap_or_default();
                            // The real path obeys the same rule as the typed one: a
                            // symlink, or a Windows short name (`GIT~1` for `.git`),
                            // must not reach the store's own dot files.
                            if reserved_real_path(&real_rel) {
                                return err(format!("path not allowed: {rel_path}"));
                            }
                            // Nor may it lead a restricted caller into a hidden path.
                            if self.restricted() && !self.visible(&real_rel) {
                                return err(format!("not found: {rel_path}"));
                            }
                            break;
                        }
                        _ => return err(format!("path escapes the vault: {rel_path}")),
                    }
                }
                match probe.parent() {
                    Some(p) => probe = p,
                    None => break,
                }
            }
        } else {
            // Without the real root nothing can be checked for symlinks.
            return err(format!("not found: {rel_path}"));
        }
        Ok(full)
    }

    /// [`Self::resolve`] for a path about to be created: an existing target hidden
    /// from the caller answers "already exists" (as a visible one does) rather than
    /// "not found", which would wrongly suggest that creating it can succeed.
    fn resolve_new(&self, rel_path: &str) -> MResult<PathBuf> {
        self.resolve(rel_path).or_else(|e| {
            let clean = rel_path.replace('\\', "/");
            let clean = clean.trim_start_matches('/');
            let plain = !clean
                .split('/')
                .any(|seg| seg == ".." || seg.starts_with('.'));
            if plain
                && !self.visible(clean)
                && fs::symlink_metadata(self.root().join(clean)).is_ok()
            {
                return err(format!("already exists: {rel_path}"));
            }
            Err(e)
        })
    }

    pub fn rel_of(&self, full: &Path) -> String {
        full.strip_prefix(self.root())
            .unwrap_or(full)
            .to_string_lossy()
            .replace('\\', "/")
    }

    pub fn read_raw(&self, p: &Path) -> Option<String> {
        fs::read_to_string(p).ok()
    }

    /// Resolve a wikilink target: a bare name (no folder, no `.md`) -> rel path.
    pub fn resolve_wikilink(&self, target: &str) -> Option<String> {
        self.resolve_wikilink_from(target, "")
    }

    /// The note a `[[target]]` written in a note of folder `from_dir` points
    /// at. Several notes can share a name in different folders, so the choice
    /// is deterministic: a path-qualified target (`[[Projects/Plan]]`) must
    /// match that path (or end with it); a bare name prefers the linking
    /// note's own folder, then the shallowest path, then alphabetical order.
    pub fn resolve_wikilink_from(&self, target: &str, from_dir: &str) -> Option<String> {
        pick_wikilink(
            self.walk().into_iter().map(|(rel, _, _)| rel),
            target,
            from_dir,
        )
    }

    /// Full path of a vault image for a vault-relative path, for the file
    /// endpoint and the renderer. Rejects absolute paths, `..`, hidden
    /// segments and non-image extensions, and anything whose canonical path
    /// (symlinks followed) is outside the canonical vault root.
    pub fn vault_image_file(&self, rel: &str) -> Result<PathBuf, VaultFileErr> {
        if rel.is_empty() || rel.chars().any(|c| c.is_control()) || rel.contains('\\') {
            return Err(VaultFileErr::Invalid);
        }
        if rel.starts_with('/') {
            return Err(VaultFileErr::Forbidden);
        }
        for seg in rel.split('/') {
            if seg.is_empty() {
                return Err(VaultFileErr::Invalid);
            }
            if seg.starts_with('.') {
                return Err(VaultFileErr::Forbidden);
            }
        }
        if image_mime(rel).is_none() {
            return Err(VaultFileErr::NotImage);
        }
        if !self.visible(rel) {
            return Err(VaultFileErr::NotFound);
        }
        let root = fs::canonicalize(self.root()).map_err(|_| VaultFileErr::NotFound)?;
        let full = fs::canonicalize(root.join(rel)).map_err(|_| VaultFileErr::NotFound)?;
        if !full.starts_with(&root) {
            return Err(VaultFileErr::Forbidden);
        }
        let real = full
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        // Nor into the store's own dot files (a symlink, a Windows short name).
        if reserved_real_path(&real) {
            return Err(VaultFileErr::Forbidden);
        }
        // A symlink must not lead a restricted caller into a hidden path.
        if self.restricted() && !self.visible(&real) {
            return Err(VaultFileErr::NotFound);
        }
        if !full.is_file() {
            return Err(VaultFileErr::NotFound);
        }
        Ok(full)
    }

    /// Every image file in the vault (vault-relative, sorted), skipping hidden
    /// entries and symlinks like [`MemoryStore::walk`].
    pub fn image_files(&self) -> Vec<String> {
        let mut out: Vec<String> = WalkDir::new(self.root())
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .map(|e| self.rel_of(e.path()))
            .filter(|r| image_mime(r).is_some() && self.visible(r))
            .collect();
        out.sort();
        out
    }

    pub fn resolve_wikilink_closure(&self) -> impl Fn(&str) -> Option<String> + '_ {
        move |t: &str| self.resolve_wikilink(t)
    }

    fn base_name(path: &str) -> String {
        Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.replace(".md", ""))
    }
}

// ---------------------------------------------------------------------------
// Tag & frontmatter helper
// ---------------------------------------------------------------------------

impl MemoryStore {
    /// `(tags, frontmatter)` for a single file, exactly as [`render_markdown`] reports
    /// them, without rendering the note (or resolving its links).
    pub fn note_tags_fm(&self, fp: &Path) -> (Vec<String>, Value) {
        let content = self.read_raw(fp).unwrap_or_default();
        let mut fm = Map::new();
        for (k, v) in parse_frontmatter(&split_frontmatter(&content).0) {
            fm.insert(k, v);
        }
        (note_tags(&content), Value::Object(fm))
    }

    pub fn list_tags_impl(&self) -> Vec<Value> {
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        let files = self.walk();
        for meta in self.scan(&files) {
            for t in &meta.tags {
                *counts.entry(t.clone()).or_insert(0) += 1;
            }
        }
        let mut v: Vec<(String, usize)> = counts.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        v.into_iter()
            .map(|(t, c)| json!({"tag": t, "count": c}))
            .collect()
    }

    pub fn get_note_tags_impl(&self, path: &str) -> MResult<Value> {
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let (tags, fm) = self.note_tags_fm(&ap);
        let fm_tags = match fm.as_object() {
            Some(m) if m.contains_key("tags") => json!(fm_tag_values(m)),
            _ => json!([]),
        };
        Ok(json!({"path": path, "tags": tags, "frontmatter_tags": fm_tags}))
    }

    fn tag_list(input: &str) -> Vec<String> {
        input
            .split(',')
            .map(|t| t.trim().trim_start_matches('#').to_string())
            .filter(|t| !t.is_empty())
            .collect()
    }

    /// Frontmatter `tags` items exactly as written (inline or block list).
    fn fm_tag_items(&self, ap: &Path) -> Vec<String> {
        let content = self.read_raw(ap).unwrap_or_default();
        if !content.starts_with("---") {
            return Vec::new();
        }
        FmLines::parse(&split_frontmatter(&content).0).list("tags")
    }

    pub fn add_tags_impl(&self, path: &str, tags: &str) -> MResult<Value> {
        let list = Self::tag_list(tags)
            .iter()
            .map(|t| clean_tag(t))
            .collect::<MResult<Vec<_>>>()?;
        if list.is_empty() {
            return err("no tags given");
        }
        let ops: Vec<Value> = list
            .iter()
            .map(|t| json!({"op": "add_tag", "tag": t}))
            .collect();
        self.patch_memory_impl(path, &ops)?;
        self.get_note_tags_impl(path)
    }

    pub fn remove_tags_impl(&self, path: &str, tags: &str) -> MResult<Value> {
        let list = Self::tag_list(tags);
        if list.is_empty() {
            return err("no tags given");
        }
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let have: HashSet<String> = self.fm_tag_items(&ap).iter().map(|t| tag_key(t)).collect();
        let inline: HashSet<String> = self
            .note_tags_fm(&ap)
            .0
            .iter()
            .map(|t| t.to_lowercase())
            .collect();
        let mut ops = Vec::new();
        let mut notes = Vec::new();
        for t in &list {
            let k = t.to_lowercase();
            if have.contains(&k) {
                ops.push(json!({"op": "remove_tag", "tag": t}));
            } else if inline.contains(&k) {
                notes.push(format!(
                    "tag '{t}' is only an inline #tag in the body; edit the body to remove it"
                ));
            } else {
                notes.push(format!("tag '{t}' is not on this note"));
            }
        }
        if !ops.is_empty() {
            self.patch_memory_impl(path, &ops)?;
        }
        let mut v = self.get_note_tags_impl(path)?;
        if !notes.is_empty() {
            v["note"] = json!(notes.join("; "));
        }
        Ok(v)
    }

    /// Replace the frontmatter tag list with exactly `tags` (inline `#tags` in
    /// the body stay).
    pub fn set_tags_impl(&self, path: &str, tags: &str) -> MResult<Value> {
        let list = Self::tag_list(tags)
            .iter()
            .map(|t| clean_tag(t))
            .collect::<MResult<Vec<_>>>()?;
        let list = dedup_tags(list);
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        if !(list.is_empty() && self.fm_tag_items(&ap).is_empty()) {
            let op = json!({"op": "set_field", "field": "tags", "value": format!("[{}]", list.join(", "))});
            self.patch_memory_impl(path, &[op])?;
        }
        self.get_note_tags_impl(path)
    }

    pub fn search_by_tag_impl(&self, tag: &str, limit: usize) -> MResult<Vec<Value>> {
        let tag = tag.trim().trim_start_matches('#').to_lowercase();
        if tag.is_empty() {
            return err("tag required");
        }
        let mut out = Vec::new();
        let files = self.walk();
        let metas = self.scan(&files);
        for ((rel, name, _), meta) in files.into_iter().zip(metas) {
            let tags = &meta.tags;
            if tags.iter().any(|t| t.to_lowercase() == tag) {
                out.push(json!({
                    "path": rel,
                    "name": name,
                    "folder": folder_of(&rel),
                    "tags": tags,
                }));
            }
            if out.len() >= limit.max(1) {
                break;
            }
        }
        Ok(out)
    }

    /// Rewrite a tag, ignoring case, in frontmatter and in inline `#old`
    /// occurrences (`#old/sub` follows, `#old-other` is a different tag and
    /// stays). The frontmatter is only touched when its `tags` hold `old`.
    fn retag(content: &str, old: &str, new: &str) -> String {
        let okey = old.to_lowercase();
        let mut c = content.to_string();
        let (fm_text, body) = split_frontmatter(content);
        if content.starts_with("---") && !fm_text.is_empty() {
            let mut fm = FmLines::parse(&fm_text);
            let items = fm.list("tags");
            if items.iter().any(|t| tag_key(t) == okey) {
                let items = dedup_tags(
                    items
                        .into_iter()
                        .map(|t| {
                            if tag_key(&t) == okey {
                                new.to_string()
                            } else {
                                t
                            }
                        })
                        .collect(),
                );
                fm.set("tags", format!("[{}]", items.join(", ")));
                let body = body
                    .strip_prefix("\r\n")
                    .or_else(|| body.strip_prefix('\n'))
                    .unwrap_or(&body);
                c = format!("---\n{}---\n{body}", fm.render());
            }
        }
        // Inline tags: only where the shared scanner sees a tag (not in code,
        // URLs or wikilinks); `#old/sub` keeps its `/sub`.
        let body_at = c.len() - split_frontmatter(&c).1.len();
        let mut out = String::with_capacity(c.len());
        let mut last = 0;
        for r in inline_tag_spans(&c[body_at..]) {
            let r = body_at + r.start..body_at + r.end;
            let name = &c[r.clone()];
            let cut = name
                .match_indices('/')
                .map(|(i, _)| i)
                .chain([name.len()])
                .find(|&i| name[..i].to_lowercase() == okey);
            if let Some(i) = cut {
                out.push_str(&c[last..r.start]);
                out.push_str(new);
                last = r.start + i;
            }
        }
        out.push_str(&c[last..]);
        out
    }

    /// Rename (or merge) tag `old` into `new` across the vault, ignoring case.
    /// `new` must be a valid tag; a tag no note has is an error.
    pub fn rename_tag_impl(&self, old: &str, new: &str) -> MResult<Value> {
        if old.trim().trim_start_matches('#').is_empty()
            || new.trim().trim_start_matches('#').is_empty()
        {
            return err("both the old and the new tag are required");
        }
        let old = tag_name(old)?;
        let new = clean_tag(new)?;
        if old == new {
            return err(format!("the old and the new tag are the same: '{old}'"));
        }
        let mut changed = Vec::new();
        for (rel, _name, fp) in self.walk() {
            let Some(c) = self.read_raw(&fp) else {
                continue;
            };
            let nc = Self::retag(&c, &old, &new);
            if nc != c {
                let ap = self.resolve(&rel)?;
                fs::write(&ap, nc).ok();
                changed.push(rel);
            }
        }
        if changed.is_empty() {
            return err(format!("tag '{old}' is not on any note"));
        }
        let _ = self.reindex();
        self.git_commit(&format!(
            "rename tag {old}->{new} ({} notes)",
            changed.len()
        ));
        Ok(json!({"ok": true, "renamed": format!("{old} -> {new}"), "notes": changed}))
    }
}

// ---------------------------------------------------------------------------
// Graph navigation
// ---------------------------------------------------------------------------

impl MemoryStore {
    /// `(names -> rel path, undirected adjacency)` over resolved links (see
    /// [`crate::LinkIndex`]); notes without links have no entry.
    pub fn adjacency(&self) -> (BTreeMap<String, String>, BTreeMap<String, BTreeSet<String>>) {
        let idx = self.link_index();
        let mut adj: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for n in idx.names.keys() {
            let nb = idx.neighbors(n);
            if !nb.is_empty() {
                adj.insert(n.clone(), nb);
            }
        }
        (idx.names, adj)
    }

    /// The note a tool argument names, as `(note name, relative path)`: a vault path
    /// with or without `.md` (`Graph/B.md`, `Graph/B`) or a bare note name (`B`,
    /// resolved like a wikilink, ignoring case). Empty, out-of-vault, folder and
    /// missing paths are refused; a hidden path answers like a missing one.
    pub fn note_of(&self, path: &str) -> MResult<(String, String)> {
        let p = path.trim();
        if p.is_empty() {
            return err("path is empty: give a note path such as 'Folder/Note.md' or a note name");
        }
        let not_found = || MemoryErr(format!("not found: {path}"));
        let probe = self.resolve(p).map_err(|e| {
            if e.0.starts_with("not found") {
                not_found()
            } else {
                e
            }
        })?;
        let stem = p.strip_suffix(".md").unwrap_or(p);
        let full = if stem.ends_with('/') {
            None
        } else {
            self.resolve(&format!("{stem}.md")).ok()
        };
        if let Some(full) = full.filter(|f| f.is_file()) {
            let rel = self.disk_spelling(&self.rel_of(&full));
            // Notes inside hidden folders (the trash) are not part of the graph.
            if self.walk_has(&rel) {
                return Ok((Self::base_name(&rel), rel));
            }
            return Err(not_found());
        }
        if probe.is_dir() {
            return err(format!("{path} is a folder, not a note: give a note path"));
        }
        if !stem.contains('/') {
            if let Some(rel) = self.resolve_wikilink(stem) {
                return Ok((Self::base_name(&rel), rel));
            }
        }
        Err(not_found())
    }

    /// Whether `rel` is a note [`MemoryStore::walk`] lists (no hidden segment).
    /// `rel` as the vault lists it: on a case-insensitive filesystem (Windows,
    /// macOS) a path found with another spelling is mapped to the stored one when
    /// exactly one note matches; otherwise `rel` is returned unchanged.
    fn disk_spelling(&self, rel: &str) -> String {
        if !cfg!(any(windows, target_os = "macos")) {
            return rel.to_string();
        }
        let all: Vec<String> = self.walk().into_iter().map(|(r, _, _)| r).collect();
        if all.iter().any(|r| r == rel) {
            return rel.to_string();
        }
        let lower = rel.to_lowercase();
        let hits: Vec<&String> = all.iter().filter(|r| r.to_lowercase() == lower).collect();
        match hits.as_slice() {
            [one] => (*one).clone(),
            _ => rel.to_string(),
        }
    }

    fn walk_has(&self, rel: &str) -> bool {
        rel.ends_with(".md") && !rel.split('/').any(|s| s.starts_with('.'))
    }

    /// Breadth-first walk over undirected links: `(name, hops)`, the start first,
    /// nearer notes before farther ones.
    fn bfs(idx: &crate::LinkIndex, start: &str, depth: usize) -> Vec<(String, usize)> {
        let mut seen: BTreeSet<String> = BTreeSet::new();
        seen.insert(start.to_string());
        let mut q: Vec<(String, usize)> = vec![(start.to_string(), 0)];
        let mut i = 0usize;
        while i < q.len() {
            let (cur, d) = q[i].clone();
            i += 1;
            if d >= depth {
                continue;
            }
            for nb in idx.neighbors(&cur) {
                if seen.insert(nb.clone()) {
                    q.push((nb, d + 1));
                }
            }
        }
        q
    }

    pub fn get_neighbors_impl(&self, path: &str, depth: usize) -> MResult<Vec<Value>> {
        let idx = self.link_index();
        let (start, _) = self.note_of(path)?;
        Ok(Self::bfs(&idx, &start, depth)
            .into_iter()
            .skip(1)
            .map(|(nm, hops)| {
                let rel = idx.names[&nm].clone();
                json!({"name": nm, "path": rel, "folder": folder_of(&rel), "hops": hops})
            })
            .collect())
    }

    /// The notes within `depth` hops of `path` (nearest first, the note itself
    /// included), at most `max_nodes` of them, with every link between them in its
    /// real direction (a two-way link is two edges).
    pub fn get_subgraph_impl(&self, path: &str, depth: usize, max_nodes: usize) -> MResult<Value> {
        let idx = self.link_index();
        let (start, _) = self.note_of(path)?;
        let order = Self::bfs(&idx, &start, depth);
        let truncated = order.len() > max_nodes;
        let keep: BTreeSet<String> = order.into_iter().take(max_nodes).map(|x| x.0).collect();
        let nodes: Vec<Value> = keep
            .iter()
            .map(|n| {
                json!({"name": n, "path": idx.names.get(n), "folder": idx.names.get(n).map(|p| folder_of(p))})
            })
            .collect();
        let mut links = Vec::new();
        for a in &keep {
            for b in idx.out.get(a).into_iter().flatten() {
                if keep.contains(b) {
                    links.push(json!({"source": a, "target": b}));
                }
            }
        }
        Ok(json!({"nodes": nodes, "links": links, "truncated": truncated}))
    }

    pub fn find_path_impl(&self, src: &str, dst: &str) -> MResult<Value> {
        let idx = self.link_index();
        let (a, _) = self
            .note_of(src)
            .map_err(|e| MemoryErr(format!("source {}", e.0)))?;
        let (b, _) = self
            .note_of(dst)
            .map_err(|e| MemoryErr(format!("target {}", e.0)))?;
        let mut prev: HashMap<String, Option<String>> = HashMap::new();
        prev.insert(a.clone(), None);
        let mut q: Vec<String> = vec![a.clone()];
        let mut i = 0usize;
        while i < q.len() {
            let cur = q[i].clone();
            i += 1;
            if cur == b {
                break;
            }
            for nb in idx.neighbors(&cur) {
                if !prev.contains_key(&nb) {
                    prev.insert(nb.clone(), Some(cur.clone()));
                    q.push(nb);
                }
            }
        }
        if !prev.contains_key(&b) {
            return Ok(json!({"found": false, "path": []}));
        }
        let mut chain = Vec::new();
        let mut cur = Some(b.clone());
        while let Some(c) = cur {
            chain.push(c.clone());
            cur = prev.get(&c).cloned().flatten();
        }
        chain.reverse();
        let path: Vec<Value> = chain
            .iter()
            .map(|n| json!({"name": n, "path": idx.names.get(n)}))
            .collect();
        Ok(json!({"found": true, "hops": chain.len() - 1, "path": path}))
    }

    /// Notes with the highest degree (see [`crate::LinkIndex`]); notes without links
    /// are left out.
    pub fn get_hubs_impl(&self, limit: usize) -> Vec<Value> {
        let idx = self.link_index();
        let mut ranked: Vec<(&String, usize)> = idx
            .names
            .keys()
            .map(|n| (n, idx.degree(n)))
            .filter(|x| x.1 > 0)
            .collect();
        // Stable ordering: for equal degrees, the order in which notes first took
        // part in a link during the walk.
        ranked.sort_by(|a, b| {
            b.1.cmp(&a.1).then_with(|| {
                idx.first_seen
                    .get(a.0)
                    .unwrap_or(&usize::MAX)
                    .cmp(idx.first_seen.get(b.0).unwrap_or(&usize::MAX))
                    .then_with(|| a.0.cmp(b.0))
            })
        });
        ranked
            .into_iter()
            .take(limit)
            .map(|(n, d)| {
                json!({"name": n, "path": idx.names.get(n),
                       "folder": idx.names.get(n).map(|p| folder_of(p)), "degree": d})
            })
            .collect()
    }

    pub fn get_isolated_impl(&self) -> Vec<Value> {
        let idx = self.link_index();
        idx.names
            .iter()
            .filter(|(n, _)| idx.degree(n) == 0)
            .map(|(n, rel)| json!({"name": n, "path": rel, "folder": folder_of(rel)}))
            .collect()
    }

    /// Links of one note (see [`crate::LinkIndex`]): the notes it links to, the
    /// notes linking to it, and its link targets that resolve to no note.
    pub fn link_stats_impl(&self, path: &str) -> MResult<Value> {
        let idx = self.link_index();
        let (name, rel) = self.note_of(path)?;
        let names = |m: &BTreeMap<String, BTreeSet<String>>| -> Vec<String> {
            m.get(&name)
                .map(|s| s.iter().cloned().collect())
                .unwrap_or_default()
        };
        let (out, inc, broken) = (names(&idx.out), names(&idx.incoming), names(&idx.broken));
        Ok(json!({
            "path": rel,
            "name": name,
            "degree": idx.degree(&name),
            "outgoing": out.len(),
            "incoming": inc.len(),
            "links_to": out,
            "linked_from": inc,
            "unresolved": broken,
        }))
    }
}

/// Every `patch_memory` op, for error messages.
const PATCH_OPS: &str = "append, prepend, replace, set_field, add_tag, remove_tag";

/// What a tag may contain, for error messages.
const TAG_RULE: &str = "a tag may contain only letters, digits and - _ / . (no spaces, commas, colons, quotes, brackets, # after the start, `---` or line breaks)";

/// A tag as the caller wrote it, without surrounding spaces and leading `#`s,
/// or an error when it is empty or holds characters that would break (or
/// inject into) the frontmatter `tags: [..]` list.
pub fn clean_tag(raw: &str) -> MResult<String> {
    let t = raw.trim().trim_start_matches('#');
    if t.is_empty() {
        return err("empty tag: give a tag name (a leading # is optional)");
    }
    let simple = t
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '/' | '.'));
    if !simple || t.contains("---") {
        return err(format!("invalid tag {:?}: {TAG_RULE}", raw.trim()));
    }
    Ok(t.to_string())
}

/// A tag to look up (remove, rename from): any text, minus surrounding spaces
/// and leading `#`s, so existing odd tags can still be removed.
fn tag_name(raw: &str) -> MResult<String> {
    let t = raw.trim().trim_start_matches('#').trim();
    if t.is_empty() {
        return err("empty tag: give a tag name (a leading # is optional)");
    }
    Ok(t.to_string())
}

/// Compare key of a frontmatter tag item as written (`"a"`, `#a`, `A` -> `a`).
fn tag_key(item: &str) -> String {
    item.trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .trim_start_matches('#')
        .to_lowercase()
}

/// Items of an inline frontmatter tag value as written: `[a, b]`, `a, b` or
/// the quoted string form `"a, b"`.
fn inline_tag_items(v: &str) -> Vec<String> {
    let v = v.trim();
    let quoted = v.len() >= 2
        && ((v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\'')));
    let inner = if quoted {
        &v[1..v.len() - 1]
    } else {
        let v = v.strip_prefix('[').unwrap_or(v);
        v.strip_suffix(']').unwrap_or(v)
    };
    inner
        .split(',')
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .collect()
}

/// `items` without later case-insensitive repeats (the first spelling stays).
fn dedup_tags(items: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|t| seen.insert(tag_key(t)))
        .collect()
}

/// Frontmatter tags as parsed by [`parse_frontmatter`]: a list, or the string
/// form `tags: a, b` split on commas.
fn fm_tag_values(fm: &Map<String, Value>) -> Vec<String> {
    let items: Vec<String> = match fm.get("tags") {
        Some(Value::Array(list)) => list
            .iter()
            .map(|t| t.as_str().unwrap_or("").to_string())
            .collect(),
        Some(Value::String(s)) => s.split(',').map(|t| t.to_string()).collect(),
        _ => Vec::new(),
    };
    items
        .iter()
        .map(|t| {
            t.trim()
                .trim_matches('"')
                .trim_matches('\'')
                .trim()
                .to_string()
        })
        .filter(|t| !t.is_empty())
        .collect()
}

/// Frontmatter as written, for in-place edits: untouched entries (multi-line
/// values, block lists, comments) are written back verbatim.
struct FmLines {
    entries: Vec<FmEntry>,
}

struct FmEntry {
    /// `None` for lines that are not a top-level `key: value` (comments).
    key: Option<String>,
    /// The `key: value` line (or the raw line) plus its continuation lines.
    lines: Vec<String>,
}

impl FmLines {
    fn parse(fm_text: &str) -> Self {
        let mut entries: Vec<FmEntry> = Vec::new();
        let lines: Vec<&str> = fm_text.lines().collect();
        let first = lines.iter().position(|l| !l.trim().is_empty());
        let last = lines.iter().rposition(|l| !l.trim().is_empty());
        let (Some(first), Some(last)) = (first, last) else {
            return Self { entries };
        };
        for line in &lines[first..=last] {
            let top = !line.starts_with([' ', '\t', '-', '#']);
            match line.split_once(':') {
                Some((k, _)) if top => entries.push(FmEntry {
                    key: Some(k.trim().to_string()),
                    lines: vec![line.to_string()],
                }),
                _ => match entries.last_mut() {
                    Some(e) if e.key.is_some() && !line.starts_with('#') => {
                        e.lines.push(line.to_string())
                    }
                    _ => entries.push(FmEntry {
                        key: None,
                        lines: vec![line.to_string()],
                    }),
                },
            }
        }
        Self { entries }
    }

    fn has_keys(&self) -> bool {
        self.entries.iter().any(|e| e.key.is_some())
    }

    /// Replace (or add) `key` with a one-line value.
    fn set(&mut self, key: &str, val: String) {
        let lines = vec![format!("{key}: {val}")];
        match self
            .entries
            .iter_mut()
            .find(|e| e.key.as_deref() == Some(key))
        {
            Some(e) => e.lines = lines,
            None => self.entries.push(FmEntry {
                key: Some(key.to_string()),
                lines,
            }),
        }
    }

    /// Items of an inline (`[a, b]`) or block (`- a`) list.
    fn list(&self, key: &str) -> Vec<String> {
        let Some(e) = self.entries.iter().find(|e| e.key.as_deref() == Some(key)) else {
            return Vec::new();
        };
        let inline = e.lines[0].split_once(':').map(|x| x.1).unwrap_or("").trim();
        let raw: Vec<String> = if inline.is_empty() {
            e.lines[1..]
                .iter()
                .filter_map(|l| l.trim().strip_prefix('-'))
                .map(|x| x.trim().to_string())
                .collect()
        } else {
            inline_tag_items(inline)
        };
        raw.into_iter().filter(|x| !x.is_empty()).collect()
    }

    /// Every line, each ending in `\n`.
    fn render(&self) -> String {
        let mut t = String::new();
        for l in self.entries.iter().flat_map(|e| &e.lines) {
            t.push_str(l);
            t.push('\n');
        }
        t
    }
}

// ---------------------------------------------------------------------------
// Query, read, patch
// ---------------------------------------------------------------------------

impl MemoryStore {
    /// Notes matching every given filter: `folder` (that folder and its subfolders,
    /// case-sensitive like paths; `Root` = top level), `tags` (comma-separated, all
    /// required, case-insensitive, a leading `#` ignored) and the frontmatter fields
    /// `author`, `type`, `status` (case-insensitive). At most `limit` notes (0 = none).
    pub fn query_memory_impl(
        &self,
        folder: Option<&str>,
        tags: Option<&str>,
        author: Option<&str>,
        ntype: Option<&str>,
        status: Option<&str>,
        limit: usize,
    ) -> Vec<Value> {
        let tag_list: Vec<String> = tags
            .unwrap_or("")
            .split(',')
            .map(|t| t.trim().trim_start_matches('#').to_lowercase())
            .filter(|t| !t.is_empty())
            .collect();
        let mut out = Vec::new();
        if limit == 0 {
            return out;
        }
        let files = self.walk();
        let metas = self.scan(&files);
        for ((rel, name, _), meta) in files.into_iter().zip(metas) {
            if !in_folder(&rel, folder.unwrap_or("")) {
                continue;
            }
            if !tag_list.iter().all(|t| meta.search_tags.contains(t)) {
                continue;
            }
            let fm = &meta.fm;
            let field_eq = |key: &str, want: &str| -> bool {
                if want.is_empty() {
                    return true;
                }
                fm.get(key)
                    .map(|v| v.as_str().unwrap_or("").to_lowercase() == want.to_lowercase())
                    .unwrap_or(false)
            };
            if !field_eq("author", author.unwrap_or("")) {
                continue;
            }
            if !field_eq("type", ntype.unwrap_or("")) {
                continue;
            }
            if !field_eq("status", status.unwrap_or("")) {
                continue;
            }
            out.push(json!({
                "path": rel, "name": name, "folder": folder_of(&rel),
                "tags": meta.tags, "frontmatter": fm,
            }));
            if out.len() >= limit {
                break;
            }
        }
        out
    }

    pub fn read_note_impl(&self, path: &str) -> MResult<Value> {
        // `Notes\Ideas.md` is `Notes/Ideas.md`: echo and compare the stored form.
        let path = norm_note_path(path);
        let path = path.as_str();
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let content = self
            .read_raw(&ap)
            .ok_or_else(|| MemoryErr(format!("permission denied: {path}")))?;
        let note_dir = path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        // One walk for the whole view: links resolve against it, backlinks come
        // from the note cache (no file is read again unless it changed).
        let files = self.walk();
        let links = LinkIndex::new(files.iter().map(|(rel, _, _)| rel.clone()));
        // Links resolve from this note's folder first (same names elsewhere).
        let resolver = |t: &str| links.resolve(t, note_dir);
        let images: std::cell::OnceCell<Vec<String>> = std::cell::OnceCell::new();
        let file = |cand: &str, by_name: bool| -> Option<String> {
            if !by_name {
                return self.vault_image_file(cand).ok().map(|_| cand.to_string());
            }
            let list = images.get_or_init(|| self.image_files());
            find_image_by_name(list, cand)
        };
        let ctx = RenderCtx {
            note: &resolver,
            file: &file,
            note_dir,
        };
        let (html, tags, fm) = render_markdown_ctx(&content, &ctx);
        let name = Self::base_name(path);
        let name_l = name.to_lowercase();
        // A note links here when a wikilink target (minus folder, `.md` and
        // `#heading`) names it; `[[Plan]]` is not a backlink of `Plan-B`.
        let names_me = |t: &String| {
            let t = Self::norm_target(t);
            t.split('#').next().unwrap_or("").trim().to_lowercase() == name_l
        };
        let mut backlinks = Vec::new();
        let metas = self.scan(&files);
        for ((rel2, name2, _), meta) in files.iter().zip(&metas) {
            if rel2 == path {
                continue;
            }
            if meta.targets.iter().any(names_me) {
                backlinks.push(json!({"path": rel2, "name": name2}));
            }
        }
        let size = fs::metadata(&ap).map(|m| m.len()).unwrap_or(0);
        let mtime = fs::metadata(&ap)
            .and_then(|m| m.modified())
            .map(|t| {
                t.duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0)
            })
            .unwrap_or(0.0);
        Ok(json!({
            "path": path, "name": name, "content": content, "html": html,
            "tags": tags, "frontmatter": fm, "backlinks": backlinks,
            "size": size, "mtime": mtime,
        }))
    }

    /// Apply a flat list of patch operations.
    pub fn patch_memory_impl(&self, path: &str, ops: &[Value]) -> MResult<Value> {
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let content = self.read_raw(&ap).unwrap_or_default();
        let (fm_text, mut body) = split_frontmatter(&content);
        if !fm_text.is_empty() {
            // The newline after the closing `---` belongs to the delimiter.
            body = body
                .strip_prefix("\r\n")
                .or_else(|| body.strip_prefix('\n'))
                .unwrap_or(&body)
                .to_string();
        }
        let mut fm = FmLines::parse(&fm_text);
        // A field an op cannot do without: a missing one is an error, never an
        // empty string (a `replace` without its replacement used to delete
        // the matched text). Ops apply all at once, so nothing is saved.
        let need = |v: &Value, k: &str, t: &str| -> MResult<String> {
            match v.get(k).and_then(|x| x.as_str()) {
                Some(x) => Ok(x.to_string()),
                None => err(format!("patch op `{t}` needs a string `{k}`")),
            }
        };

        for (i, op) in ops.iter().enumerate() {
            let n = i + 1;
            let Some((t, obj)) = op
                .as_object()
                .and_then(|o| Some((o.get("op")?.as_str()?, o)))
            else {
                return err(format!("op {n} has no `op`; use one of {PATCH_OPS}"));
            };
            let keys: &[&str] = match t {
                "append" | "prepend" => &["text"],
                "replace" => &["find", "with", "replace"],
                "set_field" => &["field", "value"],
                "add_tag" | "remove_tag" => &["tag"],
                other => {
                    return err(format!(
                        "op {n}: unknown patch op `{other}`; use one of {PATCH_OPS}"
                    ))
                }
            };
            if let Some(bad) = obj
                .keys()
                .find(|k| *k != "op" && !keys.contains(&k.as_str()))
            {
                return err(format!(
                    "op {n} (`{t}`) has an unknown key `{bad}`; `{t}` takes: op, {}",
                    keys.join(", ")
                ));
            }
            match t {
                "set_field" => {
                    let field = need(op, "field", t)?;
                    if field.trim().is_empty() {
                        return err("patch op `set_field` needs a non-empty `field`".to_string());
                    }
                    let key_ok = field
                        .chars()
                        .all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.'))
                        && !field.contains("---");
                    if !key_ok {
                        return err(format!(
                            "patch op `set_field`: invalid field name {field:?}; a field name may contain only letters, digits and _ - . (no spaces, colons, `---` or line breaks)"
                        ));
                    }
                    let val = op
                        .get("value")
                        .map(|v| match v {
                            Value::String(x) => x.clone(),
                            other => other.to_string(),
                        })
                        .unwrap_or_default();
                    if val.chars().any(|c| c.is_control() && c != '\t') {
                        return err(format!(
                            "patch op `set_field`: the value for `{field}` contains a line break or control character; a frontmatter value must be a single line"
                        ));
                    }
                    if val.contains("---") {
                        return err(format!(
                            "patch op `set_field`: the value for `{field}` contains `---`, which would end the frontmatter"
                        ));
                    }
                    fm.set(&field, val);
                }
                "append" => {
                    let text = need(op, "text", t)?;
                    body = format!("{}\n{}\n", body.trim_end_matches('\n'), text);
                }
                "prepend" => {
                    let text = need(op, "text", t)?;
                    body = format!("\n{}\n{}", text, body.trim_start_matches('\n'));
                }
                "add_tag" | "remove_tag" => {
                    // Matching ignores case; a tag already present keeps its
                    // spelling. Repeats are dropped whenever the list is rewritten.
                    let raw = need(op, "tag", t)?;
                    let tag = if t == "add_tag" {
                        clean_tag(&raw)?
                    } else {
                        tag_name(&raw)?
                    };
                    let key = tag.to_lowercase();
                    let mut items = dedup_tags(fm.list("tags"));
                    if t == "add_tag" {
                        if !items.iter().any(|x| tag_key(x) == key) {
                            items.push(tag);
                        }
                    } else {
                        items.retain(|x| tag_key(x) != key);
                    }
                    fm.set("tags", format!("[{}]", items.join(", ")));
                }
                "replace" => {
                    // Literal text, not a regex. `replace` is accepted as an
                    // alias of `with` (bulk_replace names it that way).
                    let find = need(op, "find", t)?;
                    let with = match (op.get("with"), op.get("replace")) {
                        (Some(Value::String(w)), _) | (None, Some(Value::String(w))) => w.clone(),
                        _ => return err("patch op `replace` needs a string `with` (the replacement; \"\" deletes)".to_string()),
                    };
                    if find.is_empty() {
                        return err("patch op `replace` needs a non-empty `find`".to_string());
                    }
                    if !body.contains(&find) {
                        return err(format!(
                            "patch op `replace`: `find` text not found in {path}"
                        ));
                    }
                    replaced_size_ok(literal_replaced_len(&body, &find, &with), path)?;
                    body = body.replace(&find, &with);
                }
                other => return err(format!("op {n}: unknown patch op `{other}`")),
            }
        }

        let out = if fm.has_keys() {
            format!("---\n{}---\n{body}", fm.render())
        } else {
            body
        };
        self.save_impl(path, &out)?;
        Ok(json!({"ok": true, "path": path, "ops": ops.len()}))
    }
}

// ---------------------------------------------------------------------------
// Vault mutations
// ---------------------------------------------------------------------------

impl MemoryStore {
    /// A destination folder from a caller: `\` read as `/`, surrounding `/` and
    /// spaces dropped; `""` (also for `Root` or blank) is the top level. Refuses an
    /// absolute folder and a folder path that runs through a note.
    fn dest_folder(&self, folder: &str) -> MResult<String> {
        if is_absolute_input(folder) {
            return err(format!(
                "folder must be relative to the vault (got `{folder}`); use 'Root' for the top level"
            ));
        }
        let f = folder.trim().replace('\\', "/");
        let f = f.trim_matches('/').trim();
        if f.is_empty() || f == "Root" {
            return Ok(String::new());
        }
        let mut prefix = String::new();
        for seg in f.split('/') {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(seg);
            if self.resolve(&prefix)?.is_file() {
                return err(format!("folder `{prefix}` is a note, not a folder"));
            }
        }
        Ok(f.to_string())
    }

    /// Refuse `rel` (at `ap`) as a new note path when it, or a name in its folder
    /// that differs only in case, is taken (`except` is the note being renamed or
    /// moved itself). A twin hidden from the caller answers like a missing path.
    fn ensure_free(&self, ap: &Path, rel: &str, except: Option<&Path>) -> MResult<()> {
        let (Some(dir), Some(name)) = (ap.parent(), ap.file_name()) else {
            return Ok(());
        };
        // On a case-insensitive filesystem (Windows, macOS) `exists` is also true
        // for a twin that differs only in case, so only an entry with exactly this
        // name counts here; twins are handled below.
        let exact = fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .any(|e| e.file_name() == name);
        if exact && Some(ap) != except {
            return err(format!("already exists: {rel}"));
        }
        let want = name.to_string_lossy().to_lowercase();
        for e in fs::read_dir(dir).into_iter().flatten().flatten() {
            let n = e.file_name();
            if n == name || n.to_string_lossy().to_lowercase() != want {
                continue;
            }
            let twin = e.path();
            if Some(twin.as_path()) == except {
                continue;
            }
            let twin_rel = self.rel_of(&twin);
            if !self.visible(&twin_rel) {
                return err(format!("already exists: {rel}"));
            }
            return err(format!(
                "already exists (names are compared without case): {twin_rel}"
            ));
        }
        Ok(())
    }

    /// Every note path in the vault, hidden ones included (taken before a move, for
    /// [`MemoryStore::rewrite_moved_links`]).
    fn all_note_paths(&self) -> Vec<String> {
        self.walk_all().into_iter().map(|(rel, _, _)| rel).collect()
    }

    /// After the notes in `moves` (old path -> new path) moved, rewrite every wikilink
    /// in the vault that named one of them (or that now names another note because the
    /// linking note itself moved) so it names the same note as before. `before`: every
    /// note path before the move ([`MemoryStore::all_note_paths`]). Notes hidden from
    /// the caller are rewritten too, so links stay correct for everyone, but only the
    /// notes the caller may see are counted. Returns that count.
    fn rewrite_moved_links(&self, before: &[String], moves: &HashMap<String, String>) -> usize {
        if moves.iter().all(|(a, b)| a == b) {
            return 0;
        }
        let old = LinkIndex::new(before.iter().cloned());
        let after = self.walk_all();
        let new = LinkIndex::new(after.iter().map(|(rel, _, _)| rel.clone()));
        let back: HashMap<&str, &str> = moves
            .iter()
            .map(|(o, n)| (n.as_str(), o.as_str()))
            .collect();
        let mut changed = 0;
        for (rel, _, fp) in &after {
            let Some(content) = self.read_raw(fp) else {
                continue;
            };
            if !content.contains("[[") {
                continue;
            }
            let old_dir = parent_folder(back.get(rel.as_str()).copied().unwrap_or(rel));
            let new_dir = parent_folder(rel);
            let out = rewrite_links_in(&content, |raw| {
                relinked_target(raw, &old, &new, moves, old_dir, new_dir)
            });
            if let Some(out) = out {
                if fs::write(fp, out).is_ok() && self.visible(rel) {
                    changed += 1;
                }
            }
        }
        changed
    }

    pub fn create_impl(&self, title: &str, folder: &str, content: Option<&str>) -> MResult<String> {
        let name = note_filename(title)?;
        let fn_ = &name.file;
        let folder = self.dest_folder(folder)?;
        let rel = if folder.is_empty() {
            format!("{fn_}.md")
        } else {
            format!("{folder}/{fn_}.md")
        };
        let ap = self.resolve_new(&rel)?;
        self.ensure_free(&ap, &rel, None)?;
        let body = match content {
            Some(c) => c.to_string(),
            None => format!("---\ncreated: {}\n---\n\n# {}\n\n", now_iso(), name.title),
        };
        if let Some(parent) = ap.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&ap, body).map_err(|e| MemoryErr(e.to_string()))?;
        self.refresh_notes(&[&ap]);
        self.git_commit(&format!("create: {rel}"));
        Ok(rel)
    }

    pub fn save_impl(&self, rel_path: &str, content: &str) -> MResult<()> {
        let rel_path = &norm_note_path(rel_path);
        let ap = self.resolve(rel_path)?;
        if !ap.is_file() {
            return err(format!("not found: {rel_path}"));
        }
        fs::write(&ap, content).map_err(|e| MemoryErr(e.to_string()))?;
        self.refresh_notes(&[&ap]);
        self.git_commit(&format!("edit: {rel_path}"));
        Ok(())
    }

    pub fn rename_impl(&self, rel_path: &str, new_name: &str) -> MResult<String> {
        self.rename_note(rel_path, new_name).map(|(p, _)| p)
    }

    /// Rename a note in place and rewrite the wikilinks that named it (bare names
    /// too); returns the new path and how many notes (that the caller may see) had
    /// their links updated.
    pub fn rename_note(&self, rel_path: &str, new_name: &str) -> MResult<(String, usize)> {
        let rel_path = &norm_note_path(rel_path);
        let ap = self.resolve(rel_path)?;
        if !ap.is_file() {
            return err(format!("not found: {rel_path}"));
        }
        let fn_ = note_filename(new_name)?.file;
        let folder = Path::new(rel_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string());
        let dest = match folder {
            Some(f) if !f.is_empty() && f != "." => format!("{f}/{fn_}.md"),
            _ => format!("{fn_}.md"),
        };
        let dap = self.resolve(&dest)?;
        self.ensure_free(&dap, &dest, Some(&ap))?;
        let before = self.all_note_paths();
        fs::rename(&ap, &dap).map_err(|e| MemoryErr(e.to_string()))?;
        self.path_event(PathEvent::Moved {
            from: rel_path.to_string(),
            to: dest.clone(),
            carry: false,
        });
        let moves = HashMap::from([(self.rel_of(&ap), self.rel_of(&dap))]);
        let links = self.rewrite_moved_links(&before, &moves);
        let _ = self.reindex();
        self.git_commit(&format!("rename: {rel_path} -> {dest}"));
        Ok((dest, links))
    }

    pub fn move_impl(&self, rel_path: &str, dest_folder: &str) -> MResult<String> {
        self.move_note(rel_path, dest_folder).map(|(p, _)| p)
    }

    /// Move a note into `dest_folder` (`""` or `Root` = top level) and rewrite the
    /// wikilinks that named it by path; returns the new path and how many notes (that
    /// the caller may see) had their links updated.
    pub fn move_note(&self, rel_path: &str, dest_folder: &str) -> MResult<(String, usize)> {
        let rel_path = &norm_note_path(rel_path);
        let ap = self.resolve(rel_path)?;
        if !ap.is_file() {
            return err(format!("not found: {rel_path}"));
        }
        let fn_ = Path::new(rel_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let dest = if is_root_alias(dest_folder) {
            fn_
        } else {
            let folder = folder_arg(&self.dest_folder(dest_folder)?)?;
            refuse_root_name(&folder)?;
            format!("{folder}/{fn_}")
        };
        let dap = self.resolve(&dest)?;
        self.ensure_free(&dap, &dest, Some(&ap))?;
        if let Some(p) = dap.parent() {
            fs::create_dir_all(p).map_err(|e| MemoryErr(e.to_string()))?;
        }
        let before = self.all_note_paths();
        fs::rename(&ap, &dap).map_err(|e| MemoryErr(e.to_string()))?;
        self.path_event(PathEvent::Moved {
            from: rel_path.to_string(),
            to: dest.clone(),
            carry: false,
        });
        let moves = HashMap::from([(self.rel_of(&ap), self.rel_of(&dap))]);
        let links = self.rewrite_moved_links(&before, &moves);
        let _ = self.reindex();
        self.git_commit(&format!("move: {rel_path} -> {dest}"));
        Ok((dest, links))
    }

    pub fn delete_impl(&self, rel_path: &str) -> MResult<()> {
        let ap = self.resolve(rel_path)?;
        if !ap.is_file() {
            return err(format!("not found: {rel_path}"));
        }
        fs::remove_file(&ap).map_err(|e| MemoryErr(e.to_string()))?;
        self.path_event(PathEvent::Deleted {
            path: rel_path.to_string(),
        });
        let _ = self.reindex();
        self.git_commit(&format!("delete: {rel_path}"));
        Ok(())
    }

    /// Create a folder; `name` may be a nested path (`Work/Plans`), each segment
    /// cleaned like a note title. Returns the cleaned path.
    pub fn create_folder_impl(&self, name: &str) -> MResult<String> {
        self.create_folder(name)
            .map(|v| v["folder"].as_str().unwrap_or("").to_string())
    }

    /// [`MemoryStore::create_folder_impl`] with the details: `{folder, existed, note?}`.
    /// A new folder gets an `Index.md` note titled after it (so it shows in the tree);
    /// an existing folder is left untouched (`existed: true`), whether or not the
    /// caller may see it, so the answer never tells a hidden folder from a visible one. `note` says how the
    /// name was cleaned when that changed it.
    pub fn create_folder(&self, name: &str) -> MResult<Value> {
        let asked = folder_arg(name)?;
        if asked.is_empty() {
            return err("a folder name is required");
        }
        let path = clean_folder_path(&asked)?;
        refuse_root_name(&path)?;
        let mut out = json!({"folder": path, "existed": true});
        if let Some(n) = renamed_note(&asked, &path) {
            out["note"] = json!(n);
        }
        let dir = match self.resolve_new(&path) {
            Ok(dir) => dir,
            // An existing folder hidden from the caller answers exactly like a visible
            // existing one (existed: true) and is never touched.
            Err(_) if self.hidden_dir(&path) => return Ok(out),
            Err(e) => return Err(e),
        };
        if dir.is_dir() {
            return Ok(out);
        }
        if dir.exists() {
            return err(format!("already exists: {path}"));
        }
        out["existed"] = json!(false);
        fs::create_dir_all(&dir)
            .map_err(|e| MemoryErr(format!("could not create folder {path}: {e}")))?;
        let index = self.resolve(&format!("{path}/Index.md"))?;
        let title = path.rsplit('/').next().unwrap_or(&path).replace('_', " ");
        fs::write(&index, format!("# {title}\n\n"))
            .map_err(|e| MemoryErr(format!("could not write {path}/Index.md: {e}")))?;
        let _ = self.reindex();
        self.git_commit(&format!("folder: {path}"));
        Ok(out)
    }

    /// Whether `path` (already checked by [`folder_arg`]) is an existing directory
    /// hidden from the caller.
    fn hidden_dir(&self, path: &str) -> bool {
        !self.visible(path)
            && fs::symlink_metadata(self.root().join(path)).is_ok_and(|m| m.is_dir())
    }

    /// The directory of an existing folder path (not Root, not hidden), and the path
    /// as checked by [`folder_arg`].
    fn folder_dir(&self, folder: &str) -> MResult<(String, PathBuf)> {
        let f = folder_arg(folder)?;
        if f.is_empty() || f == "Root" {
            return err(
                "a folder is required (Root, the top level, cannot be renamed, moved or deleted)",
            );
        }
        if !self.visible(&f) {
            return err(format!("folder not found: {folder}"));
        }
        let dir = self.resolve(&f)?;
        if !dir.is_dir() {
            return err(format!("folder not found: {folder}"));
        }
        Ok((f, dir))
    }

    /// Move the folder directory `src` to the path `dest` (parents created), carrying
    /// the folder metadata of `src` and every sub folder along, and rewriting the
    /// wikilinks that named its notes by path. The result says whether a parent of
    /// `dest` had to be `created` and how many notes had `links_updated`.
    fn relocate_folder(&self, src: &str, dest: &str, what: &str) -> MResult<Value> {
        let (src, sdir) = self.folder_dir(src)?;
        if dest == src {
            return err("the folder is already there");
        }
        if dest.starts_with(&format!("{src}/")) {
            return err("a folder cannot be moved into itself");
        }
        let ddir = self.resolve(dest)?;
        if !self.subtree_visible(&sdir) {
            return err(PROTECTED_INSIDE);
        }
        if ddir.exists() {
            return err(format!("already exists: {dest}"));
        }
        let mut created = false;
        if let Some(p) = ddir.parent() {
            if let Some(f) = p.ancestors().find(|a| a.is_file()) {
                return err(format!("{} is a note, not a folder", self.rel_of(f)));
            }
            created = !p.is_dir();
            fs::create_dir_all(p).map_err(|e| MemoryErr(e.to_string()))?;
        }
        let before = self.all_note_paths();
        let prefix = format!("{src}/");
        let moves: HashMap<String, String> = before
            .iter()
            .filter_map(|rel| {
                let rest = rel.strip_prefix(&prefix)?;
                Some((rel.clone(), format!("{dest}/{rest}")))
            })
            .collect();
        let notes = self
            .walk()
            .iter()
            .filter(|(rel, _, _)| rel.starts_with(&prefix))
            .count();
        fs::rename(&sdir, &ddir).map_err(|e| MemoryErr(e.to_string()))?;
        self.path_event(PathEvent::Moved {
            from: src.clone(),
            to: dest.to_string(),
            carry: false,
        });
        self.rekey_folder_meta(&src, Some(dest));
        let links = self.rewrite_moved_links(&before, &moves);
        let _ = self.reindex();
        self.git_commit(&format!("{what} folder: {src} -> {dest}"));
        Ok(json!({
            "ok": true, "from": src, "to": dest, "notes": notes,
            "created": created, "links_updated": links,
        }))
    }

    /// A destination folder for a move (`into`): `None` for the top level (`""` or
    /// `Root`), else the cleaned path and a note when cleaning changed it. Refuses
    /// absolute paths, `..`, a note as destination and a top-level `Root` folder.
    fn move_target(&self, into: &str) -> MResult<Option<(String, Option<String>)>> {
        if is_root_alias(into) {
            return Ok(None);
        }
        let asked = folder_arg(into)?;
        if asked.to_lowercase().ends_with(".md")
            || self.resolve(&asked).is_ok_and(|p| p.is_file())
            || self
                .resolve(&format!("{asked}.md"))
                .is_ok_and(|p| p.is_file())
        {
            return err(format!("destination {asked} is a note, not a folder"));
        }
        let path = clean_folder_path(&asked)?;
        refuse_root_name(&path)?;
        let note = renamed_note(&asked, &path);
        Ok(Some((path, note)))
    }

    /// Point folder metadata of `src` (and its sub folders) at `dest`; `None` drops it.
    fn rekey_folder_meta(&self, src: &str, dest: Option<&str>) {
        let Ok(raw) = fs::read_to_string(self.folders_path()) else {
            return;
        };
        let Ok(meta) = serde_json::from_str::<Map<String, Value>>(&raw) else {
            return;
        };
        let mut out = Map::new();
        let mut changed = false;
        for (k, v) in meta {
            let rest = if k == src {
                Some(String::new())
            } else {
                k.strip_prefix(&format!("{src}/")).map(|r| format!("/{r}"))
            };
            match (rest, dest) {
                (Some(r), Some(d)) => {
                    // An existing entry at the destination wins.
                    out.entry(format!("{d}{r}")).or_insert(v);
                    changed = true;
                }
                (Some(_), None) => changed = true,
                (None, _) => {
                    out.insert(k, v);
                }
            }
        }
        if changed {
            fs::write(
                self.folders_path(),
                serde_json::to_string_pretty(&Value::Object(out)).unwrap(),
            )
            .ok();
        }
    }

    /// Rename a folder in place (same parent). `name` is one path segment.
    pub fn rename_folder_impl(&self, folder: &str, name: &str) -> MResult<Value> {
        let asked = name.trim();
        if asked.contains('/') || asked.contains('\\') {
            return err(
                "the new name is one folder name, without / or \\ (use move_folder to move it)",
            );
        }
        if asked.starts_with('.') {
            return err(format!(
                "invalid folder name (names starting with '.' are reserved): {asked}"
            ));
        }
        let seg = clean_segment(asked)?;
        let src = folder_arg(folder)?;
        let dest = match src.rsplit_once('/') {
            Some((parent, _)) => format!("{parent}/{seg}"),
            None => {
                refuse_root_name(&seg)?;
                seg.clone()
            }
        };
        let mut v = self.relocate_folder(&src, &dest, "rename")?;
        if let Some(n) = renamed_note(asked, &seg) {
            v["note"] = json!(n);
        }
        Ok(v)
    }

    /// Move a folder (with everything in it) into `into`; `""` or `Root` = top level.
    /// A missing destination is created (`created: true` in the result).
    pub fn move_folder_impl(&self, folder: &str, into: &str) -> MResult<Value> {
        let src = folder_arg(folder)?;
        let base = src.rsplit('/').next().unwrap_or(&src).to_string();
        let target = self.move_target(into)?;
        let dest = match &target {
            None => base,
            Some((parent, _)) => format!("{parent}/{base}"),
        };
        let mut v = self.relocate_folder(&src, &dest, "move")?;
        if let Some((_, Some(n))) = target {
            v["note"] = json!(n);
        }
        Ok(v)
    }

    /// Move everything inside `folder` (notes and sub folders) into `into` (`""` =
    /// top level), then remove the emptied folder. Name clashes get a `-N` suffix.
    /// When a move fails part way, what already moved stays moved and the error names
    /// the item that failed and lists the moved ones.
    pub fn move_folder_contents_impl(&self, folder: &str, into: &str) -> MResult<Value> {
        let (src, sdir) = self.folder_dir(folder)?;
        let target = self.move_target(into)?;
        let dest = target.as_ref().map(|t| t.0.clone()).unwrap_or_default();
        if dest == src || dest.starts_with(&format!("{src}/")) {
            return err("cannot move a folder's contents into itself");
        }
        let ddir = if dest.is_empty() {
            self.root().to_path_buf()
        } else {
            self.resolve(&dest)?
        };
        if !self.subtree_visible(&sdir) {
            return err(PROTECTED_INSIDE);
        }
        if let Some(f) = ddir.ancestors().find(|a| a.is_file()) {
            return err(format!("{} is a note, not a folder", self.rel_of(f)));
        }
        let created = !ddir.is_dir();
        fs::create_dir_all(&ddir).map_err(|e| MemoryErr(e.to_string()))?;
        let entries: Vec<PathBuf> = fs::read_dir(&sdir)
            .map_err(|e| MemoryErr(e.to_string()))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .collect();
        let before = self.all_note_paths();
        let mut moves: HashMap<String, String> = HashMap::new();
        let mut moved = Vec::new();
        let mut failed: Option<String> = None;
        for from in entries {
            let name = from
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.starts_with('.') {
                continue;
            }
            let mut to = ddir.join(&name);
            let (stem, ext) = match (from.is_file(), name.rsplit_once('.')) {
                (true, Some((s, e))) => (s.to_string(), format!(".{e}")),
                _ => (name.clone(), String::new()),
            };
            let mut i = 1;
            while to.exists() {
                to = ddir.join(format!("{stem}-{i}{ext}"));
                i += 1;
            }
            let old_rel = format!("{src}/{name}");
            let new_rel = self.rel_of(&to);
            if !self.visible(&new_rel) {
                failed = Some(format!("not found: {new_rel}"));
                break;
            }
            if let Err(e) = fs::rename(&from, &to) {
                failed = Some(format!("could not move {old_rel} to {new_rel}: {e}"));
                break;
            }
            self.path_event(PathEvent::Moved {
                from: old_rel.clone(),
                to: new_rel.clone(),
                carry: false,
            });
            if to.is_dir() {
                self.rekey_folder_meta(&old_rel, Some(&new_rel));
                let prefix = format!("{old_rel}/");
                for rel in &before {
                    if let Some(rest) = rel.strip_prefix(&prefix) {
                        moves.insert(rel.clone(), format!("{new_rel}/{rest}"));
                    }
                }
            } else {
                moves.insert(old_rel, new_rel.clone());
            }
            moved.push(new_rel);
        }
        let links = self.rewrite_moved_links(&before, &moves);
        let shown = if dest.is_empty() {
            "Root"
        } else {
            dest.as_str()
        };
        if let Some(why) = failed {
            let _ = self.reindex();
            if !moved.is_empty() {
                self.git_commit(&format!("move part of the contents of {src} -> {shown}"));
            }
            let done = if moved.is_empty() {
                "nothing was moved".to_string()
            } else {
                format!("already moved: {}", moved.join(", "))
            };
            return err(format!("{why}; {done}; the rest is still in {src}"));
        }
        // Only hidden leftovers (if any) remain; the folder itself goes.
        fs::remove_dir_all(&sdir).ok();
        self.path_event(PathEvent::Deleted { path: src.clone() });
        self.rekey_folder_meta(&src, None);
        let _ = self.reindex();
        self.git_commit(&format!("move contents of {src} -> {shown}"));
        let mut v = json!({
            "ok": true, "from": src, "to": shown, "moved": moved,
            "created": created, "links_updated": links,
        });
        if let Some((_, Some(n))) = target {
            v["note"] = json!(n);
        }
        Ok(v)
    }

    /// Delete a folder. Every note inside it moves up to the folder's parent (Root for a
    /// top-level folder), keeping the sub folder structure below it (`A/B/C/n.md` ->
    /// `A/C/n.md` when `A/B` is deleted); a clashing name gets a `-N` suffix. Other
    /// files in the folder are deleted with it.
    pub fn delete_folder_impl(&self, folder: &str) -> MResult<Value> {
        self.delete_folder_with(folder, None, None)
    }

    /// [`MemoryStore::delete_folder_impl`] with options. `into` moves the notes into
    /// that existing folder instead of the parent (`Root` = top level), still keeping
    /// the sub folder structure below the deleted folder. `trash` moves every note to
    /// `.Trash` instead (recorded in `.Trash/.index.json`, so `restore_trash` brings
    /// each back to where it was); `into` cannot be combined with it. `mode` is
    /// `move` (the default when `None` or empty) or `trash`.
    pub fn delete_folder_with(
        &self,
        folder: &str,
        into: Option<&str>,
        mode: Option<&str>,
    ) -> MResult<Value> {
        let trash = match mode.map(|m| m.trim().to_ascii_lowercase()).as_deref() {
            None | Some("") | Some("move") => false,
            Some("trash") => true,
            Some(other) => {
                return err(format!("mode must be move or trash, got {other}"));
            }
        };
        let folder = folder_arg(folder)?;
        if folder.is_empty() || folder == "Root" {
            return err("cannot delete Root");
        }
        if !self.visible(&folder) {
            return err(format!("folder not found: {folder}"));
        }
        let fdir = self.resolve(&folder)?;
        if !fdir.is_dir() {
            return err(format!("folder not found: {folder}"));
        }
        if !self.subtree_visible(&fdir) {
            return err(PROTECTED_INSIDE);
        }
        let into = into.map(str::trim).filter(|i| !i.is_empty());
        if trash && into.is_some() {
            return err("give either into (move the notes) or mode trash, not both");
        }
        let prefix = format!("{folder}/");
        let parent = match into {
            None => parent_folder(&folder).to_string(),
            Some(i) if is_root_alias(i) => String::new(),
            Some(i) => {
                let dest = folder_arg(i)?;
                if dest == folder || dest.starts_with(&prefix) {
                    return err(format!(
                        "into must be outside the folder being deleted ({folder})"
                    ));
                }
                // A hidden destination answers exactly like a missing one.
                let missing = || err(format!("destination folder not found: {dest}"));
                if !self.visible(&dest) {
                    return missing();
                }
                match self.resolve(&dest) {
                    Ok(d) if d.is_dir() => dest,
                    _ => return missing(),
                }
            }
        };
        let before = self.all_note_paths();
        let notes: Vec<String> = self
            .walk()
            .into_iter()
            .filter(|(rel, _, _)| rel.starts_with(&prefix))
            .map(|(rel, _, _)| rel)
            .collect();
        if trash {
            return self.trash_folder(&folder, &fdir, notes);
        }
        let base = folder.rsplit('/').next().unwrap_or(&folder);
        let mut moves: HashMap<String, String> = HashMap::new();
        let mut moved = Vec::new();
        let mut failed = Vec::new();
        for rel in notes {
            let mut rest = rel[prefix.len()..].to_string();
            // A sub folder named like the deleted one (`A/A/x.md`, `A` deleted, moving
            // to A's parent) would land back inside it: it becomes `A-1`.
            if parent == parent_folder(&folder) {
                if let Some(tail) = rest.strip_prefix(&format!("{base}/")) {
                    rest = format!("{base}-1/{tail}");
                }
            }
            let up = if parent.is_empty() {
                rest
            } else {
                format!("{parent}/{rest}")
            };
            let stem = up.strip_suffix(".md").unwrap_or(&up).to_string();
            let mut dap = self.resolve(&up)?;
            let mut i = 1;
            while dap.exists() {
                dap = self.resolve(&format!("{stem}-{i}.md"))?;
                i += 1;
            }
            let ok = dap.parent().is_some_and(|p| fs::create_dir_all(p).is_ok())
                && fs::rename(self.resolve(&rel)?, &dap).is_ok();
            if !ok {
                failed.push(rel);
                continue;
            }
            // Out of a deleted folder: the note keeps that folder's protection.
            self.path_event(PathEvent::Moved {
                from: rel.clone(),
                to: self.rel_of(&dap),
                carry: true,
            });
            moves.insert(rel, self.rel_of(&dap));
            moved.push(self.rel_of(&dap));
        }
        let shown = if parent.is_empty() {
            "Root"
        } else {
            parent.as_str()
        };
        if !failed.is_empty() {
            // Never delete notes that could not be moved out.
            self.rewrite_moved_links(&before, &moves);
            let _ = self.reindex();
            self.git_commit(&format!(
                "delete folder {folder}: moved {} notes",
                moved.len()
            ));
            return err(format!(
                "could not move {} out of {folder}, so the folder was kept; moved to {shown}: {}",
                failed.join(", "),
                if moved.is_empty() {
                    "nothing".to_string()
                } else {
                    moved.join(", ")
                }
            ));
        }
        fs::remove_dir_all(&fdir).ok();
        self.path_event(PathEvent::Deleted {
            path: folder.to_string(),
        });
        self.rekey_folder_meta(&folder, None);
        let links = self.rewrite_moved_links(&before, &moves);
        let _ = self.reindex();
        self.git_commit(&format!(
            "delete folder {folder} (moved {} notes to {shown})",
            moved.len()
        ));
        let mut v = json!({
            "ok": true, "deleted_folder": folder, "moved_to": shown,
            "moved": moved, "links_updated": links,
        });
        // The name older clients read; only true when the notes went to Root.
        if parent.is_empty() {
            v["moved_to_root"] = v["moved"].clone();
        }
        Ok(v)
    }

    /// Delete-folder in trash mode: every note goes to `.Trash` (remembering its
    /// path), then the folder and its other files are removed. When a note cannot be
    /// trashed the folder is kept and the error lists what already went.
    fn trash_folder(&self, folder: &str, fdir: &Path, notes: Vec<String>) -> MResult<Value> {
        let mut trashed = Vec::new();
        let mut failed = None;
        for rel in notes {
            match self.move_to_trash(&rel) {
                Ok(to) => trashed.push(json!({"path": rel, "to": to})),
                Err(e) => {
                    failed = Some(format!("{rel}: {}", e.0));
                    break;
                }
            }
        }
        if let Some(why) = failed {
            let _ = self.reindex();
            if !trashed.is_empty() {
                self.git_commit(&format!(
                    "delete folder {folder}: {} notes moved to .Trash",
                    trashed.len()
                ));
            }
            return err(format!(
                "could not move {why} to the trash, so the folder was kept; already in the trash: {}",
                if trashed.is_empty() {
                    "nothing".to_string()
                } else {
                    trashed
                        .iter()
                        .filter_map(|t| t["path"].as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                }
            ));
        }
        fs::remove_dir_all(fdir).ok();
        self.path_event(PathEvent::Deleted {
            path: folder.to_string(),
        });
        self.rekey_folder_meta(folder, None);
        let _ = self.reindex();
        self.git_commit(&format!(
            "delete folder {folder} ({} notes moved to .Trash)",
            trashed.len()
        ));
        Ok(json!({
            "ok": true, "deleted_folder": folder, "mode": "trash",
            "count": trashed.len(), "trashed": trashed,
            "note": "the notes are in .Trash: list_trash shows them, restore_trash brings one back",
        }))
    }

    pub fn duplicate_memory_impl(&self, path: &str) -> MResult<String> {
        let path = norm_note_path(path);
        let ap = self.resolve(&path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        // Keep the suffix inside the 80-character file name limit.
        const SUFFIX: &str = "-copy";
        let base: String = Self::base_name(&path)
            .chars()
            .take(80 - SUFFIX.len())
            .collect();
        let content = self.read_raw(&ap).unwrap_or_default();
        self.create_impl(
            &format!("{base}{SUFFIX}"),
            parent_folder(&path),
            Some(&content),
        )
    }

    /// Create every note of `notes` (`{title, content?, folder?}`; `folder`
    /// defaults to `Memory` like `create_memory`). Items are checked first and
    /// nothing is created when one is malformed; then each note is created on its
    /// own and the reply has one result per item.
    pub fn batch_create_impl(&self, notes: &[Value]) -> MResult<Vec<Value>> {
        const KEYS: [&str; 3] = ["title", "content", "folder"];
        if notes.is_empty() {
            return err("notes is required: a list of {title, content, folder} objects");
        }
        let mut problems = Vec::new();
        for (i, n) in notes.iter().enumerate() {
            let k = i + 1;
            let Some(o) = n.as_object() else {
                problems.push(format!(
                    "item {k}: must be an object {{title, content, folder}}"
                ));
                continue;
            };
            for key in o.keys().filter(|key| !KEYS.contains(&key.as_str())) {
                problems.push(format!(
                    "item {k}: unknown key `{key}` (allowed: title, content, folder)"
                ));
            }
            match o.get("title") {
                Some(Value::String(t)) if !t.trim().is_empty() => {
                    if let Err(e) = note_filename(t) {
                        problems.push(format!("item {k}: {e}"));
                    }
                }
                None | Some(Value::Null) | Some(Value::String(_)) => {
                    problems.push(format!("item {k}: title is required"))
                }
                Some(_) => problems.push(format!("item {k}: title must be a string")),
            }
            for key in ["content", "folder"] {
                match o.get(key) {
                    None | Some(Value::Null) | Some(Value::String(_)) => {}
                    Some(_) => problems.push(format!("item {k}: {key} must be a string")),
                }
            }
            if let Some(Value::String(f)) = o.get("folder") {
                if let Err(e) = self.dest_folder(f) {
                    problems.push(format!("item {k}: {e}"));
                }
            }
        }
        if !problems.is_empty() {
            return err(format!(
                "nothing was created; fix these items: {}",
                problems.join("; ")
            ));
        }
        let mut out = Vec::new();
        for (i, n) in notes.iter().enumerate() {
            let title = n.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let folder = match n.get("folder").and_then(|v| v.as_str()) {
                Some(f) if !f.trim().is_empty() => f,
                _ => "Memory",
            };
            let content = n.get("content").and_then(|v| v.as_str());
            match self.create_impl(title, folder, content) {
                Ok(rel) => {
                    let mut r = json!({"ok": true, "path": rel});
                    if let Some((from, note)) = title_notice(title, &rel) {
                        r["renamed_from"] = json!(from);
                        r["note"] = json!(note);
                    }
                    out.push(r);
                }
                Err(e) => {
                    out.push(json!({"ok": false, "item": i + 1, "title": title, "error": e.0}))
                }
            }
        }
        Ok(out)
    }

    /// A note path as the other tools take it: `.md` may be left out. A folder (or
    /// another existing file) keeps its name, so the caller can say what it is.
    fn md_path_or_folder(&self, path: &str) -> String {
        let p = path.trim();
        if p.to_lowercase().ends_with(".md") || self.resolve(p).is_ok_and(|ap| ap.exists()) {
            return p.to_string();
        }
        format!("{p}.md")
    }

    /// The `folder` filter of the bulk tools: the folder and every subfolder below
    /// it (`None` = the whole vault, `Some("")` = notes at the top level, `Root`).
    fn bulk_folder(&self, folder: Option<&str>) -> MResult<Option<String>> {
        let Some(f) = folder else { return Ok(None) };
        let f = f.trim().replace('\\', "/");
        let f = f.trim_matches('/');
        if f.is_empty() {
            return Ok(None);
        }
        if f == "Root" {
            return Ok(Some(String::new()));
        }
        // A hidden folder answers exactly like a missing one.
        match self.resolve(f) {
            Ok(dir) if dir.is_dir() && !f.starts_with(".Trash") => Ok(Some(f.to_string())),
            Ok(_) => err(format!("folder not found: {f}")),
            Err(e) if e.0.starts_with("not found") => err(format!("folder not found: {f}")),
            Err(e) => Err(e),
        }
    }

    fn in_bulk_folder(rel: &str, folder: &Option<String>) -> bool {
        match folder {
            None => true,
            Some(f) if f.is_empty() => !rel.contains('/'),
            Some(f) => rel.starts_with(&format!("{f}/")),
        }
    }

    pub fn bulk_replace_impl(
        &self,
        find: &str,
        replace: &str,
        folder: Option<&str>,
        regex: bool,
        dry_run: bool,
    ) -> MResult<Value> {
        if find.is_empty() {
            return err(
                "find is required: an empty find would insert the replacement between every character",
            );
        }
        let pat = if regex {
            let p = Regex::new(find)
                .map_err(|e| MemoryErr(format!("find is not a valid regex: {e}")))?;
            if p.is_match("") {
                return err("find matches the empty string, which would insert the replacement between every character; make the pattern match at least one character (e.g. `a+` instead of `a*`)");
            }
            replace_groups_ok(&p, replace)?;
            Some(p)
        } else {
            None
        };
        let folder = self.bulk_folder(folder)?;
        // Every edit is worked out before anything is written.
        let mut edits = Vec::new();
        let mut held = 0usize;
        for (rel, _name, fp) in self.walk() {
            if !Self::in_bulk_folder(&rel, &folder) {
                continue;
            }
            let Some(c) = self.read_raw(&fp) else {
                continue;
            };
            let nc = match &pat {
                Some(p) => {
                    // `\b` or `(?m)^` match nowhere in "" but between characters elsewhere.
                    if p.find_iter(&c).any(|m| m.as_str().is_empty()) {
                        return err(format!("find matches an empty string (in {rel}), which would insert the replacement between characters; make the pattern match at least one character"));
                    }
                    replaced_size_ok(regex_replaced_len_bound(p, &c, replace), &rel)?;
                    p.replace_all(&c, replace).to_string()
                }
                None => {
                    replaced_size_ok(literal_replaced_len(&c, find, replace), &rel)?;
                    c.replace(find, replace)
                }
            };
            if nc != c {
                held = held.saturating_add(nc.len());
                if held > MAX_REPLACED_TOTAL {
                    return err(format!(
                        "the replacement would rewrite more than {} MiB of notes at once; narrow it with `folder` or a more specific find",
                        MAX_REPLACED_TOTAL / (1024 * 1024)
                    ));
                }
                edits.push((rel, nc));
            }
        }
        edits.sort_by(|a, b| a.0.cmp(&b.0));
        let changed: Vec<String> = edits.iter().map(|(rel, _)| rel.clone()).collect();
        if !dry_run {
            for (rel, nc) in edits {
                fs::write(self.resolve(&rel)?, nc).ok();
            }
        }
        if !changed.is_empty() && !dry_run {
            let _ = self.reindex();
            self.git_commit(&format!("bulk replace ({} notes)", changed.len()));
        }
        Ok(json!({"ok": true, "count": changed.len(), "changed": changed, "dry_run": dry_run}))
    }

    /// Why a path given to `bulk_delete` cannot go to the trash (`Err`), or the
    /// note's vault path (`Ok`).
    fn bulk_delete_target(&self, path: &str) -> Result<String, String> {
        if path.trim().is_empty() {
            return Err("empty path".into());
        }
        let rel = self.md_path_or_folder(path);
        let ap = match self.resolve(&rel) {
            Ok(ap) => ap,
            Err(e) if e.0.starts_with("not found") => return Err("not found".into()),
            Err(e) if e.0.starts_with("path escapes") => return Err("outside the vault".into()),
            Err(e) => return Err(e.0),
        };
        if ap.is_dir() {
            return Err("a folder; use delete_folder".into());
        }
        if !ap.is_file() {
            return Err("not found".into());
        }
        let rel = self.rel_of(&ap);
        if rel.starts_with(".Trash/") {
            return Err("already in the trash".into());
        }
        if !rel.to_lowercase().ends_with(".md") {
            return Err("not a note".into());
        }
        Ok(rel)
    }

    /// Move notes to `.Trash` (like `soft_delete`), by path list and / or folder.
    /// Every listed path is checked first: one bad path refuses the whole call.
    pub fn bulk_delete_impl(
        &self,
        paths: Option<&[Value]>,
        folder: Option<&str>,
    ) -> MResult<Value> {
        let paths = paths.unwrap_or(&[]);
        let by_folder = folder.is_some_and(|f| !f.trim().is_empty());
        if paths.is_empty() && !by_folder {
            return err("give `paths` (a list of notes) or `folder`");
        }
        let mut targets: BTreeSet<String> = BTreeSet::new();
        let mut bad = Vec::new();
        for (i, p) in paths.iter().enumerate() {
            let Some(s) = p.as_str() else {
                return err(format!("paths[{i}] must be a string, got {p}"));
            };
            match self.bulk_delete_target(s) {
                Ok(rel) => {
                    targets.insert(rel);
                }
                Err(why) => bad.push(format!("{s} ({why})")),
            }
        }
        if !bad.is_empty() {
            return err(format!(
                "nothing was deleted; fix or drop these paths: {}",
                bad.join(", ")
            ));
        }
        if by_folder {
            let folder = self.bulk_folder(folder)?;
            for (rel, _, _) in self.walk() {
                if Self::in_bulk_folder(&rel, &folder) {
                    targets.insert(rel);
                }
            }
        }
        let mut deleted = Vec::new();
        let mut trashed = Vec::new();
        for rel in targets {
            let to = self.move_to_trash(&rel)?;
            trashed.push(json!({"path": rel, "to": to}));
            deleted.push(rel);
        }
        if !deleted.is_empty() {
            let _ = self.reindex();
            self.git_commit(&format!(
                "bulk delete ({} notes moved to .Trash)",
                deleted.len()
            ));
        }
        Ok(
            json!({"ok": true, "count": deleted.len(), "deleted": deleted, "trashed": trashed,
                  "note": "moved to .Trash: list_trash shows them, restore_trash brings one back"}),
        )
    }

    /// Append the bodies of the notes `paths` (frontmatter stripped) to the note
    /// `into`, each under a `## from <name>` heading, and add their frontmatter
    /// tags to it. `into` is created when missing; the sources are kept.
    pub fn merge_memory_impl(&self, paths: &[Value], into: &str) -> MResult<Value> {
        if is_absolute_input(into) {
            return err(format!(
                "into must be a note path relative to the vault (got `{into}`)"
            ));
        }
        let mut into = norm_note_path(into);
        if into.is_empty() {
            return err("into is required: the note to merge into, e.g. `Notes/All.md`");
        }
        let has_md = into.len() > 3
            && into.is_char_boundary(into.len() - 3)
            && into[into.len() - 3..].eq_ignore_ascii_case(".md");
        if self.resolve(&into)?.is_dir() {
            return err(format!(
                "into `{into}` is a folder; give a note path such as `{into}/Merged.md`"
            ));
        }
        if !has_md {
            into.push_str(".md");
        }
        let dst = self.resolve(&into)?;
        if dst.is_dir() {
            return err(format!("into `{into}` is a folder, not a note"));
        }
        if paths.is_empty() {
            return err("paths is required: the notes to merge into `into`");
        }
        // Every source must be an existing note, named once, and not the target.
        let mut sources: Vec<(String, PathBuf)> = Vec::new();
        let mut missing = Vec::new();
        for p in paths {
            let Some(ps) = p.as_str() else {
                return err(format!("paths must be note paths (strings); got {p}"));
            };
            let ps = norm_note_path(ps);
            if ps.is_empty() {
                return err("paths contains an empty path");
            }
            let ap = match self.resolve(&ps) {
                Ok(ap) => ap,
                Err(e) if e.0.starts_with("not found") => {
                    missing.push(ps);
                    continue;
                }
                Err(e) => return Err(e),
            };
            if ap.is_dir() {
                return err(format!("`{ps}` is a folder, not a note"));
            }
            if !ap.is_file() {
                missing.push(ps);
                continue;
            }
            if ap == dst {
                return err(format!(
                    "`{ps}` is the target; a note cannot be merged into itself"
                ));
            }
            if sources.iter().any(|(_, a)| *a == ap) {
                return err(format!("`{ps}` is listed more than once"));
            }
            sources.push((ps, ap));
        }
        if !missing.is_empty() {
            return err(format!(
                "not found: {} (nothing was merged)",
                missing.join(", ")
            ));
        }
        let mut body = String::new();
        let mut tags: Vec<String> = Vec::new();
        for (ps, ap) in &sources {
            let raw = self.read_raw(ap).unwrap_or_default();
            let (fm, text) = if frontmatter_problem(&raw).is_none() {
                split_frontmatter(&raw)
            } else {
                (String::new(), raw.clone())
            };
            for t in FmLines::parse(&fm).list("tags") {
                let t = t
                    .trim_matches(['"', '\''])
                    .trim_start_matches('#')
                    .to_string();
                if !t.is_empty() && !tags.contains(&t) {
                    tags.push(t);
                }
            }
            body.push_str(&format!(
                "\n\n## from {}\n\n{}",
                Self::base_name(ps),
                text.trim_matches('\n')
            ));
        }
        let created = !dst.is_file();
        let into = if created {
            self.create_impl(
                &Self::base_name(&into),
                parent_folder(&into),
                Some(body.trim_start_matches('\n')),
            )?
        } else {
            let cur = self.read_raw(&dst).unwrap_or_default();
            self.save_impl(&into, &format!("{}{body}\n", cur.trim_end_matches('\n')))?;
            into
        };
        if !tags.is_empty() {
            let ops: Vec<Value> = tags
                .iter()
                .map(|t| json!({"op": "add_tag", "tag": t}))
                .collect();
            self.patch_memory_impl(&into, &ops)?;
        }
        let merged: Vec<&str> = sources.iter().map(|(p, _)| p.as_str()).collect();
        Ok(json!({
            "ok": true, "into": into, "created": created, "merged": merged.len(),
            "sources": merged, "tags_added": tags,
            "note": "the source notes are kept; delete them if you no longer need them",
        }))
    }

    /// Create a note from a template in `Templates/` (`Meeting`, `Meeting.md` or
    /// `Templates/Meeting.md`). `{{name}}` placeholders take `variables`;
    /// `{{title}}` (the note title) and `{{date}}` (today, `YYYY-MM-DD`) are
    /// built in unless given.
    pub fn template_create_impl(
        &self,
        template: &str,
        title: &str,
        folder: &str,
        variables: Option<&Map<String, Value>>,
    ) -> MResult<String> {
        let t = template.trim().replace('\\', "/");
        if t.is_empty() {
            return err("template is required: the name of a note in Templates/, e.g. `Meeting`");
        }
        if is_absolute_input(&t) {
            return err(format!(
                "template must be the name of a note in Templates/ (e.g. `Meeting`), not `{template}`"
            ));
        }
        let t = t.strip_prefix("Templates/").unwrap_or(&t);
        let has_md = t.len() > 3
            && t.is_char_boundary(t.len() - 3)
            && t[t.len() - 3..].eq_ignore_ascii_case(".md");
        let rel = if has_md {
            format!("Templates/{t}")
        } else {
            format!("Templates/{t}.md")
        };
        // A template hidden from the caller answers exactly like a missing one.
        let missing = || {
            MemoryErr(format!(
                "template not found: {template} (templates are notes in Templates/)"
            ))
        };
        let tap = match self.resolve(&rel) {
            Ok(p) => p,
            Err(e) if e.0.starts_with("not found") => return Err(missing()),
            Err(e) => return Err(e),
        };
        if !tap.is_file() {
            return Err(missing());
        }
        let name = note_filename(title)?;
        let mut vars: Map<String, Value> = variables.cloned().unwrap_or_default();
        vars.entry("title").or_insert_with(|| json!(name.title));
        vars.entry("date")
            .or_insert_with(|| json!(chrono::Local::now().format("%Y-%m-%d").to_string()));
        let mut content = self.read_raw(&tap).unwrap_or_default();
        for (k, v) in &vars {
            let val = match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            let slot = format!("{{{{{k}}}}}");
            replaced_size_ok(literal_replaced_len(&content, &slot, &val), title)?;
            content = content.replace(&slot, &val);
        }
        self.create_impl(title, folder, Some(&content))
    }

    /// Tag the last commit as `snap-<label>`, after committing what is not yet
    /// committed, so the snapshot holds the vault as it is now.
    pub fn snapshot_impl(&self, label: &str) -> MResult<Value> {
        self.history_on()?;
        let label = label.split_whitespace().collect::<Vec<_>>().join("-");
        if label.is_empty() {
            return err(
                "label is required (letters, digits, '.', '_' or '-', at most 40 characters)",
            );
        }
        let n = label.chars().count();
        if n > 40 {
            return err(format!(
                "label is too long ({n} characters); use at most 40"
            ));
        }
        if let Some(c) = label
            .chars()
            .find(|c| !(c.is_alphanumeric() || matches!(c, '.' | '_' | '-')))
        {
            return err(format!(
                "label may only use letters, digits, '.', '_' and '-' (spaces become '-'), not {c:?}"
            ));
        }
        let tag = format!("snap-{label}");
        if label.contains("..")
            || label.ends_with('.')
            || label.ends_with(".lock")
            || !self
                .git(&["check-ref-format", &format!("refs/tags/{tag}")])
                .0
        {
            return err(format!(
                "label {label} is not a valid git tag name (no '..', and no '.' or '.lock' at the end)"
            ));
        }
        if self
            .git(&[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/tags/{tag}"),
            ])
            .0
        {
            return err(format!(
                "snapshot {label} already exists (tag {tag}); choose another label"
            ));
        }
        self.git_commit(&format!("snapshot: {label}"));
        let (ok, head) = self.git(&["rev-parse", "--short", "--verify", "--quiet", "HEAD"]);
        if !ok {
            return err("nothing to snapshot yet: the vault repository has no commits");
        }
        let (ok, _, stderr) = self.git_run(&["tag", &tag], &[]);
        if !ok {
            return err(format!("could not create tag {tag}: {}", stderr.trim()));
        }
        Ok(json!({"ok": true, "tag": tag, "rev": head.trim(),
                  "hint": format!("pass \"{tag}\" as rev to get_note_at, diff or restore_memory")}))
    }

    // ---- trash ----
    /// `.Trash/.index.json`: trash file name -> `{path, deleted}` (where the note
    /// lived and when it was trashed), so a restore puts it back where it was.
    fn trash_index_path(&self) -> PathBuf {
        self.root().join(".Trash").join(".index.json")
    }

    /// Where the trash entry `rel` (`.Trash/<name>` in any spelling) was deleted
    /// from, per the trash index; `None` for any other path.
    pub(crate) fn trash_original(&self, rel: &str) -> Option<String> {
        let rel = rel.replace('\\', "/");
        let mut segs = rel.split('/').filter(|s| !s.is_empty() && *s != ".");
        if segs.next()? != ".Trash" {
            return None;
        }
        let name = segs.next()?;
        self.trash_index()
            .get(name)
            .and_then(|m| m.get("path"))
            .and_then(|v| v.as_str())
            .map(String::from)
    }

    fn trash_index(&self) -> Map<String, Value> {
        fs::read_to_string(self.trash_index_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_trash_index(&self, index: &Map<String, Value>) {
        let p = self.trash_index_path();
        if let Some(dir) = p.parent() {
            fs::create_dir_all(dir).ok();
        }
        if let Ok(s) = serde_json::to_string_pretty(index) {
            fs::write(p, s).ok();
        }
    }

    /// Move one checked note into `.Trash` under a free name and remember where it
    /// came from. No reindex, no commit (the caller does both once).
    fn move_to_trash(&self, rel: &str) -> MResult<String> {
        let ap = self.resolve(rel)?;
        let base = Path::new(rel)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let mut dap = self.resolve(&format!(".Trash/{base}"))?;
        if let Some(p) = dap.parent() {
            fs::create_dir_all(p).ok();
        }
        let mut i = 1;
        while dap.exists() {
            let stem = Path::new(&base)
                .file_stem()
                .unwrap()
                .to_string_lossy()
                .to_string();
            let ext = Path::new(&base)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            dap = self.resolve(&format!(".Trash/{stem}-{i}.{ext}"))?;
            i += 1;
        }
        fs::rename(&ap, &dap).map_err(|e| MemoryErr(e.to_string()))?;
        let to = self.rel_of(&dap);
        // In the trash the note keeps the protection of the folder it left.
        self.path_event(PathEvent::Moved {
            from: rel.to_string(),
            to: to.clone(),
            carry: true,
        });
        let mut index = self.trash_index();
        let name = to.trim_start_matches(".Trash/").to_string();
        index.insert(name, json!({"path": rel, "deleted": now_iso()}));
        self.save_trash_index(&index);
        Ok(to)
    }

    pub fn soft_delete_impl(&self, path: &str) -> MResult<Value> {
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let rel = self.rel_of(&ap);
        if rel.starts_with(".Trash/") {
            return err(format!("already in the trash: {path}"));
        }
        let to = self.move_to_trash(&rel)?;
        let _ = self.reindex();
        self.git_commit(&format!("trash: {rel} -> {to}"));
        Ok(json!({"ok": true, "trashed": path, "to": to}))
    }

    /// Notes in `.Trash` the caller may see: `{name, path, original, deleted}`,
    /// newest first. `original` / `deleted` are null for notes trashed before the
    /// trash remembered them.
    pub fn list_trash_impl(&self) -> Vec<Value> {
        let index = self.trash_index();
        let mut out: Vec<Value> = Vec::new();
        let Ok(dir) = fs::read_dir(self.root().join(".Trash")) else {
            return out;
        };
        for entry in dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || !entry.path().is_file() {
                continue;
            }
            let path = format!(".Trash/{name}");
            let meta = index.get(&name);
            let original = meta.and_then(|m| m.get("path")).and_then(|v| v.as_str());
            if !self.view_visible(&path) || original.is_some_and(|o| !self.visible(o)) {
                continue;
            }
            let deleted = meta.and_then(|m| m.get("deleted")).cloned();
            out.push(json!({"name": name, "path": path, "original": original,
                            "deleted": deleted.unwrap_or(Value::Null)}));
        }
        out.sort_by(|a, b| {
            let d = |v: &Value| v["deleted"].as_str().unwrap_or("").to_string();
            d(b).cmp(&d(a))
                .then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
        });
        out
    }

    /// Bring a note back from `.Trash`: to the path it was trashed from (under its
    /// original name), or into the folder `into` (`Root` = the top level).
    pub fn restore_trash_impl(&self, name: &str, into: &str) -> MResult<Value> {
        let raw = name.trim().replace('\\', "/");
        let raw = raw.trim_start_matches('/');
        let base = raw.strip_prefix(".Trash/").unwrap_or(raw);
        if base.is_empty() || base.contains('/') || base.starts_with('.') {
            return err(format!(
                "give the name of a note in the trash as list_trash shows it (e.g. Plan.md), not {name}"
            ));
        }
        let not_in = || {
            err(format!(
                "not in trash: {base} (list_trash shows what is there)"
            ))
        };
        // `.md` may be left out.
        let mut base = base.to_string();
        let mut found = None;
        for cand in [base.clone(), format!("{base}.md")] {
            // A hidden trash entry answers exactly like a missing one.
            match self.resolve(&format!(".Trash/{cand}")) {
                Ok(p) if p.is_file() => {
                    found = Some(p);
                    base = cand;
                    break;
                }
                Ok(_) => {}
                Err(e) if e.0.starts_with("not found") => {}
                Err(e) => return Err(e),
            }
            if base.to_lowercase().ends_with(".md") {
                break;
            }
        }
        let Some(tap) = found else { return not_in() };
        let rel = format!(".Trash/{base}");
        let mut index = self.trash_index();
        let original = index
            .get(&base)
            .and_then(|m| m.get("path"))
            .and_then(|v| v.as_str())
            .map(String::from);
        let file = original
            .as_deref()
            .and_then(|o| o.rsplit('/').next())
            .unwrap_or(&base)
            .to_string();
        // `into` is a folder like any move destination: checked and cleaned the
        // same way (no `.`/`..`, no reserved or hidden names).
        let into = into.trim();
        let folder = if into.trim_matches('/').is_empty() {
            None
        } else {
            Some(self.move_target(into)?.map(|(f, _)| f).unwrap_or_default())
        };
        let dest = match (folder, &original) {
            (None, Some(o)) => o.clone(),
            (None, None) => file,
            (Some(f), _) if f.is_empty() => file,
            (Some(f), _) => format!("{f}/{file}"),
        };
        let dap = self.resolve(&dest)?;
        if dap.exists() {
            return err(if into.is_empty() {
                format!("already exists: {dest}; pass `into` to restore it into another folder")
            } else {
                format!("already exists: {dest}; pass another `into` folder")
            });
        }
        if let Some(p) = dap.parent() {
            fs::create_dir_all(p).ok();
        }
        fs::rename(&tap, &dap).map_err(|e| MemoryErr(e.to_string()))?;
        self.path_event(PathEvent::Moved {
            from: rel.clone(),
            to: dest.clone(),
            carry: false,
        });
        if index.remove(&base).is_some() {
            self.save_trash_index(&index);
        }
        let _ = self.reindex();
        self.git_commit(&format!("restore from trash: {rel} -> {dest}"));
        Ok(json!({"ok": true, "restored": dest, "path": dest, "from": rel}))
    }
}

// ---------------------------------------------------------------------------
// Git time machine
// ---------------------------------------------------------------------------

/// What the versioning tools answer while the vault is not a git repository.
pub const HISTORY_OFF: &str = "version history is off: the vault is not a git repository; \
     run `git init` in the vault folder to turn it on (see docs/CONFIGURATION.md, \"Version history\")";

thread_local! {
    static COMMIT_AUTHOR: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

/// While alive, vault commits made on this thread name `name` (the calling agent)
/// as their author. The previous author comes back when it drops.
pub struct CommitAuthor(Option<String>);

impl CommitAuthor {
    pub fn set(name: &str) -> Self {
        let clean: String = name
            .chars()
            .filter(|c| !c.is_control() && !matches!(c, '<' | '>'))
            .collect();
        let clean = clean.trim();
        let next = (!clean.is_empty()).then(|| clean.to_string());
        CommitAuthor(COMMIT_AUTHOR.with(|a| a.replace(next)))
    }
}

impl Drop for CommitAuthor {
    fn drop(&mut self) {
        let prev = self.0.take();
        COMMIT_AUTHOR.with(|a| *a.borrow_mut() = prev);
    }
}

/// One commit of a note's history (see [`MemoryStore::note_log`]).
struct LogEntry {
    id: String,
    short: String,
    date: String,
    author: String,
    subject: String,
    /// The note's path in this commit (differs from today's after a rename).
    path: String,
}

impl MemoryStore {
    /// Run git in the vault, returning `(success, stdout, stderr)`. Only a vault that is its own
    /// repository (has `.git`) is versioned: git must never climb into an enclosing repository.
    fn git_run(&self, args: &[&str], envs: &[(&str, String)]) -> (bool, String, String) {
        let root = self.root();
        if !self.history_enabled() {
            return (false, String::new(), String::new());
        }
        let mut cmd = Command::new("git");
        if let Some(parent) = root.parent() {
            cmd.env("GIT_CEILING_DIRECTORIES", parent);
        }
        for (k, v) in envs {
            cmd.env(k, v);
        }
        match cmd
            .args(["-c", "core.quotePath=false"])
            .args(args)
            .current_dir(root)
            .output()
        {
            Ok(o) => (
                o.status.success(),
                String::from_utf8_lossy(&o.stdout).to_string(),
                String::from_utf8_lossy(&o.stderr).to_string(),
            ),
            Err(_) => (false, String::new(), String::new()),
        }
    }

    /// Run git in the vault, returning `(success, stdout)` (see [`MemoryStore::git_run`]).
    pub fn git(&self, args: &[&str]) -> (bool, String) {
        let (ok, out, _) = self.git_run(args, &[]);
        (ok, out)
    }

    /// Whether the vault keeps a history (it is a git repository of its own).
    pub fn history_enabled(&self) -> bool {
        self.root().join(".git").exists()
    }

    fn history_on(&self) -> MResult<()> {
        if self.history_enabled() {
            Ok(())
        } else {
            err(HISTORY_OFF)
        }
    }

    /// Commit everything, authored by the [`CommitAuthor`] of this call when set.
    pub fn git_commit(&self, message: &str) {
        if !self.history_enabled() {
            return;
        }
        self.git(&["add", "-A"]);
        let mut args: Vec<&str> = Vec::new();
        // git refuses to commit without an identity; a fresh `git init` has none.
        if !self.git(&["config", "user.email"]).0 {
            args.extend([
                "-c",
                "user.name=Memora",
                "-c",
                "user.email=memora@localhost",
            ]);
        }
        args.extend(["commit", "-q", "-m", message]);
        let envs: Vec<(&str, String)> = COMMIT_AUTHOR
            .with(|a| a.borrow().clone())
            .map(|n| vec![("GIT_AUTHOR_NAME", n)])
            .unwrap_or_default();
        let _ = self.git_run(&args, &envs);
    }

    /// For a restricted caller, git history is only available for one visible note
    /// path (never a folder, the whole vault or a pathspec pattern).
    fn history_path_ok(&self, path: &str) -> bool {
        if !self.restricted() {
            return true;
        }
        let p = path.trim();
        !p.is_empty()
            && p.to_lowercase().ends_with(".md")
            && !p.starts_with(':')
            && !p.contains(['*', '?', '[', ']'])
            && !p.split(['/', '\\']).any(|seg| seg == "..")
            && self.visible(p)
            // A former path of a hidden note (renamed or moved into a hidden
            // folder) is not hidden itself, but its history holds what was
            // written there, so it stays out of reach like the note.
            && !self.mentions_hidden(p)
            && self.resolve(p).is_ok_and(|ap| !ap.is_dir())
    }

    /// A revision argument: never an option, never a `rev:path` lookup.
    fn rev_ok(rev: &str) -> bool {
        !rev.starts_with('-')
            && !rev.contains(':')
            && !rev.chars().any(|c| c.is_control() || c.is_whitespace())
    }

    /// Resolve one revision to its full commit id, with a clear refusal otherwise.
    fn resolve_rev(&self, rev: &str) -> MResult<String> {
        let rev = rev.trim();
        if rev.is_empty() {
            return err("rev is required: a revision from get_history, a snapshot tag (snap-<label>), HEAD~1, or HEAD@{<date>}");
        }
        if rev.contains("..") {
            return err(format!("give one revision, not a range: {rev}"));
        }
        let unknown = || {
            err(format!(
                "unknown revision {rev}; use get_history to list revisions"
            ))
        };
        if !Self::rev_ok(rev) {
            return unknown();
        }
        let (ok, out, stderr) = self.git_run(
            &["rev-parse", "--verify", &format!("{rev}^{{commit}}")],
            &[],
        );
        if !ok || out.trim().is_empty() {
            return unknown();
        }
        // `@{<date>}` before the first entry quietly answers the oldest one.
        if rev.contains("@{") && stderr.contains("only goes back to") {
            return err(format!("no revision at or before that date: {rev}"));
        }
        Ok(out.trim().to_string())
    }

    /// Validate the `path` of a versioning call: required, `.md` optional, and
    /// either in the vault now or in its history (a hidden path is "not found").
    fn history_target(&self, path: &str) -> MResult<String> {
        if path.trim().is_empty() {
            return err("path is required");
        }
        self.history_on()?;
        let p = self.md_path_or_folder(path);
        let exists = self.resolve(&p).is_ok_and(|ap| ap.exists());
        if !self.history_path_ok(&p) || (!exists && self.note_log(&p, Some(1)).is_empty()) {
            return err(format!("not found: {}", path.trim()));
        }
        Ok(p)
    }

    /// Commits touching `path`, newest first. A single note's history follows
    /// renames (`git log --follow`).
    fn note_log(&self, path: &str, limit: Option<usize>) -> Vec<LogEntry> {
        let n = limit.map(|l| format!("-{l}"));
        let mut args = vec!["--literal-pathspecs", "log"];
        let follow = path.to_lowercase().ends_with(".md");
        if follow {
            args.extend(["--follow", "--name-only"]);
        }
        if let Some(n) = &n {
            args.push(n);
        }
        args.extend(["--format=%x1e%H|%h|%ai|%an|%s", "--", path]);
        let (ok, out) = self.git(&args);
        if !ok {
            return Vec::new();
        }
        out.split('\x1e')
            .filter_map(|rec| {
                let mut lines = rec.lines();
                let p: Vec<&str> = lines.next()?.splitn(5, '|').collect();
                if p.len() != 5 {
                    return None;
                }
                let name = if follow {
                    lines.map(str::trim).find(|l| !l.is_empty()).unwrap_or(path)
                } else {
                    path
                };
                Some(LogEntry {
                    id: p[0].into(),
                    short: p[1].into(),
                    date: p[2].into(),
                    author: p[3].into(),
                    subject: p[4].into(),
                    path: name.into(),
                })
            })
            .collect()
    }

    pub fn get_history_impl(&self, path: &str, limit: usize) -> MResult<Vec<Value>> {
        if limit < 1 {
            return err("limit must be at least 1");
        }
        let p = self.history_target(path)?;
        Ok(self
            .note_log(&p, Some(limit))
            .into_iter()
            .map(|e| {
                // Commit messages name paths; hide those naming hidden ones.
                let msg = if self.mentions_hidden(&e.subject) {
                    "(hidden)"
                } else {
                    e.subject.as_str()
                };
                let mut v =
                    json!({"rev": e.short, "date": e.date, "author": e.author, "message": msg});
                if e.path != p && self.visible(&e.path) {
                    v["path"] = json!(e.path);
                }
                v
            })
            .collect())
    }

    /// The path `path` had at commit `id`, following renames (None: not there).
    fn path_at(&self, path: &str, id: &str) -> Option<String> {
        let log = self.note_log(path, None);
        if log.is_empty() {
            return None;
        }
        let (ok, out) = self.git(&["rev-list", id]);
        if !ok {
            return None;
        }
        let ancestors: HashSet<&str> = out.lines().collect();
        log.into_iter()
            .find(|e| ancestors.contains(e.id.as_str()))
            .map(|e| e.path)
    }

    /// A note's content at commit `id`, under the name it had then.
    fn content_at(&self, path: &str, id: &str, rev: &str) -> MResult<String> {
        let (ok, out) = self.git(&["show", &format!("{id}:{path}")]);
        if ok {
            return Ok(out);
        }
        if let Some(old) = self.path_at(path, id) {
            if old != path && self.visible(&old) {
                let (ok, out) = self.git(&["show", &format!("{id}:{old}")]);
                if ok {
                    return Ok(out);
                }
            }
        }
        err(format!(
            "{path} did not exist at {rev}; use get_history to list its revisions"
        ))
    }

    pub fn get_note_at_impl(&self, path: &str, rev: &str) -> MResult<String> {
        let p = self.history_target(path)?;
        let id = self.resolve_rev(rev)?;
        self.content_at(&p, &id, rev.trim())
    }

    /// Where a note that is gone from `path` lives now, if it was renamed or moved
    /// (following a chain of renames): `(today's path, commit of the first rename)`.
    fn renamed_away(&self, path: &str) -> Option<(String, String)> {
        let (ok, out) = self.git(&[
            "log",
            "-M",
            "--diff-filter=R",
            "--name-status",
            "--format=%x1e%h",
        ]);
        if !ok {
            return None;
        }
        let renames: Vec<(String, String, String)> = out
            .split('\x1e')
            .flat_map(|rec| {
                let mut lines = rec.lines();
                let short = lines.next().unwrap_or("").trim().to_string();
                lines
                    .filter_map(|l| {
                        let f: Vec<&str> = l.split('\t').collect();
                        (f.len() == 3 && f[0].starts_with('R'))
                            .then(|| (short.clone(), f[1].to_string(), f[2].to_string()))
                    })
                    .collect::<Vec<_>>()
            })
            .collect();
        let mut cur = path.to_string();
        let mut first = None;
        for _ in 0..16 {
            let Some((at, _, to)) = renames.iter().find(|(_, from, _)| *from == cur) else {
                break;
            };
            first.get_or_insert_with(|| at.clone());
            cur = to.clone();
            if self.root().join(&cur).is_file() {
                break;
            }
        }
        (cur != path && self.root().join(&cur).is_file() && self.visible(&cur))
            .then(|| (cur, first.unwrap_or_default()))
    }

    pub fn restore_impl(&self, path: &str, rev: &str) -> MResult<Value> {
        let p = self.history_target(path)?;
        let id = self.resolve_rev(rev)?;
        let ap = self.resolve(&p)?;
        if ap.is_dir() {
            return err(format!("{p} is a folder; restore one note at a time"));
        }
        if !ap.exists() {
            // Restoring the old name of a renamed note would make a silent duplicate.
            if let Some((now, at)) = self.renamed_away(&p) {
                if let Some(name) = now.strip_prefix(".Trash/") {
                    return err(format!(
                        "{p} was moved to the trash at {at}; use restore_trash with name {name}"
                    ));
                }
                return err(format!(
                    "{p} was renamed to {now} at {at}; restore {now} instead (its history follows the rename)"
                ));
            }
        }
        let content = self.content_at(&p, &id, rev.trim())?;
        if let Some(parent) = ap.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&ap, content).map_err(|e| MemoryErr(e.to_string()))?;
        let _ = self.reindex();
        self.git_commit(&format!("restore: {p}@{}", rev.trim()));
        Ok(json!({"ok": true, "path": p, "rev": rev.trim()}))
    }

    pub fn diff_impl(&self, path: &str, rev_a: &str, rev_b: &str) -> MResult<Value> {
        let p = self.history_target(path)?;
        if rev_a.trim().is_empty() {
            return err("rev_a is required");
        }
        let a = self.resolve_rev(rev_a)?;
        let b = if rev_b.trim().is_empty() {
            None
        } else {
            Some(self.resolve_rev(rev_b)?)
        };
        let mut args = vec!["--literal-pathspecs", "diff", a.as_str()];
        if let Some(b) = &b {
            args.push(b);
        }
        args.extend(["--", p.as_str()]);
        let (ok, out, stderr) = self.git_run(&args, &[]);
        if !ok {
            return err(format!("diff failed: {}", stderr.trim()));
        }
        Ok(json!({"path": p, "from": rev_a.trim(),
                  "to": if b.is_none() { "working" } else { rev_b.trim() },
                  "changed": !out.is_empty(), "diff": out}))
    }
}

// ---------------------------------------------------------------------------
// Folder meta, locks, events, actors, logs
// ---------------------------------------------------------------------------

impl MemoryStore {
    fn folders_path(&self) -> PathBuf {
        self.root().join(".folders.json")
    }

    /// Folder metadata: every folder's without `folder`, else that folder's own (plus
    /// an inherited color). `Root` has none (`{}`); a missing, hidden or invalid
    /// folder is an error.
    pub fn get_folder_meta_impl(&self, folder: Option<&str>) -> MResult<Value> {
        let mut meta: Map<String, Value> = fs::read_to_string(self.folders_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if self.restricted() {
            meta.retain(|k, v| self.visible(k) && self.value_visible(v));
        }
        // The file can be edited outside Memora (sync, a text editor); the web
        // UI puts color into a style attribute, so only values set_folder_meta
        // would accept are passed on.
        for v in meta.values_mut() {
            if let Some(o) = v.as_object_mut() {
                if o.get("color")
                    .is_some_and(|c| !c.as_str().is_some_and(is_hex_color))
                {
                    o.remove("color");
                }
                if o.get("icon")
                    .is_some_and(|c| !c.as_str().is_some_and(is_folder_icon))
                {
                    o.remove("icon");
                }
            }
        }
        let Some(f) = folder.filter(|f| !f.is_empty()) else {
            return Ok(Value::Object(meta));
        };
        if f.trim().is_empty() {
            return err("folder is blank; give a folder path, or omit it for every folder");
        }
        if is_root_alias(f) {
            return Ok(json!({}));
        }
        let (f, _) = self.folder_dir(f)?;
        let mut own = meta.get(&f).cloned().unwrap_or(json!({}));
        // A sub folder without its own color shows its nearest parent's.
        if own.get("color").is_none() {
            let mut p = f.as_str();
            while let Some((parent, _)) = p.rsplit_once('/') {
                if let Some(c) = meta.get(parent).and_then(|m| m.get("color")) {
                    own["inherited"] = json!({"color": c, "from": parent});
                    break;
                }
                p = parent;
            }
        }
        Ok(own)
    }

    pub fn set_folder_meta_impl(
        &self,
        folder: &str,
        color: Option<&str>,
        icon: Option<&str>,
        desc: Option<&str>,
    ) -> MResult<Value> {
        if folder.trim().is_empty() {
            return err("folder required");
        }
        if is_root_alias(folder) {
            return err("Root (the top level) has no folder metadata; pick a folder");
        }
        // No metadata for folders that do not exist (no ghost entries).
        let (folder, _) = self.folder_dir(folder)?;
        let folder = folder.as_str();
        let mut meta: Map<String, Value> = fs::read_to_string(self.folders_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let mut m = meta
            .get(folder)
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        // `Some("")` clears a field; `None` leaves it as is.
        if let Some(c) = color {
            let c = c.trim();
            if c.is_empty() {
                m.remove("color");
            } else if is_hex_color(c) {
                m.insert("color".into(), json!(c.to_ascii_lowercase()));
            } else {
                return err("color must be a #rrggbb hex color like #3b82f6");
            }
        }
        if let Some(i) = icon {
            let i = i.trim();
            if i.is_empty() {
                m.remove("icon");
            } else if is_folder_icon(i) {
                m.insert("icon".into(), json!(i));
            } else {
                return err(format!(
                    "icon must be one emoji or one of these icon names: {}",
                    FOLDER_ICONS.join(", ")
                ));
            }
        }
        if let Some(d) = desc {
            if d.trim().is_empty() {
                m.remove("desc");
            } else if d.chars().count() > MAX_FOLDER_DESC {
                return err(format!(
                    "desc must be at most {MAX_FOLDER_DESC} characters (got {})",
                    d.chars().count()
                ));
            } else {
                m.insert("desc".into(), json!(d));
            }
        }
        if m.is_empty() {
            meta.remove(folder);
        } else {
            meta.insert(folder.to_string(), Value::Object(m.clone()));
        }
        fs::write(
            self.folders_path(),
            serde_json::to_string_pretty(&Value::Object(meta)).unwrap(),
        )
        .ok();
        self.git_commit(&format!("folder look: {folder}"));
        Ok(Value::Object(m))
    }

    /// Notes in `folder` and every sub folder (`Root` or empty: notes at the top level).
    /// A missing, hidden or invalid folder is an error.
    pub fn folder_stats_impl(&self, folder: &str) -> MResult<Value> {
        if !folder.is_empty() && folder.trim().is_empty() {
            return err("folder is blank; give a folder path ('Root' = the top level)");
        }
        let (n, meta) = if is_root_alias(folder) {
            let n = self
                .walk()
                .iter()
                .filter(|(rel, _, _)| !rel.contains('/'))
                .count();
            (n, json!({}))
        } else {
            let (f, _) = self.folder_dir(folder)?;
            let prefix = format!("{f}/");
            let n = self
                .walk()
                .iter()
                .filter(|(rel, _, _)| rel.starts_with(&prefix))
                .count();
            (n, self.get_folder_meta_impl(Some(&f))?)
        };
        Ok(json!({"folder": folder, "notes": n, "meta": meta}))
    }

    // ---- locks ----
    fn locks_path(&self) -> PathBuf {
        self.root().join(".locks.json")
    }

    fn load_locks(&self) -> Map<String, Value> {
        fs::read_to_string(self.locks_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_locks(&self, locks: &Map<String, Value>) {
        fs::write(
            self.locks_path(),
            serde_json::to_string_pretty(locks).unwrap(),
        )
        .ok();
    }

    pub fn get_locks_impl(&self) -> Vec<Value> {
        let now = now_secs();
        self.load_locks()
            .iter()
            .filter(|(_, v)| v.get("expires").and_then(|e| e.as_f64()).unwrap_or(0.0) > now)
            .filter(|(k, _)| self.visible(k))
            .map(|(k, v)| {
                json!({"path": k, "owner": v.get("owner"),
                       "expires_in": (v.get("expires").and_then(|e| e.as_f64()).unwrap_or(0.0) - now).round()})
            })
            .collect()
    }

    /// Shortest and longest lock a caller may take, in seconds.
    pub const LOCK_TTL_RANGE: (i64, i64) = (5, 86_400);

    /// The note a lock applies to: `path` resolved like the other note tools (inside
    /// the vault, hidden = not found), `.md` optional, matched case-insensitively when
    /// the exact spelling does not exist, so `Readme`, `readme.md` and `Readme.md` all
    /// name the one note `Readme.md`. Folders cannot be locked.
    pub fn lock_target(&self, path: &str) -> MResult<String> {
        let p = path.trim();
        if p.is_empty() {
            return err("path is required: the note to lock, such as Notes/Ideas.md");
        }
        let ap = self.resolve(p)?;
        if ap.is_dir() {
            return err(format!("{p} is a folder; locks are taken on single notes"));
        }
        let with_md = if p.to_lowercase().ends_with(".md") {
            p.to_string()
        } else {
            format!("{p}.md")
        };
        // The note as spelled on disk: an exact match first, then one that differs
        // only in case. (On Windows and macOS `is_file` is true for any spelling,
        // so the lookup goes through the vault listing.)
        // `.` and empty segments are spelling only (`Notes/./a.md`, `Notes//a.md`
        // open `Notes/a.md`): drop them, or another spelling would slip past a
        // lock. A symlink is matched by the note it leads to.
        let typed = with_md.replace('\\', "/");
        let mut want = typed
            .split('/')
            .filter(|seg| !seg.is_empty() && *seg != ".")
            .collect::<Vec<_>>()
            .join("/");
        if let (Ok(root), Ok(real)) = (fs::canonicalize(self.root()), fs::canonicalize(&ap)) {
            if let Ok(rel) = real.strip_prefix(&root) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                if !rel.is_empty() && rel.to_lowercase().ends_with(".md") {
                    want = rel;
                }
            }
        }
        let want = want.as_str();
        let all: Vec<String> = self.walk().into_iter().map(|(rel, _, _)| rel).collect();
        if all.iter().any(|rel| rel == want) {
            return Ok(want.to_string());
        }
        let lower = want.to_lowercase();
        let hits: Vec<String> = all
            .into_iter()
            .filter(|rel| rel.to_lowercase() == lower)
            .collect();
        match hits.as_slice() {
            [one] => Ok(one.clone()),
            [] => err(format!("not found: {p}")),
            _ => err(format!(
                "{p} matches several notes that differ only in case ({}); give the exact path",
                hits.join(", ")
            )),
        }
    }

    /// Active (unexpired) locks.
    fn active_locks(&self, now: f64) -> Map<String, Value> {
        self.load_locks()
            .into_iter()
            .filter(|(_, v)| v.get("expires").and_then(|e| e.as_f64()).unwrap_or(0.0) > now)
            .collect()
    }

    /// Whether lock `v` belongs to holder `holder_id` (locks written before holder ids
    /// were stored compare by display name).
    fn lock_held_by(v: &Value, holder_id: &str, holder_name: &str) -> bool {
        match v.get("owner_id").and_then(|x| x.as_str()) {
            Some(id) => id == holder_id,
            None => v.get("owner").and_then(|x| x.as_str()) == Some(holder_name),
        }
    }

    fn lock_owner(v: &Value) -> &str {
        v.get("owner").and_then(|x| x.as_str()).unwrap_or("")
    }

    fn lock_left(v: &Value, now: f64) -> f64 {
        (v.get("expires").and_then(|x| x.as_f64()).unwrap_or(0.0) - now)
            .round()
            .max(0.0)
    }

    /// Take (or renew) a soft lock on a note for `ttl` seconds
    /// ([`Self::LOCK_TTL_RANGE`]) in the name of holder `holder_id` (shown as
    /// `holder_name`). A note another holder has locked is refused.
    pub fn lock_node_impl(
        &self,
        path: &str,
        holder_id: &str,
        holder_name: &str,
        ttl: i64,
    ) -> MResult<Value> {
        let (lo, hi) = Self::LOCK_TTL_RANGE;
        if !(lo..=hi).contains(&ttl) {
            return err(format!(
                "ttl must be {lo}-{hi} seconds (got {ttl}); leave it out for 300"
            ));
        }
        let rel = self.lock_target(path)?;
        let now = now_secs();
        let mut locks = self.active_locks(now);
        if let Some(cur) = locks.get(&rel) {
            if !Self::lock_held_by(cur, holder_id, holder_name) {
                let owner = Self::lock_owner(cur);
                return err(format!(
                    "{rel} is locked by {owner} for {} s more; wait, or ask {owner} to release it",
                    Self::lock_left(cur, now)
                ));
            }
        }
        locks.insert(
            rel.clone(),
            json!({"owner": holder_name, "owner_id": holder_id, "expires": now + ttl as f64}),
        );
        self.save_locks(&locks);
        Ok(json!({"ok": true, "path": rel, "owner": holder_name, "ttl": ttl, "expires_in": ttl}))
    }

    /// Release a lock. Only its holder may release it, unless `force` (the owner's
    /// session, which may clear any lock).
    pub fn release_lock_impl(
        &self,
        path: &str,
        holder_id: &str,
        holder_name: &str,
        force: bool,
    ) -> MResult<Value> {
        let now = now_secs();
        let mut locks = self.active_locks(now);
        // A lock on a note deleted since can still be released by its exact path.
        let rel = match self.lock_target(path) {
            Ok(r) => r,
            Err(e) => {
                let p = path.trim();
                if !p.is_empty() && self.visible(p) && locks.contains_key(p) {
                    p.to_string()
                } else {
                    return Err(e);
                }
            }
        };
        let Some(cur) = locks.get(&rel).cloned() else {
            return Ok(json!({"ok": true, "released": false, "path": rel,
                             "note": "the note was not locked"}));
        };
        if !force && !Self::lock_held_by(&cur, holder_id, holder_name) {
            let owner = Self::lock_owner(&cur);
            return err(format!(
                "{rel} is locked by {owner}; only {owner} can release it, or wait {} s",
                Self::lock_left(&cur, now)
            ));
        }
        locks.remove(&rel);
        self.save_locks(&locks);
        Ok(json!({"ok": true, "released": true, "path": rel, "owner": Self::lock_owner(&cur)}))
    }

    /// Why a write by holder `holder_id` must wait: the first note among `paths`, or
    /// inside one of `folders` (`""` = the whole vault), locked by another holder.
    /// Paths that do not name a visible note are ignored (the write reports them).
    pub fn lock_conflict(
        &self,
        paths: &[String],
        folders: &[String],
        holder_id: &str,
        holder_name: &str,
    ) -> Option<String> {
        let now = now_secs();
        let locks = self.active_locks(now);
        if locks.is_empty() {
            return None;
        }
        let blocked = |rel: &str| -> Option<String> {
            let v = locks.get(rel)?;
            if Self::lock_held_by(v, holder_id, holder_name) || !self.visible(rel) {
                return None;
            }
            Some(format!(
                "{rel} is locked by {} for {} s more",
                Self::lock_owner(v),
                Self::lock_left(v, now)
            ))
        };
        for p in paths {
            if let Some(m) = self.lock_target(p).ok().and_then(|rel| blocked(&rel)) {
                return Some(m);
            }
        }
        for f in folders {
            let f = f.trim().trim_matches('/');
            let all = f.is_empty() || f == "Root";
            let prefix = format!("{f}/");
            for rel in locks.keys() {
                if all || rel.starts_with(&prefix) {
                    if let Some(m) = blocked(rel) {
                        return Some(m);
                    }
                }
            }
        }
        None
    }

    // ---- events ----
    pub fn events_path(&self) -> PathBuf {
        self.root().join(".events.jsonl")
    }

    /// Compact node payload for realtime graph updates.
    ///
    /// Shape: id, path, folder, color, degree, links. `degree` counts unique
    /// outgoing links that are not self-links.
    pub fn node_payload(&self, rel_path: &str) -> Value {
        let name = std::path::Path::new(rel_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let content = match self.resolve(rel_path) {
            Ok(p) => self.read(&p).unwrap_or_default(),
            Err(_) => String::new(),
        };
        let mut links: Vec<String> = Vec::new();
        for raw in self.link_targets(&content) {
            let tgt = raw.split('/').next_back().unwrap_or("").replace(".md", "");
            if !tgt.is_empty() && tgt != name && !links.contains(&tgt) {
                links.push(tgt);
            }
        }
        json!({
            "id": name,
            "path": rel_path,
            "folder": folder_of(rel_path),
            "color": crate::color_of(rel_path),
            "degree": links.len(),
            "links": links,
            "tags": note_tags(&content),
        })
    }

    pub fn read_events(&self) -> Vec<Value> {
        let p = self.events_path();
        if !p.is_file() {
            return Vec::new();
        }
        let Ok(raw) = fs::read_to_string(&p) else {
            return Vec::new();
        };
        // Only the newest 2000 lines are considered. The file itself is
        // compacted by the event hub (its single writer); rewriting it here
        // raced with concurrent appends and could drop events.
        let lines: Vec<&str> = raw.lines().collect();
        let from = lines.len().saturating_sub(2000);
        lines[from..]
            .iter()
            .filter_map(|l| serde_json::from_str::<Value>(l).ok())
            .filter(|e| self.value_visible(e))
            .collect()
    }

    pub fn get_events_impl(
        &self,
        since: Option<f64>,
        folder: Option<&str>,
        actor: Option<&str>,
        limit: usize,
    ) -> Vec<Value> {
        let mut evs = self.read_events();
        if let Some(s) = since {
            evs.retain(|e| e.get("_ts").and_then(|v| v.as_f64()).unwrap_or(0.0) > s);
        }
        if let Some(a) = actor {
            if !a.is_empty() {
                evs.retain(|e| e.get("actor").and_then(|v| v.as_str()).unwrap_or("") == a);
            }
        }
        if let Some(f) = folder {
            if !f.is_empty() {
                evs.retain(|e| {
                    let node = e.get("node").cloned().unwrap_or(json!({}));
                    let nf = node.get("folder").and_then(|v| v.as_str()).unwrap_or("");
                    let eff = if !nf.is_empty() {
                        nf.to_string()
                    } else {
                        let p = e
                            .get("path")
                            .and_then(|v| v.as_str())
                            .or_else(|| node.get("path").and_then(|v| v.as_str()))
                            .unwrap_or("");
                        folder_of(p)
                    };
                    eff == f
                });
            }
        }
        let n = limit.max(1).min(evs.len());
        evs.split_off(evs.len() - n)
    }

    pub fn presence_impl(&self, window: i64) -> Vec<Value> {
        let now = now_secs();
        let mut seen: BTreeMap<String, Value> = BTreeMap::new();
        for e in self.read_events() {
            let a = e.get("actor").and_then(|v| v.as_str()).unwrap_or("");
            let ts = e.get("_ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if !a.is_empty() && ts > now - window as f64 {
                seen.insert(
                    a.to_string(),
                    json!({"actor": a,
                           "last_action": e.get("action").or_else(|| e.get("type")),
                           "seconds_ago": (now - ts).round()}),
                );
            }
        }
        seen.into_values().collect()
    }

    /// Activity summary over the newest logged events (the log keeps the newest
    /// 2000): counts per actor and per type, and up to `limit` touched notes
    /// (`truncated` says whether more were touched). `folder` matches that folder and
    /// its subfolders (see [`in_folder`]); `since` is Unix seconds.
    pub fn digest_impl(&self, folder: Option<&str>, since: Option<f64>, limit: usize) -> Value {
        let mut evs = self.get_events_impl(since, None, None, usize::MAX);
        if let Some(f) = folder.filter(|f| !f.is_empty()) {
            evs.retain(|e| {
                let node = e.get("node");
                let p = e
                    .get("path")
                    .and_then(|v| v.as_str())
                    .or_else(|| node.and_then(|n| n.get("path")).and_then(|v| v.as_str()));
                p.is_some_and(|p| in_folder(p, f))
            });
        }
        let mut by_actor: BTreeMap<String, usize> = BTreeMap::new();
        let mut by_type: BTreeMap<String, usize> = BTreeMap::new();
        let mut touched: BTreeSet<String> = BTreeSet::new();
        for e in &evs {
            let a = e
                .get("actor")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            *by_actor.entry(a).or_insert(0) += 1;
            let t = e
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            *by_type.entry(t).or_insert(0) += 1;
            if let Some(id) = e
                .get("node")
                .and_then(|n| n.get("id"))
                .and_then(|v| v.as_str())
            {
                touched.insert(id.to_string());
            }
        }
        let truncated = touched.len() > limit;
        json!({"folder": folder, "events": evs.len(), "by_actor": by_actor,
               "by_type": by_type,
               "notes_touched": touched.into_iter().take(limit).collect::<Vec<_>>(),
               "truncated": truncated})
    }

    // ---- activity log (get_logs / search_logs) ----
    /// The `range` forms [`Self::get_logs_impl`] understands, for error messages.
    pub const LOG_RANGES: &'static str =
        "today, yesterday, latest (7 days), week (or 1w), all, or Nd for the last N days (1-3650, e.g. 1d, 30d)";

    /// Whether `range` is one of [`Self::LOG_RANGES`] (blank = the default).
    pub fn log_range_ok(range: &str) -> bool {
        let r = range.trim().to_lowercase();
        if r.is_empty()
            || matches!(
                r.as_str(),
                "all" | "latest" | "recent" | "now" | "today" | "yesterday" | "1w" | "week"
            )
        {
            return true;
        }
        r.strip_suffix('d')
            .filter(|n| n.chars().all(|c| c.is_ascii_digit() || c == '.'))
            .and_then(|n| n.parse::<f64>().ok())
            .is_some_and(|n| n > 0.0 && n <= 3650.0)
    }

    /// Logged events in a `range`: `today`, `yesterday`, `latest` (7 days), `Nd`
    /// (N days), `all`; anything else = 1 day. The log's own retention limits how
    /// far back events exist.
    pub fn get_logs_impl(&self, range: &str, q: &str, actor: &str, limit: usize) -> Value {
        self.get_logs_between(range, None, q, actor, limit)
    }

    /// [`Self::get_logs_impl`] with an explicit `[since, until)` window in unix
    /// seconds (e.g. one calendar day in the viewer's time zone), overriding `range`.
    pub fn get_logs_between(
        &self,
        range: &str,
        window: Option<(Option<f64>, Option<f64>)>,
        q: &str,
        actor: &str,
        limit: usize,
    ) -> Value {
        let now = now_secs();
        let lt = chrono::Local::now();
        let midnight = lt
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .map(|d| {
                d.and_local_timezone(*lt.offset())
                    .single()
                    .map(|x| x.timestamp() as f64)
                    .unwrap_or(now)
            })
            .unwrap_or(now);
        let r = if range.is_empty() { "1d" } else { range }
            .trim()
            .to_lowercase();
        let (since, until): (Option<f64>, Option<f64>) = if let Some(w) = window {
            w
        } else if r == "all" {
            (None, None)
        } else if matches!(r.as_str(), "latest" | "recent" | "now") {
            (Some(now - 7.0 * 86400.0), None)
        } else if matches!(r.as_str(), "today") {
            (Some(midnight), None)
        } else if matches!(r.as_str(), "yesterday") {
            (Some(midnight - 86400.0), Some(midnight))
        } else if r.len() > 1
            && r.ends_with('d')
            && r[..r.len() - 1]
                .replace('.', "")
                .chars()
                .all(|c| c.is_ascii_digit())
        {
            let n: f64 = r[..r.len() - 1].parse().unwrap_or(1.0);
            (Some(now - n.clamp(0.0, 3650.0) * 86400.0), None)
        } else if matches!(r.as_str(), "1w" | "7d" | "week") {
            (Some(now - 7.0 * 86400.0), None)
        } else {
            (Some(now - 86400.0), None)
        };
        let ql = q.trim().to_lowercase();
        let mut out: Vec<Value> = Vec::new();
        if let Ok(raw) = fs::read_to_string(self.events_path()) {
            for line in raw.lines() {
                let Ok(ev) = serde_json::from_str::<Value>(line) else {
                    continue;
                };
                if !self.value_visible(&ev) {
                    continue;
                }
                let ts = ev.get("_ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if let Some(s) = since {
                    if ts < s {
                        continue;
                    }
                }
                if let Some(u) = until {
                    if ts >= u {
                        continue;
                    }
                }
                if !actor.is_empty()
                    && ev.get("actor").and_then(|v| v.as_str()).unwrap_or("") != actor
                {
                    continue;
                }
                if !ql.is_empty() {
                    let node = ev.get("node").cloned().unwrap_or(json!({}));
                    let parts = [
                        ev.get("actor"),
                        ev.get("type"),
                        ev.get("action"),
                        ev.get("label"),
                        ev.get("id"),
                        ev.get("folder"),
                        ev.get("alias"),
                        node.get("id"),
                        node.get("path"),
                    ];
                    let hay = parts
                        .iter()
                        .flatten()
                        .map(|v| v.as_str().unwrap_or("").to_string())
                        .collect::<Vec<_>>()
                        .join(" ")
                        .to_lowercase();
                    if !hay.contains(&ql) {
                        continue;
                    }
                }
                out.push(ev);
            }
        }
        out.sort_by(|a, b| {
            let x = b.get("_ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = a.get("_ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
            x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal)
        });
        out.truncate(limit.clamp(1, 2000));
        for ev in out.iter_mut() {
            let ts = ev.get("_ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let t = chrono::DateTime::from_timestamp(ts as i64, 0)
                .map(|d| {
                    d.with_timezone(&chrono::Local)
                        .to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
                })
                .unwrap_or_default();
            if let Some(o) = ev.as_object_mut() {
                o.insert("time".into(), json!(t));
            }
        }
        json!({"range": r, "count": out.len(), "events": out})
    }

    // ---- actor aliases ----
    fn actors_path(&self) -> PathBuf {
        self.root().join(".actors.json")
    }

    pub fn get_actor_aliases(&self) -> Map<String, Value> {
        fs::read_to_string(self.actors_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn set_actor_alias(&self, actor: &str, alias: &str) -> MResult<Value> {
        let actor = actor.trim();
        let alias = alias.trim();
        if actor.is_empty() {
            return err("actor required");
        }
        if alias.is_empty() || alias.chars().count() > 32 {
            return err("name must be 1-32 characters; spaces at the ends are removed");
        }
        if alias
            .chars()
            .any(|c| c.is_control() || is_invisible_format(c))
        {
            return err(
                "name must not contain control characters (line breaks, tabs, NUL) or \
                 invisible text-direction / zero-width characters",
            );
        }
        let mut aliases = self.get_actor_aliases();
        aliases.insert(actor.to_string(), json!(alias));
        fs::write(
            self.actors_path(),
            serde_json::to_string_pretty(&Value::Object(aliases.clone())).unwrap(),
        )
        .ok();
        Ok(json!({"actor": actor, "alias": alias, "aliases": aliases}))
    }

    pub fn list_actors_impl(&self) -> Value {
        let aliases = self.get_actor_aliases();
        let mut known: BTreeSet<String> = aliases.keys().cloned().collect();
        for e in self.read_events() {
            if let Some(a) = e.get("actor").and_then(|v| v.as_str()) {
                known.insert(a.to_string());
            }
        }
        let actors: Vec<Value> = known
            .iter()
            .map(|a| {
                json!({"actor": a, "alias": aliases.get(a).cloned().unwrap_or(json!(null)),
                       "display": aliases.get(a).and_then(|v| v.as_str()).unwrap_or(a)})
            })
            .collect();
        json!({"actors": actors, "aliases": aliases})
    }
}

// ---------------------------------------------------------------------------
// Discovery / dedup / ops / UX
// ---------------------------------------------------------------------------

impl MemoryStore {
    /// Every other note scored against `path` (shared tags x5 + shared words), best
    /// first: `(score, rel, name)`, plus the note's own path and link targets.
    #[allow(clippy::type_complexity)]
    fn similar_ranked(
        &self,
        path: &str,
    ) -> MResult<(Vec<(usize, String, String)>, String, Vec<String>)> {
        let (_, base) = self.note_of(path)?;
        let files = self.walk();
        let metas = self.scan(&files);
        let Some(bi) = files.iter().position(|(rel, _, _)| *rel == base) else {
            return err(format!("not found: {path}"));
        };
        let bm = metas[bi].clone();
        let mut scored: Vec<(usize, String, String)> = Vec::new();
        for ((rel, name, _), m) in files.into_iter().zip(&metas) {
            if rel == base {
                continue;
            }
            let score = bm.search_tags.intersection(&m.search_tags).count() * 5
                + bm.words.intersection(&m.words).count();
            if score > 0 {
                scored.push((score, rel, name));
            }
        }
        scored.sort_by_key(|a| std::cmp::Reverse(a.0));
        Ok((scored, base, bm.targets.clone()))
    }

    pub fn find_similar_impl(&self, path: &str, limit: usize) -> MResult<Vec<Value>> {
        let (scored, _, _) = self.similar_ranked(path)?;
        Ok(scored
            .into_iter()
            .take(limit)
            .map(|(score, rel, name)| {
                json!({"path": rel, "name": name, "folder": folder_of(&rel), "score": score})
            })
            .collect())
    }

    pub fn suggest_links_impl(&self, path: &str, limit: usize) -> MResult<Vec<Value>> {
        let (scored, base, targets) = self.similar_ranked(path)?;
        let linked: BTreeSet<String> = targets
            .iter()
            .map(|t| {
                t.rsplit('/')
                    .next()
                    .unwrap_or(t)
                    .replace(".md", "")
                    .trim()
                    .to_lowercase()
            })
            .collect();
        let base_name = Self::base_name(&base);
        Ok(scored
            .into_iter()
            .filter(|(_, _, n)| !linked.contains(&n.to_lowercase()) && *n != base_name)
            .take(limit)
            .map(|(score, rel, name)| {
                json!({"path": rel, "name": name, "folder": folder_of(&rel), "score": score})
            })
            .collect())
    }

    pub fn stale_detection_impl(&self, days: i64) -> Vec<Value> {
        let now = now_secs();
        let cutoff = now - days.max(0) as f64 * 86400.0;
        let mut out: Vec<Value> = self
            .walk()
            .into_iter()
            .filter_map(|(rel, name, fp)| {
                let mtime = fs::metadata(&fp)
                    .and_then(|m| m.modified())
                    .map(|t| {
                        t.duration_since(UNIX_EPOCH)
                            .map(|d| d.as_secs_f64())
                            .unwrap_or(0.0)
                    })
                    .unwrap_or(0.0);
                if mtime < cutoff {
                    Some(json!({"path": rel, "name": name, "folder": folder_of(&rel),
                                "age_days": ((now - mtime) / 86400.0).round()}))
                } else {
                    None
                }
            })
            .collect();
        out.sort_by(|a, b| {
            let x = b.get("age_days").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = a.get("age_days").and_then(|v| v.as_f64()).unwrap_or(0.0);
            x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal)
        });
        out
    }

    pub fn healthcheck_impl(&self) -> Value {
        let (git_ok, _) = self.git(&["rev-parse", "--git-dir"]);
        let (_ok, status) = self.git(&["status", "--porcelain"]);
        json!({
            "ok": true,
            "notes": self.stats().notes,
            "broken_links": self.broken_links(None).len(),
            "isolated": self.get_isolated_impl().len(),
            "git": git_ok,
            "uncommitted": !status.trim().is_empty(),
        })
    }

    pub fn validate_memory_impl(&self, path: &str) -> MResult<Value> {
        let path = norm_note_path(path);
        let ap = self.resolve(&path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let raw = self.read_raw(&ap).unwrap_or_default();
        let (tags, fm) = self.note_tags_fm(&ap);
        let mut issues: Vec<String> = Vec::new();
        let malformed = frontmatter_problem(&raw);
        if let Some(why) = &malformed {
            issues.push(format!("malformed frontmatter: {why}"));
        } else if fm.as_object().map(|o| o.is_empty()).unwrap_or(true) {
            issues.push("no frontmatter".into());
        } else {
            match fm.get("created") {
                None => issues.push("missing 'created'".into()),
                Some(v) => {
                    let s = v
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| v.to_string());
                    if !is_date_like(&s) {
                        issues.push(format!(
                            "'created' is not a valid date: `{s}` (use YYYY-MM-DD or an ISO 8601 date and time)"
                        ));
                    }
                }
            }
        }
        // Tags in malformed frontmatter cannot be read, so "no tags" would mislead.
        if tags.is_empty() && malformed.is_none() {
            issues.push("no tags".into());
        }
        let broken: Vec<String> = self
            .broken_links(Some(&path))
            .into_iter()
            .map(|b| b.target)
            .collect();
        if !broken.is_empty() {
            let names: Vec<String> = broken.iter().map(|t| format!("[[{t}]]")).collect();
            issues.push(format!("broken link(s): {}", names.join(", ")));
        }
        Ok(
            json!({"path": path, "ok": issues.is_empty(), "issues": issues,
                  "tags": tags, "frontmatter": fm, "broken_links": broken}),
        )
    }

    /// Checklist items (`- [ ] text`, `- [x] text`; empty items skipped) of one note
    /// (`path` resolved like the graph tools) or of the whole vault.
    pub fn get_todos_impl(&self, path: Option<&str>) -> MResult<Vec<Value>> {
        let only = match path.filter(|p| !p.is_empty()) {
            Some(p) => Some(self.note_of(p)?.1),
            None => None,
        };
        let files = self.walk();
        let metas = self.scan(&files);
        let mut out = Vec::new();
        for ((rel, _, _), meta) in files.iter().zip(&metas) {
            if only.as_ref().is_some_and(|o| o != rel) {
                continue;
            }
            for (line, done, text) in &meta.todos {
                out.push(json!({"path": rel, "done": done, "text": text, "line": line}));
            }
        }
        Ok(out)
    }

    /// Notes whose frontmatter `status` is one of [`FOLLOW_UP_STATUSES`] (ignoring
    /// case; `_` and spaces count as `-`), at most `limit` of them; `truncated` says
    /// whether more matched.
    pub fn follow_ups_impl(&self, limit: usize) -> Value {
        let files = self.walk();
        let metas = self.scan(&files);
        let mut out = Vec::new();
        let mut total = 0usize;
        for ((rel, name, _), meta) in files.into_iter().zip(metas) {
            let st = meta
                .fm
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_lowercase()
                .replace(['_', ' '], "-");
            if !FOLLOW_UP_STATUSES.contains(&st.as_str()) {
                continue;
            }
            total += 1;
            if out.len() < limit {
                out.push(json!({
                    "path": rel, "name": name, "folder": folder_of(&rel),
                    "status": st, "tags": meta.tags, "frontmatter": meta.fm,
                }));
            }
        }
        json!({"notes": out, "count": total, "truncated": total > limit})
    }

    pub fn get_assignments_impl(&self, agent: Option<&str>) -> Vec<Value> {
        let mut out = Vec::new();
        for (rel, name, fp) in self.walk() {
            let (_tags, fm) = self.note_tags_fm(&fp);
            if let Some(a) = fm.get("assigned_to") {
                let a_str = a.as_str().unwrap_or("");
                if !a_str.is_empty()
                    && agent
                        .map(|x| x.is_empty() || a_str.to_lowercase() == x.to_lowercase())
                        .unwrap_or(true)
                {
                    out.push(json!({
                        "path": rel, "name": name, "assigned_to": a_str,
                        "status": fm.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                    }));
                }
            }
        }
        out
    }

    /// Longest `mention_agent` message, in characters.
    pub const MENTION_MAX_CHARS: usize = 4000;

    /// Append `> @agent: message` to a note. The agent name must be one line (a
    /// leading `@` is dropped); every line of a multi-line message stays inside the
    /// quote, so a message cannot add lines of its own to the note.
    pub fn mention_agent_impl(&self, agent: &str, path: &str, message: &str) -> MResult<Value> {
        let agent = agent.trim();
        let agent = agent.strip_prefix('@').unwrap_or(agent).trim();
        if agent.is_empty() {
            return err("agent is required: the name of the agent to ping");
        }
        if agent.chars().any(char::is_control) {
            return err("agent must be a single name without line breaks or control characters");
        }
        if agent.chars().count() > 64 {
            return err("agent must be at most 64 characters");
        }
        let message = message.trim();
        if message.is_empty() {
            return err("message is required: what the agent should know or do");
        }
        if message.chars().count() > Self::MENTION_MAX_CHARS {
            return err(format!(
                "message must be at most {} characters (got {}); link a note for longer text",
                Self::MENTION_MAX_CHARS,
                message.chars().count()
            ));
        }
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        // Control characters other than line breaks and tabs are dropped; each line
        // of the message gets its own quote marker.
        let body = message
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .chars()
            .filter(|c| *c == '\n' || *c == '\t' || !c.is_control())
            .collect::<String>()
            .lines()
            .map(str::trim_end)
            .collect::<Vec<_>>()
            .join("\n> ");
        let cur = self.read_raw(&ap).unwrap_or_default();
        let line = format!("\n\n> @{agent}: {body}");
        self.save_impl(
            path,
            &format!("{}{}", cur.trim_end_matches('\n'), line.trim_end()),
        )?;
        Ok(json!({"ok": true, "path": path, "agent": agent}))
    }
}

// ---------------------------------------------------------------------------
// Export / import (zip markdown)
// ---------------------------------------------------------------------------

impl MemoryStore {
    /// A zip of the notes and folders `paths` (`""` is the whole vault). Every
    /// path must exist: nothing is exported when one is missing.
    pub fn export_zip_impl(&self, paths: &[Value]) -> MResult<Vec<u8>> {
        use std::io::Write;
        let mut files: Vec<(String, PathBuf)> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut missing = Vec::new();
        for p in paths {
            let Some(ps) = p.as_str() else {
                return err(format!(
                    "paths must be note or folder paths (strings); got {p}"
                ));
            };
            let ps = norm_note_path(ps);
            let ap = match self.resolve(&ps) {
                Ok(ap) => ap,
                Err(e) if e.0.starts_with("not found") => {
                    missing.push(ps);
                    continue;
                }
                Err(e) => return Err(e),
            };
            if ap.is_dir() {
                // Hidden entries below the exported folder (`.git`, `.Trash`) are skipped.
                let walk = WalkDir::new(&ap).into_iter().filter_entry(|e| {
                    e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
                });
                for entry in walk.filter_map(Result::ok) {
                    let name = entry.file_name().to_string_lossy();
                    if entry.file_type().is_file() && name.ends_with(".md") {
                        let rel = self.rel_of(entry.path());
                        if self.visible(&rel) && seen.insert(rel.clone()) {
                            files.push((rel, entry.path().to_path_buf()));
                        }
                    }
                }
            } else if ap.is_file() {
                let rel = self.rel_of(&ap);
                if seen.insert(rel.clone()) {
                    files.push((rel, ap));
                }
            } else {
                missing.push(ps);
            }
        }
        if !missing.is_empty() {
            return err(format!(
                "not found: {} (nothing was exported)",
                missing.join(", ")
            ));
        }
        let mut buf = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            for (rel, fp) in files {
                let data = fs::read(&fp).unwrap_or_default();
                zw.start_file(rel, opts)
                    .map_err(|e| MemoryErr(e.to_string()))?;
                zw.write_all(&data).map_err(|e| MemoryErr(e.to_string()))?;
            }
            zw.finish().map_err(|e| MemoryErr(e.to_string()))?;
        }
        Ok(buf)
    }

    /// Import the `.md` entries of a zip. The reply lists `added` (new notes),
    /// `overwritten` (existing notes replaced, only with `overwrite`), `skipped`
    /// (existing notes kept), `unsafe` (entries whose path is absolute, leaves the
    /// vault or is not allowed, with a reason) and `failed` (too large or
    /// unreadable, with a reason).
    pub fn import_zip_impl(&self, data: &[u8], overwrite: bool) -> MResult<Value> {
        use std::io::Read;
        let mut added = Vec::new();
        let mut overwritten = Vec::new();
        let mut skipped = Vec::new();
        let mut unsafe_ = Vec::new();
        let mut failed = Vec::new();
        // Bounds against zip bombs: entries are decompressed with a hard cap
        // each and in total, and absurd entry counts are refused up front.
        const MAX_ENTRIES: usize = 20_000;
        const MAX_ENTRY_BYTES: u64 = 16 * 1024 * 1024;
        const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
        let cursor = std::io::Cursor::new(data);
        let mut zr = zip::ZipArchive::new(cursor)
            .map_err(|e| MemoryErr(format!("not a valid zip file ({e})")))?;
        if zr.len() > MAX_ENTRIES {
            return err(format!("zip has {} entries (max {MAX_ENTRIES})", zr.len()));
        }
        let mut total: u64 = 0;
        for i in 0..zr.len() {
            let mut f = zr.by_index(i).map_err(|e| MemoryErr(e.to_string()))?;
            let name = match f.name() {
                Ok(n) => n.into_owned(),
                Err(_) => {
                    failed
                        .push(json!({"entry": format!("#{i}"), "reason": "unreadable entry name"}));
                    continue;
                }
            };
            if !name.ends_with(".md") || name.ends_with('/') {
                continue;
            }
            if is_absolute_input(&name) {
                unsafe_.push(json!({"entry": name, "reason": "absolute path"}));
                continue;
            }
            let rel = name.replace('\\', "/");
            let ap = match self.resolve(&rel) {
                Ok(ap) => ap,
                Err(e) => {
                    // A path hidden from the caller reads as "not allowed", like
                    // the store's own hidden files.
                    let reason = if e.0.starts_with("path escapes") {
                        "path leaves the vault"
                    } else {
                        "path not allowed"
                    };
                    // Nor is the hidden path echoed back: the zip may come from
                    // someone who can see more (the exchange folder is shared).
                    let entry = if self.restricted()
                        && (!self.visible(&rel) || self.mentions_hidden(&rel))
                    {
                        "(hidden entry)".to_string()
                    } else {
                        name
                    };
                    unsafe_.push(json!({"entry": entry, "reason": reason}));
                    continue;
                }
            };
            let existed = ap.exists();
            if existed && !overwrite {
                skipped.push(json!(rel));
                continue;
            }
            if ap.is_dir() {
                failed.push(json!({"entry": name, "reason": "a folder has this name"}));
                continue;
            }
            let mut buf = Vec::new();
            if (&mut f)
                .take(MAX_ENTRY_BYTES + 1)
                .read_to_end(&mut buf)
                .is_err()
            {
                failed.push(json!({"entry": name, "reason": "unreadable entry"}));
                continue;
            }
            if buf.len() as u64 > MAX_ENTRY_BYTES {
                failed.push(json!({"entry": name, "reason": "larger than 16 MiB"}));
                continue;
            }
            total += buf.len() as u64;
            if total > MAX_TOTAL_BYTES {
                // Stop here, but still reindex/commit what was already written.
                failed.push(json!({"entry": name, "reason": "the zip holds more than 512 MiB; the rest was not imported"}));
                break;
            }
            if let Some(parent) = ap.parent() {
                fs::create_dir_all(parent).ok();
            }
            if let Err(e) = fs::write(&ap, buf) {
                failed.push(json!({"entry": name, "reason": e.to_string()}));
                continue;
            }
            if existed {
                overwritten.push(json!(rel));
            } else {
                added.push(json!(rel));
            }
        }
        let written = added.len() + overwritten.len();
        if written > 0 {
            let _ = self.reindex();
            self.git_commit(&format!("import: {written} notes"));
        }
        Ok(json!({
            "ok": true, "added": added, "overwritten": overwritten, "skipped": skipped,
            "unsafe": unsafe_, "failed": failed,
        }))
    }
}

#[cfg(test)]
mod image_render_tests {
    use super::*;

    #[test]
    fn images_in_a_row_make_a_gallery() {
        let h = render("![one](img/b.jpg)\n\n![two](root.gif)\n![[a.png]]", "");
        assert!(
            h.starts_with(r#"<div class="md-gallery" data-n="3">"#),
            "{h}"
        );
        assert_eq!(h.matches("<figure").count(), 3, "{h}");
        let single = render("![one](img/b.jpg)\n\ntext", "");
        assert!(!single.contains("md-gallery"), "{single}");
    }

    #[test]
    fn svg_and_credentials_are_not_images() {
        assert!(image_mime("x.svg").is_none());
        let h = render("![s](https://ex.com/a.svg?x=1)", "");
        assert!(!h.contains("<img") && h.contains("image blocked"), "{h}");
        let h = render("![c](https://user:pw@ex.com/a.png)", "");
        assert!(h.contains("image blocked"), "{h}");
        let h = render("![r](https://ex.com/a.png)", "");
        assert!(h.contains(r#"referrerpolicy="no-referrer""#), "{h}");
    }

    const FILES: &[&str] = &[
        "notes/pics/a.png",
        "img/b.jpg",
        "deep/x/c d.png",
        "root.gif",
    ];

    fn render(md: &str, dir: &str) -> String {
        let note = |t: &str| (t == "Note").then(|| "Note.md".to_string());
        let list: Vec<String> = FILES.iter().map(|s| s.to_string()).collect();
        let file = move |c: &str, by_name: bool| -> Option<String> {
            if by_name {
                find_image_by_name(&list, c)
            } else {
                FILES.contains(&c).then(|| c.to_string())
            }
        };
        let ctx = RenderCtx {
            note: &note,
            file: &file,
            note_dir: dir,
        };
        render_markdown_ctx(md, &ctx).0
    }

    #[test]
    fn table_cells_keep_wikilink_aliases_and_escaped_pipes() {
        assert_eq!(
            table_cells("| [[A/B|name]] | desc |"),
            vec!["[[A/B|name]]", "desc"]
        );
        assert_eq!(
            table_cells("| [[A/B\\|name]] | desc |"),
            vec!["[[A/B|name]]", "desc"]
        );
        assert_eq!(table_cells("| a \\| b | `x|y` |"), vec!["a | b", "`x|y`"]);
        assert_eq!(table_cells("a | b"), vec!["a", "b"]);
        assert_eq!(table_cells("| é | ✓ |"), vec!["é", "✓"]);
    }

    #[test]
    fn table_rows_match_the_header_width() {
        assert_eq!(fit_row(vec!["a".into()], 3), vec!["a", "", ""]);
        assert_eq!(
            fit_row(vec!["a".into(), "b".into(), "c".into()], 2),
            vec!["a", "b | c"]
        );
    }

    #[test]
    fn aliased_wikilink_in_a_table_cell_stays_one_link() {
        let h = render(
            "| Skill | Description |\n|---|---|\n| [[Note|nginx]] | Manage it |",
            "",
        );
        assert_eq!(h.matches("<th>").count(), 2, "{h}");
        assert_eq!(h.matches("<td>").count(), 2, "{h}");
        assert!(h.contains(">nginx</a>"), "{h}");
        assert!(h.contains("<td>Manage it</td>"), "{h}");
        assert_no_injection(&render(
            "| a | b |\n|---|---|\n| [[Note|<img src=x onerror=alert(1)>]] | x |",
            "",
        ));
    }

    /// No attribute can be opened outside the ones the renderer writes:
    /// with every quoted value removed, no tag carries an event handler,
    /// a stray quote, or a script URL.
    fn assert_no_injection(h: &str) {
        let quoted = Regex::new(r#""[^"]*""#).unwrap();
        let handler = Regex::new(r"(?i)\son[a-z]+\s*=").unwrap();
        for tag in h.split('<').skip(1) {
            let inside = tag.split('>').next().unwrap_or("");
            let bare = quoted.replace_all(inside, "\"\"");
            assert!(!handler.is_match(&bare), "handler injected: {h}");
            assert!(!bare.contains('\''), "stray quote: {h}");
            assert!(!inside.starts_with("script"), "script tag: {h}");
        }
        assert!(!h.to_lowercase().contains("src=\"javascript"), "{h}");
    }

    #[test]
    fn relative_image_resolves_from_note_folder_then_root() {
        let h = render("![pic](pics/a.png)", "notes");
        assert!(
            h.contains(r#"src="/api/vault/file?path=notes/pics/a.png""#),
            "{h}"
        );
        assert!(
            h.starts_with(
                r#"<figure class="md-img"><img loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="pic""#
            ),
            "{h}"
        );
        assert!(h.contains("<figcaption>pic</figcaption>"), "{h}");
        let h = render("![b](img/b.jpg)", "notes");
        assert!(h.contains("path=img/b.jpg"), "{h}");
        let h = render("![b](../img/b.jpg)", "notes");
        assert!(h.contains("path=img/b.jpg"), "{h}");
        let h = render("![b](/img/b.jpg)", "notes");
        assert!(h.contains("path=img/b.jpg"), "{h}");
    }

    #[test]
    fn paths_with_spaces_angle_brackets_and_percent() {
        for md in [
            "![c](deep/x/c d.png)",
            "![c](<deep/x/c d.png>)",
            "![c](deep/x/c%20d.png)",
            "![c](deep/x/c d.png \"Title\")",
        ] {
            let h = render(md, "");
            assert!(h.contains("path=deep/x/c%20d.png"), "{md}: {h}");
        }
        assert!(render("![c](deep/x/c d.png \"Title\")", "").contains(r#"title="Title""#));
    }

    #[test]
    fn inline_image_is_an_img_not_a_figure() {
        let h = render("see ![b](img/b.jpg) here", "");
        assert!(h.starts_with("<p>see <img class=\"md-img-i\""), "{h}");
        assert!(!h.contains("<figure"), "{h}");
    }

    #[test]
    fn obsidian_embeds_by_name_with_width() {
        let h = render("![[a.png]]", "elsewhere");
        assert!(h.contains("path=notes/pics/a.png"), "{h}");
        assert!(h.contains("<figure"), "{h}");
        let h = render("![[A.PNG|300]]", "");
        assert!(
            h.contains(r#"width="300""#) && h.contains("path=notes/pics/a.png"),
            "{h}"
        );
        let h = render("text ![[b.jpg|120x80]] more", "");
        assert!(
            h.contains(r#"width="120" height="80""#) && h.contains("md-img-i"),
            "{h}"
        );
        let h = render("![[c d.png|a caption]]", "");
        assert!(
            h.contains("path=deep/x/c%20d.png") && h.contains("<figcaption>a caption</figcaption>"),
            "{h}"
        );
        // Note embeds stay wikilinks.
        let h = render("![[Note]]", "");
        assert!(h.contains(r#"class="wl" data-path="Note.md""#), "{h}");
    }

    #[test]
    fn missing_images_get_a_placeholder() {
        let h = render("![[nope.png]]", "");
        assert!(
            h.starts_with(r#"<p><span class="md-img-missing">image not found: nope.png</span>"#),
            "{h}"
        );
        let h = render("![x](gone/zzz.webp)", "");
        assert!(h.contains("image not found: gone/zzz.webp"), "{h}");
        // Escaping the vault root is not resolvable.
        let h = render("![x](../../etc/passwd.png)", "notes");
        assert!(h.contains("md-img-missing") && !h.contains("<img"), "{h}");
    }

    #[test]
    fn remote_and_bare_image_urls() {
        let h = render("![r](https://example.com/a.png?x=1&y=2)", "");
        assert!(
            h.contains(r#"src="https://example.com/a.png?x=1&amp;y=2""#),
            "{h}"
        );
        let h = render("https://example.com/pic.JPG?size=large", "");
        assert!(h.starts_with(r#"<figure class="md-img"><img"#), "{h}");
        assert!(
            h.contains(r#"src="https://example.com/pic.JPG?size=large""#),
            "{h}"
        );
        // A bare non-image URL stays a paragraph.
        let h = render("https://example.com/page", "");
        assert_eq!(h, "<p>https://example.com/page</p>");
    }

    #[test]
    fn links_to_images_get_a_preview() {
        let h = render("[diagram](https://ex.com/d.png)", "");
        assert!(h.contains(r#"<a href="https://ex.com/d.png" target="_blank" rel="noopener noreferrer">diagram</a><img class="md-img-i md-img-link""#), "{h}");
        let h = render("[site](https://ex.com/)", "");
        assert!(!h.contains("<img"), "{h}");
    }

    #[test]
    fn data_urls_only_small_raster_base64() {
        let h = render("![d](data:image/png;base64,iVBORw0KGgo=)", "");
        assert!(
            h.contains(r#"src="data:image/png;base64,iVBORw0KGgo=""#),
            "{h}"
        );
        for md in [
            "![d](data:image/svg+xml;base64,PHN2Zz4=)",
            "![d](data:text/html;base64,PHNjcmlwdD4=)",
            "![d](data:image/png,<script>)",
        ] {
            let h = render(md, "");
            assert!(!h.contains("<img"), "{md}: {h}");
            assert!(h.contains("image blocked"), "{md}: {h}");
        }
    }

    #[test]
    fn dangerous_schemes_are_blocked() {
        for md in [
            "![x](javascript:alert(1).png)",
            "![x](JavaScript:alert(1))",
            "![x](vbscript:msgbox)",
            "![x](//evil.example/a.png)",
            "![x](file:///etc/passwd.png)",
            "x ![x](javascript:alert(1)) y",
        ] {
            let h = render(md, "");
            assert!(!h.contains("<img"), "{md}: {h}");
            assert!(h.contains("image blocked"), "{md}: {h}");
        }
        // Links stay http(s) only.
        let h = render("[x](javascript:alert(1))", "");
        assert!(!h.contains("<a"), "{h}");
    }

    #[test]
    fn attribute_injection_is_escaped() {
        let cases = [
            r#"![x](a"onerror="alert(1).png)"#,
            r#"![x" onerror="alert(1)](https://e.com/a.png)"#,
            r#"![x' onerror='alert(1)](https://e.com/a.png)"#,
            r#"![`" onerror="alert(1)`](https://e.com/a.png)"#,
            r#"![[a.png|" onerror="alert(1)]]"#,
            r#"![[" onerror="alert(1).png]]"#,
            r#"https://e.com/a.png?"onerror="alert(1)"#,
            r#"[x](https://e.com/a"onmouseover="alert(1))"#,
            r#"[x](https://e.com/a.png"onerror="alert(1))"#,
            r#"![**x" onerror="y**](https://e.com/a.png)"#,
            r#"![[[Note|x" onerror="y]]](https://e.com/a.png)"#,
            r#"![<script>alert(1)</script>](https://e.com/a.png)"#,
        ];
        for md in cases {
            let h = render(md, "");
            assert_no_injection(&h);
            // Every quote in the output belongs to an attribute the renderer wrote.
            for tag in h.split('<').skip(1) {
                let inside = tag.split('>').next().unwrap_or("");
                assert_eq!(inside.matches('"').count() % 2, 0, "{md}: {h}");
            }
        }
        let h = render(r#"![x" onerror="alert(1)](https://e.com/a.png)"#, "");
        assert!(h.contains(r#"alt="x&quot; onerror=&quot;alert(1)""#), "{h}");
        let h = render(r#"[x](https://e.com/a"onmouseover="alert(1))"#, "");
        assert!(
            h.contains(r#"href="https://e.com/a&quot;onmouseover=&quot;alert(1""#),
            "{h}"
        );
    }

    /// Code spans inside image/embed syntax used to panic the renderer (a
    /// re-match after restoring the code text failed); with `panic = "abort"`
    /// one such note took the whole server down on every view.
    #[test]
    fn code_spans_inside_embeds_never_panic() {
        let pieces = [
            "![[", "]]", "`]`", "`|`", "`", "|", "![", "](", ")", "a", "\\", "[[", "&lt;",
        ];
        let resolve = |_: &str| Some("x.md".to_string());
        let fixed = [
            "![[a`]`b]]",
            "![[a`|`b]]",
            "![[`]]`]]",
            "![a`)`b](c.png)",
            "![[a`]`b|300]]",
            "[x](https://e.com/`)`)",
        ];
        for t in fixed {
            let (h, _, _) = render_markdown(t, &resolve);
            assert!(!h.contains("<script"), "{h}");
        }
        // Every short combination of the tricky pieces renders without panicking.
        for a in pieces {
            for b in pieces {
                for c in pieces {
                    for d in pieces {
                        let t = format!("{a}{b}{c}{d}");
                        let _ = render_markdown(&t, &resolve);
                    }
                }
            }
        }
    }

    /// Raw HTML in a note is text, never markup: the web reader inserts this
    /// HTML as is, so the renderer is the only XSS barrier.
    #[test]
    fn raw_html_and_script_urls_never_become_markup() {
        let cases = [
            "<script>alert(1)</script>",
            "<img src=x onerror=alert(1)>",
            "<a href=\"javascript:alert(1)\">x</a>",
            "<iframe src=\"https://e.com\"></iframe>",
            "<p style=\"background:url(javascript:alert(1))\">x</p>",
            "<svg onload=alert(1)><circle/></svg>",
            "<math><mi xlink:href=\"javascript:alert(1)\">x</mi></math>",
            "[x](javascript:alert(1))",
            "[x](JaVaScRiPt:alert(1))",
            "[x](data:text/html;base64,PHNjcmlwdD4=)",
            "[x](vbscript:msgbox)",
            "![x](data:image/svg+xml,<svg onload=alert(1)>)",
            "[[<img src=x onerror=alert(1)>]]",
            "[[Note|<script>alert(1)</script>]]",
            "# <script>alert(1)</script>",
            "> <img src=x onerror=alert(1)>",
            "- <iframe srcdoc=x>",
            "| <b onclick=x>h</b> |\n|---|\n| <script>c</script> |",
            "`<script>`",
            "```\n</code></pre><script>alert(1)</script>\n```",
            "**<script>**",
        ];
        let allowed = [
            "p",
            "/p",
            "a",
            "/a",
            "img",
            "figure",
            "/figure",
            "figcaption",
            "/figcaption",
            "span",
            "/span",
            "strong",
            "/strong",
            "em",
            "/em",
            "del",
            "/del",
            "code",
            "/code",
            "pre",
            "/pre",
            "h1",
            "/h1",
            "blockquote",
            "/blockquote",
            "ul",
            "/ul",
            "li",
            "/li",
            "div",
            "/div",
            "table",
            "/table",
            "thead",
            "/thead",
            "tbody",
            "/tbody",
            "tr",
            "/tr",
            "th",
            "/th",
            "td",
            "/td",
        ];
        for md in cases {
            let h = render(md, "");
            assert_no_injection(&h);
            for tag in h.split('<').skip(1) {
                let name: String = tag
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '/')
                    .collect();
                assert!(allowed.contains(&name.as_str()), "<{name}> from {md}: {h}");
                let inside = tag.split('>').next().unwrap_or("");
                assert!(!inside.contains("style="), "{md}: {h}");
                assert!(!inside.contains("href=\"javascript"), "{md}: {h}");
                assert!(!inside.to_lowercase().contains("data:text"), "{md}: {h}");
            }
        }
        assert_eq!(
            render("<script>alert(1)</script>", ""),
            "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"
        );
    }

    #[test]
    fn other_markdown_is_unchanged() {
        assert_eq!(
            render("**b** *i* ~~d~~ `c<d`", ""),
            "<p><strong>b</strong> <em>i</em> <del>d</del> <code>c&lt;d</code></p>"
        );
        assert_eq!(
            render("[[Note]]", ""),
            r#"<p><a class="wl" data-path="Note.md">Note</a></p>"#
        );
        assert_eq!(
            render("[[Gone]]", ""),
            r#"<p><a class="wl broken" >Gone</a></p>"#
        );
        assert!(render("[a **b**](https://x.y/)", "").contains(">a <strong>b</strong></a>"));
        // A link wrapping an image.
        let h = render("[![b](img/b.jpg)](https://x.y/)", "");
        assert!(
            h.contains(r#"<a href="https://x.y/""#) && h.contains("path=img/b.jpg"),
            "{h}"
        );
    }

    #[test]
    fn image_embeds_are_not_graph_links() {
        let s = MemoryStore::new(std::env::temp_dir());
        assert_eq!(
            s.link_targets("![[a.png]] [[Note]] ![[b.JPG|20]]"),
            vec!["Note".to_string()]
        );
    }

    /// Names Windows would store differently from how they are written: each
    /// could alias a hidden or reserved entry (`GIT~1` is `.git`, `Private.`
    /// is `Private`, `x.md:s` is a stream of `x.md`, `NUL` a device).
    #[test]
    fn windows_unsafe_segments() {
        for bad in [
            "GIT~1",
            "LOCKS~1.JSO",
            "Private.",
            "Private ",
            "x.md:s",
            "C:",
            "CON",
            "con.md",
            "Nul",
            "COM1",
            "lpt9.txt",
            "COM\u{b9}",
            "AUX .md",
            "CONIN$",
        ] {
            assert!(windows_unsafe_segment(bad), "{bad}");
        }
        for ok in [
            "Notes",
            "Plan.md",
            "a~b",
            "COM",
            "COM10",
            "Console",
            "x~1a",
            "",
            ".",
            "nullable.md",
        ] {
            assert!(!windows_unsafe_segment(ok), "{ok}");
        }
    }

    #[test]
    fn vault_image_file_stays_inside_the_vault() {
        let base = std::env::temp_dir().join(format!(
            "memora-imgfile-{}-{}",
            std::process::id(),
            std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        let vault = base.join("vault");
        fs::create_dir_all(vault.join("img")).unwrap();
        fs::create_dir_all(vault.join(".git")).unwrap();
        fs::write(vault.join("img/a.png"), b"png").unwrap();
        fs::write(vault.join(".git/h.png"), b"png").unwrap();
        fs::write(vault.join("note.md"), b"md").unwrap();
        fs::write(base.join("outside.png"), b"secret").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(base.join("outside.png"), vault.join("img/link.png"))
                .unwrap();
            std::os::unix::fs::symlink(&base, vault.join("up")).unwrap();
        }
        let s = MemoryStore::new(&vault);
        assert!(s.vault_image_file("img/a.png").is_ok());
        assert_eq!(
            s.vault_image_file("../outside.png"),
            Err(VaultFileErr::Forbidden)
        );
        assert_eq!(
            s.vault_image_file("img/../../outside.png"),
            Err(VaultFileErr::Forbidden)
        );
        assert_eq!(
            s.vault_image_file("/etc/passwd.png"),
            Err(VaultFileErr::Forbidden)
        );
        assert_eq!(
            s.vault_image_file(".git/h.png"),
            Err(VaultFileErr::Forbidden)
        );
        assert_eq!(s.vault_image_file("note.md"), Err(VaultFileErr::NotImage));
        assert_eq!(
            s.vault_image_file("img/none.png"),
            Err(VaultFileErr::NotFound)
        );
        assert_eq!(s.vault_image_file("img//a.png"), Err(VaultFileErr::Invalid));
        assert_eq!(s.vault_image_file("img\\a.png"), Err(VaultFileErr::Invalid));
        assert_eq!(s.vault_image_file(""), Err(VaultFileErr::Invalid));
        #[cfg(unix)]
        {
            assert_eq!(
                s.vault_image_file("img/link.png"),
                Err(VaultFileErr::Forbidden)
            );
            assert_eq!(
                s.vault_image_file("up/outside.png"),
                Err(VaultFileErr::Forbidden)
            );
        }
        assert_eq!(s.image_files(), vec!["img/a.png".to_string()]);
        fs::create_dir_all(vault.join("n")).unwrap();
        fs::write(
            vault.join("n/page.md"),
            "![[a.png|40]]\n\n![x](../img/a.png)\n\n![y](img/link.png)",
        )
        .unwrap();
        let v = s.read_note_impl("n/page.md").unwrap();
        let h = v["html"].as_str().unwrap();
        assert!(
            h.contains(r#"width="40""#) && h.matches("path=img/a.png").count() == 2,
            "{h}"
        );
        assert!(h.contains("image not found: img/link.png"), "{h}");
        let _ = fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod note_ops_tests {
    use super::*;
    use crate::privacy::{lock_as, PathView};
    use std::sync::{Arc, Mutex};

    fn vault(tag: &str) -> (PathBuf, MemoryStore) {
        let d = std::env::temp_dir().join(format!(
            "memora-notes-{tag}-{}-{}",
            std::process::id(),
            UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        for f in ["Notes", "Templates", "Private", "Projects/Atlas"] {
            fs::create_dir_all(d.join(f)).unwrap();
        }
        fs::write(d.join("Notes/Ideas.md"), "# Ideas\n").unwrap();
        fs::write(d.join("Private/Secret.md"), "secret {{title}}").unwrap();
        fs::write(
            d.join("Templates/Meeting.md"),
            "# {{title}} on {{date}} with {{who}}",
        )
        .unwrap();
        let s = MemoryStore::new(&d);
        (d, s)
    }

    fn msg<T: std::fmt::Debug>(r: MResult<T>) -> String {
        r.unwrap_err().0
    }

    /// Hides `Private/` and `Templates/Hidden.md`.
    struct View;
    impl PathView for View {
        fn visible(&self, rel: &str) -> bool {
            let l = rel.trim_start_matches('/').to_lowercase();
            !(l == "private" || l.starts_with("private/") || l == "templates/hidden.md")
        }
        fn mentions_hidden(&self, text: &str) -> bool {
            text.to_lowercase().contains("private/")
        }
    }

    #[test]
    fn templates_come_only_from_the_templates_folder() {
        let (d, s) = vault("tpl");
        let e = msg(s.template_create_impl("Private/Secret.md", "x", "Root", None));
        assert!(e.starts_with("template not found"), "{e}");
        assert!(!d.join("x.md").exists());
        assert_eq!(
            msg(s.template_create_impl("", "x", "Root", None))
                .split(':')
                .next(),
            Some("template is required")
        );
        assert!(
            msg(s.template_create_impl("/etc/passwd", "x", "Root", None)).contains("Templates/")
        );
        let vars: Map<String, Value> = [("who".to_string(), json!("Ana"))].into_iter().collect();
        for (i, name) in ["Meeting", "Meeting.md", "Templates/Meeting.md"]
            .iter()
            .enumerate()
        {
            let title = format!("Sync {i}");
            let p = s
                .template_create_impl(name, &title, "Notes", Some(&vars))
                .unwrap();
            let body = fs::read_to_string(d.join(&p)).unwrap();
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            assert_eq!(body, format!("# Sync {i} on {today} with Ana"));
        }
        // A given variable wins over the built-in.
        let vars: Map<String, Value> = [("title".to_string(), json!("T"))].into_iter().collect();
        let p = s
            .template_create_impl("Meeting", "Other", "Notes", Some(&vars))
            .unwrap();
        assert!(fs::read_to_string(d.join(p)).unwrap().starts_with("# T on"));
        // A template hidden from the caller answers exactly like a missing one.
        fs::write(d.join("Templates/Hidden.md"), "h").unwrap();
        let m = Mutex::new(s);
        let v = lock_as(&m, Some(Arc::new(View)));
        let hidden = msg(v.template_create_impl("Hidden", "a", "Root", None));
        let missing = msg(v.template_create_impl("Nope", "a", "Root", None));
        assert_eq!(hidden.replace("Hidden", "X"), missing.replace("Nope", "X"));
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn create_refuses_unsafe_folders_and_titles() {
        let (d, s) = vault("create");
        for f in ["/etc", "\\etc", "C:/x"] {
            let e = msg(s.create_impl("evil", f, None));
            assert!(e.contains("folder must be relative to the vault"), "{e}");
        }
        assert!(!d.join("etc/evil.md").exists());
        // Blank folder is the top level (callers choose the default first).
        assert_eq!(s.create_impl("Top", "   ", None).unwrap(), "Top.md");
        // Windows drops trailing spaces from a path, so look for the entry itself.
        assert!(!fs::read_dir(&d).unwrap().flatten().any(|e| e
            .file_name()
            .to_string_lossy()
            .trim()
            .is_empty()));
        assert_eq!(
            msg(s.create_impl("x", "Notes/Ideas.md", None)),
            "folder `Notes/Ideas.md` is a note, not a folder"
        );
        assert_eq!(
            s.create_impl("Plan.md", "Notes", None).unwrap(),
            "Notes/Plan.md"
        );
        for t in ["a/b", "a\\b", "../evil", "..evil"] {
            assert!(s.create_impl(t, "Notes", None).is_err(), "{t:?} accepted");
        }
        assert!(title_notice("Plan", "Notes/Plan.md").is_none());
        assert!(title_notice("My Plan", "Notes/My_Plan.md").is_none());
        assert!(title_notice("Plan 🚀", "Notes/Plan.md").is_some());
        assert!(title_notice(&"x".repeat(300), "x").is_some());
        // Names differing only in case are one name.
        let e = msg(s.create_impl("ideas", "Notes", None));
        assert_eq!(
            e,
            "already exists (names are compared without case): Notes/Ideas.md"
        );
        // The stub heading uses the title without `.md`.
        let stub = fs::read_to_string(d.join("Notes/Plan.md")).unwrap();
        assert!(stub.contains("# Plan\n"), "{stub}");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn rename_move_and_duplicate_check_targets() {
        let (d, s) = vault("move");
        fs::write(d.join("Notes/Other.md"), "o").unwrap();
        let e = msg(s.rename_impl("Notes/Other.md", "IDEAS"));
        assert!(e.contains("names are compared without case"), "{e}");
        // A case-only rename of the note itself is fine.
        assert_eq!(
            s.rename_impl("Notes/Other.md", "other").unwrap(),
            "Notes/other.md"
        );
        assert!(msg(s.move_impl("Notes/other.md", "/etc")).contains("relative to the vault"));
        assert_eq!(
            msg(s.move_impl("Notes/other.md", "Notes/Ideas.md")),
            "folder `Notes/Ideas.md` is a note, not a folder"
        );
        fs::write(d.join("Projects/ideas.md"), "dup").unwrap();
        assert!(msg(s.move_impl("Projects/ideas.md", "Notes")).contains("without case"));
        assert_eq!(s.move_impl("Notes\\other.md", "Root").unwrap(), "other.md");
        // Duplicate: backslash paths, nested folders, long names.
        assert_eq!(
            s.duplicate_memory_impl("Notes\\Ideas.md").unwrap(),
            "Notes/Ideas-copy.md"
        );
        fs::write(d.join("Projects/Atlas/Overview.md"), "o").unwrap();
        assert_eq!(
            s.duplicate_memory_impl("Projects/Atlas/Overview.md")
                .unwrap(),
            "Projects/Atlas/Overview-copy.md"
        );
        let long = "L".repeat(80);
        fs::write(d.join(format!("Notes/{long}.md")), "l").unwrap();
        let copy = s
            .duplicate_memory_impl(&format!("Notes/{long}.md"))
            .unwrap();
        assert_eq!(copy, format!("Notes/{}-copy.md", "L".repeat(75)));
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn read_and_save_normalize_backslashes() {
        let (d, s) = vault("norm");
        fs::write(d.join("Notes/Link.md"), "see [[Ideas]]").unwrap();
        let v = s.read_note_impl("Notes\\Ideas.md").unwrap();
        assert_eq!(v["path"], "Notes/Ideas.md");
        assert_eq!(v["backlinks"][0]["path"], "Notes/Link.md");
        s.save_impl("Notes\\Ideas.md", "new").unwrap();
        assert_eq!(fs::read_to_string(d.join("Notes/Ideas.md")).unwrap(), "new");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn batch_create_checks_every_item_first() {
        let (d, s) = vault("batch");
        let e = msg(s.batch_create_impl(&[
            json!({"title": "Good"}),
            json!("str"),
            json!({"contnet": "x"}),
            json!({"title": "T", "content": 5}),
            json!({"title": "U", "folder": "/etc"}),
        ]));
        assert!(e.starts_with("nothing was created"), "{e}");
        for part in [
            "item 2: must be an object",
            "item 3: unknown key `contnet`",
            "item 3: title is required",
            "item 4: content must be a string",
            "item 5: folder must be relative",
        ] {
            assert!(e.contains(part), "{part} missing in {e}");
        }
        assert!(!d.join("Memory/Good.md").exists() && !d.join("Untitled.md").exists());
        assert!(s.batch_create_impl(&[]).is_err());
        let r = s
            .batch_create_impl(&[
                json!({"title": "Good"}),
                json!({"title": "Two", "folder": "Notes", "content": "c"}),
                json!({"title": "ideas", "folder": "Notes"}),
                json!({"title": "Bad 🚀"}),
            ])
            .unwrap();
        assert_eq!(r[0]["path"], "Memory/Good.md");
        assert_eq!(r[1]["path"], "Notes/Two.md");
        assert_eq!(r[2]["ok"], false);
        assert_eq!(r[2]["item"], 3);
        assert_eq!(r[3]["renamed_from"], "Bad 🚀");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn merge_validates_sources_and_target() {
        let (d, s) = vault("merge");
        fs::write(
            d.join("Notes/A.md"),
            "---\ntags: [alpha, shared]\ncreated: 2026-01-01\n---\n\nbody A\n",
        )
        .unwrap();
        fs::write(d.join("Notes/B.md"), "---\ntags:\n  - beta\n---\nbody B").unwrap();
        fs::create_dir_all(d.join("QM")).unwrap();
        let a = || json!("Notes/A.md");
        assert!(msg(s.merge_memory_impl(&[a()], "")).starts_with("into is required"));
        assert!(msg(s.merge_memory_impl(&[a()], "/tmp/x.md")).contains("relative to the vault"));
        assert!(msg(s.merge_memory_impl(&[a()], "QM")).contains("is a folder"));
        assert!(msg(s.merge_memory_impl(&[], "Out.md")).starts_with("paths is required"));
        assert!(msg(s.merge_memory_impl(&[json!("")], "Out.md")).contains("empty path"));
        assert!(msg(s.merge_memory_impl(&[json!(5)], "Out.md")).contains("strings"));
        assert!(msg(s.merge_memory_impl(&[json!("Notes")], "Out.md")).contains("is a folder"));
        assert_eq!(
            msg(s.merge_memory_impl(&[a(), json!("Nope.md")], "Out.md")),
            "not found: Nope.md (nothing was merged)"
        );
        assert!(msg(s.merge_memory_impl(&[a(), a()], "Out.md")).contains("more than once"));
        assert!(msg(s.merge_memory_impl(&[a()], "Notes/A")).contains("into itself"));
        assert!(!d.join("Out.md").exists() && !d.join("QM.md").exists());
        // A target without `.md` that exists is appended to.
        fs::write(d.join("QM/MT.md"), "---\ntags: [old]\n---\n# MT\n").unwrap();
        let r = s
            .merge_memory_impl(&[a(), json!("Notes/B.md")], "QM/MT")
            .unwrap();
        assert_eq!(r["into"], "QM/MT.md");
        assert_eq!(r["merged"], 2);
        assert_eq!(r["created"], false);
        let out = fs::read_to_string(d.join("QM/MT.md")).unwrap();
        assert!(
            out.contains("## from A\n\nbody A") && out.contains("## from B\n\nbody B"),
            "{out}"
        );
        assert_eq!(
            out.matches("---").count(),
            2,
            "source frontmatter pasted: {out}"
        );
        let tags = s.get_note_tags_impl("QM/MT.md").unwrap();
        for t in ["old", "alpha", "shared", "beta"] {
            assert!(
                tags["frontmatter_tags"].to_string().contains(t),
                "{t}: {tags}"
            );
        }
        // Sources are kept; a new target is created.
        assert!(d.join("Notes/A.md").exists());
        let r = s.merge_memory_impl(&[a()], "QM/New").unwrap();
        assert_eq!(
            (r["into"].as_str(), r["created"].as_bool()),
            (Some("QM/New.md"), Some(true))
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn validate_flags_dates_malformed_frontmatter_and_names_links() {
        let (d, s) = vault("validate");
        let check = |body: &str| {
            fs::write(d.join("Notes/V.md"), body).unwrap();
            s.validate_memory_impl("Notes\\V.md").unwrap()
        };
        for bad in ["notadate", "2026-13-45"] {
            let v = check(&format!("---\ncreated: {bad}\ntags: [a]\n---\nx"));
            assert!(
                v["issues"][0]
                    .as_str()
                    .unwrap()
                    .contains("not a valid date"),
                "{v}"
            );
        }
        for good in [
            "2026-01-02",
            "2026-01-02T10:00:00+07:00",
            "2026-01-02 10:00",
        ] {
            let v = check(&format!("---\ncreated: {good}\ntags: [a]\n---\nx"));
            assert_eq!(v["ok"], true, "{good}: {v}");
        }
        let v = check("---\ncreated: 2026-01-01\ntags: [a]\nx");
        assert_eq!(
            v["issues"],
            json!(["malformed frontmatter: no closing `---` line"])
        );
        let v = check("---\njust words\n---\nx");
        assert!(
            v["issues"][0]
                .as_str()
                .unwrap()
                .starts_with("malformed frontmatter"),
            "{v}"
        );
        let v = check("---\ncreated: 2026-01-01\ntags: [a]\n---\nsee [[Nowhere]] and [[Ideas]]");
        assert_eq!(v["issues"], json!(["broken link(s): [[Nowhere]]"]));
        assert_eq!(v["broken_links"], json!(["Nowhere"]));
        assert_eq!(v["path"], "Notes/V.md");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn export_refuses_missing_paths_and_import_reports_each_entry() {
        use std::io::Write;
        let (d, s) = vault("zip");
        assert_eq!(
            msg(s.export_zip_impl(&[json!("Notes/Ideas.md"), json!("Nope.md")])),
            "not found: Nope.md (nothing was exported)"
        );
        // A note inside an exported folder is written once.
        let z = s
            .export_zip_impl(&[json!("Notes"), json!("Notes\\Ideas.md")])
            .unwrap();
        assert_eq!(
            zip::ZipArchive::new(std::io::Cursor::new(z)).unwrap().len(),
            1
        );

        assert!(msg(s.import_zip_impl(b"not a zip", false)).starts_with("not a valid zip file"));
        let mut buf = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let o = zip::write::SimpleFileOptions::default();
            for (name, body) in [
                ("Notes/Ideas.md", "replaced"),
                ("Notes/New.md", "new"),
                ("../evil.md", "x"),
                ("/abs.md", "x"),
                (".git/x.md", "x"),
            ] {
                zw.start_file(name, o).unwrap();
                zw.write_all(body.as_bytes()).unwrap();
            }
            zw.finish().unwrap();
        }
        let r = s.import_zip_impl(&buf, false).unwrap();
        assert_eq!(r["added"], json!(["Notes/New.md"]));
        assert_eq!(r["skipped"], json!(["Notes/Ideas.md"]));
        assert_eq!(r["overwritten"], json!([]));
        assert_eq!(r["unsafe"].as_array().unwrap().len(), 3, "{r}");
        assert_eq!(r["unsafe"][0]["reason"], "path leaves the vault");
        assert_eq!(r["unsafe"][1]["reason"], "absolute path");
        assert!(!d.join("abs.md").exists());
        let r = s.import_zip_impl(&buf, true).unwrap();
        assert_eq!(r["overwritten"], json!(["Notes/Ideas.md", "Notes/New.md"]));
        assert_eq!(
            fs::read_to_string(d.join("Notes/Ideas.md")).unwrap(),
            "replaced"
        );
        fs::remove_dir_all(&d).ok();
    }

    /// Import never uses the zip crate's extract(): a symlink entry or a
    /// setuid mode in the archive (RUSTSEC-2026-0367/0368/0369) only ever
    /// becomes a plain note holding the entry's bytes.
    #[test]
    fn import_writes_symlink_and_setuid_entries_as_plain_notes() {
        use std::io::Write;
        let (d, s) = vault("zip-links");
        let mut buf = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let o = zip::write::SimpleFileOptions::default();
            zw.add_symlink("Notes/Link.md", "/etc/passwd", o).unwrap();
            zw.start_file("Notes/Suid.md", o.unix_permissions(0o4755))
                .unwrap();
            zw.write_all(b"suid").unwrap();
            zw.finish().unwrap();
        }
        let r = s.import_zip_impl(&buf, false).unwrap();
        assert_eq!(r["added"], json!(["Notes/Link.md", "Notes/Suid.md"]), "{r}");
        let link = d.join("Notes/Link.md");
        assert!(!fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(&link).unwrap(), "/etc/passwd");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(d.join("Notes/Suid.md"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o7000, 0, "mode {mode:o}");
        }
        fs::remove_dir_all(&d).ok();
    }
}

#[cfg(test)]
mod folder_tests {
    use super::*;

    #[test]
    fn icons_take_exactly_one_emoji() {
        for ok in [
            "🦄",
            "👍🏽",
            "👨\u{200D}👩\u{200D}👧",
            "🇮🇩",
            "⭐",
            "❤\u{FE0F}",
        ] {
            assert!(is_folder_icon(ok), "{ok}");
        }
        for bad in ["🦄🦄", "⭐x", "🇮", "🇮🇩🇮🇩", "a"] {
            assert!(!is_folder_icon(bad), "{bad}");
        }
    }

    #[test]
    fn a_move_into_a_note_named_without_md_is_refused() {
        let (d, s) = vault(
            "bare-note",
            &[("Readme.md", "# R\n"), ("Fresh/A.md", "# A\n")],
        );
        let e = s.move_folder_impl("Fresh", "Readme").unwrap_err().0;
        assert!(e.contains("is a note, not a folder"), "{e}");
        assert!(!d.join("Readme").exists());
        assert!(d.join("Fresh/A.md").exists());
    }

    fn vault(tag: &str, files: &[(&str, &str)]) -> (PathBuf, MemoryStore) {
        let d = std::env::temp_dir().join(format!(
            "memora-folders-{tag}-{}-{}",
            std::process::id(),
            UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        for (rel, body) in files {
            let p = d.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, body).unwrap();
        }
        fs::create_dir_all(&d).unwrap();
        let s = MemoryStore::new(&d);
        (d, s)
    }

    fn read(d: &Path, rel: &str) -> String {
        fs::read_to_string(d.join(rel)).unwrap()
    }

    /// Hides everything under `Private/`.
    struct HidePrivate;
    impl crate::privacy::PathView for HidePrivate {
        fn visible(&self, rel: &str) -> bool {
            let l = rel.trim_start_matches('/').to_lowercase();
            l != "private" && !l.starts_with("private/")
        }
        fn mentions_hidden(&self, text: &str) -> bool {
            text.to_lowercase().contains("private/")
        }
    }

    #[test]
    fn moving_a_note_rewrites_path_links_in_every_form() {
        let (d, s) = vault(
            "move-links",
            &[
                ("Projects/Atlas/Overview.md", "# Overview\n"),
                (
                    "a.md",
                    "[[Projects/Atlas/Overview]] [[Projects/Atlas/Overview|alias]] \
                     [[Projects/Atlas/Overview#Goals]] [[Projects/Atlas/Overview.md]] \
                     [[Atlas/Overview#Goals|g]] [[Overview]] `[[Projects/Atlas/Overview]]`\n\
                     | a | [[Projects/Atlas/Overview\\|t]] |\n",
                ),
                ("b.md", "nothing to see [[Elsewhere/Overview]]\n"),
                ("c.md", "no links\n"),
            ],
        );
        let (to, n) = s
            .move_note("Projects/Atlas/Overview.md", "Archive")
            .unwrap();
        assert_eq!(to, "Archive/Overview.md");
        assert_eq!(n, 1, "only a.md changed");
        assert_eq!(
            read(&d, "a.md"),
            "[[Archive/Overview]] [[Archive/Overview|alias]] [[Archive/Overview#Goals]] \
             [[Archive/Overview.md]] [[Archive/Overview#Goals|g]] [[Overview]] \
             `[[Projects/Atlas/Overview]]`\n| a | [[Archive/Overview\\|t]] |\n"
        );
        // A broken link stays as it was.
        assert_eq!(read(&d, "b.md"), "nothing to see [[Elsewhere/Overview]]\n");
        // Every rewritten link resolves to the moved note.
        assert_eq!(
            s.resolve_wikilink("Archive/Overview").as_deref(),
            Some("Archive/Overview.md")
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn renaming_a_note_rewrites_bare_and_path_links_that_named_it() {
        let (d, s) = vault(
            "rename-links",
            &[
                ("Notes/Ideas.md", "# Ideas\n"),
                ("Other/Ideas.md", "# Other ideas\n"),
                ("Notes/near.md", "[[Ideas]] and [[ideas|mine]]\n"),
                ("Other/far.md", "[[Ideas]] is the other one\n"),
                ("top.md", "[[Ideas]] [[Notes/Ideas#H]] [[Other/Ideas]]\n"),
            ],
        );
        let (to, n) = s.rename_note("Notes/Ideas.md", "Ideas2").unwrap();
        assert_eq!(to, "Notes/Ideas2.md");
        assert_eq!(n, 2);
        assert_eq!(
            read(&d, "Notes/near.md"),
            "[[Ideas2]] and [[Ideas2|mine]]\n"
        );
        // It named Other/Ideas.md before and still does.
        assert_eq!(read(&d, "Other/far.md"), "[[Ideas]] is the other one\n");
        // From the top `[[Ideas]]` meant Notes/Ideas.md (alphabetical tie-break); left
        // alone it would now name Other/Ideas.md.
        assert_eq!(
            read(&d, "top.md"),
            "[[Ideas2]] [[Notes/Ideas2#H]] [[Other/Ideas]]\n"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_bare_link_that_would_name_another_note_gets_its_path() {
        let (d, s) = vault(
            "shadow",
            &[
                ("A/Plan.md", "# A plan\n"),
                ("B/Plan.md", "# B plan\n"),
                ("B/x.md", "[[Plan]]\n"),
                ("A/mover.md", "[[Plan]]\n"),
            ],
        );
        // B/x.md links to B/Plan.md (own folder); moving A/Plan.md into B is refused
        // (same name), so move the linking note instead: from A its `[[Plan]]` meant
        // A/Plan.md, in B it would mean B/Plan.md.
        let (_, n) = s.move_note("A/mover.md", "B").unwrap();
        assert_eq!(n, 1);
        assert_eq!(read(&d, "B/mover.md"), "[[A/Plan]]\n");
        assert_eq!(read(&d, "B/x.md"), "[[Plan]]\n");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn folder_renames_and_moves_rewrite_links_to_notes_inside() {
        let (d, s) = vault(
            "folder-links",
            &[
                (
                    "Projects/Atlas/Overview.md",
                    "see [[Projects/Atlas/Sub/Deep]]\n",
                ),
                ("Projects/Atlas/Sub/Deep.md", "deep\n"),
                (
                    "a.md",
                    "[[Projects/Atlas/Overview]] [[Atlas/Overview#h|x]] [[Overview]]\n",
                ),
            ],
        );
        let v = s.rename_folder_impl("Projects/Atlas", "Atlas2").unwrap();
        assert_eq!(v["links_updated"], 2, "{v}");
        assert_eq!(
            read(&d, "a.md"),
            "[[Projects/Atlas2/Overview]] [[Projects/Atlas2/Overview#h|x]] [[Overview]]\n"
        );
        assert_eq!(
            read(&d, "Projects/Atlas2/Overview.md"),
            "see [[Projects/Atlas2/Sub/Deep]]\n"
        );
        let v = s.move_folder_impl("Projects/Atlas2", "Archive").unwrap();
        assert_eq!(v["created"], true);
        assert_eq!(v["links_updated"], 2);
        assert!(read(&d, "a.md").starts_with("[[Archive/Atlas2/Overview]]"));
        let v = s
            .move_folder_contents_impl("Archive/Atlas2", "Done")
            .unwrap();
        assert_eq!(v["links_updated"], 2, "{v}");
        assert!(read(&d, "a.md").starts_with("[[Done/Overview]]"));
        assert_eq!(read(&d, "Done/Overview.md"), "see [[Done/Sub/Deep]]\n");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn hidden_notes_are_rewritten_but_never_counted() {
        let (d, s) = vault(
            "links-private",
            &[
                ("Notes/Plan.md", "plan\n"),
                ("Private/secret.md", "[[Notes/Plan]]\n"),
                ("open.md", "[[Notes/Plan]]\n"),
            ],
        );
        let m = std::sync::Mutex::new(s);
        let s = crate::privacy::lock_as(&m, Some(std::sync::Arc::new(HidePrivate)));
        let (_, n) = s.move_note("Notes/Plan.md", "Work").unwrap();
        assert_eq!(n, 1, "only the visible note is counted");
        assert_eq!(read(&d, "Private/secret.md"), "[[Work/Plan]]\n");
        assert_eq!(read(&d, "open.md"), "[[Work/Plan]]\n");
        drop(s);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn deleting_a_folder_keeps_structure_and_links() {
        let (d, s) = vault(
            "delete-keep",
            &[
                ("A/B/one.md", "1"),
                ("A/B/C/two.md", "2"),
                ("A/B/B/three.md", "3"),
                ("A/C/two.md", "clash"),
                ("x.md", "[[A/B/C/two]] [[A/B/one|o]]"),
            ],
        );
        let v = s.delete_folder_impl("A/B").unwrap();
        assert_eq!(v["moved_to"], "A");
        assert!(v.get("moved_to_root").is_none());
        assert!(d.join("A/one.md").is_file());
        assert!(d.join("A/C/two-1.md").is_file() && read(&d, "A/C/two.md") == "clash");
        assert!(d.join("A/B-1/three.md").is_file(), "{v}");
        assert!(!d.join("A/B").exists());
        assert_eq!(read(&d, "x.md"), "[[A/C/two-1]] [[A/one|o]]");
        assert_eq!(v["links_updated"], 1);
        let v = s.delete_folder_impl("A").unwrap();
        assert_eq!(v["moved_to"], "Root");
        assert_eq!(v["moved_to_root"].as_array().unwrap().len(), 4, "{v}");
        assert!(d.join("C/two.md").is_file() && d.join("one.md").is_file());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn deleting_a_folder_into_another_folder_keeps_structure() {
        let (d, s) = vault(
            "delete-into",
            &[
                ("A/B/one.md", "1"),
                ("A/B/C/two.md", "2"),
                ("Keep/one.md", "clash"),
                ("x.md", "[[A/B/C/two]]"),
            ],
        );
        assert!(s.delete_folder_with("A/B", Some("A/B/C"), None).is_err());
        assert!(s.delete_folder_with("A/B", Some("Nope"), None).is_err());
        assert!(s
            .delete_folder_with("A/B", Some("Keep"), Some("trash"))
            .is_err());
        assert!(
            d.join("A/B/one.md").is_file(),
            "refused calls change nothing"
        );
        let v = s.delete_folder_with("A/B", Some("Keep"), None).unwrap();
        assert_eq!(v["moved_to"], "Keep");
        assert!(d.join("Keep/one-1.md").is_file() && read(&d, "Keep/one.md") == "clash");
        assert!(d.join("Keep/C/two.md").is_file());
        assert!(!d.join("A/B").exists() && d.join("A").is_dir());
        assert_eq!(read(&d, "x.md"), "[[Keep/C/two]]");
        fs::create_dir_all(d.join("A/Z")).unwrap();
        fs::write(d.join("A/Z/z.md"), "z").unwrap();
        let v = s.delete_folder_with("A/Z", Some("Root"), None).unwrap();
        assert_eq!(v["moved_to"], "Root");
        assert!(d.join("z.md").is_file());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn deleting_a_folder_in_trash_mode_trashes_every_note() {
        let (d, s) = vault(
            "delete-trash",
            &[
                ("A/one.md", "1"),
                ("A/B/one.md", "1b"),
                ("A/B/img.png", "png"),
                ("x.md", "[[A/one]]"),
            ],
        );
        let v = s.delete_folder_with("A", None, Some("trash")).unwrap();
        assert_eq!(v["mode"], "trash");
        assert_eq!(v["count"], 2, "{v}");
        assert!(!d.join("A").exists());
        assert!(d.join(".Trash/one.md").is_file() && d.join(".Trash/one-1.md").is_file());
        let originals: BTreeSet<String> = s
            .list_trash_impl()
            .iter()
            .filter_map(|t| t["original"].as_str().map(String::from))
            .collect();
        assert_eq!(
            originals,
            BTreeSet::from(["A/one.md".to_string(), "A/B/one.md".to_string()])
        );
        assert_eq!(read(&d, "x.md"), "[[A/one]]", "links are left alone");
        // Which copy gets the `-1` name depends on the walk order (it differs on Windows).
        let nested = s
            .list_trash_impl()
            .into_iter()
            .find(|t| t["original"] == "A/B/one.md")
            .and_then(|t| t["name"].as_str().map(String::from))
            .unwrap();
        s.restore_trash_impl(&nested, "").unwrap();
        assert!(d.join("A/B/one.md").is_file());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn create_folder_checks_names_and_never_touches_existing_folders() {
        let (d, s) = vault("create", &[("Work/n.md", "n")]);
        for bad in [
            "Root", "root", "ROOT/Sub", "/etc", "../Out", "a\\b", "A/../B", ".git",
        ] {
            assert!(s.create_folder(bad).is_err(), "{bad}");
        }
        assert!(!d.join("Root").exists() && !d.join("root").exists());
        let long = "x".repeat(300);
        let e = s.create_folder(&long).unwrap_err().to_string();
        assert!(e.contains("too long"), "{e}");
        // Existing: nothing written.
        let v = s.create_folder("Work").unwrap();
        assert_eq!(v["existed"], true);
        assert!(!d.join("Work/Index.md").exists());
        // New: Index.md, and a note when the name was cleaned.
        let v = s.create_folder("My Folder").unwrap();
        assert_eq!(v["folder"], "My_Folder");
        assert_eq!(v["existed"], false);
        assert!(v["note"].as_str().unwrap().contains("My_Folder"));
        assert!(d.join("My_Folder/Index.md").is_file());
        // Nested Root below the top level is an ordinary name.
        assert!(s.create_folder("Work/Root").is_ok());
        // A hidden existing folder answers exactly like a visible one, untouched.
        fs::create_dir_all(d.join("Private")).unwrap();
        let m = std::sync::Mutex::new(s);
        let v = crate::privacy::lock_as(&m, Some(std::sync::Arc::new(HidePrivate)));
        let hidden = v.create_folder("Private").unwrap();
        let visible = v.create_folder("Work").unwrap();
        assert_eq!(hidden["existed"], visible["existed"]);
        assert_eq!(
            hidden.as_object().unwrap().len(),
            visible.as_object().unwrap().len()
        );
        assert!(!d.join("Private/Index.md").exists());
        drop(v);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn folder_moves_refuse_bad_names_and_destinations() {
        let (d, s) = vault(
            "move-checks",
            &[("padded/n.md", "n"), ("Readme.md", "r"), ("Work/w.md", "w")],
        );
        for bad in ["a/b", "a\\b", "../Out", ".hidden"] {
            assert!(s.rename_folder_impl("padded", bad).is_err(), "{bad}");
        }
        assert!(s.rename_folder_impl("padded", "Root").is_err());
        let e = s
            .rename_folder_impl("padded", &"y".repeat(300))
            .unwrap_err()
            .to_string();
        assert!(e.contains("too long"), "{e}");
        let e = s
            .move_folder_impl("padded", "Readme.md")
            .unwrap_err()
            .to_string();
        assert!(e.contains("is a note, not a folder"), "{e}");
        assert!(!d.join("Readmemd").exists());
        for bad in ["/etc", "../x", "Root/Sub"] {
            assert!(s.move_folder_impl("padded", bad).is_err(), "{bad}");
            assert!(s.move_folder_contents_impl("padded", bad).is_err(), "{bad}");
        }
        assert!(s.delete_folder_impl("/etc").is_err());
        assert!(s.delete_folder_impl("/padded").is_err());
        assert!(s.move_impl("Readme.md", "/etc").is_err());
        assert!(s.move_impl("Readme.md", "Root/x").is_err());
        assert!(d.join("padded/n.md").is_file() && !d.join("etc").exists());
        // Cleaning that changes a name is reported.
        let v = s.rename_folder_impl("padded", "My Pad").unwrap();
        assert_eq!(v["to"], "My_Pad");
        assert!(v["note"].is_string());
        // `root` in any case is the top level for moves.
        let v = s.move_folder_impl("Work", "Into").unwrap();
        assert_eq!(v["created"], true);
        let v = s.move_folder_impl("Into/Work", "root").unwrap();
        assert_eq!(
            (v["to"].as_str(), v["created"].as_bool()),
            (Some("Work"), Some(false))
        );
        fs::remove_dir_all(&d).ok();
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_contents_move_names_the_item_and_what_moved() {
        use std::os::unix::fs::PermissionsExt;
        let (d, s) = vault("partial", &[("Src/a.md", "a"), ("Src/Sub/b.md", "b")]);
        fs::create_dir_all(d.join("Dest")).unwrap();
        // A directory without write permission cannot change parents (its `..`).
        fs::set_permissions(d.join("Src/Sub"), fs::Permissions::from_mode(0o555)).unwrap();
        let probe = fs::write(d.join("Src/Sub/probe"), "").is_ok();
        let r = s.move_folder_contents_impl("Src", "Dest");
        let _ = fs::set_permissions(d.join("Src/Sub"), fs::Permissions::from_mode(0o755));
        if !probe {
            let e = r.unwrap_err().to_string();
            assert!(e.contains("could not move Src/Sub to Dest/Sub"), "{e}");
            assert!(e.contains("the rest is still in Src"), "{e}");
            if d.join("Dest/a.md").is_file() {
                assert!(e.contains("already moved: Dest/a.md"), "{e}");
            }
            assert!(d.join("Src/Sub/b.md").is_file());
        }
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn folder_stats_and_meta_refuse_missing_folders() {
        let (d, s) = vault("stats", &[("Work/a.md", "a"), ("top.md", "t")]);
        for bad in ["Nope", "../x", "/etc", "   "] {
            assert!(s.folder_stats_impl(bad).is_err(), "{bad}");
            assert!(s.get_folder_meta_impl(Some(bad)).is_err(), "{bad}");
        }
        assert_eq!(s.folder_stats_impl("Work").unwrap()["notes"], 1);
        assert_eq!(s.folder_stats_impl("Root").unwrap()["notes"], 1);
        assert_eq!(s.folder_stats_impl("Root").unwrap()["meta"], json!({}));
        assert_eq!(s.get_folder_meta_impl(Some("Work")).unwrap(), json!({}));
        // Hidden answers like missing.
        let m = std::sync::Mutex::new(MemoryStore::new(&d));
        fs::create_dir_all(d.join("Private")).unwrap();
        fs::write(d.join("Private/p.md"), "p").unwrap();
        let v = crate::privacy::lock_as(&m, Some(std::sync::Arc::new(HidePrivate)));
        assert_eq!(
            v.folder_stats_impl("Private").unwrap_err().to_string(),
            v.folder_stats_impl("Nope2")
                .unwrap_err()
                .to_string()
                .replace("Nope2", "Private")
        );
        drop(v);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn folder_meta_checks_root_icons_and_desc() {
        let (d, s) = vault("meta", &[("Work/a.md", "a")]);
        let e = s
            .set_folder_meta_impl("Root", Some("#000000"), None, None)
            .unwrap_err()
            .to_string();
        assert!(
            e.contains("Root (the top level) has no folder metadata"),
            "{e}"
        );
        for ok in [
            "rocket",
            "Credit Card",
            "lucide:flask",
            "gear",
            "🚀",
            "👩‍💻",
            "📁",
        ] {
            assert!(
                s.set_folder_meta_impl("Work", None, Some(ok), None).is_ok(),
                "{ok}"
            );
        }
        for bad in ["not-an-icon", "rocket ship", "a", "🚀 go", "ab12"] {
            let e = s
                .set_folder_meta_impl("Work", None, Some(bad), None)
                .unwrap_err()
                .to_string();
            assert!(
                e.contains("one emoji or one of these icon names"),
                "{bad}: {e}"
            );
        }
        let long = "d".repeat(501);
        let e = s
            .set_folder_meta_impl("Work", None, None, Some(&long))
            .unwrap_err()
            .to_string();
        assert!(e.contains("at most 500 characters"), "{e}");
        assert!(s
            .set_folder_meta_impl("Work", None, None, Some(&"d".repeat(500)))
            .is_ok());
        fs::remove_dir_all(&d).ok();
    }
}

#[cfg(test)]
mod inline_tag_tests {
    use super::*;

    fn tags(body: &str) -> Vec<String> {
        inline_tags(body)
    }

    #[test]
    fn inline_code_spans_give_no_tags() {
        assert_eq!(tags("color `#5eead4` here #real"), ["real"]);
        assert_eq!(tags("``a ` #nope`` and #yes"), ["yes"]);
        assert_eq!(tags("span `across\n#line` #after"), ["after"]);
        // An unmatched backtick is literal text, so the tag still counts.
        assert_eq!(tags("a ` lone #tick"), ["tick"]);
        // A code span does not run across a blank line.
        assert_eq!(tags("open `\n\n#para"), ["para"]);
    }

    #[test]
    fn all_digit_words_are_not_tags() {
        assert_eq!(
            tags("merged PR #2 and issue #42 in #2026"),
            Vec::<String>::new()
        );
        assert_eq!(tags("#2026q1 #v2 #1/2 #ok"), ["2026q1", "v2", "ok"]);
    }

    #[test]
    fn fenced_code_blocks_give_no_tags() {
        let src = "#before\n```css\n.a { color: #5eead4; }\n#inside\n```\n#after\n";
        assert_eq!(tags(src), ["before", "after"]);
        let tilde = "~~~\n#inside\n~~~\n#after";
        assert_eq!(tags(tilde), ["after"]);
        // A longer fence only closes with one at least as long.
        let long = "````\n```\n#inside\n```\n````\n#after";
        assert_eq!(tags(long), ["after"]);
        // A fence in a list item, and an unclosed fence running to the end.
        assert_eq!(tags("- item\n  ```\n  #in\n  ```\n- #out"), ["out"]);
        assert_eq!(tags("#a\n```\n#b\n#c"), ["a"]);
    }

    #[test]
    fn url_fragments_give_no_tags() {
        assert!(tags("see https://github.com/Codrihub/memora#install").is_empty());
        assert!(tags("https://x.y/#frag and www.x.y/#w").is_empty());
        assert!(tags("[docs](https://x.y/a#install) [h](#section)").is_empty());
        assert!(tags("<https://x.y/#auto>").is_empty());
        assert!(tags("[[Note#Heading]] [[#Local]] ![[img#x]] [[N#H|alias]]").is_empty());
        assert!(tags("&#123; a#b x/#c").is_empty());
        assert_eq!(tags("[label #in-text](https://x.y#frag)"), ["in-text"]);
    }

    #[test]
    fn repeated_tags_are_listed_once() {
        let src = "#install https://github.com/Codrihub/memora#install\n\
                   https://github.com/Codrihub/memora#install #Install #b #install";
        assert_eq!(tags(src), ["install", "b"]);
        let fm: Map<String, Value> =
            serde_json::from_value(json!({"tags": ["B", "#new", "install"]})).unwrap();
        assert_eq!(
            body_and_fm_tags("#b #install", &fm),
            ["b", "install", "new"]
        );
    }

    #[test]
    fn normal_tags_still_count() {
        assert_eq!(tags("#start"), ["start"]);
        assert_eq!(tags("text #mid end"), ["mid"]);
        assert_eq!(
            tags("(#paren) a,#comma *#bold* \"#q\""),
            ["paren", "comma", "bold", "q"]
        );
        assert_eq!(
            tags("#catatan #日本語 #café"),
            ["catatan", "日本語", "café"]
        );
        assert_eq!(
            tags("#a/b #proj/memora/ui #v-2 #a/"),
            ["a/b", "proj/memora/ui", "v-2", "a"]
        );
        assert_eq!(tags("日本語、#タグ"), ["タグ"]);
    }

    #[test]
    fn headings_are_not_tags() {
        assert!(tags("# Heading\n## Sub\n### Third").is_empty());
        assert_eq!(tags("# Heading #tag"), ["tag"]);
    }

    #[test]
    fn note_tags_and_render_share_the_scanner() {
        let src = "---\ntags: [fm]\n---\n`#code` #body https://x.y/#frag\n";
        assert_eq!(note_tags(src), ["body", "fm"]);
        let (_, rendered, _) = render_markdown(src, &|_| None);
        assert_eq!(rendered, ["body", "fm"]);
    }

    #[test]
    fn retag_skips_code_and_urls() {
        let src = "#old `#old` https://x.y/#old [[N#old]] #old/sub #older x#old\n```\n#old\n```\n";
        assert_eq!(
            MemoryStore::retag(src, "old", "new"),
            "#new `#old` https://x.y/#old [[N#old]] #new/sub #older x#old\n```\n#old\n```\n"
        );
        assert_eq!(MemoryStore::retag("#OLD #a/b/c", "a/b", "z"), "#OLD #z/c");
    }
}
