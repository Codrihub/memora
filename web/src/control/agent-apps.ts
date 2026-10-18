// Which app each agent (API key) is used with. The connect flow records the
// choice in the UI layout store (`/api/ui/layout/agent-apps`, so it follows
// the owner to every browser); agents set up elsewhere get a guess from their
// name or from the OAuth client that signed in.

import { api, apiGet } from '../api';

const LAYOUT = '/api/ui/layout/agent-apps';

let apps: Record<string, string> = {};
let loading: Promise<void> | null = null;

/** Load the stored choices once per page load (again with `force`). */
export function loadAgentApps(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = apiGet<{ data?: { apps?: unknown } | null }>(LAYOUT)
    .then((r) => {
      const m = r?.data?.apps;
      apps = {};
      if (m && typeof m === 'object')
        for (const [k, v] of Object.entries(m as Record<string, unknown>)) if (typeof v === 'string') apps[k] = v;
    })
    .catch(() => {
      apps = {};
    });
  return loading;
}

/** Remember (or with '' forget) the app an agent is used with. */
export async function setAgentApp(keyId: string, clientId: string): Promise<void> {
  if (!keyId || (apps[keyId] || '') === clientId) return;
  if (clientId) apps[keyId] = clientId;
  else delete apps[keyId];
  try {
    await api(LAYOUT, { method: 'PUT', body: { data: { apps } } });
  } catch {
    /* kept for this page load; the next connect saves it again */
  }
}

// Most specific first: "claude-code" must not land on "claude".
const RULES: [RegExp, string][] = [
  [/claude[\s._-]*code|^cc$/, 'claude-code'],
  [/claude[\s._-]*desktop/, 'claude-desktop'],
  [/cursor/, 'cursor'],
  [/vs[\s._-]*code|copilot/, 'vscode'],
  [/codex/, 'codex'],
  [/gemini/, 'gemini'],
  [/windsurf|codeium|cascade/, 'windsurf'],
  [/chat[\s._-]*gpt|openai/, 'chatgpt'],
  [/claude|anthropic/, 'claude-ai'],
];

/** A best guess from a name ("cursor-laptop" -> cursor), or ''. */
export function guessApp(...names: (string | null | undefined)[]): string {
  for (const n of names) {
    const s = String(n || '').toLowerCase();
    if (!s) continue;
    for (const [re, id] of RULES) if (re.test(s)) return id;
  }
  return '';
}

/** The app an agent is used with: the recorded choice, else a guess; '' when unknown. */
export function appOf(key: { id: string; name?: string }, oauthClient?: string): { id: string; guessed: boolean } {
  const chosen = apps[key.id];
  if (chosen) return { id: chosen, guessed: false };
  return { id: guessApp(oauthClient, key.name), guessed: true };
}
