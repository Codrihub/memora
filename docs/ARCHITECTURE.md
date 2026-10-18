# Architecture

This document describes how Memora is put together: the crates, what each one
owns, the request path from a browser or an agent to the vault, the realtime
WebSocket fan-out, the auth model, and the storage model. Every claim here maps
to code under `crates/`.

## Crate layout

Memora is a Cargo workspace with six crates. The web UI is a TypeScript app in
`web/src`, built with Vite into `crates/http/assets`.

| Crate | Binary | Owns |
|---|---|---|
| `memora-core` | (library) | The vault: walking notes, parsing wikilinks and frontmatter, the SQLite search index, search, the graph, git versioning, per-caller path visibility, and the `*_impl` methods that every interface calls. Also the realtime event hub. |
| `memora-gateway` | (library) | Auth primitives: argon2id password hashing, API key generation and hashing, OAuth token and PKCE helpers, setup codes, the access stack evaluator, host and lock allow lists, scopes and per-key tool permissions, and reading the provisioning environment. No state of its own. |
| `memora-state` | (library) | The state database `memora.db` (SQLite, WAL): opening, migrations, change detection, and one typed repository per table group (owner, settings, `server_config`, keys, tools, usage, sessions, arm window, access rules, activity, control requests, OAuth, privacy rules, UI layouts, retention), plus the one-time import of JSON state files. No SQL lives outside this crate. |
| `memora-mcp` | (library) | The MCP server: the tool catalog, JSON-RPC 2.0 handling, the discovery card, client detection, `ai_activity` events, and the privacy view applied to agent callers. |
| `memora-http` | `memora` | The axum server: routing, middleware, the REST API, OAuth 2.1 endpoints, the privacy API, the WebSocket and intake bus, sealed key copies, and serving the UI assets. |
| `memora-cli` | `memora-cli` | The operator console (slash commands such as `/guide`, `/web`, `/keys`, `/tools`, `/sessions`, `/config`, `/backup`, `/db`, `/update`) and one-shot commands (`setup`, `reset-password`, `status`, `disarm`, `unlock`, `list`, `clear-cooldowns`, `vault`, `db ...`, `update`, `version`). It opens `memora.db` directly; run as root, it does database work as the state directory's owner. |

Dependencies point one way: `http` depends on `core`, `mcp`, `gateway`, and
`state`; `mcp` depends on `core`, `gateway`, and `state`; `cli` depends on
`gateway`, `mcp`, and `state`. `core`, `gateway`, and `state` depend on no
other Memora crate.

## What each crate owns

### memora-core

`MemoryStore` is the single point through which the vault is read and written.
Both the HTTP API and the MCP tools call its `*_impl` methods, so a change made
through the UI and one made through an agent take the same code path.

- `walk()` enumerates `.md` files under the vault root, skipping dot
  directories. Walk order is stable, so tools that depend on first-hit order
  behave deterministically.
- Parsing: wikilinks, inline tags, frontmatter tags, and frontmatter fields.
- The search index: a SQLite database at `<vault>/.fts.db`. It is derived data
  and is rebuilt when missing.
- `search()` blends word matching over name and body with `tag:` and `#tag`
  filters, scored by hits, name hits, phrase, and position.
- The graph: nodes are notes, links are resolved wikilinks.
- Versioning: vault changes are committed to git (`create:`, `edit:`,
  `rename:`, `move:`, `delete:`, `folder:`); history, diff, restore, and
  snapshot read from that history.
- Privacy views: while a caller's `PathView` is set, listings skip hidden
  notes, hidden paths resolve as "not found", and folder operations that would
  carry hidden items along are refused. A path hook reports renames, moves, and
  deletes so privacy rules follow the notes they protect.
- The event hub (see below).

### memora-gateway

- `hash_password` and `verify_password` use argon2id.
- `generate_key` produces `memora_live_` plus 128 random bits as hex.
  `hash_api_key` stores the SHA-256 hex of the key. `verify_key` compares in
  constant time.
- `AccessStack` evaluates ordered IP, range, CIDR, domain, and catch-all rules.
  Loopback is always allowed.
- `host_allowed` checks the `Host` against `MEMORA_DOMAIN` and the host of
  `MEMORA_BASE_URL`.
- `tool_access` combines a key's scopes (`mcp`, `read`, `write`, `admin`), its
  tool list, and the global tool switches.

### memora-state

- `Db::open` creates or opens `memora.db` (0600 in a 0700 directory), refuses
  foreign or newer-schema files, and runs migrations.
- Every write is one `BEGIN IMMEDIATE` transaction (`Db::write`), so the server
  and `memora-cli` can write concurrently without losing updates.
- Sessions are looked up per request by the SHA-256 of the cookie value;
  `last_seen` and key usage are buffered and flushed in the background.
- The arm window, the LOCKED state, and the last burned window live in one
  `arm_state` row.
- Triggers bump a per-domain revision counter. The server checks
  `PRAGMA data_version` about once a second and reloads only the caches whose
  domain changed, so CLI edits apply without a restart (except
  `server_config`, which is read at startup).
- Old rows (activity, key events, sessions, trashed keys, control requests) are
  pruned hourly.
