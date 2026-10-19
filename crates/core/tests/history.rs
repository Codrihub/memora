//! Versioning (git history, snapshots), the trash and the bulk tools.

use memora_core::vault::CommitAuthor;
use memora_core::MemoryStore;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn vault(tag: &str, git: bool) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "memora-hist-{tag}-{}-{}",
        std::process::id(),
        std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos()
    ));
    fs::create_dir_all(d.join("Notes/Sub")).unwrap();
    fs::write(d.join("Notes/a.md"), "abc").unwrap();
    fs::write(d.join("Notes/Sub/b.md"), "abc").unwrap();
    fs::write(d.join("top.md"), "abc").unwrap();
    if git {
        let ok = Command::new("git")
            .args(["init", "-q"])
            .current_dir(&d)
            .status()
            .unwrap()
            .success();
        assert!(ok);
    }
    d
}

fn errmsg<T: std::fmt::Debug>(r: memora_core::vault::MResult<T>) -> String {
    r.unwrap_err().0
}

#[test]
fn bulk_replace_refuses_empty_and_empty_matching_finds() {
    let d = vault("br-empty", false);
    let s = MemoryStore::new(&d);
    assert!(errmsg(s.bulk_replace_impl("", "Z", None, false, false)).contains("find is required"));
    for pat in ["", "x*", "(?:)", "^"] {
        assert!(
            s.bulk_replace_impl(pat, "Z", None, true, false).is_err(),
            "{pat}"
        );
    }
    // Matches nothing in "" but between characters elsewhere.
    assert!(errmsg(s.bulk_replace_impl(r"\b", "Z", None, true, false)).contains("empty string"));
    assert!(errmsg(s.bulk_replace_impl("(", "Z", None, true, false))
        .starts_with("find is not a valid regex:"));
    assert_eq!(fs::read_to_string(d.join("Notes/a.md")).unwrap(), "abc");
    fs::remove_dir_all(&d).ok();
}

#[test]
fn bulk_replace_checks_group_references() {
    let d = vault("br-groups", false);
    let s = MemoryStore::new(&d);
    for bad in ["$5", "$name", "${x}", "$1x"] {
        let e = errmsg(s.bulk_replace_impl("(a)(b)", bad, None, true, true));
        assert!(e.contains("does not define"), "{bad}: {e}");
    }
    s.bulk_replace_impl(
        "(?P<first>a)(b)",
        "${first}$2$$${1}x",
        Some("Notes/Sub"),
        true,
        false,
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(d.join("Notes/Sub/b.md")).unwrap(),
        "ab$axc"
    );
    assert_eq!(fs::read_to_string(d.join("Notes/a.md")).unwrap(), "abc");
    fs::remove_dir_all(&d).ok();
}

#[test]
fn bulk_folder_filters_include_subfolders() {
    let d = vault("br-folder", false);
    let s = MemoryStore::new(&d);
    let r = s
        .bulk_replace_impl("b", "B", Some("Notes"), false, true)
        .unwrap();
    assert_eq!(r["changed"], json!(["Notes/Sub/b.md", "Notes/a.md"]));
    let r = s
        .bulk_replace_impl("b", "B", Some("Notes/Sub/"), false, true)
        .unwrap();
    assert_eq!(r["changed"], json!(["Notes/Sub/b.md"]));
    let r = s
        .bulk_replace_impl("b", "B", Some("Root"), false, true)
        .unwrap();
    assert_eq!(r["changed"], json!(["top.md"]));
    assert!(
        errmsg(s.bulk_replace_impl("b", "B", Some("Nope"), false, true))
            .contains("folder not found: Nope")
    );
    assert!(errmsg(s.bulk_delete_impl(None, Some("Notes/Nope"))).contains("folder not found"));
    let r = s.bulk_delete_impl(None, Some("Notes/Sub")).unwrap();
    assert_eq!(r["deleted"], json!(["Notes/Sub/b.md"]));
    fs::remove_dir_all(&d).ok();
}

