// Activity rows and the detail drawer, shared by Overview and Activity.

import { apiGet, apiPost } from '../api';
import { attr, esc, useStyles } from '../dom';
import { fmtTs, noteName } from '../format';
import { hooks } from '../hooks';
import { setKeysRoute } from '../router';
import { allNotes, state } from '../state';
import { toast } from '../toast';
import { agentColor, avatarHTML, keyExists } from './agents';
import { settleRunning, type ActivityItem } from './feed';
import {
  burstPredicate,
  folderName,
  folderOf,
  isSystem,
  kindOf,
  plainText,
  predicate,
  problemOf,
  spanText,
  titleOf,
  undoPlan,
  whoOf,
  type Burst,
} from './sentence';
import { ago, clock, copyText, ICO, openDrawer, closeDrawer } from './ui';

const CSS = `
.act-list{display:flex;flex-direction:column}
.act{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 12px;align-items:start;padding:10px 16px;
  border-top:1px solid var(--line);cursor:pointer;text-align:left;width:100%;position:relative;transition:background .14s}
.act:first-child{border-top:0}
.act:hover{background:color-mix(in srgb,var(--panel-2) 70%,transparent)}
.act:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.act.new{animation:actIn .6s var(--ease)}
@keyframes actIn{from{background:color-mix(in srgb,var(--ag) 16%,transparent)}to{background:transparent}}
.act .av{padding-top:1px}
.act-l1{display:block;min-width:0;font-size:13.5px;line-height:1.5;color:var(--fg);overflow-wrap:anywhere}
.act-who{font-weight:680;color:var(--ag)}
:root[data-theme=light] .act-who{color:color-mix(in srgb,var(--ag) 62%,#0f172a)}
.act-who.go{all:unset;font-weight:680;color:var(--ag);cursor:pointer;border-radius:4px}
:root[data-theme=light] .act-who.go{color:color-mix(in srgb,var(--ag) 62%,#0f172a)}
.act-who.go:hover{text-decoration:underline;text-underline-offset:2px}
.act-who.go:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.act-p{color:var(--fg)}
.act-p.cap{display:inline-block}
.act-p.cap::first-letter{text-transform:uppercase}
.act-n{font-style:normal;font-weight:600;color:var(--fg)}
button.act-n{all:unset;font-weight:600;color:var(--fg);cursor:pointer;border-radius:4px;text-decoration:underline;
  text-decoration-color:color-mix(in srgb,var(--fg) 25%,transparent);text-underline-offset:3px}
button.act-n:hover{color:var(--accent);text-decoration-color:currentColor}
button.act-n:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.act-d{color:var(--muted)}
.act.sys .act-p{color:var(--muted)}
.act-l2{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.act-note{display:inline-flex;align-items:center;gap:5px;max-width:240px;font-size:11.5px;font-weight:600;padding:2px 8px 2px 6px;
  border-radius:6px;background:var(--panel-2);border:1px solid transparent;color:var(--fg)}
.act-note:hover{background:var(--surface-3);color:var(--accent)}
.act-note .cc-i{width:12px;height:12px;color:var(--muted)}
.act-note span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.act-meta{display:flex;flex-direction:column;align-items:flex-end;gap:3px;font-size:12.5px;color:var(--muted);white-space:nowrap;
  font-variant-numeric:tabular-nums}
.act-st{display:inline-flex;align-items:center;gap:5px}
.act-st.bad{color:var(--danger);font-weight:600}
.act-st.ok{color:var(--ok);font-weight:600}
.act-src{font-size:11px;font-weight:600;color:var(--muted)}
.act-more{display:inline-flex;font-size:11.5px;color:var(--muted);padding:2px 4px}
.act-undo{font-size:12px;font-weight:600;color:var(--accent);padding:3px 9px;border-radius:6px;border:1px solid var(--line-strong);background:transparent}
.act-undo:hover{background:var(--accent-soft)}
.act-undo:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.act-x{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:650;color:var(--fg);padding:3px 6px 3px 9px;border-radius:6px;
  border:1px solid transparent;background:var(--panel-2)}
.act-x:hover{background:var(--surface-3)}
.act-x:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.act-x .act-span{color:var(--muted);font-weight:550}
.act-chev{width:14px;height:14px;color:var(--muted);transition:transform .16s}
.act-x[aria-expanded=true] .act-chev{transform:rotate(180deg)}
.act-kids{border-top:1px solid var(--line);background:color-mix(in srgb,var(--panel-2) 55%,var(--panel))}
.act.kid{padding-top:7px;padding-bottom:7px;min-height:0 !important;border-top:1px dashed var(--line)}
.act.kid:first-child{border-top:0}
.act.kid .av{width:30px}
.act.kid .act-l1{font-size:12.8px}
@media (prefers-reduced-motion:reduce){.act-chev{transition:none}.act.new{animation:none}}
@media (max-width:760px){
  .act{padding:11px 16px;gap:3px 10px}
  .act-note{max-width:180px}
}
.adr-hero{display:flex;gap:12px;align-items:center;margin-bottom:20px}
.adr-hero .v{font-size:15px;font-weight:400;line-height:1.5}
.adr-hero .v b{font-weight:650}
.ad-res{display:inline-flex;align-items:center;gap:7px;font-weight:600}
.ad-res .cc-dot{width:7px;height:7px}
.ad-res.ok{color:var(--ok)}
.ad-res.err{color:var(--danger)}
.ad-res.acc{color:var(--accent)}
.ad-sec{margin:24px 0 8px;font-size:14px;font-weight:650;color:var(--fg)}
.ad-sec .n{font-weight:500;color:var(--muted)}
.ad-notes{display:flex;flex-direction:column;margin:0 -8px}
.ad-notes button{display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;text-align:left;font-size:13.5px;font-weight:500}
.ad-notes button:hover{background:var(--hover)}
.ad-notes button>.cc-i{color:var(--muted)}
.ad-notes small{display:block;color:var(--muted);font-size:12px;font-family:var(--mono)}
.ad-tech{margin-top:24px;border-top:1px solid var(--line);padding-top:12px}
.ad-tech summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--muted);padding:4px 0}
.ad-tech summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.ad-tech[open] summary{margin-bottom:8px}
.ad-json{margin-top:12px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.ad-json-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 6px 6px 12px;border-bottom:1px solid var(--line);
  font:600 11.5px/1 var(--font);letter-spacing:.02em;color:var(--muted);background:color-mix(in srgb,var(--fg) 3%,transparent)}
.ad-json-h .btn{height:28px;padding:0 10px;font-size:12px;gap:6px}
.ad-json .ad-raw{margin:0;border:0;border-radius:0}
.ad-raw{margin:10px 0 0;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:11px 12px;font-family:var(--mono);
  font-size:11.5px;line-height:1.55;overflow:auto;max-height:260px;white-space:pre-wrap;word-break:break-word}
:root[data-theme=light] .ad-raw{background:#f8f9fb}
`;

