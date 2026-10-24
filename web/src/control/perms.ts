// What an agent may do (scopes and callable tools); contract: docs/contracts/tools-permissions.md.

import { fetchTools } from '../api';
import { attr, esc, useStyles } from '../dom';
import { categoryDesc, categoryLabel, groupTools, riskChip, TOOL_ROW_CSS, toolMatches, toolRisk, toolTitle } from '../views/tools';
import { checkboxHTML, radioCardHTML, useFormStyles, wireRadios } from '../ui/forms';
import type { KeyScope, ToolAccess, ToolInfo } from '../types';

export interface Permissions {
  scopes: KeyScope[];
  tools: ToolAccess;
}

/** Everything except admin: the default for new keys and keys without scopes. */
const DEFAULT_SCOPES: KeyScope[] = ['mcp', 'read', 'write'];

const I = (d: string): string => `<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

export const SCOPES: { id: KeyScope; label: string; short: string; hint: string; icon: string }[] = [
  {
    id: 'mcp',
    label: 'Connect from AI apps',
    short: 'AI apps',
    hint: "Lets the app use Memora's tools (MCP), limited by the tool list below. Every AI app needs this.",
    icon: I('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>'),
  },
  {
    id: 'read',
    label: 'Read notes from scripts',
    short: 'Scripts',
    hint: 'Plain HTTP API requests that read notes, outside the AI tools.',
    icon: I('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  },
  {
    id: 'write',
    label: 'Change notes',
    short: 'Changes',
    hint: 'Create, edit, move and delete notes, with the AI tools and the HTTP API. Without it every change is refused.',
    icon: I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  },
  {
    id: 'admin',
    label: 'Manage Memora',
    short: 'Manage',
    hint: "Switch tools on or off for everyone and change any agent's key and access, its own included.",
    icon: I('<path d="M12 3 4.5 6v6c0 4.5 3.2 7.6 7.5 9 4.3-1.4 7.5-4.5 7.5-9V6z"/><path d="M12 8v5M12 16h.01"/>'),
  },
];

/** What an agent can really do, from its scopes (the server refuses every change without `write`). */
export type Level = 'read' | 'write' | 'full' | 'none';

const LEVELS: { id: Exclude<Level, 'none'>; label: string; desc: string; scopes: KeyScope[] }[] = [
  { id: 'read', label: 'Can only read', desc: 'Searches and reads notes. Any change it tries is refused.', scopes: ['mcp', 'read'] },
  {
    id: 'write',
    label: 'Can read and change',
    desc: 'Searches, reads and saves notes. It cannot manage Memora or other agents.',
    scopes: ['mcp', 'read', 'write'],
  },
  {
    id: 'full',
    label: 'Full control',
    desc: 'Everything, plus switching tools off for everyone and managing other agents. Only for automation you fully trust.',
    scopes: ['mcp', 'read', 'write', 'admin'],
  },
];

const LEVEL_LABEL: Record<Level, string> = {
  read: 'Can only read',
  write: 'Can read and change',
  full: 'Full control',
  none: 'No access',
};

/** The level a set of scopes amounts to (the same rule as the server's `access` field). */
function levelOf(scopes: readonly string[]): Level {
  if (scopes.includes('admin')) return 'full';
  if (scopes.includes('write')) return 'write';
  if (scopes.includes('mcp') || scopes.includes('read')) return 'read';
  return 'none';
}

let catalog: ToolInfo[] | null = null;

/** The tool catalog, cached for the session; null when the server has none. */
export async function loadCatalog(force = false): Promise<ToolInfo[] | null> {
  if (catalog && !force) return catalog;
  try {
    catalog = await fetchTools();
  } catch {
    catalog = null;
  }
  return catalog;
}

/** The last loaded catalog, without a request. */
export function cachedCatalog(): ToolInfo[] | null {
  return catalog;
}

export function scopesOf(k: { scopes?: string[] }): KeyScope[] {
  if (!k.scopes) return [...DEFAULT_SCOPES];
  return SCOPES.map((s) => s.id).filter((id) => k.scopes!.includes(id));
}

export function toolsOf(k: { tools?: ToolAccess }): ToolAccess {
  return Array.isArray(k.tools) ? k.tools : '*';
}

export type Preset = 'rw' | 'ro' | 'custom';

function readOnlyTools(tools: ToolInfo[]): string[] {
  return tools
    .filter((t) => toolRisk(t) === 'read')
    .map((t) => t.name)
    .sort();
}

/** The permissions of a preset. "Read only" leaves out `write`, so the server refuses every change. */
export function presetPerms(p: Exclude<Preset, 'custom'>, _tools?: ToolInfo[] | null): Permissions {
  return p === 'rw' ? { scopes: [...DEFAULT_SCOPES], tools: '*' } : { scopes: ['mcp', 'read'], tools: '*' };
}

interface PermSummary {
  id: Level;
  level: string;
  /** A short note when the level is narrowed ("Only 12 chosen tools"), else ''. */
  tools: string;
  tone: '' | 'warn' | 'none';
}

export function summarize(p: Permissions, _total?: number | null): PermSummary {
  const id = levelOf(p.scopes);
  if (id === 'none') return { id, level: LEVEL_LABEL.none, tools: 'Everything is refused', tone: 'none' };
  const mcp = p.scopes.includes('mcp');
  let tools = '';
  let tone: PermSummary['tone'] = id === 'full' ? 'warn' : '';
  if (!mcp) tools = 'Not from AI apps';
  else if (Array.isArray(p.tools)) {
    if (!p.tools.length) {
      tools = 'No tools allowed';
      tone = 'none';
    } else if (!(id === 'read' && p.tools.every((n) => toolRisk({ name: n }) === 'read'))) {
      // A read-only agent limited to reading tools is no narrower than its level says.
      tools = `Only ${p.tools.length} chosen tool${p.tools.length === 1 ? '' : 's'}`;
    }
  }
  return { id, level: LEVEL_LABEL[id], tools, tone };
}

export function summaryText(p: Permissions, total?: number | null): string {
  const s = summarize(p, total);
  return s.tools ? `${s.level} · ${s.tools}` : s.level;
}

/** What an agent can do, as one plain sentence. */
export function accessSentence(p: Permissions): string {
  const s = summarize(p);
  const base =
    s.id === 'full'
      ? 'It has full control: it reads and changes notes, and can manage Memora and other agents'
      : s.id === 'write'
        ? 'It can search, read and save your notes'
        : s.id === 'read'
          ? 'It can search and read your notes, but not change them'
          : 'It cannot do anything yet';
  return s.tools && s.id !== 'none' ? `${base} (${s.tools.toLowerCase()}).` : base + '.';
}

/** The level card these scopes match, or null for a custom mix (no AI apps, or manage without change). */
function cardLevel(scopes: ReadonlySet<KeyScope>): Exclude<Level, 'none'> | null {
  if (!scopes.has('mcp')) return null;
  if (scopes.has('admin')) return scopes.has('write') ? 'full' : null;
  return scopes.has('write') ? 'write' : 'read';
}

/** A plain sentence for the editor's live summary. */
function sentence(p: Permissions, total: number): string {
  if (!p.scopes.length) return 'Nothing is allowed. Turn something on, or pause the agent instead.';
  const write = p.scopes.includes('write');
  const parts: string[] = [];
  if (p.scopes.includes('mcp')) {
    const which = p.tools === '*' ? 'every tool' : p.tools.length ? `${p.tools.length} of ${total || p.tools.length} tools` : '';
    parts.push(
      !which
        ? 'connect from an AI app but use no tools'
        : write
          ? `use ${which} from an AI app, including ones that change notes`
          : `use ${which} from an AI app to search and read; every change is refused`,
    );
  }
  if (p.scopes.includes('read') && write) parts.push('read and change notes from scripts');
  else if (p.scopes.includes('read')) parts.push('read notes from scripts');
  else if (write && !p.scopes.includes('mcp')) parts.push('change notes from scripts');
  if (p.scopes.includes('admin')) parts.push('manage Memora and other agents');
  if (!parts.length) return 'It can change notes, but nothing lets it connect.';
  const last = parts.pop()!;
  return 'It can ' + (parts.length ? parts.join(', ') + ' and ' + last : last) + '.';
}

const PERMS_CSS = `
.pm{min-width:0}
.pm-sum{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:var(--r);margin:0 0 24px;
  background:var(--surface-2)}
