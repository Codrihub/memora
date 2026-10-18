#!/bin/sh
# Memora installer: one step, native, Linux x86_64 / aarch64 with systemd.
#
#   curl -fsSL https://raw.githubusercontent.com/Codrihub/memora/main/scripts/install.sh | sudo sh
#   sudo sh install.sh --version 1.0.0 --port 8400 --behind-proxy
#   sudo sh install.sh --upgrade --yes
#   sudo sh install.sh --uninstall [--purge]
#   sh install.sh --check
#
# Run "install.sh --help" for every flag. Full guide: docs/INSTALL.md
#
# Exit codes (stable, used by `memora-cli /update`):
#   0  success
#   1  generic error
#   2  bad usage
#   3  already up to date (--upgrade only)
#   4  network / download failure
#   5  checksum mismatch or missing checksum
#   6  not running as root
#   7  unsupported platform
set -eu

REPO="${MEMORA_REPO:-Codrihub/memora}"
PREFIX="/usr/local"
DATA_DIR="/var/lib/memora"
PORT=""
BIND=""
BEHIND_PROXY=0
VERSION=""
SOURCE="release"        # release | source | dir
FROM_DIR=""
MODE="install"          # install | upgrade | uninstall | check
PURGE=0
NO_START=0
NO_SYSTEMD=0
DRY_RUN=0
ASSUME_YES=0
FORCE=0
UNIT_NAME="memora.service"
UNIT_DIR="/etc/systemd/system"
SVC_USER="memora"

OLD_VERSION=""
NEW_VERSION=""
RESULT=""
WORK=""

# ----------------------------------------------------------------- helpers ---
say()  { printf '%s\n' "$*"; }
info() { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { # die <code> <message>
  code="$1"; shift
  printf 'error: %s\n' "$*" >&2
  exit "$code"
}

# Print an action; run it unless --dry-run.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

# write_file <path> <mode>: content from stdin.
write_file() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] write %s (mode %s):\n' "$1" "$2"
    sed 's/^/[dry-run]   | /'
    return 0
  fi
  _tmp="$1.tmp.$$"
  cat > "$_tmp"
  chmod "$2" "$_tmp"
  mv -f "$_tmp" "$1"
}

usage() {
  cat <<'EOF'
Memora installer

Usage: install.sh [options]

Modes (default: install, idempotent):
  --upgrade             Replace binaries and assets atomically, keep state, restart
  --uninstall           Stop and remove the service, binaries and assets (keeps data)
  --purge               With --uninstall: also delete the data dir and the memora user
  --check               Print MEMORA_LATEST=<v> and MEMORA_INSTALLED=<v>, change nothing

Source (default: GitHub release for this CPU, sha256-verified):
  --version X.Y.Z       Install this release instead of the latest
  --from-source         Build with cargo from the checkout this script lives in
  --from-dir PATH       Use prebuilt memora, memora-cli and assets/ from PATH

Options:
  --port N              HTTP port (default 8400, or the value of an existing install)
  --bind ADDR           Bind address (default 0.0.0.0, or the existing value)
  --behind-proxy        Bind 127.0.0.1 only; a reverse proxy on this host is the entry
  --prefix DIR          Install prefix (default /usr/local)
  --data-dir DIR        Data root holding state/ and vault/ (default /var/lib/memora)
  --no-start            Install but do not start the service
  --no-systemd          Skip the systemd unit and the system user (containers, tests)
  --dry-run             Print every action without changing anything
  --yes, -y             Never ask; assume yes (required for --purge without a TTY)
  --force               With --upgrade: reinstall even when already up to date
  --repo OWNER/NAME     GitHub repository (default Codrihub/memora)
  -h, --help            Show this help

Exit codes: 0 ok, 1 error, 2 usage, 3 already up to date, 4 network,
            5 checksum, 6 not root, 7 unsupported platform.
EOF
}

