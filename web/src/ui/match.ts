// Shared query matching: the query is matched whole ("a lam" finds "A lamp", never "A ... lam ... a").

export function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 60 - Math.min(20, t.length / 4);
  const at = t.indexOf(q);
  if (at >= 0) return (/[\s/_-]/.test(t[at - 1] || '') ? 45 : 30) - Math.min(15, at / 3);
  return 0;
}

/** Edit distance (insert, delete, replace), stopping early past `max`. */
function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export interface Near {
  s: number;
  word: string;
  why: string;
}

/** "Did you mean" closeness of a title that does not contain the query; null when not similar. */
export function similar(text: string, q: string): Near | null {
  if (q.length < 3) return null;
  if (q.includes(' ')) return similarWords(text, q);
  const max = q.length <= 4 ? 1 : 2;
  let best: Near | null = null;
  for (const w of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    const lw = w.toLowerCase();
    const whole = lev(lw, q, max);
    const start = lw.length > q.length ? lev(lw.slice(0, q.length), q, max) : max + 1;
    const d = Math.min(whole, start);
    if (d > max) continue;
    const s = 10 - d * 3 - Math.abs(lw.length - q.length) * 0.2;
    if (best && best.s >= s) continue;
    const why =
      whole <= start
        ? `${d} letter${d === 1 ? '' : 's'} off from “${w}”`
        : `“${w}” starts almost like “${q}”`;
    best = { s, word: w, why };
  }
  return best;
}

/** Where `q` sits in `text` (case-insensitive), for highlighting; null if absent. */
export function matchAt(text: string, q: string): [number, number] | null {
  if (!q) return null;
  const at = text.toLowerCase().indexOf(q);
  return at < 0 ? null : [at, at + q.length];
}

/** The query as matched: trimmed, lower case, inner spaces kept as one. */
export function normQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Every query word must come close to a title word, in order; the last may be a prefix. */
function similarWords(text: string, q: string): Near | null {
  const qs = q.split(' ').filter(Boolean);
  const ws = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (qs.length > ws.length) return null;
  let at = 0;
  let total = 0;
  let first = '';
  for (let k = 0; k < qs.length; k++) {
    const w = qs[k];
    const max = w.length <= 2 ? 0 : w.length <= 4 ? 1 : 2;
    const last = k === qs.length - 1;
    let found = -1;
    let dist = 0;
    for (let i = at; i < ws.length; i++) {
      const lw = ws[i].toLowerCase();
      const whole = lev(lw, w, max);
      const start = last && lw.length > w.length ? lev(lw.slice(0, w.length), w, max) : max + 1;
      const d = Math.min(whole, start);
      if (d <= max) {
        found = i;
        dist = d;
        break;
      }
    }
    if (found < 0) return null;
    if (!first) first = ws[found];
    total += dist;
    at = found + 1;
  }
  if (!total) return null; // it would have matched as it is
  return { s: 10 - total * 2, word: first, why: `${total} letter${total === 1 ? '' : 's'} off from “${text}”` };
}
