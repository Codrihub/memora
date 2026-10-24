// Orthogonal wire routing, brute force over every side pair and a few dog-leg positions; cheapest path wins.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Pt = [number, number];

type Side = 0 | 1 | 2 | 3; // right, left, bottom, top
const NX = [1, -1, 0, 0];
const NY = [0, 0, 1, -1];

function port(r: Rect, s: Side): Pt {
  if (s === 0) return [r.x + r.w, r.y + r.h / 2];
  if (s === 1) return [r.x, r.y + r.h / 2];
  if (s === 2) return [r.x + r.w / 2, r.y + r.h];
  return [r.x + r.w / 2, r.y];
}

function hits(a: Pt, b: Pt, r: Rect): boolean {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
}

function grow(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 };
}

/** Drop repeated and collinear points. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01) continue;
    if (out.length >= 2) {
      const o = out[out.length - 2];
      const sameX = Math.abs(o[0] - q![0]) < 0.01 && Math.abs(q![0] - p[0]) < 0.01;
      const sameY = Math.abs(o[1] - q![1]) < 0.01 && Math.abs(q![1] - p[1]) < 0.01;
      if (sameX || sameY) out.pop();
    }
    out.push(p);
  }
  return out;
}

function cost(pts: Pt[], obstacles: Rect[], a: Rect, b: Rect): number {
  let len = 0;
  let crossed = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    len += Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
    // The stubs touch their own cards by design; the middle legs must not.
    const mid = i > 1 && i < pts.length - 1;
    if (mid && (hits(p, q, a) || hits(p, q, b))) crossed += 2;
    for (const o of obstacles) if (hits(p, q, o)) crossed++;
  }
  return len + crossed * 2400 + (pts.length - 2) * 40;
}

/** `obstacles` already include some clearance. */
export function route(a: Rect, b: Rect, obstacles: Rect[], stub = 9, clear = 9): Pt[] {
  let best: Pt[] | null = null;
  let bestCost = Infinity;
  const ga = grow(a, 0.5);
  const gb = grow(b, 0.5);
  for (let sa = 0 as Side; sa < 4; sa++) {
    for (let sb = 0 as Side; sb < 4; sb++) {
      const s = port(a, sa as Side);
      const e = port(b, sb as Side);
      const s1: Pt = [s[0] + NX[sa] * stub, s[1] + NY[sa] * stub];
      const e1: Pt = [e[0] + NX[sb] * stub, e[1] + NY[sb] * stub];
      // A port that faces away from the other card makes a needless loop.
      const away = (NX[sa] * (e[0] - s[0]) + NY[sa] * (e[1] - s[1]) < -stub ? 1 : 0) + (NX[sb] * (s[0] - e[0]) + NY[sb] * (s[1] - e[1]) < -stub ? 1 : 0);
      const xs = [(s1[0] + e1[0]) / 2, s1[0], e1[0]];
      const ys = [(s1[1] + e1[1]) / 2, s1[1], e1[1]];
      const lo = Math.min(s1[1], e1[1]);
      const hi = Math.max(s1[1], e1[1]);
      const left = Math.min(s1[0], e1[0]);
      const right = Math.max(s1[0], e1[0]);
      for (const o of obstacles) {
        if (o.y < hi && o.y + o.h > lo) xs.push(o.x - clear, o.x + o.w + clear);
        if (o.x < right && o.x + o.w > left) ys.push(o.y - clear, o.y + o.h + clear);
      }
      const near = (arr: number[], c: number): number[] =>
        Array.from(new Set(arr.map((v) => Math.round(v))))
          .sort((p, q) => Math.abs(p - c) - Math.abs(q - c))
          .slice(0, 9);
      for (const mx of near(xs, (s1[0] + e1[0]) / 2)) {
        const pts = simplify([s, s1, [mx, s1[1]], [mx, e1[1]], e1, e]);
        const c = cost(pts, obstacles, ga, gb) + away * 300;
        if (c < bestCost) {
          bestCost = c;
          best = pts;
        }
      }
      for (const my of near(ys, (s1[1] + e1[1]) / 2)) {
        const pts = simplify([s, s1, [s1[0], my], [e1[0], my], e1, e]);
        const c = cost(pts, obstacles, ga, gb) + away * 300;
        if (c < bestCost) {
          bestCost = c;
          best = pts;
        }
      }
    }
  }
  return best || [port(a, 0), port(b, 1)];
}

export function strokeRounded(ctx: CanvasRenderingContext2D, pts: Pt[], radius: number): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const n = pts[i + 1];
    const r = Math.min(radius, Math.hypot(q[0] - p[0], q[1] - p[1]) / 2, Math.hypot(n[0] - q[0], n[1] - q[1]) / 2);
    ctx.arcTo(q[0], q[1], n[0], n[1], r);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}
