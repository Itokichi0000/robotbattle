import type { ActionResult, PilotActionInput } from './actions';
import type { ActionKind, PresetId } from './config';
import type { MatchEvent, MatchEventType } from './events';
import type { Phase } from './phases';
import type { PublicMatchState } from './state';

/**
 * Socket.IO contracts (spec §11.4). Three namespaces share one authoritative match:
 *   /display   public, read-only (big screen). Sends only its own render stats.
 *   /pilot     cookie-authenticated phones. Sends raw intent; the server decides.
 *   /operator  operator-session staff console.
 */

export type AppMode = 'sandbox' | 'live';
export type QualityPreset = 'CINEMATIC' | 'BALANCED' | 'SAFE';

export interface MatchSnapshotMsg {
  matchId: string;
  phase: Phase;
  version: number;
  serverTime: number;
  state: PublicMatchState;
}

export interface MatchEventMsg {
  eventId: string;
  matchId: string;
  seq: number;
  serverTime: number;
  type: MatchEventType;
  payload: MatchEvent;
}

export interface DisplaySettings {
  volume: number;
  muted: boolean;
  quality: QualityPreset;
  /** Softer flashes for photosensitive audiences (spec §13.3). */
  reduceFlash: boolean;
}

export interface DisplayStatsMsg {
  fps: number;
  quality: QualityPreset;
  webglLost: boolean;
  width: number;
  height: number;
}

export interface PilotIdentity {
  publicName: string;
  kind: 'DEMO_GUEST' | 'LNURL';
  /** Optional short callsign; on the big screen only if showCallsign and staff allow it. */
  callsign: string | null;
  showCallsign: boolean;
}

/* --------------------------------------------------------------- payments */

export type PulseRefusal =
  | 'PAYMENTS_DISABLED'
  | 'STALE_MATCH'
  | 'NOT_IN_COMBAT'
  | 'PULSE_PENDING'
  | 'PULSE_LIMIT'
  | 'PULSE_COOLDOWN'
  | 'PULSE_MATCH_LIMIT'
  | 'BACKEND_UNAVAILABLE';

export const PULSE_REFUSAL_TEXT: Record<PulseRefusal, { ja: string; en: string }> = {
  PAYMENTS_DISABLED: {
    ja: '現在エネルギーパルスは停止中です',
    en: 'Energy pulses are switched off',
  },
  STALE_MATCH: { ja: 'この作戦は終了しました', en: 'That round is over' },
  NOT_IN_COMBAT: { ja: '戦闘中だけ送れます', en: 'Only during the battle' },
  PULSE_PENDING: { ja: '支払い待ちの請求書があります', en: 'You already have an open invoice' },
  PULSE_LIMIT: { ja: 'この作戦の上限（3回）に達しました', en: 'Limit for this round reached' },
  PULSE_COOLDOWN: { ja: '少し待ってから', en: 'Wait a little' },
  PULSE_MATCH_LIMIT: { ja: 'この作戦全体の上限に達しました', en: 'Round-wide limit reached' },
  BACKEND_UNAVAILABLE: {
    ja: '決済サーバーに接続できません。ゲームはそのまま続けられます',
    en: 'Payment backend unavailable. Keep playing',
  },
};

export interface PaymentIntentView {
  intentId: string;
  /** The action this payment powers (撃つ / 守る / 直す). */
  action: ActionKind;
  status: 'pending' | 'settled' | 'expired' | 'failed' | 'canceled';
  applied: 'applied' | 'unapplied' | null;
  amountSats: number;
  mode: 'sandbox' | 'live';
  recipient: string;
  /** BOLT11 while pending (sandbox: an obviously VIRTUAL string that no wallet can pay). */
  paymentRequest: string | null;
  /** QR of `lightning:<invoice>` for paying from another device (live, while pending). */
  qrSvg?: string | null;
  expiresAt: string;
  matchId: string;
}

export interface PaymentsStatus {
  mode: 'sandbox' | 'live';
  enabled: boolean;
  amountSats: number;
  /** Effect of one Lightning action, per action. */
  effect: Record<ActionKind, number>;
  recipient: string;
  remaining: number;
  cooldownUntil: string | null;
  inCombat: boolean;
}

export interface SessionStatusMsg {
  authenticated: boolean;
  pilot: PilotIdentity | null;
  matchId: string;
  /** Counted in the current match (joins automatically while the phone is connected). */
  joined: boolean;
}

/* ---------------------------------------------------------------- display */

export interface DisplayServerToClient {
  'match:snapshot': (msg: MatchSnapshotMsg) => void;
  'match:event': (msg: MatchEventMsg) => void;
  'display:settings': (msg: DisplaySettings) => void;
}

