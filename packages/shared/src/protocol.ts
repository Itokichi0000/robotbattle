import { z } from 'zod';
import type { GameConfig } from './config';
import type { GameEvent } from './events';
import type {
  MatchStatus,
  Phase,
  RegionPaint,
  RoundState,
  RoundSummary,
  SeasonResult,
  TeamState,
  ZapResult,
} from './state';
import { TEAM_IDS, type TeamId } from './teams';
import type { RegionId } from './regions';

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
  phase: Phase;
  phaseEndsAt: number | null;
  roundOrder: RegionId[];
  roundIndex: number;
  round: RoundState | null;
  rounds: RoundSummary[];
  regions: RegionPaint[];
  teams: Record<TeamId, TeamState>;
  result: SeasonResult | null;
  lastSeq: number;
  recentEvents: GameEvent[];
  /** Players currently cheering for each team (joined, recently active). */
  supporters: Record<TeamId, number>;
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
  teamId: z.enum(TEAM_IDS),
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
  teamId: TeamId;
  creditSats: number;
}

export const teamChangeSchema = z.object({ teamId: z.enum(TEAM_IDS) });
export const nicknameChangeSchema = z.object({ nickname: z.string().max(64) });

export const topupRequestSchema = z.object({ amountSats: z.number().int().positive() });

export const INVOICE_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'FAILED', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceResponse {
  invoiceId: string;
  amountSats: number;
  zaps: number;
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

export const zapRequestSchema = z.object({ clientActionId: z.string().min(8).max(64) });
export type ZapRequest = z.infer<typeof zapRequestSchema>;

export interface ZapResponse {
  result: ZapResult;
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
  teamId: TeamId;
  creditSats: number;
  zapsThisSeason: number;
  zapsTotal: number;
  kos: number;
  pendingInvoice: InvoiceResponse | null;
  lastResults: ZapResult[];
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
  teamId: TeamId;
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
  presence: (supporters: Record<TeamId, number>) => void;
  credit: (credit: CreditPush) => void;
  serverNotice: (notice: ServerNotice) => void;
}

export interface ClientToServerEvents {
  joinRoom: (req: JoinRoomRequest, ack?: (res: { ok: boolean; error?: string }) => void) => void;
  requestSnapshot: (ack?: (snapshot: PublicMatchSnapshot) => void) => void;
  timeSync: (clientSentAt: number, ack: (serverTime: number) => void) => void;
  arenaStatus: (status: ArenaStatus) => void;
}
