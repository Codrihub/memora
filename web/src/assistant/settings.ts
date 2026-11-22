// Settings, Mnemo: providers (add as many as you like, test, fetch models, switch on or
// off, delete), models (pin, hide, default; limits come from the provider), how Mnemo
// works (default model, your instructions, floating button) and the tools it may use.

import { attr, el, esc, useStyles } from '../dom';
import { switchHTML } from '../control/ui';
import { relTs } from '../format';
import { hooks } from '../hooks';
import { Modal } from '../modal';
import { toast } from '../toast';
import { icon } from '../ui/icons';
import { t, tn } from '../i18n';
import { ts } from '../i18n/server';
import { createSelect, type Select, type SelectOption } from '../ui/select';
import { useFormStyles } from '../ui/forms';
import * as A from './api';
import { sendToMnemo } from './launcher';
import { markHTML, MNEMO_CSS } from './styles';
import { textSizeHTML, wireTextSize } from './textsize';

const KINDS: A.ProviderKind[] = ['openai', 'anthropic', 'custom'];

const KIND_INFO: Record<A.ProviderKind, { blurb: string; key: string; base: string }> = {
  openai: { blurb: t('GPT models'), key: 'sk-…', base: 'https://api.openai.com/v1' },
  anthropic: { blurb: t('Claude models'), key: 'sk-ant-…', base: 'https://api.anthropic.com/v1' },
  custom: { blurb: 'OpenRouter, Groq, Together, Ollama, LM Studio, vLLM…', key: t('Key, if the server needs one'), base: 'https://openrouter.ai/api/v1' },
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
/** The selects of the jobs card (closed before each repaint). */
let jobSels: Select[] = [];
/** What Mnemo knows about the owner (loaded once per visit). */
let mem: { items: A.OwnerMemory[]; learn: boolean } | null = null;
let memErr = '';
let memEditing = '';
/** The last Test result per provider, shown under its row until the page is left. */
const tested = new Map<string, { ok: boolean; text: string }>();

/** The section body; `wireMnemo` fills it. */
export function mnemoSectionHTML(): string {
  return `<div id="sMnemo" class="mns"><div class="st-card"><div class="st-row"><span class="st-note">${t('Loading {mnemo}…', { mnemo: A.MNEMO })}</span></div></div></div>`;
}

export async function wireMnemo(host: HTMLElement): Promise<void> {
  useStyles('mnemo-css', MNEMO_CSS);
  useStyles('mnemo-settings-css', CSS);
  useFormStyles();
  const box = host.querySelector<HTMLElement>('#sMnemo');
  if (!box) return;
  mem = null;
  memErr = '';
  memEditing = '';
  try {
    const s = await A.loadState(true);
    if (!host.contains(box)) return;
    paint(box, s);
    // Opened at "Models for each job" (a notice's button): go there; the memory card waits for its list.
    const part = A.takeSettingsPart();
    if (part === 'jobs')
      requestAnimationFrame(() => box.querySelector('#mnsJobs')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    else if (part) A.wantSettingsPart(part);
  } catch (e) {
    box.innerHTML = `<div class="st-card"><div class="st-row"><span class="st-note">${t('Could not load {mnemo}: {error}', { mnemo: A.MNEMO, error: esc((e as Error).message) })}</span></div></div>`;
    return;
  }
  void loadMem(box);
  const off = A.onState((s) => {
    if (!document.body.contains(box)) {
      off();
      return;
    }
    paint(box, s);
  });
}

function paint(box: HTMLElement, s: A.MnemoState): void {
  const active = document.activeElement as HTMLInputElement | null;
  const focusedId = active?.id;
  const sel = active && 'selectionStart' in active && box.contains(active) ? [active.selectionStart, active.selectionEnd] : null;
  defaultSel?.close();
  jobSels.forEach((x) => x.close());
  jobSels = [];
  box.innerHTML = `${introCard(s)}${providersCard(s)}${modelsCard(s)}${behaviourCard(s)}${fallbackCard(s)}${jobsCard(s)}${memoryCard(s)}${toolsCard(s)}`;
  if (focusedId) {
    const again = box.querySelector<HTMLInputElement>('#' + window.CSS.escape(focusedId));
    again?.focus();
    if (again && sel && sel[0] !== null && typeof again.setSelectionRange === 'function') {
      try {
        again.setSelectionRange(sel[0], sel[1]);
      } catch {
        /* not a text field */
      }
    }
  }
  wire(box, s);
  wireJobs(box, s);
  wireMem(box);
  wireTools(box);
}

/** The Tools card: pick Mnemo or sub-agents, tap tools on or off. */
function wireTools(box: HTMLElement): void {
  const card = box.querySelector<HTMLElement>('#mnsTools');
  if (!card) return;
  card.querySelectorAll<HTMLElement>('[data-tfor]').forEach((b) => {
    b.onclick = () => {
      toolsFor = b.dataset.tfor as 'main' | 'sub';
      const s = A.mnemoState();
      if (s) paint(box, s);
    };
  });
  card.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
    b.onclick = () => {
      const s = A.mnemoState();
      if (!s) return;
      const key = toolsFor === 'main' ? 'tools_off_main' : 'tools_off_sub';
      const off = new Set(s.prefs[key] || []);
      const name = b.dataset.tool!;
      const on = off.has(name);
      if (on) off.delete(name);
      else off.add(name);
      b.setAttribute('aria-pressed', String(on));
      A.savePrefs({ [key]: [...off] }).then(
        () => toast(on ? t('{tool}: on for {who}', { tool: name, who: toolsFor === 'main' ? A.MNEMO : t('sub-agents') }) : t('{tool}: off for {who}', { tool: name, who: toolsFor === 'main' ? A.MNEMO : t('sub-agents') }), 'ok'),
        (e) => {
          b.setAttribute('aria-pressed', String(!on));
          fail(e);
        },
      );
    };
  });
}

// ---- models for each job, and sub-agents ----

