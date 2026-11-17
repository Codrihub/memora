// Mnemo's scrollbars show while something scrolls and fade a moment after it stops (the
// styles keep the track's width, so the thumb appears without moving anything).

const SCROLLERS = '.mn-log,.mnp-list,.mnp-art-b,.mnp-act,.mn-comp textarea';
const HIDE_AFTER = 900;
const timers = new WeakMap<Element, number>();
let on = false;

export function watchScrollbars(): void {
  if (on) return;
  on = true;
  document.addEventListener(
    'scroll',
    (e) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.matches(SCROLLERS)) return;
      t.classList.add('sb-on');
      window.clearTimeout(timers.get(t));
      timers.set(
        t,
        window.setTimeout(() => t.classList.remove('sb-on'), HIDE_AFTER),
      );
    },
    { capture: true, passive: true },
  );
}
