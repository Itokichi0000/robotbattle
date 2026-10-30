import { secp256k1 } from '@noble/curves/secp256k1.js';
import type { SessionStatusMsg } from '@swed/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logRequest } from './app';
import { encodeLnurl, verifyLoginSignature } from './lnurl';
import { cookiePair, eventually, TestServer } from './testHarness';
import { decodeLnurl, signedCallback } from './testWallet';

/**
 * LNURL-auth security (spec §7.2, Phase 3 done criteria): a forged signature never logs in,
 * a correct wallet signature yields a pilot, k1 is single-use and expires, and only the
 * browser that asked for the challenge receives the session.
 */

let srv: TestServer;
beforeEach(async () => {
  srv = await new TestServer().start();
});
afterEach(async () => srv.stop());

interface Attempt {
  attemptId: string;
  lnurl: string;
  callbackUrl: string;
  expiresAt: string;
}

async function attempt(): Promise<{ a: Attempt; authCookie: string }> {
  const res = await srv.post('/api/auth/attempt', {});
  expect(res.status).toBe(200);
  const a = (await res.json()) as Attempt;
  const authCookie = cookiePair(res, 'sw_auth')!;
  expect(authCookie).toBeTruthy();
  return { a, authCookie };
}

/** The wallet's request, sent to the test server (the callback URL names the public host). */
async function walletCall(url: string) {
  const u = new URL(url);
  const res = await srv.fetch(`${u.pathname}${u.search}`);
  return (await res.json()) as { status: string; reason?: string };
}

async function status(attemptId: string, cookie?: string) {
  const res = await srv.fetch(`/api/auth/attempt/${attemptId}/status`, { cookie });
  return {
    body: (await res.json()) as { status: string; pilot?: { kind: string; publicName: string } },
    res,
  };
}

