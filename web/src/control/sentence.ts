// Activity in plain words ("Claude Code edited *Launch plan*"), bursts and Undo plans. Pure, no DOM.

import { attr, esc } from '../dom';
import { noteName } from '../format';
import type { ActivityItem } from './feed';

export type Kind =
  | 'created'
  | 'edited'
  | 'read'
  | 'searched'
  | 'moved'
  | 'trashed'
  | 'deleted'
  | 'restored'
  | 'pinned'
  | 'system'
  | 'other';

const KIND_OF: Record<string, Kind> = {
  create_memory: 'created',
  batch_create: 'created',
  duplicate_memory: 'created',
  template_create: 'created',
  import_memory: 'created',
  create_folder: 'created',
  node_created: 'created',
  save_memory: 'edited',
  patch_memory: 'edited',
  add_tags: 'edited',
  remove_tags: 'edited',
  set_tags: 'edited',
  bulk_replace: 'edited',
  merge_memory: 'edited',
  rename_tag: 'edited',
  merge_tag: 'edited',
  set_folder_meta: 'edited',
  restore_memory: 'edited',
  mention_agent: 'edited',
  node_updated: 'edited',
  move_memory: 'moved',
  rename_memory: 'moved',
  move_folder: 'moved',
  move_folder_contents: 'moved',
  rename_folder: 'moved',
  node_renamed: 'moved',
  soft_delete: 'trashed',
  bulk_delete: 'trashed',
  delete_folder: 'trashed',
  delete_memory: 'deleted',
  node_deleted: 'deleted',
  restore_trash: 'restored',
  pin: 'pinned',
  unpin: 'pinned',
  search_memory: 'searched',
  search_by_tag: 'searched',
  query_memory: 'searched',
  find_similar: 'searched',
  suggest_links: 'searched',
  find_path: 'searched',
  search_logs: 'searched',
  set_my_name: 'other',
  set_my_color: 'other',
  lock_node: 'other',
  release_lock: 'other',
  snapshot: 'other',
};

/** Tools that only look: everything else an agent calls changes something. */
const READ_RE =
  /^(get_|list_|read_|link_stats|folder_stats|broken_links|diff|digest|healthcheck|stale_detection|validate_|presence|follow_ups|export_|admin_list|privacy_list)/;

/** People and processes that are not AI apps: the server, the console, the sign-in gate. */
const SYSTEM_ACTORS = /^(gateway|memora|memora-cli|system|server)$/i;
/** Vault log rows that are bookkeeping, not something done to notes. */
const SYSTEM_TYPES = new Set(['actor_alias', 'key_color', 'folder_meta']);

const raw = (it: ActivityItem, k: string): string => {
  const v = (it.raw as Record<string, unknown>)[k];
  return typeof v === 'string' ? v : '';
};

export function kindOf(it: ActivityItem): Kind {
  if (it.source === 'auth') return 'system';
  const a = it.action;
  if (KIND_OF[a]) return KIND_OF[a];
  if (/^(admin_|privacy_)/.test(a)) return READ_RE.test(a) ? 'read' : 'other';
  if (READ_RE.test(a)) return 'read';
  return 'other';
}

/** Server, sign-in and bookkeeping lines, plus note events that only echo an AI's own call. */
export function isSystem(it: ActivityItem): boolean {
  if (it.source === 'auth') return true;
  if (SYSTEM_ACTORS.test(it.actor)) return true;
  if (SYSTEM_TYPES.has(raw(it, 'type'))) return true;
  return !!it.echo;
}

function isRefused(it: ActivityItem): boolean {
  return (it.raw as { refused?: unknown }).refused === true;
}

/** `refused`: its permissions did not allow it; `failed`: it was tried and did not work. */
export function problemOf(it: ActivityItem): 'refused' | 'failed' | null {
  if (it.running || it.ok !== false) return null;
  return isRefused(it) ? 'refused' : 'failed';
}

/** "You" for your own actions, else the agent's (or person's) name. */
export function whoOf(it: ActivityItem, me = ''): string {
  if (raw(it, 'actor_kind') === 'user' || (me && it.actor === me)) return 'You';
  return it.actor;
}

/** Last part of a folder path, as shown in a sentence. */
export function folderName(folder: string): string {
  return folder.split('/').pop() || folder;
}

export function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

