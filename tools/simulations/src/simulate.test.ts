import { describe, expect, it } from 'vitest';
import { aggregate, simulateRaid } from './simulate';

const many = (pilots: number, mix: 'spread' | 'gunners' | 'no-support', skill: number, n = 6) =>
  aggregate(
    Array.from({ length: n }, (_, i) => simulateRaid({ pilots, mix, skill, seed: 500 + i * 101 })),
  );

describe('raid balance (smoke)', () => {
  it('is deterministic for a seed', () => {
    const a = simulateRaid({ pilots: 9, mix: 'spread', skill: 0.65, seed: 42 });
    const b = simulateRaid({ pilots: 9, mix: 'spread', skill: 0.65, seed: 42 });
    expect(a).toEqual(b);
  });

  it('a balanced crew of 9 usually wins; an all-gunner crew does worse', () => {
    const spread = many(9, 'spread', 0.65);
    const gunners = many(9, 'gunners', 0.65);
    expect(spread.winRate).toBeGreaterThanOrEqual(0.5);
    expect(spread.survivingMean).toBeGreaterThan(gunners.survivingMean);
  });

  it(
    'a big crowd still has to cover the seats (fair-share normalisation)',
    { timeout: 60_000 },
    () => {
      const spread = many(40, 'spread', 0.65, 4);
      const gunners = many(40, 'gunners', 0.65, 4);
      expect(spread.winRate).toBeGreaterThan(gunners.winRate);
    },
  );

  it('small crews get the assist AI', () => {
    const solo = many(2, 'spread', 0.65, 3);
    expect(solo.assistMean).toBeGreaterThan(0);
  });
});
