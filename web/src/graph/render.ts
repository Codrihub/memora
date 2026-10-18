// Canvas2D renderer: dot grid, soft folder hulls, curved links (batched per
// colour and fade level), nodes, live agent pulses with initials badges and
// collision-free labels. Drawn in screen space from world coordinates so text
// and strokes stay crisp at any zoom.

import { agentInitials } from '../control/agents';
import type { Camera } from './camera';
import type { GLink, GNode, LayoutMode, Pulse } from './model';

export interface Theme {
  light: boolean;
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  panel: string;
}

export interface Scene {
  nodes: GNode[];
  links: GLink[];
  hover: GNode | null;
  selected: GNode | null;
  /** Nodes kept bright (neighbourhood or search hits); null = everything. */
  focus: Set<GNode> | null;
  pulses: Map<string, Pulse[]>;
  mode: LayoutMode;
  rings: number[];
  labelDensity: number;
  noteLabels: boolean;
  folderLabels: boolean;
  hulls: boolean;
  now: number;
  dragging: GNode | null;
  /** Screen pixels at the top covered by the toolbar. */
  reserveTop: number;
}

const BORN_MS = 650;
export const DYING_MS = 520;
const TAU = Math.PI * 2;

const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function nodeScale(n: GNode, now: number): number {
  if (n.dying) return Math.max(0, 1 - (now - n.dying) / DYING_MS);
  if (n.born) {
    const t = (now - n.born) / BORN_MS;
    if (t >= 1) {
      n.born = 0;
      return 1;
    }
    return Math.max(0, easeOutBack(Math.max(0, t)));
  }
  return 1;
}

function hexA(hex: string, a: number): string {
  let h = hex.trim();
  if (h.startsWith('rgb')) return h;
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(v)) return `rgba(125,211,252,${a})`;
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function hull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [];
  for (const p of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  const up: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}

export class Renderer {
  private hullCv = document.createElement('canvas');
  private widths = new Map<string, number>();
  private occ = new Uint8Array(0);
  private hullCache: { group: string; color: string; pts: [number, number][]; top: [number, number] }[] = [];
  hullsDirty = true;

  constructor(private ctx: CanvasRenderingContext2D) {}

