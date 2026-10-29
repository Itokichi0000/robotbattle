import type {
  GameConfig,
  GameEvent,
  RaidState,
  Role,
  TaskInput,
  Weakpoint,
} from '@sats-wars/shared';
import { makeGameConfig } from '@sats-wars/shared';
import {
  type CommandOutcome,
  createRaidState,
  type EngineCommand,
  reduce,
  type TaskChoice,
} from './engine';
import { mulberry32 } from './random';
import { solveTask } from './tasks';

/**
 * Demo seed `earth-defense-opening` (spec I1): a scripted showcase raid that
 * any rehearsal can replay. The engine stays the same: the script only fixes
 * the seed, the enemy schedule, which cities the first attacks aim at
 * (`scriptedTargets`) and what four labelled demo bots do at set times. A
 * person can board as a fifth pilot and play normally.
 *
 * Routes: `success` plays the finale (three seats join 神雷風陣); `failure`
 * leaves the special's missions untouched from the moment the window opens,
 * so SYNC and the reserve are not enough and the defence fails. Both are
 * reproducible: the same seed and route give the same raid headless.
 */
export type ScenarioRoute = 'success' | 'failure';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Commands a scenario bot sends; the caller stamps the clock (`t`). */
export type DriverCommand = DistributiveOmit<
  Extract<EngineCommand, { type: 'BOARD' | 'REQUEST_TASK' | 'SUBMIT_TASK' }>,
  't'
>;

export interface ScenarioBeat {
  atSeconds: number;
  /** Index into `bots`. */
  bot: number;
  /** Mission asked for. `escort` = the newest live escort (not the boss), at this weak point. */
  choice: TaskChoice & { escort?: Weakpoint };
  /** Played cleanly (true) or fumbled on purpose. */
  success: boolean;
  /** Part of the finale: the failure route leaves these missions untouched. */
  finale?: boolean;
  noteJa: string;
  noteEn: string;
}

export interface Scenario {
  id: string;
  titleJa: string;
  titleEn: string;
  seed: number;
  config: Partial<GameConfig>;
  bots: Array<{ callsign: string; role: Role }>;
  beats: ScenarioBeat[];
  /** Chance of a clean run for the bots' unscripted play between beats. */
  skill: number;
  /** Failure route: from this game second on the bots leave every mission untouched. */
  failureIdleFromSeconds: number;
}

