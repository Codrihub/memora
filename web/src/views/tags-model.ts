// Pure helpers behind the Tags page (no DOM, no requests) so they can be tested on their own.

/** One note carrying a tag, as the tag index keeps it. */
export interface TagEntry {
  path: string;
  name: string;
  folder: string;
  mtime: number;
}

/** Notes must carry every chosen tag (`all`) or at least one (`any`). */
export type MatchMode = 'all' | 'any';

/** The notes that match the chosen tags' lists, each note once, newest first. */
export function matchNotes(lists: TagEntry[][], mode: MatchMode): TagEntry[] {
  if (!lists.length) return [];
  let out: TagEntry[];
  if (mode === 'any') {
    const seen = new Map<string, TagEntry>();
    for (const l of lists) for (const e of l) if (!seen.has(e.path)) seen.set(e.path, e);
    out = Array.from(seen.values());
  } else {
    out = lists[0].slice();
    for (const l of lists.slice(1)) {
      const keep = new Set(l.map((e) => e.path));
      out = out.filter((e) => keep.has(e.path));
    }
  }
  return out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

/**
 * A checkbox click. Plain: toggle `target`. With shift and a previous click
 * (`anchor`) still in `order`: every tag from the anchor to the target takes
 * the clicked box's new state. Returns the new selection.
 */
export function pickTags(order: string[], picked: ReadonlySet<string>, target: string, on: boolean, anchor: string | null, range: boolean): Set<string> {
  const next = new Set(picked);
  const a = anchor === null ? -1 : order.indexOf(anchor);
  const b = order.indexOf(target);
  if (range && a >= 0 && b >= 0) {
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      if (on) next.add(order[i]);
      else next.delete(order[i]);
    }
  } else if (on) next.add(target);
  else next.delete(target);
  return next;
}

/** Whether every / some of `shown` is picked (the Select all box). */
export function allState(shown: string[], picked: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const n = shown.filter((t) => picked.has(t)).length;
  return n && n === shown.length ? 'all' : n ? 'some' : 'none';
}

