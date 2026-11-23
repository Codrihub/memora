// The Mnemo page (/mnemo): the chat list beside the open chat. The page is built once and
// kept, so a reply keeps streaming while you look at other pages.

import { apiPost } from '../api';
import { $, attr, el, esc, useStyles } from '../dom';
import { relTs } from '../format';
import { Modal } from '../modal';
import { hooks } from '../hooks';
import { closeMnemoAll, mnemoAllOn, onNavigate, openMnemoAll, setMnemoChat, takeMnemoChat } from '../router';
import { setThemePref, THEME_ICON, THEME_LABEL, themePref, type ThemePref } from '../theme';
import { state, type Page } from '../state';
import { notify, toast } from '../toast';
import { icon } from '../ui/icons';
import { t, tn } from '../i18n';
import { openMenu } from '../vault/ui';
import { VAULT_CSS } from '../vault/styles';
import * as A from './api';
import { leaveAgentActivity, mountAgentActivity } from '../views/activity-agent';
import { useAgentPageStyles } from '../views/agent-page';
import { useActivityStyles } from '../control/activity';
import { ChatView, chatWidth, openMnemoSettings, openShown, setChatWidth, type Artifact, type ChatWidth } from './chat';
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
let pendingWith: { scope?: string; text?: string; view?: 'activity'; send?: boolean } | null = null;
/** Mnemo's activity is on screen instead of the chat. */
let showingActivity = false;

/** Open the Mnemo page on chat `id` ('' = a new chat, null = the chat you were in). */
export function openOnPage(id: string | null, extra?: { scope?: string; text?: string; view?: 'activity'; send?: boolean }): void {
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
  // Read before anything redraws the header (which keeps the address in step).
  const fleetAsked = location.hash === FLEET_HASH;
  await refreshList();
  watchRunning();
  paintPrefs();
  const want = pendingOpen;
  const extra = pendingWith;
  pendingOpen = null;
  pendingWith = null;
  const fresh = arriving;
  arriving = false;
  // /mnemo/chats: the list of every chat over the page.
  showAll(mnemoAllOn(), false);
  if (mnemoAllOn()) {
    if (!chat!.session && fresh) newChat();
    return;
  }
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
  // /mnemo#fleeting-chat: a shortcut straight to a new fleeting chat.
  openFleetingFromHash(fleetAsked);
  if (fresh || extra) showActivity(extra?.view === 'activity');
  if (extra?.scope) chat!.attachScope(extra.scope);
  if (extra?.text) chat!.prefill(extra.text, !!extra.send);
  paintHead();
  void A.loadState(true).catch(() => undefined);
  if (window.matchMedia('(min-width: 761px)').matches) chat!.focus();
  fitViewport();
}

const FLEET_HASH = '#fleeting-chat';

/** The address says #fleeting-chat: start a new fleeting chat (unless one is open already). */
function openFleetingFromHash(asked = location.hash === FLEET_HASH): void {
  if (!chat || !asked || chat.fleeting) return;
  if (chat.session) newChat();
  chat.setFleeting(true);
  paintHead();
}

/** Keep the address in step: #fleeting-chat while a fleeting chat is open, nothing otherwise. */
function syncFleetHash(): void {
  // Only on Mnemo's own page: the chat lives on (and repaints) after leaving it, and the
  // address of another page must never pick up the mark.
  if (!chat || !root?.isConnected || !location.pathname.startsWith('/mnemo')) return;
  const want = chat.fleeting;
  const has = location.hash === FLEET_HASH;
  if (want === has) return;
  history.replaceState(history.state, '', location.pathname + location.search + (want ? FLEET_HASH : ''));
}

