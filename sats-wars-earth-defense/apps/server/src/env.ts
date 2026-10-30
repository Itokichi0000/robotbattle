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
  /**
   * sandbox = VIRTUAL energy pulses only (no keys, nothing is ever charged).
   * live = real Lightning invoices through LNbits. Even then, payments stay OFF until the
   * operator runs the checks and approves them in /operator for this server run (spec §4.8).
   */
  APP_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  /** Receiving backend for live mode. Only LNbits is implemented (invoice/read key only). */
  LIGHTNING_PROVIDER: z.enum(['lnbits']).default('lnbits'),
  LNBITS_URL: z.string().url().optional(),
  /** Invoice/read key. Never an admin key: the server only creates and reads invoices. */
  LNBITS_INVOICE_KEY: z.string().min(16).max(128).optional(),
  /** Shown to the payer before every payment: who receives the sats (spec §8.3). */
  PAYMENT_RECIPIENT_LABEL: z.string().min(2).max(80).optional(),
  /** Fixed size of one shared energy pulse in sats (default 21). Bigger never means stronger. */
  PULSE_AMOUNT_SATS: z.coerce.number().int().min(1).max(10_000).optional(),
  /** Secret in the LNbits webhook URL; generated per run when unset. */
  LNBITS_WEBHOOK_SECRET: z.string().min(16).max(128).optional(),
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
  webhookSecret: string;
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

export function parseEnv(
  source: NodeJS.ProcessEnv,
  randomPassword: () => string,
  randomSecret: () => string = randomPassword,
): Env {
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
    // Real money needs a real receiver, a public https callback and a label for the payer.
    if (!e.LNBITS_URL) problems.push('APP_MODE=live needs LNBITS_URL.');
    else if (prod && !e.LNBITS_URL.startsWith('https://')) {
      problems.push('LNBITS_URL must be https:// in production.');
    }
    if (!e.LNBITS_INVOICE_KEY)
      problems.push('APP_MODE=live needs LNBITS_INVOICE_KEY (invoice/read key).');
    if (!e.PAYMENT_RECIPIENT_LABEL) {
      problems.push('APP_MODE=live needs PAYMENT_RECIPIENT_LABEL (shown to every payer).');
    }
    if (!e.PUBLIC_BASE_URL?.startsWith('https://')) {
      problems.push(
        'APP_MODE=live needs an https:// PUBLIC_BASE_URL (wallets and webhooks reach it).',
      );
    }
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
    webhookSecret: e.LNBITS_WEBHOOK_SECRET ?? randomSecret(),
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
