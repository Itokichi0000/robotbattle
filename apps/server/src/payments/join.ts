import { randomInt } from 'node:crypto';
import type {
  InvoiceResponse,
  InvoiceStatus,
  MatchState,
  MeResponse,
  PaymentStatusPush,
  ReserveResponse,
  TeamId,
} from '@sats-wars/shared';
import { sanitizeNickname } from '@sats-wars/shared';
import type { WallClock } from '../clock';
import type { InvoiceRow, ParticipantRow, Repo } from '../db/repo';
import { AppError } from '../errors';
import type { MatchManager } from '../match/manager';
import { newId, newPassCode, newToken, normalizePassCode, sha256 } from '../auth/tokens';
import type { PaymentAdapter } from './adapter';
import { MockPaymentAdapter } from './mock';

export interface JoinServiceOptions {
  repo: Repo;
  manager: MatchManager;
  adapter: PaymentAdapter;
  wall: WallClock;
  payeeDescription: string;
  /** Full webhook URL (including secret path segment) or undefined. */
  webhookUrl?: string;
  /** Keep checking pending invoices this long after their expiry (late settlement). */
  lateGraceMs?: number;
  /** How long BOLT11 strings are kept after settlement/expiry. */
  bolt11RetentionMs?: number;
  log?: { warn: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };
}

type PaymentListener = (participantId: string, status: PaymentStatusPush) => void;

function canAccept(state: MatchState): boolean {
  const effective = state.status === 'PAUSED' ? state.pausedFrom : state.status;
  return effective === 'LOBBY' || effective === 'LIVE';
}

/**
 * Join flow: reserve seat -> invoice (or sponsored pass) -> verified payment
 * -> ACTIVE participant with AP. Fulfilment is idempotent and only happens
 * after the server re-verifies with the payment provider.
 */
export class JoinService {
  private listeners = new Set<PaymentListener>();
  private checking = new Set<string>();
  private readonly lateGraceMs: number;

  constructor(private opts: JoinServiceOptions) {
    this.lateGraceMs = opts.lateGraceMs ?? 10 * 60_000;
  }

  private get repo(): Repo {
    return this.opts.repo;
  }
  private now(): number {
    return this.opts.wall.now();
  }

