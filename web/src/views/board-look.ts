// Board display preferences ("how boards look"): the model, its storage and its CSS.
//
// Layers, the closest wins:
//   - the global choice, put on <html> as inherited CSS custom properties;
//   - a per-note override, put on that note's `.vx-note-scroll` by applyReading() (boards embedded
//     in the note inherit it);
//   - a per-board override, put on the board's own root (`.kb[data-kbpath]`), so an embedded board
//     keeps its own look inside a note that has another one.
// Every choice maps to a few `--kbl-*` custom properties. A property that is not set (or set to
// `initial` on an override, meaning "back to the default here") makes the rules below fall back to
// the board's own look, so the default choices change nothing.
//
// Hooks the board markup provides (views/kanban.ts):
//   .kb-card   --card-c (its custom colour), --tag-c (colour of its first tag),
//              data-due="late|soon|later" (absent without a date)
//   .kb-lane   --lane-c (its custom colour); .kb-keep keeps a just-added empty lane in view
//   .kb-dot    data-empty on the dot of a lane without cards
//   .kb        data-kbpath (the board's note path) and its lane width as
//              `--kb-lane-w: calc(<base>px * var(--kbl-lane-k, 1))` (the S/M/L choice is a factor)
//
// Applying a board's own override (on render, and again from refreshReading() in vault/reading.ts):
//   applyBoardLookTo(kbRoot, boardPrefs.override(kbRoot.dataset.kbpath))
// `boardPrefs.override(path)` is that board's partial look, or null (none: everything inherits).
// KBL_VARS lists every custom property the look sets (e.g. to clear them).

import { useStyles } from '../dom';

export type BoardDensity = 'compact' | 'cozy' | 'roomy';
export type BoardLaneWidth = 's' | 'm' | 'l';
export type BoardCardStyle = 'outlined' | 'flat' | 'raised';
export type BoardBackground = 'none' | 'tint' | 'dots' | 'lines';
export type BoardColorMode = 'custom' | 'tag' | 'due' | 'none';

export interface BoardLook {
  density: BoardDensity;
  lane: BoardLaneWidth;
  card: BoardCardStyle;
  bg: BoardBackground;
  /** Show done cards in the lanes. */
  done: boolean;
  /** Show lanes without cards. */
  empty: boolean;
  dates: boolean;
  tags: boolean;
  /** Linked notes and boards on cards. */
  links: boolean;
  color: BoardColorMode;
}

export const BOARD_DEFAULTS: BoardLook = {
  density: 'cozy',
  lane: 'm',
  card: 'outlined',
  bg: 'none',
  done: true,
  empty: true,
  dates: true,
  tags: true,
  links: true,
  color: 'custom',
};

/** The allowed values of each choice (booleans are checked by type). */
export const BOARD_CHOICES = {
  density: ['compact', 'cozy', 'roomy'],
  lane: ['s', 'm', 'l'],
  card: ['outlined', 'flat', 'raised'],
  bg: ['none', 'tint', 'dots', 'lines'],
  color: ['custom', 'tag', 'due', 'none'],
} as const;

// ── a small store: global prefs plus per-path overrides, in localStorage ──────────────────────

const MAX_OVERRIDES = 400;

/** Global preferences plus per-path overrides (shared by the reading and board settings). */
export class PrefStore<T extends object> {
  global: T;
  private per: Record<string, Partial<T>> = {};

  constructor(
    private readonly key: string,
    private readonly perKey: string,
    readonly defaults: T,
    private readonly clean: (raw: unknown) => Partial<T>,
    /** Read when `key` holds nothing yet (an older format to migrate). */
    legacy?: () => unknown,
  ) {
    this.global = { ...defaults };
    // Two separate reads: a broken global value never costs the per-path overrides (or back).
    try {
      const raw = localStorage.getItem(key);
      Object.assign(this.global, this.clean(raw ? JSON.parse(raw) : legacy ? legacy() : null));
    } catch {
      /* defaults */
    }
    try {
      const per = JSON.parse(localStorage.getItem(perKey) || 'null') as Record<string, unknown> | null;
      if (per && typeof per === 'object' && !Array.isArray(per)) {
        for (const [p, v] of Object.entries(per)) {
          const c = this.clean(v);
          if (Object.keys(c).length) this.per[p] = c;
        }
      }
    } catch {
      /* no overrides */
    }
  }

  /** The override stored for `path` (a partial copy of the choices it sets), or null for none. */
  override(path?: string | null): Partial<T> | null {
    return (path && this.per[path]) || null;
  }

