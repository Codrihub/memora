// Documentation page: /docs and /docs/<section>#<heading>. Section changes inside the page push history entries
// themselves; back and forward come through the router.

import { $, esc, useStyles } from '../dom';
import { copyText } from '../control/ui';
import { go, isPage } from '../router';
import { icon } from '../ui/icons';
import { fadeScroll } from '../ui/scroll-fade';
import { HEADING_PREFIX } from '../docs/markdown';
import { SECTIONS, SOURCE_URL, findSection, pageCtx, type DocSection } from '../docs/content';
import { DOCS_CSS } from '../docs/styles';
import { TOOL_ROW_CSS } from './tools';

const DEFAULT = SECTIONS[0].slug;
/** `current` while the "Page not found in help" article is shown. */
const MISSING = '\0missing';

const MISSING_CSS = `
.dc-miss-acts{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 8px}
.dc-miss-sug{margin:0 0 10px;font-size:13px;font-weight:650;color:var(--muted)}
`;

interface Heading {
  level: number;
  id: string;
  text: string;
}

let current = '';
let headings: Heading[] = [];
let spyFrame = 0;
/** A heading picked in the contents, held until its jump stops scrolling. */
let heldAnchor = '';
let heldTimer = 0;
/** Plain text and headings of every section, built on the first search. */
let index: { sec: DocSection; text: string; heads: Heading[] }[] | null = null;

/** Text of an HTML fragment we generated ourselves (never inserted live). */
function textOf(html: string): string {
  const t = document.createElement('template');
  t.innerHTML = html;
  return (t.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function headingsOf(html: string): Heading[] {
  const out: Heading[] = [];
  const re = new RegExp(`<h([23]) id="${HEADING_PREFIX}([^"]+)"[^>]*><span>([\\s\\S]*?)</span>`, 'g');
  for (const m of html.matchAll(re)) out.push({ level: Number(m[1]), id: textOf(m[2]), text: textOf(m[3]) });
  return out;
}

/** The section and heading a docs URL names. */
function routeOf(): { slug: string; hash: string; known: boolean } {
  const path = location.pathname.replace(/\/+$/, '');
  const raw = path.startsWith('/docs/') ? path.slice(6) : '';
  let slug = raw;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    /* keep raw; it will not match a section */
  }
  let hash = location.hash.slice(1);
  try {
    hash = decodeURIComponent(hash);
  } catch {
    /* keep raw */
  }
  if (!slug) return { slug: DEFAULT, hash, known: true };
  return { slug, hash, known: !!findSection(slug) };
}

function docUrl(slug: string, hash = ''): string {
  return '/docs/' + slug + (hash ? '#' + encodeURIComponent(hash) : '');
}

function navHTML(): string {
  const groups: [string, DocSection[]][] = [];
  for (const s of SECTIONS) {
    const g = groups.find(([name]) => name === s.group);
    if (g) g[1].push(s);
    else groups.push([s.group, [s]]);
  }
  return groups
    .map(
      ([name, list]) => `<div class="dc-group"><p class="dc-group-t">${esc(name)}</p><ul>${list
        .map(
          (s) =>
            `<li><a class="dc-link" href="${docUrl(s.slug)}" data-doc="${s.slug}" data-hash="">${esc(s.title)}</a><ul class="dc-sub hidden" data-sub="${s.slug}"></ul></li>`,
        )
        .join('')}</ul></div>`,
    )
    .join('');
}

function buildShell(host: HTMLElement): void {
  host.innerHTML = `<div class="dc">
    <div class="dc-mbar">
      <button type="button" class="dc-mtoggle" aria-expanded="false" aria-controls="dcSide">${icon('book')}<span id="dcMTitle">Documentation</span>${icon(
        'chev-down',
        'i chev',
      )}</button>
    </div>
    <aside class="dc-side" id="dcSide" aria-label="Documentation sections">
      <div class="dc-search" role="search">${icon('search')}<input id="dcQ" type="search" placeholder="Search docs" aria-label="Search the documentation" autocomplete="off" spellcheck="false"></div>
      <nav class="dc-nav" id="dcNav" aria-label="Sections">${navHTML()}</nav>
    </aside>
    <main class="dc-main" id="dcMain" tabindex="-1">
      <article class="dc-article" id="dcArticle"></article>
    </main>
    <aside class="dc-toc" aria-label="On this page"><p class="dc-toc-t">On this page</p><ul id="dcToc"></ul>
      <a class="dc-top" href="#" data-top>${icon('arrow', 'i')}Back to top</a></aside>
  </div>`;
  const root = $('.dc', host);
  root.addEventListener('click', onClick);
  fadeScroll($('#dcSide', root));
  $('#dcMain', root).addEventListener('scroll', () => {
    if (heldAnchor) {
      clearTimeout(heldTimer);
      heldTimer = window.setTimeout(() => (heldAnchor = ''), 160);
      return;
    }
    if (!spyFrame) spyFrame = requestAnimationFrame(spy);
  });
  const q = $('#dcQ', root) as HTMLInputElement;
  q.addEventListener('input', () => paintSearch(q.value));
  q.addEventListener('keydown', onSearchKey);
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('nav-open')) {
      setDrawer(false);
      $('.dc-mtoggle', root).focus();
    }
  });
  $('.dc-mtoggle', root).addEventListener('click', () => setDrawer(!root.classList.contains('nav-open')));
}

