// The Agents area's shared data (keys, OAuth sign-ins, apps, usage) and its confirmed actions; keys.ts,
// agent-page.ts and agent-new.ts read from here and repaint on change (docs/contracts/tools-permissions.md).

import { apiGet, apiPost, updateKeyPermissions } from '../api';
import { $, esc } from '../dom';
import { Modal } from '../modal';
import { go, replaceHistory, setKeysRoute } from '../router';
import { state } from '../state';
import { toast } from '../toast';
import { agentKey, avatarHTML, setAgentColors } from '../control/agents';
import { appOf, loadAgentApps } from '../control/agent-apps';
import { appById, type ConnectKey } from '../control/connect';
import { loadFeed } from '../control/feed';
import { cachedCatalog, loadCatalog, scopesOf, toolsOf, type Permissions } from '../control/perms';
import { ago, codeHTML, copyText, ICO, openSheet, wireCopy, type Sheet } from '../control/ui';
import type { KeyCreated, KeyRow, KeysResult } from '../types';

export const KEY_PATHS = {
  create: '/api/keys',
  roll: '/api/keys/roll',
  update: '/api/keys/update',
  del: '/api/keys/delete',
  restore: '/api/keys/restore',
  reveal: '/api/keys/reveal',
};

/** An agent counts as active when it made a call this recently (seconds). */
export const ACTIVE_SECS = 300;

export interface KeyRowFull extends KeyRow {
  prefix?: string;
  created?: number;
  used_tools?: string[];
}

export interface Usage {
  last: number;
  day: number;
  /** Calls per hour over the last 24 hours, oldest first. */
  spark: number[];
}

export type Status = 'active' | 'idle' | 'never' | 'off';

interface AgentsData {
  keys: KeyRowFull[];
  /** Keys an AI app got by signing in over OAuth, with the app's client name. */
  oauth: Map<string, string>;
  usage: Map<string, Usage>;
  loaded: boolean;
  /** The last load failed with this message. */
  error: string;
}

export const data: AgentsData = { keys: [], oauth: new Map(), usage: new Map(), loaded: false, error: '' };

/** Secrets made in this page load (created or rolled), by key id: memory only, never stored. */
export const freshSecrets = new Map<string, string>();

export const nameOf = (k: { id: string; name?: string }): string => k.name || k.id;
export const permsOf = (k: KeyRow): Permissions => ({ scopes: scopesOf(k), tools: toolsOf(k) });
export const keyById = (id: string): KeyRowFull | undefined => data.keys.find((k) => k.id === id);

/** Usage is kept by key id when the log names it (a renamed agent keeps its calls), else by name. */
export function usageOf(k: KeyRow): Usage | undefined {
  return data.usage.get('id:' + k.id) || data.usage.get(agentKey(nameOf(k)));
}

interface AppInfo {
  id: string;
  label: string;
  /** Guessed from the name or the OAuth client, not chosen yet. */
  guessed: boolean;
}

export function appFor(k: KeyRow): AppInfo {
  const a = appOf(k, data.oauth.get(k.id));
  const s = a.id ? appById(a.id) : undefined;
  return { id: s ? a.id : '', label: s?.label || '', guessed: a.guessed };
}

export function statusOf(k: KeyRowFull, now = Date.now() / 1000): { st: Status; label: string; seen: string } {
  const u = usageOf(k);
  const seen = u ? (ago(u.last) === 'now' ? 'Just now' : ago(u.last) + ' ago') : k.uses ? 'Over a week ago' : 'Never';
  if (k.enabled === false) return { st: 'off', label: 'Off', seen };
  if (u && now - u.last < ACTIVE_SECS) return { st: 'active', label: 'Active', seen };
  if (u || k.uses) return { st: 'idle', label: 'Idle', seen };
  return { st: 'never', label: 'Never used', seen };
}

