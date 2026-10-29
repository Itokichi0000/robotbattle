import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { makePublicPilotName } from '@swed/shared';
import type { PilotIdentity } from '@swed/shared';
import type { Db } from './db';
import { nowIso } from './db';

/**
 * Cookie sessions. The browser holds a random token; the database stores only its
 * SHA-256, so a leaked database cannot be replayed as a login.
 */

export const PILOT_COOKIE = 'sw_pilot';
export const OPERATOR_COOKIE = 'sw_operator';
const PILOT_TTL_MS = 1000 * 60 * 60 * 24 * 3;
const OPERATOR_TTL_MS = 1000 * 60 * 60 * 14;

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface PilotRow {
  id: string;
  public_name: string;
  kind: PilotIdentity['kind'];
}

export function createDemoGuest(db: Db): { pilot: PilotRow; token: string } {
  const pilot: PilotRow = {
    id: randomUUID(),
    public_name: makePublicPilotName(randomBytes(2).toString('hex')),
    kind: 'DEMO_GUEST',
  };
  const now = nowIso();
  db.prepare(
    'INSERT INTO pilots (id, public_name, kind, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  ).run(pilot.id, pilot.public_name, pilot.kind, now, now);
  return { pilot, token: issuePilotSession(db, pilot.id) };
}

export function issuePilotSession(db: Db, pilotId: string): string {
  const token = newToken();
  db.prepare(
    'INSERT INTO pilot_sessions (token_hash, pilot_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(sha256(token), pilotId, nowIso(), new Date(Date.now() + PILOT_TTL_MS).toISOString());
  return token;
}

export function pilotForToken(db: Db, token: string | undefined): PilotRow | null {
  if (!token || token.length > 200) return null;
  const row = db
    .prepare(
      `SELECT p.id, p.public_name, p.kind FROM pilot_sessions s JOIN pilots p ON p.id = s.pilot_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), nowIso()) as PilotRow | undefined;
  return row ?? null;
}

export function revokePilotSession(db: Db, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM pilot_sessions WHERE token_hash = ?').run(sha256(token));
}

export function issueOperatorSession(db: Db): string {
  const token = newToken();
  db.prepare(
    'INSERT INTO operator_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)',
  ).run(sha256(token), nowIso(), new Date(Date.now() + OPERATOR_TTL_MS).toISOString());
  return token;
}

export function isOperatorToken(db: Db, token: string | undefined): boolean {
  if (!token || token.length > 200) return false;
  const row = db
    .prepare('SELECT 1 AS ok FROM operator_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(sha256(token), nowIso());
  return row !== undefined;
}

export function revokeOperatorSession(db: Db, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM operator_sessions WHERE token_hash = ?').run(sha256(token));
}

/** Constant-time password check (both sides hashed first so lengths match). */
export function passwordMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function cookieHeader(
  name: string,
  value: string,
  opts: { secure: boolean; maxAgeSec: number; sameSite: 'Lax' | 'Strict' },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${opts.sameSite}`,
    `Max-Age=${opts.maxAgeSec}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export const PILOT_COOKIE_MAX_AGE = PILOT_TTL_MS / 1000;
export const OPERATOR_COOKIE_MAX_AGE = OPERATOR_TTL_MS / 1000;
