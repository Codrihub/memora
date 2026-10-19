// Assemble the npm packages for one Memora release from its built binaries.
//
//   node npm/build.ts --version 1.2.1 --out npm-dist --assets crates/http/assets \
//     --bin linux-x64=dist/bin/amd64 --bin linux-arm64=dist/bin/arm64 \
//     --bin win32-x64=dist/bin/windows-amd64
//
// Writes <out>/memora (the @codrihub/memora wrapper: launcher + web UI assets)
// and <out>/memora-<platform> for every --bin given, each a folder ready for
// `npm pack` / `npm publish`. Every package gets the release version, and the
// wrapper pins each platform package to it exactly. Needs Node 22.13 or newer
// (module.stripTypeScriptTypes); the published packages run on Node 18+.

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PLATFORMS, binaryFile, type Binary } from './src/launcher.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const BINARIES: Binary[] = ['memora', 'memora-cli'];

const common = {
  license: 'MIT',
  author: 'Codrihub',
  homepage: 'https://github.com/Codrihub/memora#readme',
  bugs: { url: 'https://github.com/Codrihub/memora/issues' },
  repository: { type: 'git', url: 'git+https://github.com/Codrihub/memora.git', directory: 'npm' },
};

function die(msg: string): never {
  console.error(`build.ts: ${msg}`);
  process.exit(1);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    out: { type: 'string' },
    assets: { type: 'string' },
    bin: { type: 'string', multiple: true },
  },
});
const version = values.version ?? die('--version is required');
if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(version)) die(`'${version}' is not MAJOR.MINOR.PATCH[-pre]`);
const out = resolve(values.out ?? die('--out is required'));
const assets = resolve(values.assets ?? die('--assets is required'));
if (!existsSync(join(assets, 'index.html'))) die(`${assets} has no index.html (build the web UI first)`);

const bins = new Map<string, string>();
for (const spec of values.bin ?? []) {
  const [key, dir] = spec.split('=', 2);
  if (!PLATFORMS[key] || !dir) die(`--bin ${spec}: expected <${Object.keys(PLATFORMS).join('|')}>=<dir>`);
  bins.set(key, resolve(dir));
}
if (bins.size === 0) die('give at least one --bin <platform>=<dir>');

rmSync(out, { recursive: true, force: true });

// ------------------------------------------------------------ platform packages
for (const [key, dir] of bins) {
  const { pkg, os, cpu } = PLATFORMS[key];
  const dest = join(out, `memora-${key}`);
  mkdirSync(join(dest, 'bin'), { recursive: true });
  for (const name of BINARIES) {
    const file = binaryFile(name, os);
    const src = join(dir, file);
    if (!existsSync(src)) die(`${src} is missing`);
    copyFileSync(src, join(dest, 'bin', file));
    chmodSync(join(dest, 'bin', file), 0o755);
    // A binary from another release would be published under this version.
    if (key === `${process.platform}-${process.arch}`) {
      const got = execFileSync(join(dest, 'bin', file), ['--version'], { encoding: 'utf8' }).trim();
      if (got !== `${name} ${version}`) die(`${src} reports '${got}', expected '${name} ${version}'`);
    }
  }
  copyFileSync(join(root, 'LICENSE'), join(dest, 'LICENSE'));
  writeFileSync(
    join(dest, 'README.md'),
    `# ${pkg}\n\nThe ${os} ${cpu} binaries (\`memora\`, \`memora-cli\`) of Memora ${version}.\n\n` +
      'Install [`@codrihub/memora`](https://www.npmjs.com/package/@codrihub/memora) instead; it picks this package on matching machines.\n',
  );
  writeJson(join(dest, 'package.json'), {
    name: pkg,
    version,
    description: `Memora ${os} ${cpu} binaries, installed by @codrihub/memora`,
    ...common,
    os: [os],
    cpu: [cpu],
    files: ['bin'],
    preferUnplugged: true,
  });
  console.log(`${pkg}@${version} -> ${dest}`);
}

// -------------------------------------------------------------------- wrapper
const wrapper = join(out, 'memora');
mkdirSync(join(wrapper, 'bin'), { recursive: true });
mkdirSync(join(wrapper, 'lib'), { recursive: true });
const launcher = readFileSync(join(here, 'src', 'launcher.ts'), 'utf8');
writeFileSync(join(wrapper, 'lib', 'launcher.js'), stripTypeScriptTypes(launcher, { mode: 'strip' }));
for (const name of BINARIES) {
  const shim = join(wrapper, 'bin', `${name}.js`);
  writeFileSync(shim, `#!/usr/bin/env node\nimport { run } from '../lib/launcher.js';\n\nrun('${name}');\n`);
  chmodSync(shim, 0o755);
}
cpSync(assets, join(wrapper, 'assets'), { recursive: true });
copyFileSync(join(root, 'LICENSE'), join(wrapper, 'LICENSE'));
copyFileSync(join(here, 'README.md'), join(wrapper, 'README.md'));
writeJson(join(wrapper, 'package.json'), {
  name: '@codrihub/memora',
  version,
  description: 'Self-hosted memory vault for AI agents: the Memora server (HTTP, MCP, web UI) and the memora-cli console',
  keywords: ['memora', 'mcp', 'model-context-protocol', 'ai-agents', 'memory', 'knowledge-base', 'markdown', 'self-hosted'],
  ...common,
  type: 'module',
  bin: Object.fromEntries(BINARIES.map((name) => [name, `bin/${name}.js`])),
  files: ['bin', 'lib', 'assets'],
  engines: { node: '>=18' },
  optionalDependencies: Object.fromEntries(Object.values(PLATFORMS).map((p) => [p.pkg, version])),
});
console.log(`@codrihub/memora@${version} -> ${wrapper}`);

const skipped = Object.keys(PLATFORMS).filter((k) => !bins.has(k));
if (skipped.length) console.warn(`warning: no --bin for ${skipped.join(', ')}; publish those packages too or installs there fail`);
