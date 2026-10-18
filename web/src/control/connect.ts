// Connection guides per MCP client, built from the server's public URL. On an
// agent card the guides are filled in with that agent's key: shown again after
// the owner re-enters the password (keys created or rolled from the dashboard),
// or after a roll for older keys. Without a key, a placeholder is shown.

import { apiPost } from '../api';
import { attr, esc, useStyles } from '../dom';
import { Modal } from '../modal';
import { state } from '../state';
import { toast } from '../toast';
import { codeHTML, copyText, wireCopy } from './ui';

export const KEY_PLACEHOLDER = '<YOUR_MEMORA_KEY>';

export interface ClientSnippet {
  id: string;
  label: string;
  /** Numbered steps; `{code}` marks where the snippet goes. */
  steps: string[];
  code: string;
  /** OAuth sign-in only: no key is pasted anywhere. */
  oauth?: boolean;
}

/** The agent a guide is for (from its card on the Agents page). */
export interface ConnectKey {
  id: string;
  name: string;
  /** The secret is stored sealed and can be shown again. */
  revealable?: boolean;
  /** Connected by an app signing in over OAuth. */
  oauth?: boolean;
}

export interface ConnectOptions {
  secret?: string | null;
  key?: ConnectKey;
  /** The secret changed (roll): the caller may repaint other views. */
  onSecret?: (secret: string) => void;
  /** Client tab to open on (a snippet id). */
  tab?: string;
  /** The caller shows the key itself: no key bar above the steps. */
  hideKey?: boolean;
}

