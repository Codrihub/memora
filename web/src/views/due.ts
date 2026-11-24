// Due dates at a glance: how a card's date stands against today, and the board's own date colours
// (Obsidian Kanban's `date-colors` setting) when it has them. Pure, so it runs in tests too.

/** One rule of Obsidian Kanban's `date-colors` setting (src/components/types.ts in the plugin). */
export interface DateColor {
  isToday?: boolean;
  isBefore?: boolean;
  isAfter?: boolean;
  distance?: number;
  unit?: 'hours' | 'days' | 'weeks' | 'months';
  direction?: 'before' | 'after';
  color?: string;
  backgroundColor?: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** A local day as `YYYY-MM-DD`. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today, in the reader's time zone. */
export function todayISO(now: Date = new Date()): string {
  return isoDay(now);
}

/** The day part of a date written `YYYY-MM-DD…`, or null. */
export function dayOf(d: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/** Past days are late, today is today, anything else is not due yet. */
export function dueState(day: string, today: string = todayISO()): 'late' | 'today' | 'later' {
  return day < today ? 'late' : day === today ? 'today' : 'later';
}

/** How many of `days` are past `today`, and how many fall on it. */
export function dueCounts(days: string[] | null | undefined, today: string = todayISO()): { late: number; today: number } {
  let late = 0;
  let now = 0;
  for (const d of days || []) {
    const s = dayOf(d);
    if (!s) continue;
    if (s < today) late++;
    else if (s === today) now++;
  }
  return { late, today: now };
}

function shift(now: Date, n: number, unit: DateColor['unit']): Date {
  const d = new Date(now);
  if (unit === 'hours') d.setHours(d.getHours() + n);
  else if (unit === 'weeks') d.setDate(d.getDate() + n * 7);
  else if (unit === 'months') d.setMonth(d.getMonth() + n);
  else d.setDate(d.getDate() + n);
  return d;
}

/** The board's colour for a date, as Obsidian Kanban picks it (getDateColorFn in
 *  src/components/helpers.ts): today's rule first, then the ranges by their far end, then before and
 *  after; the first rule that holds wins. Dates here are whole days, so ranges compare by day (by the
 *  hour for an hours range). Null when the board sets none or none holds. */
export function dateColorFor(day: string, rules: unknown, now: Date = new Date()): { color?: string; background?: string } | null {
  if (!Array.isArray(rules) || !rules.length) return null;
  const s = dayOf(day);
  if (!s) return null;
  const list = (rules as DateColor[])
    .filter((r) => r && typeof r === 'object' && (r.color || r.backgroundColor))
    .map((r) => ({ r, at: r.isToday || r.isBefore || r.isAfter ? null : shift(now, (r.distance || 0) * (r.direction === 'after' ? 1 : -1), r.unit) }));
  list.sort((a, b) => {
    if (a.r.isToday) return -1;
    if (b.r.isToday) return 1;
    if (a.r.isAfter || a.r.isBefore) return 1;
    if (b.r.isAfter || b.r.isBefore) return -1;
    return (a.at?.getTime() || 0) - (b.at?.getTime() || 0);
  });
  const today = isoDay(now);
  const date = new Date(`${s}T00:00:00`);
  for (const { r, at } of list) {
    let hit: boolean;
    if (r.isToday) hit = s === today;
    else if (r.isAfter) hit = s > today;
    // A date is midnight to the plugin, so today itself is already "before now".
    else if (r.isBefore) hit = s <= today;
    else if (!at) hit = false;
    else if (r.unit === 'hours') {
      const [lo, hi] = r.direction === 'before' ? [at.getTime(), now.getTime()] : [now.getTime(), at.getTime()];
      const hr = (ms: number): number => Math.floor(ms / 3_600_000);
      hit = hr(date.getTime()) >= hr(lo) && hr(date.getTime()) <= hr(hi);
    } else {
      const [lo, hi] = r.direction === 'before' ? [isoDay(at), today] : [today, isoDay(at)];
      hit = s >= lo && s <= hi;
    }
    if (hit) return { color: r.color || undefined, background: r.backgroundColor || undefined };
  }
  return null;
}

/** A card title as it reads in a list or a notification: a link shows its text. */
export function plainTitle(title: string): string {
  return title.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
}
