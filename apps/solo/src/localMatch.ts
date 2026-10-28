import type { ActionResult, CheerPush, GameConfig, GameEvent, MatchState, PlayerAction, RegionId } from '@sats-wars/shared';
import { DEFAULT_GAME_CONFIG, isClockRunning } from '@sats-wars/shared';
import { type EngineCommand, type Rng, createMatchState, mulberry32, reduce } from '@sats-wars/game-engine';

export interface SoloOptions {
  nickname: string;
  /**
   * Simulated other visitors who press おすすめ now and then. In the venue the
   * game only moves when someone pays; here they stand in for the crowd.
   * 0 = you alone.
   */
  crowd: number;
  seed?: number;
  config?: GameConfig;
}

interface Bot {
  id: string;
  nickname: string;
  /** Mean ms between moves; varies per bot so the crowd feels bursty. */
  gapMs: number;
  next: number;
}

const BOT_NAMES = ['雷丸', 'ツムジ', 'イナズマ', '疾風', 'Volt', 'Gale', '稲光', '颯', 'Spark', 'Zephyr'];
const CHEERS = ['📣', '🔥', '⚡', '🌀', '👏', '💪'] as const;

export const PLAYER_ID = 'you';
/** Demo credit handed out at the start, like sats handed out at the venue. */
export const STARTING_CREDIT = 210;

export type ActOutcome =
  | { ok: true; result: ActionResult; creditSats: number }
  | { ok: false; reason: 'NO_CREDIT' | 'TOO_FAST' | 'REFUSED'; result?: ActionResult };

/**
 * Stand-in for the venue server inside one browser page: the same engine
 * reducer, a pause-aware clock, a few simulated visitors, and a local
 * (pretend) sats balance. Nothing leaves the page and no payment exists.
 */
