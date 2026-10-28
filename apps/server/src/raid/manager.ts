import { randomInt } from 'node:crypto';
import type { Broadcast, GameConfig, GameEvent, PassMode, PaymentMode, PublicRaidSnapshot, RaidState } from '@sats-wars/shared';
import { DEFAULT_GAME_CONFIG, gameConfigSchema } from '@sats-wars/shared';
import type { MonoClock, WallClock } from '../clock';
import type { Repo } from '../db/repo';
import { AppError } from '../errors';
import { newId } from '../auth/tokens';
import { RaidRuntime } from './runtime';

export const ADMIN_LIFECYCLE_COMMANDS = ['OPEN_LOBBY', 'START', 'PAUSE', 'RESUME', 'END', 'CANCEL', 'NEXT_RAID'] as const;
export type AdminLifecycleCommand = (typeof ADMIN_LIFECYCLE_COMMANDS)[number];

/** Pilots count as "online" while seen within this window. */
export const ONLINE_WINDOW_MS = 2 * 60_000;

/**
 * After a crash/restart the raid comes back PAUSED. With auto-loop on, the
 * venue screen is probably unattended, so resume by itself after this delay
 * (an operator can still pause it from /admin).
 */
export const RESTART_AUTO_RESUME_MS = 10_000;

/** Once someone is aboard, the lobby waits at least this long for friends. */
export const LOBBY_AFTER_FIRST_PILOT_MS = 20_000;

/**
 * Monotonic clock with an adjustable speed (demo only: 10× rehearsal of a
 * whole raid). Re-anchors on every change so it never jumps backwards.
 */
export class ScaledClock implements MonoClock {
  private scale = 1;
  private anchorReal: number;
  private anchorScaled: number;
  constructor(private real: MonoClock) {
    this.anchorReal = real.now();
    this.anchorScaled = this.anchorReal;
  }
  now(): number {
    return this.anchorScaled + (this.real.now() - this.anchorReal) * this.scale;
  }
  get speed(): number {
    return this.scale;
  }
  setSpeed(x: number): void {
    this.anchorScaled = this.now();
    this.anchorReal = this.real.now();
    this.scale = x;
  }
}

export interface ManagerOptions {
  repo: Repo;
  mono: MonoClock;
  wall: WallClock;
  paymentMode: PaymentMode;
  playUrl: string;
  eventId: string;
  demoMode: boolean;
  defaultPassMode: PassMode;
  /** Applied on top of DEFAULT_GAME_CONFIG when no saved next-config exists. */
  configOverrides?: Partial<GameConfig>;
}

type EventsListener = (events: GameEvent[], state: RaidState) => void;
type RaidListener = (runtime: RaidRuntime) => void;
type EndedListener = (state: RaidState, runtime: RaidRuntime) => void;

/**
 * Holds the current raid and keeps the venue running unattended:
 * lobby → (auto start once someone boarded and the lobby time passed) → raid →
 * results for `resultsSeconds` → next raid. Operators can take over any step.
 */
export class RaidManager {
  private runtime!: RaidRuntime;
  private unbind: (() => void) | null = null;
  private eventListeners = new Set<EventsListener>();
  private raidListeners = new Set<RaidListener>();
  private endedListeners = new Set<EndedListener>();
  private lobbyOpenedAt: number | null = null;
  private firstPilotAt: number | null = null;
  private endedAt: number | null = null;
  private restartPausedAt: number | null = null;
  private onlineCache: { at: number; value: number } | null = null;
  private bestScoreCache: { hash: string; value: number | null } | null = null;
  readonly clock: ScaledClock;
  readonly repo: Repo;

  constructor(private opts: ManagerOptions) {
    this.repo = opts.repo;
    this.clock = new ScaledClock(opts.mono);
  }

