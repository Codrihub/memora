import { useStyles } from '../dom';

const CSS = `
.fade-scroll{scrollbar-width:none;-ms-overflow-style:none;--fade:24px;scroll-padding-block:var(--fade)}
.fade-scroll::-webkit-scrollbar{display:none}
.fade-scroll.can-up{-webkit-mask-image:linear-gradient(to bottom,transparent,#000 var(--fade));mask-image:linear-gradient(to bottom,transparent,#000 var(--fade))}
.fade-scroll.can-down{-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - var(--fade)),transparent);mask-image:linear-gradient(to bottom,#000 calc(100% - var(--fade)),transparent)}
.fade-scroll.can-up.can-down{-webkit-mask-image:linear-gradient(to bottom,transparent,#000 var(--fade),#000 calc(100% - var(--fade)),transparent);
  mask-image:linear-gradient(to bottom,transparent,#000 var(--fade),#000 calc(100% - var(--fade)),transparent)}
.fade-scroll.can-left{-webkit-mask-image:linear-gradient(to right,transparent,#000 var(--fade));mask-image:linear-gradient(to right,transparent,#000 var(--fade))}
.fade-scroll.can-right{-webkit-mask-image:linear-gradient(to right,#000 calc(100% - var(--fade)),transparent);mask-image:linear-gradient(to right,#000 calc(100% - var(--fade)),transparent)}
.fade-scroll.can-left.can-right{-webkit-mask-image:linear-gradient(to right,transparent,#000 var(--fade),#000 calc(100% - var(--fade)),transparent);
  mask-image:linear-gradient(to right,transparent,#000 var(--fade),#000 calc(100% - var(--fade)),transparent)}
`;

const wired = new WeakSet<HTMLElement>();

/** Hide `el`'s scrollbar and fade its edges while it can scroll that way: up and down, or left
 *  and right with `axis` 'x' (right to left too). Safe to call again. */
export function fadeScroll(el: HTMLElement | null, axis: 'y' | 'x' = 'y'): void {
  if (!el || wired.has(el)) return;
  useStyles('scroll-fade-css', CSS);
  wired.add(el);
  el.classList.add('fade-scroll');
  let frame = 0;
  const update = (): void => {
    frame = 0;
    if (!el.isConnected) {
      ro?.disconnect();
      mo.disconnect();
      wired.delete(el);
      return;
    }
    if (axis === 'x') {
      // Right to left counts scrollLeft down from 0: the distance from the start is the same.
      const from = Math.abs(el.scrollLeft);
      const rest = el.scrollWidth - el.clientWidth - from;
      const rtl = getComputedStyle(el).direction === 'rtl';
      el.classList.toggle('can-left', (rtl ? rest : from) > 1);
      el.classList.toggle('can-right', (rtl ? from : rest) > 1);
      return;
    }
    const max = el.scrollHeight - el.clientHeight;
    el.classList.toggle('can-up', el.scrollTop > 1);
    el.classList.toggle('can-down', max - el.scrollTop > 1);
  };
  const later = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  el.addEventListener('scroll', later, { passive: true });
  // Accordions inside animate their height; measure again once they settle.
  el.addEventListener('transitionend', later);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
  ro?.observe(el);
  const mo = new MutationObserver(later);
  mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  later();
}
