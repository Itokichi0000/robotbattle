import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bech32Encode, encodeLnurl, mockWalletSign, verifyLnurlSignature } from '../src/auth/lnurl';
import { type TestServer, auth, guest, makeServer } from './helpers';

let s: TestServer | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

function wallet() {
  const priv = secp256k1.utils.randomSecretKey();
  const key = Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex');
  const sign = (k1: string, opts: { lowS?: boolean } = {}) =>
    Buffer.from(
      secp256k1.sign(Buffer.from(k1, 'hex'), priv, {
        prehash: false,
        format: 'der',
        lowS: opts.lowS ?? true,
      }),
    ).toString('hex');
  return { priv, key, sign };
}

describe('LNURL encoding (LUD-01)', () => {
  it('matches the LUD-01 example', () => {
    const url =
      'https://service.com/api?q=3fc3645b439ce8e7f2553a69e5267081d96dcd340693afabe04be7b0ccd178df';
    expect(encodeLnurl(url)).toBe(
      'LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS',
    );
  });
  it('produces valid bech32 checksums (BIP-173 vector)', () => {
    expect(bech32Encode('a', new Uint8Array())).toBe('a12uel5l');
  });
});

describe('LUD-04 signature verification', () => {
  const k1 = randomBytes(32).toString('hex');
  const w = wallet();

  it('accepts a DER signature of the raw k1 by the compressed key (low and high S)', () => {
    expect(verifyLnurlSignature(k1, w.sign(k1), w.key)).toBe(true);
    expect(verifyLnurlSignature(k1, w.sign(k1, { lowS: false }), w.key)).toBe(true);
  });

  it('rejects tampering, other keys, bad DER, uncompressed or malformed keys, wrong k1', () => {
    const sig = w.sign(k1);
    const flipped = sig.slice(0, -2) + (sig.endsWith('00') ? '01' : '00');
    expect(verifyLnurlSignature(k1, flipped, w.key)).toBe(false);
    expect(verifyLnurlSignature(k1, sig, wallet().key)).toBe(false);
    expect(verifyLnurlSignature(k1, 'deadbeef'.repeat(8), w.key)).toBe(false);
    const uncompressed = Buffer.from(secp256k1.getPublicKey(w.priv, false)).toString('hex');
    expect(verifyLnurlSignature(k1, sig, uncompressed)).toBe(false);
    expect(verifyLnurlSignature(k1, sig, `04${w.key.slice(2)}`)).toBe(false);
    expect(verifyLnurlSignature(k1, sig, 'zz')).toBe(false);
    expect(verifyLnurlSignature(randomBytes(32).toString('hex'), sig, w.key)).toBe(false);
    expect(verifyLnurlSignature(k1.slice(2), sig, w.key)).toBe(false);
    // Signing sha256(k1) (prehash) instead of the raw bytes is not LUD-04.
    const prehashed = Buffer.from(
      secp256k1.sign(Buffer.from(k1, 'hex'), w.priv, { format: 'der' }),
    ).toString('hex');
    expect(verifyLnurlSignature(k1, prehashed, w.key)).toBe(false);
  });
});

/** Start a login like the browser does; returns the challenge and its binding cookie. */
async function start(srv: TestServer, purpose: 'LOGIN' | 'LINK' = 'LOGIN', token?: string) {
  const res = await srv.inject({
    method: 'POST',
    url: '/api/auth/lightning/start',
    payload: { purpose },
    headers: token ? auth(token) : {},
  });
  expect(res.statusCode).toBe(200);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] as string | string[]);
  const bind = cookies.find((c) => c.startsWith('sw_lnurl_bind='))!.split(';')[0]!;
  const body = res.json();
  return { ...body, bind } as {
    challengeId: string;
    lnurl: string;
    expiresAt: number;
    bind: string;
  };
}

const ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function decodeLnurl(lnurl: string): string {
  const lower = lnurl.toLowerCase();
  const data = lower.slice(lower.lastIndexOf('1') + 1, -6);
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const ch of data) {
    acc = (acc << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 0xff);
    }
  }
  return Buffer.from(out).toString('utf8');
}

async function callback(
  srv: TestServer,
  lnurl: string,
  w: ReturnType<typeof wallet>,
  k1Override?: string,
) {
  const url = new URL(decodeLnurl(lnurl));
  const k1 = k1Override ?? url.searchParams.get('k1')!;
  const res = await srv.inject({
    url: `/api/auth/lightning/callback?${url.searchParams.toString()}&sig=${w.sign(k1)}&key=${w.key}`,
  });
  return res.json();
}