describe('LNURL-auth (LUD-04)', () => {
  it('encodes the callback as a bech32 LNURL the wallet can decode', async () => {
    const { a } = await attempt();
    expect(a.lnurl).toMatch(/^LNURL1[0-9A-Z]+$/);
    expect(decodeLnurl(a.lnurl)).toBe(a.callbackUrl);
    expect(a.callbackUrl).toMatch(
      /^http:\/\/localhost:4400\/api\/auth\/lnurl\?tag=login&k1=[0-9a-f]{64}&action=login$/,
    );
    expect(encodeLnurl(a.callbackUrl)).toBe(a.lnurl);
  });

  it('a correct wallet signature authorizes exactly the browser that asked', async () => {
    const { a, authCookie } = await attempt();
    expect((await status(a.attemptId, authCookie)).body.status).toBe('PENDING');
    expect(await walletCall(signedCallback(a.lnurl, 'alice-wallet'))).toEqual({ status: 'OK' });
    // Someone else polling the same attempt id gets nothing.
    expect((await status(a.attemptId)).body.status).toBe('NOT_FOUND');
    expect((await status(a.attemptId, 'sw_auth=forged-token-forged-token-00')).body.status).toBe(
      'NOT_FOUND',
    );
    const ok = await status(a.attemptId, authCookie);
    expect(ok.body.status).toBe('AUTHORIZED');
    expect(ok.body.pilot?.kind).toBe('LNURL');
    expect(ok.body.pilot?.publicName).toMatch(/^PILOT-[0-9A-F]{4}$/);
    const session = cookiePair(ok.res, 'sw_pilot')!;
    const me = (await (await srv.fetch('/api/session', { cookie: session })).json()) as {
      authenticated: boolean;
      pilot: { kind: string };
    };
    expect(me).toMatchObject({ authenticated: true, pilot: { kind: 'LNURL' } });
    // Claimed once: polling again does not mint another session.
    expect((await status(a.attemptId, authCookie)).body.status).toBe('NOT_FOUND');
  });

  it('the same wallet always maps to the same pseudonymous pilot; the key is never exposed', async () => {
    const one = await attempt();
    await walletCall(signedCallback(one.a.lnurl, 'bob-wallet'));
    const first = (await status(one.a.attemptId, one.authCookie)).body.pilot!;
    const two = await attempt();
    await walletCall(signedCallback(two.a.lnurl, 'bob-wallet'));
    const second = (await status(two.a.attemptId, two.authCookie)).body.pilot!;
    expect(second.publicName).toBe(first.publicName);
    const rows = srv.built.db.prepare('SELECT * FROM pilots').all();
    expect(JSON.stringify(rows)).not.toMatch(/0[23][0-9a-f]{64}/);
  });

  it('rejects a reused k1, a forged signature, a wrong key, bad formats and the wrong tag', async () => {
    const { a } = await attempt();
    const good = signedCallback(a.lnurl, 'carol-wallet');
    expect(await walletCall(good)).toEqual({ status: 'OK' });
    expect(await walletCall(good)).toMatchObject({ status: 'ERROR', reason: 'k1 already used' });

    const b = await attempt();
    const forged = new URL(signedCallback(b.a.lnurl, 'mallory'));
    const sig = forged.searchParams.get('sig')!;
    forged.searchParams.set(
      'sig',
      sig.slice(0, -4) + (sig.endsWith('00') ? '11' : '00') + sig.slice(-2),
    );
    expect(await walletCall(forged.toString())).toMatchObject({ status: 'ERROR' });
    // A failed signature burns the challenge.
    expect(await walletCall(signedCallback(b.a.lnurl, 'mallory'))).toMatchObject({
      status: 'ERROR',
    });
    expect((await status(b.a.attemptId, b.authCookie)).body.status).toBe('FAILED');

    const c = await attempt();
    const swapped = new URL(signedCallback(c.a.lnurl, 'dave'));
    swapped.searchParams.set(
      'key',
      new URL(signedCallback(c.a.lnurl, 'erin')).searchParams.get('key')!,
    );
    expect(await walletCall(swapped.toString())).toEqual({
      status: 'ERROR',
      reason: 'invalid signature',
    });

    const d = await attempt();
    const k1 = new URL(d.a.callbackUrl).searchParams.get('k1');
    expect(
      await walletCall(`${srv.origin}/api/auth/lnurl?tag=login&k1=${k1}&sig=zz&key=02ab`),
    ).toMatchObject({
      status: 'ERROR',
      reason: 'malformed k1, sig or key',
    });
    const wrongTag = new URL(signedCallback(d.a.lnurl, 'dave'));
    wrongTag.searchParams.set('tag', 'withdrawRequest');
    expect(await walletCall(wrongTag.toString())).toMatchObject({
      status: 'ERROR',
      reason: 'tag must be login',
    });
    // Malformed requests do not burn the challenge: the real wallet can still sign in.
    expect(await walletCall(signedCallback(d.a.lnurl, 'dave'))).toEqual({ status: 'OK' });
  });

  it('rejects an expired challenge', async () => {
    const { a, authCookie } = await attempt();
    srv.built.db.prepare("UPDATE auth_attempts SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect(await walletCall(signedCallback(a.lnurl, 'frank'))).toEqual({
      status: 'ERROR',
      reason: 'k1 expired',
    });
    expect((await status(a.attemptId, authCookie)).body.status).toBe('EXPIRED');
  });

  it('accepts a high-S DER signature from wallets that do not normalise', () => {
    const priv = secp256k1.utils.randomSecretKey();
    const pub = Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex');
    const k1 = Buffer.alloc(32, 7);
    const sig = secp256k1.Signature.fromBytes(secp256k1.sign(k1, priv, { prehash: false }));
    const high = new secp256k1.Signature(sig.r, secp256k1.Point.CURVE().n - sig.s);
    expect(verifyLoginSignature(k1.toString('hex'), high.toHex('der'), pub)).toBe(true);
    expect(verifyLoginSignature(Buffer.alloc(32, 8).toString('hex'), high.toHex('der'), pub)).toBe(
      false,
    );
  });

  it('one wallet, one phone: a new login ends the old phone session and tells it why', async () => {
    const one = await attempt();
    await walletCall(signedCallback(one.a.lnurl, 'gina'));
    const firstSession = cookiePair(
      (await status(one.a.attemptId, one.authCookie)).res,
      'sw_pilot',
    )!;
    const oldPhone = await srv.connect('/pilot', firstSession);
    const notices: Array<{ code: string }> = [];
    oldPhone.on('pilot:notice', (m: { code: string }) => notices.push(m));

    const two = await attempt();
    await walletCall(signedCallback(two.a.lnurl, 'gina'));
    const second = await status(two.a.attemptId, two.authCookie);
    expect(second.body.status).toBe('AUTHORIZED');
    await eventually(() => notices.some((n) => n.code === 'SESSION_REPLACED'));
    const old = (await (await srv.fetch('/api/session', { cookie: firstSession })).json()) as {
      authenticated: boolean;
    };
    expect(old.authenticated).toBe(false);
    const fresh = await srv.connect('/pilot', cookiePair(second.res, 'sw_pilot')!);
    const st = await new Promise<SessionStatusMsg>((r) => fresh.once('pilot:sessionStatus', r));
    expect(st.pilot?.kind).toBe('LNURL');
  });

  it('never logs the k1, signature or key', async () => {
    const { a } = await attempt();
    const u = new URL(signedCallback(a.lnurl, 'henry'));
    const line = JSON.stringify(
      logRequest({ method: 'GET', url: `${u.pathname}${u.search}`, ip: '1.2.3.4' }),
    );
    expect(line).toContain('/api/auth/lnurl');
    expect(line).not.toMatch(/k1|sig=|key=|[0-9a-f]{64}/);
  });
});
