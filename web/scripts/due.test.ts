// Due dates: late, today, counts, and the board's own date colours (Obsidian Kanban's rules).
// Run: node --experimental-strip-types --test web/scripts/due.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateColorFor, dueCounts, dueState } from '../src/views/due.ts';

const now = new Date(2026, 10, 24, 15, 30); // 24 Nov 2026, local time

test('late, today and later', () => {
  assert.equal(dueState('2026-11-23', '2026-11-24'), 'late');
  assert.equal(dueState('2026-11-24', '2026-11-24'), 'today');
  assert.equal(dueState('2026-11-25', '2026-11-24'), 'later');
  assert.deepEqual(dueCounts(['2026-11-01', '2026-11-24', '2026-12-01', 'soon', '2025-01-01'], '2026-11-24'), { late: 2, today: 1 });
  assert.deepEqual(dueCounts(undefined, '2026-11-24'), { late: 0, today: 0 });
});

test('no rules, no colour', () => {
  assert.equal(dateColorFor('2026-11-20', undefined, now), null);
  assert.equal(dateColorFor('2026-11-20', [], now), null);
  assert.equal(dateColorFor('not a date', [{ isBefore: true, color: '#f00' }], now), null);
});

test('rules pick as the plugin does: today first, ranges by their far end, before and after last', () => {
  const rules = [
    { isBefore: true, color: 'red' },
    { isAfter: true, color: 'grey' },
    { distance: 7, unit: 'days', direction: 'after', color: 'blue' },
    { distance: 2, unit: 'days', direction: 'after', color: 'orange' },
    { isToday: true, color: 'green', backgroundColor: '#efe' },
  ];
  assert.deepEqual(dateColorFor('2026-11-24', rules, now), { color: 'green', background: '#efe' });
  assert.equal(dateColorFor('2026-11-25', rules, now)?.color, 'orange');
  assert.equal(dateColorFor('2026-11-29', rules, now)?.color, 'blue');
  assert.equal(dateColorFor('2026-12-20', rules, now)?.color, 'grey');
  assert.equal(dateColorFor('2026-11-01', rules, now)?.color, 'red');
  assert.equal(dateColorFor('2026-11-22', [{ distance: 1, unit: 'weeks', direction: 'before', color: 'pink' }], now)?.color, 'pink');
  assert.equal(dateColorFor('2026-11-10', [{ distance: 1, unit: 'weeks', direction: 'before', color: 'pink' }], now), null);
  // Without a today rule, today is "before now" as in Obsidian.
  assert.equal(dateColorFor('2026-11-24', [{ isBefore: true, color: 'red' }], now)?.color, 'red');
  // A rule with no colour is skipped.
  assert.equal(dateColorFor('2026-11-01', [{ isBefore: true }], now), null);
});

test('a link in a card title reads as its text', async () => {
  const { plainTitle } = await import('../src/views/due.ts');
  assert.equal(plainTitle('Write [[Launch notes]] and [[Plan|the plan]] #web'), 'Write Launch notes and the plan #web');
});
