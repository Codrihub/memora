// The Mnemo page (/mnemo): the chat list beside the open chat. The page is built once and
// kept, so a reply keeps streaming while you look at other pages.

import { apiPost } from '../api';
import { $, attr, el, esc, useStyles } from '../dom';
import { relTs } from '../format';
import { Modal } from '../modal';
import { hooks } from '../hooks';
import { onNavigate, setMnemoChat, takeMnemoChat } from '../router';
import { setThemePref, THEME_ICON, THEME_LABEL, themePref, type ThemePref } from '../theme';
import { state, type Page } from '../state';
import { notify, toast } from '../toast';
import { icon } from '../ui/icons';
import { openMenu } from '../vault/ui';
import { VAULT_CSS } from '../vault/styles';
import * as A from './api';
import { leaveAgentActivity, mountAgentActivity } from '../views/activity-agent';
import { useAgentPageStyles } from '../views/agent-page';
import { useActivityStyles } from '../control/activity';
import { ChatView, openMnemoSettings, openShown, type Artifact } from './chat';
import { MNEMO_CSS, markHTML } from './styles';


let root: HTMLElement | null = null;
let chat: ChatView | null = null;
let sessions: A.Session[] = [];
let query = '';
/** Server results for `query` (chats and the messages that matched). */
let found: { query: string; hits: A.SearchHit[] } | null = null;
let searchTimer = 0;

/** Open a chat on the page (from the floating panel's "open full"). */
let pendingOpen: string | null = null;
/** What to bring along when Mnemo opens: a note or folder to attach, text to start with. */
let pendingWith: { scope?: string; text?: string; view?: 'activity' } | null = null;
/** Mnemo's activity is on screen instead of the chat. */
let showingActivity = false;

/** Open the Mnemo page on chat `id` ('' = a new chat, null = the chat you were in). */
export function openOnPage(id: string | null, extra?: { scope?: string; text?: string; view?: 'activity' }): void {
  pendingOpen = id;
  pendingWith = extra ?? null;
}

/** Close the page (Ctrl+J from inside it): back where it was opened from. */
export function leaveMnemo(): void {
  leave(false);
}

export async function renderAssistant(): Promise<void> {
  useStyles('mnemo-css', MNEMO_CSS);
  useStyles('mnemo-page-css', PAGE_CSS);
  useStyles('vx-styles', VAULT_CSS);
  const host = $('#view-assistant');
  if (!root) build();
  if (root!.parentElement !== host) host.replaceChildren(root!);
  await refreshList();
  watchRunning();
  paintPrefs();
  const want = pendingOpen;
  const extra = pendingWith;
  pendingOpen = null;
  pendingWith = null;
  const fresh = arriving;
  arriving = false;
  // The address names a chat (a reload, a link, Back): open that one.
  const linked = takeMnemoChat();
  if (linked && !want && chat!.session?.id !== linked) {
    await openChat(linked);
    paintHead();
    void A.loadState(true).catch(() => undefined);
    fitViewport();
    return;
  }
  if (linked && chat!.session?.id === linked) return;
  // Coming to Mnemo (menu, button, Ctrl/Cmd+J, Ask Mnemo) always starts a new chat; earlier
  // chats are one tap away in the list. A reply still running keeps its chat on screen.
  if (want) await openChat(want);
  else if (want === '' || (fresh && !chat!.working)) newChat();
  if (fresh || extra) showActivity(extra?.view === 'activity');
  if (extra?.scope) chat!.attachScope(extra.scope);
  if (extra?.text) chat!.prefill(extra.text);
  paintHead();
  void A.loadState(true).catch(() => undefined);
  if (window.matchMedia('(min-width: 761px)').matches) chat!.focus();
  fitViewport();
}

