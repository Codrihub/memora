// Settings, Mnemo: providers (add as many as you like, test, fetch models, switch on or
// off, delete), models (pin, hide, default; limits come from the provider), how Mnemo
// works (default model, your instructions, floating button) and the tools it may use.

import { attr, el, esc, useStyles } from '../dom';
import { switchHTML } from '../control/ui';
import { hooks } from '../hooks';
import { Modal } from '../modal';
import { toast } from '../toast';
import { icon } from '../ui/icons';
import { createSelect, type Select } from '../ui/select';
import { useFormStyles } from '../ui/forms';
import * as A from './api';
import { markHTML, MNEMO_CSS } from './styles';
import { textSizeHTML, wireTextSize } from './textsize';

const KINDS: A.ProviderKind[] = ['openai', 'anthropic', 'custom'];

const KIND_INFO: Record<A.ProviderKind, { blurb: string; key: string; base: string }> = {
  openai: { blurb: 'GPT models', key: 'sk-…', base: 'https://api.openai.com/v1' },
  anthropic: { blurb: 'Claude models', key: 'sk-ant-…', base: 'https://api.anthropic.com/v1' },
  custom: { blurb: 'OpenRouter, Groq, Together, Ollama, LM Studio, vLLM…', key: 'Key, if the server needs one', base: 'https://openrouter.ai/api/v1' },
};

/** Tools that change notes (the rest only read). */
const WRITE_TOOLS = new Set([
  'create_memory', 'save_memory', 'patch_memory', 'move_memory', 'rename_memory', 'add_tags', 'remove_tags', 'set_tags', 'rename_tag',
  'merge_tag', 'create_folder', 'rename_folder', 'move_folder', 'set_folder_meta', 'restore_memory', 'soft_delete', 'restore_trash',
  'batch_create', 'duplicate_memory', 'merge_memory', 'template_create', 'pin', 'unpin',
]);

let modelQuery = '';
let showHidden = false;
let defaultSel: Select | null = null;
let fbSel: Select | null = null;
/** The last Test result per provider, shown under its row until the page is left. */
const tested = new Map<string, { ok: boolean; text: string }>();

/** The section body; `wireMnemo` fills it. */
export function mnemoSectionHTML(): string {
  return `<div id="sMnemo" class="mns"><div class="st-card"><div class="st-row"><span class="st-note">Loading ${A.MNEMO}…</span></div></div></div>`;
}

export async function wireMnemo(host: HTMLElement): Promise<void> {
  useStyles('mnemo-css', MNEMO_CSS);
  useStyles('mnemo-settings-css', CSS);
  useFormStyles();
  const box = host.querySelector<HTMLElement>('#sMnemo');
  if (!box) return;
  try {
    const s = await A.loadState(true);
    if (!host.contains(box)) return;
    paint(box, s);
  } catch (e) {
    box.innerHTML = `<div class="st-card"><div class="st-row"><span class="st-note">Could not load ${A.MNEMO}: ${esc((e as Error).message)}</span></div></div>`;
    return;
  }
  const off = A.onState((s) => {
    if (!document.body.contains(box)) {
      off();
      return;
    }
    paint(box, s);
  });
}

function paint(box: HTMLElement, s: A.MnemoState): void {
  const focusedId = (document.activeElement as HTMLElement | null)?.id;
  defaultSel?.close();
  box.innerHTML = `${introCard(s)}${providersCard(s)}${modelsCard(s)}${behaviourCard(s)}${toolsCard(s)}`;
  if (focusedId) box.querySelector<HTMLElement>('#' + window.CSS.escape(focusedId))?.focus();
  wire(box, s);
}

