// Positions are in world units; the camera maps them to screen pixels.

type NodeKind = 'note' | 'folder';

export interface GNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Vault-relative path for notes, folder path for folder nodes. */
  path: string;
  /** Top-level folder (colour group). */
  group: string;
  /** Full parent folder path ('' for the vault root). */
  dir: string;
  tags: string[];
  color: string;
  degree: number;
  /** Visual radius in world units. */
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Fixed position while dragged or pinned. */
  fx: number | null;
  fy: number | null;
  pinned: boolean;
  /** Layout target for radial and cluster modes. */
  tx: number;
  ty: number;
  /** ms timestamps, 0 when idle. */
  born: number;
  dying: number;
  /** Highlight blend 0..1, eased every frame. */
  fade: number;
  /** Index in the node array. */
  i: number;
}

export interface GLink {
  s: GNode;
  t: GNode;
  /** 'tree' = folder to child, 'ref' = wikilink. */
  kind: 'tree' | 'ref';
  k: number;
  len: number;
  bias: number;
}

export type LayoutMode = 'force' | 'radial' | 'clusters';

export interface Pulse {
  id: string;
  actor: string;
  color: string;
  start: number;
  /** 0 while the agent call runs. */
  end: number;
}

export const FOLDER_PREFIX = '\u0000dir:';
