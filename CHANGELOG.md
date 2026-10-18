# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.0]: https://github.com/Codrihub/memora/releases/tag/v1.1.0
[1.0.0]: https://github.com/Codrihub/memora/releases/tag/v1.0.0