function introCard(s: A.MnemoState): string {
  const n = A.usableModels(s).length;
  const state = s.ready
    ? `<span class="mns-pill ok"><i></i>Ready · ${n} model${n === 1 ? '' : 's'}</span>`
    : '<span class="mns-pill"><i></i>Not set up yet</span>';
  return `<div class="st-card mns-intro">${markHTML('lg')}<div class="mns-intro-t"><b>${A.MNEMO}, your notes agent</b>${state}
    <p>Chat with a model you choose; ${A.MNEMO} reads, writes, tags, links, moves and tidies notes with Memora's own tools. It cannot browse the web, run commands, delete for good or change the server. Keys are sealed on this server and never sent to the browser.</p></div></div>`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function providersCard(s: A.MnemoState): string {
  const rows = s.providers
    .map((p) => {
      const models = s.models.filter((m) => m.provider_id === p.id).length;
      const keyPill = p.key_hint
        ? `<span class="mns-pill">Key ••••${esc(p.key_hint)}</span>`
        : p.kind === 'custom'
          ? '<span class="mns-pill">No key</span>'
          : '<span class="mns-pill warn">No key</span>';
      const t = tested.get(p.id);
      return `<div class="mns-prov${p.enabled ? '' : ' off'}" data-id="${attr(p.id)}">
        <div class="mns-prov-h">
          <span class="mns-logo" data-p="${p.kind}">${p.kind === 'openai' ? 'O' : p.kind === 'anthropic' ? 'A' : esc((p.label || '?').charAt(0).toUpperCase())}</span>
          <span class="mns-prov-t"><b>${esc(p.label)}</b><small>${esc(A.providerName(p.kind))} · ${esc(hostOf(p.base_url))} · <code>${esc(p.id)}</code></small></span>
          ${switchHTML('mnsOn-' + p.id, p.enabled, `Use ${p.label}`, ' data-enable')}
        </div>
        <div class="mns-prov-m">${keyPill}<span class="mns-pill">${models} model${models === 1 ? '' : 's'}</span>${
          p.enabled ? '' : '<span class="mns-pill">Off: its models are hidden in chats</span>'
        }</div>
        <div class="mns-prov-a">
          <button type="button" class="btn sm" data-test>${icon('bolt')}<span>Test</span></button>
          <button type="button" class="btn sm" data-fetch>${icon('refresh')}<span>Fetch models</span></button>
          <button type="button" class="btn sm ghost" data-edit>${icon('edit')}<span>Edit</span></button>
          <button type="button" class="btn sm ghost danger" data-del>${icon('trash')}<span>Delete</span></button>
        </div>
        ${t ? `<div class="mns-test ${t.ok ? 'ok' : 'err'}" role="status">${icon(t.ok ? 'check' : 'alert')}<span>${esc(t.text)}</span></div>` : ''}
      </div>`;
    })
    .join('');
  return `<div class="st-card"><div class="st-ch mns-ch"><div><h3>Providers</h3><p>Where ${A.MNEMO}'s models come from. Add OpenAI, Anthropic or any OpenAI-compatible server, as many as you like, each with your own API key.</p></div>
      <button type="button" class="btn primary sm" id="mnsAddProv">${icon('plus')}<span>Add provider</span></button></div>
    <div class="mns-provs">${rows || `<p class="mns-none">No provider yet. Add one to start chatting with ${A.MNEMO}.</p>`}</div></div>`;
}

function modelsCard(s: A.MnemoState): string {
  if (!s.providers.length) {
    return `<div class="st-card"><div class="st-ch"><h3>Models</h3><p>Add a provider first; its models appear here.</p></div></div>`;
  }
  const def = s.prefs.default_model || '';
  const q = modelQuery.toLowerCase();
  const all = s.models.filter((m) => (showHidden || !m.hidden) && (!q || m.model_id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)));
  const hiddenN = s.models.filter((m) => m.hidden).length;
  const byProv = s.providers
    .map((p) => {
      const list = all.filter((m) => m.provider_id === p.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.model_id.localeCompare(b.model_id));
      if (!list.length) return '';
      return `<div class="mns-mg${p.enabled ? '' : ' off'}"><div class="mns-mg-h"><span class="mn-pdot" data-p="${p.kind}"></span>${esc(p.label)}<small>${list.length}${
        p.enabled ? '' : ' · provider off'
      }</small></div>${list.map((m) => modelRow(m, def)).join('')}</div>`;
    })
    .join('');
  return `<div class="st-card"><div class="st-ch"><h3>Models</h3><p>Pin the ones you use (they come first in every chat), hide the rest, and pick the default with the check mark. Context length and reply limits come from the provider.</p></div>
    <div class="mns-mbar">
      <label class="mns-mq">${icon('search')}<input type="search" id="mnsMq" placeholder="Filter models" value="${attr(modelQuery)}" autocomplete="off"></label>
      <label class="mns-chk"><input type="checkbox" id="mnsHid"${showHidden ? ' checked' : ''}><span>Show hidden${hiddenN ? ` (${hiddenN})` : ''}</span></label>
    </div>
    <div class="mns-models">${byProv || `<p class="mns-none">${s.models.length ? 'No model matches.' : 'No models yet. Use Fetch models on a provider, or add one by name below.'}</p>`}</div>
    ${
      s.providers.length
        ? `<form class="mns-add" id="mnsAdd" autocomplete="off"><span class="mns-add-p" id="mnsAddP"></span>
      <input class="ui-input" name="model" type="text" placeholder="Model id, e.g. gpt-5.5 or claude-opus-5-5" spellcheck="false" maxlength="200" aria-label="Model id">
      <button type="submit" class="btn">${icon('plus')}<span>Add model</span></button></form>`
        : ''
    }
  </div>`;
}

function limits(m: A.Model): string {
  const bits = [m.context_window ? `${A.fmtTokens(m.context_window)} context` : '', m.max_output ? `${A.fmtTokens(m.max_output)} reply` : ''].filter(Boolean);
  return bits.length ? bits.join(' · ') : m.fetched ? 'limits not reported' : 'added by hand';
}

