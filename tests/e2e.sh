#!/usr/bin/env bash
# End-to-end smoke test for a fresh Memora checkout.
#
# Proves a stranger can: build the workspace, boot the server on a scratch
# vault, arm the first-run window from the CLI, complete setup over HTTP,
# sign in, and exercise the vault API, the realtime socket and MCP.
#
# Usage:  bash tests/e2e.sh [port]
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1
export PATH="$HOME/.cargo/bin:$PATH"

PORT="${1:-8791}"
WORK="$(mktemp -d)"
VAULT="$WORK/vault"
STATE="$WORK/state"
mkdir -p "$VAULT" "$STATE"

USER_NAME="operator"
PASSWORD="memora-e2e-password"
COOKIE="$WORK/cookie.txt"
LOG="$WORK/server.log"

PASS=0
FAIL=0
ok()  { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
sec() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

cleanup() {
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

code()   { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body()   { curl -s "$@"; }
jget()   { python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }
# The CSRF guard requires a same-origin Origin header on cookie-authenticated
# writes, which is exactly what a browser sends.
POSTC() { curl -s -b "$COOKIE" -H "Origin: http://127.0.0.1:$PORT" -H 'content-type: application/json' "$@"; }

sec "1. Build"
if cargo build --release >"$LOG" 2>&1; then
  ok "cargo build --release"
else
  bad "cargo build --release"; tail -20 "$LOG"; exit 1
fi
SERVER="$REPO/target/release/memora"
CLI="$REPO/target/release/memora-cli"
[ -x "$SERVER" ] && ok "binary: memora" || bad "binary memora missing"
[ -x "$CLI" ] && ok "binary: memora-cli" || bad "binary memora-cli missing"

sec "2. Boot on a scratch vault"
MEMORA_VAULT="$VAULT" MEMORA_VAULT_AUTO=true MEMORA_STATE="$STATE" MEMORA_PORT="$PORT" \
  MEMORA_BIND=127.0.0.1 "$SERVER" >>"$LOG" 2>&1 &
SRV=$!
READY=no
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/healthz" && { READY=yes; break; }
  sleep 0.5
done
[ "$READY" = yes ] && ok "server answered /healthz" || { bad "server never came up"; tail -30 "$LOG"; exit 1; }

HZ=$(body "http://127.0.0.1:$PORT/healthz")
printf '%s' "$HZ" | grep -q '"ok":true' && ok "healthz ok:true" || bad "healthz: $HZ"
printf '%s' "$HZ" | grep -qi 'memora' && ok "healthz names the project" || bad "healthz project name: $HZ"

sec "3. First-run window is closed until armed"
[ "$(code "http://127.0.0.1:$PORT/api/auth/state")" = "200" ] && ok "auth state readable" || bad "auth state unreadable"
S=$(body "http://127.0.0.1:$PORT/api/auth/state")
printf '%s' "$S" | grep -q '"armed":false' && ok "not armed on a fresh instance" || bad "unexpected arm state: $S"
[ "$(code -X POST -H 'content-type: application/json' -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASSWORD\"}" \
     "http://127.0.0.1:$PORT/api/auth/bootstrap")" = "403" ] \
  && ok "bootstrap refused while closed" || bad "bootstrap was not refused"

sec "4. Arm from the CLI, then complete setup over HTTP"
SETUP_OUT=$(MEMORA_STATE="$STATE" MEMORA_VAULT="$VAULT" "$CLI" setup --ttl 120 2>&1)
printf '%s\n' "$SETUP_OUT" >>"$LOG"
# The one-time code the CLI prints (e.g. K7QF-29XM).
SETUP_CODE=$(printf '%s' "$SETUP_OUT" | grep -oE '[A-Z0-9]{4}-[A-Z0-9]{4}' | head -1)
[ -n "$SETUP_CODE" ] && ok "CLI printed a one-time code" || bad "no one-time code in the CLI output"
S=$(body "http://127.0.0.1:$PORT/api/auth/state")
printf '%s' "$S" | grep -q '"armed":true' && ok "window armed by CLI" || bad "arm state: $S"
BC=$(code -X POST -H 'content-type: application/json' \
     -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASSWORD\",\"code\":\"$SETUP_CODE\"}" \
     "http://127.0.0.1:$PORT/api/auth/bootstrap")
[ "$BC" = "200" ] && ok "owner created over HTTP" || bad "bootstrap returned $BC"

sec "5. Session auth"
LC=$(curl -s -o /dev/null -w '%{http_code}' -c "$COOKIE" -X POST -H 'content-type: application/json' \
     -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASSWORD\"}" "http://127.0.0.1:$PORT/api/auth/login")
[ "$LC" = "200" ] && ok "login 200" || bad "login returned $LC"
grep -q 'memora_sess' "$COOKIE" && ok "session cookie set" || bad "no session cookie"
[ "$(code "http://127.0.0.1:$PORT/api/tree")" = "401" ] && ok "unauthenticated read is 401" || bad "unauthenticated read not refused"
CB=$(code -b "$COOKIE" "http://127.0.0.1:$PORT/api/tree")
[ "$CB" = "200" ] && ok "authenticated read is 200" || bad "authenticated read returned $CB"

sec "6. Vault CRUD"
CR=$(POSTC -X POST -d '{"title":"E2E Smoke Note","folder":"Root","content":"# E2E\n\nlinked to [[Index]] and tagged #e2e."}' \
     "http://127.0.0.1:$PORT/api/create")
NODE=$(printf '%s' "$CR" | jget "['path']")
if [ -n "$NODE" ]; then ok "note created: $NODE"; else bad "create failed: $CR"; fi
if [ -n "$NODE" ]; then
  Q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$NODE")
  SR=$(body -b "$COOKIE" "http://127.0.0.1:$PORT/api/note?path=$Q")
  printf '%s' "$SR" | grep -qi 'e2e' && ok "note reads back" || bad "note read: ${SR:0:160}"
fi
body -b "$COOKIE" "http://127.0.0.1:$PORT/api/search?q=e2e" | grep -qi 'E2E' && ok "search finds the note" || bad "search found nothing"
body -b "$COOKIE" "http://127.0.0.1:$PORT/api/graph" | grep -q '"nodes"' && ok "graph returns nodes" || bad "graph payload unexpected"
body -b "$COOKIE" "http://127.0.0.1:$PORT/api/stats" | grep -q '"notes"' && ok "stats returns counts" || bad "stats payload unexpected"

sec "7. Assets and MCP surface"
# `/` is expected to redirect a cookieless client to the login page.
[ "$(code "http://127.0.0.1:$PORT/")" = "302" ] && ok "/ redirects a cookieless client to /login" || bad "/ did not redirect"
[ "$(code -b "$COOKIE" "http://127.0.0.1:$PORT/")" = "200" ] && ok "/ serves the app to a signed-in client" || bad "/ not served to a signed-in client"
for a in app.js app.css favicon.svg icon-192.png manifest.webmanifest sw.js offline.html robots.txt; do
  C=$(code "http://127.0.0.1:$PORT/$a")
  [ "$C" = "200" ] && ok "asset 200: $a" || bad "asset $a returned $C"
done
for a in app.js app.css favicon.svg manifest.webmanifest; do
  T=$(curl -s -o /dev/null -w '%{content_type}' "http://127.0.0.1:$PORT/$a")
  printf '%s' "$T" | grep -qE 'javascript|css|svg|json' && ok "content type $a: $T" || bad "content type $a: $T"
done
MN=$(body "http://127.0.0.1:$PORT/manifest.webmanifest")
printf '%s' "$MN" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['name'])" 2>/dev/null | grep -qi memora \
  && ok "manifest is valid JSON naming Memora" || bad "manifest: ${MN:0:120}"
DISC=$(body "http://127.0.0.1:$PORT/.well-known/mcp.json")
printf '%s' "$DISC" | grep -qi memora && ok "MCP discovery document present" || bad "discovery: ${DISC:0:120}"

sec "8. API key and MCP over HTTP"
KC=$(POSTC -X POST -d '{"name":"e2e-key"}' "http://127.0.0.1:$PORT/api/keys")
KEY=$(printf '%s' "$KC" | python3 -c "import json,sys
d=json.load(sys.stdin)
def dig(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if k in ('key','token','api_key') and isinstance(v,str) and v: return v
            r=dig(v)
            if r: return r
    if isinstance(o,list):
        for v in o:
            r=dig(v)
            if r: return r
    return None
print(dig(d) or '')" 2>/dev/null)
if [ -n "$KEY" ]; then
  ok "API key issued (${#KEY} chars)"
  MC=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
       -H "accept: application/json, text/event-stream" -H "authorization: Bearer $KEY" \
       -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "http://127.0.0.1:$PORT/mcp")
  [ "$MC" = "200" ] && ok "MCP tools/list over HTTP 200" || bad "MCP tools/list returned $MC"
else
  bad "no API key in response: ${KC:0:160}"
fi
[ "$(code -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
     "http://127.0.0.1:$PORT/mcp")" != "200" ] \
  && ok "MCP refuses an unauthenticated call" || bad "MCP allowed an unauthenticated call"

sec "9. Realtime socket"
# The socket needs the session cookie and a same-origin Origin header.
SID=$(awk '$6 == "memora_sess" { print $7 }' "$COOKIE" | tail -1)
WS=$(python3 - "$PORT" "$SID" <<'PY' 2>/dev/null
import base64, os, socket, sys
port, sid = int(sys.argv[1]), sys.argv[2]
key = base64.b64encode(os.urandom(16)).decode()
s = socket.create_connection(("127.0.0.1", port), timeout=5)
s.sendall(("GET /ws HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nOrigin: http://127.0.0.1:%d\r\n"
           "Cookie: memora_sess=%s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
           "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (port, port, sid, key)).encode())
print(s.recv(200).decode(errors="replace").split("\r\n")[0])
PY
)
printf '%s' "$WS" | grep -q '101' && ok "websocket upgrade: $WS" || bad "websocket upgrade: ${WS:-no response}"

sec "10. Vault on disk is plain markdown"
FOUND=$(find "$VAULT" -name '*.md' -not -path '*/.git/*' | wc -l)
[ "${FOUND:-0}" -ge 1 ] && ok "$FOUND markdown file(s) written by the API" || bad "no markdown written to the vault"

sec "RESULT"
printf 'PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
