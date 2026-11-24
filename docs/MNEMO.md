# Mnemo

Mnemo is the notes agent built into Memora. You connect your own AI key, ask in plain
words, and Mnemo finds, reads, writes, tags, links, moves and tidies your notes with
Memora's own tools. Every step it takes shows in the chat and in Activity, and every
change can be undone from History. Mnemo has no web access, no shell, and cannot delete
anything for good, empty the Trash, delete folders, import or export, read keys or change
settings.

Open it from the sidebar, with <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>J</kbd>, from the
floating button, or with **Ask Mnemo** on a note or folder. The console has it too
(`memora-cli`, then `/mnemo`).

## Set up

1. Open **Settings → Mnemo** and add a provider: OpenAI, Anthropic, or any
   OpenAI-compatible server (OpenRouter, a local Ollama or LM Studio, a router of your
   own). The key is sealed on your server and never sent back to the browser.
2. Fetch its models (or **Add model** in the Models header to add one by its id), pin
   the ones you use and pick a **default model**. In a chat, the model list marks the
   default with a pin and a **Default** badge; tap another model's pin to make it the
   default for new chats.
3. Optionally line up **fallback models** (their own card, **Add** in its header): when
   a reply's model fails after its retries, the next one carries on and the chat says so.

Models that can think get a **Think** button under the message box, beside Agents and
the context meter (Auto, Off, Low, Medium, High). It is one setting for every chat and can
be set before the first message.

### Models for each job

Besides the chat model you can set, in **Settings → Mnemo → Models for each job**:

- a model that **reads images**: it looks at vault pictures (`describe_image`), and
  describes the pictures in your newest message when the chat model cannot see them
  (quietly; a short toast says so, or that a picture could not be read);
- a model that **makes images** (`generate_image`), shown in the chat and kept in a note on
  request;
- a model that **reads replies aloud** (Listen under a reply), with a voice;
- a model that **listens** (the mic in the message box).

The mic and Listen show only once their model is set.

## Chatting

- **Scope.** A chat is about your whole vault, or about one note or folder (Ask Mnemo on
  it). The **+** button attaches a picture from your device, notes, a folder or the whole
  vault.
- **While it works.** A tray on top of the message box says what Mnemo is doing and for
  how long, with its plan and your queued messages under it; it opens and folds by
  itself. Send a new message to queue it, **Send now** to cut the reply and answer the
  new one, or **Stop** (the next queued message then goes out). A reply keeps running if
  you close the tab or the server restarts, and the chat follows live on every device.
- **Long chats.** Only the latest questions go on the page at first; earlier ones come in
  as you scroll up (or with **Show earlier questions**), jump to them on the timeline, or
  open a search hit there.
- **Boards in the chat.** A Kanban board you mention, Mnemo links or hands over, or a
  kanban tool works on shows under the reply as a board preview: how many cards are done,
  its lanes and their first cards, kept up to date while Mnemo and other agents change the
  board. Tap it to open the board itself. In replies a board looks
  different from a note: a board icon and a violet accent. Ask for several boards in one
  note and Mnemo makes a board note per board and embeds each (`![[Board]]`).
- **Boards, all of it.** Mnemo can do on a board everything you can: create, turn a note
  into a board, rename, move, duplicate, colour and delete boards; add, rename, reorder,
  colour, limit, archive and delete lanes; add, edit, move, tick, archive, colour and
  delete cards with linked notes, due dates, tags and checklists; and put boards into
  notes. Four switches in **What Mnemo can use** (Boards: read, cards and lanes, create
  and manage, in notes) decide which of that it may do, and Ask first, Auto and Read
  only apply as for notes.
- **@mnemo in a note.** Write `@mnemo: <request>` in a note and Mnemo does it, with the
  note as context.
- **Skills.** Reusable instructions kept as notes in the folder `Skills` (one note per
  skill). Type `/` in the message box to run one.
- **Fleeting chats.** A chat that is not kept: it disappears, with its pictures, when you
  leave it, and stays out of the chat list, search and Mnemo's memory of you. Every tool
  and sub-agent still works; changes to notes are kept. Start one with the incognito icon
  on a new chat, or go to `/mnemo#fleeting-chat`.
- **The chat list.** Pin, rename, archive, export as Markdown or save as a note, and
  search everything said. **All chats** shows them on one page.
- **Appearance.** Theme, backdrop, text size and chat width (Compact, Wide, Full), kept
  per device. The width follows the room the chat has, so it holds when the side panes
  change.
