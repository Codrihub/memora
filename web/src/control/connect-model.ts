// Pure logic of the connect flow: no DOM and no imports, so it is tested under Node.

/** How an app gets connected: it signs in, opens a link, runs a command, or takes a pasted setup. */
export type Method = 'signin' | 'deeplink' | 'command' | 'copy';

/** The plain tile label: no setup text to paste, or something to copy. */
export function howLabel(m: Method): 'One click' | 'Copy setup' {
  return m === 'signin' || m === 'deeplink' ? 'One click' : 'Copy setup';
}

/** What stands in for the key in setup text shown on screen; Copy puts the real key in. */
export const KEY_DOTS = '••••••••';

/** The key as it shows in its box: start and end, the middle hidden. */
export function maskKey(s: string): string {
  if (s.length <= 16) return '•'.repeat(Math.max(8, s.length));
  return s.slice(0, 12) + '•'.repeat(10) + s.slice(-4);
}

function b64(s: string): string {
  const g = globalThis as unknown as { btoa?: (s: string) => string };
  return g.btoa ? g.btoa(s) : '';
}

/** Cursor's install link. It carries the key, so it is never shown as text. */
export function cursorLink(url: string, key: string): string {
  const config = { url, headers: { Authorization: `Bearer ${key}` } };
  return 'cursor://anysphere.cursor-deeplink/mcp/install?name=memora&config=' + encodeURIComponent(b64(JSON.stringify(config)));
}

/** VS Code's install link (Copilot uses the server it adds). */
export function vscodeLink(url: string, key: string): string {
  return 'vscode:mcp/install?' + encodeURIComponent(JSON.stringify({ name: 'memora', type: 'http', url, headers: { Authorization: `Bearer ${key}` } }));
}

/** The install link of a one-click app, or '' for the others. */
export function oneClickLink(app: string, url: string, key: string): string {
  if (app === 'cursor') return cursorLink(url, key);
  if (app === 'vscode') return vscodeLink(url, key);
  return '';
}

const json = (v: unknown): string => JSON.stringify(v, null, 2);

