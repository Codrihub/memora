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
    let re = Regex::new(r"[^\w\s-]").unwrap();
    let seg = re.replace_all(name, "").trim().replace(' ', "_");
    if seg.is_empty() || seg.starts_with('.') {
        return err(format!("invalid folder name: {name}"));
    }
    Ok(seg)
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
    let re = regex::Regex::new(r"[^\w\s-]").unwrap();
    let name = re.replace_all(title, "").trim().replace(' ', "_");
    if name.is_empty() {
        return err("title produces an empty filename");
    }
    let out: String = name.chars().take(80).collect();
    Ok(out)
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

/// Inline `#tags` of `body` (lines indented by four spaces are code and skipped), then
/// the frontmatter `tags` list, without duplicates.
fn body_and_fm_tags(body: &str, fm: &Map<String, Value>) -> Vec<String> {
    let scannable: String = body
        .lines()
        .filter(|l| !l.trim_start().starts_with("    "))
        .collect::<Vec<_>>()
        .join("\n");
    let mut tags: Vec<String> = re_tag()
        .captures_iter(&scannable)
        .map(|c| c.get(1).unwrap().as_str().to_string())
        .collect();
    if let Some(Value::Array(list)) = fm.get("tags") {
        for t in list {
            let t = t.as_str().unwrap_or("").trim_start_matches('#').trim();
            if !t.is_empty() && !tags.iter().any(|x| x == t) {
                tags.push(t.to_string());
            }
        }
    }
    tags
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
    let size_re = Regex::new(r"^(\d{1,4})(?:x(\d{1,4}))?$").unwrap();
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
    let code_re = Regex::new(r"`([^`]+)`").unwrap();
    let mut codes: Vec<String> = Vec::new();
    out = code_re
        .replace_all(&out, |c: &regex::Captures| {
            codes.push(c.get(1).unwrap().as_str().to_string());
            format!("\u{0}C{}\u{0}", codes.len() - 1)
        })
        .to_string();
    // Code placeholders inside an attribute value turn back into their text.
    let code_ph = Regex::new("\u{0}C(\\d+)\u{0}").unwrap();
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
            let c2 = re_embed().captures(&detoked).unwrap();
            match embed_html(&c2, ctx, false) {
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

    let link_re = Regex::new(r"\[([^\]]+)\]\((https?://[^)\s]+)[^)]*\)").unwrap();
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

    let bold = Regex::new(r"\*\*([^*]+)\*\*").unwrap();
    out = bold.replace_all(&out, "<strong>$1</strong>").to_string();
    let del = Regex::new(r"~~([^~]+)~~").unwrap();
    out = del.replace_all(&out, "<del>$1</del>").to_string();
    out = emphasize(&out);

    let frag_ph = Regex::new("\u{0}H(\\d+)\u{0}").unwrap();
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
    let table_sep = Regex::new(r"^\s*\|?[\s:]*-{2,}[\s:|-]*\|?\s*$").unwrap();
    let list_re = Regex::new(r"^(\s*)([-*+]|\d+[.)])\s+(.+)$").unwrap();
    let head_re = Regex::new(r"^(#{1,6})\s+(.+)$").unwrap();
    let hr_re = Regex::new(r"^\s*((-\s*){3,}|(\*\s*){3,}|(_\s*){3,})$").unwrap();

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
        for (i, seg) in clean.split('/').enumerate() {
            if seg == ".." {
                return err(format!("path escapes the vault: {rel_path}"));
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
                            // Nor may it lead a restricted caller into a hidden path.
                            if self.restricted() {
                                let tail = full.strip_prefix(probe).unwrap_or(Path::new(""));
                                let real_rel = real
                                    .join(tail)
                                    .strip_prefix(&root)
                                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                                    .unwrap_or_default();
                                if !self.visible(&real_rel) {
                                    return err(format!("not found: {rel_path}"));
                                }
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
        } else if self.restricted() {
            return err(format!("not found: {rel_path}"));
        }
        Ok(full)
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
        let t = target.trim().trim_start_matches('/');
        let t = t.strip_suffix(".md").unwrap_or(t).to_lowercase();
        let name = t.rsplit('/').next().unwrap_or(&t).to_string();
        let qualified = t.contains('/');
        let suffix = format!("/{t}");
        let mut best: Option<(u8, usize, String)> = None;
        for (rel, nm, _) in self.walk() {
            if nm.to_lowercase() != name {
                continue;
            }
            let low = rel.to_lowercase();
            let stem = low.strip_suffix(".md").unwrap_or(&low);
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
            let cand = (rank, rel.matches('/').count(), rel.clone());
            if best.as_ref().is_none_or(|b| cand < *b) {
                best = Some(cand);
            }
        }
        best.map(|b| b.2)
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
        // A symlink must not lead a restricted caller into a hidden path.
        if self.restricted() {
            let real = full
                .strip_prefix(&root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            if !self.visible(&real) {
                return Err(VaultFileErr::NotFound);
            }
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

    /// Unique name -> relative path (used for adjacency lookups).
    fn names_map(&self) -> BTreeMap<String, String> {
        let mut m = BTreeMap::new();
        for (rel, name, _) in self.walk() {
            m.insert(name, rel);
        }
        m
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
    /// `(tags, frontmatter)` for a single file.
    pub fn note_tags_fm(&self, fp: &Path) -> (Vec<String>, Value) {
        let content = self.read_raw(fp).unwrap_or_default();
        let resolver = self.resolve_wikilink_closure();
        let (_html, tags, fm) = render_markdown(&content, &resolver);
        (tags, fm)
    }

    pub fn list_tags_impl(&self) -> Vec<Value> {
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for (_rel, _name, fp) in self.walk() {
            let (tags, _) = self.note_tags_fm(&fp);
            for t in tags {
                *counts.entry(t).or_insert(0) += 1;
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
        let fm_tags = fm.get("tags").cloned().unwrap_or(json!([]));
        Ok(json!({"path": path, "tags": tags, "frontmatter_tags": fm_tags}))
    }

    fn tag_list(input: &str) -> Vec<String> {
        input
            .split(',')
            .map(|t| t.trim().trim_start_matches('#').to_string())
            .filter(|t| !t.is_empty())
            .collect()
    }

    pub fn add_tags_impl(&self, path: &str, tags: &str) -> MResult<Value> {
        let list = Self::tag_list(tags);
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
        let ops: Vec<Value> = list
            .iter()
            .map(|t| json!({"op": "remove_tag", "tag": t}))
            .collect();
        self.patch_memory_impl(path, &ops)?;
        self.get_note_tags_impl(path)
    }

    pub fn set_tags_impl(&self, path: &str, tags: &str) -> MResult<Value> {
        let list = Self::tag_list(tags);
        let cur = self.get_note_tags_impl(path)?;
        let cur_list: Vec<String> = cur
            .get("frontmatter_tags")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .map(|x| x.as_str().unwrap_or("").to_string())
                    .collect()
            })
            .unwrap_or_default();
        let mut ops: Vec<Value> = cur_list
            .iter()
            .map(|t| json!({"op": "remove_tag", "tag": t}))
            .collect();
        ops.extend(list.iter().map(|t| json!({"op": "add_tag", "tag": t})));
        if !ops.is_empty() {
            self.patch_memory_impl(path, &ops)?;
        }
        self.get_note_tags_impl(path)
    }

    pub fn search_by_tag_impl(&self, tag: &str, limit: usize) -> MResult<Vec<Value>> {
        let tag = tag.trim().trim_start_matches('#').to_lowercase();
        if tag.is_empty() {
            return err("tag required");
        }
        let mut out = Vec::new();
        for (rel, name, fp) in self.walk() {
            let (tags, _) = self.note_tags_fm(&fp);
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

    /// Rewrite a tag in frontmatter and in inline `#old` occurrences (`#old/sub`
    /// follows, `#old-other` is a different tag and stays).
    fn retag(content: &str, old: &str, new: &str) -> String {
        let mut c = content.to_string();
        let (fm_text, body) = split_frontmatter(content);
        if content.starts_with("---") && !fm_text.is_empty() {
            let mut lines: Vec<String> = Vec::new();
            for line in fm_text.split('\n') {
                if line.trim().starts_with("tags:") {
                    let v = line.split_once(':').map(|x| x.1).unwrap_or("");
                    let items: Vec<String> = v
                        .trim()
                        .trim_matches('[')
                        .trim_matches(']')
                        .split(',')
                        .map(|x| x.trim().to_string())
                        .filter(|x| !x.is_empty())
                        .map(|t| if t == old { new.to_string() } else { t })
                        .collect();
                    let mut seen = HashSet::new();
                    let dedup: Vec<String> = items
                        .into_iter()
                        .filter(|t| seen.insert(t.clone()))
                        .collect();
                    lines.push(format!("tags: [{}]", dedup.join(", ")));
                } else {
                    lines.push(line.to_string());
                }
            }
            let mut fm_new = lines.join("\n");
            if !fm_new.ends_with('\n') {
                fm_new.push('\n');
            }
            c = format!("---{fm_new}---{body}");
        }
        let re = Regex::new(&format!(r"#{}([^\w-]|$)", regex::escape(old))).unwrap();
        re.replace_all(&c, |cap: &regex::Captures| format!("#{new}{}", &cap[1]))
            .to_string()
    }

    pub fn rename_tag_impl(&self, old: &str, new: &str) -> MResult<Value> {
        let old = old.trim().trim_start_matches('#');
        let new = new.trim().trim_start_matches('#');
        if old.is_empty() || new.is_empty() {
            return err("both the old and the new tag are required");
        }
        let mut changed = Vec::new();
        for (rel, _name, fp) in self.walk() {
            let Some(c) = self.read_raw(&fp) else {
                continue;
            };
            let nc = Self::retag(&c, old, new);
            if nc != c {
                let ap = self.resolve(&rel)?;
                fs::write(&ap, nc).ok();
                changed.push(rel);
            }
        }
        if !changed.is_empty() {
            let _ = self.reindex();
            self.git_commit(&format!(
                "rename tag {old}->{new} ({} notes)",
                changed.len()
            ));
        }
        Ok(json!({"ok": true, "renamed": format!("{old} -> {new}"), "notes": changed}))
    }
}

// ---------------------------------------------------------------------------
// Graph navigation
// ---------------------------------------------------------------------------

impl MemoryStore {
    /// `(names -> rel path, undirected adjacency)`.
    pub fn adjacency(&self) -> (BTreeMap<String, String>, BTreeMap<String, BTreeSet<String>>) {
        let names = self.names_map();
        let mut adj: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        // Link targets come from the (mtime, size)-validated cache, so only
        // changed notes are re-read and re-parsed.
        let files = self.walk();
        let all = self.link_targets_all(&files);
        for ((_rel, name, _fp), raws) in files.into_iter().zip(all) {
            for raw in raws.iter() {
                let tgt = raw
                    .rsplit('/')
                    .next()
                    .unwrap_or(raw)
                    .replace(".md", "")
                    .trim()
                    .to_string();
                if names.contains_key(&tgt) && tgt != name {
                    adj.entry(name.clone()).or_default().insert(tgt.clone());
                    adj.entry(tgt).or_default().insert(name.clone());
                }
            }
        }
        (names, adj)
    }

    pub fn get_neighbors_impl(&self, path: &str, depth: usize) -> MResult<Vec<Value>> {
        let (names, adj) = self.adjacency();
        let start = Self::base_name(path);
        if !names.contains_key(&start) {
            return err(format!("not found: {path}"));
        }
        let mut seen: BTreeMap<String, usize> = BTreeMap::new();
        seen.insert(start.clone(), 0);
        let mut q: Vec<String> = vec![start.clone()];
        let mut i = 0usize;
        while i < q.len() {
            let cur = q[i].clone();
            i += 1;
            let d = seen[&cur];
            if d >= depth {
                continue;
            }
            if let Some(nbs) = adj.get(&cur) {
                for nb in nbs.iter() {
                    if !seen.contains_key(nb) {
                        seen.insert(nb.clone(), d + 1);
                        q.push(nb.clone());
                    }
                }
            }
        }
        let mut out = Vec::new();
        for nm in &q {
            if nm == &start {
                continue;
            }
            let rel = names[nm].clone();
            out.push(json!({
                "name": nm, "path": rel, "folder": folder_of(&rel), "hops": seen[nm],
            }));
        }
        Ok(out)
    }

    pub fn get_subgraph_impl(&self, path: &str, depth: usize, max_nodes: usize) -> MResult<Value> {
        let (names, adj) = self.adjacency();
        let start = Self::base_name(path);
        if !names.contains_key(&start) {
            return err(format!("not found: {path}"));
        }
        let nbrs = self.get_neighbors_impl(path, depth)?;
        let mut keep: BTreeSet<String> = BTreeSet::new();
        keep.insert(start.clone());
        for n in nbrs.iter().take(max_nodes) {
            if let Some(nm) = n.get("name").and_then(|v| v.as_str()) {
                keep.insert(nm.to_string());
            }
        }
        let nodes: Vec<Value> = keep
            .iter()
            .map(|n| {
                json!({"name": n, "path": names.get(n), "folder": names.get(n).map(|p| folder_of(p))})
            })
            .collect();
        let mut links = Vec::new();
        let mut done: HashSet<(String, String)> = HashSet::new();
        for a in &keep {
            if let Some(nbs) = adj.get(a) {
                for b in nbs {
                    if !keep.contains(b) {
                        continue;
                    }
                    let key = if a < b {
                        (a.clone(), b.clone())
                    } else {
                        (b.clone(), a.clone())
                    };
                    if done.insert(key) {
                        links.push(json!({"source": a, "target": b}));
                    }
                }
            }
        }
        Ok(json!({"nodes": nodes, "links": links}))
    }

    pub fn find_path_impl(&self, src: &str, dst: &str) -> MResult<Value> {
        let (names, adj) = self.adjacency();
        let a = Self::base_name(src);
        let b = Self::base_name(dst);
        if !names.contains_key(&a) || !names.contains_key(&b) {
            return err("source or target not found");
        }
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
            if let Some(nbs) = adj.get(&cur) {
                for nb in nbs {
                    if !prev.contains_key(nb) {
                        prev.insert(nb.clone(), Some(cur.clone()));
                        q.push(nb.clone());
                    }
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
            .map(|n| json!({"name": n, "path": names.get(n)}))
            .collect();
        Ok(json!({"found": true, "hops": chain.len() - 1, "path": path}))
    }

    pub fn get_hubs_impl(&self, limit: usize) -> Vec<Value> {
        let (names, adj) = self.adjacency();
        // Stable ordering: for equal degrees, preserve the order in which nodes
        // were first touched during the walk.
        let mut first_seen: BTreeMap<String, usize> = BTreeMap::new();
        let mut rank = 0usize;
        // Link targets come from the (mtime, size)-validated cache, so only
        // changed notes are re-read and re-parsed.
        let files = self.walk();
        let all = self.link_targets_all(&files);
        for ((_rel, name, _fp), raws) in files.into_iter().zip(all) {
            for raw in raws.iter() {
                let tgt = raw
                    .rsplit('/')
                    .next()
                    .unwrap_or(raw)
                    .replace(".md", "")
                    .trim()
                    .to_string();
                if names.contains_key(&tgt) && tgt != name {
                    for k in [name.clone(), tgt] {
                        if let std::collections::btree_map::Entry::Vacant(e) = first_seen.entry(k) {
                            e.insert(rank);
                            rank += 1;
                        }
                    }
                }
            }
        }
        let mut ranked: Vec<(&String, &BTreeSet<String>)> = adj.iter().collect();
        ranked.sort_by(|a, b| {
            b.1.len().cmp(&a.1.len()).then_with(|| {
                first_seen
                    .get(a.0)
                    .unwrap_or(&usize::MAX)
                    .cmp(first_seen.get(b.0).unwrap_or(&usize::MAX))
                    .then_with(|| a.0.cmp(b.0))
            })
        });
        ranked
            .into_iter()
            .take(limit)
            .map(|(n, s)| {
                json!({"name": n, "path": names.get(n),
                       "folder": names.get(n).map(|p| folder_of(p)), "degree": s.len()})
            })
            .collect()
    }

    pub fn get_isolated_impl(&self) -> Vec<Value> {
        let (names, adj) = self.adjacency();
        names
            .iter()
            .filter(|(n, _)| adj.get(*n).map(|s| s.is_empty()).unwrap_or(true))
            .map(|(n, rel)| json!({"name": n, "path": rel, "folder": folder_of(rel)}))
            .collect()
    }

    pub fn link_stats_impl(&self, path: &str) -> MResult<Value> {
        let name = Self::base_name(path);
        let (_names, adj) = self.adjacency();
        let c = self.read_raw(&self.resolve(path)?).unwrap_or_default();
        let out: BTreeSet<String> = self
            .link_targets(&c)
            .iter()
            .map(|t| {
                t.rsplit('/')
                    .next()
                    .unwrap_or(t)
                    .replace(".md", "")
                    .trim()
                    .to_string()
            })
            .collect();
        Ok(json!({
            "path": path,
            "degree": adj.get(&name).map(|s| s.len()).unwrap_or(0),
            "outgoing": out.len(),
        }))
    }
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
            inline
                .trim_matches('[')
                .trim_matches(']')
                .split(',')
                .map(|x| x.trim().to_string())
                .collect()
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
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        let mut out = Vec::new();
        for (rel, name, fp) in self.walk() {
            if let Some(f) = folder {
                if !f.is_empty() && folder_of(&rel) != f {
                    continue;
                }
            }
            let (ntags, fm) = self.note_tags_fm(&fp);
            if !tag_list.is_empty() && !tag_list.iter().all(|t| ntags.contains(t)) {
                continue;
            }
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
                "tags": ntags, "frontmatter": fm,
            }));
            if out.len() >= limit {
                break;
            }
        }
        out
    }

    pub fn read_note_impl(&self, path: &str) -> MResult<Value> {
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let content = self
            .read_raw(&ap)
            .ok_or_else(|| MemoryErr(format!("permission denied: {path}")))?;
        let note_dir = path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        // Links resolve from this note's folder first (same names elsewhere).
        let resolver = |t: &str| self.resolve_wikilink_from(t, note_dir);
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
        for (rel2, name2, fp2) in self.walk() {
            if rel2 == path {
                continue;
            }
            if let Some(oc) = self.read_raw(&fp2) {
                if self.link_targets(&oc).iter().any(names_me) {
                    backlinks.push(json!({"path": rel2, "name": name2}));
                }
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

        for op in ops {
            let t = op.get("op").and_then(|v| v.as_str()).unwrap_or("");
            match t {
                "set_field" => {
                    let field = need(op, "field", t)?;
                    if field.trim().is_empty() {
                        return err("patch op `set_field` needs a non-empty `field`".to_string());
                    }
                    let val = op
                        .get("value")
                        .map(|v| match v {
                            Value::String(x) => x.clone(),
                            other => other.to_string(),
                        })
                        .unwrap_or_default();
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
                    let tag = need(op, "tag", t)?;
                    let mut items = fm.list("tags");
                    if t == "add_tag" && !tag.is_empty() && !items.contains(&tag) {
                        items.push(tag.clone());
                    }
                    if t == "remove_tag" {
                        items.retain(|x| x != &tag);
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
                    body = body.replace(&find, &with);
                }
                other => return err(format!("unknown patch op: {other}")),
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
    pub fn create_impl(&self, title: &str, folder: &str, content: Option<&str>) -> MResult<String> {
        let fn_ = safe_filename(title)?;
        let rel = if folder.is_empty() || folder == "Root" {
            format!("{fn_}.md")
        } else {
            format!("{folder}/{fn_}.md")
        };
        let ap = self.resolve(&rel)?;
        if ap.exists() {
            return err(format!("already exists: {rel}"));
        }
        let body = match content {
            Some(c) => c.to_string(),
            None => format!("---\ncreated: {}\n---\n\n# {title}\n\n", now_iso()),
        };
        if let Some(parent) = ap.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&ap, body).map_err(|e| MemoryErr(e.to_string()))?;
        let _ = self.reindex();
        self.git_commit(&format!("create: {rel}"));
        Ok(rel)
    }

    pub fn save_impl(&self, rel_path: &str, content: &str) -> MResult<()> {
        let ap = self.resolve(rel_path)?;
        if !ap.is_file() {
            return err(format!("not found: {rel_path}"));
        }
        fs::write(&ap, content).map_err(|e| MemoryErr(e.to_string()))?;
        let _ = self.reindex();
        self.git_commit(&format!("edit: {rel_path}"));
        Ok(())
    }

    pub fn rename_impl(&self, rel_path: &str, new_name: &str) -> MResult<String> {
        let ap = self.resolve(rel_path)?;
        if !ap.is_file() {
            return err(format!("not found: {rel_path}"));
        }
        let fn_ = safe_filename(new_name)?;
        let folder = Path::new(rel_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string());
        let dest = match folder {
            Some(f) if !f.is_empty() && f != "." => format!("{f}/{fn_}.md"),
            _ => format!("{fn_}.md"),
        };
        let dap = self.resolve(&dest)?;
        if dap != ap && dap.exists() {
            return err(format!("already exists: {dest}"));
        }
        fs::rename(&ap, &dap).map_err(|e| MemoryErr(e.to_string()))?;
        self.path_event(PathEvent::Moved {
            from: rel_path.to_string(),
            to: dest.clone(),
            carry: false,
        });
        let _ = self.reindex();
        self.git_commit(&format!("rename: {rel_path} -> {dest}"));
        Ok(dest)
    }

    pub fn move_impl(&self, rel_path: &str, dest_folder: &str) -> MResult<String> {
        let ap = self.resolve(rel_path)?;
        if !ap.is_file() {
            return err(format!("not found: {rel_path}"));
        }
        let fn_ = Path::new(rel_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let dest = if dest_folder.is_empty() || dest_folder == "Root" {
            fn_
        } else {
            format!("{dest_folder}/{fn_}")
        };
        let dap = self.resolve(&dest)?;
        if dap != ap && dap.exists() {
            return err(format!("already exists: {dest}"));
        }
        if let Some(p) = dap.parent() {
            fs::create_dir_all(p).ok();
        }
        fs::rename(&ap, &dap).map_err(|e| MemoryErr(e.to_string()))?;
        self.path_event(PathEvent::Moved {
            from: rel_path.to_string(),
            to: dest.clone(),
            carry: false,
        });
        let _ = self.reindex();
        self.git_commit(&format!("move: {rel_path} -> {dest}"));
        Ok(dest)
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
        let path = clean_folder_path(name)?;
        let dir = self.resolve(&path)?;
        fs::create_dir_all(&dir).ok();
        let index = self.resolve(&format!("{path}/Index.md"))?;
        if !index.exists() {
            let title = path.rsplit('/').next().unwrap_or(&path).replace('_', " ");
            fs::write(&index, format!("# {title}\n\n")).ok();
        }
        let _ = self.reindex();
        self.git_commit(&format!("folder: {path}"));
        Ok(path)
    }

    /// The directory of an existing folder path (not Root, not hidden).
    fn folder_dir(&self, folder: &str) -> MResult<PathBuf> {
        let f = folder.trim().trim_matches('/');
        if f.is_empty() || f == "Root" {
            return err("a folder is required (Root cannot be renamed or moved)");
        }
        if f.split('/')
            .any(|seg| seg.starts_with('.') || seg.is_empty())
        {
            return err(format!("invalid folder: {folder}"));
        }
        if !self.visible(f) {
            return err(format!("folder not found: {folder}"));
        }
        let dir = self.resolve(f)?;
        if !dir.is_dir() {
            return err(format!("folder not found: {folder}"));
        }
        Ok(dir)
    }

    /// Move the folder directory `src` to the path `dest` (parents created), carrying
    /// the folder metadata of `src` and every sub folder along.
    fn relocate_folder(&self, src: &str, dest: &str, what: &str) -> MResult<Value> {
        let src = src.trim().trim_matches('/').to_string();
        let sdir = self.folder_dir(&src)?;
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
        if let Some(p) = ddir.parent() {
            fs::create_dir_all(p).map_err(|e| MemoryErr(e.to_string()))?;
        }
        let notes = self
            .walk()
            .iter()
            .filter(|(rel, _, _)| rel.starts_with(&format!("{src}/")))
            .count();
        fs::rename(&sdir, &ddir).map_err(|e| MemoryErr(e.to_string()))?;
        self.path_event(PathEvent::Moved {
            from: src.clone(),
            to: dest.to_string(),
            carry: false,
        });
        self.rekey_folder_meta(&src, Some(dest));
        let _ = self.reindex();
        self.git_commit(&format!("{what} folder: {src} -> {dest}"));
        Ok(json!({"ok": true, "from": src, "to": dest, "notes": notes}))
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
        let seg = clean_segment(name)?;
        let src = folder.trim().trim_matches('/');
        let dest = match src.rsplit_once('/') {
            Some((parent, _)) => format!("{parent}/{seg}"),
            None => seg,
        };
        self.relocate_folder(src, &dest, "rename")
    }

    /// Move a folder (with everything in it) into `into`; `""` or `Root` = top level.
    pub fn move_folder_impl(&self, folder: &str, into: &str) -> MResult<Value> {
        let src = folder.trim().trim_matches('/');
        let base = src.rsplit('/').next().unwrap_or(src).to_string();
        let into = into.trim().trim_matches('/');
        let dest = if into.is_empty() || into == "Root" {
            base
        } else {
            let parent = clean_folder_path(into)?;
            format!("{parent}/{base}")
        };
        self.relocate_folder(src, &dest, "move")
    }

    /// Move everything inside `folder` (notes and sub folders) into `into` (`""` =
    /// top level), then remove the emptied folder. Name clashes get a `-N` suffix.
    pub fn move_folder_contents_impl(&self, folder: &str, into: &str) -> MResult<Value> {
        let src = folder.trim().trim_matches('/').to_string();
        let sdir = self.folder_dir(&src)?;
        let into = into.trim().trim_matches('/');
        let dest = if into.is_empty() || into == "Root" {
            String::new()
        } else {
            clean_folder_path(into)?
        };
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
        fs::create_dir_all(&ddir).map_err(|e| MemoryErr(e.to_string()))?;
        let entries: Vec<PathBuf> = fs::read_dir(&sdir)
            .map_err(|e| MemoryErr(e.to_string()))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .collect();
        let mut moved = Vec::new();
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
            if !self.visible(&self.rel_of(&to)) {
                return err(format!("not found: {}", self.rel_of(&to)));
            }
            fs::rename(&from, &to).map_err(|e| MemoryErr(e.to_string()))?;
            self.path_event(PathEvent::Moved {
                from: format!("{src}/{name}"),
                to: self.rel_of(&to),
                carry: false,
            });
            if to.is_dir() {
                let new_rel = self.rel_of(&to);
                self.rekey_folder_meta(&format!("{src}/{name}"), Some(&new_rel));
            }
            moved.push(self.rel_of(&to));
        }
        // Only hidden leftovers (if any) remain; the folder itself goes.
        fs::remove_dir_all(&sdir).ok();
        self.path_event(PathEvent::Deleted { path: src.clone() });
        self.rekey_folder_meta(&src, None);
        let _ = self.reindex();
        let shown = if dest.is_empty() {
            "Root"
        } else {
            dest.as_str()
        };
        self.git_commit(&format!("move contents of {src} -> {shown}"));
        Ok(json!({"ok": true, "from": src, "to": shown, "moved": moved}))
    }

    /// Delete a folder; every note inside it (at any depth) moves to Root first.
    pub fn delete_folder_impl(&self, folder: &str) -> MResult<Value> {
        let folder = folder.trim().trim_matches('/');
        if folder.is_empty() || folder == "Root" {
            return err("cannot delete Root");
        }
        if !self.visible(folder) {
            return err(format!("folder not found: {folder}"));
        }
        let fdir = self.resolve(folder)?;
        if !fdir.is_dir() {
            return err(format!("folder not found: {folder}"));
        }
        if !self.subtree_visible(&fdir) {
            return err(PROTECTED_INSIDE);
        }
        let prefix = format!("{folder}/");
        let notes: Vec<String> = self
            .walk()
            .into_iter()
            .filter(|(rel, _, _)| rel.starts_with(&prefix))
            .map(|(rel, _, _)| rel)
            .collect();
        let mut moved = Vec::new();
        for rel in notes {
            let base = Path::new(&rel)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let mut dap = self.resolve(&base)?;
            let mut i = 1;
            while dap.exists() {
                let stem = Path::new(&base)
                    .file_stem()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                dap = self.resolve(&format!("{stem}-{i}.md"))?;
                i += 1;
            }
            if fs::rename(self.resolve(&rel)?, &dap).is_ok() {
                // Out of a deleted folder: the note keeps that folder's protection.
                self.path_event(PathEvent::Moved {
                    from: rel.clone(),
                    to: self.rel_of(&dap),
                    carry: true,
                });
            }
            moved.push(self.rel_of(&dap));
        }
        fs::remove_dir_all(&fdir).ok();
        self.path_event(PathEvent::Deleted {
            path: folder.to_string(),
        });
        self.rekey_folder_meta(folder, None);
        let _ = self.reindex();
        self.git_commit(&format!(
            "delete folder {folder} (moved {} notes to Root)",
            moved.len()
        ));
        Ok(json!({"ok": true, "deleted_folder": folder, "moved_to_root": moved}))
    }

    pub fn duplicate_memory_impl(&self, path: &str) -> MResult<String> {
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let base = Self::base_name(path);
        let content = self.read_raw(&ap).unwrap_or_default();
        self.create_impl(&format!("{base}-copy"), &folder_of(path), Some(&content))
    }

    pub fn batch_create_impl(&self, notes: &[Value]) -> Vec<Value> {
        let mut out = Vec::new();
        for n in notes {
            let title = n
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled");
            let folder = n.get("folder").and_then(|v| v.as_str()).unwrap_or("Root");
            let content = n.get("content").and_then(|v| v.as_str());
            match self.create_impl(title, folder, content) {
                Ok(rel) => out.push(json!({"ok": true, "path": rel})),
                Err(e) => out.push(json!({"ok": false, "title": title, "error": e.0})),
            }
        }
        out
    }

    pub fn bulk_replace_impl(
        &self,
        find: &str,
        replace: &str,
        folder: Option<&str>,
        regex: bool,
        dry_run: bool,
    ) -> MResult<Value> {
        let pat = if regex {
            Some(Regex::new(find).map_err(|e| MemoryErr(e.to_string()))?)
        } else {
            None
        };
        let mut changed = Vec::new();
        for (rel, _name, fp) in self.walk() {
            if let Some(f) = folder {
                if !f.is_empty() && folder_of(&rel) != f {
                    continue;
                }
            }
            let Some(c) = self.read_raw(&fp) else {
                continue;
            };
            let nc = match &pat {
                Some(p) => p.replace_all(&c, replace).to_string(),
                None => c.replace(find, replace),
            };
            if nc != c {
                changed.push(rel.clone());
                if !dry_run {
                    fs::write(self.resolve(&rel)?, nc).ok();
                }
            }
        }
        if !changed.is_empty() && !dry_run {
            let _ = self.reindex();
            self.git_commit(&format!("bulk replace ({} notes)", changed.len()));
        }
        Ok(json!({"ok": true, "count": changed.len(), "changed": changed, "dry_run": dry_run}))
    }

    pub fn bulk_delete_impl(
        &self,
        paths: Option<&[Value]>,
        folder: Option<&str>,
    ) -> MResult<Value> {
        let mut targets: BTreeSet<String> = BTreeSet::new();
        if let Some(ps) = paths {
            for p in ps {
                if let Some(s) = p.as_str() {
                    targets.insert(s.to_string());
                }
            }
        }
        if let Some(f) = folder {
            if !f.is_empty() {
                for (rel, _, _) in self.walk() {
                    if folder_of(&rel) == f {
                        targets.insert(rel);
                    }
                }
            }
        }
        let mut deleted = Vec::new();
        for rel in targets {
            if let Ok(ap) = self.resolve(&rel) {
                if ap.is_file() && fs::remove_file(&ap).is_ok() {
                    self.path_event(PathEvent::Deleted { path: rel.clone() });
                    deleted.push(rel);
                }
            }
        }
        if !deleted.is_empty() {
            let _ = self.reindex();
            self.git_commit(&format!("bulk delete ({} notes)", deleted.len()));
        }
        Ok(json!({"ok": true, "count": deleted.len(), "deleted": deleted}))
    }

    pub fn merge_memory_impl(&self, paths: &[Value], into: &str) -> MResult<Value> {
        let mut body = String::new();
        let mut n = 0usize;
        for p in paths {
            let Some(ps) = p.as_str() else { continue };
            let ap = self.resolve(ps)?;
            if ap.is_file() {
                let nm = Self::base_name(ps);
                body.push_str(&format!(
                    "\n\n## from {nm}\n\n{}",
                    self.read_raw(&ap).unwrap_or_default()
                ));
                n += 1;
            }
        }
        let dst = self.resolve(into)?;
        if dst.is_file() {
            let cur = self.read_raw(&dst).unwrap_or_default();
            self.save_impl(into, &format!("{cur}{body}"))?;
        } else {
            self.create_impl(&Self::base_name(into), &folder_of(into), Some(&body))?;
        }
        Ok(json!({"ok": true, "into": into, "merged": n}))
    }

    pub fn template_create_impl(
        &self,
        template: &str,
        title: &str,
        folder: &str,
        variables: Option<&Map<String, Value>>,
    ) -> MResult<String> {
        let rel = if template.ends_with(".md") {
            template.to_string()
        } else {
            format!("Templates/{template}.md")
        };
        let tap = self.resolve(&rel)?;
        if !tap.is_file() {
            return err(format!("template not found: {template}"));
        }
        let mut content = self.read_raw(&tap).unwrap_or_default();
        if let Some(vars) = variables {
            for (k, v) in vars {
                let val = match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                content = content.replace(&format!("{{{{{k}}}}}"), &val);
            }
        }
        self.create_impl(title, folder, Some(&content))
    }

    pub fn snapshot_impl(&self, label: &str) -> Value {
        let re = Regex::new(r"[^\w.-]").unwrap();
        let raw = if label.is_empty() { "snap" } else { label };
        let safe: String = re.replace_all(raw, "-").chars().take(40).collect();
        let safe = if safe.is_empty() {
            "snap".to_string()
        } else {
            safe
        };
        let tag = format!("snap-{safe}");
        let ok = self.git(&["tag", &tag]).0;
        json!({"ok": ok, "tag": tag})
    }

    // ---- trash ----
    pub fn soft_delete_impl(&self, path: &str) -> MResult<Value> {
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let base = Path::new(path)
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
        // In the trash the note keeps the protection of the folder it left.
        self.path_event(PathEvent::Moved {
            from: path.to_string(),
            to: self.rel_of(&dap),
            carry: true,
        });
        let _ = self.reindex();
        Ok(json!({"ok": true, "trashed": path, "to": self.rel_of(&dap)}))
    }

    pub fn restore_trash_impl(&self, name: &str, into: &str) -> MResult<Value> {
        let base = Path::new(name)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| name.to_string());
        let rel = if name.starts_with(".Trash") {
            name.to_string()
        } else {
            format!(".Trash/{base}")
        };
        let tap = self.resolve(&rel)?;
        if !tap.is_file() {
            return err(format!("not in trash: {base}"));
        }
        let dest = if into.is_empty() || into == "Root" {
            base.clone()
        } else {
            format!("{into}/{base}")
        };
        let dap = self.resolve(&dest)?;
        if dap.exists() {
            return err(format!("already exists: {dest}"));
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
        let _ = self.reindex();
        Ok(json!({"ok": true, "restored": dest}))
    }
}

// ---------------------------------------------------------------------------
// Git time machine
// ---------------------------------------------------------------------------

impl MemoryStore {
    /// Run git in the vault, returning `(success, stdout)`. Only a vault that is its own repository (has `.git`)
    /// is versioned: git must never climb into an enclosing repository.
    pub fn git(&self, args: &[&str]) -> (bool, String) {
        let root = self.root();
        if !root.join(".git").exists() {
            return (false, String::new());
        }
        let mut cmd = Command::new("git");
        if let Some(parent) = root.parent() {
            cmd.env("GIT_CEILING_DIRECTORIES", parent);
        }
        match cmd.args(args).current_dir(root).output() {
            Ok(o) => (
                o.status.success(),
                String::from_utf8_lossy(&o.stdout).to_string(),
            ),
            Err(_) => (false, String::new()),
        }
    }

    pub fn git_commit(&self, message: &str) {
        self.git(&["add", "-A"]);
        let _ = self.git(&["commit", "-q", "-m", message]);
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
            && self.resolve(p).is_ok_and(|ap| !ap.is_dir())
    }

    /// A revision argument: never an option, never a `rev:path` lookup.
    fn rev_ok(rev: &str) -> bool {
        !rev.starts_with('-')
            && !rev.contains(':')
            && !rev.chars().any(|c| c.is_control() || c.is_whitespace())
    }

    pub fn get_history_impl(&self, path: &str, limit: usize) -> Vec<Value> {
        if !self.history_path_ok(path) {
            return Vec::new();
        }
        let (ok, out) = self.git(&[
            "--literal-pathspecs",
            "log",
            &format!("-{limit}"),
            "--format=%h|%ai|%an|%s",
            "--",
            path,
        ]);
        if !ok {
            return Vec::new();
        }
        out.trim()
            .split('\n')
            .filter(|l| !l.is_empty())
            .filter_map(|line| {
                let p: Vec<&str> = line.splitn(4, '|').collect();
                if p.len() == 4 {
                    // Commit messages name paths; hide those naming hidden ones.
                    let msg = if self.mentions_hidden(p[3]) {
                        "(hidden)"
                    } else {
                        p[3]
                    };
                    Some(json!({"rev": p[0], "date": p[1], "author": p[2], "message": msg}))
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn get_note_at_impl(&self, path: &str, rev: &str) -> MResult<String> {
        if !self.history_path_ok(path) || !Self::rev_ok(rev) {
            return err(format!("no such revision for {path}"));
        }
        let (ok, out) = self.git(&["show", &format!("{rev}:{path}")]);
        if !ok {
            return err(format!("no such revision for {path}"));
        }
        Ok(out)
    }

    pub fn restore_impl(&self, path: &str, rev: &str) -> MResult<Value> {
        let content = self.get_note_at_impl(path, rev)?;
        let ap = self.resolve(path)?;
        if let Some(p) = ap.parent() {
            fs::create_dir_all(p).ok();
        }
        fs::write(&ap, content).map_err(|e| MemoryErr(e.to_string()))?;
        let _ = self.reindex();
        self.git_commit(&format!("restore: {path}@{rev}"));
        Ok(json!({"ok": true, "path": path, "rev": rev}))
    }

    pub fn diff_impl(&self, path: &str, rev_a: &str, rev_b: &str) -> Value {
        let range = if rev_b.is_empty() {
            rev_a.to_string()
        } else {
            format!("{rev_a}..{rev_b}")
        };
        let allowed = self.history_path_ok(path)
            && Self::rev_ok(rev_a)
            && (rev_b.is_empty() || Self::rev_ok(rev_b));
        let (ok, out) = if allowed {
            self.git(&["--literal-pathspecs", "diff", &range, "--", path])
        } else {
            (false, String::new())
        };
        let txt = if ok { out } else { String::new() };
        json!({"path": path, "from": rev_a,
               "to": if rev_b.is_empty() { "working" } else { rev_b }, "diff": txt})
    }
}

// ---------------------------------------------------------------------------
// Folder meta, locks, events, actors, logs
// ---------------------------------------------------------------------------

impl MemoryStore {
    fn folders_path(&self) -> PathBuf {
        self.root().join(".folders.json")
    }

    pub fn get_folder_meta_impl(&self, folder: Option<&str>) -> Value {
        let mut meta: Map<String, Value> = fs::read_to_string(self.folders_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if self.restricted() {
            meta.retain(|k, v| self.visible(k) && self.value_visible(v));
        }
        match folder {
            Some(f) if !f.is_empty() => {
                let f = f.trim().trim_matches('/');
                if !self.visible(f) {
                    return json!({});
                }
                let mut own = meta.get(f).cloned().unwrap_or(json!({}));
                // A sub folder without its own color shows its nearest parent's.
                if own.get("color").is_none() {
                    let mut p = f;
                    while let Some((parent, _)) = p.rsplit_once('/') {
                        if let Some(c) = meta.get(parent).and_then(|m| m.get("color")) {
                            own["inherited"] = json!({"color": c, "from": parent});
                            break;
                        }
                        p = parent;
                    }
                }
                own
            }
            _ => Value::Object(meta),
        }
    }

    pub fn set_folder_meta_impl(
        &self,
        folder: &str,
        color: Option<&str>,
        icon: Option<&str>,
        desc: Option<&str>,
    ) -> MResult<Value> {
        let folder = folder.trim().trim_matches('/');
        if folder.is_empty() {
            return err("folder required");
        }
        // No metadata for folders that do not exist (no ghost entries).
        self.folder_dir(folder)?;
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
            } else if i.chars().count() <= 40 {
                m.insert("icon".into(), json!(i));
            } else {
                return err("icon must be at most 40 characters");
            }
        }
        if let Some(d) = desc {
            if d.trim().is_empty() {
                m.remove("desc");
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
    pub fn folder_stats_impl(&self, folder: &str) -> Value {
        let trimmed = folder.trim_matches('/');
        let n = if trimmed.is_empty() || trimmed == "Root" {
            self.walk()
                .iter()
                .filter(|(rel, _, _)| !rel.contains('/'))
                .count()
        } else {
            let prefix = format!("{trimmed}/");
            self.walk()
                .iter()
                .filter(|(rel, _, _)| rel.starts_with(&prefix))
                .count()
        };
        json!({"folder": folder, "notes": n, "meta": self.get_folder_meta_impl(Some(folder))})
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

    pub fn lock_node_impl(&self, path: &str, owner: &str, ttl: i64) -> Value {
        if !self.visible(path) {
            return json!({"ok": false, "reason": format!("not found: {path}")});
        }
        let now = now_secs();
        let mut locks: Map<String, Value> = self
            .load_locks()
            .into_iter()
            .filter(|(_, v)| v.get("expires").and_then(|e| e.as_f64()).unwrap_or(0.0) > now)
            .collect();
        if let Some(cur) = locks.get(path) {
            let cur_owner = cur.get("owner").and_then(|v| v.as_str()).unwrap_or("");
            if cur_owner != owner {
                let exp = cur.get("expires").and_then(|v| v.as_f64()).unwrap_or(0.0);
                return json!({"ok": false, "locked_by": cur_owner, "expires_in": (exp - now).round()});
            }
        }
        locks.insert(
            path.to_string(),
            json!({"owner": owner, "expires": now + ttl.max(5) as f64}),
        );
        self.save_locks(&locks);
        json!({"ok": true, "path": path, "owner": owner, "ttl": ttl})
    }

    pub fn release_lock_impl(&self, path: &str, owner: &str) -> Value {
        if !self.visible(path) {
            return json!({"ok": false, "reason": "not locked"});
        }
        let mut locks = self.load_locks();
        if let Some(cur) = locks.get(path).cloned() {
            let cur_owner = cur.get("owner").and_then(|v| v.as_str()).unwrap_or("");
            if cur_owner == owner {
                locks.remove(path);
                self.save_locks(&locks);
                return json!({"ok": true, "released": path});
            }
            return json!({"ok": false, "reason": "not locked by you"});
        }
        json!({"ok": false, "reason": "not locked"})
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

    pub fn digest_impl(&self, folder: Option<&str>, since: Option<f64>) -> Value {
        let evs = self.get_events_impl(since, folder, None, 500);
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
        json!({"folder": folder, "events": evs.len(), "by_actor": by_actor,
               "by_type": by_type,
               "notes_touched": touched.into_iter().take(50).collect::<Vec<_>>()})
    }

    // ---- activity log (get_logs / search_logs) ----
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
            return err("alias must be 1..32 chars");
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
    fn note_terms(&self, fp: &Path) -> (BTreeSet<String>, BTreeSet<String>) {
        let c = self.read_raw(fp).unwrap_or_default().to_lowercase();
        let (tags, _) = self.note_tags_fm(fp);
        let tagset: BTreeSet<String> = tags.into_iter().collect();
        let word_re = Regex::new(r"[a-z0-9]{4,}").unwrap();
        let words: BTreeSet<String> = word_re
            .find_iter(&c)
            .map(|m| m.as_str().to_string())
            .collect();
        (tagset, words)
    }

    pub fn find_similar_impl(&self, path: &str, limit: usize) -> MResult<Vec<Value>> {
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let base = Self::base_name(path);
        let (bt, bw) = self.note_terms(&ap);
        let mut scored: Vec<(usize, Value)> = Vec::new();
        for (rel, name, fp) in self.walk() {
            if name == base {
                continue;
            }
            let (t, w) = self.note_terms(&fp);
            let score = bt.intersection(&t).count() * 5 + bw.intersection(&w).count();
            if score > 0 {
                scored.push((
                    score,
                    json!({"path": rel, "name": name, "folder": folder_of(&rel), "score": score}),
                ));
            }
        }
        scored.sort_by_key(|a| std::cmp::Reverse(a.0));
        Ok(scored.into_iter().take(limit).map(|x| x.1).collect())
    }

    pub fn suggest_links_impl(&self, path: &str, limit: usize) -> MResult<Vec<Value>> {
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let c = self.read_raw(&ap).unwrap_or_default();
        let linked: BTreeSet<String> = self
            .link_targets(&c)
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
        let base = Self::base_name(path);
        Ok(self
            .find_similar_impl(path, limit * 3)?
            .into_iter()
            .filter(|s| {
                let n = s.get("name").and_then(|v| v.as_str()).unwrap_or("");
                !linked.contains(&n.to_lowercase()) && n != base
            })
            .take(limit)
            .collect())
    }

    pub fn stale_detection_impl(&self, days: i64) -> Vec<Value> {
        let now = now_secs();
        let cutoff = now - days as f64 * 86400.0;
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
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let (tags, fm) = self.note_tags_fm(&ap);
        let mut issues: Vec<String> = Vec::new();
        if fm.as_object().map(|o| o.is_empty()).unwrap_or(true) {
            issues.push("no frontmatter".into());
        } else if fm.get("created").is_none() {
            issues.push("missing 'created'".into());
        }
        if tags.is_empty() {
            issues.push("no tags".into());
        }
        if !self.broken_links(Some(path)).is_empty() {
            issues.push("has broken link(s)".into());
        }
        Ok(
            json!({"path": path, "ok": issues.is_empty(), "issues": issues,
                  "tags": tags, "frontmatter": fm}),
        )
    }

    pub fn get_todos_impl(&self, path: Option<&str>) -> Vec<Value> {
        let re = Regex::new(r"^\s*[-*]\s+\[( |x|X)\]\s+(.+)").unwrap();
        let mut out = Vec::new();
        for (rel, _name, fp) in self.walk() {
            if let Some(p) = path {
                if !p.is_empty() && rel != p {
                    continue;
                }
            }
            let content = self.read_raw(&fp).unwrap_or_default();
            for (i, line) in content.split('\n').enumerate() {
                if let Some(c) = re.captures(line) {
                    out.push(json!({
                        "path": rel,
                        "done": c[1].to_lowercase() == "x",
                        "text": c[2].trim(),
                        "line": i + 1,
                    }));
                }
            }
        }
        out
    }

    pub fn follow_ups_impl(&self) -> Vec<Value> {
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let mut out = Vec::new();
        for st in ["pending", "open", "todo", "in-progress"] {
            for r in self.query_memory_impl(None, None, None, None, Some(st), 50) {
                let p = r
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if seen.insert(p) {
                    out.push(r);
                }
            }
        }
        out
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

    pub fn mention_agent_impl(&self, agent: &str, path: &str, message: &str) -> MResult<Value> {
        let ap = self.resolve(path)?;
        if !ap.is_file() {
            return err(format!("not found: {path}"));
        }
        let cur = self.read_raw(&ap).unwrap_or_default();
        let line = format!("\n\n> @{agent}: {message}");
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
    pub fn export_zip_impl(&self, paths: &[Value]) -> MResult<Vec<u8>> {
        use std::io::Write;
        let mut buf = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            for p in paths {
                let Some(ps) = p.as_str() else { continue };
                let ap = self.resolve(ps)?;
                if ap.is_dir() {
                    // Hidden entries below the exported folder (`.git`, `.Trash`) are skipped.
                    let walk = WalkDir::new(&ap).into_iter().filter_entry(|e| {
                        e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
                    });
                    for entry in walk.filter_map(Result::ok) {
                        let name = entry.file_name().to_string_lossy();
                        if entry.file_type().is_file() && name.ends_with(".md") {
                            let rel = self.rel_of(entry.path());
                            if !self.visible(&rel) {
                                continue;
                            }
                            let data = fs::read(entry.path()).unwrap_or_default();
                            zw.start_file(rel, opts)
                                .map_err(|e| MemoryErr(e.to_string()))?;
                            zw.write_all(&data).map_err(|e| MemoryErr(e.to_string()))?;
                        }
                    }
                } else if ap.is_file() {
                    let rel = self.rel_of(&ap);
                    let data = fs::read(&ap).unwrap_or_default();
                    zw.start_file(rel, opts)
                        .map_err(|e| MemoryErr(e.to_string()))?;
                    zw.write_all(&data).map_err(|e| MemoryErr(e.to_string()))?;
                }
            }
            zw.finish().map_err(|e| MemoryErr(e.to_string()))?;
        }
        Ok(buf)
    }

    pub fn import_zip_impl(&self, data: &[u8], overwrite: bool) -> MResult<Value> {
        use std::io::Read;
        let mut added = Vec::new();
        let mut skipped = Vec::new();
        // Bounds against zip bombs: entries are decompressed with a hard cap
        // each and in total, and absurd entry counts are refused up front.
        const MAX_ENTRIES: usize = 20_000;
        const MAX_ENTRY_BYTES: u64 = 16 * 1024 * 1024;
        const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
        let cursor = std::io::Cursor::new(data);
        let mut zr = zip::ZipArchive::new(cursor).map_err(|e| MemoryErr(e.to_string()))?;
        if zr.len() > MAX_ENTRIES {
            return err(format!("zip has {} entries (max {MAX_ENTRIES})", zr.len()));
        }
        let mut total: u64 = 0;
        for i in 0..zr.len() {
            let mut f = zr.by_index(i).map_err(|e| MemoryErr(e.to_string()))?;
            let name = f.name().to_string();
            if !name.ends_with(".md") || name.ends_with('/') {
                continue;
            }
            let rel = name.replace('\\', "/").trim_start_matches('/').to_string();
            let Ok(ap) = self.resolve(&rel) else {
                skipped.push(json!(rel));
                continue;
            };
            if ap.exists() && !overwrite {
                skipped.push(json!(rel));
                continue;
            }
            let mut buf = Vec::new();
            if (&mut f)
                .take(MAX_ENTRY_BYTES + 1)
                .read_to_end(&mut buf)
                .is_err()
                || buf.len() as u64 > MAX_ENTRY_BYTES
            {
                skipped.push(json!(rel));
                continue;
            }
            total += buf.len() as u64;
            if total > MAX_TOTAL_BYTES {
                // Stop here, but still reindex/commit what was already written.
                skipped.push(json!(rel));
                break;
            }
            if let Some(parent) = ap.parent() {
                fs::create_dir_all(parent).ok();
            }
            fs::write(&ap, buf).ok();
            added.push(json!(rel));
        }
        if !added.is_empty() {
            let _ = self.reindex();
            self.git_commit(&format!("import: {} notes", added.len()));
        }
        Ok(json!({"added": added, "skipped": skipped}))
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
