//! Images live beside their notes and always follow them: move, trash, restore and
//! delete forever treat a note's own images exactly like the note, and a `path:` copied
//! from another folder is duplicated into the note's folder.

use memora_core::MemoryStore;
use std::fs;
use std::path::{Path, PathBuf};

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake-pixels";

fn vault(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "memora-images-{tag}-{}-{}",
        std::process::id(),
        std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos()
    ));
    fs::create_dir_all(d.join("A")).unwrap();
    fs::create_dir_all(d.join("B")).unwrap();
    d
}

fn note(d: &Path, rel: &str, body: &str) {
    fs::write(d.join(rel), body).unwrap();
}

#[test]
fn uploads_land_beside_the_note_and_refuse_non_images() {
    let d = vault("upload");
    note(&d, "A/n.md", "# N\n");
    let s = MemoryStore::new(&d);
    let v = s
        .save_image_impl("A/n.md", "Holiday Photo.png", PNG, 1024)
        .unwrap();
    assert_eq!(v["path"], "A/Holiday-Photo.png");
    assert_eq!(v["markdown"], "![Holiday-Photo](path:Holiday-Photo.png)");
    assert!(d.join("A/Holiday-Photo.png").is_file());
    // The same bytes again reuse the file; other bytes get a free name.
    assert_eq!(
        s.save_image_impl("A/n.md", "Holiday Photo.png", PNG, 1024)
            .unwrap()["name"],
        "Holiday-Photo.png"
    );
    let other = [PNG, b"!"].concat();
    assert_eq!(
        s.save_image_impl("A/n.md", "Holiday Photo.png", &other, 1024)
            .unwrap()["name"],
        "Holiday-Photo-1.png"
    );
    assert!(s
        .save_image_impl("A/n.md", "x.png", b"<svg/>", 1024)
        .is_err());
    assert!(s.save_image_impl("A/n.md", "big.png", PNG, 4).is_err());
}

#[test]
fn a_path_from_another_folder_is_copied_beside_the_note() {
    let d = vault("localize");
    fs::write(d.join("B/pic.png"), PNG).unwrap();
    note(&d, "A/n.md", "# N\n");
    let s = MemoryStore::new(&d);
    s.save_impl("A/n.md", "# N\n\n![p](path:B/pic.png)\n")
        .unwrap();
    assert_eq!(
        fs::read_to_string(d.join("A/n.md")).unwrap(),
        "# N\n\n![p](path:pic.png)\n"
    );
    assert!(d.join("A/pic.png").is_file() && d.join("B/pic.png").is_file());
}

#[test]
fn moving_a_note_moves_its_images_and_copies_shared_ones() {
    let d = vault("move");
    fs::write(d.join("A/own.png"), PNG).unwrap();
    fs::write(d.join("A/shared.png"), PNG).unwrap();
    note(&d, "A/n.md", "![o](path:own.png) ![s](path:shared.png)");
    note(&d, "A/other.md", "![s](path:shared.png)");
    let s = MemoryStore::new(&d);
    s.move_impl("A/n.md", "B").unwrap();
    assert!(d.join("B/own.png").is_file() && !d.join("A/own.png").exists());
    assert!(d.join("B/shared.png").is_file() && d.join("A/shared.png").is_file());
}

#[test]
fn trash_and_restore_carry_the_images_even_to_another_folder() {
    let d = vault("trash");
    fs::write(d.join("A/own.png"), PNG).unwrap();
    note(&d, "A/n.md", "![o](path:own.png)");
    let s = MemoryStore::new(&d);
    let t = s.soft_delete_impl("A/n.md").unwrap();
    assert!(!d.join("A/own.png").exists());
    let name = t["to"]
        .as_str()
        .unwrap()
        .trim_start_matches(".Trash/")
        .to_string();
    s.restore_trash_impl(&name, "B").unwrap();
    assert!(d.join("B/n.md").is_file() && d.join("B/own.png").is_file());
    assert!(!d.join(".Trash/.assets").join(&name).exists());
}

#[test]
fn delete_forever_takes_only_images_no_other_note_shows() {
    let d = vault("delete");
    fs::write(d.join("A/own.png"), PNG).unwrap();
    fs::write(d.join("A/shared.png"), PNG).unwrap();
    note(&d, "A/n.md", "![o](path:own.png) ![s](path:shared.png)");
    note(&d, "A/other.md", "![s](path:shared.png)");
    let s = MemoryStore::new(&d);
    s.delete_impl("A/n.md").unwrap();
    assert!(!d.join("A/own.png").exists());
    assert!(d.join("A/shared.png").is_file());
}

#[test]
fn deleting_a_folder_moves_the_images_with_their_notes() {
    let d = vault("folder");
    fs::create_dir_all(d.join("A/Sub")).unwrap();
    fs::write(d.join("A/Sub/pic.png"), PNG).unwrap();
    note(&d, "A/Sub/n.md", "![p](path:pic.png)");
    let s = MemoryStore::new(&d);
    s.delete_folder_impl("A/Sub").unwrap();
    assert!(d.join("A/n.md").is_file() && d.join("A/pic.png").is_file());
}

#[test]
fn galleries_show_one_folder_with_the_notes_and_sections_using_each_image() {
    let d = vault("gallery");
    fs::create_dir_all(d.join("A/Sub")).unwrap();
    fs::write(d.join("A/pic.png"), PNG).unwrap();
    fs::write(d.join("A/Sub/deeper.png"), PNG).unwrap();
    note(&d, "A/n.md", "# Trip\n\n## Beach\n\n![b](path:pic.png)\n");
    let s = MemoryStore::new(&d);
    let g = s.folder_images_impl("A").unwrap();
    assert_eq!(g.len(), 1, "only A itself, not A/Sub: {g:?}");
    assert_eq!(g[0]["used_in"][0]["note"], "A/n.md");
    assert_eq!(g[0]["used_in"][0]["heading"], "Beach");
    let n = s.note_images_impl("A/n.md").unwrap();
    assert_eq!(n["images"][0]["name"], "pic.png");
    assert_eq!(s.storage_impl()["images"], 2);
}
