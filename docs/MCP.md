# MCP

Memora exposes the vault to agents through the Model Context Protocol. The
server speaks JSON-RPC 2.0 over the Streamable HTTP transport at `/mcp`, on the
same port as the HTTP API and the web UI. There is one MCP endpoint and one tool
catalog.

| | |
|---|---|
| Endpoint | `POST /mcp` |
| Protocol versions | `2025-06-18` (preferred), `2025-03-26`, `2024-11-05` |
| Auth | API key in `Authorization: Bearer <key>` or `X-API-Key: <key>`, or an OAuth 2.1 access token |
| Discovery card | `GET /.well-known/mcp.json` (public) |
| Readable catalog | `GET /tools` (HTML page, public) |
| Catalog size | 71 tools, plus 5 admin tools for keys with the `admin` scope |

`initialize` answers with the protocol version the client asks for when it is
one of the three above, and with `2025-06-18` otherwise.

## Transport

- Requests are JSON-RPC 2.0 objects sent with `POST /mcp`. Batches (JSON
  arrays) are not supported.
- Responses are plain JSON (`application/json`). The server does not open SSE
  streams and does not issue an `Mcp-Session-Id`.
- `GET` and `DELETE` on `/mcp` return `405 Method Not Allowed` with
  `Allow: POST`.
- A notification (a `notifications/*` method without an `id`) gets
  `202 Accepted` and no body.
- `/mcp` needs a configured vault. Until one is chosen it returns
  `409 {"error":"vault not configured","needs_vault":true}`.
- A browser session (cookie) may also call `/mcp`. It then needs a same-origin
  request, like the rest of the JSON API.

The server speaks Streamable HTTP only. A client that can only launch local stdio
servers can use a bridge such as `mcp-remote` (see below).

## Connecting an agent

### With an API key

Create a key in the web UI (Keys page), with `memora-cli` (`/keys`), or with
`POST /api/keys`. The raw key (`memora_live_...`) is shown once. By default a key gets
the scopes `mcp`, `read` and `write` and may call every tool. See
[Tool switches and per-key permissions](contracts/tools-permissions.md) to
narrow it.

Use `http://localhost:8400/mcp` for a local install, or your public URL such as
`https://memory.example.com/mcp` behind a reverse proxy. When the server sets
`MEMORA_DOMAIN` or `MEMORA_BASE_URL`, requests for any other host get `404`, so
use that domain.

Claude Code:

```bash
claude mcp add --transport http memora https://memory.example.com/mcp \
  --header "Authorization: Bearer memora_live_REPLACE_WITH_YOUR_KEY"
```

