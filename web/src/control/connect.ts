// "Connect an app": a four-step wizard (app, key, setup, agent instructions)
// built from the server's public URL. The key step picks an existing agent's
// key (shown again after the owner re-enters the password, or made anew), or
// creates an agent inline; every snippet is then filled in with that key.

import { apiGet, apiPost } from '../api';
import { AGENT_PROMPT, AGENT_PROMPT_SHORT } from '../docs/agent-prompt';
import { attr, esc, useStyles } from '../dom';
import { Modal } from '../modal';
import { onAgents } from '../realtime';
import { state } from '../state';
import { toast } from '../toast';
import { agentKey, avatarHTML } from './agents';
import { closeSheet, codeHTML, copyText, ICO, wireCopy } from './ui';
import type { KeyRow, KeysResult } from '../types';

export const KEY_PLACEHOLDER = '<YOUR_MEMORA_KEY>';

export interface ClientSnippet {
  id: string;
  label: string;
  /** What kind of app it is, one or two words. */
  kind: string;
  /** How it connects, as a short badge: Sign in, Run a command, Edit file... */
  how: string;
  /** Numbered steps; `{code}` marks where the snippet goes. */
  steps: string[];
  code: string;
  /** The file the snippet goes in, when there is one. */
  file?: string;
  /** Where the agent instructions go for this app (trusted HTML). */
  rules: string;
  /** The short instructions fit this app better than the full ones. */
  short?: boolean;
  /** OAuth sign-in only: no key is pasted anywhere. */
  oauth?: boolean;
}

/** An agent the key step can use. */
export interface ConnectKey {
  id: string;
  name: string;
  /** The secret is stored sealed and can be shown again. */
  revealable?: boolean;
  /** Connected by an app signing in over OAuth. */
  oauth?: boolean;
}

/** The server's public origin: MEMORA_BASE_URL when set, else this page's origin. */
export function publicOrigin(): string {
  return (state.health.base_url || location.origin).replace(/\/$/, '');
}

/** The MCP endpoint agents connect to. */
export function mcpUrl(): string {
  return publicOrigin() + '/mcp';
}

