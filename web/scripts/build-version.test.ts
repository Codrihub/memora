// Tests for the build version that decides when the app offers an update.
// Run: node --experimental-strip-types --test web/scripts/build-version.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOf, isNewBuild } from '../src/build-version.ts';
import { markSvg } from '../src/brand.ts';

test('buildOf reads the hash from a compiled sw.js', () => {
  const sw = `(() => {\n  const BUILD = "memora-build:42d9ab4eb1db".slice("memora-build:".length);\n})();`;
  assert.equal(buildOf(sw), '42d9ab4eb1db');
  assert.equal(buildOf(sw.replace(/"/g, "'")), '42d9ab4eb1db');
});

test('buildOf ignores a placeholder, a truncated file and unrelated text', () => {
  assert.equal(buildOf(`const BUILD = 'memora-build:__MEMORA_BUILD__'`), '');
  assert.equal(buildOf(`const BUILD = "memora-build:42d9ab`), '');
  assert.equal(buildOf('<!doctype html><title>Sign in</title>'), '');
  assert.equal(buildOf(''), '');
});

test('the sw.ts source carries the tag build-pages.mjs fills in', () => {
  const src = readFileSync(new URL('../src/sw.ts', import.meta.url), 'utf8');
  assert.ok(src.includes("'memora-build:__MEMORA_BUILD__'"));
  assert.equal(buildOf(src.replace('__MEMORA_BUILD__', '0123456789ab')), '0123456789ab');
});

test('only a different, known build is new', () => {
  assert.equal(isNewBuild('aaaaaaaaaaaa', 'aaaaaaaaaaaa'), false);
  assert.equal(isNewBuild('aaaaaaaaaaaa', 'bbbbbbbbbbbb'), true);
  assert.equal(isNewBuild('aaaaaaaaaaaa', ''), false);
  assert.equal(isNewBuild('', 'bbbbbbbbbbbb'), false);
});

test('marks rendered at build time get stable ids, so pages rebuild byte for byte', () => {
  const a = markSvg('x');
  const b = markSvg('x');
  assert.match(a, /id="mmgs\d+"/);
  assert.notEqual(a, b, 'two marks on one page need distinct ids');
  assert.doesNotMatch(a + b, /Math|NaN|undefined/);
});
