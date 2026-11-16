// Reading settings ("Aa"), stored per browser and applied only to the reading area.

import { el } from '../dom';
import { openPanel } from './panel';

type ReadFont = 'sans' | 'system' | 'serif' | 'book' | 'humanist' | 'legible' | 'rounded' | 'dyslexic' | 'mono';
type ReadTone = 'default' | 'paper' | 'sepia' | 'sage' | 'mist' | 'rose' | 'night' | 'midnight' | 'contrast';
type ReadLeading = 'compact' | 'normal' | 'relaxed';
type ReadWidth = 'narrow' | 'wide' | 'full';

interface ReadPrefs {
  /** Body text size in px, one of SIZES. */
  size: number;
  font: ReadFont;
  tone: ReadTone;
  leading: ReadLeading;
  width: ReadWidth;
}

const LS = 'memora.reader.v3';
const LS_V2 = 'memora.reader.v2';
const LS_V1 = 'memora.reader.v1';
/** Body text sizes in px. */
const SIZES = [12, 13, 14.5, 16, 17.5, 19, 21, 23, 26];
/** The sizes before 2.1.0, which stored an index into this list. */
const SIZES_V2 = [13, 14.5, 16, 17.5, 19, 21, 24];
const DEFAULTS: ReadPrefs = { size: 16, font: 'sans', tone: 'default', leading: 'normal', width: 'wide' };
/** The text column's widest line for each width choice. */
const WIDTHS: Record<ReadWidth, string> = { narrow: '640px', wide: '760px', full: '100%' };

const FONTS: { k: ReadFont; label: string }[] = [
  { k: 'sans', label: 'Sans' },
  { k: 'system', label: 'System' },
  { k: 'serif', label: 'Serif' },
  { k: 'book', label: 'Book' },
  { k: 'humanist', label: 'Humanist' },
  { k: 'legible', label: 'Legible' },
  { k: 'rounded', label: 'Rounded' },
  { k: 'dyslexic', label: 'Dyslexic' },
  { k: 'mono', label: 'Mono' },
];

const TONES: { k: ReadTone; label: string }[] = [
  { k: 'default', label: 'Default' },
  { k: 'paper', label: 'Paper' },
  { k: 'sepia', label: 'Sepia' },
  { k: 'sage', label: 'Sage' },
  { k: 'mist', label: 'Mist' },
  { k: 'rose', label: 'Rose' },
  { k: 'night', label: 'Night' },
  { k: 'midnight', label: 'Midnight' },
  { k: 'contrast', label: 'High contrast' },
];

/** Colours from older versions, mapped to the nearest one kept. */
const OLD_TONES: Record<string, ReadTone> = { mint: 'sage' };

const nearestSize = (px: number): number => SIZES.reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a), DEFAULTS.size);

const LEADINGS: { k: ReadLeading; label: string }[] = [
  { k: 'compact', label: 'Compact' },
  { k: 'normal', label: 'Normal' },
  { k: 'relaxed', label: 'Relaxed' },
];

const WIDTH_OPTS: { k: ReadWidth; label: string }[] = [
  { k: 'narrow', label: 'Narrow' },
  { k: 'wide', label: 'Wide' },
  { k: 'full', label: 'Full' },
];

function load(): ReadPrefs {
  const d: ReadPrefs = { ...DEFAULTS };
  try {
    let v = JSON.parse(localStorage.getItem(LS) || 'null') as Partial<ReadPrefs> | null;
    if (v) {
      if (typeof v.size === 'number') d.size = nearestSize(v.size);
    } else {
      // v2 stored an index into SIZES_V2; v1 had 5 sizes with the default at 1.
      const v2 = JSON.parse(localStorage.getItem(LS_V2) || 'null') as Partial<ReadPrefs> | null;
      const v1 = v2 ? null : (JSON.parse(localStorage.getItem(LS_V1) || 'null') as Partial<ReadPrefs> | null);
      v = v2 || v1 || {};
      const idx = typeof v.size === 'number' ? Math.round(v.size) + (v2 ? 0 : 1) : -1;
      if (idx >= 0 && idx < SIZES_V2.length) d.size = nearestSize(SIZES_V2[idx]!);
    }
    if (FONTS.some((f) => f.k === v!.font)) d.font = v.font as ReadFont;
    if (TONES.some((t) => t.k === v!.tone)) d.tone = v.tone as ReadTone;
    else if (typeof v.tone === 'string' && OLD_TONES[v.tone]) d.tone = OLD_TONES[v.tone]!;
    if (LEADINGS.some((t) => t.k === v!.leading)) d.leading = v.leading as ReadLeading;
    if (WIDTH_OPTS.some((t) => t.k === v!.width)) d.width = v.width as ReadWidth;
  } catch {
    /* defaults */
  }
  return d;
}

