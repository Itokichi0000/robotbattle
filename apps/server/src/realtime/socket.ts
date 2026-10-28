import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ArenaStatus, ClientToServerEvents, ClockTick, ServerNotice, ServerToClientEvents } from '@sats-wars/shared';
import { arenaStatusSchema, subscribeSchema } from '@sats-wars/shared';
import { SESSION_COOKIE, readCookie } from '../auth/sessions';
import type { Services } from '../services';

interface SocketData {
  role: 'arena' | 'pilot' | 'spectator' | 'admin' | null;
  pilotId: string | null;
}

export interface RealtimeStats {
  connections: number;
  byRole: Record<string, number>;
  arenas: Array<ArenaStatus & { socketId: string; updatedAt: number }>;
}

/**
 * Socket.IO fan-out. One authoritative process: every raid event goes to the
 * 'public' room with the same seq numbers the DB has, so clients detect gaps
 * and re-request a snapshot. Pilots also join a private room for pass grants.
 */
export function createRealtime(httpServer: HttpServer, services: Services, isAllowedOrigin: (origin: string | undefined) => boolean) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true },
    allowRequest: (req, cb) => cb(null, isAllowedOrigin(req.headers.origin)),
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 16_384,
  });
  const { manager, sessions, passes, actions, adminAuth, wall } = services;
  const arenaStatus = new Map<string, ArenaStatus & { socketId: string; updatedAt: number }>();

  io.on('connection', (socket) => {
    socket.data.role = null;
    socket.data.pilotId = null;
    void socket.join('public');

    socket.on('raid:subscribe', (raw, ack) => {
      const parsed = subscribeSchema.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false, error: 'BAD_REQUEST' });
      const { role, token } = parsed.data;
      if (role === 'admin') {
        if (!adminAuth.verify(token ?? null)) return ack?.({ ok: false, error: 'UNAUTHORIZED' });
        void socket.join('admin');
      }
      if (role === 'pilot') {
        const auth = sessions.authenticateToken(token ?? readCookie(socket.request.headers.cookie, SESSION_COOKIE));
        if (!auth) return ack?.({ ok: false, error: 'UNAUTHORIZED' });
        socket.data.pilotId = auth.pilot.id;
        void socket.join(`p:${auth.pilot.id}`);
      }
      if (role === 'arena') void socket.join('arena');
      socket.data.role = role;
      ack?.({ ok: true });
      socket.emit('raid:snapshot', manager.snapshot());
    });

    socket.on('raid:request-snapshot', (ack) => {
      const snap = manager.snapshot();
      if (typeof ack === 'function') ack(snap);
      else socket.emit('raid:snapshot', snap);
    });

    socket.on('time:sync', (_clientSentAt, ack) => {
      if (typeof ack === 'function') ack(wall.now());
    });

    socket.on('arena:status', (raw) => {
      if (socket.data.role !== 'arena') return;
      const parsed = arenaStatusSchema.safeParse(raw);
      if (!parsed.success) return;
      arenaStatus.set(socket.id, { ...parsed.data, socketId: socket.id, updatedAt: wall.now() });
    });

    socket.on('disconnect', () => {
      arenaStatus.delete(socket.id);
    });
  });

  manager.onEvents((events) => {
    for (const e of events) io.to('public').emit('raid:event', e);
  });
  manager.onRaidChanged(() => {
    io.to('public').emit('raid:snapshot', manager.snapshot());
  });
  passes.onEntitlement((pilotId, push) => {
    io.to(`p:${pilotId}`).emit('pilot:entitlement', push);
  });
  actions.onCheer((cheer) => {
    io.to('public').emit('raid:cheer', cheer);
  });

  let lastPresence = -1;
  const broadcastPresence = () => {
    const n = manager.pilotsOnline();
    if (n === lastPresence) return;
    lastPresence = n;
    io.to('public').emit('raid:presence', n);
  };

  const broadcastClock = () => {
    const snap = manager.current().snapshotBase();
    const tick: ClockTick = {
      raidId: snap.raidId,
      status: snap.status,
      clockMs: snap.clockMs,
      gameMs: snap.gameMs,
      liveStartClock: snap.liveStartClock,
      running: snap.running,
      serverTime: snap.serverTime,
      lastSeq: snap.lastSeq,
    };
    io.to('public').emit('raid:clock', tick);
  };

  /** Server-side snapshot fields without a game event (lobby countdown, switches, broadcast). */
  const broadcastSnapshot = () => io.to('public').emit('raid:snapshot', manager.snapshot());

  const stats = (): RealtimeStats => {
    const byRole: Record<string, number> = {};
    for (const s of io.sockets.sockets.values()) {
      const role = s.data.role ?? 'unknown';
      byRole[role] = (byRole[role] ?? 0) + 1;
    }
    const cutoff = wall.now() - 15_000;
    return { connections: io.engine.clientsCount, byRole, arenas: [...arenaStatus.values()].filter((a) => a.updatedAt > cutoff) };
  };

  const notice = (n: ServerNotice) => {
    io.to('public').emit('server:notice', n);
  };

  return { io, broadcastClock, broadcastPresence, broadcastSnapshot, stats, notice };
}

export type Realtime = ReturnType<typeof createRealtime>;