export function useActivityStyles(): void {
  useStyles('cc-act-css', CSS);
}

/** Only what a person needs on the row: working, refused or did not work. */
function statusHTML(it: ActivityItem): string {
  if (settleRunning(it)) return '<span class="act-st"><span class="cc-dot run"></span>Working…</span>';
  const p = problemOf(it);
  if (p === 'refused') return '<span class="act-st bad"><span class="cc-dot err"></span>Refused</span>';
  if (p === 'failed') return '<span class="act-st bad"><span class="cc-dot err"></span>Did not work</span>';
  return '';
}

function fmtMs(ms: number): string {
  return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
}

/** Where a system line comes from, shown only on those rows. */
function sysTag(it: ActivityItem): string {
  if (!isSystem(it)) return '';
  const t = it.source === 'auth' ? 'Sign-in & keys' : it.echo ? 'Note change' : 'Server';
  return `<span class="act-src">${t}</span>`;
}

/** The signed-in person's name, so their own rows read "You". */
export function myName(): string {
  return (state.me && (state.me.user || state.me.username)) || '';
}

/** Ids of rows whose change was undone in this visit. */
export const undone = new Set<string>();

interface RowOpts {
  fresh?: boolean;
  /** A run of similar calls shown as this one row. */
  burst?: Burst;
  /** The burst is expanded (its calls listed under it). */
  open?: boolean;
  /** Offer Undo on this row. */
  undo?: boolean;
  /** Just the sentence and the time (Overview): no burst toggle, chips or Undo. */
  compact?: boolean;
}

