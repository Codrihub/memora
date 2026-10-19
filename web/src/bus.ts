// Tiny in-page event bus. realtime.ts emits server events here so any view
// (brain, graph, canvas, activity) can react without importing each other.

import type { WsEvent } from './types';

export interface AgentActivity {
  /** Who acted: the API key name for agents, the username for the browser. */
  actor: string;
  /** Tool or action name, e.g. `search_memory`. */
  action: string;
  /** Human-readable summary. */
  label: string;
  /** `start` or `end`. */
  phase: string;
  /** Notes the action touched (vault-relative paths), when known. */
  paths: string[];
  /** Whether the call succeeded (only on `end`). */
  ok?: boolean;
  /** Milliseconds the call took (only on `end`). */
  ms?: number;
  /** Client timestamp when the event arrived. */
  at: number;
  /** API key id of an agent (tells same-named agents apart). */
  actorId?: string;
  /** `agent` (API key) or `user` (browser). */
  kind?: string;
}

export interface BusEvents {
  /** An agent or user action (from `ai_activity`). */
  activity: AgentActivity;
  /** A vault mutation (node_created / node_updated / node_deleted / node_renamed). */
  mutation: WsEvent;
  /** Realtime connection state. */
  connection: 'on' | 'connecting' | 'off';
  /** Number of browsers connected to the server. */
  presence: number;
  /** The owner's pins changed on the server (`pins_changed`); reload them. */
  pins: null;
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;
const handlers = new Map<keyof BusEvents, Set<(payload: never) => void>>();

/** Subscribe; returns an unsubscribe function. */
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
