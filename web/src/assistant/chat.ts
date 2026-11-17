// One Mnemo chat: the transcript (bubbles, tool cards), the composer, the model picker and
// the context meter. The page and the floating panel both use it.

import { attr, el, esc, useStyles } from '../dom';
import { relTs } from '../format';
import { hooks } from '../hooks';
import { toast } from '../toast';
import { icon } from '../ui/icons';
import { createSelect, type Select, type SelectOption } from '../ui/select';
import { requestSettingsSection } from '../version';
import { openDocs } from '../router';
import { Modal } from '../modal';
import { allNotes, noteTitle } from '../state';
import { pickFolderDialog } from '../vault/folder-picker';
import { pickerFolders } from '../vault/store';
import { VAULT_CSS } from '../vault/styles';
import { openMenu } from '../vault/ui';
import { nav } from '../vault/nav';
import { openLightbox } from '../ui/lightbox';
import * as A from './api';
import { renderReply, resolveNote } from './md';
import { closePreview, mountArt } from './art';
import { markSeen } from './unread';
import { MNEMO_CSS, markHTML } from './styles';
import { applyTextSize } from './textsize';

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
};

function toolWords(name: string): string {
  return TOOL_WORDS[name]?.[0] ?? name.replace(/_/g, ' ');
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
  if (Array.isArray(a.paths)) return `${a.paths.length} notes`;
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
  for (const k of ['path', 'from', 'source', 'target', 'into_path', 'note']) {
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
}

export class ChatView {
  readonly el: HTMLElement;
  private downBtn!: HTMLButtonElement;
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
  /** Messages typed while Mnemo works: sent one by one when each reply ends. */
  private queue: { id: number; text: string; attach: A.Attach[] }[] = [];
  private qid = 0;
  /** The owner pressed Stop: the queue waits instead of going out. */
  private halted = false;
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
  private offState: () => void;

  constructor(private o: ChatOptions) {
    useStyles('mnemo-css', MNEMO_CSS);
    this.el = el('div', 'mn-chat' + (o.compact ? ' compact' : ''));
    this.el.innerHTML = `
      <div class="mn-log" role="log" aria-live="polite" aria-label="Conversation with ${A.MNEMO}"></div>
      <nav class="mn-rail" aria-label="Jump to a message" hidden></nav>
      <form class="mn-comp" autocomplete="off">
        <button type="button" class="mn-down" aria-label="Scroll to the bottom" title="Scroll to the bottom" tabindex="-1">${icon('chev-down')}</button>
        <div class="mn-comp-box">
          <div class="mn-queue" hidden></div>
          <div class="mn-att" aria-live="polite"><div class="mn-att-in"></div></div>
          <textarea rows="1" maxlength="40000" placeholder="Ask ${A.MNEMO} about your notes…" aria-label="Message to ${A.MNEMO}"></textarea>
          <div class="mn-comp-bar">
            <button type="button" class="mn-plus" aria-label="Attach notes or folders from your vault" title="Attach notes or folders from your vault">${icon('plus')}</button>
            <button type="button" class="mn-perm" hidden></button>
            <span class="mn-grow"></span>
            <span class="mn-model-slot"></span>
            <button type="button" class="mn-pin" hidden>${icon('pin')}</button>
            <button type="button" class="mn-meter" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" class="t"/><circle cx="10" cy="10" r="7.5" class="v" pathLength="100"/></svg></button>
            <button type="submit" class="mn-send" aria-label="Send">${icon('send')}</button>
          </div>
        </div>
        <p class="mn-fine">${A.MNEMO} only works in your notes. Each change shows in Activity and can be undone from History.</p>
      </form>`;
    this.log = this.el.querySelector('.mn-log')!;
    this.input = this.el.querySelector('textarea')!;
    this.sendBtn = this.el.querySelector('.mn-send')!;
    this.plusEl = this.el.querySelector('.mn-plus')!;
    this.attEl = this.el.querySelector('.mn-att')!;
    this.meter = this.el.querySelector('.mn-meter')!;
    this.modelSlot = this.el.querySelector('.mn-model-slot')!;
    this.pinBtn = this.el.querySelector('.mn-pin')!;
    this.pinBtn.onclick = () => void this.togglePin();
    const perm = this.el.querySelector<HTMLButtonElement>('.mn-perm')!;
    perm.onclick = () => {
      const s = A.mnemoState();
      const next = s?.prefs.permission === 'auto' ? 'ask' : 'auto';
      void A.savePrefs({ permission: next })
        .then(() => toast(next === 'auto' ? `Auto: ${A.MNEMO} makes changes without asking and keeps going until done` : `Ask first: ${A.MNEMO} asks before it changes your notes`, 'ok'))
        .catch((e) => toast((e as Error).message, 'err'));
    };
    this.rail = this.el.querySelector('.mn-rail')!;
    this.wireRail();
    this.log.addEventListener('scroll', () => {
      if (!this.railFrame) this.railFrame = requestAnimationFrame(() => this.syncRail());
    }, { passive: true });
    this.downBtn = this.el.querySelector('.mn-down')!;
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
    const away = (t: EventTarget | null): boolean =>
      t instanceof Element && !form.contains(t) && !t.closest('[role=menu],[role=dialog],[role=listbox],.ui-sel-pop,.vx-menu');
    form.addEventListener('focusin', () => {
      this.focused = true;
      // The keyboard takes half the screen on phones: keep the latest reply in sight.
      window.setTimeout(() => this.scrollEnd(), 320);
      this.paintOpen();
    });
    form.addEventListener('focusout', () => {
      window.setTimeout(() => {
        const a = document.activeElement;
        if (a && a !== document.body && away(a)) this.fold();
      }, 0);
    });
    const outside = (e: PointerEvent): void => {
      if (this.focused && away(e.target)) this.fold();
    };
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
      const row = b?.closest<HTMLElement>('[data-q]');
      if (!b || !row) return;
      const id = Number(row.dataset.q);
      const i = this.queue.findIndex((q) => q.id === id);
      if (i < 0) return;
      const act = b.dataset.qa;
      if (act === 'del') this.queue.splice(i, 1);
      else if (act === 'up' && i > 0) [this.queue[i - 1], this.queue[i]] = [this.queue[i], this.queue[i - 1]];
      else if (act === 'down' && i < this.queue.length - 1) [this.queue[i + 1], this.queue[i]] = [this.queue[i], this.queue[i + 1]];
      else if (act === 'steer') {
        void this.steerNow(this.queue[i].text, id);
        return;
      }
      this.paintQueue();
    });
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
      if (!dragQ || !to || to === dragQ) return;
      e.preventDefault();
      const from = this.queue.findIndex((q) => q.id === dragQ);
      const item = this.queue.splice(from, 1)[0];
      this.queue.splice(this.queue.findIndex((q) => q.id === to), 0, item);
      dragQ = 0;
      this.paintQueue();
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
      const t = e.target as HTMLElement;
      if (t.closest('[data-setup]')) openMnemoSettings();
      else if (t.closest('.mn-meter')) this.contextMenu();
      else if (t.classList.contains('mn-comp-box')) this.focus();
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
    this.offState = A.onState(() => this.paintModels());
    void A.loadState().then(() => {
      this.paintModels();
      if (!this.session) this.paintEmpty();
    });
    this.blank();
  }

  destroy(): void {
    this.detach();
    this.offOutside();
    this.offState();
    this.select?.close();
  }

  focus(): void {
    this.input.focus({ preventScroll: true });
  }

  /** Bring message `mid` into view and flash it (a search hit). */
  reveal(mid: number): void {
    const t = this.log.querySelector<HTMLElement>(`[data-mid="${mid}"]`);
    if (!t) return;
    t.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    t.classList.remove('mn-flash');
    void t.offsetWidth;
    t.classList.add('mn-flash');
    window.setTimeout(() => t.classList.remove('mn-flash'), 2200);
  }

  /** Everything this chat attached, used, changed or showed (the artifacts panel). */
  artifacts(): Artifact[] {
    return artifactsOf(this.messages);
  }

  /** Put what is typed in the queue (Mnemo is busy). */
  private enqueue(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.queue.push({ id: ++this.qid, text, attach: this.attach.slice() });
    this.input.value = '';
    this.attach = [];
    this.paintAtt();
    this.grow();
    this.paintQueue();
    this.paintSend();
  }

  private sendQueued(): void {
    if (this.busy) return;
    const next = this.queue.shift();
    this.paintQueue();
    if (!next) return;
    this.attach = next.attach;
    this.paintAtt();
    void this.send(next.text);
  }

  /** Give the running reply a message it reads before its next step. */
  private async steerNow(raw: string, fromQueue?: number): Promise<void> {
    const text = raw.trim();
    if (!text || !this.session) return;
    try {
      await A.steerChat(this.session.id, text);
      if (fromQueue) this.queue = this.queue.filter((q) => q.id !== fromQueue);
      else {
        this.input.value = '';
        this.grow();
      }
      this.paintQueue();
      this.paintSend();
    } catch (e) {
      toast(`${(e as Error).message}`, 'warn');
      if (!fromQueue) this.enqueue();
    }
  }

  /** The queue above the prompt: reorder, steer now, or drop each message. */
  private paintQueue(): void {
    const box = this.el.querySelector<HTMLElement>('.mn-queue')!;
    box.hidden = !this.queue.length;
    if (!this.queue.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `<div class="mn-queue-h">${icon('chat')}<span>Queued: goes out when ${A.MNEMO} finishes</span></div>${this.queue
      .map(
        (q, i) => `<div class="mn-q-i" data-q="${q.id}" draggable="true"><span class="mn-q-n">${i + 1}</span><span class="mn-q-t" title="${attr(q.text)}">${esc(q.text)}${
          q.attach.length ? ` <small>+${q.attach.length}</small>` : ''
        }</span><span class="mn-q-a">${
          this.busy ? `<button type="button" class="mn-ibtn" data-qa="steer" title="Steer this reply now: Mnemo reads it before its next step" aria-label="Steer now">${icon('enter')}</button>` : ''
        }<button type="button" class="mn-ibtn" data-qa="up" title="Move up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>${icon('arrow')}</button><button type="button" class="mn-ibtn" data-qa="down" title="Move down" aria-label="Move down"${
          i === this.queue.length - 1 ? ' disabled' : ''
        }>${icon('arrow')}</button><button type="button" class="mn-ibtn" data-qa="del" title="Remove" aria-label="Remove">${icon('close')}</button></span></div>`,
      )
      .join('')}`;
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
      toast('Up to 8 notes or folders per message', 'warn');
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
          `<span class="mn-att-c${a.kind === 'image' ? ' img' : ''}" style="--i:${i}" data-at="${i}" title="${attr(a.kind === 'image' ? `${a.title} (tap to preview)` : a.path || 'All notes')}">${
            a.kind === 'image' && a.url ? `<img alt="" src="${attr(a.url)}">` : icon(a.kind === 'note' ? 'note' : a.kind === 'image' ? 'image' : 'folder')
          }<span>${esc(a.title)}</span>${
            a.kind === 'folder' && a.notes ? `<small>${a.notes}</small>` : ''
          }<button type="button" data-unattach="${i}" aria-label="Remove ${attr(a.title)}" title="Remove">${icon('close')}</button></span>`,
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
          ? [{ label: `This ${here.kind} · ${A.scopeLabel(ctx)}`, icon: icon(here.kind === 'note' ? 'note' : 'folder', 'vx-i'), run: () => this.addAttach({ ...here, title: A.scopeLabel(ctx) }) }]
          : []),
        { label: 'Image', icon: icon('image', 'vx-i'), run: () => this.pickImages() },
        { label: 'Notes', icon: icon('note', 'vx-i'), run: () => pickNote((ps) => ps.forEach((p) => this.addAttach({ kind: 'note', path: p, title: nameOf(p) })), 8 - this.attach.length) },
        {
          label: 'Folder',
          icon: icon('folder', 'vx-i'),
          run: () =>
            pickFolderDialog({
              title: 'Folder',
              folders: pickerFolders(),
              verb: 'Attach',
              run: (f) => this.addAttach({ kind: 'folder', path: f, title: f ? f.split('/').pop()! : 'All notes' }),
            }),
        },
        ...(has('folder', '') ? [] : [{ label: 'All notes', icon: icon('vault', 'vx-i'), run: () => this.addAttach({ kind: 'folder', path: '', title: 'All notes' }) }]),
      ],
      this.plusEl,
    );
  }

  /** A capsule at rest; focused (or holding text, attachments or a running reply) it opens up
   *  with +, the model and the context meter while the placeholder still shows. */
  private paintOpen(): void {
    const open = this.focused || this.busy || !!this.input.value.trim() || this.attach.length > 0;
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
    if (files.length > room) toast(`Up to ${IMAGES_PER_MESSAGE} images per message`, 'warn');
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
    pop.setAttribute('aria-label', 'Chat memory');
    const n = c?.compactions || 0;
    pop.innerHTML = `<div class="mn-cx-h"><b>Chat memory</b><small>${esc(A.modelLabel(s, key))}</small></div>
      <div class="mn-cx-bar" style="--p:${pct.toFixed(1)}%;--c:${win ? ((at / win) * 100).toFixed(1) : 75}%"><i></i><u title="Compacts here"></u></div>
      <div class="mn-cx-n"><b>${A.fmtTokens(used)}</b> of ${A.fmtTokens(win)} tokens · ${Math.round(pct)}%</div>
      <p>${this.session ? 'This chat' : 'A chat'} keeps everything from its first message to the last for this model. Near ${A.fmtTokens(at)} tokens ${A.MNEMO} folds the older messages into a summary and carries on.</p>
      ${n ? `<p class="mn-cx-k">${icon('refresh')}<span>Compacted ${n === 1 ? 'once' : `${n} times`} so far.</span></p>` : ''}
      <div class="mn-cx-a">${this.session && this.messages.length > 2 ? `<button type="button" class="btn sm" data-cx="compact">Compact now</button>` : ''}<button type="button" class="btn ghost sm" data-cx="new">${icon('plus')}<span>New chat</span></button></div>`;
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
      b.textContent = 'Compacting…';
      close();
      const live = this.compactLive();
      this.log.append(live);
      this.scrollEnd(true);
      try {
        const res = await A.compactSession(this.session.id);
        live.remove();
        toast(res.ok ? `Compacted ${res.messages} older messages into a summary` : res.reason || 'Nothing to compact yet', res.ok ? 'ok' : 'info');
        if (res.ok) await this.open(this.session.id);
        else this.setContext(res.context);
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
      toast(isDefault ? 'New chats use the first pinned model again' : `New chats now start with ${A.modelLabel(s, key)}, here and in the terminal`, 'ok');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  /** The permission chip: Ask first (changes wait for an OK) or Auto. */
  private paintPerm(): void {
    const b = this.el.querySelector<HTMLButtonElement>('.mn-perm');
    const s = A.mnemoState();
    if (!b) return;
    b.hidden = !s || !A.usableModels(s).length;
    if (b.hidden || !s) return;
    const auto = s.prefs.permission === 'auto';
    b.classList.toggle('auto', auto);
    b.innerHTML = `${icon(auto ? 'bolt' : 'shield')}<span>${auto ? 'Auto' : 'Ask first'}</span>`;
    const t = auto ? 'Auto: changes go ahead without asking. Tap for Ask first.' : 'Ask first: changes wait for your OK. Tap for Auto.';
    b.title = t;
    b.setAttribute('aria-label', t);
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
    const t = explicit ? 'Default for new chats. Tap to unpin.' : on ? 'Used for new chats (first pinned). Tap to make it the default.' : 'Use this model for new chats';
    this.pinBtn.title = t;
    this.pinBtn.setAttribute('aria-label', t);
    this.pinBtn.setAttribute('aria-pressed', String(explicit));
  }

  private setContext(c: A.ChatContext | null | undefined): void {
    if (!c) return;
    this.ctx = c;
    this.paintMeter(c.used, c.window);
  }

  // ---- timeline rail: one bar per question; tap, hover, or hold and slide to scrub ----

  private paintRail(): void {
    const us = Array.from(this.log.querySelectorAll<HTMLElement>('.mn-u'));
    const show = us.length >= 3;
    this.rail.hidden = !show;
    this.el.classList.toggle('has-rail', show);
    if (!show) return;
    // Bars share the rail's height: roomy for a few questions, tight for hundreds.
    const room = Math.max(120, this.el.clientHeight * 0.56);
    this.rail.style.setProperty('--rh', Math.max(3, Math.min(12, Math.floor(room / us.length))) + 'px');
    this.rail.innerHTML =
      us
        .map((u, i) => {
          const t = (u.querySelector('.mn-ub')?.textContent || '').trim();
          const w = 8 + Math.min(14, Math.round(Math.sqrt(t.length) * 1.4));
          return `<button type="button" class="mn-rb" data-at="${i}" style="--w:${w}px" aria-label="${attr(t.slice(0, 80) || 'Message')}" tabindex="-1"><i></i></button>`;
        })
        .join('') + '<span class="mn-rlab" aria-hidden="true"></span>';
    this.syncRail();
  }

  /** Tap a bar to jump; hover (mouse) or press and slide (touch, mouse) to scrub through
   *  the questions: the bars swell around the finger, the chat follows, a label says which. */
  private wireRail(): void {
    let pressed = false;
    let moved = false;
    let cur = -1;
    let hide = 0;
    const bars = (): HTMLElement[] => Array.from(this.rail.querySelectorAll<HTMLElement>('.mn-rb'));
    const at = (y: number): number => {
      const b = bars();
      if (!b.length) return -1;
      // The bar nearest the finger; above the first or below the last means that end.
      if (y <= b[0].getBoundingClientRect().bottom) return 0;
      if (y >= b[b.length - 1].getBoundingClientRect().top) return b.length - 1;
      let best = 0;
      let dist = Infinity;
      b.forEach((x, i) => {
        const r = x.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - y);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      return best;
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
      const u = this.log.querySelectorAll<HTMLElement>('.mn-u')[i];
      const t = (u?.querySelector('.mn-ub')?.textContent || '').trim();
      lab.innerHTML = `<b>${i + 1}/${bars().length}</b>${esc(t.slice(0, 90) || 'Message')}`;
      lab.style.top = b.offsetTop + b.offsetHeight / 2 + 'px';
      lab.classList.add('in');
      window.clearTimeout(hide);
    };
    const go = (i: number, smooth: boolean): void => {
      const us = this.log.querySelectorAll<HTMLElement>('.mn-u');
      const u = us[i];
      if (!u) return;
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
    const done = (): void => {
      swell(-1);
      cur = -1;
      this.rail.classList.remove('scrub');
      hide = window.setTimeout(() => this.rail.querySelector('.mn-rlab')?.classList.remove('in'), 500);
    };
    this.rail.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pressed = true;
      moved = false;
      this.rail.setPointerCapture(e.pointerId);
      this.rail.classList.add('scrub');
      cur = at(e.clientY);
      swell(cur);
      label(cur);
      e.preventDefault();
    });
    this.rail.addEventListener('pointermove', (e) => {
      if (!pressed && e.pointerType !== 'mouse') return;
      const i = at(e.clientY);
      if (i === cur) return;
      cur = i;
      swell(i);
      label(i);
      if (pressed) {
        moved = true;
        go(i, false);
        // A tick under the thumb for each question passed (phones that support it).
        navigator.vibrate?.(6);
      }
    });
    const up = (e: PointerEvent): void => {
      if (!pressed) return;
      pressed = false;
      const i = at(e.clientY);
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
    const us = this.log.querySelectorAll<HTMLElement>('.mn-u');
    const box = this.log.getBoundingClientRect().top;
    const mid = this.log.clientHeight * 0.35;
    let cur = 0;
    us.forEach((u, i) => {
      if (u.getBoundingClientRect().top - box <= mid) cur = i;
    });
    // At the very top or bottom the end bars light up, whatever is in the middle.
    if (top <= 8) cur = 0;
    else if (max - top <= 8) cur = us.length - 1;
    this.rail.querySelectorAll<HTMLElement>('.mn-rb').forEach((b, i) => b.classList.toggle('on', i === cur));
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
      `<div class="mn-earlier-h">${icon('chat')}<span><b>${list.length === 1 ? 'There is a chat' : `There are ${list.length} chats`} about ${esc(
        about.title,
      )}</b><small>Carry on in one, or just type below to start a new chat.</small></span></div>
      <div class="mn-earlier-l">${list
        .slice(0, 3)
        .map(
          (x) =>
            `<button type="button" class="mn-earlier-i" data-earlier="${attr(x.id)}"><span class="mn-earlier-t"><b>${esc(x.title)}</b><small>${esc(
              relTs(x.updated_at),
            )} · ${x.messages} message${x.messages === 1 ? '' : 's'}</small></span><span class="mn-earlier-go">Continue${icon('chev')}</span></button>`,
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
    this.paintEmpty();
  }

  /** Leave a fleeting chat: it is deleted on the server, images and all. */
  leaveFleeting(): void {
    if (!this.fleetingOn) return;
    const id = this.session?.id;
    this.fleetingOn = false;
    this.el.classList.remove('fleeting');
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
      box.setAttribute('aria-label', 'Skills');
      this.el.querySelector('form.mn-comp')!.append(box);
      box.addEventListener('mousedown', (e) => e.preventDefault());
      box.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-slash]');
        if (b) this.pickSlash(b.dataset.slash!);
      });
    }
    this.slash = { box, list: found, at: Math.min(this.slash?.at ?? 0, Math.max(0, found.length - 1)) };
    box.innerHTML =
      `<div class="mn-slash-h">${icon('bolt')}<span>Skills</span><small>kept in the Skills folder</small></div>` +
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
            list.length ? 'No skill by that name.' : `No skills yet. Ask ${A.MNEMO}, for example: “make a skill that tidies my meeting notes”.`
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
    this.session = null;
    this.messages = [];
    this.model = '';
    this.ctx = null;
    this.seedAttach();
    this.paintModels();
    this.paintEmpty();
    this.paintMeter(0, this.contextWindow());
    this.paintRail();
    this.o.onMessages?.();
  }

  async open(id: string): Promise<void> {
    if (this.session?.id !== id) this.leaveFleeting();
    this.detach();
    this.log.innerHTML = `<div class="mn-loading">${markHTML('lg pulse')}<span>Opening the chat…</span></div>`;
    try {
      const r = await A.getSession(id);
      this.session = r.session;
      // A reply still running: show the chat up to its question, then watch the reply live.
      const lastU = r.running ? [...r.messages].reverse().find((m) => m.role === 'user')?.id || 0 : 0;
      this.messages = lastU ? r.messages.filter((m) => m.id <= lastU) : r.messages;
      this.model = r.session.model;
      this.attach = [];
      this.paintAtt();
      this.paintModels();
      this.renderAll();
      this.ctx = null;
      if (r.context) this.setContext(r.context);
      else this.paintMeter(this.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0), this.contextWindow());
      this.o.onMessages?.();
      if (lastU && this.session?.id === id) {
        this.setBusy(true);
        void this.stream((signal, on) => A.streamLive(id, signal, on), lastU, true);
      }
    } catch (e) {
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
    const t = this.input;
    const max = t.scrollHeight - t.clientHeight;
    t.classList.toggle('ft', t.scrollTop > 2);
    t.classList.toggle('fb', max - t.scrollTop > 2);
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
      this.modelSlot.innerHTML = `<button type="button" class="mn-chip warn" data-setup title="Add a provider and a model in Settings, Mnemo">${icon('settings')}<span>Connect a model</span></button>`;
      this.meter.hidden = true;
      this.pinBtn.hidden = true;
      return;
    }
    const opts: SelectOption[] = list.map((m) => ({
      value: A.modelKey(m),
      label: m.label || m.model_id,
      hint: [A.modelKey(m) === A.fallbackModel(s) ? 'Default' : '', A.providerLabel(s, m.provider_id), m.context_window ? `${A.fmtTokens(m.context_window)} context` : ''].filter(Boolean).join(' · '),
      group: m.pinned ? 'Pinned' : A.providerLabel(s, m.provider_id),
      lead: m.pinned
        ? `<span class="mn-star">${icon('star')}</span>`
        : `<span class="mn-pdot" data-p="${attr(A.providerOf(s, m.provider_id)?.kind || '')}"></span>`,
    }));
    const value = this.model && opts.some((x) => x.value === this.model) ? this.model : A.fallbackModel(s);
    if (!this.select) {
      this.modelSlot.innerHTML = '';
      this.select = createSelect({
        options: opts,
        value,
        label: 'Model',
        searchable: opts.length > 7,
        className: 'mn-model',
        align: 'end',
        minWidth: 260,
        render: (o) => `<span class="mn-model-v">${o ? esc(o.label) : 'Model'}</span>`,
        onChange: (v) => void this.chooseModel(v),
        footer: { label: 'Manage models and providers', icon: icon('settings'), run: () => openMnemoSettings() },
      });
      this.modelSlot.append(this.select.el);
    } else this.select.setOptions(opts, value);
    this.paintPin();
    this.paintPerm();
    if (!this.session && !this.ctx) this.paintMeter(0, this.contextWindow());
  }

  private async chooseModel(key: string): Promise<void> {
    this.model = key;
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

  private paintMeter(used: number, window: number): void {
    const pct = window ? Math.min(100, (used / window) * 100) : 0;
    this.meter.dataset.used = String(used);
    this.meter.style.setProperty('--pct', pct.toFixed(1));
    this.meter.classList.toggle('hot', pct > 80);
    const s = A.mnemoState();
    this.meter.hidden = !window || !s || !A.usableModels(s).length;
    const t = window ? `Context used: about ${A.fmtTokens(used)} of ${A.fmtTokens(window)} tokens (${Math.round(pct)}%). Tap for details.` : '';
    this.meter.title = t;
    this.meter.setAttribute('aria-label', t || 'Context used');
  }

  private paintEmpty(): void {
    if (this.session || this.messages.length) return;
    const s = A.mnemoState();
    const sc = this.newScope();
    const kind = sc.startsWith('note:') ? 'note' : sc.startsWith('folder:') ? 'folder' : 'global';
    const ready = !!s && A.usableModels(s).length > 0;
    const about =
      kind === 'note' ? `Ask about <b>${esc(A.scopeLabel(sc))}</b>, or anything in your vault.` : kind === 'folder' ? `Ask about the folder <b>${esc(A.scopeLabel(sc))}</b>, or anything in your vault.` : 'I find, read, write, tag, link and tidy your notes. No web, no shell: only your vault.';
    this.log.innerHTML = `<div class="mn-hello">
        ${
          this.fleetingOn
            ? `<div class="mn-fleet">${icon('eye')}<span><b>Fleeting chat</b><small>Not kept: this chat and the pictures you send in it are gone once you leave it. It stays out of search and of ${A.MNEMO}'s memory of your chats. Changes to notes stay.</small></span></div>`
            : ''
        }
        <div class="mn-hello-mark">${markHTML('xl')}</div>
        <h2>${this.o.compact ? `Hi, I'm ${A.MNEMO}` : `${A.MNEMO} looks after your notes`}</h2>
        <p>${about}</p>
        ${
          ready
            ? `<div class="mn-sugs" data-kind="${kind}"></div>${
                kind === 'global'
                  ? `<div class="mn-sug-bar"><button type="button" class="mn-sug-act" data-amaze title="${A.MNEMO} writes new suggestions from your recent notes (yours stay)">${icon('sparkle')}<span>Fresh ideas</span></button><button type="button" class="mn-sug-act" data-own-sugs title="Your own suggestions, kept until you change them">${icon('edit')}<span>Your suggestions</span></button></div><div class="mn-sk-row" hidden></div>`
                  : ''
              }`
            : s
              ? `<div class="mn-setup"><b>Connect a model first</b><span>Add an OpenAI, Anthropic or OpenAI-compatible API key in Settings. The key stays sealed on your server.</span><button type="button" class="btn primary sm" data-setup>${icon('settings')}<span>Set up ${A.MNEMO}</span></button></div>`
              : ''
        }
      </div>`;
    if (ready) this.fillSugs(kind);
  }

  /** Four suggestions: some of yours and some of Mnemo's (on a vault-wide chat), the rest picked
   *  from the built-in ones; different each time. */
  private fillSugs(kind: 'global' | 'note' | 'folder', aiFirst = false): void {
    const box = this.log.querySelector<HTMLElement>('.mn-sugs');
    if (!box) return;
    const picked: { t: string; k: 'own' | 'ai' | 'base' }[] = [];
    const has = (t: string): boolean => picked.some((p) => p.t.toLowerCase() === t.toLowerCase());
    if (kind === 'global' && sugCache) {
      for (const t of shuffled(sugCache.own).slice(0, aiFirst ? 1 : 2)) if (!has(t)) picked.push({ t, k: 'own' });
      for (const t of shuffled(sugCache.ai).slice(0, aiFirst ? 3 : 2)) if (!has(t) && picked.length < 4) picked.push({ t, k: 'ai' });
    }
    for (const t of shuffled(SUGGEST[kind])) if (picked.length < 4 && !has(t)) picked.push({ t, k: 'base' });
    const ic = { own: 'pin', ai: 'sparkle', base: 'chat' } as const;
    const tag = { own: 'Yours', ai: 'For you', base: '' } as const;
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
      row.innerHTML = `<span>Your skills</span>${list
        .slice(0, 6)
        .map((k) => `<button type="button" class="mn-sk-chip" data-skill="/${attr(k.name)} " title="${attr(k.description || k.path)}">/${esc(k.name)}</button>`)
        .join('')}`;
    });
  }

  private async amaze(b: HTMLButtonElement): Promise<void> {
    b.disabled = true;
    b.classList.add('busy');
    try {
      const r = await A.refreshSuggestions();
      sugCache = { own: r.own, ai: r.ai };
      this.fillSugs('global', true);
      if (!r.fresh) toast(`${A.MNEMO} could not write new ones just now. Check the model in Settings.`, 'info');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      b.disabled = false;
      b.classList.remove('busy');
    }
  }

  /** Your own suggestions: one per line, kept until you change them (Fresh ideas leaves them). */
  private editOwnSugs(): void {
    const body = el(
      'div',
      'mn-own-sugs',
      `<p>One per line. They show among the suggestions on a new chat, marked Yours, and stay until you change them.</p><textarea rows="8" placeholder="Summarise my meeting notes from this week&#10;What should I write about next?"></textarea>`,
    );
    const ta = body.querySelector('textarea')!;
    ta.value = (sugCache?.own || []).join('\n');
    Modal.open({
      title: 'Your suggestions',
      body,
      actions: [
        { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
        {
          label: 'Save',
          cls: 'primary',
          run: async () => {
            try {
              const r = await A.saveSuggestions(ta.value.split('\n'));
              sugCache = { own: r.own, ai: sugCache?.ai || [] };
              Modal.close();
              this.fillSugs('global');
              toast('Suggestions saved', 'ok');
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
    this.log.innerHTML = '';
    if (!this.messages.length) {
      this.paintEmpty();
      return;
    }
    let turn: HTMLElement | null = null;
    let tokens = { in: 0, out: 0, model: '' };
    let lastUser = 0;
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
          else if (c.name !== SHOW) this.toolCard(body, c.id, c.name, c.arguments);
        }
      } else if (m.role === 'tool' && m.tool_name === ASK) {
        /* the question card stands for it */
      } else if (m.role === 'tool' && m.tool_name === SHOW) {
        try {
          const shown = (JSON.parse(m.content) as { shown?: A.Shown[] }).shown || [];
          if (shown.length) body.append(cardsEl(shown));
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
    // Number the versions of each page across the whole chat.
    mountArt(this.log);
    this.scrollEnd(true);
    this.paintRail();
    requestAnimationFrame(() => this.log.querySelectorAll<HTMLElement>('.mn-car').forEach(syncCarousel));
  }

  /** Where older messages were folded into a summary (open it to read the summary). */
  private compactNote(n: number, summary: string, t0 = 0): HTMLElement {
    const d = el('details', 'mn-compact');
    const took = t0 ? Math.max(1, Math.round((performance.now() - t0) / 1000)) : 0;
    d.innerHTML = `<summary title="${n ? 'Open to read the summary' : ''}"><span>${icon('refresh')}${n ? 'Compacted' : 'Compacting…'}${
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
    d.innerHTML = `<div class="mn-compact-s"><span><i class="mn-compact-spin" aria-hidden="true"></i><b>Compacting conversation</b><em class="mn-compact-t">0s</em></span></div>
      <p class="mn-compact-why">The chat filled ${A.MNEMO}'s memory for this model, so the older messages are being folded into a summary. The reply continues right after.</p>`;
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
                ? `<button type="button" class="mn-u-img" data-img="${attr(a.path)}" title="${attr(a.title)}" aria-label="${attr('Image ' + a.title)}"><img alt="" loading="lazy" src="/api/assistant/uploads/${attr(
                    a.path,
                  )}" onerror="this.parentElement.classList.add('gone')"><span>${esc(a.title)}</span></button>`
                : `<span class="mn-att-c sm"${a.kind === 'note' ? ` data-note="${attr(a.path)}" role="button" tabindex="0"` : ''} title="${attr(a.path || 'All notes')}">${icon(
                    a.kind === 'note' ? 'note' : 'folder',
                  )}<span>${esc(a.title)}</span></span>`,
            )
            .join(''),
        )}</div>`
      : '';
    // Under the bubble, along its right edge: when it was sent, then copy and try again.
    b.innerHTML = `${chips}<div class="mn-ub">${esc(text)}</div><div class="mn-u-act">${
      ts ? `<time title="${attr(new Date(ts * 1000).toLocaleString())}">${esc(relTs(ts))}</time>` : ''
    }<span class="mn-u-btns"><button type="button" class="mn-ibtn" data-copy-u title="Copy the message" aria-label="Copy the message">${icon(
      'copy',
    )}</button><button type="button" class="mn-ibtn" data-retry title="Try again: send this message again" aria-label="Try again">${icon('refresh')}</button></span></div>`;
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
      `${icon('alert')}<span class="mn-err-t">${esc(f.text)}</span><span class="mn-err-a"><button type="button" class="btn sm" data-retry>${icon('refresh')}<span>Try again</span></button>${
        f.setup ? `<button type="button" class="btn ghost sm" data-setup>Open settings</button>` : ''
      }</span>${more ? `<details class="mn-err-d"><summary>Show the full error</summary><pre>${esc(more)}</pre></details>` : ''}`,
    );
  }

  /** The turn's Activity block: every step Mnemo takes, live, then a summary. */
  private act(body: HTMLElement): HTMLElement {
    let a = body.querySelector<HTMLElement>(':scope > .mn-act');
    if (!a) {
      a = el('details', 'mn-act live');
      // Closed unless the owner opens it: the title says what is happening meanwhile.
      a.innerHTML = `<summary><span class="mn-act-ic"><i class="mn-spin"></i></span><span class="mn-act-t"><b>Working</b><small></small></span>${icon(
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
      ? `Changed ${changed.length} note${changed.length === 1 ? '' : 's'}`
      : read.length
        ? `Looked at ${read.length} note${read.length === 1 ? '' : 's'}`
        : st.steps
          ? `Used ${st.steps} tool${st.steps === 1 ? '' : 's'}`
          : 'Thought it through';
    const bits = [st.steps ? `${st.steps} step${st.steps === 1 ? '' : 's'}` : st.thought ? 'thinking' : '', read.length ? `read ${read.length}` : '', changed.length ? `changed ${changed.length}` : '', st.failed ? `${st.failed} failed` : '', time ? (time < 1000 ? `${time} ms` : `${(time / 1000).toFixed(1)} s`) : '']
      .filter(Boolean)
      .join(' · ');
    a.querySelector('.mn-act-ic')!.innerHTML = icon(st.failed && !changed.length && !read.length ? 'alert' : 'check');
    a.querySelector('.mn-act-t')!.innerHTML = `<b>${esc(title)}</b><small>${esc(bits)}</small>`;
    a.classList.toggle('bad', st.failed > 0);
    const chip = (p: string, w: boolean): string => {
      const path = resolveNote(p) || p;
      return `<span class="mn-att-c sm${w ? ' w' : ''}" data-note="${attr(path)}" role="button" tabindex="0" title="${attr(path)}">${icon(w ? 'edit' : 'note')}<span>${esc(
        noteTitle(path) || path.split('/').pop()!.replace(/\.md$/i, ''),
      )}</span></span>`;
    };
    const notes = a.querySelector<HTMLElement>('.mn-act-notes')!;
    notes.innerHTML =
      changed.length || read.length
        ? `${changed.length ? `<div><b>Changed</b>${changed.map((p) => chip(p, true)).join('')}</div>` : ''}${read.length ? `<div><b>Read</b>${read.slice(0, 24).map((p) => chip(p, false)).join('')}${read.length > 24 ? `<small>+${read.length - 24} more</small>` : ''}</div>` : ''}`
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
    const t = seg.querySelector<HTMLElement>('.mn-thought-t')!;
    t.textContent = (t.textContent || '') + text;
    const st = ACTS.get(a)!;
    st.thought = true;
    const live = a.querySelector<HTMLElement>('.mn-act-t small');
    if (live && a.classList.contains('live')) {
      const lines = (t.textContent || '').trim().split(/\n+/);
      live.textContent = lines[lines.length - 1].slice(-140);
      a.querySelector<HTMLElement>('.mn-act-t b')!.textContent = 'Thinking';
    }
  }

  private toolCard(body: HTMLElement, id: string, name: string, args: unknown): HTMLElement {
    const a = this.act(body);
    const tb = a.querySelector<HTMLElement>('.mn-act-t b');
    if (tb && a.classList.contains('live')) tb.textContent = 'Working';
    const stack = a.querySelector<HTMLElement>('.mn-tools')!;
    const st = ACTS.get(a)!;
    st.steps++;
    for (const p of touchedPaths(args)) (changesNotes(name) ? st.changed : st.read).add(p);
    const live = a.querySelector<HTMLElement>('.mn-act-t small');
    if (live && a.classList.contains('live')) live.textContent = `${toolWords(name)}${subject(args) ? ' ' + subject(args) : ''}…`;
    const d = el('details', 'mn-tool run' + (changesNotes(name) ? ' w' : ''));
    d.dataset.id = id;
    const sub = subject(args);
    d.innerHTML = `<summary><span class="mn-tool-ic">${icon(changesNotes(name) ? 'edit' : 'search')}</span><span class="mn-tool-t"><b>${esc(
      toolWords(name),
    )}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="mn-tool-s"><i class="mn-spin"></i></span>${icon('chev', 'i mn-tool-chev')}</summary>
      <div class="mn-tool-b"><div class="mn-tool-k">${esc(name)}</div><pre>${esc(pretty(args, 1200))}</pre></div>`;
    stack.append(d);
    return d;
  }

  private endTool(card: HTMLElement, ok: boolean, summary: string, ms: number, output?: string): void {
    card.classList.remove('run');
    card.classList.add(ok ? 'ok' : 'err');
    const a = card.closest<HTMLElement>('.mn-act');
    const st = a && ACTS.get(a);
    if (st) {
      st.ms += ms;
      if (!ok) st.failed++;
    }
    const s = card.querySelector<HTMLElement>('.mn-tool-s')!;
    const bits = [summary, ms ? (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`) : ''].filter(Boolean).join(' · ');
    s.innerHTML = `${ok ? icon('check') : icon('alert')}<span>${esc(bits || (ok ? 'Done' : 'Failed'))}</span>`;
    if (output) {
      const b = card.querySelector('.mn-tool-b')!;
      b.insertAdjacentHTML('beforeend', `<div class="mn-tool-k">Result</div><pre>${esc(pretty(output))}</pre>`);
    }
  }

  private footer(turn: HTMLElement, model: string, tin: number, tout: number): void {
    const body = turn.querySelector<HTMLElement>('.mn-tb')!;
    body.querySelector('.mn-foot')?.remove();
    body.querySelector(':scope > .mn-rel')?.remove();
    const rel = relatedHTML(body);
    if (rel) {
      body.insertAdjacentHTML('beforeend', rel);
      requestAnimationFrame(() => body.querySelectorAll<HTMLElement>(':scope > .mn-rel .mn-car').forEach(syncCarousel));
    }
    const raw = Array.from(body.querySelectorAll<HTMLElement>('.mn-md'))
      .map((x) => x.dataset.raw || '')
      .join('\n\n')
      .trim();
    const bits = [model ? A.modelLabel(A.mnemoState(), model) : '', tin || tout ? `${A.fmtTokens(tin)} in · ${A.fmtTokens(tout)} out` : ''].filter(Boolean);
    const f = el(
      'div',
      'mn-foot',
      // Actions first (where the eye ends after reading), then what answered and its cost.
      `<span class="mn-foot-a">${
        raw ? `<button type="button" class="mn-ibtn" data-copy title="Copy the reply" aria-label="Copy the reply">${icon('copy')}</button>` : ''
      }<button type="button" class="mn-ibtn" data-regen title="Regenerate this reply" aria-label="Regenerate this reply">${icon('refresh')}</button></span>${
        bits.length ? `<span class="mn-foot-m">${bits.map((b) => `<span>${esc(b)}</span>`).join('<i></i>')}</span>` : ''
      }`,
    );
    if (raw) f.dataset.raw = raw;
    body.append(f);
  }

  private scrollEnd(force = false): void {
    const fromEnd = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight;
    if (force || fromEnd < 140) this.log.scrollTop = this.log.scrollHeight;
    else this.paintDown(fromEnd);
  }

  /** The scroll-to-bottom button: shown while the latest message is out of sight. */
  private paintDown(fromEnd: number): void {
    const show = fromEnd > 220;
    this.downBtn.classList.toggle('on', show);
    this.downBtn.tabIndex = show ? 0 : -1;
  }

  private onLogClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const skill = t.closest<HTMLElement>('[data-skill]');
    if (skill) {
      this.prefill(skill.dataset.skill || '');
      return;
    }
    const amaze = t.closest<HTMLButtonElement>('[data-amaze]');
    if (amaze) {
      void this.amaze(amaze);
      return;
    }
    if (t.closest('[data-own-sugs]')) {
      this.editOwnSugs();
      return;
    }
    const sug = t.closest<HTMLElement>('[data-sug]');
    if (sug) {
      this.prefill(sug.dataset.sug || '', true);
      return;
    }
    if (t.closest('[data-setup]')) {
      openMnemoSettings();
      return;
    }
    // Links in a reply: the app's Docs open in place, other sites in a new tab.
    const link = t.closest<HTMLAnchorElement>('.mn-md a[href]');
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
    const wl = t.closest<HTMLElement>('[data-note]');
    if (wl) {
      e.preventDefault();
      hooks.openNote(wl.dataset.note!);
      return;
    }
    // A question from Mnemo: an option answers it; Other lets the owner type the answer.
    const opt = t.closest<HTMLElement>('[data-ask-opt]');
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
    const arrow = t.closest<HTMLElement>('[data-car]');
    if (arrow) {
      const row = arrow.closest('.mn-car')?.querySelector<HTMLElement>('.mn-car-row');
      row?.scrollBy({ left: (arrow.dataset.car === 'l' ? -1 : 1) * row.clientWidth * 0.8, behavior: 'smooth' });
      return;
    }
    const tile = t.closest<HTMLElement>('[data-img]');
    if (tile) {
      const tiles = Array.from(tile.closest('.mn-car-row')?.querySelectorAll<HTMLElement>('[data-img]:not(.gone)') || [tile]);
      const set = tiles.map((x) => ({ src: `/api/assistant/uploads/${x.dataset.img}`, caption: x.title }));
      openLightbox(`/api/assistant/uploads/${tile.dataset.img}`, tile.title, set, Math.max(0, tiles.indexOf(tile)));
      return;
    }
    // A card Mnemo handed over: open the note, the folder, the image or the vault.
    const cd = t.closest<HTMLElement>('[data-card]');
    if (cd) {
      openShown(cd.dataset.card || '', cd.dataset.path || '');
      return;
    }
    // Touch screens: a tap on a message of yours shows its time, Copy and Try again.
    const ubub = t.closest<HTMLElement>('.mn-ub');
    if (ubub && matchMedia('(hover: none)').matches) {
      const u = ubub.closest<HTMLElement>('.mn-u')!;
      const on = !u.classList.contains('show-act');
      this.log.querySelectorAll('.mn-u.show-act').forEach((x) => x.classList.remove('show-act'));
      u.classList.toggle('show-act', on);
      return;
    }
    const again = t.closest<HTMLElement>('[data-regen],[data-retry]');
    if (again) {
      const own = again.closest<HTMLElement>('.mn-u');
      let uid = Number(own?.dataset.mid || again.closest<HTMLElement>('.mn-turn')?.dataset.uid || 0);
      // A turn that has not learnt its id yet: it belongs to the last message.
      if (!uid) uid = [...this.messages].reverse().find((m) => m.role === 'user')?.id || 0;
      void this.rerun(uid);
      return;
    }
    const copyU = t.closest<HTMLElement>('[data-copy-u]');
    if (copyU) {
      const text = copyU.closest('.mn-u')?.querySelector('.mn-ub')?.textContent || '';
      void navigator.clipboard?.writeText(text).then(
        () => toast('Message copied', 'ok'),
        () => toast('Could not copy', 'err'),
      );
      return;
    }
    const copy = t.closest<HTMLElement>('[data-copy]');
    if (copy) {
      const raw = copy.closest<HTMLElement>('.mn-foot')?.dataset.raw || '';
      void navigator.clipboard?.writeText(raw).then(
        () => toast('Reply copied', 'ok'),
        () => toast('Could not copy', 'err'),
      );
      return;
    }
    const code = t.closest<HTMLElement>('[data-copy-code]');
    if (code) {
      const text = code.closest('.dc-code')?.querySelector('pre')?.textContent || '';
      void navigator.clipboard?.writeText(text).then(() => {
        code.textContent = 'Copied';
        window.setTimeout(() => (code.textContent = 'Copy'), 1500);
      });
    }
  }

  // ---- sending ----

  /** The owner pressed Stop: end the reply on the server too. */
  stop(): void {
    if (this.busy) this.halted = true;
    if (this.busy && this.session) void A.stopChat(this.session.id).catch(() => undefined);
    this.ctrl?.abort();
    this.ctrl = null;
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
    this.ctrl.abort();
    this.ctrl = null;
    this.setBusy(false);
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.o.onBusy?.(on);
    this.el.classList.toggle('busy', on);
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
    const t = stop ? 'Stop' : queue ? 'Add to the queue (Enter) · Ctrl+Enter steers this reply now' : 'Send (Enter)';
    this.sendBtn.title = t;
    this.sendBtn.setAttribute('aria-label', stop ? 'Stop' : queue ? 'Add to the queue' : 'Send');
  }

  async send(raw: string, answer?: A.Answer): Promise<void> {
    const text = raw.trim();
    if (!text || this.busy) return;
    const s = A.mnemoState() ?? (await A.loadState().catch(() => null));
    if (!s || !A.usableModels(s).length) {
      toast(`Connect a model for ${A.MNEMO} first`, 'err');
      openMnemoSettings();
      return;
    }
    this.setBusy(true);
    try {
      if (!this.session) {
        // The model the picker shows is the one the chat uses.
        if (!this.model) this.model = this.select?.value || A.fallbackModel(s);
        this.session = (await A.newSession(this.newScope(), this.model, this.fleetingOn)).session;
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
    await this.stream((signal, on) => A.streamChat(sid0, text, this.model || undefined, att, signal, on, answer));
  }

  /** Run the turn of the owner's message `uid` again: Regenerate on a reply, Try again on a
   *  message or an error. Later turns are replaced (the owner confirms that first). */
  private async rerun(uid: number): Promise<void> {
    if (this.busy || !this.session || !uid) return;
    const later = this.messages.some((m) => m.role === 'user' && m.id > uid);
    if (later) {
      const go = await new Promise<boolean>((done) => {
        Modal.open({
          title: 'Run this message again?',
          body: '<p>The messages that came after it in this chat are replaced by the new reply.</p>',
          actions: [
            { label: 'Cancel', cls: 'ghost', run: () => (Modal.close(), done(false)) },
            { label: 'Run again', cls: 'primary', run: () => (Modal.close(), done(true)) },
          ],
        });
      });
      if (!go) return;
    }
    const ub = this.log.querySelector<HTMLElement>(`.mn-u[data-mid="${uid}"]`);
    if (!ub) {
      toast('Open the chat again to run that message again', 'warn');
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
    body.innerHTML = `<div class="mn-think"><i></i><i></i><i></i><span>Thinking</span></div>`;
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
    const think = (on: boolean, label = 'Thinking'): void => {
      let t = body.querySelector<HTMLElement>('.mn-think');
      if (on) {
        if (!t) {
          t = el('div', 'mn-think', '<i></i><i></i><i></i><span></span>');
          body.append(t);
        }
        t.querySelector('span')!.textContent = label;
      } else t?.remove();
    };
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
    try {
      await start(this.ctrl.signal, (ev) => {
        got = true;
        switch (ev.type) {
          case 'start':
            model = ev.model;
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
          case 'compacted': {
            const live = this.log.querySelector<HTMLElement>('.mn-compact.live');
            const done = this.compactNote(ev.messages, '', live ? Number(live.dataset.t0) : 0);
            if (live) live.replaceWith(done);
            else turn.before(done);
            think(true);
            break;
          }
          case 'notice':
            body.insertAdjacentHTML('beforeend', `<div class="mn-notice">${icon('info')}<span>${esc(ev.text)}</span></div>`);
            break;
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
            this.toolCard(body, ev.id, ev.name, ev.args);
            think(true, toolWords(ev.name) + '…');
            this.scrollEnd();
            break;
          }
          case 'tool_end': {
            if (ev.name === ASK) {
              think(false);
              break;
            }
            if (ev.name === SHOW) {
              if (ev.shown?.length) body.append(cardsEl(ev.shown));
              this.scrollEnd();
              break;
            }
            const card = body.querySelector<HTMLElement>(`.mn-tool[data-id="${CSS.escape(ev.id)}"]`);
            if (card) this.endTool(card, ev.ok, ev.summary, ev.ms);
            if (ev.ok && changesNotes(ev.name)) wrote = true;
            think(true);
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
            this.setContext(ev.context);
            if (this.session && ev.title) this.session = { ...this.session, title: ev.title, updated_at: Date.now() / 1000 };
            break;
        }
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') {
        if (my === this.run) body.insertAdjacentHTML('beforeend', `<div class="mn-notice">${icon('stop')}<span>Stopped.</span></div>`);
      } else if (lostLink(err)) {
        // The connection dropped (the tab went to the background, the page was left, the
        // network blinked): the reply goes on on the server, so watch it again, no error.
        dropped = true;
      } else body.append(this.errorCard(err.message));
    } finally {
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
      // The reply ended just before we came to watch it: show the stored chat instead.
      if (live && !got) {
        turn.remove();
        this.ctrl = null;
        this.setBusy(false);
        void this.open(sid);
        return;
      }
      if (frame) cancelAnimationFrame(frame);
      think(false);
      closeText();
      this.finishAct(body, Math.round(performance.now() - t0));
      turn.classList.remove('live');
      if (!body.childElementCount) body.append(this.errorCard('No reply came back.'));
      this.ctrl = null;
      this.setBusy(false);
      if (this.session) {
        this.session = { ...this.session, messages: this.session.messages + 1 };
        this.o.onChange?.(this.session);
      }
      if (wrote) void hooks.loadCore();
      // The next queued message goes out by itself (not after Stop).
      const halted = this.halted;
      this.halted = false;
      if (this.queue.length && !halted) window.setTimeout(() => this.sendQueued(), 400);
      // Keep the stored transcript in step (the next open reads it again anyway).
      void A.getSession(sid)
        .then((r) => {
          if (this.session?.id === sid) {
            this.messages = r.messages;
            this.session = r.session;
            this.setContext(r.context);
            this.o.onMessages?.();
            // The new message and its turn learn their ids (Try again, Regenerate, search).
            const lastU = [...r.messages].reverse().find((m) => m.role === 'user');
            const ubs = this.log.querySelectorAll<HTMLElement>('.mn-u');
            const lastB = ubs[ubs.length - 1];
            if (lastU && lastB && !lastB.dataset.mid) lastB.dataset.mid = String(lastU.id);
            if (lastU) turn.dataset.uid = String(lastU.id);
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
  for (const p of st?.changed || []) push('note', resolveNote(p) || p, nm(resolveNote(p) || p), 'edit', ' w');
  body.querySelectorAll<HTMLElement>('.mn-cards [data-card]').forEach((c) => {
    const kind = c.dataset.card || 'note';
    push(kind, c.dataset.path || '', c.querySelector('b')?.textContent || '', kind === 'image' ? 'image' : kind === 'folder' ? 'folder' : kind === 'vault' ? 'vault' : 'note', '');
  });
  for (const p of st?.read || []) push('note', resolveNote(p) || p, nm(resolveNote(p) || p), 'note', '');
  if (!items.length) return '';
  const cap = 12;
  const chips = items
    .slice(0, cap)
    .map(
      (i) =>
        `<span class="mn-att-c sm${i.cls}" data-card="${attr(i.kind)}" data-path="${attr(i.path)}" role="button" tabindex="0" title="${attr(i.path || i.title)}">${icon(i.ic)}<span>${esc(i.title)}</span></span>`,
    )
    .join('');
  return `<div class="mn-rel"><span class="mn-rel-h">Related</span>${carouselHTML(chips + (items.length > cap ? `<small class="mn-rel-more">+${items.length - cap}</small>` : ''))}</div>`;
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
  card.querySelector('.mn-ask-q')!.insertAdjacentHTML('beforeend', '<em class="mn-ask-skip">Skipped</em>');
}

/** A question card: the options listed one under another (the chosen one marked once
 *  answered), and Other, which opens a box to type the answer in the card. */
function askEl(q: A.Ask, answered: string | false | null): HTMLElement {
  const done = answered !== null;
  const box = el('div', 'mn-ask' + (done ? ' done' : '') + (answered === false ? ' skipped' : ''));
  box.dataset.ask = q.id;
  const dis = done ? ' disabled' : '';
  box.innerHTML = `<div class="mn-ask-q">${icon('help')}<span>${esc(q.question)}</span>${answered === false ? '<em class="mn-ask-skip">Skipped</em>' : ''}</div><div class="mn-ask-o">${q.options
    .map(
      (o, i) =>
        `<button type="button" class="mn-ask-b${o.approve ? ' ok' : ''}${answered === o.label ? ' on' : ''}" data-ask-opt="1" data-label="${attr(o.label)}" data-approve="${o.approve ? '1' : ''}"${dis}><span class="mn-ask-n">${
          i + 1
        }</span><span class="mn-ask-c"><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></button>`,
    )
    .join('')}${
    q.allow_other
      ? `<button type="button" class="mn-ask-b other${answered === '' ? ' on' : ''}" data-ask-opt="other"${dis}><span class="mn-ask-n">${icon('edit')}</span><span class="mn-ask-c"><b>Other</b><small>Type your own answer</small></span></button><form class="mn-ask-f" hidden><input type="text" placeholder="Type your answer…" aria-label="Your answer" autocomplete="off"${dis}><button type="submit" class="mn-ibtn" title="Send the answer (Enter)" aria-label="Send the answer"${dis}>${icon(
          'enter',
        )}</button></form>`
      : ''
  }</div>`;
  return box;
}

/** An error's text without HTML: an error page becomes its title, spaces folded. */
function plainError(msg: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(msg)?.[1]?.trim();
  const t = msg.replace(/<!doctype[\s\S]*?<\/html>/gi, title || 'an HTML error page').replace(/<[^>]+>/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** A provider error in plain words; HTTP codes and raw bodies stay behind "Show the full error".
 *  The status the provider answered with decides first (numbers inside a body can be anything). */
function friendlyError(msg: string): { text: string; setup: boolean } {
  const KEY = { text: 'The AI provider did not accept the key. Check it in Settings.', setup: true };
  const LOST = { text: 'The AI provider could not find this model or address. Check it in Settings.', setup: true };
  const BUSY = { text: 'The AI provider is busy or out of quota. Try again in a moment.', setup: false };
  const DOWN = { text: 'The AI provider is not answering right now. Try again in a moment.', setup: false };
  const NET = { text: 'Could not reach the AI provider. Check the connection and try again.', setup: false };
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
  if (!m.trim() || m.includes('no reply came back')) return { text: 'No reply came back.', setup: false };
  if (has('no provider', 'add a provider', 'no model')) return { text: msg.trim(), setup: true };
  // Memora's own short messages are already plain; raw provider bodies are not.
  const t = msg.trim();
  if (!code && t.length <= 160 && !/[{}<>]|\b\d{3}\b/.test(t)) return { text: t.charAt(0).toUpperCase() + t.slice(1), setup: false };
  return { text: 'Something went wrong with this reply.', setup: false };
}

/** Most pictures one message may carry (each goes to the model as an image). */
const IMAGES_PER_MESSAGE = 4;

/** A row of chips that slides sideways (no scrollbar), with arrows when it overflows. */
function carouselHTML(inner: string): string {
  return `<div class="mn-car"><button type="button" class="mn-car-a l" data-car="l" aria-label="Scroll left" tabindex="-1">${icon(
    'chev-left',
  )}</button><div class="mn-car-row">${inner}</div><button type="button" class="mn-car-a r" data-car="r" aria-label="Scroll right" tabindex="-1">${icon('chev-right')}</button></div>`;
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

const imgUrl = (path: string): string => `/api/vault/file?path=${encodeURIComponent(path)}`;

/** The cards of one show_items call. */
function cardsEl(items: A.Shown[]): HTMLElement {
  const box = el('div', 'mn-cards');
  box.innerHTML = items
    .map((it) => {
      const dir = it.path.includes('/') ? it.path.slice(0, it.path.lastIndexOf('/')) : '';
      const sub = it.kind === 'vault' ? 'Every note' : it.kind === 'folder' ? (it.path ? 'Folder' + (dir ? ` in ${dir}` : '') : 'Folder') : dir || 'Top level';
      const title = it.kind === 'note' ? noteTitle(it.path) || it.title : it.title;
      const lead =
        it.kind === 'image'
          ? `<span class="mn-card-img"><img alt="" loading="lazy" src="${attr(imgUrl(it.path))}" onerror="this.parentElement.classList.add('broken')"></span>`
          : `<span class="mn-card-ic">${icon(it.kind === 'note' ? 'note' : it.kind === 'folder' ? 'folder' : 'vault')}</span>`;
      return `<button type="button" class="mn-card k-${it.kind}" data-card="${attr(it.kind)}" data-path="${attr(it.path)}" title="${attr(
        it.kind === 'vault' ? 'Open your notes' : `Open ${it.path || 'All notes'}`,
      )}">${lead}<span class="mn-card-t"><b>${esc(title)}</b><small>${esc(sub)}</small></span>${icon('chev', 'i mn-card-go')}</button>`;
    })
    .join('');
  return box;
}

/** Settings, Mnemo. */
export function openMnemoSettings(): void {
  requestSettingsSection('stMnemo');
  hooks.go('settings');
}

/** A small searchable list of notes; `run` gets the chosen path. */
function pickNote(run: (paths: string[]) => void, room = 8): void {
  const body = el('div', 'mn-pick');
  body.innerHTML = `<label class="mn-pick-q">${icon('search')}<input type="search" placeholder="Search notes" autocomplete="off" aria-label="Search notes"></label><div class="mn-pick-l" role="listbox" aria-multiselectable="true"></div>`;
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
    go.textContent = picked.length > 1 ? `Attach ${picked.length} notes` : 'Attach';
  };
  const paint = (): void => {
    const q = input.value.trim().toLowerCase();
    const hits = notes.filter((n) => !q || n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)).slice(0, 60);
    list.innerHTML = hits.length
      ? hits
          .map((n) => {
            const on = picked.includes(n.path);
            return `<button type="button" class="mn-pick-i${on ? ' on' : ''}" role="option" aria-selected="${on}" data-p="${attr(n.path)}">${icon('note')}<span><b>${esc(n.title)}</b><small>${esc(
              n.folder || 'Top level',
            )}</small></span><i class="mn-pick-ck" aria-hidden="true">${icon('check')}</i></button>`;
          })
          .join('')
      : '<p class="mn-pick-none">No note matches.</p>';
  };
  input.oninput = paint;
  list.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
    if (!b) return;
    const p = b.dataset.p!;
    const i = picked.indexOf(p);
    if (i >= 0) picked.splice(i, 1);
    else if (picked.length < room) picked.push(p);
    else return toast(`Up to ${room} more this message`, 'warn');
    b.classList.toggle('on', i < 0);
    b.setAttribute('aria-selected', String(i < 0));
    paintGo();
  };
  paint();
  Modal.open({
    title: 'Notes',
    body,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'Attach',
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
