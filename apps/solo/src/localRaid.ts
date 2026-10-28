import type { CheerPush, GameConfig, GameEvent, PublicRaidSnapshot, RaidState, RobotId, Role, SubmitResponse, TaskInput, TaskResponse } from '@sats-wars/shared';
import { CHEER_EMOJIS, DEFAULT_GAME_CONFIG, isClockRunning } from '@sats-wars/shared';
import { type EngineCommand, type Rng, type TaskChoice, createRaidState, mulberry32, reduce, snapshotCore, solveTask } from '@sats-wars/game-engine';
import { ClientError, type RaidClient } from '@sats-wars/ui';

export interface SoloOptions {
  callsign: string;
  /** Simulated crewmates (demo bots); 0 = you plus the assist AI. */
  crew: number;
  /** Probability the bots play a minigame cleanly. */
  botSkill: number;
  /**
   * Engine clock multiplier. Tests use it to run raids fast; the UI keeps 1
   * because minigames are played (and scored) in real milliseconds.
   */
  speed: number;
  seed?: number;
  config?: GameConfig;
}

interface Bot {
  id: string;
  callsign: string;
  role: Role;
  nextAt: number;
  pending: { taskId: string; input: TaskInput } | null;
}

const BOT_NAMES = ['雷丸', 'イナズマ', '疾風', 'ツムジ', 'Volt', 'Gale', '太鼓番', '風袋番', 'Spark', 'Zephyr', '稲光', '颯'];
const ROLE_CYCLE: Role[] = ['GUARDIAN', 'ROUTER', 'GUNNER', 'ENGINEER', 'GUARDIAN', 'GUNNER', 'ROUTER', 'GUNNER', 'GUARDIAN', 'ENGINEER', 'GUNNER', 'ROUTER'];
export const PLAYER_ID = 'you';
const LOBBY_MS = 15_000;
const RESULTS_MS = 30_000;

/**
 * Stand-in for the venue server inside one page: the same engine reducer, a
 * pause-aware clock, demo crewmates using the same solver as the server bots,
 * and the same RaidClient interface the phone cockpit uses. Nothing leaves the
 * page and no payment exists.
 */