const ROLES: { role: keyof A.Roles; label: string; hint: string }[] = [
  { role: 'vision', label: t('Reads images'), hint: t('{mnemo} hands pictures to this model when the chat model cannot see.', { mnemo: A.MNEMO }) },
  { role: 'image', label: t('Makes images'), hint: t('{mnemo} asks this model when you want a picture made.', { mnemo: A.MNEMO }) },
  { role: 'tts', label: t('Reads aloud'), hint: t('Reads replies aloud when you tap Listen, in the voice beside it.') },
  { role: 'stt', label: t('Listens'), hint: t('Turns what you say into text: the mic button in the chat.') },
];

function jobsCard(s: A.MnemoState): string {
  const roles = ROLES.map(
    (r) => `<div class="st-row"><div class="st-l"><b>${r.label}</b><small>${r.hint}</small></div><div class="st-c"><div class="mns-job"><span data-role="${r.role}"></span>${
      r.role === 'tts' ? '<span data-voice></span>' : ''
    }</div></div></div>`,
  ).join('');
  return `<div class="st-card mns-jobs" id="mnsJobs"><div class="st-ch"><h3>${t('Models for each job')}</h3><p>${t('Things the chat model may not do itself. Pick None to leave a job off. Saved at once.')}</p></div>
    ${roles}
    <div class="st-row sw"><div class="st-l"><b>${t('Ask before sub-agents run')}</b><small>${t('{mnemo} starts sub-agents by itself when a task splits well; there is nothing to set up. They run on your default model, then the fallbacks, unless you name a model in the chat. Follow them, and switch their model, in Agents at the top right of the chat. They use tokens of their own, so in Ask first {mnemo} asks and says roughly how many; in Auto they just run. Saved at once.', { mnemo: A.MNEMO })}</small></div><div class="st-c end">${switchHTML(
      'mnsSubAsk',
      s.prefs.confirm_subagents ?? true,
      t('Ask before sub-agents run'),
    )}</div></div>
  </div>`;
}

function modelOptions(s: A.MnemoState, keep: string): SelectOption[] {
  const list = A.usableModels(s);
  const opts = list.map((m) => ({
    value: A.modelKey(m),
    label: m.label || m.model_id,
    hint: A.providerLabel(s, m.provider_id),
    group: m.pinned ? t('Pinned') : A.providerLabel(s, m.provider_id),
  }));
  if (keep && !list.some((m) => A.modelKey(m) === keep)) opts.unshift({ value: keep, label: A.modelLabel(s, keep), hint: t('Not in your models'), group: t('Set before') });
  return opts;
}

function wireJobs(box: HTMLElement, s: A.MnemoState): void {
  const card = box.querySelector<HTMLElement>('#mnsJobs');
  if (!card) return;
  const roles: A.Roles = { ...(s.prefs.roles || {}) };
  card.querySelectorAll<HTMLElement>('[data-role]').forEach((slot) => {
    const role = slot.dataset.role as keyof A.Roles;
    const cur = roles[role] || '';
    const opts = modelOptions(s, cur);
    const sel = createSelect({
      options: [{ value: '', label: t('None'), hint: t('This job stays off') }, ...opts],
      value: cur,
      label: ROLES.find((r) => r.role === role)?.label || role,
      searchable: opts.length > 7,
      minWidth: 260,
      onChange: (v) => {
        const next: A.Roles = { ...(A.mnemoState()?.prefs.roles || roles), [role]: v };
        void A.savePrefs({ roles: next }).catch(fail);
      },
    });
    jobSels.push(sel);
    slot.append(sel.el);
  });
  const vslot = card.querySelector<HTMLElement>('[data-voice]');
  if (vslot) {
    const voice = s.prefs.voice || 'alloy';
    const vs = createSelect({
      options: A.VOICES.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) })),
      value: A.VOICES.includes(voice) ? voice : 'alloy',
      label: t('Voice'),
      className: 'mns-voice',
      disabled: !roles.tts,
      minWidth: 160,
      onChange: (v) => void A.savePrefs({ voice: v }).catch(fail),
    });
    jobSels.push(vs);
    vslot.append(vs.el);
  }

  const ask = card.querySelector<HTMLElement>('#mnsSubAsk');
  if (ask)
    ask.onclick = () => {
      const on = ask.getAttribute('aria-checked') !== 'true';
      ask.setAttribute('aria-checked', String(on));
      A.savePrefs({ confirm_subagents: on }).then(
        () => toast(on ? t('{mnemo} asks before sub-agents run', { mnemo: A.MNEMO }) : t('Sub-agents run without asking'), 'ok'),
        (e) => {
          ask.setAttribute('aria-checked', String(!on));
          fail(e);
        },
      );
    };
}

// ---- what Mnemo knows about the owner ----

async function loadMem(box: HTMLElement): Promise<void> {
  try {
    mem = await A.listOwnerMemory();
    memErr = '';
  } catch (e) {
    memErr = (e as Error).message;
  }
  if (!document.body.contains(box)) return;
  paintMem(box);
  if (A.takeSettingsPart() === 'memory') scrollToMem();
}

