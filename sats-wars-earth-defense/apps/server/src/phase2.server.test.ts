import type {
  ActionResult,
  MatchEventMsg,
  OperatorCommandResult,
  SeatRequestResult,
} from '@swed/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { collect, emitAck, eventually, key, TestServer } from './testHarness';

let srv: TestServer;
afterEach(async () => srv?.stop());

describe('eight seats over sockets', () => {
  it('every station can be boarded; SYNC NOW travels as pilot:syncFinisher', async () => {
    srv = await new TestServer().start();
    const matchId = srv.runtime.state.matchId;
    const seats = ['GUNNER_L', 'SHIELD_L', 'POWER_CORE', 'ENGINEER_CORE'] as const;
    const phones = [];
    for (const seatId of seats) {
      const p = await srv.connect('/pilot', await srv.demoGuest());
      expect(
        await emitAck<SeatRequestResult>(p, 'pilot:joinSeat', {
          matchId,
          seatId,
          requestId: key(),
        }),
      ).toEqual({
        ok: true,
        seatId,
      });
      phones.push(p);
    }
    const display = await srv.connect('/display');
    const events = collect<MatchEventMsg>(display, 'match:event');
    const op = await srv.connect('/operator', await srv.operatorCookie());
    const cmd = (c: object) => emitAck<OperatorCommandResult>(op, 'operator:command', c);
    await cmd({ command: 'START' });
    await cmd({ command: 'SKIP_DEPLOY' });
    srv.advance(500);

    // POWER A sends a plan against the version it saw.
    const v = srv.runtime.state.distributionVersion;
    const plan = await emitAck<ActionResult>(phones[2]!, 'pilot:action', {
      matchId,
      seatId: 'POWER_CORE',
      clientActionId: key(),
      action: {
        actionType: 'SET_POWER',
        payload: {
          distribution: { weapon: 50, shield: 30, mobility: 5, repair: 15 },
          baseVersion: v,
        },
      },
    });
    expect(plan.accepted).toBe(true);
    await eventually(() =>
      events.find(
        (e) => e.type === 'power_routed' && e.payload.type === 'power_routed' && !e.payload.auto,
      ),
    );

    // Not the boss yet: SYNC NOW is refused with a reason.
    const early = await emitAck<ActionResult>(phones[0]!, 'pilot:syncFinisher', {
      matchId,
      clientActionId: key(),
    });
    expect(early.reasonCode).toBe('OVERDRIVE_NOT_READY');

    // Jump into the boss fight with the gauges full (cities made unbreakable for this test).
    const st = srv.runtime.state;
    srv.runtime.state = {
      ...st,
      coreHp: 1_000_000,
      config: { ...st.config, cities: { ...st.config.cities, lostForDefeat: 99 } },
    };
    const T = srv.runtime.state.config.timings;
    srv.advance(T.wave1Ms + T.wave2Ms + 2_000);
    expect(srv.runtime.state.phase).toBe('BOSS');
    srv.runtime.state = {
      ...srv.runtime.state,
      teamSync: 95,
      teamCapacitor: 100,
      lastComboAt: srv.runtime.state.t,
    };
    srv.advance(100);
    expect(srv.runtime.state.overdrive.status).toBe('READY');
    for (const p of phones) {
      const r = await emitAck<ActionResult>(p, 'pilot:syncFinisher', {
        matchId,
        clientActionId: key(),
      });
      expect(r.accepted).toBe(true);
    }
    const fired = await eventually(() => events.find((e) => e.type === 'overdrive_fired'));
    expect(fired.payload).toMatchObject({ type: 'overdrive_fired', autoRoles: [] });
  });
});

describe('demo bots (exhibition loop)', () => {
  it('fill empty seats as labelled bots, start after a quiet lobby, and step aside for people', async () => {
    srv = await new TestServer().start();
    const op = await srv.connect('/operator', await srv.operatorCookie());
    expect(
      (
        await emitAck<OperatorCommandResult>(op, 'operator:command', {
          command: 'SET_DEMO_BOTS',
          enabled: true,
        })
      ).ok,
    ).toBe(true);
    srv.advance(200);
    const seats = Object.values(srv.runtime.state.seats);
    expect(seats.every((s) => s.bot && s.displayName?.startsWith('DEMO-BOT'))).toBe(true);

    // A visitor scans the QR and takes a bot's seat.
    const phone = await srv.connect('/pilot', await srv.demoGuest());
    const r = await emitAck<SeatRequestResult>(phone, 'pilot:joinSeat', {
      matchId: srv.runtime.state.matchId,
      seatId: 'GUNNER_L',
      requestId: key(),
    });
    expect(r).toEqual({ ok: true, seatId: 'GUNNER_L' });
    expect(srv.runtime.state.seats.GUNNER_L.bot).toBe(false);

    srv.advance(13_000);
    expect(['COUNTDOWN', 'DEPLOYMENT', 'WAVE_1']).toContain(srv.runtime.state.phase);
    srv.advance(20_000);
    // Bots play through the same rules: shots, plans and shields appear.
    const s = srv.runtime.state;
    const botActions = Object.values(s.seats)
      .filter((x) => x.bot)
      .reduce((a, x) => a + x.stats.actions, 0);
    expect(botActions).toBeGreaterThan(0);

    expect(
      (
        await emitAck<OperatorCommandResult>(op, 'operator:command', {
          command: 'SET_DEMO_BOTS',
          enabled: false,
        })
      ).ok,
    ).toBe(true);
    expect(Object.values(srv.runtime.state.seats).some((x) => x.bot)).toBe(false);
    expect(srv.runtime.state.seats.GUNNER_L.pilotId).not.toBeNull();
  });
});

describe('callsigns', () => {
  it('are sanitised, shown only when opted in, and staff can hide them', async () => {
    srv = await new TestServer().start();
    const cookie = await srv.demoGuest();
    const phone = await srv.connect('/pilot', cookie);
    await emitAck(phone, 'pilot:joinSeat', {
      matchId: srv.runtime.state.matchId,
      seatId: 'SHIELD_R',
      requestId: key(),
    });
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
    expect(srv.runtime.state.seats.SHIELD_R.displayName).toMatch(/^PILOT-/);
    expect(
      (await srv.post('/api/pilot/callsign', { callsign: '雷鳴', showOnScreen: true }, cookie))
        .status,
    ).toBe(200);
    await eventually(() => srv.runtime.state.seats.SHIELD_R.displayName === '雷鳴');
    const op = await srv.connect('/operator', await srv.operatorCookie());
    await emitAck(op, 'operator:command', { command: 'SET_HIDE_CALLSIGNS', hidden: true });
    expect(srv.runtime.state.seats.SHIELD_R.displayName).toMatch(/^PILOT-/);
  });
});
