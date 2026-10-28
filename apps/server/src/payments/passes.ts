import type { EntitlementPush, InvoiceResponse, InvoiceStatus, InvoiceStatusResponse } from '@sats-wars/shared';
import type { WallClock } from '../clock';
import type { EntitlementSource, InvoiceRow, PilotRow, Repo } from '../db/repo';
import { AppError } from '../errors';
import type { RaidManager } from '../raid/manager';
import { newId, newPassCode, normalizePassCode, sha256 } from '../auth/tokens';
import type { PaymentAdapter } from './adapter';
import { MockPaymentAdapter } from './mock';

export interface PassServiceOptions {
  repo: Repo;
  manager: RaidManager;
  adapter: PaymentAdapter;
  wall: WallClock;
  payeeDescription: string;
  /** Full webhook URL (including secret path segment) or undefined. */
  webhookUrl?: string;
  /** Keep checking pending invoices this long after their expiry (late payments). */
  lateGraceMs?: number;
  /** How long BOLT11 strings are kept after settlement/expiry. */
  bolt11RetentionMs?: number;
  log?: { warn: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };
}

/** Do not sell a pass that would expire right at the boarding cutoff. */
export const MIN_JOIN_TIME_FOR_INVOICE_MS = 45_000;

type EntitlementListener = (pilotId: string, push: EntitlementPush) => void;

/**
 * Raid passes. Being authenticated is NOT the same as being allowed to fly:
 * a pilot boards a raid with an entitlement from a free event, a sponsored
 * code, a verified Lightning payment (21 sats by default) or a credit from a
 * payment that arrived too late for its raid. All sources fly identically —
 * the amount paid never changes combat power.
 */
export class PassService {
  private listeners = new Set<EntitlementListener>();
  private checking = new Set<string>();
  private readonly lateGraceMs: number;

  constructor(private opts: PassServiceOptions) {
    this.lateGraceMs = opts.lateGraceMs ?? 30 * 60_000;
  }

  private get repo(): Repo {
    return this.opts.repo;
  }
  private now(): number {
    return this.opts.wall.now();
  }

  /** Operator kill switch: stop talking to the payment provider entirely. */
  get integrationEnabled(): boolean {
    return this.repo.getSetting<boolean>('paymentIntegration') ?? true;
  }

