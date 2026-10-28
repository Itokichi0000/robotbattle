import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const boolish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_PATH: z.string().default('./data/sats-wars-raid.db'),
  /** Comma-separated list of allowed browser origins. Empty = any (development only). */
  ALLOWED_ORIGINS: z.string().default(''),
  /** URL printed in the venue QR code. Must come from deployment config, never user input. */
  PUBLIC_PLAY_URL: z.string().default(''),
  PUBLIC_PARTICIPANT_URL: z.string().default(''),
  /** Public base URL of THIS server (LNURL-auth callback, LNbits webhook). Fixed; never taken from Host headers. */
  SERVER_PUBLIC_URL: z.string().default(''),
  EVENT_ID: z.string().min(1).max(64).default('local-demo'),
  ADMIN_PASSWORD: z.string().default(''),
  /** Demo mode: free passes, demo-only admin tools (time scale), labelled DEMO everywhere. */
  DEMO_MODE: boolish,
  /** mock = built-in mock wallet login (dev/demo); lnurl = real LNURL-auth only; both = either. */
  AUTH_MODE: z.enum(['mock', 'lnurl', 'both']).default('mock'),
  /** FREE (free event) or PAID (21-sat raid pass). Default: FREE in DEMO_MODE, PAID otherwise. */
  PASS_MODE: z.enum(['FREE', 'PAID']).optional(),
  TICKET_PRICE_SATS: z.coerce.number().int().min(0).max(100_000).optional(),
  RAID_SECONDS: z.coerce.number().int().min(60).max(3600).optional(),
  /** Secure cookies (HTTPS). Defaults to true in production. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  PAYMENT_MODE: z.enum(['mock', 'lnbits']).default('mock'),
  LNBITS_URL: z.string().default(''),
  /** LNbits *invoice/read* key. Never the admin key: this app never sends payments. */
  LNBITS_INVOICE_KEY: z.string().default(''),
  /** Random secret embedded in the webhook path so random POSTs are rejected early. */
  LNBITS_WEBHOOK_SECRET: z.string().default(''),
  /** Explicit acknowledgement required before real Lightning payments are enabled. */
  ALLOW_REAL_PAYMENTS: boolish,
  PAYEE_DESCRIPTION: z.string().default('SATS WARS 出撃パス / SATS WARS raid pass'),
  /** Demo pilots (BOT, no payments). Raids with bots never enter the leaderboard. */
  DEMO_BOTS: z.coerce.number().int().min(0).max(100).default(0),
  DEMO_BOT_SKILL: z.coerce.number().min(0).max(1).default(0.65),
  /** Rehearsal shortcut: 6 demo bots when DEMO_BOTS is 0. */
  DEMO_AUTOPILOT: boolish,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema> & {
  allowedOrigins: string[];
  adminPasswordGenerated: boolean;
  playUrl: string;
  passMode: 'FREE' | 'PAID';
  secureCookies: boolean;
  mockAuth: boolean;
  lnurlAuth: boolean;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  const prod = parsed.NODE_ENV === 'production';
  let adminPasswordGenerated = false;
  if (!parsed.ADMIN_PASSWORD) {
    if (prod) throw new Error('ADMIN_PASSWORD must be set in production');
    parsed.ADMIN_PASSWORD = randomBytes(9).toString('base64url');
    adminPasswordGenerated = true;
  }
  if (prod && parsed.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters in production');
  const allowedOrigins = parsed.ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (prod && allowedOrigins.length === 0) throw new Error('ALLOWED_ORIGINS must be set in production');
  // Mock login would let anyone mint pilots: never in production unless it is an explicit demo.
  if (prod && parsed.AUTH_MODE !== 'lnurl' && !parsed.DEMO_MODE) {
    throw new Error('AUTH_MODE must be lnurl in production (mock login is for DEMO_MODE only)');
  }
  const lnurlAuth = parsed.AUTH_MODE !== 'mock';
  if (lnurlAuth && !/^https:\/\//.test(parsed.SERVER_PUBLIC_URL) && prod) {
    throw new Error('LNURL-auth needs SERVER_PUBLIC_URL with https:// (wallets call it)');
  }
  if (parsed.PAYMENT_MODE === 'lnbits') {
    const missing = ['LNBITS_URL', 'LNBITS_INVOICE_KEY', 'LNBITS_WEBHOOK_SECRET'].filter((k) => !(parsed as Record<string, unknown>)[k]);
    if (missing.length) throw new Error(`PAYMENT_MODE=lnbits requires ${missing.join(', ')}`);
    if (!parsed.ALLOW_REAL_PAYMENTS) {
      throw new Error('PAYMENT_MODE=lnbits requires ALLOW_REAL_PAYMENTS=true (explicit owner approval). See docs/PAYMENT_FLOW.md');
    }
    if (prod && !/^https:\/\//.test(parsed.SERVER_PUBLIC_URL)) throw new Error('Real payments require an https:// SERVER_PUBLIC_URL');
  }
  return {
    ...parsed,
    allowedOrigins,
    adminPasswordGenerated,
    playUrl: parsed.PUBLIC_PARTICIPANT_URL || parsed.PUBLIC_PLAY_URL,
    passMode: parsed.PASS_MODE ?? (parsed.DEMO_MODE ? 'FREE' : 'PAID'),
    secureCookies: parsed.COOKIE_SECURE ? parsed.COOKIE_SECURE === 'true' : prod,
    mockAuth: parsed.AUTH_MODE !== 'lnurl',
    lnurlAuth,
  };
}
