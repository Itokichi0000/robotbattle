/**
 * Parameter sweep helper:
 *   pnpm --filter @sats-wars/simulations exec tsx src/tune.ts [seasons]
 * Compares candidate configs on pacing (round length, KO rate) and on how
 * often a smaller crowd (10 vs 6) still takes rounds.
 */
import type { GameConfig, TeamId } from '@sats-wars/shared';
import { aggregate, simulateSeason } from './simulate';

const N = Number(process.argv[2] ?? 30);
const candidates: Array<[string, Partial<GameConfig>]> = [
  ['default', {}],
  ['cap100k x3', { hpCap: 100_000, hpMaxChangeFactor: 3 }],
  ['cap100k x3 pinch40%', { hpCap: 100_000, hpMaxChangeFactor: 3, pinchHpRatio: 0.4 }],
  ['cap100k x3 pinch×2', { hpCap: 100_000, hpMaxChangeFactor: 3, pinchMultiplier: 2 }],
  ['cap100k x3 pinch40% ×2', { hpCap: 100_000, hpMaxChangeFactor: 3, pinchHpRatio: 0.4, pinchMultiplier: 2 }],
  ['cap100k x4 pinch40% ×2', { hpCap: 100_000, hpMaxChangeFactor: 4, pinchHpRatio: 0.4, pinchMultiplier: 2 }],
];

const run = (players: Record<TeamId, number>, config: Partial<GameConfig>) =>
  aggregate(Array.from({ length: N }, (_, i) => simulateSeason({ playersPerTeam: players, seed: 500 + i * 101, config })));

console.log(`seasons per cell: ${N}`);
console.log('candidate | 10v10 round s / KO% | 30v30 round s | 100v100 round s | 10v8 underdog | 10v6 underdog | 2v2 round s');
for (const [name, cfg] of candidates) {
  const even = run({ RAIJIN: 10, FUJIN: 10 }, cfg);
  const big = run({ RAIJIN: 30, FUJIN: 30 }, cfg);
  const huge = run({ RAIJIN: 100, FUJIN: 100 }, cfg);
  const u8 = run({ RAIJIN: 10, FUJIN: 8 }, cfg);
  const u6 = run({ RAIJIN: 10, FUJIN: 6 }, cfg);
  const tiny = run({ RAIJIN: 2, FUJIN: 2 }, cfg);
  const pct = (a: typeof u8) => `${((a.roundWins.FUJIN / a.rounds) * 100).toFixed(1)}%`;
  console.log(
    `${name} | ${even.avgRoundSec.toFixed(1)} / ${(even.koRate * 100).toFixed(0)} | ${big.avgRoundSec.toFixed(1)} | ${huge.avgRoundSec.toFixed(1)} | ${pct(u8)} | ${pct(u6)} | ${tiny.avgRoundSec.toFixed(1)}`,
  );
}