  init(): this {
    const unfinished = this.repo.latestUnfinishedRaid();
    const rt = unfinished ? RaidRuntime.recover(this.repo, unfinished.id, this.clock, this.opts.wall) : this.createRuntime();
    this.bind(rt);
    if (rt.state.status === 'CREATED' && this.autoLoop) this.openLobby('auto-loop');
    if (rt.state.status === 'LOBBY_OPEN') this.lobbyOpenedAt = this.opts.wall.now();
    if (rt.state.status === 'PAUSED' && rt.state.pauseReason === 'SERVER_RESTART') this.restartPausedAt = this.opts.wall.now();
    return this;
  }

  current(): RaidRuntime {
    return this.runtime;
  }

  get eventId(): string {
    return this.opts.eventId;
  }
  get demoMode(): boolean {
    return this.opts.demoMode;
  }
  get paymentMode(): PaymentMode {
    return this.opts.paymentMode;
  }

  // ---- operator switches (persisted) ------------------------------------------

  private setting<T>(key: string, fallback: T): T {
    return this.repo.getSetting<T>(key) ?? fallback;
  }
  private set(key: string, value: unknown, actor: string, action: string): void {
    const before = this.repo.getSetting(key) ?? null;
    this.repo.setSetting(key, value);
    this.repo.audit(actor, action, null, { before, after: value }, this.opts.wall.now());
  }

  /** New paid (Lightning) passes may be bought. Sponsored and free passes are unaffected. */
  get paymentsEnabled(): boolean {
    return this.setting('paymentsEnabled', true);
  }
  setPaymentsEnabled(v: boolean, actor: string): void {
    this.set('paymentsEnabled', v, actor, 'SET_PAYMENTS_ENABLED');
  }
  /** Kill switch: no new pilots may board (spectating continues). */
  get joinStopped(): boolean {
    return this.setting('joinStopped', false);
  }
  setJoinStopped(v: boolean, actor: string): void {
    this.set('joinStopped', v, actor, 'SET_JOIN_STOPPED');
  }
  get namesHidden(): boolean {
    return this.setting('namesHidden', false);
  }
  setNamesHidden(v: boolean, actor: string): void {
    this.set('namesHidden', v, actor, 'SET_NAMES_HIDDEN');
    this.runtime.namesHidden = v;
  }
  get autoLoop(): boolean {
    return this.setting('autoLoop', true);
  }
  setAutoLoop(v: boolean, actor: string): void {
    this.set('autoLoop', v, actor, 'SET_AUTO_LOOP');
  }
  get passMode(): PassMode {
    return this.setting<PassMode>('passMode', this.opts.defaultPassMode);
  }
  setPassMode(v: PassMode, actor: string): void {
    this.set('passMode', v, actor, 'SET_PASS_MODE');
  }
  get broadcast(): Broadcast | null {
    const b = this.repo.getSetting<Broadcast>('broadcast');
    return b && b.until > this.opts.wall.now() ? b : null;
  }
  setBroadcast(b: Broadcast | null, actor: string): void {
    this.set('broadcast', b, actor, b ? 'BROADCAST' : 'BROADCAST_CLEAR');
  }
  setSpeed(x: number, actor: string): void {
    if (!this.opts.demoMode) throw new AppError('FORBIDDEN', 'time scale is only available in DEMO_MODE');
    this.clock.setSpeed(x);
    this.repo.audit(actor, 'SET_TIME_SCALE', this.runtime.raidId, { speed: x }, this.opts.wall.now());
  }

  get nextConfig(): GameConfig {
    const saved = this.repo.getSetting<GameConfig>('nextConfig');
    const parsed = saved ? gameConfigSchema.safeParse(saved) : null;
    if (parsed?.success) return parsed.data;
    return gameConfigSchema.parse({ ...structuredClone(DEFAULT_GAME_CONFIG), ...this.opts.configOverrides });
  }

