import { z } from 'zod';
import type { GameConfig } from './config';
import type { GameEvent } from './events';
import { REGION_IDS } from './regions';
import type {
  ActionResult,
  ClashRecord,
  Contribution,
  MatchResult,
  MatchStatus,
  RegionState,
  TeamState,
} from './state';
import { ACTION_TYPES } from './state';
import type { TeamId } from './teams';

// ---------------------------------------------------------------------------
// Public snapshot (safe to show on the venue screen: no payment data, no IDs
// beyond opaque participant ids, nicknames already moderated).
// ---------------------------------------------------------------------------

export interface LeaderEntry {
  participantId: string;
  nickname: string;
  score: number;
  isBot: boolean;
}

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
  /** True when the clock is advancing (not PAUSED / CREATED / FINISHED / CANCELLED). */
  running: boolean;
  /** Server epoch ms when this snapshot was produced. */
  serverTime: number;
  teams: Record<TeamId, TeamState>;
  regions: RegionState[];
  nextClash: { index: number; atGameMs: number } | null;
  clashes: ClashRecord[];
  result: MatchResult | null;
  lastSeq: number;
  recentEvents: GameEvent[];
  leaders: Record<TeamId, LeaderEntry[]>;
  joinOpen: boolean;
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

export const reserveRequestSchema = z.object({
  nickname: z.string().max(64).optional().default(''),
  /** Optional pre-existing device token to prevent duplicate entries. */
  deviceId: z.string().min(8).max(128).optional(),
});
export type ReserveRequest = z.infer<typeof reserveRequestSchema>;

export interface ReserveResponse {
  matchId: string;
  participantId: string;
  reservationId: string;
  teamId: TeamId;
  nickname: string;
  /** Bearer token for this participant. Store client-side; sent as Authorization header. */
  token: string;
  reservationExpiresAt: number;
  entryFeeSats: number;
  apPerParticipant: number;
}

export const invoiceRequestSchema = z.object({ reservationId: z.string().min(1).max(64) });

export interface InvoiceResponse {
  invoiceId: string;
  amountSats: number;
  bolt11: string;
  expiresAt: number;
  paymentMode: PaymentMode;
  payeeDescription: string;
  memo: string;
}

export const INVOICE_STATUSES = [
  'PENDING',
  'PAID',
  'EXPIRED',
  'FAILED',
  'LATE_PAID',
  'CANCELLED',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PARTICIPANT_STATUSES = [
  'RESERVED',
  'PENDING_PAYMENT',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export interface PaymentStatusResponse {
  reservationId: string;
  participantStatus: ParticipantStatus;
  invoiceStatus: InvoiceStatus | null;
  apRemaining: number;
}

export const redeemPassRequestSchema = z.object({
  reservationId: z.string().min(1).max(64),
  code: z.string().min(4).max(64),
});

export const actionRequestSchema = z.object({
  clientActionId: z.string().min(8).max(64),
  type: z.enum(ACTION_TYPES),
  regionId: z.enum(REGION_IDS).optional().nullable(),
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

export interface ActionResponse {
  result: ActionResult;
  apRemaining: number;
}

export interface MeResponse {
  matchId: string;
  participantId: string;
  reservationId: string;
  teamId: TeamId;
  nickname: string;
  status: ParticipantStatus;
  invoiceStatus: InvoiceStatus | null;
  apTotal: number;
  apRemaining: number;
  contribution: Contribution | null;
  lastResults: ActionResult[];
}

export interface ApiError {
  error: string;
  message: string;
}

export interface CurrentMatchResponse {
  snapshot: PublicMatchSnapshot;
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

export interface PaymentStatusPush {
  reservationId: string;
  participantStatus: ParticipantStatus;
  invoiceStatus: InvoiceStatus | null;
  apRemaining: number;
}

export interface ServerToClientEvents {
  matchSnapshot: (snapshot: PublicMatchSnapshot) => void;
  matchEvent: (event: GameEvent) => void;
  clockTick: (tick: ClockTick) => void;
  actionAck: (ack: ActionResponse) => void;
  paymentStatus: (status: PaymentStatusPush) => void;
  serverNotice: (notice: ServerNotice) => void;
}

export interface ClientToServerEvents {
  joinRoom: (req: JoinRoomRequest, ack?: (res: { ok: boolean; error?: string }) => void) => void;
  requestSnapshot: (ack?: (snapshot: PublicMatchSnapshot) => void) => void;
  timeSync: (clientSentAt: number, ack: (serverTime: number) => void) => void;
  arenaStatus: (status: ArenaStatus) => void;
}
