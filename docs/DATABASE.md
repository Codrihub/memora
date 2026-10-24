# State database

Memora keeps all server state in one embedded SQLite file,
`<MEMORA_STATE>/memora.db`, managed by the `memora-state` crate. The vault
(markdown notes plus git) is separate and stays plain files.

No SQL lives outside `crates/state`. The server (`memora`) and the operator
console (`memora-cli`) both open the file directly; there is no database
server, port, or password.

## Files and permissions

| Path | Mode | Content |
|---|---|---|
| `<state>/` | 0700 | The state directory. Created if missing; its mode is tightened on open. |
| `memora.db` | 0600 | The database. |
| `memora.db-wal`, `memora.db-shm` | 0600 | WAL journal and shared memory. Part of the live database; never copy `memora.db` without them while the server runs. |
| `key-seal.bin` | 0600 | Master key for the sealed API key copies (`api_key_secret`). Not inside the database. |
| `backups/` | 0700 | Output of `memora-cli db backup` and the pre-restore snapshot. |
| `legacy-json-<unix time>/` | 0700 | JSON state files found at startup, moved here after their one-time import. |

The state directory must be on a local filesystem. WAL needs shared memory
and does not work on NFS or SMB; the server refuses to start when WAL cannot be
enabled.

Run as root, `memora-cli` does every database operation as the owner of the
state directory (in a child process that drops privileges), so no root-owned
`memora.db*` files appear and the server can always open them.

## Connection settings

Every connection, server and CLI, uses: `journal_mode=WAL`,
`synchronous=FULL`, `foreign_keys=ON`, `busy_timeout`, `secure_delete=ON`
(deleted rows are zeroed), `trusted_schema=OFF`, SQLite defensive mode, and a
4 MiB `journal_size_limit`.

The file is marked with `PRAGMA application_id = 0x4D454D4F` (`MEMO`). Memora
refuses to open a file with another application id, or one whose
`user_version` is newer than the binary supports.

## Schema

Conventions: times are `INTEGER` unix seconds UTC; booleans are
`INTEGER CHECK (x IN (0,1))`; every table is `STRICT`. Constraints (CHECK,
UNIQUE, foreign keys, triggers) reject invalid data at the database level; the
Rust repositories validate first to return readable errors. The DDL is in
`crates/state/migrations/*.sql`.

### Auth and settings