function setDrawer(open: boolean): void {
  const root = document.querySelector<HTMLElement>('#view-docs .dc');
  if (!root) return;
  root.classList.toggle('nav-open', open);
  $('.dc-mtoggle', root).setAttribute('aria-expanded', String(open));
}

function articleHTML(sec: DocSection, body: string): string {
  const i = SECTIONS.indexOf(sec);
  const prev = SECTIONS[i - 1];
  const next = SECTIONS[i + 1];
  const pager =
    prev || next
      ? `<nav class="dc-pager" aria-label="Previous and next">${
          prev ? `<a class="prev" href="${docUrl(prev.slug)}" data-doc="${prev.slug}" data-hash=""><small>Previous</small>${esc(prev.title)}</a>` : ''
        }${next ? `<a class="next" href="${docUrl(next.slug)}" data-doc="${next.slug}" data-hash=""><small>Next</small>${esc(next.title)}</a>` : ''}</nav>`
      : '';
  const meta = sec.source
    ? `<div class="dc-meta"><span>From <code>${esc(sec.source)}</code></span><a href="${esc(
        SOURCE_URL(sec.source),
      )}" target="_blank" rel="noopener noreferrer">${icon('arrow')}View on GitHub</a></div>`
    : '<div class="dc-meta"></div>';
  return `<p class="dc-eyebrow"><span>Documentation</span>${icon('chev-right')}<span>${esc(sec.group)}</span></p><h1>${esc(sec.title)}</h1><p class="dc-lead">${esc(sec.lead)}</p>${meta}
    <div class="dc-body">${body}</div>${pager}`;
}

function paintToc(): void {
  const article = $('#dcArticle');
  headings = Array.from(article.querySelectorAll<HTMLElement>('.dc-body h2.dc-h, .dc-body h3.dc-h')).map((h) => ({
    level: h.tagName === 'H2' ? 2 : 3,
    id: h.id.slice(HEADING_PREFIX.length),
    text: (h.querySelector('span')?.textContent || '').trim(),
  }));
  const toc = $('#dcToc');
  toc.innerHTML = headings
    .map((h) => `<li><a class="l${h.level}" href="#${esc(h.id)}" data-anchor="${esc(h.id)}">${esc(h.text)}</a></li>`)
    .join('');
  toc.parentElement!.classList.toggle('hidden', headings.length < 2);
  // The open section lists its main headings in the sidebar too.
  document.querySelectorAll<HTMLElement>('#dcNav [data-sub]').forEach((ul) => {
    const on = ul.dataset.sub === current;
    const h2 = on ? headings.filter((h) => h.level === 2) : [];
    ul.classList.toggle('hidden', h2.length < 2);
    ul.innerHTML = h2.map((h) => `<li><a href="#${esc(h.id)}" data-anchor="${esc(h.id)}">${esc(h.text)}</a></li>`).join('');
  });
  spy();
}

