// Access rules: the ordered IP / range / CIDR / domain stack the gateway checks first, plus a tester.
// The server only adds (to the end) and removes, so editing a rule is a remove followed by an add.

import { apiGet, apiPost } from '../api';
import { $, $$, attr, esc, useStyles } from '../dom';
import { Modal } from '../modal';
import { toast } from '../toast';
import { ICO, openMenu, openSheet, systemHeader, useControlStyles, type Sheet } from '../control/ui';
import { SYS_PAGE_CSS } from './tools';
import { ICO_EDIT, ICO_INFO, ICO_TRASH } from './agents-data';
import { skBlock } from '../ui/skeleton';
import type { AccessRule, AccessStack, AccessTestResult, OkResult } from '../types';

interface Rule extends AccessRule {
  id?: string;
  enabled?: boolean;
  note?: string;
}

type Kind = 'ip' | 'range' | 'cidr' | 'domain' | 'all';
type Action = 'allow' | 'block';

/** `short` is the line on the choice card; `hint` the fuller help under the field. */
const KINDS: { v: Kind; l: string; short: string; field: string; ph: string; hint: string }[] = [
  {
    v: 'ip',
    l: 'One address',
    short: 'One device or connection.',
    field: 'Internet address (IP)',
    ph: '203.0.113.7',
    hint: 'One device or connection, such as 203.0.113.7. Searching "what is my IP" shows yours.',
  },
  {
    v: 'cidr',
    l: 'A whole network',
    short: 'Every device on a home or office network.',
    field: 'Network (address/size)',
    ph: '192.168.1.0/24',
    hint: 'Every device on a home or office network, written as address/size: 192.168.1.0/24 covers 192.168.1.0 to 192.168.1.255.',
  },
  {
    v: 'range',
    l: 'A run of addresses',
    short: 'Every address from one to another.',
    field: 'First and last address',
    ph: '203.0.113.10-203.0.113.50',
    hint: 'Every address from the first to the last, joined by a dash.',
  },
  {
    v: 'domain',
    l: 'A web address',
    short: 'The name typed in the browser to open Memora.',
    field: 'Web address (domain)',
    ph: 'memory.example.com',
    hint: 'The name typed in the browser to open Memora, such as memory.example.com. *.example.com covers every name ending in example.com.',
  },
  { v: 'all', l: 'Everyone', short: 'Every request. Put it last, to catch whatever the rules above did not.', field: '', ph: '', hint: 'Every request. Put it last, to catch whatever the rules above did not.' },
];

