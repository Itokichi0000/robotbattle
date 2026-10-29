import type { Role, TaskInput } from '@sats-wars/shared';
import {
  type CommandOutcome,
  mulberry32,
  SCENARIOS,
  ScenarioDriver,
  solveTask,
} from '@sats-wars/game-engine';
import type { WallClock } from '../clock';
import type { Repo } from '../db/repo';
import type { RaidManager } from '../raid/manager';
import type { RaidRuntime } from '../raid/runtime';

const BOT_NAMES = [
  '雷丸',
  'イナズマ',
  '疾風',
  'ツムジ',
  'Volt',
  'Gale',
  '太鼓番',
  '風袋番',
  'Spark',
  'Zephyr',
];
const ROLE_CYCLE: Role[] = [
  'GUNNER',
  'GUARDIAN',
  'ROUTER',
  'ENGINEER',
  'GUNNER',
  'GUARDIAN',
  'GUNNER',
  'ROUTER',
  'GUARDIAN',
  'ENGINEER',
];

interface Bot {
  id: string;
  callsign: string;
  role: Role;
  nextAt: number;
  pending: { taskId: string; input: TaskInput; at: number } | null;
}

/**
 * Demo pilots for rehearsals and unattended demos (§I2). Every bot is
 * labelled BOT, never touches payments or entitlements, plays through the
 * same engine commands as people, and is recorded in the result: raids with
 * bots never enter the leaderboard.
 */
export class DemoBots {
  private bots: Bot[] = [];
  private rng = mulberry32(Date.now() & 0xffffffff);
  /** Demo seed raids: the scenario's own scripted bots (the regular ones sit out). */
  private scenario: { raidId: string; driver: ScenarioDriver } | null = null;
  skill = 0.65;

  constructor(
    private repo: Repo,
    private manager: RaidManager,
    private wall: WallClock,
  ) {
    // A new raid needs the bots to board again.
    manager.onRaidChanged(() => {
      for (const b of this.bots) {
        b.nextAt = 0;
        b.pending = null;
      }
    });
  }

  get enabledCount(): number {
    return this.bots.length;
  }

  setCount(n: number, actor: string, skill?: number): void {
    const before = this.bots.length;
    const count = Math.max(0, Math.min(100, Math.floor(n)));
    if (skill !== undefined) this.skill = Math.max(0, Math.min(1, skill));
    this.repo.audit(
      actor,
      'SET_DEMO_BOTS',
      null,
      { before, after: count, skill: this.skill },
      this.wall.now(),
    );
    this.bots = Array.from({ length: count }, (_, i) => ({
      id: `bot-${i}`,
      callsign: `BOT ${BOT_NAMES[i % BOT_NAMES.length]}${i >= BOT_NAMES.length ? Math.floor(i / BOT_NAMES.length) + 1 : ''}`,
      role: ROLE_CYCLE[i % ROLE_CYCLE.length]!,
      nextAt: 0,
      pending: null,
    }));
  }

  /** Called from the server tick loop. */
  step(): void {
    const rt = this.manager.current();
    const pick = this.manager.activeScenario;
    if (pick) {
      this.stepScenario(rt, pick);
      return;
    }
    if (this.bots.length === 0) return;
    const s = rt.state;
    // Game time, not wall time: with the demo time scale the raid runs faster,
    // and bots must play (and meet mission deadlines) at the raid's pace.
    const now = rt.nowGameMs();
    for (const bot of this.bots) {
      if (!s.pilots[bot.id]) {
        if (!this.manager.joinOpen() || this.manager.joinStopped) continue;
        rt.dispatch({
          type: 'BOARD',
          pilotId: bot.id,
          callsign: bot.callsign,
          role: bot.role,
          isBot: true,
        });
        rt.botsAboard = Math.max(
          rt.botsAboard,
          Object.values(rt.state.pilots).filter((p) => p.isBot).length,
        );
        continue;
      }
      if (rt.state.status !== 'LIVE') continue;
      if (bot.nextAt === 0) bot.nextAt = now + 1000 + this.rng() * 4000;
      if (now < bot.nextAt) continue;
      if (bot.pending) {
        rt.dispatch({
          type: 'SUBMIT_TASK',
          pilotId: bot.id,
          taskId: bot.pending.taskId,
          input: bot.pending.input,
        });
        bot.pending = null;
        // Cooldown, then a few seconds "looking at the screen".
        bot.nextAt =
          now + rt.state.config.normalActionCooldownSeconds * 1000 + 800 + this.rng() * 3000;
        continue;
      }
      const r = rt.dispatch({ type: 'REQUEST_TASK', pilotId: bot.id, choice: {} });
      if (r.outcome.kind !== 'task') continue;
      if (r.outcome.code === 'OK' && r.outcome.task) {
        const task = r.outcome.task;
        const sink = task.target.kind === 'ENERGY' ? task.target.sink : undefined;
        const input = solveTask(task.params, this.skill, this.rng, 900, sink);
        const playMs =
          'stopAtMs' in input
            ? input.stopAtMs
            : 'releaseAtMs' in input
              ? input.releaseAtMs
              : 2000 + this.rng() * 3000;
        bot.pending = { taskId: task.taskId, input, at: now + playMs };
        bot.nextAt = now + playMs + 100;
      } else {
        bot.nextAt = now + (r.outcome.code === 'COOLDOWN' ? 1500 : 3000);
      }
    }
  }

  private stepScenario(rt: RaidRuntime, pick: { id: string; route: 'success' | 'failure' }): void {
    const scenario = SCENARIOS[pick.id];
    if (!scenario) return;
    if (this.scenario?.raidId !== rt.raidId)
      this.scenario = {
        raidId: rt.raidId,
        driver: new ScenarioDriver(scenario, pick.route, 'scn'),
      };
    const none: CommandOutcome = { kind: 'none' };
    this.scenario.driver.step(rt.state, rt.nowGameMs(), (cmd) => {
      if (cmd.type === 'BOARD') {
        if (!this.manager.joinOpen()) return none;
        const r = rt.dispatch(cmd);
        rt.botsAboard = Math.max(
          rt.botsAboard,
          Object.values(rt.state.pilots).filter((p) => p.isBot).length,
        );
        return r.outcome;
      }
      return rt.dispatch(cmd).outcome;
    });
  }
}
