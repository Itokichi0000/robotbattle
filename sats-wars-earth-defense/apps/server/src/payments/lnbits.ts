import type { CreatedInvoice, PaymentProvider, ProviderStatus } from './provider';

/**
 * LNbits receiving backend (live mode). Uses only the wallet's invoice/read key: it can
 * create invoices and read their status, and can never send money (no `out: true`, no admin
 * key). The key stays in server memory and never reaches a browser or a log line.
 */
export interface LnbitsOptions {
  url: string;
  invoiceKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class LnbitsPaymentProvider implements PaymentProvider {
  readonly name = 'lnbits';
  readonly mode = 'live' as const;
  private readonly base: string;
  private readonly key: string;
  private readonly f: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: LnbitsOptions) {
    this.base = opts.url.replace(/\/$/, '');
    this.key = opts.invoiceKey;
    this.f = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.f(`${this.base}${path}`, {
      ...init,
      headers: {
        'X-Api-Key': this.key,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`LNbits ${path} → HTTP ${res.status}`);
    return res.json();
  }

  async createInvoice(input: {
    intentId: string;
    amountSats: number;
    memo: string;
    expiresInSeconds: number;
    webhookUrl?: string;
  }): Promise<CreatedInvoice> {
    // `out: false` = receive. This adapter has no code path that sends.
    const body = (await this.call('/api/v1/payments', {
      method: 'POST',
      body: JSON.stringify({
        out: false,
        amount: input.amountSats,
        memo: input.memo,
        expiry: input.expiresInSeconds,
        ...(input.webhookUrl ? { webhook: input.webhookUrl } : {}),
        extra: { swIntent: input.intentId },
      }),
    })) as { payment_hash?: string; payment_request?: string; bolt11?: string };
    const paymentRequest = body.payment_request ?? body.bolt11;
    if (!body.payment_hash || !paymentRequest) throw new Error('LNbits returned no invoice');
    return {
      paymentHash: body.payment_hash,
      paymentRequest,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    };
  }

  async lookupPayment(paymentHash: string): Promise<ProviderStatus> {
    if (!/^[0-9a-f]{64}$/.test(paymentHash)) return 'failed';
    const body = (await this.call(`/api/v1/payments/${paymentHash}`)) as {
      paid?: boolean;
      status?: string;
    };
    if (body.paid === true || body.status === 'success') return 'settled';
    if (body.status === 'failed') return 'failed';
    return 'pending';
  }

  webhookHint(body: unknown): string | null {
    const h = (body as { payment_hash?: unknown; checking_id?: unknown } | null)?.payment_hash;
    return typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : null;
  }

  /** Read-only connectivity check for the operator (wallet name, never the key). */
  async walletInfo(): Promise<{ name: string }> {
    const body = (await this.call('/api/v1/wallet')) as { name?: string };
    return { name: body.name ?? 'LNbits wallet' };
  }
}
