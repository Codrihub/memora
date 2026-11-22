// Mnemo, the notes agent: types and calls for /api/assistant/*, and the streaming chat reader.

import { apiGet, apiPost } from '../api';
import { langName, t } from '../i18n';
import { ts } from '../i18n/server';

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
  /** The model can think: the chat offers a thinking level. */
  thinks?: boolean;
}

/** How hard models think: the model's own default, off, or a level. */
export type ThinkLevel = 'auto' | 'off' | 'low' | 'medium' | 'high';

export interface Prefs {
  default_model?: string | null;
  system_prompt?: string | null;
  temperature?: number | null;
  max_output_tokens?: number | null;
  context_tokens?: number | null;
  max_steps?: number | null;
  launcher?: boolean | null;
  /** The language of the owner's screen (`Indonesian`), for what Mnemo writes unasked. */
  ui_lang?: string | null;
  /** "ask": changes and sub-agents wait for the owner's OK; "auto": Mnemo goes ahead;
   *  "read": Mnemo only reads and answers, it never changes notes. */
  permission?: 'ask' | 'auto' | 'read' | null;
  thinking?: ThinkLevel | null;
  /** Models to carry on with when a chat's model fails, in order (`provider/model`, 5 at most). */
  fallback_models?: string[] | null;
  /** A model for each job the chat model may not do itself (`provider/model`; empty for none). */
  roles?: Roles | null;
  /** The voice that reads replies aloud. */
  voice?: string | null;
  /** Mnemo may note things about the owner on its own. */
  learn_me?: boolean | null;
  /** Tools switched off for Mnemo itself, and for its sub-agents. */
  tools_off_main?: string[] | null;
  tools_off_sub?: string[] | null;
  /** The "tell Mnemo about you" card was answered or skipped. */
  intro_done?: boolean | null;
  /** Mnemo asks the owner before sub-agents run (they use tokens of their own). */
  confirm_subagents?: boolean | null;
}

export interface Roles {
  vision?: string;
  image?: string;
  tts?: string;
  stt?: string;
}

export const VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];

