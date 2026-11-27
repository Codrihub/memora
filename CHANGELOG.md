# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.3.0] - 2026-11-27

A full board view, clearer board cards, chat versions when you edit or
regenerate, and a link graph that keeps same-named notes apart.

### Added

- **Full board view:** a board page opens across the whole content area like a
  kanban app. Lanes grow with their cards and the page scrolls (no scroll boxes
  inside lanes); only the lane row scrolls sideways. The board bar stays at the
  top. A button in the board bar switches back to the compact view (remembered
  per device). Boards embedded in notes stay compact.
- **Edit and regenerate with versions:** edit a message you sent, or regenerate
  a reply, and the earlier try is kept as a version. A ‹ 1/2 › switcher flips
  between versions; the model only sees the version on screen. Existing chats
  are one version; the chat database gains nullable columns only.
- Answers to a Mnemo question show the question they reply to inside your
  message.
- **Show in brain:** a note or board page has a **Show in brain** button (in
  the ⋯ menu on phones) that opens the Brain with that note selected. The
  selected note is shared by Brain, Graph and Canvas: switching between them
  keeps it selected, and the address carries it (`/brain?mode=graph&note=…`),
  so a reload or a link opens it again.

### Changed

- Board cards on the Boards page adapt to any width: the title has its own
  space next to the ⋯ menu (two lines at most), lane names show only where they
  fit (numbers like "0 · " dropped, the full name on hover), boards with many
  lanes fold the rest into "+N lanes", and the footer wraps instead of cutting
  words.
- Board previews in Mnemo chat: lanes fold open and closed, the whole preview
  folds, an **Open board** button, and "in N notes" no longer slides off on
  phones.
- Mnemo: a wider chat list (minimum 340 px), a pin on every model in the picker
  to make it the default (the default is listed first), and thinking levels that
  match what the model supports (unknown models keep every level).

### Fixed

