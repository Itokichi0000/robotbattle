import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Environment, validated once at boot. Unsafe combinations stop the server with a clear
 * message instead of starting half-configured (spec §0 rule 8, §13.2).
 */

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4400),
  /** Public origin phones and wallets reach, e.g. https://sats-wars.example. */
  PUBLIC_BASE_URL: z.string().url().optional(),
  /** sandbox = fake money only, no keys needed. live = real Lightning (Phase 3/4, needs approval). */
  APP_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  OPERATOR_PASSWORD: z.string().optional(),
  DATABASE_PATH: z.string().default('data/sats-wars.db'),
  /** Free DEMO GUEST sign-in (sandbox / exhibition demo only). */
  DEMO_GUEST_ENABLED: bool.optional(),
  MATCH_PRESET: z.enum(['STANDARD', 'SHORT', 'TEST']).default('STANDARD'),
  /** Fixed RNG seed for rehearsals and tests. Omit for a fresh seed every match. */
  MATCH_SEED: z.coerce.number().int().min(0).optional(),
  TRUST_PROXY: bool.default(false),
  /** Extra browser origins allowed to call cookie-authenticated endpoints (comma separated). */
  ALLOWED_ORIGINS: z.string().default(''),
  /** dev: serve the three apps through Vite middleware. static: serve apps/<app>/dist. */
  WEB_MODE: z.enum(['dev', 'static', 'none']).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema> & {
  demoGuestEnabled: boolean;
  webMode: 'dev' | 'static' | 'none';
  allowedOrigins: string[];
  operatorPasswordGenerated: boolean;
  operatorPassword: string;
};

export class EnvError extends Error {}

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

/** Loads ./.env (project root) when present. Real environment variables win. */
export function loadDotEnv(): void {
  const file = path.join(PROJECT_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function parseEnv(source: NodeJS.ProcessEnv, randomPassword: () => string): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(
      `Invalid environment:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  const e = parsed.data;
  const prod = e.NODE_ENV === 'production';
  const problems: string[] = [];

  if (e.APP_MODE === 'live') {
    problems.push(
      'APP_MODE=live is not available yet: LNURL-auth (Phase 3) and Lightning payments (Phase 4) ' +
        "are not implemented, and live payments need the owner's explicit approval. Use APP_MODE=sandbox.",
    );
  }
  let operatorPassword = e.OPERATOR_PASSWORD ?? '';
  let generated = false;
  if (!operatorPassword) {
    if (prod) problems.push('OPERATOR_PASSWORD is required in production.');
    operatorPassword = randomPassword();
    generated = true;
  } else if (prod && operatorPassword.length < 12) {
    problems.push('OPERATOR_PASSWORD must be at least 12 characters in production.');
  }
  if (prod) {
    if (!e.PUBLIC_BASE_URL) problems.push('PUBLIC_BASE_URL is required in production.');
    else if (!e.PUBLIC_BASE_URL.startsWith('https://')) {
      problems.push(
        'PUBLIC_BASE_URL must be https:// in production (wallet callbacks, secure cookies).',
      );
    }
    if (e.MATCH_PRESET === 'TEST') problems.push('MATCH_PRESET=TEST is for automated tests only.');
  }
  if (problems.length) throw new EnvError(problems.map((p) => `- ${p}`).join('\n'));

  const webMode = e.WEB_MODE ?? (prod ? 'static' : e.NODE_ENV === 'test' ? 'none' : 'dev');
  return {
    ...e,
    demoGuestEnabled: e.DEMO_GUEST_ENABLED ?? e.APP_MODE === 'sandbox',
    webMode,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
    operatorPasswordGenerated: generated,
    operatorPassword,
  };
}

/** Origin phones should open. Dev without PUBLIC_BASE_URL guesses the LAN address. */
export function publicBaseUrl(env: Env): string {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const host = lanAddress() ?? 'localhost';
  return `http://${host}:${env.PORT}`;
}
