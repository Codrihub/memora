// Reusable note row renderer shared by several views.

import { attr, esc } from './dom';
import { fmtTs, folderOf, relTs } from './format';
import { hooks } from './hooks';
import type { NoteRef } from './types';

/** One clickable note row. Notes without an mtime (wikilink targets) are marked. */
export function rowHTML(n: NoteRef): string {
  return `<button class="list-row" data-path="${attr(n.path)}"><span class="lr-main"><span class="lr-name" style="display:block">${esc(
    n.name,
  )}</span>
    <span class="lr-meta" style="display:block">${esc(n.folder || folderOf(n.path))} · ${
      n.mtime ? relTs(n.mtime) : 'wikilink'
    }</span></span>
    <span class="lr-acts">${
      n.mtime ? `<small class="panel-sub">${fmtTs(n.mtime)}</small>` : ''
    }</span></button>`;
}

/** Attach the click handler to every note row inside a container. */
export function wireRows(scope: ParentNode): void {
  for (const node of Array.from(scope.querySelectorAll<HTMLElement>('.list-row[data-path]'))) {
    node.onclick = () => {
      const p = node.dataset.path;
      if (p) hooks.openNote(p);
    };
  }
}