- Notes with the same name in different folders (such as `Index.md`) were one
  node in the link graph, so backlinks, `link_stats`, `get_hubs`,
  `get_neighbors`, `get_subgraph`, `find_path` and `get_isolated` mixed them
  up. The graph is keyed by path now, and links resolve with the same rules as
  opening them (#54). `/api/graph` and `get_graph` links name notes by path.
- Creating a note beside same-named ones (including the `Index.md` a new
  folder gets) no longer captures bare links that named another note: those
  links are rewritten to keep their target, as moves and renames already did.
- A link to a root note that a same-named note nearer the link would shadow is
  written `[[/Index]]`; a leading `/` on a bare name now means the vault root.
- Links inside `~~~` fences, longer backtick fences and fences in list items are
  no longer rewritten on a move or counted in the graph.
- Deleting a folder or moving its contents no longer makes case twins such as
  `Index.md` beside `INDEX.md`, and a folder can no longer be renamed or moved
  next to a folder that differs only in case.

## [3.2.2] - 2026-11-25

Two small fixes for boards and Mnemo.

### Fixed

- The lane list in the board pager (tap **2/9**) marked the current lane with an
  oversized check; it now uses the same small icon as the rest of the menu.
- Board previews in Mnemo chat showed a card's raw first line, with dates, tags
  and link brackets; they now show the plain card title.

## [3.2.1] - 2026-11-24

A polish release for boards: menus that fit where you are, a tidier lane menu,
calmer progress and due-date visuals, an archive panel, and checklist steps you
can tick right on the card.

### Added

- **Archive panel:** **Archived (N)**, a quiet link after the lanes and an item
  in the board's ⋯ menu, opens a side panel (a bottom sheet on phones) to find
  archived cards, restore one to a lane of your choice (the lane it came from by
  default), delete one for good after a second confirm, or restore all. Cards
  archived by Memora show the lane they left and the day.
- Checklist steps can be ticked right on the card with a click or a tap; the
  change is a normal save, with history and live sync.
- A quiet heads-up when a newer version is out: a small card slides down from
  the top (under the top bar) once per version per browser, at a calm moment
  (never during the welcome tour, a dialog, typing or with the phone keyboard
  open), stays about 12 s (paused while hovered or touched) and goes with ×,
  Later or a swipe up. "See what's new" opens Settings › Version. No backdrop,
  nothing is blocked, and nothing shows when the release check is off
  (`MEMORA_UPDATE_CHECK=false`). It replaces the warning toast shown at sign-in;
  the Overview card and Settings › Version stay.

### Changed

- Menus fit their place: a board's ⋯ menu no longer offers New note, New board,
  Turn into board or Embed a board; a note's ⋯ menu keeps Embed a board but no
  longer offers New note, New board or Turn into board. New notes and boards
  are made from folders, the sidebar, Overview and New.
- **Embed in a note…** searches first: a few recent notes, then the vault's
  search once two letters are typed, so opening it costs nothing.
- The lane menu is grouped (add a card; rename, colour as a row of swatches,
  card limit; move and duplicate; archive all with Undo, clear all with a
  confirm; delete lane at the bottom, archiving its cards first), and the card
  menu uses the same swatch row for its colour.
- Overdue cards get a warning stroke along their start edge and cards due
  today a softer one; the date chip stays neutral.
- Progress reads calmer: the lane bars on the Boards page and in board cards
  are flat (one solid fill on a baseline, no contrasting track), the done meter
  is a soft line, Mnemo's board previews use one thin bar, and card and lane
  shadows are softer. The Activity chart's bars got the same flat look.
- A lane's colour now tints the whole lane softly, with an accent along its
  header, in light and dark.
- Lane dots are gone. Every board's bar has **+** (Add lane) and a lane pager
  (‹ 2/9 ›, tap the number for a list of lanes) at the top right, on every
  screen; the end of the board has a lane-sized **Add lane** card; a mouse
  wheel over the board scrolls the lanes sideways. Long lane titles end in "…"
  and show in full on hover or a tap.
- **Aa (reading settings):** a side panel on wider screens (the page stays in
  view beside it) and a bottom sheet on phones; sections fold, one open at a
  time, and their heads show what is set; roomier spacing; choices never break
  words. **Reset all** now resets everything (notes and boards, the global
  settings and every note's or board's own), with Undo.
- The phone bottom bar is a clean floating capsule of icons (names as tooltips
  and for screen readers), the current page a solid accent circle.
- The archive toggle above the board is gone (see the Archive panel).
- The checklist boxes in the card form have a bigger target.

### Fixed

- Checklist steps on a card could not be ticked with a mouse or a finger.

## [3.2.0] - 2026-11-24

Boards you can run from anywhere: what is due across every board on Overview,
on the Boards nav item and in optional reminders; a menu, sort and filter on
the Boards page; a board you can drive from the keyboard; and Mnemo and agents
that know what is due. Obsidian Kanban compatibility is now checked against the
plugin's source.

### Added

- Overview has a **Due** section: open cards across every board that are
  overdue, due today or due in the next 7 days, each with its board, lane and
  date. A click opens the board at that card; the round box ticks it off right
  there, with Undo. It stays hidden while nothing is due.
- The **Boards** nav item shows how many cards are overdue.
- **Due date reminders** (Settings, Notifications), off by default: while
  Memora is open or installed, one browser notification when a card falls due
  and one a day while cards are overdue. The browser asks for permission when
  you turn them on; they follow the pop-up switch and never repeat for the same
  card and day.
- Boards page: every board card has a ⋯ menu with Open, Rename, Move to…,
  Duplicate, Color and icon… and Move to Trash; right-click on desktop and a long
  press on touch screens open it too, F2 renames and Delete trashes from the
  keyboard. Cards show the board's own colour and icon and how many cards are
  overdue.
- Boards page: sort by last updated, name, progress or next due date, and
  filter by folder or by boards with overdue cards, not done or done; the choice
  is kept on the device and the search box works with it.
- Board keyboard: the arrow keys move between cards and lanes (an empty lane
  takes the focus itself), Enter opens the card form, Space ticks, Alt/Option
  with the arrows moves the card and a screen reader hears where it went, N adds
  a card to the focused lane, Delete archives with Undo and ? lists the keys.
  Help & shortcuts lists them too.
- Due dates at a glance: on an open card a past date shows in a warning tint and
  today's date in a softer one. A board's own date colours (Obsidian Kanban's
  `date-colors`) are followed when it sets them, in the plugin's order.
- MCP `kanban_due` (Kanban read permission) and `GET /api/kanban/due`: open
  cards with a due date across boards, as overdue, due today and upcoming (a
  range of days), each with its board, lane, card id and date, so Mnemo and
  agents can answer "what is overdue?" and tick off or move those cards with
  the existing tools. `kanban_list_boards` also returns each board's `style`,
  the `due` dates of its open cards and its `date_colors`.

### Changed

- Moving a board or a note to the Trash from the Boards page, the board itself
  or the note lists shows a toast with Undo, and the Boards page and lists
  update at once after a delete, a restore or a rename.
- A card that shares its block id with another (Obsidian's Duplicate card
  copies it) gets an id of its own before Memora gives it a colour, so the
  colour stays on that card.
- Help & shortcuts lists the Alt 1-9 pages in the sidebar's order.

### Verified

- What Memora keeps in a board file survives a save from Obsidian Kanban: the
  plugin parses the whole settings JSON and writes the whole object back, so
  the `memora` key with lane, card and board colours stays, and it keeps a
  card's ` ^blockid` at the end of the card's first line. A round-trip test
  covers a save and a card dragged to another lane.

## [3.1.0] - 2026-11-24

Kanban boards that people and agents work on together, in the Obsidian Kanban
format: on their own page and embedded in notes, with a preview in the Mnemo
chat. Notes and
boards share one page frame that reads well on phones, tablets and desktops,
and the navigation is one system on every screen.

### Added

- Kanban boards. A note whose frontmatter has `kanban-plugin` (the format of
  the Obsidian Kanban plugin) always opens as a board: every `## heading` is a
  lane, every `- [ ]` / `- [x]` item a card. Boards made in Obsidian Kanban
  open as they are. A lane title ending in ` (3)` shows its card limit, a lane
  with the `**Complete**` marker ticks off the cards moved into it, and
  overdue dates are marked. Drag cards and lanes with a mouse or a finger (a
  long press on touch screens), tick off, archive, restore and delete cards,
  and add, rename, move and delete lanes. Keyboard: arrows move between cards,
  Alt+arrows move the card, Enter edits, Space ticks off, Delete archives.
  Light and dark, left to right and right to left.
- A card form for adding and editing a card: its text, a checklist (add,
  tick, reorder with Alt+arrows, remove; the card shows done of all and a thin
  bar), a colour, the lane (a picker of the board's lanes), done, a due date from a small calendar (Today, Tomorrow,
  Next week, No date) with an optional time, linked notes (a search over the
  vault, each a chip) and tags (the vault's tags with their counts, a new one
  last), plus Archive (with Undo) and Delete. A dialog on wider screens and a
  bottom sheet on phones that never runs wider than the screen, its lists
  opening inside it; Enter saves, Esc closes the open list, then the form.
  It is written back into the card's own line exactly as Obsidian Kanban
  writes it: `[[Note]]`, `#tag`, `@{2026-01-31}` and `@@{10:30}`,
  following the board's `date-trigger`, `time-trigger`, `date-format` and
  `time-format` settings. Pieces stay where they were in the text, new ones
  join the end of the first line, and text the form does not know stays as it
  is.
- The folder picker of New note, New board and Move shows the chosen folder
  above the list, marks it clearly (filled, ticked, bold) and opens with it in
  the middle of the list, never under a faded edge.
- Boards managed like folders: a board's ⋯ menu changes its colour and icon,
  duplicates it and puts it into a note (Embed in a note…); a lane's menu
  duplicates it, sets its colour and its card limit (Obsidian's ` (N)`),
  archives or deletes all its cards and deletes it with Undo; a card's menu
  duplicates it, sets its colour and deletes it with Undo. Colours live in the
  board's own settings block (under `memora`, with tag colours in Obsidian's
  `tag-colors`), and a coloured card gets a block id (`^abc123`), so the file
  stays a valid Obsidian Kanban board.
- Board notes in the Notes page: the toolbar keeps History and Ask (the
  reading controls of other notes are not needed), and Edit Markdown source in
  the ⋯ menu opens the raw text; Save or Close go back to the board.
- Several boards in one note: `![[Board name]]` on a line of its own shows
  that board live in the note (drag, tick off and add cards, live updates, an
  Open button), one independent board per embed, each its own Obsidian Kanban
  file. A plain `[[Board name]]` line shows a compact card with the board's
  lanes and progress, and a version from the history shows embeds as cards.
  Add board in the note editor creates a board (in the note's folder unless
  another is picked) or picks an existing one (Existing board…) and embeds it
  at the cursor, and Embed a board… in a note's ⋯ menu adds one at its end; Turn into board in a note's
  ⋯ menu makes a list note a board (headings become lanes, list items cards,
  after a check that shows what you get; the earlier version stays in the
  note's history).
- Where a board shows up: the foot of a board's page has one Mentioned in list
  of every note that mentions it, those that show it (`![[...]]`) first, each
  with a small marker (a board icon, "Shows this board", or a link icon,
  "Links here"), and Links to only when its cards link out; its preview in
  the Mnemo chat folds out the same list as "In 3 notes"; in Mnemo's replies a note that embeds boards
  carries a small board badge, and its card folds out a list of those boards
  with their progress. Agents see the same: `kanban_list_boards` and
  `kanban_get_board` return `embedded_in` and `linked_from`, and a note read
  (`read_memory`, `/api/note`) returns the `boards` it embeds. All of it comes
  from the note cache, so nothing is scanned per view.
- A Boards page (`/boards`, in the sidebar next to Notes): every board as a
  card with its folder, lanes, progress and last change, a filter and live
  updates. New board sits wherever New note does: the sidebar, Overview and
  the folder view header (one New button: Note or Board, a menu by the button
  or a bottom sheet on phones), its empty states and add row, folder and
  note menus, folder cards in the brain, search, and the `B` key next to `N`;
  a missing `[[link]]` offers Create as a board too. It creates the lanes To
  do, Doing and Done in the interface language, the last one marked Complete,
  and opens the board. Board notes carry a board icon in
  the folder tree, note lists, pins and search (`board: true` on `/api/tree`
  entries).
- Boards in the Mnemo chat: a board mentioned in a question, linked in a
  reply, handed over by Mnemo or used by a kanban tool shows under the reply
  as a board preview: its name, folder, how many cards are done, its lanes as
  bars and the first cards of each lane, kept up to date as agents change the
  board. A tap opens the board. Everything a reply hands over (notes, boards,
  pictures) stacks in one column as wide as the reply. In Mnemo's replies boards and notes look different:
  links, chips and cards of a board carry the board icon and a violet accent,
  and a note card shows a line of the note.
- Kanban tools for agents and Mnemo, everything a person can do on a board, in
  four permission groups (each a switch for Mnemo, its sub-agents and every
  API key, following scopes, privacy rules, note locks, and Ask first, Auto
  and Read only): Boards: read (`kanban_list_boards`, `kanban_get_board`, with
  colours, checklists and card fields), Boards: cards and lanes
  (`kanban_add_card`, `kanban_move_card`, `kanban_update_card` with linked
  notes, tags, date, time, checklist and colour, `kanban_card` to duplicate,
  delete or restore, `kanban_lane` to add, rename, move, duplicate, colour,
  limit, archive, clear or delete), Boards: create and manage (`kanban_board`
  to create, turn a note into a board, rename, move, duplicate, delete, colour
  and icon, tag colours and Obsidian Kanban settings such as `date-colors`)
  and Boards in notes (`kanban_embed` to put a board into a note or take it
  out). 86 tools in all. Their descriptions tell agents how to put several
  boards in one note: one board note per board, each embedded.
- `GET /api/kanban`, `GET /api/kanban/boards` and `POST /api/kanban` for the
  web app, and a Kanban boards page in the Docs.

### Changed

- Reading settings (Aa), rebuilt: a popover on wider screens and a bottom
  sheet on phones with a live preview, sixteen page colours and an accent,
  nine fonts, size, line and paragraph spacing, alignment, hyphenation, width,
  pictures, headings, link colour and underline and code theme, each for every
  note or for this note only, with Reset per section. On a board, Aa opens
  Board view: spacing, lane width, card style, background, whether done cards,
  empty lanes, dates, tags and links show, and colouring cards by their own
  colour, their tag or their due date.
- One page frame for every note view (a note, a board, a version from the
  history, the editor): the same gutters, paper padding, title size and place
  per screen size (phone up to 760px, tablet up to 1099px, desktop), so moving
  between a note and a board never shifts the page. Notes read in one column
  whose width follows the text size (about 70 characters a line) with a calm
  meta row (folder, last change, words). A board runs the full width, its
  first lane in line with the title and its scroll area reaching the edge.
- The foot of a note is one component everywhere: Mentioned in and Links to,
  each with a count, the same chips for a note, a board and a link not
  created yet, wrapping on phones, folding away (remembered) and showing a
  long list in part.
- One board in two sizes (its own page, embedded in a note):
  lanes scroll sideways on their own, with no scrollbars: an edge fades on a
  side only while there is more that way (left and right for the lanes, top
  and bottom inside a tall lane, never while a card is dragged), snap one lane at
  a time on narrow screens with dots to jump between lanes, keep their header
  in view and say so when they are empty. On cards, `[[links]]`, `#tags`,
  `@mentions`, dates and `- [ ]` steps show as chips and boxes, cut cleanly
  when long.
- Navigation, one system everywhere: the sidebar groups its pages into
  Workspace (Overview, Notes, Boards, Tags, Brain) and Agents (Mnemo, Activity,
  Agents), with Trash and Settings in its footer; each group folds like an
  accordion (remembered) and the Library heading sticks to the top while you
  scroll. The menu under your name keeps your account, appearance, system
  pages (Tools, Access rules), help and sign out. On phones the bottom bar
  keeps Overview, Notes, Brain, Activity and More (every other page, Boards
  included, in the same groups), slides away while the keyboard is open (so it
  never covers the field you type in) and while the toolbar is hidden (F, now
  also on boards and in the editor; Esc or F brings it back), and the side menu opens at the full
  width of the screen; bottom sheets sit above the keyboard. Alt+1…9 follow the sidebar's order.
- Saving a board rewrites only the lines of the cards and lanes that changed:
  the `%% kanban:settings %%` block, the archive, unknown settings and any
  other text keep every byte, so the board still opens the same in Obsidian.
  Every change is a normal save of the note: one commit in its version history
  (`kanban: move card to Doing in Work/Board.md`), an entry in Activity and a
  live update on every open board. Edits carry the board's version, so a board
  changed meanwhile is never overwritten: the web board applies the edit again
  on the newest version, and an agent is told to read the board again.

## [3.0.1] - 2026-11-24

Mnemo steers its sub-agents, its plan belongs to the chat, and the chat fits
every screen better.

### Added

- Mnemo manages its sub-agents with a new `agents` tool: list them, set one up
  ahead of its task, change its instructions, model or name, send a running
  one a message, wait for it, stop it, mark it done or remove it from the list.
  A running sub-agent takes a new model or instructions from its next step.
  Every sub-agent has a short id that never changes (a1, a2, …), shown on its
  card: Mnemo points at it by id, so a name can change freely, and stop, done
  and remove take several at once (or all). Sub-agents a chat ran before this
  update are on the list too.
- Sub-agents in the background: `delegate` with `wait: false` lets a sub-agent
  work while Mnemo goes on; Mnemo collects its answer with `agents` wait, and
  the reply never ends before every one has answered.
- Every sub-agent card shows Instruction, Activity and Answer from the start,
  whatever it is doing; Activity opens while it works and stays folded if you
  fold it.
- Clear the plan: a button on the plan puts away a plan you no longer want
  (while no reply runs).
- Resizable panes on desktop: drag the edge of the chat list or of the side
  panel (Agents, In this chat) to change its width, like the page preview;
  each keeps a minimum so nothing gets squashed, a double-click resets it, and
  the width is remembered on the device.

### Changed

- Mnemo's plan belongs to the chat, not to one reply. Mnemo adds, edits,
  checks and removes single steps as it works, every device sees each change
  live, a stopped reply leaves the plan as it was (Mnemo sees it again next
  turn), and it closes the moment every step is done.
- Long chats open and scroll lightly: only the latest questions go on the page
  at first; earlier ones come in as you scroll up (or with Show earlier
  questions), jump to one on the timeline, or open a search hit there.
- Pictures for a model that cannot see: only the pictures in your newest
  message go to the image model (earlier ones never hold up another question),
  and you hear of it in a short toast instead of a line in the chat.
- The chat list is roomier: wider rows with the time and a preview, the ⋯ menu
  always in reach (larger on touch screens), a drawer on tablets and a whole
  screen on phones, with a bottom bar for the rest.
- Mnemo's questions read more easily: the question sits on its own band (who
  asks, then the question in larger type), the answers below as separate rows
  to tap, and Mnemo gives as many options as the question needs.
- The model picker sits on its own solid surface above the chat, as a pill in
  the top row, and the chat fades out before it passes under it.
- In dark mode the What's new header is a light band, so it stands out from
  the dialog.
- A fleeting chat on a phone fills the screen, with a compact header and the
  message box pinned above the keyboard.

### Fixed

- Messages and the message box now share exactly the same edges in compact,
  wide and full width, with or without the timeline rail.
- Compact, wide and full width follow the chat's own width, so they keep
  their look when the side panes are dragged; a squeezed chat gets the narrow
  layout.
- Tool steps in a narrow chat take two lines instead of overlapping their
  result, and Mnemo's sub-agent steps say what they did ("Marked 3 sub-agents
  done").
- Scroll to bottom no longer shows when the chat is already at its end; it
  checks again on resize, the keyboard, new content and loaded pictures, and
  shows only when you are about half a screen away.
- Stop always lets the next queued message go out, also when the reply was
  waiting for your answer.
- Tapping an option of Mnemo's question (or any button in the chat) while
  typing no longer misses: the message box folds after the click, not on the
  press, so nothing slides away under the pointer.

## [3.0.0] - 2026-11-23

Memora speaks your language, Mnemo shows its plan as it works, and you decide
what it may use and see.

### Added

- Languages: the whole interface in many languages, right to left included.
  Pick one from a grid in Settings, Appearance, Language, per device; Auto
  follows the browser. The welcome tour and the terminal setup ask for it
  first, and the server keeps a default language for new devices (English
  until you pick one). Dates follow the language, and each language loads on
  its own, so the app stays light.
- Mnemo's plan: for a longer task Mnemo lists its steps (`update_plan`) as a
  checklist on the message box, each one not started, in progress or done,
  live. Without a plan, the checklist follows the reply's sub-agents. A
  finished plan folds away by itself.
- Tell Mnemo about you: a new chat offers, once, a few words about you
  (optional), or "Describe me from my notes", where Mnemo reads your vault and
  keeps what it learns; or skip it.
- Tools per agent: switch any tool off for Mnemo itself or for its
  sub-agents (Settings, Mnemo, What Mnemo can use), Mnemo's own tools included
  (pictures, chats, plans, sub-agents).
- Private from Mnemo: Mnemo is listed with the agents in a note's, folder's or
  picture's privacy panel, so anything can be kept out of its sight and its
  sub-agents', its history included. A private picture stays unseen to
  `view_image` too.
- `/mnemo#fleeting-chat` opens a new fleeting chat straight away.
- A Mnemo page in the docs: what it does, its tools, sub-agents, permissions,
  privacy and settings.
- Share Memora: once after this update, a small card (a corner card on
  desktop, a sheet on phones, with a short timer and a close button) invites
  you to share Memora or star it on GitHub. Open it again any time from the
  account menu.

### Changed

- The welcome tour is rebuilt: layered scenes for each step, a segmented
  progress bar, Mnemo introduced as the one that keeps your notes tidy while
  your other agents read and write them, and the language and server name
  asked at the start. The terminal setup asks the same two first.
- One chat layout on every screen. The model sits above the chat as a plain
  name with a chevron; its list marks the default model with a pin and a
  Default badge, and any model's pin makes it the default. Agents, Think and
  the context meter sit under the message box on the right; Agents is always
  there.
- The live status, the plan and the queue share one tray on top of the
  message box. Each part opens and folds smoothly and the chat above shrinks
  with it, so nothing covers the conversation.
- A fleeting chat is a dark, rounded room inside the normal page, in Mnemo's
  teal, with a calmer welcome and a way back to a normal chat before the first
  message.
- The note under the message box is smaller, wraps instead of being cut, shows
  on every screen and goes once the chat starts.
- What Mnemo knows about you is one plain list: no kinds to pick, and several
  lines add several notes at once. "Describe me from my notes" is there too.
- New chat suggestions are written in the language you picked for the screen,
  not the language of your notes.
- Settings, Mnemo: Add model opens a dialog from the Models header, and
  fallback models have their own card with Add in its header.
- All images in Settings: every picture is the same square card, its name on
  a soft fade at the bottom, with where it is used and Delete on hover.
- The sub-agent line in a reply spans the reply, with a clear View button.
- Agents panel: the newest sub-agent on top in every section; its activity
  shows the latest step first in a short window that fades out, with Show all
  to open it fully and fold it back.
- The scroll button reads "Scroll to" with an arrow down.

### Fixed

- A plan stayed on screen after starting a new chat.
- The Think button showed only after the first message.
- Stop did not show for a reply started elsewhere (another device or the
  queue); any running reply now shows it.
- Coming back to the window puts the cursor in the message box again.
- A click in the padding of the message box closed and reopened it.
- The folded Settings menu cut its icons off.
- A fleeting chat showed "Connect a model first" once the models had loaded,
  even with models set up.
- Fleeting chats offer the same suggestions, skills and Fresh ideas as any new
  chat, and Mnemo knows every tool and sub-agents work there too; only its
  notes about you stay out.
- The live status line shows the arrow only when a click opens something (the
  sub-agents, or the reply's steps); otherwise it is plain text.
- A tool switched off in What Mnemo can use stays off on every path, sub-agents
  and questions to you included.

## [2.2.1] - 2026-11-22

### Changed

- The live status (what Mnemo is doing and for how long, or how many
  sub-agents are working) is one line above the message box, outside the
  reply, shown only while Mnemo works. Click it to open the Agents panel while
  sub-agents run.
- Steps in the Agents panel take two lines, what they did and how it went, so
  a long title no longer runs into its result.

- Sub-agents need no setup: the named sub-agents in Settings are gone (typing a
  name there redrew the whole page). Mnemo names each sub-agent as it starts
  it; the settings keep only "Ask before sub-agents run".

### Fixed

- Mnemo saw only the first 40 models for sub-agents, so a model such as the
  default one could be missing from its list. It now gets every model, with
  the default and fallback models named, and a model asked for by its short
  name (the model id without its provider) or label is found; a name that is not a
  model here is refused instead of running on another model.
- Saying yes to sub-agents and then writing again ("where are they?") made
  Mnemo ask again. The yes now holds until the sub-agents ran on it.

## [2.2.0] - 2026-11-22

Mnemo gets a model for each job, sub-agents, its own notes about you, and a
rebuilt chat list.

### Added

- Models for each job (Settings, Mnemo): one that reads images
  (`describe_image`; it also describes attached pictures for a chat model that
  cannot see), one that makes images (`generate_image`, shown in the chat and
  kept in a note on request), one that reads replies aloud (Listen under a
  reply, with a voice) and one that listens (the mic in the composer). The mic
  and Listen show only once their model is set. Images, speech and
  transcription use OpenAI-compatible providers.
- Sub-agents: other model runs with a name and a job, or a general helper with
  no set up. Mnemo hands each a self-contained task with `delegate`, several at
  the same time, and answers from what they report. A sub-agent picks its model
  the way a chat does (the one you asked for, else its own, else the default
  model, then the fallbacks), can ask Mnemo a question (`ask_mnemo`), takes
  follow-ups, and summarises its own work when its context fills up. Switch a
  sub-agent's model from the Agents panel, like the chat's own.
- The Agents panel (header, top right): every sub-agent of the chat, live, like
  the chat itself: running (its tools, its text, its tokens and context),
  idle, done. A reply shows only one line ("3 sub-agents · 2 working · 1 done").
- A live status while Mnemo works: what it is doing and for how long
  (thinking, a tool, a retry, a fallback, compacting, sub-agents at work).
- Permission modes: Ask first (asks before changing notes and before running
  sub-agents, with a rough token estimate), Auto (changes and sub-agents go
  ahead without asking) and Read only (Mnemo reads and answers, never changes
  notes).
- What Mnemo knows about you: short notes Mnemo keeps by itself on how you like
  answers, who you are and what you like (`remember_owner`,
  `update_owner_memory`, `forget_owner_memory`). Not a system prompt: each
  message carries them when they changed. See, add, edit and delete them in
  Settings, or turn learning off. Nothing is learned in a fleeting chat.
- Storage health: notes, images and chats are each measured against their own
  room (a limit you set in Settings, or the free disk space). At 90% a banner
  says it is almost full and at 99% full, with a way to tidy up; MCP tool
  results then carry a `storage` notice, so any agent knows and tells you.
- A gallery of every image in Settings: where each is used, its folder, size
  and link, the ones nothing uses, and the pictures sent in Mnemo chats.
- Archive chats, and All chats at `/mnemo/chats` with Pinned, Chats and
  Archived.
- Chat width in Appearance: Compact, Wide or Full, per device.

### Changed

- The chat list is rebuilt: actions sit on an icon rail (new chat, search, all
  chats, Activity, Appearance, Settings, Memora) that stays on desktop when the
  list is hidden; pinned chats have a list of their own; every chat shows an
  icon for its kind (chat, note, folder), its title and time and a line of its
  last message, under Today, Yesterday, Previous 7 days, Previous 30 days, then
  months. All, Chats and Notes filter the list.
- Send now and Stop take over at once: the reply ends where it is (its text
  stays) and the next message starts right away, whatever the reply was doing.
  Send now in the queue has its own icon.
- Fleeting chats look anonymous and quiet in any theme.
- What's new picks the release from a dropdown, with a new footer.
- The timeline rail keeps a fixed height with a knob for where you are.
- A chat sends the model only its newest 3 pictures (older ones by name).
- The line under the prompt about notes, Activity and History shows on a new
  chat only.

### Fixed

- A message sent with Send now could wait until the cut reply's model call
  ended, or stay queued for good after a compaction.
- A model behind a router that cannot take pictures (it times out or fails
  without saying why) no longer stalls a chat for minutes: the request goes
  again at once with the pictures described by the image model, or by name,
  that model is remembered, and the chat says so with a button to set a model
  that reads images.
- A chat no longer switches back to an old model because a page open since
  before the change still had it picked.
- Restarting or updating the server while Mnemo answers keeps what it wrote,
  with Try again, and the server stops at once instead of hanging for a minute
  and a half.
- Pictures in a chat no longer turn into "not found"; a removed queued message
  takes its pictures with it.
- A reply cut while a tool ran left a tool call without its result, which some
  providers refuse.
- On phones the timeline rail answers a press and hold at once; the model
  divider is centred; the Rename field for a chat is styled.

## [2.1.12] - 2026-11-18

### Changed

- What's new picks the release from a dropdown (newest first, the latest
  selected) instead of a sliding row of versions.
- A fleeting chat looks like a private room: dark in either theme, an
  incognito mark, and what is and is not kept spelled out.
- The line under the prompt about notes, Activity and History shows on a new
  chat only.

### Fixed

- On phones the timeline rail answers a press and hold at once (a wider strip
  to land on, no swipe needed first, no long-press menu).
- The divider that marks a change of model sits centred in the chat column
  instead of hugging the left edge.

## [2.1.11] - 2026-11-18

### Changed

- The Think chip shows for every model that is not an old Claude model,
  router aliases included, so the thinking level can be set even when the
  model's name says nothing. It hides once the provider refuses both the
  effort and the thinking fields.

## [2.1.10] - 2026-11-18

Each chat keeps its own model, and a model change is always marked.

### Changed

- A chat keeps the model it began with or was switched to (stored with the
  chat); the default model only applies to new chats. When a chat's model is
  gone or cannot answer, it takes the default, then the fallback models, then
  the first pinned model.
- When a fallback model takes over, the chat switches to it, says so, and a
  divider marks every change of model in the conversation (also inside a
  reply), so it is clear which model wrote what.
- A model that is out of quota, has its key refused or is not found goes
  straight to the next fallback model; a provider that is only busy gets one
  quick retry when a fallback is lined up. The reason shows in a few words.
- The model picker and the memory ring sit under the prompt, on the right;
  the prompt keeps the thinking level and Send.
- The fleeting button shows only on a new chat (and in a fleeting chat, to
  leave it).

### Fixed

- The thinking level was missing for models whose name gives nothing away
  (router aliases): a model that has shown its thinking is now offered it,
  and OpenAI-style routers get `reasoning_effort`.

## [2.1.9] - 2026-11-18

Chats stay in step on every device, and the queue never gets stuck.

### Added

- Live chats on every device: a message sent from one device shows on every
  other device that has the chat open, and Mnemo's reply streams on all of
  them (`GET /api/assistant/sessions/{id}/watch`).
- Fallback models (Settings, Mnemo): up to five models, in order. When a
  reply's model fails after its retries, the next one carries on by itself;
  with none left the error stands and the owner tries again by hand
  (`@mnemo` requests keep their own retries).
- Thinking level next to the model, for models that can think: Auto, Off,
  Low, Medium or High (Anthropic `output_config.effort`, OpenAI
  `reasoning.effort` / `reasoning_effort`, OpenRouter-style `reasoning.effort`).
- Switching the model of a chat that has begun asks first.

### Changed

- The queue lives on the server, shared by every device: queued messages go
  out one by one as each reply ends, whether it finished, was stopped or was
  cut. A failed reply pauses the queue until a message is sent now or the
  queue resumes. Send now, Clear and Resume are always available
  (`/api/assistant/sessions/{id}/queue`).
- Send now (a queued message, or Ctrl/Cmd+Enter) no longer slips the message
  into the running reply: the reply is cut where it is and the message is
  answered as a new turn of its own (`/steer`).
- Stop keeps what the reply wrote so far in the chat (`meta.stopped`).
- A long queue shows three rows with a fade and scrolls; Show all opens it.

### Fixed

- The compaction summary shows as it is written and can always be opened,
  instead of an empty divider until the chat was opened again.
- After Stop, queued messages could lose their buttons and never go out.

## [2.1.8] - 2026-11-17

`@mnemo` requests are never dropped.

### Fixed

- An `@mnemo:` request Mnemo could not answer (the AI provider or the
  network down, or no model yet) is no longer struck through with "Could
  not answer": it stays open in the note and is tried again after 1, 3, 10
  and 30 minutes, then hourly (up to about a day; any change to the note
  starts over). A retry runs the same message in the note's chat instead of
  asking twice, and only the answer to that request is written back.
- What's new: the release row starts flush left and fades only on a side
  with more to scroll to; an arrow shows only where there is somewhere to go.
- Opening Mnemo at `/mnemo/<id>` shows that chat's title right away instead
  of "New chat" while it loads.
- Fresh ideas shows a shimmer on the button and placeholder cards while
  Mnemo writes, instead of a spinning icon.

## [2.1.7] - 2026-11-17

Skills, fleeting chats, suggestions that change, and a note's chats that
follow the note.

### Added

- Skills: notes in the vault's `Skills` folder (file name = skill name, a
  `description:` line, then the steps). Typing `/` in Mnemo's message box
  lists them; `/name ...` sends the skill's steps with the message
  (`meta.skill`). Mnemo makes, changes and removes skills with its note
  tools. New endpoint `GET /api/assistant/skills`.
