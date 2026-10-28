export type ProviderInvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';

export interface CreatedInvoice {
  checkingId: string;
  paymentHash: string;
  bolt11: string;
}

export interface CreateInvoiceInput {
  amountSats: number;
  memo: string;
  expirySeconds: number;
  /** Optional webhook URL the provider should call on settlement. */
  webhookUrl?: string;
}

/**
 * Receive-only payment provider. Implementations must never be able to send
 * funds (no admin keys, no out:true).
 */
export interface PaymentAdapter {
  readonly mode: 'mock' | 'lnbits';
  createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice>;
  /** Authoritative status lookup against the provider. Never trust webhook bodies. */
  checkStatus(checkingId: string, paymentHash: string): Promise<ProviderInvoiceStatus>;
}