export const EARTH_DEFENSE_OPENING: Scenario = {
  id: 'earth-defense-opening',
  titleJa: '地球防衛作戦・開幕デモ',
  titleEn: 'Earth Defense — opening demo',
  seed: 20_251_021,
  skill: 0.92,
  // 5:00: long enough before the window that SYNC drains below the fallback line.
  failureIdleFromSeconds: 300,
  config: {
    // FINAL_WAVE with the special's window: the core barrier holds until 6:50,
    // so 神雷風陣 (not a lucky shot) brings NULL CORE down.
    phaseStartsSeconds: { WAVE_1: 20, WAVE_2: 140, WAVE_3: 280, FINAL_WAVE: 410 },
    spawns: [
      { atSeconds: 5, kind: 'SCOUT' }, // training target (always Tokyo, softened)
      { atSeconds: 28, kind: 'SCOUT' }, // 0:30 warning on Sapporo
      { atSeconds: 70, kind: 'SCOUT' }, // 1:20 the gunner hits its arm
      { atSeconds: 146, kind: 'SCOUT' }, // 2:30 Tokyo …
      { atSeconds: 146, kind: 'SCOUT' }, // … and Osaka at once
      { atSeconds: 205, kind: 'SIEGE' }, // bombardment wears Fujin before the repair
      { atSeconds: 280, kind: 'BOSS' }, // 4:40 NULL CORE
      { atSeconds: 320, kind: 'SCOUT' },
      { atSeconds: 360, kind: 'SIEGE' },
    ],
    scriptedTargets: [
      { atSeconds: 20, targets: ['hokkaido'] },
      { atSeconds: 60, targets: ['tohoku'] },
      { atSeconds: 140, targets: ['kanto'] },
      { atSeconds: 140, targets: ['kinki'] },
      { atSeconds: 200, targets: ['chubu'] },
    ],
    // 6:50: the 30-second chance for 神雷風陣.
    special: {
      availableAfterSeconds: 410,
      activationWindowSeconds: 30,
      requiredDistinctPilots: 3,
      syncMinimum: 75,
      energyMinimum: 80,
      damage: 250,
      fallbackDamage: 90,
      fallbackSyncMinimum: 50,
      failBeamDamage: 25,
    },
    boss: {
      damage: 32,
      telegraphMs: [12000, 15000],
      recoveryMs: [3000, 5000],
      sweepBelowHpRatio: 0.6,
      sweepDamage: 14,
      finalArmorFactor: 0.6,
      barrierFloorRatio: 0.3,
    },
    // Escorts take two gunner hits, so an arm shot weakens instead of killing.
    escortMinHits: 2,
    // Fujin shields where a warning is shown (no blanket standby barriers), so
    // the undefended city of a double attack really takes the hit.
    guardian: { shield: 45, standbyRatio: 0, shieldFade: 8 },
    // SYNC needs steady teamwork: an idle crew drains it below 50 before 7:00.
    sync: {
      windowSeconds: 20,
      gainTwoRoles: 8,
      gainThreeRoles: 7,
      gainFourRoles: 10,
      decayEverySeconds: 10,
      decayAmount: 5,
      max: 100,
    },
    // The script plays the seats; no assist AI and no adaptive tuning, so the
    // run is the same every time.
    assistBelowPilots: 0,
    adaptive: { windowSeconds: 60, targetSuccess: 0.65, gain: 0, maxAdjust: 0 },
    lobbySeconds: 20,
  },
  bots: [
    { callsign: 'BOT 雷丸', role: 'GUNNER' },
    { callsign: 'BOT 疾風', role: 'GUARDIAN' },
    { callsign: 'BOT イナズマ', role: 'ROUTER' },
    { callsign: 'BOT ツムジ', role: 'ENGINEER' },
  ],
  beats: [
    {
      atSeconds: 32,
      bot: 1,
      choice: { cityId: 'hokkaido' },
      success: true,
      noteJa: '札幌に予兆 → 防衛席が成功、風神がシールド',
      noteEn: 'Warning on Sapporo → guardian succeeds, Fujin shields it',
    },
    {
      atSeconds: 80,
      bot: 0,
      choice: { escort: 'ARM' },
      success: true,
      noteJa: '砲撃席が偵察機の腕に命中 → 雷神のパンチで攻撃弱体化',
      noteEn: 'Gunner hits the scout’s arm → Raijin’s punch weakens its attack',
    },
    {
      atSeconds: 151,
      bot: 1,
      choice: { cityId: 'kanto' },
      success: true,
      noteJa: '東京と大阪が同時に危機 → 東京だけ守れて大阪が被害',
      noteEn: 'Tokyo and Osaka at once → only Tokyo is shielded, Osaka is hit',
    },
    {
      atSeconds: 163,
      bot: 0,
      choice: {},
      success: true,
      noteJa: '砲撃席が残りの偵察機を撃つ',
      noteEn: 'Gunner shoots the remaining scout',
    },
    {
      atSeconds: 170,
      bot: 3,
      choice: { repair: { type: 'CITY', cityId: 'kinki' } },
      success: true,
      noteJa: '整備ミッション：大阪を修理',
      noteEn: 'Repair mission: Osaka',
    },
    {
      atSeconds: 200,
      bot: 2,
      choice: { sink: 'FUJIN' },
      success: true,
      noteJa: '電力接続席が経路をつなぐ → 青緑の光が地図を流れて送電',
      noteEn: 'Router connects the path → teal light flows over the map',
    },
    {
      atSeconds: 255,
      bot: 1,
      choice: {},
      success: true,
      noteJa: '防衛席が守りを固める',
      noteEn: 'Guardian reinforces the barrier',
    },
    {
      atSeconds: 260,
      bot: 3,
      choice: { repair: { type: 'ROBOT', robot: 'FUJIN' } },
      success: true,
      noteJa: '整備席が風神の風環を修復 → 防御が戻り SYNC 上昇',
      noteEn: 'Engineer repairs Fujin’s wind ring → defence back, SYNC rises',
    },
    {
      atSeconds: 413,
      bot: 0,
      choice: {},
      success: true,
      finale: true,
      noteJa: '神雷風陣：砲撃席が参加',
      noteEn: 'Final technique: gunner joins',
    },
    {
      atSeconds: 416,
      bot: 1,
      choice: {},
      success: true,
      finale: true,
      noteJa: '神雷風陣：防衛席が参加',
      noteEn: 'Final technique: guardian joins',
    },
    {
      atSeconds: 419,
      bot: 2,
      choice: { sink: 'RESERVE' },
      success: true,
      finale: true,
      noteJa: '神雷風陣：電力接続席が参加 → 発動',
      noteEn: 'Final technique: router joins → it fires',
    },
  ],
};

