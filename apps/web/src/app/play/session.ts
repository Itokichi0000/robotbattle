import type { TeamId } from '@sats-wars/shared';
import { storage } from '@/lib/api';

/** Locally remembered participation, so reloads/reconnects resume the same seat. */
export interface PlaySession {
  matchId: string;
  token: string;
  participantId: string;
  reservationId: string;
  teamId: TeamId;
  nickname: string;
}

const KEY = 'sw.session';

export function loadSession(): PlaySession | null {
  const raw = storage.get(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as PlaySession;
    return s.token && s.matchId ? s : null;
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

/** Random per-device id used server-side (hashed) to limit duplicate entries. */
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
