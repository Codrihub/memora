# Kanban boards

A note can be a Kanban board. Memora reads and writes the format of the
[Obsidian Kanban](https://github.com/mgmeyers/obsidian-kanban) plugin, so a
board made in Obsidian opens in Memora as a board, and a board saved by Memora
opens in Obsidian as before. People work on it in the web app; agents and Mnemo
work on it over MCP.

## The format

A note is a board when its frontmatter has a `kanban-plugin` key:

```markdown
---

kanban-plugin: basic

---

## To do (5)

- [ ] Write the brief for [[Atlas]] #docs @{2026-12-01}
- [ ] Call the printer @{2026-12-03} @@{10:30}
	A second line of the card, indented with a tab.

## Doing

- [ ] Review the plan


## Done

**Complete**
- [x] Pick a title


***

## Archive

- [x] An old idea

%% kanban:settings
```
{"kanban-plugin":"basic","lane-width":280}
```
%%
```

- Every `## heading` is a lane. A title ending in ` (5)` sets the lane's card
  limit: the count turns amber when the lane holds more.
- Every list item under a lane is a card: `- [ ]` is open, `- [x]` is done.
  Lines indented under it belong to the card.
- Cards may hold `[[wikilinks]]` (they open the note and count as links in the
  graph and backlinks), `#tags` (they open the tag), dates as `@{2026-12-01}`
  and times as `@@{10:30}`. On an open card a past date shows in a warning
  tint and today's date in a softer one; a board's own date colours
  (Obsidian Kanban's `date-colors`) win when it sets them.
- A lane with a `**Complete**` line under its heading checks every card moved
  into it, and unchecks a card moved out of it.
- The `## Archive` heading after a `***` line holds archived cards.
- The `%% kanban:settings %%` block keeps the plugin's settings. Memora reads
  `lane-width` and keeps every other setting as it is, known or not.

To start a board, use **New board** (below), add `kanban-plugin: basic` to an
existing note, or use **Turn into board** on a note.

## Your file stays your file

Memora never rewrites a board as a whole. A change touches only the lines of
the cards and lanes it changes: moving a card moves its lines, ticking it off
changes one character. The frontmatter, the settings block, the archive, text
between lanes, block ids (`^abc123`) and anything else Memora does not use keep
every byte. A file read and saved with no change is identical.

Every change is a normal save of the note: a commit in its version history
(`kanban: move card to Doing in Work/Board.md`), an entry in Activity, and a
live update on every open board and every open copy of the note. Version
history, diff and restore work on boards like on any note.

## In the web app

### The Boards page

**Boards** in the sidebar, under Workspace (on phones, under **More**), lists
every board in the vault as a card with its folder, colour and icon, lanes,
progress, how many cards are overdue and last change; a click opens it. The
**Boards** item itself shows how many cards are overdue. Each card's ⋯ menu (or
a right-click, or a long press on a touch screen) has **Open**, **Rename**,
**Move to…**, **Duplicate**, **Color and icon…** and **Move to Trash**; with a
card focused, F2 renames and Delete moves it to the Trash. Moving a board or a
note to the Trash, from here, the board itself or the note lists, shows a toast
with **Undo** that brings it back from the Trash.
Sort the page by last change, name, progress or next due date, and filter it
by folder or to boards with overdue cards, not done or done; the choice is kept
on the device and works with the search box.

### New board

**New board** sits everywhere **New note** does: the top of the sidebar, the
**New** button on Overview and in the folder view (Note or Board), folder and
note menus, search, and the `B` key next to `N`; a missing `[[link]]` offers
to create it as a board too. It asks for a name and a folder and creates a board
with the lanes To do, Doing and Done. The lane names are written in the
interface language, since they are your own text; the Done lane gets the
`**Complete**` marker Obsidian Kanban uses. Board notes carry a board icon in
the tree, the note lists, pins and search.

### Working on a board

A board note always opens as a board in the Notes page, in the same page frame
as a note (the title in the same place), and you edit it right on the board.
The lanes run the full width of the page, the first one in line with the
title. Its toolbar keeps **History**, **Ask** (Mnemo), **Aa** (Board view, see
below), hiding the toolbar (F; Esc or F brings it back) and the ⋯ menu;
**Contents** and **Edit** of other notes are not there. For the raw Markdown,
**Edit Markdown source** in the ⋯ menu opens the editor; **Save** or **Close**
go back to the board.

- Drag a card to another lane or place, or drag a lane by its header. With a
  mouse, press and move; on a touch screen, press and hold, then move. Near the
  edge the board scrolls.
- **Add a card** at the bottom of a lane, or double click a card (or press
  Enter on it), to open the card form: the text, **Linked notes** (search the
  vault, each note a chip), **Due** (a calendar with Today, Tomorrow and Next
  week, and an optional time), **Tags** (the vault's tags with their counts), **Done** and the **Lane**, plus **Archive** (with Undo)
  and **Delete** for an existing card. On phones it is a bottom sheet. Enter
  saves, Shift+Enter starts a new line, Esc closes.
- The form writes plain Obsidian Kanban text into the card's line: `[[Note]]`,
  `#tag`, `@{2026-01-31}` and `@@{10:30}` (the board's `date-trigger`,
  `time-trigger`, `date-format` and `time-format` settings are followed).
  Links, tags and dates stay where they were in the text, new ones go at the
  end of the first line, and anything else in the card stays as you wrote it.
- The form also holds a **Checklist** (steps written as `- [ ] step` lines
  under the card: add, tick, reorder with Alt+arrows, remove; the card shows
  `2/5` and a thin bar) and a **Color**.
- The box at a card's left ticks it off. The card's ⋯ menu edits it, moves it
  to another lane, duplicates it, sets its colour, archives it, copies its text
  or deletes it (with Undo).
- Double click a lane title to rename it. The lane's ⋯ menu adds a card,
  renames, moves or duplicates the lane, adds a lane after it, sets its colour
  and its card limit (Obsidian's ` (N)` after the title), archives or deletes
  all its cards, and deletes it once it is empty (with Undo).
- The board's ⋯ menu (in the reader bar) has **Color and icon…**,
  **Duplicate board**, **Embed in a note…** and **Edit Markdown source**, next
  to rename, move and delete as for any note. **Aa** opens **Board view**:
  spacing, lane width, card style, background, whether done cards, empty
  lanes, dates, tags and linked notes show, and whether cards are coloured by
  their own colour, their first tag or their due date; for every board or for
  this one only, kept on the device.
- **Archive** above the board shows the archived cards, to put back or delete.
- Keyboard (click a card or tab to it first): the arrow keys move between cards
  and lanes (up from the first card, or into an empty lane, focuses the lane),
  Enter opens the card form, Space ticks off, Alt/Option with the arrows moves
  the card (left and right follow the reading direction; a screen reader hears
  the lane and place it went to), N adds a card to the focused lane, Delete
  archives with Undo and ? lists these keys. Help & shortcuts lists them too.

Lanes scroll sideways and a tall lane scrolls its cards, with no scrollbars: a
soft fade at an edge shows there is more that way. On a narrow board (a phone, a narrow chat) the board shows one
lane at a time and snaps from lane to lane, and a row of dots under the lanes
jumps to any lane. On cards, links, tags, mentions (`@name`), dates and
`- [ ]` steps show as small chips and boxes; a link or tag opens on a click.

Colours are kept in the board's own settings block so they travel with the
file: lane and card colours and the board's colour and icon under a `memora`
key, tag colours in Obsidian's own `tag-colors`. A coloured card gets a block
id (`^abc123`) at the end of its first line, which Obsidian Kanban keeps as part
of the card. Both survive a save from Obsidian Kanban (checked against the
plugin's source): it parses the whole settings JSON and writes the whole object
back (`settingsToCodeblock` writes `JSON.stringify(board.data.settings)`), its
settings dialog edits that same object, and it cuts a card's ` ^id` off the
first line when it reads the card and puts it back there when it writes it.
Memora's block ids are six letters and digits at the end of the first line, the
form the plugin expects. Obsidian's **Duplicate card** copies the block id; when
one of two cards sharing an id gets a colour, Memora gives it an id of its own
first. Keep the settings block the last thing in the file: Obsidian Kanban
reads it only from there.

### What is due

Overview has a **Due** section with the open cards of every board that are
overdue, due today or due in the next 7 days, each with its board, lane and
date. A click opens the board at that card (it scrolls into view and flashes
once); the round box ticks it off right there, with Undo. The section hides
while nothing is due. A card's due date is its earliest date (`@{2026-12-01}`),
and "today" is the reader's own day.

**Due date reminders** (Settings, Notifications) are off by default. Turned on,
the browser asks for permission, and while Memora is open or installed it sends
one notification when a card falls due and one a day while cards are overdue;
a tap opens the board. Reminders follow the agent pop-up switch, are kept per
browser, and never repeat for the same card and day.

### Boards in the Mnemo chat

When a turn names a board (you mention it with `@` or `[[`, Mnemo links it in
its reply or hands it over as a card, or a kanban tool works on it), the board
shows under the reply as a board preview: its name and folder, how many cards
are done, its lanes as bars, and the first cards of each lane. It is a preview
to read, kept up to date as agents change the board; tap it
to open the board itself and work on it there.

In Mnemo's replies boards and notes look different: a link to a board carries
the board icon, and board chips and cards a violet accent of their own, while a
note card shows a line of the note's text.

### Where a board shows up

The foot of a board's page has one **Mentioned in** list: every note that
mentions the board, those that show it (`![[...]]`) first, each a chip that
opens the note with a small marker, a board icon ("Shows this board") or a link
icon ("Links here"). **Links to** shows only when the board's cards link to
notes. The board's preview in the Mnemo chat folds out the same list as a line
such as **In 3 notes**, and in Mnemo's replies a note that embeds boards carries a small
board badge, its card folding out a list of those boards with their progress.
Agents read the same through `kanban_get_board` / `kanban_list_boards`
(`embedded_in`, `linked_from`) and a note read (`boards`).

### Boards in your notes

One board file is always one Obsidian Kanban board. A note holds several boards
by embedding them:

- `![[Board name]]` on a line of its own shows that board in the note, live and
  whole: drag, tick off and add cards right there, with **Open** for the board
  on its own page. Embed as many boards as you like; each stays its own file,
  updates as people and agents change it, and opens in Obsidian as before. On
  phones its lanes scroll sideways. A version from the history shows embedded
  boards as cards.
- **Add board** in the editor's toolbar offers **New board**, which asks for a
  name (and a folder, the note's own by default), creates a board with the
  lanes To do, Doing and Done and embeds it, `![[Board name]]`, on its own line
  at the cursor, or **Existing board…**, which embeds a board you pick. Use it
  again for another board in the same note. **Embed a board…** in a note's ⋯
  menu adds one at the end of the note.
- A plain link to a board on a line of its own, `[[Board name]]`, shows as a
  small card: the board's name, its lanes as bars, how many cards are done, and
  **Open**. A link inside a sentence stays a link.
- Ask Mnemo for several boards in one note and it does the same: one board note
  per board, each embedded in the note.
- **Turn into board** in a note's ⋯ menu makes a plain note a board: each
  heading becomes a lane and each list item a card (`- [x]` items stay ticked
  off; indented lines stay with their card). Items before the first heading go
  to To do; a note with no headings gets To do, Doing and Done, with ticked
  items in Done. It shows how many lanes and cards you get and how many lines
  of other text are left out, and asks first. The note's earlier version stays
  in its version history, so you can restore it.

## Edits that cross

Every board has a `version` (a short hash of the note). Each edit carries the
version it was made on, and the server refuses an edit on a board that changed
since (`board changed`), so nothing is overwritten:

- the web board applies the edit again on the newest version when its card is
  still there (cards keep their id while their text stays the same), and
  otherwise shows the newest board;
- an agent is told to read the board again with `kanban_get_board`.

## For agents (MCP)

Everything a person can do on a board, an agent can do too. The tools come in
four groups, each its own switch on the Tools page, for Mnemo and its
sub-agents, and in every API key's tool list (see
[MCP.md](MCP.md#kanban-boards-kanban)):

| Group | Tool | | Use |
|---|---|---|---|
| Boards: read | `kanban_list_boards` | R | Find boards, with their lanes, counts and progress. |
| | `kanban_due` | R | Open cards with a due date across boards: overdue, due today and upcoming, each with its board, lane, card id and date. |
| | `kanban_get_board` | R | Read a board: lanes (colour, limit), cards with ids, fields, checklist and colour, archive, settings, version. |
| Boards: cards and lanes | `kanban_add_card` | W | Add a card, with linked notes, tags, date, time, checklist and colour. |
| | `kanban_move_card` | W | Move or reorder a card. |
| | `kanban_update_card` | W | Change a card's text and fields, tick it off, archive or restore it. |
| | `kanban_card` | W | Duplicate, delete or restore a card. |
| | `kanban_lane` | W | Add, rename, move, duplicate, colour, limit, archive all, clear or delete a lane. |
| Boards: create and manage | `kanban_board` | W | Create a board in any folder, turn a note into one, rename, move, duplicate, delete, colour and icon, tag colours, Obsidian Kanban settings (`date-colors` and the rest). |
| Boards in notes | `kanban_embed` | W | Put a board into a note (`![[Board]]`) or take it out. |

"What is overdue?" is one call: `kanban_due {range: "overdue"}` lists those
cards across boards with their board and card id, ready for
`kanban_update_card {path: board, card, checked: true}` or `kanban_move_card`.
Pass `today` as the user's own day when it may differ from the server's.

A typical session: `kanban_list_boards`, `kanban_get_board` for the ids and the
version, then `kanban_move_card {path, card, lane: "Doing", version}`. Lanes are
named by title (case is ignored when nothing matches exactly) or by position
from 0 written as digits (`"0"`). Structured card fields are written exactly as
the card form writes them, so a card an agent edits looks the same as one a
person edits.

The tools follow everything other note tools follow: key scopes (`write` for
every tool that changes something), per-key tool lists, server-wide switches,
privacy rules (a hidden board answers "not found") and note locks. For Mnemo,
Ask first asks before each change, Auto goes ahead, and Read only allows only
the read tools. Every change is a normal save: one commit in the note's
history and a live update on every open board. Several boards in one note:
one board note per board, each embedded with `kanban_embed`.

## HTTP

The web board uses `GET /api/kanban?path=` and `POST /api/kanban`; the Boards
page reads `GET /api/kanban/boards` and Overview's Due section
`GET /api/kanban/due`
(see [API.md](API.md#vault)).
