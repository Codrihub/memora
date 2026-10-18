// Privacy panel: which agents (API keys and connected apps) may see a node or a
// folder. Rules live on the server (/api/privacy); the owner always sees
// everything. One question with three answers (all agents / all except… /
// only these…); the agent picker appears for the last two. A centred dialog on
// desktop, a bottom sheet on phones (Modal does both).
//
// Also the lock marks the sidebar tree and the Nodes list draw next to private
// nodes and folders (`lockMark`).

import { api } from '../api';
import { attr, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { Modal } from '../modal';
import { toast } from '../toast';
import { avatarHTML } from '../control/agents';

export type PrivacyKind = 'node' | 'folder';
type Mode = 'deny' | 'allow_only';
/** The answer picked in the panel: no rule, or one of the two rule modes. */
type Choice = 'all' | Mode;

interface KeyRef {
  id: string;
  name: string;
  color?: string | null;
}

interface RuleJson {
  id: number;
  kind: PrivacyKind;
  path: string;
  mode: Mode;
  keys: KeyRef[];
}

interface AgentState {
  id: string;
  name: string;
  color?: string | null;
  enabled: boolean;
  can_see: boolean;
  hidden_by: { path: string; kind?: PrivacyKind; own: boolean }[];
}

interface Described {
  path: string;
  kind: PrivacyKind;
  own: { mode: Mode; keys: string[] } | null;
  own_rules: RuleJson[];
  inherited: RuleJson[];
  agents: AgentState[];
  private: boolean;
}

const SVG = (d: string, w = 1.9): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const LOCK = SVG('<rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/>');
const I_ALL = SVG(
  '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.4-.3 4.1 1.2 4.6 4.4"/>',
);
const I_EXCEPT = SVG(
  '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
);
const I_ONLY = LOCK;
const I_EYE = SVG('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
const I_INFO = SVG('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.4"/>', 2);
const I_CHECK = SVG('<path d="M5 12.5l4.2 4.2L19 7"/>', 2.6);
const I_SEARCH = SVG('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>');
const I_FOLDER = SVG(
  '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  1.8,
);
const I_NOTE = SVG('<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/>', 1.8);

/** The lock glyph sized like the vault menu icons. */
export const LOCK_ICON = LOCK.replace('<svg ', '<svg class="vx-i" ');

const PV_CSS = `
.pv-lock{display:inline-grid;place-items:center;flex:none;width:15px;height:15px;color:var(--warn);opacity:.9;margin-left:4px}
.pv-lock svg{width:13px;height:13px}

@media (min-width:641px){.modal.pv-modal{width:min(520px,94vw)}}
.pv-modal .modal-head{align-items:center;gap:12px}
.pv-modal .pv-hi{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--surface-2);
  border:1px solid var(--line);color:var(--text-2)}
.pv-modal .pv-hi svg{width:18px;height:18px}
.pv-modal .pv-ht{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pv-modal .modal-title{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-modal .modal-sub{font:12px var(--mono);color:var(--muted)}
.pv-modal .modal-body{padding:20px}
.pv-modal .modal-foot{padding:14px 20px}
.pv-modal .modal-foot .btn{min-width:96px}

.pv{display:flex;flex-direction:column;gap:16px;min-width:0}
.pv-note{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:var(--r);font-size:12.5px;line-height:1.5;
  background:var(--warn-soft);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);color:var(--fg)}
.pv-note svg{width:16px;height:16px;flex:none;margin-top:1px;color:var(--warn)}
.pv-note b{font-weight:650}
.pv-note button{all:unset;cursor:pointer;color:var(--accent);font-weight:600;white-space:nowrap}
.pv-note button:hover{text-decoration:underline}
.pv-note button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}

.pv-q{margin:0;border:0;padding:0;min-width:0;display:flex;flex-direction:column;gap:8px}
.pv-card{position:relative;display:flex;align-items:center;gap:12px;padding:10px 14px;min-height:58px;border-radius:var(--r);cursor:pointer;
  border:1px solid var(--line-strong);background:var(--surface-1);transition:border-color .15s,background .15s}
.pv-card:hover{border-color:color-mix(in srgb,var(--accent) 40%,var(--line-strong))}
.pv-card input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
.pv-card .ic{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--surface-2);color:var(--text-2);
  transition:background .15s,color .15s}
.pv-card .ic svg{width:18px;height:18px}
.pv-card .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pv-card .tx b{font-size:14px;font-weight:650;color:var(--fg)}
.pv-card .tx small{font-size:12.5px;line-height:1.4;color:var(--muted)}
.pv-card .dot{flex:none;width:18px;height:18px;border-radius:50%;border:2px solid var(--line-strong);transition:border-color .15s,border-width .15s}
.pv-card:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.pv-card:has(input:checked) .ic{background:var(--accent);color:var(--on-accent)}
.pv-card:has(input:checked) .dot{border-color:var(--accent);border-width:5px}
.pv-card:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}

.pv-pick{display:grid;grid-template-rows:0fr;transition:grid-template-rows .22s var(--ease,ease),opacity .22s;opacity:0;margin-top:-16px}
.pv-pick.open{grid-template-rows:1fr;opacity:1;margin-top:0}
.pv-pick>div{min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:8px}
.pv-pick-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:12px;font-weight:650;color:var(--muted);letter-spacing:.02em}
.pv-pick-h span:last-child{font-weight:500}
.pv-search{display:flex;align-items:center;gap:8px;height:38px;padding:0 12px;border-radius:10px;border:1px solid var(--line-strong);background:var(--surface-1)}
.pv-search:focus-within{border-color:var(--accent)}
.pv-search svg{width:15px;height:15px;color:var(--muted);flex:none}
.pv-search input{all:unset;flex:1;min-width:0;font-size:13.5px;color:var(--fg)}
.pv-list{border:1px solid var(--line-strong);border-radius:var(--r);background:var(--surface-1);max-height:clamp(156px,calc(88vh - 590px),300px);overflow-y:auto;overscroll-behavior:contain}
.pv-row{display:flex;align-items:center;gap:11px;padding:9px 12px;min-height:52px;cursor:pointer;border-top:1px solid var(--line)}
.pv-row:first-child{border-top:0}
.pv-row[hidden]{display:none}
.pv-row:hover{background:var(--hover)}
.pv-row input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
.pv-who{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.pv-who b{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-who small{font:11px var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-box{flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:7px;border:2px solid var(--line-strong);color:transparent;
  transition:background .12s,border-color .12s}
.pv-box svg{width:14px;height:14px}
.pv-row input:checked+.pv-box{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.pv-pick.deny .pv-row input:checked+.pv-box{background:var(--danger);border-color:var(--danger);color:#fff}
.pv-row input:focus-visible+.pv-box{outline:2px solid var(--accent);outline-offset:2px}
.pv-row.locked{cursor:default;background:var(--surface-2)}
.pv-row.locked:hover{background:var(--surface-2)}
.pv-row.locked .ag-av{opacity:.5}
.pv-row.locked .pv-who b{color:var(--muted)}
.pv-row.locked .pv-who small{font-family:inherit;font-size:11.5px;color:var(--warn)}
.pv-row.locked .pv-box{border:0;color:var(--muted)}
.pv-row.locked .pv-box svg{width:15px;height:15px}
.pv-cnt{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--surface-3);color:var(--muted);font-size:12px;font-weight:700}
.pv-empty{padding:16px;text-align:center;color:var(--muted);font-size:13px;line-height:1.5}

.pv-sum{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border-radius:var(--r);background:var(--surface-2);border:1px solid var(--line);
  font-size:13px;line-height:1.5;color:var(--fg)}
.pv-sum svg{width:16px;height:16px;flex:none;margin-top:2px;color:var(--muted)}
.pv-sum.priv svg{color:var(--warn)}
.pv-help{margin:-4px 0 0;font-size:12px;line-height:1.5;color:var(--muted)}

@media (max-width:640px){
  .pv-modal .modal-body{padding:16px}
  .pv-modal .modal-head{padding-left:16px;padding-right:12px}
  .pv-modal .modal-foot{padding:12px 16px}
  .pv-modal .modal-foot .btn{height:46px;flex:1 1 0}
  .pv-card{padding:11px 12px}
  .pv-list{max-height:none}
  .pv-row{min-height:56px}
}
@media (prefers-reduced-motion:reduce){.pv-pick,.pv-card,.pv-box{transition:none}}
`;

function styles(): void {
  useStyles('ui-privacy', PV_CSS);
}

// ---------------------------------------------------------------------------
// Lock marks
// ---------------------------------------------------------------------------

let marks: Set<string> | null = null;
let loading = false;

const stem = (p: string): string => p.replace(/\.md$/i, '');
const markKey = (kind: PrivacyKind, path: string): string =>
  kind + ':' + (kind === 'node' ? stem(path) : path).replace(/^\/+|\/+$/g, '').toLowerCase();

/** Re-read which nodes and folders have a rule, then redraw tree and list. */
async function loadPrivacyMarks(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const r = await api<{ rules: RuleJson[] }>('/api/privacy');
    marks = new Set(r.rules.map((x) => markKey(x.kind, x.path)));
  } catch {
    // Not signed in as the owner, or offline: no marks.
    marks = marks || new Set();
  } finally {
    loading = false;
  }
  hooks.refreshTree();
  hooks.refreshVault();
}

if (typeof window !== 'undefined') {
  window.addEventListener('memora:privacy', () => void loadPrivacyMarks());
}

/** A small lock when the node or folder has its own privacy rule ('' otherwise). */
export function lockMark(kind: PrivacyKind, path: string): string {
  if (!path) return '';
  if (marks === null) {
    marks = new Set();
    styles();
    void loadPrivacyMarks();
    return '';
  }
  styles();
  return marks.has(markKey(kind, path))
    ? `<span class="pv-lock" title="Private: hidden from some agents" aria-label="Private">${LOCK}</span>`
    : '';
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const baseName = (p: string): string => (p.split('/').pop() || p).replace(/\.md$/i, '');

/** "a", "a and b", "a, b and c", "a, b and 3 more". */
function names(list: string[], max = 3): string {
  const b = list.map((n) => `<b>${esc(n)}</b>`);
  if (b.length <= 1) return b.join('');
  if (b.length <= max) return b.slice(0, -1).join(', ') + ' and ' + b[b.length - 1];
  return b.slice(0, max - 1).join(', ') + ` and ${b.length - max + 1} more`;
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Open the Privacy panel for a node (`kind` node, path with .md) or a folder. */
export async function openPrivacy(kind: PrivacyKind, path: string): Promise<void> {
  styles();
  let d: Described;
  try {
    d = await api<Described>(`/api/privacy/path?kind=${kind}&path=${encodeURIComponent(path)}`);
  } catch (e) {
    toast('Could not load privacy settings: ' + (e as Error).message, 'err');
    return;
  }
  const what = kind === 'node' ? 'node' : 'folder';
  const name = baseName(d.path) || d.path;

  // Agents a parent folder already hides: shown locked, not editable here.
  const lockedBy = new Map<string, string>();
  for (const a of d.agents) {
    const h = a.hidden_by.find((x) => !x.own);
    if (h) lockedBy.set(a.id, h.path);
  }
  const free = d.agents.filter((a) => !lockedBy.has(a.id));
  const locked = d.agents.filter((a) => lockedBy.has(a.id));

  // The picks are kept per mode so switching back and forth loses nothing.
  let choice: Choice = d.own ? d.own.mode : 'all';
  const picked: Record<Mode, Set<string>> = {
    deny: new Set(d.own?.mode === 'deny' ? d.own.keys : []),
    allow_only: new Set(d.own?.mode === 'allow_only' ? d.own.keys : []),
  };
  // "Hide from nobody" is the same as no rule.
  const effective = (): string => {
    if (choice === 'all' || (choice === 'deny' && !picked.deny.size)) return 'all';
    return choice + ':' + Array.from(picked[choice]).sort().join(',');
  };
  const initial = d.own && !(d.own.mode === 'deny' && !d.own.keys.length)
    ? d.own.mode + ':' + d.own.keys.slice().sort().join(',')
    : 'all';
  const changed = (): boolean => effective() !== initial;
  const sees = (a: AgentState): boolean => {
    if (lockedBy.has(a.id)) return false;
    if (choice === 'deny') return !picked.deny.has(a.id);
    if (choice === 'allow_only') return picked.allow_only.has(a.id);
    return true;
  };

  // ---- static markup ----
  const notice = (() => {
    if (!locked.length) return '';
    const byFolder = new Map<string, string[]>();
    for (const a of locked) {
      const p = lockedBy.get(a.id)!;
      byFolder.set(p, [...(byFolder.get(p) || []), a.name]);
    }
    return Array.from(byFolder)
      .map(
        ([p, who]) =>
          `<div class="pv-note">${I_INFO}<span>The folder <b>${esc(p)}</b> already hides this ${what} from ${names(who)}. <button type="button" data-folder="${attr(
            p,
          )}">Edit folder rule</button></span></div>`,
      )
      .join('');
  })();

  const card = (v: Choice, ico: string, title: string, sub: string): string =>
    `<label class="pv-card"><input type="radio" name="pv-choice" value="${v}"${choice === v ? ' checked' : ''}>
      <span class="ic">${ico}</span><span class="tx"><b>${title}</b><small>${sub}</small></span><span class="dot" aria-hidden="true"></span></label>`;

  const help =
    kind === 'folder'
      ? 'Covers everything inside it, now and later · You always see everything'
      : 'Rules follow the node when it’s renamed or moved · You always see everything';

  // One row per agent; agents a folder already hides are locked rows at the end,
  // folded into one row per folder when there are many of them.
  const rowHTML = (a: AgentState): string => {
    const by = lockedBy.get(a.id);
    const sub = by ? `Hidden by folder ${esc(by)}` : esc(a.id) + (a.enabled ? '' : ' · switched off');
    const ctrl = by
      ? `<input type="checkbox" disabled aria-label="${attr(a.name)}, hidden by folder ${attr(by)}"><span class="pv-box">${LOCK}</span>`
      : `<input type="checkbox" data-id="${attr(a.id)}" aria-label="${attr(a.name)}"><span class="pv-box">${I_CHECK}</span>`;
    return `<label class="pv-row${by ? ' locked' : ''}" data-q="${attr((a.name + ' ' + a.id).toLowerCase())}">${avatarHTML(
      a.name,
      30,
      '',
      a.id,
    )}<span class="pv-who"><b>${esc(a.name)}</b><small>${sub}</small></span>${ctrl}</label>`;
  };
  const lockedHTML = (): string => {
    if (locked.length <= 3) return locked.map(rowHTML).join('');
    const byFolder = new Map<string, AgentState[]>();
    for (const a of locked) byFolder.set(lockedBy.get(a.id)!, [...(byFolder.get(lockedBy.get(a.id)!) || []), a]);
    return Array.from(byFolder)
      .map(
        ([p, list]) =>
          `<div class="pv-row locked" data-q="${attr(list.map((a) => a.name + ' ' + a.id).join(' ').toLowerCase())}" aria-label="${attr(
            `${list.length} agents hidden by folder ${p}`,
          )}"><span class="pv-cnt" aria-hidden="true">${list.length}</span><span class="pv-who"><b>${list.length === 1 ? esc(list[0].name) : `${list.length} agents`}</b><small>Hidden by folder ${esc(
            p,
          )}</small></span><span class="pv-box">${LOCK}</span></div>`,
      )
      .join('');
  };

  const body = document.createElement('div');
  body.className = 'pv';
  body.innerHTML = `${notice}
    <fieldset class="pv-q" aria-label="Who can see this ${what}?">
      ${card('all', I_ALL, 'All agents', 'No restriction. Every agent can read it.')}
      ${card('deny', I_EXCEPT, 'All agents except…', 'Hide it from the agents you pick.')}
      ${card('allow_only', I_ONLY, 'Only these agents', 'Only the agents you pick. New agents can’t see it.')}
    </fieldset>
    <div class="pv-pick" aria-hidden="true"><div>
      <div class="pv-pick-h"><span id="pvPickLbl"></span><span class="pv-count"></span></div>
      ${
        free.length > 6
          ? `<label class="pv-search">${I_SEARCH}<input type="search" placeholder="Search agents" aria-label="Search agents" autocomplete="off" spellcheck="false"></label>`
          : ''
      }
      <div class="pv-list" role="group" aria-labelledby="pvPickLbl">${
        d.agents.length
          ? free.map(rowHTML).join('') + lockedHTML() + `<div class="pv-empty" hidden>No agent matches.</div>`
          : `<div class="pv-empty">No agents yet. Agents are API keys and connected apps; add one on the Agents page.</div>`
      }</div>
    </div></div>
    <div class="pv-sum" role="status" aria-live="polite"></div>
    <p class="pv-help">${help}</p>`;

  const pick = body.querySelector('.pv-pick') as HTMLElement;
  const sum = body.querySelector('.pv-sum') as HTMLElement;
  const boxes = Array.from(body.querySelectorAll<HTMLInputElement>('.pv-row input[data-id]'));
  let applyBtn: HTMLButtonElement | null = null;

  const summary = (): { html: string; priv: boolean } => {
    const total = d.agents.length;
    if (!total) return { html: `No agents yet, so only you can see this ${what}.`, priv: false };
    const seeing = d.agents.filter(sees);
    const lockedNote = locked.length ? ` ${locked.length === 1 ? 'One is' : `${locked.length} are`} hidden by the folder rule.` : '';
    if (choice === 'allow_only') {
      if (!seeing.length) return { html: `No agent can see this ${what}, including agents added later.${lockedNote}`, priv: true };
      return {
        html: `Only ${names(seeing.map((a) => a.name))} can see this ${what}. Every other agent, including ones added later, is blocked.${lockedNote}`,
        priv: true,
      };
    }
    const hiddenHere = choice === 'deny' ? free.filter((a) => picked.deny.has(a.id)) : [];
    if (!hiddenHere.length && !locked.length) {
      return {
        html:
          choice === 'deny'
            ? `Nothing hidden yet: tick the agents to hide it from. Right now ${total === 1 ? 'the only agent' : `all ${total} agents`} can see it.`
            : total === 1
              ? `The only agent, ${names([d.agents[0].name])}, can see this ${what}.`
              : `All ${total} agents can see this ${what}.`,
        priv: false,
      };
    }
    const parts: string[] = [];
    if (hiddenHere.length) parts.push(`Hidden from ${names(hiddenHere.map((a) => a.name))}.`);
    parts.push(
      seeing.length === total
        ? `All ${plural(total, 'agent')} can see it.`
        : seeing.length
          ? `${seeing.length} of ${plural(total, 'agent')} can see it.`
          : `No agent can see it.`,
    );
    return { html: parts.join(' ') + lockedNote, priv: true };
  };

  const sync = (): void => {
    const open = choice !== 'all';
    pick.classList.toggle('open', open);
    pick.classList.toggle('deny', choice === 'deny');
    pick.setAttribute('aria-hidden', String(!open));
    pick.querySelectorAll<HTMLElement>('input').forEach((i) => (i.tabIndex = open ? 0 : -1));
    if (open) {
      const set = picked[choice as Mode];
      (body.querySelector('#pvPickLbl') as HTMLElement).textContent = choice === 'deny' ? 'Hide it from:' : 'Who may see it:';
      for (const b of boxes) b.checked = set.has(b.dataset.id!);
      const n = free.filter((a) => set.has(a.id)).length;
      (body.querySelector('.pv-count') as HTMLElement).textContent = free.length
        ? choice === 'deny'
          ? n ? `${n} hidden` : 'none hidden'
          : `${n} of ${free.length} selected`
        : '';
    }
    const s = summary();
    sum.className = 'pv-sum' + (s.priv ? ' priv' : '');
    sum.innerHTML = (s.priv ? LOCK : I_EYE) + `<span>${s.html}</span>`;
    if (applyBtn) applyBtn.disabled = !changed();
  };

  body.querySelectorAll<HTMLInputElement>('input[name="pv-choice"]').forEach((r) => {
    r.onchange = () => {
      if (!r.checked) return;
      choice = r.value as Choice;
      sync();
    };
  });
  for (const b of boxes) {
    b.onchange = () => {
      if (choice === 'all') return;
      const set = picked[choice];
      if (b.checked) set.add(b.dataset.id!);
      else set.delete(b.dataset.id!);
      sync();
    };
  }
  const search = body.querySelector<HTMLInputElement>('.pv-search input');
  if (search) {
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      body.querySelectorAll<HTMLElement>('.pv-row').forEach((row) => {
        const hit = !q || row.dataset.q!.includes(q);
        row.hidden = !hit;
        if (hit) shown++;
      });
      (body.querySelector('.pv-list .pv-empty') as HTMLElement).hidden = shown > 0;
    };
  }
  body.querySelectorAll<HTMLButtonElement>('[data-folder]').forEach((b) => {
    b.onclick = () => void openPrivacy('folder', b.dataset.folder!);
  });

  const apply = async (): Promise<void> => {
    if (!changed()) return;
    const eff = effective();
    try {
      if (eff === 'all') {
        await api(`/api/privacy/path?kind=${kind}&path=${encodeURIComponent(d.path)}`, { method: 'DELETE' });
      } else {
        const mode = choice as Mode;
        await api<Described>('/api/privacy/path', {
          method: 'PUT',
          body: { path: d.path, kind, mode, keys: Array.from(picked[mode]) },
        });
      }
      Modal.close();
      toast(
        eff === 'all'
          ? `“${name}” is visible to every agent`
          : choice === 'deny'
            ? `“${name}” is now hidden from ${plural(picked.deny.size, 'agent')}`
            : `Only ${plural(picked.allow_only.size, 'agent')} can now see “${name}”`,
        'ok',
      );
      void loadPrivacyMarks();
    } catch (e) {
      toast('Could not save: ' + (e as Error).message, 'err');
    } finally {
      // Modal re-enables the button after the run; keep it honest if still open.
      setTimeout(() => {
        if (applyBtn && document.body.contains(applyBtn)) applyBtn.disabled = !changed();
      }, 0);
    }
  };

  Modal.open({
    title: `Who can see “${name}”?`,
    sub: d.path,
    body,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      { label: 'Apply', cls: 'primary', run: apply },
    ],
    onOpen: (bodyEl) => {
      const box = bodyEl.parentElement as HTMLElement;
      box.classList.add('pv-modal');
      const head = box.querySelector('.modal-head') as HTMLElement;
      const t = head.querySelector('.modal-title') as HTMLElement;
      const s = head.querySelector('.modal-sub') as HTMLElement | null;
      const ico = document.createElement('span');
      ico.className = 'pv-hi';
      ico.innerHTML = kind === 'folder' ? I_FOLDER : I_NOTE;
      const wrap = document.createElement('div');
      wrap.className = 'pv-ht';
      head.insertBefore(ico, t);
      head.insertBefore(wrap, t);
      wrap.append(t);
      if (s) {
        s.title = d.path;
        wrap.append(s);
      }
      applyBtn = box.querySelector('.modal-foot .btn.primary');
      sync();
      // Modal focuses its first control after 40ms; the chosen answer is the better start.
      setTimeout(() => body.querySelector<HTMLInputElement>('input[name="pv-choice"]:checked')?.focus(), 60);
    },
  });
}