function build(): void {
  // A chat seen here (or news from elsewhere) repaints its row's count.
  onUnread(() => paintList());
  root = el('div', 'mnp');
  root.innerHTML = `
    <aside class="mnp-side" id="mnpSide" aria-label="${t('Chats')}">
      <nav class="mnp-rail" aria-label="${A.MNEMO}">
        <span class="mnp-rail-mark" title="${t('{mnemo}, your notes agent', { mnemo: A.MNEMO })}">${markHTML('sm')}</span>
        <button type="button" class="mnp-rb-new" id="mnpNewRow" title="${t('New chat')}" aria-label="${t('New chat')}">${icon('plus')}</button>
        <button type="button" class="mnp-rb" id="mnpSearchBtn" title="${t('Search chats')}" aria-label="${t('Search chats')}">${icon('search')}</button>
        <button type="button" class="mnp-rb" id="mnpAllBtn" title="${t('All chats: pinned, recent and archived')}" aria-label="${t('All chats')}">${icon('chat')}</button>
        <button type="button" class="mnp-rb" id="mnpActBtn" title="${t('Everything {mnemo} did, and for whom', { mnemo: A.MNEMO })}" aria-label="${t('Activity')}">${icon('activity')}</button>
        <span class="mnp-grow"></span>
        <button type="button" class="mnp-rb mnp-look-btn" id="mnpLook" title="${t('Appearance: theme, background, text size and width')}" aria-label="${t('Appearance')}" aria-haspopup="dialog">${icon('palette')}<i class="mnp-bgsw mnp-look-sw" id="mnpLookSw" hidden aria-hidden="true"></i><small id="mnpLookSub" hidden></small></button>
        <button type="button" class="mnp-rb" id="mnpSet" title="${t('Models, keys and instructions')}" aria-label="${t('Settings')}">${icon('settings')}</button>
        <button type="button" class="mnp-rb" id="mnpHome" title="${t('Back to Memora')}" aria-label="${t('Back to Memora')}">${icon('overview')}</button>
        <button type="button" class="mnp-rb mnp-fold" id="mnpFold" title="${t('Hide the chat list')}" aria-label="${t('Hide the chat list')}">${icon('sidebar')}</button>
      </nav>
      <div class="mnp-panel">
        <div class="mnp-ph"><b>${t('Chats')}</b><small id="mnpCount"></small><span class="mnp-grow"></span>
          <button type="button" class="mnp-manage" id="mnpManage" title="${t('Select or clean up chats')}" aria-label="${t('Select or clean up chats')}">${icon('more')}</button>
          <button type="button" class="mnp-new" id="mnpNew" title="${t('New chat')}" aria-label="${t('New chat')}">${icon('plus')}</button>
          <button type="button" class="mnp-sidex" id="mnpSideX" title="${t('Close')}" aria-label="${t('Close')}">${icon('close')}</button></div>
        <label class="mnp-q">${icon('search')}<span class="sr-only">${t('Search chats')}</span><input type="search" id="mnpQ" placeholder="${t('Search')}" autocomplete="off"></label>
        <div class="mnp-chips" id="mnpChips" role="tablist" aria-label="${t('Show')}"></div>
        <div class="mnp-selbar" id="mnpSelBar" hidden></div>
        <nav class="mnp-list" id="mnpList" aria-label="${t('Chat list')}"></nav>
      </div>
    </aside>
    <div class="mnp-scrim" id="mnpScrim"></div>
    <main class="mnp-main">
      <header class="mnp-head">
        <button type="button" class="mnp-lists" id="mnpLists" aria-label="${t('Show or hide the chat list')}" title="${t('Chats')}" aria-controls="mnpSide">${icon('sidebar')}</button>
        <div class="mnp-title"><b id="mnpTitle">${t('New chat')}</b><small id="mnpSub"></small></div>
        <button type="button" class="mn-ibtn mnp-fleet" id="mnpFleet" aria-pressed="false" aria-label="${t('Fleeting chat')}" title="${t('Fleeting chat: not kept, gone when you leave it')}">${icon('incognito')}</button>
        <button type="button" class="mn-ibtn" id="mnpNew2" aria-label="${t('New chat')}" title="${t('New chat')}">${icon('plus')}</button>
        <button type="button" class="mn-ibtn mnp-agbtn" id="mnpAgBtn" aria-label="${t('Agents in this chat')}" title="${t('Agents')}" aria-controls="mnpAgents">${icon(
          'agents',
        )}<span class="mnp-agn" hidden></span></button>
        <button type="button" class="mn-ibtn mnp-artbtn" id="mnpArtBtn" aria-label="${t('Notes, folders and images in this chat')}" title="${t('In this chat')}" aria-controls="mnpArt">${icon(
          'sidebar',
        )}<span class="mnp-artn" hidden></span></button>
        <button type="button" class="mn-ibtn" id="mnpMore" aria-label="${t('Chat actions')}" title="${t('More')}">${icon('more')}</button>
        <span class="mnp-hsep" aria-hidden="true"></span>
        <button type="button" class="mn-ibtn mnp-close" id="mnpClose" aria-label="${t('Close {mnemo}', { mnemo: A.MNEMO })}" title="${t('Close {mnemo} (Esc)', { mnemo: A.MNEMO })}">${icon('close')}</button>
      </header>
      <div class="mnp-chat" id="mnpChat"></div>
      <div class="mnp-act" id="mnpAct" hidden><div class="ap mnp-ap"></div></div>
    </main>
    <aside class="mnp-art" id="mnpArt" aria-label="${t('In this chat')}">
      <div class="mnp-art-h"><b>${t('In this chat')}</b><button type="button" class="mn-ibtn" id="mnpArtX" aria-label="${t('Close')}" title="${t('Close')}">${icon('close')}</button></div>
      <div class="mnp-art-b" id="mnpArtB"></div>
    </aside>
    <aside class="mnp-agp" id="mnpAgents" aria-label="${t('Agents')}">
      <div class="mnp-art-h"><b>${t('Agents')}</b><small id="mnpAgSub"></small><span class="mnp-grow"></span><button type="button" class="mn-ibtn" id="mnpAgX" aria-label="${t('Close')}" title="${t('Close')}">${icon('close')}</button></div>
      <div class="mnp-agp-b" id="mnpAgB"></div>
    </aside>
    <div class="mnp-ascrim" id="mnpAScrim"></div>
    <section class="mnp-all" id="mnpAll" aria-label="${t('All chats')}" hidden>
      <div class="mnp-all-in">
        <header class="mnp-all-h"><button type="button" class="mn-ibtn" id="mnpAllBack" aria-label="${t('Back to the chat')}" title="${t('Back')}">${icon('chev-left')}</button><b>${t('All chats')}</b>
          <span class="mnp-grow"></span><button type="button" class="mnp-selb" id="mnpAllSel">${icon('check')}<span>${t('Select')}</span></button></header>
        <label class="mnp-q mnp-all-q">${icon('search')}<span class="sr-only">${t('Search chats')}</span><input type="search" id="mnpAllQ" placeholder="${t('Search chats')}" autocomplete="off"></label>
        <div class="mnp-selbar mnp-all-bar" id="mnpAllBar" hidden></div>
        <div class="mnp-all-list" id="mnpAllList"></div>
      </div>
    </section>
    <div class="mnp-grip" data-g="side" role="separator" aria-orientation="vertical" aria-label="${t('Resize the chat list')}" tabindex="0" title="${t('Drag to resize · double-click to reset')}"></div>
    <div class="mnp-grip" data-g="right" role="separator" aria-orientation="vertical" aria-label="${t('Resize the side panel')}" tabindex="0" title="${t('Drag to resize · double-click to reset')}"></div>`;
  wireGrips(root);
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
    onAgents: () => paintAgents(),
    openAgents: () => setPane('agents', true),
    agentsOpen: () => !!root?.classList.contains('ag-open'),
    closeAgents: () => setPane('agents', false),
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
  window.addEventListener('hashchange', () => {
    if (root?.isConnected) openFleetingFromHash();
  });
  // One layout on every screen: the header keeps New chat, In this chat, More and Close; the
  // row under it has the model (left) and Fleeting (right, new chats only); Agents sits under
  // the message box with the context meter.
  chat.topRightEl.append(root.querySelector('#mnpFleet')!);
  chat.agentsSlotEl.append(root.querySelector('#mnpAgBtn')!);
  root.querySelector('#mnpAgB')!.append(chat.agents.el);
  paintAgents();
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
    const was = root!.classList.contains('side-open');
    root!.classList.toggle('side-open', open);
    // Tablets and phones: the list is a drawer (a whole screen on phones) over the chat. Focus
    // goes into it when it opens and back to its button when it closes.
    if (open && !was && isDrawer()) requestAnimationFrame(() => root?.querySelector<HTMLElement>('#mnpSideX')?.focus({ preventScroll: true }));
    if (!open && was && root!.contains(document.activeElement) && root!.querySelector('#mnpSide')!.contains(document.activeElement))
      root!.querySelector<HTMLElement>('#mnpLists')?.focus({ preventScroll: true });
  };
  // Phones: the chat list slides over the chat. Wider screens: it folds away and back.
  root.querySelector<HTMLElement>('#mnpLists')!.onclick = () => {
    // A page open beside the chat hides the list: close the page to get it back.
    if (document.documentElement.classList.contains('mn-pv-split') && !document.documentElement.classList.contains('mn-pv-roomy')) {
      closePreview();
      if (isDrawer()) side(true);
      else setPane('side', true);
      return;
    }
    if (isDrawer()) side(true);
    else setPane('side', root!.classList.contains('side-closed'));
  };
  root.querySelector<HTMLElement>('#mnpSideX')!.onclick = () => side(false);
  root.querySelector<HTMLElement>('#mnpArtBtn')!.onclick = () => setPane('art', !root!.classList.contains('art-open'));
  root.querySelector<HTMLElement>('#mnpArtX')!.onclick = () => setPane('art', false);
  root.querySelector<HTMLElement>('#mnpAScrim')!.onclick = () => {
    setPane('art', false);
    setPane('agents', false);
  };
  root.querySelector<HTMLElement>('#mnpAgBtn')!.onclick = () => setPane('agents', !root!.classList.contains('ag-open'));
  root.querySelector<HTMLElement>('#mnpAgX')!.onclick = () => setPane('agents', false);
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
  paintFold();
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
      toast(t('Fleeting chat left and deleted'), 'ok');
      return;
    }
    if (chat!.session) newChat();
    chat!.setFleeting(!chat!.fleeting);
    paintHead();
    chat!.focus();
  };
  // Wide screens: the chat list folds from its own corner. New chat sits above the search.
  // Desktop keeps the rail when the list is hidden: the same button brings the list back.
  root.querySelector<HTMLElement>('#mnpFold')!.onclick = () => setPane('side', root!.classList.contains('side-closed'));
  // With the list hidden, a click on the rail's empty space brings it back.
  root.querySelector<HTMLElement>('.mnp-rail')!.addEventListener('click', (e) => {
    if (root!.classList.contains('side-closed') && !(e.target as HTMLElement).closest('button, a')) setPane('side', true);
  });
  // Search opens the list first when it is hidden (the rail alone on desktop, or a phone).
  root.querySelector<HTMLElement>('#mnpSearchBtn')!.onclick = () => {
    if (isDrawer()) side(true);
    else if (root!.classList.contains('side-closed')) setPane('side', true);
    requestAnimationFrame(() => requestAnimationFrame(() => root?.querySelector<HTMLInputElement>('#mnpQ')?.focus()));
  };
  root.querySelector<HTMLElement>('#mnpAllBtn')!.onclick = () => {
    side(false);
    showAll(true, true);
  };
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
    if (root!.classList.contains('all-open')) {
      closeAll();
      return;
    }
    if (root!.classList.contains('side-open')) {
      root!.classList.remove('side-open');
      return;
    }
    // The Agents sheet covers the chat on tablets and phones: Esc closes it first.
    if (root!.classList.contains('ag-open') && window.innerWidth < 1100) {
      setPane('agents', false);
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
  wireAll();
  root.querySelector<HTMLElement>('#mnpList')!.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-allchats]')) {
      side(false);
      showAll(true, true);
      return;
    }
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
  { id: 'glow', label: t('Glow') },
  { id: 'aurora', label: t('Aurora') },
  { id: 'mesh', label: t('Mesh') },
  { id: 'dusk', label: t('Dusk') },
  { id: 'dawn', label: t('Dawn') },
  { id: 'deep', label: t('Deep') },
  { id: 'dots', label: t('Dots') },
  { id: 'grid', label: t('Grid') },
  { id: 'lines', label: t('Lines') },
  { id: 'waves', label: t('Waves') },
  { id: 'grain', label: t('Grain') },
  { id: 'plain', label: t('Plain') },
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
  pop.setAttribute('aria-label', t('Appearance'));
  pop.innerHTML = `<div class="mnp-look-h"><b>${t('Appearance')}</b><button type="button" class="mn-ibtn" data-look-x aria-label="${t('Close')}" title="${t('Close')}">${icon('close')}</button></div>
    <span class="mnp-look-l">${t('Theme')}</span>
    <div class="mnp-theme" role="radiogroup" aria-label="${t('Theme')}">${(['light', 'dark', 'system'] as ThemePref[])
      .map((th) => `<button type="button" role="radio" data-theme-pick="${th}">${icon(THEME_ICON[th])}<span>${THEME_LABEL[th]}</span></button>`)
      .join('')}</div>
    <span class="mnp-look-l">${t('Chat background')}</span>
    <div class="mnp-bgpop-g">${BGS.map(
      (b) =>
        `<button type="button" class="mnp-bgopt${b.id === cur ? ' on' : ''}" data-pick-bg="${b.id}" aria-pressed="${b.id === cur}"><i class="mnp-bgsw big" data-bg="${b.id}"></i><span>${esc(
          b.label,
        )}</span></button>`,
    ).join('')}</div>
    <span class="mnp-look-l">${t('Text size')}</span>
    <div class="mnp-look-fs">${textSizeHTML('look')}</div>
    <span class="mnp-look-l mnp-look-wl">${t('Chat width')}</span>
    <div class="mnp-theme mnp-look-w" role="radiogroup" aria-label="${t('Chat width')}">${(Object.keys(WIDTH_LABEL) as ChatWidth[])
      .map((w) => `<button type="button" role="radio" data-width-pick="${w}"><span>${WIDTH_LABEL[w]}</span></button>`)
      .join('')}</div>`;
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
  pop.querySelectorAll<HTMLElement>('[data-width-pick]').forEach((b) => {
    b.onclick = () => {
      setChatWidth(b.dataset.widthPick as ChatWidth);
      paintPrefs();
    };
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

const WIDTH_LABEL: Record<ChatWidth, string> = { compact: t('Compact'), wide: t('Wide'), full: t('Full') };

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
  const th = themePref();
  document.querySelectorAll<HTMLElement>('.mnp-look [data-theme-pick]').forEach((b) => {
    const on = b.dataset.themePick === th;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  const w = chatWidth();
  document.querySelectorAll<HTMLElement>('.mnp-look [data-width-pick]').forEach((b) => {
    const on = b.dataset.widthPick === w;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  const bg = readBg();
  root.dataset.bg = bg;
  const sw = root.querySelector<HTMLElement>('#mnpLookSw');
  if (sw) sw.dataset.bg = bg;
  const sub = root.querySelector('#mnpLookSub');
  if (sub) sub.textContent = t('{theme} · {bg} background', { theme: THEME_LABEL[th], bg: BGS.find((b) => b.id === bg)?.label || t('Glow') });
  document.querySelectorAll<HTMLElement>('.mnp-look [data-pick-bg]').forEach((x) => {
    const on = x.dataset.pickBg === bg;
    x.classList.toggle('on', on);
    x.setAttribute('aria-pressed', String(on));
  });
}

const LS_PANES = 'memora.mnemo.panes.v1';
const isNarrow = (): boolean => window.matchMedia('(max-width: 760px)').matches;
/** Tablets and phones: the chat list is a drawer over the chat, not a column beside it. */
const isDrawer = (): boolean => window.matchMedia('(max-width: 1024px)').matches;

function readPanes(): { side: boolean; art: boolean } {
  try {
    return { side: true, art: false, ...(JSON.parse(localStorage.getItem(LS_PANES) || '{}') as object) };
  } catch {
    return { side: true, art: false };
  }
}

/** Open or close the chat list (wide screens) or the "In this chat" panel; remembered here. */
/** The rail's hide/show button says what it will do. */
function paintFold(): void {
  const b = root?.querySelector<HTMLElement>('#mnpFold');
  if (!b) return;
  const closed = !!root?.classList.contains('side-closed');
  const lbl = closed ? t('Show the chat list') : t('Hide the chat list');
  b.title = lbl;
  b.setAttribute('aria-label', lbl);
  b.setAttribute('aria-expanded', String(!closed));
}

function setPane(which: 'side' | 'art' | 'agents', open: boolean): void {
  if (!root) return;
  if (which === 'agents') {
    // The Agents panel takes the place of "In this chat": never both open at once. It is not
    // remembered (it follows the chat's sub-agents).
    if (open) root.classList.remove('art-open');
    root.classList.toggle('ag-open', open);
    root.querySelector('#mnpAgBtn')?.setAttribute('aria-expanded', String(open));
    return;
  }
  if (which === 'side') {
    root.classList.toggle('side-closed', !open);
    paintFold();
  } else {
    root.classList.toggle('art-open', open);
    if (open) root.classList.remove('ag-open');
  }
  if (which === 'art' && open) paintArt();
  try {
    localStorage.setItem(LS_PANES, JSON.stringify({ ...readPanes(), [which]: open }));
  } catch {
    /* storage blocked: lasts until reload */
  }
}

const ART_GROUPS: { role: Artifact['role']; label: string }[] = [
  { role: 'changed', label: t('Changed') },
  { role: 'shown', label: t('Shown to you') },
  { role: 'attached', label: t('You attached') },
  { role: 'read', label: t('Read') },
];

/** The "In this chat" panel: every note, folder, image and the vault this chat touched. */
/** The pages (HTML and SVG files) in the chat on screen: the latest version of each. */
function chatPages(): { card: HTMLElement; versions: number }[] {
  // The whole chat, the older part waiting outside the page included.
  const cards = chat ? chat.findAll('.mn-file') : [];
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
    body.innerHTML = `<p class="mnp-art-none">${t('Pages {mnemo} writes, and the notes, folders and images this chat attaches, reads, changes or shows you collect here.', { mnemo: A.MNEMO })}</p>`;
    return;
  }
  const pageHTML = pages.length
    ? `<section><h4>${t('Pages')}<span>${pages.length}</span></h4>${pages
        .map(
          (p, i) =>
            `<button type="button" class="mnp-art-i" data-page-art="${i}" title="${attr(p.card.dataset.title || t('Page'))}"><span class="mnp-art-ic k-page">${icon('code')}</span><span class="mnp-art-t"><b>${esc(
              p.card.dataset.title || t('Page'),
            )}</b><small>${p.card.dataset.art === 'svg' ? t('SVG image') : t('HTML page')}${p.versions > 1 ? ` · ${t('{n} versions', { n: p.versions })}` : ''}</small></span></button>`,
        )
        .join('')}</section>`
    : '';
  body.innerHTML = pageHTML + ART_GROUPS.map((g) => {
    const list = items.filter((i) => i.role === g.role);
    if (!list.length) return '';
    return `<section><h4>${esc(g.label)}<span>${list.length}</span></h4>${list
      .map((i) => {
        const dir = i.kind === 'note' || i.kind === 'image' ? (i.path.includes('/') ? i.path.slice(0, i.path.lastIndexOf('/')) : t('Top level')) : i.kind === 'upload' ? t('Image you attached') : i.kind === 'vault' ? t('Every note') : t('Folder');
        const lead =
          i.kind === 'image' || i.kind === 'upload'
            ? `<span class="mnp-art-img"><img alt="" loading="lazy" src="${attr(
                i.kind === 'upload' ? `/api/assistant/uploads/${i.path}` : `/api/vault/file?path=${encodeURIComponent(i.path)}`,
              )}" onerror="this.remove()"></span>`
            : `<span class="mnp-art-ic k-${i.kind}">${icon(i.kind === 'note' ? (i.role === 'changed' ? 'edit' : 'note') : i.kind === 'folder' ? 'folder' : 'vault')}</span>`;
        return `<button type="button" class="mnp-art-i" data-card="${attr(i.kind)}" data-path="${attr(i.path)}" title="${attr(i.path || i.title)}">${lead}<span class="mnp-art-t"><b>${esc(
          i.title || t('Untitled'),
        )}</b><small>${esc(dir)}</small></span></button>`;
      })
      .join('')}</section>`;
  }).join('');
}

/** The Agents button: shown once the chat has had sub-agents, with how many run now. */
function paintAgents(): void {
  if (!root || !chat) return;
  const { running, total } = chat.agents.counts();
  const b = root.querySelector<HTMLElement>('#mnpAgBtn')!;
    // Always beside Think and the meter; the panel says when there are none yet.
  b.hidden = false;
  b.classList.toggle('none', !total);
  b.classList.toggle('run', running > 0);
  const n = b.querySelector<HTMLElement>('.mnp-agn')!;
  n.hidden = !running;
  n.textContent = String(running);
  const lbl = running ? t('Agents: {n} working', { n: running }) : t('Agents in this chat');
  b.title = lbl;
  b.setAttribute('aria-label', lbl);
  root.querySelector('#mnpAgSub')!.textContent = total ? (running ? t('{running} working · {total} in this chat', { running, total }) : t('{total} in this chat', { total })) : '';
  // The panel stays open with its empty note when the chat has no sub-agents yet.
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
  // The address names this chat: its title shows at once, not "New chat", while it loads.
  const known = sessions.find((x) => x.id === id);
  if (root && known) {
    root.querySelector('#mnpTitle')!.textContent = known.title;
    root.querySelector('#mnpSub')!.textContent = t('Opening…');
  }
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

/** How many chats the side list shows; the rest are in All chats. */
const RECENT = 30;

/** Which chats the list shows: all, the owner's own chats, or the ones asked from notes. */
type ListFilter = 'all' | 'chats' | 'notes';
let listFilter: ListFilter = 'all';
const LS_PINS = 'memora.mnemo.pins.open';
function pinsOpen(): boolean {
  try {
    return localStorage.getItem(LS_PINS) !== '0';
  } catch {
    return true;
  }
}
function fromNote(s: A.Session): boolean {
  return s.title.startsWith(A.NOTE_TASK_PREFIX) || s.scope.startsWith('note:') || s.scope.startsWith('folder:');
}
function paintChips(): void {
  const box = root?.querySelector<HTMLElement>('#mnpChips');
  if (!box) return;
  const live = sessions.filter((s) => !s.archived);
  const notes = live.filter(fromNote).length;
  // Only worth showing once there are chats of both kinds.
  box.hidden = !notes || notes === live.length;
  if (box.hidden && listFilter !== 'all') listFilter = 'all';
  const chip = (f: ListFilter, label: string, n: number): string =>
    `<button type="button" role="tab" class="mnp-chip${listFilter === f ? ' on' : ''}" aria-selected="${listFilter === f}" data-filter="${f}">${label}<small>${n}</small></button>`;
  box.innerHTML = chip('all', t('All'), live.length) + chip('chats', t('Chats'), live.length - notes) + chip('notes', t('Notes'), notes);
  box.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => {
    b.onclick = () => {
      listFilter = b.dataset.filter as ListFilter;
      paintList();
    };
  });
}

/** One chat row (side list and All chats); `sel` is null when not selecting. */
/** What a chat is, at a glance: a chat, one about a note (or asked from it), or about a
 *  folder; a spinner while Mnemo works in it. */
function kindIcon(s: A.Session): string {
  if (s.running) return `<span class="mnp-kind run" title="${t('{mnemo} is working on this', { mnemo: A.MNEMO })}"><i class="mnp-spin"></i></span>`;
  const note = s.title.startsWith(A.NOTE_TASK_PREFIX) || s.scope.startsWith('note:');
  const folder = s.scope.startsWith('folder:');
  const k = note ? 'note' : folder ? 'folder' : 'chat';
  const tip = note ? t('About a note') : folder ? t('About a folder') : t('Chat');
  return `<span class="mnp-kind ${k}" title="${tip}" aria-label="${tip}">${icon(k)}</span>`;
}

function rowHTML(s: A.Session, cur: string | undefined, sel: boolean | null): string {
  const news = s.running || s.id === cur ? 0 : s.archived ? 0 : unreadOf(s);
  const picking = sel !== null;
  const pv = s.preview?.text
    ? `${s.preview.role === 'user' ? `<em>${t('You:')}</em> ` : ''}${esc(s.preview.text)}`
    : s.scope !== 'global'
      ? esc(A.scopeLabel(s.scope))
      : t('No messages yet');
  const title = s.title.startsWith(A.NOTE_TASK_PREFIX) ? s.title.slice(A.NOTE_TASK_PREFIX.length) : s.title;
  return `<div class="mnp-row${s.id === cur && !picking ? ' on' : ''}${s.running ? ' run' : ''}${news ? ' unread' : ''}${sel ? ' sel' : ''}" data-id="${attr(s.id)}" role="${picking ? 'checkbox' : 'button'}" tabindex="0"${
    picking ? ` aria-checked="${sel}"` : ` aria-current="${s.id === cur}"`
  } title="${attr(s.scope.startsWith('note:') ? t('From the note {path}', { path: s.scope.slice(5) }) : title)}">
      ${picking ? `<span class="mnp-check" aria-hidden="true">${sel ? icon('check') : ''}</span>` : kindIcon(s)}
      <span class="mnp-row-t"><span class="mnp-row-l1"><b>${esc(title)}</b><time class="mnp-row-ts" datetime="${new Date(s.updated_at * 1000).toISOString()}">${esc(shortAgo(s.updated_at))}</time></span>
        <span class="mnp-row-l2"><small>${pv}</small>${news ? `<span class="mnp-newn" aria-label="${tn(news, '{n} new message', '{n} new messages')}">${news > 99 ? '99+' : news}</span>` : ''}</span></span>
      ${picking ? '' : `<button type="button" class="mn-ibtn mnp-row-more" data-more aria-label="${t('Chat actions')}">${icon('more')}</button>`}</div>`;
}


/** How long ago, in a few characters: now, 5m, 3h, 2d, 3w, then the date. */
function shortAgo(ts: number): string {
  const sec = Math.max(0, Date.now() / 1000 - ts);
  if (sec < 60) return t('now');
  if (sec < 3600) return t('{n}m', { n: Math.floor(sec / 60) });
  if (sec < 86_400) return t('{n}h', { n: Math.floor(sec / 3600) });
  if (sec < 7 * 86_400) return t('{n}d', { n: Math.floor(sec / 86_400) });
  if (sec < 30 * 86_400) return t('{n}w', { n: Math.floor(sec / (7 * 86_400)) });
  const d = new Date(ts * 1000);
  const same = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', same ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' });
}

function rowKeys(list: HTMLElement): void {
  list.querySelectorAll<HTMLElement>('.mnp-row, .mnp-pin').forEach((r) => {
    r.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        r.click();
      }
    };
  });
}

/** Archive or bring back a chat; archiving offers Undo. */
async function setArchived(s: A.Session, on: boolean): Promise<void> {
  try {
    afterUpdate((await A.updateSession(s.id, { archived: on })).session);
    if (on) notify(t('Chat archived'), 'ok', 6000, { label: t('Undo'), run: () => void setArchived(s, false) });
    else toast(t('Chat back in the list'), 'ok');
  } catch (e) {
    fail(e);
  }
}

// ---- All chats (/mnemo/chats): every chat, archived ones too ----

let allQuery = '';
let allPicked: Set<string> | null = null;
let archOpen = false;
/** The page was opened from here (Back returns), not from the address. */
let allPushed = false;

function showAll(on: boolean, push = false): void {
  if (!root) return;
  const box = root.querySelector<HTMLElement>('#mnpAll')!;
  if (on && push) {
    openMnemoAll();
    allPushed = true;
  }
  if (!on) {
    allPicked = null;
    if (!mnemoAllOn()) allPushed = false;
  }
  box.hidden = !on;
  root.classList.toggle('all-open', on);
  if (on) {
    paintAll();
    if (window.matchMedia('(min-width: 761px)').matches) box.querySelector<HTMLInputElement>('#mnpAllQ')?.focus({ preventScroll: true });
  }
}

/** Leave All chats: Back when it was opened here, else straight to the chat. */
function closeAll(): void {
  if (allPushed && history.length > 1) {
    allPushed = false;
    history.back();
    return;
  }
  closeMnemoAll(chat?.session?.id ?? null, false);
  showAll(false);
}

function paintAll(): void {
  const list = root?.querySelector<HTMLElement>('#mnpAllList');
  if (!list || root?.querySelector<HTMLElement>('#mnpAll')!.hidden) return;
  const q = allQuery;
  const match = (s: A.Session): boolean => !q || s.title.toLowerCase().includes(q) || A.scopeLabel(s.scope).toLowerCase().includes(q);
  const all = sessions.filter(match).sort((a, b) => b.updated_at - a.updated_at);
  const pinned = all.filter((s) => s.pinned && !s.archived);
  const rest = all.filter((s) => !s.pinned && !s.archived);
  const arch = all.filter((s) => s.archived);
  const cur = chat?.session?.id;
  const sel = (s: A.Session): boolean | null => (allPicked ? allPicked.has(s.id) : null);
  // Chats under a divider per time span (Today, Yesterday, Previous 7 days, months).
  const dated = (items: A.Session[]): string => {
    let out = '';
    let last = '';
    for (const s of items) {
      const b = bucket(s);
      if (b !== last) {
        out += `<div class="mnp-g mnp-day" role="separator"><span>${esc(b)}</span></div>`;
        last = b;
      }
      out += rowHTML(s, cur, sel(s));
    }
    return out;
  };
  const group = (title: string, items: A.Session[]): string =>
    items.length
      ? `<div class="mnp-all-g${title === t('Pinned') ? ' mnp-pins' : ''}"><div class="mnp-g head">${title === t('Pinned') ? icon('pin') : ''}<span>${title}</span><small>${items.length}</small></div>${
          title === t('Pinned') ? items.map((s) => rowHTML(s, cur, sel(s))).join('') : dated(items)
        }</div>`
      : '';
  const archived = arch.length
    ? `<details class="mnp-all-g mnp-all-arch"${archOpen || (q && !pinned.length && !rest.length) ? ' open' : ''}><summary class="mnp-g">${icon('chev', 'i mnp-all-chev')}${t('Archived')} <span>${arch.length}</span></summary>${arch
        .map((s) => rowHTML(s, cur, sel(s)))
        .join('')}</details>`
    : '';
  list.innerHTML =
    group(t('Pinned'), pinned) + group(t('Chats'), rest) + archived ||
    `<p class="mnp-none">${q ? t('No chat matches.') : t('No chats yet. Ask {mnemo} something to start one.', { mnemo: A.MNEMO })}</p>`;
  list.querySelector<HTMLDetailsElement>('.mnp-all-arch')?.addEventListener('toggle', (e) => {
    archOpen = (e.currentTarget as HTMLDetailsElement).open;
  });
  rowKeys(list);
  const bar = root!.querySelector<HTMLElement>('#mnpAllBar')!;
  bar.hidden = !allPicked;
  root!.querySelector<HTMLElement>('#mnpAllSel')!.hidden = !!allPicked;
  if (allPicked) {
    const n = allPicked.size;
    bar.innerHTML = `<span class="mnp-seln">${n ? t('{n} selected', { n }) : t('Pick chats')}</span>
      <button type="button" class="mnp-selb" data-asel="archive"${n ? '' : ' disabled'}>${icon('archive')}<span>${t('Archive')}</span></button>
      <button type="button" class="mnp-selb danger" data-asel="delete"${n ? '' : ' disabled'}>${icon('trash')}<span>${t('Delete')}</span></button>
      <button type="button" class="mn-ibtn" data-asel="cancel" aria-label="${t('Stop selecting')}" title="${t('Done')}">${icon('close')}</button>`;
  }
}

function wireAll(): void {
  const box = root!.querySelector<HTMLElement>('#mnpAll')!;
  box.querySelector<HTMLElement>('#mnpAllBack')!.onclick = () => closeAll();
  const q = box.querySelector<HTMLInputElement>('#mnpAllQ')!;
  q.oninput = () => {
    allQuery = q.value.trim().toLowerCase();
    paintAll();
  };
  box.querySelector<HTMLElement>('#mnpAllSel')!.onclick = () => {
    allPicked = new Set();
    paintAll();
  };
  box.querySelector<HTMLElement>('#mnpAllBar')!.onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-asel]');
    if (!b || !allPicked) return;
    const ids = [...allPicked];
    if (b.dataset.asel === 'cancel') {
      allPicked = null;
      return paintAll();
    }
    if (b.dataset.asel === 'delete') {
      allPicked = null;
      return askDeleteMany(ids);
    }
    try {
      const done = await Promise.all(ids.map((id) => A.updateSession(id, { archived: true })));
      done.forEach((r) => upsert(r.session));
      allPicked = null;
      paintAll();
      notify(tn(ids.length, '{n} chat archived', '{n} chats archived'), 'ok', 6000, {
        label: t('Undo'),
        run: () => void Promise.all(ids.map((id) => A.updateSession(id, { archived: false }))).then((rs) => rs.forEach((r) => upsert(r.session)), fail),
      });
    } catch (err) {
      fail(err);
    }
  };
  box.querySelector<HTMLElement>('#mnpAllList')!.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.mnp-row[data-id]');
    if (!row) return;
    const id = row.dataset.id!;
    if (allPicked) {
      if (allPicked.has(id)) allPicked.delete(id);
      else allPicked.add(id);
      return paintAll();
    }
    const s = sessions.find((x) => x.id === id);
    const more = t.closest<HTMLElement>('[data-more]');
    if (more) {
      if (s) rowMenu(s, more);
      return;
    }
    allPushed = false;
    closeMnemoAll(id, true);
    showAll(false);
    void openChat(id);
  });
}

function bucket(s: A.Session): string {
  if (s.pinned) return t('Pinned');
  const d = new Date(s.updated_at * 1000);
  const now = new Date();
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff < 1) return t('Today');
  if (diff < 2) return t('Yesterday');
  if (diff < 7) return t('Previous 7 days');
  if (diff < 30) return t('Previous 30 days');
  // Older chats by month: "October", or "October 2025" in an earlier year.
  const month = d.toLocaleString('en-US', { month: 'long' });
  return d.getFullYear() === now.getFullYear() ? month : `${month} ${d.getFullYear()}`;
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

/** A chat's title; a chat asked with @mnemo in a note gets a small @ (the note's path as its tip). */
function titleHTML(title: string, q = '', scope = ''): string {
  if (title.startsWith(A.NOTE_TASK_PREFIX)) {
    const tip = scope.startsWith('note:') ? scope.slice(5) : t('Asked with @mnemo in a note');
    return `<span class="mnp-at" title="${attr(tip)}" aria-label="${attr(t('From a note: {tip}', { tip }))}">@</span>${marked(title.slice(A.NOTE_TASK_PREFIX.length), q)}`;
  }
  return marked(title, q);
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
    list.innerHTML = `<p class="mnp-none">${t('Nothing in your chats says “{query}”.', { query: esc(query) })}</p>`;
    return true;
  }
  const n = found.hits.filter((h) => h.message_id != null).length;
  let html = `<div class="mnp-g">${n ? tn(n, '{n} message in {chats}', '{n} messages in {chats}', { chats: tn(chats.size, '{n} chat', '{n} chats') }) : tn(chats.size, '{n} chat', '{n} chats')}</div>`;
  for (const [id, hits] of chats) {
    const s = sessions.find((x) => x.id === id);
    const h0 = found.hits.find((h) => h.chat === id)!;
    html += `<div class="mnp-row mnp-res" data-id="${attr(id)}" role="button" tabindex="0">
      <span class="mnp-row-t"><b>${titleHTML(s?.title || h0.title, query, s?.scope || h0.scope)}</b><small>${esc(relTs(s?.updated_at || h0.at))}</small></span></div>`;
    for (const h of hits.slice(0, 3)) {
      html += `<button type="button" class="mnp-hit" data-id="${attr(id)}" data-mid="${h.message_id}"><em>${h.role === 'user' ? t('You') : A.MNEMO}</em>${marked(h.snippet, query)}</button>`;
    }
    if (hits.length > 3) html += `<div class="mnp-hit-more">${t('+{n} more in this chat', { n: hits.length - 3 })}</div>`;
  }
  list.innerHTML = html;
  return true;
}

function paintList(): void {
  const list = root?.querySelector<HTMLElement>('#mnpList');
  if (!list) return;
  paintSelBar();
  if (query.length >= 2 && paintFound(list)) return;
  // Archived chats stay out of the list (search still finds them); the newest few show.
  paintChips();
  const cnt = root?.querySelector('#mnpCount');
  if (cnt) cnt.textContent = String(sessions.filter((x) => !x.archived).length || '');
  const kind = (s: A.Session): boolean => listFilter === 'all' || (listFilter === 'notes' ? fromNote(s) : !fromNote(s));
  const matching = sessions
    .filter((s) => (query ? s.title.toLowerCase().includes(query) || A.scopeLabel(s.scope).toLowerCase().includes(query) : !s.archived && kind(s)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at - a.updated_at);
  // Pinned chats always show, apart; then the newest others.
  const shown = query || picked ? matching : [...matching.filter((x) => x.pinned), ...matching.filter((x) => !x.pinned).slice(0, RECENT)];
  const allRow = sessions.length
    ? `<button type="button" class="mnp-allrow" data-allchats>${icon('chat')}<span>${t('View all chats')}</span><small>${sessions.length}</small>${icon('chev')}</button>`
    : '';
  paintAll();
  if (!shown.length) {
    list.innerHTML = `<p class="mnp-none">${query ? t('No chat matches.') : sessions.length ? t('Every chat is archived.') : t('No chats yet. Ask {mnemo} something to start one.', { mnemo: A.MNEMO })}</p>${query ? '' : allRow}`;
    return;
  }
  const cur = chat?.session?.id;
  // Pinned chats sit in their own block; the rest fall under a divider per time span.
  const pins = shown.filter((x) => x.pinned);
  const rest = shown.filter((x) => !x.pinned);
  const open = pinsOpen() || !!query;
  // Pinned chats: their own list above the others.
  let html = pins.length
    ? `<section class="mnp-pins${open ? '' : ' shut'}" aria-label="${t('Pinned chats')}"><button type="button" class="mnp-g pin" data-pins aria-expanded="${open}"><span>${t('Pinned')}</span><small>${pins.length}</small>${icon('chev-down', 'i mnp-g-chev')}</button>${
        !open ? '' : pins.map((s) => rowHTML(s, cur, picked ? picked.has(s.id) : null)).join('')
      }</section>`
    : '';
  let last = '';
  for (const s of rest) {
    const b = bucket(s);
    if (b !== last) {
      html += `<div class="mnp-g" role="separator"><span>${esc(b)}</span></div>`;
      last = b;
    }
    html += rowHTML(s, cur, picked ? picked.has(s.id) : null);
  }
  list.innerHTML = html + (query || picked ? '' : allRow);
  list.querySelector<HTMLElement>('[data-pins]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      localStorage.setItem(LS_PINS, pinsOpen() ? '0' : '1');
    } catch {
      /* stays as it is */
    }
    paintList();
  });
  rowKeys(list);
}

function paintHead(): void {
  syncFleetHash();
  if (!root) return;
  if (showingActivity) {
    root.querySelector('#mnpTitle')!.textContent = t('{mnemo} activity', { mnemo: A.MNEMO });
    root.querySelector('#mnpSub')!.textContent = t('Everything it did, and who it was for');
    return;
  }
  const s = chat?.session;
  const fleet = !!chat?.fleeting;
  root.classList.toggle('fleeting', fleet);
  const fb = root.querySelector<HTMLElement>('#mnpFleet')!;
  // Only a new chat can become fleeting (and a fleeting chat shows it, to leave it).
  // Only before the first message: on a new chat it turns fleeting on, in an empty fleeting
  // chat it goes back to a normal one (once a message is sent, New chat leaves it).
  fb.hidden = !!s;
  fb.innerHTML = icon(fleet ? 'chat' : 'incognito');
  fb.setAttribute('aria-label', fleet ? t('Back to a normal chat') : t('Fleeting chat'));
  fb.setAttribute('aria-pressed', String(fleet));
  fb.title = fleet ? t('Back to a normal chat') : t('Fleeting chat: not kept, gone when you leave it');
  if (fleet) {
    root.querySelector('#mnpTitle')!.textContent = t('Fleeting chat');
    root.querySelector('#mnpTitle')!.classList.remove('task');
    root.querySelector('#mnpSub')!.textContent = t('Not kept · gone when you leave it');
    return;
  }
  root.querySelector('#mnpTitle')!.textContent = s?.title || t('New chat');
  root.querySelector('#mnpTitle')!.classList.toggle('task', !!s?.title.startsWith(A.NOTE_TASK_PREFIX));
  root.querySelector('#mnpSub')!.textContent = s
    ? `${A.scopeLabel(s.scope)} · ${tn(s.messages, '{n} message', '{n} messages')}`
    : t('A chat about your whole vault');
}

/** The ⋯ in the header: this chat's actions (once it has started), the chat list and settings. */
function headMenu(at: HTMLElement): void {
  const s0 = chat?.session;
  const s = s0 ? (sessions.find((x) => x.id === s0.id) ?? s0) : s0;
  openMenu(
    [
      ...(s
        ? []
        : [{ label: t('New chat: these work once you send a message'), icon: icon('info', 'vx-i'), disabled: true }, { sep: true, label: '' }]),
      { label: t('Rename'), icon: icon('edit', 'vx-i'), disabled: !s, run: () => s && rename(s) },
      {
        label: s?.pinned ? t('Unpin') : t('Pin to the top'),
        icon: icon('pin', 'vx-i'),
        disabled: !s,
        run: () => s && void A.updateSession(s.id, { pinned: !s.pinned }).then((r) => afterUpdate(r.session), fail),
      },
      {
        label: s?.archived ? t('Unarchive') : t('Archive'),
        icon: icon('archive', 'vx-i'),
        disabled: !s,
        run: () => s && void setArchived(s, !s.archived),
      },
      ...exportItems(s),
      { label: t('Delete chat'), icon: icon('trash', 'vx-i'), danger: !!s, disabled: !s, run: () => s && askDelete(s) },
      { sep: true, label: '' },
      { label: t('All chats'), icon: icon('chat', 'vx-i'), run: () => showAll(true, true) },
      { label: t('Select chats'), icon: icon('check', 'vx-i'), run: () => select(new Set()) },
      { label: t('Clean up chats…'), icon: icon('trash', 'vx-i'), run: () => cleanUp() },
      { label: t('{mnemo} activity', { mnemo: A.MNEMO }), icon: icon('activity', 'vx-i'), run: () => showActivity(true) },
      { label: t('Appearance'), icon: icon('sun', 'vx-i'), run: () => lookMenu(at) },
      { label: t('{mnemo} settings: models and keys', { mnemo: A.MNEMO }), icon: icon('settings', 'vx-i'), run: () => openMnemoSettings() },
      { label: t('Back to Memora'), icon: icon('overview', 'vx-i'), run: () => leave(true) },
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
    notify(t('Saved as a note in {folder}', { folder: 'Mnemo chats' }), 'ok', 6000, { label: t('Open'), run: () => hooks.openNote(r.path) });
  } catch (e) {
    fail(e);
  }
}

/** The export entries of a chat's menus. */
function exportItems(s: A.Session | null | undefined): { label: string; icon: string; disabled?: boolean; run: () => void }[] {
  return [
    { label: t('Download as Markdown'), icon: icon('download', 'vx-i'), disabled: !s, run: () => s && downloadChat(s) },
    { label: t('Save as a note'), icon: icon('note', 'vx-i'), disabled: !s, run: () => s && void saveChatNote(s) },
  ];
}

function rowMenu(s: A.Session, at: HTMLElement): void {
  openMenu(
    [
      { label: t('Rename'), icon: icon('edit', 'vx-i'), run: () => rename(s) },
      {
        label: s.pinned ? t('Unpin') : t('Pin to the top'),
        icon: icon('pin', 'vx-i'),
        run: () => void A.updateSession(s.id, { pinned: !s.pinned }).then((r) => afterUpdate(r.session), fail),
      },
      { label: s.archived ? t('Unarchive') : t('Archive'), icon: icon('archive', 'vx-i'), run: () => void setArchived(s, !s.archived) },
      ...exportItems(s),
      {
        label: t('Select'),
        icon: icon('check', 'vx-i'),
        run: () => {
          if (root?.classList.contains('all-open')) {
            allPicked = new Set([s.id]);
            paintAll();
          } else select(new Set([s.id]));
        },
      },
      { sep: true, label: '' },
      { label: t('Delete chat'), icon: icon('trash', 'vx-i'), danger: true, run: () => askDelete(s) },
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
  const body = el('div', 'mnp-ren', `<label class="mnp-ren-l">${t('Name')}<input type="text" maxlength="80" value="${attr(s.title)}"></label>`);
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
    title: t('Rename chat'),
    body,
    actions: [
      { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
      { label: t('Save'), cls: 'primary', run: save },
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
    if (isDrawer()) root?.classList.add('side-open');
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
  bar.innerHTML = `<span class="mnp-seln">${n ? t('{n} selected', { n }) : t('Pick chats')}</span>
    <button type="button" class="mnp-selb" data-sel="all">${t('All')}</button>
    <button type="button" class="mnp-selb danger" data-sel="delete"${n ? '' : ' disabled'}>${icon('trash')}<span>${t('Delete')}</span></button>
    <button type="button" class="mn-ibtn" data-sel="cancel" aria-label="${t('Stop selecting')}" title="${t('Done')}">${icon('close')}</button>`;
}

/** The ⋯ beside New chat: pick chats, clean up old ones, or delete them all. */
function manageMenu(at: HTMLElement): void {
  openMenu(
    [
      { label: t('Select chats'), icon: icon('check', 'vx-i'), run: () => select(new Set()) },
      { label: t('Clean up chats…'), icon: icon('refresh', 'vx-i'), run: () => cleanUp() },
      { sep: true, label: '' },
      { label: t('Delete all chats…'), icon: icon('trash', 'vx-i'), danger: true, disabled: !sessions.length, run: () => cleanUp(true) },
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
    `${tn(r.deleted, '{n} chat deleted', '{n} chats deleted')}${r.skipped ? t(', {n} still answering left as they are', { n: r.skipped }) : ''}`,
    r.deleted ? 'ok' : 'info',
  );
}

function askDeleteMany(ids: string[]): void {
  if (!ids.length) return;
  Modal.confirm(
    tn(ids.length, 'Delete {n} chat?', 'Delete {n} chats?'),
    t('They and their messages are removed for good. Your notes are not touched.'),
    t('Delete {n}', { n: ids.length }),
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
    { v: '7', label: t('Older than 7 days') },
    { v: '30', label: t('Older than 30 days') },
    { v: '90', label: t('Older than 90 days') },
    { v: 'all', label: t('All chats') },
  ];
  const body = el(
    'div',
    'mnp-clean',
    `<div class="mnp-clean-o" role="radiogroup" aria-label="${t('Which chats')}">${opts
      .map(
        (o) =>
          `<label class="mnp-clean-r"><input type="radio" name="mnpClean" value="${o.v}"${(all ? o.v === 'all' : o.v === '30') ? ' checked' : ''}><span>${o.label}</span><em data-n="${o.v}"></em></label>`,
      )
      .join('')}</div>
    <label class="mnp-clean-k"><input type="checkbox" checked data-keep><span>${t('Keep pinned chats')}</span></label>
    <p class="mnp-clean-p">${t('Deleted chats and their messages are gone for good. Your notes are not touched, and a chat that is answering right now is left alone.')}</p>`,
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
      go.textContent = n ? tn(n, 'Delete {n} chat', 'Delete {n} chats') : t('Nothing to delete');
    }
  };
  body.onchange = paint;
  Modal.open({
    title: all ? t('Delete all chats') : t('Clean up chats'),
    sub: tn(sessions.length, '{n} chat in {mnemo}', '{n} chats in {mnemo}', { mnemo: A.MNEMO }),
    body,
    onOpen: () => paint(),
    actions: [
      { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
      {
        label: t('Delete'),
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
  Modal.confirm(t('Delete this chat?'), t('“{title}” and its messages are removed. Your notes are not touched.', { title: s.title }), t('Delete chat'), async () => {
    try {
      await A.deleteSession(s.id);
      sessions = sessions.filter((x) => x.id !== s.id);
      if (chat?.session?.id === s.id) newChat();
      else paintList();
      Modal.close();
      toast(t('Chat deleted'), 'ok');
    } catch (e) {
      fail(e);
    }
  });
}

// ---- resizable panes (desktop): the chat list and the side panel (Agents, In this chat) ----

type Grip = 'side' | 'ag' | 'art';
const GRIP_LS: Record<Grip, string> = { side: 'mn-w-side', ag: 'mn-w-agents', art: 'mn-w-art' };
const GRIP_VAR: Record<Grip, string> = { side: '--sw-u', ag: '--aw-ag', art: '--aw-art' };
const GRIP_CLS: Record<Grip, string> = { side: 'sw-set', ag: 'aw-ag', art: 'aw-art' };
/** Each pane's narrowest and widest; the chat between them keeps at least CHAT_ROOM. */
const GRIP_MIN: Record<Grip, number> = { side: 260, ag: 320, art: 260 };
const GRIP_MAX: Record<Grip, number> = { side: 520, ag: 760, art: 560 };
const CHAT_ROOM = 440;

function gripRead(g: Grip): number {
  try {
    return Number(localStorage.getItem(GRIP_LS[g])) || 0;
  } catch {
    return 0;
  }
}

function paneWidth(r: HTMLElement, v: '--sw' | '--aw'): number {
  return parseFloat(getComputedStyle(r).getPropertyValue(v)) || 0;
}

/** A width that leaves both the pane and the chat their room. */
function gripFit(r: HTMLElement, g: Grip, w: number): number {
  const page = r.getBoundingClientRect().width;
  const other = g === 'side' ? paneWidth(r, '--aw') : paneWidth(r, '--sw');
  const max = Math.max(GRIP_MIN[g], Math.min(GRIP_MAX[g], page - CHAT_ROOM - other));
  return Math.round(Math.min(max, Math.max(GRIP_MIN[g], w)));
}

function gripSet(r: HTMLElement, g: Grip, w: number | null, save = false): void {
  if (!w) {
    r.style.removeProperty(GRIP_VAR[g]);
    r.classList.remove(GRIP_CLS[g]);
  } else {
    r.style.setProperty(GRIP_VAR[g], `${w}px`);
    r.classList.add(GRIP_CLS[g]);
  }
  if (!save) return;
  try {
    if (w) localStorage.setItem(GRIP_LS[g], String(w));
    else localStorage.removeItem(GRIP_LS[g]);
  } catch {
    /* lasts until reload */
  }
}

/** Drag (or arrow keys on) the edge of the chat list or the side panel to change its width;
 *  a double-click goes back to the default. Widths are kept per pane on this device. */
function wireGrips(r: HTMLElement): void {
  const which = (el: HTMLElement): Grip => (el.dataset.g === 'side' ? 'side' : r.classList.contains('ag-open') ? 'ag' : 'art');
  const fitAll = (): void => {
    for (const g of ['side', 'ag', 'art'] as Grip[]) {
      const w = gripRead(g);
      if (w) gripSet(r, g, gripFit(r, g, w));
    }
  };
  fitAll();
  window.addEventListener('resize', () => {
    if (r.isConnected) fitAll();
  });
  r.querySelectorAll<HTMLElement>('.mnp-grip').forEach((grip) => {
    const rtl = (): boolean => getComputedStyle(r).direction === 'rtl';
    // The side panel grows toward the chat: leftward in a left-to-right page.
    const sign = (): number => (grip.dataset.g === 'side' ? 1 : -1) * (rtl() ? -1 : 1);
    const now = (g: Grip): number => (g === 'side' ? paneWidth(r, '--sw') : paneWidth(r, '--aw'));
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const g = which(grip);
      const x0 = e.clientX;
      const w0 = now(g);
      let w = w0;
      grip.setPointerCapture(e.pointerId);
      r.classList.add('resizing');
      const move = (ev: PointerEvent): void => {
        w = gripFit(r, g, w0 + (ev.clientX - x0) * sign());
        gripSet(r, g, w);
      };
      const up = (): void => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        r.classList.remove('resizing');
        if (w !== w0) gripSet(r, g, w, true);
        window.dispatchEvent(new Event('resize'));
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', () => {
      gripSet(r, which(grip), null, true);
      window.dispatchEvent(new Event('resize'));
    });
    grip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const g = which(grip);
      const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 48 : 16) * (grip.dataset.g === 'side' ? 1 : -1) * (rtl() ? -1 : 1);
      gripSet(r, g, gripFit(r, g, now(g) + d), true);
    });
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
:root.mn-pv-split .mnp-art,:root.mn-pv-split .mnp-agp,:root.mn-pv-split .mnp-ascrim{visibility:hidden}
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
/* Agents: a side panel in the place of "In this chat" on wide screens, a full-screen sheet on
   tablets and phones. */
.mnp-agbtn{position:relative}
.mnp-agbtn.run{color:var(--accent)}
.mnp.ag-open .mnp-agbtn{color:var(--accent);background:var(--accent-soft)}
.mnp-agn{position:absolute;top:-3px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:99px;font-size:10px;font-weight:700;line-height:16px;text-align:center;
  color:var(--on-accent,#fff);background:var(--accent)}
.mnp-agn[hidden]{display:none}
.mnp.ag-open{--aw:380px}
/* One row only: the list, the chat and one side pane (In this chat or Agents, stacked in the
   same cell). Anything left to auto-placement would open a second row and halve the page. */
@media (min-width:761px){
  .mnp>.mnp-side{grid-column:1;grid-row:1}
  .mnp>.mnp-main{grid-column:2;grid-row:1}
  .mnp>.mnp-art{grid-column:3;grid-row:1}
}
.mnp{grid-template-rows:minmax(0,1fr)}
.mnp-agp{grid-column:3;grid-row:1;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;border-left:1px solid var(--line);
  background:color-mix(in srgb,var(--surface-1,var(--panel)) 60%,transparent)}
.mnp:not(.ag-open) .mnp-agp{visibility:hidden}
.mnp-agp .mnp-art-h{justify-content:flex-start}
.mnp-agp .mnp-art-h small{min-width:0;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-agp-b{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.mnp-agp-b>.mn-agents{padding-bottom:24px}
@media (max-width:1099px){
  .mnp.ag-open{--aw:0px}
  .mnp-agp{position:absolute;inset:0;z-index:8;border-left:0;background:var(--surface-0,var(--bg));visibility:hidden;transform:translateY(100%);
    transition:transform .28s var(--ease-out,ease-out),visibility 0s linear .28s}
  .mnp.ag-open .mnp-agp{visibility:visible;transform:none;transition:transform .28s var(--ease-out,ease-out)}
  .mnp-agp-b>.mn-agents{max-width:760px;margin:0 auto;padding:14px 16px 32px}
}
@media (max-width:760px){
  .mnp-agp{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
  .mnp-agp .mnp-art-h{min-height:50px;padding:6px 8px 6px 16px}
  .mnp-agp .mnp-art-h .mn-ibtn{width:40px;height:40px}
  .mnp-agp .mnp-art-h .mn-ibtn .i{width:19px;height:19px}
  .mnp-agp-b>.mn-agents{padding:12px 12px 28px}
}
@media (prefers-reduced-motion:reduce){.mnp-agp{transition:none!important}}
.mnp-side{--side-bg:color-mix(in srgb,var(--surface-1,var(--panel)) 60%,var(--bg));display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line);background:var(--side-bg)}
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
.mnp-newrow{display:flex;align-items:center;justify-content:center;gap:7px;margin:0 12px 8px;padding:0 12px;height:36px;border-radius:10px;border:1px solid transparent;
  background:var(--accent);color:var(--accent-fg,var(--on-accent,#fff));font:inherit;font-size:13.5px;font-weight:620;cursor:pointer;transition:background .15s,transform .15s}
.mnp-newrow:hover{background:color-mix(in srgb,var(--accent) 88%,var(--fg))}
.mnp-newrow:active{transform:scale(.985)}
.mnp-newrow:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mnp-newrow .i{width:16px;height:16px;stroke-width:2.3}
.mnp-grow{flex:1}
/* Wide screens: the header button only brings a folded list back. */
@media (min-width:761px){
  .mnp:not(.side-closed) .mnp-lists{display:none}
}
/* New chat is the filled button above the search on every screen. */
.mnp-new{display:none!important}
@media (max-width:760px){.mnp-fold{display:none}}
.mnp-theme{display:flex;gap:2px;padding:3px;border-radius:11px;background:var(--seg-track,color-mix(in srgb,var(--fg) 6%,transparent))}
.mnp-theme button{flex:1 1 0;display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;height:34px;padding:0 6px;border:0;border-radius:8px;background:none;color:var(--muted);
  font:inherit;font-size:13px;cursor:pointer;transition:background .15s,color .15s}
.mnp-theme button .i{width:15px;height:15px;flex:none}
.mnp-theme button:hover{color:var(--fg)}
.mnp-theme button.on{background:var(--seg-thumb,var(--surface-1,#fff));color:var(--fg);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.12)}
.mnp-bgsw{--bgz:7px;display:inline-block;flex:none;width:24px;height:24px;border-radius:7px;border:1px solid var(--line-strong);background-color:var(--bg)}
.mnp-bgsw.big{--bgz:12px;width:100%;height:46px;border-radius:10px;filter:saturate(1.9) contrast(1.06)}
/* The chat list's foot: one row of four, Appearance (with a swatch of the backdrop) first. */
.mnp-sfoot{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2px;padding:6px 6px 8px;border-top:1px solid var(--line)}
.mnp-sfoot .mnp-set{flex-direction:column;justify-content:center;gap:4px;height:50px;padding:0 2px;font-size:11px;font-weight:550;text-align:center;border-radius:10px;color:var(--muted)}
.mnp-sfoot .mnp-look-btn .mnp-bgsw{display:none}
.mnp-sfoot .mnp-look-btn .i{color:var(--accent)}
.mnp-sfoot .mnp-look-btn[aria-expanded=true]{background:var(--hover);color:var(--fg)}
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
/* Phones always use the full width: the choice is not offered there. */
@media (max-width:640px){.mnp-look-wl,.mnp-look-w{display:none}}
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
.mnp-q{display:flex;align-items:center;gap:8px;margin:0 12px 8px;padding:0 11px;height:38px;border-radius:10px;border:1px solid var(--line-strong);background:var(--field-bg,var(--surface-0,var(--bg)));
  transition:border-color .15s,box-shadow .15s}
.mnp-q:hover{border-color:color-mix(in srgb,var(--fg) 26%,transparent)}
.mnp-q:focus-within{border-color:var(--accent-line,var(--accent));box-shadow:0 0 0 3px var(--accent-soft)}
.mnp-q .i{width:16px;height:16px;flex:none;color:var(--text-2,var(--fg));opacity:.8}
.mnp-q input{flex:1;min-width:0;border:0;outline:0;background:none;box-shadow:none;padding:0;font:inherit;font-size:13.5px;color:var(--fg)}
.mnp-q input::placeholder{color:var(--text-2,var(--fg));opacity:.7}
@media (max-width:760px){.mnp-q input{font-size:16px}}
.mnp-list{flex:1;min-height:0;overflow-y:auto;padding:0 8px 12px}
/* Show: All, Chats, From notes. */
.mnp-chips{display:flex;gap:4px;margin:0 12px 6px;overflow-x:auto;scrollbar-width:none}
.mnp-chips[hidden]{display:none}
.mnp-chip{flex:none;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:none;color:var(--muted);
  font:inherit;font-size:12px;font-weight:550;cursor:pointer;transition:background .12s,color .12s,border-color .12s}
.mnp-chip small{font-size:11px;opacity:.75;font-variant-numeric:tabular-nums}
.mnp-chip:hover{color:var(--fg);border-color:var(--line-strong)}
.mnp-chip.on{background:var(--fg);border-color:var(--fg);color:var(--bg)}
.mnp-g{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:6px;width:100%;margin:6px 0 1px;padding:9px 8px 5px;border:0;
  font:inherit;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;text-align:left;color:var(--muted);
  background:var(--side-bg,var(--bg))}
.mnp-g::after{display:none}
button.mnp-g{cursor:pointer}
button.mnp-g:hover{color:var(--fg)}
.mnp-g-chev{width:12px!important;height:12px!important;color:var(--muted)!important;transition:transform .15s}
.mnp-pins.shut .mnp-g-chev{transform:rotate(-90deg)}
.mnp-g.pin{color:var(--text-2,var(--fg))}
.mnp-g.pin::after{display:none}
.mnp-g.pin{padding-bottom:3px}
.mnp-g.pin .i{width:13px;height:13px;color:var(--accent)}
.mnp-g.pin small,.mnp-g.head small{margin-left:auto;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
.mnp-g.head{font-size:12.5px;color:var(--fg)}
.mnp-g.head::after,summary.mnp-g::after{display:none}
.mnp-g.head .i{width:13px;height:13px;color:var(--accent)}
.mnp-g.mnp-day{padding-top:10px}
/* Pinned chats: a block of their own, set apart from the dated list under it. */
.mnp-pins{margin:0 0 2px}
.mnp-row{position:relative;display:flex;align-items:center;gap:8px;min-height:34px;padding:5px 4px 5px 10px;border-radius:9px;cursor:pointer;color:var(--text-2,var(--fg));transition:background .12s,color .12s}
.mnp-row:hover{color:var(--fg)}
.mnp-row.on{color:var(--fg)}
.mnp-row.on::before{content:"";position:absolute;left:2px;top:9px;bottom:9px;width:3px;border-radius:3px;background:var(--accent)}
.mnp-row-ts{flex:none;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.mnp-row.unread .mnp-row-ts{color:var(--accent);font-weight:600}
@media (hover:hover){.mnp-row:hover .mnp-row-ts,.mnp-row.on .mnp-row-ts{display:none}}
.mnp.selecting .mnp-row-ts{display:none}
.mnp-row:hover{background:var(--hover)}
.mnp-row.on{background:color-mix(in srgb,var(--accent) 11%,transparent)}
.mnp-row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.mnp-row-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.mnp-row-t b{font-size:13.5px;font-weight:450;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-row.on .mnp-row-t b{font-weight:600}
.mnp-row.unread .mnp-row-t b{font-weight:650;color:var(--fg)}
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
.mnp-fleet[aria-pressed=true]{background:var(--fg);color:var(--bg)}
.mnp-fleet[aria-pressed=true]:hover{background:color-mix(in srgb,var(--fg) 85%,transparent);color:var(--bg)}
/* A fleeting chat: the page stays as it is (header, colours, backdrop); only the chat itself
   sits in a dark rounded room inside it. */
.mnp.fleeting .mnp-chat{padding:10px}
.mnp.fleeting .mnp-chat>.mn-chat{flex:1;height:auto;min-height:0}
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
/* The menu takes no room until it is wanted (the time shows there instead). */
@media (hover:hover){.mnp-row-more{display:none}.mnp-row:hover .mnp-row-more,.mnp-row.on .mnp-row-more,.mnp-row:focus-within .mnp-row-more{display:grid}}
/* Touch screens have no hover: the ⋯ is always there (iOS would spend the first tap on a hover). */
@media (hover:none){.mnp-row-more{opacity:.38}.mnp-row.on .mnp-row-more{opacity:.8}}
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
.mnp-at{display:inline-block;margin-right:5px;padding:0 4px;border-radius:5px;font:600 11px/16px var(--mono);color:var(--muted);vertical-align:1px;
  background:color-mix(in srgb,var(--fg) 6%,transparent)}
.mnp-row-run{display:grid;place-items:center;flex:none;width:18px;height:18px}
.mnp.selecting .mnp-row-run{display:none}
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
.mnp-ren-l input{width:100%;height:42px;padding:0 12px;border:1px solid var(--line-strong);border-radius:10px;background:var(--field-bg,var(--surface-0,var(--bg)));color:var(--fg);
  font:inherit;font-size:14px;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}
.mnp-ren-l input:hover{border-color:color-mix(in srgb,var(--fg) 26%,transparent)}
.mnp-ren-l input:focus{outline:none;border-color:var(--accent-line,var(--accent));box-shadow:0 0 0 3px var(--accent-soft)}
@media (max-width:640px){.mnp-ren-l input{font-size:16px}}
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

/* The last row of the side list: every chat, on its own page. */
.mnp-allrow{display:flex;align-items:center;gap:10px;width:100%;margin-top:8px;padding:9px 8px;border:0;border-top:1px solid var(--line);border-radius:0;background:none;color:var(--text-2,var(--fg));
  font:inherit;font-size:13px;font-weight:560;text-align:left;cursor:pointer}
.mnp-allrow:hover,.mnp-allrow:focus-visible{background:var(--hover);border-radius:10px;outline:none}
.mnp-allrow span{flex:1}
.mnp-allrow small{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.mnp-allrow .i{width:15px;height:15px;flex:none;color:var(--muted)}
/* All chats (/mnemo/chats): over the whole Mnemo page. */
.mnp-all{position:absolute;inset:0;z-index:30;overflow-y:auto;background:var(--bg)}
.mnp-all[hidden]{display:none}
.mnp-all-in{max-width:760px;margin:0 auto;padding:16px 20px 40px}
.mnp-all-h{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;margin:0 -4px 10px;padding:6px 4px;background:var(--bg)}
.mnp-all-h b{font-size:17px;font-weight:680;letter-spacing:-.01em}
.mnp-all-h .mn-ibtn{width:36px;height:36px}
.mnp-all-h .mn-ibtn .i{width:19px;height:19px}
.mnp-all-q{margin:0 0 10px}
.mnp-all-bar{margin:0 0 10px}
.mnp-all-g{margin-bottom:10px}
.mnp-all-g .mnp-g span{margin-left:4px;font-weight:500;opacity:.8}
.mnp-all-arch>summary{display:flex;align-items:center;gap:4px;list-style:none;cursor:pointer;border-radius:8px}
.mnp-all-arch>summary::-webkit-details-marker{display:none}
.mnp-all-arch>summary:hover{color:var(--fg)}
.mnp-all-chev{width:13px;height:13px;transition:transform .15s}
.mnp-all-arch[open] .mnp-all-chev{transform:rotate(90deg)}
.mnp-all .mnp-row{padding:9px 6px 9px 10px}
.mnp-all .mnp-row-more{opacity:1}
@media (hover:hover){.mnp-all .mnp-row-more{display:grid}}
@media (max-width:760px){.mnp-all{position:fixed;z-index:60}.mnp-all-in{padding:10px 14px calc(28px + env(safe-area-inset-bottom,0px))}}
@media (prefers-reduced-motion:reduce){.mnp-all-chev{transition:none}}
/* ===== Chat list, 2.2: an icon rail for actions, then the chats (pinned tiles, rows that read
   like conversations: a coloured tile, the title and its time, a line of the last message). ===== */
.mnp{--sw:328px}
@media (max-width:900px){.mnp{--sw:300px}}
.mnp.side-closed{--sw:0px}
.mnp-side{--side-bg:var(--surface-0,var(--bg));display:grid;grid-template-columns:52px minmax(0,1fr);background:var(--side-bg)}
.mnp-rail{display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 0 10px;border-right:1px solid var(--line);
  background:color-mix(in srgb,var(--fg) 2.5%,var(--side-bg))}
.mnp-rail-mark{display:grid;place-items:center;margin-bottom:8px}
.mnp-rail-mark .mn-mark{--s:30px}
.mnp-rb,.mnp-rb-new{position:relative;display:grid;place-items:center;width:38px;height:38px;padding:0;border:0;border-radius:11px;background:none;color:var(--muted);
  cursor:pointer;transition:background .14s,color .14s,transform .14s}
.mnp-rb .i,.mnp-rb-new .i{width:19px;height:19px;stroke-width:1.9}
.mnp-rb:hover{background:var(--hover);color:var(--fg)}
.mnp-rb.on,.mnp-rb[aria-expanded=true]{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.mnp-rb:focus-visible,.mnp-rb-new:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.mnp-rb-new{margin-bottom:6px;background:var(--accent);color:var(--accent-fg,#fff);box-shadow:0 6px 16px -8px color-mix(in srgb,var(--accent) 80%,transparent)}
.mnp-rb-new .i{stroke-width:2.4}
.mnp-rb-new:hover{transform:translateY(-1px);background:color-mix(in srgb,var(--accent) 88%,var(--fg))}
.mnp-rb.mnp-look-btn{color:var(--accent)}
.mnp-rb .mnp-bgsw{display:none}
.mnp-panel{display:flex;flex-direction:column;min-width:0;min-height:0}
.mnp-ph{display:flex;align-items:center;gap:8px;padding:16px 10px 10px 16px}
.mnp-ph b{font-size:17px;font-weight:700;letter-spacing:-.015em}
.mnp-ph small{font-size:12px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
.mnp-ph .mnp-manage{width:32px;height:32px;border:0;background:none}
.mnp-ph .mnp-manage:hover{background:var(--hover)}
.mnp-panel .mnp-q{margin:0 12px 10px;height:36px;border:0;border-radius:10px;background:color-mix(in srgb,var(--fg) 6%,transparent)}
.mnp-panel .mnp-q:focus-within{background:var(--side-bg);box-shadow:0 0 0 1.5px var(--accent-line,var(--accent)),0 0 0 4px var(--accent-soft)}
.mnp-panel .mnp-q input::placeholder{color:var(--muted);opacity:1}
.mnp-chips{display:flex;gap:2px;margin:0 12px 6px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--fg) 5%,transparent)}
.mnp-chip{flex:1 1 0;justify-content:center;height:26px;padding:0 8px;border:0;border-radius:8px;background:none;color:var(--muted);font-size:12px}
.mnp-chip:hover{color:var(--fg)}
.mnp-chip.on{background:var(--side-bg);color:var(--fg);border:0;box-shadow:0 1px 2px rgba(15,23,42,.14)}
.mnp-panel .mnp-list{padding:0 8px 14px}
.mnp-panel .mnp-g{position:sticky;top:0;z-index:2;margin:8px 0 2px;padding:8px 8px 4px;font-size:11.5px;font-weight:650;letter-spacing:0;text-transform:none;color:var(--muted);background:var(--side-bg)}
.mnp-panel .mnp-g.pin{color:var(--muted)}
.mnp-panel .mnp-g.pin small{margin-left:4px}
.mnp-panel .mnp-g-chev{margin-left:auto}
.mnp-panel .mnp-pins{margin:0 0 4px;padding-bottom:6px;border-bottom:1px solid var(--line)}
/* Pinned: tiles, three to a row. */
.mnp-pin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:2px 2px 8px}
.mnp-pin{position:relative;display:flex;align-items:center;gap:8px;min-width:0;min-height:52px;padding:8px 8px;border-radius:12px;cursor:pointer;
  background:color-mix(in srgb,var(--fg) 3.5%,transparent);transition:background .14s,transform .14s}
.mnp-pin:hover{background:var(--hover)}
@media (hover:hover){.mnp-pin:hover,.mnp-pin:focus-within{padding-right:32px}}
.mnp-pin.on{padding-right:32px;background:color-mix(in srgb,var(--accent) 13%,transparent);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--accent) 45%,transparent)}
.mnp-pin:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.mnp-pin-t{flex:1;min-width:0;font-size:12px;font-weight:600;line-height:1.3;text-align:left;color:var(--text-2,var(--fg));display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.mnp-pin.unread .mnp-pin-t{color:var(--fg);font-weight:700}
.mnp-pin-dot{position:absolute;top:6px;left:6px;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px var(--side-bg)}
.mnp-pin .mnp-row-more{position:absolute;top:50%;right:4px;width:26px;height:26px;transform:translateY(-50%);background:var(--side-bg)}
/* Tiles: two initials on a soft tint of the chat's own colour. */
.mnp-av{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:10px;font-size:12.5px;font-weight:700;letter-spacing:.02em;
  background:hsl(var(--h) 70% 55% / .15);color:hsl(var(--h) 55% 36%)}
:root:not([data-theme=light]) .mnp-av{background:hsl(var(--h) 60% 60% / .16);color:hsl(var(--h) 75% 74%)}
.mnp-av.note{font-family:var(--mono,ui-monospace,monospace);font-size:15px}
.mnp-av.big{width:32px;height:32px;border-radius:10px;font-size:12px}
.mnp-av .mnp-spin{width:15px;height:15px}
/* Rows: tile, title and time, then a line of the last message. */
.mnp-panel .mnp-row{gap:8px;min-height:50px;padding:6px 6px 6px 10px;border-radius:11px;color:var(--fg)}
.mnp-kind{display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:9px;color:var(--muted);background:color-mix(in srgb,var(--fg) 5.5%,transparent)}
.mnp-kind .i{width:16px;height:16px;stroke-width:1.9}
.mnp-kind.note{color:#0d9488;background:color-mix(in srgb,#14b8a6 13%,transparent)}
:root:not([data-theme=light]) .mnp-kind.note{color:#5eead4}
.mnp-kind.folder{color:#b45309;background:color-mix(in srgb,#f59e0b 14%,transparent)}
:root:not([data-theme=light]) .mnp-kind.folder{color:#fbbf24}
.mnp-row.on .mnp-kind.chat{color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent)}
.mnp-kind .mnp-spin{width:14px;height:14px}
.mnp-row-l1 .mnp-at{flex:none;margin:0;padding:0 4px;border-radius:5px;font:600 11px/16px var(--mono,ui-monospace,monospace);color:var(--muted);background:color-mix(in srgb,var(--fg) 7%,transparent)}
.mnp-panel .mnp-row::before{display:none}
.mnp-panel .mnp-row:hover{background:var(--hover)}
.mnp-panel .mnp-row.on{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.mnp-panel .mnp-row-t{gap:2px}
.mnp-row-l1,.mnp-row-l2{display:flex;align-items:center;gap:8px;min-width:0}
.mnp-row-l1 b{flex:1;min-width:0;font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-row-l2 small{flex:1;min-width:0;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnp-row-l2 small em{font-style:normal;color:var(--text-2,var(--fg))}
.mnp-panel .mnp-row-ts{font-size:11px}
.mnp-panel .mnp-row.unread .mnp-row-l1 b{font-weight:750}
.mnp-panel .mnp-row.unread .mnp-row-l2 small{color:var(--text-2,var(--fg))}
.mnp-panel .mnp-newn{min-width:18px;height:18px;font-size:10.5px}
.mnp-panel .mnp-row-more{align-self:center}
@media (hover:hover){.mnp-panel .mnp-row:hover .mnp-row-ts{display:inline}.mnp-panel .mnp-row .mnp-row-more{display:none}.mnp-panel .mnp-row:hover .mnp-row-more,.mnp-panel .mnp-row:focus-within .mnp-row-more{display:grid}
  .mnp-pin .mnp-row-more{display:none}.mnp-pin:hover .mnp-row-more,.mnp-pin:focus-within .mnp-row-more{display:grid}}
@media (hover:none){.mnp-panel .mnp-row .mnp-row-more{display:none}.mnp-panel .mnp-row.on .mnp-row-more{display:grid;opacity:.8}.mnp-pin .mnp-row-more{display:none}.mnp-pin.on .mnp-row-more{display:grid}}
.mnp-panel .mnp-allrow{margin-top:8px}
/* Desktop: hiding the list keeps the rail; tablets and phones hide it all. */
@media (min-width:1025px){
  .mnp.side-closed{--sw:52px}
  .mnp.side-closed .mnp-side{visibility:visible;grid-template-columns:52px 0}
  .mnp.side-closed .mnp-panel{display:none}
  .mnp.side-closed .mnp-rail{border-right:0;cursor:e-resize}
  .mnp.side-closed .mnp-rail:hover{background:color-mix(in srgb,var(--fg) 4.5%,var(--side-bg))}
  .mnp.side-closed .mnp-rail button{cursor:pointer}
  .mnp .mnp-lists{display:none!important}
  .mnp.side-closed .mnp-fold .i{transform:scaleX(-1)}
  .mnp.side-closed .mnp-fold{color:var(--accent)}
}
@media (max-width:760px){
  .mnp-side{width:min(360px,92vw);background:var(--side-bg)}
  .mnp-ph{padding-top:14px}
}
/* ===== Chat list, 3.0: a roomier list on desktop; a drawer over the chat on tablets and a whole
   screen on phones, each with its own header (title, New chat, Close). Every row shows its ⋯
   (faint until pointed at, always there on touch), its time and its unread count. ===== */
.mnp{--sw:360px}
@media (min-width:1440px){.mnp{--sw:384px}}
.mnp-ph{gap:6px;min-height:58px;padding-block:12px 8px;padding-inline:16px 10px}
.mnp-ph b{font-size:18px}
.mnp-sidex{display:none;place-items:center;flex:none;width:36px;height:36px;padding:0;border:0;border-radius:10px;background:none;color:var(--text-2,var(--fg));cursor:pointer;transition:background .15s,color .15s}
.mnp-sidex:hover{background:var(--hover);color:var(--fg)}
.mnp-sidex .i{width:19px;height:19px;stroke-width:2}
:is(.mnp-sidex,.mnp-ph .mnp-new,.mnp-ph .mnp-manage):focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.mnp-panel .mnp-list{padding-block:0 16px;padding-inline:10px}
.mnp-panel .mnp-g{margin-block:10px 2px;padding-block:8px 5px;padding-inline:10px;font-size:12px}
.mnp-panel .mnp-row{gap:10px;min-height:58px;padding-block:8px;padding-inline:10px 4px;border-radius:12px}
.mnp-panel .mnp-row+.mnp-row{margin-top:1px}
.mnp-panel .mnp-row-t{gap:3px}
.mnp-panel .mnp-row-l1 b{font-size:14px}
.mnp-panel .mnp-kind{width:34px;height:34px;border-radius:10px}
.mnp-panel .mnp-kind .i{width:17px;height:17px}
/* The open chat: a tint and an accent bar on its leading edge. */
.mnp-panel .mnp-row.on::before{display:block;content:"";position:absolute;left:auto;right:auto;inset-inline-start:0;top:14px;bottom:14px;width:3px;border-radius:3px;background:var(--accent)}
.mnp:not(.selecting) .mnp-panel .mnp-row .mnp-row-ts{display:inline}
.mnp-panel .mnp-row.unread .mnp-newn{display:inline-grid}
/* The ⋯ is always in the row: faint at rest, full on the hovered, focused or open row. */
.mnp-panel .mnp-row .mnp-row-more{display:grid;flex:none;align-self:center;width:30px;height:30px;border-radius:9px;color:var(--muted);opacity:.5;transition:opacity .15s,background .15s,color .15s}
.mnp-panel .mnp-row:is(:hover,:focus-within,.on) .mnp-row-more{opacity:1}
.mnp-panel .mnp-row .mnp-row-more:hover{background:color-mix(in srgb,var(--fg) 9%,transparent);color:var(--fg)}
.mnp-panel .mnp-row .mnp-row-more:focus-visible,.mnp-all .mnp-row .mnp-row-more:focus-visible{opacity:1;outline:2px solid var(--accent);outline-offset:-2px}
.mnp-panel .mnp-row .mnp-row-more .i{width:17px;height:17px}
/* Touch: no hover to find it, so the ⋯ is plain to see and a full finger wide. */
@media (hover:none),(pointer:coarse){
  .mnp-panel .mnp-row .mnp-row-more,.mnp-all .mnp-row .mnp-row-more{display:grid;width:40px;height:40px;opacity:.85;color:var(--text-2,var(--fg))}
  .mnp-panel .mnp-row{min-height:62px;padding-inline-end:2px}
  .mnp-panel .mnp-row-l1 b{font-size:14.5px}
}
/* Tablets and phones: the list is a drawer over the chat, opened from the header. */
@media (max-width:1024px){
  .mnp,.mnp.side-closed{--sw:0px}
  .mnp>.mnp-side{position:absolute;top:0;bottom:0;inset-inline-start:0;z-index:9;grid-column:auto;grid-row:auto;width:min(420px,86vw);border-right:0;
    box-shadow:0 0 0 1px var(--line),0 24px 64px -16px rgba(15,23,42,.4);visibility:visible;transform:none;transition:transform .3s cubic-bezier(.22,.8,.24,1)}
  .mnp:not(.side-open)>.mnp-side{visibility:hidden;transform:translateX(-104%);transition:transform .3s cubic-bezier(.22,.8,.24,1),visibility 0s linear .3s}
  [dir=rtl] .mnp:not(.side-open)>.mnp-side{transform:translateX(104%)}
  .mnp.side-open>.mnp-side{visibility:visible}
  .mnp-scrim{display:block;position:absolute;inset:0;z-index:8;background:var(--scrim,rgba(15,23,42,.3));opacity:0;pointer-events:none;transition:opacity .2s}
  .mnp.side-open .mnp-scrim{opacity:1;pointer-events:auto}
  .mnp:not(.side-closed) .mnp-lists,.mnp.side-closed .mnp-lists{display:inline-grid}
  .mnp-ph .mnp-sidex{display:grid}
  .mnp-ph .mnp-new{display:grid!important;width:36px;height:36px;border:0;border-radius:10px;background:var(--accent);color:var(--accent-fg,var(--on-accent,#fff))}
  .mnp-ph .mnp-new:hover{background:color-mix(in srgb,var(--accent) 88%,var(--fg))}
  /* The header has New chat and the search field is right there: the rail drops both. */
  .mnp-rail .mnp-rb-new,.mnp-rail #mnpSearchBtn,.mnp-rail .mnp-fold{display:none}
}
/* Phones: the list takes the whole screen; the rail turns into a bar along the bottom. */
@media (max-width:760px){
  .mnp>.mnp-side{inset:0;width:100%;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto;padding-top:env(safe-area-inset-top,0px);box-shadow:none;background:var(--side-bg)}
  .mnp-side>.mnp-panel{grid-row:1;grid-column:1}
  .mnp-side>.mnp-rail{grid-row:2;grid-column:1;flex-direction:row;align-items:center;justify-content:space-around;gap:2px;
    padding-block:6px calc(6px + env(safe-area-inset-bottom,0px));padding-inline:8px;border-right:0;border-top:1px solid var(--line)}
  .mnp-side>.mnp-rail .mnp-rail-mark,.mnp-side>.mnp-rail .mnp-grow{display:none}
  .mnp-side>.mnp-rail .mnp-rb{flex:1 1 0;width:auto;max-width:76px;height:44px}
  .mnp-ph{min-height:60px;padding-block:10px 8px;padding-inline:18px 8px}
  .mnp-ph b{font-size:20px}
  .mnp-ph .mnp-new,.mnp-ph .mnp-sidex,.mnp-ph .mnp-manage{width:40px;height:40px}
  .mnp-panel .mnp-q{margin-inline:14px;height:42px}
  .mnp-panel .mnp-chips{margin-inline:14px}
  .mnp-panel .mnp-list{padding-inline:8px}
  .mnp-panel .mnp-chip{height:30px}
}
@media (prefers-reduced-motion:reduce){.mnp>.mnp-side,.mnp:not(.side-open)>.mnp-side{transition:none}}
/* Fleeting (the capsule beside the model): its own small surface over the chat. */
.mn-top .mnp-fleet{width:34px;height:34px;border-radius:50%;border:1px solid var(--line-strong);box-shadow:0 8px 20px -12px rgba(15,23,42,.35)}
.mn-top .mnp-fleet:not([aria-pressed=true]){background:var(--surface-1,var(--panel))}
.mn-top .mnp-fleet:not([aria-pressed=true]):hover{background:color-mix(in srgb,var(--fg) 6%,var(--surface-1,var(--panel)))}
@media (pointer:coarse){.mn-top .mnp-fleet{width:38px;height:38px}}
/* Phones, fleeting: one dark sheet from edge to edge: a compact header (title, New, More,
   Close), the model under it, the chat, and the message box above the home indicator. */
@media (max-width:760px){
  :root[data-page=assistant] .mnp.fleeting{background:#0d0f13;padding-bottom:0}
  .mnp.fleeting .mnp-head{color-scheme:dark;--fg:#e6e8ec;--text-2:#c4c8d0;--muted:#8d94a0;--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.15);--hover:rgba(255,255,255,.06);
    --surface-1:#191d23;--accent:#5eead4;--accent-soft:rgba(94,234,212,.14);color:var(--fg);background:#0d0f13;border-bottom-color:var(--line);min-height:52px;gap:2px;padding-block:4px;padding-inline:16px 6px}
  .mnp.fleeting .mnp-head .mnp-title small{color:var(--muted)}
  .mnp.fleeting .mnp-lists,.mnp.fleeting .mnp-hsep,.mnp.fleeting .mnp-artbtn:has(.mnp-artn[hidden]){display:none}
  .mnp.fleeting .mnp-head .mn-ibtn{width:40px;height:40px;border-radius:12px}
  .mnp.fleeting .mnp-head .mn-ibtn .i{width:19px;height:19px}
  .mnp.fleeting .mn-comp{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}
  .mnp.fleeting.kb .mn-comp{padding-bottom:10px}
}

/* Resizable panes on desktop: a thin handle on the edge of the chat list and of the side
   panel; each keeps a sensible minimum so nothing gets squashed. */
.mnp-grip{display:none;position:absolute;top:0;bottom:0;width:10px;z-index:7;cursor:col-resize;touch-action:none;outline:none}
.mnp-grip::after{content:"";position:absolute;left:50%;top:50%;width:4px;height:44px;translate:-50% -50%;border-radius:99px;background:var(--line-strong);opacity:0;transition:opacity .15s,background .15s,height .15s}
.mnp-grip:hover::after,.mnp-grip:focus-visible::after,.mnp.resizing .mnp-grip::after{opacity:1;height:64px;background:var(--accent)}
.mnp.resizing{transition:none;user-select:none;cursor:col-resize}
.mnp.resizing iframe{pointer-events:none}
@media (min-width:1025px) and (pointer:fine){
  :root:not(.mn-pv-split) .mnp.sw-set:not(.side-closed),:root.mn-pv-roomy .mnp.sw-set:not(.side-closed){--sw:var(--sw-u)}
  .mnp:not(.side-closed):not(.fleeting)>.mnp-grip[data-g=side]{display:block;inset-inline-start:calc(var(--sw) - 5px)}
  :root.mn-pv-split:not(.mn-pv-roomy) .mnp>.mnp-grip[data-g=side]{display:none}
}
@media (min-width:1100px) and (pointer:fine){
  :root:not(.mn-pv-split) .mnp.ag-open.aw-ag{--aw:var(--aw-ag)}
  :root:not(.mn-pv-split) .mnp.art-open:not(.ag-open).aw-art{--aw:var(--aw-art)}
  :root:not(.mn-pv-split) .mnp:is(.ag-open,.art-open)>.mnp-grip[data-g=right]{display:block;inset-inline-end:calc(var(--aw) - 5px)}
}
`;
