import { MatchStore } from '@swed/client';
import type {
  OperatorClientToServer,
  OperatorCommand,
  OperatorCommandResult,
  OperatorServerToClient,
  OperatorStatusMsg,
} from '@swed/shared';
import { io, type Socket } from 'socket.io-client';

/** Staff console link. Every command is validated, applied and audited by the server. */
export const store = new MatchStore();

let status: OperatorStatusMsg | null = null;
const listeners = new Set<() => void>();
export const statusStore = {
  get: () => status,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const socket: Socket<OperatorServerToClient, OperatorClientToServer> = io('/operator', {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  tryAllTransports: true,
});
socket.on('connect', () => store.setConnection(true));
socket.on('disconnect', () => store.setConnection(false));
socket.on('match:snapshot', (m) => store.applySnapshot(m, performance.now()));
socket.on('match:event', (m) => store.applyEvent(m));
socket.on('operator:status', (s) => {
  status = s;
  for (const l of listeners) l();
});

export async function checkSession(): Promise<boolean> {
  try {
    const r = await fetch('/api/operator/session', { credentials: 'same-origin' });
    return ((await r.json()) as { authenticated: boolean }).authenticated;
  } catch {
    return false;
  }
}

export async function login(password: string): Promise<boolean> {
  const r = await fetch('/api/operator/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return r.ok;
}

export async function logout(): Promise<void> {
  await fetch('/api/operator/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  socket.disconnect();
}

export async function command(cmd: OperatorCommand): Promise<OperatorCommandResult> {
  try {
    return await socket.timeout(5_000).emitWithAck('operator:command', cmd);
  } catch {
    return { ok: false, message: 'no answer from server' };
  }
}
