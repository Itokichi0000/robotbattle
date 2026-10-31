import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type {
  AuditEntry,
  DisplayClientInfo,
  DisplayClientToServer,
  DisplayServerToClient,
  DisplaySettings,
  MatchEventMsg,
  OperatorClientToServer,
  OperatorCommand,
  OperatorCommandResult,
  OperatorServerToClient,
  OperatorStatusMsg,
  PaymentIntentView,
  PilotClientToServer,
  PilotServerToClient,
  SeatChangedMsg,
  SeatId,
  SessionStatusMsg,
} from '@swed/shared';
import {
  displaySettingsPatchSchema,
  displayStatsSchema,
  joinSeatReqSchema,
  leaveReqSchema,
  operatorCommandSchema,
  pilotActionReqSchema,
  readyReqSchema,
  syncFinisherReqSchema,
} from '@swed/shared/schemas';
import { Server, type Namespace, type Socket } from 'socket.io';
import type { Db } from './db';
import { recentAudit } from './db';
import type { Env } from './env';
import type { PaymentService } from './payments/service';
import type { MatchRuntime } from './runtime';
import type { PilotRow } from './sessions';
import {
  displayNameFor,
  isOperatorToken,
  OPERATOR_COOKIE,
  parseCookies,
  PILOT_COOKIE,
  pilotById,
  pilotForToken,
} from './sessions';

/**
 * Socket.IO wiring. The runtime decides; this layer authenticates, validates (Zod), rate
 * limits and fans results out. Nothing here changes game state except via the runtime.
 */

type DisplayNs = Namespace<DisplayClientToServer, DisplayServerToClient>;
type PilotNs = Namespace<PilotClientToServer, PilotServerToClient, object, { pilot: PilotRow }>;
type OperatorNs = Namespace<OperatorClientToServer, OperatorServerToClient>;
type PilotSocket = Socket<PilotClientToServer, PilotServerToClient, object, { pilot: PilotRow }>;

export interface RealtimeOptions {
  env: Env;
  db: Db;
  joinUrl: string;
  isOriginAllowed: (origin: string | undefined, host: string | undefined) => boolean;
  log: { info: (o: object, msg?: string) => void; warn: (o: object, msg?: string) => void };
}

