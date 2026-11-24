// Reading settings ("Aa"): how notes read and how boards look. Stored per browser (localStorage):
// global choices plus optional per-note overrides (by note path), the override winning.
//
// API
//   applyReading(area, editing, path?)
//       Put the settings on a reading area (a `.vx-note-scroll`): the global note choices with the
//       note's own override on top, plus that note's board-look override (boards inherit the global
//       board look from <html>). `path` is remembered on the area (data-rpath) so later changes reach
//       it. `editing` keeps the editor neutral (no colour theme, a usable width).
//   openReadingPanel(anchor, changed?, opts?)
//       The settings panel: a popover under `anchor`, a bottom sheet on phones. Toggles when opened
//       again from the same anchor. Every reading area on the page is re-applied after each change,
//       then `changed` runs (optional).
//       opts.board  open on the "Boards" tab (the board page's "View" button uses this)
//       opts.path   the note or board the "This … only" scope applies to; by default the reading area
//                   around `anchor`, else the open one; null for no per-note scope (e.g. a chat).
//       Example (a board's toolbar):  openReadingPanel(btn, undefined, { board: true, path })
//   refreshReading()
//       Re-apply to every reading area on the page, the global board look on <html> and each board's
//       own override on its root (`.kb[data-kbpath]`, see views/board-look.ts).
//
// Board look model and CSS: views/board-look.ts.

import { attr, el, esc, useStyles } from '../dom';
import { t } from '../i18n';
import { isBoard } from '../state';
import { colorPickHTML, wireColorPick } from '../ui/color-pick';
import { useChips } from '../ui/chips';
import { KANBAN_CSS } from '../views/kanban-styles';
import { applyBoardLookRoot, applyBoardLookTo, boardPrefs, ensureBoardLook, PrefStore, type BoardLook } from '../views/board-look';
import { I } from './icons';
import { openPanel } from './panel';
import { READING_CSS } from './reading-styles';

// ── the note model ────────────────────────────────────────────────────────────────────────────

const NOTE_CHOICES = {
  font: ['sans', 'system', 'serif', 'book', 'humanist', 'legible', 'rounded', 'dyslexic', 'mono'],
  tone: ['default', 'paper', 'warm', 'sepia', 'sage', 'mist', 'lavender', 'rose', 'contrast', 'cream', 'white', 'night', 'midnight', 'forest', 'dusk', 'ocean'],
  leading: ['compact', 'normal', 'relaxed', 'loose'],
  para: ['tight', 'normal', 'loose'],
  width: ['narrow', 'normal', 'wide', 'full'],
  head: ['default', 'serif', 'caps', 'rule', 'accent'],
  linkc: ['default', 'accent', 'text'],
  under: ['always', 'hover', 'none'],
  align: ['start', 'justify'],
  hyph: ['off', 'on'],
  code: ['app', 'light', 'dark', 'sepia'],
  img: ['fit', 'wide', 'bleed'],
} as const;
type Choices = typeof NOTE_CHOICES;
type ChoiceKey = keyof Choices;

type ReadPrefs = { [K in ChoiceKey]: Choices[K][number] } & {
  /** Body text size in px, one of SIZES. */
  size: number;
  /** Custom accent colour for links and the like ("#rrggbb"), or "" for the colour theme's own. */
  accent: string;
};

const LS = 'memora.reader.v4';
const LS_NOTES = 'memora.reader.notes.v1';
const LS_V3 = 'memora.reader.v3';
const LS_V2 = 'memora.reader.v2';
const LS_V1 = 'memora.reader.v1';
/** Body text sizes in px. */
const SIZES = [12, 13, 14.5, 16, 17.5, 19, 21, 23, 26];
/** The sizes before 2.1.0, which stored an index into this list. */
const SIZES_V2 = [13, 14.5, 16, 17.5, 19, 21, 24];

const DEFAULTS: ReadPrefs = {
  size: 16,
  font: 'sans',
  tone: 'default',
  accent: '',
  leading: 'normal',
  para: 'normal',
  width: 'normal',
  head: 'default',
  linkc: 'default',
  under: 'always',
  align: 'start',
  hyph: 'off',
  code: 'app',
  img: 'fit',
};

/** The widest line of the text column: about 62, 72 and 86 characters, or the whole page. */
const WIDTHS: Record<ReadPrefs['width'], string> = {
  narrow: 'calc(var(--rsize, 16px) * 34)',
  normal: 'calc(var(--rsize, 16px) * 40)',
  wide: 'calc(var(--rsize, 16px) * 48)',
  full: '100%',
};

