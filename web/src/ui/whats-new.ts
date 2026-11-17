import { api } from '../api';
import { attr, esc, useStyles } from '../dom';
import { state } from '../state';
import { Modal } from '../modal';
import { openDocs } from '../router';
import { markSvg } from '../brand';
import { BRAND_FONT, BRAND_FONT_CSS } from '../brand-font';
import { icon } from './icons';

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

const KIND_LABEL: Record<Kind, string> = { new: 'New', better: 'Better', admin: 'Good to know' };
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
/* Releases: one row that slides, newest on the left, with arrows either side. */
.wn-car{display:flex;align-items:center;gap:6px;margin-top:18px}
.wn-arr{flex:none;display:grid;place-items:center;width:34px;height:34px;padding:0;border-radius:999px;border:1px solid rgba(148,163,184,.3);background:rgba(15,23,42,.35);color:#e6e9ef;cursor:pointer;
  transition:background .15s,border-color .15s,opacity .15s}
.wn-arr:hover:not(:disabled){background:rgba(148,163,184,.18);border-color:rgba(148,163,184,.5)}
.wn-arr:disabled{display:none}
.wn-arr svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
/* The row fades only on a side that has more to scroll to. */
.wn-vers{flex:1;min-width:0;display:flex;gap:8px;overflow-x:auto;scroll-behavior:smooth;scroll-snap-type:x proximity;scrollbar-width:none;padding:2px;
  --fl:0px;--fr:0px;-webkit-mask-image:linear-gradient(90deg,transparent,#000 var(--fl),#000 calc(100% - var(--fr)),transparent);
  mask-image:linear-gradient(90deg,transparent,#000 var(--fl),#000 calc(100% - var(--fr)),transparent)}
.wn-vers.more-l{--fl:24px}
.wn-vers.more-r{--fr:24px}
.wn-vers:not(.more-l){-webkit-mask-image:linear-gradient(90deg,#000,#000 calc(100% - var(--fr)),transparent);mask-image:linear-gradient(90deg,#000,#000 calc(100% - var(--fr)),transparent)}
.wn-vers:not(.more-l):not(.more-r){-webkit-mask-image:none;mask-image:none}
.wn-vers::-webkit-scrollbar{display:none}
.wn-vers button{flex:none;scroll-snap-align:center;height:34px;padding:0 15px;border-radius:999px;border:1.5px solid rgba(148,163,184,.34);background:rgba(15,23,42,.3);color:#e2e8f0;
  font:700 13px/1 var(--font);letter-spacing:.01em;font-variant-numeric:tabular-nums;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.wn-vers button:hover{border-color:rgba(148,163,184,.6)}
.wn-vers button[aria-pressed=true]{background:#e6e9ef;border-color:#e6e9ef;color:#0b0f17}
.wn-vers button.latest:not([aria-pressed=true]){border-color:rgba(94,234,212,.55);color:#5eead4}
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
/* Footer: the GitHub star (with its count) on the left as a quiet pill, Changelog and Got it
   on the right; on phones the two buttons share a row and the star sits under them. */
.wn-foot{flex:none;display:flex;align-items:center;gap:10px;padding:12px 16px 12px 20px;border-top:1px solid var(--line);background:var(--surface-1)}
.wn-star{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 6px 0 11px;border:1px solid var(--line);border-radius:999px;
  font-size:12.5px;font-weight:600;color:var(--text-2,var(--fg));text-decoration:none;transition:border-color .15s,background .15s,color .15s}
.wn-star svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round;transition:fill .15s,stroke .15s}
.wn-star:hover{color:var(--fg);border-color:color-mix(in srgb,#f5c451 60%,var(--line));background:color-mix(in srgb,#f5c451 8%,transparent)}
.wn-star:hover svg{fill:#f5c451;stroke:#f5c451}
.wn-star em{display:inline-grid;place-items:center;min-width:24px;height:22px;padding:0 7px;border-radius:999px;font-style:normal;font-size:11.5px;font-weight:700;
  font-variant-numeric:tabular-nums;background:color-mix(in srgb,var(--fg) 8%,transparent);color:var(--fg)}
.wn-star em:empty{display:none}
.wn-foot .grow{flex:1}
.wn-log{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:1px solid var(--line);border-radius:10px;background:none;
  font:600 13px/1 var(--font);color:var(--text-2);cursor:pointer;transition:border-color .15s,color .15s}
.wn-log:hover{color:var(--fg);border-color:var(--line-strong)}
.wn :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:760px){
  .modal:has(.wn){border-radius:var(--r) var(--r) 0 0}
  .modal:has(.wn) .modal-grab{display:none}
  .wn{height:min(88vh,88dvh)}
  .wn-hero{padding:18px 18px 20px}.wn-hero h2{font-size:21px}.wn-hero p{font-size:13.5px}
  .wn-top{margin-bottom:16px}
  .wn-body{padding:4px 18px 10px}
  .wn-foot{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 16px calc(12px + var(--safe-b,0px))}
  .wn-foot .grow{display:none}
  .wn-log{height:44px;font-size:14px;color:var(--fg)}
  .wn-foot .btn.primary{height:44px;width:100%;justify-content:center;font-size:14px}
  .wn-star{grid-column:1/-1;order:3;justify-self:center;height:32px}
  .wn-car{margin-top:16px}
  .wn-arr{width:32px;height:32px}
  .wn-vers button{height:32px;padding:0 13px}
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

const ARROW_L = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>';
const ARROW_R = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/></svg>';

function body(r: Release): string {
  const now = installed();
  const ahead = !!now && cmp(r.version, now) > 0;
  const at = RELEASES.findIndex((x) => x.version === r.version);
  return `<div class="wn" role="document">
    <header class="wn-hero">
      <div class="wn-top">${markSvg('wn-mark')}<span class="wn-word">Memora</span>
        <button type="button" class="wn-x" data-close aria-label="Close">${icon('close')}</button></div>
      <div class="wn-ver"><b>What's new in ${esc(r.version)}</b>${r.date ? `<span>${esc(r.date)}</span>` : ''}${
        ahead ? `<span class="pre">Coming next · you run ${esc(now)}</span>` : ''
      }</div>
      <h2 id="wnT" title="${attr(r.title)}">${esc(r.title)}</h2><p title="${attr(r.lead)}">${esc(r.lead)}</p>
      ${
        RELEASES.length > 1
          ? `<div class="wn-car">
          <button type="button" class="wn-arr" data-step="-1" aria-label="Newer release" title="Newer"${at <= 0 ? ' disabled' : ''}>${ARROW_L}</button>
          <div class="wn-vers" role="group" aria-label="Release, newest first">${RELEASES.map(
              (x, i) =>
                `<button type="button" data-ver="${esc(x.version)}"${i === 0 ? ' class="latest" title="Latest"' : ''} aria-pressed="${x.version === r.version}">${esc(x.version)}</button>`,
            ).join('')}</div>
          <button type="button" class="wn-arr" data-step="1" aria-label="Older release" title="Older"${at >= RELEASES.length - 1 ? ' disabled' : ''}>${ARROW_R}</button>
        </div>`
          : ''
      }
    </header>
    <div class="wn-body">${r.groups
      .map(
        (g) => `<section class="wn-g ${g.kind}"><h3>${KIND_LABEL[g.kind]}</h3>${g.items
          .map((it) => `<div class="wn-it"><span class="wn-ic" aria-hidden="true">${icon(it.icon)}</span><b>${esc(it.title)}</b><p>${esc(it.text)}</p></div>`)
          .join('')}</section>`,
      )
      .join('')}</div>
    <footer class="wn-foot">
      <a class="wn-star" data-star href="https://github.com/Codrihub/memora" target="_blank" rel="noopener noreferrer" title="Memora is free and open source. A star helps others find it.">${STAR}<span>Star on GitHub</span><em data-stars></em></a>
      <span class="grow"></span>
      <button type="button" class="wn-log" data-log>Changelog</button>
      <button type="button" class="btn primary" data-close>Got it</button>
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
  const wire = (b: HTMLElement, scrollFrom = -1): void => {
    b.querySelectorAll<HTMLElement>('[data-close]').forEach((x) => (x.onclick = () => Modal.close()));
    b.querySelector<HTMLElement>('[data-log]')?.addEventListener('click', () => {
      Modal.close();
      openDocs('changelog');
    });
    const show = (next: Release | undefined, keep: number): void => {
      if (!next || next === r) return;
      r = next;
      b.innerHTML = body(r);
      wire(b, keep);
      b.querySelector<HTMLElement>('.wn-body')?.scrollTo({ top: 0 });
    };
    b.querySelectorAll<HTMLElement>('[data-ver]').forEach((x) => {
      x.onclick = () => show(RELEASES.find((y) => y.version === x.dataset.ver), track()?.scrollLeft ?? 0);
    });
    b.querySelectorAll<HTMLElement>('[data-step]').forEach((x) => {
      x.onclick = () => show(RELEASES[RELEASES.indexOf(r) + Number(x.dataset.step)], track()?.scrollLeft ?? 0);
    });
    // Keep the row where it was, then slide the chosen release into view.
    const track = (): HTMLElement | null => b.querySelector<HTMLElement>('.wn-vers');
    const t = track();
    const edges = (): void => {
      if (!t) return;
      t.classList.toggle('more-l', t.scrollLeft > 2);
      t.classList.toggle('more-r', t.scrollLeft + t.clientWidth < t.scrollWidth - 2);
    };
    t?.addEventListener('scroll', edges, { passive: true });
    requestAnimationFrame(edges);
    const on = t?.querySelector<HTMLElement>('[aria-pressed=true]');
    if (t && on) {
      t.style.scrollBehavior = 'auto';
      t.scrollLeft = scrollFrom;
      t.style.scrollBehavior = '';
      const want = on.offsetLeft - (t.clientWidth - on.offsetWidth) / 2;
      requestAnimationFrame(() => {
        t.scrollTo({ left: Math.max(0, want), behavior: scrollFrom < 0 ? 'auto' : 'smooth' });
        edges();
      });
    }
    b.querySelector<HTMLElement>('.wn')?.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.target as HTMLElement).closest('.wn-car')) {
        e.preventDefault();
        const step = e.key === 'ArrowLeft' ? -1 : 1;
        const next = RELEASES[RELEASES.indexOf(r) + step];
        if (next) {
          show(next, track()?.scrollLeft ?? 0);
          b.querySelector<HTMLElement>(`[data-ver="${next.version}"]`)?.focus({ preventScroll: true });
        }
      }
    });
    void paintStars(b);
  };
  Modal.open({ title: "What's new", body: body(r), onOpen: wire });
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
