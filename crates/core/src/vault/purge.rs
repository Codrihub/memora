//! Erase notes deleted for good from every commit, tag and object of the vault history.
//!
//! `fast-export` is filtered into `fast-import` under temporary refs, which replace the
//! real refs in one `update-ref` transaction; a failure before that leaves history intact.

use super::*;
use std::io::Write;
use std::process::Stdio;
use std::time::Instant;

/// Namespace the rewritten history is built under before the swap.
const TMP_NS: &str = "refs/memora-purge/";
/// Annotated tags can only be written under refs/tags/ by fast-import.
const TMP_TAG: &str = "memora-purge-tmp/";
/// What commit messages say instead of an erased note's path.
const GONE: &str = "a deleted note";

/// A filtered fast-import stream, the refs it writes (temporary name, real name)
/// and how many commits it keeps.
type Filtered = (Vec<u8>, Vec<(String, String)>, usize);

/// Commits (oldest-first positions `lo..=hi`) during which an erased note lived at `path`.
struct Window {
    path: String,
    lo: usize,
    hi: usize,
}

/// Undo git's C-style path quoting (`"a b\"c"`).
fn unquote(raw: &[u8]) -> Vec<u8> {
    if raw.len() < 2 || raw[0] != b'"' || raw[raw.len() - 1] != b'"' {
        return raw.to_vec();
    }
    let s = &raw[1..raw.len() - 1];
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        if s[i] != b'\\' || i + 1 >= s.len() {
            out.push(s[i]);
            i += 1;
            continue;
        }
        let c = s[i + 1];
        i += 2;
        match c {
            b'n' => out.push(b'\n'),
            b't' => out.push(b'\t'),
            b'r' => out.push(b'\r'),
            b'a' => out.push(7),
            b'b' => out.push(8),
            b'f' => out.push(12),
            b'v' => out.push(11),
            b'0'..=b'7' => {
                // Three octal digits: one raw byte (UTF-8 names arrive this way).
                let mut v = u32::from(c - b'0');
                for _ in 0..2 {
                    if i < s.len() && (b'0'..=b'7').contains(&s[i]) {
                        v = v * 8 + u32::from(s[i] - b'0');
                        i += 1;
                    }
                }
                out.push(v as u8);
            }
            other => out.push(other),
        }
    }
    out
}

/// The path of a `M <mode> <ref> <path>` or `D <path>` line.
fn op_path(line: &[u8]) -> Option<Vec<u8>> {
    let rest = if let Some(r) = line.strip_prefix(b"M ") {
        let mut it = r.splitn(3, |b| *b == b' ');
        let (_, _, p) = (it.next()?, it.next()?, it.next()?);
        p
    } else {
        line.strip_prefix(b"D ")?
    };
    Some(unquote(rest))
}

/// A fast-export stream, read line by line (with `data <n>` payloads read whole).
struct Stream<'a> {
    buf: &'a [u8],
    at: usize,
}

impl<'a> Stream<'a> {
    fn line(&mut self) -> Option<&'a [u8]> {
        if self.at >= self.buf.len() {
            return None;
        }
        let rest = &self.buf[self.at..];
        let end = rest.iter().position(|b| *b == b'\n').unwrap_or(rest.len());
        self.at += (end + 1).min(rest.len());
        Some(&rest[..end])
    }

    fn peek(&self) -> Option<&'a [u8]> {
        let mut s = Stream {
            buf: self.buf,
            at: self.at,
        };
        s.line()
    }

    /// The payload after a `data <n>` line.
    fn data(&mut self, header: &[u8]) -> MResult<&'a [u8]> {
        let n: usize = std::str::from_utf8(header.strip_prefix(b"data ").unwrap_or(b""))
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .ok_or_else(|| MemoryErr("history rewrite: unexpected data header".into()))?;
        let end = self.at + n;
        if end > self.buf.len() {
            return err("history rewrite: truncated export");
        }
        let d = &self.buf[self.at..end];
        self.at = end;
        // A data block may be followed by one optional newline.
        if self.buf.get(self.at) == Some(&b'\n') {
            self.at += 1;
        }
        Ok(d)
    }
}

fn data_block(out: &mut Vec<u8>, d: &[u8]) {
    out.extend_from_slice(format!("data {}\n", d.len()).as_bytes());
    out.extend_from_slice(d);
    out.push(b'\n');
}

