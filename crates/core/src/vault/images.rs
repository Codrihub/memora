//! Images that live beside their notes.
//!
//! A note shows an image of its own folder with `![alt](path:name.webp)`. Images always
//! follow their note: moved, trashed, restored or deleted with it (an image another note
//! of the same folder still shows is copied instead of moved, and kept instead of
//! deleted). A `path:Folder/name` copied in from another folder is duplicated into the
//! note's folder on save, so every folder holds the images its notes show.

use super::*;

/// Where trashed notes keep their images: `.Trash/.assets/<trash name>/`.
const TRASH_ASSETS: &str = ".Trash/.assets";

/// The largest image an upload may be, in bytes, by default (5 MB).
pub const DEFAULT_IMAGE_MAX: usize = 5 * 1024 * 1024;
static IMAGE_MAX: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(DEFAULT_IMAGE_MAX);

/// The upload limit every caller (web, API, MCP) applies; set from Settings, Images.
pub fn image_max_bytes() -> usize {
    IMAGE_MAX.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn set_image_max_bytes(n: usize) {
    IMAGE_MAX.store(n, std::sync::atomic::Ordering::Relaxed);
}

/// Kinds of upload accepted, told by their first bytes (never by the name alone).
fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else {
        None
    }
}

/// `![alt](path:target)`: the alt part (group 1) and the target (group 2).
fn re_path_image() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(!\[[^\]\n]*\]\(\s*)path:([^)\s]+)").unwrap())
}

/// Markdown images and embeds of any kind: the raw target in group 1 or 2.
fn re_any_image() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|!\[\[([^\]|#\n]+)"#)
            .unwrap()
    })
}

/// A file name safe in markdown without escaping: letters, digits, `.`, `_`, `-`.
fn markdown_name(name: &str) -> String {
    if name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        name.to_string()
    } else {
        pct_encode_path(name)
    }
}

