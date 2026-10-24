// "Connect an app" wizard: for a new agent (/agents/new) or an existing agent's Setup tab.
// On-screen setup text shows dots for the key; Copy puts the real key in.

import { apiGet, apiPost } from '../api';
import { on } from '../bus';
import { PROMPT_STYLES, savedPromptStyle, savePromptStyle, type PromptStyleId } from '../docs/agent-prompt';
import { attr, esc, useStyles } from '../dom';
import { Modal } from '../modal';
import { onAgents } from '../realtime';
import { state } from '../state';
import { quietToasts } from '../storage';
import { toast } from '../toast';
import { agentKey, avatarHTML } from './agents';
import { closeSheet, codeHTML, copyText, ICO, wireCopy } from './ui';
import {
  accessSentence,
  cachedCatalog,
  permsHTML,
  presetPerms,
  scopesOf,
  summaryText,
  toolsOf,
  wirePerms,
  type PermEditor,
  type Permissions,
  type Preset,
} from './perms';
import {
  createdBy,
  firstPrompts,
  howLabel,
  isLocalAddress,
  KEY_DOTS,
  maskKey,
  oneClickLink,
  setupText,
  testCommand,
  titleOfPath,
  TROUBLE_AFTER,
  type CreatedNote,
  type Method,
} from './connect-model';
import { radioCardHTML, useFormStyles, wireRadios } from '../ui/forms';
import type { KeyRow, KeysResult, LogsResult } from '../types';

const KEY_PLACEHOLDER = '<YOUR_MEMORA_KEY>';

export interface ClientSnippet {
  id: string;
  label: string;
  /** What kind of app it is, a few words. */
  kind: string;
  /** The tile's plain label: "One click" or "Copy setup". */
  how: string;
  method: Method;
  /** Numbered steps (trusted HTML); `{action}` marks where the step's button goes. */
  steps: string[];
  /** The setup text, with the key filled in when given. */
  code: string;
  /** The file the setup goes in, when there is one. */
  file?: string;
  /** More for the technical details (trusted HTML). */
  tech?: string;
  /** Where the standing instructions go for this app (trusted HTML). */
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
  /** It made calls before, so the live check waits for the next one. */
  used?: boolean;
}

/** The server's public origin: MEMORA_BASE_URL when set, else this page's origin. */
function publicOrigin(): string {
  return (state.health.base_url || location.origin).replace(/\/$/, '');
}

/** The MCP endpoint agents connect to. */
export function mcpUrl(): string {
  return publicOrigin() + '/mcp';
}

export function snippets(secret?: string | null): ClientSnippet[] {
  const url = mcpUrl();
  const key = secret || KEY_PLACEHOLDER;
  const claudeRules = 'The instructions of a Claude <b>project</b>, or your personal preferences in Claude <b>Settings</b>.';
  const paste = 'Name it <b>Memora</b> and paste your Memora address as the server URL. {action}';
  const app = (a: Omit<ClientSnippet, 'how' | 'code'>): ClientSnippet => ({ ...a, how: howLabel(a.method), code: setupText(a.id, url, key) });
  return [
    app({
      id: 'claude-ai',
      label: 'Claude',
      kind: 'Web & desktop app',
      method: 'signin',
      oauth: true,
      steps: [
        'In Claude (web or desktop), open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.',
        paste,
        'Click <b>Add</b>, then <b>Connect</b>. A Memora page opens: sign in if asked and press <b>Allow</b>.',
      ],
      tech: 'Claude signs in over OAuth, so no key is pasted: it gets its own key when you press Allow. Without sign-in, connect it as <b>Other app</b> and send the header <code>Authorization: Bearer &lt;key&gt;</code>.',
      rules: claudeRules,
    }),
    app({
      id: 'chatgpt',
      label: 'ChatGPT',
      kind: 'Web app',
      method: 'signin',
      oauth: true,
      short: true,
      steps: [
        'In ChatGPT, open <b>Settings → Apps &amp; Connectors → Advanced settings</b> and turn on <b>Developer mode</b>. Then choose <b>Create</b>.',
        paste,
        'For authentication choose <b>OAuth</b>, leave the client ID and secret empty, and click <b>Create</b>. A Memora page opens: press <b>Allow</b>.',
      ],
      tech: 'ChatGPT only signs in over OAuth; it cannot send a key header.',
      rules: 'Your <b>custom instructions</b> (Settings → Personalization), or the instructions of a ChatGPT <b>project</b>.',
    }),
    app({
      id: 'claude-code',
      label: 'Claude Code',
      kind: 'Runs in your terminal',
      method: 'command',
      steps: [
        'Copy this command. {action}',
        'Paste it in a terminal and press <kbd>Enter</kbd>. Then start Claude Code, or restart it: Memora loads by itself.',
      ],
      tech: 'The command adds Memora for every project (<code>--scope user</code>); leave that out to add it to the current project only. Check it with <code>claude mcp list</code>.',
      rules: '<code>CLAUDE.md</code> in the project, or <code>~/.claude/CLAUDE.md</code> for every project.',
    }),
    app({
      id: 'cursor',
      label: 'Cursor',
      kind: 'Code editor',
      method: 'deeplink',
      file: '~/.cursor/mcp.json',
      steps: [
        'Click the button to add Memora to Cursor. {action}',
        'Cursor opens and asks to install Memora. Click <b>Install</b>; it then shows in <b>Cursor Settings → MCP</b>.',
      ],
      tech: 'Button does nothing? Choose <b>Copy setup instead</b> and paste it into <code>~/.cursor/mcp.json</code> (create the file when missing).',
      rules: 'A project rule in <code>.cursor/rules</code>.',
    }),
    app({
      id: 'vscode',
      label: 'VS Code / Copilot',
      kind: 'Code editor',
      method: 'deeplink',
      file: '.vscode/mcp.json',
      steps: [
        'Click the button to add Memora to VS Code. {action}',
        'VS Code opens and asks to add Memora. Click <b>Install</b>, then use Copilot Chat in agent mode.',
      ],
      tech: 'Button does nothing? Choose <b>Copy setup instead</b>, run <b>MCP: Open User Configuration</b> from the Command Palette and paste it there. VS Code uses <code>servers</code>, not <code>mcpServers</code>.',
      rules: '<code>.github/copilot-instructions.md</code> in the repository.',
    }),
    app({
      id: 'codex',
      label: 'Codex CLI',
      kind: 'Runs in your terminal',
      method: 'command',
      file: '~/.codex/config.toml',
      steps: ['Copy this command. {action}', 'Paste it in a terminal and press <kbd>Enter</kbd>, then start Codex in that same terminal.'],
      tech: 'Codex reads the key from <code>MEMORA_KEY</code>. Add the <code>export</code> line to your shell profile (like <code>~/.bashrc</code>) so new terminals have it too. Check it with <code>codex mcp list</code>.',
      rules: '<code>AGENTS.md</code> in the project, or <code>~/.codex/AGENTS.md</code> for every project.',
    }),
    app({
      id: 'gemini',
      label: 'Gemini CLI',
      kind: 'Runs in your terminal',
      method: 'command',
      steps: [
        'Copy this command. {action}',
        'Paste it in a terminal and press <kbd>Enter</kbd>. Then start Gemini CLI, or restart it, and type <code>/mcp</code> to see Memora.',
      ],
      tech: 'Older Gemini CLI without <code>gemini mcp add</code>: add the server to <code>~/.gemini/settings.json</code> under <code>mcpServers</code>, with <code>httpUrl</code> and the same header.',
      rules: '<code>GEMINI.md</code> in the project, or <code>~/.gemini/GEMINI.md</code> for every project.',
    }),
    app({
      id: 'windsurf',
      label: 'Windsurf',
      kind: 'Code editor',
      method: 'copy',
      file: '~/.codeium/windsurf/mcp_config.json',
      steps: [
        'In Windsurf, open <b>Settings → Cascade → MCP servers</b> and choose <b>View raw config</b>.',
        'Copy the setup. {action}',
        'Paste it into the file and save, then press <b>Refresh</b>. Memora shows up in the list.',
      ],
      tech: 'Other servers in the file already? Add only the <code>memora</code> entry inside <code>mcpServers</code>.',
      rules: "Windsurf's <b>rules</b>: a global rule, or a workspace rule for one project.",
    }),
    app({
      id: 'claude-desktop',
      label: 'Claude Desktop (older)',
      kind: 'Versions without Connectors',
      method: 'copy',
      file: 'claude_desktop_config.json',
      steps: [
        'In Claude Desktop, open <b>Settings → Developer → Edit Config</b>. On newer versions, pick <b>Claude</b> instead.',
        'Copy the setup. {action}',
        'Paste it into the file, save, and restart Claude Desktop. It needs Node.js on this computer.',
      ],
      tech: 'Other servers in the file already? Add only the <code>memora</code> entry inside <code>mcpServers</code>.',
      rules: claudeRules,
    }),
    app({
      id: 'http',
      label: 'Other app',
      kind: 'Any app that takes a server address',
      method: 'copy',
      steps: [
        'Copy your Memora address. {action}',
        'Copy the key from the box below. The app takes it where it asks for a key, token or password.',
        'Paste both into the app and save.',
      ],
      tech: 'Memora speaks MCP over streamable HTTP. Apps send the key in the header <code>Authorization: Bearer &lt;key&gt;</code>.',
      rules: "The app's system prompt or project instructions.",
    }),
  ];
}

