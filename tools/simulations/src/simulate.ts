import type { GameConfig, GameEvent, RaidResult, RaidState, Role } from '@sats-wars/shared';
import { ROLES, makeGameConfig } from '@sats-wars/shared';
import {
  type EngineCommand,
  createRaidState,
  mulberry32,
  reduce,
  solveTask,
} from '@sats-wars/game-engine';

/**
 * Raid simulator: N simulated pilots play the real engine for 8 minutes.
 * Each pilot waits for their cooldown, thinks for a moment, asks for the
 * default (recommended) mission of their seat, plays the minigame with a given
 * skill and submits. Hypothesis check, not proof: venue playtests decide.
 */
/** spread = balanced seats, random = everyone picks a seat at random (crowd-like skew). */
export type RoleMix = 'spread' | 'gunners' | 'no-support' | 'random';

export interface RaidSimOptions {
  pilots: number;
  mix: RoleMix;
  /** Probability of a clean minigame run. */
  skill: number;
  seed: number;
  config?: Partial<GameConfig>;
  /** Every batch of engine events (demo:raid logs them). */
  onEvents?: (events: GameEvent[], state: RaidState) => void;
}

export interface RaidSim {
  outcome: RaidResult['outcome'];
  reason: RaidResult['reason'];
  survivingCities: number;
  bossHpLeftRatio: number;
  clearSeconds: number | null;
  special: RaidResult['special'];
  score: number;
  syncAverage: number;
  assistActions: number;
  tasks: number;
  /** City damage that got through, and what shields absorbed: is there anything to defend? */
  cityDamage: number;
  shieldAbsorbed: number;
  /** Escort (not boss, not training) countdowns started / that actually fired. */
  escortTelegraphs: number;
  escortLanded: number;
  /** Gunner mission requests and how many found nothing to do (NO_TARGET). */
  gunnerRequests: number;
  gunnerIdle: number;
  /** Seconds into the raid when 神雷風陣 (or its fallback) resolved, if it did. */
  specialAtSeconds: number | null;
  /** Successful minigames (the "effective actions" the raid took). */
  successes: number;
  /** Most crowded seat's share of the crew minus 1/4 (0 = perfectly balanced). */
  roleSkew: number;
}

const SPREAD: Role[] = [
  'GUNNER',
  'GUARDIAN',
  'ROUTER',
  'GUNNER',
  'ENGINEER',
  'GUARDIAN',
  'GUNNER',
  'ROUTER',
  'GUARDIAN',
  'ENGINEER',
];
const NO_SUPPORT: Role[] = ['GUNNER', 'GUARDIAN'];

export function roleFor(mix: RoleMix, i: number, rand: () => number = Math.random): Role {
  if (mix === 'gunners') return 'GUNNER';
  if (mix === 'random') return ROLES[Math.floor(rand() * ROLES.length)]!;
  const list = mix === 'spread' ? SPREAD : NO_SUPPORT;
  return list[i % list.length]!;
}

