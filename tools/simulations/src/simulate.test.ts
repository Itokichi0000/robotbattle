import { describe, expect, it } from 'vitest';
import { aggregate, simulateSeason } from './simulate';

describe('crowd simulator', () => {
  it('is deterministic per seed and always finishes a season of 8 rounds', () => {
    const o = { playersPerTeam: { RAIJIN: 5, FUJIN: 5 }, seed: 7 };
    const a = simulateSeason(o);
    expect(simulateSeason(o)).toEqual(a);
    expect(a.rounds).toHaveLength(8);
    expect(a.punches.RAIJIN + a.punches.FUJIN).toBeGreaterThan(0);
    // Taps between rounds are refused by the engine, never charged.
    expect(a.satsSpent.RAIJIN).toBe(a.punches.RAIJIN * 21);
  });

  it('equal crowds win about equally often', () => {
    const a = aggregate(Array.from({ length: 40 }, (_, i) => simulateSeason({ playersPerTeam: { RAIJIN: 8, FUJIN: 8 }, seed: i * 13 + 1 })));
    const decisive = a.roundWins.RAIJIN + a.roundWins.FUJIN;
    expect(Math.abs(a.roundWins.RAIJIN - a.roundWins.FUJIN) / decisive).toBeLessThan(0.2);
  }, 60_000);

  it('adaptive HP keeps busy rounds short and quiet rounds finishable', () => {
    const big = aggregate(Array.from({ length: 6 }, (_, i) => simulateSeason({ playersPerTeam: { RAIJIN: 40, FUJIN: 40 }, seed: i + 1 })));
    const small = aggregate(Array.from({ length: 6 }, (_, i) => simulateSeason({ playersPerTeam: { RAIJIN: 2, FUJIN: 2 }, seed: i + 1 })));
    expect(big.hpByRound[7]!).toBeGreaterThan(small.hpByRound[7]!);
    expect(big.avgRoundSec).toBeLessThanOrEqual(60);
  }, 60_000);
});
