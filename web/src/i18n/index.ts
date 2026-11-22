// The interface language. English text is the key: `t('New chat')` looks it up in the chosen
// language's table and falls back to the English when a line is not translated yet.
// `{name}` placeholders are filled from `vars` (pass text already escaped where it goes into
// HTML). The choice is kept per device; Auto follows the browser.
//
// Each language's table is its own file (/i18n/<code>.js, built from i18n/lang/<code>.ts),
// loaded by index.html before app.js only when that language is picked; it sets
// `window.__MEMORA_I18N__ = {lang, t}`.

import { LANGS, LANG_KEY, pickLang, type LangInfo } from './langs';

export { LANGS };
export type Lang = string;
export type LangPref = 'auto' | string;

declare global {
  interface Window {
    __MEMORA_I18N__?: { lang: string; t: Record<string, string> };
  }
}

export function langPref(): LangPref {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v && (v === 'auto' || LANGS.some((l) => l.code === v))) return v;
  } catch {
    /* storage blocked */
  }
  return 'auto';
}

function browserLangs(): readonly string[] {
  try {
    return navigator.languages?.length ? navigator.languages : [navigator.language];
  } catch {
    return [];
  }
}

let cur = 'en';
let table: Record<string, string> | null = null;

/** The server's default language (set at setup or in Settings), from the page's meta tag. */
function serverDefault(): string {
  try {
    return document.querySelector('meta[name=memora-lang]')?.getAttribute('content') || '';
  } catch {
    return '';
  }
}

function apply(): void {
  const own = langPref();
  const dflt = serverDefault();
  cur = pickLang(own === 'auto' && dflt && dflt !== 'auto' ? dflt : own, browserLangs());
  const got = typeof window !== 'undefined' ? window.__MEMORA_I18N__ : undefined;
  // The table that came with the page, if it is this language's (else English shows).
  table = cur !== 'en' && got && got.lang === cur ? got.t : null;
  if (cur !== 'en' && !table) cur = 'en';
  try {
    document.documentElement.lang = info(cur).html;
    document.documentElement.dir = info(cur).rtl ? 'rtl' : 'ltr';
  } catch {
    /* no document (tests) */
  }
}

function info(code: string): LangInfo {
  return LANGS.find((l) => l.code === code) ?? LANGS[0];
}

apply();

/** The language the interface is shown in now. */
export function lang(): Lang {
  return cur;
}

/** The language's English name, for Mnemo ("Indonesian"). */
export function langName(l: Lang = cur): string {
  return info(l).english;
}

/** Keep the choice on this device; the page reloads so every screen is drawn in it. */
export function setLangPref(p: LangPref, reload = true): void {
  try {
    if (p === 'auto') localStorage.removeItem(LANG_KEY);
    else localStorage.setItem(LANG_KEY, p);
  } catch {
    /* storage blocked: this visit only */
  }
  if (reload) location.reload();
}

/** Translate one line of interface text. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = (table && table[s]) || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** One or many: `tn(n, '{n} note', '{n} notes')`; `{n}` is the count. */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n, ...vars });
}

const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'] as const;

/** Translate the page's own markup in place (the shell in index.html is built before any
 *  language is known): text nodes and labels whose English is a key. */
export function translateStatic(root: ParentNode = document.body): void {
  if (!table) return;
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = (n as Text).parentElement;
      return p && !p.closest('script,style,code,pre,textarea,[data-no-i18n]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const n of texts) {
    const raw = n.data;
    const key = raw.replace(/\s+/g, ' ').trim();
    const tr = key && table[key];
    if (tr) n.data = raw.replace(raw.trim(), tr);
  }
  (root as Element).querySelectorAll?.('[aria-label],[title],[placeholder],[alt]').forEach((el) => {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      const tr = v && table![v.trim()];
      if (tr) el.setAttribute(a, tr);
    }
  });
  const title = table[document.title];
  if (title) document.title = title;
}
