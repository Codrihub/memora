//! Worst cases for link rewriting when notes share a name (issue #54): renaming,
//! moving or deleting one `Index.md` must never retarget a link meant for another.
//!
//! Besides exact file contents, every test checks two invariants after each
//! operation: every wikilink in the vault still names the note it named before
//! (moved paths mapped), and the graph and `link_stats` agree with that.

use super::*;

fn vault(tag: &str, files: &[(&str, &str)]) -> (PathBuf, MemoryStore) {
    let d = std::env::temp_dir().join(format!(
        "memora-relink-{tag}-{}-{}",
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

/// Every file of the vault outside dot folders (path -> content).
fn snapshot(d: &Path) -> BTreeMap<String, String> {
    WalkDir::new(d)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
        .flatten()
        .filter(|e| e.file_type().is_file())
        .map(|e| {
            let rel = e.path().strip_prefix(d).unwrap();
            let rel = rel.to_string_lossy().replace('\\', "/");
            (rel, fs::read_to_string(e.path()).unwrap_or_default())
        })
        .collect()
}

/// The files whose content changed since `before`, at their new paths; every file
/// of `before` must still exist at `moved(path)` and no file may appear or vanish.
fn changed(
    before: &BTreeMap<String, String>,
    d: &Path,
    moved: &dyn Fn(&str) -> String,
) -> BTreeSet<String> {
    let after = snapshot(d);
    let mut out = BTreeSet::new();
    for (rel, body) in before {
        let new = moved(rel);
        let now = after
            .get(&new)
            .unwrap_or_else(|| panic!("{rel} should be at {new}; files: {after:#?}"));
        if now != body {
            out.insert(new);
        }
    }
    assert_eq!(after.len(), before.len(), "{after:#?}");
    out
}

fn set(paths: &[&str]) -> BTreeSet<String> {
    paths.iter().map(|p| p.to_string()).collect()
}

/// A path mapping from explicit pairs (other paths stay).
fn pairs(p: &[(&str, &str)]) -> impl Fn(&str) -> String {
    let m: HashMap<String, String> = p
        .iter()
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect();
    move |rel: &str| m.get(rel).cloned().unwrap_or_else(|| rel.to_string())
}

/// A path mapping that moves everything under `from/` to `to/`.
fn prefix(from: &str, to: &str) -> impl Fn(&str) -> String {
    let (from, to) = (format!("{from}/"), format!("{to}/"));
    move |rel: &str| match rel.strip_prefix(&from) {
        Some(rest) => format!("{to}{rest}"),
        None => rel.to_string(),
    }
}

fn identity(rel: &str) -> String {
    rel.to_string()
}

/// What every wikilink of every note (hidden ones too) names now, in order, as
/// the rewriter and the renderer resolve it (`None` = broken).
fn meanings(s: &MemoryStore) -> BTreeMap<String, Vec<Option<String>>> {
    let files = s.walk_all();
    let idx = LinkIndex::new(files.iter().map(|(rel, _, _)| rel.clone()));
    files
        .iter()
        .map(|(rel, _, fp)| {
            let c = fs::read_to_string(fp).unwrap();
            let dir = parent_folder(rel);
            let v = s
                .link_targets(&c)
                .iter()
                .filter_map(|raw| {
                    let t = raw.split('#').next().unwrap_or("").trim();
                    (!t.is_empty()).then(|| idx.resolve(t, dir))
                })
                .collect();
            (rel.clone(), v)
        })
        .collect()
}

/// Every link still names the note it named in `before`, with `moved` applied to
/// the linking notes and to the targets.
fn assert_meaning_kept(
    before: &BTreeMap<String, Vec<Option<String>>>,
    s: &MemoryStore,
    moved: &dyn Fn(&str) -> String,
) {
    let want: BTreeMap<String, Vec<Option<String>>> = before
        .iter()
        .map(|(rel, ts)| {
            let ts = ts.iter().map(|t| t.as_deref().map(moved)).collect();
            (moved(rel), ts)
        })
        .collect();
    let now = meanings(s);
    for (rel, ts) in &want {
        assert_eq!(now.get(rel), Some(ts), "links of {rel} changed meaning");
    }
    assert_eq!(now.len(), want.len());
}

/// The graph edges and `link_stats` of every note match the resolved links.
fn assert_graph_agrees(s: &MemoryStore) {
    let m = meanings(s);
    let mut want: BTreeSet<(String, String)> = BTreeSet::new();
    for (src, ts) in &m {
        for t in ts.iter().flatten() {
            if t != src {
                want.insert((src.clone(), t.clone()));
            }
        }
    }
    let got: BTreeSet<(String, String)> = s
        .graph()
        .links
        .into_iter()
        .map(|l| (l.source, l.target))
        .collect();
    assert_eq!(got, want, "graph edges");
    for rel in m.keys() {
        let v = s.link_stats_impl(rel).unwrap();
        let out: Vec<String> = want
            .iter()
            .filter(|(a, _)| a == rel)
            .map(|(_, b)| b.clone())
            .collect();
        let inc: Vec<String> = want
            .iter()
            .filter(|(_, b)| b == rel)
            .map(|(a, _)| a.clone())
            .collect();
        assert_eq!(v["links_to_paths"], json!(out), "{rel}: {v}");
        assert_eq!(v["linked_from_paths"], json!(inc), "{rel}: {v}");
    }
}

// Every link form, written in the same text into notes of several folders.
const L1: &str = "[[Index]] [[Index#Top]] [[Index|home]] [[Index.md]] ![[Index]] [[index]]";
const L2: &str = "[[A/Index]] [[/A/Index]] [[a/index.md#x|y]] [[B/Index]] [[C/Index#c|c]]";
const L3: &str = "| t | [[A/Index\\|t]] |";
/// Never links: code spans, a placeholder and a fenced code block.
const TAIL: &str = "`[[Index]]` {{[[Index]]}} `[[A/Index]]`\n```\n[[Index]] [[A/Index]]\n```\n";

fn links() -> String {
    format!("{L1}\n{L2}\n{L3}\n{TAIL}")
}

/// [`L1`] with every bare target written as `to`.
fn bare(to: &str) -> String {
    format!("[[{to}]] [[{to}#Top]] [[{to}|home]] [[{to}.md]] ![[{to}]] [[{to}]]")
}

/// `base` with each `(old, new)` replaced once (`old` must be there).
fn with(base: &str, edits: &[(&str, &str)]) -> String {
    let mut out = base.to_string();
    for (old, new) in edits {
        assert!(out.contains(old), "{old:?} not in {out:?}");
        out = out.replacen(old, new, 1);
    }
    out
}

/// `Index.md` in the root and in A, B and C; the link notes in A, B, C, D (which
/// has no Index of its own, so its bare `[[Index]]` means the root one) and the root.
fn index_vault(tag: &str) -> (PathBuf, MemoryStore) {
    let l = links();
    vault(
        tag,
        &[
            ("Index.md", "# Root\n"),
            ("A/Index.md", "# A\n[[Index]] [[B/Index]]\n"),
            ("B/Index.md", "# B\n"),
            ("C/Index.md", "# C\n"),
            ("A/a.md", &l),
            ("B/b.md", &l),
            ("C/c.md", &l),
            ("D/d.md", &l),
            ("top.md", &l),
        ],
    )
}

#[test]
fn the_fixture_links_resolve_as_intended() {
    let (d, s) = index_vault("fixture");
    let m = meanings(&s);
    let own = |rel: &str, idx: &str| {
        let v = &m[rel];
        assert_eq!(v.len(), 12, "{rel}: {v:?}");
        let ix = |p: &str| Some(p.to_string());
        let want = [
            vec![ix(idx); 6],
            vec![ix("A/Index.md"); 3],
            vec![ix("B/Index.md"), ix("C/Index.md"), ix("A/Index.md")],
        ]
        .concat();
        assert_eq!(*v, want, "{rel}");
    };
    own("A/a.md", "A/Index.md");
    own("B/b.md", "B/Index.md");
    own("C/c.md", "C/Index.md");
    own("D/d.md", "Index.md");
    own("top.md", "Index.md");
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn renaming_one_index_rewrites_only_the_links_meant_for_it() {
    let (d, s) = index_vault("rename-one");
    let before = snapshot(&d);
    let meant = meanings(&s);
    let (to, n) = s.rename_note("A/Index.md", "Home").unwrap();
    assert_eq!(to, "A/Home.md");
    let moved = pairs(&[("A/Index.md", "A/Home.md")]);
    let l2 = "[[A/Home]] [[A/Home]] [[A/Home.md#x|y]] [[B/Index]] [[C/Index#c|c]]";
    let l3 = "| t | [[A/Home\\|t]] |";
    let others = with(&links(), &[(L2, l2), (L3, l3)]);
    assert_eq!(read(&d, "A/a.md"), with(&others, &[(L1, &bare("Home"))]));
    for rel in ["B/b.md", "C/c.md", "D/d.md", "top.md"] {
        assert_eq!(read(&d, rel), others, "{rel}");
    }
    // Its own self link follows it; its link to B/Index stays.
    assert_eq!(read(&d, "A/Home.md"), "# A\n[[Home]] [[B/Index]]\n");
    assert_eq!(
        changed(&before, &d, &moved),
        set(&[
            "A/Home.md",
            "A/a.md",
            "B/b.md",
            "C/c.md",
            "D/d.md",
            "top.md"
        ])
    );
    assert_eq!(n, 6);
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn renaming_an_index_to_a_case_variant_rewrites_nothing() {
    let (d, s) = index_vault("rename-case");
    let before = snapshot(&d);
    let meant = meanings(&s);
    let (to, n) = s.rename_note("A/Index.md", "INDEX").unwrap();
    assert_eq!((to.as_str(), n), ("A/INDEX.md", 0));
    let moved = pairs(&[("A/Index.md", "A/INDEX.md")]);
    assert!(changed(&before, &d, &moved).is_empty());
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn moving_an_index_where_one_already_lives_is_refused_and_changes_nothing() {
    let (d, s) = index_vault("move-refused");
    fs::create_dir_all(d.join("E")).unwrap();
    fs::write(d.join("E/INDEX.md"), "# E\n").unwrap();
    let before = snapshot(&d);
    for into in ["B", "C", "", "Root", "E"] {
        let e = s.move_note("A/Index.md", into).unwrap_err().0;
        assert!(e.contains("already exists"), "{into}: {e}");
    }
    // Renaming onto an existing name is refused the same way.
    let e = s.rename_note("A/a.md", "INDEX").unwrap_err().0;
    assert!(e.contains("already exists"), "{e}");
    assert!(changed(&before, &d, &identity).is_empty());
    fs::remove_dir_all(&d).ok();
}

#[test]
fn moving_an_index_to_a_new_folder_keeps_every_link_meaning() {
    let (d, s) = index_vault("move-new");
    // B's Index leaves B: B's bare links must now name it by path.
    let before = snapshot(&d);
    let meant = meanings(&s);
    let (to, _) = s.move_note("B/Index.md", "Archive").unwrap();
    assert_eq!(to, "Archive/Index.md");
    let moved = pairs(&[("B/Index.md", "Archive/Index.md")]);
    let l2 = "[[A/Index]] [[/A/Index]] [[a/index.md#x|y]] [[Archive/Index]] [[C/Index#c|c]]";
    let others = with(&links(), &[(L2, l2)]);
    assert_eq!(
        read(&d, "B/b.md"),
        with(&others, &[(L1, &bare("Archive/Index"))])
    );
    for rel in ["A/a.md", "C/c.md", "D/d.md", "top.md"] {
        assert_eq!(read(&d, rel), others, "{rel}");
    }
    assert_eq!(read(&d, "A/Index.md"), "# A\n[[Index]] [[Archive/Index]]\n");
    assert_eq!(
        changed(&before, &d, &moved),
        set(&[
            "A/Index.md",
            "A/a.md",
            "B/b.md",
            "C/c.md",
            "D/d.md",
            "top.md"
        ])
    );
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);

    // The root Index leaves the root: D and the root fall back to A/Index unless
    // rewritten, so their bare links get the new path.
    let before = snapshot(&d);
    let meant = meanings(&s);
    s.move_note("Index.md", "Old").unwrap();
    let moved = pairs(&[("Index.md", "Old/Index.md")]);
    let mid = with(&links(), &[(L2, l2)]);
    let gone = with(&mid, &[(L1, &bare("Old/Index"))]);
    assert_eq!(read(&d, "D/d.md"), gone);
    assert_eq!(read(&d, "top.md"), gone);
    assert_eq!(read(&d, "A/a.md"), mid);
    assert_eq!(changed(&before, &d, &moved), set(&["D/d.md", "top.md"]));
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn an_index_arriving_in_a_folder_does_not_hijack_its_bare_links() {
    // C has no Index and there is none in the root: `[[Index]]` in C means
    // A/Index.md (shallowest, then alphabetical).
    let (d, s) = vault(
        "hijack",
        &[
            ("A/Index.md", "# A\n"),
            ("B/Index.md", "# B\n"),
            ("Z/Index.md", "# Z\n"),
            (
                "C/Note.md",
                "[[Index]] [[Index#h|x]] [[index.md]] ![[Index]]\n",
            ),
            ("C/Start.md", "# start\n"),
            ("C/Deep/n.md", "[[Index]]\n"),
            ("top.md", "[[Index]]\n"),
        ],
    );
    // An Index renamed into existence in C.
    let meant = meanings(&s);
    s.rename_note("C/Start.md", "Index").unwrap();
    assert_eq!(
        read(&d, "C/Note.md"),
        "[[A/Index]] [[A/Index#h|x]] [[A/Index.md]] ![[A/Index]]\n"
    );
    // From C/Deep and the root, A/Index (depth 1, alphabetical) still wins.
    assert_eq!(read(&d, "C/Deep/n.md"), "[[Index]]\n");
    assert_eq!(read(&d, "top.md"), "[[Index]]\n");
    assert_meaning_kept(&meant, &s, &pairs(&[("C/Start.md", "C/Index.md")]));
    assert_graph_agrees(&s);

    // An Index moved into C/Deep, which had none.
    let meant = meanings(&s);
    s.move_note("Z/Index.md", "C/Deep").unwrap();
    assert_eq!(read(&d, "C/Deep/n.md"), "[[A/Index]]\n");
    assert_eq!(read(&d, "top.md"), "[[Index]]\n");
    assert_meaning_kept(&meant, &s, &pairs(&[("Z/Index.md", "C/Deep/Index.md")]));
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn an_index_arriving_beside_a_link_to_the_root_index_keeps_it_on_the_root() {
    // The bare link in C names the root Index.md; once C has its own Index the only
    // way to keep naming the root note is a root-anchored `[[/Index]]`.
    let (d, s) = vault(
        "hijack-root",
        &[
            ("Index.md", "# Root\n"),
            ("B/Index.md", "# B\n"),
            ("C/Note.md", "[[Index]] [[Index#h|x]] [[Index.md]]\n"),
            ("top.md", "[[Index]]\n"),
        ],
    );
    let meant = meanings(&s);
    s.move_note("B/Index.md", "C").unwrap();
    assert_eq!(
        read(&d, "C/Note.md"),
        "[[/Index]] [[/Index#h|x]] [[/Index.md]]\n"
    );
    assert_eq!(read(&d, "top.md"), "[[Index]]\n");
    assert_meaning_kept(&meant, &s, &pairs(&[("B/Index.md", "C/Index.md")]));
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn a_root_anchored_link_names_the_root_note_first() {
    let (d, s) = vault(
        "root-anchor",
        &[
            ("Index.md", "# Root\n"),
            ("C/Index.md", "# C\n"),
            ("C/Note.md", "[[/Index]]\n"),
            ("D/Plan.md", "# plan\n"),
            ("C/Plan.md", "# c plan\n"),
            ("C/p.md", "[[/Plan]]\n"),
        ],
    );
    assert_eq!(
        s.resolve_wikilink_from("/Index", "C").as_deref(),
        Some("Index.md")
    );
    assert_eq!(
        s.resolve_wikilink_from("Index", "C").as_deref(),
        Some("C/Index.md")
    );
    // No root note of that name: like a bare link written in the root, so D's
    // own Plan does not win.
    assert_eq!(
        s.resolve_wikilink_from("/Plan", "D").as_deref(),
        Some("C/Plan.md")
    );
    assert_eq!(
        s.resolve_wikilink_from("Plan", "D").as_deref(),
        Some("D/Plan.md")
    );
    assert_eq!(
        s.resolve_wikilink_from("/C/Index", "").as_deref(),
        Some("C/Index.md")
    );
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn renaming_another_note_to_a_taken_name_does_not_capture_bare_links() {
    let (d, s) = vault(
        "capture",
        &[
            ("Y/Plan.md", "# Y plan\n"),
            ("Z/Other.md", "# other\n"),
            ("Z/a.md", "[[Plan]] [[Plan#Goals|g]] [[Other]]\n"),
            ("Z/Sub/b.md", "[[Plan]]\n"),
            ("Y/y.md", "[[Plan]] [[Other]]\n"),
            ("top.md", "[[Plan]] [[Other]]\n"),
            ("Other.md", "# root other\n"),
            ("W/w.md", "[[Plan]]\n"),
        ],
    );
    // Z/Other.md becomes Z/Plan.md: Z's own `[[Plan]]` would now name it.
    let before = snapshot(&d);
    let meant = meanings(&s);
    s.rename_note("Z/Other.md", "Plan").unwrap();
    let moved = pairs(&[("Z/Other.md", "Z/Plan.md")]);
    assert_eq!(
        read(&d, "Z/a.md"),
        "[[Y/Plan]] [[Y/Plan#Goals|g]] [[Plan]]\n"
    );
    // Y/Plan still wins alphabetically from the root, W and Z/Sub.
    assert_eq!(changed(&before, &d, &moved), set(&["Z/a.md"]));
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);

    // The root Other.md becomes Plan.md: a root note wins every bare `[[Plan]]`
    // outside Y and Z, so all of those must now name Y/Plan by path.
    let before = snapshot(&d);
    let meant = meanings(&s);
    s.rename_note("Other.md", "Plan").unwrap();
    let moved = pairs(&[("Other.md", "Plan.md")]);
    assert_eq!(read(&d, "top.md"), "[[Y/Plan]] [[Plan]]\n");
    assert_eq!(read(&d, "W/w.md"), "[[Y/Plan]]\n");
    assert_eq!(read(&d, "Z/Sub/b.md"), "[[Y/Plan]]\n");
    assert_eq!(read(&d, "Y/y.md"), "[[Plan]] [[/Plan]]\n");
    assert_eq!(
        changed(&before, &d, &moved),
        set(&["top.md", "W/w.md", "Z/Sub/b.md", "Y/y.md"])
    );
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn a_note_moved_beside_another_index_keeps_its_targets() {
    let (d, s) = index_vault("move-linker");
    // A/a.md meant A/Index; in B its bare links would mean B/Index.
    let meant = meanings(&s);
    let (_, n) = s.move_note("A/a.md", "B").unwrap();
    assert_eq!(n, 1);
    assert_eq!(
        read(&d, "B/a.md"),
        with(&links(), &[(L1, &bare("A/Index"))])
    );
    assert_eq!(read(&d, "B/b.md"), links());
    assert_meaning_kept(&meant, &s, &pairs(&[("A/a.md", "B/a.md")]));
    assert_graph_agrees(&s);

    // D/d.md meant the root Index; in C it needs the root-anchored form.
    let meant = meanings(&s);
    let (_, n) = s.move_note("D/d.md", "C").unwrap();
    assert_eq!(n, 1);
    assert_eq!(read(&d, "C/d.md"), with(&links(), &[(L1, &bare("/Index"))]));
    assert_meaning_kept(&meant, &s, &pairs(&[("D/d.md", "C/d.md")]));
    assert_graph_agrees(&s);

    // top.md into a folder without an Index: the root one still wins, no change.
    let (_, n) = s.move_note("top.md", "Empty").unwrap();
    assert_eq!(n, 0);
    assert_eq!(read(&d, "Empty/top.md"), links());

    // Moving it back changes nothing: a path link still names the same note
    // (rewritten links are never shortened again).
    let (_, n) = s.move_note("B/a.md", "A").unwrap();
    assert_eq!(n, 0);
    assert_eq!(
        read(&d, "A/a.md"),
        with(&links(), &[(L1, &bare("A/Index"))])
    );
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

/// 32 folders `F00`..`F31`, each with its own `Index.md` and a note linking to it
/// bare and by path, a hub linking every Index by path and a root note with a
/// bare `[[Index]]` (no root Index: it means F00/Index.md).
fn many_index_vault(tag: &str) -> (PathBuf, MemoryStore) {
    let mut files: Vec<(String, String)> = Vec::new();
    let mut hub = String::new();
    for i in 0..32 {
        let f = format!("F{i:02}");
        files.push((format!("{f}/Index.md"), format!("# {f}\n")));
        files.push((
            format!("{f}/note.md"),
            format!("[[Index]] [[{f}/Index#h]]\n"),
        ));
        hub.push_str(&format!("[[{f}/Index]] "));
    }
    files.push(("hub.md".into(), format!("{hub}\n")));
    files.push(("stay.md".into(), "[[Index]]\n".into()));
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();
    vault(tag, &refs)
}

#[test]
fn folder_operations_among_many_same_named_indexes_touch_only_their_own_links() {
    let (d, s) = many_index_vault("many");
    assert_graph_agrees(&s);
    let hub = |d: &Path| read(d, "hub.md");

    // Rename F05: its note keeps the bare link, the path links follow.
    let before = snapshot(&d);
    let meant = meanings(&s);
    let v = s.rename_folder_impl("F05", "G05").unwrap();
    let moved = prefix("F05", "G05");
    assert_eq!(read(&d, "G05/note.md"), "[[Index]] [[G05/Index#h]]\n");
    assert!(hub(&d).contains("[[G05/Index]]") && !hub(&d).contains("F05"));
    assert_eq!(
        changed(&before, &d, &moved),
        set(&["G05/note.md", "hub.md"])
    );
    assert_eq!(v["links_updated"], 2, "{v}");
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);

    // Rename F00, the Index the root's bare link falls back to.
    let before = snapshot(&d);
    let meant = meanings(&s);
    let v = s.rename_folder_impl("F00", "Z00").unwrap();
    let moved = prefix("F00", "Z00");
    assert_eq!(read(&d, "stay.md"), "[[Z00/Index]]\n");
    assert_eq!(
        changed(&before, &d, &moved),
        set(&["Z00/note.md", "hub.md", "stay.md"])
    );
    assert_eq!(v["links_updated"], 3, "{v}");
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);

    // Move F07 into F08, which has its own Index and note. `[[F07/Index]]` still
    // names F08/F07/Index.md (a path suffix), so no text changes at all.
    let before = snapshot(&d);
    let meant = meanings(&s);
    let v = s.move_folder_impl("F07", "F08").unwrap();
    let moved = prefix("F07", "F08/F07");
    assert_eq!(read(&d, "F08/F07/note.md"), "[[Index]] [[F07/Index#h]]\n");
    assert_eq!(read(&d, "F08/note.md"), "[[Index]] [[F08/Index#h]]\n");
    assert!(changed(&before, &d, &moved).is_empty());
    assert_eq!(v["links_updated"], 0, "{v}");
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);

    // Move F09's contents into F10: both names clash and get `-1`.
    let before = snapshot(&d);
    let meant = meanings(&s);
    let v = s.move_folder_contents_impl("F09", "F10").unwrap();
    let moved = pairs(&[
        ("F09/Index.md", "F10/Index-1.md"),
        ("F09/note.md", "F10/note-1.md"),
    ]);
    assert_eq!(read(&d, "F10/note-1.md"), "[[Index-1]] [[F10/Index-1#h]]\n");
    assert_eq!(read(&d, "F10/note.md"), "[[Index]] [[F10/Index#h]]\n");
    assert!(hub(&d).contains("[[F10/Index-1]]"), "{v}");
    assert_eq!(
        changed(&before, &d, &moved),
        set(&["F10/note-1.md", "hub.md"])
    );
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);

    // Delete F11: its Index becomes the root Index.md, which would capture every
    // bare `[[Index]]` in the root; `late.md` meant F01/Index.md.
    fs::write(d.join("late.md"), "[[Index]] [[index#h]]\n").unwrap();
    let before = snapshot(&d);
    let meant = meanings(&s);
    let v = s.delete_folder_impl("F11").unwrap();
    let moved = pairs(&[("F11/Index.md", "Index.md"), ("F11/note.md", "note.md")]);
    assert_eq!(read(&d, "late.md"), "[[F01/Index]] [[F01/Index#h]]\n");
    assert_eq!(read(&d, "note.md"), "[[Index]] [[Index#h]]\n");
    assert!(hub(&d).contains(" [[Index]] "), "{v}");
    assert_eq!(
        changed(&before, &d, &moved),
        set(&["late.md", "note.md", "hub.md"])
    );
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);

    // Delete F12 too: its notes clash in the root and get `-1`.
    let before = snapshot(&d);
    let meant = meanings(&s);
    s.delete_folder_impl("F12").unwrap();
    let moved = pairs(&[("F12/Index.md", "Index-1.md"), ("F12/note.md", "note-1.md")]);
    assert_eq!(read(&d, "note-1.md"), "[[Index-1]] [[Index-1#h]]\n");
    assert_eq!(read(&d, "F10/note-1.md"), "[[Index-1]] [[F10/Index-1#h]]\n");
    assert_eq!(changed(&before, &d, &moved), set(&["note-1.md", "hub.md"]));
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);

    // Delete F13 into F14 (both have an Index).
    let before = snapshot(&d);
    let meant = meanings(&s);
    s.delete_folder_with("F13", Some("F14"), None).unwrap();
    let moved = pairs(&[
        ("F13/Index.md", "F14/Index-1.md"),
        ("F13/note.md", "F14/note-1.md"),
    ]);
    assert_eq!(read(&d, "F14/note-1.md"), "[[Index-1]] [[F14/Index-1#h]]\n");
    assert_eq!(
        changed(&before, &d, &moved),
        set(&["F14/note-1.md", "hub.md"])
    );
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);

    let indexes = s
        .graph()
        .nodes
        .iter()
        .filter(|n| n.id.to_lowercase().starts_with("index"))
        .count();
    assert_eq!(indexes, 32);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn nested_folder_moves_keep_links_between_same_named_indexes() {
    let (d, s) = vault(
        "nested",
        &[
            ("Index.md", "# root\n"),
            ("P/Index.md", "# P\n[[Index]] [[Q/Index]] [[/Index]]\n"),
            ("P/Q/Index.md", "# Q\n[[Index]] [[P/Index]]\n"),
            ("P/Q/n.md", "[[Index]] [[P/Index]] [[Q/Index]]\n"),
            ("R/Q/Index.md", "# other Q\n"),
            ("x.md", "[[Q/Index]] [[P/Q/Index]] [[Index]]\n"),
        ],
    );
    // `[[Q/Index]]` from P and x.md: P/Q/Index (suffix match, then alphabetical).
    let meant = meanings(&s);
    assert_eq!(meant["x.md"][0].as_deref(), Some("P/Q/Index.md"));
    // Move P/Q out to the root: `Q/Index` now matches the path exactly.
    s.move_folder_impl("P/Q", "").unwrap();
    let moved = prefix("P/Q", "Q");
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);
    assert_eq!(read(&d, "x.md"), "[[Q/Index]] [[Q/Index]] [[Index]]\n");
    // Rename it next to R/Q's Index: R/Q/Index.md is now the only `Q/Index` suffix
    // match, so links to the moved one must name its full path.
    let meant = meanings(&s);
    s.rename_folder_impl("Q", "Q2").unwrap();
    assert_meaning_kept(&meant, &s, &prefix("Q", "Q2"));
    assert_graph_agrees(&s);
    assert_eq!(read(&d, "x.md"), "[[Q2/Index]] [[Q2/Index]] [[Index]]\n");
    fs::remove_dir_all(&d).ok();
}

#[test]
fn case_twins_are_refused_and_case_never_splits_a_link() {
    let (d, s) = vault(
        "case",
        &[
            ("A/INDEX.md", "# A\n"),
            ("B/Index.md", "# B\n"),
            (
                "A/a.md",
                "[[index]] [[Index]] [[INDEX#h]] [[a/index]] [[/A/INDEX.md]]\n",
            ),
            ("top.md", "[[A/index]] [[b/INDEX]]\n"),
        ],
    );
    let before = snapshot(&d);
    let e = s.move_note("B/Index.md", "A").unwrap_err().0;
    assert!(e.contains("already exists"), "{e}");
    assert!(changed(&before, &d, &identity).is_empty());

    let meant = meanings(&s);
    let (_, n) = s.rename_note("A/INDEX.md", "Home").unwrap();
    assert_eq!(n, 2);
    assert_eq!(
        read(&d, "A/a.md"),
        "[[Home]] [[Home]] [[Home#h]] [[A/Home]] [[A/Home.md]]\n"
    );
    assert_eq!(read(&d, "top.md"), "[[A/Home]] [[b/INDEX]]\n");
    assert_meaning_kept(&meant, &s, &pairs(&[("A/INDEX.md", "A/Home.md")]));
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn deleting_a_folder_never_makes_a_case_twin_of_a_root_note() {
    let (d, s) = vault(
        "case-delete",
        &[
            ("INDEX.md", "# root\n"),
            ("A/Index.md", "# A\n"),
            ("A/a.md", "[[Index]]\n"),
            ("top.md", "[[Index]]\n"),
        ],
    );
    let meant = meanings(&s);
    s.delete_folder_impl("A").unwrap();
    assert!(d.join("Index-1.md").is_file(), "{:?}", snapshot(&d).keys());
    assert!(!d.join("Index.md").is_file() || cfg!(not(target_os = "linux")));
    let moved = pairs(&[("A/Index.md", "Index-1.md"), ("A/a.md", "a.md")]);
    assert_eq!(read(&d, "a.md"), "[[Index-1]]\n");
    assert_eq!(read(&d, "top.md"), "[[Index]]\n");
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn moving_folder_contents_never_makes_a_case_twin() {
    let (d, s) = vault(
        "case-contents",
        &[
            ("Dest/INDEX.md", "# dest\n"),
            ("A/Index.md", "# A\n"),
            ("A/a.md", "[[Index]]\n"),
            ("Dest/d.md", "[[Index]]\n"),
        ],
    );
    let meant = meanings(&s);
    s.move_folder_contents_impl("A", "Dest").unwrap();
    assert!(
        d.join("Dest/Index-1.md").is_file(),
        "{:?}",
        snapshot(&d).keys()
    );
    let moved = pairs(&[("A/Index.md", "Dest/Index-1.md"), ("A/a.md", "Dest/a.md")]);
    assert_eq!(read(&d, "Dest/a.md"), "[[Index-1]]\n");
    assert_eq!(read(&d, "Dest/d.md"), "[[Index]]\n");
    assert_meaning_kept(&meant, &s, &moved);
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn links_in_any_code_block_are_never_rewritten() {
    let code = "~~~\n[[Index]]\n~~~\n\
                ````md\n```\n[[Index]]\n```\n````\n\
                ```\nlet s = `x; [[Index]]\n```\n\
                - item\n  ```\n  [[Index]]\n  ```\n\
                ``[[Index]] ` still code``\n\
                {{ [[Index]] }}\n";
    let (d, s) = vault(
        "code",
        &[
            ("A/Index.md", "# A\n"),
            ("B/Index.md", "# B\n"),
            ("A/f.md", &format!("{code}[[Index]]\n")),
        ],
    );
    s.rename_note("A/Index.md", "Home").unwrap();
    assert_eq!(read(&d, "A/f.md"), format!("{code}[[Home]]\n"));
    // Only the one real link counts, in the graph too.
    assert_eq!(meanings(&s)["A/f.md"], vec![Some("A/Home.md".to_string())]);
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
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
fn hidden_notes_keep_their_index_links_too() {
    let (d, s) = vault(
        "private",
        &[
            ("A/Index.md", "# A\n"),
            ("B/Index.md", "# B\n"),
            ("Private/Index.md", "# secret index\n"),
            ("Private/p.md", "[[Index]] [[A/Index]]\n"),
            ("Private/Deep/q.md", "[[Index]]\n"),
            ("open.md", "[[Index]] [[A/Index]]\n"),
        ],
    );
    // As the owner: open.md's bare link means A/Index (B and Private sort later).
    let meant = meanings(&s);
    let m = std::sync::Mutex::new(s);
    let s = crate::privacy::lock_as(&m, Some(std::sync::Arc::new(HidePrivate)));
    let (_, n) = s.rename_note("A/Index.md", "Home").unwrap();
    assert_eq!(n, 1, "only the visible note is counted");
    assert_eq!(read(&d, "open.md"), "[[Home]] [[A/Home]]\n");
    // Private/p.md's bare link means its own Index and stays.
    assert_eq!(read(&d, "Private/p.md"), "[[Index]] [[A/Home]]\n");
    // Private/Deep/q.md meant Private/Index.md? No: A/Index.md (depth 1, A first).
    assert_eq!(read(&d, "Private/Deep/q.md"), "[[Home]]\n");
    drop(s);
    let s = m.into_inner().unwrap();
    assert_meaning_kept(&meant, &s, &pairs(&[("A/Index.md", "A/Home.md")]));
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}

/// Creating a note beside same-named ones never captures a bare link: links that
/// named another note keep naming it (create_impl and create_folder's Index.md).
#[test]
fn creating_an_index_keeps_bare_links_on_the_note_they_named() {
    let (d, s) = vault(
        "create",
        &[
            ("Index.md", "# root\n"),
            ("C/Note.md", "[[Index]] [[Index#h|x]]\n"),
            ("Deep/Er/Index.md", "# deep\n"),
            ("Deep/Er/own.md", "[[Index]]\n"),
        ],
    );
    assert_eq!(
        meanings(&s)["C/Note.md"],
        vec![Some("Index.md".to_string()), Some("Index.md".to_string())]
    );
    s.create_impl("Index", "C", Some("# C [[Index]]\n"))
        .unwrap();
    // The root note is shadowed in C: the link is anchored at the root.
    assert_eq!(read(&d, "C/Note.md"), "[[/Index]] [[/Index#h|x]]\n");
    assert_eq!(
        meanings(&s)["C/Note.md"],
        vec![Some("Index.md".to_string()), Some("Index.md".to_string())]
    );
    // The new note and notes whose links still land where they did are untouched.
    assert_eq!(read(&d, "C/Index.md"), "# C [[Index]]\n");
    assert_eq!(read(&d, "Deep/Er/own.md"), "[[Index]]\n");
    assert_graph_agrees(&s);

    // create_folder writes an Index.md: a shallower one would win bare links that
    // fell back to another Index (here from Solo, which has none).
    fs::create_dir_all(d.join("Solo")).unwrap();
    fs::write(d.join("Solo/y.md"), "[[Index]]\n").unwrap();
    fs::remove_file(d.join("Index.md")).unwrap();
    fs::write(d.join("C/Note.md"), "[[Index]]\n").unwrap();
    assert_eq!(
        meanings(&s)["Solo/y.md"],
        vec![Some("C/Index.md".to_string())]
    );
    s.create_folder("B").unwrap();
    assert_eq!(read(&d, "Solo/y.md"), "[[C/Index]]\n");
    assert_eq!(
        meanings(&s)["Solo/y.md"],
        vec![Some("C/Index.md".to_string())]
    );
    assert_eq!(read(&d, "C/Note.md"), "[[Index]]\n");
    assert_graph_agrees(&s);

    // A name nobody else has rewrites nothing.
    let before = read(&d, "Solo/y.md");
    s.create_impl("Fresh", "Solo", None).unwrap();
    assert_eq!(read(&d, "Solo/y.md"), before);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn a_rewrite_that_keeps_the_size_is_seen_by_the_graph_at_once() {
    // `A/Index` -> `A/Abcde` keeps every rewritten note's size; the graph cache
    // must not keep the old links when the write lands in the same mtime tick.
    for i in 0..20 {
        let (d, s) = vault(
            &format!("same-size-{i}"),
            &[
                ("A/Index.md", "# A\n"),
                ("B/Index.md", "# B\n"),
                ("x.md", "[[A/Index]]\n"),
            ],
        );
        assert_graph_agrees(&s);
        s.rename_note("A/Index.md", "Abcde").unwrap();
        assert_eq!(read(&d, "x.md"), "[[A/Abcde]]\n");
        assert_graph_agrees(&s);
        fs::remove_dir_all(&d).ok();
    }
}

#[test]
fn a_folder_never_gets_a_case_twin_and_a_case_only_rename_keeps_links() {
    let (d, s) = vault(
        "case-folder",
        &[
            ("A/Index.md", "# A\n"),
            ("B/Index.md", "# B\n"),
            ("x.md", "[[A/Index]] [[B/Index]] [[a/index#h]]\n"),
            ("Sub/a/n.md", "[[Index]]\n"),
        ],
    );
    // `a` beside `A` would make `[[a/Index]]` and `[[A/Index]]` the same link.
    let before = snapshot(&d);
    let e = s.rename_folder_impl("B", "a").unwrap_err().0;
    assert!(e.contains("already exists"), "{e}");
    let e = s.move_folder_impl("Sub/a", "").unwrap_err().0;
    assert!(e.contains("already exists"), "{e}");
    assert!(changed(&before, &d, &identity).is_empty());
    // Renaming A itself to `a` is fine. Path links match without case and stay;
    // but the alphabetical tie-break between folders sorts `B` before `a`, so the
    // bare `[[Index]]` in Sub/a (it meant A/Index.md) must now name its path.
    let meant = meanings(&s);
    let v = s.rename_folder_impl("A", "a").unwrap();
    assert_eq!(v["links_updated"], 1, "{v}");
    assert_eq!(read(&d, "Sub/a/n.md"), "[[a/Index]]\n");
    assert_eq!(
        changed(&before, &d, &prefix("A", "a")),
        set(&["Sub/a/n.md"])
    );
    assert_meaning_kept(&meant, &s, &prefix("A", "a"));
    assert_graph_agrees(&s);
    fs::remove_dir_all(&d).ok();
}
