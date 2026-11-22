// Storage health: a calm banner when notes, images or chats near their room, the Storage
// section of Settings (use and limits per kind) and the Images gallery (every image, where it
// is used, the pictures kept for Mnemo chats).

import { apiGet, apiPost } from '../api';
import { attr, el, esc, useStyles } from '../dom';
import { hooks } from '../hooks';
import { Modal } from '../modal';
import { openMnemoAll } from '../router';
import { toast } from '../toast';
import { icon } from '../ui/icons';
import { openLightbox } from '../ui/lightbox';
import { requestSettingsSection } from '../version';
import { openOnPage } from '../assistant/page';
import { t, tn } from '../i18n';
import { ts } from '../i18n/server';

export type StoreKind = 'notes' | 'images' | 'chats';
type Level = 'ok' | 'almost' | 'full';

interface KindHealth {
  kind: StoreKind;
  used_bytes: number;
  count: number;
  room_bytes: number;
  room: 'limit' | 'disk' | 'unknown';
  limit_mb: number | null;
  percent: number;
  level: Level;
  message: string | null;
}

export interface StorageHealth {
  at: number;
  kinds: KindHealth[];
  warnings: StoreKind[];
  disk: { free_bytes: number; total_bytes: number } | null;
  limits: { notes_mb?: number; images_mb?: number; chats_mb?: number };
}

/** Ask for a fresh check (after an image upload, from anywhere). */
export const STORAGE_CHECK = 'memora:storage-check';

const KIND_LABEL: Record<StoreKind, string> = { notes: t('Notes'), images: t('Images'), chats: t('Chats') };
/** "12 notes", "1 image". */
function countText(kind: StoreKind, n: number): string {
  const v = { n: n.toLocaleString('en-US') };
  if (kind === 'notes') return tn(n, '{n} note', '{n} notes', v);
  if (kind === 'images') return tn(n, '{n} image', '{n} images', v);
  return tn(n, '{n} chat', '{n} chats', v);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}

let last: StorageHealth | null = null;
const listeners = new Set<(h: StorageHealth) => void>();

function got(h: StorageHealth): StorageHealth {
  last = h;
  listeners.forEach((f) => f(h));
  return h;
}

export function loadHealth(fresh = false): Promise<StorageHealth> {
  return apiGet<StorageHealth>(`/api/storage/health${fresh ? '?fresh=1' : ''}`).then(got);
}

export function saveLimits(b: { notes_mb?: number | null; images_mb?: number | null; chats_mb?: number | null }): Promise<StorageHealth> {
  return apiPost<StorageHealth>('/api/storage/health', b).then(got);
}

/** Open the place that frees room for `kind`. */
export function manageStorage(kind: StoreKind): void {
  if (kind === 'chats') {
    openMnemoAll();
    hooks.go('assistant');
    return;
  }
  requestSettingsSection(kind === 'images' ? 'stImages' : 'stStorage');
  hooks.go('settings');
}

// ---- the banner ----

const LS_DISMISS = 'memora.storage.dismissed.v1';
const DAY = 86_400_000;
const RANK: Record<Level, number> = { ok: 0, almost: 1, full: 2 };

function dismissed(): Record<string, { level: Level; at: number }> {
  try {
    return JSON.parse(localStorage.getItem(LS_DISMISS) || '{}') as Record<string, { level: Level; at: number }>;
  } catch {
    return {};
  }
}

function dismiss(list: KindHealth[]): void {
  const d = dismissed();
  for (const k of list) d[k.kind] = { level: k.level, at: Date.now() };
  try {
    localStorage.setItem(LS_DISMISS, JSON.stringify(d));
  } catch {
    /* shown again next visit */
  }
}

/** Kinds to warn about now: not ok, and not put away (unless worse since, or a day ago). */
function toShow(h: StorageHealth): KindHealth[] {
  const d = dismissed();
  return h.kinds.filter((k) => {
    if (k.level === 'ok' || !h.warnings.includes(k.kind)) return false;
    const x = d[k.kind];
    return !x || RANK[k.level] > RANK[x.level] || Date.now() - x.at > DAY;
  });
}

function lineText(k: KindHealth): string {
  const v = { kind: KIND_LABEL[k.kind], pct: Math.round(k.percent) };
  return k.level === 'full' ? t('{kind} storage is full: {pct}% used.', v) : t('{kind} storage is almost full: {pct}% used.', v);
}