- See [DATABASE.md](DATABASE.md) for the schema and operations.

### memora-mcp

- `catalog()` returns the full tool list. Each tool carries a name, a category,
  a description, a "when to use" note, and a JSON input schema. See
  [MCP.md](MCP.md).
- `handle()` dispatches JSON-RPC methods: `initialize`,
  `notifications/initialized`, `tools/list`, `tools/call`, `resources/list`,
  and `resources/read`. Unknown methods return JSON-RPC error `-32601`.
- `call_tool()` dispatches to `MemoryStore` under the caller's privacy view.
- Every tool call publishes `ai_activity` start and end events.
- `discovery_card()` builds the `/.well-known/mcp.json` document.
- `detect_client()` classifies a request as MCP, web, or API from the path, the
  `mcp-session-id` header, the JSON-RPC body shape, and the user agent.

### memora-http

- `build_router()` wires every route and stacks the middleware layers listed
  below.
- `AppState` holds the shared store, the MCP server, the database handle, the
  in-memory caches (owner, keys, tools, access stack, settings, arm window),
  the rate-limit guard, the allowed domains, the asset directory, and the vault
  path.
- `oauth.rs` is an OAuth 2.1 authorization server for remote MCP clients;
  `privacy.rs` serves `/api/privacy`; `secrets.rs` seals API key copies.

### memora-cli

The CLI never asks for the owner password. It opens setup and reset windows and
prints one-time codes; credentials are always typed into the browser form.

## Request path

A request enters through `axum::serve` on the single bound address. Layers run
in this order, outermost first:

1. Security headers (`mw_security_headers`): CSP, `X-Frame-Options: DENY`,
   `X-Content-Type-Options`, `Referrer-Policy`, COOP/CORP,
   `Permissions-Policy`, `Cache-Control: no-store` for API and auth responses,
   and HSTS when HTTPS is reported by a trusted proxy. Applied to every
   response, including errors produced by inner layers.
2. `X-Robots-Tag: noindex` (`mw_noindex`).
3. A global concurrency limit of 1024 requests.
4. A 30 second request timeout (`408`).
5. Guard (`mw_guard`): requests for a host outside the domain allow list get a
   bare `404`. Forwarding headers from untrusted peers are dropped. The caller
   IP is resolved (from `CF-Connecting-IP`, `X-Real-IP`, or the right-most
   `X-Forwarded-For` entry, only when the peer is a trusted proxy). Per-IP
   token buckets apply to auth endpoints and to all traffic, and callers in a
   cooldown after failed logins or bad API keys get `429`. `/healthz` and
   loopback callers are not rate limited.
6. Access stack (`mw_access`): picks up changes from `memora-cli`, then
   evaluates the caller IP and the `Host` domain against the access rules. A
   block returns `403`. `/healthz` bypasses it.
7. Auth and lock gate (`mw_auth`):
   - If the instance is LOCKED and the path is neither in the lock allow list
     nor a static asset: `/api/*` and `/mcp` return `423`; other paths redirect
     to `/login?locked=1`.
   - Public paths pass: `/healthz`, `/.well-known/mcp.json`, `/tools`,
     `/login`, `/logout`, `/_bus`, `/`, `/index.html`, static assets, the OAuth
     discovery and flow endpoints, and the auth endpoints
     `/api/auth/{state,login,logout,bootstrap,reset,verify}`.
   - `/ws` needs a valid session and a same-origin request.
   - A valid session cookie (`memora_sess`) passes and is touched (sliding
     TTL).
   - Remaining `/api/*` and `/mcp` requests need an API key, read from
     `Authorization: Bearer <key>` or `X-API-Key: <key>`. The key must carry
     the scope the route needs (`mcp` for `/mcp`, `admin` for keys, tools,
     access, OAuth clients, privacy, and log settings, otherwise `read` for
     GET and `write` for changes). Usage is recorded; an unknown key is logged
     (`key_fail`) and counts toward the IP's cooldown. `/mcp` answers `401`
     with a `WWW-Authenticate` header so OAuth clients can start sign-in.
8. Vault gate (`mw_vault`): until a vault folder is configured, every route
   that needs the vault (notes, graph, logs, `/mcp`) answers
   `409 {"needs_vault": true}`.

Then the matched handler runs. Unmatched browser navigations get the app shell;
other unmatched paths get a JSON `404`.

For a browser: `GET /` without a session redirects to `/login`. After login,
the UI calls the `/api/*` endpoints. Reads go to `MemoryStore`. Writes from a
cookie session pass a same-origin check, then call `MemoryStore` `*_impl`
methods, which write the note, update the index, and commit to git.

For an agent: `POST /mcp` carries a JSON-RPC body. The handler parses it,
detects the client kind, and calls the MCP server under the key's privacy view.
A tool call dispatches to the same `MemoryStore` methods the UI uses. REST
calls with an API key run under the same privacy view. See [API.md](API.md)
and [MCP.md](MCP.md).

## Realtime WebSocket fan-out

The event hub lives in `memora-core::events` as a process-wide singleton.

