// A searchable picker of boards or notes in a dialog (a bottom sheet on phones): "Existing board…"
// to embed one in a note, "Embed in a note…" to put a board into one. Resolves with the path, or
// null when closed.

import { attr, esc, useStyles } from '../dom';
import { t, tn } from '../i18n';
import { Modal } from '../modal';
import { allNotes, isBoard, noteTitle } from '../state';
import { CHIP_ICONS } from '../ui/chips';
import { boardInfos, type BoardInfo } from '../views/board-card';
import { folderColor, ROOT_LABEL } from './store';

const CSS = `
.pk{display:flex;flex-direction:column;gap:10px;min-width:0}
.pk *{box-sizing:border-box}
.pk-q{width:100%;height:42px;padding:0 12px;border:1px solid var(--line-strong);border-radius:12px;background:var(--surface-1);color:var(--fg);font:inherit;font-size:15px;outline:none}
.pk-q:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.pk-l{display:flex;flex-direction:column;gap:2px;max-height:min(52dvh,420px);overflow-y:auto;overscroll-behavior:contain;min-width:0}
.pk-r{display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:48px;padding:6px 10px;border:1px solid transparent;border-radius:10px;
  background:none;color:var(--fg);font:inherit;text-align:start;cursor:pointer}
.pk-r:hover,.pk-r[aria-selected=true]{background:var(--hover)}
.pk-r:focus-visible{outline:none;border-color:var(--accent)}
.pk-r .ch-ic{flex:none;width:18px;height:18px;color:#7c3aed}
:root:not([data-theme=light]) .pk-r .ch-ic{color:#a78bfa}
.pk-r>i{flex:none;width:9px;height:9px;margin-inline:4px 5px;border-radius:50%;background:var(--fc,var(--muted))}
.pk-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.pk-t b{font-weight:550;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-t small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-none{margin:12px 4px;color:var(--muted);font-size:13.5px}
@media (max-width:760px){.pk-q{font-size:16px;height:44px}}
`;

interface Row {
  path: string;
  title: string;
  sub: string;
  board: boolean;
}

export function pickNote(opts: { title: string; boards: boolean; exclude?: string[] }): Promise<string | null> {
  useStyles('pk-css', CSS);
  return new Promise((resolve) => {
    let done = false;
    const finish = (p: string | null): void => {
      if (done) return;
      done = true;
      resolve(p);
    };
    const skip = new Set(opts.exclude || []);
    let rows: Row[] = [];
    let infos: BoardInfo[] = [];
    const build = (): void => {
      const dir = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
      rows = allNotes()
        .filter((n) => !skip.has(n.path) && isBoard(n.path) === opts.boards)
        .map((n) => {
          const b = infos.find((x) => x.path === n.path);
          const where = dir(n.path) ? dir(n.path).split('/').join(' / ') : ROOT_LABEL;
          const sub = b ? `${where} · ${t('{done} of {total} done', { done: b.done, total: b.cards })}` : where;
          return { path: n.path, title: noteTitle(n.path), sub, board: opts.boards };
        })
        .sort((a, b) => a.title.localeCompare(b.title));
    };
    build();
    const box = document.createElement('div');
    box.className = 'pk';
    box.innerHTML = `<input class="pk-q" type="search" autocomplete="off" placeholder="${attr(opts.boards ? t('Find a board…') : t('Find a note…'))}" aria-label="${attr(
      opts.boards ? t('Find a board') : t('Find a note'),
    )}"><div class="pk-l" role="listbox"></div>`;
    const q = box.querySelector<HTMLInputElement>('.pk-q')!;
    const list = box.querySelector<HTMLElement>('.pk-l')!;
    let shown: Row[] = [];
    let cur = 0;
    const paint = (): void => {
      const s = q.value.trim().toLowerCase();
      shown = (s ? rows.filter((r) => (r.title + ' ' + r.path).toLowerCase().includes(s)) : rows).slice(0, 200);
      cur = Math.min(cur, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length
        ? shown
            .map(
              (r, i) =>
                `<button type="button" class="pk-r" role="option" aria-selected="${i === cur}" data-i="${i}" style="--fc:${attr(folderColor(r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : ''))}">${
                  r.board ? CHIP_ICONS.board : '<i></i>'
                }<span class="pk-t"><b dir="auto">${esc(r.title)}</b><small dir="auto">${esc(r.sub)}</small></span></button>`,
            )
            .join('')
        : `<p class="pk-none">${opts.boards ? (rows.length ? t('No board matches.') : t('There are no boards yet.')) : t('No note matches.')}</p>`;
    };
    q.addEventListener('input', () => {
      cur = 0;
      paint();
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!shown.length) return;
        cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
        paint();
        list.querySelector<HTMLElement>(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && shown[cur]) {
        e.preventDefault();
        Modal.close();
        finish(shown[cur].path);
      }
    });
    list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!b) return;
      Modal.close();
      finish(shown[Number(b.dataset.i)].path);
    });
    Modal.open({
      title: opts.title,
      sub: opts.boards ? tn(rows.length, '{n} board', '{n} boards') : undefined,
      body: box,
      actions: [{ label: t('Cancel'), cls: 'ghost', run: () => Modal.close() }],
      onOpen: () => {
        paint();
        q.focus();
        if (opts.boards)
          void boardInfos().then((list) => {
            infos = list;
            build();
            if (box.isConnected) paint();
          });
      },
    });
    // Closing the dialog any other way answers null.
    const watch = window.setInterval(() => {
      if (!box.isConnected) {
        window.clearInterval(watch);
        finish(null);
      }
    }, 400);
  });
}
