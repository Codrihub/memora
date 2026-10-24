// d3-force style simulation; the Barnes–Hut quadtree uses typed arrays to avoid per-tick allocation.

import type { GLink, GNode, LayoutMode } from './model';

const THETA2 = 0.81;
const DIST_MIN2 = 1;

class QuadTree {
  cap = 0;
  count = 0;
  x0 = new Float64Array(0);
  y0 = new Float64Array(0);
  size = new Float64Array(0);
  child = new Int32Array(0);
  body = new Int32Array(0);
  mass = new Float64Array(0);
  cx = new Float64Array(0);
  cy = new Float64Array(0);
  next = new Int32Array(0);
  stack = new Int32Array(0);

  private grow(n: number): void {
    if (n <= this.cap) return;
    const cap = Math.max(64, n * 2);
    const f = (a: Float64Array) => {
      const b = new Float64Array(cap);
      b.set(a);
      return b;
    };
    this.x0 = f(this.x0);
    this.y0 = f(this.y0);
    this.size = f(this.size);
    this.mass = f(this.mass);
    this.cx = f(this.cx);
    this.cy = f(this.cy);
    const c = new Int32Array(cap * 4);
    c.set(this.child);
    this.child = c;
    const b = new Int32Array(cap);
    b.set(this.body);
    this.body = b;
    this.cap = cap;
  }

  private alloc(x0: number, y0: number, size: number): number {
    if (this.count >= this.cap) this.grow(this.count + 1);
    const q = this.count++;
    this.x0[q] = x0;
    this.y0[q] = y0;
    this.size[q] = size;
    this.child[q * 4] = -1;
    this.body[q] = -1;
    return q;
  }

  build(nodes: GNode[], charge: Float64Array): void {
    const n = nodes.length;
    if (this.next.length < n) this.next = new Int32Array(n * 2);
    if (this.stack.length < n * 4 + 64) this.stack = new Int32Array(n * 4 + 256);
    this.grow(n * 2 + 8);
    this.count = 0;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of nodes) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const size = Math.max(maxX - minX, maxY - minY, 1) * 1.0001 + 1;
    this.alloc(minX, minY, size);
    for (let i = 0; i < n; i++) {
      this.next[i] = -1;
      this.insert(i, nodes[i].x, nodes[i].y, nodes);
    }
    // Children are allocated after their parent, so a reverse sweep is a post-order accumulation.
    for (let q = this.count - 1; q >= 0; q--) {
      let m = 0,
        w = 0,
        sx = 0,
        sy = 0;
      if (this.child[q * 4] < 0) {
        for (let b = this.body[q]; b >= 0; b = this.next[b]) {
          const c = charge[b];
          const a = Math.abs(c);
          m += c;
          w += a;
          sx += nodes[b].x * a;
          sy += nodes[b].y * a;
        }
      } else {
        for (let k = 0; k < 4; k++) {
          const c = this.child[q * 4 + k];
          const a = Math.abs(this.mass[c]);
          if (!a) continue;
          m += this.mass[c];
          w += a;
          sx += this.cx[c] * a;
          sy += this.cy[c] * a;
        }
      }
      this.mass[q] = m;
      this.cx[q] = w ? sx / w : 0;
      this.cy[q] = w ? sy / w : 0;
    }
  }

  private insert(i: number, x: number, y: number, nodes: GNode[]): void {
    let q = 0;
    for (let depth = 0; ; depth++) {
      if (this.child[q * 4] >= 0) {
        q = this.child[q * 4 + this.quadrant(q, x, y)];
        continue;
      }
      const b = this.body[q];
      if (b < 0) {
        this.body[q] = i;
        return;
      }
      const o = nodes[b];
      if (depth > 40 || (Math.abs(o.x - x) < 1e-6 && Math.abs(o.y - y) < 1e-6)) {
        this.next[i] = this.next[b];
        this.next[b] = i;
        return;
      }
      const h = this.size[q] / 2;
      const x0 = this.x0[q];
      const y0 = this.y0[q];
      const c0 = this.alloc(x0, y0, h);
      const c1 = this.alloc(x0 + h, y0, h);
      const c2 = this.alloc(x0, y0 + h, h);
      const c3 = this.alloc(x0 + h, y0 + h, h);
      this.child[q * 4] = c0;
      this.child[q * 4 + 1] = c1;
      this.child[q * 4 + 2] = c2;
      this.child[q * 4 + 3] = c3;
      this.body[q] = -1;
      const dest = this.child[q * 4 + this.quadrant(q, o.x, o.y)];
      this.body[dest] = b;
    }
  }

  private quadrant(q: number, x: number, y: number): number {
    const h = this.size[q] / 2;
    return (x >= this.x0[q] + h ? 1 : 0) + (y >= this.y0[q] + h ? 2 : 0);
  }

  apply(i: number, p: GNode, nodes: GNode[], charge: Float64Array, alpha: number, distMax2: number): void {
    const st = this.stack;
    let sp = 0;
    st[sp++] = 0;
    let ax = 0,
      ay = 0;
    while (sp) {
      const q = st[--sp];
      const m = this.mass[q];
      if (!m) continue;
      let dx = this.cx[q] - p.x;
      let dy = this.cy[q] - p.y;
      let l = dx * dx + dy * dy;
      const w = this.size[q];
      const leaf = this.child[q * 4] < 0;
      if (!leaf && (w * w) / THETA2 < l) {
        if (l < distMax2) {
          if (l < DIST_MIN2) l = Math.sqrt(DIST_MIN2 * l);
          ax += (dx * m) / l;
          ay += (dy * m) / l;
        }
        continue;
      }
      if (!leaf) {
        st[sp++] = this.child[q * 4];
        st[sp++] = this.child[q * 4 + 1];
        st[sp++] = this.child[q * 4 + 2];
        st[sp++] = this.child[q * 4 + 3];
        continue;
      }
      for (let b = this.body[q]; b >= 0; b = this.next[b]) {
        if (b === i) continue;
        const o = nodes[b];
        dx = o.x - p.x;
        dy = o.y - p.y;
        l = dx * dx + dy * dy;
        if (l >= distMax2) continue;
        if (l === 0) {
          dx = (Math.random() - 0.5) * 1e-3;
          dy = (Math.random() - 0.5) * 1e-3;
          l = dx * dx + dy * dy;
        }
        if (l < DIST_MIN2) l = Math.sqrt(DIST_MIN2 * l);
        ax += (dx * charge[b]) / l;
        ay += (dy * charge[b]) / l;
      }
    }
    p.vx += ax * alpha;
    p.vy += ay * alpha;
  }
}