function paintBanner(h: StorageHealth): void {
  const main = document.getElementById('main');
  const views = document.getElementById('views');
  if (!main || !views) return;
  let bar = document.getElementById('stoBanner');
  const list = toShow(h);
  if (!list.length) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = el('div', 'sto-ban');
    bar.id = 'stoBanner';
    bar.setAttribute('role', 'status');
    views.before(bar);
  }
  const full = list.some((k) => k.level === 'full');
  bar.classList.toggle('full', full);
  bar.innerHTML = `<div class="sto-ban-l">${list
    .map(
      (k) =>
        `<div class="sto-ban-i" data-k="${k.kind}">${icon('alert')}<span title="${attr(ts(k.message || ''))}">${esc(lineText(k))}</span><button type="button" class="sto-ban-a" data-manage="${k.kind}">${t('Manage')}</button></div>`,
    )
    .join('')}</div><button type="button" class="sto-ban-x" aria-label="${t('Dismiss')}" title="${t('Dismiss')}">${icon('close')}</button>`;
  bar.querySelectorAll<HTMLElement>('[data-manage]').forEach((b) => {
    b.onclick = () => manageStorage(b.dataset.manage as StoreKind);
  });
  bar.querySelector<HTMLElement>('.sto-ban-x')!.onclick = () => {
    dismiss(list);
    bar?.remove();
  };
}

let started = false;

/** Check on load, every 10 minutes and after uploads; the banner follows. */
export function initStorageBanner(): void {
  if (started) return;
  started = true;
  useStyles('storage-css', CSS);
  listeners.add(paintBanner);
  const check = (fresh: boolean): void => void loadHealth(fresh).catch(() => undefined);
  check(false);
  window.setInterval(() => {
    if (!document.hidden) check(false);
  }, 600_000);
  let t = 0;
  window.addEventListener(STORAGE_CHECK, () => {
    window.clearTimeout(t);
    t = window.setTimeout(() => check(true), 1500);
  });
}

// ---- Settings: Storage ----

export function storageSectionHTML(): string {
  return `<div class="st-card"><div id="stoKinds" class="sto-kinds"><span class="st-note">${t('Measuring…')}</span></div></div>`;
}

function kindRow(k: KindHealth): string {
  const room = k.room === 'limit' ? t('limit') : k.room === 'disk' ? t('free disk') : t('room unknown');
  const of = k.room_bytes ? ' ' + t('of {size} ({room})', { size: fmtBytes(k.room_bytes), room }) : '';
  const pct = Math.max(0, Math.min(100, k.percent));
  return `<div class="sto-k" data-k="${k.kind}">
    <div class="sto-k-h"><b>${KIND_LABEL[k.kind]}</b><span class="sto-k-p lv-${k.level}">${Math.round(k.percent)}%</span></div>
    <div class="sto-bar lv-${k.level}" role="progressbar" aria-label="${t('{kind} storage', { kind: KIND_LABEL[k.kind] })}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="sto-k-f"><small>${fmtBytes(k.used_bytes)}${of} · ${countText(k.kind, k.count)}</small>
      <label class="sto-lim">${t('Limit')}<span><input type="number" min="0" step="1" inputmode="numeric" data-lim="${k.kind}" value="${k.limit_mb ? attr(String(k.limit_mb)) : ''}" placeholder="${t('None')}" aria-label="${t('{kind} limit in MB', { kind: KIND_LABEL[k.kind] })}"> MB</span></label></div>
    ${k.message && k.level !== 'ok' ? `<p class="sto-k-m lv-${k.level}">${esc(ts(k.message))}</p>` : ''}
  </div>`;
}

