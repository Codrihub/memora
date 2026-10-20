# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Windows is installed with npm (`npm install -g @codrihub/memora`); releases no
  longer carry a separate Windows zip. The npm package for Windows x64 is built
  and tested as before. Zips of 1.3.0 to 1.3.5 stay on their release pages.

## [1.3.5] - 2026-10-20

### Fixed

- Memora slowed to a crawl under steady agent traffic: with a few hundred notes
  and a few MCP calls per second, the web UI (tree, notes, agents) took tens of
  seconds to answer. Tag lookups (`search_by_tag`, `list_tags`) re-rendered every
  note while holding the vault lock, MCP calls and vault reads blocked the
  server's async workers, and the note view walked the vault once per link. Tag
  lookups now read the note cache, reads run off the async workers on a snapshot
  of the vault, and a write refreshes only the note it changed. Under the same
  traffic the tree and note requests answer in about 20 ms instead of 20-35 s.
- The node card in Brain, Graph and Canvas no longer flashes its loading state
  and refetches the note on every realtime update; it refreshes only when that
  note changes.
- The Tags page builds its index in one request instead of one per note.

## [1.3.4] - 2026-10-20

Every MCP tool was tested against bad, missing, hidden and extreme input. This
release fixes what that found. Some calls that used to be accepted, and did
something other than what was asked, are now refused with a clear message.

### Added

- Agent instructions come in five styles: Balanced (recommended), Remember
  everything, Private, Session journal and Read only, each in a full and a
  short version, on the docs page, in the connect guide and in the console.
  Remember everything warns that secrets end up as plain Markdown and how to
  hide them with privacy rules. Where to paste covers more clients.
- The live panel in the header opens an agent's page; in Activity, an agent's
  name on any row, the event drawer and an agent's activity page do too.
- `list_trash` (MCP): the notes in the trash, with where they came from.
- Version history can be turned on with a plain `git init` in the vault;
  `docs/CONFIGURATION.md` explains how.

### Changed

- `tools/call` checks arguments against the tool's schema: unknown names,
  missing required arguments, wrong types, values outside an enum and numbers
  below the minimum are refused. Every tool error starts with the tool name.
- Search no longer keeps a `.fts.db` index. Search and the graph, query and
  digest tools read one in-memory cache that follows the files on disk, so
  results are right at startup and include notes changed outside Memora.
  Old `.fts.db` files are removed.
- `bulk_delete` moves notes to the trash, and refuses the whole call when any
  path is wrong. `restore_trash` puts a note back where it was.
- Moving or renaming a note or folder rewrites the wikilinks that pointed to
  it, in MCP and in the web UI; results report `links_updated`.
- `delete_folder` moves notes to the parent folder and keeps their subfolders.
- Soft locks are enforced: an agent cannot write to a note another agent has
  locked, and only the holder (or the owner) can release a lock.
- Tags may contain letters, digits and `- _ / .`; tag tools ignore case.
  Frontmatter fields refuse line breaks.
- `follow_ups` returns `{notes, count, truncated}` and takes `limit`; it also
  counts `waiting` and `blocked`. `digest` reports all events and takes `limit`.
- Export and import use an exchange folder inside the state folder (0700),
  not a folder shared by every instance in `/tmp`.
- `template_create` only reads templates from `Templates/`.

### Fixed

- `move_memory` without `folder` moved the note to the top level, and
  `create_memory` with an unknown argument created the note somewhere else.
- `bulk_replace` with an empty `find` inserted text between every character.
- Tags or fields with line breaks or YAML characters could break a note's
  frontmatter; `mention_agent` could add fake mention lines.
- `privacy_set` with an empty agent list removed the rule, exposing a hidden
  folder; an agent could take another agent's display name or "owner".
- An agent could release or create locks in another agent's name.
- `template_create` could read any note, including hidden ones.
- Search snippets mixed highlight tags with raw note HTML.
- `get_subgraph` reversed edges, dropped one side of two-way links and
  returned one node too many; nested folders were ignored by `query_memory`,
  `digest`, `bulk_replace` and `bulk_delete`; `list_memory` showed nested
  notes under their top-level folder.
- `merge_memory` skipped missing sources silently, merged a note into itself
  and pasted frontmatter into the body; `batch_create` ignored typos.
- `create_folder` accepted `Root`; `move_folder` into a note created a folder.
- History tools returned empty results when the vault has no git repository;
  they now say version history is off. `snapshot` explains its refusals.
- Many tools returned an empty success for paths that do not exist; they now
  say what is missing.
- Parallel calls of one tool could close each other's rows in Activity.
- `batch_create` did not tell open browsers about the notes it created.

## [1.3.3] - 2026-10-20

### Added

