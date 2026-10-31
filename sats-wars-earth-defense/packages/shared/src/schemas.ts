/**
 * Server-side input validation. Every client message is parsed here before it reaches the
 * engine (spec §11.4). Browsers never import this module.
 */
import { z } from 'zod';
import { ACTION_KINDS, PRESET_IDS } from './config';

const id = z.string().min(1).max(64);
/** Client-generated idempotency keys: short, URL-safe. */
const clientKey = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const actionKindSchema = z.enum(ACTION_KINDS);

export const pilotActionReqSchema = z
  .object({
    matchId: id,
    clientActionId: clientKey,
    action: z.object({ kind: actionKindSchema }).strict(),
  })
  .strict();

const qualitySchema = z.enum(['CINEMATIC', 'BALANCED', 'SAFE']);

export const displayStatsSchema = z
  .object({
    fps: z.number().min(0).max(1000),
    quality: qualitySchema,
    webglLost: z.boolean(),
    width: z.number().int().min(0).max(20_000),
    height: z.number().int().min(0).max(20_000),
  })
  .strict();

export const displaySettingsPatchSchema = z
  .object({
    volume: z.number().min(0).max(1).optional(),
    muted: z.boolean().optional(),
    quality: qualitySchema.optional(),
    reduceFlash: z.boolean().optional(),
  })
  .strict();

export const operatorCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('START') }).strict(),
  z.object({ command: z.literal('SKIP_DEPLOY') }).strict(),
  z.object({ command: z.literal('PAUSE') }).strict(),
  z.object({ command: z.literal('RESUME') }).strict(),
  z.object({ command: z.literal('END') }).strict(),
  z.object({ command: z.literal('RESET') }).strict(),
  z.object({ command: z.literal('NEXT_ROUND') }).strict(),
  z.object({ command: z.literal('SET_AUTO_START'), enabled: z.boolean() }).strict(),
  z
    .object({
      command: z.literal('SET_PRESET'),
      presetId: z.enum(PRESET_IDS).exclude(['TEST']),
    })
    .strict(),
  z.object({ command: z.literal('SET_DISPLAY'), settings: displaySettingsPatchSchema }).strict(),
  z.object({ command: z.literal('SET_DEMO_BOTS'), enabled: z.boolean() }).strict(),
  z.object({ command: z.literal('SET_HIDE_CALLSIGNS'), hidden: z.boolean() }).strict(),
  z
    .object({
      command: z.literal('SANDBOX_SETTLE'),
      intentId: z.string().regex(/^pi_[0-9a-f-]{36}$/),
    })
    .strict(),
  z.object({ command: z.literal('PAYMENTS_CHECK') }).strict(),
  z.object({ command: z.literal('PAYMENTS_ENABLE_LIVE'), confirm: z.string().max(16) }).strict(),
  z.object({ command: z.literal('PAYMENTS_DISABLE') }).strict(),
  z.object({ command: z.literal('SET_AUTO_SETTLE_VIRTUAL'), enabled: z.boolean() }).strict(),
]);

export const callsignReqSchema = z
  .object({ callsign: z.string().max(40).nullable(), showOnScreen: z.boolean() })
  .strict();

export const pulseIntentReqSchema = z.object({ matchId: id, action: actionKindSchema }).strict();

export const operatorLoginSchema = z.object({ password: z.string().min(1).max(256) }).strict();
