// Version history of the open note (the vault's git history); restoring makes a new latest version.

import { apiGet, apiPost } from '../api';
import { attr, el, esc } from '../dom';
import { hashColor } from '../format';
import { Modal } from '../modal';
import { fadeScroll } from '../ui/scroll-fade';
import { I } from './icons';
import { openPanel } from './panel';
import { initials } from './store';
import {
  actionOf,
  diffCounts,
  groupByDay,
  parseDiff,
  restoredRev,
  timeLabel,
  versionMs,
  whenLabel,
  whoOf,
  type HistoryList,
  type Version,
} from './history-model';
import { undoToast } from './ui';

export type { Version } from './history-model';

/** What the panel needs from the reader. */
export interface HistoryHost {
  path: string;
  /** The revision being previewed ('' = the current note). */
  viewing: () => string;
  preview: (v: Version) => void;
  latest: () => void;
}

type Loaded = { list: HistoryList } | { off: string } | { error: string };

const cache = new Map<string, Promise<Loaded>>();
/** Version numbers by revision, from the last list shown (for "Restored v3"). */
const numbers = new Map<string, number>();

/** What a version did; a restore names the version it brought back when known. */
function actionText(v: Version): string {
  const from = restoredRev(v.message);
  const n = from ? numbers.get(from) ?? Array.from(numbers).find(([r]) => r.startsWith(from) || from.startsWith(r))?.[1] : undefined;
  return n ? `Restored v${n}` : actionOf(v.message);
}

/** Forget the versions of `path` (every note when left out); the next look asks again. */
export function invalidateHistory(path?: string): void {
  if (path == null) cache.clear();
  else cache.delete(path);
}

/** The versions of `path`, asked once until invalidated. */
function loadHistory(path: string): Promise<Loaded> {
  let p = cache.get(path);
  if (!p) {
    p = apiGet<HistoryList>(`/api/history?path=${encodeURIComponent(path)}&limit=200`).then(
      (list) => ({ list }),
      (e: Error & { status?: number; data?: { history?: boolean } }) => {
        cache.delete(path);
        if (e.status === 409 && e.data && e.data.history === false) return { off: e.message };
        return { error: e.message };
      },
    );
    cache.set(path, p);
  }
  return p;
}

/** One older version, as text and rendered HTML. */
export function fetchVersion(path: string, rev: string): Promise<{ content: string; html: string }> {
  return apiGet(`/api/note-at?path=${encodeURIComponent(path)}&rev=${encodeURIComponent(rev)}`);
}

/** What changed from `rev` to the note as it is now (a unified diff). */
export async function fetchDiff(path: string, rev: string): Promise<string> {
  const r = await apiGet<{ diff?: string }>(`/api/diff?path=${encodeURIComponent(path)}&a=${encodeURIComponent(rev)}`);
  return r.diff || '';
}

const avatar = (v: Version): string => {
  const who = whoOf(v);
  return v.owner
    ? `<span class="vh-av you" aria-hidden="true">${I.check}</span>`
    : `<span class="vh-av" style="--ac:${attr(hashColor(who))}" aria-hidden="true">${esc(initials(who))}</span>`;
};

/** The panel body: a skeleton, then the versions by day (or why there are none). */
function historyBody(h: HistoryHost): HTMLElement {
  const body = el('div', 'vh');
  body.innerHTML = `<div class="vh-list" aria-busy="true">${[0, 1, 2, 3]
    .map(
      () =>
        `<div class="vh-sk"><span class="vx-skel" style="width:10px;height:10px;border-radius:50%"></span><span style="flex:1;display:flex;flex-direction:column;gap:7px"><span class="vx-skel" style="width:46%;height:11px"></span><span class="vx-skel" style="width:70%;height:10px"></span></span></div>`,
    )
    .join('')}</div>`;
  void loadHistory(h.path).then((r) => paint(body, h, r));
  return body;
}

