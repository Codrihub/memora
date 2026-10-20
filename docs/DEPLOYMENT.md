# Deployment

This guide covers health checks, running Memora behind a reverse proxy, in a
container, and under systemd, first-run and recovery, backups, and upgrades.
For the installer and the Compose quick start, see [INSTALL.md](INSTALL.md);
for every setting, see [CONFIGURATION.md](CONFIGURATION.md).

## Health check

`GET /healthz` is public, never rate limited, and reachable even while the
instance is LOCKED. An outside caller gets only:

```json
{ "ok": true, "server": "memora" }
```

A caller on the same machine (loopback) or a signed-in browser gets more
detail:

```json
{
  "ok": true,
  "server": "memora",
  "version": "1.0.0",
  "vault_configured": true,
  "vault": "/var/lib/memora/vault",
  "armed": false,
  "locked": false,
  "base_url": "https://memory.example.com",
  "base_url_configured": true
}
```

Use it for container health checks and load balancer probes. Run locally, it
also tells you whether a setup window is open or the instance is locked.

## Reverse proxy

The `memora` binary binds `127.0.0.1` by default, which is the intended setup
behind a proxy on the same host (`install.sh --behind-proxy` does the same).
Bind `0.0.0.0` only when clients connect directly.

On the proxy:

- Forward `Host`, and append the client IP to `X-Forwarded-For`.
  Memora reads the right-most `X-Forwarded-For` entry that is not itself a
  trusted proxy; only when there is none does it fall back to
  `CF-Connecting-IP`, then `X-Real-IP`. Forwarding headers count only when the
  connection comes from a trusted proxy. Loopback is always trusted; list any
  other proxy address in `MEMORA_TRUSTED_PROXIES`. A loopback address in a
  header is ignored, so no outside caller can pass as local.
- Forward `X-Forwarded-Proto: https`. From a trusted proxy, it makes Memora mark
  the session cookie `Secure` and send HSTS.
- Upgrade WebSockets on `/ws` and allow long-lived connections there.

Set `MEMORA_BASE_URL` to the public URL (OAuth clients and connection snippets
use it) and, optionally, `MEMORA_DOMAIN` to refuse requests for other
hostnames.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name memory.example.com;

    location / {
        proxy_pass http://127.0.0.1:8400;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8400;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
}
```

### Caddy

```
memory.example.com {
    reverse_proxy 127.0.0.1:8400
}
```

Caddy handles WebSocket upgrades and the `X-Forwarded-*` headers itself.

## Running in a container

The repository ships a `Dockerfile` and a `docker-compose.yml`;
[docker/README.md](../docker/README.md) is the short practical guide. The
essentials:

```sh
mkdir -p data state && sudo chown -R 1000:1000 data state
docker compose up -d
curl -s http://127.0.0.1:8400/healthz
docker compose exec -it gateway memora-cli      # then /guide, or /web
```

The container runs as uid:gid 1000:1000 by default. Set `MEMORA_UID` and
`MEMORA_GID` in `.env` to match the owner of the host vault and state
directories. If the container cannot write to them, the entrypoint stops and
prints the container uid and the directory owner. A root-owned bind mount is
the most common startup failure.

Inside the container, the vault is `/data` and the state directory is
`/state`, bind-mounted from `MEMORA_DATA_DIR` and `MEMORA_STATE_DIR` (default
`./data` and `./state`). Port `8400` is the only port: the HTTP API, MCP, the
UI, and the WebSocket share it. `MEMORA_HTTP_PORT` sets the host side of the
mapping.

Behind a proxy on the host, publish on loopback only
(`MEMORA_HTTP_PORT=127.0.0.1:8400`). The container then sees the proxy as the
Docker network's gateway address, so add that address to
`MEMORA_TRUSTED_PROXIES`.

The entrypoint also accepts `setup`, `reset-password`, `status`, `unlock`,
`list`, and `cli <args>` as the container command, for one-off runs such as
`docker compose run --rm gateway cli db check`.

### Restricted container runtimes

Some hosts run containers inside another sandbox that does not grant full
kernel privileges. The container runtime can then fail before Memora starts,
with errors such as:

```
apparmor_parser: Access denied. You need policy admin privileges.
```

or:

```
runc create failed: unable to start container process: error during container init:
open sysctl net.ipv4.ip_unprivileged_port_start file: reopen fd 8: permission denied
```

These come from the runtime loading an AppArmor profile and writing network
sysctls, not from anything Memora needs. If you control the runtime, run the
container with AppArmor unconfined (when the outer sandbox already confines
it) and without the optional network sysctls, or use a wrapper runtime that
removes those fields from the OCI spec. Do not use `--privileged`: it is not
required and does not fix either cause.

## systemd

`install.sh` writes a hardened unit to `/etc/systemd/system/memora.service`;
its full contents are in [INSTALL.md](INSTALL.md#the-systemd-unit). Put local
changes in a drop-in (`sudo systemctl edit memora`), because the installer
rewrites the unit on every run.

For a manual install, a minimal unit looks like this:

```ini
[Unit]
Description=Memora memory vault
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=memora
Group=memora
WorkingDirectory=/var/lib/memora
Environment=HOME=/var/lib/memora
Environment=MEMORA_STATE=/var/lib/memora/state
Environment=MEMORA_VAULT=/var/lib/memora/vault
Environment=MEMORA_ASSETS=/usr/local/share/memora/assets
Environment=MEMORA_BIND=127.0.0.1
Environment=MEMORA_PORT=8400
Environment=RUST_LOG=info
ExecStart=/usr/local/bin/memora
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/memora