/** The setup an app takes: one command for terminal apps, a config to paste for the rest. */
export function setupText(app: string, url: string, key: string): string {
  const auth = `Bearer ${key}`;
  switch (app) {
    case 'claude-code':
      return `claude mcp add --scope user --transport http memora ${url} --header "Authorization: ${auth}"`;
    case 'gemini':
      return `gemini mcp add --scope user --transport http memora ${url} --header "Authorization: ${auth}"`;
    case 'codex':
      return `mkdir -p ~/.codex && cat >> ~/.codex/config.toml <<'EOF'\n[mcp_servers.memora]\nurl = "${url}"\nbearer_token_env_var = "MEMORA_KEY"\nEOF\nexport MEMORA_KEY=${key}`;
    case 'cursor':
      return json({ mcpServers: { memora: { url, headers: { Authorization: auth } } } });
    case 'vscode':
      return json({ servers: { memora: { type: 'http', url, headers: { Authorization: auth } } } });
    case 'windsurf':
      return json({ mcpServers: { memora: { serverUrl: url, headers: { Authorization: auth } } } });
    case 'claude-desktop':
      return json({
        mcpServers: { memora: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${MEMORA_AUTH}'], env: { MEMORA_AUTH: auth } } },
      });
    case 'claude-ai':
    case 'chatgpt':
      return url;
    default:
      return json({ mcpServers: { memora: { url, headers: { Authorization: auth } } } });
  }
}

/** A request that proves a key works, for any app (technical details). */
export function testCommand(url: string, key: string): string {
  return `curl -s ${url} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
}

/** An address that only opens on this computer or its local network. */
export function isLocalAddress(url: string): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^(fc|fd)[0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host)
  );
}

/** Apps that work inside a code folder, where "summarize this project" fits. */
function isCodingApp(id: string): boolean {
  return ['claude-code', 'cursor', 'vscode', 'codex', 'gemini', 'windsurf'].includes(id);
}

interface FirstPrompt {
  id: 'saveAll' | 'project' | 'work' | 'personal' | 'slow';
  title: string;
  text: string;
  recommended: boolean;
}

const PROMPTS: Record<FirstPrompt['id'], { title: string; text: string }> = {
  saveAll: {
    title: 'Save everything you know about me',
    text: "You now have long-term memory through Memora. Save into Memora everything you know about me from our conversations: who I am, my work, the projects I'm on, my preferences and important decisions. Make one note per topic in a fitting folder, and link notes that belong together. When you're done, tell me what you saved.",
  },
  project: {
    title: 'Summarize this project',
    text: 'Look through the project in this folder and save it into Memora: what it is for, how it is built, how to run it, technical decisions, and anything worth remembering. Make one note per topic, in a folder named after the project inside Projects.',
  },
  work: {
    title: 'Save my work',
    text: "Save into Memora what you know about my work: my role, my team, the projects I'm on and where they stand, and decisions we made. Make one note per project or topic and link them together.",
  },
  personal: {
    title: 'Save my personal side',
    text: "Save into Memora what I've shared with you about my personal life: my interests, habits, goals, the people who matter to me and things I care about. Put these notes in a folder named Private, one note per topic, and link related notes. Never save passwords, card numbers or other secrets. When you're done, tell me what you saved.",
  },
  slow: {
    title: 'Start slowly',
    text: 'From now on, whenever I tell you something important, save it into Memora. Try it now: save a note that I started using Memora today.',
  },
};

/** The first prompts by purpose, for the empty-vault guide (General is the recommended "save everything"). */
export const STARTER_MODES: readonly { id: FirstPrompt['id']; label: string; hint: string }[] = [
  { id: 'saveAll', label: 'General', hint: 'Everything it already knows about you, sorted into topics.' },
  { id: 'work', label: 'Work', hint: 'Your role, team, projects and decisions.' },
  { id: 'project', label: 'Coding project', hint: 'Run it inside the project folder of a coding app (Claude Code, Cursor, Codex…).' },
  { id: 'personal', label: 'Personal', hint: 'Goes into a Private folder. You can mark it private (folder ⋯ › Privacy) to choose which AIs may read it.' },
  { id: 'slow', label: 'Start slowly', hint: 'Saves as you go, starting with one small note.' },
];

export function starterPrompt(id: FirstPrompt['id']): { title: string; text: string } {
  return PROMPTS[id];
}

/** Three ready prompts: "save everything" (recommended), one that fits the app, and "start slowly". */
export function firstPrompts(app: string): FirstPrompt[] {
  const ids: FirstPrompt['id'][] = ['saveAll', isCodingApp(app) ? 'project' : 'work', 'slow'];
  return ids.map((id, i) => ({ id, ...PROMPTS[id], recommended: i === 0 }));
}

/** After this long without a first call the troubleshooting list opens (seconds). */
export const TROUBLE_AFTER = 120;

/** A readable title from a note path: "Journal/Sprint_retro.md" -> "Sprint retro". */
export function titleOfPath(path: string): string {
  return (path.split('/').pop() || path).replace(/\.md$/i, '').replace(/_/g, ' ');
}

export interface CreatedNote {
  path: string;
  at: number;
}

/** Notes created by `actor` at or after `since` (unix seconds), newest first, one per path. */
export function createdBy(events: readonly Record<string, unknown>[], actor: string, since: number): CreatedNote[] {
  const by = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'node_created' || e.actor !== actor) continue;
    const at = typeof e._ts === 'number' ? e._ts : 0;
    if (at < since) continue;
    const node = e.node as { path?: unknown } | undefined;
    const path = node && typeof node.path === 'string' ? node.path : '';
    if (path && at >= (by.get(path) ?? -1)) by.set(path, at);
  }
  return [...by.entries()].map(([path, at]) => ({ path, at })).sort((a, b) => b.at - a.at);
}
