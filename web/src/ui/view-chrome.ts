// Shared chrome for the three map views (Brain, Graph, Canvas): the same
// controls in the same places, so switching views never moves anything.
//
//   top left      search, then the view switcher as a column of icons (the
//                 name slides out on hover)
//   top right     Filter and Reset, one above the other
//   left edge     a "Regions" tab; it opens a drawer to show / hide folders
//   right edge    an "Activity" tab that glows while agents work; it opens a
//                 drawer listing them
//   bottom left   minimap
//   bottom right  orbit globe over a column of zoom / fit / full screen
//
// On phones the map stays clean: search is an icon, and the globe, minimap
// and label switches live in a bottom sheet opened from the controls column.
// Only one panel is open at a time (Filter, a drawer, the sheet, the phone
// search): opening one closes the others, and the view closes its own card.
//
// Each view owns its drawing and passes callbacks; this module owns markup,
// styles and the shared preferences.

import { MapFind, type FindSource } from './map-find';
import { ago } from '../control/ui';
import { avatarHTML } from '../control/agents';
import { attr, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { activeAgents, agentList, onAgents, type AgentInfo } from '../realtime';
import { icon } from './icons';

export type ViewPage = 'brain' | 'graph' | 'canvas';

export interface ChromeRegion {
  name: string;
  color: string;
  count: number;
  hidden: boolean;
}

export interface ChromeOptions {
  page: ViewPage;
  /** Positioned element the chrome is laid over. */
  root: HTMLElement;
  search: {
    placeholder: string;
    /** The shared finder (Brain, Graph, Canvas): results under the field. */
    find?: FindSource;
    onInput?: (q: string) => void;
    /** Enter, arrows and Escape; return true when handled. */
    onKey?: (e: KeyboardEvent, q: string) => boolean;
    onFocus?: () => void;
  };
  /** Node and folder labels, the same two switches in every view. */
  labels: {
    get: () => { nodes: boolean; folders: boolean };
    set: (kind: 'nodes' | 'folders', on: boolean) => void;
    /** What the two switches mean in this view (hover help). */
    help: { nodes: string; folders: string };
  };
  /** Fills the Filter panel below the shared sections. */
  filter: (host: HTMLElement) => void;
  /** Back to defaults: the view's own settings, every region shown, camera home. */
  reset: () => void;
  /**
   * True while the view differs from its defaults (a setting, a hidden region,
   * a search, an open card, the camera off its home framing). The Reset
   * button lights up then, so it is clear there is something to undo.
   */
  changed?: () => boolean;
  regions: {
    list: () => ChromeRegion[];
    toggle: (name: string) => void;
    setAll: (hidden: boolean) => void;
    /** Fly to a region (optional). */
    focus?: (name: string) => void;
  };
  nav: {
    zoom: (factor: number) => void;
    fit: () => void;
    /** One step of the globe arrows: turn (3D) or pan (2D). */
    nudge: (dx: number, dy: number) => void;
    /** The globe's middle button: back to the default view. */
    home: () => void;
  };
  /** Draw the minimap into the given canvas (sized in CSS px). */
  minimap: (cv: HTMLCanvasElement, w: number, h: number, dpr: number) => void;
  /** Click or drag on the minimap, as fractions of its size. */
  minimapNav?: (fx: number, fy: number) => void;
  /** Prefs changed (minimap or globe shown/hidden). */
  onPrefs?: (p: ChromePrefs) => void;
  /** A chrome panel opened: the view closes its own card or preview. */
  onOverlay?: () => void;
}

export interface ChromePrefs {
  minimap: boolean;
  /** The orbit globe. */
  controls: boolean;
}

type Device = 'phone' | 'tablet' | 'desktop';

function device(): Device {
  const w = window.innerWidth;
  return w <= 760 ? 'phone' : w <= 1100 ? 'tablet' : 'desktop';
}

const prefsKey = (): string => 'memora.viewChrome.v3.' + device();
/** Tablets and phones: search is a button in the column until tapped. */
const compactSearch = (): boolean => device() !== 'desktop';

/** Desktop shows everything; tablets keep the globe; phones use the sheet. */
function defaultChromePrefs(): ChromePrefs {
  const d = device();
  return { minimap: d === 'desktop', controls: d !== 'phone' };
}

function chromePrefs(): ChromePrefs {
  const d = defaultChromePrefs();
  try {
    const p = JSON.parse(localStorage.getItem(prefsKey()) || '{}') as Partial<ChromePrefs>;
    return { minimap: p.minimap ?? d.minimap, controls: p.controls ?? d.controls };
  } catch {
    return d;
  }
}

function savePrefs(p: ChromePrefs): void {
  try {
    localStorage.setItem(prefsKey(), JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

// The page is "Brain" (sidebar, tab bar); inside it the three ways to see it.
// The 3D mode gets a cube so the brain icon is never shown twice.
const CUBE =
  '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>';
const PAGES: [ViewPage, string, string][] = [
  ['brain', '3D', CUBE],
  ['graph', 'Graph', icon('graph')],
  ['canvas', 'Canvas', icon('canvas')],
];

/** A switch waiting for its animation; a newer click replaces it. */
let pendingSwitch = 0;

type Overlay = 'filter' | 'regions' | 'activity' | 'sheet' | 'search';

const I = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  // Fit: everything drawn into the middle. Full screen: arrows out to the corners.
  fit: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" rx="1.6"/><path d="M3.5 3.5 6.5 6.5M20.5 3.5l-3 3M3.5 20.5l3-3M20.5 20.5l-3-3"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/></svg>',
  exitFull: '<svg viewBox="0 0 24 24"><path d="M4 14h6v6M20 10h-6V4M14 10l6.5-6.5M10 14l-6.5 6.5"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5M6.5 10v9h11v-9"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  layers: '<svg class="tic" viewBox="0 0 24 24"><path d="m12 4 8 4.5-8 4.5-8-4.5z"/><path d="m4 12.5 8 4.5 8-4.5"/><path d="m4 16.5 8 4.5 8-4.5"/></svg>',
  pulse: '<svg class="tic" viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
  // A game pad: the phone's controller sheet (globe, minimap, labels).
  pad: '<svg viewBox="0 0 24 24"><path d="M7 9h10a4 4 0 0 1 3.9 4.9l-.6 2.6a2.3 2.3 0 0 1-4 1L14.6 16H9.4l-1.7 1.5a2.3 2.3 0 0 1-4-1l-.6-2.6A4 4 0 0 1 7 9z"/><path d="M8 11.5v3M6.5 13h3"/><circle cx="15.5" cy="12" r=".6"/><circle cx="17" cy="13.8" r=".6"/></svg>',
};

const CSS = `
.vc{--vc-glass:var(--panel,#12161f);--vc-line:color-mix(in srgb,var(--line,#232a38) 85%,transparent);
  /* the floating controls: a step lighter than the map, a clear edge and shadow */
  --vc-ctl:var(--surface-2,#131823);--vc-ctl-line:rgba(148,163,184,.30);--vc-ctl-icon:var(--text-2,#a3afc2)}
:root[data-theme=light] .vc{--vc-ctl:#ffffff;--vc-ctl-line:rgba(15,23,42,.20);--vc-ctl-icon:var(--text-2,#3b475c)}
.vc-p{position:absolute;z-index:6;background:var(--vc-glass);border:1px solid var(--vc-line);border-radius:12px;color:var(--fg,#e6e9ef);
  box-shadow:0 10px 40px rgba(0,0,0,.28)}
:root[data-theme=light] .vc-p{box-shadow:0 8px 30px rgba(16,24,40,.10)}
.vc-tl>.vc-p,.vc-tr,.vc-dock>.vc-p,.vc>.vc-mini{background:var(--vc-ctl);border-color:var(--vc-ctl-line);
  box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 6px 18px -6px rgba(0,0,0,.6),0 0 0 1px rgba(0,0,0,.25)}
:root[data-theme=light] :is(.vc-tl>.vc-p,.vc-tr,.vc-dock>.vc-p,.vc>.vc-mini){box-shadow:0 6px 16px -6px rgba(15,23,42,.22),0 1px 2px rgba(15,23,42,.08)}
.vc-col{display:flex;flex-direction:column;gap:2px;padding:4px}
.vc-hide{display:none !important}

/* top left: search, then the switcher column */
.vc-tl{position:absolute;z-index:7;left:14px;top:12px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;pointer-events:none}
.vc-tl>*{pointer-events:auto;position:relative}
.vc-search{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;width:280px;transition:border-color .2s}
.vc-search:focus-within{border-color:color-mix(in srgb,var(--accent,#5eead4) 45%,var(--vc-line))}
.vc-search svg{width:15px;height:15px;flex:none;color:var(--vc-ctl-icon);fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round}
.vc-search input{all:unset;flex:1;min-width:0;font-size:13px;color:var(--fg,#e6e9ef)}
.vc-search input::placeholder{color:var(--muted,#8b98ad)}
.vc-search input::-webkit-search-cancel-button{display:none}
.vc-search kbd{font:600 10.5px/1 var(--mono,monospace);padding:3px 6px;border-radius:5px;border:1px solid var(--vc-line);color:var(--muted,#8b98ad)}
.vc-search em{font-style:normal;font-size:11.5px;color:var(--muted,#8b98ad);white-space:nowrap}
.vc-search em:empty{display:none}
.vc-search:focus-within kbd{display:none}
.vc-search .vc-sbtn{all:unset;display:none}

.vc-modes button{all:unset;box-sizing:border-box;position:relative;cursor:pointer;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;
  color:var(--vc-ctl-icon);transition:background .25s,color .25s}
.vc-modes button .i{width:16px;height:16px}
.vc-modes button:hover{color:var(--fg,#e6e9ef);background:color-mix(in srgb,var(--fg,#e6e9ef) 7%,transparent)}
.vc-modes button.on{color:var(--accent,#5eead4);background:color-mix(in srgb,var(--accent,#5eead4) 14%,transparent)}
.vc-modes button:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:2px}
/* the name slides out to the right on hover */
.vc-modes button span{position:absolute;left:calc(100% + 10px);top:50%;translate:-6px -50%;padding:5px 10px;border-radius:8px;white-space:nowrap;pointer-events:none;
  font-size:12px;font-weight:600;color:var(--fg,#e6e9ef);background:var(--glass-strong,#151a24);border:1px solid var(--vc-line);box-shadow:0 6px 20px rgba(0,0,0,.25);
  opacity:0;transition:opacity .18s,translate .25s cubic-bezier(.2,.8,.2,1)}
.vc-modes button:hover span,.vc-modes button:focus-visible span{opacity:1;translate:0 -50%}

/* right: Reset over Filter, level with the switcher column (the top row is the search's) */
.vc{--vc-row2:60px}
.vc-tr{right:14px;top:var(--vc-row2)}
.vc-b{all:unset;box-sizing:border-box;cursor:pointer;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;position:relative;
  color:var(--vc-ctl-icon);transition:background .2s,color .2s}
.vc-b:hover{color:var(--fg,#e6e9ef);background:color-mix(in srgb,var(--fg,#e6e9ef) 7%,transparent)}
.vc-b.on,.vc-b[aria-pressed=true]{color:var(--accent,#5eead4);background:color-mix(in srgb,var(--accent,#5eead4) 14%,transparent)}
.vc-b:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:2px}
.vc-b svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.vc-badge{position:absolute;top:1px;right:1px;min-width:14px;height:14px;padding:0 3px;border-radius:99px;font-size:9px;line-height:14px;text-align:center;
  background:var(--primary,#08c6d4);color:var(--on-primary,#03252a)}
.vc-badge:empty{display:none}
.vc-reset.spin svg{animation:vc-spin .5s cubic-bezier(.2,.8,.2,1)}
/* Something differs from the defaults: the Reset button lights up. */
.vc-reset.dirty{color:var(--accent,#5eead4);background:color-mix(in srgb,var(--accent,#5eead4) 16%,var(--vc-ctl));
  box-shadow:0 0 0 1px color-mix(in srgb,var(--accent,#5eead4) 55%,transparent),0 0 14px -2px color-mix(in srgb,var(--accent,#5eead4) 60%,transparent)}
.vc-reset::after{content:"";position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:var(--accent,#5eead4);
  box-shadow:0 0 0 2px var(--vc-ctl);transform:scale(0);transition:transform .2s cubic-bezier(.2,.8,.2,1)}
.vc-reset{position:relative}
.vc-reset.dirty::after{transform:scale(1)}
@media (prefers-reduced-motion:reduce){.vc-reset::after{transition:none}}
@keyframes vc-spin{from{transform:rotate(0)}to{transform:rotate(-360deg)}}

/* Filter panel, left of the tool column */
.vc-panel{right:62px;top:var(--vc-row2);width:280px;max-height:calc(100% - var(--vc-row2) - 24px);overflow:auto;padding:6px 12px 12px;scrollbar-width:thin;
  transform-origin:top right;animation:vc-in .2s cubic-bezier(.2,.8,.2,1)}
.vc-panel[hidden]{display:none}
@keyframes vc-in{from{opacity:0;transform:translateY(-6px) scale(.98)}}
.vc-panel h4,.vc-drawer h4,.vc-sheet h4{display:flex;align-items:center;gap:7px;margin:12px 0 6px;font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted,#8b98ad)}
.vc-tg{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 2px;font-size:12.5px;color:var(--fg,#e6e9ef)}
.vc-tg i{position:relative;width:30px;height:17px;border-radius:99px;background:color-mix(in srgb,var(--fg,#e6e9ef) 14%,transparent);transition:background .2s;flex:none}
.vc-tg i::after{content:"";position:absolute;left:2px;top:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:transform .2s}
.vc-tg.on i{background:var(--primary,#08c6d4)}
.vc-tg.on i::after{transform:translateX(13px)}
.vc-tg>span,.vc-sl>span{display:inline-flex;align-items:center;gap:7px}
.vc-tg:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:2px;border-radius:6px}
.vc-q{position:relative;flex:none;width:15px;height:15px;border-radius:50%;display:inline-grid;place-items:center;cursor:help;
  font:700 9.5px/1 system-ui,sans-serif;color:var(--muted,#8b98ad);border:1px solid color-mix(in srgb,var(--muted,#8b98ad) 55%,transparent);letter-spacing:0}
.vc-q:hover{color:var(--fg,#e6e9ef);border-color:var(--fg,#e6e9ef)}
.vc-tip{position:fixed;z-index:30;max-width:240px;padding:7px 10px;border-radius:9px;font-size:11.5px;line-height:1.45;font-weight:500;
  color:var(--fg,#e6e9ef);background:var(--glass-strong,#151a24);border:1px solid var(--line-strong,rgba(148,163,184,.2));box-shadow:0 10px 30px rgba(0,0,0,.3);pointer-events:none}
.vc-seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--fg,#e6e9ef) 6%,transparent)}
.vc-seg button{all:unset;box-sizing:border-box;cursor:pointer;flex:1;height:28px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;gap:5px;
  font-size:12px;font-weight:600;color:var(--muted,#8b98ad)}
.vc-seg button svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.vc-seg button.on{background:var(--vc-glass);color:var(--fg,#e6e9ef);box-shadow:0 1px 3px rgba(0,0,0,.25)}
.vc-sl{display:grid;grid-template-columns:96px 1fr;align-items:center;gap:10px;padding:5px 2px;font-size:12.5px}
.vc-sl input{width:100%;accent-color:var(--primary,#08c6d4)}
.vc-act{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:32px;margin-top:6px;border-radius:9px;
  font-size:12.5px;font-weight:600;border:1px solid var(--vc-line);color:var(--fg,#e6e9ef)}
.vc-act:hover{border-color:color-mix(in srgb,var(--accent,#5eead4) 45%,var(--vc-line))}
.vc-hint{margin-top:10px;font-size:11.5px;line-height:1.5;color:var(--muted,#8b98ad)}

/* Edge tabs: stuck to the map's side, the name running down */
.vc-tab{all:unset;box-sizing:border-box;cursor:pointer;position:absolute;z-index:6;top:50%;translate:0 -50%;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 6px;
  font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted,#8b98ad);
  background:var(--vc-glass);border:1px solid var(--vc-line);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  transition:color .2s,padding .25s,background .2s,opacity .2s}
/* Each tab has its own colour: Regions in the brand cyan, Activity in the
   green of the header's Live pill (deeper shades on the light theme). */
.vc-tab span{writing-mode:vertical-rl}
.vc-tab .tic{display:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.vc-tab em:empty{display:none}
.vc-tab-l{--tc:#22d3ee}
.vc-tab-r{--tc:var(--ok,#4ade80)}
:root[data-theme=light] .vc-tab-l{--tc:#0e7490}
:root[data-theme=light] .vc-tab-r{--tc:var(--ok,#15803d)}
.vc-tab{color:color-mix(in srgb,var(--tc) 80%,var(--fg,#e6e9ef));background:color-mix(in srgb,var(--tc) 10%,var(--vc-glass));
  border-color:color-mix(in srgb,var(--tc) 38%,var(--vc-line))}
.vc-tab:hover,.vc-tab.on{color:var(--tc);background:color-mix(in srgb,var(--tc) 18%,var(--vc-glass));border-color:color-mix(in srgb,var(--tc) 60%,transparent)}
.vc-tab:focus-visible{outline:2px solid var(--tc)}
.vc-tab em{font-style:normal;letter-spacing:0;font-size:10px;min-width:18px;padding:1px 5px;border-radius:99px;text-align:center;
  background:color-mix(in srgb,var(--tc) 22%,transparent);color:inherit}
.vc-tab-l{left:0;border-left:0;border-radius:0 10px 10px 0}
.vc-tab-r{right:0;border-right:0;border-radius:10px 0 0 10px}
.vc-tab-l:hover{padding-left:9px}
.vc-tab-r:hover{padding-right:9px}
.vc-tab .dot{width:7px;height:7px;border-radius:50%;background:var(--tc);opacity:.5}
/* Agents at work: the tab glows and a light runs round its border (as on the sign-in card). */
.vc-tab.live{color:var(--tc);border-color:color-mix(in srgb,var(--tc) 55%,transparent);animation:vc-bling 2.2s ease-in-out infinite}
.vc-tab.live .dot{opacity:1;box-shadow:0 0 10px var(--tc);animation:vc-dot 1.2s ease-in-out infinite}
.vc-tab.live em{background:var(--tc);color:#fff}
@property --vc-a{syntax:'<angle>';inherits:false;initial-value:0deg}
.vc-tab.live::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.6px;pointer-events:none;
  background:conic-gradient(from var(--vc-a),transparent 0deg,transparent 250deg,var(--tc) 300deg,#fff 330deg,var(--tc) 345deg,transparent 360deg);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;
  animation:vc-run 2.4s linear infinite}
@keyframes vc-run{to{--vc-a:360deg}}
@keyframes vc-dot{50%{transform:scale(1.35)}}
@keyframes vc-bling{0%,100%{box-shadow:0 0 0 0 transparent}50%{box-shadow:0 0 24px 2px color-mix(in srgb,var(--tc) 45%,transparent)}}

/* Drawers */
.vc-drawer{position:absolute;z-index:8;top:0;bottom:0;width:min(280px,82vw);display:flex;flex-direction:column;background:var(--glass-strong,#151a24);
  border:1px solid var(--vc-line);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 20px 60px rgba(0,0,0,.35);
  transition:transform .3s cubic-bezier(.2,.8,.2,1),visibility .3s}
.vc-drawer-l{left:0;border-left:0;transform:translateX(-102%)}
.vc-drawer-r{right:0;border-right:0;transform:translateX(102%)}
.vc-drawer:not(.open){visibility:hidden}
.vc-drawer.open{transform:none}
.vc-dh{display:flex;align-items:center;gap:8px;padding:12px 10px 6px 14px}
.vc-dh h4{margin:0;flex:1}
.vc-dh em{font-style:normal;letter-spacing:0;font-weight:600;padding:1px 7px;border-radius:99px;background:color-mix(in srgb,var(--fg,#e6e9ef) 8%,transparent)}
.vc-db{flex:1;min-height:0;overflow:auto;padding:0 8px 12px;scrollbar-width:thin}
.vc-bulk{display:flex;gap:4px;padding:0 6px 8px}
.vc-bulk button{all:unset;cursor:pointer;font-size:11px;color:var(--muted,#8b98ad);padding:3px 8px;border-radius:7px;border:1px solid var(--vc-line)}
.vc-bulk button:hover{color:var(--fg,#e6e9ef)}
/* A region row: the dot shows / hides the folder, the name flies to it. */
.vc-rr{display:flex;align-items:center;gap:2px;border-radius:9px}
.vc-rr:hover{background:color-mix(in srgb,var(--fg,#e6e9ef) 6%,transparent)}
.vc-rr button{all:unset;box-sizing:border-box;cursor:pointer}
.vc-rr button:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:-2px;border-radius:8px}
.vc-rr .tg{flex:none;width:38px;height:38px;display:grid;place-items:center;border-radius:8px}
.vc-rr .tg:hover{background:color-mix(in srgb,var(--c) 14%,transparent)}
.vc-rr .tg i{width:12px;height:12px;border-radius:50%;background:var(--c);box-shadow:0 0 9px var(--c);border:2px solid var(--c);box-sizing:border-box;transition:background .2s,box-shadow .2s}
.vc-rr.off .tg i{background:transparent;box-shadow:none}
.vc-rr .t{flex:1;min-width:0;display:flex;align-items:center;gap:8px;min-height:38px;padding:0 10px 0 2px;font-size:13px;color:var(--fg,#e6e9ef)}
.vc-rr .t span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vc-rr .t em{font-style:normal;font-size:11px;color:var(--muted,#8b98ad);min-width:22px;text-align:right}
.vc-rr .t svg{width:13px;height:13px;flex:none;fill:none;stroke:currentColor;stroke-width:1.9;color:var(--muted,#8b98ad);opacity:0;transition:opacity .15s}
.vc-rr .t:hover svg,.vc-rr .t:focus-visible svg{opacity:1}
@media (hover:none){.vc-rr .t svg{opacity:.6}}
.vc-rr.off .t span{opacity:.45}
.vc-empty{padding:6px 8px 12px;font-size:12px;line-height:1.5;color:var(--muted,#8b98ad)}
.vc-ag{display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px}
.vc-ag+.vc-ag{margin-top:2px}
.vc-ag.on{background:color-mix(in srgb,var(--ag) 9%,transparent)}
.vc-ag .m{flex:1;min-width:0}
.vc-ag b{display:block;font-size:12.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vc-ag small{display:block;font-size:11.5px;color:var(--muted,#8b98ad);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vc-ag time{font-size:11px;color:var(--muted,#8b98ad);white-space:nowrap}
.vc-ag.on time{color:var(--accent,#5eead4);font-weight:600}

/* bottom left: minimap; bottom right: globe over the zoom column */
.vc-mini{left:14px;bottom:14px;display:block;width:184px;height:120px;padding:0;overflow:hidden;cursor:crosshair}
.vc-mini canvas{display:block;width:100%;height:100%}
.vc-dock{position:absolute;z-index:6;right:14px;bottom:14px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none}
.vc-dock>*{pointer-events:auto;position:relative}
.vc-zoom .vc-b{width:32px;height:32px}
/* Desktop and tablets: the zoom buttons in a row with the globe centred
   above; phones stack them in a column at the edge. */
@media (min-width:761px){
  .vc-dock{align-items:center}
  .vc-zoom{flex-direction:row}
}
.vc-globe{position:relative;width:120px;height:120px;border-radius:50%}
.vc-globe canvas{position:absolute;left:28px;top:28px;width:64px;height:64px;pointer-events:none}
.vc-globe button{all:unset;box-sizing:border-box;cursor:pointer;position:absolute;width:26px;height:26px;display:grid;place-items:center;border-radius:50%;color:var(--vc-ctl-icon);
  transition:background .15s,color .15s}
.vc-globe button:hover{color:var(--fg,#e6e9ef);background:color-mix(in srgb,var(--fg,#e6e9ef) 9%,transparent)}
.vc-globe button:active{background:color-mix(in srgb,var(--accent,#5eead4) 18%,transparent);color:var(--accent,#5eead4)}
.vc-globe button:focus-visible{outline:2px solid var(--accent,#5eead4)}
.vc-globe button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
.vc-globe [data-g=u]{left:47px;top:3px}
.vc-globe [data-g=d]{left:47px;bottom:3px;rotate:180deg}
.vc-globe [data-g=l]{left:3px;top:47px;rotate:-90deg}
.vc-globe [data-g=r]{right:3px;top:47px;rotate:90deg}
.vc-globe [data-g=h]{left:41px;top:41px;width:38px;height:38px;color:transparent}
.vc-globe [data-g=h]:hover{color:var(--fg,#e6e9ef);background:color-mix(in srgb,var(--bg,#0b0e14) 55%,transparent)}
.vc-padbtn{display:none !important}

/* Phone controller: a bottom sheet with the globe, minimap and labels */
.vc-scrim{position:absolute;inset:0;z-index:40;background:rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:opacity .25s}
.vc-scrim.on{opacity:1;pointer-events:auto}
.vc-sheet{position:absolute;z-index:41;left:0;right:0;bottom:0;padding:8px 16px calc(16px + env(safe-area-inset-bottom));border-radius:18px 18px 0 0;
  background:var(--glass-strong,#151a24);border:1px solid var(--vc-line);border-bottom:0;box-shadow:0 -20px 60px rgba(0,0,0,.35);
  transform:translateY(105%);transition:transform .3s cubic-bezier(.2,.8,.2,1),visibility .3s}
.vc-sheet:not(.open){visibility:hidden}
.vc-sheet-open .vc-dock,.vc-sheet-open .vc-tab{opacity:0;pointer-events:none}
/* Regions open: the drawer has the left side to itself. */
.vc-tl{transition:opacity .2s,translate .25s}
.vc[data-open=regions] .vc-tl{opacity:0;translate:-12px 0;pointer-events:none}
.vc-dock{transition:opacity .2s}
.vc-sheet.open{transform:none}
.vc-grab{width:38px;height:4px;border-radius:99px;margin:2px auto 8px;background:color-mix(in srgb,var(--fg,#e6e9ef) 25%,transparent)}
.vc-sh{display:flex;align-items:center;justify-content:space-between}
.vc-sh h4{margin:4px 0}
.vc-sgrid{display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:center;margin:6px 0 4px}
.vc-sheet .vc-globe,.vc-sheet .vc-mini{position:relative;left:auto;right:auto;bottom:auto;top:auto;box-shadow:none}
.vc-sheet .vc-mini{width:100%;height:120px}

@media (max-width:1100px){
  .vc{--vc-row2:64px}
  /* search: a button as wide as the switcher column until tapped */
  .vc-search{width:44px;height:44px;padding:0;justify-content:center;cursor:pointer;transition:width .25s cubic-bezier(.2,.8,.2,1),border-color .2s}
  .vc-search input,.vc-search em,.vc-search kbd{display:none}
  .vc-search svg{width:16px;height:16px}
  .vc-search.open{padding:0 12px;justify-content:flex-start;cursor:auto}
  .vc-search.open input,.vc-search.open em{display:block}
}
@media (max-width:760px){
  .vc-tl{left:10px;top:10px;gap:6px}
  .vc{--vc-row2:58px}
  .vc-tr{right:10px}
  /* search: an icon until tapped, then a field across the top */
  .vc-search{width:42px;height:42px}
  .vc-modes button,.vc-b{width:32px;height:32px}
  .vc-panel{left:58px;right:56px;width:auto}
  /* the tab bar's raised Brain circle pokes up over the bottom of the map */
  .vc-db{padding-bottom:52px}
  .vc-tab{padding:10px 5px}
  .vc-dock{right:10px;bottom:10px}
  .vc-dock>.vc-globe,.vc>.vc-mini{display:none !important}
  .vc-padbtn{display:grid !important}
}
/* Short screens (landscape phones, small windows): slimmer controls and no
   globe, so the columns, tabs and dock never run into each other. */
@media (max-height:620px){
  .vc-modes button,.vc-b{width:30px;height:30px}
  .vc-zoom .vc-b{width:30px;height:30px}
  .vc-dock>.vc-globe{display:none !important}
  /* edge tabs shrink to an icon and the count */
  .vc-tab{padding:9px 5px;gap:6px}
  .vc-tab span{display:none}
  .vc-tab .tic{display:block}
  .vc-tab-l{top:max(50%, 214px)}
  .vc>.vc-mini{display:none !important}
  .vc{--vc-row2:54px}
  .vc-search{height:38px}
}
@media (max-height:620px) and (max-width:1100px){
  .vc-search{width:40px;height:40px}
}
@media (prefers-reduced-motion:reduce){.vc-drawer,.vc-sheet,.vc-modes button span{transition:none}.vc-tab.live,.vc-tab.live::before,.vc-tab.live .dot{animation:none}}
`;

export class ViewChrome {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  readonly panel: HTMLElement;
  readonly miniCanvas: HTMLCanvasElement;
  /** The results dropdown, when the view passed a `find` source. */
  readonly finder: MapFind | null = null;
  prefs = chromePrefs();
  private o: ChromeOptions;
  private q = <T extends HTMLElement = HTMLElement>(s: string): T => this.el.querySelector(s) as T;
  private globe: HTMLCanvasElement;
  private orient = { yaw: 0.6, pitch: 0.35 };
  private repeat = 0;
  private open: Overlay | null = null;
  private unsubAgents: (() => void) | null = null;
  private agentTimer = 0;
  private dirtyTimer = 0;
  private phone = device() === 'phone';
  /** Listeners on the map root, removed on destroy. */
  private off = new AbortController();
  private onFs = (): void => this.paintFs();
  private onResize = (): void => {
    if (!compactSearch() && this.open === 'search') this.close();
    this.sizeSearch();
    const p = device() === 'phone';
    if (p !== this.phone) {
      this.phone = p;
      this.prefs = chromePrefs();
      this.place();
    }
  };
  private themeObs = new MutationObserver(() => {
    this.drawGlobe();
    this.redrawMini();
  });
  private onDocDown = (e: PointerEvent): void => {
    // A tap outside the open panel or drawer closes it (the sheet has its scrim).
    const w = this.open;
    if (!w || w === 'sheet') return;
    const t = e.target as Node;
    const keep =
      w === 'filter'
        ? [this.panel, this.q('[data-vc=filter]')]
        : w === 'search'
          ? [this.q('.vc-search'), ...(this.finder ? [this.finder.el] : [])]
          : [this.q(`[data-d=${w}]`), this.q(`[data-open=${w}]`)];
    if (!keep.some((k) => k.contains(t))) this.close();
  };

  constructor(o: ChromeOptions) {
    useStyles('view-chrome', CSS);
    this.o = o;
    const el = document.createElement('div');
    el.className = 'vc';
    el.innerHTML = this.template();
    o.root.appendChild(el);
    this.el = el;
    this.input = this.q<HTMLInputElement>('.vc-search input');
    this.panel = this.q('.vc-panel');
    this.miniCanvas = this.q<HTMLCanvasElement>('.vc-mini canvas');
    this.globe = this.q<HTMLCanvasElement>('.vc-globe canvas');
    this.wire();
    this.place();
    this.refreshRegions();
    this.markActive();
    this.drawGlobe();
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('resize', this.onResize);
    this.unsubAgents = onAgents(() => this.paintAgents());
    // Every second, like the header pill: an agent going quiet drops off the
    // count on time, and the drawer's times ("12s") move on.
    this.agentTimer = window.setInterval(() => !document.hidden && this.paintAgents(), 1000);
  }

  private template(): string {
    const o = this.o;
    const modes = PAGES.map(
      ([p, label, svg]) => `<button type="button" data-page="${p}" aria-label="${label}" aria-pressed="${p === o.page}">${svg}<span>${label}</span></button>`,
    ).join('');
    return `
<div class="vc-tl">
  <label class="vc-p vc-search">${I.search}<input type="search" placeholder="${attr(o.search.placeholder)}" aria-label="${attr(o.search.placeholder)}" autocomplete="off" spellcheck="false"><em></em><kbd>/</kbd></label>
  <nav class="vc-p vc-col vc-modes" aria-label="View">${modes}</nav>
</div>
<div class="vc-p vc-col vc-tr">
  <button type="button" class="vc-b vc-reset" data-reset title="Reset this view to its defaults" aria-label="Reset this view to its defaults">${I.reset}</button>
  <button type="button" class="vc-b" data-vc="filter" aria-expanded="false" title="Filter and display" aria-label="Filter and display">${I.filter}<b class="vc-badge"></b></button>
</div>
<aside class="vc-p vc-panel" hidden aria-label="Filter and display"></aside>

<button type="button" class="vc-tab vc-tab-l" data-open="regions" aria-expanded="false" aria-label="Regions">${I.layers}<span>Regions</span><em data-rn></em></button>
<aside class="vc-drawer vc-drawer-l" data-d="regions" aria-label="Regions">
  <div class="vc-dh"><h4>Regions <em data-rn></em></h4><button type="button" class="vc-b" data-close title="Close" aria-label="Close">${I.close}</button></div>
  <div class="vc-bulk"><button type="button" data-all="show">Show all</button><button type="button" data-all="hide">Hide all</button></div>
  <div class="vc-db vc-rl"></div>
</aside>

<button type="button" class="vc-tab vc-tab-r" data-open="activity" aria-expanded="false" aria-label="Activity"><i class="dot"></i>${I.pulse}<span>Activity</span><em data-an></em></button>
<aside class="vc-drawer vc-drawer-r" data-d="activity" aria-label="Agent activity">
  <div class="vc-dh"><h4>Agents</h4><button type="button" class="vc-b" data-close title="Close" aria-label="Close">${I.close}</button></div>
  <div class="vc-db vc-al"></div>
</aside>

<div class="vc-p vc-mini" title="Minimap: click or drag to move the view"><canvas></canvas></div>
<div class="vc-dock">
  <div class="vc-p vc-globe" role="group" aria-label="Turn the view">
    <canvas></canvas>
    <button type="button" data-g="u" title="Up" aria-label="Up">${I.up}</button>
    <button type="button" data-g="l" title="Left" aria-label="Left">${I.up}</button>
    <button type="button" data-g="r" title="Right" aria-label="Right">${I.up}</button>
    <button type="button" data-g="d" title="Down" aria-label="Down">${I.up}</button>
    <button type="button" data-g="h" title="Default view" aria-label="Default view">${I.home}</button>
  </div>
  <div class="vc-p vc-col vc-zoom">
    <button type="button" class="vc-b vc-padbtn" data-open="sheet" title="Controller" aria-label="Controller">${I.pad}</button>
    <button type="button" class="vc-b" data-z="in" title="Zoom in (+)" aria-label="Zoom in">${I.plus}</button>
    <button type="button" class="vc-b" data-z="out" title="Zoom out (-)" aria-label="Zoom out">${I.minus}</button>
    <button type="button" class="vc-b" data-z="fit" title="Fit to screen" aria-label="Fit to screen">${I.fit}</button>
    <button type="button" class="vc-b" data-z="full" title="Full screen" aria-label="Full screen">${I.full}</button>
  </div>
</div>

<div class="vc-scrim"></div>
<section class="vc-sheet" aria-label="Controller">
  <div class="vc-grab"></div>
  <div class="vc-sh"><h4>Controller</h4><button type="button" class="vc-b" data-close title="Close" aria-label="Close">${I.close}</button></div>
  <div class="vc-sgrid"><div data-slot="globe"></div><div data-slot="mini"></div></div>
  <div data-slot="labels"></div>
</section>`;
  }

  /** Globe and minimap: on the map (desktop, tablet) or in the phone's sheet. */
  private place(): void {
    const globe = this.q('.vc-globe');
    const mini = this.q('.vc-mini');
    if (this.phone) {
      this.q('[data-slot=globe]').appendChild(globe);
      this.q('[data-slot=mini]').appendChild(mini);
    } else {
      this.q('.vc-dock').prepend(globe);
      this.el.insertBefore(mini, this.q('.vc-dock'));
    }
    this.applyPrefs();
  }

  /** The view came back on screen (Graph and Canvas live for the session). */
  shown(): void {
    this.markActive();
  }

  /** The switcher shows the view this chrome belongs to. */
  private markActive(): void {
    const page = this.o.page;
    this.el.querySelectorAll<HTMLElement>('.vc-modes button').forEach((b) => {
      b.classList.toggle('on', b.dataset.page === page);
      b.setAttribute('aria-pressed', String(b.dataset.page === page));
    });
  }

  // ── one panel at a time ────────────────────────────────────────────

  /** Open one panel; whatever else was open closes first. */
  private show(which: Overlay): void {
    if (this.open === which) return;
    this.close();
    this.open = which;
    this.el.dataset.open = which;
    // The view can step its own bars aside while a chrome panel is up.
    this.o.root.dataset.vcOpen = which;
    this.o.onOverlay?.();
    if (which === 'filter') {
      this.panel.hidden = false;
      this.q('[data-vc=filter]').classList.add('on');
      this.q('[data-vc=filter]').setAttribute('aria-expanded', 'true');
      this.renderPanel();
    } else if (which === 'regions' || which === 'activity') {
      this.q(`[data-d=${which}]`).classList.add('open');
      const tab = this.q(`[data-open=${which}]`);
      tab.classList.add('on');
      tab.setAttribute('aria-expanded', 'true');
      if (which === 'activity') this.paintAgents();
    } else if (which === 'sheet') {
      this.q('.vc-sheet').classList.add('open');
      this.q('.vc-scrim').classList.add('on');
      // The sheet owns the bottom of the screen: the view's own bars step aside.
      this.o.root.classList.add('vc-sheet-open');
      this.renderSheetLabels();
      requestAnimationFrame(() => this.redrawMini());
    } else if (which === 'search') {
      this.q('.vc-search').classList.add('open');
      this.sizeSearch();
      this.input.focus();
    }
  }

  /** Close whatever chrome panel is open. */
  close(): void {
    const was = this.open;
    if (!was) return;
    hideHelp();
    this.open = null;
    delete this.el.dataset.open;
    delete this.o.root.dataset.vcOpen;
    if (was === 'filter') {
      this.panel.hidden = true;
      this.q('[data-vc=filter]').classList.remove('on');
      this.q('[data-vc=filter]').setAttribute('aria-expanded', 'false');
    } else if (was === 'regions' || was === 'activity') {
      this.q(`[data-d=${was}]`).classList.remove('open');
      const tab = this.q(`[data-open=${was}]`);
      tab.classList.remove('on');
      tab.setAttribute('aria-expanded', 'false');
    } else if (was === 'sheet') {
      this.q('.vc-sheet').classList.remove('open');
      this.q('.vc-scrim').classList.remove('on');
      this.o.root.classList.remove('vc-sheet-open');
    } else if (was === 'search') {
      const box = this.q('.vc-search');
      box.classList.remove('open');
      box.style.width = '';
    }
  }

  /** The open search takes the whole top row (the tool columns start below it). */
  private sizeSearch(): void {
    const box = this.q('.vc-search');
    if (this.open !== 'search' || !compactSearch()) return;
    const b = box.getBoundingClientRect();
    const root = this.o.root.getBoundingClientRect();
    const gap = b.left - root.left;
    box.style.width = Math.max(b.height, root.right - gap - b.left) + 'px';
  }

  openPanel(): void {
    this.show('filter');
  }

  closePanel(): void {
    if (this.open === 'filter') this.close();
  }

  private wire(): void {
    const o = this.o;
    this.el.querySelectorAll<HTMLElement>('.vc-modes button').forEach((b) => {
      b.onclick = () => {
        const p = b.dataset.page as ViewPage;
        if (p === o.page) return;
        this.el.querySelectorAll<HTMLElement>('.vc-modes button').forEach((x) => x.classList.toggle('on', x === b));
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        clearTimeout(pendingSwitch);
        pendingSwitch = window.setTimeout(() => {
          hooks.go(p);
          // This chrome may stay alive (Graph, Canvas): back to its own view.
          this.markActive();
        }, reduced ? 0 : 140);
      };
    });

    // Search: a field on larger screens, an icon that opens one on phones.
    const box = this.q('.vc-search');
    box.addEventListener('click', () => {
      if (compactSearch() && this.open !== 'search') this.show('search');
    });
    const inp = this.input;
    const finder = o.search.find
      ? new MapFind(
          {
            input: inp,
            root: o.root,
            setCount: (t) => this.setCount(t),
            anchor: () => this.q('.vc-search'),
            compact: compactSearch,
          },
          o.search.find,
        )
      : null;
    (this as { finder: MapFind | null }).finder = finder;
    inp.oninput = () => {
      finder?.input();
      o.search.onInput?.(inp.value.trim());
    };
    inp.onfocus = () => {
      if (compactSearch() && this.open !== 'search') this.show('search');
      else if (!compactSearch() && this.open && this.open !== 'search') this.close();
      // After the field has its final size (it grows on phones).
      if (finder) requestAnimationFrame(() => finder.show());
      o.search.onFocus?.();
    };
    inp.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (document.activeElement !== inp) finder?.hide();
      }, 120);
      if (compactSearch() && !inp.value) window.setTimeout(() => this.open === 'search' && this.close(), 150);
    });
    inp.onkeydown = (e) => {
      if (finder) {
        if (e.key === 'Escape' && !inp.value) {
          finder.hide();
          inp.blur();
          if (this.open === 'search') this.close();
          e.preventDefault();
          return;
        }
        if (finder.key(e)) e.preventDefault();
        return;
      }
      if (o.search.onKey?.(e, inp.value.trim())) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        inp.value = '';
        o.search.onInput?.('');
        inp.blur();
        if (this.open === 'search') this.close();
      }
    };

    this.q('[data-vc=filter]').onclick = () => (this.open === 'filter' ? this.close() : this.show('filter'));
    document.addEventListener('pointerdown', this.onDocDown, true);

    // Reset: one click, everything back to defaults; the icon spins once.
    const rb = this.q('[data-reset]');
    const paintDirty = (): void => {
      const dirty = JSON.stringify(this.prefs) !== JSON.stringify(defaultChromePrefs()) || !!o.changed?.();
      if (rb.classList.contains('dirty') === dirty) return;
      rb.classList.toggle('dirty', dirty);
      const t = dirty ? 'Reset: this view differs from its defaults' : 'Reset this view to its defaults';
      rb.title = t;
      rb.setAttribute('aria-label', t);
    };
    this.dirtyTimer = window.setInterval(() => {
      if (!document.hidden && this.el.isConnected) paintDirty();
    }, 400);
    rb.onclick = () => {
      rb.classList.remove('spin');
      void rb.offsetWidth;
      rb.classList.add('spin');
      this.close();
      try {
        localStorage.removeItem(prefsKey());
      } catch {
        /* private mode */
      }
      this.prefs = defaultChromePrefs();
      o.reset();
      this.applyPrefs();
      this.refreshRegions();
    };

    this.el.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => {
      b.onclick = () => {
        const w = b.dataset.open as Overlay;
        if (this.open === w) this.close();
        else this.show(w);
      };
    });
    this.el.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => (b.onclick = () => this.close()));
    this.q('.vc-scrim').onclick = () => this.close();
    this.el.querySelectorAll<HTMLElement>('[data-all]').forEach((b) => {
      b.onclick = () => {
        o.regions.setAll(b.dataset.all === 'hide');
        this.refreshRegions();
      };
    });
    o.root.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.open && this.open !== 'search') this.close();
      },
      { signal: this.off.signal },
    );

    this.el.querySelectorAll<HTMLElement>('[data-z]').forEach((b) => {
      b.onclick = () => {
        const z = b.dataset.z;
        if (z === 'in') o.nav.zoom(1.4);
        else if (z === 'out') o.nav.zoom(1 / 1.4);
        else if (z === 'fit') o.nav.fit();
        else this.toggleFullscreen();
      };
    });
    document.addEventListener('fullscreenchange', this.onFs);

    // Globe arrows repeat while held.
    const step: Record<string, [number, number]> = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
    this.el.querySelectorAll<HTMLElement>('.vc-globe [data-g]').forEach((b) => {
      const g = b.dataset.g || '';
      if (g === 'h') {
        b.onclick = () => o.nav.home();
        return;
      }
      const go = (): void => o.nav.nudge(step[g][0], step[g][1]);
      b.onpointerdown = (e) => {
        e.preventDefault();
        go();
        clearTimeout(this.repeat);
        const again = (): void => {
          go();
          this.repeat = window.setTimeout(again, 110);
        };
        this.repeat = window.setTimeout(again, 380);
      };
      const stop = (): void => clearTimeout(this.repeat);
      b.onpointerup = stop;
      b.onpointerleave = stop;
      b.onpointercancel = stop;
      b.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      };
    });

    const mini = this.q('.vc-mini');
    if (o.minimapNav) {
      const nav = (e: PointerEvent): void => {
        const r = mini.getBoundingClientRect();
        o.minimapNav!(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
      };
      let dragging = false;
      mini.onpointerdown = (e) => {
        e.stopPropagation();
        dragging = true;
        mini.setPointerCapture(e.pointerId);
        nav(e);
      };
      mini.onpointermove = (e) => dragging && nav(e);
      mini.onpointerup = () => (dragging = false);
    }
    // Pointer events on the chrome never reach the map underneath.
    for (const p of this.el.querySelectorAll<HTMLElement>('.vc-p,.vc-tab,.vc-drawer,.vc-sheet,.vc-scrim')) {
      p.addEventListener('pointerdown', (e) => e.stopPropagation());
      p.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      p.addEventListener('dblclick', (e) => e.stopPropagation());
    }
  }

  // ── Filter panel ───────────────────────────────────────────────────

  /** Re-render the panel when it is open (after a setting changed). */
  renderPanel(): void {
    if (this.open !== 'filter') return;
    const p = this.panel;
    const top = p.scrollTop;
    const turn = this.o.page === 'brain' ? 'turn the brain' : 'move the map';
    p.innerHTML =
      (this.phone
        ? ''
        : `<h4>View</h4>` +
          toggleHTML('vc-minimap', 'Minimap', this.prefs.minimap, 'The small overview at the bottom left. Click or drag it to move the view.') +
          toggleHTML('vc-controls', 'Orbit globe', this.prefs.controls, `The globe at the bottom right: its arrows ${turn}, the middle button goes back to the default view.`)) +
      `<h4>Labels</h4>` +
      this.labelsHTML() +
      `<div data-own></div>`;
    p.querySelectorAll<HTMLElement>('[data-t^=vc-]').forEach((b) => (b.onclick = () => this.toggleShared(b.dataset.t || '')));
    this.o.filter(p.querySelector('[data-own]') as HTMLElement);
    wireHelp(p);
    p.scrollTop = top;
  }

  private labelsHTML(): string {
    const lab = this.o.labels.get();
    return (
      toggleHTML('vc-lab-nodes', 'Node labels', lab.nodes, this.o.labels.help.nodes) +
      toggleHTML('vc-lab-folders', 'Folder labels', lab.folders, this.o.labels.help.folders)
    );
  }

  private toggleShared(t: string): void {
    if (t === 'vc-lab-nodes' || t === 'vc-lab-folders') {
      const kind = t === 'vc-lab-nodes' ? 'nodes' : 'folders';
      this.o.labels.set(kind, !this.o.labels.get()[kind]);
    } else {
      if (t === 'vc-minimap') this.prefs.minimap = !this.prefs.minimap;
      else this.prefs.controls = !this.prefs.controls;
      savePrefs(this.prefs);
      this.applyPrefs();
    }
    this.renderPanel();
    this.renderSheetLabels();
  }

  /** The phone sheet's label switches (the same ones as in Filter). */
  private renderSheetLabels(): void {
    if (this.open !== 'sheet') return;
    const host = this.q('[data-slot=labels]');
    host.innerHTML = '<h4>Labels</h4>' + this.labelsHTML();
    host.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => (b.onclick = () => this.toggleShared(b.dataset.t || '')));
    wireHelp(host);
  }

  /** The M shortcut. */
  toggleMinimap(): void {
    if (this.phone) {
      if (this.open === 'sheet') this.close();
      else this.show('sheet');
      return;
    }
    this.prefs.minimap = !this.prefs.minimap;
    savePrefs(this.prefs);
    this.applyPrefs();
    this.renderPanel();
  }

  setBadge(n: number): void {
    this.q('.vc-badge').textContent = n ? String(n) : '';
  }

  setCount(text: string): void {
    this.q('.vc-search em').textContent = text;
  }

  private applyPrefs(): void {
    // On phones both live in the sheet and always show there.
    this.q('.vc-mini').classList.toggle('vc-hide', !this.phone && !this.prefs.minimap);
    this.q('.vc-globe').classList.toggle('vc-hide', !this.phone && !this.prefs.controls);
    this.o.onPrefs?.(this.prefs);
    this.redrawMini();
  }

  // ── Regions ────────────────────────────────────────────────────────

  refreshRegions(): void {
    const list = this.o.regions.list();
    const host = this.q('.vc-rl');
    const shown = list.filter((r) => !r.hidden).length;
    this.el.querySelectorAll<HTMLElement>('[data-rn]').forEach((e) => (e.textContent = shown === list.length ? String(list.length) : `${shown}/${list.length}`));
    this.q('.vc-bulk').classList.toggle('vc-hide', list.length < 2);
    const focusBtn = !!this.o.regions.focus;
    host.innerHTML = list.length
      ? list
          .map(
            (r) =>
              `<div class="vc-rr${r.hidden ? ' off' : ''}" style="--c:${attr(r.color)}"><button type="button" class="tg" data-r="${attr(r.name)}" aria-pressed="${!r.hidden}" title="${
                r.hidden ? 'Show' : 'Hide'
              } ${attr(r.name)}" aria-label="${r.hidden ? 'Show' : 'Hide'} ${attr(r.name)}"><i></i></button><button type="button" class="t" data-f="${attr(r.name)}" title="${
                focusBtn ? 'Go to' : r.hidden ? 'Show' : 'Hide'
              } ${attr(r.name)}"><span>${esc(r.name)}</span><em>${r.count}</em>${focusBtn ? I.target : ''}</button></div>`,
          )
          .join('')
      : '<div class="vc-empty">No folders yet.</div>';
    host.querySelectorAll<HTMLElement>('[data-r]').forEach((b) => {
      b.onclick = () => {
        this.o.regions.toggle(b.dataset.r || '');
        this.refreshRegions();
      };
    });
    // The name: show the folder if it was off, close the drawer so the map is
    // clear, then fly there (the view flashes it).
    host.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => {
      b.onclick = () => {
        const name = b.dataset.f || '';
        if (!this.o.regions.focus) {
          this.o.regions.toggle(name);
          this.refreshRegions();
          return;
        }
        if (list.find((r) => r.name === name)?.hidden) {
          this.o.regions.toggle(name);
          this.refreshRegions();
        }
        this.close();
        this.o.regions.focus(name);
      };
    });
  }

  // ── Activity ───────────────────────────────────────────────────────

  private paintAgents(): void {
    const now = Date.now();
    const busy = (a: AgentInfo): boolean => (a.open > 0 && now - a.lastAt < 120_000) || now - a.lastAt < 5_000;
    const list = agentList();
    // The same count as the header's Live pill; 0 shows as 0.
    const live = activeAgents();
    const tab = this.q('.vc-tab-r');
    tab.classList.toggle('live', live.length > 0);
    this.q('[data-an]').textContent = String(live.length);
    tab.title = live.length ? `${live.length} agent${live.length === 1 ? '' : 's'} working now` : 'Agent activity';
    if (this.open !== 'activity') return;
    const host = this.q('.vc-al');
    host.innerHTML = list.length
      ? list
          .slice(0, 30)
          .map((a) => {
            const on = busy(a);
            const what = a.lastLabel || a.lastAction || (a.kind === 'user' ? 'in the app' : 'connected');
            return `<div class="vc-ag${on ? ' on' : ''}" style="--ag:var(--accent)">${avatarHTML(a.actor, 30, on ? 'live' : '', a.id)}<div class="m"><b>${esc(a.actor)}</b><small>${esc(
              what,
            )}</small></div><time>${on ? 'now' : esc(ago(Math.floor(a.lastAt / 1000)))}</time></div>`;
          })
          .join('')
      : '<div class="vc-empty">No agent activity yet. Agents show up here the moment they read or write your memory.</div>';
  }

  // ── Dock ───────────────────────────────────────────────────────────

  redrawMini(): void {
    if (!this.phone && !this.prefs.minimap) return;
    if (this.phone && this.open !== 'sheet') return;
    const r = this.miniCanvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (this.miniCanvas.width !== w * dpr || this.miniCanvas.height !== h * dpr) {
      this.miniCanvas.width = w * dpr;
      this.miniCanvas.height = h * dpr;
    }
    this.o.minimap(this.miniCanvas, w, h, dpr);
  }

  /** The globe turns with the 3D camera (yaw around the vertical axis, pitch up). */
  setOrientation(yaw: number, pitch: number): void {
    if (Math.abs(yaw - this.orient.yaw) < 0.004 && Math.abs(pitch - this.orient.pitch) < 0.004) return;
    this.orient = { yaw, pitch };
    this.drawGlobe();
  }

  private drawGlobe(): void {
    const cv = this.globe;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = 64;
    if (cv.width !== S * dpr) {
      cv.width = S * dpr;
      cv.height = S * dpr;
    }
    const g = cv.getContext('2d');
    if (!g) return;
    const light = document.documentElement.dataset.theme === 'light';
    const ink = light ? '15,23,42' : '230,233,239';
    const acc = light ? '13,148,136' : '94,234,212';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const R = S / 2 - 2;
    const c = S / 2;
    const grad = g.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.1, c, c, R);
    grad.addColorStop(0, `rgba(${acc},.28)`);
    grad.addColorStop(1, `rgba(${acc},.04)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(${acc},.55)`;
    g.lineWidth = 1.2;
    g.stroke();
    const { yaw, pitch } = this.orient;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // Point on the unit sphere -> view (camera looks along -z after yaw/pitch).
    const proj = (lat: number, lon: number): [number, number, number] => {
      const x0 = Math.cos(lat) * Math.sin(lon);
      const y0 = Math.sin(lat);
      const z0 = Math.cos(lat) * Math.cos(lon);
      const x1 = x0 * cy - z0 * sy;
      const z1 = x0 * sy + z0 * cy;
      const y2 = y0 * cp - z1 * sp;
      const z2 = y0 * sp + z1 * cp;
      return [c + x1 * R, c - y2 * R, z2];
    };
    const line = (pts: [number, number, number][], strong: boolean): void => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const front = (a[2] + b[2]) / 2 > 0;
        g.strokeStyle = `rgba(${strong ? acc : ink},${front ? (strong ? 0.85 : 0.38) : 0.09})`;
        g.lineWidth = strong && front ? 1.4 : 1;
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
      }
    };
    for (let k = 0; k < 6; k++) {
      const lon = (k / 6) * Math.PI;
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 36; i++) pts.push(proj(-Math.PI / 2 + (i / 36) * Math.PI * 2, lon));
      line(pts, false);
    }
    for (const lat of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 48; i++) pts.push(proj(lat, (i / 48) * Math.PI * 2));
      line(pts, lat === 0);
    }
  }

  // ── Full screen ────────────────────────────────────────────────────

  private toggleFullscreen(): void {
    const host = this.o.root;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void host.requestFullscreen?.().catch(() => undefined);
  }

  private paintFs(): void {
    const b = this.q('[data-z=full]');
    const on = document.fullscreenElement === this.o.root;
    b.innerHTML = on ? I.exitFull : I.full;
    b.title = on ? 'Exit full screen' : 'Full screen';
    b.setAttribute('aria-label', b.title);
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  }

  /** Focus the search field (the views bind "/"). */
  focusSearch(): void {
    if (compactSearch()) this.show('search');
    this.input.focus();
    this.input.select();
  }

  /** Put a query in the search (a tag chip on the node card) and show its results. */
  setQuery(q: string): void {
    if (compactSearch()) this.show('search');
    this.input.value = q;
    this.input.focus();
    this.finder?.input();
  }

  destroy(): void {
    clearTimeout(this.repeat);
    clearInterval(this.agentTimer);
    clearInterval(this.dirtyTimer);
    this.unsubAgents?.();
    document.removeEventListener('pointerdown', this.onDocDown, true);
    document.removeEventListener('fullscreenchange', this.onFs);
    window.removeEventListener('resize', this.onResize);
    this.themeObs.disconnect();
    this.off.abort();
    hideHelp();
    this.finder?.destroy();
    this.el.remove();
  }
}

