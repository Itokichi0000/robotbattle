import { resolve } from 'node:path';

/** Tiny `--name value` / `--flag` parser for the CLIs (no dependency). */
export function parseArgs(argv: string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const [key, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
    const next = argv[i + 1];
    if (inline !== undefined) out.set(key, inline);
    else if (next !== undefined && !next.startsWith('--')) {
      out.set(key, next);
      i++;
    } else out.set(key, true);
  }
  return out;
}

export function num(args: Map<string, string | true>, key: string, fallback: number): number {
  const v = args.get(key);
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a number (got ${v})`);
  return n;
}

export function str(args: Map<string, string | true>, key: string, fallback: string): string {
  const v = args.get(key);
  return typeof v === 'string' ? v : fallback;
}

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Output paths are relative to where the user ran pnpm (INIT_CWD), not the package. */
export function outPath(p: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), p);
}
