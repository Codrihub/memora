// A card's text as the fields of the card form, and back, in the Obsidian Kanban syntax: linked
// notes are `[[Note]]`, tags `#tag`, the due date `@{2026-01-31}` and its time `@@{10:30}` (the
// triggers and formats follow the board's settings when it has them). Opening a card takes those
// pieces out of the text and remembers where each was; saving puts every one that is still there
// back in its place and adds new ones at the end of the first line, so text nobody changed comes
// back byte for byte. Pure (no DOM), so it runs under `node --test`.

export interface CardSettings {
  'date-trigger'?: unknown;
  'time-trigger'?: unknown;
  'date-format'?: unknown;
  'time-format'?: unknown;
}

export interface CardFields {
  /** The text without the pieces below. */
  text: string;
  /** Link targets as written between the brackets (`Note`, `Folder/Note`, `Note|shown`). */
  links: string[];
  /** Tags without `#`. */
  tags: string[];
  /** `YYYY-MM-DD`, or ''. */
  date: string;
  /** `HH:mm`, or ''. */
  time: string;
  /** `- [ ] step` lines under the first line, in order. */
  checklist: ChecklistItem[];
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

/** A checklist line, as the server reads it: `- [ ] step` (tabs or several spaces too, text optional). */
const STEP_RE = /^[ \t]*[-*+][ \t]+\[([ xX])\](?:[ \t]+(.*))?$/;
/** A block id (`^abc123`) at the end of a line: the card's own name for its colour. */
const BLOCK_RE = /[ \t]+\^[A-Za-z0-9-]+$/;

/** The checklist lines of a card (not its first line), where each one was, and the text without them. */
function splitSteps(text: string): { rest: string; steps: ChecklistItem[]; at: number; raw: { line: string; i: number }[] } {
  const lines = text.split('\n');
  const steps: ChecklistItem[] = [];
  const raw: { line: string; i: number }[] = [];
  const keep: string[] = [];
  let at = -1;
  lines.forEach((l, i) => {
    const m = i > 0 ? STEP_RE.exec(l) : null;
    if (m) {
      if (at < 0) at = keep.length;
      steps.push({ text: (m[2] ?? '').trim(), done: m[1] !== ' ' });
      raw.push({ line: l, i });
    } else keep.push(l);
  });
  return { rest: keep.join('\n'), steps, at, raw };
}

/** Put checklist lines back where the first one was (or at the end). */
function joinSteps(rest: string, steps: ChecklistItem[], at: number): string {
  if (!steps.length) return rest;
  const lines = rest.split('\n');
  const put = steps.map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}`);
  const i = at < 0 || at > lines.length ? lines.length : Math.max(1, at);
  lines.splice(i, 0, ...put);
  return lines.join('\n');
}

type Kind = 'link' | 'tag' | 'date' | 'time';

interface Piece {
  kind: Kind;
  /** What the field holds for it (link target, tag, ISO date, HH:mm). */
  value: string;
  raw: string;
  /** Where it sat in the text without the pieces. */
  at: number;
  /** The space taken out with it: before it, after it, or none. */
  sep: 'before' | 'after' | '';
}

export interface ParsedCard {
  fields: CardFields;
  pieces: Piece[];
  /** Where the checklist sat among the lines of the text without it (-1: none). */
  stepsAt: number;
  /** The checklist lines exactly as written and the line each was on, to give them back unchanged. */
  stepsRaw: { line: string; i: number }[];
  /** The card's block id with its leading space (`' ^abc123'`), kept off the form's text. */
  block: string;
  /** The text as it came. */
  full: string;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const str = (v: unknown, d: string): string => (typeof v === 'string' && v ? v : d);

/** A moment-style date format (YYYY, YY, MM, M, DD, D and separators) as a pattern and a writer. */
function dateCodec(fmt: string): { re: string; read: (s: string) => string | null; write: (iso: string) => string } {
  const parts = fmt.match(/YYYY|YY|MM|M|DD|D|[^YMD]+/g) || ['YYYY', '-', 'MM', '-', 'DD'];
  const re = parts
    .map((p) => (p === 'YYYY' ? '(\\d{4})' : p === 'YY' ? '(\\d{2})' : p === 'MM' || p === 'DD' ? '(\\d{2})' : p === 'M' || p === 'D' ? '(\\d{1,2})' : esc(p)))
    .join('');
  const order = parts.filter((p) => /^(YYYY|YY|MM|M|DD|D)$/.test(p));
  return {
    re,
    read: (s) => {
      const m = new RegExp('^' + re + '$').exec(s);
      if (!m) return null;
      let y = '';
      let mo = '';
      let d = '';
      order.forEach((p, i) => {
        const v = m[i + 1];
        if (p === 'YYYY') y = v;
        else if (p === 'YY') y = '20' + v;
        else if (p[0] === 'M') mo = v.padStart(2, '0');
        else d = v.padStart(2, '0');
      });
      if (!y || !mo || !d || Number(mo) > 12 || Number(d) > 31) return null;
      return `${y}-${mo}-${d}`;
    },
    write: (iso) => {
      const [y, mo, d] = iso.split('-');
      return parts
        .map((p) => (p === 'YYYY' ? y : p === 'YY' ? y.slice(2) : p === 'MM' ? mo : p === 'M' ? String(Number(mo)) : p === 'DD' ? d : p === 'D' ? String(Number(d)) : p))
        .join('');
    },
  };
}

/** HH:mm or H:mm style times. */
function timeCodec(fmt: string): { read: (s: string) => string | null; write: (hm: string) => string } {
  const short = /^H:mm$/.test(fmt);
  return {
    read: (s) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(s);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
      return `${m[1].padStart(2, '0')}:${m[2]}`;
    },
    write: (hm) => (short ? hm.replace(/^0(\d)/, '$1') : hm),
  };
}

function codecs(s: CardSettings) {
  return {
    dt: str(s['date-trigger'], '@'),
    tt: str(s['time-trigger'], '@@'),
    date: dateCodec(str(s['date-format'], 'YYYY-MM-DD')),
    time: timeCodec(str(s['time-format'], 'HH:mm')),
  };
}

/** Take the card's text apart into the form's fields. */
export function parseCard(full: string, settings: CardSettings = {}): ParsedCard {
  const c = codecs(settings);
  // The block id stays out of the form: from the first line, or else the last one.
  const lines0 = full.split('\n');
  let block = '';
  for (const i of [0, lines0.length - 1]) {
    const m = BLOCK_RE.exec(lines0[i]);
    if (m && !block) {
      block = m[0];
      lines0[i] = lines0[i].slice(0, m.index);
    }
  }
  const sp = splitSteps(lines0.join('\n'));
  const stepsRaw = sp.raw;
  const text = sp.rest;
  // The time trigger is often the date trigger doubled: try it first.
  const re = new RegExp(
    `${esc(c.tt)}\\{([^}\\n]+)\\}|${esc(c.dt)}\\{([^}\\n]+)\\}|(?<!!)\\[\\[([^\\]\\n]+)\\]\\]|(?<=^|\\s)#([\\p{L}\\p{N}_][\\p{L}\\p{N}_/-]*)`,
    'gu',
  );
  const found: { kind: Kind; value: string; s: number; e: number }[] = [];
  let date = '';
  let time = '';
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const s = m.index;
    const e = s + m[0].length;
    if (m[1] != null) {
      const v = c.time.read(m[1].trim());
      if (v && !time) {
        time = v;
        found.push({ kind: 'time', value: v, s, e });
      }
    } else if (m[2] != null) {
      const v = c.date.read(m[2].trim());
      if (v && !date) {
        date = v;
        found.push({ kind: 'date', value: v, s, e });
      }
    } else if (m[3] != null) found.push({ kind: 'link', value: m[3], s, e });
    else if (m[4] != null) {
      // A tag inside a link or a URL fragment is text.
      found.push({ kind: 'tag', value: m[4], s, e });
    }
  }
  const pieces: Piece[] = [];
  let out = '';
  let from = 0;
  for (const f of found) {
    let s = f.s;
    let e = f.e;
    let sep: Piece['sep'] = '';
    // Take one space with it, so the text does not keep a double space.
    if (s > from && text[s - 1] === ' ') {
      s--;
      sep = 'before';
    } else if (text[e] === ' ') {
      e++;
      sep = 'after';
    }
    out += text.slice(from, s);
    pieces.push({ kind: f.kind, value: f.value, raw: text.slice(f.s, f.e), at: out.length, sep });
    from = e;
  }
  out += text.slice(from);
  const uniq = (k: Kind): string[] => [...new Set(pieces.filter((p) => p.kind === k).map((p) => p.value))];
  return { fields: { text: out, links: uniq('link'), tags: uniq('tag'), date, time, checklist: sp.steps }, pieces, stepsAt: sp.at, stepsRaw, block, full };
}

