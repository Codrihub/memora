// Kanban board view: a note with `kanban-plugin` in its frontmatter (the Obsidian Kanban format) shown
// as lanes of cards, beside the reader and the editor. The server parses and writes the board
// (/api/kanban, crates/core/src/vault/kanban.rs), so every change is a normal note save that keeps the
// rest of the file as it is; this view only draws the board and sends one edit at a time.

import { apiGet, apiPost } from '../api';
import { attr, el, esc, useStyles } from '../dom';
import { chipLink, mentionChip, tagChip, useChips } from '../ui/chips';
import { hashColor } from '../format';
import { colorPickHTML, wireColorPick } from '../ui/color-pick';
import { icon } from '../ui/icons';

/** Whether the board look shows an element (it hides done cards and empty lanes). */
const shown = (x: Element): boolean => x.getClientRects().length > 0;

/** A board's icon: one of ours, or what an agent set (an emoji, say) as text. */
export function boardIcon(n: string): string {
  return BOARD_ICONS.includes(n) ? icon(n) : `<span class="kb-emo">${esc(n)}</span>`;
}

/** Icons a board can carry, as folders do. */
const BOARD_ICONS = ['kanban', 'star', 'bolt', 'check', 'book', 'code', 'sparkle', 'bell', 'pin', 'chat', 'user', 'alert', 'folder', 'note', 'image', 'mic'];
import { fadeScroll } from '../ui/scroll-fade';
import { t, tn } from '../i18n';
import { Modal } from '../modal';
import { toast } from '../toast';
import { I } from '../vault/icons';
import { inlineEdit, openMenu, undoToast, type MenuItem } from '../vault/ui';
import { openCardForm } from './card-form';
import type { CardSettings } from './card-text';
import { KANBAN_CSS } from './kanban-styles';
import { dateColorFor } from './due';
import { toggleStep } from './card-text';
import { applyBoardLookTo, boardPrefs, ensureBoardLook, KBL_VARS } from './board-look';

export interface KbCard {
  id: string;
  text: string;
  title: string;
  checked: boolean;
  task: boolean;
  tags: string[];
  links: string[];
  dates: string[];
  times: string[];
  html?: string;
  /** Its block id (`^abc123`), when it has one. */
  block?: string | null;
  /** Its own colour. */
  color?: string | null;
  /** `- [ ] step` lines under it. */
  checklist?: { text: string; done: boolean }[];
  /** Archived cards: the lane it was archived from and the day, when Memora archived it. */
  archived_from?: string | null;
  archived_at?: string | null;
}

export interface KbLane {
  index: number;
  title: string;
  max_items: number;
  complete: boolean;
  cards: KbCard[];
  color?: string | null;
}

export interface KbBoard {
  path: string;
  version: string;
  lanes: KbLane[];
  archive: KbCard[];
  counts: { lanes: number; cards: number; done: number; archived: number };
  settings: Record<string, unknown> | null;
  card?: string | null;
  embedded_in?: string[];
  linked_from?: string[];
  changed?: boolean;
  style?: { color?: string | null; icon?: string | null } | null;
  tag_colors?: Record<string, { color?: string | null; background?: string | null }> | null;
}

export type KbOp =
  | { type: 'add_card'; lane: number; text: string; position?: number; checked?: boolean; color?: string | null }
  | { type: 'move_card'; card: string; lane: number; position?: number }
  | { type: 'update_card'; card: string; text?: string; checked?: boolean }
  | { type: 'archive_card'; card: string }
  | { type: 'restore_card'; card: string; lane?: number }
  | { type: 'delete_card'; card: string }
  | { type: 'add_lane'; title: string; position?: number }
  | { type: 'rename_lane'; lane: number; title: string }
  | { type: 'move_lane'; lane: number; position: number }
  | { type: 'duplicate_card'; card: string }
  | { type: 'set_card_color'; card: string; color: string | null }
  | { type: 'duplicate_lane'; lane: number; title?: string }
  | { type: 'archive_lane_cards'; lane: number }
  | { type: 'clear_lane'; lane: number }
  | { type: 'set_lane_color'; lane: number; color: string | null }
  | { type: 'set_lane_limit'; lane: number; max: number }
  | { type: 'set_board_style'; color?: string | null; icon?: string | null }
  | { type: 'set_tag_color'; tag: string; color: string | null; background?: string | null }
  | { type: 'delete_lane'; lane: number };

/** How much room a board has: a page of its own, a note it is embedded in, or Mnemo's chat. */
export type KbDensity = 'page' | 'embed' | 'chat';

/** What the note pane does for the board. */
export interface KanbanHost {
  openNote(path: string): void;
  createNote(name: string, at: HTMLElement): void;
  openTag(tag: string): void;
  /** The board wrote a new version of the note (the pane refreshes its copy of the text). */
  saved(board: KbBoard): void;
}

/** Whether a note's frontmatter makes it a board. */
export function isBoardNote(fm: Record<string, unknown> | null | undefined): boolean {
  return !!fm && Object.prototype.hasOwnProperty.call(fm, 'kanban-plugin');
}

// Boards once had a per-device "show as text" switch; drop what it left behind.
try {
  localStorage.removeItem('memora.kanban.text');
} catch {
  /* private mode */
}

