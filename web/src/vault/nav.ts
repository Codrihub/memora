// Navigation callbacks shared by the tree, list and note panes. view.ts
// fills them in, so the components never import the view (no cycles).

export const nav = {
  /** Show a folder's notes in the list pane ('' = whole vault). */
  selectFolder: (_path: string): void => {},
  /** Open a note in the reader. */
  openNote: (_path: string): void => {},
  /** Start a new note in a folder (inline title prompt). */
  newNote: (_folder: string): void => {},
  /** Start a new sub folder (inline name prompt). */
  newFolder: (_parent: string): void => {},
};

/** Drag payload of the drag in progress (dataTransfer is unreadable during dragover). */
export type DragPayload =
  | { kind: 'notes'; paths: string[] }
  | { kind: 'folder'; path: string }
  | { kind: 'pin'; id: string; item: { kind: 'note' | 'folder'; key: string } };

export const drag: { cur: DragPayload | null } = { cur: null };

export function startDrag(e: DragEvent, payload: DragPayload, label: string): void {
  drag.cur = payload;
  if (!e.dataTransfer) return;
  // 'all': targets ask for different effects (move into a folder, link into
  // Pinned); a drop whose effect is not allowed never fires at all.
  e.dataTransfer.effectAllowed = 'all';
  try {
    e.dataTransfer.setData('text/plain', label);
    e.dataTransfer.setData('application/x-memora', JSON.stringify(payload));
  } catch {
    /* some browsers refuse custom types */
  }
  // A compact ghost: "3 notes" or the item name.
  const ghost = document.createElement('div');
  ghost.className = 'vx-ghost';
  ghost.textContent = label;
  document.body.appendChild(ghost);
  try {
    e.dataTransfer.setDragImage(ghost, 12, 14);
  } catch {
    /* not supported */
  }
  setTimeout(() => ghost.remove(), 0);
  document.body.classList.add('vx-dragging');
}

export function endDrag(): void {
  drag.cur = null;
  document.body.classList.remove('vx-dragging');
  document.querySelectorAll('.vx-drop-into,.vx-drop-before,.vx-drop-after,.vx-drop-zone').forEach((n) => {
    n.classList.remove('vx-drop-into', 'vx-drop-before', 'vx-drop-after', 'vx-drop-zone');
  });
}