Cursor, Windsurf and other clients with an `mcpServers` JSON config (VS Code
uses the key `servers` in `.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "memora": {
      "type": "http",
      "url": "http://localhost:8400/mcp",
      "headers": {
        "Authorization": "Bearer memora_live_REPLACE_WITH_YOUR_KEY"
      }
    }
  }
}
```

Codex (`~/.codex/config.toml`), with the key in the `MEMORA_API_KEY`
environment variable:

```toml
[mcp_servers.memora]
url = "https://memory.example.com/mcp"
bearer_token_env_var = "MEMORA_API_KEY"
```

Clients that only run local stdio servers, such as the Claude Desktop config
file, can bridge with `mcp-remote` (needs Node.js):

```json
{
  "mcpServers": {
    "memora": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://memory.example.com/mcp",
        "--header", "Authorization: Bearer memora_live_REPLACE_WITH_YOUR_KEY"
      ]
    }
  }
}
```

Some clients send the key as `X-API-Key: <key>` instead. Both headers are
accepted.

### With OAuth

Clients that support MCP authorization (for example Claude and ChatGPT custom
connectors, or Claude Code without a `--header`) can connect with only the URL:

```bash
claude mcp add --transport http memora https://memory.example.com/mcp
```

The flow:

1. The client calls `/mcp` without credentials and gets `401` with
   `WWW-Authenticate: Bearer resource_metadata="https://memory.example.com/.well-known/oauth-protected-resource"`.
2. It reads the protected resource metadata (RFC 9728) and the authorization
   server metadata at `/.well-known/oauth-authorization-server` (RFC 8414; also
   served at `/.well-known/openid-configuration` and under a `/mcp` suffix).
3. It registers itself with dynamic client registration at
   `POST /oauth/register` (RFC 7591), or uses an HTTPS client metadata document
   URL as its `client_id`. The owner can also register clients in the web UI.
   Redirect URIs must be HTTPS, or plain HTTP on `localhost`, `127.0.0.1` or
   `[::1]`.
4. It opens `/oauth/authorize` (authorization code with PKCE `S256` only). The
   browser lands on the Memora sign-in page, and the signed-in owner approves or
   denies the connection on a consent card. Codes are valid for 10 minutes.
5. It exchanges the code at `POST /oauth/token` and receives an access token and
   a refresh token. The only OAuth scope is `mcp`.

The access token is a regular Memora API key named after the client. It starts
with the default scopes (`mcp`, `read`, `write`) and every tool, and it shows up
on the Keys page like any other key, so you can restrict, disable or delete it
there. The access token has no expiry. A `refresh_token` grant replaces it with
a fresh one (the old token stops working at once) and rotates the refresh token.
Disabling or deleting the key ends the connection.

Set `MEMORA_BASE_URL` (for example `https://memory.example.com`) when the server
runs behind a proxy, so the issuer and endpoint URLs in the metadata are the
public ones. Without it the server derives them from the request headers.

### Test from a shell

```bash
curl -s -X POST http://localhost:8400/mcp \
  -H "Authorization: Bearer memora_live_REPLACE_WITH_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Discovery card

`GET /.well-known/mcp.json` needs no auth and returns:

| Field | Value |
|---|---|
| `name` | `memora` |
| `version` | The server version |
| `description` | One-line description of the server |
| `mcp` | `{endpoint: "/mcp", transports: ["streamable-http"], protocolVersion: "2025-06-18"}` |
| `auth` | `{type: "api-key", headers: ["Authorization: Bearer <key>", "X-API-Key: <key>"], oauth: "/.well-known/oauth-authorization-server"}` |
| `capabilities` | `{tools: true, resources: true, prompts: false}` |
| `tools` | Every catalog tool as `{name, category, description, enabled}`. `enabled` is `false` for tools switched off on this server. Admin tools are not listed. |
| `resources` | `[{uri, name}]` for the three resources below |

The card is the same for every caller. To see what a given key may call, use
`tools/list` with that key.

## Methods

| Method | Purpose |
|---|---|
| `initialize` | Handshake. Returns `protocolVersion`, `serverInfo` (`{name, version}`) and `capabilities` (`tools` and `resources`, both with `listChanged: false`). |
| `notifications/initialized` | Client notification. Without an `id` it gets `202 Accepted`. |
| `tools/list` | The tools the caller may use, each with `name`, `description` (what it does and when to use it), `inputSchema`, and `_meta.category`. |
| `tools/call` | Runs one tool. Params are `{name, arguments}`. |
| `resources/list` | Lists the three resources below. |
| `resources/read` | Reads one resource. Params are `{uri}`. |

There are no prompts, no pagination cursors and no change notifications.

### Resources

| URI | Content |
|---|---|
| `memory://catalog` | Every catalog tool with `name`, `category`, `description`, `when`, and `inputSchema` (JSON) |
| `memory://schema` | Data shapes for a note, a folder, the graph, and activity (JSON) |
| `memory://guide` | A short guide for agents using the vault (Markdown) |

`resources/read` returns `{contents: [{uri, mimeType, text}]}`.

## Results and errors

A successful tool call returns the tool's JSON result as text:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "{...}" }],
    "isError": false
  }
}
```

A tool that fails (bad arguments, note not found, unknown tool name) returns the
same envelope with `isError: true` and the error message as the text. The HTTP
status stays `200`.

JSON-RPC errors:

| Code | When |
|---|---|
| `-32700` | The body is not valid JSON (HTTP `400`). |
| `-32600` | The body is not a JSON-RPC request object (HTTP `400`). |
| `-32601` | Unknown method: `unsupported method: <method>`. |
| `-32602` | `resources/read` with an unknown URI: `unknown resource: <uri>`. |
| `-32003` | The tool exists but the caller may not use it. Messages: `tool not allowed for this API key: <name>`, `tool disabled on this server: <name>`, `API key lacks the 'write' scope for tool: <name>`. |

HTTP errors before JSON-RPC runs:

| Status | When |
|---|---|
| `401` | No key, or a key that is unknown, disabled, deleted or replaced by a roll (`invalid API key`). Carries a `WWW-Authenticate` header that points OAuth clients at the protected resource metadata. |
| `403` | The key lacks the `mcp` scope (`{"error":"API key lacks the 'mcp' scope","required_scope":"mcp"}`), or a browser request failed the same-origin check. |
| `405` | Any method other than `POST`. |
| `409` | No vault is configured yet. |
| `429` | Rate limit or cooldown after failed attempts. |

## What each key sees

`tools/list` is filtered per caller:

- A tool switched off on the server is hidden for everyone.
- A key whose tool list is not `"*"` only sees the tools in its list.
- A key without the `write` scope only sees read-only tools.
- Admin tools are added for keys with the `admin` scope (and for browser
  sessions).

`tools/call` on a tool that `tools/list` would hide returns `-32003`. Details
are in [Tool switches and per-key permissions](contracts/tools-permissions.md).

### Privacy rules

The owner can hide notes and folders from specific agents (web UI,
`/api/privacy`, or the `privacy_*` admin tools). For an API key covered by a
rule, every tool works as if the hidden paths did not exist: they are left out
of listings, search, the graph, tags, events, logs, locks and folder metadata; a
hidden path named in an argument is answered as not found, for reads and writes
alike; and folder operations that would carry hidden items along are refused.
If the rules cannot be read, the key sees nothing (fail closed). Browser
sessions are never filtered.

## Tools

R = read-only (needs only the `mcp` scope). W = changes the vault or server
state (also needs the `write` scope). Unless marked required, arguments are
optional. Paths are vault-relative, for example `Projects/Plan.md`.

### Notes (`note`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `list_memory` | R | none | Every note grouped by folder: `{folder: [{path, name, folder, mtime}]}`. |
| `read_memory` | R | `path` (string, required) | Markdown body, frontmatter, tags and backlinks of one note. |
| `create_memory` | W | `title` (string, required), `folder` (string, default `Memory`; `Root` or empty for the top level), `content` (string; default is a stub with `created` frontmatter and a heading) | Creates `<folder>/<title>.md` and returns `{ok, path}`. |
| `save_memory` | W | `path` (string, required), `content` (string, required) | Replaces the whole note. |
| `patch_memory` | W | `path` (string, required), `ops` (array, required) | Partial edits. Each op is an object: `{op:"append", text}`, `{op:"prepend", text}`, `{op:"replace", find, with}`, `{op:"set_field", field, value}`, `{op:"add_tag", tag}`, `{op:"remove_tag", tag}`. |
| `delete_memory` | W | `path` (string, required) | Deletes a note (recoverable from git history). |
| `move_memory` | W | `path` (string, required), `folder` (string, required) | Moves a note into another folder. Wikilinks resolve by note name, so they keep working. |
| `rename_memory` | W | `path` (string, required), `new_name` (string, required) | Renames a note in its folder. |

### Search (`search`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `get_stats` | R | none | Counts of notes, links and folders. |
| `search_memory` | R | `q` (string, required; `query` is accepted as an alias), `limit` (integer, default 12) | Search titles and bodies. Supports `tag:x` and `#x`. |

