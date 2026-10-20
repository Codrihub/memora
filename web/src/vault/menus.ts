// Context menus and the confirm flows behind them, shared by tree, list and note.

import { esc, useStyles } from '../dom';
import { copyText } from '../control/ui';
import { createSelect, type SelectOption } from '../ui/select';
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
.fd-opt{display:flex;gap:11px;align-items:flex-start;padding:12px 13px;border:1px solid var(--line);border-radius:12px;margin-top:10px;cursor:pointer;
  transition:border-color .15s,background .15s}
.fd-opt:hover{border-color:var(--line-strong)}
.fd-opt:has(input:checked){border-color:var(--accent-line);background:var(--accent-soft)}
.fd-opt.danger:has(input:checked){border-color:color-mix(in srgb,var(--danger) 55%,transparent);background:var(--danger-soft)}
.fd-opt input{margin:3px 0 0;flex:none;accent-color:var(--accent)}
.fd-opt.danger input{accent-color:var(--danger)}
.fd-opt-t{display:block;font-weight:600;font-size:14px}
.fd-opt.danger .fd-opt-t{color:var(--danger)}
.fd-opt-d{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;line-height:1.45}
.fd-opt-b{flex:1;min-width:0}
.fd-dest{display:block;margin-top:9px}
.fd-dest .ui-sel{width:100%}
`;

/** Destination choices for the nodes of a folder being deleted. */
export function folderDeleteTargets(path: string, folders: string[]): SelectOption[] {
  const parent = dirOf(path);
  const top = path.split('/')[0];
  const opts: SelectOption[] = [];
  const seen = new Set<string>();
  const add = (value: string, label: string, hint: string, group?: string): void => {
    if (seen.has(value)) return;
    seen.add(value);
    opts.push({ value, label, hint, group });
  };
  if (parent) add(parent, parent, 'Parent folder (default)');
  if (top !== path && top !== parent) add(top, top, 'Top-level folder of this path');
  add('', 'Root', parent ? 'The top level of the vault' : 'The top level of the vault (default)');
  for (const f of folders) {
    if (!f || isInside(f, path)) continue;
    add(f, f, '', 'Another folder');
  }
  return opts;
}

/**
 * Delete a folder in up to two steps: confirm, then (when nodes are inside)
 * choose to move them elsewhere or send them to the trash.
 */
export function confirmDeleteFolder(path: string): void {
  useStyles('fd-css', FD_CSS);
  const n = notesUnder(path).length;
  const subs = allFolderPaths().filter((f) => f !== path && isInside(f, path)).length;
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
  const targets = folderDeleteTargets(path, allFolderPaths());
  let mode: 'move' | 'trash' = 'move';
  const sel = createSelect({
    options: targets,
    value: targets[0].value,
    label: 'Move the nodes to',
    searchable: targets.length > 6,
    className: 'block',
  });
  const moveLabel = `Move ${nodes} and delete folder`;
  const trashLabel = `Delete folder and ${nodes}`;
  // Step 2 replaces step 1; closing first hands focus back to whatever opened step 1.
  Modal.close();
  Modal.open({
    title: `Delete folder "${name}"?`,
    body: `<p class="fd-p">${esc(holds)}</p>
<label class="fd-opt"><input type="radio" name="fdMode" value="move" checked><span class="fd-opt-b"><span class="fd-opt-t">Move the nodes, then delete the folder</span>
<span class="fd-opt-d">Subfolders are kept inside the destination and links to the moved nodes are updated. A clashing name gets a -N suffix.</span>
<span class="fd-dest" data-fd-dest></span></span></label>
<label class="fd-opt danger"><input type="radio" name="fdMode" value="trash"><span class="fd-opt-b"><span class="fd-opt-t">Delete everything in this folder</span>
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
          const into = sel.value;
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
      const go = body.parentElement?.querySelector<HTMLButtonElement>('.modal-foot .btn:last-child');
      body.querySelectorAll<HTMLInputElement>('input[name=fdMode]').forEach((r) =>
        r.addEventListener('change', () => {
          if (!r.checked) return;
          mode = r.value === 'trash' ? 'trash' : 'move';
          if (go) {
            go.textContent = mode === 'trash' ? trashLabel : moveLabel;
            go.classList.toggle('primary', mode === 'move');
            go.classList.toggle('danger', mode === 'trash');
          }
        }),
      );
      // Choosing a destination also picks the move option.
      sel.el.addEventListener('click', () => {
        const r = body.querySelector<HTMLInputElement>('input[value=move]');
        if (r && !r.checked) {
          r.checked = true;
          r.dispatchEvent(new Event('change'));
        }
      });
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
