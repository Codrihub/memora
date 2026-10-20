// Pointer drag and drop for the vault tree: press and hold an item, carry it,
// release it on a place. Works the same with a mouse, a pen and a finger
// (a finger holds still for a moment first, so a swipe still scrolls).
//
// The pure helpers at the top (drop verdicts, auto-scroll speed, indent cap)
// hold the rules; `pressDrag` runs one gesture: the ghost that follows the
// pointer, the hover hint, opening a folder held over, scrolling near the
// edges, Escape to cancel. What a place means is up to the caller (tree.ts).

import { esc } from '../dom';
import { baseName, dirOf, isInside } from './store';
import type { DragPayload } from './nav';

// ---------------------------------------------------------------------------
// Rules (pure, no DOM)
// ---------------------------------------------------------------------------

/** Where a drag is over. */
export type DropTarget =
  | { kind: 'folder'; path: string }
  | { kind: 'note'; path: string }
  | { kind: 'root' }
  | { kind: 'pins'; index: number };

export interface DropVerdict {
  ok: boolean;
  /** Destination folder of a move ('' = top level); unused for pins. */
  dest: string;
  /** Short hover hint: "Move into Projects", "Already in Projects", ... */
  hint: string;
}

/** True when `path` is `folder` itself or lies anywhere below it. */
export function isSelfOrBelow(path: string, folder: string): boolean {
  return folder !== '' && isInside(path, folder);
}

/** A folder's display name in hints ('' = the top level). */
export function placeName(folder: string): string {
  return folder === '' ? 'the top level' : baseName(folder);
}

/** The move destination of a target ('' = top level), or null for pins. */
export function destOf(t: DropTarget): string | null {
  if (t.kind === 'folder') return t.path;
  if (t.kind === 'note') return dirOf(t.path);
  if (t.kind === 'root') return '';
  return null;
}

/** What dropping `d` on `t` would do. */
export function resolveDrop(d: DragPayload, t: DropTarget): DropVerdict {
  if (t.kind === 'pins') {
    return { ok: true, dest: '', hint: d.kind === 'pin' ? 'Move the pin here' : 'Pin here' };
  }
  const dest = destOf(t) ?? '';
  const where = placeName(dest);
  const into = dest === '' ? 'Move to the top level' : `Move into ${where}`;
  const already = `Already in ${where}`;
  const notes = d.kind === 'notes' ? d.paths : d.kind === 'pin' && d.item.kind === 'note' ? [d.item.key] : null;
  if (notes) {
    if (!notes.some((p) => dirOf(p) !== dest)) return { ok: false, dest, hint: already };
    return { ok: true, dest, hint: into };
  }
  const src = d.kind === 'folder' ? d.path : d.kind === 'pin' ? d.item.key : '';
  if (!src) return { ok: false, dest, hint: 'The vault itself cannot move' };
  if (isSelfOrBelow(dest, src)) {
    return { ok: false, dest, hint: dest === src ? 'A folder cannot go into itself' : 'A folder cannot go into its own subfolder' };
  }
  if (dirOf(src) === dest) return { ok: false, dest, hint: already };
  return { ok: true, dest, hint: into };
}

/** What a drag carries, for the ghost and the confirm: one name or "N items". */
export function payloadLabel(d: DragPayload): { name: string; count: number; folder: boolean } {
  if (d.kind === 'notes') {
    return { name: d.paths.length === 1 ? noteTitle(d.paths[0]) : `${d.paths.length} items`, count: d.paths.length, folder: false };
  }
  if (d.kind === 'folder') return { name: baseName(d.path), count: 1, folder: true };
  return { name: d.item.kind === 'note' ? noteTitle(d.item.key) : baseName(d.item.key), count: 1, folder: d.item.kind === 'folder' };
}

function noteTitle(path: string): string {
  return baseName(path).replace(/\.md$/i, '');
}

/** The confirm question: `Move "X" to "Y"?` or `Move N items to "Y"?`. */
export function confirmTitle(d: DragPayload, dest: string): string {
  const { name, count } = payloadLabel(d);
  const what = count > 1 ? `${count} items` : `"${name}"`;
  return `Move ${what} to "${dest === '' ? 'Top level' : baseName(dest)}"?`;
}