  /** The prefs that apply at `path`: the global ones with its override on top. */
  effective(path?: string | null): T {
    return { ...this.global, ...(this.override(path) || {}) };
  }

  /** Set one choice globally (`path` null) or for one path. */
  set<K extends keyof T>(path: string | null, k: K, v: T[K]): void {
    if (path === null) this.global[k] = v;
    else {
      const o = { ...(this.per[path] || {}), [k]: v } as Partial<T>;
      delete this.per[path]; // re-added last: the most recently used stay when pruning
      this.per[path] = o;
      const keys = Object.keys(this.per);
      for (let i = 0; i < keys.length - MAX_OVERRIDES; i++) delete this.per[keys[i]!];
    }
    this.save();
  }

  /** Back to the defaults (globally) or back to the global choices (for a path); all keys when none given. */
  reset(path: string | null, keys?: (keyof T)[]): void {
    const ks = keys || (Object.keys(this.defaults) as (keyof T)[]);
    if (path === null) for (const k of ks) this.global[k] = this.defaults[k];
    else if (this.per[path]) {
      for (const k of ks) delete this.per[path]![k];
      if (!Object.keys(this.per[path]!).length) delete this.per[path];
    }
    this.save();
  }

  /** Nothing to reset: the defaults (globally) or no override of these keys (for a path). */
  isClean(path: string | null, keys?: (keyof T)[]): boolean {
    const ks = keys || (Object.keys(this.defaults) as (keyof T)[]);
    if (path === null) return ks.every((k) => this.global[k] === this.defaults[k]);
    const o = this.per[path];
    return !o || ks.every((k) => !(k in o));
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.global));
      localStorage.setItem(this.perKey, JSON.stringify(this.per));
    } catch {
      /* storage blocked or full */
    }
  }
}

function cleanBoard(raw: unknown): Partial<BoardLook> {
  const out: Partial<BoardLook> = {};
  if (!raw || typeof raw !== 'object') return out;
  const v = raw as Record<string, unknown>;
  for (const k of Object.keys(BOARD_CHOICES) as (keyof typeof BOARD_CHOICES)[]) {
    if ((BOARD_CHOICES[k] as readonly unknown[]).includes(v[k])) (out as Record<string, unknown>)[k] = v[k];
  }
  for (const k of ['done', 'empty', 'dates', 'tags', 'links'] as const) if (typeof v[k] === 'boolean') out[k] = v[k] as boolean;
  return out;
}

/** Board display preferences: global and per board (by note path). */
export const boardPrefs = new PrefStore<BoardLook>('memora.boardlook.v1', 'memora.boardlook.boards.v1', BOARD_DEFAULTS, cleanBoard);

// ── choices → custom properties ───────────────────────────────────────────────────────────────

type Vars = { [name: string]: string | undefined };

/** The custom properties of each choice; a choice not listed (or the default) sets none of them. */
const VAR_MAP: { [K in keyof BoardLook]: { vars: string[]; on: (v: BoardLook[K]) => Vars } } = {
  density: {
    vars: ['--kbl-k', '--kbl-fk'],
    on: (v) => (v === 'compact' ? { '--kbl-k': '.7', '--kbl-fk': '.95' } : v === 'roomy' ? { '--kbl-k': '1.35', '--kbl-fk': '1.07' } : {}),
  },
  // A factor on the board's own lane width (views/kanban.ts: `calc(<base>px * var(--kbl-lane-k, 1))`).
  lane: { vars: ['--kbl-lane-k'], on: (v) => (v === 's' ? { '--kbl-lane-k': '.83' } : v === 'l' ? { '--kbl-lane-k': '1.23' } : {}) },
  card: {
    vars: ['--kbl-bd', '--kbl-bdh', '--kbl-card-shadow', '--kbl-card-shadow-h'],
    on: (v) =>
      v === 'flat'
        ? { '--kbl-bd': '0', '--kbl-bdh': '.6' }
        : v === 'raised'
          ? {
              '--kbl-bd': '.35',
              '--kbl-bdh': '.5',
              '--kbl-card-shadow': '0 1px 2px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.08)',
              '--kbl-card-shadow-h': '0 2px 4px rgba(0,0,0,.14),0 6px 16px rgba(0,0,0,.1)',
            }
          : {},
  },
  bg: {
    vars: ['--kbl-tint', '--kbl-pad', '--kbl-bgimg', '--kbl-bgsize'],
    on: (v) =>
      v === 'tint'
        ? { '--kbl-tint': '1', '--kbl-pad': '1' }
        : v === 'dots'
          ? { '--kbl-pad': '1', '--kbl-bgimg': 'radial-gradient(circle,rgba(128,128,128,.34) 1px,transparent 1.6px)', '--kbl-bgsize': '16px 16px' }
          : v === 'lines'
            ? {
                '--kbl-pad': '1',
                '--kbl-bgimg': 'linear-gradient(rgba(128,128,128,.13) 1px,transparent 1px),linear-gradient(90deg,rgba(128,128,128,.13) 1px,transparent 1px)',
                '--kbl-bgsize': '24px 24px',
              }
            : {},
  },
  done: { vars: ['--kbl-done-d'], on: (v) => (v ? {} : { '--kbl-done-d': 'none' }) },
  empty: { vars: ['--kbl-empty-d'], on: (v) => (v ? {} : { '--kbl-empty-d': 'none' }) },
  dates: { vars: ['--kbl-date-d'], on: (v) => (v ? {} : { '--kbl-date-d': 'none' }) },
  tags: { vars: ['--kbl-tag-d'], on: (v) => (v ? {} : { '--kbl-tag-d': 'none' }) },
  links: { vars: ['--kbl-link-d'], on: (v) => (v ? {} : { '--kbl-link-d': 'none' }) },
  color: {
    vars: ['--kbl-wc', '--kbl-wt', '--kbl-wd', '--kbl-wl'],
    on: (v) =>
      v === 'tag'
        ? { '--kbl-wc': '0', '--kbl-wt': '1' }
        : v === 'due'
          ? { '--kbl-wc': '0', '--kbl-wd': '1' }
          : v === 'none'
            ? { '--kbl-wc': '0', '--kbl-wl': '0' }
            : {},
  },
};