function chipsHTML(it: ActivityItem, skip: number): string {
  const paths = it.paths.slice(skip, skip + 3);
  if (!paths.length) return '';
  return `<span class="act-l2">${paths
    .map(
      (p) =>
        `<button type="button" class="act-note" data-note="${attr(p)}" title="${attr(p)}">${ICO.note}<span>${esc(titleOf(p))}</span></button>`,
    )
    .join('')}${it.paths.length > skip + 3 ? `<span class="act-more">+${it.paths.length - skip - 3}</span>` : ''}</span>`;
}

/** How many leading paths the sentence already names (the rest show as chips). */
function named(it: ActivityItem): number {
  const k = kindOf(it);
  if (k === 'searched' && it.action !== 'find_path') return 0;
  if (k === 'moved' && it.paths.length >= 2) return 2;
  // A read note's links and a browse listing are what it saw, not what it touched.
  if (k === 'read') return it.action === 'read_memory' || it.action === 'export_memory' || it.action === 'validate_memory' ? it.paths.length : /^(get_neighbors|get_subgraph|get_history|get_note_at|diff)$/.test(it.action) ? 1 : 0;
  return 1;
}

/** One activity row: the AI's colour and avatar, then what it did as a sentence. */
export function actRowHTML(it: ActivityItem, opts: RowOpts = {}): string {
  const kid = typeof it.raw.actor_id === 'string' ? it.raw.actor_id : null;
  const c = agentColor(it.actor, kid);
  settleRunning(it);
  const b = opts.burst && opts.burst.items.length > 1 ? opts.burst : null;
  const who = whoOf(it, myName());
  const pred = b ? burstPredicate(b) : predicate(it);
  const text = `${who} ${plainText(pred)}`;
  const whoHTML =
    kid && who !== 'You' && keyExists(kid) !== false
      ? `<button type="button" class="act-who go" data-agent-page="${attr(kid)}" title="${attr(`Open ${it.actor}'s page`)}">${esc(who)}</button>`
      : `<span class="act-who">${esc(who)}</span>`;
  const more = opts.compact
    ? ''
    : b
    ? `<span class="act-l2"><button type="button" class="act-x" data-burst="${attr(it.id)}" aria-expanded="${!!opts.open}" aria-label="${attr(
        `${opts.open ? 'Hide' : 'Show'} the ${b.items.length} actions: ${text}`,
      )}">${opts.open ? 'Hide' : 'Show'} all ${b.items.length}<span class="act-span">· ${spanText(b.span)}</span>${CHEV}</button></span>`
    : chipsHTML(it, named(it));
  const undo = undone.has(it.id)
    ? '<span class="act-st ok">Undone</span>'
    : opts.undo && !b
      ? `<button type="button" class="act-undo" data-undo="${attr(it.id)}" aria-label="${attr('Undo: ' + text)}">Undo</button>`
      : '';
  const row = `<div class="act${problemOf(it) ? ' fail' : ''}${opts.fresh ? ' new' : ''}${isSystem(it) ? ' sys' : ''}" role="button" tabindex="0" data-act="${attr(
    it.id,
  )}" style="--ag:${c}" aria-label="${attr(text)}">
    <span class="av">${avatarHTML(it.actor, 30, it.running ? 'live' : '', kid)}</span>
    <span style="min-width:0"><span class="act-l1">${whoHTML} <span class="act-p">${pred}</span></span>${more}</span>
    <span class="act-meta"><span title="${attr(fmtTs(it.ts))}">${clock(it.ts)} · ${ago(it.ts)}</span>${statusHTML(it)}${undo}${sysTag(it)}</span>
  </div>`;
  if (!b || !opts.open || opts.compact) return row;
  return `${row}<div class="act-kids" role="group" aria-label="${attr(text)}">${b.items.map(kidRowHTML).join('')}</div>`;
}