function modelRow(m: A.Model, def: string): string {
  const key = A.modelKey(m);
  const isDef = key === def;
  return `<div class="mns-m${m.hidden ? ' hid' : ''}" data-p="${attr(m.provider_id)}" data-m="${attr(m.model_id)}">
    <button type="button" class="mns-star${m.pinned ? ' on' : ''}" data-pin aria-pressed="${m.pinned}" title="${m.pinned ? 'Unpin' : 'Pin'}" aria-label="${m.pinned ? 'Unpin' : 'Pin'} ${attr(m.model_id)}">${icon('star')}</button>
    <span class="mns-m-t"><b title="${attr(m.model_id)}">${esc(m.label || m.model_id)}</b><small>${m.label ? esc(m.model_id) + ' · ' : ''}${esc(limits(m))}${isDef ? ' · <em>default</em>' : ''}</small></span>
    <span class="mns-m-a">
      <button type="button" class="mn-ibtn${isDef ? ' on' : ''}" data-def title="${isDef ? 'The default model' : 'Make default'}" aria-pressed="${isDef}" aria-label="Make ${attr(m.model_id)} the default">${icon('check')}</button>
      <button type="button" class="mn-ibtn" data-hide title="${m.hidden ? 'Show in chats' : 'Hide from chats'}" aria-label="${m.hidden ? 'Show' : 'Hide'} ${attr(m.model_id)}">${icon(m.hidden ? 'eye-off' : 'eye')}</button>
      <button type="button" class="mn-ibtn" data-del title="Remove" aria-label="Remove ${attr(m.model_id)}">${icon('trash')}</button>
    </span>
  </div>`;
}

function behaviourCard(s: A.MnemoState): string {
  const p = s.prefs;
  return `<form class="st-card mns-beh" id="mnsBeh" novalidate autocomplete="off"><div class="st-ch"><h3>How ${A.MNEMO} works</h3><p>Applies to every chat.</p></div>
    <div class="st-row"><div class="st-l"><b>Default model</b><small>Used by new chats; each chat can switch.</small></div><div class="st-c"><span id="mnsDef"></span></div></div>
    <div class="st-row full"><div class="st-l"><b>Fallback models</b><small>When a chat's model fails (the provider is down, busy or out of credit), ${A.MNEMO} carries on with these, in this order, up to five. With none left, the chat shows the error and Try again. Saved at once.</small></div>
      <div class="st-c"><div class="mns-fb">${fallbackRows(s)}<span id="mnsFbAdd"></span></div></div></div>
    <div class="st-row"><div class="st-l"><b>Permission</b><small>Ask first: ${A.MNEMO} reads freely but asks before it changes notes. Auto: it goes ahead and keeps working until the job is done. Saved at once.</small></div>
      <div class="st-c"><div class="mns-seg" role="radiogroup" aria-label="Permission">${(['ask', 'auto'] as const)
        .map((v) => `<label><input type="radio" name="mnsPerm" value="${v}"${(p.permission === 'auto' ? 'auto' : 'ask') === v ? ' checked' : ''}><span>${v === 'ask' ? 'Ask first' : 'Auto'}</span></label>`)
        .join('')}</div></div></div>
    <div class="st-row"><div class="st-l"><b>Text size</b><small>The size of the chat's text on this device. Auto is small on phones, so more fits, and medium elsewhere. Saved at once.</small></div>
      <div class="st-c">${textSizeHTML('settings')}</div></div>
    <div class="st-row full"><div class="st-l"><b>Your instructions</b><small>Tell ${A.MNEMO} how you like things, in your own words: the language to answer in, how to name notes, folders to leave alone…</small></div>
      <div class="st-c"><textarea class="ui-input mns-instr" name="system_prompt" rows="3" maxlength="4000" placeholder="e.g. Answer in Indonesian. Keep meeting notes in Meetings/YYYY.">${esc(p.system_prompt || '')}</textarea></div></div>
    <div class="st-row sw"><div class="st-l"><b>Floating button</b><small>The ${A.MNEMO} button on every page (Ctrl+J). Saved at once. You can also hide or show it from More, or hide it by dragging it onto the X.</small></div><div class="st-c end">${switchHTML('mnsLauncher', hooks.mnemoButton(), 'Floating button')}</div></div>
    <div class="st-row mns-save"><button type="submit" class="btn primary">Save</button></div>
  </form>`;
}

function fallbackRows(s: A.MnemoState): string {
  const list = s.prefs.fallback_models || [];
  if (!list.length) return `<p class="mns-fb-none">None yet: a failed reply stops with the error.</p>`;
  return `<ol class="mns-fb-list">${list
    .map((k, i) => {
      const m = s.models.find((x) => A.modelKey(x) === k);
      const p = k.split('/')[0];
      return `<li class="mns-fb-i" data-fb="${i}"><span class="mn-q-n">${i + 1}</span><span class="mns-fb-t"><b>${esc(m?.label || m?.model_id || k.split('/').slice(1).join('/'))}</b><small>${esc(A.providerLabel(s, p))}${
        m ? '' : ' · not in your models'
      }</small></span><button type="button" class="mn-ibtn" data-fbm="up" title="Earlier" aria-label="Move up"${i === 0 ? ' disabled' : ''}>${icon('chev-up')}</button><button type="button" class="mn-ibtn" data-fbm="down" title="Later" aria-label="Move down"${
        i === list.length - 1 ? ' disabled' : ''
      }>${icon('chev-down')}</button><button type="button" class="mn-ibtn" data-fbm="del" title="Remove" aria-label="Remove">${icon('close')}</button></li>`;
    })
    .join('')}</ol>`;
}

