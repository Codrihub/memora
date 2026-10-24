// Unsaved editor text kept on this device until the server has it, so a closed
// tab, a lost connection or an ended session never loses writing.

const KEY = 'memora.drafts.v1';

interface Draft {
  text: string;
  /** The note's text the draft was written on top of. */
  base: string;
  at: number;
}

function readAll(): Record<string, Draft> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Draft>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Draft>): void {
  try {
    if (Object.keys(all).length) localStorage.setItem(KEY, JSON.stringify(all));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage full or blocked: saving to the server still works */
  }
}

let pending: { path: string; d: Draft } | null = null;
let timer = 0;

function flush(): void {
  clearTimeout(timer);
  if (!pending) return;
  const all = readAll();
  all[pending.path] = pending.d;
  pending = null;
  writeAll(all);
}

/** Remember `text` for `path` (written at most twice a second). */
export function saveDraft(path: string, text: string, base: string): void {
  if (text === base) {
    clearDraft(path);
    return;
  }
  pending = { path, d: { text, base, at: Date.now() } };
  clearTimeout(timer);
  timer = window.setTimeout(flush, 500);
}

export function readDraft(path: string): Draft | null {
  if (pending?.path === path) return pending.d;
  return readAll()[path] || null;
}

export function clearDraft(path: string): void {
  if (pending?.path === path) {
    clearTimeout(timer);
    pending = null;
  }
  const all = readAll();
  if (all[path]) {
    delete all[path];
    writeAll(all);
  }
}

/** A note changed path: its draft follows. */
export function moveDraft(from: string, to: string): void {
  flush();
  const all = readAll();
  if (!all[from]) return;
  all[to] = all[from];
  delete all[from];
  writeAll(all);
}

window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
