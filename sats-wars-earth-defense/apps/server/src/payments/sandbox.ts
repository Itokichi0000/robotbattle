import { randomBytes } from 'node:crypto';
import type { CreatedInvoice, PaymentProvider, ProviderStatus } from './provider';

/**
 * VIRTUAL money for sandbox and rehearsals (spec §8.4). Invoices are obviously fake (a
 * wallet cannot pay them) and are settled only by staff in /operator. Never pretends to be
 * Lightning.
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = 'sandbox';
  readonly mode = 'sandbox' as const;
  private readonly status = new Map<string, ProviderStatus>();

  async createInvoice(input: {
    intentId: string;
    amountSats: number;
    expiresInSeconds: number;
  }): Promise<CreatedInvoice> {
    const paymentHash = randomBytes(32).toString('hex');
    this.status.set(paymentHash, 'pending');
    return {
      paymentHash,
      paymentRequest: `VIRTUAL-SANDBOX-${input.amountSats}SATS-${input.intentId}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    };
  }

  async lookupPayment(paymentHash: string): Promise<ProviderStatus> {
    return this.status.get(paymentHash) ?? 'failed';
  }

  /** Operator-only: mark a VIRTUAL invoice as paid. */
  settle(paymentHash: string): boolean {
    if (this.status.get(paymentHash) !== 'pending') return false;
    this.status.set(paymentHash, 'settled');
    return true;
  }

  expire(paymentHash: string): void {
    if (this.status.get(paymentHash) === 'pending') this.status.set(paymentHash, 'expired');
  }
}
