//! Delete forever erases a note from the vault's git history: no commit, tree,
//! blob, tag or commit message keeps its text or any name it had, while every other
//! note keeps all of its versions.

use memora_core::MemoryStore;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn vault(tag: &str, git: bool) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "memora-purge-{tag}-{}-{}",
        std::process::id(),
        std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos()
    ));
    fs::create_dir_all(d.join("Notes")).unwrap();
    fs::write(d.join("Notes/keep.md"), "keep v1").unwrap();
    if git {
        assert!(Command::new("git")
            .args(["init", "-q"])
            .current_dir(&d)
            .status()
            .unwrap()
            .success());
    }
    d
}

fn git(d: &Path, args: &[&str]) -> (bool, String) {
    let o = Command::new("git")
        .args(["-c", "core.quotePath=false"])
        .args(args)
        .current_dir(d)
        .output()
        .unwrap();
    (
        o.status.success(),
        String::from_utf8_lossy(&o.stdout).to_string(),
    )
}

/// Everything the repository can show: every commit with its message and patch,
/// every object with its path, and every tag.
fn everything(d: &Path) -> String {
    let (_, log) = git(d, &["log", "--all", "-p", "--format=%H %an%n%B"]);
    let (_, objects) = git(d, &["rev-list", "--all", "--objects"]);
    let (_, refs) = git(d, &["for-each-ref"]);
    format!("{log}\n{objects}\n{refs}")
}

fn assert_gone(d: &Path, needles: &[&str]) {
    let all = everything(d);
    for n in needles {
        assert!(!all.contains(n), "{n} is still in the history:\n{all}");
    }
    // Nothing kept aside: no backup refs, reflog or loose leftovers of the old history.
    let (_, refs) = git(d, &["for-each-ref", "--format=%(refname)"]);
    assert!(!refs.contains("memora-purge"), "{refs}");
    assert!(!refs.contains("refs/original"), "{refs}");
    assert_eq!(git(d, &["status", "--porcelain"]).1.trim(), "");
}

fn blob_at(d: &Path, rev_path: &str) -> String {
    git(d, &["rev-parse", rev_path]).1.trim().to_string()
}

fn versions(s: &MemoryStore, path: &str) -> Vec<Value> {
    s.get_history_impl(path, 100).unwrap()
}

#[test]
fn delete_forever_erases_every_version_and_keeps_other_notes() {
    let d = vault("one", true);
    let s = MemoryStore::new(&d);
    s.save_impl("Notes/keep.md", "keep v2").unwrap();
    s.create_impl("Plan", "Secret", Some("ZEBRA-ONE first draft"))
        .unwrap();
    s.save_impl("Secret/Plan.md", "ZEBRA-TWO second draft")
        .unwrap();
    s.save_impl("Notes/keep.md", "keep v3").unwrap();
    s.snapshot_impl("before-purge").unwrap();
    let old_blob = blob_at(&d, "HEAD:Secret/Plan.md");
    let keep_before = versions(&s, "Notes/keep.md");
    s.soft_delete_impl("Secret/Plan.md").unwrap();
    s.save_impl("Notes/keep.md", "keep v4").unwrap();

    let r = s.delete_trash_impl("Plan.md").unwrap();
    assert_eq!(r["history"]["erased"], true, "{r}");
    assert!(!d.join(".Trash/Plan.md").exists());
    assert_gone(
        &d,
        &["ZEBRA", "Secret/Plan.md", ".Trash/Plan.md", "Plan.md"],
    );
    assert!(
        !git(&d, &["cat-file", "-e", &old_blob]).0,
        "the old blob survived"
    );

    // The note has no history left, under any name.
    for p in ["Secret/Plan.md", ".Trash/Plan.md"] {
        let e = s.get_history_impl(p, 5).unwrap_err().0;
        assert!(e.contains("not found"), "{p}: {e}");
        assert!(s
            .restore_impl(p, "HEAD~1")
            .unwrap_err()
            .0
            .contains("not found"));
    }
    // The other note keeps every version, readable and restorable.
    let keep = versions(&s, "Notes/keep.md");
    assert_eq!(keep.len(), keep_before.len() + 1);
    assert_eq!(keep[0]["version"].as_u64(), Some(keep.len() as u64));
    let first = keep.last().unwrap()["rev"].as_str().unwrap().to_string();
    // (The first commit took the note at v2.)
    assert_eq!(
        s.get_note_at_impl("Notes/keep.md", &first).unwrap(),
        "keep v2"
    );
    s.restore_impl("Notes/keep.md", &first).unwrap();
    assert_eq!(versions(&s, "Notes/keep.md").len(), keep.len() + 1);
    assert_eq!(
        fs::read_to_string(d.join("Notes/keep.md")).unwrap(),
        "keep v2"
    );
    // The snapshot tag was rewritten with the rest and still works.
    assert_eq!(
        s.get_note_at_impl("Notes/keep.md", "snap-before-purge")
            .unwrap(),
        "keep v3"
    );
    fs::remove_dir_all(&d).ok();
}

