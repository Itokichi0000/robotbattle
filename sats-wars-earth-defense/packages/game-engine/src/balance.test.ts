import { PRESETS } from '@swed/shared';
import type { GameConfig } from '@swed/shared';
import { describe, expect, it } from 'vitest';
import { playMatch } from './sim';
import type { SimOptions } from './sim';

/**
 * Balance floors with simulated players who press what the big screen recommends. They are
 * floors and ceilings, not targets: real tuning happens with people, but a change that makes
 * the game unwinnable, or makes money win on its own, must fail CI.
 */
function rate(c: GameConfig, players: number, runs: number, opts: SimOptions) {
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    if (playMatch(c, players, 500 + i, opts).result?.outcome === 'VICTORY') wins += 1;
  }
  return wins / runs;
}

describe('balance (simulated crowd)', { timeout: 300_000 }, () => {
  const c = PRESETS.STANDARD;

  it('nobody pressing anything loses', () => {
    expect(rate(c, 1, 4, { skill: 0, tapEveryMs: 1e9 })).toBe(0);
  });

  it('two people tapping for free can win', () => {
    expect(rate(c, 2, 10, { skill: 0.85, tapEveryMs: 1_100 })).toBeGreaterThanOrEqual(0.5);
  });

  it('one person alone is hard for free, and one Lightning action helps clearly', () => {
    const free = rate(c, 1, 10, { skill: 0.9, tapEveryMs: 900 });
    const paid = rate(c, 1, 10, { skill: 0.9, tapEveryMs: 900, paidPerPlayer: 1 });
    expect(paid).toBeGreaterThan(free);
    expect(paid).toBeGreaterThanOrEqual(0.4);
  });

  it('a crowd of eight wins comfortably', () => {
    expect(rate(c, 8, 8, { skill: 0.8, tapEveryMs: 1_200 })).toBeGreaterThanOrEqual(0.75);
  });

  it('a big, sloppy crowd still wins (the game must not stall at a conference)', () => {
    expect(rate(c, 30, 4, { skill: 0.7, tapEveryMs: 1_500 })).toBeGreaterThanOrEqual(0.75);
  });

  it('SHORT stays winnable for a small group', () => {
    expect(rate(PRESETS.SHORT, 3, 8, { skill: 0.85, tapEveryMs: 1_100 })).toBeGreaterThanOrEqual(
      0.6,
    );
  });
});
