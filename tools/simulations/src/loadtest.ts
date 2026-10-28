/**
 * Load / latency probe against a RUNNING game server in mock payment mode.
 *
 *   pnpm --filter @sats-wars/simulations exec tsx src/loadtest.ts \
 *     --url http://localhost:4000 --password <ADMIN_PASSWORD> --players 100 --spectators 300
 *
 * Steps: makes sure a season is running; N players pick a team + top up 525 sats
 * via mock-pay; S spectator sockets join; every player taps every ~0.4–1.5 s for
 * --duration ms. Reports HTTP punch latency and punch->event fan-out latency (time
 * until EVERY spectator socket received the event).
 * Never run against a production server with real payments.
 */
import { io, type Socket } from 'socket.io-client';

const args = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const URL_ = arg('url', 'http://localhost:4000');
const PASSWORD = arg('password', process.env.ADMIN_PASSWORD ?? '');
const PLAYERS = Number(arg('players', '100'));
const SPECTATORS = Number(arg('spectators', '200'));
const DURATION_MS = Number(arg('duration', '60000'));

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const r = await fetch(URL_ + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as T;
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`);
  return j;
}

function pctl(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

async function main() {
  if (!PASSWORD) throw new Error('--password (ADMIN_PASSWORD) is required');
  const snap = (await (await fetch(`${URL_}/api/public/current-match`)).json()) as {
    snapshot: { paymentMode: string; status: string };
  };
  if (snap.snapshot.paymentMode !== 'mock')
    throw new Error('Refusing to run: server is not in PAYMENT_MODE=mock');
  const { token: admin } = await post<{ token: string }>('/api/admin/login', {
    password: PASSWORD,
  });
  const st = snap.snapshot.status as string;
  if (st === 'FINISHED' || st === 'CANCELLED') await post('/api/admin/command', { command: 'NEXT_MATCH' }, admin);
  if (st === 'CREATED') await post('/api/admin/command', { command: 'START' }, admin).catch(() => undefined);
  if (st === 'PAUSED') await post('/api/admin/command', { command: 'RESUME' }, admin).catch(() => undefined);

  // Spectators
  const sockets: Socket[] = [];
  const seen = new Map<number, number>(); // seq -> count of sockets that got it
  const lastArrival = new Map<number, number>();
  for (let i = 0; i < SPECTATORS; i++) {
    const s = io(URL_, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => s.emit('joinRoom', { role: 'spectator' }));
    s.on('matchEvent', (e: { seq: number }) => {
      seen.set(e.seq, (seen.get(e.seq) ?? 0) + 1);
      lastArrival.set(e.seq, performance.now());
    });
    sockets.push(s);
  }
  await new Promise((r) => setTimeout(r, 2000));
  const connected = sockets.filter((s) => s.connected).length;

  // Players: pick a team (alternating) and top up.
  const t0 = performance.now();
  const players: Array<{ token: string }> = [];
  await Promise.all(
    Array.from({ length: PLAYERS }, async (_, i) => {
      const r = await post<{ token: string }>('/api/players', {
        teamId: i % 2 ? 'FUJIN' : 'RAIJIN',
        nickname: `load${i}`,
      });
      const inv = await post<{ invoiceId: string }>('/api/topups', { amountSats: 525 }, r.token);
      await post('/api/dev/mock-pay', { invoiceId: inv.invoiceId }, r.token);
      players.push({ token: r.token });
    }),
  );
  const joinMs = performance.now() - t0;

  const httpLat: number[] = [];
  const fanout: number[] = [];
  let ok = 0;
  let refused = 0;
  let errors = 0;
  const until = performance.now() + DURATION_MS;
  const tasks = players.map(async (p) => {
    while (performance.now() < until) {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 1100));
      const start = performance.now();
      try {
        const res = await post<{ result: { ok: boolean; eventSeq?: number }; creditSats: number }>(
          '/api/zap',
          { clientActionId: `lt-${Math.random().toString(36).slice(2)}-${Date.now()}` },
          p.token,
        );
        httpLat.push(performance.now() - start);
        if (res.result.ok && res.result.eventSeq) {
          ok++;
          const seq = res.result.eventSeq;
          const deadline = start + 10_000;
          while ((seen.get(seq) ?? 0) < connected && performance.now() < deadline) await new Promise((r) => setTimeout(r, 5));
          if ((seen.get(seq) ?? 0) >= connected) fanout.push(lastArrival.get(seq)! - start);
        } else refused++; // between rounds: free no-op
        if (res.creditSats < 21) return;
      } catch {
        errors++;
      }
    }
  });
  await Promise.all(tasks);
  for (const s of sockets) s.close();
  const report = {
    players: PLAYERS,
    spectatorsConnected: `${connected}/${SPECTATORS}`,
    joinAllMs: Math.round(joinMs),
    punches: { ok, refusedBetweenRounds: refused, errors },
    httpPunchMs: { p50: pctl(httpLat, 50), p95: pctl(httpLat, 95), max: Math.max(...httpLat) },
    punchToAllSpectatorsMs: {
      p50: pctl(fanout, 50),
      p95: pctl(fanout, 95),
      max: Math.max(...fanout),
      samples: fanout.length,
    },
  };
  for (const k of ['httpPunchMs', 'punchToAllSpectatorsMs'] as const) {
    for (const [kk, v] of Object.entries(report[k]))
      (report[k] as Record<string, number>)[kk] = Math.round(v as number);
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
