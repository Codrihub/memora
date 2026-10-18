// Context menus and the confirm flows behind them, shared by tree, list and note.

import { esc } from '../dom';
import { noteName } from '../format';
import { Modal } from '../modal';
import { I } from './icons';
import { nav } from './nav';
import {
  deleteFolder,
  deleteNotes,
  moveNotes,
  moveFolderContents,
  relocateFolder,
  renameFolder,
  renameNote,
  setFolderMeta,
} from './ops';
import {
  allFolderPaths,
  baseName,
  dirOf,
  folderColor,
  folderIcon,
  isInside,
  isPinned,
  notesUnder,
  togglePin,
  unpin,
} from './store';
import { folderLookDialog, openMenu, pickFolder, promptName, undoToast } from './ui';
import { LOCK_ICON, openPrivacy } from '../ui/privacy';

type Anchor = { x: number; y: number } | HTMLElement;

let pinChanged: () => void = () => {};
/** The view registers a redraw for pin changes. */
export function onPinChange(fn: () => void): void {
  pinChanged = fn;
}

/** Ask before taking something off Pinned (the node or folder itself stays). */
export function confirmUnpin(item: { kind: 'note' | 'folder'; key: string }, done: () => void): void {
  const name = item.kind === 'note' ? noteName(item.key) : baseName(item.key) || 'Vault';
  Modal.confirm(
    'Unpin "' + name + '"?',
    `It leaves the Pinned list only; the ${item.kind === 'note' ? 'node' : 'folder'} itself stays in the vault.`,
    'Unpin',
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
      pinChanged();
      undoToast('Unpinned', () => {
        togglePin({ kind, key });
        pinChanged();
      }, 'info', 4000);
    });
    return;
  }
  const now = togglePin({ kind, key });
  pinChanged();
  undoToast(now ? `Pinned "${kind === 'note' ? noteName(key) : baseName(key)}"` : 'Unpinned', () => {
    togglePin({ kind, key });
    pinChanged();
  }, 'info', 4000);
}

