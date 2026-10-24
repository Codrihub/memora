import { hashColor, stemTitle } from './format';
import { loadOpenFolders } from './storage';
import type { Config, FolderMetaMap, GraphLink, GraphNode, Health, NoteRef, Stats, Tree } from './types';

export type Page =
  | 'brain'
  | 'canvas'
  | 'home'
  | 'vault'
  | 'graph'
  | 'tags'
  | 'logs'
  | 'keys'
  | 'tools'
  | 'access'
  | 'settings'
  | 'docs'
  | 'trash';

interface GraphState {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Set by the graph view so the router can stop the animation loop. */
  stop: (() => void) | null;
}

interface TagState {
  index: Map<string, NoteRef[]> | null;
  built: boolean;
  active: string | null;
  progress: number;
}

interface Me {
  user?: string;
  username?: string;
  expires_in?: number;
  authenticated?: boolean;
  redirect?: string;
}

interface AppState {
  page: Page;
  tree: Tree;
  /** Every folder path from /api/folders, empty and nested ones included. */
  folders: string[];
  folderMeta: FolderMetaMap;
  stats: Stats;
  health: Health;
  config: Config;
  me: Me | null;
  open: Set<string>;
  filter: string;
  note: string | null;
  editing: boolean;
  graph: GraphState;
  tags: TagState;
  peekPath: string | null;
  keysDeleted: { id: string; name?: string }[];
}

export const state: AppState = {
  page: 'brain',
  tree: {},
  folders: [],
  folderMeta: {},
  stats: { notes: 0, links: 0, folders: 0 },
  health: {},
  config: {},
  me: null,
  open: loadOpenFolders(),
  filter: '',
  note: null,
  editing: false,
  graph: { nodes: [], links: [], stop: null },
  tags: { index: null, built: false, active: null, progress: 0 },
  peekPath: null,
  keysDeleted: [],
};

/** Every note in the tree, with its folder filled in. */
export function allNotes(): NoteRef[] {
  const out: NoteRef[] = [];
  for (const f of Object.keys(state.tree)) {
    for (const n of state.tree[f] || []) out.push({ ...n, folder: n.folder || f });
  }
  return out;
}

let titleTree: unknown = null;
const titles = new Map<string, string>();

/** The title a note shows: the server's display title, else its file name with `_` as spaces. */
export function noteTitle(path?: string | null): string {
  const p = String(path || '');
  if (titleTree !== state.tree) {
    titleTree = state.tree;
    titles.clear();
    for (const f of Object.keys(state.tree)) for (const n of state.tree[f] || []) if (n.title) titles.set(n.path, n.title);
  }
  return titles.get(p) || stemTitle((p.split('/').pop() || p).replace(/\.md$/i, ''));
}

/** Folder names, Root first, then alphabetical. */
export function folderNames(): string[] {
  return Object.keys(state.tree).sort((a, b) =>
    a === 'Root' ? -1 : b === 'Root' ? 1 : a.localeCompare(b),
  );
}

export function colorOfFolder(folder: string): string {
  const meta = state.folderMeta[folder];
  return (meta && meta.color) || hashColor(folder);
}

// `state.note` is observed so the router keeps the URL in step with the open node.
const noteListeners: ((path: string | null) => void)[] = [];
let noteValue: string | null = state.note;
Object.defineProperty(state, 'note', {
  enumerable: true,
  configurable: true,
  get: () => noteValue,
  set: (v: string | null) => {
    if (v === noteValue) return;
    noteValue = v;
    for (const fn of noteListeners) {
      try {
        fn(v);
      } catch (e) {
        console.error('note listener failed', e);
      }
    }
  },
});

export function onNoteChange(fn: (path: string | null) => void): void {
  noteListeners.push(fn);
}