/** Bring the memory card into view (Settings is open). */
function scrollToMem(): void {
  document.getElementById('mnsMem')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function paintMem(box: HTMLElement): void {
  const s = A.mnemoState();
  const card = box.querySelector<HTMLElement>('#mnsMem');
  if (!s || !card) return;
  card.outerHTML = memoryCard(s);
  wireMem(box);
}

function memItem(m: A.OwnerMemory): string {
  const by = m.by === 'owner' ? t('added by you') : t('learned');
  const body =
    memEditing === m.id
      ? `<input class="ui-input mns-mi-in" id="mnsMemEdit" type="text" maxlength="500" value="${attr(m.text)}" aria-label="${t('Edit')}">`
      : `<span class="mns-mi-t" role="button" tabindex="0" data-medit title="${t('Click to edit')}">${esc(m.text)}</span>`;
  return `<li class="mns-mi" data-mid="${attr(m.id)}"><span class="mns-mi-b">${body}<small><span class="mns-mi-by${m.by === 'owner' ? ' own' : ''}">${by}</span> · <time title="${attr(
    new Date(m.at * 1000).toLocaleString(),
  )}">${esc(relTs(m.at))}</time></small></span><button type="button" class="mn-ibtn" data-mdel title="${t('Delete')}" aria-label="${t('Delete')}">${icon('trash')}</button></li>`;
}

function memoryCard(s: A.MnemoState): string {
  const learn = s.prefs.learn_me ?? mem?.learn ?? true;
  const items = mem?.items || [];
  const list = [...items].sort((a, b) => b.at - a.at);
  const groups = list.length ? `<ul class="mns-ml">${list.map(memItem).join('')}</ul>` : '';
  const listHTML = memErr
    ? `<p class="mns-none">${t('Could not load: {error}', { error: esc(memErr) })}</p>`
    : !mem
      ? `<p class="mns-none">${t('Loading…')}</p>`
      : groups || `<p class="mns-none">${t('{mnemo} knows nothing about you yet.', { mnemo: A.MNEMO })}</p>`;
  return `<div class="st-card" id="mnsMem"><div class="st-ch"><h3>${t('What {mnemo} knows about you', { mnemo: A.MNEMO })}</h3><p>${t("{mnemo}'s own notes on how to talk to you, read in every chat. Click one to change it.", { mnemo: A.MNEMO })}</p></div>
    <div class="st-row sw"><div class="st-l"><b>${t('Let {mnemo} learn about me', { mnemo: A.MNEMO })}</b><small>${t('On: {mnemo} notes what it picks up in chats. Off: only what you add here. Saved at once.', { mnemo: A.MNEMO })}</small></div><div class="st-c end">${switchHTML(
      'mnsLearn',
      learn,
      t('Let {mnemo} learn about me', { mnemo: A.MNEMO }),
    )}</div></div>
    <div class="mns-mem">${listHTML}</div>
    <form class="mns-mem-add" id="mnsMemAdd" autocomplete="off"><textarea class="ui-input" id="mnsMemNew" name="text" rows="2" maxlength="4000" placeholder="${t('Something {mnemo} should know. One per line to add several.', { mnemo: A.MNEMO })}" aria-label="${t('Something {mnemo} should know', { mnemo: A.MNEMO })}"></textarea>
      <div class="mns-mem-bar"><button type="button" class="btn ghost sm" id="mnsDescribe" title="${t('{mnemo} reads your vault in a new chat and keeps what it learns here.', { mnemo: A.MNEMO })}">${icon('sparkle')}<span>${t('Describe me from my notes')}</span></button><span class="mns-grow"></span><button type="submit" class="btn primary sm">${icon(
        'plus',
      )}<span>${t('Add')}</span></button></div>
      <small class="mns-mem-hint">${t('{mnemo} reads your vault in a new chat and keeps what it learns here.', { mnemo: A.MNEMO })}</small></form>
  </div>`;
}

function wireMem(box: HTMLElement): void {
  const card = box.querySelector<HTMLElement>('#mnsMem');
  if (!card) return;
  const sw = card.querySelector<HTMLElement>('#mnsLearn')!;
  sw.onclick = () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    if (mem) mem.learn = on;
    A.savePrefs({ learn_me: on }).then(
      () => toast(on ? t('{mnemo} may learn about you', { mnemo: A.MNEMO }) : t('{mnemo} keeps only what you add', { mnemo: A.MNEMO }), 'ok'),
      (e) => {
        sw.setAttribute('aria-checked', String(!on));
        fail(e);
      },
    );
  };
  card.querySelector<HTMLButtonElement>('#mnsDescribe')!.onclick = () => sendToMnemo(A.describeMe());
  const form = card.querySelector<HTMLFormElement>('#mnsMemAdd')!;
  const input = form.querySelector<HTMLTextAreaElement>('#mnsMemNew')!;
  // Enter adds; Shift+Enter starts another line (each line is its own note).
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const lines = input.value
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!lines.length) return input.focus();
    for (const text of lines) {
      try {
        const r = await A.addOwnerMemory(text);
        if (mem) mem.items.push(r.item);
        else mem = { items: [r.item], learn: true };
      } catch (err) {
        fail(err);
      }
    }
    paintMem(box);
    box.querySelector<HTMLTextAreaElement>('#mnsMemNew')?.focus();
  };
  card.querySelectorAll<HTMLElement>('.mns-mi').forEach((li) => {
    const id = li.dataset.mid!;
    const item = mem?.items.find((m) => m.id === id);
    if (!item) return;
    const tx = li.querySelector<HTMLElement>('[data-medit]');
    if (tx) {
      const start = (): void => {
        memEditing = id;
        paintMem(box);
        const inp = box.querySelector<HTMLInputElement>('#mnsMemEdit');
        inp?.focus();
        inp?.setSelectionRange(inp.value.length, inp.value.length);
      };
      tx.onclick = start;
      tx.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          start();
        }
      };
    }
    const inp = li.querySelector<HTMLInputElement>('#mnsMemEdit');
    if (inp) {
      let left = false;
      const finish = async (keep: boolean): Promise<void> => {
        if (left) return;
        left = true;
        const text = inp.value.trim();
        memEditing = '';
        if (keep && text && text !== item.text) {
          try {
            const r = await A.editOwnerMemory(id, { text });
            Object.assign(item, r.item);
          } catch (err) {
            fail(err);
          }
        }
        paintMem(box);
      };
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          void finish(false);
        }
      };
      inp.onblur = () => void finish(true);
    }
    li.querySelector<HTMLElement>('[data-mdel]')!.onclick = async () => {
      try {
        await A.deleteOwnerMemory(id);
        if (mem) mem.items = mem.items.filter((m) => m.id !== id);
        if (memEditing === id) memEditing = '';
        paintMem(box);
        toast(t('Forgotten'), 'ok');
      } catch (err) {
        fail(err);
      }
    };
  });
}