# ------------------------------------------------------------------- flags ---
need_arg() { if [ "$#" -lt 2 ] || [ -z "$2" ]; then die 2 "$1 needs a value"; fi; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --upgrade)     MODE="upgrade" ;;
    --uninstall)   MODE="uninstall" ;;
    --purge)       PURGE=1 ;;
    --check)       MODE="check" ;;
    --version)     need_arg "$@"; VERSION="${2#v}"; shift ;;
    --version=*)   VERSION="${1#*=}"; VERSION="${VERSION#v}" ;;
    --from-source) SOURCE="source" ;;
    --from-dir)    need_arg "$@"; SOURCE="dir"; FROM_DIR="$2"; shift ;;
    --from-dir=*)  SOURCE="dir"; FROM_DIR="${1#*=}" ;;
    --port)        need_arg "$@"; PORT="$2"; shift ;;
    --port=*)      PORT="${1#*=}" ;;
    --bind)        need_arg "$@"; BIND="$2"; shift ;;
    --bind=*)      BIND="${1#*=}" ;;
    --behind-proxy) BEHIND_PROXY=1 ;;
    --prefix)      need_arg "$@"; PREFIX="$2"; shift ;;
    --prefix=*)    PREFIX="${1#*=}" ;;
    --data-dir)    need_arg "$@"; DATA_DIR="$2"; shift ;;
    --data-dir=*)  DATA_DIR="${1#*=}" ;;
    --repo)        need_arg "$@"; REPO="$2"; shift ;;
    --repo=*)      REPO="${1#*=}" ;;
    --no-start)    NO_START=1 ;;
    --no-systemd)  NO_SYSTEMD=1 ;;
    --dry-run)     DRY_RUN=1 ;;
    --yes|-y)      ASSUME_YES=1 ;;
    --force)       FORCE=1 ;;
    -h|--help)     usage; exit 0 ;;
    *)             usage >&2; die 2 "unknown option: $1" ;;
  esac
  shift
done

case "$PORT" in
  ''|*[!0-9]*) [ -z "$PORT" ] || die 2 "--port must be a number" ;;
  *) if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then die 2 "--port must be 1-65535"; fi ;;
