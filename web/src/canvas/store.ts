// The localStorage copy is used whenever the layout endpoint is missing or unreachable.

import { api, apiGet } from '../api';
import { emptyLayout, type SavedLayout } from './model';

const NAME = 'canvas';
const LS_KEY = 'memora.layout.' + NAME;

let serverOk: boolean | null = null;
let timer = 0;
let pending: SavedLayout | null = null;

function readLocal(): SavedLayout | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    return valid(d) ? clean(d) : null;
  } catch {
    return null;
  }
}

function writeLocal(d: SavedLayout): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...d, _at: Date.now() }));
  } catch {
    /* full or blocked storage: the server copy still counts */
  }
}

function valid(d: unknown): d is SavedLayout {
  const r = d as SavedLayout | null;
  return !!r && typeof r === 'object' && !!r.frames && typeof r.frames === 'object' && !!r.cards && typeof r.cards === 'object';
}

const finite = (...n: unknown[]): boolean => n.every((v) => typeof v === 'number' && isFinite(v));

/** Drop non-finite entries so a damaged copy cannot put NaN on the board. */
function clean(d: SavedLayout): SavedLayout {
  const frames: SavedLayout['frames'] = {};
  const cards: SavedLayout['cards'] = {};
  for (const [k, b] of Object.entries(d.frames)) if (b && finite(b.x, b.y, b.w, b.h)) frames[k] = b;
  for (const [k, c] of Object.entries(d.cards)) if (c && finite(c.x, c.y)) cards[k] = c;
  const view = d.view && finite(d.view.x, d.view.y, d.view.z) && d.view.z > 0 ? d.view : undefined;
  return { ...d, view, frames, cards };
}

export async function loadLayout(): Promise<SavedLayout> {
  const local = readLocal();
  try {
    const r = await apiGet<{ data?: unknown; updated_at?: number | string }>('/api/ui/layout/' + NAME);
    serverOk = true;
    if (valid(r && r.data)) return clean(r.data as SavedLayout);
  } catch (e) {
    const status = (e as { status?: number }).status;
    serverOk = status === 404 || status === 405 ? false : null;
  }
  return local || emptyLayout();
}

async function flush(): Promise<void> {
  const d = pending;
  pending = null;
  if (!d) return;
  writeLocal(d);
  if (serverOk === false) return;
  try {
    await api('/api/ui/layout/' + NAME, { method: 'PUT', body: { data: d } });
    serverOk = true;
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404 || status === 405) serverOk = false;
  }
}

export function saveLayout(d: SavedLayout, now = false): void {
  pending = d;
  clearTimeout(timer);
  if (now) void flush();
  else timer = window.setTimeout(() => void flush(), 700);
}

export function flushLayout(): void {
  clearTimeout(timer);
  void flush();
}