function introCard(s: A.MnemoState): string {
  const n = A.usableModels(s).length;
  const state = s.ready
    ? `<span class="mns-pill ok"><i></i>${tn(n, 'Ready · {n} model', 'Ready · {n} models')}</span>`
    : `<span class="mns-pill"><i></i>${t('Not set up yet')}</span>`;
  return `<div class="st-card mns-intro">${markHTML('lg')}<div class="mns-intro-t"><b>${t('{mnemo}, your notes agent', { mnemo: A.MNEMO })}</b>${state}
    <p>${t("Chat with a model you choose; {mnemo} reads, writes, tags, links, moves and tidies notes with Memora's own tools. It cannot browse the web, run commands, delete for good or change the server. Keys are sealed on this server and never sent to the browser.", { mnemo: A.MNEMO })}</p></div></div>`;
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
        ? `<span class="mns-pill">${t('Key ••••{hint}', { hint: esc(p.key_hint) })}</span>`
        : p.kind === 'custom'
          ? `<span class="mns-pill">${t('No key')}</span>`
          : `<span class="mns-pill warn">${t('No key')}</span>`;
      const tr = tested.get(p.id);
      return `<div class="mns-prov${p.enabled ? '' : ' off'}" data-id="${attr(p.id)}">
        <div class="mns-prov-h">
          <span class="mns-logo" data-p="${p.kind}">${p.kind === 'openai' ? 'O' : p.kind === 'anthropic' ? 'A' : esc((p.label || '?').charAt(0).toUpperCase())}</span>
          <span class="mns-prov-t"><b>${esc(p.label)}</b><small>${esc(A.providerName(p.kind))} · ${esc(hostOf(p.base_url))} · <code>${esc(p.id)}</code></small></span>
          ${switchHTML('mnsOn-' + p.id, p.enabled, t('Use {name}', { name: p.label }), ' data-enable')}
        </div>
        <div class="mns-prov-m">${keyPill}<span class="mns-pill">${tn(models, '{n} model', '{n} models')}</span>${
          p.enabled ? '' : `<span class="mns-pill">${t('Off: its models are hidden in chats')}</span>`
        }</div>
        <div class="mns-prov-a">
          <button type="button" class="btn sm" data-test>${icon('bolt')}<span>${t('Test')}</span></button>
          <button type="button" class="btn sm" data-fetch>${icon('refresh')}<span>${t('Fetch models')}</span></button>
          <button type="button" class="btn sm ghost" data-edit>${icon('edit')}<span>${t('Edit')}</span></button>
          <button type="button" class="btn sm ghost danger" data-del>${icon('trash')}<span>${t('Delete')}</span></button>
        </div>
        ${tr ? `<div class="mns-test ${tr.ok ? 'ok' : 'err'}" role="status">${icon(tr.ok ? 'check' : 'alert')}<span>${esc(tr.text)}</span></div>` : ''}
      </div>`;
    })
    .join('');
  return `<div class="st-card"><div class="st-ch mns-ch"><div><h3>${t('Providers')}</h3><p>${t("Where {mnemo}'s models come from. Add OpenAI, Anthropic or any OpenAI-compatible server, as many as you like, each with your own API key.", { mnemo: A.MNEMO })}</p></div>
      <button type="button" class="btn primary sm" id="mnsAddProv">${icon('plus')}<span>${t('Add provider')}</span></button></div>
    <div class="mns-provs">${rows || `<p class="mns-none">${t('No provider yet. Add one to start chatting with {mnemo}.', { mnemo: A.MNEMO })}</p>`}</div></div>`;
}

