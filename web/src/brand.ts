// Brand copy, the logo mark (24 x 24 grid) and the icon artwork rendered by scripts/icons.ts.

export const BRAND_TAG = 'Memora by Codrihub Tech';
export const BRAND_MOTTO = 'Second brain for your AI';
export const BRAND_DESC =
  'A self-hosted memory vault: your notes as plain Markdown, wired into a living brain that your AI agents read and write over MCP. What they learn stays.';
export const BRAND_ONCE =
  'Set up once, use everywhere: connect each agent once and they all share the same memory, on your local network or over the internet.';
export const BRAND_NAME =
  'Memora is memory, advanced: built to remember what you and your AI learn, and to remember more the more you use it.';

const BRAND_COLORS = {
  bg: '#0b0f17',
  bgTop: '#17202e',
  accent: '#5eead4',
  cyan: '#22d3ee',
  coreLight: '#a5f3fc',
} as const;

const EDGES = 'M7.2 16.8V7.4l4.8 5.1 4.8-5.1v9.4';
const NODES: ReadonlyArray<readonly [number, number]> = [
  [7.2, 16.8],
  [7.2, 7.4],
  [16.8, 7.4],
  [16.8, 16.8],
];
const CORE: readonly [number, number] = [12, 12.5];

// Unique, deterministic gradient ids per mark; the prefix separates build-time ("s") and runtime ("r") marks.
let uid = 0;
const SEED = typeof document === 'undefined' ? 's' : 'r';

/** `tile: false` leaves the tile out (full-bleed app icons). */
function markParts(tile: boolean): string {
  const { bg, bgTop, accent, cyan, coreLight } = BRAND_COLORS;
  const n = ++uid;
  const g = `mmg${SEED}${n}`;
  const t = `mmt${SEED}${n}`;
  const c = `mmc${SEED}${n}`;
  const nodes = NODES.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.7" fill="${x < 12 ? accent : cyan}"/>`).join('');
  return (
    `<defs>` +
    `<linearGradient id="${g}" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${cyan}"/></linearGradient>` +
    `<linearGradient id="${t}" x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${bgTop}"/><stop offset="1" stop-color="${bg}"/></linearGradient>` +
    `<radialGradient id="${c}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="${coreLight}"/><stop offset="1" stop-color="${cyan}"/></radialGradient>` +
    `</defs>` +
    // No stroke or fill inherited from the page (login's svg{stroke:currentColor}).
    `<g fill="none" stroke="none">` +
    (tile
      ? `<rect x="1.5" y="1.5" width="21" height="21" rx="6.2" fill="url(#${t})"/>` +
        `<rect x="1.5" y="1.5" width="21" height="21" rx="6.2" fill="none" stroke="url(#${g})" stroke-opacity=".55" stroke-width=".8"/>`
      : '') +
    `<path d="${EDGES}" fill="none" stroke="url(#${g})" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>` +
    nodes +
    `<circle cx="${CORE[0]}" cy="${CORE[1]}" r="3" fill="${cyan}" opacity=".22"/>` +
    `<circle cx="${CORE[0]}" cy="${CORE[1]}" r="2" fill="url(#${c})"/>` +
    `</g>`
  );
}

export function markSvg(cls = 'brand-mark'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${markParts(true)}</svg>`;
}

export type IconKind = 'any' | 'maskable' | 'apple';

export function iconSvg(size: number, kind: IconKind): string {
  const { bg, bgTop } = BRAND_COLORS;
  const s = size;
  if (kind === 'any') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="1 1 22 22">${markParts(true)}</svg>`;
  }
  const scale = kind === 'maskable' ? 1 : 1.18;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24">` +
    `<defs><linearGradient id="ibg" x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${bgTop}"/><stop offset="1" stop-color="${bg}"/></linearGradient></defs>` +
    `<rect width="24" height="24" fill="url(#ibg)"/>` +
    `<g transform="translate(12 12.1) scale(${scale}) translate(-12 -12.1)">${markParts(false)}</g>` +
    `</svg>`
  );
}

/** App shortcut icon: full-bleed slate with one line glyph. */
export function shortcutSvg(size: number, glyph: string): string {
  const { bg, accent } = BRAND_COLORS;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
    `<rect width="24" height="24" fill="${bg}"/>` +
    `<g transform="translate(12 12) scale(.58) translate(-12 -12)" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>` +
    `</svg>`
  );
}

export function faviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="1 1 22 22">${markParts(true)}</svg>`;
}

export function faviconDataUri(): string {
  return 'data:image/svg+xml,' + encodeURIComponent(faviconSvg());
}