export function snippets(secret?: string | null): ClientSnippet[] {
  const url = mcpUrl();
  const key = secret || KEY_PLACEHOLDER;
  const json = (v: unknown): string => JSON.stringify(v, null, 2);
  const claudeRules = 'The instructions of a Claude <b>project</b>, or your personal preferences in Claude <b>Settings</b>.';
  return [
    {
      id: 'claude-ai',
      label: 'Claude',
      kind: 'Web & desktop app',
      how: 'Sign in',
      oauth: true,
      steps: [
        'In Claude (web or desktop) open <b>Settings &gt; Connectors</b> and choose <b>Add custom connector</b>.',
        'Fill in the name and URL below.',
        "Authentication: <b>Sign in now</b>. OAuth client: <b>Use Claude's published identity</b> (or <b>Register automatically</b>).",
        'Claude opens Memora: sign in and press <b>Allow</b>. The connection shows up on the Agents page as an agent marked Signed in.',
        '{code}',
        'No OAuth? Pick <b>No sign-in</b> and add the request header <code>Authorization: Bearer &lt;key&gt;</code> instead.',
      ],
      code: `Name:            Memora\nMCP server URL:  ${url}`,
      rules: claudeRules,
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      kind: 'Web app',
      how: 'Sign in',
      oauth: true,
      short: true,
      steps: [
        'In ChatGPT open <b>Settings &gt; Apps &amp; Connectors &gt; Advanced</b> and turn on <b>Developer mode</b>.',
        'Choose <b>Create</b> and fill in the name and URL below. Authentication: <b>OAuth</b>, client ID and secret left empty.',
        '{code}',
        'ChatGPT opens Memora: sign in and press <b>Allow</b>. ChatGPT only signs in with OAuth; it cannot send a key header.',
      ],
      code: `Name:            Memora\nMCP server URL:  ${url}\nAuthentication:  OAuth`,
      rules: 'Your <b>custom instructions</b> (Settings &gt; Personalization), or the instructions of a ChatGPT <b>project</b>.',
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      kind: 'Terminal',
      how: 'Run a command',
      steps: [
        'Run this in a terminal (add <code>--scope user</code> to use it in every project):',
        '{code}',
        'Check it with <code>claude mcp list</code>; Memora should show as connected.',
      ],
      code: `claude mcp add --transport http memora ${url} \\\n  --header "Authorization: Bearer ${key}"`,
      rules: '<code>CLAUDE.md</code> in the project, or <code>~/.claude/CLAUDE.md</code> for every project.',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      kind: 'Editor',
      how: 'Edit file',
      file: '~/.cursor/mcp.json',
      steps: [
        'Open <code>~/.cursor/mcp.json</code> (or <code>.cursor/mcp.json</code> in a project). Create it when missing.',
        'Add the <code>memora</code> entry:',
        '{code}',
        'In <b>Cursor Settings &gt; MCP</b> Memora turns green with its tools listed.',
      ],
      code: json({ mcpServers: { memora: { url, headers: { Authorization: `Bearer ${key}` } } } }),
      rules: 'A project rule in <code>.cursor/rules</code>.',
    },
    {
      id: 'vscode',
      label: 'VS Code / Copilot',
      kind: 'Editor',
      how: 'Paste config',
      file: '.vscode/mcp.json',
      steps: [
        'Run <b>MCP: Open User Configuration</b> from the Command Palette (or create <code>.vscode/mcp.json</code> in the workspace).',
        'Add the <code>memora</code> server. VS Code uses <code>servers</code>, not <code>mcpServers</code>:',
        '{code}',
        'Press <b>Start</b> above the entry, then use Memora from Copilot Chat in agent mode.',
      ],
      code: json({ servers: { memora: { type: 'http', url, headers: { Authorization: `Bearer ${key}` } } } }),
      rules: '<code>.github/copilot-instructions.md</code> in the repository.',
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      kind: 'Terminal',
      how: 'Edit file',
      file: '~/.codex/config.toml',
      steps: [
        'Add this to <code>~/.codex/config.toml</code>:',
        '{code}',
        'Export the key in the shell that starts Codex, then check with <code>codex mcp list</code>.',
      ],
      code: `[mcp_servers.memora]\nurl = "${url}"\nbearer_token_env_var = "MEMORA_KEY"\n\n# in your shell:\nexport MEMORA_KEY=${key}`,
      rules: '<code>AGENTS.md</code> in the project, or <code>~/.codex/AGENTS.md</code> for every project.',
    },
    {
      id: 'gemini',
      label: 'Gemini CLI',
      kind: 'Terminal',
      how: 'Edit file',
      file: '~/.gemini/settings.json',
      steps: [
        'Open <code>~/.gemini/settings.json</code> (or <code>.gemini/settings.json</code> in a project).',
        'Add the <code>memora</code> server (streamable HTTP uses <code>httpUrl</code>):',
        '{code}',
        'Restart Gemini CLI and run <code>/mcp</code> to see Memora and its tools.',
      ],
      code: json({ mcpServers: { memora: { httpUrl: url, headers: { Authorization: `Bearer ${key}` } } } }),
      rules: '<code>GEMINI.md</code> in the project, or <code>~/.gemini/GEMINI.md</code> for every project.',
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      kind: 'Editor',
      how: 'Edit file',
      file: '~/.codeium/windsurf/mcp_config.json',
      steps: [
        'Open <b>Windsurf Settings &gt; Cascade &gt; MCP servers &gt; View raw config</b> (<code>~/.codeium/windsurf/mcp_config.json</code>).',
        'Add the <code>memora</code> entry (Windsurf uses <code>serverUrl</code>):',
        '{code}',
        'Press <b>Refresh</b>; Memora appears in the MCP list.',
      ],
      code: json({ mcpServers: { memora: { serverUrl: url, headers: { Authorization: `Bearer ${key}` } } } }),
      rules: "Windsurf's <b>rules</b>: a global rule, or a workspace rule for one project.",
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop (file)',
      kind: 'Older desktop builds',
      how: 'Edit file',
      file: 'claude_desktop_config.json',
      steps: [
        'Only for older Claude Desktop builds without connectors (else pick <b>Claude</b>).',
        'Open <b>Settings &gt; Developer &gt; Edit Config</b> and add this (needs Node.js for mcp-remote):',
        '{code}',
        'Restart Claude Desktop.',
      ],
      code: json({
        mcpServers: {
          memora: {
            command: 'npx',
            args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${MEMORA_AUTH}'],
            env: { MEMORA_AUTH: `Bearer ${key}` },
          },
        },
      }),
      rules: claudeRules,
    },
    {
      id: 'http',
      label: 'Any client',
      kind: 'Any MCP client',
      how: 'HTTP + key',
      steps: [
        'Streamable HTTP MCP endpoint with a bearer token. Test it with curl:',
        '{code}',
        'A JSON list of tools means the key works.',
      ],
      code: `curl -s ${url} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
      rules: "The client's system prompt or project instructions.",
    },
  ];
}

const CSS = `
.cn-wz{min-width:0}
.cn-prog{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:0 0 20px;padding:0;list-style:none}
.cn-prog li{min-width:0}
.cn-prog button{display:flex;align-items:center;gap:9px;width:100%;min-height:50px;padding:6px 9px;border-radius:12px;text-align:left;
  border:1px solid var(--line);background:var(--surface-0);color:var(--muted);min-width:0;transition:border-color .16s,color .16s}
.cn-prog button:hover:not(:disabled){border-color:var(--line-strong);color:var(--fg)}
.cn-prog button:disabled{cursor:default;opacity:.55}
.cn-prog button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cn-prog .n{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;flex:none;font-size:12px;font-weight:750;
  background:var(--surface-2);border:1px solid var(--line);color:var(--muted)}
.cn-prog .n .cc-i{width:13px;height:13px;stroke-width:2.6}
.cn-prog .l{display:flex;flex-direction:column;min-width:0;font-size:12.5px;font-weight:650;line-height:1.25}
.cn-prog .l small{font-size:11.5px;font-weight:500;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-prog .done button{color:var(--fg)}
.cn-prog .done .n{background:var(--ok-soft);border-color:color-mix(in srgb,var(--ok) 40%,transparent);color:var(--ok)}
.cn-prog .on button{border-color:var(--accent-line);background:var(--accent-soft);color:var(--fg)}
.cn-prog .on .n{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#04211d)}
.cn-h{margin:0;font-size:17px;font-weight:700;letter-spacing:-.01em;outline:none}
.cn-sub{margin:4px 0 16px;font-size:13px;color:var(--muted);line-height:1.5}
.cn-sub code,.cn-note code,.cn-where code,.cn-test code{font:500 12px var(--mono,monospace);padding:1px 5px;border-radius:5px;background:var(--surface-2)}

/* step 1: apps */
.cn-q{max-width:none;height:42px;margin:0 0 12px;background:var(--surface-0)}
.cn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:8px}
.cn-tile{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"ini how" "tx tx";align-items:center;gap:12px 8px;
  padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--surface-0);text-align:left;min-width:0;color:var(--fg);
  transition:border-color .16s,background .16s}
.cn-tile:hover{border-color:var(--line-strong);background:var(--panel-2)}
.cn-tile:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cn-tile[aria-pressed=true]{border-color:var(--accent-line);background:var(--accent-soft)}
.cn-ini{grid-area:ini;display:grid;place-items:center;width:32px;height:32px;border-radius:9px;font-size:12px;font-weight:800;
  background:var(--surface-2);color:var(--fg);border:1px solid var(--line)}
.cn-tile[aria-pressed=true] .cn-ini{background:var(--accent);color:var(--on-accent,#04211d);border-color:var(--accent)}
.cn-tile .tx{grid-area:tx;min-width:0}
.cn-tile b{display:block;font-size:13.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-tile small{display:block;font-size:12px;color:var(--muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-how{grid-area:how;justify-self:end;display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:99px;font-size:11.5px;
  font-weight:650;white-space:nowrap;border:1px solid var(--line);color:var(--muted);background:var(--panel-2)}
.cn-how.oauth{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent);background:var(--ok-soft)}
.cn-empty{padding:18px 4px;text-align:center;color:var(--muted);font-size:12.5px}

/* step 2: key */
.cn-mode{margin:0 0 14px}
.cn-mode button{min-height:36px;padding:6px 14px}
.cn-field{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}
.cn-field>span{font-size:12.5px;font-weight:600;color:var(--muted)}
.cn-field select,.cn-new input{height:42px;box-sizing:border-box;border-radius:10px;border:1px solid var(--line-strong);background:var(--surface-0);
  color:var(--fg);padding:0 12px;font-size:14px;min-width:0}
.cn-field select:focus,.cn-new input:focus,.cn-key input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent-line)}
.cn-new{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 6px}
.cn-new input{flex:1 1 220px}
.cn-new .btn{height:42px}
.cn-hint{margin:0 0 12px;font-size:12px;color:var(--muted);line-height:1.5}
.cn-key{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:12px 13px;margin:0 0 12px;border-radius:12px;min-width:0;
  border:1px solid var(--line);background:var(--surface-2);font-size:12.5px}
.cn-key>b{font-size:12.5px;color:var(--fg);font-weight:650}
.cn-key code{font:500 12.5px/1.3 var(--mono,monospace);color:var(--fg);word-break:break-all;min-width:0;flex:1 1 160px}
.cn-key .grow{flex:1}
.cn-key input{height:40px;box-sizing:border-box;padding:0 11px;border-radius:9px;border:1px solid var(--line-strong);background:var(--surface-0);
  color:var(--fg);font-size:14px;min-width:0;flex:1 1 180px}
.cn-key .btn{height:36px}
.cn-key p{margin:0;flex-basis:100%;color:var(--muted);font-size:12px;line-height:1.5}
.cn-key.ok{border-color:color-mix(in srgb,var(--ok) 35%,var(--line))}
.cn-once{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:12px;margin:0 0 12px;font-size:12.5px;line-height:1.5;
  border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-soft)}
.cn-once .cc-i{color:var(--warn);margin-top:1px}

/* step 3: setup */
.cn-note{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:11px 13px;border-radius:12px;margin:0 0 14px;font-size:12.5px;line-height:1.5;
  border:1px solid var(--line);background:var(--surface-2)}
.cn-note>span:not(.ag-av){flex:1 1 220px;min-width:0}
.cn-note .ag-av{flex:none}
.cn-note.ok{border-color:color-mix(in srgb,var(--ok) 35%,var(--line))}
.cn-note.warn{border-color:color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-soft)}
.cn-note .btn{height:34px}
.cn-away{font-size:12px;margin:0 0 12px;color:var(--muted)}
.cn-steps{margin:0 0 16px;padding:0;list-style:none;counter-reset:step;font-size:13px;line-height:1.55;min-width:0}
.cn-steps li{position:relative;margin:0 0 10px;padding-left:30px;min-width:0}
.cn-steps li:not(.code)::before{counter-increment:step;content:counter(step);position:absolute;left:0;top:1px;width:21px;height:21px;
  border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:750;color:var(--accent);background:var(--accent-soft)}
.cn-steps li.code{padding-left:0}
.cn-steps code{font:500 12px var(--mono,monospace);padding:1px 5px;border-radius:5px;background:var(--surface-2);word-break:break-word}
.cn-file{display:flex;align-items:center;gap:6px;margin:0 0 6px;font-size:12px;color:var(--muted)}
.cn-file code{color:var(--fg)}
.cn-wz .cc-code-wrap{min-width:0;max-width:100%}
.cn-wz .cc-code{max-width:100%}
.cn-wz .cc-copy{width:36px;height:36px;border:1px solid var(--line)}
.cn-big{width:100%;height:44px;margin-top:8px;border-radius:11px;font-size:14px}
.cn-test{padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--surface-0);margin:0 0 4px}
.cn-test h4{margin:0 0 4px;font-size:14px;font-weight:680}
.cn-test p{margin:0 0 10px;font-size:12.5px;color:var(--muted);line-height:1.5}
.cn-ask{display:flex;align-items:center;gap:8px;padding:9px 6px 9px 12px;border-radius:10px;background:var(--surface-2);font-size:13px;margin:0 0 10px;min-width:0}
.cn-ask span{flex:1;min-width:0}
.cn-ask .cc-ibtn{width:36px;height:36px;border:1px solid var(--line)}
.cn-live{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--muted);min-height:22px}
.cn-live b{color:var(--fg);font-weight:650}
.cn-live.ok{color:var(--ok)}
.cn-live.ok b{color:var(--ok)}

/* step 4: instructions */
.cn-where{padding:11px 13px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2);font-size:13px;line-height:1.55;margin:0 0 14px}
.cn-where>b{display:block;font-size:12px;color:var(--muted);font-weight:650;margin-bottom:2px}
.cn-ptabs{margin:0 0 10px}
.cn-ptabs .rec{font-size:11px;font-weight:650;color:var(--accent);margin-left:6px}
.cn-prompt .cc-code{white-space:pre-wrap;word-break:break-word;max-height:320px}
.cn-doc{display:inline-flex;align-items:center;gap:6px;margin-top:14px;font-size:13px;font-weight:620;color:var(--accent);text-decoration:none}
.cn-doc:hover{text-decoration:underline}
.cn-doc:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

