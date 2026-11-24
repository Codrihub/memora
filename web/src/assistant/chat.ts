// One Mnemo chat: the transcript (bubbles, tool cards), the composer, the model picker and
// the context meter. The page and the floating panel both use it.

import { attr, el, esc, useStyles } from '../dom';
import { relTs } from '../format';
import { hooks } from '../hooks';
import { notify, toast } from '../toast';
import { icon } from '../ui/icons';
import { createSelect, type Select, type SelectOption } from '../ui/select';
import { requestSettingsSection } from '../version';
import { openDocs } from '../router';
import { Modal } from '../modal';
import { allNotes, isBoard, noteTitle } from '../state';
import { excerptOf, onExcerpt, wantExcerpt } from '../vault/excerpts';
import { pickFolderDialog } from '../vault/folder-picker';
import { pickerFolders } from '../vault/store';
import { VAULT_CSS } from '../vault/styles';
import { openMenu } from '../vault/ui';
import { nav } from '../vault/nav';
import { openLightbox } from '../ui/lightbox';
import * as A from './api';
import { renderReply, resolveNote } from './md';
import { boardCardHTML, boardPaths, boardsHTML, markNoteBoards, wireBoards } from './boards';
import { closePreview, mountArt } from './art';
import { markSeen } from './unread';
import { MNEMO_CSS, markHTML } from './styles';
import { applyTextSize } from './textsize';
import { t, tn } from '../i18n';
import { ts } from '../i18n/server';

// The chosen text size (per device) applies to every Mnemo chat.
applyTextSize();

/** Friendly words for each tool, and whether it changes notes. */
const TOOL_WORDS: Record<string, [string, boolean]> = {
  search_memory: ['Searched notes', false],
  list_chats: ['Looked through chats', false],
  view_image: ['Looked at a picture', false],
  search_chats: ['Searched earlier chats', false],
  read_chat: ['Read an earlier chat', false],
  list_artifacts: ['Looked through pages', false],
  read_artifact: ['Opened a page', false],
  read_memory: ['Read a note', false],
  list_memory: ['Listed notes', false],
  get_stats: ['Checked the vault', false],
  query_memory: ['Queried notes', false],
  find_similar: ['Found similar notes', false],
  suggest_links: ['Suggested links', false],
  list_tags: ['Listed tags', false],
  get_tags: ['Read tags', false],
  search_by_tag: ['Searched a tag', false],
  list_folders: ['Listed folders', false],
  folder_stats: ['Counted a folder', false],
  get_folder_meta: ['Read folder details', false],
  get_neighbors: ['Looked at links', false],
  get_subgraph: ['Mapped links', false],
  find_path: ['Traced a path', false],
  get_hubs: ['Found hub notes', false],
  get_isolated: ['Found unlinked notes', false],
  link_stats: ['Counted links', false],
  broken_links: ['Checked for broken links', false],
  get_history: ['Read the history', false],
  get_note_at: ['Read an old version', false],
  diff: ['Compared versions', false],
  list_trash: ['Looked in the Trash', false],
  get_todos: ['Gathered to-dos', false],
  follow_ups: ['Found follow-ups', false],
  validate_memory: ['Checked a note', false],
  list_pins: ['Listed pins', false],
  list_images: ['Listed images', false],
  kanban_list_boards: ['Looked at boards', false],
  kanban_get_board: ['Read a board', false],
  kanban_add_card: ['Added a card', true],
  kanban_move_card: ['Moved a card', true],
  kanban_update_card: ['Changed a card', true],
  kanban_card: ['Changed a card', true],
  kanban_lane: ['Changed lanes', true],
  kanban_board: ['Changed a board', true],
  kanban_embed: ['Put a board in a note', true],
  stale_detection: ['Found stale notes', false],
  digest: ['Made a digest', false],
  create_memory: ['Created a note', true],
  save_memory: ['Saved a note', true],
  patch_memory: ['Edited a note', true],
  move_memory: ['Moved a note', true],
  rename_memory: ['Renamed a note', true],
  add_tags: ['Added tags', true],
  remove_tags: ['Removed tags', true],
  set_tags: ['Set tags', true],
  rename_tag: ['Renamed a tag', true],
  merge_tag: ['Merged tags', true],
  create_folder: ['Made a folder', true],
  rename_folder: ['Renamed a folder', true],
  move_folder: ['Moved a folder', true],
  set_folder_meta: ['Updated a folder', true],
  restore_memory: ['Restored a version', true],
  soft_delete: ['Moved to the Trash', true],
  restore_trash: ['Restored from the Trash', true],
  batch_create: ['Created notes', true],
  duplicate_memory: ['Duplicated a note', true],
  merge_memory: ['Merged notes', true],
  template_create: ['Created from a template', true],
  pin: ['Pinned', true],
  unpin: ['Unpinned', true],
  delegate: ['Asked a sub-agent', false],
  agents: ['Managed sub-agents', false],
  describe_image: ['Looked at an image', false],
  generate_image: ['Made an image', false],
};

/** Tools whose result is drawn in the card (an answer, a text, a picture), not as raw JSON. */
const RICH = new Set(['describe_image', 'generate_image']);
/** A task handed to a sub-agent: drawn as a small live panel in the reply, not a step. */
const DELEGATE = 'delegate';
/** Mnemo managing its sub-agents (list, edit, message, wait, stop, done, remove). */
const AGENTS = 'agents';
/** Mnemo's plan: a checklist above the message box, not a step. */
const PLAN = 'update_plan';
/** Tools that change what Mnemo knows about the owner: a quiet line in the reply, not a step. */
const OWNER_MEMORY = new Set(['remember_owner', 'update_owner_memory', 'forget_owner_memory']);

function argStr(args: unknown, key: string): string {
  const v = args && typeof args === 'object' ? (args as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' ? v : '';
}

/** A tool card's title and the line under it. */
/** Who an agents call is about: one name or id, several, or every one. */
function agentsWho(args: unknown): string {
  const list = ((args as { agents?: unknown })?.agents as unknown[] | undefined)?.filter((x): x is string => typeof x === 'string') || [];
  if (list.some((x) => ['all', '*', 'every', 'everyone'].includes(x.trim().toLowerCase()))) return t('every sub-agent');
  if (list.length > 1) return t('{n} sub-agents', { n: list.length });
  return list[0] || argStr(args, 'id') || argStr(args, 'agent') || t('Sub-agent');
}

function toolTitle(name: string, args: unknown): [string, string] {
  if (name === 'agents') {
    const who = agentsWho(args);
    switch (argStr(args, 'action')) {
      case 'list':
        return [t('Listed sub-agents'), ''];
      case 'create':
        return [t('Set up {agent}', { agent: who }), argStr(args, 'instructions')];
      case 'edit':
        return [t('Changed {agent}', { agent: who }), argStr(args, 'rename') || argStr(args, 'model')];
      case 'message':
        return [t('Messaged {agent}', { agent: who }), argStr(args, 'text')];
      case 'wait':
        return [t('Waited for sub-agents'), ''];
      case 'stop':
        return [t('Stopped {agent}', { agent: who }), ''];
      case 'done':
        return [t('Marked {agent} done', { agent: who }), ''];
      case 'remove':
        return [t('Removed {agent}', { agent: who }), ''];
    }
  }
  if (name === 'delegate') return [argStr(args, 'agent') ? t('Asked {agent}', { agent: argStr(args, 'agent') }) : toolWords(name), argStr(args, 'task')];
  if (name === 'generate_image') return [toolWords(name), argStr(args, 'prompt')];
  if (name === 'describe_image') return [toolWords(name), argStr(args, 'question') || subject(args)];
  return [toolWords(name), subject(args)];
}

function ownerMemoryText(name: string, args: unknown): string {
  if (name === 'remember_owner') return argStr(args, 'text') ? t('Noted about you: {text}', { text: argStr(args, 'text') }) : t('Noted something about you');
  if (name === 'update_owner_memory') return t('Updated what I know about you');
  return t('Forgot something about you');
}

function parseOut(output: unknown): Record<string, unknown> | null {
  if (output && typeof output === 'object') return output as Record<string, unknown>;
  if (typeof output !== 'string') return null;
  try {
    const v = JSON.parse(output) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A reply as plain words for reading aloud: Markdown marks, code and links dropped. */
function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*)(\|([^\]]*))?\]\]/g, (_m, a: string, _b, c: string) => c || a)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/(\*\*|__|\*|_|~~)(\S[^\n]*?)\1/g, '$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, 4000);
}

/** The one reply being read aloud (one at a time, in every chat). */
let playing: { btn: HTMLElement; audio: HTMLAudioElement; ctrl: AbortController; url: string } | null = null;

function paintListen(btn: HTMLElement, on: boolean): void {
  btn.classList.toggle('on', on);
  btn.innerHTML = icon(on ? 'stop' : 'volume');
  btn.title = on ? t('Stop reading') : t('Listen');
  btn.setAttribute('aria-label', on ? t('Stop reading') : t('Listen to the reply'));
}

function stopListening(): void {
  const p = playing;
  playing = null;
  if (!p) return;
  p.ctrl.abort();
  p.audio.pause();
  p.audio.removeAttribute('src');
  if (p.url) URL.revokeObjectURL(p.url);
  paintListen(p.btn, false);
}

async function listen(btn: HTMLElement): Promise<void> {
  if (playing?.btn === btn) return stopListening();
  stopListening();
  const text = speakable(btn.closest<HTMLElement>('.mn-foot')?.dataset.raw || '');
  if (!text) return;
  const me = { btn, audio: new Audio(), ctrl: new AbortController(), url: '' };
  playing = me;
  paintListen(btn, true);
  try {
    const blob = await A.speak(text, me.ctrl.signal);
    if (playing !== me) return;
    me.url = URL.createObjectURL(blob);
    me.audio.src = me.url;
    me.audio.onended = () => playing === me && stopListening();
    me.audio.onerror = () => playing === me && stopListening();
    await me.audio.play();
  } catch (e) {
    if (playing !== me) return;
    stopListening();
    if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'err');
  }
}

/** Recording can run in this browser at all. */
const canRecord = (): boolean => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

function toolWords(name: string): string {
  const w = TOOL_WORDS[name]?.[0];
  return w ? t(w) : name.replace(/_/g, ' ');
}

function changesNotes(name: string): boolean {
  return TOOL_WORDS[name]?.[1] ?? false;
}

/** The one argument worth showing on a tool card. */
function subject(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  if (typeof a.query === 'string') return `“${a.query}”`;
  for (const k of ['path', 'folder', 'tag', 'old', 'name', 'from', 'title', 'note']) {
    const v = a[k];
    if (typeof v === 'string' && v) return v.replace(/\.md$/i, '');
  }
  if (Array.isArray(a.paths)) return tn(a.paths.length, '{n} note', '{n} notes');
  return '';
}

function pretty(v: unknown, max = 2400): string {
  let s: string;
  if (typeof v === 'string') {
    try {
      s = JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      s = v;
    }
  } else s = JSON.stringify(v ?? {}, null, 2);
  return s.length > max ? s.slice(0, max) + '\n…' : s;
}

/** Built-in suggestions on a new chat; four are picked at random each time. */
const SUGGEST: Record<'global' | 'note' | 'folder', string[]> = {
  global: [
    'What did I write about this week?',
    'Find notes with no links and suggest where they belong',
    'Look for tags that mean the same thing',
    'List my open to-dos by project',
    'Which notes have I not touched in months but still matter?',
    'Summarise what changed in my vault today',
    'Find notes that say almost the same thing',
    'Make an index note for my biggest folder',
    'Which ideas keep coming back in my notes?',
    'Show broken links and how to fix them',
    'Draw a chart of how many notes I write each week',
    'Plan my week from my open to-dos',
  ],
  note: [
    'Summarise this note in five bullets',
    'Suggest links to related notes',
    'Fix typos and tidy the formatting',
    'Turn this note into a checklist',
    'What is missing from this note?',
    'Suggest tags for this note',
    'Draw this note as a diagram',
    'Write three questions this note leaves open',
  ],
  folder: [
    'What is in this folder?',
    'Find near-duplicate notes here',
    'Write an index note for this folder',
    'Which notes here look out of date?',
    'Suggest sub folders for these notes',
    'Which notes here have no links?',
  ],
};

let sugCache: A.Suggestions | null = null;
let skillCache: { at: number; list: A.Skill[] } | null = null;

function shuffled<T>(a: T[]): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

async function skillsList(): Promise<A.Skill[]> {
  if (skillCache && Date.now() - skillCache.at < 30_000) return skillCache.list;
  try {
    skillCache = { at: Date.now(), list: (await A.listSkills()).skills };
  } catch {
    skillCache = { at: Date.now(), list: skillCache?.list || [] };
  }
  return skillCache.list;
}

/** Per Activity block: what the turn did. */
interface ActStats {
  steps: number;
  ms: number;
  failed: number;
  read: Set<string>;
  changed: Set<string>;
  thought: boolean;
}
const ACTS = new WeakMap<HTMLElement, ActStats>();

/** Note paths a tool call names (`path`, `paths`, `from`, `to`...). */
function touchedPaths(args: unknown): string[] {
  if (!args || typeof args !== 'object') return [];
  const a = args as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ['path', 'from', 'source', 'target', 'into_path', 'note', 'board']) {
    const v = a[k];
    if (typeof v === 'string' && /\.md$/i.test(v)) out.push(v);
  }
  for (const k of ['paths', 'sources']) {
    const v = a[k];
    if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && /\.md$/i.test(x)) out.push(x);
  }
  if (typeof a.path === 'string' && !/\.md$/i.test(a.path) && typeof a.title !== 'string' && !('folder' in a)) {
    // read_memory and friends accept a path without .md.
    out.push(a.path + '.md');
  }
  return out;
}

export interface ChatOptions {
  compact?: boolean;
  /** Scope for a chat started here, read when the first message is sent. */
  scope: () => string;
  /** A fleeting chat was left and deleted. */
  onForget?: (id: string) => void;
  /** A chat was created, renamed, pinned or got a reply. */
  onChange?: (s: A.Session) => void;
  /** A reply started or ended. */
  onBusy?: (on: boolean) => void;
  /** The owner started a new chat from inside the chat (the memory panel). */
  onNew?: () => void;
  /** The stored chat changed (opened, a reply finished, a new chat): the artifacts panel follows. */
  onMessages?: () => void;
  /** The chat's sub-agents changed (one started, finished, or the chat changed). */
  onAgents?: () => void;
  /** Show the Agents panel (the page's side panel or sheet); without it a dialog opens. */
  openAgents?: () => void;
  /** Whether the Agents panel is open now, and closing it (the live line toggles it). */
  agentsOpen?: () => boolean;
  closeAgents?: () => void;
}

/** Thinking levels, for models that can think. */
const THINK_LEVELS: { v: A.ThinkLevel; label: string; hint: string }[] = [
  { v: 'auto', label: t('Auto'), hint: t('The model decides how much to think') },
  { v: 'off', label: t('Off'), hint: t('Answer straight away') },
  { v: 'low', label: t('Low'), hint: t('A little thinking, quick') },
  { v: 'medium', label: t('Medium'), hint: t('Balanced') },
  { v: 'high', label: t('High'), hint: t('Think it through, slower') },
];

/** Permission modes: what Mnemo may do without asking (one setting for every chat). */
type PermMode = 'ask' | 'auto' | 'read';
const PERM_MODES: { v: PermMode; label: string; hint: string; icon: string; toast: string }[] = [
  { v: 'ask', label: t('Ask first'), hint: t('Asks before it changes notes or runs sub-agents'), icon: 'shield', toast: t('Ask first: {mnemo} asks before it changes notes or runs sub-agents', { mnemo: A.MNEMO }) },
  { v: 'auto', label: t('Auto'), hint: t('Changes and sub-agents go ahead without asking'), icon: 'bolt', toast: t('Auto: {mnemo} makes changes and runs sub-agents without asking', { mnemo: A.MNEMO }) },
  { v: 'read', label: t('Read only'), hint: t('Only reads and answers; never changes notes'), icon: 'eye', toast: t('Read only: {mnemo} reads and answers, and never changes your notes', { mnemo: A.MNEMO }) },
];
const permMode = (p: string | null | undefined): PermMode => (p === 'auto' || p === 'read' ? p : 'ask');

export class ChatView {
  readonly el: HTMLElement;
  private downBtn!: HTMLButtonElement;
  /** A pending re-check of the scroll-to-bottom button (one per frame). */
  private downFrame = 0;
  private cur: A.Session | null = null;
  /** The open chat; the element carries its id so the unread count knows it is on screen. */
  get session(): A.Session | null {
    return this.cur;
  }
  set session(v: A.Session | null) {
    this.cur = v;
    if (!this.el) return;
    if (v) this.el.dataset.sid = v.id;
    else delete this.el.dataset.sid;
    if (v && !document.hidden && this.el.getClientRects().length) markSeen(v.id, v.messages);
  }
  private messages: A.Message[] = [];
  /** Messages typed while Mnemo works, kept on the server (every device sees the same
   *  queue): sent one by one as each reply ends, whether it finished, was stopped or cut. */
  private queue: A.Queued[] = [];
  /** The queue is paused after a failed reply (Try again comes first). */
  private qHeld = false;
  /** The whole queue is shown (otherwise three rows, the rest by scrolling). */
  private qAll = false;
  /** Following this chat for other devices' messages, replies and queue changes. */
  private watchCtrl: AbortController | null = null;
  private watchSid = '';
  /** The owner sent a message now: the reply running ends as "cut", not "stopped". */
  /** A reply was asked to stop: the button waits for it to end. */
  private stopping = false;
  /** The question an "Other" answer goes to (set by tapping Other). */
  /** Bumped by every reply watched and every detach, so a left reply cannot touch this view. */
  private run = 0;
  /** The model chosen for this chat ('' = the default). */
  private model = '';
  private busy = false;
  private ctrl: AbortController | null = null;
  private log: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private plusEl: HTMLElement;
  private mic: HTMLButtonElement;
  /** Speech being recorded for the message (the mic button). */
  private rec: { r: MediaRecorder; stream: MediaStream; t0: number; tick: number } | null = null;
  private attEl: HTMLElement;
  /** Notes and folders attached to the next message. */
  private attach: A.Attach[] = [];
  /** The composer is a one-line capsule until it is focused (or holds something). */
  private focused = false;
  /** A fleeting chat: not kept; deleted (with its images) when the owner leaves it. */
  private fleetingOn = false;
  /** The slash menu of skills while a /name is being typed. */
  private slash: { box: HTMLElement; list: A.Skill[]; at: number } | null = null;
  private offOutside: () => void = () => {};
  private meter: HTMLElement;
  private pinBtn: HTMLButtonElement;
  private rail: HTMLElement;
  private railFrame = 0;
  /** The chat's memory for its model, from the server (null before the first answer). */
  private ctx: A.ChatContext | null = null;
  private modelSlot: HTMLElement;
  private select: Select | null = null;
  /** The permission picker in the composer: Ask first, Auto or Read only. */
  private permSel: Select | null = null;
  /** Every sub-agent of this chat, by what it is doing now (the Agents panel's content). */
  readonly agents: AgentsPanel;
  private offState: () => void;
  /** The one-line live status above the composer, shown only while a reply runs. */
  private liveEl!: HTMLButtonElement;
  /** The context meter, so the page can show it in its header on wide screens. */
  get meterEl(): HTMLElement {
    return this.meter;
  }
  /** Where the page puts its Fleeting button (right of the row under the header). */
  get topRightEl(): HTMLElement {
    return this.el.querySelector<HTMLElement>('.mn-top-r')!;
  }
  /** Where the page puts its Agents button (with the meter and Think, beside send). */
  get agentsSlotEl(): HTMLElement {
    return this.el.querySelector<HTMLElement>('.mn-ag-slot')!;
  }
  /** The checklist above the composer: Mnemo's plan, or the reply's sub-agents. */
  private planEl!: HTMLElement;
  /** The tray on top of the message box: the live line, the plan and the queue, together. */
  private trayEl!: HTMLElement;
  /** Bumped on each plan change, so a late clean-up never wipes a newer plan. */
  private planGen = 0;
  /** The chat was at its end before the last resize (it stays there while the tray moves). */
  private stuck = true;
  /** The plan came from Mnemo (update_plan), so sub-agents do not replace it. */
  private planOwn = false;
  /** The chat's plan as the server keeps it: it belongs to the chat, not to a reply, so a
   *  stopped reply leaves it as it was. */
  private sessionPlan: PlanStep[] = [];
  /** The chat's sub-agents as the server keeps them (done, removed, instructions). */
  private agentsInfo: A.AgentsInfo | undefined;