- Fleeting chats (the eye in Mnemo's header): not kept, left out of the chat
  list, search and Mnemo's look-back tools, and deleted with the pictures
  sent in them when the owner leaves (or after 30 minutes idle). Changes to
  notes stay. `POST /api/assistant/sessions` takes `fleeting: true`.
- Suggestions on a new chat change each time: the owner's own (Your
  suggestions, kept), ones Mnemo writes from recent notes (refreshed at most
  every 12 hours, or now with Fresh ideas) and built-in ones; skills show as
  chips. Endpoints `GET/POST /api/assistant/suggestions` and
  `POST /api/assistant/suggestions/refresh`.
- Mnemo tool `view_image`: look at a picture in the vault (a note's
  picture by its path); a web address is refused with a note to send or add
  the picture instead.
- Ask Mnemo from a note's page offers that note's earlier chats
  (`GET /api/assistant/sessions?about=<path>`).

### Changed

- All `@mnemo:` requests in one note go to that note's one chat (titled
  `@mnemo · <note>`), and a note's chats follow it when it is renamed,
  moved, sent to the Trash or restored.
- An `@mnemo:` request Mnemo writes into a note from a chat or the console
  is answered like the owner's; what it writes while answering a request
  never asks again.
- Deleting chats also deletes the pictures sent in them (pictures placed in
  notes stay in the vault).