function toolsCard(s: A.MnemoState): string {
  const read = s.tools.filter((t) => !WRITE_TOOLS.has(t));
  const write = s.tools.filter((t) => WRITE_TOOLS.has(t));
  const chips = (list: string[]): string => list.map((t) => `<code>${esc(t)}</code>`).join('');
  return `<div class="st-card"><div class="st-ch"><h3>What ${A.MNEMO} can use</h3><p>A fixed set of Memora tools, run under the name ${A.MNEMO} so every action shows in Activity. A tool switched off on the Tools page is off for ${A.MNEMO} too.</p></div>
    <div class="mns-tools"><div><b>Reads (${read.length})</b><div class="mns-chips">${chips(read)}</div></div>
    <div><b>Changes (${write.length})</b><div class="mns-chips w">${chips(write)}</div></div>
    <div class="mns-never">${icon('shield')}<span><b>Never:</b> delete for good, empty the Trash, delete folders, import or export, read keys, change settings, browse the web or run commands.</span></div></div></div>`;
}

function fail(e: unknown): void {
  toast((e as Error).message, 'err');
}

/** Add or edit a provider in a dialog. */
function providerDialog(p?: A.Provider): void {
  let kind: A.ProviderKind = p?.kind ?? 'openai';
  let idTouched = !!p;
  const body = el('form', 'mns-form');
  body.setAttribute('novalidate', '');
  body.setAttribute('autocomplete', 'off');
  body.innerHTML = `
    <div class="mns-f"><span>Type</span><div class="mns-seg" role="radiogroup" aria-label="Type">${KINDS.map(
      (k) => `<label><input type="radio" name="kind" value="${k}"${kind === k ? ' checked' : ''}><span>${esc(A.providerName(k))}</span></label>`,
    ).join('')}</div><small class="mns-hint" data-blurb></small></div>
    <label class="mns-f"><span>Name</span><input class="ui-input" name="label" type="text" maxlength="60" value="${attr(p?.label || '')}" placeholder="e.g. OpenAI work, OpenRouter, Local Ollama"></label>
    <label class="mns-f"><span>ID</span><input class="ui-input" name="id" type="text" maxlength="32" spellcheck="false" value="${attr(p?.id || '')}"${p ? ' readonly' : ''} placeholder="openai-work">
      <small class="mns-hint">${p ? 'The ID cannot change: chats and models refer to it.' : 'Letters, digits and dashes. Made from the name; edit it if you like.'}</small></label>
    <div class="mns-f" data-style><span>API</span><div class="mns-seg" role="radiogroup" aria-label="API">${(['chat', 'responses'] as const)
      .map(
        (v) =>
          `<label><input type="radio" name="api_style" value="${v}"${(p?.api_style || 'chat') === v ? ' checked' : ''}><span>${v === 'chat' ? 'Chat Completions' : 'Responses'}</span></label>`,
      )
      .join('')}</div></div>
    <label class="mns-f"><span data-base-l>Base URL</span><input class="ui-input" name="base_url" type="url" inputmode="url" spellcheck="false" value="${attr(p?.base_url || '')}"></label>
    <label class="mns-f"><span>API key</span><input class="ui-input" name="api_key" type="password" spellcheck="false" autocomplete="new-password" placeholder="${attr(
      p?.key_hint ? `Saved (ends in ${p.key_hint}). Leave empty to keep it.` : '',
    )}"></label>`;
  const q = <T extends HTMLElement>(sel: string): T => body.querySelector<T>(sel)!;
  const label = q<HTMLInputElement>('[name=label]');
  const idIn = q<HTMLInputElement>('[name=id]');
  const base = q<HTMLInputElement>('[name=base_url]');
  const keyIn = q<HTMLInputElement>('[name=api_key]');
  const slug = (v: string): string =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28);
  const sync = (): void => {
    const info = KIND_INFO[kind];
    q('[data-blurb]').textContent = info.blurb;
    q('[data-style]').hidden = kind === 'anthropic';
    q('[data-base-l]').textContent = kind === 'custom' ? 'Base URL (the server’s /v1 address)' : 'Base URL (optional)';
    base.placeholder = info.base;
    if (!p?.key_hint) keyIn.placeholder = info.key;
    if (!p) label.placeholder = kind === 'custom' ? 'e.g. OpenRouter, Local Ollama' : A.providerName(kind);
  };
  body.querySelectorAll<HTMLInputElement>('[name=kind]').forEach((r) => {
    r.onchange = () => {
      kind = r.value as A.ProviderKind;
      sync();
    };
  });
  label.oninput = () => {
    if (!idTouched) idIn.value = slug(label.value);
  };
  idIn.oninput = () => {
    idTouched = true;
    idIn.value = idIn.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  };
  sync();
  const save = async (): Promise<void> => {
    const name = label.value.trim() || (kind === 'custom' ? '' : A.providerName(kind));
    if (!name) {
      toast('Give the provider a name', 'err');
      label.focus();
      return;
    }
    const url = base.value.trim();
    if (kind === 'custom' && !url) {
      toast('An OpenAI-compatible provider needs its base URL', 'err');
      base.focus();
      return;
    }
    const key = keyIn.value.trim();
    if (!p && !key && kind !== 'custom') {
      toast('Paste the API key', 'err');
      keyIn.focus();
      return;
    }
    const style = body.querySelector<HTMLInputElement>('[name=api_style]:checked')?.value as A.ApiStyle | undefined;
    const b: Parameters<typeof A.saveProvider>[0] = {
      kind,
      label: name,
      api_style: kind === 'anthropic' ? 'messages' : style || 'chat',
      base_url: url,
    };
    const id = idIn.value.trim();
    if (id) b.id = id;
    if (key) b.api_key = key;
    try {
      const st = await A.saveProvider(b);
      Modal.close();
      const saved = st.saved || id;
      toast(`${name} saved`, 'ok');
      // A new provider lists its models straight away.
      if (!p && saved) void runFetch(saved, true);
    } catch (e) {
      fail(e);
    }
  };
  body.onsubmit = (e) => {
    e.preventDefault();
    void save();
  };
  Modal.open({
    title: p ? `Edit ${p.label}` : 'Add provider',
    sub: A.MNEMO,
    body,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      { label: p ? 'Save' : 'Add provider', cls: 'primary', run: save },
    ],
  });
  window.setTimeout(() => (p ? keyIn : label).focus(), 40);
}