/** Auto-scroll zone height at the top and bottom of the scroll box (px). */
export const EDGE = 48;
/** Fastest auto-scroll (px per frame), right at the edge. */
export const MAX_SPEED = 18;

/**
 * Auto-scroll speed for a pointer at `y` over a box from `top` to `bottom`:
 * 0 outside the edge zones, growing (quadratically) to `max` at the edge or
 * beyond it; negative scrolls up. Small boxes shrink the zones so they never
 * overlap.
 */
export function autoScrollSpeed(y: number, top: number, bottom: number, edge = EDGE, max = MAX_SPEED): number {
  const zone = Math.max(8, Math.min(edge, (bottom - top) / 3));
  const ramp = (d: number): number => {
    const t = Math.min(1, Math.max(0, 1 - d / zone));
    return Math.max(1, Math.round(max * t * t));
  };
  if (y < top + zone) return -ramp(Math.max(0, y - top));
  if (y > bottom - zone) return ramp(Math.max(0, bottom - y));
  return 0;
}

/** Levels that get their own indent; deeper rows stay at this indent and show their level. */
export const INDENT_CAP = 6;

/** Indent level a row is drawn at (depth past the cap no longer moves right). */
export function indentLevel(depth: number, cap = INDENT_CAP): number {
  return Math.max(0, Math.min(depth, cap));
}

/** Whether a row is deep enough to show its level as a badge. */
export function showsDepthBadge(depth: number, cap = INDENT_CAP): boolean {
  return depth > cap;
}

// ---------------------------------------------------------------------------
// One gesture
// ---------------------------------------------------------------------------

/** Mouse and pen: the drag starts after the pointer moves this far (px). */
const MOVE_SLOP = 5;
/** Touch: hold this long without moving to pick the item up (ms). */
export const HOLD_MS = 380;
/** Touch: moving farther than this before the hold ends means a scroll (px). */
const TOUCH_SLOP = 8;
/** Hold a dragged item over a closed folder this long to open it (ms). */
export const OPEN_MS = 600;

export interface DragSpec {
  payload: DragPayload;
  /** The row the drag came from (dimmed while dragging). */
  source: HTMLElement;
  /** Icon HTML for the ghost. */
  icon: string;
  /** The scroll box to auto-scroll (the sidebar, or the phone drawer). */
  scroller: () => HTMLElement | null;
  /** The place under a point, and the element to highlight for it. */
  targetAt: (x: number, y: number) => { target: DropTarget; el: HTMLElement | null } | null;
  /** A closed folder that can open under this target, if any. */
  canOpen: (t: DropTarget) => string | null;
  /** Open a folder held over (animated). */
  open: (path: string) => void;
  /** Released on a valid place. */
  drop: (t: DropTarget, v: DropVerdict) => void;
  /** Touch only: held, then let go without moving (the long-press menu). */
  held?: (x: number, y: number) => void;
}

/** Several nodes at once: a small stack of pages. */
const I_STACK =
  '<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7V5a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2h-2"/><path d="M5 7h7l4 4v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>';

/** The gesture in progress, if any (only one at a time). */
let live: { cancel: () => void; dragging: boolean } | null = null;

/** Whether a drag is being carried right now. */
export function dragging(): boolean {
  return !!live?.dragging;
}