- What's new: arrows show only where there is more, and a new footer with
  the GitHub star count.
- A page open beside the chat folds the chat list and "In this chat" away
  so the chat keeps its room; the list comes back when the divider leaves
  room for it, and everything returns when the page closes. When the chat
  and the page cannot both fit, the page opens full screen.

### Fixed

- Pictures in notes are capped at about 60% of the screen height (480 px).
- Leaving a chat while Mnemo answers no longer shows a network error; the
  chat reconnects to the running reply.
- Chats left with their question's first words as the title (the model
  could not name them) get a proper title on the next reply; titles have
  room for models that think first.

## [2.1.6] - 2026-11-17

Mnemo's pages become versions of one file, chats can be cleaned up in bulk,
and a chat is compacted only once it is full.

### Added

- Page versions: an HTML or SVG page Mnemo rewrites under the same title is
  the next version of the same file. Cards show v1, v2 and latest (older
  ones dimmed), the preview panel steps between versions, and the newest
  opens beside the chat by itself on a wide screen (or replaces what an open
  panel shows). Mnemo is told to rework its latest version when asked to
  change or tidy a page, and to start a new page only when asked.
- A draggable divider between the chat and an open page (keyboard arrows
  too; double-click resets). The page keeps at least 360 px, the chat at
  least 420 px, and the page at most 75% of the width; the width is
  remembered per device.