export class LocalMatch {
  state: MatchState;
  readonly options: SoloOptions;
  creditSats = STARTING_CREDIT;
  myActions = 0;
  myKills = 0;
  campaigns = 1;
  bestWave = 0;
  version = 0;
  private bots: Bot[] = [];
  private rng: Rng;
  private baseClock = 0;
  private runningSince: number | null = null;
  private finishedAt: number | null = null;
  private lastActAt = -1e9;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: GameEvent) => void>();
  private cheerListeners = new Set<(c: CheerPush) => void>();

  constructor(
    options: SoloOptions,
    private now: () => number = () => performance.now(),
  ) {
    this.options = options;
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = mulberry32(seed);
    this.state = this.newCampaign(seed);
    this.setCrowd(options.crowd);
  }

  private newCampaign(seed: number): MatchState {
    const config = this.options.config ?? { ...DEFAULT_GAME_CONFIG, version: 'solo' };
    return createMatchState(`solo-${seed}`, config, seed);
  }

  /** Change how many simulated visitors play along (0 = only you). */
  setCrowd(n: number): void {
    const count = Math.max(0, Math.min(10, Math.floor(n)));
    this.bots = Array.from({ length: count }, (_, i) => ({
      id: `bot-${i}`,
      nickname: `BOT ${BOT_NAMES[i % BOT_NAMES.length]}`,
      gapMs: 2500 + this.rng() * 4000,
      next: 0,
    }));
    this.notify();
  }

  get crowd(): number {
    return this.bots.length;
  }

  // ---- subscriptions --------------------------------------------------------

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  onEvent(l: (e: GameEvent) => void): () => void {
    this.eventListeners.add(l);
    return () => {
      this.eventListeners.delete(l);
    };
  }
  onCheer(l: (c: CheerPush) => void): () => void {
    this.cheerListeners.add(l);
    return () => {
      this.cheerListeners.delete(l);
    };
  }
  private notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  // ---- clock ----------------------------------------------------------------

  /** Pause-corrected match clock (ms). Only used for event timestamps: nothing here is timed. */
  nowT(): number {
    return this.runningSince === null ? this.baseClock : this.baseClock + (this.now() - this.runningSince);
  }

  private syncClock(): void {
    const running = isClockRunning(this.state.status);
    if (running && this.runningSince === null) {
      this.baseClock = this.state.clockMs;
      this.runningSince = this.now();
    } else if (!running && this.runningSince !== null) {
      this.baseClock = this.state.clockMs;
      this.runningSince = null;
    }
  }

  private dispatch(cmd: EngineCommand) {
    const r = reduce(this.state, cmd);
    this.state = r.state;
    this.syncClock();
    if (r.events.length) {
      for (const e of r.events) for (const l of this.eventListeners) l(e);
      this.notify();
    }
    return r;
  }

  // ---- lifecycle ------------------------------------------------------------

  start(): void {
    this.dispatch({ type: 'START', t: this.nowT() });
  }

  /** Let simulated visitors move and roll into the next campaign. Call ~10×/s. */
  tick(): void {
    const s = this.state;
    const now = this.now();
    if (s.status === 'FINISHED') {
      this.finishedAt ??= now;
      if (now - this.finishedAt >= s.config.nextCampaignDelayMs) this.nextCampaign();
      return;
    }
    if (s.status !== 'LIVE') {
      for (const b of this.bots) b.next = 0;
      return;
    }
    for (const b of this.bots) {
      if (b.next === 0) b.next = now + 800 + this.rng() * b.gapMs;
      if (now < b.next) continue;
      b.next = now + Math.max(900, -Math.log(1 - this.rng()) * b.gapMs);
      if (this.state.status !== 'LIVE') break;
      this.dispatch({ type: 'ACT', t: this.nowT(), participantId: b.id, nickname: b.nickname, action: 'AUTO' });
      // Now and then a bot cheers too, so the free button is visibly a thing.
      if (this.rng() < 0.03) this.emitCheer(b.nickname, CHEERS[Math.floor(this.rng() * CHEERS.length)]!);
    }
  }

  private nextCampaign(): void {
    this.finishedAt = null;
    this.campaigns++;
    this.baseClock = 0;
    this.runningSince = null;
    this.state = this.newCampaign(Math.floor(this.rng() * 2 ** 31));
    this.notify();
    this.start();
  }

  // ---- player ----------------------------------------------------------------

  /** One move. Same rules as the server: no credit, no move; a refused move is free. */
  act(action: PlayerAction, regionId?: RegionId, enemyId?: number): ActOutcome {
    const cfg = this.state.config;
    if (this.creditSats < cfg.actionCostSats) return { ok: false, reason: 'NO_CREDIT' };
    const now = this.now();
    if (now - this.lastActAt < cfg.actionCooldownMs) return { ok: false, reason: 'TOO_FAST' };
    this.lastActAt = now;
    const r = this.dispatch({ type: 'ACT', t: this.nowT(), participantId: PLAYER_ID, nickname: this.options.nickname, action, regionId, enemyId });
    if (r.outcome.kind !== 'action') throw new Error('unexpected outcome');
    const result = r.outcome.result;
    if (!result.ok) return { ok: false, reason: 'REFUSED', result };
    this.creditSats -= cfg.actionCostSats;
    this.myActions++;
    this.myKills += result.kills;
    if (this.state.status === 'FINISHED') this.bestWave = Math.max(this.bestWave, this.state.wave);
    this.notify();
    return { ok: true, result, creditSats: this.creditSats };
  }

  /** Demo top-up: in the venue this is a Lightning invoice paid from a wallet. */
  topup(amountSats: number): void {
    this.creditSats += amountSats;
    this.notify();
  }

  cheer(emoji: string): void {
    this.emitCheer(this.options.nickname, emoji);
  }

  private emitCheer(nickname: string, emoji: string): void {
    for (const l of this.cheerListeners) l({ nickname, emoji });
  }

  pause(): void {
    this.dispatch({ type: 'PAUSE', t: this.nowT(), reason: 'PLAYER' });
  }

  resume(): void {
    this.dispatch({ type: 'RESUME', t: this.nowT() });
  }
}
