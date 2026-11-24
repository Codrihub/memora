// Phones: while the on-screen keyboard is open, the bottom tab bar slides away (it would float over
// the keyboard or the field being typed in) and bottom sheets sit on top of the keyboard. The page
// gets `kb-open` on <html> and `--kb-h`, the keyboard's height where the browser does not shrink
// the page for it (iOS Safari; Android Chrome resizes the page itself with interactive-widget).

const PHONE = '(max-width: 760px)';

function editable(n: Element | null): boolean {
  if (!(n instanceof HTMLElement)) return false;
  if (n.isContentEditable) return true;
  if (n instanceof HTMLTextAreaElement) return !n.readOnly && !n.disabled;
  if (n instanceof HTMLSelectElement) return false;
  if (n instanceof HTMLInputElement)
    return !n.readOnly && !n.disabled && !/^(checkbox|radio|button|submit|reset|range|color|file|image|hidden)$/.test(n.type);
  return false;
}

let tallest = 0;
let raf = 0;

function sync(): void {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    // The page's height with no keyboard: the tallest seen since the last turn of the screen.
    tallest = Math.max(tallest, window.innerHeight, h);
    const phone = window.matchMedia(PHONE).matches;
    const typing = editable(document.activeElement);
    const shrunk = tallest - h > 140;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    // A focused field on a touch phone means the keyboard is up (or about to be), even before the
    // viewport has finished shrinking.
    const open = phone && typing && (shrunk || coarse);
    root.classList.toggle('kb-open', open);
    const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    root.style.setProperty('--kb-h', open ? `${Math.round(kb)}px` : '0px');
    // No scrolling here: the browser keeps the caret in view itself, and scrolling a tall field
    // (the note editor) "into view" would show its empty end instead of the line being typed.
  });
}

export function watchKeyboard(): void {
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', () => window.setTimeout(sync, 80));
  window.visualViewport?.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('scroll', sync);
  window.addEventListener('orientationchange', () => {
    tallest = 0;
    sync();
  });
  sync();
}
