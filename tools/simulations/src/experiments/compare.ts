/**
 * Compare balance variants side by side (D-053 design work). Not part of the
 * report: `pnpm --filter @sats-wars/simulations exec tsx src/experiments/compare.ts`.
 */
import { DEFAULT_GAME_CONFIG, type GameConfig } from '@sats-wars/shared';
import { aggregate, simulateRaid } from '../simulate';

const SEEDS = Number(process.env.SEEDS ?? 10);
const CREWS = (process.env.CREWS ?? '3,5,9,16,30,60,100').split(',').map(Number);
const D = DEFAULT_GAME_CONFIG;

const VARIANTS: Record<string, Partial<GameConfig>> = {
  legacy: {
    escortWing: { extraEveryPilots: 0, max: 1 },
    gunner: { ...D.gunner, chargeEnergy: 0 },
    boss: { ...D.boss, barrierFloorRatio: 0 },
    adaptive: { ...D.adaptive, maxAdjust: 0 },
  },
  defaults: {},
  ...(process.env.EXTRA
    ? (JSON.parse(process.env.EXTRA) as Record<string, Partial<GameConfig>>)
    : {}),
};
const only = process.env.ONLY?.split(',');
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
for (const [name, config] of Object.entries(VARIANTS)) {
  if (only && !only.includes(name)) continue;
  console.log(`\n== ${name}`);
  console.log('crew | win | fell | t/o | cities | land | idle | special | sp@ | dmg/shield');
  for (const pilots of CREWS) {
    const sims = Array.from({ length: SEEDS }, (_, i) =>
      simulateRaid({
        pilots,
        mix: (process.env.MIX ?? 'spread') as 'spread',
        skill: Number(process.env.SKILL ?? 0.65),
        seed: 1000 + i * 7919 + pilots * 31,
        config,
      }),
    );
    const a = aggregate(sims);
    const sp = sims.filter((x) => x.specialAtSeconds !== null).map((x) => x.specialAtSeconds!);
    console.log(
      `${String(pilots).padStart(4)} | ${pct(a.winRate)} | ${pct(a.citiesLostRate)} | ${pct(a.timeoutRate)} | ${a.survivingMean.toFixed(1).padStart(4)} | ${pct(a.escortLandRate)} | ${pct(a.gunnerIdleRate)} | ${pct(a.specialReached)} | ${sp.length ? Math.round(sp.reduce((x, y) => x + y, 0) / sp.length) : '-'} | ${Math.round(a.cityDamageMean)}/${Math.round(a.shieldAbsorbedMean)}`,
    );
  }
}
