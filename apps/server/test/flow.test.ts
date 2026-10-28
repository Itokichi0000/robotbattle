import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../src/clock';
import { MockPaymentAdapter } from '../src/payments/mock';
import {
  type TestServer,
  act,
  admin,
  auth,
  joinAndPay,
  makeServer,
  reserve,
  tempDbPath,
} from './helpers';

let s: TestServer | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

async function liveServer(env: Record<string, string> = {}) {
  s = await makeServer({ env });
  const token = await s.adminToken();
  await admin(s, token, { command: 'OPEN_LOBBY' });
  return { s, token };
}

describe('join + mock payment + actions', () => {
  it('mock pay -> ACTIVE with 3 AP -> 3 actions -> 4th rejected', async () => {
    const { s, token } = await liveServer();
    const p = await joinAndPay(s, 'たろう');
    expect(p.pay).toMatchObject({
      participantStatus: 'ACTIVE',
      invoiceStatus: 'PAID',
      apRemaining: 3,
    });
    // Actions are rejected (no AP spent) while in the lobby.
    const early = await act(s, p.token, 'CHARGE');
    expect(early.json().result).toMatchObject({ ok: false, code: 'MATCH_NOT_LIVE' });
    await admin(s, token, { command: 'START' });
    const a1 = await act(s, p.token, 'ATTACK', 'kanto');
    expect(a1.json()).toMatchObject({ result: { ok: true, code: 'CAPTURED' }, apRemaining: 2 });
    const a2 = await act(s, p.token, 'DEFEND', 'kanto');
    expect(a2.json().result.code).toBe('SHIELD_PLACED');
    const a3 = await act(s, p.token, 'CHARGE');
    expect(a3.json()).toMatchObject({ result: { ok: true }, apRemaining: 0 });
    const a4 = await act(s, p.token, 'CHARGE');
    expect(a4.json()).toMatchObject({ result: { ok: false, code: 'NO_AP' }, apRemaining: 0 });
    const me = await s.inject({ url: '/api/me', headers: auth(p.token) });
    expect(me.json()).toMatchObject({ status: 'ACTIVE', apRemaining: 0, apTotal: 3 });
    expect(me.json().lastResults).toHaveLength(5); // includes the early MATCH_NOT_LIVE attempt
  });

  it('retrying the same clientActionId does not spend AP twice', async () => {
    const { s, token } = await liveServer();
    const p = await joinAndPay(s);
    await admin(s, token, { command: 'START' });
    const r1 = await act(s, p.token, 'CHARGE', undefined, 'retry-1234');
    const r2 = await act(s, p.token, 'CHARGE', undefined, 'retry-1234');
    expect(r1.json().apRemaining).toBe(2);
    expect(r2.json()).toMatchObject({ apRemaining: 2, result: { duplicate: true, ok: true } });
  });

  it('rejects actions without a valid token and before payment', async () => {
    const { s } = await liveServer();
    const noAuth = await s.inject({
      method: 'POST',
      url: '/api/actions',
      payload: { clientActionId: 'abcdefgh', type: 'CHARGE' },
    });
    expect(noAuth.statusCode).toBe(401);
    const r = (await reserve(s)).json();
    const unpaid = await act(s, r.token, 'CHARGE');
    expect(unpaid.statusCode).toBe(403);
  });

  it('does not accept client-declared team/AP fields', async () => {
    const { s } = await liveServer();
    const res = await s.inject({
      method: 'POST',
      url: '/api/join/reserve',
      payload: { nickname: 'x', teamId: 'RAIJIN', ap: 999, paid: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toHaveProperty('ap');
    const st = await s.inject({
      url: `/api/join/payment-status/${body.reservationId}`,
      headers: auth(body.token),
    });
    expect(st.json()).toMatchObject({ participantStatus: 'RESERVED', apRemaining: 0 });
  });

  it('balances teams on reservation', async () => {
    const { s } = await liveServer();
    const teams: string[] = [];
    for (let i = 0; i < 10; i++) teams.push((await reserve(s, `p${i}`)).json().teamId);
    expect(teams.filter((t) => t === 'RAIJIN')).toHaveLength(5);
    expect(teams.filter((t) => t === 'FUJIN')).toHaveLength(5);
  });

  it('rejects a second reservation from the same device', async () => {
    const { s } = await liveServer();
    expect((await reserve(s, 'a', 'device-123456')).statusCode).toBe(200);
    const dup = await reserve(s, 'b', 'device-123456');
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('ALREADY_JOINED');
  });

  it('expires unpaid reservations after the TTL and frees the seat', async () => {
    const { s } = await liveServer({ LOBBY_MS: '600000' });
    const r = (await reserve(s)).json();
    await s.advance(181_000);
    const inv = await s.inject({
      method: 'POST',
      url: '/api/join/invoice',
      headers: auth(r.token),
      payload: { reservationId: r.reservationId },
    });
    expect(inv.statusCode).toBe(410);
    expect(inv.json().error).toBe('RESERVATION_EXPIRED');
    const st = await s.inject({
      url: `/api/join/payment-status/${r.reservationId}`,
      headers: auth(r.token),
    });
    expect(st.json().participantStatus).toBe('EXPIRED');
  });

  it('closes joining after joinCloseMs and when the match is not open', async () => {
    s = await makeServer();
    expect((await reserve(s)).json().error).toBe('JOIN_CLOSED'); // CREATED
    const token = await s.adminToken();
    await admin(s, token, { command: 'START' });
    await s.advance(181_000);
    expect((await reserve(s)).json().error).toBe('JOIN_CLOSED');
  });

  it('respects the payments kill switch but still allows passes', async () => {
    const { s, token } = await liveServer();
    await admin(s, token, { command: 'SET_PAYMENTS_ENABLED', enabled: false });
    const r = (await reserve(s)).json();
    const inv = await s.inject({
      method: 'POST',
      url: '/api/join/invoice',
      headers: auth(r.token),
      payload: { reservationId: r.reservationId },
    });
    expect(inv.json().error).toBe('PAYMENTS_DISABLED');
    const codes = (
      await s.inject({
        method: 'POST',
        url: '/api/admin/passes',
        headers: auth(token),
        payload: { count: 1 },
      })
    ).json().codes as string[];
    const redeem = await s.inject({
      method: 'POST',
      url: '/api/join/redeem-pass',
      headers: auth(r.token),
      payload: { reservationId: r.reservationId, code: codes[0] },
    });
    expect(redeem.json()).toMatchObject({ participantStatus: 'ACTIVE', apRemaining: 3 });
  });
});

describe('sponsored passes', () => {
  it('are single use, case-insensitive, and cannot be guessed', async () => {
    const { s, token } = await liveServer();
    const { codes } = (
      await s.inject({
        method: 'POST',
        url: '/api/admin/passes',
        headers: auth(token),
        payload: { count: 2, label: 'kids' },
      })
    ).json();
    expect(codes).toHaveLength(2);
    const a = (await reserve(s)).json();
    const ok = await s.inject({
      method: 'POST',
      url: '/api/join/redeem-pass',
      headers: auth(a.token),
      payload: { reservationId: a.reservationId, code: codes[0].toLowerCase().replace(/-/g, ' ') },
    });
    expect(ok.json().participantStatus).toBe('ACTIVE');
    const b = (await reserve(s)).json();
    const reuse = await s.inject({
      method: 'POST',
      url: '/api/join/redeem-pass',
      headers: auth(b.token),
      payload: { reservationId: b.reservationId, code: codes[0] },
    });
    expect(reuse.json().error).toBe('INVALID_PASS');
    const guess = await s.inject({
      method: 'POST',
      url: '/api/join/redeem-pass',
      headers: auth(b.token),
      payload: { reservationId: b.reservationId, code: 'SW-AAAA-BBBB-CCCC' },
    });
    expect(guess.json().error).toBe('INVALID_PASS');
    const passes = (await s.inject({ url: '/api/admin/passes', headers: auth(token) })).json()
      .passes;
    expect(passes.map((p: { status: string }) => p.status).sort()).toEqual(['ISSUED', 'REDEEMED']);
    // Plain codes are never listed back.
    expect(JSON.stringify(passes)).not.toContain(codes[1]);
  });

  it('expired or revoked passes are rejected', async () => {
    const { s, token } = await liveServer({ LOBBY_MS: '1800000' });
    const { codes } = (
      await s.inject({
        method: 'POST',
        url: '/api/admin/passes',
        headers: auth(token),
        payload: { count: 1, expiresInMinutes: 5 },
      })
    ).json();
    await s.advance(5 * 60_000 + 1000);
    const r = (await reserve(s)).json();
    const res = await s.inject({
      method: 'POST',
      url: '/api/join/redeem-pass',
      headers: auth(r.token),
      payload: { reservationId: r.reservationId, code: codes[0] },
    });
    expect(res.json().error).toBe('INVALID_PASS');
  });
});

describe('payment verification and webhooks', () => {
  async function setup() {
    const clock = new FakeClock();
    const adapter = new MockPaymentAdapter(clock);
    s = await makeServer({ clock, adapter, env: { LNBITS_WEBHOOK_SECRET: 'hook-secret-1234' } });
    const token = await s.adminToken();
    await admin(s, token, { command: 'OPEN_LOBBY' });
    const r = (await reserve(s)).json();
    const inv = (
      await s.inject({
        method: 'POST',
        url: '/api/join/invoice',
        headers: auth(r.token),
        payload: { reservationId: r.reservationId },
      })
    ).json();
    const row = s.services.repo.getInvoice(inv.invoiceId)!;
    return { s, adapter, token, r, inv, row };
  }

  it('a webhook for an unpaid invoice grants nothing (status is re-verified)', async () => {
    const { s, r, row } = await setup();
    const hook = await s.inject({
      method: 'POST',
      url: '/api/webhooks/lnbits/hook-secret-1234',
      payload: { payment_hash: row.payment_hash, paid: true, amount: 21000 },
    });
    expect(hook.statusCode).toBe(200);
    const st = await s.inject({
      url: `/api/join/payment-status/${r.reservationId}`,
      headers: auth(r.token),
    });
    expect(st.json()).toMatchObject({
      participantStatus: 'PENDING_PAYMENT',
      invoiceStatus: 'PENDING',
      apRemaining: 0,
    });
  });

  it('rejects webhooks with a wrong secret and ignores unknown hashes', async () => {
    const { s } = await setup();
    const bad = await s.inject({
      method: 'POST',
      url: '/api/webhooks/lnbits/wrong',
      payload: { payment_hash: 'a'.repeat(64) },
    });
    expect(bad.statusCode).toBe(404);
    const unknown = await s.inject({
      method: 'POST',
      url: '/api/webhooks/lnbits/hook-secret-1234',
      payload: { payment_hash: 'b'.repeat(64) },
    });
    expect(unknown.statusCode).toBe(200);
  });

  it('duplicate webhooks + poller + client polling grant AP exactly once', async () => {
    const { s, adapter, r, row } = await setup();
    adapter.markPaid(row.lnbits_checking_id);
    await Promise.all([
      s.inject({
        method: 'POST',
        url: '/api/webhooks/lnbits/hook-secret-1234',
        payload: { payment_hash: row.payment_hash },
      }),
      s.inject({
        method: 'POST',
        url: '/api/webhooks/lnbits/hook-secret-1234',
        payload: { payment_hash: row.payment_hash },
      }),
      s.inject({ url: `/api/join/payment-status/${r.reservationId}`, headers: auth(r.token) }),
      s.services.join.pollPending(),
    ]);
    await s.services.join.pollPending();
    const snap = s.services.manager.snapshot();
    const team = snap.teams[r.teamId as 'RAIJIN' | 'FUJIN'];
    expect(team.participantCount).toBe(1);
    expect(team.apTotal).toBe(3);
    expect(s.services.repo.getInvoice(row.id)!.status).toBe('PAID');
  });

  it('a missing webhook is covered by the poller', async () => {
    const { s, adapter, r, row } = await setup();
    adapter.markPaid(row.lnbits_checking_id);
    await s.advance(2000);
    const st = await s.inject({ url: '/api/me', headers: auth(r.token) });
    expect(st.json()).toMatchObject({ status: 'ACTIVE', apRemaining: 3 });
  });

  it('provider outages do not grant or lose payments', async () => {
    const { s, adapter, r, row } = await setup();
    adapter.markPaid(row.lnbits_checking_id);
    adapter.failChecks = true;
    await s.services.join.pollPending();
    expect(s.services.repo.getInvoice(row.id)).toMatchObject({
      status: 'PENDING',
      check_failures: 1,
    });
    adapter.failChecks = false;
    await s.services.join.pollPending();
    expect(s.services.repo.getInvoice(row.id)!.status).toBe('PAID');
    const me = await s.inject({ url: '/api/me', headers: auth(r.token) });
    expect(me.json().apRemaining).toBe(3);
  });

  it('expired invoices become EXPIRED and cannot be paid afterwards', async () => {
    const { s, adapter, row } = await setup();
    await s.advance(row.expires_at - s.clock.now() + 1000);
    expect(adapter.markPaid(row.lnbits_checking_id)).toBe(false);
    await s.services.join.pollPending();
    expect(s.services.repo.getInvoice(row.id)!.status).toBe('EXPIRED');
  });

  it('a payment confirmed after the match ended is LATE_PAID, grants no AP, and can be carried over', async () => {
    const { s, adapter, token, r, row } = await setup();
    await admin(s, token, { command: 'CANCEL' });
    adapter.markPaid(row.lnbits_checking_id);
    await s.services.join.pollPending();
    expect(s.services.repo.getInvoice(row.id)).toMatchObject({
      status: 'LATE_PAID',
      late_payment_disposition: 'PENDING_REVIEW',
    });
    const me = await s.inject({ url: '/api/me', headers: auth(r.token) });
    expect(me.json()).toMatchObject({
      invoiceStatus: 'LATE_PAID',
      apRemaining: 0,
      lateCarryoverCode: null,
    });
    const disp = await s.inject({
      method: 'POST',
      url: `/api/admin/invoices/${row.id}/disposition`,
      headers: auth(token),
      payload: { disposition: 'CARRY_OVER', note: 'next match' },
    });
    expect(disp.statusCode).toBe(200);
    const me2 = (await s.inject({ url: '/api/me', headers: auth(r.token) })).json();
    expect(me2.lateCarryoverCode).toMatch(/^SW-/);
    // The carry-over code works in the next match.
    await admin(s, token, { command: 'NEXT_MATCH' });
    await admin(s, token, { command: 'OPEN_LOBBY' });
    const r2 = (await reserve(s)).json();
    const redeem = await s.inject({
      method: 'POST',
      url: '/api/join/redeem-pass',
      headers: auth(r2.token),
      payload: { reservationId: r2.reservationId, code: me2.lateCarryoverCode },
    });
    expect(redeem.json().participantStatus).toBe('ACTIVE');
    const audit = (await s.inject({ url: '/api/admin/audit', headers: auth(token) })).json()
      .entries;
    expect(audit.map((e: { action: string }) => e.action)).toContain('LATE_PAYMENT');
  });

  it('mock-pay endpoint does not exist in lnbits mode', async () => {
    s = await makeServer({
      env: {
        PAYMENT_MODE: 'lnbits',
        LNBITS_URL: 'http://127.0.0.1:9',
        LNBITS_INVOICE_KEY: 'x',
        LNBITS_WEBHOOK_SECRET: 'y',
        ALLOW_REAL_PAYMENTS: 'true',
      },
      adapter: new MockPaymentAdapter(new FakeClock()),
    });
    const res = await s.inject({ method: 'POST', url: '/api/dev/mock-pay', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

describe('admin', () => {
  it('requires authentication and rejects disallowed origins', async () => {
    s = await makeServer({ env: { ALLOWED_ORIGINS: 'http://localhost:3000' } });
    expect((await s.inject({ url: '/api/admin/overview' })).statusCode).toBe(401);
    const wrong = await s.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
    const token = await s.adminToken();
    const evil = await s.inject({
      url: '/api/admin/overview',
      headers: { ...auth(token), origin: 'https://evil.example' },
    });
    expect(evil.statusCode).toBe(403);
    const ok = await s.inject({
      url: '/api/admin/overview',
      headers: { ...auth(token), origin: 'http://localhost:3000' },
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.stringify(ok.json())).not.toContain('test-admin-password');
  });

  it('PAUSE/RESUME freezes game time; EMERGENCY_STOP pauses and stops payments', async () => {
    const { s, token } = await liveServer();
    await admin(s, token, { command: 'START' });
    await s.advance(10_000);
    await admin(s, token, { command: 'PAUSE' });
    const g1 = s.services.manager.snapshot().gameMs;
    await s.advance(60_000);
    expect(s.services.manager.snapshot().gameMs).toBe(g1);
    expect(s.services.manager.snapshot().clashes).toHaveLength(0);
    await admin(s, token, { command: 'RESUME' });
    await s.advance(36_000);
    expect(s.services.manager.snapshot().clashes).toHaveLength(1);
    await admin(s, token, { command: 'EMERGENCY_STOP' });
    const snap = s.services.manager.snapshot();
    expect(snap.status).toBe('PAUSED');
    expect(snap.paymentsEnabled).toBe(false);
  });

  it('runs a full match to FINISHED and rolls to the next match with frozen config', async () => {
    const { s, token } = await liveServer();
    const cfg = (await s.inject({ url: '/api/admin/next-config', headers: auth(token) })).json()
      .config;
    const put = await s.inject({
      method: 'PUT',
      url: '/api/admin/next-config',
      headers: auth(token),
      payload: { config: { ...cfg, entryFeeSats: 42, version: 'test-2' } },
    });
    expect(put.statusCode).toBe(200);
    // The running match keeps its config.
    expect(s.services.manager.snapshot().config.entryFeeSats).toBe(21);
    await admin(s, token, { command: 'START' });
    const p = await joinAndPay(s);
    await act(s, p.token, 'ATTACK', 'tohoku');
    await s.advance(300_000);
    const done = s.services.manager.snapshot();
    expect(done.status).toBe('FINISHED');
    expect(done.clashes).toHaveLength(6);
    expect(done.result?.winnerTeamId).toBe(p.teamId);
    const firstId = done.matchId;
    await admin(s, token, { command: 'NEXT_MATCH' });
    const next = s.services.manager.snapshot();
    expect(next.matchId).not.toBe(firstId);
    expect(next.config).toMatchObject({ entryFeeSats: 42, version: 'test-2' });
    // Old match result is retrievable.
    const old = await s.inject({ url: `/api/matches/${firstId}/snapshot` });
    expect(old.json().snapshot).toMatchObject({
      status: 'FINISHED',
      result: { winnerTeamId: p.teamId },
    });
    // Old tokens cannot act in the new match.
    const stale = await act(s, p.token, 'CHARGE');
    expect(stale.statusCode).toBe(403);
  });

  it('rejects invalid configs and invalid lifecycle commands', async () => {
    const { s, token } = await liveServer();
    const bad = await s.inject({
      method: 'PUT',
      url: '/api/admin/next-config',
      headers: auth(token),
      payload: { config: { foo: 1 } },
    });
    expect(bad.statusCode).toBe(400);
    const res = await s.inject({
      method: 'POST',
      url: '/api/admin/command',
      headers: auth(token),
      payload: { command: 'NEXT_MATCH' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('can hide a nickname from public output', async () => {
    const { s, token } = await liveServer();
    await admin(s, token, { command: 'START' });
    const p = await joinAndPay(s, 'NaughtyName');
    await act(s, p.token, 'CHARGE');
    await s.inject({
      method: 'POST',
      url: `/api/admin/participants/${p.participantId}/nickname-visibility`,
      headers: auth(token),
      payload: { hidden: true },
    });
    const snap = JSON.stringify(s.services.manager.snapshot());
    expect(snap).not.toContain('NaughtyName');
  });
});

describe('restart recovery', () => {
  it('rebuilds the match from the command log and comes back PAUSED', async () => {
    const dbPath = tempDbPath();
    const clock = new FakeClock();
    s = await makeServer({ dbPath, clock });
    const token = await s.adminToken();
    await admin(s, token, { command: 'START' });
    const p = await joinAndPay(s);
    await act(s, p.token, 'ATTACK', 'kanto');
    await s.advance(50_000);
    const before = s.services.manager.snapshot();
    await s.close();

    s = await makeServer({ dbPath, clock });
    const after = s.services.manager.snapshot();
    expect(after.matchId).toBe(before.matchId);
    expect(after.status).toBe('PAUSED');
    expect(after.pauseReason).toBe('SERVER_RESTART');
    expect(after.regions).toEqual(before.regions);
    expect(after.teams).toEqual(before.teams);
    expect(after.clashes).toEqual(before.clashes);
    // The participant token still works after restart.
    const me = await s.inject({ url: '/api/me', headers: auth(p.token) });
    expect(me.json()).toMatchObject({ status: 'ACTIVE', apRemaining: 2 });
    const token2 = await s.adminToken();
    await admin(s, token2, { command: 'RESUME' });
    await s.advance(45_000);
    expect(s.services.manager.snapshot().clashes).toHaveLength(2);
  });
});