export function connectKey(k: KeyRowFull): ConnectKey {
  return { id: k.id, name: nameOf(k), revealable: k.revealable, oauth: data.oauth.has(k.id), perms: permsOf(k), used: (k.uses || 0) > 0 };
}

const listeners = new Set<() => void>();

/** Repaint whatever shows agents after every load (returns the unsubscribe). */
export function onAgentsData(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error('agents repaint failed', e);
    }
  }
}

/** Bumped on every load so a slower, older load cannot paint over a newer one. */
let loadSeq = 0;
let inflight: Promise<void> | null = null;

/** Fetch keys, OAuth connections, app choices, the catalog and the feed, then tell the views. */
export function loadAgents(reload = false): Promise<void> {
  if (inflight && !reload) return inflight;
  const seq = ++loadSeq;
  const run = (async (): Promise<void> => {
    const cat = loadCatalog(reload || !cachedCatalog());
    const apps = loadAgentApps(reload);
    const feedP = loadFeed('7d', 1500).catch(() => []);
    try {
      const d = await apiGet<KeysResult | KeyRow[]>('/api/keys');
      const keys = (Array.isArray(d) ? d : d.keys || []) as KeyRowFull[];
      const o = await apiGet<{ clients?: { client_id: string; name?: string; client_name?: string }[]; connections?: { key_id: string; client_id: string }[] }>(
        '/api/oauth/clients',
      ).catch(() => null);
      await Promise.all([cat, apps]);
      const feed = await feedP;
      if (seq !== loadSeq) return;
      data.keys = keys;
      setAgentColors(keys);
      const names = new Map((o?.clients || []).map((c) => [c.client_id, c.name || c.client_name || '']));
      data.oauth = new Map((o?.connections || []).map((c) => [c.key_id, names.get(c.client_id) || '']));
      // Usage per agent name: last call, calls in 24h and an hourly sparkline.
      const now = Date.now() / 1000;
      const usage = new Map<string, Usage>();
      for (const it of feed) {
        if (it.source !== 'agent') continue;
        const k = typeof it.raw.actor_id === 'string' && it.raw.actor_id ? 'id:' + it.raw.actor_id : agentKey(it.actor);
        let u = usage.get(k);
        if (!u) usage.set(k, (u = { last: it.ts, day: 0, spark: new Array(24).fill(0) }));
        if (it.ts > u.last) u.last = it.ts;
        const h = Math.floor((now - it.ts) / 3600);
        if (h >= 0 && h < 24) {
          u.day++;
          u.spark[23 - h]++;
        }
      }
      data.usage = usage;
      data.loaded = true;
      data.error = '';
    } catch (e) {
      if (seq !== loadSeq) return;
      data.error = (e as Error).message || 'Could not load the agents';
    }
    emit();
  })();
  inflight = run;
  void run.finally(() => {
    if (inflight === run) inflight = null;
  });
  return run;
}

/** A call just showed up live: bump the agent's last call (true when something changed). */
export function bumpSeen(seen: { kind: string; id?: string | null; actor: string; lastAt: number }[]): boolean {
  let changed = false;
  for (const s of seen) {
    if (s.kind !== 'agent') continue;
    const k = data.keys.find((x) => (s.id ? x.id === s.id : agentKey(nameOf(x)) === agentKey(s.actor)));
    if (!k) continue;
    const key = data.usage.has('id:' + k.id) || s.id ? 'id:' + k.id : agentKey(nameOf(k));
    const last = Math.floor(s.lastAt / 1000);
    const u = data.usage.get(key);
    if (!u) data.usage.set(key, { last, day: 0, spark: new Array(24).fill(0) });
    else if (last > u.last) u.last = last;
    else continue;
    changed = true;
  }
  return changed;
}

/** Go to an address inside the Agents page: '' (the list), 'new', 'new/<client>', '<id>' or '<id>/<tab>'. */
export function navAgents(sub = '', replace = false): void {
  setKeysRoute(sub ? '/agents/' + sub : null);
  if (replace) replaceHistory();
  go('keys');
}

