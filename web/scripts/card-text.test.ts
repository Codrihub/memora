// Tests for the card form's text model: a card's text into fields and back.
// Run: node --experimental-strip-types --test web/scripts/card-text.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, writeCard } from '../src/views/card-text.ts';

const same = (text: string, settings = {}): void => {
  const p = parseCard(text, settings);
  assert.equal(writeCard(p, { ...p.fields }, settings), text, JSON.stringify(text));
};

test('a card nobody changed comes back byte for byte', () => {
  for (const s of [
    'Research [[Atlas Project]] options #research @{2026-01-12}',
    'Call the printer @{2026-02-01} @@{10:30} ^ab12cd',
    'Write [[Chapter 1|the first chapter]] #writing',
    'Plain card',
    '#first tag then text',
    'Two #a #b tags  with double  spaces',
    'Draft the outline\nSecond line of the card\n- nested point #x',
    'An embed ![[Board]] stays text and so does a url http://x.example/#frag',
    '',
    'Odd date @{not a date} stays text',
  ])
    same(s);
});

test('fields hold the pieces, the text the rest', () => {
  const p = parseCard('Research [[Atlas Project]] options #research @{2026-01-12} @@{09:05}');
  assert.deepEqual(p.fields, { text: 'Research options', links: ['Atlas Project'], tags: ['research'], date: '2026-01-12', time: '09:05', checklist: [] });
  assert.equal(p.block, '');
  assert.equal(parseCard('Odd date @{not a date}').fields.date, '');
  assert.equal(parseCard('Odd date @{not a date}').fields.text, 'Odd date @{not a date}');
});

test('editing the text keeps the pieces in their place', () => {
  const p = parseCard('Research [[Atlas]] options #research');
  assert.equal(p.fields.text, 'Research options');
  assert.equal(writeCard(p, { ...p.fields, text: 'Research the options' }), 'Research [[Atlas]] the options #research');
  assert.equal(writeCard(p, { ...p.fields, text: 'Look into options' }), 'Look into [[Atlas]] options #research');
});

test('removed pieces go, new ones join the first line', () => {
  const p = parseCard('Plan [[A]] #x\nmore text');
  assert.equal(writeCard(p, { ...p.fields, links: [], tags: ['x', 'y'], date: '2026-03-04' }), 'Plan #x #y @{2026-03-04}\nmore text');
  const q = parseCard('Ship it @{2026-01-01}');
  assert.equal(writeCard(q, { ...q.fields, date: '2026-02-02' }), 'Ship it @{2026-02-02}');
  assert.equal(writeCard(q, { ...q.fields, date: '' }), 'Ship it');
  assert.equal(writeCard(q, { ...q.fields, time: '14:30' }), 'Ship it @{2026-01-01} @@{14:30}');
  const r = parseCard('');
  assert.equal(writeCard(r, { text: 'New card', links: ['Note'], tags: ['t'], date: '', time: '', checklist: [] }), 'New card [[Note]] #t');
});

test('the board settings choose the triggers and formats', () => {
  const s = { 'date-trigger': '!', 'date-format': 'DD/MM/YYYY', 'time-trigger': '!!' };
  const p = parseCard('Pay rent !{01/02/2026} !!{9:30}', s);
  assert.equal(p.fields.date, '2026-02-01');
  assert.equal(p.fields.time, '09:30');
  same('Pay rent !{01/02/2026} !!{9:30}', s);
  assert.equal(writeCard(p, { ...p.fields, date: '2026-12-25' }, s), 'Pay rent !{25/12/2026} !!{9:30}');
});

test('a checklist under the card is its own field', () => {
  const text = 'Launch #x\nsome notes\n- [ ] Write copy\n- [x] Pick a date\nafter';
  same(text);
  const p = parseCard(text);
  assert.deepEqual(p.fields.checklist, [
    { text: 'Write copy', done: false },
    { text: 'Pick a date', done: true },
  ]);
  assert.equal(p.fields.text, 'Launch\nsome notes\nafter');
  // Tick one, add one: the list stays where it was.
  assert.equal(
    writeCard(p, { ...p.fields, checklist: [{ text: 'Write copy', done: true }, { text: 'Pick a date', done: true }, { text: 'Book a room', done: false }] }),
    'Launch #x\nsome notes\n- [x] Write copy\n- [x] Pick a date\n- [ ] Book a room\nafter',
  );
  // A card with no checklist gets one under its text.
  const q = parseCard('Plan');
  assert.equal(writeCard(q, { ...q.fields, checklist: [{ text: 'One', done: false }] }), 'Plan\n- [ ] One');
  // Removing every step removes the lines.
  assert.equal(writeCard(p, { ...p.fields, checklist: [] }), 'Launch #x\nsome notes\nafter');
  // Indented steps keep their indent when nobody changed them.
  same('Card\n\t- [ ] tabbed step');
});

test('steps stay on their own lines, and the block id stays out of the form', () => {
  // A note between two steps stays between them on an unrelated save.
  const t1 = 'Title #x\n- [ ] a\nnote under a\n- [x] b';
  const p1 = parseCard(t1);
  assert.equal(writeCard(p1, { ...p1.fields, tags: ['x', 'y'] }), 'Title #x #y\n- [ ] a\nnote under a\n- [x] b');
  // Steps written with a tab, several spaces or no text are steps too.
  const p2 = parseCard('Card\n-\t[ ] tabbed\n-   [x] spaced\n- [ ]');
  assert.deepEqual(p2.fields.checklist, [
    { text: 'tabbed', done: false },
    { text: 'spaced', done: true },
    { text: '', done: false },
  ]);
  // The block id is kept off the text and put back on the first line.
  const p3 = parseCard('Draft the outline ^k3x9a2\n- [ ] a');
  assert.equal(p3.fields.text, 'Draft the outline');
  assert.equal(p3.block, ' ^k3x9a2');
  same('Draft the outline ^k3x9a2\n- [ ] a');
  assert.equal(writeCard(p3, { ...p3.fields, text: 'Draft it' }), 'Draft it ^k3x9a2\n- [ ] a');
  // On the last line (a step), it is not part of the step.
  const p4 = parseCard('Card\n- [ ] a ^abc123');
  assert.deepEqual(p4.fields.checklist, [{ text: 'a', done: false }]);
  assert.equal(writeCard(p4, { ...p4.fields, checklist: [{ text: 'a', done: true }] }), 'Card ^abc123\n- [x] a');
});
