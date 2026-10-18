// The three Activity views: By day (a timeline with sticky day headers),
// By agent (one card per agent, grouped by agent class) and Summary (counts
// per action type, agent, source, time and node). Pure HTML builders; the
// page wires the clicks through data attributes.

import { attr, esc } from '../dom';
import { dayLabel, noteName } from '../format';
import { actRowHTML } from '../control/activity';
import { agentColor, avatarHTML } from '../control/agents';
import { verb, type ActivityItem } from '../control/feed';
import { ago, ICO, plural } from '../control/ui';
import { rowsSkeleton } from '../ui/skeleton';
import { CATS, CLASSES, SRCS, catOf, isoDay, timeWindow, type AgentInfo, type Cat } from './activity-model';

export interface ViewCtx {
  /** Filtered events, newest first. */
  rows: ActivityItem[];
  agents: AgentInfo[];
  fresh: Set<string>;
  /** Rows rendered in the day view. */
  limit: number;
  /** Collapse repeated calls by the same agent. */
  compact: boolean;
  /** The server may hold older events than the ones loaded. */
  older: boolean;
  /** Any filter or search narrows the list. */
  narrowed: boolean;
  /** Nothing at all is loaded (any filter, any range). */
  none: boolean;
}

export const CAT_COLOR: Record<Cat, string> = {
  read: 'var(--info)',
  search: 'var(--accent-2)',
  write: 'var(--ok)',
  delete: 'var(--danger)',
  auth: 'var(--warn)',
  other: 'var(--muted)',
};

const GO = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
export const CLOCK = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>';
const X = '<span class="x" aria-hidden="true"><svg class="cc-i" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg></span>';

/** A removable filter chip; `rm` is the `<facet>:<value>` it clears. */
export function chip(rm: string, label: string, lead = '', kind = ''): string {
  return `<button type="button" class="ax-chip" data-rm="${attr(rm)}" aria-label="${attr(`Remove filter: ${kind}${label}`)}">${lead}${
    kind ? `<span class="k">${esc(kind)}</span>` : ''
  }<span class="t">${esc(label)}</span>${X}</button>`;
}

/** A KPI tile; `v` is a number or preformatted number text. */
export function statTile(k: string, v: number | string, h: string, bad = false): string {
  return `<div class="cc-stat"><div class="k">${esc(k)}</div><div class="v"${bad ? ' style="color:var(--danger)"' : ''}>${v}</div><div class="h">${esc(h)}</div></div>`;
}

/** The address segment of an agent's own page: its key id, or a plain actor name. */
export function agentSlug(a: Pick<AgentInfo, 'id' | 'name'>): string | null {
  if (a.id && /^[A-Za-z0-9_-]{1,64}$/.test(a.id)) return a.id;
  return /^[A-Za-z0-9_-]{1,64}$/.test(a.name) ? a.name : null;
}

export function dayTitle(ts: number): { t: string; d: string } {
  const day = isoDay(ts);
  const today = isoDay(Date.now() / 1000);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yest = isoDay(y.getTime() / 1000);
  const full = dayLabel(ts);
  if (day === today) return { t: 'Today', d: full };
  if (day === yest) return { t: 'Yesterday', d: full };
  const d = new Date(ts * 1000);
  return { t: d.toLocaleDateString('en-US', { weekday: 'long' }), d: full };
}

// ── skeleton / empty ────────────────────────────────────────────────────

export function skeletonHTML(view: 'day' | 'agent' | 'board'): string {
  if (view === 'board')
    return `<div class="ax-board" aria-busy="true">${[0, 1, 2, 3]
      .map(() => `<div class="cc-card ax-skc">${rowsSkeleton(3, false)}</div>`)
      .join('')}</div>`;
  if (view === 'agent')
    return `<div class="ax-agrid" aria-busy="true">${[0, 1, 2, 3]
      .map(() => `<div class="cc-card ax-skc">${rowsSkeleton(1)}</div>`)
      .join('')}</div>`;
  return [6, 4]
    .map(
      (n) =>
        `<section class="ax-day" aria-busy="true"><div class="ax-dh"><span class="sk" style="width:90px;height:12px"></span><span class="grow"></span><span class="sk" style="width:60px;height:10px"></span></div>${rowsSkeleton(
          n,
        )}</section>`,
    )
    .join('');
}

