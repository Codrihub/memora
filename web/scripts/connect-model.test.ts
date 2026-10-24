// Tests for the connect flow's pure logic.
// Run: node --experimental-strip-types --test web/scripts/connect-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createdBy,
  cursorLink,
  firstPrompts,
  howLabel,
  isLocalAddress,
  KEY_DOTS,
  maskKey,
  oneClickLink,
  setupText,
  titleOfPath,
  vscodeLink,
} from '../src/control/connect-model.ts';

const URL_ = 'https://memora.example.com/mcp';
const KEY = 'memora_live_0123456789abcdef0123456789abcdef';

test('tile labels are plain', () => {
  assert.equal(howLabel('signin'), 'One click');
  assert.equal(howLabel('deeplink'), 'One click');
  assert.equal(howLabel('command'), 'Copy setup');
  assert.equal(howLabel('copy'), 'Copy setup');
});

test('the masked key hides the middle', () => {
  const m = maskKey(KEY);
  assert.ok(m.startsWith('memora_live_'));
  assert.ok(m.endsWith('cdef'));
  assert.ok(!m.includes('0123456789abcdef0123'));
  assert.equal(maskKey('short'), '••••••••');
});

test('setup text shown on screen never holds the key', () => {
  for (const app of ['claude-code', 'codex', 'gemini', 'cursor', 'vscode', 'windsurf', 'claude-desktop', 'http']) {
    const shown = setupText(app, URL_, KEY_DOTS);
    assert.ok(!shown.includes(KEY), app);
    assert.ok(shown.includes(KEY_DOTS), app);
    assert.ok(setupText(app, URL_, KEY).includes(KEY), app);
  }
  assert.equal(setupText('claude-ai', URL_, KEY), URL_);
});

test('terminal apps get one command', () => {
  const cc = setupText('claude-code', URL_, KEY);
  assert.ok(cc.startsWith('claude mcp add '));
  assert.ok(!cc.includes('\n'));
  assert.ok(setupText('gemini', URL_, KEY).startsWith('gemini mcp add '));
});

test('one-click links carry the server', () => {
  const c = cursorLink(URL_, KEY);
  assert.ok(c.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=memora&config='));
  const cfg = JSON.parse(atob(decodeURIComponent(c.split('config=')[1])));
  assert.deepEqual(cfg, { url: URL_, headers: { Authorization: `Bearer ${KEY}` } });
  const v = vscodeLink(URL_, KEY);
  assert.ok(v.startsWith('vscode:mcp/install?'));
  const vc = JSON.parse(decodeURIComponent(v.slice('vscode:mcp/install?'.length)));
  assert.equal(vc.name, 'memora');
  assert.equal(vc.type, 'http');
  assert.equal(vc.url, URL_);
  assert.equal(oneClickLink('claude-code', URL_, KEY), '');
});

test('local addresses are recognised', () => {
  for (const u of ['http://localhost:8300/mcp', 'http://127.0.0.1:8300', 'http://192.168.1.4/mcp', 'http://10.0.0.2', 'http://172.20.1.1', 'http://nas.local', 'http://[::1]:8300'])
    assert.ok(isLocalAddress(u), u);
  for (const u of ['https://memora.example.com/mcp', 'http://172.32.0.1', 'not a url']) assert.ok(!isLocalAddress(u), u);
});

test('first prompts fit the app', () => {
  const coding = firstPrompts('cursor');
  assert.equal(coding.length, 3);
  assert.equal(coding[0].id, 'saveAll');
  assert.ok(coding[0].recommended && !coding[1].recommended && !coding[2].recommended);
  assert.equal(coding[1].id, 'project');
  assert.equal(firstPrompts('chatgpt')[1].id, 'work');
  assert.equal(firstPrompts('chatgpt')[2].id, 'slow');
});

test('notes created by one agent, newest first, once per path', () => {
  const ev = [
    { type: 'node_created', actor: 'Cursor', _ts: 100, node: { path: 'Old.md' } },
    { type: 'node_created', actor: 'Cursor', _ts: 210, node: { path: 'Projects/A_b.md' } },
    { type: 'node_created', actor: 'Other', _ts: 220, node: { path: 'X.md' } },
    { type: 'node_updated', actor: 'Cursor', _ts: 230, node: { path: 'Y.md' } },
    { type: 'node_created', actor: 'Cursor', _ts: 240, node: { path: 'B.md' } },
    { type: 'node_created', actor: 'Cursor', _ts: 250, node: { path: 'Projects/A_b.md' } },
  ];
  assert.deepEqual(createdBy(ev, 'Cursor', 200), [
    { path: 'Projects/A_b.md', at: 250 },
    { path: 'B.md', at: 240 },
  ]);
  assert.equal(titleOfPath('Projects/A_b.md'), 'A b');
});
