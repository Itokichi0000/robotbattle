import type { ActionResult, MatchEventMsg, OperatorCommandResult } from '@swed/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { collect, emitAck, eventually, key, TestServer } from './testHarness';

let srv: TestServer;
afterEach(async () => srv?.stop());

const people = () =>
  Object.values(srv.runtime.state.players).filter((p) => !p.bot && p.connected).length;

describe('a crowd over sockets', () => {
  it('twelve phones join with no seats; each one can press all three buttons', async () => {
    srv = await new TestServer().start();
    const phones = [];
    for (let i = 0; i < 12; i++) phones.push(await srv.connect('/pilot', await srv.demoGuest()));
    await eventually(() => people() === 12);
    expect(srv.runtime.snapshotMsg().state.players).toBe(12);
    const op = await srv.connect('/operator', await srv.operatorCookie());
    await emitAck(op, 'operator:command', { command: 'START' });
    await emitAck(op, 'operator:command', { command: 'SKIP_DEPLOY' });
    srv.advance(500);
    const matchId = srv.runtime.state.matchId;
    const kinds = ['ATTACK', 'DEFEND', 'REPAIR'] as const;
    const results = await Promise.all(
      phones.map((p, i) =>
        emitAck<ActionResult>(p, 'pilot:action', {
          matchId,
          clientActionId: key(),
          action: { kind: kinds[i % 3] },
        }),
      ),
    );
    expect(results.every((r) => r.accepted)).toBe(true);
    expect(srv.runtime.state.stats.free).toEqual({ ATTACK: 4, DEFEND: 4, REPAIR: 4 });
  });
});

describe('demo bots (exhibition loop)', () => {
  it('join the crowd as labelled bots, start the round by themselves, and leave on request', async () => {
    srv = await new TestServer({ MATCH_PRESET: 'TEST' }).start();
    srv.runtime.state.config.timings.lobbyAutoStartMs = 2_000;
    const display = await srv.connect('/display');
    const events = collect<MatchEventMsg>(display, 'match:event');
    const op = await srv.connect('/operator', await srv.operatorCookie());
    const cmd = (c: object) => emitAck<OperatorCommandResult>(op, 'operator:command', c);
    expect((await cmd({ command: 'SET_DEMO_BOTS', enabled: true })).ok).toBe(true);
    srv.advance(200);
    const bots = Object.values(srv.runtime.state.players).filter((p) => p.bot);
    expect(bots.length).toBe(srv.runtime.state.config.bots.count);
    expect(bots.every((b) => b.displayName.startsWith('DEMO-BOT'))).toBe(true);
    srv.advance(2_500 + 2_000);
    expect(srv.runtime.state.phase).toBe('BATTLE');
    srv.advance(5_000);
    expect(
      srv.runtime.state.stats.free.ATTACK +
        srv.runtime.state.stats.free.DEFEND +
        srv.runtime.state.stats.free.REPAIR,
    ).toBeGreaterThan(5);
    await eventually(() => events.some((e) => e.payload.type === 'action'));
    // People join alongside the bots.
    await srv.connect('/pilot', await srv.demoGuest());
    await eventually(() => people() === 1);
    expect((await cmd({ command: 'SET_DEMO_BOTS', enabled: false })).ok).toBe(true);
    expect(Object.values(srv.runtime.state.players).some((p) => p.bot)).toBe(false);
    expect(people()).toBe(1);
  });
});

describe('demo bots across matches', () => {
  it('keep tapping after RESET (their timers restart with the new match clock)', async () => {
    srv = await new TestServer({ MATCH_PRESET: 'TEST' }).start();
    const op = await srv.connect('/operator', await srv.operatorCookie());
    const cmd = (c: object) => emitAck<OperatorCommandResult>(op, 'operator:command', c);
    const taps = () => {
      const f = srv.runtime.state.stats.free;
      return f.ATTACK + f.DEFEND + f.REPAIR;
    };
    await cmd({ command: 'SET_DEMO_BOTS', enabled: true });
    srv.advance(200);
    await cmd({ command: 'START' });
    await cmd({ command: 'SKIP_DEPLOY' });
    srv.advance(30_000);
    expect(taps()).toBeGreaterThan(20);
    await cmd({ command: 'RESET' });
    srv.advance(200);
    await cmd({ command: 'START' });
    await cmd({ command: 'SKIP_DEPLOY' });
    srv.advance(5_000);
    expect(srv.runtime.state.phase).toBe('BATTLE');
    expect(taps()).toBeGreaterThan(5);
  });
});

describe('callsigns', () => {
  it('are sanitised, shown only when opted in, and staff can hide them', async () => {
    srv = await new TestServer().start();
    const cookie = await srv.demoGuest();
    await srv.connect('/pilot', cookie);
    await eventually(() => people() === 1);
    const me = () => Object.values(srv.runtime.state.players)[0]!;
    expect(
      (await srv.post('/api/pilot/callsign', { callsign: '<script>', showOnScreen: true }, cookie))
        .status,
    ).toBe(400);
    expect(
      (
        await srv.post(
          '/api/pilot/callsign',
          { callsign: 'ＲＡＩＤＥＮ', showOnScreen: false },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(me().displayName).toMatch(/^PILOT-/);
    expect(
      (await srv.post('/api/pilot/callsign', { callsign: '雷鳴', showOnScreen: true }, cookie))
        .status,
    ).toBe(200);
    await eventually(() => me().displayName === '雷鳴');
    const op = await srv.connect('/operator', await srv.operatorCookie());
    await emitAck(op, 'operator:command', { command: 'SET_HIDE_CALLSIGNS', hidden: true });
    expect(me().displayName).toMatch(/^PILOT-/);
  });
});
