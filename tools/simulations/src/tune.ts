/** Parameter sweep helper: pnpm --filter @sats-wars/simulations exec tsx src/tune.ts */
import type { GameConfig, TeamId } from '@sats-wars/shared';
import { makeGameConfig } from '@sats-wars/shared';
import type { StrategyName } from '@sats-wars/game-engine';
import { aggregate, simulateMatch } from './simulate';

const N = Number(process.argv[2] ?? 120);
const F: Partial<GameConfig> = {
  baseDamage: 8,
  damageMax: 20,
  defenseRegionReduction: 3,
  attackRegionBonus: 2,
  specialBonus: 8,
  energyRegionGain: 6,
};
const candidates: Array<[string, Partial<GameConfig>]> =
  process.argv[3] === 'charge'
    ? [
        ['F', F],
        ['F charge15', { ...F, chargeAmount: 15 }],
        ['F charge15 sp12', { ...F, chargeAmount: 15, specialBonus: 12 }],
        [
          'F charge15 sp12 enBonus3',
          { ...F, chargeAmount: 15, specialBonus: 12, energyBonusPer10: 3, energyBonusMax: 6 },
        ],
        ['F contest20', { ...F, contestWindowMs: 20_000 }],
      ]
    : [
        ['default', {}],
        ['A base8 max22', { baseDamage: 8, damageMax: 22 }],
        ['B base8 max22 def3', { baseDamage: 8, damageMax: 22, defenseRegionReduction: 3 }],
        [
          'C base8 max22 def3 atk2',
          { baseDamage: 8, damageMax: 22, defenseRegionReduction: 3, attackRegionBonus: 2 },
        ],
        [
          'D base7 max20 def3 atk2 sp8',
          {
            baseDamage: 7,
            damageMax: 20,
            defenseRegionReduction: 3,
            attackRegionBonus: 2,
            specialBonus: 8,
          },
        ],
        [
          'E base8 max22 def3 atk2 shield45',
          {
            baseDamage: 8,
            damageMax: 22,
            defenseRegionReduction: 3,
            attackRegionBonus: 2,
            shieldDurationMs: 45_000,
          },
        ],
        [
          'F base8 max20 def3 atk2 sp8 en6',
          {
            baseDamage: 8,
            damageMax: 20,
            defenseRegionReduction: 3,
            attackRegionBonus: 2,
            specialBonus: 8,
            energyRegionGain: 6,
          },
        ],
      ];
const vs = (cfg: GameConfig, a: StrategyName, b: StrategyName, players: number) => {
  let w = 0;
  for (let i = 0; i < N; i++) {
    const sides: Array<[TeamId, TeamId]> = i % 2 ? [['RAIJIN', 'FUJIN']] : [['FUJIN', 'RAIJIN']];
    const [ta, tb] = sides[0]!;
    const r = simulateMatch({
      config: cfg,
      playersPerTeam: { RAIJIN: players, FUJIN: players },
      strategy: { [ta]: a, [tb]: b } as Record<TeamId, StrategyName>,
      seed: 77 + i * 7919,
    });
    w += r.winner === ta ? 1 : r.winner === null ? 0.5 : 0;
  }
  return w / N;
};
for (const [name, over] of candidates) {
  const cfg = makeGameConfig(over);
  const parts: string[] = [];
  for (const players of [10, 30]) {
    const a = aggregate(
      Array.from({ length: N }, (_, i) =>
        simulateMatch({
          config: cfg,
          playersPerTeam: { RAIJIN: players, FUJIN: players },
          strategy: { RAIJIN: 'balanced', FUJIN: 'balanced' },
          seed: 5 + i * 31,
        }),
      ),
    );
    parts.push(
      `p${players}: KO ${(a.koRate * 100).toFixed(0)}% end ${a.avgEndSec.toFixed(0)}s draw ${((a.draws / a.n) * 100).toFixed(0)}%`,
    );
  }
  parts.push(`aggr>bal ${(vs(cfg, 'aggressive', 'balanced', 10) * 100).toFixed(0)}%`);
  parts.push(`def>aggr ${(vs(cfg, 'defensive', 'aggressive', 10) * 100).toFixed(0)}%`);
  parts.push(`chg>bal ${(vs(cfg, 'charger', 'balanced', 10) * 100).toFixed(0)}%`);
  parts.push(`adapt>aggr ${(vs(cfg, 'adaptive', 'aggressive', 10) * 100).toFixed(0)}%`);
  parts.push(`adapt>aggr@30 ${(vs(cfg, 'adaptive', 'aggressive', 30) * 100).toFixed(0)}%`);
  parts.push(`10v11 ${((1 - vsSize(cfg)) * 100) | 0}%small`);
  console.log(name.padEnd(36), parts.join(' | '));
}
function vsSize(cfg: GameConfig) {
  let bigWins = 0;
  for (let i = 0; i < N; i++) {
    const r = simulateMatch({
      config: cfg,
      playersPerTeam: { RAIJIN: 10, FUJIN: 11 },
      strategy: { RAIJIN: 'balanced', FUJIN: 'balanced' },
      seed: 3 + i * 17,
    });
    bigWins += r.winner === 'FUJIN' ? 1 : r.winner === null ? 0.5 : 0;
  }
  return bigWins / N;
}