export async function wireStorageSection(host: HTMLElement): Promise<void> {
  useStyles('storage-css', CSS);
  const box = host.querySelector<HTMLElement>('#stoKinds');
  if (!box) return;
  const paint = (h: StorageHealth): void => {
    if (!document.body.contains(box)) return;
    const active = document.activeElement as HTMLInputElement | null;
    if (active && box.contains(active) && active.dataset.lim) return;
    box.innerHTML =
      h.kinds.map(kindRow).join('') +
      `<p class="st-note">${t('Each kind is measured against its own room: its limit when set, else what it uses plus the free disk space{disk}. Empty limit: none.', {
        disk: h.disk ? ` (${t('{free} free of {total}', { free: fmtBytes(h.disk.free_bytes), total: fmtBytes(h.disk.total_bytes) })})` : '',
      })}</p>`;
    box.querySelectorAll<HTMLInputElement>('[data-lim]').forEach((inp) => {
      inp.onchange = async () => {
        const v = inp.value.trim();
        const mb = v === '' ? null : Math.max(0, Math.round(Number(v)));
        if (mb !== null && !Number.isFinite(mb)) return toast(t('Type a number of MB, or leave it empty'), 'err');
        try {
          await saveLimits({ [`${inp.dataset.lim}_mb`]: mb || null });
          inp.blur();
          toast(
            mb
              ? t('{kind} limited to {n} MB', { kind: KIND_LABEL[inp.dataset.lim as StoreKind], n: mb })
              : t('No limit for {kind}', { kind: KIND_LABEL[inp.dataset.lim as StoreKind].toLowerCase() }),
            'ok',
          );
        } catch (e) {
          toast((e as Error).message, 'err');
        }
      };
    });
  };
  listeners.add(paint);
  if (last) paint(last);
  try {
    await loadHealth(true);
  } catch (e) {
    box.innerHTML = `<span class="st-note">${t('Could not measure the storage: {error}', { error: esc((e as Error).message) })}</span>`;
  }
}

// ---- Settings: Images gallery ----

interface GalleryImage {
  path: string;
  name: string;
  folder: string;
  bytes: number;
  mtime: number;
  url: string;
  used_in: { note: string; heading?: string }[];
}
interface ChatImage {
  id: string;
  url: string;
  name: string;
  bytes: number;
  chats: { id: string; title: string }[];
}
interface AllImages {
  images: GalleryImage[];
  bytes: number;
  chat_images: ChatImage[];
}

const PAGE = 60;

export function galleryHTML(): string {
  return `<div class="st-card sto-gal" id="stoGal"><div class="st-ch"><h3>${t('All images')}</h3><p>${t('Every image in the notes folder and where it is shown, and the pictures kept for Mnemo chats.')}</p></div>
    <div class="sto-gal-b"><span class="st-note">${t('Opens when you scroll here.')}</span></div></div>`;
}

