import { esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { state, allNotes } from '../state';
import { copyText } from '../control/ui';
import { STARTER_MODES, starterPrompt } from '../control/connect-model';
import { markSvg } from '../brand';
import { requestSettingsSection } from '../version';

export function vaultEmpty(): boolean {
  return !state.stats.notes && !allNotes().length;
}

const ICO = {
  plug: '<svg class="i" viewBox="0 0 24 24"><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/></svg>',
  chat: '<svg class="i" viewBox="0 0 24 24"><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/></svg>',
  spark: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8"/></svg>',
  copy: '<svg class="i" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  arrow: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  pen: '<svg class="i" viewBox="0 0 24 24"><path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
};

const CSS = `
.fs{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:16px;margin-bottom:20px}
.fs svg.i{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.fs-hero{position:relative;overflow:hidden;isolation:isolate;align-self:start;border-radius:14px;padding:28px;display:flex;flex-direction:column;gap:14px;min-height:380px;
  background:linear-gradient(165deg,#17202e,#0b0f17 70%);color:#e6e9ef}
.fs-hero::before{content:"";position:absolute;inset:-30%;z-index:-1;background:radial-gradient(closest-side at 72% 30%,rgba(94,234,212,.16),transparent 70%)}
.fs-mark{width:48px;height:48px}
.fs-hero h2{margin:auto 0 0;font-size:28px;font-weight:650;letter-spacing:-.02em;line-height:1.15}
.fs-hero p{margin:0;font-size:14.5px;line-height:1.6;color:#a3afc2;max-width:42ch}
.fs-live{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;height:30px;padding:0 12px;border-radius:99px;font-size:12.5px;
  background:rgba(148,163,184,.1);border:1px solid rgba(148,163,184,.18);color:#cbd5e1}
.fs-tour{all:unset;cursor:pointer;align-self:flex-start;font-size:12.5px;color:#8b98ad;text-decoration:underline;text-underline-offset:3px}
.fs-tour:hover{color:#e6e9ef}
.fs-tour:focus-visible{outline:2px solid #5eead4;outline-offset:2px;border-radius:4px}
.fs-live i{width:7px;height:7px;border-radius:50%;background:#5eead4;animation:fs-pulse 1.8s ease-in-out infinite}
@keyframes fs-pulse{50%{opacity:.3}}
.fs-steps{list-style:none;margin:0;padding:8px 24px;border-radius:14px;background:var(--surface-1);border:1px solid var(--line);counter-reset:fs}
.fs-step{display:grid;grid-template-columns:36px minmax(0,1fr);gap:4px 14px;padding:20px 0;border-top:1px solid var(--line)}
.fs-step:first-child{border-top:0}
.fs-n{grid-row:span 3;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;color:var(--text-2);background:color-mix(in srgb,var(--fg) 6%,transparent)}
.fs-step>:not(.fs-n){grid-column:2;min-width:0}
.fs-step h3{margin:0;font-size:15px;font-weight:600;color:var(--fg)}
.fs-step h3 small{margin-left:8px;font-size:12px;font-weight:500;color:var(--muted)}
.fs-step>p{margin:0;font-size:13.5px;line-height:1.55;color:var(--muted)}
.fs-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.fs-modes{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-top:12px;padding-bottom:2px}
.fs-modes::-webkit-scrollbar{display:none}
.fs-mode{flex:none;height:32px;padding:0 13px;border-radius:99px;font-size:13px;font-weight:500;color:var(--text-2);border:1px solid var(--line-strong);background:none;cursor:pointer}
.fs-mode:hover{color:var(--fg)}
.fs-mode[aria-pressed=true]{background:var(--fg);border-color:var(--fg);color:var(--surface-0)}
.fs-prompt{position:relative;margin-top:10px;border-radius:12px;background:color-mix(in srgb,var(--fg) 4%,transparent);border:1px solid var(--line)}
.fs-prompt b{display:block;padding:12px 14px 0;font-size:12.5px;font-weight:600;color:var(--fg)}
.fs-prompt q{display:block;padding:6px 14px 12px;font-size:13.5px;line-height:1.6;color:var(--text-2);quotes:none;white-space:pre-wrap}
.fs-prompt-f{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-top:1px solid var(--line)}
.fs-prompt-f span{flex:1;min-width:0;font-size:12.5px;line-height:1.45;color:var(--muted)}
@media (max-width:1100px){.fs{grid-template-columns:minmax(0,1fr)}.fs-hero{min-height:0}.fs-hero h2{margin-top:6px}}
@media (max-width:760px){.fs-hero{padding:22px}.fs-hero h2{font-size:23px}.fs-steps{padding:4px 16px}.fs-step{grid-template-columns:30px minmax(0,1fr)}
  .fs-n{width:30px;height:30px;border-radius:9px}.fs-prompt-f{flex-direction:column;align-items:stretch}.fs-prompt-f .btn{justify-content:center}}
@media (prefers-reduced-motion:reduce){.fs-live i{animation:none}}
`;

/** `agents` > 0 means an emptied or newly switched notes folder rather than a new install. */
export function firstSetupHTML(agents = 0): string {
  const known = agents > 0;
  const modes = STARTER_MODES.map(
    (m, i) => `<button type="button" class="fs-mode" data-mode="${m.id}" aria-pressed="${i === 0}">${esc(m.label)}</button>`,
  ).join('');
  return `<div class="fs">
    <div class="fs-hero">
      ${markSvg('fs-mark')}
      <h2 id="ovWelcomeT">${known ? 'This notes folder is empty' : "Let's fill your memory"}</h2>
      <p>${
        known
          ? `Your ${agents === 1 ? 'connected AI works' : `${agents} connected AIs work`} in this folder now. Ask one to save what it knows here, or write a note yourself. Switched folders by mistake? Switch back under Settings, Notes folder.`
          : 'Memora is still empty. Connect an AI app, send it one prompt, and it saves what it knows about you here, as notes you can read, edit and see in the brain.'
      }</p>
      <span class="fs-live"><i></i>Waiting for the first note</span>
      ${
        known
          ? '<button type="button" class="fs-tour" data-fs="folder">Open Settings, Notes folder</button>'
          : '<button type="button" class="fs-tour" data-fs="tour">What is Memora? Read the welcome</button>'
      }
    </div>
    <ol class="fs-steps">
      <li class="fs-step"><span class="fs-n">${ICO.plug}</span>
        ${
          known
            ? `<h3>Your AIs are already connected</h3>
        <p>${agents === 1 ? 'Its key and access' : `Their ${agents} keys and access`} stay the same in every notes folder. Connect another one any time.</p>
        <div class="fs-acts"><button type="button" class="btn" data-fs="agents">See your agents</button><button type="button" class="btn ghost" data-fs="connect">Connect another AI</button></div></li>`
            : `<h3>Connect your AI app</h3>
        <p>Claude, ChatGPT, Cursor, Codex and others each get their own access, so you can see what each one does.</p>
        <div class="fs-acts"><button type="button" class="btn primary" data-fs="connect">Connect an AI ${ICO.arrow}</button></div></li>`
        }
      <li class="fs-step"><span class="fs-n">${ICO.chat}</span>
        <h3>Send it a first prompt <small>pick what it should save</small></h3>
        <p>Once it is connected, paste this into a new chat in that app. It tells the AI to store what it knows into Memora.</p>
        <div class="fs-modes" role="group" aria-label="What should it save?">${modes}</div>
        <div class="fs-prompt"><b data-fs="title"></b><q data-fs="text"></q>
          <div class="fs-prompt-f"><span data-fs="hint"></span><button type="button" class="btn" data-fs="copy">${ICO.copy}Copy prompt</button></div></div></li>
      <li class="fs-step"><span class="fs-n">${ICO.spark}</span>
        <h3>Watch it fill up</h3>
        <p>Notes appear as the AI saves them and light up the brain. This page turns into your dashboard when the first note arrives.</p>
        <div class="fs-acts"><button type="button" class="btn" data-fs="brain">Open the brain</button>
          <button type="button" class="btn ghost" data-fs="note">${ICO.pen}Or write a note yourself</button></div></li>
    </ol>
  </div>`;
}

export function wireFirstSetup(box: HTMLElement, connect: () => void, tour: () => void): void {
  useStyles('first-setup-css', CSS);
  const q = <T extends HTMLElement>(sel: string): T => box.querySelector<T>(sel)!;
  let current = STARTER_MODES[0];
  const show = (): void => {
    const p = starterPrompt(current.id);
    q('[data-fs=title]').textContent = p.title;
    q('[data-fs=text]').textContent = p.text;
    q('[data-fs=hint]').textContent = current.hint;
    box.querySelectorAll<HTMLElement>('.fs-mode').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === current.id)));
  };
  box.querySelectorAll<HTMLElement>('.fs-mode').forEach((b) => {
    b.onclick = () => {
      current = STARTER_MODES.find((m) => m.id === b.dataset.mode) || current;
      show();
    };
  });
  q('[data-fs=copy]').onclick = () => void copyText(starterPrompt(current.id).text, 'Prompt copied');
  q('[data-fs=connect]').onclick = connect;
  q('[data-fs=brain]').onclick = () => hooks.go('brain');
  q('[data-fs=note]').onclick = () => hooks.openNewNote();
  box.querySelector<HTMLElement>('[data-fs=tour]')?.addEventListener('click', tour);
  box.querySelector<HTMLElement>('[data-fs=agents]')?.addEventListener('click', () => hooks.go('keys'));
  box.querySelector<HTMLElement>('[data-fs=folder]')?.addEventListener('click', () => {
    requestSettingsSection('stVault');
    hooks.go('settings');
  });
  show();
}