const key = (t: string): string => t.trim().replace(/^#+/, '').trim().toLowerCase();

/** A name the server takes as a tag: letters, digits and - _ / . (a leading # is fine). */
export function validTag(raw: string): boolean {
  const t = raw.trim().replace(/^#+/, '');
  return !!t && /^[\p{L}\p{N}_\-/.]+$/u.test(t) && !t.includes('---');
}

/** The tags to merge into `into`: every chosen one but `into` itself (case does not matter). */
export function mergeSources(chosen: string[], into: string): string[] {
  const k = key(into);
  return chosen.filter((t) => key(t) !== k);
}

/** Per note, which of `tags` it carries: what "Remove from notes" asks the server to drop. */
export function untagPlan(index: Map<string, TagEntry[]>, tags: string[]): { path: string; tags: string[] }[] {
  const byPath = new Map<string, string[]>();
  for (const t of tags)
    for (const e of index.get(t) || []) {
      const l = byPath.get(e.path);
      if (l) l.push(t);
      else byPath.set(e.path, [t]);
    }
  return Array.from(byPath.entries())
    .map(([path, list]) => ({ path, tags: list }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Of the tags asked to go, the ones the note no longer has (`after` = its tags now). */
export function removedTags(asked: string[], after: string[]): string[] {
  const left = new Set(after.map(key));
  return asked.filter((t) => !left.has(key(t)));
}

/** A parsed tag pattern. */
export type Pattern =
  | { k: 'tag'; t: string }
  | { k: 'not'; a: Pattern }
  | { k: 'and' | 'or'; l: Pattern[] };

type PatternResult = { ok: true; p: Pattern; tags: string[] } | { ok: false; error: string };

type Tok = { k: 'tag'; t: string } | { k: 'and' | 'or' | 'not' | '(' | ')' };

function lex(src: string): Tok[] | string {
  const out: Tok[] = [];
  const re = /\s*(\(|\)|&&|\|\||&|\||,|!|-(?=[^\s])|#?[\p{L}\p{N}_\-/.]+)/uy;
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) return `“${src.slice(i, i + 12)}” is not a tag or a word Memora knows here`;
    i = re.lastIndex;
    const w = m[1];
    const lw = w.toLowerCase();
    if (w === '(' || w === ')') out.push({ k: w });
    else if (lw === 'and' || w === '&' || w === '&&') out.push({ k: 'and' });
    else if (lw === 'or' || w === '|' || w === '||' || w === ',') out.push({ k: 'or' });
    else if (lw === 'not' || w === '!' || w === '-') out.push({ k: 'not' });
    else out.push({ k: 'tag', t: w.replace(/^#+/, '') });
  }
  return out;
}

/**
 * Read a pattern such as `session or (memora and plan) not docker`.
 * `not` binds tightest, then `and`, then `or`; two tags side by side mean
 * `and`. `&`, `|`, `,`, `!` and a leading `-` work too; `#` is optional.
 */
export function parsePattern(src: string): PatternResult {
  const toks = lex(src);
  if (typeof toks === 'string') return { ok: false, error: toks };
  if (!toks.length) return { ok: false, error: 'Type at least one tag' };
  let i = 0;
  const tags: string[] = [];
  const fail = (e: string): never => {
    throw new Error(e);
  };
  const atom = (): Pattern => {
    const t = toks[i];
    if (!t) return fail('The pattern ends too early: a tag is missing at the end');
    if (t.k === 'not') {
      i++;
      return { k: 'not', a: atom() };
    }
    if (t.k === '(') {
      i++;
      const inner = or();
      if (toks[i]?.k !== ')') fail('A “(” is never closed');
      i++;
      return inner;
    }
    if (t.k === 'tag') {
      i++;
      if (!tags.includes(t.t.toLowerCase())) tags.push(t.t.toLowerCase());
      return { k: 'tag', t: t.t };
    }
    return fail(t.k === ')' ? 'A “)” has no “(” before it' : `“${t.k}” needs a tag before and after it`);
  };
  const and = (): Pattern => {
    const l = [atom()];
    for (;;) {
      const t = toks[i];
      if (t?.k === 'and') {
        i++;
        l.push(atom());
      } else if (t && (t.k === 'tag' || t.k === 'not' || t.k === '(')) l.push(atom());
      else break;
    }
    return l.length === 1 ? l[0] : { k: 'and', l };
  };
  const or = (): Pattern => {
    const l = [and()];
    while (toks[i]?.k === 'or') {
      i++;
      l.push(and());
    }
    return l.length === 1 ? l[0] : { k: 'or', l };
  };
  try {
    const p = or();
    if (i < toks.length) fail(toks[i].k === ')' ? 'A “)” has no “(” before it' : 'Something after the pattern is left over');
    return { ok: true, p, tags };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Whether a note with these tags (lower case) matches. */
export function matchPattern(p: Pattern, has: ReadonlySet<string>): boolean {
  if (p.k === 'tag') return has.has(p.t.toLowerCase());
  if (p.k === 'not') return !matchPattern(p.a, has);
  return p.k === 'and' ? p.l.every((x) => matchPattern(x, has)) : p.l.some((x) => matchPattern(x, has));
}

/** The pattern written back plainly: `session or (memora and plan) and not docker`. */
export function patternText(p: Pattern, top = true): string {
  if (p.k === 'tag') return p.t;
  if (p.k === 'not') return 'not ' + patternText(p.a, false);
  // An "and" inside an "and" (or "or" in "or") needs no brackets.
  const s = p.l.map((x) => (x.k === p.k ? patternText(x, true) : patternText(x, false))).join(p.k === 'and' ? ' and ' : ' or ');
  return top ? s : `(${s})`;
}

/** The notes (each once, newest first) whose tags match, out of every tagged note in `index`. */
export function notesForPattern(index: Map<string, TagEntry[]>, p: Pattern): TagEntry[] {
  const notes = new Map<string, { e: TagEntry; tags: Set<string> }>();
  index.forEach((list, t) => {
    for (const e of list) {
      const n = notes.get(e.path) || notes.set(e.path, { e, tags: new Set() }).get(e.path)!;
      n.tags.add(t.toLowerCase());
    }
  });
  return Array.from(notes.values())
    .filter((n) => matchPattern(p, n.tags))
    .map((n) => n.e)
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

/** One piece of a pattern as the dialog shows it: a tag, an operator or a bracket. */
export type PatternToken = Tok;

/** The pieces of a pattern written as text (to edit an applied pattern as chips). */
export function patternTokens(src: string): PatternToken[] {
  const t = lex(src);
  return typeof t === 'string' ? [] : t;
}

/** Pieces back to text the parser reads. */
export function tokensText(toks: PatternToken[]): string {
  return toks.map((t) => (t.k === 'tag' ? t.t : t.k)).join(' ');
}