export class LocalRaid implements RaidClient {
  state: RaidState;
  readonly options: SoloOptions;
  raids = 1;
  version = 0;
  private bots: Bot[] = [];
  private rng: Rng;
  private origin: number;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private lobbyEndsAt = 0;
  private endedAt: number | null = null;
  private snap: PublicRaidSnapshot | null = null;
  private recent: GameEvent[] = [];
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
    this.origin = now();
    this.state = this.newRaid(seed);
    this.setCrew(options.crew);
  }

  /** Engine clock (ms): real time × speed, frozen while paused. */
  clock(): number {
    const t = (this.pausedAt ?? this.now()) - this.origin - this.pausedTotal;
    return Math.max(0, Math.round(t * this.options.speed));
  }

  private newRaid(seed: number): RaidState {
    const config = this.options.config ?? { ...DEFAULT_GAME_CONFIG, version: 'solo' };
    let s = createRaidState(`solo-${seed}`, config, seed);
    s = reduce(s, { type: 'OPEN_LOBBY', t: this.clock() }).state;
    this.lobbyEndsAt = this.clock() + LOBBY_MS;
    this.endedAt = null;
    this.recent = [];
    this.snap = null;
    return s;
  }

  setCrew(n: number): void {
    const count = Math.max(0, Math.min(12, Math.floor(n)));
    this.bots = Array.from({ length: count }, (_, i) => ({
      id: `bot-${i}`,
      callsign: `BOT ${BOT_NAMES[i % BOT_NAMES.length]}`,
      role: ROLE_CYCLE[i % ROLE_CYCLE.length]!,
      nextAt: 0,
      pending: null,
    }));
  }

  private dispatch(cmd: EngineCommand) {
    const r = reduce(this.state, cmd);
    // Ticks clone the state every time; only events or command outcomes change what is shown.
    const changed = r.events.length > 0 || r.outcome.kind !== 'none';
    this.state = r.state;
    for (const e of r.events) {
      this.recent.push(e);
      if (this.recent.length > 30) this.recent.shift();
      this.eventListeners.forEach((l) => l(e));
    }
    if (changed) this.invalidate();
    return r;
  }

  private invalidate(): void {
    this.snap = null;
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Advance the raid: call every ~100 ms. */
  step(): void {
    if (this.pausedAt !== null) return;
    const t = this.clock();
    const s = this.state;
    if (s.status === 'LOBBY_OPEN') {
      this.boardBots(t);
      if (t >= this.lobbyEndsAt) this.dispatch({ type: 'START', t });
      return;
    }
    if (s.status === 'ENDED' || s.status === 'CANCELLED') {
      this.endedAt ??= t;
      if (t - this.endedAt >= RESULTS_MS * Math.min(1, this.options.speed)) this.nextRaid();
      return;
    }
    if (s.status !== 'LIVE') return;
    const before = this.state.gameMs;
    this.dispatch({ type: 'TICK', t });
    this.botsAct(t);
    if (this.state.gameMs !== before) {
      // Clock moves every tick; tell the UI without forcing a new snapshot object.
      this.listeners.forEach((l) => l());
    }
  }

  private boardBots(t: number): void {
    for (const b of this.bots) {
      if (this.state.pilots[b.id]) continue;
      this.dispatch({ type: 'BOARD', t, pilotId: b.id, callsign: b.callsign, role: b.role, isBot: true });
    }
  }

  private botsAct(t: number): void {
    const s = this.state;
    for (const b of this.bots) {
      if (!s.pilots[b.id]) continue;
      if (b.nextAt === 0) b.nextAt = t + 1000 + this.rng() * 4000;
      if (t < b.nextAt) continue;
      if (b.pending) {
        this.dispatch({ type: 'SUBMIT_TASK', t, pilotId: b.id, taskId: b.pending.taskId, input: b.pending.input });
        b.pending = null;
        b.nextAt = t + s.config.normalActionCooldownSeconds * 1000 + 1000 + this.rng() * 3000;
        if (this.rng() < 0.05) this.cheer(b.callsign);
        continue;
      }
      const r = this.dispatch({ type: 'REQUEST_TASK', t, pilotId: b.id });
      if (r.outcome.kind === 'task' && r.outcome.task) {
        const task = r.outcome.task;
        const input = solveTask(task.params, this.options.botSkill, this.rng, 900, task.target.kind === 'ENERGY' ? task.target.sink : undefined);
        b.pending = { taskId: task.taskId, input };
        const playMs = 'stopAtMs' in input ? input.stopAtMs : 'releaseAtMs' in input ? input.releaseAtMs : 2500 + this.rng() * 2500;
        b.nextAt = t + playMs + 150;
      } else {
        b.nextAt = t + 2500 + this.rng() * 2000;
      }
    }
  }

  private cheer(callsign: string): void {
    const emoji = CHEER_EMOJIS[Math.floor(this.rng() * CHEER_EMOJIS.length)]!;
    this.cheerListeners.forEach((l) => l({ callsign, emoji }));
  }

  cheerAsPlayer(emoji: (typeof CHEER_EMOJIS)[number]): void {
    this.cheerListeners.forEach((l) => l({ callsign: this.options.callsign, emoji }));
  }

  nextRaid(): void {
    this.raids++;
    this.state = this.newRaid(Math.floor(this.rng() * 2 ** 31));
    for (const b of this.bots) {
      b.nextAt = 0;
      b.pending = null;
    }
    this.invalidate();
  }

  /** Skip the lobby countdown. */
  launchNow(): void {
    if (this.state.status === 'LOBBY_OPEN') this.lobbyEndsAt = this.clock();
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }
  setPaused(p: boolean): void {
    if (p && this.pausedAt === null) {
      this.pausedAt = this.now();
      if (this.state.status === 'LIVE') this.dispatch({ type: 'PAUSE', t: this.clock(), reason: 'SOLO' });
    } else if (!p && this.pausedAt !== null) {
      this.pausedTotal += this.now() - this.pausedAt;
      this.pausedAt = null;
      if (this.state.status === 'PAUSED') this.dispatch({ type: 'RESUME', t: this.clock() });
    }
    this.invalidate();
  }

  // ---- RaidClient (the phone cockpit talks to this) -------------------------

  async board(role: Role, robot?: RobotId): Promise<void> {
    const r = this.dispatch({ type: 'BOARD', t: this.clock(), pilotId: PLAYER_ID, callsign: this.options.callsign, role, ...(robot ? { robot } : {}) });
    if (r.outcome.kind === 'board' && r.outcome.code !== 'OK' && r.outcome.code !== 'ALREADY_BOARDED') throw new ClientError(r.outcome.code, boardMessage(r.outcome.code));
  }

  async changeRole(role: Role, robot?: RobotId): Promise<void> {
    if (!this.state.pilots[PLAYER_ID]) return this.board(role, robot);
    const r = this.dispatch({ type: 'CHANGE_ROLE', t: this.clock(), pilotId: PLAYER_ID, role, ...(robot ? { robot } : {}) });
    if (r.outcome.kind === 'role' && r.outcome.code !== 'OK') throw new ClientError(r.outcome.code, r.outcome.code === 'ROLE_COOLDOWN' ? '席の変更は少し待ってから' : '席を変えられませんでした');
  }

  async requestTask(choice: TaskChoice): Promise<TaskResponse> {
    const r = this.dispatch({ type: 'REQUEST_TASK', t: this.clock(), pilotId: PLAYER_ID, choice });
    if (r.outcome.kind !== 'task') return { code: 'NOT_LIVE', task: null, cooldownUntil: 0, gameMs: this.state.gameMs };
    return { code: r.outcome.code, task: r.outcome.task, cooldownUntil: r.outcome.cooldownUntil, gameMs: this.state.gameMs };
  }

  async submitTask(taskId: string, input: TaskInput): Promise<SubmitResponse> {
    const r = this.dispatch({ type: 'SUBMIT_TASK', t: this.clock(), pilotId: PLAYER_ID, taskId, input });
    if (r.outcome.kind !== 'submit') throw new ClientError('NOT_LIVE', '作戦が始まっていません');
    return { result: r.outcome.result, duplicate: false };
  }

  gameNow = (): number => {
    const s = this.state;
    if (!isClockRunning(s.status) || s.liveStartClock === null) return s.gameMs;
    // Between ticks: extrapolate from the last engine time.
    return s.gameMs + Math.max(0, this.clock() - s.clockMs);
  };

  // ---- views -----------------------------------------------------------------

  /** The same snapshot shape the server sends (with demo-mode server fields). */
  snapshot(): PublicRaidSnapshot {
    if (this.snap) return this.snap;
    const core = snapshotCore(this.state, this.recent, Date.now());
    this.snap = {
      ...core,
      lobbyEndsAt: this.state.status === 'LOBBY_OPEN' ? Date.now() + Math.max(0, (this.lobbyEndsAt - this.clock()) / this.options.speed) : null,
      joinOpen: this.state.status === 'LOBBY_OPEN' || (this.state.status === 'LIVE' && this.state.gameMs < this.state.config.cutoffForPaidJoinAtSeconds * 1000),
      passMode: 'FREE',
      ticketPriceSats: this.state.config.ticketPriceSats,
      paymentsEnabled: false,
      paymentMode: 'mock',
      playUrl: '',
      eventId: 'solo',
      broadcast: null,
      namesHidden: false,
      demoMode: true,
      bestScore: null,
    };
    return this.snap;
  }

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
}

function boardMessage(code: string): string {
  switch (code) {
    case 'JOIN_CLOSED':
      return '今回の出撃受付は終了しました。次の作戦を待ってね';
    case 'RAID_FULL':
      return '満席です';
    default:
      return '搭乗できませんでした';
  }
}
