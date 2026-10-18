// Access rules: the ordered IP / range / CIDR / domain stack the gateway checks
// before anything else, plus a tester that tells what an address would get.
// The server knows two operations, add (to the end) and remove (by kind and
// value); editing a rule is a remove followed by an add.

import { apiGet, apiPost } from '../api';
import { $, $$, attr, esc, useStyles } from '../dom';
import { Modal } from '../modal';
import { toast } from '../toast';
import { ICO, openMenu, openSheet, systemHeader, useControlStyles, type Sheet } from '../control/ui';
import { skBlock } from '../ui/skeleton';
import type { AccessRule, AccessStack, AccessTestResult, OkResult } from '../types';

interface Rule extends AccessRule {
  id?: string;
  enabled?: boolean;
  note?: string;
}

type Kind = 'ip' | 'range' | 'cidr' | 'domain' | 'all';
type Action = 'allow' | 'block';

const KINDS: { v: Kind; l: string; field: string; ph: string; hint: string }[] = [
  { v: 'ip', l: 'One address', field: 'IP address', ph: '203.0.113.7', hint: 'A single IPv4 or IPv6 address.' },
  { v: 'cidr', l: 'A network', field: 'Network (CIDR)', ph: '192.168.1.0/24', hint: 'Address and prefix, e.g. a home or office network.' },
  { v: 'range', l: 'An address range', field: 'First and last address', ph: '203.0.113.10-203.0.113.50', hint: 'Two addresses joined by a dash.' },
  { v: 'domain', l: 'A domain', field: 'Domain name', ph: 'memory.example.com', hint: 'The host name the request was sent to. *.example.com works too.' },
  { v: 'all', l: 'Everyone', field: '', ph: '', hint: 'Every request. Put it last, as a catch-all.' },
];

