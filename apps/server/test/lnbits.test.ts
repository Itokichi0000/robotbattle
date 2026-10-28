import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { LnbitsPaymentAdapter } from '../src/payments/lnbits';
import { type TestServer, admin, auth, makeServer, reserve } from './helpers';

interface FakeInvoice {
  paid: boolean;
  amount: number;
  memo: string;
  webhook?: string;
}

/** Minimal stand-in for the LNbits payments API (invoice key only). */
class FakeLnbits {
  invoices = new Map<string, FakeInvoice>();
  requests: Array<{ method: string; url: string; key: string | undefined; body: unknown }> = [];
  failNext = 0;
  server: Server;
  url = '';
  readonly key = 'invoice-key-abc';

  constructor() {
    this.server = createServer(async (req, res) => {
      const body = await readBody(req);
      this.requests.push({ method: req.method!, url: req.url!, key: req.headers['x-api-key'] as string, body });
      if (req.headers['x-api-key'] !== this.key) {
        res.writeHead(401).end('{"detail":"Invalid key"}');
        return;
      }
      if (this.failNext > 0) {
        this.failNext--;
        res.writeHead(500).end('{"detail":"boom"}');
        return;
      }
      if (req.method === 'POST' && req.url === '/api/v1/payments') {
        const b = body as { out: boolean; amount: number; memo: string; webhook?: string };
        if (b.out !== false) {
          res.writeHead(400).end('{"detail":"out must be false"}');
          return;
        }
        const hash = randomBytes(32).toString('hex');
        this.invoices.set(hash, { paid: false, amount: b.amount, memo: b.memo, webhook: b.webhook });
        res.writeHead(201, { 'content-type': 'application/json' }).end(
          JSON.stringify({ payment_hash: hash, payment_request: `lnbc${b.amount}n1fake${hash.slice(0, 20)}`, checking_id: hash }),
        );
        return;
      }
      const m = /^\/api\/v1\/payments\/([0-9a-f]{64})$/.exec(req.url ?? '');
      if (req.method === 'GET' && m) {
        const inv = this.invoices.get(m[1]!);
        if (!inv) {
          res.writeHead(404).end('{"detail":"not found"}');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ paid: inv.paid, preimage: null, details: {} }));
        return;
      }
      res.writeHead(404).end('{}');
    });
  }

  async start() {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }
  async stop() {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : null);
      } catch {
        resolve(data);
      }
    });
  });
}

let lnbits: FakeLnbits | null = null;
let s: TestServer | null = null;
afterEach(async () => {
  await s?.close();
  await lnbits?.stop();
  s = null;
  lnbits = null;
});

describe('LnbitsPaymentAdapter', () => {
  it('creates receive-only invoices with the invoice key and checks status', async () => {
    lnbits = await new FakeLnbits().start();
    const adapter = new LnbitsPaymentAdapter(`${lnbits.url}/`, lnbits.key);
    const inv = await adapter.createInvoice({ amountSats: 21, memo: 'test', expirySeconds: 120, webhookUrl: 'https://x/hook' });
    expect(inv.bolt11).toMatch(/^lnbc21n1/);
    const create = lnbits.requests[0]!;
    expect(create).toMatchObject({ method: 'POST', url: '/api/v1/payments', key: lnbits.key });
    expect(create.body).toMatchObject({ out: false, amount: 21, unit: 'sat', expiry: 120, webhook: 'https://x/hook' });
    expect(await adapter.checkStatus(inv.checkingId, inv.paymentHash)).toBe('PENDING');
    lnbits.invoices.get(inv.paymentHash)!.paid = true;
    expect(await adapter.checkStatus(inv.checkingId, inv.paymentHash)).toBe('PAID');
  });

  it('surfaces HTTP errors and malformed responses as exceptions', async () => {
    lnbits = await new FakeLnbits().start();
    const bad = new LnbitsPaymentAdapter(lnbits.url, 'wrong-key');
    await expect(bad.createInvoice({ amountSats: 21, memo: 'x', expirySeconds: 60 })).rejects.toThrow(/HTTP 401/);
    const adapter = new LnbitsPaymentAdapter(lnbits.url, lnbits.key);
    await expect(adapter.checkStatus('x', 'f'.repeat(64))).rejects.toThrow(/HTTP 404/);
  });
});

describe('server with LNbits adapter', () => {
  async function setup() {
    lnbits = await new FakeLnbits().start();
    s = await makeServer({
      env: {
        PAYMENT_MODE: 'lnbits',
        LNBITS_URL: lnbits.url,
        LNBITS_INVOICE_KEY: lnbits.key,
        LNBITS_WEBHOOK_SECRET: 'whsec-test-0001',
        SERVER_PUBLIC_URL: 'https://game.example',
        ALLOW_REAL_PAYMENTS: 'true',
      },
    });
    const token = await s.adminToken();
    await admin(s, token, { command: 'OPEN_LOBBY' });
    const r = (await reserve(s)).json();
    const res = await s.inject({ method: 'POST', url: '/api/join/invoice', headers: auth(r.token), payload: { reservationId: r.reservationId } });
    expect(res.statusCode).toBe(200);
    const row = s.services.repo.getInvoice(res.json().invoiceId)!;
    return { s, lnbits, r, row, invoice: res.json() };
  }

  it('registers the webhook URL with the secret and never exposes the key', async () => {
    const { lnbits, invoice } = await setup();
    const created = [...lnbits.invoices.values()][0]!;
    expect(created.webhook).toBe('https://game.example/api/webhooks/lnbits/whsec-test-0001');
    expect(invoice.paymentMode).toBe('lnbits');
    expect(JSON.stringify(invoice)).not.toContain(lnbits.key);
  });

  it('forged webhook (LNbits says unpaid) grants nothing; real payment grants once', async () => {
    const { s, lnbits, r, row } = await setup();
    const hook = () =>
      s.inject({ method: 'POST', url: '/api/webhooks/lnbits/whsec-test-0001', payload: { payment_hash: row.payment_hash } });
    await hook();
    expect(s.services.repo.getInvoice(row.id)!.status).toBe('PENDING');
    lnbits.invoices.get(row.payment_hash)!.paid = true;
    await Promise.all([hook(), hook(), hook()]);
    const me = (await s.inject({ url: '/api/me', headers: auth(r.token) })).json();
    expect(me).toMatchObject({ status: 'ACTIVE', apRemaining: 3, invoiceStatus: 'PAID' });
    expect(s.services.manager.snapshot().teams[r.teamId as 'RAIJIN'].apTotal).toBe(3);
  });

  it('provider 5xx during verification keeps the invoice pending and retries later', async () => {
    const { s, lnbits, r, row } = await setup();
    lnbits.invoices.get(row.payment_hash)!.paid = true;
    lnbits.failNext = 1;
    await s.services.join.pollPending();
    expect(s.services.repo.getInvoice(row.id)).toMatchObject({ status: 'PENDING', check_failures: 1 });
    await s.services.join.pollPending();
    const me = (await s.inject({ url: '/api/me', headers: auth(r.token) })).json();
    expect(me.status).toBe('ACTIVE');
  });

  it('refuses to start lnbits mode without explicit approval', async () => {
    await expect(
      makeServer({ env: { PAYMENT_MODE: 'lnbits', LNBITS_URL: 'http://x', LNBITS_INVOICE_KEY: 'k', LNBITS_WEBHOOK_SECRET: 's' } }),
    ).rejects.toThrow(/ALLOW_REAL_PAYMENTS/);
  });
});
