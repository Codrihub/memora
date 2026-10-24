// Command palette (Ctrl/Cmd+K or "/"): notes, note text, pages and actions.

import { apiGet } from './api';
import { $, esc, safeSnip } from './dom';
import { debounce } from './format';
import { hooks } from './hooks';
import { PAGE_META, PAGES } from './router';
import { allNotes, noteTitle, type Page } from './state';
import { icon } from './ui/icons';
import { fadeScroll } from './ui/scroll-fade';
import { score, similar, type Near } from './ui/match';
import type { NoteRef, SearchHit, SearchResult } from './types';

interface Command {
  id: string;
  title: string;
  hint?: string;
  icon: string;
  keywords?: string;
  kbd?: string;
  run: () => void;
}

interface Option {
  section: string;
  title: string;
  titleHtml?: string;
  sub?: string;
  snip?: string;
  /** Why a "maybe you meant" suggestion showed up. */
  why?: string;
  icon: string;
  kbd?: string;
  run: () => void;
}

const commands: Command[] = [];

export function registerCommands(list: Command[]): void {
  for (const c of list) {
    const i = commands.findIndex((x) => x.id === c.id);
    if (i >= 0) commands[i] = c;
    else commands.push(c);
  }
}

let options: Option[] = [];
let sel = 0;
let fullText: SearchHit[] = [];
let fullTextQ = '';
let loading = false;
let lastFocus: HTMLElement | null = null;
let seq = 0;

const isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
export const MOD_LABEL = isMac ? '⌘K' : 'Ctrl K';

function markWord(text: string, word: string): string {
  const at = text.indexOf(word);
  if (at < 0) return esc(text);
  return esc(text.slice(0, at)) + '<mark>' + esc(word) + '</mark>' + esc(text.slice(at + word.length));
}

let suggestNote = '';

function highlight(text: string, q: string): string {
  if (!q) return esc(text);
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  // Lower-casing can change the length; then the index would not line up.
  if (at >= 0 && t.length === text.length) {
    return esc(text.slice(0, at)) + '<mark>' + esc(text.slice(at, at + q.length)) + '</mark>' + esc(text.slice(at + q.length));
  }
  return esc(text);
}

function noteOption(n: NoteRef, q: string, section: string): Option {
  return {
    section,
    title: noteTitle(n.path),
    titleHtml: highlight(noteTitle(n.path), q),
    sub: (n.folder || '') + (n.path ? ' · ' + n.path : ''),
    icon: 'note',
    run: () => hooks.openNote(n.path),
  };
}

function pageOption(p: Page, q: string): Option {
  const m = PAGE_META[p];
  const n = PAGES.indexOf(p) + 1;
  return {
    section: 'Go to',
    title: m.label,
    titleHtml: highlight(m.label, q),
    sub: m.hint,
    icon: m.icon,
    kbd: n <= 9 ? 'Alt ' + n : undefined,
    run: () => hooks.go(p),
  };
}

function cmdOption(c: Command, q: string): Option {
  return { section: 'Actions', title: c.title, titleHtml: highlight(c.title, q), sub: c.hint, icon: c.icon, kbd: c.kbd, run: c.run };
}