const CSS = `
.ac2{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,1fr);gap:16px;align-items:start}
.ac2-side{display:flex;flex-direction:column;gap:16px;min-width:0}
.ac2 .cc-card-h{min-height:56px;padding:12px 16px}
.ac2 .cc-card-h h2{font-size:14.5px;font-weight:680;letter-spacing:0}
.ac2 .cc-card-h .btn{height:36px}
.ac2-how{list-style:none;margin:0;padding:14px 16px 6px;display:flex;flex-direction:column;gap:14px}
.ac2-how li{display:flex;gap:12px;align-items:flex-start}
.ac2-how .n{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;flex:none;font-size:12px;font-weight:700;
  color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line)}
.ac2-how .tt{display:block;font-size:13.5px;font-weight:650}
.ac2-how .ds{display:block;font-size:12.5px;color:var(--muted);line-height:1.5;margin-top:1px}
.ac2-how .ds b{color:var(--fg)}
.ac2-note{margin:8px 16px 16px;padding:10px 12px;border-radius:10px;background:var(--panel-2);border:1px solid var(--line);
  font-size:12.5px;color:var(--muted);line-height:1.5}
.ac2-rule{display:flex;align-items:center;gap:12px;padding:12px 12px 12px 16px;border-top:1px solid var(--line);min-height:64px}
.ac2-rule:first-child{border-top:0}
.ac2-rule.paused{opacity:.65}
.ac2-num{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;flex:none;background:var(--panel-2);border:1px solid var(--line);
  font-size:12px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.ac2-act{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:76px;height:26px;border-radius:99px;font-size:12px;font-weight:700;flex:none}
.ac2-act.allow{color:var(--ok);background:var(--ok-soft);border:1px solid color-mix(in srgb,var(--ok) 35%,transparent)}
.ac2-act.block{color:var(--danger);background:var(--danger-soft);border:1px solid color-mix(in srgb,var(--danger) 35%,transparent)}
.ac2-act .cc-i{width:13px;height:13px;stroke-width:2.4}
.ac2-what{flex:1;min-width:0}
.ac2-what .v{display:block;font-family:var(--mono);font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ac2-what .k{display:block;font-size:12px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ac2-rule .cc-ibtn{width:40px;height:40px}
.ac2-def{display:flex;align-items:center;gap:12px;padding:13px 16px;border-top:1px dashed var(--line-strong);font-size:13px;
  background:color-mix(in srgb,var(--panel-2) 50%,transparent);border-radius:0 0 var(--r-lg) var(--r-lg)}
.ac2-def .ac2-num{border-style:dashed}
.ac2-def .ac2-what .v{font-family:inherit}
.ac2-empty{padding:30px 20px;text-align:center}
.ac2-empty .ic{display:inline-grid;place-items:center;width:48px;height:48px;border-radius:14px;background:var(--accent-soft);color:var(--accent);
  border:1px solid var(--accent-line);margin-bottom:10px}
.ac2-empty .ic .cc-i{width:22px;height:22px}
.ac2-empty b{display:block;font-size:15px;margin-bottom:4px}
.ac2-empty p{margin:0 auto 14px;max-width:46ch;font-size:13px;color:var(--muted);line-height:1.55}
.ac2-test{padding:14px 16px 16px;display:flex;flex-direction:column;gap:12px}
.ac2-f{display:flex;flex-direction:column;gap:6px;min-width:0}
.ac2-f>span{font-size:12.5px;font-weight:600;color:var(--muted)}
.ac2-in{height:42px;padding:0 12px;border-radius:10px;border:1px solid var(--line-strong);background:var(--surface-0);color:var(--fg);font-size:14px;
  font-family:var(--mono);width:100%;min-width:0;outline:none;transition:border-color .16s}
.ac2-in:focus{border-color:var(--accent-line)}
.ac2-in[aria-invalid=true]{border-color:color-mix(in srgb,var(--danger) 60%,transparent)}
.ac2-hint{font-size:12px;color:var(--muted);line-height:1.45}
.ac2-hint.err{color:var(--danger)}
.ac2-res{display:flex;align-items:center;gap:12px;padding:12px 13px;border-radius:12px;border:1px dashed var(--line-strong);color:var(--muted);
  font-size:12.5px;min-height:58px;line-height:1.45}
.ac2-res.allow{border-style:solid;border-color:color-mix(in srgb,var(--ok) 45%,transparent);background:var(--ok-soft);color:var(--fg)}
.ac2-res.block{border-style:solid;border-color:color-mix(in srgb,var(--danger) 45%,transparent);background:var(--danger-soft);color:var(--fg)}
.ac2-res b{font-size:14.5px}
.ac2-res>.cc-i{width:22px;height:22px}
.ac2-res.allow>.cc-i{color:var(--ok)}
.ac2-res.block>.cc-i{color:var(--danger)}
.ac2-test .btn{height:40px;align-self:flex-start;padding:0 18px}
/* rule sheet */
.ac2-kinds{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.ac2-opt{display:flex;gap:11px;align-items:flex-start;padding:11px 12px;border:1px solid var(--line);border-radius:12px;cursor:pointer;
  min-height:48px;transition:border-color .16s,background .16s;min-width:0}
.ac2-opt:hover{border-color:color-mix(in srgb,var(--accent) 35%,var(--line))}
.ac2-opt:has(input:checked){border-color:var(--accent-line);background:var(--accent-soft)}
.ac2-opt:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.ac2-opt input{flex:none;width:17px;height:17px;margin:1px 0 0;accent-color:var(--accent)}
.ac2-opt b{display:block;font-size:13.5px;font-weight:620}
.ac2-opt small{display:block;font-size:12px;color:var(--muted);margin-top:2px;line-height:1.4}
.ac2-opt.allow:has(input:checked){border-color:color-mix(in srgb,var(--ok) 45%,transparent);background:var(--ok-soft)}
.ac2-opt.block:has(input:checked){border-color:color-mix(in srgb,var(--danger) 45%,transparent);background:var(--danger-soft)}
.ac2-opt.allow input{accent-color:var(--ok)}
.ac2-opt.block input{accent-color:var(--danger)}
.ac2-kinds .ac2-opt.wide{grid-column:1/-1}
.ac2-prev{padding:12px 14px;border-radius:12px;background:var(--panel-2);border:1px solid var(--line);font-size:13.5px;line-height:1.5}
.ac2-prev code{font-family:var(--mono);font-size:12.5px}
.ac2-warn{padding:10px 12px;border-radius:10px;font-size:12.5px;line-height:1.5;margin-top:10px;
  border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);background:var(--warn-soft)}
.ac2-warn[hidden]{display:none}
.ac2-sk{padding:16px;display:flex;flex-direction:column;gap:16px}
@media (max-width:1100px){
  .ac2{grid-template-columns:1fr}
  .ac2-side{display:contents}
}
@media (max-width:760px){
  .ac2{gap:12px}
  .ac2-rule{padding:10px 6px 10px 12px;gap:10px}
  .ac2-num{width:24px;height:24px;font-size:11px}
  .ac2-act{width:auto;padding:0 9px}
  .ac2-rule .cc-ibtn{width:44px;height:44px}
  .ac2-how{padding:12px 14px 4px}
  .ac2-note{margin:8px 14px 14px}
  .ac2-test{padding:12px 14px 14px}
  .ac2-test .btn{align-self:stretch;height:44px}
  .ac2-kinds{grid-template-columns:1fr}
  .ac2 .cc-card-h .btn{height:40px}
}
`;