export const SCENARIOS: Record<string, Scenario> = {
  [EARTH_DEFENSE_OPENING.id]: EARTH_DEFENSE_OPENING,
};

export interface ScenarioLogEntry {
  atMs: number;
  bot: string;
  role: Role;
  beat: number | null;
  /** Mission code from the engine, or what the bot did. */
  what: string;
}

interface BotState {
  id: string;
  callsign: string;
  role: Role;
  nextAt: number;
  pending: { taskId: string; input: TaskInput; at: number; beat: number | null } | null;
}

/**
 * Plays a scenario's bots. Deterministic for a given (scenario, route): its
 * own RNG, the raid's game clock, and the engine's answers. Shared by the
 * server (live demo with people) and the headless CLI/tests.
 */
export class ScenarioDriver {
  private rng: () => number;
  private bots: BotState[];
  private done = new Set<number>();
  readonly log: ScenarioLogEntry[] = [];

  constructor(
    readonly scenario: Scenario,
    readonly route: ScenarioRoute,
    idPrefix = 'scn',
  ) {
    this.rng = mulberry32(scenario.seed ^ (route === 'failure' ? 0x5f3759df : 0));
    this.bots = scenario.bots.map((b, i) => ({
      id: `${idPrefix}-${i}`,
      callsign: b.callsign,
      role: b.role,
      nextAt: 0,
      pending: null,
    }));
  }

  get botIds(): string[] {
    return this.bots.map((b) => b.id);
  }

  /** Failure route: the bots stop playing well before the special's window. */
  private idleFrom(): number {
    return this.route === 'failure' ? this.scenario.failureIdleFromSeconds * 1000 : Infinity;
  }

  private beatsFor(bot: number): Array<[number, ScenarioBeat]> {
    return this.scenario.beats
      .map((b, i) => [i, b] as [number, ScenarioBeat])
      .filter(
        ([i, b]) => b.bot === bot && !this.done.has(i) && !(b.finale && this.route === 'failure'),
      );
  }

  /**
   * Run the bots up to game time `now`. `dispatch` sends a command to the
   * raid (stamping the clock) and returns the engine's outcome.
   */
  step(s: RaidState, now: number, dispatch: (cmd: DriverCommand) => CommandOutcome): void {
    const reserveMs =
      (s.config.normalActionCooldownSeconds + Math.min(8, s.config.miniGameDurationSeconds)) * 1000;
    this.bots.forEach((bot, index) => {
      if (!s.pilots[bot.id]) {
        if (s.status !== 'LOBBY_OPEN' && s.status !== 'LIVE') return;
        dispatch({
          type: 'BOARD',
          pilotId: bot.id,
          callsign: bot.callsign,
          role: bot.role,
          isBot: true,
        });
        return;
      }
      if (s.status !== 'LIVE') return;
      if (now >= this.idleFrom()) {
        bot.pending = null;
        return;
      }
      if (bot.nextAt === 0) bot.nextAt = 1500 + this.rng() * 3000;
      if (bot.pending) {
        if (now < bot.pending.at) return;
        dispatch({
          type: 'SUBMIT_TASK',
          pilotId: bot.id,
          taskId: bot.pending.taskId,
          input: bot.pending.input,
        });
        this.note(now, bot, bot.pending.beat, 'SUBMIT');
        bot.pending = null;
        bot.nextAt = now + s.config.normalActionCooldownSeconds * 1000 + 800 + this.rng() * 2000;
        return;
      }
      const [beatIndex, beat] = this.beatsFor(index)[0] ?? [null, null];
      const beatAt = beat ? beat.atSeconds * 1000 : Infinity;
      if (beat && now >= beatAt) {
        this.play(s, now, bot, beatIndex, beat, dispatch);
        return;
      }
      // Keep the seat free for the next scripted moment.
      if (now >= beatAt - reserveMs || now < bot.nextAt) return;
      this.play(s, now, bot, null, null, dispatch);
    });
  }

