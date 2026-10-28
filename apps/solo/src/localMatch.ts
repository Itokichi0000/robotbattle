import type { CheerPush, GameConfig, GameEvent, MatchState, TeamId, ZapResult } from '@sats-wars/shared';
import { DEFAULT_GAME_CONFIG, TEAM_IDS, isClockRunning } from '@sats-wars/shared';
import { type EngineCommand, type Rng, carryOverHp, createMatchState, mulberry32, reduce } from '@sats-wars/game-engine';

export interface SoloOptions {
  nickname: string;
  team: TeamId;
  /** Simulated people tapping per team (bots), not counting you. */
  crowd: number;
  seed?: number;
  config?: GameConfig;
}

interface Bot {
  id: string;
  teamId: TeamId;
  nickname: string;
  /** Mean ms between taps; varies per bot so the crowd feels bursty. */
  gapMs: number;
  next: number;
}

const BOT_NAMES: Record<TeamId, string[]> = {
  RAIJIN: ['雷丸', 'イナズマ', 'ゴロゴロ', 'Volt', 'Bolt', '太鼓番', 'Spark', '稲光', '鳴神', 'Amp'],
  FUJIN: ['疾風', 'ツムジ', 'そよ風', 'Gale', 'Breeze', '風袋番', 'Zephyr', '旋風', '颯', 'Mistral'],
};

const CHEERS = ['📣', '🔥', '⚡', '🌀', '👏', '💪'] as const;

export const PLAYER_ID = 'you';
/** Demo credit handed out at the start, like sats handed out at the venue. */
export const STARTING_CREDIT = 210;

export type PunchOutcome = { ok: true; result: ZapResult; creditSats: number } | { ok: false; reason: 'NO_CREDIT' | 'TOO_FAST' | 'NOT_FIGHTING'; result?: ZapResult };

/**
 * Stand-in for the venue server inside one browser page: the same engine
 * reducer, a pause-aware clock, bots tapping for both teams, and a local
 * (pretend) sats balance. Nothing leaves the page and no payment exists.
 */
