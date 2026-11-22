// A quiet note shown once, on the first visit after updating to 3.0.0: if Memora has been
// useful, a star on GitHub or telling someone helps. Any tap puts it away for good.

import { esc, useStyles } from '../dom';
import { t } from '../i18n';
import { icon } from '../ui/icons';
import { toast } from '../toast';

export const REPO_URL = 'https://github.com/Codrihub/memora';
export const SITE_URL = 'https://memora.codrihub.tech';

const KEY = 'memora.promo.v1';

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === 'done';
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(KEY, 'done');
  } catch {
    /* storage blocked */
  }
}

/** Share Memora: the system sheet where there is one, else the link is copied. */
export async function shareMemora(): Promise<boolean> {
  // The website first, the source on GitHub with it.
  const text = `${t('Memora: a notes vault you host yourself, with an agent that tidies it.')}\nGitHub: ${REPO_URL}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Memora', text, url: SITE_URL });
      return true;
    }
    await navigator.clipboard.writeText(`${SITE_URL}\n${REPO_URL}`);
    toast(t('Link copied'), 'ok');
    return true;
  } catch {
    return false;
  }
}

/** Open the note on request (the account menu's Share Memora), seen before or not. */
export function openPromo(): void {
  document.querySelector('.mpr')?.remove();
  render(false);
}

/** Show the note once, a little after the app has opened. */
export function initPromo(): void {
  if (seen()) return;
  window.setTimeout(() => show(0), 8_000);
}

function show(tries: number): void {
  if (seen() || document.querySelector('.mpr')) return;
  // Only in the signed-in app, after the welcome tour, never over a dialog: wait for a calm
  // moment (a few minutes at most).
  if (!document.getElementById('appShell') || document.querySelector('.modal-backdrop, [role=dialog][aria-modal=true], .wl-tour') || document.hidden || location.pathname === '/welcome') {
    if (tries < 20) window.setTimeout(() => show(tries + 1), 15_000);
    return;
  }
  render(true);
}

/** Draw the note: in the corner on wide screens, a bottom sheet on phones. Shown by itself,
 *  it closes after a few seconds (paused while pointed at or focused); X closes it at once. */
function render(auto: boolean): void {
  useStyles('memora-promo', CSS);
  const box = document.createElement('aside');
  box.className = 'mpr';
  box.setAttribute('aria-label', t('A note from Memora'));
  box.classList.toggle('auto', auto);
  box.innerHTML = `${auto ? '<i class="mpr-tm" aria-hidden="true"></i>' : ''}<button type="button" class="mpr-x" data-later aria-label="${esc(t('Close'))}" title="${esc(t('Close'))}">${icon('close')}</button>
    <b>${esc(t('Memora is free and open source'))}</b>
    <p>${esc(t("If it's been useful to you, a star on GitHub or telling a friend helps others find it. No worries if not."))}</p>
    <div class="mpr-a">
      <a class="btn sm" href="${REPO_URL}" target="_blank" rel="noopener" data-star>${icon('star')}<span>${esc(t('Star on GitHub'))}</span></a>
      <button type="button" class="btn ghost sm" data-share>${icon('send')}<span>${esc(t('Share'))}</span></button>
      <button type="button" class="mpr-no" data-off>${esc(t('No thanks'))}</button>
    </div>`;
  markSeen();
  const close = (): void => {
    box.classList.add('out');
    window.setTimeout(() => box.remove(), 220);
  };
  box.querySelector<HTMLElement>('[data-later]')!.onclick = () => close();
  // The timer bar runs out in five seconds, then the note goes by itself.
  box.querySelector<HTMLElement>('.mpr-tm')?.addEventListener('animationend', () => close());
  box.querySelector<HTMLElement>('[data-off]')!.onclick = () => close();
  box.querySelector<HTMLElement>('[data-star]')!.onclick = () => close();
  box.querySelector<HTMLElement>('[data-share]')!.onclick = () =>
    void shareMemora().then((ok) => {
      if (ok) close();
    });
  document.body.append(box);
}

const CSS = `
.mpr{position:fixed;inset-inline-end:20px;bottom:20px;z-index:80;width:min(340px,calc(100vw - 40px));padding:16px 16px 12px;border:1px solid var(--line-strong);border-radius:16px;overflow:hidden;
  background:var(--surface-0,var(--bg));color:var(--fg);box-shadow:0 22px 50px -20px rgba(15,23,42,.4);animation:mprIn .3s var(--ease-out,ease-out) both}
.mpr.out{animation:mprOut .2s ease-in both}
.mpr>b{display:block;padding-inline-end:28px;font-size:14px;font-weight:620}
.mpr>p{margin:6px 0 12px;font-size:13px;line-height:1.5;color:var(--muted)}
.mpr-a{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.mpr-a .btn .i{width:14px;height:14px}
.mpr-no{margin-inline-start:auto;padding:4px 6px;border:0;background:none;font:inherit;font-size:12.5px;color:var(--muted);cursor:pointer;border-radius:8px}
.mpr-no:hover{color:var(--fg);background:var(--hover)}
.mpr-x{position:absolute;top:8px;inset-inline-end:8px;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:none;color:var(--muted);cursor:pointer}
.mpr-x:hover{background:var(--hover);color:var(--fg)}
.mpr-x .i{width:14px;height:14px}
.mpr-tm{position:absolute;inset-inline:0;top:0;height:3px;background:var(--accent);transform-origin:left;animation:mprTm 5s linear forwards}
[dir=rtl] .mpr-tm{transform-origin:right}
.mpr:hover .mpr-tm,.mpr:focus-within .mpr-tm{animation-play-state:paused}
@keyframes mprTm{from{transform:scaleX(1)}to{transform:scaleX(0)}}
@keyframes mprIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes mprOut{to{opacity:0;transform:translateY(10px)}}
/* Phones: a bottom sheet. */
@media (max-width:640px){
  .mpr{inset-inline:0;bottom:0;width:auto;border-radius:18px 18px 0 0;border-bottom:0;padding:18px 18px calc(16px + env(safe-area-inset-bottom));animation-name:mprUp}
  .mpr::before{content:"";display:block;width:36px;height:4px;margin:-6px auto 12px;border-radius:4px;background:var(--line-strong)}
  .mpr-a .btn{flex:1;justify-content:center}
  .mpr-no{flex-basis:100%;margin:4px 0 0;text-align:center}
}
@keyframes mprUp{from{transform:translateY(100%)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.mpr,.mpr.out{animation:none}.mpr-tm{animation-duration:5s}}
`;
