// Settings: personal sections, then server (admin) sections. One section shows at a time; /settings#<slug> names one.

import { RELEASES_URL, takeSettingsSection, updateInfo } from '../version';
import { apiGet, apiPost } from '../api';
import { agentColor, setAgentColors } from '../control/agents';
import { setAccountName } from '../account';
import { $, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { icon } from '../ui/icons';
import { openWhatsNew } from '../ui/whats-new';
import { Modal } from '../modal';
import { RT } from '../realtime';
import { clearTagIndex, saveToastPrefs, saveUI, toastPrefs, ui } from '../storage';
import { state, type Page } from '../state';
import { clearPins, pinnedItems } from '../vault/store';
import { renderTree } from '../sidebar';
import { onNavigate } from '../router';
import { setThemePref, themePref, type ThemePref } from '../theme';
import { toast } from '../toast';
import { fadeScroll } from '../ui/scroll-fade';
import { fetchSettings, mountVaultForm, notesLabel, reloadVaultData } from '../vault';
import {
  ago,
  copyText,
  ICO,
  openDrawer,
  openMenu,
  openSheet,
  switchHTML,
  systemHeader,
  useControlStyles,
} from '../control/ui';
import type { AuthState, Config, KeyRow, KeysResult, OkResult, SettingsInfo } from '../types';
import { SYS_PAGE_CSS } from './tools';

/** The window listener that keeps the theme cards in step is added once. */
let themeSync = false;
/** Bumped on every render so a slower, older load cannot paint over a newer one. */
let renderSeq = 0;

const CSS = `
/* container query on the page, not the window: an open sidebar can leave a wide window with a narrow page */
.st-page{container:st/inline-size;max-width:1120px;margin:0 auto}
.st-page [hidden]{display:none!important}
.st-page a.btn{text-decoration:none}
.st-main{min-width:0;container:stm/inline-size}
.st-nav{min-width:0}
.st-nav-g{display:block;margin:0 0 8px;padding:0 4px;font-size:12.5px;font-weight:500;color:var(--muted)}
.st-nav-g.dz{color:var(--danger)}
.st-list{list-style:none;margin:0 0 24px;padding:0;background:var(--surface-1);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.st-list:last-child{margin-bottom:0}
.st-list li+li{border-top:1px solid var(--line)}
.st-nav a{display:flex;align-items:center;gap:14px;min-height:64px;padding:12px 14px 12px 16px;color:var(--fg);text-decoration:none;
  border:1px solid transparent;transition:background .15s,color .15s}
.st-nav a:hover{background:var(--hover);text-decoration:none}
.st-nav a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;box-shadow:none;border-radius:0}
.st-nav .ic{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;flex:none;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}
.st-nav .ic .i{width:18px;height:18px;stroke-width:1.7}
.st-nav .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.st-nav .tx b{font-size:14.5px;font-weight:550;letter-spacing:-.005em;color:var(--fg)}
.st-nav .tx small{font-size:12.5px;line-height:1.4;color:var(--muted)}
.st-nav .go{display:grid;place-items:center;flex:none;color:var(--text-3)}
.st-nav .go .i{width:16px;height:16px}
.st-nav .dz .ic{background:var(--danger-soft);color:var(--danger)}
.st-nav .dz .tx b{color:var(--danger)}
.st-up{display:inline-flex;align-items:center;gap:4px;height:36px;padding:0 12px 0 6px;margin:0 0 12px -6px;border-radius:9px;font-size:14px;font-weight:500;
  color:var(--text-2);background:none;border:0}
.st-up:hover{background:var(--hover);color:var(--fg)}
.st-up .i{width:18px;height:18px}
.st-sh{margin:0 0 20px}
.st-eye{display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin:0 0 6px}
.st-sec.dz .st-eye{color:var(--danger)}
.st-sh h2{margin:0;font-size:22px;font-weight:650;letter-spacing:-.02em;line-height:1.25;color:var(--fg);outline:none}
.st-sh h2:focus,.st-sh h2:focus-visible{box-shadow:none;outline:none}
.st-sh p{margin:6px 0 0;font-size:14px;line-height:1.5;color:var(--muted);max-width:68ch}
.st-card{background:var(--surface-1);border:1px solid var(--line);border-radius:14px;margin:0 0 16px;min-width:0}
.st-card:last-child{margin-bottom:0}
.st-ch{padding:20px 24px 16px}
.st-ch h3{margin:0;font-size:15px;font-weight:600;color:var(--fg);letter-spacing:-.005em}
.st-ch p{margin:3px 0 0;font-size:13px;line-height:1.5;color:var(--muted);max-width:68ch}
.st-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:10px 32px;padding:18px 24px;margin:0;border-top:1px solid var(--line);align-items:start}
.st-card>.st-row:first-child,.st-card>.st-me:first-child{border-top:0}
.st-row.full{grid-template-columns:minmax(0,1fr)}
.st-row.inl{grid-template-columns:minmax(0,1fr) auto;align-items:center}
.st-l{min-width:0}
.st-l b,.st-l label{display:block;font-size:14px;font-weight:550;color:var(--fg)}
.st-l small{display:block;font-size:13px;color:var(--muted);line-height:1.5;margin-top:3px;max-width:60ch}
.st-l small code{font:500 12px/1.5 var(--mono)}
.st-c{min-width:0}
.st-c.end{display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap}
.st-c .field{margin-bottom:12px}
.st-c .field>label{font-size:12.5px;font-weight:500;color:var(--text-2)}
.st-c .field input,.st-cf .field input{width:100%;box-sizing:border-box;height:40px;border-radius:10px;border:1px solid transparent;
  background:color-mix(in srgb,var(--fg) 5%,transparent);font-size:14px;transition:border-color .16s,background .16s}
.st-c .field input:hover{border-color:var(--line)}
.st-c .field input:focus,.st-cf .field input:focus{border-color:var(--line-strong);background:var(--surface-1);box-shadow:none}
.st-acts{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.st-page .btn{height:38px;border-radius:10px;padding:0 15px;font-weight:550;white-space:nowrap}
.st-page .btn:not(.primary):not(.danger):not(.ghost){background:var(--surface-1);border-color:var(--line-strong)}
.st-page .btn:not(.primary):not(.danger):not(.ghost):hover{background:var(--hover)}
.st-page .btn:disabled{opacity:.5}
.st-note{font-size:12.5px;color:var(--muted);margin:8px 0 0;line-height:1.5}
.st-copy{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;flex:none;color:var(--muted);background:none;border:0}
.st-copy:hover{background:var(--hover);color:var(--fg)}
.st-copy .cc-i{width:16px;height:16px}
.st-state{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:550;min-height:20px;overflow-wrap:anywhere}
.st-state:empty,.st-c:empty{display:none}
.st-state .i{width:15px;height:15px;flex:none}
.st-state[data-s=saving]{color:var(--muted)}
.st-state[data-s=saved]{color:var(--ok)}
.st-state[data-s=error]{color:var(--danger)}
.st-state .sp{width:13px;height:13px;border-radius:99px;border:2px solid currentColor;border-right-color:transparent;animation:stSpin .7s linear infinite}
@keyframes stSpin{to{transform:rotate(360deg)}}
.st-cf p{margin:0 0 12px;font-size:14px;line-height:1.55;color:var(--fg)}
.st-cf-keep{margin-top:14px;padding:12px 14px;border-radius:12px;background:color-mix(in srgb,var(--fg) 4%,transparent);font-size:13px;line-height:1.5;color:var(--text-2)}
.st-cf-keep.warn{background:color-mix(in srgb,var(--warn,#f59e0b) 10%,transparent);border:1px solid color-mix(in srgb,var(--warn,#f59e0b) 30%,transparent)}
.st-cf-keep b{display:block;margin-bottom:4px;color:var(--fg);font-weight:600}
.st-cf-keep p{margin:0}
.st-cf ul{margin:0 0 16px;padding-left:18px;font-size:13px;line-height:1.55;color:var(--text-2)}
.st-cf li+li{margin-top:4px}
.st-cf-paths{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 12px;margin:0 0 16px;padding:12px 0;
  border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:12.5px}
.st-cf-paths dt{color:var(--muted)}
.st-cf-paths dd{margin:0;min-width:0;font-family:var(--mono);word-break:break-all;color:var(--fg)}
.st-cf-paths dd small{display:block;font-family:var(--font);color:var(--text-2);margin-top:2px}
.st-cf code{font:500 12px/1.5 var(--mono);padding:1px 6px;border-radius:6px;background:var(--surface-2);color:var(--fg);overflow-wrap:anywhere}
.st-cf .field{margin:0}
.st-cf .field input{width:100%;box-sizing:border-box}
.st-back{margin-top:8px}
.st-back .btn{max-width:100%;white-space:normal;height:auto;min-height:32px;text-align:left;overflow-wrap:anywhere}
.st-me{display:flex;align-items:center;gap:14px;padding:20px 24px;border-top:1px solid var(--line)}
.st-av{display:grid;place-items:center;width:48px;height:48px;border-radius:14px;flex:none;font-size:18px;font-weight:650;
  background:linear-gradient(180deg,#17202e,#0b0f17);color:#5eead4;box-shadow:inset 0 0 0 1px rgba(94,234,212,.22)}
.st-me .who{min-width:0}
.st-me .who b{display:block;font-size:17px;font-weight:600;color:var(--fg);overflow-wrap:anywhere;letter-spacing:-.01em}
.st-me .who span{display:block;font-size:13px;line-height:1.45;color:var(--muted);margin-top:2px}
.st-theme{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;max-width:560px}
.st-theme button{position:relative;display:flex;flex-direction:column;align-items:stretch;gap:10px;padding:6px 6px 10px;border-radius:12px;min-width:0;
  border:1px solid var(--line-strong);background:var(--surface-1);text-align:left;color:var(--fg);transition:border-color .16s,background .16s}
.st-theme button:hover{background:var(--hover)}
.st-theme button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;box-shadow:none}
.st-theme button[aria-checked=true]{border-color:var(--fg);box-shadow:inset 0 0 0 1px var(--fg)}
.st-theme .pv{display:flex;height:72px;border-radius:8px;position:relative;overflow:hidden;border:1px solid rgba(127,127,127,.22)}
.st-theme .pv>span{flex:1;position:relative;display:flex;gap:4px;padding:6px;min-width:0}
.st-theme .pv .d{background:#07090e}
.st-theme .pv .l{background:#f4f6fa}
.st-theme .pv s{width:26%;border-radius:4px;background:#0d1118;flex:none}
.st-theme .pv .l s{background:#e8edf4}
.st-theme .pv u{flex:1;border-radius:4px;background:#0d1118;border:1px solid rgba(148,163,184,.13);position:relative;min-width:0}
.st-theme .pv .l u{background:#fff;border-color:rgba(15,23,42,.09)}
.st-theme .pv u::before{content:"";position:absolute;left:6px;top:7px;width:46%;height:4px;border-radius:4px;background:#e8ecf3}
.st-theme .pv .l u::before{background:#0f172a}
.st-theme .pv u::after{content:"";position:absolute;left:6px;top:16px;width:64%;height:3px;border-radius:4px;background:rgba(139,152,173,.45);
  box-shadow:0 7px 0 rgba(139,152,173,.3),0 14px 0 rgba(139,152,173,.2)}
.st-theme .pv s::before{content:"";display:block;margin:6px 4px 0;height:3px;border-radius:3px;background:linear-gradient(90deg,#5eead4,#22d3ee)}
.st-theme .lb{display:flex;align-items:center;gap:7px;min-width:0;font-size:13.5px;font-weight:550;padding:0 4px;white-space:nowrap}
.st-theme .lb>span{overflow:hidden;text-overflow:ellipsis}
.st-theme .lb .i{flex:none;width:16px;height:16px;color:var(--muted)}
.st-theme .ck{position:absolute;top:12px;right:12px;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--line-strong);
  display:grid;place-items:center;background:var(--surface-1)}
.st-theme button[aria-checked=true] .ck{background:var(--fg);border-color:var(--fg)}
.st-theme button[aria-checked=true] .ck::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--surface-1)}
.st-sess{display:flex;flex-direction:column;padding:0 24px 4px}
.st-ses{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line);min-height:60px}
.st-ses:first-child{border-top:0}
.st-ses .dv{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;flex:none;background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}
.st-ses .dv .i{width:18px;height:18px;stroke-width:1.7}
.st-ses.cur .dv{color:var(--fg)}
.st-ses .mn{flex:1;min-width:0}
.st-ses .nm{display:flex;align-items:center;gap:4px 8px;flex-wrap:wrap;font-size:14px;font-weight:550;color:var(--fg)}
.st-ses .nm span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-ses .mt{font-size:12.5px;color:var(--muted);margin-top:2px;line-height:1.5;overflow-wrap:anywhere}
.st-ses .mt em{font-style:normal;color:var(--text-3);padding:0 5px}
.st-ses .more{display:grid;place-items:center;width:36px;height:36px;border-radius:9px;flex:none;color:var(--text-2)}
.st-ses .more:hover{background:var(--hover);color:var(--fg)}
.st-ses .more .i{width:18px;height:18px}
.st-tag{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;color:var(--text-2)}
.st-tag::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ok)}
.st-empty{padding:8px 0 12px;font-size:13px;color:var(--muted)}
.st-tkeys{display:flex;flex-direction:column;padding:0 24px 6px;transition:opacity .15s}
.st-tkeys.off{opacity:.5}
.st-tk{display:flex;align-items:center;gap:12px;min-height:52px}
.st-tk+.st-tk{border-top:1px solid var(--line)}
.st-tk .dot{width:8px;height:8px;border-radius:50%;flex:none}
.st-tk .nm{flex:1;min-width:0;font-size:14px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-tk .nm em{font-style:normal;font-size:12px;color:var(--muted);margin-left:4px}
.st-tk .cc-sw:disabled{cursor:not-allowed}
.st-tk-empty{display:block;padding:4px 0 14px;font-size:13px;color:var(--muted)}
.st-card.st-dz{border-color:color-mix(in srgb,var(--danger) 35%,var(--line))}
.st-dz .st-l b{color:var(--danger)}
.st-vault{display:flex;align-items:flex-start;gap:8px 12px;flex-wrap:wrap}
.st-vault-txt{flex:1 1 220px;min-width:0}
.st-vault-path{display:flex;align-items:flex-start;gap:4px;font-family:var(--mono);font-size:13px;line-height:1.55;color:var(--fg)}
.st-vault-path>span{min-width:0;overflow-wrap:anywhere;padding-top:6px}
.st-vault .cc-pill{border:0;background:none;padding:6px 0 0;font-size:12.5px;font-weight:500;color:var(--text-2);white-space:nowrap}
.st-vault .cc-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--text-3)}
.st-vault .cc-pill.ok::before{background:var(--ok)}
.st-vault .cc-pill.warn::before{background:var(--warn)}
.st-vault .cc-pill.err::before{background:var(--danger)}
.st-page .vf .field input{height:40px;border-radius:10px}
.st-page .vf-suggest{border-radius:12px}
.st-page .vf-suggest-v{overflow-wrap:anywhere}
.st-figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:12px}
.st-figs>div{display:flex;flex-direction:column;gap:2px;min-width:0;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--fg) 4%,transparent)}
.st-figs small{font-size:12px;color:var(--muted)}
.st-figs b{font-size:17px;font-weight:600;color:var(--fg);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-figs span{font-size:12px;color:var(--muted)}
.lg-use-top{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;color:var(--muted)}
#sLogPct{font-weight:600;color:var(--text-2)}
.lg-use{display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--text-2)}
/* 32 cells cut out of the whole track by a mask, so the fill lines up with them at any width */
.lg-use-bar{height:10px;border-radius:4px;overflow:hidden;background:color-mix(in srgb,var(--fg) 8%,transparent);
  -webkit-mask-image:repeating-linear-gradient(90deg,#000 0 calc(100% / 32 - 3px),transparent calc(100% / 32 - 3px) calc(100% / 32));
  mask-image:repeating-linear-gradient(90deg,#000 0 calc(100% / 32 - 3px),transparent calc(100% / 32 - 3px) calc(100% / 32))}
.lg-use-bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .6s cubic-bezier(.2,.8,.2,1)}
.lg-lim{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:14px}
.lg-lim label{display:flex;flex-direction:column;gap:6px;font-size:12.5px;font-weight:500;color:var(--text-2)}
.lg-lim label span{display:flex;align-items:center;gap:8px;color:var(--muted);font-weight:400}
.lg-lim input{width:104px;height:40px;box-sizing:border-box;padding:0 12px;border-radius:10px;border:1px solid transparent;
  background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--fg);font-size:14px;font-variant-numeric:tabular-nums}
.lg-lim input:hover{border-color:var(--line)}
.lg-lim input:focus{outline:none;border-color:var(--line-strong);background:var(--surface-1)}
.lg-presets{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.lg-presets .chip{font-weight:500;font-size:13px}
.lg-presets .chip[aria-pressed=true]{background:var(--fg);border-color:var(--fg);color:var(--surface-0)}
.st-kv{display:grid;grid-template-columns:minmax(140px,max-content) minmax(0,1fr);gap:0;font-size:14px;margin:0}
.st-kv dt{display:flex;align-items:center;min-height:48px;color:var(--muted);padding:8px 24px;border-top:1px solid var(--line)}
.st-kv dd{display:flex;align-items:center;justify-content:flex-end;gap:4px;min-height:48px;margin:0;padding:8px 18px 8px 16px;border-top:1px solid var(--line);
  min-width:0;color:var(--fg);text-align:right}
.st-kv dd>span{min-width:0;overflow-wrap:anywhere;padding-right:6px}
.st-kv dd:has(.st-copy)>span{padding-right:0}
.st-kv dt:first-of-type,.st-kv dt:first-of-type+dd{border-top:0}
.st-kv .mono{font-family:var(--mono);font-size:13px}
.st-kv+.st-row{border-top:1px solid var(--line)}
.st-ver{font:500 14px/1.4 var(--mono);color:var(--fg)}
.st-upd{display:inline-flex;align-items:center;gap:7px;height:28px;font-size:13px;font-weight:500;color:var(--text-2);white-space:nowrap}
.st-upd::before{content:"";width:6px;height:6px;border-radius:50%;flex:none;background:var(--text-3)}
.st-upd.new{color:var(--fg)}.st-upd.new::before{background:var(--accent)}
.st-upd.ok::before{background:var(--ok)}
.st-upd.warn::before{background:var(--warn)}
.st-code{font-family:var(--mono);font-size:12px;background:color-mix(in srgb,var(--fg) 6%,transparent);border-radius:6px;padding:1px 6px;color:var(--fg);
  white-space:nowrap}
.st-act{list-style:none;margin:0;padding:0}
.st-act li{display:flex;gap:12px;padding:12px 0;border-top:1px solid var(--line);font-size:13.5px}
.st-act li:first-child{border-top:0}
.st-act .w{flex:none;width:86px;color:var(--muted);font-size:12.5px;padding-top:1px}
.st-act .e b{display:block;font-weight:600;color:var(--fg)}
.st-act .e span{display:block;color:var(--text-2);font-size:12.5px;margin-top:2px;word-break:break-word}
.st-act .e.bad b{color:var(--danger)}
.st-act-note{font-size:13px;color:var(--text-2);margin:0 0 12px;line-height:1.5}
.st-nav-tg{display:none}
@container st (min-width:780px){
  .st-layout{display:grid;grid-template-columns:212px minmax(0,1fr);gap:40px;align-items:start}
  .st-nav{position:sticky;top:16px;max-height:calc(100dvh - 140px);overflow-y:auto;overscroll-behavior:contain;padding:2px 2px 8px}
  .st-nav-g{margin:0 0 6px;padding:0 10px}
  .st-list{display:flex;flex-direction:column;gap:2px;margin:0 0 20px;background:none;border:0;border-radius:0;overflow:visible}
  .st-list li+li{border-top:0}
  .st-nav a{gap:11px;min-height:0;height:38px;padding:0 10px;border-radius:10px;color:var(--text-2)}
  .st-nav a:hover{color:var(--fg)}
  .st-nav a:focus-visible{border-radius:10px}
  .st-nav .ic{width:20px;height:20px;border-radius:0;background:none}
  .st-nav .tx b{font-size:14px;font-weight:500;color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .st-nav .tx small,.st-nav .go{display:none}
  .st-nav .dz .ic{background:none}
  .st-nav .dz .tx b{color:inherit}
  .st-nav a[aria-current=true]{color:#f1f5f9;background:linear-gradient(180deg,#1b2433,#0d121b);box-shadow:inset 0 0 0 1px rgba(94,234,212,.22)}
  .st-nav a[aria-current=true] .ic{color:#5eead4}
  .st-nav .dz a[aria-current=true] .ic{color:#fda4af}
  .st-nav a[aria-current=true] .tx b{font-weight:600}
  .st-up{display:none}
  .st-nav-tg{display:flex;align-items:center;gap:11px;width:100%;height:34px;margin:0 0 14px;padding:0 10px;border:0;border-radius:10px;background:none;
    font:inherit;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer}
  .st-nav-tg:hover{color:var(--fg);background:var(--hover)}
  .st-nav-tg:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
  .st-nav-tg .i{width:18px;height:18px;flex:none}
  .st-page.nav-mini{max-width:1280px}
  .st-page.nav-mini .st-layout{grid-template-columns:44px minmax(0,1fr);gap:28px}
  .st-page.nav-mini .st-nav-tg{width:44px;padding:0;justify-content:center}
  .st-page.nav-mini :is(.st-nav-tg span,.st-nav .tx){display:none}
  .st-page.nav-mini .st-nav-g{height:1px;margin:10px 10px;padding:0;overflow:hidden;font-size:0;background:var(--line)}
  .st-page.nav-mini .st-nav a{width:44px;padding:0;justify-content:center}
}
@container st (max-width:779.98px){
  .st-page[data-open="0"] .st-main{display:none}
  .st-page[data-open="1"] :is(.sys-head,.st-nav){display:none}
}
@container stm (max-width:560px){
  .st-ch{padding:16px 16px 12px}
  .st-row,.st-row.full{grid-template-columns:minmax(0,1fr);padding:16px;gap:12px}
  .st-row.inl{grid-template-columns:minmax(0,1fr)}
  .st-row.sw{grid-template-columns:minmax(0,1fr) auto}
  .st-c.end{justify-content:flex-start}
  .st-row.sw .st-c.end{justify-content:flex-end}
  .st-me{padding:16px}
  .st-sess,.st-tkeys{padding-left:16px;padding-right:16px}
  .st-theme{gap:8px}
  .st-theme .ck{display:none}
  .st-theme .pv{height:56px}
  .st-theme .lb{font-size:13px;padding:0 2px}
  .st-kv{grid-template-columns:minmax(0,1fr)}
  .st-kv dt{min-height:0;padding:12px 16px 0}
  .st-kv dd{min-height:0;justify-content:space-between;text-align:left;padding:2px 8px 10px 16px;border-top:0}
  .st-kv dt:first-of-type{border-top:0}
}
@container stm (max-width:340px){.st-theme .lb .i{display:none}}
@media (pointer:coarse){
  .st-page .btn{height:44px}
  .st-copy,.st-ses .more{width:44px;height:44px}
  .st-up{height:44px}
}
@media (max-width:760px){
  /* room for the floating tab bar at the end of the page */
  #view-settings{padding-bottom:calc(var(--dock-space,0px) + 24px)}
  .st-sh h2{font-size:21px}
  .st-sh{margin-bottom:16px}
}
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

function deviceIcon(s: SessionRow): string {
  return icon(isPhone(s.user_agent) ? 'note' : 'monitor');
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
  vault_changed: 'Notes folder switched',
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

/** A copy button for a long value; wired once per page by `[data-copy]`. */
function copyBtn(value: string, what: string): string {
  return `<button type="button" class="st-copy" data-copy="${esc(value)}" data-what="${esc(what)}" aria-label="Copy ${esc(what.toLowerCase())}" title="Copy">${ICO.copy}</button>`;
}

function vaultSummary(info: SettingsInfo): string {
  if (!info.vault) {
    return `<div class="st-vault"><div class="st-vault-txt"><div class="st-vault-path"><span>No notes folder is set yet</span></div></div><span class="cc-pill warn">Not set</span></div>`;
  }
  const s = info.stats;
  const n = (v: number): string => v.toLocaleString('en-US');
  const meta = s
    ? `<div class="st-figs"><div><small>Notes</small><b>${n(s.notes)}</b><span>Markdown files</span></div><div><small>Folders</small><b>${n(s.folders)}</b></div><div><small>Links</small><b>${n(
        s.links,
      )}</b><span>between notes</span></div></div>`
    : '<span class="st-note">Counting notes…</span>';
  const badge =
    info.vault_writable === false
      ? '<span class="cc-pill err">Read only</span>'
      : info.vault_writable === true
        ? '<span class="cc-pill ok" title="Memora can save notes here">Writable</span>'
        : '';
  return `<div class="st-vault"><div class="st-vault-txt"><div class="st-vault-path"><span>${esc(info.vault)}</span>${copyBtn(info.vault, 'Folder path')}</div>
    </div>${badge}</div>${meta}`;
}

type Group = 'personal' | 'server' | 'danger';

interface Section {
  /** Element id; other pages ask for these (requestSettingsSection). */
  id: string;
  /** The address part: /settings#<slug>. Never a page name (the router reads #<page>). */
  slug: string;
  label: string;
  icon: string;
  /** One line under the label in the phone index. */
  desc: string;
  group: Group;
}

/** Personal sections first, then the ones that change the server for everyone, then shut down. */
const SECTIONS: Section[] = [
  { id: 'stAppearance', slug: 'appearance', label: 'Appearance', icon: 'sun', desc: 'Dark, light or follow this device', group: 'personal' },
  { id: 'stAccount', slug: 'account', label: 'Account', icon: 'user', desc: 'Username, password and signed-in devices', group: 'personal' },
  { id: 'stInterface', slug: 'interface', label: 'Interface', icon: 'sidebar', desc: 'Sidebar, pins and tag suggestions', group: 'personal' },
  { id: 'stToasts', slug: 'notifications', label: 'Notifications', icon: 'bell', desc: 'Pop-ups when an agent works in your notes', group: 'personal' },
  { id: 'stVault', slug: 'notes-folder', label: 'Notes folder', icon: 'folder', desc: 'Where every note is kept on the server', group: 'server' },
  { id: 'stLogs', slug: 'activity-log', label: 'Activity log', icon: 'activity', desc: 'How much history the server keeps', group: 'server' },
  { id: 'stServer', slug: 'server', label: 'Server details', icon: 'monitor', desc: 'Addresses, folders and sign-in limits', group: 'server' },
  { id: 'stVersion', slug: 'version', label: 'Version', icon: 'refresh', desc: 'What is installed and how to update', group: 'server' },
  { id: 'stStop', slug: 'shut-down', label: 'Shut down', icon: 'logout', desc: 'Stop Memora on the machine it runs on', group: 'danger' },
];

const GROUP_LABEL: Record<Group, string> = { personal: 'Personal', server: 'Server (admin)', danger: 'Danger zone' };
/** The small line above a section title. */
const GROUP_EYE: Record<Group, string> = {
  personal: 'Personal',
  server: 'Server (admin) · applies to everyone',
  danger: 'Danger zone',
};

/** Page width (px) from which the index sits beside the section; matches the CSS container query. */
const WIDE_PX = 780;

function sectionOf(id: string | null | undefined): Section | undefined {
  return id ? SECTIONS.find((s) => s.id === id) : undefined;
}

/** The section an address hash names (#notifications, or an element id), if any. */
function sectionFromHash(hash: string): string | null {
  let h = hash.replace(/^#/, '');
  try {
    h = decodeURIComponent(h);
  } catch {
    return null;
  }
  h = h.toLowerCase();
  return SECTIONS.find((s) => s.slug === h || s.id.toLowerCase() === h)?.id ?? null;
}

const onSettingsPath = (): boolean => location.pathname.replace(/\/+$/, '') === '/settings';

/** A section named by the address the app was opened at (/settings#account), read before the router tidies the URL. */
let bootSection: string | null = onSettingsPath() ? sectionFromHash(location.hash) : null;
/** Back/forward between the index and a section: what the entry names (null = the index), for the next render. */
let popTarget: { id: string | null; pushed: boolean } | null = null;
/** The section open on a narrow page (null = the index); kept while Settings stays on screen. */
let openSection: string | null = null;
let navObserver: ResizeObserver | null = null;
/** The page controller of the current render, for back/forward without a reload. */
let live: { root: HTMLElement; show: (id: string | null, how: 'push' | 'replace', pushed?: boolean) => void } | null = null;

window.addEventListener('popstate', (e) => {
  if (!onSettingsPath()) return;
  const st = (e.state as { stSec?: string; stPushed?: boolean } | null) || null;
  const id = sectionOf(st?.stSec)?.id ?? sectionFromHash(location.hash);
  popTarget = { id, pushed: !!(id && st?.stPushed) };
});
// Coming back to Settings from another page starts at the index again.
onNavigate((p) => {
  if (p !== 'settings') openSection = null;
});

function secHead(id: string, sub: string): string {
  const s = sectionOf(id)!;
  return `<header class="st-sh"><span class="st-eye">${esc(GROUP_EYE[s.group])}</span><h2 id="${id}T" tabindex="-1">${esc(s.label)}</h2>${
    sub ? `<p>${esc(sub)}</p>` : ''
  }</header>`;
}

/** One section of the page; only the open one is shown. */
function section(id: string, sub: string, body: string): string {
  const s = sectionOf(id)!;
  return `<section class="st-sec${s.group === 'danger' ? ' dz' : ''}" id="${id}" aria-labelledby="${id}T" hidden>${secHead(id, sub)}${body}</section>`;
}

function card(body: string, o: { title?: string; sub?: string; cls?: string; id?: string } = {}): string {
  return `<div class="st-card${o.cls ? ' ' + o.cls : ''}"${o.id ? ` id="${o.id}"` : ''}>${
    o.title ? `<div class="st-ch"><h3>${o.title}</h3>${o.sub ? `<p>${o.sub}</p>` : ''}</div>` : ''
  }${body}</div>`;
}

/** A setting row: label | control. `cls`: `full` control below, `inl` short control beside, `sw` switch always beside. */
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

/** What has to be typed to confirm a shut down. */
const STOP_WORD = 'shut down';

/** Explain a shut down, then stop the server only after STOP_WORD is typed. */
async function askShutdown(): Promise<void> {
  const info = await apiGet<ShutdownInfo>('/api/server/shutdown').catch(() => ({}) as ShutdownInfo);
  const again =
    info.restarts === 'systemd'
      ? `<li>This server is run by systemd, which starts it again a few seconds later. To keep it stopped, run <code>${esc(info.stop || 'systemctl stop memora')}</code> on the server instead.</li>`
      : info.restarts === 'docker'
        ? `<li>This server runs in Docker, which may start it again. To keep it stopped, run <code>${esc(info.stop || 'docker stop memora')}</code> on the host instead.</li>`
        : '<li>To start it again, someone must run <code>memora-cli start</code> (or start its service) on the machine it runs on. This page cannot start it.</li>';
  Modal.open({
    title: 'Shut down the server?',
    body: `<div class="st-cf"><p>Memora stops on the machine it runs on. Your notes stay safe on disk.</p>
      <ul><li>You are disconnected, and so is every other browser.</li>
        <li>Every connected agent loses its memory until Memora runs again.</li>${again}</ul>
      <div class="field"><label for="sStopWord">Type <b>${STOP_WORD}</b> to confirm</label>
        <input id="sStopWord" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"></div></div>`,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'Shut down',
        cls: 'danger',
        run: (body) => {
          if (body.querySelector<HTMLInputElement>('#sStopWord')?.value.trim().toLowerCase() !== STOP_WORD) return;
          Modal.close();
          void apiPost<ShutdownInfo>('/api/server/shutdown', {})
            .then((r) => shutDownScreen(r.restarts ?? info.restarts ?? null))
            .catch((e: Error) => toast('Could not shut down: ' + e.message, 'err'));
        },
      },
    ],
    onOpen: (body) => {
      const input = body.querySelector<HTMLInputElement>('#sStopWord')!;
      const go = body.parentElement?.querySelector<HTMLButtonElement>('.modal-foot .btn.danger');
      const sync = (): void => {
        if (go) go.disabled = input.value.trim().toLowerCase() !== STOP_WORD;
      };
      // The Modal re-enables a button after each click; the field decides.
      go?.addEventListener('click', () => setTimeout(sync));
      input.oninput = sync;
      input.onkeydown = (e) => {
        if (e.key === 'Enter' && go && !go.disabled) go.click();
      };
      sync();
    },
  });
}