  onEntitlement(l: EntitlementListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private grant(raidId: string, pilotId: string, source: EntitlementSource, sourceId: string | null): boolean {
    const ok = this.repo.insertEntitlement({ id: newId('ent'), raid_id: raidId, pilot_id: pilotId, source, source_id: sourceId, granted_at: this.now() });
    if (ok) for (const l of this.listeners) l(pilotId, { raidId, source, invoiceId: source === 'LIGHTNING' ? sourceId : null });
    return ok;
  }

  /**
   * Make sure the pilot may fly the current raid, granting a free/demo pass or
   * spending a carried-over credit when possible. Throws PASS_REQUIRED otherwise.
   */
  ensureEntitled(p: PilotRow, isDemo = false): EntitlementSource {
    const { manager } = this.opts;
    const raidId = manager.current().raidId;
    const existing = this.repo.getEntitlement(raidId, p.id);
    if (existing) return existing.source;
    if (!manager.joinOpen()) throw new AppError('JOIN_CLOSED', '今回の出撃受付は終了しました。次の作戦をお待ちください / Boarding is closed for this raid');
    return this.repo.tx(() => {
      if (isDemo) {
        this.grant(raidId, p.id, 'DEMO', null);
        return 'DEMO';
      }
      if (manager.passMode === 'FREE') {
        this.grant(raidId, p.id, 'FREE', null);
        return 'FREE';
      }
      if (p.pass_credits > 0 && this.repo.changePassCredits(p.id, -1)) {
        this.grant(raidId, p.id, 'CREDIT', null);
        this.repo.audit(`pilot:${p.id}`, 'USE_PASS_CREDIT', raidId, null, this.now());
        return 'CREDIT';
      }
      throw new AppError('PASS_REQUIRED', '出撃パスが必要です（21 sats またはスポンサーパス）/ A raid pass is required');
    });
  }

  // ---- Lightning pass -----------------------------------------------------------

  async createInvoice(p: PilotRow): Promise<InvoiceResponse> {
    const { manager, adapter } = this.opts;
    const rt = manager.current();
    const cfg = rt.state.config;
    if (manager.passMode === 'FREE') throw new AppError('BAD_REQUEST', '無料イベントです。支払いは不要です / This is a free event');
    if (this.repo.getEntitlement(rt.raidId, p.id)) throw new AppError('ALREADY_ENTITLED', 'この作戦の出撃パスは取得済みです / You already have a pass for this raid');
    if (!manager.paymentsEnabled || !this.integrationEnabled) {
      throw new AppError('PAYMENTS_DISABLED', '現在、支払いの受付を停止しています。スポンサーパスをご利用ください / Payments are paused');
    }
    const remaining = manager.joinRemainingMs();
    if (!manager.joinOpen() || (remaining !== null && remaining < MIN_JOIN_TIME_FOR_INVOICE_MS)) {
      throw new AppError('JOIN_CLOSED', '受付締切が近いため請求書を発行できません。次の作戦で参加してください / Too close to the boarding cutoff');
    }
    const existing = this.repo.pendingInvoiceFor(p.id, rt.raidId, this.now() + 15_000);
    if (existing) return this.invoiceResponse(existing);
    // The invoice must expire before boarding closes (plus a margin), so nobody pays for a seat that is gone.
    const ttl = Math.min(cfg.invoiceTtlMs, remaining === null ? cfg.invoiceTtlMs : remaining - 15_000);
    const expirySeconds = Math.max(30, Math.floor(ttl / 1000));
    const amountSats = cfg.ticketPriceSats;
    const memo = `SATS WARS raid pass ${amountSats} sats`;
    let created;
    try {
      created = await adapter.createInvoice({ amountSats, memo, expirySeconds, webhookUrl: this.opts.webhookUrl });
    } catch (err) {
      this.opts.log?.warn({ err: String(err) }, 'invoice creation failed');
      throw new AppError('PAYMENT_PROVIDER_ERROR', '請求書を作成できませんでした。少し待って再試行してください / Could not create invoice, please retry');
    }
    const now = this.now();
    const row: InvoiceRow = {
      id: newId('inv'),
      pilot_id: p.id,
      raid_id: rt.raidId,
      provider: adapter.mode,
      checking_id: created.checkingId,
      payment_hash: created.paymentHash,
      amount_sats: amountSats,
      bolt11: created.bolt11,
      memo,
      expires_at: now + expirySeconds * 1000,
      status: 'PENDING',
      created_at: now,
      verified_at: null,
      entitlement_granted_at: null,
      late_policy: null,
      last_checked_at: null,
      check_failures: 0,
    };
    this.repo.insertInvoice(row);
    return this.invoiceResponse(row);
  }

  invoiceResponse(row: InvoiceRow): InvoiceResponse {
    return {
      invoiceId: row.id,
      raidId: row.raid_id,
      amountSats: row.amount_sats,
      bolt11: row.bolt11 ?? '',
      expiresAt: row.expires_at,
      status: row.status,
      paymentMode: this.opts.adapter.mode,
      payeeDescription: this.opts.payeeDescription,
      memo: row.memo,
    };
  }

  pendingInvoice(p: PilotRow): InvoiceResponse | null {
    const inv = this.repo.pendingInvoiceFor(p.id, this.opts.manager.current().raidId, this.now());
    return inv ? this.invoiceResponse(inv) : null;
  }

  status(p: PilotRow, invoiceId: string): InvoiceStatusResponse {
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv || inv.pilot_id !== p.id) throw new AppError('NOT_FOUND', 'invoice not found');
    return { invoiceId, status: inv.status, entitled: !!this.repo.getEntitlement(inv.raid_id, p.id) };
  }