/** Colours from older versions, mapped to the nearest one kept. */
const OLD_TONES: Record<string, ReadPrefs['tone']> = { mint: 'sage' };

const nearestSize = (px: number): number => SIZES.reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a), DEFAULTS.size);

function cleanNote(raw: unknown): Partial<ReadPrefs> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out;
  const v = raw as Record<string, unknown>;
  for (const k of Object.keys(NOTE_CHOICES) as ChoiceKey[]) if ((NOTE_CHOICES[k] as readonly unknown[]).includes(v[k])) out[k] = v[k];
  if (typeof v.tone === 'string' && OLD_TONES[v.tone]) out.tone = OLD_TONES[v.tone];
  if (typeof v.size === 'number' && isFinite(v.size)) out.size = nearestSize(v.size);
  if (typeof v.accent === 'string' && /^#[0-9a-f]{6}$/i.test(v.accent)) out.accent = v.accent.toLowerCase();
  return out as Partial<ReadPrefs>;
}

/** Settings saved by earlier versions, in today's terms (their "wide" is today's "normal"). */
function legacyNote(): unknown {
  const parse = (k: string): Record<string, unknown> | null => JSON.parse(localStorage.getItem(k) || 'null') as Record<string, unknown> | null;
  const width = (w: unknown): unknown => (w === 'wide' ? 'normal' : w);
  const v3 = parse(LS_V3);
  if (v3) return { ...v3, width: width(v3.width) };
  // v2 stored an index into SIZES_V2; v1 had 5 sizes with the default at 1.
  const v2 = parse(LS_V2);
  const v = v2 || parse(LS_V1);
  if (!v) return null;
  const idx = typeof v.size === 'number' ? Math.round(v.size) + (v2 ? 0 : 1) : -1;
  return { ...v, size: idx >= 0 && idx < SIZES_V2.length ? SIZES_V2[idx] : undefined, width: width(v.width) };
}

const notePrefs = new PrefStore<ReadPrefs>(LS, LS_NOTES, DEFAULTS, cleanNote, legacyNote);

/** The note settings that apply at `path` (global with its override). */
export function readingPrefs(path?: string | null): Readonly<ReadPrefs> {
  return notePrefs.effective(path);
}

// ── applying ──────────────────────────────────────────────────────────────────────────────────

function ensureStyles(): void {
  useStyles('vx-reading-css', READING_CSS);
  ensureBoardLook();
}
ensureStyles();

/** The note choices as data attributes and custom properties (a default choice sets nothing). */
function paintNote(area: HTMLElement, p: ReadPrefs, editing: boolean): void {
  const d = area.dataset;
  d.rfont = p.font;
  d.rlead = p.leading;
  area.style.setProperty('--rsize', p.size + 'px');
  // The editor's monospace text keeps a usable width at every reading size.
  area.style.setProperty('--rw', editing && p.width !== 'full' ? `max(640px, ${WIDTHS[p.width]})` : WIDTHS[p.width]);
  const opt = (name: string, v: string, def: string): void => {
    if (v === def) delete d[name];
    else d[name] = v;
  };
  opt('rtone', editing ? 'default' : p.tone, 'default');
  opt('rpara', p.para, 'normal');
  opt('rhead', p.head, 'default');
  opt('rlinkc', p.linkc, 'default');
  opt('runder', p.under, 'always');
  opt('ralign', p.align, 'start');
  opt('rhyph', p.hyph, 'off');
  opt('rcode', p.code, 'app');
  opt('rimg', p.img, 'fit');
  if (p.accent && !editing) {
    d.raccent = '';
    area.style.setProperty('--raccent', p.accent);
  } else {
    delete d.raccent;
    area.style.removeProperty('--raccent');
  }
}

/** Put the settings on a reading area (`editing` keeps the editor neutral); see the top of the file. */
export function applyReading(area: HTMLElement, editing: boolean, path?: string | null): void {
  if (path) area.dataset.rpath = path;
  else if (path === null) delete area.dataset.rpath;
  if (editing) area.dataset.redit = '1';
  else delete area.dataset.redit;
  const at = area.dataset.rpath;
  paintNote(area, notePrefs.effective(at), editing);
  applyBoardLookTo(area, boardPrefs.override(at));
}

