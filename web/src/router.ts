// View router with real URLs (History API):
//
//   /brain /brain?mode=graph /brain?mode=canvas /nodes /node/<path> /tags /overview
//   /activity /agents /tools /access /settings /docs /docs/<section>
//   /agents/new /agents/new/<client> /agents/<key id> /agents/<key id>/<tab>
//
// `go()` swaps the visible view, updates the navigation (sidebar, tab bar),
// the title and the URL. Back/forward and deep links work; the node path in
// /node/<path> is validated (see `safeNodePath`) and only ever used to select
// a node that exists in the loaded tree. Renderers register themselves, so
// this module imports no view.

import { $, $$ } from './dom';
import { clearPeek } from './peek';
import { allNotes, onNoteChange, state, type Page } from './state';

export type NavGroup = 'content' | 'system';

export interface PageMeta {
  label: string;
  /** Longer title for the top bar. */
  title: string;
  /** One-line description (command palette, tooltips). */
  hint: string;
  icon: string;
  group: NavGroup;
  /** URL path. */
  path: string;
}

/** Every page, in navigation order; Alt+1..9 follow it. */
export const PAGE_META: Record<Page, PageMeta> = {
  home: { label: 'Overview', title: 'Overview', hint: 'Vault summary and recent changes', icon: 'overview', group: 'system', path: '/overview' },
  brain: { label: 'Brain', title: 'Brain', hint: 'Your memory as a living brain', icon: 'brain', group: 'content', path: '/brain' },
  vault: { label: 'Nodes', title: 'Nodes', hint: 'Browse, read and write your nodes', icon: 'note', group: 'content', path: '/nodes' },
  graph: { label: 'Graph', title: 'Graph', hint: 'Map of every link between nodes', icon: 'graph', group: 'content', path: '/brain?mode=graph' },
  canvas: { label: 'Canvas', title: 'Canvas', hint: 'Arrange nodes on an infinite board', icon: 'canvas', group: 'content', path: '/brain?mode=canvas' },
  tags: { label: 'Tags', title: 'Tags', hint: 'Every tag and its nodes', icon: 'tags', group: 'content', path: '/tags' },
  logs: { label: 'Activity', title: 'Activity', hint: 'Live agent and vault activity', icon: 'activity', group: 'system', path: '/activity' },
  keys: { label: 'Agents & API keys', title: 'Agents & API keys', hint: 'Keys your agents connect with', icon: 'key', group: 'system', path: '/agents' },
  tools: { label: 'Tools', title: 'MCP tools', hint: 'Turn MCP tools on or off', icon: 'tools', group: 'system', path: '/tools' },
  access: { label: 'Access rules', title: 'Access rules', hint: 'IP and domain access rules', icon: 'shield', group: 'system', path: '/access' },
  settings: { label: 'Settings', title: 'Settings', hint: 'Account, vault and preferences', icon: 'settings', group: 'system', path: '/settings' },
  docs: { label: 'Documentation', title: 'Documentation', hint: 'Guides, agent instructions and reference', icon: 'book', group: 'system', path: '/docs' },
};

export const PAGES = Object.keys(PAGE_META) as Page[];
export const CONTENT_PAGES = PAGES.filter((p) => PAGE_META[p].group === 'content');

export function isPage(v: unknown): v is Page {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PAGE_META, v);
}

/* ───────────────────────── URLs ───────────────────────── */

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Validate a vault-relative node path taken from a URL. Returns the
 * normalized path, or null when it is unsafe or malformed (absolute paths,
 * drive letters, backslashes, control characters, empty, "." or ".."
 * segments).
 */
export function safeNodePath(raw: string): string | null {
  if (!raw || raw.length > 1024) return null;
  if (raw.startsWith('/') || raw.includes('\\') || CONTROL.test(raw) || /^[a-zA-Z]:/.test(raw)) return null;
  const parts = raw.split('/');
  for (const p of parts) {
    if (!p || p === '.' || p === '..' || CONTROL.test(p)) return null;
  }
  return parts.join('/');
}

/** URL for a node: every segment percent-encoded. */
export function nodeUrl(path: string): string {
  return '/node/' + path.split('/').map(encodeURIComponent).join('/');
}

export interface Route {
  page: Page;
  /** Validated node path (not yet checked against the tree). */
  node?: string;
  /** The URL named a node, but it was malformed or unsafe. */
  badNode?: boolean;
  /** The URL matched no route. */
  unknown?: boolean;
}

const BY_PATH = new Map<string, Page>(PAGES.map((p) => [PAGE_META[p].path, p]));
// Aliases kept for old links and muscle memory.
BY_PATH.set('/vault', 'vault');
BY_PATH.set('/home', 'home');
// The welcome page opens over the Overview (views/welcome.ts).
BY_PATH.set('/welcome', 'home');
BY_PATH.set('/logs', 'logs');
BY_PATH.set('/keys', 'keys');
// Graph and canvas are modes of the brain (/brain?mode=graph); old paths still work.
BY_PATH.set('/graph', 'graph');
BY_PATH.set('/canvas', 'canvas');

