// Context menus and the confirm flows behind them, shared by tree, list and note.

import { esc, useStyles } from '../dom';
import { copyText } from '../control/ui';
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
  togglePin,
  unpin,
} from './store';
import { folderLookDialog, openMenu, promptName, undoToast } from './ui';
import { LOCK_ICON, openPrivacy } from '../ui/privacy';

type Anchor = { x: number; y: number } | HTMLElement;


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
      undoToast('Unpinned', () => void togglePin({ kind, key }), 'info', 4000);
    });
    return;
  }
  const now = togglePin({ kind, key });
  undoToast(now ? `Pinned "${kind === 'note' ? noteName(key) : baseName(key)}"` : 'Unpinned', () => void togglePin({ kind, key }), 'info', 4000);
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
  // "current" only when every node lives in the same folder.
  const dirs = new Set(paths.map(dirOf));
  const cur = dirs.size === 1 ? [...dirs][0] : null;
  pickFolderDialog({
    title: paths.length === 1 ? `Move "${noteName(paths[0])}" to` : `Move ${paths.length} nodes to`,
    folders: pickerFolders(),
    current: cur,
    disabled: (f) => (f === cur ? (paths.length === 1 ? 'The node is already here' : 'The nodes are already here') : false),
    run: (f) => void moveNotes(paths, f),
  });
}

export function askMoveFolder(path: string): void {
  // The folder itself and everything below it are not offered.
  pickFolderDialog({
    title: `Move folder "${baseName(path)}" into`,
    folders: pickerFolders(),
    current: dirOf(path),
    exclude: [path],
    disabled: (f) => (f === dirOf(path) ? 'The folder is already here' : false),
    run: (f) => confirmFolderMove(path, f),
  });
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Delete nodes. The web app's delete (POST /api/delete) removes the file: there
 * is no trash behind it, only the vault's git history when that is turned on.
 */
export function confirmDeleteNotes(paths: string[], after?: () => void): void {
  const one = paths.length === 1;
  const what = one ? `"${noteName(paths[0])}"` : plural(paths.length, 'node');
  Modal.open({
    title: one ? `Delete node ${what}?` : `Delete ${what}?`,
    body: `<p style="margin:0 0 8px">${esc(one ? what : `These ${what}`)} ${
      one ? 'is' : 'are'
    } deleted from the vault for good. Single nodes do not go to a trash, so this cannot be undone here.</p><p class="panel-sub" style="margin:0">If version history (git) is on for this vault, an agent can still bring ${
      one ? 'it' : 'them'
    } back with the <span class="mono">restore_memory</span> tool. Links to ${one ? 'it' : 'them'} stay in other nodes and show as missing.</p>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: one ? 'Delete node' : `Delete ${what}`,
        cls: 'danger',
        run: async () => {
          Modal.close();
          const ok = await deleteNotes(paths);
          undoToast(`Deleted ${plural(ok, 'node')}`, null, 'info');
          after?.();
        },
      },
    ],
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

/**
 * Delete a folder in up to two steps: confirm, then (when nodes are inside)
 * choose to move them elsewhere or send them to the trash.
 */
export function confirmDeleteFolder(path: string): void {
  useStyles('fd-css', FD_CSS);
  const n = notesUnder(path).length;
  const subs = pickerFolders().filter((f) => f !== path && isInside(f, path)).length;
  const name = baseName(path);
  Modal.open({
    title: `Delete folder "${name}"?`,
    body: n
      ? `<p class="fd-p">The folder <b>${esc(path)}</b>${
          subs ? ` and its ${plural(subs, 'subfolder')}` : ''
        } will be removed from the vault.</p><p class="fd-p">It holds ${plural(
          n,
          'node',
        )}. Next you choose what happens to them: move them to another folder, or delete them. Nothing is changed yet.</p>`
      : `<p class="fd-p">The folder <b>${esc(path)}</b> has no nodes. It is removed from the vault${
          subs ? `, with its ${plural(subs, 'empty subfolder')}` : ''
        }.</p><p class="panel-sub fd-p">Other files in it (such as images) are deleted too. This cannot be undone.</p>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: n ? 'Delete…' : 'Delete folder',
        cls: 'danger',
        run: async () => {
          if (n) {
            folderDeleteStep2(path, n, subs);
            return;
          }
          Modal.close();
          if ((await deleteFolder(path, { mode: 'move', into: dirOf(path) })) != null) undoToast(`Folder "${name}" deleted`, null, 'info');
        },
      },
    ],
  });
}

