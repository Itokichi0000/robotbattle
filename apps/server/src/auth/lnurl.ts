import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import type { WallClock } from '../clock';
import type { ChallengeRow, PilotRow, Repo } from '../db/repo';
import { AppError } from '../errors';
import type { PilotService } from '../pilots/service';
import { newId, sha256 } from './tokens';

// ---------------------------------------------------------------------------
// bech32 (BIP-173) without the 90-char limit, as LNURL (LUD-01) requires.
// ---------------------------------------------------------------------------

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function toWords(bytes: Uint8Array): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

export function bech32Encode(hrp: string, data: Uint8Array): string {
  const words = toWords(data);
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join('')}`;
}

/** LUD-01: bech32("lnurl", utf8(url)), upper-cased for compact QR codes. */
export function encodeLnurl(url: string): string {
  return bech32Encode('lnurl', new TextEncoder().encode(url)).toUpperCase();
}

// ---------------------------------------------------------------------------
// LUD-04 signature check
// ---------------------------------------------------------------------------

const HEX = /^[0-9a-f]+$/;

/**
 * Verify a LUD-04 login: `sig` is a DER-encoded secp256k1 ECDSA signature of
 * the raw 32 `k1` bytes (no extra hashing) by the compressed 33-byte `key`.
 */
export function verifyLnurlSignature(k1Hex: string, sigHex: string, keyHex: string): boolean {
  if (k1Hex.length !== 64 || !HEX.test(k1Hex)) return false;
  if (keyHex.length !== 66 || !HEX.test(keyHex) || !/^0[23]/.test(keyHex)) return false;
  if (sigHex.length < 16 || sigHex.length > 146 || sigHex.length % 2 || !HEX.test(sigHex))
    return false;
  try {
    return secp256k1.verify(
      Buffer.from(sigHex, 'hex'),
      Buffer.from(k1Hex, 'hex'),
      Buffer.from(keyHex, 'hex'),
      {
        prehash: false,
        format: 'der',
        // Some wallets emit high-S signatures (openssl default); both are valid ECDSA.
        lowS: false,
      },
    );
  } catch {
    return false;
  }
}

/** Dev/test wallet: deterministic key per seed. Never used with real wallets. */
export function mockWalletSign(seed: string, k1Hex: string): { key: string; sig: string } {
  const priv = Buffer.from(sha256(`sats-wars-mock-wallet:${seed}`), 'hex');
  const key = Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex');
  const sig = Buffer.from(
    secp256k1.sign(Buffer.from(k1Hex, 'hex'), priv, { prehash: false, format: 'der' }),
  ).toString('hex');
  return { key, sig };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const CHALLENGE_TTL_MS = 120_000;
const MAX_CALLBACK_ATTEMPTS = 5;

export interface LnurlStart {
  challengeId: string;
  lnurl: string;
  /** Same URL as a lightning: deep link for same-device wallets. */
  deepLink: string;
  expiresAt: number;
  /** Random secret binding this challenge to the browser (sent as an HttpOnly cookie). */
  binding: string;
}

export type LnurlStatus =
  | { status: 'PENDING' | 'EXPIRED' | 'FAILED'; expiresAt: number }
  | { status: 'VERIFIED'; pilot: PilotRow; purpose: 'LOGIN' | 'LINK' };

/**
 * LNURL-auth (LUD-04). A login proves possession of a wallet's linking key for
 * this domain — it is NOT a real-world identity check, and the app never asks
 * for seeds, private keys, balances or payments here.
 *
 * Flow: start() creates a single-use k1 bound to the browser by a random
 * secret; the wallet calls callback() (atomic PENDING→VERIFIED, once); the
 * browser polls status() with the same binding secret and only then receives
 * a session. Another browser that sees the QR cannot claim the session.
 */
export class LnurlAuthService {
  constructor(
    private repo: Repo,
    private pilots: PilotService,
    private wall: WallClock,
    /** Fixed public base URL of this server (never derived from the request Host header). */
    private publicBaseUrl: string,
  ) {}

  get enabled(): boolean {
    return !!this.publicBaseUrl;
  }

  start(purpose: 'LOGIN' | 'LINK', pilotId: string | null): LnurlStart {
    return this.create(purpose, pilotId).start;
  }

  private create(
    purpose: 'LOGIN' | 'LINK',
    pilotId: string | null,
  ): { start: LnurlStart; k1: string } {
    if (purpose === 'LINK' && !pilotId) throw new AppError('UNAUTHORIZED', 'login required');
    const now = this.wall.now();
    const k1 = randomBytes(32).toString('hex');
    const binding = randomBytes(32).toString('base64url');
    const id = newId('ch');
    this.repo.insertChallenge({
      id,
      k1_hash: sha256(k1),
      session_binding_hash: sha256(binding),
      purpose,
      pilot_id: pilotId,
      status: 'PENDING',
      attempts: 0,
      result_pilot_id: null,
      expires_at: now + CHALLENGE_TTL_MS,
      used_at: null,
      created_at: now,
    });
    const base = (this.publicBaseUrl || 'http://localhost:4000').replace(/\/+$/, '');
    const url = `${base}/api/auth/lightning/callback?tag=login&k1=${k1}&action=${purpose === 'LINK' ? 'link' : 'login'}`;
    const lnurl = encodeLnurl(url);
    this.repo.purgeChallenges(now - 24 * 60 * 60_000);
    return {
      start: {
        challengeId: id,
        lnurl,
        deepLink: `lightning:${lnurl}`,
        expiresAt: now + CHALLENGE_TTL_MS,
        binding,
      },
      k1,
    };
  }

  /** Wallet callback (LUD-04). Returns the JSON the wallet expects. */
  callback(q: {
    k1?: string;
    sig?: string;
    key?: string;
  }): { status: 'OK' } | { status: 'ERROR'; reason: string } {
    const err = (reason: string) => ({ status: 'ERROR' as const, reason });
    const k1 = (q.k1 ?? '').toLowerCase();
    const sig = (q.sig ?? '').toLowerCase();
    const key = (q.key ?? '').toLowerCase();
    if (!k1 || !sig || !key) return err('missing k1, sig or key');
    const ch = this.repo.getChallengeByK1Hash(sha256(k1));
    if (!ch) return err('unknown or used k1');
    const now = this.wall.now();
    if (ch.status !== 'PENDING') return err('k1 already used');
    if (ch.expires_at <= now) {
      this.repo.setChallengeStatus(ch.id, 'EXPIRED');
      return err('k1 expired');
    }
    if (ch.attempts >= MAX_CALLBACK_ATTEMPTS) return err('too many attempts');
    this.repo.bumpChallengeAttempts(ch.id);
    if (!verifyLnurlSignature(k1, sig, key)) return err('invalid signature');
    const fingerprint = sha256(`lnurl:${key}`);
    try {
      return this.repo.tx(() => {
        const linked = this.repo.getAuthKey(fingerprint);
        let pilotId: string;
        if (ch.purpose === 'LINK') {
          if (linked && linked.revoked_at === null && linked.pilot_id !== ch.pilot_id)
            throw new AppError('BAD_REQUEST', 'this wallet is linked to another pilot');
          pilotId = ch.pilot_id!;
          if (!linked)
            this.repo.insertAuthKey(newId('key'), pilotId, 'LNURL_AUTH', fingerprint, now);
          this.repo.updatePilot(pilotId, { auth_type: 'LIGHTNING' });
        } else if (linked && linked.revoked_at === null) {
          pilotId = linked.pilot_id;
        } else {
          pilotId = this.pilots.create('LIGHTNING', undefined).id;
          this.repo.insertAuthKey(newId('key'), pilotId, 'LNURL_AUTH', fingerprint, now);
        }
        // Exactly one callback can win this flip (replays and races lose).
        if (!this.repo.verifyChallenge(ch.id, pilotId, now))
          throw new AppError('BAD_REQUEST', 'k1 already used');
        return { status: 'OK' as const };
      });
    } catch (e) {
      return err(e instanceof AppError ? e.message : 'verification failed');
    }
  }

  /**
   * Browser polling. Only the browser holding the binding secret can turn a
   * verified challenge into a session, and only once.
   */
  status(challengeId: string, binding: string | null): LnurlStatus {
    const ch = this.repo.getChallenge(challengeId);
    if (!ch || !binding || sha256(binding) !== ch.session_binding_hash)
      throw new AppError('NOT_FOUND', 'challenge not found');
    const now = this.wall.now();
    if (ch.status === 'PENDING' && ch.expires_at <= now) {
      this.repo.setChallengeStatus(ch.id, 'EXPIRED');
      return { status: 'EXPIRED', expiresAt: ch.expires_at };
    }
    if (ch.status === 'VERIFIED') {
      if (!this.repo.consumeChallenge(ch.id)) return { status: 'FAILED', expiresAt: ch.expires_at };
      const pilot = this.repo.getPilot(ch.result_pilot_id!);
      if (!pilot) return { status: 'FAILED', expiresAt: ch.expires_at };
      return { status: 'VERIFIED', pilot, purpose: ch.purpose };
    }
    if (ch.status === 'CONSUMED') return { status: 'FAILED', expiresAt: ch.expires_at };
    return {
      status: ch.status as Exclude<ChallengeRow['status'], 'VERIFIED' | 'CONSUMED'>,
      expiresAt: ch.expires_at,
    };
  }

  /** k1 values kept in memory only for mock approval (dev/test; real challenges store only a hash). */
  private mockK1 = new Map<string, string>();

  /** Dev only (AUTH_MODE=mock): a challenge the built-in mock wallet can sign. */
  startWithMock(purpose: 'LOGIN' | 'LINK', pilotId: string | null): LnurlStart {
    const { start, k1 } = this.create(purpose, pilotId);
    this.mockK1.set(start.challengeId, k1);
    setTimeout(() => this.mockK1.delete(start.challengeId), CHALLENGE_TTL_MS).unref?.();
    return start;
  }

  /** Dev only: sign with a mock wallet key and run the real callback verification. */
  mockApprove(
    challengeId: string,
    binding: string | null,
    walletSeed: string,
  ): { status: 'OK' } | { status: 'ERROR'; reason: string } {
    const ch = this.repo.getChallenge(challengeId);
    if (!ch || !binding || sha256(binding) !== ch.session_binding_hash)
      throw new AppError('NOT_FOUND', 'challenge not found');
    const k1 = this.mockK1.get(challengeId);
    if (!k1) return { status: 'ERROR', reason: 'mock challenge unavailable' };
    this.mockK1.delete(challengeId);
    const { key, sig } = mockWalletSign(walletSeed, k1);
    return this.callback({ k1, sig, key });
  }
}
