// Activity rows and the detail drawer, shared by Overview and Activity.

import { attr, esc, useStyles } from '../dom';
import { fmtTs, noteName } from '../format';
import { hooks } from '../hooks';
import { agentColor, avatarHTML } from './agents';
import { verb, type ActivityItem } from './feed';
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
.act-l1{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;min-width:0;font-size:13.2px;line-height:1.45}
.act-who{font-weight:680;color:var(--ag)}
.act-verb{color:var(--fg);font-weight:550}
.act-lbl{color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.act-l2{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.act-note{display:inline-flex;align-items:center;gap:5px;max-width:240px;font-size:11.5px;font-weight:600;padding:2px 8px 2px 6px;
  border-radius:7px;background:var(--panel-2);border:1px solid var(--line);color:var(--fg)}
.act-note:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line));color:var(--accent)}
.act-note .cc-i{width:12px;height:12px;color:var(--muted)}
.act-note span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.act-meta{display:flex;flex-direction:column;align-items:flex-end;gap:3px;font-size:11.5px;color:var(--muted);white-space:nowrap;
  font-variant-numeric:tabular-nums}
.act-st{display:inline-flex;align-items:center;gap:5px}
.act-src{font-size:10.5px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);opacity:.8}
.act.fail .act-verb{color:var(--danger)}
.act-more{display:inline-flex;font-size:11.5px;color:var(--muted);padding:2px 4px}
.act-burst{font-size:11.5px;color:var(--muted);font-weight:600}
@media (max-width:760px){
  .act{padding:11px 13px;gap:3px 10px}
  .act-note{max-width:180px}
}
.ad-hero{display:flex;gap:12px;align-items:center;margin-bottom:16px}
.ad-hero .v{font-size:16px;font-weight:680}
.ad-hero .s{font-size:12.5px;color:var(--muted)}
.ad-sec{margin:18px 0 8px;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.ad-notes{display:flex;flex-direction:column;gap:6px}
.ad-notes button{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:10px;border:1px solid var(--line);
  background:var(--panel-2);text-align:left;font-size:13px;font-weight:550}
.ad-notes button:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.ad-notes small{display:block;color:var(--muted);font-size:11.5px;font-family:var(--mono)}
.ad-raw{margin:0;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 12px;font-family:var(--mono);
  font-size:11.5px;line-height:1.55;overflow:auto;max-height:260px;white-space:pre-wrap;word-break:break-word}
:root[data-theme=light] .ad-raw{background:#f8f9fb}
`;

export function useActivityStyles(): void {
  useStyles('cc-act-css', CSS);
}

export function statusHTML(it: ActivityItem): string {
  if (it.running) return '<span class="act-st"><span class="cc-dot run"></span>running</span>';
  if (it.ok === false) return '<span class="act-st" style="color:var(--danger)"><span class="cc-dot err"></span>failed</span>';
  if (it.ms != null) return `<span class="act-st"><span class="cc-dot ok" style="box-shadow:none"></span>${fmtMs(it.ms)}</span>`;
  return '';
}

export function fmtMs(ms: number): string {
  return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
}

const SRC_LABEL: Record<string, string> = { agent: 'mcp', vault: 'vault', auth: 'auth' };

/** One activity row. `extra` is appended to line 1 (e.g. "x4" bursts). */
export function actRowHTML(it: ActivityItem, opts: { fresh?: boolean; extra?: string } = {}): string {
  const kid = typeof it.raw.actor_id === 'string' ? it.raw.actor_id : null;
  const c = agentColor(it.actor, kid);
  const paths = it.paths.slice(0, 3);
  const label = it.label && !it.paths.includes(it.label) ? it.label : '';
  return `<div class="act${it.ok === false ? ' fail' : ''}${opts.fresh ? ' new' : ''}" role="button" tabindex="0" data-act="${attr(
    it.id,
  )}" style="--ag:${c}" aria-label="${attr(`${it.actor} ${verb(it.action)} ${label || paths.join(', ')}`)}">
    <span class="av">${avatarHTML(it.actor, 30, it.running ? 'live' : '', kid)}</span>
    <span style="min-width:0"><span class="act-l1"><span class="act-who">${esc(it.actor)}</span><span class="act-verb">${esc(
      verb(it.action),
    )}</span>${label ? `<span class="act-lbl" title="${attr(label)}">${esc(label)}</span>` : ''}${opts.extra || ''}</span>${
      paths.length
        ? `<span class="act-l2">${paths
            .map(
              (p) =>
                `<button type="button" class="act-note" data-note="${attr(p)}" title="${attr(p)}">${ICO.note}<span>${esc(
                  noteName(p),
                )}</span></button>`,
            )
            .join('')}${it.paths.length > 3 ? `<span class="act-more">+${it.paths.length - 3}</span>` : ''}</span>`
        : ''
    }</span>
    <span class="act-meta"><span title="${attr(fmtTs(it.ts))}">${clock(it.ts)} · ${ago(it.ts)}</span>${statusHTML(it) || `<span class="act-src">${esc(
      SRC_LABEL[it.source] || it.source,
    )}</span>`}</span>
  </div>`;
}

/** Click, Enter and note chips for rows inside `scope`. */
export function wireActRows(
  scope: HTMLElement,
  find: (id: string) => ActivityItem | undefined,
  onFilterActor?: (actor: string) => void,
): void {
  scope.onclick = (e) => {
    const t = e.target as HTMLElement;
    const note = t.closest<HTMLElement>('[data-note]');
    if (note) {
      e.stopPropagation();
      hooks.openNote(note.dataset.note!);
      return;
    }
    const row = t.closest<HTMLElement>('[data-act]');
    if (!row) return;
    const it = find(row.dataset.act!);
    if (it) openActivity(it, onFilterActor);
  };
  scope.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target as HTMLElement;
    if (!t.matches('[data-act]')) return;
    e.preventDefault();
    const it = find(t.dataset.act!);
    if (it) openActivity(it, onFilterActor);
  };
}

/** The detail drawer of one activity item. */
export function openActivity(it: ActivityItem, onFilterActor?: (actor: string) => void): void {
  useActivityStyles();
  const status = it.running ? 'Running' : it.ok === false ? 'Failed' : it.ok === true || it.ms != null ? 'Succeeded' : 'Recorded';
  const stCls = it.running ? 'acc' : it.ok === false ? 'err' : it.ok === true || it.ms != null ? 'ok' : '';
  const raw = { ...it.raw };
  const kid = typeof raw.actor_id === 'string' ? raw.actor_id : null;
  const body = `<div class="ad-hero" style="--ag:${agentColor(it.actor, kid)}">${avatarHTML(it.actor, 44, it.running ? 'live' : '', kid)}
      <div style="min-width:0"><div class="v">${esc(verb(it.action))}</div><div class="s">by <b style="color:var(--ag)">${esc(
        it.actor,
      )}</b> · ${esc(fmtTs(it.ts))}</div></div></div>
    <dl class="cc-kv">
      <dt>Status</dt><dd><span class="cc-pill ${stCls}">${esc(status)}</span></dd>
      ${it.ms != null ? `<dt>Duration</dt><dd>${esc(fmtMs(it.ms))}</dd>` : ''}
      <dt>Action</dt><dd class="cc-mono">${esc(it.action)}</dd>
      ${it.label ? `<dt>Summary</dt><dd>${esc(it.label)}</dd>` : ''}
      <dt>Source</dt><dd>${esc(it.source === 'agent' ? 'Agent over MCP' : it.source === 'auth' ? 'Gateway audit' : 'Vault log')}</dd>
      ${it.ip ? `<dt>IP</dt><dd class="cc-mono">${esc(it.ip)}</dd>` : ''}
      <dt>Time</dt><dd>${esc(new Date(it.ts * 1000).toLocaleString('en-US'))}</dd>
    </dl>
    ${
      it.paths.length
        ? `<div class="ad-sec">Nodes touched (${it.paths.length})</div><div class="ad-notes">${it.paths
            .map(
              (p) =>
                `<button type="button" data-note="${attr(p)}">${ICO.note}<span style="min-width:0"><span>${esc(noteName(p))}</span><small>${esc(
                  p,
                )}</small></span></button>`,
            )
            .join('')}</div>`
        : ''
    }
    <div class="ad-sec">Raw event</div><pre class="ad-raw">${esc(JSON.stringify(raw, null, 2))}</pre>`;
  openDrawer({
    title: it.actor,
    sub: verb(it.action),
    body,
    foot: `${onFilterActor ? `<button type="button" class="btn" data-fa>Only ${esc(it.actor)}</button>` : ''}<span style="flex:1"></span><button type="button" class="btn ghost" data-cp>Copy JSON</button>`,
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
      const cp = d.querySelector<HTMLElement>('[data-cp]');
      if (cp) cp.onclick = () => void copyText(JSON.stringify(raw, null, 2), 'Event copied');
    },
  });
}
