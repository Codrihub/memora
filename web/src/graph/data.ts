// Node objects stay alive across refreshes so positions and velocities survive live updates.

import { noteTitle, state } from '../state';
import type { GraphData } from '../types';
import { FOLDER_PREFIX, type GLink, type GNode } from './model';

export interface Filters {
  hiddenGroups: Set<string>;
  tags: Set<string>;
  folders: boolean;
  orphans: boolean;
}

interface RawNode {
  id: string;
  path?: string;
  folder?: string;
  color?: string;
  degree?: number;
  tags?: string[];
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

const DARK = ['#2dd4bf', '#60a5fa', '#c084fc', '#fbbf24', '#f472b6', '#4ade80', '#fb923c', '#a3e635', '#f87171', '#818cf8', '#22d3ee', '#e879f9'];
const LIGHT = ['#0d9488', '#2563eb', '#9333ea', '#d97706', '#db2777', '#16a34a', '#ea580c', '#65a30d', '#dc2626', '#4f46e5', '#0891b2', '#c026d3'];

function mix(hex: string, to: number, t: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const v = parseInt(h, 16);
  const ch = (c: number) => Math.round(c + (to - c) * t);
  const r = ch((v >> 16) & 255);
  const g = ch((v >> 8) & 255);
  const b = ch(v & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function noteRadius(deg: number): number {
  return 3.6 + Math.sqrt(deg) * 1.9;
}

export class GraphModel {
  all = new Map<string, GNode>();
  /** Deduplicated, undirected wikilinks for the physics. */
  refs: [string, string][] = [];
  outgoing = new Map<string, Set<string>>();
  incoming = new Map<string, Set<string>>();
  byPath = new Map<string, GNode>();
  /** Filled lazily (API or a background scan). */
  tagsByPath = new Map<string, string[]>();
  /** Note name -> key of the first note with that name, for wikilinks. */
  byName = new Map<string, string>();

  private make(id: string, kind: GNode['kind'], label: string, path: string, group: string, dir: string, color: string): GNode {
    return {
      id,
      kind,
      label,
      path,
      group,
      dir,
      tags: [],
      color,
      degree: 0,
      r: 4,
      x: NaN,
      y: NaN,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      pinned: false,
      tx: 0,
      ty: 0,
      born: 0,
      dying: 0,
      fade: 1,
      i: 0,
    };
  }

  ingest(g: GraphData, now: number, animate: boolean): { added: GNode[]; removed: GNode[] } {
    const rawNodes = (g.nodes || []) as RawNode[];
    const seen = new Set<string>();
    const added: GNode[] = [];
    this.byPath.clear();
    const dirs = new Set<string>();
    // Keyed by path: two notes may share a name in different folders.
    this.byName.clear();
    for (const r of rawNodes) {
      const path = r.path || r.id + '.md';
      const dir = dirOf(path);
      const group = r.folder || (dir ? dir.split('/')[0] : 'Root');
      const key = path;
      if (!this.byName.has(r.id)) this.byName.set(r.id, key);
      let n = this.all.get(key);
      if (!n || n.kind !== 'note') {
        n = this.make(key, 'note', noteTitle(path) || r.id, path, group, dir, '');
        this.all.set(key, n);
        added.push(n);
        if (animate) n.born = now;
      }
      n.path = path;
      n.dir = dir;
      n.group = group;
      n.dying = 0;
      if (Array.isArray(r.tags)) this.tagsByPath.set(path, r.tags);
      n.tags = this.tagsByPath.get(path) || n.tags;
      seen.add(key);
      this.byPath.set(path, n);
      for (let d = dir; d; d = dirOf(d)) dirs.add(d);
    }
    for (const d of dirs) {
      const id = FOLDER_PREFIX + d;
      let f = this.all.get(id);
      const group = d.split('/')[0];
      if (!f) {
        f = this.make(id, 'folder', d.split('/').pop() || d, d, group, dirOf(d), '');
        this.all.set(id, f);
        added.push(f);
        if (animate) f.born = now;
      }
      f.dying = 0;
      seen.add(id);
    }
    const removed: GNode[] = [];
    this.all.forEach((n, id) => {
      if (seen.has(id)) return;
      if (animate) {
        if (!n.dying) {
          n.dying = now;
          removed.push(n);
        }
      } else {
        this.all.delete(id);
      }
    });

    // Direction is kept for the card's "links out" and "backlinks".
    this.outgoing.clear();
    this.incoming.clear();
    const pairs = new Set<string>();
    this.refs = [];
    for (const raw of g.links || []) {
      const l = { source: this.byName.get(raw.source) || raw.source, target: this.byName.get(raw.target) || raw.target };
      if (l.source === l.target || !this.all.has(l.source) || !this.all.has(l.target)) continue;
      if (!this.outgoing.has(l.source)) this.outgoing.set(l.source, new Set());
      if (!this.incoming.has(l.target)) this.incoming.set(l.target, new Set());
      this.outgoing.get(l.source)!.add(l.target);
      this.incoming.get(l.target)!.add(l.source);
      const key = l.source < l.target ? l.source + '\u0001' + l.target : l.target + '\u0001' + l.source;
      if (pairs.has(key)) continue;
      pairs.add(key);
      this.refs.push([l.source, l.target]);
    }
    const deg = new Map<string, number>();
    for (const [a, b] of this.refs) {
      deg.set(a, (deg.get(a) || 0) + 1);
      deg.set(b, (deg.get(b) || 0) + 1);
    }
    const kids = new Map<string, number>();
    this.all.forEach((n) => {
      if (n.dying) return;
      if (n.dir) kids.set(n.dir, (kids.get(n.dir) || 0) + 1);
    });
    this.all.forEach((n) => {
      if (n.kind === 'note') {
        n.degree = deg.get(n.id) || 0;
        n.r = noteRadius(n.degree);
      } else {
        n.degree = kids.get(n.path) || 0;
        n.r = 9 + Math.sqrt(n.degree) * 1.6;
      }
    });

    // New nodes grow out of a neighbour instead of flying in from the origin.
    for (const n of added) {
      if (!Number.isNaN(n.x)) continue;
      const anchor = this.anchorFor(n);
      if (anchor && !Number.isNaN(anchor.x)) {
        const a = Math.random() * Math.PI * 2;
        n.x = anchor.x + Math.cos(a) * (anchor.r + 14);
        n.y = anchor.y + Math.sin(a) * (anchor.r + 14);
      }
    }
    return { added, removed };
  }

  /** Explicit folder colour wins, else a palette by group size; sub folders get shades. */
  recolor(light: boolean): void {
    const pal = light ? LIGHT : DARK;
    const sizes = new Map<string, number>();
    this.all.forEach((n) => sizes.set(n.group, (sizes.get(n.group) || 0) + 1));
    const order = Array.from(sizes.keys()).sort((a, b) => (sizes.get(b) || 0) - (sizes.get(a) || 0) || a.localeCompare(b));
    const base = new Map<string, string>();
    order.forEach((g, i) => {
      const meta = state.folderMeta[g];
      base.set(g, (meta && meta.color) || pal[i % pal.length]);
    });
    const subIdx = new Map<string, number>();
    const dirs = Array.from(new Set(Array.from(this.all.values()).map((n) => (n.kind === 'folder' ? n.path : n.dir)))).sort();
    const perGroup = new Map<string, number>();
    for (const d of dirs) {
      const g = d.split('/')[0];
      if (!d.includes('/')) continue;
      const i = perGroup.get(g) || 0;
      perGroup.set(g, i + 1);
      subIdx.set(d, i + 1);
    }
    this.all.forEach((n) => {
      const c = base.get(n.group) || pal[0];
      const d = n.kind === 'folder' ? n.path : n.dir;
      const i = subIdx.get(d) || 0;
      if (!i) {
        n.color = c;
        return;
      }
      const step = Math.ceil(i / 2) * 0.13;
      n.color = i % 2 ? mix(c, light ? 0 : 255, Math.min(0.4, step)) : mix(c, light ? 255 : 0, Math.min(0.35, step));
    });
  }

  groupColor(g: string): string {
    for (const n of this.all.values()) if (n.group === g && n.kind === 'note' && !n.dir.includes('/')) return n.color;
    for (const n of this.all.values()) if (n.group === g) return n.color;
    return '#888';
  }

  private anchorFor(n: GNode): GNode | undefined {
    const near = this.outgoing.get(n.id) || this.incoming.get(n.id);
    if (near) {
      for (const id of near) {
        const o = this.all.get(id);
        if (o && !Number.isNaN(o.x)) return o;
      }
    }
    return this.all.get(FOLDER_PREFIX + n.dir) || this.all.get(FOLDER_PREFIX + n.path.split('/')[0]);
  }

  reap(now: number, ms: number): boolean {
    let changed = false;
    this.all.forEach((n, id) => {
      if (n.dying && now - n.dying > ms) {
        this.all.delete(id);
        changed = true;
      }
    });
    return changed;
  }

  visible(f: Filters): { nodes: GNode[]; links: GLink[] } {
    const tagOk = (n: GNode): boolean => {
      if (!f.tags.size) return true;
      const t = this.tagsByPath.get(n.path) || n.tags;
      return t.some((x) => f.tags.has(x));
    };
    const keep = new Set<GNode>();
    this.all.forEach((n) => {
      if (n.kind !== 'note' || f.hiddenGroups.has(n.group) || !tagOk(n)) return;
      if (!f.orphans && !n.degree && !n.dying) return;
      keep.add(n);
    });
    if (f.folders) {
      const needed = new Set<string>();
      keep.forEach((n) => {
        for (let d = n.dir; d; d = dirOf(d)) needed.add(d);
      });
      needed.forEach((d) => {
        const fnode = this.all.get(FOLDER_PREFIX + d);
        if (fnode) keep.add(fnode);
      });
    }
    const links: GLink[] = [];
    const mk = (s: GNode, t: GNode, kind: GLink['kind']): GLink => ({ s, t, kind, k: 0, len: 0, bias: 0.5 });
    if (f.folders) {
      keep.forEach((n) => {
        if (!n.dir) return;
        const p = this.all.get(FOLDER_PREFIX + n.dir);
        if (p && keep.has(p)) links.push(mk(p, n, 'tree'));
      });
    }
    for (const [a, b] of this.refs) {
      const s = this.all.get(a);
      const t = this.all.get(b);
      if (s && t && keep.has(s) && keep.has(t)) links.push(mk(s, t, 'ref'));
    }
    // Stable draw order: folders last (on top), hubs after leaves.
    const nodes = Array.from(keep).sort((x, y) =>
      x.kind !== y.kind ? (x.kind === 'folder' ? 1 : -1) : x.degree - y.degree,
    );
    return { nodes, links };
  }

  groups(): [string, number, string][] {
    const m = new Map<string, number>();
    this.all.forEach((n) => {
      if (n.kind === 'note' && !n.dying) m.set(n.group, (m.get(n.group) || 0) + 1);
    });
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([g, c]) => [g, c, this.groupColor(g)]);
  }
}
