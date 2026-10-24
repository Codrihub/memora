// Home camera: where the 3D scene opens and where Reset returns.

type V3 = [number, number, number];

export const HOME_DIR: V3 = [3.05, 1.35, 1.55];
export const HOME_TARGET: V3 = [0, -0.02, -0.04];
export const HOME_FOV_DEG = 42;

/** Eye distance for a viewport aspect (narrow screens step back). */
export function homeDistance(aspect: number): number {
  return aspect < 0.9 ? 5.2 : aspect < 1.3 ? 4.1 : 3.6;
}

/** fov is vertical, in radians; rect is the page rectangle it renders into. */
export interface BrainView {
  eye: V3;
  target: V3;
  fov: number;
  rect: { x: number; y: number; w: number; h: number };
}