const em = (t: string): string => `<em class="act-n">${esc(t)}</em>`;

/** "Meetings/Kickoff_notes.md" -> "Kickoff notes": file names read as titles. */
export function titleOf(path: string): string {
  return noteName(path).replace(/_/g, ' ');
}

/** A note named in a sentence: a button that opens it while it can still exist. */
function noteRef(path: string, link: boolean): string {
  const t = titleOf(path);
  return link ? `<button type="button" class="act-n" data-note="${attr(path)}" title="${attr(path)}">${esc(t)}</button>` : em(t);
}

/** Results a search found: the server's count, else the result paths it carried (at most 20). */
function resultCount(it: ActivityItem): string {
  const n = (it.raw as { count?: unknown }).count;
  if (typeof n === 'number') return String(n);
  return it.paths.length >= 20 ? '20+' : String(it.paths.length);
}

function plural(n: number | string, one: string, many = one + 's'): string {
  return `${n} ${String(n) === '1' ? one : many}`;
}

function quoted(q: string): string {
  return `“${esc(q.length > 80 ? q.slice(0, 79) + '…' : q)}”`;
}

/** Destination of a move, when known: the path the note has now. */
function moveTo(it: ActivityItem): string {
  return it.paths.length >= 2 ? it.paths[1] : '';
}

/** The sentence after the name, as safe HTML: "edited <em>Launch plan</em>". */
export function predicate(it: ActivityItem): string {
  const problem = problemOf(it);
  if (problem) return attempt(it, problem);
  return done(it);
}