  onPaymentStatus(listener: PaymentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- auth ---------------------------------------------------------------

  authenticate(token: string | null): ParticipantRow | null {
    if (!token) return null;
    return this.repo.getParticipantBySession(sha256(token)) ?? null;
  }

  // ---- reserve ------------------------------------------------------------

  reserve(input: { nickname?: string; deviceId?: string }): ReserveResponse {
    const { manager } = this.opts;
    const rt = manager.current();
    if (!manager.joinOpen()) {
      throw new AppError('JOIN_CLOSED', '現在は参加受付時間外です / Joining is closed right now');
    }
    const now = this.now();
    const cfg = rt.state.config;
    return this.repo.tx(() => {
      this.repo.expireReservations(now);
      const deviceHash = input.deviceId ? sha256(`${rt.matchId}:${input.deviceId}`) : null;
      if (deviceHash && this.repo.findLiveParticipantByDevice(rt.matchId, deviceHash)) {
        throw new AppError(
          'ALREADY_JOINED',
          'この端末はすでにこの試合に参加しています / This device already joined this match',
        );
      }
      const seats = this.repo.seatCounts(rt.matchId, now);
      const teamId = this.pickTeam(seats, cfg.maxParticipantsPerTeam);
      const participantId = newId('p');
      const reservationId = newId('r');
      const token = newToken();
      const { nickname } = sanitizeNickname(input.nickname, participantId.slice(-4));
      this.repo.insertParticipant({
        id: participantId,
        match_id: rt.matchId,
        team_id: teamId,
        nickname_sanitized: nickname,
        nickname_hidden: 0,
        session_id_hash: sha256(token),
        device_hash: deviceHash,
        source: 'PAID',
        status: 'RESERVED',
        joined_at: now,
        confirmed_at: null,
        ap_total: 0,
        sponsored_pass_id: null,
      });
      const expiresAt = now + cfg.reservationTtlMs;
      this.repo.insertReservation({
        id: reservationId,
        match_id: rt.matchId,
        team_id: teamId,
        participant_id: participantId,
        expires_at: expiresAt,
        status: 'ACTIVE',
        created_at: now,
      });
      return {
        matchId: rt.matchId,
        participantId,
        reservationId,
        teamId,
        nickname,
        token,
        reservationExpiresAt: expiresAt,
        entryFeeSats: cfg.entryFeeSats,
        apPerParticipant: cfg.apPerParticipant,
      };
    });
  }

  /** Fewest seats wins; ties are broken randomly so names/colors carry no advantage. */
  private pickTeam(seats: Record<TeamId, number>, max: number): TeamId {
    const open = (['RAIJIN', 'FUJIN'] as TeamId[]).filter((t) => seats[t] < max);
    if (open.length === 0) throw new AppError('MATCH_FULL', '定員に達しました / The match is full');
    if (open.length === 1) return open[0]!;
    if (seats.RAIJIN !== seats.FUJIN) return seats.RAIJIN < seats.FUJIN ? 'RAIJIN' : 'FUJIN';
    return randomInt(2) === 0 ? 'RAIJIN' : 'FUJIN';
  }

  private requireOpenReservation(p: ParticipantRow, reservationId: string) {
    const res = this.repo.getReservation(reservationId);
    if (!res || res.participant_id !== p.id) throw new AppError('NOT_FOUND', 'reservation not found');
    if (p.status === 'ACTIVE') throw new AppError('ALREADY_ACTIVE', 'すでに参加確定しています / Already active');
    if (res.status !== 'ACTIVE' || res.expires_at <= this.now()) {
      throw new AppError(
        'RESERVATION_EXPIRED',
        '参加枠の予約期限が切れました。もう一度参加してください / Reservation expired, please join again',
      );
    }
    if (res.match_id !== this.opts.manager.current().matchId) {
      throw new AppError('JOIN_CLOSED', 'この試合の受付は終了しました / This match no longer accepts joins');
    }
    return res;
  }

  // ---- invoice ------------------------------------------------------------

  async createInvoice(p: ParticipantRow, reservationId: string): Promise<InvoiceResponse> {
    const { manager, adapter } = this.opts;
    const res = this.requireOpenReservation(p, reservationId);
    if (!manager.paymentsEnabled) {
      throw new AppError(
        'PAYMENTS_DISABLED',
        '現在、決済の受付を停止しています。スポンサーパスか観戦をご利用ください / Payments are paused',
      );
    }
    const existing = this.repo.latestInvoiceForReservation(res.id);
    if (existing && existing.status === 'PENDING' && existing.expires_at > this.now() + 15_000) {
      return this.invoiceResponse(existing);
    }
    if (!manager.joinOpen()) throw new AppError('JOIN_CLOSED', '参加受付は終了しました / Joining closed');
    const cfg = manager.current().state.config;
    // Never let an invoice outlive the action window: nobody should pay and be unable to act.
    const ttl = Math.min(cfg.invoiceTtlMs, manager.msUntilActionsClose() - 30_000);
    if (ttl < 30_000) throw new AppError('JOIN_CLOSED', '参加受付は終了しました / Joining closed');
    const expirySeconds = Math.floor(ttl / 1000);
    const memo = `SATS WARS entry ${cfg.entryFeeSats} sats (${res.match_id.slice(-6)})`;
    let created;
    try {
      created = await adapter.createInvoice({
        amountSats: cfg.entryFeeSats,
        memo,
        expirySeconds,
        webhookUrl: this.opts.webhookUrl,
      });
    } catch (err) {
      this.opts.log?.warn({ err: String(err) }, 'invoice creation failed');
      throw new AppError(
        'PAYMENT_PROVIDER_ERROR',
        '請求書を作成できませんでした。少し待って再試行してください / Could not create invoice, please retry',
      );
    }
    const now = this.now();
    const row: InvoiceRow = {
      id: newId('inv'),
      participant_id: p.id,
      reservation_id: res.id,
      match_id: res.match_id,
      provider: adapter.mode,
      lnbits_checking_id: created.checkingId,
      payment_hash: created.paymentHash,
      amount_sats: cfg.entryFeeSats,
      bolt11: created.bolt11,
      memo,
      expires_at: now + expirySeconds * 1000,
      status: 'PENDING',
      created_at: now,
      verified_at: null,
      fulfillment_at: null,
      last_checked_at: null,
      check_failures: 0,
      late_payment_disposition: null,
      late_payment_note: null,
      carryover_pass_code: null,
    };
    this.repo.tx(() => {
      this.repo.insertInvoice(row);
      this.repo.setParticipantStatus(p.id, 'PENDING_PAYMENT');
      // Hold the seat while the invoice is payable.
      this.repo.setReservationStatus(res.id, 'ACTIVE', Math.max(res.expires_at, row.expires_at + 30_000));
    });
    return this.invoiceResponse(row);
  }

  private invoiceResponse(row: InvoiceRow): InvoiceResponse {
    return {
      invoiceId: row.id,
      amountSats: row.amount_sats,
      bolt11: row.bolt11 ?? '',
      expiresAt: row.expires_at,
      paymentMode: this.opts.adapter.mode,
      payeeDescription: this.opts.payeeDescription,
      memo: row.memo,
    };
  }

  /**
   * Ask the provider for the authoritative status and fulfil if paid. Safe to
   * call concurrently and repeatedly (webhook + poller + client polling).
   */
  async checkInvoice(invoiceId: string): Promise<InvoiceStatus | null> {
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv) return null;
    if (inv.status !== 'PENDING') return inv.status;
    if (this.checking.has(invoiceId)) return inv.status;
    this.checking.add(invoiceId);
    try {
      let status;
      try {
        status = await this.opts.adapter.checkStatus(inv.lnbits_checking_id, inv.payment_hash);
      } catch (err) {
        this.repo.updateInvoice(inv.id, {
          last_checked_at: this.now(),
          check_failures: inv.check_failures + 1,
        });
        this.opts.log?.warn({ invoiceId, err: String(err) }, 'invoice status check failed');
        return 'PENDING';
      }
      this.repo.updateInvoice(inv.id, { last_checked_at: this.now() });
      if (status === 'PAID') return this.fulfill(inv.id);
      const expiredLocally = inv.expires_at + this.lateGraceMs <= this.now();
      if (status === 'EXPIRED' || status === 'FAILED' || expiredLocally) {
        const final = status === 'FAILED' ? 'FAILED' : 'EXPIRED';
        this.repo.updateInvoice(inv.id, { status: final });
        this.push(inv.participant_id);
        return final;
      }
      return 'PENDING';
    } finally {
      this.checking.delete(invoiceId);
    }
  }