### Query (`query`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `query_memory` | R | `folder`, `tags`, `author`, `type`, `status` (strings), `limit` (integer, default 50) | Filter notes by frontmatter. |
| `find_similar` | R | `path` (string, required), `limit` (integer, default 8) | Notes most similar to one note (shared tags and words). |
| `suggest_links` | R | `path` (string, required), `limit` (integer, default 8) | Similar notes not yet linked from this one. |
| `list_tags` | R | none | Every tag with its usage count. |
| `rename_tag` | W | `old` (string, required), `new` (string, required) | Renames a tag across the vault. |
| `merge_tag` | W | `a` (string, required), `b` (string, required) | Merges tag `a` into tag `b` across every note. |

### Tags (`tag`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `get_tags` | R | `path` (string; not in the advertised schema) | Every tag with its count, or the tags of one note when `path` is given. |
| `search_by_tag` | R | `tag` (string, required), `limit` (integer, default 50; not in the advertised schema) | Every note carrying a tag. |
| `add_tags` | W | `path` (string, required), `tags` (string, required, comma-separated) | Adds tags to a note. A leading `#` is stripped. |
| `remove_tags` | W | `path` (string, required), `tags` (string, required, comma-separated) | Removes tags from a note. |
| `set_tags` | W | `path` (string, required), `tags` (string, required, comma-separated) | Replaces a note's tag list. |

