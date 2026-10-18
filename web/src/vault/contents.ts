// The reader's "Contents" panel: one button, four tabs. On this page (the
// outline), Backlinks, Links out and every [[wikilink]] written in the node,
// with the ones that do not exist yet marked. Picking an entry jumps to the
// heading or link in the text, or opens the linked node.

import { attr, el, esc } from '../dom';
import { I } from './icons';
import { closePanel, openPanel } from './panel';
import { dirOf, folderColor } from './store';

export interface ContentsData {
  heads: HTMLElement[];
  backlinks: { path: string; name: string }[];
  outs: { name: string; path: string | null }[];
  /** Rendered wikilinks in the body, in reading order. */
  links: HTMLElement[];
}

export interface ContentsActions {
  open: (path: string) => void;
  create: (name: string, at: HTMLElement) => void;
  jump: (target: HTMLElement) => void;
}

type Tab = 'toc' | 'back' | 'out' | 'wl';
let last: Tab = 'toc';

export function openContents(anchor: HTMLElement, d: ContentsData, act: ContentsActions): void {
  const body = el('div', 'vx-ct');
  const tabs: { k: Tab; label: string; n: number }[] = [
    { k: 'toc', label: 'On this page', n: d.heads.length },
    { k: 'back', label: 'Backlinks', n: d.backlinks.length },
    { k: 'out', label: 'Links out', n: d.outs.length },
    { k: 'wl', label: 'Wikilinks', n: d.links.length },
  ];
  // Open on the outline when there is one, else where something is.
  let tab: Tab = tabs.find((t) => t.k === last && t.n)?.k || tabs.find((t) => t.n)?.k || 'toc';
  const item = (inner: string, attrs: string, cls = ''): string => `<button class="vx-ct-i${cls}" ${attrs}>${inner}</button>`;
  const list = (): string => {
    if (tab === 'toc')
      return d.heads.length
        ? d.heads
            .map((h, i) =>
              item(`<span>${esc(h.textContent || '')}</span>`, `data-h="${i}"`, h.tagName === 'H3' ? ' sub' : h.tagName === 'H1' ? ' top' : ''),
            )
            .join('')
        : '<p class="vx-muted">This node has no headings.</p>';
    if (tab === 'back')
      return d.backlinks.length
        ? d.backlinks
            .map((b) =>
              item(
                `<i style="--fc:${attr(folderColor(dirOf(b.path)))}"></i><span><b>${esc(b.name)}</b><small>${esc(dirOf(b.path) || 'Vault')}</small></span>${I.caret}`,
                `data-open="${attr(b.path)}"`,
              ),
            )
            .join('')
        : '<p class="vx-muted">No node links here yet.</p>';
    if (tab === 'out')
      return d.outs.length
        ? d.outs
            .map((o) =>
              o.path
                ? item(
                    `<i style="--fc:${attr(folderColor(dirOf(o.path)))}"></i><span><b>${esc(o.name)}</b><small>${esc(dirOf(o.path) || 'Vault')}</small></span>${I.caret}`,
                    `data-open="${attr(o.path)}"`,
                  )
                : item(`<i class="new"></i><span><b>${esc(o.name)}</b><small>Not created yet · create it</small></span>${I.plus}`, `data-create="${attr(o.name)}"`, ' missing'),
            )
            .join('')
        : '<p class="vx-muted">No [[wikilinks]] in this node.</p>';
    return d.links.length
      ? d.links
          .map((a, i) => {
            const broken = a.classList.contains('broken');
            const p = a.dataset.path || '';
            return item(
              `<i class="${broken ? 'new' : ''}" style="--fc:${broken ? 'var(--muted)' : attr(folderColor(dirOf(p)))}"></i><span><b>${esc(
                a.textContent || '',
              )}</b><small>${broken ? 'Not created yet' : esc(dirOf(p) || 'Vault')} · ${ordinal(i, d.links)}</small></span>`,
              `data-l="${i}"`,
              broken ? ' missing' : '',
            );
          })
          .join('')
      : '<p class="vx-muted">No [[wikilinks]] in this node.</p>';
  };
  const paint = (): void => {
    body.innerHTML = `<div class="vx-ct-tabs" role="tablist">${tabs
      .map(
        (t) =>
          `<button role="tab" data-tab="${t.k}" aria-selected="${t.k === tab}">${t.label}<b>${t.n}</b></button>`,
      )
      .join('')}</div><div class="vx-ct-list" role="tabpanel">${list()}</div>`;
    body.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  paint();
  body.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.tab) {
      tab = last = b.dataset.tab as Tab;
      paint();
      body.querySelector<HTMLElement>(`[data-tab=${tab}]`)?.focus();
      return;
    }
    if (b.dataset.h) {
      closePanel();
      act.jump(d.heads[Number(b.dataset.h)]);
    } else if (b.dataset.l) {
      closePanel();
      act.jump(d.links[Number(b.dataset.l)]);
    } else if (b.dataset.open) {
      closePanel();
      act.open(b.dataset.open);
    } else if (b.dataset.create) act.create(b.dataset.create, b);
  };
  body.onkeydown = (e) => {
    // Arrow keys move between tabs.
    const t = (e.target as HTMLElement).closest<HTMLElement>('[role=tab]');
    if (!t || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    const i = tabs.findIndex((x) => x.k === t.dataset.tab);
    tab = last = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].k;
    paint();
    body.querySelector<HTMLElement>(`[data-tab=${tab}]`)?.focus();
  };
  openPanel(anchor, 'Contents', body, 'vx-pop-ct');
}

/** "2nd of 3" when a link appears more than once, else "in the text". */
function ordinal(i: number, links: HTMLElement[]): string {
  const name = (links[i].textContent || '').toLowerCase();
  const same = links.filter((a) => (a.textContent || '').toLowerCase() === name);
  if (same.length < 2) return 'in the text';
  return `${same.indexOf(links[i]) + 1} of ${same.length}`;
}
