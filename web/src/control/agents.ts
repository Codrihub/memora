// Agent identity shared by every view: one color and one set of initials per actor name.

import { esc } from '../dom';

/** Mid-lightness hues that read on both the dark and the light background. */
export const AGENT_PALETTE = [
  '#2dd4bf', // teal
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#f472b6', // pink
  '#fb923c', // orange
  '#facc15', // amber
  '#4ade80', // green
  '#38bdf8', // sky
  '#e879f9', // fuchsia
  '#f87171', // red
  '#a3e635', // lime
  '#818cf8', // indigo
] as const;

/** Stable 32 bit FNV-1a hash of a string. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Normalize an actor name so "Claude" and " claude " share a color. */
export function agentKey(name?: string | null): string {
  return String(name || '').trim().toLowerCase();
}

// Colors picked for API keys (Agents & keys, REST or the MCP tool set_my_color).
const colorById = new Map<string, string>();
const colorByName = new Map<string, string>();
let keyIds: Set<string> | null = null;

/** Whether a key id is still connected: true, false (removed), or null when not known yet. */
export function keyExists(id: string): boolean | null {
  return keyIds ? keyIds.has(id) : null;
}

/** Fired on window when key colors change, so views can repaint. */
export const AGENT_COLORS_EVENT = 'memora:agent-colors';

/** Load the chosen key colors. A name shared by keys with different colors maps by id only. */
export function setAgentColors(keys: { id: string; name?: string; color?: string | null }[]): void {
  const before = JSON.stringify([...colorById]);
  keyIds = new Set(keys.map((k) => k.id));
  colorById.clear();
  colorByName.clear();
  const seen = new Map<string, string | null>();
  for (const k of keys) {
    const c = k.color && /^#[0-9a-f]{6}$/i.test(k.color) ? k.color.toLowerCase() : null;
    if (c) colorById.set(k.id, c);
    const n = agentKey(k.name || k.id);
    seen.set(n, seen.has(n) && seen.get(n) !== c ? null : c);
  }
  seen.forEach((c, n) => c && colorByName.set(n, c));
  if (JSON.stringify([...colorById]) !== before) window.dispatchEvent(new Event(AGENT_COLORS_EVENT));
}

/** The key's chosen color (by id, else by name), otherwise a stable hue from the name. */
export function agentColor(name?: string | null, id?: string | null): string {
  if (id && colorById.has(id)) return colorById.get(id)!;
  const k = agentKey(name);
  if (!k) return '#94a3b8';
  return colorByName.get(k) || AGENT_PALETTE[fnv(k) % AGENT_PALETTE.length];
}

/** One or two letters for an avatar: "claude-code" -> "CC", "cursor" -> "CU". */
export function agentInitials(name?: string | null): string {
  const s = String(name || '?').trim();
  const words = s.split(/[\s._\-/:@()]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || '?';
  return (w.length > 1 ? w[0] + w[1] : w[0]).toUpperCase();
}

/** Round avatar with initials, tinted with the agent color. `size` in px. */
export function avatarHTML(name?: string | null, size = 30, extraCls = '', id?: string | null): string {
  const c = agentColor(name, id);
  const fs = Math.max(9, Math.round(size * 0.38));
  return `<span class="ag-av${extraCls ? ' ' + extraCls : ''}" aria-hidden="true" style="--ag:${c};width:${size}px;height:${size}px;font-size:${fs}px">${esc(
    agentInitials(name),
  )}</span>`;
}