/// A clean upload name: the stem's letters and digits (others become `-`), at most 60
/// characters, with the extension of the bytes' real kind.
fn upload_name(name: &str, ext: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let stem = base.rsplit_once('.').map_or(base, |(s, _)| s);
    let mut out = String::new();
    for c in stem.chars() {
        if c.is_ascii_alphanumeric() || c == '_' {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(60).collect();
    format!("{}.{ext}", if out.is_empty() { "image" } else { &out })
}

/// The section a line belongs to: the text of the nearest heading above it.
fn heading_before(content: &str, at: usize) -> Option<String> {
    let mut fence = false;
    let mut last = None;
    for line in content[..at.min(content.len())].lines() {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = !fence;
            continue;
        }
        if !fence {
            let hashes = t.chars().take_while(|c| *c == '#').count();
            if (1..=6).contains(&hashes) && t[hashes..].starts_with(' ') {
                last = Some(t[hashes..].trim().trim_end_matches('#').trim().to_string());
            }
        }
    }
    last
}

impl MemoryStore {
    /// Duplicate every `path:Folder/name` image of `content` that lives in another folder
    /// into the folder of `note_rel`, and point the reference at the copy.
    pub(crate) fn localize_images(&self, note_rel: &str, content: &str) -> String {
        if !content.contains("path:") {
            return content.to_string();
        }
        let dir = parent_folder(note_rel).to_string();
        re_path_image()
            .replace_all(content, |c: &regex::Captures| {
                let target = pct_decode(&c[2]);
                let target = target.trim_start_matches('/');
                if !target.contains('/') {
                    return c[0].to_string();
                }
                let name = target.rsplit('/').next().unwrap_or(target);
                if parent_folder(target) == dir {
                    return format!("{}path:{}", &c[1], markdown_name(name));
                }
                match self
                    .vault_image_file(target)
                    .ok()
                    .and_then(|f| fs::read(f).ok())
                {
                    Some(bytes) => match self.place_image(&dir, name, &bytes) {
                        Ok(placed) => format!("{}path:{}", &c[1], markdown_name(&placed)),
                        Err(_) => c[0].to_string(),
                    },
                    None => c[0].to_string(),
                }
            })
            .into_owned()
    }

    /// Write `bytes` as `name` in `dir`: an identical file there is reused, a different
    /// one keeps its name and the new file gets `-1`, `-2` ... Returns the name used.
    fn place_image(&self, dir: &str, name: &str, bytes: &[u8]) -> MResult<String> {
        let (stem, ext) = name.rsplit_once('.').unwrap_or((name, "png"));
        let root = self.root().to_path_buf();
        for i in 0..1000 {
            let cand = if i == 0 {
                name.to_string()
            } else {
                format!("{stem}-{i}.{ext}")
            };
            let rel = if dir.is_empty() {
                cand.clone()
            } else {
                format!("{dir}/{cand}")
            };
            let full = root.join(&rel);
            if full.exists() {
                if fs::read(&full).is_ok_and(|b| b == bytes) {
                    return Ok(cand);
                }
                continue;
            }
            if let Some(p) = full.parent() {
                fs::create_dir_all(p).map_err(|e| MemoryErr(e.to_string()))?;
            }
            fs::write(&full, bytes).map_err(|e| MemoryErr(e.to_string()))?;
            return Ok(cand);
        }
        err(format!("no free name for {name} in {dir}"))
    }

    /// Names of the images in the note's own folder that the note shows.
    pub(crate) fn attached_images(&self, note_rel: &str, content: &str) -> Vec<String> {
        let dir = parent_folder(note_rel);
        let mut out: Vec<String> = Vec::new();
        for c in re_any_image().captures_iter(content) {
            let raw = c
                .get(1)
                .or_else(|| c.get(2))
                .map_or("", |m| m.as_str())
                .trim();
            let raw = raw.strip_prefix("path:").unwrap_or(raw);
            let lower = raw.to_ascii_lowercase();
            if lower.starts_with("http://")
                || lower.starts_with("https://")
                || lower.starts_with("data:")
            {
                continue;
            }
            let name = pct_decode(raw.trim_start_matches("./"));
            if name.contains('/') || image_mime(&name).is_none() || out.contains(&name) {
                continue;
            }
            let rel = if dir.is_empty() {
                name.clone()
            } else {
                format!("{dir}/{name}")
            };
            if self.root().join(&rel).is_file() && self.visible(&rel) {
                out.push(name);
            }
        }
        out
    }

    /// Whether a note of `dir` other than `except` shows the image `name`.
    fn image_shown_by_others(&self, dir: &str, name: &str, except: &[&Path]) -> bool {
        let Ok(rd) = fs::read_dir(self.root().join(dir)) else {
            return false;
        };
        rd.flatten().any(|e| {
            let p = e.path();
            p.extension().is_some_and(|x| x == "md")
                && !except.contains(&p.as_path())
                && self.read(&p).is_some_and(|c| {
                    let rel = self.rel_of(&p);
                    self.attached_images(&rel, &c).iter().any(|n| n == name)
                })
        })
    }

    /// Move (or copy, when another note of the old folder still shows it) each image of a
    /// note that went from `old_note` to `new_note`, and fix the note when a name had to
    /// change. `content` is the note as it was before the move.
    pub(crate) fn carry_images(&self, old_note: &str, new_note: &str, content: &str) {
        let old_dir = parent_folder(old_note).to_string();
        let new_dir = parent_folder(new_note).to_string();
        if old_dir == new_dir {
            return;
        }
        let names = self.attached_images(old_note, content);
        if names.is_empty() {
            return;
        }
        let new_full = self.root().join(new_note);
        let mut text = self.read(&new_full).unwrap_or_else(|| content.to_string());
        let mut renamed = false;
        for name in names {
            let src_rel = if old_dir.is_empty() {
                name.clone()
            } else {
                format!("{old_dir}/{name}")
            };
            let src = self.root().join(&src_rel);
            let Ok(bytes) = fs::read(&src) else { continue };
            let Ok(placed) = self.place_image(&new_dir, &name, &bytes) else {
                continue;
            };
            if !self.image_shown_by_others(&old_dir, &name, &[new_full.as_path()]) {
                fs::remove_file(&src).ok();
            }
            if placed != name {
                text = rename_image_refs(&text, &name, &placed);
                renamed = true;
            }
        }
        if renamed {
            fs::write(&new_full, text).ok();
        }
    }

    /// Put the images of a note that is going to the trash into `.Trash/.assets/<entry>/`
    /// (copied when another note of its folder still shows them). Returns their names.
    pub(crate) fn trash_images(&self, note_rel: &str, content: &str, entry: &str) -> Vec<String> {
        let dir = parent_folder(note_rel).to_string();
        let names = self.attached_images(note_rel, content);
        let note_full = self.root().join(note_rel);
        let mut kept = Vec::new();
        for name in names {
            let src_rel = if dir.is_empty() {
                name.clone()
            } else {
                format!("{dir}/{name}")
            };
            let src = self.root().join(&src_rel);
            let dst = self.root().join(TRASH_ASSETS).join(entry).join(&name);
            if let Some(p) = dst.parent() {
                fs::create_dir_all(p).ok();
            }
            let shared = self.image_shown_by_others(&dir, &name, &[note_full.as_path()]);
            let ok = if shared {
                fs::copy(&src, &dst).is_ok()
            } else {
                fs::rename(&src, &dst).is_ok()
            };
            if ok {
                kept.push(name);
            }
        }
        kept
    }

    /// Bring a trash entry's images into the folder its note was restored to.
    pub(crate) fn restore_images(&self, entry: &str, note_rel: &str) {
        let src_dir = self.root().join(TRASH_ASSETS).join(entry);
        let Ok(rd) = fs::read_dir(&src_dir) else {
            return;
        };
        let dir = parent_folder(note_rel).to_string();
        let full = self.root().join(note_rel);
        let mut text = self.read(&full).unwrap_or_default();
        let mut renamed = false;
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(bytes) = fs::read(e.path()) else {
                continue;
            };
            if let Ok(placed) = self.place_image(&dir, &name, &bytes) {
                if placed != name {
                    text = rename_image_refs(&text, &name, &placed);
                    renamed = true;
                }
            }
        }
        fs::remove_dir_all(&src_dir).ok();
        if renamed {
            fs::write(&full, text).ok();
        }
    }

    /// Paths of a trash entry's images (for the history rewrite), then remove them.
    pub(crate) fn drop_trash_images(&self, entry: &str) -> Vec<String> {
        let dir = self.root().join(TRASH_ASSETS).join(entry);
        let paths = fs::read_dir(&dir)
            .map(|rd| {
                rd.flatten()
                    .map(|e| format!("{TRASH_ASSETS}/{entry}/{}", e.file_name().to_string_lossy()))
                    .collect()
            })
            .unwrap_or_default();
        fs::remove_dir_all(&dir).ok();
        paths
    }

    /// Delete for good the images only this note shows; returns their vault paths.
    pub(crate) fn delete_images(&self, note_rel: &str, content: &str) -> Vec<String> {
        let dir = parent_folder(note_rel).to_string();
        let full = self.root().join(note_rel);
        let mut gone = Vec::new();
        for name in self.attached_images(note_rel, content) {
            if self.image_shown_by_others(&dir, &name, &[full.as_path()]) {
                continue;
            }
            let rel = if dir.is_empty() {
                name.clone()
            } else {
                format!("{dir}/{name}")
            };
            if fs::remove_file(self.root().join(&rel)).is_ok() {
                gone.push(rel);
            }
        }
        gone
    }

    /// Save an uploaded image beside `note_rel`. Only PNG, JPEG, WebP and GIF are taken,
    /// told by their bytes, up to `max_bytes`. Returns `{path, name, bytes, url, markdown}`.
    pub fn save_image_impl(
        &self,
        note_rel: &str,
        name: &str,
        bytes: &[u8],
        max_bytes: usize,
    ) -> MResult<Value> {
        let note_rel = norm_note_path(note_rel);
        let ap = self.resolve(&note_rel)?;
        if !ap.is_file() || !self.visible(&note_rel) {
            return err(format!("not found: {note_rel}"));
        }
        if bytes.is_empty() {
            return err("the image is empty");
        }
        if bytes.len() > max_bytes {
            return err(format!(
                "the image is {:.1} MB; the limit is {:.1} MB (Settings, Images)",
                bytes.len() as f64 / 1_048_576.0,
                max_bytes as f64 / 1_048_576.0
            ));
        }
        let Some(ext) = sniff_image(bytes) else {
            return err("only PNG, JPEG, WebP and GIF images can be uploaded");
        };
        let dir = parent_folder(&note_rel).to_string();
        let placed = self.place_image(&dir, &upload_name(name, ext), bytes)?;
        let rel = if dir.is_empty() {
            placed.clone()
        } else {
            format!("{dir}/{placed}")
        };
        self.git_commit(&format!("image: {rel}"));
        let stem = placed.rsplit_once('.').map_or(placed.as_str(), |(s, _)| s);
        Ok(json!({
            "ok": true, "path": rel, "name": placed, "bytes": bytes.len(),
            "url": vault_file_url(&rel),
            "markdown": format!("![{stem}](path:{})", markdown_name(&placed)),
        }))
    }

    /// Delete one image file for good (its notes then show it as missing).
    pub fn delete_image_impl(&self, rel: &str) -> MResult<Value> {
        let full = self
            .vault_image_file(rel)
            .map_err(|_| MemoryErr(format!("image not found: {rel}")))?;
        fs::remove_file(&full).map_err(|e| MemoryErr(e.to_string()))?;
        self.git_commit(&format!("delete image: {rel}"));
        Ok(json!({"ok": true, "deleted": rel}))
    }

    /// The images directly in `folder` (never its sub folders or parents), each with the
    /// notes of that folder that show it and the section it sits in.
    pub fn folder_images_impl(&self, folder: &str) -> MResult<Vec<Value>> {
        let folder = if is_root_alias(folder) {
            String::new()
        } else {
            folder_arg(folder)?
        };
        if !folder.is_empty() && !self.visible(&folder) {
            return err(format!("folder not found: {folder}"));
        }
        let dir = self.root().join(&folder);
        let Ok(rd) = fs::read_dir(&dir) else {
            return err(format!("folder not found: {folder}"));
        };
        let mut images: Vec<(String, fs::Metadata)> = Vec::new();
        let mut notes: Vec<(String, String)> = Vec::new();
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let rel = if folder.is_empty() {
                name.clone()
            } else {
                format!("{folder}/{name}")
            };
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() || !self.visible(&rel) {
                continue;
            }
            if image_mime(&name).is_some() {
                images.push((name, meta));
            } else if name.ends_with(".md") {
                if let Some(c) = self.read(&e.path()) {
                    notes.push((rel, c));
                }
            }
        }
        images.sort_by_key(|a| a.0.to_lowercase());
        Ok(images
            .into_iter()
            .map(|(name, meta)| {
                let rel = if folder.is_empty() {
                    name.clone()
                } else {
                    format!("{folder}/{name}")
                };
                let used: Vec<Value> = notes
                    .iter()
                    .filter_map(|(n, c)| image_use(n, c, &name))
                    .collect();
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0.0, |d| d.as_secs_f64());
                json!({"path": rel, "name": name, "folder": folder, "bytes": meta.len(),
                       "mtime": mtime, "url": vault_file_url(&rel), "used_in": used})
            })
            .collect())
    }

    /// The images a note shows (with the section each sits in) and every image of its folder.
    pub fn note_images_impl(&self, note: &str) -> MResult<Value> {
        let note = norm_note_path(note);
        let ap = self.resolve(&note)?;
        if !ap.is_file() || !self.visible(&note) {
            return err(format!("not found: {note}"));
        }
        let content = self.read(&ap).unwrap_or_default();
        let folder = parent_folder(&note).to_string();
        let all = self.folder_images_impl(if folder.is_empty() { "Root" } else { &folder })?;
        let mine: Vec<Value> = all
            .iter()
            .filter(|v| {
                v["used_in"]
                    .as_array()
                    .is_some_and(|u| u.iter().any(|x| x["note"] == note.as_str()))
            })
            .map(|v| {
                let mut v = v.clone();
                if let Some(u) = image_use(&note, &content, v["name"].as_str().unwrap_or("")) {
                    v["heading"] = u["heading"].clone();
                }
                v
            })
            .collect();
        Ok(json!({"note": note, "folder": folder, "images": mine, "folder_images": all}))
    }

    /// Bytes and counts of the notes and images in the vault, for Settings.
    pub fn storage_impl(&self) -> Value {
        let (mut note_bytes, mut notes, mut image_bytes, mut images) = (0u64, 0u64, 0u64, 0u64);
        for e in WalkDir::new(self.root())
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
        {
            let len = e.metadata().map_or(0, |m| m.len());
            let name = e.file_name().to_string_lossy();
            if name.ends_with(".md") {
                note_bytes += len;
                notes += 1;
            } else if image_mime(&name).is_some() {
                image_bytes += len;
                images += 1;
            }
        }
        json!({"notes": notes, "note_bytes": note_bytes, "images": images,
               "image_bytes": image_bytes, "total_bytes": note_bytes + image_bytes})
    }
}

