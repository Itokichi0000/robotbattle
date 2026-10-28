import { z } from 'zod';
import type { GameConfig } from './config';
import type { CrewMember, GameEvent } from './events';
import type {
  CityState,
  Enemy,
  PilotStats,
  RaidPhase,
  RaidResult,
  RaidStats,
  RaidStatus,
  RobotState,
  SpecialState,
  Task,
  TaskResult,
  Telegraph,
} from './state';
import { DIRECTIONS, ENERGY_SINKS, ROBOTS, ROLES, WEAKPOINTS } from './state';
import { REGION_IDS } from './regions';

// ---------------------------------------------------------------------------
// Public snapshot (safe for the venue screen: no payment data, moderated names)
// ---------------------------------------------------------------------------

export const PAYMENT_MODES = ['mock', 'lnbits'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** How pilots get into a raid: free event, or a 21-sat pass (sponsored passes always work). */
export const PASS_MODES = ['FREE', 'PAID'] as const;
export type PassMode = (typeof PASS_MODES)[number];

export interface Broadcast {
  id: string;
  messageJa: string;
  messageEn: string;
  until: number;
}

export interface PublicRaidSnapshot {
  raidId: string;
  configVersion: string;
  configHash: string;
  config: GameConfig;
  status: RaidStatus;
  phase: RaidPhase;
  pausedFrom: RaidStatus | null;
  pauseReason: string | null;
  clockMs: number;
  gameMs: number;
  liveStartClock: number | null;
  /** True while the raid clock advances. */
  running: boolean;
  /** Server epoch ms when this snapshot was produced. */
  serverTime: number;
  cities: CityState[];
  robots: RobotState[];
  reserveEnergy: number;
  jammedUntil: number;
  enemies: Enemy[];
  telegraphs: Telegraph[];
  bossId: number | null;
  sync: number;
  special: SpecialState;
  stats: RaidStats;
  result: RaidResult | null;
  crew: CrewMember[];
  lastSeq: number;
  recentEvents: GameEvent[];
  // ---- server-side additions ----
  /** Lobby epoch ms at which the raid auto-starts (null when not counting down). */
  lobbyEndsAt: number | null;
  /** Boarding (new pilots) is open right now. */
  joinOpen: boolean;
  passMode: PassMode;
  ticketPriceSats: number;
  paymentsEnabled: boolean;
  paymentMode: PaymentMode;
  playUrl: string;
  eventId: string;
  broadcast: Broadcast | null;
  /** Operators hid all pilot names on the venue screen. */
  namesHidden: boolean;
  demoMode: boolean;
  /** Best total score for this config hash (same-rules leaderboard). */
  bestScore: number | null;
}

/** Lightweight heartbeat so clients keep timers aligned without full snapshots. */
export interface ClockTick {
  raidId: string;
  status: RaidStatus;
  clockMs: number;
  gameMs: number;
  liveStartClock: number | null;
  running: boolean;
  serverTime: number;
  lastSeq: number;
}

// ---------------------------------------------------------------------------
// Pilots, sessions, passport
// ---------------------------------------------------------------------------

export const CALLSIGN_MAX_LENGTH = 20;
export const AVATAR_PRESETS = ['standard', 'visor', 'samurai', 'aero', 'medic', 'scout'] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export const AUTH_TYPES = ['GUEST', 'LIGHTNING', 'MOCK'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const guestRequestSchema = z.object({
  callsign: z.string().max(64).optional().default(''),
  /** Random per-device id; limits duplicate guests per device. */
  deviceId: z.string().min(8).max(128).optional(),
});

export const profilePatchSchema = z.object({
  callsign: z.string().max(64).optional(),
  avatar: z.enum(AVATAR_PRESETS).optional(),
  showNameOnArena: z.boolean().optional(),
  locale: z.enum(['ja', 'en']).optional(),
  reducedMotion: z.boolean().optional(),
  assistMode: z.boolean().optional(),
});
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export interface PilotProfile {
  pilotId: string;
  callsign: string;
  avatar: AvatarPreset;
  authType: AuthType;
  /** Lightning key linked (LNURL-auth). Not an identity check. */
  lightningLinked: boolean;
  rank: number;
  sorties: number;
  victories: number;
  titles: string[];
  showNameOnArena: boolean;
  locale: 'ja' | 'en';
  reducedMotion: boolean;
  assistMode: boolean;
  createdAt: number;
}

export interface SessionResponse {
  pilot: PilotProfile;
  /** Bearer token for non-browser clients; browsers use the HttpOnly cookie. */
  token: string;
}

export interface RaidSeat {
  raidId: string;
  boarded: boolean;
  /** Pass granted for this raid (FREE event, SPONSORED pass or LIGHTNING payment). */
  entitled: boolean;
  entitlementSource: 'FREE' | 'SPONSORED' | 'LIGHTNING' | 'DEMO' | 'CREDIT' | null;
  role: (typeof ROLES)[number] | null;
  robot: (typeof ROBOTS)[number] | null;
  task: Task | null;
  cooldownUntil: number;
  roleChangeReadyAt: number;
  stats: PilotStats | null;
}

export interface MeResponse {
  pilot: PilotProfile;
  seat: RaidSeat;
  pendingInvoice: InvoiceResponse | null;
  /** Unused pass credit from a raid that ended before the pilot could board. */
  passCredits: number;
}

export interface PassportEntry {
  raidId: string;
  eventId: string;
  outcome: RaidResult['outcome'];
  role: (typeof ROLES)[number];
  score: number;
  titles: string[];
  endedAt: number;
}

export interface PassportResponse {
  pilot: PilotProfile;
  history: PassportEntry[];
  rankNameJa: string;
  rankNameEn: string;
  nextRankAt: number | null;
}

// ---------------------------------------------------------------------------
// Raid actions
// ---------------------------------------------------------------------------

export const boardRequestSchema = z.object({
  role: z.enum(ROLES),
  robot: z.enum(ROBOTS).optional(),
});

export const roleChangeSchema = z.object({
  role: z.enum(ROLES),
  robot: z.enum(ROBOTS).optional(),
});

const repairSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ROBOT'), robot: z.enum(ROBOTS) }),
  z.object({ type: z.literal('CITY'), cityId: z.enum(REGION_IDS) }),
  z.object({ type: z.literal('UNJAM') }),
]);