/** One call inside an expanded burst: the sentence without the name. */
function kidRowHTML(it: ActivityItem): string {
  const pred = predicate(it);
  const text = `${whoOf(it, myName())} ${plainText(pred)}`;
  return `<div class="act kid" role="button" tabindex="0" data-act="${attr(it.id)}" aria-label="${attr(text)}">
    <span class="av"></span><span style="min-width:0"><span class="act-l1"><span class="act-p cap">${pred}</span></span>${chipsHTML(it, named(it))}</span>
    <span class="act-meta"><span title="${attr(fmtTs(it.ts))}">${clock(it.ts)}</span></span></div>`;
}

const CHEV = '<svg class="cc-i act-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

const noteExists = (p: string): boolean => allNotes().some((n) => n.path === p);

/** Run an Undo. Every outcome is told; true when it worked. */
export async function runUndo(it: ActivityItem): Promise<boolean> {
  const plan = undoPlan(it, noteExists);
  if (!plan) {
    toast('This can no longer be undone: the note has changed since.', 'warn');
    return false;
  }
  try {
    if (plan.type === 'moveBack') {
      const back = folderOf(plan.from);
      let at = plan.to;
      if (folderOf(at) !== back) at = (await apiPost<{ path?: string }>('/api/move', { path: at, folder: back || 'Root' })).path || at;
      if (noteName(at) !== noteName(plan.from)) at = (await apiPost<{ path?: string }>('/api/rename', { path: at, name: noteName(plan.from) })).path || at;
      const where = back ? folderName(back) : 'the top level';
      toast(at === plan.from ? `“${titleOf(plan.from)}” is back in ${where}.` : `“${titleOf(at)}” is back in ${where}, saved as ${noteName(at)}.`, 'ok');
    } else {
      const pins = (await apiGet<{ pins?: { kind: string; path: string }[] }>('/api/pins')).pins || [];
      const pinned = pins.some((x) => x.kind === plan.kind && x.path === plan.path);
      if (pinned === (plan.type === 'pin')) {
        toast(`Nothing to undo: “${titleOf(plan.path)}” is ${pinned ? 'pinned' : 'not pinned'} already.`, 'info');
        undone.add(it.id);
        return true;
      }
      await apiPost(`/api/pins/${plan.type}`, { kind: plan.kind, path: plan.path });
      toast(plan.type === 'unpin' ? `“${titleOf(plan.path)}” is no longer pinned.` : `“${titleOf(plan.path)}” is pinned again.`, 'ok');
    }
    undone.add(it.id);
    return true;
  } catch (e) {
    toast(`Could not undo this: ${(e as Error).message || 'try again in a moment'}.`, 'err');
    return false;
  }
}

/** Whether Undo is offered for a row (the note is still where the AI left it). */
export function canUndo(it: ActivityItem): boolean {
  return !undone.has(it.id) && !!undoPlan(it, noteExists);
}

