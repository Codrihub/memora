// The hop between an agent card (Activity, By agent) and that agent's own
// page. With View Transitions the card grows into the page hero while its
// avatar and name morph into the hero's; without them a card-shaped panel
// zooms to fill the view and the page fades in. Reversed on the way back.
// Reduced motion: no animation at all.

import { useStyles } from '../dom';

const CSS = `
::view-transition-group(root),::view-transition-group(ad-card),::view-transition-group(ad-av),::view-transition-group(ad-nm){
  animation-duration:.42s;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
::view-transition-group(ad-card){overflow:clip;border-radius:var(--r-lg,16px)}
::view-transition-old(ad-card),::view-transition-new(ad-card){width:100%;height:100%;object-fit:none;object-position:left top}
::view-transition-old(ad-nm),::view-transition-new(ad-nm){width:auto;height:100%;object-fit:fill}
.ad-zoom{position:fixed;z-index:60;pointer-events:none;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg,16px);
  box-shadow:0 24px 60px -30px rgba(0,0,0,.55)}
@media (prefers-reduced-motion:reduce){
  ::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}
}
`;

const NAMES: [string, string][] = [
  ['[data-vt-card]', 'ad-card'],
  ['[data-vt-av]', 'ad-av'],
  ['[data-vt-nm]', 'ad-nm'],
];

/** Give (or take) the shared names to a card or a hero: itself, its avatar, its name. */
function name(el: HTMLElement | null, on: boolean): void {
  if (!el) return;
  for (const [sel, n] of NAMES) {
    const t = el.matches(sel) ? el : el.querySelector<HTMLElement>(sel);
    if (t) t.style.viewTransitionName = on ? n : '';
  }
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let running: ViewTransition | null = null;

/**
 * Run `update` (which swaps the list and the agent page) with the shared
 * element animation. `from` is the element shown now (a card or the hero),
 * `to` finds its counterpart once `update` ran.
 */
export async function morph(o: {
  from: HTMLElement | null;
  to: () => HTMLElement | null;
  update: () => void;
  /** The element that fades in (the agent page or the list). */
  reveal: () => HTMLElement | null;
}): Promise<void> {
  useStyles('ad-vt-css', CSS);
  running?.skipTransition();
  running = null;
  if (reducedMotion() || document.visibilityState === 'hidden') {
    o.update();
    return;
  }
  if (typeof document.startViewTransition === 'function') {
    name(o.from, true);
    let target: HTMLElement | null = null;
    const vt = document.startViewTransition(() => {
      name(o.from, false);
      o.update();
      target = o.to();
      name(target, true);
    });
    running = vt;
    try {
      await vt.finished;
    } catch {
      /* skipped */
    }
    name(target, false);
    if (running === vt) running = null;
    return;
  }
  // Fallback: a card-shaped panel zooms between the card and the view.
  const fromRect = o.from?.getBoundingClientRect() || null;
  o.update();
  const target = o.to();
  const toRect = target?.getBoundingClientRect() || null;
  const page = o.reveal();
  page?.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
    duration: 300,
    delay: 90,
    easing: 'cubic-bezier(.2,.8,.2,1)',
    fill: 'backwards',
  });
  if (!fromRect || !toRect) return;
  const z = document.createElement('div');
  z.className = 'ad-zoom';
  Object.assign(z.style, { left: '0', top: '0', width: fromRect.width + 'px', height: fromRect.height + 'px' });
  document.body.append(z);
  const at = (r: DOMRect): string => `translate(${r.left}px,${r.top}px)`;
  const a = z.animate(
    [
      { transform: at(fromRect), width: fromRect.width + 'px', height: fromRect.height + 'px', opacity: 1 },
      { transform: at(toRect), width: toRect.width + 'px', height: toRect.height + 'px', opacity: 0 },
    ],
    { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
  );
  await a.finished.catch(() => undefined);
  z.remove();
}