const CSS = `
.ac3{max-width:1240px;container:ac/inline-size}
.ac3-flow{margin:0 0 20px;border:1px solid var(--line);border-radius:14px;background:var(--surface-1)}
.ac3-steps{list-style:none;margin:0;padding:22px 24px 20px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;position:relative}
.ac3-steps li{position:relative;display:flex;flex-direction:column;gap:12px;min-width:0}
.ac3-steps li:not(:last-child)::after{content:"";position:absolute;top:17px;left:48px;right:-12px;height:1px;
  background:linear-gradient(90deg,var(--line-strong),transparent)}
.ac3-tile{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;flex:none;
  background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}
.ac3-tile .cc-i,.ac3-tile .i{width:18px;height:18px;stroke-width:1.7}
.ac3-steps .k{font-size:12px;font-weight:500;color:var(--text-3);font-variant-numeric:tabular-nums}
.ac3-steps .tt{display:block;font-size:14px;font-weight:600;color:var(--fg);margin-top:2px}
.ac3-steps .ds{display:block;font-size:13px;color:var(--muted);line-height:1.5;margin-top:3px;max-width:34ch}
.ac3-steps .ds b{color:var(--fg);font-weight:600}
.ac3-flow-f{display:flex;align-items:center;gap:10px;padding:12px 24px;border-top:1px solid var(--line);font-size:13px;color:var(--muted);
  background:color-mix(in srgb,var(--fg) 2%,transparent);border-radius:0 0 14px 14px}
.ac3-flow-f .cc-i{width:16px;height:16px;color:var(--text-3)}

.ac3-grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:20px;align-items:start}
.ac3-card{border:1px solid var(--line);border-radius:14px;background:var(--surface-1);min-width:0}
.ac3-h{display:flex;align-items:center;gap:12px;padding:18px 20px 14px}
.ac3-h h2{margin:0;font-size:15px;font-weight:600;letter-spacing:-.005em}
.ac3-h .sub{font-size:12.5px;color:var(--muted)}
.ac3-h .grow{flex:1}
.ac3-cols,.ac3-rule{display:grid;grid-template-columns:32px 92px minmax(0,1fr) 170px 40px;gap:0 16px;align-items:center}
.ac3-cols{padding:8px 20px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:12px;font-weight:500;color:var(--muted);
  background:color-mix(in srgb,var(--fg) 2%,transparent)}
.ac3-rule{padding:10px 12px 10px 20px;min-height:58px;border-top:1px solid var(--line);transition:background .15s}
.ac3-rule:first-child{border-top:0}
.ac3-rule:hover{background:color-mix(in srgb,var(--fg) 2.5%,transparent)}
.ac3-rule.paused{opacity:.6}
.ac3-num{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;font-size:12.5px;font-weight:550;color:var(--text-2);
  background:color-mix(in srgb,var(--fg) 5%,transparent);font-variant-numeric:tabular-nums}
.ac3-num .cc-i{width:16px;height:16px;color:var(--muted)}
.ac3-act{display:inline-flex;align-items:center;gap:8px;font-size:13.5px;font-weight:500;color:var(--fg);white-space:nowrap}
.ac3-act::before{content:"";width:6px;height:6px;border-radius:50%;flex:none}
.ac3-act.allow::before{background:var(--ok)}
.ac3-act.block::before{background:var(--danger)}
.ac3-what{min-width:0}
.ac3-val{display:block;min-width:0;font-family:var(--mono);font-size:13.5px;font-weight:500;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ac3-val.plain{font-family:inherit}
.ac3-kind{min-width:0;font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ac3-sm{display:none}
.ac3-rule .cc-ibtn{width:36px;height:36px;border-radius:9px;opacity:.55;transition:opacity .15s,background .15s}
.ac3-rule:hover .cc-ibtn,.ac3-rule .cc-ibtn:focus-visible,.ac3-rule .cc-ibtn[aria-expanded=true]{opacity:1}
@media (hover:none){.ac3-rule .cc-ibtn{opacity:1}}
.ac3-def{border-top:1px solid var(--line);background:color-mix(in srgb,var(--fg) 2.5%,transparent);border-radius:0 0 14px 14px}
.ac3-def .ac3-kind{grid-column:4/6;white-space:normal;line-height:1.45}
.cc-sh-h:has(.ac3-shlead) p{white-space:normal}
.ac3-empty{padding:40px 20px 36px;text-align:center;border-top:1px solid var(--line)}
.ac3-empty .ic{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;margin-bottom:14px;
  background:linear-gradient(180deg,#17202e,#0b0f17);color:#5eead4}
.ac3-empty .ic .cc-i{width:20px;height:20px}
.ac3-empty b{display:block;font-size:15px;font-weight:600;margin-bottom:4px}
.ac3-empty p{margin:0 auto 16px;max-width:46ch;font-size:13.5px;color:var(--muted);line-height:1.55}
.ac3-test{padding:2px 20px 20px;display:flex;flex-direction:column;gap:14px}
.ac3-test>p{margin:0;font-size:13px;color:var(--muted);line-height:1.5}
.ac3-f{display:flex;flex-direction:column;gap:6px;min-width:0}
.ac3-f>span{font-size:12.5px;font-weight:500;color:var(--text-2)}
.ac3-f>span em{font-style:normal;color:var(--text-3);font-weight:400}
.ac3-in{height:40px;padding:0 12px;border-radius:10px;border:1px solid transparent;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--fg);
  font-size:14px;font-family:var(--mono);width:100%;min-width:0;outline:none;transition:border-color .16s,background .16s}
.ac3-in::placeholder{color:var(--text-3)}
.ac3-in:hover{border-color:var(--line)}
.ac3-in:focus{border-color:var(--line-strong);background:var(--surface-1)}
.ac3-in[aria-invalid=true]{border-color:color-mix(in srgb,var(--danger) 60%,transparent)}
.ac3-hint{font-size:12.5px;color:var(--muted);line-height:1.45}
.ac3-hint.err{color:var(--danger)}
.ac3-res{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1px dashed var(--line-strong);color:var(--muted);
  font-size:13px;min-height:60px;line-height:1.45}
.ac3-res.allow,.ac3-res.block{border-style:solid;border-color:var(--line);background:color-mix(in srgb,var(--fg) 3%,transparent);color:var(--fg)}
.ac3-res b{display:inline-flex;align-items:center;gap:8px;font-size:14.5px;font-weight:600}
.ac3-res b::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ok)}
.ac3-res.block b::before{background:var(--danger)}
.ac3-res .who{display:block;color:var(--muted);font-family:var(--mono);font-size:12.5px;margin-top:2px;word-break:break-all}
.ac3-res .lock{display:block;color:var(--danger);font-weight:600;margin-top:2px}
.ac3-test .btn{height:40px;border-radius:10px}
.ac3-opts{display:flex;flex-direction:column;border:1px solid var(--line-strong);border-radius:12px;overflow:hidden}
.ac3-opt{position:relative;display:flex;gap:12px;align-items:center;padding:10px 14px 10px 10px;cursor:pointer;min-height:56px;min-width:0;
  transition:background .15s}
.ac3-opt+.ac3-opt{border-top:1px solid var(--line)}
.ac3-opt:hover{background:var(--hover)}
.ac3-opt input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.ac3-opt .tx{flex:1;min-width:0}
.ac3-opt b{display:block;font-size:14px;font-weight:550;color:var(--fg)}
.ac3-opt small{display:block;font-size:12.5px;color:var(--muted);margin-top:1px;line-height:1.4}
.ac3-opt .rd{flex:none;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--line-strong);display:grid;place-items:center;transition:border-color .15s,background .15s}
.ac3-opt:has(input:checked){background:color-mix(in srgb,var(--fg) 4%,transparent)}
.ac3-opt:has(input:checked) .rd{border-color:transparent;background:linear-gradient(180deg,#5eead4,#22d3ee)}
:root[data-theme=light] .ac3-opt:has(input:checked) .rd{background:linear-gradient(180deg,#14b8a6,#0891b2)}
.ac3-opt:has(input:checked) .rd::after{content:"";width:6px;height:6px;border-radius:50%;background:#fff}
.ac3-opt:has(input:checked) .ac3-tile{color:var(--fg)}
.ac3-opt:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:-2px}
.ac3-acts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.ac3-acts .ac3-opt{flex-direction:column;align-items:flex-start;gap:6px;border:1px solid var(--line-strong);border-radius:12px;padding:14px;min-height:0}
.ac3-acts .ac3-opt+.ac3-opt{border-top:1px solid var(--line-strong)}
.ac3-acts .ac3-opt .rd{position:absolute;top:14px;right:14px}
.ac3-acts .ac3-opt:has(input:checked){border-color:var(--fg)}
.ac3-acts .ac3-act{font-size:14px;font-weight:600}
.ac3-prev{display:flex;gap:10px;align-items:flex-start;padding:14px;border-radius:12px;background:color-mix(in srgb,var(--fg) 4%,transparent);font-size:14px;line-height:1.55;color:var(--text-2)}
.ac3-prev b{color:var(--fg)}
.ac3-prev code{font-family:var(--mono);font-size:12.5px;color:var(--fg)}
.ac3-prev .cc-i{width:18px;height:18px;margin-top:2px;color:var(--muted)}
.ac3-warn{display:flex;gap:10px;padding:12px 14px;border-radius:12px;font-size:13px;line-height:1.5;margin-top:10px;color:var(--fg);
  background:var(--warn-soft)}
.ac3-warn::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--warn);flex:none;margin-top:7px}
.ac3-warn[hidden]{display:none}
.ac3-shlead{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;flex:none;background:linear-gradient(180deg,#17202e,#0b0f17);color:#5eead4}
.ac3-shlead .cc-i{width:18px;height:18px}
.ac3-sk{padding:8px 20px 16px;display:flex;flex-direction:column}
.ac3-sk .r{display:flex;align-items:center;gap:16px;height:58px;border-top:1px solid var(--line)}
.ac3-sk .r:first-child{border-top:0}
@container ac (max-width:1020px){
  .ac3-grid{grid-template-columns:minmax(0,1fr)}
}
@container ac (max-width:700px){
  .ac3-steps{grid-template-columns:1fr;gap:16px;padding:18px 18px 16px}
  .ac3-steps li{flex-direction:row;align-items:flex-start}
  .ac3-steps li:not(:last-child)::after{top:42px;bottom:-12px;left:18px;right:auto;width:1px;height:auto;background:linear-gradient(180deg,var(--line-strong),transparent)}
  .ac3-steps .k{display:none}
  .ac3-steps .tt{margin-top:0}
  .ac3-flow-f{padding:12px 18px;align-items:flex-start}
  .ac3-flow-f .cc-i{margin-top:2px}
}
@container ac (max-width:600px){
  .ac3-cols{display:none}
  .ac3-rule{grid-template-columns:32px minmax(0,1fr) 44px;gap:0 12px;padding:10px 6px 10px 14px;min-height:64px}
  .ac3-rule>.ac3-act,.ac3-rule>.ac3-kind{display:none}
  .ac3-sm{display:flex;align-items:center;gap:8px;margin-top:3px;font-size:12.5px;color:var(--muted);min-width:0}
  .ac3-sm .ac3-act{font-size:12.5px}
  .ac3-sm span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
}
@media (max-width:760px){
  .ac3-grid{gap:16px}
  .ac3-flow{margin-bottom:16px}
  .ac3-h{padding:16px 16px 12px}
  .ac3-rule .cc-ibtn{width:44px;height:44px;opacity:1}
  .ac3-test{padding:2px 16px 16px}
  .ac3-test .btn{height:44px}
  .ac3-in{height:44px}
  .ac3-acts{grid-template-columns:1fr}
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
  return { ip: 'One address', cidr: 'Whole network', range: 'Run of addresses', domain: 'Web address', all: 'Everyone' }[k];
}

/** "Block 203.0.113.7" style sentence for a rule; before a value is typed, what it will do once filled in. */
function sentence(k: Kind, v: string, a: Action): string {
  const verb = a === 'block' ? 'blocked' : 'allowed';
  if (k === 'all') return `Every request that reaches this rule is <b>${verb}</b>.`;
  if (!v) {
    const what = k === 'domain' ? 'web address' : k === 'ip' ? 'address' : k === 'cidr' ? 'network' : 'range';
    return `Fill in the ${what} above. Requests ${k === 'domain' ? 'sent to' : 'from'} it will then be <b>${verb}</b>.`;
  }
  const who =
    k === 'domain'
      ? `Requests sent to <code>${esc(v)}</code>`
      : k === 'ip'
        ? `Requests from <code>${esc(v)}</code>`
        : `Requests from any address in <code>${esc(v)}</code>`;
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
const ICO_USERS =
  '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/></svg>';
const ICO_LIST = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>';
const ICO_ENTER = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M4 12h11M11 8l4 4-4 4"/></svg>';
/** Leading icon per kind of rule, in the rule sheet. */
const KIND_ICO: Record<Kind, string> = {
  ip: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M9 20h6M12 16v4"/></svg>',
  cidr: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9.5" y="3.5" width="5" height="5" rx="1.2"/><rect x="3.5" y="15.5" width="5" height="5" rx="1.2"/><rect x="15.5" y="15.5" width="5" height="5" rx="1.2"/><path d="M12 8.5V12M6 15.5V12h12v3.5"/></svg>',
  range: '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M4 8v8M20 8v8M8 10v4M12 10v4M16 10v4"/></svg>',
  domain: ICO_GLOBE,
  all: ICO_USERS,
};

let rules: Rule[] = [];
let defaultAllow = true;
/** Bumped on every render so a slower, older load cannot paint over a newer one. */
let renderSeq = 0;
/** Bumped on every test so only the latest answer is shown. */
let testSeq = 0;

export async function renderAccess(): Promise<void> {
  useControlStyles();
  useStyles('cc-access-css-3', SYS_PAGE_CSS + CSS);
  const host = $('#view-access');
  const seq = ++renderSeq;
  host.innerHTML = `<div class="cc ac3">${systemHeader(
    'access',
    'Access rules',
    'Let in or keep out addresses and networks before anyone sees the sign-in page.',
    `<button type="button" class="cc-ibtn" id="aReload" aria-label="Reload" title="Reload">${ICO.refresh}</button>
     <button type="button" class="btn primary" id="aAdd">${ICO.plus}Add rule</button>`,
  )}
    <section class="ac3-flow" aria-labelledby="acHowT"><h2 class="sr-only" id="acHowT">How it works</h2>
      <ol class="ac3-steps">
        <li><span class="ac3-tile">${ICO_ENTER}</span><span><span class="k">Step 1</span><span class="tt">Someone opens Memora</span><span class="ds">A browser or an AI app. These rules are checked before the sign-in page.</span></span></li>
        <li><span class="ac3-tile">${ICO_LIST}</span><span><span class="k">Step 2</span><span class="tt">Rules are checked from the top</span><span class="ds">The first rule that fits decides. The rest are skipped.</span></span></li>
        <li><span class="ac3-tile">${ICO_GLOBE}</span><span><span class="k">Step 3</span><span class="tt">No rule fits</span><span class="ds" id="aDefTxt">"Everything else" decides.</span></span></li>
      </ol>
      <div class="ac3-flow-f">${ICO_INFO}<span>The server's own computer (localhost) always gets in, so a rule can never lock it out.</span></div>
    </section>
    <div class="ac3-grid">
      <section class="ac3-card" aria-labelledby="acStackT"><div class="ac3-h"><h2 id="acStackT">Rules</h2>
        <span class="sub" id="aCount"></span><span class="grow"></span></div>
        <div id="aList"><div class="ac3-sk" aria-busy="true">${[0, 1, 2]
          .map(() => `<div class="r">${skBlock('30px', 30)}${skBlock('64px', 12)}${skBlock('36%', 14)}</div>`)
          .join('')}</div></div></section>
      <section class="ac3-card" aria-labelledby="acTestT"><div class="ac3-h"><h2 id="acTestT">Test an address</h2></div>
        <form class="ac3-test" id="tForm" novalidate>
          <p>See what an address would get. Nothing changes.</p>
          <label class="ac3-f"><span>Internet address (IP)</span><input class="ac3-in" id="tIp" type="text" inputmode="decimal" placeholder="203.0.113.7" spellcheck="false" autocomplete="off"></label>
          <label class="ac3-f"><span>Web address <em>(optional)</em></span><input class="ac3-in" id="tDom" type="text" placeholder="memory.example.com" spellcheck="false" autocomplete="off" autocapitalize="off"></label>
          <div class="ac3-res" id="tRes" role="status">Enter an address or a web address, then test.</div>
          <button class="btn" id="aTest" type="submit">${ICO.search}Test</button>
        </form></section>
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
    $('#aList').innerHTML = `<div class="ac3-empty"><span class="ic">${ICO.refresh}</span><b>Could not load the rules</b><p>${esc((e as Error).message)}</p>
      <button type="button" class="btn" id="aRetry">${ICO.refresh}Try again</button></div>`;
    $('#aRetry').onclick = () => void renderAccess();
    return;
  }
  paintRules();
}