function paint(body: HTMLElement, h: HistoryHost, r: Loaded): void {
  if ('off' in r) {
    body.innerHTML = `<div class="vh-empty"><span class="vh-empty-i" aria-hidden="true">${I.history}</span><b>Version history is off</b>
      <p>Memora keeps every version of a note when the vault folder is a git repository. Run <code>git init</code> in the vault folder once (see Configuration, “Version history” in the docs); from then on every change is kept here.</p></div>`;
    return;
  }
  if ('error' in r) {
    body.innerHTML = `<div class="vh-empty" role="alert"><b>Could not load the versions</b><p>${esc(r.error)}.</p>
      <button type="button" class="btn sm" data-retry>Try again</button></div>`;
    body.querySelector<HTMLElement>('[data-retry]')!.onclick = () => {
      invalidateHistory(h.path);
      void loadHistory(h.path).then((x) => paint(body, h, x));
    };
    return;
  }
  const { list } = r;
  if (!list.versions.length) {
    body.innerHTML = `<div class="vh-empty"><span class="vh-empty-i" aria-hidden="true">${I.history}</span><b>No versions yet</b>
      <p>This note has not been saved to the history yet. The next change starts it.</p></div>`;
    return;
  }
  const viewing = h.viewing();
  numbers.clear();
  for (const v of list.versions) numbers.set(v.rev, v.version);
  const groups = groupByDay(list.versions);
  const more = list.total > list.versions.length ? `<p class="vh-more">Showing the latest ${list.versions.length} of ${list.total} versions.</p>` : '';
  body.innerHTML = `<p class="vh-sum">${list.total === 1 ? '1 version' : `${list.total} versions`} · newest first</p>
    <div class="vh-list" role="list" aria-label="Versions">${groups
      .map(
        (g) =>
          `<section class="vh-day" role="presentation"><h4>${esc(g.label)}</h4>${g.items
            .map((v) => {
              const ms = versionMs(v);
              const cur = v.version === list.total;
              const on = viewing ? v.rev === viewing : cur;
              const renamed = v.path ? `<span class="vh-was" title="${attr(v.path)}">as ${esc((v.path.split('/').pop() || v.path).replace(/\.md$/i, ''))}</span>` : '';
              return `<button type="button" role="listitem" class="vh-v${cur ? ' cur' : ''}${on ? ' on' : ''}" data-rev="${attr(v.rev)}"${
                on ? ' aria-current="true"' : ''
              } aria-label="${attr(`Version ${v.version}, ${g.label} ${timeLabel(ms)}, by ${whoOf(v)}${cur ? ', current version' : ''}`)}">
                <span class="vh-dot" aria-hidden="true"></span>
                <span class="vh-main"><span class="vh-top"><b>${esc(timeLabel(ms) || v.rev)}</b>${
                  cur ? '<em class="vh-cur">Current version</em>' : ''
                }<span class="vh-num">v${v.version}</span></span>
                <span class="vh-meta">${avatar(v)}<span class="vh-who">${esc(whoOf(v))}</span><span aria-hidden="true">·</span><span class="vh-act">${esc(actionText(v))}</span>${renamed}</span></span></button>`;
            })
            .join('')}</section>`,
      )
      .join('')}</div>${more}`;
  const lst = body.querySelector<HTMLElement>('.vh-list')!;
  fadeScroll(lst);
  const byRev = new Map(list.versions.map((v) => [v.rev, v]));
  lst.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.vh-v');
    const v = b && byRev.get(b.dataset.rev || '');
    if (!v) return;
    if (v.version === list.total) h.latest();
    else h.preview(v);
  };
  // Up and down move between versions.
  lst.onkeydown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const all = Array.from(lst.querySelectorAll<HTMLElement>('.vh-v'));
    const i = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    e.preventDefault();
    all[next]?.focus();
  };
  // The version on screen stays in view.
  requestAnimationFrame(() => {
    const on = lst.querySelector<HTMLElement>('.vh-v.on');
    if (on && on.offsetTop > lst.clientHeight - 40) lst.scrollTop = on.offsetTop - lst.clientHeight / 3;
  });
}

