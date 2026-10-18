// Small UI primitives for the vault: context menu, undo toast, inline rename
// and the folder picker / folder look dialogs.

import { el, esc, attr } from '../dom';
import { Modal } from '../modal';
import { notify } from '../toast';
import { SWATCH_COLORS } from '../icons';
import { colorPickHTML, wireColorPick } from '../ui/color-pick';
import { I, FOLDER_ICONS, folderGlyph } from './icons';

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  icon?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  run?: () => void;
  sep?: boolean;
}

let menuEl: HTMLElement | null = null;
let menuCleanup: (() => void) | null = null;

export function closeMenu(): void {
  if (menuCleanup) menuCleanup();
  menuCleanup = null;
  menuEl?.remove();
  menuEl = null;
}

/** Open a menu at a point (mouse) or under an element (keyboard). */
export function openMenu(items: MenuItem[], at: { x: number; y: number } | HTMLElement): void {
  closeMenu();
  const prevFocus = document.activeElement as HTMLElement | null;
  const m = el('div', 'vx-menu');
  m.setAttribute('role', 'menu');
  for (const it of items) {
    if (it.sep) {
      m.appendChild(el('div', 'vx-menu-sep'));
      continue;
    }
    const b = el(
      'button',
      'vx-menu-item' + (it.danger ? ' danger' : ''),
      `${it.icon || '<span class="vx-i"></span>'}<span class="vx-menu-label">${esc(it.label)}</span>${
        it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''
      }`,
    );
    b.setAttribute('role', 'menuitem');
    b.disabled = !!it.disabled;
    b.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      it.run?.();
    };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  menuEl = m;
  let x: number;
  let y: number;
  if (at instanceof HTMLElement) {
    const r = at.getBoundingClientRect();
    x = r.left + 12;
    y = r.bottom + 2;
  } else {
    x = at.x;
    y = at.y;
  }
  const mw = m.offsetWidth;
  const mh = m.offsetHeight;
  x = Math.max(6, Math.min(x, window.innerWidth - mw - 6));
  y = y + mh > window.innerHeight - 6 ? Math.max(6, y - mh) : y;
  m.style.left = x + 'px';
  m.style.top = y + 'px';
  const buttons = Array.from(m.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  buttons[0]?.focus();

  const onKey = (e: KeyboardEvent): void => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      prevFocus?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(i + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Tab') {
      closeMenu();
    }
  };
  const onDown = (e: Event): void => {
    if (!m.contains(e.target as Node)) closeMenu();
  };
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
  menuCleanup = () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('blur', closeMenu);
    window.removeEventListener('resize', closeMenu);
  };
}

// ---------------------------------------------------------------------------
// Undo toast (bottom center, one at a time)
// ---------------------------------------------------------------------------

export function undoToast(
  msg: string,
  undo: (() => void | Promise<void>) | null,
  kind: 'ok' | 'err' | 'info' = 'ok',
  ms = 7000,
): void {
  notify(msg, kind, ms, undo ? { label: 'Undo', icon: I.undo, run: undo } : undefined);
}

// ---------------------------------------------------------------------------
// Inline rename
// ---------------------------------------------------------------------------

/** Swap `target` for a text input; resolves the new value or null when cancelled. */
export function inlineEdit(target: HTMLElement, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = el('input', 'vx-rename') as HTMLInputElement;
    input.value = value;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'New name');
    const prev = target.innerHTML;
    target.innerHTML = '';
    target.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (v: string | null): void => {
      if (done) return;
      done = true;
      target.innerHTML = prev;
      resolve(v);
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(input.value.trim() || null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    };
    input.onblur = () => finish(input.value.trim() && input.value.trim() !== value ? input.value.trim() : null);
    input.onclick = (e) => e.stopPropagation();
    input.ondblclick = (e) => e.stopPropagation();
    input.onpointerdown = (e) => e.stopPropagation();
    input.draggable = false;
  });
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/** Pick a folder from a searchable list. */
export function pickFolder(
  title: string,
  folders: string[],
  current: string,
  disabled: (f: string) => boolean,
  run: (folder: string) => void,
): void {
  const box = el('div', 'vx-pick');
  box.innerHTML = `<input class="vx-pick-q" type="text" placeholder="Filter folders" aria-label="Filter folders" spellcheck="false">
    <div class="vx-pick-list" role="listbox"></div>`;
  const list = box.querySelector<HTMLElement>('.vx-pick-list')!;
  const q = box.querySelector<HTMLInputElement>('.vx-pick-q')!;
  const draw = (): void => {
    const needle = q.value.trim().toLowerCase();
    list.innerHTML = folders
      .filter((f) => !needle || (f || 'vault').toLowerCase().includes(needle))
      .map((f) => {
        const depth = f ? f.split('/').length : 0;
        const off = disabled(f);
        return `<button class="vx-pick-row${f === current ? ' cur' : ''}" role="option" data-f="${attr(f)}" ${
          off ? 'disabled' : ''
        } style="padding-left:${10 + (needle ? 0 : depth * 14)}px">${f ? I.folder : I.vault}<span>${esc(
          needle ? f || 'Vault' : f ? f.split('/').pop() : 'Vault (root)',
        )}</span>${f === current ? '<em>current</em>' : ''}</button>`;
      })
      .join('');
    list.querySelectorAll<HTMLButtonElement>('.vx-pick-row').forEach((b) => {
      b.onclick = () => {
        Modal.close();
        run(b.dataset.f || '');
      };
    });
  };
  q.oninput = draw;
  q.onkeydown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  };
  list.onkeydown = (e) => {
    const bs = Array.from(list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      bs[Math.min(bs.length - 1, i + 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i <= 0) q.focus();
      else bs[i - 1]?.focus();
    }
  };
  draw();
  Modal.open({ title, body: box, actions: [{ label: 'Cancel', cls: 'ghost', run: () => Modal.close() }] });
}