function emptyHTML(c: ViewCtx): string {
  if (c.none)
    return `<div class="cc-card ax-empty"><span class="ax-empty-i">${ICO.search}</span><b>No activity in this range</b>
      <span>Agent calls, node changes and sign-ins appear here as they happen.</span>
      <button type="button" class="btn" data-time="all">Show all time</button></div>`;
  return `<div class="cc-card ax-empty"><span class="ax-empty-i">${ICO.filter}</span><b>Nothing matches</b>
    <span>${c.narrowed ? 'Try other words or remove a filter.' : 'Try a wider time range.'}</span>
    ${c.narrowed ? '<button type="button" class="btn" data-clear>Clear search and filters</button>' : ''}</div>`;
}

// ── by day ──────────────────────────────────────────────────────────────

interface Burst {
  it: ActivityItem;
  n: number;
  first: number;
}

/** Collapse consecutive calls by the same agent and action within 2 minutes. */
function bursts(rows: ActivityItem[]): Burst[] {
  const out: Burst[] = [];
  for (const x of rows) {
    const b = out[out.length - 1];
    if (b && b.it.actor === x.actor && b.it.action === x.action && b.first - x.ts < 120 && isoDay(b.first) === isoDay(x.ts)) {
      b.n++;
      b.first = x.ts;
      const paths = [...new Set([...b.it.paths, ...x.paths])];
      b.it = { ...b.it, paths, ok: b.it.ok === false || x.ok === false ? false : b.it.ok };
      continue;
    }
    out.push({ it: x, n: 1, first: x.ts });
  }
  return out;
}

function burstSpan(b: Burst): string {
  const s = Math.max(1, Math.round(b.it.ts - b.first));
  return s < 60 ? s + 's' : Math.round(s / 60) + 'm';
}

function rowHTML(b: Burst, fresh: Set<string>): string {
  return actRowHTML(b.it, {
    fresh: fresh.has(b.it.id),
    extra: b.n > 1 ? `<span class="act-burst" title="${b.n} calls in a row">×${b.n} in ${burstSpan(b)}</span>` : '',
  });
}

export function dayViewHTML(c: ViewCtx): string {
  if (!c.rows.length) return emptyHTML(c);
  // Per day totals over every filtered row, so a header is exact even when
  // only the first part of that day is rendered.
  const perDay = new Map<string, { n: number; f: number }>();
  for (const x of c.rows) {
    const k = isoDay(x.ts);
    const s = perDay.get(k) || { n: 0, f: 0 };
    s.n++;
    if (x.ok === false) s.f++;
    perDay.set(k, s);
  }
  const groups = c.compact ? bursts(c.rows) : c.rows.map((it) => ({ it, n: 1, first: it.ts }));
  const cap = groups.slice(0, c.limit);
  let html = '';
  let cur = '';
  for (const b of cap) {
    const k = isoDay(b.it.ts);
    if (k !== cur) {
      if (cur) html += '</div></section>';
      cur = k;
      const t = dayTitle(b.it.ts);
      const s = perDay.get(k)!;
      html += `<section class="ax-day" data-day="${k}" aria-label="${attr(t.t)}"><h2 class="ax-dh"><span class="ax-dh-t">${esc(
        t.t,
      )}</span><span class="ax-dh-d">${esc(t.d)}</span><span class="grow"></span><span class="ax-dh-n">${plural(s.n, 'event')}${
        s.f ? `<span class="ax-dh-f">${s.f} failed</span>` : ''
      }</span></h2><div class="act-list">`;
    }
    html += rowHTML(b, c.fresh);
  }
  if (cur) html += '</div></section>';
  const left = groups.length - cap.length;
  if (left > 0)
    html += `<div class="ax-more"><button type="button" class="btn" data-more>Show more<span class="cc-muted">${left} left</span></button></div>`;
  else if (c.older)
    html += `<div class="ax-more"><button type="button" class="btn" data-older>Load older events</button></div>`;
  else html += `<div class="ax-end">${plural(c.rows.length, 'event')} · start of the selected range</div>`;
  return html;
}