function ruleValue(r: Rule): string {
  return r.value || r.ip || r.domain || r.range || r.cidr || '';
}
function ruleKind(r: Rule): Kind {
  const k = (r.kind || r.type || 'ip') as Kind;
  return KINDS.some((x) => x.v === k) ? k : 'ip';
}
function ruleAction(r: Rule): Action {
  return (r.action || r.mode) === 'block' ? 'block' : 'allow';
}
function kindLabel(k: Kind): string {
  return { ip: 'IP address', cidr: 'Network', range: 'Address range', domain: 'Domain', all: 'Everyone' }[k];
}

/** "Block 203.0.113.7" style sentence for a rule. */
function sentence(k: Kind, v: string, a: Action): string {
  const verb = a === 'block' ? 'blocked' : 'allowed';
  if (k === 'all') return `Every request is <b>${verb}</b>.`;
  const who =
    k === 'domain'
      ? `Requests sent to <code>${esc(v || 'the domain')}</code>`
      : k === 'ip'
        ? `Requests from <code>${esc(v || 'the address')}</code>`
        : `Requests from any address in <code>${esc(v || 'the range')}</code>`;
  return `${who} are <b>${verb}</b>.`;
}

function check(k: Kind, v: string): string {
  if (k === 'all') return '';
  if (!v) return 'A value is required.';
  const ip4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const ip = (s: string): boolean => ip4.test(s) || (/^[0-9a-f:]+$/i.test(s) && s.includes(':'));
  if (k === 'ip' && !ip(v)) return 'That is not an IP address.';
  if (k === 'cidr') {
    const [a, b] = v.split('/');
    if (!a || !b || !ip(a) || !/^\d{1,3}$/.test(b)) return 'Use address/prefix, e.g. 10.0.0.0/8.';
  }
  if (k === 'range') {
    const [a, b] = v.split('-').map((s) => s.trim());
    if (!a || !b || !ip(a) || !ip(b)) return 'Use first-last, e.g. 10.0.0.1-10.0.0.9.';
  }
  if (k === 'domain' && !/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i.test(v)) return 'That is not a domain name.';
  return '';
}

const ICO_GLOBE =
  '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
const ICO_EDIT = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>';
const ICO_TRASH =
  '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

let rules: Rule[] = [];
let defaultAllow = true;
/** Bumped on every render so a slower, older load cannot paint over a newer one. */
let renderSeq = 0;
/** Bumped on every test so only the latest answer is shown. */
let testSeq = 0;