  /** Grant AP exactly once for a verified payment. Synchronous => atomic. */
  fulfill(invoiceId: string): InvoiceStatus {
    const { manager } = this.opts;
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv) throw new AppError('NOT_FOUND', 'invoice not found');
    if (inv.status === 'PAID' || inv.status === 'LATE_PAID') return inv.status;
    const p = this.repo.getParticipant(inv.participant_id)!;
    const rt = manager.current();
    const now = this.now();
    if (inv.match_id === rt.matchId && canAccept(rt.state)) {
      const ap = rt.state.config.apPerParticipant;
      rt.dispatch(
        {
          type: 'ADD_PARTICIPANT',
          participantId: p.id,
          teamId: p.team_id,
          nickname: p.nickname_sanitized,
          isBot: false,
          ap,
        },
        () => {
          this.repo.updateInvoice(inv.id, { status: 'PAID', verified_at: now, fulfillment_at: now });
          this.repo.setParticipantStatus(p.id, 'ACTIVE', { confirmedAt: now, apTotal: ap });
          this.repo.setReservationStatus(inv.reservation_id, 'CONFIRMED');
        },
      );
      this.push(p.id);
      return 'PAID';
    }
    // Paid, but the match can no longer take participants: never silently keep the money.
    this.repo.tx(() => {
      this.repo.updateInvoice(inv.id, {
        status: 'LATE_PAID',
        verified_at: now,
        late_payment_disposition: 'PENDING_REVIEW',
      });
      this.repo.audit('system', 'LATE_PAYMENT', inv.id, { participantId: p.id, matchId: inv.match_id }, now);
    });
    this.opts.log?.warn({ invoiceId }, 'late payment needs operator review');
    this.push(p.id);
    return 'LATE_PAID';
  }

  /** Dev-only: simulate a wallet paying a mock invoice, then run the normal verification path. */
  async mockPay(p: ParticipantRow, invoiceId: string): Promise<InvoiceStatus | null> {
    const adapter = this.opts.adapter;
    if (!(adapter instanceof MockPaymentAdapter)) {
      throw new AppError('NOT_MOCK_MODE', 'not available');
    }
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv || inv.participant_id !== p.id) throw new AppError('NOT_FOUND', 'invoice not found');
    adapter.markPaid(inv.lnbits_checking_id);
    return this.checkInvoice(inv.id);
  }

  /** Webhook: treat as a hint only, then re-verify with the provider. */
  async handleWebhook(paymentHash: string): Promise<void> {
    const inv = this.repo.getInvoiceByPaymentHash(paymentHash);
    if (!inv) return;
    await this.checkInvoice(inv.id);
  }

  /** Background reconciliation: covers missing/delayed webhooks. */
  async pollPending(): Promise<void> {
    const now = this.now();
    const expired = this.repo.tx(() => this.repo.expireReservations(now));
    for (const pid of expired) this.push(pid);
    for (const inv of this.repo.invoicesToCheck(now, this.lateGraceMs)) {
      await this.checkInvoice(inv.id);
    }
    const retention = this.opts.bolt11RetentionMs ?? 24 * 60 * 60_000;
    this.repo.purgeBolt11(now - retention);
  }

  // ---- sponsored passes ---------------------------------------------------

  issuePasses(count: number, expiresInMs: number, label: string, actor: string, matchId: string | null): string[] {
    const now = this.now();
    const codes: string[] = [];
    this.repo.tx(() => {
      for (let i = 0; i < count; i++) {
        const code = newPassCode();
        codes.push(code);
        this.repo.insertPass({
          id_hash: sha256(code),
          label,
          match_id: matchId,
          issued_by: actor,
          issued_at: now,
          expires_at: now + expiresInMs,
          redeemed_at: null,
          redeemed_by_participant_id: null,
          status: 'ISSUED',
          kind: 'SPONSORED',
        });
      }
      this.repo.audit(actor, 'ISSUE_PASSES', null, { count, label, expiresInMs, matchId }, now);
    });
    return codes;
  }

  redeemPass(p: ParticipantRow, reservationId: string, code: string): PaymentStatusPush {
    const { manager } = this.opts;
    this.requireOpenReservation(p, reservationId);
    if (!manager.joinOpen()) throw new AppError('JOIN_CLOSED', '参加受付は終了しました / Joining closed');
    const hash = sha256(normalizePassCode(code));
    const pass = this.repo.getPass(hash);
    const now = this.now();
    const rt = manager.current();
    if (
      !pass ||
      pass.status !== 'ISSUED' ||
      pass.expires_at <= now ||
      (pass.match_id !== null && pass.match_id !== rt.matchId)
    ) {
      throw new AppError('INVALID_PASS', 'パスが無効か使用済みです / Pass is invalid or already used');
    }
    const ap = rt.state.config.apPerParticipant;
    rt.dispatch(
      {
        type: 'ADD_PARTICIPANT',
        participantId: p.id,
        teamId: p.team_id,
        nickname: p.nickname_sanitized,
        isBot: false,
        ap,
      },
      () => {
        if (!this.repo.redeemPass(hash, p.id, now)) {
          throw new AppError('INVALID_PASS', 'パスが無効か使用済みです / Pass is invalid or already used');
        }
        this.repo.setParticipantStatus(p.id, 'ACTIVE', { confirmedAt: now, apTotal: ap, passId: hash });
        this.repo.setReservationStatus(reservationId, 'CONFIRMED');
        this.repo.audit('participant', 'REDEEM_PASS', hash.slice(0, 12), { participantId: p.id }, now);
      },
    );
    this.push(p.id);
    return this.paymentStatus(this.repo.getParticipant(p.id)!);
  }

  // ---- status -------------------------------------------------------------

  paymentStatus(p: ParticipantRow): PaymentStatusPush {
    const res = this.repo.getReservationByParticipant(p.id);
    const inv = res ? this.repo.latestInvoiceForReservation(res.id) : undefined;
    const engineP = this.opts.manager.current().participant(p.id);
    return {
      reservationId: res?.id ?? '',
      participantStatus: p.status,
      invoiceStatus: inv?.status ?? null,
      apRemaining: engineP?.apRemaining ?? 0,
    };
  }

  me(p: ParticipantRow): MeResponse & { lateCarryoverCode: string | null } {
    const res = this.repo.getReservationByParticipant(p.id);
    const inv = res ? this.repo.latestInvoiceForReservation(res.id) : undefined;
    const rt = this.opts.manager.current();
    const engineP = p.match_id === rt.matchId ? rt.participant(p.id) : undefined;
    return {
      matchId: p.match_id,
      participantId: p.id,
      reservationId: res?.id ?? '',
      teamId: p.team_id,
      nickname: p.nickname_sanitized,
      status: p.status,
      invoiceStatus: inv?.status ?? null,
      apTotal: engineP?.apTotal ?? p.ap_total,
      apRemaining: engineP?.apRemaining ?? 0,
      contribution: engineP?.contribution ?? null,
      lastResults: this.repo.recentActionResults(p.id, 5),
      lateCarryoverCode: inv?.carryover_pass_code ?? null,
    };
  }

  private push(participantId: string): void {
    const p = this.repo.getParticipant(participantId);
    if (!p) return;
    const status = this.paymentStatus(p);
    for (const l of this.listeners) l(participantId, status);
  }

  /**
   * Operator disposition for late payments. CARRY_OVER issues a one-time pass
   * that the participant sees on /play and can use in the next match.
   */
  setLateDisposition(
    invoiceId: string,
    disposition: 'CARRY_OVER' | 'REFUND_REQUESTED' | 'RESOLVED',
    note: string,
    actor: string,
  ): InvoiceRow {
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv) throw new AppError('NOT_FOUND', 'invoice not found');
    if (inv.status !== 'LATE_PAID') throw new AppError('INVALID_COMMAND', 'invoice is not a late payment');
    const now = this.now();
    this.repo.tx(() => {
      let code: string | null = inv.carryover_pass_code;
      if (disposition === 'CARRY_OVER' && !code) {
        code = newPassCode();
        this.repo.insertPass({
          id_hash: sha256(code),
          label: `carryover:${inv.id}`,
          match_id: null,
          issued_by: actor,
          issued_at: now,
          expires_at: now + 7 * 24 * 60 * 60_000,
          redeemed_at: null,
          redeemed_by_participant_id: null,
          status: 'ISSUED',
          kind: 'CARRYOVER',
        });
      }
      this.repo.updateInvoice(inv.id, {
        late_payment_disposition: disposition,
        late_payment_note: note.slice(0, 500),
        carryover_pass_code: code,
      });
      this.repo.audit(actor, 'LATE_PAYMENT_DISPOSITION', inv.id, { disposition, note: note.slice(0, 500) }, now);
    });
    this.push(inv.participant_id);
    return this.repo.getInvoice(invoiceId)!;
  }
}
