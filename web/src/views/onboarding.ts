// First-run vault screen. Shown alone (no sidebar, no graph) after sign-in
// while the server has no vault folder configured; resolves once a folder is
// chosen, and boot then loads the normal app.

import { apiPost } from '../api';
import { el, esc, useStyles } from '../dom';
import { mountVaultForm, notesLabel } from '../vault';
import type { SettingsInfo, VaultSwitchResult } from '../types';

const CSS = `
.ob{position:fixed;inset:0;z-index:70;overflow:auto;background:var(--bg);display:flex;
  justify-content:center;align-items:flex-start;padding:min(9vh,72px) 16px 40px}
.ob-card{width:min(600px,100%);background:var(--panel);border:1px solid var(--line);
  border-radius:var(--r-lg);box-shadow:var(--shadow);padding:26px 28px 22px;animation:pop .22s var(--ease)}
.ob-brand{display:flex;align-items:center;gap:10px;margin-bottom:20px;font-weight:650}
.ob-brand svg{width:24px;height:24px;color:var(--accent)}
.ob-brand .grow{flex:1}
.ob-who{font-size:12px;font-weight:500;color:var(--muted)}
.ob-step{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  color:var(--accent);margin-bottom:6px}
.ob h1{margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-.2px;line-height:1.25}
.ob-lead{margin:0 0 18px;color:var(--muted);font-size:13.5px;line-height:1.6}
.ob-lead b{color:var(--fg);font-weight:600}
.ob-note{margin-top:20px;padding:12px 14px;border-radius:var(--r);background:var(--panel-2);
  border:1px solid var(--line);font-size:12.5px;line-height:1.6;color:var(--muted)}
.ob-note b{color:var(--fg);font-weight:650}
.ob-note code{font-family:var(--mono);font-size:12px;color:var(--accent-2);word-break:break-all}
.ob-foot{display:flex;align-items:center;gap:10px;margin-top:18px;font-size:12px;color:var(--muted)}
.ob-foot .grow{flex:1}
.ob-foot button{color:var(--muted);font-size:12px;text-decoration:underline;text-underline-offset:3px}
.ob-foot button:hover{color:var(--fg)}
@media (max-width:520px){.ob-card{padding:20px 18px 18px}.ob h1{font-size:19px}}
`;

const MARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="6.5" r="2.3"/><circle cx="17.5" cy="18" r="2.1"/><path d="M7.7 16.3 16.2 8.1M8.3 18h6.9"/></svg>`;

/** Show the vault chooser; resolves after the server switched to a folder. */
export function showVaultOnboarding(info: SettingsInfo, user: string): Promise<VaultSwitchResult> {
  useStyles('onboarding-css', CSS);
  return new Promise((resolve) => {
    const root = el('div', 'ob');
    root.id = 'vaultGate';
    root.setAttribute('role', 'main');
    root.innerHTML = `<div class="ob-card">
      <div class="ob-brand">${MARK}<span>Memora</span><span class="grow"></span>
        <span class="ob-who">signed in as ${esc(user || 'owner')}</span></div>
      <span class="ob-step">One last step</span>
      <h1>Choose your vault folder</h1>
      <p class="ob-lead">The vault is a <b>folder of markdown nodes on the server's disk</b>: the brain every agent shares. This app and every agent connected over MCP (Claude Code, Cursor, Codex...) read and write the same nodes there. Pick an existing folder of notes, or a new empty one.</p>
      <div id="obForm"></div>
      <div class="ob-note"><b>Running in Docker?</b> The path is inside the container, so it must be a mounted volume, or the nodes are lost when the container is recreated. For example, with <code>-v /srv/memora/vault:/data</code> enter <code>/data</code>.</div>
      <div class="ob-foot"><span>You can change the folder later in Settings.</span><span class="grow"></span>
        <button type="button" id="obSignOut">Sign out</button></div>
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