  setNextConfig(input: unknown, actor: string): GameConfig {
    const parsed = gameConfigSchema.safeParse(input);
    if (!parsed.success) throw new AppError('BAD_REQUEST', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const before = this.nextConfig;
    this.repo.setSetting('nextConfig', parsed.data);
    this.repo.audit(actor, 'SET_NEXT_CONFIG', null, { before, after: parsed.data }, this.opts.wall.now());
    return parsed.data;
  }

  // ---- join window ---------------------------------------------------------------

  /** Boarding open right now (lobby, or the raid before its cutoff). */
  joinOpen(): boolean {
    if (this.joinStopped) return false;
    const s = this.runtime.state;
    if (s.status === 'LOBBY_OPEN' || s.status === 'CREATED') return true;
    if (s.status !== 'LIVE' && s.status !== 'PAUSED') return false;
    return this.runtime.nowGameMs() < s.config.cutoffForPaidJoinAtSeconds * 1000;
  }

  /** Remaining ms of boarding (null = no deadline yet, e.g. lobby). */
  joinRemainingMs(): number | null {
    const s = this.runtime.state;
    if (s.status !== 'LIVE' && s.status !== 'PAUSED') return null;
    return Math.max(0, s.config.cutoffForPaidJoinAtSeconds * 1000 - this.runtime.nowGameMs());
  }

  lobbyEndsAt(): number | null {
    if (this.runtime.state.status !== 'LOBBY_OPEN' || this.lobbyOpenedAt === null || this.firstPilotAt === null) return null;
    return Math.max(this.lobbyOpenedAt + this.runtime.state.config.lobbySeconds * 1000, this.firstPilotAt + LOBBY_AFTER_FIRST_PILOT_MS);
  }

  // ---- listeners -------------------------------------------------------------------

  onEvents(listener: EventsListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }
  onRaidChanged(listener: RaidListener): () => void {
    this.raidListeners.add(listener);
    return () => {
      this.raidListeners.delete(listener);
    };
  }
  /** Raid ended (success/failure/cancel): passports, final snapshot. */
  onRaidEnded(listener: EndedListener): () => void {
    this.endedListeners.add(listener);
    return () => {
      this.endedListeners.delete(listener);
    };
  }

  // ---- loop ---------------------------------------------------------------------------

  tick(): void {
    this.runtime.tick();
    this.maybeResumeAfterRestart();
    const s = this.runtime.state;
    const now = this.opts.wall.now();
    if (s.status === 'LOBBY_OPEN') {
      if (this.firstPilotAt === null && Object.keys(s.pilots).length > 0) this.firstPilotAt = now;
      const ends = this.lobbyEndsAt();
      if (this.autoLoop && ends !== null && now >= ends) this.dispatchAudited({ type: 'START' }, 'auto-loop', 'START');
      return;
    }
    if (s.status !== 'ENDED' && s.status !== 'CANCELLED') {
      this.endedAt = null;
      return;
    }
    this.endedAt ??= now;
    if (this.autoLoop && now - this.endedAt >= s.config.resultsSeconds * 1000) {
      this.endedAt = null;
      this.startNextRaid('auto-loop');
    }
  }

  private maybeResumeAfterRestart(): void {
    if (this.restartPausedAt === null) return;
    const s = this.runtime.state;
    if (s.status !== 'PAUSED' || s.pauseReason !== 'SERVER_RESTART') {
      this.restartPausedAt = null;
      return;
    }
    if (!this.autoLoop || this.opts.wall.now() - this.restartPausedAt < RESTART_AUTO_RESUME_MS) return;
    this.restartPausedAt = null;
    this.runtime.dispatch({ type: 'RESUME' });
    this.repo.audit('auto-loop', 'RESUME', this.runtime.raidId, { reason: 'SERVER_RESTART' }, this.opts.wall.now());
  }

  pilotsOnline(): number {
    const now = this.opts.wall.now();
    if (!this.onlineCache || now - this.onlineCache.at > 1000) {
      this.onlineCache = { at: now, value: this.repo.pilotsActiveSince(now - ONLINE_WINDOW_MS) };
    }
    return this.onlineCache.value;
  }

  invalidatePresence(): void {
    this.onlineCache = null;
  }

  bestScore(): number | null {
    const hash = this.runtime.state.configHash;
    if (!this.bestScoreCache || this.bestScoreCache.hash !== hash) this.bestScoreCache = { hash, value: this.repo.bestScore(hash) };
    return this.bestScoreCache.value;
  }

  snapshot(): PublicRaidSnapshot {
    const s = this.runtime.state;
    return {
      ...this.runtime.snapshotBase(),
      lobbyEndsAt: this.lobbyEndsAt(),
      joinOpen: this.joinOpen(),
      passMode: this.passMode,
      ticketPriceSats: s.config.ticketPriceSats,
      paymentsEnabled: this.paymentsEnabled,
      paymentMode: this.opts.paymentMode,
      playUrl: this.opts.playUrl,
      eventId: this.opts.eventId,
      broadcast: this.broadcast,
      namesHidden: this.namesHidden,
      demoMode: this.opts.demoMode,
      bestScore: this.bestScore(),
    };
  }

  /** Operator lifecycle commands. Every call is audit-logged. */
  command(cmd: AdminLifecycleCommand, actor: string, reason = 'ADMIN'): void {
    const before = this.runtime.state.status;
    switch (cmd) {
      case 'NEXT_RAID':
        if (before === 'LIVE' || before === 'PAUSED') {
          throw new AppError('INVALID_COMMAND', '進行中の作戦を先に終了または中止してください / End or cancel the running raid first');
        }
        if (before === 'CREATED' || before === 'LOBBY_OPEN') this.runtime.dispatch({ type: 'CANCEL', reason: 'REPLACED' });
        this.startNextRaid(actor);
        return;
      case 'OPEN_LOBBY':
        this.openLobby(actor);
        return;
      case 'START':
        return this.dispatchAudited({ type: 'START' }, actor, cmd, reason);
      case 'PAUSE':
        return this.dispatchAudited({ type: 'PAUSE', reason }, actor, cmd, reason);
      case 'RESUME':
        return this.dispatchAudited({ type: 'RESUME' }, actor, cmd, reason);
      case 'END':
        return this.dispatchAudited({ type: 'END', reason }, actor, cmd, reason);
      case 'CANCEL':
        return this.dispatchAudited({ type: 'CANCEL', reason }, actor, cmd, reason);
    }
  }

  private dispatchAudited(input: Parameters<RaidRuntime['dispatch']>[0], actor: string, action: string, reason?: string): void {
    const before = this.runtime.state.status;
    const r = this.runtime.dispatch(input);
    if (r.outcome.kind === 'rejected') throw new AppError('INVALID_COMMAND', r.outcome.reason);
    this.repo.audit(actor, action, this.runtime.raidId, { before, after: this.runtime.state.status, reason }, this.opts.wall.now());
  }

  private openLobby(actor: string): void {
    this.dispatchAudited({ type: 'OPEN_LOBBY' }, actor, 'OPEN_LOBBY');
    this.lobbyOpenedAt = this.opts.wall.now();
    this.firstPilotAt = null;
  }

  private startNextRaid(actor: string): void {
    const prev = this.runtime.raidId;
    const next = this.createRuntime();
    this.repo.audit(actor, 'NEXT_RAID', next.raidId, { previous: prev }, this.opts.wall.now());
    this.bind(next);
    if (this.autoLoop) this.openLobby(actor);
  }

  private createRuntime(): RaidRuntime {
    const rt = RaidRuntime.create(this.repo, newId('raid'), this.opts.eventId, this.nextConfig, randomInt(1, 2 ** 31 - 1), this.clock, this.opts.wall);
    return rt;
  }

  private bind(rt: RaidRuntime): void {
    this.unbind?.();
    this.runtime = rt;
    rt.namesHidden = this.namesHidden;
    this.lobbyOpenedAt = null;
    this.firstPilotAt = null;
    this.unbind = rt.onEvents((events, state) => {
      for (const l of this.eventListeners) l(events, state);
      if (events.some((e) => e.type === 'RAID_ENDED')) {
        // Freeze a public snapshot for /results, then passports.
        rt.persistProjection(this.snapshot());
        this.bestScoreCache = null;
        for (const l of this.endedListeners) l(state, rt);
      }
    });
    for (const l of this.raidListeners) l(rt);
  }
}