  constructor(private o: ChatOptions) {
    useStyles('mnemo-css', MNEMO_CSS);
    this.el = el('div', 'mn-chat' + (o.compact ? ' compact' : ''));
    this.el.innerHTML = `
      <div class="mn-top"><div class="mn-top-l"><button type="button" class="mn-pin" hidden>${icon('pin')}</button><span class="mn-model-slot"></span></div><div class="mn-top-r"></div></div>
      <div class="mn-log" role="log" aria-live="polite" aria-label="${t('Conversation with {mnemo}', { mnemo: A.MNEMO })}"></div>
      <nav class="mn-rail" aria-label="${t('Jump to a message')}" hidden></nav>
      <form class="mn-comp" autocomplete="off">
        <button type="button" class="mn-down" aria-label="${t('Scroll to the bottom')}" title="${t('Scroll to the bottom')}" tabindex="-1"><span>${t('Scroll to')}</span>${icon('arrow-down')}</button>
        <div class="mn-tray mn-col"><div class="mn-col-in"><div class="mn-tray-box">
          <div class="mn-col mn-tray-hc"><div class="mn-col-in"><div class="mn-tray-h">
            <button type="button" class="mn-live" hidden aria-live="polite"><i aria-hidden="true"></i><span class="mn-live-t"></span><span class="mn-live-s"></span>${icon('chev-right')}</button>
            <b class="mn-plan-ttl"></b>
            <button type="button" class="mn-plan-h" aria-expanded="true"><span class="mn-plan-n"></span><i class="mn-plan-bar" aria-hidden="true"><i></i></i>${icon('chev-down', 'i mn-plan-chev')}</button>
            <button type="button" class="mn-plan-x" aria-label="${t('Clear the plan')}" title="${t('Clear the plan')}">${icon('close')}</button>
          </div></div></div>
          <div class="mn-col mn-plan-c"><div class="mn-col-in"><div class="mn-plan" role="list" aria-label="${t('Plan')}"></div></div></div>
          <div class="mn-col mn-queue-c"><div class="mn-col-in"><div class="mn-queue"></div></div></div>
        </div></div></div>
        <div class="mn-comp-box">
          <div class="mn-att" aria-live="polite"><div class="mn-att-in"></div></div>
          <textarea rows="1" maxlength="40000" placeholder="${t('Ask {mnemo} about your notes…', { mnemo: A.MNEMO })}" aria-label="${t('Message to {mnemo}', { mnemo: A.MNEMO })}"></textarea>
          <div class="mn-comp-bar">
            <button type="button" class="mn-plus" aria-label="${t('Attach notes or folders from your vault')}" title="${t('Attach notes or folders from your vault')}">${icon('plus')}</button>
            <button type="button" class="mn-mic" hidden aria-label="${t('Speak a message')}" title="${t('Speak a message')}">${icon('mic')}<i class="mn-mic-dot" aria-hidden="true"></i><span class="mn-mic-t"></span></button>
            <span class="mn-perm-slot" hidden></span>
            <span class="mn-grow"></span>
            <button type="submit" class="mn-send" aria-label="${t('Send')}">${icon('send')}</button>
          </div>
        </div>
        <div class="mn-under">
          <p class="mn-fine">${t('{mnemo} only works in your notes. Each change shows in Activity and can be undone from History.', { mnemo: A.MNEMO })}</p>
          <span class="mn-grow"></span>
          <span class="mn-under-r"><span class="mn-ag-slot"></span><span class="mn-think-slot"></span><button type="button" class="mn-meter" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" class="t"/><circle cx="10" cy="10" r="7.5" class="v" pathLength="100"/></svg></button></span>
        </div>
      </form>`;
    this.log = this.el.querySelector('.mn-log')!;
    this.input = this.el.querySelector('textarea')!;
    this.sendBtn = this.el.querySelector('.mn-send')!;
    this.plusEl = this.el.querySelector('.mn-plus')!;
    this.mic = this.el.querySelector('.mn-mic')!;
    this.mic.onclick = () => void this.toggleMic();
    this.el.classList.add('w-' + chatWidth());
    this.attEl = this.el.querySelector('.mn-att')!;
    this.meter = this.el.querySelector('.mn-meter')!;
    this.modelSlot = this.el.querySelector('.mn-model-slot')!;
    this.pinBtn = this.el.querySelector('.mn-pin')!;
    this.pinBtn.onclick = () => void this.togglePin();
    // Narrow, normal or wide by the chat's own width (not the window's), so compact, wide
    // and full keep their look when the side panes are dragged wider or narrower.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver((es) => {
        const w = es[es.length - 1]?.contentRect.width || 0;
        if (!w) return;
        this.el.classList.toggle('cw-narrow', w <= 640);
        this.el.classList.toggle('cw-big', w >= 1100);
      }).observe(this.el);
    }
    this.agents = new AgentsPanel(() => this.o.onAgents?.());
    this.agents.el.addEventListener('click', (e) => this.onAgentsClick(e));
    this.rail = this.el.querySelector('.mn-rail')!;
    this.wireRail();
    // The live status above the composer: a click opens what is at work, the sub-agents in
    // the Agents panel or the reply's Activity; with nothing to open it is plain text.
    this.liveEl = this.el.querySelector('.mn-live')!;
    this.planEl = this.el.querySelector('.mn-plan')!;
    this.trayEl = this.el.querySelector('.mn-tray')!;
    this.el.querySelector<HTMLButtonElement>('.mn-plan-h')!.onclick = () => {
      this.planFolded = !this.planFolded;
      this.trayEl.classList.toggle('folded', this.planFolded);
      this.el.querySelector('.mn-plan-h')!.setAttribute('aria-expanded', String(!this.planFolded));
    };
    // The owner puts a plan away that is no longer wanted (only while no reply runs).
    this.el.querySelector<HTMLButtonElement>('.mn-plan-x')!.onclick = () => {
      const sid = this.session?.id;
      if (!sid || this.busy) return;
      this.sessionPlan = [];
      this.showPlan(null);
      void A.clearPlan(sid).catch((e: Error) => toast(e.message, 'err'));
    };
    // Coming back to the window or tab puts the cursor in the message box, ready to type
    // (desktop only; a click elsewhere on the page still folds the box away).
    const comeBack = (): void => {
      if (document.visibilityState !== 'visible' || !this.el.isConnected || !this.el.offsetParent) return;
      if (!matchMedia('(min-width: 761px) and (pointer: fine)').matches) return;
      const a = document.activeElement as HTMLElement | null;
      // Focus coming back from an embedded preview is not a return to the window.
      if (a instanceof HTMLIFrameElement) return;
      if (a && a !== document.body && a !== this.input && a.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (a?.closest?.('.kb')) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], .modal-backdrop, .wl-tour')) return;
      this.input.focus({ preventScroll: true });
    };
    window.addEventListener('focus', comeBack);
    document.addEventListener('visibilitychange', comeBack);
    // The tray opens and closes smoothly and the chat above it shrinks or grows with it: a
    // chat that was at its end stays there the whole way, so the newest message never hides.
    this.log.addEventListener('scroll', () => {
      this.stuck = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    }, { passive: true });
    if (typeof ResizeObserver !== 'undefined')
      new ResizeObserver(() => {
        if (this.stuck) this.log.scrollTop = this.log.scrollHeight;
        this.queueDown();
      }).observe(this.log);
    this.liveEl.onclick = (e) => {
      if (e.detail) this.liveEl.blur();
      const ids = (this.liveEl.dataset.subs || '').split(',').filter(Boolean);
      // A second click closes what the first opened.
      if (ids.length) {
        if (this.o.agentsOpen?.()) this.o.closeAgents?.();
        else this.openAgents(ids);
        return;
      }
      const act = this.log.querySelector<HTMLDetailsElement>('.mn-turn.live .mn-act');
      if (!act) return;
      act.open = !act.open;
      if (act.open) act.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    this.log.addEventListener('scroll', () => {
      if (!this.railFrame) this.railFrame = requestAnimationFrame(() => this.syncRail());
    }, { passive: true });
    this.downBtn = this.el.querySelector('.mn-down')!;
    // The jump-to-end button follows the real distance to the end, not only scrolling: the
    // window or on-screen keyboard resizing, turns coming and going (a new chat, another chat
    // opened), images loading and cards unfolding all re-check it.
    const recheck = (): void => this.queueDown();
    window.addEventListener('resize', recheck, { passive: true });
    window.visualViewport?.addEventListener('resize', recheck, { passive: true });
    if (typeof MutationObserver !== 'undefined') new MutationObserver(recheck).observe(this.log, { childList: true, subtree: true });
    this.log.addEventListener('toggle', recheck, true);
    // An image that loads at the end of a chat that sat at its end keeps it there.
    this.log.addEventListener(
      'load',
      () => {
        if (this.stuck) this.log.scrollTop = this.log.scrollHeight;
        this.queueDown();
      },
      true,
    );
    this.downBtn.onclick = () => {
      this.log.scrollTo({ top: this.log.scrollHeight, behavior: 'smooth' });
      this.input.focus({ preventScroll: true });
    };
    const form = this.el.querySelector('form')!;
    form.onsubmit = (e) => {
      e.preventDefault();
      // While Mnemo works the button stops it, unless something is typed: then it queues.
      if (this.busy) {
        if (this.input.value.trim()) this.enqueue();
        else this.stop();
      } else void this.send(this.input.value);
    };
    this.input.addEventListener('keydown', (e) => {
      if (this.slash && this.slashKey(e)) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        // On-screen keyboards: Enter is a new line (the send button sends), so a slip never
        // sends half a message. Physical keyboards: Enter sends, Shift+Enter is a new line.
        if (touchKeyboard() && !e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        if (!this.busy) void this.send(this.input.value);
        // While Mnemo works: Enter queues the message, Ctrl/Cmd+Enter steers the reply now.
        else if (e.ctrlKey || e.metaKey) void this.steerNow(this.input.value);
        else this.enqueue();
      }
    });
    this.input.addEventListener('input', () => {
      void this.paintSlash();
      this.grow();
      this.paintOpen();
      this.paintSend();
    });
    this.input.addEventListener('scroll', () => this.fadeInput(), { passive: true });
    this.input.addEventListener('blur', () => window.setTimeout(() => this.closeSlash(), 150));
    // Leaving the page (closing the tab, reloading) leaves a fleeting chat too.
    window.addEventListener('pagehide', () => this.leaveFleeting());
    // Capsule <-> full composer: open on focus, fold back when the owner taps or tabs away
    // (menus and pickers the composer opened do not count as away).
    const away = (tg: EventTarget | null): boolean =>
      tg instanceof Element && !form.contains(tg) && !tg.closest('[role=menu],[role=dialog],[role=listbox],.ui-sel-pop,.vx-menu');
    form.addEventListener('focusin', () => {
      this.focused = true;
      // The keyboard takes half the screen on phones: keep the latest reply in sight.
      window.setTimeout(() => this.scrollEnd(), 320);
      this.paintOpen();
    });
    // A press outside the box folds it only once that press has become a click (or a moment
    // later): folding at once would move the chat under the pointer, so a question's option,
    // a link or a button would slide away before the click lands on it.
    let pressing = false;
    form.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (pressing) return;
        const a = document.activeElement;
        if (a && a !== document.body && away(a)) this.fold();
      }, 0);
    });
    const outside = (e: PointerEvent): void => {
      if (!this.focused || !away(e.target)) return;
      pressing = true;
      let done = false;
      const after = (): void => {
        if (done) return;
        done = true;
        document.removeEventListener('click', after, true);
        window.clearTimeout(late);
        window.setTimeout(() => {
          pressing = false;
          const a = document.activeElement;
          // Back in the box meanwhile (or a menu it opened): it stays open.
          if (a && a !== document.body && !away(a)) return;
          this.fold();
        }, 0);
      };
      const late = window.setTimeout(after, 900);
      document.addEventListener('click', after, true);
    };
    // A press on the box itself (its padding, the empty bar) counts as the message field: the
    // field keeps focus, so the box does not fold and open again.
    form.querySelector<HTMLElement>('.mn-comp-box')!.addEventListener('pointerdown', (e) => {
      const tg = e.target as Element;
      if (tg === this.input || tg.closest('button, a, input, select, textarea, [role=button], .ui-sel, .mn-att-c')) return;
      e.preventDefault();
      if (document.activeElement !== this.input) this.input.focus({ preventScroll: true });
    });
    document.addEventListener('pointerdown', outside, true);
    this.offOutside = () => document.removeEventListener('pointerdown', outside, true);
    // Paste or drop an image straight into the prompt.
    this.input.addEventListener('paste', (e) => {
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void this.addImages(files);
      }
    });
    const box = this.el.querySelector<HTMLElement>('.mn-comp-box')!;
    box.addEventListener('dragover', (e) => {
      if (Array.from(e.dataTransfer?.items || []).some((i) => i.type.startsWith('image/'))) {
        e.preventDefault();
        box.classList.add('drop');
      }
    });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', (e) => {
      box.classList.remove('drop');
      const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void this.addImages(files);
      }
    });
    this.plusEl.onclick = () => this.pickAttach();
    const qbox = this.el.querySelector<HTMLElement>('.mn-queue')!;
    qbox.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-qa]');
      if (!b || !this.session) return;
      const sid = this.session.id;
      const act = b.dataset.qa!;
      const done = (q: A.QueueState): void => this.setQueue(q);
      const fail = (err: unknown): void => toast((err as Error).message, 'err');
      if (act === 'all') {
        this.qAll = !this.qAll;
        this.paintQueue();
        return;
      }
      if (act === 'clear') return void A.queueClear(sid).then(done, fail);
      if (act === 'resume') return void A.queueResume(sid).then(done, fail);
      const row = b.closest<HTMLElement>('[data-q]');
      if (!row) return;
      const qid = Number(row.dataset.q);
      if (act === 'send') {
        return void A.queueOp(sid, qid, 'send').then(done, fail);
      }
      if (act === 'del' || act === 'up' || act === 'down') void A.queueOp(sid, qid, act).then(done, fail);
    });
    qbox.addEventListener('scroll', () => this.fadeQueue(), { capture: true, passive: true });
    // Drag a queued message onto another to reorder.
    let dragQ = 0;
    qbox.addEventListener('dragstart', (e) => {
      dragQ = Number((e.target as HTMLElement).closest<HTMLElement>('[data-q]')?.dataset.q || 0);
    });
    qbox.addEventListener('dragover', (e) => {
      if (dragQ) e.preventDefault();
    });
    qbox.addEventListener('drop', (e) => {
      const to = Number((e.target as HTMLElement).closest<HTMLElement>('[data-q]')?.dataset.q || 0);
      if (!dragQ || !to || to === dragQ || !this.session) return;
      e.preventDefault();
      const at = this.queue.findIndex((q) => q.id === to);
      void A.queueOp(this.session.id, dragQ, 'move', Math.max(0, at)).then(
        (q) => this.setQueue(q),
        (err) => toast((err as Error).message, 'err'),
      );
      dragQ = 0;
    });
    this.attEl.addEventListener('click', (e) => {
      const arrow = (e.target as HTMLElement).closest<HTMLElement>('[data-car]');
      if (arrow) {
        const row = this.attEl.querySelector<HTMLElement>('.mn-car-row');
        row?.scrollBy({ left: (arrow.dataset.car === 'l' ? -1 : 1) * row.clientWidth * 0.8, behavior: 'smooth' });
        return;
      }
      // An image waiting to be sent: tap it to see it full size (the × still removes it).
      const pic = (e.target as HTMLElement).closest<HTMLElement>('.mn-att-c.img');
      if (pic && !(e.target as HTMLElement).closest('[data-unattach]')) {
        const imgs = this.attach.filter((a) => a.kind === 'image' && a.url);
        const at = Number(pic.dataset.at || 0);
        const one = this.attach[at];
        if (one?.url) openLightbox(one.url, one.title, imgs.map((a) => ({ src: a.url!, caption: a.title })), Math.max(0, imgs.indexOf(one)));
        return;
      }
      const x = (e.target as HTMLElement).closest<HTMLElement>('[data-unattach]');
      if (x) {
        this.attach.splice(Number(x.dataset.unattach), 1);
        this.paintAtt();
        this.focus();
      }
    });
    // Chips in the composer: "Connect a model" opens Settings; the meter explains itself.
    form.addEventListener('click', (e) => {
      const tg = e.target as HTMLElement;
      if (tg.closest('[data-setup]')) openMnemoSettings();
      else if (tg.closest('.mn-meter')) this.contextMenu();
      else if (tg.classList.contains('mn-comp-box')) this.focus();
    });
    this.log.addEventListener('click', (e) => this.onLogClick(e));
    // The answer typed under Other on a question card.
    this.log.addEventListener('submit', (e) => {
      const f = (e.target as HTMLElement).closest<HTMLFormElement>('.mn-ask-f');
      if (!f) return;
      e.preventDefault();
      const card = f.closest<HTMLElement>('.mn-ask')!;
      const text = f.querySelector<HTMLInputElement>('input')!.value.trim();
      if (!text || this.busy || card.classList.contains('done')) return;
      card.classList.add('done');
      f.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach((x) => (x.disabled = true));
      void this.send(text, { to: card.dataset.ask!, other: true });
    });
    this.offState = A.onState(() => {
      this.paintModels();
      this.paintSpeech();
    });
    void A.loadState().then(() => {
      this.paintModels();
      this.paintSpeech();
      if (!this.session) this.paintEmpty();
    });
    this.blank();
  }

  destroy(): void {
    if (this.rec) {
      const rec = this.rec;
      this.rec = null;
      window.clearInterval(rec.tick);
      rec.r.onstop = null;
      if (rec.r.state !== 'inactive') rec.r.stop();
      rec.stream.getTracks().forEach((tr) => tr.stop());
    }
    if (playing && this.el.contains(playing.btn)) stopListening();
    this.detach();
    this.unwatch();
    this.thinkSel?.close();
    this.permSel?.close();
    this.offOutside();
    this.offState();
    this.select?.close();
  }

  focus(): void {
    this.input.focus({ preventScroll: true });
  }

  /** The mic shows when a listening model is set; Listen under replies when a speech one is. */
  private paintSpeech(): void {
    const s = A.mnemoState();
    this.mic.hidden = !this.rec && !(canRecord() && A.roleModel(s, 'stt'));
    this.el.classList.toggle('can-tts', !!A.roleModel(s, 'tts'));
  }

  private async toggleMic(): Promise<void> {
    if (this.rec) {
      if (this.rec.r.state !== 'inactive') this.rec.r.stop();
      return;
    }
    if (this.mic.classList.contains('wait')) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const n = (e as Error).name;
      toast(n === 'NotAllowedError' || n === 'SecurityError' ? t('The browser did not allow the microphone') : n === 'NotFoundError' ? t('No microphone found') : (e as Error).message, 'err');
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((mt) => MediaRecorder.isTypeSupported?.(mt)) || '';
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch (e) {
      stream.getTracks().forEach((tr) => tr.stop());
      toast((e as Error).message, 'err');
      return;
    }
    const chunks: Blob[] = [];
    r.ondataavailable = (ev) => {
      if (ev.data.size) chunks.push(ev.data);
    };
    r.onstop = () => void this.endRecording(chunks, r.mimeType || type);
    const t0 = Date.now();
    this.rec = { r, stream, t0, tick: window.setInterval(() => this.paintRec(), 250) };
    r.start(1000);
    this.paintRec();
  }

  private paintRec(): void {
    const on = !!this.rec;
    this.mic.classList.toggle('rec', on);
    const secs = this.rec ? Math.floor((Date.now() - this.rec.t0) / 1000) : 0;
    this.mic.querySelector('.mn-mic-t')!.textContent = on ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '';
    this.mic.title = on ? t('Stop and turn into text') : t('Speak a message');
    this.mic.setAttribute('aria-label', this.mic.title);
    this.mic.setAttribute('aria-pressed', String(on));
    this.paintOpen();
  }

  private async endRecording(chunks: Blob[], type: string): Promise<void> {
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      window.clearInterval(rec.tick);
      rec.stream.getTracks().forEach((tr) => tr.stop());
    }
    this.paintRec();
    const blob = new Blob(chunks, { type: (type || 'audio/webm').split(';')[0] });
    if (!blob.size) return this.paintSpeech();
    this.mic.classList.add('wait');
    this.mic.disabled = true;
    try {
      const text = await A.transcribe(blob);
      if (text) this.insertText(text);
      else toast(t('Nothing was heard'), 'info');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      this.mic.classList.remove('wait');
      this.mic.disabled = false;
      this.paintSpeech();
    }
  }

  /** Put text at the cursor (spaced from what is around it), then type on from there. */
  private insertText(text: string): void {
    const i = this.input;
    const a = i.selectionStart ?? i.value.length;
    const b = i.selectionEnd ?? a;
    const before = i.value.slice(0, a);
    const after = i.value.slice(b);
    const pre = before && !/\s$/.test(before) ? ' ' : '';
    const post = after && !/^\s/.test(after) ? ' ' : '';
    i.value = before + pre + text + post + after;
    const pos = (before + pre + text).length;
    i.focus();
    i.setSelectionRange(pos, pos);
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Bring message `mid` into view and flash it (a search hit). */
  reveal(mid: number): void {
    const sel = `[data-mid="${mid}"]`;
    const out = this.findAll(sel)[0];
    if (out && !out.isConnected) this.unhold(out);
    const hit = this.log.querySelector<HTMLElement>(sel);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    hit.classList.remove('mn-flash');
    void hit.offsetWidth;
    hit.classList.add('mn-flash');
    window.setTimeout(() => hit.classList.remove('mn-flash'), 2200);
  }

  /** Everything this chat attached, used, changed or showed (the artifacts panel). */
  artifacts(): Artifact[] {
    return artifactsOf(this.messages);
  }

  /** Put what is typed in the queue (Mnemo is busy): it goes out when the reply ends. */
  private enqueue(): void {
    const text = this.input.value.trim();
    if (!text || !this.session) return;
    const body = A.chatBody(text, this.model || undefined, this.attach);
    const att = this.attach.slice();
    this.input.value = '';
    this.attach = [];
    this.paintAtt();
    this.grow();
    this.paintSend();
    void A.queueAdd(this.session.id, body).then(
      (r) => this.setQueue(r.queue),
      (e) => {
        toast((e as Error).message, 'err');
        this.input.value = text;
        this.attach = att;
        this.paintAtt();
        this.grow();
      },
    );
  }

  /** Send a message now: a reply running is cut where it is and this one is answered as a new
   *  message (Ctrl/Cmd+Enter while Mnemo works). */
  private async steerNow(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text || !this.session) return;
    const body = A.chatBody(text, this.model || undefined, this.attach);
    this.input.value = '';
    this.attach = [];
    this.paintAtt();
    this.grow();
    try {
      const r = await A.steerChat(this.session.id, body);
      this.setQueue(r.queue);
    } catch (e) {
      toast((e as Error).message, 'warn');
      this.input.value = text;
      this.grow();
    }
    this.paintSend();
  }

  private setQueue(q: A.QueueState | undefined): void {
    this.queue = q?.items || [];
    this.qHeld = !!q?.held;
    this.paintQueue();
    this.paintSend();
  }

  /** The queue above the prompt: three rows (scroll for more, or Show all), each with Send
   *  now (cuts the reply running), move up and down, and remove. */
  private paintQueue(): void {
    const box = this.el.querySelector<HTMLElement>('.mn-queue')!;
    this.paintTray();
    if (!this.queue.length) {
      this.qAll = false;
      // Kept while the section folds away, then emptied (unless something was queued since).
      window.setTimeout(() => {
        if (!this.queue.length) box.innerHTML = '';
      }, 420);
      return;
    }
    const n = this.queue.length;
    const head = this.qHeld
      ? `<span class="mn-queue-ht warn">${icon('alert')}${t('Paused after an error · {n} waiting', { n })}</span>`
      : `<span class="mn-queue-ht">${icon('chat')}${t('{n} queued', { n })} · ${this.busy ? t('goes out when {mnemo} finishes', { mnemo: A.MNEMO }) : t('sending…')}</span>`;
    const tools = [
      this.qHeld ? `<button type="button" class="mn-qh-b acc" data-qa="resume" title="${t('Send the queue now')}">${icon('send')}<span>${t('Resume')}</span></button>` : '',
      n > 3 ? `<button type="button" class="mn-qh-b" data-qa="all" aria-expanded="${this.qAll}">${this.qAll ? t('Show less') : t('Show all ({n})', { n })}</button>` : '',
      `<button type="button" class="mn-qh-b" data-qa="clear" title="${t('Remove every queued message')}">${icon('trash')}<span>${t('Clear')}</span></button>`,
    ].join('');
    const sendTitle = this.busy ? t('Send now: cuts the reply and answers this') : t('Send now');
    box.innerHTML = `<div class="mn-queue-h">${head}<span class="mn-grow"></span>${tools}</div><div class="mn-q-list${this.qAll ? ' all' : ''}">${this.queue
      .map(
        (q, i) => `<div class="mn-q-i" data-q="${q.id}" draggable="true"><span class="mn-q-n">${i + 1}</span><span class="mn-q-t" title="${attr(q.text)}">${esc(q.text)}${
          q.attach.length ? ` <small>+${q.attach.length}</small>` : ''
        }</span><span class="mn-q-a"><button type="button" class="mn-ibtn" data-qa="send" title="${sendTitle}" aria-label="${t('Send now')}">${icon('send-now')}</button><button type="button" class="mn-ibtn" data-qa="up" title="${t('Move up')}" aria-label="${t('Move up')}"${i === 0 ? ' disabled' : ''}>${icon('arrow')}</button><button type="button" class="mn-ibtn" data-qa="down" title="${t('Move down')}" aria-label="${t('Move down')}"${
          i === n - 1 ? ' disabled' : ''
        }>${icon('arrow')}</button><button type="button" class="mn-ibtn" data-qa="del" title="${t('Remove')}" aria-label="${t('Remove')}">${icon('close')}</button></span></div>`,
      )
      .join('')}</div>`;
    requestAnimationFrame(() => this.fadeQueue());
  }

  /** Fade the queue's top or bottom edge while more rows are that way. */
  private fadeQueue(): void {
    const l = this.el.querySelector<HTMLElement>('.mn-q-list');
    if (!l) return;
    const max = l.scrollHeight - l.clientHeight;
    l.classList.toggle('ft', l.scrollTop > 2);
    l.classList.toggle('fb', max - l.scrollTop > 2);
  }

  // ---- following the chat on every device ----

  /** Follow chat `sid`: messages sent from other devices (or out of the queue) show up, their
   *  replies stream here too, and the queue stays the same everywhere. */
  private watch(sid: string): void {
    if (this.watchSid === sid && this.watchCtrl) return;
    this.unwatch();
    this.watchSid = sid;
    const ctrl = new AbortController();
    this.watchCtrl = ctrl;
    let wait = 1000;
    const loop = async (): Promise<void> => {
      while (!ctrl.signal.aborted && this.watchSid === sid) {
        const t0 = Date.now();
        try {
          await A.watchChat(sid, ctrl.signal, (ev) => this.onWatch(sid, ev));
        } catch {
          /* dropped: try again below */
        }
        if (ctrl.signal.aborted) return;
        if (Date.now() - t0 > 20_000) wait = 1000;
        await new Promise((r) => window.setTimeout(r, document.hidden ? Math.max(wait, 5000) : wait));
        wait = Math.min(wait * 2, 30_000);
        // Back after a gap: catch up on what happened meanwhile.
        if (!ctrl.signal.aborted && this.watchSid === sid && !this.busy) void this.refresh(sid);
      }
    };
    void loop();
  }

  private unwatch(): void {
    this.watchCtrl?.abort();
    this.watchCtrl = null;
    this.watchSid = '';
  }

  private onWatch(sid: string, ev: A.WatchEvent): void {
    if (this.session?.id !== sid) return;
    switch (ev.type) {
      case 'hello':
        if (ev.running && !this.busy) this.follow(sid);
        break;
      case 'user': {
        // This tab's own message is already on screen.
        if (ev.client === A.CLIENT && ev.via === 'chat') break;
        if (this.log.querySelector(`.mn-u[data-mid="${ev.message.id}"]`)) break;
        if (!this.messages.some((m) => m.id === ev.message.id)) this.messages.push(ev.message);
        this.log.querySelector('.mn-hello')?.remove();
        const ub = this.userBubble(ev.message.content, ev.message.created_at, (ev.message.meta?.attach as A.Attach[] | undefined) || []);
        ub.dataset.mid = String(ev.message.id);
        this.log.append(ub);
        this.log.querySelectorAll<HTMLElement>('.mn-ask:not(.done)').forEach(skipAsk);
        this.paintRail();
        this.scrollEnd(true);
        requestAnimationFrame(() => ub.querySelectorAll<HTMLElement>('.mn-car').forEach(syncCarousel));
        break;
      }
      case 'running':
        if (!this.busy) this.follow(sid);
        else this.runAfter = true;
        break;
      case 'idle':
        // This tab's own reply ending re-reads the chat itself.
        if (!this.busy && Date.now() - this.lastEnd > 2500) void this.refresh(sid);
        break;
      case 'queue':
        this.setQueue(ev);
        break;
      case 'queue_error':
        toast(t('A queued message could not go out: {msg}', { msg: ts(ev.message) }), 'warn');
        break;
      case 'compacted':
      case 'reload':
        if (!this.busy) void this.refresh(sid);
        break;
      case 'plan':
        if (this.session?.id === sid) this.setPlan(ev.steps);
        break;
    }
  }

  /** A reply started while this tab was streaming another: follow it once that one ends. */
  private runAfter = false;
  /** When this tab last finished streaming a reply. */
  private lastEnd = 0;
  /** The model that wrote the last reply on screen (a divider marks every change). */
  private shownModel = '';

  /** A line across the chat where another model takes over (`why`: it was a fallback). */
  private modelLine(key: string, why = ''): HTMLElement {
    const st = A.mnemoState();
    const name = st ? A.modelLabel(st, key) : key;
    const d = el('div', 'mn-modelchg' + (why ? ' fb' : ''));
    d.setAttribute('role', 'note');
    d.innerHTML = `<span>${icon(why ? 'refresh' : 'bolt')}<b>${esc(name)}</b>${why ? `<em>${esc(why)}</em>` : `<em>${t('answers from here')}</em>`}</span>`;
    d.title = key;
    return d;
  }

  /** Watch the reply running in this chat (started elsewhere, or out of the queue). */
  private follow(sid: string): void {
    if (this.busy || this.session?.id !== sid) return;
    const lastU = [...this.log.querySelectorAll<HTMLElement>('.mn-u[data-mid]')].pop();
    this.setBusy(true);
    void this.stream((signal, on) => A.streamLive(sid, signal, on), Number(lastU?.dataset.mid || 0), true);
  }

  /** Read the chat again and show it as stored, without the loading screen (another device
   *  added to it, or a reply ended while this tab was not streaming it). */
  private async refresh(sid: string): Promise<void> {
    try {
      const r = await A.getSession(sid);
      if (this.session?.id !== sid || this.busy) return;
      const lastU = r.running ? [...r.messages].reverse().find((m) => m.role === 'user')?.id || 0 : 0;
      const msgs = lastU ? r.messages.filter((m) => m.id <= lastU) : r.messages;
      const same = msgs.length === this.messages.length && msgs[msgs.length - 1]?.id === this.messages[this.messages.length - 1]?.id;
      this.session = r.session;
      this.setQueue(r.queue);
      this.setPlan(r.plan || []);
      this.agentsInfo = r.agents;
      if (!same) {
        const atEnd = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 80;
        const top = this.log.scrollTop;
        this.messages = msgs;
        this.renderAll();
        if (!atEnd) this.log.scrollTop = top;
        this.o.onMessages?.();
      }
      if (r.context) this.setContext(r.context);
      if (lastU) this.follow(sid);
    } catch {
      /* the next event or open catches up */
    }
  }

  /** A reply is streaming. */
  get working(): boolean {
    return this.busy;
  }

  /** New chats are about the whole vault; attachments bring notes and folders in. */
  private newScope(): string {
    return 'global';
  }

  private addAttach(a: A.Attach): void {
    if (this.attach.some((x) => x.kind === a.kind && x.path === a.path)) return;
    if (this.attach.length >= 8) {
      toast(t('Up to 8 notes or folders per message'), 'warn');
      return;
    }
    this.attach.push(a);
    this.paintAtt();
    this.focus();
  }

  /** The chips above the prompt; the box grows to show them (animated in CSS). */
  private paintAtt(): void {
    const box = this.attEl.querySelector<HTMLElement>('.mn-att-in')!;
    box.innerHTML = carouselHTML(this.attach
      .map(
        (a, i) =>
          `<span class="mn-att-c${a.kind === 'image' ? ' img' : ''}" style="--i:${i}" data-at="${i}" title="${attr(a.kind === 'image' ? t('{title} (tap to preview)', { title: a.title }) : a.path || t('All notes'))}">${
            a.kind === 'image' && a.url ? `<img alt="" src="${attr(a.url)}">` : icon(a.kind === 'note' ? 'note' : a.kind === 'image' ? 'image' : 'folder')
          }<span>${esc(a.title)}</span>${
            a.kind === 'folder' && a.notes ? `<small>${a.notes}</small>` : ''
          }<button type="button" data-unattach="${i}" aria-label="${t('Remove {name}', { name: attr(a.title) })}" title="${t('Remove')}">${icon('close')}</button></span>`,
      )
      .join(''));
    this.attEl.classList.toggle('has', this.attach.length > 0);
    requestAnimationFrame(() => box.querySelectorAll<HTMLElement>('.mn-car').forEach(syncCarousel));
    this.paintOpen();
  }

  /** The + button: attach the note or folder you are in, another note, or a folder. */
  private pickAttach(): void {
    useStyles('vx-styles', VAULT_CSS);
    const ctx = this.o.scope();
    const here = ctx.startsWith('note:') ? { kind: 'note' as const, path: ctx.slice(5) } : ctx.startsWith('folder:') ? { kind: 'folder' as const, path: ctx.slice(7) } : null;
    const has = (k: string, p: string): boolean => this.attach.some((x) => x.kind === k && x.path === p);
    const nameOf = (p: string): string => noteTitle(p) || p.split('/').pop()!.replace(/\.md$/i, '');
    openMenu(
      [
        ...(here && !has(here.kind, here.path)
          ? [{ label: here.kind === 'note' ? t('This note') : t('This folder'), desc: A.scopeLabel(ctx), icon: icon(here.kind === 'note' ? 'note' : 'folder', 'vx-i'), run: () => this.addAttach({ ...here, title: A.scopeLabel(ctx) }) }]
          : []),
        { label: t('Image'), desc: t('A picture from this device'), icon: icon('image', 'vx-i'), run: () => this.pickImages() },
        { label: t('Notes'), desc: t('Pick notes from your vault'), icon: icon('note', 'vx-i'), run: () => pickNote((ps) => ps.forEach((p) => this.addAttach({ kind: 'note', path: p, title: nameOf(p) })), 8 - this.attach.length) },
        {
          label: t('Folder'),
          desc: t('Everything in one folder'),
          icon: icon('folder', 'vx-i'),
          run: () =>
            pickFolderDialog({
              title: t('Folder'),
              folders: pickerFolders(),
              verb: t('Attach'),
              run: (f) => this.addAttach({ kind: 'folder', path: f, title: f ? f.split('/').pop()! : t('All notes') }),
            }),
        },
        ...(has('folder', '') ? [] : [{ label: t('All notes'), desc: t('The whole vault'), icon: icon('vault', 'vx-i'), run: () => this.addAttach({ kind: 'folder', path: '', title: t('All notes') }) }]),
      ],
      this.plusEl,
    );
  }

  /** A capsule at rest; focused (or holding text, attachments or a running reply) it opens up
   *  with +, the model and the context meter while the placeholder still shows. */
  private paintOpen(): void {
    const open = this.focused || this.busy || !!this.input.value.trim() || this.attach.length > 0 || !!this.rec || this.mic.classList.contains('wait');
    this.el.querySelector('.mn-comp-box')!.classList.toggle('open', open);
  }

  private fold(): void {
    this.focused = false;
    this.paintOpen();
  }

  /** Stage images for Mnemo (it places them beside a note when asked). */
  private async addImages(files: File[]): Promise<void> {
    const have = this.attach.filter((a) => a.kind === 'image').length;
    const room = Math.min(IMAGES_PER_MESSAGE - have, 8 - this.attach.length);
    if (files.length > room) toast(t('Up to {n} images per message', { n: IMAGES_PER_MESSAGE }), 'warn');
    for (const f of files.slice(0, Math.max(0, room))) {
      try {
        const r = await A.uploadChatImage(f);
        this.addAttach({ kind: 'image', path: r.id, title: r.name, url: r.url, bytes: r.bytes });
      } catch (e) {
        toast((e as Error).message, 'err');
      }
    }
  }

  private pickImages(): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
    inp.multiple = true;
    inp.onchange = () => void this.addImages(Array.from(inp.files || []));
    inp.click();
  }

  /** Tapping the context ring: how full the model's memory is, and the model to use. */
  /** The chat's memory: how full it is for this model, and what happens when it fills. */
  private contextMenu(): void {
    document.querySelector('.mn-cx')?.remove();
    const s = A.mnemoState();
    const c = this.ctx;
    const win = c?.window || this.contextWindow();
    const used = c?.used ?? Number(this.meter.dataset.used || 0);
    const pct = win ? Math.min(100, (used / win) * 100) : 0;
    const at = c?.compact_at || Math.round(win * 0.75);
    const key = c?.model || this.model || this.select?.value || (s ? A.fallbackModel(s) : '');
    const pop = el('div', 'mn-cx');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', t('Chat memory'));
    const n = c?.compactions || 0;
    pop.innerHTML = `<div class="mn-cx-h"><b>${t('Chat memory')}</b><small>${esc(A.modelLabel(s, key))}</small></div>
      <div class="mn-cx-bar" style="--p:${pct.toFixed(1)}%;--c:${win ? ((at / win) * 100).toFixed(1) : 75}%"><i></i><u title="${t('Compacts here')}"></u></div>
      <div class="mn-cx-n">${t('{used} of {win} tokens · {pct}%', { used: `<b>${A.fmtTokens(used)}</b>`, win: A.fmtTokens(win), pct: Math.round(pct) })}</div>
      <p>${this.session ? t('This chat keeps everything from its first message to the last for this model. Near {n} tokens {mnemo} folds the older messages into a summary and carries on.', { n: A.fmtTokens(at), mnemo: A.MNEMO }) : t('A chat keeps everything from its first message to the last for this model. Near {n} tokens {mnemo} folds the older messages into a summary and carries on.', { n: A.fmtTokens(at), mnemo: A.MNEMO })}</p>
      ${n ? `<p class="mn-cx-k">${icon('refresh')}<span>${tn(n, 'Compacted once so far.', 'Compacted {n} times so far.')}</span></p>` : ''}
      <div class="mn-cx-a">${this.session && this.messages.length > 2 ? `<button type="button" class="btn sm" data-cx="compact">${t('Compact now')}</button>` : ''}<button type="button" class="btn ghost sm" data-cx="new">${icon('plus')}<span>${t('New chat')}</span></button></div>`;
    document.body.append(pop);
    const r = this.meter.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w)) + 'px';
    pop.style.bottom = window.innerHeight - r.top + 8 + 'px';
    const close = (): void => {
      pop.remove();
      document.removeEventListener('pointerdown', out, true);
      document.removeEventListener('keydown', esc2, true);
    };
    const out = (e: Event): void => {
      if (!pop.contains(e.target as Node) && !this.meter.contains(e.target as Node)) close();
    };
    const esc2 = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', out, true);
    document.addEventListener('keydown', esc2, true);
    pop.onclick = async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cx]');
      if (!b) return;
      if (b.dataset.cx === 'new') {
        close();
        this.blank();
        this.o.onNew?.();
        return;
      }
      if (!this.session) return;
      b.disabled = true;
      b.textContent = t('Compacting…');
      close();
      const live = this.compactLive();
      this.log.append(live);
      this.scrollEnd(true);
      const sid = this.session.id;
      try {
        const res = await A.compactSession(sid);
        if (res.ok) {
          // The summary is right there: open the divider to read it.
          live.replaceWith(this.compactNote(res.messages || 0, res.summary || '', Number(live.dataset.t0)));
          toast(t('Compacted {n} older messages into a summary', { n: res.messages ?? 0 }), 'ok');
          this.setContext(res.context);
          void A.getSession(sid).then((r) => {
            if (this.session?.id === sid && !this.busy) this.messages = r.messages;
          });
        } else {
          live.remove();
          toast((res.reason && ts(res.reason)) || t('Nothing to compact yet'), 'info');
          this.setContext(res.context);
        }
      } catch (err) {
        live.remove();
        toast((err as Error).message, 'err');
      }
    };
  }

  /** Pin the model in the picker as the one new chats use (web and TUI alike), or unpin it. */
  private async togglePin(): Promise<void> {
    const s = A.mnemoState();
    const key = this.model || this.select?.value || '';
    if (!s || !key) return;
    const isDefault = s.prefs.default_model === key;
    try {
      await A.savePrefs({ default_model: isDefault ? null : key });
      toast(isDefault ? t('New chats use the first pinned model again') : t('New chats now start with {model}, here and in the terminal', { model: A.modelLabel(s, key) }), 'ok');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  /** The permission picker: Ask first (changes and sub-agents wait for an OK), Auto, or
   *  Read only (Mnemo reads and answers, never changes notes). One setting for every chat. */
  private paintPerm(): void {
    const slot = this.el.querySelector<HTMLElement>('.mn-perm-slot');
    const s = A.mnemoState();
    if (!slot) return;
    slot.hidden = !s || !A.usableModels(s).length;
    if (slot.hidden || !s) {
      this.permSel?.close();
      return;
    }
    const mode = permMode(s.prefs.permission);
    const opts: SelectOption[] = PERM_MODES.map((m) => ({ value: m.v, label: m.label, hint: m.hint, lead: `<span class="mn-perm-ld">${icon(m.icon)}</span>` }));
    if (!this.permSel) {
      this.permSel = createSelect({
        options: opts,
        value: mode,
        label: t('Permission'),
        className: 'mn-model mn-perm',
        align: 'start',
        minWidth: 260,
        render: (o) => {
          const m = PERM_MODES.find((x) => x.v === o?.value) || PERM_MODES[0];
          return `${icon(m.icon)}<span class="mn-model-v">${esc(m.label)}</span>`;
        },
        onChange: (v) => {
          const m = PERM_MODES.find((x) => x.v === v) || PERM_MODES[0];
          this.paintPermLook(m.v);
          void A.savePrefs({ permission: m.v }).then(
            () => toast(m.toast, 'ok'),
            (e) => {
              toast((e as Error).message, 'err');
              this.paintPerm();
            },
          );
        },
      });
      slot.innerHTML = '';
      slot.append(this.permSel.el);
    } else this.permSel.setOptions(opts, mode);
    this.paintPermLook(mode);
  }

  /** The chip's colour and words say the mode: Auto warm, Read only neutral, Ask first accent. */
  private paintPermLook(mode: PermMode): void {
    const b = this.permSel?.el;
    if (!b) return;
    const m = PERM_MODES.find((x) => x.v === mode) || PERM_MODES[0];
    b.classList.remove('p-ask', 'p-auto', 'p-read');
    b.classList.add('p-' + m.v);
    b.title = `${m.label}: ${m.hint}`;
  }

  private paintPin(): void {
    const s = A.mnemoState();
    const key = this.model || this.select?.value || '';
    const show = !!s && !!key && A.usableModels(s).length > 0;
    this.pinBtn.hidden = !show;
    if (!show || !s) return;
    const on = A.fallbackModel(s) === key;
    const explicit = s.prefs.default_model === key;
    this.pinBtn.classList.toggle('on', on);
    const tip = explicit ? t('Default for new chats. Tap to unpin.') : on ? t('Used for new chats (first pinned). Tap to make it the default.') : t('Use this model for new chats');
    this.pinBtn.title = tip;
    this.pinBtn.setAttribute('aria-label', tip);
    this.pinBtn.setAttribute('aria-pressed', String(explicit));
  }

  private setContext(c: A.ChatContext | null | undefined): void {
    if (!c) return;
    this.ctx = c;
    this.paintMeter(c.used, c.window);
  }

  // ---- timeline rail: one bar per question; tap, hover, or hold and slide to scrub ----
  // The rail has a fixed height and the bars a fixed spacing; when there are more bars than
  // fit, a window of them glides with the conversation (the question in view near the middle),
  // fading at the edge that hides more. A knob marks how far the chat is scrolled.

  /** Spacing of the bars (px). */
  private static RH = 8;
  /** Height of the window of bars, and how far the bars are moved up in it. */
  private railWin = 0;
  private railOff = 0;
  /** A scrub is under way: the bars hold still under the finger. */
  private railHold = false;

  private paintRail(): void {
    const us = this.users();
    const show = us.length >= 3;
    this.rail.hidden = !show;
    this.el.classList.toggle('has-rail', show);
    if (!show) return;
    const max = Math.min(matchMedia('(max-width: 640px)').matches ? 180 : 220, Math.max(100, this.el.clientHeight * 0.6)) - 12;
    this.railWin = Math.min(us.length * ChatView.RH, max);
    this.rail.style.setProperty('--rh', ChatView.RH + 'px');
    this.rail.style.setProperty('--rwin', this.railWin + 'px');
    this.rail.innerHTML = `<div class="mn-rwin"><div class="mn-rtrack">${us
      .map((u, i) => {
        const txt = (u.querySelector('.mn-ub')?.textContent || '').trim();
        const w = 8 + Math.min(14, Math.round(Math.sqrt(txt.length) * 1.4));
        return `<button type="button" class="mn-rb" data-at="${i}" style="--w:${w}px" aria-label="${attr(txt.slice(0, 80) || t('Message'))}" tabindex="-1"><i></i></button>`;
      })
      .join('')}</div></div><span class="mn-rknob" aria-hidden="true"></span><span class="mn-rlab" aria-hidden="true"></span>`;
    this.railOff = 0;
    this.syncRail();
  }

  /** Move the bars so that bar position `f` (fractional) sits at `y` in the window. */
  private railPlace(f: number, y: number): void {
    const track = this.rail.querySelector<HTMLElement>('.mn-rtrack');
    const win = this.rail.querySelector<HTMLElement>('.mn-rwin');
    if (!track || !win) return;
    const full = track.childElementCount * ChatView.RH;
    const off = Math.max(0, Math.min(full - this.railWin, (f + 0.5) * ChatView.RH - y));
    this.railOff = off;
    track.style.transform = off ? `translateY(${-off}px)` : '';
    win.classList.toggle('more-top', off > 1);
    win.classList.toggle('more-bot', full - this.railWin - off > 1);
  }

  /** Tap a bar to jump; hover (mouse) or press and slide (touch, mouse) to scrub through
   *  the questions: the bars swell around the finger, the chat follows, a label says which.
   *  Sliding past the top or bottom edge keeps going through the questions hidden there. */
  private wireRail(): void {
    let pressed = false;
    let moved = false;
    let cur = -1;
    let hide = 0;
    let edge = 0;
    let edgeDir = 0;
    let lastY = 0;
    const RH = ChatView.RH;
    const bars = (): HTMLElement[] => Array.from(this.rail.querySelectorAll<HTMLElement>('.mn-rb'));
    const winRect = (): DOMRect | null => this.rail.querySelector<HTMLElement>('.mn-rwin')?.getBoundingClientRect() ?? null;
    const at = (y: number): number => {
      const n = bars().length;
      const r = winRect();
      if (!n || !r) return -1;
      const i = Math.floor((Math.max(r.top, Math.min(r.bottom - 1, y)) - r.top + this.railOff) / RH);
      return Math.max(0, Math.min(n - 1, i));
    };
    const swell = (i: number): void => {
      bars().forEach((b, j) => {
        const d = Math.abs(j - i);
        b.style.setProperty('--m', i < 0 ? '1' : String(1 + 0.9 * Math.max(0, 1 - d / 3)));
        b.classList.toggle('hot', j === i);
      });
    };
    const label = (i: number): void => {
      const lab = this.rail.querySelector<HTMLElement>('.mn-rlab');
      const b = bars()[i];
      if (!lab || !b) return;
      const u = this.users()[i];
      const txt = (u?.querySelector('.mn-ub')?.textContent || '').trim();
      lab.innerHTML = `<b>${i + 1}/${bars().length}</b>${esc(txt.slice(0, 90) || t('Message'))}`;
      const r = b.getBoundingClientRect();
      lab.style.top = r.top + r.height / 2 - this.rail.getBoundingClientRect().top + 'px';
      lab.classList.add('in');
      window.clearTimeout(hide);
    };
    const go = (i: number, smooth: boolean): void => {
      let us = this.users();
      const u = us[i];
      if (!u) return;
      // A question outside the page comes back first (with everything after it).
      if (!u.isConnected) {
        this.unhold(u);
        us = this.users();
      }
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      // The first bar is the very start of the chat, the last one its very end (the latest reply).
      const top =
        i === 0
          ? 0
          : i === us.length - 1
            ? this.log.scrollHeight
            : this.log.scrollTop + u.getBoundingClientRect().top - this.log.getBoundingClientRect().top - 12;
      this.log.scrollTo({ top, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    };
    const pick = (i: number): void => {
      if (i === cur || i < 0) return;
      cur = i;
      swell(i);
      label(i);
      if (pressed) {
        moved = true;
        go(i, false);
        // A tick under the thumb for each question passed (phones that support it).
        navigator.vibrate?.(6);
      }
    };
    // Past an edge with more bars beyond it: step through them, the window following.
    const stopEdge = (): void => {
      window.clearInterval(edge);
      edge = 0;
      edgeDir = 0;
    };
    const step = (): void => {
      const n = bars().length;
      const next = Math.max(0, Math.min(n - 1, (cur < 0 ? at(lastY) : cur) + edgeDir));
      if (next === cur) return stopEdge();
      const y = edgeDir < 0 ? RH * 0.5 : this.railWin - RH * 0.5;
      this.railPlace(next, y);
      pick(next);
    };
    const track = (y: number): void => {
      lastY = y;
      const r = winRect();
      if (!r) return;
      const full = bars().length * RH;
      const dir = y < r.top + RH && this.railOff > 1 ? -1 : y > r.bottom - RH && full - this.railWin - this.railOff > 1 ? 1 : 0;
      // Beyond the ends with nothing hidden: the end bar.
      if (dir !== edgeDir) {
        stopEdge();
        if (dir) {
          edgeDir = dir;
          step();
          edge = window.setInterval(step, 70);
          return;
        }
      }
      if (!edgeDir) pick(at(y));
    };
    const done = (): void => {
      stopEdge();
      swell(-1);
      cur = -1;
      this.railHold = false;
      this.rail.classList.remove('scrub');
      hide = window.setTimeout(() => this.rail.querySelector('.mn-rlab')?.classList.remove('in'), 500);
      this.syncRail();
    };
    this.rail.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pressed = true;
      moved = false;
      this.railHold = true;
      this.rail.setPointerCapture(e.pointerId);
      this.rail.classList.add('scrub');
      cur = -1;
      lastY = e.clientY;
      const i = at(e.clientY);
      cur = i;
      swell(i);
      label(i);
      // Touch: the press alone shows where the finger is (no swipe needed first).
      if (e.pointerType !== 'mouse') navigator.vibrate?.(8);
      e.preventDefault();
    });
    // A long press must not open the browser's own menu or select text.
    this.rail.addEventListener('contextmenu', (e) => e.preventDefault());
    this.rail.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    this.rail.addEventListener('pointermove', (e) => {
      if (!pressed && e.pointerType !== 'mouse') return;
      this.railHold = true;
      track(e.clientY);
    });
    const up = (e: PointerEvent): void => {
      if (!pressed) return;
      pressed = false;
      const i = edgeDir ? cur : at(e.clientY);
      if (!moved && i >= 0) go(i, true);
      done();
    };
    this.rail.addEventListener('pointerup', up);
    this.rail.addEventListener('pointercancel', up);
    this.rail.addEventListener('pointerleave', () => {
      if (!pressed) done();
    });
  }

  private syncRail(): void {
    this.railFrame = 0;
    const top = this.log.scrollTop;
    const max = this.log.scrollHeight - this.log.clientHeight;
    this.el.classList.toggle('fade-top', top > 8);
    this.el.classList.toggle('fade-bot', max - top > 8);
    this.paintDown(max - top);
    if (this.rail.hidden) return;
    const us = this.log.querySelectorAll<HTMLElement>(':scope > .mn-u');
    // Questions still outside the page come first on the rail.
    const off = this.heldQ();
    const box = this.log.getBoundingClientRect().top;
    const mid = this.log.clientHeight * 0.35;
    let cur = 0;
    const tops = Array.from(us, (u) => u.getBoundingClientRect().top - box);
    tops.forEach((tp, i) => {
      if (tp <= mid) cur = i;
    });
    // How far between this question and the next the view is: the bars glide, not jump.
    let f = cur;
    if (cur < tops.length - 1 && tops[cur] <= mid) f = cur + Math.max(0, Math.min(1, (mid - tops[cur]) / Math.max(1, tops[cur + 1] - tops[cur])));
    // At the very top or bottom the end bars light up, whatever is in the middle.
    cur += off;
    f += off;
    if (top <= 8) cur = f = off;
    else if (max - top <= 8) cur = f = off + us.length - 1;
    this.rail.querySelectorAll<HTMLElement>('.mn-rb').forEach((b, i) => b.classList.toggle('on', i === cur));
    if (!this.railHold) this.railPlace(f, this.railWin / 2);
    const knob = this.rail.querySelector<HTMLElement>('.mn-rknob');
    if (knob) {
      const p = max > 0 ? Math.max(0, Math.min(1, top / max)) : 1;
      knob.style.transform = `translateY(${Math.round(p * Math.max(0, this.railWin - (knob.offsetHeight || 18)))}px)`;
    }
  }

  /** Offer the note or folder Mnemo was opened from as an attachment (removable). */
  attachScope(scope: string): void {
    if (scope.startsWith('note:')) this.addAttach({ kind: 'note', path: scope.slice(5), title: A.scopeLabel(scope) });
    else if (scope.startsWith('folder:')) this.addAttach({ kind: 'folder', path: scope.slice(7), title: A.scopeLabel(scope) });
    // Ask Mnemo from a note's page: offer that note's earlier chats.
    if (scope.startsWith('note:')) void this.offerEarlier();
  }

  /** A new chat about a note or folder that already has chats: offer to carry on in one of
   *  them (typing starts a new chat as usual). */
  private async offerEarlier(): Promise<void> {
    if (this.session || this.messages.length) return;
    const about = this.attach.length === 1 && this.attach[0].kind === 'note' ? this.attach[0] : null;
    if (!about || !about.path) return;
    let list: A.Session[] = [];
    try {
      list = (await A.sessionsAbout(about.path)).sessions;
    } catch {
      return;
    }
    const hello = this.log.querySelector<HTMLElement>('.mn-hello');
    if (!list.length || !hello || this.session || this.messages.length) return;
    hello.querySelector('.mn-earlier')?.remove();
    const box = el(
      'div',
      'mn-earlier',
      `<div class="mn-earlier-h">${icon('chat')}<span><b>${tn(list.length, 'There is a chat about {title}', 'There are {n} chats about {title}', { title: esc(about.title) })}</b><small>${t('Carry on in one, or just type below to start a new chat.')}</small></span></div>
      <div class="mn-earlier-l">${list
        .slice(0, 3)
        .map(
          (x) =>
            `<button type="button" class="mn-earlier-i" data-earlier="${attr(x.id)}"><span class="mn-earlier-t"><b>${esc(x.title)}</b><small>${esc(
              relTs(x.updated_at),
            )} · ${tn(x.messages, '{n} message', '{n} messages')}</small></span><span class="mn-earlier-go">${t('Continue')}${icon('chev')}</span></button>`,
        )
        .join('')}</div>`,
    );
    box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-earlier]');
      if (!b) return;
      void this.open(b.dataset.earlier!).then(() => {
        if (this.session) this.o.onChange?.(this.session);
      });
    });
    const sugs = hello.querySelector('.mn-sugs');
    if (sugs) sugs.before(box);
    else hello.append(box);
  }

  /** A new chat opened from a note or folder starts with it attached (removable). */
  private seedAttach(): void {
    this.attach = [];
    const ctx = this.o.scope();
    if (ctx.startsWith('note:')) this.attach.push({ kind: 'note', path: ctx.slice(5), title: A.scopeLabel(ctx) });
    else if (ctx.startsWith('folder:')) this.attach.push({ kind: 'folder', path: ctx.slice(7), title: A.scopeLabel(ctx) });
    this.paintAtt();
  }

  /** Start over with no chat (one is made with the first message). */
  get fleeting(): boolean {
    return this.fleetingOn;
  }

  /** Make the new chat fleeting (or not). Only before its first message. */
  setFleeting(on: boolean): void {
    if (this.session) return;
    this.fleetingOn = on;
    this.el.classList.toggle('fleeting', on);
    this.paintPlaceholder();
    this.paintEmpty();
  }

  /** The prompt's hint says a fleeting chat is private. */
  private paintPlaceholder(): void {
    const ta = this.el.querySelector<HTMLTextAreaElement>('.mn-comp textarea, textarea');
    if (ta) ta.placeholder = this.fleetingOn ? t('Ask privately… nothing here is kept') : t('Ask {mnemo} about your notes…', { mnemo: A.MNEMO });
  }

  /** Leave a fleeting chat: it is deleted on the server, images and all. */
  leaveFleeting(): void {
    if (!this.fleetingOn) return;
    const id = this.session?.id;
    this.fleetingOn = false;
    this.el.classList.remove('fleeting');
    this.paintPlaceholder();
    if (id) {
      this.detach();
      A.forgetSession(id);
      this.o.onForget?.(id);
    }
  }

  // ---- the slash menu: /name runs one of the owner's skills ----

  private async paintSlash(): Promise<void> {
    const m = /^\/([\p{L}\p{N}_.-]*)$/u.exec(this.input.value);
    if (!m) return this.closeSlash();
    const list = await skillsList();
    if (!/^\/[\p{L}\p{N}_.-]*$/u.test(this.input.value)) return this.closeSlash();
    const q = m[1].toLowerCase();
    const found = list.filter((k) => k.name.toLowerCase().includes(q)).sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)));
    let box = this.slash?.box;
    if (!box) {
      box = el('div', 'mn-slash');
      box.setAttribute('role', 'listbox');
      box.setAttribute('aria-label', t('Skills'));
      this.el.querySelector('form.mn-comp')!.append(box);
      box.addEventListener('mousedown', (e) => e.preventDefault());
      box.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-slash]');
        if (b) this.pickSlash(b.dataset.slash!);
      });
    }
    this.slash = { box, list: found, at: Math.min(this.slash?.at ?? 0, Math.max(0, found.length - 1)) };
    box.innerHTML =
      `<div class="mn-slash-h">${icon('bolt')}<span>${t('Skills')}</span><small>${t('kept in the Skills folder')}</small></div>` +
      (found.length
        ? found
            .slice(0, 8)
            .map(
              (k, i) =>
                `<button type="button" role="option" class="mn-slash-i${i === this.slash!.at ? ' on' : ''}" data-slash="${attr(k.name)}" aria-selected="${i === this.slash!.at}"><b>/${esc(k.name)}</b><small>${esc(
                  k.description || k.path,
                )}</small></button>`,
            )
            .join('')
        : `<p class="mn-slash-none">${
            list.length ? t('No skill by that name.') : t('No skills yet. Ask {mnemo}, for example: “make a skill that tidies my meeting notes”.', { mnemo: A.MNEMO })
          }</p>`);
  }

  private closeSlash(): void {
    this.slash?.box.remove();
    this.slash = null;
  }

  private pickSlash(name: string): void {
    this.input.value = `/${name} `;
    this.closeSlash();
    this.grow();
    this.paintSend();
    this.input.focus();
  }

  /** Keys while the slash menu is open; true when the key was used here. */
  private slashKey(e: KeyboardEvent): boolean {
    const sl = this.slash!;
    const n = Math.min(sl.list.length, 8);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.closeSlash();
      return true;
    }
    if (!n) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sl.at = (sl.at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      sl.box.querySelectorAll<HTMLElement>('.mn-slash-i').forEach((b, i) => {
        b.classList.toggle('on', i === sl.at);
        b.setAttribute('aria-selected', String(i === sl.at));
      });
      return true;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      this.pickSlash(sl.list[sl.at].name);
      return true;
    }
    return false;
  }

  blank(): void {
    this.leaveFleeting();
    this.detach();
    this.unwatch();
    this.setQueue(undefined);
    this.session = null;
    this.messages = [];
    this.model = '';
    this.ctx = null;
    this.agents.reset();
    this.seedAttach();
    this.paintModels();
    this.paintEmpty();
    this.paintMeter(0, this.contextWindow());
    this.paintRail();
    this.o.onMessages?.();
  }

  async open(id: string): Promise<void> {
    if (this.session?.id !== id) {
      this.leaveFleeting();
      this.unwatch();
      this.setQueue(undefined);
    }
    this.detach();
    this.dropHeld();
    this.log.innerHTML = `<div class="mn-loading">${markHTML('lg pulse')}<span>${t('Opening the chat…')}</span></div>`;
    try {
      const r = await A.getSession(id);
      this.session = r.session;
      // A reply still running: show the chat up to its question, then watch the reply live.
      const lastU = r.running ? [...r.messages].reverse().find((m) => m.role === 'user')?.id || 0 : 0;
      this.messages = lastU ? r.messages.filter((m) => m.id <= lastU) : r.messages;
      this.model = r.session.model;
      this.sessionPlan = r.plan || [];
      this.agentsInfo = r.agents;
      this.attach = [];
      this.paintAtt();
      this.paintModels();
      this.renderAll();
      this.setQueue(r.queue);
      this.watch(id);
      this.ctx = null;
      if (r.context) this.setContext(r.context);
      else this.paintMeter(this.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0), this.contextWindow());
      this.o.onMessages?.();
      if (lastU && this.session?.id === id) {
        this.setBusy(true);
        void this.stream((signal, on) => A.streamLive(id, signal, on), lastU, true);
      }
    } catch (e) {
      this.dropHeld();
      this.log.innerHTML = `<div class="mn-err">${icon('alert')}<span>${esc((e as Error).message)}</span></div>`;
    }
  }

  /** The place a new chat would be about changed (another note was opened). */
  contextChanged(): void {
    if (this.session) return;
    if (!this.input.value.trim()) this.seedAttach();
    this.paintEmpty();
  }

  /** Put text in the composer (a suggestion, or "Ask about this note"). */
  prefill(text: string, sendNow = false): void {
    this.input.value = text;
    this.grow();
    if (sendNow) void this.send(text);
    else this.focus();
  }

  private grow(): void {
    this.input.style.height = 'auto';
    this.input.style.height = Math.min(this.input.scrollHeight, this.o.compact ? 160 : 240) + 'px';
    this.fadeInput();
  }

  /** Fade the prompt's top or bottom edge while there is more text that way. */
  private fadeInput(): void {
    const ta = this.input;
    const max = ta.scrollHeight - ta.clientHeight;
    ta.classList.toggle('ft', ta.scrollTop > 2);
    ta.classList.toggle('fb', max - ta.scrollTop > 2);
  }

  private contextWindow(): number {
    const s = A.mnemoState();
    if (!s) return 0;
    const key = this.model || A.fallbackModel(s);
    const m = s.models.find((x) => A.modelKey(x) === key);
    return m?.context_window || s.prefs.context_tokens || s.defaults.context_tokens;
  }

  private paintModels(): void {
    const s = A.mnemoState();
    if (!s) return;
    const list = A.usableModels(s);
    if (!list.length) {
      this.select?.close();
      this.select = null;
      this.modelSlot.innerHTML = `<button type="button" class="mn-chip warn" data-setup title="${t('Add a provider and a model in Settings, Mnemo')}">${icon('settings')}<span>${t('Connect a model')}</span></button>`;
      this.meter.hidden = true;
      this.pinBtn.hidden = true;
      return;
    }
    const opts: SelectOption[] = list.map((m) => ({
      value: A.modelKey(m),
      label: m.label || m.model_id,
      // The pinned default wears its own badge; with none set, the model new chats fall back to
      // says Default in its line.
      hint: [!s.prefs.default_model && A.modelKey(m) === A.fallbackModel(s) ? t('Default') : '', A.providerLabel(s, m.provider_id), m.context_window ? t('{n} context', { n: A.fmtTokens(m.context_window) }) : ''].filter(Boolean).join(' · '),
      group: m.pinned ? t('Pinned') : A.providerLabel(s, m.provider_id),
      lead: m.pinned
        ? `<span class="mn-star">${icon('star')}</span>`
        : `<span class="mn-pdot" data-p="${attr(A.providerOf(s, m.provider_id)?.kind || '')}"></span>`,
      // Pin as the default for new chats, straight from the list.
      trail: {
        html: s.prefs.default_model === A.modelKey(m) ? `${icon('pin')}<span>${t('Default')}</span>` : icon('pin'),
        label: s.prefs.default_model === A.modelKey(m) ? t('Default for new chats. Tap to unpin.') : t('Use this model for new chats'),
        on: s.prefs.default_model === A.modelKey(m),
        run: () => {
          const key = A.modelKey(m);
          const off = A.mnemoState()?.prefs.default_model === key;
          void A.savePrefs({ default_model: off ? null : key }).then(
            () => toast(off ? t('No default model: new chats use the first pinned one') : t('{model} is the default for new chats', { model: m.label || m.model_id }), 'ok'),
            (e) => toast((e as Error).message, 'err'),
          );
        },
      },
    }));
    // The chat's own model stays shown even when it is hidden from the picker.
    const own = this.model && !opts.some((x) => x.value === this.model) ? s.models.find((x) => A.modelKey(x) === this.model) : undefined;
    if (own) opts.unshift({ value: this.model, label: own.label || own.model_id, hint: t('This chat · hidden'), group: t('This chat') });
    const value = this.model && opts.some((x) => x.value === this.model) ? this.model : A.fallbackModel(s);
    if (!this.select) {
      this.modelSlot.innerHTML = '';
      this.select = createSelect({
        options: opts,
        value,
        label: t('Model'),
        searchable: opts.length > 7,
        className: 'mn-model mn-model-pick',
        popClass: 'mn-model-pop',
        align: 'start',
        minWidth: 360,
        // The pinned default shows a small pin after its name, so it is clear at a glance.
        render: (o) =>
          `<span class="mn-model-v">${o ? esc(o.label) : t('Model')}</span>${
            o && A.mnemoState()?.prefs.default_model === o.value ? `<span class="mn-model-def" title="${attr(t('Default for new chats. Tap to unpin.'))}">${icon('pin')}</span>` : ''
          }${icon('chev-down', 'i mn-model-chev')}`,
        onChange: (v) => void this.chooseModel(v),
        footer: { label: t('Manage models and providers'), icon: icon('settings'), run: () => openMnemoSettings() },
      });
      this.modelSlot.append(this.select.el);
    } else this.select.setOptions(opts, value);
    this.paintThink();
    this.paintPin();
    this.paintPerm();
    if (!this.session && !this.ctx) this.paintMeter(0, this.contextWindow());
  }

  /** Switch a sub-agent's model from its card, the way the chat's model is switched: pick,
   *  confirm, and it takes over from the sub-agent's next step (follow-ups use it too). */
  private async pickSubModel(card: HTMLElement, at: HTMLElement): Promise<void> {
    const s = A.mnemoState();
    if (!s || !this.session) return;
    const sid = this.session.id;
    const st = subSt(card);
    const prev = st.model;
    const name = (k: string): string => (k ? A.modelLabel(s, k) : t('Auto'));
    const opts: SelectOption[] = [
      { value: '', label: t('Auto'), hint: t('Default model, then the fallbacks') },
      ...A.usableModels(s).map((m) => ({ value: A.modelKey(m), label: m.label || m.model_id, hint: A.providerLabel(s, m.provider_id), group: m.pinned ? t('Pinned') : A.providerLabel(s, m.provider_id) })),
    ];
    card.querySelectorAll('.mn-sub-sel').forEach((x) => x.remove());
    const sel = createSelect({
      options: opts,
      value: prev,
      label: t('Model for {agent}', { agent: st.agent }),
      searchable: opts.length > 8,
      minWidth: 260,
      onChange: (key) => {
        sel.el.remove();
        if (key === prev) return;
        Modal.open({
          title: t("Switch {agent}'s model?", { agent: esc(st.agent) }),
          body: `<p>${
            card.dataset.state === 'run'
              ? t("{model} takes over from {agent}'s next step (it is working now), and answers its follow-ups in this chat. It may work a little differently from {prev}.", { model: `<b>${esc(name(key))}</b>`, agent: esc(st.agent), prev: `<b>${esc(name(prev))}</b>` })
              : t("{model} takes over from {agent}'s next step, and answers its follow-ups in this chat. It may work a little differently from {prev}.", { model: `<b>${esc(name(key))}</b>`, agent: esc(st.agent), prev: `<b>${esc(name(prev))}</b>` })
          }</p>`,
          actions: [
            { label: t('Keep {model}', { model: name(prev) }), cls: 'ghost', run: () => Modal.close() },
            {
              label: t('Switch'),
              cls: 'primary',
              run: () => {
                Modal.close();
                A.setSubModel(sid, st.agent, key).then(
                  () => toast(t('{agent} now uses {model}', { agent: st.agent, model: name(key) }), 'ok'),
                  (e) => toast((e as Error).message, 'err'),
                );
              },
            },
          ],
        });
      },
    });
    sel.el.classList.add('mn-sub-sel');
    at.after(sel.el);
    sel.open();
  }

  private async chooseModel(key: string): Promise<void> {
    const prev = this.model || A.fallbackModel(A.mnemoState()!);
    if (key === prev) return;
    // A chat that has begun: another model may answer a little differently from here on.
    if (this.session && this.messages.length) {
      const st = A.mnemoState();
      const name = (k: string): string => (st ? A.modelLabel(st, k) : k);
      const ok = await new Promise<boolean>((done) => {
        Modal.open({
          title: t('Switch the model for this chat?'),
          body: `<p>${
            this.ctx && this.ctx.used > 0
              ? t('This chat so far was answered by {prev}. From the next message on, {model} answers, with the whole chat as context. Its answers may read a little differently, and its memory for this chat may be smaller or larger.', { prev: `<b>${esc(name(prev))}</b>`, model: `<b>${esc(name(key))}</b>` })
              : t('This chat so far was answered by {prev}. From the next message on, {model} answers, with the whole chat as context. Its answers may read a little differently.', { prev: `<b>${esc(name(prev))}</b>`, model: `<b>${esc(name(key))}</b>` })
          }</p>`,
          actions: [
            { label: t('Keep {model}', { model: name(prev) }), cls: 'ghost', run: () => (Modal.close(), done(false)) },
            { label: t('Switch'), cls: 'primary', run: () => (Modal.close(), done(true)) },
          ],
        });
      });
      if (!ok) {
        this.select?.set(prev, false);
        return;
      }
    }
    this.model = key;
    this.paintThink();
    // Another model has another window; the server tells the exact figure on the next answer.
    if (this.ctx) this.ctx = { ...this.ctx, window: this.contextWindow(), model: key };
    this.paintMeter(Number(this.meter.dataset.used || 0), this.contextWindow());
    this.paintPin();
    if (!this.session) return;
    try {
      this.session = (await A.updateSession(this.session.id, { model: key })).session;
      this.o.onChange?.(this.session);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  /** The thinking level chip, for models that can think (one level for every chat, saved
   *  for the owner on every device). */
  private paintThink(): void {
    const slot = this.el.querySelector<HTMLElement>('.mn-think-slot');
    const s = A.mnemoState();
    if (!slot || !s) return;
    const key = this.model || this.select?.value || A.fallbackModel(s);
    const m = s.models.find((x) => A.modelKey(x) === key);
    if (!m?.thinks) {
      this.thinkSel?.close();
      this.thinkSel = null;
      slot.innerHTML = '';
      return;
    }
    const level = (s.prefs.thinking || 'auto') as A.ThinkLevel;
    const opts: SelectOption[] = THINK_LEVELS.map((l) => ({ value: l.v, label: l.label, hint: l.hint }));
    const tip = (v: string): void => {
      if (!this.thinkSel) return;
      const lbl = THINK_LEVELS.find((l) => l.v === v)?.label ?? v;
      this.thinkSel.el.title = v === 'auto' ? t('Thinking: the model decides how much') : t('Thinking: {level}', { level: lbl.toLowerCase() });
      this.thinkSel.el.classList.toggle('set', v !== 'auto');
    };
    if (this.thinkSel) {
      this.thinkSel.setOptions(opts, level);
      tip(level);
      return;
    }
    this.thinkSel = createSelect({
      options: opts,
      value: level,
      label: t('Thinking'),
      className: 'mn-model mn-think',
      align: 'end',
      minWidth: 230,
      render: (o) => `${icon('brain')}<span class="mn-model-v">${o ? esc(o.value === 'auto' ? t('Think') : o.label) : t('Think')}</span>`,
      onChange: (v) => {
        tip(v);
        void A.savePrefs({ thinking: v as A.ThinkLevel }).then(
          () => toast(v === 'off' ? t('Thinking off: quicker, plainer answers') : v === 'auto' ? t('Thinking: the model decides how much') : t('Thinking: {level}', { level: THINK_LEVELS.find((l) => l.v === v)?.label.toLowerCase() ?? v }), 'ok'),
          (e) => toast((e as Error).message, 'err'),
        );
      },
    });
    slot.innerHTML = '';
    slot.append(this.thinkSel.el);
    tip(level);
  }

  private thinkSel: Select | null = null;

  private paintMeter(used: number, window: number): void {
    const pct = window ? Math.min(100, (used / window) * 100) : 0;
    this.meter.dataset.used = String(used);
    this.meter.style.setProperty('--pct', pct.toFixed(1));
    this.meter.classList.toggle('hot', pct > 80);
    const s = A.mnemoState();
    this.meter.hidden = !window || !s || !A.usableModels(s).length;
    const tip = window ? t('Context used: about {used} of {win} tokens ({pct}%). Tap for details.', { used: A.fmtTokens(used), win: A.fmtTokens(window), pct: Math.round(pct) }) : '';
    this.meter.title = tip;
    this.meter.setAttribute('aria-label', tip || t('Context used'));
  }

  private paintEmpty(): void {
    if (this.session || this.messages.length) return;
    // A new chat starts without another chat's checklist.
    this.showPlan(null);
    const s = A.mnemoState();
    const sc = this.newScope();
    const kind = sc.startsWith('note:') ? 'note' : sc.startsWith('folder:') ? 'folder' : 'global';
    const ready = !!s && A.usableModels(s).length > 0;
    const about =
      kind === 'note' ? t('Ask about {name}, or anything in your vault.', { name: `<b>${esc(A.scopeLabel(sc))}</b>` }) : kind === 'folder' ? t('Ask about the folder {name}, or anything in your vault.', { name: `<b>${esc(A.scopeLabel(sc))}</b>` }) : t('I find, read, write, tag, link and tidy your notes. No web, no shell: only your vault.');
    this.dropHeld();
    this.log.innerHTML = `<div class="mn-hello">
        ${
          this.fleetingOn
            ? `<div class="mn-incog" aria-hidden="true">${icon('incognito')}</div>
        <h2>${t('Fleeting chat')}</h2>
        <p>${t('Nothing said here is kept.')}</p>
        <p class="mn-fleet-n">${t('It is gone when you leave, pictures included. Changes to your notes still show in Activity and History.')}</p>`
            : `<div class="mn-hello-mark">${markHTML('xl')}</div>
        <h2>${this.o.compact ? t("Hi, I'm {mnemo}", { mnemo: A.MNEMO }) : t('{mnemo} looks after your notes', { mnemo: A.MNEMO })}</h2>
        <p>${about}</p>`
        }
        ${
          ready
            ? `${
                !this.fleetingOn && kind === 'global' && !s?.prefs.intro_done
                  ? `<form class="mn-intro" data-intro autocomplete="off"><b>${t('Tell {mnemo} about you', { mnemo: A.MNEMO })}</b><span>${t('Optional. A few words on who you are, what you work on, how you like answers. {mnemo} keeps them and you can change them any time in Settings.', { mnemo: A.MNEMO })}</span>
              <textarea class="ui-input" rows="2" maxlength="4000" placeholder="${attr(t('e.g. I write in English, like short answers, and keep my projects in Work/'))}" aria-label="${t('About you')}"></textarea>
              <div class="mn-intro-a"><button type="submit" class="btn primary sm">${icon('check')}<span>${t('Save')}</span></button><button type="button" class="btn sm" data-intro-notes>${icon('sparkle')}<span>${t('Describe me from my notes')}</span></button><button type="button" class="btn ghost sm" data-intro-skip>${t('Skip')}</button></div></form>`
                  : ''
              }<div class="mn-sugs" data-kind="${kind}"></div>${
                kind === 'global'
                  ? `<div class="mn-sug-bar"><button type="button" class="mn-sug-act" data-amaze title="${t('{mnemo} writes new suggestions from your recent notes (yours stay)', { mnemo: A.MNEMO })}">${icon('sparkle')}<span>${t('Fresh ideas')}</span></button><button type="button" class="mn-sug-act" data-own-sugs title="${t('Your own suggestions, kept until you change them')}">${icon('edit')}<span>${t('Your suggestions')}</span></button></div><div class="mn-sk-row" hidden></div>`
                  : ''
              }`
            : s && !ready
              ? `<div class="mn-setup"><b>${t('Connect a model first')}</b><span>${t('Add an OpenAI, Anthropic or OpenAI-compatible API key in Settings. The key stays sealed on your server.')}</span><button type="button" class="btn primary sm" data-setup>${icon('settings')}<span>${t('Set up {mnemo}', { mnemo: A.MNEMO })}</span></button></div>`
              : ''
        }
      </div>`;
    if (ready) this.fillSugs(kind);
    this.wireIntro();
  }

  /** Draw the checklist (null folds it away): its title, progress and fold button sit in the
   *  tray's top row (beside the live line), then each step not started, in progress or done.
   *  Folded, only the step at work shows. */
  private showPlan(steps: PlanStep[] | null, own = true): void {
    const gen = ++this.planGen;
    if (!steps?.length) {
      this.planOwn = false;
      if (!this.trayEl.classList.contains('has-plan')) return;
      this.trayEl.classList.remove('has-plan');
      this.paintTray();
      // The steps stay while the section folds away, then go.
      window.setTimeout(() => {
        if (gen === this.planGen) this.planEl.innerHTML = '';
      }, 420);
      return;
    }
    this.planOwn = own;
    this.trayEl.classList.toggle('own', own);
    const was = new Map(Array.from(this.planEl.querySelectorAll<HTMLElement>('.mn-ps')).map((r) => [r.dataset.t || '', r.dataset.s || '']));
    const done = steps.filter((s) => s.status === 'done').length;
    this.planEl.innerHTML = steps
      .map((s) => {
        const st = s.status === 'done' || s.status === 'in_progress' ? s.status : 'pending';
        const ic = st === 'done' ? icon('check') : st === 'in_progress' ? '<i class="mn-spin"></i>' : '<i class="mn-ps-o"></i>';
        const fresh = was.has(s.text) && was.get(s.text) !== st ? ' now' : '';
        return `<div class="mn-ps ${st}${fresh}" role="listitem" data-t="${attr(s.text)}" data-s="${st}"><span class="mn-ps-i" aria-hidden="true">${ic}</span><span class="mn-ps-t">${esc(s.text)}${
          s.sub ? `<small>${esc(s.sub)}</small>` : ''
        }</span><span class="sr-only">${st === 'done' ? t('done') : st === 'in_progress' ? t('in progress') : t('not started')}</span></div>`;
      })
      .join('');
    this.el.querySelector('.mn-plan-ttl')!.textContent = own ? t('Plan') : t('Sub-agents');
    this.el.querySelector('.mn-plan-n')!.textContent = t('{done} of {total}', { done, total: steps.length });
    this.el.querySelector<HTMLElement>('.mn-plan-bar > i')!.style.width = `${Math.round((done / steps.length) * 100)}%`;
    this.trayEl.classList.toggle('folded', this.planFolded);
    this.trayEl.classList.add('has-plan');
    this.paintTray();
  }

  /** Open or fold each part of the tray (and the tray itself) for what there is now. */
  private paintTray(): void {
    const live = !this.liveEl.hidden;
    const plan = this.trayEl.classList.contains('has-plan');
    const queued = this.queue.length > 0;
    this.el.querySelector('.mn-tray-hc')!.classList.toggle('on', live || plan);
    this.el.querySelector('.mn-plan-c')!.classList.toggle('on', plan);
    this.el.querySelector('.mn-queue-c')!.classList.toggle('on', queued);
    this.trayEl.classList.toggle('on', live || plan || queued);
  }

  /** Answers of sub-agents in the background, collected by an agents wait: into their cards. */
  private agentResults(output: unknown): void {
    const o = parseOut(output) as { results?: { call_id?: string; ok?: boolean; answer?: string; model?: string; steps?: number; error?: string }[] } | null;
    for (const r of o?.results || []) {
      const c = this.agents.byId(r.call_id || '');
      if (c) subFinal(c, r, r.ok !== false);
    }
  }

  /** The chat's plan changed (Mnemo's update_plan, here or on another device): show it as it
   *  is now; an empty plan (every step done, or cleared) folds away at once. */
  private setPlan(steps: PlanStep[]): void {
    this.sessionPlan = steps;
    if (steps.length) this.showPlan(steps);
    else if (this.planOwn || !this.busy) this.showPlan(null);
  }

  /** The checklist shows only its header and the step at work. */
  private planFolded = false;

  /** The one-time "tell Mnemo about you" card: each line kept as a note about the owner, or
   *  Mnemo learns from the notes, or it is skipped; any answer puts it away for good. */
  private wireIntro(): void {
    const f = this.log.querySelector<HTMLFormElement>('[data-intro]');
    if (!f) return;
    const done = (): void => {
      f.remove();
      void A.savePrefs({ intro_done: true }).catch(() => undefined);
    };
    const ta = f.querySelector<HTMLTextAreaElement>('textarea')!;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const lines = ta.value
        .split(/\n+/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!lines.length) return ta.focus();
      for (const text of lines) await A.addOwnerMemory(text).catch(() => undefined);
      toast(t('{mnemo} will keep that in mind', { mnemo: A.MNEMO }), 'ok');
      done();
    };
    f.querySelector<HTMLButtonElement>('[data-intro-skip]')!.onclick = done;
    f.querySelector<HTMLButtonElement>('[data-intro-notes]')!.onclick = () => {
      done();
      this.prefill(A.describeMe(), true);
    };
  }

  /** Four suggestions: some of yours and some of Mnemo's (on a vault-wide chat), the rest picked
   *  from the built-in ones; different each time. */
  private fillSugs(kind: 'global' | 'note' | 'folder', aiFirst = false): void {
    const box = this.log.querySelector<HTMLElement>('.mn-sugs');
    if (!box) return;
    const picked: { t: string; k: 'own' | 'ai' | 'base' }[] = [];
    const has = (x: string): boolean => picked.some((p) => p.t.toLowerCase() === x.toLowerCase());
    if (kind === 'global' && sugCache) {
      for (const sg of shuffled(sugCache.own).slice(0, aiFirst ? 1 : 2)) if (!has(sg)) picked.push({ t: sg, k: 'own' });
      for (const sg of shuffled(sugCache.ai).slice(0, aiFirst ? 3 : 2)) if (!has(sg) && picked.length < 4) picked.push({ t: sg, k: 'ai' });
    }
    for (const sg of shuffled(SUGGEST[kind].map((x) => t(x)))) if (picked.length < 4 && !has(sg)) picked.push({ t: sg, k: 'base' });
    const ic = { own: 'pin', ai: 'sparkle', base: 'chat' } as const;
    const tag = { own: t('Yours'), ai: t('For you'), base: '' };
    box.innerHTML = picked
      .map(
        (p, i) =>
          `<button type="button" class="mn-sug k-${p.k}" style="--i:${i}" data-sug="${attr(p.t)}">${icon(ic[p.k])}<span>${esc(p.t)}${
            tag[p.k] ? `<em>${tag[p.k]}</em>` : ''
          }</span></button>`,
      )
      .join('');
    if (kind !== 'global') return;
    if (!sugCache) {
      void A.getSuggestions()
        .then((r) => {
          sugCache = r;
          if (r.own.length || r.ai.length) this.fillSugs(kind);
        })
        .catch(() => undefined);
    }
    void skillsList().then((list) => {
      const row = this.log.querySelector<HTMLElement>('.mn-sk-row');
      if (!row || !list.length) return;
      row.hidden = false;
      row.innerHTML = `<span>${t('Your skills')}</span>${list
        .slice(0, 6)
        .map((k) => `<button type="button" class="mn-sk-chip" data-skill="/${attr(k.name)} " title="${attr(k.description || k.path)}">/${esc(k.name)}</button>`)
        .join('')}`;
    });
  }

  private async amaze(b: HTMLButtonElement): Promise<void> {
    b.disabled = true;
    b.classList.add('busy');
    const label = b.querySelector('span')!;
    label.textContent = t('Finding ideas…');
    const box = this.log.querySelector<HTMLElement>('.mn-sugs');
    box?.classList.add('loading');
    try {
      const r = await A.refreshSuggestions();
      sugCache = { own: r.own, ai: r.ai };
      this.fillSugs('global', true);
      if (!r.fresh) toast(t('{mnemo} could not write new ones just now. Check the model in Settings.', { mnemo: A.MNEMO }), 'info');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      b.disabled = false;
      b.classList.remove('busy');
      label.textContent = t('Fresh ideas');
      this.log.querySelector('.mn-sugs')?.classList.remove('loading');
    }
  }

  /** Your own suggestions: one per line, kept until you change them (Fresh ideas leaves them). */
  private editOwnSugs(): void {
    const body = el(
      'div',
      'mn-own-sugs',
      `<p>${t('One per line. They show among the suggestions on a new chat, marked Yours, and stay until you change them.')}</p><textarea rows="8" placeholder="${t('Summarise my meeting notes from this week')}&#10;${t('What should I write about next?')}"></textarea>`,
    );
    const ta = body.querySelector('textarea')!;
    ta.value = (sugCache?.own || []).join('\n');
    Modal.open({
      title: t('Your suggestions'),
      body,
      actions: [
        { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
        {
          label: t('Save'),
          cls: 'primary',
          run: async () => {
            try {
              const r = await A.saveSuggestions(ta.value.split('\n'));
              sugCache = { own: r.own, ai: sugCache?.ai || [] };
              Modal.close();
              this.fillSugs('global');
              toast(t('Suggestions saved'), 'ok');
            } catch (e) {
              toast((e as Error).message, 'err');
            }
          },
        },
      ],
    });
    window.setTimeout(() => ta.focus(), 30);
  }

  // ---- transcript ----

  private renderAll(): void {
    closePreview();
    this.dropHeld();
    this.log.innerHTML = '';
    this.agents.reset();
    if (!this.messages.length) {
      this.sessionPlan = [];
      this.showPlan(null);
      this.paintEmpty();
      return;
    }
    let turn: HTMLElement | null = null;
    let tokens = { in: 0, out: 0, model: '' };
    let lastUser = 0;
    let lastModel = '';
    const finishTurn = (): void => {
      if (turn) this.finishAct(turn.querySelector<HTMLElement>('.mn-tb')!);
      if (turn) this.footer(turn, tokens.model, tokens.in, tokens.out);
      tokens = { in: 0, out: 0, model: '' };
    };
    for (const m of this.messages) {
      if (m.role === 'user' && m.meta?.steer === true && turn) {
        turn.querySelector<HTMLElement>('.mn-tb')!.append(el('div', 'mn-steer', `${icon('enter')}<span>${esc(m.content)}</span>`));
        continue;
      }
      if (m.role === 'user') {
        finishTurn();
        turn = null;
        const ub = this.userBubble(m.content, m.created_at, (m.meta?.attach as A.Attach[] | undefined) || []);
        ub.dataset.mid = String(m.id);
        lastUser = m.id;
        this.log.append(ub);
        continue;
      }
      if (m.role === 'assistant' && m.meta?.compact === true) {
        finishTurn();
        turn = null;
        this.log.append(this.compactNote(Number(m.meta.messages || 0), m.content));
        continue;
      }
      if (!turn) {
        turn = this.turnEl();
        if (lastUser) turn.dataset.uid = String(lastUser);
        this.log.append(turn);
      }
      const body = turn.querySelector<HTMLElement>('.mn-tb')!;
      if (m.role === 'assistant') {
        const meta = m.meta || {};
        // Another model took over: a divider says which (inside the reply when it changed
        // mid-way, as after a fallback).
        if (typeof meta.model === 'string' && meta.model) {
          if (lastModel && meta.model !== lastModel) {
            const why = typeof meta.fallback_from === 'string' ? t('took over: {model} did not answer', { model: A.modelLabel(A.mnemoState(), meta.fallback_from) }) : '';
            if (body.childElementCount) body.append(this.modelLine(meta.model, why));
            else turn.before(this.modelLine(meta.model, why));
          }
          lastModel = meta.model;
        }
        if (typeof meta.model === 'string') tokens.model = meta.model;
        tokens.in += Number(meta.input_tokens || 0);
        tokens.out += Number(meta.output_tokens || 0);
        if (typeof meta.error === 'string') body.append(this.errorCard(meta.error));
        if (typeof meta.thinking === 'string' && meta.thinking) {
          this.thought(body, meta.thinking);
          // Each stored reply's thinking is its own segment.
          body.querySelector('.mn-act .mn-tools')!.append(el('span', 'mn-seg-end'));
        }
        if (m.content) {
          const md = el('div', 'mn-md');
          md.innerHTML = renderReply(m.content);
          mountArt(md);
          md.dataset.raw = m.content;
          md.dataset.mid = String(m.id);
          body.append(md);
        }
        for (const c of m.tool_calls || []) {
          if (c.name === ASK) body.append(askEl({ id: c.id, ...(askOf(c.arguments) || { question: '', options: [], allow_other: true }) }, answerTo(this.messages, c.id)));
          else if (OWNER_MEMORY.has(c.name)) body.append(memLine(c.id, c.name, c.arguments));
          else if (c.name === DELEGATE) subCard(body, c.id, c.arguments, this.agents);
          else if (c.name !== SHOW) this.toolCard(body, c.id, c.name, c.arguments);
        }
      } else if (m.role === 'tool' && m.tool_name === DELEGATE) {
        const sc = this.agents.byId(m.tool_call_id || '');
        // One in the background answered later (in an agents wait).
        if (sc && !(parseOut(m.content) as A.SubResult | null)?.background) subFinal(sc, m.content, m.meta?.ok !== false);
      } else if (m.role === 'tool' && m.tool_name === AGENTS) {
        this.agentResults(m.content);
        const card = body.querySelector<HTMLElement>(`.mn-tool[data-id="${CSS.escape(m.tool_call_id || '')}"]`);
        const meta = m.meta || {};
        if (card) this.endTool(card, meta.ok !== false, String(meta.summary || ''), Number(meta.ms || 0), m.content);
      } else if (m.role === 'tool' && m.tool_name && OWNER_MEMORY.has(m.tool_name)) {
        if (m.meta?.ok === false) endMemLine(body, m.tool_call_id || '', false);
      } else if (m.role === 'tool' && m.tool_name === ASK) {
        /* the question card stands for it */
      } else if (m.role === 'tool' && m.tool_name === SHOW) {
        try {
          const shown = (JSON.parse(m.content) as { shown?: A.Shown[] }).shown || [];
          if (shown.length) {
            body.append(cardsEl(shown));
            wireBoards(body);
          }
        } catch {
          /* an old or failed call: nothing to show */
        }
      } else if (m.role === 'tool') {
        const card = body.querySelector<HTMLElement>(`.mn-tool[data-id="${CSS.escape(m.tool_call_id || '')}"]`);
        const meta = m.meta || {};
        if (card) this.endTool(card, meta.ok !== false, String(meta.summary || ''), Number(meta.ms || 0), m.content);
      }
    }
    finishTurn();
    // The chat's plan as the server keeps it (a stopped reply left it as it was).
    this.showPlan(this.sessionPlan.length ? this.sessionPlan : null);
    // A stored task with no result: the reply was stopped while it ran.
    this.agents.apply(this.agentsInfo);
    this.agents.cards().forEach((c) => subStop(c));
    this.shownModel = lastModel;
    // Number the versions of each page across the whole chat.
    mountArt(this.log);
    // Notes in the chat that put boards in get a small board badge (questions' chips included).
    markNoteBoards(this.log);
    // A long chat keeps only its latest questions in the page; the rest wait until needed.
    this.holdOld();
    this.scrollEnd(true);
    this.paintRail();
    requestAnimationFrame(() => this.log.querySelectorAll<HTMLElement>('.mn-car').forEach(syncCarousel));
  }

  // ---- long chats: the older part waits outside the page ----

  /** Questions (with their replies) kept in the page when a long chat opens. */
  private static KEEP_Q = 16;
  /** Questions brought back at a time when scrolling up. */
  private static MORE_Q = 12;
  /** The older part of a long chat, oldest first: drawn already, but not in the page, so
   *  hundreds of messages never weigh on scrolling and live replies. */
  private held: HTMLElement[] = [];
  private moreEl: HTMLElement | null = null;
  private moreIO: IntersectionObserver | null = null;

  /** Forget the older part (the log is drawn again or cleared). */
  private dropHeld(): void {
    this.held = [];
    this.moreIO?.disconnect();
    this.moreEl = null;
  }

  private holdOld(): void {
    const kids = Array.from(this.log.children) as HTMLElement[];
    const us = kids.filter((k) => k.classList.contains('mn-u'));
    // Not worth it for a short chat.
    if (us.length <= ChatView.KEEP_Q + 6) return;
    const cut = kids.indexOf(us[us.length - ChatView.KEEP_Q]);
    this.held = kids.slice(0, cut);
    this.held.forEach((k) => k.remove());
    this.paintMore();
  }

  /** Every question of the chat, in the page or waiting outside it, in order. */
  private users(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const h of this.held) if (h.classList.contains('mn-u')) out.push(h);
    this.log.querySelectorAll<HTMLElement>(':scope > .mn-u').forEach((u) => out.push(u));
    return out;
  }

  /** How many questions wait outside the page. */
  private heldQ(): number {
    return this.held.filter((h) => h.classList.contains('mn-u')).length;
  }

  /** Find elements in the whole chat, the part outside the page included. */
  findAll(sel: string): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const h of this.held) {
      if (h.matches(sel)) out.push(h);
      h.querySelectorAll<HTMLElement>(sel).forEach((x) => out.push(x));
    }
    this.log.querySelectorAll<HTMLElement>(sel).forEach((x) => out.push(x));
    return out;
  }

  /** The line at the top of a long chat: how much is above, and a button to show it; it
   *  also brings the next part in by itself as it scrolls into view. */
  private paintMore(): void {
    const n = this.heldQ();
    if (!this.held.length) {
      this.moreEl?.remove();
      this.moreEl = null;
      return;
    }
    if (!this.moreEl) {
      this.moreEl = el('button', 'mn-more');
      this.moreEl.setAttribute('type', 'button');
      this.moreEl.addEventListener('click', () => this.unhold());
      if (typeof IntersectionObserver !== 'undefined') {
        this.moreIO?.disconnect();
        this.moreIO = new IntersectionObserver(
          (es) => {
            if (es.some((e) => e.isIntersecting) && this.held.length && this.log.scrollTop > 0) this.unhold(undefined, true);
          },
          { root: this.log, rootMargin: '400px 0px 0px 0px' },
        );
      }
    }
    this.moreEl.innerHTML = `${icon('chev-up')}<span>${tn(n, 'Show {n} earlier question', 'Show {n} earlier questions')}</span>`;
    if (this.moreEl.parentElement !== this.log) {
      this.log.prepend(this.moreEl);
      this.moreIO?.observe(this.moreEl);
    }
  }

  /** Bring the older part back into the page: up to `upTo` (an element in it, or inside one
   *  of its parts) and everything after it, or the next few questions. The view stays put. */
  private unhold(upTo?: HTMLElement, auto = false): void {
    if (!this.held.length) return;
    let start = this.held.length;
    if (upTo) {
      const i = this.held.findIndex((h) => h === upTo || h.contains(upTo));
      if (i < 0) return;
      start = i;
    } else {
      let n = 0;
      while (start > 0 && n < ChatView.MORE_Q) {
        start--;
        if (this.held[start].classList.contains('mn-u')) n++;
      }
      // Take the whole first question with what came before it.
      if (this.held.slice(0, start).every((h) => !h.classList.contains('mn-u'))) start = 0;
    }
    const part = this.held.splice(start);
    const anchor = this.moreEl ? this.moreEl.nextSibling : this.log.firstChild;
    const h0 = this.log.scrollHeight;
    const top = this.log.scrollTop;
    const frag = document.createDocumentFragment();
    part.forEach((p) => frag.append(p));
    this.log.insertBefore(frag, anchor);
    // Boards left open in that part come back live, and note cards get their line of text,
    // before the scroll position is set again.
    part.forEach((p) => {
      wireBoards(p);
      fillExcerpts(p);
      markNoteBoards(p);
    });
    this.paintMore();
    this.log.scrollTop = top + (this.log.scrollHeight - h0);
    this.paintRail();
    // Scrolling up on its own: still near the top after a short part, bring the next one.
    if (auto) requestAnimationFrame(() => {
      if (this.held.length && this.log.scrollTop < 400) this.unhold(undefined, true);
    });
    requestAnimationFrame(() => part.forEach((p) => p.querySelectorAll<HTMLElement>('.mn-car').forEach(syncCarousel)));
  }

  /** Where older messages were folded into a summary (open it to read the summary). */
  private compactNote(n: number, summary: string, t0 = 0): HTMLElement {
    const d = el('details', 'mn-compact');
    const took = t0 ? Math.max(1, Math.round((performance.now() - t0) / 1000)) : 0;
    d.innerHTML = `<summary title="${n ? t('Open to read the summary') : ''}"><span>${icon('refresh')}${n ? t('Compacted') : t('Compacting…')}${
      took ? `<em class="mn-compact-t">${took}s</em>` : ''
    }</span></summary>${summary ? `<div class="mn-md mn-compact-b">${renderReply(summary)}</div>` : ''}`;
    return d;
  }

  /** While the older messages are being summarised: a working divider with a clock. */
  private compactLive(): HTMLElement {
    this.log.querySelector('.mn-compact.live')?.remove();
    const d = el('div', 'mn-compact live');
    const t0 = performance.now();
    d.dataset.t0 = String(t0);
    d.setAttribute('role', 'status');
    d.innerHTML = `<div class="mn-compact-s"><span><i class="mn-compact-spin" aria-hidden="true"></i><b>${t('Compacting conversation')}</b><em class="mn-compact-t">0s</em></span></div>
      <p class="mn-compact-why">${t("The chat filled {mnemo}'s memory for this model, so the older messages are being folded into a summary. The reply continues right after.", { mnemo: A.MNEMO })}</p>`;
    const tick = window.setInterval(() => {
      if (!d.isConnected) return window.clearInterval(tick);
      d.querySelector('.mn-compact-t')!.textContent = `${Math.round((performance.now() - t0) / 1000)}s`;
    }, 1000);
    return d;
  }

  private userBubble(text: string, ts?: number, att: A.Attach[] = []): HTMLElement {
    const b = el('div', 'mn-u');
    // What came with the message, in the order it was attached: pictures as tiles (tap for
    // the full view), notes and folders as chips; one row that slides left and right.
    const chips = att.length
      ? `<div class="mn-u-att">${carouselHTML(
          att
            .map((a) =>
              a.kind === 'image'
                ? `<button type="button" class="mn-u-img" data-img="${attr(a.path)}" title="${attr(a.title)}" aria-label="${attr(t('Image {name}', { name: a.title }))}"><img alt="" loading="lazy" src="/api/assistant/uploads/${attr(
                    a.path,
                  )}" onerror="this.parentElement.classList.add('gone')"><span>${esc(a.title)}</span></button>`
                : `<span class="mn-att-c sm${a.kind === 'note' && isBoard(a.path) ? ' is-kb' : ''}"${a.kind === 'note' ? ` data-note="${attr(a.path)}" role="button" tabindex="0"` : ''} title="${attr(a.path || t('All notes'))}">${icon(
                    a.kind === 'note' ? noteIc(a.path) : 'folder',
                  )}<span>${esc(a.title)}</span></span>`,
            )
            .join(''),
        )}</div>`
      : '';
    // Under the bubble, along its right edge: when it was sent, then copy and try again.
    b.innerHTML = `${chips}<div class="mn-ub">${esc(text)}</div><div class="mn-u-act">${
      ts ? `<time title="${attr(new Date(ts * 1000).toLocaleString())}">${esc(relTs(ts))}</time>` : ''
    }<span class="mn-u-btns"><button type="button" class="mn-ibtn" data-copy-u title="${t('Copy the message')}" aria-label="${t('Copy the message')}">${icon(
      'copy',
    )}</button><button type="button" class="mn-ibtn" data-retry title="${t('Try again: send this message again')}" aria-label="${t('Try again')}">${icon('refresh')}</button></span></div>`;
    return b;
  }

  private turnEl(): HTMLElement {
    return el('div', 'mn-turn', `<div class="mn-av" aria-hidden="true">${markHTML('sm')}</div><div class="mn-tb"></div>`);
  }

  /** A failed reply: a short plain message and Try again; the provider's full error only on request. */
  private errorCard(msg: string): HTMLElement {
    const f = friendlyError(msg);
    const full = plainError(msg);
    const more = full && full !== f.text ? full : '';
    return el(
      'div',
      'mn-err',
      `${icon('alert')}<span class="mn-err-t">${esc(f.text)}</span><span class="mn-err-a"><button type="button" class="btn sm" data-retry>${icon('refresh')}<span>${t('Try again')}</span></button>${
        f.setup ? `<button type="button" class="btn ghost sm" data-setup>${t('Open settings')}</button>` : ''
      }</span>${more ? `<details class="mn-err-d"><summary>${t('Show the full error')}</summary><pre>${esc(more)}</pre></details>` : ''}`,
    );
  }

  /** The turn's Activity block: every step Mnemo takes, live, then a summary. */
  private act(body: HTMLElement): HTMLElement {
    let a = body.querySelector<HTMLElement>(':scope > .mn-act');
    if (!a) {
      a = el('details', 'mn-act live');
      // Closed unless the owner opens it: the title says what is happening meanwhile.
      a.innerHTML = `<summary><span class="mn-act-ic"><i class="mn-spin"></i></span><span class="mn-act-t"><b>${t('Working')}</b><small></small></span>${icon(
        'chev',
        'i mn-act-chev',
      )}</summary><div class="mn-act-b"><div class="mn-tools"></div><div class="mn-act-notes"></div></div>`;
      body.prepend(a);
      ACTS.set(a, { steps: 0, ms: 0, failed: 0, read: new Set(), changed: new Set(), thought: false });
    }
    return a;
  }

  /** Close the Activity block: what Mnemo did, how long it took and the notes it touched. */
  private finishAct(body: HTMLElement, elapsed?: number): void {
    const a = body.querySelector<HTMLElement>(':scope > .mn-act');
    const st = a && ACTS.get(a);
    if (!a || !st) return;
    a.classList.remove('live');
    const changed = Array.from(st.changed);
    const read = Array.from(st.read).filter((p) => !st.changed.has(p));
    const time = elapsed ?? st.ms;
    const title = changed.length
      ? tn(changed.length, 'Changed {n} note', 'Changed {n} notes')
      : read.length
        ? tn(read.length, 'Looked at {n} note', 'Looked at {n} notes')
        : st.steps
          ? tn(st.steps, 'Used {n} tool', 'Used {n} tools')
          : t('Thought it through');
    const bits = [st.steps ? tn(st.steps, '{n} step', '{n} steps') : st.thought ? t('thinking') : '', read.length ? t('read {n}', { n: read.length }) : '', changed.length ? t('changed {n}', { n: changed.length }) : '', st.failed ? t('{n} failed', { n: st.failed }) : '', time ? (time < 1000 ? `${time} ms` : `${(time / 1000).toFixed(1)} s`) : '']
      .filter(Boolean)
      .join(' · ');
    a.querySelector('.mn-act-ic')!.innerHTML = icon(st.failed && !changed.length && !read.length ? 'alert' : 'check');
    a.querySelector('.mn-act-t')!.innerHTML = `<b>${esc(title)}</b><small>${esc(bits)}</small>`;
    a.classList.toggle('bad', st.failed > 0);
    const chip = (p: string, w: boolean): string => {
      const path = resolveNote(p) || p;
      const kb = isBoard(path);
      return `<span class="mn-att-c sm${w ? ' w' : ''}${kb ? ' is-kb' : ''}" data-note="${attr(path)}" role="button" tabindex="0" title="${attr(path)}">${icon(kb ? 'kanban' : w ? 'edit' : 'note')}<span>${esc(
        noteTitle(path) || path.split('/').pop()!.replace(/\.md$/i, ''),
      )}</span></span>`;
    };
    const notes = a.querySelector<HTMLElement>('.mn-act-notes')!;
    notes.innerHTML =
      changed.length || read.length
        ? `${changed.length ? `<div><b>${t('Changed')}</b>${changed.map((p) => chip(p, true)).join('')}</div>` : ''}${read.length ? `<div><b>${t('Read')}</b>${read.slice(0, 24).map((p) => chip(p, false)).join('')}${read.length > 24 ? `<small>${t('+{n} more', { n: read.length - 24 })}</small>` : ''}</div>` : ''}`
        : '';
  }

  /** Add thinking to the Activity block (a new segment after each tool call). */
  private thought(body: HTMLElement, text: string): void {
    const a = this.act(body);
    const steps = a.querySelector<HTMLElement>('.mn-tools')!;
    let seg = steps.lastElementChild as HTMLElement | null;
    if (!seg || !seg.classList.contains('mn-thought')) {
      seg = el('div', 'mn-thought', `<div class="mn-thought-t"></div>`);
      steps.append(seg);
    }
    const tx = seg.querySelector<HTMLElement>('.mn-thought-t')!;
    tx.textContent = (tx.textContent || '') + text;
    const st = ACTS.get(a)!;
    st.thought = true;
    const live = a.querySelector<HTMLElement>('.mn-act-t small');
    if (live && a.classList.contains('live')) {
      const lines = (tx.textContent || '').trim().split(/\n+/);
      live.textContent = lines[lines.length - 1].slice(-140);
      a.querySelector<HTMLElement>('.mn-act-t b')!.textContent = t('Thinking');
    }
  }

  private toolCard(body: HTMLElement, id: string, name: string, args: unknown): HTMLElement {
    const a = this.act(body);
    const tb = a.querySelector<HTMLElement>('.mn-act-t b');
    if (tb && a.classList.contains('live')) tb.textContent = t('Working');
    const stack = a.querySelector<HTMLElement>('.mn-tools')!;
    const st = ACTS.get(a)!;
    st.steps++;
    for (const p of touchedPaths(args)) (changesNotes(name) ? st.changed : st.read).add(p);
    const [title, sub] = toolTitle(name, args);
    const live = a.querySelector<HTMLElement>('.mn-act-t small');
    if (live && a.classList.contains('live')) live.textContent = `${title}${sub ? ' ' + sub : ''}…`;
    const d = el('details', 'mn-tool run' + (changesNotes(name) ? ' w' : ''));
    d.dataset.id = id;
    d.dataset.name = name;
    const ic = name === 'delegate' || name === 'agents' ? 'agents' : name === 'describe_image' || name === 'generate_image' ? 'image' : changesNotes(name) ? 'edit' : 'search';
    d.innerHTML = `<summary><span class="mn-tool-ic">${icon(ic)}</span><span class="mn-tool-t"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="mn-tool-s"><i class="mn-spin"></i></span>${icon('chev', 'i mn-tool-chev')}</summary>
      <div class="mn-tool-b"><div class="mn-tool-k">${esc(name)}</div><pre>${esc(pretty(args, 1200))}</pre></div>`;
    stack.append(d);
    return d;
  }

  private endTool(card: HTMLElement, ok: boolean, summary: string, ms: number, output?: unknown): void {
    card.classList.remove('run');
    card.classList.add(ok ? 'ok' : 'err');
    const a = card.closest<HTMLElement>('.mn-act');
    const st = a && ACTS.get(a);
    if (st) {
      st.ms += ms;
      if (!ok) st.failed++;
    }
    const s = card.querySelector<HTMLElement>('.mn-tool-s')!;
    const bits = [ts(summary), ms ? (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`) : ''].filter(Boolean).join(' · ');
    s.innerHTML = `${ok ? icon('check') : icon('alert')}<span>${esc(bits || (ok ? t('Done') : t('Failed')))}</span>`;
    if (output !== undefined && output !== null && output !== '') this.toolResult(card, output);
  }

  /** A finished tool's result in its card: a sub-agent's answer, what an image shows, the
   *  picture made (also shown in the reply, where it can be opened); raw JSON otherwise. */
  private toolResult(card: HTMLElement, output: unknown): void {
    if (card.dataset.filled) return;
    card.dataset.filled = '1';
    const b = card.querySelector('.mn-tool-b')!;
    const name = card.dataset.name || '';
    const o = RICH.has(name) ? parseOut(output) : null;
    const err = o && typeof o.error === 'string' ? o.error : '';
    const model = o && typeof o.model === 'string' && o.model ? ` · ${A.modelLabel(A.mnemoState(), o.model)}` : '';
    if (o && !err && name === 'describe_image' && typeof o.text === 'string') {
      b.insertAdjacentHTML('beforeend', `<div class="mn-tool-k">${t('What it shows')}${esc(model)}</div><div class="mn-md mn-tool-ans">${renderReply(o.text)}</div>`);
      return;
    }
    if (o && !err && name === 'generate_image' && typeof o.upload === 'string' && o.upload) {
      const nm = typeof o.name === 'string' ? o.name : t('Image');
      const src = `/api/assistant/uploads/${encodeURIComponent(o.upload)}`;
      const tile = (cls: string): string =>
        `<button type="button" class="${cls}" data-img="${attr(o.upload as string)}" title="${attr(nm)}" aria-label="${attr(t('Open {name}', { name: nm }))}"><img alt="" loading="lazy" src="${attr(
          src,
        )}" onerror="this.parentElement.classList.add('gone')"></button>`;
      b.insertAdjacentHTML('beforeend', `<div class="mn-tool-k">${t('Picture')}${esc(model)}</div>${tile('mn-gen sm')}`);
      const body = card.closest<HTMLElement>('.mn-tb');
      if (body && !body.querySelector(`.mn-gen:not(.sm)[data-img="${CSS.escape(o.upload)}"]`)) body.append(el('div', 'mn-gen-row', tile('mn-gen')));
      return;
    }
    if (err) {
      b.insertAdjacentHTML('beforeend', `<div class="mn-tool-k">${t('Error')}</div><pre>${esc(ts(err))}</pre>`);
      return;
    }
    b.insertAdjacentHTML('beforeend', `<div class="mn-tool-k">${t('Result')}</div><pre>${esc(pretty(output))}</pre>`);
  }

  /** Boards the turn names (mentioned in its question, linked in the reply, used by a kanban
   *  tool) as board cards under the reply; boards Mnemo handed over as cards already show. */
  private turnBoards(turn: HTMLElement): void {
    const body = turn.querySelector<HTMLElement>('.mn-tb')!;
    const old = body.querySelector<HTMLElement>(':scope > .mn-kbs');
    old?.remove();
    let u = turn.previousElementSibling as HTMLElement | null;
    while (u && !u.classList.contains('mn-u') && !u.classList.contains('mn-turn')) u = u.previousElementSibling as HTMLElement | null;
    const asked = u?.classList.contains('mn-u') ? Array.from(u.querySelectorAll<HTMLElement>('.mn-u-att [data-note]')).map((c) => c.dataset.note || '') : [];
    const linked = Array.from(body.querySelectorAll<HTMLElement>('.mn-md .mn-wl[data-note]')).map((a) => a.dataset.note || '');
    const a = body.querySelector<HTMLElement>(':scope > .mn-act');
    const st = a ? ACTS.get(a) : undefined;
    const used = [...(st?.changed || []), ...(st?.read || [])].map((p) => resolveNote(p) || p);
    const shown = new Set(Array.from(body.querySelectorAll<HTMLElement>('.mn-kb[data-kb]')).map((c) => c.dataset.kb || ''));
    const paths = boardPaths([...asked, ...linked, ...used], shown).slice(0, 4);
    if (!paths.length) return;
    const at = body.querySelector(':scope > .mn-rel, :scope > .mn-foot');
    if (at) at.insertAdjacentHTML('beforebegin', boardsHTML(paths));
    else body.insertAdjacentHTML('beforeend', boardsHTML(paths));
    wireBoards(body.querySelector<HTMLElement>(':scope > .mn-kbs')!);
  }

  /** Results that came after the live reply (answers, pictures) from the stored chat. */
  private fillResults(messages: A.Message[]): void {
    for (const m of messages) {
      if (m.role === 'tool' && m.tool_name === DELEGATE && m.tool_call_id) {
        const sc = this.agents.byId(m.tool_call_id);
        if (sc && !sc.dataset.filled) subFinal(sc, m.content, m.meta?.ok !== false);
        continue;
      }
      if (m.role !== 'tool' || !m.tool_name || !RICH.has(m.tool_name) || !m.tool_call_id) continue;
      const card = this.log.querySelector<HTMLElement>(`.mn-tool[data-id="${CSS.escape(m.tool_call_id)}"]`);
      if (card && !card.dataset.filled) this.toolResult(card, m.content);
    }
  }

  private footer(turn: HTMLElement, model: string, tin: number, tout: number): void {
    const body = turn.querySelector<HTMLElement>('.mn-tb')!;
    body.querySelector('.mn-foot')?.remove();
    body.querySelector(':scope > .mn-rel')?.remove();
    this.turnBoards(turn);
    const rel = relatedHTML(body);
    if (rel) {
      body.insertAdjacentHTML('beforeend', rel);
      requestAnimationFrame(() => body.querySelectorAll<HTMLElement>(':scope > .mn-rel .mn-car').forEach(syncCarousel));
    }
    markNoteBoards(body);
    const raw = Array.from(body.querySelectorAll<HTMLElement>('.mn-md'))
      .map((x) => x.dataset.raw || '')
      .join('\n\n')
      .trim();
    const bits = [model ? A.modelLabel(A.mnemoState(), model) : '', tin || tout ? t('{tin} in · {tout} out', { tin: A.fmtTokens(tin), tout: A.fmtTokens(tout) }) : ''].filter(Boolean);
    const f = el(
      'div',
      'mn-foot',
      // Actions first (where the eye ends after reading), then what answered and its cost.
      `<span class="mn-foot-a">${
        raw
          ? `<button type="button" class="mn-ibtn" data-copy title="${t('Copy the reply')}" aria-label="${t('Copy the reply')}">${icon('copy')}</button><button type="button" class="mn-ibtn mn-listen" data-listen title="${t('Listen')}" aria-label="${t('Listen to the reply')}">${icon(
              'volume',
            )}</button>`
          : ''
      }<button type="button" class="mn-ibtn" data-regen title="${t('Regenerate this reply')}" aria-label="${t('Regenerate this reply')}">${icon('refresh')}</button></span>${
        bits.length ? `<span class="mn-foot-m">${bits.map((b) => `<span>${esc(b)}</span>`).join('<i></i>')}</span>` : ''
      }`,
    );
    if (raw) f.dataset.raw = raw;
    body.append(f);
  }

  private scrollEnd(force = false): void {
    const fromEnd = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight;
    if (force || fromEnd < 140) {
      this.log.scrollTop = this.log.scrollHeight;
      // At the end now: the button goes at once (setting scrollTop to where it already is
      // fires no scroll event, so this cannot wait for one).
      this.paintDown(0);
    } else this.paintDown(fromEnd);
  }

  /** Re-check the scroll-to-bottom button once per frame, after layout settles. */
  private queueDown(): void {
    if (this.downFrame) return;
    this.downFrame = requestAnimationFrame(() => {
      this.downFrame = 0;
      this.paintDown(this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight);
    });
  }

  /** The scroll-to-bottom button: shown only while the end is well out of sight, about half a
   *  screen away (never under 140px), so sub-pixel scroll positions on high-DPI and mobile
   *  screens, a reply that grows by a line or the keyboard opening never bring it up. */
  private paintDown(fromEnd: number): void {
    const h = this.log.clientHeight;
    const show = h > 0 && fromEnd > Math.max(140, Math.min(h * 0.5, 420));
    if (show === this.downBtn.classList.contains('on')) return;
    this.downBtn.classList.toggle('on', show);
    this.downBtn.tabIndex = show ? 0 : -1;
    // Hidden while focused (it reached the end): focus goes back to the message box.
    if (!show && document.activeElement === this.downBtn) this.input.focus({ preventScroll: true });
  }

  /** Open the Agents panel (the page's panel, or a dialog in the small chat), at `ids`. */
  openAgents(ids: string[] = []): void {
    if (this.o.openAgents) this.o.openAgents();
    else Modal.open({ title: t('Agents'), body: this.agents.el, wide: true });
    requestAnimationFrame(() => this.agents.reveal(ids));
  }

  /** Clicks in the Agents panel: a sub-agent's model, its whole task, links in its answer. */
  private onAgentsClick(e: MouseEvent): void {
    const tg = e.target as HTMLElement;
    const subModel = tg.closest<HTMLElement>('[data-submodel]');
    if (subModel) {
      const card = subModel.closest<HTMLElement>('.mn-sub');
      if (card) void this.pickSubModel(card, subModel);
      return;
    }
    const task = tg.closest<HTMLElement>('[data-subtask]');
    if (task) {
      const open = task.getAttribute('aria-expanded') !== 'true';
      task.setAttribute('aria-expanded', String(open));
      task.title = open ? t('Show less') : t('Show the whole task');
      return;
    }
    if (tg.closest('.mn-md, [data-img]')) this.onLogClick(e);
  }

  private onLogClick(e: MouseEvent): void {
    const tg = e.target as HTMLElement;
    const skill = tg.closest<HTMLElement>('[data-skill]');
    if (skill) {
      this.prefill(skill.dataset.skill || '');
      return;
    }
    const amaze = tg.closest<HTMLButtonElement>('[data-amaze]');
    if (amaze) {
      void this.amaze(amaze);
      return;
    }
    if (tg.closest('[data-own-sugs]')) {
      this.editOwnSugs();
      return;
    }
    const sug = tg.closest<HTMLElement>('[data-sug]');
    if (sug) {
      this.prefill(sug.dataset.sug || '', true);
      return;
    }
    if (tg.closest('[data-setup]')) {
      openMnemoSettings();
      return;
    }
    // Links in a reply: the app's Docs open in place, other sites in a new tab.
    const link = tg.closest<HTMLAnchorElement>('.mn-md a[href]');
    if (link && !link.dataset.note) {
      const href = link.getAttribute('href') || '';
      const doc = /^\/docs(?:\/([^#?]+))?(?:#(.+))?$/.exec(href);
      if (doc) {
        e.preventDefault();
        openDocs(decodeURIComponent(doc[1] || ''), decodeURIComponent(doc[2] || ''));
        return;
      }
      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        window.open(href, '_blank', 'noopener');
        return;
      }
    }
    const wl = tg.closest<HTMLElement>('[data-note]');
    if (wl) {
      e.preventDefault();
      hooks.openNote(wl.dataset.note!);
      return;
    }
    // A question from Mnemo: an option answers it; Other lets the owner type the answer.
    const opt = tg.closest<HTMLElement>('[data-ask-opt]');
    if (opt && !this.busy) {
      const card = opt.closest<HTMLElement>('.mn-ask')!;
      if (card.classList.contains('done')) return;
      const id = card.dataset.ask!;
      if (opt.dataset.askOpt === 'other') {
        // Other: a box to type the answer opens right in the card.
        const f = card.querySelector<HTMLFormElement>('.mn-ask-f')!;
        f.hidden = false;
        opt.classList.add('on');
        f.querySelector<HTMLInputElement>('input')!.focus();
        return;
      }
      card.classList.add('done');
      opt.classList.add('on');
      void this.send(opt.dataset.label || opt.textContent || '', { to: id, approve: opt.dataset.approve === '1' });
      return;
    }
    // Carousel arrows, and a picture of a message opened full size (with its neighbours).
    const arrow = tg.closest<HTMLElement>('[data-car]');
    if (arrow) {
      const row = arrow.closest('.mn-car')?.querySelector<HTMLElement>('.mn-car-row');
      row?.scrollBy({ left: (arrow.dataset.car === 'l' ? -1 : 1) * row.clientWidth * 0.8, behavior: 'smooth' });
      return;
    }
    const tile = tg.closest<HTMLElement>('[data-img]');
    if (tile) {
      const tiles = Array.from(tile.closest('.mn-car-row')?.querySelectorAll<HTMLElement>('[data-img]:not(.gone)') || [tile]);
      const set = tiles.map((x) => ({ src: `/api/assistant/uploads/${x.dataset.img}`, caption: x.title }));
      openLightbox(`/api/assistant/uploads/${tile.dataset.img}`, tile.title, set, Math.max(0, tiles.indexOf(tile)));
      return;
    }
    // A card Mnemo handed over: open the note, the folder, the image or the vault.
    const cd = tg.closest<HTMLElement>('[data-card]');
    if (cd) {
      openShown(cd.dataset.card || '', cd.dataset.path || '');
      return;
    }
    // Touch screens: a tap on a message of yours shows its time, Copy and Try again.
    const ubub = tg.closest<HTMLElement>('.mn-ub');
    if (ubub && matchMedia('(hover: none)').matches) {
      const u = ubub.closest<HTMLElement>('.mn-u')!;
      const on = !u.classList.contains('show-act');
      this.log.querySelectorAll('.mn-u.show-act').forEach((x) => x.classList.remove('show-act'));
      u.classList.toggle('show-act', on);
      return;
    }
    const again = tg.closest<HTMLElement>('[data-regen],[data-retry]');
    if (again) {
      const own = again.closest<HTMLElement>('.mn-u');
      let uid = Number(own?.dataset.mid || again.closest<HTMLElement>('.mn-turn')?.dataset.uid || 0);
      // A turn that has not learnt its id yet: it belongs to the last message.
      if (!uid) uid = [...this.messages].reverse().find((m) => m.role === 'user')?.id || 0;
      void this.rerun(uid);
      return;
    }
    const copyU = tg.closest<HTMLElement>('[data-copy-u]');
    if (copyU) {
      const text = copyU.closest('.mn-u')?.querySelector('.mn-ub')?.textContent || '';
      void navigator.clipboard?.writeText(text).then(
        () => toast(t('Message copied'), 'ok'),
        () => toast(t('Could not copy'), 'err'),
      );
      return;
    }
    // The one line a group of sub-agents leaves in the reply: open the Agents panel there.
    const team = tg.closest<HTMLElement>('.mn-team-line');
    if (team && this.log.contains(team)) {
      this.openAgents(teamIds(team));
      return;
    }
    // A notice with something to do about it: set a model for a job, or switch this chat's.
    const act = tg.closest<HTMLElement>('[data-notice-open]');
    if (act) {
      if (act.dataset.noticeOpen === 'model') this.select?.open();
      else openMnemoSettings('jobs');
      return;
    }
    const hear = tg.closest<HTMLElement>('[data-listen]');
    if (hear) {
      void listen(hear);
      return;
    }
    if (tg.closest('[data-seemem]')) {
      openMnemoSettings('memory');
      return;
    }
    const copy = tg.closest<HTMLElement>('[data-copy]');
    if (copy) {
      const raw = copy.closest<HTMLElement>('.mn-foot')?.dataset.raw || '';
      void navigator.clipboard?.writeText(raw).then(
        () => toast(t('Reply copied'), 'ok'),
        () => toast(t('Could not copy'), 'err'),
      );
      return;
    }
    const code = tg.closest<HTMLElement>('[data-copy-code]');
    if (code) {
      const text = code.closest('.dc-code')?.querySelector('pre')?.textContent || '';
      void navigator.clipboard?.writeText(text).then(() => {
        code.textContent = t('Copied');
        window.setTimeout(() => (code.textContent = t('Copy')), 1500);
      });
    }
  }

  // ---- sending ----

  /** The owner pressed Stop: end the reply on the server too. */
  /** Stop the reply: what it wrote so far stays, and the next queued message goes out. The
   *  stream ends by itself once the server stopped it (cut loose after a few seconds). */
  stop(): void {
    if (!this.busy || !this.session) return;
    const ctrl = this.ctrl;
    this.stopping = true;
    this.paintSend();
    void A.stopChat(this.session.id).then(
      (r) => {
        if (!r.stopped && this.ctrl === ctrl) ctrl?.abort();
      },
      () => {
        if (this.ctrl === ctrl) ctrl?.abort();
      },
    );
    window.setTimeout(() => {
      if (this.ctrl === ctrl && this.stopping) ctrl?.abort();
    }, 6000);
  }

  /** Stop watching (another chat opens, a new chat starts): the reply goes on on the
   *  server and shows again when this chat is opened. */
/** Open the chat again once the page is visible and online (it shows the reply live if it
   *  is still running, or as stored when it has ended). */
  private reconnect(sid: string): void {
    const go = (): void => {
      if (document.hidden || !navigator.onLine) return;
      document.removeEventListener('visibilitychange', go);
      window.removeEventListener('online', go);
      if (this.session?.id === sid && !this.ctrl) void this.open(sid);
    };
    document.addEventListener('visibilitychange', go);
    window.addEventListener('online', go);
    window.setTimeout(go, 600);
  }

    detach(): void {
    if (!this.ctrl) return;
    this.run++;
    this.liveEl.hidden = true;
    this.paintTray();
    this.ctrl.abort();
    this.ctrl = null;
    this.setBusy(false);
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.o.onBusy?.(on);
    this.el.classList.toggle('busy', on);
    this.trayEl.classList.toggle('busy', on);
    this.paintOpen();
    this.paintQueue();
    this.paintSend();
  }

  /** Send, or Stop while a reply runs and nothing is typed (typing turns it back into Send,
   *  which then queues; Ctrl/Cmd+Enter steers). */
  private paintSend(): void {
    const stop = this.busy && !this.input.value.trim();
    const queue = this.busy && !stop;
    this.sendBtn.innerHTML = icon(stop ? 'stop' : 'send');
    this.sendBtn.classList.toggle('queue', queue);
    this.sendBtn.classList.toggle('stopping', stop && this.stopping);
    const tip = stop
      ? this.stopping
        ? t('Stopping…')
        : this.queue.length
          ? t('Stop this reply (the next queued message goes out)')
          : t('Stop')
      : queue
        ? t('Add to the queue (Enter) · Ctrl+Enter sends it now')
        : t('Send (Enter)');
    this.sendBtn.title = tip;
    this.sendBtn.setAttribute('aria-label', stop ? t('Stop') : queue ? t('Add to the queue') : t('Send'));
  }

  async send(raw: string, answer?: A.Answer): Promise<void> {
    const text = raw.trim();
    if (!text || this.busy) return;
    const s = A.mnemoState() ?? (await A.loadState().catch(() => null));
    if (!s || !A.usableModels(s).length) {
      toast(t('Connect a model for {mnemo} first', { mnemo: A.MNEMO }), 'err');
      openMnemoSettings();
      return;
    }
    this.setBusy(true);
    try {
      if (!this.session) {
        // The model the picker shows is the one the chat uses.
        if (!this.model) this.model = this.select?.value || A.fallbackModel(s);
        this.session = (await A.newSession(this.newScope(), this.model, this.fleetingOn)).session;
        this.watch(this.session.id);
                this.dropHeld();
                this.log.innerHTML = '';
        this.o.onChange?.(this.session);
      }
    } catch (e) {
      this.setBusy(false);
      toast((e as Error).message, 'err');
      return;
    }
    const att = this.attach.slice();
    this.attach = [];
    this.paintAtt();
    this.input.value = '';
    this.grow();
    this.log.querySelector('.mn-hello')?.remove();
    this.log.append(this.userBubble(text, undefined, att));
    this.paintRail();
    requestAnimationFrame(() => this.log.querySelectorAll<HTMLElement>('.mn-u:last-of-type .mn-car, .mn-car:not([data-wired])').forEach(syncCarousel));
    const sid0 = this.session!.id;
    // A new message that answers no question leaves the open questions skipped.
    if (!answer) this.log.querySelectorAll<HTMLElement>('.mn-ask:not(.done)').forEach(skipAsk);
    const ub = this.log.querySelector<HTMLElement>('.mn-u:last-of-type');
    await this.stream(async (signal, on) => {
      try {
        await A.streamChat(sid0, text, this.model || undefined, att, signal, on, answer);
      } catch (e) {
        // A reply started meanwhile (from the queue or another device): this one waits its turn.
        if (/still answering/i.test((e as Error).message)) {
          ub?.remove();
          const r = await A.queueAdd(sid0, A.chatBody(text, this.model || undefined, att, answer));
          this.setQueue(r.queue);
          const q = new Error('queued');
          q.name = 'Queued';
          throw q;
        }
        throw e;
      }
    });
  }

  /** Run the turn of the owner's message `uid` again: Regenerate on a reply, Try again on a
   *  message or an error. Later turns are replaced (the owner confirms that first). */
  private async rerun(uid: number): Promise<void> {
    if (this.busy || !this.session || !uid) return;
    const later = this.messages.some((m) => m.role === 'user' && m.id > uid);
    if (later) {
      const go = await new Promise<boolean>((done) => {
        Modal.open({
          title: t('Run this message again?'),
          body: `<p>${t('The messages that came after it in this chat are replaced by the new reply.')}</p>`,
          actions: [
            { label: t('Cancel'), cls: 'ghost', run: () => (Modal.close(), done(false)) },
            { label: t('Run again'), cls: 'primary', run: () => (Modal.close(), done(true)) },
          ],
        });
      });
      if (!go) return;
    }
    const ub = this.log.querySelector<HTMLElement>(`.mn-u[data-mid="${uid}"]`);
    if (!ub) {
      toast(t('Open the chat again to run that message again'), 'warn');
      return;
    }
    while (ub.nextSibling) ub.nextSibling.remove();
    this.messages = this.messages.filter((m) => m.id <= uid);
    this.setBusy(true);
    const sid = this.session.id;
    this.paintRail();
    await this.stream((signal, on) => A.streamRerun(sid, uid, this.model || undefined, signal, on), uid);
  }

  /** Stream one reply into a new turn (the composer is already busy). */
  private async stream(start: (signal: AbortSignal, on: (ev: A.ChatEvent) => void) => Promise<unknown>, uid = 0, live = false): Promise<void> {
    const my = ++this.run;
    let got = false;
    const t0 = performance.now();
    const turn = this.turnEl();
    turn.classList.add('live');
    if (uid) turn.dataset.uid = String(uid);
    const body = turn.querySelector<HTMLElement>('.mn-tb')!;
    body.innerHTML = '';
    this.log.append(turn);
    this.scrollEnd(true);

    let md: HTMLElement | null = null;
    let raw2 = '';
    let frame = 0;
    let wrote = false;
    let model = '';
    const paint = (): void => {
      frame = 0;
      if (md) md.innerHTML = renderReply(raw2, true) + '<span class="mn-caret"></span>';
      this.scrollEnd();
    };
    // The live status above the composer, outside the reply: what Mnemo is doing now and for
    // how long, and while sub-agents work, how many are at it (their work is in the Agents panel).
    const THINKING = t('Thinking');
    let phase = THINKING;
    let phaseAt = performance.now();
    /** This reply's sub-agents (delegate call ids) and whether each has finished. */
    const subs = new Map<string, boolean>();
    const subInfo = new Map<string, { agent: string; task: string }>();
    // A new message of the owner's starts without the last reply's sub-agent list; Mnemo's
    // own plan belongs to the chat and stays.
    if (!live && !this.planOwn) this.showPlan(null);
    const secs = (ms: number): string => {
      const n = Math.floor(ms / 1000);
      return n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, '0')}s`;
    };
    const bar = this.liveEl;
    const tick = (): void => {
      if (my !== this.run || bar.hidden) return;
      const now = performance.now();
      const running = [...subs.entries()].filter(([, x]) => !x);
      const waited = now - phaseAt;
      let head = phase;
      // A model that has not begun after a while: say so (Stop cuts it, a message queued goes on).
      if (phase === THINKING && waited > 45_000 && !raw2) head += ' · ' + t('the model has not started answering yet');
      if (running.length) {
        const done = subs.size - running.length;
        head = `${tn(running.length, '{n} sub-agent working', '{n} sub-agents working')}${done ? ` · ${t('{n} done', { n: done })}` : ''}`;
      }
      bar.dataset.subs = running.map(([id]) => id).join(',');
      // No plan of Mnemo's: the checklist lists this reply's sub-agents.
      if (!this.planOwn && subs.size)
        this.showPlan(
          [...subs.entries()].map(([id, fin]) => ({ text: subInfo.get(id)?.agent || t('Sub-agent'), sub: (subInfo.get(id)?.task || '').slice(0, 90), status: fin ? 'done' : 'in_progress' })),
          false,
        );
      const opens = running.length > 0 || !!body.querySelector(':scope > .mn-act');
      bar.classList.toggle('still', !opens);
      bar.tabIndex = opens ? 0 : -1;
      bar.title = running.length ? t('Open the Agents panel') : opens ? t('Show the steps') : '';
      bar.querySelector('.mn-live-t')!.textContent = head;
      bar.querySelector('.mn-live-s')!.textContent = secs(waited);
    };
    const ticker = window.setInterval(tick, 1000);
    const think = (on: boolean, label = THINKING): void => {
      if (my !== this.run) return;
      if (on) {
        // A reply at work on this chat always shows Stop, however it was started.
        if (!this.busy) this.setBusy(true);
        if (label !== phase || bar.hidden) phaseAt = performance.now();
        phase = label;
        bar.hidden = false;
        this.paintTray();
        tick();
      } else {
        bar.hidden = true;
        delete bar.dataset.subs;
        this.paintTray();
      }
    };
    think(true);
    const closeText = (): void => {
      if (md) {
        md.innerHTML = renderReply(raw2);
        md.dataset.raw = raw2;
        mountArt(md, true);
      }
      md = null;
      raw2 = '';
    };
    this.ctrl = new AbortController();
    const sid = this.session!.id;
    let dropped = false;
    let gone = false;
    // A reply that ends without "done" or an error was stopped or cut on the server.
    try {
      await start(this.ctrl.signal, (ev) => {
        got = true;
        switch (ev.type) {
          case 'start':
            model = ev.model;
            if (this.shownModel && ev.model !== this.shownModel) turn.before(this.modelLine(ev.model));
            this.shownModel = ev.model;
            this.setContext(ev.context);
            break;
          case 'ask':
            closeText();
            think(false);
            body.append(askEl(ev, null));
            this.scrollEnd();
            break;
          case 'steered':
            closeText();
            body.append(el('div', 'mn-steer', `${icon('enter')}<span>${esc(ev.text)}</span>`));
            this.scrollEnd();
            break;
          case 'compacting':
            // The chat is full: a live divider shows the summary being written, then the reply.
            think(false);
            turn.before(this.compactLive());
            this.scrollEnd();
            break;
          case 'compact_text': {
            // The summary shows as it is written, under the working divider.
            const live = this.log.querySelector<HTMLElement>('.mn-compact.live');
            if (!live) break;
            let b = live.querySelector<HTMLElement>('.mn-compact-live-b');
            if (!b) {
              live.querySelector('.mn-compact-why')?.remove();
              b = el('div', 'mn-md mn-compact-live-b');
              b.dataset.raw = '';
              live.append(b);
            }
            b.dataset.raw += ev.delta;
            b.innerHTML = renderReply(b.dataset.raw || '', true);
            b.scrollTop = b.scrollHeight;
            break;
          }
          case 'compacted': {
            const live = this.log.querySelector<HTMLElement>('.mn-compact.live');
            const summary = ev.summary || live?.querySelector<HTMLElement>('.mn-compact-live-b')?.dataset.raw || '';
            const done = this.compactNote(ev.messages, summary, live ? Number(live.dataset.t0) : 0);
            if (live) live.replaceWith(done);
            else turn.before(done);
            think(true);
            break;
          }
          case 'fallback': {
            // The model failed: what it began is struck out and the next one answers.
            if (md) md.classList.add('mn-cut');
            closeText();
            const name = (k: string): string => {
              const st = A.mnemoState();
              return st ? A.modelLabel(st, k) : k;
            };
            {
              const line = this.modelLine(ev.model, t('took over: {model} did not answer ({reason})', { model: name(ev.from), reason: ts(ev.reason) }));
              if (ev.detail) line.title = ev.detail;
              body.append(line);
            }
            model = ev.model;
            this.shownModel = ev.model;
            // The chat keeps the model that answered from now on.
            if (this.session?.id === sid) {
              this.model = ev.model;
              this.select?.set(ev.model, false);
              this.paintThink();
              this.paintPin();
              this.session = { ...this.session, model: ev.model };
              toast(t('{from} did not answer, so this chat now uses {model}', { from: name(ev.from), model: name(ev.model) }), 'info');
            }
            think(true, t('{model} is answering', { model: name(ev.model) }));
            this.scrollEnd();
            break;
          }
          case 'notice': {
            // Small things (pictures read by the image model, or not at all) are a toast, never
            // a line in the chat.
            if (ev.toast) {
              const open = ev.action?.open;
              notify(ts(ev.text), ev.toast === 'err' ? 'err' : 'info', 5200, open && ev.action ? { label: ts(ev.action.label), run: () => (open === 'model' ? this.select?.open() : openMnemoSettings('jobs')) } : undefined);
              break;
            }
            const go = ev.action && (ev.action.open === 'jobs' || ev.action.open === 'model') && ev.action.label;
            body.insertAdjacentHTML(
              'beforeend',
              `<div class="mn-notice">${icon('info')}<span>${esc(ts(ev.text))}</span>${
                go ? `<button type="button" class="mn-notice-a" data-notice-open="${attr(ev.action!.open)}">${esc(ts(ev.action!.label))}</button>` : ''
              }</div>`,
            );
            // A model that did not answer is asked again: say so while waiting.
            if (/trying again/i.test(ev.text)) think(true, t('Waiting for the model to answer again'));
            break;
          }
          case 'thinking':
            think(false);
            this.thought(body, ev.delta);
            this.scrollEnd();
            break;
          case 'text':
            think(false);
            if (!md) {
              md = el('div', 'mn-md');
              body.append(md);
            }
            raw2 += ev.delta;
            if (!frame) frame = requestAnimationFrame(paint);
            break;
          case 'tool_start': {
            closeText();
            think(false);
            // Cards and questions are part of the answer, not a step.
            if (ev.name === SHOW || ev.name === ASK) {
              think(true);
              break;
            }
            if (OWNER_MEMORY.has(ev.name)) {
              body.append(memLine(ev.id, ev.name, ev.args));
              think(true);
              break;
            }
            if (ev.name === PLAN) {
              think(true);
              break;
            }
            if (ev.name === DELEGATE) {
              subCard(body, ev.id, ev.args, this.agents);
              subInfo.set(ev.id, { agent: argStr(ev.args, 'agent') || t('Sub-agent'), task: argStr(ev.args, 'task') });
              if (!subs.has(ev.id)) subs.set(ev.id, false);
              think(true, t('Sub-agents at work'));
              this.scrollEnd();
              break;
            }
            this.toolCard(body, ev.id, ev.name, ev.args);
            think(true, toolWords(ev.name));
            this.scrollEnd();
            break;
          }
          case 'tool_end': {
            if (ev.name === ASK) {
              think(false);
              break;
            }
            if (ev.name === PLAN) {
              if (ev.plan) this.setPlan(ev.plan);
              think(true);
              break;
            }
            if (ev.name === SHOW) {
              if (ev.shown?.length) {
                body.append(cardsEl(ev.shown));
                wireBoards(body);
              }
              this.scrollEnd();
              break;
            }
            if (OWNER_MEMORY.has(ev.name)) {
              endMemLine(body, ev.id, ev.ok);
              think(true);
              break;
            }
            if (ev.name === DELEGATE) {
              const sc = this.agents.byId(ev.id);
              const bg = !!(parseOut(ev.output) as A.SubResult | null)?.background;
              if (sc && !bg) subFinal(sc, ev.output ?? { error: ev.ok ? '' : ev.summary }, ev.ok);
              if (!bg) subs.set(ev.id, true);
              think(true);
              break;
            }
            if (ev.name === AGENTS) this.agentResults(ev.output);
            const card = body.querySelector<HTMLElement>(`.mn-tool[data-id="${CSS.escape(ev.id)}"]`);
            if (card) this.endTool(card, ev.ok, ev.summary, ev.ms, ev.output);
            if (ev.ok && changesNotes(ev.name)) wrote = true;
            think(true);
            break;
          }
          case 'agents':
            this.agents.mark(ev);
            break;
          case 'sub': {
            const sc = this.agents.byId(ev.id);
            if (sc) subEvent(sc, ev);
            subs.set(ev.id, subs.get(ev.id) || ev.phase === 'done' || ev.phase === 'error' || ev.phase === 'final' || ev.phase === 'stopped');
            tick();
            break;
          }
          case 'error':
            closeText();
            think(false);
            body.append(this.errorCard(ev.message));
            break;
          case 'done':
            think(false);
            closeText();
            this.footer(turn, model, ev.input_tokens, ev.output_tokens);
            this.scrollEnd();
            this.setContext(ev.context);
            if (this.session && ev.title) this.session = { ...this.session, title: ev.title, updated_at: Date.now() / 1000 };
            break;
        }
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === 'Queued') {
        gone = true;
      } else if (err.name === 'AbortError') {
        // Stopped or cut: the reply just ends where it is.
      } else if (lostLink(err)) {
        // The connection dropped (the tab went to the background, the page was left, the
        // network blinked): the reply goes on on the server, so watch it again, no error.
        dropped = true;
      } else body.append(this.errorCard(err.message));
    } finally {
      window.clearInterval(ticker);
      tick();
      think(false);
      // Sub-agents left unfinished (the reply was stopped): their checklist goes, no spinners stay.
      if (my === this.run && !this.planOwn && [...subs.values()].some((x) => !x)) this.showPlan(null);
      // Left for another chat: the reply goes on on the server; nothing here is ours now.
      if (my !== this.run) {
        if (frame) cancelAnimationFrame(frame);
        return;
      }
      if (dropped) {
        if (frame) cancelAnimationFrame(frame);
        this.ctrl = null;
        this.setBusy(false);
        this.reconnect(sid);
        return;
      }
      // Sent while a reply had just started elsewhere: the message waits in the queue.
      if (gone) {
        turn.remove();
        this.ctrl = null;
        this.setBusy(false);
        return;
      }
      // The reply ended just before we came to watch it: show the stored chat instead.
      if (live && !got) {
        turn.remove();
        this.ctrl = null;
        this.stopping = false;
        this.setBusy(false);
        void this.refresh(sid);
        return;
      }
      if (frame) cancelAnimationFrame(frame);
      window.clearInterval(ticker);
      think(false);
      closeText();
      this.stopping = false;
      for (const id of subs.keys()) {
        const c = this.agents.byId(id);
        if (c) subStop(c);
      }
      this.finishAct(body, Math.round(performance.now() - t0));
      turn.classList.remove('live');
      if (!body.childElementCount) body.append(this.errorCard(t('No reply came back.')));
      this.ctrl = null;
      this.setBusy(false);
      if (this.session) {
        this.session = { ...this.session, messages: this.session.messages + 1 };
        this.o.onChange?.(this.session);
      }
      // A board Mnemo just made is known as a board once the tree is loaded again.
      if (wrote)
        void hooks.loadCore().then(() => {
          if (turn.isConnected && !turn.querySelector('.mn-kbs')) {
            this.turnBoards(turn);
          }
        });
      // The next queued message goes out on the server by itself; its reply shows here
      // through the chat's watch. Keep the stored transcript in step meanwhile.
      const runAfter = this.runAfter;
      this.runAfter = false;
      this.lastEnd = Date.now();
      void A.getSession(sid)
        .then((r) => {
          if (this.session?.id === sid) {
            this.messages = r.messages;
            this.fillResults(r.messages);
            this.session = r.session;
            this.setContext(r.context);
            this.setQueue(r.queue);
            this.setPlan(r.plan || []);
            this.agentsInfo = r.agents;
            this.o.onMessages?.();
            // The message sent from here and its turn learn their ids (Try again, Regenerate).
            let prevU = turn.previousElementSibling as HTMLElement | null;
            while (prevU && !prevU.classList.contains('mn-u')) prevU = prevU.previousElementSibling as HTMLElement | null;
            if (prevU && !prevU.dataset.mid) {
              const known = new Set(Array.from(this.log.querySelectorAll<HTMLElement>('.mn-u[data-mid]')).map((b) => Number(b.dataset.mid)));
              const mine = r.messages.filter((m) => m.role === 'user' && !m.meta?.via && !known.has(m.id)).pop();
              if (mine) prevU.dataset.mid = String(mine.id);
            }
            if (prevU?.dataset.mid) turn.dataset.uid = prevU.dataset.mid;
            if ((r.running || runAfter) && !this.busy) this.follow(sid);
            // Show the summary text in the note added while streaming.
            const c = r.messages.filter((m) => m.meta?.compact === true).pop();
            const live = Array.from(this.log.querySelectorAll<HTMLElement>('.mn-compact')).pop();
            if (c && live && !live.querySelector('.mn-compact-b')) live.replaceWith(this.compactNote(Number(c.meta?.messages || 0), c.content));
          }
        })
        .catch(() => undefined);
    }
  }
}

/** Open something from the vault named by a card or a chip. */
export function openShown(kind: string, path: string): void {
  if (kind === 'note') hooks.openNote(path);
  else if (kind === 'image') openLightbox(imgUrl(path), path.split('/').pop() || '');
  else if (kind === 'upload') openLightbox(`/api/assistant/uploads/${path}`, '');
  else {
    hooks.go('vault');
    nav.selectFolder(kind === 'folder' ? path : '');
  }
}

/** One thing a chat touched, for the artifacts panel. */
export interface Artifact {
  kind: 'note' | 'folder' | 'image' | 'vault' | 'upload';
  path: string;
  title: string;
  role: 'changed' | 'shown' | 'attached' | 'read';
}

const ROLE_RANK: Record<Artifact['role'], number> = { changed: 0, shown: 1, attached: 2, read: 3 };

/** Everything a chat attached, used, changed or showed, each once (its strongest role). */
export function artifactsOf(messages: A.Message[]): Artifact[] {
  const seen = new Map<string, Artifact>();
  const add = (a: Artifact): void => {
    const k = a.kind + ':' + a.path;
    const had = seen.get(k);
    if (!had || ROLE_RANK[a.role] < ROLE_RANK[had.role]) seen.set(k, a);
  };
  const noteName = (p: string): string => noteTitle(p) || p.split('/').pop()!.replace(/\.md$/i, '');
  for (const m of messages) {
    if (m.role === 'user') {
      for (const a of (m.meta?.attach as A.Attach[] | undefined) || []) {
        if (a.kind === 'image') add({ kind: 'upload', path: a.path, title: a.title, role: 'attached' });
        else if (a.kind === 'note') add({ kind: 'note', path: a.path, title: noteName(a.path), role: 'attached' });
        else add({ kind: a.path ? 'folder' : 'vault', path: a.path, title: a.title, role: 'attached' });
      }
    } else if (m.role === 'assistant') {
      for (const c of m.tool_calls || []) {
        if (c.name === SHOW) continue;
        const role = changesNotes(c.name) ? 'changed' : 'read';
        for (const p of touchedPaths(c.arguments)) {
          const path = resolveNote(p) || p;
          add({ kind: 'note', path, title: noteName(path), role });
        }
      }
    } else if (m.role === 'tool' && m.tool_name === SHOW) {
      try {
        for (const it of (JSON.parse(m.content) as { shown?: A.Shown[] }).shown || []) add({ ...it, title: it.kind === 'note' ? noteName(it.path) : it.title, role: 'shown' });
      } catch {
        /* nothing shown */
      }
    }
  }
  return [...seen.values()].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
}

/** Under a finished reply: what it changed, showed and read, as a sliding row of chips. */
function relatedHTML(body: HTMLElement): string {
  const act = body.querySelector<HTMLElement>(':scope > .mn-act');
  const st = act ? ACTS.get(act) : undefined;
  const items: { kind: string; path: string; title: string; ic: string; cls: string }[] = [];
  const has = new Set<string>();
  const push = (kind: string, path: string, title: string, ic: string, cls: string): void => {
    const k = kind + ':' + path;
    if (has.has(k)) return;
    has.add(k);
    items.push({ kind, path, title, ic, cls });
  };
  const nm = (p: string): string => noteTitle(p) || p.split('/').pop()!.replace(/\.md$/i, '');
  const noteItem = (p: string, changed: boolean): void => {
    const path = resolveNote(p) || p;
    const kb = isBoard(path);
    push('note', path, nm(path), kb ? 'kanban' : changed ? 'edit' : 'note', (changed ? ' w' : '') + (kb ? ' is-kb' : ''));
  };
  for (const p of st?.changed || []) noteItem(p, true);
  body.querySelectorAll<HTMLElement>('.mn-kb[data-kb]').forEach((c) => noteItem(c.dataset.kb || '', false));
  body.querySelectorAll<HTMLElement>('.mn-cards [data-card]').forEach((c) => {
    const kind = c.dataset.card || 'note';
    push(kind, c.dataset.path || '', c.querySelector('b')?.textContent || '', kind === 'image' ? 'image' : kind === 'folder' ? 'folder' : kind === 'vault' ? 'vault' : 'note', '');
  });
  for (const p of st?.read || []) noteItem(p, false);
  if (!items.length) return '';
  const cap = 12;
  const chips = items
    .slice(0, cap)
    .map(
      (i) =>
        `<span class="mn-att-c sm${i.cls}" data-card="${attr(i.kind)}" data-path="${attr(i.path)}" role="button" tabindex="0" title="${attr(i.path || i.title)}">${icon(i.ic)}<span>${esc(i.title)}</span></span>`,
    )
    .join('');
  return `<div class="mn-rel"><span class="mn-rel-h">${t('Related')}</span>${carouselHTML(chips + (items.length > cap ? `<small class="mn-rel-more">+${items.length - cap}</small>` : ''))}</div>`;
}

/** Mnemo's tool that asks the owner a question with options. */
const ASK = 'ask_owner';

/** The question in an ask_owner call's arguments (as the server checks it). */
function askOf(args: unknown): Omit<A.Ask, 'id'> | null {
  const a = (args || {}) as { question?: unknown; options?: unknown; allow_other?: unknown };
  const question = typeof a.question === 'string' ? a.question.trim() : '';
  const options = (Array.isArray(a.options) ? a.options : [])
    .map((o) => o as { label?: unknown; description?: unknown; approve?: unknown })
    .filter((o) => typeof o.label === 'string' && o.label.trim())
    .slice(0, 5)
    .map((o) => ({ label: String(o.label).trim(), description: typeof o.description === 'string' ? o.description : null, approve: o.approve === true }));
  return question && options.length >= 2 ? { question, options, allow_other: a.allow_other !== false } : null;
}

/** How a question was answered in the stored chat: the label, or '' for Other; false when the
 *  owner wrote something else after it (skipped); null while it is still open. */
function answerTo(messages: A.Message[], id: string): string | false | null {
  const m = messages.find((x) => x.role === 'user' && (x.meta?.answer as A.Answer | undefined)?.to === id);
  if (m) return (m.meta?.answer as A.Answer).other ? '' : m.content;
  const at = messages.findIndex((x) => x.role === 'assistant' && (x.tool_calls || []).some((c) => c.id === id));
  return at >= 0 && messages.slice(at + 1).some((x) => x.role === 'user') ? false : null;
}

/** Mark an open question card skipped. */
function skipAsk(card: HTMLElement): void {
  card.classList.add('done', 'skipped');
  card.querySelectorAll<HTMLInputElement | HTMLButtonElement>('button,input').forEach((x) => (x.disabled = true));
  card.querySelector('.mn-ask-f')?.setAttribute('hidden', '');
  card.querySelector('.mn-ask-ey')!.insertAdjacentHTML('beforeend', `<em class="mn-ask-skip">${t('Skipped')}</em>`);
}

/** A question card: the options listed one under another (the chosen one marked once
 *  answered), and Other, which opens a box to type the answer in the card. */
function askEl(q: A.Ask, answered: string | false | null): HTMLElement {
  const done = answered !== null;
  const box = el('div', 'mn-ask' + (done ? ' done' : '') + (answered === false ? ' skipped' : ''));
  box.dataset.ask = q.id;
  const dis = done ? ' disabled' : '';
  // The question on its own band (who asks, then the question, larger), the answers below
  // as plain cards to tap: easy to tell apart and to read.
  box.innerHTML = `<div class="mn-ask-h"><div class="mn-ask-ey">${icon('help')}<span>${t('{mnemo} asks', { mnemo: A.MNEMO })}</span>${
    answered === false ? `<em class="mn-ask-skip">${t('Skipped')}</em>` : ''
  }</div><p class="mn-ask-q">${esc(ts(q.question))}</p></div><div class="mn-ask-o">${q.options
    .map(
      (o, i) =>
        `<button type="button" class="mn-ask-b${o.approve ? ' ok' : ''}${answered === o.label ? ' on' : ''}" data-ask-opt="1" data-label="${attr(o.label)}" data-approve="${o.approve ? '1' : ''}"${dis}><span class="mn-ask-n">${
          i + 1
        }</span><span class="mn-ask-c"><b>${esc(ts(o.label))}</b>${o.description ? `<small>${esc(ts(o.description))}</small>` : ''}</span></button>`,
    )
    .join('')}${
    q.allow_other
      ? `<button type="button" class="mn-ask-b other${answered === '' ? ' on' : ''}" data-ask-opt="other"${dis}><span class="mn-ask-n">${icon('edit')}</span><span class="mn-ask-c"><b>${t('Other')}</b><small>${t('Type your own answer')}</small></span></button><form class="mn-ask-f" hidden><input type="text" placeholder="${t('Type your answer…')}" aria-label="${t('Your answer')}" autocomplete="off"${dis}><button type="submit" class="mn-ibtn" title="${t('Send the answer (Enter)')}" aria-label="${t('Send the answer')}"${dis}>${icon(
          'enter',
        )}</button></form>`
      : ''
  }</div>`;
  return box;
}

/** An error's text without HTML: an error page becomes its title, spaces folded. */
function plainError(msg: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(msg)?.[1]?.trim();
  const plain = msg.replace(/<!doctype[\s\S]*?<\/html>/gi, title || t('an HTML error page')).replace(/<[^>]+>/g, ' ');
  return plain.replace(/\s+/g, ' ').trim();
}

/** A provider error in plain words; HTTP codes and raw bodies stay behind "Show the full error".
 *  The status the provider answered with decides first (numbers inside a body can be anything). */
function friendlyError(msg: string): { text: string; setup: boolean } {
  const KEY = { text: t('The AI provider did not accept the key. Check it in Settings.'), setup: true };
  const LOST = { text: t('The AI provider could not find this model or address. Check it in Settings.'), setup: true };
  const BUSY = { text: t('The AI provider is busy or out of quota. Try again in a moment.'), setup: false };
  const DOWN = { text: t('The AI provider is not answering right now. Try again in a moment.'), setup: false };
  const NET = { text: t('Could not reach the AI provider. Check the connection and try again.'), setup: false };
  const code = Number(/answered (\d{3})/i.exec(msg)?.[1] || 0);
  if (code === 401 || code === 403) return KEY;
  if (code === 404) return LOST;
  if (code === 429) return BUSY;
  if (code >= 500) return DOWN;
  const m = plainError(msg).toLowerCase().slice(0, 400);
  const has = (...xs: string[]): boolean => xs.some((x) => m.includes(x));
  if (has('unauthori', 'forbidden', 'api key', 'invalid key')) return KEY;
  if (has('no such model', 'model_not_found', 'model not found')) return LOST;
  if (has('rate limit', 'quota', 'too many requests')) return BUSY;
  if (has('overload', 'unavailable', 'bad gateway', 'gateway timeout')) return DOWN;
  if (has('could not reach', 'timed out', 'timeout', 'failed to fetch', 'networkerror', 'connection refused', 'dns')) return NET;
  if (!m.trim() || m.includes('no reply came back')) return { text: t('No reply came back.'), setup: false };
  if (has('no provider', 'add a provider', 'no model')) return { text: ts(msg.trim()), setup: true };
  // Memora's own short messages are already plain; raw provider bodies are not.
  const short = msg.trim();
  if (!code && short.length <= 160 && !/[{}<>]|\b\d{3}\b/.test(short)) {
    const tr = ts(short);
    return { text: tr.charAt(0).toUpperCase() + tr.slice(1), setup: false };
  }
  return { text: t('Something went wrong with this reply.'), setup: false };
}

/** Most pictures one message may carry (each goes to the model as an image). */
const IMAGES_PER_MESSAGE = 4;

/** A row of chips that slides sideways (no scrollbar), with arrows when it overflows. */
function carouselHTML(inner: string): string {
  return `<div class="mn-car"><button type="button" class="mn-car-a l" data-car="l" aria-label="${t('Scroll left')}" tabindex="-1">${icon(
    'chev-left',
  )}</button><div class="mn-car-row">${inner}</div><button type="button" class="mn-car-a r" data-car="r" aria-label="${t('Scroll right')}" tabindex="-1">${icon('chev-right')}</button></div>`;
}

/** Show each arrow only while there is more that way. */
function syncCarousel(car: HTMLElement): void {
  const row = car.querySelector<HTMLElement>('.mn-car-row');
  if (!row) return;
  const max = row.scrollWidth - row.clientWidth;
  car.classList.toggle('more-l', row.scrollLeft > 4);
  car.classList.toggle('more-r', max - row.scrollLeft > 4);
  if (!car.dataset.wired) {
    car.dataset.wired = '1';
    row.addEventListener('scroll', () => syncCarousel(car), { passive: true });
  }
}

/** Mnemo's tool that hands over notes, folders, images or the vault as cards. */
const SHOW = 'show_items';

interface PlanStep {
  text: string;
  status: string;
  sub?: string;
}

const imgUrl = (path: string): string => `/api/vault/file?path=${encodeURIComponent(path)}`;

/** The note or board icon for a vault path. */
function noteIc(path: string): string {
  return isBoard(path) ? 'kanban' : 'note';
}

/** The cards of one show_items call: notes with a line of their text, folders, images, the
 *  vault; boards as board cards that open into the live board. */
function cardsEl(items: A.Shown[]): HTMLElement {
  const wrap = el('div', 'mn-shown');
  const boards = items.filter((it) => it.kind === 'note' && isBoard(it.path));
  const rest = items.filter((it) => !boards.includes(it));
  const notes = new Map(allNotes().map((n) => [n.path, n]));
  const box = el('div', 'mn-cards');
  box.innerHTML = rest
    .map((it) => {
      const dir = it.path.includes('/') ? it.path.slice(0, it.path.lastIndexOf('/')) : '';
      const sub = it.kind === 'vault' ? t('Every note') : it.kind === 'folder' ? (it.path && dir ? t('Folder in {dir}', { dir }) : t('Folder')) : dir || t('Top level');
      const title = it.kind === 'note' ? noteTitle(it.path) || it.title : it.title;
      const lead =
        it.kind === 'image'
          ? `<span class="mn-card-img"><img alt="" loading="lazy" src="${attr(imgUrl(it.path))}" onerror="this.parentElement.classList.add('broken')"></span>`
          : `<span class="mn-card-ic">${icon(it.kind === 'note' ? 'note' : it.kind === 'folder' ? 'folder' : 'vault')}</span>`;
      let x = '';
      if (it.kind === 'note') {
        const n = notes.get(it.path);
        const e = n ? excerptOf(it.path, n.mtime) : undefined;
        if (n && !e) wantExcerpt(it.path, n.mtime);
        x = `<small class="mn-card-x" data-x="${attr(it.path)}"${e?.text ? '' : ' hidden'}>${esc(e?.text || '')}</small>`;
      }
      return `<button type="button" class="mn-card k-${it.kind}" data-card="${attr(it.kind)}" data-path="${attr(it.path)}" title="${attr(
        it.kind === 'vault' ? t('Open your notes') : t('Open {name}', { name: it.path || t('All notes') }),
      )}">${lead}<span class="mn-card-t"><b>${esc(title)}</b><small>${esc(sub)}</small>${x}</span>${icon('chev', 'i mn-card-go')}</button>`;
    })
    .join('');
  if (rest.length) wrap.append(box);
  if (boards.length) wrap.insertAdjacentHTML('beforeend', `<div class="mn-kbs">${boards.map((b) => boardCardHTML(b.path)).join('')}</div>`);
  return wrap;
}

