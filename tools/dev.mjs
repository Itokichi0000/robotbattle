#!/usr/bin/env node
// One-command local launcher: game server (:4000) + web (:3000).
// Usage: pnpm dev            (development, hot reload)
//        pnpm start          (after pnpm build; production mode)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] === 'start' ? 'start' : 'dev';

// Minimal .env loader (no dependency). Real secrets stay in .env, which is gitignored.
const env = { ...process.env };
const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
env.DATABASE_PATH ??= resolve(root, 'data/sats-wars.db');
if (mode === 'start') env.NODE_ENV ??= 'production';

const procs = [
  { name: 'server', color: '\x1b[33m', args: ['--filter', '@sats-wars/server', mode] },
  { name: 'web', color: '\x1b[36m', args: ['--filter', '@sats-wars/web', mode] },
].map(({ name, color, args }) => {
  const p = spawn('pnpm', args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (buf) => {
      for (const line of buf.toString().split('\n')) if (line.trim()) out.write(prefix + line + '\n');
    });
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${prefix}exited with ${code}`);
    shutdown(code ?? 0);
  });
  return p;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(`\nSATS WARS ${mode}:\n  /        http://localhost:3000/\n  /play    http://localhost:3000/play\n  /arena   http://localhost:3000/arena\n  /admin   http://localhost:3000/admin\n  server   http://localhost:4000/health\n`);
