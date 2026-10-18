// One floating panel at a time for the reader: a popover under its button on
// wider screens, a bottom sheet (backdrop, handle, swipe down) on phones.
// Closes on Esc, a click outside, the backdrop, the X or a swipe; focus goes
// back to the button that opened it.

import { el, esc } from '../dom';
import { I } from './icons';

const PHONE = '(max-width: 760px)';

interface Open {
  anchor: HTMLElement;
  root: HTMLElement;
  cleanup: () => void;
}

let cur: Open | null = null;

export function closePanel(): void {
  const c = cur;
  if (!c) return;
  cur = null;
  c.cleanup();
  c.anchor.setAttribute('aria-expanded', 'false');
  const sheet = c.root.classList.contains('vx-sheet');
  if (sheet && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    c.root.classList.remove('in');
    setTimeout(() => c.root.remove(), 220);
  } else c.root.remove();
  if (c.anchor.isConnected) c.anchor.focus({ preventScroll: true });
}

export function panelOpenFor(anchor: HTMLElement): boolean {
  return !!cur && cur.anchor === anchor;
}

/**
 * Show `body` in a panel for `anchor`. Pressing the same button again closes
 * it. `cls` sizes the popover (e.g. 'vx-pop-aa').
 */
export function openPanel(anchor: HTMLElement, title: string, body: HTMLElement, cls = ''): HTMLElement {
  if (panelOpenFor(anchor)) {
    closePanel();
    return body;
  }
  closePanel();
  const phone = window.matchMedia(PHONE).matches;
  const root = el('div', (phone ? 'vx-sheet' : 'vx-pop') + (cls ? ' ' + cls : ''));
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', title);
  const card = el('div', 'vx-pop-card');
  card.innerHTML = `${phone ? '<span class="vx-sheet-grab" aria-hidden="true"></span>' : ''}<header class="vx-pop-head"><b>${esc(
    title,
  )}</b><button class="vx-icon-btn" data-close aria-label="Close">${I.close}</button></header>`;
  body.classList.add('vx-pop-body');
  card.appendChild(body);
  if (phone) root.innerHTML = '<div class="vx-sheet-back"></div>';
  root.appendChild(card);
  document.body.appendChild(root);
  anchor.setAttribute('aria-expanded', 'true');

  if (phone) {
    requestAnimationFrame(() => root.classList.add('in'));
    wireSwipe(card);
  } else {
    // Under the button, right edges aligned, kept on screen.
    const r = anchor.getBoundingClientRect();
    const w = card.offsetWidth;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    card.style.left = left + 'px';
    card.style.top = r.bottom + 6 + 'px';
    card.style.maxHeight = `calc(100vh - ${Math.round(r.bottom + 18)}px)`;
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    }
  };
  const onDown = (e: Event): void => {
    const t = e.target as Node;
    if (!card.contains(t) && !anchor.contains(t)) closePanel();
  };
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  window.addEventListener('resize', closePanel);
  card.querySelector<HTMLElement>('[data-close]')!.onclick = () => closePanel();
  cur = {
    anchor,
    root,
    cleanup: () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', closePanel);
    },
  };
  (body.querySelector<HTMLElement>('[aria-pressed=true],[aria-selected=true],button') || card).focus({ preventScroll: true });
  return body;
}

/** Drag the sheet down by its head to close it. */
function wireSwipe(card: HTMLElement): void {
  const head = card.querySelector<HTMLElement>('.vx-pop-head')!;
  const grab = card.querySelector<HTMLElement>('.vx-sheet-grab');
  for (const h of [head, grab]) {
    if (!h) continue;
    h.onpointerdown = (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const y0 = e.clientY;
      let dy = 0;
      h.setPointerCapture(e.pointerId);
      card.style.transition = 'none';
      h.onpointermove = (m) => {
        dy = Math.max(0, m.clientY - y0);
        card.style.transform = `translateY(${dy}px)`;
      };
      h.onpointerup = h.onpointercancel = () => {
        h.onpointermove = null;
        card.style.transition = '';
        card.style.transform = '';
        if (dy > 80) closePanel();
      };
    };
  }
}
