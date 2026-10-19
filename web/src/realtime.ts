// Realtime channel over /ws: reconnect with backoff, refresh on mutations,
// and fan server events out on the bus:
//
//   ai_activity           -> bus `activity`   (AgentActivity)
//   node_* mutations      -> bus `mutation`   (raw event)
//   socket state          -> bus `connection` ('on' | 'connecting' | 'off')
//   hello / presence      -> bus `presence`   (connected browsers)
//
// It also tracks which agents are active right now and paints the top bar
// indicator and its popover.

import { $ } from './dom';
import { emit, type AgentActivity } from './bus';
import { loadCore } from './core-data';
import { hooks } from './hooks';
import { state } from './state';
import { trunc } from './format';
import { toast } from './toast';
import { activityToastAllowed } from './storage';
import { renderRtPop, resetRtPop, type PopAgent } from './ui/rt-pop';
import { flyHome, flyIn } from './ui/agent-flight';
import type { KeyRow, KeysResult, WsEvent } from './types';
import { apiGet } from './api';
import { AGENT_COLORS_EVENT, setAgentColors } from './control/agents';

const MUTATIONS = new Set(['node_created', 'node_updated', 'node_deleted', 'node_renamed']);
/** Tools whose success toasts from the pins list instead of the activity event. */
const PIN_TOOLS = new Set(['pin', 'unpin']);
/** An agent counts as active while a call is open or for this long after one. */
const ACTIVE_MS = 5_000;
/** Agents seen within this window are listed in the popover. */
const RECENT_MS = 30 * 60_000;

export type ConnState = 'on' | 'connecting' | 'off';

export interface AgentInfo {
  actor: string;
  /** API key id when known (tells same-named agents apart). */
  id?: string;
  kind: 'agent' | 'user';
  lastAt: number;
  lastLabel: string;
  lastAction: string;
  /** Calls started and not yet ended. */
  open: number;
  /** Notes the latest call touched (where it flies to on the open view). */
  lastPaths?: string[];
  calls: number;
}

const agents = new Map<string, AgentInfo>();
const agentListeners: ((active: number, list: AgentInfo[]) => void)[] = [];

/** Subscribe to the active-agent count (fires on every change). */
export function onAgents(fn: (active: number, list: AgentInfo[]) => void): () => void {
  agentListeners.push(fn);
  fn(activeAgents().length, agentList());
  return () => {
    const i = agentListeners.indexOf(fn);
    if (i >= 0) agentListeners.splice(i, 1);
  };
}

function isActive(a: AgentInfo, now = Date.now()): boolean {
  // A start without an end is trusted for a few minutes at most.
  return (a.open > 0 && now - a.lastAt < 2 * 60_000) || now - a.lastAt < ACTIVE_MS;
}

/** Agents (not browser users) active right now. */
export function activeAgents(): AgentInfo[] {
  const now = Date.now();
  return agentList().filter((a) => a.kind === 'agent' && isActive(a, now));
}

