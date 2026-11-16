// The floating Mnemo button: a shortcut to the one Mnemo page, wherever you are. It opens the
// chat you were in with the note or folder you are on ready to attach. Ctrl/⌘ J does the same.

import { el, useStyles } from '../dom';
import { hooks } from '../hooks';
import { onNavigate } from '../router';
import { state } from '../state';
import { notify } from '../toast';
import { icon } from '../ui/icons';
import { prefs as vaultPrefs } from '../vault/store';
import * as A from './api';
import { leaveMnemo, openOnPage } from './page';
import { MNEMO_CSS } from './styles';

let dock: HTMLElement | null = null;
let fab: HTMLButtonElement | null = null;
let zone: HTMLElement | null = null;
/** The note or folder you are on, offered as an attachment when Mnemo opens. */
function contextScope(): string {
  if (state.page === 'vault' && state.note) return 'note:' + state.note;
  if (state.page === 'vault' && vaultPrefs.folder) return 'folder:' + vaultPrefs.folder;
  return 'global';
}

function enabled(): boolean {
  return A.mnemoState()?.prefs.launcher !== false;
}

// ---- where the button sits, per device (a convenience, so browser storage) ----

const LS_FAB = 'memora.mnemo.fab.v1';
interface FabPlace {
  side?: 'left' | 'right';
  /** Distance from the bottom of the window, px. */
  bottom?: number;
  hidden?: boolean;
}
const SIZE = 52;
const EDGE = 22;

function readPlace(): FabPlace {
  try {
    return JSON.parse(localStorage.getItem(LS_FAB) || '{}') as FabPlace;
  } catch {
    return {};
  }
}
let place: FabPlace = readPlace();

function savePlace(): void {
  try {
    localStorage.setItem(LS_FAB, JSON.stringify(place));
  } catch {
    /* storage blocked: the place lasts until reload */
  }
}

const isPhone = (): boolean => window.matchMedia('(max-width: 760px)').matches;

/** Lowest the button may sit: above the phone tab bar, else near the edge. */
function minBottom(): number {
  const bar = document.getElementById('tabbar');
  const r = bar?.getBoundingClientRect();
  if (r && r.height > 0 && r.top < window.innerHeight && getComputedStyle(bar!).display !== 'none') {
    return Math.max(16, window.innerHeight - r.top + 10);
  }
  return 16;
}

function size(): number {
  return dock?.offsetWidth || SIZE;
}

/** Put the button where it was left (or the default corner) and keep it on screen. */
function applyPlace(animate = false): void {
  if (!dock) return;
  const onMap = ['brain', 'graph', 'canvas'].includes(state.page);
  // On phone maps the zoom controls own the right edge: the default moves left.
  const side = place.side ?? (isPhone() && onMap ? 'left' : 'right');
  dock.classList.toggle('left', side === 'left');
  dock.classList.toggle('snap', animate);
  if (place.bottom === undefined && place.side === undefined) {
    dock.style.left = dock.style.top = '';
    if (side === 'left') {
      dock.style.left = EDGE + 'px';
    }
    return;
  }
  const w = size();
  const lo = minBottom();
  const hi = Math.max(lo, window.innerHeight - w - 72);
  const bottom = Math.min(hi, Math.max(lo, place.bottom ?? lo));
  const edge = isPhone() ? 14 : EDGE;
  dock.style.left = (side === 'left' ? edge : window.innerWidth - w - edge) + 'px';
  dock.style.top = window.innerHeight - bottom - w + 'px';
}

function paintVisible(): void {
  if (!dock) return;
  const hide = state.page === 'assistant' || !enabled() || !!place.hidden;
  dock.hidden = hide;
  if (!hide) applyPlace();
}

/** Hide or show the button on this device (the menu and the palette bring it back). */
export function setFabHidden(hidden: boolean, undo = true): void {
  place.hidden = hidden;
  savePlace();
  paintVisible();
  if (hidden && undo) {
    notify(`${A.MNEMO} button hidden. Bring it back from More, Show the ${A.MNEMO} button.`, 'info', 6000, {
      label: 'Undo',
      run: () => setFabHidden(false, false),
    });
  }
}

export function fabHidden(): boolean {
  return !!place.hidden;
}