function done(it: ActivityItem): string {
  const a = it.action;
  const kind = kindOf(it);
  const p = it.paths[0] || '';
  const live = kind !== 'deleted' && kind !== 'trashed';
  const n = p ? noteRef(p, live) : '';
  const lbl = it.label && !it.paths.includes(it.label) ? it.label : '';
  const f = (x: string): string => em(folderName(x));
  const folders = (it.raw as { folders?: unknown }).folders;
  const destFolder = Array.isArray(folders) && typeof folders[0] === 'string' ? (folders[0] as string) : '';
  switch (kind) {
    case 'system':
      return systemLine(it);
    case 'created': {
      if (a === 'create_folder') return `created the folder ${em(lbl || p)}`;
      if (it.paths.length > 1 && a !== 'create_memory') return `created ${plural(it.paths.length, 'note')}`;
      if (p) {
        const fo = folderOf(p);
        return `created ${n}${fo ? ` in ${f(fo)}` : ''}`;
      }
      return lbl ? `created ${em(lbl)}${destFolder ? ` in ${f(destFolder)}` : ''}` : 'created a note';
    }
    case 'edited':
      if (a === 'add_tags' || a === 'remove_tags' || a === 'set_tags') return p ? `changed the tags of ${n}` : 'changed some tags';
      if (a === 'bulk_replace') return it.paths.length ? `replaced text in ${plural(it.paths.length, 'note')}` : 'replaced text in your notes';
      if (a === 'merge_memory') return p ? `merged notes into ${n}` : 'merged notes';
      if (a === 'rename_tag' || a === 'merge_tag') return lbl ? `renamed the tag ${em(lbl)}` : 'renamed a tag';
      if (a === 'set_folder_meta') return `changed the details of the folder ${em(folderName(lbl || p))}`;
      if (a === 'restore_memory') return p ? `brought back an earlier version of ${n}` : 'brought back an earlier version of a note';
      if (a === 'mention_agent') return p ? `left a message in ${n}` : 'left a message for another AI';
      return p ? `edited ${n}` : 'changed your notes';
    case 'moved': {
      if (a === 'move_folder' || a === 'move_folder_contents' || a === 'rename_folder') {
        const what = em(folderName(lbl || p));
        return a === 'rename_folder' ? `renamed the folder ${what}` : a === 'move_folder' ? `moved the folder ${what}` : `moved what is in ${what}`;
      }
      const to = moveTo(it);
      if (to) {
        if (folderOf(to) === folderOf(p) && titleOf(to) !== titleOf(p)) return `renamed ${em(titleOf(p))} to ${noteRef(to, true)}`;
        const fo = folderOf(to);
        return `moved ${noteRef(to, true)} to ${fo ? f(fo) : 'the top level'}`;
      }
      if (a === 'rename_memory') return p ? `renamed ${em(titleOf(p))}` : 'renamed a note';
      if (p && destFolder) return `moved ${em(titleOf(p))} to ${/^root$/i.test(destFolder) ? 'the top level' : f(destFolder)}`;
      return p ? `moved ${em(titleOf(p))}` : 'moved a note';
    }
    case 'trashed':
      if (a === 'delete_folder') return `moved the folder ${em(folderName(lbl || p))} to Trash`;
      if (it.paths.length > 1) return `moved ${plural(it.paths.length, 'note')} to Trash`;
      return p ? `moved ${n} to Trash` : 'moved notes to Trash';
    case 'deleted':
      return p ? `deleted ${n}` : 'deleted a note';
    case 'restored':
      return lbl || p ? `brought back ${em(titleOf(lbl || p))} from Trash` : 'brought back a note from Trash';
    case 'pinned': {
      const what = p ? (p.endsWith('.md') ? n : `the folder ${em(folderName(p))}`) : '';
      return a === 'unpin' ? (what ? `unpinned ${what}` : 'unpinned something') : what ? `pinned ${what}` : 'pinned something';
    }
    case 'searched': {
      const q = lbl || (a === 'find_similar' || a === 'suggest_links' ? '' : p);
      if (a === 'find_similar') return p ? `looked for notes like ${n}` : 'looked for similar notes';
      if (a === 'suggest_links') return p ? `looked for links to add to ${n}` : 'looked for links to add';
      if (a === 'find_path') return it.paths.length >= 2 ? `looked for a path from ${noteRef(p, true)} to ${noteRef(it.paths[1], true)}` : 'looked for a path between notes';
      if (a === 'search_logs') return q ? `searched the activity log for ${quoted(q)}` : 'searched the activity log';
      const count = ` (${plural(resultCount(it), 'result')})`;
      if (a === 'search_by_tag') return q ? `looked for notes tagged ${em('#' + q.replace(/^#/, ''))}${count}` : 'looked for notes by tag';
      return q ? `searched ${quoted(q)}${count}` : 'searched your notes';
    }
    case 'read':
      return readLine(it, n, lbl);
    default:
      if (a === 'set_my_name') return lbl ? `changed its name to ${em(lbl)}` : 'changed its name';
      if (a === 'set_my_color') return 'changed its colour';
      if (a === 'lock_node') return p ? `reserved ${n} while it works on it` : 'reserved a note';
      if (a === 'release_lock') return p ? `let go of ${n}` : 'let go of a note';
      if (a === 'snapshot') return 'saved a snapshot of all your notes';
      if (a.startsWith('privacy_')) return 'changed who can see what';
      if (a.startsWith('admin_')) return 'changed a server setting';
      if (it.source === 'vault' && !it.action.startsWith('node_')) return systemLine(it);
      return p ? `worked on ${n}` : 'did something in your notes';
  }
}

function readLine(it: ActivityItem, n: string, lbl: string): string {
  const a = it.action;
  const where = lbl && !/\.md$/i.test(lbl) && lbl.length < 80 ? em(folderName(lbl)) : '';
  if (a === 'read_memory') return n ? `read ${n}` : 'read a note';
  if (a === 'export_memory') return n ? `exported ${n}` : 'exported notes';
  if (a === 'get_neighbors' || a === 'get_subgraph') return n ? `looked at notes linked to ${n}` : 'looked at linked notes';
  if (a === 'get_history' || a === 'get_note_at' || a === 'diff') return n ? `looked at the history of ${n}` : 'looked at a note’s history';
  if (a === 'validate_memory') return n ? `checked ${n}` : 'checked a note';
  if (a === 'list_memory') return where ? `looked through ${where}` : 'looked through your notes';
  if (a === 'list_folders' || a === 'folder_stats') return where ? `looked at the folder ${where}` : 'looked at your folders';
  if (a === 'get_folder_meta') return where ? `read the details of the folder ${where}` : 'read folder details';
  if (a === 'healthcheck') return 'checked that Memora is working';
  if (a === 'get_stats' || a === 'digest') return 'looked at an overview of your notes';
  if (/^(get_graph|link_stats|broken_links|get_hubs|get_isolated)$/.test(a)) return 'looked at how your notes link together';
  if (a === 'get_tags' || a === 'list_tags') return 'looked at your tags';
  if (a === 'get_logs' || a === 'get_events') return 'looked at recent activity';
  if (a === 'list_trash') return 'looked in Trash';
  if (a === 'list_pins') return 'looked at your pinned notes';
  if (/^(get_locks|get_assignments|presence|list_actors)$/.test(a)) return 'checked who is working on what';
  if (/^(get_todos|follow_ups|stale_detection)$/.test(a)) return 'looked for notes that need attention';
  if (a === 'admin_list_tools' || a === 'privacy_list') return 'looked at the server settings';
  return n ? `read ${n}` : 'looked through your notes';
}

