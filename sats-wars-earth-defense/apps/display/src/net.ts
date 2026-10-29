import { MatchStore } from '@swed/client';
import type {
  DisplayClientToServer,
  DisplayServerToClient,
  DisplaySettings,
  JoinInfo,
} from '@swed/shared';
import { io, type Socket } from 'socket.io-client';

/** The display is read-only: it renders the server's match and reports only its own FPS. */
export const store = new MatchStore();

type Listener = () => void;
function observable<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      for (const l of listeners) l();
    },
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const settings = observable<DisplaySettings>({
  volume: 0.8,
  muted: false,
  quality: 'CINEMATIC',
  reduceFlash: false,
});

export const joinInfo = observable<JoinInfo | null>(null);

export const socket: Socket<DisplayServerToClient, DisplayClientToServer> = io('/display', {
  transports: ['websocket', 'polling'],
  tryAllTransports: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3_000,
});

socket.on('connect', () => store.setConnection(true));
socket.on('disconnect', () => store.setConnection(false));
socket.on('match:snapshot', (m) => store.applySnapshot(m, performance.now()));
socket.on('match:event', (m) => store.applyEvent(m));
socket.on('display:settings', (s) => settings.set(s));

async function loadJoinInfo(attempt = 0): Promise<void> {
  try {
    const res = await fetch('/api/public/join');
    if (!res.ok) throw new Error(String(res.status));
    joinInfo.set((await res.json()) as JoinInfo);
  } catch {
    setTimeout(() => void loadJoinInfo(attempt + 1), Math.min(10_000, 1_000 * 2 ** attempt));
  }
}
void loadJoinInfo();