/** A plain check mark and an archive box for the cards. */
export const IC = {
  dot: '<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/></svg>',
  clear: '<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="m9.5 10 5 5M14.5 10l-5 5"/></svg>',
  limit: '<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M4 12h10M4 17h6"/><path d="M18 5v14"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  archive: '<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1.5"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4"/></svg>',
  restore: '<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/></svg>',
  lane: '<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};
export const BOARD_ICON = IC.lane;

interface DragState {
  kind: 'card' | 'lane';
  src: HTMLElement;
  ghost: HTMLElement;
  offX: number;
  offY: number;
  x: number;
  y: number;
  fromLane: number;
  fromPos: number;
  raf: number;
}

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return iso;
  const same = d.getFullYear() === new Date().getFullYear();
  try {
    return d.toLocaleDateString(undefined, same ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

const ARCH_CSS = `
.ka{display:flex;flex-direction:column;gap:10px;min-width:0}
.ka-top{display:flex;align-items:center;gap:8px}
.ka-q{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:38px;padding:0 10px;border-radius:10px;border:1px solid var(--line-strong);background:var(--surface-1);color:var(--muted)}
.ka-q:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.ka-q svg{width:15px;height:15px;flex:none}
.ka-q input{flex:1;min-width:0;border:0;background:none;color:var(--fg);font:inherit;font-size:14px;outline:none;padding:0}
.ka-note{margin:0;font-size:12.5px;color:var(--muted)}
.ka-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.ka-row{padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-1);min-width:0}
.ka-t{font-size:14px;font-weight:550;line-height:1.4;overflow-wrap:anywhere}
.ka-m{margin-top:2px;font-size:12px;color:var(--muted)}
.ka-acts{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}
.ka-lane select{height:32px;max-width:160px;padding:0 8px;border-radius:8px;border:1px solid var(--line-strong);background:var(--surface-1);color:var(--fg);font:inherit;font-size:13px}
.ka-del{margin-inline-start:auto}
.ka-del.danger{color:var(--danger)}
.ka-none{padding:24px 8px;text-align:center;color:var(--muted);font-size:13.5px}
@media (max-width:760px){.ka-q{height:44px}.ka-q input,.ka-lane select{font-size:16px}.ka-lane select{height:40px}.ka-acts .btn{min-height:40px}}
`;

/** Say `msg` to screen readers (a polite live region shared by every board). */
function announce(msg: string): void {
  let live = document.getElementById('kbLive');
  if (!live) {
    live = el('div', 'sr-only');
    live.id = 'kbLive';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    document.body.appendChild(live);
  }
  live.textContent = '';
  const box = live;
  requestAnimationFrame(() => (box.textContent = msg));
}

/** The keys a board answers to, as listed in Help & shortcuts too. */
export function boardKeyRows(): [string[], string][] {
  return [
    [['←', '→', '↑', '↓'], t('Move between cards and lanes')],
    [['Enter'], t('Open the card form')],
    [['Space'], t('Mark the card as done or not done')],
    [[altKey(), '←', '→'], t('Move the card to the next lane')],
    [[altKey(), '↑', '↓'], t('Move the card up or down')],
    [['N'], t('Add a card to this lane')],
    [['Delete'], t('Archive the card (with Undo)')],
    [['?'], t('Show these shortcuts')],
  ];
}

function altKey(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌥' : 'Alt';
}

export function boardKeysHTML(): string {
  return boardKeyRows()
    .map(([keys, what]) => `<span>${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span><span>${esc(what)}</span>`)
    .join('');
}

function boardKeysHelp(): void {
  Modal.open({
    title: t('Board shortcuts'),
    body: `<p class="panel-sub" style="margin:0 0 12px">${esc(t('Click a card or tab to it first.'))}</p><div class="guide-keys kb-keys">${boardKeysHTML()}</div>`,
    actions: [{ label: t('Got it'), cls: 'primary', run: () => Modal.close() }],
  });
}

/** One board on the page. Reused while the same note stays open, so redraws keep scroll and state. */
export class KanbanView {
  readonly el: HTMLElement;
  private board: KbBoard | null = null;
  /** The board version the server last confirmed; edits are sent against it. */
  private version = '';
  private chain: Promise<void> = Promise.resolve();
  private drag: DragState | null = null;
  private press: (() => void) | null = null;
  /** A refresh came in while dragging or typing: done once that ends. */
  private stale = false;
  /** The board changed while a card was being edited: drawn once that ends. */
  private needDraw = false;
  private archivePaint: (() => void) | null = null;
  private lastPtr = 'mouse';
  /** The lane whose "add a card" box is open, and what was typed. */
  private seen = new Set<string>();
  private firstDraw = true;
  private loadSeq = 0;
  private ro: ResizeObserver | null = null;
  /** A lane just added, kept in view even when empty lanes are hidden. */
  private keepLane = -1;
  /** A lane's name is being typed: a redraw would take the box away. */
  private renaming = false;
  private fadeRaf = 0;
  /** Index (among the shown lanes) of the lane in view, kept by syncScroll. */
  private curLane = 0;

  constructor(
    readonly path: string,
    private host: KanbanHost,
    /** How much room it has: its own page, embedded in a note, or in Mnemo's chat. */
    readonly density: KbDensity = 'page',
  ) {
    useStyles('kanban-css', KANBAN_CSS);
    useChips();
    ensureBoardLook();
    this.el = el('div', `kb kb-${density}`);
    // The board's own "this board only" look wins over the note or chat around it.
    this.el.dataset.kbpath = path;
    applyBoardLookTo(this.el, boardPrefs.override(path));
    // The edge fades follow the size of the board as well as its scrolling.
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.syncScroll());
      this.ro.observe(this.el);
    }
    this.el.setAttribute('aria-busy', 'true');
    this.el.innerHTML = this.skeleton();
    this.el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('dblclick', (e) => this.onDblClick(e));
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('change', (e) => this.onStep(e));
    this.el.addEventListener('contextmenu', (e) => {
      if (this.drag) e.preventDefault();
    });
  }

  private skeleton(): string {
    const lane = (n: number): string =>
      `<div class="kb-lane kb-sk"><div class="kb-lane-head"><span class="sk sk-line" style="width:40%"></span></div>${'<div class="kb-card kb-sk-card"><span class="sk sk-line" style="width:80%"></span><span class="sk sk-line" style="width:55%"></span></div>'.repeat(n)}</div>`;
    return `<div class="kb-lanes">${lane(3)}${lane(2)}${lane(1)}</div>`;
  }

  /** Fetch the board and draw it. */
  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    try {
      const b = await apiGet<KbBoard>('/api/kanban?path=' + encodeURIComponent(this.path));
      if (seq !== this.loadSeq) return;
      this.set(b);
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.el.removeAttribute('aria-busy');
      this.el.innerHTML = `<div class="vx-empty">${I.warn}<p>${t('This board could not be opened.')}<br>${esc((e as Error).message)}</p></div>`;
    }
  }

  /** The note changed elsewhere (an agent, another tab): fetch it again, drawing only when it differs. */
  async refresh(): Promise<void> {
    if (this.busy()) {
      this.stale = true;
      return;
    }
    const seq = ++this.loadSeq;
    try {
      const b = await apiGet<KbBoard>('/api/kanban?path=' + encodeURIComponent(this.path));
      if (seq !== this.loadSeq) return;
      if (b.version === this.version && this.board) return;
      if (this.busy()) {
        this.stale = true;
        return;
      }
      this.set(b);
      this.host.saved(b);
    } catch {
      /* the next change or reload tries again */
    }
  }

  /** Dragging or editing a card: a redraw now would drop what the person is doing. */
  private busy(): boolean {
    return !!this.drag || this.renaming;
  }

  private set(b: KbBoard): void {
    this.board = b;
    this.version = b.version;
    this.render();
    this.takeReveal();
    this.archivePaint?.();
  }

  /** How many cards are in the archive. */
  get archivedCount(): number {
    return this.board?.archive.length || 0;
  }

  /** The archive in a panel (a side sheet; a bottom sheet on phones): find, restore to a lane, delete
   *  for good, or restore all. It follows the board while open. */
  openArchive(): void {
    if (!this.board) return;
    useStyles('kb-arch-css', ARCH_CSS);
    const box = el('div', 'ka');
    box.innerHTML = `<div class="ka-top"><label class="ka-q">${I.search}<input type="search" placeholder="${attr(t('Find an archived card'))}" aria-label="${attr(
      t('Find an archived card'),
    )}" autocomplete="off" spellcheck="false"></label><button type="button" class="btn sm ka-all" data-all>${esc(t('Restore all'))}</button></div>
      <p class="ka-note">${esc(t('Archived cards stay in the note, under its Archive heading.'))}</p><ul class="ka-list" role="list"></ul>`;
    const q = box.querySelector<HTMLInputElement>('input')!;
    const list = box.querySelector<HTMLElement>('.ka-list')!;
    const laneOf = (c: KbCard): number => {
      const lanes = this.board?.lanes || [];
      const i = c.archived_from ? lanes.findIndex((l) => l.title === c.archived_from) : -1;
      return i >= 0 ? i : 0;
    };
    const paint = (): void => {
      const b = this.board;
      if (!b || !box.isConnected) {
        this.archivePaint = null;
        return;
      }
      const s = q.value.trim().toLowerCase();
      const cards = b.archive.filter((c) => !s || c.text.toLowerCase().includes(s));
      box.querySelector<HTMLButtonElement>('[data-all]')!.disabled = !b.archive.length || !b.lanes.length;
      const sub = document.querySelector('#modalHost .modal-sub');
      if (sub) sub.textContent = tn(b.archive.length, '{n} card', '{n} cards');
      list.innerHTML = cards.length
        ? cards
            .map((c) => {
              const meta = [
                c.archived_from ? t('From {lane}', { lane: c.archived_from }) : '',
                c.archived_at ? t('Archived {date}', { date: fmtDate(c.archived_at) }) : '',
              ].filter(Boolean);
              const to = laneOf(c);
              return `<li class="ka-row" data-id="${attr(c.id)}"><div class="ka-t" dir="auto">${esc(c.title || c.text.split('\n')[0])}</div>${
                meta.length ? `<div class="ka-m">${esc(meta.join(' · '))}</div>` : ''
              }<div class="ka-acts"><label class="ka-lane"><span class="sr-only">${esc(t('Restore to'))}</span><select aria-label="${attr(t('Restore to'))}">${b.lanes
                .map((l, i) => `<option value="${i}"${i === to ? ' selected' : ''}>${esc(l.title)}</option>`)
                .join('')}</select></label><button type="button" class="btn sm primary" data-restore${b.lanes.length ? '' : ' disabled'}>${esc(t('Restore'))}</button>
                <button type="button" class="btn sm ghost ka-del" data-del>${esc(t('Delete forever'))}</button></div></li>`;
            })
            .join('')
        : `<li class="ka-none">${esc(b.archive.length ? t('No archived card matches.') : t('The archive is empty.'))}</li>`;
    };
    this.archivePaint = paint;
    q.addEventListener('input', paint);
    list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      const row = btn?.closest<HTMLElement>('.ka-row');
      if (!btn || !row) return;
      const id = row.dataset.id || '';
      if (btn.dataset.restore != null) {
        const lane = Number(row.querySelector<HTMLSelectElement>('select')?.value || 0);
        btn.disabled = true;
        void this.send({ type: 'restore_card', card: id, lane }, false).then((nb) => {
          if (nb) announce(t('Restored to {lane}', { lane: nb.lanes[lane]?.title || '' }));
          paint();
        });
      } else if (btn.dataset.del != null) {
        // Two steps: the button asks once more, then deletes.
        if (btn.dataset.sure !== '1') {
          btn.dataset.sure = '1';
          btn.classList.add('danger');
          btn.textContent = t('Delete for good?');
          setTimeout(() => {
            if (!btn.isConnected) return;
            btn.dataset.sure = '';
            btn.classList.remove('danger');
            btn.textContent = t('Delete forever');
          }, 4000);
          return;
        }
        btn.disabled = true;
        void this.send({ type: 'delete_card', card: id }, false).then(() => {
          announce(t('Card deleted. Its text stays in the note history.'));
          paint();
        });
      }
    });
    box.querySelector<HTMLElement>('[data-all]')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      // One at a time, each to its own lane; ids are read again after every change.
      for (let guard = 0; guard < 500; guard++) {
        const c = this.board?.archive[0];
        if (!c) break;
        const nb = await this.send({ type: 'restore_card', card: c.id, lane: laneOf(c) }, false);
        if (!nb) break;
      }
      paint();
      announce(t('Every archived card is back on the board'));
    });
    Modal.open({
      title: t('Archive'),
      sub: tn(this.board.archive.length, '{n} card', '{n} cards'),
      body: box,
      side: true,
      onOpen: () => {
        paint();
        q.focus();
      },
    });
  }

  /** A card asked for from elsewhere (Overview's Due list, a reminder): scroll to it, focus it and
   *  flash it once. Found by id, or by its block id when its text changed since. */
  takeReveal(): void {
    const r = reveal;
    const b = this.board;
    if (!r || r.path !== this.path || !b || this.density !== 'page') return;
    reveal = null;
    const all = b.lanes.flatMap((l) => l.cards);
    const c = all.find((x) => x.id === r.id) || (r.block ? all.find((x) => x.block === r.block) : undefined);
    if (!c) return;
    requestAnimationFrame(() => {
      const card = this.el.querySelector<HTMLElement>(`.kb-card[data-id="${CSS.escape(c.id)}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      card.focus({ preventScroll: true });
      card.classList.remove('kb-flash');
      void card.offsetWidth;
      card.classList.add('kb-flash');
    });
  }

  /** Draw again after typing or dragging ended, if the note changed meanwhile. */
  private settle(): void {
    if (this.busy()) return;
    if (this.needDraw) {
      this.needDraw = false;
      this.render();
    }
    if (this.stale) {
      this.stale = false;
      void this.refresh();
    }
  }

  // ── drawing ──────────────────────────────────────────────────────────────────────────────────

  private laneWidth(): number {
    const w = Number(this.board?.settings?.['lane-width']);
    if (this.density === 'chat') return 236;
    if (this.density === 'embed') return 264;
    return Number.isFinite(w) && w > 0 ? Math.min(480, Math.max(220, w)) : 280;
  }

  render(): void {
    const b = this.board;
    if (!b) return;
    const prevLanes = this.el.querySelector<HTMLElement>('.kb-lanes');
    const scrollX = prevLanes?.scrollLeft || 0;
    const laneScroll = new Map<number, number>();
    this.el.querySelectorAll<HTMLElement>('.kb-lane').forEach((l) => laneScroll.set(Number(l.dataset.lane), l.querySelector('.kb-cards')?.scrollTop || 0));
    const active = document.activeElement as HTMLElement | null;
    const focusId = active?.closest?.('.kb-card')?.getAttribute('data-id');
    const fresh = new Set<string>();
    const ids = new Set<string>();
    for (const l of b.lanes) for (const c of l.cards) ids.add(c.id);
    for (const c of b.archive) ids.add(c.id);
    if (!this.firstDraw) for (const id of ids) if (!this.seen.has(id)) fresh.add(id);
    this.seen = ids;
    this.firstDraw = false;

    this.el.removeAttribute('aria-busy');
    // The board look's S/M/L lane width is a factor on this board's own width.
    this.el.style.setProperty('--kb-lane-w', `calc(${this.laneWidth()}px * var(--kbl-lane-k, 1))`);
    const c = b.counts;
    const stats = c.cards
      ? `<span>${tn(c.cards, '{n} card', '{n} cards')}</span><span class="kb-stats-d" aria-hidden="true">·</span><span class="kb-stats-d">${t('{n} done', { n: c.done })}</span>`
      : b.lanes.length
        ? '' // each empty lane says so itself
        : t('No cards yet');
    const lanes = b.lanes.map((l) => this.laneHTML(l, fresh)).join('');
    const empty = b.lanes.length
      ? ''
      : `<div class="kb-empty">${IC.lane}<p><b>${t('This board has no lanes yet.')}</b><br>${t('Lanes are the columns of the board, such as To do, Doing and Done.')}</p></div>`;
    const st = b.style || {};
    this.el.style.setProperty('--board-c', st.color || '');
    // A bar with nothing in it is not drawn (no stray line above the lanes).
    const canAdd = this.density !== 'chat';
    const many = b.lanes.length > 1;
    const barEmpty = !stats && !(st.color || st.icon) && !(b.lanes.length && canAdd) && !many;
    // Lane navigation in the bar (shown while the lanes do not all fit): back, the lane in view (a
    // list of all lanes to jump to), forward. The same on every device; no dots to aim at.
    const laneNav = many
      ? `<span class="kb-nav" role="group" aria-label="${attr(t('Go to a lane'))}">
          <button type="button" class="vx-icon-btn kb-nav-b" data-act="lane-prev" aria-label="${attr(t('Previous lane'))}" title="${attr(t('Previous lane'))}">${icon('chev-left')}</button>
          <button type="button" class="kb-jump" data-act="lane-jump" aria-haspopup="menu" title="${attr(t('Go to a lane'))}"><span class="kb-jump-n"></span></button>
          <button type="button" class="vx-icon-btn kb-nav-b" data-act="lane-next" aria-label="${attr(t('Next lane'))}" title="${attr(t('Next lane'))}">${icon('chev-right')}</button>
        </span>`
      : '';
    this.el.innerHTML = `<div class="kb-bar"${barEmpty ? ' hidden' : ''}>
        ${st.color || st.icon ? `<span class="kb-mark" aria-hidden="true">${boardIcon(st.icon || 'kanban')}</span>` : ''}
        <span class="kb-stats">${stats}</span><span class="vx-grow"></span>
        ${canAdd ? `<button type="button" class="vx-icon-btn kb-bar-add" data-act="add-lane" aria-label="${attr(t('Add lane'))}" title="${attr(t('Add lane'))}">${I.plus}</button>` : ''}
        ${laneNav}
      </div>
      ${empty}
      <div class="kb-scroll"><div class="kb-lanes" role="list" aria-label="${attr(t('Lanes'))}">${lanes}${
        b.lanes.length ? `<button type="button" class="kb-add-lane" data-act="add-lane">${I.plus}<span>${t('Add lane')}</span></button>` : ''
      }</div></div>
      ${
        // The archive: a quiet link after the lanes (and in the board's ⋯ menu), opening a panel.
        b.archive.length && this.density !== 'chat'
          ? `<div class="kb-foot"><button type="button" class="kb-arch-link" data-act="archive" aria-haspopup="dialog">${IC.archive}<span>${esc(
              t('Archived ({n})', { n: b.archive.length }),
            )}</span></button></div>`
          : ''
      }
`;
    this.decorate();
    const lanesEl = this.el.querySelector<HTMLElement>('.kb-lanes');
    if (lanesEl) {
      lanesEl.scrollLeft = scrollX;
      lanesEl.addEventListener('scroll', () => this.syncScroll(), { passive: true });
      // A mouse wheel over the space between and under lanes moves the lanes sideways; over a card
      // list that can still scroll, the list scrolls as usual.
      lanesEl.addEventListener(
        'wheel',
        (e) => {
          if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || lanesEl.scrollWidth <= lanesEl.clientWidth) return;
          const list = (e.target as HTMLElement).closest<HTMLElement>('.kb-cards');
          if (list && list.scrollHeight > list.clientHeight + 1) {
            const atEnd = e.deltaY > 0 ? list.scrollTop + list.clientHeight >= list.scrollHeight - 1 : list.scrollTop <= 0;
            if (!atEnd) return;
          }
          if ((e.target as HTMLElement).closest('.kb-card, .kb-lane-head, .kb-add')) return;
          e.preventDefault();
          const rtl = getComputedStyle(lanesEl).direction === 'rtl';
          lanesEl.scrollLeft += rtl ? -e.deltaY : e.deltaY;
        },
        { passive: false },
      );
      // No scrollbars on a board: the edges fade while there is more that way.
      fadeScroll(lanesEl, 'x');
    }
    this.el.querySelectorAll<HTMLElement>('.kb-cards').forEach((c) => fadeScroll(c));
    this.syncScroll();
    this.el.querySelectorAll<HTMLElement>('.kb-lane').forEach((l) => {
      const s = laneScroll.get(Number(l.dataset.lane));
      const list = l.querySelector<HTMLElement>('.kb-cards');
      if (s && list) list.scrollTop = s;
    });
    if (focusId) {
      // A card the look now hides (ticked off with done cards hidden): its lane keeps the focus.
      const fc = this.el.querySelector<HTMLElement>(`.kb-card[data-id="${CSS.escape(focusId)}"]`);
      (fc && shown(fc) ? fc : fc?.closest('.kb-lane')?.querySelector<HTMLElement>('.kb-card:not(.done), .kb-add'))?.focus({ preventScroll: true });
    }
  }

  /** Mark whether the lanes overflow (for the dots) and which lane is in view. */
  private syncScroll(): void {
    cancelAnimationFrame(this.fadeRaf);
    this.fadeRaf = requestAnimationFrame(() => {
      const lanes = this.el.querySelector<HTMLElement>('.kb-lanes');
      if (!lanes) return;
      // RTL boxes count scrollLeft down from 0; the distance from the start is the same either way.
      const from = Math.abs(lanes.scrollLeft);
      const left = lanes.scrollWidth - lanes.clientWidth - from;
      const over = lanes.scrollWidth - lanes.clientWidth > 4;
      this.el.classList.toggle('kb-over', over);
      const jump = this.el.querySelector<HTMLElement>('.kb-jump');
      if (!jump) return;
      const r = lanes.getBoundingClientRect();
      const rtl = getComputedStyle(lanes).direction === 'rtl';
      // Lanes the board look hides (empty ones) take no part.
      const all = [...lanes.querySelectorAll<HTMLElement>(':scope > .kb-lane')].filter(shown);
      let cur = 0;
      // At the far end the last lanes can never reach the start edge: the last one is current.
      if (left <= 4) cur = all.length - 1;
      else
        all.forEach((l, i) => {
          const lr = l.getBoundingClientRect();
          const seen = rtl ? r.right - lr.right : lr.left - r.left;
          if (seen < lr.width / 2) cur = i;
        });
      this.curLane = cur;
      const title = all[cur]?.getAttribute('aria-label') || '';
      jump.querySelector('.kb-jump-n')!.textContent = `${cur + 1}/${all.length}`;
      jump.title = title;
      jump.setAttribute('aria-label', t('Lane {n} of {total}: {lane}. Go to a lane', { n: cur + 1, total: all.length, lane: title }));
      const prev = this.el.querySelector<HTMLButtonElement>('[data-act=lane-prev]');
      const next = this.el.querySelector<HTMLButtonElement>('[data-act=lane-next]');
      if (prev) prev.disabled = from <= 4;
      if (next) next.disabled = left <= 4;
    });
  }

  /** The lanes on screen (the board look can hide empty ones). */
  private shownLanes(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>('.kb-lanes > .kb-lane')].filter(shown);
  }

  /** Scroll the lanes (never the page around the board) so shown lane `i` starts at the edge. */
  private goLane(i: number): void {
    const all = this.shownLanes();
    const l = all[Math.max(0, Math.min(all.length - 1, i))];
    const lanes = this.el.querySelector<HTMLElement>('.kb-lanes');
    if (!l || !lanes) return;
    const cs = getComputedStyle(lanes);
    const pad = parseFloat(cs.scrollPaddingInlineStart) || 0;
    const r = lanes.getBoundingClientRect();
    const lr = l.getBoundingClientRect();
    const dx = cs.direction === 'rtl' ? lr.right - (r.right - pad) : lr.left - (r.left + pad);
    lanes.scrollBy({ left: dx, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  private laneHTML(l: KbLane, fresh: Set<string>): string {
    const n = l.cards.length;
    const over = l.max_items > 0 && n > l.max_items;
    const count = l.max_items > 0 ? `${n}/${l.max_items}` : String(n);
    return `<section class="kb-lane${l.complete ? ' complete' : ''}${l.color ? ' tinted' : ''}${l.index === this.keepLane ? ' kb-keep' : ''}" data-lane="${l.index}" role="listitem" tabindex="-1" aria-label="${attr(l.title)}"${
      l.color ? ` style="--lane-c:${attr(l.color)}"` : ''
    }>
      <header class="kb-lane-head" title="${attr(t('Drag to move the lane. Double click the name to rename it.'))}">
        <h3 class="kb-lane-title" dir="auto" title="${attr(l.title)}">${esc(l.title)}</h3>
        ${l.complete ? `<span class="kb-done-mark" title="${attr(t('Cards moved here are marked done'))}">${IC.check}</span>` : ''}
        <span class="kb-count${over ? ' over' : ''}" title="${attr(over ? t('More cards than the limit of {n}', { n: l.max_items }) : tn(n, '{n} card', '{n} cards'))}">${count}</span>
        <button type="button" class="vx-icon-btn kb-lane-more" data-act="lane-menu" aria-label="${attr(t('Lane actions'))}" title="${attr(t('Lane actions'))}">${I.more}</button>
      </header>
      <div class="kb-cards" role="list" aria-label="${attr(t('Cards in {lane}', { lane: l.title }))}">${l.cards.map((c) => this.cardHTML(c, fresh.has(c.id))).join('')}${
        n ? '' : `<div class="kb-none">${IC.lane}<span>${t('Drop a card here or add one')}</span></div>`
      }</div>
      <footer class="kb-lane-foot"><button type="button" class="kb-add" data-act="add-card">${I.plus}<span>${t('Add a card')}</span></button></footer>
    </section>`;
  }

  private cardHTML(c: KbCard, flash: boolean, archived = false): string {
    const body = c.html || `<p>${esc(c.text)}</p>`;
    // The earliest date is the due date: late, soon (three days) or later.
    const due = c.dates
      .filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d))
      .map((d) => d.slice(0, 10))
      .sort()[0];
    // Hooks for the board's look (colour by card, tag or due date): the card's own colour, its
    // first tag's colour and how close its date is.
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    const dueTag = !due || c.checked ? '' : due < today() ? 'late' : due <= `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}` ? 'soon' : 'later';
    const late = dueTag === 'late';
    const dueToday = !!due && !c.checked && due === today();
    // The board's own date colours (Obsidian Kanban's date-colors) colour the stroke when set.
    const rule = due && (late || dueToday) ? dateColorFor(due, this.board?.settings?.['date-colors']) : null;
    const dueStroke = rule ? rule.background || rule.color || '' : '';
    const tag = c.tags[0];
    const tagC = tag ? this.board?.tag_colors?.[tag]?.color || hashColor(tag) : '';
    const vars = [c.color ? `--card-c:${c.color}` : '', tagC ? `--tag-c:${tagC}` : '', dueStroke ? `--due-s:${dueStroke}` : ''].filter(Boolean).join(';');
    const steps = c.checklist || [];
    const stepsDone = steps.filter((x) => x.done).length;
    return `<article class="kb-card${c.checked ? ' done' : ''}${flash ? ' kb-flash' : ''}${late ? ' late' : dueToday ? ' today' : ''}${c.color ? ' colored' : ''}" data-id="${attr(c.id)}" tabindex="0" role="listitem"
        aria-label="${attr(c.title || c.text)}"${dueTag ? ` data-due="${dueTag}"` : ''}${vars ? ` style="${attr(vars)}"` : ''}>
      ${
        steps.length && !archived
          ? `<span class="kb-steps" title="${attr(t('{done} of {total} done', { done: stepsDone, total: steps.length }))}"><i><u style="width:${Math.round(
              (stepsDone / steps.length) * 100,
            )}%"></u></i><b>${stepsDone}/${steps.length}</b></span>`
          : ''
      }
      ${
        archived
          ? ''
          : `<button type="button" class="kb-check" data-act="toggle" aria-pressed="${c.checked}" aria-label="${attr(c.checked ? t('Mark as not done') : t('Mark as done'))}" title="${attr(
              c.checked ? t('Mark as not done') : t('Mark as done'),
            )}">${IC.check}</button>`
      }
      <div class="kb-body" dir="auto">${body}</div>
      ${
        archived
          ? `<span class="kb-card-acts"><button type="button" class="vx-icon-btn" data-act="restore" aria-label="${attr(t('Restore'))}" title="${attr(t('Put back on the board'))}">${IC.restore}</button>
             <button type="button" class="vx-icon-btn" data-act="delete" aria-label="${attr(t('Delete'))}" title="${attr(t('Delete for good'))}">${I.trash}</button></span>`
          : `<button type="button" class="vx-icon-btn kb-more" data-act="card-menu" aria-label="${attr(t('Card actions'))}" title="${attr(t('Card actions'))}">${I.more}</button>`
      }
    </article>`;
  }


  /** Links open notes, tags open the tag page, dates read as dates; Obsidian block ids are hidden. */
  private decorate(): void {
    this.el.querySelectorAll<HTMLElement>('.kb-body').forEach((body) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => ((n.parentElement?.closest('a,code,pre,button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
      });
      const texts: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
      const re = /@@\{([^}\n]+)\}|@\{([^}\n]+)\}|(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)|\s\^[A-Za-z0-9-]+\s*$|(^|\s)@([\p{L}\p{N}_](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_])?)/gu;
      for (const tx of texts) {
        const s = tx.data;
        re.lastIndex = 0;
        if (!re.test(s)) continue;
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let at = 0;
        for (let m = re.exec(s); m; m = re.exec(s)) {
          frag.append(s.slice(at, m.index));
          if (m[1] != null) {
            const time = el('span', 'kb-chip kb-time', `${IC.clock}<span>${esc(m[1])}</span>`);
            frag.append(time);
          } else if (m[2] != null) {
            const d = m[2];
            // A neutral chip: how close the date is shows as the card's stroke, not here.
            const chip = el('time', 'kb-chip kb-date', `${IC.cal}<span>${esc(fmtDate(d))}</span>`);
            chip.setAttribute('datetime', d);
            chip.title = d;
            frag.append(chip);
          } else if (m[4] != null) {
            frag.append(m[3] || '');
            const tag = tagChip(m[4], true);
            tag.dataset.tag = m[4];
            tag.dataset.act = 'tag';
            const tc = this.board?.tag_colors?.[m[4]]?.color;
            if (tc) tag.style.setProperty('--tc', tc);
            frag.append(tag);
          } else if (m[6] != null) {
            frag.append(m[5] || '');
            frag.append(mentionChip(m[6]));
          }
          at = m.index + m[0].length;
        }
        frag.append(s.slice(at));
        tx.replaceWith(frag);
      }
      body.querySelectorAll<HTMLElement>('a.wl').forEach((a) => {
        a.setAttribute('role', 'link');
        a.tabIndex = 0;
        chipLink(a);
      });
      // "- [ ] step" lines inside a card: a box to tick right on the card (archived cards: read only).
      const archived = !!body.closest('.kb-archive');
      let step = 0;
      body.querySelectorAll<HTMLElement>('li').forEach((li) => {
        const tx = li.firstChild;
        const m = tx && tx.nodeType === Node.TEXT_NODE ? /^\s*\[([ xX])\]\s/.exec(tx.textContent || '') : null;
        if (!tx || !m) return;
        tx.textContent = (tx.textContent || '').slice(m[0].length);
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'kb-step';
        box.checked = m[1] !== ' ';
        box.disabled = archived;
        box.dataset.step = String(step++);
        box.setAttribute('aria-label', `${box.checked ? t('Mark as not done') : t('Mark as done')}: ${(li.textContent || '').trim()}`);
        // The whole line is the target (a finger can hit it), not only the small box.
        const hit = document.createElement('label');
        hit.className = 'kb-step-hit';
        hit.append(box);
        li.prepend(hit);
        li.classList.add('kb-sub', ...(box.checked ? ['done'] : []));
      });
      body.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
        if (!a.classList.contains('wl')) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
      });
    });
  }

  // ── finding things ───────────────────────────────────────────────────────────────────────────

  private cardOf(id: string): { lane: KbLane | null; card: KbCard; pos: number } | null {
    const b = this.board;
    if (!b) return null;
    for (const l of b.lanes) {
      const pos = l.cards.findIndex((c) => c.id === id);
      if (pos >= 0) return { lane: l, card: l.cards[pos], pos };
    }
    const pos = b.archive.findIndex((c) => c.id === id);
    return pos >= 0 ? { lane: null, card: b.archive[pos], pos } : null;
  }

  private laneEl(i: number): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`.kb-lane[data-lane="${i}"]`);
  }

  // ── sending edits ────────────────────────────────────────────────────────────────────────────

  /** Show the edit at once, then send it; edits go out one at a time, each on the last version. */
  private send(op: KbOp, optimistic = true): Promise<KbBoard | null> {
    if (optimistic) {
      this.applyLocal(op);
      this.render();
    }
    let result: KbBoard | null = null;
    const run = async (): Promise<void> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const b = await apiPost<KbBoard>('/api/kanban', { path: this.path, version: this.version, op });
          result = b;
          this.version = b.version;
          this.host.saved(b);
          // Another edit queued behind this one keeps its optimistic look until it lands too.
          if (this.busy()) {
            this.board = b;
            this.needDraw = true;
          } else this.set(b);
          return;
        } catch (e) {
          const err = e as Error & { status?: number; data?: { board?: KbBoard } };
          const fresh = err.data?.board;
          if (err.status === 409 && fresh && attempt === 0 && this.stillFits(op, fresh)) {
            // Changed meanwhile (an agent, another tab): cards keep their ids, so apply it again on top.
            this.version = fresh.version;
            continue;
          }
          toast(err.status === 409 ? t('The board changed meanwhile. It now shows the latest version.') : err.message || t('The board could not be saved.'), 'err');
          if (fresh) this.set(fresh);
          else await this.load();
          return;
        }
      }
    };
    this.chain = this.chain.then(run, run);
    return this.chain.then(() => result);
  }

  /** Whether an edit still makes sense on a board that changed: its card and lanes are there. */
  private stillFits(op: KbOp, b: KbBoard): boolean {
    const has = (id: string): boolean => b.lanes.some((l) => l.cards.some((c) => c.id === id)) || b.archive.some((c) => c.id === id);
    if ('card' in op && !has(op.card)) return false;
    if ('lane' in op && typeof op.lane === 'number' && op.lane >= b.lanes.length) return false;
    return b.lanes.length === (this.board?.lanes.length ?? b.lanes.length);
  }

  /** The edit on the board shown, before the server confirms it. */
  private applyLocal(op: KbOp): void {
    const b = this.board;
    if (!b) return;
    const take = (id: string): KbCard | null => {
      const f = this.cardOf(id);
      if (!f) return null;
      (f.lane ? f.lane.cards : b.archive).splice(f.pos, 1);
      return f.card;
    };
    const recount = (): void => {
      const cards = b.lanes.flatMap((l) => l.cards);
      b.counts = { lanes: b.lanes.length, cards: cards.length, done: cards.filter((c) => c.checked).length, archived: b.archive.length };
    };
    switch (op.type) {
      case 'move_card': {
        const from = this.cardOf(op.card)?.lane;
        const c = take(op.card);
        const to = b.lanes[op.lane];
        if (!c || !to) break;
        if (from !== to) {
          if (to.complete) c.checked = true;
          else if (from?.complete) c.checked = false;
        }
        to.cards.splice(op.position ?? to.cards.length, 0, c);
        break;
      }
      case 'update_card': {
        const f = this.cardOf(op.card);
        if (!f) break;
        if (op.checked != null) f.card.checked = op.checked;
        if (op.text != null) {
          f.card.text = op.text;
          f.card.title = op.text.split('\n')[0];
          f.card.html = `<p>${esc(op.text).replace(/\n/g, '<br>')}</p>`;
        }
        break;
      }
      case 'archive_card': {
        const c = take(op.card);
        if (c) b.archive.push(c);
        break;
      }
      case 'restore_card': {
        const c = take(op.card);
        const to = b.lanes[op.lane ?? 0];
        if (c && to) to.cards.push(c);
        break;
      }
      case 'delete_card':
        take(op.card);
        break;
      case 'move_lane': {
        const [l] = b.lanes.splice(op.lane, 1);
        if (l) b.lanes.splice(op.position, 0, l);
        b.lanes.forEach((x, i) => (x.index = i));
        break;
      }
      case 'rename_lane':
        if (b.lanes[op.lane]) b.lanes[op.lane].title = op.title;
        break;
      case 'delete_lane':
        b.lanes.splice(op.lane, 1);
        b.lanes.forEach((x, i) => (x.index = i));
        break;
      default:
        break;
    }
    recount();
  }

  // ── clicks and keys ──────────────────────────────────────────────────────────────────────────

  /** A checklist step ticked on the card: one character of the card's text changes (a normal save:
   *  history, live update everywhere). */
  private onStep(e: Event): void {
    const box = e.target as HTMLInputElement;
    if (!box.matches?.('input.kb-step')) return;
    e.stopPropagation();
    const id = box.closest<HTMLElement>('.kb-card')?.dataset.id || '';
    const f = this.cardOf(id);
    const text = f ? toggleStep(f.card.text, Number(box.dataset.step), box.checked) : null;
    if (!f || text == null) {
      box.checked = !box.checked;
      return;
    }
    box.closest('li')?.classList.toggle('done', box.checked);
    announce(box.checked ? t('Marked as done') : t('Marked as not done'));
    // The box already shows the change: no optimistic redraw (it would show the raw text for a moment).
    void this.send({ type: 'update_card', card: id, text }, false);
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    // A cut-off lane title on a touch screen: a tap shows it in full for a moment.
    const title = target.closest<HTMLElement>('.kb-lane-title');
    if (title && this.lastPtr !== 'mouse' && title.scrollWidth > title.clientWidth + 1) {
      const head = title.closest<HTMLElement>('.kb-lane-head');
      if (head && !head.querySelector('.kb-tip')) {
        const tip = el('div', 'kb-tip', esc(title.textContent || ''));
        tip.setAttribute('role', 'status');
        head.appendChild(tip);
        setTimeout(() => tip.remove(), 2600);
      }
      return;
    }
    const link = target.closest<HTMLElement>('a.wl');
    if (link && this.el.contains(link)) {
      e.preventDefault();
      if (link.dataset.path && !link.classList.contains('broken')) this.host.openNote(link.dataset.path);
      else this.host.createNote(link.textContent || '', link);
      return;
    }
    const btn = target.closest<HTMLElement>('[data-act]');
    if (!btn || !this.el.contains(btn)) return;
    const card = btn.closest<HTMLElement>('.kb-card');
    const lane = btn.closest<HTMLElement>('.kb-lane');
    const id = card?.dataset.id || '';
    const li = lane ? Number(lane.dataset.lane) : -1;
    switch (btn.dataset.act) {
      case 'tag':
        e.stopPropagation();
        this.host.openTag(btn.dataset.tag || '');
        break;
      case 'open-note':
        e.stopPropagation();
        this.host.openNote(btn.dataset.open || '');
        break;
      case 'lane-prev':
        this.goLane(this.curLane - 1);
        break;
      case 'lane-next':
        this.goLane(this.curLane + 1);
        break;
      case 'lane-jump': {
        const all = this.shownLanes();
        openMenu(
          all.map((l, i) => ({
            label: `${l.getAttribute('aria-label') || ''}  ·  ${l.querySelectorAll('.kb-card').length}`,
            icon: i === this.curLane ? IC.check : IC.lane,
            run: () => this.goLane(i),
          })),
          btn,
        );
        break;
      }
      case 'toggle': {
        const f = this.cardOf(id);
        if (f) void this.send({ type: 'update_card', card: id, checked: !f.card.checked });
        break;
      }
      case 'card-menu':
        this.cardMenu(id, btn);
        break;
      case 'lane-menu':
        this.laneMenu(li, btn);
        break;
      case 'add-card':
        this.cardForm(null, li);
        break;
      case 'add-lane':
        this.askLane();
        break;
      case 'archive':
        this.openArchive();
        break;
      case 'restore':
        void this.send({ type: 'restore_card', card: id, lane: 0 });
        break;
      case 'delete':
        this.confirmDelete(id);
        break;
    }
  }

  private onDblClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('a,button,textarea')) return;
    const title = target.closest<HTMLElement>('.kb-lane-title');
    if (title) {
      this.renameLane(Number(title.closest<HTMLElement>('.kb-lane')!.dataset.lane));
      return;
    }
    const card = target.closest<HTMLElement>('.kb-card');
    if (card && !card.closest('.kb-archive')) this.cardForm(card.dataset.id || '', -1);
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
    if (e.key === 'Enter' && target.matches('a.wl')) {
      e.preventDefault();
      e.stopPropagation();
      target.click();
      return;
    }
    // Delete on the board never reaches the note pane (which would trash the whole note).
    if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
    if (e.ctrlKey || e.metaKey) return;
    const rtl = getComputedStyle(this.el).direction === 'rtl';
    const fwd = (k: string): number => ((k === 'ArrowRight') !== rtl ? 1 : -1);
    const cardsIn = (lane: number): HTMLElement[] => [...(this.laneEl(lane)?.querySelectorAll<HTMLElement>('.kb-card') || [])].filter(shown);
    if (e.key === '?' && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      boardKeysHelp();
      return;
    }
    // A lane has focus (reached with the arrows): move between lanes, into its cards, or add one.
    if (target.classList.contains('kb-lane') && !e.altKey && this.board) {
      const lane = Number(target.dataset.lane);
      const handled = ((): boolean => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const to = lane + fwd(e.key);
          if (to < 0 || to >= this.board!.lanes.length) return true;
          (cardsIn(to)[0] || this.laneEl(to))?.focus();
          return true;
        }
        if (e.key === 'ArrowDown') {
          cardsIn(lane)[0]?.focus();
          return true;
        }
        if (e.key === 'n' || e.key === 'N') {
          this.cardForm(null, lane);
          return true;
        }
        return false;
      })();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const card = target.classList.contains('kb-card') ? target : null;
    if (!card || card.closest('.kb-archive')) return;
    const id = card.dataset.id || '';
    const f = this.cardOf(id);
    if (!f || !f.lane) return;
    const lane = f.lane.index;
    const lanes = this.board!.lanes;
    const handled = ((): boolean => {
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const to = lane + fwd(e.key);
        if (to >= 0 && to < lanes.length) {
          const pos = Math.min(f.pos, lanes[to].cards.length);
          void this.send({ type: 'move_card', card: id, lane: to, position: pos });
          announce(t('Moved to {lane}, {pos} of {n}', { lane: lanes[to].title, pos: pos + 1, n: lanes[to].cards.length + 1 }));
        }
        return true;
      }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const pos = f.pos + (e.key === 'ArrowDown' ? 1 : -1);
        if (pos >= 0 && pos < f.lane!.cards.length) {
          void this.send({ type: 'move_card', card: id, lane, position: pos });
          announce(t('Moved to {lane}, {pos} of {n}', { lane: f.lane!.title, pos: pos + 1, n: f.lane!.cards.length }));
        }
        return true;
      }
      if (e.altKey) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const cards = cardsIn(lane);
        const i = cards.indexOf(card) + (e.key === 'ArrowDown' ? 1 : -1);
        // Up from the first card reaches its lane.
        (i < 0 ? this.laneEl(lane) : cards[i])?.focus();
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const to = lane + fwd(e.key);
        if (to < 0 || to >= lanes.length) return true;
        const cards = cardsIn(to);
        // An empty lane takes the focus itself.
        (cards.length ? cards[Math.min(f.pos, cards.length - 1)] : this.laneEl(to))?.focus();
        return true;
      }
      if (e.key === 'Enter' || e.key === 'e' || e.key === 'E' || e.key === 'F2') {
        this.cardForm(id, -1);
        return true;
      }
      if (e.key === ' ' || e.key === 'x' || e.key === 'X') {
        void this.send({ type: 'update_card', card: id, checked: !f.card.checked });
        announce(f.card.checked ? t('Marked as not done') : t('Marked as done'));
        return true;
      }
      if (e.key === 'n' || e.key === 'N') {
        this.cardForm(null, lane);
        return true;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Focus moves on to a neighbour before the card leaves.
        const cards = cardsIn(lane);
        const next = cards[cards.indexOf(card) + 1] || cards[cards.indexOf(card) - 1] || this.laneEl(lane);
        const text = f.card.text;
        void this.send({ type: 'archive_card', card: id }).then((nb) => {
          const a = nb?.archive.find((c) => c.text === text);
          undoToast(t('Card archived'), a ? () => void this.send({ type: 'restore_card', card: a.id, lane }) : null, 'info', 6000);
        });
        requestAnimationFrame(() => (next && next.isConnected ? next : this.laneEl(lane))?.focus());
        return true;
      }
      return false;
    })();
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey) requestAnimationFrame(() => this.el.querySelector<HTMLElement>(`.kb-card[data-id="${CSS.escape(id)}"]`)?.focus());
    }
  }

  // ── menus and dialogs ────────────────────────────────────────────────────────────────────────

  private cardMenu(id: string, at: HTMLElement): void {
    const f = this.cardOf(id);
    const b = this.board;
    if (!f || !f.lane || !b) return;
    const items: MenuItem[] = [
      { label: t('Edit'), icon: I.edit, hint: 'E', run: () => this.cardForm(id, -1) },
      {
        label: f.card.checked ? t('Mark as not done') : t('Mark as done'),
        icon: I.check,
        run: () => void this.send({ type: 'update_card', card: id, checked: !f.card.checked }),
      },
    ];
    const others = b.lanes.filter((l) => l !== f.lane);
    if (others.length) {
      items.push({ sep: true, label: '' });
      for (const l of others.slice(0, 12)) {
        items.push({ label: t('Move to {lane}', { lane: l.title }), icon: I.move, run: () => void this.send({ type: 'move_card', card: id, lane: l.index }) });
      }
    }
    items.push({ sep: true, label: '' });
    items.push({ label: t('Duplicate'), icon: I.copy, run: () => void this.send({ type: 'duplicate_card', card: id }, false) });
    items.push({
      label: t('Color'),
      icon: IC.dot,
      swatch: {
        value: f.card.color || '',
        pick: (c) => void this.send({ type: 'set_card_color', card: id, color: c || null }, false),
        custom: () => this.pickColor(t('Card color'), f.card.color || '', (c) => void this.send({ type: 'set_card_color', card: id, color: c || null }, false)),
      },
    });
    items.push({ label: t('Copy text'), icon: I.copy, run: () => void navigator.clipboard?.writeText(f.card.text).then(() => toast(t('Copied'), 'ok', 1600)) });
    items.push({ label: t('Archive'), icon: IC.archive, hint: 'Del', run: () => void this.send({ type: 'archive_card', card: id }) });
    items.push({
      label: t('Delete'),
      icon: I.trash,
      danger: true,
      run: () => {
        // Delete at once, with Undo (the card comes back where it was).
        const { text, checked } = f.card;
        const lane = f.lane!.index;
        const pos = f.pos;
        const color = f.card.color || undefined;
        void this.send({ type: 'delete_card', card: id }).then((nb) => {
          if (nb) undoToast(t('Card deleted'), () => void this.send({ type: 'add_card', lane, text, position: pos, checked: checked || undefined, color }, false), 'info', 6000);
        });
      },
    });
    openMenu(items, at);
  }

  private laneMenu(i: number, at: HTMLElement): void {
    const b = this.board;
    const l = b?.lanes[i];
    if (!b || !l) return;
    const rtl = getComputedStyle(this.el).direction === 'rtl';
    const n = l.cards.length;
    const setColor = (c: string): void => void this.send({ type: 'set_lane_color', lane: i, color: c || null }, false);
    // Grouped: the lane itself (name, colour, limit), where it sits, its cards, then deleting it.
    const items: MenuItem[] = [
      { label: t('Add a card'), icon: I.plus, hint: 'N', run: () => this.cardForm(null, i) },
      { sep: true, label: '' },
      { label: t('Rename'), icon: I.rename, run: () => this.renameLane(i) },
      { label: t('Color'), icon: IC.dot, swatch: { value: l.color || '', pick: setColor, custom: () => this.pickColor(t('Lane color'), l.color || '', setColor) } },
      { label: t('Card limit…'), icon: IC.limit, hint: l.max_items ? String(l.max_items) : '', run: () => this.askLimit(i) },
      { sep: true, label: '' },
      {
        label: rtl ? t('Move right') : t('Move left'),
        icon: I.back,
        disabled: i === 0,
        run: () => void this.send({ type: 'move_lane', lane: i, position: i - 1 }),
      },
      {
        label: rtl ? t('Move left') : t('Move right'),
        icon: I.caret,
        disabled: i >= b.lanes.length - 1,
        run: () => void this.send({ type: 'move_lane', lane: i, position: i + 1 }),
      },
      { label: t('Add lane after this one'), icon: IC.lane, run: () => this.askLane(i + 1) },
      { label: t('Duplicate lane'), icon: I.copy, run: () => void this.send({ type: 'duplicate_lane', lane: i, title: t('{name} copy', { name: l.title }) }, false) },
      { sep: true, label: '' },
      {
        label: t('Archive all cards'),
        icon: IC.archive,
        disabled: !n,
        run: () => void this.archiveLane(i),
      },
      {
        label: t('Clear all cards…'),
        icon: IC.clear,
        disabled: !n,
        run: () => this.confirmClear(i),
      },
      { sep: true, label: '' },
      {
        label: t('Delete lane…'),
        icon: I.trash,
        danger: true,
        run: () => this.confirmDeleteLane(i),
      },
    ];
    openMenu(items, at);
  }

  /** Every card of a lane into the archive, with Undo (each goes back to this lane). */
  private async archiveLane(i: number): Promise<void> {
    const b = this.board;
    const l = b?.lanes[i];
    if (!b || !l) return;
    const before = new Set(b.archive.map((c) => c.id));
    const n = l.cards.length;
    const nb = await this.send({ type: 'archive_lane_cards', lane: i }, false);
    if (!nb) return;
    const moved = nb.archive.filter((c) => !before.has(c.id)).map((c) => c.text);
    undoToast(
      tn(n, '{n} card archived', '{n} cards archived'),
      async () => {
        for (const text of moved) {
          const c = this.board?.archive.find((x) => x.text === text);
          if (c) await this.send({ type: 'restore_card', card: c.id, lane: i }, false);
        }
      },
      'info',
      6000,
    );
  }

  /** Delete a lane. An empty one goes at once (with Undo); one with cards asks first and archives
   *  its cards, so nothing is lost. */
  private confirmDeleteLane(i: number): void {
    const b = this.board;
    const l = b?.lanes[i];
    if (!b || !l) return;
    const { title, color, max_items, complete } = l;
    const drop = async (): Promise<void> => {
      const nb = await this.send({ type: 'delete_lane', lane: i });
      if (!nb) return;
      // A Complete lane cannot be made again from here: no Undo for it (History has it).
      const undo = complete
        ? null
        : async (): Promise<void> => {
            const back = await this.send({ type: 'add_lane', title, position: i }, false);
            if (back && color) await this.send({ type: 'set_lane_color', lane: i, color }, false);
            if (back && max_items) await this.send({ type: 'set_lane_limit', lane: i, max: max_items }, false);
          };
      undoToast(t('Lane deleted'), undo ? () => void undo() : null, 'info', 6000);
    };
    if (!l.cards.length) {
      void drop();
      return;
    }
    Modal.confirm(
      t('Delete the lane "{name}"?', { name: title }),
      tn(
        l.cards.length,
        'Its {n} card goes to the Archive first, where you can restore it to another lane.',
        'Its {n} cards go to the Archive first, where you can restore them to another lane.',
      ),
      t('Archive cards and delete lane'),
      async () => {
        Modal.close();
        const nb = await this.send({ type: 'archive_lane_cards', lane: i }, false);
        if (nb) await drop();
      },
    );
  }

  /** The board's own colour and icon (kept in the board's settings, so they travel with the file). */
  editStyle(): void {
    const b = this.board;
    if (!b) return;
    boardStyleDialog(b.style || {}, (op) => void this.send(op, false));
  }

  /** A small dialog with the colour picker; `done` gets "#rrggbb", or "" for no colour. */
  pickColor(title: string, value: string, done: (c: string) => void): void {
    let start = '';
    Modal.open({
      title,
      body: `<div style="padding:4px 0">${colorPickHTML('kbColor', value, { none: true })}</div>`,
      actions: [
        { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
        {
          label: t('Save'),
          cls: 'primary',
          run: (body) => {
            const v = (body.querySelector<HTMLElement>('#kbColor')?.dataset.value || '').trim();
            Modal.close();
            // Unchanged (also a colour the picker cannot show, kept as it is): nothing to save.
            if (v !== start) done(v);
          },
        },
      ],
      onOpen: (body) => {
        wireColorPick(body, 'kbColor');
        start = body.querySelector<HTMLElement>('#kbColor')?.dataset.value || '';
        (body.querySelector<HTMLElement>('.cpk-sw[aria-checked=true]') || body.querySelector<HTMLElement>('.cpk-sw'))?.focus();
      },
    });
  }

  private askLimit(i: number): void {
    const l = this.board?.lanes[i];
    if (!l) return;
    const go = (body: ParentNode): void => {
      const v = Math.max(0, Math.min(999, Math.round(Number(body.querySelector<HTMLInputElement>('#kbLimit')?.value || 0)) || 0));
      Modal.close();
      if (v !== l.max_items) void this.send({ type: 'set_lane_limit', lane: i, max: v }, false);
    };
    Modal.open({
      title: t('Card limit for {lane}', { lane: l.title }),
      body:
        Modal.field(t('Most cards in this lane (0 for no limit)'), 'kbLimit', { value: String(l.max_items || 0) }) +
        `<p class="cf-hint" style="margin:6px 0 0">${t('Over the limit, the count turns amber. Obsidian Kanban reads the same limit.')}</p>`,
      actions: [
        { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
        { label: t('Save'), cls: 'primary', run: (body) => go(body) },
      ],
      onOpen: (body) => {
        const input = body.querySelector<HTMLInputElement>('#kbLimit');
        if (!input) return;
        input.type = 'number';
        input.min = '0';
        input.inputMode = 'numeric';
        input.focus();
        input.select();
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go(body);
          }
        };
      },
    });
  }

  private confirmClear(i: number): void {
    const l = this.board?.lanes[i];
    if (!l) return;
    Modal.open({
      title: t('Delete every card in {lane}?', { lane: l.title }),
      body: `<p style="margin:0">${tn(l.cards.length, '{n} card goes.', '{n} cards go.')} ${t('Their text stays in the note history, so you can restore an earlier version.')}</p>`,
      actions: [
        { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
        {
          label: t('Clear all cards'),
          cls: 'danger',
          run: () => {
            Modal.close();
            void this.send({ type: 'clear_lane', lane: i }, false);
          },
        },
      ],
    });
  }

  private confirmDelete(id: string): void {
    const f = this.cardOf(id);
    if (!f) return;
    Modal.open({
      title: t('Delete this card?'),
      body: `<p style="margin:0">${t('The card is removed from the board. Its text stays in the note history, so you can restore an earlier version.')}</p><blockquote class="kb-quote" dir="auto">${esc(f.card.title)}</blockquote>`,
      actions: [
        { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
        {
          label: t('Delete'),
          cls: 'danger',
          run: () => {
            Modal.close();
            void this.send({ type: 'delete_card', card: id });
          },
        },
      ],
    });
  }

  private askLane(position?: number): void {
    const go = (v: string): void => {
      Modal.close();
      void this.send({ type: 'add_lane', title: v, position }, false).then(() => {
        // A new lane is empty: it stays in view even when empty lanes are hidden.
        this.keepLane = position ?? (this.board?.lanes.length || 1) - 1;
        this.render();
        requestAnimationFrame(() => {
          const n = position ?? (this.board?.lanes.length || 1) - 1;
          this.laneEl(n)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        });
      });
    };
    const value = (body: ParentNode): string => body.querySelector<HTMLInputElement>('#kbLaneName')?.value.trim() || '';
    Modal.open({
      title: t('Add lane'),
      body: Modal.field(t('Lane name'), 'kbLaneName', { value: '', ph: t('For example: Review') }),
      actions: [
        { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
        {
          label: t('Add lane'),
          cls: 'primary',
          run: (body) => {
            const v = value(body);
            if (v) go(v);
          },
        },
      ],
      onOpen: (body) => {
        const input = body.querySelector<HTMLInputElement>('#kbLaneName');
        if (!input) return;
        input.maxLength = 200;
        input.focus();
        input.onkeydown = (e) => {
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          const v = value(body);
          if (v) go(v);
        };
      },
    });
  }

  private renameLane(i: number): void {
    const l = this.board?.lanes[i];
    const h = this.laneEl(i)?.querySelector<HTMLElement>('.kb-lane-title');
    if (!l || !h) return;
    this.renaming = true;
    void inlineEdit(h, l.title).then((v) => {
      this.renaming = false;
      const title = (v || '').trim();
      if (title && title !== l.title) void this.send({ type: 'rename_lane', lane: i, title });
      this.settle();
    });
  }

  // ── the card form ────────────────────────────────────────────────────────────────────────────

  /** Add a card to lane `lane` (`id` null) or edit card `id`, in the card form. */
  private cardForm(id: string | null, lane: number): void {
    const b = this.board;
    if (!b) return;
    const f = id ? this.cardOf(id) : null;
    if (id && (!f || !f.lane)) return;
    const from = f?.lane?.index ?? lane;
    openCardForm({
      text: f?.card.text || '',
      checked: f?.card.checked || false,
      color: f?.card.color || '',
      lane: from,
      lanes: b.lanes.map((l) => ({ index: l.index, title: l.title })),
      settings: (b.settings || {}) as CardSettings,
      boardTags: [...new Set(b.lanes.flatMap((l) => l.cards.flatMap((c) => c.tags)))],
      isNew: !id,
      self: this.path,
      save: (r) => void this.saveCard(id, r),
      archive: id
        ? () =>
            void this.send({ type: 'archive_card', card: id }).then((nb) => {
              const text = f!.card.text;
              const a = nb?.archive.find((c) => c.text === text);
              undoToast(t('Card archived'), a ? () => void this.send({ type: 'restore_card', card: a.id, lane: from }) : null, 'info', 6000);
            })
        : undefined,
      remove: id ? () => void this.send({ type: 'delete_card', card: id }).then(() => undoToast(t('Card deleted. Its text stays in the note history.'), null, 'info', 5000)) : undefined,
    });
  }

  /** Write what the card form says: one edit for the text and done, one for the lane. */
  private async saveCard(id: string | null, r: { text: string; checked: boolean; lane: number; color: string }): Promise<void> {
    if (!id) {
      await this.send({ type: 'add_card', lane: r.lane, text: r.text, checked: r.checked || undefined, color: r.color || undefined }, false);
      const list = this.laneEl(r.lane)?.querySelector<HTMLElement>('.kb-cards');
      if (list) list.scrollTop = list.scrollHeight;
      return;
    }
    const f = this.cardOf(id);
    if (!f || !f.lane) {
      toast(t('The board changed meanwhile. It now shows the latest version.'), 'err');
      return;
    }
    let cur = id;
    if (r.text !== f.card.text || r.checked !== f.card.checked) {
      const lane = f.lane.index;
      const pos = f.pos;
      const nb = await this.send({
        type: 'update_card',
        card: id,
        text: r.text !== f.card.text ? r.text : undefined,
        checked: r.checked !== f.card.checked ? r.checked : undefined,
      });
      if (!nb) return;
      // New text is a new id: the card is the one at the same place.
      cur = nb.card || nb.lanes[lane]?.cards[pos]?.id || cur;
    }
    if ((r.color || '') !== (f.card.color || '')) {
      const nb = await this.send({ type: 'set_card_color', card: cur, color: r.color || null }, false);
      // A block id was added: the card's text (and id) changed.
      if (nb) cur = nb.card || nb.lanes[f.lane.index]?.cards[f.pos]?.id || cur;
    }
    if (r.lane !== f.lane.index) await this.send({ type: 'move_card', card: cur, lane: r.lane });
    requestAnimationFrame(() => this.el.querySelector<HTMLElement>(`.kb-card[data-id="${CSS.escape(cur)}"]`)?.focus({ preventScroll: true }));
  }

  // ── dragging (mouse, pen and touch) ──────────────────────────────────────────────────────────

  private onPointerDown(e: PointerEvent): void {
    this.lastPtr = e.pointerType;
    if (e.button !== 0 || this.drag) return;
    const target = e.target as HTMLElement;
    if (target.closest('button,a,textarea,input,label,.kb-archive')) return;
    const card = target.closest<HTMLElement>('.kb-card');
    const head = card ? null : target.closest<HTMLElement>('.kb-lane-head');
    if (!card && !head) return;
    const src = card || head!.closest<HTMLElement>('.kb-lane')!;
    const touch = e.pointerType !== 'mouse';
    const x0 = e.clientX;
    const y0 = e.clientY;
    let armed = !touch;
    let timer = 0;
    const blockScroll = (ev: TouchEvent): void => {
      if (this.drag || armed) ev.preventDefault();
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', blockScroll);
      this.press = null;
    };
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      const dist = Math.hypot(ev.clientX - x0, ev.clientY - y0);
      if (!this.drag) {
        // A finger that moves before the long press is scrolling, not dragging.
        if (!armed) {
          if (dist > 8) cleanup();
          return;
        }
        if (dist < 5) return;
        this.begin(card ? 'card' : 'lane', src, x0, y0);
      }
      ev.preventDefault();
      this.dragTo(ev.clientX, ev.clientY);
    };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      cleanup();
      if (this.drag) this.drop();
    };
    const cancel = (): void => {
      cleanup();
      if (this.drag) this.drop(true);
    };
    if (touch) {
      timer = window.setTimeout(() => {
        armed = true;
        src.classList.add('kb-armed');
        navigator.vibrate?.(8);
        setTimeout(() => src.classList.remove('kb-armed'), 300);
      }, 320);
      document.addEventListener('touchmove', blockScroll, { passive: false });
    }
    this.press = cleanup;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  private begin(kind: 'card' | 'lane', src: HTMLElement, x: number, y: number): void {
    const r = src.getBoundingClientRect();
    const ghost = src.cloneNode(true) as HTMLElement;
    ghost.classList.add('kb-ghost');
    ghost.removeAttribute('id');
    ghost.style.width = r.width + 'px';
    ghost.style.height = kind === 'lane' ? Math.min(r.height, 420) + 'px' : r.height + 'px';
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.setProperty('--kb-lane-w', r.width + 'px');
    // On the body (the note pane is a size container, which would offset a fixed element), in a
    // layer that carries the board's size and density so the lifted copy looks the same.
    const layer = el('div', `kb kb-${this.density} kb-ghost-layer`);
    layer.style.cssText = `position:fixed;left:0;top:0;width:${this.el.clientWidth}px;height:0;z-index:9000;pointer-events:none;--kb-lane-w:${r.width}px`;
    // The lifted card keeps the look in effect on this board.
    const cs = getComputedStyle(this.el);
    for (const n of KBL_VARS) layer.style.setProperty(n, cs.getPropertyValue(n).trim() || 'initial');
    layer.appendChild(ghost);
    document.body.appendChild(layer);
    const laneEl = kind === 'card' ? src.closest<HTMLElement>('.kb-lane') : src;
    const fromLane = Number(laneEl?.dataset.lane ?? -1);
    const fromPos =
      kind === 'card'
        ? [...(src.parentElement?.querySelectorAll('.kb-card') || [])].indexOf(src)
        : [...this.el.querySelectorAll('.kb-lanes > .kb-lane')].indexOf(src);
    src.classList.add('kb-src');
    this.el.classList.add('kb-dragging', kind === 'card' ? 'kb-drag-card' : 'kb-drag-lane');
    document.body.classList.add('kb-nosel');
    this.drag = { kind, src, ghost, offX: x - r.left, offY: y - r.top, x, y, fromLane, fromPos, raf: 0 };
    const tick = (): void => {
      if (!this.drag) return;
      this.autoScroll();
      this.drag.raf = requestAnimationFrame(tick);
    };
    this.drag.raf = requestAnimationFrame(tick);
  }

  private dragTo(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    d.x = x;
    d.y = y;
    d.ghost.style.transform = `translate(${x - d.offX - parseFloat(d.ghost.style.left)}px,${y - d.offY - parseFloat(d.ghost.style.top)}px) rotate(${d.kind === 'card' ? 2 : 1}deg)`;
    const lanesEl = this.el.querySelector<HTMLElement>('.kb-lanes');
    if (!lanesEl) return;
    const rtl = getComputedStyle(lanesEl).direction === 'rtl';
    if (d.kind === 'card') {
      // The lane under the pointer, else the nearest one across.
      const lanes = [...lanesEl.querySelectorAll<HTMLElement>(':scope > .kb-lane')].filter(shown);
      let lane = lanes.find((l) => {
        const r = l.getBoundingClientRect();
        return x >= r.left && x <= r.right;
      });
      if (!lane) {
        let best = Infinity;
        for (const l of lanes) {
          const r = l.getBoundingClientRect();
          const dist = Math.min(Math.abs(x - r.left), Math.abs(x - r.right));
          if (dist < best) {
            best = dist;
            lane = l;
          }
        }
      }
      const list = lane?.querySelector<HTMLElement>('.kb-cards');
      if (!list) return;
      list.querySelector('.kb-none')?.remove();
      const cards = [...list.querySelectorAll<HTMLElement>(':scope > .kb-card:not(.kb-src)')];
      const before = cards.find((c) => {
        const r = c.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      if (before) {
        if (d.src.nextElementSibling !== before) list.insertBefore(d.src, before);
      } else if (list.lastElementChild !== d.src) list.appendChild(d.src);
      this.el.querySelectorAll('.kb-lane.kb-over').forEach((l) => l !== lane && l.classList.remove('kb-over'));
      lane?.classList.add('kb-over');
    } else {
      const lanes = [...lanesEl.querySelectorAll<HTMLElement>(':scope > .kb-lane:not(.kb-src)')].filter(shown);
      const before = lanes.find((l) => {
        const r = l.getBoundingClientRect();
        const mid = r.left + r.width / 2;
        return rtl ? x > mid : x < mid;
      });
      if (before) {
        if (d.src.nextElementSibling !== before) lanesEl.insertBefore(d.src, before);
      } else {
        const tail = lanesEl.querySelector('.kb-add-lane');
        if (d.src.nextElementSibling !== tail) lanesEl.insertBefore(d.src, tail);
      }
    }
  }

  /** Near an edge while dragging: scroll the lanes sideways, the lane's cards and the page up or down. */
  private autoScroll(): void {
    const d = this.drag;
    if (!d) return;
    const edge = 56;
    const speed = (dist: number): number => Math.ceil(((edge - dist) / edge) * 18);
    const lanesEl = this.el.querySelector<HTMLElement>('.kb-lanes');
    if (lanesEl) {
      const r = lanesEl.getBoundingClientRect();
      if (d.x < r.left + edge) lanesEl.scrollLeft -= speed(Math.max(0, d.x - r.left));
      else if (d.x > r.right - edge) lanesEl.scrollLeft += speed(Math.max(0, r.right - d.x));
    }
    const scroller = this.el.closest<HTMLElement>('.vx-note-scroll, .mn-log');
    const list = d.kind === 'card' ? d.src.closest<HTMLElement>('.kb-cards') : null;
    for (const s of [list, scroller]) {
      if (!s || s.scrollHeight <= s.clientHeight) continue;
      const r = s.getBoundingClientRect();
      if (d.y < r.top + edge && s.scrollTop > 0) {
        s.scrollTop -= speed(Math.max(0, d.y - r.top));
        break;
      }
      if (d.y > r.bottom - edge && s.scrollTop + s.clientHeight < s.scrollHeight) {
        s.scrollTop += speed(Math.max(0, r.bottom - d.y));
        break;
      }
    }
    // Content moved under a still pointer: place the card again.
    this.dragTo(d.x, d.y);
  }

  private drop(cancelled = false): void {
    const d = this.drag;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    this.drag = null;
    if (d.ghost.parentElement?.classList.contains('kb-ghost-layer')) d.ghost.parentElement.remove();
    else d.ghost.remove();
    d.src.classList.remove('kb-src');
    this.el.classList.remove('kb-dragging', 'kb-drag-card', 'kb-drag-lane');
    this.el.querySelectorAll('.kb-over').forEach((l) => l.classList.remove('kb-over'));
    document.body.classList.remove('kb-nosel');
    if (cancelled) {
      this.render();
      this.settle();
      return;
    }
    if (d.kind === 'card') {
      const lane = d.src.closest<HTMLElement>('.kb-lane');
      const to = Number(lane?.dataset.lane ?? -1);
      const pos = [...(d.src.parentElement?.querySelectorAll('.kb-card') || [])].indexOf(d.src);
      const id = d.src.dataset.id || '';
      if (to < 0 || pos < 0 || (to === d.fromLane && pos === d.fromPos)) {
        this.render();
      } else {
        void this.send({ type: 'move_card', card: id, lane: to, position: pos });
        requestAnimationFrame(() => this.el.querySelector<HTMLElement>(`.kb-card[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
      }
    } else {
      const pos = [...this.el.querySelectorAll('.kb-lanes > .kb-lane')].indexOf(d.src);
      if (pos < 0 || pos === d.fromPos) this.render();
      else void this.send({ type: 'move_lane', lane: d.fromLane, position: pos });
    }
    this.settle();
  }

  destroy(): void {
    this.ro?.disconnect();
    cancelAnimationFrame(this.fadeRaf);
    this.press?.();
    if (this.drag) this.drop(true);
    this.loadSeq++;
    this.el.remove();
  }
}

