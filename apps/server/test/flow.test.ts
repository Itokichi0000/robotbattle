import { afterEach, describe, expect, it } from 'vitest';
import type { GameEvent } from '@sats-wars/shared';
import { carryOverHp } from '@sats-wars/game-engine';
import {
  type TestServer,
  admin,
  auth,
  fundedPlayer,
  joinTeam,
  makeServer,
  mockPay,
  tempDbPath,
  topup,
  untilRound,
  zap,
} from './helpers';

let s: TestServer | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

const credit = (srv: TestServer, playerId: string) => srv.services.repo.getPlayer(playerId)!.credit_sats;

describe('ZAP BATTLE server flow', () => {
  it('starts a season by itself and lets anyone pick a team for free', async () => {
    s = await makeServer();
    const snap = s.services.manager.snapshot();
    expect(snap.status).toBe('LIVE');
    expect(snap.phase).toBe('OPENING');
    expect(snap.roundOrder).toHaveLength(8);
    const p = await joinTeam(s, 'FUJIN');
    expect(p).toMatchObject({ teamId: 'FUJIN', creditSats: 0 });
    expect(p.nickname).toMatch(/^風神ファン/);
    const me = (await s.inject({ url: '/api/me', headers: auth(p.token) })).json();
    expect(me).toMatchObject({ teamId: 'FUJIN', creditSats: 0, zapsThisSeason: 0 });
    expect(s.services.manager.snapshot().supporters.FUJIN).toBe(1);
  });

  it('a punch without credit is refused and changes nothing', async () => {
    s = await makeServer();
    await untilRound(s);
    const p = await joinTeam(s);
    const before = s.services.manager.snapshot().lastSeq;
    const res = await zap(s, p.token);
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toBe('INSUFFICIENT_CREDIT');
    expect(s.services.manager.snapshot().lastSeq).toBe(before);
  });

  it('top-up: only the offered amounts, credited once after verification', async () => {
    s = await makeServer();
    const p = await joinTeam(s);
    expect((await topup(s, p.token, 100)).statusCode).toBe(400);
    const inv = (await topup(s, p.token, 210)).json();
    expect(inv).toMatchObject({ amountSats: 210, zaps: 10, status: 'PENDING', paymentMode: 'mock' });
    expect(inv.bolt11).toContain('NOT-A-REAL-INVOICE');
    // Asking again for the same amount reuses the pending invoice.
    expect((await topup(s, p.token, 210)).json().invoiceId).toBe(inv.invoiceId);
    const first = (await mockPay(s, p.token, inv.invoiceId)).json();
    const second = (await mockPay(s, p.token, inv.invoiceId)).json();
    expect(first).toMatchObject({ status: 'PAID', creditSats: 210 });
    expect(second).toMatchObject({ status: 'PAID', creditSats: 210 });
    expect(credit(s, p.playerId)).toBe(210);
    const status = (await s.inject({ url: `/api/topups/${inv.invoiceId}`, headers: auth(p.token) })).json();
    expect(status).toMatchObject({ status: 'PAID', creditSats: 210 });
    // Another player cannot read it.
    const other = await joinTeam(s, 'FUJIN');
    expect((await s.inject({ url: `/api/topups/${inv.invoiceId}`, headers: auth(other.token) })).statusCode).toBe(404);
  });

  it('a punch costs 21 sats, hits the other robot and shows the name on screen', async () => {
    s = await makeServer();
    const p = await fundedPlayer(s, 'RAIJIN', 210, 'たろう');
    await untilRound(s);
    const res = await zap(s, p.token, 'tap-00000001');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ duplicate: false, creditSats: 189 });
    expect(body.result).toMatchObject({ ok: true, code: 'HIT', teamId: 'RAIJIN', damage: 10 });
    const snap = s.services.manager.snapshot();
    expect(snap.round!.hp.FUJIN).toBe(snap.round!.hpMax - 10);
    expect(snap.round!.hp.RAIJIN).toBe(snap.round!.hpMax);
    const ev = snap.recentEvents.at(-1) as Extract<GameEvent, { type: 'ZAP' }>;
    expect(ev).toMatchObject({ type: 'ZAP', data: { nickname: 'たろう', teamId: 'RAIJIN', code: 'HIT' } });
    // A retried request (same clientActionId) is answered from storage and not charged again.
    await s.advance(300);
    const again = (await zap(s, p.token, 'tap-00000001')).json();
    expect(again).toMatchObject({ duplicate: true, creditSats: 189 });
    expect(s.services.manager.snapshot().lastSeq).toBe(snap.lastSeq);
    // Machine-gun tapping faster than the cooldown is refused (and free).
    await zap(s, p.token);
    const tooFast = await zap(s, p.token);
    expect(tooFast.statusCode).toBe(429);
    expect(credit(s, p.playerId)).toBe(168);
  });

  it('punches between rounds or while paused are free no-ops', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    const p = await fundedPlayer(s, 'FUJIN', 105);
    const logBefore = s.services.repo.loadCommands(s.services.manager.current().matchId).length;
    const opening = (await zap(s, p.token)).json();
    expect(opening).toMatchObject({ result: { ok: false, code: 'ROUND_NOT_ACTIVE' }, creditSats: 105 });
    // Refused taps are not written to the command log.
    expect(s.services.repo.loadCommands(s.services.manager.current().matchId)).toHaveLength(logBefore);
    await untilRound(s);
    await admin(s, token, { command: 'PAUSE' });
    await s.advance(300);
    const paused = (await zap(s, p.token)).json();
    expect(paused).toMatchObject({ result: { ok: false, code: 'PAUSED' }, creditSats: 105 });
    await admin(s, token, { command: 'RESUME' });
    await s.advance(300);
    expect((await zap(s, p.token)).json()).toMatchObject({ result: { ok: true }, creditSats: 84 });
  });

  it('enough punches knock the robot out: region painted, KO credited, next round follows', async () => {
    s = await makeServer();
    const p = await fundedPlayer(s, 'RAIJIN', 525, 'KOキング');
    await untilRound(s);
    const r0 = s.services.manager.current().state.round!;
    expect(r0.hpMax).toBe(200);
    let last: { result: { code: string } } | null = null;
    let punches = 0;
    while (s.services.manager.current().state.phase === 'ROUND') {
      last = (await zap(s, p.token)).json();
      punches++;
      await s.advance(300);
    }
    // 9 normal (90) + special (60) + 5 normal (50) = 200.
    expect(punches).toBe(15);
    expect(last!.result.code).toBe('KO');
    const snap = s.services.manager.snapshot();
    expect(snap.phase).toBe('ROUND_END');
    expect(snap.regions.filter((r) => r.ownerTeamId)).toEqual([
      { regionId: r0.regionId, ownerTeamId: 'RAIJIN', roundIndex: 0 },
    ]);
    expect(snap.teams.RAIJIN).toMatchObject({ regionsWon: 1, kos: 1, zapsTotal: 15, specialsTotal: 1 });
    expect(snap.rounds[0]).toMatchObject({ endReason: 'KO', winnerTeamId: 'RAIJIN' });
    expect(snap.rounds[0]!.finisher).toMatchObject({ nickname: 'KOキング' });
    const me = (await s.inject({ url: '/api/me', headers: auth(p.token) })).json();
    expect(me).toMatchObject({ creditSats: 525 - 15 * 21, zapsThisSeason: 15, kos: 1 });
    // Hitting during the KO celebration costs nothing.
    expect((await zap(s, p.token)).json()).toMatchObject({ result: { ok: false } });
    expect(credit(s, p.playerId)).toBe(525 - 15 * 21);
    await untilRound(s);
    expect(s.services.manager.current().state.round!.index).toBe(1);
  });

  it('a full season with demo bots decides a winner and loops into the next season', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    await admin(s, token, { command: 'SET_DEMO_BOTS', perTeam: 6 });
    const first = s.services.manager.current().matchId;
    let waited = 0;
    while (s.services.manager.current().state.status !== 'FINISHED') {
      await s.advance(1000);
      waited += 1000;
      expect(waited).toBeLessThan(15 * 60_000);
    }
    const done = s.services.manager.snapshot();
    expect(done.rounds).toHaveLength(8);
    expect(done.result).not.toBeNull();
    const won = done.teams.RAIJIN.regionsWon + done.teams.FUJIN.regionsWon;
    expect(won).toBe(done.regions.filter((r) => r.ownerTeamId).length);
    // Bots never touch money.
    expect(s.services.repo.invoiceSummary()).toEqual({});
    // Final snapshot is frozen for /results.
    const saved = (await s.inject({ url: `/api/matches/${first}/snapshot` })).json();
    expect(saved.snapshot.status).toBe('FINISHED');
    await s.advance(done.config.nextSeasonDelayMs + 200);
    const next = s.services.manager.snapshot();
    expect(next.matchId).not.toBe(first);
    expect(next.status).toBe('LIVE');
    // Round-1 HP follows the crowd of the season that just ended.
    expect(next.config.hpInitial).toBe(carryOverHp(done.config, done.rounds[7]));
  });

  it('credit carries over between seasons and survives a lost browser tab (same device)', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    const p = await joinTeam(s, 'RAIJIN', { deviceId: 'device-abc-123' });
    const inv = (await topup(s, p.token, 105)).json();
    await mockPay(s, p.token, inv.invoiceId);
    await admin(s, token, { command: 'CANCEL' });
    await admin(s, token, { command: 'NEXT_MATCH' });
    const again = await joinTeam(s, 'FUJIN', { deviceId: 'device-abc-123' });
    expect(again).toMatchObject({ playerId: p.playerId, teamId: 'FUJIN', creditSats: 105 });
    expect(again.token).not.toBe(p.token);
    // The old token is replaced.
    expect((await s.inject({ url: '/api/me', headers: auth(p.token) })).statusCode).toBe(401);
  });

  it('switching team is free and immediate', async () => {
    s = await makeServer();
    const p = await fundedPlayer(s, 'RAIJIN', 105);
    await untilRound(s);
    const sw = await s.inject({ method: 'POST', url: '/api/me/team', headers: auth(p.token), payload: { teamId: 'FUJIN' } });
    expect(sw.json()).toEqual({ teamId: 'FUJIN' });
    expect((await zap(s, p.token)).json().result.teamId).toBe('FUJIN');
  });

  it('late payment (paid at the edge, seen after expiry) still becomes credit — never forfeited', async () => {
    s = await makeServer();
    const p = await joinTeam(s);
    const inv = (await topup(s, p.token, 105)).json();
    const row = s.services.repo.getInvoice(inv.invoiceId)!;
    const adapter = s.services.adapter as import('../src/payments/mock').MockPaymentAdapter;
    s.clock.advance(row.expires_at - s.clock.now() + 1000);
    adapter.markPaid(row.lnbits_checking_id, { ignoreExpiry: true });
    await s.services.players.pollPending();
    expect(s.services.repo.getInvoice(inv.invoiceId)!.status).toBe('PAID');
    expect(credit(s, p.playerId)).toBe(105);
  });

  it('unpaid invoices expire without side effects', async () => {
    s = await makeServer();
    const p = await joinTeam(s);
    const inv = (await topup(s, p.token, 105)).json();
    s.clock.advance(30 * 60_000);
    await s.services.players.pollPending();
    expect(s.services.repo.getInvoice(inv.invoiceId)!.status).toBe('EXPIRED');
    expect(credit(s, p.playerId)).toBe(0);
  });

  it('provider outage keeps the invoice pending, then credits once it recovers', async () => {
    s = await makeServer();
    const p = await joinTeam(s);
    const inv = (await topup(s, p.token, 210)).json();
    const adapter = s.services.adapter as import('../src/payments/mock').MockPaymentAdapter;
    const row = s.services.repo.getInvoice(inv.invoiceId)!;
    adapter.markPaid(row.lnbits_checking_id);
    adapter.failChecks = true;
    await s.services.players.pollPending();
    expect(s.services.repo.getInvoice(inv.invoiceId)).toMatchObject({ status: 'PENDING', check_failures: 1 });
    adapter.failChecks = false;
    await s.services.players.pollPending();
    expect(credit(s, p.playerId)).toBe(210);
  });

  it('sponsor codes add credit once, even while Lightning top-ups are paused', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    const issued = await s.inject({
      method: 'POST',
      url: '/api/admin/passes',
      headers: auth(token),
      payload: { count: 2, amountSats: 105 },
    });
    const { codes } = issued.json() as { codes: string[] };
    expect(codes).toHaveLength(2);
    await admin(s, token, { command: 'SET_PAYMENTS_ENABLED', enabled: false });
    const p = await joinTeam(s);
    const blocked = await topup(s, p.token, 105);
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json().error).toBe('PAYMENTS_DISABLED');
    const redeem = (code: string) =>
      s!.inject({ method: 'POST', url: '/api/codes/redeem', headers: auth(p.token), payload: { code } });
    expect((await redeem(codes[0]!.toLowerCase())).json()).toEqual({ addedSats: 105, creditSats: 105 });
    expect((await redeem(codes[0]!)).statusCode).toBe(400);
    expect((await redeem('NOPE-NOPE-NOPE')).statusCode).toBe(400);
    expect(credit(s, p.playerId)).toBe(105);
  });

  it('free cheers are rate limited and never touch credit', async () => {
    s = await makeServer();
    const p = await joinTeam(s);
    const cheer = () => s!.inject({ method: 'POST', url: '/api/cheer', headers: auth(p.token), payload: { emoji: '🔥' } });
    expect((await cheer()).statusCode).toBe(200);
    expect((await cheer()).statusCode).toBe(429);
    s.clock.advance(1000);
    expect((await cheer()).statusCode).toBe(200);
    const bad = await s.inject({ method: 'POST', url: '/api/cheer', headers: auth(p.token), payload: { emoji: '💩' } });
    expect(bad.statusCode).toBe(400);
    expect(credit(s, p.playerId)).toBe(0);
  });

  it('hidden nicknames are masked on public screens', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    const p = await fundedPlayer(s, 'RAIJIN', 105, 'NGネーム');
    await s.inject({
      method: 'POST',
      url: `/api/admin/players/${p.playerId}/nickname-visibility`,
      headers: auth(token),
      payload: { hidden: true },
    });
    await untilRound(s);
    await zap(s, p.token);
    const json = JSON.stringify(s.services.manager.snapshot());
    expect(json).not.toContain('NGネーム');
  });

  it('admin API needs a session and checks Origin; emergency stop halts everything', async () => {
    s = await makeServer({ env: { ALLOWED_ORIGINS: 'http://localhost:3000' } });
    expect((await s.inject({ url: '/api/admin/overview' })).statusCode).toBe(401);
    const bad = await s.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin: 'https://evil.example' },
      payload: { password: 'x' },
    });
    expect(bad.statusCode).toBe(403);
    expect((await s.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'wrong' } })).statusCode).toBe(401);
    const token = await s.adminToken();
    await untilRound(s);
    await admin(s, token, { command: 'EMERGENCY_STOP' });
    const ov = (await s.inject({ url: '/api/admin/overview', headers: auth(token) })).json();
    expect(ov).toMatchObject({ paymentsEnabled: false, autoLoop: false, snapshot: { status: 'PAUSED' } });
    expect(ov.credit).toMatchObject({ outstanding: 0 });
    const audit = (await s.inject({ url: '/api/admin/audit', headers: auth(token) })).json();
    expect(audit.entries.map((e: { action: string }) => e.action)).toContain('EMERGENCY_STOP');
  });

  it('staff credit adjustments are audited and cannot go negative', async () => {
    s = await makeServer();
    const token = await s.adminToken();
    const p = await joinTeam(s);
    const add = await s.inject({
      method: 'POST',
      url: `/api/admin/players/${p.playerId}/credit`,
      headers: auth(token),
      payload: { deltaSats: 105, note: 'LNbitsで入金確認済み' },
    });
    expect(add.json()).toEqual({ creditSats: 105 });
    const neg = await s.inject({
      method: 'POST',
      url: `/api/admin/players/${p.playerId}/credit`,
      headers: auth(token),
      payload: { deltaSats: -500, note: 'oops' },
    });
    expect(neg.statusCode).toBe(400);
    expect(credit(s, p.playerId)).toBe(105);
    const audit = (await s.inject({ url: '/api/admin/audit', headers: auth(token) })).json();
    expect(audit.entries[0]).toMatchObject({ action: 'ADJUST_CREDIT', target_id: p.playerId });
  });

  it('restart: the season comes back paused, credit and tokens survive, then auto-resumes', async () => {
    const dbPath = tempDbPath();
    s = await makeServer({ dbPath });
    const p = await fundedPlayer(s, 'RAIJIN', 210);
    await untilRound(s);
    await zap(s, p.token);
    const before = s.services.manager.snapshot();
    const clock = s.clock;
    await s.close();
    clock.advance(5000);
    s = await makeServer({ dbPath, clock });
    const after = s.services.manager.snapshot();
    expect(after.matchId).toBe(before.matchId);
    expect(after.status).toBe('PAUSED');
    expect(after.round!.hp).toEqual(before.round!.hp);
    expect(after.lastSeq).toBeGreaterThan(before.lastSeq);
    const me = (await s.inject({ url: '/api/me', headers: auth(p.token) })).json();
    expect(me.creditSats).toBe(189);
    await s.advance(10_500);
    expect(s.services.manager.snapshot().status).toBe('LIVE');
  });

  it('mock payment endpoint does not exist outside mock mode; health and ready respond', async () => {
    s = await makeServer();
    expect((await s.inject({ url: '/health' })).json()).toEqual({ ok: true });
    expect((await s.inject({ url: '/ready' })).json()).toMatchObject({ ok: true, paymentMode: 'mock' });
    expect((await s.inject({ method: 'POST', url: '/api/webhooks/lnbits/wrong', payload: {} })).statusCode).toBe(404);
  });
});
