// JSON client for /api/*. Every call is same-origin so the session cookie is
// sent, and nothing is cached.

import type { KeyPermissionsUpdate, KeyRow, ToolInfo, ToolSwitchResult, ToolsResult } from './types';

interface ApiFailure extends Error {
  status: number;
  data: unknown;
}

interface ApiOptions {
  method?: string;
  body?: unknown;
}

function fail(message: string, status: number, data: unknown): ApiFailure {
  const err = new Error(message) as ApiFailure;
  err.status = status;
  err.data = data;
  return err;
}

let leaving = false;

/**
 * A 401 inside the app means this browser's session is gone (signed out on
 * another device, password changed, expired): go to sign-in, which tells why,
 * and come back here afterwards.
 */
function sessionEnded(): void {
  if (leaving || typeof location === 'undefined' || location.pathname === '/login') return;
  leaving = true;
  const next = location.pathname + location.search + location.hash;
  window.setTimeout(() => location.replace('/login?r=' + encodeURIComponent(next)), 50);
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers,
      body,
      cache: 'no-store',
    });
  } catch {
    throw fail('cannot reach the server', 0, null);
  }

  const txt = await res.text();
  let data: unknown = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = { raw: txt };
  }

  if (res.status === 401) sessionEnded();
  if (!res.ok) {
    const rec = (data ?? {}) as Record<string, unknown>;
    const msg =
      typeof rec.error === 'string'
        ? rec.error
        : typeof rec.message === 'string'
          ? rec.message
          : `HTTP ${res.status}`;
    throw fail(msg, res.status, data);
  }
  return data as T;
}

export function apiGet<T = unknown>(path: string): Promise<T> {
  return api<T>(path);
}

export function apiPost<T = unknown>(path: string, body: unknown = {}): Promise<T> {
  return api<T>(path, { method: 'POST', body });
}

// Tool switches and per key permissions (docs/contracts/tools-permissions.md).

/** Every MCP tool with its category, description and server wide switch. */
export async function fetchTools(): Promise<ToolInfo[]> {
  const d = await apiGet<ToolsResult>('/api/tools');
  return (d && d.tools) || [];
}

/** Turn one tool on or off for every agent. */
export function setToolEnabled(name: string, enabled: boolean): Promise<ToolSwitchResult> {
  return apiPost<ToolSwitchResult>('/api/tools', { name, enabled });
}

/** Save what a key may do and which tools it may call. */
export function updateKeyPermissions(body: KeyPermissionsUpdate): Promise<KeyRow> {
  return apiPost<KeyRow>('/api/keys/update', body);
}
