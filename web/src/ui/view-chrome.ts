import { MapFind, type FindSource } from './map-find';
import { ago } from '../control/ui';
import { avatarHTML } from '../control/agents';
import { attr, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { activeAgents, agentList, onAgents, type AgentInfo } from '../realtime';
import { icon } from './icons';
import { fadeScroll } from './scroll-fade';

type ViewPage = 'brain' | 'graph' | 'canvas';

interface ChromeRegion {
  name: string;
  color: string;
  count: number;
  hidden: boolean;
}

interface ChromeOptions {
  page: ViewPage;
  root: HTMLElement;
  search: {
    placeholder: string;
    find?: FindSource;
    onInput?: (q: string) => void;
    /** True when handled. */
    onKey?: (e: KeyboardEvent, q: string) => boolean;
    onFocus?: () => void;
  };
  labels: {
    get: () => { nodes: boolean; folders: boolean };
    set: (kind: 'nodes' | 'folders', on: boolean) => void;
    help: { nodes: string; folders: string };
  };
  filter: (host: HTMLElement) => void;
  reset: () => void;
  /** True while the view differs from its defaults; lights up Reset. */
  changed?: () => boolean;
  regions: {
    list: () => ChromeRegion[];
    toggle: (name: string) => void;
    setAll: (hidden: boolean) => void;
    focus?: (name: string) => void;
  };
  nav: {
    zoom: (factor: number) => void;
    fit: () => void;
    /** Turn (3D) or pan (2D). */
    nudge: (dx: number, dy: number) => void;
    home: () => void;
  };
  /** Sizes in CSS px. */
  minimap: (cv: HTMLCanvasElement, w: number, h: number, dpr: number) => void;
  /** Fractions of the minimap size. */
  minimapNav?: (fx: number, fy: number) => void;
  onPrefs?: (p: ChromePrefs) => void;
  onOverlay?: () => void;
}

interface ChromePrefs {
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
const compactSearch = (): boolean => device() === 'phone';

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

/** One dot-grid switch for all three maps, on every device. */
const DOTS_KEY = 'memora.map.dots';
function dotsOn(): boolean {
  try {
    return localStorage.getItem(DOTS_KEY) !== '0';
  } catch {
    return true;
  }
}
function setDots(on: boolean): void {
  try {
    localStorage.setItem(DOTS_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
  document.documentElement.classList.toggle('no-dots', !on);
  window.dispatchEvent(new Event('memora:dots'));
}
document.documentElement.classList.toggle('no-dots', !dotsOn());

function savePrefs(p: ChromePrefs): void {
  try {
    localStorage.setItem(prefsKey(), JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

// 3D gets a cube so the brain icon never shows twice.
const CUBE =
  '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>';
const PAGES: [ViewPage, string, string, string][] = [
  ['brain', '3D', CUBE, '3D: your notes as points in a 3D brain'],
  ['graph', 'Graph', icon('graph'), 'Graph: a map of the links between notes'],
  ['canvas', 'Canvas', icon('canvas'), 'Canvas: your notes as cards on a board'],
];

const EMPTY: Record<ViewPage, { title: string; text: string }> = {
  brain: {
    title: 'Your brain is empty',
    text: 'Every note becomes a point of light here, grouped by folder. The guide shows how to have an AI save its knowledge here, or write a note yourself.',
  },
  graph: {
    title: 'No notes to map yet',
    text: 'Notes and the links between them show up here as a map. The guide shows how to have an AI save its knowledge here, or write a note yourself.',
  },
  canvas: {
    title: 'Your board is empty',
    text: 'Every note becomes a card here, inside a frame for its folder. The guide shows how to have an AI save its knowledge here, or write a note yourself.',
  },
};

let pendingSwitch = 0;

type Overlay = 'filter' | 'regions' | 'activity' | 'sheet' | 'search';

const I = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" rx="1.6"/><path d="M3.5 3.5 6.5 6.5M20.5 3.5l-3 3M3.5 20.5l3-3M20.5 20.5l-3-3"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.2 9.5 7-.4 1.1-1.2 2.5-2.4 3.8M6.6 6.6C4.6 7.9 3.2 9.9 2.5 12c1 2.8 4.5 7 9.5 7 1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12C3.5 9.2 7 5 12 5s8.5 4.2 9.5 7c-1 2.8-4.5 7-9.5 7s-8.5-4.2-9.5-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  exitFull: '<svg viewBox="0 0 24 24"><path d="M4 14h6v6M20 10h-6V4M14 10l6.5-6.5M10 14l-6.5 6.5"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5M6.5 10v9h11v-9"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  layers: '<svg class="tic" viewBox="0 0 24 24"><path d="m12 4 8 4.5-8 4.5-8-4.5z"/><path d="m4 12.5 8 4.5 8-4.5"/><path d="m4 16.5 8 4.5 8-4.5"/></svg>',
  pulse: '<svg class="tic" viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
  pad: '<svg viewBox="0 0 24 24"><path d="M7 9h10a4 4 0 0 1 3.9 4.9l-.6 2.6a2.3 2.3 0 0 1-4 1L14.6 16H9.4l-1.7 1.5a2.3 2.3 0 0 1-4-1l-.6-2.6A4 4 0 0 1 7 9z"/><path d="M8 11.5v3M6.5 13h3"/><circle cx="15.5" cy="12" r=".6"/><circle cx="17" cy="13.8" r=".6"/></svg>',
};

const CSS = `
:is(.vc,.nc,.mf,.vc-tip,.cv-help){--vc-ctl:var(--surface-2);--vc-ctl-line:var(--line-strong);--vc-ctl-icon:var(--text-2);
  --vc-tint:var(--hover);--vc-track:var(--seg-track);--vc-thumb:var(--seg-thumb);--vc-solid:var(--surface-2);--vc-line:var(--line)}
:root[data-theme=light] :is(.vc,.nc,.mf,.vc-tip,.cv-help){--vc-ctl:#ffffff;--vc-solid:#ffffff}
.vc-p{position:absolute;z-index:6;background:var(--vc-ctl);border:1px solid var(--vc-ctl-line);border-radius:12px;color:var(--fg,#e6e9ef);box-shadow:none}
.vc-ovl{background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);border:1px solid var(--vc-ctl-line);border-top-color:var(--ovl-edge);box-shadow:none}
.vc-hide{display:none !important}

.vc-b{all:unset;box-sizing:border-box;cursor:pointer;width:36px;height:36px;border-radius:8px;display:grid;place-items:center;position:relative;flex:none;
  color:var(--vc-ctl-icon);transition:background .15s,color .15s}
.vc-b:hover{color:var(--fg,#e6e9ef);background:var(--vc-tint)}
.vc-b.on,.vc-b[aria-pressed=true]{color:var(--accent,#5eead4);background:var(--accent-soft,rgba(94,234,212,.11))}
.vc-b:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:1px}
.vc-b svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.vc-badge{position:absolute;top:2px;right:2px;min-width:15px;height:15px;padding:0 4px;box-sizing:border-box;border-radius:99px;font-size:9.5px;font-weight:700;line-height:15px;text-align:center;
  background:var(--primary,#08c6d4);color:var(--on-primary,#03252a)}
.vc-badge:empty{display:none}
.vc-reset.spin svg{animation:vc-spin .5s cubic-bezier(.2,.8,.2,1)}
.vc-reset.dirty{color:var(--accent,#5eead4)}
.vc-reset::after{content:"";position:absolute;top:6px;right:6px;width:6px;height:6px;border-radius:50%;background:var(--accent,#5eead4);
  transform:scale(0);transition:transform .2s cubic-bezier(.2,.8,.2,1)}
.vc-reset.dirty::after{transform:scale(1)}
@keyframes vc-spin{from{transform:rotate(0)}to{transform:rotate(-360deg)}}

.vc{--vc-h:44px;--vc-w:264px;--vc-gap:12px;--vc-row2:calc(var(--vc-gap) + var(--vc-h) + 8px)}
.vc-tl{position:absolute;z-index:7;left:var(--vc-gap);top:var(--vc-gap);display:flex;flex-direction:column;align-items:flex-start;gap:8px;pointer-events:none}
.vc-tl>*{pointer-events:auto;position:relative}
.vc-search{display:flex;align-items:center;gap:8px;width:var(--vc-w);height:var(--vc-h);box-sizing:border-box;padding:0 12px;transition:border-color .2s}
.vc-search:focus-within{border-color:var(--accent-line,rgba(94,234,212,.38))}
.vc-search svg{width:16px;height:16px;flex:none;color:var(--vc-ctl-icon);fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round}
.vc-search input{all:unset;flex:1;min-width:0;font-size:13.5px;color:var(--fg,#e6e9ef)}
.vc-search input::placeholder{color:var(--muted,#8b98ad)}
.vc-search input::-webkit-search-cancel-button{display:none}
.vc-search kbd{color:var(--muted,#8b98ad)}
.vc-search em{font-style:normal;font-size:12px;color:var(--muted,#8b98ad);white-space:nowrap}
.vc-search em:empty{display:none}
.vc-search:focus-within kbd{display:none}

.vc-modes{flex-direction:row;width:var(--vc-w);height:var(--vc-h);box-sizing:border-box;gap:2px;padding:3px;background:var(--vc-track)}
.vc-modes button{all:unset;box-sizing:border-box;position:relative;cursor:pointer;flex:1;height:100%;border-radius:9px;display:flex;align-items:center;justify-content:center;gap:7px;
  font-size:13.5px;font-weight:550;color:var(--muted,#8b98ad);border:1px solid transparent;transition:background .2s,color .2s,border-color .2s}
.vc-modes button .i{width:16px;height:16px}
.vc-modes button:hover{color:var(--fg,#e6e9ef)}
.vc-modes button.on{color:var(--fg,#e6e9ef);background:var(--vc-thumb);border-color:var(--vc-ctl-line)}
.vc-modes button:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:1px}
.vc-modes button span{white-space:nowrap}

.vc-tr{right:var(--vc-gap);top:var(--vc-gap);flex-direction:row;height:var(--vc-h);box-sizing:border-box;gap:2px;padding:3px}
.vc-tr .vc-b{height:100%}

.vc-panel{right:var(--vc-gap);top:var(--vc-row2);width:296px;max-height:calc(100% - var(--vc-row2) - var(--vc-gap));display:flex;flex-direction:column;overflow:hidden;
  z-index:8;transform-origin:top right;animation:vc-in .18s cubic-bezier(.2,.8,.2,1)}
.vc-panel[hidden]{display:none}
@keyframes vc-in{from{opacity:0;transform:translateY(-4px)}}
.vc-ph{display:flex;align-items:center;gap:8px;padding:8px 6px 4px 16px;flex:none}
.vc-ph h3{flex:1;margin:0;font-size:15px;font-weight:650;letter-spacing:-.005em}
.vc-ph .vc-b{width:32px;height:32px}
.vc-pb{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:4px 16px 16px}
.vc-panel h4,.vc-drawer h4,.vc-sheet h4{margin:14px 0 4px;padding-top:12px;border-top:1px solid var(--vc-line);font-size:12.5px;font-weight:650;color:var(--text-2,#a3afc2);
  display:flex;align-items:center;gap:7px}
.vc-pb>h4:first-child,.vc-sheet [data-slot=labels] h4{margin-top:4px;padding-top:0;border-top:0}
.vc-tg{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:36px;padding:4px 0;
  font-size:13px;color:var(--fg,#e6e9ef)}
.vc-tg i{position:relative;width:32px;height:18px;border-radius:99px;background:color-mix(in srgb,var(--fg,#e6e9ef) 16%,transparent);transition:background .2s;flex:none}
.vc-tg i::after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .2s}
.vc-tg.on i{background:var(--primary,#08c6d4)}
.vc-tg.on i::after{transform:translateX(14px)}
.vc-tg>span,.vc-sl>span{display:inline-flex;align-items:center;gap:8px}
.vc-tg:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:2px;border-radius:6px}
.vc-q{position:relative;flex:none;width:16px;height:16px;border-radius:50%;display:inline-grid;place-items:center;cursor:help;order:2;
  font:650 10px/1 var(--font,system-ui),sans-serif;color:var(--muted,#8b98ad);border:1px solid var(--vc-ctl-line);letter-spacing:0}
.vc-q:hover{color:var(--fg,#e6e9ef);border-color:var(--muted,#8b98ad)}
.vc-tip{position:fixed;z-index:90;max-width:240px;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.45;font-weight:500;pointer-events:none;
  color:var(--fg,#e6e9ef);background:var(--ovl-bg);-webkit-backdrop-filter:var(--ovl-filter);backdrop-filter:var(--ovl-filter);border:1px solid var(--vc-ctl-line);box-shadow:none}
.vc-seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:var(--vc-track);margin:4px 0 6px}
.vc-seg button{all:unset;box-sizing:border-box;cursor:pointer;flex:1;height:30px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;gap:5px;
  font-size:12.5px;font-weight:550;color:var(--muted,#8b98ad);border:1px solid transparent}
.vc-seg button:hover{color:var(--fg,#e6e9ef)}
.vc-seg button svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.vc-seg button.on{background:var(--vc-thumb);color:var(--fg,#e6e9ef);border-color:var(--vc-ctl-line)}
.vc-seg button:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:1px}
.vc-sl{display:grid;grid-template-columns:96px 1fr;align-items:center;gap:12px;min-height:36px;font-size:13px}
.vc-sl input{width:100%;accent-color:var(--primary,#08c6d4)}
.vc-act{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:36px;margin-top:8px;border-radius:8px;
  font-size:13px;font-weight:600;border:1px solid var(--vc-ctl-line);color:var(--fg,#e6e9ef);transition:background .15s}
.vc-act:hover{background:var(--vc-tint)}
.vc-act:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:1px}
.vc-hint{margin-top:14px;font-size:12px;line-height:1.55;color:var(--muted,#8b98ad)}

.vc-tab{all:unset;box-sizing:border-box;cursor:pointer;position:absolute;z-index:6;top:50%;translate:0 -50%;display:flex;flex-direction:column;align-items:center;gap:8px;
  padding:12px 8px;font-size:12px;font-weight:600;color:var(--vc-ctl-icon);background:var(--vc-ctl);border:1px solid var(--vc-ctl-line);
  transition:color .2s,background .2s,opacity .2s}
.vc-tab span{writing-mode:vertical-rl}
.vc-tab .tic{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.vc-tab-r .tic{display:none}
.vc-tab:hover,.vc-tab.on{color:var(--fg,#e6e9ef);background:color-mix(in srgb,var(--fg,#e6e9ef) 6%,var(--vc-ctl))}
.vc-tab:focus-visible{outline:2px solid var(--accent,#5eead4)}
.vc-tab em{font-style:normal;font-size:11px;font-weight:650;min-width:20px;padding:1px 5px;box-sizing:border-box;border-radius:99px;text-align:center;
  background:var(--vc-tint);color:var(--text-2,#a3afc2)}
.vc-tab em:empty{display:none}
.vc-tab-l{left:0;border-left:0;border-radius:0 12px 12px 0}
.vc-tab-r{right:0;border-right:0;border-radius:12px 0 0 12px}
.vc-tab .dot{width:7px;height:7px;border-radius:50%;background:var(--text-3,#5f6b80);flex:none}
.vc-tab.live{color:var(--ok,#4ade80)}
.vc-tab.live .dot{background:var(--ok,#4ade80);animation:vc-dot 1.2s ease-in-out infinite}
.vc-tab.live em{background:var(--ok-soft,rgba(74,222,128,.12));color:var(--ok,#4ade80)}
@property --vc-a{syntax:'<angle>';inherits:false;initial-value:0deg}
.vc-tab.live::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.5px;pointer-events:none;
  background:conic-gradient(from var(--vc-a),transparent 0deg,transparent 260deg,var(--ok,#4ade80) 320deg,transparent 360deg);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;
  animation:vc-run 2.4s linear infinite}
@keyframes vc-run{to{--vc-a:360deg}}
@keyframes vc-dot{50%{transform:scale(1.35)}}

.vc-drawer{position:absolute;z-index:8;top:var(--vc-gap);bottom:var(--vc-gap);width:min(288px,calc(100% - 2 * var(--vc-gap)));display:flex;flex-direction:column;border-radius:12px;
  color:var(--fg,#e6e9ef);transition:transform .3s cubic-bezier(.2,.8,.2,1),visibility .3s}
.vc-drawer-l{left:var(--vc-gap);transform:translateX(calc(-100% - 2 * var(--vc-gap)))}
.vc-drawer-r{right:var(--vc-gap);transform:translateX(calc(100% + 2 * var(--vc-gap)))}
.vc-drawer:not(.open){visibility:hidden}
.vc-drawer.open{transform:none}
.vc-dh{display:flex;align-items:center;gap:8px;padding:8px 6px 4px 16px;flex:none}
.vc-dh h3{flex:1;margin:0;font-size:15px;font-weight:650;display:flex;align-items:baseline;gap:8px}
.vc-dh h3 em{font-style:normal;font-size:12.5px;font-weight:500;color:var(--muted,#8b98ad)}
.vc-dh .vc-b{width:32px;height:32px}
.vc-db{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:4px 8px 12px}
.vc-bulk{display:flex;gap:16px;padding:0 16px 8px;flex:none}
.vc-bulk button{all:unset;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--accent,#5eead4)}
.vc-bulk button:hover{text-decoration:underline}
.vc-bulk button:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:2px;border-radius:4px}
.vc-rr{display:flex;align-items:center;gap:2px;border-radius:8px}
.vc-rr:hover{background:var(--vc-tint)}
.vc-rr button{all:unset;box-sizing:border-box;cursor:pointer}
.vc-rr button:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:-2px;border-radius:8px}
.vc-rr .tg{flex:none;width:36px;height:36px;display:grid;place-items:center;border-radius:8px}
.vc-rr .tg i{width:12px;height:12px;border-radius:50%;background:var(--c);border:2px solid var(--c);box-sizing:border-box;transition:background .2s}
.vc-rr.off .tg i{background:transparent}
.vc-rr .t{flex:1;min-width:0;display:flex;align-items:center;gap:8px;min-height:36px;padding:0 10px 0 2px;font-size:13px;color:var(--fg,#e6e9ef)}
.vc-rr .t span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vc-rr .t em{font-style:normal;font-size:12px;color:var(--muted,#8b98ad);min-width:22px;text-align:right;font-variant-numeric:tabular-nums}
.vc-rr .t svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.9;color:var(--muted,#8b98ad);opacity:0;transition:opacity .15s}
.vc-rr .t:hover svg,.vc-rr .t:focus-visible svg{opacity:1}
@media (hover:none){.vc-rr .t svg{opacity:.6}}
.vc-rr.off .t span{opacity:.45}
.vc-empty{padding:8px 8px 12px;font-size:13px;line-height:1.55;color:var(--muted,#8b98ad)}
.vc-ag{display:flex;align-items:center;gap:10px;min-height:48px;padding:6px 8px;border-radius:8px}
.vc-ag+.vc-ag{margin-top:2px}
.vc-ag.on{background:var(--accent-soft,rgba(94,234,212,.11))}
.vc-ag .m{flex:1;min-width:0}
.vc-ag b{display:block;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vc-ag small{display:block;font-size:12px;color:var(--muted,#8b98ad);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vc-ag time{font-size:12px;color:var(--muted,#8b98ad);white-space:nowrap}
.vc-ag.on time{color:var(--accent,#5eead4);font-weight:600}

.vc-mini{left:var(--vc-gap);bottom:var(--vc-gap);display:block;width:184px;height:120px;padding:0;overflow:hidden;cursor:crosshair}
.vc-mini canvas{display:block;width:100%;height:100%}
.vc-dock{position:absolute;z-index:6;right:var(--vc-gap);bottom:var(--vc-gap);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.vc-dock>*{pointer-events:auto;position:relative}
.vc-zoom{flex-direction:row;height:var(--vc-h);box-sizing:border-box}
.vc-zoom .vc-b{height:100%}
.vc-globe{position:relative;width:120px;height:120px;border-radius:50%}
.vc-globe canvas{position:absolute;left:28px;top:28px;width:64px;height:64px;pointer-events:none}
.vc-globe button{all:unset;box-sizing:border-box;cursor:pointer;position:absolute;width:28px;height:28px;display:grid;place-items:center;border-radius:50%;color:var(--vc-ctl-icon);
  transition:background .15s,color .15s}
.vc-globe button:hover{color:var(--fg,#e6e9ef);background:var(--vc-tint)}
.vc-globe button:active{background:var(--accent-soft,rgba(94,234,212,.11));color:var(--accent,#5eead4)}
.vc-globe button:focus-visible{outline:2px solid var(--accent,#5eead4)}
.vc-globe button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.vc-globe [data-g=u]{left:45px;top:2px}
.vc-globe [data-g=d]{left:45px;bottom:2px;rotate:180deg}
.vc-globe [data-g=l]{left:2px;top:45px;rotate:-90deg}
.vc-globe [data-g=r]{right:2px;top:45px;rotate:90deg}
.vc-globe [data-g=h]{left:41px;top:41px;width:38px;height:38px;color:transparent}
.vc-globe [data-g=h]:hover{color:var(--fg,#e6e9ef);background:color-mix(in srgb,var(--vc-ctl) 70%,transparent)}
.vc-padbtn{display:none !important}

.vc-scrim{position:absolute;inset:0;z-index:40;background:var(--scrim,rgba(3,5,9,.4));-webkit-backdrop-filter:var(--scrim-filter,blur(4px));backdrop-filter:var(--scrim-filter,blur(4px));
  opacity:0;pointer-events:none;transition:opacity .25s}
:root[data-theme=light] .vc-scrim{background:var(--scrim,rgba(15,23,42,.22))}
.vc-scrim.on{opacity:1;pointer-events:auto}
.vc-sheet{position:absolute;z-index:41;left:0;right:0;bottom:0;max-height:88%;overflow:auto;box-sizing:border-box;padding:0 16px calc(16px + env(safe-area-inset-bottom));
  border-radius:12px 12px 0 0;border-bottom:0;color:var(--fg,#e6e9ef);transform:translateY(105%);transition:transform .3s cubic-bezier(.2,.8,.2,1),visibility .3s}
.vc-sheet:not(.open){visibility:hidden}
.vc-sheet.open{transform:none}
.vc-sheet-open .vc-dock,.vc-sheet-open .vc-tab{opacity:0;pointer-events:none}
.vc-grab{width:36px;height:4px;border-radius:99px;margin:8px auto 4px;background:var(--line-strong,rgba(148,163,184,.22))}
.vc-sh{display:flex;align-items:center;justify-content:space-between;min-height:44px}
.vc-sh h3{margin:0;font-size:16px;font-weight:650}
.vc-sgrid{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center;margin:8px 0 12px}
.vc-sheet .vc-globe,.vc-sheet .vc-mini{position:relative;left:auto;right:auto;bottom:auto;top:auto}
.vc-sheet .vc-mini{width:100%;height:120px}
.vc-tl{transition:opacity .2s,translate .25s}
.vc[data-open=regions] .vc-tl{opacity:0;translate:-12px 0;pointer-events:none}
.vc-dock{transition:opacity .2s}

@media (pointer:coarse){
  .vc-modes,.vc-tr,.vc-zoom{padding:2px}
  .vc-tr .vc-b,.vc-zoom .vc-b{width:40px}
  .vc-ph .vc-b,.vc-dh .vc-b{width:40px;height:40px}
  .vc-tg,.vc-sl,.vc-rr .t{min-height:44px}
  .vc-rr .tg{width:44px;height:44px}
}

@media (max-width:760px){
  .vc-search{width:var(--vc-h);padding:0;justify-content:center;cursor:pointer;transition:width .25s cubic-bezier(.2,.8,.2,1),border-color .2s}
  .vc-search input,.vc-search em,.vc-search kbd{display:none}
  .vc-search.open{padding:0 12px;justify-content:flex-start;cursor:auto}
  .vc-search.open input,.vc-search.open em{display:block}
}
@media (max-width:760px){
  .vc{--vc-gap:10px}
  .vc-modes{flex-direction:column;width:var(--vc-h);height:auto;padding:3px}
  .vc-modes button{flex:none;width:100%;height:38px}
  .vc-modes button span{position:absolute;left:calc(100% + 10px);top:50%;translate:-6px -50%;padding:5px 10px;border-radius:8px;pointer-events:none;
    font-size:12.5px;color:var(--fg,#e6e9ef);background:var(--vc-solid);border:1px solid var(--vc-ctl-line);opacity:0;transition:opacity .18s,translate .25s cubic-bezier(.2,.8,.2,1)}
  .vc-modes button:focus-visible span{opacity:1;translate:0 -50%}
  .vc-tr{top:var(--vc-row2);flex-direction:column;width:var(--vc-h);height:auto}
  .vc-tr .vc-b{width:100%;height:38px}
  .vc-panel{left:calc(var(--vc-gap) + var(--vc-h) + 8px);right:calc(var(--vc-gap) + var(--vc-h) + 8px);width:auto;max-height:calc(100% - var(--vc-row2) - 72px)}
  .vc-zoom{flex-direction:column;width:var(--vc-h);height:auto}
  .vc-zoom .vc-b{width:100%;height:38px}
  .vc-dock{align-items:flex-end}
  .vc-dock>.vc-globe,.vc>.vc-mini{display:none !important}
  .vc-padbtn{display:grid !important}
  .vc-b[data-z=full]{display:none}
  .vc-tab{padding:10px 6px;gap:6px}
  .vc-tab span{display:none}
  .vc-tab-r .tic{display:block}
  .vc-tab-r .dot{display:none}
  .vc-tab-r.live .dot{display:block}
  /* Room for the tab bar's raised centre button. */
  .vc-db{padding-bottom:52px}
  .vc{--vc-dw:min(300px,calc(100% - 2 * var(--vc-gap)))}
}
/* Short screens: no globe or minimap, so columns, tabs and dock never meet. */
@media (max-height:620px){
  .vc-dock>.vc-globe,.vc>.vc-mini{display:none !important}
  .vc-tab{padding:10px 6px;gap:6px}
  .vc-tab span{display:none}
  .vc-tab-l{top:max(50%, 214px)}
}
.vc-ec{position:absolute;inset:0;z-index:5;display:grid;place-items:center;padding:24px;pointer-events:none}
.vc-ec[hidden]{display:none}
.vc-ec-card{pointer-events:auto;box-sizing:border-box;width:min(420px,100%);padding:24px;text-align:center;border-radius:12px;
  background:var(--vc-ctl);border:1px solid var(--vc-ctl-line)}
.vc-ec-ic{display:inline-grid;place-items:center;width:40px;height:40px;margin-bottom:12px;border-radius:10px;color:var(--accent,#5eead4);background:var(--accent-soft,rgba(94,234,212,.11))}
.vc-ec-ic svg{width:20px;height:20px}
.vc-ec-card h3{margin:0 0 6px;font-size:16px;font-weight:650;color:var(--fg,#e6e9ef)}
.vc-ec-card p{margin:0 auto;max-width:36ch;font-size:13.5px;line-height:1.55;color:var(--muted,#8b98ad)}
.vc-ec-acts{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:16px}
.vc-ec-acts svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.vc.vc-is-empty>.vc-mini,.vc.vc-is-empty .vc-tab-l,.vc.vc-is-empty .vc-dock{display:none !important}
@media (max-width:760px){.vc-ec{padding:24px 64px}}
@media (prefers-reduced-motion:reduce){.vc-drawer,.vc-sheet,.vc-modes button span,.vc-panel{transition:none;animation:none}.vc-tab.live::before,.vc-tab.live .dot{animation:none}}

.vc-search,.vc-modes,.vc-tr,.vc-zoom{border-radius:999px}
.vc-search{padding:0 16px}
.vc-modes{padding:4px;gap:2px}
.vc-modes button{border-radius:999px;font-weight:500}
.vc-modes button.on{font-weight:600}
.vc-modes button.on::after{content:"";position:absolute;left:50%;bottom:3px;width:14px;height:2px;margin-left:-7px;border-radius:2px;background:var(--brand-mark,#5eead4)}
.vc-tr,.vc-zoom{padding:4px}
.vc-b{border-radius:999px}
.vc-b.on,.vc-b[aria-pressed=true]{color:var(--fg,#e6e9ef);background:color-mix(in srgb,var(--fg,#e6e9ef) 9%,transparent)}
.vc-badge{background:linear-gradient(180deg,#17202e,#0b0f17);color:#5eead4;box-shadow:0 0 0 2px var(--vc-ctl)}
.vc-panel,.vc-drawer{border-radius:14px}
.vc-ph h3{font-weight:600}
.vc-panel h4,.vc-drawer h4,.vc-sheet h4{font-weight:500;color:var(--muted,#8b98ad)}
@media (max-width:760px){.vc-modes button.on::after{display:none}}
.vc-tab{background:linear-gradient(180deg,#1b2433,#0d121b);color:#5eead4;border-color:rgba(94,234,212,.3)}
.vc-tab:hover,.vc-tab.on{color:#99f6e4;background:linear-gradient(180deg,#223046,#111827)}
.vc-tab em{background:rgba(94,234,212,.16);color:#5eead4}
.vc-tab .dot{background:#5eead4}
.vc-tab.live{color:#4ade80}
.vc-tab.live em{background:rgba(74,222,128,.16);color:#4ade80}
@media (max-width:760px){.vc-tab{padding:12px 8px}.vc-tab .tic{width:18px;height:18px}}
.vc{--vc-dw:min(288px,calc(100% - 2 * var(--vc-gap)))}
.vc-drawer{width:var(--vc-dw)}
.vc-tab{transition:left .3s cubic-bezier(.2,.8,.2,1),right .3s cubic-bezier(.2,.8,.2,1),color .2s,background .2s,opacity .2s}
.vc[data-open=regions] .vc-tab-l{left:min(calc(var(--vc-gap) + var(--vc-dw) - 1px),calc(100% - 40px));z-index:9}
.vc[data-open=activity] .vc-tab-r{right:min(calc(var(--vc-gap) + var(--vc-dw) - 1px),calc(100% - 40px));z-index:9}
.vc-tab .tx{display:none}
.vc-tab.on .tic.tx{display:block}
.vc-tab.on :is(.tic:not(.tx),.dot,em){display:none}
.vc-dh{padding:14px 16px 4px}
.vc-sub{font-size:12.5px;color:var(--muted,#8b98ad)}
.vc-ag{min-height:40px;padding:4px 10px 4px 8px;gap:10px}
.vc-ag+.vc-ag{margin-top:0}
.vc-ag:hover{background:var(--vc-tint)}
.vc-ag.on{background:none}
.vc-ag b{font-size:13px;font-weight:500}
.vc-ag small{font-size:11.5px}
.vc-ag.on time{color:var(--ok,#4ade80)}
@media (prefers-reduced-motion:reduce){.vc-tab{transition:none}}

.vc-bar{position:absolute;z-index:7;top:var(--vc-gap);left:calc(var(--vc-gap) + 52px);right:calc(var(--vc-gap) + 52px);display:flex;flex-direction:row;align-items:flex-start;justify-content:center;
  pointer-events:none;transition:left .3s cubic-bezier(.2,.8,.2,1),right .3s cubic-bezier(.2,.8,.2,1),opacity .2s;translate:none}
.vc-bar>*{pointer-events:auto}
.vc[data-open=regions] .vc-bar{left:calc(var(--vc-gap) + var(--vc-dw) + 52px);opacity:1;translate:none;pointer-events:none}
.vc[data-open=activity] .vc-bar{right:calc(var(--vc-gap) + var(--vc-dw) + 52px)}
.vc-barin{position:relative;display:flex;align-items:center;gap:4px;height:48px;max-width:100%;padding:4px;box-sizing:border-box;border-radius:999px;
  background:var(--vc-solid);border:1px solid var(--line-strong,var(--vc-ctl-line));box-shadow:0 8px 28px -12px rgba(0,0,0,.55),0 1px 2px rgba(0,0,0,.12)}
:root[data-theme=light] .vc-barin{background:#fff;border-color:rgba(15,23,42,.12);box-shadow:0 8px 24px -12px rgba(15,23,42,.28),0 1px 2px rgba(15,23,42,.06)}
.vc-bar .vc-modes button{width:96px;padding:0;justify-content:center}
.vc-bar .vc-modes{display:flex;flex-direction:row;width:auto;height:100%;padding:0;gap:2px;background:none;border:0}
.vc-bar .vc-modes button{flex:none;height:100%;padding:0 14px;border-radius:999px;border:0}
.vc-bar .vc-modes button.on{background:var(--vc-thumb);box-shadow:inset 0 0 0 1px var(--vc-ctl-line)}
.vc-sep{flex:none;width:1px;height:20px;background:var(--vc-ctl-line);margin:0 4px}
.vc-bar .vc-search{flex:none;width:280px;height:100%;padding:0 12px;border:0;border-radius:999px;background:color-mix(in srgb,var(--fg,#e6e9ef) 5%,transparent)}
.vc-bar .vc-search:focus-within{background:color-mix(in srgb,var(--fg,#e6e9ef) 8%,transparent);border:0}
.vc-bar .vc-search kbd{display:inline;height:auto;min-width:0;border:0;background:none;box-shadow:none;font:500 11.5px/1 var(--font);color:var(--muted,#8b98ad);padding:0}
.vc-x{all:unset;box-sizing:border-box;cursor:pointer;flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;color:var(--muted,#8b98ad)}
.vc-x[hidden]{display:none}
.vc-x:hover{color:var(--fg,#e6e9ef);background:var(--vc-tint)}
.vc-x svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.vc-search:has(.vc-x:not([hidden])) kbd{display:none}
.vc-bar .vc-tr{position:static;display:flex;flex-direction:row;height:100%;padding:0;gap:2px;background:none;border:0}
.vc-bar .vc-tr .vc-b{width:40px;height:100%}
.vc-bar .vc-panel{position:absolute;top:calc(100% + 8px);right:0;left:auto;width:300px;max-height:calc(100vh - 220px);transform-origin:top right}
.vc-dock{right:var(--vc-gap);bottom:var(--vc-gap);display:flex;flex-direction:column;align-items:stretch;gap:0;padding:8px;border-radius:16px;
  background:var(--vc-ctl);border:1px solid var(--vc-ctl-line);pointer-events:auto}
.vc-nav-top{display:flex;align-items:center;gap:8px;padding-bottom:8px;margin-bottom:6px;border-bottom:1px solid var(--vc-ctl-line)}
.vc-nav-top:not(:has(>:not(.vc-hide))){display:none}
.vc-nav-top:has(>.vc-mini.vc-hide){justify-content:center}
.vc-dock .vc-mini{position:relative;left:auto;bottom:auto;width:156px;height:100px;border-radius:10px;overflow:hidden;background:color-mix(in srgb,var(--fg,#e6e9ef) 4%,transparent);border:0}
.vc-dock .vc-globe{position:relative;flex:none;width:100px;height:100px;border-radius:50%;background:color-mix(in srgb,var(--fg,#e6e9ef) 4%,transparent);border:0}
.vc-dock .vc-globe canvas{left:22px;top:22px;width:56px;height:56px}
.vc-dock .vc-globe [data-g=u]{left:36px;top:0}
.vc-dock .vc-globe [data-g=d]{left:36px;bottom:0}
.vc-dock .vc-globe [data-g=l]{left:0;top:36px}
.vc-dock .vc-globe [data-g=r]{right:0;top:36px}
.vc-dock .vc-globe [data-g=h]{left:31px;top:31px}
.vc-dock{min-width:184px;box-sizing:border-box}
.vc-dock .vc-zoom{display:flex;flex-direction:row;justify-content:space-between;height:36px;padding:0;gap:2px;background:none;border:0}
.vc-dock .vc-zoom .vc-b{flex:1;width:auto;height:100%;border-radius:10px}
.cv .vc-dock{bottom:var(--vc-gap)}
@media (max-width:1100px){
  .vc-bar .vc-modes button{width:44px;min-width:0;padding:0}
  .vc-bar .vc-modes button span{display:none}
  .vc-bar .vc-search{width:clamp(180px,30vw,280px)}
  .vc-dock .vc-mini{width:120px;height:84px}
  .vc-dock .vc-globe{width:84px;height:84px}
  .vc-dock .vc-globe canvas{left:18px;top:18px;width:48px;height:48px}
  .vc-dock .vc-globe [data-g=u]{left:28px}.vc-dock .vc-globe [data-g=d]{left:28px}
  .vc-dock .vc-globe [data-g=l]{top:28px}.vc-dock .vc-globe [data-g=r]{top:28px}
  .vc-dock .vc-globe [data-g=h]{left:23px;top:23px}
}
@media (max-width:760px){
  .vc-bar{left:var(--vc-gap);right:var(--vc-gap);justify-content:stretch}
  .vc-barin{width:100%;height:48px}
  .vc-bar .vc-modes,.vc-bar .vc-tr{flex-direction:row;width:auto;height:100%}
  .vc-bar .vc-modes button{width:44px;padding:0;justify-content:center}
  .vc-bar .vc-search{flex:none;width:40px;padding:0;justify-content:center;background:none;margin-left:auto}
  .vc-bar .vc-search.open{margin-left:0;flex:1 1 auto;width:auto;padding:0 12px;justify-content:flex-start;background:color-mix(in srgb,var(--fg,#e6e9ef) 6%,transparent)}
  .vc-bar:has(.vc-search.open) :is(.vc-modes,.vc-sep){display:none}
  .vc-bar .vc-tr{top:auto}
  .vc-bar .vc-tr .vc-b{height:100%;width:40px}
  .vc-bar .vc-panel{left:0;right:0;width:auto;max-height:calc(100vh - 260px)}
  .vc[data-open=regions] .vc-bar,.vc[data-open=activity] .vc-bar{opacity:0;pointer-events:none}
  .vc[data-open=regions] .vc-bar>*,.vc[data-open=activity] .vc-bar>*{pointer-events:none}
  .vc-dock{padding:4px;border-radius:999px;min-width:0}
  .vc-dock .vc-zoom{flex-direction:column;height:auto;width:40px}
  .vc-dock .vc-zoom .vc-b{flex:none;height:40px;width:40px;border-radius:999px}
  .vc-sheet .vc-mini{width:100%;height:120px;border-radius:12px;background:color-mix(in srgb,var(--fg,#e6e9ef) 4%,transparent)}
  .vc-sheet .vc-globe{width:120px;height:120px;background:color-mix(in srgb,var(--fg,#e6e9ef) 4%,transparent)}
}

/* The filter panel drops over the canvas's own tool rail, not under it. */
.vc-bar:has(.vc-panel:not([hidden])){z-index:35}

/* visibility, not just opacity: it also blocks taps on children that re-enable pointer events. */
.vc-clean :is(.vc>:not(.vc-ec):not(.vc-unclean),.cv-ui,.nc,.mf,.brain-foot){opacity:0 !important;visibility:hidden !important;transition:opacity .25s,visibility 0s .25s}
#app:has(.vc-clean) .tabbar{opacity:0;visibility:hidden;transition:opacity .25s,visibility 0s .25s}
.vc-unclean{all:unset;box-sizing:border-box;cursor:pointer;position:absolute;z-index:45;left:50%;bottom:calc(var(--vc-gap) + env(safe-area-inset-bottom));translate:-50% 12px;
  display:flex;align-items:center;gap:8px;height:36px;padding:0 14px 0 12px;border-radius:999px;font-size:12.5px;font-weight:600;
  color:var(--text-2,#a3afc2);background:var(--vc-solid);border:1px solid var(--vc-ctl-line);opacity:0;pointer-events:none;
  transition:opacity .25s,translate .3s cubic-bezier(.2,.8,.2,1),color .15s}
.vc-unclean svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.vc-clean .vc-unclean{opacity:.72;pointer-events:auto;translate:-50% 0}
.vc-clean .vc-unclean:hover,.vc-clean .vc-unclean:focus-visible{opacity:1;color:var(--fg,#e6e9ef)}
.vc-unclean:focus-visible{outline:2px solid var(--accent,#5eead4);outline-offset:2px}
@media (max-width:760px){.vc-unclean{bottom:calc(16px + env(safe-area-inset-bottom))}}
@media (prefers-reduced-motion:reduce){.vc-unclean,.vc-clean :is(.vc>*,.cv-ui){transition:none}}
`;

export class ViewChrome {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  readonly panel: HTMLElement;
  readonly miniCanvas: HTMLCanvasElement;
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
    // The sheet has its own scrim.
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
    o.root.classList.remove('vc-clean');
    const el = document.createElement('div');
    el.className = 'vc';
    el.innerHTML = this.template();
    o.root.appendChild(el);
    this.el = el;
    this.input = this.q<HTMLInputElement>('.vc-search input');
    const x = this.q<HTMLButtonElement>('.vc-x');
    const syncX = (): void => {
      x.hidden = !this.input.value;
    };
    this.input.addEventListener('input', syncX);
    x.onmousedown = (e) => e.preventDefault();
    x.onclick = () => {
      this.input.value = '';
      this.finder?.clear();
      this.finder?.input();
      syncX();
      this.input.focus();
    };
    this.panel = this.q('.vc-panel');
    this.miniCanvas = this.q<HTMLCanvasElement>('.vc-mini canvas');
    this.globe = this.q<HTMLCanvasElement>('.vc-globe canvas');
    this.wire();
    this.el.querySelectorAll<HTMLElement>('.vc-fade').forEach((f) => fadeScroll(f));
    this.place();
    this.refreshRegions();
    this.markActive();
    this.drawGlobe();
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('resize', this.onResize);
    this.unsubAgents = onAgents(() => this.paintAgents());
    // Every second, like the header pill, so counts and relative times stay current.
    this.agentTimer = window.setInterval(() => !document.hidden && this.paintAgents(), 1000);
  }

  private template(): string {
    const o = this.o;
    const modes = PAGES.map(
      ([p, label, svg, desc]) =>
        `<button type="button" data-page="${p}" aria-label="${attr(desc)}" title="${attr(desc)}" aria-pressed="${p === o.page}">${svg}<span aria-hidden="true">${label}</span></button>`,
    ).join('');
    return `
<div class="vc-tl vc-bar">
  <div class="vc-p vc-barin">
  <nav class="vc-modes" aria-label="View">${modes}</nav>
  <span class="vc-sep" aria-hidden="true"></span>
  <label class="vc-search">${I.search}<input type="search" placeholder="${attr(o.search.placeholder)}" aria-label="${attr(o.search.placeholder)}" autocomplete="off" spellcheck="false"><em></em><button type="button" class="vc-x" title="Clear the search" aria-label="Clear the search" hidden>${I.close}</button><kbd>/</kbd></label>
  <span class="vc-sep" aria-hidden="true"></span>
  <div class="vc-tr">
  <button type="button" class="vc-b vc-reset" data-reset title="Reset this view to its defaults" aria-label="Reset this view to its defaults">${I.reset}</button>
  <button type="button" class="vc-b" data-vc="filter" aria-expanded="false" title="Filter and display" aria-label="Filter and display">${I.filter}<b class="vc-badge"></b></button>
</div>
    <aside class="vc-p vc-ovl vc-panel" hidden aria-label="Filter and display">
  <div class="vc-ph"><h3>Filter and display</h3><button type="button" class="vc-b" data-close title="Close" aria-label="Close">${I.close}</button></div>
  <div class="vc-pb vc-fade"></div>
</aside>
  </div>

</div>

<button type="button" class="vc-tab vc-tab-l" data-open="regions" aria-expanded="false" aria-label="Folders: show or hide them" title="Folders: show or hide them">${I.layers}<svg class="tic tx" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg><span>Folders</span><em data-rn></em></button>
<aside class="vc-drawer vc-ovl vc-drawer-l" data-d="regions" aria-label="Folders">
  <div class="vc-dh"><h3>Folders <em data-rn></em></h3></div>
  <div class="vc-bulk"><button type="button" data-all="show">Show all</button><button type="button" data-all="hide">Hide all</button></div>
  <div class="vc-db vc-fade vc-rl"></div>
</aside>

<button type="button" class="vc-tab vc-tab-r" data-open="activity" aria-expanded="false" aria-label="Agent activity" title="Agent activity"><i class="dot"></i>${I.pulse}<svg class="tic tx" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg><span>Activity</span><em data-an></em></button>
<aside class="vc-drawer vc-ovl vc-drawer-r" data-d="activity" aria-label="Agent activity">
  <div class="vc-dh"><h3>Activity <em data-an></em></h3></div>
  <div class="vc-bulk vc-sub">Agents and what they did last</div>
  <div class="vc-db vc-fade vc-al"></div>
</aside>

<div class="vc-dock">
  <div class="vc-nav-top"><div class="vc-mini" title="Minimap: click or drag to move the view"><canvas></canvas></div>
  <div class="vc-globe" role="group" aria-label="Turn the view">
    <canvas></canvas>
    <button type="button" data-g="u" title="Up" aria-label="Up">${I.up}</button>
    <button type="button" data-g="l" title="Left" aria-label="Left">${I.up}</button>
    <button type="button" data-g="r" title="Right" aria-label="Right">${I.up}</button>
    <button type="button" data-g="d" title="Down" aria-label="Down">${I.up}</button>
    <button type="button" data-g="h" title="Default view" aria-label="Default view">${I.home}</button>
  </div></div>
  <div class="vc-zoom">
    <button type="button" class="vc-b vc-padbtn" data-open="sheet" title="Controller" aria-label="Controller">${I.pad}</button>
    <button type="button" class="vc-b" data-z="in" title="Zoom in (+)" aria-label="Zoom in">${I.plus}</button>
    <button type="button" class="vc-b" data-z="out" title="Zoom out (-)" aria-label="Zoom out">${I.minus}</button>
    <button type="button" class="vc-b" data-z="fit" title="Fit to screen" aria-label="Fit to screen">${I.fit}</button>
    <button type="button" class="vc-b" data-z="full" title="Full screen" aria-label="Full screen">${I.full}</button>
    <button type="button" class="vc-b" data-z="clean" title="Clean view: hide the controls (C)" aria-label="Clean view">${I.eyeOff}</button>
  </div>
</div>
<button type="button" class="vc-unclean" title="Show the controls (C or Esc)">${I.eye}<span>Show controls</span></button>

<div class="vc-ec" hidden></div>
<div class="vc-scrim"></div>
<section class="vc-sheet vc-ovl" aria-label="Controller">
  <div class="vc-grab"></div>
  <div class="vc-sh"><h3>Controller</h3><button type="button" class="vc-b" data-close title="Close" aria-label="Close">${I.close}</button></div>
  <div class="vc-sgrid"><div data-slot="globe"></div><div data-slot="mini"></div></div>
  <div data-slot="labels"></div>
</section>`;
  }

  private place(): void {
    const globe = this.q('.vc-globe');
    const mini = this.q('.vc-mini');
    if (this.phone) {
      this.q('[data-slot=globe]').appendChild(globe);
      this.q('[data-slot=mini]').appendChild(mini);
    } else {
      this.q('.vc-nav-top').append(mini, globe);
    }
    this.applyPrefs();
  }

  setEmpty(on: boolean): void {
    this.el.classList.toggle('vc-is-empty', on);
    const box = this.q('.vc-ec');
    if (box.hidden === !on) return;
    box.hidden = !on;
    if (!on) {
      box.replaceChildren();
      return;
    }
    const c = EMPTY[this.o.page];
    const mark = PAGES.find((p) => p[0] === this.o.page)?.[2] || '';
    box.innerHTML = `<div class="vc-ec-card" role="status"><span class="vc-ec-ic" aria-hidden="true">${mark}</span><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p>
      <div class="vc-ec-acts"><button type="button" class="btn primary" data-ec="setup">Open the guide</button><button type="button" class="btn" data-ec="new">${I.plus}New note</button></div></div>`;
    // The setup guide lives on the Overview while the vault is empty.
    box.querySelector<HTMLElement>('[data-ec=setup]')!.onclick = () => hooks.go('home');
    box.querySelector<HTMLElement>('[data-ec=new]')!.onclick = () => hooks.openNewNote();
  }

  /** Graph and Canvas live for the session. */
  shown(): void {
    this.markActive();
  }

  private markActive(): void {
    const page = this.o.page;
    this.el.querySelectorAll<HTMLElement>('.vc-modes button').forEach((b) => {
      b.classList.toggle('on', b.dataset.page === page);
      b.setAttribute('aria-pressed', String(b.dataset.page === page));
    });
  }

  private show(which: Overlay): void {
    if (this.open === which) return;
    this.close();
    this.open = which;
    this.el.dataset.open = which;
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
      this.o.root.classList.add('vc-sheet-open');
      this.renderSheetLabels();
      requestAnimationFrame(() => this.redrawMini());
    } else if (which === 'search') {
      this.q('.vc-search').classList.add('open');
      this.sizeSearch();
      this.input.focus();
    }
  }

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

  private sizeSearch(): void {
    this.q('.vc-search').style.width = '';
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
          // Graph and Canvas chromes stay alive.
          this.markActive();
        }, reduced ? 0 : 140);
      };
    });

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
        else if (e.key === 'Escape' && this.clean) this.setClean(false);
      },
      { signal: this.off.signal },
    );
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key.toLowerCase() !== 'c' || e.ctrlKey || e.metaKey || e.altKey || !this.el.isConnected) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (document.querySelector('[aria-modal=true], dialog[open]')) return;
        e.preventDefault();
        this.setClean(!this.clean);
      },
      { signal: this.off.signal },
    );
    this.q('.vc-unclean').onclick = () => this.setClean(false);

    this.el.querySelectorAll<HTMLElement>('[data-z]').forEach((b) => {
      b.onclick = () => {
        const z = b.dataset.z;
        if (z === 'in') o.nav.zoom(1.4);
        else if (z === 'out') o.nav.zoom(1 / 1.4);
        else if (z === 'fit') o.nav.fit();
        else if (z === 'clean') this.setClean(true);
        else this.toggleFullscreen();
      };
    });
    document.addEventListener('fullscreenchange', this.onFs);

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
    for (const p of this.el.querySelectorAll<HTMLElement>('.vc-p,.vc-tab,.vc-drawer,.vc-sheet,.vc-scrim')) {
      p.addEventListener('pointerdown', (e) => e.stopPropagation());
      p.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      p.addEventListener('dblclick', (e) => e.stopPropagation());
    }
  }

  renderPanel(): void {
    if (this.open !== 'filter') return;
    const p = this.q('.vc-pb');
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
      `<h4>Background</h4>` +
      this.dotsHTML() +
      `<div data-own></div>`;
    p.querySelectorAll<HTMLElement>('[data-t^=vc-]').forEach((b) => (b.onclick = () => this.toggleShared(b.dataset.t || '')));
    this.o.filter(p.querySelector('[data-own]') as HTMLElement);
    wireHelp(p);
    p.scrollTop = top;
  }

  private dotsHTML(): string {
    return toggleHTML('vc-dots', 'Dot grid', dotsOn(), 'The dots behind 3D, Graph and Canvas. Turn them off for a clean, plain background.');
  }

  private labelsHTML(): string {
    const lab = this.o.labels.get();
    return (
      toggleHTML('vc-lab-nodes', 'Note labels', lab.nodes, this.o.labels.help.nodes) +
      toggleHTML('vc-lab-folders', 'Folder labels', lab.folders, this.o.labels.help.folders)
    );
  }

  private toggleShared(t: string): void {
    if (t === 'vc-dots') setDots(!dotsOn());
    else if (t === 'vc-lab-nodes' || t === 'vc-lab-folders') {
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

  private renderSheetLabels(): void {
    if (this.open !== 'sheet') return;
    const host = this.q('[data-slot=labels]');
    host.innerHTML = '<h4>Labels</h4>' + this.labelsHTML() + '<h4>Background</h4>' + this.dotsHTML();
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

  private paintAgents(): void {
    const now = Date.now();
    const busy = (a: AgentInfo): boolean => (a.open > 0 && now - a.lastAt < 120_000) || now - a.lastAt < 5_000;
    const list = agentList();
    const live = activeAgents();
    const tab = this.q('.vc-tab-r');
    tab.classList.toggle('live', live.length > 0);
    this.el.querySelectorAll('[data-an]').forEach((e) => (e.textContent = String(live.length)));
    tab.title = live.length ? `${live.length} agent${live.length === 1 ? '' : 's'} working now` : 'Agent activity';
    if (this.open !== 'activity') return;
    const host = this.q('.vc-al');
    host.innerHTML = list.length
      ? list
          .slice(0, 30)
          .map((a) => {
            const on = busy(a);
            const what = a.lastLabel || a.lastAction || (a.kind === 'user' ? 'in the app' : 'connected');
            return `<div class="vc-ag${on ? ' on' : ''}" style="--ag:var(--accent)">${avatarHTML(a.actor, 24, on ? 'live' : '', a.id)}<div class="m"><b>${esc(a.actor)}</b><small>${esc(
              what,
            )}</small></div><time>${on ? 'now' : esc(ago(Math.floor(a.lastAt / 1000)))}</time></div>`;
          })
          .join('')
      : '<div class="vc-empty">No agent activity yet. Agents show up here the moment they read or write your memory.</div>';
  }

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

  // Read from the DOM: the map host outlives this chrome when the view is rebuilt.
  private get clean(): boolean {
    return this.o.root.classList.contains('vc-clean');
  }

  setClean(on: boolean): void {
    if (on) this.close();
    this.o.root.classList.toggle('vc-clean', on);
    const u = this.q<HTMLElement>('.vc-unclean');
    if (on) window.setTimeout(() => this.clean && u.focus({ preventScroll: true }), 220);
  }

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

  focusSearch(): void {
    if (compactSearch()) this.show('search');
    this.input.focus();
    this.input.select();
  }

  setQuery(q: string): void {
    if (compactSearch()) this.show('search');
    this.input.value = q;
    this.q<HTMLButtonElement>('.vc-x').hidden = !q;
    this.input.focus();
    this.finder?.input();
  }

  destroy(): void {
    this.o.root.classList.remove('vc-clean');
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

export function helpHTML(text: string): string {
  return text ? `<b class="vc-q" tabindex="0" role="img" aria-label="${attr(text)}" data-help="${attr(text)}">?</b>` : '';
}

export function toggleHTML(key: string, label: string, on: boolean, help = ''): string {
  return `<button type="button" class="vc-tg${on ? ' on' : ''}" data-t="${attr(key)}" role="switch" aria-checked="${on}"><span>${helpHTML(help)}${esc(label)}</span><i></i></button>`;
}

export function sliderHTML(key: string, label: string, min: number, max: number, step: number, value: number, help = ''): string {
  return `<label class="vc-sl"><span>${helpHTML(help)}${esc(label)}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-s="${attr(key)}"></label>`;
}

let helpTip: HTMLElement | null = null;
const scrollWired = new WeakSet<HTMLElement>();

function hideHelp(): void {
  helpTip?.remove();
  helpTip = null;
}

/** A floating tip, so a scrolling panel cannot clip it. */
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
