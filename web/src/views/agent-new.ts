// The new-agent page, at /agents/new (and /agents/new/<client> with the app
// picked). The connect wizard runs in the page: the steps across the top
// (App, Name & access, Set up, Instructions), Back and Continue at the bottom
// and, on wide screens, a summary beside it. Each app or device gets its own
// agent, so the page says so, and gently notes an app that already has one.
// Finishing (or opening the agent once it connected) lands on its own page.

import { attr, esc, useStyles } from '../dom';
import { setAgentApp } from '../control/agent-apps';
import { appIconHTML, mountConnectWizard, type Wizard, type WizardInfo } from '../control/connect';
import { loadCatalog } from '../control/perms';
import { ICO, whileVisible } from '../control/ui';
import { avatarHTML } from '../control/agents';
import { useAgentPageStyles } from './agent-page';
import { appFor, createAgent, data, ICO_BACK, loadAgents, nameOf, navAgents, wireAgentLinks } from './agents-data';

const CSS = `
.an{container:an/inline-size;--ap-pt:24px;--ap-pb:64px;max-width:1180px}
.an-head{margin:0 0 16px}
.an-head h1{margin:0;font-size:22px;font-weight:740;letter-spacing:-.4px;line-height:1.2;outline:none}
.an-head p{margin:4px 0 0;font-size:13.5px;color:var(--muted);line-height:1.5;max-width:72ch}
.an-grid{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:18px;align-items:start}
.an-main{padding:0 24px;min-width:0}
.an-main .cn-prog{position:sticky;top:calc(-1 * var(--ap-pt));z-index:4;margin:0 -24px 20px;padding:calc(var(--ap-pt) + 16px) 24px 16px;
  background:var(--panel);border-bottom:1px solid var(--line);border-radius:var(--r-lg) var(--r-lg) 0 0}
.an-main .cn-step{padding-bottom:6px}
.an-foot{position:sticky;bottom:calc(-1 * var(--ap-pb));z-index:4;display:flex;align-items:center;gap:8px;margin:14px -24px 0;padding:12px 24px;
  background:var(--panel);border-top:1px solid var(--line);border-radius:0 0 var(--r-lg) var(--r-lg)}
.an-foot .grow{flex:1}
.an-foot .btn{height:40px;padding:0 18px;border-radius:11px}
.an-side{position:sticky;top:12px;display:flex;flex-direction:column;gap:12px;min-width:0}
.an-sum h2{margin:0;padding:13px 16px 11px;font-size:13.5px;font-weight:680;border-bottom:1px solid var(--line)}
.an-sum dl{margin:0;padding:6px 0}
.an-sum .it{display:flex;align-items:center;gap:11px;padding:9px 16px;min-width:0}
.an-sum .it .tx{flex:1;min-width:0}
.an-sum dt{font-size:11.5px;font-weight:620;color:var(--muted)}
.an-sum dd{margin:1px 0 0;font-size:13.5px;font-weight:620;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.an-sum dd.none{color:var(--text-3);font-weight:500}
.an-sum .ph{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;flex:none;color:var(--muted);background:var(--surface-2);
  border:1px solid var(--line)}
.an-sum .ph .cc-i{width:15px;height:15px}
.an-sum .ph.ok{color:var(--ok);background:var(--ok-soft);border-color:color-mix(in srgb,var(--ok) 35%,transparent)}
.an-open{padding:0 16px 14px}
.an-open .btn{width:100%;height:38px;border-radius:10px}
.an-open:has(.btn[hidden]){display:none}
.an-tip{display:flex;gap:10px;padding:13px 14px;border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface-2);
  font-size:12.5px;line-height:1.55;color:var(--text-2)}
.an-tip .cc-i{color:var(--accent);margin-top:2px}
.an-tip b{display:block;color:var(--fg);font-size:13px;margin-bottom:2px}
.an-strip{display:none}
@container an (max-width:979px){
  .an-grid{grid-template-columns:minmax(0,1fr)}
  .an-side{display:none}
  .an-strip{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;margin:-6px 0 14px;font-size:12.5px;color:var(--muted)}
  .an-strip:empty{display:none}
  .an-strip span{display:inline-flex;align-items:center;gap:7px;min-width:0}
  .an-strip b{color:var(--fg);font-weight:620;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
}
@container an (max-width:599px){
  .an-head{margin-bottom:12px}
  .an-head h1{font-size:21px}
  .an-head p{font-size:13px}
  .an-strip{display:none}
  .an-main{padding:0 14px}
  .an-main .cn-prog{margin:0 -14px 16px;padding:calc(var(--ap-pt) + 12px) 14px 12px}
  /* The tab bar's raised Brain button sits in the middle: keep the buttons beside it. */
  .an-foot{margin:12px -14px 0;padding:10px 14px;column-gap:84px}
  .an-foot .btn{flex:1 1 0;height:46px}
  .an-foot .grow{display:none}
}
@media (max-width:760px){.an{--ap-pt:16px;--ap-pb:32px}}
`;

const ICO_USER = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const ICO_INFO = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';

let wizard: Wizard | null = null;