export function simulateRaid(o: RaidSimOptions): RaidSim {
  const config = makeGameConfig(o.config ?? {});
  const rand = mulberry32((o.seed * 2654435761) >>> 0);
  let state: RaidState = createRaidState(`sim-${o.seed}`, config, o.seed);
  let escortTelegraphs = 0;
  let escortLanded = 0;
  let gunnerRequests = 0;
  let gunnerIdle = 0;
  let specialAtSeconds: number | null = null;
  const run = (cmd: EngineCommand) => {
    const r = reduce(state, cmd);
    state = r.state;
    if (r.events.length) o.onEvents?.(r.events, state);
    for (const ev of r.events) {
      if (ev.type === 'ENEMY_TELEGRAPH') {
        const e = state.enemies.find((x) => x.id === ev.data.telegraph.enemyId);
        if (ev.data.enemyKind !== 'BOSS' && !e?.training) escortTelegraphs += 1;
      }
      if (ev.type === 'ATTACK_RESOLVED' && ev.data.enemyKind !== 'BOSS') {
        const e = state.enemies.find((x) => x.id === ev.data.enemyId);
        if (!e?.training) escortLanded += 1;
      }
      if (ev.type === 'SPECIAL_RESOLVED') specialAtSeconds = Math.round(state.gameMs / 1000);
    }
    return r;
  };
  for (let i = 0; i < o.pilots; i++)
    run({
      type: 'BOARD',
      t: 0,
      pilotId: `p${i}`,
      callsign: `P${i}`,
      role: roleFor(o.mix, i, rand),
      isBot: true,
    });
  run({ type: 'OPEN_LOBBY', t: 0 });
  run({ type: 'START', t: 0 });

  type Plan = {
    at: number;
    pilotId: string;
    step: 'request' | 'submit';
    taskId?: string;
    input?: unknown;
  };
  const queue: Plan[] = Array.from({ length: o.pilots }, (_, i) => ({
    at: 1500 + rand() * 4000,
    pilotId: `p${i}`,
    step: 'request' as const,
  }));
  const end = config.matchSeconds * 1000 + 1;
  let guard = 0;
  while (state.status === 'LIVE' && guard++ < 200_000) {
    queue.sort((a, z) => a.at - z.at);
    const next = queue.shift();
    if (!next || next.at > end) break;
    const t = Math.round(next.at);
    if (next.step === 'request') {
      const r = run({ type: 'REQUEST_TASK', t, pilotId: next.pilotId });
      if (state.pilots[next.pilotId]?.role === 'GUNNER' && r.outcome.kind === 'task') {
        if (r.outcome.code === 'OK' || r.outcome.code === 'NO_TARGET') gunnerRequests += 1;
        if (r.outcome.code === 'NO_TARGET') gunnerIdle += 1;
      }
      if (r.outcome.kind === 'task' && r.outcome.code === 'OK' && r.outcome.task) {
        const task = r.outcome.task;
        const sink = task.target.kind === 'ENERGY' ? task.target.sink : undefined;
        const input = solveTask(task.params, o.skill, rand, 900, sink);
        const playMs =
          'stopAtMs' in input
            ? input.stopAtMs
            : 'releaseAtMs' in input
              ? input.releaseAtMs
              : 2500 + rand() * 3000;
        queue.push({
          at: t + playMs + 150,
          pilotId: next.pilotId,
          step: 'submit',
          taskId: task.taskId,
          input,
        });
      } else if (r.outcome.kind === 'task') {
        const wait =
          r.outcome.code === 'COOLDOWN'
            ? Math.max(500, r.outcome.cooldownUntil - state.gameMs)
            : 3000;
        queue.push({ at: t + wait + rand() * 1500, pilotId: next.pilotId, step: 'request' });
      }
    } else {
      run({
        type: 'SUBMIT_TASK',
        t,
        pilotId: next.pilotId,
        taskId: next.taskId!,
        input: next.input as never,
      });
      // Cooldown, then a few seconds to look at the screen and decide.
      queue.push({
        at: t + config.normalActionCooldownSeconds * 1000 + 1000 + rand() * 3000,
        pilotId: next.pilotId,
        step: 'request',
      });
    }
  }
  if (state.status === 'LIVE') run({ type: 'TICK', t: end });
  const r = state.result!;
  const boss = state.enemies.find((e) => e.id === state.bossId);
  return {
    outcome: r.outcome,
    reason: r.reason,
    survivingCities: r.survivingCities,
    bossHpLeftRatio: boss ? boss.hp / boss.hpMax : 0,
    clearSeconds: r.clearTimeMs === null ? null : Math.round(r.clearTimeMs / 1000),
    special: r.special,
    score: r.score.total,
    syncAverage: r.syncAverage,
    assistActions: r.stats.assistActions,
    tasks: r.stats.tasks,
    cityDamage: r.stats.cityDamageTaken,
    shieldAbsorbed: r.stats.shieldAbsorbed,
    escortTelegraphs,
    escortLanded,
    gunnerRequests,
    gunnerIdle,
    specialAtSeconds,
    successes: r.stats.successes,
    roleSkew: roleSkew(Object.values(state.pilots).map((p) => p.role)),
  };
}

export function roleSkew(roles: Role[]): number {
  if (!roles.length) return 0;
  const most = Math.max(...ROLES.map((r) => roles.filter((x) => x === r).length));
  return most / roles.length - 1 / ROLES.length;
}

export interface Aggregate {
  n: number;
  winRate: number;
  citiesLostRate: number;
  timeoutRate: number;
  survivingMean: number;
  bossLeftMean: number;
  clearMean: number | null;
  scoreMean: number;
  syncMean: number;
  specialActivated: number;
  specialFallback: number;
  specialFailed: number;
  assistMean: number;
  cityDamageMean: number;
  shieldAbsorbedMean: number;
  /** Share of escort countdowns that fired (tension: 0 = every escort dies first). */
  escortLandRate: number;
  /** Share of gunner requests that found nothing to do. */
  gunnerIdleRate: number;
  /** Share of raids where 神雷風陣 (or its fallback/fail) resolved. */
  specialReached: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

export function aggregate(sims: RaidSim[]): Aggregate {
  const n = sims.length;
  const share = (f: (x: RaidSim) => boolean) => sims.filter(f).length / Math.max(1, n);
  const clears = sims.filter((x) => x.clearSeconds !== null).map((x) => x.clearSeconds!);
  return {
    n,
    winRate: share((x) => x.outcome === 'SUCCEEDED'),
    citiesLostRate: share((x) => x.reason === 'CITIES_LOST'),
    timeoutRate: share((x) => x.reason === 'TIMEOUT'),
    survivingMean: mean(sims.map((x) => x.survivingCities)),
    bossLeftMean: mean(sims.map((x) => x.bossHpLeftRatio)),
    clearMean: clears.length ? mean(clears) : null,
    scoreMean: mean(sims.map((x) => x.score)),
    syncMean: mean(sims.map((x) => x.syncAverage)),
    specialActivated: share((x) => x.special === 'ACTIVATED'),
    specialFallback: share((x) => x.special === 'FALLBACK'),
    specialFailed: share((x) => x.special === 'FAILED'),
    assistMean: mean(sims.map((x) => x.assistActions)),
    cityDamageMean: mean(sims.map((x) => x.cityDamage)),
    shieldAbsorbedMean: mean(sims.map((x) => x.shieldAbsorbed)),
    escortLandRate:
      sims.reduce((a, x) => a + x.escortLanded, 0) /
      Math.max(
        1,
        sims.reduce((a, x) => a + x.escortTelegraphs, 0),
      ),
    gunnerIdleRate:
      sims.reduce((a, x) => a + x.gunnerIdle, 0) /
      Math.max(
        1,
        sims.reduce((a, x) => a + x.gunnerRequests, 0),
      ),
    specialReached: share((x) => x.specialAtSeconds !== null),
  };
}