esac
case "$PREFIX$DATA_DIR" in *' '*) die 2 "paths with spaces are not supported" ;; esac
case "$PREFIX" in /*) ;; *) die 2 "--prefix must be an absolute path" ;; esac
case "$DATA_DIR" in /*) ;; *) die 2 "--data-dir must be an absolute path" ;; esac
# The data dir is chmod'ed on install and deleted by --purge: refuse system trees.
case "${DATA_DIR%/}" in
  ''|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/usr/*|/var|/var/lib)
    die 2 "--data-dir $DATA_DIR is a system directory; use a dedicated folder such as /var/lib/memora" ;;
esac
[ "$PURGE" -eq 0 ] || [ "$MODE" = "uninstall" ] || die 2 "--purge only works with --uninstall"

BIN_DIR="$PREFIX/bin"
SHARE_DIR="$PREFIX/share/memora"
ASSETS_DIR="$SHARE_DIR/assets"
STATE_DIR="$DATA_DIR/state"
VAULT_DIR="$DATA_DIR/vault"
UNIT_FILE="$UNIT_DIR/$UNIT_NAME"
# Mirror or air-gapped release host; must serve <url>/download/vX.Y.Z/<files>.
RELEASES_URL="${MEMORA_RELEASES_URL:-https://github.com/$REPO/releases}"

cleanup() {
  rc=$?
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi
  if [ "$MODE" = "upgrade" ]; then
    if [ -z "$RESULT" ]; then
      if [ "$rc" -eq 0 ]; then RESULT="ok"; elif [ "$rc" -eq 3 ]; then RESULT="uptodate"; else RESULT="error"; fi
    fi
    printf 'MEMORA_UPGRADE_RESULT=%s FROM=%s TO=%s\n' "$RESULT" "${OLD_VERSION:-none}" "${NEW_VERSION:-unknown}"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# --------------------------------------------------------------- platform ---
detect_arch() {
  [ "$(uname -s)" = "Linux" ] || die 7 "only Linux is supported by this installer (use Docker elsewhere)"
  case "$(uname -m)" in
    x86_64|amd64)  ARCH="x86_64" ;;
    aarch64|arm64) ARCH="aarch64" ;;
    *) die 7 "unsupported CPU $(uname -m); supported: x86_64, aarch64 (or use --from-source / Docker)" ;;
  esac
}

# The nearest existing directory at or above $1.
existing_parent() {
  _d="$1"
  while [ ! -d "$_d" ]; do _d=$(dirname "$_d"); done
  printf '%s' "$_d"
}

require_root() {
  [ "$DRY_RUN" -eq 1 ] && return 0
  [ "$(id -u)" -eq 0 ] && return 0
  if [ "$NO_SYSTEMD" -eq 1 ] && [ -w "$(existing_parent "$PREFIX")" ] && [ -w "$(existing_parent "$DATA_DIR")" ]; then return 0; fi
  die 6 "this needs root. Re-run with sudo, for example:
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/scripts/install.sh | sudo sh
  sudo sh $0 $MODE_ARGS"
}

have() { command -v "$1" >/dev/null 2>&1; }

# download <url> <dest>
download() {
  if have curl; then
    curl -fsSL --retry 3 --connect-timeout 15 -o "$2" "$1"
  elif have wget; then
    wget -q -O "$2" "$1"
  else
    die 4 "neither curl nor wget is installed"
  fi
}

# Latest release version, from the /releases/latest redirect (no API rate limit).
latest_version() {
  _url=""
  if have curl; then
    _url=$(curl -fsSLI --retry 3 --connect-timeout 15 -o /dev/null -w '%{url_effective}' \
      "$RELEASES_URL/latest" 2>/dev/null) || return 1
  elif have wget; then
    _url=$(wget -q -S --spider --max-redirect=5 "$RELEASES_URL/latest" 2>&1 \
      | sed -n 's/^ *[Ll]ocation: *//p' | tail -n 1 | tr -d '\r') || return 1
  else
    return 1
  fi
  _v="${_url##*/tag/}"
  _v="${_v#v}"
  case "$_v" in
    [0-9]*.[0-9]*.[0-9]*) printf '%s\n' "$_v" ;;
    *) return 1 ;;
  esac
}

