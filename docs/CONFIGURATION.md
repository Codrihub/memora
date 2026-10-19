# Configuration

All server state, settings included, lives in one SQLite database,
`<MEMORA_STATE>/memora.db` (see [DATABASE.md](DATABASE.md)). Server settings are
rows in the `server_config` table, edited with `memora-cli` (`/config` in the
console). The process environment (systemd `Environment=`, Docker
`environment:`) applies to every key that has no row.

## Precedence

For each server setting:

1. a row in `server_config` (set with `/config`), else
2. the process environment (non-empty value), else
3. the built-in default.

The server reads `server_config` once at startup, before anything else, so a
change made with `/config` applies after a restart (`/restart` for a native
install, `docker compose restart gateway` in Docker). Clearing a value in
`/config` deletes the row, and the environment or default applies again.

A row wins over the environment. If you set `MEMORA_PORT` with `/config` and
later change the port in the systemd unit or `.env`, the row still applies
until you clear it.

## Server settings

| Name | Default | Where it can live | What it does |
|---|---|---|---|
| `MEMORA_PORT` | `8400` | `server_config` or env | HTTP port (API, MCP, web UI, WebSocket). 1-65535. |
| `MEMORA_BIND` | `127.0.0.1` | `server_config` or env | Bind address. `0.0.0.0` for every interface (the container image and the installer set it). |
| `MEMORA_BASE_URL` | empty | `server_config` or env | Public URL, for example `https://memory.example.com`. Used for OAuth metadata and connection snippets; its host is also an allowed domain. |
| `MEMORA_DOMAIN` | empty (any host) | `server_config` or env | Allowed hostnames, comma separated (`*.example.com` works). Requests for other hosts get 404. Loopback names are always allowed. |
| `MEMORA_TRUSTED_PROXIES` | empty | `server_config` or env | IPs of remote reverse proxies whose forwarding headers are trusted. Loopback is always trusted. |
| `MEMORA_ARM_TTL` | `300` | `server_config` or env | Accepted and validated (30-86400 seconds), but the server and `memora-cli` do not read it: the setup / reset window length comes from `memora-cli --minutes` (default 5 minutes). |
| `MEMORA_VAULT` | empty (`data` as last resort) | `server_config` or env | Suggested vault folder. The vault in use is chosen in the browser (or with `memora-cli vault`) and stored in the `settings` table. |
| `MEMORA_VAULT_AUTO` | `false` | `server_config` or env | `true` (also `1`, `yes`, `on`): use `MEMORA_VAULT` at startup instead of asking in the browser, only while no vault is configured and if the folder is writable. |
| `MEMORA_ADMIN_USER` | `admin` | `server_config` or env | Name of the owner created at startup when no owner exists (needs `MEMORA_ADMIN_PASSWORD`). |
| `RUST_LOG` | `info` | `server_config` or env | Log filter, for example `info` or `memora=debug`. |

`server_config` accepts only these ten keys. Values are trimmed and validated
(numbers in range, `true`/`false`, a valid user name, no control characters, at
most 2048 bytes).

## Environment only

| Name | Default | What it does |
|---|---|---|
| `MEMORA_ADMIN_PASSWORD`, `MEMORA_ADMIN_PASSWORD_FILE` | unset | Creates the owner at startup when none exists (at least 10 characters). Only the argon2id hash is stored; an existing owner is never replaced. |
| `MEMORA_API_KEY`, `MEMORA_API_KEY_FILE` | unset | Installs an agent API key with id `k_env` and scopes `mcp`, `read`, `write` (at least 24 characters). Only its SHA-256 is stored; the key is replaced when the value changes. |
| `MEMORA_STATE` | `state` (relative to the working directory) | State directory holding `memora.db`. Created with mode 0700 if missing. |
| `MEMORA_ASSETS` | the `crates/http/assets` folder of the build tree | Directory of the web UI assets. |
| `MEMORA_SETUP_HINT` | `memora-cli setup (run on the server)` | Hint returned by `GET /api/auth/state` and shown on the login screen. |
| `MEMORA_UPDATE_CHECK` | `true` | Release check: shortly after start and then every 6 hours the server asks GitHub (`api.github.com/repos/Codrihub/memora/releases/latest`) for the newest release and the web UI shows when an update is available. `false` (also `0`, `no`, `off`) turns it off; no network call is made. |

The two secrets can never be stored in `server_config` (the schema rejects
them). The `_FILE` variants read the value from a file, for example a Docker
secret; a non-empty file wins over the plain variable.

In `/config`, `MEMORA_API_KEY` offers to create an API key directly, and
`MEMORA_ADMIN_PASSWORD` points to `/setup` or `/reset`.

## Instance settings (web UI)

The `settings` table holds one row, edited from the Settings page of the web UI:

