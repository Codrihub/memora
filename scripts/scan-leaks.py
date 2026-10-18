#!/usr/bin/env python3
"""Scan the repository for text that should not ship in a public release.

Reports:
  * generic leaks: personal home directories, root's home, CGNAT addresses
  * private terms listed in an untracked `.leak-patterns` file at the
    repository root (see scripts/oss-audit.sh for the format)
  * Indonesian words inside string literals that likely reach a user

Usage: scripts/scan-leaks.py [REPO_ROOT]   (exit status 1 when anything is found)
"""
import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
PATTERN_FILE = os.environ.get("MEMORA_LEAK_PATTERNS", os.path.join(ROOT, ".leak-patterns"))
SKIP_DIRS = {"target", ".git", "node_modules", "dist", ".cargo", "data", "state"}
# The scanners contain the generic patterns they hunt for.
SKIP_FILES = {"scan-leaks.py", "oss-audit.sh"}
EXTS = {".rs", ".ts", ".js", ".html", ".css", ".json", ".sh", ".yml", ".yaml",
        ".toml", ".md", ".webmanifest", ".service"}

# Safe to publish: they reveal nothing about any particular machine.
GENERIC = [
    r"/home/[a-z0-9_.-]+/",
    r"(^|[ \"'=(:])/root/",
    r"\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+",
]


def load_patterns(path):
    """Deny and allow regexes from the local pattern file, if it exists."""
    deny, allow = [], []
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("!"):
                    allow.append(line[1:])
                else:
                    deny.append(line)
    except FileNotFoundError:
        print(f"note: {path} not found; checking generic patterns only", file=sys.stderr)
    return deny, allow


deny, allow = load_patterns(PATTERN_FILE)
LEAK = re.compile("|".join(f"(?:{p})" for p in GENERIC + deny), re.I)
ALLOW = re.compile("|".join(f"(?:{p})" for p in allow), re.I) if allow else None

ID_WORD = re.compile(
    r"\b(dan|atau|yang|dengan|untuk|tidak|sudah|bisa|kalau|karena|adalah|dari|ini|itu|"
    r"juga|hanya|agar|biar|saja|masih|harus|perlu|jalankan|catatan|simpan|hapus|pindah|"
    r"tertutup|dibuka|berlaku|detik|kunci|akses|sesi|kata sandi|daftar|berkas|jumlah|"
    r"pengaturan|tutup|batal|cari|gagal|berhasil|menunggu|dibuat|dihapus)\b", re.I)

# A Rust string literal (naive but adequate for this codebase).
RS_STR = re.compile(r'"((?:[^"\\]|\\.)*)"')
# A JS/TS string literal or template chunk.
JS_STR = re.compile(r"""['"`]((?:[^'"`\\]|\\.)*)['"`]""")

leaks = []
indo = []

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        ext = os.path.splitext(fn)[1]
        if ext not in EXTS and fn not in ("Dockerfile", ".env.example"):
            continue
        # Lock files contain hashes, not prose.
        if fn.endswith(".lock") or fn == "package-lock.json" or fn in SKIP_FILES:
            continue
        path = os.path.join(dirpath, fn)
        rel = os.path.relpath(path, ROOT)
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            m = LEAK.search(line)
            if m and not (ALLOW and ALLOW.search(line)):
                leaks.append((rel, i, m.group(0), line.strip()[:150]))
            if ext in (".rs", ".ts", ".js", ".html", ".css"):
                for lit in RS_STR.findall(line) + JS_STR.findall(line):
                    if ID_WORD.search(lit):
                        indo.append((rel, i, lit[:110]))
                        break

print("=" * 72)
print("LEAKS (private or machine-specific references)")
print("=" * 72)
for rel, i, hit, line in leaks:
    print(f"{rel}:{i}: [{hit}] {line}")
if not leaks:
    print("(none)")

print()
print("=" * 72)
print("INDONESIAN IN STRING LITERALS (likely user-facing)")
print("=" * 72)
for rel, i, lit in indo:
    print(f"{rel}:{i}: {lit}")
if not indo:
    print("(none)")

print()
print(f"TOTAL leaks={len(leaks)} indonesian_literals={len(indo)}")
sys.exit(1 if (leaks or indo) else 0)