# Installed version: the VERSION file written by this script, else `memora --version`.
installed_version() {
  if [ -f "$SHARE_DIR/VERSION" ]; then
    head -n 1 "$SHARE_DIR/VERSION" | tr -d ' \r\n'
    return 0
  fi
  if [ -x "$BIN_DIR/memora" ]; then
    # Older builds have no --version and would start the server, so the probe
    # runs isolated (temp state, loopback, short timeout) and only a printed
    # semantic version is accepted.
    _probe=$(mktemp -d)
    _out=$(cd "$_probe" && MEMORA_STATE="$_probe/state" MEMORA_BIND=127.0.0.1 MEMORA_PORT=0 \
      timeout 3 "$BIN_DIR/memora" --version 2>/dev/null | head -n 1) || true
    rm -rf "$_probe"
    _v=$(printf '%s\n' "$_out" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*' | head -n 1) || true
    if [ -n "$_v" ]; then printf '%s\n' "$_v"; return 0; fi
    printf 'unknown\n'
    return 0
  fi
  printf 'none\n'
}

# Read one Environment=KEY=value from an existing unit (keeps re-runs idempotent).
unit_env() {
  [ -f "$UNIT_FILE" ] || return 0
  sed -n "s/^Environment=$1=//p" "$UNIT_FILE" | tail -n 1
}

repo_root() { (cd "$(dirname "$0")/.." 2>/dev/null && pwd); }

# ------------------------------------------------------------ fetch stage ---
# Fills $PKG with a directory holding memora, memora-cli and assets/.
fetch_release() {
  detect_arch
  if [ -z "$VERSION" ]; then
    info "Looking up the latest release of $REPO"
    VERSION=$(latest_version) || die 4 "could not determine the latest release (network?). Use --version X.Y.Z"
  fi
  NEW_VERSION="$VERSION"
  check_uptodate
  _name="memora-$VERSION-$ARCH-linux"
  _base="$RELEASES_URL/download/v$VERSION"
  info "Downloading $_name.tar.gz"
  if [ "$DRY_RUN" -eq 1 ]; then
    say "[dry-run] download $_base/$_name.tar.gz"
    say "[dry-run] download $_base/SHA256SUMS and verify sha256"
    PKG="$WORK/$_name"
    return 0
  fi
  download "$_base/$_name.tar.gz" "$WORK/$_name.tar.gz" || die 4 "download failed: $_base/$_name.tar.gz"
  download "$_base/SHA256SUMS" "$WORK/SHA256SUMS" || die 4 "download failed: $_base/SHA256SUMS"
  _want=$(awk -v f="$_name.tar.gz" '{ n=$2; sub(/^\*/, "", n); if (n == f) print $1 }' "$WORK/SHA256SUMS")
  [ -n "$_want" ] || die 5 "$_name.tar.gz is not listed in SHA256SUMS"
  if have sha256sum; then
    _got=$(sha256sum "$WORK/$_name.tar.gz" | awk '{print $1}')
  elif have shasum; then
    _got=$(shasum -a 256 "$WORK/$_name.tar.gz" | awk '{print $1}')
  else
    die 5 "sha256sum is not installed; cannot verify the download"
  fi
  [ "$_want" = "$_got" ] || die 5 "checksum mismatch for $_name.tar.gz (expected $_want, got $_got)"
  info "Checksum OK ($_got)"
  tar -xzf "$WORK/$_name.tar.gz" -C "$WORK" || die 1 "could not unpack $_name.tar.gz"
  PKG="$WORK/$_name"
}

fetch_source() {
  _root=$(repo_root)
  if [ ! -f "$_root/Cargo.toml" ] || [ ! -d "$_root/crates" ]; then die 1 "--from-source must run from a Memora checkout (scripts/install.sh)"; fi
  _v=$(sed -n '/^\[workspace.package\]/,/^\[/s/^version *= *"\(.*\)"/\1/p' "$_root/Cargo.toml" | head -n 1)
  NEW_VERSION="${VERSION:-$_v}"
  check_uptodate
  _cargo=$(command -v cargo 2>/dev/null || true)
  if [ -z "$_cargo" ] && [ -n "${SUDO_USER:-}" ]; then
    _home=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    [ -x "$_home/.cargo/bin/cargo" ] && _cargo="$_home/.cargo/bin/cargo"
  fi
  [ -n "$_cargo" ] || die 1 "cargo not found. Install Rust (https://rustup.rs) or use a release"
  info "Building release binaries with $_cargo (this takes a few minutes)"
  if [ -n "${SUDO_USER:-}" ] && [ "$(id -u)" -eq 0 ]; then
    # Build as the invoking user so target/ stays owned by them.
    run sudo -u "$SUDO_USER" -H env "PATH=$(dirname "$_cargo"):$PATH" \
      "$_cargo" build --release --locked --manifest-path "$_root/Cargo.toml"
  else
    run "$_cargo" build --release --locked --manifest-path "$_root/Cargo.toml"
  fi
  PKG="$WORK/pkg"
  run mkdir -p "$PKG"
  run cp "$_root/target/release/memora" "$_root/target/release/memora-cli" "$PKG/"
  run cp -R "$_root/crates/http/assets" "$PKG/assets"
}

fetch_dir() {
  [ -d "$FROM_DIR" ] || die 1 "--from-dir: $FROM_DIR is not a directory"
  for f in memora memora-cli; do
    [ -f "$FROM_DIR/$f" ] || die 1 "--from-dir: $FROM_DIR/$f is missing"
  done
  [ -d "$FROM_DIR/assets" ] || die 1 "--from-dir: $FROM_DIR/assets/ is missing"
  if [ -n "$VERSION" ]; then
    NEW_VERSION="$VERSION"
  elif [ -f "$FROM_DIR/VERSION" ]; then
    NEW_VERSION=$(head -n 1 "$FROM_DIR/VERSION" | tr -d ' \r\n')
  else
    NEW_VERSION="0.0.0-local"
  fi
  check_uptodate
  PKG="$FROM_DIR"
}

check_uptodate() {
  [ "$MODE" = "upgrade" ] || return 0
  if [ "$OLD_VERSION" = "$NEW_VERSION" ] && [ "$FORCE" -eq 0 ]; then
    info "Memora $OLD_VERSION is already installed (use --force to reinstall)"
    RESULT="uptodate"
    exit 3
  fi
}

# ---------------------------------------------------------- install stage ---
# Atomic replace: copy next to the target, then rename over it.
install_bin() { # install_bin <src> <dest>
  run cp "$1" "$2.new.$$"
  run chmod 0755 "$2.new.$$"
  run mv -f "$2.new.$$" "$2"
}

install_files() {
  info "Installing binaries to $BIN_DIR and assets to $ASSETS_DIR"
  run mkdir -p "$BIN_DIR" "$SHARE_DIR"
  install_bin "$PKG/memora" "$BIN_DIR/memora"
  install_bin "$PKG/memora-cli" "$BIN_DIR/memora-cli"

  # Assets: stage a full copy, then swap directories.
  run rm -rf "$ASSETS_DIR.new" "$ASSETS_DIR.old"
  run cp -R "$PKG/assets" "$ASSETS_DIR.new"
  run chmod -R a+rX "$ASSETS_DIR.new"
  if [ -d "$ASSETS_DIR" ] || [ "$DRY_RUN" -eq 1 ]; then run mv "$ASSETS_DIR" "$ASSETS_DIR.old" 2>/dev/null || true; fi
  run mv "$ASSETS_DIR.new" "$ASSETS_DIR"
  run rm -rf "$ASSETS_DIR.old"

  # A copy of this installer, so `memora-cli /update` can run it later.
  # $0 is only this script when it was run from a file, not piped into sh.
  _self=""
  case "$0" in */install.sh|install.sh) [ -f "$0" ] && _self="$0" ;; esac
  if [ -f "$PKG/install.sh" ]; then _self="$PKG/install.sh"; fi
  if [ -n "$_self" ]; then
    install_bin "$_self" "$SHARE_DIR/install.sh"
  else
    # Piped through sh: fetch the matching installer from the repository.
    _ref="main"; [ "$SOURCE" = "release" ] && _ref="v$NEW_VERSION"
    if [ "$DRY_RUN" -eq 1 ]; then
      say "[dry-run] download installer ($_ref) to $SHARE_DIR/install.sh"
    elif download "https://raw.githubusercontent.com/$REPO/$_ref/scripts/install.sh" "$WORK/install.sh"; then
      install_bin "$WORK/install.sh" "$SHARE_DIR/install.sh"
    else
      warn "could not save a copy of install.sh to $SHARE_DIR (memora-cli /update will not work)"
    fi
  fi
  printf '%s\n' "$NEW_VERSION" | write_file "$SHARE_DIR/VERSION" 0644
}

