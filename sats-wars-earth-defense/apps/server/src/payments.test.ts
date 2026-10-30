import { randomBytes } from 'node:crypto';
import type {
  MatchEventMsg,
  OperatorCommandResult,
  PaymentIntentView,
  SeatRequestResult,
} from '@swed/shared';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { collect, cookiePair, emitAck, eventually, key, TestServer } from './testHarness';
import { signedCallback } from './testWallet';

/**
 * Shared energy pulses (spec §8, Phase 4 done criteria): one intent adds CAPACITOR exactly
 * once, payment is never required to play, sandbox never pretends to be real money, and live
 * mode needs staff approval and backend confirmation.
 */

let srv: TestServer;
afterEach(async () => srv?.stop());

async function seatedInCombat(cookie: string, seatId = 'GUNNER_L'): Promise<Socket> {
  const phone = await srv.connect('/pilot', cookie);
  const r = await emitAck<SeatRequestResult>(phone, 'pilot:joinSeat', {
    matchId: srv.runtime.state.matchId,
    seatId,
    requestId: key(),
  });
  expect(r.ok).toBe(true);
  return phone;
}

async function operator() {
  const op = await srv.connect('/operator', await srv.operatorCookie());
  return (c: object) => emitAck<OperatorCommandResult>(op, 'operator:command', c);
}

async function launch(op: (c: object) => Promise<OperatorCommandResult>) {
  expect((await op({ command: 'START' })).ok).toBe(true);
  expect((await op({ command: 'SKIP_DEPLOY' })).ok).toBe(true);
  srv.advance(500);
}

async function intent(cookie: string) {
  const res = await srv.post(
    '/api/payments/intent',
    { matchId: srv.runtime.state.matchId },
    cookie,
  );
  return { status: res.status, body: (await res.json()) as PaymentIntentView & { error?: string } };
}

