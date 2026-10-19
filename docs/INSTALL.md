# Installing Memora

Memora ships as two binaries plus a folder of web UI assets:

| Piece | Role |
|---|---|
| `memora` | The server: HTTP API, MCP, web UI, and WebSocket on **one TCP port** (default `8400`) |
| `memora-cli` | The operator console. Run it with no arguments for slash commands (`/guide`, `/web`, `/config`, ...) |
| `assets/` | Web UI files, found through `MEMORA_ASSETS` |

There are two supported ways to run it as a service: **native** (systemd, via
`install.sh`) and **Docker** (Compose). On Linux it can also be installed with
**npm**, which is handy for trying it or running it under your own user. All
end the same way: open the console, type `/web`, and finish setup in the
browser.

- [Network exposure](#network-exposure)
- [Native install](#native-install)
- [Docker](#docker)
- [npm](#npm)
- [Reverse proxy](#reverse-proxy)
- [Backups](#backups)
- [Automation: `--check` and `--upgrade`](#automation---check-and---upgrade)

## Network exposure

Memora opens exactly **one TCP port**. The HTTP API, MCP (`/mcp`), the web UI,
and the realtime WebSocket (`/ws`) all share it. The local event intake
`/_bus` answers on the same port but only to loopback clients.

The state database is embedded SQLite (`<state>/memora.db`). The server creates
and migrates it on first start; it opens no port and needs no separate
database server or install.

Nothing else listens. Allow only that one port through the firewall, or none at
all when a reverse proxy on the same host is the entry point
(`--behind-proxy`).

## Native install

Requirements: Linux on x86_64 or aarch64 with systemd, `curl` (or `wget`),
`tar`, `sha256sum`, and `git` (vault history uses it).

```sh
# Inspect first: https://github.com/Codrihub/memora/blob/main/scripts/install.sh
curl -fsSL https://raw.githubusercontent.com/Codrihub/memora/main/scripts/install.sh | sudo sh
```

Pass flags after `sh -s --`, for example:

```sh
curl -fsSL https://raw.githubusercontent.com/Codrihub/memora/main/scripts/install.sh \
  | sudo sh -s -- --version 1.0.0 --behind-proxy
```

or download the script and run it: `sudo sh install.sh --help`.

The script is idempotent: running it again reinstalls the same files and keeps
the port and bind address of the existing unit unless you pass new ones.

### What it does

1. Downloads `memora-<version>-<arch>-linux.tar.gz` for this CPU from GitHub
   Releases (the latest, or `--version`), downloads `SHA256SUMS` from the same
   release, and refuses to continue if the checksum does not match.
2. Installs the binaries atomically (copy to a temp file, then `mv`).
3. Creates the system user and group `memora` (no login shell, home
   `/var/lib/memora`).
4. Creates `/var/lib/memora/state` (`0700`) and `/var/lib/memora/vault`
   (`0750`), owned by `memora`.
5. Writes `/etc/systemd/system/memora.service`, enables and starts it, waits
   for `/healthz`, then verifies the state database with `memora-cli db check`.
6. Prints the next step and, when listening on every interface, a firewall
   hint.

### Paths

| Path | Content |
|---|---|
| `/usr/local/bin/memora`, `/usr/local/bin/memora-cli` | Binaries |
| `/usr/local/share/memora/assets/` | Web UI |
| `/usr/local/share/memora/VERSION` | Installed version (read by `--check`) |
| `/usr/local/share/memora/install.sh` | Copy of the installer, used for `--upgrade`, `--check`, `--uninstall`, and `memora-cli update` |
| `/var/lib/memora/state/` | `memora.db` (owner, API key hashes, sessions, settings, activity log), `backups/` |
| `/var/lib/memora/vault/` | Suggested vault folder (chosen in the browser after the first sign-in) |
| `/etc/systemd/system/memora.service` | The unit |

`--prefix` moves the first four (default `/usr/local`), `--data-dir` moves the
last two (default `/var/lib/memora`).

### Flags

| Flag | Meaning |
|---|---|
| *(none)* | Install or reinstall the latest release |
| `--version X.Y.Z` | Install that release |
| `--from-source` | Build with `cargo build --release --locked` in the checkout the script lives in (`sudo ./scripts/install.sh --from-source`); built as `$SUDO_USER` |
| `--from-dir PATH` | Install `PATH/memora`, `PATH/memora-cli`, `PATH/assets/` (an unpacked release, or your own build). Version from `--version`, else `PATH/VERSION` |
| `--port N` | Port (default `8400`) |
| `--bind ADDR` | Bind address (default `0.0.0.0`) |
| `--behind-proxy` | Bind `127.0.0.1`; a reverse proxy on this host is the only entry |
| `--prefix DIR` | Install prefix (default `/usr/local`) |
| `--data-dir DIR` | Data root (default `/var/lib/memora`) |
| `--no-start` | Install and enable, but do not start |
| `--no-systemd` | Skip the unit and the system user (containers, tests); prints the command to start the server by hand |
| `--upgrade` | Replace binaries and assets, keep state, restart the service if it was running |
| `--force` | With `--upgrade`: reinstall even when already up to date |
| `--uninstall` | Stop and remove the unit, binaries, and assets; keep data |
| `--purge` | With `--uninstall`: also delete the data dir and the `memora` user (asks first) |
| `--check` | Print `MEMORA_LATEST=` and `MEMORA_INSTALLED=`; change nothing |
| `--yes`, `-y` | Never ask (needed for `--purge` without a terminal) |
| `--dry-run` | Print every action, change nothing |
| `--repo OWNER/NAME` | Download from another GitHub repository (forks); also settable as `MEMORA_REPO` |

`MEMORA_RELEASES_URL` points the installer at a mirror that serves the same
layout as GitHub (`<url>/latest`, `<url>/download/vX.Y.Z/<file>`).

Root is required except for `--check`, `--dry-run`, and `--no-systemd` into a
prefix you can write to.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (see the message) |
| `2` | Bad usage |
| `3` | Already up to date (`--upgrade`) |
| `4` | Network or download failure |
| `5` | Checksum mismatch or missing from `SHA256SUMS` |
| `6` | Not running as root |
| `7` | Unsupported OS or CPU |

### The systemd unit

The installer writes this unit (shown with the default paths and port):

```ini
[Unit]
Description=Memora - long-term memory for AI agents (HTTP API + MCP + web UI)
Documentation=https://github.com/Codrihub/memora
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=memora
Group=memora
WorkingDirectory=/var/lib/memora
Environment=HOME=/var/lib/memora
Environment=MEMORA_STATE=/var/lib/memora/state
Environment=MEMORA_ASSETS=/usr/local/share/memora/assets
Environment=MEMORA_PORT=8400
Environment=MEMORA_BIND=0.0.0.0
Environment=MEMORA_VAULT=/var/lib/memora/vault
Environment=GIT_AUTHOR_NAME=Memora
Environment=GIT_AUTHOR_EMAIL=memora@localhost
Environment=GIT_COMMITTER_NAME=Memora
Environment=GIT_COMMITTER_EMAIL=memora@localhost
Environment=RUST_LOG=info
ExecStart=/usr/local/bin/memora
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
LimitNOFILE=65536
UMask=0027

# Hardening
NoNewPrivileges=yes
AmbientCapabilities=
CapabilityBoundingSet=
ProtectSystem=strict
ReadWritePaths=/var/lib/memora
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
```

A port below 1024 adds `CAP_NET_BIND_SERVICE` instead of the empty capability
set. There are no IP restrictions (`IPAddressDeny=`) by default; use the
firewall, `MEMORA_DOMAIN`, or the access rules in the UI.

The installer rewrites the unit on every run. Put local changes in a drop-in:

```sh
sudo systemctl edit memora     # for example, a vault outside /var/lib/memora:
#   [Service]
#   ReadWritePaths=/srv/notes
sudo systemctl restart memora
```

Because of `ProtectSystem=strict` and `ProtectHome=yes`, the server can only
write under `/var/lib/memora`. A vault anywhere else (including `/home`) needs
the drop-in above (and `ProtectHome=read-only` or `no` for `/home`).

### Settings

The unit sets the basics (`MEMORA_STATE`, `MEMORA_ASSETS`, `MEMORA_PORT`,
`MEMORA_BIND`, `MEMORA_VAULT`, `RUST_LOG`) as `Environment=` lines. Everything
else (`MEMORA_BASE_URL`, `MEMORA_DOMAIN`, `MEMORA_TRUSTED_PROXIES`, ...) is
stored in the state database (table `server_config`). Edit it with the
console: `sudo memora-cli` → `/config`, then `/restart`.

A value stored with `/config` wins over the unit's `Environment=` lines; a key
with no stored value uses the environment. If you stored `MEMORA_PORT` with
`/config` and later reinstall with `--port`, change or clear it in `/config`
too, otherwise the stored value keeps applying. The provisioning owner
password and API key are environment-only and never stored (see
[CONFIGURATION.md](CONFIGURATION.md)).

See [CONFIGURATION.md](CONFIGURATION.md) for every variable.

### First run

```sh
sudo memora-cli        # opens the console; it finds the running server itself
/guide                 # step-by-step, or:
/web                   # prints a one-time code
```

Open `http://<host>:8400/login`, enter the code, create the owner account, then
choose the vault folder (`/var/lib/memora/vault` is suggested).

### Day to day

```sh
sudo systemctl status memora
sudo systemctl restart memora
sudo journalctl -u memora -f
sudo memora-cli                 # /status, /keys, /config, /restart, /mcp ...
```

### Upgrading

```sh
sudo /usr/local/share/memora/install.sh --upgrade            # latest release
sudo /usr/local/share/memora/install.sh --upgrade --version 1.0.1
sudo memora-cli update                                       # same, from the console
```

Binaries and assets are swapped atomically, the state directory and vault are
untouched, and the service is restarted if it was running. The server migrates
`memora.db` itself on start. Take a `memora-cli db backup` before upgrading,
and read the [CHANGELOG](../CHANGELOG.md) before a major version bump.

### Uninstall

```sh
sudo /usr/local/share/memora/install.sh --uninstall           # keeps /var/lib/memora and the memora user
sudo /usr/local/share/memora/install.sh --uninstall --purge   # also deletes notes, account, keys, and the user
```

### Firewall

Open only the Memora port, and only when clients connect directly:

```sh
sudo ufw allow 8400/tcp
# or
sudo firewall-cmd --permanent --add-port=8400/tcp && sudo firewall-cmd --reload
```

Behind a reverse proxy on the same host, install with `--behind-proxy` and open
only the proxy's 80/443.

## Docker

```sh
git clone https://github.com/Codrihub/memora.git && cd memora
mkdir -p data state && sudo chown -R 1000:1000 data state
docker compose up -d
docker compose exec -it gateway memora-cli      # then /guide, or /web
```

`docker compose up` pulls `ghcr.io/codrihub/memora:<version>`; if the image is
not available (or you set `IMAGE=memora:local`) it builds from the
`Dockerfile`. Image tags: `<version>` (for example `1.0.0`), `<major>.<minor>`
(for example `1.0`), and `latest` (stable releases only), for `linux/amd64`
and `linux/arm64`. The compose file pins the release it ships with; set
`IMAGE` in `.env` to run another tag.

### Volumes: `/data` and `/state`

Both must be persistent (the Compose file bind-mounts `./data` and `./state`):

- `/data` is the vault: your notes, their git history, the search index, and
  the event log. Lose it and the notes are gone.
- `/state` holds `memora.db` (owner account, password hash, API key hashes,
  sessions, settings, setup/lock state, activity log). Lose it and
  every agent key stops working, the instance falls back to first-run setup,
  and anyone who reaches the port during that window could claim it.

The container runs as uid 1000; set `MEMORA_UID`/`MEMORA_GID` in `.env` if the
host directories belong to another user. `MEMORA_DATA_DIR` and
`MEMORA_STATE_DIR` move the host directories, and `MEMORA_HTTP_PORT` changes
the published host port. See [CONFIGURATION.md](CONFIGURATION.md#docker-compose-env).

### Verify

```sh
curl -s http://127.0.0.1:8400/healthz
docker compose exec gateway memora-cli db check
docker compose exec gateway memora-cli status
ls -l state/memora.db
```

### Upgrading

```sh
git pull
docker compose pull && docker compose up -d     # or: docker compose up -d --build
```

Settings: `docker compose exec -it gateway memora-cli` → `/config`, then
`docker compose restart gateway` (`/restart` cannot restart a container from
inside).

## npm

Requirements: Linux on x86_64 or arm64, Node 18 or newer, and `git` (vault
history uses it).

```sh
npm install -g @codrihub/memora
mkdir -p ~/memora && cd ~/memora
MEMORA_VAULT=./vault MEMORA_STATE=./state memora
# in a second terminal, same folder:
MEMORA_STATE=./state memora-cli                 # then /guide, or /web
```

`npx @codrihub/memora --version` runs it without a global install.

`@codrihub/memora` holds the `memora` and `memora-cli` commands and the web UI
(used unless `MEMORA_ASSETS` is set). The binaries come from
`@codrihub/memora-linux-x64` or `@codrihub/memora-linux-arm64`, optional
dependencies npm installs only on a matching machine. They are the static
binaries of the GitHub release with the same version, so glibc and musl
distributions both work. There is no install script and nothing is downloaded
at install time, so it works with `--ignore-scripts` and from a registry
mirror; it does not work with `--omit=optional`, which leaves the binaries
out. On macOS and Windows the commands print where to go instead: use
[Docker](#docker) or build from source (on Windows, WSL 2 works too).

The npm install sets up no service, user or data folder: the server runs as
you, with `MEMORA_STATE` and `MEMORA_VAULT` where you point them (`./state`
by default). Keep the state folder private (`chmod 700 state`), since it
holds the owner account and key hashes. For a long-running server, prefer the
[native install](#native-install).

Upgrade with `npm install -g @codrihub/memora@latest` (`memora-cli update`
prints this too) and restart the server; the state database is migrated on
start.

## Reverse proxy

Run Memora on loopback (`--behind-proxy` natively; in Docker set
`MEMORA_HTTP_PORT=127.0.0.1:8400` in `.env`) and let the proxy terminate TLS.
Then set, with `/config` or in `.env`:

| Variable | Why |
|---|---|
| `MEMORA_BASE_URL=https://memory.example.com` | Public URL; links and MCP snippets use it, and its host becomes an allowed domain |
| `MEMORA_DOMAIN=memory.example.com` | Only these hostnames are served; requests for the bare IP or other names get 404 |
| `MEMORA_TRUSTED_PROXIES=203.0.113.10` | Proxies whose forwarding headers are believed. Loopback (same-host nginx, cloudflared) is always trusted; only list remote proxies |

In Docker, a proxy on the host reaches the container through the Docker
network, so the container sees the network's gateway address (for example
`172.18.0.1`) instead of loopback. Add that address to
`MEMORA_TRUSTED_PROXIES`, otherwise every request appears to come from it.

The proxy must forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`, and
upgrade WebSockets on `/ws`. nginx and Caddy examples are in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Backups

Back up **both** the state database and the vault. The database is small but
critical.

State, online (the server keeps running):

```sh
sudo memora-cli db backup                     # state/backups/memora-<UTC time>.db, keeps the newest 10
sudo memora-cli db backup --to /var/backups/memora.db
sudo memora-cli db check                      # integrity, permissions, sizes, last backup age
docker compose exec gateway memora-cli db backup   # Docker: lands in ./state/backups/
```

The copy is a consistent snapshot (`VACUUM INTO`), checked with
`integrity_check`, mode 0600. Never `cp` a live `memora.db`: recent commits sit
in `memora.db-wal`. Restore with the server stopped:

```sh
sudo systemctl stop memora
sudo memora-cli db restore /var/backups/memora.db   # verifies it; keeps the replaced DB in state/backups/
sudo systemctl start memora
```

Also keep a copy of `state/key-seal.bin`, which encrypts the sealed API key
copies. Vault and state together: archive both with the server stopped:

```sh
sudo systemctl stop memora
sudo tar -C /var/lib/memora -czf memora-backup-$(date +%F).tar.gz state vault
sudo systemctl start memora
```

Keep backups private: the database holds password and key hashes (never
plaintext secrets).

## Automation: `--check` and `--upgrade`

These are the contract for scripts and automation.

```sh
$ /usr/local/share/memora/install.sh --check
MEMORA_LATEST=1.0.1
MEMORA_INSTALLED=1.0.0
```

`MEMORA_INSTALLED` comes from `/usr/local/share/memora/VERSION` (written by
the installer), else from `memora --version`, else `unknown` (or `none` when
nothing is installed). `MEMORA_LATEST` is `unknown` and the exit code `4` when
GitHub cannot be reached. `--check` needs no root.

```sh
$ sudo /usr/local/share/memora/install.sh --upgrade --yes [--version X.Y.Z]
...
MEMORA_UPGRADE_RESULT=ok FROM=1.0.0 TO=1.0.1
```

`--upgrade --yes` never prompts. The last line of output is always
`MEMORA_UPGRADE_RESULT=<ok|uptodate|error> FROM=<old> TO=<new>`, and the exit
code is `0` (ok), `3` (already up to date), `4` (network), `5` (checksum),
`6` (not root), or `1`/`2` for other errors.
