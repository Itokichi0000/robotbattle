import { afterEach, describe, expect, it } from 'vitest';
import type { GameEvent, RegionId } from '@sats-wars/shared';
import { REGION_IDS } from '@sats-wars/shared';
import {
  type TestServer,
  act,
  admin,
  auth,
  fundedPlayer,
  join,
  makeServer,
  mockPay,
  tempDbPath,
  topup,
} from './helpers';

let s: TestServer | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

const credit = (srv: TestServer, playerId: string) => srv.services.repo.getPlayer(playerId)!.credit_sats;
const state = (srv: TestServer) => srv.services.manager.current().state;
const emptyRegion = (srv: TestServer): RegionId =>
  REGION_IDS.find((id) => !state(srv).enemies.some((e) => e.regionId === id) && !state(srv).regions[id].fallen)!;

describe('EARTH DEFENSE server flow', () => {
  it('starts a campaign by itself with aliens on the map; joining is free and team-less', async () => {
    s = await makeServer();
    const snap = s.services.manager.snapshot();
    expect(snap.status).toBe('LIVE');
    expect(snap.wave).toBe(1);
    expect(snap.enemies.length).toBeGreaterThan(0);
    expect(snap.regions).toHaveLength(8);
    const p = await join(s);
    expect(p).toMatchObject({ creditSats: 0 });
    expect(p.nickname).toMatch(/^隊員/);
    const me = (await s.inject({ url: '/api/me', headers: auth(p.token) })).json();
    expect(me).toMatchObject({ creditSats: 0, actionsThisCampaign: 0, kills: 0 });
    expect(s.services.manager.snapshot().playersOnline).toBe(1);
  });

  it('nothing moves while nobody acts: time alone never advances the aliens', async () => {
    s = await makeServer();
    const before = s.services.manager.snapshot();
    await s.advance(5 * 60_000);
    const after = s.services.manager.snapshot();
    expect(after.lastSeq).toBe(before.lastSeq);
    expect(after.regions).toEqual(before.regions);
  });

  it('an action without credit is refused and changes nothing', async () => {
    s = await makeServer();
    const p = await join(s);
    const before = s.services.manager.snapshot().lastSeq;
    const res = await act(s, p.token);
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toBe('INSUFFICIENT_CREDIT');
    expect(s.services.manager.snapshot().lastSeq).toBe(before);
  });

  it('top-up: only the offered amounts, credited once after verification', async () => {
    s = await makeServer();
    const p = await join(s);
    expect((await topup(s, p.token, 100)).statusCode).toBe(400);
    const inv = (await topup(s, p.token, 210)).json();
    expect(inv).toMatchObject({ amountSats: 210, actions: 10, status: 'PENDING', paymentMode: 'mock' });
    expect(inv.bolt11).toContain('NOT-A-REAL-INVOICE');
    expect((await topup(s, p.token, 210)).json().invoiceId).toBe(inv.invoiceId);
    expect((await mockPay(s, p.token, inv.invoiceId)).json()).toMatchObject({ status: 'PAID', creditSats: 210 });
    expect((await mockPay(s, p.token, inv.invoiceId)).json()).toMatchObject({ status: 'PAID', creditSats: 210 });
    expect(credit(s, p.playerId)).toBe(210);
    const other = await join(s, { deviceId: 'other-device-0001' });
    expect((await s.inject({ url: `/api/topups/${inv.invoiceId}`, headers: auth(other.token) })).statusCode).toBe(404);
  });

  it('おすすめ action costs 21 sats, hits an alien and shows the name; retries and refusals are free', async () => {
    s = await makeServer();
    const p = await fundedPlayer(s, 210, 'たろう');
    const res = await act(s, p.token, { clientActionId: 'tap-00000001' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ duplicate: false, creditSats: 189 });
    expect(body.result).toMatchObject({ ok: true, code: 'OK' });
    expect(body.result.damage).toBeGreaterThan(0);
    const snap = s.services.manager.snapshot();
    const ev = snap.recentEvents.find((e) => e.type === 'PLAYER_ACTION') as Extract<GameEvent, { type: 'PLAYER_ACTION' }>;
    expect(ev.data).toMatchObject({ nickname: 'たろう', auto: true });
    expect(snap.actionsThisTurn).toBe(1);
    // Same clientActionId again: answered from storage, not charged.
    s.clock.advance(500);
    expect((await act(s, p.token, { clientActionId: 'tap-00000001' })).json()).toMatchObject({ duplicate: true, creditSats: 189 });
    // Tapping faster than the cooldown is refused (and free).
    s.clock.advance(500);
    await act(s, p.token);
    expect((await act(s, p.token)).statusCode).toBe(429);
    // Hitting an empty region is a free no-op, and not written to the command log.
    s.clock.advance(500);
    const logBefore = s.services.repo.loadCommands(state(s).matchId).length;
    const miss = (await act(s, p.token, { action: 'RAIJIN', regionId: emptyRegion(s) })).json();
    expect(miss).toMatchObject({ result: { ok: false, code: 'NO_TARGET' }, creditSats: 168 });
    expect(s.services.repo.loadCommands(state(s).matchId)).toHaveLength(logBefore);
  });

  it('every N actions (from any players) the aliens take their turn', async () => {
    s = await makeServer({ env: { ACTIONS_PER_TURN: '3' } });
    const a = await fundedPlayer(s, 210, 'a');
    const b = await fundedPlayer(s, 210, 'b');
    const quiet = emptyRegion(s);
    // Barriers in a quiet region keep the aliens' numbers predictable.
    await act(s, a.token, { action: 'SHIELD', regionId: quiet });
    s.clock.advance(500);
    await act(s, b.token, { action: 'AUTO' });
    expect(state(s).stats.alienTurns).toBe(0);
    s.clock.advance(500);
    const third = (await act(s, a.token, { action: 'AUTO' })).json();
    expect(third.result.triggeredAlienTurn).toBe(true);
    expect(state(s).stats.alienTurns).toBe(1);
    expect(state(s).actionsThisTurn).toBe(0);
    expect(s.services.manager.snapshot().recentEvents.some((e) => e.type === 'ALIEN_TURN')).toBe(true);
  });

  it('a full campaign with demo defenders ends with Japan falling, keeps a record and loops into a new one', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    await admin(s, token, { command: 'SET_DEMO_BOTS', count: 12 });
    const first = state(s).matchId;
    let waited = 0;
    while (state(s).status !== 'FINISHED') {
      await s.advance(2000);
      waited += 2000;
      expect(waited).toBeLessThan(60 * 60_000);
    }
    const done = s.services.manager.snapshot();
    expect(done.result).toMatchObject({ reason: 'JAPAN_FALLEN' });
    expect(done.regions.filter((r) => r.fallen).length).toBeGreaterThanOrEqual(done.config.fallLimit);
    expect(s.services.repo.invoiceSummary()).toEqual({});
    const saved = (await s.inject({ url: `/api/matches/${first}/snapshot` })).json();
    expect(saved.snapshot.status).toBe('FINISHED');
    await admin(s, token, { command: 'SET_DEMO_BOTS', count: 0 });
    await s.advance(done.config.nextCampaignDelayMs + 500);
    const next = s.services.manager.snapshot();
    expect(next.matchId).not.toBe(first);
    expect(next.status).toBe('LIVE');
    expect(next.wave).toBe(1);
    expect(next.bestWave).toBe(done.wave);
  }, 60_000);

  it('credit carries over between campaigns and survives a lost browser tab (same device)', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    const p = await join(s, { deviceId: 'device-abc-123' });
    const inv = (await topup(s, p.token, 105)).json();
    await mockPay(s, p.token, inv.invoiceId);
    await admin(s, token, { command: 'CANCEL' });
    await admin(s, token, { command: 'NEXT_MATCH' });
    const again = await join(s, { deviceId: 'device-abc-123' });
    expect(again).toMatchObject({ playerId: p.playerId, creditSats: 105 });
    expect(again.token).not.toBe(p.token);
    expect((await s.inject({ url: '/api/me', headers: auth(p.token) })).statusCode).toBe(401);
  });

  it('late payment (paid at the edge, seen after expiry) still becomes credit', async () => {
    s = await makeServer();
    const p = await join(s);
    const inv = (await topup(s, p.token, 105)).json();
    const row = s.services.repo.getInvoice(inv.invoiceId)!;
    const adapter = s.services.adapter as import('../src/payments/mock').MockPaymentAdapter;
    s.clock.advance(row.expires_at - s.clock.now() + 1000);
    adapter.markPaid(row.lnbits_checking_id, { ignoreExpiry: true });
    await s.services.players.pollPending();
    expect(s.services.repo.getInvoice(inv.invoiceId)!.status).toBe('PAID');
    expect(credit(s, p.playerId)).toBe(105);
  });

  it('unpaid invoices expire without side effects; provider outages retry', async () => {
    s = await makeServer();
    const p = await join(s);
    const inv = (await topup(s, p.token, 105)).json();
    s.clock.advance(30 * 60_000);
    await s.services.players.pollPending();
    expect(s.services.repo.getInvoice(inv.invoiceId)!.status).toBe('EXPIRED');
    const inv2 = (await topup(s, p.token, 210)).json();
    const adapter = s.services.adapter as import('../src/payments/mock').MockPaymentAdapter;
    adapter.markPaid(s.services.repo.getInvoice(inv2.invoiceId)!.lnbits_checking_id);
    adapter.failChecks = true;
    await s.services.players.pollPending();
    expect(s.services.repo.getInvoice(inv2.invoiceId)).toMatchObject({ status: 'PENDING', check_failures: 1 });
    adapter.failChecks = false;
    await s.services.players.pollPending();
    expect(credit(s, p.playerId)).toBe(210);
  });

  it('credit codes add credit once, even while Lightning top-ups are paused', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    const issued = await s.inject({ method: 'POST', url: '/api/admin/passes', headers: auth(token), payload: { count: 2, amountSats: 105 } });
    const { codes } = issued.json() as { codes: string[] };
    await admin(s, token, { command: 'SET_PAYMENTS_ENABLED', enabled: false });
    const p = await join(s);
    expect((await topup(s, p.token, 105)).statusCode).toBe(503);
    const redeem = (code: string) => s!.inject({ method: 'POST', url: '/api/codes/redeem', headers: auth(p.token), payload: { code } });
    expect((await redeem(codes[0]!.toLowerCase())).json()).toEqual({ addedSats: 105, creditSats: 105 });
    expect((await redeem(codes[0]!)).statusCode).toBe(400);
    expect(credit(s, p.playerId)).toBe(105);
  });

  it('free cheers are rate limited and never touch credit', async () => {
    s = await makeServer();
    const p = await join(s);
    const cheer = () => s!.inject({ method: 'POST', url: '/api/cheer', headers: auth(p.token), payload: { emoji: '🔥' } });
    expect((await cheer()).statusCode).toBe(200);
    expect((await cheer()).statusCode).toBe(429);
    s.clock.advance(1000);
    expect((await cheer()).statusCode).toBe(200);
    expect(credit(s, p.playerId)).toBe(0);
  });

  it('hidden nicknames are masked on public screens', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    const p = await fundedPlayer(s, 105, 'NGネーム');
    await s.inject({
      method: 'POST',
      url: `/api/admin/players/${p.playerId}/nickname-visibility`,
      headers: auth(token),
      payload: { hidden: true },
    });
    await act(s, p.token);
    expect(JSON.stringify(s.services.manager.snapshot())).not.toContain('NGネーム');
  });

  it('admin API needs a session and checks Origin; emergency stop halts everything', async () => {
    s = await makeServer({ env: { ALLOWED_ORIGINS: 'http://localhost:3000' } });
    expect((await s.inject({ url: '/api/admin/overview' })).statusCode).toBe(401);
    const bad = await s.inject({ method: 'POST', url: '/api/admin/login', headers: { origin: 'https://evil.example' }, payload: { password: 'x' } });
    expect(bad.statusCode).toBe(403);
    const token = await s.adminToken();
    const p = await fundedPlayer(s, 105);
    await admin(s, token, { command: 'EMERGENCY_STOP' });
    const ov = (await s.inject({ url: '/api/admin/overview', headers: auth(token) })).json();
    expect(ov).toMatchObject({ paymentsEnabled: false, autoLoop: false, snapshot: { status: 'PAUSED' } });
    expect((await act(s, p.token)).json()).toMatchObject({ result: { ok: false, code: 'PAUSED' }, creditSats: 105 });
  });

  it('staff credit adjustments are audited and cannot go negative', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    const p = await join(s);
    const add = await s.inject({ method: 'POST', url: `/api/admin/players/${p.playerId}/credit`, headers: auth(token), payload: { deltaSats: 105, note: 'LNbitsで入金確認済み' } });
    expect(add.json()).toEqual({ creditSats: 105 });
    const neg = await s.inject({ method: 'POST', url: `/api/admin/players/${p.playerId}/credit`, headers: auth(token), payload: { deltaSats: -500, note: 'oops' } });
    expect(neg.statusCode).toBe(400);
    const audit = (await s.inject({ url: '/api/admin/audit', headers: auth(token) })).json();
    expect(audit.entries[0]).toMatchObject({ action: 'ADJUST_CREDIT', target_id: p.playerId });
  });

  it('restart: the campaign comes back paused with the same board, then auto-resumes', async () => {
    const dbPath = tempDbPath();
    s = await makeServer({ dbPath });
    const p = await fundedPlayer(s, 210);
    await act(s, p.token);
    const before = s.services.manager.snapshot();
    const clock = s.clock;
    await s.close();
    clock.advance(5000);
    s = await makeServer({ dbPath, clock });
    const after = s.services.manager.snapshot();
    expect(after.matchId).toBe(before.matchId);
    expect(after.status).toBe('PAUSED');
    expect(after.enemies).toEqual(before.enemies);
    expect(after.regions).toEqual(before.regions);
    expect((await s.inject({ url: '/api/me', headers: auth(p.token) })).json().creditSats).toBe(189);
    await s.advance(10_500);
    expect(s.services.manager.snapshot().status).toBe('LIVE');
  });

  it('health and ready respond; the webhook hides unknown secrets', async () => {
    s = await makeServer();
    expect((await s.inject({ url: '/health' })).json()).toEqual({ ok: true });
    expect((await s.inject({ url: '/ready' })).json()).toMatchObject({ ok: true, paymentMode: 'mock' });
    expect((await s.inject({ method: 'POST', url: '/api/webhooks/lnbits/wrong', payload: {} })).statusCode).toBe(404);
  });
});