describe('sandbox (VIRTUAL) pulses', () => {
  it('quote → intent → staff settles → CAPACITOR +20 exactly once, owner notified', async () => {
    srv = await new TestServer().start();
    const cookie = await srv.demoGuest();
    const phone = await seatedInCombat(cookie);
    const statuses = collect<PaymentIntentView>(phone, 'payment:status');
    const display = await srv.connect('/display');
    const events = collect<MatchEventMsg>(display, 'match:event');
    const op = await operator();

    // Not in combat yet: no pulses (and no payment is ever needed to play).
    expect((await intent(cookie)).body.error).toBe('NOT_IN_COMBAT');
    await launch(op);

    const quote = (await (await srv.fetch('/api/payments/quote', { cookie })).json()) as Record<
      string,
      unknown
    >;
    expect(quote).toMatchObject({
      mode: 'sandbox',
      enabled: true,
      amountSats: 21,
      capacitorGain: 20,
      remaining: 3,
      inCombat: true,
    });
    expect(String(quote.recipient)).toMatch(/VIRTUAL/);

    const first = await intent(cookie);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'pending', mode: 'sandbox', amountSats: 21 });
    expect(first.body.paymentRequest).toMatch(/^VIRTUAL-SANDBOX-21SATS-/);
    expect((await intent(cookie)).body.error).toBe('PULSE_PENDING');

    // Another pilot cannot read it.
    const other = await srv.demoGuest();
    expect(
      (await srv.fetch(`/api/payments/intent/${first.body.intentId}`, { cookie: other })).status,
    ).toBe(404);

    const cap0 = srv.runtime.state.teamCapacitor;
    expect((await op({ command: 'SANDBOX_SETTLE', intentId: first.body.intentId })).ok).toBe(true);
    expect(srv.runtime.state.teamCapacitor).toBe(Math.min(100, cap0 + 20));
    expect((await op({ command: 'SANDBOX_SETTLE', intentId: first.body.intentId })).ok).toBe(false);
    await eventually(() => statuses.some((s) => s.status === 'settled' && s.applied === 'applied'));
    const pulse = await eventually(() => events.find((e) => e.type === 'sats_pulse_settled'));
    expect(pulse.payload).toMatchObject({ seatId: 'GUNNER_L', gain: 20, virtual: true });
    expect(events.filter((e) => e.type === 'sats_pulse_settled')).toHaveLength(1);

    // Cooldown: 30 s between pulses per pilot.
    expect((await intent(cookie)).body.error).toBe('PULSE_COOLDOWN');
    const view = (await (
      await srv.fetch(`/api/payments/intent/${first.body.intentId}`, { cookie })
    ).json()) as PaymentIntentView;
    expect(view).toMatchObject({ status: 'settled', applied: 'applied', paymentRequest: null });
  });

  it('caps pulses per pilot per round', async () => {
    srv = await new TestServer().start();
    const cookie = await srv.demoGuest();
    await seatedInCombat(cookie);
    const op = await operator();
    await launch(op);
    for (let i = 0; i < 3; i++) {
      const r = await intent(cookie);
      expect(r.status).toBe(200);
      await op({ command: 'SANDBOX_SETTLE', intentId: r.body.intentId });
      srv.built.db
        .prepare("UPDATE payment_intents SET created_at = '2000-01-01T00:00:00.000Z'")
        .run();
    }
    expect((await intent(cookie)).body.error).toBe('PULSE_LIMIT');
  });

  it('never sells a pulse that would add nothing; a blackout always makes it useful', async () => {
    srv = await new TestServer().start();
    const cookie = await srv.demoGuest();
    await seatedInCombat(cookie);
    const op = await operator();
    await launch(op);
    const st = srv.runtime.state;
    const quote = async () =>
      (await (await fetch(`${srv.url}/api/payments/quote`, { headers: { cookie } })).json()) as {
        capacitorFull: boolean;
        crisis: boolean;
      };
    // CHARGE full alone still leaves the OVERCHARGE to gain.
    st.teamCapacitor = st.config.capacitor.max;
    expect((await quote()).capacitorFull).toBe(false);
    // Full and already overcharged: nothing to buy.
    st.overchargeUntil = st.t + 60_000;
    expect((await quote()).capacitorFull).toBe(true);
    const r = await intent(cookie);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('CAPACITOR_FULL');
  });

  it('a pulse during a REACTOR BLACKOUT restores it; staff can let VIRTUAL pulses confirm themselves', async () => {
    srv = await new TestServer().start();
    const cookie = await srv.demoGuest();
    await seatedInCombat(cookie);
    const op = await operator();
    await launch(op);
    const display = await srv.connect('/display');
    const events = collect<MatchEventMsg>(display, 'match:event');
    // Force the blackout now (normally scheduled mid-wave).
    srv.runtime.state.config.crisis.atMs.WAVE_1 = 0;
    srv.advance(200);
    expect(srv.runtime.state.crisis?.kind).toBe('BLACKOUT');
    // Even with CHARGE full, a blackout makes the pulse worth it.
    srv.runtime.state.teamCapacitor = srv.runtime.state.config.capacitor.max;
    srv.runtime.state.overchargeUntil = srv.runtime.state.t + 60_000;
    const q = (await (
      await fetch(`${srv.url}/api/payments/quote`, { headers: { cookie } })
    ).json()) as {
      crisis: boolean;
      capacitorFull: boolean;
    };
    expect(q).toMatchObject({ crisis: true, capacitorFull: false });
    expect((await op({ command: 'SET_AUTO_SETTLE_VIRTUAL', enabled: true })).ok).toBe(true);
    const r = await intent(cookie);
    expect(r.status).toBe(200);
    // Nobody presses SETTLE: one poller pass after the short pause confirms it by itself.
    srv.built.db
      .prepare("UPDATE payment_intents SET created_at = '2000-01-01T00:00:00.000Z'")
      .run();
    await srv.built.payments.poll();
    expect(srv.runtime.state.stats.pulses).toBe(1);
    expect(srv.runtime.state.crisis).toBeNull();
    await eventually(() =>
      events.some((m) => m.payload.type === 'crisis_resolved' && m.payload.by === 'PULSE'),
    );
    const pulse = events.find((m) => m.payload.type === 'sats_pulse_settled')!.payload;
    expect(pulse).toMatchObject({ virtual: true, crisis: true, settleMs: null });
    expect(srv.runtime.state.stats.blackoutsByPulse).toBe(1);
  });
});

/* --------------------------------------------------------------- live */

