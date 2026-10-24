# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-10-24

A redesign of every page around one calm look, with new tools where people
spend their time: version history for notes, tag patterns, an Activity summary
and a cleaner way to read. The license changes to the GNU AGPL. The state
database needs no migration: a 1.3 install updates in place and can roll back
by swapping the binary.

### Added

- Version history for every note: browse versions with who made them, preview
  one, compare it with the current text and restore it. Restoring adds a new
  version, so nothing is lost. Over HTTP: `GET /api/history`,
  `GET /api/note-at`, `GET /api/diff` and `POST /api/history/restore`; the MCP
  tool `get_history` now also returns `version` and `total`.
- A Trash page at `/trash`: restoring asks where the note goes (its folder,
  another folder or the top level), and deleting for good asks you to type
  DELETE (DELETE ALL to empty the Trash).
- Tags: pick or tick tags to see their notes at once, preview a note in the
  map's card, merge, rename or remove tags in bulk, and find notes by a
  pattern of tags joined with and, or and not.
- Activity is a summary page (numbers, actions over time, what agents do most,
  problems, most touched notes, agents) with every action on its own
  Timeline tab at `/activity/timeline`. An agent's activity lives on its own
  page at `/agents/<id>/activity`.
- Reading: Contents (outline, links, mentions and details) beside the note,
  and a fold-away toolbar (F) for a clean page.
- Maps: a clean view that hides every control (C), a dot grid switch, note
  titles on the maps, and a first-setup guide while the vault is empty.
- Settings: edit the server name and how long browsers stay signed in
  (`POST /api/settings/server`, admin); the folder switch says what moves
  with each notes folder.
- What's new: the notes of each release, shown once after an update and from
  the profile menu or Settings, Version, with a quiet link to star the project.
- New notes keep their title as the file name, spaces included, and the web
  app shows display titles (front matter title or first heading).
- Refused MCP calls are logged, so Activity and the Overview can show what an
  agent tried and was not allowed to do.

### Changed

- **License: GNU AGPL v3.0 or later** (was MIT). You may use, modify and share
  Memora, including commercially; a modified version that you distribute or
  run as a service must publish its source and keep the attribution in
  `NOTICE` ("Based on Memora by Codrihub Tech"). The name and logo are covered
  by `TRADEMARK.md`. Versions 1.3.8 and earlier stay MIT.
- Every page is redesigned: Overview, Brain, Graph and Canvas, Notes and the
  reader, Tags, Activity, Agents, Trash, Settings, Docs, sign-in, welcome and
  setup, with layouts for tablets and phones and the Geist typeface.
- Deleting a note for good also erases it from the vault's version history,
  so no one, agents included, can read it again. Other notes keep their
  versions; their revision ids change.
- Deleting a note for good over HTTP (`POST /api/delete` without
  `mode: "trash"`) needs an admin key, like MCP `delete_memory` with
  `permanent`. Moving to the Trash is unchanged.
- Notes saved from the web app are committed with the signed-in user as the
  author, so version history can tell people from agents.
- The theme follows the device by default, sign-in and setup included.
- The release check also reads the repository's star count (off with
  `MEMORA_UPDATE_CHECK`, like the release check itself).

### Fixed

- An unused setup or reset code that ran out locked the instance; it now goes
  back to idle, and locks older versions took on expiry are lifted.
- Activity summarised only the newest 800 events whatever range was chosen.
- The update offer appeared when nothing had changed; it now follows a
  content hash of the built app.
- Pins are checked again right after the notes folder is switched.

### Performance

- Signed-in `GET` answers under `/api/` are gzip-compressed (pages, writes,
  sign-in and `/mcp` are not), about a twelfth of the size for activity pages.
- Activity shows the newest page at once, fills the range behind it and
  remembers each range.
- The boot splash is plain HTML that paints at once and leaves as soon as the
  app is ready.


## [1.3.8] - 2026-10-21

A security and reliability pass: dependencies checked against published
advisories, Memora's own code reviewed for common vulnerability classes, and a
long load test for leaks. This covers what was found; it is not a guarantee
that nothing else is there.

### Security

- Dependencies: updated rustls-webpki (RUSTSEC-2026-0382) and webpki-roots
  (RUSTSEC-2026-0381), used by the release check and OAuth metadata fetch, and
  zip (RUSTSEC-2026-0367, -0368, -0369; Memora never extracted archives, so it
  was not exposed). `cargo audit` and `npm audit` now run in CI, Dependabot is
  on, GitHub Actions are pinned to commits, and the Docker image is based on
  Debian 13.
- A note containing a crafted embed could crash the server every time it was
  viewed. Fixed.
- Behind a reverse proxy, a client-sent `CF-Connecting-IP` or `X-Real-IP` could
  choose the caller's address, including `127.0.0.1`, and skip sign-in rate
  limits. Memora now uses the right-most `X-Forwarded-For` entry that is not a
  trusted proxy and ignores loopback addresses in headers.
- Many failed sign-ins no longer lock the owner out: the server slows down
  instead, and a correct password from a device without recent failures still
  works. A wrong setup code no longer closes the setup window on the first try.
- OAuth client registration is rate-limited per address and unused clients are
  removed after an hour. The public client metadata fetch also refuses IPv4
  addresses wrapped in IPv6 (such as NAT64).
- Paths that pointed at `.git` or other store files through a symlink or a
  Windows short name (`GIT~1`), and respelled paths that slipped past soft
  locks, are refused. Windows device names, `:` streams and trailing dots or
  spaces are refused too.