export const reading: ReadPrefs = load();

function save(): void {
  try {
    localStorage.setItem(LS, JSON.stringify(reading));
  } catch {
    /* storage blocked */
  }
}

/** Put the settings on the reading area (`editing` keeps the editor neutral). */
export function applyReading(area: HTMLElement, editing: boolean): void {
  area.dataset.rfont = reading.font;
  area.dataset.rlead = reading.leading;
  area.style.setProperty('--rsize', reading.size + 'px');
  area.style.setProperty('--rw', WIDTHS[reading.width]);
  if (editing || reading.tone === 'default') delete area.dataset.rtone;
  else area.dataset.rtone = reading.tone;
}

function isDefault(): boolean {
  return (Object.keys(DEFAULTS) as (keyof ReadPrefs)[]).every((k) => reading[k] === DEFAULTS[k]);
}

/** The "Aa" panel; `changed` re-applies the settings to the open node. */
export function openReadingPanel(anchor: HTMLElement, changed: () => void): void {
  const body = el('div', 'vx-aa');
  const paint = (): void => {
    body.innerHTML = `<div class="vx-aa-row"><span class="vx-label">Text size</span>
      <div class="vx-aa-size" role="group" aria-label="Text size">
        <button data-size="-1" aria-label="Smaller text"${reading.size === SIZES[0] ? ' disabled' : ''}><span style="font-size:13px">A</span></button>
        <span class="vx-aa-dots" aria-hidden="true">${SIZES.map((px) => `<i class="${px === reading.size ? 'on' : ''}"></i>`).join('')}</span>
        <span class="vx-aa-px">${reading.size}px</span>
        <button data-size="1" aria-label="Larger text"${reading.size === SIZES[SIZES.length - 1] ? ' disabled' : ''}><span style="font-size:20px">A</span></button>
      </div></div>
      <div class="vx-aa-row"><span class="vx-label">Font</span><div class="vx-seg3" role="group" aria-label="Font">${FONTS.map(
        (f) =>
          `<button data-font="${f.k}" aria-pressed="${reading.font === f.k}" class="ff-${f.k}"><b>Ag</b><span>${f.label}</span></button>`,
      ).join('')}</div></div>
      <div class="vx-aa-row"><span class="vx-label">Line spacing</span><div class="vx-seg3" role="group" aria-label="Line spacing">${LEADINGS.map(
        (t) => `<button data-lead="${t.k}" aria-pressed="${reading.leading === t.k}"><i class="lh lh-${t.k}"><b></b><b></b><b></b></i><span>${t.label}</span></button>`,
      ).join('')}</div></div>
      <div class="vx-aa-row"><span class="vx-label">Width</span><div class="vx-seg3" role="group" aria-label="Text width">${WIDTH_OPTS.map(
        (t) => `<button data-width="${t.k}" aria-pressed="${reading.width === t.k}"><i class="wd wd-${t.k}"><b></b></i><span>${t.label}</span></button>`,
      ).join('')}</div></div>
      <div class="vx-aa-row"><span class="vx-label">Colour</span><div class="vx-seg3" role="group" aria-label="Reading colour">${TONES.map(
        (t) => `<button data-tone="${t.k}" aria-pressed="${reading.tone === t.k}"><i class="sw sw-${t.k}"></i><span>${t.label}</span></button>`,
      ).join('')}</div></div>
      <button class="vx-aa-reset" data-reset${isDefault() ? ' disabled' : ''}>Reset to default</button>`;
  };
  paint();
  body.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    if (b.dataset.size) {
      const i = Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(reading.size) + Number(b.dataset.size)));
      reading.size = SIZES[i]!;
    }
    else if (b.dataset.font) reading.font = b.dataset.font as ReadFont;
    else if (b.dataset.tone) reading.tone = b.dataset.tone as ReadTone;
    else if (b.dataset.lead) reading.leading = b.dataset.lead as ReadLeading;
    else if (b.dataset.width) reading.width = b.dataset.width as ReadWidth;
    else if (b.dataset.reset !== undefined) Object.assign(reading, DEFAULTS);
    else return;
    save();
    const key = b.dataset.size
      ? `[data-size="${b.dataset.size}"]`
      : (['font', 'tone', 'lead', 'width'] as const).map((k) => (b.dataset[k] ? `[data-${k}=${b.dataset[k]}]` : '')).find(Boolean) || '';
    paint();
    ((key && body.querySelector<HTMLElement>(key + ':not(:disabled)')) || body.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    changed();
  };
  openPanel(anchor, 'Reading settings', body, 'vx-pop-aa');
}
