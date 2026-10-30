/**
 * Payment adapter (spec §8.4). The game only ever asks for an invoice and later asks
 * whether it was paid; settlement is always confirmed by asking the backend, never by
 * trusting a browser or a webhook body.
 */
export type PaymentMode = 'sandbox' | 'live';
export type ProviderStatus = 'pending' | 'settled' | 'expired' | 'failed';

export interface CreatedInvoice {
  paymentRequest: string;
  paymentHash: string;
  expiresAt: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly mode: PaymentMode;
  createInvoice(input: {
    intentId: string;
    amountSats: number;
    memo: string;
    expiresInSeconds: number;
    webhookUrl?: string;
  }): Promise<CreatedInvoice>;
  lookupPayment(paymentHash: string): Promise<ProviderStatus>;
  /** Webhooks are only a hint: returns the hash to re-check, if the body names one. */
  webhookHint?(body: unknown): string | null;
}
