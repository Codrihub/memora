import { t } from '../i18n';
import { api } from '../api';
import { attr, esc, useStyles } from '../dom';
import { state } from '../state';
import { Modal } from '../modal';
import { openDocs } from '../router';
import { markSvg } from '../brand';
import { BRAND_FONT, BRAND_FONT_CSS } from '../brand-font';
import { icon } from './icons';
import { createSelect } from './select';

type Kind = 'new' | 'better' | 'admin';

interface Item {
  icon: string;
  title: string;
  text: string;
}

interface Release {
  version: string;
  date?: string;
  title: string;
  lead: string;
  groups: { kind: Kind; items: Item[] }[];
}

/** Newest first. */
const RELEASES: Release[] = [
  {
    version: '3.2.0',
    title: t('Boards that keep you on time'),
    lead: t('See what is due across every board, sort and filter your boards, and work a board from the keyboard, with Mnemo keeping track too.'),
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'alert', title: t('Due, on Overview'), text: t('Cards that are overdue, due today or due this week, from every board, each with its board and lane. Open a card on its board or tick it off right there.') },
          { icon: 'bell', title: t('Reminders, if you want them'), text: t('Turn on due date reminders in Settings: one notification when a card falls due and one a day for what is overdue. The Boards item counts what is late.') },
          { icon: 'more', title: t('A menu on every board'), text: t('On the Boards page each board has a ⋯ menu to open, rename, move, duplicate, colour or trash it. Right-click or a long press opens it too.') },
          { icon: 'kanban', title: t('Sort and filter boards'), text: t('Sort by last change, name, progress or next due date, and filter by folder, overdue cards or done. Your choice stays on this device.') },
          { icon: 'command', title: t('Boards from the keyboard'), text: t('Arrows move between cards and lanes, Enter edits, Space ticks, Alt with the arrows moves a card, N adds one and ? lists the keys.') },
          { icon: 'mnemo', title: t('Mnemo knows what is due'), text: t('Ask Mnemo what is overdue across your boards; it can tick cards off or move them for you, and agents get the same over MCP.') },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'alert', title: t('Overdue at a glance'), text: t('Past due dates show in a warning tint and today’s in a softer one, and the Boards page counts what is overdue. A board’s own date colours win.') },
          { icon: 'trash', title: t('Undo after Move to Trash'), text: t('Trash a board or a note from the Boards page, the board itself or the note lists, then bring it back with Undo in the toast.') },
          { icon: 'check', title: t('Checked with Obsidian'), text: t('Board colours and card ids that Memora keeps in the file are checked to survive a save in Obsidian Kanban.') },
        ],
      },
    ],
  },
  {
    version: '3.1.0',
    title: t('Boards for your tasks'),
    lead: t('Kanban boards that you and your agents work on together, notes that read better on every screen, and tidier menus.'),
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'kanban', title: t('Kanban boards'), text: t('Notes in the Obsidian Kanban format open as boards. Drag cards and lanes with a mouse or a finger, and every change lands in the note’s history.') },
          { icon: 'edit', title: t('A form for every card'), text: t('Add or edit a card with its text, a checklist, linked notes, a due date, tags, a colour, done and its lane. It is saved as plain Obsidian Kanban text.') },
          { icon: 'plus', title: t('Boards inside notes'), text: t('Embed new or existing boards in a note and work on each right there, or put a board into any note from its ⋯ menu; a plain link reads as a small card.') },
          { icon: 'palette', title: t('Boards your way'), text: t('Colour boards, lanes and cards, give a board an icon, set lane limits, and duplicate, archive or clear lanes and cards from their menus.') },
          { icon: 'mnemo', title: t('Boards in the Mnemo chat'), text: t('A board you mention, Mnemo links or an agent changes shows under the reply as a live preview of its progress and first cards; a tap opens the board.') },
          { icon: 'agents', title: t('Agents work the board'), text: t('Mnemo and agents can do on a board everything you can, over MCP, behind four Kanban permission switches that follow Ask first, Auto and Read only.') },
          { icon: 'overview', title: t('A Boards page'), text: t('Every board with its lanes and progress. New board sits wherever New note does: the sidebar, Overview, folders, menus, search and the B key.') },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'check', title: t('Your file stays your file'), text: t('A change rewrites only the lines it touches, so the board opens the same in Obsidian. Its Markdown is in the ⋯ menu, and Turn into board makes a list note a board.') },
          { icon: 'book', title: t('Your way to read'), text: t('Aa opens a new panel with more page colours, fonts, spacing, headings, links and code, for every note or just one, and a Board view with spacing, card style and colours.') },
          { icon: 'book', title: t('Calmer reading'), text: t('Notes and boards share one page frame with the same spacing on phones, tablets and desktops, and the links at the foot of a note share one tidy look that folds away.') },
          { icon: 'note', title: t('Notes and boards, connected'), text: t('A board shows which notes it is in, and in Mnemo\'s replies a note that holds boards says so. Both stay folded until you open them.') },
          { icon: 'kanban', title: t('Boards that flow'), text: t('Lanes fade at the edge while there is more to see, snap one at a time on phones with dots to jump between them, and links, tags and mentions on cards show as chips.') },
          { icon: 'note', title: t('Boards stand out'), text: t('Board notes carry a board icon in the tree, the note lists and search. In Mnemo\'s replies a board has its own icon and colour, and a note card shows a line of the note.') },
          { icon: 'sidebar', title: t('Menus, tidied'), text: t('The sidebar groups its pages into Workspace and Agents, each folds like an accordion, and the Library heading stays at the top while you scroll. The menu under your name keeps account, system and help.') },
          { icon: 'menu', title: t('More on phones'), text: t('The bottom bar keeps Overview, Notes, Brain and Activity and steps aside while you type or hide the toolbar; More opens every other page, and the side menu opens full width.') },
        ],
      },
    ],
  },
  {
    version: '3.0.1',
    title: t('Sub-agents you can steer'),
    lead: t('Mnemo manages its sub-agents, keeps its plan with the chat, and the chat fits every screen better.'),
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'agents', title: t('Mnemo runs its sub-agents'), text: t('Each has a short id that never changes, so names can change freely. Mnemo sets them up, changes their instructions or model, messages, waits for, stops, finishes and removes them, one or all at once, and can let them work in the background. Each card shows Instruction, Activity and Answer.') },
          { icon: 'check', title: t('A plan that belongs to the chat'), text: t('Steps are added, edited and checked as Mnemo works. Stop a reply and the plan stays as it was; it closes once every step is done.') },
          { icon: 'expand', title: t('Panes you can resize'), text: t('On desktop, drag the edge of the chat list or the side panel to make it wider or narrower. Each keeps a minimum and remembers its width.') },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'sidebar', title: t('A roomier chat list'), text: t('Wider rows, the ⋯ menu always in reach on touch screens, a drawer on tablets and a whole screen on phones.') },
          { icon: 'chat', title: t('A tidier chat everywhere'), text: t('Messages and the message box line up exactly in every width, the model picker has its own surface, the fleeting chat fits phones, and a question\'s options never slide away as you tap them.') },
          { icon: 'help', title: t('Clearer questions'), text: t("Mnemo's question sits on its own band, its answers below as rows to tap, as many as the question needs.") },
          { icon: 'bolt', title: t('Long chats, light'), text: t('Only the latest questions go on the page at first; earlier ones come in as you scroll up or jump to them on the timeline.') },
          { icon: 'image', title: t('Quiet about pictures'), text: t('Only pictures in your newest message go to the image model, and you hear of it in a short toast.') },
          { icon: 'send-now', title: t('Stop, then the queue'), text: t('Stopping a reply always sends the next queued message, and Scroll to bottom shows only when you are away from the end.') },
        ],
      },
    ],
  },
  {
    version: '3.0.0',
    title: t('Your language, your rules'),
    lead: t('Memora in your language, Mnemo showing its plan as it works, and you choosing what it may use and see.'),
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'chat', title: t('Pick your language'), text: t('Choose from many languages in Settings, Appearance, per device. Auto follows your browser.') },
          { icon: 'check', title: t('Mnemo\'s plan, live'), text: t('Longer tasks show as a checklist above the message box: not started, in progress, done.') },
          { icon: 'shield', title: t('You decide what Mnemo uses'), text: t('Switch tools off for Mnemo or for its sub-agents, and keep notes, folders or pictures private from it.') },
          { icon: 'user', title: t('Tell Mnemo about you'), text: t('A few words, or let it learn from your notes. What it knows is one plain list you can edit.') },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'sparkle', title: t('Suggestions in your words'), text: t('New chat ideas come in the language you write to Mnemo in.') },
          { icon: 'agents', title: t('Tidier sub-agents'), text: t('The newest on top, the latest step first, and a full-width line with a clear View button.') },
        ],
      },
    ],
  },
  {
    version: '2.2.1',
    title: 'Sub-agents, simpler',
    lead: 'Nothing to set up for sub-agents, every model in reach, a yes that sticks, and the live status above the message box.',
    groups: [
      {
        kind: 'better',
        items: [
          { icon: 'agents', title: 'No setup for sub-agents', text: 'Mnemo names and starts them itself. Settings keeps only whether it asks first; follow them and switch their model in Agents.' },
          { icon: 'chat', title: 'Every model, by name', text: 'Ask for a sub-agent model by its short name. Mnemo sees all your models, with your default and fallbacks, and never swaps in another.' },
          { icon: 'chat', title: 'Status above the message box', text: 'What Mnemo is doing, and for how long, now sits in one line just above where you type, only while it works. Tap it to see the sub-agents.' },
          { icon: 'send-now', title: 'Your yes sticks', text: 'Said Run them and then wrote again? The sub-agents still run, without a second question.' },
        ],
      },
    ],
  },
  {
    version: '2.2.0',
    title: 'A model for every job',
    lead: 'Sub-agents that work at the same time, models that read and make images, speak and listen, notes Mnemo keeps about you, and a new chat list.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'agents', title: 'Sub-agents and the Agents panel', text: 'Mnemo hands tasks to sub-agents, several at once, and answers from what they find. Follow them live in the Agents panel at the top right; the chat keeps one line.' },
          { icon: 'image', title: 'Models for each job', text: 'Set a model that reads images, one that makes them, one that reads replies aloud and one that listens. A chat model that cannot see gets the pictures described.' },
          { icon: 'shield', title: 'Ask first, Auto or Read only', text: 'Pick how freely Mnemo works: ask before changes and sub-agents, go ahead with everything, or only read.' },
          { icon: 'user', title: 'What Mnemo knows about you', text: 'Mnemo quietly notes how you like answers. See, edit or delete every note in Settings, or turn learning off.' },
          { icon: 'alert', title: 'Storage that warns you', text: 'Notes, images and chats each warn at 90% and 99% of their room. Settings shows every image and where it is used.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'chat', title: 'A new chat list', text: 'An icon rail for actions, pinned chats apart, and each chat with its kind, time and a line of the last message, grouped by day. Archive chats and see them all on one page.' },
          { icon: 'send-now', title: 'Send now always goes', text: 'Send now or Stop ends the reply at once, whatever it is doing, and your message goes right away. A live status shows what Mnemo is doing and for how long.' },
          { icon: 'incognito', title: 'Fleeting chats, anonymous', text: 'Quiet and colourless in any theme, with plain words on what is and is not kept.' },
          { icon: 'expand', title: 'Chat width', text: 'Compact, Wide or Full in Appearance, kept per device.' },
        ],
      },
    ],
  },
  {
    version: '2.1.12',
    title: 'Private fleeting chats',
    lead: "Fleeting chats look the part, the timeline rail answers a hold on phones, and What's new picks versions from a dropdown.",
    groups: [
      {
        kind: 'better',
        items: [
          { icon: 'bolt', title: 'Pick a release from a list', text: 'The row of versions is now one dropdown, newest first, with the latest selected.' },
          { icon: 'incognito', title: 'Fleeting chats look private', text: 'A fleeting chat turns into a dark, incognito room in either theme and says plainly what is and is not kept.' },
          { icon: 'chev-up', title: 'Timeline rail on phones', text: 'Press and hold the bars on the right to scrub through your questions; no swipe needed first.' },
          { icon: 'refresh', title: 'Model divider centred', text: 'The line that marks a change of model sits in the middle of the chat again.' },
        ],
      },
    ],
  },
  {
    version: '2.1.11',
    title: 'Thinking level for every model',
    lead: 'The Think chip no longer waits for a model to show its thinking first.',
    groups: [
      {
        kind: 'better',
        items: [
          { icon: 'brain', title: 'Think chip on router models', text: 'Models behind a router alias get the thinking level right away. It hides only when the provider refuses it.' },
        ],
      },
    ],
  },
  {
    version: '2.1.10',
    title: 'Every chat keeps its model',
    lead: 'The default model is for new chats only, a fallback that takes over stays, and a divider shows each change of model.',
    groups: [
      {
        kind: 'better',
        items: [
          { icon: 'pin', title: 'A chat keeps its model', text: 'The model a chat began with, or the one you switched it to, stays with that chat. Changing the default only changes new chats.' },
          { icon: 'refresh', title: 'Fallbacks you can see', text: 'When a model fails and a fallback takes over, the chat switches to it and a divider says so. Every change of model is marked, even inside one reply.' },
          { icon: 'bolt', title: 'Straight to the fallback', text: 'A model out of quota, with its key refused or not found is skipped at once; a busy one gets one quick retry before the next model.' },
          { icon: 'brain', title: 'Thinking level for more models', text: 'A model that has shown its thinking gets the Think chip, whatever its name.' },
          { icon: 'send', title: 'A calmer prompt', text: 'The model and its memory ring sit under the prompt; inside it, just the thinking level and Send. The fleeting eye shows on new chats only.' },
        ],
      },
    ],
  },
  {
    version: '2.1.9',
    title: 'Chats in step everywhere, a queue that never sticks',
    lead: 'Every device shows the same chat live, queued messages always go out, and Mnemo can fall back to another model or think harder when you ask.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'monitor', title: 'Live on every device', text: 'A message sent on your phone shows up on your laptop at once, with Mnemo\'s reply streaming on both. The queue is the same everywhere too.' },
          { icon: 'enter', title: 'Send now, as a new message', text: 'Send a queued message now (or press Ctrl+Enter): Mnemo\'s reply is cut where it is and your message is answered as a new one, not mixed into the old reply.' },
          { icon: 'refresh', title: 'Fallback models', text: 'Line up to five models in Settings, Mnemo. When the chat\'s model fails, the next one carries on by itself; with none left, the error shows with Try again.' },
          { icon: 'brain', title: 'Thinking level', text: 'For models that can think, pick Auto, Off, Low, Medium or High next to the model.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'chat', title: 'A queue that keeps moving', text: 'Queued messages wait on the server and go out one by one when each reply ends: finished, stopped or cut. After an error the queue pauses until you resume or send one. Send now, Clear and Resume are always there.' },
          { icon: 'menu', title: 'Long queues stay small', text: 'Three rows show, the rest scroll with a soft fade; Show all opens the whole list.' },
          { icon: 'stop', title: 'Stop keeps what was written', text: 'Stopping a reply keeps the text so far in the chat, and the next queued message goes out.' },
          { icon: 'refresh', title: 'Compaction you can read', text: 'The summary appears under the divider as it is written, and opening the divider always shows it.' },
          { icon: 'check', title: 'Switching models asks first', text: 'Changing the model of a chat that has begun asks before it switches, since answers may read a little differently.' },
        ],
      },
    ],
  },
  {
    version: '2.1.8',
    title: '@mnemo requests are never dropped',
    lead: 'A request in a note that Mnemo could not answer stays open and is tried again until it goes through.',
    groups: [
      {
        kind: 'better',
        items: [
          { icon: 'refresh', title: 'Tried again, not dropped', text: 'When the AI provider or the network is down, an @mnemo request is no longer struck through with an error: it stays in the note and Mnemo tries again after 1, 3, 10 and 30 minutes, then every hour, in the same chat.' },
          { icon: 'chat', title: 'The right chat at its address', text: 'Opening a chat by its address shows its title at once, never New chat while it loads.' },
          { icon: 'sparkle', title: 'Fresh ideas, smoother', text: 'While Mnemo writes new suggestions the button shimmers and the cards wait as soft placeholders.' },
          { icon: 'bolt', title: "What's new, neater", text: 'The release row starts flush left and only fades on a side with more to see; the arrows show only where you can go.' },
        ],
      },
    ],
  },
  {
    version: '2.1.7',
    title: 'Skills, fleeting chats and chats that follow their note',
    lead: 'Teach Mnemo a skill once and run it with a slash, chat without keeping anything, and find a note\'s chats wherever the note goes.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'bolt', title: 'Skills', text: 'Skills are notes in the Skills folder. Ask Mnemo to make one ("a skill that tidies meeting notes"), then type / in the chat to pick it. Mnemo can change or remove them too.' },
          { icon: 'eye', title: 'Fleeting chats', text: 'The eye in Mnemo\'s header starts a chat that is not kept: it and the pictures sent in it are gone when you leave it, and it stays out of search. Changes to notes stay.' },
          { icon: 'sparkle', title: 'Suggestions that change', text: 'A new chat shows different suggestions each time: some of yours (Your suggestions), some Mnemo wrote from your recent notes (Fresh ideas writes new ones) and some built in. Your skills are one tap away.' },
          { icon: 'image', title: 'Mnemo sees your pictures', text: 'Mnemo can open a picture shown in a note to describe it or read it. A picture that is only a web address it cannot open, and it tells you to send or add it instead.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'note', title: 'One chat per note', text: 'Every @mnemo request in a note goes to that note\'s one chat, which follows the note when it is renamed, moved or sent to the Trash. Asking about a note offers its earlier chats.' },
          { icon: 'enter', title: '@mnemo from Mnemo works', text: 'When Mnemo writes an @mnemo request into a note for you, it is answered like one you wrote.' },
          { icon: 'refresh', title: 'Steadier chats', text: 'Leaving a chat while Mnemo answers no longer shows a network error: it picks the reply up again. Chats get a proper title even when the first try fails, and deleting a chat also deletes the pictures sent in it.' },
          { icon: 'expand', title: 'Room for the chat', text: 'A page open beside the chat folds the chat list away (it comes back when you drag the divider to give the chat more room). If both cannot fit, the page opens full screen.' },
          { icon: 'image', title: 'Pictures fit the note', text: 'Pictures in notes are at most about 60% of the screen tall; tap one for the full size.' },
        ],
      },
    ],
  },
  {
    version: '2.1.6',
    title: 'Pages that grow, chats you can tidy',
    lead: 'Mnemo reworks the page it made instead of starting over, chats can be cleaned up in bulk, and compacting waits until the chat is really full.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'code', title: 'Pages are versions of one file', text: 'Ask Mnemo to tidy or change a page and it rewrites that same file: the card shows v2, v3 and latest, the panel steps between versions, and on a wide screen the new one opens by itself. Pages stay with their chat (listed under In this chat) and Mnemo can reuse one from another chat.' },
          { icon: 'expand', title: 'Drag the divider', text: 'The line between the chat and an open page can be dragged. Each side keeps a sensible minimum, the width is remembered, and a double-click resets it.' },
          { icon: 'trash', title: 'Select, clean up or delete all', text: 'The ⋯ beside New chat picks several chats to delete, cleans up chats older than 7, 30 or 90 days, or deletes them all (pinned ones kept unless you say so).' },
          { icon: 'chat', title: 'Chats know each other', text: 'Mnemo can list your other chats, search them by title or words and read one, so "the chat from yesterday" just works.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'refresh', title: 'Compacting only when full', text: 'A chat is compacted only once it fills the model\'s memory, and while it happens you see it working, with a clock, before the reply goes on.' },
          { icon: 'sun', title: 'Tidier Mnemo foot and pages', text: 'Appearance is one wide button with Activity, Settings and Memora under it. Page cards stand out and fill the reply\'s width. Scrollbars are thin and show only while you scroll.' },
          { icon: 'bolt', title: "What's new, as a carousel", text: 'Releases slide in one row with arrows, newest first, and the buttons at the bottom no longer bump into each other on a phone.' },
        ],
      },
    ],
  },
  {
    version: '2.1.5',
    title: 'Unread that agrees everywhere, and a tidier Mnemo',
    lead: 'What you have read is remembered on the server, the chat list ends in one neat row, and phones stop sending half a message.',
    groups: [
      {
        kind: 'better',
        items: [
          { icon: 'bell', title: 'Unread on every device', text: 'A chat you read on your phone is read on your laptop too. Your own messages and the chat you are looking at never count as news.' },
          { icon: 'sun', title: 'Appearance in one place', text: 'Theme, chat background and text size moved into an Appearance panel (a sheet on phones). The chat list ends in one row: Appearance, Activity, Settings and Memora.' },
          { icon: 'enter', title: 'Enter on phones', text: 'On a touch keyboard Enter starts a new line; the send button sends. With a real keyboard Enter still sends and Shift+Enter is a new line.' },
          { icon: 'chev-down', title: 'Scroll to the bottom', text: 'The button above the message box is a plain way down, with no New messages label.' },
        ],
      },
    ],
  },
  {
    version: '2.1.4',
    title: 'Pages open like files, and news is marked',
    lead: 'A page Mnemo writes is a card in the chat; open it and it sits beside the chat. Chats with news stand out.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'chev-down', title: 'Back to the latest', text: 'Scrolled up? A button above the message box takes you down again, and says New messages when a reply came in meanwhile.' },
          { icon: 'bell', title: 'Unread chats', text: 'The Mnemo item in the sidebar shows how many chats have news; in Mnemo each one is in bold with its number of new messages.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'code', title: 'File cards and a side panel', text: 'Charts and pages show as a card with Open and Download. On a wide screen the page opens beside the chat; on a tablet or phone it fills the screen until you close it. Preview, Code, Copy, Download and Close sit in one clear bar.' },
          { icon: 'refresh', title: 'Compacted, centred', text: 'The divider where a chat was compacted sits in the middle of the chat again.' },
        ],
      },
    ],
  },
  {
    version: '2.1.3',
    title: 'Mnemo answers with pictures',
    lead: 'Ask for a chart, a diagram or a small page and see it live in the chat.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'eye', title: 'Live previews', text: 'When a chart, graph or diagram says it better, Mnemo writes a small HTML or SVG page. Once the reply is done it shows as a preview; switch to Code, copy it, download it or open it full screen. It runs sandboxed, away from your notes.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'refresh', title: 'Calmer compact divider', text: 'Where a chat was compacted the divider just says Compacted, centred; open it to read the summary.' },
        ],
      },
    ],
  },
  {
    version: '2.1.2',
    title: 'Mnemo fits your screen, and errors read plainly',
    lead: 'On a phone Mnemo uses the full width, and you choose how big its text is.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'eye', title: 'Text size', text: 'Auto, Small, Medium or Large, from Appearance in the chat list or Settings, Mnemo. Auto is small on phones so more fits, and medium elsewhere.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'chat', title: 'Full width on phones', text: "Replies drop the avatar beside them and use the whole width, with the same margin on both sides." },
          { icon: 'refresh', title: 'Clear errors', text: 'A provider that is down for a moment is asked again by itself for about half a minute. If it still fails, Mnemo says so in plain words with Try again; the full error is there only if you open it.' },
        ],
      },
    ],
  },
  {
    version: '2.1.1',
    title: 'Mnemo asks first, or just gets on with it',
    lead: 'Pick how much Mnemo may do on its own, answer its questions with a tap, and keep typing while it works.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'help', title: 'It asks instead of guessing', text: 'When a choice is yours, Mnemo shows the options as buttons, plus Other for your own answer.' },
          { icon: 'shield', title: 'Ask first, or Auto', text: 'Ask first: Mnemo looks freely but waits for your OK before changing notes. Auto: it goes ahead and keeps working until the job is done. Switch from the chip next to the model.' },
          { icon: 'chat', title: 'Type while it works', text: 'Messages you send mid-reply wait in a queue you can reorder; they go out one by one. Ctrl+Enter steers the reply that is running instead.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'eye', title: 'Easier to read', text: 'Replies sit on a frosted card, details start closed and keep their header in view, and the chat scrolls without a bar.' },
        ],
      },
    ],
  },
  {
    version: '2.1.0',
    title: 'Meet Mnemo, your notes have a helper now',
    lead: 'Ask in plain words and Mnemo finds, writes, tidies and links your notes for you, with the AI key you already have. And your notes can finally hold pictures.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'mnemo', title: 'Ask Mnemo anything about your notes', text: '“What did I decide about the launch?” “Tag everything from last week.” “Turn this into a checklist.” Mnemo does it and shows each step. It only works inside your notes and never deletes for good.' },
          { icon: 'note', title: 'Write @mnemo: right in a note', text: 'Leave a request on any line, save, and come back to the answer underneath with the request crossed out. Handy for to-dos you would rather hand off.' },
          { icon: 'image', title: 'Show it a picture', text: 'Paste a screenshot or a photo and Mnemo actually sees it: ask what it says, or have it filed beside the right note.' },
          { icon: 'chat', title: 'It remembers the whole chat', text: 'Long conversations get folded into a summary instead of forgotten, replies keep going if you switch chats, and the search box finds anything either of you said.' },
          { icon: 'image', title: 'Images live in your notes', text: 'Drop a PNG, JPEG, WebP or GIF into a note. It sits in the note’s folder and moves, goes to the Trash and comes back with it. Each folder gets a gallery too.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'eye', title: 'Read your way', text: 'Nine reading themes from paper and sepia to night, plus fonts like Literata, Atkinson Hyperlegible and OpenDyslexic, in the size you like.' },
          { icon: 'sparkle', title: 'A chat that feels like yours', text: 'Light or dark right from Mnemo’s sidebar, a dozen quiet backgrounds, and a timeline on the right edge to jump through long chats with your thumb.' },
          { icon: 'check', title: 'No more surprise sign-outs', text: 'Memora keeps you signed in while you are using it; it only times out when you really step away.' },
        ],
      },
      {
        kind: 'admin',
        items: [
          { icon: 'settings', title: 'Bring your own AI', text: 'Settings, Mnemo: add OpenAI, Anthropic or any OpenAI-compatible server, test it, pick a default model and write instructions in your own words. Mnemo is in the terminal app too.' },
        ],
      },
    ],
  },
  {
    version: '2.0.1',
    title: 'A calmer reader',
    lead: 'Notes now read like a clean page, whatever reading settings you pick.',
    groups: [
      {
        kind: 'better',
        items: [
          { icon: 'note', title: 'Cleaner note text', text: 'Clearer headings, even lists, quieter code and tables, and real check boxes for tasks.' },
          { icon: 'menu', title: 'Contents and Details', text: 'The panel beside a note has two tabs. Contents holds the outline, links and mentions.' },
          { icon: 'settings', title: 'Simpler reading settings', text: 'The fonts and colours that look right everywhere stay. A choice that was removed moves to the nearest one.' },
        ],
      },
    ],
  },
  {
    version: '2.0.0',
    title: 'A calmer, clearer Memora',
    lead: 'Every page was redesigned around one quiet look, and the places you use most got new tools: version history, tag patterns, a summary of what your AIs do, and a cleaner way to read.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'refresh', title: 'Version history for every note', text: 'See each version and who made it, compare it with now, and restore it. Restoring adds a new version, so nothing is lost.' },
          { icon: 'tags', title: 'Find notes by a pattern of tags', text: 'Build “session or (memora and plan) not docker” from chips on the Tags page, and see how many notes match before you apply it.' },
          { icon: 'activity', title: 'Activity, summarised', text: 'Numbers, a chart, what your AIs do most and what went wrong, with every action on its own Timeline tab.' },
          { icon: 'note', title: 'A cleaner way to read', text: 'Fold the toolbar away with F. Contents sits beside the note, with its details as a tab.' },
          { icon: 'brain', title: 'Clean view on the maps', text: 'Hide every control on 3D, Graph and Canvas with C, and bring them back the same way.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'trash', title: 'A safer Trash', text: 'Choose where a note goes back. Deleting forever asks you to type DELETE, and also erases the note from its history.' },
          { icon: 'bolt', title: 'Faster', text: 'Data travels compressed, Activity remembers each time range, and the start screen leaves the moment the app is ready.' },
          { icon: 'settings', title: 'Settings you can change', text: 'The server name and how long browsers stay signed in. Switching the notes folder now says what moves with it.' },
          { icon: 'agents', title: 'Your AIs at a glance', text: 'The Live panel leads with what your AIs did last, then who is working.' },
        ],
      },
      {
        kind: 'admin',
        items: [
          { icon: 'shield', title: 'For whoever runs the server', text: 'Deleting a note for good over the API now needs an admin key. The database needs no migration: a 1.3 install updates in place.' },
          { icon: 'book', title: 'A new licence', text: 'From 2.0.0 Memora is under the GNU AGPL v3.0 or later. Forks and hosted copies keep the source open and credit Memora.' },
        ],
      },
    ],
  },
];

