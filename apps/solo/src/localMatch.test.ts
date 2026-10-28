import { describe, expect, it } from 'vitest';
import { REGION_IDS } from '@sats-wars/shared';
import { LocalMatch, STARTING_CREDIT } from './localMatch';

function setup(crowd = 4) {
  let now = 0;
  const m = new LocalMatch({ nickname: 'テスト', crowd, seed: 7 }, () => now);
  m.start();
  const step = (ms: number) => {
    for (let i = 0; i < ms / 100; i++) {
      now += 100;
      m.tick();
    }
  };
  return { m, step, advance: (ms: number) => (now += ms) };
}

describe('LocalMatch (offline solo)', () => {
  it('simulated visitors defend until Japan falls, then a new campaign starts by itself', () => {
    const { m, step } = setup();
    expect(m.state.status).toBe('LIVE');
    let guard = 0;
    while (m.state.status !== 'FINISHED' && guard++ < 100_000) step(100);
    expect(m.state.status).toBe('FINISHED');
    expect(m.state.result?.reason).toBe('JAPAN_FALLEN');
    expect(m.state.wave).toBeGreaterThanOrEqual(2);
    step(m.state.config.nextCampaignDelayMs + 200);
    expect(m.campaigns).toBe(2);
    expect(m.state.status).toBe('LIVE');
  });

  it('with no crowd nothing happens until you move (no timers)', () => {
    const { m, step } = setup(0);
    const before = JSON.stringify(m.state.enemies);
    step(60_000);
    expect(JSON.stringify(m.state.enemies)).toBe(before);
    expect(m.state.actionsThisTurn).toBe(0);
  });

  it('a move costs 21 demo sats only when it does something', () => {
    const { m, advance } = setup(0);
    const empty = REGION_IDS.find((id) => !m.state.enemies.some((e) => e.regionId === id))!;
    expect(m.act('RAIJIN', empty)).toMatchObject({ ok: false, reason: 'REFUSED', result: { code: 'NO_TARGET' } });
    expect(m.creditSats).toBe(STARTING_CREDIT);
    advance(500);
    const r = m.act('AUTO');
    expect(r.ok).toBe(true);
    expect(m.creditSats).toBe(STARTING_CREDIT - 21);
    expect(m.act('AUTO')).toMatchObject({ ok: false, reason: 'TOO_FAST' });
    expect(m.state.actionsThisTurn).toBe(1);
  });

  it('running out of credit stops moves until a top-up', () => {
    const { m, advance } = setup(0);
    for (let i = 0; i < 10; i++) {
      advance(500);
      m.act('AUTO');
    }
    expect(m.creditSats).toBe(0);
    advance(500);
    expect(m.act('AUTO')).toMatchObject({ ok: false, reason: 'NO_CREDIT' });
    m.topup(105);
    advance(500);
    expect(m.act('AUTO').ok).toBe(true);
  });

  it('pause refuses moves for free', () => {
    const { m, advance } = setup(0);
    m.pause();
    advance(500);
    expect(m.act('AUTO')).toMatchObject({ ok: false, reason: 'REFUSED', result: { code: 'PAUSED' } });
    expect(m.creditSats).toBe(STARTING_CREDIT);
    m.resume();
    advance(500);
    expect(m.act('AUTO').ok).toBe(true);
  });
});
