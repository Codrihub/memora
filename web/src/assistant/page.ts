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
import { textSizeHTML, wireTextSize } from './textsize';
import { closePreview, openPreview } from './art';
import { noteSessions, onUnread, unreadOf } from './unread';


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
  // A chat seen here (or news from elsewhere) repaints its row's count.
  onUnread(() => paintList());
  root = el('div', 'mnp');
  root.innerHTML = `
    <aside class="mnp-side" id="mnpSide" aria-label="Chats">
      <div class="mnp-brand">${markHTML('md')}<div class="mnp-bt"><b>${A.MNEMO}</b><small>Your notes agent</small></div>
        <button type="button" class="mnp-manage" id="mnpManage" title="Select or clean up chats" aria-label="Select or clean up chats">${icon('more')}</button>
        <button type="button" class="mnp-new" id="mnpNew" title="New chat" aria-label="New chat">${icon('plus')}</button>
        <button type="button" class="mnp-fold" id="mnpFold" title="Hide the chat list" aria-label="Hide the chat list">${icon('sidebar')}</button></div>
      <label class="mnp-q">${icon('search')}<span class="sr-only">Search chats</span><input type="search" id="mnpQ" placeholder="Search everything said" autocomplete="off"></label>
      <button type="button" class="mnp-newrow" id="mnpNewRow">${icon('plus')}<span>New chat</span></button>
      <div class="mnp-selbar" id="mnpSelBar" hidden></div>
      <nav class="mnp-list" id="mnpList" aria-label="Chat list"></nav>
      <nav class="mnp-sfoot" aria-label="${A.MNEMO}">
        <button type="button" class="mnp-look-btn" id="mnpLook" title="Theme, chat background and text size" aria-haspopup="dialog">${icon('sun')}<span><b>Appearance</b><small id="mnpLookSub">Theme, background, text</small></span>${icon('chev-down')}</button>
        <button type="button" class="mnp-set" id="mnpActBtn" title="Everything ${A.MNEMO} did, and for whom">${icon('activity')}<span>Activity</span></button>
        <button type="button" class="mnp-set" id="mnpSet" title="Models, keys and instructions">${icon('settings')}<span>Settings</span></button>
        <button type="button" class="mnp-set" id="mnpHome" title="Back to Memora">${icon('overview')}<span>Memora</span></button>
      </nav>
    </aside>
    <div class="mnp-scrim" id="mnpScrim"></div>
    <main class="mnp-main">
      <header class="mnp-head">
        <button type="button" class="mnp-lists" id="mnpLists" aria-label="Show or hide the chat list" title="Chats" aria-controls="mnpSide">${icon('sidebar')}</button>
        <div class="mnp-title"><b id="mnpTitle">New chat</b><small id="mnpSub"></small></div>
        <button type="button" class="mn-ibtn mnp-fleet" id="mnpFleet" aria-pressed="false" aria-label="Fleeting chat" title="Fleeting chat: not kept, gone when you leave it">${icon('eye')}</button>
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
      // A fleeting chat is never listed, linked or remembered.
      if (!chat?.fleeting) {
        setMnemoChat(s.id);
        upsert(s);
      }
      paintHead();
    },
    onForget: (id) => {
      sessions = sessions.filter((x) => x.id !== id);
      paintList();
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
    // A page open beside the chat hides the list: close the page to get it back.
    if (document.documentElement.classList.contains('mn-pv-split') && !document.documentElement.classList.contains('mn-pv-roomy')) {
      closePreview();
      setPane('side', true);
      return;
    }
    if (isNarrow()) side(true);
    else setPane('side', root!.classList.contains('side-closed'));
  };
  root.querySelector<HTMLElement>('#mnpArtBtn')!.onclick = () => setPane('art', !root!.classList.contains('art-open'));
  root.querySelector<HTMLElement>('#mnpArtX')!.onclick = () => setPane('art', false);
  root.querySelector<HTMLElement>('#mnpAScrim')!.onclick = () => setPane('art', false);
  root.querySelector<HTMLElement>('#mnpArtB')!.addEventListener('click', (e) => {
    const pg = (e.target as HTMLElement).closest<HTMLElement>('[data-page-art]');
    if (pg) {
      const p = chatPages()[Number(pg.dataset.pageArt)];
      if (!p) return;
      if (isNarrow() || window.innerWidth < 1100) setPane('art', false);
      openPreview(p.card);
      return;
    }
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
  // Fleeting: on a new chat it turns the mode on or off; in a fleeting chat it leaves it
  // (deleted) for a new, kept chat.
  root.querySelector<HTMLElement>('#mnpFleet')!.onclick = () => {
    if (chat!.fleeting && chat!.session) {
      newChat();
      toast('Fleeting chat left and deleted', 'ok');
      return;
    }
    if (chat!.session) newChat();
    chat!.setFleeting(!chat!.fleeting);
    paintHead();
    chat!.focus();
  };
  // Wide screens: the chat list folds from its own corner; New chat sits under the search.
  root.querySelector<HTMLElement>('#mnpFold')!.onclick = () => setPane('side', false);
  root.querySelector<HTMLElement>('#mnpNewRow')!.onclick = () => newChat();
  root.querySelector<HTMLElement>('#mnpSet')!.onclick = () => openMnemoSettings();
  root.querySelector<HTMLElement>('#mnpHome')!.onclick = () => leave(true);
  root.querySelector<HTMLElement>('#mnpLook')!.onclick = (e) => lookMenu(e.currentTarget as HTMLElement);
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
  root.querySelector<HTMLElement>('#mnpManage')!.onclick = (e) => manageMenu(e.currentTarget as HTMLElement);
  root.querySelector<HTMLElement>('#mnpSelBar')!.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sel]');
    if (!b) return;
    const act = b.dataset.sel;
    if (act === 'cancel') return select(null);
    if (act === 'all') {
      const ids = visibleIds();
      const every = ids.length > 0 && ids.every((x) => picked!.has(x));
      picked = new Set(every ? [] : ids);
      return paintList();
    }
    if (act === 'delete') askDeleteMany([...(picked || [])]);
  };
  root.querySelector<HTMLElement>('#mnpList')!.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const more = t.closest<HTMLElement>('[data-more]');
    const row = t.closest<HTMLElement>('[data-id]');
    if (!row) return;
    const id = row.dataset.id!;
    if (picked) {
      e.stopPropagation();
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      paintList();
      return;
    }
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
  closeLook();
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

/** Appearance: theme, chat background and text size. A panel above the button on wide
 *  screens, a sheet from the bottom on phones. */
function lookMenu(at: HTMLElement): void {
  if (closeLook()) return;
  const cur = readBg();
  const sheet = isNarrow();
  const scrim = el('div', 'mnp-lookscrim' + (sheet ? ' dim' : ''));
  const pop = el('div', 'mnp-look' + (sheet ? ' sheet' : ''));
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Appearance');
  pop.innerHTML = `<div class="mnp-look-h"><b>Appearance</b><button type="button" class="mn-ibtn" data-look-x aria-label="Close" title="Close">${icon('close')}</button></div>
    <span class="mnp-look-l">Theme</span>
    <div class="mnp-theme" role="radiogroup" aria-label="Theme">${(['light', 'dark', 'system'] as ThemePref[])
      .map((t) => `<button type="button" role="radio" data-theme-pick="${t}">${icon(THEME_ICON[t])}<span>${THEME_LABEL[t]}</span></button>`)
      .join('')}</div>
    <span class="mnp-look-l">Chat background</span>
    <div class="mnp-bgpop-g">${BGS.map(
      (b) =>
        `<button type="button" class="mnp-bgopt${b.id === cur ? ' on' : ''}" data-pick-bg="${b.id}" aria-pressed="${b.id === cur}"><i class="mnp-bgsw big" data-bg="${b.id}"></i><span>${esc(
          b.label,
        )}</span></button>`,
    ).join('')}</div>
    <span class="mnp-look-l">Text size</span>
    <div class="mnp-look-fs">${textSizeHTML('look')}</div>`;
  document.body.append(scrim, pop);
  if (!sheet) {
    const r = at.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left)) + 'px';
    if (r.top > 420) pop.style.bottom = window.innerHeight - r.top + 8 + 'px';
    else pop.style.top = r.bottom + 8 + 'px';
  }
  at.setAttribute('aria-expanded', 'true');
  wireTextSize(pop.querySelector<HTMLElement>('.mnp-look-fs')!);
  pop.querySelectorAll<HTMLElement>('[data-theme-pick]').forEach((b) => {
    b.onclick = () => {
      setThemePref(b.dataset.themePick as ThemePref);
      paintPrefs();
    };
  });
  pop.querySelectorAll<HTMLElement>('[data-pick-bg]').forEach((b) => {
    b.onclick = () => setBg(b.dataset.pickBg as BgId);
  });
  pop.querySelector<HTMLElement>('[data-look-x]')!.onclick = () => closeLook();
  scrim.onclick = () => closeLook();
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      closeLook();
    }
  };
  document.addEventListener('keydown', key, true);
  lookOff = () => {
    document.removeEventListener('keydown', key, true);
    at.setAttribute('aria-expanded', 'false');
    pop.classList.remove('on');
    scrim.classList.remove('on');
    window.setTimeout(() => {
      pop.remove();
      scrim.remove();
    }, 200);
    at.focus({ preventScroll: true });
  };
  paintPrefs();
  void pop.offsetHeight;
  requestAnimationFrame(() => {
    pop.classList.add('on');
    scrim.classList.add('on');
  });
}

let lookOff: (() => void) | null = null;

/** Close the Appearance panel; true when it was open. */
function closeLook(): boolean {
  if (!lookOff) return false;
  const f = lookOff;
  lookOff = null;
  f();
  return true;
}

/** The theme switch and the background tiles show what is on now. */
function paintPrefs(): void {
  if (!root) return;
  const t = themePref();
  document.querySelectorAll<HTMLElement>('.mnp-look [data-theme-pick]').forEach((b) => {
    const on = b.dataset.themePick === t;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  const bg = readBg();
  root.dataset.bg = bg;
  const sub = root.querySelector('#mnpLookSub');
  if (sub) sub.textContent = `${THEME_LABEL[t]} · ${BGS.find((b) => b.id === bg)?.label || 'Glow'} background`;
  document.querySelectorAll<HTMLElement>('.mnp-look [data-pick-bg]').forEach((x) => {
    const on = x.dataset.pickBg === bg;
    x.classList.toggle('on', on);
    x.setAttribute('aria-pressed', String(on));
  });
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
/** The pages (HTML and SVG files) in the chat on screen: the latest version of each. */
function chatPages(): { card: HTMLElement; versions: number }[] {
  const cards = Array.from(root?.querySelectorAll<HTMLElement>('#mnpChat .mn-log .mn-file') || []);
  const last = new Map<string, { card: HTMLElement; versions: number }>();
  for (const c of cards) {
    const k = `${c.dataset.art}\u0000${c.dataset.title}`;
    last.set(k, { card: c, versions: (last.get(k)?.versions || 0) + 1 });
  }
  return [...last.values()].reverse();
}

function paintArt(): void {
  if (!root || !chat) return;
  const items = chat.artifacts();
  const pages = chatPages();
  const n = root.querySelector<HTMLElement>('.mnp-artn')!;
  const total = items.length + pages.length;
  n.hidden = !total;
  n.textContent = String(total);
  const body = root.querySelector<HTMLElement>('#mnpArtB')!;
  if (!total) {
    body.innerHTML = `<p class="mnp-art-none">Pages ${A.MNEMO} writes, and the notes, folders and images this chat attaches, reads, changes or shows you collect here.</p>`;
    return;
  }
  const pageHTML = pages.length
    ? `<section><h4>Pages<span>${pages.length}</span></h4>${pages
        .map(
          (p, i) =>
            `<button type="button" class="mnp-art-i" data-page-art="${i}" title="${attr(p.card.dataset.title || 'Page')}"><span class="mnp-art-ic k-page">${icon('code')}</span><span class="mnp-art-t"><b>${esc(
              p.card.dataset.title || 'Page',
            )}</b><small>${p.card.dataset.art === 'svg' ? 'SVG image' : 'HTML page'}${p.versions > 1 ? ` · ${p.versions} versions` : ''}</small></span></button>`,
        )
        .join('')}</section>`
    : '';
  body.innerHTML = pageHTML + ART_GROUPS.map((g) => {
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
    noteSessions(sessions);
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
  noteSessions(sessions);
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
  paintSelBar();
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
    const news = s.running || s.id === cur ? 0 : unreadOf(s);
    const sel = picked ? picked.has(s.id) : false;
    html += `<div class="mnp-row${s.id === cur && !picked ? ' on' : ''}${s.running ? ' run' : ''}${news ? ' unread' : ''}${sel ? ' sel' : ''}" data-id="${attr(s.id)}" role="${picked ? 'checkbox' : 'button'}" tabindex="0"${
      picked ? ` aria-checked="${sel}"` : ` aria-current="${s.id === cur}"`
    }>
      ${picked ? `<span class="mnp-check" aria-hidden="true">${sel ? icon('check') : ''}</span>` : ''}<span class="mnp-row-ic">${s.running ? `<i class="mnp-spin" title="${A.MNEMO} is working on this"></i>` : icon(ic)}</span>
      <span class="mnp-row-t"><b>${titleHTML(s.title)}</b><small>${esc(A.scopeLabel(s.scope))} · ${esc(relTs(s.updated_at))}</small></span>
      ${news ? `<span class="mnp-newn" title="${news} new message${news === 1 ? '' : 's'}" aria-label="${news} new message${news === 1 ? '' : 's'}">${news > 99 ? '99+' : news}</span>` : ''}
      ${picked ? '' : `<button type="button" class="mn-ibtn mnp-row-more" data-more aria-label="Chat actions">${icon('more')}</button>`}</div>`;
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
  const fleet = !!chat?.fleeting;
  root.classList.toggle('fleeting', fleet);
  const fb = root.querySelector<HTMLElement>('#mnpFleet')!;
  fb.setAttribute('aria-pressed', String(fleet));
  fb.title = fleet ? (s ? 'Leave this fleeting chat (it is deleted)' : 'Turn fleeting off') : 'Fleeting chat: not kept, gone when you leave it';
  if (fleet) {
    root.querySelector('#mnpTitle')!.textContent = 'Fleeting chat';
    root.querySelector('#mnpTitle')!.classList.remove('task');
    root.querySelector('#mnpSub')!.textContent = 'Not kept · gone when you leave it';
    return;
  }
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
      { label: 'Select chats', icon: icon('check', 'vx-i'), run: () => select(new Set()) },
      { label: 'Clean up chats…', icon: icon('trash', 'vx-i'), run: () => cleanUp() },
      { label: `${A.MNEMO} activity`, icon: icon('activity', 'vx-i'), run: () => showActivity(true) },
      { label: 'Appearance', icon: icon('sun', 'vx-i'), run: () => lookMenu(at) },
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
      { label: 'Select', icon: icon('check', 'vx-i'), run: () => select(new Set([s.id])) },
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

// ---- many chats at once: pick them in the list, or clean up by age, or all ----

/** The chats picked in the list while selecting; null when not selecting. */
let picked: Set<string> | null = null;

function select(start: Set<string> | null): void {
  picked = start;
  root?.classList.toggle('selecting', !!start);
  if (start) {
    if (isNarrow()) root?.classList.add('side-open');
    else setPane('side', true);
  }
  paintList();
}

function visibleIds(): string[] {
  return Array.from(root?.querySelectorAll<HTMLElement>('#mnpList .mnp-row[data-id]') || []).map((r) => r.dataset.id!);
}

function paintSelBar(): void {
  const bar = root?.querySelector<HTMLElement>('#mnpSelBar');
  if (!bar) return;
  bar.hidden = !picked;
  if (!picked) return;
  const n = picked.size;
  bar.innerHTML = `<span class="mnp-seln">${n ? `${n} selected` : 'Pick chats'}</span>
    <button type="button" class="mnp-selb" data-sel="all">All</button>
    <button type="button" class="mnp-selb danger" data-sel="delete"${n ? '' : ' disabled'}>${icon('trash')}<span>Delete</span></button>
    <button type="button" class="mn-ibtn" data-sel="cancel" aria-label="Stop selecting" title="Done">${icon('close')}</button>`;
}

/** The ⋯ beside New chat: pick chats, clean up old ones, or delete them all. */
function manageMenu(at: HTMLElement): void {
  openMenu(
    [
      { label: 'Select chats', icon: icon('check', 'vx-i'), run: () => select(new Set()) },
      { label: 'Clean up chats…', icon: icon('refresh', 'vx-i'), run: () => cleanUp() },
      { sep: true, label: '' },
      { label: 'Delete all chats…', icon: icon('trash', 'vx-i'), danger: true, disabled: !sessions.length, run: () => cleanUp(true) },
    ],
    at,
  );
}

function afterPrune(r: { deleted: number; skipped: number }): void {
  const cur = chat?.session?.id;
  void refreshList().then(() => {
    if (cur && !sessions.some((x) => x.id === cur)) newChat();
    paintList();
  });
  Modal.close();
  toast(
    `${r.deleted} chat${r.deleted === 1 ? '' : 's'} deleted${r.skipped ? `, ${r.skipped} still answering left as they are` : ''}`,
    r.deleted ? 'ok' : 'info',
  );
}

function askDeleteMany(ids: string[]): void {
  if (!ids.length) return;
  Modal.confirm(
    `Delete ${ids.length} chat${ids.length === 1 ? '' : 's'}?`,
    'They and their messages are removed for good. Your notes are not touched.',
    `Delete ${ids.length}`,
    async () => {
      try {
        afterPrune(await A.pruneSessions({ ids }));
        select(null);
      } catch (e) {
        fail(e);
      }
    },
  );
}

/** Delete chats nobody has touched for a while, or all of them (pinned ones kept unless asked). */
function cleanUp(all = false): void {
  const DAY = 86_400;
  const now = Date.now() / 1000;
  const opts = [
    { v: '7', label: 'Older than 7 days' },
    { v: '30', label: 'Older than 30 days' },
    { v: '90', label: 'Older than 90 days' },
    { v: 'all', label: 'All chats' },
  ];
  const body = el(
    'div',
    'mnp-clean',
    `<div class="mnp-clean-o" role="radiogroup" aria-label="Which chats">${opts
      .map(
        (o) =>
          `<label class="mnp-clean-r"><input type="radio" name="mnpClean" value="${o.v}"${(all ? o.v === 'all' : o.v === '30') ? ' checked' : ''}><span>${o.label}</span><em data-n="${o.v}"></em></label>`,
      )
      .join('')}</div>
    <label class="mnp-clean-k"><input type="checkbox" checked data-keep><span>Keep pinned chats</span></label>
    <p class="mnp-clean-p">Deleted chats and their messages are gone for good. Your notes are not touched, and a chat that is answering right now is left alone.</p>`,
  );
  const count = (v: string, keep: boolean): number =>
    sessions.filter((s) => !(keep && s.pinned) && !s.running && (v === 'all' || s.updated_at < now - Number(v) * DAY)).length;
  const paint = (): void => {
    const keep = body.querySelector<HTMLInputElement>('[data-keep]')!.checked;
    body.querySelectorAll<HTMLElement>('[data-n]').forEach((e) => (e.textContent = String(count(e.dataset.n!, keep))));
    const v = body.querySelector<HTMLInputElement>('input[name=mnpClean]:checked')!.value;
    const n = count(v, keep);
    const go = document.querySelector<HTMLButtonElement>('.mnp-clean-go');
    if (go) {
      go.disabled = !n;
      go.textContent = n ? `Delete ${n} chat${n === 1 ? '' : 's'}` : 'Nothing to delete';
    }
  };
  body.onchange = paint;
  Modal.open({
    title: all ? 'Delete all chats' : 'Clean up chats',
    sub: `${sessions.length} chat${sessions.length === 1 ? '' : 's'} in ${A.MNEMO}`,
    body,
    onOpen: () => paint(),
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'Delete',
        cls: 'danger mnp-clean-go',
        run: async () => {
          const v = body.querySelector<HTMLInputElement>('input[name=mnpClean]:checked')!.value;
          const keep = body.querySelector<HTMLInputElement>('[data-keep]')!.checked;
          try {
            afterPrune(await A.pruneSessions(v === 'all' ? { all: true, keep_pinned: keep } : { older_than_days: Number(v), keep_pinned: keep }));
          } catch (e) {
            fail(e);
          }
        },
      },
    ],
  });
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
/* A page open beside the chat: the chat list and "In this chat" fold away so the chat keeps
   its room (the list comes back when the divider leaves room for it). */
:root.mn-pv-split:not(.mn-pv-roomy) .mnp{--sw:0px}
:root.mn-pv-split:not(.mn-pv-roomy) .mnp-side{visibility:hidden}
:root.mn-pv-split .mnp{--aw:0px}
:root.mn-pv-split .mnp-art,:root.mn-pv-split .mnp-ascrim{visibility:hidden}
:root.mn-pv-split:not(.mn-pv-roomy) .mnp .mnp-lists{display:inline-grid}
.mnp-hsep{width:1px;height:20px;margin:0 4px;background:var(--line)}
.mnp-close .i{width:18px;height:18px;stroke-width:2}
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
.mnp-fold,.mnp-manage{display:grid;place-items:center;width:34px;height:34px;padding:0;border-radius:10px;border:1px solid var(--line);background:var(--surface-0,var(--bg));
  color:var(--text-2,var(--fg));cursor:pointer;transition:background .15s,border-color .15s}
.mnp-fold:hover,.mnp-manage:hover{background:var(--hover);border-color:var(--line-strong);color:var(--fg)}
.mnp-fold .i,.mnp-manage .i{width:17px;height:17px;stroke-width:1.9}
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
.mnp-theme{display:flex;gap:2px;padding:3px;border-radius:11px;background:var(--seg-track,color-mix(in srgb,var(--fg) 6%,transparent))}
.mnp-theme button{flex:1 1 0;display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;height:34px;padding:0 6px;border:0;border-radius:8px;background:none;color:var(--muted);
  font:inherit;font-size:13px;cursor:pointer;transition:background .15s,color .15s}
.mnp-theme button .i{width:15px;height:15px;flex:none}
.mnp-theme button:hover{color:var(--fg)}
.mnp-theme button.on{background:var(--seg-thumb,var(--surface-1,#fff));color:var(--fg);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.12)}
.mnp-bgsw{--bgz:7px;display:inline-block;flex:none;width:24px;height:24px;border-radius:7px;border:1px solid var(--line-strong);background-color:var(--bg)}
.mnp-bgsw.big{--bgz:12px;width:100%;height:46px;border-radius:10px;filter:saturate(1.9) contrast(1.06)}
/* The chat list's foot: Appearance as one wide button, then Activity, Settings and Memora. */
.mnp-sfoot{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:8px 8px 10px;border-top:1px solid var(--line)}
.mnp-look-btn{grid-column:1/-1;display:flex;align-items:center;gap:10px;width:100%;height:46px;margin-bottom:4px;padding:0 12px;border:1px solid var(--line);border-radius:12px;
  background:var(--surface-1,var(--panel));color:var(--fg);font:inherit;text-align:left;cursor:pointer;transition:background .15s,border-color .15s;-webkit-tap-highlight-color:transparent}
.mnp-look-btn:hover,.mnp-look-btn[aria-expanded=true]{background:var(--hover);border-color:var(--line-strong)}
.mnp-look-btn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.mnp-look-btn>.i{width:18px;height:18px;flex:none;color:var(--muted)}
.mnp-look-btn>.i:last-child{width:15px;height:15px;transform:rotate(180deg);transition:transform .2s}
.mnp-look-btn[aria-expanded=true]>.i:last-child{transform:none}
.mnp-look-btn>span{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.mnp-look-btn b{font-size:13.5px;font-weight:600}
.mnp-look-btn small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-sfoot .mnp-set{flex-direction:column;justify-content:center;gap:4px;height:54px;padding:0 2px;font-size:11.5px;font-weight:550;text-align:center;border-radius:12px;color:var(--muted)}
.mnp-sfoot .mnp-set .i{width:19px;height:19px}
.mnp-sfoot .mnp-set span{max-width:100%;line-height:1.2}
.mnp-sfoot .mnp-set:hover{color:var(--fg)}
/* Appearance: a panel above its button, a bottom sheet on phones. */
.mnp-lookscrim{position:fixed;inset:0;z-index:119;background:transparent;opacity:0;transition:opacity .2s}
.mnp-look{position:fixed;z-index:120;display:flex;flex-direction:column;padding:6px 14px 14px;border-radius:16px;background:var(--panel,var(--surface-1));border:1px solid var(--line-strong);
  box-shadow:0 24px 60px -20px rgba(15,23,42,.35),0 8px 20px -10px rgba(15,23,42,.18);opacity:0;transform:translateY(8px);transition:opacity .18s var(--ease-out,ease-out),transform .18s var(--ease-out,ease-out)}
.mnp-look.on{opacity:1;transform:none}
.mnp-look-h{display:flex;align-items:center;justify-content:space-between;min-height:42px;margin:0 -6px 0 2px}
.mnp-look-h b{font-size:14.5px;font-weight:650}
.mnp-look-l{display:block;margin:12px 2px 7px;font-size:11.5px;font-weight:650;letter-spacing:.02em;color:var(--muted)}
.mnp-look-h+.mnp-look-l{margin-top:4px}
.mnp-look-fs .mn-fs{display:flex;width:100%}
.mnp-look-fs .mn-fs button{flex:1 1 0}
.mnp-look.sheet{left:0;right:0;bottom:0;width:auto;max-height:86dvh;overflow:auto;padding:4px 16px calc(16px + env(safe-area-inset-bottom,0px));border-bottom:0;border-radius:20px 20px 0 0;transform:translateY(100%);
  transition:transform .28s var(--ease-out,ease-out)}
.mnp-look.sheet.on{transform:none;opacity:1}
.mnp-look.sheet::before{content:"";display:block;width:36px;height:4px;margin:6px auto 2px;border-radius:99px;background:var(--line-strong)}
.mnp-lookscrim.dim{background:var(--scrim,rgba(15,23,42,.35))}
.mnp-lookscrim.on{opacity:1}
.mnp-look.sheet .mnp-theme button{height:42px;font-size:14px}
.mnp-look.sheet .mn-fs button{height:40px}
@media (prefers-reduced-motion:reduce){.mnp-look,.mnp-look.sheet{transition:none}}
.mnp-bgpop-g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.mnp-bgopt{display:flex;flex-direction:column;gap:5px;padding:4px 4px 6px;border:1.5px solid transparent;border-radius:13px;background:none;color:var(--text-2,var(--fg));
  font:inherit;font-size:12px;cursor:pointer;transition:border-color .15s,background .15s}
.mnp-bgopt:hover{background:var(--hover)}
.mnp-bgopt.on{border-color:var(--accent);color:var(--fg);font-weight:600}
/* Chat backgrounds: light and texture behind the conversation, at whispering strength
   (a little stronger on the dark theme, where faint colour disappears). */
.mnp,.mnp-look{--bgk:1.8}
:root[data-theme=light] .mnp,:root[data-theme=light] .mnp-look{--bgk:1}
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
.mnp-row.unread .mnp-row-t b{font-weight:700;color:var(--fg)}
.mnp-selbar{display:flex;align-items:center;gap:6px;margin:4px 10px 6px;padding:6px 6px 6px 12px;border-radius:12px;border:1px solid var(--accent-line,var(--line-strong));background:var(--accent-soft,var(--hover))}
.mnp-selbar[hidden]{display:none}
.mnp-seln{flex:1;min-width:0;font-size:12.5px;font-weight:650}
.mnp-selb{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border-radius:9px;border:1px solid var(--line);background:var(--surface-1,var(--panel));color:var(--fg);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.mnp-selb .i{width:14px;height:14px}
.mnp-selb.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 35%,transparent)}
.mnp-selb.danger:not(:disabled):hover{background:var(--danger-soft,var(--hover))}
.mnp-selb:disabled{opacity:.45;cursor:default}
.mnp-check{flex:none;display:grid;place-items:center;width:18px;height:18px;border-radius:6px;border:1.5px solid var(--line-strong);color:#fff}
.mnp-check .i{width:12px;height:12px;stroke-width:3}
.mnp-row.sel{background:var(--accent-soft,var(--hover))}
.mnp-row.sel .mnp-check{background:var(--accent);border-color:var(--accent)}
.mnp.selecting .mnp-row-ic{display:none}
.mnp-fleet[aria-pressed=true]{background:color-mix(in srgb,#8b5cf6 16%,transparent);color:#8b5cf6;box-shadow:inset 0 0 0 1px color-mix(in srgb,#8b5cf6 45%,transparent)}
.mnp.fleeting .mnp-head{background:linear-gradient(90deg,color-mix(in srgb,#8b5cf6 7%,transparent),transparent 60%)}
.mnp.fleeting #mnpTitle{color:#8b5cf6}
.mnp-art-ic.k-page{background:linear-gradient(135deg,#14b8a6,#4f46e5);color:#fff}
.mnp-clean-o{display:flex;flex-direction:column;gap:6px}
.mnp-clean-r{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;cursor:pointer}
.mnp-clean-r:has(input:checked){border-color:var(--accent);background:var(--accent-soft,transparent)}
.mnp-clean-r span{flex:1}
.mnp-clean-r em{font-style:normal;font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--muted)}
.mnp-clean-k{display:flex;align-items:center;gap:10px;margin:12px 2px 0;font-size:13.5px;cursor:pointer}
.mnp-clean-p{margin:10px 2px 0;font-size:12.5px;line-height:1.5;color:var(--muted)}
.mnp-newn{flex:none;display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--accent);color:var(--accent-fg,#fff);
  font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
.mnp-row.unread:hover .mnp-newn,.mnp-row.unread:focus-within .mnp-newn{display:none}
.mnp-row-t small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-row-more{opacity:0}.mnp-row:hover .mnp-row-more,.mnp-row.on .mnp-row-more,.mnp-row-more:focus-visible{opacity:1}
/* Touch screens have no hover: the ⋯ is always there (iOS would spend the first tap on a hover). */
@media (hover:none){.mnp-row-more{opacity:.7}}
.mnp-none{margin:0;padding:18px 10px;font-size:13px;color:var(--muted);line-height:1.5}
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
/* On the Mnemo page notices come in at the top right, under the header, clear of Send and Stop. */
:root[data-page=assistant] .toasts{top:calc(66px + env(safe-area-inset-top,0px));bottom:auto;right:16px;left:auto;width:min(360px,calc(100vw - 24px));max-height:calc(100dvh - 160px)}
@media (max-width:760px){:root[data-page=assistant] .toasts{top:calc(58px + env(safe-area-inset-top,0px));left:12px;right:12px;width:auto;bottom:auto}}
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