| Table | Content |
|---|---|
| `meta` | Key/value markers (for example the legacy import marker). |
| `owner` | The single owner account: `id` is always 1, so a second account is impossible. Lowercase username (1-32 chars of `a-z0-9._-`), argon2id password hash, display name, timestamps. |
| `settings` | One row (`id = 1`): `realm`, `session_ttl`, `session_max_age`, `min_password_len`, `log_max_mb`, `log_max_days`, `vault_path` (absolute or NULL). Ranges are listed in [CONFIGURATION.md](CONFIGURATION.md#instance-settings-web-ui). |
| `server_config` | Server settings that override the environment. Only the ten known keys are accepted, with range checks for `MEMORA_PORT`, `MEMORA_ARM_TTL`, and `MEMORA_VAULT_AUTO`. `MEMORA_ADMIN_PASSWORD` and `MEMORA_API_KEY` cannot be stored. |
| `arm_state` | One row: `idle`, `armed`, or `locked`, the window mode (`bootstrap` or `reset`), start time, length (30-86400 s), the SHA-256 of the one-time code, lock time, and the last burned window. Checks make an armed row without a code, or a code outside an armed window, impossible. |
| `session` | Browser sessions keyed by `sid_hash`, the SHA-256 of the cookie value (the cookie itself is never stored). Source, alias, IP, user agent, `created_at`, `last_seen`. The CLI addresses sessions by a prefix of at least 8 characters of `sid_hash`. |

### API keys and tools

| Table | Content |
|---|---|
| `api_key` | `id` (`k_...`), name, SHA-256 hex `hash` (unique), display `prefix`, `enabled`, `tools_all`, `color` (`#rrggbb` or NULL), `created_at`, `deleted_at` (trash). `grace_until` is unused and always NULL. |
| `api_key_scope` | Scopes per key: `mcp`, `read`, `write`, `admin`. |
| `api_key_tool` | Allowed tools per key, only when `tools_all = 0` (a trigger enforces this and clears the list when `tools_all` is set back to 1). |
| `api_key_secret` | Optional sealed copy of a dashboard-created key: `base64url(nonce || ChaCha20-Poly1305 ciphertext)` under `key-seal.bin`. |
| `api_key_usage` | Last use, last IP, and use count per key. Separate from `api_key` so usage flushes do not trigger a key reload. |
| `api_key_event` | Per-request key events (time, IP, tool or route, path). Used for activity views and new-IP detection. |
| `tool` | Mirror of the MCP tool catalog, synced at server start. Tools missing from the catalog are marked `retired`. |
| `tool_disabled` | Globally disabled tools (foreign key to `tool`). |

### OAuth

| Table | Content |
|---|---|
| `oauth_client` | Registered clients: `client_id`, name, redirect URIs (JSON array), kind (`dcr`, `cimd`, or `manual`). |
| `oauth_code` | One-time authorization codes (SHA-256), PKCE S256 challenge, redirect URI, resource, expiry. |
| `oauth_grant` | Refresh tokens (SHA-256), one per connection, rotated on every use. Each grant points at the API key that serves as its access token and is deleted with it. |

### Access, privacy, and logs

| Table | Content |
|---|---|
| `access_policy` | One row: the default action when no rule matches. |
| `access_rule` | Ordered rules (`position`): kind (`ip`, `range`, `cidr`, `domain`, `all`), value, `allow` or `block`, enabled flag, note. |
| `privacy_rule` | Hides a vault path from agents: kind `folder` (the folder and everything below it) or `node` (one note), mode `deny` (hidden from the listed keys) or `allow_only` (hidden from every key not listed). Paths are vault-relative and matched case-insensitively. |
| `privacy_rule_key` | Keys a privacy rule lists. |
| `privacy_trail` | Earlier paths of a rule after renames and moves (at most 64 per rule), used only to keep log and event lines that name the item away from hidden agents. |
| `activity` | Audit log: time, event name, IP, actor (username, key id, or `cli`), detail. |
| `control_request` | Requests from `memora-cli` to the running server for state that lives in server memory (`limiter_reset`, `reload_all`), with an acknowledgement (`done_at`, `result`). |
| `ui_layout` | One JSON document per web UI layout name (canvas positions, pinned graph positions), at most 512 KiB each. |
| `pin` | The owner's pinned notes and folders in sidebar order (`position`): kind `note` or `folder`, vault-relative path. At most 200. Renames, moves and deletes done by Memora rewrite or drop them in the same transaction. |
| `revision` | One counter per cache domain (`auth`, `keys`, `tools`, `access`, `settings`, `arm`), bumped by triggers. |

Revision triggers (one per insert, update, and delete) map tables to domains:
`owner` to `auth`; `api_key`, `api_key_scope`, `api_key_tool` to `keys`;
`tool_disabled` to `tools`; `access_policy`, `access_rule` to `access`;
`settings`, `server_config` to `settings`; `arm_state` to `arm`. Sessions,
usage, events, activity, OAuth, privacy rules, pins, and UI layouts have no revision
and are read from the database when needed.

## Concurrency and change detection

- Every write is one transaction started with `BEGIN IMMEDIATE`, so the server
  and `memora-cli` can write at the same time without losing updates.
  `busy_timeout` makes a concurrent writer wait instead of failing.
  Multi-step changes are atomic, for example a password change also deletes the
  other sessions and writes the activity row in the same transaction.
- The server keeps caches of the owner, keys, tools, access stack, settings,
  and arm window. It checks `PRAGMA data_version` on requests and at least once
  a second; when another connection committed, it reads `revision` and reloads
  only the changed domains. Changes made with `memora-cli` therefore apply on
  the next request, without a restart. `server_config` is the exception: it is
  read at startup.
- Sessions are not cached: each request looks up `session.sid_hash`, so a
  sign-out from the CLI applies on the next request.
- Hot-path writes are buffered: session `last_seen` is flushed every 5 seconds
  and key usage every 30 seconds. Pending control requests are served every 2
  seconds. Buffers are flushed on shutdown.
- Window expiry is a conditional update (`armed` to `idle`, never `locked`), and a setup code
  is checked and consumed in the same transaction, so a code works at most
  once.

Kept in memory on purpose: rate-limit token buckets and login cooldowns (a
restart resets them; cooldown starts are still written to `activity`), the
trusted proxy list, and the caches above.

## Retention

The server prunes in small batches every hour, and `memora-cli db vacuum` runs
the same pruning:

| Data | Kept |
|---|---|
| `activity` | 365 days, at most 200,000 rows |
| `api_key_event` | 30 days, at most 100,000 rows |
| `session` | Until idle longer than `session_ttl` or older than `session_max_age` |
| Trashed `api_key` rows | 90 days after `deleted_at` (scopes, tools, usage, and events cascade) |
| `control_request` | 1 day after `done_at`; unanswered requests expire after 1 hour |

## Migrations

Migrations are SQL files embedded in the binary
(`crates/state/migrations/0001_init.sql` and onward) and tracked with
`PRAGMA user_version`. Each one runs in its own `BEGIN IMMEDIATE` transaction
together with the version bump, so a crash leaves either the old or the new
schema, and two processes opening a fresh file apply it exactly once. The
server and `memora-cli` migrate the database when they open it. A binary
refuses a database with a newer schema; to go back to an older release,
restore the backup taken before upgrading.

| Version | File | Adds |
|---|---|---|
| 1 | `0001_init.sql` | Base schema and revision triggers |
| 2 | `0002_ui_layout.sql` | `ui_layout` |
| 3 | `0003_colors_logs.sql` | `api_key.color`, `settings.log_max_mb`, `settings.log_max_days` |
| 4 | `0004_oauth.sql` | `oauth_client`, `oauth_code`, `oauth_grant` |
| 5 | `0005_key_secret.sql` | `api_key_secret` |
| 6 | `0006_privacy.sql` | `privacy_rule`, `privacy_rule_key`, `privacy_trail` |
| 7 | `0007_pins.sql` | `pin` |
| 8 | `0008_windows_vault_path.sql` | `settings.vault_path` accepts Windows absolute paths (table rebuilt) |

### JSON state import

When the server starts on a state directory that holds JSON state files
(`gateway.json`, `config.json`, `memora.env`, `tools.json`,
`access_stack.json`, `sessions.json`, `arm.json`, `lock.json`,
`key-usage.json`, `activity.jsonl`, and related files), it imports them once,
in one transaction, then moves them to `legacy-json-<unix time>/`. Auth data
must be valid or nothing is imported; bad log lines are skipped and counted.
Plaintext `MEMORA_ADMIN_PASSWORD` and `MEMORA_API_KEY` values are dropped. A
summary is written to the log and the `activity` table. On a fresh state
directory the import is a no-op.

## Operations

| Task | Command | Notes |
|---|---|---|
| Backup (server running) | `memora-cli db backup [--to PATH] [--keep N]` | `VACUUM INTO` a consistent copy, checked with `integrity_check`, mode 0600. Default target `state/backups/memora-<UTC time>.db`; the newest 10 there are kept (`--keep N`). `--to` takes a file or a directory. |
| Backup without memora-cli | `sqlite3 memora.db ".backup '/var/backups/memora.db'"` | Never `cp` a live WAL database: recent commits sit in `memora.db-wal`. |
| Restore | `memora-cli db restore FILE [--force]` | The server must be stopped (the CLI checks for it and for any process holding `memora.db*`; `--force` skips the check). Verifies `application_id`, schema version, `integrity_check`, and foreign keys, saves the current database to `state/backups/memora-<time>-pre-restore.db`, then replaces it and removes stale `-wal`/`-shm` files. |
| Health | `memora-cli db check` | Directory and file permissions, application id, schema version, `integrity_check`, `foreign_key_check`, file sizes, last backup age. Exit status 1 on any problem, for timers and health checks. |
| Maintenance | `memora-cli db vacuum` | Prune by retention, `PRAGMA optimize`, `VACUUM`, `wal_checkpoint(TRUNCATE)`. |
| Inspect | `memora-cli db shell [--write]` | Runs `sqlite3` (must be installed), read-only unless `--write`. Writes through the shell bypass Memora's checks and the activity log. |
| Export | `memora-cli db export-json [DIR]` | Writes the database out as JSON state files (default: the state directory). |

In the console: `/backup`, and `/db` with `check`, `vacuum`, or `backup`.

In Docker, run the same commands through the container:

```sh
docker compose exec gateway memora-cli db backup     # lands in ./state/backups/
docker compose exec gateway memora-cli db check
```

For a restore, stop the service first and run the CLI in a one-off container:

```sh
docker compose stop gateway
docker compose run --rm gateway cli db restore /state/backups/memora-<time>.db
docker compose start gateway
```

A daily systemd timer or cron job running `memora-cli db backup` is enough for
most installs. Back up `key-seal.bin` with the database; without it, sealed key
copies cannot be shown again (the keys themselves keep working).

## Encryption at rest

The database is not encrypted. Every credential in it is a one-way hash
(argon2id for the owner password, SHA-256 for API keys, OAuth codes and refresh
tokens, setup codes, and session ids), and sealed key copies are encrypted
under a key stored outside the database. What remains (IPs, user agents,
activity) is low sensitivity. Use a 0700 state directory, host disk
encryption, and encrypt backups that leave the host (for example with `age` or
`gpg`).