function build(): void {
  root = el('div', 'mnp');
  root.innerHTML = `
    <aside class="mnp-side" id="mnpSide" aria-label="Chats">
      <div class="mnp-brand">${markHTML('md')}<div class="mnp-bt"><b>${A.MNEMO}</b><small>Your notes agent</small></div>
        <button type="button" class="mnp-new" id="mnpNew" title="New chat" aria-label="New chat">${icon('plus')}</button>
        <button type="button" class="mnp-fold" id="mnpFold" title="Hide the chat list" aria-label="Hide the chat list">${icon('sidebar')}</button></div>
      <label class="mnp-q">${icon('search')}<span class="sr-only">Search chats</span><input type="search" id="mnpQ" placeholder="Search everything said" autocomplete="off"></label>
      <button type="button" class="mnp-newrow" id="mnpNewRow">${icon('plus')}<span>New chat</span></button>
      <nav class="mnp-list" id="mnpList" aria-label="Chat list"></nav>
      <div class="mnp-prefs">
        <span class="mnp-prefs-l">Appearance</span>
        <div class="mnp-prefs-r">
          <div class="mnp-theme" role="radiogroup" aria-label="Theme">${(['light', 'dark', 'system'] as ThemePref[])
            .map((t) => `<button type="button" role="radio" data-theme-pick="${t}" title="${THEME_LABEL[t]}" aria-label="${THEME_LABEL[t]}">${icon(THEME_ICON[t])}</button>`)
            .join('')}</div>
          <button type="button" class="mnp-bgbtn" id="mnpBg" title="Chat background" aria-label="Chat background" aria-haspopup="dialog"><i class="mnp-bgsw"></i><span id="mnpBgName">Glow</span>${icon(
            'chev-down',
          )}</button>
        </div>
      </div>
      <nav class="mnp-sfoot" aria-label="${A.MNEMO}">
        <button type="button" class="mnp-set" id="mnpActBtn" title="Everything ${A.MNEMO} did, and for whom">${icon('activity')}<span>Activity</span></button>
        <button type="button" class="mnp-set" id="mnpSet" title="Models, keys and instructions">${icon('settings')}<span>Settings</span></button>
        <button type="button" class="mnp-set" id="mnpHome" title="Back to Memora">${icon('overview')}<span>Back to Memora</span></button>
      </nav>
    </aside>
    <div class="mnp-scrim" id="mnpScrim"></div>
    <main class="mnp-main">
      <header class="mnp-head">
        <button type="button" class="mnp-lists" id="mnpLists" aria-label="Show or hide the chat list" title="Chats" aria-controls="mnpSide">${icon('sidebar')}</button>
        <div class="mnp-title"><b id="mnpTitle">New chat</b><small id="mnpSub"></small></div>
        <button type="button" class="mn-ibtn" id="mnpNew2" aria-label="New chat" title="New chat">${icon('plus')}</button>
        <button type="button" class="mn-ibtn mnp-artbtn" id="mnpArtBtn" aria-label="Notes, folders and images in this chat" title="In this chat" aria-controls="mnpArt">${icon(
          'sidebar',
        )}<span class="mnp-artn" hidden></span></button>
        <button type="button" class="mn-ibtn" id="mnpMore" aria-label="Chat actions" title="More">${icon('more')}</button>
        <span class="mnp-hsep" aria-hidden="true"></span>
        <button type="button" class="mn-ibtn mnp-close" id="mnpClose" aria-label="Close ${A.MNEMO}" title="Close ${A.MNEMO} (Esc)">${icon('close')}</button>
      </header>
      <div class="mnp-chat" id="mnpChat"></div>
      <div class="mnp-act" id="mnpAct" hidden><div class="ap mnp-ap"></div></div>
    </main>
    <aside class="mnp-art" id="mnpArt" aria-label="In this chat">
      <div class="mnp-art-h"><b>In this chat</b><button type="button" class="mn-ibtn" id="mnpArtX" aria-label="Close" title="Close">${icon('close')}</button></div>
      <div class="mnp-art-b" id="mnpArtB"></div>
    </aside>
    <div class="mnp-ascrim" id="mnpAScrim"></div>`;
  chat = new ChatView({
    scope: () => 'global',
    onChange: (s) => {
      setMnemoChat(s.id);
      upsert(s);
      paintHead();
    },
    onNew: () => {
      setMnemoChat(null);
      paintList();
      paintHead();
    },
    onMessages: () => paintArt(),
    // The chat on screen started or finished a reply: its row spins meanwhile.
    onBusy: (on) => {
      const s = chat?.session && sessions.find((x) => x.id === chat!.session!.id);
      if (s) s.running = on;
      paintList();
      if (!on) void refreshList().then(paintList);
      watchRunning();
    },
  });
  root.querySelector('#mnpChat')!.append(chat.el);
  const q = root.querySelector<HTMLInputElement>('#mnpQ')!;
  q.oninput = () => {
    query = q.value.trim().toLowerCase();
    window.clearTimeout(searchTimer);
    if (query.length < 2) found = null;
    else {
      const want = query;
      // Search what was said, not only the titles (after a short pause in typing).
      searchTimer = window.setTimeout(() => {
        void A.searchChats(want)
          .then((r) => {
            if (query === want) {
              found = { query: want, hits: r.hits };
              paintList();
            }
          })
          .catch(() => undefined);
      }, 220);
    }
    paintList();
  };
  const side = (open: boolean): void => {
    root!.classList.toggle('side-open', open);
  };
  // Phones: the chat list slides over the chat. Wider screens: it folds away and back.
  root.querySelector<HTMLElement>('#mnpLists')!.onclick = () => {
    if (isNarrow()) side(true);
    else setPane('side', root!.classList.contains('side-closed'));
  };
  root.querySelector<HTMLElement>('#mnpArtBtn')!.onclick = () => setPane('art', !root!.classList.contains('art-open'));
  root.querySelector<HTMLElement>('#mnpArtX')!.onclick = () => setPane('art', false);
  root.querySelector<HTMLElement>('#mnpAScrim')!.onclick = () => setPane('art', false);
  root.querySelector<HTMLElement>('#mnpArtB')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-card]');
    if (!b) return;
    if (isNarrow() || window.innerWidth < 1100) setPane('art', false);
    openShown(b.dataset.card || '', b.dataset.path || '');
  });
  const panes = readPanes();
  root.classList.toggle('side-closed', !panes.side);
  root.classList.toggle('art-open', panes.art && window.innerWidth >= 1100);
  root.querySelector<HTMLElement>('#mnpScrim')!.onclick = () => side(false);
  root.querySelector<HTMLElement>('#mnpNew')!.onclick = () => {
    side(false);
    newChat();
  };
  root.querySelector<HTMLElement>('#mnpNew2')!.onclick = () => newChat();
  // Wide screens: the chat list folds from its own corner; New chat sits under the search.
  root.querySelector<HTMLElement>('#mnpFold')!.onclick = () => setPane('side', false);
  root.querySelector<HTMLElement>('#mnpNewRow')!.onclick = () => newChat();
  root.querySelector<HTMLElement>('#mnpSet')!.onclick = () => openMnemoSettings();
  root.querySelector<HTMLElement>('#mnpHome')!.onclick = () => leave(true);
  root.querySelectorAll<HTMLElement>('[data-theme-pick]').forEach((b) => {
    b.onclick = () => {
      setThemePref(b.dataset.themePick as ThemePref);
      paintPrefs();
    };
  });
  root.querySelector<HTMLElement>('#mnpBg')!.onclick = (e) => bgMenu(e.currentTarget as HTMLElement);
  paintPrefs();
  root.querySelector<HTMLElement>('#mnpActBtn')!.onclick = () => {
    side(false);
    showActivity(true);
  };
  root.querySelector<HTMLElement>('#mnpClose')!.onclick = () => leave(false);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state.page !== 'assistant' || e.defaultPrevented) return;
    // Esc first closes whatever is open on top (a menu, a picker, a dialog, the chat list).
    if (document.querySelector('.ui-sel-pop,.vx-menu') || !$('#modalHost').classList.contains('hidden')) return;
    if (root!.classList.contains('side-open')) {
      root!.classList.remove('side-open');
      return;
    }
    const box = root!.querySelector<HTMLTextAreaElement>('.mn-comp textarea');
    if (box && document.activeElement === box && box.value.trim()) return;
    leave(false);
  });
  root.querySelector<HTMLElement>('#mnpMore')!.onclick = (e) => headMenu(e.currentTarget as HTMLElement);
  root.querySelector<HTMLElement>('#mnpList')!.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const more = t.closest<HTMLElement>('[data-more]');
    const row = t.closest<HTMLElement>('[data-id]');
    if (!row) return;
    const id = row.dataset.id!;
    const s = sessions.find((x) => x.id === id);
    if (more) {
      e.stopPropagation();
      if (s) rowMenu(s, more);
      return;
    }
    side(false);
    const mid = Number(row.dataset.mid || 0);
    void openChat(id).then(() => {
      if (mid) chat!.reveal(mid);
    });
  });
}

/** The page Mnemo was opened from, so closing goes back there. */
let from: Page | null = null;
/** Phones: the page follows the part of the screen the keyboard leaves (iOS overlays the
 *  keyboard; Android PWAs sometimes do), so the composer always sits right above it. */
function fitViewport(): void {
  const vv = window.visualViewport;
  const r = document.documentElement;
  if (!vv || state.page !== 'assistant') return;
  r.style.setProperty('--mn-vvh', Math.round(vv.height) + 'px');
  r.style.setProperty('--mn-vvtop', Math.round(vv.offsetTop) + 'px');
  const kb = window.innerHeight - vv.height - vv.offsetTop > 80;
  root?.classList.toggle('kb', kb);
}
window.visualViewport?.addEventListener('resize', fitViewport);
window.visualViewport?.addEventListener('scroll', fitViewport);
onNavigate(() => window.setTimeout(fitViewport, 0));

hooks.mnemoActivity = () => {
  openOnPage(null, { view: 'activity' });
  if (state.page === 'assistant') showActivity(true);
  else hooks.go('assistant');
};

/** Set when the page was left, so coming back starts a new chat. */
let arriving = true;
onNavigate((page) => {
  if (page !== 'assistant') {
    from = page;
    arriving = true;
  }
});

