// The reader's side panel: Contents (outline, links, mentions) or Details; a side column on wide screens, a sheet otherwise.

import { attr, el, esc } from '../dom';
import { closePanel, openPanel } from './panel';
import { noteTitle } from '../state';
import { dirOf, folderColor, ROOT_LABEL } from './store';
import { fadeScroll } from '../ui/scroll-fade';

export interface ContentsData {
  heads: HTMLElement[];
  backlinks: { path: string; name: string }[];
  outs: { name: string; path: string | null }[];
  /** Rendered wikilinks in the body, in reading order. */
  links: HTMLElement[];
  /** The Details tab: property rows (folder, tags, dates, counts) as HTML. */
  details: string;
}

interface ContentsActions {
  open: (path: string) => void;
  create: (name: string, at: HTMLElement) => void;
  jump: (target: HTMLElement) => void;
  /** The heading being read right now (-1: none). */
  current: () => number;
  /** Details tab: a folder or a tag was picked. */
  folder: (path: string) => void;
  tag: (tag: string) => void;
}

type Tab = 'toc' | 'out' | 'back';
type Main = 'contents' | 'details';
let last: Tab = 'toc';
let lastMain: Main = 'contents';

const LS_OPEN = 'memora.reader.contents';

/** Whether the Contents card is open beside a wide reader (default: open). */
export function contentsOpen(): boolean {
  try {
    return localStorage.getItem(LS_OPEN) !== '0';
  } catch {
    return true;
  }
}

export function setContentsOpen(open: boolean): void {
  try {
    localStorage.setItem(LS_OPEN, open ? '1' : '0');
  } catch {
    /* storage blocked */
  }
}

const JUMP = `<svg class="vx-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M4 12h7M4 17h10"/><path d="M18 9v8M15 14l3 3 3-3"/></svg>`;

/**
 * The panel body. Its first child, `.vx-ct-main` (Contents or Details), may be moved into a header by the caller.
 * `inSheet` closes the sheet after a jump.
 */