/** The sidebar entry a page lights up: brain modes count as Brain. */
export function navPageOf(page: Page): Page {
  return page === 'graph' || page === 'canvas' ? 'brain' : page;
}

/** The brain's mode from `?mode=` (graph, canvas; anything else is the 3D brain). */
function brainMode(loc: Location): Page {
  const m = new URLSearchParams(loc.search).get('mode');
  return m === 'graph' || m === 'canvas' ? m : 'brain';
}

/** The key id of an /activity/<id> address, for the Activity page to open (it clears it). */
export let routeAgent: string | null = null;

export function takeRouteAgent(): string | null {
  const id = routeAgent;
  routeAgent = null;
  return id;
}

/** The tabs of an agent's own page, at /agents/<id>/<tab> (overview has no segment). */
export const AGENT_TABS = ['overview', 'setup', 'activity', 'access', 'settings'] as const;

/**
 * The address inside the Agents page to show next (/agents/new, /agents/<id>/setup...):
 * set by a parsed URL or by `setKeysRoute`, used once by the next URL sync.
 */
let routeKeys: string | null = null;

/** Make the next navigation to the Agents page land on this address (an /agents/... path). */
export function setKeysRoute(path: string | null): void {
  routeKeys = path;
}

// /agents/new, /agents/new/<client>, /agents/<id>, /agents/<id>/<tab>
const KEYS_SUB = new RegExp(`^/(?:new(?:/[a-z0-9-]{1,40})?|[A-Za-z0-9_-]{1,64}(?:/(?:${AGENT_TABS.join('|')}))?)$`);
const CONNECT_HASH = /^#connect(?:=([\w-]{1,40}))?$/;

/** Parse the current location (also accepts the legacy #/page and #graph hashes). */
export function parseLocation(loc: Location = location): Route {
  const path = loc.pathname.replace(/\/+$/, '') || '/';
  // On /docs the hash names a heading, never a page.
  const isDocs = path === '/docs' || path.startsWith('/docs/');
  const legacy = loc.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  if (legacy && isPage(legacy) && !isDocs) return { page: legacy };
  if (isDocs) return { page: 'docs' };
  if (path === '/' || path === '/index.html' || path === '/brain') return { page: brainMode(loc) };
  if (path.startsWith('/node/')) {
    const segs = path.slice(6).split('/');
    const decoded: string[] = [];
    for (const s of segs) {
      try {
        decoded.push(decodeURIComponent(s));
      } catch {
        return { page: 'vault', badNode: true };
      }
    }
    // A decoded segment must not smuggle in a separator.
    if (decoded.some((d) => d.includes('/'))) return { page: 'vault', badNode: true };
    const node = safeNodePath(decoded.join('/'));
    return node ? { page: 'vault', node } : { page: 'vault', badNode: true };
  }
  // /activity/<key id>: one agent's activity.
  const ag = /^\/activity\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (ag) {
    routeAgent = ag[1];
    return { page: 'logs' };
  }
  // The Agents page and the addresses inside it; /keys is the old name.
  const ks = /^\/(?:agents|keys)(\/.*)?$/.exec(path);
  if (ks) {
    const sub = ks[1] || '';
    const hash = sub ? null : CONNECT_HASH.exec(loc.hash);
    // `/agents#connect` and `#connect=<client>` (older links) open the new-agent page.
    if (hash) routeKeys = '/agents/new' + (hash[1] ? '/' + hash[1].toLowerCase() : '');
    else if (sub && KEYS_SUB.test(sub)) routeKeys = '/agents' + sub;
    else if (sub) return { page: 'brain', unknown: true };
    else routeKeys = null;
    return { page: 'keys' };
  }
  const page = BY_PATH.get(path);
  return page ? { page } : { page: 'brain', unknown: true };
}

/** The node in the loaded tree for a URL path (exact, or without ".md"). */
export function findNode(path: string): string | null {
  const notes = allNotes();
  const hit =
    notes.find((n) => n.path === path) ||
    notes.find((n) => n.path === path + '.md') ||
    notes.find((n) => n.path.replace(/\.md$/i, '') === path);
  return hit ? hit.path : null;
}

/** A URL that leads nowhere: what was asked for, as the not-found page names it. */
export interface RouteMissing {
  what: 'page' | 'node';
  /** The node path (or the raw address when it was malformed) or page address. */
  label: string;
}

/** What a parsed URL shows: a page, an existing node, or the not-found page. */
export type RouteTarget = { kind: 'page'; page: Page } | { kind: 'node'; path: string } | { kind: 'missing'; missing: RouteMissing };

