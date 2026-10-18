// The documentation sections: the repository's Markdown docs (bundled as raw
// text at build time, so the page always matches the docs that shipped) plus
// a few hand-written guides that only make sense inside the app.

import readme from '../../../README.md?raw';
import installMd from '../../../docs/INSTALL.md?raw';
import configMd from '../../../docs/CONFIGURATION.md?raw';
import mcpMd from '../../../docs/MCP.md?raw';
import apiMd from '../../../docs/API.md?raw';
import deployMd from '../../../docs/DEPLOYMENT.md?raw';
import archMd from '../../../docs/ARCHITECTURE.md?raw';
import dbMd from '../../../docs/DATABASE.md?raw';
import permsMd from '../../../docs/contracts/tools-permissions.md?raw';
import securityMd from '../../../SECURITY.md?raw';
import changelogMd from '../../../CHANGELOG.md?raw';
import { fetchTools } from '../api';
import { esc } from '../dom';
import { PAGE_META, PAGES } from '../router';
import { categoryDesc, categoryLabel, groupTools, riskChip, toolRisk, toolTitle } from '../views/tools';
import { AGENT_PROMPT, AGENT_PROMPT_SHORT } from './agent-prompt';
import { calloutHTML, codeBlockHTML, headingHTML, inline, mdPart, renderMarkdown, uniqueSlug, type LinkTarget, type MdOptions } from './markdown';

export const REPO_URL = 'https://github.com/Codrihub/memora';
const BLOB = REPO_URL + '/blob/main/';

/** Builds one page; `slugs` keeps heading anchors unique across its parts. */
export interface PageCtx {
  slugs: Map<string, number>;
  h2(text: string): string;
  h3(text: string): string;
  /** Render Markdown from `file` (links resolve relative to it). */
  md(src: string, file: string, shift?: number): string;
}

export interface DocSection {
  slug: string;
  title: string;
  group: string;
  /** One line under the title. */
  lead: string;
  /** Repository file the page renders, for the "View on GitHub" link. */
  source?: string;
  render(ctx: PageCtx): string;
  /** Fill in live parts after the page is in the DOM; resolves when done. */
  mount?(root: HTMLElement, ctx: PageCtx): Promise<void>;
}

/* ───────────────────────── links ───────────────────────── */

const FILE_SLUG: Record<string, string> = {
  'README.md': 'get-started',
  'docs/INSTALL.md': 'install',
  'docs/CONFIGURATION.md': 'configuration',
  'docs/MCP.md': 'mcp',
  'docs/API.md': 'api',
  'docs/DEPLOYMENT.md': 'deployment',
  'docs/ARCHITECTURE.md': 'architecture',
  'docs/DATABASE.md': 'database',
  'docs/contracts/tools-permissions.md': 'tool-reference',
  'SECURITY.md': 'security',
  'CHANGELOG.md': 'changelog',
};