/// Bytes of base64 text (standard or URL-safe alphabet, padding and whitespace optional),
/// also accepted as a `data:image/...;base64,` URL; `None` when it is not base64.
pub fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let t = text.trim();
    let t = match t.split_once(";base64,") {
        Some((head, rest)) if head.starts_with("data:") => rest,
        _ => t,
    };
    let mut out = Vec::with_capacity(t.len() / 4 * 3);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in t.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            b' ' | b'\n' | b'\r' | b'\t' => continue,
            _ => return None,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

/// `{note, title, heading}` when the note `rel` (content `c`) shows the image `name` of its folder.
fn image_use(rel: &str, c: &str, name: &str) -> Option<Value> {
    for m in re_any_image().captures_iter(c) {
        let raw = m
            .get(1)
            .or_else(|| m.get(2))
            .map_or("", |x| x.as_str())
            .trim();
        let raw = raw.strip_prefix("path:").unwrap_or(raw);
        if pct_decode(raw.trim_start_matches("./")) == name {
            let at = m.get(0).map_or(0, |x| x.start());
            let stem = rel
                .rsplit('/')
                .next()
                .unwrap_or(rel)
                .trim_end_matches(".md");
            return Some(
                json!({"note": rel, "title": display_title(c, stem), "heading": heading_before(c, at)}),
            );
        }
    }
    None
}