/** Highlight the heading the reader is in, in the contents and the sidebar. */
function spy(): void {
  spyFrame = 0;
  const main = document.getElementById('dcMain');
  if (!main || !headings.length || heldAnchor) return;
  const box = main.getBoundingClientRect();
  const line = box.top + Math.min(160, box.height * 0.3);
  // Above the first heading (the intro), the first section is current.
  let at = headings[0].id;
  for (const h of headings) {
    const el = document.getElementById(HEADING_PREFIX + h.id);
    if (!el || el.getBoundingClientRect().top > line) break;
    at = h.id;
  }
  // At the very bottom, the last heading on screen counts, even when it cannot scroll up to the line.
  if (main.scrollTop + main.clientHeight >= main.scrollHeight - 4) {
    for (const h of headings) {
      const el = document.getElementById(HEADING_PREFIX + h.id);
      if (el && el.getBoundingClientRect().top < box.bottom) at = h.id;
    }
  }
  paintSpy(at);
}

function paintSpy(at: string): void {
  const i = headings.findIndex((h) => h.id === at);
  const at2 = i < 0 ? '' : headings.slice(0, i + 1).reverse().find((h) => h.level === 2)?.id || '';
  document.querySelectorAll<HTMLElement>('#dcToc a').forEach((a) => a.classList.toggle('on', a.dataset.anchor === at));
  document.querySelectorAll<HTMLElement>('#dcNav .dc-sub a').forEach((a) => a.classList.toggle('on', a.dataset.anchor === at2));
}

/** Mark a heading at once (a click) and keep it until the jump stops scrolling. */
function holdSpy(id: string): void {
  heldAnchor = id;
  paintSpy(id);
  clearTimeout(heldTimer);
  heldTimer = window.setTimeout(() => (heldAnchor = ''), 900);
}

function scrollToAnchor(id: string, smooth: boolean): boolean {
  const main = document.getElementById('dcMain');
  const el = document.getElementById(HEADING_PREFIX + id) || document.getElementById('tool-' + id);
  if (!main || !el || !main.contains(el)) return false;
  const y = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 16;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  main.scrollTo({ top: Math.max(0, y), behavior: smooth && !reduce ? 'smooth' : 'auto' });
  return true;
}

/** Sections whose title or text mention the words of a missing slug, best first. */
function suggestions(slug: string): DocSection[] {
  const words = slug
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (!words.length) return [];
  return buildIndex()
    .map((e) => {
      const title = e.sec.title.toLowerCase();
      const score = words.reduce((n, w) => n + (title.includes(w) ? 10 : 0) + (e.text.includes(w) ? 1 : 0), 0);
      return { sec: e.sec, score, inTitle: words.some((w) => title.includes(w)) };
    })
    .filter((x) => x.sec !== SECTIONS[0] && (x.inTitle || x.score >= words.length))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.sec);
}

