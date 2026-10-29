import { afterEach, describe, expect, it } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { nostrEventId, npubEncode, verifyLinkEvent } from '../src/auth/nostr';
import { type TestServer, auth, guest, makeServer } from './helpers';

let s: TestServer | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

function signed(sk: Uint8Array, challenge: string, domain: string, createdAt: number) {
  const pubkey = Buffer.from(schnorr.getPublicKey(sk)).toString('hex');
  const base = {
    pubkey,
    created_at: createdAt,
    kind: 22242,
    tags: [
      ['challenge', challenge],
      ['domain', domain],
    ],
    content: '',
  };
  const id = nostrEventId(base);
  const sig = Buffer.from(schnorr.sign(Buffer.from(id, 'hex'), sk)).toString('hex');
  return { ...base, id, sig };
}

describe('optional Nostr link (display only)', () => {
  it('NIP-19 npub encoding matches the spec test vector', () => {
    expect(npubEncode('3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d')).toBe(
      'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6',
    );
  });

  it('verifies the signed challenge; rejects tampering, other domains, stale events', () => {
    const sk = schnorr.utils.randomSecretKey();
    const now = 1_700_000_000_000;
    const e = signed(sk, 'c1', 'play.example', now / 1000);
    const expect1 = { challenge: 'c1', domain: 'play.example', nowMs: now };
    expect(verifyLinkEvent(e, expect1)).toMatchObject({ ok: true });
    expect(verifyLinkEvent({ ...e, content: 'x' }, expect1)).toMatchObject({ ok: false });
    expect(verifyLinkEvent(e, { ...expect1, challenge: 'c2' })).toMatchObject({ ok: false });
    expect(verifyLinkEvent(e, { ...expect1, domain: 'evil.example' })).toMatchObject({ ok: false });
    expect(verifyLinkEvent(e, { ...expect1, nowMs: now + 3_600_000 })).toMatchObject({ ok: false });
    const other = schnorr.utils.randomSecretKey();
    const forged = { ...e, sig: signed(other, 'c1', 'play.example', now / 1000).sig };
    expect(verifyLinkEvent(forged, expect1)).toMatchObject({ ok: false, reason: 'bad signature' });
  });

  it('off by default; when on: link once, challenge single-use, one key per pilot, unlink', async () => {
    s = await makeServer({ env: { DEMO_MODE: 'true' } });
    const a = await guest(s);
    const off = await s.inject({
      method: 'POST',
      url: '/api/me/nostr/challenge',
      headers: auth(a.token),
    });
    expect(off.statusCode).toBe(404);
    await s.close();

    s = await makeServer({ env: { DEMO_MODE: 'true', NOSTR_LINK: 'true' } });
    const p1 = await guest(s);
    const p2 = await guest(s);
    const sk = schnorr.utils.randomSecretKey();
    const link = async (who: typeof p1) => {
      const c = (
        await s!.inject({
          method: 'POST',
          url: '/api/me/nostr/challenge',
          headers: auth(who.token),
        })
      ).json();
      expect(c.kind).toBe(22242);
      const event = signed(sk, c.challenge, c.domain, Math.round(s!.clock.now() / 1000));
      const res = await s!.inject({
        method: 'POST',
        url: '/api/me/nostr/link',
        headers: auth(who.token),
        payload: { event },
      });
      return { res, event };
    };
    const first = await link(p1);
    expect(first.res.statusCode).toBe(200);
    expect(first.res.json().pilot.nostr.npub).toMatch(/^npub1/);
    // Replaying the same event: the challenge was used up.
    const replay = await s.inject({
      method: 'POST',
      url: '/api/me/nostr/link',
      headers: auth(p1.token),
      payload: { event: first.event },
    });
    expect(replay.statusCode).toBe(400);
    // Same key on another pilot is refused.
    expect((await link(p2)).res.statusCode).toBe(409);
    const shown = await s.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth(p1.token),
      payload: { nostrShowOnCard: true },
    });
    expect(shown.json().pilot.nostr.showOnCard).toBe(true);
    const un = await s.inject({ method: 'DELETE', url: '/api/me/nostr', headers: auth(p1.token) });
    expect(un.json().pilot.nostr).toEqual({ npub: null, showOnCard: false });
  });
});
