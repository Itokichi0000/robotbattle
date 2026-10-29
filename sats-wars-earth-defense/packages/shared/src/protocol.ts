import type { ActionResult, PilotActionInput, SeatRequestResult } from './actions';
import type { PresetId } from './config';
import type { MatchEvent, MatchEventType } from './events';
import type { Phase } from './phases';
import type { SeatId } from './seats';
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

export interface SeatChangedMsg {
  seatId: SeatId;
  pilotDisplayName: string | null;
  connected: boolean;
  isAutoSupport: boolean;
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
}

export interface SessionStatusMsg {
  authenticated: boolean;
  pilot: PilotIdentity | null;
  matchId: string;
  assignedSeat: SeatId | null;
}

/* ---------------------------------------------------------------- display */

export interface DisplayServerToClient {
  'match:snapshot': (msg: MatchSnapshotMsg) => void;
  'match:event': (msg: MatchEventMsg) => void;
  'seat:changed': (msg: SeatChangedMsg) => void;
  'display:settings': (msg: DisplaySettings) => void;
}

export interface DisplayClientToServer {
  'display:stats': (msg: DisplayStatsMsg) => void;
}

/* ------------------------------------------------------------------ pilot */

export interface JoinSeatReq {
  matchId: string;
  seatId: SeatId;
  requestId: string;
}

export interface PilotActionReq {
  matchId: string;
  seatId: SeatId;
  clientActionId: string;
  action: PilotActionInput;
}

export interface PilotServerToClient {
  'match:snapshot': (msg: MatchSnapshotMsg) => void;
  'match:event': (msg: MatchEventMsg) => void;
  'seat:changed': (msg: SeatChangedMsg) => void;
  'pilot:actionResult': (msg: ActionResult) => void;
  'pilot:sessionStatus': (msg: SessionStatusMsg) => void;
}

export interface PilotClientToServer {
  'pilot:joinSeat': (req: JoinSeatReq, ack: (res: SeatRequestResult) => void) => void;
  'pilot:ready': (
    req: { matchId: string; requestId: string },
    ack: (res: SeatRequestResult) => void,
  ) => void;
  'pilot:action': (req: PilotActionReq, ack: (res: ActionResult) => void) => void;
  'pilot:leave': (req: { matchId: string }, ack: (res: SeatRequestResult) => void) => void;
}

/* --------------------------------------------------------------- operator */

export type OperatorCommand =
  | { command: 'ATTRACT' }
  | { command: 'OPEN_LOBBY' }
  | { command: 'START' }
  | { command: 'SKIP_DEPLOY' }
  | { command: 'PAUSE' }
  | { command: 'RESUME' }
  | { command: 'END' }
  | { command: 'RESET' }
  | { command: 'NEXT_ROUND' }
  | { command: 'SET_AUTO_SUPPORT'; enabled: boolean }
  | { command: 'KICK_SEAT'; seatId: SeatId }
  | { command: 'SET_PRESET'; presetId: Exclude<PresetId, 'TEST'> }
  | { command: 'SET_DISPLAY'; settings: Partial<DisplaySettings> };

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

export interface OperatorStatusMsg {
  mode: AppMode;
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