/** Token bucket per socket: bursts of taps are fine, scripted floods are not. */
class Bucket {
  private tokens: number;
  private last = performance.now();
  constructor(
    private readonly capacity: number,
    private readonly perSec: number,
  ) {
    this.tokens = capacity;
  }
  take(): boolean {
    const now = performance.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const SEAT_EVENTS = new Set([
  'seat_assigned',
  'seat_released',
  'seat_connection',
  'seat_ready',
  'auto_support_changed',
]);

export class Realtime {
  readonly io: Server;
  readonly display: DisplayNs;
  readonly pilot: PilotNs;
  readonly operator: OperatorNs;
  runtime!: MatchRuntime;
  payments!: PaymentService;
  hideCallsigns = false;
  settings: DisplaySettings = {
    volume: 0.8,
    muted: false,
    quality: 'CINEMATIC',
    reduceFlash: false,
  };
  private readonly displays = new Map<string, DisplayClientInfo>();
  private readonly pilotSockets = new Map<string, Set<string>>();
  private readonly lastSeat = new Map<string, SeatId | null>();
  private statusTimer: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();

  constructor(
    server: HttpServer,
    private readonly opts: RealtimeOptions,
  ) {
    this.io = new Server(server, {
      serveClient: false,
      // Snapshots are repetitive JSON; deflate cuts venue Wi-Fi load several-fold.
      perMessageDeflate: { threshold: 1024 },
      pingInterval: 10_000,
      pingTimeout: 8_000,
      allowRequest: (req: IncomingMessage, cb) => {
        cb(null, opts.isOriginAllowed(req.headers.origin, req.headers.host));
      },
    });
    this.display = this.io.of('/display');
    this.pilot = this.io.of('/pilot') as PilotNs;
    this.operator = this.io.of('/operator');
  }

  /** Called once the runtime exists (the runtime's hooks call back into this object). */
  bind(runtime: MatchRuntime, payments: PaymentService): void {
    this.runtime = runtime;
    this.payments = payments;
    this.setupDisplay();
    this.setupPilot();
    this.setupOperator();
    this.statusTimer = setInterval(() => this.pushOperatorStatus(), 1_000);
    this.statusTimer.unref?.();
  }

  close(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.io.close();
  }

  /* ------------------------------------------------------- runtime hooks */

  onEvents(msgs: MatchEventMsg[]): void {
    for (const ns of [this.display, this.pilot, this.operator]) {
      for (const m of msgs) ns.emit('match:event', m);
    }
    if (msgs.some((m) => SEAT_EVENTS.has(m.type))) {
      for (const m of msgs) {
        const p = m.payload;
        if ('seatId' in p && SEAT_EVENTS.has(m.type)) this.emitSeatChanged(p.seatId as SeatId);
      }
      this.syncPilotSeats();
    }
  }

  onSnapshot = (msg: ReturnType<MatchRuntime['snapshotMsg']>): void => {
    this.display.emit('match:snapshot', msg);
    this.pilot.emit('match:snapshot', msg);
    this.operator.emit('match:snapshot', msg);
  };

  onMatchReplaced(): void {
    this.syncPilotSeats(true);
  }

  private emitSeatChanged(seatId: SeatId): void {
    const s = this.runtime.state;
    const seat = s.seats[seatId];
    const msg: SeatChangedMsg = {
      seatId,
      pilotDisplayName: seat.displayName,
      connected: seat.connected,
      isAutoSupport: seat.pilotId === null && s.autoSupport,
    };
    this.display.emit('seat:changed', msg);
    this.pilot.emit('seat:changed', msg);
  }

  /** Tells each connected pilot which seat (if any) is theirs whenever that changes. */
  private syncPilotSeats(force = false): void {
    for (const pilotId of this.pilotSockets.keys()) {
      const seat = this.runtime.seatOf(pilotId);
      if (force || this.lastSeat.get(pilotId) !== seat) {
        this.lastSeat.set(pilotId, seat);
        const socketId = this.pilotSockets.get(pilotId)?.values().next().value;
        const pilot = socketId ? this.pilot.sockets.get(socketId)?.data.pilot : undefined;
        if (pilot)
          this.pilot.to(`pilot:${pilotId}`).emit('pilot:sessionStatus', this.sessionStatus(pilot));
      }
    }
  }

  /** Payment updates go only to the paying pilot's own sockets (spec §11.4). */
  notifyPayment(pilotId: string, view: PaymentIntentView): void {
    this.pilot.to(`pilot:${pilotId}`).emit('payment:status', view);
  }

  /** Same wallet signed in on another phone: tell the old phone, then cut it off. */
  replacePilotSessions(pilotId: string): void {
    this.pilot.to(`pilot:${pilotId}`).emit('pilot:notice', { code: 'SESSION_REPLACED' });
    this.pilot.in(`pilot:${pilotId}`).disconnectSockets(true);
  }

  /** After a callsign change: refresh the seat name and the pilot's own status. */
  refreshPilot(pilotId: string): void {
    const pilot = pilotById(this.opts.db, pilotId);
    if (!pilot) return;
    this.runtime.rename(pilot.id, displayNameFor(pilot, this.hideCallsigns));
    for (const id of this.pilotSockets.get(pilotId) ?? []) {
      const sock = this.pilot.sockets.get(id);
      if (sock) sock.data.pilot = pilot;
    }
    this.pilot.to(`pilot:${pilotId}`).emit('pilot:sessionStatus', this.sessionStatus(pilot));
  }

  private sessionStatus(pilot: PilotRow): SessionStatusMsg {
    return {
      authenticated: true,
      pilot: {
        publicName: pilot.public_name,
        kind: pilot.kind,
        callsign: pilot.callsign,
        showCallsign: !!pilot.show_callsign,
      },
      matchId: this.runtime.state.matchId,
      assignedSeat: this.runtime.seatOf(pilot.id),
    };
  }

  /* ------------------------------------------------------------- display */

  private setupDisplay(): void {
    this.display.on('connection', (socket) => {
      this.displays.set(socket.id, {
        id: socket.id,
        connectedAt: Date.now(),
        stats: null,
        statsAt: null,
      });
      socket.emit('display:settings', this.settings);
      socket.emit('match:snapshot', this.runtime.snapshotMsg());
      const bucket = new Bucket(4, 1);
      socket.on('display:stats', (raw) => {
        if (!bucket.take()) return;
        const parsed = displayStatsSchema.safeParse(raw);
        const info = this.displays.get(socket.id);
        if (parsed.success && info) {
          info.stats = parsed.data;
          info.statsAt = Date.now();
        }
      });
      socket.on('disconnect', () => this.displays.delete(socket.id));
    });
  }

  /* --------------------------------------------------------------- pilot */

  private setupPilot(): void {
    const { db } = this.opts;
    this.pilot.use((socket, next) => {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const pilot = pilotForToken(db, cookies[PILOT_COOKIE]);
      if (!pilot) return next(new Error('NOT_AUTHENTICATED'));
      socket.data.pilot = pilot;
      next();
    });

    this.pilot.on('connection', (socket: PilotSocket) => {
      const pilot = socket.data.pilot;
      void socket.join(`pilot:${pilot.id}`);
      const set = this.pilotSockets.get(pilot.id) ?? new Set<string>();
      set.add(socket.id);
      this.pilotSockets.set(pilot.id, set);
      if (set.size === 1) this.runtime.connection(pilot.id, true);
      this.lastSeat.set(pilot.id, this.runtime.seatOf(pilot.id));
      socket.emit('pilot:sessionStatus', this.sessionStatus(pilot));
      socket.emit('match:snapshot', this.runtime.snapshotMsg());

      const bucket = new Bucket(10, 6);
      const limited = () => !bucket.take();

      socket.on('pilot:joinSeat', (raw, ack) => {
        if (typeof ack !== 'function') return;
        if (limited()) return ack({ ok: false, reasonCode: 'RATE_LIMITED' });
        const req = joinSeatReqSchema.safeParse(raw);
        if (!req.success) return ack({ ok: false, reasonCode: 'INVALID' });
        const fresh = pilotById(db, pilot.id) ?? pilot;
        ack(
          this.runtime.joinSeat(
            fresh,
            req.data.matchId,
            req.data.seatId,
            displayNameFor(fresh, this.hideCallsigns),
          ),
        );
      });

      socket.on('pilot:ready', (raw, ack) => {
        if (typeof ack !== 'function') return;
        if (limited()) return ack({ ok: false, reasonCode: 'RATE_LIMITED' });
        const req = readyReqSchema.safeParse(raw);
        if (!req.success) return ack({ ok: false, reasonCode: 'INVALID' });
        ack(this.runtime.ready(pilot, req.data.matchId));
      });

      socket.on('pilot:leave', (raw, ack) => {
        if (typeof ack !== 'function') return;
        const req = leaveReqSchema.safeParse(raw);
        if (!req.success) return ack({ ok: false, reasonCode: 'INVALID' });
        ack(this.runtime.leave(pilot, req.data.matchId));
      });

      socket.on('pilot:action', (raw, ack) => {
        if (typeof ack !== 'function') return;
        const req = pilotActionReqSchema.safeParse(raw);
        const clientActionId =
          typeof raw === 'object' && raw && 'clientActionId' in raw
            ? String(raw.clientActionId).slice(0, 64)
            : '';
        if (!req.success) return ack({ clientActionId, accepted: false, reasonCode: 'INVALID' });
        if (limited()) return ack({ clientActionId, accepted: false, reasonCode: 'RATE_LIMITED' });
        const res = this.runtime.pilotAction(pilot, req.data);
        ack(res);
        socket.emit('pilot:actionResult', res);
      });

      socket.on('pilot:syncFinisher', (raw, ack) => {
        if (typeof ack !== 'function') return;
        const req = syncFinisherReqSchema.safeParse(raw);
        const clientActionId =
          typeof raw === 'object' && raw && 'clientActionId' in raw
            ? String(raw.clientActionId).slice(0, 64)
            : '';
        if (!req.success) return ack({ clientActionId, accepted: false, reasonCode: 'INVALID' });
        if (limited()) return ack({ clientActionId, accepted: false, reasonCode: 'RATE_LIMITED' });
        const seatId = this.runtime.seatOf(pilot.id);
        if (!seatId) return ack({ clientActionId, accepted: false, reasonCode: 'NOT_YOUR_SEAT' });
        const res = this.runtime.pilotAction(pilot, {
          matchId: req.data.matchId,
          seatId,
          clientActionId: req.data.clientActionId,
          action: { actionType: 'SYNC_NOW', payload: {} },
        });
        ack(res);
        socket.emit('pilot:actionResult', res);
      });

      socket.on('disconnect', () => {
        const s = this.pilotSockets.get(pilot.id);
        s?.delete(socket.id);
        if (s && s.size === 0) {
          this.pilotSockets.delete(pilot.id);
          this.lastSeat.delete(pilot.id);
          this.runtime.connection(pilot.id, false);
        }
      });
    });
  }

  /** Disconnects every socket of a pilot (operator FORCE DISCONNECT / logout). */
  disconnectPilot(pilotId: string): void {
    this.pilot.in(`pilot:${pilotId}`).disconnectSockets(true);
  }

  /* ------------------------------------------------------------ operator */

  private setupOperator(): void {
    const { db } = this.opts;
    this.operator.use((socket, next) => {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      if (!isOperatorToken(db, cookies[OPERATOR_COOKIE]))
        return next(new Error('NOT_AUTHENTICATED'));
      next();
    });
    this.operator.on('connection', (socket) => {
      socket.emit('match:snapshot', this.runtime.snapshotMsg());
      socket.emit('operator:status', this.status());
      socket.on('operator:command', async (raw, ack) => {
        if (typeof ack !== 'function') return;
        const cmd = operatorCommandSchema.safeParse(raw);
        if (!cmd.success) return ack({ ok: false, message: 'invalid command' });
        const res = await this.operatorCommand(cmd.data as OperatorCommand);
        this.runtime.audit(
          'operator',
          cmd.data.command,
          res.message ?? (res.ok ? 'ok' : 'refused'),
        );
        ack(res);
        this.pushOperatorStatus();
      });
    });
  }

  async operatorCommand(cmd: OperatorCommand): Promise<OperatorCommandResult> {
    const rt = this.runtime;
    const control = (
      type: 'ATTRACT' | 'OPEN_LOBBY' | 'START' | 'SKIP_DEPLOY' | 'PAUSE' | 'RESUME' | 'END',
    ) => {
      const r = rt.command({ type });
      const ok = r.outcome.kind === 'control' && r.outcome.ok;
      return { ok, message: ok ? `${type} done` : `${type} not possible in ${rt.state.phase}` };
    };
    switch (cmd.command) {
      case 'ATTRACT':
      case 'OPEN_LOBBY':
      case 'START':
      case 'SKIP_DEPLOY':
      case 'PAUSE':
      case 'RESUME':
      case 'END':
        return control(cmd.command);
      case 'RESET':
        rt.replaceMatch('RESET', { attract: true });
        return { ok: true, message: 'match reset' };
      case 'NEXT_ROUND': {
        const p = rt.state.phase;
        if (p !== 'VICTORY' && p !== 'DEFEAT' && p !== 'RESULTS') {
          return { ok: false, message: `NEXT ROUND is for after a result (now ${p}); use RESET` };
        }
        rt.replaceMatch('NEXT_ROUND', { attract: true });
        return { ok: true, message: 'next round opened' };
      }
      case 'SET_AUTO_SUPPORT':
        rt.setAutoSupport(cmd.enabled);
        return { ok: true, message: `AUTO SUPPORT ${cmd.enabled ? 'on' : 'off'}` };
      case 'KICK_SEAT': {
        const pilotId = rt.state.seats[cmd.seatId].pilotId;
        const r = rt.command({ type: 'SEAT_KICK', seatId: cmd.seatId });
        const ok = r.outcome.kind === 'control' && r.outcome.ok;
        if (ok && pilotId) {
          this.pilot.to(`pilot:${pilotId}`).emit('pilot:notice', { code: 'KICKED' });
          this.syncPilotSeats();
        }
        return { ok, message: ok ? `${cmd.seatId} released` : `${cmd.seatId} is empty` };
      }
      case 'SET_PRESET':
        return { ok: true, message: rt.setPreset(cmd.presetId) };
      case 'SET_DISPLAY': {
        const patch = displaySettingsPatchSchema.parse(cmd.settings);
        this.settings = { ...this.settings, ...patch };
        this.display.emit('display:settings', this.settings);
        return { ok: true, message: 'display updated' };
      }
      case 'SET_DEMO_BOTS':
        rt.setDemoBots(cmd.enabled);
        return { ok: true, message: `DEMO BOTS ${cmd.enabled ? 'on' : 'off'}` };
      case 'SET_HIDE_CALLSIGNS': {
        this.hideCallsigns = cmd.hidden;
        for (const id of Object.keys(rt.state.seats) as SeatId[]) {
          const pid = rt.state.seats[id].pilotId;
          const pilot = pid && !rt.state.seats[id].bot ? pilotById(this.opts.db, pid) : null;
          if (pilot) rt.rename(pilot.id, displayNameFor(pilot, cmd.hidden));
        }
        return {
          ok: true,
          message: cmd.hidden ? 'callsigns hidden' : 'callsigns shown when opted in',
        };
      }
      case 'SANDBOX_SETTLE':
        return this.payments.sandboxSettle(cmd.intentId);
      case 'PAYMENTS_CHECK': {
        const c = await this.payments.runChecks();
        const ok = !!c.backend?.ok && !!c.webhook?.ok;
        return { ok, message: ok ? 'checks passed' : 'checks failed — see PAYMENTS panel' };
      }
      case 'PAYMENTS_ENABLE_LIVE':
        return this.payments.enableLive(cmd.confirm);
      case 'PAYMENTS_DISABLE':
        return this.payments.disable();
      case 'TRIGGER_BLACKOUT': {
        const r = rt.command({ type: 'TRIGGER_BLACKOUT' });
        const ok = r.outcome.kind === 'control' && r.outcome.ok;
        return {
          ok,
          message: ok
            ? 'blackout started'
            : rt.state.crisis
              ? 'a blackout is already on'
              : `blackout only during a wave or the boss fight (now ${rt.state.phase})`,
        };
      }
      case 'SET_AUTO_SETTLE_VIRTUAL':
        return this.payments.setAutoSettleVirtual(cmd.enabled);
    }
  }

  private status(): OperatorStatusMsg {
    const audit = recentAudit(this.opts.db, 20) as AuditEntry[];
    return {
      mode: this.opts.env.APP_MODE,
      demoBots: this.runtime.demoBots,
      hideCallsigns: this.hideCallsigns,
      payments: this.payments.operatorView(),
      presetId: this.runtime.state.presetId,
      nextPresetId: this.runtime.nextPresetId,
      joinUrl: this.opts.joinUrl,
      connections: {
        displays: this.display.sockets.size,
        pilots: this.pilotSockets.size,
        operators: this.operator.sockets.size,
      },
      displays: [...this.displays.values()],
      display: this.settings,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      audit,
    };
  }

  private pushOperatorStatus(): void {
    if (this.operator.sockets.size > 0) this.operator.emit('operator:status', this.status());
  }
}
