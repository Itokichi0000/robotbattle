import { io, type Socket } from 'socket.io-client';
import type {
  ArenaPreviewCue,
  ArenaStatus,
  CheerPush,
  ClientToServerEvents,
  EntitlementPush,
  GameEvent,
  RoomRole,
  ServerNotice,
  ServerToClientEvents,
} from '@sats-wars/shared';
import { RaidStore, estimateClock } from '@sats-wars/shared';
import { gameServerUrl } from './serverUrl';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

type Listener = () => void;

/**
 * One Socket.IO connection + a RaidStore mirror.
 * - Resyncs with a full snapshot on connect, reconnect, seq gaps or raid change.
 * - Estimates the server clock offset (NTP-style) for countdowns and minigames.
 * - Pilots are identified by their HttpOnly session cookie (withCredentials);
 *   the admin screen passes its bearer token instead.
 */
export class RaidConnection {
  readonly store = new RaidStore();
  state: ConnectionState = 'connecting';
  offsetMs = 0;
  rttMs = 0;
  pilotsOnline = 0;
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private stateListeners = new Set<Listener>();
  private entitlementListeners = new Set<(e: EntitlementPush) => void>();
  private cheerListeners = new Set<(c: CheerPush) => void>();
  private noticeListeners = new Set<(n: ServerNotice) => void>();
  private cueListeners = new Set<(c: ArenaPreviewCue) => void>();
  private resyncing = false;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private role: RoomRole,
    private token: string | null = null,
  ) {
    this.socket = io(gameServerUrl(), {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    this.socket.on('connect', () => {
      this.setState('connected');
      this.subscribe();
      void this.syncTime();
    });
    this.socket.on('disconnect', () => this.setState('reconnecting'));
    this.socket.io.on('reconnect_attempt', () => this.setState('reconnecting'));
    this.socket.on('connect_error', () =>
      this.setState(this.state === 'connecting' ? 'offline' : 'reconnecting'),
    );
    this.socket.on('raid:snapshot', (snap) => this.store.applySnapshot(snap));
    this.socket.on('raid:event', (e: GameEvent) => {
      if (this.store.applyEvent(e, this.serverNow()) === 'gap') this.resync();
    });
    this.socket.on('raid:clock', (tick) => {
      if (this.store.applyClock(tick) === 'gap') this.resync();
    });
    this.socket.on('pilot:entitlement', (e) => this.entitlementListeners.forEach((l) => l(e)));
    this.socket.on('raid:cheer', (c) => this.cheerListeners.forEach((l) => l(c)));
    this.socket.on('raid:presence', (n) => {
      this.pilotsOnline = n;
      this.notifyState();
    });
    this.socket.on('server:notice', (n) => this.noticeListeners.forEach((l) => l(n)));
    this.socket.on('arena:cue', (c) => this.cueListeners.forEach((l) => l(c)));
    // Periodic reconciliation (cheap safety net for anything a patch missed).
    this.reconcileTimer = setInterval(() => this.resync(), 15_000);
  }

  private subscribe(): void {
    this.socket.emit(
      'raid:subscribe',
      { role: this.role, ...(this.token ? { token: this.token } : {}) },
      () => undefined,
    );
  }

  /** Re-subscribe after login/logout so the pilot room follows the session. */
  resubscribe(token: string | null = this.token): void {
    this.token = token;
    if (this.socket.connected) this.subscribe();
  }

  serverNow(): number {
    return Date.now() + this.offsetMs;
  }

  /** Current raid game ms estimated locally from the last anchor. */
  gameNow = (): number => {
    const s = this.store.snapshot;
    if (!s) return 0;
    return estimateClock(s, this.serverNow()).gameMs;
  };

  resync(): void {
    if (this.resyncing || !this.socket.connected) return;
    this.resyncing = true;
    this.socket.emit('raid:request-snapshot', (snap) => {
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
        this.socket.emit('time:sync', t0, (st) => {
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
    if (this.socket.connected) this.socket.emit('arena:status', status);
  }

  onState(l: Listener): () => void {
    this.stateListeners.add(l);
    return () => {
      this.stateListeners.delete(l);
    };
  }
  /** This pilot's raid pass was granted (payment settled, sponsored code…). */
  onEntitlement(l: (e: EntitlementPush) => void): () => void {
    this.entitlementListeners.add(l);
    return () => {
      this.entitlementListeners.delete(l);
    };
  }
  /** Free cheers from anyone (shown on the big screen). */
  onCheer(l: (c: CheerPush) => void): () => void {
    this.cheerListeners.add(l);
    return () => {
      this.cheerListeners.delete(l);
    };
  }
  /** Rehearsal effects from /admin (venue screens only, DEMO). */
  onArenaCue(l: (c: ArenaPreviewCue) => void): () => void {
    this.cueListeners.add(l);
    return () => {
      this.cueListeners.delete(l);
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
