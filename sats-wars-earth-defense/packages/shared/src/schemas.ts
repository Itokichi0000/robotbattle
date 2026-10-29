/**
 * Server-side input validation. Every client message is parsed here before it reaches the
 * engine (spec §11.4). Browsers never import this module.
 */
import { z } from 'zod';
import { PRESET_IDS } from './config';
import { DIRECTIONS, SEAT_IDS } from './seats';

const id = z.string().min(1).max(64);
/** Client-generated idempotency keys: short, URL-safe. */
const clientKey = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const seatIdSchema = z.enum(SEAT_IDS);
export const directionSchema = z.enum(DIRECTIONS);

export const pilotActionInputSchema = z.discriminatedUnion('actionType', [
  z.object({
    actionType: z.literal('LOCK'),
    payload: z.object({ targetId: id.optional() }).strict(),
  }),
  z.object({ actionType: z.literal('FIRE'), payload: z.object({}).strict() }),
  z.object({
    actionType: z.literal('DEPLOY_SHIELD'),
    payload: z.object({ dir: directionSchema }).strict(),
  }),
]);

export const pilotActionReqSchema = z
  .object({
    matchId: id,
    seatId: seatIdSchema,
    clientActionId: clientKey,
    action: pilotActionInputSchema,
  })
  .strict();

export const joinSeatReqSchema = z
  .object({ matchId: id, seatId: seatIdSchema, requestId: clientKey })
  .strict();

export const readyReqSchema = z.object({ matchId: id, requestId: clientKey }).strict();
export const leaveReqSchema = z.object({ matchId: id }).strict();

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
  z.object({ command: z.literal('ATTRACT') }).strict(),
  z.object({ command: z.literal('OPEN_LOBBY') }).strict(),
  z.object({ command: z.literal('START') }).strict(),
  z.object({ command: z.literal('SKIP_DEPLOY') }).strict(),
  z.object({ command: z.literal('PAUSE') }).strict(),
  z.object({ command: z.literal('RESUME') }).strict(),
  z.object({ command: z.literal('END') }).strict(),
  z.object({ command: z.literal('RESET') }).strict(),
  z.object({ command: z.literal('NEXT_ROUND') }).strict(),
  z.object({ command: z.literal('SET_AUTO_SUPPORT'), enabled: z.boolean() }).strict(),
  z.object({ command: z.literal('KICK_SEAT'), seatId: seatIdSchema }).strict(),
  z
    .object({
      command: z.literal('SET_PRESET'),
      presetId: z.enum(PRESET_IDS).exclude(['TEST']),
    })
    .strict(),
  z.object({ command: z.literal('SET_DISPLAY'), settings: displaySettingsPatchSchema }).strict(),
]);

export const operatorLoginSchema = z.object({ password: z.string().min(1).max(256) }).strict();