/** Note cards under `root` whose line of text came while they were out of the page. */
function fillExcerpts(root: ParentNode): void {
  const notes = new Map(allNotes().map((n) => [n.path, n]));
  root.querySelectorAll<HTMLElement>('.mn-card-x[hidden]').forEach((x) => {
    const n = notes.get(x.dataset.x || '');
    const e = n ? excerptOf(n.path, n.mtime) : undefined;
    if (e?.text) {
      x.textContent = e.text;
      x.hidden = false;
    }
  });
}

// A note card's line of text arrives after the card is drawn.
onExcerpt((path) => {
  const n = allNotes().find((x) => x.path === path);
  const e = n ? excerptOf(path, n.mtime) : undefined;
  if (!e?.text) return;
  document.querySelectorAll<HTMLElement>(`.mn-card-x[data-x="${CSS.escape(path)}"]`).forEach((x) => {
    x.textContent = e.text;
    x.hidden = false;
  });
});

/** Settings, Mnemo; `part` 'memory' scrolls to what Mnemo knows about the owner, 'jobs' to
 *  the models for each job. */
export function openMnemoSettings(part = ''): void {
  A.wantSettingsPart(part);
  requestSettingsSection('stMnemo');
  hooks.go('settings');
  // Settings already open with the card loaded: scroll there now.
  const id = part === 'memory' ? 'mnsMem' : part === 'jobs' ? 'mnsJobs' : '';
  if (id)
    window.setTimeout(() => {
      const card = document.getElementById(id);
      if (!card) return;
      if (part === 'memory' && (!card.querySelector('.mns-ml, .mns-none:not(:empty)') || card.textContent?.includes(t('Loading…')))) return;
      A.takeSettingsPart();
      card.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }, 350);
}

