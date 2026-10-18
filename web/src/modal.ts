// Modal dialog: one look for the whole app (a bottom sheet on phones), with a
// focus trap and Esc handling.

import { $, $$, el, esc, attr } from './dom';
import { icon } from './ui/icons';

interface ModalAction {
  label: string;
  cls?: string;
  run: (body: HTMLElement) => void | Promise<void>;
}

interface FieldOption {
  v: string;
  l: string;
}

interface FieldOptions {
  type?: 'text' | 'password' | 'number' | 'select' | 'textarea';
  value?: string;
  ph?: string;
  hint?: string;
  options?: FieldOption[];
}

interface ModalOptions {
  title: string;
  sub?: string;
  body?: Node | string;
  actions?: ModalAction[];
  wide?: boolean;
  onOpen?: (body: HTMLElement) => void;
}

let seq = 0;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let lastFocus: HTMLElement | null = null;
let prevOverflow = '';

export const Modal = {
  open(opts: ModalOptions): void {
    Modal.close(true);
    lastFocus = document.activeElement as HTMLElement | null;
    const host = $('#modalHost');
    const box = el('div', 'modal' + (opts.wide ? ' wide' : ''));
    const titleId = 'modal-t-' + ++seq;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', titleId);
    const head = el(
      'div',
      'modal-head',
      `<h3 class="modal-title" id="${titleId}">${esc(opts.title)}</h3>${
        opts.sub ? `<span class="modal-sub">${esc(opts.sub)}</span>` : ''
      }<button class="modal-x" type="button" title="Close (Esc)" aria-label="Close">${icon('close')}</button>`,
    );
    const bodyEl = el('div', 'modal-body');
    if (opts.body instanceof Node) bodyEl.appendChild(opts.body);
    else bodyEl.innerHTML = opts.body || '';
    box.appendChild(head);
    box.appendChild(bodyEl);

    if (opts.actions && opts.actions.length) {
      const foot = el('div', 'modal-foot');
      for (const a of opts.actions) {
        const b = el('button', 'btn ' + (a.cls || ''), esc(a.label));
        b.type = 'button';
        b.onclick = async () => {
          b.disabled = true;
          try {
            await a.run(bodyEl);
          } finally {
            b.disabled = false;
          }
        };
        foot.appendChild(b);
      }
      box.appendChild(foot);
    }

    host.innerHTML = '';
    host.appendChild(box);
    host.classList.remove('hidden');
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    $('.modal-x', head).onclick = () => Modal.close();
    host.onclick = (e) => {
      if (e.target === host) Modal.close();
    };

    keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        Modal.close();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = $$<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex]:not([tabindex="-1"])',
        box,
      ).filter((n) => n.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Focus that escaped the dialog (a click on the backdrop) comes back in.
      if (!box.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keyHandler, true);

    const firstField = $('input,select,textarea,button.btn.primary,button', box);
    if (firstField) setTimeout(() => firstField.focus(), 40);
    if (opts.onOpen) opts.onOpen(bodyEl);
  },

  close(silent = false): void {
    $('#modalHost').classList.add('hidden');
    $('#modalHost').innerHTML = '';
    // Callers close defensively; with no dialog open there is nothing to restore.
    if (!keyHandler) return;
    document.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
    document.body.style.overflow = prevOverflow || '';
    const back = lastFocus;
    lastFocus = null;
    if (!silent && back && back.focus) {
      try {
        back.focus();
      } catch {
        /* the element can be gone already */
      }
    }
  },

  confirm(
    title: string,
    text: string,
    confirmLabel: string,
    run: () => Promise<void> | void,
    danger = true,
  ): void {
    Modal.open({
      title,
      body: `<p style="margin:0 0 4px">${esc(text)}</p>`,
      actions: [
        { label: 'Cancel', cls: 'ghost', run: () => Modal.close() },
        {
          label: confirmLabel || 'Continue',
          cls: danger ? 'danger' : 'primary',
          run: async () => {
            await run();
          },
        },
      ],
    });
  },

  field(label: string, id: string, opts: FieldOptions = {}): string {
    if (opts.type === 'select') {
      return `<div class="field"><label for="${attr(id)}">${esc(label)}</label><select id="${attr(id)}">${(
        opts.options || []
      )
        .map(
          (o) =>
            `<option value="${attr(o.v)}"${o.v === opts.value ? ' selected' : ''}>${esc(o.l)}</option>`,
        )
        .join('')}</select></div>`;
    }
    if (opts.type === 'textarea') {
      return `<div class="field"><label for="${attr(id)}">${esc(label)}</label><textarea id="${attr(id)}" placeholder="${attr(
        opts.ph || '',
      )}">${esc(opts.value || '')}</textarea></div>`;
    }
    return `<div class="field"><label for="${attr(id)}">${esc(label)}</label><input id="${attr(id)}" type="${
      opts.type || 'text'
    }" value="${attr(opts.value || '')}" placeholder="${attr(opts.ph || '')}" autocomplete="off" spellcheck="false">${
      opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ''
    }</div>`;
  },
};
