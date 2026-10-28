import { describe, expect, it } from 'vitest';
import { LocalMatch, STARTING_CREDIT } from './localMatch';

function setup(crowd = 4) {
  let now = 0;
  const m = new LocalMatch({ nickname: 'テスト', team: 'FUJIN', crowd, seed: 7 }, () => now);
  m.start();
  const step = (ms: number) => {
    for (let i = 0; i < ms / 100; i++) {
      now += 100;
      m.tick();
    }
  };
  const untilRound = () => {
    let n = 0;
    while (m.state.phase !== 'ROUND' && n++ < 2000) step(100);
  };
  return { m, step, untilRound, advance: (ms: number) => (now += ms) };
}

describe('LocalMatch (offline solo)', () => {
  it('bots fight a whole season of 8 rounds, then a new season starts by itself', () => {
    const { m, step } = setup();
    expect(m.state.status).toBe('LIVE');
    let guard = 0;
    while (m.state.status !== 'FINISHED' && guard++ < 20_000) step(100);
    expect(m.state.status).toBe('FINISHED');
    expect(m.state.rounds).toHaveLength(8);
    expect(m.state.result).not.toBeNull();
    step(m.state.config.nextSeasonDelayMs + 200);
    expect(m.seasons).toBe(2);
    expect(m.state.status).toBe('LIVE');
  });

  it('a tap costs 21 demo sats only when it lands', () => {
    const { m, untilRound, advance } = setup(0);
    expect(m.punch()).toMatchObject({ ok: false, reason: 'NOT_FIGHTING' });
    expect(m.creditSats).toBe(STARTING_CREDIT);
    untilRound();
    advance(300);
    const r = m.punch();
    expect(r).toMatchObject({ ok: true, result: { code: 'HIT', teamId: 'FUJIN', damage: 10 } });
    expect(m.creditSats).toBe(STARTING_CREDIT - 21);
    expect(m.punch()).toMatchObject({ ok: false, reason: 'TOO_FAST' });
    expect(m.state.round!.hp.RAIJIN).toBe(m.state.round!.hpMax - 10);
  });

  it('running out of credit stops punches until a top-up', () => {
    const { m, untilRound, advance } = setup(0);
    untilRound();
    for (let i = 0; i < 10; i++) {
      advance(300);
      m.punch();
    }
    expect(m.creditSats).toBe(0);
    advance(300);
    expect(m.punch()).toMatchObject({ ok: false, reason: 'NO_CREDIT' });
    m.topup(105);
    advance(300);
    expect(m.punch().ok).toBe(true);
  });

  it('pause freezes the round clock', () => {
    const { m, step, untilRound } = setup(0);
    untilRound();
    const left = m.secondsLeft();
    m.pause();
    step(10_000);
    m.resume();
    expect(m.secondsLeft()).toBe(left);
  });
});
