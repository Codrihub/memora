// Theme choice, kept per device in localStorage (`memora.theme`): dark, light
// or system. Never stored on the server. The inline script in index.page.ts
// applies it before first paint; this module keeps it live afterwards.

export type ThemePref = 'dark' | 'light' | 'system';

const KEY = 'memora.theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

let watching = false;

/** The stored choice; missing or invalid means dark (the default). */
export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    /* storage can be unavailable in private mode */
  }
  return 'dark';
}

function systemTheme(): 'dark' | 'light' {
  try {
    return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Set `data-theme` on <html> from the stored choice. */
export function applyTheme(): void {
  const pref = themePref();
  const theme = pref === 'system' ? systemTheme() : pref;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f6fa' : '#07090e');
  if (!watching) {
    // "system" follows the OS setting while the page is open.
    watching = true;
    try {
      window.matchMedia(LIGHT_QUERY).addEventListener('change', () => {
        if (themePref() === 'system') applyTheme();
      });
    } catch {
      /* old browsers without matchMedia listeners keep the boot value */
    }
  }
}

/** Store a new choice for this device and apply it at once. */
export function setThemePref(pref: ThemePref): void {
  // Cross-fade colors for a moment so the switch feels smooth, not abrupt.
  const root = document.documentElement;
  root.classList.add('theme-anim');
  window.setTimeout(() => root.classList.remove('theme-anim'), 420);
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* the choice still applies to this page */
  }
  applyTheme();
  // Every theme control on screen (menu, Settings) follows the choice.
  window.dispatchEvent(new CustomEvent('memora:theme', { detail: pref }));
}

const ORDER: ThemePref[] = ['dark', 'light', 'system'];

/** Dark, then light, then system. Returns the new choice. */
export function cycleTheme(): ThemePref {
  const next = ORDER[(ORDER.indexOf(themePref()) + 1) % ORDER.length];
  setThemePref(next);
  return next;
}

export const THEME_LABEL: Record<ThemePref, string> = { dark: 'Dark', light: 'Light', system: 'System' };
export const THEME_ICON: Record<ThemePref, string> = { dark: 'moon', light: 'sun', system: 'monitor' };
