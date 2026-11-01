import { boltTargetAt } from '@swed/shared';
import type { GameConfig, MatchState } from '@swed/shared';
import { botChoose } from './bots';
import { advanceTo, createMatch, jobsOf, reduce } from './engine';
import { toPublicState } from './public';
import { nextRandom } from './rng';

export interface SimOptions {
  /** How often the sim player presses the recommended button (0..1). */
  skill?: number;
  /** Mean time between one player's taps (ms); people tap slower than the cooldown allows. */
  tapEveryMs?: number;
  /** Lightning payments each player sends during the fight (0 = free play only). */
  paidPerPlayer?: number;
  /** Swipe up for the group launch (D-035). */
  launch?: boolean;
}

/**
 * Plays one whole match headless and deterministic: `players` people who tap what the big
 * screen recommends. Paid actions (VIRTUAL) are spread evenly through the fight.
 */
export function playMatch(
  config: GameConfig,
  players: number,
  seed: number,
  opts: SimOptions = {},
): MatchState {
  let s = createMatch({ matchId: `sim-${seed}`, seed, config, autoStart: false });
  const rng = { rng: (seed * 2654435761) >>> 0 };
  const tapEvery = opts.tapEveryMs ?? 1_100;
  const skill = opts.skill ?? 0.85;
  const paidPer = opts.paidPerPlayer ?? 0;
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  for (const id of ids) {
    s = reduce(s, { type: 'PLAYER_JOIN', t: 0, pilotId: id, displayName: id }).state;
  }
  s = reduce(s, { type: 'START', t: 0 }).state;
  if (opts.launch ?? true)
    for (const id of ids) s = reduce(s, { type: 'LAUNCH_PUSH', t: 0, pilotId: id }).state;
  s = reduce(s, { type: 'SKIP_DEPLOY', t: 0 }).state;
  const start = s.t;
  const nextTap = new Map(ids.map((id) => [id, start + nextRandom(rng) * tapEvery]));
  const paidAt = ids.flatMap((id, i) =>
    Array.from({ length: paidPer }, (_, k) => ({
      id,
      at: start + ((k + 1) / (paidPer + 1)) * config.timings.battleMs * 0.9 + i * 137,
    })),
  );
  let n = 0;
  for (let t = start + 100; !s.result && t < start + config.timings.battleMs + 1_000; t += 100) {
    s = advanceTo(s, t).state;
    const pub = toPublicState(s);
    for (const id of ids) {
      if ((nextTap.get(id) ?? 0) > t) continue;
      nextTap.set(id, t + tapEvery * (0.6 + nextRandom(rng) * 0.8));
      const kind = botChoose(pub, nextRandom(rng), skill, jobsOf(s, id, t));
      s = reduce(s, { type: 'ACTION', t, pilotId: id, clientActionId: `a${n++}`, kind }).state;
    }
    for (const p of paidAt) {
      if (p.at > t || p.at <= t - 100) continue;
      s = reduce(s, {
        type: 'LIGHTNING',
        t,
        intentId: `pi-${p.id}-${p.at}`,
        pilotId: p.id,
        virtual: true,
        settleMs: null,
      }).state;
    }
    // Payers throw their bolt about 1.5 s later; a skilled one hits the weak point.
    for (const b of s.bolts) {
      if (!b.pilotId || t < b.startedAt + 1_500) continue;
      const aim = nextRandom(rng) < skill ? boltTargetAt(b.id, t - b.startedAt) : { x: 0, y: 0 };
      s = reduce(s, {
        type: 'BOLT_THROW',
        t,
        pilotId: b.pilotId,
        boltId: b.id,
        x: aim.x,
        y: aim.y,
        at: t,
      }).state;
    }
  }
  return s;
}