// ---- sub-agents: their work lives in the Agents panel; a reply keeps one line per group ----

interface SubState {
  agent: string;
  model: string;
  text: string;
  step: number;
  window: number;
  tin: number;
  tout: number;
  context: number;
}
const SUBS = new WeakMap<HTMLElement, SubState>();
/** The panel a card lives in, the reply line it belongs to, and each line's cards. */
const PANEL = new WeakMap<HTMLElement, AgentsPanel>();
const CARD_LINE = new WeakMap<HTMLElement, HTMLElement>();
const LINE_CARDS = new WeakMap<HTMLElement, HTMLElement[]>();

const fmtT = (n: number): string => A.fmtTokens(Math.max(0, Math.round(n)));
const subBusy = (c: HTMLElement): boolean => c.dataset.state === 'run' || c.dataset.state === 'ask';
const seqOf = (c: Element): number => Number((c as HTMLElement).dataset.seq || 0);

type AgentSec = 'run' | 'idle' | 'done';

/** The Agents panel: every sub-agent of the chat on screen, by what it is doing now. Running
 *  ones show their live work; idle ones answered and can take a follow-up; done ones (older
 *  runs, failed or stopped) fold away under a count. */
class AgentsPanel {
  readonly el: HTMLElement;
  private seq = 0;
  /** What Mnemo said of each sub-agent (by lower-case name): done or removed, and its
   *  instructions. */
  private marks = new Map<string, string>();
  private rules = new Map<string, string>();
  private ids = new Map<string, string>();

