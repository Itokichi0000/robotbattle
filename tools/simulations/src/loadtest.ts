/**
 * Load / latency probe against a RUNNING game server in mock payment mode.
 *
 *   pnpm --filter @sats-wars/simulations exec tsx src/loadtest.ts \
 *     --url http://localhost:4000 --password <ADMIN_PASSWORD> --players 100 --spectators 300
 *
 * Steps: admin opens lobby + starts; N players reserve+invoice+mock-pay; S spectator
 * sockets join; every player spends 3 AP over ~60s. Reports HTTP action latency and
 * action->event fan-out latency (time until EVERY spectator socket received the event).
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
  if (st === 'FINISHED' || st === 'CANCELLED')
    await post('/api/admin/command', { command: 'NEXT_MATCH' }, admin);
  if (st !== 'LOBBY' && st !== 'LIVE') {
    await post('/api/admin/command', { command: 'OPEN_LOBBY' }, admin).catch(() => undefined);
  }

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

  // Players
  const t0 = performance.now();
  const players: Array<{ token: string }> = [];
  await Promise.all(
    Array.from({ length: PLAYERS }, async (_, i) => {
      const r = await post<{ token: string; reservationId: string }>('/api/join/reserve', {
        nickname: `load${i}`,
      });
      const inv = await post<{ invoiceId: string }>(
        '/api/join/invoice',
        { reservationId: r.reservationId },
        r.token,
      );
      await post('/api/dev/mock-pay', { invoiceId: inv.invoiceId }, r.token);
      players.push({ token: r.token });
    }),
  );
  const joinMs = performance.now() - t0;
  await post('/api/admin/command', { command: 'START' }, admin).catch(() => undefined);

  const regions = ['hokkaido', 'tohoku', 'kanto', 'chubu', 'kinki', 'chugoku', 'shikoku', 'kyushu'];
  const httpLat: number[] = [];
  const fanout: number[] = [];
  let ok = 0;
  let rejected = 0;
  let errors = 0;
  const tasks: Promise<void>[] = [];
  for (const p of players) {
    for (let k = 0; k < 3; k++) {
      const delay = Math.random() * DURATION_MS;
      tasks.push(
        new Promise<void>((resolve) =>
          setTimeout(async () => {
            const type = Math.random() < 0.7 ? 'ATTACK' : Math.random() < 0.5 ? 'DEFEND' : 'CHARGE';
            const body = {
              clientActionId: `lt-${Math.random().toString(36).slice(2)}`,
              type,
              regionId:
                type === 'CHARGE' ? undefined : regions[Math.floor(Math.random() * regions.length)],
            };
            const start = performance.now();
            try {
              const res = await post<{ result: { ok: boolean; eventSeq?: number } }>(
                '/api/actions',
                body,
                p.token,
              );
              httpLat.push(performance.now() - start);
              if (res.result.ok && res.result.eventSeq) {
                ok++;
                const seq = res.result.eventSeq;
                const deadline = start + 10_000;
                while ((seen.get(seq) ?? 0) < connected && performance.now() < deadline)
                  await new Promise((r) => setTimeout(r, 5));
                if ((seen.get(seq) ?? 0) >= connected) fanout.push(lastArrival.get(seq)! - start);
              } else rejected++;
            } catch {
              errors++;
            }
            resolve();
          }, delay),
        ),
      );
    }
  }
  await Promise.all(tasks);
  for (const s of sockets) s.close();
  const report = {
    players: PLAYERS,
    spectatorsConnected: `${connected}/${SPECTATORS}`,
    joinAllMs: Math.round(joinMs),
    actions: { ok, rejected, errors },
    httpActionMs: { p50: pctl(httpLat, 50), p95: pctl(httpLat, 95), max: Math.max(...httpLat) },
    actionToAllSpectatorsMs: {
      p50: pctl(fanout, 50),
      p95: pctl(fanout, 95),
      max: Math.max(...fanout),
      samples: fanout.length,
    },
  };
  for (const k of ['httpActionMs', 'actionToAllSpectatorsMs'] as const) {
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
