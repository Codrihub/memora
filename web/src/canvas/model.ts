// Canvas board model: folder frames that hold note cards, positions in world
// units, and the pure layout helpers (tidy a frame, pack frames, find a free
// slot). Nothing here touches the DOM.

export const CARD_W = 240;
export const CARD_H = 136;
const GAP = 20;
const PAD = 22;
export const HEAD = 24;
const FRAME_GAP = 140;

export interface Cam {
  x: number;
  y: number;
  z: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the board persists through the layout API (`canvas`). */
export interface SavedLayout {
  v: 1;
  view?: Cam;
  frames: Record<string, Box>;
  /** Card position relative to its frame's top left corner. */
  cards: Record<string, { x: number; y: number }>;
  links?: boolean;
  minimap?: boolean;
}

export interface Touch {
  actor: string;
  label: string;
  at: number;
  live: boolean;
}

export interface Card {
  path: string;
  name: string;
  folder: string;
  mtime: number;
  /** Position relative to the frame. */
  x: number;
  y: number;
  el: HTMLElement | null;
  touch: Touch | null;
  /** True while the card is being dragged: its frame does not grow around it. */
  drag: boolean;
}

export interface Frame {
  name: string;
  /** World position and the user's size; the drawn size also fits the cards. */
  x: number;
  y: number;
  w: number;
  h: number;
  cards: Card[];
  el: HTMLElement | null;
}

export function emptyLayout(): SavedLayout {
  return { v: 1, frames: {}, cards: {} };
}

/** Smallest box that holds every card, measured from the frame origin. */
export function contentSize(f: Frame): { w: number; h: number } {
  let w = PAD * 2 + CARD_W;
  let h = HEAD + PAD + CARD_H;
  for (const c of f.cards) {
    if (c.drag) continue;
    w = Math.max(w, c.x + CARD_W + PAD);
    h = Math.max(h, c.y + CARD_H + PAD);
  }
  return { w, h };
}

/** The frame as drawn, in world units. */
export function frameBox(f: Frame): Box {
  const s = contentSize(f);
  return { x: f.x, y: f.y, w: Math.max(f.w, s.w), h: Math.max(f.h, s.h) };
}

export function cardBox(f: Frame, c: Card): Box {
  return { x: f.x + c.x, y: f.y + c.y, w: CARD_W, h: CARD_H };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function contains(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** Shift cards so none sits left of or above the padding; the frame moves to compensate. */
export function normalizeFrame(f: Frame): void {
  if (!f.cards.length) return;
  let minX = Infinity;
  let minY = Infinity;
  for (const c of f.cards) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
  }
  const dx = minX < PAD ? minX - PAD : 0;
  const dy = minY < HEAD ? minY - HEAD : 0;
  if (!dx && !dy) return;
  f.x += dx;
  f.y += dy;
  for (const c of f.cards) {
    c.x -= dx;
    c.y -= dy;
  }
}

function gridCols(n: number): number {
  return Math.max(1, Math.min(8, Math.round(Math.sqrt(n * 1.5))));
}

/** Lay the frame's cards out on a grid, newest first, and fit the frame to them. */
export function tidyFrame(f: Frame): void {
  const cards = f.cards.slice().sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
  const cols = gridCols(cards.length);
  cards.forEach((c, i) => {
    c.x = PAD + (i % cols) * (CARD_W + GAP);
    c.y = HEAD + Math.floor(i / cols) * (CARD_H + GAP);
  });
  const rows = Math.max(1, Math.ceil(cards.length / cols));
  f.w = PAD * 2 + cols * CARD_W + (cols - 1) * GAP;
  f.h = HEAD + PAD + rows * CARD_H + (rows - 1) * GAP;
}

/** Shelf-pack frames into rows of roughly square overall shape. */
export function packFrames(frames: Frame[], originX = 0, originY = 0): void {
  if (!frames.length) return;
  const boxes = frames.map((f) => ({ f, b: frameBox(f) }));
  const area = boxes.reduce((s, o) => s + (o.b.w + FRAME_GAP) * (o.b.h + FRAME_GAP), 0);
  const rowW = Math.max(Math.sqrt(area) * 1.5, Math.max(...boxes.map((o) => o.b.w)));
  // Root first, then larger frames first so rows are even.
  boxes.sort((a, b) =>
    a.f.name === 'Root' ? -1 : b.f.name === 'Root' ? 1 : b.b.h - a.b.h || a.f.name.localeCompare(b.f.name),
  );
  let x = originX;
  let y = originY;
  let rowH = 0;
  for (const o of boxes) {
    if (x > originX && x + o.b.w > originX + rowW) {
      x = originX;
      y += rowH + FRAME_GAP;
      rowH = 0;
    }
    o.f.x = x;
    o.f.y = y;
    x += o.b.w + FRAME_GAP;
    rowH = Math.max(rowH, o.b.h);
  }
}

/** First grid slot in the frame that no card covers. */
export function freeSlot(f: Frame, skip?: Set<Card>): { x: number; y: number } {
  const cols = gridCols(f.cards.length + 1);
  const taken = f.cards.filter((c) => !skip || !skip.has(c));
  for (let i = 0; i < 2000; i++) {
    const x = PAD + (i % cols) * (CARD_W + GAP);
    const y = HEAD + Math.floor(i / cols) * (CARD_H + GAP);
    const b = { x: x - 4, y: y - 4, w: CARD_W + 8, h: CARD_H + 8 };
    if (!taken.some((c) => overlaps(b, { x: c.x, y: c.y, w: CARD_W, h: CARD_H }))) return { x, y };
  }
  return { x: PAD, y: HEAD + contentSize(f).h };
}

/** Free world spot for a new frame: right of everything on the first row. */
export function freeFramePos(frames: Frame[]): { x: number; y: number } {
  if (!frames.length) return { x: 0, y: 0 };
  let maxX = -Infinity;
  let minY = Infinity;
  for (const f of frames) {
    const b = frameBox(f);
    maxX = Math.max(maxX, b.x + b.w);
    minY = Math.min(minY, b.y);
  }
  return { x: maxX + FRAME_GAP, y: minY };
}

export function boundsOf(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** File name the server would give a note moved to `folder`. */
export function movedPath(path: string, folder: string): string {
  const base = path.split('/').pop() || path;
  return !folder || folder === 'Root' ? base : folder + '/' + base;
}

export function renamedPath(path: string, name: string): string {
  const parts = path.split('/');
  parts[parts.length - 1] = name + '.md';
  return parts.join('/');
}

/** Folder names the server accepts (mirrors create_folder_impl). */
export function cleanFolderName(name: string): string {
  return name
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/ /g, '_');
}

export function initials(name: string): string {
  const parts = String(name || '?')
    .replace(/[_\-.@]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Push frames that overlap `anchor` (after it grew or moved) down or right,
 * cascading, so frames never sit on top of each other.
 */
export function separateFrames(frames: Frame[], anchor: Frame): void {
  const gap = 60;
  const queue = [anchor];
  let guard = 0;
  while (queue.length && guard++ < 200) {
    const a = queue.shift()!;
    const ab = frameBox(a);
    const grown = { x: ab.x - gap, y: ab.y - gap, w: ab.w + gap * 2, h: ab.h + gap * 2 };
    for (const f of frames) {
      if (f === a) continue;
      const fb = frameBox(f);
      if (!overlaps(grown, fb)) continue;
      // Move along the axis that needs the smaller push.
      const down = ab.y + ab.h + gap - fb.y;
      const right = ab.x + ab.w + gap - fb.x;
      if (fb.y >= ab.y && (down <= right || fb.x < ab.x)) f.y += down;
      else if (fb.x >= ab.x) f.x += right;
      else f.y += down;
      queue.push(f);
    }
  }
}