export function contentsBody(d: ContentsData, act: ContentsActions, inSheet: boolean): HTMLElement {
  const body = el('div', 'vx-ct');
  const tabs: { k: Tab; label: string; n: number }[] = [
    { k: 'toc', label: 'Outline', n: d.heads.length },
    { k: 'out', label: 'Links', n: d.outs.length },
    { k: 'back', label: 'Mentions', n: d.backlinks.length },
  ];
  let main: Main = lastMain;
  const mainSeg = el('div', 'vx-ct-main');
  mainSeg.setAttribute('role', 'tablist');
  mainSeg.setAttribute('aria-label', 'Panel');
  const inner = el('div', 'vx-ct-inner');
  body.append(mainSeg, inner);
  // Open on the last tab used when it has something, else the first that does.
  let tab: Tab = tabs.find((t) => t.k === last && t.n)?.k || tabs.find((t) => t.n > 0)?.k || 'toc';
  // Each link's places in the text, so its jump button walks through them.
  const spots = new Map<string, HTMLElement[]>();
  for (const a of d.links) {
    const k = (a.textContent || '').trim().toLowerCase();
    spots.set(k, [...(spots.get(k) || []), a]);
  }
  const step = new Map<string, number>();
  const top = Math.min(...d.heads.map((h) => Number(h.tagName[1]) || 2), 6);
  const note = (path: string): string =>
    `<i style="--fc:${attr(folderColor(dirOf(path)))}"></i><span><b>${esc(noteTitle(path))}</b><small>${esc(dirOf(path) || ROOT_LABEL)}</small></span>`;

  const list = (): string => {
    if (tab === 'toc')
      return d.heads.length
        ? `<nav class="vx-ct-toc" aria-label="Outline">${d.heads
            .map((h, i) => {
              const lv = Math.max(0, Math.min(3, (Number(h.tagName[1]) || 2) - top));
              return `<button type="button" class="vx-ct-h${lv ? '' : ' l0'}" data-h="${i}" style="--lv:${lv}">${esc((h.textContent || '').trim())}</button>`;
            })
            .join('')}</nav>`
        : '<p class="vx-ct-none">This note has no headings yet.</p>';
    if (tab === 'back')
      return d.backlinks.length
        ? d.backlinks
            .map((b) => `<button type="button" class="vx-ct-i" data-open="${attr(b.path)}">${note(b.path)}</button>`)
            .join('')
        : '<p class="vx-ct-none">No other note links here yet.</p>';
    return d.outs.length
      ? d.outs
          .map((o) => {
            const n = spots.get(o.name.trim().toLowerCase())?.length || 0;
            const jump = n
              ? `<button type="button" class="vx-ct-jump" data-l="${attr(o.name)}" aria-label="Show “${attr(o.name)}” in the text" title="Show in the text${
                  n > 1 ? ` (${n} places)` : ''
                }">${JUMP}${n > 1 ? `<b>${n}</b>` : ''}</button>`
              : '';
            return `<div class="vx-ct-row">${
              o.path
                ? `<button type="button" class="vx-ct-i" data-open="${attr(o.path)}">${note(o.path)}</button>`
                : `<button type="button" class="vx-ct-i missing" data-create="${attr(o.name)}" title="Create this note"><i></i><span><b>${esc(
                    o.name,
                  )}</b><small>Not created yet · create it</small></span></button>`
            }${jump}</div>`;
          })
          .join('')
      : '<p class="vx-ct-none">This note does not link to other notes yet.</p>';
  };

  const paintMain = (): void => {
    mainSeg.innerHTML = (['contents', 'details'] as const)
      .map(
        (m) =>
          `<button type="button" role="tab" data-main="${m}" aria-selected="${m === main}" tabindex="${m === main ? 0 : -1}">${
            m === 'contents' ? 'Contents' : 'Details'
          }</button>`,
      )
      .join('');
  };
  const paint = (): void => {
    if (main === 'details') {
      inner.innerHTML = `<div class="vx-ct-list" role="tabpanel"><div class="vx-ct-info">${d.details}</div></div>`;
      fadeScroll(inner.querySelector<HTMLElement>('.vx-ct-list')!);
      return;
    }
    inner.innerHTML = `<div class="vx-ct-seg" role="tablist" aria-label="Contents">${tabs
      .map(
        (t) =>
          `<button type="button" role="tab" data-tab="${t.k}" aria-selected="${t.k === tab}" tabindex="${t.k === tab ? 0 : -1}">${t.label}${
            t.n >= 0 ? `<b>${t.n}</b>` : ''
          }</button>`,
      )
      .join('')}</div><div class="vx-ct-list" role="tabpanel">${list()}</div>`;
    fadeScroll(inner.querySelector<HTMLElement>('.vx-ct-list')!);
    if (tab === 'toc') markHead(inner, act.current(), true);
  };
  paintMain();
  paint();

  const pickMain = (m: Main): void => {
    main = lastMain = m;
    paintMain();
    paint();
    mainSeg.querySelector<HTMLElement>(`[data-main=${m}]`)?.focus();
  };
  mainSeg.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-main]');
    if (b) pickMain(b.dataset.main as Main);
  };
  mainSeg.onkeydown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    pickMain(main === 'contents' ? 'details' : 'contents');
  };

  body.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.main) return;
    if (b.dataset.tab) {
      tab = last = b.dataset.tab as Tab;
      paint();
      body.querySelector<HTMLElement>(`[data-tab=${tab}]`)?.focus();
      return;
    }
    if (b.classList.contains('vx-meta-folder')) {
      if (inSheet) closePanel();
      act.folder(b.dataset.f || '');
      return;
    }
    if (b.dataset.tag) {
      if (inSheet) closePanel();
      act.tag(b.dataset.tag);
      return;
    }
    if (b.dataset.h) {
      const h = d.heads[Number(b.dataset.h)];
      markHead(body, Number(b.dataset.h), false);
      if (inSheet) closePanel();
      act.jump(h);
    } else if (b.dataset.l != null) {
      const k = b.dataset.l.trim().toLowerCase();
      const at = spots.get(k) || [];
      if (!at.length) return;
      const i = (step.get(k) ?? -1) + 1;
      step.set(k, i % at.length);
      if (inSheet) closePanel();
      act.jump(at[i % at.length]);
    } else if (b.dataset.open) {
      if (inSheet) closePanel();
      act.open(b.dataset.open);
    } else if (b.dataset.create) act.create(b.dataset.create, b);
  };
  body.onkeydown = (e) => {
    // Arrow keys move between tabs.
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (!t || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    const i = tabs.findIndex((x) => x.k === t.dataset.tab);
    tab = last = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].k;
    paint();
    body.querySelector<HTMLElement>(`[data-tab=${tab}]`)?.focus();
  };
  return body;
}

/** Mark the heading being read; `reveal` scrolls it into the list's view. */
export function markHead(root: HTMLElement, i: number, reveal: boolean): void {
  let on: HTMLElement | null = null;
  root.querySelectorAll<HTMLElement>('.vx-ct-h').forEach((b) => {
    const cur = Number(b.dataset.h) === i;
    b.classList.toggle('on', cur);
    if (cur) {
      b.setAttribute('aria-current', 'location');
      on = b;
    } else b.removeAttribute('aria-current');
  });
  const lst = root.querySelector<HTMLElement>('.vx-ct-list');
  const b = on as HTMLElement | null;
  if (!reveal || !b || !lst) return;
  // Only the list moves, never the page.
  requestAnimationFrame(() => {
    const top = b.getBoundingClientRect().top - lst.getBoundingClientRect().top + lst.scrollTop;
    if (top < lst.scrollTop + 8 || top + b.offsetHeight > lst.scrollTop + lst.clientHeight - 8)
      lst.scrollTop = Math.max(0, top - lst.clientHeight / 3);
  });
}

/** Phones and tablets: Contents as a bottom sheet, opened only by its button. */
export function openContentsSheet(anchor: HTMLElement, d: ContentsData, act: ContentsActions): void {
  openPanel(anchor, 'This note', contentsBody(d, act, true), 'vx-pop-ct', true);
}
