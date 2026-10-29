import { MatchStore, newClientId } from '@swed/client';
import type {
  ActionResult,
  PilotActionInput,
  PilotClientToServer,
  PilotIdentity,
  PilotServerToClient,
  SeatId,
  SeatRequestResult,
  SessionStatusMsg,
} from '@swed/shared';
import { io, type Socket } from 'socket.io-client';

/**
 * Phone ↔ server. The phone sends raw intent only and shows what the server confirms.
 * Every action carries a clientActionId, so a retry after a flaky moment never fires twice.
 */

export const store = new MatchStore();

type Listener = () => void;
export interface PilotSessionState {
  loaded: boolean;
  authenticated: boolean;
  pilot: PilotIdentity | null;
  demoGuestEnabled: boolean;
  mode: 'sandbox' | 'live';
  status: SessionStatusMsg | null;
  error: string | null;
}

let session: PilotSessionState = {
  loaded: false,
  authenticated: false,
  pilot: null,
  demoGuestEnabled: false,
  mode: 'sandbox',
  status: null,
  error: null,
};
const listeners = new Set<Listener>();
function setSession(patch: Partial<PilotSessionState>) {
  session = { ...session, ...patch };
  for (const l of listeners) l();
}
export const sessionStore = {
  get: () => session,
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const socket: Socket<PilotServerToClient, PilotClientToServer> = io('/pilot', {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  tryAllTransports: true,
  reconnectionDelay: 400,
  reconnectionDelayMax: 2_500,
});

socket.on('connect', () => store.setConnection(true));
socket.on('disconnect', () => store.setConnection(false));
socket.on('connect_error', (err) => {
  if (err.message === 'NOT_AUTHENTICATED') {
    socket.disconnect();
    setSession({ authenticated: false, pilot: null, status: null });
  }
});
socket.on('match:snapshot', (m) => store.applySnapshot(m, performance.now()));
socket.on('match:event', (m) => store.applyEvent(m));
socket.on('pilot:sessionStatus', (s) => setSession({ status: s }));

export async function loadSession(): Promise<void> {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    const body = (await res.json()) as {
      authenticated: boolean;
      pilot: PilotIdentity | null;
      demoGuestEnabled: boolean;
      mode: 'sandbox' | 'live';
    };
    setSession({ loaded: true, error: null, ...body });
    if (body.authenticated && !socket.connected) socket.connect();
  } catch {
    setSession({ loaded: true, error: 'NETWORK' });
  }
}

export async function signInDemoGuest(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/demo-guest', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      setSession({ error: res.status === 403 ? 'DEMO_DISABLED' : 'SIGNIN_FAILED' });
      return false;
    }
    await loadSession();
    return true;
  } catch {
    setSession({ error: 'NETWORK' });
    return false;
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  } finally {
    socket.disconnect();
    setSession({ authenticated: false, pilot: null, status: null });
  }
}

function matchId(): string {
  return session.status?.matchId ?? store.getState().snap?.matchId ?? '';
}

async function ack<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export function joinSeat(seatId: SeatId): Promise<SeatRequestResult> {
  return ack(
    () =>
      socket
        .timeout(5_000)
        .emitWithAck('pilot:joinSeat', { matchId: matchId(), seatId, requestId: newClientId('r') }),
    { ok: false, reasonCode: 'NETWORK' },
  );
}

export function ready(): Promise<SeatRequestResult> {
  return ack(
    () =>
      socket
        .timeout(5_000)
        .emitWithAck('pilot:ready', { matchId: matchId(), requestId: newClientId('r') }),
    { ok: false, reasonCode: 'NETWORK' },
  );
}

export function leaveSeat(): Promise<SeatRequestResult> {
  return ack(() => socket.timeout(5_000).emitWithAck('pilot:leave', { matchId: matchId() }), {
    ok: true,
    seatId: null,
  });
}

/** Sends an intent; on a lost ack it retries once with the same id (the server dedupes). */
export async function sendAction(seatId: SeatId, action: PilotActionInput): Promise<ActionResult> {
  const clientActionId = newClientId('a');
  const req = { matchId: matchId(), seatId, clientActionId, action };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await socket.timeout(3_000).emitWithAck('pilot:action', req);
    } catch {
      if (!socket.connected) break;
    }
  }
  return { clientActionId, accepted: false, reasonCode: 'NETWORK' };
}

export function haptic(ms = 12): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported (iOS Safari) */
  }
}
