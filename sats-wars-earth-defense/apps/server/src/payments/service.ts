import { randomUUID } from 'node:crypto';
import { isCombatPhase } from '@swed/shared';
import type { PaymentIntentView, PaymentsStatus, PulseRefusal } from '@swed/shared';
import type { Db } from '../db';
import { audit, nowIso, tx } from '../db';
import type { MatchRuntime } from '../runtime';
import type { PilotRow } from '../sessions';
import type { LnbitsPaymentProvider } from './lnbits';
import type { PaymentMode, PaymentProvider } from './provider';
import type { SandboxPaymentProvider } from './sandbox';

/**
 * Shared energy pulses (spec §8): a fixed-size Lightning payment that adds a fixed amount
 * to TEAM CAPACITOR. Rules that keep money from deciding the fight:
 *   - one size only (default 21 sats → +20), per-pilot cooldown and per-match caps
 *   - settlement is confirmed by asking the backend; webhooks are only a hint
 *   - each intent applies at most once (DB status transition + engine intent id)
 *   - a payment that settles after its round is recorded as unapplied, never carried over
 *   - live mode starts OFF; staff turn it on in /operator after checks (spec §4.8)
 */

interface IntentRow {
  id: string;
  pilot_id: string;
  match_id: string;
  seat_id: string | null;
  amount_sats: number;
  mode: PaymentMode;
  provider: string;
  payment_hash: string;
  payment_request: string;
  status: PaymentIntentView['status'];
  applied: 'applied' | 'unapplied' | null;
  created_at: string;
  expires_at: string;
  settled_at: string | null;
  note: string | null;
}

export const INVOICE_TTL_SECONDS = 180;

export interface PaymentServiceDeps {
  db: Db;
  runtime: MatchRuntime;
  provider: PaymentProvider;
  recipient: string;
  amountSats: number;
  /** LNbits webhook URL (live) or undefined. */
  webhookUrl?: string;
  /** Public URL the reachability check calls (live). */
  pingUrl?: string;
  notify: (pilotId: string, view: PaymentIntentView) => void;
  log?: { warn: (o: object, msg?: string) => void; info: (o: object, msg?: string) => void };
  fetch?: typeof fetch;
}

type CheckResult = { ok: boolean; detail: string; at: string };

