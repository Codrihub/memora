// The `memora` and `memora-cli` commands of the @codrihub/memora npm package.
//
// npm installs exactly one platform package (an optionalDependency whose
// `os`/`cpu` match this machine) holding the prebuilt release binaries; this
// launcher finds it and runs the binary with the same arguments, stdio and exit
// code. Nothing is downloaded at install time.
//
// build.ts compiles this file to lib/launcher.js (types stripped, no bundling),
// so it may only use Node built-ins and erasable TypeScript syntax.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Binary = 'memora' | 'memora-cli';

export interface Platform {
  /** npm package holding bin/memora and bin/memora-cli. */
  pkg: string;
  /** Values for the package's `os` and `cpu` fields. */
  os: string;
  cpu: string;
}

/** `${process.platform}-${process.arch}` -> platform package. One per release build. */
export const PLATFORMS: Record<string, Platform> = {
  'linux-x64': { pkg: '@codrihub/memora-linux-x64', os: 'linux', cpu: 'x64' },
  'linux-arm64': { pkg: '@codrihub/memora-linux-arm64', os: 'linux', cpu: 'arm64' },
};

const REPO = 'https://github.com/Codrihub/memora';

function fail(lines: string[]): never {
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(1);
}

function binaryPath(name: Binary): string {
  const key = `${process.platform}-${process.arch}`;
  const platform = PLATFORMS[key];
  if (!platform) {
    fail([
      `${name}: there is no prebuilt Memora binary for ${process.platform}/${process.arch}.`,
      `The npm package ships Linux binaries only (${Object.keys(PLATFORMS).join(', ')}).`,
      '',
      'Other ways to run Memora:',
      `  Docker (any OS):  ghcr.io/codrihub/memora, see ${REPO}#docker-compose`,
      `  From source:      cargo build --release, see ${REPO}#from-source`,
      ...(process.platform === 'win32' ? ['  On Windows you can also install it inside WSL 2: npm install -g @codrihub/memora'] : []),
    ]);
  }
  let pkgDir: string;
  try {
    pkgDir = dirname(createRequire(import.meta.url).resolve(`${platform.pkg}/package.json`));
  } catch {
    fail([
      `${name}: the package ${platform.pkg} is not installed.`,
      'npm installs it as an optional dependency of @codrihub/memora, so it is left out',
      'by --omit=optional (or --no-optional) and by lockfiles made on another platform.',
      'Reinstall without that flag, for example: npm install -g @codrihub/memora',
    ]);
  }
  return join(pkgDir, 'bin', name);
}

export function run(name: Binary): void {
  const bin = binaryPath(name);
  const env = { ...process.env };
  // The web UI ships in this package; an explicit MEMORA_ASSETS still wins.
  if (name === 'memora' && !env.MEMORA_ASSETS) {
    env.MEMORA_ASSETS = join(dirname(dirname(fileURLToPath(import.meta.url))), 'assets');
  }

  const child = spawn(bin, process.argv.slice(2), { stdio: 'inherit', env });

  // Ctrl-C reaches the whole foreground process group, so the child already has
  // SIGINT; only keep Node from dying first. Signals sent to this pid alone (a
  // process manager stopping the service) are passed on.
  const handlers: [NodeJS.Signals, () => void][] = [
    ['SIGINT', () => {}],
    ['SIGTERM', () => child.kill('SIGTERM')],
    ['SIGHUP', () => child.kill('SIGHUP')],
  ];
  for (const [sig, h] of handlers) process.on(sig, h);

  child.on('error', (e) => fail([`${name}: cannot run ${bin}: ${e.message}`]));
  child.on('exit', (code, signal) => {
    for (const [sig, h] of handlers) process.off(sig, h);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}