/** The model set for a job, or '' when none is. */
export function roleModel(s: MnemoState | null, role: keyof Roles): string {
  return s?.prefs.roles?.[role] || '';
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
  /** Mnemo's own tools (images, chats, plans, sub-agents…), switchable like the Memora ones. */
  own_tools?: string[];
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
  /** Put away: hidden from the chat list, still found by search and in All chats. */
  archived?: boolean;
  /** The last message with text, one line (in the chat list only). */
  preview?: { role: 'user' | 'assistant'; text: string };
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
  if (!res.ok || !data.id) throw new Error((data.error && ts(data.error)) || t('could not attach the image (HTTP {status})', { status: res.status }));
  window.dispatchEvent(new Event('memora:storage-check'));
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

/** Progress of a sub-agent while a `delegate` call runs (`id` is that call's id). */
export interface SubEvent {
  id: string;
  agent: string;
  model: string;
  phase: 'start' | 'step' | 'text' | 'tool' | 'tool_end' | 'ask' | 'answer' | 'usage' | 'done' | 'error' | 'fallback' | 'switched' | 'compacting' | 'compacted' | 'notice';
  from?: string;
  to?: string;
  reason?: string;
  messages?: number;
  text?: string;
  follow_up?: boolean;
  window?: number | null;
  step?: number;
  steps?: number;
  delta?: string;
  name?: string;
  args?: unknown;
  ok?: boolean;
  summary?: string;
  question?: string;
  answer?: string;
  input_tokens?: number;
  output_tokens?: number;
  context?: number;
  message?: string;
}

/** What a `delegate` call returns (the live card is drawn again from it after a reload). */
export interface SubResult {
  agent?: string;
  model?: string;
  answer?: string;
  steps?: number;
  input_tokens?: number;
  output_tokens?: number;
  context?: number;
  window?: number | null;
  follow_up?: boolean;
  error?: string;
  log?: ({ kind: 'tool'; name: string; ok: boolean; summary: string } | { kind: 'ask'; question: string; answer: string })[];
}

/** Something to do about a notice: open Settings at "Models for each job", or this chat's model picker. */
export interface NoticeAction {
  label: string;
  open: 'jobs' | 'model';
}

export type ChatEvent =
  | { type: 'start'; model: string; context?: ChatContext }
  | ({ type: 'ask' } & Ask)
  | { type: 'compacting' }
  | { type: 'steered'; text: string }
  | { type: 'compacted'; messages: number; tokens: number; summary?: string }
  | { type: 'compact_text'; delta: string }
  | { type: 'fallback'; from: string; model: string; reason: string; detail?: string }
  | { type: 'notice'; text: string; action?: NoticeAction }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_start'; id: string; name: string; args: unknown }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; summary: string; ms: number; shown?: Shown[]; output?: unknown }
  | ({ type: 'sub' } & SubEvent)
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
let langSent = false;

export function loadState(fresh = false): Promise<MnemoState> {
  if (cached && !fresh) return Promise.resolve(cached);
  if (!loading) {
    loading = apiGet<MnemoState>('/api/assistant/state')
      .then((s) => {
        // Mnemo writes suggestions in the owner's language: tell it the screen's.
        const ln = langName();
        if (s.ready && s.prefs.ui_lang !== ln && !langSent) {
          langSent = true;
          void savePrefs({ ui_lang: ln }).catch(() => undefined);
        }
        return setState(s);
      })
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
/** Chats about a note or folder (kept for it, with it attached, or touching it), newest first. */
export const sessionsAbout = (path: string): Promise<{ sessions: Session[] }> =>
  apiGet(`/api/assistant/sessions?about=${encodeURIComponent(path)}`);
export const newSession = (scope: string, model = '', fleeting = false): Promise<{ session: Session; fleeting?: boolean }> =>
  apiPost('/api/assistant/sessions', { scope, model, ...(fleeting ? { fleeting: true } : {}) });
/** Delete a chat while the page goes away (a fleeting chat being left): survives the unload. */
export function forgetSession(id: string): void {
  try {
    void fetch(`/api/assistant/sessions/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
  } catch {
    /* the server forgets it after a while anyway */
  }
}
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
export const compactSession = (id: string): Promise<{ ok: boolean; messages?: number; tokens?: number; summary?: string; reason?: string; context: ChatContext }> =>
  apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}/compact`, {});
export const getSession = (id: string): Promise<{ session: Session; messages: Message[]; context: ChatContext | null; running?: boolean; queue?: QueueState }> =>
  apiGet(`/api/assistant/sessions/${encodeURIComponent(id)}`);
export const updateSession = (id: string, b: { title?: string; model?: string; pinned?: boolean; archived?: boolean }): Promise<{ session: Session }> =>
  apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}`, b);
/** Delete many chats: the ones picked, the ones untouched for some days, or all. */
export const pruneSessions = (b: { ids?: string[]; older_than_days?: number; all?: boolean; keep_pinned?: boolean }): Promise<{ deleted: number; skipped: number }> =>
  apiPost('/api/assistant/sessions/prune', b);
export interface Skill {
  name: string;
  path: string;
  description: string;
}
/** The owner's skills: notes in the Skills folder, run with /name. */
export const listSkills = (): Promise<{ folder: string; skills: Skill[] }> => apiGet('/api/assistant/skills');
export interface Suggestions {
  own: string[];
  ai: string[];
}
/** Mnemo's suggestions, written in the language of this screen (`lang`, e.g. Indonesian). */
export const getSuggestions = (): Promise<Suggestions> => apiGet(`/api/assistant/suggestions?lang=${encodeURIComponent(langName())}`);
export const saveSuggestions = (own: string[]): Promise<{ own: string[] }> => apiPost('/api/assistant/suggestions', { own });
/** "Fresh ideas": Mnemo writes its suggestions again (the owner's own stay). */
export const refreshSuggestions = (): Promise<Suggestions & { fresh: boolean }> => apiPost('/api/assistant/suggestions/refresh', {});
export const markSessionSeen = (id: string, messages: number): Promise<{ ok: boolean; seen: number }> =>
  apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}/seen`, { messages });
export const deleteSession = (id: string): Promise<{ ok: boolean }> =>
  apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}/delete`, {});

/** This tab, so it can tell its own messages from other devices' in a chat's watch events. */
export const CLIENT = Math.random().toString(36).slice(2, 10);

/** The request a message goes with (time zone, attachments, model, answer). */
export function chatBody(text: string, model: string | undefined, attach: Attach[], answer?: Answer): Record<string, unknown> {
  // The device's time zone goes along, so Mnemo can tell the owner's local time.
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* no Intl: the offset alone */
  }
  return {
    text,
    client: CLIENT,
    ...(model ? { model } : {}),
    ...(attach.length ? { attach: attach.map((a) => ({ kind: a.kind, path: a.path, title: a.title })) } : {}),
    ...(tz ? { tz } : {}),
    ...(answer ? { answer } : {}),
    tz_offset: -new Date().getTimezoneOffset(),
  };
}

/** A message waiting for the reply running in its chat (kept on the server, every device sees it). */
export interface Queued {
  id: number;
  text: string;
  attach: { kind: string; path: string; title?: string }[];
  at: number;
}
export interface QueueState {
  items: Queued[];
  /** Paused after a reply failed: nothing goes out until a message is sent or the queue resumes. */
  held: boolean;
}
const qurl = (id: string, rest = ''): string => `/api/assistant/sessions/${encodeURIComponent(id)}/queue${rest}`;
/** Queue a message: it goes out when the reply running ends (at once when none runs). */
export const queueAdd = (id: string, body: Record<string, unknown>): Promise<{ id: number; queue: QueueState }> => apiPost(qurl(id), body);
/** Change a queued message: remove, move, or send it now (the reply running is cut for it). */
export const queueOp = (id: string, qid: number, op: 'del' | 'up' | 'down' | 'move' | 'send', to = 0): Promise<QueueState> =>
  apiPost(qurl(id, `/${qid}`), { op, to });
export const queueClear = (id: string): Promise<QueueState> => apiPost(qurl(id, '/clear'), {});
export const queueResume = (id: string): Promise<QueueState> => apiPost(qurl(id, '/resume'), {});

/** What happens in a chat, as every device with it open hears it. */
export type WatchEvent =
  | { type: 'hello'; running: boolean }
  | { type: 'user'; via: string; client: string | null; message: Message }
  | { type: 'running' }
  | { type: 'idle'; outcome: string }
  | ({ type: 'queue' } & QueueState)
  | { type: 'queue_error'; message: string }
  | { type: 'compacted' }
  | { type: 'reload' };

/** Follow chat `id` until `signal` aborts (resolves when the stream ends). */
export async function watchChat(id: string, signal: AbortSignal, onEvent: (e: WatchEvent) => void): Promise<void> {
  const res = await fetch(`/api/assistant/sessions/${encodeURIComponent(id)}/watch`, { credentials: 'same-origin', headers: { accept: 'text/event-stream' }, signal, cache: 'no-store' });
  await readEvents(res, onEvent as unknown as (e: ChatEvent) => void);
}

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
  const body = chatBody(text, model, attach, answer);
  return streamPost(`/api/assistant/sessions/${encodeURIComponent(id)}/chat`, body, signal, onEvent);
}

/** Address of a chat as a Markdown file (`GET` downloads it). */
export const exportUrl = (id: string): string => `/api/assistant/sessions/${encodeURIComponent(id)}/export`;

/** Send a message now: the reply running is cut where it is and Mnemo answers this one. */
export const steerChat = (id: string, body: Record<string, unknown>): Promise<{ ok: boolean; queue: QueueState }> =>
  apiPost(`/api/assistant/sessions/${encodeURIComponent(id)}/steer`, body);

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

// ---- what Mnemo knows about the owner ----

/** What "Describe me from my notes" sends: Mnemo reads the vault and keeps what it learns. */
const DESCRIBE_ME_EN = `Get to know me from my notes. Look through my vault (recent notes, journals, projects, anything about me) and keep what you learn with remember_owner: who I am, what I work on, how I like answers, what I like. Short, lasting things only, never secrets. Then tell me in a few lines what you kept.`;
/** What "Describe me from my notes" sends, in the owner's language. */
export const describeMe = (): string => t(DESCRIBE_ME_EN);

export interface OwnerMemory {
  id: string;
  text: string;
  by: 'mnemo' | 'owner';
  at: number;
}
export const listOwnerMemory = (): Promise<{ items: OwnerMemory[]; learn: boolean }> => apiGet('/api/assistant/memory');
export const addOwnerMemory = (text: string): Promise<{ item: OwnerMemory }> => apiPost('/api/assistant/memory', { text });
export const editOwnerMemory = (id: string, b: { text?: string }): Promise<{ item: OwnerMemory }> =>
  apiPost(`/api/assistant/memory/${encodeURIComponent(id)}`, b);
/** Switch a sub-agent's model in one chat ('' goes back to Auto: the default model, then the fallbacks). */
export const setSubModel = (sid: string, agent: string, model: string): Promise<{ ok: boolean; agent: string; model: string }> =>
  apiPost(`/api/assistant/sessions/${encodeURIComponent(sid)}/subagent-model`, { agent, model });
export const deleteOwnerMemory = (id: string): Promise<{ ok: boolean }> => apiPost(`/api/assistant/memory/${encodeURIComponent(id)}/delete`, {});

/** The part of Settings, Mnemo to scroll to when it opens next (set before going there). */
let settingsPart = '';
export function wantSettingsPart(part: string): void {
  settingsPart = part;
}
export function takeSettingsPart(): string {
  const p = settingsPart;
  settingsPart = '';
  return p;
}

// ---- speech ----

async function failOf(res: Response, what: string): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error((data.error && ts(data.error)) || t('could not {what} (HTTP {status})', { what, status: res.status }));
}

/** Text read aloud by the speech model, as audio. */
export async function speak(text: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch('/api/assistant/speak', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'audio/*, application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw await failOf(res, t('read it aloud'));
  return res.blob();
}

/** Recorded speech turned into text by the listening model. */
export async function transcribe(audio: Blob): Promise<string> {
  const res = await fetch('/api/assistant/transcribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': audio.type || 'audio/webm' },
    body: audio,
    cache: 'no-store',
  });
  if (!res.ok) throw await failOf(res, t('turn the recording into text'));
  const data = (await res.json().catch(() => ({}))) as { text?: string };
  return (data.text || '').trim();
}

// ---- helpers ----

/** The name of a provider type. */
export function providerName(kind: string): string {
  return kind === 'openai' ? 'OpenAI' : kind === 'anthropic' ? 'Anthropic' : t('OpenAI-compatible');
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
  if (scope.startsWith('folder:')) return scope.slice(7) || t('All notes');
  return t('Whole vault');
}