/** Every custom property the board look sets (all `--kbl-*`). */
export const KBL_VARS: readonly string[] = Object.values(VAR_MAP).flatMap((m) => m.vars);

/**
 * Put `look` on `el` as custom properties. `override` (a per-board layer): the choices present are
 * all written, a default one as `initial` so it masks a non-default global choice; the absent ones
 * are removed and inherit. Not an override (the global layer): only the non-default choices.
 */
export function applyBoardLookTo(el: HTMLElement, look: Partial<BoardLook> | null, override = true): void {
  for (const k of Object.keys(VAR_MAP) as (keyof BoardLook)[]) {
    const m = VAR_MAP[k] as { vars: string[]; on: (v: unknown) => Vars };
    const has = !!look && k in look;
    const set = has ? m.on(look![k]) : {};
    for (const name of m.vars) {
      const val = set[name];
      if (val !== undefined) el.style.setProperty(name, val);
      else if (has && override) el.style.setProperty(name, 'initial');
      else el.style.removeProperty(name);
    }
  }
  if (override) {
    if (look && Object.keys(look).length) el.dataset.kbl = '1';
    else delete el.dataset.kbl;
  }
}

/** Put the global board look on <html> (every board inherits it). */
export function applyBoardLookRoot(): void {
  applyBoardLookTo(document.documentElement, boardPrefs.global, false);
}

let ready = false;
/** Install the board-look CSS and the global choices once (safe to call on every board mount). */
export function ensureBoardLook(): void {
  if (ready) return;
  ready = true;
  useStyles('kb-look-css', BOARD_LOOK_CSS);
  applyBoardLookRoot();
}

// ── CSS ───────────────────────────────────────────────────────────────────────────────────────
// Written against the board's own rules (views/kanban-styles.ts): the same values come back when a
// variable is not set. Rules are a step more specific than the ones they adjust (`.kb .x`).