async function runFetch(id: string, quiet: boolean, btn?: HTMLButtonElement): Promise<void> {
  if (btn) btn.disabled = true;
  try {
    const st = await A.fetchModels(id);
    toast(`${st.fetched ?? 0} models from ${A.providerLabel(st, id)}`, 'ok');
  } catch (e) {
    if (!quiet) fail(e);
    else toast(`Saved. Could not list the models (${(e as Error).message}); add them by name.`, 'warn');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wire(box: HTMLElement, s: A.MnemoState): void {
  box.querySelector<HTMLElement>('#mnsAddProv')!.onclick = () => providerDialog();
  box.querySelectorAll<HTMLElement>('.mns-prov').forEach((row) => {
    const id = row.dataset.id!;
    const p = s.providers.find((x) => x.id === id);
    if (!p) return;
    const sw = row.querySelector<HTMLElement>('[data-enable]')!;
    sw.onclick = () => {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(on));
      A.saveProvider({ id, enabled: on }).then(() => toast(on ? `${p.label} is on` : `${p.label} is off; its models are hidden in chats`, 'ok'), fail);
    };
    row.querySelector<HTMLButtonElement>('[data-test]')!.onclick = async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      b.querySelector('span')!.textContent = 'Testing…';
      try {
        const r = await A.testProvider(id);
        tested.set(id, {
          ok: r.ok,
          text: r.ok ? `Connected in ${r.ms ?? 0} ms · ${r.models ?? 0} models available` : r.error || 'The provider did not answer',
        });
      } catch (err) {
        tested.set(id, { ok: false, text: (err as Error).message });
      }
      paint(box, A.mnemoState() ?? s);
    };
    row.querySelector<HTMLButtonElement>('[data-fetch]')!.onclick = (e) => void runFetch(id, false, e.currentTarget as HTMLButtonElement);
    row.querySelector<HTMLElement>('[data-edit]')!.onclick = () => providerDialog(p);
    row.querySelector<HTMLElement>('[data-del]')!.onclick = () => {
      Modal.confirm(`Delete ${p.label}?`, 'Its API key and its models are removed. Chats stay; a chat that used one of its models switches to the default.', 'Delete', async () => {
        try {
          await A.deleteProvider(id);
          tested.delete(id);
          Modal.close();
          toast(`${p.label} deleted`, 'ok');
        } catch (e) {
          fail(e);
        }
      });
    };
  });

  // Models.
  const mq = box.querySelector<HTMLInputElement>('#mnsMq');
  if (mq) {
    mq.oninput = () => {
      modelQuery = mq.value;
      const pos = mq.selectionStart;
      paint(box, s);
      const again = box.querySelector<HTMLInputElement>('#mnsMq');
      again?.focus();
      if (pos !== null) again?.setSelectionRange(pos, pos);
    };
  }
  const hid = box.querySelector<HTMLInputElement>('#mnsHid');
  if (hid)
    hid.onchange = () => {
      showHidden = hid.checked;
      paint(box, s);
    };
  box.querySelectorAll<HTMLElement>('.mns-m').forEach((row) => {
    const provider = row.dataset.p!;
    const model = row.dataset.m!;
    const m = s.models.find((x) => x.provider_id === provider && x.model_id === model);
    if (!m) return;
    const set = (b: Parameters<typeof A.setModel>[0]): void => void A.setModel(b).catch(fail);
    row.querySelector<HTMLElement>('[data-pin]')!.onclick = () => set({ provider, model, pinned: !m.pinned });
    row.querySelector<HTMLElement>('[data-hide]')!.onclick = () => set({ provider, model, hidden: !m.hidden });
    row.querySelector<HTMLElement>('[data-del]')!.onclick = () => void A.deleteModel(provider, model).catch(fail);
    row.querySelector<HTMLElement>('[data-def]')!.onclick = () =>
      void A.savePrefs({ default_model: s.prefs.default_model === A.modelKey(m) ? null : A.modelKey(m) }).catch(fail);
  });
  const add = box.querySelector<HTMLFormElement>('#mnsAdd');
  if (add) {
    // The app's own picker, like every other select in Memora.
    const prov = createSelect({
      options: s.providers.map((p) => ({ value: p.id, label: p.label, hint: A.providerName(p.kind) })),
      value: s.providers.find((p) => p.enabled)?.id || s.providers[0]?.id,
      label: 'Provider',
      className: 'mns-add-sel',
      minWidth: 220,
    });
    add.querySelector('#mnsAddP')!.append(prov.el);
    add.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(add);
      const model = String(fd.get('model') || '').trim();
      if (!model) return;
      A.setModel({ provider: prov.value, model, pinned: true }).then(() => toast(`${model} added and pinned`, 'ok'), fail);
    };
  }

  // How Mnemo works.
  const beh = box.querySelector<HTMLFormElement>('#mnsBeh');
  if (beh) {
    const slot = beh.querySelector<HTMLElement>('#mnsDef')!;
    const list = A.usableModels(s);
    defaultSel = createSelect({
      options: [
        { value: '', label: 'First pinned model', hint: 'Or the first visible one' },
        ...list.map((m) => ({
          value: A.modelKey(m),
          label: m.label || m.model_id,
          hint: A.providerLabel(s, m.provider_id),
          group: m.pinned ? 'Pinned' : A.providerLabel(s, m.provider_id),
        })),
      ],
      value: s.prefs.default_model && list.some((m) => A.modelKey(m) === s.prefs.default_model) ? s.prefs.default_model : '',
      label: 'Default model',
      searchable: list.length > 7,
      minWidth: 260,
    });
    slot.append(defaultSel.el);
    // Fallback models: add, reorder, remove; each change is saved at once.
    const fb = (s.prefs.fallback_models || []).slice();
    const saveFb = (next: string[]): void => {
      void A.savePrefs({ fallback_models: next.length ? next : null }).catch(fail);
    };
    beh.querySelectorAll<HTMLButtonElement>('[data-fbm]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.closest<HTMLElement>('[data-fb]')?.dataset.fb);
        const next = fb.slice();
        if (b.dataset.fbm === 'del') next.splice(i, 1);
        else if (b.dataset.fbm === 'up' && i > 0) [next[i - 1], next[i]] = [next[i], next[i - 1]];
        else if (b.dataset.fbm === 'down' && i < next.length - 1) [next[i + 1], next[i]] = [next[i], next[i + 1]];
        saveFb(next);
      };
    });
    const left = list.filter((m) => !fb.includes(A.modelKey(m)));
    const addSlot = beh.querySelector<HTMLElement>('#mnsFbAdd')!;
    if (fb.length < 5 && left.length) {
      fbSel?.close();
      fbSel = createSelect({
        options: left.map((m) => ({
          value: A.modelKey(m),
          label: m.label || m.model_id,
          hint: A.providerLabel(s, m.provider_id),
          group: m.pinned ? 'Pinned' : A.providerLabel(s, m.provider_id),
        })),
        value: '',
        label: 'Add a fallback model',
        searchable: left.length > 7,
        minWidth: 260,
        render: () => `${icon('plus')}<span>Add a fallback model</span>`,
        onChange: (v) => v && saveFb([...fb, v]),
      });
      addSlot.append(fbSel.el);
    }
    const launcher = beh.querySelector<HTMLElement>('#mnsLauncher')!;
    wireTextSize(beh);
    beh.querySelectorAll<HTMLInputElement>('[name=mnsPerm]').forEach((r) => {
      r.onchange = () => {
        void A.savePrefs({ permission: r.value as 'ask' | 'auto' })
          .then(() => toast(r.value === 'auto' ? `Auto: ${A.MNEMO} goes ahead without asking` : `Ask first: ${A.MNEMO} asks before changes`, 'ok'))
          .catch(fail);
      };
    });
    // Takes effect at once (no Save): off hides it everywhere, on brings it back here too.
    launcher.onclick = async () => {
      const on = launcher.getAttribute('aria-checked') !== 'true';
      launcher.setAttribute('aria-checked', String(on));
      try {
        if (on) hooks.mnemoButton(true);
        else await A.savePrefs({ launcher: false });
        toast(on ? `The ${A.MNEMO} button is back` : `${A.MNEMO} button hidden. Show it again here or from More.`, 'ok');
      } catch (err) {
        launcher.setAttribute('aria-checked', String(!on));
        fail(err);
      }
    };
    beh.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(beh);
      // Temperature and token limits keep their sensible defaults; only these are asked.
      const prefs: A.Prefs = {
        default_model: defaultSel?.value || null,
        system_prompt: String(fd.get('system_prompt') || '').trim() || null,
      };
      try {
        await A.savePrefs(prefs);
        toast(`${A.MNEMO} settings saved`, 'ok');
      } catch (err) {
        fail(err);
      }
    };
  }
}

