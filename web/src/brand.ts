// Memora brand: the logo mark and the icon artwork.
//
// The mark is a vault (a slate tile) holding a small note graph whose edges
// trace an "M": four notes on the outside, one glowing note at the core.
// Drawn on a 24 x 24 grid. Used by the login and offline pages (inline, styled
// through CSS classes) and by scripts/icons.ts, which renders the favicon and
// the PWA icons from the standalone variants below.

export const BRAND_TAG = 'Memora by Codrihub Tech';
/** The motto: the one line under the name. */
export const BRAND_MOTTO = 'Second brain for your AI';
/** What Memora is, in one breath. */
export const BRAND_DESC =
  'A self-hosted memory vault: your notes as plain Markdown, wired into a living brain that your AI agents read and write over MCP. What they learn stays.';
/** Set up once, use everywhere: why one shared memory beats one per agent. */
export const BRAND_ONCE =
  'Set up once, use everywhere: connect each agent once and they all share the same memory, on your local network or over the internet.';
/** Where the name comes from. */
export const BRAND_NAME =
  'Memora is memory, advanced: built to remember what you and your AI learn, and to remember more the more you use it.';

const BRAND_COLORS = {
  /** The tile: a dark slate, a touch lighter at the top. */
  bg: '#0b0f17',
  bgTop: '#17202e',
  /** The mark: teal into cyan; the core glows white at its heart. */
  accent: '#5eead4',
  cyan: '#22d3ee',
  coreLight: '#a5f3fc',
} as const;

/** The graph edges that draw the "M". */
const EDGES = 'M7.2 16.8V7.4l4.8 5.1 4.8-5.1v9.4';
/** Outer notes: [cx, cy] (left pair teal, right pair cyan). */
const NODES: ReadonlyArray<readonly [number, number]> = [
  [7.2, 16.8],
  [7.2, 7.4],
  [16.8, 7.4],
  [16.8, 16.8],
];
const CORE: readonly [number, number] = [12, 12.5];

/**
 * Every inline mark gets its own gradient ids (several can share a page). The
 * prefix differs per load: marks rendered into the static pages at build time
 * and marks drawn by the app at runtime count from 1 independently.
 */
let uid = 0;
const SEED = Math.random().toString(36).slice(2, 7);

/**
 * The mark's parts on the 24 x 24 grid: a solid
 * slate tile with a thin gradient rim, a bold gradient "M", four notes and a
 * glowing core. `tile: false` leaves the tile out (full-bleed app icons).
 */
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

/** Inline mark for a page (self-coloured; size it with CSS through `cls`). */
export function markSvg(cls = 'brand-mark'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${markParts(true)}</svg>`;
}

export type IconKind = 'any' | 'maskable' | 'apple';

/**
 * Standalone app icon at `size` px.
 * - any: the tile on a transparent canvas, filling most of it.
 * - maskable: full-bleed slate, the mark kept inside the 80% safe circle.
 * - apple: full-bleed slate (iOS rounds the corners itself).
 */
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

/**
 * App shortcut icon (long press on the installed app): the slate tile, full
 * bleed for the launcher's mask, with one line glyph in the brand teal.
 */
export function shortcutSvg(size: number, glyph: string): string {
  const { bg, accent } = BRAND_COLORS;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
    `<rect width="24" height="24" fill="${bg}"/>` +
    `<g transform="translate(12 12) scale(.58) translate(-12 -12)" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>` +
    `</svg>`
  );
}

/** favicon.svg: the tiled mark, readable at 16 px. */
export function faviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="1 1 22 22">${markParts(true)}</svg>`;
}

/** URL-encoded favicon for an inline `<link rel="icon">`. */
export function faviconDataUri(): string {
  return 'data:image/svg+xml,' + encodeURIComponent(faviconSvg());
}
