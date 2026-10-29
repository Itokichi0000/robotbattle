import { z } from 'zod';
import { type CosmeticSlot, equipPatchSchema } from './cosmetics';
import type { GameConfig } from './config';
import type { BoardPatch, CrewMember, GameEvent } from './events';
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
  /** Event of this raid (venue-limited cosmetics, leaderboard grouping). */
  eventId: string;
  /** Venue name set by the operators (shown on the arena and license card). */
  venueName: string;
  /** Default language of the venue screen (viewers can still switch). */
  arenaLocale: 'ja' | 'en';
  /** Venue screen display pushed by the operators (applied when `rev` changes). */
  arenaDisplay: ArenaDisplay;
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
  /** Show my avatar decorations in the venue cockpit (names are a separate choice). */
  showAvatarOnArena: z.boolean().optional(),
  /** Print my linked npub on my license card. */
  nostrShowOnCard: z.boolean().optional(),
  /** Equip unlocked cosmetics (slot → item id); locked items are refused. */
  equip: equipPatchSchema.optional(),
});
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export interface PilotProfile {
  pilotId: string;
  callsign: string;
  /** Public pseudonym (PILOT-xxxxx) used when the callsign is not shown. */
  pseudonym: string;
  avatar: AvatarPreset;
  authType: AuthType;
  /** Lightning key linked (LNURL-auth). Not an identity check. */
  lightningLinked: boolean;
  rank: number;
  sorties: number;
  victories: number;
  titles: string[];
  showNameOnArena: boolean;
  showAvatarOnArena: boolean;
  locale: 'ja' | 'en';
  reducedMotion: boolean;
  assistMode: boolean;
  createdAt: number;
  cosmetics: {
    unlocked: string[];
    equipped: Record<CosmeticSlot, string>;
  };
  /** Optional Nostr key (display only, never login). */
  nostr: { npub: string | null; showOnCard: boolean };
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

export interface AchievementsResponse {
  titles: Array<{ code: string; ja: string; en: string }>;
  cosmetics: Array<{
    id: string;
    slot: CosmeticSlot;
    ja: string;
    en: string;
    color: string;
    accent: string;
    rarity: 'BASIC' | 'RARE' | 'EVENT';
    unlocked: boolean;
    unlockedAt: number | null;
    equipped: boolean;
    hint: string;
  }>;
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
  z.object({
    role: z.literal('GUARDIAN'),
    direction: z.enum(DIRECTIONS),
    releaseAtMs: z.number().min(0).max(600_000),
  }),
  z.object({
    role: z.literal('ROUTER'),
    path: z.array(z.number().int().min(0).max(64)).min(1).max(16),
  }),
  z.object({
    role: z.literal('ENGINEER'),
    sequence: z.array(z.number().int().min(0).max(64)).max(16),
  }),
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
// Replay (finished raids)
// ---------------------------------------------------------------------------

/** An event without its board patch (the replay sends boards as sampled frames). */
export type ReplayEvent = GameEvent extends infer E
  ? E extends GameEvent
    ? Omit<E, 'patch'>
    : never
  : never;

export interface ReplayFrame {
  gameMs: number;
  board: BoardPatch;
}

export interface ReplayResponse {
  raidId: string;
  configHash: string;
  /** Last game ms of the raid. */
  endGameMs: number;
  /** Public board every `frameMs` of game time (and at every phase change). */
  frameMs: number;
  frames: ReplayFrame[];
  /** All events in order, names already moderated like the live venue screen. */
  events: ReplayEvent[];
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
  /** The automatic quality reduction changed the level. */
  autoQuality: z.boolean().optional(),
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
  /** Rehearsal cue for venue screens only (DEMO): plays an effect, changes no state. */
  'arena:cue': (cue: ArenaPreviewCue) => void;
}

export interface ClientToServerEvents {
  'raid:subscribe': (
    req: SubscribeRequest,
    ack?: (res: { ok: boolean; error?: string }) => void,
  ) => void;
  'raid:request-snapshot': (ack?: (snapshot: PublicRaidSnapshot) => void) => void;
  'time:sync': (clientSentAt: number, ack: (serverTime: number) => void) => void;
  'arena:status': (status: ArenaStatus) => void;
}

// ---------------------------------------------------------------------------
// Operators: next raid (spec E4 作戦作成)
// ---------------------------------------------------------------------------

export const EVENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const nextRaidSettingsSchema = z.object({
  /** Rebuild the next config from the defaults with this difficulty version. */
  preset: z.enum(['EASY', 'NORMAL', 'HARD']).optional(),
  ticketPriceSats: z.number().int().min(0).max(100_000).optional(),
  maxPilots: z.number().int().min(1).max(1000).optional(),
  eventId: z.string().regex(EVENT_ID_PATTERN).optional(),
  venueName: z.string().max(40).optional(),
  arenaLocale: z.enum(['ja', 'en']).optional(),
});
export type NextRaidSettings = z.infer<typeof nextRaidSettingsSchema>;

export interface EventInfo {
  eventId: string;
  venueName: string;
  arenaLocale: 'ja' | 'en';
}

export const ARENA_PREVIEW_CUES = [
  'RAID_START',
  'BOSS_ENTRANCE',
  'SPECIAL_ACTIVATED',
  'SPECIAL_FALLBACK',
  'SPECIAL_FAILED',
  'VICTORY',
  'DEFEAT',
] as const;
export type ArenaPreviewCue = (typeof ARENA_PREVIEW_CUES)[number];

export const arenaDisplaySchema = z.object({
  renderer: z.enum(['auto', '3d', '2d']),
  quality: z.enum(['auto', 'low', 'medium', 'high']),
  volume: z.number().min(0).max(1),
  showQr: z.boolean(),
});
export type ArenaDisplay = z.infer<typeof arenaDisplaySchema> & { rev: number };

export const DEFAULT_ARENA_DISPLAY: ArenaDisplay = {
  renderer: 'auto',
  quality: 'auto',
  volume: 0.7,
  showQr: true,
  rev: 0,
};
