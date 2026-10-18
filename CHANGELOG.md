# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-10-18

### Added

- Settings, Notifications: turn agent activity toasts off for every agent,
  or for single API keys. The main switch always wins: when it is off, no
  activity toast appears, even for keys that are turned on.
- Node editor: Save and Cancel buttons. On phones they sit in a large bar
  pinned to the bottom of the screen while editing. Cancel asks before
  discarding changes, Esc cancels, and Ctrl+S saves without closing.

### Changed

- The node editor no longer saves while you type; changes are saved with
  Save or Ctrl+S, and closing the tab with unsaved changes asks first.
  Leaving the node still keeps your changes.

## [1.1.5] - 2026-10-18

### Fixed

- Folder icons given by name (for example `credit-card`, `cpu` or `key`, as
  agents often set them) showed the name as text. More icons are built in,
  common names and aliases map to them, and an unknown name falls back to
  the folder icon. The `set_folder_meta` MCP tool lists the icon names.

## [1.1.4] - 2026-10-18

### Fixed

- "On this page" in the node reader and the documentation: the last
  sections are now marked when scrolled to the bottom, a clicked entry is
  marked right away and stays marked while the page scrolls to it, and the
  current section is picked earlier while scrolling.

### Changed

- README: a centered header with the logo, badges and links, and screenshots
  as JPEG so they display everywhere.

## [1.1.3] - 2026-10-18

### Fixed

- After an update, a normal reload or a hard reload could show the offline
  page. The service worker now only serves the offline page when the server
  really cannot be reached (after a retry); pages, scripts and styles always
  come from the network, the app script URL carries a content hash, and the
  service worker itself is never served from the HTTP cache.
- The offline page retries on its own and returns as soon as the server is
  back.

## [1.1.2] - 2026-10-18

### Changed

- Agents & API keys page redesigned: a stats strip (agents, active now, calls
  in 24 hours, MCP endpoint), and an agents list that is a table on wide
  screens, condensed rows on tablets and cards on phones, with the app each
  agent uses, its status, access summary, a 24-hour sparkline and last call.
- Clicking an agent opens a detail sheet with its stats, the app it is used
  with, access, key details, activity and every action (rename and color,
  show key, new key, turn off or on, delete, edit permissions, set up again).
- Connecting an app: pick the app, name the agent and choose Read & write,
  Read only or Custom access, then follow the setup with the new key filled
  in and a live "Connected" check. Setting up an existing agent goes straight
  to its app, with an inline unlock for a sealed key.
- Permissions editor: a live summary, capability toggles with plain
  descriptions, and a searchable tool picker grouped by category.
- Every dropdown in the web UI is a custom, keyboard-accessible select that
  works inside sheets and opens as a bottom sheet on phones.

## [1.1.1] - 2026-10-18

### Added

- Documentation in the web UI at `/docs`: getting started, agent
  instructions, connecting agents, install, configuration, MCP, a live tool
  reference, API, security, deployment, architecture, database, changelog and
  keyboard shortcuts, with search, an on-page table of contents and copy
  buttons. Reachable from the profile menu, the help dialog, the search
  palette and Settings.
- `/docs` in the setup console and `memora-cli docs [topic]`: the same topics
  in the terminal, including the recommended agent instructions.
- Recommended agent instructions (a full and a short prompt) that tell an
  agent to recall from Memora before answering and to save what is worth
  keeping, with where to paste them for each client.

### Changed

- Connecting an app is a four-step wizard (app, key, set up, instructions)
  instead of a sideways carousel: searchable app grid, inline key creation,
  filled-in config with a copy button, a live "Connected" check and the
  agent instructions. `/agents#connect` opens it directly.

## [1.1.0] - 2026-10-18

### Changed

- Search engines and AI crawlers are kept out of every page: `robots.txt`
  now disallows the whole instance (with explicit rules for common AI
  crawlers), and every response and page carries
  `noindex, nofollow, noarchive, nosnippet, noimageindex`.
- README: one-command install and screenshots of the web UI.

## [1.0.0] - 2026-10-18

First public release.

### Added

- Vault of plain Markdown files with folders, wikilinks, tags, backlinks,
  pins, trash and history.
- MCP server over Streamable HTTP with 71 tools (read, search, write, organize,
  graph, interop) and admin tools for keys and tool switches.
- API keys per agent with scopes (`mcp`, `read`, `write`, `admin`), per-key tool
  lists, global tool switches, key rolling and revocation. MCP tools that change
  the vault require the `write` scope.
- OAuth 2.1 sign-in for MCP clients (authorization code with PKCE, dynamic
  client registration, client metadata documents).
- Per-agent privacy for folders and notes; rules follow renames and moves.
- Access rules by IP, network, range or domain, first match wins.
- Web UI: Overview, Brain (3D), Graph, Canvas, Nodes with reader and editor,
  Tags, Activity with per-agent pages, Agents and API keys, Tools, Access rules
  and Settings; light, dark and system themes; installable PWA.
- Activity log of every agent call with filters, export and retention settings.
- State in one SQLite database (`<state>/memora.db`) with migrations, backup,
  restore and integrity check.
- `memora-cli` with an interactive setup console (`/welcome`, `/setup`, `/web`,
  `/keys`, `/tools`, `/mcp`, `/status`, ...), one-time setup codes and updates.
- Release check: the server looks up the newest GitHub release every 6 hours
  and the web UI shows when an update is available (`MEMORA_UPDATE_CHECK=false`
  turns it off).
- Docker image, Docker Compose file and an installer script with checksum
  verification.

[1.2.0]: https://github.com/Codrihub/memora/releases/tag/v1.2.0
[1.1.5]: https://github.com/Codrihub/memora/releases/tag/v1.1.5
[1.1.4]: https://github.com/Codrihub/memora/releases/tag/v1.1.4
[1.1.3]: https://github.com/Codrihub/memora/releases/tag/v1.1.3
[1.1.2]: https://github.com/Codrihub/memora/releases/tag/v1.1.2
[1.1.1]: https://github.com/Codrihub/memora/releases/tag/v1.1.1
[1.1.0]: https://github.com/Codrihub/memora/releases/tag/v1.1.0
[1.0.0]: https://github.com/Codrihub/memora/releases/tag/v1.0.0
