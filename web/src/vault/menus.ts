// Context menus and the confirm flows behind them, shared by tree, list and note.

import { esc, useStyles } from '../dom';
import { t, tn } from '../i18n';
import { copyText } from '../control/ui';
import { noteName, stemTitle } from '../format';
import { noteTitle } from '../state';
import { Modal } from '../modal';
import { I } from './icons';
import { nav } from './nav';
import { hooks } from '../hooks';
import {
  deleteFolder,
  moveNotes,
  moveFolderContents,
  relocateFolder,
  renameFolder,
  reload,
  renameNote,
  restoreTrashed,
  setFolderMeta,
  trashNotes,
} from './ops';
import { createFolderPicker, pickFolderDialog } from './folder-picker';
import {
  baseName,
  dirOf,
  folderColor,
  folderIcon,
  isInside,
  isPinned,
  notesUnder,
  pickerFolders,
  ROOT_LABEL,
  togglePin,
  unpin,
} from './store';
import { folderLookDialog, openMenu, promptName, undoToast, type MenuItem } from './ui';
import { LOCK_ICON, openPrivacy } from '../ui/privacy';

type Anchor = { x: number; y: number } | HTMLElement;

/** Ask before taking something off Pinned (the note or folder itself stays). */
export function confirmUnpin(item: { kind: 'note' | 'folder'; key: string }, done: () => void): void {
  const name = item.kind === 'note' ? noteTitle(item.key) : baseName(item.key) || ROOT_LABEL;
  Modal.confirm(
    t('Unpin "{name}"?', { name }),
    item.kind === 'note'
      ? t('It leaves the Pinned list only; the note itself stays where it is.')
      : t('It leaves the Pinned list only; the folder itself stays where it is.'),
    t('Unpin'),
    () => {
      Modal.close();
      unpin(item);
      done();
    },
  );
}

export function pinToggle(kind: 'note' | 'folder', key: string): void {
  if (isPinned(kind, key)) {
    confirmUnpin({ kind, key }, () => {
      undoToast(t('Unpinned'), () => void togglePin({ kind, key }), 'info', 4000);
    });
    return;
  }
  const now = togglePin({ kind, key });
  undoToast(now ? t('Pinned "{name}"', { name: kind === 'note' ? noteTitle(key) : baseName(key) }) : t('Unpinned'), () => void togglePin({ kind, key }), 'info', 4000);
}