/** Drag the button anywhere along either edge; drop it on the X to hide it. */
function wireDrag(): void {
  if (!fab || !dock || !zone) return;
  let start: { x: number; y: number; ox: number; oy: number } | null = null;
  let dragging = false;
  let suppress = false;
  const overZone = (x: number, y: number): boolean => {
    const r = zone!.getBoundingClientRect();
    return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) < 64;
  };
  fab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = dock!.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top };
    dragging = false;
  });
  fab.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 7) return;
      dragging = true;
      fab!.setPointerCapture(e.pointerId);
      dock!.classList.add('drag');
      dock!.classList.remove('snap');
      zone!.hidden = false;
      zone!.style.bottom = minBottom() + 8 + 'px';
      requestAnimationFrame(() => zone!.classList.add('in'));
    }
    const w = size();
    const x = Math.min(window.innerWidth - w, Math.max(0, e.clientX - start.ox));
    const y = Math.min(window.innerHeight - w, Math.max(0, e.clientY - start.oy));
    dock!.style.left = x + 'px';
    dock!.style.top = y + 'px';
    const hot = overZone(e.clientX, e.clientY);
    zone!.classList.toggle('hot', hot);
    dock!.classList.toggle('doomed', hot);
  });
  const end = (e: PointerEvent): void => {
    if (!start) return;
    const was = dragging;
    start = null;
    dragging = false;
    if (!was) return;
    suppress = true;
    dock!.classList.remove('drag', 'doomed');
    zone!.classList.remove('in', 'hot');
    window.setTimeout(() => (zone!.hidden = true), 200);
    if (overZone(e.clientX, e.clientY)) {
      // Back to its place, hidden; the place is kept for when it returns.
      setFabHidden(true);
      return;
    }
    const r = dock!.getBoundingClientRect();
    place.side = r.left + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
    place.bottom = Math.round(window.innerHeight - r.bottom);
    savePlace();
    applyPlace(true);
  };
  fab.addEventListener('pointerup', end);
  fab.addEventListener('pointercancel', end);
  fab.addEventListener(
    'click',
    (e) => {
      if (suppress) {
        suppress = false;
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );
  window.addEventListener('resize', () => {
    if (!dock?.hidden) applyPlace();
  });
}

export function initMnemoLauncher(): void {
  useStyles('mnemo-css', MNEMO_CSS);
  useStyles('mnemo-float-css', CSS);
  dock = el('div', 'mnf-dock');
  dock.hidden = true;
  fab = el('button', 'mnf-fab') as HTMLButtonElement;
  fab.type = 'button';
  fab.setAttribute('aria-label', `Ask ${A.MNEMO}`);
  fab.title = `Ask ${A.MNEMO} (Ctrl+J). Drag to move it.`;
  fab.innerHTML = `<span class="mnf-glyph">${icon('mnemo')}</span><span class="mnf-tip">Ask ${A.MNEMO}<small>drag to move</small></span>`;
  fab.onclick = () => go(contextScope(), undefined, true);
  const hideBtn = el('button', 'mnf-hide', icon('close')) as HTMLButtonElement;
  hideBtn.type = 'button';
  hideBtn.title = `Hide the ${A.MNEMO} button`;
  hideBtn.setAttribute('aria-label', `Hide the ${A.MNEMO} button`);
  hideBtn.onclick = (e) => {
    e.stopPropagation();
    setFabHidden(true);
  };
  dock.append(fab, hideBtn);
  zone = el('div', 'mnf-zone', `${icon('close')}<span>Drop here to hide</span>`);
  zone.hidden = true;

  document.body.append(zone, dock);
  wireDrag();

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      if (state.page === 'assistant') leaveMnemo();
      else go(contextScope(), undefined, true);
    }
  });
  onNavigate(() => paintVisible());
  A.onState(() => paintVisible());
  void A.loadState()
    .then(() => paintVisible())
    .catch(() => paintVisible());
  hooks.askMnemo = (scope: string, text?: string) => askMnemo(scope, text);
  // One answer to "is the button showing here?": switched on for the server AND not hidden on
  // this device. Showing it fixes whichever of the two was hiding it.
  hooks.mnemoButton = (show?: boolean) => {
    if (show === true && !enabled()) void A.savePrefs({ launcher: true }).catch(() => {});
    if (show !== undefined) setFabHidden(!show, false);
    return enabled() && !place.hidden;
  };
}

/** The Mnemo page with a new chat (or the one given) and `scope` ready to attach. */
function go(scope: string, text?: string, fresh = false): void {
  openOnPage(fresh ? '' : null, { scope, text });
  hooks.go('assistant');
}