fn replace_all(hay: &[u8], needle: &[u8], with: &[u8]) -> Vec<u8> {
    if needle.is_empty() || hay.len() < needle.len() {
        return hay.to_vec();
    }
    let mut out = Vec::with_capacity(hay.len());
    let mut i = 0;
    while i < hay.len() {
        if hay[i..].starts_with(needle) {
            out.extend_from_slice(with);
            i += needle.len();
        } else {
            out.push(hay[i]);
            i += 1;
        }
    }
    out
}

impl MemoryStore {
    /// The windows of the note last at `path`, following renames back to its creation.
    fn note_windows(&self, path: &str, order: &HashMap<String, usize>, head: usize) -> Vec<Window> {
        let (ok, out) = self.git(&[
            "--literal-pathspecs",
            "log",
            "--follow",
            "-M",
            "--name-only",
            "--format=%x1e%H",
            "HEAD~1",
            "--",
            path,
        ]);
        let entries: Vec<(usize, String)> = if ok {
            out.split('\x1e')
                .filter_map(|rec| {
                    let mut lines = rec.lines();
                    let id = lines.next()?.trim();
                    let name = lines.map(str::trim).find(|l| !l.is_empty())?;
                    let name = String::from_utf8_lossy(&unquote(name.as_bytes())).to_string();
                    Some((*order.get(id)?, name))
                })
                .collect()
        } else {
            Vec::new()
        };
        // Newest first: a change of name means the note came to `cur` in the
        // newer entry's commit and lived at the older name until then.
        let mut out = Vec::new();
        let mut cur = path.to_string();
        let mut hi = head;
        let mut lo: Option<usize> = None;
        for (at, name) in entries {
            if name == cur {
                lo = Some(at);
                continue;
            }
            let came = lo.unwrap_or(hi);
            out.push(Window {
                path: std::mem::replace(&mut cur, name),
                lo: came,
                hi,
            });
            hi = came;
            lo = Some(at);
        }
        out.push(Window {
            path: cur,
            lo: lo.unwrap_or(hi),
            hi,
        });
        out
    }

    /// Erase the notes last at `paths` (deleted and committed at HEAD) from the whole
    /// history: every name they had, their `trash_names` index records and their paths
    /// in commit messages; emptied commits are dropped. Returns `{erased, ms, commits}`.
    pub(super) fn purge_history(&self, paths: &[String], trash_names: &[String]) -> MResult<Value> {
        let started = Instant::now();
        if !self.history_enabled() || paths.is_empty() {
            return Ok(json!({"erased": false, "ms": 0}));
        }
        let (ok, out) = self.git(&["rev-list", "--all", "--topo-order", "--reverse"]);
        if !ok {
            return err("history rewrite: could not list the commits");
        }
        let order: HashMap<String, usize> = out
            .lines()
            .enumerate()
            .map(|(i, id)| (id.trim().to_string(), i))
            .collect();
        let (_, head_id) = self.git(&["rev-parse", "HEAD"]);
        let head = *order
            .get(head_id.trim())
            .ok_or_else(|| MemoryErr("history rewrite: HEAD is not on a ref".into()))?;
        let windows: Vec<Window> = paths
            .iter()
            .flat_map(|p| self.note_windows(p, &order, head))
            .collect();
        let names: HashSet<&str> = windows.iter().map(|w| w.path.as_str()).collect();
        let trash: HashSet<&str> = trash_names.iter().map(String::as_str).collect();

        // Leftovers of an interrupted run would collide with the new refs.
        self.drop_tmp_refs();
        let export = self
            .git_cmd()
            .args([
                "fast-export",
                "--all",
                "--no-data",
                "--show-original-ids",
                "--signed-tags=strip",
                "--tag-of-filtered-object=rewrite",
            ])
            .output()
            .map_err(|e| MemoryErr(format!("history rewrite: {e}")))?;
        if !export.status.success() {
            return err(format!(
                "history rewrite: export failed: {}",
                String::from_utf8_lossy(&export.stderr).trim()
            ));
        }
        let mut blobs: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
        let (stream, refs, kept) =
            self.filter_export(&export.stdout, &order, &windows, &names, &trash, &mut blobs)?;
        if let Err(e) = self.import_and_swap(&stream, &refs) {
            self.drop_tmp_refs();
            return Err(e);
        }
        // The old objects go for good: no reflog or ORIG_HEAD keeps them alive.
        let _ = self.git(&["read-tree", "HEAD"]);
        let _ = self.git(&["update-ref", "-d", "ORIG_HEAD"]);
        let _ = self.git(&[
            "reflog",
            "expire",
            "--expire=now",
            "--expire-unreachable=now",
            "--all",
        ]);
        let _ = self.git(&["gc", "--prune=now", "--quiet"]);
        Ok(json!({"erased": true, "ms": started.elapsed().as_millis() as u64, "commits": kept}))
    }