export async function renderNewAgent(host: HTMLElement, client: string): Promise<void> {
  useAgentPageStyles();
  useStyles('agent-new-css', CSS);
  wizard?.destroy();
  wizard = null;
  host.innerHTML = `<div class="cc an">
    <nav class="ap-crumb" aria-label="Breadcrumb"><a class="ap-back" href="/agents" data-nav="">${ICO_BACK}Agents</a></nav>
    <header class="an-head"><h1 tabindex="-1">New agent</h1>
      <p>One agent per app or device: its own key, its own name in Activity, turned off on its own.</p></header>
    <div class="an-strip" id="anStrip" aria-hidden="true"></div>
    <div class="an-grid">
      <section class="ap-card an-main" aria-labelledby="anH"><span id="anH" class="sr-only">New agent steps</span><div id="anWz"></div>
        <div class="an-foot"><button type="button" class="btn ghost" id="anBack">Back</button><span class="grow"></span>
          <button type="button" class="btn primary" id="anNext">Continue</button></div></section>
      <aside class="an-side" aria-label="Summary"><div class="ap-card an-sum"><h2>Summary</h2><dl id="anSum"></dl>
          <div class="an-open"><button type="button" class="btn primary" id="anOpen" hidden>Open the agent ${ICO.arrow}</button></div></div>
        <div class="an-tip">${ICO_INFO}<span><b>Why one agent per app?</b>Activity shows which app did what, and turning one off or making it a new key never touches the others.</span></div></aside>
    </div></div>`;
  wireAgentLinks(host);
  host.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  const page = host.firstElementChild as HTMLElement;
  // The suggested name must be unique and the same-app notice needs the agents.
  await Promise.all([loadCatalog(), data.loaded ? null : loadAgents()]);
  if (!page.isConnected) return;
  const back = page.querySelector<HTMLButtonElement>('#anBack')!;
  const next = page.querySelector<HTMLButtonElement>('#anNext')!;
  const box = page.querySelector<HTMLElement>('#anWz')!;
  const wz = mountConnectWizard(box, {
    client: client || undefined,
    names: data.keys.map(nameOf),
    existing: data.keys.map((k) => ({ name: nameOf(k), app: appFor(k).id })),
    createAgent,
    onAppChosen: (id, c) => void setAgentApp(id, c),
    onChange: () => void loadAgents(true),
    setNav: (n) => {
      back.style.visibility = n.back ? '' : 'hidden';
      next.textContent = n.next;
      next.title = n.next === 'Done' ? 'Open the new agent' : '';
    },
    onInfo: (i) => paintSummary(page, i),
    onOpenAgent: (id) => navAgents(id),
  });
  wizard = wz;
  back.onclick = () => wz.back();
  next.onclick = async () => {
    next.disabled = true;
    try {
      if (!(await wz.next())) return;
      const i = wz.info();
      const id = i.agent?.id || i.connectedId;
      navAgents(id || '');
    } finally {
      next.disabled = false;
    }
  };
  // The name typed and the access picked show up in the summary as they change.
  box.addEventListener('input', () => paintSummary(page, wz.info()));
  box.addEventListener('click', () => setTimeout(() => wizard === wz && paintSummary(page, wz.info()), 0));
  whileVisible(host, () => () => {
    wz.destroy();
    if (wizard === wz) wizard = null;
  });
}

function paintSummary(page: HTMLElement, i: WizardInfo): void {
  const sum = page.querySelector<HTMLElement>('#anSum');
  const strip = page.querySelector<HTMLElement>('#anStrip');
  if (!sum || !strip) return;
  const c = i.client;
  const named = i.step !== 'app' && !!c;
  const item = (lead: string, k: string, v: string, none: boolean): string =>
    `<div class="it">${lead}<span class="tx"><dt>${k}</dt><dd class="${none ? 'none' : ''}">${v}</dd></span></div>`;
  sum.innerHTML =
    item(c ? appIconHTML(c.label, 30) : appIconHTML('', 30), 'App', c ? esc(c.label) : 'Not chosen yet', !c) +
    item(
      i.agent ? avatarHTML(i.agent.name, 30, '', i.agent.id) : `<span class="ph">${ICO_USER}</span>`,
      'Name',
      named && i.name ? esc(i.name) : 'Next step',
      !(named && i.name),
    ) +
    item(`<span class="ph">${ICO.shield}</span>`, 'Access', named && i.access ? esc(i.access) : 'Next step', !(named && i.access)) +
    item(
      `<span class="ph">${ICO.key}</span>`,
      'Key',
      i.agent ? `Made · <span class="cc-mono">${esc(i.agent.id)}</span>` : c?.oauth ? 'None: it signs in' : 'Made when you continue',
      !i.agent,
    ) +
    (i.step === 'setup' || i.step === 'prompt'
      ? item(
          `<span class="ph${i.connected ? ' ok' : ''}">${i.connected ? ICO.check : ICO.plug}</span>`,
          'Connection',
          i.connected ? 'Connected' : 'Waiting for the first call',
          !i.connected,
        )
      : '');
  const open = page.querySelector<HTMLElement>('#anOpen');
  const id = i.agent?.id || i.connectedId;
  if (open) {
    open.hidden = !(i.connected && id);
    open.onclick = () => id && navAgents(id);
  }
  strip.innerHTML = c
    ? `<span>${appIconHTML(c.label, 22)}<b>${esc(c.label)}</b></span>${named && i.name ? `<span>·<b title="${attr(i.name)}">${esc(i.name)}</b></span>` : ''}${
        named && i.access ? `<span>·<b>${esc(i.access)}</b></span>` : ''
      }`
    : '';
}
