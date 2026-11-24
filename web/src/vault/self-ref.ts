// Whether a wikilink target names the note it is written in: `[[Self]]`, `[[self#Heading]]`,
// `[[Self|alias]]`, `[[Folder/Self]]` and `[[Self.md]]` all do. A note never lists, offers or
// counts itself as a link, a mention or a board to embed. Pure (no DOM), for `node --test`.

const norm = (s: string): string =>
  s
    .split('|')[0]
    .split('#')[0]
    .trim()
    .replace(/\.md$/i, '')
    .toLowerCase();

/** `target` (as written between the brackets) points at `selfPath` (a vault path, `.md` optional). */
export function isSelfTarget(target: string, selfPath: string | null | undefined): boolean {
  if (!selfPath) return false;
  const t = norm(target);
  if (!t) return false;
  const full = norm(selfPath);
  const name = full.slice(full.lastIndexOf('/') + 1);
  return t === full || (!t.includes('/') && t === name);
}

/** `paths` without `selfPath`, compared without case and `.md`. */
export function withoutSelf(paths: string[], selfPath: string | null | undefined): string[] {
  if (!selfPath) return paths;
  const me = norm(selfPath);
  return paths.filter((p) => norm(p) !== me);
}
