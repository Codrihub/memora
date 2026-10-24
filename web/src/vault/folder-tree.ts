// Pure helpers behind the folder picker (tree, search matching, visible rows). No DOM.

export interface PickNode {
  /** Vault-relative folder path ('' = the vault root). */
  path: string;
  name: string;
  /** 0 = root, 1 = a top-level folder, ... */
  depth: number;
  parent: PickNode | null;
  children: PickNode[];
}

interface PickTree {
  root: PickNode;
  byPath: Map<string, PickNode>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Whether `path` is `top` itself or anywhere below it ('' contains everything). */
function inSubtree(path: string, top: string): boolean {
  return top === '' || path === top || path.startsWith(top + '/');
}

/** Folder tree from paths in any order; adds missing ancestors and leaves out `exclude` subtrees. */
export function buildPickTree(paths: Iterable<string>, exclude: string[] = []): PickTree {
  const root: PickNode = { path: '', name: '', depth: 0, parent: null, children: [] };
  const byPath = new Map<string, PickNode>([['', root]]);
  const skip = exclude.filter((x) => x !== '');
  const ensure = (path: string): PickNode => {
    const hit = byPath.get(path);
    if (hit) return hit;
    const parent = ensure(parentOf(path));
    const node: PickNode = {
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      depth: parent.depth + 1,
      parent,
      children: [],
    };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };
  for (const raw of paths) {
    const p = raw.replace(/^\/+|\/+$/g, '');
    if (!p || p === 'Root' || skip.some((x) => inSubtree(p, x))) continue;
    ensure(p);
  }
  for (const n of byPath.values()) n.children.sort((a, b) => collator.compare(a.name, b.name));
  return { root, byPath };
}

/** Ancestor paths of `path`, nearest last, root ('') first. */
export function ancestorsOf(path: string): string[] {
  const out: string[] = [];
  let p = path;
  while (p) {
    p = parentOf(p);
    out.unshift(p);
  }
  return out;
}

/** [start, end) character ranges in a full path. */
type Range = [number, number];

export interface FolderMatch {
  path: string;
  /** Lower is better. */
  score: number;
  /** Highlight ranges in `path`. */
  ranges: Range[];
}

/** Lower-case, and treat "›", "\" and "/" alike so a pasted breadcrumb matches. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s*[›>\\]\s*/g, '/');
}

/** Every query term must appear in the path; hits in the folder's own name rank first, then shallower folders. */
function matchFolder(path: string, query: string): FolderMatch | null {
  const terms = norm(query.trim())
    .split(/\s+/)
    .map((t) => t.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  if (!terms.length || !path) return null;
  const hay = path.toLowerCase();
  const nameStart = path.lastIndexOf('/') + 1;
  const name = hay.slice(nameStart);
  const ranges: Range[] = [];
  let score = 0;
  for (const t of terms) {
    // Prefer a hit in the name, then at a segment start, then anywhere.
    let at = -1;
    let rank = 3;
    const inName = name.indexOf(t);
    if (inName >= 0) {
      at = nameStart + inName;
      rank = inName === 0 ? (name.length === t.length ? 0 : 1) : 2;
    } else {
      const seg = hay.startsWith(t) ? 0 : hay.indexOf('/' + t);
      if (seg >= 0) {
        at = seg === 0 ? 0 : seg + 1;
        rank = 4;
      } else {
        at = hay.indexOf(t);
        rank = 5;
      }
    }
    if (at < 0) return null;
    ranges.push([at, at + t.length]);
    score += rank * 10;
  }
  const depth = path.split('/').length;
  score += Math.min(depth, 9);
  return { path, score, ranges: mergeRanges(ranges) };
}

function mergeRanges(ranges: Range[]): Range[] {
  const s = ranges.slice().sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Every matching folder, best first (ties alphabetical). */
export function searchFolders(paths: Iterable<string>, query: string): FolderMatch[] {
  const out: FolderMatch[] = [];
  for (const p of paths) {
    const m = matchFolder(p, query);
    if (m) out.push(m);
  }
  return out.sort((a, b) => a.score - b.score || collator.compare(a.path, b.path));
}

/** One piece of a path segment: text and whether it is highlighted. */
export interface Piece {
  text: string;
  hl: boolean;
}

/** Path segments, each split into highlighted / plain pieces, for a breadcrumb. */
export function breadcrumbPieces(path: string, ranges: Range[]): Piece[][] {
  const segs: Piece[][] = [];
  let start = 0;
  for (const seg of path.split('/')) {
    const end = start + seg.length;
    const pieces: Piece[] = [];
    let cur = start;
    for (const [a, b] of ranges) {
      const lo = Math.max(a, start);
      const hi = Math.min(b, end);
      if (hi <= lo) continue;
      if (lo > cur) pieces.push({ text: path.slice(cur, lo), hl: false });
      pieces.push({ text: path.slice(lo, hi), hl: true });
      cur = hi;
    }
    if (cur < end) pieces.push({ text: path.slice(cur, end), hl: false });
    segs.push(pieces);
    start = end + 1;
  }
  return segs;
}

export interface PickRow {
  node: PickNode;
  open: boolean;
  /** Has children to show in this mode (in search mode: kept children only). */
  kids: boolean;
  /** Set in search mode: the folder matches (otherwise it is only an ancestor of a match). */
  match?: FolderMatch;
}

/** Rows to draw: folders under `expanded` ancestors, or with `matches` only the matches and their ancestors (minus `collapsed`). */
export function visibleRows(
  tree: PickTree,
  expanded: Set<string>,
  matches?: FolderMatch[] | null,
  collapsed: Set<string> = new Set(),
): PickRow[] {
  const rows: PickRow[] = [];
  if (matches) {
    const hit = new Map(matches.map((m) => [m.path, m]));
    const keep = new Set<string>(['']);
    for (const m of matches) {
      if (!tree.byPath.has(m.path)) continue;
      keep.add(m.path);
      for (const a of ancestorsOf(m.path)) keep.add(a);
    }
    const walk = (n: PickNode): void => {
      const kids = n.children.filter((c) => keep.has(c.path));
      const open = kids.length > 0 && (n.depth === 0 || !collapsed.has(n.path));
      rows.push({ node: n, open, kids: kids.length > 0, match: hit.get(n.path) });
      if (open) kids.forEach(walk);
    };
    walk(tree.root);
    return rows;
  }
  const walk = (n: PickNode): void => {
    const open = n.depth === 0 || (n.children.length > 0 && expanded.has(n.path));
    rows.push({ node: n, open, kids: n.children.length > 0 });
    if (open) n.children.forEach(walk);
  };
  walk(tree.root);
  return rows;
}