export function wireGallery(host: HTMLElement): void {
  useStyles('storage-css', CSS);
  const card = host.querySelector<HTMLElement>('#stoGal');
  if (!card) return;
  const body = card.querySelector<HTMLElement>('.sto-gal-b')!;
  let data: AllImages | null = null;
  let filter: 'all' | 'unused' | 'chat' = 'all';
  let sort: 'new' | 'big' = 'new';
  let shown = PAGE;
  const load = async (): Promise<void> => {
    body.innerHTML = `<span class="st-note">${t('Loading images…')}</span>`;
    try {
      data = await apiGet<AllImages>('/api/vault/images/all');
      paint();
    } catch (e) {
      body.innerHTML = `<span class="st-note">${t('Could not list the images: {error}', { error: esc((e as Error).message) })}</span>`;
    }
  };
  const tile = (src: string, name: string, meta: string, used: string, attrs: string, del = ''): string =>
    `<div class="sto-t"${attrs}><button type="button" class="sto-t-img" data-open title="${attr(name)}" aria-label="${attr(t('Open {name}', { name }))}"><img alt="" loading="lazy" src="${attr(
      src,
    )}" onerror="this.parentElement.classList.add('gone')"></button><div class="sto-t-b"><b title="${attr(name)}">${esc(name)}</b><small>${esc(meta)}</small>${used}</div>${del}</div>`;
  const paint = (): void => {
    if (!data) return;
    const vault = data.images.slice().sort((a, b) => (sort === 'big' ? b.bytes - a.bytes : b.mtime - a.mtime));
    const unused = vault.filter((i) => !i.used_in.length);
    const chats = data.chat_images.slice().sort((a, b) => (sort === 'big' ? b.bytes - a.bytes : 0));
    const total = filter === 'chat' ? chats.length : filter === 'unused' ? unused.length : vault.length;
    const seg = (v: typeof filter, label: string, n: number): string =>
      `<button type="button" role="radio" aria-checked="${filter === v}" class="${filter === v ? 'on' : ''}" data-f="${v}">${label} <span>${n}</span></button>`;
    let tiles = '';
    if (filter === 'chat') {
      tiles = chats
        .slice(0, shown)
        .map((c) =>
          tile(
            c.url,
            c.name || t('Picture'),
            fmtBytes(c.bytes),
            `<div class="sto-used">${
              c.chats.length
                ? c.chats.map((x) => `<button type="button" class="sto-link" data-chat="${attr(x.id)}" title="${attr(x.title)}">${esc(x.title || t('Chat'))}</button>`).join('')
                : `<span class="sto-none">${t('No chat')}</span>`
            }</div>`,
            ` data-src="${attr(c.url)}"`,
          ),
        )
        .join('');
    } else {
      const list = filter === 'unused' ? unused : vault;
      tiles = list
        .slice(0, shown)
        .map((i) =>
          tile(
            i.url,
            i.name,
            `${fmtBytes(i.bytes)} · ${i.folder || t('Top level')}`,
            `<div class="sto-used">${
              i.used_in.length
                ? i.used_in
                    .slice(0, 3)
                    .map(
                      (u) =>
                        `<button type="button" class="sto-link" data-note="${attr(u.note)}" title="${attr(u.note + (u.heading ? ' › ' + u.heading : ''))}">${esc(
                          u.note.split('/').pop()!.replace(/\.md$/i, ''),
                        )}</button>`,
                    )
                    .join('') + (i.used_in.length > 3 ? `<small>+${i.used_in.length - 3}</small>` : '')
                : `<span class="sto-none">${t('Not used')}</span>`
            }</div>`,
            ` data-src="${attr(i.url)}" data-path="${attr(i.path)}"`,
            `<button type="button" class="sto-del" data-del title="${t('Delete image')}" aria-label="${t('Delete {name}', { name: attr(i.name) })}">${icon('trash')}</button>`,
          ),
        )
        .join('');
    }
    body.innerHTML = `<div class="sto-gal-bar"><div class="sto-seg" role="radiogroup" aria-label="${t('Show')}">${seg('all', t('All'), vault.length)}${seg('unused', t('Not used'), unused.length)}${seg(
      'chat',
      t('Chat pictures'),
      chats.length,
    )}</div><div class="sto-seg" role="radiogroup" aria-label="${t('Sort')}"><button type="button" role="radio" aria-checked="${sort === 'new'}" class="${sort === 'new' ? 'on' : ''}" data-s="new">${t('Newest')}</button><button type="button" role="radio" aria-checked="${
      sort === 'big'
    }" class="${sort === 'big' ? 'on' : ''}" data-s="big">${t('Largest')}</button></div><small class="sto-gal-n">${t('{size} in the notes folder', { size: fmtBytes(data.bytes) })}</small></div>
      ${tiles ? `<div class="sto-grid">${tiles}</div>` : `<p class="st-note">${filter === 'unused' ? t('Every image is used in a note.') : filter === 'chat' ? t('No pictures kept for chats.') : t('No images yet.')}</p>`}
      ${total > shown ? `<button type="button" class="btn sm sto-more" data-more>${t('Show more ({n} left)', { n: total - shown })}</button>` : ''}`;
  };
  body.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    const f = tg.closest<HTMLElement>('[data-f]');
    if (f) {
      filter = f.dataset.f as typeof filter;
      shown = PAGE;
      return paint();
    }
    const s = tg.closest<HTMLElement>('[data-s]');
    if (s) {
      sort = s.dataset.s as typeof sort;
      shown = PAGE;
      return paint();
    }
    if (tg.closest('[data-more]')) {
      shown += PAGE;
      return paint();
    }
    const note = tg.closest<HTMLElement>('[data-note]');
    if (note) return hooks.openNote(note.dataset.note!);
    const chat = tg.closest<HTMLElement>('[data-chat]');
    if (chat) {
      openOnPage(chat.dataset.chat!);
      hooks.go('assistant');
      return;
    }
    const tileEl = tg.closest<HTMLElement>('.sto-t');
    if (!tileEl) return;
    if (tg.closest('[data-del]')) {
      const path = tileEl.dataset.path!;
      const img = data?.images.find((x) => x.path === path);
      const n = img?.used_in.length || 0;
      Modal.confirm(
        t('Delete this image?'),
        n
          ? n === 1
            ? t('One note shows this image; it will show as missing there. The version history keeps it.')
            : t('{n} notes show this image; it will show as missing there. The version history keeps it.', { n })
          : t('The image file is deleted. The version history keeps it.'),
        t('Delete image'),
        async () => {
          try {
            await apiPost('/api/vault/image/delete', { path });
            Modal.close();
            toast(t('Image deleted'), 'ok');
            if (data) data.images = data.images.filter((x) => x.path !== path);
            paint();
            window.dispatchEvent(new Event(STORAGE_CHECK));
          } catch (err) {
            toast((err as Error).message, 'err');
          }
        },
      );
      return;
    }
    if (tg.closest('[data-open]')) {
      const tiles = Array.from(body.querySelectorAll<HTMLElement>('.sto-t'));
      const set = tiles.map((x) => ({ src: x.dataset.src!, caption: x.querySelector('b')?.textContent || '' }));
      openLightbox(tileEl.dataset.src!, tileEl.querySelector('b')?.textContent || '', set, Math.max(0, tiles.indexOf(tileEl)));
    }
  });
  // The list loads once the card is on screen (the Images section is opened).
  const io = new IntersectionObserver((entries) => {
    if (entries.some((x) => x.isIntersecting)) {
      io.disconnect();
      void load();
    }
  });
  io.observe(card);
}

