// First-run vault screen, shown alone after sign-in while the server has no vault folder configured.

import { apiPost } from '../api';
import { el, esc, useStyles } from '../dom';
import { mountVaultForm, notesLabel } from '../vault';
import type { SettingsInfo, VaultSwitchResult } from '../types';
import { BRAND_MOTTO, BRAND_TAG, markSvg } from '../brand';
import { BRAND_FONT } from '../brand-font';
import { icon } from '../ui/icons';
import { constellation } from './welcome';

const CSS = `
.ob{position:fixed;inset:0;z-index:70;overflow:auto;background:var(--bg);display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}
.ob-side{order:2}
.ob-side{position:relative;overflow:hidden;isolation:isolate;margin:12px;border-radius:22px;padding:36px 40px;display:flex;flex-direction:column;justify-content:space-between;gap:32px;
  background:linear-gradient(165deg,#17202e 0%,#0b0f17 62%);color:#e6e9ef;min-height:calc(100dvh - 24px);position:sticky;top:0}
.ob-side::before{content:"";position:absolute;inset:-20%;z-index:-1;background:radial-gradient(closest-side at 70% 38%,rgba(94,234,212,.16),transparent 70%),
  radial-gradient(closest-side at 22% 82%,rgba(34,211,238,.10),transparent 70%)}
.ob-net{position:absolute;inset:0;width:100%;height:100%;z-index:-1;
  -webkit-mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.15) 30%,rgba(0,0,0,.15) 72%,#000 100%);mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.15) 30%,rgba(0,0,0,.15) 72%,#000 100%)}
.ob-net line{stroke:rgba(94,234,212,.15);stroke-width:1}
.ob-net circle{fill:#5eead4;opacity:.55}
.ob-net circle:nth-child(5n+1){fill:#22d3ee;opacity:.9}
.ob-brand{display:flex;align-items:center;gap:12px}
.ob-brand .ob-mk{width:40px;height:40px;flex:none}
.ob-brand b,.ob-mbrand b{font-family:${BRAND_FONT};font-weight:700;letter-spacing:0;font-size:28px;line-height:1}
.ob-copy h2{margin:0;font-size:clamp(28px,3vw,38px);font-weight:600;letter-spacing:-.025em;line-height:1.12;max-width:420px}
.ob-copy p{margin:14px 0 0;max-width:400px;font-size:15px;line-height:1.6;color:#a3afc2}
.ob-steps{list-style:none;margin:24px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.ob-steps li{display:flex;align-items:center;gap:12px;font-size:14px;color:#a3afc2}
.ob-steps i{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;flex:none;font:600 12px/1 var(--font);font-style:normal;
  border:1px solid rgba(94,234,212,.45);color:#5eead4}
.ob-steps li.on{color:#fff}
.ob-steps li.on i{border-color:transparent;background:linear-gradient(180deg,#5eead4,#22d3ee);color:#04221e}
.ob-tag{font-size:12px;color:#6b7a91}
.ob-main{display:flex;flex-direction:column;min-width:0;padding:28px 40px 32px}
.ob-who{display:flex;align-items:center;justify-content:flex-end;gap:10px;font-size:13px;color:var(--muted)}
.ob-who .av{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;font-size:12px;font-weight:650;
  background:linear-gradient(180deg,#17202e,#0b0f17);color:#5eead4}
.ob-mbrand{display:none;align-items:center;gap:10px;margin-right:auto;color:var(--fg)}
.ob-mbrand .ob-mk{width:30px;height:30px}
.ob-card{width:min(560px,100%);margin:auto;padding:32px 0;animation:pop .22s var(--ease)}
.ob-step{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--muted);margin-bottom:10px}
.ob-step::before{content:"";width:6px;height:6px;border-radius:50%;background:linear-gradient(180deg,#14b8a6,#22d3ee)}
.ob h1{margin:0 0 10px;font-size:30px;font-weight:650;letter-spacing:-.025em;line-height:1.15}
.ob-lead{margin:0 0 24px;color:var(--muted);font-size:14.5px;line-height:1.65}
.ob-lead b{color:var(--fg);font-weight:600}
.ob .vf .field>label{font-size:13px;font-weight:500;color:var(--fg)}
.ob .vf .field input{height:46px;border-radius:12px;font-size:14.5px}
.ob .vf .btn{height:44px;border-radius:12px;padding:0 18px}
.ob .vf-suggest{border-radius:12px}
.ob-note{display:flex;gap:12px;margin-top:24px;padding:14px 16px;border-radius:12px;border:1px solid var(--line);background:var(--surface-1);
  font-size:13px;line-height:1.6;color:var(--muted)}
.ob-note .ti{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;flex:none;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}
.ob-note .ti .i{width:17px;height:17px;stroke-width:1.7}
.ob-note>span:last-child{min-width:0}
.ob-note b{color:var(--fg);font-weight:600}
.ob-note code{font-family:var(--mono);font-size:12px;color:var(--fg);padding:1px 6px;border-radius:6px;background:color-mix(in srgb,var(--fg) 6%,transparent);word-break:break-all}
.ob-foot{display:flex;align-items:center;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
.ob-foot .grow{flex:1}
.ob-foot button{height:32px;padding:0 12px;border-radius:99px;border:1px solid var(--line-strong);color:var(--text-2);font-size:13px;font-weight:500}
.ob-foot button:hover{color:var(--fg);background:var(--hover)}
@media (max-width:900px){
  .ob{grid-template-columns:minmax(0,1fr)}
  .ob-side{display:none}
  .ob-main{padding:16px 16px 24px}
  .ob-mbrand{display:flex}
  .ob-card{margin:6vh auto auto;padding:24px 0}
}
@media (max-width:520px){.ob h1{font-size:24px}.ob-foot{flex-wrap:wrap}}
`;

