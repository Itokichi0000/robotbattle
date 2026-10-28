import { z } from 'zod';
import type {
  CreateInvoiceInput,
  CreatedInvoice,
  PaymentAdapter,
  ProviderInvoiceStatus,
} from './adapter';

/**
 * LNbits adapter using only the wallet's *invoice/read* key.
 *  - Create: POST {base}/api/v1/payments  { out: false, amount, memo, expiry, webhook }
 *  - Check:  GET  {base}/api/v1/payments/{payment_hash}  -> { paid: boolean, ... }
 * Response field names differ slightly between LNbits versions (payment_request
 * vs bolt11), so both are accepted. Verify against the deployed LNbits version
 * before enabling real payments (docs/PAYMENT_FLOW.md).
 */
const createResponseSchema = z
  .object({
    payment_hash: z.string().min(16),
    checking_id: z.string().min(1).optional(),
    payment_request: z.string().min(10).optional(),
    bolt11: z.string().min(10).optional(),
  })
  .refine((r) => r.payment_request || r.bolt11, { message: 'missing bolt11/payment_request' });

const statusResponseSchema = z.object({
  paid: z.boolean(),
  status: z.string().optional(),
  details: z
    .object({ status: z.string().optional(), expiry: z.union([z.number(), z.string()]).optional() })
    .partial()
    .passthrough()
    .optional()
    .nullable(),
});

export class LnbitsPaymentAdapter implements PaymentAdapter {
  readonly mode = 'lnbits' as const;

  constructor(
    private baseUrl: string,
    private invoiceKey: string,
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 8000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.invoiceKey,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(`LNbits ${init.method ?? 'GET'} ${path} failed: HTTP ${res.status}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`LNbits ${path}: invalid JSON`);
    }
  }

  async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
    const body: Record<string, unknown> = {
      out: false,
      amount: input.amountSats,
      unit: 'sat',
      memo: input.memo,
      expiry: input.expirySeconds,
    };
    if (input.webhookUrl) body.webhook = input.webhookUrl;
    const json = createResponseSchema.parse(
      await this.request('/api/v1/payments', { method: 'POST', body: JSON.stringify(body) }),
    );
    return {
      paymentHash: json.payment_hash,
      checkingId: json.checking_id ?? json.payment_hash,
      bolt11: (json.bolt11 ?? json.payment_request)!,
    };
  }

  async checkStatus(_checkingId: string, paymentHash: string): Promise<ProviderInvoiceStatus> {
    const json = statusResponseSchema.parse(
      await this.request(`/api/v1/payments/${encodeURIComponent(paymentHash)}`, { method: 'GET' }),
    );
    if (json.paid) return 'PAID';
    const st = (json.status ?? json.details?.status ?? '').toLowerCase();
    if (st === 'failed') return 'FAILED';
    if (st === 'expired') return 'EXPIRED';
    return 'PENDING';
  }
}
