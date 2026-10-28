import type { TeamId } from '@sats-wars/shared';
import { storage } from '@/lib/api';

/**
 * Locally remembered player. Unlike the old per-match seat, a player lives
 * across seasons (credit carries over), so this is kept until the server says
 * the token is unknown.
 */
export interface PlaySession {
  token: string;
  playerId: string;
  teamId: TeamId;
  nickname: string;
}

const KEY = 'sw.player.v2';

export function loadSession(): PlaySession | null {
  storage.remove('sw.session'); // pre-ZAP-BATTLE seat, no longer meaningful
  const raw = storage.get(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as PlaySession;
    return s.token && s.playerId ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: PlaySession): void {
  storage.set(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  storage.remove(KEY);
}

/**
 * Random per-device id. The server (hashed) uses it to hand the same player —
 * and their remaining credit — back after a cleared tab or a new token.
 */
export function deviceId(): string {
  let id = storage.get('sw.device');
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    storage.set('sw.device', id);
  }
  return id;
}