  /**
   * Ask the provider for the authoritative status and grant if paid. Safe to
   * call concurrently and repeatedly (webhook + poller + client polling).
   */
  async checkInvoice(invoiceId: string): Promise<InvoiceStatus | null> {
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv) return null;
    if (inv.status !== 'PENDING' && inv.status !== 'EXPIRED') return inv.status;
    // Expired invoices are re-checked only within the late-payment grace window.
    if (inv.status === 'EXPIRED' && inv.expires_at + this.lateGraceMs <= this.now()) return inv.status;
    if (this.checking.has(invoiceId) || !this.integrationEnabled) return inv.status;
    this.checking.add(invoiceId);
    try {
      let status;
      try {
        status = await this.opts.adapter.checkStatus(inv.checking_id, inv.payment_hash);
      } catch (err) {
        this.repo.updateInvoice(inv.id, { last_checked_at: this.now(), check_failures: inv.check_failures + 1 });
        this.opts.log?.warn({ invoiceId, err: String(err) }, 'invoice status check failed');
        return inv.status;
      }
      this.repo.updateInvoice(inv.id, { last_checked_at: this.now() });
      if (status === 'PAID') return this.settle(inv.id);
      if (status === 'FAILED') {
        this.repo.updateInvoice(inv.id, { status: 'FAILED' });
        return 'FAILED';
      }
      if (inv.status === 'PENDING' && (status === 'EXPIRED' || inv.expires_at <= this.now())) {
        this.repo.updateInvoice(inv.id, { status: 'EXPIRED' });
        return 'EXPIRED';
      }
      return inv.status;
    } finally {
      this.checking.delete(invoiceId);
    }
  }

  /**
   * Verified payment → exactly one pass. If its raid can still be boarded the
   * pass is for that raid; otherwise (late payment, raid over, or a pass was
   * meanwhile obtained another way) it becomes a credit for the next raid.
   * Never forfeited, never auto-refunded (refunds are out of scope).
   */
  settle(invoiceId: string): InvoiceStatus {
    const now = this.now();
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv) throw new AppError('NOT_FOUND', 'invoice not found');
    const { manager } = this.opts;
    this.repo.tx(() => {
      if (!this.repo.markInvoicePaid(inv.id, now)) return;
      const current = manager.current().raidId === inv.raid_id && manager.joinOpen();
      if (current && this.grant(inv.raid_id, inv.pilot_id, 'LIGHTNING', inv.id)) {
        this.repo.updateInvoice(inv.id, { entitlement_granted_at: now });
      } else {
        this.repo.changePassCredits(inv.pilot_id, 1);
        this.repo.updateInvoice(inv.id, { late_policy: 'NEXT_RAID_CREDIT' });
        this.repo.audit('payments', 'LATE_PAYMENT_CREDIT', inv.id, { pilotId: inv.pilot_id, raidId: inv.raid_id }, now);
      }
    });
    return 'PAID';
  }

  /** Dev-only: simulate a wallet paying a mock invoice, then run the normal verification path. */
  async mockPay(p: PilotRow, invoiceId: string): Promise<InvoiceStatus | null> {
    const adapter = this.opts.adapter;
    if (!(adapter instanceof MockPaymentAdapter)) throw new AppError('NOT_MOCK_MODE', 'not available');
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv || inv.pilot_id !== p.id) throw new AppError('NOT_FOUND', 'invoice not found');
    adapter.markPaid(inv.checking_id);
    return this.checkInvoice(inv.id);
  }

  /** Webhook: treat as a hint only, then re-verify with the provider. */
  async handleWebhook(paymentHash: string): Promise<void> {
    const inv = this.repo.getInvoiceByPaymentHash(paymentHash);
    if (inv) await this.checkInvoice(inv.id);
  }

  /** Background reconciliation: covers missing/delayed webhooks. */
  async pollPending(): Promise<void> {
    if (!this.integrationEnabled) return;
    for (const inv of this.repo.invoicesToCheck()) await this.checkInvoice(inv.id);
    this.repo.purgeBolt11(this.now() - (this.opts.bolt11RetentionMs ?? 24 * 60 * 60_000));
  }

  // ---- sponsored passes -------------------------------------------------------------

  issueSponsored(count: number, expiresInMs: number, label: string, raidId: string | null, actor: string): string[] {
    const now = this.now();
    const codes: string[] = [];
    this.repo.tx(() => {
      for (let i = 0; i < count; i++) {
        const code = newPassCode();
        codes.push(code);
        this.repo.insertSponsoredPass({ id_hash: sha256(code), label, raid_id: raidId, issued_by: actor, issued_at: now, expires_at: now + expiresInMs, status: 'ISSUED' });
      }
      this.repo.audit(actor, 'ISSUE_SPONSORED_PASSES', raidId, { count, label, expiresInMs }, now);
    });
    return codes;
  }

  redeemSponsored(p: PilotRow, code: string): { raidId: string } {
    const { manager } = this.opts;
    const raidId = manager.current().raidId;
    const hash = sha256(normalizePassCode(code));
    const pass = this.repo.getSponsoredPass(hash);
    const now = this.now();
    const invalid = () => new AppError('INVALID_PASS', 'パスが無効か使用済みです / Pass is invalid or already used');
    if (!pass || pass.status !== 'ISSUED' || pass.expires_at <= now) throw invalid();
    if (pass.raid_id && pass.raid_id !== raidId) throw new AppError('INVALID_PASS', 'このパスは別の作戦用です / This pass is for another raid');
    if (this.repo.getEntitlement(raidId, p.id)) throw new AppError('ALREADY_ENTITLED', 'この作戦の出撃パスは取得済みです（パスは使われていません）/ Already have a pass (code not used)');
    if (!manager.joinOpen()) throw new AppError('JOIN_CLOSED', '今回の出撃受付は終了しました（パスは使われていません）/ Boarding closed (code not used)');
    this.repo.tx(() => {
      if (!this.repo.redeemSponsoredPass(hash, p.id, raidId, now)) throw invalid();
      this.grant(raidId, p.id, 'SPONSORED', hash.slice(0, 12));
    });
    return { raidId };
  }
}