#[test]
fn bulk_delete_moves_to_trash_and_is_all_or_nothing() {
    let d = vault("bd", false);
    let s = MemoryStore::new(&d);
    assert!(errmsg(s.bulk_delete_impl(None, None)).contains("give `paths`"));
    assert!(errmsg(s.bulk_delete_impl(Some(&[]), None)).contains("give `paths`"));
    assert!(
        errmsg(s.bulk_delete_impl(Some(&[json!(3)]), None)).contains("paths[0] must be a string")
    );
    let e = errmsg(s.bulk_delete_impl(
        Some(&[
            json!("Notes/a.md"),
            json!("gone.md"),
            json!("../x.md"),
            json!("Notes"),
        ]),
        None,
    ));
    assert!(e.contains("nothing was deleted"), "{e}");
    assert!(
        e.contains("gone.md (not found)") && e.contains("../x.md (outside the vault)"),
        "{e}"
    );
    assert!(e.contains("Notes (a folder"), "{e}");
    assert!(d.join("Notes/a.md").is_file());
    let r = s
        .bulk_delete_impl(Some(&[json!("Notes/a"), json!("top.md")]), None)
        .unwrap();
    assert_eq!(r["count"], 2);
    assert_eq!(
        r["trashed"][0],
        json!({"path": "Notes/a.md", "to": ".Trash/a.md"})
    );
    assert!(d.join(".Trash/a.md").is_file() && !d.join("Notes/a.md").exists());
    // Back to where it was.
    let r = s.restore_trash_impl("a", "").unwrap();
    assert_eq!(r["restored"], "Notes/a.md");
    fs::remove_dir_all(&d).ok();
}

#[test]
fn versioning_without_git_says_how_to_turn_it_on() {
    let d = vault("nogit", false);
    let s = MemoryStore::new(&d);
    let off = "version history is off";
    assert!(errmsg(s.get_history_impl("Notes/a.md", 20)).contains(off));
    assert!(errmsg(s.get_note_at_impl("Notes/a.md", "HEAD")).contains(off));
    assert!(errmsg(s.restore_impl("Notes/a.md", "HEAD")).contains(off));
    assert!(errmsg(s.diff_impl("Notes/a.md", "HEAD", "")).contains(off));
    assert!(errmsg(s.snapshot_impl("x")).contains(off));
    fs::remove_dir_all(&d).ok();
}

#[test]
fn history_revisions_are_checked() {
    let d = vault("revs", true);
    let s = MemoryStore::new(&d);
    {
        let _a = CommitAuthor::set("agent-7");
        s.save_impl("Notes/a.md", "v1").unwrap();
    }
    let h = s.get_history_impl("Notes/a", 20).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!(h[0]["author"], "agent-7");
    assert!(errmsg(s.get_history_impl("Notes/a.md", 0)).contains("at least 1"));
    assert!(errmsg(s.get_history_impl("", 5)).contains("path is required"));
    assert!(errmsg(s.get_history_impl("Notes/none.md", 5)).contains("not found"));
    for bad in ["deadbeef", "nope"] {
        assert!(errmsg(s.diff_impl("Notes/a.md", bad, "")).contains("unknown revision"));
        assert!(errmsg(s.get_note_at_impl("Notes/a.md", bad)).contains("use get_history"));
    }
    assert!(errmsg(s.diff_impl("Notes/a.md", "HEAD~1..HEAD", "")).contains("not a range"));
    assert!(errmsg(s.diff_impl("Notes/none.md", "HEAD", "")).contains("not found"));
    assert!(errmsg(s.get_note_at_impl("Notes/a.md", "")).contains("rev is required"));
    assert!(errmsg(s.restore_impl("Notes/a.md", " ")).contains("rev is required"));
    assert!(errmsg(s.get_note_at_impl("Notes/a.md", "HEAD@{1990-01-01}")).contains("at or before"));
    let r = s.diff_impl("Notes/a.md", "HEAD", "").unwrap();
    assert_eq!(r["changed"], false);
    fs::write(d.join("Notes/a.md"), "v2").unwrap();
    assert_eq!(
        s.diff_impl("Notes/a.md", "HEAD", "").unwrap()["changed"],
        true
    );
    fs::remove_dir_all(&d).ok();
}