/** Phones and tablets: the versions as a bottom sheet; a pick closes it. */
export function openHistorySheet(anchor: HTMLElement, h: HistoryHost, close: () => void): void {
  const wrap: HistoryHost = {
    ...h,
    preview: (v) => {
      close();
      h.preview(v);
    },
    latest: () => {
      close();
      h.latest();
    },
  };
  openPanel(anchor, 'Version history', historyBody(wrap), 'vx-pop-ct vx-pop-hist', true);
}

/** The banner over a previewed version: what it is, Restore and Back to latest. */
export function previewBanner(
  v: Version,
  mode: 'read' | 'changes',
  act: { restore: () => void; latest: () => void; mode: (m: 'read' | 'changes') => void; list?: () => void },
): HTMLElement {
  const b = el('div', 'vh-banner');
  b.setAttribute('role', 'region');
  b.setAttribute('aria-label', `Viewing version ${v.version}`);
  const ms = versionMs(v);
  b.innerHTML = `<div class="vh-b-head"><span class="vh-b-i" aria-hidden="true">${I.history}</span><div class="vh-b-t">
      <b>Viewing version ${v.version} from ${esc(whenLabel(ms))}</b>
      <span>${esc(whoOf(v))} · ${esc(actionText(v))} · read only. The current version is v${v.total}.</span></div></div>
    <div class="vh-b-row"><div class="vh-seg" role="group" aria-label="Show">
        <button type="button" data-m="read" aria-pressed="${mode === 'read'}">Text</button>
        <button type="button" data-m="changes" aria-pressed="${mode === 'changes'}"><span class="vh-l-long">Compare to current</span><span class="vh-l-short">Compare</span></button></div>
      <span class="vx-grow"></span>
      ${act.list ? `<button type="button" class="btn sm ghost vh-b-list" data-list>${I.history}<span>All versions</span></button>` : ''}
      <button type="button" class="btn sm ghost" data-latest aria-label="Back to latest"><span class="vh-l-long">Back to latest</span><span class="vh-l-short">Latest</span></button>
      <button type="button" class="btn sm primary" data-restore aria-label="Restore this version">${I.undo}<span class="vh-l-long">Restore this version</span><span class="vh-l-short">Restore</span></button></div>`;
  b.querySelector<HTMLElement>('[data-restore]')!.onclick = act.restore;
  b.querySelector<HTMLElement>('[data-latest]')!.onclick = act.latest;
  b.querySelector<HTMLElement>('[data-list]')?.addEventListener('click', () => act.list?.());
  b.querySelectorAll<HTMLElement>('[data-m]').forEach((x) => (x.onclick = () => act.mode(x.dataset.m as 'read' | 'changes')));
  return b;
}