  private measure(text: string, font: string): number {
    const key = font + '|' + text;
    let w = this.widths.get(key);
    if (w == null) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      if (this.widths.size > 20000) this.widths.clear();
      this.widths.set(key, w);
    }
    return w;
  }

  draw(cam: Camera, sc: Scene, th: Theme, dpr: number): void {
    const ctx = this.ctx;
    const W = cam.w;
    const H = cam.h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);
    this.grid(cam, th);
    const k = cam.k;
    const vb = cam.view(80);

    // Ease each node's highlight toward its target.
    for (const n of sc.nodes) {
      const target = !sc.focus || sc.focus.has(n) ? 1 : th.light ? 0.13 : 0.1;
      n.fade += (target - n.fade) * 0.18;
      if (Math.abs(target - n.fade) < 0.004) n.fade = target;
    }

    if (sc.mode === 'radial') {
      ctx.save();
      ctx.strokeStyle = hexA(th.muted, th.light ? 0.22 : 0.16);
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      const c = cam.toScreen(0, 0);
      for (const r of sc.rings) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, r * k, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (sc.hulls && sc.mode !== 'radial') this.drawHulls(cam, sc, th, dpr);

    this.drawLinks(cam, sc, th, vb);
    this.drawNodes(cam, sc, th, vb);
    this.drawPulses(cam, sc, th);
    this.drawLabels(cam, sc, th);
    ctx.globalAlpha = 1;
  }

  private grid(cam: Camera, th: Theme): void {
    const ctx = this.ctx;
    // Figma-like dot grid: a dot every ~20-40 screen px, moving and scaling
    // with the map, clear enough to read direction and zoom at a glance.
    let step = 24;
    while (step * cam.k < 18) step *= 2;
    while (step * cam.k > 40) step /= 2;
    const s = step * cam.k;
    const o = cam.toScreen(0, 0);
    const x0 = ((o.x % s) + s) % s;
    const y0 = ((o.y % s) + s) % s;
    const r = s > 28 ? 1.25 : 1.05;
    ctx.fillStyle = th.light ? 'rgba(15,23,42,.26)' : 'rgba(148,163,184,.28)';
    ctx.beginPath();
    for (let x = x0; x < cam.w; x += s)
      for (let y = y0; y < cam.h; y += s) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    ctx.fill();
  }

  private drawHulls(cam: Camera, sc: Scene, th: Theme, dpr: number): void {
    if (this.hullsDirty) {
      const by = new Map<string, { color: string; pts: [number, number][] }>();
      for (const n of sc.nodes) {
        if (n.dying) continue;
        let g = by.get(n.group);
        if (!g) by.set(n.group, (g = { color: n.color, pts: [] }));
        if (n.kind === 'folder' && !n.dir) g.color = n.color;
        g.pts.push([n.x, n.y]);
      }
      this.hullCache = [];
      by.forEach((g, group) => {
        if (g.pts.length < 2) return;
        const h = hull(g.pts);
        let top: [number, number] = h[0];
        let cx = 0;
        for (const p of h) {
          cx += p[0];
          if (p[1] < top[1]) top = p;
        }
        top = [cx / h.length, top[1]];
        this.hullCache.push({ group, color: g.color, pts: h, top });
      });
      this.hullsDirty = false;
    }
    const hc = this.hullCv;
    const W = Math.floor(cam.w * dpr);
    const H = Math.floor(cam.h * dpr);
    if (hc.width !== W || hc.height !== H) {
      hc.width = W;
      hc.height = H;
    }
    const h = hc.getContext('2d');
    if (!h) return;
    h.setTransform(1, 0, 0, 1, 0, 0);
    h.clearRect(0, 0, W, H);
    h.setTransform(dpr, 0, 0, dpr, 0, 0);
    h.lineJoin = 'round';
    h.lineCap = 'round';
    const pad = Math.max(16, 26 * cam.k);
    const focusGroups = sc.focus ? new Set(Array.from(sc.focus).map((n) => n.group)) : null;
    for (const g of this.hullCache) {
      h.globalAlpha = focusGroups && !focusGroups.has(g.group) ? 0.35 : 1;
      h.fillStyle = g.color;
      h.strokeStyle = g.color;
      h.lineWidth = pad * 2;
      h.beginPath();
      g.pts.forEach((p, i) => {
        const s = cam.toScreen(p[0], p[1]);
        if (i) h.lineTo(s.x, s.y);
        else h.moveTo(s.x, s.y);
      });
      h.closePath();
      h.fill();
      h.stroke();
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = th.light ? 0.085 : 0.07;
    ctx.drawImage(hc, 0, 0);
    ctx.restore();
  }

  private drawLinks(cam: Camera, sc: Scene, th: Theme, vb: { x0: number; y0: number; x1: number; y1: number }): void {
    const ctx = this.ctx;
    const k = cam.k;
    const ox = cam.w / 2 - cam.x * k;
    const oy = cam.h / 2 - cam.y * k;
    const curve = sc.links.length < 6000 && k > 0.12;
    const hot = sc.hover || sc.selected;
    // Buckets: (colour|fade level) -> path.
    const buckets = new Map<string, Path2D>();
    const hotPath = new Path2D();
    let hotCount = 0;
    const flows: GLink[] = [];
    for (const l of sc.links) {
      const s = l.s;
      const t = l.t;
      if ((s.x < vb.x0 && t.x < vb.x0) || (s.x > vb.x1 && t.x > vb.x1) || (s.y < vb.y0 && t.y < vb.y0) || (s.y > vb.y1 && t.y > vb.y1))
        continue;
      const sx = s.x * k + ox;
      const sy = s.y * k + oy;
      const tx = t.x * k + ox;
      const ty = t.y * k + oy;
      const isHot = !!hot && (s === hot || t === hot);
      let p: Path2D;
      if (isHot) {
        p = hotPath;
        hotCount++;
        if (flows.length < 80) flows.push(l);
      } else {
        const f = Math.min(s.fade, t.fade) * Math.min(nodeScale(s, sc.now), nodeScale(t, sc.now));
        const lvl = f > 0.75 ? 2 : f > 0.3 ? 1 : 0;
        const key = (l.kind === 'tree' ? s.color : '') + '|' + lvl;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = new Path2D()));
        p = b;
      }
      p.moveTo(sx, sy);
      if (curve) {
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;
        const bend = l.kind === 'tree' ? 0.06 : 0.12;
        p.quadraticCurveTo(mx - (ty - sy) * bend, my + (tx - sx) * bend, tx, ty);
      } else p.lineTo(tx, ty);
    }
    const base = th.light ? 0.3 : 0.24;
    const lw = Math.max(0.6, Math.min(1.6, 0.5 + k * 0.7));
    ctx.lineCap = 'round';
    buckets.forEach((path, key) => {
      const [color, lvl] = key.split('|');
      const lv = Number(lvl);
      const fa = lv === 2 ? 1 : lv === 1 ? 0.45 : 0.12;
      if (color) {
        ctx.strokeStyle = hexA(color, (th.light ? 0.5 : 0.42) * fa);
        ctx.lineWidth = lw * 1.25;
      } else {
        ctx.strokeStyle = hexA(th.muted, base * fa * 1.4);
        ctx.lineWidth = lw;
      }
      ctx.stroke(path);
    });
    if (hotCount) {
      ctx.strokeStyle = hexA(th.accent, 0.95);
      ctx.lineWidth = Math.max(1.4, lw * 1.7);
      ctx.stroke(hotPath);
      // Direction: small beads flowing from source to target.
      const t = (sc.now % 1600) / 1600;
      ctx.fillStyle = th.accent;
      for (const l of flows) {
        const sx = l.s.x * k + ox;
        const sy = l.s.y * k + oy;
        const tx = l.t.x * k + ox;
        const ty = l.t.y * k + oy;
        const mx = (sx + tx) / 2 - (ty - sy) * (l.kind === 'tree' ? 0.06 : 0.12);
        const my = (sy + ty) / 2 + (tx - sx) * (l.kind === 'tree' ? 0.06 : 0.12);
        const u = 1 - t;
        const bx = curve ? u * u * sx + 2 * u * t * mx + t * t * tx : sx + (tx - sx) * t;
        const by = curve ? u * u * sy + 2 * u * t * my + t * t * ty : sy + (ty - sy) * t;
        ctx.beginPath();
        ctx.arc(bx, by, 2.2, 0, TAU);
        ctx.fill();
      }
    }
  }

  private drawNodes(cam: Camera, sc: Scene, th: Theme, vb: { x0: number; y0: number; x1: number; y1: number }): void {
    const ctx = this.ctx;
    const k = cam.k;
    const ox = cam.w / 2 - cam.x * k;
    const oy = cam.h / 2 - cam.y * k;
    for (const n of sc.nodes) {
      if (n.x + n.r < vb.x0 || n.x - n.r > vb.x1 || n.y + n.r < vb.y0 || n.y - n.r > vb.y1) continue;
      const sc1 = nodeScale(n, sc.now);
      if (sc1 <= 0.01) continue;
      const x = n.x * k + ox;
      const y = n.y * k + oy;
      const r = Math.max(1.3, n.r * k) * sc1;
      const a = n.fade * (n.dying ? sc1 : 1);
      ctx.globalAlpha = a;
      if (n.kind === 'folder') {
        // Folder hubs: tinted disc with a thick ring and a centre dot.
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = hexA(n.color, th.light ? 0.22 : 0.2);
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, r * 0.26);
        ctx.strokeStyle = n.color;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, r * 0.3), 0, TAU);
        ctx.fillStyle = n.color;
        ctx.fill();
      } else {
        if (n.degree >= 8 && r > 3) {
          ctx.beginPath();
          ctx.arc(x, y, r * 1.85, 0, TAU);
          ctx.fillStyle = hexA(n.color, 0.13);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = n.color;
        ctx.fill();
        if (r > 4) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = th.light ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.35)';
          ctx.stroke();
        }
      }
      if (n === sc.selected || n === sc.hover || n === sc.dragging) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5, 0, TAU);
        ctx.lineWidth = n === sc.selected ? 2.2 : 1.5;
        ctx.strokeStyle = n === sc.selected ? th.accent : th.ink;
        ctx.stroke();
      }
      if (n.pinned) {
        ctx.globalAlpha = a;
        const px = x + r * 0.75;
        const py = y - r * 0.75;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2.4, r * 0.32), 0, TAU);
        ctx.fillStyle = th.ink;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = th.bg;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPulses(cam: Camera, sc: Scene, th: Theme): void {
    if (!sc.pulses.size) return;
    const ctx = this.ctx;
    const byId = new Map<string, GNode>();
    for (const n of sc.nodes) if (sc.pulses.has(n.id)) byId.set(n.id, n);
    sc.pulses.forEach((list, id) => {
      const n = byId.get(id);
      if (!n) return;
      const s = cam.toScreen(n.x, n.y);
      const r = Math.max(2, n.r * cam.k);
      list.forEach((p, idx) => {
        const life = p.end ? Math.min(1, Math.max(0, 1 - (sc.now - p.end) / 2600)) : 1;
        if (life <= 0) return;
        const phase = (Math.max(0, sc.now - p.start) % 1300) / 1300;
        ctx.globalAlpha = (1 - phase) * 0.85 * life;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 3 + phase * 26, 0, TAU);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = p.color;
        ctx.stroke();
        ctx.globalAlpha = 0.5 * life;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 2, 0, TAU);
        ctx.fillStyle = p.color;
        ctx.fill();
        // Initials badge.
        const ini = agentInitials(p.actor);
        ctx.font = '700 9.5px system-ui, -apple-system, Segoe UI, sans-serif';
        const tw = ctx.measureText(ini).width;
        const bw = tw + 9;
        const bx = s.x + r * 0.7 + 2 + idx * (bw + 2);
        const by = s.y - r * 0.7 - 16;
        ctx.globalAlpha = life;
        ctx.beginPath();
        roundRect(ctx, bx, by, bw, 14, 7);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = th.bg;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(ini, bx + 4.5, by + 10.3);
      });
    });
    ctx.globalAlpha = 1;
  }

  private drawLabels(cam: Camera, sc: Scene, th: Theme): void {
    const ctx = this.ctx;
    const W = cam.w;
    const H = cam.h;
    const CELL = 8;
    const cols = Math.ceil(W / CELL) + 1;
    const rows = Math.ceil(H / CELL) + 1;
    if (this.occ.length < cols * rows) this.occ = new Uint8Array(cols * rows * 2);
    const occ = this.occ;
    occ.fill(0, 0, cols * rows);
    const k = cam.k;
    // Screen-radius threshold falls as the density control rises.
    const thr = 12 - sc.labelDensity * 10.5;
    // Keep the toolbar strip free.
    const topRows = Math.ceil(sc.reserveTop / CELL);
    occ.fill(1, 0, Math.min(rows, topRows) * cols);
    const cand: GNode[] = [];
    const prio: GNode[] = [];
    for (const n of [sc.selected, sc.hover, sc.dragging]) if (n && !prio.includes(n)) prio.push(n);
    if (sc.focus && sc.focus.size < 60) sc.focus.forEach((n) => !prio.includes(n) && prio.push(n));
    for (let i = sc.nodes.length - 1; i >= 0; i--) {
      const n = sc.nodes[i];
      if (n.fade < 0.5 || n.dying || prio.includes(n)) continue;
      if (n.kind === 'folder' ? !sc.folderLabels : !sc.noteLabels) continue;
      const rs = n.r * k;
      if (n.kind === 'folder' ? rs * 1.6 >= thr * 0.6 : rs >= thr) cand.push(n);
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    let placed = 0;
    const tryPlace = (n: GNode, force: boolean) => {
      const s = cam.toScreen(n.x, n.y);
      const r = Math.max(1.3, n.r * k) * nodeScale(n, sc.now);
      const strong = n.kind === 'folder' || force;
      const size = n.kind === 'folder' ? 12.5 : Math.min(13, 10.5 + r * 0.12);
      const font = `${strong ? 600 : 450} ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
      const text = n.label.length > 34 ? n.label.slice(0, 32) + '…' : n.label;
      const tw = this.measure(text, font);
      let x: number;
      let y: number;
      if (n.kind === 'folder') {
        x = s.x - tw / 2;
        y = s.y + r + 10;
      } else {
        x = s.x + r + 4;
        y = s.y;
      }
      if (x > W || x + tw < 0 || y < -10 || y > H + 10) return;
      const c0 = Math.max(0, Math.floor((x - 2) / CELL));
      const c1 = Math.min(cols - 1, Math.floor((x + tw + 2) / CELL));
      const r0 = Math.max(0, Math.floor((y - size / 2 - 1) / CELL));
      const r1 = Math.min(rows - 1, Math.floor((y + size / 2 + 1) / CELL));
      if (!force) {
        for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if (occ[rr * cols + cc]) return;
      }
      for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) occ[rr * cols + cc] = 1;
      ctx.font = font;
      ctx.globalAlpha = Math.min(1, n.fade * 1.1);
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = th.bg;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = n.kind === 'folder' ? n.color : force ? th.ink : hexA(th.ink, 0.86);
      ctx.fillText(text, x, y);
      placed++;
    };
    // The node under the pointer always gets its label; its neighbours
    // come next but still avoid overlapping each other.
    prio.forEach((n, i) => tryPlace(n, i < 1 || n === sc.selected));
    // Folder group titles above each hull.
    if (sc.folderLabels && sc.hulls && sc.mode !== 'radial') {
      const focusGroups = sc.focus ? new Set(Array.from(sc.focus).map((n) => n.group)) : null;
      const pad = Math.max(16, 26 * cam.k);
      const font = '650 11.5px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.font = font;
      for (const g of this.hullCache) {
        const text = g.group.toUpperCase();
        const tw = this.measure(text, font) * 1.08;
        const s = cam.toScreen(g.top[0], g.top[1]);
        const x = s.x - tw / 2;
        const y = s.y - pad - 2;
        if (x > W || x + tw < 0 || y < 0 || y > H) continue;
        const c0 = Math.max(0, Math.floor(x / CELL));
        const c1 = Math.min(cols - 1, Math.floor((x + tw) / CELL));
        const r0 = Math.max(0, Math.floor((y - 7) / CELL));
        const r1 = Math.min(rows - 1, Math.floor((y + 7) / CELL));
        let free = true;
        for (let rr = r0; rr <= r1 && free; rr++) for (let cc = c0; cc <= c1; cc++) if (occ[rr * cols + cc]) free = false;
        if (!free) continue;
        for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) occ[rr * cols + cc] = 1;
        ctx.globalAlpha = focusGroups && !focusGroups.has(g.group) ? 0.25 : 0.8;
        ctx.font = font;
        ctx.letterSpacing = '0.08em';
        ctx.fillStyle = g.color;
        ctx.fillText(text, x, y);
        ctx.letterSpacing = '0px';
      }
    }
    for (const n of cand) {
      if (placed > 420) break;
      tryPlace(n, false);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Minimap: every node as a dot plus the current viewport. */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  nodes: GNode[],
  cam: Camera,
  th: Theme,
): { x0: number; y0: number; s: number } {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const n of nodes) {
    if (n.x < x0) x0 = n.x;
    if (n.y < y0) y0 = n.y;
    if (n.x > x1) x1 = n.x;
    if (n.y > y1) y1 = n.y;
  }
  const v = cam.view();
  x0 = Math.min(x0, v.x0);
  y0 = Math.min(y0, v.y0);
  x1 = Math.max(x1, v.x1);
  y1 = Math.max(y1, v.y1);
  const pad = 6;
  const s = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0));
  const offx = pad + ((w - pad * 2) - (x1 - x0) * s) / 2 - x0 * s;
  const offy = pad + ((h - pad * 2) - (y1 - y0) * s) / 2 - y0 * s;
  let last = '';
  for (const n of nodes) {
    if (n.color !== last) {
      ctx.fillStyle = n.color;
      last = n.color;
    }
    ctx.globalAlpha = 0.35 + 0.65 * n.fade;
    const r = n.kind === 'folder' ? 2 : 1.1;
    ctx.fillRect(n.x * s + offx - r / 2, n.y * s + offy - r / 2, r, r);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 1.2;
  ctx.fillStyle = hexA(th.accent, 0.08);
  const rx = v.x0 * s + offx;
  const ry = v.y0 * s + offy;
  const rw = (v.x1 - v.x0) * s;
  const rh = (v.y1 - v.y0) * s;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeRect(rx, ry, rw, rh);
  return { x0: offx, y0: offy, s };
}