/** Click, Enter and note chips for rows inside `scope`. */
export function wireActRows(
  scope: HTMLElement,
  find: (id: string) => ActivityItem | undefined,
  onFilterActor?: (actor: string) => void,
  more: { onBurst?: (id: string) => void; onUndo?: (it: ActivityItem) => void; agentPage?: string } = {},
): void {
  scope.onclick = (e) => {
    const t = e.target as HTMLElement;
    const burst = t.closest<HTMLElement>('[data-burst]');
    if (burst && more.onBurst) {
      e.stopPropagation();
      more.onBurst(burst.dataset.burst!);
      return;
    }
    const und = t.closest<HTMLElement>('[data-undo]');
    if (und && more.onUndo) {
      e.stopPropagation();
      const it = find(und.dataset.undo!);
      if (it) more.onUndo(it);
      return;
    }
    const note = t.closest<HTMLElement>('[data-note]');
    if (note) {
      e.stopPropagation();
      hooks.openNote(note.dataset.note!);
      return;
    }
    const agent = t.closest<HTMLElement>('[data-agent-page]');
    if (agent) {
      e.stopPropagation();
      openAgentPage(agent.dataset.agentPage!);
      return;
    }
    const row = t.closest<HTMLElement>('[data-act]');
    if (!row) return;
    const it = find(row.dataset.act!);
    if (it) openActivity(it, onFilterActor, more.agentPage);
  };
  scope.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target as HTMLElement;
    if (!t.matches('[data-act]')) return;
    e.preventDefault();
    const it = find(t.dataset.act!);
    if (it) openActivity(it, onFilterActor, more.agentPage);
  };
}

/** An agent's own page on the Agents page (/agents/<key id>). */
export function openAgentPage(keyId: string, tab = ''): void {
  setKeysRoute('/agents/' + encodeURIComponent(keyId) + (tab ? '/' + tab : ''));
  hooks.go('keys');
}