function build(raw: string): void {
  const actionsOnly = raw.startsWith('>');
  const q = (actionsOnly ? raw.slice(1) : raw).trim().toLowerCase();
  const out: Option[] = [];

  if (!q && !actionsOnly) {
    const recent = allNotes()
      .filter((n) => n.mtime)
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
      .slice(0, 5);
    for (const n of recent) out.push(noteOption(n, '', 'Recent notes'));
    for (const c of commands.slice(0, 6)) out.push(cmdOption(c, ''));
    for (const p of PAGES) out.push(pageOption(p, ''));
    options = out;
    return;
  }

  const cmds = commands
    .map((c) => ({ c, s: Math.max(score(c.title, q), score(c.keywords || '', q) * 0.8) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  if (actionsOnly) {
    options = cmds.map((x) => cmdOption(x.c, q));
    return;
  }

  const pages = PAGES.map((p) => ({ p, s: Math.max(score(PAGE_META[p].label, q), score(p, q) * 0.9) }))
    .filter((x) => x.s > 10)
    .sort((a, b) => b.s - a.s);

  const notes = allNotes()
    .map((n) => ({ n, s: Math.max(score(n.name, q), score(n.path, q) * 0.7) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.n.mtime || 0) - (a.n.mtime || 0))
    .slice(0, 8);
  const exactPaths = new Set(notes.map((x) => x.n.path));
  const near = allNotes()
    .filter((n) => !exactPaths.has(n.path))
    .map((n) => ({ n, m: similar(n.name, q) }))
    .filter((x): x is { n: NoteRef; m: Near } => !!x.m)
    .sort((a, b) => b.m.s - a.m.s)
    .slice(0, 5);

  // Best kind first: a strong page or action match outranks weak note hits.
  const topNote = notes[0]?.s || 0;
  const topNav = Math.max(pages[0]?.s || 0, cmds[0]?.s || 0);
  const navFirst = topNav >= 45 && topNav >= topNote;
  const navBlock: Option[] = [
    ...pages.slice(0, 4).map((x) => pageOption(x.p, q)),
    ...cmds.slice(0, 5).map((x) => cmdOption(x.c, q)),
  ];
  const noteBlock = notes.map((x) => noteOption(x.n, q, 'Notes'));
  out.push(...(navFirst ? navBlock : noteBlock), ...(navFirst ? noteBlock : navBlock));

  if (fullTextQ === raw.trim()) {
    const seen = new Set(notes.map((x) => x.n.path));
    for (const h of fullText) {
      if (seen.has(h.path)) {
        const o = out.find((x) => x.section === 'Notes' && x.sub?.endsWith(' · ' + h.path));
        if (o && h.snippet) o.snip = h.snippet;
        continue;
      }
      out.push({
        section: 'In note text',
        title: noteTitle(h.path),
        sub: (h.folder || '') + ' · ' + h.path,
        snip: h.snippet,
        icon: 'search',
        run: () => hooks.openNote(h.path),
      });
    }
  }
  if (near.length) {
    const none = !out.length && fullTextQ === raw.trim();
    suggestNote = none ? `Nothing matches “${raw.trim()}”. Maybe you meant one of these:` : 'Maybe you meant:';
    const shown = new Set(out.map((o) => o.sub));
    for (const x of near) {
      const o = noteOption(x.n, '', 'suggest');
      o.titleHtml = markWord(x.n.name, x.m.word);
      o.why = x.m.why;
      if (!shown.has(o.sub)) out.push(o);
    }
  }
  options = out;
}

function render(): void {
  const list = $('#palList');
  const input = document.getElementById('palInput') as HTMLInputElement | null;
  if (!input) return;
  build(input.value);
  if (sel >= options.length) sel = Math.max(0, options.length - 1);
  let html = '';
  let section = '';
  options.forEach((o, i) => {
    if (o.section !== section) {
      section = o.section;
      html +=
        section === 'suggest'
          ? `<div class="pal-note" role="presentation">${esc(suggestNote)}</div>`
          : `<div class="pal-sec" role="presentation">${esc(section)}${
              section === 'In note text' && loading ? '<span class="pal-spin"></span>' : ''
            }</div>`;
    }
    html += `<div class="pal-opt" role="option" id="pal-o${i}" data-i="${i}" aria-selected="${i === sel}">
      <span class="po-ico">${icon(o.icon)}</span>
      <span class="po-main"><div class="po-title">${o.titleHtml ?? esc(o.title)}</div>${
        o.sub ? `<div class="po-sub">${esc(o.sub)}</div>` : ''
      }${o.snip ? `<div class="po-snip">${safeSnip(o.snip)}</div>` : ''}${o.why ? `<div class="po-why">${esc(o.why)}</div>` : ''}</span>
      <span class="po-hint">${o.kbd ? `<kbd>${esc(o.kbd)}</kbd>` : ''}<span class="ret">${icon('enter', 'i')}</span></span></div>`;
  });
  const q = input.value.trim();
  if (!options.length) {
    html = loading
      ? '<div class="pal-sec">Searching note text <span class="pal-spin"></span></div>'
      : q
        ? `<div class="pal-empty"><span class="pe-ico">${icon('search')}</span><b>No results for “${esc(q)}”</b><span>Nothing in note names, folders or text, and nothing spelled close to it. Try fewer letters, another spelling, or a word from inside a note.</span></div>`
        : '<div class="pal-empty">Type to search.</div>';
  } else if (q && loading && !options.some((o) => o.section === 'In note text')) {
    html += '<div class="pal-sec">In note text <span class="pal-spin"></span></div>';
  }
  list.innerHTML = html;
  input.setAttribute('aria-activedescendant', options.length ? 'pal-o' + sel : '');
  list.querySelectorAll<HTMLElement>('.pal-opt').forEach((n) => {
    n.onmousemove = () => {
      const i = Number(n.dataset.i);
      if (i !== sel) select(i, false);
    };
    n.onclick = () => runAt(Number(n.dataset.i));
  });
}

function select(i: number, scroll = true): void {
  if (!options.length) return;
  sel = (i + options.length) % options.length;
  const list = $('#palList');
  list.querySelectorAll<HTMLElement>('.pal-opt').forEach((n) => {
    n.setAttribute('aria-selected', String(Number(n.dataset.i) === sel));
  });
  $('#palInput').setAttribute('aria-activedescendant', 'pal-o' + sel);
  if (scroll) $('#pal-o' + sel, list).scrollIntoView?.({ block: 'nearest' });
}

function runAt(i: number): void {
  const o = options[i];
  if (!o) return;
  closePalette(false);
  o.run();
}

const runSearch = debounce(async (q: string) => {
  const mine = ++seq;
  try {
    const d = await apiGet<SearchResult>('/api/search?q=' + encodeURIComponent(q));
    if (mine !== seq) return;
    fullText = (d.hits || []).slice(0, 12);
    fullTextQ = q;
  } catch {
    if (mine !== seq) return;
    fullText = [];
    fullTextQ = q;
  }
  loading = false;
  if (isOpen()) render();
}, 200);

function onInput(): void {
  const input = document.getElementById('palInput') as HTMLInputElement;
  const q = input.value.trim();
  sel = 0;
  if (q && !q.startsWith('>') && q.length >= 2) {
    loading = true;
    void runSearch(q);
  } else {
    loading = false;
    seq++;
  }
  render();
}

function isOpen(): boolean {
  return !$('#palette').classList.contains('hidden');
}

export function openPalette(initial = ''): void {
  const host = $('#palette');
  if (host.classList.contains('closing')) {
    clearTimeout(closeTimer);
    finishClose(false);
  }
  if (isOpen()) {
    const input = document.getElementById('palInput') as HTMLInputElement | null;
    input?.focus();
    input?.select();
    return;
  }
  lastFocus = document.activeElement as HTMLElement | null;
  host.innerHTML = `<div class="pal" role="dialog" aria-modal="true" aria-label="Search and commands">
    <div class="pal-in">${icon('search')}
      <input id="palInput" type="search" placeholder="${
        window.matchMedia?.('(max-width: 760px)').matches ? 'Search notes, pages, > actions' : 'Search notes, jump to a page, or type > for actions'
      }" autocomplete="off" spellcheck="false"
        role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list" aria-label="Search notes, pages and actions">
      <button class="icon-btn" type="button" id="palClose" aria-label="Close search" title="Close (Esc)">${icon('close')}</button>
    </div>
    <div class="pal-list" id="palList" role="listbox" aria-label="Results"></div>
    <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>&gt;</kbd> actions</span><span style="margin-left:auto"><kbd>esc</kbd> close</span></div>
    <div class="pal-closebar"><button class="pal-closebtn" type="button" id="palCloseBottom"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>Close search</button></div>
  </div>`;
  host.classList.remove('hidden');
  fadeScroll(document.getElementById('palList'));
  const input = document.getElementById('palInput') as HTMLInputElement;
  input.value = initial;
  input.oninput = onInput;
  input.onkeydown = onKey;
  $('#palClose').onclick = () => closePalette();
  $('#palCloseBottom').onclick = () => closePalette();
  // Phones: fit above the on-screen keyboard so the Close bar stays visible.
  fitToViewport();
  window.visualViewport?.addEventListener('resize', fitToViewport);
  window.visualViewport?.addEventListener('scroll', fitToViewport);
  host.onmousedown = (e) => {
    if (e.target === host) closePalette();
  };
  sel = 0;
  onInput();
  requestAnimationFrame(() => input.focus());
}

function fitToViewport(): void {
  const vv = window.visualViewport;
  const host = document.getElementById('palette');
  if (!vv || !host) return;
  host.style.setProperty('--pal-h', Math.round(vv.height) + 'px');
  host.style.setProperty('--pal-top', Math.round(vv.offsetTop) + 'px');
}

let closeTimer = 0;

export function closePalette(restore = true): void {
  const host = $('#palette');
  if (!isOpen() || host.classList.contains('closing')) return;
  const soft = window.matchMedia?.('(max-width: 760px)').matches && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (soft) {
    host.classList.add('closing');
    closeTimer = window.setTimeout(() => finishClose(restore), 220);
    return;
  }
  finishClose(restore);
}

function finishClose(restore: boolean): void {
  const host = $('#palette');
  host.classList.remove('closing');
  host.classList.add('hidden');
  host.innerHTML = '';
  host.style.removeProperty('--pal-h');
  window.visualViewport?.removeEventListener('resize', fitToViewport);
  window.visualViewport?.removeEventListener('scroll', fitToViewport);
  seq++;
  loading = false;
  if (restore && lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}

function onKey(e: KeyboardEvent): void {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      select(sel + 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      select(sel - 1);
      break;
    case 'Tab':
      e.preventDefault();
      select(sel + (e.shiftKey ? -1 : 1));
      break;
    case 'PageDown':
      e.preventDefault();
      select(Math.min(options.length - 1, sel + 6));
      break;
    case 'PageUp':
      e.preventDefault();
      select(Math.max(0, sel - 6));
      break;
    case 'Enter':
      e.preventDefault();
      runAt(sel);
      break;
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      if ((e.target as HTMLInputElement).value) {
        (e.target as HTMLInputElement).value = '';
        onInput();
      } else closePalette();
      break;
  }
}

const SEARCH_HINTS = ['Search notes, pages, actions…', 'Try: open brain', 'Try: new note', 'Try: > theme', 'Try: a note title'];

/** On hover the header search rotates example queries; the first few visits play that once on their own. */
function advertiseSearch(): void {
  const btn = $('#searchBtn');
  const label = btn.querySelector<HTMLElement>('.tb-search-label');
  if (!label) return;
  label.textContent = 'Search';
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let timer = 0;
  let i = 0;
  const show = (text: string): void => {
    if (still) {
      label.textContent = text;
      return;
    }
    label.classList.add('swap');
    window.setTimeout(() => {
      label.textContent = text;
      label.classList.remove('swap');
    }, 200);
  };
  const start = (): void => {
    window.clearInterval(timer);
    i = 0;
    show(SEARCH_HINTS[0]);
    if (!still) {
      timer = window.setInterval(() => {
        i = (i + 1) % SEARCH_HINTS.length;
        show(SEARCH_HINTS[i]);
      }, 2200);
    }
  };
  const stop = (): void => {
    window.clearInterval(timer);
    show('Search');
  };
  btn.addEventListener('mouseenter', start);
  btn.addEventListener('focus', start);
  btn.addEventListener('mouseleave', () => {
    if (document.activeElement !== btn) stop();
  });
  btn.addEventListener('blur', stop);
  if (still) return;
  let shown = 0;
  try {
    shown = Number(localStorage.getItem('memora.searchHint') || 0);
    localStorage.setItem('memora.searchHint', String(shown + 1));
  } catch {
    /* storage may be unavailable; show the hint anyway */
  }
  if (shown >= 3) return;
  window.setTimeout(() => {
    if (btn.matches(':hover')) return;
    btn.classList.add('hint');
    start();
    window.setTimeout(() => {
      btn.classList.remove('hint');
      if (!btn.matches(':hover')) stop();
    }, 2600);
  }, 4800);
}

export function wireSearch(): void {
  $('#searchBtn').onclick = () => openPalette();
  advertiseSearch();
  document.querySelectorAll<HTMLElement>('[data-kbd-mod]').forEach((k) => (k.textContent = MOD_LABEL));
  $('#searchBtn').setAttribute('aria-keyshortcuts', isMac ? 'Meta+K /' : 'Control+K /');
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (isOpen()) closePalette();
      else openPalette();
      return;
    }
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    const typing =
      !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (typing || isOpen() || !$('#modalHost').classList.contains('hidden')) return;
    e.preventDefault();
    openPalette();
  });
}
