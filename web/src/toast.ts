// App-wide notification stack. Errors stay until dismissed; a toast with a `group` is updated in place.

import { $, el, esc } from './dom';
import { icon } from './ui/icons';

type ToastKind = 'ok' | 'warn' | 'err' | 'info';

interface ToastAction {
  label: string;
  icon?: string;
  run: () => void | Promise<void>;
}

interface ToastOptions {
  group?: string;
  /** Markup for the icon slot (an agent avatar), instead of the kind's icon. */
  iconHtml?: string;
}

const ICON: Record<ToastKind, string> = { ok: 'check', warn: 'alert', err: 'alert', info: 'info' };
const VISIBLE = 3;
const KEEP = 12;

interface Live {
  node: HTMLElement;
  until: number;
  timer: number;
  left: number;
  sticky: boolean;
  group?: string;
}

/** Newest first. */
const live: Live[] = [];
let paused = false;
let expanded = false;

const reduced = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function host(): HTMLElement {
  return $('#toasts');
}

/** FLIP animation from the previous positions. */
function flip(before: Map<HTMLElement, number>): void {
  if (reduced()) return;
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
  if (t.sticky) return;
  t.left = ms;
  t.until = Date.now() + ms;
  if (!paused) t.timer = window.setTimeout(() => dismiss(t.node), ms);
}

/** `--toasts-h` lets the scroll-to-top button rise above the stack. */
function layout(): void {
  const box = host();
  if (!box.classList) return;
  const extra = Math.max(0, live.length - VISIBLE);
  if (!extra) expanded = false;
  live.forEach((t, i) => t.node.classList.toggle('stowed', !expanded && i >= VISIBLE));
  let more = box.querySelector<HTMLButtonElement>('.t-more');
  if (extra && !more) {
    more = el('button', 't-more') as HTMLButtonElement;
    more.type = 'button';
    more.onclick = () => {
      const before = positions();
      expanded = !expanded;
      layout();
      flip(before);
    };
    box.prepend(more);
  }
  if (more) {
    if (!extra) more.remove();
    else {
      more.textContent = expanded ? 'Show fewer' : `+${extra} more`;
      more.setAttribute('aria-expanded', String(expanded));
      more.setAttribute('aria-label', expanded ? 'Show only the latest notifications' : `Show ${extra} more notification${extra === 1 ? '' : 's'}`);
    }
  }
  box.classList.toggle('expanded', expanded);
  // Measured after the stowed ones are gone from the flow.
  const h = live.length ? Math.ceil(box.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--toasts-h', h ? h + 12 + 'px' : '0px');
}

function dismiss(node: HTMLElement, fast = false): void {
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
      layout();
      flip(before);
    },
    reduced() ? 0 : fast ? 160 : 260,
  );
}

export function dismissGroup(group: string): void {
  const t = live.find((x) => x.group === group);
  if (t) dismiss(t.node, true);
}

export function groupAlive(group: string): boolean {
  return live.some((x) => x.group === group);
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

function fill(node: HTMLElement, msg: string, kind: ToastKind, action?: ToastAction, opts?: ToastOptions): void {
  node.className = 'toast ' + kind + (opts?.iconHtml ? ' has-av' : '');
  node.innerHTML = `<span class="t-ico">${opts?.iconHtml || icon(ICON[kind] || 'info')}</span><span class="t-msg">${esc(msg)}</span>${
    action ? `<button type="button" class="t-act">${action.icon || ''}${esc(action.label)}</button>` : ''
  }<button type="button" class="t-x" aria-label="Dismiss" title="Dismiss">${icon('close')}</button>`;
  // Errors interrupt; the rest is read out politely by the stack's live region.
  if (kind === 'err') node.setAttribute('role', 'alert');
  else node.removeAttribute('role');
  node.querySelector<HTMLButtonElement>('.t-x')!.onclick = () => dismiss(node, true);
  const act = node.querySelector<HTMLButtonElement>('.t-act');
  if (act && action) {
    act.onclick = async () => {
      act.disabled = true;
      dismiss(node, true);
      await action.run();
    };
  }
}

export function notify(msg: string, kind: ToastKind = 'ok', ms = 4200, action?: ToastAction, opts?: ToastOptions): void {
  const box = host();
  if (!box.classList) return;
  const sticky = kind === 'err';
  const before = positions();
  const same = opts?.group ? live.find((x) => x.group === opts.group) : undefined;
  if (same) {
    live.splice(live.indexOf(same), 1);
    live.unshift(same);
    same.sticky = sticky;
    fill(same.node, msg, kind, action, opts);
    box.appendChild(same.node);
    if (!reduced()) {
      same.node.classList.remove('bump');
      void same.node.offsetWidth;
      same.node.classList.add('bump');
    }
    layout();
    flip(before);
    arm(same, ms);
    return;
  }
  const node = el('div', 'toast');
  fill(node, msg, kind, action, opts);
  box.appendChild(node);
  const t: Live = { node, until: 0, timer: 0, left: ms, sticky, group: opts?.group };
  live.unshift(t);
  swipe(node);
  while (live.length > KEEP) {
    const old = [...live].reverse().find((x) => !x.sticky) || live[live.length - 1];
    live.splice(live.indexOf(old), 1);
    window.clearTimeout(old.timer);
    old.node.remove();
  }
  layout();
  flip(before);
  arm(t, ms);
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
      if (t.sticky) continue;
      t.left = Math.max(600, t.until - Date.now());
    }
  });
  box.addEventListener('pointerleave', () => {
    paused = false;
    if (expanded) {
      const before = positions();
      expanded = false;
      layout();
      flip(before);
    }
    for (const t of live) arm(t, Math.max(1200, t.left));
  });
  window.addEventListener('resize', () => layout(), { passive: true });
}
