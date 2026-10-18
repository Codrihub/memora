// "Connect an app". Two ways in:
// - a new agent (the /agents/new page): pick the app, name the agent and
//   choose what it may do (its key is made then), set the app up with that
//   key, give it its instructions;
// - an existing agent (the Setup tab of its page): straight to the setup of
//   the one app it belongs to, with its key filled in (unlocked with the
//   owner's password when it is sealed). An agent never moves to another app.
// Apps that sign in over OAuth skip the key entirely.

import { apiGet, apiPost } from '../api';
import { AGENT_PROMPT, AGENT_PROMPT_SHORT } from '../docs/agent-prompt';
import { attr, esc, useStyles } from '../dom';
import { Modal } from '../modal';
import { onAgents } from '../realtime';
import { state } from '../state';
import { toast } from '../toast';
import { agentKey, avatarHTML } from './agents';
import { closeSheet, codeHTML, copyText, ICO, wireCopy } from './ui';
import { cachedCatalog, permsHTML, presetPerms, summaryText, wirePerms, type PermEditor, type Permissions, type Preset } from './perms';
import { radioCardHTML, useFormStyles, wireRadios } from '../ui/forms';
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
  /** Its permissions, when known (shown after it is made). */
  perms?: Permissions;
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

/** The app with this id, filled in with `secret` when given. */
export function appById(id: string, secret?: string | null): ClientSnippet | undefined {
  return snippets(secret).find((s) => s.id === id);
}

/** A plain name for an agent made for this app: "VS Code / Copilot" -> "VS Code". */
export function appAgentName(s: ClientSnippet): string {
  if (s.id === 'http') return 'Agent';
  return s.label.replace(/\s*\(.*?\)\s*/g, ' ').split(' / ')[0].trim();
}

