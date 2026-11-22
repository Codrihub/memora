// Images beside notes: upload, folder and note galleries, and the image viewer.
// An image is shown in a note with ![alt](path:name) and always lives in the note's folder.

import { apiGet, apiPost } from '../api';
import { attr, el, esc, useStyles } from '../dom';
import { Modal } from '../modal';
import { toast } from '../toast';
import { I } from './icons';
import { apiFolder, ROOT_LABEL } from './store';

export interface ImageUse {
  note: string;
  title: string;
  heading: string | null;
}

export interface VaultImage {
  path: string;
  name: string;
  folder: string;
  bytes: number;
  mtime: number;
  url: string;
  used_in: ImageUse[];
  heading?: string | null;
}

export interface NoteImages {
  note: string;
  folder: string;
  images: VaultImage[];
  folder_images: VaultImage[];
}

export interface Uploaded {
  path: string;
  name: string;
  bytes: number;
  url: string;
  markdown: string;
}

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** Set by the gallery so the reader scrolls to an image once the note is drawn. */
let pending: { note: string; name: string } | null = null;

/** Open handler, set by the vault so this module needs no import of the router. */
let openNote: (path: string) => void = () => undefined;

export function setImageNoteOpener(fn: (path: string) => void): void {
  openNote = fn;
}

/** The image the reader should bring into view for `note`, once. */
export function takePendingImage(note: string): string | null {
  if (!pending || pending.note !== note) return null;
  const name = pending.name;
  pending = null;
  return name;
}