/** Detail drawer of one item; `onAgentPage` is the key id of the agent page it was opened from. */
function openActivity(it: ActivityItem, onFilterActor?: (actor: string) => void, onAgentPage?: string): void {
  useActivityStyles();
  settleRunning(it);
  const problem = problemOf(it);
  const status = it.running ? 'Working' : problem === 'refused' ? 'Refused' : problem ? 'Did not work' : it.ok === true || it.ms != null ? 'Done' : 'Recorded';
  const stCls = it.running ? 'acc' : problem ? 'err' : it.ok === true || it.ms != null ? 'ok' : '';
  const raw = { ...it.raw };
  const kid = typeof raw.actor_id === 'string' ? raw.actor_id : null;
  const who = whoOf(it, myName());
  const pred = predicate(it);
  const error = typeof raw.error === 'string' ? raw.error : '';
  const why =
    problem === 'refused'
      ? `${esc(who)} asked for something its access does not allow. If it should be able to, change its access.`
      : problem
        ? `It reached Memora but did not finish${error ? `: <span class="cc-mono">${esc(error)}</span>` : '.'} It often works on the next try.`
        : '';
  const src = it.source === 'agent' ? 'An AI app (MCP tool call)' : it.source === 'auth' ? 'Sign-in and keys (gateway audit)' : 'Your notes (vault log)';
  const dot = it.running ? 'run' : problem ? 'err' : stCls === 'ok' ? 'ok' : 'idle';
  const body = `<div class="adr-hero" style="--ag:${agentColor(it.actor, kid)}">${avatarHTML(it.actor, 40, it.running ? 'live' : '', kid)}
      <div style="min-width:0"><div class="v"><b style="color:var(--ag)">${esc(who)}</b> ${pred}</div></div></div>
    <dl class="cc-kv">
      <dt>Result</dt><dd><span class="ad-res ${stCls}"><span class="cc-dot ${dot}"></span>${esc(status)}</span></dd>
      ${why ? `<dt>Why</dt><dd>${why}</dd>` : ''}
      <dt>When</dt><dd>${esc(new Date(it.ts * 1000).toLocaleString('en-US'))}</dd>
    </dl>
    ${
      it.paths.length
        ? `<div class="ad-sec">${kindOf(it) === 'searched' ? 'Notes it found' : 'Notes'} <span class="n">${it.paths.length}</span></div><div class="ad-notes">${it.paths
            .map(
              (p) =>
                `<button type="button" data-note="${attr(p)}">${ICO.note}<span style="min-width:0"><span>${esc(noteName(p))}</span><small>${esc(
                  p,
                )}</small></span></button>`,
            )
            .join('')}</div>`
        : ''
    }
    <details class="ad-tech" open><summary>Technical details</summary>
      <dl class="cc-kv">
        <dt>Action</dt><dd class="cc-mono">${esc(it.action)}</dd>
        ${it.label ? `<dt>Summary</dt><dd>${esc(it.label)}</dd>` : ''}
        ${it.ms != null ? `<dt>Duration</dt><dd>${esc(fmtMs(it.ms))}</dd>` : ''}
        <dt>Source</dt><dd>${esc(src)}</dd>
        ${it.ip ? `<dt>IP</dt><dd class="cc-mono">${esc(it.ip)}</dd>` : ''}
        ${error && !problem ? `<dt>Error</dt><dd class="cc-mono">${esc(error)}</dd>` : ''}
      </dl>
      <div class="ad-json"><div class="ad-json-h"><span>JSON</span><button type="button" class="btn sm ad-cp" data-cp>${ICO.copy}Copy JSON</button></div>
        <pre class="ad-raw">${esc(JSON.stringify(raw, null, 2))}</pre></div>
    </details>`;
  const agent = kid && keyExists(kid) !== false ? kid : null;
  const here = !!agent && agent === onAgentPage;
  const refused = problem === 'refused' && !!agent;
  const btns: string[] = [];
  if (onFilterActor) btns.push(`<button type="button" class="btn ${agent ? 'ghost' : 'primary'}" data-fa title="${attr(`Show only ${it.actor} in the timeline`)}">${agent ? 'Only this agent' : `Only ${esc(it.actor)}`}</button>`);
  if (agent && !here) btns.push(`<button type="button" class="btn${refused ? '' : ' primary'}" data-ap>Open agent activity${refused ? '' : ICO.arrow}</button>`);
  if (refused) btns.push(`<button type="button" class="btn primary" data-acc title="Change what it may do">Change access</button>`);
  else if (here) btns.push(`<button type="button" class="btn" data-acc title="What it may do">See its access</button>`);
  if (!agent && !onFilterActor) btns.push(`<button type="button" class="btn primary" data-la>Show in Activity${ICO.arrow}</button>`);
  openDrawer({
    title: 'What happened',
    sub: fmtTs(it.ts),
    body,
    foot: btns.join(''),
    onOpen: (d) => {
      d.querySelectorAll<HTMLElement>('[data-note]').forEach((b) => {
        b.onclick = () => {
          closeDrawer();
          hooks.openNote(b.dataset.note!);
        };
      });
      const fa = d.querySelector<HTMLElement>('[data-fa]');
      if (fa && onFilterActor)
        fa.onclick = () => {
          closeDrawer();
          onFilterActor(it.actor);
        };
      const ap = d.querySelector<HTMLElement>('[data-ap]');
      if (ap && agent)
        ap.onclick = () => {
          closeDrawer();
          openAgentPage(agent, 'activity');
        };
      const acc = d.querySelector<HTMLElement>('[data-acc]');
      if (acc && agent)
        acc.onclick = () => {
          closeDrawer();
          openAgentPage(agent, 'access');
        };
      const la = d.querySelector<HTMLElement>('[data-la]');
      if (la)
        la.onclick = () => {
          closeDrawer();
          try {
            sessionStorage.setItem('memora.activity.agent', it.actor);
          } catch {
            /* optional */
          }
          hooks.go('logs');
        };
      const cp = d.querySelector<HTMLElement>('[data-cp]');
      if (cp) cp.onclick = () => void copyText(JSON.stringify(raw, null, 2), 'JSON copied');
    },
  });
}
