import { MatchStore, newClientId } from '@swed/client';
import type {
  ActionKind,
  ActionResult,
  PaymentIntentView,
  PaymentsStatus,
  PilotClientToServer,
  PilotIdentity,
  PilotServerToClient,
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
  /** Shown once: why this phone was signed out. */
  notice: 'SESSION_REPLACED' | 'KICKED' | null;
  lnurlDomain: string;
}

let session: PilotSessionState = {
  loaded: false,
  authenticated: false,
  pilot: null,
  demoGuestEnabled: false,
  mode: 'sandbox',
  status: null,
  error: null,
  notice: null,
  lnurlDomain: '',
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
socket.on('pilot:sessionStatus', (s) => setSession({ status: s, pilot: s.pilot ?? session.pilot }));
socket.on('pilot:notice', (n) => {
  if (n.code === 'SESSION_REPLACED') {
    // The same wallet signed in elsewhere: this phone is no longer the pilot.
    socket.disconnect();
    setSession({ notice: n.code, authenticated: false, pilot: null, status: null });
  } else {
    setSession({ notice: n.code });
  }
});
socket.on('payment:status', (v) => setPayments({ intent: v }));

export function clearNotice(): void {
  setSession({ notice: null });
}

export async function loadSession(): Promise<void> {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    const body = (await res.json()) as {
      authenticated: boolean;
      pilot: PilotIdentity | null;
      demoGuestEnabled: boolean;
      mode: 'sandbox' | 'live';
      lnurlDomain: string;
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

/** Sends one button press; on a lost ack it retries once with the same id (the server dedupes). */
export async function sendAction(kind: ActionKind): Promise<ActionResult> {
  const clientActionId = newClientId('a');
  const req = { matchId: matchId(), clientActionId, action: { kind } };
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

/* ------------------------------------------------------------- LNURL-auth */

export interface LnurlAttempt {
  attemptId: string;
  lnurl: string;
  expiresAt: string;
  qrSvg: string;
}

export async function startLnurl(): Promise<LnurlAttempt | null> {
  try {
    const res = await fetch('/api/auth/attempt', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return null;
    return (await res.json()) as LnurlAttempt;
  } catch {
    return null;
  }
}

export type LnurlPoll = 'PENDING' | 'AUTHORIZED' | 'EXPIRED' | 'FAILED' | 'NOT_FOUND' | 'NETWORK';

export async function pollLnurl(attemptId: string): Promise<LnurlPoll> {
  try {
    const res = await fetch(`/api/auth/attempt/${encodeURIComponent(attemptId)}/status`, {
      credentials: 'same-origin',
    });
    const body = (await res.json()) as { status: LnurlPoll };
    if (body.status === 'AUTHORIZED') await loadSession();
    return body.status;
  } catch {
    return 'NETWORK';
  }
}

/* --------------------------------------------------------------- callsign */

export async function saveCallsign(
  callsign: string | null,
  showOnScreen: boolean,
): Promise<boolean> {
  try {
    const res = await fetch('/api/pilot/callsign', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callsign, showOnScreen }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------ Lightning actions */

export interface PaymentsState {
  /** The action the open pay sheet is for (null = closed). */
  action: ActionKind | null;
  quote: PaymentsStatus | null;
  intent: PaymentIntentView | null;
  error: string | null;
  retryAfterMs: number | null;
}

let payments: PaymentsState = {
  action: null,
  quote: null,
  intent: null,
  error: null,
  retryAfterMs: null,
};
const payListeners = new Set<Listener>();
function setPayments(patch: Partial<PaymentsState>) {
  payments = { ...payments, ...patch };
  for (const l of payListeners) l();
}
export const paymentsStore = {
  get: () => payments,
  subscribe: (l: Listener) => {
    payListeners.add(l);
    return () => payListeners.delete(l);
  },
};

export async function loadQuote(): Promise<void> {
  try {
    const res = await fetch('/api/payments/quote', { credentials: 'same-origin' });
    if (res.ok) setPayments({ quote: (await res.json()) as PaymentsStatus });
  } catch {
    /* keep the last quote; the game does not depend on it */
  }
}

/** Opens the pay sheet for one action; nothing is billed until the pilot confirms. */
export function openPay(action: ActionKind): void {
  setPayments({ action, intent: null, error: null, retryAfterMs: null });
  void loadQuote();
}

/** Creates the invoice only after the pilot confirmed amount and receiver on screen. */
export async function requestPaid(): Promise<void> {
  const action = payments.action;
  if (!action) return;
  setPayments({ error: null, retryAfterMs: null });
  try {
    const res = await fetch('/api/payments/intent', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matchId: matchId(), action }),
    });
    const body = (await res.json()) as PaymentIntentView & {
      error?: string;
      retryAfterMs?: number | null;
    };
    if (!res.ok)
      setPayments({
        error: body.error ?? 'BACKEND_UNAVAILABLE',
        retryAfterMs: body.retryAfterMs ?? null,
      });
    else setPayments({ intent: body });
  } catch {
    setPayments({ error: 'BACKEND_UNAVAILABLE' });
  }
  void loadQuote();
}

export async function refreshIntent(): Promise<void> {
  const id = payments.intent?.intentId;
  if (!id) return;
  try {
    const res = await fetch(`/api/payments/intent/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
    });
    if (res.ok) setPayments({ intent: (await res.json()) as PaymentIntentView });
  } catch {
    /* status also arrives over the socket */
  }
}

export function closePay(): void {
  setPayments({ action: null, intent: null, error: null, retryAfterMs: null });
  // "N left" under the buttons counts this payment from now on.
  void loadQuote();
}