/** `base` directory joined with a relative path; null when it leaves the repository. */
function joinPath(file: string, rel: string): string | null {
  const parts = file.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** How a link in `file` resolves: another docs page, GitHub, or nothing. */
export function linkResolver(file: string, selfSlug: string): (href: string) => LinkTarget {
  return (href) => {
    if (!href) return null;
    if (href.startsWith('#')) return { kind: 'doc', slug: selfSlug, hash: decodeHash(href.slice(1)) };
    if (/^(https?:\/\/|mailto:)/i.test(href)) return { kind: 'external', href };
    // Any other scheme (javascript:, data: ...) is not a link.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
    const [path, hash = ''] = href.split('#');
    const full = joinPath(file, path);
    if (full === null) return null;
    const slug = FILE_SLUG[full];
    if (slug) return { kind: 'doc', slug, hash: decodeHash(hash) };
    return full ? { kind: 'external', href: BLOB + full.split('/').map(encodeURIComponent).join('/') } : null;
  };
}

function decodeHash(h: string): string {
  try {
    return decodeURIComponent(h);
  } catch {
    return h;
  }
}

/** Fresh page context for `slug`. */
export function pageCtx(slug: string): PageCtx {
  const slugs = new Map<string, number>();
  const md = (src: string, file: string, shift = 0): string => {
    const o: MdOptions = { link: linkResolver(file, slug), slugs, dropH1: true };
    const html = renderMarkdown(src, o);
    if (!shift) return html;
    return html.replace(/<(\/?)h([1-6])\b/g, (_, close: string, n: string) => `<${close}h${Math.min(6, Number(n) + shift)}`);
  };
  const h = (level: number) => (text: string) => headingHTML(level, uniqueSlug(text, slugs), esc(text));
  return { slugs, h2: h(2), h3: h(3), md };
}

/* ───────────────────────── small builders ───────────────────────── */

const p = (html: string): string => `<p>${html}</p>`;
const code = (s: string): string => `<code>${esc(s)}</code>`;
const docLink = (slug: string, text: string, hash = ''): string =>
  `<a href="/docs/${slug}${hash ? '#' + hash : ''}" data-doc="${slug}" data-hash="${esc(hash)}">${esc(text)}</a>`;
/** Opens the connect wizard on the Agents page. */
const connectLink = (text: string): string => `<a href="/agents#connect">${esc(text)}</a>`;
const appLink = (page: string, text: string): string => `<a href="${esc(PAGE_META[page as keyof typeof PAGE_META].path)}" data-app="${esc(page)}">${esc(text)}</a>`;

function steps(items: [string, string][]): string {
  return `<ol class="dc-steps">${items.map(([t, body]) => `<li><b>${esc(t)}</b><div>${body}</div></li>`).join('')}</ol>`;
}

function cards(items: [string, string, string][]): string {
  return `<div class="dc-cards">${items
    .map(([slug, t, d]) => `<a class="dc-card" href="/docs/${slug}" data-doc="${slug}" data-hash=""><b>${esc(t)}</b><span>${esc(d)}</span></a>`)
    .join('')}</div>`;
}

function table(head: string[], rows: string[][]): string {
  return `<div class="dc-table"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

/** A prompt block: wraps long lines instead of scrolling. */
const prompt = (text: string, label: string): string => `<div class="dc-prompt">${codeBlockHTML(text, '', label)}</div>`;

const isMac = (): boolean => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
const keys = (...k: string[]): string => `<span class="dc-keys">${k.map((x) => `<kbd>${esc(x)}</kbd>`).join('')}</span>`;

function mcpUrlHere(): string {
  return location.origin + '/mcp';
}

/* ───────────────────────── hand-written pages ───────────────────────── */

function getStarted(c: PageCtx): string {
  return (
    c.h2('What Memora is') +
    p(
      'Memora is long-term memory for your AI agents, on your own server. Every memory is a plain Markdown note in a folder you own (the <b>vault</b>), with <code>[[wikilinks]]</code>, <code>#tags</code> and full git history.',
    ) +
    `<ul>
      <li><b>Agents</b> read and write the vault over the Model Context Protocol (MCP), each with its own API key or an OAuth approval.</li>
      <li><b>You</b> browse, edit and govern it here: the brain and graph views, the node editor, live activity, keys, tool switches and access rules.</li>
      <li><b>One process</b> serves the web UI, the HTTP API, MCP and realtime updates on a single port, with server state in one SQLite file.</li>
    </ul>` +
    c.h2('First run') +
    p('Four steps take a fresh server to an agent that remembers.') +
    steps([
      [
        'Install Memora',
        p('Use the native installer on Linux with systemd, or Docker Compose. Both are covered in ' + docLink('install', 'Install') + '.') +
          codeBlockHTML('curl -fsSL https://raw.githubusercontent.com/Codrihub/memora/main/scripts/install.sh | sudo sh', 'bash'),
      ],
      [
        'Open the console and type /web',
        p(
          `Run ${code('sudo memora-cli')} on the server (in Docker: ${code('docker compose exec -it gateway memora-cli')}) and type ${code(
            '/web',
          )}. It prints a one-time setup code. Open ${code('http://<host>:8400/login')}, enter the code and create the owner account.`,
        ),
      ],
      [
        'Choose the vault',
        p(
          `Pick the folder that holds your notes (${code('/var/lib/memora/vault')} natively, ${code(
            '/data',
          )} in Docker). An existing folder of Markdown works as is. You can switch it later in ${appLink('settings', 'Settings')}.`,
        ),
      ],
      [
        'Connect an agent',
        p(
          `Open the ${connectLink('connect wizard')} (Agents & API keys → Connect), pick the app and copy its config. Then paste the ${docLink(
            'agent-instructions',
            'agent instructions',
          )} so the agent knows when to recall and when to remember.`,
        ),
      ],
    ]) +
    calloutHTML(
      'note',
      'Setup window',
      p(`If a setup window expires unused, the instance locks until you run ${code('memora-cli setup')} or ${code('memora-cli unlock')} on the server.`),
    ) +
    c.h2('Where to next') +
    cards([
      ['agent-instructions', 'Agent instructions', 'The recommended prompt and where to paste it.'],
      ['connect', 'Connect an agent', 'MCP URL, keys and client configs.'],
      ['tool-reference', 'Tool reference', 'Every MCP tool this server offers.'],
      ['configuration', 'Configuration', 'Every setting and where it lives.'],
      ['deployment', 'Deployment', 'TLS, reverse proxies and hardening.'],
      ['security', 'Security & privacy', 'The security model and how to report issues.'],
    ]) +
    c.md(mdPart(readme, 'Features'), 'README.md') +
    c.md(mdPart(readme, 'Project layout'), 'README.md') +
    c.md(mdPart(readme, 'Versioning'), 'README.md')
  );
}

function agentInstructions(c: PageCtx): string {
  const where: [string, string, string][] = [
    [
      'Claude (claude.ai and Claude Desktop)',
      'In a project: <b>Project instructions</b>. For every chat: Settings → Profile → personal preferences.',
      'Full in a project, short in preferences',
    ],
    [
      'ChatGPT',
      'In a project: the project <b>Instructions</b>. For every chat: Settings → Personalization → <b>Custom instructions</b>.',
      'Full in a project, short in custom instructions',
    ],
    ['Claude Code', `${code('CLAUDE.md')} in the project root, or ${code('~/.claude/CLAUDE.md')} for every project.`, 'Full'],
    [
      'Cursor',
      `A project rule in ${code('.cursor/rules/')} (for example ${code('.cursor/rules/memora.mdc')}), or Cursor Settings → Rules → <b>User Rules</b> for every project.`,
      'Full',
    ],
    ['VS Code (GitHub Copilot)', `${code('.github/copilot-instructions.md')} in the repository.`, 'Full'],
    ['Codex CLI', `${code('AGENTS.md')} in the repository, or ${code('~/.codex/AGENTS.md')} for every project.`, 'Full'],
    ['Gemini CLI', `${code('GEMINI.md')} in the project root, or ${code('~/.gemini/GEMINI.md')} for every project.`, 'Full'],
    ['Windsurf', `Customizations → <b>Rules</b>: a global rule, or a workspace rule in ${code('.windsurf/rules/')}.`, 'Full'],
  ];
  return (
    p(
      'Connecting an agent gives it the tools; these instructions tell it when to use them. Paste them once per client and the agent searches Memora before it answers and saves what is worth keeping.',
    ) +
    calloutHTML(
      'note',
      'Connect first',
      p(`The prompt assumes the MCP server is named ${code('memora')} and connected. See ${docLink('connect', 'Connect an agent')}.`),
    ) +
    c.h2('Full instructions') +
    p('For a system prompt, project instructions or a rules file.') +
    prompt(AGENT_PROMPT, 'Full prompt') +
    c.h2('Short version') +
    p('One paragraph for clients with a small instructions field.') +
    prompt(AGENT_PROMPT_SHORT, 'Short prompt') +
    c.h2('Where to paste it') +
    table(
      ['Client', 'Where', 'Version'],
      where.map(([a, b, v]) => [`<b>${esc(a)}</b>`, b, esc(v)]),
    ) +
    c.h3('Cursor rule file') +
    p(`A rule in ${code('.cursor/rules/')} applies to every chat when its header sets ${code('alwaysApply: true')}:`) +
    codeBlockHTML('---\ndescription: Use Memora as long-term memory\nalwaysApply: true\n---\n\n' + AGENT_PROMPT, 'markdown', '.cursor/rules/memora.mdc') +
    c.h2('Tips') +
    `<ul>
      <li>In a file such as ${code('CLAUDE.md')} or ${code('AGENTS.md')} that already has content, add the text under its own heading, for example ${code('## Memory')}.</li>
      <li>The prompt names tools such as ${code('search_memory')}, ${code('read_memory')} and ${code('patch_memory')}. If you switch tools off on ${appLink(
        'tools',
        'Tools',
      )} or narrow a key, adjust the text to match.</li>
      <li>Every agent that shares the vault should get the same instructions, so they write notes the same way.</li>
    </ul>`
  );
}

function connect(c: PageCtx): string {
  const url = mcpUrlHere();
  return (
    p('Agents reach Memora over MCP at one URL. Each agent gets its own API key, or connects with OAuth after you approve it in the browser.') +
    c.h2('This server') +
    codeBlockHTML(url, '', 'MCP URL') +
    p(
      `Behind a reverse proxy, use the public URL (the one set in ${code('MEMORA_BASE_URL')}). Requests for any other host than ${code(
        'MEMORA_DOMAIN',
      )} get 404.`,
    ) +
    c.h2('Steps') +
    steps([
      ['Open Agents & API keys', p(`Open the ${connectLink('connect wizard')} on Agents & API keys.`)],
      ['Pick the app', p('Claude, ChatGPT, Claude Code, Cursor, VS Code, Codex and others each get ready-made steps.')],
      ['Create the key and copy the config', p('The raw key is shown once. Give each agent its own key so you can see, limit and revoke it on its own.')],
      ['Add the instructions', p(`Paste the ${docLink('agent-instructions', 'agent instructions')} into the client.`)],
    ]) +
    `<p><a class="btn primary dc-btn" href="${esc(PAGE_META.keys.path)}" data-app="keys">Open Agents &amp; API keys</a></p>` +
    c.h2('Quick configs') +
    c.h3('Claude Code') +
    codeBlockHTML(`claude mcp add --transport http memora ${url} \\\n  --header "Authorization: Bearer memora_live_REPLACE_WITH_YOUR_KEY"`, 'bash') +
    c.h3('Clients with an mcpServers config') +
    p(`Cursor, Windsurf and others. VS Code uses the key ${code('servers')} in ${code('.vscode/mcp.json')}.`) +
    codeBlockHTML(
      JSON.stringify(
        { mcpServers: { memora: { type: 'http', url, headers: { Authorization: 'Bearer memora_live_REPLACE_WITH_YOUR_KEY' } } } },
        null,
        2,
      ),
      'json',
    ) +
    c.h3('OAuth') +
    p(
      `Clients that support MCP authorization (Claude and ChatGPT custom connectors, or Claude Code without ${code(
        '--header',
      )}) need only the URL. You approve them in the browser and they show up as keys you can restrict or revoke.`,
    ) +
    calloutHTML(
      'tip',
      'More clients',
      p(`Codex, stdio-only clients and testing from a shell are covered in ${docLink('mcp', 'MCP', 'connecting-an-agent')}.`),
    ) +
    c.h2('Limit what an agent can do') +
    `<ul>
      <li><b>Scopes</b> on the key: ${code('read')}, ${code('write')}, ${code('admin')}.</li>
      <li><b>Tool lists</b> per key, and server-wide switches on ${appLink('tools', 'Tools')}.</li>
      <li><b>Privacy rules</b> that hide notes or folders from chosen agents.</li>
      <li><b>Access rules</b> by IP, range and domain on ${appLink('access', 'Access rules')}.</li>
    </ul>` +
    p(`Details: ${docLink('tool-reference', 'Tool reference', 'switches-and-permissions')}.`)
  );
}

function shortcuts(c: PageCtx): string {
  const mod = isMac() ? '⌘' : 'Ctrl';
  const alt = isMac() ? '⌥' : 'Alt';
  const rows = (list: [string, string][]): string => table(['Keys', 'Action'], list.map(([k, a]) => [k, esc(a)]));
  const pages = PAGES.slice(0, 9).map((pg, i) => [keys(alt, String(i + 1)), PAGE_META[pg].label] as [string, string]);
  return (
    p('Shortcuts work anywhere outside a text field unless noted. On a Mac, Ctrl is ⌘ and Alt is ⌥.') +
    c.h2('Everywhere') +
    rows([
      [keys(mod, 'K'), 'Search nodes, jump to pages, run actions'],
      [keys('/'), 'Open search'],
      [keys('?'), 'Help & shortcuts'],
      [keys('['), 'Collapse or expand the sidebar'],
      [keys('Esc'), 'Close a dialog, menu or panel'],
    ]) +
    c.h2('Pages') +
    rows(pages) +
    c.h2('Search') +
    rows([
      [keys('>'), 'Typed first: actions only (new node, theme ...)'],
      [code('tag:name'), 'Narrow results by tag'],
      [keys('↑') + keys('↓'), 'Move through results'],
      [keys('Enter'), 'Open the result'],
    ]) +
    c.h2('Nodes') +
    rows([
      [keys('N'), 'New node in the open folder'],
      [keys('E'), 'Edit the open node'],
      [keys(mod, 'E'), 'Switch between reading and editing'],
      [keys('P'), 'Pin or unpin the node'],
      [keys('M'), 'Move the node'],
      [keys('F2'), 'Rename the node'],
      [keys('Delete'), 'Delete the node'],
    ]) +
    c.h2('Editor') +
    rows([
      [keys(mod, 'S'), 'Save now'],
      [keys(mod, 'B'), 'Bold'],
      [keys(mod, 'I'), 'Italic'],
      [keys(mod, 'K'), 'Link'],
      [keys(mod, '`'), 'Inline code'],
      [keys(mod, alt, 'H'), 'Heading'],
      [keys(mod, 'Shift', '8'), 'Bullet list'],
      [keys(mod, 'Shift', '9'), 'Task list'],
      [keys('Tab') + keys('Shift', 'Tab'), 'Indent or outdent'],
      [keys('Esc'), 'Back to reading'],
    ]) +
    c.h2('Graph') +
    rows([
      [keys('/'), 'Find a node'],
      [keys('F'), 'Fit everything in view'],
      [keys('1') + keys('2') + keys('3'), 'Force, radial or cluster layout'],
      [keys('P'), 'Pin the selected node'],
      [keys('Esc'), 'Close the card and panels'],
    ])
  );
}

