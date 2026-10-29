import type { FastifyReply, FastifyRequest } from 'fastify';
import type { WallClock } from '../clock';
import type { AuthKind, PilotRow, Repo, SessionRow } from '../db/repo';
import { extractBearer, newToken, sha256 } from './tokens';

export const SESSION_COOKIE = 'sw_session';

const TTL: Record<AuthKind, number> = {
  // Guests are short-lived by design; Lightning pilots come back across events.
  GUEST: 3 * 24 * 60 * 60_000,
  MOCK: 30 * 24 * 60 * 60_000,
  LIGHTNING: 30 * 24 * 60 * 60_000,
};

/** Add a Set-Cookie header without dropping ones set earlier in the same reply. */
export function appendCookie(reply: FastifyReply, cookie: string): void {
  const prev = reply.getHeader('set-cookie');
  const list = prev === undefined ? [] : Array.isArray(prev) ? prev.map(String) : [String(prev)];
  reply.header('set-cookie', [...list, cookie]);
}

/** Read one cookie from a raw Cookie header (no dependency needed for one value). */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{16,128}$/.test(v) ? v : null;
    }
  }
  return null;
}

export interface Authenticated {
  pilot: PilotRow;
  session: SessionRow;
  /** Raw token (needed only to bind LNURL challenges to this browser session). */
  token: string;
  via: 'cookie' | 'bearer';
}

/**
 * Pilot sessions. Browsers get an HttpOnly, SameSite=Lax cookie (never
 * readable by page scripts); API clients (tests, bots, load tests) may send the
 * same token as a Bearer header. Only the SHA-256 of a token is stored.
 */
export class SessionService {
  constructor(
    private repo: Repo,
    private wall: WallClock,
    private secureCookies: boolean,
  ) {}

  issue(pilotId: string, kind: AuthKind): { token: string; expiresAt: number } {
    const token = newToken();
    const now = this.wall.now();
    const expiresAt = now + TTL[kind];
    this.repo.insertSession({
      id_hash: sha256(token),
      pilot_id: pilotId,
      kind,
      issued_at: now,
      expires_at: expiresAt,
      revoked_at: null,
    });
    return { token, expiresAt };
  }

  authenticateToken(
    token: string | null,
    via: Authenticated['via'] = 'bearer',
  ): Authenticated | null {
    if (!token) return null;
    const session = this.repo.getSession(sha256(token));
    if (!session || session.revoked_at !== null || session.expires_at <= this.wall.now())
      return null;
    const pilot = this.repo.getPilot(session.pilot_id);
    if (!pilot) return null;
    return { pilot, session, token, via };
  }

  authenticate(req: FastifyRequest): Authenticated | null {
    const bearer = extractBearer(req.headers.authorization);
    if (bearer) return this.authenticateToken(bearer, 'bearer');
    return this.authenticateToken(readCookie(req.headers.cookie, SESSION_COOKIE), 'cookie');
  }

  setCookie(reply: FastifyReply, token: string, expiresAt: number): void {
    const maxAge = Math.max(0, Math.floor((expiresAt - this.wall.now()) / 1000));
    appendCookie(
      reply,
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${this.secureCookies ? '; Secure' : ''}`,
    );
  }

  clearCookie(reply: FastifyReply): void {
    appendCookie(
      reply,
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.secureCookies ? '; Secure' : ''}`,
    );
  }

  get secure(): boolean {
    return this.secureCookies;
  }

  revoke(token: string): void {
    this.repo.revokeSession(sha256(token), this.wall.now());
  }

  revokeAll(pilotId: string): number {
    return this.repo.revokeAllSessions(pilotId, this.wall.now());
  }
}
