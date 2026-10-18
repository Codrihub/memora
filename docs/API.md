# HTTP API

The `memora` binary serves the HTTP API, the MCP endpoint, the OAuth endpoints,
the web UI, and the WebSocket on one port. This document lists the HTTP endpoints.

## Authentication

The Auth column in the tables below uses these levels:

- None: reachable without credentials.
- Session: requires the `memora_sess` cookie set by a successful login.
- Key (`scope`): an API key sent as `Authorization: Bearer <key>` or `X-API-Key: <key>`
  that carries the named scope.
- Session or key (`scope`): either of the above.
- Session only: an API key is not enough. API keys get `401` (or `403` where noted).
- +CSRF: the same-origin check described below applies.

### API key scopes

A key carries any of the scopes `mcp`, `read`, `write`, and `admin`. New keys get
`mcp`, `read`, and `write` unless other scopes are requested. The scope a route
needs is decided by its path and method:

| Scope | Routes |
|---|---|
| `mcp` | `/mcp` |
| `admin` | `/api/tools`, `/api/keys` and `/api/keys/*`, `/api/access` and `/api/access/*`, `/api/logs/settings`, `/api/oauth/clients` and `/api/oauth/clients/*`, `/api/privacy` and `/api/privacy/*` |
| `read` | Every other `GET` or `HEAD` under `/api/` |
| `write` | Every other method under `/api/` |

A key without the needed scope gets `403 {error, required_scope}`. A missing key
gets `401`; for `/mcp` the `401` carries a `WWW-Authenticate` header,
`Bearer resource_metadata="<base>/.well-known/oauth-protected-resource"`, so OAuth
capable clients can start sign-in. An invalid key gets `401` and is logged; an
IP that keeps presenting invalid keys is put on a cooldown (`429`).

`/api/auth/*` never accepts an API key: without a valid session it answers `401`.

