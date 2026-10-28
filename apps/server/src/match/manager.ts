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

export const ADMIN_LIFECYCLE_COMMANDS = ['START', 'PAUSE', 'RESUME', 'CANCEL', 'NEXT_MATCH'] as const;
export type AdminLifecycleCommand = (typeof ADMIN_LIFECYCLE_COMMANDS)[number];

/** Players count as "defenders online" while active within this window. */
export const SUPPORTER_WINDOW_MS = 10 * 60_000;

/**
 * After a crash/restart the campaign comes back PAUSED. With auto-loop on, the
 * venue screen is probably unattended, so resume by itself after this delay
 * (an operator can still pause it from /admin).
 */
export const RESTART_AUTO_RESUME_MS = 10_000;

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

/**
 * Holds the current campaign and keeps the venue running unattended: a new
 * campaign starts automatically a few seconds after Japan falls
 * (unless an operator turns the loop off or cancels).
 */
export class MatchManager {
  private runtime!: MatchRuntime;
  private unbind: (() => void) | null = null;
  private eventListeners = new Set<EventsListener>();
  private matchListeners = new Set<MatchListener>();
  private finishedAt: number | null = null;
  private restartPausedAt: number | null = null;
  private onlineCache: { at: number; value: number } | null = null;
  private bestWaveCache: number | null = null;
  readonly repo: Repo;

  constructor(private opts: ManagerOptions) {
    this.repo = opts.repo;
  }

  /** Recover the latest unfinished campaign after a restart, or create a fresh one. */
  init(): this {
    const unfinished = this.repo.latestUnfinishedMatch();
    const rt = unfinished
      ? MatchRuntime.recover(this.repo, unfinished.id, this.opts.mono, this.opts.wall)
      : this.createRuntime();
    this.bind(rt);
    if (rt.state.status === 'CREATED' && this.autoLoop) rt.dispatch({ type: 'START' });
    if (rt.state.status === 'PAUSED' && rt.state.pauseReason === 'SERVER_RESTART') {
      this.restartPausedAt = this.opts.wall.now();
    }
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

  /** Continuous play: start campaigns automatically and roll to the next one. */
  get autoLoop(): boolean {
    return this.repo.getSetting<boolean>('autoLoop') ?? true;
  }

  setAutoLoop(enabled: boolean, actor: string): void {
    const before = this.autoLoop;
    this.repo.setSetting('autoLoop', enabled);
    this.repo.audit(actor, 'SET_AUTO_LOOP', null, { before, after: enabled }, this.opts.wall.now());
  }

  get nextConfig(): GameConfig {
    const saved = this.repo.getSetting<GameConfig>('nextConfig');
    const parsed = saved ? gameConfigSchema.safeParse(saved) : null;
    if (parsed?.success) return parsed.data;
    return gameConfigSchema.parse({ ...DEFAULT_GAME_CONFIG, ...this.opts.configOverrides });
  }

  /** Config that new players see right now (price, top-up options). */
  get liveConfig(): GameConfig {
    return this.runtime.state.config;
  }

  setNextConfig(input: unknown, actor: string): GameConfig {
    const parsed = gameConfigSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(
        'BAD_REQUEST',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    const before = this.nextConfig;
    this.repo.setSetting('nextConfig', parsed.data);
    this.repo.audit(actor, 'SET_NEXT_CONFIG', null, { before, after: parsed.data }, this.opts.wall.now());
    return parsed.data;
  }

  onEvents(listener: EventsListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onMatchChanged(listener: MatchListener): () => void {
    this.matchListeners.add(listener);
    return () => {
      this.matchListeners.delete(listener);
    };
  }

  tick(): void {
    this.runtime.tick();
    this.maybeResumeAfterRestart();
    const st = this.runtime.state.status;
    if (st !== 'FINISHED') {
      this.finishedAt = null;
      return;
    }
    const now = this.opts.wall.now();
    this.finishedAt ??= now;
    if (this.autoLoop && now - this.finishedAt >= this.runtime.state.config.nextCampaignDelayMs) {
      this.finishedAt = null;
      this.startNextCampaign('auto-loop');
    }
  }

  private maybeResumeAfterRestart(): void {
    if (this.restartPausedAt === null) return;
    const s = this.runtime.state;
    // Someone already resumed/paused it by hand: stop managing it.
    if (s.status !== 'PAUSED' || s.pauseReason !== 'SERVER_RESTART') {
      this.restartPausedAt = null;
      return;
    }
    if (!this.autoLoop || this.opts.wall.now() - this.restartPausedAt < RESTART_AUTO_RESUME_MS) return;
    this.restartPausedAt = null;
    this.runtime.dispatch({ type: 'RESUME' });
    this.repo.audit('auto-loop', 'RESUME', this.runtime.matchId, { reason: 'SERVER_RESTART' }, this.opts.wall.now());
  }

  playersOnline(): number {
    const now = this.opts.wall.now();
    if (!this.onlineCache || now - this.onlineCache.at > 1000) {
      this.onlineCache = { at: now, value: this.repo.playersActiveSince(now - SUPPORTER_WINDOW_MS) };
    }
    return this.onlineCache.value;
  }

  invalidatePresence(): void {
    this.onlineCache = null;
  }

  /** Record to beat: best wave of any campaign, including the running one. */
  bestWave(): number {
    this.bestWaveCache ??= this.repo.bestWave();
    return Math.max(this.bestWaveCache, this.runtime.state.wave);
  }

  snapshot(): PublicMatchSnapshot {
    return {
      ...this.runtime.snapshotBase(),
      playersOnline: this.playersOnline(),
      bestWave: this.bestWave(),
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
      if (before === 'LIVE' || before === 'PAUSED') {
        throw new AppError('INVALID_COMMAND', '進行中の防衛戦を先に中止してください / Cancel the running campaign first');
      }
      if (before === 'CREATED') rt.dispatch({ type: 'CANCEL', reason: 'REPLACED' });
      this.startNextCampaign(actor);
      return;
    }
    const engineCmd =
      cmd === 'START'
        ? ({ type: 'START' } as const)
        : cmd === 'PAUSE'
          ? ({ type: 'PAUSE', reason } as const)
          : cmd === 'RESUME'
            ? ({ type: 'RESUME' } as const)
            : ({ type: 'CANCEL', reason } as const);
    const r = rt.dispatch(engineCmd);
    if (r.outcome.kind === 'rejected') throw new AppError('INVALID_COMMAND', r.outcome.reason);
    this.repo.audit(actor, cmd, rt.matchId, { before, after: rt.state.status, reason }, now);
  }

  private startNextCampaign(actor: string): void {
    const prev = this.runtime.matchId;
    const next = this.createRuntime();
    this.repo.audit(actor, 'NEXT_MATCH', next.matchId, { previous: prev }, this.opts.wall.now());
    this.bind(next);
    if (this.autoLoop) next.dispatch({ type: 'START' });
  }

  private createRuntime(): MatchRuntime {
    return MatchRuntime.create(
      this.repo,
      newId('m'),
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
      if (
        events.some(
          (e) => e.type === 'MATCH_STATUS_CHANGED' && (e.data.to === 'FINISHED' || e.data.to === 'CANCELLED'),
        )
      ) {
        // Freeze a final public snapshot for /results.
        this.repo.tx(() => this.repo.saveMatchProjection(state, this.opts.wall.now(), this.snapshot()));
        this.bestWaveCache = null;
      }
      for (const l of this.eventListeners) l(events, state);
    });
    for (const l of this.matchListeners) l(rt);
  }
}
