// Rebuild the UI into crates/http/assets whenever a file under web/src changes.
// The server reads assets from disk on every request, so a browser refresh
// picks up the new build without restarting memora.

import { readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(web, 'src');

let running = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function stamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function build(): void {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const started = Date.now();
  const child = spawn('npm', ['run', '--silent', 'build'], { cwd: web, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.on('close', (code) => {
    running = false;
    if (code === 0) {
      console.log(`[${stamp()}] rebuilt in ${Date.now() - started}ms`);
    } else {
      console.error(`[${stamp()}] build FAILED (exit ${code})\n${out}`);
    }
    if (pending) {
      pending = false;
      build();
    }
  });
}

// Poll file mtimes instead of fs.watch: recursive fs.watch on Linux misses
// writes that replace a file in place. The tree is small, so a scan is cheap.
function snapshot(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) snapshot(path, out);
    else if (!entry.name.includes('.tmp.') && !entry.name.endsWith('~')) {
      try {
        const st = statSync(path);
        out.set(path, `${st.mtimeMs}:${st.size}`);
      } catch {
        /* removed between readdir and stat */
      }
    }
  }
  return out;
}

let last = snapshot(src);
setInterval(() => {
  const now = snapshot(src);
  const changed: string[] = [];
  for (const [path, sig] of now) if (last.get(path) !== sig) changed.push(path);
  for (const path of last.keys()) if (!now.has(path)) changed.push(path);
  last = now;
  if (changed.length === 0) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`[${stamp()}] changed: ${changed.map((p) => p.slice(src.length + 1)).join(', ')}`);
    build();
  }, 100);
}, 300);

console.log(`[${stamp()}] watching ${src}`);
build();