/* ───────────────────────── tool reference ───────────────────────── */

function toolReference(c: PageCtx): string {
  return (
    p(
      `Every MCP tool this server offers, read live from the server, grouped as on ${appLink(
        'tools',
        'Tools',
      )}. Agents call a tool by the name in code. Tools that are switched off are hidden from agents.`,
    ) +
    `<div class="dc-legend">${riskChip('read')}${riskChip('write')}${riskChip('admin')}</div>` +
    `<div id="dcTools" class="dc-tools" aria-busy="true"><p class="dc-muted">Loading the tool catalog…</p></div>` +
    c.h2('Switches and permissions') +
    c.md(permsMd, 'docs/contracts/tools-permissions.md', 1)
  );
}

async function mountTools(root: HTMLElement, c: PageCtx): Promise<void> {
  const host = root.querySelector<HTMLElement>('#dcTools');
  if (!host) return;
  let html = '';
  try {
    const tools = await fetchTools();
    const off = tools.filter((t) => !t.enabled).length;
    html =
      p(`${tools.length} tools${off ? `, ${off} switched off on this server` : ''}.`) +
      groupTools(tools)
        .map(
          ([cat, list]) =>
            c.h2(categoryLabel(cat)) +
            (categoryDesc(cat) ? p(esc(categoryDesc(cat))) : '') +
            `<div class="dc-toolrows">${list
              .map(
                (t) => `<div class="dc-tool${t.enabled ? '' : ' off'}" id="tool-${esc(t.name)}">
                  <div class="dc-tool-h"><code>${esc(t.name)}</code><span class="dc-tool-t">${esc(toolTitle(t.name))}</span>${riskChip(toolRisk(t))}${
                    t.enabled ? '' : '<span class="badge">Off</span>'
                  }</div>
                  ${t.description ? `<div class="dc-tool-d">${inline(t.description, { link: () => null, slugs: c.slugs })}</div>` : ''}
                </div>`,
              )
              .join('')}</div>`,
        )
        .join('');
  } catch {
    html = calloutHTML(
      'warning',
      'Could not load the tools',
      p(`The server did not answer. The public catalog is at <a href="/tools" target="_blank" rel="noopener">/tools</a>.`),
    );
  }
  if (!host.isConnected) return;
  host.innerHTML = html;
  host.removeAttribute('aria-busy');
}

