import type { GameEvent } from '@sats-wars/shared';
import { describe, expect, it } from 'vitest';
import { EARTH_DEFENSE_OPENING, runScenarioHeadless, scenarioConfig } from './scenario';

function play(route: 'success' | 'failure') {
  const events: Array<GameEvent & { atMs: number }> = [];
  const run = runScenarioHeadless(EARTH_DEFENSE_OPENING, route, (evs, s) => {
    for (const e of evs) events.push({ ...e, atMs: s.gameMs });
  });
  return { ...run, events };
}

describe('demo seed earth-defense-opening (spec I1)', () => {
  it('success route: every scripted moment happens and 神雷風陣 brings NULL CORE down', () => {
    const { state, driver, events } = play('success');
    expect(driver.log.filter((l) => l.what.startsWith('MISSED'))).toEqual([]);
    const of = <T extends GameEvent['type']>(type: T) =>
      events.filter(
        (e): e is Extract<GameEvent, { type: T }> & { atMs: number } => e.type === type,
      );

    // 0:30 warning on Sapporo, shielded by the guardian.
    const sapporo = of('ENEMY_TELEGRAPH').find((e) => e.data.telegraph.targets[0] === 'hokkaido')!;
    expect(sapporo.atMs).toBeGreaterThan(25_000);
    expect(sapporo.atMs).toBeLessThan(35_000);
    const sapporoHit = of('ATTACK_RESOLVED').find(
      (e) => e.data.telegraphId === sapporo.data.telegraph.id,
    )!;
    expect(sapporoHit.data.hits[0]!.absorbed).toBeGreaterThan(0);

    // 1:20 the gunner's arm shot weakens a scout without destroying it.
    const arm = of('TASK_RESOLVED').find(
      (e) =>
        e.atMs >= 80_000 &&
        e.data.role === 'GUNNER' &&
        e.data.effect?.kind === 'DAMAGE' &&
        e.data.effect.weakpoint === 'ARM',
    )!;
    expect(arm).toBeTruthy();
    expect(arm.data.effect).toMatchObject({ defeated: false });

    // 2:30 Tokyo and Osaka at once: Tokyo shielded, Osaka hit, then repaired.
    const pair = of('ENEMY_TELEGRAPH').filter((e) => e.atMs > 140_000 && e.atMs < 150_000);
    expect(pair.map((e) => e.data.telegraph.targets[0]).sort()).toEqual(['kanto', 'kinki']);
    const osaka = of('ATTACK_RESOLVED').find((e) => e.data.hits[0]?.cityId === 'kinki')!;
    expect(osaka.data.hits[0]!.damage).toBeGreaterThan(0);
    const repairs = of('TASK_RESOLVED').filter((e) => e.data.effect?.kind === 'REPAIR');
    expect(repairs.some((e) => JSON.stringify(e.data.effect).includes('kinki'))).toBe(true);
    expect(repairs.some((e) => JSON.stringify(e.data.effect).includes('FUJIN'))).toBe(true);

    // 4:40 NULL CORE; 6:50 the window; three seats; the special defeats it.
    const boss = of('ENEMY_SPAWNED').find((e) => e.data.enemy.kind === 'BOSS')!;
    expect(boss.atMs).toBe(280_000);
    const special = of('SPECIAL_RESOLVED')[0]!;
    expect(special.data.outcome).toBe('ACTIVATED');
    expect(special.data.contributors).toHaveLength(3);
    expect(special.atMs).toBeGreaterThanOrEqual(410_000);
    const bossDown = of('ENEMY_DEFEATED').find((e) => e.data.kind === 'BOSS')!;
    expect(bossDown.atMs).toBe(special.atMs);
    expect(state.result).toMatchObject({ outcome: 'SUCCEEDED', reason: 'BOSS_DEFEATED' });
    expect(state.result!.survivingCities).toBeGreaterThanOrEqual(6);
  });

  it('failure route: the special’s missions go untouched, it fails and Japan is not held', () => {
    const { state } = play('failure');
    expect(state.result!.special).toBe('FAILED');
    expect(state.result!.outcome).toBe('FAILED');
  });

  it('replays identically and leaves normal raids untouched', () => {
    const a = play('success').state;
    const b = play('success').state;
    expect(b.seq).toBe(a.seq);
    expect(b.result).toEqual(a.result);
    // The scripted targets live only in the scenario config.
    expect(scenarioConfig(EARTH_DEFENSE_OPENING).scriptedTargets).toHaveLength(5);
  });
});