/// Point every reference to the image `from` at `to` (same folder).
fn rename_image_refs(text: &str, from: &str, to: &str) -> String {
    re_any_image()
        .replace_all(text, |c: &regex::Captures| {
            let whole = &c[0];
            let raw = c.get(1).or_else(|| c.get(2)).map_or("", |m| m.as_str());
            let bare = raw.trim().strip_prefix("path:").unwrap_or(raw.trim());
            if pct_decode(bare.trim_start_matches("./")) == from {
                let lead = if bare.starts_with("./") { "./" } else { "" };
                whole.replacen(
                    raw,
                    &raw.replace(bare, &format!("{lead}{}", markdown_name(to))),
                    1,
                )
            } else {
                whole.to_string()
            }
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_names_are_clean_and_keep_the_real_kind() {
        assert_eq!(upload_name("My Photo (1).JPG", "webp"), "My-Photo-1.webp");
        assert_eq!(upload_name("../../etc/passwd", "png"), "passwd.png");
        assert_eq!(upload_name("...", "gif"), "image.gif");
    }

    #[test]
    fn only_real_images_are_recognised() {
        assert_eq!(sniff_image(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(sniff_image(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff_image(b"<svg onload=alert(1)>"), None);
    }

    #[test]
    fn renaming_an_image_rewrites_every_kind_of_reference() {
        let t = "![a](path:pic.png) and ![[pic.png]] and ![b](./pic.png) but not ![c](path:pic.png.old)";
        let out = rename_image_refs(t, "pic.png", "pic-1.png");
        assert!(out.contains("(path:pic-1.png)"), "{out}");
        assert!(out.contains("![[pic-1.png"), "{out}");
        assert!(out.contains("(./pic-1.png)"), "{out}");
        assert!(out.contains("path:pic.png.old"), "{out}");
    }

    #[test]
    fn base64_in_both_alphabets_and_as_a_data_url() {
        assert_eq!(decode_base64("aGk=").as_deref(), Some(&b"hi"[..]));
        assert_eq!(
            decode_base64("data:image/png;base64,aGk").as_deref(),
            Some(&b"hi"[..])
        );
        assert_eq!(decode_base64("-_8").as_deref(), Some(&[0xfb, 0xff][..]));
        assert!(decode_base64("not*base64").is_none());
    }

    #[test]
    fn sections_come_from_the_heading_above() {
        let c = "# Top\n\ntext\n\n## Photos\n\n![x](path:a.png)\n";
        let at = c.find("![x]").unwrap();
        assert_eq!(heading_before(c, at).as_deref(), Some("Photos"));
    }
}