    /// Filter a fast-export stream (see [`Filtered`]).
    fn filter_export(
        &self,
        raw: &[u8],
        order: &HashMap<String, usize>,
        windows: &[Window],
        names: &HashSet<&str>,
        trash: &HashSet<&str>,
        blobs: &mut HashMap<Vec<u8>, Vec<u8>>,
    ) -> MResult<Filtered> {
        let in_window = |path: &[u8], at: Option<usize>| -> bool {
            let Some(at) = at else { return false };
            windows
                .iter()
                .any(|w| w.lo <= at && at <= w.hi && w.path.as_bytes() == path)
        };
        let mut refs: Vec<(String, String)> = Vec::new();
        let tmp_ref = |r: &str, refs: &mut Vec<(String, String)>| -> String {
            let t = format!("{TMP_NS}{}", r.strip_prefix("refs/").unwrap_or(r));
            if !refs.iter().any(|(a, _)| *a == t) {
                refs.push((t.clone(), r.to_string()));
            }
            t
        };
        // Marks of dropped commits point at what replaces them (their parent).
        let mut alias: HashMap<String, Option<String>> = HashMap::new();
        let resolve = |m: &str, alias: &HashMap<String, Option<String>>| -> Option<String> {
            let mut cur = m.to_string();
            for _ in 0..100_000 {
                match alias.get(&cur) {
                    Some(Some(next)) => cur = next.clone(),
                    Some(None) => return None,
                    None => return Some(cur),
                }
            }
            Some(cur)
        };
        let mut kept = 0usize;
        let mut out = Vec::with_capacity(raw.len());
        let mut s = Stream { buf: raw, at: 0 };
        while let Some(line) = s.line() {
            if line.is_empty() {
                continue;
            }
            if let Some(r) = line.strip_prefix(b"reset ") {
                let r = String::from_utf8_lossy(r).to_string();
                let t = tmp_ref(&r, &mut refs);
                let from = match s.peek() {
                    Some(l) if l.starts_with(b"from ") => {
                        s.line();
                        Some(String::from_utf8_lossy(&l[5..]).to_string())
                    }
                    _ => None,
                };
                match from {
                    Some(f) => {
                        if let Some(f) = resolve(&f, &alias) {
                            out.extend_from_slice(format!("reset {t}\nfrom {f}\n\n").as_bytes());
                        }
                    }
                    None => out.extend_from_slice(format!("reset {t}\n").as_bytes()),
                }
            } else if let Some(r) = line.strip_prefix(b"commit ") {
                let r = String::from_utf8_lossy(r).to_string();
                let t = tmp_ref(&r, &mut refs);
                let mut head: Vec<&[u8]> = Vec::new();
                let mut mark = None;
                let mut at = None;
                let mut msg: &[u8] = b"";
                while let Some(l) = s.line() {
                    if l.starts_with(b"data ") {
                        msg = s.data(l)?;
                        break;
                    }
                    if let Some(m) = l.strip_prefix(b"mark ") {
                        mark = Some(String::from_utf8_lossy(m).to_string());
                    }
                    if let Some(o) = l.strip_prefix(b"original-oid ") {
                        at = order.get(String::from_utf8_lossy(o).trim()).copied();
                        continue;
                    }
                    head.push(l);
                }
                let mut from = None;
                let mut merges = Vec::new();
                let mut ops: Vec<Vec<u8>> = Vec::new();
                let mut had_ops = 0usize;
                while let Some(l) = s.peek() {
                    if l.is_empty() {
                        s.line();
                        break;
                    }
                    if !(l.starts_with(b"from ")
                        || l.starts_with(b"merge ")
                        || l.starts_with(b"M ")
                        || l.starts_with(b"D ")
                        || l.starts_with(b"C ")
                        || l.starts_with(b"R ")
                        || l == b"deleteall")
                    {
                        break;
                    }
                    s.line();
                    if let Some(f) = l.strip_prefix(b"from ") {
                        from = Some(String::from_utf8_lossy(f).to_string());
                    } else if let Some(m) = l.strip_prefix(b"merge ") {
                        merges.push(String::from_utf8_lossy(m).to_string());
                    } else {
                        had_ops += 1;
                        let path = op_path(l);
                        if path.as_deref().is_some_and(|p| in_window(p, at)) {
                            continue;
                        }
                        if path.as_deref() == Some(b".Trash/.index.json".as_slice())
                            && l.starts_with(b"M ")
                        {
                            ops.push(self.filter_trash_index(l, names, trash, blobs)?);
                        } else {
                            ops.push(l.to_vec());
                        }
                    }
                }
                let from = from.and_then(|f| resolve(&f, &alias));
                let merges: Vec<String> =
                    merges.iter().filter_map(|m| resolve(m, &alias)).collect();
                if had_ops > 0 && ops.is_empty() && merges.is_empty() {
                    if let Some(m) = mark {
                        alias.insert(m, from);
                    }
                    continue;
                }
                kept += 1;
                // Paths of erased notes leave the messages of the commits they were in.
                let mut msg = msg.to_vec();
                let mut named: Vec<&Window> = windows
                    .iter()
                    .filter(|w| at.is_some_and(|a| w.lo <= a && a <= w.hi))
                    .collect();
                named.sort_by_key(|w| std::cmp::Reverse(w.path.len()));
                for w in named {
                    msg = replace_all(&msg, w.path.as_bytes(), GONE.as_bytes());
                }
                out.extend_from_slice(format!("commit {t}\n").as_bytes());
                for h in head {
                    out.extend_from_slice(h);
                    out.push(b'\n');
                }
                data_block(&mut out, &msg);
                if let Some(f) = from {
                    out.extend_from_slice(format!("from {f}\n").as_bytes());
                }
                for m in merges {
                    out.extend_from_slice(format!("merge {m}\n").as_bytes());
                }
                for op in ops {
                    out.extend_from_slice(&op);
                    out.push(b'\n');
                }
                out.push(b'\n');
            } else if let Some(name) = line.strip_prefix(b"tag ") {
                let name = String::from_utf8_lossy(name).to_string();
                let mut lines: Vec<&[u8]> = Vec::new();
                let mut from = None;
                let mut msg: &[u8] = b"";
                while let Some(l) = s.line() {
                    if l.starts_with(b"data ") {
                        msg = s.data(l)?;
                        break;
                    }
                    if let Some(f) = l.strip_prefix(b"from ") {
                        from = Some(String::from_utf8_lossy(f).to_string());
                    } else if !l.starts_with(b"original-oid ") {
                        lines.push(l);
                    }
                }
                let Some(from) = from.and_then(|f| resolve(&f, &alias)) else {
                    continue;
                };
                let tmp = format!("{TMP_TAG}{name}");
                refs.push((format!("refs/tags/{tmp}"), format!("refs/tags/{name}")));
                out.extend_from_slice(format!("tag {tmp}\nfrom {from}\n").as_bytes());
                for l in lines {
                    out.extend_from_slice(l);
                    out.push(b'\n');
                }
                data_block(&mut out, msg);
                out.push(b'\n');
            } else if line.starts_with(b"feature ")
                || line.starts_with(b"progress ")
                || line == b"done"
            {
                continue;
            } else {
                return err(format!(
                    "history rewrite: unexpected export line: {}",
                    String::from_utf8_lossy(&line[..line.len().min(60)])
                ));
            }
        }
        Ok((out, refs, kept))
    }

