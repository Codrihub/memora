// Full-screen image viewer for rendered notes.
//
// One delegated click listener on document (capture phase, so cards and
// readers that handle clicks themselves do not swallow it) opens any
// `.note-body img` that is not inside a link. Esc, a click on the scrim or
// the close button closes it. Clicking an image larger than the screen
// toggles between "fit" and actual size; in actual size the viewer scrolls,
// and phones keep native pinch-zoom.

import { useStyles } from '../dom';

const CSS = `
.lbx{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:rgba(3,6,12,.9);
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#e8ecf3;opacity:0;transition:opacity .18s ease;
  touch-action:pinch-zoom pan-x pan-y}
.lbx.on{opacity:1}
.lbx-stage{flex:1;min-height:0;overflow:auto;display:grid;place-items:center;padding:56px 16px calc(16px + env(safe-area-inset-bottom,0px));
  overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.lbx-stage img{display:block;max-width:100%;max-height:calc(100vh - 120px);max-height:calc(100dvh - 120px);width:auto;height:auto;
  object-fit:contain;border-radius:10px;box-shadow:0 30px 80px -20px rgba(0,0,0,.8);background:rgba(255,255,255,.04);
  transform:scale(.97);transition:transform .2s cubic-bezier(.16,1,.3,1);cursor:zoom-out;user-select:none}
.lbx.on .lbx-stage img{transform:none}
.lbx.can-zoom .lbx-stage img{cursor:zoom-in}
.lbx.zoomed .lbx-stage{place-items:start}
.lbx.zoomed .lbx-stage img{max-width:none;max-height:none;cursor:zoom-out;border-radius:0}
.lbx-bar{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 12px 10px 16px;
  background:rgba(3,6,12,.72);pointer-events:none}
.lbx-cap{flex:1;min-width:0;font-size:13px;line-height:1.4;color:#c6cfdb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lbx-bar a,.lbx-bar button{all:unset;box-sizing:border-box;cursor:pointer;height:36px;min-width:36px;padding:0 12px;
  display:inline-grid;place-items:center;border-radius:10px;font-size:12.5px;font-weight:600;color:#e8ecf3;
  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)}
.lbx-bar a{pointer-events:auto}
.lbx-bar button{pointer-events:auto;font-size:20px;line-height:1;padding:0}
.lbx-bar a:hover,.lbx-bar button:hover{background:rgba(255,255,255,.16)}
.lbx-bar a:focus-visible,.lbx-bar button:focus-visible{outline:2px solid #5eead4;outline-offset:2px}
.lbx-nav{all:unset;position:absolute;top:50%;translate:0 -50%;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;cursor:pointer;
  color:#e8ecf3;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);font-size:22px;line-height:1}
.lbx-nav:hover{background:rgba(255,255,255,.2)}
.lbx-nav:focus-visible{outline:2px solid #5eead4;outline-offset:2px}
.lbx-nav.prev{left:12px}.lbx-nav.next{right:12px}
.lbx-nav[hidden],.lbx.zoomed .lbx-nav,.lbx-bar a[hidden]{display:none}
.lbx-n{flex:none;font-size:12.5px;font-weight:600;color:#c6cfdb;font-variant-numeric:tabular-nums}
@media (max-width:640px){.lbx-nav{width:38px;height:38px;font-size:19px}}
@media (prefers-reduced-motion:reduce){.lbx,.lbx-stage img{transition:none}}
`;

let open: HTMLElement | null = null;
let lastFocus: Element | null = null;
let prevOverflow = '';

function close(): void {
  if (!open) return;
  const node = open;
  open = null;
  step = null;
  document.removeEventListener('keydown', onKey, true);
  document.documentElement.style.overflow = prevOverflow;
  node.classList.remove('on');
  window.setTimeout(() => node.remove(), 180);
  if (lastFocus instanceof HTMLElement) lastFocus.focus({ preventScroll: true });
}

/** Step through the note's images (set while a gallery is open). */
let step: ((d: number) => void) | null = null;

