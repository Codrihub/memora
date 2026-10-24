// Tag patterns on the Tags page: parsing, precedence and matching.
// Run: npx tsx scripts/tags-pattern.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPattern, notesForPattern, parsePattern, patternText, type TagEntry } from '../src/views/tags-model';

const text = (s: string): string => {
  const r = parsePattern(s);
  if (!r.ok) throw new Error(r.error);
  return patternText(r.p);
};

test('and binds tighter than or, not tightest; side by side means and', () => {
  assert.equal(text('a or b and c'), 'a or (b and c)');
  assert.equal(text('a b'), 'a and b');
  assert.equal(text('session or (memora and plan) not docker'), 'session or (memora and plan and not docker)');
  assert.equal(text('(a or b) and not c'), '(a or b) and not c');
  assert.equal(text('#a | #b & -c'), 'a or (b and not c)');
  assert.equal(text('a, b'), 'a or b');
});

test('broken patterns say what is wrong', () => {
  for (const s of ['', '(a or b', 'a or', 'and a', 'a )', 'a or ? b']) {
    const r = parsePattern(s);
    assert.equal(r.ok, false, s);
  }
});

test('matching ignores case and follows the logic', () => {
  const r = parsePattern('Session or (memora and plan) not docker');
  assert.ok(r.ok);
  if (!r.ok) return;
  const m = (...t: string[]): boolean => matchPattern(r.p, new Set(t));
  assert.ok(m('session'));
  assert.ok(m('memora', 'plan'));
  assert.ok(!m('memora'));
  assert.ok(!m('memora', 'plan', 'docker'));
  assert.deepEqual(r.tags, ['session', 'memora', 'plan', 'docker']);
});

test('notes come once each, newest first', () => {
  const e = (path: string, mtime: number): TagEntry => ({ path, name: path, folder: '', mtime });
  const index = new Map<string, TagEntry[]>([
    ['a', [e('1.md', 1), e('2.md', 2)]],
    ['b', [e('2.md', 2), e('3.md', 3)]],
  ]);
  const r = parsePattern('a or b');
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(notesForPattern(index, r.p).map((x) => x.path), ['3.md', '2.md', '1.md']);
  const n = parsePattern('a not b');
  if (n.ok) assert.deepEqual(notesForPattern(index, n.p).map((x) => x.path), ['1.md']);
});