/** Re-apply the settings to every reading area and every board on the page. */
export function refreshReading(): void {
  applyBoardLookRoot();
  document.querySelectorAll<HTMLElement>('.vx-note-scroll[data-rpath]').forEach((a) => applyReading(a, a.dataset.redit === '1'));
  // A board's own look sits on its root, the closest layer: it wins over the note around it.
  document.querySelectorAll<HTMLElement>('.kb[data-kbpath]').forEach((k) => applyBoardLookTo(k, boardPrefs.override(k.dataset.kbpath)));
}

// ── the panel ─────────────────────────────────────────────────────────────────────────────────

type Tab = 'note' | 'board';
type Scope = 'all' | 'one';
type AnyPrefs = Record<string, unknown>;

interface PanelOpts {
  /** Open on the Boards tab. */
  board?: boolean;
  /** The note or board "This … only" applies to; null for none. */
  path?: string | null;
}

/** Accent colours offered next to the free pick: mid tones used as they are for fills (checkboxes,
 *  quotes); link text mixes them toward the text colour (reading-styles.ts) to keep its contrast. */
const ACCENTS = ['#2f80ed', '#0f9d8f', '#3a9b4f', '#d0811a', '#d64545', '#d0478f', '#7c5cdb', '#6b7280'];

interface Opt {
  v: string;
  label: string;
  pic?: string;
}

const bars = (cls: string, n = 3): string => `<i class="rs-pic ${cls}" aria-hidden="true">${'<b></b>'.repeat(n)}</i>`;

/** Labels, built when the panel opens (the language may have changed). */
function labels() {
  return {
    font: [
      ['sans', t('Sans')],
      ['system', t('System')],
      ['serif', t('Serif')],
      ['book', t('Book')],
      ['humanist', t('Humanist')],
      ['legible', t('Legible')],
      ['rounded', t('Rounded')],
      ['dyslexic', t('Dyslexic')],
      ['mono', t('Mono')],
    ],
    toneGroups: [
      [t('Follow the app theme'), ['default', 'paper', 'warm', 'sepia', 'sage', 'mist', 'lavender', 'rose', 'contrast']],
      [t('Always light'), ['cream', 'white']],
      [t('Always dark'), ['night', 'midnight', 'forest', 'dusk', 'ocean']],
    ] as [string, string[]][],
    tone: {
      default: t('Default'),
      paper: t('Paper'),
      warm: t('Warm'),
      sepia: t('Sepia'),
      sage: t('Sage'),
      mist: t('Mist'),
      lavender: t('Lavender'),
      rose: t('Rose'),
      contrast: t('High contrast'),
      cream: t('Cream'),
      white: t('White'),
      night: t('Night'),
      midnight: t('Midnight'),
      forest: t('Forest'),
      dusk: t('Dusk'),
      ocean: t('Ocean'),
    } as Record<string, string>,
    leading: [
      { v: 'compact', label: t('Compact'), pic: bars('lh-compact') },
      { v: 'normal', label: t('Normal'), pic: bars('lh-normal') },
      { v: 'relaxed', label: t('Relaxed'), pic: bars('lh-relaxed') },
      { v: 'loose', label: t('Loose'), pic: bars('lh-loose') },
    ],
    para: [
      { v: 'tight', label: t('Tight') },
      { v: 'normal', label: t('Normal') },
      { v: 'loose', label: t('Loose') },
    ],
    align: [
      { v: 'start', label: t('Normal'), pic: bars('al al-start', 3) },
      { v: 'justify', label: t('Justified'), pic: bars('al al-justify', 3) },
    ],
    width: [
      { v: 'narrow', label: t('Narrow'), pic: bars('wd wd-narrow', 1) },
      { v: 'normal', label: t('Normal'), pic: bars('wd wd-normal', 1) },
      { v: 'wide', label: t('Wide'), pic: bars('wd wd-wide', 1) },
      { v: 'full', label: t('Full'), pic: bars('wd wd-full', 1) },
    ],
    img: [
      { v: 'fit', label: t('Fit the text') },
      { v: 'wide', label: t('Wide') },
      { v: 'bleed', label: t('Edge to edge') },
    ],
    head: [
      { v: 'default', label: t('Default') },
      { v: 'serif', label: t('Serif') },
      { v: 'caps', label: t('Small caps') },
      { v: 'rule', label: t('Underlined') },
      { v: 'accent', label: t('In colour') },
    ],
    linkc: [
      { v: 'default', label: t('Default') },
      { v: 'accent', label: t('Accent') },
      { v: 'text', label: t('Text colour') },
    ],
    under: [
      { v: 'always', label: t('Always') },
      { v: 'hover', label: t('On hover') },
      { v: 'none', label: t('Never') },
    ],
    code: [
      { v: 'app', label: t('App') },
      { v: 'light', label: t('Light') },
      { v: 'dark', label: t('Dark') },
      { v: 'sepia', label: t('Sepia') },
    ],
    density: [
      { v: 'compact', label: t('Compact') },
      { v: 'cozy', label: t('Cozy') },
      { v: 'roomy', label: t('Roomy') },
    ],
    lane: [
      { v: 's', label: t('Small') },
      { v: 'm', label: t('Medium') },
      { v: 'l', label: t('Large') },
    ],
    card: [
      { v: 'outlined', label: t('Outlined') },
      { v: 'flat', label: t('Flat') },
      { v: 'raised', label: t('Raised') },
    ],
    bg: [
      { v: 'none', label: t('None') },
      { v: 'tint', label: t('Tint') },
      { v: 'dots', label: t('Dots') },
      { v: 'lines', label: t('Lines') },
    ],
    color: [
      { v: 'custom', label: t('Card colour') },
      { v: 'tag', label: t('First tag') },
      { v: 'due', label: t('Due date') },
      { v: 'none', label: t('None') },
    ],
  };
}