/** "Claude Code" -> "CC"; one word keeps two letters so Claude, ChatGPT and Cursor differ: "Cl", "Ch", "Cu". */
const initials = (label: string): string => {
  const words = label.split(/[\s/()-]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || '?';
  return w[0].toUpperCase() + (w[1] || '').toLowerCase();
};

const APP_CSS = `
.cn-app{display:inline-grid;place-items:center;flex:none;width:var(--s,32px);height:var(--s,32px);border-radius:calc(var(--s,32px) * .28);
  font-size:calc(var(--s,32px) * .36);font-weight:760;letter-spacing:.01em;color:var(--text-2);background:var(--surface-2);
  border:1px solid var(--line-strong)}
.cn-app.none{color:var(--text-3);border-style:dashed;background:transparent}
`;

/** A rounded-square monogram for an app (agents get round avatars; apps get squares). */
export function appIconHTML(label: string | null | undefined, size = 32): string {
  useStyles('cn-app-css', APP_CSS);
  return label
    ? `<span class="cn-app" aria-hidden="true" style="--s:${size}px">${esc(initials(label))}</span>`
    : `<span class="cn-app none" aria-hidden="true" style="--s:${size}px">?</span>`;
}

const CSS = `
.cn-wz{min-width:0}

/* progress */
.cn-prog{margin:0 0 22px}
.cn-prog ol{display:flex;align-items:center;gap:0;margin:0;padding:0;list-style:none;min-width:0}
.cn-prog li{display:flex;align-items:center;flex:1 1 auto;min-width:0}
.cn-prog li:last-child{flex:0 0 auto}
.cn-prog li button{flex:none}
.cn-prog li:not(:last-child)::after{content:"";flex:1;height:1.5px;margin:0 10px;border-radius:2px;background:var(--line-strong);min-width:12px}
.cn-prog li.done:not(:last-child)::after{background:var(--accent-line)}
.cn-prog button{display:flex;align-items:center;gap:8px;min-width:0;padding:4px 6px 4px 4px;margin:-4px -6px -4px -4px;border-radius:99px;
  color:var(--muted);font-size:13px;font-weight:600;white-space:nowrap}
.cn-prog button:not(:disabled):hover{color:var(--fg)}
.cn-prog button:disabled{cursor:default}
.cn-prog .n{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;flex:none;font-size:12px;font-weight:720;
  border:1.5px solid var(--line-strong);color:var(--muted);background:var(--surface-1)}
.cn-prog .n .cc-i{width:13px;height:13px;stroke-width:2.8}
.cn-prog .l{overflow:hidden;text-overflow:ellipsis}
.cn-prog .on button{color:var(--fg)}
.cn-prog .on .n{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.cn-prog .done button{color:var(--text-2)}
.cn-prog .done .n{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
.cn-prog-m{display:none}
.cn-same{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:12px;margin:0 0 16px;font-size:12.5px;line-height:1.5;
  color:var(--text-2);border:1px solid var(--accent-line);background:color-mix(in srgb,var(--accent) 6%,var(--surface-1))}
.cn-same .ic{display:grid;color:var(--accent);margin-top:1px}
.cn-same b{color:var(--fg)}
.cn-used{display:inline-flex;align-items:center;height:21px;padding:0 8px;border-radius:99px;font-size:11px;font-weight:650;white-space:nowrap;
  color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line)}

.cn-h{margin:0;font-size:18px;font-weight:700;letter-spacing:-.015em;line-height:1.3;outline:none}
.cn-sub{margin:5px 0 18px;font-size:13px;color:var(--muted);line-height:1.55}
.cn-sub code,.cn-note code,.cn-where code,.cn-steps code,.cn-hint code{font:500 12px var(--mono);padding:1px 5px;border-radius:5px;
  background:var(--surface-2);border:1px solid var(--line);word-break:break-word}
.cn-link{display:inline;padding:0;font:inherit;font-weight:620;color:var(--accent);background:none;border:0;cursor:pointer;
  text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--accent) 35%,transparent);text-underline-offset:3px}
.cn-link:hover{text-decoration-color:var(--accent)}
.cn-link:focus-visible{border-radius:4px}
.cn-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin:6px 0 18px;font-size:13px;color:var(--muted)}
.cn-meta .sep{width:3px;height:3px;border-radius:50%;background:var(--text-3)}

/* app picker */
.cn-search{position:relative;display:block;margin:0 0 20px}
.cn-search svg{position:absolute;left:13px;top:50%;width:16px;height:16px;margin-top:-8px;color:var(--muted);pointer-events:none}
.cn-search .ui-input{padding-left:38px;height:44px;border-radius:12px}
.cn-group{margin:0 0 18px}
.cn-group[hidden]{display:none}
.cn-group>h4{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 8px;margin:0 0 9px;font-size:12.5px;font-weight:650;color:var(--text-2)}
.cn-group>h4 span{font-weight:500;color:var(--muted)}
.cn-tile .how-m{display:none}
.cn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
.cn-tile{display:flex;align-items:center;gap:11px;padding:10px 12px;min-height:60px;border-radius:12px;min-width:0;text-align:left;
  border:1px solid var(--line);background:var(--surface-0);color:var(--fg);transition:border-color .15s,background .15s,transform .15s}
.cn-tile:hover{border-color:var(--line-strong);background:var(--surface-2)}
.cn-tile:active{transform:scale(.985)}
.cn-tile:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-soft);border-color:var(--accent-line)}
.cn-tile[aria-pressed=true]{border-color:var(--accent-line);background:var(--accent-soft)}
.cn-tile .top{display:contents}
.cn-tile .tx{flex:1;min-width:0;order:1}
.cn-tile .cn-how,.cn-tile .cn-used{order:2;flex:none}
.cn-tile b{display:block;font-size:13.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-tile small{display:block;font-size:12px;color:var(--muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-how{display:inline-flex;align-items:center;height:21px;padding:0 8px;border-radius:99px;font-size:11px;font-weight:640;white-space:nowrap;
  color:var(--muted);background:var(--surface-2);border:1px solid var(--line)}
.cn-tile .go{display:none}
.cn-empty{padding:18px 4px;text-align:center;color:var(--muted);font-size:13px}

/* name & access */
.cn-acc{grid-template-columns:1fr}
.cn-custom{margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}
.cn-done{display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid color-mix(in srgb,var(--ok) 35%,var(--line));
  background:var(--ok-soft)}
.cn-done .tx{flex:1;min-width:0}
.cn-done b{display:block;font-size:14px}
.cn-done small{display:block;font-size:12.5px;color:var(--muted);margin-top:1px}

/* set up */
.cn-note{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;border-radius:12px;margin:0 0 18px;font-size:13px;line-height:1.55;
  border:1px solid var(--line);background:var(--surface-2)}
.cn-note .ic{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;flex:none;background:var(--ok-soft);color:var(--ok)}
.cn-note .tx{flex:1;min-width:0}
.cn-note b{color:var(--fg)}
.cn-away{font-size:12.5px;margin:-8px 0 16px;color:var(--muted);line-height:1.5}
.cn-key{display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;margin:0 0 18px;border-radius:12px;min-width:0;
  border:1px solid var(--line);background:var(--surface-2)}
.cn-key .kt{flex:1;min-width:0}
.cn-key .kt b{display:block;font-size:13px;font-weight:650}
.cn-key code{display:block;font:500 12.5px/1.4 var(--mono);color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-key code.full{white-space:normal;word-break:break-all}
.cn-key .acts{display:flex;gap:6px;flex:none}
.cn-key .btn{height:32px}
.cn-once{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:12px;margin:0 0 10px;font-size:12.5px;line-height:1.5;
  border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-soft)}
.cn-once .cc-i{color:var(--warn);margin-top:1px}
.cn-unlock{padding:14px;margin:0 0 18px;border-radius:12px;border:1px solid var(--accent-line);background:color-mix(in srgb,var(--accent) 5%,var(--surface-1))}
.cn-unlock .hd{display:flex;gap:12px;align-items:flex-start;margin:0 0 12px}
.cn-unlock .ic{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;flex:none;background:var(--accent-soft);color:var(--accent)}
.cn-unlock .hd b{display:block;font-size:14px;font-weight:680}
.cn-unlock .hd small{display:block;margin-top:2px;font-size:12.5px;color:var(--muted);line-height:1.5}
.cn-unlock .row{display:flex;gap:8px}
.cn-unlock .row .ui-input{flex:1}
.cn-unlock .row .btn{height:42px;padding:0 16px;border-radius:10px}
.cn-unlock .alt{margin:10px 0 0;font-size:12.5px;color:var(--muted)}
.cn-steps{margin:0 0 18px;padding:0;list-style:none;counter-reset:step;font-size:13.5px;line-height:1.6;min-width:0}
.cn-steps li{position:relative;margin:0 0 12px;padding-left:34px;min-width:0}
.cn-steps li:not(.code)::before{counter-increment:step;content:counter(step);position:absolute;left:0;top:0;width:23px;height:23px;
  border-radius:50%;display:grid;place-items:center;font-size:11.5px;font-weight:720;color:var(--text-2);background:var(--surface-2);
  border:1px solid var(--line-strong)}
.cn-steps li.code{padding-left:34px}
.cn-file{display:flex;align-items:center;gap:7px;margin:0 0 7px;font-size:12px;color:var(--muted);min-width:0}
.cn-file svg{width:14px;height:14px}
.cn-file code{color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.cn-wz .cc-code-wrap{min-width:0;max-width:100%}
.cn-wz .cc-code{max-width:100%;border-radius:12px 12px 0 0;max-height:300px;padding-right:14px}
.cn-wz .cc-copy{display:none}
.cn-copy{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 8px 8px 14px;border:1px solid var(--line);border-top:0;
  border-radius:0 0 12px 12px;background:var(--surface-2);font-size:12px;color:var(--muted)}
.cn-copy .btn{height:34px;border-radius:9px}
.cn-test{padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--surface-0)}
.cn-test p{margin:12px 0 8px;font-size:12.5px;color:var(--muted);line-height:1.5}
.cn-ask{display:flex;align-items:center;gap:8px;padding:8px 6px 8px 12px;border-radius:10px;background:var(--surface-2);border:1px solid var(--line);
  font-size:13px;min-width:0}
.cn-ask span{flex:1;min-width:0}
.cn-ask .cc-ibtn{width:34px;height:34px}
.cn-live{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-2);min-height:24px;line-height:1.45}
.cn-live b{color:var(--fg);font-weight:650}
.cn-live .pulse{position:relative;width:10px;height:10px;flex:none;border-radius:50%;background:var(--accent)}
.cn-live .pulse::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--accent);opacity:0;animation:cnPulse 1.6s ease-out infinite}
@keyframes cnPulse{0%{opacity:.7;transform:scale(.5)}100%{opacity:0;transform:scale(1.4)}}
.cn-live .ok{display:grid;place-items:center;width:22px;height:22px;flex:none;border-radius:50%;background:var(--ok);color:var(--surface-1)}
.cn-live .ok .cc-i{width:13px;height:13px;stroke-width:3}
.cn-live.on{color:var(--ok)}
.cn-live.on b{color:var(--ok)}
.cn-live code{font:500 12px var(--mono)}
.cn-live .grow{flex:1;min-width:0}
.cn-live .btn{flex:none;height:34px;border-radius:9px}
.cn-live .btn .cc-i{width:14px;height:14px;margin:0 0 0 2px}

/* instructions */
.cn-where{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2);
  font-size:13px;line-height:1.55;margin:0 0 16px}
.cn-where .ic{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;flex:none;background:var(--surface-1);color:var(--muted);
  border:1px solid var(--line)}
.cn-where b.k{display:block;font-size:12px;color:var(--muted);font-weight:650;margin-bottom:1px}
.cn-ptabs{margin:0 0 10px}
.cn-ptabs .rec{font-size:10.5px;font-weight:700;color:var(--accent);margin-left:6px}
.cn-prompt .cc-code{white-space:pre-wrap;word-break:break-word;max-height:300px}
.cn-doc{display:inline-flex;align-items:center;gap:6px;margin-top:16px;font-size:13px;font-weight:620;color:var(--accent)}
.cn-doc .cc-i{width:15px;height:15px}

@media (max-width:760px){
  .cn-prog{margin-bottom:18px}
  .cn-prog li:not(:last-child)::after{margin:0 6px;min-width:8px}
  .cn-prog li:not(.on) .l{display:none}
  .cn-prog li.on{flex:1 1 auto}
  .cn-prog li:not(.on){flex:0 1 auto}
  .cn-prog li:not(.on):not(:last-child){flex:1 1 0}
  .cn-h{font-size:17px}
  .cn-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
  .cn-tile{gap:10px;padding:10px;min-height:58px}
  .cn-tile .top .cn-how,.cn-tile .top .cn-used{display:none}
  .cn-tile b{font-size:13px}
  .cn-group>h4 span{flex-basis:100%}
  .cn-key{flex-wrap:wrap}
  .cn-key .acts{width:100%}
  .cn-key .acts .btn{flex:1;height:40px}
  .cn-unlock .row{flex-direction:column}
  .cn-unlock .row .ui-input{flex:none}
  .cn-unlock .row .btn{height:46px}
  .cn-steps li,.cn-steps li.code{padding-left:32px}
  .cn-steps li.code{padding-left:0}
  .cn-live{flex-wrap:wrap}
}
@media (max-width:360px){.cn-grid{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.cn-live .pulse::after{animation:none}}
`;

export type StepId = 'app' | 'access' | 'setup' | 'prompt';
const STEP_LABEL: Record<StepId, string> = { app: 'App', access: 'Name & access', setup: 'Set up', prompt: 'Instructions' };

export interface WizardOptions {
  /** Set up this existing agent; without it the wizard makes a new agent. */
  agent?: ConnectKey;
  /** The app: preselected for a new agent, or the app the agent is used with. */
  client?: string;
  /** The agent's secret, when the caller already has it (just created or rolled). */
  secret?: string;
  /** The secret was just made and is shown this once. */
  fresh?: boolean;
  /** Names already taken, so the suggested name is unique. */
  names?: string[];
  /** Agents that exist, with the app each one belongs to ('' when unknown), for the one-agent-per-app notice. */
  existing?: { name: string; app: string }[];
  /** Make the agent; null when it failed (the caller toasts). */
  createAgent: (name: string, perms: Permissions) => Promise<{ key: ConnectKey; secret: string } | null>;
  /** The agent is used with this app from now on. */
  onAppChosen?: (keyId: string, clientId: string) => void;
  /** A key was made or rolled, or an app connected: the caller may repaint. */
  onChange?: () => void;
  /** Footer buttons belong to the caller: show or hide Back, label Next. */
  setNav: (nav: { back: boolean; next: string }) => void;
  /** The chosen app, for the sheet's subtitle. */
  setSub?: (sub: string) => void;
  /** After every repaint: where the run is, for a summary beside it. */
  onInfo?: (info: WizardInfo) => void;
  /** Offered once connected: open the agent's own page. */
  onOpenAgent?: (keyId: string) => void;
}

export interface WizardInfo {
  step: StepId;
  /** The chosen app, if any. */
  client: ClientSnippet | null;
  /** The agent, once it is made (or the one being set up). */
  agent: ConnectKey | null;
  /** The name typed so far (new agent, before it is made). */
  name: string;
  /** "Read & write · all tools" and the like. */
  access: string;
  /** The key id of the agent that connected (an OAuth sign-in makes its own). */
  connectedId: string;
  /** Its first call (or sign-in) arrived while the run was open. */
  connected: boolean;
}

export interface Wizard {
  back: () => void;
  info: () => WizardInfo;
  /** Moves on; resolves true once the last step is done. */
  next: () => Promise<boolean>;
  destroy: () => void;
}

const mask = (s: string): string => s.slice(0, 10) + '•'.repeat(Math.max(4, Math.min(18, s.length - 14))) + s.slice(-4);

const ICON = {
  lock: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  file: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>',
  info: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  pin: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  chev: '<svg class="cc-i go" viewBox="0 0 24 24" aria-hidden="true" style="color:var(--muted)"><path d="m9 6 6 6-6 6"/></svg>',
};

export function mountConnectWizard(host: HTMLElement, o: WizardOptions): Wizard {
  useStyles('cn-css', CSS);
  useFormStyles();
  const forAgent = !!o.agent;
  let agent: ConnectKey | null = o.agent || null;
  const secrets = new Map<string, string>();
  const fresh = new Set<string>();
  if (agent && o.secret) {
    secrets.set(agent.id, o.secret);
    if (o.fresh) fresh.add(agent.id);
  }
  let client = o.client && appById(o.client) ? o.client : '';
  /** The app step is part of this run: always for a new agent, never once an agent has its app. */
  const picking = !forAgent || !client;
  let step: StepId = forAgent ? (picking ? 'app' : 'setup') : client ? (appById(client)!.oauth ? 'setup' : 'access') : 'app';
  let name = '';
  let nameEdited = false;
  let preset: Preset = 'rw';
  let custom: Permissions | null = null;
  let editor: PermEditor | null = null;
  let shown = false;
  let promptKind: 'full' | 'short' | '' = '';
  let destroyed = false;

  const secret = (): string => (agent && secrets.get(agent.id)) || '';
  const cur = (): ClientSnippet | undefined => (client ? appById(client, secret()) : undefined);
  const steps = (): StepId[] => {
    if (forAgent) return picking ? ['app', 'setup', 'prompt'] : ['setup', 'prompt'];
    return cur()?.oauth && !agent ? ['app', 'setup', 'prompt'] : ['app', 'access', 'setup', 'prompt'];
  };
  const reachable = (id: StepId): boolean => {
    if (id === 'app') return true;
    const c = cur();
    if (!c) return false;
    if (id === 'access') return !forAgent;
    return forAgent || !!agent || !!c.oauth;
  };
  const defaultName = (): string => {
    const c = cur();
    const base = c ? appAgentName(c) : 'Agent';
    const taken = new Set((o.names || []).map((n) => n.trim().toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  };

  // ── live check: the first call with the agent's key, or a new OAuth sign-in

  let watchFor = '';
  let stopWatch = (): void => {};
  let connected: { name: string; what: string } | null = null;
  let connectedId = '';

  const target = (): string => {
    const c = cur();
    if (!c || (step !== 'setup' && step !== 'prompt')) return '';
    if (c.oauth && (!agent || agent.oauth)) return 'oauth:' + c.id;
    return agent ? 'key:' + agent.id : '';
  };

  const paintLive = (): void => {
    const c = cur();
    host.querySelectorAll<HTMLElement>('[data-live]').forEach((box) => {
      box.classList.toggle('on', !!connected);
      if (connected) {
        const open = !forAgent && o.onOpenAgent && (connectedId || agent?.id);
        box.innerHTML = `<span class="ok">${ICO.check}</span><span class="grow"><b>Connected</b> · ${esc(connected.name)} ${
          connected.what ? 'called <code>' + esc(connected.what) + '</code>' : 'made its first call'
        }.</span>${open ? `<button type="button" class="btn sm" data-open-agent>Open ${esc(connected.name)} ${ICO.arrow}</button>` : ''}`;
        const ob = box.querySelector<HTMLButtonElement>('[data-open-agent]');
        if (ob) ob.onclick = () => o.onOpenAgent?.(connectedId || agent!.id);
      } else if (target().startsWith('oauth:') && c) {
        box.innerHTML = `<span class="pulse" aria-hidden="true"></span><span>Waiting for <b>${esc(c.label)}</b> to sign in…</span>`;
      } else if (agent) {
        box.innerHTML = `<span class="pulse" aria-hidden="true"></span><span>Waiting for the first call from <b>${esc(agent.name)}</b>…</span>`;
      } else box.innerHTML = '';
    });
  };

  const hit = (who: string, what: string, id = ''): void => {
    if (connected || destroyed) return;
    connected = { name: who, what };
    connectedId = id || agent?.id || '';
    toast(who + ' is connected', 'ok');
    paintLive();
    o.onChange?.();
    o.onInfo?.(info());
  };

  const watch = (): void => {
    const t = target();
    if (t === watchFor) return;
    stopWatch();
    watchFor = t;
    connected = null;
    if (!t) return;
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
    const a = agent;
    const c = cur();
    if (t.startsWith('key:') && a) {
      // Live over the socket, with a poll of the key's call count as a fallback.
      unsub = onAgents((_n, seen) => {
        const m = seen.find(
          (x) => x.kind === 'agent' && x.lastAt >= since && (x.id ? x.id === a.id : agentKey(x.actor) === agentKey(a.name)),
        );
        if (m) hit(a.name, m.lastAction || '', a.id);
      });
      let base: number | null = null;
      const poll = async (): Promise<void> => {
        if (!alive()) return;
        const d = await apiGet<KeysResult | KeyRow[]>('/api/keys').catch(() => null);
        const row = d ? (Array.isArray(d) ? d : d.keys || []).find((k) => k.id === a.id) : undefined;
        if (!row || watchFor !== t) return;
        if (base === null) base = row.uses || 0;
        else if ((row.uses || 0) > base) hit(a.name, '', a.id);
      };
      void poll();
      timer = window.setInterval(() => void poll(), 4000);
    } else if (c) {
      let base: Set<string> | null = null;
      const poll = async (): Promise<void> => {
        if (!alive()) return;
        const d = await apiGet<{ connections?: { key_id: string }[] }>('/api/oauth/clients').catch(() => null);
        if (!d || watchFor !== t) return;
        const ids = (d.connections || []).map((x) => x.key_id);
        if (!base) {
          base = new Set(ids);
          return;
        }
        const added = ids.find((id) => !base!.has(id));
        if (!added) return;
        const k = await apiGet<KeysResult | KeyRow[]>('/api/keys').catch(() => null);
        const row = k ? (Array.isArray(k) ? k : k.keys || []).find((r) => r.id === added) : undefined;
        if (row) o.onAppChosen?.(row.id, c.id);
        hit(row?.name || c.label, '', row?.id || '');
      };
      void poll();
      timer = window.setInterval(() => void poll(), 4000);
    }
  };

  // ── markup

  const progHTML = (): string => {
    const ids = steps();
    const at = ids.indexOf(step);
    return `<nav class="cn-prog" aria-label="Progress"><p class="cn-prog-m" aria-hidden="true">Step ${at + 1} of ${ids.length} · <b>${esc(
      STEP_LABEL[step],
    )}</b></p><ol>${ids
      .map((id, i) => {
        const cls = i < at ? 'done' : i === at ? 'on' : '';
        return `<li class="${cls}"><button type="button" data-go="${id}"${reachable(id) ? '' : ' disabled'}${
          i === at ? ' aria-current="step"' : ''
        } aria-label="Step ${i + 1} of ${ids.length}: ${attr(STEP_LABEL[id])}${i < at ? ', done' : ''}"><span class="n" aria-hidden="true">${
          i < at ? ICO.check : i + 1
        }</span><span class="l" aria-hidden="true">${esc(STEP_LABEL[id])}</span></button></li>`;
      })
      .join('')}</ol></nav>`;
  };

  /** Agents that already belong to this app. */
  const sameApp = (id: string): string[] => (o.existing || []).filter((e) => e.app === id).map((e) => e.name);

  const tile = (s: ClientSnippet): string => {
    const used = forAgent ? [] : sameApp(s.id);
    const usedNote = used.length ? `${used.length === 1 ? used[0] : used.length + ' agents'} already uses it` : '';
    return `<button type="button" class="cn-tile" data-client="${attr(s.id)}" data-q="${attr(
      (s.label + ' ' + s.kind + ' ' + s.how).toLowerCase(),
    )}" aria-pressed="${s.id === client}"${usedNote ? ` aria-description="${attr(usedNote)}"` : ''}><span class="top">${appIconHTML(s.label, 34)}${
      used.length ? `<span class="cn-used" title="${attr(usedNote)}">${used.length === 1 ? 'Has an agent' : used.length + ' agents'}</span>` : `<span class="cn-how">${esc(s.how)}</span>`
    }</span><span class="tx"><b>${esc(s.label)}</b><small>${esc(s.kind)}<span class="how-m"> · ${esc(s.how)}</span></small></span>${ICON.chev}</button>`;
  };

  /** "You already have Cursor for Cursor": shown once an app with an agent is picked; continuing is fine. */
  const sameAppNote = (): string => {
    const c = cur();
    if (forAgent || !c) return '';
    const used = [...new Set(sameApp(c.id))];
    if (!used.length) return '';
    const who =
      used.length === 1
        ? esc(used[0])
        : used.length === 2
          ? `${esc(used[0])} and ${esc(used[1])}`
          : `${esc(used[0])}, ${esc(used[1])} and ${used.length - 2} more`;
    return `<div class="cn-same" role="note"><span class="ic">${ICON.info}</span><span>You already have <b>${who}</b> for ${esc(
      c.label,
    )}. A separate agent per device keeps activity apart, so go ahead if this is another computer or setup.</span></div>`;
  };

  const stepApp = (): string => {
    const all = snippets();
    const head = forAgent
      ? `Which app is ${esc(agent!.name)} used with?`
      : 'Which app do you want to connect?';
    const sub = forAgent
      ? `The setup is shown for that app, with ${esc(agent!.name)}'s key filled in.`
      : `Give each app or device its own agent. Activity then shows exactly who did what, and you can turn one off without touching the others.`;
    const oauth = all.filter((s) => s.oauth);
    const keyed = all.filter((s) => !s.oauth);
    return `<h3 class="cn-h" tabindex="-1" data-autofocus>${head}</h3><p class="cn-sub">${sub}</p>
      <label class="cn-search">${ICO.search}<span class="sr-only">Search apps</span><input class="ui-input" type="search" id="cnQ" placeholder="Search apps" autocomplete="off"></label>
      <section class="cn-group" data-group><h4>Sign in <span>No key to copy: the app signs in with your Memora account</span></h4>
        <div class="cn-grid">${oauth.map(tile).join('')}</div></section>
      <section class="cn-group" data-group><h4>With an API key <span>Paste a config with the agent's key</span></h4>
        <div class="cn-grid">${keyed.map(tile).join('')}</div></section>
      <p class="cn-empty" id="cnNone" hidden>No app matches. <b>Any client</b> works with every MCP client.</p>`;
  };

  const accessHTML = (): string => {
    const c = cur()!;
    if (agent) {
      return `<h3 class="cn-h" tabindex="-1" data-autofocus>Name &amp; access</h3><p class="cn-sub">The agent for ${esc(c.label)} is made.</p>
        <div class="cn-done">${avatarHTML(agent.name, 40, '', agent.id)}<span class="tx"><b>${esc(agent.name)} is ready</b><small>${esc(
          agent.perms ? summaryText(agent.perms) : 'Its key is filled in on the next step',
        )}. Change its permissions any time from its page.</small></span></div>`;
    }
    const tools = cachedCatalog();
    const ro = presetPerms('ro', tools);
    return `<h3 class="cn-h" tabindex="-1" data-autofocus>Name it and choose what it may do</h3>
      <p class="cn-sub">${esc(c.label)} gets its own agent and key. The key is made when you continue and filled in on the next step.</p>
      ${sameAppNote()}<div class="ui-fld"><label for="cnName">Agent name</label>
        <input class="ui-input" id="cnName" type="text" autocomplete="off" spellcheck="false" maxlength="64" value="${attr(nameEdited ? name : defaultName())}">
        <span class="ui-help">It shows up under this name in Activity, the brain and the graph. Name it after the device when you use ${esc(
          c.label,
        )} in more than one place, like "${esc(appAgentName(c))} laptop".</span></div>
      <div class="ui-fld" style="margin:0"><span class="ui-lbl" id="cnAccL">Access</span>
        <div class="ui-rcs cn-acc" role="radiogroup" aria-labelledby="cnAccL">
          ${radioCardHTML('rw', preset === 'rw', 'Read &amp; write', 'Search, read and save notes with every MCP tool. It cannot manage the server or other agents.', 'Recommended')}
          ${radioCardHTML(
            'ro',
            preset === 'ro',
            'Read only',
            ro && Array.isArray(ro.tools)
              ? `Search and read notes with the ${ro.tools.length} tools that change nothing.`
              : 'Needs the tool list, which could not be loaded right now.',
            '',
            !ro,
          )}
          ${radioCardHTML('custom', preset === 'custom', 'Custom…', 'Pick exactly which capabilities and tools it gets.')}
        </div></div>
      <div class="cn-custom" id="cnCustom" hidden></div>`;
  };

  const keyHTML = (c: ClientSnippet): string => {
    const a = agent;
    if (!a || (c.oauth && a.oauth)) {
      return `<div class="cn-note"><span class="ic">${ICO.check}</span><span class="tx"><b>No key needed.</b> ${esc(
        c.label,
      )} signs in with your Memora account over OAuth and shows up as its own agent, marked Signed in.</span></div>`;
    }
    const s = secrets.get(a.id);
    if (s) {
      return `${
        fresh.has(a.id)
          ? `<div class="cn-once" role="note">${ICO.key}<span><b>This key is shown once.</b> It is already filled in below; copy it now if you need it elsewhere. Anyone with it can read and write your notes as ${esc(
              a.name,
            )}.</span></div>`
          : ''
      }<div class="cn-key">${avatarHTML(a.name, 32, '', a.id)}<span class="kt"><b>${esc(a.name)}'s key · filled in below</b><code class="${
        shown ? 'full' : ''
      }">${esc(shown ? s : mask(s))}</code></span>
        <span class="acts"><button type="button" class="btn sm" id="cnKeyEye" aria-pressed="${shown}">${shown ? 'Hide' : 'Show'}</button>
        <button type="button" class="btn sm" id="cnKeyCopy">${ICO.copy}Copy key</button></span></div>`;
    }
    if (a.oauth) {
      return `<div class="cn-note"><span class="ic">${ICO.check}</span><span class="tx"><b>${esc(
        a.name,
      )} signed in over OAuth.</b> The app holds its own token, so there is no key to paste. To use ${esc(c.label)} with a key, connect it as a new agent.</span></div>`;
    }
    if (a.revealable) {
      return `<form class="cn-unlock" id="cnUnlock"><div class="hd"><span class="ic">${ICON.lock}</span><span><b>Unlock ${esc(
        a.name,
      )}'s key</b><small>It is stored sealed on the server. Enter your Memora password to fill it into the setup below.</small></span></div>
        <div class="row"><input class="ui-input" type="password" id="cnPw" autocomplete="current-password" placeholder="Your Memora password" aria-label="Your Memora password">
        <button type="submit" class="btn primary">${ICON.lock}Unlock key</button></div>
        <p class="alt">Or <button type="button" class="cn-link" data-roll>make a new key instead</button>; the current one stops working.</p></form>`;
    }
    return `<div class="cn-unlock"><div class="hd"><span class="ic">${ICO.key}</span><span><b>Make a new key for ${esc(
      a.name,
    )}</b><small>Its key was shown only once, when it was made, so it cannot be filled in. A new key replaces it and the old one stops working at once.</small></span></div>
      <div class="row"><button type="button" class="btn primary" data-roll>${ICO.key}Make a new key &amp; fill it in</button></div>
      <p class="alt">Or copy the setup below and put the key in yourself.</p></div>`;
  };

  const stepSetup = (): string => {
    const c = cur()!;
    const away =
      publicOrigin() !== location.origin
        ? `<p class="cn-away">Agents connect through <code class="cc-mono">${esc(mcpUrl())}</code> (MEMORA_BASE_URL), even though this page is open at ${esc(location.host)}.</p>`
        : '';
    const copyLabel = c.oauth ? 'Copy server URL' : c.id === 'claude-code' || c.id === 'http' ? 'Copy command' : 'Copy config';
    const copyValue = c.oauth ? mcpUrl() : c.code;
    const filled = !c.oauth && !!secret();
    const steps = c.steps
      .map((st) =>
        st === '{code}'
          ? `<li class="code">${c.file ? `<div class="cn-file">${ICON.file}<code>${esc(c.file)}</code></div>` : ''}${codeHTML(c.code, 'Copy ' + c.label + ' config')}
             <div class="cn-copy"><span>${c.oauth ? 'Paste these into ' + esc(c.label) : filled ? 'The key is filled in' : 'Put the key where <code>' + esc(KEY_PLACEHOLDER) + '</code> is'}</span>
             <button type="button" class="btn primary" data-copy="${attr(copyValue)}">${ICO.copy}${copyLabel}</button></div></li>`
          : `<li>${st}</li>`,
      )
      .join('');
    const ask = 'Call the Memora healthcheck tool, then search my memory for "project".';
    return `<h3 class="cn-h" tabindex="-1" data-autofocus>Set up ${esc(c.label)}</h3>
      <div class="cn-meta">${appIconHTML(c.label, 22)}<span>${esc(c.kind)} · ${esc(c.how)}</span></div>${away}${agent ? '' : sameAppNote()}${keyHTML(c)}
      <ol class="cn-steps">${steps}</ol>
      <section class="cn-test" aria-label="Test the connection"><div class="cn-live" data-live role="status" aria-live="polite"></div>
        <p>Restart or reload the app if it asks, then ask the agent:</p>
        <div class="cn-ask"><span>${esc(ask)}</span><button type="button" class="cc-ibtn" data-copy="${attr(ask)}" aria-label="Copy the test question" title="Copy">${ICO.copy}</button></div></section>`;
  };

  const stepPrompt = (): string => {
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
      <div class="cn-where"><span class="ic">${ICON.pin}</span><span><b class="k">Where to paste it</b>${c.rules}</span></div>
      <div class="cc-seg cn-ptabs" role="tablist" aria-label="Instructions">${tab('full', 'Full')}${tab('short', 'Short')}</div>
      <div class="cn-prompt" id="cnPrompt" role="tabpanel">${codeHTML(text, 'Copy the instructions')}
        <div class="cn-copy"><span>${kind === 'short' ? 'A few lines, for small context windows' : 'The complete guide, best for most agents'}</span>
        <button type="button" class="btn primary" data-copy="${attr(text)}">${ICO.copy}Copy ${kind === 'short' ? 'short' : 'full'} instructions</button></div></div>
      <a class="cn-doc" href="/docs/agent-instructions" id="cnDoc">Read the full documentation ${ICO.arrow}</a>
      <div class="cn-test" style="margin-top:18px"><div class="cn-live" data-live role="status" aria-live="polite"></div></div>`;
  };

  // ── paint and wire

  const nav = (): void => {
    const first = steps().indexOf(step) <= 0;
    const next = step === 'prompt' ? 'Done' : step === 'access' && !agent ? 'Create key' : 'Continue';
    o.setNav({ back: !first, next });
  };

  const paint = (focus = false): void => {
    if (destroyed) return;
    const body = step === 'app' ? stepApp() : step === 'access' ? accessHTML() : step === 'setup' ? stepSetup() : stepPrompt();
    host.innerHTML = `<div class="cn-wz">${progHTML()}<div class="cn-step">${body}</div></div>`;
    editor = null;
    wireCopy(host);
    wire();
    nav();
    watch();
    paintLive();
    o.setSub?.(cur()?.label || (forAgent ? agent!.name : 'Pick an app'));
    o.onInfo?.(info());
    if (focus) {
      // The step starts at its top, progress included, wherever the page was scrolled.
      if (host.getBoundingClientRect().top < 0) host.scrollIntoView({ block: 'start' });
      host.querySelector<HTMLElement>('.cn-h')?.focus({ preventScroll: true });
    }
  };

  const info = (): WizardInfo => {
    const input = host.querySelector<HTMLInputElement>('#cnName');
    const typed = input ? input.value.trim() : nameEdited ? name : defaultName();
    let access = '';
    if (agent?.perms) access = summaryText(agent.perms);
    else if (!agent && cur() && !cur()!.oauth) {
      const p = preset === 'custom' ? (editor ? editor.read() : custom) : presetPerms(preset, cachedCatalog());
      access = p ? summaryText(p) : preset === 'custom' ? 'Custom' : '';
    } else if (cur()?.oauth && !agent) access = 'Chosen when it signs in';
    return { step, client: cur() || null, agent, name: agent ? agent.name : typed, access, connectedId, connected: !!connected };
  };

  /** Keep the custom permissions when leaving the access step. */
  const keepAccess = (): void => {
    if (step !== 'access' || agent) return;
    const input = host.querySelector<HTMLInputElement>('#cnName');
    if (input && nameEdited) name = input.value;
    if (editor) custom = editor.read();
  };

  const go = (id: StepId): void => {
    if (!reachable(id)) {
      if (!cur()) toast('Pick an app first', 'warn');
      return;
    }
    keepAccess();
    step = id;
    paint(true);
  };

  const chooseApp = (id: string): void => {
    client = id;
    if (agent) {
      o.onAppChosen?.(agent.id, id);
      go('setup');
      return;
    }
    go(cur()?.oauth ? 'setup' : 'access');
  };

  const showCustom = (): void => {
    const box = host.querySelector<HTMLElement>('#cnCustom');
    if (!box) return;
    box.hidden = preset !== 'custom';
    if (preset !== 'custom' || editor) return;
    const tools = cachedCatalog();
    const start = custom || presetPerms('rw', tools)!;
    box.innerHTML = permsHTML(start, tools);
    editor = wirePerms(box, start, tools);
  };

  const create = async (): Promise<void> => {
    if (agent) return go('setup');
    const input = host.querySelector<HTMLInputElement>('#cnName')!;
    const n = input.value.trim();
    if (!n) {
      toast('Give the agent a name', 'warn');
      input.focus();
      return;
    }
    let perms: Permissions | null;
    if (preset === 'custom') {
      const why = editor?.problem();
      if (why) {
        toast(why, 'warn');
        return;
      }
      perms = editor ? editor.read() : custom;
    } else perms = presetPerms(preset, cachedCatalog());
    if (!perms) perms = presetPerms('rw', null)!;
    const r = await o.createAgent(n, perms);
    if (!r || destroyed) return;
    agent = { ...r.key, perms };
    secrets.set(agent.id, r.secret);
    fresh.add(agent.id);
    o.onAppChosen?.(agent.id, client);
    step = 'setup';
    paint(true);
  };

  const wire = (): void => {
    host.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go as StepId)));
    host.querySelectorAll<HTMLButtonElement>('[data-client]').forEach((b) => (b.onclick = () => chooseApp(b.dataset.client!)));
    const q = host.querySelector<HTMLInputElement>('#cnQ');
    if (q) {
      q.oninput = () => {
        const s = q.value.trim().toLowerCase();
        let n = 0;
        host.querySelectorAll<HTMLElement>('[data-group]').forEach((g) => {
          let m = 0;
          g.querySelectorAll<HTMLElement>('[data-client]').forEach((t) => {
            t.hidden = !!s && !t.dataset.q!.includes(s);
            if (!t.hidden) m++;
          });
          g.hidden = !m;
          n += m;
        });
        host.querySelector<HTMLElement>('#cnNone')!.hidden = n > 0;
      };
      q.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const vis = Array.from(host.querySelectorAll<HTMLElement>('[data-client]')).filter((t) => !t.hidden);
        if (vis.length === 1) chooseApp(vis[0].dataset.client!);
      };
    }
    const name = host.querySelector<HTMLInputElement>('#cnName');
    if (name) {
      name.oninput = () => (nameEdited = true);
      name.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void create();
        }
      };
    }
    const acc = host.querySelector<HTMLElement>('.cn-acc');
    if (acc) {
      wireRadios(acc, (v) => {
        preset = v as Preset;
        showCustom();
      });
      showCustom();
    }
    const eye = host.querySelector<HTMLButtonElement>('#cnKeyEye');
    if (eye)
      eye.onclick = () => {
        shown = !shown;
        paint();
        host.querySelector<HTMLElement>('#cnKeyEye')?.focus();
      };
    const copy = host.querySelector<HTMLButtonElement>('#cnKeyCopy');
    if (copy) copy.onclick = () => void copyText(secret(), 'Key copied');
    const a = agent;
    const unlock = host.querySelector<HTMLFormElement>('#cnUnlock');
    if (unlock && a) {
      unlock.onsubmit = async (e) => {
        e.preventDefault();
        const pw = host.querySelector<HTMLInputElement>('#cnPw')!;
        if (!pw.value) {
          toast('Enter your Memora password', 'warn');
          pw.focus();
          return;
        }
        const btn = unlock.querySelector<HTMLButtonElement>('button[type=submit]')!;
        btn.disabled = true;
        try {
          const r = await apiPost<{ key?: string }>('/api/keys/reveal', { id: a.id, current: pw.value });
          if (!r || !r.key) throw new Error('the server returned no key');
          secrets.set(a.id, r.key);
          toast('Key unlocked and filled in', 'ok');
          paint();
          host.querySelector<HTMLElement>('#cnKeyCopy')?.focus();
        } catch (err) {
          btn.disabled = false;
          toast((err as Error).message || 'Could not unlock the key', 'err');
          pw.select();
        }
      };
    }
    host.querySelectorAll<HTMLButtonElement>('[data-roll]').forEach((roll) => {
      if (!a) return;
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
                toast('New key made and filled in', 'ok');
                paint();
              }
            } catch (err) {
              toast('Could not make a new key: ' + (err as Error).message, 'err');
            }
          },
          false,
        );
    });
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
    info,
    back: () => {
      const ids = steps();
      const i = ids.indexOf(step);
      if (i > 0) go(ids[i - 1]);
    },
    next: async () => {
      if (step === 'prompt') return true;
      if (step === 'app') {
        if (!cur()) toast('Pick an app first', 'warn');
        else chooseApp(client);
        return false;
      }
      if (step === 'access') {
        await create();
        return false;
      }
      go('prompt');
      return false;
    },
    destroy: () => {
      destroyed = true;
      stopWatch();
    },
  };
}