create_user_and_dirs() {
  if [ "$NO_SYSTEMD" -eq 0 ]; then
    if id "$SVC_USER" >/dev/null 2>&1; then
      info "System user $SVC_USER exists"
    else
      info "Creating system user $SVC_USER"
      _nologin=/usr/sbin/nologin; [ -x "$_nologin" ] || _nologin=/sbin/nologin; [ -x "$_nologin" ] || _nologin=/bin/false
      if have useradd; then
        run useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home \
          --shell "$_nologin" --comment "Memora" "$SVC_USER"
      elif have adduser; then
        run addgroup -S "$SVC_USER"
        run adduser -S -D -H -h "$DATA_DIR" -s "$_nologin" -G "$SVC_USER" "$SVC_USER"
      else
        die 1 "neither useradd nor adduser is available to create the $SVC_USER user"
      fi
    fi
  fi
  info "Preparing $DATA_DIR (state: 0700, vault: 0750)"
  run mkdir -p "$STATE_DIR" "$VAULT_DIR"
  run chmod 0750 "$DATA_DIR"
  run chmod 0700 "$STATE_DIR"
  run chmod 0750 "$VAULT_DIR"
  if [ "$NO_SYSTEMD" -eq 0 ]; then
    # Only the top level and the two fresh directories; never rewrite a
    # large vault's ownership on every re-run.
    run chown "$SVC_USER:$SVC_USER" "$DATA_DIR" "$STATE_DIR" "$VAULT_DIR"
  fi
}

