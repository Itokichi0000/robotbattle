import { describe, expect, it } from 'vitest';
import { LocalMatch, PLAYER_ID } from './localMatch';

function run(speed = 1) {
  let now = 0;
  const m = new LocalMatch(
    { nickname: 'テスト', team: 'FUJIN', teamSize: 5, playerAp: 3, speed, seed: 7 },
    () => now,
  );
  m.start();
  const step = (ms: number) => {
    for (let i = 0; i < ms / 100; i++) {
      now += 100;
      m.tick();
    }
  };
  return { m, step };
}

describe('LocalMatch (offline solo)', () => {
  it('runs a full match with bots to FINISHED', () => {
    const { m, step } = run();
    expect(m.state.status).toBe('LOBBY');
    expect(m.state.teams.FUJIN.participantCount).toBe(5);
    expect(m.state.teams.RAIJIN.participantCount).toBe(5);
    step(7_000);
    expect(m.state.status).toBe('LIVE');
    step(310_000);
    expect(m.state.status).toBe('FINISHED');
    expect(m.state.clashes.length).toBeGreaterThan(0);
    expect(m.state.teams.RAIJIN.actionCount + m.state.teams.FUJIN.actionCount).toBeGreaterThan(10);
  });

  it('player actions use the engine rules (AP limit, invalid actions free)', () => {
    const { m, step } = run();
    expect(m.act('CHARGE', null).code).toBe('MATCH_NOT_LIVE');
    m.startNow();
    step(100);
    expect(m.act('DEFEND', 'kanto').code).toBe('NOT_OWN_REGION');
    const neutral = m.state.regionOrder.find((id) => m.state.regions[id].ownerTeamId === null);
    if (neutral) expect(m.act('ATTACK', neutral).ok).toBe(true);
    else expect(m.act('CHARGE', null).ok).toBe(true);
    m.act('CHARGE', null);
    m.act('CHARGE', null);
    expect(m.act('CHARGE', null).code).toBe('NO_AP');
    expect(m.state.participants[PLAYER_ID]!.apRemaining).toBe(0);
  });

  it('speed 2 finishes in half the wall time and pause freezes the clock', () => {
    const { m, step } = run(2);
    m.startNow();
    step(10_000);
    expect(Math.round(m.state.gameMs / 1000)).toBe(20);
    m.pause();
    step(30_000);
    expect(Math.round(m.state.gameMs / 1000)).toBe(20);
    m.resume();
    step(150_000);
    expect(m.state.status).toBe('FINISHED');
  });
});