/** An unknown section: say so plainly, with the closest pages, Get started and search. */
function showMissing(slug: string): void {
  current = MISSING;
  headings = [];
  const sug = suggestions(slug);
  const first = SECTIONS[0];
  const card = (sec: DocSection): string =>
    `<a class="dc-card" href="${docUrl(sec.slug)}" data-doc="${sec.slug}" data-hash=""><b>${esc(sec.title)}</b><span>${esc(sec.lead)}</span></a>`;
  $('#dcArticle').innerHTML = `<p class="dc-eyebrow"><span>Documentation</span></p><h1>Page not found in help</h1>
    <p class="dc-lead">There is no help page called “${esc(slug)}”. The link may be old or mistyped.</p>
    <div class="dc-miss-acts">
      <a class="btn primary" href="${docUrl(first.slug)}" data-doc="${first.slug}" data-hash="">Go to ${esc(first.title)}</a>
      <button type="button" class="btn" data-miss-search>${icon('search')}Search the help</button>
    </div>
    ${sug.length ? `<div class="dc-body"><p class="dc-miss-sug">Maybe you meant</p><div class="dc-cards">${sug.map(card).join('')}</div></div>` : ''}`;
  $('#dcMain').scrollTop = 0;
  document.querySelectorAll<HTMLElement>('#dcNav .dc-link').forEach((a) => {
    a.classList.remove('active');
    a.removeAttribute('aria-current');
  });
  $('#dcMTitle').textContent = 'Page not found';
  document.title = 'Page not found · Documentation · Memora';
  paintToc();
  setDrawer(false);
}

function show(slug: string, hash: string): void {
  const sec = findSection(slug);
  if (!sec) {
    showMissing(slug);
    return;
  }
  const main = $('#dcMain');
  if (sec.slug !== current) {
    current = sec.slug;
    const ctx = pageCtx(sec.slug);
    const article = $('#dcArticle');
    article.innerHTML = articleHTML(sec, sec.render(ctx));
    main.scrollTop = 0;
    document.querySelectorAll<HTMLElement>('#dcNav .dc-link').forEach((a) => {
      const on = a.dataset.doc === sec.slug;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('#dcMTitle').innerHTML = `${esc(sec.title)} <small>· ${esc(sec.group)}</small>`;
    document.title = sec.title + ' · Documentation · Memora';
    paintToc();
    if (sec.mount) {
      void sec.mount(article, ctx).then(() => {
        if (current !== sec.slug) return;
        paintToc();
        const want = routeOf();
        if (want.slug === sec.slug && want.hash) scrollToAnchor(want.hash, false);
      });
    }
  }
  if (hash) {
    if (!scrollToAnchor(hash, false) && !sec.mount) main.scrollTop = 0;
  }
  setDrawer(false);
}

/** Open a section from inside the page (a new history entry). */
function open(slug: string, hash: string): void {
  const url = docUrl(slug, hash);
  if (location.pathname + location.hash !== url) {
    try {
      history.pushState({ page: 'docs' }, '', url);
    } catch {
      /* sandboxed frames */
    }
  }
  const same = slug === current;
  show(slug, hash);
  if (same && hash) scrollToAnchor(hash, true);
  else if (same && !hash) $('#dcMain').scrollTo({ top: 0, behavior: 'smooth' });
  if (!same) $('#dcMain').focus({ preventScroll: true });
}

function onClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  const copy = t.closest<HTMLElement>('[data-copy-code]');
  if (copy) {
    const text = copy.closest('.dc-code')?.querySelector('pre')?.textContent || '';
    void copyText(text, 'Copied to the clipboard');
    copy.textContent = 'Copied';
    copy.classList.add('done');
    window.setTimeout(() => {
      copy.textContent = 'Copy';
      copy.classList.remove('done');
    }, 1600);
    return;
  }
  if (t.closest('[data-miss-search]')) {
    const q = $('#dcQ') as HTMLInputElement;
    setDrawer(true);
    q.focus();
    q.select();
    return;
  }
  const a = t.closest<HTMLAnchorElement>('a');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.dataset.doc) {
    e.preventDefault();
    open(a.dataset.doc, a.dataset.hash || '');
  } else if (a.dataset.anchor !== undefined) {
    e.preventDefault();
    const id = a.dataset.anchor;
    holdSpy(id);
    scrollToAnchor(id, true);
    try {
      history.replaceState(history.state, '', docUrl(current, id));
    } catch {
      /* sandboxed frames */
    }
    if (a.classList.contains('dc-anchor')) void copyText(location.href, 'Link copied');
    setDrawer(false);
  } else if (a.dataset.top !== undefined) {
    e.preventDefault();
    $('#dcMain').scrollTo({ top: 0, behavior: 'smooth' });
  } else if (a.dataset.app && isPage(a.dataset.app)) {
    e.preventDefault();
    go(a.dataset.app);
  }
}