/** Folder color and icon. */
export function folderLookDialog(
  folder: string,
  color: string,
  icon: string,
  save: (patch: { color?: string; icon?: string }) => void,
): void {
  const box = el('div', 'vx-look');
  const presets = Object.keys(FOLDER_ICONS);
  const emoji = icon && !FOLDER_ICONS[icon] ? icon : '';
  box.innerHTML = `<div class="vx-look-prev"><span class="vx-look-ico"></span><b>${esc(folder.split('/').pop() || folder)}</b><small>${esc(folder)}</small></div>
  <div class="vx-look-label">Color</div>${colorPickHTML('vxLookColor', color, { auto: true, presets: SWATCH_COLORS })}
  <div class="vx-look-label" style="margin-top:14px">Icon</div><div class="vx-icons">${['', ...presets]
    .map(
      (k) =>
        `<button type="button" class="vx-iconpick${k === icon || (!k && !icon) ? ' on' : ''}" data-i="${attr(k)}" title="${attr(k || 'default')}" aria-label="Icon ${attr(k || 'default')}">${folderGlyph(k, false)}</button>`,
    )
    .join('')}</div>
  <label class="vx-look-emoji"><span>Or any emoji / text</span><input type="text" maxlength="4" value="${attr(emoji)}" placeholder="e.g. 🚀" aria-label="Emoji icon"></label>`;
  let cur = { color: color || '', icon: icon || '' };
  const ico = box.querySelector<HTMLElement>('.vx-look-ico')!;
  const paint = (): void => {
    const c = cur.color || 'var(--muted)';
    ico.innerHTML = folderGlyph(cur.icon, false);
    ico.style.color = c;
    box.querySelectorAll<HTMLElement>('.vx-iconpick').forEach((b) => {
      b.classList.toggle('on', (b.dataset.i || '') === cur.icon);
      b.style.color = c;
    });
  };
  const emojiIn = box.querySelector<HTMLInputElement>('.vx-look-emoji input')!;
  box.querySelectorAll<HTMLButtonElement>('.vx-iconpick').forEach((b) => {
    b.onclick = () => {
      cur.icon = b.dataset.i || '';
      emojiIn.value = '';
      paint();
    };
  });
  emojiIn.oninput = () => {
    cur.icon = emojiIn.value.trim();
    paint();
  };
  Modal.open({
    title: 'Folder look',
    sub: 'Color and icon for the folder and its region in the brain',
    body: box,
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'Save',
        cls: 'primary',
        run: () => {
          Modal.close();
          save({ color: cur.color, icon: cur.icon });
        },
      },
    ],
    onOpen: (b) => {
      wireColorPick(b, 'vxLookColor', (v) => {
        cur.color = v;
        paint();
      });
      paint();
    },
  });
}

/** Ask for a name. */
export function promptName(title: string, label: string, value: string, run: (v: string) => void): void {
  Modal.open({
    title,
    body: Modal.field(label, 'vxName', { value }),
    actions: [
      { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
      {
        label: 'OK',
        cls: 'primary',
        run: (body) => {
          const v = body.querySelector<HTMLInputElement>('#vxName')?.value.trim() || '';
          if (!v) return;
          Modal.close();
          run(v);
        },
      },
    ],
    onOpen: (body) => {
      const input = body.querySelector<HTMLInputElement>('#vxName');
      if (input) {
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const v = input.value.trim();
            if (!v) return;
            Modal.close();
            run(v);
          }
        };
      }
    },
  });
}