- Privacy rules now also cover the trash, the activity log of `create_memory`,
  the history of a hidden note's former path, and `import_memory` replies.
- Text replacements (`bulk_replace`, patch `replace`, templates) are capped so
  they cannot exhaust memory.
- `/logout` accepts POST only, with the same-origin check. `/_bus` refuses
  requests made by a browser.
- Folder colours and icons read from `.folders.json` are validated.
- The state folder is tightened to owner-only, and Memora's own files in the
  vault (`.events.jsonl`, `.locks.json` and others) are created owner-only.

### Fixed

- `memora.log` grew without limit (one line per MCP request); it is now
  bounded. The server raises its open-file limit so connection spikes do not
  run out of file handles.
- Memora's own files (`.events.jsonl`, `.locks.json`) were committed to the
  vault's git history on every write.
- The activity log endpoint kept every parsed event of its window in memory.
- Leaving the Brain view kept its node card and controller in memory, and a
  paused Activity page queued events without limit.

### Changed

- The npm package needs Node.js 22 or newer (18 and 20 no longer get security
  updates).

## [1.3.7] - 2026-10-21

### Added

- Drag and drop in the sidebar tree, with the mouse, a pen or touch (hold for a
  moment, then drag): drop on a folder to move into it, on a note to move into
  that note's folder, or on "All nodes" to move to the top level. A hint says
  where the item will go, places it cannot go are marked, the list scrolls when
  you drag near its top or bottom edge, and a closed folder opens when you hold
  over it. Every drop asks "Move "X" to "Y"?" first; Escape cancels a drag.
- A folder picker shaped like the sidebar tree in New node, Move to, Move
  contents to and the folder delete dialog: expand and collapse, keyboard
  navigation, and a search that finds folders by name or path at any depth.
- `GET /api/folders` lists every folder you can see, empty ones included.

### Changed

- Very deep folder trees stay readable: indentation stops growing after six
  levels and deeper rows show their level; long names end with an ellipsis and
  show the full path on hover.

### Fixed

- A new subfolder could not be chosen in New node (it only listed top-level
  folders), and empty folders were missing from the sidebar, Move to and the
  folder delete dialog.
- A word made only of digits after `#` (for example "PR #2") was read as a tag.
- The sidebar kept jumping back to the top when the tree redrew.

## [1.3.6] - 2026-10-21

### Added

- Rows in the sidebar have a "⋯" button that opens the same menu as a right
  click. It shows on hover and keyboard focus, and always on touch screens.
- Copy path and Copy wikilink in every note and folder menu (sidebar, Nodes list,
  node cards and the reader), so you can point an agent at an exact note. Copy
  wikilink now copies the full path, e.g. `[[Projects/Launch plan]]`.
- Deleting a folder that holds notes now asks what to do with them: move them to
  the parent folder, the top-level folder, Root or any other folder, or send
  everything to `.Trash`. The MCP tool `delete_folder` and `/api/delete-folder`
  take the same choice as optional arguments (`into`, `mode: "trash"`); without
  them nothing changes.
- An "Update & uninstall" guide in the documentation (web, console and
  `docs/INSTALL.md`), including how to remove versions before 1.3.2 by hand,
  safely: it stops Memora, removes only Memora's program and state folder by
  exact path, asks before deleting, and keeps the vault unless you choose
  otherwise.
- A real "Page not found" / "Node not found" view instead of a silent redirect
  to Overview.

### Changed

- Windows is installed with npm (`npm install -g @codrihub/memora`); releases no
  longer carry a separate Windows zip. The npm package for Windows x64 is built
  and tested as before. Zips of 1.3.0 to 1.3.5 stay on their release pages.
- The note delete dialog says plainly that a note is deleted for good (there is
  no trash for single notes) and when an agent can still restore it.
- `memora-cli update`, `/update` and `/restart` detect how Memora was installed
  (npm, Docker, the installer, a release folder or a source build) and give the
  matching steps. The npm launcher and the Docker image set `MEMORA_INSTALL`.
- `memora-cli help` lists start, stop, restart, update and uninstall, and an
  unknown command prints the version and points to `memora-cli update`.

### Fixed

- An npm install was reported as "built from source" by `/update`, and
  `/restart` suggested systemctl on Windows.
- `memora-cli start`, `stop`, `restart` and `uninstall` without `--state` could
  act on another install's running server (for example a systemd service). They
  now name the state folder and service first, and refuse to drive a service
  that belongs to a different kind of install.
- `#tags` inside inline code, code blocks, URLs (`…#install`) and link targets
  were read as tags, and a tag written twice was listed twice. Tag rename and
  merge no longer rewrite text in code or URLs either.
- Activity: rows of read-only calls (including `pin`/`unpin`) no longer stay
  "running"; the Live popover only says "now" for agents that are active; agent
  colours match everywhere; counts that may be cut off by the log limit show
  "2,000+".
- The sidebar footer lines no longer overlap when they switch.
- Nodes list excerpts load as rows come into view instead of queueing; folder
  paths and tags end with an ellipsis on phones.
- Agent labels in the brain no longer cover the map controls on phones, and the
  Overview Agents card no longer shows 0 while loading.

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

[2.0.0]: https://github.com/Codrihub/memora/releases/tag/v2.0.0
[1.3.8]: https://github.com/Codrihub/memora/releases/tag/v1.3.8
[1.3.7]: https://github.com/Codrihub/memora/releases/tag/v1.3.7
[1.3.6]: https://github.com/Codrihub/memora/releases/tag/v1.3.6
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