function buildIndex(): NonNullable<typeof index> {
  if (!index) {
    index = SECTIONS.map((sec) => {
      const html = sec.render(pageCtx(sec.slug));
      return { sec, text: (sec.title + ' ' + sec.lead + ' ' + textOf(html)).toLowerCase(), heads: headingsOf(html) };
    });
  }
  return index;
}

function mark(text: string, words: string[]): string {
  let out = esc(text);
  for (const w of words) {
    if (w.length < 2) continue;
    out = out.replace(new RegExp(esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
  }
  return out;
}

function paintSearch(raw: string): void {
  const nav = $('#dcNav');
  const q = raw.trim().toLowerCase();
  if (!q) {
    nav.innerHTML = navHTML();
    nav.querySelectorAll<HTMLElement>('.dc-link').forEach((a) => {
      const on = a.dataset.doc === current;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
    });
    paintToc();
    return;
  }
  const words = q.split(/\s+/).filter(Boolean);
  const hits = buildIndex()
    .filter((e) => words.every((w) => e.text.includes(w)))
    .map((e) => {
      const title = e.sec.title.toLowerCase();
      const heads = e.heads.filter((h) => words.some((w) => h.text.toLowerCase().includes(w))).slice(0, 4);
      const score = (words.every((w) => title.includes(w)) ? 100 : 0) + heads.length * 5;
      return { e, heads, score };
    })
    .sort((a, b) => b.score - a.score);
  nav.innerHTML = hits.length
    ? `<div class="dc-group"><p class="dc-group-t">${hits.length} ${hits.length === 1 ? 'section' : 'sections'}</p>${hits
        .map(
          ({ e, heads }) =>
            `<a class="dc-hit" href="${docUrl(e.sec.slug)}" data-doc="${e.sec.slug}" data-hash="">${mark(e.sec.title, words)}<small>${esc(
              e.sec.group,
            )}</small></a>${heads
              .map(
                (h) =>
                  `<a class="dc-hit-sub" href="${docUrl(e.sec.slug, h.id)}" data-doc="${e.sec.slug}" data-hash="${esc(h.id)}">${mark(h.text, words)}</a>`,
              )
              .join('')}`,
        )
        .join('')}</div>`
    : `<p class="dc-empty">No section mentions “${esc(raw.trim())}”.</p>`;
}

function onSearchKey(e: KeyboardEvent): void {
  const input = e.target as HTMLInputElement;
  if (e.key === 'Escape') {
    if (input.value) {
      e.stopPropagation();
      input.value = '';
      paintSearch('');
    } else input.blur();
  } else if (e.key === 'Enter') {
    const first = document.querySelector<HTMLAnchorElement>('#dcNav .dc-hit');
    if (first?.dataset.doc) {
      e.preventDefault();
      open(first.dataset.doc, '');
    }
  } else if (e.key === 'ArrowDown') {
    const first = document.querySelector<HTMLElement>('#dcNav a');
    if (first) {
      e.preventDefault();
      first.focus();
    }
  }
}

export function renderDocs(): void {
  // The risk chips of the tool reference come from the Tools page styles.
  useStyles('docs-css', DOCS_CSS + TOOL_ROW_CSS + MISSING_CSS);
  const host = $('#view-docs');
  if (!host.querySelector('.dc')) {
    current = '';
    buildShell(host);
  }
  const r = routeOf();
  // An unknown slug keeps its URL, so the reader sees what was asked for.
  show(r.slug, r.hash);
}