function fakeLnbits() {
  const invoices = new Map<string, { paid: boolean; body: Record<string, unknown> }>();
  const calls: Array<{ url: string; method: string; key: string | null }> = [];
  let down = false;
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    calls.push({ url, method, key: headers.get('X-Api-Key') });
    const json = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://sats-wars.test/api/payments/webhook/lnbits/ping'))
      return json({ ok: true });
    if (down) throw new Error('connect ECONNREFUSED lnbits.test');
    if (url === 'https://lnbits.test/api/v1/wallet')
      return json({ name: 'Venue wallet', balance: 0 });
    if (url === 'https://lnbits.test/api/v1/payments' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const hash = randomBytes(32).toString('hex');
      invoices.set(hash, { paid: false, body });
      return json({ payment_hash: hash, payment_request: `lnbc210n1fake${hash.slice(0, 20)}` });
    }
    const m = /^https:\/\/lnbits\.test\/api\/v1\/payments\/([0-9a-f]{64})$/.exec(url);
    if (m) return json({ paid: invoices.get(m[1]!)?.paid ?? false });
    return json({ detail: 'not found' }, 404);
  };
  return {
    f,
    invoices,
    calls,
    pay: (hash: string) => (invoices.get(hash)!.paid = true),
    setDown: (v: boolean) => (down = v),
  };
}

const LIVE = {
  APP_MODE: 'live',
  PUBLIC_BASE_URL: 'https://sats-wars.test',
  LNBITS_URL: 'https://lnbits.test',
  LNBITS_INVOICE_KEY: 'invoice-key-0123456789abcdef',
  PAYMENT_RECIPIENT_LABEL: 'SATS WARS Venue Wallet',
};

async function lnurlPilot(seed: string): Promise<string> {
  const res = await srv.post('/api/auth/attempt', {});
  const a = (await res.json()) as { attemptId: string; lnurl: string };
  const authCookie = cookiePair(res, 'sw_auth')!;
  const u = new URL(signedCallback(a.lnurl, seed));
  expect(await (await srv.fetch(`${u.pathname}${u.search}`)).json()).toEqual({ status: 'OK' });
  const st = await srv.fetch(`/api/auth/attempt/${a.attemptId}/status`, { cookie: authCookie });
  return cookiePair(st, 'sw_pilot')!;
}