- `publish()` stamps `_ts`. Persistable event types (`ai_activity` start
  events, `node_created`, `node_updated`, `node_deleted`, `node_renamed`,
  `folder_meta`, `folder_changed`, `actor_alias`, `key_color`) go into a
  40-entry replay ring and are appended to `<vault>/.events.jsonl`, which is
  trimmed by the `log_max_mb` and `log_max_days` settings.
- Events are broadcast on a Tokio broadcast channel (capacity 256); a lagging
  subscriber skips missed events instead of stalling the server.
- `GET /ws` (signed-in browser, same origin, at most 512 clients) sends a
  `hello` event with the client count, replays the ring (each event marked
  `replay: true`), then streams live events. When a client disconnects, a
  `presence` event announces the new count.
- `POST /_bus` is the local intake: it publishes a JSON object, but only from a
  loopback peer with no forwarding headers. Everyone else gets `403`.

The WebSocket and the intake bus share the single port. There is no second port
to open or proxy.

## Auth model

Owner login (browser): the owner posts a username and password to
`/api/auth/login`. The argon2id hash is verified, a session is created, and the
`memora_sess` cookie is set (`HttpOnly`, `SameSite=Lax`, `Secure` when HTTPS is
reported by a trusted proxy). The session slides on activity up to
`session_ttl`, with an optional absolute cap (`session_max_age`).

API keys (agents and scripts): created from the dashboard, the API, or
`memora-cli` (`/keys`); the raw key is shown once. Only the SHA-256 hex is
stored, plus an optional encrypted copy (see [Storage model](#storage-model))
so the owner can show a dashboard-created key again after re-entering the
password. Keys carry scopes and an optional tool list.

OAuth 2.1 (remote MCP clients): discovery at
`/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`; clients register dynamically
(`/oauth/register`), by a client metadata document URL, or manually by the
owner. The flow is authorization code with PKCE S256 only. The signed-in owner
approves the request in the browser, and `/oauth/token` issues an access token
that is an ordinary API key, plus a rotating refresh token. Revoking the key
ends the connection.

Privacy rules: the owner can hide a folder or a note from chosen agents
(`deny`) or from every agent except chosen ones (`allow_only`). Rules add up;
the signed-in owner always sees everything. Rules are managed through
`/api/privacy` and the admin MCP tools.

First-run and recovery (the arm window):

- `GET /api/auth/state` is public and reports `bootstrap` (true when no owner
  exists), `armed`, `locked`, the setup hint, and readiness checks.
- `memora-cli setup` (or `/web` in the console) arms a `bootstrap` window in
  the `arm_state` row, clearing any lock, and prints a one-time code. The
  browser submits the code and creates the owner through
  `/api/auth/bootstrap`, which works only while armed and only when no owner
  exists.
- `memora-cli reset-password` arms a `reset` window; `/api/auth/reset`
  replaces the password.
- A wrong code voids the window. If a window expires unfinished, the instance
  becomes LOCKED. While locked, only the lock allow list and static assets are
  reachable. `memora-cli unlock`, `setup`, or `reset-password` clears the lock.

Lock allow list (`LOCK_ALLOWED`): `/login`, `/logout`, `/api/auth/state`,
`/api/auth/verify`, `/api/auth/login`, `/api/auth/logout`,
`/api/auth/bootstrap`, `/api/auth/reset`, `/healthz`, `/favicon.ico`.

## Storage model

Memora keeps two directories apart on purpose.

### Vault (markdown, portable)

Chosen in the browser after the first sign-in (`MEMORA_VAULT` is the
suggestion) and stored in the `settings` table.

- One `.md` file per note. Frontmatter and inline `#tags` are both supported.
- Wikilinks use `[[Note Name]]` and resolve by name, so moving or renaming a
  note does not break links.
- `.git/` is the vault history. Changes commit automatically.
- `.fts.db` is the SQLite search index. It is derived data and can be rebuilt.
- `.events.jsonl` is the append-only event log.
- `.folders.json` stores folder color, icon, and description.
- `.locks.json` stores soft locks used for collaboration.
- `.actors.json` stores actor aliases.
- `.Trash/` holds soft-deleted notes, recoverable with `restore_trash`.

### State (credentials, operational)

Set by `MEMORA_STATE` (default `state`).

- `memora.db` is the single SQLite database for all server state: the owner
  (argon2id hash), API keys (SHA-256 hex, with a trash for restore), scopes
  and tool lists, global tool switches, OAuth clients and grants, privacy
  rules, sessions (hashed ids), the arm window and lock, access rules, instance
  settings, `server_config`, UI layouts, and the activity log. It is created
  and migrated on first start; WAL mode, mode 0600.
- `key-seal.bin` is the 32-byte master key (0600) for the sealed API key copies
  (ChaCha20-Poly1305). The database holds only ciphertext, so a copy of
  `memora.db` alone reveals no key.
- `backups/` holds `memora-cli db backup` copies.
- `legacy-json-<unix time>/` holds JSON state files found at startup, moved
  there after their one-time import.
- `internal.token` is created by the container entrypoint. Memora does not use
  it.

State changes are transactional: a crash leaves either the old or the new
state, never a mix.