  private play(
    s: RaidState,
    now: number,
    bot: BotState,
    beatIndex: number | null,
    beat: ScenarioBeat | null,
    dispatch: (cmd: DriverCommand) => CommandOutcome,
  ): void {
    const choice: TaskChoice = { ...(beat?.choice ?? {}) };
    if (beat?.choice.escort) {
      const escort = [...s.enemies]
        .reverse()
        .find((e) => e.hp > 0 && e.kind !== 'BOSS' && !e.training);
      if (escort) {
        choice.enemyId = escort.id;
        choice.weakpoint = beat.choice.escort;
      }
      delete (choice as { escort?: Weakpoint }).escort;
    }
    const out = dispatch({ type: 'REQUEST_TASK', pilotId: bot.id, choice });
    if (out.kind !== 'task') return;
    if (out.code === 'OK' && out.task) {
      const task = out.task;
      const sink = task.target.kind === 'ENERGY' ? task.target.sink : undefined;
      const skill = beat ? (beat.success ? 1 : 0) : this.scenario.skill;
      const input = solveTask(task.params, skill, this.rng, 900, sink);
      const playMs =
        'stopAtMs' in input
          ? input.stopAtMs
          : 'releaseAtMs' in input
            ? input.releaseAtMs
            : 1800 + this.rng() * 1500;
      bot.pending = { taskId: task.taskId, input, at: now + playMs, beat: beatIndex };
      if (beatIndex !== null) this.done.add(beatIndex);
      this.note(now, bot, beatIndex, `REQUEST ${task.target.kind}`);
      return;
    }
    // A scripted moment waits for the cooldown (up to 8 s), then is dropped.
    if (beatIndex !== null && beat && now - beat.atSeconds * 1000 > 8000) {
      this.done.add(beatIndex);
      this.note(now, bot, beatIndex, `MISSED ${out.code}`);
    }
    bot.nextAt = now + (out.code === 'COOLDOWN' ? 700 : 2500);
  }

  private note(atMs: number, bot: BotState, beat: number | null, what: string): void {
    this.log.push({ atMs, bot: bot.callsign, role: bot.role, beat, what });
  }
}

/** The scenario's frozen config (defaults + its overrides). */
export function scenarioConfig(scenario: Scenario, base: Partial<GameConfig> = {}): GameConfig {
  return makeGameConfig({ ...base, ...structuredClone(scenario.config) });
}

/**
 * Plays a scenario without a server (CLI, tests): lobby, the bots board, the
 * raid starts and runs in 100 ms steps to the end. Same seed and route, same
 * raid.
 */
export function runScenarioHeadless(
  scenario: Scenario,
  route: ScenarioRoute,
  onEvents?: (events: GameEvent[], state: RaidState) => void,
): { state: RaidState; driver: ScenarioDriver } {
  const config = scenarioConfig(scenario);
  const driver = new ScenarioDriver(scenario, route);
  let state = createRaidState(`${scenario.id}-${route}`, config, scenario.seed);
  let t = 0;
  const apply = (cmd: EngineCommand): CommandOutcome => {
    const r = reduce(state, cmd);
    state = r.state;
    if (r.events.length) onEvents?.(r.events, state);
    return r.outcome;
  };
  const dispatch = (cmd: DriverCommand) => apply({ ...cmd, t } as EngineCommand);
  apply({ type: 'OPEN_LOBBY', t });
  driver.step(state, 0, dispatch);
  t = 1000;
  apply({ type: 'START', t });
  const startedAt = t;
  const end = startedAt + config.matchSeconds * 1000 + 100;
  while (state.status === 'LIVE' && t < end) {
    driver.step(state, state.gameMs, dispatch);
    t += 100;
    apply({ type: 'TICK', t });
  }
  return { state, driver };
}
