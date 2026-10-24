// Tests for the notes area's pure text helpers (titles, relative times, Trash rows).
// Run: node --experimental-strip-types --test web/scripts/notes-text.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relTs, stemTitle } from '../src/format.ts';
import { deletedTs, itemTitle, matchesTrash, originPlaces, placeOf, restoreInto, whoLabel } from '../src/vault/trash-model.ts';

test('file names read as titles without underscores', () => {
  assert.equal(stemTitle('Sprint_retro'), 'Sprint retro');
  assert.equal(stemTitle('Already spaced'), 'Already spaced');
  assert.equal(stemTitle('___'), '___');
});

test('relative times use whole words', () => {
  const now = Date.now() / 1000;
  assert.equal(relTs(now - 5), 'just now');
  assert.equal(relTs(now - 60), '1 minute ago');
  assert.equal(relTs(now - 5 * 60), '5 minutes ago');
  assert.equal(relTs(now - 3600), '1 hour ago');
  assert.equal(relTs(now - 12 * 86400), '12 days ago');
  assert.match(relTs(now - 90 * 86400), /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  assert.equal(relTs(0), '-');
});

test('trash rows show a title, the old place and who deleted the note', () => {
  const it = {
    name: 'Launch_plan-1.md',
    original: 'Projects/Atlas/Launch_plan.md',
    deleted: '2026-10-23T08:55:53+09:00',
    by: { id: 'k1', name: 'Claude Code', kind: 'agent' },
  };
  assert.equal(itemTitle(it), 'Launch plan');
  assert.equal(itemTitle({ ...it, title: 'The launch' }), 'The launch');
  assert.equal(itemTitle({ name: 'Old_note.md' }), 'Old note');
  assert.equal(placeOf(it), 'Projects/Atlas');
  assert.equal(placeOf({ name: 'x.md', original: 'x.md' }), '');
  assert.equal(deletedTs(it), Date.parse('2026-10-23T08:55:53+09:00') / 1000);
  assert.equal(deletedTs({ name: 'x.md', deleted: null }), 0);
  assert.equal(whoLabel(it), 'Claude Code');
  assert.equal(whoLabel({ ...it, by: { id: 'owner', name: 'owner', kind: 'user' } }), 'you');
  assert.equal(whoLabel({ name: 'x.md', by: null }), '');
});

test('a restore goes back where a note was, or to the folder picked', () => {
  assert.equal(restoreInto({ to: 'origin' }), undefined);
  // The top level is sent as `Root`: an empty `into` means the original place on the server.
  assert.equal(restoreInto({ to: 'folder', folder: '' }), 'Root');
  assert.equal(restoreInto({ to: 'folder', folder: 'Projects/Atlas' }), 'Projects/Atlas');
  const a = { name: 'a.md', original: 'Projects/a.md' };
  const b = { name: 'b.md', original: 'b.md' };
  const c = { name: 'c.md', original: 'Projects/c.md' };
  assert.deepEqual(originPlaces([a, b, c]), ['Projects', '']);
});

test('the Trash search matches titles and old folders', () => {
  const it = { name: 'Café_notes.md', original: 'Journal/2026/Café_notes.md' };
  assert.ok(matchesTrash(it, 'cafe'));
  assert.ok(matchesTrash(it, 'journal/2026'));
  assert.ok(matchesTrash(it, '  '));
  assert.ok(!matchesTrash(it, 'roadmap'));
});