describe('LNURL-auth login flow', () => {
  it('wallet callback → bound browser gets a Lightning session; replay and other browsers fail', async () => {
    s = await makeServer({
      env: { AUTH_MODE: 'both', SERVER_PUBLIC_URL: 'https://satswars.example' },
    });
    const ch = await start(s);
    expect(ch.lnurl).toMatch(/^LNURL1/);
    expect(decodeLnurl(ch.lnurl)).toMatch(
      /^https:\/\/satswars\.example\/api\/auth\/lightning\/callback\?tag=login&k1=[0-9a-f]{64}&action=login$/,
    );
    const w = wallet();
    // Before the wallet signs: pending.
    expect(
      (
        await s.inject({
          url: `/api/auth/lightning/status/${ch.challengeId}`,
          headers: { cookie: ch.bind },
        })
      ).json().status,
    ).toBe('PENDING');
    // A bad signature is refused and leaves the challenge usable.
    const url = new URL(decodeLnurl(ch.lnurl));
    const bad = await s.inject({
      url: `/api/auth/lightning/callback?${url.searchParams}&sig=${wallet().sign(url.searchParams.get('k1')!)}&key=${w.key}`,
    });
    expect(bad.json()).toEqual({ status: 'ERROR', reason: 'invalid signature' });
    expect(await callback(s, ch.lnurl, w)).toEqual({ status: 'OK' });
    // Replaying the same callback fails (single-use k1).
    expect((await callback(s, ch.lnurl, w)).status).toBe('ERROR');
    // Another browser without the binding cookie cannot claim the session.
    expect(
      (await s.inject({ url: `/api/auth/lightning/status/${ch.challengeId}` })).statusCode,
    ).toBe(404);
    const ok = await s.inject({
      url: `/api/auth/lightning/status/${ch.challengeId}`,
      headers: { cookie: ch.bind },
    });
    const body = ok.json();
    expect(body.status).toBe('VERIFIED');
    expect(body.pilot.authType).toBe('LIGHTNING');
    expect(body.pilot.lightningLinked).toBe(true);
    expect(String(ok.headers['set-cookie'])).toContain('sw_session=');
    // Consumed once.
    expect(
      (
        await s.inject({
          url: `/api/auth/lightning/status/${ch.challengeId}`,
          headers: { cookie: ch.bind },
        })
      ).json().status,
    ).toBe('FAILED');
    // The same wallet logs in to the same pilot next time.
    const ch2 = await start(s);
    await callback(s, ch2.lnurl, w);
    const again = (
      await s.inject({
        url: `/api/auth/lightning/status/${ch2.challengeId}`,
        headers: { cookie: ch2.bind },
      })
    ).json();
    expect(again.pilot.pilotId).toBe(body.pilot.pilotId);
  });

  it('expired challenges and missing parameters are refused', async () => {
    s = await makeServer({
      env: { AUTH_MODE: 'lnurl', SERVER_PUBLIC_URL: 'https://satswars.example' },
    });
    const ch = await start(s);
    expect(
      (await s.inject({ url: '/api/auth/lightning/callback?tag=login&k1=00' })).json().status,
    ).toBe('ERROR');
    s.clock.advance(121_000);
    const r = await callback(s, ch.lnurl, wallet());
    expect(r).toEqual({ status: 'ERROR', reason: 'k1 expired' });
    // Mock wallet is not available in lnurl-only mode.
    expect(
      (
        await s.inject({
          method: 'POST',
          url: '/api/auth/lightning/mock-approve',
          payload: { challengeId: ch.challengeId, walletSeed: 'seed-12345678' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('mock wallet (dev) runs the real verification; a guest can merge their history after confirming', async () => {
    s = await makeServer({ env: { DEMO_MODE: 'true' } });
    const g = await guest(s, { callsign: 'ゲスト太郎' });
    const ch = await start(s, 'LOGIN', g.token);
    const approve = await s.inject({
      method: 'POST',
      url: '/api/auth/lightning/mock-approve',
      headers: { cookie: ch.bind },
      payload: { challengeId: ch.challengeId, walletSeed: 'my-device-seed-1' },
    });
    expect(approve.json()).toEqual({ status: 'OK' });
    const st = (
      await s.inject({
        url: `/api/auth/lightning/status/${ch.challengeId}`,
        headers: { cookie: ch.bind, ...auth(g.token) },
      })
    ).json();
    expect(st.status).toBe('VERIFIED');
    expect(st.mergeOffer.guestCallsign).toBe('ゲスト太郎');
    const merged = await s.inject({
      method: 'POST',
      url: '/api/auth/merge-guest',
      headers: auth(st.token),
      payload: { token: st.mergeOffer.token },
    });
    expect(merged.statusCode).toBe(200);
    // The merge offer is single-use and the guest session is gone.
    expect(
      (
        await s.inject({
          method: 'POST',
          url: '/api/auth/merge-guest',
          headers: auth(st.token),
          payload: { token: st.mergeOffer.token },
        })
      ).statusCode,
    ).toBe(400);
    expect((await s.inject({ url: '/api/me', headers: auth(g.token) })).statusCode).toBe(401);
    // Same mock seed → same key → same pilot.
    expect(mockWalletSign('my-device-seed-1', '00'.repeat(32)).key).toBe(
      mockWalletSign('my-device-seed-1', '11'.repeat(32)).key,
    );
  });

  it('linking a second wallet needs the current session; a key linked elsewhere is refused', async () => {
    s = await makeServer({
      env: { AUTH_MODE: 'both', SERVER_PUBLIC_URL: 'https://satswars.example' },
    });
    expect(
      (
        await s.inject({
          method: 'POST',
          url: '/api/auth/lightning/start',
          payload: { purpose: 'LINK' },
        })
      ).statusCode,
    ).toBe(401);
    const a = await guest(s);
    const ch = await start(s, 'LINK', a.token);
    const w = wallet();
    expect(await callback(s, ch.lnurl, w)).toEqual({ status: 'OK' });
    const st = (
      await s.inject({
        url: `/api/auth/lightning/status/${ch.challengeId}`,
        headers: { cookie: ch.bind },
      })
    ).json();
    expect(st).toMatchObject({
      status: 'VERIFIED',
      purpose: 'LINK',
      pilot: { pilotId: a.pilotId, authType: 'LIGHTNING', lightningLinked: true },
    });
    const b = await guest(s);
    const ch2 = await start(s, 'LINK', b.token);
    expect((await callback(s, ch2.lnurl, w)).status).toBe('ERROR');
  });
});