  constructor(private changed: () => void) {
    this.el = el('div', 'mn-agents');
    this.el.innerHTML = `<p class="mn-ag-none">${t('No sub-agents in this chat yet. When {mnemo} hands a task to one, it shows here.', { mnemo: A.MNEMO })}</p>
      <section class="mn-ag-sec" data-sec="run" hidden><h4>${t('Running')}<span></span></h4><div class="mn-ag-l"></div></section>
      <section class="mn-ag-sec" data-sec="idle" hidden><h4>${t('Idle')}<span></span><small>${t('Can take a follow-up')}</small></h4><div class="mn-ag-l"></div></section>
      <details class="mn-ag-sec mn-ag-done" data-sec="done" hidden><summary><h4>${t('Done')}<span></span></h4>${icon('chev', 'i mn-ag-chev')}</summary><div class="mn-ag-l"></div></details>`;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-suball]');
      const c = b?.closest<HTMLElement>('.mn-sub');
      if (c) subAll(c);
    });
    // A card's activity opening (a section unfolding) measures again.
    this.el.addEventListener('toggle', (e) => {
      const c = (e.target as HTMLElement).closest?.<HTMLElement>('.mn-sub');
      if (c) subFit(c);
    }, true);
  }

  private list(sec: AgentSec): HTMLElement {
    return this.el.querySelector<HTMLElement>(`[data-sec="${sec}"] > .mn-ag-l`)!;
  }

  cards(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>('.mn-sub'));
  }

  byId(id: string): HTMLElement | null {
    return id ? this.el.querySelector<HTMLElement>(`.mn-sub[data-id="${CSS.escape(id)}"]`) : null;
  }

  counts(): { running: number; total: number } {
    return { running: this.list('run').childElementCount, total: this.cards().length };
  }

  reset(): void {
    this.cards().forEach((c) => c.remove());
    this.seq = 0;
    this.marks.clear();
    this.rules.clear();
    this.ids.clear();
    this.el.querySelector<HTMLDetailsElement>('.mn-ag-done')!.open = false;
    this.paint();
  }

  add(c: HTMLElement): void {
    c.dataset.seq = String(++this.seq);
    PANEL.set(c, this);
    // A new task brings a name back that was done or removed.
    this.marks.delete(subSt(c).agent.toLowerCase());
    this.paintRules(c);
    this.place(c);
  }

  /** The chat's sub-agents as the server keeps them (after the cards were drawn). */
  apply(info: A.AgentsInfo | undefined): void {
    if (!info) return;
    for (const a of info.agents || []) {
      const k = a.agent.toLowerCase();
      if (a.state === 'done') this.marks.set(k, 'done');
      if (typeof a.instructions === 'string') this.rules.set(k, a.instructions);
      if (a.id) this.ids.set(k, a.id);
    }
    for (const n of info.removed || []) this.marks.set(n.toLowerCase(), 'removed');
    this.cards().forEach((c) => {
      this.paintRules(c);
      this.place(c);
    });
  }

  /** Mnemo changed a sub-agent: its state (done, removed), its instructions or its name. */
  mark(ev: A.AgentsEvent): void {
    const k = (ev.agent || '').toLowerCase();
    if (!k) return;
    if (ev.phase === 'meta' && ev.from && ev.from.toLowerCase() !== k) {
      for (const c of this.cards()) {
        const st = subSt(c);
        if (st.agent.toLowerCase() !== ev.from.toLowerCase()) continue;
        st.agent = ev.agent;
        c.querySelector('.mn-sub-t b')!.textContent = ev.agent;
        c.querySelector('.mn-sub-av')!.textContent = ev.agent.charAt(0).toUpperCase();
      }
    }
    if (typeof ev.instructions === 'string') this.rules.set(k, ev.instructions);
    if (ev.id) this.ids.set(k, ev.id);
    if (ev.phase === 'state' && ev.state) this.marks.set(k, ev.state);
    if (ev.phase === 'meta' && ev.state && ev.state !== 'done') this.marks.delete(k);
    this.cards().forEach((c) => {
      if (subSt(c).agent.toLowerCase() !== k) return;
      if (ev.phase === 'message' && ev.text && ev.call === c.dataset.id) subNote(c, 'chat', t('{mnemo}: {text}', { mnemo: A.MNEMO, text: ev.text }));
      this.paintRules(c);
      this.place(c);
    });
  }

  private paintRules(c: HTMLElement): void {
    const id = this.ids.get(subSt(c).agent.toLowerCase());
    if (id) subId(c, id);
    const r = this.rules.get(subSt(c).agent.toLowerCase()) || '';
    const box = c.querySelector<HTMLElement>('.mn-sub-rules');
    if (!box) return;
    box.hidden = !r.trim();
    box.querySelector('p')!.textContent = r;
  }

  /** Put a card in the section its state says. A finished agent is idle while it is the
   *  latest run of that name (a follow-up goes on with it); older runs are done. */
  place(c: HTMLElement): void {
    const agent = subSt(c).agent;
    const n = seqOf(c);
    const mark = this.marks.get(agent.toLowerCase());
    // Removed from the list: its cards go.
    if (mark === 'removed' && !subBusy(c)) {
      c.remove();
      this.paint();
      return;
    }
    if (mark === 'done' && !subBusy(c)) {
      this.put(c, 'done');
      this.paint();
      return;
    }
    const same = (sec: AgentSec): HTMLElement[] =>
      Array.from(this.list(sec).children).filter((x): x is HTMLElement => x !== c && x instanceof HTMLElement && subSt(x).agent === agent);
    let sec: AgentSec = 'done';
    if (subBusy(c)) {
      sec = 'run';
      for (const o of same('idle')) if (seqOf(o) < n) this.put(o, 'done');
    } else if (c.dataset.state === 'done') {
      const idle = same('idle');
      if (!idle.some((o) => seqOf(o) > n) && !same('run').some((o) => seqOf(o) > n)) {
        sec = 'idle';
        idle.forEach((o) => this.put(o, 'done'));
      }
    }
    this.put(c, sec);
    this.paint();
  }

  private put(c: HTMLElement, sec: AgentSec): void {
    // Live work stays open only while the agent runs; after that it folds to one line.
    const act = c.querySelector<HTMLDetailsElement>('.mn-sub-act');
    if (act) {
      const want = sec === 'run' && c.dataset.folded !== '1';
      if (act.open !== want) {
        act.dataset.auto = '1';
        act.open = want;
      }
      const k = c.querySelectorAll('.mn-sub-log > .mn-tool').length;
      act.querySelector('em')!.textContent = k ? tn(k, '{n} tool', '{n} tools') : '';
    }
    const l = this.list(sec);
    if (c.parentElement === l) return;
    const n = seqOf(c);
    // The newest sub-agent of the chat first, in every section.
    const before = Array.from(l.children).find((x) => seqOf(x) < n);
    l.insertBefore(c, before || null);
  }

  private paint(): void {
    let total = 0;
    for (const sec of ['run', 'idle', 'done'] as AgentSec[]) {
      const box = this.el.querySelector<HTMLElement>(`[data-sec="${sec}"]`)!;
      const n = this.list(sec).childElementCount;
      total += n;
      box.hidden = !n;
      box.querySelector('h4 > span')!.textContent = String(n);
    }
    this.el.querySelector<HTMLElement>('.mn-ag-none')!.hidden = total > 0;
    this.changed();
  }

  /** Bring these agents into view (a running one first) and flash them. */
  reveal(ids: string[]): void {
    const cards = ids.map((id) => this.byId(id)).filter((x): x is HTMLElement => !!x);
    const c = cards.find(subBusy) || cards[0];
    if (!c) return;
    const done = c.closest<HTMLDetailsElement>('.mn-ag-done');
    if (done) done.open = true;
    c.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    for (const x of cards) {
      x.classList.remove('mn-flash');
      void x.offsetWidth;
      x.classList.add('mn-flash');
      window.setTimeout(() => x.classList.remove('mn-flash'), 2300);
    }
  }
}

