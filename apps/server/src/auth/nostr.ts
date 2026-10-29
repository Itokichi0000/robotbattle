import { createHash, randomBytes } from 'node:crypto';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bech32Encode } from './lnurl';

/**
 * Optional Nostr link (spec C10 / PART J): a pilot may attach a Nostr public
 * key to show on their own license card. It is never a login, never needed
 * to play, and the server never talks to relays, posts or zaps.
 *
 * Proof of key possession uses a NIP-42-style event signed in the browser by
 * a NIP-07 extension: kind 22242 with tags ["challenge", c] and ["domain", d].
 * The server checks the BIP-340 Schnorr signature over the NIP-01 event id,
 * a fresh one-time challenge bound to this pilot, the domain and the time.
 */
export const NOSTR_LINK_KIND = 22242;
const CHALLENGE_TTL_MS = 5 * 60_000;
const CLOCK_SKEW_S = 10 * 60;

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/** NIP-01 event id: sha256 of the canonical serialisation. */
export function nostrEventId(e: Omit<NostrEvent, 'id' | 'sig'>): string {
  return createHash('sha256')
    .update(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))
    .digest('hex');
}

/** NIP-19 npub (bech32 of the 32-byte x-only key). */
export function npubEncode(pubkeyHex: string): string {
  return bech32Encode('npub', Buffer.from(pubkeyHex, 'hex'));
}

export type LinkCheck = { ok: true; pubkey: string } | { ok: false; reason: string };

export function verifyLinkEvent(
  e: NostrEvent,
  expect: { challenge: string; domain: string; nowMs: number },
): LinkCheck {
  if (!e || typeof e !== 'object') return { ok: false, reason: 'malformed' };
  if (e.kind !== NOSTR_LINK_KIND) return { ok: false, reason: 'wrong kind' };
  if (!HEX64.test(e.pubkey) || !HEX64.test(e.id) || !HEX128.test(e.sig))
    return { ok: false, reason: 'malformed' };
  if (!Array.isArray(e.tags) || typeof e.content !== 'string' || !Number.isInteger(e.created_at))
    return { ok: false, reason: 'malformed' };
  const tag = (name: string) => e.tags.find((t) => Array.isArray(t) && t[0] === name)?.[1];
  if (tag('challenge') !== expect.challenge) return { ok: false, reason: 'challenge mismatch' };
  if (tag('domain') !== expect.domain) return { ok: false, reason: 'domain mismatch' };
  if (Math.abs(e.created_at - expect.nowMs / 1000) > CLOCK_SKEW_S)
    return { ok: false, reason: 'stale' };
  if (nostrEventId(e) !== e.id) return { ok: false, reason: 'id mismatch' };
  let valid = false;
  try {
    valid = schnorr.verify(
      Buffer.from(e.sig, 'hex'),
      Buffer.from(e.id, 'hex'),
      Buffer.from(e.pubkey, 'hex'),
    );
  } catch {
    valid = false;
  }
  return valid ? { ok: true, pubkey: e.pubkey } : { ok: false, reason: 'bad signature' };
}

/** One live challenge per pilot, single use, 5 minutes (one process, like the raid). */
export class NostrChallenges {
  private byPilot = new Map<string, { challenge: string; expiresAt: number }>();

  issue(pilotId: string, nowMs: number): { challenge: string; expiresAt: number } {
    const c = { challenge: randomBytes(32).toString('hex'), expiresAt: nowMs + CHALLENGE_TTL_MS };
    this.byPilot.set(pilotId, c);
    return c;
  }

  /** Returns the challenge once (and forgets it), or null when missing or expired. */
  take(pilotId: string, nowMs: number): string | null {
    const c = this.byPilot.get(pilotId);
    this.byPilot.delete(pilotId);
    return c && c.expiresAt > nowMs ? c.challenge : null;
  }
}
