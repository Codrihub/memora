// Render the favicon and the PWA icons from the brand mark in src/brand.ts.
//
//   node scripts/icons.ts            # writes into crates/http/assets
//   MEMORA_ASSETS_OUT=./icons-out node scripts/icons.ts
//
// PNGs are screenshots of the SVG taken with headless Chrome at the exact
// pixel size (override the binary with CHROME=...). File names are fixed: the
// server whitelists them.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { faviconSvg, iconSvg, shortcutSvg, type IconKind } from '../src/brand.ts';
import { iconPaths } from '../src/ui/icons.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.MEMORA_ASSETS_OUT || join(web, '..', 'crates', 'http', 'assets');
const chrome = process.env.CHROME || 'google-chrome';
mkdirSync(out, { recursive: true });

const targets: Array<{ name: string; size: number; svg: string }> = [
  ...([
    ['icon-192.png', 192, 'any'],
    ['icon-512.png', 512, 'any'],
    ['icon-maskable-512.png', 512, 'maskable'],
    ['apple-touch-icon.png', 180, 'apple'],
  ] as Array<[string, number, IconKind]>).map(([name, size, kind]) => ({ name, size, svg: iconSvg(size, kind) })),
  // Long-press shortcuts of the installed app (manifest.webmanifest).
  ...(['brain', 'note', 'activity'] as const).map((g) => ({
    name: `shortcut-${g === 'note' ? 'nodes' : g}.png`,
    size: 96,
    svg: shortcutSvg(96, iconPaths(g)),
  })),
];

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const work = mkdtempSync(join(tmpdir(), 'memora-icons-'));
try {
  for (const t of targets) {
    const page = join(work, t.name + '.html');
    writeFileSync(
      page,
      `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body>${t.svg}</body></html>`,
    );
    const dest = join(out, t.name);
    execFileSync(
      chrome,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--window-size=${t.size},${t.size}`,
        `--screenshot=${dest}`,
        'file://' + page,
      ],
      { stdio: 'ignore' },
    );
    const [w, h] = pngSize(dest);
    if (w !== t.size || h !== t.size) throw new Error(`${t.name}: got ${w}x${h}, want ${t.size}`);
    console.log(`  ${t.name} (${w}x${h})`);
  }
  writeFileSync(join(out, 'favicon.svg'), faviconSvg() + '\n');
  console.log('  favicon.svg');
} finally {
  rmSync(work, { recursive: true, force: true });
}