// ── one view per open note ─────────────────────────────────────────────────────────────────────

let current: KanbanView | null = null;

/** Put the board of `path` into `host`, reusing the one already shown for that note. */
export function mountBoard(hostEl: HTMLElement, path: string, host: KanbanHost): KanbanView {
  if (current && current.path === path) {
    hostEl.appendChild(current.el);
    current.render();
    return current;
  }
  current?.destroy();
  current = new KanbanView(path, host);
  hostEl.appendChild(current.el);
  void current.load();
  return current;
}

/** The colour and icon dialog of a board; `save` gets an op with what changed (nothing changed: no call). */
function boardStyleDialog(cur: { color?: string | null; icon?: string | null }, save: (op: KbOp) => void): void {
  let pick = cur.icon || 'kanban';
  let start = '';
  const grid = BOARD_ICONS.map(
    (n) => `<button type="button" class="kb-ico-o" role="radio" aria-checked="${n === pick}" data-ico="${n}" aria-label="${attr(n)}">${icon(n)}</button>`,
  ).join('');
  useStyles('kanban-css', KANBAN_CSS);
  Modal.open({
    title: t('Board color and icon'),
    body: `<div class="kb-style"><span class="cf-k">${t('Color')}</span>${colorPickHTML('kbBoardC', cur.color || '', { none: true })}
      <span class="cf-k">${t('Icon')}</span><div class="kb-ico-g" role="radiogroup" aria-label="${attr(t('Icon'))}">${grid}</div></div>`,
    actions: [
      { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
      {
        label: t('Save'),
        cls: 'primary',
        run: (body) => {
          const color = body.querySelector<HTMLElement>('#kbBoardC')?.dataset.value || '';
          Modal.close();
          const op: KbOp = { type: 'set_board_style' };
          if (color !== start) op.color = color || null;
          if (pick !== (cur.icon || 'kanban')) op.icon = pick === 'kanban' ? null : pick;
          if ('color' in op || 'icon' in op) save(op);
        },
      },
    ],
    onOpen: (body) => {
      wireColorPick(body, 'kbBoardC');
      start = body.querySelector<HTMLElement>('#kbBoardC')?.dataset.value || '';
      body.querySelectorAll<HTMLElement>('.kb-ico-o').forEach((o) => {
        o.onclick = () => {
          pick = o.dataset.ico || 'kanban';
          body.querySelectorAll<HTMLElement>('.kb-ico-o').forEach((x) => x.setAttribute('aria-checked', String(x === o)));
        };
      });
    },
  });
}

/** Colour and icon of a board from outside it (the Boards page): the open board when it is on the
 *  page, else read and written straight on the server. */
export async function editBoardStyle(path: string): Promise<void> {
  const open = boardFor(path);
  if (open) {
    open.editStyle();
    return;
  }
  let b: KbBoard;
  try {
    b = await apiGet<KbBoard>('/api/kanban?path=' + encodeURIComponent(path));
  } catch (e) {
    undoToast(t('Could not load the board: {error}', { error: (e as Error).message }), null, 'err');
    return;
  }
  boardStyleDialog(b.style || {}, (op) =>
    void apiPost<KbBoard>('/api/kanban', { path, version: b.version, op }).catch((e: Error) =>
      undoToast(t('Could not save the board: {error}', { error: e.message }), null, 'err'),
    ),
  );
}

let reveal: { path: string; id: string; block?: string | null } | null = null;

/** Open the board at one card: the board page scrolls to it once it is drawn (now, if it is open). */
export function revealCard(path: string, id: string, block?: string | null): void {
  reveal = { path, id, block };
  boardFor(path)?.takeReveal();
}

/** The board shown for `path`, if it is on the page. */
export function boardFor(path: string): KanbanView | null {
  return current && current.path === path && current.el.isConnected ? current : null;
}

/** The note pane closed the board (another note, the editor, the text view). */
export function unmountBoard(): void {
  current?.destroy();
  current = null;
}