interface Section {
  id: string;
  title: string;
  keys: string[];
  html: string;
}

/** Find the note the "This note only" scope is about. */
function pathFor(anchor: HTMLElement): string | null {
  return (
    anchor.closest<HTMLElement>('[data-rpath]')?.dataset.rpath ||
    document.querySelector<HTMLElement>('.vx-note-scroll[data-rpath]')?.dataset.rpath ||
    null
  );
}

/** In a grid of tiles, the item nearest `items[i]` across, in the next row on screen below it (`down`)
 *  or above it; `i` itself when there is none. */
function rowNeighbour(items: HTMLElement[], i: number, down: boolean): number {
  const r = items[i]!.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  let row = Infinity;
  let best = i;
  let bestDx = Infinity;
  items.forEach((it, k) => {
    if (k === i) return;
    const b = it.getBoundingClientRect();
    if (!b.width && !b.height) return;
    // Distance to the row, measured between facing edges; rows a few px apart count as one.
    const gap = down ? b.top - r.bottom : r.top - b.bottom;
    if (gap < -2) return;
    const dx = Math.abs(b.left + b.width / 2 - cx);
    if (gap < row - 4 || (Math.abs(gap - row) <= 4 && dx < bestDx)) {
      if (gap < row - 4) row = gap;
      best = k;
      bestDx = dx;
    }
  });
  return best;
}