const KIND_LABEL: Record<Kind, string> = { new: t('New'), better: t('Better'), admin: t('Good to know') };
const FLAG = '/api/ui/layout/whats-new';

const CSS = `
.modal:has(.wn){width:min(620px,100%);padding:0;overflow:hidden}
.modal:has(.wn) .modal-head{display:none}
.modal:has(.wn) .modal-body{padding:0;display:flex;flex-direction:column;min-height:0;overflow:hidden}
/* One fixed size for every release, so moving between them never makes it jump: the whole
   dialog, the header (title two lines, lead three, clamped) and the footer keep their height;
   only the list inside scrolls. */
.wn{display:flex;flex-direction:column;min-height:0;height:min(700px,86vh,86dvh)}
.wn-hero{position:relative;overflow:hidden;isolation:isolate;flex:none;padding:22px 24px 24px;color:#e6e9ef;background:linear-gradient(160deg,#17202e,#0b0f17 70%)}
.wn-hero::before{content:"";position:absolute;inset:-60% -20% auto auto;width:420px;height:420px;z-index:-1;background:radial-gradient(closest-side,rgba(94,234,212,.20),transparent 70%)}
.wn-top{display:flex;align-items:center;gap:10px;margin-bottom:22px}
.wn-mark{width:30px;height:30px;flex:none}
.wn-word{font-family:${BRAND_FONT};font-weight:700;font-size:23px;line-height:1;letter-spacing:0}
.wn-x{margin-left:auto;display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:9px;background:none;color:#8b98ad;cursor:pointer}
.wn-x:hover{color:#e6e9ef;background:rgba(148,163,184,.12)}
.wn-x .i{width:16px;height:16px}
.wn-ver{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;height:22px;margin-bottom:10px;overflow:hidden;white-space:nowrap;font-size:12px;color:#8b98ad}
.wn-ver b{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#5eead4}
.wn-ver .pre{padding:2px 8px;border-radius:999px;border:1px solid rgba(148,163,184,.28);color:#cbd5e1}
.wn-hero h2{margin:0 0 8px;font-size:24px;font-weight:650;letter-spacing:-.02em;line-height:1.2;height:2.4em;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.wn-hero p{margin:0;max-width:52ch;font-size:14px;line-height:1.6;height:4.8em;color:#a3afc2;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
/* In dark mode the header turns around: a light band on top of the dark dialog, so it stands
   out the way the dark band does in light mode. */
:root:not([data-theme=light]) .wn-hero{color:#0f172a;background:linear-gradient(160deg,#ffffff,#e8eef5 70%)}
:root:not([data-theme=light]) .wn-hero::before{background:radial-gradient(closest-side,rgba(13,148,136,.16),transparent 70%)}
:root:not([data-theme=light]) .wn-hero p{color:#475569}
:root:not([data-theme=light]) .wn-ver,:root:not([data-theme=light]) .wn-vlab{color:#64748b}
:root:not([data-theme=light]) .wn-ver b{color:#0d9488}
:root:not([data-theme=light]) .wn-ver .pre{border-color:rgba(15,23,42,.18);color:#334155}
:root:not([data-theme=light]) .wn-x{color:#64748b}
:root:not([data-theme=light]) .wn-x:hover{color:#0f172a;background:rgba(15,23,42,.07)}
:root:not([data-theme=light]) .ui-sel.wn-sel{border-color:rgba(15,23,42,.18);background:rgba(255,255,255,.7);color:#0f172a}
:root:not([data-theme=light]) .ui-sel.wn-sel:hover:not(:disabled){border-color:rgba(15,23,42,.32);background:#fff}
:root:not([data-theme=light]) .ui-sel.wn-sel .ui-sel-chev{stroke:#475569}
:root:not([data-theme=light]) .ui-sel.wn-sel .ui-sel-v small{color:#0f766e;background:rgba(13,148,136,.12)}
:root:not([data-theme=light]) .wn-hero :focus-visible{outline-color:#0d9488}
/* Releases: a compact dropdown in the top bar, newest first, the latest picked by default. */
.wn-grow{flex:1}
.wn-vlab{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#8b98ad}
.ui-sel.wn-sel{height:32px;width:auto;min-width:0;max-width:none;flex:none;border-radius:999px;padding:0 8px 0 12px;gap:6px;border:1px solid rgba(148,163,184,.34);
  background:rgba(15,23,42,.35);color:#e6e9ef;font:650 13px/1 var(--font);font-variant-numeric:tabular-nums}
.ui-sel.wn-sel:hover:not(:disabled){border-color:rgba(148,163,184,.6);background:rgba(148,163,184,.12)}
.ui-sel.wn-sel .ui-sel-v{flex:none;display:inline-flex;align-items:center;gap:6px}
.ui-sel.wn-sel .ui-sel-chev{stroke:#cbd5e1;width:14px;height:14px}
.ui-sel.wn-sel .ui-sel-v small{padding:2px 6px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  color:#5eead4;background:rgba(94,234,212,.12)}
.wn-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 24px 12px}
.wn-g{padding:14px 0 6px}
.wn-g+.wn-g{border-top:1px solid var(--line)}
.wn-g h3{margin:0 0 6px;font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.wn-it{display:grid;grid-template-columns:20px minmax(0,1fr);gap:2px 14px;padding:10px 0}
.wn-ic{grid-row:span 2;padding-top:2px;color:var(--text-3)}
.wn-g.new .wn-ic{color:#0d9488}
:root:not([data-theme=light]) .wn-g.new .wn-ic{color:#5eead4}
.wn-ic .i{width:18px;height:18px}
.wn-it b{font-size:14px;font-weight:600;color:var(--fg);line-height:1.4}
.wn-it p{margin:0;font-size:13px;line-height:1.55;color:var(--muted)}
/* Footer: quiet links on the left (star with its count, full changelog), Got it on the right;
   on phones Got it takes the whole width under the two links. */
.wn-foot{flex:none;display:flex;align-items:center;gap:12px;padding:12px 16px 12px 18px;border-top:1px solid var(--line);background:var(--surface-1)}
.wn-links{flex:1;min-width:0;display:flex;align-items:center;gap:4px}
.wn-star,.wn-log{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 10px;border:0;border-radius:9px;background:none;
  font:600 13px/1 var(--font);color:var(--text-2,var(--fg));text-decoration:none;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
.wn-star:hover,.wn-log:hover{background:var(--hover);color:var(--fg)}
.wn-star svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round;transition:fill .15s,stroke .15s}
.wn-star:hover svg{fill:#f5c451;stroke:#f5c451}
.wn-log .i{width:15px;height:15px}
.wn-star em{display:inline-grid;place-items:center;min-width:22px;height:20px;padding:0 6px;border-radius:999px;font-style:normal;font-size:11px;font-weight:700;
  font-variant-numeric:tabular-nums;background:color-mix(in srgb,var(--fg) 8%,transparent);color:var(--fg)}
.wn-star em:empty{display:none}
.wn-ok{min-width:112px;height:38px;justify-content:center}
.wn :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:760px){
  .modal:has(.wn){border-radius:var(--r) var(--r) 0 0}
  .modal:has(.wn) .modal-grab{display:none}
  .wn{height:min(88vh,88dvh)}
  .wn-hero{padding:18px 18px 20px}.wn-hero h2{font-size:21px}.wn-hero p{font-size:13.5px}
  .wn-top{margin-bottom:16px}
  .wn-body{padding:4px 18px 10px}
  .wn-foot{flex-direction:column;align-items:stretch;gap:8px;padding:10px 16px calc(12px + var(--safe-b,0px))}
  .wn-links{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .wn-star,.wn-log{justify-content:center;height:40px;border:1px solid var(--line);font-size:13.5px}
  .wn-ok{width:100%;height:46px;font-size:15px}
  .wn-vlab{display:none}
  .ui-sel.wn-sel{height:34px}
}
`;

