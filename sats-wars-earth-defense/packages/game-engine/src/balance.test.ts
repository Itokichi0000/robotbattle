import { PRESETS, SEAT_IDS } from '@swed/shared';
import type { GameConfig, SeatId } from '@swed/shared';
import { describe, expect, it } from 'vitest';
import { playMatch } from './sim';

/**
 * Full-match balance floors with bot pilots. The numbers are floors, not targets: real
 * tuning happens with people, but a regression that makes the game unwinnable (or winnable
 * with nobody aboard) must fail CI.
 */
function run(config: GameConfig, crew: SeatId[], runs: number) {
  let wins = 0;
  let overdrives = 0;
  let repairs = 0;
  for (let i = 0; i < runs; i++) {
    const s = playMatch(config, crew, 1000 + i);
    if (s.result?.outcome === 'VICTORY') wins += 1;
    overdrives += s.stats.overdrives;
    repairs += s.stats.repairs;
  }
  return { rate: wins / runs, overdrives: overdrives / runs, repairs: repairs / runs };
}

const FOUR: SeatId[] = ['GUNNER_L', 'GUNNER_R', 'SHIELD_L', 'SHIELD_R'];

describe('balance (STANDARD, bot pilots)', { timeout: 120_000 }, () => {
  const cfg = PRESETS.STANDARD;

  it('AUTO SUPPORT alone does not win: people are the point', () => {
    expect(run(cfg, [], 12).rate).toBeLessThanOrEqual(0.1);
  });

  it('two pilots (one gunner, one shield) with AUTO SUPPORT can win', () => {
    expect(run(cfg, ['GUNNER_L', 'SHIELD_L'], 12).rate).toBeGreaterThanOrEqual(0.5);
  });

  it('four pilots win comfortably', () => {
    expect(run(cfg, FOUR, 12).rate).toBeGreaterThanOrEqual(0.75);
  });

  it('a full crew of eight wins, fires OVERDRIVE and keeps the engineers busy', () => {
    const r = run(cfg, [...SEAT_IDS], 12);
    expect(r.rate).toBeGreaterThanOrEqual(0.75);
    expect(r.overdrives).toBeGreaterThanOrEqual(1);
    expect(r.repairs).toBeGreaterThanOrEqual(5);
  });

  it('SHORT preset stays winnable for a full crew', () => {
    expect(run(PRESETS.SHORT, [...SEAT_IDS], 8).rate).toBeGreaterThanOrEqual(0.6);
  });
});