#[test]
fn a_renamed_moved_then_trashed_note_is_gone_under_every_name() {
    let d = vault("renamed", true);
    let s = MemoryStore::new(&d);
    s.save_impl("Notes/keep.md", "keep v2").unwrap();
    let p = s
        .create_impl("old name", "Notes", Some("UNICORN-42 body"))
        .unwrap();
    let p = s.rename_impl(&p, "Ünïcode plan").unwrap();
    s.save_impl(&p, "UNICORN-43 body edited").unwrap();
    let p = s.move_impl(&p, "Archive").unwrap();
    let trashed = s.soft_delete_impl(&p).unwrap();
    let name = trashed["trashed"]
        .as_str()
        .or_else(|| trashed["to"].as_str())
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_string();
    s.delete_trash_impl(&name).unwrap();
    assert_gone(
        &d,
        &["UNICORN", "old name", "old_name", "Ünïcode", "nïcode"],
    );
    assert_eq!(versions(&s, "Notes/keep.md").len(), 1);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn empty_trash_erases_several_notes_in_one_rewrite() {
    let d = vault("empty", true);
    let s = MemoryStore::new(&d);
    s.save_impl("Notes/keep.md", "keep v2").unwrap();
    for (t, body) in [
        ("one", "ALPHA-1"),
        ("two", "BRAVO-2"),
        ("three", "CHARLIE-3"),
    ] {
        s.create_impl(t, "Drafts", Some(body)).unwrap();
        s.soft_delete_impl(&format!("Drafts/{t}.md")).unwrap();
    }
    let before = git(&d, &["rev-list", "--all", "--count"]).1;
    let r = s.empty_trash_impl().unwrap();
    assert_eq!(r["count"], 3, "{r}");
    // One rewrite for all of them: a single history report.
    assert_eq!(r["history"]["erased"], true, "{r}");
    assert_gone(
        &d,
        &[
            "ALPHA",
            "BRAVO",
            "CHARLIE",
            "Drafts/one",
            "Drafts/two",
            "Drafts/three",
        ],
    );
    // Commits that only touched the erased notes are gone too.
    let after = git(&d, &["rev-list", "--all", "--count"]).1;
    assert!(
        after.trim().parse::<u32>().unwrap() < before.trim().parse::<u32>().unwrap(),
        "{before} -> {after}"
    );
    assert_eq!(versions(&s, "Notes/keep.md").len(), 1);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn a_permanent_delete_erases_the_history_too() {
    let d = vault("permanent", true);
    let s = MemoryStore::new(&d);
    s.save_impl("Notes/keep.md", "keep v2").unwrap();
    s.create_impl("gone", "Notes", Some("DELTA-SECRET"))
        .unwrap();
    s.save_impl("Notes/gone.md", "DELTA-SECRET two").unwrap();
    s.delete_impl("Notes/gone.md").unwrap();
    assert_gone(&d, &["DELTA", "Notes/gone.md"]);
    assert_eq!(versions(&s, "Notes/keep.md").len(), 1);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn a_new_note_at_the_same_path_keeps_its_history() {
    let d = vault("reuse", true);
    let s = MemoryStore::new(&d);
    s.save_impl("Notes/keep.md", "keep v2").unwrap();
    s.create_impl("x", "Notes", Some("OLD-TEXT")).unwrap();
    s.soft_delete_impl("Notes/x.md").unwrap();
    s.create_impl("x", "Notes", Some("NEW-TEXT one")).unwrap();
    s.save_impl("Notes/x.md", "NEW-TEXT two").unwrap();
    s.delete_trash_impl("x.md").unwrap();
    assert_gone(&d, &["OLD-TEXT"]);
    let h = versions(&s, "Notes/x.md");
    assert_eq!(h.len(), 2, "{h:?}");
    let first = h[1]["rev"].as_str().unwrap();
    assert_eq!(
        s.get_note_at_impl("Notes/x.md", first).unwrap(),
        "NEW-TEXT one"
    );
    assert_eq!(
        fs::read_to_string(d.join("Notes/x.md")).unwrap(),
        "NEW-TEXT two"
    );
    fs::remove_dir_all(&d).ok();
}

#[test]
fn moving_to_the_trash_does_not_erase_anything() {
    let d = vault("trash-only", true);
    let s = MemoryStore::new(&d);
    s.create_impl("kept", "Notes", Some("ECHO-KEPT")).unwrap();
    s.soft_delete_impl("Notes/kept.md").unwrap();
    assert!(everything(&d).contains("ECHO-KEPT"));
    let r = s.restore_trash_impl("kept.md", "").unwrap();
    assert_eq!(r["path"], "Notes/kept.md");
    assert_eq!(versions(&s, "Notes/kept.md").len(), 3);
    fs::remove_dir_all(&d).ok();
}

#[test]
fn delete_forever_without_history_just_deletes() {
    let d = vault("off", false);
    let s = MemoryStore::new(&d);
    s.create_impl("plain", "Notes", Some("x")).unwrap();
    s.soft_delete_impl("Notes/plain.md").unwrap();
    let r = s.delete_trash_impl("plain.md").unwrap();
    assert!(r.get("history").is_none(), "{r}");
    assert!(!d.join(".Trash/plain.md").exists());
    s.create_impl("other", "Notes", Some("y")).unwrap();
    s.delete_impl("Notes/other.md").unwrap();
    assert!(!d.join("Notes/other.md").exists());
    assert!(!d.join(".git").exists());
    fs::remove_dir_all(&d).ok();
}

#[test]
fn a_failed_rewrite_leaves_the_history_as_it_was() {
    let d = vault("fail", true);
    let s = MemoryStore::new(&d);
    s.save_impl("Notes/keep.md", "keep v2").unwrap();
    s.create_impl("stuck", "Notes", Some("FOXTROT-STAYS"))
        .unwrap();
    s.soft_delete_impl("Notes/stuck.md").unwrap();
    // Another git process holds the branch: the commit and the ref swap fail.
    let (_, branch) = git(&d, &["symbolic-ref", "HEAD"]);
    let lock = d.join(".git").join(format!("{}.lock", branch.trim()));
    fs::write(&lock, "").unwrap();
    let head = blob_at(&d, "HEAD");
    let e = s.delete_trash_impl("stuck.md").unwrap_err().0;
    assert!(e.contains("could not be erased"), "{e}");
    fs::remove_file(&lock).unwrap();
    // The file is gone; the history (and every ref) is untouched and valid.
    assert!(!d.join(".Trash/stuck.md").exists());
    assert_eq!(blob_at(&d, "HEAD"), head);
    assert!(everything(&d).contains("FOXTROT-STAYS"));
    let (_, refs) = git(&d, &["for-each-ref", "--format=%(refname)"]);
    assert!(!refs.contains("memora-purge"), "{refs}");
    assert!(git(&d, &["fsck", "--no-progress"]).0);
    assert_eq!(versions(&s, "Notes/keep.md").len(), 1);
    fs::remove_dir_all(&d).ok();
}

/// Timing on a vault of about 650 notes and 300 commits (run with --ignored).
#[test]
#[ignore]
fn purge_timing_on_a_big_vault() {
    let d = vault("big", true);
    for i in 0..650 {
        let dir = d.join(format!("F{}", i % 20));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(format!("note {i}.md")),
            format!("# Note {i}\n{}\n", "words ".repeat(80)),
        )
        .unwrap();
    }
    let s = MemoryStore::new(&d);
    s.git_commit("start history");
    for i in 0..300 {
        let n = (i * 7) % 650;
        let p = format!("F{}/note {n}.md", n % 20);
        s.save_impl(&p, &format!("# Note\nedit {i}\n{}\n", "more ".repeat(60)))
            .unwrap();
    }
    s.create_impl("target", "F3", Some("GOLF-SECRET")).unwrap();
    for i in 0..5 {
        s.save_impl("F3/target.md", &format!("GOLF-SECRET {i}"))
            .unwrap();
    }
    s.soft_delete_impl("F3/target.md").unwrap();
    let t = std::time::Instant::now();
    let r = s.delete_trash_impl("target.md").unwrap();
    eprintln!(
        "purge: {} ms total, {} (core report), commits kept {}",
        t.elapsed().as_millis(),
        r["history"]["ms"],
        r["history"]["commits"]
    );
    assert_gone(&d, &["GOLF-SECRET"]);
    fs::remove_dir_all(&d).ok();
}
