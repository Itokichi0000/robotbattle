import type { GameConfig, MatchState } from '@swed/shared';
import { botChoose } from './bots';
import { advanceTo, createMatch, reduce } from './engine';
import { toPublicState } from './public';
import { nextRandom } from './rng';

export interface SimOptions {
  /** How often the sim player presses the recommended button (0..1). */
  skill?: number;
  /** Mean time between one player's taps (ms); people tap slower than the cooldown allows. */
  tapEveryMs?: number;
  /** Lightning actions each player sends during the fight (0 = free play only). */
  paidPerPlayer?: number;
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
      const kind = botChoose(pub, nextRandom(rng), skill);
      s = reduce(s, { type: 'ACTION', t, pilotId: id, clientActionId: `a${n++}`, kind }).state;
    }
    for (const p of paidAt) {
      if (p.at > t || p.at <= t - 100) continue;
      s = reduce(s, {
        type: 'PAID_ACTION',
        t,
        intentId: `pi-${p.id}-${p.at}`,
        pilotId: p.id,
        kind: botChoose(toPublicState(s), 0, 1),
        virtual: true,
        settleMs: null,
      }).state;
    }
  }
  return s;
}
