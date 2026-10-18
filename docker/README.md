# Memora in Docker

One image, one port. The image contains both binaries: `memora` (the server:
HTTP API, MCP, web UI, and WebSocket on port 8400) and `memora-cli` (the
operator console). Released images: `ghcr.io/codrihub/memora:<version>`,
`<major>.<minor>`, and `latest`, for `linux/amd64` and `linux/arm64`.

## Run

```bash
cp .env.example .env                           # optional
mkdir -p data state && sudo chown -R 1000:1000 data state
docker compose up -d
docker compose exec -it gateway memora-cli     # console: type /guide, or /web
```

`/web` prints a one-time code. Open `http://<host>:8400/login`, enter the code,
create the owner account, and choose the vault folder (`/data`).

Check it:

```bash
curl -s http://127.0.0.1:8400/healthz
docker compose exec gateway memora-cli db check   # or: memora-cli status
ls -l state/memora.db                             # created on first start
```

## Volumes

Both must be persistent; the Compose file bind-mounts host directories.

| Container path | Host (default) | Content |
|---|---|---|
| `/data` | `./data` (`MEMORA_DATA_DIR`) | The vault: notes, git history, search index, activity log |
| `/state` | `./state` (`MEMORA_STATE_DIR`) | `memora.db` (embedded SQLite: owner, API key hashes, sessions, settings, setup/lock state, activity log), `backups/` |

Losing `/state` signs everyone out, invalidates every agent key, and puts the
instance back into first-run setup. Back up both (see
[../docs/INSTALL.md](../docs/INSTALL.md#backups)). The database can be backed up
while the container runs:

```bash
docker compose exec gateway memora-cli db backup   # ./state/backups/memora-<UTC time>.db
docker compose exec gateway memora-cli db check
```

`/state` must be a local filesystem (SQLite WAL needs shared memory; not NFS or
SMB).

The container runs as uid 1000. Set `MEMORA_UID` and `MEMORA_GID` to the owner
of the host directories if they differ; otherwise the entrypoint refuses to
start and prints the mismatch.

## Console and one-shot commands

```bash
docker compose exec -it gateway memora-cli             # interactive console
docker compose exec gateway memora-cli status
docker compose exec gateway setup                      # open a setup window (non-interactive)
docker compose exec gateway setup reset-password
docker compose exec gateway setup unlock
```

Change settings with `/config` in the console, then
`docker compose restart gateway`. They are stored in `memora.db` and win over
the `environment:` values from `.env`; clear a value in `/config` to fall back
to the environment.

## Network

Only port 8400 is published (`MEMORA_HTTP_PORT` on the host). Behind a reverse
proxy on the same host, publish it on loopback only: `MEMORA_HTTP_PORT=127.0.0.1:8400`
in `.env`, and set `MEMORA_BASE_URL`, `MEMORA_DOMAIN`, and (for remote proxies)
`MEMORA_TRUSTED_PROXIES`.

## Upgrade

```bash
docker compose pull && docker compose up -d
```

The server migrates the state database on start; JSON state files from an
older release are imported once and moved to `/state/legacy-json-<unix time>/`.
Run `memora-cli db backup` before upgrading. See
[../CHANGELOG.md](../CHANGELOG.md) for what changed.

## Build locally

```bash
docker compose build                       # uses ../Dockerfile
IMAGE=memora:local docker compose up -d --build

# multi-arch
docker buildx build --platform linux/amd64,linux/arm64 -t memora:local .
```

`docker/Dockerfile.release` is used by the release workflow only: it packages
the static binaries built by CI instead of compiling again.

UI assets are read from disk at `/app/assets`, so they can be replaced without
rebuilding the image.

## Configuration

Values come from `.env` (see `.env.example`); a value stored with `/config`
wins over the same key from `.env`. The ones that matter most:
`IMAGE`, `MEMORA_HTTP_PORT` (host port), `MEMORA_DATA_DIR` and `MEMORA_STATE_DIR`
(host paths), `MEMORA_UID` and `MEMORA_GID`, and `MEMORA_ARM_TTL`. Keep
`MEMORA_PORT` at 8400 inside the container: the port mapping and the
healthcheck expect it. See
[../docs/CONFIGURATION.md](../docs/CONFIGURATION.md) for the full list.
