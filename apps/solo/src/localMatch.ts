import type {
  ActionResult,
  ActionType,
  GameConfig,
  GameEvent,
  MatchState,
  RegionId,
  TeamId,
} from '@sats-wars/shared';
import { DEFAULT_GAME_CONFIG, isClockRunning } from '@sats-wars/shared';
import {
  type EngineCommand,
  type Rng,
  type StrategyName,
  chooseAction,
  createMatchState,
  mulberry32,
  reduce,
} from '@sats-wars/game-engine';

export interface SoloOptions {
  nickname: string;
  team: TeamId | 'AUTO';
  /** Participants per team including the player (bots fill the rest). */
  teamSize: number;
  /** AP for the player. 3 = official rule; more is a demo convenience. */
  playerAp: number;
  /** Game-clock speed multiplier (2 = a 5-minute match in 2.5 minutes). */
  speed: number;
  seed?: number;
  config?: GameConfig;
}

interface Bot {
  id: string;
  teamId: TeamId;
  strategy: StrategyName;
  /** Game ms at which each remaining AP is spent. */
  schedule: number[];
}

const BOT_NAMES: Record<TeamId, string[]> = {
  RAIJIN: [
    '雷丸',
    'イナズマ',
    'ゴロゴロ',
    'Volt',
    'Bolt',
    '太鼓番',
    'Spark',
    '稲光',
    '鳴神',
    'Amp',
  ],
  FUJIN: [
    '疾風',
    'ツムジ',
    'そよ風',
    'Gale',
    'Breeze',
    '風袋番',
    'Zephyr',
    '旋風',
    '颯',
    'Mistral',
  ],
};

export const PLAYER_ID = 'you';

/**
 * Stand-in for the game server inside the browser: the same deterministic
 * engine reducer, a pause-aware clock, and the same bot strategies the server
 * uses for demo bots. Nothing leaves the page and no payment exists.
 */
export class LocalMatch {
  state: MatchState;
  readonly playerTeam: TeamId;
  readonly options: SoloOptions;
  version = 0;
  private bots: Bot[] = [];
  private rng: Rng;
  private baseClock = 0;
  private runningSince: number | null = null;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: GameEvent) => void>();
  private actionSeq = 0;
  private lastWave = 0;
  private waveIndex = 0;

  constructor(
    options: SoloOptions,
    private now: () => number = () => performance.now(),
  ) {
    this.options = options;
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = mulberry32(seed);
    const config = options.config ?? { ...DEFAULT_GAME_CONFIG, lobbyMs: 6_000, version: 'solo' };
    this.state = createMatchState(`solo-${seed}`, config, seed);
    this.playerTeam =
      options.team === 'AUTO' ? (this.rng() < 0.5 ? 'RAIJIN' : 'FUJIN') : options.team;
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

  // ---- clock ----------------------------------------------------------------

  /** Pause-corrected, speed-scaled match clock. */
  nowT(): number {
    return this.runningSince === null
      ? this.baseClock
      : this.baseClock + (this.now() - this.runningSince) * this.options.speed;
  }

  /** Current game ms for countdowns (between ticks). */
  gameMs(): number {
    const s = this.state;
    if (!isClockRunning(s.status) || s.liveStartClock === null) return s.gameMs;
    return this.nowT() - s.liveStartClock;
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
      this.version++;
      for (const e of r.events) for (const l of this.eventListeners) l(e);
      for (const l of this.listeners) l();
    }
    return r;
  }

  // ---- lifecycle ------------------------------------------------------------

  start(): void {
    this.dispatch({ type: 'OPEN_LOBBY', t: 0 });
    this.dispatch({
      type: 'ADD_PARTICIPANT',
      t: 0,
      participantId: PLAYER_ID,
      teamId: this.playerTeam,
      nickname: this.options.nickname,
      isBot: false,
      ap: this.options.playerAp,
    });
    // Equal headcount: the player's team gets one bot fewer.
    for (const teamId of ['RAIJIN', 'FUJIN'] as TeamId[]) {
      const n = this.options.teamSize - (teamId === this.playerTeam ? 1 : 0);
      for (let i = 0; i < n; i++) this.addBot(teamId, 0);
    }
  }

  private addBot(teamId: TeamId, t: number): void {
    const cfg = this.state.config;
    const idx = this.bots.filter((b) => b.teamId === teamId).length;
    const names = BOT_NAMES[teamId];
    const id = `bot-${teamId}-${idx}`;
    const nickname = `BOT ${names[idx % names.length]}${idx >= names.length ? Math.floor(idx / names.length) + 1 : ''}`;
    this.dispatch({
      type: 'ADD_PARTICIPANT',
      t,
      participantId: id,
      teamId,
      nickname,
      isBot: true,
      ap: cfg.apPerParticipant,
    });
    const from = Math.max(2_000, this.state.gameMs + 1_000);
    const to = cfg.actionCloseMs - 2_000;
    const schedule = Array.from(
      { length: cfg.apPerParticipant },
      () => from + this.rng() * Math.max(1, to - from),
    ).sort((a, b) => a - b);
    const strategy: StrategyName = this.rng() < 0.6 ? 'adaptive' : 'balanced';
    this.bots.push({ id, teamId, strategy, schedule });
  }

  /** Advance timers and let bots act. Call ~10×/s. */
  tick(): void {
    this.dispatch({ type: 'TICK', t: this.nowT() });
    const s = this.state;
    if (s.status !== 'LIVE') return;
    // A couple of late joiners keep the field lively, like the venue demo bots.
    if (
      s.gameMs - this.lastWave >= 40_000 &&
      s.gameMs < s.config.joinCloseMs &&
      this.waveIndex < 3
    ) {
      this.lastWave = s.gameMs;
      this.waveIndex++;
      this.addBot('RAIJIN', this.nowT());
      this.addBot('FUJIN', this.nowT());
    }
    for (const bot of this.bots) {
      while (
        bot.schedule.length &&
        bot.schedule[0]! <= this.state.gameMs &&
        this.state.status === 'LIVE'
      ) {
        bot.schedule.shift();
        const plan = chooseAction(this.state, bot.teamId, bot.strategy, this.rng);
        if (!plan) continue;
        this.dispatch({
          type: 'ACTION',
          t: this.nowT(),
          participantId: bot.id,
          clientActionId: `b${++this.actionSeq}`,
          actionType: plan.actionType,
          regionId: plan.regionId,
        });
      }
    }
  }

  /** The player's action. Validated by the engine exactly like on the server. */
  act(actionType: ActionType, regionId: RegionId | null): ActionResult {
    const r = this.dispatch({
      type: 'ACTION',
      t: this.nowT(),
      participantId: PLAYER_ID,
      clientActionId: `p${++this.actionSeq}`,
      actionType,
      regionId: actionType === 'CHARGE' ? null : regionId,
    });
    if (r.outcome.kind !== 'action') throw new Error('unexpected outcome');
    // Rejected actions emit no events; still notify so the UI shows the result.
    this.version++;
    for (const l of this.listeners) l();
    return r.outcome.result;
  }

  startNow(): void {
    if (this.state.status === 'LOBBY') this.dispatch({ type: 'START_LIVE', t: this.nowT() });
  }

  pause(): void {
    this.dispatch({ type: 'PAUSE', t: this.nowT(), reason: 'PLAYER' });
  }

  resume(): void {
    this.dispatch({ type: 'RESUME', t: this.nowT() });
  }

  get player() {
    return this.state.participants[PLAYER_ID]!;
  }
}
