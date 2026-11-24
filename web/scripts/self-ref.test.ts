// A note never refers to itself in the lists and pickers that show links, mentions and boards.
// Run: node --experimental-strip-types --test web/scripts/self-ref.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSelfTarget, withoutSelf } from '../src/vault/self-ref.ts';

test('every way of writing a link to the note itself counts as itself', () => {
  const me = 'Work/Uji taruh gambar.md';
  for (const t of ['Uji taruh gambar', 'uji taruh gambar', 'Uji taruh gambar#Heading', 'Uji taruh gambar|me', 'Work/Uji taruh gambar', 'Uji taruh gambar.md', ' Uji taruh gambar '])
    assert.ok(isSelfTarget(t, me), t);
  for (const t of ['Other', 'Uji taruh', 'Else/Uji taruh gambar', '', '#Heading']) assert.ok(!isSelfTarget(t, me), t);
  assert.ok(!isSelfTarget('Anything', null));
});

test('pickers and lists leave the note itself out', () => {
  assert.deepEqual(withoutSelf(['Work/A.md', 'work/a', 'Work/B.md'], 'Work/A.md'), ['Work/B.md']);
  assert.deepEqual(withoutSelf(['Work/A.md'], ''), ['Work/A.md']);
});