/** Every actor seen recently, newest first. */
export function agentList(): AgentInfo[] {
  const now = Date.now();
  return Array.from(agents.values())
    .filter((a) => now - a.lastAt < RECENT_MS)
    .sort((a, b) => b.lastAt - a.lastAt);
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function myName(): string {
  return ((state.me && (state.me.user || state.me.username)) || '').trim();
}

/** Agents active at the last repaint, by key id (or name). */
let wasActive = new Map<string, AgentInfo>();

/** Enabled API keys: every agent that could be working. */
let keyList: { id: string; name: string }[] | null = null;
let keysAt = 0;

export async function loadKeys(): Promise<void> {
  keysAt = Date.now();
  try {
    const d = await apiGet<KeysResult | KeyRow[]>('/api/keys');
    const rows = Array.isArray(d) ? d : d.keys || [];
    keyList = rows.filter((k) => k.enabled !== false).map((k) => ({ id: k.id, name: k.name || k.id }));
    setAgentColors(rows);
    RT.paint();
  } catch {
    /* keep the last list; idle falls back to recently seen agents */
  }
}

/** The API key id behind an event: its own id, or the key with that name. */
function keyOf(aid: string, actor: string): string {
  if (aid) return aid;
  return keyList?.find((k) => k.name === actor)?.id || '';
}

/** Agents with nothing running right now. */
function idleCount(active: AgentInfo[]): number {
  const busy = new Set(active.map((a) => a.id || a.actor));
  if (keyList) return keyList.filter((k) => !busy.has(k.id) && !busy.has(k.name)).length;
  return agentList().filter((a) => a.kind === 'agent' && !busy.has(a.id || a.actor)).length;
}

/** Restart a one-shot CSS animation class. */
function replay(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

const STATE_LABEL: Record<ConnState, string> = { on: 'Live', connecting: 'Connecting', off: 'Offline' };

export const RT = {
  ws: null as WebSocket | null,
  tries: 0,
  timer: 0 as unknown as number,
  state: 'connecting' as ConnState,
  clients: 0,
  lastActive: -1,
  /** Set once the server was shut down on purpose: never reconnect. */
  stopped: false,

  setState(kind: ConnState): void {
    const changed = kind !== this.state;
    this.state = kind;
    this.paint();
    if (changed) emit('connection', kind);
  },

  /** Repaint the indicator (state, label, active agents). */
  paint(): void {
    const pill = $('#rtPill');
    const act = activeAgents();
    const n = act.length;
    // Each agent that woke up flies into the open view; each that went idle flies home.
    const now = new Map(act.map((a) => [a.id || a.actor, a]));
    for (const [k, a] of now) if (!wasActive.has(k)) flyIn({ actor: a.actor, id: a.id, paths: a.lastPaths || [] });
    for (const [k, a] of wasActive) if (!now.has(k)) flyHome({ actor: a.actor, id: a.id, paths: a.lastPaths || [] });
    wasActive = now;
    const idle = idleCount(act);
    if (!this.stopped && Date.now() - keysAt > 60_000) void loadKeys();
    pill.dataset.state = this.state;
    $('#rtText').textContent = STATE_LABEL[this.state];
    const count = $('#rtAgentN');
    const box = $('#rtAgents');
    const idleBox = $('#rtIdle');
    // An agent waking up: the moon blinks awake and the active count jumps.
    // One going to sleep: a "z" drifts up from the moon.
    if (this.lastActive >= 0 && n > this.lastActive) {
      box.classList.remove('drop');
      idleBox.classList.remove('sleep');
      replay(idleBox, 'wake');
      // The robot powers up as the spark from the moon arrives.
      window.setTimeout(() => replay(box, 'bump'), 260);
    } else if (this.lastActive >= 0 && n < this.lastActive) {
      box.classList.remove('bump');
      idleBox.classList.remove('wake');
      replay(box, 'drop');
      window.setTimeout(() => replay(idleBox, 'sleep'), 200);
    }
    count.textContent = String(n);
    $('#rtIdleN').textContent = String(idle);
    box.classList.toggle('on', n > 0);
    idleBox.classList.toggle('none', idle === 0);
    pill.setAttribute(
      'aria-label',
      `Realtime ${STATE_LABEL[this.state].toLowerCase()}, ${n} agent${n === 1 ? '' : 's'} active, ${idle} idle. Show details`,
    );
    pill.title =
      this.state === 'on'
        ? `Live updates on · ${n} active · ${idle} idle`
        : this.state === 'off'
          ? 'Live updates offline, retrying'
          : 'Connecting to live updates';
    if (n !== this.lastActive) {
      this.lastActive = n;
      const list = agentList();
      for (const fn of agentListeners) fn(n, list);
    }
    if (!$('#rtPop').classList.contains('hidden')) this.renderPop();
  },

  url(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  },

  start(): void {
    this.wirePop();
    // Every second, so an agent goes idle (and flies home) right on time.
    window.setInterval(() => this.paint(), 1000);
    if (!('WebSocket' in window)) {
      this.setState('off');
      return;
    }
    window.addEventListener('online', () => {
      this.tries = 0;
      this.kick();
    });
    window.addEventListener('offline', () => this.setState('off'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state === 'off') {
        this.tries = 0;
        this.kick();
      }
    });
    this.setState('connecting');
    this.kick();
  },

  /** Stop for good (the server was shut down): close the socket, no retries. */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    const sock = this.ws;
    this.ws = null;
    if (sock) {
      sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
      try {
        sock.close();
      } catch {
        /* already closed */
      }
    }
    this.setState('off');
  },

  kick(): void {
    clearTimeout(this.timer);
    if (this.stopped) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    let sock: WebSocket;
    try {
      sock = new WebSocket(this.url());
    } catch {
      this.retry();
      return;
    }
    this.ws = sock;
    this.setState('connecting');
    sock.onopen = () => {
      this.tries = 0;
      this.setState('on');
    };
    sock.onmessage = (ev: MessageEvent<string>) => {
      if (this.ws !== sock) return;
      let d: WsEvent | null = null;
      try {
        d = JSON.parse(ev.data) as WsEvent;
      } catch {
        return;
      }
      this.handle(d);
    };
    sock.onclose = () => {
      if (this.ws !== sock) return;
      this.setState('off');
      this.retry();
    };
    sock.onerror = () => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
    };
  },

  retry(): void {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.tries++;
    const wait = Math.min(30000, 1000 * Math.pow(1.6, Math.min(this.tries, 6)));
    this.timer = setTimeout(() => this.kick(), wait);
    if (this.tries > 1) this.setState('off');
  },

  handle(d: WsEvent): void {
    const t = d && d.type;
    if (!t) return;
    if (t === 'hello' || t === 'presence') {
      if (typeof d.clients === 'number') {
        this.clients = d.clients;
        emit('presence', d.clients);
      }
      if (t === 'hello') this.setState('on');
      else this.paint();
      return;
    }
    if (d.replay) return;
    // A vault mutation from another writer: refresh the view, never the editor.
    if (MUTATIONS.has(t)) {
      emit('mutation', d);
      if (!state.editing) {
        void loadCore().then(() => {
          hooks.refreshPage();
        });
      }
      return;
    }
    if (t === 'ai_activity') {
      this.activity(d);
      return;
    }
    if (t === 'vault_changed') {
      hooks.vaultChanged(String(d.vault || ''));
      return;
    }
    if (t === 'key_color') {
      void loadKeys();
      return;
    }
    if (t === 'folder_changed') {
      if (!state.editing) void loadCore().then(() => hooks.refreshPage());
      return;
    }
    if (t === 'privacy_changed') {
      window.dispatchEvent(new Event('memora:privacy'));
      return;
    }
    if (t === 'pins_changed') {
      const actor = typeof d.actor === 'string' ? d.actor : '';
      emit(
        'pins',
        actor
          ? {
              actor,
              actorId: typeof d.actor_id === 'string' ? d.actor_id : '',
              kind: d.actor_kind === 'user' ? 'user' : 'agent',
            }
          : null,
      );
      return;
    }
    if (t === 'folder_meta' || t === 'actor_alias') {
      if (!state.editing) void loadCore().then(() => hooks.refreshTree());
    }
  },

  activity(d: WsEvent): void {
    const actor = String(d.actor || 'agent');
    const phase = d.phase === 'end' ? 'end' : 'start';
    const ev: AgentActivity = {
      actor,
      action: String(d.action || ''),
      label: String(d.label || d.action || 'activity'),
      phase,
      paths: strArray(d.paths),
      at: Date.now(),
    };
    if (typeof d.actor_id === 'string') ev.actorId = d.actor_id;
    if (typeof d.actor_kind === 'string') ev.kind = d.actor_kind;
    if (typeof d.ok === 'boolean') ev.ok = d.ok;
    if (typeof d.ms === 'number') ev.ms = d.ms;

    const kind: 'agent' | 'user' =
      d.actor_kind === 'user' || (d.actor_kind == null && actor === myName() && !!actor) ? 'user' : 'agent';
    const aid = typeof d.actor_id === 'string' && d.actor_id ? d.actor_id : '';
    const slot = aid || actor;
    const a: AgentInfo = agents.get(slot) || {
      id: aid || undefined,
      actor,
      kind,
      lastAt: 0,
      lastLabel: '',
      lastAction: '',
      open: 0,
      calls: 0,
    };
    a.kind = kind;
    a.lastAt = ev.at;
    if (phase === 'start') {
      a.open++;
      a.calls++;
      a.lastLabel = ev.label;
      a.lastAction = ev.action;
      if (ev.paths.length) a.lastPaths = ev.paths;
    } else {
      a.open = Math.max(0, a.open - 1);
    }
    agents.set(slot, a);

    emit('activity', ev);
    this.paint();

    if (phase === 'start') {
      // The activity page refreshes; other pages toast, except the brain,
      // which shows activity itself.
      if (state.page === 'logs') hooks.refreshLogs?.();
      // Pin changes toast once the list reloads ("agent1 pinned Plan", see vault/store).
      else if (
        state.page !== 'brain' &&
        !state.editing &&
        kind === 'agent' &&
        !PIN_TOOLS.has(ev.action) &&
        activityToastAllowed(keyOf(aid, actor))
      ) {
        toast(actor + ' · ' + trunc(ev.label, 70), 'ok', 2600);
      }
    } else if (
      ev.ok === false &&
      state.page !== 'brain' &&
      state.page !== 'logs' &&
      !state.editing &&
      activityToastAllowed(kind === 'agent' ? keyOf(aid, actor) : '')
    ) {
      toast(actor + ' · ' + trunc(ev.label, 60) + ' failed', 'warn', 3200);
    }
  },

  /* ── popover ─────────────────────────────────────────────────────── */

  wirePop(): void {
    // A key got a new color: repaint what shows agents.
    window.addEventListener(AGENT_COLORS_EVENT, () => {
      this.paint();
      if (state.page === 'logs' || state.page === 'home' || state.page === 'keys') hooks.refreshPage();
    });
    const pill = $('#rtPill');
    const pop = $('#rtPop');
    pill.onclick = (e) => {
      e.stopPropagation();
      if (pop.classList.contains('hidden')) this.openPop();
      else this.closePop();
    };
    document.addEventListener('click', (e) => {
      if (pop.classList.contains('hidden')) return;
      const t = e.target as Node;
      if (!pop.contains(t) && !pill.contains(t)) this.closePop();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !pop.classList.contains('hidden')) {
        e.preventDefault();
        this.closePop(true);
      }
    });
  },

  openPop(): void {
    // Hang the panel right under the pill, flush with its right edge.
    const r = $('#rtPill').getBoundingClientRect();
    const pop = $('#rtPop');
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    pop.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    this.renderPop();
    pop.classList.remove('hidden');
    $('#rtPill').setAttribute('aria-expanded', 'true');
  },

  closePop(refocus = false): void {
    $('#rtPop').classList.add('hidden');
    resetRtPop();
    $('#rtPill').setAttribute('aria-expanded', 'false');
    if (refocus) $('#rtPill').focus?.();
  },

  renderPop(): void {
    const now = Date.now();
    const seen = agentList().filter((a) => a.kind === 'agent');
    const bySlot = new Map(seen.map((a) => [a.id || a.actor, a]));
    // Every enabled key, plus agents seen recently whose key is gone.
    const known = new Set((keyList || []).flatMap((k) => [k.id, k.name]));
    const rows = [
      ...(keyList || []).map((k) => ({ id: k.id, name: k.name, keyed: true })),
      ...seen
        .filter((a) => !known.has(a.id || '') && !(keyList && !a.id && known.has(a.actor)))
        .map((a) => ({ id: a.id || '', name: a.actor, keyed: !keyList })),
    ];
    const agents: PopAgent[] = rows.map((r) => {
      // Older events carry no key id: fall back to the name.
      const a = bySlot.get(r.id) || bySlot.get(r.name);
      return {
        name: r.name,
        id: r.id || undefined,
        active: !!a && isActive(a, now),
        keyed: r.keyed,
        lastAt: a?.lastAt || 0,
        lastAction: a?.lastAction || '',
        lastLabel: a?.lastLabel || '',
      };
    });
    // Working agents first, then the most recently seen.
    agents.sort((x, y) => Number(y.active) - Number(x.active) || y.lastAt - x.lastAt || x.name.localeCompare(y.name));
    renderRtPop($('#rtPop'), {
      state: this.state,
      agents,
      close: () => this.closePop(),
      retry: () => {
        this.tries = 0;
        this.kick();
      },
      rerender: () => this.renderPop(),
    });
  },
};
