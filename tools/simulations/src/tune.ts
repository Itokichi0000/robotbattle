/**
 * Parameter sweep helper:
 *   pnpm --filter @sats-wars/simulations exec tsx src/tune.ts [campaigns]
 */
import type { GameConfig } from '@sats-wars/shared';
import { aggregate, simulateCampaign } from './simulate';

const N = Number(process.argv[2] ?? 40);
const base: Partial<GameConfig> = { hpGrowthPerWave: 0.25, attackGrowthPerWave: 0.2, landingsStepWaves: 1 };
const candidates: Array<[string, Partial<GameConfig>]> = [
  ['A', base],
  ['A city60', { ...base, cityHpMax: 60, liberateHp: 30 }],
  ['A atk x1.6', { ...base, scout: { hp: 30, attack: 13 }, walker: { hp: 70, attack: 24 }, mothership: { hp: 260, attack: 40 } }],
  ['A city70 atk x1.3', { ...base, cityHpMax: 70, liberateHp: 30, scout: { hp: 30, attack: 10 }, walker: { hp: 70, attack: 20 }, mothership: { hp: 260, attack: 32 } }],
];

console.log(`campaigns per cell: ${N}`);
console.log('candidate | auto share | wave p10/p50/p90 | actions p50 | sats mean | lost/liberated');
for (const [name, cfg] of candidates) {
  for (const autoShare of [1, 0.6, 0.2]) {
    const a = aggregate(Array.from({ length: N }, (_, i) => simulateCampaign({ seed: 11 + i * 97, config: cfg, autoShare })));
    console.log(
      `${name} | ${autoShare} | ${a.waveP10}/${a.waveP50}/${a.waveP90} | ${a.actionsP50} | ${Math.round(a.satsMean)} | ${a.regionsLostMean.toFixed(1)}/${a.liberatedMean.toFixed(1)}`,
    );
  }
}