// ── by agent ────────────────────────────────────────────────────────────

function sparkBars(rows: ActivityItem[], n = 24): string {
  if (!rows.length) return '';
  const w = timeWindow();
  const now = Date.now() / 1000;
  const until = Number.isFinite(w.until) ? Math.min(w.until, now) : now;
  const since = w.since > 0 ? w.since : Math.min(...rows.map((r) => r.ts));
  const span = Math.max(60, until - since);
  const b = new Array(n).fill(0);
  rows.forEach((r) => {
    const i = Math.min(n - 1, Math.max(0, Math.floor(((r.ts - since) / span) * n)));
    b[i]++;
  });
  const max = Math.max(1, ...b);
  return `<span class="ax-spark" aria-hidden="true">${b
    .map((v) => `<i style="height:${v ? Math.max(12, Math.round((v / max) * 100)) : 4}%"${v ? '' : ' class="z"'}></i>`)
    .join('')}</span>`;
}

export function clsPill(a: AgentInfo): string {
  const lbl = CLASSES.find((c) => c.id === a.cls)!.label;
  return `<span class="ax-cls ${a.cls}">${a.cls === 'active' ? '<span class="cc-dot ok"></span>' : ''}${esc(
    a.cls === 'recent' ? 'Recent' : a.cls === 'removed' ? 'Removed key' : a.cls === 'people' ? (/^(gateway|system)$/i.test(a.name) ? 'System' : 'Person') : lbl,
  )}</span>${a.disabled ? '<span class="ax-cls off">Disabled</span>' : ''}`;
}

function lastLine(a: AgentInfo): string {
  if (a.last)
    return `<span class="ax-ag-last"><b>${esc(verb(a.last.action))}</b>${
      a.last.label || a.last.paths[0] ? ` ${esc(a.last.label || noteName(a.last.paths[0]))}` : ''
    } · ${esc(ago(a.last.ts))}</span>`;
  return `<span class="ax-ag-last">${a.lastTs ? `Last seen ${esc(ago(a.lastTs))}` : 'No activity yet'}</span>`;
}

export function agentViewHTML(c: ViewCtx): string {
  const byActor = new Map<string, ActivityItem[]>();
  c.rows.forEach((x) => {
    if (!byActor.has(x.actor)) byActor.set(x.actor, []);
    byActor.get(x.actor)!.push(x);
  });
  // Keys without events in the range still get a card (dimmed) unless the
  // list is narrowed by a filter or a search.
  const shown = c.agents.filter((a) => byActor.has(a.name) || (!c.narrowed && a.id && a.cls !== 'removed' && a.cls !== 'people'));
  if (!shown.length) return emptyHTML(c);
  let html = '';
  for (const cl of CLASSES) {
    const list = shown.filter((a) => a.cls === cl.id);
    if (!list.length) continue;
    html += `<div class="ax-sec"><h2 class="ax-sec-t">${esc(cl.label)}<span class="n">${list.length}</span></h2><div class="ax-agrid">`;
    for (const a of list) {
      const rows = byActor.get(a.name) || [];
      const fails = rows.filter((x) => x.ok === false).length;
      const nodes = new Set(rows.flatMap((x) => x.paths)).size;
      const slug = agentSlug(a);
      // Every card opens the agent's own page; an actor whose name cannot be
      // an address filters the timeline instead.
      const open = slug
        ? `<a class="cc-card ax-ag${rows.length ? '' : ' dim'}" href="/activity/${attr(encodeURIComponent(slug))}" data-go="${attr(slug)}"`
        : `<button type="button" class="cc-card ax-ag${rows.length ? '' : ' dim'}" data-only="${attr(a.name)}"`;
      html += `${open} data-vt-card data-agent="${attr(a.name)}" style="--ag:${agentColor(a.name, a.id)}" aria-label="${attr(
        `${a.name}: ${plural(rows.length, 'event')}${slug ? '. Open its activity' : ''}`,
      )}">
        <span class="ax-ag-h">
          <span class="ax-ag-av" data-vt-av>${avatarHTML(a.name, 42, a.cls === 'active' ? 'live' : '', a.id)}</span>
          <span class="ax-ag-id"><span class="ax-ag-n"><b class="ax-ag-nm" data-vt-nm>${esc(a.name)}</b>${clsPill(a)}</span>${lastLine(a)}</span>
          <span class="ax-go">${slug ? GO : ICO.filter}</span>
        </span>
        <span class="ax-ag-stats"><span><b>${rows.length}</b> ${rows.length === 1 ? 'event' : 'events'}</span><span${
          fails ? ' class="bad"' : ''
        }><b>${fails}</b> failed</span><span><b>${nodes}</b> ${nodes === 1 ? 'node' : 'nodes'}</span>${sparkBars(rows)}</span>
      ${slug ? '</a>' : '</button>'}`;
    }
    html += '</div></div>';
  }
  return html;
}