/** Semver compare; pre-release tags are ignored. */
function cmp(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  return 0;
}

function installed(): string {
  return String(state.health.version || '');
}

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/></svg>';

function body(r: Release): string {
  const now = installed();
  const ahead = !!now && cmp(r.version, now) > 0;
  return `<div class="wn" role="document">
    <header class="wn-hero">
      <div class="wn-top">${markSvg('wn-mark')}<span class="wn-word">Memora</span><span class="wn-grow"></span>${
        RELEASES.length > 1 ? `<span class="wn-vlab" id="wnV">${t('Version')}</span><i class="wn-slot"></i>` : ''
      }
        <button type="button" class="wn-x" data-close aria-label="${t('Close')}">${icon('close')}</button></div>
      <div class="wn-ver"><b>${t("What's new in {version}", { version: esc(r.version) })}</b>${r.date ? `<span>${esc(r.date)}</span>` : ''}${
        ahead ? `<span class="pre">${t('Coming next · you run {version}', { version: esc(now) })}</span>` : ''
      }</div>
      <h2 id="wnT" title="${attr(r.title)}">${esc(r.title)}</h2><p title="${attr(r.lead)}">${esc(r.lead)}</p>
    </header>
    <div class="wn-body">${r.groups
      .map(
        (g) => `<section class="wn-g ${g.kind}"><h3>${KIND_LABEL[g.kind]}</h3>${g.items
          .map((it) => `<div class="wn-it"><span class="wn-ic" aria-hidden="true">${icon(it.icon)}</span><b>${esc(it.title)}</b><p>${esc(it.text)}</p></div>`)
          .join('')}</section>`,
      )
      .join('')}</div>
    <footer class="wn-foot">
      <div class="wn-links">
        <a class="wn-star" data-star href="https://github.com/Codrihub/memora" target="_blank" rel="noopener noreferrer" title="${t('Memora is free and open source. A star helps others find it.')}">${STAR}<span>${t('Star')}</span><em data-stars></em></a>
        <button type="button" class="wn-log" data-log>${icon('book')}<span>${t('Full changelog')}</span></button>
      </div>
      <button type="button" class="btn primary wn-ok" data-close>${t('Got it')}</button>
    </footer>
  </div>`;
}