function modelsCard(s: A.MnemoState): string {
  if (!s.providers.length) {
    return `<div class="st-card"><div class="st-ch"><h3>${t('Models')}</h3><p>${t('Add a provider first; its models appear here.')}</p></div></div>`;
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
        p.enabled ? '' : ` · ${t('provider off')}`
      }</small></div>${list.map((m) => modelRow(m, def)).join('')}</div>`;
    })
    .join('');
  return `<div class="st-card"><div class="st-ch mns-ch"><div><h3>${t('Models')}</h3><p>${t('Pin the ones you use (they come first in every chat), hide the rest, and pick the default with the check mark. Context length and reply limits come from the provider.')}</p></div>
      <button type="button" class="btn primary sm" id="mnsAddModel">${icon('plus')}<span>${t('Add model')}</span></button></div>
    <div class="mns-mbar">
      <label class="mns-mq">${icon('search')}<input type="search" id="mnsMq" placeholder="${t('Filter models')}" value="${attr(modelQuery)}" autocomplete="off"></label>
      <label class="mns-chk"><input type="checkbox" id="mnsHid"${showHidden ? ' checked' : ''}><span>${t('Show hidden')}${hiddenN ? ` (${hiddenN})` : ''}</span></label>
    </div>
    <div class="mns-models">${byProv || `<p class="mns-none">${s.models.length ? t('No model matches.') : t('No models yet. Use Fetch models on a provider, or Add model.')}</p>`}</div>
  </div>`;
}

function limits(m: A.Model): string {
  const bits = [m.context_window ? t('{n} context', { n: A.fmtTokens(m.context_window) }) : '', m.max_output ? t('{n} reply', { n: A.fmtTokens(m.max_output) }) : ''].filter(Boolean);
  return bits.length ? bits.join(' · ') : m.fetched ? t('limits not reported') : t('added by hand');
}

function modelRow(m: A.Model, def: string): string {
  const key = A.modelKey(m);
  const isDef = key === def;
  return `<div class="mns-m${m.hidden ? ' hid' : ''}" data-p="${attr(m.provider_id)}" data-m="${attr(m.model_id)}">
    <button type="button" class="mns-star${m.pinned ? ' on' : ''}" data-pin aria-pressed="${m.pinned}" title="${m.pinned ? t('Unpin') : t('Pin')}" aria-label="${m.pinned ? t('Unpin {name}', { name: attr(m.model_id) }) : t('Pin {name}', { name: attr(m.model_id) })}">${icon('star')}</button>
    <span class="mns-m-t"><b title="${attr(m.model_id)}">${esc(m.label || m.model_id)}</b><small>${m.label ? esc(m.model_id) + ' · ' : ''}${esc(limits(m))}${isDef ? ` · <em>${t('default')}</em>` : ''}</small></span>
    <span class="mns-m-a">
      <button type="button" class="mn-ibtn${isDef ? ' on' : ''}" data-def title="${isDef ? t('The default model') : t('Make default')}" aria-pressed="${isDef}" aria-label="${t('Make {name} the default', { name: attr(m.model_id) })}">${icon('check')}</button>
      <button type="button" class="mn-ibtn" data-hide title="${m.hidden ? t('Show in chats') : t('Hide from chats')}" aria-label="${m.hidden ? t('Show {name}', { name: attr(m.model_id) }) : t('Hide {name}', { name: attr(m.model_id) })}">${icon(m.hidden ? 'eye-off' : 'eye')}</button>
      <button type="button" class="mn-ibtn" data-del title="${t('Remove')}" aria-label="${t('Remove {name}', { name: attr(m.model_id) })}">${icon('trash')}</button>
    </span>
  </div>`;
}

function behaviourCard(s: A.MnemoState): string {
  const p = s.prefs;
  return `<form class="st-card mns-beh" id="mnsBeh" novalidate autocomplete="off"><div class="st-ch"><h3>${t('How {mnemo} works', { mnemo: A.MNEMO })}</h3><p>${t('Applies to every chat.')}</p></div>
    <div class="st-row"><div class="st-l"><b>${t('Default model')}</b><small>${t('Used by new chats; each chat can switch.')}</small></div><div class="st-c"><span id="mnsDef"></span></div></div>
    <div class="st-row"><div class="st-l"><b>${t('Permission')}</b><small>${t('Ask first: {mnemo} reads freely but asks before it changes notes or runs sub-agents. Auto: changes and sub-agents go ahead without asking. Read only: it reads and answers, and never changes notes. Saved at once.', { mnemo: A.MNEMO })}</small></div>
      <div class="st-c"><div class="mns-seg" role="radiogroup" aria-label="${t('Permission')}">${(['ask', 'auto', 'read'] as const)
        .map(
          (v) =>
            `<label><input type="radio" name="mnsPerm" value="${v}"${(p.permission === 'auto' || p.permission === 'read' ? p.permission : 'ask') === v ? ' checked' : ''}><span>${
              v === 'ask' ? t('Ask first') : v === 'auto' ? t('Auto') : t('Read only')
            }</span></label>`,
        )
        .join('')}</div></div></div>
    <div class="st-row"><div class="st-l"><b>${t('Text size')}</b><small>${t("The size of the chat's text on this device. Auto is small on phones, so more fits, and medium elsewhere. Saved at once.")}</small></div>
      <div class="st-c">${textSizeHTML('settings')}</div></div>
    <div class="st-row full"><div class="st-l"><b>${t('Your instructions')}</b><small>${t('Tell {mnemo} how you like things, in your own words: the language to answer in, how to name notes, folders to leave alone…', { mnemo: A.MNEMO })}</small></div>
      <div class="st-c"><textarea class="ui-input mns-instr" name="system_prompt" rows="3" maxlength="4000" placeholder="${t('e.g. Answer briefly, in plain words. Keep meeting notes in Meetings/YYYY.')}">${esc(p.system_prompt || '')}</textarea></div></div>
    <div class="st-row sw"><div class="st-l"><b>${t('Floating button')}</b><small>${t('The {mnemo} button on every page (Ctrl+J). Saved at once. You can also hide or show it from More, or hide it by dragging it onto the X.', { mnemo: A.MNEMO })}</small></div><div class="st-c end">${switchHTML('mnsLauncher', hooks.mnemoButton(), t('Floating button'))}</div></div>
    <div class="st-row mns-save"><button type="submit" class="btn primary">${t('Save')}</button></div>
  </form>`;
}

/** Fallback models: their own card, Add in the header like Add provider and Add model. */
function fallbackCard(s: A.MnemoState): string {
  return `<div class="st-card" id="mnsFb"><div class="st-ch mns-ch"><div><h3>${t('Fallback models')}</h3><p>${t(
    "When a chat's model fails (the provider is down, busy or out of credit), {mnemo} carries on with these, in this order, up to five. With none left, the chat shows the error and Try again. Saved at once.",
    { mnemo: A.MNEMO },
  )}</p></div><span id="mnsFbAdd" class="mns-fb-add"></span></div><div class="mns-fb">${fallbackRows(s)}</div></div>`;
}

function fallbackRows(s: A.MnemoState): string {
  const list = s.prefs.fallback_models || [];
  if (!list.length) return `<p class="mns-fb-none">${t('None yet: a failed reply stops with the error.')}</p>`;
  return `<ol class="mns-fb-list">${list
    .map((k, i) => {
      const m = s.models.find((x) => A.modelKey(x) === k);
      const p = k.split('/')[0];
      return `<li class="mns-fb-i" data-fb="${i}"><span class="mn-q-n">${i + 1}</span><span class="mns-fb-t"><b>${esc(m?.label || m?.model_id || k.split('/').slice(1).join('/'))}</b><small>${esc(A.providerLabel(s, p))}${
        m ? '' : ` · ${t('not in your models')}`
      }</small></span><button type="button" class="mn-ibtn" data-fbm="up" title="${t('Earlier')}" aria-label="${t('Move up')}"${i === 0 ? ' disabled' : ''}>${icon('chev-up')}</button><button type="button" class="mn-ibtn" data-fbm="down" title="${t('Later')}" aria-label="${t('Move down')}"${
        i === list.length - 1 ? ' disabled' : ''
      }>${icon('chev-down')}</button><button type="button" class="mn-ibtn" data-fbm="del" title="${t('Remove')}" aria-label="${t('Remove')}">${icon('close')}</button></li>`;
    })
    .join('')}</ol>`;
}

/** Which agent the Tools card is switching tools for. */
let toolsFor: 'main' | 'sub' = 'main';

function toolsCard(s: A.MnemoState): string {
  const read = s.tools.filter((x) => !WRITE_TOOLS.has(x));
  const write = s.tools.filter((x) => WRITE_TOOLS.has(x));
  const own = (s.own_tools || []).filter((x) => !(toolsFor === 'sub' && ['delegate', 'ask_owner', 'update_plan', 'view_image'].includes(x)));
  const off = new Set((toolsFor === 'main' ? s.prefs.tools_off_main : s.prefs.tools_off_sub) || []);
  const chips = (list: string[]): string =>
    list.map((x) => `<button type="button" class="mns-tchip" data-tool="${attr(x)}" aria-pressed="${!off.has(x)}" title="${off.has(x) ? t('Off: tap to switch on') : t('On: tap to switch off')}">${esc(x)}</button>`).join('');
  const seg = (v: 'main' | 'sub', label: string): string =>
    `<button type="button" role="radio" data-tfor="${v}" aria-checked="${toolsFor === v}">${label}</button>`;
  return `<div class="st-card" id="mnsTools"><div class="st-ch"><h3>${t('What {mnemo} can use', { mnemo: A.MNEMO })}</h3><p>${t('Tools run under the name {mnemo} so every action shows in Activity. Tap a tool to switch it off or on, for {mnemo} itself or for its sub-agents. A tool switched off on the Tools page is off for both. Saved at once.', { mnemo: A.MNEMO })}</p></div>
    <div class="mns-tools"><div class="mns-tseg" role="radiogroup" aria-label="${t('Switch tools for')}">${seg('main', A.MNEMO)}${seg('sub', t('Sub-agents'))}</div>
    <div><b>${t('Reads ({n})', { n: read.length })}</b><div class="mns-chips">${chips(read)}</div></div>
    <div><b>${t('Changes ({n})', { n: write.length })}</b><div class="mns-chips w">${chips(write)}</div></div>
    ${own.length ? `<div><b>${t("{mnemo}'s own ({n})", { mnemo: A.MNEMO, n: own.length })}</b><div class="mns-chips">${chips(own)}</div></div>` : ''}
    <div class="mns-never">${icon('shield')}<span><b>${t('Never:')}</b> ${t('delete for good, empty the Trash, delete folders, import or export, read keys, change settings, browse the web or run commands.')}</span></div></div></div>`;
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
    <div class="mns-f"><span>${t('Type')}</span><div class="mns-seg" role="radiogroup" aria-label="${t('Type')}">${KINDS.map(
      (k) => `<label><input type="radio" name="kind" value="${k}"${kind === k ? ' checked' : ''}><span>${esc(A.providerName(k))}</span></label>`,
    ).join('')}</div><small class="mns-hint" data-blurb></small></div>
    <label class="mns-f"><span>${t('Name')}</span><input class="ui-input" name="label" type="text" maxlength="60" value="${attr(p?.label || '')}" placeholder="${t('e.g. OpenAI work, OpenRouter, Local Ollama')}"></label>
    <label class="mns-f"><span>ID</span><input class="ui-input" name="id" type="text" maxlength="32" spellcheck="false" value="${attr(p?.id || '')}"${p ? ' readonly' : ''} placeholder="openai-work">
      <small class="mns-hint">${p ? t('The ID cannot change: chats and models refer to it.') : t('Letters, digits and dashes. Made from the name; edit it if you like.')}</small></label>
    <div class="mns-f" data-style><span>API</span><div class="mns-seg" role="radiogroup" aria-label="API">${(['chat', 'responses'] as const)
      .map(
        (v) =>
          `<label><input type="radio" name="api_style" value="${v}"${(p?.api_style || 'chat') === v ? ' checked' : ''}><span>${v === 'chat' ? 'Chat Completions' : 'Responses'}</span></label>`,
      )
      .join('')}</div></div>
    <label class="mns-f"><span data-base-l>${t('Base URL')}</span><input class="ui-input" name="base_url" type="url" inputmode="url" spellcheck="false" value="${attr(p?.base_url || '')}"></label>
    <label class="mns-f"><span>${t('API key')}</span><input class="ui-input" name="api_key" type="password" spellcheck="false" autocomplete="new-password" placeholder="${attr(
      p?.key_hint ? t('Saved (ends in {hint}). Leave empty to keep it.', { hint: p.key_hint }) : '',
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
    q('[data-base-l]').textContent = kind === 'custom' ? t('Base URL (the server’s /v1 address)') : t('Base URL (optional)');
    base.placeholder = info.base;
    if (!p?.key_hint) keyIn.placeholder = info.key;
    if (!p) label.placeholder = kind === 'custom' ? t('e.g. OpenRouter, Local Ollama') : A.providerName(kind);
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
      toast(t('Give the provider a name'), 'err');
      label.focus();
      return;
    }
    const url = base.value.trim();
    if (kind === 'custom' && !url) {
      toast(t('An OpenAI-compatible provider needs its base URL'), 'err');
      base.focus();
      return;
    }
    const key = keyIn.value.trim();
    if (!p && !key && kind !== 'custom') {
      toast(t('Paste the API key'), 'err');
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
      toast(t('{name} saved', { name }), 'ok');
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
    title: p ? t('Edit {name}', { name: p.label }) : t('Add provider'),
    sub: A.MNEMO,
    body,
    actions: [
      { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
      { label: p ? t('Save') : t('Add provider'), cls: 'primary', run: save },
    ],
  });
  window.setTimeout(() => (p ? keyIn : label).focus(), 40);
}

/** Add a model by its id: pick the provider, type the id; it is added and pinned. */
function modelDialog(s: A.MnemoState): void {
  const body = el('form', 'mns-form');
  body.setAttribute('novalidate', '');
  body.setAttribute('autocomplete', 'off');
  body.innerHTML = `<div class="mns-f"><span>${t('Provider')}</span><span data-prov></span></div>
    <label class="mns-f"><span>${t('Model id')}</span><input class="ui-input" name="model" type="text" placeholder="${t('Model id, e.g. gpt-5.5 or claude-opus-5-5')}" spellcheck="false" maxlength="200"></label>`;
  const prov = createSelect({
    options: s.providers.map((p) => ({ value: p.id, label: p.label, hint: A.providerName(p.kind) })),
    value: s.providers.find((p) => p.enabled)?.id || s.providers[0]?.id,
    label: t('Provider'),
    className: 'mns-add-sel',
    minWidth: 240,
  });
  body.querySelector('[data-prov]')!.replaceWith(prov.el);
  const input = body.querySelector<HTMLInputElement>('[name=model]')!;
  const save = (): void => {
    const model = input.value.trim();
    if (!model) {
      input.focus();
      return;
    }
    A.setModel({ provider: prov.value, model, pinned: true }).then(() => {
      Modal.close();
      toast(t('{name} added and pinned', { name: model }), 'ok');
    }, fail);
  };
  body.onsubmit = (e) => {
    e.preventDefault();
    save();
  };
  Modal.open({
    title: t('Add model'),
    sub: A.MNEMO,
    body,
    actions: [
      { label: t('Cancel'), cls: 'ghost', run: () => Modal.close() },
      { label: t('Add model'), cls: 'primary', run: save },
    ],
  });
  window.setTimeout(() => input.focus(), 40);
}

async function runFetch(id: string, quiet: boolean, btn?: HTMLButtonElement): Promise<void> {
  if (btn) btn.disabled = true;
  try {
    const st = await A.fetchModels(id);
    toast(tn(st.fetched ?? 0, '{n} model from {name}', '{n} models from {name}', { name: A.providerLabel(st, id) }), 'ok');
  } catch (e) {
    if (!quiet) fail(e);
    else toast(t('Saved. Could not list the models ({error}); add them by name.', { error: (e as Error).message }), 'warn');
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
      A.saveProvider({ id, enabled: on }).then(() => toast(on ? t('{name} is on', { name: p.label }) : t('{name} is off; its models are hidden in chats', { name: p.label }), 'ok'), fail);
    };
    row.querySelector<HTMLButtonElement>('[data-test]')!.onclick = async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      b.querySelector('span')!.textContent = t('Testing…');
      try {
        const r = await A.testProvider(id);
        tested.set(id, {
          ok: r.ok,
          text: r.ok ? t('Connected in {ms} ms · {n} models available', { ms: r.ms ?? 0, n: r.models ?? 0 }) : (r.error && ts(r.error)) || t('The provider did not answer'),
        });
      } catch (err) {
        tested.set(id, { ok: false, text: (err as Error).message });
      }
      paint(box, A.mnemoState() ?? s);
    };
    row.querySelector<HTMLButtonElement>('[data-fetch]')!.onclick = (e) => void runFetch(id, false, e.currentTarget as HTMLButtonElement);
    row.querySelector<HTMLElement>('[data-edit]')!.onclick = () => providerDialog(p);
    row.querySelector<HTMLElement>('[data-del]')!.onclick = () => {
      Modal.confirm(t('Delete {name}?', { name: p.label }), t('Its API key and its models are removed. Chats stay; a chat that used one of its models switches to the default.'), t('Delete'), async () => {
        try {
          await A.deleteProvider(id);
          tested.delete(id);
          Modal.close();
          toast(t('{name} deleted', { name: p.label }), 'ok');
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
  const addModel = box.querySelector<HTMLButtonElement>('#mnsAddModel');
  if (addModel) addModel.onclick = () => modelDialog(s);

  // How Mnemo works.
  const beh = box.querySelector<HTMLFormElement>('#mnsBeh');
  if (beh) {
    const slot = beh.querySelector<HTMLElement>('#mnsDef')!;
    const list = A.usableModels(s);
    defaultSel = createSelect({
      options: [
        { value: '', label: t('First pinned model'), hint: t('Or the first visible one') },
        ...list.map((m) => ({
          value: A.modelKey(m),
          label: m.label || m.model_id,
          hint: A.providerLabel(s, m.provider_id),
          group: m.pinned ? t('Pinned') : A.providerLabel(s, m.provider_id),
        })),
      ],
      value: s.prefs.default_model && list.some((m) => A.modelKey(m) === s.prefs.default_model) ? s.prefs.default_model : '',
      label: t('Default model'),
      searchable: list.length > 7,
      minWidth: 260,
    });
    slot.append(defaultSel.el);
  }
  // Fallback models: add, reorder, remove; each change is saved at once.
  const fbCard = box.querySelector<HTMLElement>('#mnsFb');
  if (fbCard) {
    const list = A.usableModels(s);
    const fb = (s.prefs.fallback_models || []).slice();
    const saveFb = (next: string[]): void => {
      void A.savePrefs({ fallback_models: next.length ? next : null }).catch(fail);
    };
    fbCard.querySelectorAll<HTMLButtonElement>('[data-fbm]').forEach((b) => {
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
    const addSlot = fbCard.querySelector<HTMLElement>('#mnsFbAdd')!;
    if (fb.length < 5 && left.length) {
      fbSel?.close();
      fbSel = createSelect({
        options: left.map((m) => ({
          value: A.modelKey(m),
          label: m.label || m.model_id,
          hint: A.providerLabel(s, m.provider_id),
          group: m.pinned ? t('Pinned') : A.providerLabel(s, m.provider_id),
        })),
        value: '',
        label: t('Add a fallback model'),
        searchable: left.length > 7,
        minWidth: 260,
        align: 'end',
        className: 'mns-fb-btn',
        render: () => `${icon('plus')}<span>${t('Add a fallback model')}</span>`,
        onChange: (v) => v && saveFb([...fb, v]),
      });
      addSlot.append(fbSel.el);
    }
  }
  if (beh) {
    const launcher = beh.querySelector<HTMLElement>('#mnsLauncher')!;
    wireTextSize(beh);
    beh.querySelectorAll<HTMLInputElement>('[name=mnsPerm]').forEach((r) => {
      r.onchange = () => {
        void A.savePrefs({ permission: r.value as 'ask' | 'auto' | 'read' })
          .then(() =>
            toast(
              r.value === 'auto' ? t('Auto: {mnemo} goes ahead without asking', { mnemo: A.MNEMO }) : r.value === 'read' ? t('Read only: {mnemo} reads and answers, never changes notes', { mnemo: A.MNEMO }) : t('Ask first: {mnemo} asks before changes', { mnemo: A.MNEMO }),
              'ok',
            ),
          )
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
        toast(on ? t('The {mnemo} button is back', { mnemo: A.MNEMO }) : t('{mnemo} button hidden. Show it again here or from More.', { mnemo: A.MNEMO }), 'ok');
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
        toast(t('{mnemo} settings saved', { mnemo: A.MNEMO }), 'ok');
      } catch (err) {
        fail(err);
      }
    };
  }
}

const CSS = `
.mns{display:flex;flex-direction:column;gap:16px}
.mns-job{display:flex;gap:8px;width:100%;min-width:0}
.mns-job>span{display:flex;min-width:0}
.mns-job>span[data-role]{flex:1}
.mns-job .ui-sel{width:100%;max-width:none;height:44px}
.mns-job>span[data-voice]{flex:0 0 140px}
.mns-mem{display:flex;flex-direction:column;gap:14px;padding:4px 20px 6px}
.mns-mem .mns-none{padding:6px 0}
.mns-ml{display:flex;flex-direction:column;margin:0;padding:0;list-style:none;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.mns-mi{display:flex;align-items:center;gap:8px;min-height:44px;padding:6px 6px 6px 12px;border-top:1px solid var(--line)}
.mns-mi:first-child{border-top:0}
.mns-mi:hover{background:var(--hover)}
.mns-mi-b{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.mns-mi-t{font-size:13.5px;line-height:1.45;color:var(--fg);overflow-wrap:anywhere;cursor:text;border-radius:6px}
.mns-mi-t:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mns-mi-in{height:36px;font-size:13.5px}
.mns-mi-b small{font-size:11.5px;color:var(--muted)}
.mns-mi-by.own{color:var(--accent)}
.mns-mem-add{display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:12px 20px 18px;flex-wrap:wrap}
.mns-mem-add .ui-input{width:100%;min-width:0;min-height:40px;height:auto;padding-top:9px;padding-bottom:9px;resize:vertical;line-height:1.45;font:inherit}
.mns-mem-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mns-grow{flex:1}
.mns-mem-hint{color:var(--muted);font-size:12px;line-height:1.45}
.mns-mem-add .btn{flex:none}
@media (max-width:720px){
  .mns-mem{padding:4px 16px 6px}
  .mns-mem-add{padding:12px 16px 16px}
}
@media (max-width:640px){
  .mns-job{flex-direction:column}
  .mns-job>span[data-voice]{flex:none}
  .mns-mem-add .ui-input,.mns-mi-in{font-size:16px}
  .mns-mem-k,.ui-sel.mns-mem-ksel{width:100%}
  .mns-mem-add .btn{width:100%;justify-content:center}
}
.mns-fb{display:flex;flex-direction:column;align-items:flex-start;gap:8px;width:100%}
.mns-fb-none{margin:0;font-size:12.5px;color:var(--muted)}
/* Add a fallback model: the same teal primary look as Add provider and Save. */
.mns-fb-add{display:flex;flex:none}
.ui-sel.mns-fb-btn{height:28px;padding:0 10px;gap:6px;border-radius:var(--r-xs);border-color:transparent;color:var(--on-primary);font-weight:600;font-size:12px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--primary) 78%,#fff),var(--primary) 60%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 1px 2px rgba(3,37,42,.18),0 6px 16px -8px color-mix(in srgb,var(--primary) 70%,transparent)}
.ui-sel.mns-fb-btn:hover,.ui-sel.mns-fb-btn[aria-expanded=true]{border-color:transparent;background:linear-gradient(180deg,color-mix(in srgb,var(--primary-hover) 72%,#fff),var(--primary-hover) 60%)}
.ui-sel.mns-fb-btn:active{transform:translateY(.5px)}
.ui-sel.mns-fb-btn .i{width:16px;height:16px;color:currentColor}
@media (pointer:coarse){.ui-sel.mns-fb-btn{min-height:36px}}
#mnsFb .mns-fb{padding:0 24px 20px}
@media (max-width:640px){#mnsFb .mns-fb{padding:0 16px 16px}.mns-ch{flex-wrap:wrap}}
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
.ui-sel.mns-add-sel{width:100%;max-width:none}
@media (max-width:640px){.mns-mq{max-width:none}}
.mns-beh textarea{width:100%;min-height:96px;resize:vertical;font:inherit;font-size:13.5px;line-height:1.5}
.mns-tools{display:flex;flex-direction:column;gap:14px;padding:0 20px 18px}
.mns-tools b{font-size:12.5px;font-weight:600;color:var(--text-2,var(--fg))}
.mns-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.mns-tseg{display:inline-flex;align-self:flex-start;padding:3px;gap:2px;border:1px solid var(--line);border-radius:10px;background:color-mix(in srgb,var(--fg) 3%,transparent)}
.mns-tseg button{height:30px;padding:0 12px;border:0;border-radius:8px;background:none;font:inherit;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer}
.mns-tseg button[aria-checked=true]{background:var(--surface-0,var(--bg));color:var(--fg);box-shadow:0 1px 3px rgba(15,23,42,.12)}
.mns-tchip{font:11.5px/1 var(--mono);padding:6px 9px;border:1px solid transparent;border-radius:7px;background:color-mix(in srgb,var(--fg) 6%,transparent);color:var(--text-2,var(--fg));cursor:pointer;transition:background .15s,opacity .15s}
.mns-chips.w .mns-tchip{background:var(--accent-soft);color:var(--fg)}
.mns-tchip[aria-pressed=false]{background:none;border-color:var(--line);color:var(--muted);text-decoration:line-through;opacity:.75}
.mns-tchip:hover{border-color:var(--line-strong)}
.mns-tchip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
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
