// Reading settings ("Aa"), stored per browser and applied only to the reading area.

import { el } from '../dom';
import { openPanel } from './panel';

type ReadFont = 'sans' | 'serif' | 'mono';
type ReadTone = 'default' | 'sepia' | 'contrast';
type ReadLeading = 'compact' | 'normal' | 'relaxed';
type ReadWidth = 'narrow' | 'wide' | 'full';

interface ReadPrefs {
  size: number;
  font: ReadFont;
  tone: ReadTone;
  leading: ReadLeading;
  width: ReadWidth;
}

const LS = 'memora.reader.v2';
const LS_OLD = 'memora.reader.v1';
/** Body text sizes in px; index 2 is the default. */
const SIZES = [13, 14.5, 16, 17.5, 19, 21, 24];
const DEFAULTS: ReadPrefs = { size: 2, font: 'sans', tone: 'default', leading: 'normal', width: 'wide' };
/** The text column's widest line for each width choice. */
const WIDTHS: Record<ReadWidth, string> = { narrow: '640px', wide: '760px', full: '100%' };

const FONTS: { k: ReadFont; label: string }[] = [
  { k: 'sans', label: 'Sans' },
  { k: 'serif', label: 'Serif' },
  { k: 'mono', label: 'Mono' },
];

const TONES: { k: ReadTone; label: string }[] = [
  { k: 'default', label: 'Default' },
  { k: 'sepia', label: 'Sepia' },
  { k: 'contrast', label: 'High contrast' },
];

/** Colours from before 2.0.1, mapped to the nearest one kept. */
const OLD_TONES: Record<string, ReadTone> = { paper: 'sepia', night: 'default', mint: 'default' };

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
    if (!v) {
      // v1 had 5 sizes with the default at 1: shift by one.
      const old = JSON.parse(localStorage.getItem(LS_OLD) || '{}') as Partial<ReadPrefs>;
      v = { ...old, size: typeof old.size === 'number' ? old.size + 1 : undefined };
    }
    if (typeof v.size === 'number' && v.size >= 0 && v.size < SIZES.length) d.size = Math.round(v.size);
    if (FONTS.some((f) => f.k === v!.font)) d.font = v.font as ReadFont;
    if (TONES.some((t) => t.k === v!.tone)) d.tone = v.tone as ReadTone;
    else if (typeof v.tone === 'string' && OLD_TONES[v.tone]) d.tone = OLD_TONES[v.tone];
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
  area.style.setProperty('--rsize', SIZES[reading.size] + 'px');
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
        <button data-size="-1" aria-label="Smaller text"${reading.size === 0 ? ' disabled' : ''}><span style="font-size:13px">A</span></button>
        <span class="vx-aa-dots" aria-hidden="true">${SIZES.map((_, i) => `<i class="${i === reading.size ? 'on' : ''}"></i>`).join('')}</span>
        <button data-size="1" aria-label="Larger text"${reading.size === SIZES.length - 1 ? ' disabled' : ''}><span style="font-size:20px">A</span></button>
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
    if (b.dataset.size) reading.size = Math.max(0, Math.min(SIZES.length - 1, reading.size + Number(b.dataset.size)));
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