export class PaymentService {
  readonly mode: PaymentMode;
  private liveEnabled = false;
  private checks: { backend: CheckResult | null; webhook: CheckResult | null } = {
    backend: null,
    webhook: null,
  };
  private readonly creating = new Set<string>();
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: PaymentServiceDeps) {
    this.mode = deps.provider.mode;
  }

  /** Sandbox pulses are always available (VIRTUAL); live ones only after staff approval. */
  get enabled(): boolean {
    return this.mode === 'sandbox' || this.liveEnabled;
  }

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.poll(), 3_000);
    this.pollTimer.unref?.();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private row(id: string): IntentRow | undefined {
    return this.deps.db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(id) as
      IntentRow | undefined;
  }

  private view(r: IntentRow): PaymentIntentView {
    return {
      intentId: r.id,
      status: r.status,
      applied: r.applied,
      amountSats: r.amount_sats,
      mode: r.mode,
      recipient: this.deps.recipient,
      paymentRequest: r.status === 'pending' ? r.payment_request : null,
      expiresAt: r.expires_at,
      matchId: r.match_id,
    };
  }

  /** Limits for the current match, from the frozen match config. */
  private limits() {
    const p = this.deps.runtime.state.config.pulses;
    return {
      perPilot: p.perPilotPerMatch,
      cooldownMs: p.cooldownMs,
      maxPerMatch: p.maxPerMatch,
      gain: p.capacitorGain,
    };
  }

  /** Everything the phone needs to show before the pilot decides (amount, receiver, limits). */
  quote(pilot: PilotRow): PaymentsStatus {
    const s = this.deps.runtime.state;
    const lim = this.limits();
    const mine = this.deps.db
      .prepare(
        "SELECT COUNT(*) AS n, MAX(created_at) AS last FROM payment_intents WHERE match_id = ? AND pilot_id = ? AND status IN ('pending','settled')",
      )
      .get(s.matchId, pilot.id) as { n: number; last: string | null };
    const lastAt = mine.last ? Date.parse(mine.last) : 0;
    return {
      mode: this.mode,
      enabled: this.enabled,
      amountSats: this.deps.amountSats,
      capacitorGain: lim.gain,
      recipient: this.deps.recipient,
      remaining: Math.max(0, lim.perPilot - mine.n),
      cooldownUntil: lastAt ? new Date(lastAt + lim.cooldownMs).toISOString() : null,
      inCombat: isCombatPhase(s.phase) && this.deps.runtime.seatOf(pilot.id) !== null,
      capacitorFull: s.teamCapacitor >= s.config.capacitor.max,
    };
  }

  async createIntent(
    pilot: PilotRow,
    matchId: string,
  ): Promise<
    | { ok: true; intent: PaymentIntentView }
    | { ok: false; code: PulseRefusal; retryAfterMs?: number }
  > {
    const rt = this.deps.runtime;
    const s = rt.state;
    if (!this.enabled) return { ok: false, code: 'PAYMENTS_DISABLED' };
    if (matchId !== s.matchId) return { ok: false, code: 'STALE_MATCH' };
    const seat = rt.seatOf(pilot.id);
    if (!seat || !isCombatPhase(s.phase)) return { ok: false, code: 'NOT_IN_COMBAT' };
    if (this.creating.has(pilot.id)) return { ok: false, code: 'PULSE_PENDING' };
    const db = this.deps.db;
    const lim = this.limits();
    const pending = db
      .prepare(
        "SELECT COUNT(*) AS n FROM payment_intents WHERE pilot_id = ? AND status = 'pending'",
      )
      .get(pilot.id) as { n: number };
    if (pending.n > 0) return { ok: false, code: 'PULSE_PENDING' };
    const mine = db
      .prepare(
        "SELECT COUNT(*) AS n, MAX(created_at) AS last FROM payment_intents WHERE match_id = ? AND pilot_id = ? AND status IN ('pending','settled')",
      )
      .get(s.matchId, pilot.id) as { n: number; last: string | null };
    if (mine.n >= lim.perPilot) return { ok: false, code: 'PULSE_LIMIT' };
    if (mine.last) {
      const wait = Date.parse(mine.last) + lim.cooldownMs - Date.now();
      if (wait > 0) return { ok: false, code: 'PULSE_COOLDOWN', retryAfterMs: wait };
    }
    const total = db
      .prepare(
        "SELECT COUNT(*) AS n FROM payment_intents WHERE match_id = ? AND status IN ('pending','settled')",
      )
      .get(s.matchId) as { n: number };
    if (total.n >= lim.maxPerMatch) return { ok: false, code: 'PULSE_MATCH_LIMIT' };
    // Never sell a pulse that cannot add anything (real money for no effect).
    if (s.teamCapacitor >= s.config.capacitor.max) return { ok: false, code: 'CAPACITOR_FULL' };

    const intentId = `pi_${randomUUID()}`;
    this.creating.add(pilot.id);
    try {
      const inv = await this.deps.provider.createInvoice({
        intentId,
        amountSats: this.deps.amountSats,
        memo: `SATS WARS shared energy pulse (match #${s.matchNumber})`,
        expiresInSeconds: INVOICE_TTL_SECONDS,
        webhookUrl: this.deps.webhookUrl,
      });
      db.prepare(
        `INSERT INTO payment_intents
           (id, pilot_id, match_id, seat_id, amount_sats, mode, provider, payment_hash, payment_request, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(
        intentId,
        pilot.id,
        s.matchId,
        seat,
        this.deps.amountSats,
        this.mode,
        this.deps.provider.name,
        inv.paymentHash,
        inv.paymentRequest,
        nowIso(),
        inv.expiresAt,
      );
      audit(
        db,
        `pilot:${pilot.public_name}`,
        'PULSE_INTENT',
        `${intentId} ${this.mode} ${this.deps.amountSats}sats`,
      );
      return { ok: true, intent: this.view(this.row(intentId)!) };
    } catch (err) {
      this.deps.log?.warn({ err: String(err) }, 'invoice creation failed');
      return { ok: false, code: 'BACKEND_UNAVAILABLE' };
    } finally {
      this.creating.delete(pilot.id);
    }
  }

  getIntent(pilot: PilotRow, id: string): PaymentIntentView | null {
    const r = this.row(id);
    return r && r.pilot_id === pilot.id ? this.view(r) : null;
  }

  /**
   * The only path that turns money into a pulse. Synchronous from the status flip to the
   * engine command, so concurrent webhooks and pollers cannot both apply it.
   */
  private confirmSettled(r: IntentRow, via: string): boolean {
    const db = this.deps.db;
    const rt = this.deps.runtime;
    const result = tx(db, () => {
      const upd = db
        .prepare(
          "UPDATE payment_intents SET status = 'settled', settled_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(nowIso(), r.id);
      if (Number(upd.changes) !== 1) return 'duplicate' as const;
      let applied: 'applied' | 'unapplied' = 'unapplied';
      let note = '';
      if (rt.state.matchId === r.match_id && isCombatPhase(rt.state.phase)) {
        const out = rt.applyPulse(r.id, r.seat_id, r.mode === 'sandbox');
        applied = out ? 'applied' : 'unapplied';
        if (!out) note = 'engine refused (duplicate or not in combat)';
      } else {
        // Spec §8.4: not carried to the next round; staff follow up from the audit log.
        note = 'settled after its round ended';
      }
      db.prepare('UPDATE payment_intents SET applied = ?, note = ? WHERE id = ?').run(
        applied,
        note || null,
        r.id,
      );
      audit(
        db,
        'payments',
        applied === 'applied' ? 'PULSE_APPLIED' : 'PULSE_UNAPPLIED',
        `${r.id} via ${via} ${note}`.trim(),
      );
      return applied;
    });
    if (result === 'duplicate') return false;
    this.deps.notify(r.pilot_id, this.view(this.row(r.id)!));
    return true;
  }

  private markExpired(r: IntentRow): void {
    const upd = this.deps.db
      .prepare("UPDATE payment_intents SET status = 'expired' WHERE id = ? AND status = 'pending'")
      .run(r.id);
    if (Number(upd.changes) === 1) this.deps.notify(r.pilot_id, this.view(this.row(r.id)!));
  }

  /** Re-check one intent with the backend (webhook hint, poller, or manual refresh). */
  async recheck(r: IntentRow, via: string): Promise<void> {
    if (r.status !== 'pending') return;
    let status;
    try {
      status = await this.deps.provider.lookupPayment(r.payment_hash);
    } catch (err) {
      this.deps.log?.warn({ intent: r.id, err: String(err) }, 'payment lookup failed');
      return;
    }
    const fresh = this.row(r.id);
    if (!fresh || fresh.status !== 'pending') return;
    if (status === 'settled') this.confirmSettled(fresh, via);
    else if (
      status === 'expired' ||
      status === 'failed' ||
      Date.parse(fresh.expires_at) < Date.now()
    ) {
      this.markExpired(fresh);
    }
  }

  async onWebhook(body: unknown): Promise<void> {
    const hash = this.deps.provider.webhookHint?.(body) ?? null;
    if (!hash) return;
    const r = this.deps.db
      .prepare('SELECT * FROM payment_intents WHERE payment_hash = ?')
      .get(hash) as IntentRow | undefined;
    if (r) await this.recheck(r, 'webhook');
  }

  async poll(): Promise<void> {
    const rows = this.deps.db
      .prepare(
        "SELECT * FROM payment_intents WHERE status = 'pending' ORDER BY created_at LIMIT 50",
      )
      .all() as unknown as IntentRow[];
    for (const r of rows) {
      if (this.mode === 'sandbox') {
        if (Date.parse(r.expires_at) < Date.now()) this.markExpired(r);
      } else {
        await this.recheck(r, 'poll');
      }
    }
  }

  /** Operator: settle a VIRTUAL invoice (sandbox only). */
  sandboxSettle(intentId: string): { ok: boolean; message: string } {
    if (this.mode !== 'sandbox') return { ok: false, message: 'only in sandbox mode' };
    const r = this.row(intentId);
    if (!r || r.status !== 'pending') return { ok: false, message: 'no pending intent' };
    const sandbox = this.deps.provider as SandboxPaymentProvider;
    if (!sandbox.settle(r.payment_hash)) return { ok: false, message: 'already settled' };
    this.confirmSettled(r, 'operator-sandbox');
    return { ok: true, message: `VIRTUAL pulse ${intentId} settled` };
  }

  /** Operator: connectivity and reachability checks before turning live payments on. */
  async runChecks(): Promise<{ backend: CheckResult | null; webhook: CheckResult | null }> {
    if (this.mode !== 'live') return this.checks;
    const at = nowIso();
    try {
      const info = await (this.deps.provider as LnbitsPaymentProvider).walletInfo();
      this.checks.backend = {
        ok: true,
        detail: `LNbits wallet "${info.name}" reachable (invoice key)`,
        at,
      };
    } catch (err) {
      this.checks.backend = {
        ok: false,
        detail: `LNbits unreachable: ${String(err).slice(0, 120)}`,
        at,
      };
    }
    try {
      const res = await (this.deps.fetch ?? fetch)(this.deps.pingUrl!, {
        signal: AbortSignal.timeout(8_000),
      });
      const ok = res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
      this.checks.webhook = {
        ok,
        detail: ok ? 'public webhook URL answers' : `webhook URL answered HTTP ${res.status}`,
        at,
      };
    } catch (err) {
      this.checks.webhook = {
        ok: false,
        detail: `public webhook URL unreachable: ${String(err).slice(0, 120)}`,
        at,
      };
    }
    return this.checks;
  }

  enableLive(confirm: string): { ok: boolean; message: string } {
    if (this.mode !== 'live') return { ok: false, message: 'server is in sandbox mode' };
    if (confirm !== 'LIVE') return { ok: false, message: 'type LIVE to confirm' };
    const fresh = (c: CheckResult | null) => c?.ok && Date.now() - Date.parse(c.at) < 10 * 60_000;
    if (!fresh(this.checks.backend) || !fresh(this.checks.webhook)) {
      return { ok: false, message: 'run the checks first (both must pass within 10 minutes)' };
    }
    this.liveEnabled = true;
    return {
      ok: true,
      message: `LIVE payments ON: ${this.deps.amountSats} sats → ${this.deps.recipient}`,
    };
  }

  disable(): { ok: boolean; message: string } {
    this.liveEnabled = false;
    return {
      ok: true,
      message: this.mode === 'live' ? 'LIVE payments OFF' : 'sandbox pulses stay VIRTUAL',
    };
  }

  operatorView() {
    const rows = this.deps.db
      .prepare('SELECT * FROM payment_intents ORDER BY created_at DESC LIMIT 15')
      .all() as unknown as IntentRow[];
    const s = this.deps.runtime.state;
    const totals = this.deps.db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(amount_sats),0) AS sats FROM payment_intents WHERE status = 'settled'",
      )
      .get() as { n: number; sats: number };
    const lim = this.limits();
    return {
      mode: this.mode,
      provider: this.deps.provider.name,
      enabled: this.enabled,
      liveEnabled: this.liveEnabled,
      recipient: this.deps.recipient,
      amountSats: this.deps.amountSats,
      capacitorGain: lim.gain,
      perPilotPerMatch: lim.perPilot,
      cooldownSec: Math.round(lim.cooldownMs / 1000),
      maxPerMatch: lim.maxPerMatch,
      checks: this.checks,
      settledTotal: totals,
      recent: rows.map((r) => ({
        intentId: r.id,
        status: r.status,
        applied: r.applied,
        amountSats: r.amount_sats,
        mode: r.mode,
        seatId: r.seat_id,
        createdAt: r.created_at,
        currentMatch: r.match_id === s.matchId,
        note: r.note,
      })),
    };
  }
}