/** The shut-down notice: a full-screen layer over the app, in the theme. */
const OFF_CSS = `
.st-off{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:24px 16px calc(24px + var(--safe-b,0px));
  background:color-mix(in srgb,var(--bg) 88%,transparent);
  overflow:auto;outline:none;animation:st-off-in .2s var(--ease-out,ease-out)}
.st-off-card{width:min(520px,100%);box-sizing:border-box;padding:28px 28px 24px;border-radius:var(--r-xl,20px);border:1px solid var(--line-strong);
  background:var(--panel);color:var(--fg);box-shadow:none}
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

/** Cover the (now inert) app once the server is down; with a supervisor, reload when it is back. */
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

/** Same folder? Compares the way the server would see it (trailing slashes aside). */
function samePath(a: string, b: string): boolean {
  const n = (p: string): string => p.trim().replace(/[\\/]+$/, '');
  return n(a) === n(b);
}

/** Local checks, then a confirm dialog before a vault switch. Resolves true to switch, false when cancelled, or an error message. */
function confirmVaultSwitch(now: { vault: string | null; notes?: number }, path: string, create: boolean): Promise<boolean | string> {
  if (path.split(/[\\/]/).includes('..')) return Promise.resolve("The path must not contain '..'. Write the folder out in full.");
  if (now.vault && samePath(now.vault, path)) return Promise.resolve('Memora already uses this folder.');
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(v);
    };
    Modal.open({
      title: 'Switch to another notes folder?',
      body: `<div class="st-cf"><dl class="st-cf-paths">
          <dt>Now</dt><dd>${esc(now.vault || 'No folder set')}${now.vault ? `<small>${esc(notesLabel(now.notes))}</small>` : ''}</dd>
          <dt>New</dt><dd>${esc(path)}${create ? '<small>Created if it does not exist yet</small>' : ''}</dd></dl>
        <ul><li>Memora first checks that the new folder exists${create ? ' (or can be created)' : ''} and that it can save notes there. If the check fails, nothing changes.</li>
          <li>Then this app, every signed-in browser and every connected agent switch to the new folder at once.</li>
          <li>Notes in the current folder are not moved, copied or deleted. You can switch back here at any time.</li></ul>
        <div class="st-cf-keep${now.notes ? ' warn' : ''}"><b>${now.notes ? 'Everything but your agents changes with the folder' : 'What changes with the folder'}</b>
          <p>The Activity log, the Trash, version history and folder colours are kept inside each notes folder, so they switch too: the new folder shows its own (empty if it is new). Your account, connected agents and their access, pins and settings stay as they are. Switching back brings the old ones back.</p></div></div>`,
      actions: [
        {
          label: 'Cancel',
          cls: 'ghost',
          run: () => {
            answer(false);
            Modal.close();
          },
        },
        {
          label: 'Check and switch',
          cls: 'primary',
          run: () => {
            answer(true);
            Modal.close();
          },
        },
      ],
    });
    // Closed with Esc, the X or a click outside: treat as Cancel.
    const host = document.getElementById('modalHost');
    if (host) {
      const mo = new MutationObserver(() => {
        if (!host.childElementCount) {
          mo.disconnect();
          answer(false);
        }
      });
      mo.observe(host, { childList: true });
    }
  });
}

export async function renderSettings(): Promise<void> {
  useControlStyles();
  useStyles('settings-css-v5', SYS_PAGE_CSS + CSS);
  const host = $('#view-settings');
  // Back/forward between the index and a section: switch in place, no reload.
  const pop = popTarget;
  popTarget = null;
  if (pop && live && host.contains(live.root)) {
    live.show(pop.id, 'replace', pop.pushed);
    return;
  }
  if (pop) openSection = pop.id;
  const seq = ++renderSeq;

  // Always read fresh: these may have changed on another device or in the CLI.
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
          ? '<span class="d"><s></s><u></u></span><span class="l"><s></s><u></u></span>'
          : `<span class="${p === 'dark' ? 'd' : 'l'}"><s></s><u></u></span>`
      }</span>
      <span class="lb">${icon(THEME_ICON[p])}<span>${label}</span></span><span class="ck" aria-hidden="true"></span></button>`;

  const presets: [string, string][] = [
    ['7', '1 week'],
    ['30', '30 days'],
    ['90', '90 days'],
    ['365', '1 year'],
    ['0', 'No age limit'],
  ];

  const navItem = (s: Section): string =>
    `<li${s.group === 'danger' ? ' class="dz"' : ''}><a href="/settings#${s.slug}" data-sec="${s.id}" title="${esc(s.label)}">
      <span class="ic" aria-hidden="true">${icon(s.icon)}</span>
      <span class="tx"><b>${esc(s.label)}</b><small>${esc(s.desc)}</small></span>
      <span class="go" aria-hidden="true">${icon('chev-right')}</span></a></li>`;
  const navGroup = (g: Group): string =>
    `<span class="st-nav-g${g === 'danger' ? ' dz' : ''}" id="stNavG-${g}">${GROUP_LABEL[g]}</span>
     <ul class="st-list" aria-labelledby="stNavG-${g}">${SECTIONS.filter((s) => s.group === g)
       .map(navItem)
       .join('')}</ul>`;

  host.innerHTML = `<div class="cc st-page" data-open="0">${systemHeader('settings', 'Settings', 'Your own preferences first, then server settings that apply to everyone.')}
  <div class="st-layout">
    <nav class="st-nav" aria-label="Settings sections"><button type="button" class="st-nav-tg" id="stNavTg" aria-pressed="false">${icon('sidebar')}<span>Hide labels</span></button>${navGroup(
      'personal',
    )}${navGroup('server')}${navGroup('danger')}</nav>
    <div class="st-main">
    <button type="button" class="st-up" id="stUp">${icon('chev-left')}<span>Settings</span></button>

    ${section(
      'stAppearance',
      'How Memora looks for you. Saved in this browser only.',
      card(
        row(
          '<span id="stThemeL">Theme</span>',
          'Dark, light, or follow the setting of this device.',
          `<div class="st-theme" role="radiogroup" aria-labelledby="stThemeL">${themeBtn('dark', 'Dark')}${themeBtn('light', 'Light')}${themeBtn('system', 'System')}</div>`,
          { cls: 'full' },
        ),
      ),
    )}

    ${section(
      'stAccount',
      'Your account and the devices signed in to it.',
      card(
        `<div class="st-me"><span class="st-av" id="sAv" aria-hidden="true">${esc((user || '?').slice(0, 1).toUpperCase())}</span>
        <div class="who"><b id="sMeName">${esc(user || '-')}</b><span id="sMeSub">Signed in on this device</span></div></div>
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
      )}`,
      ) +
        card(
          `<div class="st-sess" id="sSess"><div class="st-empty">Loading…</div></div>
      ${row(
        'Sign out other devices',
        'End every session except this one. Those browsers must sign in again.',
        `<button class="btn danger" id="sOutOthers" type="button">${icon('logout')}Sign out others</button><span class="st-state" id="sOutSt" role="status" aria-live="polite"></span>`,
        { ctl: 'end', cls: 'inl' },
      )}
      ${row('Sign out here', 'End the session in this browser.', `<button class="btn danger" id="sLogout" type="button">${icon('logout')}Sign out</button>`, {
        ctl: 'end',
        cls: 'inl',
      })}`,
          {
            title: 'Signed-in devices',
            sub: 'Browsers signed in to your account. Tap ⋯ to name a device, see its sign-ins or sign it out. Connected agents are not listed here and keep working.',
            id: 'sSessRow',
          },
        ),
    )}

    ${section(
      'stInterface',
      'Preferences kept in this browser, unless a row says otherwise.',
      card(
        `${row(
          '<span id="sCollapsedL">Collapsed sidebar</span>',
          'Start with the sidebar panel collapsed.',
          switchHTML('sCollapsed', !!ui.collapsed, 'Start with the sidebar collapsed', ' aria-labelledby="sCollapsedL"'),
          { ctl: 'end', cls: 'inl sw' },
        )}
      ${row(
        'Pinned notes',
        'Pins are saved on the server and shared by every browser and device you sign in on. Removing them does not touch the notes.',
        '<button class="btn" id="sClearPins" type="button">Remove all pins</button>',
        { ctl: 'end', cls: 'inl' },
      )}
      ${row(
        'Tag suggestions',
        'Memora keeps a list of your tags to suggest them while you type. Refresh it if a tag is missing or out of date.',
        '<button class="btn" id="sClearIdx" type="button">Refresh the tag list</button>',
        { ctl: 'end', cls: 'inl' },
      )}`,
      ),
    )}

    ${section(
      'stToasts',
      'Pop-up notifications when an agent works in your notes. Kept in this browser.',
      card(
        row(
          '<span id="sToastsL">Agent activity pop-ups</span>',
          'The main switch. When it is off, no pop-up appears, even for agents turned on below.',
          switchHTML('sToasts', !toastPrefs.off, 'Agent activity pop-ups', ' aria-labelledby="sToastsL"'),
          { ctl: 'end', cls: 'inl sw' },
        ),
      ) +
        card('<div class="st-tkeys" id="sToastKeys" aria-live="polite"><span class="st-tk-empty">Loading agents…</span></div>', {
          title: 'Each agent',
          sub: 'Turn off the pop-ups of a single agent.',
          cls: 'st-keys-row',
        }),
    )}

    ${section(
      'stVault',
      'The server folder that holds every note as a file. This app and every agent use it.',
      card(
        `${row('Current folder', 'Where your notes are right now.', `<div id="sVaultNow">${vaultSummary({ vault: state.health.vault || cfg.vault || null, stats: state.stats.notes ? state.stats : undefined } as SettingsInfo)}</div>`)}
      ${row(
        'Use another folder',
        'Memora checks the folder and asks you to confirm before it switches. Nothing is moved or copied, and you can switch back here. Running in Docker? Use a folder mounted into the container.',
        '<div id="sVaultForm"><span class="st-note">Loading…</span></div>',
      )}`,
      ),
    )}

    ${section(
      'stLogs',
      'What agents and people did with your notes, kept on the server.',
      card(
        `${row(
          'Usage',
          'When a limit is reached, the oldest entries are removed first.',
          `<div class="lg-use"><div class="lg-use-top"><span id="sLogPct">Loading…</span><span id="sLogCap"></span></div><div class="lg-use-bar"><i id="sLogBar"></i></div>
            <div class="st-figs"><div><small>Used</small><b id="sLogUsed">–</b><span id="sLogOf"></span></div><div><small>Entries</small><b id="sLogN">–</b></div>
            <div><small>Oldest entry</small><b id="sLogSince">–</b></div><div><small>Kept for</small><b id="sLogKeep">–</b></div></div></div>`,
        )}
      ${row(
        'Limits',
        'A size limit in MB, and how many days to keep (0 keeps by size only). If the new limits are lower than what is stored, you are asked before older entries are removed.',
        `<div class="lg-lim">
           <label>Max size<span><input id="sLogMb" type="number" min="1" max="512" step="1" inputmode="numeric"> MB</span></label>
           <label>Keep for<span><input id="sLogDays" type="number" min="0" max="3650" step="1" inputmode="numeric"> days</span></label>
         </div>
         <div class="lg-presets" role="group" aria-label="Quick choices">${presets
           .map(([d, l]) => `<button type="button" class="chip" data-days="${d}" aria-pressed="false">${l}</button>`)
           .join('')}</div>
         <div class="st-acts"><button class="btn primary" id="sLogSave" type="submit">Save limits</button>
           <span class="st-state" id="sLogSt" role="status" aria-live="polite"></span></div>`,
        { form: true, id: 'sLogForm' },
      )}`,
      ),
    )}

    ${section(
      'stServer',
      'The server name and how long browsers stay signed in apply to everyone. The rest is shown for reference.',
      `${card(
        `${row(
          '<label for="sRealm">Server name</label>',
          'Shown on the sign-in page and in the browser tab. 1 to 64 characters.',
          `<div class="field"><input id="sRealm" type="text" maxlength="64" spellcheck="false" autocomplete="off"></div>`,
          { form: true, id: 'sSrvForm' },
        )}
        ${row(
          '<label for="sTtl">Sign out after inactivity</label>',
          'A browser left unused this long must sign in again. Connected agents are not affected.',
          '<div class="field"><select id="sTtl"></select></div>',
        )}
        ${row(
          '<label for="sMaxAge">Longest sign-in</label>',
          'Even in daily use, a browser signs in again after this long. It cannot be shorter than the inactivity time.',
          `<div class="field"><select id="sMaxAge"></select></div>
           <div class="st-acts"><button class="btn primary" id="sSrvSave" type="button" disabled>Save</button>
             <span class="st-state" id="sSrvSt" role="status" aria-live="polite"></span></div>`,
        )}`,
      )}${card('<dl class="st-kv" id="sServerKv"></dl>')}`,
    )}

    ${section(
      'stVersion',
      'Memora by Codrihub Tech',
      card(
        `<dl class="st-kv"><dt>Installed</dt><dd><span class="st-ver" id="sVerCur">v${esc(version || '-')}</span></dd>
        <dt>Latest release</dt><dd><span class="st-ver" id="sVerLatest">-</span></dd></dl>
      ${row(
        'Updates',
        '<span id="sVerHint">Checking for a newer release…</span>',
        `<span class="st-upd" id="sVerState">-</span><a class="btn" id="sVerLink" href="${RELEASES_URL}" target="_blank" rel="noopener noreferrer">Releases on GitHub</a>`,
        { ctl: 'end', cls: 'inl' },
      )}`,
      ) +
        card(
          `${row("What's new", 'The notes of each release, from 2.0.0 on.', `<button class="btn" id="sWhatsNew" type="button">What's new</button>`, {
            ctl: 'end',
            cls: 'inl',
          })}
      ${row('Documentation', 'Installing, connecting agents, settings and reference.', `<a class="btn" id="sDocs" href="/docs">Open documentation</a>`, {
            ctl: 'end',
            cls: 'inl',
          })}
      ${row(
        'How to update',
        'Updates run on the server, not in this page. Installed directly: run <code class="st-code">sudo memora-cli</code> and type <code class="st-code">/update</code>. With Docker: <code class="st-code">docker compose pull</code> &amp;&amp; <code class="st-code">docker compose up -d</code>.',
        '',
        { cls: 'full' },
      )}`,
        ),
    )}

    ${section(
      'stStop',
      'Stop Memora on the machine it runs on.',
      card(
        row(
          'Shut down the server',
          'Every browser and agent is disconnected until someone starts Memora again on that machine. This page cannot start it again.',
          `<button class="btn danger" id="sShutdown" type="button">${icon('logout')}Shut down…</button>`,
          { ctl: 'end', cls: 'inl' },
        ),
        { cls: 'st-dz' },
      ),
    )}
    </div>
  </div></div>`;

  // Server info
  const paintServer = (info: SettingsFull | null): void => {
    const ttl = info?.session_ttl || Number(cfg.session_ttl) || 0;
    const maxAge = info?.session_max_age || 0;
    // Plain labels; the technical value stays visible for whoever runs the server.
    const rows: [string, string, boolean][] = [
      ['Version', version ? 'v' + version : '-', false],
      ['Server name', cfg.realm || st.realm || '-', false],
      ['Address for agents', location.origin + '/mcp', true],
      ['Notes folder', info?.vault || state.health.vault || cfg.vault || 'Not set', true],
      ['Memora data folder', info?.state_dir || '-', true],
      ['Sign out after inactivity', ttl ? span(ttl) : '-', false],
      ['Longest sign-in', maxAge ? span(maxAge) : 'No limit', false],
      [
        'Sign-in protection',
        st.locked ? 'Locked after too many attempts' : st.armed ? 'Setup or reset window open' : 'Normal',
        false,
      ],
    ];
    const kv = host.querySelector<HTMLElement>('#sServerKv');
    if (kv)
      kv.innerHTML = rows
        .map(
          ([k, v, mono]) =>
            `<dt>${esc(k)}</dt><dd${mono ? ' class="mono"' : ''}><span>${esc(v)}</span>${mono && v !== '-' && v !== 'Not set' ? copyBtn(v, k) : ''}</dd>`,
        )
        .join('');
  };
  paintServer(null);

  // Server name and sign-in limits: the only server details an admin edits here.
  const TTLS: [number, string][] = [
    [1800, '30 minutes'],
    [3600, '1 hour'],
    [10800, '3 hours'],
    [28800, '8 hours'],
    [86400, '1 day'],
    [604800, '7 days'],
    [2592000, '30 days'],
  ];
  const MAX_AGES: [number, string][] = [
    [0, 'No limit'],
    [86400, '1 day'],
    [604800, '7 days'],
    [2592000, '30 days'],
    [7776000, '90 days'],
  ];
  const realmIn = host.querySelector<HTMLInputElement>('#sRealm')!;
  const ttlIn = host.querySelector<HTMLSelectElement>('#sTtl')!;
  const maxIn = host.querySelector<HTMLSelectElement>('#sMaxAge')!;
  const srvSave = host.querySelector<HTMLButtonElement>('#sSrvSave')!;
  let srv = { realm: String(cfg.realm || st.realm || 'Memora'), ttl: Number(cfg.session_ttl) || 10800, max: 0 };
  const fillSel = (sel: HTMLSelectElement, opts: [number, string][], v: number): void => {
    const list = opts.some(([x]) => x === v) ? opts : [...opts, [v, span(v)] as [number, string]].sort((a, b) => (a[0] || Infinity) - (b[0] || Infinity));
    sel.innerHTML = list.map(([x, l]) => `<option value="${x}"${x === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
  };
  const fillSrv = (): void => {
    realmIn.value = srv.realm;
    fillSel(ttlIn, TTLS, srv.ttl);
    fillSel(maxIn, MAX_AGES, srv.max);
    srvSave.disabled = true;
  };
  const srvDirty = (): void => {
    const ttl = Number(ttlIn.value);
    const max = Number(maxIn.value);
    const bad = !realmIn.value.trim() || (max !== 0 && max < ttl);
    srvSave.disabled = bad || (realmIn.value.trim() === srv.realm && ttl === srv.ttl && max === srv.max);
    mark(host, '#sSrvSt', bad && max !== 0 && max < ttl ? 'error' : '', bad && max !== 0 && max < ttl ? 'Longest sign-in must be at least the inactivity time' : '');
  };
  [realmIn, ttlIn, maxIn].forEach((x) => x.addEventListener('input', srvDirty));
  host.querySelector<HTMLFormElement>('#sSrvForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!srvSave.disabled) srvSave.click();
  });
  srvSave.onclick = () =>
    void (async () => {
      srvSave.disabled = true;
      mark(host, '#sSrvSt', 'saving', 'Saving…');
      try {
        const r = await apiPost<{ realm: string; session_ttl: number; session_max_age: number }>('/api/settings/server', {
          realm: realmIn.value.trim(),
          session_ttl: Number(ttlIn.value),
          session_max_age: Number(maxIn.value),
        });
        srv = { realm: r.realm, ttl: r.session_ttl, max: r.session_max_age };
        cfg.realm = r.realm;
        cfg.session_ttl = r.session_ttl;
        fillSrv();
        mark(host, '#sSrvSt', 'saved', 'Saved');
        toast('Server settings saved', 'ok');
        void fetchSettings()
          .then((f) => paintServer(f as SettingsFull))
          .catch(() => paintServer(null));
      } catch (err) {
        mark(host, '#sSrvSt', 'error', (err as Error).message);
        srvDirty();
      }
    })();
  fillSrv();
  void fetchSettings()
    .then((f) => {
      const full = f as SettingsFull;
      if (full?.session_max_age != null) srv.max = full.session_max_age;
      if (full?.session_ttl) srv.ttl = full.session_ttl;
      fillSrv();
    })
    .catch(() => undefined);

  // Version
  host.querySelector<HTMLElement>('#sWhatsNew')?.addEventListener('click', () => openWhatsNew());
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

  // Sections: the index and the one open section
  const page = host.querySelector<HTMLElement>('.st-page')!;
  const nav = host.querySelector<HTMLElement>('.st-nav')!;
  const navLinks = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-sec]'));
  const sections = Array.from(host.querySelectorAll<HTMLElement>('.st-sec'));
  fadeScroll(nav);
  const wide = (): boolean => page.clientWidth >= WIDE_PX;
  /** Mark the shown section in the index (on a narrow page only while one is open). */
  const paintNav = (): void => {
    const vis = openSection ?? SECTIONS[0].id;
    const mark = wide() || !!openSection;
    navLinks.forEach((a) => {
      if (mark && a.dataset.sec === vis) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  };
  /** Keep the address in step: /settings#<slug> while a section is chosen. */
  const stamp = (id: string | null, how: 'push' | 'replace', pushed = false): void => {
    if (state.page !== 'settings' || !onSettingsPath()) return;
    const s = sectionOf(id);
    const url = '/settings' + (s ? '#' + s.slug : '');
    const data = s ? { page: 'settings', stSec: s.id, stPushed: how === 'push' || pushed } : { page: 'settings' };
    try {
      if (how === 'push') history.pushState(data, '', url);
      else history.replaceState(data, '', url);
    } catch {
      /* sandboxed frames can refuse history writes */
    }
  };
  /** Show a section (null = the index on a narrow page, the first section on a wide one). */
  const show = (id: string | null, how: 'push' | 'replace', pushed = false): void => {
    openSection = sectionOf(id)?.id ?? null;
    const vis = openSection ?? SECTIONS[0].id;
    page.dataset.open = openSection ? '1' : '0';
    sections.forEach((s) => (s.hidden = s.id !== vis));
    paintNav();
    stamp(openSection, how, pushed);
  };
  const focusHeading = (id: string): void => host.querySelector<HTMLElement>(`#${id}T`)?.focus({ preventScroll: true });
  const focusLink = (id: string | null): void => {
    const a = navLinks.find((x) => x.dataset.sec === id) || navLinks[0];
    a?.focus({ preventScroll: true });
  };
  navLinks.forEach((a) => {
    a.onclick = (e) => {
      // A new tab or window keeps the plain link.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault();
      const id = a.dataset.sec!;
      const w = wide();
      // Narrow: a section is a step forward, so Back returns to the index.
      show(id, w || openSection === id ? 'replace' : 'push');
      host.scrollTop = 0;
      if (!w) focusHeading(id);
    };
  });
  // Wide page: the section index can fold to icons (remembered in this browser).
  const navTg = host.querySelector<HTMLButtonElement>('#stNavTg')!;
  const setMini = (on: boolean): void => {
    host.querySelector('.st-page')?.classList.toggle('nav-mini', on);
    navTg.setAttribute('aria-pressed', String(on));
    navTg.title = on ? 'Show section names' : 'Hide section names for a wider page';
    navTg.querySelector('span')!.textContent = on ? 'Show labels' : 'Hide labels';
  };
  let mini = false;
  try {
    mini = localStorage.getItem('memora.settings.navMini') === '1';
  } catch {
    /* storage blocked */
  }
  setMini(mini);
  navTg.onclick = () => {
    mini = !mini;
    setMini(mini);
    try {
      localStorage.setItem('memora.settings.navMini', mini ? '1' : '0');
    } catch {
      /* storage blocked */
    }
  };
  host.querySelector<HTMLButtonElement>('#stUp')!.onclick = () => {
    const was = openSection;
    if ((history.state as { stPushed?: boolean } | null)?.stPushed) {
      history.back();
      return;
    }
    show(null, 'replace');
    host.scrollTop = 0;
    focusLink(was);
  };
  navObserver?.disconnect();
  navObserver = new ResizeObserver(() => paintNav());
  navObserver.observe(page);
  host.onscroll = null;

  // Open the section another page asked for, else the one in the boot address, else the one still open.
  const asked = takeSettingsSection();
  const start = sectionOf(asked)?.id ?? bootSection ?? openSection;
  bootSection = null;
  show(start, 'replace', !!pop?.pushed && start === pop.id);
  page.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
    if (b) void copyText(b.dataset.copy || '', `${b.dataset.what || 'Value'} copied`);
  });
  live = {
    root: page,
    show: (id, how, pushed) => {
      const was = openSection;
      show(id, how, pushed);
      host.scrollTop = 0;
      if (id && !wide()) focusHeading(id);
      else if (!id) focusLink(was);
    },
  };

  // Appearance
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

  // Account: username
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

  // Account: password
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
        mark(host, '#sPwSt0', 'saved', 'Password changed' + (n ? `. ${plural(n, 'other device')} signed out.` : '.'));
        toast('Password changed', 'ok');
        void loadSessions();
      } catch (err) {
        mark(host, '#sPwSt', 'error', (err as Error).message);
      } finally {
        btn.disabled = false;
      }
    })();
  };

  // Account: signed-in devices
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
      <span class="dv" aria-hidden="true">${deviceIcon(s)}</span>
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
      } since it signed in on ${esc(dateTime(s.created_at))}. Note changes and agent work are in Activity.</p>
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
      { title: sessionTitle(s) + (s.current ? ' (this device)' : ''), lead: deviceIcon(s) },
    );
  };

  outOthers.onclick = () => {
    const n = sessions.filter((s) => !s.current).length;
    Modal.confirm(
      'Sign out other devices?',
      `${plural(n, 'other device')} will be signed out and must sign in again. This device stays signed in. Connected agents keep working.`,
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

  // Vault
  void infoP.then((full) => {
    const info = (full || {}) as SettingsFull;
    if (seq !== renderSeq || !host.contains($('#sVaultNow'))) return;
    if (info.user && info.user !== user) showUser(info.user);
    syncUserForm();
    paintServer(full ? info : null);
    $('#sVaultNow').innerHTML = vaultSummary(info.vault !== undefined ? info : { vault: state.health.vault || cfg.vault || null });
    // Kept current so the confirm dialog and "Switch back" name the right folder.
    let now: { vault: string | null; notes?: number } = { vault: info.vault ?? null, notes: info.stats?.notes };
    mountVaultForm($('#sVaultForm'), {
      id: 'sv',
      suggested: info.vault_suggested,
      current: info.vault,
      submitLabel: 'Check and switch…',
      confirm: (path, create) => confirmVaultSwitch(now, path, create),
      onDone: async (res) => {
        const prev = now.vault;
        now = { vault: res.vault || null, notes: res.stats?.notes };
        ($('#svPath') as unknown as HTMLInputElement).value = '';
        ($('#svCreate') as unknown as HTMLInputElement).checked = false;
        $('#sVaultNow').innerHTML = vaultSummary({ vault: res.vault, stats: res.stats, vault_writable: true });
        const err = $('#svErr');
        err.className = 'vf-ok';
        err.innerHTML = `${esc(`Checked and switched. Now using ${res.vault}${res.created ? ' (created)' : ''}: ${notesLabel(res.stats?.notes)}.`)}${
          prev && prev !== res.vault ? `<div class="st-back"><button type="button" class="btn sm" id="svBack">Switch back to ${esc(prev)}</button></div>` : ''
        }`;
        err.querySelector<HTMLButtonElement>('#svBack')?.addEventListener('click', () => {
          const input = $('#svPath') as unknown as HTMLInputElement;
          input.value = prev || '';
          ($('#svForm') as unknown as HTMLFormElement).requestSubmit();
        });
        await reloadVaultData();
        void fetchSettings()
          .then((f) => paintServer(f as SettingsFull))
          .catch(() => undefined);
        toast('Notes folder switched', 'ok');
      },
    });
  });

  // Interface
  const sw = host.querySelector<HTMLButtonElement>('#sCollapsed')!;
  sw.onclick = () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    ui.collapsed = on;
    saveUI();
    toast(on ? 'The sidebar starts collapsed' : 'The sidebar starts open', 'ok', 1800);
  };
  // Notifications
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
    toast(toastPrefs.off ? 'Agent pop-ups are off' : 'Agent pop-ups are on', 'ok', 1800);
  };
  void apiGet<KeysResult | KeyRow[]>('/api/keys')
    .then((d) => {
      if (seq !== renderSeq) return;
      const rows = Array.isArray(d) ? d : d.keys || [];
      // The dots use the same colours as the avatars everywhere else.
      setAgentColors(rows);
      if (!rows.length) {
        tBox.innerHTML = '<span class="st-tk-empty">No agents connected yet.</span>';
        return;
      }
      tBox.innerHTML = rows
        .map((k, i) => {
          const name = k.name || k.id;
          return `<div class="st-tk"><span class="dot" style="background:${esc(agentColor(name, k.id))}"></span><span class="nm" id="sTk${i}">${esc(name)}${
            k.enabled === false ? ' <em>turned off</em>' : ''
          }</span>${switchHTML('sTkSw' + i, true, 'Pop-ups for ' + name, ` aria-labelledby="sTk${i}" data-key="${esc(k.id)}"`)}</div>`;
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
      if (seq === renderSeq) tBox.innerHTML = '<span class="st-tk-empty">The agent list could not be loaded. Reload the page to try again.</span>';
    });

  host.querySelector<HTMLButtonElement>('#sClearPins')!.onclick = () => {
    Modal.confirm(
      'Remove all pins?',
      'The Pinned list empties on every browser and device. The notes and folders themselves stay where they are.',
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
    toast('Tag list cleared. It is rebuilt the next time tags are used.', 'ok');
  };

  // Activity log
  void wireLogLimits(host);
}

/** Would these limits remove stored entries right away? */
function logDate(ts: number | null): string {
  return ts ? new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function trimsNow(cur: LogSettings['stats'] | null, maxMb: number, maxDays: number): boolean {
  if (!cur || !cur.lines) return false;
  if (cur.bytes > maxMb * 1024 * 1024) return true;
  return !!(maxDays && cur.oldest && cur.oldest < Date.now() / 1000 - maxDays * 86400);
}

/** The log limits form: load, presets, save (the server trims at once, so a save that removes entries asks first). */
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
    // Whole cells, and at least one as soon as anything is stored.
    const cells = st.bytes > 0 ? Math.max(1, Math.round((pct / 100) * 32)) : 0;
    const bar = host.querySelector<HTMLElement>('#sLogBar');
    if (bar) bar.style.width = ((cells / 32) * 100).toFixed(3) + '%';
    const since = logDate(st.oldest);
    const put = (id: string, v: string): void => {
      const e = host.querySelector<HTMLElement>('#' + id);
      if (e) e.textContent = v;
    };
    put('sLogPct', `${pct < 1 && st.bytes > 0 ? 'Under 1' : Math.round(pct)}% used`);
    put('sLogCap', `Limit ${s.max_mb} MB`);
    put('sLogUsed', mb(st.bytes));
    put('sLogOf', `of ${s.max_mb} MB`);
    put('sLogN', st.lines.toLocaleString());
    put('sLogSince', since || 'None yet');
    put('sLogKeep', s.max_days ? plural(s.max_days, 'day') : 'No age limit');
  };
  let stats: LogSettings['stats'] | null = null;
  const fill = (s: LogSettings): void => {
    stats = s.stats;
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
    const trims = trimsNow(stats, max_mb, max_days);
    const save = (): void => {
      btn.disabled = true;
      mark(host, '#sLogSt', 'saving');
      void apiPost<LogSettings>('/api/logs/settings', { max_mb, max_days })
        .then((s) => {
          fill(s);
          mark(host, '#sLogSt', 'saved', trims ? 'Saved. Older entries were removed.' : 'Saved');
        })
        .catch((err) => mark(host, '#sLogSt', 'error', (err as Error).message))
        .finally(() => (btn.disabled = false));
    };
    if (!trims || !stats) return save();
    const since = logDate(stats.oldest);
    Modal.confirm(
      'Remove older activity now?',
      `The log holds ${stats.lines.toLocaleString()} entries (${mb(stats.bytes)}${since ? ', since ' + since : ''}). With a limit of ${max_mb} MB${
        max_days ? ` and ${plural(max_days, 'day')}` : ''
      }, the oldest entries are removed right away to fit. They cannot be brought back.`,
      'Save and remove',
      () => {
        Modal.close();
        save();
      },
    );
  };
  try {
    fill(await apiGet<LogSettings>('/api/logs/settings'));
  } catch (e) {
    const pct = host.querySelector<HTMLElement>('#sLogPct');
    if (pct) pct.textContent = 'Could not read the log settings: ' + (e as Error).message;
  }
}