// ── summary board ───────────────────────────────────────────────────────

export function bars(items: { key: string; label: string; n: number; color: string; lead?: string; f: string }[], total: number): string {
  if (!items.length) return '<div class="ax-bempty">Nothing in this range</div>';
  const max = Math.max(1, ...items.map((x) => x.n));
  return `<div class="ax-hbs">${items
    .map(
      (x) => `<button type="button" class="ax-hb" data-f="${attr(x.f)}" style="--c:${x.color}" title="Show only ${attr(x.label)}">
        <span class="ax-hb-l">${x.lead || `<i class="sw"></i>`}<span class="t">${esc(x.label)}</span></span>
        <span class="ax-hb-n">${x.n}<em>${total ? Math.round((x.n / total) * 100) : 0}%</em></span>
        <span class="ax-hb-track"><span style="width:${Math.max(2, (x.n / max) * 100)}%"></span></span></button>`,
    )
    .join('')}</div>`;
}

export function timeChart(rows: ActivityItem[], win?: { since: number; until: number }): string {
  if (!rows.length) return '<div class="ax-bempty">Nothing in this range</div>';
  const w = win || timeWindow();
  const now = Date.now() / 1000;
  const until = Number.isFinite(w.until) ? Math.min(w.until, now) : now;
  const since = w.since > 0 ? w.since : Math.min(...rows.map((r) => r.ts));
  const span = until - since;
  const hourly = span <= 2 * 86400;
  const step = hourly ? 3600 : 86400;
  // Align buckets to local hours / days.
  const start = new Date(since * 1000);
  if (hourly) start.setMinutes(0, 0, 0);
  else start.setHours(0, 0, 0, 0);
  const s0 = start.getTime() / 1000;
  const n = Math.min(hourly ? 48 : 62, Math.max(1, Math.ceil((until - s0) / step)));
  const first = until - n * step < s0 ? s0 : s0 + (Math.ceil((until - s0) / step) - n) * step;
  const b = new Array(n).fill(0);
  const fb = new Array(n).fill(0);
  rows.forEach((r) => {
    const i = Math.floor((r.ts - first) / step);
    if (i >= 0 && i < n) {
      b[i]++;
      if (r.ok === false) fb[i]++;
    }
  });
  const max = Math.max(1, ...b);
  const lbl = (i: number): string => {
    const d = new Date((first + i * step) * 1000);
    return hourly
      ? d.toLocaleTimeString('en-US', { hour: 'numeric' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return `<div class="ax-cols" role="img" aria-label="Events per ${hourly ? 'hour' : 'day'}">${b
    .map(
      (v, i) =>
        `<span class="ax-col" title="${attr(`${lbl(i)}: ${plural(v, 'event')}${fb[i] ? `, ${fb[i]} failed` : ''}`)}"><i style="height:${
          v ? Math.max(4, (v / max) * 100) : 0
        }%"><b style="height:${v ? (fb[i] / v) * 100 : 0}%"></b></i></span>`,
    )
    .join('')}</div><div class="ax-ticks">${ticks.map((i) => `<span>${esc(lbl(i))}</span>`).join('')}</div>`;
}

export function boardViewHTML(c: ViewCtx): string {
  const rows = c.rows;
  if (!rows.length) return emptyHTML(c);
  const fails = rows.filter((x) => x.ok === false).length;
  const actors = new Map<string, number>();
  const cats = new Map<Cat, number>();
  const srcs = new Map<string, number>();
  const nodes = new Map<string, number>();
  const acts = new Map<string, number>();
  for (const x of rows) {
    actors.set(x.actor, (actors.get(x.actor) || 0) + 1);
    cats.set(catOf(x), (cats.get(catOf(x)) || 0) + 1);
    srcs.set(x.source, (srcs.get(x.source) || 0) + 1);
    acts.set(x.action, (acts.get(x.action) || 0) + 1);
    x.paths.forEach((p) => nodes.set(p, (nodes.get(p) || 0) + 1));
  }
  const info = new Map(c.agents.map((a) => [a.name, a]));
  const topNodes = [...nodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topActs = [...acts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return `<div class="cc-stats ax-tiles">
      ${statTile('Events', rows.length, `${plural(new Set(rows.map((x) => isoDay(x.ts))).size, 'day')} with activity`)}
      ${statTile('Agents', actors.size, `${[...actors.keys()].filter((a) => info.get(a)?.cls === 'active').length} active now`)}
      ${statTile('Failed', fails, rows.length ? `${Math.round((fails / rows.length) * 100)}% of events` : '', fails > 0)}
      ${statTile('Nodes touched', nodes.size, topNodes[0] ? `Most: ${noteName(topNodes[0][0])}` : 'None')}
    </div>
    <div class="ax-board">
      <section class="cc-card ax-bc ax-wide"><div class="cc-card-h"><h2>Over time</h2><span class="grow"></span><span class="sub"><i class="ax-key"></i>failed</span></div>
        <div class="cc-card-b">${timeChart(rows)}</div></section>
      <section class="cc-card ax-bc"><div class="cc-card-h"><h2>Action types</h2></div><div class="cc-card-b">${bars(
        CATS.filter((k) => cats.get(k.id)).map((k) => ({ key: k.id, label: k.label, n: cats.get(k.id)!, color: CAT_COLOR[k.id], f: 'cats:' + k.id })),
        rows.length,
      )}</div></section>
      <section class="cc-card ax-bc"><div class="cc-card-h"><h2>Agents</h2></div><div class="cc-card-b">${bars(
        [...actors.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([a, n]) => ({ key: a, label: a, n, color: agentColor(a, info.get(a)?.id), lead: avatarHTML(a, 22, '', info.get(a)?.id), f: 'agents:' + a })),
        rows.length,
      )}</div></section>
      <section class="cc-card ax-bc"><div class="cc-card-h"><h2>Top actions</h2></div><div class="cc-card-b">${bars(
        topActs.map(([a, n]) => ({
          key: a,
          label: verb(a),
          n,
          color: CAT_COLOR[catOf(rows.find((x) => x.action === a)!)],
          f: 'actions:' + a,
        })),
        rows.length,
      )}</div></section>
      <section class="cc-card ax-bc"><div class="cc-card-h"><h2>Sources</h2></div><div class="cc-card-b">${bars(
        SRCS.filter((s) => srcs.get(s.id)).map((s) => ({ key: s.id, label: `${s.label} · ${s.hint}`, n: srcs.get(s.id)!, color: 'var(--accent)', f: 'srcs:' + s.id })),
        rows.length,
      )}</div></section>
      <section class="cc-card ax-bc ax-wide"><div class="cc-card-h"><h2>Most touched nodes</h2></div>${
        topNodes.length
          ? `<div class="ax-nodes">${topNodes
              .map(
                ([p, n]) =>
                  `<button type="button" class="ax-node" data-note="${attr(p)}" title="${attr(p)}">${ICO.note}<span class="t"><span>${esc(
                    noteName(p),
                  )}</span><small>${esc(p)}</small></span><span class="n">${n}×</span></button>`,
              )
              .join('')}</div>`
          : '<div class="cc-card-b"><div class="ax-bempty">No nodes were touched in this range</div></div>'
      }</section>
    </div>`;
}