/** The app with this id, filled in with `secret` when given. */
export function appById(id: string, secret?: string | null): ClientSnippet | undefined {
  return snippets(secret).find((s) => s.id === id);
}

/** A plain name for an agent made for this app: "VS Code / Copilot" -> "VS Code". */
function appAgentName(s: ClientSnippet): string {
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
.cn-same{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:var(--r-sm);margin:0 0 16px;font-size:12.5px;line-height:1.5;
  color:var(--text-2);border:1px solid var(--accent-line);background:color-mix(in srgb,var(--accent) 6%,var(--surface-1))}
.cn-same .ic{display:grid;color:var(--accent);margin-top:1px}
.cn-same b{color:var(--fg)}

.cn-h{margin:0;font-size:18px;font-weight:650;letter-spacing:-.015em;line-height:1.3;outline:none}
.cn-sub{margin:6px 0 20px;font-size:13.5px;color:var(--muted);line-height:1.55}
.cn-sub code,.cn-note code,.cn-where code,.cn-steps code{font:500 12px var(--mono);padding:1px 5px;border-radius:5px;
  background:var(--surface-2);border:1px solid var(--line);word-break:break-word}
.cn-link{display:inline;padding:0;font:inherit;font-weight:620;color:var(--accent);background:none;border:0;cursor:pointer;
  text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--accent) 35%,transparent);text-underline-offset:3px}
.cn-link:hover{text-decoration-color:var(--accent)}
.cn-link:focus-visible{border-radius:4px}
.cn-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin:6px 0 18px;font-size:13px;color:var(--muted)}
.cn-meta .sep{width:3px;height:3px;border-radius:50%;background:var(--text-3)}

.cn-search{position:relative;display:block;margin:0 0 20px}
.cn-search svg{position:absolute;left:13px;top:50%;width:16px;height:16px;margin-top:-8px;color:var(--muted);pointer-events:none}
.cn-search .ui-input{padding-left:38px;height:42px;border-radius:var(--r-sm)}
.cn-group{margin:0 0 18px}
.cn-group[hidden]{display:none}
.cn-group>h4{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 8px;margin:0 0 10px;font-size:14px;font-weight:650;color:var(--fg)}
.cn-group>h4 span{font-weight:500;color:var(--muted)}
.cn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.cn-tile{display:flex;align-items:center;gap:11px;padding:10px 12px;min-height:60px;border-radius:var(--r-sm);min-width:0;text-align:left;
  border:1px solid var(--line);background:transparent;color:var(--fg);transition:background .15s}