export class Simulation {
  nodes: GNode[] = [];
  links: GLink[] = [];
  alpha = 1;
  alphaTarget = 0;
  alphaMin = 0.002;
  alphaDecay = 1 - Math.pow(0.002, 1 / 320);
  velocityDecay = 0.42;
  mode: LayoutMode = 'force';
  /** Pull toward (tx, ty) in radial and cluster modes. */
  targetPull = 0;
  /** Global charge multiplier (the "spacing" control). */
  spacing = 1;
  private tree = new QuadTree();
  private charge = new Float64Array(0);
  private cellNext = new Int32Array(0);
  private cellHead = new Int32Array(0);

  setData(nodes: GNode[], links: GLink[]): void {
    this.nodes = nodes;
    this.links = links;
    nodes.forEach((n, i) => (n.i = i));
    const count = new Map<GNode, number>();
    for (const l of links) {
      count.set(l.s, (count.get(l.s) || 0) + 1);
      count.set(l.t, (count.get(l.t) || 0) + 1);
    }
    for (const l of links) {
      const cs = count.get(l.s) || 1;
      const ct = count.get(l.t) || 1;
      l.bias = cs / (cs + ct);
      const base = 1 / Math.min(cs, ct);
      l.k = l.kind === 'tree' ? base * 0.9 : base * 0.7;
      l.len = l.kind === 'tree' ? 26 + l.t.r * 2 + Math.sqrt(count.get(l.s) || 1) * 2.5 : 38 + (l.s.r + l.t.r) * 1.4;
    }
  }

  get running(): boolean {
    return this.alpha >= this.alphaMin || this.alphaTarget > 0;
  }

  reheat(a = 0.6): void {
    this.alpha = Math.max(this.alpha, a);
  }

