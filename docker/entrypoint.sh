#!/bin/sh
# Memora entrypoint: one image, several roles.
set -e

log() { printf '[entrypoint] %s\n' "$*"; }

DATA="${MEMORA_VAULT:-/data}"
STATE="${MEMORA_STATE:-/state}"

# ---- preflight: make sure the vault and state directories are writable ------
# This is the most common failure: compose mounts a directory owned by root
# while the container runs as uid 1000, so the service crash-loops with no
# clear message.
for d in "$DATA" "$STATE"; do
  mkdir -p "$d" 2>/dev/null || true
  if ! touch "$d/.wr-test" 2>/dev/null; then
    log "FAILED: cannot write to $d"
    log "  container uid: $(id -u):$(id -g)"
    log "  directory owner: $(stat -c '%u:%g' "$d" 2>/dev/null || echo '?')"
    log "  fix from the host:  sudo chown -R 1000:1000 <dir>"
    log "  or:                 sudo chgrp -R 1000 <dir> && sudo chmod -R g+rwX <dir>"
    exit 1
  fi
  rm -f "$d/.wr-test"
done

# memora does not use the internal token (auth goes through API keys and
# sessions), but it is created so the state volume matches earlier releases and
# carries the correct permissions.
if [ ! -f "$STATE/internal.token" ]; then
  (umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$STATE/internal.token")
  log "created internal.token"
fi

case "${1:-serve}" in
  serve|gateway|all)
    log "memora: vault=$DATA state=$STATE bind=${MEMORA_BIND:-0.0.0.0}:${MEMORA_PORT:-8400}"
    exec memora
    ;;
  setup)
    shift 2>/dev/null || true
    exec memora-cli setup "$@"
    ;;
  reset|reset-password)
    shift 2>/dev/null || true
    exec memora-cli reset-password "$@"
    ;;
  status)
    exec memora-cli status
    ;;
  unlock)
    exec memora-cli unlock
    ;;
  list)
    exec memora-cli list
    ;;
  cli)
    shift
    exec memora-cli "$@"
    ;;
  *)
    # Free-form command, for example:
    #   docker compose run --rm gateway cli status
    exec "$@"
    ;;
esac
