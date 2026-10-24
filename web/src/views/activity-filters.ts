// The Activity filter sheet. Changes apply at once; each group's counts ignore its own selection.

import { attr, esc } from '../dom';
import { agentColor, avatarHTML } from '../control/agents';
import type { ActivityItem, Source } from '../control/feed';
import { actionLabel, isSystem } from '../control/sentence';
import { ago, ICO, openDrawer, plural } from '../control/ui';
import {
  CATS,
  CLASSES,
  F,
  SRCS,
  STATUSES,
  TIMES,
  catOf,
  clearFilters,
  isoDay,
  matches,
  stOf,
  type AgentInfo,
  type Cat,
  type St,
  type TimeKey,
} from './activity-model';
import { CAT_COLOR } from './activity-views';

interface SheetCtx {
  /** Events of the selected time range (before the other filters). */
  scoped(): ActivityItem[];
  agents(): AgentInfo[];
  /** `time` needs a reload from the server, `local` only a repaint. */
  changed(kind: 'time' | 'local'): void;
}

let sheet: { d: HTMLElement; ctx: SheetCtx } | null = null;
let actionsOpen = false;

const CSS_CHECK = '<svg class="cc-i ax-ck" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>';

export function count<T>(rows: ActivityItem[], key: (x: ActivityItem) => T): Map<T, number> {
  const m = new Map<T, number>();
  rows.forEach((x) => m.set(key(x), (m.get(key(x)) || 0) + 1));
  return m;
}

export function opt(kind: string, v: string, label: string, pressed: boolean, n?: number, lead = '', hint = ''): string {
  return `<button type="button" class="ax-opt" data-k="${kind}" data-v="${attr(v)}" aria-pressed="${pressed}"${
    hint ? ` title="${attr(hint)}"` : ''
  }>${lead}<span class="t">${esc(label)}</span>${n != null ? `<span class="n">${n}</span>` : ''}</button>`;
}

function bodyHTML(ctx: SheetCtx): string {
  const scoped = ctx.scoped();
  const st = count(
    scoped.filter((x) => matches(x, 'status')),
    stOf,
  );
  const catRows = scoped.filter((x) => matches(x, 'cats'));
  const cats = count(catRows, catOf);
  const acts = count(catRows, (x) => x.action);
  const srcs = count(
    scoped.filter((x) => matches(x, 'srcs')),
    (x) => x.source,
  );
  const agN = count(
    scoped.filter((x) => matches(x, 'agents')),
    (x) => x.actor,
  );
  const sysN = scoped.filter((x) => isSystem(x)).length;
  const today = isoDay(Date.now() / 1000);
  const actList = [...acts.entries()].sort((a, b) => b[1] - a[1]);
  F.actions.forEach((a) => acts.has(a) || actList.push([a, 0]));
  const agents = ctx.agents();
  let agHTML = '';
  for (const cl of CLASSES) {
    const list = agents.filter((a) => a.cls === cl.id);
    if (!list.length) continue;
    agHTML += `<div class="ax-agc">${esc(cl.label)}</div>${list
      .map((a) => {
        const n = agN.get(a.name) || 0;
        const on = F.agents.has(a.name);
        return `<button type="button" class="ax-agopt" data-k="agents" data-v="${attr(a.name)}" data-name="${attr(
          a.name.toLowerCase(),
        )}" aria-pressed="${on}" style="--ag:${agentColor(a.name, a.id)}">${avatarHTML(a.name, 30, a.cls === 'active' ? 'live' : '', a.id)}
          <span class="t"><b>${esc(a.name)}</b><small>${
            a.lastTs ? `Last seen ${esc(ago(a.lastTs))}` : 'No activity yet'
          }${a.disabled ? ' · turned off' : ''}</small></span><span class="n">${n}</span><span class="ax-box">${CSS_CHECK}</span></button>`;
      })
      .join('')}`;
  }
  return `<div class="ax-fs">
    <section class="ax-fg"><h3>Time</h3>
      <div class="ax-opts">${TIMES.map((t) => opt('time', t.id, t.label, F.time === t.id)).join('')}</div>
      <div class="ax-range${F.time === 'custom' ? ' on' : ''}">
        <label><span>From</span><input type="date" data-date="from" value="${attr(F.from)}" max="${today}"></label>
        <label><span>To</span><input type="date" data-date="to" value="${attr(F.to)}" max="${today}"></label>
      </div>
    </section>
    <section class="ax-fg"><h3>Result</h3>
      <div class="ax-opts">${STATUSES.map((s) =>
        opt('status', s.id, s.label, F.status.has(s.id), st.get(s.id) || 0, `<span class="cc-dot ${s.id === 'fail' ? 'err' : s.id === 'running' ? 'run' : 'ok'}"></span>`),
      ).join('')}</div>
    </section>
    <section class="ax-fg"><h3>What</h3>
      <div class="ax-opts">${CATS.filter((c) => c.id !== 'other' || cats.get(c.id) || F.cats.has(c.id)).map((c) =>
        opt('cats', c.id, c.label, F.cats.has(c.id), cats.get(c.id) || 0, `<i class="sw" style="--c:${CAT_COLOR[c.id]}"></i>`, c.hint),
      ).join('')}</div>
      ${
        actList.length
          ? `<details class="ax-acts"${actionsOpen || F.actions.size ? ' open' : ''}><summary>Specific actions<span class="n">${actList.length}</span></summary>
        <div class="ax-opts">${actList
          .map(([a, n]) => opt('actions', a, actionLabel(a, catRows.find((x) => x.action === a)?.source), F.actions.has(a), n, '', a))
          .join('')}</div></details>`
          : ''
      }
    </section>
    <section class="ax-fg"><h3>Where it came from</h3>
      <div class="ax-opts">${SRCS.map((s) => opt('srcs', s.id, s.label, F.srcs.has(s.id), srcs.get(s.id) || 0, '', s.hint)).join('')}</div>
      <div class="ax-opts ax-sysopt">${opt(
        'system',
        '1',
        'Include system lines',
        F.system,
        sysN,
        '',
        'Server and sign-in events, the console, and note saves that repeat an AI’s own action',
      )}</div>
    </section>
    <section class="ax-fg"><h3>AIs and people${F.agents.size ? `<button type="button" class="ax-lnk" data-k="agents-clear">Everyone</button>` : ''}</h3>
      ${
        agents.length > 6
          ? `<label class="ax-agq">${ICO.search}<span class="sr-only">Find an AI</span><input type="search" placeholder="Find an AI" autocomplete="off"></label>`
          : ''
      }
      <div class="ax-aglist">${agHTML || '<div class="cc-muted" style="font-size:13px">No AIs yet</div>'}</div>
    </section>
  </div>`;
}

