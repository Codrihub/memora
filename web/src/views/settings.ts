// Settings: appearance (theme per device), account (username, password,
// signed-in devices), vault folder, interface preferences, activity log
// retention, server info and version. A sticky section nav (a side rail on
// wide screens, a scrollable chip row on tablets and phones) and one column of
// section cards; every row is "label and explanation | control", stacked on
// phones. Each form shows its own saving / saved / error state inline.
//
// Nothing here is cached between visits: the account, the sessions and the
// server info are read from the server every time the page is opened, and
// re-read after every change.

import { RELEASES_URL, takeSettingsSection, updateInfo } from '../version';
import { apiGet, apiPost } from '../api';
import { agentColor } from '../control/agents';
import { setAccountName } from '../account';
import { $, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { icon } from '../ui/icons';
import { Modal } from '../modal';
import { RT } from '../realtime';
import { clearTagIndex, saveToastPrefs, saveUI, toastPrefs, ui } from '../storage';
import { state, type Page } from '../state';
import { clearPins, pinnedItems } from '../vault/store';
import { renderTree } from '../sidebar';
import { setThemePref, themePref, type ThemePref } from '../theme';
import { toast } from '../toast';
import { fetchSettings, mountVaultForm, notesLabel, reloadVaultData } from '../vault';
import {
  ago,
  openDrawer,
  openMenu,
  openSheet,
  switchHTML,
  systemHeader,
  useControlStyles,
} from '../control/ui';
import type { AuthState, Config, KeyRow, KeysResult, OkResult, SettingsInfo } from '../types';

/** The window listener that keeps the theme cards in step is added once. */
let themeSync = false;
/** Bumped on every render so a slower, older load cannot paint over a newer one. */
let renderSeq = 0;

const CSS = `
.st{max-width:1120px;margin:0 auto}
.st [hidden]{display:none!important}
.st-layout{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:start}
.st-main{min-width:0;max-width:860px}

/* section nav: a solid rail on wide screens, a solid chip row below */
.st-nav{position:sticky;top:0;z-index:6;display:flex;flex-direction:column;gap:2px;padding:6px;
  background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r-lg)}
.st-nav a{display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;border-radius:9px;font-size:13px;font-weight:600;
  color:var(--text-2);white-space:nowrap;text-decoration:none;transition:background .15s,color .15s}
.st-nav a .i{width:16px;height:16px;flex:none;opacity:.85}
.st-nav a:hover{color:var(--fg);background:var(--hover);text-decoration:none}
.st-nav a[aria-current=true]{color:var(--accent);background:var(--accent-soft)}
.st-nav a[aria-current=true] .i{opacity:1}
.st-nav a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}

/* cards */
.st-card{background:var(--surface-1);border:1px solid var(--line-strong);border-radius:var(--r-lg);margin-bottom:18px;
  scroll-margin-top:16px;box-shadow:var(--shadow-sm)}
.st-card.st-flash{box-shadow:0 0 0 2px var(--accent-line);transition:box-shadow .3s}
.st-h{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--line)}
.st-h .ic{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;flex:none;
  background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent-line)}
.st-h .ic .i{width:18px;height:18px}
.st-h .tx{flex:1;min-width:0}
.st-h h2{margin:0;font-size:15px;font-weight:700;color:var(--fg);letter-spacing:-.005em}
.st-h p{margin:2px 0 0;font-size:12.5px;color:var(--muted);line-height:1.45}
.st-h .side{flex:none}

/* rows */
.st-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:10px 32px;padding:18px 20px;
  border-top:1px solid var(--line);align-items:start}
.st-h+.st-row,.st-row.first{border-top:0}
.st-row.full{grid-template-columns:1fr}
.st-l{min-width:0}
.st-l b{display:block;font-size:13.5px;font-weight:650;color:var(--fg)}
.st-l small{display:block;font-size:12.5px;color:var(--text-2);line-height:1.5;margin-top:3px}
.st-c{min-width:0}
/* per-key toast switches */
.st-tkeys{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden;transition:opacity .15s}
.st-tkeys.off{opacity:.5}
.st-tk{display:flex;align-items:center;gap:10px;padding:9px 12px;min-height:44px}
.st-tk+.st-tk{border-top:1px solid var(--line)}
.st-tk .dot{width:9px;height:9px;border-radius:50%;flex:none}
.st-tk .nm{flex:1;min-width:0;font-size:13px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-tk .nm em{font-style:normal;font-size:11px;color:var(--muted);margin-left:4px}
.st-tk .cc-sw:disabled{cursor:not-allowed}
.st-tk-empty{display:block;padding:12px;font-size:12.5px;color:var(--muted)}
.st-c.end{display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap}
.st-c .field{margin-bottom:12px}
.st-c .field input{width:100%;box-sizing:border-box}
.st-acts{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.st-note{font-size:12px;color:var(--muted);margin:10px 0 0;line-height:1.5}

/* inline save state */
.st-state{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;min-height:20px}
.st-state:empty{display:none}
.st-state .i{width:15px;height:15px;flex:none}
.st-state[data-s=saving]{color:var(--muted)}
.st-state[data-s=saved]{color:var(--ok)}
.st-state[data-s=error]{color:var(--danger)}
.st-state .sp{width:13px;height:13px;border-radius:99px;border:2px solid currentColor;border-right-color:transparent;animation:stSpin .7s linear infinite}
@keyframes stSpin{to{transform:rotate(360deg)}}

/* profile */
.st-me{display:flex;align-items:center;gap:14px}
.st-av{display:grid;place-items:center;width:44px;height:44px;border-radius:99px;flex:none;font-size:18px;font-weight:700;
  background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent-line)}
.st-me .who{min-width:0}
.st-me .who b{display:block;font-size:15px;font-weight:700;color:var(--fg);word-break:break-all}
.st-me .who span{display:block;font-size:12.5px;color:var(--text-2);margin-top:2px}

/* theme picker */
.st-theme{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.st-theme button{position:relative;display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:8px 8px 10px;border-radius:14px;
  border:1.5px solid var(--line-strong);background:var(--surface-2);text-align:left;color:var(--fg);transition:border-color .16s,box-shadow .16s}
.st-theme button:hover{border-color:var(--accent-line)}
.st-theme button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.st-theme button[aria-checked=true]{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.st-theme .pv{display:flex;height:58px;border-radius:9px;position:relative;overflow:hidden;border:1px solid rgba(127,127,127,.28)}
.st-theme .pv span{flex:1;position:relative}
.st-theme .pv .d{background:#0b0e14}
.st-theme .pv .l{background:#f5f6f8}
.st-theme .pv i{position:absolute;left:8px;right:30%;height:6px;border-radius:9px;top:10px;background:#5eead4}
.st-theme .pv .l i{background:#0d9488}
.st-theme .pv i+i{top:22px;right:40%;background:rgba(139,152,173,.55)}
.st-theme .pv i+i+i{top:34px;right:22%;background:rgba(139,152,173,.35)}
.st-theme .lb{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:650;padding:0 2px}
.st-theme .lb .i{flex:none;width:16px;height:16px}
.st-theme .ck{position:absolute;top:14px;right:14px;width:18px;height:18px;border-radius:50%;border:1.5px solid rgba(139,152,173,.7);
  display:grid;place-items:center;background:var(--surface-1)}
.st-theme button[aria-checked=true] .ck{background:var(--accent);border-color:var(--accent)}
.st-theme button[aria-checked=true] .ck::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--surface-1)}

/* sessions */
.st-sess{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface-0)}
.st-ses{display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;border-top:1px solid var(--line)}
.st-ses:first-child{border-top:0}
.st-ses .dv{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;flex:none;background:var(--surface-2);
  color:var(--text-2);border:1px solid var(--line)}
.st-ses .dv .i{width:18px;height:18px}
.st-ses.cur .dv{color:var(--accent);background:var(--accent-soft);border-color:var(--accent-line)}
.st-ses .mn{flex:1;min-width:0}
.st-ses .nm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13.5px;font-weight:650;color:var(--fg)}
.st-ses .nm span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-ses .mt{font-size:12px;color:var(--text-2);margin-top:3px;line-height:1.5}
.st-ses .mt em{font-style:normal;color:var(--muted);padding:0 5px}
.st-ses .more{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;flex:none;color:var(--text-2);
  border:1px solid transparent}
.st-ses .more:hover{background:var(--hover);color:var(--fg);border-color:var(--line)}
.st-ses .more .i{width:18px;height:18px}
.st-tag{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:99px;font-size:11px;font-weight:650;
  color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line)}
.st-empty{padding:16px;font-size:12.5px;color:var(--muted)}

/* destructive block */
.st-danger{margin:4px 20px 20px;border:1px solid color-mix(in srgb,var(--danger) 35%,var(--line));border-radius:12px;overflow:hidden}
.st-danger .st-row{padding:14px 16px}
.st-danger-h{padding:10px 16px;font-size:12.5px;font-weight:700;color:var(--danger);
  background:var(--danger-soft);border-bottom:1px solid color-mix(in srgb,var(--danger) 25%,var(--line))}

/* vault */
.st-vault{display:flex;align-items:flex-start;gap:12px;padding:12px 13px;border-radius:12px;background:var(--surface-0);border:1px solid var(--line)}
.st-vault-path{font-family:var(--mono);font-size:13px;word-break:break-all;color:var(--fg)}
.st-vault-meta{font-size:12px;color:var(--text-2);margin-top:3px}
.st-vault-txt{flex:1;min-width:0}

/* activity log */
.lg-use{display:flex;flex-direction:column;gap:8px;font-size:12.5px;color:var(--text-2)}
.lg-use-bar{height:8px;border-radius:99px;background:var(--surface-3);overflow:hidden}
.lg-use-bar i{display:block;height:100%;width:0;border-radius:inherit;background:var(--accent);transition:width .6s cubic-bezier(.2,.8,.2,1)}
.lg-lim{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:12px}
.lg-lim label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600;color:var(--text-2)}
.lg-lim label span{display:flex;align-items:center;gap:7px;color:var(--text-2);font-weight:500}
.lg-lim input{width:100px;height:36px;box-sizing:border-box;padding:0 10px;border-radius:10px;border:1px solid var(--line-strong);
  background:var(--surface-0);color:var(--fg);font-size:13px}
.lg-lim input:focus{outline:none;border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft)}
.lg-presets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.lg-presets .chip[aria-pressed=true]{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}

/* server info */
.st-kv{display:grid;grid-template-columns:minmax(120px,max-content) minmax(0,1fr);gap:0;font-size:13px;margin:0}
.st-kv dt{color:var(--text-2);padding:11px 20px;border-top:1px solid var(--line)}
.st-kv dd{margin:0;padding:11px 20px;border-top:1px solid var(--line);min-width:0;word-break:break-all;color:var(--fg)}
.st-kv dt:first-of-type,.st-kv dt:first-of-type+dd{border-top:0}
.st-kv .mono{font-family:var(--mono);font-size:12.5px}

/* version */
.st-ver{font:650 15px/1 var(--mono);color:var(--fg)}
.st-upd{display:inline-flex;align-items:center;height:30px;padding:0 11px;border-radius:999px;border:1px solid var(--line-strong);
  color:var(--text-2);font-size:12.5px;font-weight:600}
.st-upd.new{color:var(--accent);border-color:var(--accent-line);background:var(--accent-soft)}
.st-upd.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent);background:var(--ok-soft)}
.st-upd.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 35%,transparent);background:var(--warn-soft)}
.st-code{font-family:var(--mono);font-size:12px;background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:var(--fg)}

/* session activity drawer */
.st-act{list-style:none;margin:0;padding:0}
.st-act li{display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--line);font-size:13px}
.st-act li:first-child{border-top:0}
.st-act .w{flex:none;width:86px;color:var(--muted);font-size:12px;padding-top:1px}
.st-act .e b{display:block;font-weight:650;color:var(--fg)}
.st-act .e span{display:block;color:var(--text-2);font-size:12px;margin-top:2px;word-break:break-word}
.st-act .e.bad b{color:var(--danger)}
.st-act-note{font-size:12.5px;color:var(--text-2);margin:0 0 12px;line-height:1.5}

/* tablet: the nav becomes a sticky, solid chip row above the cards */
@media (max-width:1000px){
  .st-layout{grid-template-columns:1fr;gap:0}
  .st-main{max-width:none}
  .st-nav{top:-24px;flex-direction:row;overflow-x:auto;scrollbar-width:none;gap:6px;margin:-8px -28px 16px;padding:10px 28px;
    border:0;border-bottom:1px solid var(--line);border-radius:0;background:var(--bg)}
  .st-nav::-webkit-scrollbar{display:none}
  .st-nav a{flex:none;height:32px;padding:0 13px;border-radius:99px;border:1px solid var(--line-strong);background:var(--surface-1)}
  .st-nav a[aria-current=true]{border-color:var(--accent-line)}
  .st-nav a .i{display:none}
  .st-card{scroll-margin-top:68px}
  .st-row{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:10px 22px}
}

/* phone: rows stack, controls span the width */
@media (max-width:760px){
  .st-nav{top:-16px;margin:-6px -14px 14px;padding:9px 14px}
  .st-card{scroll-margin-top:62px;margin-bottom:14px}
  .st-h{padding:14px 14px}
  .st-h .ic{width:30px;height:30px}
  .st-row,.st-row.full{grid-template-columns:1fr;padding:15px 14px;gap:10px}
  .st-c.end{justify-content:flex-start}
  .st-acts .btn{flex:1 1 auto}
  .st-theme{gap:8px}
  .st-theme .pv{height:46px}
  .st-theme .lb{font-size:12.5px}
  .st-ses{padding:11px 10px 11px 12px}
  .st-ses .more{width:40px;height:40px}
  .st-danger{margin:4px 14px 14px}
  .st-danger .st-row{padding:13px 12px}
  .st-danger .btn{width:100%}
  .st-kv{grid-template-columns:1fr}
  .st-kv dt{padding:11px 14px 2px;border-top:1px solid var(--line)}
  .st-kv dd{padding:0 14px 11px;border-top:0}
  .st-kv dt:first-of-type{border-top:0}
}
@media (max-width:380px){.st-theme .lb .i{display:none}}
`;

interface LogSettings {
  max_mb: number;
  max_days: number;
  stats: { bytes: number; lines: number; oldest: number | null; newest: number | null; max_bytes: number };
}

interface SessionRow {
  id: string;
  current: boolean;
  source: string;
  alias: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
  last_seen: number;
  expires_in: number;
}

interface ActivityRow {
  at: number;
  event: string;
  ip: string | null;
  user: string | null;
  detail: string;
}

type SettingsFull = SettingsInfo & { session_ttl?: number; session_max_age?: number; state_dir?: string };

type SaveState = 'saving' | 'saved' | 'error' | '';

/** Inline state next to a save button: a spinner, a check or the error. */
function mark(host: ParentNode, sel: string, s: SaveState, text = ''): void {
  const n = host.querySelector<HTMLElement>(sel);
  if (!n) return;
  n.dataset.s = s;
  const ico = s === 'saving' ? '<span class="sp" aria-hidden="true"></span>' : s === 'saved' ? icon('check') : s === 'error' ? icon('alert') : '';
  const words = text || (s === 'saving' ? 'Saving…' : s === 'saved' ? 'Saved' : '');
  n.innerHTML = s ? `${ico}<span>${esc(words)}</span>` : '';
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function plural(n: number | undefined, word: string): string {
  const c = n || 0;
  return `${c} ${word}${c === 1 ? '' : 's'}`;
}

/** "45 minutes", "12 hours", "7 days". */
function span(secs: number): string {
  if (secs < 3600) return plural(Math.max(1, Math.round(secs / 60)), 'minute');
  if (secs < 86400 * 2) return plural(Math.round(secs / 3600), 'hour');
  return plural(Math.round(secs / 86400), 'day');
}

function dateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "Chrome on macOS" from a user agent; empty when unknown. */
function deviceName(ua: string | null): string {
  if (!ua) return '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl|wget|python|node/i.test(ua)
              ? 'Script'
              : 'Browser';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
  return os ? `${browser} on ${os}` : browser;
}

function isPhone(ua: string | null): boolean {
  return !!ua && /iPhone|Android.*Mobile|Mobile Safari/.test(ua);
}

function sessionTitle(s: SessionRow): string {
  return s.alias || deviceName(s.user_agent) || 'Unknown device';
}

const EVENT_LABEL: Record<string, string> = {
  login: 'Signed in',
  signin: 'Signed in',
  login_ok: 'Signed in',
  login_failed: 'Failed sign-in',
  signin_failed: 'Failed sign-in',
  logout: 'Signed out',
  password_changed: 'Password changed',
  username_changed: 'Username changed',
  vault_changed: 'Vault folder switched',
  sessions_revoked: 'Signed out other devices',
  key_created: 'Agent key created',
  key_deleted: 'Agent key deleted',
  key_rolled: 'Agent key rolled',
};

function eventLabel(ev: string): string {
  if (EVENT_LABEL[ev]) return EVENT_LABEL[ev];
  const t = ev.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function vaultSummary(info: SettingsInfo): string {
  if (!info.vault) {
    return `<div class="st-vault"><div class="st-vault-txt"><div class="st-vault-path">No vault folder configured</div></div><span class="cc-pill warn">Not set</span></div>`;
  }
  const s = info.stats;
  const meta = s ? `${plural(s.notes, 'node')} · ${plural(s.links, 'link')} · ${plural(s.folders, 'folder')}` : 'Counting nodes…';
  const badge =
    info.vault_writable === false
      ? '<span class="cc-pill err">Read only</span>'
      : info.vault_writable === true
        ? '<span class="cc-pill ok">Writable</span>'
        : '';
  return `<div class="st-vault"><div class="st-vault-txt"><div class="st-vault-path">${esc(info.vault)}</div>
    <div class="st-vault-meta">${esc(meta)}</div></div>${badge}</div>`;
}

const SECTIONS = [
  ['stAppearance', 'Appearance', 'sun'],
  ['stAccount', 'Account', 'user'],
  ['stVault', 'Vault folder', 'folder'],
  ['stInterface', 'Interface', 'sidebar'],
  ['stToasts', 'Notifications', 'bell'],
  ['stLogs', 'Activity log', 'activity'],
  ['stServer', 'Server', 'monitor'],
  ['stVersion', 'Version', 'refresh'],
] as const;

function head(id: string, title: string, sub: string, ico: string, side = ''): string {
  return `<header class="st-h"><span class="ic" aria-hidden="true">${icon(ico)}</span><div class="tx"><h2 id="${id}T">${esc(title)}</h2>${
    sub ? `<p>${esc(sub)}</p>` : ''
  }</div>${side ? `<div class="side">${side}</div>` : ''}</header>`;
}

function row(label: string, desc: string, control: string, opts: { id?: string; cls?: string; ctl?: string; form?: boolean } = {}): string {
  const tag = opts.form ? 'form' : 'div';
  return `<${tag} class="st-row${opts.cls ? ' ' + opts.cls : ''}"${opts.id ? ` id="${opts.id}"` : ''}${opts.form ? ' novalidate' : ''}>
    <div class="st-l"><b>${label}</b>${desc ? `<small>${desc}</small>` : ''}</div>
    <div class="st-c${opts.ctl ? ' ' + opts.ctl : ''}">${control}</div></${tag}>`;
}

const THEME_ICON: Record<ThemePref, string> = { dark: 'moon', light: 'sun', system: 'monitor' };

/** What the server reports about its supervisor (GET /api/server/shutdown). */
interface ShutdownInfo {
  restarts?: 'systemd' | 'docker' | null;
  unit?: string;
  stop?: string;
}

/** Confirm, then stop the server; a supervisor that restarts it is said plainly. */
async function askShutdown(): Promise<void> {
  const info = await apiGet<ShutdownInfo>('/api/server/shutdown').catch(() => ({}) as ShutdownInfo);
  const again =
    info.restarts === 'systemd'
      ? ` Note: systemd starts it again a few seconds later (Restart=always). To keep it stopped, run "${info.stop}" on the server instead.`
      : info.restarts === 'docker'
        ? ` Note: Docker may start the container again. To keep it stopped, run "${info.stop}" on the host instead.`
        : '';
  Modal.confirm(
    'Shut down Memora?',
    `You will be disconnected, and so will every other browser and agent. Memora stays off until it is started again on the server (memora-cli start, or its service).${again}`,
    'Shut down',
    () => {
      Modal.close();
      void apiPost<ShutdownInfo>('/api/server/shutdown', {})
        .then((r) => shutDownScreen(r.restarts ?? info.restarts ?? null))
        .catch((e: Error) => toast('Could not shut down: ' + e.message, 'err'));
    },
  );
}

/** The shut-down notice: a full-screen layer over the app, in the theme. */
const OFF_CSS = `
.st-off{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:24px 16px calc(24px + var(--safe-b,0px));
  background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  overflow:auto;outline:none;animation:st-off-in .2s var(--ease-out,ease-out)}
.st-off-card{width:min(520px,100%);box-sizing:border-box;padding:28px 28px 24px;border-radius:var(--r-xl,20px);border:1px solid var(--line-strong);
  background:var(--panel);color:var(--fg);box-shadow:var(--shadow-lg)}
.st-off-i{display:grid;place-items:center;width:46px;height:46px;border-radius:14px;margin-bottom:16px;
  background:var(--danger-soft);color:var(--danger)}
.st-off.back .st-off-i{background:var(--accent-soft);color:var(--accent)}
.st-off-i .i{width:22px;height:22px}
.st-off h1{margin:0 0 8px;font-size:21px;font-weight:720;letter-spacing:-.2px;line-height:1.3}
.st-off p{margin:0 0 12px;font-size:14px;line-height:1.6;color:var(--text-2,var(--muted))}
.st-off ul{margin:0 0 16px;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.st-off code{display:inline-block;max-width:100%;overflow-wrap:anywhere;font:500 12.5px/1.5 var(--mono);padding:3px 8px;border-radius:8px;
  border:1px solid var(--line);background:var(--panel-2);color:var(--fg)}
.st-off-wait{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted)}
.st-off-spin{width:16px;height:16px;flex:none;border-radius:50%;border:2px solid var(--line-strong);border-top-color:var(--accent);
  animation:st-off-spin .9s linear infinite}
.st-off-acts{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.st-off-note{font-size:13px;color:var(--muted)}
@keyframes st-off-spin{to{transform:rotate(360deg)}}
@keyframes st-off-in{from{opacity:0}}
@media (prefers-reduced-motion:reduce){.st-off{animation:none}.st-off-spin{animation-duration:2.4s}}
@media (max-width:760px){.st-off-card{padding:22px 18px 18px}.st-off h1{font-size:19px}}
`;

/**
 * Cover the app with a notice once the server is down. The app's DOM stays
 * (background code keeps its elements) but goes inert, and live updates stop
 * for good. With a supervisor that restarts it, reload when it is back.
 */
function shutDownScreen(restarts: ShutdownInfo['restarts']): void {
  const back = !!restarts;
  RT.stop();
  Modal.close();
  useStyles('st-off-css', OFF_CSS);
  document.getElementById('stOff')?.remove();
  const box = document.createElement('div');
  box.id = 'stOff';
  box.className = 'st-off' + (back ? ' back' : '');
  box.tabIndex = -1;
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'stOffT');
  box.setAttribute('aria-describedby', 'stOffD');
  box.innerHTML = `<div class="st-off-card">
    <span class="st-off-i" aria-hidden="true">${icon(back ? 'refresh' : 'logout')}</span>
    <h1 id="stOffT">${back ? 'Memora is restarting' : 'Memora is shut down'}</h1>
    ${
      back
        ? `<p id="stOffD">The server stopped and ${restarts === 'docker' ? 'Docker' : 'systemd'} is starting it again. This page reloads by itself when it is back.</p>
      <div class="st-off-wait" role="status" aria-live="polite"><span class="st-off-spin" aria-hidden="true"></span><span id="stOffW">Waiting for the server...</span></div>`
        : `<p id="stOffD">The server has stopped, and every browser and agent is disconnected. Start it again on the machine it runs on, for example with one of these, then reload this page:</p>
      <ul><li><code>memora-cli start</code></li><li><code>sudo systemctl start memora</code></li><li><code>docker start memora</code></li></ul>
      <div class="st-off-acts"><button class="btn primary" type="button" id="stOffR">${icon('refresh')}Reload</button>
        <span class="st-off-note" id="stOffW" role="status" aria-live="polite"></span></div>`
    }
  </div>`;
  document.getElementById('app')?.setAttribute('inert', '');
  document.body.appendChild(box);
  box.focus({ preventScroll: true });
  const healthy = (): Promise<boolean> =>
    fetch('/healthz', { cache: 'no-store' })
      .then((r) => r.ok)
      .catch(() => false);
  if (!back) {
    const btn = box.querySelector<HTMLButtonElement>('#stOffR')!;
    btn.onclick = () => {
      btn.disabled = true;
      void healthy().then((ok) => {
        if (ok) location.reload();
        else {
          btn.disabled = false;
          box.querySelector('#stOffW')!.textContent = 'Still stopped. Start it on the server first.';
        }
      });
    };
    return;
  }
  let tries = 0;
  const poll = (): void => {
    tries++;
    window.setTimeout(() => {
      void healthy().then((ok) => {
        if (ok) location.reload();
        else if (tries < 120) poll();
        else box.querySelector('#stOffW')!.textContent = 'It is taking a while. Check the server, then reload this page.';
      });
    }, 2000);
  };
  poll();
}

export async function renderSettings(): Promise<void> {
  useControlStyles();
  useStyles('settings-css-v3', CSS);
  const host = $('#view-settings');
  const seq = ++renderSeq;

  // Always read fresh: the username, the vault and the session limits may
  // have changed since the last visit (here, on another device or in the CLI).
  const infoP = fetchSettings().catch(() => null);
  const [cfg, st, me] = await Promise.all([
    apiGet<Config>('/api/config').catch(() => ({}) as Config),
    apiGet<AuthState>('/api/auth/state').catch(() => ({}) as AuthState),
    apiGet<{ user?: string; expires_in?: number }>('/api/auth/me').catch(() => null),
  ]);
  if (seq !== renderSeq) return;
  state.config = cfg;
  let user = (me?.user || state.me?.user || state.me?.username || '').trim();
  if (me?.user && me.user !== (state.me?.user || state.me?.username)) setAccountName(me.user);
  const minPw = cfg.min_password_len || st.min_password_len || 10;
  const version = cfg.version || state.health.version || '';
  const pref = themePref();

  const themeBtn = (p: ThemePref, label: string): string =>
    `<button type="button" role="radio" data-theme-pref="${p}" aria-checked="${p === pref}" tabindex="${p === pref ? 0 : -1}">
      <span class="pv" aria-hidden="true">${
        p === 'system'
          ? '<span class="d"><i></i><i></i><i></i></span><span class="l"><i></i><i></i><i></i></span>'
          : `<span class="${p === 'dark' ? 'd' : 'l'}"><i></i><i></i><i></i></span>`
      }</span>
      <span class="lb">${icon(THEME_ICON[p])}${label}</span><span class="ck" aria-hidden="true"></span></button>`;

  const presets: [string, string][] = [
    ['7', '1 week'],
    ['30', '30 days'],
    ['90', '90 days'],
    ['365', '1 year'],
    ['0', 'No age limit'],
  ];

  host.innerHTML = `<div class="cc st">${systemHeader('settings', 'Settings', 'How the app looks on this device, your account and devices, the vault folder and the server.')}
  <div class="st-layout">
    <nav class="st-nav" aria-label="Settings sections">${SECTIONS.map(
      ([id, l, ico], i) => `<a href="#${id}" data-sec="${id}"${i === 0 ? ' aria-current="true"' : ''}>${icon(ico)}<span>${l}</span></a>`,
    ).join('')}</nav>
    <div class="st-main">

    <section class="st-card" id="stAppearance" aria-labelledby="stAppearanceT">
      ${head('stAppearance', 'Appearance', 'Saved in this browser only.', 'sun')}
      ${row(
        '<span id="stThemeL">Theme</span>',
        'Dark, light, or follow the setting of this device.',
        `<div class="st-theme" role="radiogroup" aria-labelledby="stThemeL">${themeBtn('dark', 'Dark')}${themeBtn('light', 'Light')}${themeBtn('system', 'System')}</div>`,
      )}
    </section>

    <section class="st-card" id="stAccount" aria-labelledby="stAccountT">
      ${head('stAccount', 'Account', 'The owner account of this server and the devices signed in to it.', 'user')}
      <div class="st-row full first"><div class="st-me"><span class="st-av" id="sAv">${esc((user || '?').slice(0, 1).toUpperCase())}</span>
        <div class="who"><b id="sMeName">${esc(user || '-')}</b><span id="sMeSub">Signed in on this device</span></div></div></div>

      ${row(
        '<label for="sUser">Username</label>',
        "Used to sign in. Letters, digits, '-', '_' or '.', at most 32. Stored in lower case.",
        `<div class="field"><input id="sUser" type="text" value="${esc(user)}" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="32"></div>
         <div class="field" id="sUserPwF" hidden><label for="sUserPw">Current password</label>
           <input id="sUserPw" type="password" autocomplete="current-password"></div>
         <div class="st-acts"><button class="btn primary" id="sUserSave" type="submit" disabled>Save username</button>
           <span class="st-state" id="sUserSt" role="status" aria-live="polite"></span></div>`,
        { form: true, id: 'sUserForm' },
      )}

      ${row(
        'Password',
        `At least ${esc(minPw)} characters. This device stays signed in; every other device is signed out and told why.`,
        `<div id="sPwClosed" class="st-acts"><button class="btn" id="sPwOpen" type="button">${icon('key')}Change password</button>
           <span class="st-state" id="sPwSt0" role="status" aria-live="polite"></span></div>
         <div id="sPwOpenBox" hidden>
           <input type="text" autocomplete="username" value="${esc(user)}" hidden id="sPwUserHint">
           <div class="field"><label for="sPwCur">Current password</label><input id="sPwCur" type="password" autocomplete="current-password"></div>
           <div class="field"><label for="sPw1">New password</label><input id="sPw1" type="password" autocomplete="new-password"></div>
           <div class="field"><label for="sPw2">Repeat the new password</label><input id="sPw2" type="password" autocomplete="new-password"></div>
           <div class="st-acts"><button class="btn primary" id="sPwSave" type="submit">Change password</button>
             <button class="btn ghost" id="sPwCancel" type="button">Cancel</button>
             <span class="st-state" id="sPwSt" role="status" aria-live="polite"></span></div>
         </div>`,
        { form: true, id: 'sPwForm' },
      )}

      <div class="st-row full" id="sSessRow">
        <div class="st-l"><b>Signed-in devices</b><small>Browsers signed in to this account. Agents use API keys and are not listed or affected here.</small></div>
        <div class="st-c"><div class="st-sess" id="sSess"><div class="st-empty">Loading…</div></div></div>
      </div>

      <div class="st-danger" role="group" aria-labelledby="sDangerH">
        <div class="st-danger-h" id="sDangerH">Sign out</div>
        ${row(
          'Other devices',
          'End every session except this one. Those browsers must sign in again.',
          `<button class="btn danger" id="sOutOthers" type="button">${icon('logout')}Sign out other devices</button><span class="st-state" id="sOutSt" role="status" aria-live="polite"></span>`,
          { ctl: 'end', cls: 'first' },
        )}
        ${row('This device', 'End the session in this browser.', `<button class="btn danger" id="sLogout" type="button">${icon('logout')}Sign out</button>`, {
          ctl: 'end',
        })}
      </div>
    </section>

    <section class="st-card" id="stVault" aria-labelledby="stVaultT">
      ${head('stVault', 'Vault folder', 'Markdown nodes on the server disk. This app and every agent read and write here.', 'folder')}
      ${row('Current folder', 'Where your nodes live right now.', `<div id="sVaultNow">${vaultSummary({ vault: state.health.vault || cfg.vault || null })}</div>`)}
      ${row(
        'Switch folder',
        'Takes effect at once for this app and for agents. Nothing is moved or copied. In Docker use a mounted volume path.',
        '<div id="sVaultForm"><span class="st-note">Loading…</span></div>',
      )}
    </section>

    <section class="st-card" id="stInterface" aria-labelledby="stInterfaceT">
      ${head('stInterface', 'Interface', 'Preferences kept in this browser.', 'sidebar')}
      ${row(
        '<span id="sCollapsedL">Collapsed sidebar</span>',
        'Start with the sidebar panel collapsed.',
        switchHTML('sCollapsed', !!ui.collapsed, 'Start with the sidebar collapsed', ' aria-labelledby="sCollapsedL"'),
        { ctl: 'end' },
      )}
      ${row('Pinned nodes', 'Pins are saved on the server and shared by every browser and device you sign in on. Removing them does not touch the nodes.', '<button class="btn" id="sClearPins" type="button">Remove all pins</button>', {
        ctl: 'end',
      })}
      ${row('Tag index', 'A cached index of tags; it is rebuilt the next time it is needed.', '<button class="btn" id="sClearIdx" type="button">Clear the cache</button>', {
        ctl: 'end',
      })}
    </section>

    <section class="st-card" id="stToasts" aria-labelledby="stToastsT">
      ${head('stToasts', 'Notifications', 'Pop-up toasts when an agent works in the vault. Kept in this browser.', 'bell')}
      ${row(
        '<span id="sToastsL">Agent activity toasts</span>',
        'The main switch. When it is off, no activity toast appears, even for keys turned on below.',
        switchHTML('sToasts', !toastPrefs.off, 'Agent activity toasts', ' aria-labelledby="sToastsL"'),
        { ctl: 'end' },
      )}
      <div class="st-row st-keys-row"><div class="st-l"><b>Per API key</b><small>Turn off the toasts of a single agent.</small></div>
        <div class="st-c"><div class="st-tkeys" id="sToastKeys" aria-live="polite"><span class="st-tk-empty">Loading keys…</span></div></div></div>
    </section>

    <section class="st-card" id="stLogs" aria-labelledby="stLogsT">
      ${head('stLogs', 'Activity log', 'Agent calls and node changes, kept on the server.', 'activity')}
      ${row(
        'Usage',
        'The oldest events are dropped first once a limit is reached.',
        '<div class="lg-use"><div class="lg-use-bar"><i id="sLogBar"></i></div><span id="sLogUse">Loading…</span></div>',
      )}
      ${row(
        'Retention',
        'A size cap in MB, and how many days to keep (0 keeps by size only). Applied right away.',
        `<div class="lg-lim">
           <label>Max size<span><input id="sLogMb" type="number" min="1" max="512" step="1" inputmode="numeric"> MB</span></label>
           <label>Keep for<span><input id="sLogDays" type="number" min="0" max="3650" step="1" inputmode="numeric"> days</span></label>
         </div>
         <div class="lg-presets" role="group" aria-label="Quick choices">${presets
           .map(([d, l]) => `<button type="button" class="chip" data-days="${d}" aria-pressed="false">${l}</button>`)
           .join('')}</div>
         <div class="st-acts"><button class="btn primary" id="sLogSave" type="submit">Save and trim now</button>
           <span class="st-state" id="sLogSt" role="status" aria-live="polite"></span></div>`,
        { form: true, id: 'sLogForm' },
      )}
    </section>

    <section class="st-card" id="stServer" aria-labelledby="stServerT">
      ${head('stServer', 'Server', 'Change these settings with memora-cli on the server.', 'monitor')}
      <dl class="st-kv" id="sServerKv"></dl>
      <div class="st-danger" role="group" aria-labelledby="sStopH">
        <div class="st-danger-h" id="sStopH">Shut down</div>
        ${row(
          'Stop the server',
          'Stops Memora on the machine it runs on. Every browser and agent is disconnected until it is started again there.',
          `<button class="btn danger" id="sShutdown" type="button">${icon('logout')}Shut down</button>`,
          { ctl: 'end', cls: 'first' },
        )}
      </div>
    </section>

    <section class="st-card" id="stVersion" aria-labelledby="stVersionT">
      ${head('stVersion', 'Version', 'Memora by Codrihub Tech', 'refresh')}
      ${row('Installed', 'The version this server runs.', `<span class="st-ver" id="sVerCur">v${esc(version || '-')}</span>`, { ctl: 'end' })}
      ${row('Latest release', 'The newest release published on GitHub.', `<span class="st-ver" id="sVerLatest">-</span>`, { ctl: 'end' })}
      ${row(
        'Updates',
        '<span id="sVerHint">Checking for a newer release…</span>',
        `<span class="st-upd" id="sVerState">-</span><a class="btn" id="sVerLink" href="${RELEASES_URL}" target="_blank" rel="noopener noreferrer">Releases on GitHub</a>`,
        { ctl: 'end' },
      )}
      ${row(
        'Documentation',
        'Install, configuration, agent instructions, the MCP tool reference and the API.',
        `<a class="btn" id="sDocs" href="/docs">Open documentation</a>`,
        { ctl: 'end' },
      )}
      ${row(
        'How to update',
        'Native install: run <code class="st-code">sudo memora-cli</code> and type <code class="st-code">/update</code>. Docker: <code class="st-code">docker compose pull &amp;&amp; docker compose up -d</code>.',
        '',
        { cls: 'full' },
      )}
    </section>
    </div>
  </div></div>`;

  // ── server info ──────────────────────────────────────────────────────
  const paintServer = (info: SettingsFull | null): void => {
    const ttl = info?.session_ttl || Number(cfg.session_ttl) || 0;
    const maxAge = info?.session_max_age || 0;
    const rows: [string, string, boolean][] = [
      ['Version', version ? 'v' + version : '-', false],
      ['Realm', cfg.realm || st.realm || '-', false],
      ['MCP endpoint', location.origin + '/mcp', true],
      ['State folder', info?.state_dir || '-', true],
      ['Vault folder', info?.vault || state.health.vault || cfg.vault || 'Not set', true],
      ['Session idle timeout', ttl ? span(ttl) : '-', false],
      ['Session longest', maxAge ? span(maxAge) : 'No limit', false],
      ['Gateway', st.locked ? 'Locked' : st.armed ? 'Setup window open' : 'Normal', false],
    ];
    const kv = host.querySelector<HTMLElement>('#sServerKv');
    if (kv)
      kv.innerHTML = rows.map(([k, v, mono]) => `<dt>${esc(k)}</dt><dd${mono ? ' class="mono"' : ''}>${esc(v)}</dd>`).join('');
  };
  paintServer(null);

  // ── version ──────────────────────────────────────────────────────────
  host.querySelector<HTMLElement>('#sDocs')?.addEventListener('click', (e) => {
    e.preventDefault();
    hooks.go('docs');
  });
  void updateInfo(version, cfg).then((u) => {
    const stateEl = host.querySelector<HTMLElement>('#sVerState');
    const hint = host.querySelector<HTMLElement>('#sVerHint');
    const link = host.querySelector<HTMLAnchorElement>('#sVerLink');
    const latestEl = host.querySelector<HTMLElement>('#sVerLatest');
    if (!stateEl || !hint || !link) return;
    link.href = u.url;
    if (latestEl) latestEl.textContent = u.latest ? 'v' + u.latest : u.state === 'none' ? 'None yet' : '-';
    stateEl.classList.remove('new', 'ok', 'warn');
    if (u.available && u.latest) {
      stateEl.textContent = 'Update available v' + u.latest;
      stateEl.classList.add('new');
      hint.textContent = 'A newer release is out. Read what changed, then update.';
      link.textContent = 'View v' + u.latest + ' on GitHub';
    } else if (u.state === 'ok' || u.state === 'none') {
      stateEl.textContent = 'Up to date';
      stateEl.classList.add('ok');
      hint.textContent = u.state === 'ok' ? 'You run the newest release.' : 'No release has been published yet.';
    } else if (u.state === 'off') {
      stateEl.textContent = 'Checks off';
      hint.textContent = 'Release checks are turned off on this server (MEMORA_UPDATE_CHECK).';
    } else if (u.state === 'pending') {
      stateEl.textContent = 'Checking…';
      hint.textContent = 'The server checks GitHub shortly after it starts.';
    } else {
      stateEl.textContent = 'Could not check';
      stateEl.classList.add('warn');
      hint.textContent = 'The server could not reach GitHub. It tries again later.';
    }
  });

  // ── section nav ──────────────────────────────────────────────────────
  const navLinks = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-sec]'));
  const nav = host.querySelector<HTMLElement>('.st-nav');
  const setCurrent = (id: string): void => {
    navLinks.forEach((a) => {
      const on = a.dataset.sec === id;
      if (on) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
      // Keep the active chip in view in the horizontal row.
      if (on && nav && nav.scrollWidth > nav.clientWidth + 4) {
        const l = a.offsetLeft - nav.clientWidth / 2 + a.offsetWidth / 2;
        nav.scrollTo({ left: Math.max(0, l), behavior: 'smooth' });
      }
    });
  };
  let pinned = 0;
  navLinks.forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      const id = a.dataset.sec!;
      setCurrent(id);
      // While the smooth scroll runs, the observer must not move the highlight.
      pinned = Date.now() + 900;
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
  const onScroll = (): void => {
    if (!host.contains(nav) || Date.now() < pinned) return;
    // The last section whose top passed a line under the sticky nav; at the
    // bottom of the page the last section wins (it cannot reach the line).
    const line = host.getBoundingClientRect().top + (window.matchMedia('(max-width:1000px)').matches ? 90 : 60);
    let cur: string = SECTIONS[0][0];
    for (const [id] of SECTIONS) {
      const n = document.getElementById(id);
      if (n && n.getBoundingClientRect().top <= line) cur = id;
    }
    if (host.scrollTop + host.clientHeight >= host.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1][0];
    const now = navLinks.find((a) => a.getAttribute('aria-current') === 'true')?.dataset.sec;
    if (now !== cur) setCurrent(cur);
  };
  host.onscroll = () => requestAnimationFrame(onScroll);

  const jump = takeSettingsSection();
  if (jump) {
    const target = document.getElementById(jump);
    if (target) {
      setCurrent(jump);
      pinned = Date.now() + 1200;
      requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      target.classList.add('st-flash');
      window.setTimeout(() => target.classList.remove('st-flash'), 1600);
    }
  }

  // ── appearance ───────────────────────────────────────────────────────
  const themeBtns = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-theme-pref]'));
  if (!themeSync) {
    // The profile menu can switch the theme while Settings is open.
    themeSync = true;
    window.addEventListener('memora:theme', (e) => {
      const p = (e as CustomEvent<ThemePref>).detail;
      document.querySelectorAll<HTMLButtonElement>('.st-theme [data-theme-pref]').forEach((x) => {
        x.setAttribute('aria-checked', String(x.dataset.themePref === p));
        x.tabIndex = x.dataset.themePref === p ? 0 : -1;
      });
    });
  }
  const pick = (b: HTMLButtonElement): void => {
    setThemePref(b.dataset.themePref as ThemePref);
    themeBtns.forEach((x) => {
      x.setAttribute('aria-checked', String(x === b));
      x.tabIndex = x === b ? 0 : -1;
    });
  };
  themeBtns.forEach((b, i) => {
    b.onclick = () => pick(b);
    b.onkeydown = (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const n = themeBtns[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : themeBtns.length - 1)) % themeBtns.length];
      pick(n);
      n.focus();
    };
  });

  // ── account: username ────────────────────────────────────────────────
  const uForm = host.querySelector<HTMLFormElement>('#sUserForm')!;
  const uInput = host.querySelector<HTMLInputElement>('#sUser')!;
  const uPw = host.querySelector<HTMLInputElement>('#sUserPw')!;
  const uPwF = host.querySelector<HTMLElement>('#sUserPwF')!;
  const uSave = host.querySelector<HTMLButtonElement>('#sUserSave')!;

  /** Show the new name everywhere: this form, the profile card, the chip, the menu, state.me. */
  const showUser = (name: string): void => {
    user = name;
    uInput.value = name;
    host.querySelector<HTMLElement>('#sMeName')!.textContent = name;
    host.querySelector<HTMLElement>('#sAv')!.textContent = name.slice(0, 1).toUpperCase();
    const hint = host.querySelector<HTMLInputElement>('#sPwUserHint');
    if (hint) hint.value = name;
    setAccountName(name);
  };
  const syncUserForm = (): void => {
    const changed = uInput.value.trim().toLowerCase() !== user.toLowerCase();
    uPwF.hidden = !changed;
    uSave.disabled = !changed;
  };
  uInput.oninput = () => {
    syncUserForm();
    mark(host, '#sUserSt', '');
  };
  uForm.onsubmit = (e) => {
    e.preventDefault();
    const name = uInput.value.trim();
    if (!name) return mark(host, '#sUserSt', 'error', 'Enter a username.');
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(name)) return mark(host, '#sUserSt', 'error', "Use letters, digits, '-', '_' or '.', at most 32.");
    if (name.toLowerCase() === user.toLowerCase()) return mark(host, '#sUserSt', 'error', 'That is already your username.');
    if (!uPw.value) {
      uPw.focus();
      return mark(host, '#sUserSt', 'error', 'Enter your current password.');
    }
    uSave.disabled = true;
    mark(host, '#sUserSt', 'saving');
    void (async () => {
      try {
        const r = await apiPost<{ user?: string }>('/api/settings/username', { username: name, current: uPw.value });
        uPw.value = '';
        showUser(r.user || name.toLowerCase());
        // Read it back so this page and a later visit show what the server has.
        const fresh = await fetchSettings().catch(() => null);
        if (fresh?.user) showUser(fresh.user);
        syncUserForm();
        mark(host, '#sUserSt', 'saved', `Saved as ${user}`);
        toast('Username changed', 'ok');
      } catch (err) {
        mark(host, '#sUserSt', 'error', (err as Error).message);
        uSave.disabled = false;
      }
    })();
  };
  syncUserForm();

  // ── account: password ────────────────────────────────────────────────
  const pwForm = host.querySelector<HTMLFormElement>('#sPwForm')!;
  const pwBox = host.querySelector<HTMLElement>('#sPwOpenBox')!;
  const pwClosed = host.querySelector<HTMLElement>('#sPwClosed')!;
  const pwVal = (id: string): string => host.querySelector<HTMLInputElement>(id)!.value;
  const pwReset = (): void => {
    ['#sPwCur', '#sPw1', '#sPw2'].forEach((id) => (host.querySelector<HTMLInputElement>(id)!.value = ''));
  };
  const pwShow = (open: boolean): void => {
    pwBox.hidden = !open;
    pwClosed.hidden = open;
    if (open) host.querySelector<HTMLInputElement>('#sPwCur')!.focus();
  };
  host.querySelector<HTMLButtonElement>('#sPwOpen')!.onclick = () => {
    mark(host, '#sPwSt0', '');
    pwShow(true);
  };
  host.querySelector<HTMLButtonElement>('#sPwCancel')!.onclick = () => {
    pwReset();
    mark(host, '#sPwSt', '');
    pwShow(false);
  };
  pwForm.onsubmit = (e) => {
    e.preventDefault();
    const cur = pwVal('#sPwCur');
    const pw1 = pwVal('#sPw1');
    const pw2 = pwVal('#sPw2');
    if (!cur) return mark(host, '#sPwSt', 'error', 'Enter your current password.');
    if (pw1.length < minPw) return mark(host, '#sPwSt', 'error', `The new password needs at least ${minPw} characters.`);
    if (pw1 !== pw2) return mark(host, '#sPwSt', 'error', 'The new passwords do not match.');
    const btn = host.querySelector<HTMLButtonElement>('#sPwSave')!;
    btn.disabled = true;
    mark(host, '#sPwSt', 'saving');
    void (async () => {
      try {
        const r = await apiPost<OkResult & { revoked_sessions?: number }>('/api/settings/password', {
          current: cur,
          password: pw1,
          confirm: pw2,
        });
        pwReset();
        pwShow(false);
        const n = r.revoked_sessions || 0;
        mark(host, '#sPwSt0', 'saved', 'Password changed' + (n ? `. ${n} other device${n === 1 ? '' : 's'} signed out.` : '.'));
        toast('Password changed', 'ok');
        void loadSessions();
      } catch (err) {
        mark(host, '#sPwSt', 'error', (err as Error).message);
      } finally {
        btn.disabled = false;
      }
    })();
  };

  // ── account: signed-in devices ───────────────────────────────────────
  let sessions: SessionRow[] = [];
  const sessBox = host.querySelector<HTMLElement>('#sSess')!;
  const outOthers = host.querySelector<HTMLButtonElement>('#sOutOthers')!;

  const sessionHTML = (s: SessionRow): string => {
    const meta = [
      s.current ? 'Active now' : 'Active ' + ago(s.last_seen),
      s.ip ? 'IP ' + s.ip : '',
      'Signed in ' + dateTime(s.created_at),
    ].filter(Boolean);
    return `<div class="st-ses${s.current ? ' cur' : ''}" data-id="${esc(s.id)}">
      <span class="dv" aria-hidden="true">${icon(isPhone(s.user_agent) ? 'note' : 'monitor')}</span>
      <div class="mn"><div class="nm"><span>${esc(sessionTitle(s))}</span>${s.current ? '<span class="st-tag">This device</span>' : ''}</div>
        <div class="mt">${meta.map(esc).join('<em>·</em>')}</div></div>
      <button type="button" class="more" data-more="${esc(s.id)}" aria-haspopup="menu" aria-label="Actions for ${esc(sessionTitle(s))}">${icon('more')}</button>
    </div>`;
  };

  const loadSessions = async (): Promise<void> => {
    try {
      const r = await apiGet<{ sessions: SessionRow[] }>('/api/settings/sessions');
      sessions = r.sessions || [];
    } catch (e) {
      sessBox.innerHTML = `<div class="st-empty">Could not read the sessions: ${esc((e as Error).message)}</div>`;
      return;
    }
    if (!host.contains(sessBox)) return;
    sessBox.innerHTML = sessions.length ? sessions.map(sessionHTML).join('') : '<div class="st-empty">No sessions.</div>';
    const others = sessions.filter((s) => !s.current).length;
    outOthers.disabled = others === 0;
    outOthers.title = others ? '' : 'No other device is signed in';
    const cur = sessions.find((s) => s.current);
    const sub = host.querySelector<HTMLElement>('#sMeSub');
    if (sub)
      sub.textContent =
        `Signed in on this device${cur?.expires_in ? ` · session renews while you work (${span(cur.expires_in)} idle left)` : ''}` +
        (others ? ` · ${plural(others, 'other device')}` : '');
    sessBox.querySelectorAll<HTMLButtonElement>('[data-more]').forEach((b) => {
      b.onclick = () => {
        const s = sessions.find((x) => x.id === b.dataset.more);
        if (s) sessionMenu(b, s);
      };
    });
  };

  const revoke = async (s: SessionRow): Promise<void> => {
    try {
      await apiPost('/api/settings/sessions/revoke', { id: s.id });
      toast(`${sessionTitle(s)} signed out`, 'ok');
    } catch (e) {
      toast('Could not sign it out: ' + (e as Error).message, 'err');
    }
    void loadSessions();
  };

  const rename = (s: SessionRow): void => {
    const sh = openSheet({
      title: 'Name this device',
      sub: deviceName(s.user_agent) || 'Unknown device',
      width: 440,
      body: `<div class="field"><label for="sAlias">Device name</label>
        <input id="sAlias" type="text" maxlength="64" value="${esc(s.alias || '')}" placeholder="${esc(deviceName(s.user_agent) || 'Work laptop')}">
        <span class="hint">Shown in this list only. Leave empty to show the browser name.</span></div>
        <span class="st-state" id="sAliasSt" role="status" aria-live="polite"></span>`,
      actions: [
        { label: 'Cancel', cls: 'ghost', run: (x) => x.close() },
        {
          label: 'Save',
          cls: 'primary',
          run: async (x) => {
            const alias = x.body.querySelector<HTMLInputElement>('#sAlias')!.value;
            mark(x.body, '#sAliasSt', 'saving');
            try {
              await apiPost('/api/settings/sessions/rename', { id: s.id, alias });
              x.close();
              toast('Device renamed', 'ok');
              void loadSessions();
            } catch (e) {
              mark(x.body, '#sAliasSt', 'error', (e as Error).message);
            }
          },
        },
      ],
    });
    sh.body.querySelector<HTMLInputElement>('#sAlias')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (sh.foot?.querySelector('.btn.primary') as HTMLButtonElement | null)?.click();
    });
  };

  const activity = (s: SessionRow): void => {
    const d = openDrawer({
      title: 'Activity on this device',
      sub: sessionTitle(s) + (s.current ? ' · this device' : ''),
      body: `<p class="st-act-note">Sign-ins, account changes and failed attempts recorded from ${
        s.ip ? `IP <b>${esc(s.ip)}</b>` : 'this device'
      } since it signed in on ${esc(dateTime(s.created_at))}. Node edits and agent calls are in Activity.</p>
        <ul class="st-act" id="sActList"><li><span class="e"><span>Loading…</span></span></li></ul>`,
      foot: `<button type="button" class="btn" id="sActLogs">${icon('activity')}Open Activity</button>`,
    });
    d.querySelector<HTMLButtonElement>('#sActLogs')!.onclick = () => {
      d.querySelector<HTMLButtonElement>('[data-x]')?.click();
      hooks.go('logs' as Page);
    };
    void apiGet<{ events: ActivityRow[] }>('/api/settings/sessions/activity?id=' + encodeURIComponent(s.id))
      .then((r) => {
        const list = d.querySelector<HTMLElement>('#sActList');
        if (!list) return;
        const ev = r.events || [];
        list.innerHTML = ev.length
          ? ev
              .map(
                (e) => `<li><span class="w" title="${esc(new Date(e.at * 1000).toLocaleString())}">${esc(ago(e.at))}</span>
                  <span class="e${/fail|denied|blocked/.test(e.event) ? ' bad' : ''}"><b>${esc(eventLabel(e.event))}</b>${
                    e.detail || e.user ? `<span>${esc([e.user, e.detail].filter(Boolean).join(' · '))}</span>` : ''
                  }</span></li>`,
              )
              .join('')
          : '<li><span class="e"><span>Nothing recorded from this device yet.</span></span></li>';
      })
      .catch((e) => {
        const list = d.querySelector<HTMLElement>('#sActList');
        if (list) list.innerHTML = `<li><span class="e bad"><b>Could not load</b><span>${esc((e as Error).message)}</span></span></li>`;
      });
  };

  const sessionMenu = (anchor: HTMLElement, s: SessionRow): void => {
    openMenu(
      anchor,
      [
        {
          label: 'Activity on this device',
          desc: 'Sign-ins and account changes from it',
          icon: icon('activity'),
          run: () => activity(s),
        },
        { label: 'Rename device', desc: 'Give it a name you recognise', icon: icon('note'), run: () => rename(s) },
        { label: '', sep: true },
        s.current
          ? {
              label: 'Sign out here',
              desc: 'End the session in this browser',
              icon: icon('logout'),
              danger: true,
              run: () => void signOutHere(),
            }
          : {
              label: 'Sign out this device',
              desc: 'It must sign in again and is told why',
              icon: icon('logout'),
              danger: true,
              run: () =>
                Modal.confirm(
                  'Sign out this device?',
                  `${sessionTitle(s)} will be signed out at once and must sign in again.`,
                  'Sign out',
                  async () => {
                    Modal.close();
                    await revoke(s);
                  },
                ),
            },
      ],
      { title: sessionTitle(s) + (s.current ? ' (this device)' : ''), lead: icon(isPhone(s.user_agent) ? 'note' : 'monitor') },
    );
  };

  outOthers.onclick = () => {
    const n = sessions.filter((s) => !s.current).length;
    Modal.confirm(
      'Sign out other devices?',
      `${plural(n, 'other device')} will be signed out and must sign in again. This device stays signed in. Agents and API keys keep working.`,
      'Sign out others',
      async () => {
        Modal.close();
        mark(host, '#sOutSt', 'saving', 'Signing out…');
        try {
          const r = await apiPost<{ revoked?: number }>('/api/settings/sessions/revoke', { others: true });
          const k = r.revoked || 0;
          mark(host, '#sOutSt', 'saved', k ? `${plural(k, 'device')} signed out` : 'No other devices');
        } catch (e) {
          mark(host, '#sOutSt', 'error', (e as Error).message);
        }
        void loadSessions();
      },
    );
  };

  const signOutHere = async (): Promise<void> => {
    try {
      await apiPost<OkResult>('/api/auth/logout');
      location.href = '/login';
    } catch (e) {
      toast('Could not sign out: ' + (e as Error).message, 'err');
    }
  };
  host.querySelector<HTMLButtonElement>('#sLogout')!.onclick = () => void signOutHere();
  host.querySelector<HTMLButtonElement>('#sShutdown')!.onclick = () => void askShutdown();
  void loadSessions();

  // ── vault ────────────────────────────────────────────────────────────
  void infoP.then((full) => {
    const info = (full || {}) as SettingsFull;
    if (seq !== renderSeq || !host.contains($('#sVaultNow'))) return;
    if (info.user && info.user !== user) showUser(info.user);
    syncUserForm();
    paintServer(full ? info : null);
    $('#sVaultNow').innerHTML = vaultSummary(info.vault !== undefined ? info : { vault: state.health.vault || cfg.vault || null });
    mountVaultForm($('#sVaultForm'), {
      id: 'sv',
      suggested: info.vault_suggested,
      current: info.vault,
      submitLabel: 'Switch vault',
      onDone: async (res) => {
        ($('#svPath') as unknown as HTMLInputElement).value = '';
        $('#sVaultNow').innerHTML = vaultSummary({ vault: res.vault, stats: res.stats, vault_writable: true });
        const err = $('#svErr');
        err.className = 'vf-ok';
        err.textContent = `Now using ${res.vault}${res.created ? ' (created)' : ''}: ${notesLabel(res.stats?.notes)}.`;
        await reloadVaultData();
        void fetchSettings()
          .then((f) => paintServer(f as SettingsFull))
          .catch(() => undefined);
        toast('Vault switched', 'ok');
      },
    });
  });

  // ── interface ────────────────────────────────────────────────────────
  const sw = host.querySelector<HTMLButtonElement>('#sCollapsed')!;
  sw.onclick = () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    ui.collapsed = on;
    saveUI();
    toast(on ? 'The sidebar starts collapsed' : 'The sidebar starts open', 'ok', 1800);
  };
  // ── notifications ────────────────────────────────────────────────────
  const tSw = host.querySelector<HTMLButtonElement>('#sToasts')!;
  const tBox = host.querySelector<HTMLElement>('#sToastKeys')!;
  const paintToastKeys = (): void => {
    tBox.classList.toggle('off', toastPrefs.off);
    tBox.querySelectorAll<HTMLButtonElement>('.cc-sw').forEach((b) => {
      b.disabled = toastPrefs.off;
      b.setAttribute('aria-checked', String(!toastPrefs.muted.includes(b.dataset.key || '')));
    });
  };
  tSw.onclick = () => {
    toastPrefs.off = tSw.getAttribute('aria-checked') === 'true';
    tSw.setAttribute('aria-checked', String(!toastPrefs.off));
    saveToastPrefs();
    paintToastKeys();
    toast(toastPrefs.off ? 'Activity toasts are off' : 'Activity toasts are on', 'ok', 1800);
  };
  void apiGet<KeysResult | KeyRow[]>('/api/keys')
    .then((d) => {
      if (seq !== renderSeq) return;
      const rows = Array.isArray(d) ? d : d.keys || [];
      if (!rows.length) {
        tBox.innerHTML = '<span class="st-tk-empty">No API keys yet.</span>';
        return;
      }
      tBox.innerHTML = rows
        .map((k, i) => {
          const name = k.name || k.id;
          return `<div class="st-tk"><span class="dot" style="background:${esc(agentColor(name, k.id))}"></span><span class="nm" id="sTk${i}">${esc(name)}${
            k.enabled === false ? ' <em>disabled</em>' : ''
          }</span>${switchHTML('sTkSw' + i, true, 'Toasts for ' + name, ` aria-labelledby="sTk${i}" data-key="${esc(k.id)}"`)}</div>`;
        })
        .join('');
      tBox.querySelectorAll<HTMLButtonElement>('.cc-sw').forEach((b) => {
        b.onclick = () => {
          if (toastPrefs.off) return;
          const id = b.dataset.key || '';
          const muted = new Set(toastPrefs.muted);
          if (muted.has(id)) muted.delete(id);
          else muted.add(id);
          toastPrefs.muted = [...muted];
          saveToastPrefs();
          paintToastKeys();
        };
      });
      paintToastKeys();
    })
    .catch(() => {
      if (seq === renderSeq) tBox.innerHTML = '<span class="st-tk-empty">The key list could not be loaded.</span>';
    });

  host.querySelector<HTMLButtonElement>('#sClearPins')!.onclick = () => {
    Modal.confirm(
      'Remove all pins?',
      'The Pinned list empties on every browser and device. The nodes and folders stay in the vault.',
      'Remove all pins',
      () => {
        Modal.close();
        void clearPins().then(() => {
          renderTree();
          if (!pinnedItems().length) toast('Pins removed', 'ok');
        });
      },
    );
  };
  host.querySelector<HTMLButtonElement>('#sClearIdx')!.onclick = () => {
    clearTagIndex();
    state.tags.built = false;
    state.tags.index = null;
    toast('Tag index cache cleared', 'ok');
  };

  // ── activity log ─────────────────────────────────────────────────────
  void wireLogLimits(host);
}

