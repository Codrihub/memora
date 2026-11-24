// "New": one button that offers a note or a board, in the folder it belongs to. A small menu by the
// button on wider screens, a bottom sheet on phones. N and B do the same from the keyboard.

import { attr, esc, useStyles } from '../dom';
import { t } from '../i18n';
import { Modal } from '../modal';
import { I } from './icons';
import { nav } from './nav';
import { openMenu } from './ui';

const CSS = `
.nw{display:flex;flex-direction:column;gap:8px}
.nw-o{display:flex;align-items:center;gap:14px;width:100%;min-height:64px;padding:10px 14px;border:1px solid var(--line);border-radius:14px;
  background:var(--surface-1);color:var(--fg);font:inherit;text-align:start;cursor:pointer}
.nw-o:hover,.nw-o:focus-visible{border-color:var(--accent);outline:none;background:color-mix(in srgb,var(--accent) 6%,var(--surface-1))}
.nw-ic{display:grid;place-items:center;flex:none;width:40px;height:40px;border-radius:11px;background:var(--accent-soft);color:var(--accent)}
.nw-ic .vx-i{width:20px;height:20px}
.nw-o.board .nw-ic{background:color-mix(in srgb,#7c3aed 14%,transparent);color:#7c3aed}
:root:not([data-theme=light]) .nw-o.board .nw-ic{color:#a78bfa}
.nw-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.nw-t b{font-size:16px;font-weight:600}
.nw-t small{font-size:13px;color:var(--muted)}
`;

/** Offer a new note or a new board in `folder` ('' = the top level). */
export function openNewMenu(anchor: HTMLElement, folder: string): void {
  const items = [
    { k: 'note', label: t('Note'), desc: t('A page of text, with links and tags'), icon: I.newNote, key: 'N', run: () => nav.newNote(folder) },
    { k: 'board', label: t('Board'), desc: t('Lanes of cards to drag, tick off and share with agents'), icon: I.board, key: 'B', run: () => nav.newBoard(folder) },
  ];
  if (!window.matchMedia('(max-width: 760px)').matches) {
    openMenu(
      items.map((x) => ({ label: x.label, desc: x.desc, icon: x.icon, hint: x.key, run: x.run })),
      anchor,
    );
    return;
  }
  useStyles('nw-css', CSS);
  const box = document.createElement('div');
  box.className = 'nw';
  box.innerHTML = items
    .map(
      (x, i) =>
        `<button type="button" class="nw-o ${x.k}" data-i="${i}" aria-label="${attr(`${x.label}: ${x.desc}`)}"><span class="nw-ic" aria-hidden="true">${x.icon}</span><span class="nw-t"><b>${esc(
          x.label,
        )}</b><small>${esc(x.desc)}</small></span></button>`,
    )
    .join('');
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!b) return;
    Modal.close();
    items[Number(b.dataset.i)].run();
  });
  Modal.open({ title: t('New'), body: box });
}