export class LocalMatch {
  state: MatchState;
  readonly options: SoloOptions;
  team: TeamId;
  creditSats = STARTING_CREDIT;
  myPunches = 0;
  myKos = 0;
  seasons = 1;
  version = 0;
  private bots: Bot[] = [];
  private rng: Rng;
  private baseClock = 0;
  private runningSince: number | null = null;
  private finishedAt: number | null = null;
  private lastPunchAt = -1e9;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: GameEvent) => void>();
  private cheerListeners = new Set<(c: CheerPush) => void>();

  constructor(
    options: SoloOptions,
    private now: () => number = () => performance.now(),
  ) {
    this.options = options;
    this.team = options.team;
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = mulberry32(seed);
    this.state = this.newSeason(seed);
    // Mirror-symmetric crowd so the bots never tilt the battle; you are the difference.
    const gaps = Array.from({ length: options.crowd }, () => 1200 + this.rng() * 2800);
    for (const teamId of TEAM_IDS) {
      for (let i = 0; i < options.crowd; i++) {
        const names = BOT_NAMES[teamId];
        this.bots.push({
          id: `bot-${teamId}-${i}`,
          teamId,
          nickname: `BOT ${names[i % names.length]}${i >= names.length ? Math.floor(i / names.length) + 1 : ''}`,
          gapMs: gaps[i]!,
          next: 0,
        });
      }
    }
  }

  private newSeason(seed: number, prev?: MatchState): MatchState {
    const base = this.options.config ?? { ...DEFAULT_GAME_CONFIG, version: 'solo', openingMs: 4_000 };
    // Same carry-over as the venue server: keep round-1 HP in line with the crowd.
    const config = prev ? { ...base, hpInitial: carryOverHp(base, prev.rounds[prev.rounds.length - 1]) } : base;
    return createMatchState(`solo-${seed}`, config, seed);
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

  /** Pause-corrected match clock (ms). */
  nowT(): number {
    return this.runningSince === null ? this.baseClock : this.baseClock + (this.now() - this.runningSince);
  }

  /** Seconds left in the current phase. */
  secondsLeft(): number | null {
    const s = this.state;
    if (!isClockRunning(s.status) || s.phaseEndsAt === null) return null;
    return Math.max(0, Math.ceil((s.phaseEndsAt - this.nowT()) / 1000));
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

  /** Advance timers, let bots tap, roll into the next season. Call ~10×/s. */
  tick(): void {
    this.dispatch({ type: 'TICK', t: this.nowT() });
    const s = this.state;
    if (s.status === 'FINISHED') {
      const now = this.now();
      this.finishedAt ??= now;
      if (now - this.finishedAt >= s.config.nextSeasonDelayMs) this.nextSeason();
      return;
    }
    if (s.status !== 'LIVE' || s.phase !== 'ROUND') {
      for (const b of this.bots) b.next = 0;
      return;
    }
    const now = this.now();
    for (const b of this.bots) {
      if (b.next === 0) b.next = now + 400 + this.rng() * b.gapMs;
      if (now < b.next) continue;
      b.next = now + Math.max(260, -Math.log(1 - this.rng()) * b.gapMs);
      if (this.state.phase !== 'ROUND') break;
      this.dispatch({ type: 'ZAP', t: this.nowT(), participantId: b.id, nickname: b.nickname, teamId: b.teamId });
      // Now and then a bot cheers too, so the free button is visibly a thing.
      if (this.rng() < 0.02) this.emitCheer(b.teamId, b.nickname, CHEERS[Math.floor(this.rng() * CHEERS.length)]!);
    }
  }

  private nextSeason(): void {
    this.finishedAt = null;
    this.seasons++;
    this.baseClock = 0;
    this.runningSince = null;
    this.state = this.newSeason(Math.floor(this.rng() * 2 ** 31), this.state);
    this.notify();
    this.start();
  }

  // ---- player ----------------------------------------------------------------

  /** One tap. Same rules as the server: no credit, no punch; between rounds it's free. */
  punch(): PunchOutcome {
    const cfg = this.state.config;
    if (this.creditSats < cfg.zapCostSats) return { ok: false, reason: 'NO_CREDIT' };
    const now = this.now();
    if (now - this.lastPunchAt < cfg.zapCooldownMs) return { ok: false, reason: 'TOO_FAST' };
    this.lastPunchAt = now;
    const r = this.dispatch({ type: 'ZAP', t: this.nowT(), participantId: PLAYER_ID, nickname: this.options.nickname, teamId: this.team });
    if (r.outcome.kind !== 'zap') throw new Error('unexpected outcome');
    const result = r.outcome.result;
    if (!result.ok) return { ok: false, reason: 'NOT_FIGHTING', result };
    this.creditSats -= cfg.zapCostSats;
    this.myPunches++;
    if (result.code === 'KO') this.myKos++;
    this.notify();
    return { ok: true, result, creditSats: this.creditSats };
  }

  /** Demo top-up: in the venue this is a Lightning invoice paid from a wallet. */
  topup(amountSats: number): void {
    this.creditSats += amountSats;
    this.notify();
  }

  switchTeam(): void {
    this.team = this.team === 'RAIJIN' ? 'FUJIN' : 'RAIJIN';
    this.notify();
  }

  cheer(emoji: string): void {
    this.emitCheer(this.team, this.options.nickname, emoji);
  }

  private emitCheer(teamId: TeamId, nickname: string, emoji: string): void {
    for (const l of this.cheerListeners) l({ teamId, nickname, emoji });
  }

  pause(): void {
    this.dispatch({ type: 'PAUSE', t: this.nowT(), reason: 'PLAYER' });
  }

  resume(): void {
    this.dispatch({ type: 'RESUME', t: this.nowT() });
  }
}