### Folders (`folder`, `ops`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `list_folders` | R | none | `{count, folders: [{name, count, color}]}`. |
| `create_folder` | W | `name` (string, required) | Creates a folder. |
| `rename_folder` | W | `folder` (string, required), `name` (string, required, one segment) | Renames a folder in place. Notes, sub folders, color and icon move along. |
| `move_folder` | W | `folder` (string, required), `into` (string; empty or `Root` = top level) | Moves a folder with everything in it. |
| `move_folder_contents` | W | `folder` (string, required), `into` (string; empty = top level) | Moves everything inside a folder into another folder, then removes the empty folder. Name clashes get a `-N` suffix. |
| `delete_folder` | W | `folder` (string, required) | Deletes a folder. Its notes move to Root. |
| `folder_stats` | R | `folder` (string, required) | Note count and metadata for one folder. |
| `get_folder_meta` | R | `folder` (string) | Color, icon and description of one folder, or of every folder. |
| `set_folder_meta` | W | `folder` (string, required), `color`, `icon`, `desc` (strings) | Sets folder display metadata. A field sent as an empty string is cleared. |

### Graph (`graph`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `get_graph` | R | none | Whole graph: `{nodes: [{id, path, folder, color, degree, tags, mtime}], links: [{source, target}]}`. |
| `get_neighbors` | R | `path` (string, required), `depth` (integer, default 1) | Notes within N hops. |
| `get_subgraph` | R | `path` (string, required), `depth` (integer, default 1), `max_nodes` (integer, default 60) | Subgraph around one note. |
| `find_path` | R | `source` (string, required), `target` (string, required) | Shortest wikilink path between two notes. |
| `get_hubs` | R | `limit` (integer, default 10) | Most connected notes. |
| `get_isolated` | R | none | Notes with no links in or out. |
| `link_stats` | R | `path` (string, required) | Outgoing, incoming and unresolved links of one note. |
| `broken_links` | R | none | Wikilinks pointing at notes that do not exist. |

### Versioning (`version`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `get_history` | R | `path` (string, required), `limit` (integer, default 20) | Git history of a note. A single entry is returned as an object, several as an array. |
| `get_note_at` | R | `path` (string, required), `rev` (string, required) | `{ok, path, rev, content}` at a revision. |
| `diff` | R | `path` (string, required), `rev_a` (string, required), `rev_b` (string) | Diff between two revisions, or `rev_a` against the working tree. |
| `restore_memory` | W | `path` (string, required), `rev` (string, required) | Restores a note to a revision. |
| `snapshot` | W | `label` (string, required) | Tags the whole vault (git tag). |
| `soft_delete` | W | `path` (string, required) | Moves a note to `.Trash`. |
| `restore_trash` | W | `name` (string, required), `into` (string, default `Root`) | Restores a note from `.Trash` into a folder. |

### Bulk writes (`write`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `batch_create` | W | `notes` (array, required) of `{title, folder (default Root), content}` | Creates many notes in one call. |
| `duplicate_memory` | W | `path` (string, required) | Copies a note as `<name>-copy` in the same folder. |
| `merge_memory` | W | `paths` (array of strings, required), `into` (string, required) | Merges several notes into one target note. |
| `template_create` | W | `template` (string, required), `title` (string, required), `folder` (string, default `Root`), `variables` (object) | Creates a note from a file in `Templates/` with `{{var}}` substitution. |
| `bulk_replace` | W | `find` (string, required), `replace` (string, required), `folder` (string), `regex` (boolean, default false), `dry_run` (boolean, default false) | Find and replace across notes. Needs `write` even with `dry_run`. |
| `bulk_delete` | W | `paths` (array of strings), `folder` (string) | Deletes many notes by list or by folder. |

### Collaboration (`collab`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `lock_node` | W | `path` (string, required), `owner` (string, default the caller), `ttl` (integer seconds, default 300) | Soft lock on a note. |
| `release_lock` | W | `path` (string, required), `owner` (string, default the caller) | Releases a lock. |
| `get_locks` | R | none | Active locks. |
| `mention_agent` | W | `agent` (string, required), `path` (string, required), `message` (string) | Writes `> @agent: message` into a note. |
| `get_assignments` | R | `agent` (string) | Notes with `assigned_to` in their frontmatter. |