write_unit() {
  _caps=""
  if [ "$PORT" -lt 1024 ]; then
    _caps="AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE"
  else
    _caps="AmbientCapabilities=
CapabilityBoundingSet="
  fi
  info "Writing $UNIT_FILE"
  run mkdir -p "$UNIT_DIR"
  write_file "$UNIT_FILE" 0644 <<EOF
# Managed by Memora install.sh; re-running the installer rewrites this file.
# Local changes belong in a drop-in: systemctl edit $UNIT_NAME
[Unit]
Description=Memora - long-term memory for AI agents (HTTP API + MCP + web UI)
Documentation=https://github.com/$REPO
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$DATA_DIR
Environment=HOME=$DATA_DIR
Environment=MEMORA_STATE=$STATE_DIR
Environment=MEMORA_ASSETS=$ASSETS_DIR
Environment=MEMORA_PORT=$PORT
Environment=MEMORA_BIND=$BIND
Environment=MEMORA_VAULT=$VAULT_DIR
Environment=GIT_AUTHOR_NAME=Memora
Environment=GIT_AUTHOR_EMAIL=memora@localhost
Environment=GIT_COMMITTER_NAME=Memora
Environment=GIT_COMMITTER_EMAIL=memora@localhost
Environment=RUST_LOG=info
ExecStart=$BIN_DIR/memora
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
LimitNOFILE=65536
UMask=0027

# Hardening
NoNewPrivileges=yes
$_caps
ProtectSystem=strict
ReadWritePaths=$DATA_DIR
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged

[Install]
WantedBy=multi-user.target
EOF
}

service_active() { [ "$NO_SYSTEMD" -eq 0 ] && have systemctl && systemctl is-active --quiet "$UNIT_NAME" 2>/dev/null; }

# Address to probe the local server on.
probe_host() {
  case "$BIND" in
    0.0.0.0|::|'[::]'|'') printf '127.0.0.1' ;;
    *:*) printf '[%s]' "$BIND" ;;
    *) printf '%s' "$BIND" ;;
  esac
}

start_service() {
  [ "$NO_SYSTEMD" -eq 0 ] || return 0
  run systemctl daemon-reload
  if [ "$NO_START" -eq 1 ]; then
    run systemctl enable "$UNIT_NAME"
    info "Service installed but not started (--no-start): systemctl start $UNIT_NAME"
    return 0
  fi
  run systemctl enable "$UNIT_NAME"
  run systemctl restart "$UNIT_NAME"
  if [ "$DRY_RUN" -eq 0 ]; then
    _i=0
    while [ "$_i" -lt 15 ]; do
      if have curl && curl -fsS -o /dev/null "http://$(probe_host):$PORT/healthz" 2>/dev/null; then
        info "memora is up on port $PORT"
        verify_db
        return 0
      fi
      _i=$((_i + 1)); sleep 1
    done
    systemctl is-active --quiet "$UNIT_NAME" || {
      warn "the service did not start; recent log:"
      journalctl -u "$UNIT_NAME" -n 30 --no-pager >&2 || true
      die 1 "memora.service failed to start"
    }
    warn "the service is running but /healthz did not answer yet; check: journalctl -u $UNIT_NAME"
  else
    say "[dry-run] verify: memora-cli db check (or memora-cli status)"
  fi
}