function folderDeleteStep2(path: string, n: number, subs: number): void {
  const name = baseName(path);
  const nodes = plural(n, 'node');
  const direct = notesUnder(path).filter((x) => dirOf(x.path) === path).length;
  const holds = !subs
    ? `This folder has ${nodes}.`
    : !direct
      ? `This folder has ${nodes} in ${plural(subs, 'subfolder')}.`
      : `This folder has ${nodes}: ${direct} directly inside and the rest in ${plural(subs, 'subfolder')}.`;
  let mode: 'move' | 'trash' = 'move';
  let go: HTMLButtonElement | null = null;
  // The folder being deleted and everything below it are not destinations.
  const sel = createFolderPicker({
    folders: pickerFolders(),
    value: dirOf(path),
    exclude: [path],
    label: 'Move the nodes to',
    onChange: () => {
      if (go && mode === 'move') go.disabled = sel.value == null;
    },
  });
  const moveLabel = `Move ${nodes} and delete folder`;
  const trashLabel = `Delete folder and ${nodes}`;
  // Step 2 replaces step 1; closing first hands focus back to whatever opened step 1.
  Modal.close();
  Modal.open({
    title: `Delete folder "${name}"?`,
    body: `<p class="fd-p">${esc(holds)}</p>
<div class="fd-opt" data-fd-move><label class="fd-opt-l"><input type="radio" name="fdMode" value="move" checked><span class="fd-opt-b"><span class="fd-opt-t">Move the nodes, then delete the folder</span>
<span class="fd-opt-d">Subfolders are kept inside the destination and links to the moved nodes are updated. A clashing name gets a -N suffix.</span></span></label>
<div class="fd-dest" data-fd-dest><span class="fd-dest-l">Move the nodes to</span></div></div>
<label class="fd-opt fd-opt-l danger"><input type="radio" name="fdMode" value="trash"><span class="fd-opt-b"><span class="fd-opt-t">Delete everything in this folder</span>
<span class="fd-opt-d">All ${esc(nodes)} go to the vault's trash (the <span class="mono">.Trash</span> folder). The web app cannot restore them yet; an agent can, with the <span class="mono">restore_trash</span> tool, back to their old paths. Other files in the folder (such as images) are deleted for good.</span></span></label>`,
    actions: [
      {
        label: 'Back',
        cls: 'ghost',
        run: () => {
          Modal.close();
          confirmDeleteFolder(path);
        },
      },
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
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
              ? `Folder "${name}" deleted, ${plural(done, 'node')} moved to the trash`
              : `Folder "${name}" deleted, ${plural(done, 'node')} moved to ${into || 'Root'}`,
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
  void copyText(path, 'Path copied');
}

/** Copy a full-path wikilink: [[Folder/Name]]. */
export function copyWikilink(path: string): void {
  void copyText(`[[${path.replace(/\.md$/i, '')}]]`, 'Wikilink copied');
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
          pickFolderDialog({
            title: `Move everything in "${baseName(path)}" into`,
            folders: pickerFolders(),
            value: dirOf(path),
            exclude: [path],
            verb: 'Move contents here',
            run: (f) =>
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
          }),
      },
      { label: 'Copy path', icon: I.copy, disabled: root, run: () => copyPath(path) },
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
            { label: 'Copy path', icon: I.copy, run: () => copyPath(one) },
            { label: 'Copy wikilink', icon: I.link, run: () => copyWikilink(one) },
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
