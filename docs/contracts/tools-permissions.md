# Tool switches and per-key permissions

This page describes how Memora decides which MCP tools an agent may see and
call. Two controls combine:

- **Global tool switches** turn a tool off for every API key on the server.
- **Per-key permissions** (scopes and a tool list) limit what one key may do.

They are managed in the web UI, with `memora-cli` (`/tools` and `/keys`), over
the HTTP API, and with the MCP admin tools. All of them write the same state
database (`state/memora.db`, see [../DATABASE.md](../DATABASE.md)). Tool
switches and per-key tool lists from older installs (`state/tools.json` and the
`tools` field of keys in `gateway.json`) are imported into the database once.

## Tool catalog

The switchable catalog is `memora_mcp::catalog()`: every tool with its `name`,
`category`, `description`, when to use it, and input schema (71 tools; see
[../MCP.md](../MCP.md#tools)). At startup the server mirrors the catalog into
the `tool` table, so switches and per-key grants can refer to tools by name.
A tool that leaves the catalog is marked retired, not deleted: its switch and
grants are kept but have no effect, and they apply again if the tool returns.

The admin tools (`admin_list_tools`, `admin_set_tool`, `privacy_list`,
`privacy_set`, `privacy_clear`) are not part of the catalog. They cannot be
switched off or granted through a tool list; only the `admin` scope controls
them.

## Global tool switches

Table `tool_disabled` holds one row per switched-off tool. No row means the tool
is on. A switched-off tool is hidden from `tools/list` and refused by
`tools/call` for every caller, browser sessions included. It is still listed in
the discovery card and on the `/tools` page, marked as disabled.

Switching a tool that is already in the requested position changes nothing.
A change made by another process (for example `memora-cli` while the server
runs) reaches the server within about a second, without a restart.

## Scopes

Each key has a set of scopes (table `api_key_scope`):

| Scope | Allows |
|---|---|
| `mcp` | Calling `/mcp` at all, and every read-only MCP tool. |
| `read` | `GET` and `HEAD` on the `/api/*` vault routes. |
| `write` | Mutating `/api/*` vault routes, and every MCP tool that is not read-only. |
| `admin` | Managing tools, keys, access rules, log settings, OAuth clients and privacy rules (`/api/tools`, `/api/keys`, `/api/access`, `/api/logs/settings`, `/api/oauth/clients`, `/api/privacy` and everything below them), and the MCP admin tools. |

A key created without explicit scopes gets `mcp`, `read` and `write` and every
tool. Keys that MCP clients obtain through OAuth start with the same defaults.
`admin` is never granted by default. An empty scope list on create also means
the defaults.

## Per-key tool list

Each key either may use every catalog tool (`"tools": "*"`, stored as
`api_key.tools_all = 1`, the default) or only the tools listed for it
(`"tools": ["search_memory", "read_memory"]`, stored as `tools_all = 0` plus one
`api_key_tool` row per tool). An empty list allows no catalog tools. Tool names
must be catalog tools; unknown names are refused with `unknown tool: <name>`.

The tool list does not replace scopes: a tool that changes the vault still
needs `write`, even when the list names it.

## Effective access

A key may call catalog tool T over MCP when all of these hold:

1. The key is enabled.
2. The key has the `mcp` scope.
3. T is not switched off globally.
4. The key's tool list is `"*"` or contains T.
5. T is read-only, or the key has the `write` scope.

Read-only tools are the ones listed as read-only in `crates/mcp/src/activity.rs`
(the R tools in [../MCP.md](../MCP.md#tools)). Every other catalog tool needs
`write`, including tools added later until they are marked read-only.

An admin tool may be called when the key is enabled and has both `mcp` and
`admin`. Browser sessions have full access, including the admin tools, but
global switches still apply to them.

Disabled keys are rejected before MCP runs (HTTP `401`, `invalid API key`), and
a key without `mcp` gets HTTP `403` with
`{"error":"API key lacks the 'mcp' scope","required_scope":"mcp"}`.

## How refusals look

`tools/list` returns only the tools the caller may use (plus the admin tools for
admin keys).

`tools/call` on a tool the caller may not use returns JSON-RPC error `-32003`
with one of these messages:

| Message | Cause |
|---|---|
| `tool not allowed for this API key: <name>` | The key's tool list does not include the tool, or the caller lacks `admin` for an admin tool. |
| `tool disabled on this server: <name>` | The tool is switched off globally. |
| `API key lacks the 'write' scope for tool: <name>` | The tool is not read-only and the key has no `write` scope. |

A name that is neither a catalog tool nor an admin tool is not refused with
`-32003`; the call returns a tool result with `isError: true` and
`unknown tool: <name>`.

## HTTP API

These routes need a signed-in browser session or an API key with the `admin`
scope. For browser sessions, `POST` requests must be same-origin.

| Route | Body | Response |
|---|---|---|
| `GET /api/tools` | | `{tools: [{name, category, description, enabled}]}` |
| `POST /api/tools` | `{name, enabled}` | `{ok, name, enabled}`. Unknown tool or missing `enabled`: `400`. |
| `GET /api/keys` | | `{count, keys}`. Each key includes `tools` (`"*"` or a list) and `scopes`. |
| `POST /api/keys` | `{name, tools?, scopes?, color?}` | `{ok, id, key, name, prefix, persisted, color, tools, scopes}`. The raw `key` is returned once. |
| `POST /api/keys/update` | `{id, name?, enabled?, color?, tools?, scopes?}` | `{ok, id, name, enabled, color, tools, scopes, persisted}` |

`tools` is `"*"` or an array of catalog tool names. `scopes` is an array of
`mcp`, `read`, `write` and `admin`. Fields left out stay unchanged. Unknown tool
or scope names return `400` (`unknown tool: <name>`, `unknown scope: <name>`).

## MCP admin tools

Listed only for keys with the `admin` scope:

- `admin_list_tools`: no arguments. Same shape as `GET /api/tools`.
- `admin_set_tool`: `{name, enabled}`. Same effect as `POST /api/tools`.

The privacy admin tools (`privacy_list`, `privacy_set`, `privacy_clear`) are
described in [../MCP.md](../MCP.md#admin-tools-admin).

## Activity log

Every change is written to the `activity` table in the same transaction:

| Event | When | Detail |
|---|---|---|
| `tool_enabled` | A tool is switched on | The tool name |
| `tool_disabled` | A tool is switched off | The tool name |
| `key_permissions` | A key's scopes or tool list are set on create or changed on update | `<id> tools=[...] scopes=[...]` |

Creating and updating a key also logs `key_created` and `key_updated`. The actor
is the signed-in user, or `key:<id>` when an API key made the change.