const CSS = `
.mns{display:flex;flex-direction:column;gap:16px}
.mns-fb{display:flex;flex-direction:column;align-items:flex-start;gap:8px;width:100%}
.mns-fb-none{margin:0;font-size:12.5px;color:var(--muted)}
.mns-fb-list{display:flex;flex-direction:column;gap:6px;width:100%;margin:0;padding:0;list-style:none}
.mns-fb-i{display:flex;align-items:center;gap:8px;min-height:40px;padding:4px 6px 4px 10px;border:1px solid var(--line);border-radius:10px;background:color-mix(in srgb,var(--fg) 2.5%,transparent)}
.mns-fb-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.mns-fb-t b{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mns-fb-t small{font-size:11.5px;color:var(--muted)}
.mns-fb-i .mn-ibtn:disabled{opacity:.3;cursor:default}
.mns-intro{display:flex;align-items:flex-start;gap:14px;padding:18px 20px}
.mns-intro-t{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.mns-intro-t b{font-size:15px;font-weight:650}
.mns-intro-t p{margin:2px 0 0;font-size:13px;line-height:1.55;color:var(--muted)}
.mns-pill{display:inline-flex;align-items:center;gap:6px;flex:none;height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:550;color:var(--muted);background:color-mix(in srgb,var(--fg) 6%,transparent);white-space:nowrap}
.mns-pill i{width:7px;height:7px;border-radius:50%;background:currentColor}
.mns-pill.ok{color:var(--ok,#059669);background:color-mix(in srgb,var(--ok,#10b981) 12%,transparent)}
.mns-pill.warn{color:var(--warn,#d97706);background:color-mix(in srgb,var(--warn,#d97706) 12%,transparent)}
.mns-ch{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.mns-ch .btn{flex:none}
.mns-provs{display:flex;flex-direction:column}
.mns-prov{display:flex;flex-direction:column;gap:10px;padding:14px 20px;border-top:1px solid var(--line)}
.mns-prov.off .mns-prov-h>:not(.cc-sw),.mns-prov.off .mns-prov-m{opacity:.6}
.mns-prov-h{display:flex;align-items:center;gap:12px}
.mns-logo{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:10px;font-weight:700;font-size:15px;color:#fff;background:#64748b}
.mns-logo[data-p=openai]{background:#10a37f}.mns-logo[data-p=anthropic]{background:#d97757}.mns-logo[data-p=custom]{background:#6366f1}
.mns-prov-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.35}
.mns-prov-t b{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mns-prov-t small{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mns-prov-t code{font:11.5px var(--mono)}
.mns-prov-m,.mns-prov-a{display:flex;flex-wrap:wrap;gap:6px;padding-left:46px}
.mns-test{display:flex;align-items:flex-start;gap:8px;margin-left:46px;padding:8px 12px;border-radius:10px;font-size:12.5px;line-height:1.45;animation:mnIn .2s var(--ease-out,ease-out) both}
.mns-test .i{width:15px;height:15px;flex:none;margin-top:1px}
.mns-test.ok{background:color-mix(in srgb,var(--ok,#10b981) 10%,transparent)}.mns-test.ok .i{color:var(--ok,#059669)}
.mns-test.err{background:var(--danger-soft,color-mix(in srgb,var(--danger) 10%,transparent))}.mns-test.err .i{color:var(--danger)}
.mns-test span{overflow-wrap:anywhere}
.mns-form{display:flex;flex-direction:column;gap:14px}
.mns-f{display:flex;flex-direction:column;gap:7px;min-width:0}
.mns-f[hidden]{display:none}
.mns-f>span:first-child{font-size:12.5px;font-weight:620;color:var(--text-2,var(--fg))}
.mns-f .ui-input{height:44px}
.mns-f input[readonly]{opacity:.7}
.mns-hint{font-size:12px;line-height:1.45;color:var(--muted)}
.mns-seg{display:flex;width:100%;gap:2px;padding:3px;border-radius:12px;background:var(--seg-track,color-mix(in srgb,var(--fg) 6%,transparent))}
.mns-seg label{position:relative;flex:1 1 auto;min-width:0}
.mns-seg input{position:absolute;opacity:0;pointer-events:none}
.mns-seg span{display:flex;align-items:center;justify-content:center;height:38px;padding:0 10px;border-radius:9px;font-size:13.5px;color:var(--muted);cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .15s,color .15s}
.mns-seg input:checked+span{background:var(--seg-thumb,var(--surface-0));color:var(--fg);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.1)}
.mns-instr{display:block;height:auto;min-height:84px;padding:11px 12px;line-height:1.5;resize:vertical;font:inherit;font-size:14px}
#mnsDef{display:block}#mnsDef .ui-sel{width:100%;max-width:none;height:44px}
.st-row.mns-save{display:flex;justify-content:flex-end}
@media (max-width:640px){.mns-f .ui-input,.mns-instr{font-size:16px}.st-row.mns-save .btn{width:100%;justify-content:center}}
.mns-seg input:focus-visible+span{outline:2px solid var(--accent);outline-offset:1px}
.mns-mbar{display:flex;align-items:center;gap:12px;padding:0 20px 10px;flex-wrap:wrap}
.mns-mq{display:flex;align-items:center;gap:8px;flex:1;min-width:180px;max-width:360px;height:40px;padding:0 12px;border:1px solid var(--line-strong);border-radius:10px;background:var(--field-bg,var(--surface-0));transition:border-color .15s,box-shadow .15s}
.mns-mq:focus-within{border-color:var(--accent-line,var(--accent));box-shadow:0 0 0 3px var(--accent-soft)}
.mns-mq .i{width:16px;height:16px;color:var(--muted);flex:none}
.mns-mq input{flex:1;min-width:0;border:0;outline:0;background:none;box-shadow:none;padding:0;height:100%;font-size:14px;color:var(--fg)}
.mns-chk{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--text-2,var(--fg));cursor:pointer;white-space:nowrap}
.mns-models{max-height:460px;overflow-y:auto;border-top:1px solid var(--line)}
.mns-mg.off{opacity:.6}
.mns-mg-h{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:9px 20px;font-size:12px;font-weight:600;color:var(--muted);background:var(--panel,var(--surface-0));border-bottom:1px solid var(--line)}
.mns-mg-h small{font-weight:500;opacity:.8}
.mns-m{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--line)}
.mns-m:last-child{border-bottom:0}
.mns-m.hid{opacity:.55}
.mns-m:hover{background:var(--hover)}
.mns-star{display:grid;place-items:center;flex:none;width:30px;height:30px;border:0;border-radius:8px;background:none;color:var(--line-strong);cursor:pointer}
.mns-star .i{width:17px;height:17px;stroke-width:1.7}
.mns-star:hover{color:#f59e0b;background:var(--hover)}
.mns-star.on{color:#f59e0b}.mns-star.on .i{fill:currentColor}
.mns-m-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.mns-m-t b{font-size:13.5px;font-weight:560;font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mns-m-t small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mns-m-t em{font-style:normal;color:var(--accent);font-weight:600}
.mns-m-a{display:inline-flex;gap:2px;flex:none}
.mns-m-a .mn-ibtn.on{color:var(--accent);background:var(--accent-soft)}
.mns-none{margin:0;padding:18px 20px;font-size:13px;color:var(--muted)}
.mns-add{display:flex;align-items:center;gap:8px;padding:14px 20px 18px;border-top:1px solid var(--line);flex-wrap:wrap}
.mns-add-p{display:flex;flex:none}
.ui-sel.mns-add-sel{height:40px;min-width:150px;max-width:200px}
.mns-add .ui-input{flex:1;min-width:180px;height:40px}
.mns-add .btn{height:40px;flex:none}
.mns-chk input{width:16px;height:16px;accent-color:var(--accent);margin:0}
@media (max-width:640px){.mns-add-p,.ui-sel.mns-add-sel{width:100%;max-width:none}.mns-add .btn{width:100%;justify-content:center}.mns-mq{max-width:none}}
.mns-beh textarea{width:100%;min-height:96px;resize:vertical;font:inherit;font-size:13.5px;line-height:1.5}
.mns-tools{display:flex;flex-direction:column;gap:14px;padding:0 20px 18px}
.mns-tools b{font-size:12.5px;font-weight:600;color:var(--text-2,var(--fg))}
.mns-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.mns-chips code{font:11.5px/1 var(--mono);padding:5px 8px;border-radius:7px;background:color-mix(in srgb,var(--fg) 6%,transparent);color:var(--text-2,var(--fg))}
.mns-chips.w code{background:var(--accent-soft);color:var(--fg)}
.mns-never{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;font-size:13px;line-height:1.5;color:var(--text-2,var(--fg));background:color-mix(in srgb,var(--fg) 4%,transparent)}
.mns-never .i{width:17px;height:17px;flex:none;color:var(--accent);margin-top:1px}
@media (max-width:720px){
  .mns-intro{padding:16px}
  .mns-ch{flex-direction:column}
  .mns-prov{padding:14px 16px}
  .mns-prov-m,.mns-prov-a{padding-left:0}
  .mns-test{margin-left:0}
  .mns-m{flex-wrap:wrap}
  .mns-m-t{flex-basis:calc(100% - 44px)}
  .mns-m-a{margin-left:40px}
}
`;