- Agents see new tools without reconnecting. The MCP session id now carries
  the tool catalog it was issued for; when tools are added or switched off
  (after an update, or in Settings), the next request on an older session is
  answered as a short SSE stream that first sends
  `notifications/tools/list_changed`, once, and then the normal response.
  `initialize` advertises `tools.listChanged: true`. Old sessions are never
  refused, so clients that do not re-initialize keep working. This is what
  made `list_pins`, `pin` and `unpin` missing for agents connected before
  1.2.2.
- Pins animate when they are added, moved or removed, in every open browser,
  and a toast names the agent or person who pinned or unpinned (following the
  activity toast setting).
- `memora-cli stop` stops a background server gracefully on every OS through
  `POST /_stop`, a loopback-only request that needs the token the server
  writes to `<state>/stop.token`. It falls back to SIGTERM or `taskkill`.

### Fixed

- Windows: `memora-cli stop` without `--force` could not stop a server it
  started, because Windows refuses a polite `taskkill` for a process without
  a console.
- Windows: `memora-cli start` handed its console pipes to the server, so a
  script or CI step reading its output waited until the server exited.
- Windows: the vault chooser in the browser (first run and Settings) refused
  paths such as `C:\Users\you\memora`; it accepts drive and UNC paths.
- Windows: `memora-cli db backup` always failed with "Access is denied",
  which also stopped the final backup during uninstall (nothing was
  deleted). `db restore` finds a server started by `memora-cli start` and
  says clearly when the database is in use.
- Windows: paths are stored and printed without the `\\?\` prefix
  (`memora-cli vault`, uninstall output, the npm assets path in the log).
- Windows: Ctrl+C in the console restores the console input mode, so the
  shell never stays without echo after a password prompt.

## [1.3.2] - 2026-10-20

### Added

- `memora-cli start`, `stop` (`--force`), `restart` and `uninstall`, and
  `/start`, `/shutdown` (alias `/stop`), `/restart` and `/uninstall` in the
  console. They detect how the install runs: a systemd service is driven
  with `systemctl`; an npm, release zip or source install runs the server in
  the background with `memora.pid` and `memora.log` in the state folder;
  inside Docker the console prints the host commands.
- Uninstall explains what it removes, then offers a checklist (space to
  select) to also delete the settings and accounts and the vault. Both are
  kept by default; deleting the vault needs its folder name typed, a final
  database backup is offered before the state goes, and system folders, the
  home folder and the program folder are never deleted. Without a terminal
  it needs `--yes` and only deletes what `--delete-config` and
  `--delete-vault` say.
- `/guide` gains a "Run and manage the server" step; `memora-cli docs manage`
  covers it per install.

### Changed

- The install guide's introduction names Windows and the npm and zip
  installs and leads with `memora-cli setup`.

## [1.3.1] - 2026-10-20

### Added

- Shut the server down from the browser: Settings, Server, Shut down (owner
  only, after a confirmation). The server stops gracefully and exits with
  status 0. When systemd (`Restart=always`) or Docker starts it again, the
  confirmation says so and shows the stop command to use instead.
  `POST /api/server/shutdown` refuses API keys and cross-site requests.
- One floating back-to-top button on every scrolling page, at the bottom
  right and above the tab bar on phones.

### Changed

- The welcome screen of a new instance is a wider two-column card, and its
  steps use `memora-cli setup` (it prints the code and the link) with the
  install's own command prefix.
- At tablet widths the profile menu opens as a popover next to the sidebar
  instead of a bottom sheet.
- README and the install guide list start, stop and restart per install.

### Fixed

- Code in reading themes: inline code and code blocks take the theme's
  colours (Paper on the dark app was 1.3:1, now about 12:1).
- The `web/node_modules` symlink of a work tree slipped into 1.2.3; it is no
  longer tracked and the ignore rules now match a folder or a link.

## [1.3.0] - 2026-10-19

### Added

- Native Windows support: `memora` and `memora-cli` build and run on Windows
  10/11 (x64), and `npm install -g @codrihub/memora` installs the new
  `@codrihub/memora-win32-x64` package there. The release workflow builds it
  with a static C runtime.
- A Windows zip on every GitHub release
  (`memora-<version>-x86_64-windows.zip`, listed in `SHA256SUMS`) with
  `memora.exe`, `memora-cli.exe` and the web UI: unzip and run, no installer
  or Node needed.

### Changed

- On Windows, `memora-cli` runs database work in-process (there is no root
  privilege drop), reports state files as private, and finds `sqlite3.exe`
  on `PATH` for `db shell`.
- The vault folder may be a Windows absolute path (`C:\...` or
  `\\server\share`). Migration 8 rebuilds the `settings` table so the
  database accepts it; Unix paths are unchanged. On Windows, system folders
  (`%SystemRoot%`, `%ProgramFiles%`, `%ProgramData%`) are refused as vaults.
- `memora` finds its web UI in an `assets` folder next to the executable
  (an unpacked release zip or tarball) when `MEMORA_ASSETS` is not set.

### Fixed

- The Windows system-folder check compares paths without regard to case, so
  `C:\Windows` is refused even when `%SystemRoot%` reads `C:\WINDOWS`.

## [1.2.3] - 2026-10-19

### Added

- Pins are saved on the server instead of in each browser. They follow a
  note or folder when it is renamed, moved, trashed or deleted (including
  everything inside a moved folder), show on every device, and update live
  in open browsers. A pin whose item disappeared outside Memora stays
  visible as "Not found" with a remove button. Existing browser pins are
  uploaded once. Migration 7 adds the `pin` table.
- Pins over HTTP (`GET`/`PUT /api/pins`, `POST /api/pins/pin`,
  `POST /api/pins/unpin`, signed-in owner only) and over MCP: `list_pins`
  (read), `pin` and `unpin` (write), under the usual key scopes, tool grants
  and privacy rules.

### Changed

- Install in three steps: one command (the installer, a single
  `docker run` with named volumes, or npm), `memora-cli setup` for a
  one-time code, then the link it prints. README, the install guide and the
  in-app Get started page lead with it.
- The desktop sidebar is a little wider (288 px) and the profile menu fits
  its width. While dragging onto Pinned, only the drop box is highlighted.

### Fixed

- `patch_memory`: an op missing a required field is an error instead of an
  empty value. A `replace` without its replacement used to delete the
  matched text; an empty `find` or one that matches nothing now fails too.
  `replace` accepts `replace` as an alias of `with`, and the tool
  description lists every op and its fields.
- Wikilinks written as `[[target\|alias]]` (the escape used inside tables)
  no longer count the backslash as part of the target, so the graph,
  backlinks and broken-link checks see the right note.
- `docker-compose.yml` pointed at an old image; it now follows the release.

## [1.2.2] - 2026-10-19

### Added

- npm install for Linux x86_64 and arm64: `npm install -g @codrihub/memora`
  provides the `memora` and `memora-cli` commands. npm picks the matching
  `@codrihub/memora-linux-x64` or `-linux-arm64` package with the prebuilt
  release binaries; nothing is downloaded by an install script. The web UI
  ships in the package. Other platforms get a clear message pointing to
  Docker or a source build. The release workflow builds, smoke tests and
  publishes the packages at the release version when the `NPM_TOKEN` secret
  is set.
- `memora-cli update` recognises an npm install and prints the npm command
  to update it.

## [1.2.1] - 2026-10-19

### Changed

- Each agent has its own page at `/agents/<id>` with tabs for Overview,
  Setup, Activity, Access and Settings, each with its own address, instead
  of a long sheet. Overview shows its stats, recent calls, app, access and
  key; Activity groups calls by day with search, status and range filters.
- An agent's app is locked once it is known. Setup shows only that app's
  guide; there is no switching an agent to another app any more. A guessed
  app is confirmed once, and an agent without an app picks it once. For
  another app or device, create a new agent.
- New agents are made on a page at `/agents/new` with a stepper that stays
  in view, a summary panel, and a recommendation of one agent per app or
  device so Activity shows who did what. Old `/agents#connect` links still
  work.