- **Resizable panes.** On a desktop, drag the edge of the chat list or of the side panel
  (Agents, In this chat) to change its width, like the page preview. Each keeps a
  minimum, a double-click resets it, and the width is remembered on the device.

## Ask first, Auto or Read only

Pick how freely Mnemo works with the chip in the message box:

- **Ask first:** every change waits for your OK, and so do sub-agents (Mnemo says roughly
  how many tokens they will use). When something is unclear Mnemo asks a question with
  options to tap, plus **Other**.
- **Auto:** changes and sub-agents go ahead without asking, until the task is done.
- **Read only:** Mnemo looks things up and answers, and never changes a note.

## Mnemo's plan

For a longer task (an audit of many notes, a reorganisation, a long edit) Mnemo first
lists its steps. They show as a checklist in the tray on top of the message box, each one
not started, in progress or done, updated live on every device; fold it to see only the
step at work. Mnemo adds, edits, checks and removes single steps as it works.

The plan belongs to the chat, not to one reply: **Stop** leaves it as it was, and Mnemo
sees it again on your next message and carries on, changes it or clears it. It closes the
moment every step is done, and the **×** on it puts away a plan you no longer want (while
no reply runs). Without a plan, the checklist follows the reply's sub-agents.

## Sub-agents

Mnemo can hand a task to a sub-agent: another model run that works on it alone, several
at the same time (say one note or folder each), and answers Mnemo. There is nothing to
set up: Mnemo names each one as it starts it.

- A sub-agent runs on your default model, then your fallbacks, like a chat. Ask for a
  specific model in the chat by its full id or its short name; Mnemo uses exactly that
  model or tells you it is not there.
- The reply shows one line ("3 sub-agents · 2 working · 1 done"). **Agents**, at the top
  right of the chat, opens the Agents panel: every sub-agent, newest first, running, idle
  (it answered and can take another task) or done. Each card shows the sub-agent's id,
  model, tokens and context, and three sections that are always there: **Instruction**
  (its task and Mnemo's instructions), **Activity** (its steps, live while it works) and
  **Answer**. Switch a sub-agent's model there.
- Mnemo manages its sub-agents: it can set one up ahead of its task, change its
  instructions, model or name, send a running one a message, wait for it, stop it, mark it
  done or remove it from the list, one at a time or all at once. Every sub-agent has a
  short id that never changes (a1, a2, …), so it can be renamed freely; ask Mnemo by id
  or by name ("mark a3 done", "stop all sub-agents").
- A sub-agent can also work in the background while Mnemo goes on; the reply does not end
  before every one has answered.
- A sub-agent can ask Mnemo a question, takes follow-ups, and summarises its own work when
  its context fills up. It cannot see your chat or ask you anything, and in Ask first mode
  it does not change notes.

## What Mnemo knows about you

Mnemo keeps short notes about you as it goes: how you like answers, who you are, what you
like. They are one plain list in **Settings → Mnemo → What Mnemo knows about you**: edit or
delete any of them, add several at once (one per line), or turn learning off. **Describe
me from my notes** lets Mnemo read your vault in a new chat and keep what it learns. A new
chat offers the same once, as **Tell Mnemo about you**, which you can skip. Nothing is
learned in a fleeting chat.

## What Mnemo can use and see

- **Tools per agent.** **Settings → Mnemo → What Mnemo can use** lists every tool: the
  Memora ones (reads and changes) and Mnemo's own (pictures, chats, plans, sub-agents).
  Tap a tool to switch it off or on, for Mnemo itself or for its sub-agents. A tool
  switched off on the Tools page is off for both.
- **Private from Mnemo.** Mnemo is listed with the agents in every note's, folder's and
  picture's privacy panel. Hide anything from it there: its searches, reads and picture
  tools then never see it, and neither do its sub-agents.

## Storage and pictures

Notes, images and chats each warn at 90% and 99% of their room, in the app and in the
results tools return to agents. **Settings → Storage** shows every image and the note that
uses it.

## Languages

The whole interface comes in many languages: pick one in **Settings → Appearance →
Language** (per device; Auto follows the browser), and set the language new devices start
in, with the server's name, in **Settings → Server** or during setup. Mnemo writes its
suggestions in the language you write to it.

## Reference

The HTTP routes, preferences and stream events are in the [API reference](API.md#mnemo-built-in-agent).