/** Where an offset in `a` lands after `a` was edited into `b` (one edited stretch). */
function moveAt(a: string, b: string, at: number): number {
  if (a === b) return at;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  if (at <= p) return at;
  if (at >= a.length - q) return at + (b.length - a.length);
  return b.length - q;
}

/** Put the card's text back together from the edited fields. */
export function writeCard(parsed: ParsedCard, edited: CardFields, settings: CardSettings = {}): string {
  const c = codecs(settings);
  const before = parsed.fields;
  const sameSteps =
    edited.checklist.length === before.checklist.length && edited.checklist.every((x, i) => x.text === before.checklist[i].text && x.done === before.checklist[i].done);
  const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  // Nothing changed: the card's text exactly as it came.
  if (
    sameSteps &&
    edited.text === before.text &&
    edited.date === before.date &&
    edited.time === before.time &&
    sameList(edited.links, before.links) &&
    sameList(edited.tags, before.tags)
  )
    return parsed.full;
  const keep = (p: Piece): boolean =>
    p.kind === 'link' ? edited.links.includes(p.value) : p.kind === 'tag' ? edited.tags.includes(p.value) : p.kind === 'date' ? !!edited.date : !!edited.time;
  const rawOf = (p: Piece): string => {
    if (p.kind === 'date' && edited.date !== before.date) return `${c.dt}{${c.date.write(edited.date)}}`;
    if (p.kind === 'time' && edited.time !== before.time) return `${c.tt}{${c.time.write(edited.time)}}`;
    return p.raw;
  };
  const text = edited.text;
  const kept = parsed.pieces
    .filter(keep)
    .map((p, i) => ({ p, i, at: Math.min(moveAt(before.text, text, p.at), text.length) }))
    // From the end, so earlier offsets stay right; pieces at one spot go back in their order.
    .sort((x, y) => y.at - x.at || y.i - x.i);
  let out = text;
  for (const { p, at } of kept) {
    const raw = rawOf(p);
    const piece = p.sep === 'before' ? ' ' + raw : p.sep === 'after' ? raw + ' ' : raw;
    out = out.slice(0, at) + piece + out.slice(at);
  }
  // New pieces go at the end of the first line, the way Obsidian Kanban adds them.
  const had = (k: Kind, v: string): boolean => parsed.pieces.some((p) => p.kind === k && p.value === v);
  const add: string[] = [];
  for (const l of edited.links) if (!had('link', l)) add.push(`[[${l}]]`);
  for (const tg of edited.tags) if (!had('tag', tg)) add.push(`#${tg}`);
  if (edited.date && !parsed.pieces.some((p) => p.kind === 'date')) add.push(`${c.dt}{${c.date.write(edited.date)}}`);
  if (edited.time && !parsed.pieces.some((p) => p.kind === 'time')) add.push(`${c.tt}{${c.time.write(edited.time)}}`);
  if (add.length) {
    const nl = out.indexOf('\n');
    const head = nl < 0 ? out : out.slice(0, nl);
    const rest = nl < 0 ? '' : out.slice(nl);
    const sep = head && !/\s$/.test(head) ? ' ' : '';
    out = head + sep + add.join(' ') + rest;
  }
  // The checklist: each line back on its own line when nobody touched it, otherwise as the form says.
  if (sameSteps && parsed.stepsRaw.length) {
    const lines = out.split('\n');
    for (const r of parsed.stepsRaw) lines.splice(Math.max(1, Math.min(r.i, lines.length)), 0, r.line);
    out = lines.join('\n');
  } else out = joinSteps(out, edited.checklist.filter((x) => x.text.trim()), parsed.stepsAt);
  // The block id goes back on the first line, whatever was edited (the card keeps its colour).
  if (parsed.block) {
    const nl = out.indexOf('\n');
    out = nl < 0 ? out + parsed.block : out.slice(0, nl) + parsed.block + out.slice(nl);
  }
  return out;
}