    /// A `M <mode> <sha> .Trash/.index.json` line with the erased notes' records
    /// taken out of that version of the trash index (same line when none is there).
    fn filter_trash_index(
        &self,
        line: &[u8],
        names: &HashSet<&str>,
        trash: &HashSet<&str>,
        blobs: &mut HashMap<Vec<u8>, Vec<u8>>,
    ) -> MResult<Vec<u8>> {
        let mut it = line.splitn(4, |b| *b == b' ');
        let (_, mode, sha) = (
            it.next(),
            it.next().unwrap_or(b"100644"),
            it.next().unwrap_or(b""),
        );
        if let Some(done) = blobs.get(sha) {
            return Ok(done.clone());
        }
        let sha_s = String::from_utf8_lossy(sha).to_string();
        let old = self
            .git_cmd()
            .args(["cat-file", "blob", &sha_s])
            .output()
            .map_err(|e| MemoryErr(format!("history rewrite: {e}")))?;
        let mut new_line = line.to_vec();
        if let Ok(Value::Object(mut map)) = serde_json::from_slice::<Value>(&old.stdout) {
            let before = map.len();
            map.retain(|k, v| {
                let named = v
                    .get("path")
                    .and_then(Value::as_str)
                    .is_none_or(|p| names.contains(p));
                !(trash.contains(k.as_str()) && named)
            });
            if map.len() != before {
                let body = serde_json::to_vec_pretty(&Value::Object(map)).unwrap_or_default();
                let mut child = self
                    .git_cmd()
                    .args(["hash-object", "-w", "--stdin"])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .spawn()
                    .map_err(|e| MemoryErr(format!("history rewrite: {e}")))?;
                child
                    .stdin
                    .take()
                    .map(|mut i| i.write_all(&body))
                    .transpose()
                    .map_err(|e| MemoryErr(format!("history rewrite: {e}")))?;
                let o = child
                    .wait_with_output()
                    .map_err(|e| MemoryErr(format!("history rewrite: {e}")))?;
                if !o.status.success() {
                    return err("history rewrite: could not write the trash index");
                }
                let new_sha = String::from_utf8_lossy(&o.stdout).trim().to_string();
                new_line = format!(
                    "M {} {new_sha} .Trash/.index.json",
                    String::from_utf8_lossy(mode)
                )
                .into_bytes();
            }
        }
        blobs.insert(sha.to_vec(), new_line.clone());
        Ok(new_line)
    }