### Activity and health (`ops`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `get_events` | R | `since` (number, unix time), `folder`, `actor` (strings), `limit` (integer, default 50) | Recent note created, updated and deleted events. |
| `presence` | R | `window` (integer seconds, default 300) | Agents active within the window. |
| `get_logs` | R | `range` (string, default `1d`; also `7d`, `today`, `yesterday`), `actor` (string), `limit` (integer, default 100) | Activity log for a period. |
| `search_logs` | R | `q` (string, required), `range` (string, default `7d`), `actor` (string), `limit` (integer, default 100) | Keyword search in the activity log. |
| `digest` | R | `folder` (string), `since` (number) | Event counts per actor and per type. |
| `healthcheck` | R | none | Note count, broken links, orphans and git status. |
| `stale_detection` | R | `days` (integer, default 30) | Notes untouched for more than N days. |

### Identity (`identity`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `set_my_name` | W | `name` (string, required) | Sets the display alias shown in the activity feed and log. |
| `set_my_color` | W | `color` (string, required; `#rrggbb`, or `""` to reset) | Sets the calling API key's display color. Fails for browser sessions. |
| `list_actors` | R | none | `{me, aliases}`: the caller and every known alias. |

### Import and export (`interop`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `export_memory` | W | `paths` (array of strings, required; notes or folders), `out_path` (string) | Writes a zip of the given paths to the server's exchange folder and returns `{ok, path, name, bytes}`, where `path` and `name` are the zip's file name. `out_path` is a plain file name ending in `.zip` (letters, digits, `.`, `_`, `-`, at most 120 characters); the default is `memora-export-<time>.zip`. |
| `import_memory` | W | `zip_path` (string, required), `overwrite` (boolean, default false) | Imports notes from a zip in the exchange folder, by the file name `export_memory` returned. |

The exchange folder is `memora-exchange` in the server's temporary directory.
Tools never read or write anywhere else on the server's disk.

### Checks and to-dos (`ux`)

| Tool | | Arguments | Purpose |
|---|---|---|---|
| `get_todos` | R | `path` (string) | Open checklist items (`- [ ]`) in one note or the whole vault. |
| `follow_ups` | R | none | Notes whose status is still awaiting action. |
| `validate_memory` | R | `path` (string, required) | Checks frontmatter, created date, tags and links of a note. |

### Admin tools (`admin`)

Listed and callable only for keys with the `admin` scope (and for browser
sessions). They are not part of the switchable catalog: global tool switches and
a key's tool list do not apply to them, and they do not need `write`.

| Tool | Arguments | Purpose |
|---|---|---|
| `admin_list_tools` | none | `{tools: [{name, category, description, enabled}]}` for every catalog tool. |
| `admin_set_tool` | `name` (string, required), `enabled` (boolean, required) | Switches a catalog tool on or off for every key. Returns `{ok, name, enabled}`. |
| `privacy_list` | `path` (string), `kind` (`node` or `folder`) | Without `path`: every privacy rule. With `path`: that note or folder's own rule, the folder rules it inherits, and which agents can see it. |
| `privacy_set` | `path` (string, required), `agents` (array of key ids or names, required; a comma-separated string also works), `kind` (`node` or `folder`), `mode` (`deny` or `allow_only`, default `deny`) | Replaces the rule on a path. `deny` hides it from the listed agents; `allow_only` hides it from every other agent, including keys created later. `deny` with no agents removes the rule. A node rule follows its note through renames and moves. |
| `privacy_clear` | `path` (string, required), `kind` (`node` or `folder`) | Removes the path's own rule. Rules on parent folders still apply. |

When `kind` is omitted it is taken from the path on disk: a folder if a folder
exists there, otherwise a note.

## Identity and tracking

Every tool call is published to the web UI's realtime activity stream as an
`ai_activity` start and end pair, named after the API key (or the signed-in
user), with the note paths involved. Calls are also counted per key: the Keys
page and `GET /api/keys` show each key's `uses`, `last_ip`, and the tools it has
called recently. `initialize` registers the connection under the key's name
(`GET /api/aliases`). `set_my_name` changes the alias shown in the activity
feed and log, and `set_my_color` changes the key's color in the UI. See
[API.md](API.md) for the HTTP endpoints.
