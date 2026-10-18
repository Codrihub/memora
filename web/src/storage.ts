// localStorage and sessionStorage access. The `memora.` key names are part of
// the stored format: renaming one would drop users' pins, the sidebar
// preference or folder expansion state.

const LS_PINS = 'memora.pins.v3';
const LS_UI = 'memora.ui.v3';
const LS_OPEN = 'memora.openfolders.v3';
const LS_UPDATE = 'memora.updateNotice';
const SS_TAGIDX = 'memora.tagidx';

export interface Pins {
  folders: string[];
  notes: string[];
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

const storedPins = read('local', LS_PINS);
export const pins: Pins = { folders: strings(field(storedPins, 'folders')), notes: strings(field(storedPins, 'notes')) };
export const ui: UiPrefs = { collapsed: field(read('local', LS_UI), 'collapsed') === true };

export function savePins(): void {
  write('local', LS_PINS, pins);
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