/** Show the vault chooser; resolves after the server switched to a folder. */
export function showVaultOnboarding(info: SettingsInfo, user: string): Promise<VaultSwitchResult> {
  useStyles('onboarding-css', CSS);
  return new Promise((resolve) => {
    const root = el('div', 'ob');
    root.id = 'vaultGate';
    root.setAttribute('role', 'main');
    const who = user || 'owner';
    root.innerHTML = `<aside class="ob-side" aria-hidden="true">${constellation(600, 900, 34, 7, 'ob-net')}
      <div class="ob-brand">${markSvg('ob-mk')}<b>Memora</b></div>
      <div class="ob-copy"><h2>${BRAND_MOTTO}</h2><p>One folder of notes that you and every connected AI share.</p>
        <ol class="ob-steps"><li><i>1</i>Signed in</li><li class="on"><i>2</i>Choose your vault folder</li></ol></div>
      <div class="ob-tag">${BRAND_TAG}</div></aside>
    <div class="ob-main">
      <div class="ob-who"><span class="ob-mbrand">${markSvg('ob-mk')}<b>Memora</b></span><span>signed in as ${esc(who)}</span><span class="av" aria-hidden="true">${esc(who.slice(0, 1).toUpperCase())}</span></div>
      <div class="ob-card">
      <span class="ob-step">One last step</span>
      <h1>Choose your vault folder</h1>
      <p class="ob-lead">The vault is a <b>folder of markdown notes on the server's disk</b>: the brain every agent shares. This app and every agent connected over MCP (Claude Code, Cursor, Codex...) read and write the same notes there. Pick an existing folder of notes, or a new empty one.</p>
      <div id="obForm"></div>
      <div class="ob-note"><span class="ti">${icon('info')}</span><span><b>Running in Docker?</b> The path is inside the container, so it must be a mounted volume, or the notes are lost when the container is recreated. For example, with <code>-v /srv/memora/vault:/data</code> enter <code>/data</code>.</span></div>
      <div class="ob-foot"><span>You can change the folder later in Settings.</span><span class="grow"></span>
        <button type="button" id="obSignOut">Sign out</button></div>
      </div>
    </div>`;
    document.body.appendChild(root);

    mountVaultForm(root.querySelector<HTMLElement>('#obForm')!, {
      id: 'ob',
      suggested: info.vault_suggested,
      current: null,
      submitLabel: 'Use this folder',
      onDone: (res) => {
        const go = root.querySelector<HTMLElement>('#obGo');
        if (go) go.textContent = `Opening ${notesLabel(res.stats?.notes)}...`;
        root.style.transition = 'opacity .25s';
        root.style.opacity = '0';
        window.setTimeout(() => {
          root.remove();
          resolve(res);
        }, 260);
      },
    });
    root.querySelector<HTMLInputElement>('#obPath')?.focus();

    const out = root.querySelector<HTMLButtonElement>('#obSignOut');
    if (out) {
      out.onclick = async () => {
        try {
          await apiPost('/api/auth/logout');
        } catch {
          /* the redirect below still leaves the page */
        }
        window.location.replace('/login');
      };
    }
  });
}
