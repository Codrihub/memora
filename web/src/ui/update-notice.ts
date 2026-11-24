// A quiet heads-up when a newer Memora is out: a small card that slides down from the top (below the
// top bar), once per version per browser. It waits for a calm moment (never during the welcome tour,
// a dialog, typing, an open menu or the phone keyboard), stays about 12 s (paused while hovered or
// touched), and goes with ×, Later or a swipe up. No backdrop, nothing blocked. The Overview card and
// Settings › Version keep saying it; a server with the release check off (MEMORA_UPDATE_CHECK=false)
// has no data, so nothing shows. Toasts stay at the bottom, so the two never look alike.

import { attr, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { t } from '../i18n';
import { markSvg } from '../brand';
import { markUpdateNoticeSeen, updateNoticeSeen } from '../storage';
import { requestSettingsSection, type UpdateInfo } from '../version';
import { icon } from './icons';

const CSS = `
.upd{position:fixed;z-index:70;left:50%;top:var(--upd-top,12px);width:min(420px,calc(100vw - 24px));box-sizing:border-box;
  transform:translate(-50%,0);padding:14px 14px 12px 16px;border-radius:16px;border:1px solid var(--line-strong);
  background:color-mix(in srgb,var(--panel) 94%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
  color:var(--fg);box-shadow:0 8px 28px rgba(0,0,0,.12);touch-action:pan-x;transition:transform .32s var(--ease-out,ease),opacity .32s}
.upd.out{transform:translate(-50%,calc(-100% - var(--upd-top,12px) - 8px));opacity:0}
.upd-row{display:flex;align-items:flex-start;gap:12px}
.upd-mark{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--accent-soft)}
.upd-mark svg{width:22px;height:22px}
.upd-t{flex:1;min-width:0}
.upd-t b{display:block;font-size:14.5px;font-weight:650;line-height:1.35}
.upd-t p{margin:2px 0 0;font-size:13px;line-height:1.45;color:var(--text-2)}
.upd-x{flex:none;display:grid;place-items:center;width:30px;height:30px;margin:-4px -4px 0 0;border:0;border-radius:8px;background:none;color:var(--muted);cursor:pointer}
.upd-x:hover{background:var(--hover);color:var(--fg)}
.upd-x svg{width:16px;height:16px}
.upd-acts{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.upd-grab{width:36px;height:4px;margin:10px auto -4px;border-radius:99px;background:var(--line-strong)}
@media (hover:hover) and (pointer:fine){.upd-grab{display:none}}
@media (max-width:760px){.upd{width:calc(100vw - 24px)}.upd-acts .btn{flex:1 1 0;min-height:40px}.upd-x{width:40px;height:40px;margin:-8px -8px 0 0}}
@media (prefers-reduced-motion:reduce){.upd{transition:opacity .2s}.upd.out{transform:translate(-50%,0)}}
`;

const SHOW_AFTER = 10_000;
const RETRY = 15_000;
const STAY = 12_000;

let lastKey = 0;
let tourSeen = false;

/** Whether now is a calm moment: nothing open, nobody typing, the page in view. */
function calm(): boolean {
  if (document.hidden) return false;
  if (document.querySelector('.wl-tour')) {
    // A first sign-in: the tour is enough for today.
    tourSeen = true;
    return false;
  }
  const host = document.getElementById('modalHost');
  if (host && !host.classList.contains('hidden')) return false;
  if (document.querySelector('.vx-menu, .cc-menu, .ui-sel-pop, .pmenu.open, .pm-open')) return false;
  if (document.documentElement.classList.contains('kb-open')) return false;
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || a.closest('.cm-editor, .cf'))) return false;
  return Date.now() - lastKey > 4000;
}

/** Where the card sits: just under the top bar when one shows (never over its buttons or search),
 *  else under the safe area at the top. */
function topOffset(): string {
  const bar = document.getElementById('topbar');
  const r = bar && bar.offsetParent !== null ? bar.getBoundingClientRect() : null;
  return r && r.height > 0 && r.bottom > 0 ? `${Math.round(r.bottom + 8)}px` : 'calc(12px + env(safe-area-inset-top, 0px))';
}

/** Wait for the release check, then for a calm moment, then show the notice once. */
export function initUpdateNotice(pending: Promise<UpdateInfo> | null): void {
  if (!pending) return;
  document.addEventListener('keydown', () => (lastKey = Date.now()), true);
  void pending.then((u) => {
    if (!u.available || !u.latest || updateNoticeSeen() === u.latest) return;
    const version = u.latest;
    const attempt = (): void => {
      if (tourSeen || updateNoticeSeen() === version) return;
      if (!calm()) {
        window.setTimeout(attempt, RETRY);
        return;
      }
      show(version);
    };
    window.setTimeout(attempt, SHOW_AFTER);
  });
}

function show(version: string): void {
  useStyles('upd-css', CSS);
  // Shown is enough: this browser does not hear about this version again.
  markUpdateNoticeSeen(version);
  const card = document.createElement('aside');
  card.className = 'upd out';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.setAttribute('aria-labelledby', 'updT');
  card.style.setProperty('--upd-top', topOffset());
  card.innerHTML = `<div class="upd-row"><span class="upd-mark" aria-hidden="true">${markSvg('upd-logo')}</span>
      <div class="upd-t"><b id="updT">${esc(t('Memora v{version} is available', { version }))}</b><p>${esc(t('A few improvements are ready. Update when it suits you.'))}</p></div>
      <button type="button" class="upd-x" data-x aria-label="${attr(t('Close'))}" title="${attr(t('Close'))}">${icon('close')}</button></div>
    <div class="upd-acts"><button type="button" class="btn sm ghost" data-later>${esc(t('Later'))}</button><button type="button" class="btn sm primary" data-see>${esc(
      t("See what's new"),
    )}</button></div><div class="upd-grab" aria-hidden="true"></div>`;
  document.body.appendChild(card);
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('out')));

  let timer = 0;
  let gone = false;
  const close = (): void => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    card.classList.add('out');
    window.setTimeout(() => card.remove(), 400);
  };
  const arm = (): void => {
    clearTimeout(timer);
    timer = window.setTimeout(close, STAY);
  };
  const hold = (): void => clearTimeout(timer);
  card.addEventListener('pointerenter', hold);
  card.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') arm();
  });
  card.addEventListener('focusin', hold);
  card.addEventListener('focusout', (e) => {
    if (!card.contains(e.relatedTarget as Node | null)) arm();
  });
  card.querySelector<HTMLElement>('[data-x]')!.onclick = close;
  card.querySelector<HTMLElement>('[data-later]')!.onclick = close;
  card.querySelector<HTMLElement>('[data-see]')!.onclick = () => {
    close();
    requestSettingsSection('stVersion');
    hooks.go('settings');
  };
  // A swipe up puts it away; a touch holds it while the finger is down.
  let y0 = 0;
  let dy = 0;
  let down = false;
  card.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    down = true;
    y0 = e.clientY;
    dy = 0;
    hold();
    card.style.transition = 'none';
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener('pointermove', (e) => {
    if (!down) return;
    dy = Math.min(0, e.clientY - y0);
    card.style.transform = `translate(-50%, ${dy}px)`;
  });
  const up = (): void => {
    if (!down) return;
    down = false;
    card.style.transition = '';
    card.style.transform = '';
    if (dy < -36) close();
    else arm();
  };
  card.addEventListener('pointerup', up);
  card.addEventListener('pointercancel', up);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && card.contains(document.activeElement)) close();
    },
    true,
  );
  arm();
}
