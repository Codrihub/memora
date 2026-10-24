// The build version is a content hash of the built assets, stamped by scripts/build-pages.mjs.

/** The build hash written into a sw.js source, or '' when there is none. */
export function buildOf(swSource: string): string {
  return /["']memora-build:([0-9a-f]{12})["']/.exec(swSource)?.[1] ?? '';
}

/** Unknown on either side is never a new build. */
export function isNewBuild(running: string, latest: string): boolean {
  return !!running && !!latest && running !== latest;
}