# The state database (embedded SQLite, $STATE_DIR/memora.db) is created and
# migrated by the server on first start. Confirm it with the console.
verify_db() {
  _cli="$BIN_DIR/memora-cli"
  [ -x "$_cli" ] || return 0
  if "$_cli" help 2>/dev/null | grep -q 'db '; then
    info "Verifying the state database (memora-cli db check)"
    if MEMORA_STATE="$STATE_DIR" timeout 30 "$_cli" db check </dev/null; then return 0; fi
    warn "memora-cli db check reported a problem; see journalctl -u $UNIT_NAME"
  else
    info "Server status (memora-cli status)"
    MEMORA_STATE="$STATE_DIR" timeout 30 "$_cli" status </dev/null || \
      warn "memora-cli status failed; see journalctl -u $UNIT_NAME"
  fi
}

firewall_hint() {
  case "$BIND" in
    127.*|::1|localhost) return 0 ;;
  esac
  say "|"
  say "|  Memora listens on $BIND:$PORT (one TCP port: API + MCP + UI + WS)."
  say "|  Allow only that port through the firewall, for example:"
  say "|    ufw allow $PORT/tcp"
  say "|    firewall-cmd --permanent --add-port=$PORT/tcp && firewall-cmd --reload"
  say "|  Behind a reverse proxy? Re-run with --behind-proxy (binds 127.0.0.1)."
}

next_steps() {
  _host=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo localhost)
  case "$BIND" in 0.0.0.0|::|'[::]') ;; *) _host=$(probe_host) ;; esac
  _url="http://$_host:$PORT/login"
  say ""
  say "+--------------------------------------------------------------------+"
  say "|  Memora $NEW_VERSION installed. Next step:"
  say "|"
  say "|    sudo memora-cli          open the operator console"
  say "|    /guide                   step-by-step first run"
  say "|    /web                     fastest: one-time code, finish in browser"
  say "|"
  say "|  Then open $_url"
  case "$BIND" in
    127.*|::1|localhost)
      say "|  (bound to loopback: reach it through your reverse proxy or an"
      say "|   SSH tunnel: ssh -L $PORT:127.0.0.1:$PORT <server>)" ;;
  esac
  firewall_hint
  say "|  Suggested vault folder: $VAULT_DIR"
  say "+--------------------------------------------------------------------+"
}

# ------------------------------------------------------------------ modes ---
do_check() {
  _latest=$(latest_version) || _latest="unknown"
  printf 'MEMORA_LATEST=%s\n' "$_latest"
  printf 'MEMORA_INSTALLED=%s\n' "$(installed_version)"
  [ "$_latest" != "unknown" ] || exit 4
}