.cn-tile:hover{background:var(--hover)}
.cn-tile:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-soft);border-color:var(--accent-line)}
.cn-tile[aria-pressed=true]{border-color:var(--accent-line);background:var(--accent-soft)}
.cn-tile .tx{flex:1;min-width:0}
.cn-tile b{display:block;font-size:14px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.cn-tile small{display:block;font-size:12px;color:var(--muted);margin-top:2px;line-height:1.35}
.cn-how{display:inline-flex;align-items:center;gap:4px;margin-top:5px;height:20px;padding:0 7px;border-radius:99px;font-size:11px;font-weight:650;
  white-space:nowrap;color:var(--text-2);background:var(--surface-2)}
.cn-how .cc-i{width:12px;height:12px}
.cn-how.one{color:var(--accent);background:var(--accent-soft)}
.cn-tile .cn-in{display:inline-flex;align-items:center;gap:4px;color:var(--text-2);font-weight:600}
.cn-tile .cn-in .cc-i{width:12px;height:12px;color:var(--ok)}
.cn-tile .go{display:none}
.cn-empty{padding:18px 4px;text-align:center;color:var(--muted);font-size:13px}

.cn-acc{grid-template-columns:1fr}
.cn-custom{margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}
.cn-done{display:flex;align-items:center;gap:12px;padding:14px;border-radius:var(--r-sm);border:1px solid color-mix(in srgb,var(--ok) 35%,var(--line));
  background:var(--ok-soft)}
.cn-done .tx{flex:1;min-width:0}
.cn-done b{display:block;font-size:14px}
.cn-done small{display:block;font-size:12.5px;color:var(--muted);margin-top:1px}

.cn-note{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;border-radius:var(--r-sm);margin:0 0 18px;font-size:13px;line-height:1.55;
  border:1px solid transparent;background:var(--surface-2)}
.cn-note .ic{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;flex:none;background:var(--ok-soft);color:var(--ok)}
.cn-note .tx{flex:1;min-width:0}
.cn-note b{color:var(--fg)}
.cn-key{display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;margin:0 0 18px;border-radius:var(--r-sm);min-width:0;
  border:1px solid transparent;background:var(--surface-2)}
.cn-key .kt{flex:1;min-width:0}
.cn-key .kt b{display:block;font-size:13px;font-weight:650}
.cn-key code{display:block;font:500 12.5px/1.4 var(--mono);color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-key code.full{white-space:normal;word-break:break-all}
.cn-key .acts{display:flex;gap:6px;flex:none}
.cn-key .btn{height:32px}
.cn-once{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:var(--r-sm);margin:0 0 10px;font-size:12.5px;line-height:1.5;
  border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-soft)}
.cn-once .cc-i{color:var(--warn);margin-top:1px}
.cn-unlock{padding:14px;margin:0 0 18px;border-radius:var(--r-sm);border:1px solid var(--accent-line);background:color-mix(in srgb,var(--accent) 5%,var(--surface-1))}
.cn-unlock .hd{display:flex;gap:12px;align-items:flex-start;margin:0 0 12px}
.cn-unlock .ic{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;flex:none;background:var(--accent-soft);color:var(--accent)}
.cn-unlock .hd b{display:block;font-size:14px;font-weight:680}
.cn-unlock .hd small{display:block;margin-top:2px;font-size:12.5px;color:var(--muted);line-height:1.5}
.cn-unlock .row{display:flex;gap:8px}
.cn-unlock .row .ui-input{flex:1}
.cn-unlock .row .btn{height:42px;padding:0 16px;border-radius:var(--r-sm)}
.cn-unlock .alt{margin:10px 0 0;font-size:12.5px;color:var(--muted)}
.cn-steps{margin:0 0 18px;padding:0;list-style:none;counter-reset:step;font-size:13.5px;line-height:1.6;min-width:0}
.cn-steps li{position:relative;margin:0 0 12px;padding-left:34px;min-width:0}
.cn-steps li:not(.code)::before{counter-increment:step;content:counter(step);position:absolute;left:0;top:0;width:23px;height:23px;
  border-radius:50%;display:grid;place-items:center;font-size:11.5px;font-weight:720;color:var(--text-2);background:var(--surface-2);
  border:1px solid var(--line-strong)}
.cn-steps li.code{padding-left:34px}
.cn-wz .cc-code-wrap{min-width:0;max-width:100%}
.cn-wz .cc-code{max-width:100%;border-radius:8px 8px 0 0;max-height:300px;padding-right:14px}
.cn-wz .cc-copy{display:none}
.cn-copy{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 8px 8px 14px;border:1px solid var(--line);border-top:0;
  border-radius:0 0 8px 8px;background:var(--surface-2);font-size:12px;color:var(--muted)}
.cn-copy .btn{height:34px;border-radius:var(--r-sm)}
.cn-test{padding:16px;border-radius:var(--r);border:1px solid var(--line);background:transparent}
.cn-test p{margin:12px 0 8px;font-size:12.5px;color:var(--muted);line-height:1.5}
.cn-ask{display:flex;align-items:center;gap:8px;padding:8px 6px 8px 12px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);
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
.cn-live .btn{flex:none;height:34px;border-radius:var(--r-sm)}
.cn-live .btn .cc-i{width:14px;height:14px;margin:0 0 0 2px}

.cn-steps .cn-pre{margin:8px 0 0;border-radius:8px 8px 0 0;white-space:pre-wrap;word-break:break-all;max-height:220px}
.cn-steps .cn-copy{margin:0}
.cn-act{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;margin-top:10px}
.cn-act .btn.primary{height:40px;padding:0 18px;border-radius:var(--r-sm)}
.cn-key.once{border-color:color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-soft)}
.cn-key .kt small{display:block;margin-top:3px;font-size:12px;line-height:1.45;color:var(--text-2)}
.cn-wait-sub{margin:6px 0 0 20px;font-size:12.5px;color:var(--muted);line-height:1.5}
.cn-test .cn-ask{margin-top:12px}
.cn-test.mini{padding:10px 14px;margin:0 0 16px}
.cn-test:empty,.cn-test:has(>[data-live]:empty){display:none}
.cn-ok{display:flex;gap:14px;align-items:flex-start}
.cn-ok .big{display:grid;place-items:center;width:40px;height:40px;flex:none;border-radius:50%;background:var(--ok);color:var(--surface-1)}
.cn-ok .big .cc-i{width:22px;height:22px;stroke-width:3}
.cn-ok .tx{flex:1;min-width:0}
.cn-ok h4{margin:1px 0 2px;font-size:16px;font-weight:650;color:var(--ok)}
.cn-ok p{margin:2px 0 0;font-size:13px;line-height:1.5;color:var(--text-2)}
.cn-ok p b{color:var(--fg)}
.cn-ok .btn{margin-top:10px;height:36px;border-radius:var(--r-sm)}
.cn-test.won{border-color:color-mix(in srgb,var(--ok) 40%,var(--line));background:var(--ok-soft)}
.cn-trouble{margin:16px 0 0;padding:14px 0 0;border-top:1px solid var(--line)}
.cn-trouble h4{margin:0 0 8px;font-size:13.5px;font-weight:680}
.cn-q{border:1px solid var(--line);border-radius:var(--r-sm);margin:0 0 6px;background:var(--surface-1)}
.cn-q>summary{display:flex;align-items:center;gap:8px;padding:10px 12px;font-size:13px;font-weight:620;cursor:pointer;list-style:none;border-radius:var(--r-sm)}
.cn-q>summary::-webkit-details-marker{display:none}
.cn-q>summary:hover{background:var(--hover)}
.cn-q>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cn-q>summary .cc-i{width:15px;height:15px;color:var(--muted);transition:transform .18s var(--ease)}
.cn-q[open]>summary .cc-i{transform:rotate(90deg)}
.cn-q>div{padding:0 12px 12px 35px;font-size:12.5px;line-height:1.55;color:var(--text-2)}
.cn-q>div p{margin:0 0 6px}
.cn-q code{font:500 12px var(--mono);word-break:break-all}
.cn-q .row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.cn-q ul{margin:0;padding-left:18px}
.cn-tech{margin:18px 0 0;border:1px solid var(--line);border-radius:var(--r-sm)}
.cn-tech>summary{display:flex;align-items:center;gap:8px;padding:11px 14px;font-size:13px;font-weight:620;color:var(--text-2);cursor:pointer;
  list-style:none;border-radius:var(--r-sm)}
.cn-tech>summary::-webkit-details-marker{display:none}
.cn-tech>summary:hover{background:var(--hover);color:var(--fg)}
.cn-tech>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cn-tech>summary .cc-i{width:15px;height:15px;color:var(--muted);transition:transform .18s var(--ease)}
.cn-tech[open]>summary .cc-i{transform:rotate(90deg)}
.cn-tech>div{padding:2px 14px 14px;font-size:12.5px;line-height:1.55;color:var(--text-2);min-width:0}
.cn-tech h5{margin:12px 0 5px;font-size:12px;font-weight:680;color:var(--fg)}
.cn-tech p{margin:6px 0 0}
.cn-tech code{font:500 12px var(--mono);padding:1px 5px;border-radius:5px;background:var(--surface-2);border:1px solid var(--line);word-break:break-word}
.cn-tech pre{margin:0;padding:10px 12px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);font:500 12px/1.5 var(--mono);
  white-space:pre-wrap;word-break:break-all;color:var(--text-2);max-height:220px;overflow:auto}

.cn-wz{container:cnwz/inline-size}
.cn-fp{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;margin:0 0 16px}
/* Narrow: the count comes first so it stays in view after copying. */
.cn-count{order:-1}
.cn-count .nr{display:flex;align-items:center;gap:12px;margin-top:6px}
.cn-count .nr .n{margin:0}
@container cnwz (min-width:720px){
  .cn-fp{grid-template-columns:minmax(0,1fr) 240px;align-items:start}
  .cn-count{order:0;position:sticky;top:90px}
  .cn-count .nr{display:block;margin:0}
  .cn-count .nr .n{margin:8px 0 2px}
  .cn-count ul{max-height:260px}
}
.cn-cards{display:flex;flex-direction:column;gap:10px;min-width:0}
.cn-card{padding:14px;border-radius:var(--r-sm);border:1px solid var(--line);background:var(--surface-0);min-width:0}
.cn-card.rec{border-color:var(--accent-line);box-shadow:inset 0 0 0 1px var(--accent-line)}
.cn-card h4{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;margin:0 0 8px;font-size:13.5px;font-weight:680}
.cn-card .tag{font-size:11.5px;font-weight:600;color:var(--accent)}
.cn-card blockquote{margin:0 0 10px;padding:10px 12px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);
  font-size:13px;line-height:1.55;color:var(--text-2)}