/** "change <em>Plan</em>": what an AI tried to do. */
function tried(it: ActivityItem): string {
  const p = it.paths[0] || '';
  const n = p ? em(titleOf(p)) : '';
  const lbl = it.label && !it.paths.includes(it.label) ? it.label : '';
  switch (kindOf(it)) {
    case 'created':
      return n ? `create ${n}` : lbl ? `create ${em(lbl)}` : 'create a note';
    case 'edited':
      return n ? `change ${n}` : 'change your notes';
    case 'read':
      return n ? `read ${n}` : 'look through your notes';
    case 'searched':
      return lbl ? `search ${quoted(lbl)}` : 'search your notes';
    case 'moved':
      return n ? `move ${n}` : 'move a note';
    case 'trashed':
      return n ? `move ${n} to Trash` : 'move notes to Trash';
    case 'deleted':
      return n ? `delete ${n}` : 'delete a note';
    case 'restored':
      return 'bring back a note from Trash';
    case 'pinned':
      return n ? `pin ${n}` : 'change your pins';
    default:
      return it.action.startsWith('admin_') || it.action.startsWith('privacy_') ? 'change a server setting' : 'do something';
  }
}

/** Why a call was refused, from the server's refusal message. */
function refusedWhy(error: string): string {
  if (/'write' scope/.test(error)) return 'but can only read';
  if (/'admin' scope/.test(error)) return 'but does not have full control';
  if (/disabled on this server/.test(error)) return 'but that is switched off on this server';
  if (/not allowed/.test(error)) return 'but is not allowed to';
  return 'but was refused';
}

function attempt(it: ActivityItem, problem: 'refused' | 'failed'): string {
  if (problem === 'refused') return `tried to ${tried(it)} ${refusedWhy(raw(it, 'error'))}`;
  return `tried to ${tried(it)}, but it did not work`;
}

const SYSTEM_WORDS: Record<string, string> = {
  signin: 'signed in',
  signout: 'signed out',
  signout_cli: 'was signed out from the console',
  login_fail: 'could not sign in',
  auth_fail: 'could not sign in',
  key_fail: 'an unknown key was refused',
  cooldown: 'sign-in paused after too many tries',
  key_created: 'made a new AI key',
  key_deleted: 'removed an AI key',
  key_restored: 'brought back an AI key',
  key_rolled: 'made a new secret for an AI key',
  key_updated: 'changed an AI key',
  key_permissions: 'changed what an AI may do',
};

/** Server, console and sign-in lines: plain where known, the raw words otherwise. */
function systemLine(it: ActivityItem): string {
  const w = SYSTEM_WORDS[it.action];
  const detail = it.label && it.label.length < 120 ? it.label : '';
  if (w) return esc(w);
  const words = it.action.replace(/[_.]+/g, ' ').trim();
  return `${esc(words)}${detail ? ` <span class="act-d">${esc(detail)}</span>` : ''}`;
}

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Markup to plain text (aria labels, exports, toasts). */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENT[m] || m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The whole sentence as text: "Claude Code edited Launch plan". */
export function sentenceText(it: ActivityItem, me = ''): string {
  return `${whoOf(it, me)} ${plainText(predicate(it))}`;
}

export interface Burst {
  items: ActivityItem[];
  /** The newest item; its id names the burst. */
  it: ActivityItem;
  kind: Kind;
  /** Seconds between the oldest and the newest call. */
  span: number;
}

const BURST_GAP = 120;
const BURST_SPAN = 600;

const whoKey = (it: ActivityItem): string => raw(it, 'actor_id') || 'name:' + it.actor;
/** Reads and searches of a named note group apart from browsing the whole vault. */
const flavour = (it: ActivityItem): string => `${kindOf(it)}:${kindOf(it) === 'read' && it.action !== 'read_memory' ? 'browse' : ''}`;

