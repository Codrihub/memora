// Canvas chrome: editing toolbar, selection bar, undo toast and the
// shortcut help overlay.

import { el, esc } from '../dom';

const P = (d: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

export const ICON = {
  pointer: P('<path d="M5 3l14 8-6.2 1.6L10 19z"/>'),
  hand: P('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.6-2.2L3.6 14.6a1.6 1.6 0 0 1 2.3-2.2L8 14.5"/>'),
  fit: P('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>'),
  tidy: P('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
  link: P('<path d="M5 18c4 0 4-12 9-12h5"/><circle cx="5" cy="18" r="1.6"/><path d="m16 3 3 3-3 3"/>'),
  help: P('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.4 2.4 0 1 1 3.3 2.2c-.8.4-1.1.9-1.1 1.7M12 16.6h.01"/>'),
  open: P('<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
  alL: P('<path d="M4 3v18M8 7h10M8 13h6M8 17h8"/>'),
  alC: P('<path d="M12 3v18M6 7h12M8 12h8M5 17h14"/>'),
  alR: P('<path d="M20 3v18M6 7h10M10 12h6M8 17h8"/>'),
  alT: P('<path d="M3 4h18M7 8v10M12 8v6M17 8v8"/>'),
  alM: P('<path d="M3 12h18M7 6v12M12 8v8M17 5v14"/>'),
  alB: P('<path d="M3 20h18M7 6v10M12 10v6M17 8v8"/>'),
  disH: P('<path d="M4 4v16M20 4v16"/><rect x="9.5" y="7" width="5" height="10" rx="1"/>'),
  disV: P('<path d="M4 4h16M4 20h16"/><rect x="7" y="9.5" width="10" height="5" rx="1"/>'),
  undo: P('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
};

export const CURSOR_SVG =
  '<svg viewBox="0 0 18 18"><path d="M2 1.5l13 6.2-5.6 1.5L7 15z" fill="var(--ac)" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>';

export interface Chrome {
  tools: HTMLElement;
  zoom: HTMLElement;
  selbar: HTMLElement;
  toast: HTMLElement;
  help: HTMLElement;
  scrim: HTMLElement;
}

function btn(act: string, icon: string, title: string, extra = ''): string {
  return `<button class="cv-btn ${extra}" data-act="${act}" title="${esc(title)}" aria-label="${esc(title)}">${icon}</button>`;
}

export function buildChrome(root: HTMLElement): Chrome {
  // Editing tools only: view switching, search, zoom, minimap and regions
  // come from the chrome shared with Brain and Graph (ui/view-chrome.ts).
  const tools = el(
    'div',
    'cv-ui cv-tools',
    btn('tool-select', ICON.pointer, 'Select (V)', 'on') +
      btn('tool-hand', ICON.hand, 'Hand (H, or hold Space)') +
      '<span class="cv-sep"></span>' +
      `<button class="cv-btn cv-zoom" data-act="zoom-100" title="Reset to 100% (Shift+0)">100%</button>` +
      '<span class="cv-sep"></span>' +
      btn('tidy', ICON.tidy, 'Tidy up (T: selection, Shift+T: whole board)') +
      btn('links', ICON.link, 'Show wikilinks (L)', 'on') +
      btn('help', ICON.help, 'Keyboard shortcuts (?)'),
  );
  const zoom = tools.querySelector<HTMLElement>('.cv-zoom')!;
  const selbar = el(
    'div',
    'cv-ui cv-selbar hidden',
    // What is selected: the count, the folder(s) it lives in (tap one to fly
    // there) and, for a single node, preview and focus. Then the arrange tools.
    '<span class="cnt"></span><span class="cv-fchips"></span>' +
      btn('sel-open', ICON.open, 'Preview and open (Enter)') +
      btn('fit-sel', ICON.fit, 'Focus the selection (Shift+2)') +
      '<span class="cv-sep"></span>' +
      btn('al-l', ICON.alL, 'Align left (Alt+A)') +
      btn('al-c', ICON.alC, 'Align horizontal centers (Alt+H)') +
      btn('al-r', ICON.alR, 'Align right (Alt+D)') +
      btn('al-t', ICON.alT, 'Align top (Alt+W)') +
      btn('al-m', ICON.alM, 'Align vertical centers (Alt+V)') +
      btn('al-b', ICON.alB, 'Align bottom (Alt+S)') +
      '<span class="cv-sep"></span>' +
      btn('dis-h', ICON.disH, 'Distribute horizontally (Alt+Shift+H)') +
      btn('dis-v', ICON.disV, 'Distribute vertically (Alt+Shift+V)') +
      '<span class="cv-sep"></span>' +
      btn('tidy', ICON.tidy, 'Tidy into a grid (T)'),
  );
  const toast = el('div', 'cv-ui cv-toast', '<span class="msg"></span>');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const help = el('div', 'cv-ui cv-help hidden', helpHtml());
  help.setAttribute('role', 'dialog');
  help.setAttribute('aria-label', 'Canvas keyboard shortcuts');
  const scrim = el('div', 'cv-scrim hidden');
  root.append(tools, selbar, toast, scrim, help);
  return { tools, zoom, selbar, toast, help, scrim };
}

function helpHtml(): string {
  const k = (s: string): string =>
    s
      .split(' ')
      .map((x) => `<kbd>${esc(x)}</kbd>`)
      .join('');
  const rows: [string, string][] = [
    ['Pan', 'Space+drag'],
    ['Pan (mouse)', 'Middle-drag'],
    ['Zoom at cursor', 'Ctrl+wheel'],
    ['Zoom in / out', '+ -'],
    ['Zoom to fit', 'Shift+1'],
    ['Zoom to selection', 'Shift+2'],
    ['Zoom to 100%', 'Shift+0'],
    ['Select / Hand tool', 'V H'],
    ['Add to selection', 'Shift+click'],
    ['Select all', 'Ctrl+A'],
    ['Preview node', 'Enter'],
    ['Open node', 'O'],
    ['Rename', 'F2'],
    ['Nudge', 'Arrows'],
    ['Align left / right', 'Alt+A Alt+D'],
    ['Align top / bottom', 'Alt+W Alt+S'],
    ['Align centers', 'Alt+H Alt+V'],
    ['Distribute', 'Alt+Shift+H/V'],
    ['Tidy selection', 'T'],
    ['Tidy whole board', 'Shift+T'],
    ['Wikilinks', 'L'],
    ['Minimap', 'M'],
    ['Undo last move', 'Ctrl+Z'],
    ['Clear / close', 'Esc'],
  ];
  return `<h3>Canvas shortcuts</h3>
  <p>Drag a card into another folder frame to move the node on disk. Drag a frame by its name to rearrange the board; drop it onto another frame to move the whole folder there. Double-click a title to rename. On touch: drag to pan, pinch to zoom, long-press a card to move it, tap to preview.</p>
  <div class="cols">${rows.map(([a, b]) => `<div class="row"><span>${esc(a)}</span><span>${k(b)}</span></div>`).join('')}</div>`;
}

/** Undo-able notification. */
export class Toast {
  private timer = 0;
  constructor(private node: HTMLElement) {}

  show(msg: string, opts: { undo?: () => void; err?: boolean; ms?: number } = {}): void {
    clearTimeout(this.timer);
    this.node.classList.toggle('err', !!opts.err);
    this.node.innerHTML = `<span class="msg">${esc(msg)}</span>${
      opts.undo ? `<button class="cv-btn" data-undo>${ICON.undo}Undo</button>` : ''
    }`;
    const b = this.node.querySelector<HTMLButtonElement>('[data-undo]');
    if (b && opts.undo) {
      const run = opts.undo;
      b.onclick = () => {
        this.hide();
        run();
      };
    }
    this.node.classList.add('show');
    this.timer = window.setTimeout(() => this.hide(), opts.ms ?? (opts.undo ? 7000 : 3600));
  }

  hide(): void {
    this.node.classList.remove('show');
  }
}