/** One line per client for pickers: how it connects. */
export function clientSummary(s: ClientSnippet): string {
  if (s.oauth) return 'Signs in with your Memora account; no key to paste.';
  if (s.id === 'http') return 'Any MCP client over HTTP, with a test command.';
  return 'Paste a ready-made config that holds the key.';
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
  return [
    {
      id: 'claude-ai',
      label: 'Claude',
      oauth: true,
      steps: [
        'In Claude (web or desktop) open <b>Settings &gt; Connectors</b> and choose <b>Add custom connector</b>.',
        'Fill in the name and URL below.',
        "Authentication: <b>Sign in now</b>. OAuth client: <b>Use Claude's published identity</b> (or <b>Register automatically</b>).",
        'Claude opens Memora: sign in and press <b>Allow</b>. The connection shows up on this page as an agent marked OAuth.',
        '{code}',
        'No OAuth? Pick <b>No sign-in</b> and add the request header <code>Authorization: Bearer &lt;key&gt;</code> instead.',
      ],
      code: `Name:            Memora\nMCP server URL:  ${url}`,
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      oauth: true,
      steps: [
        'In ChatGPT open <b>Settings &gt; Apps &amp; Connectors &gt; Advanced</b> and turn on <b>Developer mode</b>.',
        'Choose <b>Create</b> and fill in the name and URL below. Authentication: <b>OAuth</b>, client ID and secret left empty.',
        '{code}',
        'ChatGPT opens Memora: sign in and press <b>Allow</b>. ChatGPT only signs in with OAuth; it cannot send a key header.',
      ],
      code: `Name:            Memora\nMCP server URL:  ${url}\nAuthentication:  OAuth`,
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      steps: [
        'Run this in a terminal (add <code>--scope user</code> to use it in every project):',
        '{code}',
        'Check it with <code>claude mcp list</code>; Memora should show as connected.',
      ],
      code: `claude mcp add --transport http memora ${url} \\\n  --header "Authorization: Bearer ${key}"`,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      steps: [
        'Open <code>~/.cursor/mcp.json</code> (or <code>.cursor/mcp.json</code> in a project). Create it when missing.',
        'Add the <code>memora</code> entry:',
        '{code}',
        'In <b>Cursor Settings &gt; MCP</b> Memora turns green with its tools listed.',
      ],
      code: json({ mcpServers: { memora: { url, headers: { Authorization: `Bearer ${key}` } } } }),
    },
    {
      id: 'vscode',
      label: 'VS Code / Copilot',
      steps: [
        'Run <b>MCP: Open User Configuration</b> from the Command Palette (or create <code>.vscode/mcp.json</code> in the workspace).',
        'Add the <code>memora</code> server. VS Code uses <code>servers</code>, not <code>mcpServers</code>:',
        '{code}',
        'Press <b>Start</b> above the entry, then use Memora from Copilot Chat in agent mode.',
      ],
      code: json({ servers: { memora: { type: 'http', url, headers: { Authorization: `Bearer ${key}` } } } }),
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      steps: [
        'Add this to <code>~/.codex/config.toml</code>:',
        '{code}',
        'Export the key in the shell that starts Codex, then check with <code>codex mcp list</code>.',
      ],
      code: `[mcp_servers.memora]\nurl = "${url}"\nbearer_token_env_var = "MEMORA_KEY"\n\n# in your shell:\nexport MEMORA_KEY=${key}`,
    },
    {
      id: 'gemini',
      label: 'Gemini CLI',
      steps: [
        'Open <code>~/.gemini/settings.json</code> (or <code>.gemini/settings.json</code> in a project).',
        'Add the <code>memora</code> server (streamable HTTP uses <code>httpUrl</code>):',
        '{code}',
        'Restart Gemini CLI and run <code>/mcp</code> to see Memora and its tools.',
      ],
      code: json({ mcpServers: { memora: { httpUrl: url, headers: { Authorization: `Bearer ${key}` } } } }),
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      steps: [
        'Open <b>Windsurf Settings &gt; Cascade &gt; MCP servers &gt; View raw config</b> (<code>~/.codeium/windsurf/mcp_config.json</code>).',
        'Add the <code>memora</code> entry (Windsurf uses <code>serverUrl</code>):',
        '{code}',
        'Press <b>Refresh</b>; Memora appears in the MCP list.',
      ],
      code: json({ mcpServers: { memora: { serverUrl: url, headers: { Authorization: `Bearer ${key}` } } } }),
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop (file)',
      steps: [
        'Only for older Claude Desktop builds without connectors (else use the <b>Claude</b> tab).',
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
    },
    {
      id: 'http',
      label: 'Any client',
      steps: [
        'Streamable HTTP MCP endpoint with a bearer token. Test it with curl:',
        '{code}',
        'A JSON list of tools means the key works.',
      ],
      code: `curl -s ${url} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    },
  ];
}

const CSS = `
.cn-key{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:12px 13px;margin:0 0 16px;border-radius:12px;min-width:0;
  border:1px solid var(--line);background:var(--surface-2);font-size:12.5px}
.cn-key>b{font-size:12.5px;color:var(--fg);font-weight:650}
.cn-key code{font:500 12.5px/1.3 var(--mono,monospace);color:var(--fg);word-break:break-all;min-width:0;flex:1 1 160px}
.cn-key .grow{flex:1}
.cn-key input{height:40px;box-sizing:border-box;padding:0 11px;border-radius:9px;border:1px solid var(--line-strong);background:var(--surface-0);
  color:var(--fg);font-size:14px;min-width:0;flex:1 1 180px}
.cn-key input:focus{outline:none;border-color:var(--accent-line)}
.cn-key .btn{height:36px}
.cn-key p{margin:0;flex-basis:100%;color:var(--muted);font-size:12px;line-height:1.5}
.cn-key.ok{border-color:color-mix(in srgb,var(--ok) 35%,var(--line))}
.cn-car{position:relative;display:flex;align-items:center;gap:6px;margin:0 0 14px}
/* Clients as a sideways carousel: snap per card, the edges fade where more continues. */
.cn-tabs{display:flex;flex-wrap:nowrap;gap:8px;flex:1;min-width:0;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;
  scrollbar-width:none;padding:2px;overscroll-behavior-x:contain;--fl:0px;--fr:0px;
  -webkit-mask-image:linear-gradient(90deg,transparent 0,#000 var(--fl),#000 calc(100% - var(--fr)),transparent 100%);
  mask-image:linear-gradient(90deg,transparent 0,#000 var(--fl),#000 calc(100% - var(--fr)),transparent 100%)}
.cn-tabs::-webkit-scrollbar{display:none}
.cn-tabs.fl{--fl:36px}.cn-tabs.fr{--fr:36px}
.cn-tabs button{flex:none;scroll-snap-align:start;display:flex;flex-direction:column;align-items:flex-start;gap:8px;width:118px;height:auto !important;
  padding:10px 12px !important;border-radius:12px !important;text-align:left;white-space:nowrap}
.cn-tabs button .cn-ini{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;font-size:11px;font-weight:800;
  background:var(--surface-2);color:var(--muted);border:1px solid var(--line)}
.cn-tabs button[aria-selected=true] .cn-ini{background:var(--accent);color:var(--on-accent,#04211d);border-color:var(--accent)}
.cn-tabs button span:last-child{max-width:100%;overflow:hidden;text-overflow:ellipsis}
.cn-nav{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:var(--panel);
  color:var(--fg);font-size:18px;line-height:1;cursor:pointer;transition:opacity .2s,border-color .15s}
.cn-nav:hover{border-color:var(--accent-line)}
.cn-nav:disabled{opacity:.3;cursor:default}
.cn-tabs button{height:34px;padding:0 12px;border-radius:99px;border:1px solid var(--line);background:var(--panel);font-size:12.5px;font-weight:600;
  color:var(--muted);white-space:nowrap;transition:border-color .16s,color .16s,background .16s}
.cn-tabs button:hover{color:var(--fg);border-color:var(--line-strong)}
.cn-tabs button[aria-selected=true]{color:var(--fg);border-color:var(--accent-line);background:var(--accent-soft)}
.cn-tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cn-panel{min-width:0}
.cn-how{font-size:12.5px;color:var(--muted);margin:0 0 10px}
.cn-steps{margin:0 0 4px;padding:0;list-style:none;counter-reset:step;font-size:13px;line-height:1.55;min-width:0}
.cn-steps li{position:relative;margin:0 0 10px;padding-left:28px;min-width:0}
.cn-steps li:not(.code)::before{counter-increment:step;content:counter(step);position:absolute;left:0;top:1px;width:20px;height:20px;
  border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:750;color:var(--accent);
  background:var(--accent-soft)}
.cn-steps li.code{padding-left:0}
.cn-steps code{font:500 12px var(--mono,monospace);padding:1px 5px;border-radius:5px;background:var(--surface-2);word-break:break-word}
.cn-steps .cc-code-wrap{min-width:0;max-width:100%}
.cn-steps .cc-code{max-width:100%}
.cn-steps .cc-copy{width:36px;height:36px;border:1px solid var(--line)}
@media (max-width:760px){
  .cn-tabs button{height:38px}
  .cn-key .btn{height:40px;flex:1 1 auto}
}
`;

let lastTab = 'claude-ai';

let carScroll = 0;
const mask = (s: string): string => s.slice(0, 12) + '•'.repeat(Math.max(4, s.length - 16)) + s.slice(-4);

/** Tabbed guides, mounted into `host`. */
export function mountConnect(host: HTMLElement, opts: ConnectOptions | string | null = {}): void {
  useStyles('cn-css', CSS);
  const o: ConnectOptions = typeof opts === 'string' || opts === null ? { secret: opts } : opts;
  let secret = o.secret || '';
  let shown = false;
  if (o.tab) lastTab = o.tab;

  const keyBar = (): string => {
    const k = o.key;
    if (secret) {
      return `<div class="cn-key ok"><b>Key</b><code id="cnKeyV">${esc(shown ? secret : mask(secret))}</code><span class="grow"></span>
        <button type="button" class="btn sm" id="cnKeyEye">${shown ? 'Hide' : 'Show'}</button>
        <button type="button" class="btn sm" id="cnKeyCopy">Copy key</button>
        <p>Filled in below. Keep it private: anyone with it can read and write this vault.</p></div>`;
    }
    if (!k) return '';
    if (k.oauth) {
      return `<div class="cn-key"><b>Key</b><p>${esc(k.name)} signed in over OAuth: the app holds its own token, nothing to paste.</p></div>`;
    }
    if (k.revealable) {
      return `<form class="cn-key" id="cnReveal"><b>Key</b><input type="password" id="cnPw" autocomplete="current-password" placeholder="Your Memora password" aria-label="Your Memora password"><button type="submit" class="btn sm primary">Fill in ${esc(
        k.name,
      )}'s key</button>
        <p>Your password unlocks this agent's key so the steps below are ready to paste.</p></form>`;
    }
    return `<div class="cn-key"><b>Key</b><span class="grow"></span><button type="button" class="btn sm" id="cnRoll">Make a new key &amp; fill in</button>
      <p>This key was only shown once, when it was made, so it cannot be filled in. A new key is shown here and kept for next time; the app using the old one must be updated.</p></div>`;
  };

  const paint = (): void => {
    const list = snippets(secret);
    if (!list.some((s) => s.id === lastTab)) lastTab = list[0].id;
    const cur = list.find((s) => s.id === lastTab)!;
    const away =
      publicOrigin() !== location.origin
        ? `<p class="cc-muted" style="font-size:12px;margin:0 0 10px">Agents connect through <code class="cc-mono">${esc(mcpUrl())}</code> (MEMORA_BASE_URL), even though this page is open at ${esc(location.host)}.</p>`
        : '';
    const steps = cur.steps
      .map((st) => (st === '{code}' ? `<li class="code">${codeHTML(cur.code, 'Copy ' + cur.label + ' config')}</li>` : `<li>${st}</li>`))
      .join('');
    host.innerHTML = `${o.hideKey || (cur.oauth && !secret) ? '' : keyBar()}${away}<div class="cn-car"><button type="button" class="cn-nav" data-car="-1" aria-label="Previous apps">‹</button><div class="cn-tabs" role="tablist" aria-label="App to connect">${list
      .map(
        (s) =>
          `<button type="button" role="tab" id="cct-${s.id}" aria-selected="${s.id === lastTab}" aria-controls="ccp-cn" data-tab="${attr(
            s.id,
          )}" tabindex="${s.id === lastTab ? 0 : -1}"><span class="cn-ini" aria-hidden="true">${esc(
            s.label
              .split(/[\s/()-]+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase(),
          )}</span><span>${esc(s.label)}</span></button>`,
      )
      .join('')}</div><button type="button" class="cn-nav" data-car="1" aria-label="More apps">›</button></div>
      <div role="tabpanel" class="cn-panel" id="ccp-cn" aria-labelledby="cct-${cur.id}"><p class="cn-how">${esc(clientSummary(cur))}</p><ol class="cn-steps">${steps}</ol>
        ${
          !secret && !cur.oauth && !o.key
            ? `<p class="cc-muted" style="font-size:12px;margin:6px 0 0">Replace <code class="cc-mono">${esc(KEY_PLACEHOLDER)}</code> with the agent's key, or pick an agent above to fill it in.</p>`
            : ''
        }</div>`;
    wireCopy(host);
    wire();
  };

  const wire = (): void => {
    // The carousel: arrows page through, the edges fade where more continues,
    // and its scroll position survives a redraw.
    const strip = host.querySelector<HTMLElement>('.cn-tabs');
    if (strip) {
      const navs = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-car]'));
      const edges = (): void => {
        const max = strip.scrollWidth - strip.clientWidth - 2;
        carScroll = strip.scrollLeft;
        strip.classList.toggle('fl', strip.scrollLeft > 2);
        strip.classList.toggle('fr', strip.scrollLeft < max);
        navs[0].disabled = strip.scrollLeft <= 2;
        navs[1].disabled = strip.scrollLeft >= max;
      };
      strip.style.scrollBehavior = 'auto';
      strip.scrollLeft = carScroll;
      strip.style.scrollBehavior = '';
      const sel = strip.querySelector<HTMLElement>('[aria-selected=true]');
      if (sel && (sel.offsetLeft < strip.scrollLeft || sel.offsetLeft + sel.offsetWidth > strip.scrollLeft + strip.clientWidth))
        sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      strip.addEventListener('scroll', edges, { passive: true });
      navs.forEach((b) => (b.onclick = () => strip.scrollBy({ left: Number(b.dataset.car) * strip.clientWidth * 0.8 })));
      requestAnimationFrame(edges);
    }
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-tab]'));
    tabs.forEach((b, i) => {
      b.onclick = () => {
        lastTab = b.dataset.tab!;
        paint();
        (host.querySelector(`[data-tab="${lastTab}"]`) as HTMLElement | null)?.focus();
      };
      b.onkeydown = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].click();
      };
    });
    const eye = host.querySelector<HTMLButtonElement>('#cnKeyEye');
    if (eye)
      eye.onclick = () => {
        shown = !shown;
        paint();
      };
    const copy = host.querySelector<HTMLButtonElement>('#cnKeyCopy');
    if (copy) copy.onclick = () => void copyText(secret, 'Key copied');
    const form = host.querySelector<HTMLFormElement>('#cnReveal');
    if (form && o.key) {
      const k = o.key;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const pw = host.querySelector<HTMLInputElement>('#cnPw')!.value;
        if (!pw) return;
        try {
          const r = await apiPost<{ key?: string }>('/api/keys/reveal', { id: k.id, current: pw });
          if (r && r.key) {
            secret = r.key;
            paint();
          }
        } catch (err) {
          toast((err as Error).message || 'Could not show the key', 'err');
        }
      };
    }
    const roll = host.querySelector<HTMLButtonElement>('#cnRoll');
    if (roll && o.key) {
      const k = o.key;
      roll.onclick = () =>
        Modal.confirm(
          'Make a new key',
          `${k.name}'s current key stops working at once. The new one is filled in here; update the app that uses the old one.`,
          'Make a new key',
          async () => {
            try {
              const r = await apiPost<{ key?: string }>('/api/keys/roll', { id: k.id });
              Modal.close();
              if (r && r.key) {
                secret = r.key;
                shown = false;
                o.onSecret?.(secret);
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
  };

  paint();
}
