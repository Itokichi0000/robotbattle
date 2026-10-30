/**
 * Server-side input validation. Every client message is parsed here before it reaches the
 * engine (spec §11.4). Browsers never import this module.
 */
import { z } from 'zod';
import { PRESET_IDS } from './config';
import { MECH_PART_IDS } from './seats';
import { POWER_LANES } from './state';
import { DIRECTIONS, SEAT_IDS } from './seats';

const id = z.string().min(1).max(64);
/** Client-generated idempotency keys: short, URL-safe. */
const clientKey = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const seatIdSchema = z.enum(SEAT_IDS);
const share = z.number().int().min(0).max(100);
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
  z.object({
    actionType: z.literal('SET_POWER'),
    payload: z
      .object({
        distribution: z
          .object({
            weapon: share,
            shield: share,
            mobility: share,
            repair: share,
          })
          .strict(),
        baseVersion: z.number().int().min(0).max(1_000_000),
      })
      .strict(),
  }),
  z.object({
    actionType: z.literal('ROUTE_SUBMIT'),
    payload: z
      .object({
        lane: z.enum(POWER_LANES),
        rotations: z.array(z.number().int().min(0).max(3)).length(9),
      })
      .strict(),
  }),
  z.object({
    actionType: z.literal('REPAIR_START'),
    payload: z.object({ part: z.enum(MECH_PART_IDS) }).strict(),
  }),
  z.object({
    actionType: z.literal('REPAIR_FINISH'),
    payload: z
      .object({
        part: z.enum(MECH_PART_IDS),
        order: z.array(z.number().int().min(0).max(15)).max(8),
      })
      .strict(),
  }),
  z.object({ actionType: z.literal('SYNC_NOW'), payload: z.object({}).strict() }),
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
]);

export const syncFinisherReqSchema = z.object({ matchId: id, clientActionId: clientKey }).strict();

export const callsignReqSchema = z
  .object({ callsign: z.string().max(40).nullable(), showOnScreen: z.boolean() })
  .strict();

export const pulseIntentReqSchema = z.object({ matchId: id }).strict();

export const operatorLoginSchema = z.object({ password: z.string().min(1).max(256) }).strict();
