import { api } from '../api';
import { esc, useStyles } from '../dom';
import { state } from '../state';
import { Modal } from '../modal';
import { openDocs } from '../router';
import { markSvg } from '../brand';
import { BRAND_FONT, BRAND_FONT_CSS } from '../brand-font';
import { icon } from './icons';

type Kind = 'new' | 'better' | 'admin';

interface Item {
  icon: string;
  title: string;
  text: string;
}

interface Release {
  version: string;
  date?: string;
  title: string;
  lead: string;
  groups: { kind: Kind; items: Item[] }[];
}

/** Newest first. */
const RELEASES: Release[] = [
  {
    version: '2.0.0',
    title: 'A calmer, clearer Memora',
    lead: 'Every page was redesigned around one quiet look, and the places you use most got new tools: version history, tag patterns, a summary of what your AIs do, and a cleaner way to read.',
    groups: [
      {
        kind: 'new',
        items: [
          { icon: 'refresh', title: 'Version history for every note', text: 'See each version and who made it, compare it with now, and restore it. Restoring adds a new version, so nothing is lost.' },
          { icon: 'tags', title: 'Find notes by a pattern of tags', text: 'Build “session or (memora and plan) not docker” from chips on the Tags page, and see how many notes match before you apply it.' },
          { icon: 'activity', title: 'Activity, summarised', text: 'Numbers, a chart, what your AIs do most and what went wrong, with every action on its own Timeline tab.' },
          { icon: 'note', title: 'A cleaner way to read', text: 'Fold the toolbar away with F. Contents sits beside the note, with its details as a tab.' },
          { icon: 'brain', title: 'Clean view on the maps', text: 'Hide every control on 3D, Graph and Canvas with C, and bring them back the same way.' },
        ],
      },
      {
        kind: 'better',
        items: [
          { icon: 'trash', title: 'A safer Trash', text: 'Choose where a note goes back. Deleting forever asks you to type DELETE, and also erases the note from its history.' },
          { icon: 'bolt', title: 'Faster', text: 'Data travels compressed, Activity remembers each time range, and the start screen leaves the moment the app is ready.' },
          { icon: 'settings', title: 'Settings you can change', text: 'The server name and how long browsers stay signed in. Switching the notes folder now says what moves with it.' },
          { icon: 'agents', title: 'Your AIs at a glance', text: 'The Live panel leads with what your AIs did last, then who is working.' },
        ],
      },
      {
        kind: 'admin',
        items: [
          { icon: 'shield', title: 'For whoever runs the server', text: 'Deleting a note for good over the API now needs an admin key. The database needs no migration: a 1.3 install updates in place.' },
          { icon: 'book', title: 'A new licence', text: 'From 2.0.0 Memora is under the GNU AGPL v3.0 or later. Forks and hosted copies keep the source open and credit Memora.' },
        ],
      },
    ],
  },
];

const KIND_LABEL: Record<Kind, string> = { new: 'New', better: 'Better', admin: 'Good to know' };
const FLAG = '/api/ui/layout/whats-new';

const CSS = `
.modal:has(.wn){width:min(620px,100%);padding:0;overflow:hidden}
.modal:has(.wn) .modal-head{display:none}
.modal:has(.wn) .modal-body{padding:0;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.wn{display:flex;flex-direction:column;min-height:0;max-height:min(86vh,86dvh)}
.wn-hero{position:relative;overflow:hidden;isolation:isolate;flex:none;padding:22px 24px 24px;color:#e6e9ef;background:linear-gradient(160deg,#17202e,#0b0f17 70%)}
.wn-hero::before{content:"";position:absolute;inset:-60% -20% auto auto;width:420px;height:420px;z-index:-1;background:radial-gradient(closest-side,rgba(94,234,212,.20),transparent 70%)}
.wn-top{display:flex;align-items:center;gap:10px;margin-bottom:22px}
.wn-mark{width:30px;height:30px;flex:none}
.wn-word{font-family:${BRAND_FONT};font-weight:700;font-size:23px;line-height:1;letter-spacing:0}
.wn-x{margin-left:auto;display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:9px;background:none;color:#8b98ad;cursor:pointer}
.wn-x:hover{color:#e6e9ef;background:rgba(148,163,184,.12)}
.wn-x .i{width:16px;height:16px}
.wn-ver{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;color:#8b98ad}
.wn-ver b{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#5eead4}
.wn-ver .pre{padding:2px 8px;border-radius:999px;border:1px solid rgba(148,163,184,.28);color:#cbd5e1}
.wn-hero h2{margin:0 0 8px;font-size:24px;font-weight:650;letter-spacing:-.02em;line-height:1.2}
.wn-hero p{margin:0;max-width:52ch;font-size:14px;line-height:1.6;color:#a3afc2}
.wn-vers{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}
.wn-vers button{height:28px;padding:0 11px;border-radius:999px;border:1px solid rgba(148,163,184,.28);background:none;color:#cbd5e1;font:600 12px/1 var(--font);cursor:pointer}
.wn-vers button[aria-pressed=true]{background:#e6e9ef;border-color:#e6e9ef;color:#0b0f17}
.wn-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 24px 12px}
.wn-g{padding:14px 0 6px}
.wn-g+.wn-g{border-top:1px solid var(--line)}
.wn-g h3{margin:0 0 6px;font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.wn-it{display:grid;grid-template-columns:20px minmax(0,1fr);gap:2px 14px;padding:10px 0}
.wn-ic{grid-row:span 2;padding-top:2px;color:var(--text-3)}
.wn-g.new .wn-ic{color:#0d9488}
:root:not([data-theme=light]) .wn-g.new .wn-ic{color:#5eead4}
.wn-ic .i{width:18px;height:18px}
.wn-it b{font-size:14px;font-weight:600;color:var(--fg);line-height:1.4}
.wn-it p{margin:0;font-size:13px;line-height:1.55;color:var(--muted)}
.wn-foot{flex:none;display:flex;align-items:center;gap:12px;padding:12px 16px 12px 24px;border-top:1px solid var(--line);background:var(--surface-1)}
.wn-star{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);text-decoration:none}
.wn-star svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round}
.wn-star:hover{color:var(--fg)}
.wn-star:hover svg{fill:#f5c451;stroke:#f5c451}
.wn-star em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--text-3)}
.wn-foot .grow{flex:1}
.wn-log{border:0;background:none;padding:0 6px;height:36px;font:500 13px/1 var(--font);color:var(--text-2);cursor:pointer}
.wn-log:hover{color:var(--fg)}
.wn :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:760px){
  .modal:has(.wn){border-radius:var(--r) var(--r) 0 0}
  .modal:has(.wn) .modal-grab{display:none}
  .wn{max-height:88dvh}
  .wn-hero{padding:18px 18px 20px}.wn-hero h2{font-size:21px}
  .wn-body{padding:4px 18px 10px}
  .wn-foot{padding:10px 12px calc(10px + var(--safe-b,0px)) 18px}
}
`;