/** From the server's release check; the browser never calls GitHub. */
async function paintStars(b: HTMLElement): Promise<void> {
  try {
    const c = await api<{ update?: { stars?: number | null; repo?: string } }>('/api/config');
    const n = c?.update?.stars;
    const el = b.querySelector<HTMLElement>('[data-stars]');
    if (el && typeof n === 'number') el.textContent = n.toLocaleString('en-US');
    const a = b.querySelector<HTMLAnchorElement>('[data-star]');
    if (a && c?.update?.repo) a.href = c.update.repo;
  } catch {
    /* link stays without a count */
  }
}

export function openWhatsNew(version?: string): void {
  useStyles('whats-new-css', CSS);
  useStyles('brand-font-face', BRAND_FONT_CSS);
  let r = RELEASES.find((x) => x.version === version) || RELEASES[0];
  if (!r) return;
  const wire = (b: HTMLElement, focus = false): void => {
    b.querySelectorAll<HTMLElement>('[data-close]').forEach((x) => (x.onclick = () => Modal.close()));
    b.querySelector<HTMLElement>('[data-log]')?.addEventListener('click', () => {
      Modal.close();
      openDocs('changelog');
    });
    const show = (next: Release | undefined): void => {
      if (!next || next === r) return;
      r = next;
      b.innerHTML = body(r);
      wire(b, true);
      b.querySelector<HTMLElement>('.wn-body')?.scrollTo({ top: 0 });
    };
    const slot = b.querySelector<HTMLElement>('.wn-slot');
    if (slot) {
      const pick = createSelect({
        className: 'wn-sel',
        label: t('Version'),
        align: 'end',
        minWidth: 280,
        labelledBy: 'wnV',
        options: RELEASES.map((x, i) => ({ value: x.version, label: x.version, hint: (i === 0 ? t('Latest') + ' · ' : '') + x.title })),
        value: r.version,
        render: (o) =>
          `<span class="ui-sel-v">${esc(o?.value || '')}${o?.value === RELEASES[0]?.version ? `<small>${t('Latest')}</small>` : ''}</span><svg class="ui-sel-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`,
        onChange: (v) => show(RELEASES.find((y) => y.version === v)),
      });
      slot.replaceWith(pick.el);
      if (focus) pick.el.focus({ preventScroll: true });
    }
    void paintStars(b);
  };
  Modal.open({ title: t("What's new"), body: body(r), onOpen: (b: HTMLElement) => wire(b) });
  markSeen(r.version);
}

function markSeen(version: string): void {
  void api(FLAG, { method: 'PUT', body: { data: { seen: version } } }).catch(() => {});
}

/** A first sign-in (welcome tour open) marks the release seen instead of opening. */
export async function maybeWhatsNew(): Promise<void> {
  const now = installed();
  const due = RELEASES.find((x) => now && cmp(x.version, now) <= 0);
  if (!due) return;
  try {
    const r = await api<{ data?: { seen?: string } | null }>(FLAG);
    const seen = r?.data?.seen || '';
    if (seen && cmp(seen, due.version) >= 0) return;
    if (document.querySelector('.wl-tour')) return markSeen(due.version);
    openWhatsNew(due.version);
  } catch {
    /* No answer: skip rather than open on every load. */
  }
}