.pm-sum .ic{display:grid;place-items:center;width:24px;height:24px;flex:none;color:var(--accent)}
.pm-sum.warn .ic{color:var(--warn)}
.pm-sum.none .ic{color:var(--danger)}
.pm-sum .tx{flex:1;min-width:0}
.pm-sum b{display:block;font-size:15px;font-weight:650}
.pm-sum small{display:block;margin-top:2px;font-size:12.5px;line-height:1.5;color:var(--muted)}
.pm-sec{margin:0 0 24px}
.pm-sec>h3{margin:0 0 4px;font-size:15px;font-weight:650}
.pm-sec>p{margin:0 0 12px;font-size:13px;color:var(--muted);line-height:1.5}
.pm-caps{border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.pm-cap{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--line);min-width:0}
.pm-cap:first-child{border-top:0}
.pm-cap .ic{display:grid;place-items:center;width:32px;height:32px;border-radius:var(--r-sm);flex:none;background:var(--surface-2);color:var(--muted)}
.pm-cap .tx{flex:1;min-width:0}
.pm-cap b{display:block;font-size:14px;font-weight:600}
.pm-cap small{display:block;margin-top:2px;font-size:12.5px;color:var(--muted);line-height:1.45}
.pm-cap.on .ic{color:var(--accent);background:var(--accent-soft)}
.pm-cap.admin.on .ic{color:var(--warn);background:var(--warn-soft)}
.pm-warn{margin:8px 0 0;font-size:12.5px;line-height:1.5;padding:10px 12px;border-radius:var(--r-sm);
  background:var(--warn-soft)}