export function openNoteAtImage(note: string, name: string): void {
  pending = { note, name };
  Modal.close(true);
  openNote(note);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export async function uploadImage(note: string, file: Blob, name?: string): Promise<Uploaded> {
  const fname = name || (file instanceof File && file.name ? file.name : 'pasted-image.png');
  const res = await fetch(`/api/vault/image?note=${encodeURIComponent(note)}&name=${encodeURIComponent(fname)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as Partial<Uploaded> & { error?: string };
  if (!res.ok) throw new Error(data.error || `could not upload (HTTP ${res.status})`);
  // Storage health is checked again (the banner follows).
  window.dispatchEvent(new Event('memora:storage-check'));
  return data as Uploaded;
}

export function folderImages(folder: string): Promise<{ images: VaultImage[] }> {
  return apiGet(`/api/vault/images?folder=${encodeURIComponent(apiFolder(folder))}`);
}

export function noteImages(note: string): Promise<NoteImages> {
  return apiGet(`/api/vault/images?note=${encodeURIComponent(note)}`);
}

function usedLabel(img: VaultImage): string {
  const n = img.used_in.length;
  return n === 0 ? 'Not shown in a note' : n === 1 ? 'In 1 note' : `In ${n} notes`;
}

/** A grid of thumbnails; a click opens the viewer. `changed` runs after a delete. */
export function galleryGrid(images: VaultImage[], empty: string, changed?: () => void): HTMLElement {
  useStyles('vx-gallery', CSS);
  const grid = el('div', 'vx-gal');
  if (!images.length) {
    grid.classList.add('empty');
    grid.innerHTML = `<p class="vx-gal-empty">${I.image}<span>${esc(empty)}</span></p>`;
    return grid;
  }
  grid.innerHTML = images
    .map(
      (img, i) =>
        `<button type="button" class="vx-gal-i" data-i="${i}" style="--i:${Math.min(i, 16)}" title="${attr(img.name)}">
          <span class="vx-gal-th"><img loading="lazy" decoding="async" alt="${attr(img.name)}" src="${attr(img.url)}"></span>
          <span class="vx-gal-cap"><b>${esc(img.name)}</b><small>${esc(fmtBytes(img.bytes))} · ${esc(usedLabel(img))}</small></span>
        </button>`,
    )
    .join('');
  grid.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.vx-gal-i');
    const img = b && images[Number(b.dataset.i)];
    if (img) openImageViewer(img, changed);
  };
  return grid;
}

/** The viewer: the image, its details and the notes (and sections) that show it. */
export function openImageViewer(img: VaultImage, changed?: () => void): void {
  useStyles('vx-gallery', CSS);
  const body = el('div', 'vx-iv');
  const md = `![${img.name.replace(/\.[^.]+$/, '')}](path:${img.name})`;
  body.innerHTML = `<figure class="vx-iv-fig"><img alt="${attr(img.name)}" src="${attr(img.url)}"></figure>
    <dl class="vx-iv-meta">
      <div><dt>Folder</dt><dd>${esc(img.folder || ROOT_LABEL)}</dd></div>
      <div><dt>Size</dt><dd>${esc(fmtBytes(img.bytes))}<span data-dim></span></dd></div>
      <div><dt>In notes</dt><dd>${img.used_in.length}</dd></div>
    </dl>
    <h4 class="vx-iv-h">Shown in</h4>
    ${
      img.used_in.length
        ? `<div class="vx-iv-uses">${img.used_in
            .map(
              (u, i) =>
                `<button type="button" class="vx-iv-use" data-u="${i}">${I.note}<span><b>${esc(u.title)}</b><small>${esc(
                  u.heading ? `Section: ${u.heading}` : 'Before the first heading',
                )}</small></span>${I.caret}</button>`,
            )
            .join('')}</div>`
        : '<p class="vx-iv-none">No note of this folder shows it yet. Add the line below to a note in the same folder.</p>'
    }
    <div class="vx-iv-md"><code>${esc(md)}</code><button type="button" class="btn sm ghost" data-copy>${I.copy}<span>Copy</span></button></div>`;
  const pic = body.querySelector<HTMLImageElement>('.vx-iv-fig img')!;
  pic.onload = () => {
    body.querySelector('[data-dim]')!.textContent = ` · ${pic.naturalWidth} × ${pic.naturalHeight}`;
  };
  body.querySelectorAll<HTMLElement>('[data-u]').forEach((b) => {
    b.onclick = () => {
      const u = img.used_in[Number(b.dataset.u)];
      if (u) openNoteAtImage(u.note, img.name);
    };
  });
  body.querySelector<HTMLElement>('[data-copy]')!.onclick = () => {
    void navigator.clipboard?.writeText(md).then(
      () => toast('Image line copied', 'ok'),
      () => toast('Could not copy', 'err'),
    );
  };
  Modal.open({
    title: img.name,
    sub: 'Image',
    body,
    wide: true,
    actions: [
      {
        label: 'Delete image',
        cls: 'danger ghost',
        run: () => {
          const shown = img.used_in.length;
          Modal.confirm(
            'Delete this image?',
            shown
              ? `${shown === 1 ? 'One note shows' : `${shown} notes show`} this image; it will show as missing there. The version history keeps it.`
              : 'The image file is deleted. The version history keeps it.',
            'Delete image',
            async () => {
              try {
                await apiPost('/api/vault/image/delete', { path: img.path });
                Modal.close();
                toast('Image deleted', 'ok');
                changed?.();
              } catch (e) {
                toast((e as Error).message, 'err');
              }
            },
          );
        },
      },
      { label: 'Open original', cls: 'ghost', run: () => window.open(img.url, '_blank', 'noopener') },
      { label: 'Close', cls: 'primary', run: () => Modal.close() },
    ],
  });
}

const CSS = `
.vx-gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.vx-gal.empty{display:block}
.vx-gal-empty{display:flex;align-items:center;gap:10px;margin:0;padding:18px 4px;font-size:13.5px;color:var(--muted)}
.vx-gal-empty .vx-i{width:18px;height:18px;flex:none}
.vx-gal-i{display:flex;flex-direction:column;gap:8px;padding:0;border:0;background:none;text-align:left;cursor:pointer;color:var(--fg);font:inherit;
  animation:vxGalIn .35s var(--ease,ease-out) both;animation-delay:calc(var(--i) * 30ms)}
.vx-gal-th{display:block;aspect-ratio:4/3;border-radius:12px;overflow:hidden;background:var(--panel-2);border:1px solid var(--line);transition:border-color .15s,transform .2s}
.vx-gal-th img{display:block;width:100%;height:100%;object-fit:cover}
.vx-gal-i:hover .vx-gal-th{border-color:var(--accent-line,var(--line-strong));transform:translateY(-2px)}
.vx-gal-i:focus-visible{outline:none}.vx-gal-i:focus-visible .vx-gal-th{outline:2px solid var(--accent);outline-offset:2px}
.vx-gal-cap{display:flex;flex-direction:column;gap:2px;min-width:0;padding:0 2px}
.vx-gal-cap b{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-gal-cap small{font-size:11.5px;color:var(--muted)}
@keyframes vxGalIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.vx-gal-i{animation:none}.vx-gal-th{transition:none}}
.vx-iv{display:flex;flex-direction:column;gap:14px}
.vx-iv-fig{margin:0;display:grid;place-items:center;max-height:min(56vh,560px);border-radius:12px;overflow:hidden;background:color-mix(in srgb,var(--fg) 4%,transparent)}
.vx-iv-fig img{display:block;max-width:100%;max-height:min(56vh,560px);object-fit:contain}
.vx-iv-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0}
.vx-iv-meta>div{padding:10px 12px;border-radius:10px;background:var(--panel-2)}
.vx-iv-meta dt{font-size:11.5px;color:var(--muted)}.vx-iv-meta dd{margin:2px 0 0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-iv-h{margin:4px 0 -4px;font-size:12px;font-weight:600;color:var(--muted)}
.vx-iv-uses{display:flex;flex-direction:column;gap:4px}
.vx-iv-use{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:none;color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.vx-iv-use:hover{background:var(--hover);border-color:var(--line-strong)}
.vx-iv-use>span{flex:1;display:flex;flex-direction:column;min-width:0}
.vx-iv-use b{font-size:13px;font-weight:600}.vx-iv-use small{font-size:12px;color:var(--muted)}
.vx-iv-use .vx-i{width:16px;height:16px;flex:none;color:var(--muted)}
.vx-iv-none{margin:0;font-size:13px;color:var(--muted)}
.vx-iv-md{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;border-radius:10px;background:var(--panel-2)}
.vx-iv-md code{flex:1;min-width:0;font-family:var(--mono);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:640px){.vx-iv-meta{grid-template-columns:1fr 1fr}}
`;
