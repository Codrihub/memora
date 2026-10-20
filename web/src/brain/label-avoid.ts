// Keeps on-canvas brain labels clear of the controls laid over the map (the
// search and view switcher, Reset / Filter, the side tabs, the zoom dock).
// Labels sit under those panels, so on a phone a flying agent name would
// otherwise slide behind the glass and show through it as a smear.

/** A screen box in label-layer pixels. */
export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** How a label is offset from its anchor point (mirrors the CSS translate of each kind). */
export type LabelKind = 'agent' | 'agent-flip' | 'region' | 'note';

/** Gap kept between a label and a control. */
export const BLOCK_PAD = 6;

/** The box a label of size w x h covers when anchored at (x, y). */
export function labelBox(kind: LabelKind, x: number, y: number, w: number, h: number): Box {
  switch (kind) {
    case 'agent':
      // translate: 14px -130%
      return { l: x + 14, t: y - h * 1.3, r: x + 14 + w, b: y - h * 0.3 };
    case 'agent-flip':
      // translate: calc(-100% - 14px) -130%
      return { l: x - 14 - w, t: y - h * 1.3, r: x - 14, b: y - h * 0.3 };
    case 'region':
      // margin-top: -6px; translate: -50% -50%
      return { l: x - w / 2, t: y - 6 - h / 2, r: x + w / 2, b: y - 6 + h / 2 };
    case 'note':
      // translate: 10px -50%
      return { l: x + 10, t: y - h / 2, r: x + 10 + w, b: y + h / 2 };
  }
}

/** True when the box touches none of the blockers. */
export function clearOf(box: Box, blockers: readonly Box[]): boolean {
  for (const k of blockers) {
    if (box.l < k.r && box.r > k.l && box.t < k.b && box.b > k.t) return false;
  }
  return true;
}

/**
 * Where an agent label goes: on its usual side (right of the head), else
 * flipped to the left, else hidden while it passes under a control.
 */
export function agentSide(x: number, y: number, w: number, h: number, blockers: readonly Box[]): 'right' | 'left' | 'hidden' {
  if (!blockers.length || clearOf(labelBox('agent', x, y, w, h), blockers)) return 'right';
  if (clearOf(labelBox('agent-flip', x, y, w, h), blockers)) return 'left';
  return 'hidden';
}

/** Boxes of the given elements relative to the label layer, padded; hidden ones are skipped. */
export function blockerBoxes(layer: DOMRect, els: Iterable<Element>, pad = BLOCK_PAD): Box[] {
  const out: Box[] = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right < layer.left || r.left > layer.right || r.bottom < layer.top || r.top > layer.bottom) continue;
    out.push({ l: r.left - layer.left - pad, t: r.top - layer.top - pad, r: r.right - layer.left + pad, b: r.bottom - layer.top + pad });
  }
  return out;
}