/** Ask, then move a folder into another folder. */
export function confirmFolderMove(src: string, destParent: string): void {
  if (src === destParent || isInside(destParent, src) || dirOf(src) === destParent) return;
  const dest = destParent ? destParent + '/' + baseName(src) : baseName(src);
  const n = notesUnder(src).length;
  Modal.open({
    title: 'Move folder',
    body: `<p style="margin:0 0 6px">Move <b>${esc(src)}</b> with its ${n} node${n === 1 ? '' : 's'} into <b>${esc(
      destParent || 'the vault root',
    )}</b>?</p><p class="panel-sub" style="margin:0">It becomes <span class="mono">${esc(
      dest,
    )}</span>. Wikilinks keep working: they resolve by node name.</p>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'Move folder',
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
  const cur = paths.length === 1 ? dirOf(paths[0]) : '';
  pickFolder(
    paths.length === 1 ? `Move "${noteName(paths[0])}" to` : `Move ${paths.length} nodes to`,
    allFolderPaths(),
    cur,
    () => false,
    (f) => void moveNotes(paths, f),
  );
}

export function askMoveFolder(path: string): void {
  pickFolder(
    `Move folder "${baseName(path)}" into`,
    allFolderPaths(),
    dirOf(path),
    (f) => isInside(f, path) || f === dirOf(path),
    (f) => confirmFolderMove(path, f),
  );
}

export function confirmDeleteNotes(paths: string[], after?: () => void): void {
  const what = paths.length === 1 ? `"${noteName(paths[0])}"` : `${paths.length} nodes`;
  Modal.confirm('Delete ' + (paths.length === 1 ? 'node' : 'nodes'), `${what} will be removed from the vault. This cannot be undone here.`, 'Delete', async () => {
    Modal.close();
    const ok = await deleteNotes(paths);
    undoToast(`Deleted ${ok} node${ok === 1 ? '' : 's'}`, null, 'info');
    after?.();
  });
}

export function confirmDeleteFolder(path: string): void {
  const n = notesUnder(path).length;
  const nodes = `${n} node${n === 1 ? '' : 's'}`;
  if (!n) {
    // Nothing inside: one plain confirmation.
    Modal.open({
      title: 'Delete folder',
      body: `<p style="margin:0">Delete the empty folder <b>${esc(path)}</b>?</p>`,
      actions: [
        { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
        {
          label: 'Delete folder',
          cls: 'danger',
          run: async () => {
            Modal.close();
            await deleteFolder(path, true);
            undoToast('Folder deleted', null, 'info');
          },
        },
      ],
    });
    return;
  }
  const opt = (title: string, text: string): string =>
    `<div style="padding:10px 12px;border:1px solid var(--line);border-radius:10px;margin-top:8px"><b style="display:block;font-size:13.5px">${title}</b><span class="panel-sub" style="font-size:12.5px">${text}</span></div>`;
  Modal.open({
    title: 'Delete folder',
    body: `<p style="margin:0 0 4px">Delete <b>${esc(path)}</b>? It holds ${nodes} (sub folders included).</p>${opt(
      'Delete the folder only',
      `The ${nodes} move to the vault root and stay as they are; only the folder goes.`,
    )}${opt('Delete the folder and its nodes', `The folder and all ${nodes} are deleted for good. This cannot be undone.`)}`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'Folder only, keep nodes',
        cls: '',
        run: async () => {
          Modal.close();
          await deleteFolder(path, true);
          undoToast(`Folder removed, ${nodes} moved to the root`, null, 'info');
        },
      },
      {
        label: `Delete with ${n} node${n === 1 ? '' : 's'}`,
        cls: 'danger',
        run: async () => {
          Modal.close();
          await deleteFolder(path, false);
          undoToast('Folder deleted', null, 'info');
        },
      },
    ],
  });
}

export function folderLook(path: string): void {
  folderLookDialog(path, folderColor(path), folderIcon(path), (patch) => void setFolderMeta(path, patch));
}

/**
 * Folder menu. `rename` starts the inline editor of the row that opened it
 * (or a dialog when there is no row).
 */
export function folderMenu(path: string, at: Anchor, rename?: () => void): void {
  const root = path === '';
  openMenu(
    [
      { label: 'New node here', icon: I.newNote, hint: 'N', run: () => nav.newNote(path) },
      { label: 'New folder here', icon: I.newFolder, run: () => nav.newFolder(path) },
      { sep: true, label: '' },
      {
        label: 'Rename',
        icon: I.rename,
        hint: 'F2',
        disabled: root,
        run: () =>
          rename
            ? rename()
            : promptName('Rename folder', 'Folder name', baseName(path), (v) => void renameFolder(path, v)),
      },
      { label: 'Move to…', icon: I.move, disabled: root, run: () => askMoveFolder(path) },
      ...(dirOf(path)
        ? [{ label: 'Move out to top level', icon: I.move, run: () => confirmFolderMove(path, '') }]
        : []),
      {
        label: 'Move contents to…',
        icon: I.move,
        disabled: root,
        run: () =>
          pickFolder(
            `Move everything in "${baseName(path)}" into`,
            allFolderPaths(),
            '',
            (f) => f === path || isInside(f, path),
            (f) =>
              Modal.confirm(
                'Move contents',
                `Every node and sub folder in "${path}" moves into ${f || 'the top level'}; "${baseName(path)}" is then removed. Clashing names get a -N suffix.`,
                'Move contents',
                async () => {
                  Modal.close();
                  await moveFolderContents(path, f);
                },
                false,
              ),
          ),
      },
      { label: 'Color and icon…', icon: I.palette, disabled: root, run: () => folderLook(path) },
      { label: 'Privacy…', icon: LOCK_ICON, disabled: root, run: () => void openPrivacy('folder', path) },
      {
        label: isPinned('folder', path) ? 'Unpin' : 'Pin',
        icon: isPinned('folder', path) ? I.pinOff : I.pin,
        disabled: root,
        run: () => pinToggle('folder', path),
      },
      { sep: true, label: '' },
      { label: 'Delete folder…', icon: I.trash, danger: true, disabled: root, hint: 'Del', run: () => confirmDeleteFolder(path) },
    ],
    at,
  );
}

export function noteMenu(paths: string[], at: Anchor, rename?: () => void): void {
  const one = paths.length === 1 ? paths[0] : null;
  openMenu(
    [
      ...(one ? [{ label: 'Open', icon: I.eye, hint: 'Enter', run: () => nav.openNote(one) }] : []),
      {
        label: 'Rename',
        icon: I.rename,
        hint: 'F2',
        disabled: !one,
        run: () =>
          one &&
          (rename
            ? rename()
            : promptName('Rename node', 'Node name', noteName(one), (v) => void renameNote(one, v))),
      },
      { label: paths.length > 1 ? `Move ${paths.length} nodes to…` : 'Move to…', icon: I.move, run: () => askMoveNotes(paths) },
      ...(one
        ? [
            {
              label: isPinned('note', one) ? 'Unpin' : 'Pin',
              icon: isPinned('note', one) ? I.pinOff : I.pin,
              run: () => pinToggle('note', one),
            },
            { label: 'Privacy…', icon: LOCK_ICON, run: () => void openPrivacy('node', one) },
            {
              label: 'Copy wikilink',
              icon: I.link,
              run: () => {
                void navigator.clipboard?.writeText(`[[${noteName(one)}]]`).then(
                  () => undoToast('Copied [[' + noteName(one) + ']]', null, 'info', 2500),
                  () => undoToast('Clipboard is not available', null, 'err', 2500),
                );
              },
            },
          ]
        : []),
      { label: 'New node in this folder', icon: I.newNote, run: () => nav.newNote(dirOf(paths[0])) },
      { sep: true, label: '' },
      {
        label: paths.length > 1 ? `Delete ${paths.length} nodes…` : 'Delete…',
        icon: I.trash,
        hint: 'Del',
        danger: true,
        run: () => confirmDeleteNotes(paths),
      },
    ],
    at,
  );
}
