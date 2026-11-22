// DOM-free model for the version history panel (kept separate so it can be tested).

import { t } from '../i18n';

export interface Version {
  rev: string;
  /** `git log %ai`: "2026-10-24 10:42:07 +0700". */
  date: string;
  author: string;
  message: string;
  /** 1 = the oldest revision, `total` = the current one. */
  version: number;
  total: number;
  /** The note's path in this revision, when it had another name then. */
  path?: string;
  /** Made by the signed-in owner. */
  owner?: boolean;
}

export interface HistoryList {
  path: string;
  total: number;
  versions: Version[];
}

/** Epoch milliseconds of a revision (0 when the date does not parse). */
export function versionMs(v: Pick<Version, 'date'>): number {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec((v.date || '').trim());
  const t = m ? Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`) : Date.parse(v.date || '');
  return Number.isFinite(t) ? t : 0;
}

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today", "Yesterday", "Mon, Oct 20", or "Oct 20, 2025" in another year. */
export function dayLabel(ms: number, now = Date.now()): string {
  if (!ms) return t('Unknown date');
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86400000);
  if (days === 0) return t('Today');
  if (days === 1) return t('Yesterday');
  const d = new Date(ms);
  if (d.getFullYear() === new Date(now).getFullYear())
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "10:42 AM" in the browser's time zone. */
export function timeLabel(ms: number): string {
  return ms ? new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
}

/** "today at 10:42 AM", "yesterday at …", "Oct 20 at …" for the preview banner. */
export function whenLabel(ms: number, now = Date.now()): string {
  if (!ms) return t('an unknown date');
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86400000);
  const time = timeLabel(ms);
  if (days === 0) return t('today at {time}', { time });
  if (days === 1) return t('yesterday at {time}', { time });
  return t('{day} at {time}', { day: dayLabel(ms, now).replace(/^[A-Z][a-z]{2}, /, ''), time });
}

/** Revisions in day groups, newest first (the order the server sends). */
export function groupByDay(list: Version[], now = Date.now()): { label: string; items: Version[] }[] {
  const out: { label: string; items: Version[] }[] = [];
  for (const v of list) {
    const label = dayLabel(versionMs(v), now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(v);
    else out.push({ label, items: [v] });
  }
  return out;
}

/** Who made a revision: "You" for the owner, else the agent's (or git user's) name. */
export function whoOf(v: Pick<Version, 'author' | 'owner'>): string {
  if (v.owner) return t('You');
  return (v.author || '').trim() || t('Unknown');
}

/** What a revision did, in plain words, from the commit message Memora writes. */
export function actionOf(message: string): string {
  const m = (message || '').trim();
  const rules: [RegExp, string][] = [
    [/^edit:/, t('Edited')],
    [/^create:/, t('Created')],
    [/^restore from trash:/, t('Restored from the Trash')],
    [/^restore:/, t('Restored an older version')],
    [/^rename:/, t('Renamed')],
    [/^move:/, t('Moved')],
    [/^trash:/, t('Moved to the Trash')],
    [/^delete:/, t('Deleted')],
    [/^import:/, t('Imported')],
    [/^bulk replace/, t('Find and replace')],
    [/^snapshot:/, t('Snapshot')],
    [/^(move|rename|delete)\b.*folder|^move (part of )?the contents/, t('Folder moved')],
    [/^merge/, t('Merged')],
  ];
  for (const [re, label] of rules) if (re.test(m)) return label;
  if (m === '(hidden)') return t('Changed');
  // Changes made outside Memora keep their own message.
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : t('Changed');
}

/** The revision a `restore: <path>@<rev>` commit brought back, or null. */
export function restoredRev(message: string): string | null {
  const m = /^restore: .*@([^@\s]+)$/.exec((message || '').trim());
  return m ? m[1] : null;
}

interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
}

/** A unified diff (git) as lines to show, without its file headers. */
export function parseDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let body = false;
  for (const line of (diff || '').split('\n')) {
    if (line.startsWith('@@')) {
      body = true;
      out.push({ kind: 'hunk', text: line.replace(/^@@[^@]*@@\s?/, '') });
      continue;
    }
    if (!body) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (line.startsWith('+')) out.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) out.push({ kind: 'del', text: line.slice(1) });
    else if (line.startsWith(' ')) out.push({ kind: 'ctx', text: line.slice(1) });
    else if (line === '' && out.length) out.push({ kind: 'ctx', text: '' });
  }
  while (out.length && out[out.length - 1].kind === 'ctx' && !out[out.length - 1].text) out.pop();
  return out;
}

/** How many lines a diff adds and removes. */
export function diffCounts(lines: DiffLine[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const l of lines) {
    if (l.kind === 'add') add++;
    else if (l.kind === 'del') del++;
  }
  return { add, del };
}