/** A pointer went down on a draggable row: watch it, maybe turn it into a drag. */
export function pressDrag(e: PointerEvent, spec: () => DragSpec | null): void {
  if (live || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const touch = e.pointerType === 'touch';
  const x0 = e.clientX;
  const y0 = e.clientY;
  let x = x0;
  let y = y0;
  let s: DragSpec | null = null;
  let started = false;
  let moved = false;
  let holdTimer = 0;
  let openTimer = 0;
  let openPath: string | null = null;
  let raf = 0;
  let ghost: HTMLElement | null = null;
  let lit: HTMLElement | null = null;
  let cur: { target: DropTarget; el: HTMLElement | null } | null = null;
  let verdict: DropVerdict | null = null;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const begin = (): void => {
    s = spec();
    if (!s) {
      finish(true);
      return;
    }
    started = true;
    state.dragging = true;
    document.body.classList.add('vx-pdrag');
    s.source.classList.add('vx-dragsrc');
    const { name, count } = payloadLabel(s.payload);
    ghost = document.createElement('div');
    ghost.className = 'vx-pghost' + (touch ? ' touch' : '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = `<span class="vx-pghost-main">${count > 1 ? I_STACK : s.icon}<span class="vx-pghost-name">${esc(name)}</span></span><span class="vx-pghost-hint"></span>`;
    document.body.appendChild(ghost);
    if (touch && !still) navigator.vibrate?.(12);
    place();
    track();
    raf = requestAnimationFrame(tick);
  };

  const place = (): void => {
    if (!ghost) return;
    // A finger covers what is under it: the ghost rides above it.
    const gx = x + (touch ? -24 : 14);
    const gy = y + (touch ? -64 : 12);
    ghost.style.transform = `translate(${Math.round(gx)}px,${Math.round(gy)}px)`;
  };

  const light = (el: HTMLElement | null, ok: boolean): void => {
    if (lit && lit !== el) lit.classList.remove('vx-drop-into', 'vx-drop-no', 'vx-drop-near');
    lit = el;
    if (!el || !cur) return;
    el.classList.toggle('vx-drop-into', ok && cur.target.kind !== 'note' && cur.target.kind !== 'pins');
    el.classList.toggle('vx-drop-near', ok && cur.target.kind === 'note');
    el.classList.toggle('vx-drop-no', !ok);
  };

  const clearPinMarks = (): void => {
    document.querySelectorAll('.vx-pin.vx-drop-before,.vx-pin.vx-drop-after').forEach((n) => n.classList.remove('vx-drop-before', 'vx-drop-after'));
    document.querySelectorAll('.vx-pins.vx-drop-zone').forEach((n) => n.classList.remove('vx-drop-zone'));
  };

  /** Work out the place under the pointer and show it. */
  const track = (): void => {
    if (!s || !ghost) return;
    cur = s.targetAt(x, y);
    verdict = cur ? resolveDrop(s.payload, cur.target) : null;
    const ok = !!verdict?.ok;
    light(cur?.el || null, ok);
    clearPinMarks();
    if (cur?.target.kind === 'pins') {
      const sec = cur.el?.closest('.vx-pins');
      sec?.classList.add('vx-drop-zone');
      const rows = sec ? Array.from(sec.querySelectorAll<HTMLElement>('.vx-pin')) : [];
      const i = cur.target.index;
      if (rows.length) {
        if (i < rows.length) rows[i].classList.add('vx-drop-before');
        else rows[rows.length - 1].classList.add('vx-drop-after');
      }
    }
    ghost.classList.toggle('no', !!verdict && !ok);
    ghost.classList.toggle('ok', ok);
    document.body.classList.toggle('vx-pdrag-no', !!verdict && !ok);
    const hint = ghost.querySelector<HTMLElement>('.vx-pghost-hint')!;
    const text = verdict ? verdict.hint : 'Drop on a folder';
    if (hint.textContent !== text) hint.textContent = text;
    // Held over a closed folder: it opens after a moment.
    const want = cur ? s.canOpen(cur.target) : null;
    if (want !== openPath) {
      clearTimeout(openTimer);
      document.querySelectorAll('.vx-opening').forEach((n) => n.classList.remove('vx-opening'));
      openPath = want;
      if (want != null) {
        cur?.el?.classList.add('vx-opening');
        const sx = s;
        openTimer = window.setTimeout(() => {
          document.querySelectorAll('.vx-opening').forEach((n) => n.classList.remove('vx-opening'));
          if (started && openPath === want) {
            sx.open(want);
            openPath = null;
            // Rows below moved: look again once the branch has opened.
            setTimeout(() => started && track(), 320);
          }
        }, OPEN_MS);
      }
    }
  };

  /** Auto-scroll near the top and bottom edges of the scroll box. */
  const tick = (): void => {
    if (!started || !s) return;
    const box = s.scroller();
    if (box) {
      const r = box.getBoundingClientRect();
      const inside = x >= r.left - 40 && x <= r.right + 40;
      const v = inside ? autoScrollSpeed(y, r.top, r.bottom) : 0;
      if (v) {
        const before = box.scrollTop;
        box.scrollTop = before + v;
        if (box.scrollTop !== before) track();
      }
    }
    raf = requestAnimationFrame(tick);
  };

  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== e.pointerId) return;
    x = ev.clientX;
    y = ev.clientY;
    const far = Math.hypot(x - x0, y - y0);
    if (!started) {
      if (touch) {
        // Moving before the hold ends: the finger is scrolling, not dragging.
        if (far > TOUCH_SLOP) finish(true);
      } else if (far > MOVE_SLOP) begin();
      return;
    }
    if (far > TOUCH_SLOP) moved = true;
    ev.preventDefault();
    place();
    track();
  };

  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== e.pointerId) return;
    x = ev.clientX;
    y = ev.clientY;
    if (!started) {
      finish(true);
      return;
    }
    if (touch && !moved && s?.held) {
      // Held and let go in place: the long-press menu, not a drop.
      const sx = s;
      finish(true);
      swallowClick();
      sx.held!(x, y);
      return;
    }
    track();
    const t = cur;
    const v = verdict;
    const sx = s;
    finish(true);
    swallowClick();
    if (sx && t && v?.ok) sx.drop(t.target, v);
  };

  const onCancel = (ev: PointerEvent): void => {
    if (ev.pointerId === e.pointerId) finish(true);
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(true);
  };

  // While held or dragging, the page must not scroll under the finger, and
  // the long-press menu of the browser must not open.
  const onTouchMove = (ev: TouchEvent): void => {
    if (started && ev.cancelable) ev.preventDefault();
  };
  const onMenu = (ev: Event): void => {
    if (started || (touch && holdTimer)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  const state = { dragging: false, cancel: () => finish(true) };

  const finish = (_cancel: boolean): void => {
    clearTimeout(holdTimer);
    holdTimer = 0;
    clearTimeout(openTimer);
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('touchmove', onTouchMove, true);
    window.removeEventListener('contextmenu', onMenu, true);
    document.querySelectorAll('.vx-opening').forEach((n) => n.classList.remove('vx-opening'));
    if (started) {
      light(null, false);
      clearPinMarks();
      s?.source.classList.remove('vx-dragsrc');
      document.querySelectorAll('.vx-dragsrc').forEach((n) => n.classList.remove('vx-dragsrc'));
      document.body.classList.remove('vx-pdrag', 'vx-pdrag-no');
      const g = ghost;
      if (g) {
        if (still) g.remove();
        else g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120 }).onfinish = () => g.remove();
      }
    }
    ghost = null;
    started = false;
    state.dragging = false;
    if (live === state) live = null;
  };

  live = state;
  window.addEventListener('pointermove', onMove, { capture: true, passive: false });
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  window.addEventListener('contextmenu', onMenu, true);
  if (touch) {
    holdTimer = window.setTimeout(() => {
      holdTimer = 0;
      begin();
    }, HOLD_MS);
  }
}

/** The click that follows a drop must not also open what is under it. */
function swallowClick(): void {
  const stop = (ev: Event): void => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, true), 60);
}

/**
 * The box that scrolls `node` vertically: the nearest ancestor (or `node`
 * itself) with overflow auto/scroll whose content overflows, else the nearest
 * one that could scroll.
 */
export function scrollParent(node: HTMLElement | null, self = false): HTMLElement | null {
  let first: HTMLElement | null = null;
  for (let n = self ? node : node?.parentElement || null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if (oy !== 'auto' && oy !== 'scroll') continue;
    if (n.scrollHeight > n.clientHeight + 1) return n;
    first = first || n;
  }
  return first;
}
