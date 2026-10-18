// The brain's home camera, shared by the 3D scene and the boot splash so the
// splash draws the brain from exactly the angle the live view opens at.

export type V3 = [number, number, number];

/** Default eye direction: a lateral, slightly raised view (the classic profile). */
export const HOME_DIR: V3 = [3.05, 1.35, 1.55];
export const HOME_TARGET: V3 = [0, -0.02, -0.04];
export const HOME_FOV_DEG = 42;

/** Eye distance for a viewport aspect (narrow screens step back). */
export function homeDistance(aspect: number): number {
  return aspect < 0.9 ? 5.2 : aspect < 1.3 ? 4.1 : 3.6;
}

/** A camera as the splash draws with it: eye, look-at target, vertical fov
 * (radians) and the page rectangle it renders into. */
export interface BrainView {
  eye: V3;
  target: V3;
  fov: number;
  rect: { x: number; y: number; w: number; h: number };
}
