import type {
  CreditPush,
  InvoiceResponse,
  InvoiceStatus,
  JoinResponse,
  MeResponse,
  RedeemPassResponse,
  TeamId,
  TopupStatusResponse,
  ZapResult,
} from '@sats-wars/shared';
import { TEAM_META, sanitizeNickname, zapsFor } from '@sats-wars/shared';
import type { WallClock } from '../clock';
import type { InvoiceRow, PlayerRow, Repo, ZapRow } from '../db/repo';
import { AppError } from '../errors';
import type { MatchManager } from '../match/manager';
import { newId, newPassCode, newToken, normalizePassCode, sha256 } from '../auth/tokens';
import type { PaymentAdapter } from './adapter';
import { MockPaymentAdapter } from './mock';

export interface PlayerServiceOptions {
  repo: Repo;
  manager: MatchManager;
  adapter: PaymentAdapter;
  wall: WallClock;
  payeeDescription: string;
  /** Full webhook URL (including secret path segment) or undefined. */
  webhookUrl?: string;
  /** Keep checking pending invoices this long after their expiry. */
  lateGraceMs?: number;
  /** How long BOLT11 strings are kept after settlement/expiry. */
  bolt11RetentionMs?: number;
  log?: { warn: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };
}

type CreditListener = (playerId: string, push: CreditPush) => void;

export function zapRowToResult(z: ZapRow): ZapResult {
  return {
    ok: true,
    code: z.code,
    teamId: z.team_id,
    damage: z.damage,
    special: z.special === 1,
    pinch: z.pinch === 1,
    atGameMs: z.at_game_ms,
    roundIndex: z.round_index,
  };
}

/**
 * Players and their prepaid credit. Joining is free and instant (pick a team);
 * sats are topped up once via Lightning and then spent punch by punch. Credit
 * is only ever added after the server re-verifies a payment with the provider,
 * exactly once per invoice, and it carries over between seasons.
 */
export class PlayerService {
  private listeners = new Set<CreditListener>();
  private checking = new Set<string>();
  private readonly lateGraceMs: number;

  constructor(private opts: PlayerServiceOptions) {
    this.lateGraceMs = opts.lateGraceMs ?? 10 * 60_000;
  }

  private get repo(): Repo {
    return this.opts.repo;
  }
  private now(): number {
    return this.opts.wall.now();
  }

