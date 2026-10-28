import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '@sats-wars/shared';
import { mulberry32, solveTask } from '@sats-wars/game-engine';
import { FakeClock } from '../src/clock';
import { type PilotHandle, type TestServer, admin, auth, board, guest, makeServer, requestTask, startRaid, submitTask, tempDbPath } from './helpers';

let s: TestServer | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

const DEMO = { DEMO_MODE: 'true' };
const PAID = { PASS_MODE: 'PAID' };

/** Request a mission, solve it perfectly, wait the play time, submit. */
async function playOnce(srv: TestServer, p: PilotHandle, choice: Record<string, unknown> = {}) {
  const r = await requestTask(srv, p, choice);
  expect(r.statusCode).toBe(200);
  const body = r.json() as { code: string; task: Task | null };
  if (body.code !== 'OK' || !body.task) return { code: body.code, result: null };
  const input = solveTask(body.task.params, 1, mulberry32(1), 700);
  const wait = 'stopAtMs' in input ? input.stopAtMs : 'releaseAtMs' in input ? input.releaseAtMs : 1500;
  await srv.advance(wait + 100);
  const sub = await submitTask(srv, p, body.task.taskId, input);
  expect(sub.statusCode).toBe(200);
  return { code: 'OK', result: sub.json().result, task: body.task, input };
}

describe('server basics', () => {
  it('health and the public raid snapshot (lobby open, demo labelled)', async () => {
    s = await makeServer({ env: DEMO });
    expect((await s.inject({ url: '/healthz' })).json()).toEqual({ ok: true });
    expect((await s.inject({ url: '/readyz' })).statusCode).toBe(200);
    const snap = (await s.inject({ url: '/api/public/current-raid' })).json().snapshot;
    expect(snap).toMatchObject({ status: 'LOBBY_OPEN', phase: 'LOBBY', joinOpen: true, passMode: 'FREE', demoMode: true, ticketPriceSats: 21 });
    expect(snap.crew).toEqual([]);
  });

  it('guest pilots: cookie session (HttpOnly), device reuse, sanitised callsign, consent-based names', async () => {
    s = await makeServer({ env: DEMO });
    const res = await s.inject({ method: 'POST', url: '/api/auth/guest', payload: { callsign: '<b>たろう</b>', deviceId: 'device-123456' } });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/sw_session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax/);
    const pilot = res.json().pilot;
    expect(pilot.callsign).toBe('bたろう/b');
    expect(pilot.authType).toBe('GUEST');
    const again = await guest(s, { deviceId: 'device-123456' });
    expect(again.pilotId).toBe(pilot.pilotId);
    // Cookie works for reads; a cookie-authenticated POST needs an allowed Origin (CSRF guard).
    const sessionCookie = cookie.split(';')[0]!;
    expect((await s.inject({ url: '/api/me', headers: { cookie: sessionCookie } })).statusCode).toBe(200);
    expect((await s.inject({ method: 'PATCH', url: '/api/me', headers: { cookie: sessionCookie }, payload: { avatar: 'aero' } })).statusCode).toBe(403);
    const ok = await s.inject({ method: 'PATCH', url: '/api/me', headers: { cookie: sessionCookie, origin: 'http://localhost:3000' }, payload: { avatar: 'aero' } });
    expect(ok.json().pilot.avatar).toBe('aero');
    // Names on the venue screen: pseudonym unless the pilot opts in.
    const p = { pilotId: pilot.pilotId, token: again.token, callsign: pilot.callsign };
    await board(s, p, 'GUNNER');
    const crew = (await s.inject({ url: '/api/public/current-raid' })).json().snapshot.crew;
    expect(crew[0].callsign).toMatch(/^PILOT-\d{5}$/);
    await s.inject({ method: 'PATCH', url: '/api/me', headers: auth(p.token), payload: { showNameOnArena: true } });
    expect(s.services.manager.snapshot().crew[0]!.callsign).toBe('bたろう/b');
  });
});

