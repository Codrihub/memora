// One floating "back to top" button for the whole app.
//
// It sits at the bottom right of the main content area (above the phone tab
// bar) and shows on any page once the scroller in view is scrolled down. The
// scroller is found on its own: the last large element scrolled inside
// #views (a page section, or a pane such as the Nodes list or reader).
// Pages with a layered layout can name the scroller in view with
// setToTopScroller(). It hides while a dialog or sheet is open and while a
// node is being edited, so it never covers Save and Cancel.

import { useStyles } from '../dom';
import { state } from '../state';
import { onNavigate } from '../router';

/** Shown once the scroller is this far down. */
const SHOW_AT = 480;

const CSS = `
.totop{position:absolute;right:24px;bottom:24px;z-index:30;width:44px;height:44px;display:grid;place-items:center;padding:0;border-radius:50%;
  border:1px solid color-mix(in srgb,var(--fg) 24%,transparent);background:var(--surface-2);color:var(--fg);box-shadow:var(--shadow);cursor:pointer;
  opacity:0;visibility:hidden;transform:translateY(12px) scale(.92);pointer-events:none;
  transition:opacity .2s var(--ease),transform .24s var(--ease-out),visibility 0s linear .24s,background .15s,border-color .15s,color .15s}
.totop.on{opacity:1;visibility:visible;transform:none;pointer-events:auto;
  transition:opacity .2s var(--ease),transform .24s var(--ease-out),visibility 0s,background .15s,border-color .15s,color .15s}
.totop:hover{background:var(--surface-3);border-color:var(--accent);color:var(--accent)}
:root[data-theme=light] .totop{background:var(--surface-1)}
:root[data-theme=light] .totop:hover{background:var(--surface-2)}
.totop:active{transform:scale(.94)}
.totop:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.totop svg{width:18px;height:18px}
@media (max-width:760px){.totop{right:16px;bottom:calc(var(--tabbar) + 16px + var(--safe-b))}}
@media (prefers-reduced-motion:reduce){.totop,.totop.on{transform:none;transition:opacity .1s,visibility 0s}}
`;

let btn: HTMLButtonElement | null = null;
let views: HTMLElement | null = null;
let current: HTMLElement | null = null;
let watch = 0;
let raf = 0;

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function visible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const cv = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  if (cv) return cv.call(el, { visibilityProperty: true, checkOpacity: true });
  return el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
}

/** A page scroller, not a small box that happens to scroll (a list, a code block). */
function isPageScroller(el: HTMLElement): boolean {
  if (!views || el.closest('[data-no-totop]')) return false;
  return el.clientHeight >= views.clientHeight * 0.5 && el.clientWidth >= views.clientWidth * 0.45;
}

/** A dialog, sheet or menu over the page. */
function covered(): boolean {
  if (document.body.style.overflow === 'hidden') return true;
  const pm = document.getElementById('profileMenu');
  if (pm && !pm.classList.contains('hidden')) return true;
  if (document.getElementById('app')?.classList.contains('side-open')) return true;
  for (const d of document.querySelectorAll<HTMLElement>('[aria-modal="true"]')) if (visible(d)) return true;
  return false;
}

/** The scroller in view when none was scrolled yet: the visible page section. */
function fallback(): HTMLElement | null {
  return views?.querySelector<HTMLElement>(':scope > .view:not(.hidden)') || null;
}

function sync(): void {
  if (!btn) return;
  if (current && !visible(current)) current = null;
  const sc = current || fallback();
  const down = !!sc && sc.scrollTop > SHOW_AT;
  const on = down && !state.editing && !covered();
  if (btn.classList.contains('on') !== on) {
    btn.classList.toggle('on', on);
    btn.tabIndex = on ? 0 : -1;
    btn.setAttribute('aria-hidden', on ? 'false' : 'true');
  }
  // While scrolled down, look again now and then: a dialog may open or close.
  if (down && !watch) watch = window.setInterval(sync, 400);
  else if (!down && watch) {
    window.clearInterval(watch);
    watch = 0;
  }
}

function queue(): void {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(sync);
}

/** Name the scroller in view (layered pages, e.g. Nodes list vs reader). */
export function setToTopScroller(el: HTMLElement | null): void {
  current = el;
  queue();
}

/** Mount the button once, at boot. */
export function initToTop(): void {
  if (btn) return;
  const main = document.getElementById('main');
  views = document.getElementById('views');
  if (!main || !views) return;
  useStyles('totop-css', CSS);
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'totop';
  btn.tabIndex = -1;
  btn.setAttribute('aria-hidden', 'true');
  btn.setAttribute('aria-label', 'Back to top');
  btn.title = 'Back to top';
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  btn.onclick = () => {
    const sc = current || fallback();
    if (!sc) return;
    sc.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    // The button goes away under the pointer: keep focus in the page.
    views?.focus({ preventScroll: true });
  };
  main.appendChild(btn);
  views.addEventListener(
    'scroll',
    (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && t !== current && isPageScroller(t)) current = t;
      queue();
    },
    { capture: true, passive: true },
  );
  onNavigate(() => {
    current = null;
    queue();
  });
  window.addEventListener('resize', queue, { passive: true });
}
