// Response shapes of the /api endpoints the UI reads. Only the fields the
// browser actually consumes are typed, so an extra server field never breaks
// the build. Optional fields are marked optional on purpose.

export interface NoteRef {
  path: string;
  name: string;
  folder: string;
  mtime: number;
}

/** Folder name to note list. */
export type Tree = Record<string, NoteRef[]>;

interface FolderMeta {
  color?: string;
  icon?: string;
  desc?: string;
}

export type FolderMetaMap = Record<string, FolderMeta>;

export interface Stats {
  notes: number;
  links: number;
  folders: number;
}

export interface SearchHit {
  path: string;
  name: string;
  folder: string;
  rank?: number;
  snippet?: string;
}

export interface SearchResult {
  hits?: SearchHit[];
}

export interface GraphNode {
  id: string;
  path?: string;
  folder: string;
  color?: string;
  degree?: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

/** The /api/graph payload. */
export interface GraphData {
  nodes?: GraphNode[];
  links?: GraphLink[];
}

export interface NoteDoc {
  path: string;
  name: string;
  folder: string;
  content: string;
  html?: string;
  tags?: string[];
  size?: number;
  mtime?: number;
  error?: string;
}

export interface Health {
  ok?: boolean;
  server?: string;
  version?: string;
  vault?: string | null;
  vault_configured?: boolean;
  armed?: boolean;
  locked?: boolean;
  /** Where agents reach this server (MEMORA_BASE_URL, else this request's host). */
  base_url?: string;
  base_url_configured?: boolean;
}

/** The server's cached release check (`/api/config` `update`). */
export interface UpdateCheck {
  current?: string;
  latest?: string | null;
  available?: boolean;
  url?: string;
  checked_at?: number | null;
  /** `pending` until the first check has run. */
  state?: 'ok' | 'none' | 'error' | 'disabled' | 'pending';
}

export interface Config {
  realm?: string;
  version?: string;
  update?: UpdateCheck;
  vault?: string | null;
  gateway?: boolean;
  min_password_len?: number;
  session_ttl?: number;
}

export interface AuthState {
  armed?: boolean;
  locked?: boolean;
  bootstrap?: boolean;
  setup_hint?: string;
  realm?: string;
  mode?: string;
  lock_mode?: string;
  min_password_len?: number;
  expires_in?: number;
  user?: string;
  username?: string;
  authenticated?: boolean;
  redirect?: string;
}

export interface LogEvent {
  type?: string;
  actor?: string;
  by?: string;
  user?: string;
  action?: string;
  event?: string;
  label?: string;
  ts?: number;
  path?: string;
  id?: string;
  folder?: string;
  alias?: string;
  key_id?: string;
  route?: string;
  detail?: string;
  node?: { id?: string; path?: string };
  /** Set by the client when a gateway event is merged into the vault feed. */
  _gw?: string;
  /** Normalized timestamp used for sorting both feeds together. */
  _ts?: number;
  [key: string]: unknown;
}

export interface LogsResult {
  events?: LogEvent[];
}

export interface ActorRow {
  actor?: string;
  alias?: string;
  events?: number;
  tools?: string[];
  last_ip?: string;
  last_ts?: number;
  seen_minutes_ago?: number;
}

export interface ActorsResult {
  actors?: ActorRow[];
}

export interface AliasesResult {
  aliases?: Record<string, string>;
}

export interface KeyRow {
  id: string;
  name?: string;
  enabled?: boolean;
  /** Chosen display color (#rrggbb); absent = derived from the name. */
  color?: string | null;
  /** The secret is stored sealed: the owner can show it again. */
  revealable?: boolean;
  scopes?: string[];
  uses?: number;
  last_ip?: string | null;
  /** "*" (or absent) = every tool; a list = only these tool names. */
  tools?: ToolAccess;
}

export interface KeysResult {
  keys?: KeyRow[];
}

export interface KeyCreated {
  id?: string;
  name?: string;
  /** The plaintext secret. Returned once, on create or roll. */
  key?: string;
  secret?: string;
}

/** What an API key may do. */
export type KeyScope = 'mcp' | 'read' | 'write' | 'admin';

/** Per key MCP tool access: every tool, or only the listed names. */
export type ToolAccess = '*' | string[];

/** One MCP tool from GET /api/tools. `enabled` is the server wide switch. */
export interface ToolInfo {
  name: string;
  category: string;
  description: string;
  enabled: boolean;
}

export interface ToolsResult {
  tools?: ToolInfo[];
}

export interface ToolSwitchResult {
  ok?: boolean;
  name?: string;
  enabled?: boolean;
}

/** Body of POST /api/keys/update when changing permissions. */
export interface KeyPermissionsUpdate {
  id: string;
  tools?: ToolAccess;
  scopes?: KeyScope[];
}

export interface AccessRule {
  kind?: string;
  type?: string;
  value?: string;
  ip?: string;
  domain?: string;
  range?: string;
  cidr?: string;
  action?: string;
  mode?: string;
}

export interface AccessStack {
  default_allow?: boolean;
  rules?: AccessRule[];
  count?: number;
}

export interface AccessTestResult {
  action?: string;
  would_lock_out_caller?: boolean;
}

export interface DeleteFolderResult {
  ok?: boolean;
  deleted_folder?: string;
  moved_to_root?: string[];
}

export interface OkResult {
  ok?: boolean;
  path?: string;
  [key: string]: unknown;
}

/** Frames pushed over /ws. */
export interface WsEvent {
  type?: string;
  clients?: number;
  replay?: boolean;
  actor?: string;
  label?: string;
  action?: string;
  [key: string]: unknown;
}

/** `GET /api/settings`: the account and vault as Settings shows them. */
export interface SettingsInfo {
  user?: string;
  vault_configured?: boolean;
  vault?: string | null;
  vault_suggested?: string | null;
  vault_writable?: boolean | null;
  stats?: Stats | null;
  min_password_len?: number;
  expires_in?: number;
}

/** `POST /api/settings/vault` result. */
export interface VaultSwitchResult {
  ok?: boolean;
  vault?: string;
  created?: boolean;
  stats?: Stats | null;
}