/** "Ask Mnemo" on a note or folder: a new chat about it, on the Mnemo page. */
export function askMnemo(scope: string, text?: string): void {
  go(scope, text, true);
}

const CSS = `
.mnf-dock{position:fixed;right:22px;bottom:22px;z-index:70;width:52px;height:52px;touch-action:none}
.mnf-dock[hidden]{display:none}
.mnf-dock.snap{transition:left .35s cubic-bezier(.2,.9,.25,1.15),top .3s var(--ease-out,ease-out)}
.mnf-dock.drag .mnf-fab{transform:scale(1.08);cursor:grabbing;box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 18px 40px -10px rgba(79,70,229,.6)}
.mnf-dock.drag .mnf-tip,.mnf-dock.drag .mnf-hide{display:none}
.mnf-dock.doomed .mnf-fab{transform:scale(.82);opacity:.6}
.mnf-hide{position:absolute;top:-5px;right:-5px;z-index:1;display:grid;place-items:center;width:22px;height:22px;padding:0;border-radius:50%;cursor:pointer;
  color:var(--fg);background:var(--surface-0,var(--bg));border:1px solid var(--line-strong);box-shadow:0 2px 6px rgba(15,23,42,.18);opacity:0;transform:scale(.7);
  transition:opacity .15s,transform .18s var(--ease-out,ease-out)}
.mnf-hide .i{width:12px;height:12px;stroke-width:2.4}
.mnf-hide:hover{color:var(--danger)}
@media (hover:hover){.mnf-dock:hover .mnf-hide,.mnf-hide:focus-visible{opacity:1;transform:none}}
.mnf-dock.left .mnf-tip{right:auto;left:calc(100% + 10px);transform:translate(-6px,-50%)}
.mnf-dock.left .mnf-fab:hover .mnf-tip{transform:translate(0,-50%)}
.mnf-tip small{display:block;font-size:11px;font-weight:450;color:var(--muted);margin-top:1px}
.mnf-zone{position:fixed;left:50%;bottom:24px;z-index:69;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;
  transform:translate(-50%,16px);opacity:0;transition:opacity .18s,transform .22s var(--ease-out,ease-out)}
.mnf-zone[hidden]{display:none}
.mnf-zone.in{opacity:1;transform:translate(-50%,0)}
.mnf-zone .i{width:56px;height:56px;padding:16px;border-radius:50%;box-sizing:border-box;color:#fff;background:rgba(15,23,42,.72);stroke-width:2.2;
  box-shadow:0 10px 30px -8px rgba(15,23,42,.45);transition:transform .18s var(--ease-out,ease-out),background .15s}
.mnf-zone span{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:550;color:#fff;background:rgba(15,23,42,.72)}
.mnf-zone.hot .i{transform:scale(1.18);background:var(--danger,#e11d48)}
.mnf-fab{position:absolute;inset:0;display:grid;place-items:center;width:52px;height:52px;padding:0;border:0;border-radius:50%;cursor:pointer;color:#fff;
  background:linear-gradient(145deg,#5eead4 0%,#14b8a6 32%,#4f46e5 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 10px 28px -8px rgba(79,70,229,.55),0 4px 12px -4px rgba(20,184,166,.5);
  transition:transform .25s var(--ease-out,ease-out),box-shadow .25s}
.mnf-fab:hover{transform:translateY(-2px) scale(1.03);box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 14px 34px -8px rgba(79,70,229,.6),0 6px 16px -4px rgba(20,184,166,.55)}
.mnf-fab:active{transform:scale(.96)}
.mnf-fab:focus-visible{outline:3px solid var(--accent-soft);outline-offset:3px}
.mnf-fab .i{width:24px;height:24px;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.mnf-glyph{position:absolute;inset:0;display:grid;place-items:center;transition:opacity .2s,transform .3s var(--ease-out,ease-out)}
.mnf-tip{position:absolute;right:calc(100% + 10px);top:50%;transform:translate(6px,-50%);padding:6px 10px;border-radius:9px;white-space:nowrap;pointer-events:none;
  font-size:12.5px;font-weight:550;color:var(--fg);background:var(--ovl-bg,var(--surface-0));border:1px solid var(--line-strong);opacity:0;transition:opacity .15s,transform .2s}
.mnf-fab:hover .mnf-tip{opacity:1;transform:translate(0,-50%)}
@media (max-width:760px){
  .mnf-dock{right:14px;bottom:calc(var(--dock-space,76px) + 6px);width:48px;height:48px}
  .mnf-tip{display:none}
}
`;