.pm-dim .pm-mode,.pm-dim .pm-pick{opacity:.5}
.pm-mode{grid-template-columns:1fr 1fr;margin:0 0 12px}
.pm-pick{border:1px solid var(--line);border-radius:var(--r);min-width:0}
.pm-ph{position:sticky;top:0;z-index:2;display:flex;flex-direction:column;gap:10px;padding:12px;border-bottom:1px solid var(--line);
  background:var(--surface-1);border-radius:var(--r) var(--r) 0 0}
.pm-q{position:relative}
.pm-q svg{position:absolute;left:12px;top:50%;width:15px;height:15px;margin-top:-7.5px;color:var(--muted);pointer-events:none}
.pm-q .ui-input{padding-left:36px;height:40px}
.pm-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pm-cnt{flex:1;min-width:0;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.pm-cnt b{color:var(--fg)}
.pm-chip{height:28px;padding:0 12px;border-radius:99px;font-size:12.5px;font-weight:600;color:var(--text-2);border:1px solid var(--line-strong);
  background:transparent;white-space:nowrap}
.pm-chip:hover{background:var(--hover);color:var(--fg)}
.pm-chip:focus-visible{box-shadow:0 0 0 3px var(--accent-soft);border-color:var(--accent-line);border-radius:99px}
.pm-cat{border-top:1px solid var(--line)}
.pm-cat:first-child{border-top:0}
.pm-cat-h{display:flex;align-items:center;gap:8px;padding:6px 10px 6px 6px;min-height:54px}
.pm-tg{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:6px;border-radius:var(--r-xs);text-align:left}
.pm-tg:hover{background:var(--hover)}
.pm-tg .chev{width:16px;height:16px;color:var(--muted);transition:transform .18s var(--ease)}
.pm-tg[aria-expanded=true] .chev{transform:rotate(90deg)}
.pm-tg .t{flex:1;min-width:0}
.pm-tg b{display:block;font-size:14px;font-weight:600}
.pm-tg small{display:block;font-size:12px;color:var(--muted);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pm-n{font-size:12px;font-weight:620;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.pm-n.all{color:var(--accent)}
.pm-mini{height:26px;padding:0 8px;border-radius:var(--r-xs);font-size:12px;font-weight:620;color:var(--muted)}
.pm-mini:hover{background:var(--hover);color:var(--fg)}
.pm-cat-b{padding:0 6px 6px}
.pm-tool{display:flex;align-items:flex-start;gap:12px;padding:10px 10px 10px 14px;border-radius:var(--r-xs);cursor:pointer;min-width:0}
.pm-tool:hover{background:var(--hover)}
.pm-tool .ui-cb{margin-top:1px}
.pm-tool .tx{flex:1;min-width:0}
.pm-tool .nm{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:13px;font-weight:600}
.pm-tool .nm .tl-code{font-weight:400}
.pm-tool .ds{font-size:12px;color:var(--muted);line-height:1.45;margin-top:2px}
.pm-tool .rk{flex:none}
.pm-tool .offall{display:inline-block;margin-top:4px;font-size:11px;font-weight:650;color:var(--danger)}
.pm-empty{margin:0;padding:22px 12px;text-align:center;color:var(--muted);font-size:12.5px}
.pm-lv{grid-template-columns:1fr}
.pm-mix{margin:10px 0 0;font-size:12.5px;line-height:1.5;color:var(--muted)}
.pm-sec .pm-warn{margin-top:10px}
.pm-adv{margin:0 0 4px;border:1px solid var(--line);border-radius:var(--r)}
.pm-adv>summary{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;list-style:none;border-radius:var(--r)}
.pm-adv>summary::-webkit-details-marker{display:none}
.pm-adv>summary:hover{background:var(--hover)}
.pm-adv>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pm-adv>summary .chev{width:16px;height:16px;color:var(--muted);transition:transform .18s var(--ease)}
.pm-adv[open]>summary .chev{transform:rotate(90deg)}
.pm-adv>summary span{font-size:14px;font-weight:600}
.pm-adv>summary small{display:block;font-size:12.5px;font-weight:500;color:var(--muted)}
.pm-adv-b{padding:8px 16px 4px;border-top:1px solid var(--line)}
@media (prefers-reduced-motion:reduce){.pm-adv>summary .chev{transition:none}}
@media (max-width:760px){
  .pm-mode{grid-template-columns:1fr}
  .pm-q .ui-input{height:44px}
  .pm-tool .nm .tl-code{display:none}
  .pm-tg small{display:none}
  .pm-chip{height:32px}
  .pm-cnt{flex-basis:100%;margin-bottom:2px}
}
`;

const CHEV = '<svg class="cc-i chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const SEARCH = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
const SHIELD = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v6c0 4.5 3.2 7.6 7.5 9 4.3-1.4 7.5-4.5 7.5-9V6z"/></svg>';

export interface PermEditor {
  read: () => Permissions;
  /** A reason the choice cannot be saved, or ''. */
  problem: () => string;
}

let editorSeq = 0;

/** `levels`: the three plain levels first, with the switches and the tool list under Advanced. */
export function permsHTML(initial: Permissions, tools: ToolInfo[] | null, o: { levels?: boolean } = {}): string {
  useStyles('perms-css', PERMS_CSS + TOOL_ROW_CSS);
  useFormStyles();
  const u = 'pm' + ++editorSeq;
  const all = initial.tools === '*' || !tools;
  const selected = new Set<string>(Array.isArray(initial.tools) ? initial.tools : (tools || []).map((t) => t.name));
  const caps = SCOPES.map(
    (s) => `<div class="pm-cap${s.id === 'admin' ? ' admin' : ''}" data-cap="${s.id}"><span class="ic">${s.icon}</span>
      <span class="tx"><b id="${u}-s-${s.id}">${esc(s.label)}</b><small id="${u}-sd-${s.id}">${esc(s.hint)}</small></span>
      <button type="button" class="cc-sw${s.id === 'admin' ? ' warn' : ''}" role="switch" data-scope="${s.id}" aria-checked="${initial.scopes.includes(
        s.id,
      )}" aria-labelledby="${u}-s-${s.id}" aria-describedby="${u}-sd-${s.id}"><i></i></button></div>`,
  ).join('');
  const cats = tools
    ? groupTools([...tools])
        .map(
          ([cat, items]) => `<section class="pm-cat" data-cat="${attr(cat)}"><div class="pm-cat-h">
          <button type="button" class="pm-tg" aria-expanded="false" aria-controls="${u}-c-${attr(cat)}">${CHEV}<span class="t"><b>${esc(
            categoryLabel(cat),
          )}</b><small>${esc(categoryDesc(cat))}</small></span></button>
          <span class="pm-n" data-cnt></span>
          <button type="button" class="pm-mini" data-catset="1" aria-label="Allow all ${attr(categoryLabel(cat))} tools">All</button>
          <button type="button" class="pm-mini" data-catset="0" aria-label="Allow no ${attr(categoryLabel(cat))} tools">None</button></div>
          <div class="pm-cat-b" id="${u}-c-${attr(cat)}" hidden>${items
            .map(
              (t) => `<div class="pm-tool" data-tool="${attr(t.name)}">${checkboxHTML(
                selected.has(t.name),
                ` data-t="${attr(t.name)}" aria-labelledby="${u}-t-${attr(t.name)}"`,
              )}<span class="tx"><span class="nm"><span id="${u}-t-${attr(t.name)}">${esc(toolTitle(t.name))}</span><code class="tl-code">${esc(
                t.name,
              )}</code></span>${t.description ? `<span class="ds">${esc(t.description)}</span>` : ''}${
                t.enabled ? '' : '<span class="offall" title="Switched off for every agent on the server">Off for every agent</span>'
              }</span><span class="rk">${riskChip(toolRisk(t))}</span></div>`,
            )
            .join('')}</div></section>`,
        )
        .join('')
    : '';
  const warn = `<div class="pm-warn" data-admin-warn role="alert" hidden><b>Careful:</b> with this on, the agent can turn tools back on, widen its own permissions and make or delete other agents. Only for automation you fully trust.</div>`;
  const lv = cardLevel(new Set(initial.scopes));
  const levels = o.levels
    ? `<section class="pm-sec"><h3>What it may do</h3><p>Pick one. You can change it any time.</p>
      <div class="ui-rcs pm-lv" role="radiogroup" aria-label="Access level">${LEVELS.map((l) =>
        radioCardHTML(l.id, l.id === lv, esc(l.label), esc(l.desc), l.id === 'write' ? 'Recommended' : ''),
      ).join('')}</div>
      <p class="pm-mix" data-mix hidden>Its permissions are a custom mix. Pick a level to replace them, or fine-tune them under Advanced.</p>${warn}</section>
    <details class="pm-adv"><summary>${CHEV}<span>Advanced<small>Switches and the tool list</small></span></summary><div class="pm-adv-b">`
    : '';
  return `<div class="pm">
    <div class="pm-sum" data-sum role="status" aria-live="polite"><span class="ic">${SHIELD}</span><span class="tx"><b></b><small></small></span></div>${levels}
    <section class="pm-sec"><h3>${o.levels ? 'Switches' : 'What it may do'}</h3><p>Turn on only what the app needs. You can change this any time.</p>
      <div class="pm-caps">${caps}</div>${o.levels ? '' : warn}
    </section>
    <section class="pm-sec" data-tools><h3>Which tools it may call</h3><p data-mcp-note></p>
      <div class="ui-rcs pm-mode" role="radiogroup" aria-label="Tool access">
        ${radioCardHTML('all', all, 'All tools', 'Every tool that is on for the server, including new ones.')}
        ${radioCardHTML(
          'some',
          !all,
          'Only the ones I pick',
          tools ? 'Tools added later stay blocked for this agent.' : 'The tool list could not be loaded right now.',
          '',
          !tools,
        )}
      </div>
      <div class="pm-pick" data-pick${all ? ' hidden' : ''}>
        <div class="pm-ph"><label class="pm-q">${SEARCH}<span class="sr-only">Search tools</span><input class="ui-input" type="search" data-q placeholder="Search tools" autocomplete="off"></label>
          <div class="pm-bar"><span class="pm-cnt" data-count aria-live="polite"></span>
            <button type="button" class="pm-chip" data-quick="read">Read-only tools</button>
            <button type="button" class="pm-chip" data-quick="all">All</button>
            <button type="button" class="pm-chip" data-quick="none">None</button></div></div>
        <div role="group" aria-label="Tools">${cats}</div><p class="pm-empty" data-empty hidden>No tool matches.</p>
      </div></section>${o.levels ? '</div></details>' : ''}</div>`;
}

