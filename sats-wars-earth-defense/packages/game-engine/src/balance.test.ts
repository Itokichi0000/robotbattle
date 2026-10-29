import { PRESETS, SEAT_IDS } from '@swed/shared';
import type { GameConfig, SeatId } from '@swed/shared';
import { describe, expect, it } from 'vitest';
import { playMatch } from './sim';

/**
 * Full-match balance smoke test with bot pilots. The numbers are a floor, not a target:
 * real tuning happens with the simulation report, but a regression that makes the game
 * unwinnable (or winnable with nobody aboard) should fail CI.
 */

function winRate(config: GameConfig, crew: SeatId[], runs: number, autoSupport = true) {
  let wins = 0;
  let cities = 0;
  for (let i = 0; i < runs; i++) {
    const s = playMatch(config, crew, 1000 + i, autoSupport);
    if (s.result?.outcome === 'VICTORY') wins += 1;
    cities += Object.values(s.cities).filter((c) => !c.lost).length;
  }
  return { rate: wins / runs, avgCities: cities / runs };
}

const OPEN: SeatId[] = ['GUNNER_L', 'GUNNER_R', 'SHIELD_L', 'SHIELD_R'];

describe('balance (STANDARD, bot pilots)', () => {
  const cfg = PRESETS.STANDARD;
  it('two pilots (one gunner, one shield) with AUTO SUPPORT can win', () => {
    const r = winRate(cfg, ['GUNNER_L', 'SHIELD_L'], 12);
    console.info('2 pilots', r);
    expect(r.rate).toBeGreaterThanOrEqual(0.5);
  });

  it('four pilots win more comfortably than two', () => {
    const r = winRate(cfg, OPEN, 12);
    console.info('4 pilots', r);
    expect(r.rate).toBeGreaterThanOrEqual(0.75);
  });

  it('AUTO SUPPORT alone does not win: humans are the point', () => {
    const r = winRate(cfg, [], 12);
    console.info('0 pilots', r);
    expect(r.rate).toBeLessThanOrEqual(0.1);
  });

  it('every seat id is a real seat', () => {
    for (const s of OPEN) expect(SEAT_IDS).toContain(s);
  });
});