API keys see the vault through their privacy rules (see [Privacy](#privacy)):
notes and folders hidden from a key behave as if they do not exist. A browser
session sees everything.

### CSRF

Write endpoints that accept a session check the request origin whenever a
session cookie is present: `Origin` (or, without it, `Referer`) must match the
request `Host` (or an `X-Forwarded-Host` sent by a trusted proxy), and
`Sec-Fetch-Site: cross-site` is refused. A failed check is
`403 {"error":"origin mismatch"}`. Requests without a session cookie (API-key
clients) pass, since a browser cannot attach an API key on its own.

The public auth forms (`/api/auth/login`, `/api/auth/verify`,
`/api/auth/bootstrap`, `/api/auth/reset`) also refuse a foreign or `null`
`Origin` when no cookie exists yet. A request with neither `Origin` nor
`Referer` (curl, the CLI) passes.

### Locked instance

While the instance is LOCKED, `/api/*` and `/mcp` answer
`423 {error, locked: true, hint}` except for `/api/auth/state`, `/api/auth/verify`,
`/api/auth/login`, `/api/auth/logout`, `/api/auth/bootstrap`, and
`/api/auth/reset`. Other pages redirect to `/login?locked=1`; static assets,
`/login`, `/logout`, `/healthz`, and `/favicon.ico` are still served.
`/api/auth/login` itself answers `423` while locked.

### Vault not configured

Until a vault folder is configured, `/mcp` and every `/api/*` route except
`/api/auth/*`, `/api/settings*`, `/api/config`, `/api/keys*`, `/api/tools`,
`/api/access*`, and `/api/ui/*` answer
`409 {"error":"vault not configured", "needs_vault":true}`.

### Limits and other gates

- Requests for a host outside the configured domain list get a bare `404`.
- Access rules (see `/api/access`) can block a caller:
  `403 {"error":"access denied by stack rule", ip}`.
- Per-IP rate limits answer `429` with a `Retry-After` header and
  `{error, limited, cooldown, retry_after}`. Login, code check, setup, reset, profile,
  password, and username changes have a stricter limit and a cooldown after
  repeated failed attempts. Requests from the machine itself and `/healthz` are
  not limited.
- A request that takes longer than 30 seconds is answered with `408`.
- A password hashing pool that is busy answers `503` with `Retry-After: 2`.

Responses are JSON unless stated otherwise. Errors are `{"error": "..."}`. Vault
errors map to `404` for not-found (including paths hidden from the caller) and
`400` for bad input.

## Health and discovery

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/healthz` | None | `{ok, server}` for unauthenticated callers from other machines. A signed-in browser or a caller on the same machine gets `{ok, server, version, vault_configured, vault, armed, locked, base_url, base_url_configured}`. |
| GET | `/.well-known/mcp.json` | None | The MCP discovery card: `{name, version, description, mcp, auth, capabilities, tools, resources}`. `tools` lists the full catalog with `enabled` per tool. |
| GET | `/tools` | None | An HTML rendering of the tool catalog. A signed-in browser gets the app shell instead. |
| POST | `/mcp` | Key (`mcp`), or Session (+CSRF) | MCP over streamable HTTP (JSON-RPC in, JSON-RPC out). See [MCP.md](MCP.md). A session has full access; a key is limited by its tool grant. Notifications get `202` with no body. Malformed JSON is `400` with a JSON-RPC error. Other methods get `405` with `Allow: POST`. |

## Auth

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/auth/state` | None | `{bootstrap, realm, min_password_len, gateway, armed, locked, setup_hint, ready, checks:{vault, state}, code_required, cooldown, vault_configured}`. Adds `signed_out` (`password_changed` or `signed_out_remotely`) when the browser's session was ended on purpose, and `mode`, `expires_in`, `ttl` while a setup or reset window is open. |
| POST | `/api/auth/verify` | None (+CSRF) | Checks the setup code shown on the server before the setup or reset form is shown. Body: `{code}`. Returns `{ok, mode, expires_in, user}`. `403` when no window is open or the instance is not ready. A wrong code closes the window and voids the code: `403 {error, burned:true}`. |
| POST | `/api/auth/login` | None (+CSRF) | `{ok, user, expires_in, redirect}` and sets the session cookie. Body: `{username, password}`. `400` when a field is missing, `401` on bad credentials, `403` if the account is disabled, `423` if locked, `429` during a cooldown. |
| POST | `/api/auth/logout` | None (+CSRF) | `{ok:true}`. Ends the session named by the cookie, if any, and clears the cookie. |
| POST | `/api/auth/bootstrap` | None (+CSRF) | Creates the owner account. Body: `{code, username, password}`. Returns `{ok, user, redirect, persisted}` and sets a session cookie. The username is stored lowercase. `400` for an invalid username or password length; `403` unless a window is open, the code is right, the instance is ready, and no account exists. |
| POST | `/api/auth/reset` | None (+CSRF) | Sets a new password for the single account, and may rename it. Body: `{code, username, password}`. Returns `{ok, user, persisted}`. Signs out every session. `400` for invalid input; `403` unless a window is open, the code is right, and an account exists. |
| POST | `/api/auth/profile` | Session only (+CSRF) | With `password` in the body, changes the password exactly like `POST /api/settings/password` (body `{current, password, confirm}`). Otherwise sets `display_name` (at most 48 characters) and returns `{ok, changed, persisted, user, password_changed:false}`; with no `display_name` it returns `{ok, changed:false}`. |
| GET | `/api/auth/me` | Session only | `{authenticated, user, enabled, expires_in}`. `401` without a session. |
| GET | `/api/auth/events` | Session only | Recent entries of the security activity log, newest first: `{events:[{at, event, ip, user, detail, actor, actor_kind, actor_id}], count}`. `user` is the stored actor (`key:<id>` for API-key calls); `actor` is the display name (the key's current name, falling back to its id; the username for the browser), `actor_kind` is `agent` or `user` (null when there is no actor). Query: `limit` (default 200, max 2000), `q`. |

## Pages

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/login` | None | The sign-in page. A signed-in browser is redirected to `/` unless the instance is locked or the query has `oauth` (the OAuth consent card). |
| any | `/logout` | None | Ends the session, clears the cookie, and redirects to `/login`. A cross-site request only clears the cookie. |
| GET | `/`, `/index.html` | Session | The web app shell. Without a session: `302` to `/login`. `503` when the UI assets are not installed. |
| GET | App routes (see below) | Session | The same app shell as `/`. Without a session: `302` to `/login?r=<path>`, so sign-in returns to the page. |

App routes are the web app's client-side pages: `/brain`, `/nodes`, `/graph`,
`/canvas`, `/tags`, `/activity`, `/agents`, `/access`, `/settings`,
`/overview`, `/welcome`, the older names `/home`, `/vault`, `/logs`, `/keys`,
and `/node/` or `/node/<percent-encoded vault path>`. The path is never used to
read a file; a path holding NUL or another control character (raw or
percent-encoded) is `400`. `/tools` is an app route for a signed-in browser and
the public tool catalog otherwise.

HTML pages are sent with `Cache-Control: no-cache, no-store, must-revalidate`
and a per-response CSP nonce.

Any other `GET` that asks for HTML (`Accept: text/html`), is outside `/api/`,
`/mcp`, `/oauth`, and `/.well-known`, and has no file extension in its last
segment gets the app shell (which shows its "page not found" view). Every other
unmatched request is `404 {"error":"not found"}`.

## Static assets

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/assets/{name}` | None | Static UI assets (whitelisted filenames only, else `404`). |
| GET | `/app.js`, `/app.css`, `/login.css` | None | The UI bundle and styles. Revalidated on every load (`Cache-Control: no-cache`, ETag). |
| GET | `/favicon.svg` | None | The icon. |
| GET | `/favicon.ico` | None | `204` with no body. |
| GET | `/manifest.webmanifest`, `/sw.js`, `/robots.txt`, `/offline.html`, `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png`, `/apple-touch-icon.png` | None | PWA files and `robots.txt`. Images and the manifest are cached for 5 minutes; code is revalidated on every load. |

## Vault

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/tree` | Session or key (`read`) | Notes grouped by folder. |
| GET | `/api/note` | Session or key (`read`) | `{path, name, content, html, tags, frontmatter, backlinks, size, mtime}`. Query: `path` (`400` when empty). |
| GET | `/api/vault/file` | Session or key (`read`) | The raw bytes of one image file in the vault (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO; never SVG). Query: `path` (vault-relative). The file content must match its type. At most 10 MiB (`413`). Sent with an `ETag` (`304` on `If-None-Match`), `Cache-Control: private, max-age=300`, and a sandbox CSP. `400` invalid path, `403` path not allowed, `404` not found, `415` not an image. |
| GET | `/api/folder-meta` | Session or key (`read`) | Folder metadata keyed by folder name. Query: `folder` (optional). |
| POST | `/api/save` | Session or key (`write`, +CSRF) | `{ok, path}`. Body: `{path, content}`. Overwrites the note. |
| POST | `/api/create` | Session or key (`write`, +CSRF) | `{ok, path}`. Body: `{title, folder?, content?}`. |
| POST | `/api/rename` | Session or key (`write`, +CSRF) | `{ok, path}` with the new path. Body: `{path, name}`. |
| POST | `/api/move` | Session or key (`write`, +CSRF) | `{ok, path}` with the new path. Body: `{path, folder?}`. |
| POST | `/api/delete` | Session or key (`write`, +CSRF) | `{ok:true}`. Body: `{path}`. |
| POST | `/api/folder` | Session or key (`write`, +CSRF) | `{ok, path}`. Body: `{name}`. |
| POST | `/api/folder/rename` | Session or key (`write`, +CSRF) | `{ok, from, to, notes}`. Body: `{folder, name}`. |
| POST | `/api/folder/move` | Session or key (`write`, +CSRF) | Moves a folder and everything in it. `{ok, from, to, notes}`. Body: `{folder, into}`; `into` empty or `Root` means the top level. |
| POST | `/api/folder/move-contents` | Session or key (`write`, +CSRF) | Moves everything inside a folder into another one, then removes the emptied folder. Name clashes get a `-N` suffix. `{ok, from, to, moved}`. Body: `{folder, into}`; `into` empty or `Root` means the top level. |
| POST | `/api/delete-folder` | Session or key (`write`, +CSRF) | Deletes a folder and moves its notes to the top level. `{ok, deleted_folder, moved_to_root}` where `moved_to_root` lists the new note paths. Body: `{folder}`. |
| POST | `/api/folder-meta` | Session or key (`write`, +CSRF) | `{ok, folder}`. Body: `{folder, color?, icon?, desc?}`. |

The three folder operations also publish a `folder_changed` realtime event so
open browsers reload their tree.

## Search and graph

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/search` | Session or key (`read`) | `{q, count, hits:[{path, name, folder, score, snippet}]}`, at most 20 hits. Query: `q`. Supports `tag:x` and `#x`. |
| GET | `/api/stats` | Session or key (`read`) | `{notes, links, folders}`. |
| GET | `/api/graph` | Session or key (`read`) | `{nodes:[{id, path, folder, color, degree, tags}], links:[{source, target}]}`. `tags` holds inline `#tags` plus frontmatter `tags` (as the note view reports them). Realtime `node_*` events' `node` payload carries `tags` too. |
| GET | `/api/aliases` | Session or key (`read`) | `{aliases:[{alias, key_id, key_name, first_seen, last_seen, connections, actor, actor_kind}]}`: one record per API key that sent MCP `initialize`, kept in memory until the server restarts. `key_name` and `actor` are the key's current name (fallback: the id). |
| GET | `/api/actors` | Session or key (`read`) | `{actors:[{actor, alias, display, events, tools, last_ip, last_ts, seen_minutes_ago}], count}`. `seen_minutes_ago` is `-1` when the actor has no events. |

## Privacy

Privacy rules hide notes or folders from chosen agents (API keys). A rule has a
`kind` (`node` or `folder`), a `path`, a `mode` (`deny`: hidden from the listed
keys; `allow_only`: hidden from every key except the listed ones), and a list
of keys. Folder rules apply to everything inside the folder.

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/privacy` | Session or key (`admin`) | `{count, rules:[{id, kind, path, mode, keys:[{id, name, color}], created_at, updated_at}], agents:[{id, name, color, enabled}]}`. |
| GET | `/api/privacy/path` | Session or key (`admin`) | The privacy state of one path: `{path, kind, own, own_rules, inherited, agents:[{id, name, color, enabled, can_see, hidden_by}], private}`. `own` is `{mode, keys}` or `null`. Query: `path`, `kind` (optional; defaults to `folder` when the path is a folder on disk, else `node`). |
| PUT | `/api/privacy/path` | Session or key (`admin`, +CSRF) | Replaces the rule on a path. Body: `{path, kind?, mode, keys}`. `mode` defaults to `deny`; `keys` is a list of key ids (or unique key names). `deny` with no keys removes the rule. Returns the same shape as `GET`. |
| DELETE | `/api/privacy/path` | Session or key (`admin`, +CSRF) | Removes the rule on a path. Query: `path`, `kind` (optional). Returns the same shape as `GET`. |

Changes are written to the activity log and publish a `privacy_changed`
realtime event.

## API keys, tools, and access

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/keys` | Session or key (`admin`) | `{count, keys:[{id, name, enabled, scopes, tools, prefix, created, color, revealable, uses, last_ip, used_tools}]}`. `tools` is `"*"` or a list of tool names; `revealable` says whether the secret can be shown again; `used_tools` lists recently used tools and routes. |
| POST | `/api/keys` | Session or key (`admin`, +CSRF) | Creates a key. Body: `{name?, tools?, scopes?, color?}`. `tools` is `"*"` or a list of tool names; `scopes` a list of scope names (an empty list means the defaults). Returns `{ok, id, key, name, prefix, persisted, color, tools, scopes}`. The raw `key` is returned once. `400` for an unknown tool or scope. |
| POST | `/api/keys/roll` | Session or key (`admin`, +CSRF) | New secret for an existing id. Body: `{id}`. Returns `{ok, id, key, prefix, persisted}`. `404` for an unknown id. |
| POST | `/api/keys/reveal` | Session only (+CSRF) | Shows the secret of a key created or rolled from the dashboard again. Body: `{id, current}` where `current` is the owner's password. Returns `{ok, id, key}`. `403` for a wrong password; `429` after 5 wrong passwords (5 minute pause); `404 {error:"not_stored", message}` when the secret is not stored (for example keys created by the CLI or by OAuth). |
| POST | `/api/keys/update` | Session or key (`admin`, +CSRF) | Body: `{id, name?, enabled?, tools?, scopes?, color?}`. `color` as `""` or `null` clears it. Returns `{ok, id, name, enabled, color, tools, scopes, persisted}`. `400` for an unknown tool or scope, `404` for an unknown id. |
| POST | `/api/keys/delete` | Session or key (`admin`, +CSRF) | `{ok, id, persisted}`. Moves the key to the trash. Body: `{id}`. |
| POST | `/api/keys/restore` | Session or key (`admin`, +CSRF) | `{ok, id, persisted}`. Restores a deleted key. Body: `{id}`. `404` when no deleted key has that id. |
| GET | `/api/tools` | Session or key (`admin`) | `{tools:[{name, category, description, enabled}]}`: the MCP tool catalog with the global on/off switch of each tool. |
| POST | `/api/tools` | Session or key (`admin`, +CSRF) | Switches a tool on or off for every caller. Body: `{name, enabled}`. Returns `{ok, name, enabled}`. `400` for an unknown tool. |
| GET | `/api/access` | Session or key (`admin`) | `{default_allow, rules, count}`. |
| POST | `/api/access/test` | Session or key (`admin`) | `{action, would_lock_out_caller}` for the given address or domain. Body: `{ip?, domain?}`. |
| POST | `/api/access/rules` | Session or key (`admin`, +CSRF) | `{ok, count, persisted}`. Body: `{op, kind, value, action}`. `op` is `add` (default) or `remove`. `kind` is `ip`, `range`, `cidr`, `domain`, or `all`; `value` is required unless `kind` is `all`. `action` is `allow` or `block` (default `block`). `remove` deletes every rule matching the given `kind` and `value`; `404` when none match. |
| GET | `/api/config` | Session or key (`read`) | `{realm, min_password_len, session_ttl, vault, version, gateway, update}`. `update` is the cached release check: `{current, latest, available, url, checked_at, state}`, `state` one of `ok`, `none` (no release published), `error`, `disabled`, `pending`. |

## Settings

All settings endpoints need a signed-in browser.

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/settings` | Session only | `{user, vault_configured, vault, vault_suggested, vault_writable, stats, min_password_len, expires_in, session_ttl, session_max_age, state_dir}`. `stats` is `{notes, links, folders}` or `null` without a vault. |
| POST | `/api/settings/password` | Session only (+CSRF) | Body: `{current, password, confirm}`. Returns `{ok, user, password_changed, revoked_sessions, persisted}`. Every other session is signed out. `400` for a short, mismatched, or unchanged password; `403` for a wrong current password (counts toward the login cooldown). |
| POST | `/api/settings/username` | Session only (+CSRF) | Renames the account. Body: `{username, current}`. Returns `{ok, user, changed}` (plus `persisted` when changed). The username is stored lowercase. Sessions stay signed in. `400` for an invalid username, `403` for a wrong password. |
| POST | `/api/settings/vault` | Session only (+CSRF) | Sets the vault folder and switches the running server to it. Body: `{path, create?}`. `path` must be absolute, without `..`, writable, not a system folder, and not overlap the state folder; with `create` a missing folder is created (its parent must exist). Returns `{ok, vault, created, stats}`. `400` with a message when the folder is refused. |
| GET | `/api/settings/sessions` | Session only | `{sessions:[{id, current, source, alias, ip, user_agent, created_at, last_seen, expires_in}], count}`: live browser sessions. API keys are not sessions and never appear here. |
| POST | `/api/settings/sessions/revoke` | Session only (+CSRF) | Signs other browsers out. Body: `{id}` or `{others:true}`. Returns `{ok, revoked}`. `400` for the current session (use logout), `404` when the session has already ended. |
| POST | `/api/settings/sessions/rename` | Session only (+CSRF) | Names a device. Body: `{id, alias}`; an empty alias clears it. Returns `{ok, alias}`. |
| GET | `/api/settings/sessions/activity` | Session only | `{events, count, ip, since}`: activity log entries from that session's IP address since it signed in, API-key entries left out, newest first, at most 200. Query: `id`. |

Session `id` values are the short ids returned by `GET /api/settings/sessions`
(a unique prefix also works). An ambiguous or malformed id is `400`.

## OAuth

Memora is an OAuth 2.1 authorization server for remote MCP clients. Only the
authorization code flow with PKCE (`S256`) is supported. The access token is a
new API key named after the client, with the default scopes (`mcp`, `read`,
`write`) and every tool; it appears on the Agents page like any other key and
is revoked by deleting or disabling that key. URLs in the metadata use
`MEMORA_BASE_URL` when it is set, else the scheme and host of the request.

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp` | None | Protected resource metadata (RFC 9728): `{resource, authorization_servers, bearer_methods_supported, scopes_supported, resource_name}`. |
| GET | `/.well-known/oauth-authorization-server`, `/.well-known/oauth-authorization-server/mcp`, `/.well-known/openid-configuration` | None | Authorization server metadata (RFC 8414): `issuer`, the authorization, token, and registration endpoints, supported response types (`code`), grant types (`authorization_code`, `refresh_token`), PKCE methods (`S256`), token endpoint auth methods, `scopes_supported` (`mcp`), and `client_id_metadata_document_supported: true`. |
| POST | `/oauth/register` | None | Dynamic client registration (RFC 7591). Body: `{redirect_uris, client_name?}`. `redirect_uris` holds 1 to 10 URIs, each HTTPS or plain HTTP on `localhost`, `127.0.0.1`, or `[::1]`, without a fragment. Returns `201 {client_id, client_name, redirect_uris, client_id_issued_at, token_endpoint_auth_method, grant_types, response_types}`. `400 {error, error_description}` for invalid metadata. |
| GET | `/oauth/authorize` | None | `302` to `/login?oauth=1&<query>`, where the sign-in page shows a consent card (after sign-in when needed). |
| POST | `/oauth/token` | None | Form-encoded or JSON body. `grant_type=authorization_code` with `code`, `code_verifier`, `client_id` (or HTTP Basic), and optional `redirect_uri`; or `grant_type=refresh_token` with `refresh_token` and optional `client_id`. Returns `{access_token, token_type:"Bearer", refresh_token, scope:"mcp"}`. Codes are single use and expire after 10 minutes. A refresh gives the same key a new secret and a new refresh token. Errors are `400 {error, error_description}` (`invalid_request`, `invalid_grant`, `unsupported_grant_type`). |
| GET | `/api/oauth/request` | None | What the consent card shows for an authorization request. Query: the `/oauth/authorize` query. Returns `{ok:true, client:{id, name, kind}, redirect_host, signed_in, user}` or `{ok:false, error, error_description, redirect}`. |
| POST | `/api/oauth/approve` | Session only (+CSRF) | Body: `{query, allow}` where `query` is the authorization request query. Returns `{ok:true, redirect}`: the client's redirect URI with a `code` when `allow` is `true`, else with `error=access_denied`. An invalid request returns `{ok:false, error, error_description, redirect}`. `401` without a session. |
| GET | `/api/oauth/clients` | Session or key (`admin`) | `{clients:[{client_id, name, redirect_uris, kind, created_at, fetched_at}], connections:[{key_id, client_id}]}`. `kind` is `dcr` (registered), `cimd` (metadata document), or `manual` (added by the owner). |
| POST | `/api/oauth/clients` | Session or key (`admin`, +CSRF) | Registers a client by hand. Body: `{name?, redirect_uris}`. Returns `{ok, client}`. `400` for invalid redirect URIs. |
| POST | `/api/oauth/clients/delete` | Session or key (`admin`, +CSRF) | Forgets a client and its refresh tokens. Body: `{client_id}`. Returns `{ok, deleted}`. Keys issued to the client stay until they are deleted. |

A `client_id` may also be an HTTPS URL of a client metadata document. The
server fetches it (public addresses only, no redirects, at most 64 KiB), checks
that its `client_id` matches the URL, and caches it for 24 hours.

## Logs and activity

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/logs` | Session or key (`read`) | `{range, count, events}`, newest first, each event with a local `time`. Query: `range` (for example `1d`, `7d`, `today`, `yesterday`, `all`; default `1d`), `days` (used when `range` is absent, at most 7), `since` and `until` (unix seconds; override `range`), `limit` (default 400, max 2000), `actor`, `q`. |
| GET | `/api/logs/settings` | Session or key (`admin`) | `{max_mb, max_days, stats:{bytes, lines, oldest, newest, max_bytes, max_days}}` for the vault event log. |
| POST | `/api/logs/settings` | Session or key (`admin`, +CSRF) | Body: `{max_mb?, max_days?}` (1 to 512 MB; 0 to 3650 days, 0 meaning no age limit). Returns the same shape as `GET`. The log is trimmed to the new limits at once. `400` for out-of-range values. |
| GET | `/api/events` | Session or key (`read`) | `{events, count}`: the vault event log (`.events.jsonl`), oldest first, the newest `limit` entries. Query: `since` (unix seconds), `folder`, `actor` (the key name for agents), `limit` (default 100, max 2000). |

### Realtime

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/ws` | Session only | WebSocket upgrade. The `Origin` must be same-origin (`403` otherwise). `503` when too many clients are connected. |
| POST | `/_bus` | Loopback only | Publishes a JSON object (at most 64 KiB) into the event stream. Returns `{ok:true}`. `403` for callers that are not on the same machine or that come through a proxy (any forwarding header), `400` for a body that is not a JSON object, `413` for a body or event that is too large. |

On connect the server sends a `hello` event with the client count, replays the
last 40 stored events (each marked `replay: true`), then streams live events.
When a client leaves, the others get a `presence` event with the new count.
Messages from the client are ignored; the server pings every 30 seconds and
closes a connection that has been silent for 75 seconds.

### `ai_activity` events

Every MCP `tools/call` publishes a `start` and an `end` event sharing `call_id`:

```json
{"type":"ai_activity","phase":"start","call_id":"c1a2b3c4d5e6-0","actor":"research-bot",
 "actor_kind":"agent","actor_id":"k_1a2b3c4d","action":"read_memory","label":"Plan/Index.md",
 "paths":["Plan/Index.md"],"_ts":1760600000.12}
{"type":"ai_activity","phase":"end","call_id":"c1a2b3c4d5e6-0","actor":"research-bot",
 "actor_kind":"agent","actor_id":"k_1a2b3c4d","action":"read_memory","label":"Plan/Index.md",
 "paths":["Plan/Index.md"],"ok":true,"ms":2,"_ts":1760600000.12}
```

- `actor`: the API key's name (fallback: key id) with `actor_kind: "agent"`; for a
  browser session the username with `actor_kind: "user"`. `actor_id` is the key id (or
  the username). Node events (`node_created`, ...) from the call carry the same `actor`.
- `action`: the tool name.
- `paths`: vault-relative note paths from the arguments (`path`, `paths`, `from`, `to`,
  `old_path`, `new_path`, `into` of `merge_memory`, `source`/`target` of `find_path`)
  plus note paths found in the result (search hits, the created or moved note), at
  most 20, each at most 512 bytes (longer paths are dropped). Whole-vault overviews
  (`get_graph`, `list_memory`, logs, ...) add no result paths.
- Read-only tools publish `start` after running (so it carries the result paths),
  immediately followed by `end`; mutating tools publish `start` before running and `end`
  after, with the result paths added.
- `end` adds `ok`, `ms`, and on failure `error` (at most 200 characters). `label` is at
  most 160 characters. `_ts` is the publish time in unix seconds. `end` events are
  realtime only: they are not written to `.events.jsonl` or the replay buffer.

## UI layout

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/ui/layout/{name}` | Session only | `{name, data, updated_at}`; `data` and `updated_at` are `null` if never saved. |
| PUT | `/api/ui/layout/{name}` | Session only (+CSRF) | `{ok:true, updated_at}`. Body: `{data: <any JSON>}`. |

`name` is `[a-z0-9_-]{1,40}` (else `400`). API keys get `403`. `data` is stored as
serialized JSON of at most 512 KiB (`413` above); the request body limit is 600 KiB.
Layouts are stored in the `ui_layout` table of `memora.db`. The web UI uses them for
`canvas` (card positions and frames) and `graph` (pinned positions).

## Status codes

| Code | Meaning |
|---|---|
| 200 | Success. |
| 201 | OAuth client registered. |
| 202 | MCP notification accepted. |
| 204 | `/favicon.ico`. |
| 302 | Redirect (pages to `/login` without a session, `/login` to `/` when signed in, logout to `/login`, locked instance to `/login?locked=1`, `/oauth/authorize` to the consent page). |
| 304 | Not modified (`/api/vault/file`, static assets). |
| 400 | Bad request, for example a missing required field or an invalid value. |
| 401 | Missing or invalid credentials, or a session-only endpoint called without a session. |
| 403 | Blocked by an access rule, a CSRF origin mismatch, a missing key scope, a wrong password or setup code, or an endpoint that needs an open setup or reset window. |
| 404 | Note, key, session, rule, or route not found; also any request for a host outside the domain list. |
| 405 | `/mcp` called with a method other than `POST`. |
| 408 | The request took longer than 30 seconds. |
| 409 | No vault configured (`needs_vault: true`), or a state conflict. |
| 413 | Body, layout, image, or event too large. |
| 415 | `/api/vault/file` path is not an image. |
| 423 | Instance is LOCKED. |
| 429 | Rate limit or failed-attempt cooldown (`Retry-After` header). |
| 500 | Internal error, for example the state database failed. |
| 503 | UI assets are not installed, the password hashing pool is busy, or too many realtime clients. |