export async function renderAccess(): Promise<void> {
  useControlStyles();
  useStyles('cc-access-css-2', CSS);
  const host = $('#view-access');
  const seq = ++renderSeq;
  host.innerHTML = `<div class="cc">${systemHeader(
    'access',
    'Access rules',
    'Decide which addresses and domains may reach this server at all, before anyone signs in.',
    `<button type="button" class="btn primary" id="aAdd">${ICO.plus}Add rule</button>
     <button type="button" class="cc-ibtn" id="aReload" aria-label="Reload" title="Reload">${ICO.refresh}</button>`,
  )}
    <div class="ac2">
      <section class="cc-card" aria-labelledby="acStackT"><div class="cc-card-h"><h2 id="acStackT">Rules</h2>
        <span class="sub" id="aCount"></span><span class="grow"></span></div>
        <div id="aList"><div class="ac2-sk" aria-busy="true">${[0, 1, 2]
          .map(() => `<div class="sk-row">${skBlock('28px', 28)}${skBlock('70px', 24, 'pill')}${skBlock('40%', 14)}</div>`)
          .join('')}</div></div></section>
      <div class="ac2-side">
        <section class="cc-card" aria-labelledby="acHowT"><div class="cc-card-h"><h2 id="acHowT">How it works</h2></div>
          <ol class="ac2-how">
            <li><span class="n">1</span><span><span class="tt">A request arrives</span><span class="ds">Rules are checked before sign-in and before any API key.</span></span></li>
            <li><span class="n">2</span><span><span class="tt">Rules are read top to bottom</span><span class="ds">The first rule that matches decides: allow or block.</span></span></li>
            <li><span class="n">3</span><span><span class="tt">No rule matches</span><span class="ds" id="aDefTxt">The default applies.</span></span></li>
          </ol>
          <div class="ac2-note">Requests from this machine itself (localhost) always get through, so the server can never lock itself out.</div>
        </section>
        <section class="cc-card" aria-labelledby="acTestT"><div class="cc-card-h"><h2 id="acTestT">Test an address</h2></div>
          <form class="ac2-test" id="tForm" novalidate>
            <p class="ac2-hint" style="margin:0">See what the rules would do with a request, without changing anything.</p>
            <label class="ac2-f"><span>IP address</span><input class="ac2-in" id="tIp" type="text" inputmode="decimal" placeholder="203.0.113.7" spellcheck="false" autocomplete="off"></label>
            <label class="ac2-f"><span>Domain <span style="font-weight:400">(optional)</span></span><input class="ac2-in" id="tDom" type="text" placeholder="memory.example.com" spellcheck="false" autocomplete="off" autocapitalize="off"></label>
            <div class="ac2-res" id="tRes" role="status">Enter an address or a domain, then test.</div>
            <button class="btn" id="aTest" type="submit">Test</button>
          </form></section>
      </div>
    </div></div>`;

  $('#aReload').onclick = () => void renderAccess();
  $('#aAdd').onclick = () => openRule();
  wireTest();

  try {
    const d = await apiGet<AccessStack>('/api/access');
    if (seq !== renderSeq) return;
    rules = (d.rules || []) as Rule[];
    defaultAllow = d.default_allow !== false;
  } catch (e) {
    if (seq !== renderSeq) return;
    $('#aList').innerHTML = `<div class="cc-empty"><b>Could not load the rules</b>${esc((e as Error).message)}
      <div style="margin-top:12px"><button type="button" class="btn" id="aRetry">${ICO.refresh}Try again</button></div></div>`;
    $('#aRetry').onclick = () => void renderAccess();
    return;
  }
  paintRules();
}

function paintRules(): void {
  $('#aCount').textContent = rules.length ? `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}, first match wins` : '';
  $('#aDefTxt').innerHTML = `The default applies: right now everything else is <b>${defaultAllow ? 'allowed' : 'blocked'}</b>.`;
  const def = `<div class="ac2-def"><span class="ac2-num" aria-hidden="true">${ICO_GLOBE}</span>
    <span class="ac2-act ${defaultAllow ? 'allow' : 'block'}">${defaultAllow ? ICO.check + 'Allow' : ICO.x + 'Block'}</span>
    <span class="ac2-what"><span class="v">Everything else</span><span class="k">The default when no rule matches. Set on the server, not here.</span></span></div>`;
  if (!rules.length) {
    $('#aList').innerHTML = `<div class="ac2-empty"><span class="ic">${ICO.shield}</span><b>No rules yet</b>
      <p>Anyone who can reach the server gets to the sign-in page. Add a rule to block an address, or to let only your own network in.</p>
      <button type="button" class="btn primary" id="aAddFirst">${ICO.plus}Add the first rule</button></div>${def}`;
    $('#aAddFirst').onclick = () => openRule();
    return;
  }
  $('#aList').innerHTML =
    rules
      .map((r, i) => {
        const a = ruleAction(r);
        const k = ruleKind(r);
        const v = ruleValue(r);
        const paused = r.enabled === false;
        return `<div class="ac2-rule${paused ? ' paused' : ''}"><span class="ac2-num" title="Checked ${i === 0 ? 'first' : 'as number ' + (i + 1)}">${i + 1}</span>
          <span class="ac2-act ${a}">${a === 'block' ? ICO.x + 'Block' : ICO.check + 'Allow'}</span>
          <span class="ac2-what"><span class="v">${esc(k === 'all' ? 'Everyone' : v)}</span><span class="k">${esc(kindLabel(k))}${
            paused ? ' · paused, skipped' : ''
          }${r.note ? ' · ' + esc(r.note) : ''}</span></span>
          <button type="button" class="cc-ibtn" data-i="${i}" aria-haspopup="menu" aria-label="Actions for rule ${i + 1}" title="More">${ICO.more}</button></div>`;
      })
      .join('') + def;
  $$<HTMLElement>('[data-i]', $('#aList')).forEach(
    (b) =>
      (b.onclick = () => {
        const i = Number(b.dataset.i);
        const r = rules[i];
        const a = ruleAction(r);
        const label = `${a === 'block' ? 'Block' : 'Allow'} ${ruleKind(r) === 'all' ? 'everyone' : ruleValue(r)}`;
        openMenu(
          b,
          [
            { label: 'Edit rule', desc: 'Change what it matches or what it does.', icon: ICO_EDIT, run: () => openRule(r, i) },
            ...(ruleKind(r) === 'ip'
              ? [{ label: 'Test this address', desc: 'Fill the tester with it and see the result.', icon: ICO.search, run: () => testValue(ruleValue(r)) }]
              : []),
            { sep: true, label: '' },
            { label: 'Delete rule', desc: 'Remove it; the rules below move up.', icon: ICO_TRASH, danger: true, run: () => delRule(r) },
          ],
          { title: `Rule ${i + 1}: ${label}` },
        );
      }),
  );
}