/** The changes from a version to the current note, line by line. */
export function diffView(v: Version, diff: string | null): HTMLElement {
  const box = el('div', 'vh-diff');
  if (diff == null) {
    box.innerHTML = `<p class="vh-diff-note" aria-busy="true">Comparing with the current version…</p>`;
    return box;
  }
  const lines = parseDiff(diff);
  if (!lines.length) {
    box.innerHTML = `<p class="vh-diff-note">The text of version ${v.version} is the same as the current version.</p>`;
    return box;
  }
  const n = diffCounts(lines);
  box.innerHTML = `<p class="vh-diff-note"><span class="vh-k del">${n.del} line${n.del === 1 ? '' : 's'} only in version ${v.version}</span><span class="vh-k add">${
    n.add
  } line${n.add === 1 ? '' : 's'} only in the current version</span></p>
    <div class="vh-lines" role="table" aria-label="Changes from version ${v.version} to the current version">${lines
      .map((l) =>
        l.kind === 'hunk'
          ? `<div class="vh-l hunk" role="row"><span role="cell">⋯ ${esc(l.text)}</span></div>`
          : `<div class="vh-l ${l.kind}" role="row"><span class="vh-sign" role="cell" aria-label="${
              l.kind === 'add' ? 'Only in the current version' : l.kind === 'del' ? `Only in version ${v.version}` : 'Unchanged'
            }">${l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span><span role="cell">${esc(l.text) || '&nbsp;'}</span></div>`,
      )
      .join('')}</div>`;
  return box;
}

/** Confirm, then restore `v` of `path` as a new latest version; `done` gets the new version number. */
export function askRestoreVersion(path: string, v: Version, done: (version: number) => void | Promise<void>): void {
  const ms = versionMs(v);
  Modal.open({
    title: `Restore version ${v.version}?`,
    body: `<p style="margin:0 0 10px">The note goes back to how it was ${esc(whenLabel(ms))}. This becomes a new latest version (v${
      v.total + 1
    }).</p><p style="margin:0">Nothing is lost: the current text stays in the history as v${v.total}, so you can switch back at any time.</p>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'Restore this version',
        cls: 'primary',
        run: async () => {
          try {
            const r = await apiPost<{ version?: number; changed?: boolean }>('/api/history/restore', { path, rev: v.rev });
            Modal.close();
            invalidateHistory(path);
            undoToast(
              r.changed === false
                ? `Version ${v.version} is the same as the current text; nothing changed`
                : `Restored version ${v.version}. It is now the latest version (v${r.version ?? v.total + 1}).`,
              null,
              r.changed === false ? 'info' : 'ok',
            );
            await done(r.version ?? v.total + 1);
          } catch (e) {
            Modal.close();
            undoToast(`Could not restore version ${v.version}: ${(e as Error).message}`, null, 'err');
          }
        },
      },
    ],
  });
}