/** The delegate call ids a reply's sub-agent line stands for. */
function teamIds(line: HTMLElement): string[] {
  return (LINE_CARDS.get(line) || []).map((c) => c.dataset.id || '');
}

/** A new card in the Agents panel for a `delegate` call; the reply gets (or adds to) the one
 *  line for the group of tasks it was sent with. */
function subCard(body: HTMLElement, id: string, args: unknown, panel: AgentsPanel): HTMLElement {
  const agent = argStr(args, 'agent') || t('Sub-agent');
  const task = argStr(args, 'task');
  let line = body.lastElementChild as HTMLElement | null;
  if (!line || !line.classList.contains('mn-team-line')) {
    line = el('button', 'mn-team-line');
    line.setAttribute('type', 'button');
    body.append(line);
    LINE_CARDS.set(line, []);
  }
  const c = el('div', 'mn-sub');
  c.dataset.id = id;
  c.dataset.state = 'run';
  c.innerHTML = `<div class="mn-sub-h"><span class="mn-sub-av" aria-hidden="true">${esc(agent.charAt(0).toUpperCase())}</span><span class="mn-sub-t"><b>${esc(
    agent,
  )}</b><small></small></span><span class="mn-sub-chip"><i class="mn-spin"></i><span>${t('Working')}</span></span></div>
    <div class="mn-sub-m" hidden><span class="mn-sub-bar" title=""><i></i></span><span class="mn-sub-tok"></span></div>
    <details class="mn-sub-acc mn-sub-ins"><summary>${icon('chev', 'i mn-sub-chev')}<span>${t('Instruction')}</span></summary><div class="mn-sub-body"><p class="mn-sub-task">${task ? esc(task) : '—'}</p><div class="mn-sub-rules" hidden><b>${t('Instructions from {mnemo}', { mnemo: A.MNEMO })}</b><p></p></div></div></details>
    <details class="mn-sub-acc mn-sub-act" open><summary>${icon('chev', 'i mn-sub-chev')}<span>${t('Activity')}</span><em></em></summary><div class="mn-sub-body"><p class="mn-sub-empty">${t('No activity yet')}</p><div class="mn-sub-log mn-tools"></div><div class="mn-sub-pre" hidden></div><button type="button" class="mn-sub-all" data-suball hidden aria-expanded="false">${t('Show all')}</button></div></details>
    <details class="mn-sub-acc mn-sub-ans"><summary>${icon('chev', 'i mn-sub-chev')}<span>${t('Answer')}</span><em class="mn-sub-ans-s">${t('Still running')}</em></summary><div class="mn-sub-body"><div class="mn-md"><p class="mn-sub-empty">${t('Still running')}</p></div></div></details>`;
  SUBS.set(c, { agent, model: '', text: '', step: 0, window: 0, tin: 0, tout: 0, context: 0 });
  // Its activity folds when the owner folds it, also while it runs.
  c.querySelector('.mn-sub-act')!.addEventListener('toggle', (e) => {
    if ((e.target as HTMLDetailsElement).dataset.auto !== '1') c.dataset.folded = (e.target as HTMLDetailsElement).open ? '' : '1';
    (e.target as HTMLDetailsElement).dataset.auto = '';
  });
  CARD_LINE.set(c, line);
  LINE_CARDS.get(line)!.push(c);
  panel.add(c);
  paintTeam(line);
  return c;
}

