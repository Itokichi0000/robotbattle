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
import type { CheerPush, CreditPush } from '@sats-wars/shared';
import { type TestServer, admin, fundedPlayer, joinTeam, makeServer, topup, untilRound, zap } from './helpers';

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

async function client(
  url: string,
  role: 'arena' | 'player' | 'spectator' = 'spectator',
  token?: string,
) {
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
      socket.emit('joinRoom', { role, token }, (res) =>
        res.ok ? resolve() : reject(new Error(res.error)),
      ),
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
  return {
    regions: snap.regions,
    teams: snap.teams,
    status: snap.status,
    phase: snap.phase,
    round: snap.round,
    rounds: snap.rounds,
    lastSeq: snap.lastSeq,
  };
}

describe('realtime sync', () => {
  it('3+ clients converge to the server state via events', async () => {
    s = await makeServer();
    const url = await listen(s);
    const clients = await Promise.all([client(url, 'arena'), client(url), client(url)]);
    const p1 = await fundedPlayer(s, 'RAIJIN', 525, 'a');
    const p2 = await fundedPlayer(s, 'FUJIN', 525, 'b');
    const player = await client(url, 'player', p1.token);
    clients.push(player);
    await untilRound(s);
    for (let i = 0; i < 12; i++) {
      await zap(s, p1.token);
      await zap(s, p2.token);
      await s.advance(300);
    }
    await s.advance(61_000);
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
    const p = await fundedPlayer(s);
    await untilRound(s);
    const c = await client(url);
    // Simulate a dropped message by removing the listener temporarily.
    c.socket.off('matchEvent');
    await zap(s, p.token);
    await s.advance(300);
    // Let the in-flight event arrive (and be dropped) before listening again.
    await new Promise((r) => setTimeout(r, 100));
    c.socket.on('matchEvent', (e) => {
      if (c.store.applyEvent(e, Date.now()) === 'gap') {
        c.gaps++;
        c.socket.emit('requestSnapshot', (snap) => c.store.applySnapshot(snap));
      }
    });
    await zap(s, p.token);
    const server = s.services.manager.snapshot();
    await waitFor(() => c.store.snapshot?.lastSeq === server.lastSeq);
    expect(c.gaps).toBeGreaterThan(0);
    expect(comparable(c.store.snapshot)).toEqual(comparable(server));
  });

  it('reconnecting clients get a fresh snapshot', async () => {
    s = await makeServer();
    const url = await listen(s);
    const token = await s.adminToken();
    await admin(s, token, { command: 'SET_DEMO_BOTS', perTeam: 0 });
    const c = await client(url);
    c.socket.disconnect();
    const p = await fundedPlayer(s, 'FUJIN');
    await untilRound(s);
    await zap(s, p.token);
    c.socket.connect();
    await new Promise<void>((resolve) => c.socket.once('connect', () => resolve()));
    c.socket.emit('joinRoom', { role: 'spectator' });
    const server = s.services.manager.snapshot();
    await waitFor(() => c.store.snapshot?.lastSeq === server.lastSeq);
    expect(c.store.snapshot?.round?.hp.RAIJIN).toBe(server.round!.hpMax - 10);
  });

  it('credit updates go only to the paying player; cheers and presence go to every screen', async () => {
    s = await makeServer();
    const url = await listen(s);
    const p1 = await joinTeam(s, 'RAIJIN', { nickname: 'one' });
    const p2 = await joinTeam(s, 'FUJIN', { nickname: 'two' });
    const c1 = await client(url, 'player', p1.token);
    const c2 = await client(url, 'player', p2.token);
    const screen = await client(url, 'arena');
    const credit1: CreditPush[] = [];
    const credit2: CreditPush[] = [];
    const cheers: CheerPush[] = [];
    const presence: Array<Record<string, number>> = [];
    c1.socket.on('credit', (m) => credit1.push(m));
    c2.socket.on('credit', (m) => credit2.push(m));
    screen.socket.on('cheer', (m) => cheers.push(m));
    screen.socket.on('presence', (m) => presence.push(m));
    const inv = (await topup(s, p1.token, 105)).json();
    await s.inject({ method: 'POST', url: '/api/dev/mock-pay', headers: { authorization: `Bearer ${p1.token}` }, payload: { invoiceId: inv.invoiceId } });
    await waitFor(() => credit1.length === 1);
    expect(credit1[0]).toMatchObject({ creditSats: 105, addedSats: 105, invoiceStatus: 'PAID' });
    await untilRound(s);
    await zap(s, p1.token);
    await waitFor(() => credit1.length === 2);
    expect(credit1[1]!.creditSats).toBe(84);
    await s.inject({ method: 'POST', url: '/api/cheer', headers: { authorization: `Bearer ${p2.token}` }, payload: { emoji: '👏' } });
    await waitFor(() => cheers.length === 1);
    expect(cheers[0]).toEqual({ teamId: 'FUJIN', nickname: 'two', emoji: '👏' });
    s.realtime.broadcastPresence();
    await waitFor(() => presence.length === 1);
    expect(presence[0]).toEqual({ RAIJIN: 1, FUJIN: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(credit2).toHaveLength(0);
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
    const t = await new Promise<number>((resolve) =>
      c.socket.emit('timeSync', Date.now(), resolve),
    );
    expect(t).toBe(s.clock.now());
  });
});