/* ───────────────────────── registry ───────────────────────── */

const part = (src: string, ...names: string[]): string => names.map((n) => mdPart(src, n)).join('\n\n');

export const SECTIONS: DocSection[] = [
  { slug: 'get-started', title: 'Get started', group: 'Getting started', lead: 'What Memora is and how to go from install to an agent that remembers.', source: 'README.md', render: getStarted },
  { slug: 'agent-instructions', title: 'Agent instructions', group: 'Getting started', lead: 'The recommended prompt for agents that use Memora as their memory.', render: agentInstructions },
  { slug: 'connect', title: 'Connect an agent', group: 'Getting started', lead: 'The MCP URL, API keys and ready-made client configs.', render: connect },
  { slug: 'install', title: 'Install', group: 'Guides', lead: 'Native installer, Docker, reverse proxy, backups and upgrades.', source: 'docs/INSTALL.md', render: (c) => c.md(installMd, 'docs/INSTALL.md') },
  { slug: 'configuration', title: 'Configuration', group: 'Guides', lead: 'Every setting and where it lives.', source: 'docs/CONFIGURATION.md', render: (c) => c.md(configMd, 'docs/CONFIGURATION.md') },
  { slug: 'mcp', title: 'MCP', group: 'Guides', lead: 'Transport, connecting clients, OAuth, results and errors.', source: 'docs/MCP.md', render: (c) => c.md(mcpMd, 'docs/MCP.md') },
  { slug: 'tool-reference', title: 'Tool reference', group: 'Reference', lead: 'The MCP tool catalog, switches and per-key permissions.', source: 'docs/contracts/tools-permissions.md', render: toolReference, mount: mountTools },
  { slug: 'api', title: 'API', group: 'Reference', lead: 'The HTTP API: auth, endpoints and payloads.', source: 'docs/API.md', render: (c) => c.md(apiMd, 'docs/API.md') },
  {
    slug: 'security',
    title: 'Security & privacy',
    group: 'Reference',
    lead: 'The security model, deployment guidance and how to report a vulnerability.',
    source: 'SECURITY.md',
    render: (c) => c.md(part(readme, 'Security notes'), 'README.md') + c.md(securityMd, 'SECURITY.md'),
  },
  { slug: 'deployment', title: 'Deployment', group: 'Operations', lead: 'Production deployment, TLS, reverse proxies and hardening.', source: 'docs/DEPLOYMENT.md', render: (c) => c.md(deployMd, 'docs/DEPLOYMENT.md') },
  { slug: 'architecture', title: 'Architecture', group: 'Operations', lead: 'Crates, request flow and the files in a vault.', source: 'docs/ARCHITECTURE.md', render: (c) => c.md(archMd, 'docs/ARCHITECTURE.md') },
  { slug: 'database', title: 'Database', group: 'Operations', lead: 'The state database: schema, migrations, backup and restore.', source: 'docs/DATABASE.md', render: (c) => c.md(dbMd, 'docs/DATABASE.md') },
  { slug: 'changelog', title: 'Changelog', group: 'More', lead: 'What changed in each release.', source: 'CHANGELOG.md', render: (c) => c.md(changelogMd, 'CHANGELOG.md') },
  { slug: 'shortcuts', title: 'Keyboard shortcuts', group: 'More', lead: 'Every shortcut in the web UI.', render: shortcuts },
];

export const SOURCE_URL = (file: string): string => BLOB + file;

export function findSection(slug: string): DocSection | undefined {
  return SECTIONS.find((s) => s.slug === slug);
}
