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
  SessionStatusMsg,
} from '@swed/shared';
import {
  displaySettingsPatchSchema,
  displayStatsSchema,
  operatorCommandSchema,
  pilotActionReqSchema,
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
  }

  onSnapshot = (msg: ReturnType<MatchRuntime['snapshotMsg']>): void => {
    this.display.emit('match:snapshot', msg);
    this.pilot.emit('match:snapshot', msg);
    this.operator.emit('match:snapshot', msg);
  };

  /** A new match opened: every connected phone is already in it; tell them. */
  onMatchReplaced(): void {
    for (const pilotId of this.pilotSockets.keys()) {
      const pilot = pilotById(this.opts.db, pilotId);
      if (pilot)
        this.pilot.to(`pilot:${pilotId}`).emit('pilot:sessionStatus', this.sessionStatus(pilot));
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
      joined: this.runtime.isJoined(pilot.id),
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
      // Scanning the QR is joining: no seats to pick, no limit on people.
      if (set.size === 1) {
        const fresh = pilotById(db, pilot.id) ?? pilot;
        this.runtime.connect(fresh, displayNameFor(fresh, this.hideCallsigns));
      }
      socket.emit('pilot:sessionStatus', this.sessionStatus(pilot));
      socket.emit('match:snapshot', this.runtime.snapshotMsg());

      // A person taps at most ~1.5/s (the free cooldown); bursts are fine, scripts are not.
      const bucket = new Bucket(8, 4);

      socket.on('pilot:action', (raw, ack) => {
        if (typeof ack !== 'function') return;
        const req = pilotActionReqSchema.safeParse(raw);
        const clientActionId =
          typeof raw === 'object' && raw && 'clientActionId' in raw
            ? String(raw.clientActionId).slice(0, 64)
            : '';
        if (!req.success) return ack({ clientActionId, accepted: false, reasonCode: 'INVALID' });
        if (!bucket.take())
          return ack({ clientActionId, accepted: false, reasonCode: 'RATE_LIMITED' });
        if (!this.runtime.isJoined(pilot.id)) {
          const fresh = pilotById(db, pilot.id) ?? pilot;
          this.runtime.connect(fresh, displayNameFor(fresh, this.hideCallsigns));
        }
        ack(this.runtime.pilotAction(pilot, req.data));
      });

      socket.on('disconnect', () => {
        const s = this.pilotSockets.get(pilot.id);
        s?.delete(socket.id);
        if (s && s.size === 0) {
          this.pilotSockets.delete(pilot.id);
          this.runtime.disconnect(pilot.id);
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
    const control = (type: 'START' | 'SKIP_DEPLOY' | 'PAUSE' | 'RESUME' | 'END') => {
      const r = rt.command({ type });
      const ok = r.outcome.kind === 'control' && r.outcome.ok;
      return { ok, message: ok ? `${type} done` : `${type} not possible in ${rt.state.phase}` };
    };
    switch (cmd.command) {
      case 'START':
      case 'SKIP_DEPLOY':
      case 'PAUSE':
      case 'RESUME':
      case 'END':
        return control(cmd.command);
      case 'RESET':
        rt.replaceMatch('RESET');
        return { ok: true, message: 'match reset' };
      case 'NEXT_ROUND': {
        const p = rt.state.phase;
        if (p !== 'VICTORY' && p !== 'DEFEAT' && p !== 'RESULTS') {
          return { ok: false, message: `NEXT ROUND is for after a result (now ${p}); use RESET` };
        }
        rt.replaceMatch('NEXT_ROUND');
        return { ok: true, message: 'next round opened' };
      }
      case 'SET_AUTO_START':
        rt.setAutoStart(cmd.enabled);
        return { ok: true, message: `AUTO START ${cmd.enabled ? 'on' : 'off'}` };
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
        for (const p of Object.values(rt.state.players)) {
          const pilot = p.bot ? null : pilotById(this.opts.db, p.pilotId);
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
      case 'SET_AUTO_SETTLE_VIRTUAL':
        return this.payments.setAutoSettleVirtual(cmd.enabled);
    }
  }

  private status(): OperatorStatusMsg {
    const audit = recentAudit(this.opts.db, 20) as AuditEntry[];
    return {
      mode: this.opts.env.APP_MODE,
      demoBots: this.runtime.demoBots,
      autoStart: this.runtime.autoStart,
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