do_install() {
  require_root
  have git || warn "git is not installed; vault history (get_history, diff, restore) needs it: apt install git"
  if [ "$MODE" = "upgrade" ]; then
    [ -x "$BIN_DIR/memora" ] || [ "$DRY_RUN" -eq 1 ] || die 1 "no existing install in $BIN_DIR; run without --upgrade first"
  fi
  # Keep port/bind of an existing install unless given explicitly.
  if [ "$BEHIND_PROXY" -eq 1 ]; then
    if [ -n "$BIND" ] && [ "$BIND" != "127.0.0.1" ]; then
      die 2 "--behind-proxy binds 127.0.0.1; do not combine it with --bind $BIND"
    fi
    BIND=127.0.0.1
  fi
  [ -n "$PORT" ] || PORT=$(unit_env MEMORA_PORT)
  [ -n "$BIND" ] || BIND=$(unit_env MEMORA_BIND)
  [ -n "$PORT" ] || PORT=8400
  [ -n "$BIND" ] || BIND=0.0.0.0
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/memora-install.XXXXXX")
  case "$SOURCE" in
    release) fetch_release ;;
    source)  fetch_source ;;
    dir)     fetch_dir ;;
  esac

  if [ "$MODE" = "upgrade" ]; then
    info "Upgrading Memora $OLD_VERSION -> $NEW_VERSION"
  else
    info "Installing Memora $NEW_VERSION"
  fi
  install_files
  if [ "$MODE" = "install" ] || [ "$NO_SYSTEMD" -eq 1 ] || [ ! -f "$UNIT_FILE" ]; then
    create_user_and_dirs
  fi
  if [ "$NO_SYSTEMD" -eq 0 ]; then
    write_unit
    if [ "$MODE" = "upgrade" ] && ! service_active && [ "$DRY_RUN" -eq 0 ]; then
      run systemctl daemon-reload
      info "Service was not running; left stopped (systemctl start $UNIT_NAME)"
    else
      start_service
    fi
  else
    info "--no-systemd: no unit written. Start it with:"
    say "  MEMORA_STATE=$STATE_DIR MEMORA_VAULT=$VAULT_DIR MEMORA_ASSETS=$ASSETS_DIR \\"
    say "  MEMORA_PORT=$PORT MEMORA_BIND=$BIND $BIN_DIR/memora"
  fi
  if [ "$MODE" = "upgrade" ]; then
    RESULT="ok"
    info "Upgrade complete: $OLD_VERSION -> $NEW_VERSION (state kept in $STATE_DIR)"
  else
    next_steps
  fi
}

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  [ "$DRY_RUN" -eq 1 ] && return 0
  if [ -r /dev/tty ]; then
    printf '%s [y/N] ' "$1" > /dev/tty
    read -r _ans < /dev/tty || return 1
    case "$_ans" in y|Y|yes|YES) return 0 ;; esac
    return 1
  fi
  die 2 "$1 Re-run with --yes to confirm without a terminal."
}

do_uninstall() {
  require_root
  if [ "$NO_SYSTEMD" -eq 0 ] && have systemctl; then
    if [ -f "$UNIT_FILE" ] || [ "$DRY_RUN" -eq 1 ]; then
      info "Stopping and removing $UNIT_NAME"
      run systemctl disable --now "$UNIT_NAME" || true
      run rm -f "$UNIT_FILE"
      run rm -rf "$UNIT_DIR/$UNIT_NAME.d"
      run systemctl daemon-reload
    fi
  fi
  info "Removing binaries and $SHARE_DIR"
  run rm -f "$BIN_DIR/memora" "$BIN_DIR/memora-cli"
  run rm -rf "$SHARE_DIR"
  if [ "$PURGE" -eq 1 ]; then
    confirm "Delete $DATA_DIR (vault notes, users, API keys) for good?" || die 1 "purge cancelled; nothing deleted from $DATA_DIR"
    info "Purging $DATA_DIR"
    run rm -rf "$DATA_DIR"
    if [ "$NO_SYSTEMD" -eq 0 ] && id "$SVC_USER" >/dev/null 2>&1; then
      if have userdel; then run userdel "$SVC_USER" || true; else run deluser "$SVC_USER" || true; fi
      if getent group "$SVC_USER" >/dev/null 2>&1; then
        if have groupdel; then run groupdel "$SVC_USER" || true; fi
      fi
    fi
  else
    info "Kept $DATA_DIR (state and vault). Use --uninstall --purge to delete it."
  fi
  info "Memora removed"
}

MODE_ARGS="--$MODE"; [ "$MODE" = "install" ] && MODE_ARGS=""

case "$MODE" in
  check)     do_check ;;
  uninstall) do_uninstall ;;
  upgrade)   OLD_VERSION=$(installed_version); do_install ;;
  install)   OLD_VERSION=$(installed_version); do_install ;;
esac