const CSS = `
.sto-ban{display:flex;align-items:flex-start;gap:8px;flex:none;margin:6px 12px 0;padding:8px 8px 8px 14px;border-radius:12px;font-size:13px;line-height:1.45;color:var(--fg);
  border:1px solid color-mix(in srgb,var(--warn,#d97706) 35%,transparent);background:color-mix(in srgb,var(--warn,#d97706) 10%,var(--surface-0,var(--bg)))}
.sto-ban.full{border-color:color-mix(in srgb,var(--danger) 45%,transparent);background:color-mix(in srgb,var(--danger) 12%,var(--surface-0,var(--bg)))}
.sto-ban-l{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.sto-ban-i{display:flex;align-items:center;gap:8px;min-width:0;min-height:30px;flex-wrap:wrap}
.sto-ban-i .i{width:15px;height:15px;flex:none;color:var(--warn,#d97706)}
.sto-ban.full .sto-ban-i .i{color:var(--danger)}
.sto-ban-i span{min-width:0}
.sto-ban-a{flex:none;height:26px;padding:0 10px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface-0,var(--bg));color:var(--fg);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.sto-ban-a:hover{background:var(--hover)}
.sto-ban-x{display:grid;place-items:center;flex:none;width:30px;height:30px;border:0;border-radius:8px;background:none;color:var(--muted);cursor:pointer}
.sto-ban-x:hover{background:var(--hover);color:var(--fg)}
.sto-ban-x .i{width:15px;height:15px}
@media (max-width:760px){.sto-ban{margin:6px 8px 0}}
.sto-kinds{display:flex;flex-direction:column;gap:18px;padding:16px 20px 18px}
.sto-k{display:flex;flex-direction:column;gap:7px}
.sto-k-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.sto-k-h b{font-size:14px;font-weight:600}
.sto-k-p{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--muted)}
.sto-bar{height:8px;border-radius:99px;overflow:hidden;background:color-mix(in srgb,var(--fg) 8%,transparent)}
.sto-bar i{display:block;height:100%;border-radius:inherit;background:var(--accent);transition:width .4s var(--ease-out,ease-out)}
.sto-bar.lv-almost i{background:var(--warn,#d97706)}.sto-bar.lv-full i{background:var(--danger)}
.sto-k-p.lv-almost,.sto-k-m.lv-almost{color:var(--warn,#d97706)}.sto-k-p.lv-full,.sto-k-m.lv-full{color:var(--danger)}
.sto-k-f{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.sto-k-f small{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.sto-k-m{margin:0;font-size:12.5px}
.sto-lim{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted)}
.sto-lim span{display:inline-flex;align-items:center;gap:6px}
.sto-lim input{width:96px;height:34px;padding:0 10px;border:1px solid var(--line-strong);border-radius:8px;background:var(--field-bg,var(--surface-0));color:var(--fg);font:inherit;font-size:13px}
.sto-lim input:focus{outline:none;border-color:var(--accent-line,var(--accent));box-shadow:0 0 0 3px var(--accent-soft)}
@media (max-width:640px){.sto-kinds{padding:14px 16px}.sto-lim input{font-size:16px}}
.sto-gal-b{padding:0 20px 18px}
.sto-gal-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.sto-seg{display:inline-flex;gap:2px;padding:3px;border-radius:10px;background:var(--seg-track,color-mix(in srgb,var(--fg) 6%,transparent))}
.sto-seg button{height:30px;padding:0 10px;border:0;border-radius:8px;background:none;color:var(--muted);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.sto-seg button span{opacity:.75;font-variant-numeric:tabular-nums}
.sto-seg button.on{background:var(--seg-thumb,var(--surface-0));color:var(--fg);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.1)}
.sto-gal-n{margin-left:auto;font-size:12px;color:var(--muted)}
/* The gallery: every tile the same square card whatever the picture's shape (cover-cropped),
   its name and size on a soft dark fade at the bottom, Pinterest-like; where it is used and
   Delete come up on hover or focus (always shown on touch screens). */
.sto-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}
.sto-t{position:relative;aspect-ratio:1/1;min-width:0;border-radius:14px;overflow:hidden;isolation:isolate;
  background:color-mix(in srgb,var(--fg) 6%,var(--surface-0,var(--bg)));box-shadow:0 0 0 1px color-mix(in srgb,var(--line) 70%,transparent)}
.sto-t-img{position:absolute;inset:0;display:block;width:100%;height:100%;padding:0;border:0;background:none;cursor:zoom-in}
.sto-t-img img{display:block;width:100%;height:100%;object-fit:cover;transition:transform .5s cubic-bezier(.22,.8,.24,1)}
.sto-t-img.gone img{display:none}
.sto-t-img:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:14px}
.sto-t-b{position:absolute;inset:auto 0 0 0;display:flex;flex-direction:column;gap:3px;min-width:0;padding:36px 11px 10px;pointer-events:none;color:#fff;
  background:linear-gradient(to top,rgba(8,10,14,.82) 0%,rgba(8,10,14,.5) 45%,rgba(8,10,14,0) 100%);transition:padding .3s cubic-bezier(.22,.8,.24,1)}
.sto-t-b b{font-size:12.5px;font-weight:620;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.35)}
.sto-t-b small{font-size:11px;color:rgba(255,255,255,.72);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sto-used{display:flex;flex-wrap:nowrap;gap:4px;align-items:center;min-width:0;overflow:hidden;pointer-events:auto;
  max-height:0;opacity:0;margin-top:0;transition:max-height .3s cubic-bezier(.22,.8,.24,1),opacity .2s,margin-top .3s}
.sto-used>small{flex:none;color:rgba(255,255,255,.75)}
.sto-link{flex:0 1 auto;min-width:0;max-width:100%;padding:2px 7px;border:0;border-radius:6px;background:rgba(255,255,255,.18);color:#fff;font:inherit;font-size:11px;
  cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:background .15s}
.sto-link:hover{background:rgba(255,255,255,.3)}
.sto-link:focus-visible{outline:2px solid #fff;outline-offset:1px}
.sto-none{flex:none;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:600;color:#fcd34d;background:rgba(252,211,77,.18)}
.sto-del{position:absolute;top:8px;right:8px;z-index:1;display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:9px;color:#fff;cursor:pointer;
  background:rgba(8,10,14,.45);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:0;transform:translateY(-4px);transition:opacity .2s,transform .25s,background .15s}
.sto-del .i{width:15px;height:15px}
.sto-del:hover{background:var(--danger,#dc2626)}
.sto-del:focus-visible{opacity:1;transform:none;outline:2px solid #fff;outline-offset:1px}
.sto-t:is(:hover,:focus-within) .sto-t-img img{transform:scale(1.045)}
.sto-t:is(:hover,:focus-within) .sto-used{max-height:26px;opacity:1;margin-top:3px}
.sto-t:is(:hover,:focus-within) .sto-del{opacity:1;transform:none}
@media (hover:none){.sto-used{max-height:26px;opacity:1;margin-top:3px}.sto-del{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sto-t-img img,.sto-t-b,.sto-used,.sto-del{transition:none}.sto-t:hover .sto-t-img img{transform:none}}
.sto-more{margin-top:12px}
@media (max-width:640px){.sto-gal-b{padding:0 16px 16px}.sto-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sto-gal-n{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.sto-bar i{transition:none}}
`;