export interface DisplayClientToServer {
  'display:stats': (msg: DisplayStatsMsg) => void;
}

/* ------------------------------------------------------------------ pilot */

export interface PilotActionReq {
  matchId: string;
  clientActionId: string;
  action: PilotActionInput;
}

export interface PilotServerToClient {
  'match:snapshot': (msg: MatchSnapshotMsg) => void;
  'match:event': (msg: MatchEventMsg) => void;
  'pilot:actionResult': (msg: ActionResult) => void;
  'pilot:sessionStatus': (msg: SessionStatusMsg) => void;
  /** Only to the paying pilot (spec §11.4). */
  'payment:status': (msg: PaymentIntentView) => void;
  /** e.g. SESSION_REPLACED when the same wallet signed in on another phone. */
  'pilot:notice': (msg: { code: 'SESSION_REPLACED' | 'KICKED' }) => void;
}

export interface PilotClientToServer {
  'pilot:action': (req: PilotActionReq, ack: (res: ActionResult) => void) => void;
}

/* --------------------------------------------------------------- operator */

export type OperatorCommand =
  | { command: 'START' }
  | { command: 'SKIP_DEPLOY' }
  | { command: 'PAUSE' }
  | { command: 'RESUME' }
  | { command: 'END' }
  | { command: 'RESET' }
  | { command: 'NEXT_ROUND' }
  | { command: 'SET_AUTO_START'; enabled: boolean }
  | { command: 'SET_PRESET'; presetId: Exclude<PresetId, 'TEST'> }
  | { command: 'SET_DISPLAY'; settings: Partial<DisplaySettings> }
  /** Labelled demo bots join the crowd and play (exhibition attract loop). */
  | { command: 'SET_DEMO_BOTS'; enabled: boolean }
  /** Show only PILOT-XXXX names. */
  | { command: 'SET_HIDE_CALLSIGNS'; hidden: boolean }
  | { command: 'SANDBOX_SETTLE'; intentId: string }
  | { command: 'PAYMENTS_CHECK' }
  | { command: 'PAYMENTS_ENABLE_LIVE'; confirm: string }
  | { command: 'PAYMENTS_DISABLE' }
  | { command: 'SET_AUTO_SETTLE_VIRTUAL'; enabled: boolean };

export type OperatorCommandName = OperatorCommand['command'];

export interface OperatorCommandResult {
  ok: boolean;
  message?: string;
}

export interface DisplayClientInfo {
  id: string;
  connectedAt: number;
  stats: DisplayStatsMsg | null;
  statsAt: number | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface OperatorPaymentsView {
  mode: AppMode;
  provider: string;
  enabled: boolean;
  liveEnabled: boolean;
  /** Sandbox: VIRTUAL invoices confirm themselves (operator opt-in for demos). */
  autoSettleVirtual: boolean;
  recipient: string;
  amountSats: number;
  effect: Record<ActionKind, number>;
  perPilotPerMatch: number;
  cooldownSec: number;
  maxPerMatch: number;
  checks: {
    backend: { ok: boolean; detail: string; at: string } | null;
    webhook: { ok: boolean; detail: string; at: string } | null;
  };
  settledTotal: { n: number; sats: number };
  recent: Array<{
    intentId: string;
    status: PaymentIntentView['status'];
    applied: PaymentIntentView['applied'];
    amountSats: number;
    mode: AppMode;
    action: ActionKind;
    createdAt: string;
    currentMatch: boolean;
    note: string | null;
  }>;
}

export interface OperatorStatusMsg {
  mode: AppMode;
  demoBots: boolean;
  autoStart: boolean;
  hideCallsigns: boolean;
  payments: OperatorPaymentsView;
  presetId: PresetId;
  nextPresetId: PresetId;
  joinUrl: string;
  connections: { displays: number; pilots: number; operators: number };
  displays: DisplayClientInfo[];
  display: DisplaySettings;
  uptimeSec: number;
  audit: AuditEntry[];
}

export interface OperatorServerToClient {
  'match:snapshot': (msg: MatchSnapshotMsg) => void;
  'match:event': (msg: MatchEventMsg) => void;
  'operator:status': (msg: OperatorStatusMsg) => void;
}

export interface OperatorClientToServer {
  'operator:command': (cmd: OperatorCommand, ack: (res: OperatorCommandResult) => void) => void;
}

/* ------------------------------------------------------------------- HTTP */

export interface JoinInfo {
  joinUrl: string;
  /** Inline SVG of the join QR (generated server-side). */
  qrSvg: string;
  mode: AppMode;
}

export interface HealthInfo {
  ok: boolean;
  mode: AppMode;
  version: string;
  matchId: string;
  phase: Phase;
  uptimeSec: number;
}
