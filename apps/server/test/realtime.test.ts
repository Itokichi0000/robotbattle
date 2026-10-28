import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { type Socket, io as connect } from 'socket.io-client';
import type {
  ClientToServerEvents,
  GameEvent,
  PublicMatchSnapshot,
  ServerToClientEvents,
} from '@sats-wars/shared';
import { MatchStore } from '@sats-wars/shared';
import { type TestServer, act, admin, joinAndPay, makeServer } from './helpers';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let s: TestServer | null = null;
const sockets: ClientSocket[] = [];
afterEach(async () => {
  for (const c of sockets.splice(0)) c.close();
  await s?.close();
  s = null;
});

async function listen(server: TestServer): Promise<string> {
  await server.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = server.app.server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

interface Client {
  socket: ClientSocket;
  store: MatchStore;
  events: GameEvent[];
  gaps: number;
}

async function client(url: string, role: 'arena' | 'player' | 'spectator' = 'spectator', token?: string) {
  const socket: ClientSocket = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const c: Client = { socket, store: new MatchStore(), events: [], gaps: 0 };
  socket.on('matchSnapshot', (snap) => c.store.applySnapshot(snap));
  socket.on('matchEvent', (e) => {
    c.events.push(e);
    if (c.store.applyEvent(e, Date.now()) === 'gap') {
      c.gaps++;
      socket.emit('requestSnapshot', (snap) => c.store.applySnapshot(snap));
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () =>
      socket.emit('joinRoom', { role, token }, (res) => (res.ok ? resolve() : reject(new Error(res.error)))),
    );
    socket.on('connect_error', reject);
  });
  await waitFor(() => c.store.snapshot !== null);
  return c;
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function comparable(snap: PublicMatchSnapshot | null) {
  if (!snap) return null;
  return { regions: snap.regions, teams: snap.teams, status: snap.status, lastSeq: snap.lastSeq, clashes: snap.clashes };
}

describe('realtime sync', () => {
  it('3+ clients converge to the server state via events', async () => {
    s = await makeServer();
    const url = await listen(s);
    const token = await s.adminToken();
    const clients = await Promise.all([client(url, 'arena'), client(url), client(url)]);
    await admin(s, token, { command: 'START' });
    const p1 = await joinAndPay(s, 'a');
    const p2 = await joinAndPay(s, 'b');
    const player = await client(url, 'player', p1.token);
    clients.push(player);
    await act(s, p1.token, 'ATTACK', 'kanto');
    await act(s, p2.token, 'ATTACK', 'kanto');
    await act(s, p1.token, 'CHARGE');
    await s.advance(46_000);
    const server = s.services.manager.snapshot();
    await waitFor(() => clients.every((c) => c.store.snapshot?.lastSeq === server.lastSeq));
    for (const c of clients) expect(comparable(c.store.snapshot)).toEqual(comparable(server));
    expect(clients.every((c) => c.gaps === 0)).toBe(true);
    // Events arrive in seq order without holes.
    const seqs = clients[0]!.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('a client that misses events detects the gap and resyncs from a snapshot', async () => {
    s = await makeServer();
    const url = await listen(s);
    const token = await s.adminToken();
    const c = await client(url);
    await admin(s, token, { command: 'START' });
    // Simulate a dropped message by removing the listener temporarily.
    c.socket.off('matchEvent');
    const p = await joinAndPay(s);
    await act(s, p.token, 'ATTACK', 'kanto');
    c.socket.on('matchEvent', (e) => {
      if (c.store.applyEvent(e, Date.now()) === 'gap') {
        c.gaps++;
        c.socket.emit('requestSnapshot', (snap) => c.store.applySnapshot(snap));
      }
    });
    await act(s, p.token, 'CHARGE');
    const server = s.services.manager.snapshot();
    await waitFor(() => c.store.snapshot?.lastSeq === server.lastSeq);
    expect(c.gaps).toBeGreaterThan(0);
    expect(comparable(c.store.snapshot)).toEqual(comparable(server));
  });

  it('reconnecting clients get a fresh snapshot', async () => {
    s = await makeServer();
    const url = await listen(s);
    const token = await s.adminToken();
    const c = await client(url);
    await admin(s, token, { command: 'START' });
    c.socket.disconnect();
    const p = await joinAndPay(s);
    await act(s, p.token, 'ATTACK', 'kinki');
    c.socket.connect();
    await new Promise<void>((resolve) => c.socket.once('connect', () => resolve()));
    c.socket.emit('joinRoom', { role: 'spectator' });
    const server = s.services.manager.snapshot();
    await waitFor(() => c.store.snapshot?.lastSeq === server.lastSeq);
    expect(c.store.snapshot?.regions.find((r) => r.regionId === 'kinki')?.ownerTeamId).toBe(p.teamId);
  });

  it('player sockets receive their own payment status and action acks only', async () => {
    s = await makeServer();
    const url = await listen(s);
    const token = await s.adminToken();
    await admin(s, token, { command: 'START' });
    const p1 = await joinAndPay(s, 'one');
    const p2 = await joinAndPay(s, 'two');
    const c1 = await client(url, 'player', p1.token);
    const c2 = await client(url, 'player', p2.token);
    const acks1: unknown[] = [];
    const acks2: unknown[] = [];
    c1.socket.on('actionAck', (a) => acks1.push(a));
    c2.socket.on('actionAck', (a) => acks2.push(a));
    await act(s, p1.token, 'CHARGE');
    await waitFor(() => acks1.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(acks2).toHaveLength(0);
  });

  it('rejects player/admin room joins with bad tokens', async () => {
    s = await makeServer();
    const url = await listen(s);
    await expect(client(url, 'player', 'x'.repeat(40))).rejects.toThrow('UNAUTHORIZED');
  });

  it('timeSync returns server time', async () => {
    s = await makeServer();
    const url = await listen(s);
    const c = await client(url);
    const t = await new Promise<number>((resolve) => c.socket.emit('timeSync', Date.now(), resolve));
    expect(t).toBe(s.clock.now());
  });
});
