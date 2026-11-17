// Mnemo, the notes agent: types and calls for /api/assistant/*, and the streaming chat reader.

import { apiGet, apiPost } from '../api';

export const MNEMO = 'Mnemo';

export type ProviderKind = 'openai' | 'anthropic' | 'custom';
export type ApiStyle = 'chat' | 'responses' | 'messages';

export interface Provider {
  /** The owner's own id (a-z, 0-9, '-'); models are keyed `id/model`. */
  id: string;
  kind: ProviderKind;
  label: string;
  base_url: string;
  api_style: ApiStyle;
  /** Last four characters of the key; '' when there is none. */
  key_hint: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface Model {
  provider_id: string;
  model_id: string;
  label: string;
  context_window: number | null;
  max_output: number | null;
  pinned: boolean;
  hidden: boolean;
  fetched: boolean;
}

export interface Prefs {
  default_model?: string | null;
  system_prompt?: string | null;
  temperature?: number | null;
  max_output_tokens?: number | null;
  context_tokens?: number | null;
  max_steps?: number | null;
  launcher?: boolean | null;
  /** "ask": changes wait for the owner's OK; "auto": Mnemo goes ahead. */
  permission?: 'ask' | 'auto' | null;
}

/** A question Mnemo asks with options to tap. */
export interface AskOption {
  label: string;
  description?: string | null;
  approve?: boolean;
}
export interface Ask {
  id: string;
  question: string;
  options: AskOption[];
  allow_other: boolean;
}
/** The owner's answer to a question, sent with the message. */
export interface Answer {
  to: string;
  approve?: boolean;
  other?: boolean;
}

export interface MnemoState {
  name: string;
  ready: boolean;
  providers: Provider[];
  models: Model[];
  prefs: Prefs;
  tools: string[];
  defaults: { context_tokens: number; max_output_tokens: number; max_steps: number };
  fetched?: number;
}

export interface Session {
  id: string;
  title: string;
  /** global, note:<path> or folder:<path> */
  scope: string;
  /** provider/model, or '' for the default */
  model: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  messages: number;
  /** A reply is running in it now (on the server, watched or not). */
  running?: boolean;
  /** How many of its messages the owner has seen, on any device (in the chat list only). */
  seen?: number;
}

export interface StoredCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface Message {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: StoredCall[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  meta: Record<string, unknown> | null;
  created_at: number;
}

/** A note or folder attached to a message. */
export interface Attach {
  kind: 'note' | 'folder' | 'image';
  /** Note or folder path; for an image, its upload id. */
  path: string;
  title: string;
  notes?: number;
  bytes?: number;
  /** An image's preview address. */
  url?: string;
}

/** Hand an image to Mnemo for this chat (it waits on the server until Mnemo places it). */
export async function uploadChatImage(file: File): Promise<{ id: string; name: string; bytes: number; url: string }> {
  const res = await fetch(`/api/assistant/uploads?name=${encodeURIComponent(file.name || 'image.png')}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; name?: string; bytes?: number; url?: string; error?: string };
  if (!res.ok || !data.id) throw new Error(data.error || `could not attach the image (HTTP ${res.status})`);
  return data as { id: string; name: string; bytes: number; url: string };
}

/** How full a chat's memory is for its model (tokens, approximate). */
export interface ChatContext {
  used: number;
  window: number;
  reserved_output: number;
  /** Compaction starts once `used` passes this. */
  compact_at: number;
  compactions: number;
  model: string;
}

export type ChatEvent =
  | { type: 'start'; model: string; context?: ChatContext }
  | ({ type: 'ask' } & Ask)
  | { type: 'compacting' }
  | { type: 'steered'; text: string }
  | { type: 'compacted'; messages: number; tokens: number }
  | { type: 'notice'; text: string }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_start'; id: string; name: string; args: unknown }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; summary: string; ms: number; shown?: Shown[] }
  | { type: 'error'; message: string }
  | { type: 'done'; input_tokens: number; output_tokens: number; title: string | null; context?: ChatContext };

// ---- state, shared by every Mnemo surface ----

let cached: MnemoState | null = null;
let loading: Promise<MnemoState> | null = null;
const listeners = new Set<(s: MnemoState) => void>();

export function mnemoState(): MnemoState | null {
  return cached;
}

/** Load (or reuse) the state; `fresh` asks the server again. */
export function loadState(fresh = false): Promise<MnemoState> {
  if (cached && !fresh) return Promise.resolve(cached);
  if (!loading) {
    loading = apiGet<MnemoState>('/api/assistant/state')
      .then((s) => setState(s))
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

function setState(s: MnemoState): MnemoState {
  cached = s;
  listeners.forEach((fn) => fn(s));
  return s;
}

export function onState(fn: (s: MnemoState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function postState(path: string, body: unknown): Promise<MnemoState> {
  return setState(await apiPost<MnemoState>(path, body));
}

export const saveProvider = (b: Partial<Omit<Provider, 'key_hint'>> & { api_key?: string }): Promise<MnemoState & { saved?: string }> =>
  postState('/api/assistant/providers', b) as Promise<MnemoState & { saved?: string }>;
export const deleteProvider = (id: string): Promise<MnemoState> => postState('/api/assistant/providers/delete', { id });
export const testProvider = (id: string): Promise<{ ok: boolean; models?: number; ms?: number; error?: string }> =>
  apiPost('/api/assistant/providers/test', { id });
export const fetchModels = (provider: string): Promise<MnemoState> => postState('/api/assistant/models/fetch', { provider });
export const setModel = (b: {
  provider: string;
  model: string;
  label?: string;
  context_window?: number | null;
  max_output?: number | null;
  pinned?: boolean;
  hidden?: boolean;
}): Promise<MnemoState> => postState('/api/assistant/models', b);
export const deleteModel = (provider: string, model: string): Promise<MnemoState> =>
  postState('/api/assistant/models/delete', { provider, model });
export const savePrefs = (p: Prefs): Promise<MnemoState> => postState('/api/assistant/prefs', p);

// ---- chats ----

export const listSessions = (): Promise<{ sessions: Session[] }> => apiGet('/api/assistant/sessions');
export const newSession = (scope: string, model = ''): Promise<{ session: Session }> =>
  apiPost('/api/assistant/sessions', { scope, model });
/** Something from the vault Mnemo handed over in a reply (`show_items`), drawn as a card. */
export interface Shown {
  kind: 'note' | 'folder' | 'image' | 'vault';
  path: string;
  title: string;
}

/** One place a search matched: a message (`message_id`) or a chat's title alone. */
export interface SearchHit {
  chat: string;
  title: string;
  scope: string;
  message_id: number | null;
  role: string;
  snippet: string;
  at: number;
}
export const searchChats = (q: string): Promise<{ query: string; hits: SearchHit[] }> =>
  apiGet(`/api/assistant/search?q=${encodeURIComponent(q)}&limit=80`);
/** Title prefix of the chats that answer an `@mnemo:` request written in a note. */
export const NOTE_TASK_PREFIX = '@mnemo · ';
export const compactSession = (id: string): Promise<{ ok: boolean; messages?: number; tokens?: number; reason?: string; context: ChatContext }> =>
  apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}/compact`, {});
export const getSession = (id: string): Promise<{ session: Session; messages: Message[]; context: ChatContext | null; running?: boolean }> =>
  apiGet(`/api/assistant/sessions/${encodeURIComponent(id)}`);
export const updateSession = (id: string, b: { title?: string; model?: string; pinned?: boolean }): Promise<{ session: Session }> =>
  apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}`, b);
export const markSessionSeen = (id: string, messages: number): Promise<{ ok: boolean; seen: number }> =>
  apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}/seen`, { messages });
export const deleteSession = (id: string): Promise<{ ok: boolean }> =>
  apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}/delete`, {});

/** Send a message and read the reply as it streams. Resolves when the stream ends. */
export function streamChat(
  id: string,
  text: string,
  model: string | undefined,
  attach: Attach[],
  signal: AbortSignal,
  onEvent: (e: ChatEvent) => void,
  answer?: Answer,
): Promise<void> {
  // The device's time zone goes along, so Mnemo can tell the owner's local time.
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* no Intl: the offset alone */
  }
  const body = {
    text,
    ...(model ? { model } : {}),
    ...(attach.length ? { attach: attach.map((a) => ({ kind: a.kind, path: a.path })) } : {}),
    ...(tz ? { tz } : {}),
    ...(answer ? { answer } : {}),
    tz_offset: -new Date().getTimezoneOffset(),
  };
  return streamPost(`/api/assistant/sessions/${encodeURIComponent(id)}/chat`, body, signal, onEvent);
}

/** Address of a chat as a Markdown file (`GET` downloads it). */
export const exportUrl = (id: string): string => `/api/assistant/sessions/${encodeURIComponent(id)}/export`;

/** Give the reply running in chat `id` a message it reads before its next step. */
export const steerChat = (id: string, text: string): Promise<{ ok: boolean }> => apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}/steer`, { text });

