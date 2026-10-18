// Pull down to refresh, on touch screens, on every page.
//
// The page views scroll inside their own box (the body never scrolls), so the
// browser's own pull-to-refresh never fires; this one does the same job:
//   - pages that scroll: pull down while the page is at its top;
//   - Brain, Graph, Canvas (a drag pans the map): pull down from the top bar.
// Past the threshold the data reloads in place (no full page load, no splash).

import { useStyles } from '../dom';
import { state } from '../state';

/** Pull distance (after resistance) that triggers a refresh. */
const TRIGGER = 72;
/** Furthest the indicator travels. */
const MAX = 110;
const MAPS = new Set(['brain', 'graph', 'canvas']);

const CSS = `
.ptr{position:fixed;left:50%;top:0;z-index:60;width:40px;height:40px;margin-left:-20px;border-radius:50%;display:grid;place-items:center;
  background:var(--panel,#12161f);border:1px solid var(--line-strong,var(--line));box-shadow:0 8px 24px -8px rgba(0,0,0,.55);color:var(--accent,#5eead4);
  transform:translateY(-60px);opacity:0;pointer-events:none}
.ptr.anim{transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s}
.ptr svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.ptr.ready svg{color:var(--accent,#5eead4)}
.ptr.busy svg{animation:ptr-spin .8s linear infinite}
@keyframes ptr-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ptr.anim{transition:none}.ptr.busy svg{animation-duration:2s}}
`;

const ARROW = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';

/** True when something under the finger is scrolled down (it should scroll back up first). */
function scrolledAbove(t: Element | null, stop: Element): boolean {
  for (let n = t; n && n !== stop.parentElement; n = n.parentElement) {
    if (n instanceof HTMLElement && n.scrollTop > 0 && n.scrollHeight > n.clientHeight) return true;
  }
  return false;
}

function blocked(t: Element | null): boolean {
  if (!t) return true;
  if (t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],.nc,.mf,.vc-drawer,.vc-sheet,.pmenu')) return true;
  // A dialog, the search palette or a sheet is open.
  return !!document.querySelector('#modalHost:not(.hidden),#palette:not(.hidden),.pmenu:not(.hidden)');
}

export function initPullRefresh(run: () => Promise<unknown>): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  useStyles('ptr-css', CSS);
  const views = document.getElementById('views');
  const bar = document.getElementById('topbar');
  if (!views || !bar) return;
  const ind = document.createElement('div');
  ind.className = 'ptr';
  ind.setAttribute('aria-hidden', 'true');
  ind.innerHTML = ARROW;
  document.body.appendChild(ind);

  let y0 = -1;
  let x0 = 0;
  let pull = 0;
  let on = false;
  let busy = false;
  const base = (): number => bar.getBoundingClientRect().bottom;

  const paint = (): void => {
    const k = Math.min(1, pull / TRIGGER);
    ind.style.transform = `translateY(${base() - 44 + pull}px) rotate(${k * 270}deg)`;
    ind.style.opacity = String(Math.min(1, pull / 30));
    ind.classList.toggle('ready', pull >= TRIGGER);
  };
  const settle = (): void => {
    ind.classList.add('anim');
    ind.style.transform = 'translateY(-60px)';
    ind.style.opacity = '0';
    window.setTimeout(() => ind.classList.remove('anim', 'busy', 'ready'), 300);
  };

  const start = (e: TouchEvent): void => {
    if (busy || e.touches.length !== 1) return;
    const t = e.target as Element | null;
    if (blocked(t)) return;
    const fromBar = !!t?.closest('#topbar');
    const view = t?.closest<HTMLElement>('.view');
    if (!fromBar) {
      // On a map the finger pans; there only the top bar pulls.
      if (!view || MAPS.has(state.page) || view.scrollTop > 0 || scrolledAbove(t, view)) return;
    }
    y0 = e.touches[0].clientY;
    x0 = e.touches[0].clientX;
    pull = 0;
    on = false;
  };
  const move = (e: TouchEvent): void => {
    if (y0 < 0) return;
    const dy = e.touches[0].clientY - y0;
    const dx = e.touches[0].clientX - x0;
    if (!on) {
      if (dy < 8) {
        if (dy < -4 || Math.abs(dx) > 10) y0 = -1;
        return;
      }
      if (Math.abs(dx) > dy) {
        y0 = -1;
        return;
      }
      on = true;
      ind.classList.remove('anim');
    }
    // Resistance: the further, the slower.
    pull = Math.min(MAX, (dy - 8) * 0.55);
    if (e.cancelable) e.preventDefault();
    paint();
  };
  const end = (): void => {
    if (y0 < 0) return;
    y0 = -1;
    if (!on) return;
    on = false;
    if (pull < TRIGGER) {
      settle();
      return;
    }
    busy = true;
    navigator.vibrate?.(8);
    ind.classList.add('anim', 'busy');
    pull = TRIGGER * 0.8;
    paint();
    const t0 = performance.now();
    void Promise.resolve()
      .then(run)
      .catch(() => {})
      .finally(() => {
        // Long enough to read as "it refreshed", even when the data was quick.
        window.setTimeout(() => {
          busy = false;
          settle();
        }, Math.max(0, 450 - (performance.now() - t0)));
      });
  };

  for (const host of [views, bar]) {
    host.addEventListener('touchstart', start, { passive: true });
    host.addEventListener('touchmove', move, { passive: false });
    host.addEventListener('touchend', end, { passive: true });
    host.addEventListener('touchcancel', end, { passive: true });
  }
}
