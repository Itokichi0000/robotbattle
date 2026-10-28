import { randomBytes } from 'node:crypto';
import type { WallClock } from '../clock';
import type { CreateInvoiceInput, CreatedInvoice, PaymentAdapter, ProviderInvoiceStatus } from './adapter';

interface MockInvoice {
  paid: boolean;
  expiresAt: number;
  amountSats: number;
}

/**
 * Local-only fake Lightning provider. Invoices are NOT payable with a real
 * wallet; the BOLT11-looking string is prefixed so it can never be mistaken
 * for a real invoice. Payment is simulated via markPaid() (dev endpoint).
 */
export class MockPaymentAdapter implements PaymentAdapter {
  readonly mode = 'mock' as const;
  private invoices = new Map<string, MockInvoice>();
  /** Test hook: make checkStatus throw to simulate provider outages. */
  failChecks = false;

  constructor(private wall: WallClock) {}

  async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
    const paymentHash = randomBytes(32).toString('hex');
    const checkingId = paymentHash;
    this.invoices.set(checkingId, {
      paid: false,
      expiresAt: this.wall.now() + input.expirySeconds * 1000,
      amountSats: input.amountSats,
    });
    const bolt11 = `mock-lnbc${input.amountSats}n1-${paymentHash.slice(0, 40)}-NOT-A-REAL-INVOICE`;
    return { checkingId, paymentHash, bolt11 };
  }

  async checkStatus(checkingId: string): Promise<ProviderInvoiceStatus> {
    if (this.failChecks) throw new Error('mock provider unavailable');
    const inv = this.invoices.get(checkingId);
    if (!inv) return 'FAILED';
    if (inv.paid) return 'PAID';
    if (inv.expiresAt <= this.wall.now()) return 'EXPIRED';
    return 'PENDING';
  }

  /** Simulate a wallet paying the invoice. Returns false if unknown or expired. */
  markPaid(checkingId: string, { ignoreExpiry = false } = {}): boolean {
    const inv = this.invoices.get(checkingId);
    if (!inv) return false;
    if (!ignoreExpiry && inv.expiresAt <= this.wall.now()) return false;
    inv.paid = true;
    return true;
  }
}
