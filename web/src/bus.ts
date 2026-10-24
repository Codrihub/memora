// In-page event bus: realtime.ts emits server events here.

import type { WsEvent } from './types';

export interface AgentActivity {
  /** Who acted: the API key name for agents, the username for the browser. */
  actor: string;
  action: string;
  label: string;
  phase: string;
  /** Notes the action touched (vault-relative paths), when known. */
  paths: string[];
  /** Whether the call succeeded (only on `end`). */
  ok?: boolean;
  /** Milliseconds the call took (only on `end`). */
  ms?: number;
  at: number;
  /** API key id of an agent (tells same-named agents apart). */
  actorId?: string;
  callId?: string;
  /** `agent` (API key) or `user` (browser). */
  kind?: string;
}

/** Who changed the pins over MCP (`pins_changed` carries no paths). */
export interface PinsChange {
  /** Display name: the API key's name, or the user name. */
  actor: string;
  /** API key id (or user name). */
  actorId: string;
  /** `agent` (API key) or `user` (browser session over MCP). */
  kind: 'agent' | 'user';
}

interface BusEvents {
  activity: AgentActivity;
  mutation: WsEvent;
  connection: 'on' | 'connecting' | 'off';
  /** Number of browsers connected to the server. */
  presence: number;
  /** Names the actor when the change came over MCP. */
  pins: PinsChange | null;
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;
const handlers = new Map<keyof BusEvents, Set<(payload: never) => void>>();

/** Returns an unsubscribe function. */
export function on<K extends keyof BusEvents>(type: K, fn: Handler<K>): () => void {
  let set = handlers.get(type);
  if (!set) handlers.set(type, (set = new Set()));
  const h = fn as (payload: never) => void;
  set.add(h);
  return () => set.delete(h);
}

export function emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void {
  handlers.get(type)?.forEach((fn) => {
    try {
      (fn as Handler<K>)(payload);
    } catch (e) {
      console.error('bus handler failed', type, e);
    }
  });
}
