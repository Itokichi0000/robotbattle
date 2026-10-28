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
  DATABASE_PATH: z.string().default('./data/sats-wars.db'),
  /** Comma-separated list of allowed browser origins. Empty = any (development only). */
  ALLOWED_ORIGINS: z.string().default(''),
  /** URL printed in the venue QR code. Must come from deployment config, never user input. */
  PUBLIC_PLAY_URL: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  PAYMENT_MODE: z.enum(['mock', 'lnbits']).default('mock'),
  LNBITS_URL: z.string().default(''),
  /** LNbits *invoice/read* key. Never the admin key: this app never sends payments. */
  LNBITS_INVOICE_KEY: z.string().default(''),
  /** Random secret embedded in the webhook path so random POSTs are rejected early. */
  LNBITS_WEBHOOK_SECRET: z.string().default(''),
  /** Public base URL of THIS server as reachable by LNbits (for webhooks). */
  SERVER_PUBLIC_URL: z.string().default(''),
  /** Explicit acknowledgement required before real Lightning payments are enabled. */
  ALLOW_REAL_PAYMENTS: boolish,
  PAYEE_DESCRIPTION: z
    .string()
    .default('SATS WARS 運営（イベント参加費）/ SATS WARS organisers (event entry)'),
  /** Open lobby, run bots and roll to the next match automatically (unattended demo). */
  DEMO_AUTOPILOT: boolish,
  DEMO_BOTS_PER_TEAM: z.coerce.number().int().min(0).max(200).default(0),
  /** Lobby length override for local demos (ms). */
  LOBBY_MS: z.coerce.number().int().min(0).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema> & {
  allowedOrigins: string[];
  adminPasswordGenerated: boolean;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  let adminPasswordGenerated = false;
  if (!parsed.ADMIN_PASSWORD) {
    if (parsed.NODE_ENV === 'production') {
      throw new Error('ADMIN_PASSWORD must be set in production');
    }
    parsed.ADMIN_PASSWORD = randomBytes(9).toString('base64url');
    adminPasswordGenerated = true;
  }
  if (parsed.NODE_ENV === 'production' && parsed.ADMIN_PASSWORD.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters in production');
  }
  const allowedOrigins = parsed.ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parsed.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must be set in production');
  }
  if (parsed.PAYMENT_MODE === 'lnbits') {
    const missing = ['LNBITS_URL', 'LNBITS_INVOICE_KEY', 'LNBITS_WEBHOOK_SECRET'].filter(
      (k) => !(parsed as Record<string, unknown>)[k],
    );
    if (missing.length) throw new Error(`PAYMENT_MODE=lnbits requires ${missing.join(', ')}`);
    if (!parsed.ALLOW_REAL_PAYMENTS) {
      throw new Error(
        'PAYMENT_MODE=lnbits requires ALLOW_REAL_PAYMENTS=true (explicit owner approval). See docs/PAYMENT_FLOW.md',
      );
    }
  }
  return { ...parsed, allowedOrigins, adminPasswordGenerated };
}