/** Stop the reply running in chat `id` (leaving a chat does not stop it). */
export const stopChat = (id: string): Promise<{ stopped: boolean }> => apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}/stop`, {});

/** Watch the reply running in chat `id` from its start. `false` when none is running. */
export async function streamLive(id: string, signal: AbortSignal, onEvent: (e: ChatEvent) => void): Promise<boolean> {
  const res = await fetch(`/api/assistant/sessions/${encodeURIComponent(id)}/live`, { credentials: 'same-origin', headers: { accept: 'text/event-stream' }, signal, cache: 'no-store' });
  if (res.status === 204) return false;
  await readEvents(res, onEvent);
  return true;
}

/** Run the turn of the owner's message `messageId` again (what came after it is replaced). */
export function streamRerun(id: string, messageId: number, model: string | undefined, signal: AbortSignal, onEvent: (e: ChatEvent) => void): Promise<void> {
  return streamPost(`/api/assistant/sessions/${encodeURIComponent(id)}/rerun`, { message_id: messageId, ...(model ? { model } : {}) }, signal, onEvent);
}

async function streamPost(url: string, body: unknown, signal: AbortSignal, onEvent: (e: ChatEvent) => void): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  });
  await readEvents(res, onEvent);
}

async function readEvents(res: Response, onEvent: (e: ChatEvent) => void): Promise<void> {
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as ChatEvent);
      } catch {
        /* a keep-alive or a broken line */
      }
    }
  }
}

// ---- helpers ----

/** The name of a provider type. */
export function providerName(kind: string): string {
  return kind === 'openai' ? 'OpenAI' : kind === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible';
}

export function providerOf(s: MnemoState | null, id: string): Provider | undefined {
  return s?.providers.find((p) => p.id === id);
}

/** What the owner named the provider (falls back to its id). */
export function providerLabel(s: MnemoState | null, id: string): string {
  return providerOf(s, id)?.label || id;
}

/** A provider that can answer: switched on, with a key (an OpenAI-compatible server may need none). */
export function providerReady(p: Provider): boolean {
  return p.enabled && (!!p.key_hint || p.kind === 'custom');
}

/** Visible models of usable providers, pinned first, then by name. */
/** Plain code-unit order, the same the server and the TUI use to pick "the first pinned". */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function usableModels(s: MnemoState): Model[] {
  const ok = new Set(s.providers.filter(providerReady).map((p) => p.id));
  return s.models
    .filter((m) => !m.hidden && ok.has(m.provider_id))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || cmp(a.provider_id, b.provider_id) || cmp(a.model_id, b.model_id));
}

export function modelKey(m: Model): string {
  return `${m.provider_id}/${m.model_id}`;
}

export function modelLabel(s: MnemoState | null, key: string): string {
  const m = s?.models.find((x) => modelKey(x) === key);
  return m?.label || key.split('/').slice(1).join('/') || key;
}

/** The model a chat will use when none is chosen: the default, else the first pinned or visible one. */
export function fallbackModel(s: MnemoState): string {
  const list = usableModels(s);
  const d = s.prefs.default_model;
  if (d && list.some((m) => modelKey(m) === d)) return d;
  return list[0] ? modelKey(list[0]) : '';
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function scopeLabel(scope: string): string {
  if (scope.startsWith('note:')) return scope.slice(5).split('/').pop()!.replace(/\.md$/i, '');
  if (scope.startsWith('folder:')) return scope.slice(7) || 'All notes';
  return 'Whole vault';
}