function paintRules(): void {
  $('#aCount').textContent = rules.length ? `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}, checked from the top` : '';
  $('#aDefTxt').innerHTML = `"Everything else" decides: right now it is <b>${defaultAllow ? 'let in' : 'kept out'}</b>.`;
  const defAct = `<span class="ac3-act ${defaultAllow ? 'allow' : 'block'}">${defaultAllow ? 'Allow' : 'Block'}</span>`;
  const def = `<div class="ac3-rule ac3-def"><span class="ac3-num" aria-hidden="true">${ICO_GLOBE}</span>${defAct}
    <span class="ac3-what"><span class="ac3-val plain">Everything else</span><span class="ac3-sm">${defAct}<span>When no rule fits</span></span></span>
    <span class="ac3-kind">When no rule fits. Change it on the server with memora-cli.</span><span></span></div>`;
  if (!rules.length) {
    $('#aList').innerHTML = `<div class="ac3-empty"><span class="ic">${ICO.shield}</span><b>No rules yet</b>
      <p>Anyone who reaches the server sees the sign-in page and still needs a password or a key. Add a rule to keep an address out or let only your network in.</p>
      <button type="button" class="btn" id="aAddFirst">${ICO.plus}Add the first rule</button></div>${def}`;
    $('#aAddFirst').onclick = () => openRule();
    return;
  }
  $('#aList').innerHTML =
    `<div class="ac3-cols" aria-hidden="true"><span>#</span><span>Action</span><span>Matches</span><span>Type</span><span></span></div><div class="ac3-rows">` +
    rules
      .map((r, i) => {
        const a = ruleAction(r);
        const k = ruleKind(r);
        const v = ruleValue(r);
        const paused = r.enabled === false;
        const act = `<span class="ac3-act ${a}">${a === 'block' ? 'Block' : 'Allow'}</span>`;
        const kind = `${esc(kindLabel(k))}${paused ? ' · paused, skipped' : ''}${r.note ? ' · ' + esc(r.note) : ''}`;
        return `<div class="ac3-rule${paused ? ' paused' : ''}"><span class="ac3-num" title="Checked ${i === 0 ? 'first' : 'as number ' + (i + 1)}">${i + 1}</span>
          ${act}<span class="ac3-what"><span class="ac3-val${k === 'all' ? ' plain' : ''}">${esc(k === 'all' ? 'Everyone' : v)}</span><span class="ac3-sm">${act}<span>${kind}</span></span></span>
          <span class="ac3-kind">${kind}</span>
          <button type="button" class="cc-ibtn" data-i="${i}" aria-haspopup="menu" aria-label="Actions for rule ${i + 1}" title="More">${ICO.more}</button></div>`;
      })
      .join('') +
    `</div>` +
    def;
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
      <div class="ac3-opts" role="radiogroup" aria-labelledby="arKindT">${KINDS.map(
        (k) => `<label class="ac3-opt"><input type="radio" name="ar-kind" value="${k.v}"${k.v === kind ? ' checked' : ''}>
          <span class="ac3-tile">${KIND_ICO[k.v]}</span><span class="tx"><b>${esc(k.l)}</b><small>${esc(k.short)}</small></span><span class="rd" aria-hidden="true"></span></label>`,
      ).join('')}</div>
      <label class="ac3-f" id="arValF" style="margin-top:16px"><span id="arValL"></span>
        <input class="ac3-in" id="arVal" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" value="${attr(r ? ruleValue(r) : '')}" aria-describedby="arHint"></label>
      <div class="ac3-hint" id="arHint" style="margin-top:6px"></div></section>
    <section class="cc-sh-sec"><h3 id="arActT">What happens?</h3><p>Only the first rule that fits a request counts.</p>
      <div class="ac3-acts" role="radiogroup" aria-labelledby="arActT">
        <label class="ac3-opt"><input type="radio" name="ar-act" value="allow"${action === 'allow' ? ' checked' : ''}>
          <span class="ac3-act allow">Allow</span><small>Let it in. People still sign in and AIs still need their key.</small><span class="rd" aria-hidden="true"></span></label>
        <label class="ac3-opt"><input type="radio" name="ar-act" value="block"${action === 'block' ? ' checked' : ''}>
          <span class="ac3-act block">Block</span><small>Keep it out. It cannot even see the sign-in page.</small><span class="rd" aria-hidden="true"></span></label></div></section>
    <section class="cc-sh-sec"><h3>In short</h3><div class="ac3-prev">${ICO_INFO}<span id="arPrev" aria-live="polite"></span></div>
      <div class="ac3-warn" id="arWarn" hidden></div>
      ${r && !last ? `<div class="ac3-warn">Saving moves this rule from position ${idx + 1} to the end of the list, so it is checked last.</div>` : ''}</section>`;

  openSheet({
    title: r ? `Edit rule ${idx + 1}` : 'Add a rule',
    lead: `<span class="ac3-shlead" aria-hidden="true">${ICO.shield}</span>`,
    sub: r ? undefined : rules.length ? `It is added at the end, as rule ${rules.length + 1}, so it is checked last.` : 'It becomes your first rule.',
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
        warn.innerHTML = 'This keeps out everyone that no rule above it lets in, including you, unless a rule allowing your own address comes first.';
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
      res.className = 'ac3-res';
      res.textContent = 'Enter an address or a web address first.';
      return;
    }
    const seq = ++testSeq;
    try {
      const r = await apiPost<AccessTestResult>('/api/access/test', { ip: ip || undefined, domain: domain || undefined });
      if (seq !== testSeq) return;
      const a = r.action === 'block' ? 'block' : 'allow';
      res.className = 'ac3-res ' + a;
      res.innerHTML = `<span><b>${a === 'block' ? 'Blocked' : 'Allowed'}</b><span class="who">${esc(
        [ip, domain].filter(Boolean).join(' · '),
      )}</span>${r.would_lock_out_caller ? '<span class="lock">This address would be locked out.</span>' : ''}</span>`;
    } catch (err2) {
      if (seq !== testSeq) return;
      res.className = 'ac3-res';
      res.textContent = 'Could not test: ' + (err2 as Error).message;
    }
  };
}
