import { describe, expect, it } from 'vitest';
import { mulberry32, solveTask } from '@sats-wars/game-engine';
import { LocalRaid, PLAYER_ID } from './localRaid';

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function run(raid: LocalRaid, clock: ReturnType<typeof fakeClock>, ms: number) {
  for (let i = 0; i < ms / 100; i++) {
    clock.advance(100);
    raid.step();
  }
}

describe('LocalRaid (offline demo host)', () => {
  it('boards the player, runs a mission through the same engine, and finishes the raid', async () => {
    const clock = fakeClock();
    const raid = new LocalRaid({ callsign: 'テスト', crew: 6, botSkill: 0.7, speed: 1, seed: 7 }, clock.now);
    expect(raid.snapshot().status).toBe('LOBBY_OPEN');
    await raid.board('GUARDIAN');
    expect(raid.state.pilots[PLAYER_ID]?.role).toBe('GUARDIAN');
    run(raid, clock, 16_000);
    expect(raid.state.status).toBe('LIVE');
    expect(raid.snapshot().crew.length).toBe(7);

    // The cockpit path: request → play (solver) → submit.
    run(raid, clock, 20_000);
    const res = await raid.requestTask({});
    expect(res.code).toBe('OK');
    const input = solveTask(res.task!.params, 1, mulberry32(1), 900);
    const playMs = 'releaseAtMs' in input ? input.releaseAtMs : 1000;
    run(raid, clock, playMs + 100);
    const sub = await raid.submitTask(res.task!.taskId, input);
    expect(sub.result.ok).toBe(true);
    expect(sub.result.success).toBeGreaterThan(0);

    // Until the raid ends (boss down or time up), not past it: the demo loops on its own.
    for (let i = 0; i < 6000 && raid.state.status === 'LIVE'; i++) run(raid, clock, 100);
    expect(raid.state.status).toBe('ENDED');
    expect(raid.snapshot().result).not.toBeNull();
    expect(raid.state.pilots[PLAYER_ID]!.stats.tasks).toBeGreaterThanOrEqual(1);

    // Results, then a fresh lobby.
    run(raid, clock, 31_000);
    expect(raid.raids).toBe(2);
    expect(raid.snapshot().status).toBe('LOBBY_OPEN');
  });

  it('pausing freezes the raid clock', async () => {
    const clock = fakeClock();
    const raid = new LocalRaid({ callsign: 'P', crew: 2, botSkill: 0.7, speed: 1, seed: 3 }, clock.now);
    raid.launchNow();
    run(raid, clock, 1000);
    expect(raid.state.status).toBe('LIVE');
    const before = raid.state.gameMs;
    raid.setPaused(true);
    run(raid, clock, 10_000);
    expect(raid.state.status).toBe('PAUSED');
    expect(raid.gameNow()).toBe(before);
    raid.setPaused(false);
    run(raid, clock, 1000);
    expect(raid.state.gameMs).toBeGreaterThan(before);
    expect(raid.state.gameMs).toBeLessThan(before + 2000);
  });
});
