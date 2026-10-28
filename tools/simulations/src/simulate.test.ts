import { describe, expect, it } from 'vitest';
import { aggregate, simulateMatch } from './simulate';

describe('simulator', () => {
  it('is deterministic per seed and always produces a result', () => {
    const o = {
      playersPerTeam: { RAIJIN: 5, FUJIN: 5 },
      strategy: { RAIJIN: 'balanced', FUJIN: 'random' },
      seed: 7,
    } as const;
    expect(simulateMatch(o)).toEqual(simulateMatch(o));
    expect(simulateMatch(o).endGameMs).toBeGreaterThan(0);
  });
  it('mirror-symmetric teams have similar win rates', () => {
    const results = Array.from({ length: 200 }, (_, i) =>
      simulateMatch({
        playersPerTeam: { RAIJIN: 10, FUJIN: 10 },
        strategy: { RAIJIN: 'balanced', FUJIN: 'balanced' },
        seed: i * 13 + 1,
      }),
    );
    const a = aggregate(results);
    const decisive = a.raijinWins + a.fujinWins;
    expect(Math.abs(a.raijinWins - a.fujinWins) / decisive).toBeLessThan(0.2);
  });
});
