import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { WallClock } from '../clock';
import { constantTimeEqual, newToken, sha256 } from './tokens';

/**
 * Operators. Two ways in:
 *  - named accounts (ADMIN_USERS) with a role and optional TOTP (RFC 6238),
 *    passwords stored as scrypt hashes (tools/admin-user.mjs makes them);
 *  - the shared ADMIN_PASSWORD (owner), kept for small events and dev; it can
 *    be turned off (ADMIN_SHARED_LOGIN=false) once named accounts exist.
 * A login returns a random session token (12 h); only its SHA-256 is kept.
 */
export const ADMIN_ROLES = ['viewer', 'operator', 'owner'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminUser {
  name: string;
  role: AdminRole;
  /** scrypt$N$r$p$salt$hash (base64url). */
  hash: string;
  /** Base32 TOTP secret; when set, a 6-digit code is required. */
  totp?: string;
}

interface Session {
  actor: string;
  role: AdminRole;
  expiresAt: number;
}

export function roleAllows(have: AdminRole, need: AdminRole): boolean {
  return ADMIN_ROLES.indexOf(have) >= ADMIN_ROLES.indexOf(need);
}

// ---- passwords (scrypt) --------------------------------------------------------

const N = 16384;
const R = 8;
const P = 1;

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const hash = scryptSync(password, salt, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// ---- TOTP (RFC 6238: HMAC-SHA1, 6 digits, 30 s) ----------------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function totpAt(secret: string, unixMs: number, step = 30): string {
  const counter = Math.floor(unixMs / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secret: string, code: string, unixMs: number): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((d) => constantTimeEqual(totpAt(secret, unixMs + d * 30_000), code));
}

/** ADMIN_USERS: "name:role:hash[:totp]" entries separated by ";" (hash contains $, no colons). */
export function parseAdminUsers(spec: string): AdminUser[] {
  return spec
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, role, hash, totp] = entry.split(':');
      if (!name || !/^[a-z0-9_.-]{2,32}$/i.test(name))
        throw new Error(`ADMIN_USERS: bad name in "${entry.slice(0, 20)}…"`);
      if (!ADMIN_ROLES.includes(role as AdminRole))
        throw new Error(`ADMIN_USERS: role of ${name} must be viewer, operator or owner`);
      if (!hash?.startsWith('scrypt$'))
        throw new Error(`ADMIN_USERS: ${name} needs a scrypt hash (pnpm admin:user)`);
      return { name, role: role as AdminRole, hash, ...(totp ? { totp } : {}) };
    });
}

export type LoginResult =
  | { ok: true; token: string; role: AdminRole; actor: string }
  | { ok: false; reason: 'BAD_CREDENTIALS' | 'OTP_REQUIRED' | 'SHARED_LOGIN_DISABLED' };

export class AdminAuth {
  private sessions = new Map<string, Session>();
  constructor(
    private opts: {
      password: string;
      wall: WallClock;
      users?: AdminUser[];
      /** Shared ADMIN_PASSWORD login allowed (default true). */
      sharedLogin?: boolean;
      /** Optional TOTP for the shared password. */
      sharedTotp?: string;
      ttlMs?: number;
    },
  ) {}

  private issue(actor: string, role: AdminRole): string {
    const token = newToken();
    this.sessions.set(sha256(token), {
      actor,
      role,
      expiresAt: this.opts.wall.now() + (this.opts.ttlMs ?? 12 * 60 * 60 * 1000),
    });
    return token;
  }

  login(input: { username?: string; password: string; otp?: string }): LoginResult {
    const now = this.opts.wall.now();
    if (input.username) {
      const user = this.opts.users?.find((u) => u.name === input.username);
      // Hash even for unknown names so timing does not reveal which exist.
      const ok = verifyPassword(input.password, user?.hash ?? hashPassword('x', Buffer.alloc(16)));
      if (!user || !ok) return { ok: false, reason: 'BAD_CREDENTIALS' };
      if (user.totp) {
        if (!input.otp) return { ok: false, reason: 'OTP_REQUIRED' };
        if (!verifyTotp(user.totp, input.otp, now)) return { ok: false, reason: 'BAD_CREDENTIALS' };
      }
      const actor = `admin:${user.name}`;
      return { ok: true, token: this.issue(actor, user.role), role: user.role, actor };
    }
    if (this.opts.sharedLogin === false) return { ok: false, reason: 'SHARED_LOGIN_DISABLED' };
    if (!input.password || !constantTimeEqual(input.password, this.opts.password))
      return { ok: false, reason: 'BAD_CREDENTIALS' };
    if (this.opts.sharedTotp) {
      if (!input.otp) return { ok: false, reason: 'OTP_REQUIRED' };
      if (!verifyTotp(this.opts.sharedTotp, input.otp, now))
        return { ok: false, reason: 'BAD_CREDENTIALS' };
    }
    return { ok: true, token: this.issue('admin', 'owner'), role: 'owner', actor: 'admin' };
  }

  verify(token: string | null): Session | null {
    if (!token) return null;
    const key = sha256(token);
    const s = this.sessions.get(key);
    if (!s) return null;
    if (s.expiresAt <= this.opts.wall.now()) {
      this.sessions.delete(key);
      return null;
    }
    return s;
  }

  logout(token: string | null): void {
    if (token) this.sessions.delete(sha256(token));
  }
}