export const BOARD_LOOK_CSS = `
/* density and lane width */
/* lane width: views/kanban.ts sets --kb-lane-w on the board root from --kbl-lane-k */
.kb.kb{--kb-gap:calc(12px * var(--kbl-k,1))}
.kb.kb.kb-embed{--kb-gap:calc(10px * var(--kbl-k,1))}
.kb.kb.kb-chat{--kb-gap:calc(8px * var(--kbl-k,1))}
.kb .kb-cards{gap:calc(7px * var(--kbl-k,1))}
.kb .kb-card{padding-block:calc(9px * var(--kbl-k,1))}
.kb:is(.kb-chat,.kb-embed) .kb-card{padding-block:calc(7px * var(--kbl-k,1))}
.kb .kb-body{font-size:calc(13.5px * var(--kbl-fk,1))}
.kb.kb-chat .kb-body{font-size:calc(13px * var(--kbl-fk,1))}
.kb .kb-body>*+*{margin-top:calc(6px * var(--kbl-k,1))}
@container kb (max-width:560px){.kb .kb-card{padding-block:calc(10px * var(--kbl-k,1))}}

/* card style: border strength, shadow */
.kb .kb-card:not(.kb-ghost){border-color:color-mix(in srgb,var(--line) calc(var(--kbl-bd,1) * 100%),transparent);box-shadow:var(--kbl-card-shadow,none)}
.kb .kb-card:not(.kb-ghost):hover{border-color:color-mix(in srgb,var(--line-strong) calc(var(--kbl-bdh,1) * 100%),transparent);
  box-shadow:var(--kbl-card-shadow-h,var(--kbl-card-shadow,none))}
.kb .kb-card.kb-armed:not(.kb-ghost){box-shadow:0 6px 20px rgba(0,0,0,.18)}
/* a late card: its 3px start border is the one stripe (amber; red in "Due date" mode), the colour
   stripe gives way to it and only the colour's tint stays */
.kb .kb-card.late:not(.done):not(.kb-ghost){border-inline-start-color:var(--kbl-late)}

/* board background: behind the lanes */
.kb .kb-lanes{border-radius:16px;background-color:color-mix(in srgb,var(--accent) calc(var(--kbl-tint,0) * 6%),transparent);
  background-image:var(--kbl-bgimg,none);background-size:var(--kbl-bgsize,auto);
  padding-block:calc(4px + 8px * var(--kbl-pad,0)) calc(12px + 4px * var(--kbl-pad,0))}
.kb:is(.kb-embed,.kb-chat) .kb-lanes{padding-inline:calc(2px + 8px * var(--kbl-pad,0))}

/* what shows */
.kb .kb-cards>.kb-card.done{display:var(--kbl-done-d,flex)}
.kb .kb-lanes>.kb-lane:not(.kb-keep):has(>.kb-cards>.kb-none){display:var(--kbl-empty-d,flex)}
.kb .kb-dot[data-empty]{display:var(--kbl-empty-d,grid)}
.kb .kb-body :is(.kb-chip.kb-date,.kb-chip.kb-time){display:var(--kbl-date-d,inline-flex)}
.kb .kb-body .ch.ch-tag{display:var(--kbl-tag-d,inline-flex)}
.kb .kb-body :is(.ch.ch-note,.ch.ch-board,.ch.ch-miss){display:var(--kbl-link-d,inline-flex)}

/* colour: one weight per source is 1 (custom colour, first tag, due date), the others 0 */
.kb .kb-card{--kbl-due:transparent;
  --kbl-c:color-mix(in srgb,var(--card-c,transparent) calc(var(--kbl-wc,1) * 100%),
    color-mix(in srgb,var(--tag-c,transparent) calc(var(--kbl-wt,0) * 100%),
    color-mix(in srgb,var(--kbl-due) calc(var(--kbl-wd,0) * 100%),transparent)));
  background-image:linear-gradient(to right,var(--kbl-c) 3px,transparent 3px),
    linear-gradient(color-mix(in srgb,var(--kbl-c) 7%,transparent),color-mix(in srgb,var(--kbl-c) 7%,transparent))}
.kb .kb-card:dir(rtl){background-image:linear-gradient(to left,var(--kbl-c) 3px,transparent 3px),
    linear-gradient(color-mix(in srgb,var(--kbl-c) 7%,transparent),color-mix(in srgb,var(--kbl-c) 7%,transparent))}
.kb .kb-card[data-due=late]{--kbl-due:var(--danger)}
.kb .kb-card{--kbl-late:color-mix(in srgb,var(--danger) calc(var(--kbl-wd,0) * 100%),var(--warn))}
.kb .kb-card.late:not(.done):not(.kb-ghost){background-image:linear-gradient(color-mix(in srgb,var(--kbl-c) 7%,transparent),color-mix(in srgb,var(--kbl-c) 7%,transparent))}
.kb .kb-card .kb-chip.late{background:color-mix(in srgb,var(--kbl-late) 16%,transparent);color:var(--kbl-late)}
.kb .kb-card[data-due=soon]{--kbl-due:var(--warn)}
.kb .kb-card[data-due=later]{--kbl-due:var(--ok)}
.kb .kb-lane{--kbl-lc:color-mix(in srgb,var(--lane-c,transparent) calc(var(--kbl-wl,1) * 100%),transparent)}
.kb .kb-lane-head{background:linear-gradient(color-mix(in srgb,var(--kbl-lc) 12%,transparent),color-mix(in srgb,var(--kbl-lc) 12%,transparent)) var(--surface-2);
  box-shadow:inset 0 3px 0 var(--kbl-lc)}
`;
