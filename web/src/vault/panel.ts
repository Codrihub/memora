// One floating panel at a time: a popover under its button, or a bottom sheet on phones.

import { attr, el, esc } from '../dom';
import { t } from '../i18n';
import { I } from './icons';
import { fadeScroll } from '../ui/scroll-fade';

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

function panelOpenFor(anchor: HTMLElement): boolean {
  return !!cur && cur.anchor === anchor;
}

/** Show `body` in a panel for `anchor` (toggles); `sheet` forces the bottom sheet on any screen;
 *  `side` makes it a panel along the right edge on wider screens (the page stays in view beside it). */
export function openPanel(anchor: HTMLElement, title: string, body: HTMLElement, cls = '', sheet = false, side = false): HTMLElement {
  if (panelOpenFor(anchor)) {
    closePanel();
    return body;
  }
  closePanel();
  const phone = sheet || window.matchMedia(PHONE).matches;
  const root = el('div', (phone ? 'vx-sheet' : side ? 'vx-pop vx-side' : 'vx-pop') + (cls ? ' ' + cls : ''));
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', title);
  const card = el('div', 'vx-pop-card');
  card.innerHTML = `${phone ? '<span class="vx-sheet-grab" aria-hidden="true"></span>' : ''}<header class="vx-pop-head"><b>${esc(
    title,
  )}</b><button class="vx-icon-btn" data-close aria-label="${attr(t('Close'))}">${I.close}</button></header>`;
  body.classList.add('vx-pop-body');
  card.appendChild(body);
  fadeScroll(body);
  if (phone) root.innerHTML = '<div class="vx-sheet-back"></div>';
  root.appendChild(card);
  document.body.appendChild(root);
  anchor.setAttribute('aria-expanded', 'true');

  if (phone) {
    requestAnimationFrame(() => root.classList.add('in'));
    wireSwipe(card);
  } else if (side) {
    // Along the right edge, from just under the top bar to the bottom of the window.
    const top = Math.round((document.getElementById('topbar')?.getBoundingClientRect().bottom || 0) + 8);
    card.style.top = top + 'px';
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
    if (card.contains(t) || anchor.contains(t)) return;
    // A side panel stays while the page beside it is read, scrolled or touched; going somewhere
    // (the sidebar, top bar, tab bar, or a link or button on the page) closes it.
    if (side && !(t instanceof Element && t.closest('#sidebar,#topbar,#tabbar,a,button,[role=button],[data-open]'))) return;
    closePanel();
  };
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  window.addEventListener('resize', closePanel);
  window.addEventListener('popstate', closePanel);
  card.querySelector<HTMLElement>('[data-close]')!.onclick = () => closePanel();
  cur = {
    anchor,
    root,
    cleanup: () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', closePanel);
      window.removeEventListener('popstate', closePanel);
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