/** Leave the full-screen chat: back where you came from, or (home) to the Overview. */
function leave(home: boolean): void {
  root?.classList.remove('side-open');
  if (home || !from) hooks.go('home');
  else if (from === 'vault' && history.length > 1) history.back();
  else hooks.go(from);
}

function newChat(): void {
  showActivity(false);
  setMnemoChat(null);
  chat!.blank();
  paintList();
  paintHead();
  chat!.focus();
}

/** Chat backgrounds: quiet textures and light that follow the theme, never loud. */
const BGS = [
  { id: 'glow', label: 'Glow' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'dawn', label: 'Dawn' },
  { id: 'deep', label: 'Deep' },
  { id: 'dots', label: 'Dots' },
  { id: 'grid', label: 'Grid' },
  { id: 'lines', label: 'Lines' },
  { id: 'waves', label: 'Waves' },
  { id: 'grain', label: 'Grain' },
  { id: 'plain', label: 'Plain' },
] as const;
type BgId = (typeof BGS)[number]['id'];
const LS_BG = 'memora.mnemo.bg.v1';

function readBg(): BgId {
  try {
    const v = localStorage.getItem(LS_BG);
    return BGS.some((b) => b.id === v) ? (v as BgId) : 'glow';
  } catch {
    return 'glow';
  }
}

function setBg(id: BgId): void {
  try {
    localStorage.setItem(LS_BG, id);
  } catch {
    /* lasts until reload */
  }
  paintPrefs();
}

/** A small panel of background tiles, each a preview of itself. */
function bgMenu(at: HTMLElement): void {
  document.querySelector('.mnp-bgpop')?.remove();
  const cur = readBg();
  const pop = el('div', 'mnp-bgpop');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Chat background');
  pop.innerHTML = `<b class="mnp-bgpop-h">Chat background</b><div class="mnp-bgpop-g">${BGS.map(
    (b) =>
      `<button type="button" class="mnp-bgopt${b.id === cur ? ' on' : ''}" data-pick-bg="${b.id}" aria-pressed="${b.id === cur}"><i class="mnp-bgsw big" data-bg="${b.id}"></i><span>${esc(
        b.label,
      )}</span></button>`,
  ).join('')}</div>`;
  document.body.append(pop);
  const r = at.getBoundingClientRect();
  const w = Math.min(312, window.innerWidth - 24);
  pop.style.width = w + 'px';
  pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left)) + 'px';
  if (r.top > 380) pop.style.bottom = window.innerHeight - r.top + 8 + 'px';
  else pop.style.top = r.bottom + 8 + 'px';
  const close = (): void => {
    pop.remove();
    document.removeEventListener('pointerdown', out, true);
    document.removeEventListener('keydown', key, true);
  };
  const out = (e: Event): void => {
    if (!pop.contains(e.target as Node) && !at.contains(e.target as Node)) close();
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('pointerdown', out, true);
  document.addEventListener('keydown', key, true);
  pop.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick-bg]');
    if (!b) return;
    setBg(b.dataset.pickBg as BgId);
    pop.querySelectorAll('.mnp-bgopt').forEach((x) => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', String(on));
    });
  };
}

