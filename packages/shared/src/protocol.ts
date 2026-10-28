import { z } from 'zod';
import type { GameConfig } from './config';
import type { GameEvent } from './events';
import type {
  ActionResult,
  CampaignResult,
  CampaignStats,
  Enemy,
  Landing,
  MatchStatus,
  RegionState,
} from './state';
import { PLAYER_ACTIONS } from './state';
import { REGION_IDS } from './regions';

// ---------------------------------------------------------------------------
// Public snapshot (safe for the venue screen: no payment data, nicknames moderated)
// ---------------------------------------------------------------------------

export interface PublicMatchSnapshot {
  matchId: string;
  configVersion: string;
  config: GameConfig;
  status: MatchStatus;
  pausedFrom: MatchStatus | null;
  pauseReason: string | null;
  clockMs: number;
  gameMs: number;
  liveStartClock: number | null;
  /** True while the game clock advances. */
  running: boolean;
  /** Server epoch ms when this snapshot was produced. */
  serverTime: number;
  wave: number;
  waveRemaining: number;
  actionsThisTurn: number;
  combo: number;
  /** In REGION_IDS order. */
  regions: RegionState[];
  enemies: Enemy[];
  incoming: Landing[];
  stats: CampaignStats;
  result: CampaignResult | null;
  lastSeq: number;
  recentEvents: GameEvent[];
  /** Players active in the last few minutes (everyone is on the same side). */
  playersOnline: number;
  /** Best wave reached by any campaign (all-time on this server). */
  bestWave: number;
  paymentsEnabled: boolean;
  paymentMode: PaymentMode;
  playUrl: string;
}

/** Lightweight heartbeat so clients keep timers aligned without full snapshots. */
export interface ClockTick {
  matchId: string;
  status: MatchStatus;
  clockMs: number;
  gameMs: number;
  liveStartClock: number | null;
  running: boolean;
  serverTime: number;
  lastSeq: number;
}

export const PAYMENT_MODES = ['mock', 'lnbits'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

export const NICKNAME_MAX_LENGTH = 12;

export const joinRequestSchema = z.object({
  nickname: z.string().max(64).optional().default(''),
  /** Random per-device id; limits duplicate players per device. */
  deviceId: z.string().min(8).max(128).optional(),
});
export type JoinRequest = z.infer<typeof joinRequestSchema>;

export interface JoinResponse {
  playerId: string;
  /** Bearer token. Store client-side; sent as Authorization header. */
  token: string;
  nickname: string;
  creditSats: number;
}

export const nicknameChangeSchema = z.object({ nickname: z.string().max(64) });

export const topupRequestSchema = z.object({ amountSats: z.number().int().positive() });

export const INVOICE_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'FAILED', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceResponse {
  invoiceId: string;
  amountSats: number;
  /** Actions this top-up buys. */
  actions: number;
  bolt11: string;
  expiresAt: number;
  status: InvoiceStatus;
  paymentMode: PaymentMode;
  payeeDescription: string;
  memo: string;
}

export interface TopupStatusResponse {
  invoiceId: string;
  status: InvoiceStatus;
  creditSats: number;
}

export const redeemPassRequestSchema = z.object({ code: z.string().min(4).max(64) });
export interface RedeemPassResponse {
  addedSats: number;
  creditSats: number;
}

export const actionRequestSchema = z.object({
  clientActionId: z.string().min(8).max(64),
  action: z.enum(PLAYER_ACTIONS),
  regionId: z.enum(REGION_IDS).optional(),
  enemyId: z.number().int().min(0).optional(),
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

export interface ActionResponse {
  result: ActionResult;
  creditSats: number;
  /** True when this clientActionId was already processed (no second charge). */
  duplicate: boolean;
}

export const CHEER_EMOJIS = ['📣', '🔥', '⚡', '🌀', '👏', '💪'] as const;
export type CheerEmoji = (typeof CHEER_EMOJIS)[number];
export const cheerRequestSchema = z.object({ emoji: z.enum(CHEER_EMOJIS).optional() });

export interface MeResponse {
  playerId: string;
  nickname: string;
  creditSats: number;
  actionsThisCampaign: number;
  actionsTotal: number;
  kills: number;
  pendingInvoice: InvoiceResponse | null;
  lastResults: ActionResult[];
}

export interface ApiError {
  error: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

export const ROOM_ROLES = ['arena', 'player', 'spectator', 'admin'] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

export const joinRoomSchema = z.object({
  role: z.enum(ROOM_ROLES),
  token: z.string().max(256).optional(),
});
export type JoinRoomRequest = z.infer<typeof joinRoomSchema>;

export const arenaStatusSchema = z.object({
  fps: z.number().min(0).max(1000),
  frameMs: z.number().min(0).max(10_000),
  renderer: z.enum(['webgl', '2d']),
  quality: z.enum(['low', 'medium', 'high']),
});
export type ArenaStatus = z.infer<typeof arenaStatusSchema>;

export interface ServerNotice {
  level: 'info' | 'warn' | 'error';
  code: string;
  messageJa: string;
  messageEn: string;
}

export interface CheerPush {
  nickname: string;
  emoji: string;
}

export interface CreditPush {
  creditSats: number;
  invoiceId: string | null;
  invoiceStatus: InvoiceStatus | null;
  addedSats: number;
}

export interface ServerToClientEvents {
  matchSnapshot: (snapshot: PublicMatchSnapshot) => void;
  matchEvent: (event: GameEvent) => void;
  clockTick: (tick: ClockTick) => void;
  cheer: (cheer: CheerPush) => void;
  presence: (playersOnline: number) => void;
  credit: (credit: CreditPush) => void;
  serverNotice: (notice: ServerNotice) => void;
}

export interface ClientToServerEvents {
  joinRoom: (req: JoinRoomRequest, ack?: (res: { ok: boolean; error?: string }) => void) => void;
  requestSnapshot: (ack?: (snapshot: PublicMatchSnapshot) => void) => void;
  timeSync: (clientSentAt: number, ack: (serverTime: number) => void) => void;
  arenaStatus: (status: ArenaStatus) => void;
}