/** The reading-settings panel; see the top of the file. */
export function openReadingPanel(anchor: HTMLElement, changed?: () => void, opts: PanelOpts = {}): void {
  ensureStyles();
  const path = opts.path !== undefined ? opts.path : pathFor(anchor);
  const boardPath = !!path && (isBoard(path) || !!opts.board);
  const L = labels();
  const stores: Record<Tab, PrefStore<AnyPrefs>> = {
    note: notePrefs as unknown as PrefStore<AnyPrefs>,
    board: boardPrefs as unknown as PrefStore<AnyPrefs>,
  };
  let tab: Tab = opts.board ? 'board' : 'note';
  const scope: Record<Tab, Scope> = {
    note: path && notePrefs.override(path) ? 'one' : 'all',
    board: path && boardPrefs.override(path) ? 'one' : 'all',
  };
  const store = (): PrefStore<AnyPrefs> => stores[tab];
  const sp = (): string | null => (scope[tab] === 'one' ? path : null);
  const eff = (): AnyPrefs => (sp() ? store().effective(sp()) : store().global);

  // ── markup helpers ──
  const radio = (k: string, o: Opt, cls = ''): string =>
    `<button type="button" role="radio" class="${cls}" data-k="${k}" data-v="${attr(o.v)}" data-fid="${k}:${attr(o.v)}" aria-checked="false" tabindex="-1" title="${attr(o.label)}">${o.pic || ''}<span>${esc(o.label)}</span></button>`;
  const seg = (k: string, label: string, opts2: Opt[], wrap = false): string =>
    `<div class="rs-row"><span class="rs-lab" id="rs-l-${k}">${esc(label)}</span><div class="rs-seg${wrap ? ' wrap' : ''}" role="radiogroup" aria-labelledby="rs-l-${k}">${opts2
      .map((o) => radio(k, o))
      .join('')}</div></div>`;
  const toggle = (k: string, label: string): string =>
    `<button type="button" role="switch" class="rs-switch" data-k="${k}" data-fid="${k}" aria-checked="false"><span>${esc(label)}</span><i aria-hidden="true"></i></button>`;
  const section = (s: Section): string =>
    `<section class="rs-sec" aria-labelledby="rs-h-${s.id}"><div class="rs-sec-h"><h3 id="rs-h-${s.id}">${esc(s.title)}<i data-dot="${s.id}" hidden title="${attr(
      t('Set for this one only'),
    )}"></i></h3><button type="button" class="rs-reset" data-reset="${s.id}" data-fid="reset:${s.id}" aria-label="${attr(
      t('Reset {name}', { name: s.title }),
    )}">${I.undo}<span>${t('Reset')}</span></button></div>${s.html}</section>`;

  const noteSections = (): Section[] => [
    {
      id: 'colour',
      title: t('Colours'),
      keys: ['tone', 'accent'],
      html: `<div class="rs-row"><span class="rs-lab" id="rs-l-tone">${t('Page colour')}</span><div role="radiogroup" aria-labelledby="rs-l-tone" data-cols="3">${L.toneGroups
        .map(
          ([g, ks]) =>
            `<div class="rs-sub" aria-hidden="true">${esc(g)}</div><div class="rs-grid">${ks
              .map(
                (k) =>
                  `<button type="button" role="radio" class="rs-tile" data-k="tone" data-v="${k}" data-fid="tone:${k}" aria-checked="false" tabindex="-1"><span class="vx-note-scroll rs-sw"${
                    k === 'default' ? '' : ` data-rtone="${k}"`
                  } aria-hidden="true"><b>Aa</b><i></i></span><span>${esc(L.tone[k] || k)}</span></button>`,
              )
              .join('')}</div>`,
        )
        .join('')}</div></div>
      <div class="rs-row rs-accent"><span class="rs-lab">${t('Accent colour')}</span><span class="rs-sub">${t('For links, checkboxes and quotes. None uses the page colour’s own.')}</span>${colorPickHTML(
        'rsAccent',
        String(eff().accent || ''),
        { none: true, presets: ACCENTS },
      )}</div>`,
    },
    {
      id: 'text',
      title: t('Text'),
      keys: ['font', 'size', 'leading', 'para', 'align', 'hyph'],
      html: `<div class="rs-row"><span class="rs-lab" id="rs-l-font">${t('Font')}</span><div class="rs-grid" role="radiogroup" aria-labelledby="rs-l-font" data-cols="3">${L.font
        .map(
          ([k, label]) =>
            `<button type="button" role="radio" class="rs-tile" data-k="font" data-v="${k}" data-fid="font:${k}" aria-checked="false" tabindex="-1"><b class="rs-ff-${k}" aria-hidden="true">Ag</b><span>${esc(
              label!,
            )}</span></button>`,
        )
        .join('')}</div></div>
      <div class="rs-row"><label class="rs-lab" for="rs-size">${t('Text size')}</label><div class="rs-size">
        <button type="button" data-step="-1" data-fid="size:-" aria-label="${attr(t('Smaller text'))}"><span style="font-size:12px">A</span></button>
        <input id="rs-size" type="range" min="0" max="${SIZES.length - 1}" step="1" data-k="size" data-fid="size">
        <button type="button" data-step="1" data-fid="size:+" aria-label="${attr(t('Larger text'))}"><span style="font-size:18px">A</span></button>
        <output for="rs-size"></output></div></div>
      ${seg('leading', t('Line spacing'), L.leading)}
      ${seg('para', t('Space between paragraphs'), L.para)}
      ${seg('align', t('Alignment'), L.align)}
      ${toggle('hyph', t('Hyphenate long words'))}`,
    },
    {
      id: 'layout',
      title: t('Layout'),
      keys: ['width', 'img'],
      html: seg('width', t('Text width'), L.width) + seg('img', t('Pictures'), L.img),
    },
    {
      id: 'details',
      title: t('Headings, links and code'),
      keys: ['head', 'linkc', 'under', 'code'],
      html:
        seg('head', t('Headings'), L.head, true) +
        seg('linkc', t('Link colour'), L.linkc) +
        seg('under', t('Underline links'), L.under) +
        seg('code', t('Code blocks'), L.code),
    },
  ];

  const boardSections = (): Section[] => [
    {
      id: 'blayout',
      title: t('Layout'),
      keys: ['density', 'lane', 'card', 'bg'],
      html: seg('density', t('Spacing'), L.density) + seg('lane', t('Lane width'), L.lane) + seg('card', t('Cards'), L.card) + seg('bg', t('Background'), L.bg),
    },
    {
      id: 'bshow',
      title: t('Show'),
      keys: ['done', 'empty', 'dates', 'tags', 'links'],
      html: `<div class="rs-row">${toggle('done', t('Done cards'))}${toggle('empty', t('Empty lanes'))}${toggle('dates', t('Dates on cards'))}${toggle(
        'tags',
        t('Tags on cards'),
      )}${toggle('links', t('Linked notes on cards'))}</div>`,
    },
    {
      id: 'bcolour',
      title: t('Colour'),
      keys: ['color'],
      html: `${seg('color', t('Colour cards by'), L.color)}<span class="rs-sub">${t('Due date: red when late, amber when soon, green later.')}</span>`,
    },
  ];

  const notePreview = (): string => `<div class="rs-prev-wrap"><span class="rs-prev-tag">${t('Preview')}</span>
    <div class="vx-note-scroll rs-prev" aria-hidden="true"><div class="rs-prev-in"><div class="vx-prose">
      <h2>${t('A calm place to think')}</h2>
      <p>${t('Ideas grow when they connect. Link this note to {a} or read {b}.', {
        a: `<a class="wl">${t('another note')}</a>`,
        b: `<a href="#" tabindex="-1">${t('a page on the web')}</a>`,
      })}</p>
      <ul><li>${t('Short lines are easy to follow')}</li><li>${t('Space helps the eye rest')}</li></ul>
      <pre><code>const idea = "small steps";</code></pre>
    </div></div></div></div>`;

  const boardPreview = (): string => `<div class="rs-prev-wrap rs-kb-wrap"><span class="rs-prev-tag">${t('Preview')}</span>
    <div class="kb kb-embed rs-kb" aria-hidden="true"><div class="kb-lanes">
      <section class="kb-lane" style="--lane-c:#60a5fa"><header class="kb-lane-head"><h3 class="kb-lane-title">${t('To do')}</h3><span class="kb-count">3</span></header>
        <div class="kb-cards">
          <article class="kb-card" style="--card-c:#f472b6;--tag-c:#a78bfa" data-due="soon"><span class="kb-check"></span><div class="kb-body"><p>${t('Plan the trip')}</p>
            <p><time class="kb-chip kb-date"><span>${t('Friday')}</span></time> <span class="ch ch-tag sm" style="--tc:#a78bfa"><i></i><b>travel</b></span></p></div></article>
          <article class="kb-card late" style="--tag-c:#34d399" data-due="late"><span class="kb-check"></span><div class="kb-body"><p>${t('Call the bank')}</p>
            <p><span class="ch ch-note sm"><b>${t('Money')}</b></span></p></div></article>
          <article class="kb-card done"><span class="kb-check" aria-pressed="true">${I.check}</span><div class="kb-body"><p>${t('Book the tickets')}</p></div></article>
        </div></section>
      <section class="kb-lane" style="--lane-c:#f59e0b"><header class="kb-lane-head"><h3 class="kb-lane-title">${t('Doing')}</h3><span class="kb-count">0</span></header>
        <div class="kb-cards"><div class="kb-none"><span>${t('No cards')}</span></div></div></section>
    </div></div></div>`;

  const scopeHTML = (): string => {
    if (!path) return '';
    const one = tab === 'board' && boardPath ? t('This board only') : t('This note only');
    const all = tab === 'board' ? t('All boards') : t('All notes');
    return `<div class="rs-scope"><div class="rs-seg" role="radiogroup" aria-label="${attr(t('Apply to'))}">
      <button type="button" role="radio" data-scope="all" data-fid="scope:all" aria-checked="${scope[tab] === 'all'}" tabindex="${scope[tab] === 'all' ? 0 : -1}">${esc(all)}</button>
      <button type="button" role="radio" data-scope="one" data-fid="scope:one" aria-checked="${scope[tab] === 'one'}" tabindex="${scope[tab] === 'one' ? 0 : -1}">${esc(one)}</button>
    </div><div class="rs-own" role="status"><i aria-hidden="true"></i><span></span><button type="button" class="rs-reset" data-clear data-fid="clear">${t('Clear')}</button></div></div>`;
  };

  let sections: Section[] = [];
  const body = el('div', 'rs');

  // The sticky head's height, for the body's scroll-padding: what Tab focuses stays in view below it.
  let topSeen = false;
  const topRO =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          const top = body.querySelector<HTMLElement>('.rs-top');
          if (top?.isConnected) {
            topSeen = true;
            body.style.setProperty('--rs-top-h', top.offsetHeight + 'px');
          } else if (topSeen) topRO!.disconnect(); // the panel closed
        })
      : null;

  const render = (): void => {
    const fid = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.rs [data-fid]')?.dataset.fid || '';
    sections = tab === 'note' ? noteSections() : boardSections();
    useChips();
    if (tab === 'board') useStyles('kanban-css', KANBAN_CSS);
    body.innerHTML = `<div class="rs-top">
      <div class="rs-seg" role="tablist" aria-label="${attr(t('Settings for'))}">
        <button type="button" role="tab" id="rs-tab-note" data-tab="note" data-fid="tab:note" aria-controls="rs-panel" aria-selected="${tab === 'note'}" tabindex="${tab === 'note' ? 0 : -1}">${I.note}<span>${t('Notes')}</span></button>
        <button type="button" role="tab" id="rs-tab-board" data-tab="board" data-fid="tab:board" aria-controls="rs-panel" aria-selected="${tab === 'board'}" tabindex="${tab === 'board' ? 0 : -1}">${I.board}<span>${t('Boards')}</span></button>
      </div>
      ${tab === 'note' ? notePreview() : boardPreview()}
      ${scopeHTML()}
    </div>
    <div class="rs-body" id="rs-panel" role="tabpanel" aria-labelledby="rs-tab-${tab}">${sections.map(section).join('')}</div>
    <div class="rs-foot"><span>${t('Saved in this browser')}</span><button type="button" class="rs-reset" data-reset="all" data-fid="reset:all">${I.undo}<span>${t('Reset all')}</span></button></div>`;
    if (tab === 'note') {
      wireColorPick(body, 'rsAccent', (v) => {
        if (v !== (eff().accent || '')) setVal('accent', v);
      });
      const range = body.querySelector<HTMLInputElement>('#rs-size')!;
      range.oninput = () => setVal('size', SIZES[Number(range.value)] ?? DEFAULTS.size);
    }
    sync();
    topRO?.disconnect();
    const top = body.querySelector<HTMLElement>('.rs-top');
    if (top) topRO?.observe(top);
    const back = fid && body.querySelector<HTMLElement>(`[data-fid="${fid}"]:not(:disabled)`);
    (back || body.querySelector<HTMLElement>('[role=tab][aria-selected=true]'))?.focus({ preventScroll: true });
  };

  /** Show the current values without rebuilding (keeps focus and a dragged slider). */
  const sync = (): void => {
    const v = eff();
    body.querySelectorAll<HTMLElement>('[role=radio][data-k]').forEach((b) => b.setAttribute('aria-checked', String(String(v[b.dataset.k!]) === b.dataset.v)));
    body.querySelectorAll<HTMLElement>('[role=radiogroup]').forEach((g) => {
      const rs = Array.from(g.querySelectorAll<HTMLElement>('[role=radio]'));
      const on = rs.find((r) => r.getAttribute('aria-checked') === 'true') || rs[0];
      rs.forEach((r) => (r.tabIndex = r === on ? 0 : -1));
    });
    body.querySelectorAll<HTMLElement>('[role=switch][data-k]').forEach((b) => b.setAttribute('aria-checked', String(!!v[b.dataset.k!])));
    const range = body.querySelector<HTMLInputElement>('#rs-size');
    if (range) {
      const i = Math.max(0, SIZES.indexOf(Number(v.size)));
      if (document.activeElement !== range) range.value = String(i);
      range.setAttribute('aria-valuetext', `${v.size} px`);
      body.querySelector('.rs-size output')!.textContent = `${v.size}px`;
      body.querySelector<HTMLButtonElement>('[data-step="-1"]')!.disabled = i === 0;
      body.querySelector<HTMLButtonElement>('[data-step="1"]')!.disabled = i === SIZES.length - 1;
    }
    const s = store();
    for (const sec of sections) {
      body.querySelector<HTMLButtonElement>(`[data-reset="${sec.id}"]`)!.disabled = s.isClean(sp(), sec.keys);
      const dot = body.querySelector<HTMLElement>(`[data-dot="${sec.id}"]`);
      if (dot) dot.hidden = !path || s.isClean(path, sec.keys);
    }
    body.querySelector<HTMLButtonElement>('[data-reset="all"]')!.disabled = s.isClean(sp());
    const own = body.querySelector<HTMLElement>('.rs-own');
    if (own && path) {
      const has = !!s.override(path);
      const board = tab === 'board' && boardPath;
      own.hidden = scope[tab] === 'all' && !has;
      own.querySelector('span')!.textContent =
        scope[tab] === 'all'
          ? board
            ? t('This board has its own look, which wins over these settings.')
            : t('This note has its own settings, which win over these.')
          : has
            ? board
              ? t('Only this board uses this look.')
              : t('Only this note uses these settings.')
            : t('Changes made now apply here only.');
      own.querySelector<HTMLElement>('[data-clear]')!.hidden = !has;
    }
    // The preview shows exactly what is being edited (all choices, so the page's own layers do not leak in).
    const prev = body.querySelector<HTMLElement>('.rs-prev');
    if (prev) paintNote(prev, v as unknown as ReadPrefs, false);
    const kb = body.querySelector<HTMLElement>('.rs-kb');
    if (kb) applyBoardLookTo(kb, v as unknown as BoardLook);
  };

  const setVal = (k: string, v: unknown): void => {
    store().set(sp(), k, v);
    refreshReading();
    changed?.();
    sync();
  };

  body.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b || (b as HTMLButtonElement).disabled || !body.contains(b)) return;
    const d = b.dataset;
    if (d.tab) {
      if (tab === d.tab) return;
      tab = d.tab as Tab;
      render();
    } else if (d.scope) {
      scope[tab] = d.scope as Scope;
      render();
    } else if (d.reset) {
      const keys = d.reset === 'all' ? undefined : sections.find((s) => s.id === d.reset)?.keys;
      store().reset(sp(), keys);
      refreshReading();
      changed?.();
      render();
    } else if (d.clear !== undefined && path) {
      store().reset(path);
      scope[tab] = 'all';
      refreshReading();
      changed?.();
      render();
    } else if (d.step) {
      const i = Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(Number(eff().size)) + Number(d.step)));
      setVal('size', SIZES[i]!);
    } else if (b.getAttribute('role') === 'radio' && d.k) {
      const cur = eff()[d.k];
      const v = typeof cur === 'number' ? Number(d.v) : d.v;
      if (String(cur) !== d.v) setVal(d.k, v);
    } else if (b.getAttribute('role') === 'switch' && d.k) setVal(d.k, !eff()[d.k]);
  };

  // Arrow keys move through a group of choices (and choose, like radio buttons), or between the tabs.
  body.onkeydown = (e) => {
    const b = e.target as HTMLElement;
    const role = b.getAttribute('role');
    if (role !== 'radio' && role !== 'tab') return;
    const group = b.closest<HTMLElement>(role === 'tab' ? '[role=tablist]' : '[role=radiogroup]');
    if (!group) return;
    const items = Array.from(group.querySelectorAll<HTMLElement>(`[role=${role}]`));
    const i = items.indexOf(b);
    const rtl = getComputedStyle(group).direction === 'rtl';
    // A grid of tiles (data-cols): up and down go to the nearest tile in the row above or below on
    // screen (its groups have rows of different lengths); elsewhere they step like a radio group.
    const grid = !!group.dataset.cols;
    const step: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: 1,
      ArrowUp: -1,
    };
    let j: number;
    if (grid && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) j = rowNeighbour(items, i, e.key === 'ArrowDown');
    else if (e.key in step) j = Math.max(0, Math.min(items.length - 1, i + step[e.key]!));
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    else return;
    e.preventDefault();
    if (j === i) return;
    items[j]!.focus();
    items[j]!.click();
  };

  render();
  const shown = openPanel(anchor, opts.board ? t('Board view') : t('Reading settings'), body, 'vx-pop-rs');
  if (!shown.isConnected) return; // it was open: the click closed it
  // Keep Tab inside the panel while it is open.
  const card = shown.closest<HTMLElement>('.vx-pop-card');
  card?.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = Array.from(card.querySelectorAll<HTMLElement>('button,input,[tabindex="0"]')).filter(
      (x) => !(x as HTMLButtonElement).disabled && x.tabIndex >= 0 && x.offsetParent !== null,
    );
    if (!f.length) return;
    const first = f[0]!;
    const last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
