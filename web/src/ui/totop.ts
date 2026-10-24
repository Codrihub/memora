// On phones row buttons sit at the right edge, so the button is a centred pill shown only while scrolling up.

import { useStyles } from '../dom';
import { state } from '../state';
import { onNavigate } from '../router';

const SHOW_AT = 480;
const PHONE_LINGER = 2200;

const CSS = `
.totop{position:absolute;right:24px;bottom:calc(24px + var(--toasts-h,0px));z-index:30;width:44px;height:44px;display:grid;place-items:center;padding:0;border-radius:50%;
  border:1px solid color-mix(in srgb,var(--fg) 24%,transparent);background:var(--surface-2);color:var(--fg);box-shadow:none;cursor:pointer;
  opacity:0;visibility:hidden;transform:translateY(12px) scale(.92);pointer-events:none;
  transition:opacity .2s var(--ease),transform .24s var(--ease-out),bottom .24s var(--ease-out),visibility 0s linear .24s,background .15s,border-color .15s,color .15s}
.totop.on{opacity:1;visibility:visible;transform:none;pointer-events:auto;
  transition:opacity .2s var(--ease),transform .24s var(--ease-out),visibility 0s,background .15s,border-color .15s,color .15s}
.totop:hover{background:var(--surface-3);border-color:var(--accent);color:var(--accent)}
:root[data-theme=light] .totop{background:var(--surface-1)}
:root[data-theme=light] .totop:hover{background:var(--surface-2)}
.totop:active{transform:scale(.94)}
.totop:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.totop svg{width:18px;height:18px}
.totop span{display:none}
@media (max-width:760px){
  .totop{left:0;right:0;margin:0 auto;width:max-content;height:36px;padding:0 14px 0 11px;gap:6px;display:flex;align-items:center;border-radius:99px;
    font-size:13px;font-weight:600;line-height:1;bottom:calc(var(--tabbar) + var(--tb-gap,10px) + var(--tb-pad,0px) + 10px + var(--toasts-h,0px))}
  .totop span{display:inline}
  .totop svg{width:16px;height:16px}
}
@media (prefers-reduced-motion:reduce){.totop,.totop.on{transform:none;transition:opacity .1s,visibility 0s}}
`;

let btn: HTMLButtonElement | null = null;
let views: HTMLElement | null = null;
let current: HTMLElement | null = null;
let watch = 0;
let raf = 0;
let lastTop = 0;
let upward = false;
let linger = 0;

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = (): boolean => window.matchMedia('(max-width: 760px)').matches;

function trackDirection(top: number): void {
  const dy = top - lastTop;
  if (Math.abs(dy) < 8) return;
  lastTop = top;
  upward = dy < 0;
  window.clearTimeout(linger);
  if (upward)
    linger = window.setTimeout(() => {
      upward = false;
      queue();
    }, PHONE_LINGER);
}

function visible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const cv = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  if (cv) return cv.call(el, { visibilityProperty: true, checkOpacity: true });
  return el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
}

function isPageScroller(el: HTMLElement): boolean {
  if (!views || el.closest('[data-no-totop]')) return false;
  return el.clientHeight >= views.clientHeight * 0.5 && el.clientWidth >= views.clientWidth * 0.45;
}

function covered(): boolean {
  if (document.body.style.overflow === 'hidden') return true;
  const pm = document.getElementById('profileMenu');
  if (pm && !pm.classList.contains('hidden')) return true;
  if (document.getElementById('app')?.classList.contains('side-open')) return true;
  for (const d of document.querySelectorAll<HTMLElement>('[aria-modal="true"]')) if (visible(d)) return true;
  return false;
}

function fallback(): HTMLElement | null {
  return views?.querySelector<HTMLElement>(':scope > .view:not(.hidden)') || null;
}

function sync(): void {
  if (!btn) return;
  if (current && !visible(current)) current = null;
  const sc = current || fallback();
  const down = !!sc && sc.scrollTop > SHOW_AT;
  const on = down && (!phone() || upward) && !state.editing && !covered();
  if (btn.classList.contains('on') !== on) {
    btn.classList.toggle('on', on);
    btn.tabIndex = on ? 0 : -1;
    btn.setAttribute('aria-hidden', on ? 'false' : 'true');
  }
  // Poll while scrolled down: a dialog may open or close.
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

/** For layered pages (e.g. Nodes list vs reader). */
export function setToTopScroller(el: HTMLElement | null): void {
  current = el;
  queue();
}

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
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg><span>Top</span>';
  btn.onclick = () => {
    const sc = current || fallback();
    if (!sc) return;
    upward = false;
    sc.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    // The button goes away under the pointer: keep focus in the page.
    views?.focus({ preventScroll: true });
  };
  main.appendChild(btn);
  views.addEventListener(
    'scroll',
    (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && t !== current && isPageScroller(t)) {
        current = t;
        lastTop = t.scrollTop;
      }
      if (t === current && t instanceof HTMLElement) trackDirection(t.scrollTop);
      queue();
    },
    { capture: true, passive: true },
  );
  onNavigate(() => {
    current = null;
    upward = false;
    lastTop = 0;
    queue();
  });
  window.addEventListener('resize', queue, { passive: true });
}