- Deleting many chats: Select chats (pick several, then Delete), Clean up
  chats (untouched for 7, 30 or 90 days) and Delete all chats, from the ⋯
  beside New chat and the chat menu. Pinned chats are kept unless asked; a
  chat answering right now is left alone. New endpoint
  `POST /api/assistant/sessions/prune` (`ids`, `older_than_days` or `all`,
  with `keep_pinned`).
- Mnemo tool `list_chats` (the owner's chats, newest first, optionally by
  title) and paging for `read_chat`, so Mnemo can connect a chat with
  earlier ones.
- Mnemo tools `list_artifacts` and `read_artifact`: the pages Mnemo wrote,
  across chats, and a page's full source by version, so a page can be
  reworked or reused from another chat. Pages live in their chat's messages
  and are deleted with it; the "In this chat" panel lists them under Pages.

### Changed

- Auto-compaction starts only when a chat's history fills all the tokens it
  may use (the model's context minus the room kept for the reply), instead
  of at 80%. While it runs, a working divider with a clock shows in the
  chat; it turns into Compacted (with how long it took) and the reply goes
  on. Compact now shows the same divider.
- Page cards are as wide as the reply, tinted with an accent edge and an
  accent Open button, and long titles end in an ellipsis.
- Mnemo's chat list foot: Appearance is one wide button (showing the theme
  and background in use) above Activity, Settings and Memora.
