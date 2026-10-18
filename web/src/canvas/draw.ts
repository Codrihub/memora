// Canvas-2D painting: wikilink connectors (and cards themselves at the lowest
// zoom level), plus the minimap. Pure functions over the board model.

import { CARD_H, CARD_W, frameBox, type Box, type Cam, type Card, type Frame } from './model';
import { route, strokeRounded, type Pt, type Rect } from './route';

export interface LinkPair {
  a: Card;
  b: Card;
}

export interface LinkPaint {
  cam: Cam;
  w: number;
  h: number;
  dpr: number;
  links: LinkPair[];
  showLinks: boolean;
  /** Paths whose links are emphasised (selection or hover); others dim. */
  focus: Set<string> | null;
  /** Lowest level of detail: cards are painted here instead of the DOM. */
  paintCards: boolean;
  frames: Frame[];
  frameOf: (c: Card) => Frame | undefined;
  color: (folder: string) => string;
  selected: Set<string>;
  light: boolean;
}

function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(148,163,184,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Routed wires, reused until a card or frame moves. */
const routes = new Map<string, { sig: string; ends: string; pts: Pt[] }>();
/** New routes worked out per frame; the rest follow on the next frames. */
const ROUTE_BUDGET = 60;

/** One string that changes whenever any card or frame moves. */
function layoutSig(frames: Frame[]): string {
  let h = 0;
  for (const f of frames) {
    h = (h * 31 + f.x * 7 + f.y * 13 + f.cards.length) | 0;
    for (const c of f.cards) h = (h * 31 + c.x * 3 + c.y * 5) | 0;
  }
  return frames.length + ':' + h;
}

function obstaclesFor(fa: Frame, fb: Frame, a: Card, b: Card, frames: Frame[]): Rect[] {
  const out: Rect[] = [];
  for (const f of fa === fb ? [fa] : [fa, fb]) {
    for (const c of f.cards) {
      if (c === a || c === b) continue;
      out.push({ x: f.x + c.x - 4, y: f.y + c.y - 4, w: CARD_W + 8, h: CARD_H + 8 });
    }
  }
  for (const f of frames) {
    if (f === fa || f === fb) continue;
    const r = frameBox(f);
    out.push({ x: r.x - 12, y: r.y - 12, w: r.w + 24, h: r.h + 24 });
  }
  return out;
}

/** Paints the board's wires; true when some routes are still to be worked out. */
export function paintLinks(ctx: CanvasRenderingContext2D, p: LinkPaint): boolean {
  const { cam, w, h, dpr } = p;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y);
  const vx0 = -cam.x / cam.z;
  const vy0 = -cam.y / cam.z;
  const vx1 = vx0 + w / cam.z;
  const vy1 = vy0 + h / cam.z;

  if (p.paintCards) {
    const r = 14;
    for (const f of p.frames) {
      const fc = p.color(f.name);
      const body = p.light ? '#ffffff' : '#151a25';
      const ink = p.light ? 'rgba(15,23,42,.16)' : 'rgba(230,233,239,.16)';
      for (const c of f.cards) {
        const x = f.x + c.x;
        const y = f.y + c.y;
        if (x > vx1 || y > vy1 || x + CARD_W < vx0 || y + CARD_H < vy0) continue;
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.roundRect(x, y, CARD_W, CARD_H, r);
        ctx.fill();
        ctx.fillStyle = hexA(fc, 0.9);
        ctx.fillRect(x, y + 12, 5, CARD_H - 24);
        // Greeked title and two text lines.
        ctx.fillStyle = p.light ? 'rgba(15,23,42,.5)' : 'rgba(230,233,239,.55)';
        ctx.fillRect(x + 20, y + 22, CARD_W * 0.62, 16);
        ctx.fillStyle = ink;
        ctx.fillRect(x + 20, y + 56, CARD_W - 40, 9);
        ctx.fillRect(x + 20, y + 74, CARD_W * 0.55, 9);
        if (p.selected.has(c.path)) {
          ctx.strokeStyle = p.light ? '#0d9488' : '#5eead4';
          ctx.lineWidth = 3 / cam.z;
          ctx.beginPath();
          ctx.roundRect(x, y, CARD_W, CARD_H, r);
          ctx.stroke();
        }
      }
    }
  }

  if (!p.showLinks || !p.links.length) return false;
  const sig = layoutSig(p.frames);
  let budget = ROUTE_BUDGET;
  let pending = false;
  const lw = Math.max(1.2 / cam.z, 1.2);
  for (const pass of [0, 1]) {
    for (const l of p.links) {
      const fa = p.frameOf(l.a);
      const fb = p.frameOf(l.b);
      if (!fa || !fb) continue;
      const hot = !!p.focus && (p.focus.has(l.a.path) || p.focus.has(l.b.path));
      if ((pass === 1) !== hot) continue;
      const ax = fa.x + l.a.x;
      const ay = fa.y + l.a.y;
      const bx = fb.x + l.b.x;
      const by = fb.y + l.b.y;
      const minX = Math.min(ax, bx);
      const minY = Math.min(ay, by);
      const maxX = Math.max(ax, bx) + CARD_W;
      const maxY = Math.max(ay, by) + CARD_H;
      if (minX > vx1 || minY > vy1 || maxX < vx0 || maxY < vy0) continue;
      const key = l.a.path + '\u0000' + l.b.path;
      const ends = ax + ',' + ay + ',' + bx + ',' + by;
      let r = routes.get(key);
      if (!r || r.sig !== sig) {
        const A: Rect = { x: ax, y: ay, w: CARD_W, h: CARD_H };
        const B: Rect = { x: bx, y: by, w: CARD_W, h: CARD_H };
        if (budget > 0) {
          budget--;
          r = { sig, ends, pts: route(A, B, obstaclesFor(fa, fb, l.a, l.b, p.frames)) };
          routes.set(key, r);
        } else {
          pending = true;
          // Over budget: keep the old path while its cards stay put, else a
          // plain elbow until the full route is ready.
          if (!r || r.ends !== ends) r = { sig: '', ends, pts: route(A, B, []) };
          routes.set(key, r);
        }
      }
      const pts = r.pts;
      const [sx, sy] = pts[0];
      const [ex, ey] = pts[pts.length - 1];
      const [qx, qy] = pts[pts.length - 2];
      const el = Math.hypot(ex - qx, ey - qy) || 1;
      const edx = (qx - ex) / el;
      const edy = (qy - ey) / el;
      const col = p.color(l.a.folder);
      const base = p.light ? 0.42 : 0.34;
      const alpha = hot ? 0.95 : p.focus ? 0.06 : cam.z < 0.3 ? base * 0.45 : cam.z < 0.6 ? base * 0.75 : base;
      ctx.strokeStyle = hexA(col, alpha);
      ctx.lineWidth = hot ? lw * 1.9 : lw;
      ctx.lineJoin = 'round';
      strokeRounded(ctx, pts, 14);
      // Arrow head at the target, pointing into the card.
      const ah = (hot ? 9 : 6) * Math.max(1, 1 / cam.z) * 0.9;
      const ang = Math.atan2(-edy, -edx);
      ctx.fillStyle = hexA(col, hot ? 1 : alpha + 0.1);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.45) * ah, ey - Math.sin(ang - 0.45) * ah);
      ctx.lineTo(ex - Math.cos(ang + 0.45) * ah, ey - Math.sin(ang + 0.45) * ah);
      ctx.closePath();
      ctx.fill();
      // Source port dot.
      ctx.beginPath();
      ctx.arc(sx, sy, (hot ? 3.2 : 2.2) * Math.max(1, 1 / cam.z) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (routes.size > p.links.length * 3 + 500) routes.clear();
  return pending;
}

export interface MiniPaint {
  w: number;
  h: number;
  dpr: number;
  frames: Frame[];
  color: (folder: string) => string;
  view: Box;
  light: boolean;
}

/** Returns the world-to-minimap mapping so clicks can be converted back. */
export function paintMinimap(ctx: CanvasRenderingContext2D, p: MiniPaint): { s: number; ox: number; oy: number } {
  ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
  ctx.clearRect(0, 0, p.w, p.h);
  const boxes = p.frames.map((f) => frameBox(f));
  let x0 = p.view.x;
  let y0 = p.view.y;
  let x1 = p.view.x + p.view.w;
  let y1 = p.view.y + p.view.h;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  const pad = 8;
  const s = Math.min((p.w - pad * 2) / Math.max(1, x1 - x0), (p.h - pad * 2) / Math.max(1, y1 - y0));
  const ox = pad + ((p.w - pad * 2) - (x1 - x0) * s) / 2 - x0 * s;
  const oy = pad + ((p.h - pad * 2) - (y1 - y0) * s) / 2 - y0 * s;
  p.frames.forEach((f, i) => {
    const b = boxes[i];
    const col = p.color(f.name);
    ctx.fillStyle = hexA(col, p.light ? 0.16 : 0.14);
    ctx.strokeStyle = hexA(col, 0.6);
    ctx.lineWidth = 1;
    ctx.fillRect(ox + b.x * s, oy + b.y * s, b.w * s, b.h * s);
    ctx.strokeRect(ox + b.x * s + 0.5, oy + b.y * s + 0.5, b.w * s - 1, b.h * s - 1);
    ctx.fillStyle = hexA(col, 0.75);
    for (const c of f.cards) {
      ctx.fillRect(ox + (f.x + c.x) * s, oy + (f.y + c.y) * s, Math.max(1, CARD_W * s), Math.max(1, CARD_H * s));
    }
  });
  ctx.strokeStyle = p.light ? 'rgba(15,23,42,.75)' : 'rgba(230,233,239,.85)';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = p.light ? 'rgba(15,23,42,.05)' : 'rgba(230,233,239,.06)';
  ctx.fillRect(ox + p.view.x * s, oy + p.view.y * s, p.view.w * s, p.view.h * s);
  ctx.strokeRect(ox + p.view.x * s, oy + p.view.y * s, p.view.w * s, p.view.h * s);
  return { s, ox, oy };
}