  onCredit(listener: CreditListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private push(playerId: string, extra: Partial<CreditPush> = {}): void {
    const p = this.repo.getPlayer(playerId);
    if (!p) return;
    const msg: CreditPush = {
      creditSats: p.credit_sats,
      invoiceId: null,
      invoiceStatus: null,
      addedSats: 0,
      ...extra,
    };
    for (const l of this.listeners) l(playerId, msg);
  }

  // ---- identity -----------------------------------------------------------

  authenticate(token: string | null): PlayerRow | null {
    if (!token) return null;
    return this.repo.getPlayerBySession(sha256(token)) ?? null;
  }

  /**
   * Join with a team. A device that already has a player gets that player
   * back (with its remaining credit) under a fresh token, so clearing a
   * browser tab never loses sats.
   */
  join(input: { teamId: TeamId; nickname?: string; deviceId?: string }): JoinResponse {
    const now = this.now();
    const token = newToken();
    const deviceHash = input.deviceId ? sha256(`device:${input.deviceId}`) : null;
    return this.repo.tx(() => {
      const existing = deviceHash ? this.repo.getPlayerByDevice(deviceHash) : undefined;
      if (existing) {
        this.repo.setPlayerSession(existing.id, sha256(token));
        this.repo.setPlayerTeam(existing.id, input.teamId);
        if (input.nickname?.trim()) {
          this.repo.setPlayerNickname(existing.id, sanitizeNickname(input.nickname, existing.id.slice(-4)).nickname);
        }
        this.repo.touchPlayer(existing.id, now);
        const p = this.repo.getPlayer(existing.id)!;
        this.opts.manager.invalidateSupporters();
        return { playerId: p.id, token, nickname: p.nickname, teamId: p.team_id, creditSats: p.credit_sats };
      }
      const id = newId('p');
      const fallback = `${TEAM_META[input.teamId].nameJa}ファン${id.slice(-3).toUpperCase()}`;
      const nickname = input.nickname?.trim()
        ? sanitizeNickname(input.nickname, id.slice(-4)).nickname
        : fallback;
      this.repo.insertPlayer({
        id,
        session_id_hash: sha256(token),
        device_hash: deviceHash,
        nickname,
        nickname_hidden: 0,
        team_id: input.teamId,
        credit_sats: 0,
        zaps_total: 0,
        kos: 0,
        created_at: now,
        last_seen_at: now,
      });
      this.opts.manager.invalidateSupporters();
      return { playerId: id, token, nickname, teamId: input.teamId, creditSats: 0 };
    });
  }

  changeTeam(p: PlayerRow, teamId: TeamId): void {
    this.repo.tx(() => {
      this.repo.setPlayerTeam(p.id, teamId);
      this.repo.touchPlayer(p.id, this.now());
    });
    this.opts.manager.invalidateSupporters();
  }

  changeNickname(p: PlayerRow, raw: string): string {
    const { nickname } = sanitizeNickname(raw, p.id.slice(-4));
    this.repo.setPlayerNickname(p.id, nickname);
    return nickname;
  }

  me(p: PlayerRow): MeResponse {
    const now = this.now();
    this.repo.touchPlayer(p.id, now);
    const inv = this.repo.pendingInvoiceForPlayer(p.id, now);
    return {
      playerId: p.id,
      nickname: p.nickname,
      teamId: p.team_id,
      creditSats: p.credit_sats,
      zapsThisSeason: this.repo.zapCountInMatch(this.opts.manager.current().matchId, p.id),
      zapsTotal: p.zaps_total,
      kos: p.kos,
      pendingInvoice: inv ? this.invoiceResponse(inv) : null,
      lastResults: this.repo.recentZaps(p.id, 5).map(zapRowToResult),
    };
  }

  // ---- top-up via Lightning ----------------------------------------------

  async createTopup(p: PlayerRow, amountSats: number): Promise<InvoiceResponse> {
    const { manager, adapter } = this.opts;
    const cfg = manager.liveConfig;
    if (!cfg.topupOptionsSats.includes(amountSats)) {
      throw new AppError('BAD_REQUEST', `amountSats must be one of ${cfg.topupOptionsSats.join(', ')}`);
    }
    if (!manager.paymentsEnabled) {
      throw new AppError(
        'PAYMENTS_DISABLED',
        '現在、チャージの受付を停止しています。スポンサーコードか無料の応援をご利用ください / Top-ups are paused',
      );
    }
    const existing = this.repo.pendingInvoiceForPlayer(p.id, this.now() + 15_000);
    if (existing && existing.amount_sats === amountSats) return this.invoiceResponse(existing);
    const expirySeconds = Math.floor(cfg.invoiceTtlMs / 1000);
    const memo = `SATS WARS ${amountSats} sats (${zapsFor(amountSats, cfg)} punches)`;
    let created;
    try {
      created = await adapter.createInvoice({
        amountSats,
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
      player_id: p.id,
      provider: adapter.mode,
      lnbits_checking_id: created.checkingId,
      payment_hash: created.paymentHash,
      amount_sats: amountSats,
      bolt11: created.bolt11,
      memo,
      expires_at: now + expirySeconds * 1000,
      status: 'PENDING',
      created_at: now,
      verified_at: null,
      credited_at: null,
      last_checked_at: null,
      check_failures: 0,
    };
    this.repo.insertInvoice(row);
    return this.invoiceResponse(row);
  }

  invoiceResponse(row: InvoiceRow): InvoiceResponse {
    return {
      invoiceId: row.id,
      amountSats: row.amount_sats,
      zaps: zapsFor(row.amount_sats, this.opts.manager.liveConfig),
      bolt11: row.bolt11 ?? '',
      expiresAt: row.expires_at,
      status: row.status,
      paymentMode: this.opts.adapter.mode,
      payeeDescription: this.opts.payeeDescription,
      memo: row.memo,
    };
  }

  topupStatus(p: PlayerRow, invoiceId: string): TopupStatusResponse {
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv || inv.player_id !== p.id) throw new AppError('NOT_FOUND', 'invoice not found');
    return { invoiceId, status: inv.status, creditSats: this.repo.getPlayer(p.id)!.credit_sats };
  }

  /**
   * Ask the provider for the authoritative status and credit if paid. Safe to
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
      if (status === 'PAID') return this.credit(inv.id);
      const expiredLocally = inv.expires_at + this.lateGraceMs <= this.now();
      if (status === 'EXPIRED' || status === 'FAILED' || expiredLocally) {
        const final = status === 'FAILED' ? 'FAILED' : 'EXPIRED';
        this.repo.updateInvoice(inv.id, { status: final });
        this.push(inv.player_id, { invoiceId: inv.id, invoiceStatus: final });
        return final;
      }
      return 'PENDING';
    } finally {
      this.checking.delete(invoiceId);
    }
  }

  /** Add credit exactly once for a verified payment (atomic PENDING -> PAID flip). */
  credit(invoiceId: string): InvoiceStatus {
    const now = this.now();
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv) throw new AppError('NOT_FOUND', 'invoice not found');
    const credited = this.repo.tx(() => {
      if (!this.repo.markInvoicePaid(inv.id, now)) return false;
      this.repo.changeCredit(inv.player_id, inv.amount_sats, 'TOPUP', inv.id, now);
      this.repo.touchPlayer(inv.player_id, now);
      return true;
    });
    if (credited) {
      this.push(inv.player_id, { invoiceId: inv.id, invoiceStatus: 'PAID', addedSats: inv.amount_sats });
    }
    return 'PAID';
  }

  /** Dev-only: simulate a wallet paying a mock invoice, then run the normal verification path. */
  async mockPay(p: PlayerRow, invoiceId: string): Promise<InvoiceStatus | null> {
    const adapter = this.opts.adapter;
    if (!(adapter instanceof MockPaymentAdapter)) throw new AppError('NOT_MOCK_MODE', 'not available');
    const inv = this.repo.getInvoice(invoiceId);
    if (!inv || inv.player_id !== p.id) throw new AppError('NOT_FOUND', 'invoice not found');
    adapter.markPaid(inv.lnbits_checking_id);
    return this.checkInvoice(inv.id);
  }

  /** Webhook: treat as a hint only, then re-verify with the provider. */
  async handleWebhook(paymentHash: string): Promise<void> {
    const inv = this.repo.getInvoiceByPaymentHash(paymentHash);
    if (inv) await this.checkInvoice(inv.id);
  }

  /** Background reconciliation: covers missing/delayed webhooks. */
  async pollPending(): Promise<void> {
    const now = this.now();
    for (const inv of this.repo.invoicesToCheck()) await this.checkInvoice(inv.id);
    this.repo.purgeBolt11(now - (this.opts.bolt11RetentionMs ?? 24 * 60 * 60_000));
  }

  // ---- sponsored / free codes ----------------------------------------------

  issuePasses(count: number, amountSats: number, expiresInMs: number, label: string, actor: string): string[] {
    const now = this.now();
    const codes: string[] = [];
    this.repo.tx(() => {
      for (let i = 0; i < count; i++) {
        const code = newPassCode();
        codes.push(code);
        this.repo.insertPass({
          id_hash: sha256(code),
          label,
          amount_sats: amountSats,
          issued_by: actor,
          issued_at: now,
          expires_at: now + expiresInMs,
          redeemed_at: null,
          redeemed_by_player_id: null,
          status: 'ISSUED',
        });
      }
      this.repo.audit(actor, 'ISSUE_PASSES', null, { count, amountSats, label, expiresInMs }, now);
    });
    return codes;
  }

  redeemPass(p: PlayerRow, code: string): RedeemPassResponse {
    const hash = sha256(normalizePassCode(code));
    const now = this.now();
    const pass = this.repo.getPass(hash);
    if (!pass || pass.status !== 'ISSUED' || pass.expires_at <= now) {
      throw new AppError('INVALID_PASS', 'コードが無効か使用済みです / Code is invalid or already used');
    }
    const balance = this.repo.tx(() => {
      if (!this.repo.redeemPass(hash, p.id, now)) {
        throw new AppError('INVALID_PASS', 'コードが無効か使用済みです / Code is invalid or already used');
      }
      const b = this.repo.changeCredit(p.id, pass.amount_sats, 'PASS', hash.slice(0, 12), now)!;
      this.repo.touchPlayer(p.id, now);
      return b;
    });
    this.push(p.id, { addedSats: pass.amount_sats });
    return { addedSats: pass.amount_sats, creditSats: balance };
  }

  /** Staff correction (e.g. compensation). Audited; never moves real money. */
  adjustCredit(playerId: string, deltaSats: number, note: string, actor: string): number {
    const now = this.now();
    const balance = this.repo.tx(() => {
      const b = this.repo.changeCredit(playerId, deltaSats, 'ADJUST', `admin:${actor}`, now);
      if (b === null) throw new AppError('BAD_REQUEST', 'balance cannot go below zero');
      this.repo.audit(actor, 'ADJUST_CREDIT', playerId, { deltaSats, note: note.slice(0, 200), balance: b }, now);
      return b;
    });
    this.push(playerId, { addedSats: deltaSats });
    return balance;
  }
}