- Thin rounded scrollbars in the chat, the message box and the chat list
  that show only while scrolling; the track keeps its width, so nothing
  shifts.
- What's new: releases slide in one row with arrows (newest first) and the
  footer stacks neatly on phones.

### Fixed

- The New chat button in Mnemo's chat list header on phones no longer takes
  the unread badge's look.

## [2.1.5] - 2026-11-17

Unread chats agree on every device, Mnemo's chat list ends in one tidy row,
and phones no longer send a message on Enter.

### Changed

- Unread chats are remembered on the server instead of per browser: a chat
  read on one device is read on all of them. New endpoint
  `POST /api/assistant/sessions/{id}/seen`; the chat list carries each
  chat's `seen` count. The first list after updating counts everything
  there as read.
- The scroll-down button in Mnemo's chat is a plain scroll to the bottom;
  the "New messages" label is gone (it also showed for older messages).
- On touch keyboards Enter adds a new line in Mnemo's message box and the
  send button sends; on physical keyboards Enter still sends and
  Shift+Enter adds a line.
- Mnemo's chat list: theme, chat background and text size moved into an
  Appearance panel (a bottom sheet on phones), and the foot of the list is
  one row of four tiles: Appearance, Activity, Settings and Memora.

## [2.1.4] - 2026-11-17

Mnemo's pages open like files, a button takes you back to the latest
message, and chats with news are marked.

### Added

- A scroll-down button in Mnemo's chat: it appears in the middle above the
  message box when the latest message is out of sight, and turns into "New
  messages" when a reply arrives while you are reading further up.
- Unread chats: the sidebar's Mnemo item (and its menu entry) shows how many
  chats have news you have not seen, and the Mnemo chat list marks each one
  with its number of new messages, in bold. Kept per device; a chat counts
  as read once it is open on screen.

### Changed

- An HTML or SVG answer now shows in the chat as a file card (title, kind
  and length, Open and Download). Opening it shows the page in a panel
  beside the chat on a wide screen, with the chat making room, and full
  screen on tablets and phones; the panel has Preview and Code, Copy,
  Download and a clear Close (Esc). A page Mnemo has just written opens
  beside the chat by itself when there is room.

### Fixed