#[test]
fn history_follows_renames() {
    let d = vault("rename", true);
    let s = MemoryStore::new(&d);
    s.create_impl("Ren", "QA", Some("one")).unwrap();
    let old = s.get_history_impl("QA/Ren.md", 1).unwrap()[0]["rev"]
        .as_str()
        .unwrap()
        .to_string();
    s.rename_impl("QA/Ren.md", "Ren2").unwrap();
    s.save_impl("QA/Ren2.md", "two").unwrap();
    let h = s.get_history_impl("QA/Ren2.md", 20).unwrap();
    assert_eq!(h.len(), 3, "{h:?}");
    assert_eq!(h[2]["path"], "QA/Ren.md");
    assert_eq!(s.get_note_at_impl("QA/Ren2.md", &old).unwrap(), "one");
    let e = errmsg(s.restore_impl("QA/Ren.md", &old));
    assert!(e.contains("renamed to QA/Ren2.md"), "{e}");
    assert!(!d.join("QA/Ren.md").exists());
    s.restore_impl("QA/Ren2.md", &old).unwrap();
    assert_eq!(fs::read_to_string(d.join("QA/Ren2.md")).unwrap(), "one");
    fs::remove_dir_all(&d).ok();
}

#[test]
fn snapshots_are_checked_tags() {
    let d = vault("snap", true);
    let s = MemoryStore::new(&d);
    let r = s.snapshot_impl("before cleanup").unwrap();
    assert_eq!(r["tag"], "snap-before-cleanup");
    assert!(errmsg(s.snapshot_impl("before-cleanup")).contains("already exists"));
    for bad in ["../../evil", "x.lock", "a..b", "a:b"] {
        assert!(s.snapshot_impl(bad).is_err(), "{bad}");
    }
    let long = "x".repeat(41);
    assert!(errmsg(s.snapshot_impl(&long)).contains("too long"));
    s.snapshot_impl(&"x".repeat(40)).unwrap();
    s.save_impl("top.md", "changed").unwrap();
    assert_eq!(
        s.get_note_at_impl("top.md", "snap-before-cleanup").unwrap(),
        "abc"
    );
    fs::remove_dir_all(&d).ok();
}

#[test]
fn trash_remembers_where_notes_came_from() {
    let d = vault("trash", true);
    let s = MemoryStore::new(&d);
    fs::write(d.join("Dup.md"), "root dup").unwrap();
    fs::create_dir_all(d.join("Notes")).unwrap();
    fs::write(d.join("Notes/Dup.md"), "notes dup").unwrap();
    s.soft_delete_impl("Dup.md").unwrap();
    let r = s.soft_delete_impl("Notes/Dup.md").unwrap();
    assert_eq!(r["to"], ".Trash/Dup-1.md");
    let (_, log) = s.git(&["log", "-1", "--format=%s"]);
    assert!(log.starts_with("trash: Notes/Dup.md"), "{log}");
    assert!(errmsg(s.soft_delete_impl(".Trash/Dup.md")).contains("already in the trash"));
    let t: Vec<Value> = s.list_trash_impl();
    assert_eq!(t.len(), 2);
    let one = t.iter().find(|e| e["name"] == "Dup-1.md").unwrap();
    assert_eq!(one["original"], "Notes/Dup.md");
    assert!(one["deleted"].is_string());
    assert!(errmsg(s.restore_trash_impl(".Trash/../Readme.md", "")).contains("list_trash"));
    assert!(errmsg(s.restore_trash_impl("nope", "")).contains("not in trash"));
    let r = s.restore_trash_impl("Dup-1", "").unwrap();
    assert_eq!(r["restored"], "Notes/Dup.md");
    assert_eq!(
        fs::read_to_string(d.join("Notes/Dup.md")).unwrap(),
        "notes dup"
    );
    // The original path is taken now: `into` is the way out.
    fs::write(d.join("Dup.md"), "new").unwrap();
    assert!(errmsg(s.restore_trash_impl("Dup.md", "")).contains("pass `into`"));
    let r = s.restore_trash_impl("Dup.md", "Notes/Sub").unwrap();
    assert_eq!(r["restored"], "Notes/Sub/Dup.md");
    assert!(s.list_trash_impl().is_empty());
    fs::remove_dir_all(&d).ok();
}