/** The log limits form: load, presets, save (the server trims at once). */
async function wireLogLimits(host: HTMLElement): Promise<void> {
  const form = host.querySelector<HTMLFormElement>('#sLogForm');
  if (!form) return;
  const mbIn = host.querySelector<HTMLInputElement>('#sLogMb')!;
  const daysIn = host.querySelector<HTMLInputElement>('#sLogDays')!;
  const chips = Array.from(form.querySelectorAll<HTMLButtonElement>('[data-days]'));
  const syncChips = (): void => chips.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.days === daysIn.value)));
  const paint = (s: LogSettings): void => {
    const st = s.stats;
    const pct = st.max_bytes ? Math.min(100, (st.bytes / st.max_bytes) * 100) : 0;
    const bar = host.querySelector<HTMLElement>('#sLogBar');
    if (bar) bar.style.width = pct.toFixed(1) + '%';
    const since = st.oldest ? new Date(st.oldest * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const use = host.querySelector<HTMLElement>('#sLogUse');
    if (use)
      use.textContent = `${mb(st.bytes)} of ${s.max_mb} MB · ${st.lines.toLocaleString()} event${st.lines === 1 ? '' : 's'}${
        since ? ' · since ' + since : ''
      }${s.max_days ? ` · kept ${s.max_days} days` : ''}`;
  };
  const fill = (s: LogSettings): void => {
    mbIn.value = String(s.max_mb);
    daysIn.value = String(s.max_days);
    syncChips();
    paint(s);
  };
  chips.forEach((b) => {
    b.onclick = () => {
      daysIn.value = b.dataset.days || '0';
      syncChips();
      mark(host, '#sLogSt', '');
    };
  });
  daysIn.oninput = () => {
    syncChips();
    mark(host, '#sLogSt', '');
  };
  mbIn.oninput = () => mark(host, '#sLogSt', '');
  form.onsubmit = (e) => {
    e.preventDefault();
    const max_mb = Math.round(Number(mbIn.value));
    const max_days = Math.round(Number(daysIn.value));
    if (!(max_mb >= 1 && max_mb <= 512)) return mark(host, '#sLogSt', 'error', 'Size: 1 to 512 MB');
    if (!(max_days >= 0 && max_days <= 3650)) return mark(host, '#sLogSt', 'error', 'Days: 0 to 3650');
    const btn = host.querySelector<HTMLButtonElement>('#sLogSave')!;
    btn.disabled = true;
    mark(host, '#sLogSt', 'saving');
    void apiPost<LogSettings>('/api/logs/settings', { max_mb, max_days })
      .then((s) => {
        fill(s);
        mark(host, '#sLogSt', 'saved', 'Saved and trimmed');
      })
      .catch((err) => mark(host, '#sLogSt', 'error', (err as Error).message))
      .finally(() => (btn.disabled = false));
  };
  try {
    fill(await apiGet<LogSettings>('/api/logs/settings'));
  } catch (e) {
    const use = host.querySelector<HTMLElement>('#sLogUse');
    if (use) use.textContent = 'Could not read the log settings: ' + (e as Error).message;
  }
}
