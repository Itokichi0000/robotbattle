import { randomBytes, randomUUID } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bech32 } from '@scure/base';
import type { Db } from './db';
import { nowIso, tx } from './db';
import type { PilotRow } from './sessions';
import { findOrCreateLnurlPilot, sha256 } from './sessions';

/**
 * LNURL-auth (LUD-04): pilot sign-in by signature. Free, never a payment (spec §7).
 * https://github.com/lnurl/luds/blob/luds/04.md
 *
 * 1. The phone creates an attempt: a 32-byte k1 from the CSPRNG, bound to this browser by a
 *    random cookie token (only its hash is stored), valid for ATTEMPT_TTL_MS, usable once.
 * 2. The wallet signs k1 with its domain-specific linking key and calls
 *    /api/auth/lnurl?tag=login&k1=..&sig=<DER hex>&key=<33-byte compressed pubkey hex>.
 * 3. The server checks format, k1 (exists, pending, unexpired, unused) and the secp256k1
 *    signature (noble, no hand-rolled crypto), then marks the attempt verified.
 * 4. Only the browser holding the attempt's cookie token can claim the session.
 */

export const ATTEMPT_TTL_MS = 5 * 60_000;
export const AUTH_COOKIE = 'sw_auth';

const HEX64 = /^[0-9a-f]{64}$/;
const KEY = /^0[23][0-9a-f]{64}$/;
const DER = /^30[0-9a-f]{12,140}$/;

export interface AttemptCreated {
  attemptId: string;
  k1: string;
  callbackUrl: string;
  /** LUD-01 bech32 form (uppercase, for QR codes and `lightning:` links). */
  lnurl: string;
  expiresAt: string;
  /** Goes into the HttpOnly `sw_auth` cookie; never returned in the body. */
  browserToken: string;
}

export function encodeLnurl(url: string): string {
  return bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), 2_000).toUpperCase();
}

export function createAttempt(db: Db, baseUrl: string, now = Date.now()): AttemptCreated {
  const attemptId = randomUUID();
  const k1 = randomBytes(32).toString('hex');
  const browserToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now + ATTEMPT_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO auth_attempts (id, k1, browser_token_hash, status, created_at, expires_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
  ).run(attemptId, k1, sha256(browserToken), new Date(now).toISOString(), expiresAt);
  const callbackUrl = `${baseUrl}/api/auth/lnurl?tag=login&k1=${k1}&action=login`;
  return { attemptId, k1, callbackUrl, lnurl: encodeLnurl(callbackUrl), expiresAt, browserToken };
}

/** Pure signature check; exported for tests. k1 is signed as-is (no extra hashing). */
export function verifyLoginSignature(k1Hex: string, sigHex: string, keyHex: string): boolean {
  try {
    return secp256k1.verify(
      Uint8Array.from(Buffer.from(sigHex, 'hex')),
      Uint8Array.from(Buffer.from(k1Hex, 'hex')),
      Uint8Array.from(Buffer.from(keyHex, 'hex')),
      // Wallets sign k1 directly; some emit high-S DER, which is still a valid signature.
      { prehash: false, format: 'der', lowS: false },
    );
  } catch {
    return false;
  }
}

export type CallbackResult = { status: 'OK' } | { status: 'ERROR'; reason: string };

/** The wallet's GET. Each k1 can succeed exactly once. */
export function handleCallback(
  db: Db,
  q: Record<string, unknown>,
  now = Date.now(),
): CallbackResult {
  const k1 = typeof q.k1 === 'string' ? q.k1.toLowerCase() : '';
  const sig = typeof q.sig === 'string' ? q.sig.toLowerCase() : '';
  const key = typeof q.key === 'string' ? q.key.toLowerCase() : '';
  if (q.tag !== 'login') return { status: 'ERROR', reason: 'tag must be login' };
  if (!HEX64.test(k1) || !DER.test(sig) || !KEY.test(key)) {
    return { status: 'ERROR', reason: 'malformed k1, sig or key' };
  }
  const row = db
    .prepare('SELECT id, status, expires_at FROM auth_attempts WHERE k1 = ?')
    .get(k1) as { id: string; status: string; expires_at: string } | undefined;
  if (!row) return { status: 'ERROR', reason: 'unknown k1' };
  if (row.status !== 'pending') return { status: 'ERROR', reason: 'k1 already used' };
  if (Date.parse(row.expires_at) < now) return { status: 'ERROR', reason: 'k1 expired' };
  if (!verifyLoginSignature(k1, sig, key)) {
    // A bad signature burns the challenge: no retries against the same k1.
    db.prepare(
      "UPDATE auth_attempts SET status = 'failed', error = 'bad signature' WHERE id = ? AND status = 'pending'",
    ).run(row.id);
    return { status: 'ERROR', reason: 'invalid signature' };
  }
  return tx(db, () => {
    const pilot = findOrCreateLnurlPilot(db, key);
    const r = db
      .prepare(
        "UPDATE auth_attempts SET status = 'verified', pilot_id = ?, verified_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(pilot.id, nowIso(), row.id);
    // Two wallets racing on one k1: only the first update wins.
    return Number(r.changes) === 1
      ? ({ status: 'OK' } as const)
      : { status: 'ERROR', reason: 'k1 already used' };
  });
}

export type AttemptStatus =
  | { status: 'PENDING'; expiresAt: string }
  | { status: 'EXPIRED' }
  | { status: 'FAILED'; reason: string }
  | { status: 'AUTHORIZED'; pilot: PilotRow }
  | { status: 'NOT_FOUND' };

/**
 * Polled by the phone that created the attempt. On first success it is "claimed": the
 * caller issues the session cookie. The attempt must be presented with its browser token.
 */
export function claimAttempt(
  db: Db,
  attemptId: string,
  browserToken: string | undefined,
  now = Date.now(),
): AttemptStatus {
  if (!browserToken) return { status: 'NOT_FOUND' };
  const row = db
    .prepare(
      'SELECT id, status, pilot_id, error, expires_at, browser_token_hash FROM auth_attempts WHERE id = ?',
    )
    .get(attemptId) as
    | {
        id: string;
        status: string;
        pilot_id: string | null;
        error: string | null;
        expires_at: string;
        browser_token_hash: string;
      }
    | undefined;
  if (!row || row.browser_token_hash !== sha256(browserToken)) return { status: 'NOT_FOUND' };
  if (row.status === 'failed') return { status: 'FAILED', reason: row.error ?? 'failed' };
  if (row.status === 'claimed') return { status: 'NOT_FOUND' };
  if (row.status === 'pending') {
    return Date.parse(row.expires_at) < now
      ? { status: 'EXPIRED' }
      : { status: 'PENDING', expiresAt: row.expires_at };
  }
  const claimed = db
    .prepare(
      "UPDATE auth_attempts SET status = 'claimed', claimed_at = ? WHERE id = ? AND status = 'verified'",
    )
    .run(nowIso(), row.id);
  if (Number(claimed.changes) !== 1) return { status: 'NOT_FOUND' };
  const pilot = db
    .prepare('SELECT id, public_name, kind, callsign, show_callsign FROM pilots WHERE id = ?')
    .get(row.pilot_id) as unknown as PilotRow;
  return { status: 'AUTHORIZED', pilot };
}