.cn-card .row{display:flex;justify-content:flex-end}
.cn-card .btn{height:36px;border-radius:var(--r-sm)}
.cn-count{padding:14px;border-radius:var(--r-sm);border:1px solid var(--line);background:var(--surface-0);min-width:0}
.cn-count h4{display:flex;align-items:center;gap:8px;margin:0;font-size:12.5px;font-weight:650;color:var(--text-2)}
.cn-count .n{display:block;margin:8px 0 2px;font-size:40px;font-weight:300;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums;
  transform-origin:left center}
.cn-count .n.bump{animation:cnBump .5s ease-out}
@keyframes cnBump{0%{transform:scale(1)}40%{transform:scale(1.14);color:var(--ok)}100%{transform:scale(1)}}
.cn-count .sub{margin:0;font-size:12.5px;line-height:1.5;color:var(--muted)}
.cn-count.got .sub{color:var(--ok);font-weight:620}
.cn-count .wr{display:flex;align-items:center;gap:7px;min-height:18px;margin:8px 0 0;font-size:12px;color:var(--text-2)}
.cn-count .wr:empty{display:none}
.cn-count .wr i{width:7px;height:7px;flex:none;border-radius:50%;background:var(--accent);animation:cnBlink 1.2s ease-in-out infinite}
@keyframes cnBlink{0%,100%{opacity:.3}50%{opacity:1}}
.cn-count ul{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:5px;max-height:170px;overflow:auto}
.cn-count ul:empty{display:none}
.cn-count li{display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:8px;background:var(--surface-2);font-size:12.5px;min-width:0}
.cn-count li .cc-i{width:14px;height:14px;flex:none;color:var(--accent)}
.cn-count li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-count li.new{animation:cnIn .4s ease-out}
@keyframes cnIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.cn-count .hint{margin:10px 0 0;font-size:12px;line-height:1.5;color:var(--text-2)}
.cn-more{margin:4px 0 0;border:1px solid var(--line);border-radius:var(--r-sm)}
.cn-more>summary{display:flex;align-items:center;gap:8px;padding:12px 14px;font-size:13.5px;font-weight:650;cursor:pointer;list-style:none;border-radius:var(--r-sm)}
.cn-more>summary::-webkit-details-marker{display:none}
.cn-more>summary:hover{background:var(--hover)}
.cn-more>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cn-more>summary .cc-i{width:15px;height:15px;color:var(--muted);transition:transform .18s var(--ease)}
.cn-more[open]>summary .cc-i{transform:rotate(90deg)}
.cn-more>summary small{font-size:12px;font-weight:500;color:var(--muted)}
.cn-more>div{padding:4px 14px 14px;min-width:0}
.cn-more .lead{margin:0 0 12px;font-size:12.5px;line-height:1.5;color:var(--muted)}

.cn-where{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;border-radius:var(--r-sm);border:1px solid transparent;background:var(--surface-2);
  font-size:13px;line-height:1.55;margin:0 0 16px}
.cn-where .ic{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;flex:none;background:var(--surface-1);color:var(--muted);
  border:1px solid var(--line)}