function paint(): void {
  if (!sheet) return;
  const { d, ctx } = sheet;
  const b = d.querySelector<HTMLElement>('.cc-drawer-b')!;
  const top = b.scrollTop;
  const q = d.querySelector<HTMLInputElement>('.ax-agq input')?.value || '';
  b.innerHTML = bodyHTML(ctx);
  b.scrollTop = top;
  const qi = d.querySelector<HTMLInputElement>('.ax-agq input');
  if (qi) {
    qi.value = q;
    filterAgents(d, q);
    qi.oninput = () => filterAgents(d, qi.value);
  }
  const det = d.querySelector<HTMLDetailsElement>('.ax-acts');
  if (det) det.ontoggle = () => (actionsOpen = det.open);
  d.querySelectorAll<HTMLInputElement>('[data-date]').forEach((inp) => {
    inp.onchange = () => {
      if (inp.dataset.date === 'from') F.from = inp.value;
      else F.to = inp.value;
      if (F.from && F.to && F.from > F.to) [F.from, F.to] = [F.to, F.from];
      F.time = F.from || F.to ? 'custom' : '7d';
      ctx.changed('time');
      paint();
    };
  });
  const n = ctx.scoped().filter((x) => matches(x)).length;
  const done = d.querySelector<HTMLElement>('[data-done]');
  if (done) done.textContent = `Show ${plural(n, 'action')}`;
  const sub = d.querySelector<HTMLElement>('.cc-drawer-h .s');
  if (sub) sub.textContent = `${n} of ${plural(ctx.scoped().length, 'action')} match`;
}

function filterAgents(d: HTMLElement, q: string): void {
  const s = q.trim().toLowerCase();
  d.querySelectorAll<HTMLElement>('.ax-agopt').forEach((b) => (b.hidden = !!s && !b.dataset.name!.includes(s)));
}

export function toggle<T>(set: Set<T>, v: T): void {
  if (set.has(v)) set.delete(v);
  else set.add(v);
}

/** Re-render the open sheet (after a reload or a live event). */
export function refreshFilters(): void {
  if (sheet && document.body.contains(sheet.d)) paint();
  else sheet = null;
}

export function openFilters(ctx: SheetCtx): void {
  const d = openDrawer({
    title: 'Filters',
    sub: ' ',
    body: '',
    foot: `<button type="button" class="btn ghost" data-reset>Reset</button><span style="flex:1"></span><button type="button" class="btn primary" data-done>Show actions</button>`,
  });
  d.classList.add('ax-sheet');
  sheet = { d, ctx };
  paint();
  d.onclick = (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-k],[data-reset],[data-done]');
    if (!t) return;
    if (t.hasAttribute('data-done')) {
      (d.querySelector('[data-x]') as HTMLElement).click();
      return;
    }
    if (t.hasAttribute('data-reset')) {
      const timeChanged = F.time !== '7d';
      clearFilters();
      ctx.changed(timeChanged ? 'time' : 'local');
      paint();
      return;
    }
    const k = t.dataset.k!;
    const v = t.dataset.v || '';
    if (k === 'time') {
      F.time = v as TimeKey;
      F.from = F.to = '';
      ctx.changed('time');
    } else {
      if (k === 'status') toggle(F.status, v as St);
      else if (k === 'cats') toggle(F.cats, v as Cat);
      else if (k === 'actions') toggle(F.actions, v);
      else if (k === 'srcs') toggle(F.srcs, v as Source);
      else if (k === 'agents') toggle(F.agents, v);
      else if (k === 'agents-clear') F.agents.clear();
      else if (k === 'system') F.system = !F.system;
      ctx.changed('local');
    }
    paint();
    // The body was re-rendered: keep keyboard focus on the same option.
    d.querySelector<HTMLElement>(`[data-k="${k}"]${v ? `[data-v="${window.CSS.escape(v)}"]` : ''}`)?.focus({ preventScroll: true });
  };
}
