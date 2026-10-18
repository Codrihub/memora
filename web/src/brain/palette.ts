// Colors for brain regions (folders), tuned for both themes.

/** Region hues: luminous on dark, still readable on light. */
const REGION = [
  '#5eead4', // teal
  '#7dd3fc', // sky
  '#a78bfa', // violet
  '#f472b6', // pink
  '#fbbf24', // amber
  '#86efac', // mint
  '#fb923c', // orange
  '#93c5fd', // blue
  '#e879f9', // fuchsia
  '#facc15', // yellow
  '#67e8f9', // cyan
  '#fca5a5', // rose
  '#c4b5fd', // lavender
  '#bef264', // lime
];

/** An explicit folder color wins; otherwise a hue from the palette by index. */
export function regionColor(index: number, explicit?: string): string {
  if (explicit && /^#[0-9a-f]{6}$/i.test(explicit)) return explicit;
  return REGION[index % REGION.length];
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.6, 0.8, 0.9];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