@media (max-width:760px){
  .cc-sh.cn-sheet{height:calc(100dvh - 24px)}
  .cn-prog{gap:4px;margin-bottom:16px}
  .cn-prog button{flex-direction:column;gap:4px;padding:6px 2px;min-height:54px;text-align:center}
  .cn-prog .l{align-items:center;font-size:11.5px}
  .cn-prog .l small{display:none}
  .cn-grid{grid-template-columns:1fr;gap:6px}
  .cn-tile{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"ini tx how";padding:10px 12px;min-height:60px}
  .cn-key .btn,.cn-new .btn{height:44px;flex:1 1 auto}
  .cn-q{height:44px}
}
`;

type Step = 1 | 2 | 3 | 4;
type KeyMode = 'agent' | 'new' | 'none';

export interface WizardOptions {
  /** Agents the key step offers. */
  agents: ConnectKey[];
  /** Preselected agent id. */
  agent?: string;
  /** Its secret, when the caller already has it (just created or rolled). */
  secret?: string;
  /** The secret was just made and is shown this once. */
  fresh?: boolean;
  /** Preselected app (a snippet id). */
  client?: string;
  step?: Step;
  /** Create an agent with default permissions; null when it failed (the caller toasts). */
  createAgent: (name: string) => Promise<{ key: ConnectKey; secret: string } | null>;
  /** A key was made or rolled, or an app connected: the caller may repaint. */
  onChange?: () => void;
  /** Footer buttons belong to the caller: show or hide Back, label Next. */
  setNav: (nav: { back: boolean; next: string }) => void;
}

export interface Wizard {
  back: () => void;
  /** Moves on; true once the last step is done. */
  next: () => boolean;
  destroy: () => void;
}

let lastClient = '';

const mask = (s: string): string => s.slice(0, 12) + '•'.repeat(Math.max(4, s.length - 16)) + s.slice(-4);
const initials = (label: string): string =>
  label
    .split(/[\s/()-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export function mountConnectWizard(host: HTMLElement, o: WizardOptions): Wizard {
  useStyles('cn-css', CSS);
  const agents = [...o.agents];
  const secrets = new Map<string, string>();
  const fresh = new Set<string>();
  if (o.agent && o.secret) {
    secrets.set(o.agent, o.secret);
    if (o.fresh) fresh.add(o.agent);
  }
  let client = o.client || lastClient || (o.step && o.step > 2 ? 'claude-code' : '');
  let agentId = o.agent || '';
  let mode: KeyMode = agentId ? 'agent' : agents.some((a) => !a.oauth) ? 'agent' : 'new';
  if (!agentId && mode === 'agent') agentId = agents.find((a) => !a.oauth)?.id || '';
  let step: Step = o.step || 1;
  let shown = false;
  let promptKind: 'full' | 'short' | '' = '';
  let destroyed = false;

  const list = (): ClientSnippet[] => snippets(currentSecret());
  const cur = (): ClientSnippet | undefined => list().find((s) => s.id === client);
  const agent = (): ConnectKey | undefined => (mode === 'agent' ? agents.find((a) => a.id === agentId) : undefined);
  const currentSecret = (): string => {
    const a = agent();
    return (a && secrets.get(a.id)) || '';
  };
  if (step > 1 && !cur()) step = 1;
  if (step === 2 && cur()?.oauth) step = 3;

  // ── live check: the first call with the chosen key (or a new OAuth sign-in)

  let watchFor = '';
  let stopWatch = (): void => {};
  let connected: { name: string; what: string } | null = null;

  const paintLive = (): void => {
    const box = host.querySelector<HTMLElement>('#cnLive');
    if (!box) return;
    const c = cur();
    const a = agent();
    box.classList.toggle('ok', !!connected);
    if (connected) {
      box.innerHTML = `${ICO.check}<span><b>Connected</b> · ${esc(connected.name)} ${
        connected.what ? 'called <code>' + esc(connected.what) + '</code>' : 'made its first call'
      }. Its card on the Agents page now shows Active.</span>`;
    } else if (c?.oauth) {
      box.innerHTML = `<span class="cc-dot run" aria-hidden="true"></span><span>Waiting for ${esc(c.label)} to sign in...</span>`;
    } else if (a && currentSecret()) {
      box.innerHTML = `<span class="cc-dot run" aria-hidden="true"></span><span>Waiting for the first call from <b>${esc(a.name)}</b>...</span>`;
    } else {
      box.innerHTML = '<span>Once the app makes a call, its agent card on the Agents page turns Active.</span>';
    }
  };

  const hit = (name: string, what: string): void => {
    if (connected || destroyed) return;
    connected = { name, what };
    toast(name + ' is connected', 'ok');
    paintLive();
    o.onChange?.();
  };

  const watch = (): void => {
    const c = cur();
    const a = agent();
    const target = step < 3 || !c ? '' : c.oauth ? 'oauth:' + c.id : a && currentSecret() ? 'key:' + a.id : '';
    if (target === watchFor) return;
    stopWatch();
    watchFor = target;
    connected = null;
    if (!target) return;
    const since = Date.now();
    let timer = 0;
    let unsub = (): void => {};
    stopWatch = () => {
      clearInterval(timer);
      unsub();
      stopWatch = () => {};
    };
    const alive = (): boolean => {
      if (destroyed || !host.isConnected) {
        stopWatch();
        return false;
      }
      return true;
    };
    if (target.startsWith('key:') && a) {
      // Live over the socket, with a poll of the key's call count as a fallback.
      unsub = onAgents((_n, seen) => {
        const m = seen.find(
          (x) => x.kind === 'agent' && x.lastAt >= since && (x.id ? x.id === a.id : agentKey(x.actor) === agentKey(a.name)),
        );
        if (m) hit(a.name, m.lastAction || '');
      });
      let base: number | null = null;
      const poll = async (): Promise<void> => {
        if (!alive()) return;
        const d = await apiGet<KeysResult | KeyRow[]>('/api/keys').catch(() => null);
        const row = d ? (Array.isArray(d) ? d : d.keys || []).find((k) => k.id === a.id) : undefined;
        if (!row || watchFor !== target) return;
        if (base === null) base = row.uses || 0;
        else if ((row.uses || 0) > base) hit(a.name, '');
      };
      void poll();
      timer = window.setInterval(() => void poll(), 4000);
    } else if (c) {
      let base: Set<string> | null = null;
      const poll = async (): Promise<void> => {
        if (!alive()) return;
        const d = await apiGet<{ connections?: { key_id: string }[] }>('/api/oauth/clients').catch(() => null);
        if (!d || watchFor !== target) return;
        const ids = (d.connections || []).map((x) => x.key_id);
        if (!base) {
          base = new Set(ids);
          return;
        }
        const added = ids.find((id) => !base!.has(id));
        if (!added) return;
        const k = await apiGet<KeysResult | KeyRow[]>('/api/keys').catch(() => null);
        const row = k ? (Array.isArray(k) ? k : k.keys || []).find((r) => r.id === added) : undefined;
        hit(row?.name || c.label, '');
      };
      void poll();
      timer = window.setInterval(() => void poll(), 4000);
    }
  };

  // ── markup

  const progHTML = (): string => {
    const c = cur();
    const a = agent();
    const keySub = !c ? 'Pick one' : c.oauth ? 'Not needed' : mode === 'none' ? 'Placeholder' : mode === 'new' ? 'New agent' : a ? (currentSecret() ? a.name : a.name + ', not filled in') : 'Pick one';
    const items: { n: Step; label: string; sub: string; ok: boolean }[] = [
      { n: 1, label: 'App', sub: c?.label || 'Pick one', ok: !!c },
      { n: 2, label: 'Key', sub: keySub, ok: !!c && !c.oauth },
      { n: 3, label: 'Set up', sub: 'Paste & test', ok: !!c },
      { n: 4, label: 'Instructions', sub: 'Prompt', ok: !!c },
    ];
    return `<ol class="cn-prog" aria-label="Setup steps">${items
      .map((it) => {
        // The key step only counts as done once a key is filled in (or left for later on purpose).
        const done = it.n < step && it.ok && (it.n !== 2 || !!currentSecret() || mode === 'none');
        return `<li class="${it.n === step ? 'on' : done ? 'done' : ''}"><button type="button" data-go="${it.n}"${it.ok || it.n === 1 ? '' : ' disabled'}${
          it.n === step ? ' aria-current="step"' : ''
        } aria-label="Step ${it.n} of 4: ${attr(it.label)}, ${attr(it.sub)}"><span class="n" aria-hidden="true">${done ? ICO.check : it.n}</span><span class="l" aria-hidden="true">${esc(
          it.label,
        )}<small>${esc(it.sub)}</small></span></button></li>`;
      })
      .join('')}</ol>`;
  };

  const step1 = (): string => `<h3 class="cn-h" tabindex="-1" data-autofocus>Choose your app</h3>
    <p class="cn-sub">Which app or agent should get a memory? Each one connects to <code>${esc(mcpUrl())}</code>.</p>
    <label class="cc-search cn-q">${ICO.search}<span class="sr-only">Search apps</span><input type="search" id="cnQ" placeholder="Search apps" autocomplete="off"></label>
    <div class="cn-grid" role="group" aria-label="Apps">${list()
      .map(
        (s) => `<button type="button" class="cn-tile" data-client="${attr(s.id)}" data-q="${attr(
          (s.label + ' ' + s.kind + ' ' + s.how).toLowerCase(),
        )}" aria-pressed="${s.id === client}"><span class="cn-ini" aria-hidden="true">${esc(initials(s.label))}</span><span class="tx"><b>${esc(
          s.label,
        )}</b><small>${esc(s.kind)}</small></span><span class="cn-how${s.oauth ? ' oauth' : ''}">${esc(s.how)}</span></button>`,
      )
      .join('')}</div><p class="cn-empty" id="cnNone" hidden>No app matches. <b>Any client</b> works with every MCP client.</p>`;

  const keyBar = (a: ConnectKey): string => {
    const secret = secrets.get(a.id);
    if (secret) {
      return `${
        fresh.has(a.id)
          ? `<div class="cn-once" role="note">${ICO.key}<span><b>This key is shown once.</b> Copy it now or finish the setup; anyone with it can read and write your notes as ${esc(
              a.name,
            )}.</span></div>`
          : ''
      }<div class="cn-key ok"><b>Key</b><code>${esc(shown ? secret : mask(secret))}</code><span class="grow"></span>
        <button type="button" class="btn sm" id="cnKeyEye" aria-pressed="${shown}">${shown ? 'Hide' : 'Show'}</button>
        <button type="button" class="btn sm" id="cnKeyCopy">Copy key</button>
        <p>Filled in on the next step. Keep it private.</p></div>`;
    }
    if (a.oauth) {
      return `<div class="cn-key"><b>Key</b><p>${esc(a.name)} signed in over OAuth: the app holds its own token, so there is no key to paste. Pick another agent or make a new one.</p></div>`;
    }
    if (a.revealable) {
      return `<form class="cn-key" id="cnReveal"><b>Key</b><input type="password" id="cnPw" autocomplete="current-password" placeholder="Your Memora password" aria-label="Your Memora password"><button type="submit" class="btn sm primary">Fill in ${esc(
        a.name,
      )}'s key</button>
        <p>Your password unlocks this agent's key so the next step is ready to paste.</p></form>`;
    }
    return `<div class="cn-key"><b>Key</b><span class="grow"></span><button type="button" class="btn sm" id="cnRoll">Make a new key &amp; fill in</button>
      <p>This key was only shown once, when it was made, so it cannot be filled in. A new key is shown here; the app using the old one must be updated.</p></div>`;
  };

  const step2 = (): string => {
    const c = cur()!;
    const usable = agents.length > 0;
    const a = agent();
    const seg = (m: KeyMode, label: string, dis = false): string =>
      `<button type="button" role="radio" data-mode="${m}" aria-checked="${mode === m}" tabindex="${mode === m ? 0 : -1}"${dis ? ' disabled' : ''}>${label}</button>`;
    let body = '';
    if (mode === 'agent') {
      body = `<label class="cn-field"><span>Agent</span><select id="cnAgent">${a ? '' : '<option value="">Choose an agent</option>'}${agents
        .map((k) => `<option value="${attr(k.id)}"${k.id === agentId ? ' selected' : ''}>${esc(k.name)}${k.oauth ? ' (signed in)' : ''}</option>`)
        .join('')}</select></label>${a ? keyBar(a) : ''}`;
    } else if (mode === 'new') {
      body = `<form class="cn-new" id="cnNew"><label class="sr-only" for="cnName">Agent name</label><input id="cnName" type="text" autocomplete="off" spellcheck="false" placeholder="Name, e.g. ${attr(
        c.id,
      )}" value="${attr(c.id)}"><button type="submit" class="btn primary">${ICO.plus}Create agent</button></form>
        <p class="cn-hint">It shows up under this name in Activity and the brain. It may use every MCP tool and read and write notes; change that under Permissions any time.</p>`;
    } else {
      body = `<div class="cn-note"><span>The next step shows <code>${esc(KEY_PLACEHOLDER)}</code> where the key goes. Replace it with an agent's key yourself.</span></div>`;
    }
    return `<h3 class="cn-h" tabindex="-1" data-autofocus>Key for ${esc(c.label)}</h3>
      <p class="cn-sub">Give each app its own agent and key, so it shows up under its own name and can be turned off on its own.</p>
      <div class="cc-seg cn-mode" role="radiogroup" aria-label="Key">${seg('agent', 'Existing agent', !usable)}${seg('new', 'New agent')}${seg(
        'none',
        'Fill in later',
      )}</div>${body}`;
  };

  const step3 = (): string => {
    const c = cur()!;
    const a = agent();
    const secret = currentSecret();
    let status = '';
    if (c.oauth) {
      status = `<div class="cn-note ok"><span><b>No key needed.</b> ${esc(c.label)} signs in with your Memora account over OAuth and shows up as its own agent, marked Signed in.</span></div>`;
    } else if (a && secret) {
      status = `<div class="cn-note ok">${avatarHTML(a.name, 28, '', a.id)}<span><b>${esc(a.name)}</b>'s key is filled in below.</span><button type="button" class="btn sm ghost" data-go="2">Change</button></div>`;
    } else {
      status = `<div class="cn-note warn"><span><b>No key filled in.</b> Replace <code>${esc(KEY_PLACEHOLDER)}</code> with an agent's key, or pick one first.</span><button type="button" class="btn sm" data-go="2">Pick a key</button></div>`;
    }
    const away =
      publicOrigin() !== location.origin
        ? `<p class="cn-away">Agents connect through <code class="cc-mono">${esc(mcpUrl())}</code> (MEMORA_BASE_URL), even though this page is open at ${esc(location.host)}.</p>`
        : '';
    const copyLabel = c.oauth ? 'Copy server URL' : c.id === 'claude-code' || c.id === 'http' ? 'Copy command' : 'Copy config';
    const copyValue = c.oauth ? mcpUrl() : c.code;
    const steps = c.steps
      .map((st) =>
        st === '{code}'
          ? `<li class="code">${c.file ? `<div class="cn-file">File <code>${esc(c.file)}</code></div>` : ''}${codeHTML(c.code, 'Copy ' + c.label + ' config')}
             <button type="button" class="btn primary cn-big" data-copy="${attr(copyValue)}">${ICO.copy}${copyLabel}</button></li>`
          : `<li>${st}</li>`,
      )
      .join('');
    const ask = 'Call the Memora healthcheck tool, then search my memory for "project".';
    return `<h3 class="cn-h" tabindex="-1" data-autofocus>Set up ${esc(c.label)}</h3>
      <p class="cn-sub">${esc(c.kind)} · ${esc(c.how)}</p>${status}${away}<ol class="cn-steps">${steps}</ol>
      <section class="cn-test" aria-labelledby="cnTestH"><h4 id="cnTestH">Test the connection</h4>
        <p>Restart or reload the app if it asks, then ask the agent:</p>
        <div class="cn-ask"><span>${esc(ask)}</span><button type="button" class="cc-ibtn" data-copy="${attr(ask)}" aria-label="Copy the test question" title="Copy">${ICO.copy}</button></div>
        <div class="cn-live" id="cnLive" role="status" aria-live="polite"></div></section>`;
  };

  const step4 = (): string => {
    const c = cur()!;
    const kind = promptKind || (c.short ? 'short' : 'full');
    const text = kind === 'short' ? AGENT_PROMPT_SHORT : AGENT_PROMPT;
    const rec = c.short ? 'short' : 'full';
    const tab = (k: 'full' | 'short', label: string): string =>
      `<button type="button" role="tab" data-pk="${k}" aria-selected="${kind === k}" aria-controls="cnPrompt" tabindex="${kind === k ? 0 : -1}">${label}${
        rec === k ? '<span class="rec">Recommended</span>' : ''
      }</button>`;
    return `<h3 class="cn-h" tabindex="-1" data-autofocus>Tell the agent to use its memory</h3>
      <p class="cn-sub">The agent sees Memora's tools, but it works best when told when to recall and when to save. Paste these instructions where ${esc(
        c.label,
      )} reads them.</p>
      <div class="cn-where"><b>Where to paste it</b>${c.rules}</div>
      <div class="cc-seg cn-ptabs" role="tablist" aria-label="Instructions">${tab('full', 'Full')}${tab('short', 'Short')}</div>
      <div class="cn-prompt" id="cnPrompt" role="tabpanel">${codeHTML(text, 'Copy the instructions')}
        <button type="button" class="btn primary cn-big" data-copy="${attr(text)}">${ICO.copy}Copy ${kind === 'short' ? 'short' : 'full'} instructions</button></div>
      <a class="cn-doc" href="/docs/agent-instructions" id="cnDoc">Full documentation ${ICO.arrow}</a>
      <div class="cn-live" id="cnLive" role="status" aria-live="polite" style="margin-top:14px"></div>`;
  };

  // ── paint and wire

  const nav = (): void => o.setNav({ back: step > 1, next: step === 4 ? 'Done' : step === 3 ? 'Next: instructions' : 'Next' });

  const paint = (focus = false): void => {
    if (destroyed) return;
    const body = step === 1 ? step1() : step === 2 ? step2() : step === 3 ? step3() : step4();
    host.innerHTML = `<div class="cn-wz">${progHTML()}<div class="cn-step">${body}</div></div>`;
    wireCopy(host);
    wire();
    nav();
    watch();
    paintLive();
    if (focus) {
      host.closest('.cc-sh-b')?.scrollTo(0, 0);
      host.querySelector<HTMLElement>('.cn-h')?.focus();
    }
  };

  const go = (n: Step): void => {
    const c = cur();
    if (n > 1 && !c) {
      toast('Pick an app first', 'warn');
      return;
    }
    if (n === 2 && c?.oauth) n = 3;
    step = n;
    paint(true);
  };

  const choose = (id: string): void => {
    client = id;
    lastClient = id;
    const c = cur();
    go(c?.oauth || currentSecret() ? 3 : 2);
  };

  const wire = (): void => {
    host.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => (b.onclick = () => go(Number(b.dataset.go) as Step)));
    host.querySelectorAll<HTMLButtonElement>('[data-client]').forEach((b) => (b.onclick = () => choose(b.dataset.client!)));
    const q = host.querySelector<HTMLInputElement>('#cnQ');
    if (q) {
      q.oninput = () => {
        const s = q.value.trim().toLowerCase();
        let n = 0;
        host.querySelectorAll<HTMLElement>('[data-client]').forEach((t) => {
          t.hidden = !!s && !t.dataset.q!.includes(s);
          if (!t.hidden) n++;
        });
        host.querySelector<HTMLElement>('#cnNone')!.hidden = n > 0;
      };
      q.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const vis = Array.from(host.querySelectorAll<HTMLElement>('[data-client]')).filter((t) => !t.hidden);
        if (vis.length === 1) choose(vis[0].dataset.client!);
      };
    }
    const modes = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-mode]'));
    modes.forEach((b) => {
      b.onclick = () => {
        mode = b.dataset.mode as KeyMode;
        if (mode === 'agent' && !agentId) agentId = agents.find((a) => !a.oauth)?.id || agents[0]?.id || '';
        paint();
        host.querySelector<HTMLElement>(`[data-mode="${mode}"]`)?.focus();
      };
      b.onkeydown = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const live = modes.filter((x) => !x.disabled);
        const j = live.indexOf(b);
        live[(j + (e.key === 'ArrowRight' ? 1 : live.length - 1)) % live.length]?.click();
      };
    });
    const sel = host.querySelector<HTMLSelectElement>('#cnAgent');
    if (sel)
      sel.onchange = () => {
        agentId = sel.value;
        shown = false;
        paint();
        host.querySelector<HTMLElement>('#cnAgent')?.focus();
      };
    const eye = host.querySelector<HTMLButtonElement>('#cnKeyEye');
    if (eye)
      eye.onclick = () => {
        shown = !shown;
        paint();
        host.querySelector<HTMLElement>('#cnKeyEye')?.focus();
      };
    const copy = host.querySelector<HTMLButtonElement>('#cnKeyCopy');
    if (copy) copy.onclick = () => void copyText(currentSecret(), 'Key copied');
    const a = agent();
    const reveal = host.querySelector<HTMLFormElement>('#cnReveal');
    if (reveal && a) {
      reveal.onsubmit = async (e) => {
        e.preventDefault();
        const pw = host.querySelector<HTMLInputElement>('#cnPw')!.value;
        if (!pw) return;
        try {
          const r = await apiPost<{ key?: string }>('/api/keys/reveal', { id: a.id, current: pw });
          if (r && r.key) {
            secrets.set(a.id, r.key);
            paint();
          }
        } catch (err) {
          toast((err as Error).message || 'Could not show the key', 'err');
        }
      };
    }
    const roll = host.querySelector<HTMLButtonElement>('#cnRoll');
    if (roll && a) {
      roll.onclick = () =>
        Modal.confirm(
          'Make a new key',
          `${a.name}'s current key stops working at once. The new one is filled in here; update the app that uses the old one.`,
          'Make a new key',
          async () => {
            try {
              const r = await apiPost<{ key?: string }>('/api/keys/roll', { id: a.id });
              Modal.close();
              if (r && r.key) {
                secrets.set(a.id, r.key);
                fresh.add(a.id);
                shown = false;
                o.onChange?.();
                toast('New key created and filled in', 'ok');
                paint();
              }
            } catch (err) {
              toast('Could not make a new key: ' + (err as Error).message, 'err');
            }
          },
          false,
        );
    }
    const form = host.querySelector<HTMLFormElement>('#cnNew');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const input = host.querySelector<HTMLInputElement>('#cnName')!;
        const name = input.value.trim();
        if (!name) {
          toast('Give the agent a name', 'warn');
          input.focus();
          return;
        }
        const btn = form.querySelector<HTMLButtonElement>('button')!;
        btn.disabled = true;
        const r = await o.createAgent(name);
        btn.disabled = false;
        if (!r) return;
        agents.push(r.key);
        secrets.set(r.key.id, r.secret);
        fresh.add(r.key.id);
        agentId = r.key.id;
        mode = 'agent';
        shown = false;
        toast('Agent created; its key is filled in', 'ok');
        paint();
        host.querySelector<HTMLElement>('#cnKeyCopy')?.focus();
      };
    }
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-pk]'));
    tabs.forEach((b) => {
      b.onclick = () => {
        promptKind = b.dataset.pk as 'full' | 'short';
        paint();
        host.querySelector<HTMLElement>(`[data-pk="${promptKind}"]`)?.focus();
      };
      b.onkeydown = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        tabs.find((x) => x !== b)?.click();
      };
    });
    const doc = host.querySelector<HTMLAnchorElement>('#cnDoc');
    if (doc) doc.addEventListener('click', () => closeSheet());
  };

  paint();

  return {
    back: () => {
      if (step === 1) return;
      const c = cur();
      go(step === 3 && c?.oauth ? 1 : ((step - 1) as Step));
    },
    next: () => {
      if (step === 4) return true;
      if (step === 1 && !cur()) {
        toast('Pick an app first', 'warn');
        return false;
      }
      go((step + 1) as Step);
      return false;
    },
    destroy: () => {
      destroyed = true;
      stopWatch();
    },
  };
}
