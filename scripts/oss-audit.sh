#!/usr/bin/env bash
# Open-source readiness audit for the Memora repository.
# Exits non-zero if any check fails.
#
#   bash scripts/oss-audit.sh [REPO_ROOT]
#
# Private terms (hostnames, names, internal paths) are read from an untracked
# file, `.leak-patterns` at the repository root (or $MEMORA_LEAK_PATTERNS), so
# this script never publishes what it looks for. Format: one extended regex
# per line, matched case-insensitively; a line starting with "!" is an allowed
# exception; blank lines and "#" comments are ignored.
set -uo pipefail

REPO="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO" || exit 1
export PATH="$HOME/.cargo/bin:$PATH"

LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT

# Split the local pattern file into deny and allow lists for grep -f.
PATTERN_FILE="${MEMORA_LEAK_PATTERNS:-$REPO/.leak-patterns}"
DENY="$LOGS/deny"; ALLOW="$LOGS/allow"
# Generic patterns, safe to publish: personal home directories, root's home,
# and the CGNAT range used by mesh VPNs.
cat > "$DENY" <<'PAT'
/home/[a-z0-9_.-]+/
(^|[ "'=(:])/root/
\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+
PAT
: > "$ALLOW"
if [ -f "$PATTERN_FILE" ]; then
  grep -vE '^[[:space:]]*(#|$)' "$PATTERN_FILE" | grep -v '^!' >> "$DENY" || true
  grep '^!' "$PATTERN_FILE" | sed 's/^!//' > "$ALLOW" || true
else
  printf 'note: %s not found; checking generic patterns only\n' "$PATTERN_FILE"
fi
# Exit 0 when the text contains a private term that no exception covers.
has_private() {
  local hits
  hits=$(printf '%s\n' "$1" | grep -iE -f "$DENY" || true)
  [ -s "$ALLOW" ] && hits=$(printf '%s\n' "$hits" | grep -viE -f "$ALLOW" || true)
  [ -n "$hits" ]
}

PASS=0
FAIL=0
ok()  { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
sec() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

# The audit and the leak scanner contain the generic patterns they search for,
# so both are excluded from every scan.
SELF='scripts/oss-audit\.sh|scripts/scan-leaks\.py'

scan() {
  find . \
    -path ./target -prune -o \
    -path ./.git -prune -o \
    -path ./node_modules -prune -o \
    -path ./web/node_modules -prune -o \
    -path ./web/dist -prune -o \
    -path ./data -prune -o \
    -path ./state -prune -o \
    -type f -print \
  | sed 's|^\./||' \
  | grep -vE "$SELF" \
  | grep -E '\.(rs|md|html|css|js|mjs|ts|json|sh|yml|yaml|toml|service|webmanifest)$|^Dockerfile$|^\.env\.example$' \
  | grep -vE '(Cargo\.lock|package-lock\.json)'
}

# ------------------------------------------------------------------ 1. traces
sec "1. Private environment traces"
H=$(scan | xargs -r grep -niE -f "$DENY" 2>/dev/null || true)
if [ -s "$ALLOW" ] && [ -n "$H" ]; then H=$(printf '%s\n' "$H" | grep -viE -f "$ALLOW" || true); fi
if [ -z "$H" ]; then ok "no private-environment references"
else bad "private references found:"; printf '%s\n' "$H" | head -30; fi

# -------------------------------------------------------------- 2. indonesian
# Only words that are unambiguously Indonesian. English words that happen to
# appear in Indonesian ("folder", "server", "file") are deliberately absent.
sec "2. Indonesian prose"
IDW='\b(dan|atau|yang|dengan|untuk|tidak|sudah|bisa|kalau|karena|adalah|dari|itu|juga|hanya|agar|biar|saja|masih|harus|perlu|jalankan|catatan|simpan|hapus|pindah|tertutup|dibuka|berlaku|detik|kunci|akses|sesi|sandi|daftar|berkas|jumlah|pengaturan|tutup|batal|cari|gagal|berhasil|menunggu|dibuat|dihapus|silahkan|silakan|memori|halaman|nama|warna|baru|lama|pilih)\b'
H=$(scan | xargs -r grep -niE "$IDW" 2>/dev/null | grep -viE 'lang="id"|id-ID' || true)
N=$(printf '%s\n' "$H" | grep -c . || true)
if [ "${N:-0}" -eq 0 ]; then ok "no Indonesian prose"
else bad "$N line(s) still Indonesian:"; printf '%s\n' "$H" | head -25; fi

# ---------------------------------------------------------------- 3. em dash
sec "3. Em dashes (project style)"
H=$(scan | xargs -r grep -nP '\x{2014}' 2>/dev/null || true)
if [ -z "$H" ]; then ok "no em dashes"
else bad "em dashes present:"; printf '%s\n' "$H" | head -15; fi

# ------------------------------------------------------- 4. markdown integrity
sec "4. Markdown integrity"
MD=$(scan | grep -E '\.md$')
if [ -n "$MD" ]; then
  PROB=$(printf '%s\n' "$MD" | xargs -r python3 -c '
import sys
for f in sys.argv[1:]:
    try: lines = open(f, encoding="utf-8").read().splitlines()
    except OSError: continue
    fence = False
    for i, l in enumerate(lines, 1):
        s = l.strip()
        # Track fenced code blocks; their contents are not markdown.
        if s.startswith("```") or s.startswith("~~~"):
            fence = not fence
            continue
        if fence:
            continue
        if "***" in l:
            print(f"{f}:{i}: literal asterisk run")
        # A line with an odd number of inline backticks leaves a span open.
        # Strip complete spans first so even counts are not misreported.
        if l.count("`") % 2:
            print(f"{f}:{i}: unbalanced backtick")
    if fence:
        print(f"{f}: unclosed code fence")
' 2>/dev/null || true)
  if [ -z "$PROB" ]; then ok "no redaction artifacts or unbalanced backticks"
  else bad "markdown problems:"; printf '%s\n' "$PROB" | head -20; fi

  BROKEN=""
  for f in $MD; do
    d="$(dirname "$f")"
    for l in $(grep -oE '\]\([^)]+\)' "$f" 2>/dev/null | sed 's/^](//; s/)$//' | cut -d'#' -f1); do
      case "$l" in http*|mailto:*) continue ;; esac
      [ -e "$d/$l" ] || [ -e "$l" ] || BROKEN="$BROKEN
  $f -> $l"
    done
  done
  if [ -z "$BROKEN" ]; then ok "every relative markdown link resolves"
  else bad "broken links:"; printf '%s\n' "$BROKEN" | head -15; fi
else
  bad "no markdown files found"
fi

# --------------------------------------------------------- 5. required files
sec "5. Repository metadata"
MISSING=""
for f in README.md LICENSE CONTRIBUTING.md SECURITY.md CHANGELOG.md CODE_OF_CONDUCT.md \
         .editorconfig .gitignore .dockerignore Dockerfile docker-compose.yml .env.example \
         docs/ARCHITECTURE.md docs/CONFIGURATION.md docs/MCP.md docs/API.md docs/DEPLOYMENT.md \
         .github/workflows/ci.yml .github/pull_request_template.md tests/e2e.sh; do
  [ -e "$f" ] || MISSING="$MISSING $f"
done
if [ -z "$MISSING" ]; then ok "all expected files present"
else bad "missing:$MISSING"; fi

# ----------------------------------------------------------------- 6. secrets
sec "6. No committed secrets"
H=$(scan | grep -E '\.(env|key|pem|p12|token)$|(^|/)\.env$|id_rsa|id_ed25519' || true)
if [ -z "$H" ]; then ok "no key or secret files in the tree"
else bad "secret-like files present:"; printf '%s\n' "$H"; fi

# ------------------------------------------------------------------- 7. rust
sec "7. Build, format, lint, tests"
if cargo build --release >"$LOGS/build.log" 2>&1; then ok "cargo build --release"
else bad "cargo build --release"; tail -12 "$LOGS/build.log"; fi
if cargo fmt --all -- --check >/dev/null 2>&1; then ok "cargo fmt --check"
else bad "cargo fmt --check"; fi
if cargo clippy --workspace --all-targets -- -D warnings >"$LOGS/clippy.log" 2>&1; then ok "cargo clippy -D warnings"
else bad "cargo clippy -D warnings"; grep -E '^(error|warning)' "$LOGS/clippy.log" | head -8; fi
if cargo test --workspace >"$LOGS/test.log" 2>&1; then ok "cargo test --workspace"
else bad "cargo test --workspace"; grep -E 'test result|^error' "$LOGS/test.log" | head -8; fi

# --------------------------------------------------------------- 8. frontend
sec "8. Frontend"
if [ -f web/package.json ] && [ -d web/src ]; then
  TSFILES=$(find web/src -name '*.ts' | wc -l)
  [ "$TSFILES" -gt 0 ] && ok "$TSFILES TypeScript source module(s)" || bad "no TypeScript sources"
  if (cd web && npm run build) >"$LOGS/web.log" 2>&1; then ok "web build succeeds"
  else bad "web build"; tail -12 "$LOGS/web.log"; fi
  if grep -qE 'typescript' web/package.json; then ok "typescript declared in web/package.json"
  else bad "typescript not declared"; fi
else
  bad "web/ frontend workspace missing"
fi
if head -2 crates/http/assets/app.js | grep -qi 'generated'; then ok "served app.js marks itself generated"
else bad "served app.js has no generated marker"; fi

# ------------------------------------------------------------ 9. live server
sec "9. Live HTTP surface"
WORK="$(mktemp -d)"; PORT=$(( (RANDOM % 1200) + 8700 ))
mkdir -p "$WORK/vault" "$WORK/state"
MEMORA_VAULT="$WORK/vault" MEMORA_STATE="$WORK/state" MEMORA_PORT="$PORT" MEMORA_BIND=127.0.0.1 \
  ./target/release/memora >"$WORK/log" 2>&1 &
SRV=$!
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/healthz" && break; sleep 0.5; done

HZ=$(curl -s "http://127.0.0.1:$PORT/healthz")
printf '%s' "$HZ" | grep -q '"ok":true' && ok "healthz ok: $HZ" || bad "healthz: $HZ"
if has_private "$HZ"; then bad "healthz leaks a private term: $HZ"; else ok "healthz free of private terms"; fi
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" = "302" ] \
  && ok "cookieless / redirects to login" || bad "cookieless / did not redirect"
for a in app.js app.css favicon.svg icon-192.png icon-512.png manifest.webmanifest sw.js offline.html robots.txt; do
  C=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/$a")
  [ "$C" = "200" ] && ok "asset 200: $a" || bad "asset $a -> $C"
done
curl -s "http://127.0.0.1:$PORT/manifest.webmanifest" \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["name"]=="Memora",d["name"]' >/dev/null 2>&1 \
  && ok "manifest name is Memora" || bad "manifest name wrong"
DISC=$(curl -s "http://127.0.0.1:$PORT/.well-known/mcp.json")
case "$DISC" in
  *'"name": "memora"'*|*'"name":"memora"'*) ok "MCP discovery names memora" ;;
  *) bad "MCP discovery name: ${DISC:0:120}" ;;
esac
if has_private "$DISC"; then bad "MCP discovery leaks a private term"; else ok "MCP discovery clean"; fi
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "http://127.0.0.1:$PORT/mcp")" != "200" ] \
  && ok "MCP refuses unauthenticated calls" || bad "MCP allowed an unauthenticated call"
kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; rm -rf "$WORK"

# ---------------------------------------------------------------- 10. compose
sec "10. Container definition"
if command -v docker >/dev/null 2>&1; then
  if sudo -n docker compose config >/dev/null 2>&1 || docker compose config >/dev/null 2>&1; then
    ok "docker compose config valid"
  else bad "docker compose config invalid"; fi
  if sudo -n docker image inspect memora:verify >/dev/null 2>&1 || docker image inspect memora:latest >/dev/null 2>&1; then
    ok "a built image is present locally"
  else printf '  \033[33mINFO\033[0m no local image (build not run in this environment)\n'; fi
else
  printf '  \033[33mSKIP\033[0m docker not available\n'
fi

sec "RESULT"
printf 'PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