/** The small "?" before a setting; its text shows on hover or focus. */
export function helpHTML(text: string): string {
  return text ? `<b class="vc-q" tabindex="0" role="img" aria-label="${attr(text)}" data-help="${attr(text)}">?</b>` : '';
}

/** A switch row for the Filter panel, with optional hover help. */
export function toggleHTML(key: string, label: string, on: boolean, help = ''): string {
  return `<button type="button" class="vc-tg${on ? ' on' : ''}" data-t="${attr(key)}" role="switch" aria-checked="${on}"><span>${helpHTML(help)}${esc(label)}</span><i></i></button>`;
}

/** A labelled slider row, with optional hover help. */
export function sliderHTML(key: string, label: string, min: number, max: number, step: number, value: number, help = ''): string {
  return `<label class="vc-sl"><span>${helpHTML(help)}${esc(label)}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-s="${attr(key)}"></label>`;
}

/** The one floating help tip; a re-render or a closed panel takes it down. */
let helpTip: HTMLElement | null = null;
const scrollWired = new WeakSet<HTMLElement>();

function hideHelp(): void {
  helpTip?.remove();
  helpTip = null;
}

/** Hover help for the "?" marks (a floating tip, so a scrolling panel cannot clip it). */
function wireHelp(host: HTMLElement): void {
  hideHelp();
  const show = (q: HTMLElement): void => {
    hideHelp();
    const tip = document.createElement('div');
    helpTip = tip;
    tip.className = 'vc-tip';
    tip.textContent = q.dataset.help || '';
    document.body.appendChild(tip);
    const r = q.getBoundingClientRect();
    const w = tip.offsetWidth;
    const left = r.left - w - 10 >= 8 ? r.left - w - 10 : Math.min(innerWidth - w - 8, r.right + 10);
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, Math.min(innerHeight - tip.offsetHeight - 8, r.top - 4)) + 'px';
  };
  host.querySelectorAll<HTMLElement>('.vc-q').forEach((q) => {
    q.onmouseenter = () => show(q);
    q.onfocus = () => show(q);
    q.onmouseleave = hideHelp;
    q.onblur = hideHelp;
    // A tap on the "?" explains; it does not flip the switch.
    q.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      show(q);
      const tip = helpTip;
      window.setTimeout(() => tip === helpTip && hideHelp(), 3500);
    };
  });
  if (!scrollWired.has(host)) {
    scrollWired.add(host);
    host.addEventListener('scroll', hideHelp, { passive: true });
  }
}
