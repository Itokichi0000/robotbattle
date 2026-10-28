import { io, type Socket } from 'socket.io-client';
import type {
  ActionResponse,
  ArenaStatus,
  ClientToServerEvents,
  GameEvent,
  PaymentStatusPush,
  RoomRole,
  ServerNotice,
  ServerToClientEvents,
} from '@sats-wars/shared';
import { MatchStore, estimateClock } from '@sats-wars/shared';
import { gameServerUrl } from './serverUrl';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

type Listener = () => void;

/**
 * One Socket.IO connection + a MatchStore mirror.
 * - Resyncs with a full snapshot on connect, reconnect, seq gaps or match change.
 * - Estimates server clock offset (NTP-style) for countdown timers.
 */
export class MatchConnection {
  readonly store = new MatchStore();
  state: ConnectionState = 'connecting';
  offsetMs = 0;
  rttMs = 0;
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private stateListeners = new Set<Listener>();
  private paymentListeners = new Set<(s: PaymentStatusPush) => void>();
  private ackListeners = new Set<(a: ActionResponse) => void>();
  private noticeListeners = new Set<(n: ServerNotice) => void>();
  private resyncing = false;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private role: RoomRole,
    private token: string | null = null,
  ) {
    this.socket = io(gameServerUrl(), {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    this.socket.on('connect', () => {
      this.setState('connected');
      this.socket.emit(
        'joinRoom',
        { role: this.role, token: this.token ?? undefined },
        () => undefined,
      );
      void this.syncTime();
    });
    this.socket.on('disconnect', () => this.setState('reconnecting'));
    this.socket.io.on('reconnect_attempt', () => this.setState('reconnecting'));
    this.socket.on('connect_error', () =>
      this.setState(this.state === 'connecting' ? 'offline' : 'reconnecting'),
    );
    this.socket.on('matchSnapshot', (snap) => this.store.applySnapshot(snap));
    this.socket.on('matchEvent', (e: GameEvent) => {
      if (this.store.applyEvent(e, this.serverNow()) === 'gap') this.resync();
    });
    this.socket.on('clockTick', (tick) => {
      if (this.store.applyClock(tick) === 'gap') this.resync();
    });
    this.socket.on('paymentStatus', (s) => this.paymentListeners.forEach((l) => l(s)));
    this.socket.on('actionAck', (a) => this.ackListeners.forEach((l) => l(a)));
    this.socket.on('serverNotice', (n) => this.noticeListeners.forEach((l) => l(n)));
    // Periodic reconciliation (leaders etc. are only in snapshots).
    this.reconcileTimer = setInterval(() => this.resync(), 15_000);
  }

  setToken(token: string | null): void {
    this.token = token;
    if (this.socket.connected) {
      this.socket.emit('joinRoom', { role: this.role, token: token ?? undefined }, () => undefined);
    }
  }

  serverNow(): number {
    return Date.now() + this.offsetMs;
  }

  /** Current game/clock ms estimated locally from the last anchor. */
  now(): { clockMs: number; gameMs: number } {
    const s = this.store.snapshot;
    if (!s) return { clockMs: 0, gameMs: 0 };
    return estimateClock(s, this.serverNow());
  }

  resync(): void {
    if (this.resyncing || !this.socket.connected) return;
    this.resyncing = true;
    this.socket.emit('requestSnapshot', (snap) => {
      this.resyncing = false;
      this.store.applySnapshot(snap);
    });
    setTimeout(() => (this.resyncing = false), 3000);
  }

  private async syncTime(): Promise<void> {
    const samples: Array<{ offset: number; rtt: number }> = [];
    for (let i = 0; i < 4; i++) {
      const t0 = Date.now();
      const serverTime = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000);
        this.socket.emit('timeSync', t0, (st) => {
          clearTimeout(timer);
          resolve(st);
        });
      });
      const t1 = Date.now();
      if (serverTime !== null) samples.push({ offset: serverTime - (t0 + t1) / 2, rtt: t1 - t0 });
    }
    if (samples.length) {
      samples.sort((a, b) => a.rtt - b.rtt);
      this.offsetMs = samples[0]!.offset;
      this.rttMs = samples[0]!.rtt;
      this.notifyState();
    }
  }

  reportArenaStatus(status: ArenaStatus): void {
    if (this.socket.connected) this.socket.emit('arenaStatus', status);
  }

  onState(l: Listener): () => void {
    this.stateListeners.add(l);
    return () => {
      this.stateListeners.delete(l);
    };
  }
  onPayment(l: (s: PaymentStatusPush) => void): () => void {
    this.paymentListeners.add(l);
    return () => {
      this.paymentListeners.delete(l);
    };
  }
  onAck(l: (a: ActionResponse) => void): () => void {
    this.ackListeners.add(l);
    return () => {
      this.ackListeners.delete(l);
    };
  }
  onNotice(l: (n: ServerNotice) => void): () => void {
    this.noticeListeners.add(l);
    return () => {
      this.noticeListeners.delete(l);
    };
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    this.notifyState();
  }
  private notifyState(): void {
    this.stateListeners.forEach((l) => l());
  }

  close(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.socket.close();
  }
}