export const HIST_CSS = `
.vx-hist-btn .vx-i{width:16px;height:16px}
.vh{display:flex;flex-direction:column;min-width:0;min-height:0}
.vh-sum{margin:0 0 6px;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.vh-list{display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:0;scrollbar-width:none;outline:none}
.vh-list::-webkit-scrollbar{display:none}
.vh-day h4{position:sticky;top:4px;z-index:2;width:max-content;margin:8px 0 4px 4px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;line-height:24px;
  color:var(--text-2);background:var(--vh-bg,var(--paper,var(--surface-1)));box-shadow:0 0 0 1px var(--line),0 4px 12px -6px rgba(0,0,0,.25)}
.vh-list.fade-scroll.can-up{-webkit-mask-image:none;mask-image:none}
.vh-list.fade-scroll.can-up.can-down{-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - var(--fade)),transparent);mask-image:linear-gradient(to bottom,#000 calc(100% - var(--fade)),transparent)}

.vh-v{position:relative;display:grid;grid-template-columns:18px minmax(0,1fr);gap:0 8px;width:100%;padding:8px 8px 8px 6px;border:0;border-radius:9px;background:none;
  color:var(--fg);font:inherit;text-align:left;cursor:pointer;transition:background .12s}
.vh-v:hover{background:var(--hover)}
.vh-v:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vh-v.on{background:color-mix(in srgb,var(--fg) 6%,transparent)}
.vh-v::before{content:"";position:absolute;left:14.5px;top:0;bottom:0;width:1px;background:var(--line)}
.vh-day .vh-v:first-of-type::before{top:16px}
.vh-day:last-child .vh-v:last-child::before{bottom:calc(100% - 16px)}
.vh-dot{position:relative;z-index:1;justify-self:center;margin-top:5px;width:9px;height:9px;border-radius:50%;background:var(--surface-1);box-shadow:inset 0 0 0 1.5px var(--muted)}
.vh-v.cur .vh-dot{background:var(--brand-mark,var(--accent));box-shadow:none}
.vh-v.on .vh-dot{box-shadow:inset 0 0 0 1.5px var(--fg),0 0 0 3px color-mix(in srgb,var(--fg) 12%,transparent)}
.vh-v.cur.on .vh-dot{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.vh-main{display:flex;flex-direction:column;gap:4px;min-width:0}
.vh-top{display:flex;align-items:center;gap:8px;min-width:0}
.vh-top b{font-size:13.5px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.vh-cur{font-style:normal;font-size:11.5px;font-weight:550;color:var(--text-2);padding:0 7px;line-height:18px;border-radius:6px;background:color-mix(in srgb,var(--fg) 7%,transparent);white-space:nowrap}
.vh-num{margin-left:auto;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.vh-meta{display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;color:var(--muted);white-space:nowrap}
.vh-who{flex:none;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;max-width:60%}
.vh-act{min-width:0;overflow:hidden;text-overflow:ellipsis}
.vh-was{overflow:hidden;text-overflow:ellipsis;color:var(--text-3)}
.vh-av{display:inline-grid;place-items:center;flex:none;width:18px;height:18px;border-radius:6px;font-size:8.5px;font-weight:700;color:var(--ac);
  background:color-mix(in srgb,var(--ac) 16%,transparent)}
:root[data-theme=light] .vh-av{color:color-mix(in srgb,var(--ac) 55%,#111)}
.vh-av.you{background:linear-gradient(180deg,#1b2433,#0d121b);color:#5eead4}
.vh-av.you .vx-i{width:11px;height:11px;stroke-width:2.4}
.vh-sk{display:flex;align-items:flex-start;gap:12px;padding:10px 8px}
.vh-more{margin:8px 8px 0;font-size:12px;color:var(--muted)}
.vh-empty{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:6px 4px 4px}
.vh-empty b{font-size:14px;font-weight:600;color:var(--fg)}
.vh-empty p{margin:0;font-size:13px;line-height:1.55;color:var(--text-2)}
.vh-empty code{font-family:var(--mono);font-size:.9em;padding:.1em .35em;border-radius:5px;background:var(--panel-2)}
.vh-empty-i{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;margin-bottom:4px;color:var(--muted);background:color-mix(in srgb,var(--fg) 5%,transparent)}
.vh-empty-i .vx-i{width:18px;height:18px}
.vx-sheet.vx-pop-hist .vx-pop-body{display:flex;flex-direction:column;overflow:hidden;padding:0 12px}
.vx-sheet.vx-pop-hist .vh-sum{padding:0 8px}
.vx-sheet.vx-pop-hist .vh-list{flex:1 1 auto;padding-bottom:calc(16px + var(--safe-b,0px))}
.vx-sheet.vx-pop-hist .vh-v{min-height:56px;padding:10px 8px 10px 6px}
.vx-sheet.vx-pop-hist .vh-top b{font-size:14.5px}
.vx-sheet.vx-pop-hist .vh-meta{font-size:13px}
.vx-sheet.vx-pop-hist .vh-day h4{background:var(--panel)}
.vh-banner{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:10px 16px;min-width:0;padding:10px 16px 10px 14px;border-bottom:1px solid var(--line);
  background:color-mix(in srgb,var(--accent) 6%,var(--surface-0))}
.vh-b-head{display:flex;gap:12px;align-items:center;flex:1 1 280px;min-width:0}
.vh-b-i{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:9px;background:linear-gradient(180deg,#1b2433,#0d121b);color:#5eead4}
.vh-b-i .vx-i{width:16px;height:16px}
.vh-b-t{display:flex;flex-direction:column;gap:2px;min-width:0}
.vh-b-t b{font-size:14px;font-weight:600;color:var(--fg)}
.vh-b-t span{font-size:12.5px;color:var(--muted);line-height:1.4}
.vh-b-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex:0 1 auto;min-width:0}
.vh-b-row .vx-grow{display:none}
.vh-l-short{display:none}
.vh-b-row .btn.sm{height:34px;padding:0 12px;border-radius:9px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.vh-b-row .btn .vx-i{width:15px;height:15px}
.vh-seg{display:inline-flex;gap:2px;padding:3px;border-radius:10px;background:var(--seg-track,color-mix(in srgb,var(--fg) 6%,transparent))}
.vh-seg button{height:28px;padding:0 11px;border:0;border-radius:7px;background:none;color:var(--text-2);font:inherit;font-size:12.5px;font-weight:550;cursor:pointer;white-space:nowrap}
.vh-seg button[aria-pressed=true]{background:var(--seg-thumb,var(--surface-1));color:var(--fg);box-shadow:inset 0 0 0 1px var(--line)}
.vh-seg button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vx-prose.vh-old{opacity:.96}
.vh-diff{margin-top:8px}
.vh-diff-note{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 12px;font-size:13px;color:var(--muted)}
.vh-k{display:inline-flex;align-items:center;gap:6px}
.vh-k::before{content:"";width:10px;height:10px;border-radius:3px}
.vh-k.del::before{background:color-mix(in srgb,var(--danger) 35%,transparent)}
.vh-k.add::before{background:color-mix(in srgb,var(--ok,#22c55e) 35%,transparent)}
.vh-lines{border:1px solid var(--line);border-radius:12px;overflow:hidden;font-family:var(--mono);font-size:12.5px;line-height:1.6}
.vh-l{display:grid;grid-template-columns:26px minmax(0,1fr);padding:1px 10px 1px 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text-2)}
.vh-l>span:last-child{min-width:0}
.vh-sign{text-align:center;color:var(--muted);user-select:none}
.vh-l.add{background:color-mix(in srgb,var(--ok,#22c55e) 13%,transparent);color:var(--fg)}
.vh-l.add .vh-sign{color:color-mix(in srgb,var(--ok,#22c55e) 80%,var(--fg))}
.vh-l.del{background:color-mix(in srgb,var(--danger) 11%,transparent);color:var(--fg)}
.vh-l.del .vh-sign{color:var(--danger)}
.vh-l.hunk{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 12px;font-size:11.5px;color:var(--muted);background:color-mix(in srgb,var(--fg) 4%,transparent);border-block:1px solid var(--line)}
.vh-l.hunk:first-child{border-top:0}
@container vxnote (max-width:640px){
  .vh-banner{padding:10px 12px;gap:8px}
  .vh-b-head{flex-basis:100%}
  .vh-b-i{width:28px;height:28px}
  .vh-b-row{flex:1 1 100%;flex-wrap:nowrap;gap:6px}
  .vh-l-long{display:none}
  .vh-l-short{display:inline}
  .vh-seg{flex:1 1 auto;min-width:0}
  .vh-seg button{flex:1;height:32px;padding:0 8px}
  .vh-b-row .btn.sm{flex:none;justify-content:center;height:38px;padding:0 10px}
  .vh-b-row .btn.sm.ghost{border:1px solid var(--line)}
  .vh-b-list span{display:none}
  .vh-b-row .btn.vh-b-list{width:38px;padding:0}
}
/* the toolbar's History button already opens the list */
@container vxnote (max-width:400px){
  .vh-b-row .btn.vh-b-list{display:none}
  .vh-seg{flex-shrink:0}
}
@container vxnote (max-width:380px){
  .vx-rbar{gap:0;padding:0 6px}
  .vx-rbar .vx-vsep{margin:0 3px}
  .vx-rbar .vx-ct-btn,.vx-rbar .vx-icon-btn{width:34px}
  .vx-rbar .vx-mode{padding:0 10px}
}
@media (prefers-reduced-motion:reduce){.vh-v{transition:none}}
`;
