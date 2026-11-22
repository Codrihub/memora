// Vault folder chooser (first-run screen and Settings) and the reload after a vault switch.

import { loadPins } from './vault/store';
import { hooks } from './hooks';
import { apiGet, apiPost } from './api';
import { esc, useStyles } from './dom';
import { loadCore } from './core-data';
import { clearTagIndex } from './storage';
import { state } from './state';
import type { SettingsInfo, VaultSwitchResult } from './types';
import { t, tn } from './i18n';

const CSS = `
.vf-suggest{display:flex;align-items:center;gap:12px;padding:11px 13px;margin-bottom:14px;
  border:1px solid rgba(94,234,212,.3);background:rgba(94,234,212,.06);border-radius:var(--r)}
.vf-suggest-txt{min-width:0;flex:1}
.vf-suggest-k{font-size:11px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.vf-suggest-v{font-family:var(--mono);font-size:13px;word-break:break-all}
.vf-suggest-v small{display:block;font-family:var(--font);font-size:11.5px;color:var(--muted);margin-top:2px}
.vf .field input.vf-path{font-family:var(--mono);font-size:13px}
.vf .field input.vf-path[aria-invalid=true]{border-color:rgba(248,113,113,.6)}
.vf-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px}
.vf-row .msg{flex:1 1 200px}
.vf-err{margin-top:8px;padding:9px 11px;border-radius:9px;font-size:12.5px;color:var(--danger);
  background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.28)}
.vf-ok{margin-top:8px;padding:9px 11px;border-radius:9px;font-size:12.5px;color:var(--ok);
  background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.28)}
@media (max-width:520px){.vf-suggest{flex-direction:column;align-items:stretch}.vf-suggest .btn{justify-content:center}}
`;

interface VaultFormOptions {
  /** Prefix for element ids, so two forms never collide. */
  id: string;
  suggested?: string | null;
  /** The vault in use now, if any; the suggestion is hidden when it matches. */
  current?: string | null;
  submitLabel: string;
  /** true goes ahead, false stops quietly, a string stops with that message. */
  confirm?: (path: string, create: boolean) => Promise<boolean | string>;
  onDone: (res: VaultSwitchResult) => void | Promise<void>;
}

/** True while this tab is switching the vault, so its own realtime echo is ignored. */
export const vaultSwitch = { pending: false };

export function fetchSettings(): Promise<SettingsInfo> {
  return apiGet<SettingsInfo>('/api/settings');
}

/** POSIX, drive-letter or UNC absolute path. */
function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

export function notesLabel(n: number | undefined | null): string {
  const c = n || 0;
  if (!c) return t('no notes yet');
  return tn(c, '{n} note', '{n} notes');
}

export function mountVaultForm(host: HTMLElement, o: VaultFormOptions): void {
  useStyles('vault-form-css', CSS);
  const showSuggest = !!o.suggested && o.suggested !== o.current;
  host.innerHTML = `<form class="vf" id="${o.id}Form" novalidate>
    ${
      showSuggest
        ? `<div class="vf-suggest"><div class="vf-suggest-txt"><div class="vf-suggest-k">${t('Suggested')}</div>
        <div class="vf-suggest-v">${esc(o.suggested)}<small>${t('from {env}', { env: 'MEMORA_VAULT' })}</small></div></div>
        <button type="button" class="btn" id="${o.id}Use">${t('Use suggested')}</button></div>`
        : ''
    }
    <div class="field" style="margin-bottom:10px"><label for="${o.id}Path">${t('Folder on the server')}</label>
      <input id="${o.id}Path" class="vf-path" type="text" placeholder="/srv/memora/vault"
        autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="${o.id}Err">
      <span class="hint">${t('An absolute path, such as {posix} or, on Windows, {win}.', { posix: '/srv/memora/vault', win: 'C:\\Users\\you\\memora' })}</span></div>
    <label class="switch"><input type="checkbox" id="${o.id}Create"> ${t('Create the folder if it is missing')}</label>
    <div id="${o.id}Err" role="alert" aria-live="polite"></div>
    <div class="vf-row"><button type="submit" class="btn primary" id="${o.id}Go">${esc(o.submitLabel)}</button></div>
  </form>`;

  const form = host.querySelector<HTMLFormElement>(`#${o.id}Form`)!;
  const input = host.querySelector<HTMLInputElement>(`#${o.id}Path`)!;
  const create = host.querySelector<HTMLInputElement>(`#${o.id}Create`)!;
  const err = host.querySelector<HTMLElement>(`#${o.id}Err`)!;
  const go = host.querySelector<HTMLButtonElement>(`#${o.id}Go`)!;
  const use = host.querySelector<HTMLButtonElement>(`#${o.id}Use`);

  const showError = (msg: string): void => {
    err.className = 'vf-err';
    err.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
  };
  const clearError = (): void => {
    err.className = '';
    err.textContent = '';
    input.removeAttribute('aria-invalid');
  };
  input.oninput = clearError;
  create.onchange = clearError;

  const submit = async (path: string): Promise<void> => {
    path = path.trim();
    if (!path) return showError(t('Enter the folder path.'));
    if (!isAbsolutePath(path)) {
      return showError(t('Use an absolute path, starting with / (or {drive} or {unc} on Windows).', { drive: 'C:\\', unc: '\\\\server\\share' }));
    }
    if (o.confirm) {
      const ok = await o.confirm(path, create.checked);
      if (typeof ok === 'string') return showError(ok);
      if (!ok) return;
    }
    clearError();
    go.disabled = true;
    if (use) use.disabled = true;
    const label = go.textContent;
    go.textContent = t('Checking...');
    vaultSwitch.pending = true;
    try {
      const res = await apiPost<VaultSwitchResult>('/api/settings/vault', {
        path,
        create: create.checked,
      });
      await o.onDone(res);
    } catch (e) {
      showError((e as Error).message || t('The folder could not be used.'));
      input.focus();
    } finally {
      vaultSwitch.pending = false;
      go.disabled = false;
      if (use) use.disabled = false;
      go.textContent = label;
    }
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    void submit(input.value);
  };
  if (use && o.suggested) {
    const suggested = o.suggested;
    use.onclick = () => {
      input.value = suggested;
      void submit(suggested);
    };
  }
}

export async function reloadVaultData(): Promise<void> {
  state.note = null;
  state.editing = false;
  state.tags.built = false;
  state.tags.index = null;
  state.tags.active = null;
  clearTagIndex();
  try {
    const g = await apiGet<{ nodes?: unknown[]; links?: unknown[] }>('/api/graph');
    state.graph.nodes = (g.nodes || []) as typeof state.graph.nodes;
    state.graph.links = (g.links || []) as typeof state.graph.links;
  } catch {
    state.graph.nodes = [];
    state.graph.links = [];
  }
  await loadCore();
  await loadPins().catch(() => undefined);
  hooks.renderTree();
}
