// The `memora.` key names are part of the stored format: never rename them.

/** Legacy local pins, read once to upload to the server. */
const LS_PINS = 'memora.pins.v3';
const LS_PIN_ORDER = 'memora.pinorder.v1';
const LS_UI = 'memora.ui.v3';
const LS_OPEN = 'memora.openfolders.v3';
const LS_UPDATE = 'memora.updateNotice';
const LS_TOASTS = 'memora.toasts.v1';
const SS_TAGIDX = 'memora.tagidx';

interface LegacyPin {
  kind: 'note' | 'folder';
  path: string;
}

interface UiPrefs {
  collapsed: boolean;
}

interface TagIndexCache {
  sig: string;
  tags: [string, unknown[]][];
}

type Store = 'local' | 'session';

/** The parsed value, or undefined when missing, unreadable or blocked. */
function read(store: Store, key: string): unknown {
  try {
    const raw = (store === 'local' ? localStorage : sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function write(store: Store, key: string, value: unknown): void {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be full or blocked in private mode */
  }
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function field(v: unknown, k: string): unknown {
  return v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
}

export const ui: UiPrefs = { collapsed: field(read('local', LS_UI), 'collapsed') === true };

/** Activity toasts: `off` silences every one; `muted` lists API key ids. */
interface ToastPrefs {
  off: boolean;
  muted: string[];
}

const storedToasts = read('local', LS_TOASTS);
export const toastPrefs: ToastPrefs = {
  off: field(storedToasts, 'off') === true,
  muted: strings(field(storedToasts, 'muted')),
};

export function saveToastPrefs(): void {
  write('local', LS_TOASTS, toastPrefs);
}

export function activityToastAllowed(keyId: string): boolean {
  if (toastPrefs.off) return false;
  return !keyId || (!toastPrefs.muted.includes(keyId) && !quiet.has(keyId));
}

/** Keys whose activity a screen already shows live (not saved). */
const quiet = new Set<string>();

/** Returns the undo. */
export function quietToasts(keyId: string): () => void {
  quiet.add(keyId);
  return () => quiet.delete(keyId);
}

/** This browser's legacy pins in their display order. */
export function legacyPins(): LegacyPin[] {
  const stored = read('local', LS_PINS);
  const rank = new Map(strings(read('local', LS_PIN_ORDER)).map((id, i) => [id, i]));
  const id = (p: LegacyPin): string => (p.kind === 'note' ? 'n:' : 'f:') + p.path;
  return [
    ...strings(field(stored, 'folders')).map((path) => ({ kind: 'folder' as const, path })),
    ...strings(field(stored, 'notes')).map((path) => ({ kind: 'note' as const, path })),
  ].sort((a, b) => (rank.get(id(a)) ?? 1e9) - (rank.get(id(b)) ?? 1e9));
}

export function clearLegacyPins(): void {
  try {
    localStorage.removeItem(LS_PINS);
    localStorage.removeItem(LS_PIN_ORDER);
  } catch {
    /* blocked storage: nothing to clear */
  }
}

export function saveUI(): void {
  write('local', LS_UI, ui);
}

export function loadOpenFolders(): Set<string> {
  return new Set(strings(read('local', LS_OPEN)));
}

export function saveOpenFolders(open: Set<string>): void {
  write('local', LS_OPEN, Array.from(open));
}

/** The release whose update notice was already shown on this device. */
export function updateNoticeSeen(): string {
  const v = read('local', LS_UPDATE);
  return typeof v === 'string' ? v : '';
}

export function markUpdateNoticeSeen(version: string): void {
  write('local', LS_UPDATE, version);
}

export function readTagIndex(): TagIndexCache | null {
  const v = read('session', SS_TAGIDX);
  const sig = field(v, 'sig');
  const tags = field(v, 'tags');
  if (typeof sig !== 'string' || !Array.isArray(tags)) return null;
  const entries = tags.filter(
    (e): e is [string, unknown[]] => Array.isArray(e) && typeof e[0] === 'string' && Array.isArray(e[1]),
  );
  return { sig, tags: entries };
}

export function writeTagIndex(sig: string, tags: [string, unknown[]][]): void {
  write('session', SS_TAGIDX, { sig, tags });
}

export function clearTagIndex(): void {
  try {
    sessionStorage.removeItem(SS_TAGIDX);
  } catch {
    /* nothing to clear */
  }
}