function testValue(ip: string): void {
  const inp = $('#tIp') as HTMLInputElement;
  inp.value = ip;
  ($('#tDom') as HTMLInputElement).value = '';
  inp.scrollIntoView({ block: 'center', behavior: 'smooth' });
  ($('#tForm') as HTMLFormElement).requestSubmit();
}

function delRule(r: Rule): void {
  const v = ruleKind(r) === 'all' ? 'everyone' : ruleValue(r);
  Modal.confirm('Delete rule', `Remove the rule that ${ruleAction(r) === 'block' ? 'blocks' : 'allows'} ${v}? It stops applying at once.`, 'Delete rule', async () => {
    try {
      await remove(r);
      Modal.close();
      toast('Rule deleted', 'ok');
      void renderAccess();
    } catch (e) {
      toast('Could not delete: ' + (e as Error).message, 'err');
    }
  });
}

function remove(r: Rule): Promise<OkResult> {
  return apiPost<OkResult>('/api/access/rules', { op: 'remove', value: ruleValue(r), kind: r.kind || r.type, action: r.action || r.mode });
}
function add(kind: Kind, value: string, action: Action): Promise<OkResult> {
  return apiPost<OkResult>('/api/access/rules', { op: 'add', kind, value: kind === 'all' ? '' : value, action });
}