describe('live (LNbits) pulses', () => {
  it('stay OFF until staff run the checks and confirm; then apply exactly once on confirmed payment', async () => {
    const ln = fakeLnbits();
    srv = await new TestServer(LIVE, { fetch: ln.f }).start();
    // No DEMO GUEST in live mode: pilots sign in with their wallet.
    expect((await srv.post('/api/auth/demo-guest', {})).status).toBe(403);
    const cookie = await lnurlPilot('ivy-wallet');
    const phone = await seatedInCombat(cookie);
    const statuses = collect<PaymentIntentView>(phone, 'payment:status');
    const op = await operator();
    await launch(op);

    expect((await intent(cookie)).body.error).toBe('PAYMENTS_DISABLED');
    expect((await op({ command: 'PAYMENTS_ENABLE_LIVE', confirm: 'LIVE' })).ok).toBe(false);
    expect((await op({ command: 'PAYMENTS_CHECK' })).ok).toBe(true);
    expect((await op({ command: 'PAYMENTS_ENABLE_LIVE', confirm: 'live' })).ok).toBe(false);
    expect((await op({ command: 'PAYMENTS_ENABLE_LIVE', confirm: 'LIVE' })).ok).toBe(true);

    const r = await intent(cookie);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      mode: 'live',
      amountSats: 21,
      recipient: 'SATS WARS Venue Wallet',
      status: 'pending',
    });
    expect(r.body.paymentRequest).toMatch(/^lnbc/);
    const created = ln.calls.find(
      (c) => c.method === 'POST' && c.url.endsWith('/api/v1/payments'),
    )!;
    expect(created.key).toBe(LIVE.LNBITS_INVOICE_KEY);
    const inv = [...ln.invoices.values()][0]!.body;
    // Receive only: the adapter never asks LNbits to send.
    expect(inv).toMatchObject({ out: false, amount: 21 });
    expect(String(inv.webhook)).toMatch(
      /^https:\/\/sats-wars\.test\/api\/payments\/webhook\/lnbits\?token=/,
    );
    const hash = [...ln.invoices.keys()][0]!;

    const cap0 = srv.runtime.state.teamCapacitor;
    // A forged webhook (wrong token) is refused; a webhook for an unpaid invoice changes nothing.
    expect(
      (await srv.post('/api/payments/webhook/lnbits?token=nope', { payment_hash: hash })).status,
    ).toBe(403);
    const hook = `/api/payments/webhook/lnbits?token=test-webhook-secret-0123456789`;
    expect((await srv.post(hook, { payment_hash: hash })).status).toBe(200);
    expect(srv.runtime.state.teamCapacitor).toBe(cap0);

    ln.pay(hash);
    // Duplicate, concurrent webhooks: the pulse lands once.
    await Promise.all([
      srv.post(hook, { payment_hash: hash }),
      srv.post(hook, { payment_hash: hash }),
      srv.post(hook, { payment_hash: hash }),
    ]);
    await srv.built.payments.poll();
    expect(srv.runtime.state.teamCapacitor).toBe(Math.min(100, cap0 + 20));
    expect(srv.runtime.state.stats.pulses).toBe(1);
    await eventually(() => statuses.find((s) => s.status === 'settled' && s.applied === 'applied'));
    const rows = srv.built.db
      .prepare("SELECT * FROM payment_intents WHERE status = 'settled'")
      .all();
    expect(rows).toHaveLength(1);
  });

  it('a payment that settles after its round is recorded as unapplied, not carried over', async () => {
    const ln = fakeLnbits();
    srv = await new TestServer(LIVE, { fetch: ln.f }).start();
    const cookie = await lnurlPilot('jun-wallet');
    await seatedInCombat(cookie, 'SHIELD_L');
    const op = await operator();
    await launch(op);
    await op({ command: 'PAYMENTS_CHECK' });
    await op({ command: 'PAYMENTS_ENABLE_LIVE', confirm: 'LIVE' });
    const r = await intent(cookie);
    const hash = [...ln.invoices.keys()][0]!;
    expect((await op({ command: 'END' })).ok).toBe(true);
    ln.pay(hash);
    await srv.built.payments.poll();
    const row = srv.built.db
      .prepare('SELECT status, applied, note FROM payment_intents WHERE id = ?')
      .get(r.body.intentId);
    expect(row).toMatchObject({ status: 'settled', applied: 'unapplied' });
    expect(srv.runtime.state.stats.pulses).toBe(0);
    const audit = srv.built.db
      .prepare("SELECT action FROM audit_log WHERE action = 'PULSE_UNAPPLIED'")
      .all();
    expect(audit).toHaveLength(1);
  });

  it('a payment backend outage never stops the game', async () => {
    const ln = fakeLnbits();
    srv = await new TestServer(LIVE, { fetch: ln.f }).start();
    const cookie = await lnurlPilot('kai-wallet');
    await seatedInCombat(cookie);
    const op = await operator();
    await launch(op);
    await op({ command: 'PAYMENTS_CHECK' });
    await op({ command: 'PAYMENTS_ENABLE_LIVE', confirm: 'LIVE' });
    ln.setDown(true);
    expect((await intent(cookie)).body.error).toBe('BACKEND_UNAVAILABLE');
    const t0 = srv.runtime.state.t;
    srv.advance(2_000);
    expect(srv.runtime.state.t).toBeGreaterThan(t0);
    expect(srv.runtime.state.phase).toBe('WAVE_1');
    expect((await op({ command: 'PAYMENTS_DISABLE' })).ok).toBe(true);
    expect((await intent(cookie)).body.error).toBe('PAYMENTS_DISABLED');
  });
});

describe('live mode start-up guards', () => {
  it('needs LNbits settings, a payer-facing label and an https public URL', async () => {
    const { parseEnv, EnvError } = await import('./env');
    expect(() => parseEnv({ APP_MODE: 'live' }, () => 'x')).toThrow(EnvError);
    expect(() =>
      parseEnv({ ...LIVE, PUBLIC_BASE_URL: 'http://sats-wars.test' }, () => 'x'),
    ).toThrow(/https/);
    expect(() => parseEnv({ ...LIVE, PAYMENT_RECIPIENT_LABEL: '' }, () => 'x')).toThrow();
    expect(parseEnv({ ...LIVE }, () => 'x').APP_MODE).toBe('live');
  });
});