  tick(): void {
    const nodes = this.nodes;
    const n = nodes.length;
    if (!n) return;
    this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
    const alpha = this.alpha;
    const clusterish = this.mode !== 'force';

    // Split by degree so hubs move less.
    const linkScale = clusterish ? (this.mode === 'radial' ? 0.015 : 0.06) : 1;
    for (const l of this.links) {
      const s = l.s;
      const t = l.t;
      if (s.dying || t.dying) continue;
      let x = t.x + t.vx - s.x - s.vx || (Math.random() - 0.5) * 1e-3;
      let y = t.y + t.vy - s.y - s.vy || (Math.random() - 0.5) * 1e-3;
      let d = Math.sqrt(x * x + y * y);
      d = ((d - l.len) / d) * alpha * l.k * linkScale;
      x *= d;
      y *= d;
      t.vx -= x * l.bias;
      t.vy -= y * l.bias;
      s.vx += x * (1 - l.bias);
      s.vy += y * (1 - l.bias);
    }

    if (this.charge.length < n) this.charge = new Float64Array(n * 2);
    const chargeScale = (clusterish ? (this.mode === 'radial' ? 0.04 : 0.12) : 1) * this.spacing;
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      this.charge[i] = p.dying ? 0 : -(p.kind === 'folder' ? 220 : 34 + p.r * 5) * chargeScale;
    }
    this.tree.build(nodes, this.charge);
    const distMax2 = clusterish ? 120 * 120 : 1600 * 1600;
    for (let i = 0; i < n; i++) this.tree.apply(i, nodes[i], nodes, this.charge, alpha, distMax2);

    const pull = this.targetPull;
    const center = clusterish ? 0 : 0.035;
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      if (pull) {
        // Not scaled by alpha: a damped spring that always settles on target.
        p.vx += (p.tx - p.x) * pull;
        p.vy += (p.ty - p.y) * pull;
      }
      if (center) {
        p.vx -= p.x * center * alpha;
        p.vy -= p.y * center * alpha;
      }
    }

    this.collide(clusterish ? 0.9 : 0.6);

    const decay = 1 - this.velocityDecay;
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      if (p.fx != null && p.fy != null) {
        p.x = p.fx;
        p.y = p.fy;
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      p.vx *= decay;
      p.vy *= decay;
      // Clamp so one bad step never launches a node across the canvas.
      const v2 = p.vx * p.vx + p.vy * p.vy;
      if (v2 > 3600) {
        const k = 60 / Math.sqrt(v2);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  /** Soft collision through a uniform grid, without allocation. */
  private collide(strength: number): void {
    const nodes = this.nodes;
    const n = nodes.length;
    let maxR = 1,
      minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of nodes) {
      if (p.r > maxR) maxR = p.r;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = 3;
    let cell = (maxR + pad) * 2;
    let cols = Math.ceil((maxX - minX) / cell) + 1;
    let rows = Math.ceil((maxY - minY) / cell) + 1;
    while (cols * rows > 65536) {
      cell *= 1.5;
      cols = Math.ceil((maxX - minX) / cell) + 1;
      rows = Math.ceil((maxY - minY) / cell) + 1;
    }
    const cells = cols * rows;
    if (this.cellHead.length < cells) this.cellHead = new Int32Array(cells * 2);
    if (this.cellNext.length < n) this.cellNext = new Int32Array(n * 2);
    const head = this.cellHead;
    const next = this.cellNext;
    head.fill(-1, 0, cells);
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      const c = Math.floor((p.x - minX) / cell) + Math.floor((p.y - minY) / cell) * cols;
      next[i] = head[c];
      head[c] = i;
    }
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      if (p.dying) continue;
      const cx = Math.floor((p.x - minX) / cell);
      const cy = Math.floor((p.y - minY) / cell);
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        if (gy < 0 || gy >= rows) continue;
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          if (gx < 0 || gx >= cols) continue;
          for (let j = head[gx + gy * cols]; j >= 0; j = next[j]) {
            if (j <= i) continue;
            const o = nodes[j];
            if (o.dying) continue;
            let dx = p.x + p.vx - o.x - o.vx;
            let dy = p.y + p.vy - o.y - o.vy;
            const rr = p.r + o.r + pad;
            let l = dx * dx + dy * dy;
            if (l >= rr * rr) continue;
            if (l === 0) {
              dx = (Math.random() - 0.5) * 1e-2;
              dy = (Math.random() - 0.5) * 1e-2;
              l = dx * dx + dy * dy;
            }
            const d = Math.sqrt(l);
            const k = ((rr - d) / d) * strength;
            const w = (o.r * o.r) / (p.r * p.r + o.r * o.r);
            p.vx += dx * k * w;
            p.vy += dy * k * w;
            o.vx -= dx * k * (1 - w);
            o.vy -= dy * k * (1 - w);
          }
        }
      }
    }
  }
}
