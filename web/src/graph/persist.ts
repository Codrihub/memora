// Pins go to the layout API with a localStorage fallback; view prefs stay per browser.

import { api } from '../api';
import type { LayoutMode } from './model';

export interface GraphLayout {
  v: 1;
  pins: Record<string, [number, number]>;
}

interface GraphPrefs {
  mode: LayoutMode;
  /** Label density: how small a node may be and still get a name. */
  labels: number;
  /** Spacing of the force layout (kept for older prefs). */
  spacing: number;
  spacingBy: Record<LayoutMode, number>;
  noteLabels: boolean;
  folderLabels: boolean;
  folders: boolean;
  hulls: boolean;
  orphans: boolean;
  minimap: boolean;
}

const LS_LAYOUT = 'memora.layout.graph';
const LS_PREFS = 'memora.graph.prefs';

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function lsSet(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or blocked */
  }
}

function clean(d: unknown): GraphLayout {
  const out: GraphLayout = { v: 1, pins: {} };
  const pins = d && typeof d === 'object' ? (d as { pins?: unknown }).pins : null;
  if (pins && typeof pins === 'object') {
    for (const [id, p] of Object.entries(pins as Record<string, unknown>)) {
      if (Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x)))
        out.pins[id] = [p[0], p[1]];
    }
  }
  return out;
}

export async function loadLayout(): Promise<GraphLayout> {
  try {
    const r = await api<{ data?: unknown }>('/api/ui/layout/graph');
    if (r && r.data) return clean(r.data);
  } catch {
    /* endpoint missing or offline: fall back */
  }
  return clean(lsGet(LS_LAYOUT));
}

let timer = 0;
export function saveLayout(l: GraphLayout): void {
  lsSet(LS_LAYOUT, l);
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    void api('/api/ui/layout/graph', { method: 'PUT', body: { data: l } }).catch(() => {
      /* localStorage already holds it */
    });
  }, 700);
}

export function loadPrefs(): GraphPrefs {
  return parsePrefs(lsGet<Partial<GraphPrefs>>(LS_PREFS) || {});
}

/** The defaults, without touching storage. */
export function factoryPrefs(): GraphPrefs {
  return parsePrefs({});
}

function parsePrefs(d: Partial<GraphPrefs>): GraphPrefs {
  return {
    mode: d.mode === 'radial' || d.mode === 'clusters' ? d.mode : 'force',
    labels: typeof d.labels === 'number' ? d.labels : 0.45,
    spacing: typeof d.spacing === 'number' ? d.spacing : 1,
    spacingBy: {
      force: num(d.spacingBy?.force, typeof d.spacing === 'number' ? d.spacing : 1),
      radial: num(d.spacingBy?.radial, 1),
      clusters: num(d.spacingBy?.clusters, 1),
    },
    noteLabels: d.noteLabels !== false,
    folderLabels: d.folderLabels !== false,
    folders: d.folders !== false,
    hulls: d.hulls !== false,
    orphans: d.orphans !== false,
    minimap: d.minimap !== false,
  };
}

function num(v: unknown, dflt: number): number {
  return typeof v === 'number' && isFinite(v) ? v : dflt;
}

export function defaultPrefs(): GraphPrefs {
  try {
    localStorage.removeItem(LS_PREFS);
  } catch {
    /* storage blocked */
  }
  return factoryPrefs();
}

export function savePrefs(p: GraphPrefs): void {
  lsSet(LS_PREFS, p);
}