export function wirePerms(b: HTMLElement, initial: Permissions, tools: ToolInfo[] | null): PermEditor {
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => b.querySelector<T>(sel)!;
  const qa = <T extends HTMLElement = HTMLElement>(sel: string): T[] => Array.from(b.querySelectorAll<T>(sel));
  const selected = new Set<string>(Array.isArray(initial.tools) ? initial.tools : (tools || []).map((t) => t.name));
  const scopes = new Set<KeyScope>(initial.scopes);
  let mode: 'all' | 'some' = initial.tools === '*' || !tools ? 'all' : 'some';
  const namesOf = (cat: string): string[] => (tools || []).filter((t) => (t.category || 'other') === cat).map((t) => t.name);
  const read = (): Permissions => ({
    scopes: SCOPES.map((s) => s.id).filter((s) => scopes.has(s)),
    tools: mode === 'some' ? [...selected].filter((n) => !tools || tools.some((t) => t.name === n)).sort() : '*',
  });
  const refresh = (): void => {
    const p = read();
    const mcp = p.scopes.includes('mcp');
    qa('[data-scope]').forEach((sw) => {
      const on = scopes.has(sw.dataset.scope as KeyScope);
      sw.setAttribute('aria-checked', String(on));
      sw.closest('.pm-cap')?.classList.toggle('on', on);
    });
    q('[data-admin-warn]').hidden = !scopes.has('admin');
    const lvBox = b.querySelector<HTMLElement>('.pm-lv');
    if (lvBox) {
      const lv = cardLevel(scopes);
      lvBox.querySelectorAll<HTMLElement>('.ui-rc').forEach((r) => {
        const on = r.dataset.v === lv;
        r.setAttribute('aria-checked', String(on));
        r.tabIndex = on || (!lv && r.dataset.v === 'write') ? 0 : -1;
      });
      q('[data-mix]').hidden = !!lv;
    }
    qa('.pm-mode .ui-rc').forEach((r) => {
      r.setAttribute('aria-checked', String(r.dataset.v === mode));
      r.tabIndex = r.dataset.v === mode ? 0 : -1;
    });
    q('[data-mcp-note]').textContent = mcp
      ? 'A tool switched off for the whole server stays blocked, whatever you pick here.'
      : 'MCP is off above, so this only matters once you turn it on.';
    q('[data-tools]').classList.toggle('pm-dim', !mcp);
    q('[data-pick]').hidden = mode === 'all';
    const total = tools ? tools.length : 0;
    q('[data-count]').innerHTML = `<b>${selected.size}</b> of ${total} picked`;
    qa('[data-t]').forEach((cb) => cb.setAttribute('aria-checked', String(selected.has(cb.dataset.t!))));
    qa('.pm-cat').forEach((c) => {
      const names = namesOf(c.dataset.cat!);
      const n = names.filter((x) => selected.has(x)).length;
      const cnt = c.querySelector<HTMLElement>('[data-cnt]')!;
      cnt.textContent = `${n}/${names.length}`;
      cnt.classList.toggle('all', n === names.length && n > 0);
    });
    const s = summarize(p, total || null);
    const sum = q('[data-sum]');
    sum.className = 'pm-sum' + (s.tone ? ' ' + s.tone : '');
    sum.querySelector('b')!.textContent = s.tools ? `${s.level} · ${s.tools}` : s.level;
    sum.querySelector('small')!.textContent = lvBox ? accessSentence(p) : sentence(p, total);
  };
  qa('[data-scope]').forEach(
    (sw) =>
      (sw.onclick = () => {
        const id = sw.dataset.scope as KeyScope;
        if (scopes.has(id)) scopes.delete(id);
        else scopes.add(id);
        refresh();
      }),
  );
  const lvBox = b.querySelector<HTMLElement>('.pm-lv');
  if (lvBox)
    wireRadios(lvBox, (v) => {
      // A level decides change and manage; whether it works from AI apps or scripts stays as it was.
      const keep: KeyScope[] = [...scopes].filter((x) => x === 'mcp' || x === 'read');
      scopes.clear();
      (keep.includes('mcp') ? keep : (['mcp', ...keep] as KeyScope[])).forEach((x) => scopes.add(x));
      if (v !== 'read') scopes.add('write');
      if (v === 'full') scopes.add('admin');
      // A tool list that could never change anything would make the level a lie.
      if (v !== 'read' && mode === 'some' && ![...selected].some((n) => toolRisk({ name: n }) !== 'read')) mode = 'all';
      refresh();
    });
  wireRadios(q('.pm-mode'), (v) => {
    mode = v === 'some' ? 'some' : 'all';
    refresh();
  });
  qa('.pm-tool').forEach(
    (row) =>
      (row.onclick = () => {
        const n = row.dataset.tool!;
        if (selected.has(n)) selected.delete(n);
        else selected.add(n);
        refresh();
      }),
  );
  qa('.pm-tg').forEach(
    (t) =>
      (t.onclick = () => {
        const open = t.getAttribute('aria-expanded') !== 'true';
        t.setAttribute('aria-expanded', String(open));
        b.querySelector<HTMLElement>('#' + CSS.escape(t.getAttribute('aria-controls')!))!.hidden = !open;
      }),
  );
  qa('[data-catset]').forEach(
    (btn) =>
      (btn.onclick = () => {
        const on = btn.dataset.catset === '1';
        namesOf(btn.closest<HTMLElement>('.pm-cat')!.dataset.cat!).forEach((n) => (on ? selected.add(n) : selected.delete(n)));
        refresh();
      }),
  );
  qa('[data-quick]').forEach(
    (btn) =>
      (btn.onclick = () => {
        const k = btn.dataset.quick;
        selected.clear();
        if (k === 'all') (tools || []).forEach((t) => selected.add(t.name));
        if (k === 'read') readOnlyTools(tools || []).forEach((n) => selected.add(n));
        refresh();
      }),
  );
  const search = b.querySelector<HTMLInputElement>('[data-q]');
  if (search) {
    search.oninput = () => {
      const s = search.value.trim().toLowerCase();
      let any = false;
      qa('.pm-cat').forEach((cat) => {
        let shown = 0;
        cat.querySelectorAll<HTMLElement>('.pm-tool').forEach((row) => {
          const t = (tools || []).find((x) => x.name === row.dataset.tool);
          const ok = !!t && toolMatches(t, s);
          row.hidden = !ok;
          if (ok) shown++;
        });
        cat.hidden = !shown;
        if (shown) any = true;
        // While searching every matching group opens; clearing the search folds them again.
        const tg = cat.querySelector<HTMLElement>('.pm-tg')!;
        const open = !!s && shown > 0;
        tg.setAttribute('aria-expanded', String(open));
        cat.querySelector<HTMLElement>('.pm-cat-b')!.hidden = !open;
      });
      q('[data-empty]').hidden = any;
    };
    search.onkeydown = (e) => {
      if (e.key === 'Enter') e.preventDefault();
    };
  }
  refresh();
  return {
    read,
    problem: () => {
      const p = read();
      if (!p.scopes.length) return 'Turn on at least one thing it may do, or turn the agent off instead.';
      if (Array.isArray(p.tools) && !p.tools.length && p.scopes.includes('mcp')) return 'Pick at least one tool, or choose All tools.';
      return '';
    },
  };
}