function subSt(c: HTMLElement): SubState {
  let st = SUBS.get(c);
  if (!st) {
    st = { agent: c.querySelector('.mn-sub-t b')?.textContent || t('Sub-agent'), model: '', text: '', step: 0, window: 0, tin: 0, tout: 0, context: 0 };
    SUBS.set(c, st);
  }
  return st;
}

function subChip(c: HTMLElement, state: 'run' | 'ask' | 'done' | 'err' | 'stop', text: string): void {
  const moved = c.dataset.state !== state;
  c.dataset.state = state;
  const chip = c.querySelector<HTMLElement>('.mn-sub-chip')!;
  const lead = state === 'run' || state === 'ask' ? '<i class="mn-spin"></i>' : icon(state === 'done' ? 'check' : state === 'err' ? 'alert' : 'stop');
  chip.innerHTML = `${lead}<span>${esc(text)}</span>`;
  if (moved) PANEL.get(c)?.place(c);
  const line = CARD_LINE.get(c);
  if (line) paintTeam(line);
}

function subMeta(c: HTMLElement, followUp?: boolean): void {
  const st = subSt(c);
  const small = c.querySelector<HTMLElement>('.mn-sub-t small')!;
  if (followUp !== undefined) c.classList.toggle('follow', followUp);
  // The model is a button: switch this sub-agent's model, like the chat's own.
  const model = st.model
    ? `<button type="button" class="mn-sub-model" data-submodel title="${t("Switch {agent}'s model", { agent: attr(st.agent) })}">${esc(A.modelLabel(A.mnemoState(), st.model))}${icon('chev-down')}</button>`
    : '';
  small.innerHTML = [model, c.classList.contains('follow') ? t('Follow-up') : ''].filter(Boolean).join(' · ');
}

