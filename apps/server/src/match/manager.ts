import { randomInt } from 'node:crypto';
import type {
  GameConfig,
  GameEvent,
  MatchState,
  PaymentMode,
  PublicMatchSnapshot,
} from '@sats-wars/shared';
import { DEFAULT_GAME_CONFIG, gameConfigSchema } from '@sats-wars/shared';
import type { MonoClock, WallClock } from '../clock';
import type { Repo } from '../db/repo';
import { AppError } from '../errors';
import { newId } from '../auth/tokens';
import { MatchRuntime } from './runtime';

export const ADMIN_LIFECYCLE_COMMANDS = [
  'OPEN_LOBBY',
  'START',
  'PAUSE',
  'RESUME',
  'CANCEL',
  'NEXT_MATCH',
] as const;
export type AdminLifecycleCommand = (typeof ADMIN_LIFECYCLE_COMMANDS)[number];

export interface ManagerOptions {
  repo: Repo;
  mono: MonoClock;
  wall: WallClock;
  paymentMode: PaymentMode;
  playUrl: string;
  /** Applied on top of DEFAULT_GAME_CONFIG when no saved next-config exists. */
  configOverrides?: Partial<GameConfig>;
}

type EventsListener = (events: GameEvent[], state: MatchState) => void;
type MatchListener = (runtime: MatchRuntime) => void;

/** Holds the current match and switches to the next one. Single node, single match at a time. */
export class MatchManager {
  private runtime!: MatchRuntime;
  private unbind: (() => void) | null = null;
  private eventListeners = new Set<EventsListener>();
  private matchListeners = new Set<MatchListener>();
  readonly repo: Repo;

  constructor(private opts: ManagerOptions) {
    this.repo = opts.repo;
  }

  /** Recover the latest unfinished match after a restart, or create a fresh one. */
  init(): this {
    const unfinished = this.repo.latestUnfinishedMatch();
    const rt = unfinished
      ? MatchRuntime.recover(this.repo, unfinished.id, this.opts.mono, this.opts.wall)
      : this.createRuntime();
    this.bind(rt);
    return this;
  }

  current(): MatchRuntime {
    return this.runtime;
  }

  get paymentMode(): PaymentMode {
    return this.opts.paymentMode;
  }

  get paymentsEnabled(): boolean {
    return this.repo.getSetting<boolean>('paymentsEnabled') ?? true;
  }

  setPaymentsEnabled(enabled: boolean, actor: string): void {
    const before = this.paymentsEnabled;
    this.repo.setSetting('paymentsEnabled', enabled);
    this.repo.audit(actor, 'SET_PAYMENTS_ENABLED', null, { before, after: enabled }, this.opts.wall.now());
  }

  get nextConfig(): GameConfig {
    const saved = this.repo.getSetting<GameConfig>('nextConfig');
    const parsed = saved ? gameConfigSchema.safeParse(saved) : null;
    if (parsed?.success) return parsed.data;
    return gameConfigSchema.parse({ ...DEFAULT_GAME_CONFIG, ...this.opts.configOverrides });
  }

  setNextConfig(input: unknown, actor: string): GameConfig {
    const parsed = gameConfigSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('BAD_REQUEST', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const before = this.nextConfig;
    this.repo.setSetting('nextConfig', parsed.data);
    this.repo.audit(actor, 'SET_NEXT_CONFIG', null, { before, after: parsed.data }, this.opts.wall.now());
    return parsed.data;
  }

  onEvents(listener: EventsListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onMatchChanged(listener: MatchListener): () => void {
    this.matchListeners.add(listener);
    return () => this.matchListeners.delete(listener);
  }

  tick(): void {
    this.runtime.tick();
  }

  /** Whether new reservations/invoices/passes may be created right now. */
  joinOpen(): boolean {
    const s = this.runtime.state;
    const effective = s.status === 'PAUSED' ? s.pausedFrom : s.status;
    if (effective === 'LOBBY') return true;
    if (effective === 'LIVE') return this.runtime.nowGameMs() < s.config.joinCloseMs;
    return false;
  }

  /** Real ms left until actions close, assuming no pause (used to cap invoice expiry). */
  msUntilActionsClose(): number {
    const s = this.runtime.state;
    const gameMs = this.runtime.nowGameMs();
    const effective = s.status === 'PAUSED' ? s.pausedFrom : s.status;
    if (effective === 'LOBBY') {
      if (s.liveStartClock === null) return Number.POSITIVE_INFINITY;
      return s.config.actionCloseMs - gameMs;
    }
    if (effective === 'LIVE') return s.config.actionCloseMs - gameMs;
    return 0;
  }

  snapshot(): PublicMatchSnapshot {
    return {
      ...this.runtime.snapshotBase(),
      joinOpen: this.joinOpen(),
      paymentsEnabled: this.paymentsEnabled,
      paymentMode: this.opts.paymentMode,
      playUrl: this.opts.playUrl,
    };
  }

  /** Operator lifecycle commands. Every call is audit-logged. */
  command(cmd: AdminLifecycleCommand, actor: string, reason = 'ADMIN'): void {
    const rt = this.runtime;
    const before = rt.state.status;
    const now = this.opts.wall.now();
    if (cmd === 'NEXT_MATCH') {
      if (before !== 'FINISHED' && before !== 'CANCELLED' && before !== 'CREATED') {
        throw new AppError('INVALID_COMMAND', '現在の試合が終了していません / Current match is not finished');
      }
      if (before === 'CREATED') {
        // Nothing happened yet: discard by cancelling so history stays consistent.
        rt.dispatch({ type: 'CANCEL', reason: 'REPLACED' });
      }
      const next = this.createRuntime();
      this.repo.audit(actor, 'NEXT_MATCH', next.matchId, { previous: rt.matchId }, now);
      this.bind(next);
      return;
    }
    const engineCmd =
      cmd === 'OPEN_LOBBY'
        ? ({ type: 'OPEN_LOBBY' } as const)
        : cmd === 'START'
          ? ({ type: 'START_LIVE' } as const)
          : cmd === 'PAUSE'
            ? ({ type: 'PAUSE', reason } as const)
            : cmd === 'RESUME'
              ? ({ type: 'RESUME' } as const)
              : ({ type: 'CANCEL', reason } as const);
    const r = rt.dispatch(engineCmd);
    if (r.outcome.kind === 'rejected') {
      throw new AppError('INVALID_COMMAND', r.outcome.reason);
    }
    this.repo.audit(actor, cmd, rt.matchId, { before, after: rt.state.status, reason }, now);
  }

  private createRuntime(): MatchRuntime {
    const id = newId('m');
    return MatchRuntime.create(
      this.repo,
      id,
      this.nextConfig,
      randomInt(1, 2 ** 31 - 1),
      this.opts.mono,
      this.opts.wall,
    );
  }

  private bind(rt: MatchRuntime): void {
    this.unbind?.();
    this.runtime = rt;
    this.unbind = rt.onEvents((events, state) => {
      if (events.some((e) => e.type === 'MATCH_STATUS_CHANGED' && (e.data.to === 'FINISHED' || e.data.to === 'CANCELLED'))) {
        // Freeze a final public snapshot for /results.
        this.repo.tx(() => this.repo.saveMatchProjection(state, this.opts.wall.now(), this.snapshot()));
      }
      for (const l of this.eventListeners) l(events, state);
    });
    for (const l of this.matchListeners) l(rt);
  }
}
