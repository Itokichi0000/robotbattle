import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type {
  ArenaStatus,
  ClientToServerEvents,
  ClockTick,
  ServerToClientEvents,
} from '@sats-wars/shared';
import { arenaStatusSchema, joinRoomSchema } from '@sats-wars/shared';
import type { Services } from '../services';

interface SocketData {
  role: 'arena' | 'player' | 'spectator' | 'admin' | null;
  participantId: string | null;
}

export interface RealtimeStats {
  connections: number;
  byRole: Record<string, number>;
  arenas: Array<ArenaStatus & { socketId: string; updatedAt: number }>;
}

export function createRealtime(
  httpServer: HttpServer,
  services: Services,
  isAllowedOrigin: (origin: string | undefined) => boolean,
) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
    {
      cors: {
        origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
        credentials: false,
      },
      allowRequest: (req, cb) => cb(null, isAllowedOrigin(req.headers.origin)),
      pingInterval: 10_000,
      pingTimeout: 8_000,
      maxHttpBufferSize: 16_384,
      connectionStateRecovery: undefined,
    },
  );
  const { manager, join, actions, adminAuth, wall } = services;
  const arenaStatus = new Map<string, ArenaStatus & { socketId: string; updatedAt: number }>();

  io.on('connection', (socket) => {
    socket.data.role = null;
    socket.data.participantId = null;
    void socket.join('public');

    socket.on('joinRoom', (raw, ack) => {
      const parsed = joinRoomSchema.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false, error: 'BAD_REQUEST' });
      const { role, token } = parsed.data;
      if (role === 'admin') {
        if (!adminAuth.verify(token ?? null)) return ack?.({ ok: false, error: 'UNAUTHORIZED' });
        void socket.join('admin');
      }
      if (role === 'player') {
        const p = join.authenticate(token ?? null);
        if (!p) return ack?.({ ok: false, error: 'UNAUTHORIZED' });
        socket.data.participantId = p.id;
        void socket.join(`p:${p.id}`);
      }
      if (role === 'arena') void socket.join('arena');
      socket.data.role = role;
      ack?.({ ok: true });
      socket.emit('matchSnapshot', manager.snapshot());
    });

    socket.on('requestSnapshot', (ack) => {
      const snap = manager.snapshot();
      if (typeof ack === 'function') ack(snap);
      else socket.emit('matchSnapshot', snap);
    });

    socket.on('timeSync', (_clientSentAt, ack) => {
      if (typeof ack === 'function') ack(wall.now());
    });

    socket.on('arenaStatus', (raw) => {
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
    for (const e of events) io.to('public').emit('matchEvent', e);
  });
  manager.onMatchChanged(() => {
    io.to('public').emit('matchSnapshot', manager.snapshot());
  });
  join.onPaymentStatus((participantId, status) => {
    io.to(`p:${participantId}`).emit('paymentStatus', status);
  });
  actions.onAck((participantId, ack) => {
    io.to(`p:${participantId}`).emit('actionAck', ack);
  });

  const broadcastClock = () => {
    const rt = manager.current();
    const snap = rt.snapshotBase();
    const tick: ClockTick = {
      matchId: snap.matchId,
      status: snap.status,
      clockMs: snap.clockMs,
      gameMs: snap.gameMs,
      liveStartClock: snap.liveStartClock,
      running: snap.running,
      serverTime: snap.serverTime,
      lastSeq: snap.lastSeq,
    };
    io.to('public').emit('clockTick', tick);
  };

  const stats = (): RealtimeStats => {
    const byRole: Record<string, number> = {};
    for (const s of io.sockets.sockets.values()) {
      const role = s.data.role ?? 'unknown';
      byRole[role] = (byRole[role] ?? 0) + 1;
    }
    const cutoff = wall.now() - 15_000;
    return {
      connections: io.engine.clientsCount,
      byRole,
      arenas: [...arenaStatus.values()].filter((a) => a.updatedAt > cutoff),
    };
  };

  const notice = (n: Parameters<ServerToClientEvents['serverNotice']>[0]) => {
    io.to('public').emit('serverNotice', n);
  };

  return { io, broadcastClock, stats, notice };
}

export type Realtime = ReturnType<typeof createRealtime>;