export const taskRequestSchema = z.object({
  enemyId: z.number().int().min(0).optional(),
  weakpoint: z.enum(WEAKPOINTS).optional(),
  telegraphId: z.number().int().min(0).optional(),
  cityId: z.enum(REGION_IDS).optional(),
  sink: z.enum(ENERGY_SINKS).optional(),
  repair: repairSchema.optional(),
  difficulty: z.enum(['EASY', 'NORMAL']).optional(),
});

export const taskInputSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('GUNNER'), stopAtMs: z.number().min(0).max(600_000) }),
  z.object({ role: z.literal('GUARDIAN'), direction: z.enum(DIRECTIONS), releaseAtMs: z.number().min(0).max(600_000) }),
  z.object({ role: z.literal('ROUTER'), path: z.array(z.number().int().min(0).max(64)).min(1).max(16) }),
  z.object({ role: z.literal('ENGINEER'), sequence: z.array(z.number().int().min(0).max(64)).max(16) }),
]);

export const taskSubmitSchema = z.object({
  taskId: z.string().min(1).max(80),
  /** Idempotency key: retries with the same id return the stored result. */
  clientSubmissionId: z.string().min(8).max(64),
  input: taskInputSchema,
});

export interface TaskResponse {
  code: string;
  task: Task | null;
  cooldownUntil: number;
  gameMs: number;
}

export interface SubmitResponse {
  result: TaskResult;
  duplicate: boolean;
}

// ---------------------------------------------------------------------------
// Passes & payments
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'FAILED', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceResponse {
  invoiceId: string;
  raidId: string;
  amountSats: number;
  bolt11: string;
  expiresAt: number;
  status: InvoiceStatus;
  paymentMode: PaymentMode;
  payeeDescription: string;
  memo: string;
}

export interface InvoiceStatusResponse {
  invoiceId: string;
  status: InvoiceStatus;
  entitled: boolean;
}

export const sponsoredRedeemSchema = z.object({ code: z.string().min(4).max(64) });

export const CHEER_EMOJIS = ['📣', '🔥', '⚡', '🌀', '👏', '💪'] as const;
export type CheerEmoji = (typeof CHEER_EMOJIS)[number];
export const cheerRequestSchema = z.object({ emoji: z.enum(CHEER_EMOJIS).optional() });

export interface ApiError {
  error: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

export const ROOM_ROLES = ['arena', 'pilot', 'spectator', 'admin'] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

export const subscribeSchema = z.object({
  role: z.enum(ROOM_ROLES),
  token: z.string().max(256).optional(),
});
export type SubscribeRequest = z.infer<typeof subscribeSchema>;

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
  callsign: string;
  emoji: string;
}

/** Sent to one pilot when their pass for the current raid is granted. */
export interface EntitlementPush {
  raidId: string;
  source: RaidSeat['entitlementSource'];
  invoiceId: string | null;
}

export interface ServerToClientEvents {
  'raid:snapshot': (snapshot: PublicRaidSnapshot) => void;
  'raid:event': (event: GameEvent) => void;
  'raid:clock': (tick: ClockTick) => void;
  'raid:cheer': (cheer: CheerPush) => void;
  'raid:presence': (pilotsOnline: number) => void;
  'pilot:entitlement': (e: EntitlementPush) => void;
  'server:notice': (notice: ServerNotice) => void;
}

export interface ClientToServerEvents {
  'raid:subscribe': (req: SubscribeRequest, ack?: (res: { ok: boolean; error?: string }) => void) => void;
  'raid:request-snapshot': (ack?: (snapshot: PublicRaidSnapshot) => void) => void;
  'time:sync': (clientSentAt: number, ack: (serverTime: number) => void) => void;
  'arena:status': (status: ArenaStatus) => void;
}