/** Only real image URLs get an "Open original" link (never javascript: and the like). */
function safeHref(src: string): string | null {
  try {
    const u = new URL(src, location.href);
    return ['http:', 'https:', 'blob:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function setOriginal(a: HTMLAnchorElement, src: string): void {
  const href = safeHref(src);
  a.hidden = !href;
  if (href) a.href = href;
  else a.removeAttribute('href');
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Tab' && open) {
    // Keep focus inside the dialog.
    const items = Array.from(open.querySelectorAll<HTMLElement>('a[href],button')).filter((n) => n.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const inside = open.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
      e.preventDefault();
      first.focus();
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    close();
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && step) {
    e.preventDefault();
    e.stopPropagation();
    step(e.key === 'ArrowLeft' ? -1 : 1);
  }
}

export interface LightboxImage {
  src: string;
  caption: string;
}

/**
 * Show `src` full screen with `caption` (the image's alt text). With `set`,
 * the arrows, arrow keys and a sideways swipe move through the note's images.
 */
function openLightbox(src: string, caption: string, set: LightboxImage[] = [], at = 0): void {
  close();
  useStyles('lightbox-css', CSS);
  lastFocus = document.activeElement;

  const root = document.createElement('div');
  root.className = 'lbx';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', caption || 'Image');

  const bar = document.createElement('div');
  bar.className = 'lbx-bar';
  const cap = document.createElement('div');
  cap.className = 'lbx-cap';
  cap.textContent = caption;
  const orig = document.createElement('a');
  setOriginal(orig, src);
  orig.target = '_blank';
  orig.rel = 'noopener noreferrer';
  orig.textContent = 'Open original';
  const x = document.createElement('button');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  x.textContent = '×';
  x.onclick = (e) => {
    e.stopPropagation();
    close();
  };
  bar.append(cap, orig, x);

  const stage = document.createElement('div');
  stage.className = 'lbx-stage';
  const img = document.createElement('img');
  img.alt = caption;
  img.decoding = 'async';
  img.src = src;
  stage.append(img);
  root.append(stage, bar);

  const many = set.length > 1;
  let idx = Math.max(0, Math.min(at, set.length - 1));
  const count = document.createElement('div');
  count.className = 'lbx-n';
  const nav = (cls: string, label: string, ch: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lbx-nav ' + cls;
    b.setAttribute('aria-label', label);
    b.textContent = ch;
    b.hidden = !many;
    root.append(b);
    return b;
  };
  const prev = nav('prev', 'Previous image', '‹');
  const next = nav('next', 'Next image', '›');
  if (many) bar.insertBefore(count, orig);
  const show = (i: number): void => {
    idx = (i + set.length) % set.length;
    const it = set[idx];
    root.classList.remove('zoomed');
    img.src = it.src;
    img.alt = it.caption;
    cap.textContent = it.caption;
    setOriginal(orig, it.src);
    count.textContent = `${idx + 1} / ${set.length}`;
  };
  step = many ? (d) => show(idx + d) : null;
  if (many) {
    count.textContent = `${idx + 1} / ${set.length}`;
    prev.onclick = (e) => {
      e.stopPropagation();
      show(idx - 1);
    };
    next.onclick = (e) => {
      e.stopPropagation();
      show(idx + 1);
    };
    // A sideways swipe moves too (not while zoomed in, where it pans).
    let sx = 0;
    let sy = 0;
    stage.addEventListener('touchstart', (e) => {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (root.classList.contains('zoomed') || e.touches.length) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(idx + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  // Zoom only helps when the image is larger than the space it is fit into.
  const measure = (): void => {
    const big = img.naturalWidth > img.clientWidth + 2 || img.naturalHeight > img.clientHeight + 2;
    root.classList.toggle('can-zoom', big && !root.classList.contains('zoomed'));
    root.dataset.big = big ? '1' : '';
  };
  img.addEventListener('load', measure);

  root.addEventListener('click', (e) => {
    if (e.target === img && (root.dataset.big === '1' || root.classList.contains('zoomed'))) {
      const zoomed = root.classList.toggle('zoomed');
      root.classList.toggle('can-zoom', !zoomed);
      if (zoomed) {
        // Keep the clicked spot under the pointer, roughly.
        const r = img.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width;
        const fy = (e.clientY - r.top) / r.height;
        requestAnimationFrame(() => {
          stage.scrollLeft = fx * stage.scrollWidth - stage.clientWidth / 2;
          stage.scrollTop = fy * stage.scrollHeight - stage.clientHeight / 2;
        });
      }
      return;
    }
    if (e.target instanceof Element && e.target.closest('.lbx-bar a')) return;
    close();
  });

  prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.body.append(root);
  open = root;
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => root.classList.add('on'));
  x.focus({ preventScroll: true });
  if (img.complete) measure();
}

let wired = false;

/** Open images in rendered notes (`.note-body img`) in the lightbox. */
export function initLightbox(): void {
  if (wired) return;
  wired = true;
  document.addEventListener(
    'click',
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const t = e.target;
      if (!(t instanceof HTMLImageElement) || !t.closest('.note-body')) return;
      // An image inside a link follows the link; editors keep their own clicks.
      if (t.closest('a[href],[contenteditable="true"]')) return;
      const src = t.currentSrc || t.src;
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      const capOf = (im: HTMLImageElement): string => im.alt || im.closest('figure')?.querySelector('figcaption')?.textContent || '';
      // Every image of the same note, in order, so the arrows walk through them.
      const all = Array.from(t.closest('.note-body')!.querySelectorAll<HTMLImageElement>('img')).filter(
        (im) => !im.closest('a[href]') && (im.currentSrc || im.src),
      );
      const set = all.map((im) => ({ src: im.currentSrc || im.src, caption: capOf(im) }));
      openLightbox(src, capOf(t), set, Math.max(0, all.indexOf(t)));
    },
    true,
  );
}