/** Ask, then move a folder into another folder. */
export function confirmFolderMove(src: string, destParent: string): void {
  if (src === destParent || isInside(destParent, src) || dirOf(src) === destParent) return;
  const dest = destParent ? destParent + '/' + baseName(src) : baseName(src);
  const n = notesUnder(src).length;
  Modal.open({
    title: t('Move folder'),
    body: `<p style="margin:0 0 6px">${tn(n, 'Move {src} with its {n} note into {dest}?', 'Move {src} with its {n} notes into {dest}?', {
      src: `<b>${esc(src)}</b>`,
      dest: `<b>${esc(destParent || ROOT_LABEL)}</b>`,
    })}</p><p class="panel-sub" style="margin:0">${t('It becomes {path}. Links to its notes keep working.', {
      path: `<span class="mono">${esc(dest)}</span>`,
    })}</p>`,
    actions: [
      { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
      {
        label: t('Move folder'),
        cls: 'primary',
        run: async () => {
          Modal.close();
          await relocateFolder(src, dest, 'Moved');
        },
      },
    ],
  });
}

export function askMoveNotes(paths: string[]): void {
  // "current" only when every note lives in the same folder.
  const dirs = new Set(paths.map(dirOf));
  const cur = dirs.size === 1 ? [...dirs][0] : null;
  pickFolderDialog({
    title: paths.length === 1 ? t('Move "{name}" to', { name: noteTitle(paths[0]) }) : t('Move {n} notes to', { n: paths.length }),
    folders: pickerFolders(),
    current: cur,
    disabled: (f) => (f === cur ? (paths.length === 1 ? t('The note is already here') : t('The notes are already here')) : false),
    run: (f) => void moveNotes(paths, f),
  });
}

export function askMoveFolder(path: string): void {
  // The folder itself and everything below it are not offered.
  pickFolderDialog({
    title: t('Move folder "{name}" into', { name: baseName(path) }),
    folders: pickerFolders(),
    current: dirOf(path),
    exclude: [path],
    disabled: (f) => (f === dirOf(path) ? t('The folder is already here') : false),
    run: (f) => confirmFolderMove(path, f),
  });
}

/** Move notes to the Trash with Undo in the toast; `after` runs once they are gone, `reopen` reopens a single note on Undo. */
export async function deleteNotesToTrash(paths: string[], after?: () => void, reopen = false): Promise<void> {
  const done = await trashNotes(paths);
  if (!done.length) return;
  after?.();
  const what = done.length === 1 ? `"${noteTitle(done[0].path)}"` : tn(done.length, '{n} note', '{n} notes');
  undoToast(t('Moved {what} to the Trash', { what }), async () => {
    const back: string[] = [];
    for (const item of done.slice().reverse()) {
      try {
        back.push(await restoreTrashed(item.name));
      } catch (e) {
        undoToast(t('Could not restore "{name}": {error}', { name: noteTitle(item.path), error: (e as Error).message }), null, 'err');
      }
    }
    await reload();
    if (reopen && back.length === 1 && back[0]) nav.openNote(back[0]);
  });
}

const FD_CSS = `
.fd-p{margin:0 0 10px}
.fd-p:last-child{margin-bottom:0}
.fd-opt{display:block;padding:12px 13px;border:1px solid var(--line);border-radius:12px;margin-top:10px;cursor:pointer;
  transition:border-color .15s,background .15s}
.fd-opt:hover{border-color:var(--line-strong)}
.fd-opt:has(input:checked){border-color:var(--accent-line);background:var(--accent-soft)}
.fd-opt.danger:has(input:checked){border-color:color-mix(in srgb,var(--danger) 55%,transparent);background:var(--danger-soft)}
.fd-opt input[type=radio]{margin:3px 0 0;flex:none;accent-color:var(--accent)}
.fd-opt.danger input[type=radio]{accent-color:var(--danger)}
.fd-opt-t{display:block;font-weight:600;font-size:14px}
.fd-opt.danger .fd-opt-t{color:var(--danger)}
.fd-opt-d{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;line-height:1.45}
.fd-opt-b{flex:1;min-width:0}
.fd-opt-l{display:flex;gap:11px;align-items:flex-start;cursor:pointer}
.fd-dest{display:block;margin:10px 0 0 24px}
.fd-dest-l{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px}
.fd-dest .fp-tree{max-height:min(34vh,280px)}
.fd-opt:not(:has(input:checked)) .fd-dest{opacity:.6}
@media (max-width:640px){.fd-dest{margin-left:0}}
`;

/** Delete a folder: confirm, then (when notes are inside) move them elsewhere or to the Trash. */
export function confirmDeleteFolder(path: string): void {
  useStyles('fd-css', FD_CSS);
  const n = notesUnder(path).length;
  const subs = pickerFolders().filter((f) => f !== path && isInside(f, path)).length;
  const name = baseName(path);
  Modal.open({
    title: t('Delete folder "{name}"?', { name }),
    body: n
      ? `<p class="fd-p">${
          subs
            ? tn(subs, 'The folder {path} and its {n} subfolder will be removed.', 'The folder {path} and its {n} subfolders will be removed.', {
                path: `<b>${esc(path)}</b>`,
              })
            : t('The folder {path} will be removed.', { path: `<b>${esc(path)}</b>` })
        }</p><p class="fd-p">${tn(
          n,
          'It holds {n} note. Next you choose what happens to them: move them to another folder, or move them to the Trash. Nothing is changed yet.',
          'It holds {n} notes. Next you choose what happens to them: move them to another folder, or move them to the Trash. Nothing is changed yet.',
        )}</p>`
      : `<p class="fd-p">${
          subs
            ? tn(subs, 'The folder {path} has no notes. It is removed, with its {n} empty subfolder.', 'The folder {path} has no notes. It is removed, with its {n} empty subfolders.', {
                path: `<b>${esc(path)}</b>`,
              })
            : t('The folder {path} has no notes. It is removed.', { path: `<b>${esc(path)}</b>` })
        }</p><p class="panel-sub fd-p">${t('Other files in it (such as images) are deleted too. This cannot be undone.')}</p>`,
    actions: [
      { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
      {
        label: n ? t('Delete…') : t('Delete folder'),
        cls: 'danger',
        run: async () => {
          if (n) {
            folderDeleteStep2(path, n, subs);
            return;
          }
          Modal.close();
          if ((await deleteFolder(path, { mode: 'move', into: dirOf(path) })) != null) undoToast(t('Folder "{name}" deleted', { name }), null, 'info');
        },
      },
    ],
  });
}

function folderDeleteStep2(path: string, n: number, subs: number): void {
  const name = baseName(path);
  const nodes = tn(n, '{n} note', '{n} notes');
  const direct = notesUnder(path).filter((x) => dirOf(x.path) === path).length;
  const subLabel = tn(subs, '{n} subfolder', '{n} subfolders');
  const holds = !subs
    ? t('This folder has {nodes}.', { nodes })
    : !direct
      ? t('This folder has {nodes} in {subs}.', { nodes, subs: subLabel })
      : t('This folder has {nodes}: {direct} directly inside and the rest in {subs}.', { nodes, direct, subs: subLabel });
  let mode: 'move' | 'trash' = 'move';
  let go: HTMLButtonElement | null = null;
  // The folder being deleted and everything below it are not destinations.
  const sel = createFolderPicker({
    folders: pickerFolders(),
    value: dirOf(path),
    exclude: [path],
    label: t('Move the notes to'),
    onChange: () => {
      if (go && mode === 'move') go.disabled = sel.value == null;
    },
  });
  const moveLabel = t('Move {nodes} and delete folder', { nodes });
  const trashLabel = t('Delete folder, {nodes} to Trash', { nodes });
  // Step 2 replaces step 1; closing first hands focus back to whatever opened step 1.
  Modal.close();
  Modal.open({
    title: t('Delete folder "{name}"?', { name }),
    body: `<p class="fd-p">${esc(holds)}</p>
<div class="fd-opt" data-fd-move><label class="fd-opt-l"><input type="radio" name="fdMode" value="move" checked><span class="fd-opt-b"><span class="fd-opt-t">${t('Move the notes, then delete the folder')}</span>
<span class="fd-opt-d">${t('Subfolders are kept inside the destination and links to the moved notes are updated. If a name is already taken there, a number is added to it.')}</span></span></label>
<div class="fd-dest" data-fd-dest><span class="fd-dest-l">${t('Move the notes to')}</span></div></div>
<label class="fd-opt fd-opt-l danger"><input type="radio" name="fdMode" value="trash"><span class="fd-opt-b"><span class="fd-opt-t">${t('Move everything in this folder to the Trash')}</span>
<span class="fd-opt-d">${t('All {nodes} go to the Trash, where you can restore them to their old places. Other files in the folder (such as images) are deleted for good.', { nodes: esc(nodes) })}</span></span></label>`,
    actions: [
      {
        label: t('Back'),
        cls: 'ghost',
        run: () => {
          Modal.close();
          confirmDeleteFolder(path);
        },
      },
      { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
      {
        label: moveLabel,
        cls: 'primary',
        run: async () => {
          const into = sel.value ?? '';
          if (mode === 'move' && sel.value == null) return;
          Modal.close();
          const done = await deleteFolder(path, mode === 'trash' ? { mode } : { mode, into });
          if (done == null) return;
          undoToast(
            mode === 'trash'
              ? tn(done, 'Folder "{name}" deleted, {n} note moved to the Trash', 'Folder "{name}" deleted, {n} notes moved to the Trash', { name })
              : tn(done, 'Folder "{name}" deleted, {n} note moved to {folder}', 'Folder "{name}" deleted, {n} notes moved to {folder}', {
                  name,
                  folder: into || ROOT_LABEL,
                }),
            null,
            'info',
          );
        },
      },
    ],
    onOpen: (body) => {
      body.querySelector('[data-fd-dest]')?.appendChild(sel.el);
      go = body.parentElement?.querySelector<HTMLButtonElement>('.modal-foot .btn:last-child') || null;
      body.querySelectorAll<HTMLInputElement>('input[name=fdMode]').forEach((r) =>
        r.addEventListener('change', () => {
          if (!r.checked) return;
          mode = r.value === 'trash' ? 'trash' : 'move';
          if (go) {
            go.textContent = mode === 'trash' ? trashLabel : moveLabel;
            go.classList.toggle('primary', mode === 'move');
            go.classList.toggle('danger', mode === 'trash');
            go.disabled = mode === 'move' && sel.value == null;
          }
        }),
      );
      // Choosing a destination also picks the move option.
      const pickMove = (): void => {
        const r = body.querySelector<HTMLInputElement>('input[value=move]');
        if (r && !r.checked) {
          r.checked = true;
          r.dispatchEvent(new Event('change'));
        }
      };
      body.querySelector('[data-fd-move]')?.addEventListener('click', pickMove);
      sel.el.addEventListener('focusin', pickMove);
    },
  });
}

/** Copy a vault-relative path (what read_memory and the other MCP tools take). */
export function copyPath(path: string): void {
  void copyText(path, t('Path copied'));
}

/** Copy a full-path wikilink: [[Folder/Name]]. */
export function copyWikilink(path: string): void {
  void copyText(`[[${path.replace(/\.md$/i, '')}]]`, t('Wikilink copied'));
}

export function folderLook(path: string): void {
  folderLookDialog(path, folderColor(path), folderIcon(path), (patch) => void setFolderMeta(path, patch));
}

/** Folder menu; `rename` starts the inline editor of the row that opened it (else a dialog). */
export function folderMenu(path: string, at: Anchor, rename?: () => void, extra: MenuItem[] = []): void {
  const root = path === '';
  openMenu(
    [
      { label: t('New note here'), icon: I.newNote, hint: 'N', run: () => nav.newNote(path) },
      { label: t('New folder here'), icon: I.newFolder, run: () => nav.newFolder(path) },
      { label: root ? t('Ask Mnemo about the vault') : t('Ask Mnemo about this folder'), icon: I.mnemo, run: () => hooks.askMnemo(root ? 'global' : 'folder:' + path) },
      { sep: true, label: '' },
      {
        label: t('Rename'),
        icon: I.rename,
        hint: 'F2',
        disabled: root,
        run: () =>
          rename
            ? rename()
            : promptName(t('Rename folder'), t('Folder name'), baseName(path), (v) => void renameFolder(path, v)),
      },
      { label: t('Move to…'), icon: I.move, disabled: root, run: () => askMoveFolder(path) },
      ...(dirOf(path)
        ? [{ label: t('Move out to top level'), icon: I.move, run: () => confirmFolderMove(path, '') }]
        : []),
      {
        label: t('Move contents to…'),
        icon: I.move,
        disabled: root,
        run: () =>
          pickFolderDialog({
            title: t('Move everything in "{name}" into', { name: baseName(path) }),
            folders: pickerFolders(),
            value: dirOf(path),
            exclude: [path],
            verb: t('Move contents here'),
            run: (f) =>
              Modal.confirm(
                t('Move contents'),
                t('Every note and subfolder in "{path}" moves into {folder}; "{name}" is then removed. If a name is already taken there, a number is added to it.', {
                  path,
                  folder: f || ROOT_LABEL,
                  name: baseName(path),
                }),
                t('Move contents'),
                async () => {
                  Modal.close();
                  await moveFolderContents(path, f);
                },
                false,
              ),
          }),
      },
      { label: t('Copy path'), icon: I.copy, disabled: root, run: () => copyPath(path) },
      { label: t('Color and icon…'), icon: I.palette, disabled: root, run: () => folderLook(path) },
      { label: t('Privacy…'), icon: LOCK_ICON, disabled: root, run: () => void openPrivacy('folder', path) },
      {
        label: isPinned('folder', path) ? t('Unpin') : t('Pin'),
        icon: isPinned('folder', path) ? I.pinOff : I.pin,
        disabled: root,
        run: () => pinToggle('folder', path),
      },
      { sep: true, label: '' },
      { label: t('Delete folder…'), icon: I.trash, danger: true, disabled: root, hint: 'Del', run: () => confirmDeleteFolder(path) },
      ...extra,
    ],
    at,
  );
}

export function noteMenu(paths: string[], at: Anchor, rename?: () => void): void {
  const one = paths.length === 1 ? paths[0] : null;
  openMenu(
    [
      ...(one ? [{ label: t('Open'), icon: I.eye, hint: 'Enter', run: () => nav.openNote(one) }] : []),
      {
        label: t('Rename'),
        icon: I.rename,
        hint: 'F2',
        disabled: !one,
        run: () =>
          one &&
          (rename
            ? rename()
            : promptName(t('Rename note'), t('Note name'), stemTitle(noteName(one)), (v) => void renameNote(one, v))),
      },
      { label: paths.length > 1 ? t('Move {n} notes to…', { n: paths.length }) : t('Move to…'), icon: I.move, run: () => askMoveNotes(paths) },
      ...(one
        ? [
            {
              label: isPinned('note', one) ? t('Unpin') : t('Pin'),
              icon: isPinned('note', one) ? I.pinOff : I.pin,
              run: () => pinToggle('note', one),
            },
            { label: t('Privacy…'), icon: LOCK_ICON, run: () => void openPrivacy('node', one) },
            { label: t('Copy path'), icon: I.copy, run: () => copyPath(one) },
            { label: t('Copy wikilink'), icon: I.link, run: () => copyWikilink(one) },
          ]
        : []),
      { label: t('New note in this folder'), icon: I.newNote, run: () => nav.newNote(dirOf(paths[0])) },
      { sep: true, label: '' },
      {
        label: paths.length > 1 ? t('Move {n} notes to Trash', { n: paths.length }) : t('Move to Trash'),
        icon: I.trash,
        hint: 'Del',
        danger: true,
        run: () => void deleteNotesToTrash(paths),
      },
    ],
    at,
  );
}