/** The href of an address inside the Agents page. */
export function agentsHref(sub = ''): string {
  return '/agents' + (sub ? '/' + sub.split('/').map(encodeURIComponent).join('/') : '');
}

/** Follow an in-app link with a plain click; let modified clicks open a new tab. */
export function wireAgentLinks(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLAnchorElement>('a[data-nav]').forEach((a) => {
    a.onclick = (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navAgents(a.dataset.nav || '');
    };
  });
}

export async function createAgent(name: string, p: Permissions): Promise<{ key: ConnectKey; secret: string } | null> {
  try {
    const r = await apiPost<KeyCreated>(KEY_PATHS.create, { name, scopes: p.scopes, tools: p.tools });
    if (!r || !r.id || !r.key) throw new Error('the server returned no key');
    if (Array.isArray(p.tools)) {
      try {
        await updateKeyPermissions({ id: r.id, scopes: p.scopes, tools: p.tools });
      } catch (e) {
        toast('Agent created, but its tool list was not saved: ' + (e as Error).message, 'err', 6000);
      }
    }
    freshSecrets.set(r.id, r.key);
    void loadAgents(true);
    return { key: { id: r.id, name: r.name || name, perms: p }, secret: r.key };
  } catch (e) {
    toast('Could not create the agent: ' + (e as Error).message, 'err');
    return null;
  }
}

export async function toggleKey(k: KeyRowFull): Promise<void> {
  const on = k.enabled !== false;
  try {
    await apiPost(KEY_PATHS.update, { id: k.id, enabled: !on });
    toast(on ? `${nameOf(k)} is turned off` : `${nameOf(k)} is turned on`, 'ok');
    await loadAgents(true);
  } catch (e) {
    toast('Failed: ' + (e as Error).message, 'err');
  }
}

/** Make a new key after a confirm; the new one is shown once in a short sheet. */
export function rollKey(k: KeyRowFull, onSetup?: () => void): void {
  const name = nameOf(k);
  Modal.confirm(
    'Make a new key',
    `${name}'s current key stops working at once. The new key is shown next; update the app that uses ${name}.`,
    'Make a new key',
    async () => {
      try {
        const r = await apiPost<KeyCreated>(KEY_PATHS.roll, { id: k.id });
        Modal.close();
        const secret = (r && (r.key || r.secret)) || '';
        if (secret) freshSecrets.set(k.id, secret);
        showSecret(k, secret, onSetup);
        void loadAgents(true);
      } catch (e) {
        toast('Could not make a new key: ' + (e as Error).message, 'err');
      }
    },
    false,
  );
}

/** The one-time secret, with a way into the setup that already holds it. */
function showSecret(k: KeyRowFull, secret: string, onSetup?: () => void): void {
  const name = nameOf(k);
  const has = !!secret;
  openSheet({
    title: 'New key made',
    sub: name,
    lead: avatarHTML(name, 36, '', k.id),
    width: 560,
    body: `<div class="ky-secret" role="note">${ICO.key}<span><b>This key is shown once. Copy it now and keep it private.</b> Anyone with this key can read and write your notes as ${esc(
      name,
    )}. The old key stopped working.</span></div>
      ${codeHTML(has ? secret : 'The server did not return a key.', 'Copy key')}`,
    actions: [
      { label: 'Copy key', icon: ICO.copy, left: true, run: () => void copyText(has ? secret : '', 'Key copied') },
      ...(has && onSetup
        ? [{ label: 'Set up with the new key', cls: 'primary', icon: ICO.plug, run: (s: Sheet) => (s.close(), onSetup()) }]
        : [{ label: 'Done', cls: 'primary', run: (s: Sheet) => s.close() }]),
    ],
  });
}