/** Semver compare; pre-release tags are ignored. */
function cmp(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  return 0;
}

function installed(): string {
  return String(state.health.version || '');
}

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/></svg>';

function body(r: Release): string {
  const now = installed();
  const ahead = !!now && cmp(r.version, now) > 0;
  return `<div class="wn" role="document">
    <header class="wn-hero">
      <div class="wn-top">${markSvg('wn-mark')}<span class="wn-word">Memora</span>
        <button type="button" class="wn-x" data-close aria-label="Close">${icon('close')}</button></div>
      <div class="wn-ver"><b>What's new in ${esc(r.version)}</b>${r.date ? `<span>${esc(r.date)}</span>` : ''}${
        ahead ? `<span class="pre">Coming next · you run ${esc(now)}</span>` : ''
      }</div>
      <h2 id="wnT">${esc(r.title)}</h2><p>${esc(r.lead)}</p>
      ${
        RELEASES.length > 1
          ? `<div class="wn-vers" role="group" aria-label="Release">${RELEASES.map(
              (x) => `<button type="button" data-ver="${esc(x.version)}" aria-pressed="${x.version === r.version}">${esc(x.version)}</button>`,
            ).join('')}</div>`
          : ''
      }
    </header>
    <div class="wn-body">${r.groups
      .map(
        (g) => `<section class="wn-g ${g.kind}"><h3>${KIND_LABEL[g.kind]}</h3>${g.items
          .map((it) => `<div class="wn-it"><span class="wn-ic" aria-hidden="true">${icon(it.icon)}</span><b>${esc(it.title)}</b><p>${esc(it.text)}</p></div>`)
          .join('')}</section>`,
      )
      .join('')}</div>
    <footer class="wn-foot">
      <a class="wn-star" data-star href="https://github.com/Codrihub/memora" target="_blank" rel="noopener noreferrer" title="Memora is free and open source. A star helps others find it.">${STAR}<span>Star Memora on GitHub</span><em data-stars></em></a>
      <span class="grow"></span>
      <button type="button" class="wn-log" data-log>Changelog</button>
      <button type="button" class="btn primary" data-close>Got it</button>
    </footer>
  </div>`;
}

/** From the server's release check; the browser never calls GitHub. */
async function paintStars(b: HTMLElement): Promise<void> {
  try {
    const c = await api<{ update?: { stars?: number | null; repo?: string } }>('/api/config');
    const n = c?.update?.stars;
    const el = b.querySelector<HTMLElement>('[data-stars]');
    if (el && typeof n === 'number') el.textContent = '· ' + n.toLocaleString('en-US');
    const a = b.querySelector<HTMLAnchorElement>('[data-star]');
    if (a && c?.update?.repo) a.href = c.update.repo;
  } catch {
    /* link stays without a count */
  }
}

export function openWhatsNew(version?: string): void {
  useStyles('whats-new-css', CSS);
  useStyles('brand-font-face', BRAND_FONT_CSS);
  let r = RELEASES.find((x) => x.version === version) || RELEASES[0];
  if (!r) return;
  const wire = (b: HTMLElement): void => {
    b.querySelectorAll<HTMLElement>('[data-close]').forEach((x) => (x.onclick = () => Modal.close()));
    b.querySelector<HTMLElement>('[data-log]')?.addEventListener('click', () => {
      Modal.close();
      openDocs('changelog');
    });
    b.querySelectorAll<HTMLElement>('[data-ver]').forEach((x) => {
      x.onclick = () => {
        r = RELEASES.find((y) => y.version === x.dataset.ver) || r;
        b.innerHTML = body(r);
        wire(b);
      };
    });
    void paintStars(b);
  };
  Modal.open({ title: "What's new", body: body(r), onOpen: wire });
  markSeen(r.version);
}

function markSeen(version: string): void {
  void api(FLAG, { method: 'PUT', body: { data: { seen: version } } }).catch(() => {});
}

/** A first sign-in (welcome tour open) marks the release seen instead of opening. */
export async function maybeWhatsNew(): Promise<void> {
  const now = installed();
  const due = RELEASES.find((x) => now && cmp(x.version, now) <= 0);
  if (!due) return;
  try {
    const r = await api<{ data?: { seen?: string } | null }>(FLAG);
    const seen = r?.data?.seen || '';
    if (seen && cmp(seen, due.version) >= 0) return;
    if (document.querySelector('.wl-tour')) return markSeen(due.version);
    openWhatsNew(due.version);
  } catch {
    /* No answer: skip rather than open on every load. */
  }
}
