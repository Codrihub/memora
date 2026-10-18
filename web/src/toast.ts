// Notifications: one stack at the top right, just under the header. The newest
// sits on top and pushes the others down. At most five stay; the bottom one
// leaves faster the fuller the stack gets, so the newest is always readable.
// Hover pauses them; swipe right or press × to dismiss one.

import { $, el, esc } from './dom';
import { icon } from './ui/icons';

export type ToastKind = 'ok' | 'warn' | 'err' | 'info';

export interface ToastAction {
  label: string;
  icon?: string;
  run: () => void | Promise<void>;
}

const ICON: Record<ToastKind, string> = { ok: 'check', warn: 'alert', err: 'alert', info: 'info' };
const MAX = 5;
/** Bottom toast's remaining time once the stack holds 4 / 5 toasts (ms). */
const RUSH = [Infinity, Infinity, Infinity, Infinity, 2200, 900];

interface Live {
  node: HTMLElement;
  until: number;
  total: number;
  timer: number;
  left: number;
}

const live: Live[] = [];
let paused = false;

function host(): HTMLElement {
  return $('#toasts');
}

/** Slide every toast from where it was to where it is now (FLIP). */
function flip(before: Map<HTMLElement, number>): void {
  for (const t of live) {
    const prev = before.get(t.node);
    if (prev == null) continue;
    const dy = prev - t.node.getBoundingClientRect().top;
    if (!dy) continue;
    t.node.style.transition = 'none';
    t.node.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      t.node.style.transition = '';
      t.node.style.transform = '';
    });
  }
}

function positions(): Map<HTMLElement, number> {
  return new Map(live.map((t) => [t.node, t.node.getBoundingClientRect().top]));
}

function arm(t: Live, ms: number): void {
  window.clearTimeout(t.timer);
  t.left = ms;
  t.until = Date.now() + ms;
  const bar = t.node.querySelector<HTMLElement>('.t-bar');
  if (bar) {
    bar.style.transition = 'none';
    bar.style.transform = `scaleX(${Math.max(0, Math.min(1, ms / t.total))})`;
    requestAnimationFrame(() => {
      bar.style.transition = `transform ${ms}ms linear`;
      bar.style.transform = 'scaleX(0)';
    });
  }
  if (!paused) t.timer = window.setTimeout(() => dismiss(t.node), ms);
}

/** Shorten the bottom toast's time as the stack fills up. */
function rush(): void {
  const bottom = live[live.length - 1];
  if (!bottom) return;
  const cap = RUSH[Math.min(live.length, RUSH.length - 1)];
  const left = bottom.until - Date.now();
  if (cap < left) arm(bottom, cap);
}

export function dismiss(node: HTMLElement, fast = false): void {
  const i = live.findIndex((t) => t.node === node);
  if (i < 0) return;
  const [t] = live.splice(i, 1);
  window.clearTimeout(t.timer);
  const before = positions();
  node.classList.add(fast ? 'out-fast' : 'out');
  node.style.pointerEvents = 'none';
  window.setTimeout(
    () => {
      node.remove();
      flip(before);
      rush();
    },
    fast ? 160 : 260,
  );
}

function swipe(node: HTMLElement): void {
  let x0 = 0;
  let dx = 0;
  let id = -1;
  node.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    id = e.pointerId;
    x0 = e.clientX;
    dx = 0;
    node.setPointerCapture(id);
    node.style.transition = 'none';
  });
  node.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    dx = Math.max(0, e.clientX - x0);
    node.style.transform = `translateX(${dx}px)`;
    node.style.opacity = String(1 - Math.min(0.9, dx / 220));
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    id = -1;
    node.style.transition = '';
    if (dx > 70) {
      node.style.transform = `translateX(${dx + 120}px)`;
      node.style.opacity = '0';
      dismiss(node, true);
    } else {
      node.style.transform = '';
      node.style.opacity = '';
    }
  };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
}

/** Show a notification. */
export function notify(msg: string, kind: ToastKind = 'ok', ms = 4200, action?: ToastAction): void {
  const box = host();
  if (!box.classList) return;
  const node = el(
    'div',
    'toast ' + kind,
    `<span class="t-ico">${icon(ICON[kind] || 'info')}</span><span class="t-msg">${esc(msg)}</span>${
      action ? `<button type="button" class="t-act">${action.icon || ''}${esc(action.label)}</button>` : ''
    }<button type="button" class="t-x" aria-label="Dismiss">${icon('close')}</button><span class="t-bar" aria-hidden="true"></span>`,
  );
  node.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  const before = positions();
  box.prepend(node);
  const t: Live = { node, until: 0, total: ms, timer: 0, left: ms };
  live.unshift(t);
  flip(before);
  arm(t, ms);
  node.querySelector<HTMLButtonElement>('.t-x')!.onclick = () => dismiss(node, true);
  const act = node.querySelector<HTMLButtonElement>('.t-act');
  if (act && action) {
    act.onclick = async () => {
      act.disabled = true;
      dismiss(node, true);
      await action.run();
    };
  }
  swipe(node);
  // Over the limit: the oldest leaves at once.
  while (live.length > MAX) dismiss(live[live.length - 1].node, true);
  rush();
}

export function toast(msg: string, kind: ToastKind = 'ok', ms = 4200): void {
  notify(msg, kind, ms);
}

// Hovering the stack pauses every toast; leaving resumes with what was left.
let wired = false;
export function initToasts(): void {
  if (wired) return;
  const box = host();
  if (!box.classList) return;
  wired = true;
  box.addEventListener('pointerenter', () => {
    paused = true;
    for (const t of live) {
      window.clearTimeout(t.timer);
      t.left = Math.max(600, t.until - Date.now());
      const bar = t.node.querySelector<HTMLElement>('.t-bar');
      if (bar) {
        const now = getComputedStyle(bar).transform;
        bar.style.transition = 'none';
        bar.style.transform = now === 'none' ? '' : now;
      }
    }
  });
  box.addEventListener('pointerleave', () => {
    paused = false;
    for (const t of live) arm(t, Math.max(1200, t.left));
    rush();
  });
}