function localDay(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Group consecutive same-AI, same-kind calls (newest first); problems, running and system lines stay solo. */
export function groupBursts(rows: ActivityItem[], on = true, gap = BURST_GAP, span = BURST_SPAN): Burst[] {
  const out: Burst[] = [];
  let cur: ActivityItem[] = [];
  const flush = (): void => {
    if (!cur.length) return;
    out.push({ items: cur, it: cur[0], kind: kindOf(cur[0]), span: Math.max(0, cur[0].ts - cur[cur.length - 1].ts) });
    cur = [];
  };
  const solo = (x: ActivityItem): boolean => !!x.running || x.ok === false || isSystem(x) || kindOf(x) === 'system';
  for (const x of rows) {
    const prev = cur[cur.length - 1];
    const joins =
      on &&
      !!prev &&
      !solo(x) &&
      !solo(prev) &&
      whoKey(x) === whoKey(prev) &&
      flavour(x) === flavour(prev) &&
      prev.ts - x.ts <= gap &&
      cur[0].ts - x.ts <= span &&
      localDay(x.ts) === localDay(prev.ts);
    if (!joins) flush();
    cur.push(x);
  }
  flush();
  return out;
}

/** The sentence after the name for a burst: "read 12 notes in <em>Projects</em>". */
export function burstPredicate(b: Burst): string {
  if (b.items.length === 1) return predicate(b.it);
  const n = b.items.length;
  const targets = [...new Set(b.items.map((x) => (b.kind === 'moved' ? moveTo(x) || x.paths[0] : x.paths[0])).filter(Boolean))] as string[];
  const k = targets.length;
  const folders = new Set(targets.map(folderOf));
  const inF = folders.size === 1 && [...folders][0] ? ` in ${em(folderName([...folders][0]))}` : '';
  const browse = b.kind === 'read' && b.it.action !== 'read_memory';
  switch (b.kind) {
    case 'read':
      return browse || !k ? `looked around your notes ${n} times` : `read ${plural(k, 'note')}${inF}`;
    case 'searched': {
      const qs = [...new Set(b.items.map((x) => (x.label && !x.paths.includes(x.label) ? x.label : '')))];
      if (qs.length <= 3 && qs.every(Boolean)) {
        const parts = qs.map(quoted);
        return `searched ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]}`;
      }
      return `searched ${n} times`;
    }
    case 'created':
      return k ? `created ${plural(k, 'note')}${inF}` : `created ${n} notes`;
    case 'edited':
      return k === 1 ? `edited ${noteRef(targets[0], true)} ${n} times` : k ? `edited ${plural(k, 'note')}${inF}` : `made ${n} changes`;
    case 'moved':
      return `moved ${plural(Math.max(k, 1), 'note')}`;
    case 'trashed':
      return `moved ${plural(Math.max(k, 1), 'note')} to Trash`;
    case 'deleted':
      return `deleted ${plural(Math.max(k, 1), 'note')}`;
    case 'restored':
      return `brought back ${plural(n, 'note')} from Trash`;
    case 'pinned':
      return `changed your pins ${n} times`;
    default:
      return `did ${n} things`;
  }
}

/** "40 s" / "3 min": how long a burst took. */
export function spanText(secs: number): string {
  const s = Math.max(1, Math.round(secs));
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/** Tools whose success always leaves a note event behind (same actor, a few seconds later). */
const LEAVES_NODE_EVENT = new Set(['create_memory', 'save_memory', 'patch_memory', 'delete_memory', 'move_memory', 'rename_memory']);
const ECHO_SECS = 15;
/** Paths compare without `.md`: tool arguments may leave it out. */
const bare = (p: string): string => p.replace(/\.md$/i, '');

/** Fill stored agent rows from the note events their call left (path, destination, outcome) and mark those `echo`. In place. */
export function reconcile(items: ActivityItem[]): void {
  const nodes = new Map<string, ActivityItem[]>();
  for (const it of items) {
    if (it.source !== 'vault' || !it.action.startsWith('node_')) continue;
    if (!nodes.has(it.actor)) nodes.set(it.actor, []);
    nodes.get(it.actor)!.push(it);
  }
  if (!nodes.size && !items.some((x) => x.source === 'agent')) return;
  const used = new Set<ActivityItem>();
  for (const it of items) {
    if (it.source !== 'agent' || it.live) continue;
    const mine = (nodes.get(it.actor) || []).filter((n) => !used.has(n) && n.ts >= it.ts - 2 && n.ts - it.ts <= ECHO_SECS);
    const a = it.action;
    let hit: ActivityItem | undefined;
    if (a === 'create_memory' || a === 'template_create' || a === 'duplicate_memory') {
      hit = mine.find((n) => n.action === 'node_created');
      if (hit && !it.paths.length && hit.paths[0]) it.paths = [hit.paths[0]];
    } else if (a === 'move_memory' || a === 'rename_memory') {
      hit = mine.find((n) => n.action === 'node_renamed' && bare(raw(n, 'old_path')) === bare(it.paths[0] || ''));
      if (hit && hit.paths[0] && it.paths.length < 2) it.paths = [it.paths[0], hit.paths[0]];
    } else {
      const want = new Set(it.paths.map(bare));
      hit = mine.find((n) => n.paths.some((p) => want.has(bare(p))));
    }
    if (hit) {
      used.add(hit);
      hit.echo = true;
    }
    if (it.ok === undefined && !it.running && LEAVES_NODE_EVENT.has(a)) it.ok = !!hit;
  }
  // Note events of other calls of the same agent (batch tools touch many notes).
  const agentPaths = new Map<string, number[]>();
  for (const it of items) {
    if (it.source !== 'agent') continue;
    for (const p of it.paths) {
      const k = it.actor + '\u0000' + bare(p);
      if (!agentPaths.has(k)) agentPaths.set(k, []);
      agentPaths.get(k)!.push(it.ts);
    }
  }
  for (const list of nodes.values())
    for (const n of list) {
      if (n.echo) continue;
      if (n.paths.some((p) => (agentPaths.get(n.actor + '\u0000' + bare(p)) || []).some((t) => Math.abs(t - n.ts) <= ECHO_SECS))) n.echo = true;
    }
}

// Only moves and pins can be undone: there is no route to reverse creates, edits or deletes.
type UndoPlan =
  | { type: 'moveBack'; from: string; to: string }
  | { type: 'pin' | 'unpin'; path: string; kind: 'note' | 'folder' };

const UNDO_MAX_AGE = 7 * 86400;

/** `exists` says whether a note path exists right now. */
export function undoPlan(it: ActivityItem, exists: (path: string) => boolean, now = Date.now() / 1000): UndoPlan | null {
  if (it.source !== 'agent' || it.running || it.ok === false || now - it.ts > UNDO_MAX_AGE) return null;
  const a = it.action;
  if (a === 'move_memory' || a === 'rename_memory') {
    if (it.ok !== true) return null;
    const from = it.paths[0];
    const to = moveTo(it);
    if (!from || !to || from === to || !exists(to) || exists(from)) return null;
    return { type: 'moveBack', from, to };
  }
  // A stored pin carries no outcome: runUndo checks the pin list first.
  if (a === 'pin' || a === 'unpin') {
    const p = it.paths[0];
    if (!p) return null;
    return { type: a === 'pin' ? 'unpin' : 'pin', path: p, kind: p.endsWith('.md') ? 'note' : 'folder' };
  }
  return null;
}

const ACTION_LABELS: Record<string, string> = {
  create_memory: 'Created a note',
  batch_create: 'Created several notes',
  save_memory: 'Rewrote a note',
  patch_memory: 'Edited part of a note',
  read_memory: 'Read a note',
  search_memory: 'Searched notes',
  query_memory: 'Searched with filters',
  list_memory: 'Looked through notes',
  node_created: 'Note created',
  node_updated: 'Note saved',
  node_renamed: 'Note moved or renamed',
  node_deleted: 'Note deleted',
  folder_changed: 'Folder changed',
};

/** A plain name for one kind of action: "Read a note", "Searched notes". */
export function actionLabel(action: string, source: ActivityItem['source'] = 'agent'): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const it = { id: '', ts: 0, actor: '', action, label: '', paths: [], source, ok: true, raw: {} } as ActivityItem;
  const t = plainText(done(it));
  return t.charAt(0).toUpperCase() + t.slice(1);
}