function subMeter(c: HTMLElement): void {
  const st = subSt(c);
  const m = c.querySelector<HTMLElement>('.mn-sub-m')!;
  if (!st.tin && !st.tout && !st.context) return;
  m.hidden = false;
  const bar = m.querySelector<HTMLElement>('.mn-sub-bar')!;
  const pct = st.window ? Math.min(100, (st.context / st.window) * 100) : 0;
  bar.hidden = !st.window;
  bar.classList.toggle('hi', pct >= 85);
  bar.querySelector<HTMLElement>('i')!.style.width = pct.toFixed(1) + '%';
  bar.title = st.window ? t('Memory used: {used} of {win}', { used: fmtT(st.context), win: fmtT(st.window) }) : '';
  m.querySelector<HTMLElement>('.mn-sub-tok')!.textContent = `${st.window ? `${t('{used} of {win}', { used: fmtT(st.context), win: fmtT(st.window) })} · ` : ''}${t('{tin} in · {tout} out', { tin: fmtT(st.tin), tout: fmtT(st.tout) })}`;
}

/** A tool the sub-agent runs: the same step card as the chat's own tools. */
function subLogTool(c: HTMLElement, name: string, args: unknown): void {
  const d = el('details', 'mn-tool run' + (changesNotes(name) ? ' w' : ''));
  d.dataset.name = name;
  const [title, sub] = toolTitle(name, args);
  const ic = name === 'describe_image' || name === 'generate_image' ? 'image' : changesNotes(name) ? 'edit' : 'search';
  const shown = args !== null && args !== undefined;
  d.innerHTML = `<summary><span class="mn-tool-ic">${icon(ic)}</span><span class="mn-tool-t"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="mn-tool-s"><i class="mn-spin"></i></span>${icon('chev', 'i mn-tool-chev')}</summary>
    <div class="mn-tool-b"><div class="mn-tool-k">${esc(name)}</div>${shown ? `<pre>${esc(pretty(args, 1200))}</pre>` : ''}</div>`;
  c.querySelector('.mn-sub-log')!.prepend(d);
  subFit(c);
}

function subLogToolEnd(c: HTMLElement, name: string, ok: boolean, summary: string): void {
  let d = Array.from(c.querySelectorAll<HTMLElement>('.mn-sub-log > .mn-tool.run')).find((x) => x.dataset.name === name);
  if (!d) {
    subLogTool(c, name, null);
    d = c.querySelector<HTMLElement>('.mn-sub-log')!.firstElementChild as HTMLElement;
  }
  d.classList.remove('run');
  d.classList.add(ok ? 'ok' : 'err');
  const line = ts(summary);
  d.querySelector<HTMLElement>('.mn-tool-s')!.innerHTML = `${icon(ok ? 'check' : 'alert')}<span>${esc(line || (ok ? t('Done') : t('Failed')))}</span>`;
  if (line) d.querySelector('.mn-tool-b')!.insertAdjacentHTML('beforeend', `<div class="mn-tool-k">${t('Result')}</div><pre>${esc(line)}</pre>`);
}

function subLogAsk(c: HTMLElement, question: string, answer?: string): void {
  const agent = subSt(c).agent;
  const log = c.querySelector('.mn-sub-log')!;
  let li = answer === undefined ? null : log.querySelector<HTMLElement>('.mn-sub-li.ask.wait');
  if (!li) {
    li = el('div', 'mn-sub-li ask' + (answer === undefined ? ' wait' : ''));
    li.innerHTML = `${icon('chat')}<span class="mn-sub-x"><span><b>${esc(agent)} → ${A.MNEMO}:</b> ${esc(question)}</span></span>`;
    log.prepend(li);
  }
  if (answer !== undefined) {
    li.classList.remove('wait');
    li.querySelector('.mn-sub-x')!.insertAdjacentHTML('beforeend', `<span><b>${A.MNEMO} → ${esc(agent)}:</b> ${esc(answer)}</span>`);
  }
}

/** A quiet line in a sub-agent's activity (a model switch, a summary, an error). */
function subNote(c: HTMLElement, ic: string, text: string, cls = ''): void {
  c.querySelector('.mn-sub-log')!.insertAdjacentHTML('afterbegin', `<div class="mn-sub-li${cls ? ' ' + cls : ''}">${icon(ic)}<span>${esc(text)}</span></div>`);
  subFit(c);
}

/** A sub-agent's activity, newest first, stays a short window (scrollable, fading out at the
 *  bottom) with Show all when there is more; expanded it follows its content. */
function subFit(c: HTMLElement): void {
  const log = c.querySelector<HTMLElement>('.mn-sub-log');
  const btn = c.querySelector<HTMLButtonElement>('.mn-sub-all');
  if (!log || !btn) return;
  requestAnimationFrame(() => {
    const all = log.classList.contains('all');
    if (all) log.style.maxHeight = `${log.scrollHeight}px`;
    else if (log.scrollTop < 40) log.scrollTop = 0;
    const more = all || log.scrollHeight > log.clientHeight + 4;
    btn.hidden = !more;
    log.classList.toggle('more', more && !all);
  });
}

/** Show all of a sub-agent's activity (it grows down smoothly) or fold it back (it rises). */
function subAll(c: HTMLElement): void {
  const log = c.querySelector<HTMLElement>('.mn-sub-log');
  const btn = c.querySelector<HTMLButtonElement>('.mn-sub-all');
  if (!log || !btn) return;
  const open = !log.classList.contains('all');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (open) {
    log.style.maxHeight = `${log.clientHeight}px`;
    void log.offsetHeight;
    log.classList.add('all');
    log.classList.remove('more');
    log.style.maxHeight = `${log.scrollHeight}px`;
    window.setTimeout(() => btn.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' }), calm ? 0 : 320);
  } else {
    log.style.maxHeight = `${log.scrollHeight}px`;
    void log.offsetHeight;
    log.classList.remove('all');
    log.style.maxHeight = '';
    log.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
    c.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
    window.setTimeout(() => subFit(c), calm ? 0 : 360);
  }
  btn.textContent = open ? t('Show less') : t('Show all');
  btn.setAttribute('aria-expanded', String(open));
}

/** One progress event of a running sub-agent. */
function subEvent(c: HTMLElement, ev: A.SubEvent): void {
  const st = subSt(c);
  if (ev.model && ev.model !== st.model) {
    st.model = ev.model;
    subMeta(c);
  }
  const pre = c.querySelector<HTMLElement>('.mn-sub-pre')!;
  switch (ev.phase) {
    case 'start':
      if (ev.window) st.window = ev.window;
      // Picked by its id: the card takes the sub-agent's own name.
      if (ev.agent && ev.agent !== st.agent) {
        st.agent = ev.agent;
        c.querySelector('.mn-sub-t b')!.textContent = ev.agent;
        c.querySelector('.mn-sub-av')!.textContent = ev.agent.charAt(0).toUpperCase();
      }
      if (ev.aid) subId(c, ev.aid);
      subMeta(c, !!ev.follow_up);
      break;
    case 'step':
      st.step = ev.step || st.step + 1;
      st.text = '';
      pre.hidden = true;
      subChip(c, 'run', t('Working · step {n}', { n: st.step }));
      break;
    case 'text': {
      st.text += ev.delta || '';
      const line = st.text.trim().split(/\n+/).pop() || '';
      pre.textContent = line.length > 160 ? '…' + line.slice(-160) : line;
      pre.hidden = !line;
      break;
    }
    case 'tool':
      subLogTool(c, ev.name || '', ev.args);
      break;
    case 'tool_end':
      subLogToolEnd(c, ev.name || '', ev.ok !== false, ev.summary || '');
      break;
    case 'ask':
      subLogAsk(c, ev.question || '');
      subChip(c, 'ask', t('Asking {mnemo}', { mnemo: A.MNEMO }));
      break;
    case 'answer':
      subLogAsk(c, '', ev.answer || '');
      subChip(c, 'run', st.step ? t('Working · step {n}', { n: st.step }) : t('Working'));
      break;
    case 'usage':
      if (typeof ev.input_tokens === 'number') st.tin = ev.input_tokens;
      if (typeof ev.output_tokens === 'number') st.tout = ev.output_tokens;
      if (typeof ev.context === 'number') st.context = ev.context;
      if (ev.window) st.window = ev.window;
      subMeter(c);
      break;
    case 'done':
      pre.hidden = true;
      subChip(c, 'done', tn(ev.steps ?? st.step, 'Done · {n} step', 'Done · {n} steps'));
      break;
    case 'fallback':
    case 'switched': {
      const s = A.mnemoState();
      const to = s ? A.modelLabel(s, ev.to || '') : ev.to || '';
      subNote(c, 'refresh', ev.phase === 'fallback' ? t('{from} did not answer ({reason}); {to} carries on', { from: (s ? A.modelLabel(s, ev.from || '') : ev.from) || '', reason: ev.reason ? ts(ev.reason) : t('error'), to }) : t('Switched to {model}', { model: to }));
      break;
    }
    case 'notice':
      if (ev.text) subNote(c, 'info', ts(ev.text));
      break;
    case 'compacting':
      subChip(c, 'run', t('Summarising its work'));
      break;
    case 'compacted':
      subNote(c, 'sparkle', t('Summarised {n} earlier messages to make room', { n: ev.messages ?? '' }));
      subChip(c, 'run', st.step ? t('Working · step {n}', { n: st.step }) : t('Working'));
      break;
    case 'error':
      pre.hidden = true;
      if (ev.message) subNote(c, 'alert', ts(ev.message), 'err');
      subChip(c, 'err', t('Failed'));
      break;
    case 'final':
      // A sub-agent in the background answered.
      subFinal(c, ev.output, ev.ok !== false);
      break;
    case 'stopped':
      pre.hidden = true;
      subNote(c, 'stop', t('{mnemo} stopped it', { mnemo: A.MNEMO }));
      subAnswer(c, '', t('No answer'));
      c.dataset.filled = '1';
      subChip(c, 'stop', t('Stopped'));
      break;
    case 'inbox':
      subNote(c, 'chat', tn(ev.count || 1, 'Read a message from {mnemo}', 'Read {n} messages from {mnemo}', { mnemo: A.MNEMO }));
      break;
  }
}

/** The task's result: totals, the steps when the card was drawn from the stored chat, and
 *  the answer (closed until opened). */
function subFinal(c: HTMLElement, output: unknown, ok: boolean): void {
  if (c.dataset.filled) return;
  c.dataset.filled = '1';
  const o = (parseOut(output) || {}) as A.SubResult;
  const st = subSt(c);
  if (o.model) st.model = o.model;
  if (typeof o.input_tokens === 'number') st.tin = o.input_tokens;
  if (typeof o.output_tokens === 'number') st.tout = o.output_tokens;
  if (typeof o.context === 'number') st.context = o.context;
  if (o.window) st.window = o.window;
  subMeta(c, o.follow_up ?? c.classList.contains('follow'));
  subMeter(c);
  const log = c.querySelector<HTMLElement>('.mn-sub-log')!;
  if (!log.childElementCount && o.log?.length) {
    for (const x of o.log) {
      if (x.kind === 'tool') {
        subLogTool(c, x.name, null);
        subLogToolEnd(c, x.name, x.ok, x.summary);
      } else subLogAsk(c, x.question, x.answer);
    }
  }
  c.querySelector<HTMLElement>('.mn-sub-pre')!.hidden = true;
  const err = typeof o.error === 'string' && o.error ? o.error : '';
  if (!ok || err) {
    if (err && !log.querySelector('.mn-sub-li.err')) subNote(c, 'alert', ts(err), 'err');
    subAnswer(c, '', t('No answer'));
    subChip(c, 'err', t('Failed'));
    return;
  }
  const steps = o.steps ?? st.step;
  subAnswer(c, o.answer ? renderReply(o.answer) : '', o.answer ? '' : '—');
  subChip(c, 'done', steps ? tn(steps, 'Done · {n} step', 'Done · {n} steps') : t('Done'));
}

/** The sub-agent's id (a1, a2, …) beside its name: the owner and Mnemo can point at it by id. */
function subId(c: HTMLElement, id: string): void {
  const b = c.querySelector<HTMLElement>('.mn-sub-t b');
  if (!id || !b) return;
  c.dataset.aid = id;
  // Inside the name line (a rename rewrites the name, so it is put back each time).
  let tag = b.querySelector<HTMLElement>('.mn-sub-id');
  if (!tag) {
    tag = el('code', 'mn-sub-id');
    b.append(tag);
  }
  tag.textContent = id;
  tag.title = t('Sub-agent id');
}

/** The Answer section: the answer, or a word when there is none. */
function subAnswer(c: HTMLElement, html: string, none: string): void {
  const box = c.querySelector<HTMLElement>('.mn-sub-ans .mn-md');
  const s = c.querySelector<HTMLElement>('.mn-sub-ans-s');
  if (!box || !s) return;
  box.innerHTML = html || `<p class="mn-sub-empty">${esc(none)}</p>`;
  s.textContent = html ? '' : none;
}

/** A task cut off with the reply. */
function subStop(c: HTMLElement): void {
  if (c.dataset.filled) return;
  c.dataset.filled = '1';
  subAnswer(c, '', t('No answer'));
  c.querySelector<HTMLElement>('.mn-sub-pre')!.hidden = true;
  c.querySelectorAll<HTMLElement>('.mn-sub-log > .mn-tool.run').forEach((d) => {
    d.classList.remove('run');
    d.querySelector<HTMLElement>('.mn-tool-s')!.innerHTML = `${icon('stop')}<span>${t('Stopped')}</span>`;
  });
  c.querySelectorAll('.mn-sub-li.wait').forEach((x) => x.classList.remove('wait'));
  subChip(c, 'stop', t('Stopped'));
}

/** The one line a group of sub-agents leaves in the reply: how many, how many are working
 *  or done, and View (opens the Agents panel there). */
function paintTeam(line: HTMLElement): void {
  const cards = LINE_CARDS.get(line) || [];
  const n = cards.length;
  if (!n) return;
  const busy = cards.filter(subBusy).length;
  const done = cards.filter((c) => c.dataset.state === 'done').length;
  const failed = cards.filter((c) => c.dataset.state === 'err').length;
  const stopped = cards.filter((c) => c.dataset.state === 'stop').length;
  const text =
    n === 1
      ? `${subSt(cards[0]).agent} · ${cards[0].querySelector('.mn-sub-chip span')?.textContent || t('Working')}`
      : [t('{n} sub-agents', { n }), busy ? t('{n} working', { n: busy }) : '', done ? t('{n} done', { n: done }) : '', failed ? t('{n} failed', { n: failed }) : '', stopped ? t('{n} stopped', { n: stopped }) : ''].filter(Boolean).join(' · ');
  const lead = busy ? '<i class="mn-spin"></i>' : icon(failed ? 'alert' : stopped && !done ? 'stop' : 'check');
  line.className = 'mn-team-line ' + (busy ? 'run' : failed ? 'err' : stopped && !done ? 'stop' : 'ok');
  line.innerHTML = `<span class="mn-team-ic">${lead}</span><span class="mn-team-t">${esc(text)}</span><span class="mn-team-go">${t('View')}${icon('chev')}</span>`;
  const tip = t('{text}. Open the Agents panel', { text });
  line.title = tip;
  line.setAttribute('aria-label', tip);
}

/** A quiet line in a reply: Mnemo noted, changed or forgot something about the owner. */
function memLine(id: string, name: string, args: unknown): HTMLElement {
  const d = el(
    'div',
    'mn-memline',
    `${icon('user')}<span>${esc(ownerMemoryText(name, args))}</span><button type="button" class="mn-memline-a" data-seemem>${t('See all')}</button>`,
  );
  d.dataset.id = id;
  return d;
}

function endMemLine(body: HTMLElement, id: string, ok: boolean): void {
  const d = body.querySelector<HTMLElement>(`.mn-memline[data-id="${CSS.escape(id)}"]`);
  if (!d || ok) return;
  d.classList.add('err');
  d.querySelector('span')!.textContent = t('Could not change what I know about you');
}

// ---- chat width (per device) ----

export type ChatWidth = 'compact' | 'wide' | 'full';
const LS_WIDTH = 'memora.mnemo.width.v1';

export function chatWidth(): ChatWidth {
  try {
    const v = localStorage.getItem(LS_WIDTH);
    if (v === 'wide' || v === 'full') return v;
  } catch {
    /* storage blocked */
  }
  return 'compact';
}

/** Keep the width on this device and apply it to every chat open. */
export function setChatWidth(w: ChatWidth): void {
  try {
    localStorage.setItem(LS_WIDTH, w);
  } catch {
    /* storage blocked: this visit only */
  }
  document.querySelectorAll<HTMLElement>('.mn-chat').forEach((c) => {
    c.classList.remove('w-compact', 'w-wide', 'w-full');
    c.classList.add('w-' + w);
  });
}

/** A small searchable list of notes; `run` gets the chosen path. */
function pickNote(run: (paths: string[]) => void, room = 8): void {
  const body = el('div', 'mn-pick');
  body.innerHTML = `<label class="mn-pick-q">${icon('search')}<input type="search" placeholder="${t('Search notes')}" autocomplete="off" aria-label="${t('Search notes')}"></label><div class="mn-pick-l" role="listbox" aria-multiselectable="true"></div>`;
  const input = body.querySelector('input')!;
  const list = body.querySelector<HTMLElement>('.mn-pick-l')!;
  const picked: string[] = [];
  const notes = allNotes()
    .map((n) => ({ path: n.path, title: noteTitle(n.path) || n.name, folder: n.folder }))
    .sort((a, b) => a.title.localeCompare(b.title));
  let go: HTMLButtonElement | null = null;
  const paintGo = (): void => {
    if (!go) return;
    go.disabled = !picked.length;
    go.textContent = picked.length > 1 ? t('Attach {n} notes', { n: picked.length }) : t('Attach');
  };
  const paint = (): void => {
    const q = input.value.trim().toLowerCase();
    const hits = notes.filter((n) => !q || n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)).slice(0, 60);
    list.innerHTML = hits.length
      ? hits
          .map((n) => {
            const on = picked.includes(n.path);
            return `<button type="button" class="mn-pick-i${on ? ' on' : ''}" role="option" aria-selected="${on}" data-p="${attr(n.path)}">${icon('note')}<span><b>${esc(n.title)}</b><small>${esc(
              n.folder || t('Top level'),
            )}</small></span><i class="mn-pick-ck" aria-hidden="true">${icon('check')}</i></button>`;
          })
          .join('')
      : `<p class="mn-pick-none">${t('No note matches.')}</p>`;
  };
  input.oninput = paint;
  list.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
    if (!b) return;
    const p = b.dataset.p!;
    const i = picked.indexOf(p);
    if (i >= 0) picked.splice(i, 1);
    else if (picked.length < room) picked.push(p);
    else return toast(t('Up to {n} more this message', { n: room }), 'warn');
    b.classList.toggle('on', i < 0);
    b.setAttribute('aria-selected', String(i < 0));
    paintGo();
  };
  paint();
  Modal.open({
    title: t('Notes'),
    body,
    actions: [
      { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
      {
        label: t('Attach'),
        cls: 'primary',
        run: () => {
          if (!picked.length) return;
          Modal.close();
          run(picked);
        },
      },
    ],
  });
  go = document.querySelector<HTMLButtonElement>('.modal-foot .btn.primary');
  paintGo();
  window.setTimeout(() => input.focus(), 40);
}

/** A touch screen with no mouse: its keyboard is the on-screen one. */
function touchKeyboard(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** A dropped connection rather than an answer from the server ("Failed to fetch", "network
 *  error", Safari's "Load failed", a body cut off part way). */
function lostLink(e: Error): boolean {
  return e.name === 'TypeError' || /network|failed to fetch|load failed|connection|terminated|aborted/i.test(e.message || '');
}
