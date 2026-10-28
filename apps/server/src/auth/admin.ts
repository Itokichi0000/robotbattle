import type { WallClock } from '../clock';
import { constantTimeEqual, newToken, sha256 } from './tokens';

interface Session {
  actor: string;
  expiresAt: number;
}

/**
 * Admin sessions: the operator types ADMIN_PASSWORD once and receives a random
 * session token (12h). The password itself is never sent to browsers by the app.
 */
export class AdminAuth {
  private sessions = new Map<string, Session>();
  constructor(
    private password: string,
    private wall: WallClock,
    private ttlMs = 12 * 60 * 60 * 1000,
  ) {}

  login(password: string, actor = 'admin'): string | null {
    if (!password || !constantTimeEqual(password, this.password)) return null;
    const token = newToken();
    this.sessions.set(sha256(token), { actor, expiresAt: this.wall.now() + this.ttlMs });
    return token;
  }

  verify(token: string | null): Session | null {
    if (!token) return null;
    const key = sha256(token);
    const s = this.sessions.get(key);
    if (!s) return null;
    if (s.expiresAt <= this.wall.now()) {
      this.sessions.delete(key);
      return null;
    }
    return s;
  }

  logout(token: string | null): void {
    if (token) this.sessions.delete(sha256(token));
  }
}