/** Add a rule, or edit `r` (at position `idx`). */
function openRule(r?: Rule, idx = -1): void {
  let kind: Kind = r ? ruleKind(r) : 'ip';
  let action: Action = r ? ruleAction(r) : 'block';
  const last = idx === rules.length - 1;
  const body = `
    <section class="cc-sh-sec"><h3 id="arKindT">Who does it match?</h3><p>Pick what to look at in each request.</p>
      <div class="ac2-kinds" role="radiogroup" aria-labelledby="arKindT">${KINDS.map(
        (k) => `<label class="ac2-opt${k.v === 'all' ? ' wide' : ''}"><input type="radio" name="ar-kind" value="${k.v}"${k.v === kind ? ' checked' : ''}>
          <span><b>${esc(k.l)}</b><small>${esc(k.hint)}</small></span></label>`,
      ).join('')}</div>
      <label class="ac2-f" id="arValF" style="margin-top:14px"><span id="arValL"></span>
        <input class="ac2-in" id="arVal" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" value="${attr(r ? ruleValue(r) : '')}" aria-describedby="arHint"></label>
      <div class="ac2-hint" id="arHint" style="margin-top:6px"></div></section>
    <section class="cc-sh-sec"><h3 id="arActT">What happens?</h3><p>Only the first rule that matches a request counts.</p>
      <div class="ac2-kinds" role="radiogroup" aria-labelledby="arActT">
        <label class="ac2-opt allow"><input type="radio" name="ar-act" value="allow"${action === 'allow' ? ' checked' : ''}>
          <span><b>Allow</b><small>Let it through to sign-in and API keys.</small></span></label>
        <label class="ac2-opt block"><input type="radio" name="ar-act" value="block"${action === 'block' ? ' checked' : ''}>
          <span><b>Block</b><small>Refuse it before anything else.</small></span></label></div></section>
    <section class="cc-sh-sec"><h3>In short</h3><div class="ac2-prev" id="arPrev" aria-live="polite"></div>
      <div class="ac2-warn" id="arWarn" hidden></div>
      ${r && !last ? `<div class="ac2-warn">Saving moves this rule from position ${idx + 1} to the end of the list, so it is checked last.</div>` : ''}</section>`;

  openSheet({
    title: r ? `Edit rule ${idx + 1}` : 'Add a rule',
    sub: r ? undefined : `It goes to the end of the list, as rule ${rules.length + 1}.`,
    body,
    width: 540,
    actions: [
      { label: 'Cancel', cls: 'ghost', left: true, run: (s) => s.close() },
      { label: r ? 'Save rule' : 'Add rule', cls: 'primary', run: (s) => save(s) },
    ],
    onOpen: (s) => {
      const b = s.body;
      const val = $('#arVal', b) as HTMLInputElement;
      const hint = $('#arHint', b);
      const sync = (): void => {
        const kd = KINDS.find((x) => x.v === kind)!;
        ($('#arValF', b) as HTMLElement).hidden = kind === 'all';
        hint.hidden = kind === 'all';
        $('#arValL', b).textContent = kd.field;
        val.placeholder = kd.ph;
        if (!hint.classList.contains('err')) hint.textContent = kd.hint;
        $('#arPrev', b).innerHTML = sentence(kind, val.value.trim(), action);
        const warn = $('#arWarn', b) as HTMLElement;
        warn.hidden = !(kind === 'all' && action === 'block');
        warn.innerHTML = 'This blocks every request that no rule above it allows, including your own unless an allow rule for your address comes first.';
      };
      $$<HTMLInputElement>('input[name=ar-kind]', b).forEach(
        (i) =>
          (i.onchange = () => {
            kind = i.value as Kind;
            val.removeAttribute('aria-invalid');
            hint.classList.remove('err');
            sync();
            if (kind !== 'all') val.focus();
          }),
      );
      $$<HTMLInputElement>('input[name=ar-act]', b).forEach(
        (i) =>
          (i.onchange = () => {
            action = i.value as Action;
            sync();
          }),
      );
      val.oninput = () => {
        val.removeAttribute('aria-invalid');
        hint.classList.remove('err');
        sync();
      };
      val.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void save(s);
        }
      };
      sync();
    },
  });

  async function save(s: Sheet): Promise<void> {
    const b = s.body;
    const val = $('#arVal', b) as HTMLInputElement;
    const hint = $('#arHint', b);
    const v = val.value.trim();
    const problem = check(kind, v);
    if (problem) {
      val.setAttribute('aria-invalid', 'true');
      hint.classList.add('err');
      hint.textContent = problem;
      val.focus();
      return;
    }
    if (r && kind === ruleKind(r) && v === ruleValue(r) && action === ruleAction(r)) {
      s.close();
      return;
    }
    try {
      if (r) {
        await remove(r);
        try {
          await add(kind, v, action);
        } catch (e) {
          // Put the old rule back so nothing is lost.
          await add(ruleKind(r), ruleValue(r), ruleAction(r)).catch(() => undefined);
          throw e;
        }
      } else {
        await add(kind, v, action);
      }
      s.close();
      toast(r ? 'Rule saved' : 'Rule added', 'ok');
      void renderAccess();
    } catch (e) {
      hint.hidden = false;
      hint.classList.add('err');
      hint.textContent = 'Could not save: ' + (e as Error).message;
    }
  }
}

function wireTest(): void {
  ($('#tForm') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const res = $('#tRes');
    const ip = ($('#tIp') as HTMLInputElement).value.trim();
    const domain = ($('#tDom') as HTMLInputElement).value.trim();
    if (!ip && !domain) {
      res.className = 'ac2-res';
      res.textContent = 'Enter an address or a domain first.';
      return;
    }
    const seq = ++testSeq;
    try {
      const r = await apiPost<AccessTestResult>('/api/access/test', { ip: ip || undefined, domain: domain || undefined });
      if (seq !== testSeq) return;
      const a = r.action === 'block' ? 'block' : 'allow';
      res.className = 'ac2-res ' + a;
      res.innerHTML = `${a === 'block' ? ICO.x : ICO.check}<span><b>${a === 'block' ? 'Blocked' : 'Allowed'}</b><span style="display:block;color:var(--muted)">${esc(
        [ip, domain].filter(Boolean).join(' · '),
      )}</span>${r.would_lock_out_caller ? '<span style="display:block;color:var(--danger);font-weight:600">This address would be locked out.</span>' : ''}</span>`;
    } catch (err2) {
      if (seq !== testSeq) return;
      res.className = 'ac2-res';
      res.textContent = 'Could not test: ' + (err2 as Error).message;
    }
  };
}