### Fixed

- Tables: an aliased wikilink such as `[[Folder/Note|name]]` in a cell no
  longer splits the cell and adds a column. Escaped pipes (`\|`) work, and
  rows with too few or too many cells fit the header.

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

[1.3.5]: https://github.com/Codrihub/memora/releases/tag/v1.3.5
[1.3.4]: https://github.com/Codrihub/memora/releases/tag/v1.3.4
[1.3.3]: https://github.com/Codrihub/memora/releases/tag/v1.3.3
[1.3.2]: https://github.com/Codrihub/memora/releases/tag/v1.3.2
[1.3.1]: https://github.com/Codrihub/memora/releases/tag/v1.3.1
[1.3.0]: https://github.com/Codrihub/memora/releases/tag/v1.3.0
[1.2.3]: https://github.com/Codrihub/memora/releases/tag/v1.2.3
[1.2.2]: https://github.com/Codrihub/memora/releases/tag/v1.2.2
[1.2.1]: https://github.com/Codrihub/memora/releases/tag/v1.2.1
[1.2.0]: https://github.com/Codrihub/memora/releases/tag/v1.2.0
[1.1.5]: https://github.com/Codrihub/memora/releases/tag/v1.1.5
[1.1.4]: https://github.com/Codrihub/memora/releases/tag/v1.1.4
[1.1.3]: https://github.com/Codrihub/memora/releases/tag/v1.1.3
[1.1.2]: https://github.com/Codrihub/memora/releases/tag/v1.1.2
[1.1.1]: https://github.com/Codrihub/memora/releases/tag/v1.1.1
[1.1.0]: https://github.com/Codrihub/memora/releases/tag/v1.1.0
[1.0.0]: https://github.com/Codrihub/memora/releases/tag/v1.0.0
