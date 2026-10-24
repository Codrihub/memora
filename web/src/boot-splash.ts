// Boot splash controller, inlined into index.html by scripts/build-pages.mjs so it runs before app.js loads.

export interface BootSplash {
  /** A short status line and how far boot has come (0..1). */
  step(message: string, progress: number): void;
  fail(message: string, hint?: string): void;
  done(): void;
}

declare global {
  interface Window {
    memoraBoot?: BootSplash;
  }
}

const SLOW_MS = 8000;
/** Matches the CSS transition. */
const FADE_MS = 180;

function install(): void {
  const el = document.getElementById('splash');
  if (!el) return;
  const msg = el.querySelector<HTMLElement>('#splashMsg');
  const bar = el.querySelector<HTMLElement>('#splashBar');
  const help = el.querySelector<HTMLElement>('#splashHelp');
  const hint = el.querySelector<HTMLElement>('#splashHint');
  const reload = el.querySelector<HTMLButtonElement>('#splashReload');
  let over = false;
  let failed = false;

  const offer = (text: string, state: 'slow' | 'failed'): void => {
    el.dataset.state = state;
    if (hint) hint.textContent = text;
    if (help) help.hidden = false;
  };
  const slow = window.setTimeout(() => {
    if (!over && !failed) offer('This is taking longer than usual.', 'slow');
  }, SLOW_MS);
  if (reload) reload.onclick = () => location.reload();

  const api: BootSplash = {
    step(message, progress) {
      if (over || failed) return;
      if (msg) msg.textContent = message;
      if (bar) {
        const p = Math.max(0, Math.min(1, progress));
        bar.style.setProperty('--p', String(p));
        bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      }
    },
    fail(message, why = 'Check your connection, then reload.') {
      if (over) return;
      failed = true;
      window.clearTimeout(slow);
      if (msg) msg.textContent = message;
      offer(why, 'failed');
      reload?.focus();
    },
    done() {
      if (over) return;
      over = true;
      window.clearTimeout(slow);
      el.classList.add('gone');
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(() => el.remove(), still ? 0 : FADE_MS + 20);
    },
  };
  window.memoraBoot = api;

  // Resource errors do not bubble, so a failed app.js load is caught in the capture phase.
  window.addEventListener(
    'error',
    (e) => {
      const t = e.target as HTMLScriptElement | null;
      if (t && t.tagName === 'SCRIPT' && /\/app\.js(\?|$)/.test(t.src)) api.fail('Memora could not load.');
    },
    true,
  );
}

install();