describe('raid flow (free event)', () => {
  it('board → missions → idempotent submit → SYNC; 4 seats on two robots', async () => {
    s = await makeServer({ env: DEMO });
    const pilots: PilotHandle[] = [];
    for (const [i, role] of ['GUNNER', 'GUARDIAN', 'ROUTER', 'ENGINEER'].entries()) {
      const p = await guest(s, { deviceId: `dev-${i}-xxxxxxxx` });
      const b = await board(s, p, role);
      expect(b.statusCode).toBe(200);
      expect(b.json().entitlementSource).toBe('FREE');
      pilots.push(p);
    }
    const st0 = s.services.manager.current().state;
    expect(st0.pilots[pilots[0]!.pilotId]!.robot).toBe('RAIJIN');
    expect(st0.pilots[pilots[1]!.pilotId]!.robot).toBe('FUJIN');
    // Missions before the raid starts are refused (nothing to do yet).
    expect((await requestTask(s, pilots[0]!)).json().code).toBe('NOT_LIVE');
    await startRaid(s);
    await s.advance(8000);
    const g = await playOnce(s, pilots[0]!);
    expect(g.result).toMatchObject({ ok: true, success: 1, effect: { kind: 'DAMAGE' } });
    // Same clientSubmissionId again → stored result, no second effect.
    const r2 = await requestTask(s, pilots[1]!);
    const t2 = r2.json().task as Task;
    const in2 = solveTask(t2.params, 1, mulberry32(2), 700);
    await s.advance(('releaseAtMs' in in2 ? in2.releaseAtMs : 1000) + 100);
    const first = await submitTask(s, pilots[1]!, t2.taskId, in2, 'dup-submission-1');
    const second = await submitTask(s, pilots[1]!, t2.taskId, in2, 'dup-submission-1');
    expect(first.json().duplicate).toBe(false);
    expect(second.json()).toEqual({ result: first.json().result, duplicate: true });
    expect(s.services.manager.current().state.sync).toBeGreaterThan(0);
    // The client never sends damage: malformed input is rejected by the schema.
    const r3 = await requestTask(s, pilots[2]!);
    const bad = await s.inject({
      method: 'POST',
      url: '/api/raids/current/tasks/submit',
      headers: auth(pilots[2]!.token),
      payload: { taskId: r3.json().task.taskId, clientSubmissionId: 'bad-input-1', input: { role: 'ROUTER', path: 'all' } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('seat change cooldown; boarding closes at 4:00; raid ends and pilots get passports; next lobby opens', async () => {
    s = await makeServer({ env: DEMO });
    const a = await guest(s, { deviceId: 'dev-a-xxxxxxxx' });
    await board(s, a, 'GUNNER');
    await startRaid(s);
    await s.advance(8000);
    await playOnce(s, a);
    expect((await s.inject({ method: 'POST', url: '/api/raids/current/change-role', headers: auth(a.token), payload: { role: 'ROUTER' } })).statusCode).toBe(200);
    expect((await s.inject({ method: 'POST', url: '/api/raids/current/change-role', headers: auth(a.token), payload: { role: 'GUNNER' } })).statusCode).toBe(429);
    await s.advance(235_000);
    const late = await guest(s, { deviceId: 'dev-late-xxxxxx' });
    const lb = await board(s, late, 'GUNNER');
    expect(lb.json().error).toBe('JOIN_CLOSED');
    const token = await s.adminToken();
    if (s.services.manager.current().state.status === 'LIVE') await admin(s, token, { command: 'END', reason: 'test' });
    const st = s.services.manager.current().state;
    expect(st.status).toBe('ENDED');
    expect(st.result!.outcome).toBe('FAILED');
    const passport = (await s.inject({ url: '/api/me/passport', headers: auth(a.token) })).json();
    expect(passport.pilot.sorties).toBe(1);
    expect(passport.history[0]).toMatchObject({ raidId: st.raidId, outcome: 'FAILED' });
    expect(passport.pilot.titles).toContain('FIRST_SORTIE');
    const results = (await s.inject({ url: `/api/raids/${st.raidId}/results` })).json();
    expect(results.result.score.total).toBeGreaterThanOrEqual(0);
    await s.advance(31_000);
    expect(s.services.manager.current().raidId).not.toBe(st.raidId);
    expect(s.services.manager.current().state.status).toBe('LOBBY_OPEN');
  });

  it('the lobby starts by itself once someone boarded and the lobby time passed', async () => {
    s = await makeServer({ env: DEMO });
    await s.advance(70_000);
    expect(s.services.manager.current().state.status).toBe('LOBBY_OPEN');
    const a = await guest(s);
    await board(s, a, 'GUARDIAN');
    await s.advance(200);
    expect(s.services.manager.snapshot().lobbyEndsAt).not.toBeNull();
    await s.advance(21_000);
    expect(s.services.manager.current().state.status).toBe('LIVE');
  });
});

describe('raid passes (21 sats)', () => {
  it('no pass → 402; Lightning pass after verified payment; the payment never changes the pilot', async () => {
    s = await makeServer({ env: PAID });
    const a = await guest(s);
    const b0 = await board(s, a, 'GUNNER');
    expect(b0.statusCode).toBe(402);
    expect(b0.json().error).toBe('PASS_REQUIRED');
    const inv = await s.inject({ method: 'POST', url: '/api/raids/current/pass/invoice', headers: auth(a.token) });
    expect(inv.json()).toMatchObject({ amountSats: 21, status: 'PENDING', paymentMode: 'mock' });
    expect(inv.json().bolt11).toContain('NOT-A-REAL-INVOICE');
    // Until the payment is verified nothing is granted.
    expect((await board(s, a, 'GUNNER')).statusCode).toBe(402);
    const paid = await s.inject({ method: 'POST', url: '/api/dev/mock-pay', headers: auth(a.token), payload: { invoiceId: inv.json().invoiceId } });
    expect(paid.json()).toMatchObject({ status: 'PAID', entitled: true });
    expect((await board(s, a, 'GUNNER')).json().entitlementSource).toBe('LIGHTNING');
    // Sponsored pilot: same seat, identical engine pilot (no payment info inside the game).
    const token = await s.adminToken();
    const codes = (await s.inject({ method: 'POST', url: '/api/admin/sponsored-passes', headers: auth(token), payload: { count: 2 } })).json().codes;
    const b = await guest(s);
    expect((await s.inject({ method: 'POST', url: '/api/raids/current/pass/sponsored', headers: auth(b.token), payload: { code: codes[0] } })).statusCode).toBe(200);
    expect((await board(s, b, 'GUNNER')).json().entitlementSource).toBe('SPONSORED');
    const st = s.services.manager.current().state;
    const strip = (x: object) => JSON.parse(JSON.stringify(x, (k, v) => (['pilotId', 'callsign'].includes(k) ? undefined : v)));
    expect(strip(st.pilots[a.pilotId]!)).toEqual(strip(st.pilots[b.pilotId]!));
    // A used code fails; a second pass for the same raid is refused without consuming the code.
    expect((await s.inject({ method: 'POST', url: '/api/raids/current/pass/sponsored', headers: auth(b.token), payload: { code: codes[0] } })).json().error).toBe('INVALID_PASS');
    expect((await s.inject({ method: 'POST', url: '/api/raids/current/pass/sponsored', headers: auth(a.token), payload: { code: codes[1] } })).json().error).toBe('ALREADY_ENTITLED');
  });

  it('late payment becomes a pass credit for the next raid (never forfeited)', async () => {
    s = await makeServer({ env: PAID });
    const a = await guest(s);
    const inv = (await s.inject({ method: 'POST', url: '/api/raids/current/pass/invoice', headers: auth(a.token) })).json();
    const token = await s.adminToken();
    await admin(s, token, { command: 'NEXT_RAID' });
    // The wallet pays after the raid it was for is gone.
    await s.inject({ method: 'POST', url: '/api/dev/mock-pay', headers: auth(a.token), payload: { invoiceId: inv.invoiceId } });
    const me = (await s.inject({ url: '/api/me', headers: auth(a.token) })).json();
    expect(me.passCredits).toBe(1);
    expect(me.seat.entitled).toBe(false);
    expect((await board(s, a, 'ROUTER')).json().entitlementSource).toBe('CREDIT');
    expect((await s.inject({ url: '/api/me', headers: auth(a.token) })).json().passCredits).toBe(0);
  });

  it('no invoice close to the boarding cutoff; operators can stop paid invoices and boarding', async () => {
    s = await makeServer({ env: PAID });
    const token = await startRaid(s);
    await s.advance(200_000);
    const a = await guest(s);
    expect((await s.inject({ method: 'POST', url: '/api/raids/current/pass/invoice', headers: auth(a.token) })).json().error).toBe('JOIN_CLOSED');
    if (s.services.manager.current().state.status === 'LIVE') await admin(s, token, { command: 'END' });
    await admin(s, token, { command: 'NEXT_RAID' });
    await admin(s, token, { command: 'SET_PAYMENTS_ENABLED', enabled: false });
    expect((await s.inject({ method: 'POST', url: '/api/raids/current/pass/invoice', headers: auth(a.token) })).json().error).toBe('PAYMENTS_DISABLED');
    await admin(s, token, { command: 'SET_PASS_MODE', mode: 'FREE' });
    await admin(s, token, { command: 'SET_JOIN_STOPPED', stopped: true });
    expect((await board(s, a, 'GUNNER')).json().error).toBe('JOIN_CLOSED');
    await admin(s, token, { command: 'SET_JOIN_STOPPED', stopped: false });
    expect((await board(s, a, 'GUNNER')).statusCode).toBe(200);
  });
});

describe('operations', () => {
  it('admin: auth required, names hidden, broadcast, emergency stop, audit; time scale only in demo', async () => {
    s = await makeServer({ env: DEMO });
    expect((await s.inject({ method: 'POST', url: '/api/admin/command', payload: { command: 'START' } })).statusCode).toBe(401);
    const token = await s.adminToken();
    const a = await guest(s, { callsign: 'たろう' });
    await s.inject({ method: 'PATCH', url: '/api/me', headers: auth(a.token), payload: { showNameOnArena: true } });
    await board(s, a, 'GUNNER');
    expect(s.services.manager.snapshot().crew[0]!.callsign).toBe('たろう');
    await admin(s, token, { command: 'SET_NAMES_HIDDEN', hidden: true });
    expect(s.services.manager.snapshot().crew[0]!.callsign).toMatch(/^PILOT-/);
    await admin(s, token, { command: 'BROADCAST', template: 'NEXT_RAID_SOON', seconds: 30 });
    expect(s.services.manager.snapshot().broadcast?.messageJa).toContain('次の作戦');
    await admin(s, token, { command: 'BROADCAST', template: 'CUSTOM', ja: '<script>x</script>休憩', seconds: 10 });
    expect(s.services.manager.snapshot().broadcast?.messageJa).toBe('scriptx/script休憩');
    await admin(s, token, { command: 'SET_TIME_SCALE', speed: 10 });
    await startRaid(s);
    await admin(s, token, { command: 'EMERGENCY_STOP' });
    const st = s.services.manager.snapshot();
    expect(st.status).toBe('PAUSED');
    expect(st.joinOpen).toBe(false);
    expect(st.paymentsEnabled).toBe(false);
    const audit = (await s.inject({ url: '/api/admin/audit', headers: auth(token) })).json().entries.map((e: { action: string }) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['EMERGENCY_STOP', 'SET_NAMES_HIDDEN', 'BROADCAST', 'SET_TIME_SCALE', 'START']));

    const prod = await makeServer({ env: PAID });
    const t2 = await prod.adminToken();
    const r = await prod.inject({ method: 'POST', url: '/api/admin/command', headers: auth(t2), payload: { command: 'SET_TIME_SCALE', speed: 10 } });
    expect(r.statusCode).toBe(403);
    await prod.close();
  });

  it('restart: the raid is rebuilt from the command log, paused, then resumed by itself', async () => {
    const dbPath = tempDbPath();
    const clock = new FakeClock();
    s = await makeServer({ env: DEMO, dbPath, clock });
    const a = await guest(s);
    await board(s, a, 'GUNNER');
    await startRaid(s);
    await s.advance(8000);
    await playOnce(s, a);
    await s.advance(5000);
    const before = s.services.manager.current().state;
    await s.close();
    s = await makeServer({ env: DEMO, dbPath, clock });
    const after = s.services.manager.current().state;
    expect(after.raidId).toBe(before.raidId);
    expect(after.status).toBe('PAUSED');
    expect(after.pauseReason).toBe('SERVER_RESTART');
    expect(after.pilots[a.pilotId]!.stats).toEqual(before.pilots[a.pilotId]!.stats);
    expect(after.enemies.map((e) => e.hp)).toEqual(before.enemies.map((e) => e.hp));
    await s.advance(10_500);
    expect(s.services.manager.current().state.status).toBe('LIVE');
  });

  it('demo bots board, play and keep their raid off the leaderboard', async () => {
    s = await makeServer({ env: { ...DEMO, DEMO_BOTS: '6' } });
    await s.advance(500);
    const st = s.services.manager.current().state;
    expect(Object.values(st.pilots).filter((p) => p.isBot)).toHaveLength(6);
    await startRaid(s);
    await s.advance(60_000);
    expect(s.services.manager.current().state.stats.tasks).toBeGreaterThan(5);
    const token = await s.adminToken();
    await admin(s, token, { command: 'END' });
    expect((await s.inject({ url: '/api/leaderboard' })).json().raids).toHaveLength(0);
  });
});
