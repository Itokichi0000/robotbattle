import type { GameConfig, RaidResult, RaidState, Role } from '@sats-wars/shared';
import { makeGameConfig } from '@sats-wars/shared';
import { type EngineCommand, createRaidState, mulberry32, reduce, solveTask } from '@sats-wars/game-engine';

/**
 * Raid simulator: N simulated pilots play the real engine for 8 minutes.
 * Each pilot waits for their cooldown, thinks for a moment, asks for the
 * default (recommended) mission of their seat, plays the minigame with a given
 * skill and submits. Hypothesis check, not proof: venue playtests decide.
 */
export type RoleMix = 'spread' | 'gunners' | 'no-support';

export interface RaidSimOptions {
  pilots: number;
  mix: RoleMix;
  /** Probability of a clean minigame run. */
  skill: number;
  seed: number;
  config?: Partial<GameConfig>;
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
}

const SPREAD: Role[] = ['GUNNER', 'GUARDIAN', 'ROUTER', 'GUNNER', 'ENGINEER', 'GUARDIAN', 'GUNNER', 'ROUTER', 'GUARDIAN', 'ENGINEER'];
const NO_SUPPORT: Role[] = ['GUNNER', 'GUARDIAN'];

export function roleFor(mix: RoleMix, i: number): Role {
  if (mix === 'gunners') return 'GUNNER';
  const list = mix === 'spread' ? SPREAD : NO_SUPPORT;
  return list[i % list.length]!;
}

export function simulateRaid(o: RaidSimOptions): RaidSim {
  const config = makeGameConfig(o.config ?? {});
  const rand = mulberry32((o.seed * 2654435761) >>> 0);
  let state: RaidState = createRaidState(`sim-${o.seed}`, config, o.seed);
  const run = (cmd: EngineCommand) => {
    const r = reduce(state, cmd);
    state = r.state;
    return r;
  };
  for (let i = 0; i < o.pilots; i++) run({ type: 'BOARD', t: 0, pilotId: `p${i}`, callsign: `P${i}`, role: roleFor(o.mix, i), isBot: true });
  run({ type: 'OPEN_LOBBY', t: 0 });
  run({ type: 'START', t: 0 });

  type Plan = { at: number; pilotId: string; step: 'request' | 'submit'; taskId?: string; input?: unknown };
  const queue: Plan[] = Array.from({ length: o.pilots }, (_, i) => ({ at: 1500 + rand() * 4000, pilotId: `p${i}`, step: 'request' as const }));
  const end = config.matchSeconds * 1000 + 1;
  let guard = 0;
  while (state.status === 'LIVE' && guard++ < 200_000) {
    queue.sort((a, z) => a.at - z.at);
    const next = queue.shift();
    if (!next || next.at > end) break;
    const t = Math.round(next.at);
    if (next.step === 'request') {
      const r = run({ type: 'REQUEST_TASK', t, pilotId: next.pilotId });
      if (r.outcome.kind === 'task' && r.outcome.code === 'OK' && r.outcome.task) {
        const task = r.outcome.task;
        const sink = task.target.kind === 'ENERGY' ? task.target.sink : undefined;
        const input = solveTask(task.params, o.skill, rand, 900, sink);
        const playMs = 'stopAtMs' in input ? input.stopAtMs : 'releaseAtMs' in input ? input.releaseAtMs : 2500 + rand() * 3000;
        queue.push({ at: t + playMs + 150, pilotId: next.pilotId, step: 'submit', taskId: task.taskId, input });
      } else if (r.outcome.kind === 'task') {
        const wait = r.outcome.code === 'COOLDOWN' ? Math.max(500, r.outcome.cooldownUntil - state.gameMs) : 3000;
        queue.push({ at: t + wait + rand() * 1500, pilotId: next.pilotId, step: 'request' });
      }
    } else {
      run({ type: 'SUBMIT_TASK', t, pilotId: next.pilotId, taskId: next.taskId!, input: next.input as never });
      // Cooldown, then a few seconds to look at the screen and decide.
      queue.push({ at: t + config.normalActionCooldownSeconds * 1000 + 1000 + rand() * 3000, pilotId: next.pilotId, step: 'request' });
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
  };
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
  };
}