- The "Compacted" divider sits in the middle of the chat column again (its
  own margin overrode the column's centring).

## [2.1.3] - 2026-11-17

Mnemo can answer with a picture: charts, diagrams and small pages show as a
live preview right in the chat.

### Added

- HTML and SVG answers: when a chart, graph, diagram, timeline or mock-up
  explains better than text, Mnemo writes one self-contained page and, once
  the reply is done, the chat shows it as a live preview (the eye) with Code,
  Copy, Download and Full screen. The page runs in a sandboxed frame with no
  access to your notes, your session or the network beyond scripts and
  styles from https, so it costs the server nothing. Older chats learn it
  too.

### Changed

- The divider where a chat's memory was compacted now just says
  "Compacted", centred between its lines on every screen size; open it to
  read the summary.

## [2.1.2] - 2026-11-16

Mnemo fits your screen and rides out a provider that is down for a moment:
full width on phones, a text size you choose, and plain errors with Try again.

### Added

- Text size for Mnemo's chat: Auto, Small, Medium or Large, from Appearance
  in the chat list or Settings, Mnemo (kept per device). Auto is small on
  phones, so more fits on the screen, and medium elsewhere. Replies, your
  messages, questions, steps and thinking all follow it.

### Changed

- On phones Mnemo's replies drop the avatar beside them and use the full
  width, with equal margins on both sides; the timeline narrows into the
  right margin.
- When a reply fails (the provider answers 503, 404, 401, 429, times out…)
  Mnemo says what went wrong in plain words with Try again (and Open
  settings when the key or model needs a look); the provider's full error
  shows only when you open it. In the console `/details` prints it.
- A provider that is briefly down or busy (502, 503, 504, 429, a dropped
  connection) is asked again up to three times over about half a minute,
  with a note in the reply, before Mnemo shows an error; never once text has
  started to stream. An HTML error page from a proxy is cut down to its
  title in the error.

## [2.1.1] - 2026-11-16

Mnemo asks before it guesses, works on its own when you let it, and takes
messages while it works.

### Added

- Mnemo can ask you a question with options listed one under another, and
  Other, which opens a box in the card for your own answer; its reply ends
  there and your answer goes on. Sending something else instead marks the
  question skipped. In the console the options are a pick list.
- Permission: **Ask first** (the default: Mnemo reads freely, but a change to
  your notes waits until you approve it through one of its questions) or
  **Auto** (changes go ahead without asking and long jobs keep going, up to 40
  steps a reply). Switch it from the chip in the composer, Settings, Mnemo,
  or `/auto` and `/ask` in the console. Requests written with `@mnemo:` in a
  note count as approved.
- A queue: what you send while Mnemo is answering waits above the prompt,
  can be reordered (arrows or drag) or removed, and goes out by itself when
  the reply ends (not after Stop). Ctrl/Cmd+Enter, or the Enter button on a
  queued message, steers the running reply instead: Mnemo reads it before its next
  step, and it shows inside the reply. While a reply runs the button is Stop,
  and turns back into Send (to the queue) as soon as you type.

### Changed

- On the Mnemo page notices appear at the top right, clear of Send and Stop.
- The composer reads left to right: attach, the permission chip, then the
  model (with its pin) beside the memory ring and Send.
- Mnemo's replies sit on a frosted card that stays readable over any chat
  background; the chat scrolls without a scrollbar (the timeline and the
  edge fades show where you are).
- Thinking, steps and every other detail start closed; an open section keeps
  its header in view while you scroll through it, so it closes from anywhere.
- A reply without approval runs up to 25 steps before it pauses (was 10).

### Fixed

- Mnemo no longer shows as "key removed" in Your AIs, nor greyed out in Live
  activity: it is built in. Your AIs lists five agents, with Show all for
  the rest.
- The note panel's Contents and Details tabs, and Outline, Links, Mentions
  and Images, follow the reading theme, so they stay readable in every
  theme; the four tabs always fit, each count above its name.
- A long note path no longer runs over the step's title and result.
- The ⋯ on each chat in the list works on touch screens (iOS spent the first
  tap on a hover), and All chats opens a folded chat list.

## [2.1.0] - 2026-11-16

Mnemo, a notes agent built into Memora, and images that live beside their
notes. The state database needs no migration: Mnemo keeps its chats, models
and sealed API keys in a separate `assistant.sqlite3` beside it, so 2.0 can
still roll back by swapping the binary.

### Added

- **Mnemo**, the notes agent built into Memora. Add as many providers as
  you like, each with its own name and ID: OpenAI (Chat Completions or the
  Responses API), Anthropic (Messages) or any OpenAI-compatible server
  (OpenRouter, Groq, Ollama, LM Studio, vLLM…), with your own API key; the
  key is sealed on the server and never sent back. Each provider can be
  tested, switched off (its models leave the pickers) or deleted.
  Mnemo finds, reads, writes, tags, links, moves and tidies notes with
  Memora's own tools, under its own name in Activity. It has no web, shell,
  admin or delete-for-good tools.
  - A full-screen chat page at `/mnemo` (no app header or tab bar; close it
    with the X or Esc, or go back to Memora from the chat list) with a chat
    list (search, pin, rename, delete). Opening Mnemo (the menu, the floating
    button on every page, Ctrl/Cmd+J or "Ask Mnemo" on notes and folders)
    always starts a new chat, with the open note or folder ready to attach;
    earlier chats are in the list. Drag the button to either side; drop it on the X (or
    use its × on hover) to hide it on that device, and bring it back from
    More, Show the Mnemo button.
  - Thinking as the model writes it: Claude's and OpenAI's reasoning
    summaries, the raw reasoning that OpenAI-compatible servers send
    (`reasoning_content`, `reasoning`, `reasoning_details`; Mnemo asks for it
    and stops asking a server that refuses), and the `<think>` blocks open
    models such as DeepSeek-R1, Qwen and Hermes write into their answers.
  - Mnemo knows the time where you are (its `current_time` tool uses your
    device's time zone) and Memora's own documentation (`search_docs`,
    `read_docs`): it answers questions about Memora and links the Docs page
    it used.
  - Streaming replies with live thinking (where the provider shows it) and an
    Activity block per reply: each step as it happens, then what Mnemo did,
    how long it took and the notes it read or changed (tap to open).
    Wikilinks open notes. The composer rests as a one-line capsule and opens
    on focus with +, the model picker (pinned first, hidden left out), a pin
    that makes the model the default for new chats (browser and console) and
    the memory ring. A timeline rail at the right edge, in thumb reach, has a
    bar per question: tap one to jump, hover it, or press and slide along the
    rail to scrub through the chat (the bars swell under the finger, a label
    names the question, phones tick). The transcript fades under its edges
    while you scroll.
  - Each chat keeps its whole conversation for its model. Near full, Mnemo
    folds the older messages into a summary written by the same model and
    carries on (a marker in the chat opens the summary); the memory ring
    shows how full the chat is, where compaction starts, and compacts on
    request.
  - Attach notes, folders and images to a message with + (or paste and drop
    images): they show as chips above the prompt, each with an ×, in one row
    that slides left and right (arrows on wide screens, no scrollbar). Up to
    four images per message; tap one to preview it. Images go to the model
    as real image input (OpenAI, Responses and Anthropic formats), so it can
    see them; a model without vision gets their names and a notice. Mnemo
    can also put an attached image beside the note it belongs to with its
    `place_image` tool. A big folder or the whole vault goes along as a list
    that Mnemo reads one note at a time, in batches, saying how far it got.
  - In the chat, the pictures that came with a message are tiles (tap for
    the full view, with the others of that message) next to its note chips,
    in the order they were attached, in a sliding row. Under every reply a
    Related row lists what it changed, showed and read.
  - Models: fetch them from the provider, with the context window and
    reply limit it reports in its standard model list, or add them by name;
    pin, hide and pick a default (with no default, new chats take the first
    pinned model, the same one everywhere).
  - Settings, Mnemo: providers, models, your own instructions in plain
    words and the floating button. Temperature, limits and tool steps keep
    sensible defaults (and stay adjustable over `POST /api/assistant/prefs`).
  - Ask Mnemo inside a note: a line with `@mnemo: <request>` (the editor
    offers it as you type `@` or `/mn`; also in a quote or a list item, never
    in code) runs a few seconds after the note is saved. Each request gets a
    chat of its own, titled `@mnemo · <note>: <request>` and shown with an
    "@ note" tag, where its steps and thinking stay; then Mnemo strikes the
    request through
    (`~~@mnemo: …~~`) and quotes its reply right under it; a struck request
    never runs again. Agents can ask the same way with
    `mention_agent` and agent `mnemo`.
  - Every chat has its own address (`/mnemo/<id>`): a reload, a link or Back
    opens the same chat. A new chat is called "New chat" until Mnemo's first
    reply, then the model names it in a few words in your language (a chat
    you renamed keeps your name).
  - The Mnemo sidebar has an Appearance card: the theme switch (light, dark,
    system) and the chat background, picked from preview tiles: Glow (the
    default), Aurora, Mesh, Dusk, Dawn, Deep, Dots, Grid, Lines, Waves, Grain
    or Plain. Quiet and theme-aware (a touch stronger on dark), remembered
    per device.
  - "In this chat", a panel on the right (a drawer on smaller screens):
    every note, folder, image and the vault the chat attached, read, changed
    or showed, grouped, each opening on a tap. The chat list folds away on
    wide screens too; both are remembered.
  - Phones: the Mnemo page follows the part of the screen the keyboard
    leaves, so the composer stays right above it (iOS, Android and the
    installed app).
  - Replies keep going on the server when you leave: open another chat,
    leave the page or lose the network, and the reply goes on; its chat
    spins in the list, and opening it shows the reply still streaming (or
    done). Only Stop ends a reply early.
  - Regenerate under every reply, and Try again on every message of yours
    and on errors: the turn runs again with the chat's model (later turns
    are replaced, after you confirm).
  - Mnemo hands things over: with its `show_items` tool, notes, folders,
    images or the whole vault appear as cards in its reply that open on a
    tap. The model picker links straight to Settings (Manage models and
    providers).
  - Export a chat: Download as Markdown, or Save as a note (in "Mnemo
    chats"), from the chat's menu; `/export` in the console.
  - Search every chat: the chat list's search box finds words in what you
    and Mnemo said (and in titles), marks them, and opens the chat at the
    message. Mnemo can look back too, with its own `search_chats` and
    `read_chat` tools, when you refer to an earlier conversation.
  - Mnemo has its own activity (Mnemo page, Activity; or its row on the
    Activity page): every tool call, each marked with who it was for and how
    it was asked ("owner · chat", "owner · console",
    `research-bot · @mnemo in Inbox`). Activity events carry this as `for`.
  - The console has it too: `/mnemo` chats with the same Mnemo (same chats,
    models and keys), shows its thinking and a summary of each reply, and
    takes `/attach` (a note or folder) and `/image` (a picture file),
    `/pin` (this model for new chats), `/memory`, `/compact`, `/activity`,
    `/search` and `/retry`, and opening a chat with a reply still running
    streams it;
    `/mnemo setup` adds, tests, switches and deletes providers and manages
    models.
  - Routes under `/api/assistant/` (signed-in browser only; API keys are
    refused). See docs/API.md.
- **Images beside notes.** Upload PNG, JPEG, WebP or GIF from the editor
  (button, paste or drop). An image is stored in the note's own folder and
  shown with `![alt](path:name.png)`; a `path:` to an image in another
  folder is copied beside the note on save, so a note never points across
  folders. URLs still work.
  - Images follow their note: moved with it, soft-deleted to the Trash with
    it, restored with it (to the same or another folder) and deleted for
    good with it. An image another note in the folder still shows is kept.
  - A gallery view of a folder's images (that folder only), and an Images
    tab beside a note (this note or its folder). The viewer shows which
    notes and sections show an image and opens the note at that spot.
  - Settings, Images: the largest upload (0.1 to 50 MB, 5 MB by default)
    and how much notes and images take.
  - MCP tools `upload_image` and `list_images` (77 tools in all), and
    `POST /api/vault/image`, `POST /api/vault/image/delete`,
    `GET /api/vault/images`, `GET /api/vault/storage`,
    `GET|POST /api/settings/media`.
- Reading settings offer nine colours (from paper and sepia to night and
  high contrast), nine fonts (including Literata, Atkinson Hyperlegible,
  Nunito, IBM Plex and OpenDyslexic, served by Memora itself) and nine text
  sizes.
- The sidebar can be dragged wider (up to 440 px) while it is open;
  double-click the edge to reset. Collapsing works as before.
- Version history shows a calm loading animation while it reads.

### Fixed

- Staying signed in while you work: the browser's session cookie used to keep
  the lifetime it got at sign-in, so it was dropped after the idle timeout (3
  hours by default) however active you were, although the server kept the
  session alive. Every request now renews the cookie too (at most every five
  minutes), and an open, visible tab you are using renews it while you read
  or scroll. An idle or hidden tab still signs out after the timeout.
- The Brain, Graph and Canvas toolbar no longer lets the search box, its
  shortcut and the badges overlap or spill out on medium widths. On phones
  the search is a plain "Search" pill, and touch screens no longer show the
  "/" keyboard hint.

### Security

- SQLite updated (bundled with `rusqlite` 0.41 / `libsqlite3-sys` 0.39) for
  RUSTSEC-2026-0459.

## [2.0.1] - 2026-10-24

A calmer reader. Notes read like a clean page whatever the reading settings.

### Changed

- Note text has a new type scale: clearer headings, even list spacing,
  quieter code, quotes and tables, and real check boxes for tasks.
- The side panel beside a note has two tabs, Contents and Details. Contents
  has its own tabs for the outline, links and mentions.
- Reading settings keep the choices that look right on every system: Sans,
  Serif and Mono; Default, Sepia and High contrast. Justified text, the
  Rounded and Legible fonts and the Night, Paper and Mint colours are gone;
  a saved choice moves to the nearest one left.

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

[2.0.1]: https://github.com/Codrihub/memora/releases/tag/v2.0.1
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