[Install]
WantedBy=multi-user.target
```

Memora needs write access to the vault and the state directory, and `git` on
the `PATH` for vault history. Then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now memora
sudo memora-cli setup
```

Run as root, `memora-cli` finds the running server's state directory and does
its database work as the owner of that directory.

## First-run and recovery

The CLI opens a short window and the browser completes it:

```sh
memora-cli setup                 # first-run window, prints a one-time code
memora-cli reset-password        # password reset window, prints a one-time code
memora-cli setup --minutes 10    # longer window (1-60 minutes, default 5)
memora-cli status                # state dir, vault, owner, window, and lock
memora-cli disarm                # close an open window without locking
memora-cli unlock                # lift the lock; the owner account stays as it is
memora-cli list                  # the owner and the API keys
memora-cli clear-cooldowns       # clear login cooldowns in the running server
```

In the console (`memora-cli` with no arguments), `/web` does the same as
`setup` or `reset-password`, and `/guide` walks through the first run.

Then open `/login`, enter the code, and fill in the form before the window
closes. A wrong code closes the window; open a new one. If a window expires
unfinished, the instance locks: API and MCP return `423` and pages go to the lock screen until
`setup`, `reset-password`, or `unlock` runs. This keeps an unclaimed instance
from being taken over by whoever reaches the port first.

## Backups

Back up both the state directory and the vault.

State: one SQLite database, `memora.db`, holding the owner, API keys,
sessions, settings, access and privacy rules, OAuth grants, and the activity
log, plus `key-seal.bin`. It is small but critical: losing it means losing the
account and every API key. Back it up online with the CLI; never `cp` a live
database, because recent commits sit in `memora.db-wal`:

```sh
sudo memora-cli db backup --to /var/backups/memora-state-$(date +%F).db
sudo memora-cli db check            # exit status 1 on any problem
```

Without `--to`, backups go to `state/backups/` and the newest 10 are kept
(`--keep N`). A daily systemd timer or cron job running `memora-cli db backup`
is enough; encrypt copies that leave the host. See
[DATABASE.md](DATABASE.md#operations) for details.

Vault: the markdown notes and their git history. Copy the directory, or use
git:

```sh
git -C /var/lib/memora/vault bundle create /var/backups/memora-vault-$(date +%F).bundle --all
```

`.events.jsonl` is the event log. (`.fts.db`, the search index of older
versions, is no longer used and is removed automatically.)

With Docker Compose, both live in the host directories, so an archive taken
with the container stopped covers everything:

```sh
docker compose stop gateway
tar -czf memora-$(date +%F).tar.gz data state
docker compose start gateway
```

### Restore

Stop the service, restore the database with `memora-cli db restore FILE` (it
verifies the file and keeps the replaced database in `state/backups/`), put
back `key-seal.bin` and the vault, then start the service again.

If you restore only the vault and start with an empty state directory, Memora
has no account and expects a new first-run setup; the notes are intact.

## Upgrades

Native: `sudo /usr/local/share/memora/install.sh --upgrade` or
`sudo memora-cli update` (see [INSTALL.md](INSTALL.md#upgrading)).

Docker: pull the new image and recreate the container:

```sh
docker compose pull && docker compose up -d
```

The server migrates `memora.db` on start. Take a `memora-cli db backup` first:
a database migrated by a newer release cannot be opened by an older one.