    /// Import the filtered stream under the temporary refs, then point every real
    /// ref at its rewritten commit (and drop the temporary refs) in one transaction.
    fn import_and_swap(&self, stream: &[u8], refs: &[(String, String)]) -> MResult<()> {
        let (ok, stderr) = self.git_stdin(&["fast-import", "--quiet"], stream)?;
        if !ok {
            return err(format!("history rewrite: import failed: {stderr}"));
        }
        let mut tx = String::from("start\n");
        for (tmp, real) in refs {
            let (ok, id) = self.git(&["rev-parse", "--verify", "--quiet", tmp]);
            if !ok {
                // Every commit of that ref was erased: the ref goes too.
                if self.git(&["rev-parse", "--verify", "--quiet", real]).0 {
                    tx.push_str(&format!("delete {real}\n"));
                }
                continue;
            }
            tx.push_str(&format!("update {real} {}\ndelete {tmp}\n", id.trim()));
        }
        tx.push_str("prepare\ncommit\n");
        let (ok, stderr) = self.git_stdin(&["update-ref", "--stdin"], tx.as_bytes())?;
        if !ok {
            return err(format!(
                "history rewrite: could not switch to the rewritten history: {stderr}"
            ));
        }
        Ok(())
    }

    /// Run git with `input` on stdin: `(exited 0 and took all input, trimmed stderr)`.
    fn git_stdin(&self, args: &[&str], input: &[u8]) -> MResult<(bool, String)> {
        let mut child = self
            .git_cmd()
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| MemoryErr(format!("history rewrite: {e}")))?;
        let wrote = child.stdin.take().map(|mut i| i.write_all(input));
        let o = child
            .wait_with_output()
            .map_err(|e| MemoryErr(format!("history rewrite: {e}")))?;
        let ok = o.status.success() && matches!(wrote, Some(Ok(())));
        Ok((ok, String::from_utf8_lossy(&o.stderr).trim().to_string()))
    }

    /// Remove the temporary refs of a rewrite (after a failure or a crash).
    fn drop_tmp_refs(&self) {
        let (_, out) = self.git(&[
            "for-each-ref",
            "--format=%(refname)",
            TMP_NS,
            &format!("refs/tags/{TMP_TAG}"),
        ]);
        for r in out.lines().map(str::trim).filter(|r| !r.is_empty()) {
            let _ = self.git(&["update-ref", "-d", r]);
        }
    }
}