| Key | Default | Range | What it does |
|---|---|---|---|
| `realm` | `Memora` | 1-64 characters | Instance name shown in the UI and reported by `/api/config` and `/api/auth/state`. |
| `session_ttl` | `10800` (3 hours) | 300-2592000 seconds | Idle timeout of a browser session. |
| `session_max_age` | `0` | `0` or at least `session_ttl` | Absolute session lifetime in seconds. `0` means no cap. |
| `min_password_len` | `10` | 10-256 | Minimum owner password length. |
| `log_max_mb` | `8` | 1-512 | Size limit in MB of the vault event log (`.events.jsonl`). |
| `log_max_days` | `0` | 0-3650 | Age limit in days of the vault event log. `0` means no age limit. |
| `vault_path` | unset | absolute path | The vault folder. Set in the browser after the first sign-in, or with `memora-cli vault PATH`. |

## memora-cli options

| Option | Default | What it does |
|---|---|---|
| `--state <DIR>` | `$MEMORA_STATE`, else the state directory of the running `memora` server, else `./state` | State directory to work on. |
| `--minutes <N>` | `5` | Window length for `setup` and `reset-password`, 1-60. |
| `--ttl <SECONDS>` | | Window length in seconds (at most 3600). `--minutes` wins when both are given. |
| `--create` | | With `vault PATH`: create the folder if it does not exist. |

Run as root, `memora-cli` does all database work as the owner of the state
directory, so no root-owned `memora.db*` files appear. See
[INSTALL.md](INSTALL.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for the commands.

## Docker Compose (`.env`)

These variables are read by `docker-compose.yml`, not by Memora itself:

| Name | Default | What it does |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `memora` | Compose project name, also the container name prefix. |
| `IMAGE` | `ghcr.io/codrihub/memora:<version>` | Image to run or build. The compose file pins the release it ships with. |
| `MEMORA_HTTP_PORT` | `8400` | Host port mapped to the container's port 8400. Use `127.0.0.1:8400` to publish on loopback only. |
| `MEMORA_DATA_DIR` | `./data` | Host path mounted at `/data` (the vault). |
| `MEMORA_STATE_DIR` | `./state` | Host path mounted at `/state` (the state directory). |
| `MEMORA_UID`, `MEMORA_GID` | `1000` | uid:gid the container runs as. Must own both host directories. |
| `MEMORA_ARM_TTL` | `300` | Passed to the container unchanged. |

Compose also passes these through from `.env` to the container:
`MEMORA_BASE_URL`, `MEMORA_DOMAIN`, `MEMORA_TRUSTED_PROXIES`,
`MEMORA_VAULT_AUTO`, `MEMORA_ADMIN_USER`, `MEMORA_ADMIN_PASSWORD`,
`MEMORA_ADMIN_PASSWORD_FILE`, `MEMORA_API_KEY`, `MEMORA_API_KEY_FILE`,
`MEMORA_SETUP_HINT`, `MEMORA_UPDATE_CHECK`, and `RUST_LOG`.

Inside the container the image sets `MEMORA_VAULT=/data`,
`MEMORA_STATE=/state`, `MEMORA_PORT=8400`, `MEMORA_BIND=0.0.0.0`,
`MEMORA_ARM_TTL=300`, `MEMORA_ASSETS=/app/assets`, and `RUST_LOG=info`.

## State directory

| Path | Content |
|---|---|
| `memora.db` (+ `-wal`, `-shm`) | The state database: owner, API keys (hashes), tool switches and per-key permissions, OAuth clients and grants, privacy rules, sessions (hashed ids), setup window and lock state, access rules, settings, `server_config`, activity log. Mode 0600, WAL mode, must be on a local filesystem. See [DATABASE.md](DATABASE.md). |
| `key-seal.bin` | 32-byte master key (mode 0600) that encrypts the copies of dashboard-created API keys, so the owner can show a key again. Created on first use. Back it up together with `memora.db`. |
| `backups/` | `memora-cli db backup` output (newest 10 kept by default). |
| `exchange/` | Zips written by the `export_memory` MCP tool and read by `import_memory` (mode 0700, created on first use). Private to this instance; delete old zips when no longer needed. |
| `legacy-json-<unix time>/` | JSON state files found at startup, moved here after their one-time import into `memora.db`. |
| `internal.token` | Created by the Docker entrypoint. Not used by Memora. |

## Vault files

The vault holds the markdown notes plus derived and metadata files. See
[ARCHITECTURE.md](ARCHITECTURE.md#vault-markdown-portable) for the full list.
The important ones for operations are `.git/` (history), `.fts.db`
(rebuildable search index), `.events.jsonl` (event log), and `.Trash/`
(soft-deleted notes).
