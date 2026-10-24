import type { GNode } from './model';

interface RadialGuides {
  rings: number[];
}

interface Dir {
  path: string;
  depth: number;
  folder: GNode | null;
  notes: GNode[];
  kids: Dir[];
  weight: number;
}

function dirTree(nodes: GNode[]): Dir {
  const root: Dir = { path: '', depth: 0, folder: null, notes: [], kids: [], weight: 0 };
  const dirs = new Map<string, Dir>([['', root]]);
  const ensure = (path: string): Dir => {
    let d = dirs.get(path);
    if (d) return d;
    const cut = path.lastIndexOf('/');
    const parent = ensure(cut < 0 ? '' : path.slice(0, cut));
    d = { path, depth: parent.depth + 1, folder: null, notes: [], kids: [], weight: 0 };
    parent.kids.push(d);
    dirs.set(path, d);
    return d;
  };
  for (const n of nodes) {
    if (n.kind === 'folder') ensure(n.path).folder = n;
    else ensure(n.dir).notes.push(n);
  }
  const weigh = (d: Dir): number => {
    d.kids.sort((a, b) => a.path.localeCompare(b.path));
    d.notes.sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
    d.weight = d.notes.length + d.kids.reduce((s, k) => s + weigh(k), 0) + (d.folder ? 1 : 0);
    return Math.max(1, d.weight);
  };
  weigh(root);
  return root;
}

const RING = 150;

/** Concentric rings: folder depth sets the ring, folders own angular sectors. */
export function radialTargets(nodes: GNode[]): RadialGuides {
  const root = dirTree(nodes);
  const rings = new Set<number>();
  const place = (d: Dir, a0: number, a1: number): void => {
    const span = a1 - a0;
    const mid = (a0 + a1) / 2;
    if (d.folder) {
      const r = d.depth * RING;
      d.folder.tx = Math.cos(mid) * r;
      d.folder.ty = Math.sin(mid) * r;
      rings.add(r);
    }
    const total = Math.max(1, d.weight - (d.folder ? 1 : 0));
    const share = (span * d.notes.length) / total;
    const kidsSpan = span - share;
    let a = a0;
    const kidsBefore = Math.ceil(d.kids.length / 2);
    const placeKid = (k: Dir) => {
      const w = (kidsSpan * Math.max(1, k.weight)) / Math.max(1, total - d.notes.length);
      place(k, a, a + w);
      a += w;
    };
    d.kids.slice(0, kidsBefore).forEach(placeKid);
    if (d.notes.length) {
      const base = (d.depth + 1) * RING - RING * 0.35;
      const s0 = a;
      const s1 = a + share;
      const minGap = 15;
      const arc = Math.max(1e-3, (s1 - s0) * base);
      const lanes = Math.max(1, Math.ceil((d.notes.length * minGap) / arc));
      const perLane = Math.ceil(d.notes.length / lanes);
      d.notes.forEach((n, i) => {
        const lane = i % lanes;
        const slot = Math.floor(i / lanes);
        const t = perLane > 1 ? (slot + 0.5) / perLane : 0.5;
        const ang = s0 + (s1 - s0) * (lanes > 1 ? (slot + 0.5 + (lane % 2) * 0.5) / (perLane + 0.5) : t);
        const r = base + lane * 13;
        n.tx = Math.cos(ang) * r;
        n.ty = Math.sin(ang) * r;
      });
      rings.add((d.depth + 1) * RING - RING * 0.35);
      a = s1;
    }
    d.kids.slice(kidsBefore).forEach(placeKid);
  };
  place(root, -Math.PI / 2, Math.PI * 1.5);
  return { rings: Array.from(rings).sort((x, y) => x - y) };
}

/** Folder islands: one packed disc per directory, hubs in the middle. */
export function clusterTargets(nodes: GNode[]): void {
  const byDir = new Map<string, GNode[]>();
  const folders = new Map<string, GNode>();
  for (const n of nodes) {
    if (n.kind === 'folder') {
      folders.set(n.path, n);
      continue;
    }
    const list = byDir.get(n.dir) || [];
    list.push(n);
    byDir.set(n.dir, list);
  }
  const groups = Array.from(byDir.entries()).sort(
    (a, b) => a[0].split('/')[0].localeCompare(b[0].split('/')[0]) || b[1].length - a[1].length,
  );
  const placed: { x: number; y: number; r: number }[] = [];
  const centres = new Map<string, { x: number; y: number }>();
  for (const [dir, list] of groups) {
    list.sort((a, b) => b.degree - a.degree);
    let area = 0;
    for (const n of list) area += (n.r + 5) * (n.r + 5) * 4.2;
    const R = Math.sqrt(area / Math.PI) + 22;
    // Walk an Archimedean spiral until the disc fits.
    let x = 0,
      y = 0;
    for (let t = 0; ; t += 0.12) {
      const rr = 9 * t;
      x = Math.cos(t) * rr;
      y = Math.sin(t) * rr;
      if (placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + R + 36)) break;
      if (t > 4000) break;
    }
    placed.push({ x, y, r: R });
    centres.set(dir, { x, y });
    list.forEach((n, i) => {
      // Phyllotaxis: evenly filled disc, hubs at the centre.
      const rr = Math.sqrt(i + 0.5) * Math.sqrt(area / Math.PI / Math.max(1, list.length));
      const a = i * 2.399963;
      n.tx = x + Math.cos(a) * rr;
      n.ty = y + Math.sin(a) * rr;
    });
  }
  const fpaths = Array.from(folders.keys()).sort((a, b) => b.split('/').length - a.split('/').length);
  for (const p of fpaths) {
    const f = folders.get(p)!;
    const own = centres.get(p);
    if (own) {
      const disc = placed.find((d) => d.x === own.x && d.y === own.y);
      f.tx = own.x;
      f.ty = own.y - (disc ? disc.r + 10 : 30);
      continue;
    }
    let sx = 0,
      sy = 0,
      c = 0;
    centres.forEach((v, k) => {
      if (k.startsWith(p + '/')) {
        sx += v.x;
        sy += v.y;
        c++;
      }
    });
    f.tx = c ? sx / c : 0;
    f.ty = c ? sy / c : 0;
    centres.set(p, { x: f.tx, y: f.ty });
  }
}

/** Starting position for a node with no history: near its folder's centroid. */
export function seedPositions(nodes: GNode[]): void {
  const groupIndex = new Map<string, number>();
  for (const n of nodes) if (!groupIndex.has(n.group)) groupIndex.set(n.group, groupIndex.size);
  const G = Math.max(1, groupIndex.size);
  const R = 120 + Math.sqrt(nodes.length) * 14;
  let i = 0;
  for (const n of nodes) {
    if (!Number.isNaN(n.x)) continue;
    const g = groupIndex.get(n.group) || 0;
    const a = (g / G) * Math.PI * 2;
    const rr = Math.sqrt(i++) * 9;
    const b = i * 2.399963;
    n.x = Math.cos(a) * R + Math.cos(b) * rr * 0.4;
    n.y = Math.sin(a) * R + Math.sin(b) * rr * 0.4;
  }
}