.cn-where b.k{display:block;font-size:12px;color:var(--muted);font-weight:650;margin-bottom:1px}
.cn-pstyle{display:flex;flex-wrap:wrap;width:fit-content;overflow:visible;margin:0 0 8px}
.cn-pstyle .rec{font-size:11.5px;font-weight:600;color:var(--accent);margin-left:6px}
.cn-pdesc{margin:0 0 12px;font-size:12.5px;color:var(--muted);line-height:1.5}
.cn-ptabs{margin:0 0 10px}
.cn-ptabs .rec{font-size:11.5px;font-weight:600;color:var(--accent);margin-left:6px}
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
  .cn-wait-sub{margin-left:0}
}
@media (max-width:360px){.cn-grid{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){
  .cn-live .pulse::after,.cn-count .n.bump,.cn-count li.new,.cn-count .wr i{animation:none}
  .cn-q>summary .cc-i,.cn-tech>summary .cc-i,.cn-more>summary .cc-i{transition:none}
}
`;

type StepId = 'app' | 'access' | 'setup' | 'prompt';
const STEP_LABEL: Record<StepId, string> = { app: 'App', access: 'Name & access', setup: 'Set up', prompt: 'First prompt' };

interface WizardOptions {
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

const ICON = {
  lock: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  file: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>',
  info: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  pin: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  chev: '<svg class="cc-i go" viewBox="0 0 24 24" aria-hidden="true" style="color:var(--muted)"><path d="m9 6 6 6-6 6"/></svg>',
  right: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  bolt: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5 14h6l-1 7 8-11h-6z"/></svg>',
};

/** After this long without a note the "did you send it?" hint shows (ms). */
const NO_NOTE_HINT = 180_000;

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
  let promptStyle = savedPromptStyle();
  let moreOpen = false;
  let techOpen = false;
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

  let watchFor = '';
  let stopWatch = (): void => {};
  let connected: { name: string; what: string; at: number } | null = null;
  let connectedId = '';
  let connectedPerms: Permissions | null = null;
  let waitStart = 0;
  let troubleTimer = 0;

  const target = (): string => {
    const c = cur();
    if (!c || (step !== 'setup' && step !== 'prompt')) return '';
    if (c.oauth && (!agent || agent.oauth)) return 'oauth:' + c.id;
    return agent ? 'key:' + agent.id : '';
  };

  /** Start (again) the two minutes before the troubleshooting list opens. */
  const armTrouble = (): void => {
    clearTimeout(troubleTimer);
    waitStart = Date.now();
    troubleTimer = window.setTimeout(() => !destroyed && host.isConnected && paintLive(), TROUBLE_AFTER * 1000 + 50);
  };
  // An agent that worked before only waits for its next call: nothing to troubleshoot.
  const troubleOn = (): boolean =>
    !connected && !!waitStart && Date.now() - waitStart >= TROUBLE_AFTER * 1000 && !(target().startsWith('key:') && agent?.used);

  const say = (text: string): void => {
    const el = host.querySelector<HTMLElement>('[data-say]');
    if (el) el.textContent = text;
  };

  const primaryLabel = (c: ClientSnippet, again = false): string => {
    if (c.method === 'signin' || c.id === 'http') return ICO.copy + 'Copy address';
    if (c.method === 'deeplink') return ICO.arrow + (again ? 'Open ' : 'Open in ') + esc(appAgentName(c)) + (again ? ' again' : '');
    return ICO.copy + (c.method === 'command' ? 'Copy command' : 'Copy setup') + (again ? ' again' : '');
  };

  const troubleHTML = (c: ClientSnippet): string => {
    const url = mcpUrl();
    const app = esc(c.label);
    const q = (id: string, title: string, body: string): string =>
      `<details class="cn-q" data-q="${id}"><summary>${ICON.right}<span>${title}</span></summary><div>${body}</div></details>`;
    const reach =
      `<p>Apps connect to <code>${esc(url)}</code>.</p>` +
      (isLocalAddress(url)
        ? c.oauth
          ? `<p>That address only opens on this computer or its network. ${app} connects from the internet, so Memora needs an internet address with https. Ask whoever runs Memora to give it one.</p>`
          : `<p>That address only opens on this computer or its network, which is fine when ${app} runs here too.</p>`
        : `<p>Open it in a browser on the device where ${app} runs: it should answer, not time out.</p>`) +
      (publicOrigin() !== location.origin ? `<p>You opened this page at ${esc(location.host)}; apps use the address above.</p>` : '');
    const parts = [q('reach', `Can ${app} reach Memora's address?`, reach)];
    if (c.oauth) {
      parts.push(
        q(
          'allow',
          'Did you press Allow on the Memora page?',
          `<p>${app} opens a Memora page in your browser to ask for permission. If you closed it, start again from step 1.</p>`,
        ),
      );
    } else {
      parts.push(
        q('restart', `Did you restart ${app}?`, `<p>Some apps only load a new connection after a restart. Quit ${app} fully and open it again.</p>`),
        q(
          'again',
          'Copy it again',
          `<p>The setup may have been pasted only partly. Copy it again, or make a new key if the old one is lost.</p>
          <div class="row"><button type="button" class="btn sm" data-primary>${primaryLabel(c, true)}</button>
          <button type="button" class="btn sm" data-roll>${ICO.key}Make a new key</button></div>`,
        ),
        q('refused', 'Refused attempts', '<div data-refused><p>Checking…</p></div>'),
      );
    }
    return `<div class="cn-trouble"><h4>Not connected yet? Check these</h4>${parts.join('')}</div>`;
  };

  const liveFull = (c: ClientSnippet): string => {
    if (connected) {
      const id = connectedId || agent?.id || '';
      const open = !forAgent && o.onOpenAgent && id;
      const what = connected.what ? `called <code>${esc(connected.what)}</code>` : 'made its first call';
      return `<div class="cn-ok"><span class="big" aria-hidden="true">${ICO.check}</span><span class="tx"><h4>Connected</h4>
        <p><b>${esc(connected.name)}</b> ${what} at ${esc(clockOf(connected.at))}.</p>${
          connectedPerms ? `<p>${esc(accessSentence(connectedPerms))}</p>` : ''
        }${open ? `<button type="button" class="btn sm" data-open-agent>Open ${esc(connected.name)} ${ICO.arrow}</button>` : ''}</span></div>`;
    }
    const t = target();
    if (!t) return '';
    const who = t.startsWith('oauth:')
      ? `Waiting for <b>${esc(c.label)}</b> to sign in…`
      : agent?.used
        ? `Waiting for the next call from <b>${esc(agent.name)}</b>…`
        : `Waiting for the first call from <b>${esc(agent!.name)}</b>…`;
    const ask = 'Call the Memora healthcheck tool, then search my memory for "project".';
    return `<div class="cn-live"><span class="pulse" aria-hidden="true"></span><span>${who}</span></div>
      <p class="cn-wait-sub">This page notices by itself as soon as ${esc(c.label)} connects. Keep it open.</p>${
        t.startsWith('key:')
          ? `<div class="cn-ask"><span>Not sure it is on? Ask ${esc(c.label)}: “${esc(ask)}”</span><button type="button" class="cc-ibtn" data-copy="${attr(
              ask,
            )}" aria-label="Copy the test question" title="Copy">${ICO.copy}</button></div>`
          : ''
      }${troubleOn() ? troubleHTML(c) : ''}`;
  };

  const liveMini = (c: ClientSnippet): string => {
    if (connected)
      return `<div class="cn-live on"><span class="ok" aria-hidden="true">${ICO.check}</span><span class="grow"><b>Connected</b> · ${esc(
        connected.name,
      )} can use Memora now.</span></div>`;
    const t = target();
    if (!t) return '';
    return `<div class="cn-live"><span class="pulse" aria-hidden="true"></span><span>${
      t.startsWith('oauth:') ? `Waiting for <b>${esc(c.label)}</b> to sign in…` : `Waiting for <b>${esc(agent!.name)}</b> to connect…`
    }</span></div>`;
  };

  const fillRefused = (box: HTMLElement, c: ClientSnippet): void => {
    const el = box.querySelector<HTMLElement>('[data-refused]');
    if (!el) return;
    // A little before the wait began, to catch the very first try.
    const since = waitStart / 1000 - 300;
    void apiGet<LogsResult>('/api/auth/events?limit=200')
      .catch(() => null)
      .then((r) => {
        if (!el.isConnected) return;
        if (!r) {
          el.innerHTML = '<p>Could not check right now.</p>';
          return;
        }
        const n = (r.events || []).filter((e) => e.event === 'key_fail' && Number((e as { at?: number }).at || 0) >= since).length;
        el.innerHTML = n
          ? `<p>${n === 1 ? 'Something' : `${n} times, something`} tried to connect with a key that does not work. If that was ${esc(c.label)}, copy the setup again.</p>`
          : `<p>None. Memora has not heard from ${esc(c.label)} at all yet, so it probably has not loaded the setup.</p>`;
      });
  };

  const paintLive = (): void => {
    const c = cur();
    host.querySelectorAll<HTMLElement>('[data-live]').forEach((box) => {
      const mini = box.dataset.live === 'mini';
      box.innerHTML = c ? (mini ? liveMini(c) : liveFull(c)) : '';
      (mini ? box : box.closest('.cn-test'))?.classList.toggle('won', !!connected);
      wireCopy(box);
      wireActions(box);
      const ob = box.querySelector<HTMLButtonElement>('[data-open-agent]');
      if (ob) ob.onclick = () => o.onOpenAgent?.(connectedId || agent!.id);
      if (c && box.querySelector('[data-refused]')) fillRefused(box, c);
    });
  };

  const hit = (who: string, what: string, id = '', perms?: Permissions): void => {
    if (connected || destroyed) return;
    connected = { name: who, what, at: Date.now() };
    connectedId = id || agent?.id || '';
    connectedPerms = perms || agent?.perms || null;
    clearTimeout(troubleTimer);
    // The first call proves the app is the right one, so a guessed app is kept.
    if (forAgent && agent && client) o.onAppChosen?.(agent.id, client);
    // The page says so itself when the check is on screen.
    const box = host.querySelector('[data-live]')?.getBoundingClientRect();
    if (!box || box.bottom < 0 || box.top > window.innerHeight) toast(who + ' is connected', 'ok');
    say(`Connected. ${who} made its first call.`);
    if (step === 'prompt') paint();
    else paintLive();
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
    armTrouble();
    const since = Date.now();
    let timer = 0;
    let unsub = (): void => {};
    stopWatch = () => {
      clearInterval(timer);
      clearTimeout(troubleTimer);
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
        hit(row?.name || c.label, '', row?.id || '', row ? { scopes: scopesOf(row), tools: toolsOf(row) } : undefined);
      };
      void poll();
      timer = window.setInterval(() => void poll(), 4000);
    }
  };

  const cnt = {
    id: '',
    name: '',
    /** Count notes created from this server time on; null: everything after the first look. */
    since: null as number | null,
    base: null as Set<string> | null,
    notes: [] as CreatedNote[],
    shown: 0,
    fresh: new Set<string>(),
    writing: '',
    started: 0,
    timer: 0,
    soon: 0,
    wr: 0,
    busy: false,
    again: false,
    offs: [] as (() => void)[],
  };

  const stopCount = (): void => {
    clearInterval(cnt.timer);
    clearTimeout(cnt.soon);
    clearTimeout(cnt.wr);
    cnt.offs.forEach((f) => f());
    cnt.offs = [];
    cnt.timer = 0;
  };

  const paintCount = (): void => {
    const box = host.querySelector<HTMLElement>('[data-count]');
    const c = cur();
    if (!box || !c) return;
    const n = cnt.notes.length;
    const num = box.querySelector<HTMLElement>('.n')!;
    num.textContent = String(n);
    if (n > cnt.shown) {
      num.classList.remove('bump');
      void num.offsetWidth;
      num.classList.add('bump');
    }
    cnt.shown = n;
    box.classList.toggle('got', n > 0);
    box.querySelector<HTMLElement>('.sub')!.textContent = n
      ? `${cnt.name} saved ${n} note${n === 1 ? '' : 's'} so far.`
      : cnt.id
        ? `Waiting for the first note from ${cnt.name}…`
        : `Counting starts once ${c.label} is connected.`;
    box.querySelector<HTMLElement>('.wr')!.innerHTML = cnt.writing ? `<i aria-hidden="true"></i><span>${esc(cnt.writing)}</span>` : '';
    box.querySelector<HTMLElement>('ul')!.innerHTML = cnt.notes
      .slice(0, 30)
      .map((x) => `<li${cnt.fresh.has(x.path) ? ' class="new"' : ''} title="${attr(x.path)}">${ICON.file}<span>${esc(titleOfPath(x.path))}</span></li>`)
      .join('');
    cnt.fresh.clear();
    const hint = box.querySelector<HTMLElement>('.hint')!;
    hint.hidden = !(cnt.id && !n && cnt.started && Date.now() - cnt.started > NO_NOTE_HINT);
  };

  const pollCount = async (): Promise<void> => {
    if (!cnt.id || destroyed) return;
    if (cnt.busy) {
      cnt.again = true;
      return;
    }
    cnt.busy = true;
    const id = cnt.id;
    const r = await apiGet<LogsResult>(`/api/logs?range=7d&actor=${encodeURIComponent(cnt.name)}&limit=1000`).catch(() => null);
    cnt.busy = false;
    if (destroyed || id !== cnt.id) return;
    if (r) {
      let notes = createdBy((r.events || []) as Record<string, unknown>[], cnt.name, cnt.since ?? 0);
      if (cnt.since === null) {
        if (!cnt.base) cnt.base = new Set(notes.map((x) => x.path));
        notes = notes.filter((x) => !cnt.base!.has(x.path));
      }
      const had = new Set(cnt.notes.map((x) => x.path));
      notes.forEach((x) => !had.has(x.path) && cnt.fresh.add(x.path));
      cnt.notes = notes;
    }
    paintCount();
    if (cnt.again) {
      cnt.again = false;
      void pollCount();
    }
  };

  const startCount = async (): Promise<void> => {
    const id = connectedId || agent?.id || '';
    if (!id || (cnt.id === id && cnt.timer)) return;
    stopCount();
    cnt.id = id;
    cnt.name = connectedId && connected ? connected.name : agent?.name || '';
    cnt.since = null;
    cnt.base = null;
    cnt.notes = [];
    cnt.shown = 0;
    cnt.started = Date.now();
    cnt.timer = window.setInterval(() => void pollCount(), 8000);
    // The count shows its notes as they arrive; a toast for each would only cover the page.
    cnt.offs.push(quietToasts(id));
    const soon = (): void => {
      clearTimeout(cnt.soon);
      cnt.soon = window.setTimeout(() => void pollCount(), 400);
    };
    cnt.offs.push(
      on('mutation', (d) => {
        if (d.type === 'node_created' && d.actor === cnt.name) soon();
      }),
      on('activity', (ev) => {
        if (ev.kind === 'user' || (ev.actorId ? ev.actorId !== cnt.id : ev.actor !== cnt.name)) return;
        const note = ev.phase === 'start' && ev.paths[0] ? titleOfPath(ev.paths[0]) : '';
        if (ev.phase === 'start') cnt.writing = note ? `${cnt.name} is working on ${note}…` : `${cnt.name} is working…`;
        else soon();
        // Not every call reports its end, so the line clears by itself.
        clearTimeout(cnt.wr);
        cnt.wr = window.setTimeout(
          () => {
            cnt.writing = '';
            paintCount();
          },
          ev.phase === 'start' ? 6000 : 2500,
        );
        paintCount();
      }),
    );
    // A new agent counts every note since it was made (its name may be an old one's).
    if (!forAgent) {
      const d = await apiGet<KeysResult | KeyRow[]>('/api/keys').catch(() => null);
      const row = d ? (Array.isArray(d) ? d : d.keys || []).find((k) => k.id === id) : undefined;
      if (cnt.id !== id) return;
      const made = Number((row as { created?: number } | undefined)?.created || 0);
      if (made) cnt.since = made - 1;
    }
    void pollCount();
  };

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
    const usedNote = used.length ? `${used.length === 1 ? used[0] : used.length + ' agents'} already use${used.length === 1 ? 's' : ''} it` : '';
    const one = s.how === 'One click';
    return `<button type="button" class="cn-tile" data-client="${attr(s.id)}" data-q="${attr(
      (s.label + ' ' + s.kind + ' ' + s.how).toLowerCase(),
    )}" aria-pressed="${s.id === client}"${usedNote ? ` aria-description="${attr(usedNote)}"` : ''}>${appIconHTML(s.label, 34)}<span class="tx"><b>${esc(
      s.label,
    )}</b><small>${used.length ? `<span class="cn-in">${ICO.check}${used.length === 1 ? 'Already added' : used.length + ' already added'}</span>` : esc(s.kind)}</small><span class="cn-how${one ? ' one' : ''}">${one ? ICON.bolt : ICO.copy}${esc(s.how)}</span></span>${ICON.chev}</button>`;
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
    const head = forAgent ? `Which app is ${esc(agent!.name)} used with?` : 'Which app do you want to connect?';
    const sub = forAgent
      ? `The setup is shown for that app, with ${esc(agent!.name)}'s key filled in.`
      : `Give each app or device its own agent. Activity then shows exactly who did what, and you can turn one off without touching the others.`;
    const oauth = all.filter((s) => s.oauth);
    const keyed = all.filter((s) => !s.oauth);
    return `<h3 class="cn-h" tabindex="-1" data-autofocus>${head}</h3><p class="cn-sub">${sub}</p>
      <label class="cn-search">${ICO.search}<span class="sr-only">Search apps</span><input class="ui-input" type="search" id="cnQ" placeholder="Search apps" autocomplete="off"></label>
      <section class="cn-group" data-group><h4>Sign in <span>Claude and ChatGPT sign in with your Memora account. Nothing to copy.</span></h4>
        <div class="cn-grid">${oauth.map(tile).join('')}</div></section>
      <section class="cn-group" data-group><h4>Apps on your computer <span>Each one gets its own key from Memora.</span></h4>
        <div class="cn-grid">${keyed.map(tile).join('')}</div></section>
      <p class="cn-empty" id="cnNone" hidden>No app matches. <b>Other app</b> works with any app that takes a server address.</p>`;
  };

  const accessHTML = (): string => {
    const c = cur()!;
    if (agent) {
      return `<h3 class="cn-h" tabindex="-1" data-autofocus>Name &amp; access</h3><p class="cn-sub">The agent for ${esc(c.label)} is made.</p>
        <div class="cn-done">${avatarHTML(agent.name, 40, '', agent.id)}<span class="tx"><b>${esc(agent.name)} is ready</b><small>${esc(
          agent.perms ? summaryText(agent.perms) : 'Its key is filled in on the next step',
        )}. Change its permissions any time from its page.</small></span></div>`;
    }
    return `<h3 class="cn-h" tabindex="-1" data-autofocus>Name it and choose what it may do</h3>
      <p class="cn-sub">${esc(c.label)} gets its own agent and key. The key is made when you continue.</p>
      ${sameAppNote()}<div class="ui-fld"><label for="cnName">Agent name</label>
        <input class="ui-input" id="cnName" type="text" autocomplete="off" spellcheck="false" maxlength="64" value="${attr(nameEdited ? name : defaultName())}">
        <span class="ui-help">It shows up under this name in Activity, the brain and the graph. Name it after the device when you use ${esc(
          c.label,
        )} in more than one place, like "${esc(appAgentName(c))} laptop".</span></div>
      <div class="ui-fld" style="margin:0"><span class="ui-lbl" id="cnAccL">Access</span>
        <div class="ui-rcs cn-acc" role="radiogroup" aria-labelledby="cnAccL">
          ${radioCardHTML('rw', preset === 'rw', 'Can read and change', 'Searches, reads and saves notes. It cannot manage Memora or other agents.', 'Recommended')}
          ${radioCardHTML('ro', preset === 'ro', 'Can only read', 'Searches and reads notes. Any change it tries is refused.')}
          ${radioCardHTML('custom', preset === 'custom', 'Custom…', 'Pick exactly what it may do, tool by tool.')}
        </div></div>
      <div class="cn-custom" id="cnCustom" hidden></div>`;
  };

  /** Before the steps: a key that has to be unlocked or made again first, or the no-key note. */
  const keyFirstHTML = (c: ClientSnippet): string => {
    const a = agent;
    if (!a || (c.oauth && a.oauth)) {
      return c.oauth
        ? `<div class="cn-note"><span class="ic">${ICO.check}</span><span class="tx"><b>No key needed.</b> ${esc(
            c.label,
          )} signs in with your Memora account and shows up as its own agent.</span></div>`
        : '';
    }
    if (secrets.get(a.id)) return '';
    if (a.oauth) {
      return `<div class="cn-note"><span class="ic">${ICO.check}</span><span class="tx"><b>${esc(
        a.name,
      )} signed in with your Memora account.</b> The app holds its own key, so there is nothing to paste. To use ${esc(c.label)} with a key, connect it as a new agent.</span></div>`;
    }
    if (a.revealable) {
      return `<form class="cn-unlock" id="cnUnlock"><div class="hd"><span class="ic">${ICON.lock}</span><span><b>Unlock ${esc(
        a.name,
      )}'s key first</b><small>It is kept locked on the server. Enter your Memora password and the buttons below put it in for you.</small></span></div>
        <div class="row"><input class="ui-input" type="password" id="cnPw" autocomplete="current-password" placeholder="Your Memora password" aria-label="Your Memora password">
        <button type="submit" class="btn primary">${ICON.lock}Unlock key</button></div>
        <p class="alt">Or <button type="button" class="cn-link" data-roll>make a new key instead</button>; the current one stops working.</p></form>`;
    }
    return `<div class="cn-unlock"><div class="hd"><span class="ic">${ICO.key}</span><span><b>Make a new key for ${esc(
      a.name,
    )} first</b><small>Its key was shown only once, when it was made. A new key replaces it and the old one stops working at once.</small></span></div>
      <div class="row"><button type="button" class="btn primary" data-roll>${ICO.key}Make a new key</button></div></div>`;
  };

  /** After the steps: the key in its own box, shown once when it was just made. */
  const keyBoxHTML = (c: ClientSnippet): string => {
    const a = agent;
    const s = a ? secrets.get(a.id) : '';
    if (!a || !s || c.oauth) return '';
    const once = fresh.has(a.id);
    const note =
      c.id === 'http'
        ? 'Paste it into the app where it asks for a key.'
        : `The button above already puts it in; copy it only if you need it somewhere else.`;
    return `<div class="cn-key${once ? ' once' : ''}">${avatarHTML(a.name, 32, '', a.id)}<span class="kt"><b>${esc(a.name)}'s key${
      once ? ' · shown once' : ''
    }</b><code class="${shown ? 'full' : ''}">${esc(shown ? s : maskKey(s))}</code><small>${note}${
      once ? ` Anyone with it can use your notes as ${esc(a.name)}.` : ''
    }</small></span>
      <span class="acts"><button type="button" class="btn sm" id="cnKeyEye" aria-pressed="${shown}">${shown ? 'Hide' : 'Show'}</button>
      <button type="button" class="btn sm" id="cnKeyCopy">${ICO.copy}Copy key</button></span></div>`;
  };

  /** The button (and what it copies, with dots for the key) inside a step. */
  const actionHTML = (c: ClientSnippet): string => {
    if (c.method === 'signin' || c.id === 'http')
      return `<pre class="cc-code cn-pre">${esc(mcpUrl())}</pre><div class="cn-copy"><span>${
        c.oauth ? 'Paste it into ' + esc(c.label) : 'Your Memora address'
      }</span><button type="button" class="btn primary" data-primary>${primaryLabel(c)}</button></div>`;
    if (c.method === 'deeplink')
      return `<div class="cn-act"><button type="button" class="btn primary" data-primary>${primaryLabel(
        c,
      )}</button><button type="button" class="cn-link" data-alt>Copy setup instead</button></div>`;
    return `<pre class="cc-code cn-pre" aria-label="${attr(c.method === 'command' ? 'The command' : 'The setup')}">${esc(
      setupText(c.id, mcpUrl(), KEY_DOTS),
    )}</pre><div class="cn-copy"><span>${secret() ? 'The dots stand for the key; Copy puts it in.' : 'The dots stand for the key. Unlock it above first.'}</span>
      <button type="button" class="btn primary" data-primary>${primaryLabel(c)}</button></div>`;
  };

  const techHTML = (c: ClientSnippet): string => {
    const url = mcpUrl();
    const away =
      publicOrigin() !== location.origin
        ? `<p>Apps use this address (set with <code>MEMORA_BASE_URL</code>), even though this page is open at ${esc(location.host)}.</p>`
        : '';
    const conf =
      c.method === 'deeplink' || (c.method === 'copy' && c.id !== 'http')
        ? `<h5>Setup${c.file ? ` · <code>${esc(c.file)}</code>` : ''}</h5><pre>${esc(setupText(c.id, url, KEY_DOTS))}</pre>`
        : c.file
          ? `<h5>File</h5><p><code>${esc(c.file)}</code></p>`
          : '';
    const test =
      c.id === 'http'
        ? `<h5>Test it</h5><pre>${esc(testCommand(url, KEY_DOTS))}</pre><p>A list of tools in the answer means the key works.</p>`
        : '';
    return `<details class="cn-tech"${techOpen ? ' open' : ''}><summary>${ICON.right}Technical details</summary><div>
      <h5>Memora address (MCP endpoint)</h5><pre>${esc(url)}</pre>${away}${conf}${test}${c.tech ? `<p>${c.tech}</p>` : ''}</div></details>`;
  };

  const stepSetup = (): string => {
    const c = cur()!;
    const steps = c.steps.map((st) => `<li>${st.includes('{action}') ? st.replace('{action}', '') + actionHTML(c) : st}</li>`).join('');
    return `<h3 class="cn-h" tabindex="-1" data-autofocus>Connect ${esc(c.label)}</h3>
      <div class="cn-meta">${appIconHTML(c.label, 22)}<span>${esc(c.kind)} · ${esc(c.how)}</span></div>${agent ? '' : sameAppNote()}${keyFirstHTML(c)}
      <ol class="cn-steps">${steps}</ol>${keyBoxHTML(c)}
      <section class="cn-test" aria-label="Connection check"><p class="sr-only" role="status" aria-live="polite" data-say></p><div data-live="full"></div></section>
      ${techHTML(c)}`;
  };

  const countHTML = (who: string): string =>
    `<aside class="cn-count" data-count aria-labelledby="cnCountH"><h4 id="cnCountH">Notes from ${esc(who)}</h4>
      <div class="nr"><span class="n" aria-hidden="true">0</span><p class="sub" role="status" aria-live="polite"></p></div><p class="wr"></p>
      <ul aria-label="Notes it saved"></ul><p class="hint" hidden>No notes yet. Did you send the prompt? Sometimes the app asks before it uses Memora the first time: allow it.</p></aside>`;

  const stepPrompt = (): string => {
    const c = cur()!;
    const who = (connectedId && connected?.name) || agent?.name || c.label;
    const kind = promptKind || (c.short ? 'short' : 'full');
    const style = promptStyle;
    const text = kind === 'short' ? style.short : style.full;
    const rec = c.short ? 'short' : 'full';
    const tab = (k: 'full' | 'short', label: string): string =>
      `<button type="button" role="tab" data-pk="${k}" aria-selected="${kind === k}" aria-controls="cnPrompt" tabindex="${kind === k ? 0 : -1}">${label}${
        rec === k ? '<span class="rec">Recommended</span>' : ''
      }</button>`;
    const cards = firstPrompts(c.id)
      .map(
        (p, i) => `<section class="cn-card${p.recommended ? ' rec' : ''}" aria-labelledby="cnP${i}"><h4 id="cnP${i}">${esc(p.title)}${
          p.recommended ? '<span class="tag">Recommended</span>' : ''
        }</h4><blockquote>${esc(p.text)}</blockquote>
        <div class="row"><button type="button" class="btn${p.recommended ? ' primary' : ''}" data-prompt="${i}" aria-label="Copy: ${attr(p.title)}">${ICO.copy}Copy</button></div></section>`,
      )
      .join('');
    return `<h3 class="cn-h" tabindex="-1" data-autofocus>Now ask ${esc(who)} to save what it knows</h3>
      <p class="cn-sub">Copy one of these and send it to ${esc(c.label)} like a normal message. The notes it saves show up here as they arrive.</p>
      <div class="cn-test mini" data-live="mini"></div>
      <div class="cn-fp"><div class="cn-cards">${cards}</div>${countHTML(who)}</div>
      <details class="cn-more"${moreOpen ? ' open' : ''}><summary>${ICON.right}<span>More instruction styles <small>· for every conversation</small></span></summary><div>
      <p class="lead">Paste these once where ${esc(c.label)} reads its standing instructions, so it uses Memora in every conversation, not only when asked.</p>
      <div class="cn-where"><span class="ic">${ICON.pin}</span><span><b class="k">Where to paste it</b>${c.rules}</span></div>
      <div class="cc-seg cn-pstyle" role="group" aria-label="Instruction style">${PROMPT_STYLES.map(
        (st, i) =>
          `<button type="button" data-pstyle="${st.id}" aria-pressed="${st.id === style.id}">${esc(st.label)}${i === 0 ? '<span class="rec">Recommended</span>' : ''}</button>`,
      ).join('')}</div>
      <p class="cn-pdesc">${esc(style.desc)}</p>
      ${style.warning ? `<div class="cn-once" role="note">${ICON.lock}<span><b>Notes are not a password manager.</b> ${esc(style.warning)}</span></div>` : ''}
      <div class="cc-seg cn-ptabs" role="tablist" aria-label="Instructions">${tab('full', 'Full')}${tab('short', 'Short')}</div>
      <div class="cn-prompt" id="cnPrompt" role="tabpanel">${codeHTML(text, 'Copy the instructions')}
        <div class="cn-copy"><span>${kind === 'short' ? 'A few lines, for small context windows' : 'The complete guide, best for most agents'}</span>
        <button type="button" class="btn primary" data-copy="${attr(text)}">${ICO.copy}Copy ${kind === 'short' ? 'short' : 'full'} instructions</button></div></div>
      <a class="cn-doc" href="/docs/agent-instructions" id="cnDoc">Read the full documentation ${ICO.arrow}</a></div></details>`;
  };

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
    if (step === 'prompt') {
      void startCount();
      paintCount();
    } else stopCount();
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
    const start = custom || presetPerms('rw');
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
    } else perms = presetPerms(preset);
    if (!perms) perms = presetPerms('rw');
    const r = await o.createAgent(n, perms);
    if (!r || destroyed) return;
    agent = { ...r.key, perms };
    secrets.set(agent.id, r.secret);
    fresh.add(agent.id);
    o.onAppChosen?.(agent.id, client);
    step = 'setup';
    paint(true);
  };

  /** The step's one action: copy the address, open the app's install link, or copy the setup with the key in. */
  const primary = async (alt = false): Promise<void> => {
    const c = cur();
    if (!c) return;
    if (c.method === 'signin' || c.id === 'http') {
      await copyText(mcpUrl(), 'Address copied');
    } else {
      const s = secret();
      if (!s) {
        toast(agent?.revealable ? 'Unlock the key first' : 'Make a new key first', 'warn');
        host.querySelector<HTMLElement>('#cnPw, .cn-unlock [data-roll]')?.focus();
        return;
      }
      if (c.method === 'deeplink' && !alt) {
        window.location.href = oneClickLink(c.id, mcpUrl(), s);
        toast(`Opening ${appAgentName(c)}…`, 'info', 2400);
      } else await copyText(setupText(c.id, mcpUrl(), s), c.method === 'command' ? 'Command copied. Paste it in your terminal.' : 'Setup copied');
    }
    if (!connected && target()) {
      armTrouble();
      if (host.querySelector('.cn-trouble')) paintLive();
    }
  };

  /** Buttons that can show up both in the steps and in the troubleshooting list. */
  const wireActions = (scope: HTMLElement): void => {
    scope.querySelectorAll<HTMLButtonElement>('[data-primary]').forEach((b) => (b.onclick = () => void primary()));
    scope.querySelectorAll<HTMLButtonElement>('[data-alt]').forEach((b) => (b.onclick = () => void primary(true)));
    const a = agent;
    scope.querySelectorAll<HTMLButtonElement>('[data-roll]').forEach((roll) => {
      if (!a) return;
      roll.onclick = () =>
        Modal.confirm(
          'Make a new key',
          `${a.name}'s current key stops working at once. The new one is put in here; update the app that uses the old one.`,
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
                toast('New key made', 'ok');
                if (!connected && target()) armTrouble();
                paint();
              }
            } catch (err) {
              toast('Could not make a new key: ' + (err as Error).message, 'err');
            }
          },
          false,
        );
    });
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
    wireActions(host.querySelector<HTMLElement>('.cn-step')!);
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
          toast('Key unlocked', 'ok');
          paint();
          host.querySelector<HTMLElement>('[data-primary]')?.focus();
        } catch (err) {
          btn.disabled = false;
          toast((err as Error).message || 'Could not unlock the key', 'err');
          pw.select();
        }
      };
    }
    const tech = host.querySelector<HTMLDetailsElement>('.cn-tech');
    if (tech) tech.ontoggle = () => (techOpen = tech.open);
    const more = host.querySelector<HTMLDetailsElement>('.cn-more');
    if (more) more.ontoggle = () => (moreOpen = more.open);
    host.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach((b) => {
      const c = cur();
      const p = c ? firstPrompts(c.id)[Number(b.dataset.prompt)] : undefined;
      if (c && p) b.onclick = () => void copyText(p.text, `Copied. Now paste it in ${c.label} and send it.`);
    });
    host.querySelectorAll<HTMLButtonElement>('[data-pstyle]').forEach((b) => {
      b.onclick = () => {
        const st = PROMPT_STYLES.find((x) => x.id === (b.dataset.pstyle as PromptStyleId));
        if (!st) return;
        promptStyle = st;
        savePromptStyle(st.id);
        paint();
        host.querySelector<HTMLElement>(`[data-pstyle="${st.id}"]`)?.focus();
      };
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
      stopCount();
    },
  };
}

function clockOf(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