/** Show a sealed key again, after the owner's password. */
export function openReveal(k: KeyRowFull): void {
  const name = nameOf(k);
  openSheet({
    title: 'Show key',
    sub: name,
    lead: avatarHTML(name, 36, '', k.id),
    width: 520,
    body: `<form id="krForm" class="ui-fld" style="margin:0"><label for="krPw">Your Memora password</label>
        <input id="krPw" class="ui-input" type="password" autocomplete="current-password">
        <span class="ui-help">The key is stored sealed on the server; your password unlocks it.</span></form>
      <div id="krOut" class="ky-reveal" style="margin-top:16px"></div>`,
    actions: [
      { label: 'Close', cls: 'ghost', left: true, run: (s) => s.close() },
      { label: 'Show key', cls: 'primary', icon: ICO_EYE, run: (s) => reveal(s) },
    ],
    onOpen: (s) => {
      ($('#krForm', s.body) as HTMLFormElement).onsubmit = (e) => {
        e.preventDefault();
        void reveal(s);
      };
    },
  });
  async function reveal(s: Sheet): Promise<void> {
    const pw = $('#krPw', s.body) as HTMLInputElement;
    if (!pw.value) {
      toast('Enter your password', 'warn');
      pw.focus();
      return;
    }
    try {
      const r = await apiPost<{ key?: string }>(KEY_PATHS.reveal, { id: k.id, current: pw.value });
      if (!r || !r.key) throw new Error('the server returned no key');
      pw.value = '';
      const out = $('#krOut', s.body);
      out.innerHTML = codeHTML(r.key, 'Copy key');
      wireCopy(out);
    } catch (e) {
      toast((e as Error).message || 'Could not show the key', 'err');
    }
  }
}

/** Delete after a confirm; it can be restored until the app reloads. */
export function delKey(k: KeyRowFull, after?: () => void): void {
  const name = nameOf(k);
  Modal.confirm(
    'Delete agent',
    `${name} will be deleted and its key stops working at once. You can restore it until you reload the app.`,
    'Delete agent',
    async () => {
      try {
        await apiPost(KEY_PATHS.del, { id: k.id });
        state.keysDeleted.push({ id: k.id, name: k.name });
        freshSecrets.delete(k.id);
        Modal.close();
        toast(name + ' deleted', 'ok');
        after?.();
        void loadAgents(true);
      } catch (e) {
        toast('Failed: ' + (e as Error).message, 'err');
      }
    },
  );
}

export async function restoreKey(id: string): Promise<void> {
  try {
    await apiPost<KeyCreated>(KEY_PATHS.restore, { id });
    state.keysDeleted = state.keysDeleted.filter((k) => k.id !== id);
    toast('Agent restored', 'ok');
    void loadAgents(true);
  } catch (e) {
    toast('Could not restore: ' + (e as Error).message, 'err');
  }
}

const svg = (d: string): string => `<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICO_EDIT = svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>');
export const ICO_TRASH = svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>');
export const ICO_POWER = svg('<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>');
export const ICO_EYE = svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>');
export const ICO_CHEV = svg('<path d="m9 6 6 6-6 6"/>');
export const ICO_BACK = svg('<path d="M19 12H5M11 6l-6 6 6 6"/>');
export const ICO_RESTORE = svg('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>');
export const ICO_LOCK = svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');
export const ICO_ACTIVITY = svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>');
export const ICO_INFO = svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>');

/** Styles the small sheets above share (secret, reveal). */
export const SHEET_CSS = `
.ky-secret{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:12px;margin:0 0 10px;font-size:12.5px;line-height:1.5;
  border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-soft)}
.ky-secret .cc-i{color:var(--warn);margin-top:1px}
.ky-secret+.cc-code-wrap .cc-code,.ky-reveal .cc-code{white-space:pre-wrap;word-break:break-all}
.sd{width:8px;height:8px;border-radius:50%;flex:none;background:var(--text-3)}
.sd.active{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}
.sd.never{background:transparent;box-shadow:inset 0 0 0 1.5px var(--text-3)}
.sd.off{background:var(--danger)}
`;