/**
 * Decide what a parsed route shows. Pure: `pathname` is the address as typed
 * (shown for unknown and malformed addresses) and `find` maps a URL node path
 * to a node of the loaded tree (`findNode`). Unknown addresses and node paths
 * that are malformed or name no node lead to the not-found page, never to
 * another page.
 */
export function resolveRoute(r: Route, pathname: string, find: (path: string) => string | null): RouteTarget {
  if (r.unknown) return { kind: 'missing', missing: { what: 'page', label: pathname } };
  if (r.page === 'vault' && (r.badNode || r.node)) {
    const path = r.node ? find(r.node) : null;
    if (path) return { kind: 'node', path };
    let label = r.node || pathname.replace(/^\/node\/?/, '');
    if (!r.node) {
      try {
        label = decodeURIComponent(label);
      } catch {
        /* keep it as typed */
      }
    }
    return { kind: 'missing', missing: { what: 'node', label: label || pathname } };
  }
  return { kind: 'page', page: r.page };
}

/** Where the next navigation to the docs lands (set by `openDocs`). */
let docsTarget: string | null = null;

function urlFor(page: Page): string {
  if (page === 'docs') {
    const t = docsTarget;
    docsTarget = null;
    if (t) return t;
    // Already on a docs address (deep link, back/forward): keep it as it is.
    const p = location.pathname;
    return p === '/docs' || p.startsWith('/docs/') ? p + location.hash : '/docs';
  }
  // An /activity/<id> address being opened keeps its agent (the page reads it).
  if (page === 'logs' && routeAgent) return '/activity/' + routeAgent;
  if (page === 'keys' && routeKeys) {
    const to = routeKeys;
    routeKeys = null;
    return to;
  }
  return page === 'vault' && state.note ? nodeUrl(state.note) : PAGE_META[page].path;
}

let replaceNext = false;

/** Make the next URL update replace the history entry instead of pushing. */
export function replaceHistory(): void {
  replaceNext = true;
}

/** Bring the URL in line with the visible page / open node. */
export function syncUrl(): void {
  const url = urlFor(state.page);
  const replace = replaceNext;
  replaceNext = false;
  if (location.pathname + location.search + location.hash === url) return;
  try {
    if (replace) history.replaceState({ page: state.page }, '', url);
    else history.pushState({ page: state.page }, '', url);
  } catch {
    /* sandboxed frames can refuse history writes */
  }
}

/* ───────────────────────── navigation ───────────────────────── */

/** The page renderers, filled in by main.ts at boot. */
export const renderers: Partial<Record<Page, () => void | Promise<void>>> = {};

/** Called after every navigation (the shell repaints its nav state). */
const listeners: ((page: Page) => void)[] = [];
export function onNavigate(fn: (page: Page) => void): void {
  listeners.push(fn);
}

export function registerView(page: Page, render: () => void | Promise<void>): void {
  renderers[page] = render;
}

function leaf(path: string): string {
  return (path.split('/').pop() || path).replace(/\.md$/i, '');
}

/** Top bar title for the current page. */
export function paintTitle(): void {
  const page = state.page;
  const crumb = $('.crumb');
  const title = page === 'vault' && state.note ? leaf(state.note) : PAGE_META[page].title;
  crumb.textContent = title;
  crumb.title = page === 'vault' && state.note ? state.note : '';
  document.title = title + ' · Memora';
}

/**
 * Show a page. `keepEditing` is used by openNote, which navigates to the vault
 * without discarding the note the user is reading.
 */
export function go(page: Page, keepEditing = false): void {
  if (!isPage(page)) page = 'brain';
  if (!keepEditing) state.editing = false;
  const prev = state.page;
  state.page = page;
  $$('[data-page].nav-item,[data-page].tab-item,[data-page].pm-item').forEach((b) => {
    const on = b.dataset.page === navPageOf(page);
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  for (const key of PAGES) {
    $('#view-' + key).classList.toggle('hidden', key !== page);
  }
  paintTitle();
  $('#app').classList.remove('side-open');
  if (page !== 'graph' && state.graph.stop) {
    state.graph.stop();
    state.graph.stop = null;
  }
  clearPeek();
  syncUrl();
  for (const fn of listeners) {
    try {
      fn(page);
    } catch (e) {
      console.error('navigate listener failed', e);
    }
  }
  if (prev !== page) $('#views').scrollTop = 0;
  void renderers[page]?.();
}

/** Open the documentation, optionally at a section (`/docs/<slug>`) and heading. */
export function openDocs(slug = '', hash = ''): void {
  docsTarget = '/docs' + (slug ? '/' + encodeURIComponent(slug) : '') + (hash ? '#' + encodeURIComponent(hash) : '');
  go('docs');
}

/** Redraw whichever view is visible. */
export function refreshPage(): void {
  void renderers[state.page]?.();
}

// Opening or closing a node while on the Nodes page updates the URL.
onNoteChange(() => {
  if (state.page !== 'vault') return;
  syncUrl();
  paintTitle();
});