/** The theme switch and the background swatch show what is on now. */
function paintPrefs(): void {
  if (!root) return;
  const t = themePref();
  root.querySelectorAll<HTMLElement>('[data-theme-pick]').forEach((b) => {
    const on = b.dataset.themePick === t;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  const bg = readBg();
  root.dataset.bg = bg;
  root.querySelector<HTMLElement>('#mnpBg .mnp-bgsw')!.dataset.bg = bg;
  root.querySelector('#mnpBgName')!.textContent = BGS.find((b) => b.id === bg)?.label || 'Glow';
}

const LS_PANES = 'memora.mnemo.panes.v1';
const isNarrow = (): boolean => window.matchMedia('(max-width: 760px)').matches;

function readPanes(): { side: boolean; art: boolean } {
  try {
    return { side: true, art: false, ...(JSON.parse(localStorage.getItem(LS_PANES) || '{}') as object) };
  } catch {
    return { side: true, art: false };
  }
}

/** Open or close the chat list (wide screens) or the "In this chat" panel; remembered here. */
function setPane(which: 'side' | 'art', open: boolean): void {
  if (!root) return;
  if (which === 'side') root.classList.toggle('side-closed', !open);
  else root.classList.toggle('art-open', open);
  if (which === 'art' && open) paintArt();
  try {
    localStorage.setItem(LS_PANES, JSON.stringify({ ...readPanes(), [which]: open }));
  } catch {
    /* storage blocked: lasts until reload */
  }
}

const ART_GROUPS: { role: Artifact['role']; label: string }[] = [
  { role: 'changed', label: 'Changed' },
  { role: 'shown', label: 'Shown to you' },
  { role: 'attached', label: 'You attached' },
  { role: 'read', label: 'Read' },
];

/** The "In this chat" panel: every note, folder, image and the vault this chat touched. */
function paintArt(): void {
  if (!root || !chat) return;
  const items = chat.artifacts();
  const n = root.querySelector<HTMLElement>('.mnp-artn')!;
  n.hidden = !items.length;
  n.textContent = String(items.length);
  const body = root.querySelector<HTMLElement>('#mnpArtB')!;
  if (!items.length) {
    body.innerHTML = `<p class="mnp-art-none">Notes, folders and images this chat attaches, reads, changes or shows you collect here.</p>`;
    return;
  }
  body.innerHTML = ART_GROUPS.map((g) => {
    const list = items.filter((i) => i.role === g.role);
    if (!list.length) return '';
    return `<section><h4>${esc(g.label)}<span>${list.length}</span></h4>${list
      .map((i) => {
        const dir = i.kind === 'note' || i.kind === 'image' ? (i.path.includes('/') ? i.path.slice(0, i.path.lastIndexOf('/')) : 'Top level') : i.kind === 'upload' ? 'Image you attached' : i.kind === 'vault' ? 'Every note' : 'Folder';
        const lead =
          i.kind === 'image' || i.kind === 'upload'
            ? `<span class="mnp-art-img"><img alt="" loading="lazy" src="${attr(
                i.kind === 'upload' ? `/api/assistant/uploads/${i.path}` : `/api/vault/file?path=${encodeURIComponent(i.path)}`,
              )}" onerror="this.remove()"></span>`
            : `<span class="mnp-art-ic k-${i.kind}">${icon(i.kind === 'note' ? (i.role === 'changed' ? 'edit' : 'note') : i.kind === 'folder' ? 'folder' : 'vault')}</span>`;
        return `<button type="button" class="mnp-art-i" data-card="${attr(i.kind)}" data-path="${attr(i.path)}" title="${attr(i.path || i.title)}">${lead}<span class="mnp-art-t"><b>${esc(
          i.title || 'Untitled',
        )}</b><small>${esc(dir)}</small></span></button>`;
      })
      .join('')}</section>`;
  }).join('');
}

/** Swap the chat for Mnemo's activity (every tool call, and who it was for), or back. */
function showActivity(on: boolean): void {
  if (!root) return;
  const box = root.querySelector<HTMLElement>('#mnpAct')!;
  if (on === showingActivity && (on ? !box.hidden : box.hidden)) return;
  showingActivity = on;
  root.querySelector<HTMLElement>('#mnpChat')!.hidden = on;
  box.hidden = !on;
  root.querySelector('#mnpActBtn')?.classList.toggle('on', on);
  if (on) {
    // The same look as an agent's Activity tab and the Overview.
    useAgentPageStyles();
    useActivityStyles();
  }
  if (on) mountAgentActivity(box.querySelector<HTMLElement>('.mnp-ap')!, box, { id: 'mnemo', name: A.MNEMO, used: true }, { top: () => 0, setup: () => openMnemoSettings() });
  else leaveAgentActivity();
  paintHead();
}

async function openChat(id: string): Promise<void> {
  showActivity(false);
  setMnemoChat(id);
  await chat!.open(id);
  // A chat that is gone (deleted, another server): back to a new one.
  if (chat!.session?.id !== id) setMnemoChat(null);
  paintList();
  paintHead();
}

/** While a reply runs in any chat (one you left, or an @mnemo request), check the list now
 *  and then so its row stops spinning when it is done. */
let runTimer = 0;
function watchRunning(): void {
  if (runTimer || !sessions.some((s) => s.running)) return;
  runTimer = window.setInterval(() => {
    if (state.page !== 'assistant' || document.hidden) return;
    void refreshList().then(() => {
      paintList();
      if (!sessions.some((s) => s.running)) {
        window.clearInterval(runTimer);
        runTimer = 0;
      }
    });
  }, 4000);
}

async function refreshList(): Promise<void> {
  try {
    sessions = (await A.listSessions()).sessions;
  } catch (e) {
    sessions = [];
    const list = root?.querySelector('#mnpList');
    if (list) list.innerHTML = `<p class="mnp-none">${esc((e as Error).message)}</p>`;
    return;
  }
  paintList();
}

function upsert(s: A.Session): void {
  const i = sessions.findIndex((x) => x.id === s.id);
  if (i >= 0) sessions[i] = { ...sessions[i], ...s };
  else sessions.unshift(s);
  paintList();
}

function bucket(s: A.Session): string {
  if (s.pinned) return 'Pinned';
  const d = new Date(s.updated_at * 1000);
  const now = new Date();
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86_400_000;
  if (diff < 1) return 'Today';
  if (diff < 2) return 'Yesterday';
  if (diff < 7) return 'This week';
  if (diff < 31) return 'This month';
  return 'Older';
}

/** `text` with each word of the query marked. */
function marked(text: string, q: string): string {
  let out = esc(text);
  for (const w of q.split(/\s+/).filter((x) => x.length > 1).slice(0, 6)) {
    const re = new RegExp(esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return out;
}

/** A chat's title, with the prefix of note tasks shown as a tag. */
function titleHTML(t: string, q = ''): string {
  if (t.startsWith(A.NOTE_TASK_PREFIX)) return `<span class="mnp-tag" title="Asked with @mnemo in a note">@ note</span>${marked(t.slice(A.NOTE_TASK_PREFIX.length), q)}`;
  return marked(t, q);
}

/** Search results: each chat once, with the messages that matched (tap one to jump to it). */
function paintFound(list: HTMLElement): boolean {
  if (!found || found.query !== query) return false;
  const chats = new Map<string, A.SearchHit[]>();
  for (const h of found.hits) {
    if (!chats.has(h.chat)) chats.set(h.chat, []);
    if (h.message_id != null) chats.get(h.chat)!.push(h);
  }
  if (!chats.size) {
    list.innerHTML = `<p class="mnp-none">Nothing in your chats says “${esc(query)}”.</p>`;
    return true;
  }
  const n = found.hits.filter((h) => h.message_id != null).length;
  let html = `<div class="mnp-g">${n ? `${n} message${n === 1 ? '' : 's'} in ${chats.size} chat${chats.size === 1 ? '' : 's'}` : `${chats.size} chat${chats.size === 1 ? '' : 's'}`}</div>`;
  for (const [id, hits] of chats) {
    const s = sessions.find((x) => x.id === id);
    const h0 = found.hits.find((h) => h.chat === id)!;
    html += `<div class="mnp-row mnp-res" data-id="${attr(id)}" role="button" tabindex="0">
      <span class="mnp-row-ic">${icon(h0.scope.startsWith('note:') ? 'note' : 'chat')}</span>
      <span class="mnp-row-t"><b>${titleHTML(s?.title || h0.title, query)}</b><small>${esc(relTs(s?.updated_at || h0.at))}</small></span></div>`;
    for (const h of hits.slice(0, 3)) {
      html += `<button type="button" class="mnp-hit" data-id="${attr(id)}" data-mid="${h.message_id}"><em>${h.role === 'user' ? 'You' : A.MNEMO}</em>${marked(h.snippet, query)}</button>`;
    }
    if (hits.length > 3) html += `<div class="mnp-hit-more">+${hits.length - 3} more in this chat</div>`;
  }
  list.innerHTML = html;
  return true;
}

function paintList(): void {
  const list = root?.querySelector<HTMLElement>('#mnpList');
  if (!list) return;
  if (query.length >= 2 && paintFound(list)) return;
  const shown = sessions
    .filter((s) => !query || s.title.toLowerCase().includes(query) || A.scopeLabel(s.scope).toLowerCase().includes(query))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at - a.updated_at);
  if (!shown.length) {
    list.innerHTML = `<p class="mnp-none">${query ? 'No chat matches.' : `No chats yet. Ask ${A.MNEMO} something to start one.`}</p>`;
    return;
  }
  const cur = chat?.session?.id;
  let html = '';
  let last = '';
  for (const s of shown) {
    const b = bucket(s);
    if (b !== last) {
      html += `<div class="mnp-g">${esc(b)}</div>`;
      last = b;
    }
    const ic = s.scope.startsWith('note:') ? 'note' : s.scope.startsWith('folder:') ? 'folder' : 'chat';
    html += `<div class="mnp-row${s.id === cur ? ' on' : ''}${s.running ? ' run' : ''}" data-id="${attr(s.id)}" role="button" tabindex="0" aria-current="${s.id === cur}">
      <span class="mnp-row-ic">${s.running ? `<i class="mnp-spin" title="${A.MNEMO} is working on this"></i>` : icon(ic)}</span>
      <span class="mnp-row-t"><b>${titleHTML(s.title)}</b><small>${esc(A.scopeLabel(s.scope))} · ${esc(relTs(s.updated_at))}</small></span>
      <button type="button" class="mn-ibtn mnp-row-more" data-more aria-label="Chat actions">${icon('more')}</button></div>`;
  }
  list.innerHTML = html;
  list.querySelectorAll<HTMLElement>('.mnp-row').forEach((r) => {
    r.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        r.click();
      }
    };
  });
}

function paintHead(): void {
  if (!root) return;
  if (showingActivity) {
    root.querySelector('#mnpTitle')!.textContent = `${A.MNEMO} activity`;
    root.querySelector('#mnpSub')!.textContent = 'Everything it did, and who it was for';
    return;
  }
  const s = chat?.session;
  root.querySelector('#mnpTitle')!.textContent = s?.title || 'New chat';
  root.querySelector('#mnpTitle')!.classList.toggle('task', !!s?.title.startsWith(A.NOTE_TASK_PREFIX));
  root.querySelector('#mnpSub')!.textContent = s
    ? `${A.scopeLabel(s.scope)} · ${s.messages} message${s.messages === 1 ? '' : 's'}`
    : 'A chat about your whole vault';
}

/** The ⋯ in the header: this chat's actions (once it has started), the chat list and settings. */
function headMenu(at: HTMLElement): void {
  const s = chat?.session;
  openMenu(
    [
      ...(s
        ? []
        : [{ label: 'New chat: these work once you send a message', icon: icon('info', 'vx-i'), disabled: true }, { sep: true, label: '' }]),
      { label: 'Rename', icon: icon('edit', 'vx-i'), disabled: !s, run: () => s && rename(s) },
      {
        label: s?.pinned ? 'Unpin' : 'Pin to the top',
        icon: icon('pin', 'vx-i'),
        disabled: !s,
        run: () => s && void A.updateSession(s.id, { pinned: !s.pinned }).then((r) => afterUpdate(r.session), fail),
      },
      ...exportItems(s),
      { label: 'Delete chat', icon: icon('trash', 'vx-i'), danger: !!s, disabled: !s, run: () => s && askDelete(s) },
      { sep: true, label: '' },
      {
        label: 'All chats',
        icon: icon('chat', 'vx-i'),
        run: () => {
          if (isNarrow()) root?.classList.add('side-open');
          else setPane('side', true);
          root?.querySelector<HTMLInputElement>('#mnpQ')?.focus();
        },
      },
      { label: `${A.MNEMO} activity`, icon: icon('activity', 'vx-i'), run: () => showActivity(true) },
      { label: 'Chat background', icon: icon('image', 'vx-i'), run: () => bgMenu(at) },
      { label: `${A.MNEMO} settings: models and keys`, icon: icon('settings', 'vx-i'), run: () => openMnemoSettings() },
      { label: 'Back to Memora', icon: icon('overview', 'vx-i'), run: () => leave(true) },
    ],
    at,
  );
}

/** Download a chat as a Markdown file. */
function downloadChat(s: A.Session): void {
  const a = document.createElement('a');
  a.href = A.exportUrl(s.id);
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
}

/** Keep a chat in the vault: a Markdown note in the folder "Mnemo chats". */
async function saveChatNote(s: A.Session): Promise<void> {
  try {
    const res = await fetch(A.exportUrl(s.id), { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const content = await res.text();
    const title = s.title.startsWith(A.NOTE_TASK_PREFIX) ? s.title.slice(A.NOTE_TASK_PREFIX.length) : s.title;
    const r = await apiPost<{ path: string }>('/api/create', { title: `Chat - ${title}`.slice(0, 100), folder: 'Mnemo chats', content });
    void hooks.loadCore();
    notify(`Saved as a note in Mnemo chats`, 'ok', 6000, { label: 'Open', run: () => hooks.openNote(r.path) });
  } catch (e) {
    fail(e);
  }
}

/** The export entries of a chat's menus. */
function exportItems(s: A.Session | null | undefined): { label: string; icon: string; disabled?: boolean; run: () => void }[] {
  return [
    { label: 'Download as Markdown', icon: icon('download', 'vx-i'), disabled: !s, run: () => s && downloadChat(s) },
    { label: 'Save as a note', icon: icon('note', 'vx-i'), disabled: !s, run: () => s && void saveChatNote(s) },
  ];
}

function rowMenu(s: A.Session, at: HTMLElement): void {
  openMenu(
    [
      { label: 'Rename', icon: icon('edit', 'vx-i'), run: () => rename(s) },
      {
        label: s.pinned ? 'Unpin' : 'Pin to the top',
        icon: icon('pin', 'vx-i'),
        run: () => void A.updateSession(s.id, { pinned: !s.pinned }).then((r) => afterUpdate(r.session), fail),
      },
      ...exportItems(s),
      { sep: true, label: '' },
      { label: 'Delete chat', icon: icon('trash', 'vx-i'), danger: true, run: () => askDelete(s) },
    ],
    at,
  );
}

function fail(e: unknown): void {
  toast((e as Error).message, 'err');
}

function afterUpdate(s: A.Session): void {
  upsert(s);
  if (chat?.session?.id === s.id) chat.session = { ...chat.session, ...s };
  paintHead();
}

function rename(s: A.Session): void {
  const body = el('div', 'mnp-ren', `<label class="mnp-ren-l">Name<input type="text" maxlength="80" value="${attr(s.title)}"></label>`);
  const input = body.querySelector('input')!;
  const save = async (): Promise<void> => {
    const title = input.value.trim();
    if (!title) return;
    try {
      afterUpdate((await A.updateSession(s.id, { title })).session);
      Modal.close();
    } catch (e) {
      fail(e);
    }
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') void save();
  };
  Modal.open({
    title: 'Rename chat',
    body,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      { label: 'Save', cls: 'primary', run: save },
    ],
  });
  window.setTimeout(() => input.select(), 30);
}

function askDelete(s: A.Session): void {
  Modal.confirm('Delete this chat?', `“${s.title}” and its messages are removed. Your notes are not touched.`, 'Delete chat', async () => {
    try {
      await A.deleteSession(s.id);
      sessions = sessions.filter((x) => x.id !== s.id);
      if (chat?.session?.id === s.id) newChat();
      else paintList();
      Modal.close();
      toast('Chat deleted', 'ok');
    } catch (e) {
      fail(e);
    }
  });
}

const PAGE_CSS = `
/* Mnemo is a full-screen place of its own: no Memora header, sidebar or tab bar. */
:root[data-page=assistant] :is(#sidebar,#topbar,#tabbar,#sideScrim){display:none!important}
:root[data-page=assistant] #view-assistant{position:fixed;inset:0;z-index:40;background:var(--bg);padding:var(--safe-t,0px) 0 var(--safe-b,0px)!important}
#view-assistant{padding:0!important;overflow:hidden}
.mnp-hsep{width:1px;height:20px;margin:0 4px;background:var(--line)}
.mnp-close .i{width:18px;height:18px;stroke-width:2}
.mnp-sfoot{display:flex;flex-direction:column;gap:2px}
.mnp{--sw:288px;--aw:0px;display:grid;grid-template-columns:var(--sw) minmax(0,1fr) var(--aw);height:100%;min-height:0;position:relative;
  transition:grid-template-columns .25s var(--ease-out,ease-out)}
.mnp.side-closed{--sw:0px}
.mnp.art-open{--aw:300px}
.mnp-side,.mnp-art{min-width:0;overflow:hidden}
.mnp.side-closed .mnp-side{visibility:hidden}
.mnp-lists{display:inline-grid;place-items:center;flex:none;width:36px;height:36px;padding:0;border:1px solid var(--line);border-radius:10px;
  background:var(--surface-1,var(--panel));color:var(--fg);cursor:pointer;transition:background .15s,border-color .15s,transform .15s}
.mnp-lists:hover{background:var(--hover);border-color:var(--line-strong)}
.mnp-lists .i{width:18px;height:18px;stroke-width:1.9}
.mnp-artbtn{position:relative}
.mnp-artbtn .i{transform:scaleX(-1)}
.mnp.art-open .mnp-artbtn{color:var(--accent);background:var(--accent-soft)}
.mnp-artn{position:absolute;top:-3px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:99px;font-size:10px;font-weight:700;line-height:16px;text-align:center;
  color:var(--on-accent,#fff);background:var(--accent)}
.mnp-artn[hidden]{display:none}
.mnp-art{display:flex;flex-direction:column;min-height:0;border-left:1px solid var(--line);background:color-mix(in srgb,var(--surface-1,var(--panel)) 60%,transparent)}
.mnp:not(.art-open) .mnp-art{visibility:hidden}
.mnp-art-h{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:56px;padding:8px 10px 8px 16px;border-bottom:1px solid var(--line)}
.mnp-art-h b{font-size:14px;font-weight:640;white-space:nowrap}
.mnp-art-b{flex:1;min-height:0;overflow-y:auto;padding:8px 8px 20px}
.mnp-art-b section{margin-bottom:10px}
.mnp-art-b h4{display:flex;align-items:center;gap:6px;margin:8px 8px 4px;font-size:11.5px;font-weight:650;color:var(--muted);text-transform:none}
.mnp-art-b h4 span{font-weight:500;opacity:.8}
.mnp-art-i{display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;border:0;border-radius:10px;background:none;color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.mnp-art-i:hover,.mnp-art-i:focus-visible{background:var(--hover);outline:none}
.mnp-art-ic{display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:8px;color:var(--accent);background:var(--accent-soft)}
.mnp-art-ic .i{width:15px;height:15px}
.mnp-art-ic.k-folder{color:#d97706;background:color-mix(in srgb,#d97706 12%,transparent)}
.mnp-art-ic.k-vault{color:#6366f1;background:color-mix(in srgb,#6366f1 12%,transparent)}
.mnp-art-img{flex:none;width:30px;height:30px;border-radius:8px;overflow:hidden;background:color-mix(in srgb,var(--fg) 6%,transparent)}
.mnp-art-img img{display:block;width:100%;height:100%;object-fit:cover}
.mnp-art-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.mnp-art-t b{font-size:13px;font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-art-t small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-art-none{margin:12px 10px;font-size:12.5px;line-height:1.5;color:var(--muted)}
.mnp-ascrim{display:none}
@media (max-width:1099px){
  .mnp.art-open{--aw:0px}
  .mnp-art{position:absolute;top:0;right:0;bottom:0;z-index:6;width:min(340px,90vw);background:var(--surface-0,var(--bg));transform:translateX(104%);
    transition:transform .25s var(--ease-out,ease-out);box-shadow:0 0 40px rgba(15,23,42,.18);visibility:visible!important}
  .mnp.art-open .mnp-art{transform:none}
  .mnp-ascrim{display:block;position:absolute;inset:0;z-index:5;background:var(--scrim,rgba(15,23,42,.3));opacity:0;pointer-events:none;transition:opacity .2s}
  .mnp.art-open .mnp-ascrim{opacity:1;pointer-events:auto}
}
.mnp-side{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line);background:color-mix(in srgb,var(--surface-1,var(--panel)) 60%,transparent)}
.mnp-brand{display:flex;align-items:center;gap:10px;padding:16px 14px 12px 16px}
.mnp-bt{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.2}
.mnp-bt b{font-size:15px;font-weight:680;letter-spacing:-.01em}.mnp-bt small{font-size:12px;color:var(--muted)}
.mnp-new{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;border:1px solid var(--line-strong);background:var(--surface-0,var(--bg));color:var(--fg);cursor:pointer;transition:background .15s,transform .15s}
.mnp-new:hover{background:var(--hover)}.mnp-new:active{transform:scale(.95)}
.mnp-new .i{width:17px;height:17px;stroke-width:2.1}
.mnp-fold{display:grid;place-items:center;width:34px;height:34px;padding:0;border-radius:10px;border:1px solid var(--line);background:var(--surface-0,var(--bg));
  color:var(--text-2,var(--fg));cursor:pointer;transition:background .15s,border-color .15s}
.mnp-fold:hover{background:var(--hover);border-color:var(--line-strong);color:var(--fg)}
.mnp-fold .i{width:17px;height:17px;stroke-width:1.9}
.mnp-newrow{display:flex;align-items:center;gap:8px;margin:0 12px 10px;padding:0 12px;height:38px;border-radius:10px;border:1px solid var(--line-strong);
  background:var(--surface-0,var(--bg));color:var(--fg);font:inherit;font-size:13.5px;font-weight:560;cursor:pointer;transition:background .15s,border-color .15s}
.mnp-newrow:hover{background:var(--hover)}
.mnp-newrow .i{width:16px;height:16px;stroke-width:2.1}
/* Wide screens: fold button where + was, New chat under the search, the header button only
   to bring a folded list back. Phones keep + in the list and the header button. */
@media (min-width:761px){
  .mnp-new{display:none!important}
  .mnp:not(.side-closed) .mnp-lists{display:none}
}
@media (max-width:760px){.mnp-fold,.mnp-newrow{display:none}}
.mnp-prefs{margin:8px 10px 6px;padding:9px 10px 10px;border:1px solid var(--line);border-radius:14px;background:var(--surface-0,var(--bg))}
.mnp-prefs-l{display:block;margin:0 2px 7px;font-size:11px;font-weight:650;letter-spacing:.02em;color:var(--muted)}
.mnp-prefs-r{display:flex;align-items:center;gap:6px}
.mnp-theme{display:inline-flex;flex:none;gap:2px;padding:3px;border-radius:10px;background:var(--seg-track,color-mix(in srgb,var(--fg) 6%,transparent))}
.mnp-theme button{display:grid;place-items:center;width:30px;height:28px;padding:0;border:0;border-radius:8px;background:none;color:var(--muted);cursor:pointer;transition:background .15s,color .15s}
.mnp-theme button .i{width:15px;height:15px}
.mnp-theme button:hover{color:var(--fg)}
.mnp-theme button.on{background:var(--seg-thumb,var(--surface-1,#fff));color:var(--fg);box-shadow:0 1px 2px rgba(15,23,42,.12)}
.mnp-bgbtn{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:34px;padding:0 8px 0 5px;border:1px solid var(--line);border-radius:10px;background:none;
  color:var(--fg);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s}
.mnp-bgbtn:hover{background:var(--hover);border-color:var(--line-strong)}
.mnp-bgbtn span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:left}
.mnp-bgbtn>.i{width:14px;height:14px;flex:none;color:var(--muted)}
.mnp-bgsw{--bgz:7px;display:inline-block;flex:none;width:24px;height:24px;border-radius:7px;border:1px solid var(--line-strong);background-color:var(--bg)}
.mnp-bgsw.big{--bgz:12px;width:100%;height:52px;border-radius:10px;filter:saturate(1.9) contrast(1.06)}
.mnp-bgsw:not(.big){filter:saturate(1.6)}
.mnp-sfoot{border-top:0!important;padding-top:2px!important}
.mnp-bgpop{position:fixed;z-index:120;padding:12px;border-radius:16px;background:var(--panel,var(--surface-1));border:1px solid var(--line-strong);
  box-shadow:0 24px 60px -20px rgba(15,23,42,.35),0 8px 20px -10px rgba(15,23,42,.18);animation:mnIn .16s var(--ease-out,ease-out) both}
.mnp-bgpop-h{display:block;margin:0 2px 10px;font-size:13px;font-weight:650}
.mnp-bgpop-g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.mnp-bgopt{display:flex;flex-direction:column;gap:5px;padding:4px 4px 6px;border:1.5px solid transparent;border-radius:13px;background:none;color:var(--text-2,var(--fg));
  font:inherit;font-size:12px;cursor:pointer;transition:border-color .15s,background .15s}
.mnp-bgopt:hover{background:var(--hover)}
.mnp-bgopt.on{border-color:var(--accent);color:var(--fg);font-weight:600}
/* Chat backgrounds: light and texture behind the conversation, at whispering strength
   (a little stronger on the dark theme, where faint colour disappears). */
.mnp,.mnp-bgpop{--bgk:1.8}
:root[data-theme=light] .mnp,:root[data-theme=light] .mnp-bgpop{--bgk:1}
.mnp-chat{background-color:var(--bg)}
.mnp[data-bg=glow] .mnp-chat,.mnp-bgsw[data-bg=glow]{background-image:
  radial-gradient(60% 50% at 12% -8%,color-mix(in srgb,var(--accent) calc(14% * var(--bgk,1)),transparent),transparent 70%),
  radial-gradient(50% 45% at 100% -6%,color-mix(in srgb,#6366f1 calc(11% * var(--bgk,1)),transparent),transparent 70%)}
.mnp[data-bg=aurora] .mnp-chat,.mnp-bgsw[data-bg=aurora]{background-image:
  radial-gradient(42% 36% at 18% 12%,color-mix(in srgb,var(--accent) calc(15% * var(--bgk,1)),transparent),transparent 70%),
  radial-gradient(36% 32% at 82% 8%,color-mix(in srgb,#8b5cf6 calc(13% * var(--bgk,1)),transparent),transparent 70%),
  radial-gradient(46% 40% at 64% 62%,color-mix(in srgb,#06b6d4 calc(8% * var(--bgk,1)),transparent),transparent 72%),
  radial-gradient(40% 36% at 8% 92%,color-mix(in srgb,#ec4899 calc(7% * var(--bgk,1)),transparent),transparent 72%)}
.mnp[data-bg=mesh] .mnp-chat,.mnp-bgsw[data-bg=mesh]{background-image:
  radial-gradient(55% 55% at 0% 0%,color-mix(in srgb,var(--accent) calc(12% * var(--bgk,1)),transparent),transparent 70%),
  radial-gradient(55% 55% at 100% 0%,color-mix(in srgb,#6366f1 calc(11% * var(--bgk,1)),transparent),transparent 70%),
  radial-gradient(55% 55% at 100% 100%,color-mix(in srgb,#f59e0b calc(8% * var(--bgk,1)),transparent),transparent 70%),
  radial-gradient(55% 55% at 0% 100%,color-mix(in srgb,#ec4899 calc(7% * var(--bgk,1)),transparent),transparent 70%)}
.mnp[data-bg=dusk] .mnp-chat,.mnp-bgsw[data-bg=dusk]{background-image:
  linear-gradient(160deg,color-mix(in srgb,var(--accent) calc(10% * var(--bgk,1)),transparent) 0%,transparent 45%,color-mix(in srgb,#8b5cf6 calc(9% * var(--bgk,1)),transparent) 100%)}
.mnp[data-bg=dawn] .mnp-chat,.mnp-bgsw[data-bg=dawn]{background-image:
  linear-gradient(180deg,color-mix(in srgb,#f59e0b calc(10% * var(--bgk,1)),transparent) 0%,color-mix(in srgb,#ec4899 calc(5% * var(--bgk,1)),transparent) 30%,transparent 62%)}
.mnp[data-bg=deep] .mnp-chat,.mnp-bgsw[data-bg=deep]{background-image:
  radial-gradient(70% 40% at 50% -10%,color-mix(in srgb,var(--accent) calc(9% * var(--bgk,1)),transparent),transparent 70%),
  linear-gradient(180deg,transparent 35%,color-mix(in srgb,#0ea5e9 calc(10% * var(--bgk,1)),transparent) 100%)}
.mnp[data-bg=dots] .mnp-chat,.mnp-bgsw[data-bg=dots]{--bgz:20px;background-image:radial-gradient(color-mix(in srgb,var(--fg) calc(14% * var(--bgk,1)),transparent) 1px,transparent 1.3px);background-size:var(--bgz) var(--bgz)}
.mnp[data-bg=grid] .mnp-chat,.mnp-bgsw[data-bg=grid]{--bgz:28px;background-image:
  linear-gradient(color-mix(in srgb,var(--fg) calc(6% * var(--bgk,1)),transparent) 1px,transparent 1px),
  linear-gradient(90deg,color-mix(in srgb,var(--fg) calc(6% * var(--bgk,1)),transparent) 1px,transparent 1px);background-size:var(--bgz) var(--bgz)}
.mnp-bgsw[data-bg=dots],.mnp-bgsw[data-bg=grid]{--bgz:7px}
.mnp-bgsw.big[data-bg=dots],.mnp-bgsw.big[data-bg=grid]{--bgz:12px}
.mnp[data-bg=lines] .mnp-chat,.mnp-bgsw[data-bg=lines]{background-image:repeating-linear-gradient(135deg,color-mix(in srgb,var(--fg) calc(5% * var(--bgk,1)),transparent) 0 1px,transparent 1px 15px)}
.mnp[data-bg=waves] .mnp-chat,.mnp-bgsw[data-bg=waves]{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120' viewBox='0 0 240 120' fill='none' stroke='%238a94a6' stroke-opacity='.22'%3E%3Cpath d='M0 20c40-16 80 16 120 0s80-16 120 0M0 50c40-16 80 16 120 0s80-16 120 0M0 80c40-16 80 16 120 0s80-16 120 0M0 110c40-16 80 16 120 0s80-16 120 0'/%3E%3C/svg%3E"),radial-gradient(60% 45% at 50% -10%,color-mix(in srgb,var(--accent) calc(8% * var(--bgk,1)),transparent),transparent 70%);background-size:240px 120px,auto}
.mnp-bgsw[data-bg=waves]{background-size:80px 40px,auto}
.mnp[data-bg=grain] .mnp-chat,.mnp-bgsw[data-bg=grain]{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),radial-gradient(60% 50% at 15% -8%,color-mix(in srgb,var(--accent) calc(10% * var(--bgk,1)),transparent),transparent 70%)}
.mnp-q{display:flex;align-items:center;gap:8px;margin:0 12px 8px;padding:0 10px;height:36px;border-radius:10px;border:1px solid var(--line);background:var(--surface-0,var(--bg))}
.mnp-q:focus-within{border-color:var(--accent-line,var(--accent))}
.mnp-q .i{width:15px;height:15px;flex:none;color:var(--muted)}
.mnp-q input{flex:1;min-width:0;border:0;outline:0;background:none;box-shadow:none;padding:0;font:inherit;font-size:13.5px;color:var(--fg)}
.mnp-list{flex:1;min-height:0;overflow-y:auto;padding:2px 8px 12px}
.mnp-g{padding:12px 8px 4px;font-size:11.5px;font-weight:600;color:var(--muted)}
.mnp-row{display:flex;align-items:center;gap:10px;padding:7px 4px 7px 8px;border-radius:10px;cursor:pointer;color:var(--fg);transition:background .12s}
.mnp-row:hover{background:var(--hover)}
.mnp-row.on{background:color-mix(in srgb,var(--accent) 11%,transparent)}
.mnp-row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.mnp-row-ic{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:8px;color:var(--muted);background:color-mix(in srgb,var(--fg) 5%,transparent)}
.mnp-row.on .mnp-row-ic{color:var(--accent);background:var(--accent-soft)}
.mnp-row-ic .i{width:15px;height:15px}
.mnp-row-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.mnp-row-t b{font-size:13.5px;font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-row-t small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-row-more{opacity:0}.mnp-row:hover .mnp-row-more,.mnp-row.on .mnp-row-more,.mnp-row-more:focus-visible{opacity:1}
/* Touch screens have no hover: the ⋯ is always there (iOS would spend the first tap on a hover). */
@media (hover:none){.mnp-row-more{opacity:.7}}
.mnp-none{margin:0;padding:18px 10px;font-size:13px;color:var(--muted);line-height:1.5}
.mnp-sfoot{padding:8px 10px 12px;border-top:1px solid var(--line)}
.mnp-set{display:flex;align-items:center;gap:10px;width:100%;height:38px;padding:0 10px;border:0;border-radius:10px;background:none;color:var(--text-2,var(--fg));font:inherit;font-size:13.5px;cursor:pointer;
  white-space:nowrap;text-align:left;outline:none;-webkit-tap-highlight-color:transparent}
.mnp-set span{overflow:hidden;text-overflow:ellipsis}
.mnp-set:focus-visible{box-shadow:inset 0 0 0 2px var(--accent-line,var(--accent))}
.mnp-set:hover{background:var(--hover);color:var(--fg)}.mnp-set .i{width:17px;height:17px}
.mnp-main{display:flex;flex-direction:column;min-width:0;min-height:0}
.mnp-head{display:flex;align-items:center;gap:6px;min-height:56px;padding:8px 14px 8px 20px;border-bottom:1px solid var(--line)}
.mnp-title{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.mnp-title b{font-size:14.5px;font-weight:640;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-title small{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-chat{flex:1;min-height:0;display:flex;flex-direction:column}
.mnp-chat[hidden],.mnp-act[hidden]{display:none}
.mnp-spin{display:block;width:15px;height:15px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 25%,transparent);border-top-color:var(--accent);animation:mnpSpin .8s linear infinite}
@keyframes mnpSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.mnp-spin{animation-duration:2.4s}}
.mnp-tag{display:inline-flex;align-items:center;height:17px;margin-right:6px;padding:0 6px;border-radius:99px;font-size:10.5px;font-weight:650;vertical-align:1px;
  color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line,transparent)}
.mnp-list mark{background:color-mix(in srgb,var(--accent) 26%,transparent);color:inherit;border-radius:3px;padding:0 1px}
.mnp-hit{display:flex;gap:6px;width:calc(100% - 12px);margin:0 0 2px 12px;padding:6px 10px 6px 30px;border:0;border-radius:9px;background:none;color:var(--text-2,var(--fg));
  font:inherit;font-size:12.5px;line-height:1.45;text-align:left;cursor:pointer;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.mnp-hit:hover,.mnp-hit:focus-visible{background:var(--hover);outline:none}
.mnp-hit em{font-style:normal;font-weight:620;color:var(--muted);margin-right:4px}
.mnp-hit-more{margin:0 0 6px 42px;font-size:11.5px;color:var(--muted)}
.mnp-act{flex:1;min-height:0;overflow-y:auto;padding:16px 20px 28px}
.mnp-ap{max-width:1100px;margin:0 auto}
.mnp-set.on{background:var(--accent-soft);color:var(--fg);font-weight:560}
.mnp-set.on .i{color:var(--accent)}
@media (max-width:760px){.mnp-act{padding:12px 12px 24px}}
.mnp-scrim{display:none}
.mnp-ren-l{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)}
.mnp-ren-l input{height:40px}
@media (max-width:900px){.mnp{--sw:240px}.mnp.side-closed{--sw:0px}}
@media (max-width:760px){
  .mnp,.mnp.side-closed{grid-template-columns:minmax(0,1fr)}
  .mnp.side-closed .mnp-side{visibility:visible}
  :root[data-page=assistant] .mnp{position:fixed;left:0;right:0;top:var(--mn-vvtop,0px);height:var(--mn-vvh,100dvh);z-index:60;
    padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);background:var(--bg)}
  :root[data-page=assistant] .mnp.kb{padding-bottom:0}
  .mnp-side{position:absolute;inset:0 auto 0 0;width:min(320px,86vw);z-index:5;background:var(--surface-0,var(--bg));transform:translateX(-104%);transition:transform .25s var(--ease-out,ease-out);box-shadow:0 0 40px rgba(15,23,42,.18)}
  .mnp.side-open .mnp-side{transform:none}
  .mnp-scrim{display:block;position:absolute;inset:0;z-index:4;background:var(--scrim,rgba(15,23,42,.3));opacity:0;pointer-events:none;transition:opacity .2s}
  .mnp.side-open .mnp-scrim{opacity:1;pointer-events:auto}
  .mnp-lists{width:40px;height:40px;border-radius:12px}
  .mnp-lists:active{transform:scale(.95);background:var(--hover)}
  .mnp-lists .i{width:20px;height:20px}
  .mnp-head{padding:6px 8px 6px 8px;min-height:50px}
}
`;
