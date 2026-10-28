import type {
  ActionResult,
  ClashRecord,
  GameConfig,
  GameEvent,
  InvoiceStatus,
  MatchResult,
  MatchState,
  ParticipantStatus,
  TeamId,
} from '@sats-wars/shared';
import { TEAM_IDS } from '@sats-wars/shared';
import type { EngineCommand } from '@sats-wars/game-engine';
import { countOwnedRegions } from '@sats-wars/game-engine';
import { type Db, transaction } from './database';

export interface MatchRow {
  id: string;
  config_version: string;
  config_json: string;
  seed: number;
  status: string;
  clock_ms: number;
  created_at: number;
  lobby_opened_at: number | null;
  started_at: number | null;
  ended_at: number | null;
  winner_team_id: string | null;
  result_json: string | null;
  final_snapshot_json: string | null;
}

export interface ParticipantRow {
  id: string;
  match_id: string;
  team_id: TeamId;
  nickname_sanitized: string;
  nickname_hidden: number;
  session_id_hash: string;
  device_hash: string | null;
  source: 'PAID' | 'PASS' | 'DEMO';
  status: ParticipantStatus;
  joined_at: number;
  confirmed_at: number | null;
  ap_total: number;
  sponsored_pass_id: string | null;
}

export interface ReservationRow {
  id: string;
  match_id: string;
  team_id: TeamId;
  participant_id: string;
  expires_at: number;
  status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  created_at: number;
}

export interface InvoiceRow {
  id: string;
  participant_id: string;
  reservation_id: string;
  match_id: string;
  provider: string;
  lnbits_checking_id: string;
  payment_hash: string;
  amount_sats: number;
  bolt11: string | null;
  memo: string;
  expires_at: number;
  status: InvoiceStatus;
  created_at: number;
  verified_at: number | null;
  fulfillment_at: number | null;
  last_checked_at: number | null;
  check_failures: number;
  late_payment_disposition: string | null;
  late_payment_note: string | null;
  carryover_pass_code: string | null;
}

export interface PassRow {
  id_hash: string;
  label: string;
  match_id: string | null;
  issued_by: string;
  issued_at: number;
  expires_at: number;
  redeemed_at: number | null;
  redeemed_by_participant_id: string | null;
  status: 'ISSUED' | 'REDEEMED' | 'REVOKED' | 'EXPIRED';
  kind: 'SPONSORED' | 'CARRYOVER';
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target_id: string | null;
  before_after_json: string | null;
  timestamp: number;
}

type Params = Array<string | number | bigint | null | Uint8Array>;

/** Thin typed data access layer. Keep SQL here so a Postgres port only touches this file. */
export class Repo {
  constructor(readonly db: Db) {}

  tx<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  private get<T>(sql: string, ...params: Params): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  private all<T>(sql: string, ...params: Params): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  private run(sql: string, ...params: Params): void {
    this.db.prepare(sql).run(...params);
  }

  ping(): boolean {
    return this.get<{ ok: number }>('SELECT 1 AS ok')?.ok === 1;
  }

  // ---- settings -----------------------------------------------------------
  getSetting<T>(key: string): T | undefined {
    const row = this.get<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', key);
    return row ? (JSON.parse(row.value_json) as T) : undefined;
  }
  setSetting(key: string, value: unknown): void {
    this.run(
      'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      key,
      JSON.stringify(value),
    );
  }

  // ---- matches ------------------------------------------------------------
  insertMatch(id: string, config: GameConfig, seed: number, now: number): void {
    this.run(
      'INSERT INTO matches (id, config_version, config_json, seed, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      config.version,
      JSON.stringify(config),
      seed,
      'CREATED',
      now,
    );
  }
  getMatch(id: string): MatchRow | undefined {
    return this.get<MatchRow>('SELECT * FROM matches WHERE id = ?', id);
  }
  latestUnfinishedMatch(): MatchRow | undefined {
    return this.get<MatchRow>(
      "SELECT * FROM matches WHERE status NOT IN ('FINISHED', 'CANCELLED') ORDER BY created_at DESC LIMIT 1",
    );
  }
  latestMatch(): MatchRow | undefined {
    return this.get<MatchRow>('SELECT * FROM matches ORDER BY created_at DESC LIMIT 1');
  }
  listMatches(limit: number): MatchRow[] {
    return this.all<MatchRow>('SELECT * FROM matches ORDER BY created_at DESC LIMIT ?', limit);
  }
  appendCommand(matchId: string, idx: number, cmd: EngineCommand, now: number): void {
    this.run(
      'INSERT INTO match_commands (match_id, idx, t, command_json, created_at) VALUES (?, ?, ?, ?, ?)',
      matchId,
      idx,
      cmd.t,
      JSON.stringify(cmd),
      now,
    );
  }
  loadCommands(matchId: string): EngineCommand[] {
    return this.all<{ command_json: string }>(
      'SELECT command_json FROM match_commands WHERE match_id = ? ORDER BY idx',
      matchId,
    ).map((r) => JSON.parse(r.command_json) as EngineCommand);
  }
  commandCount(matchId: string): number {
    return this.get<{ n: number }>('SELECT COUNT(*) AS n FROM match_commands WHERE match_id = ?', matchId)?.n ?? 0;
  }

  /** Persist engine-derived projections for querying/reporting. */
  saveMatchProjection(state: MatchState, now: number, finalSnapshot?: unknown): void {
    const s = state;
    const started =
      s.status === 'LIVE' ||
      s.status === 'FINALIZING' ||
      s.status === 'FINISHED' ||
      (s.status === 'PAUSED' && s.pausedFrom !== 'LOBBY');
    this.run(
      `UPDATE matches SET status = ?, clock_ms = ?, revision = ?,
         lobby_opened_at = COALESCE(lobby_opened_at, ?),
         started_at = COALESCE(started_at, ?),
         action_closed_at = COALESCE(action_closed_at, ?),
         ended_at = COALESCE(ended_at, ?),
         winner_team_id = ?, result_json = ?,
         final_snapshot_json = COALESCE(?, final_snapshot_json)
       WHERE id = ?`,
      s.status,
      s.clockMs,
      s.revision,
      s.status !== 'CREATED' ? now : null,
      started ? now : null,
      s.status === 'FINALIZING' ? now : null,
      s.status === 'FINISHED' || s.status === 'CANCELLED' ? now : null,
      s.result?.winnerTeamId ?? null,
      s.result ? JSON.stringify(s.result) : null,
      finalSnapshot ? JSON.stringify(finalSnapshot) : null,
      s.matchId,
    );
    for (const teamId of TEAM_IDS) {
      const t = s.teams[teamId];
      this.run(
        `INSERT INTO teams (match_id, team_id, robot_id, health, energy, participant_count, region_count, action_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(match_id, team_id) DO UPDATE SET health = excluded.health, energy = excluded.energy,
           participant_count = excluded.participant_count, region_count = excluded.region_count,
           action_count = excluded.action_count`,
        s.matchId,
        teamId,
        t.robotId,
        t.hp,
        t.energy,
        t.participantCount,
        countOwnedRegions(s, teamId),
        t.actionCount,
      );
    }
    for (const id of s.regionOrder) {
      const r = s.regions[id];
      this.run(
        `INSERT INTO region_states (match_id, region_id, kind, owner_team_id, contested_by_team_id, contested_until,
           shield_charges, shield_expires_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(match_id, region_id) DO UPDATE SET owner_team_id = excluded.owner_team_id,
           contested_by_team_id = excluded.contested_by_team_id, contested_until = excluded.contested_until,
           shield_charges = excluded.shield_charges, shield_expires_at = excluded.shield_expires_at,
           revision = excluded.revision`,
        s.matchId,
        id,
        r.kind,
        r.ownerTeamId,
        r.contestedByTeamId,
        r.contestedUntil,
        r.shieldCharges,
        r.shieldExpiresAt,
        r.revision,
      );
    }
  }

  updateMatchClock(matchId: string, clockMs: number): void {
    this.run('UPDATE matches SET clock_ms = ? WHERE id = ?', clockMs, matchId);
  }

  insertEvents(events: GameEvent[], revision: number): void {
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO game_events (match_id, seq, t, game_ms, type, payload_json, state_revision) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const e of events) {
      stmt.run(e.matchId, e.seq, e.t, e.gameMs, e.type, JSON.stringify(e), revision);
      if (e.type === 'CLASH_RESOLVED') this.insertClash(e.matchId, e.data.clash);
    }
  }

  loadEvents(matchId: string, afterSeq = 0, limit = 10_000): GameEvent[] {
    return this.all<{ payload_json: string }>(
      'SELECT payload_json FROM game_events WHERE match_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      matchId,
      afterSeq,
      limit,
    ).map((r) => JSON.parse(r.payload_json) as GameEvent);
  }

  recentEvents(matchId: string, limit: number): GameEvent[] {
    return this.all<{ payload_json: string }>(
      'SELECT payload_json FROM game_events WHERE match_id = ? ORDER BY seq DESC LIMIT ?',
      matchId,
      limit,
    )
      .map((r) => JSON.parse(r.payload_json) as GameEvent)
      .reverse();
  }

  private insertClash(matchId: string, c: ClashRecord): void {
    this.run(
      `INSERT OR IGNORE INTO clashes (match_id, clash_index, resolved_at_game_ms, snapshot_json, raijin_damage,
         fujin_damage, resulting_hp_json, special_flags_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      matchId,
      c.clashIndex,
      c.atGameMs,
      JSON.stringify(c.snapshot),
      c.outcome.RAIJIN.damageDealt,
      c.outcome.FUJIN.damageDealt,
      JSON.stringify({ RAIJIN: c.outcome.RAIJIN.hpAfter, FUJIN: c.outcome.FUJIN.hpAfter }),
      JSON.stringify({ RAIJIN: c.outcome.RAIJIN.special, FUJIN: c.outcome.FUJIN.special }),
    );
  }

  getResult(matchId: string): MatchResult | null {
    const row = this.getMatch(matchId);
    return row?.result_json ? (JSON.parse(row.result_json) as MatchResult) : null;
  }

  // ---- participants & reservations --------------------------------------
  insertParticipant(p: ParticipantRow): void {
    this.run(
      `INSERT INTO participants (id, match_id, team_id, nickname_sanitized, nickname_hidden, session_id_hash, device_hash,
         source, status, joined_at, confirmed_at, ap_total, sponsored_pass_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id,
      p.match_id,
      p.team_id,
      p.nickname_sanitized,
      p.nickname_hidden,
      p.session_id_hash,
      p.device_hash,
      p.source,
      p.status,
      p.joined_at,
      p.confirmed_at,
      p.ap_total,
      p.sponsored_pass_id,
    );
  }
  getParticipant(id: string): ParticipantRow | undefined {
    return this.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', id);
  }
  getParticipantBySession(hash: string): ParticipantRow | undefined {
    return this.get<ParticipantRow>('SELECT * FROM participants WHERE session_id_hash = ?', hash);
  }
  findLiveParticipantByDevice(matchId: string, deviceHash: string): ParticipantRow | undefined {
    return this.get<ParticipantRow>(
      "SELECT * FROM participants WHERE match_id = ? AND device_hash = ? AND status IN ('RESERVED','PENDING_PAYMENT','ACTIVE')",
      matchId,
      deviceHash,
    );
  }
  listParticipants(matchId: string): ParticipantRow[] {
    return this.all<ParticipantRow>('SELECT * FROM participants WHERE match_id = ? ORDER BY joined_at', matchId);
  }
  setParticipantStatus(
    id: string,
    status: ParticipantStatus,
    extra: { confirmedAt?: number; apTotal?: number; passId?: string } = {},
  ): void {
    this.run(
      `UPDATE participants SET status = ?, confirmed_at = COALESCE(?, confirmed_at),
         ap_total = COALESCE(?, ap_total), sponsored_pass_id = COALESCE(?, sponsored_pass_id) WHERE id = ?`,
      status,
      extra.confirmedAt ?? null,
      extra.apTotal ?? null,
      extra.passId ?? null,
      id,
    );
  }
  setNicknameHidden(id: string, hidden: boolean): void {
    this.run('UPDATE participants SET nickname_hidden = ? WHERE id = ?', hidden ? 1 : 0, id);
  }
  hiddenParticipantIds(matchId: string): string[] {
    return this.all<{ id: string }>(
      'SELECT id FROM participants WHERE match_id = ? AND nickname_hidden = 1',
      matchId,
    ).map((r) => r.id);
  }
  /** Count of seats per team that are taken or held (active + unexpired reservations). */
  seatCounts(matchId: string, now: number): Record<TeamId, number> {
    const rows = this.all<{ team_id: TeamId; n: number }>(
      `SELECT p.team_id AS team_id, COUNT(*) AS n FROM participants p
       LEFT JOIN join_reservations r ON r.participant_id = p.id
       WHERE p.match_id = ? AND (p.status = 'ACTIVE' OR (p.status IN ('RESERVED','PENDING_PAYMENT') AND r.status = 'ACTIVE' AND r.expires_at > ?))
       GROUP BY p.team_id`,
      matchId,
      now,
    );
    const out: Record<TeamId, number> = { RAIJIN: 0, FUJIN: 0 };
    for (const r of rows) out[r.team_id] = r.n;
    return out;
  }

  insertReservation(r: ReservationRow): void {
    this.run(
      'INSERT INTO join_reservations (id, match_id, team_id, participant_id, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      r.id,
      r.match_id,
      r.team_id,
      r.participant_id,
      r.expires_at,
      r.status,
      r.created_at,
    );
  }
  getReservation(id: string): ReservationRow | undefined {
    return this.get<ReservationRow>('SELECT * FROM join_reservations WHERE id = ?', id);
  }
  getReservationByParticipant(participantId: string): ReservationRow | undefined {
    return this.get<ReservationRow>('SELECT * FROM join_reservations WHERE participant_id = ?', participantId);
  }
  setReservationStatus(id: string, status: ReservationRow['status'], expiresAt?: number): void {
    this.run(
      'UPDATE join_reservations SET status = ?, expires_at = COALESCE(?, expires_at) WHERE id = ?',
      status,
      expiresAt ?? null,
      id,
    );
  }
  /** Expire reservations whose TTL passed and that were never paid. Returns participant ids. */
  expireReservations(now: number): string[] {
    const rows = this.all<{ id: string; participant_id: string }>(
      "SELECT id, participant_id FROM join_reservations WHERE status = 'ACTIVE' AND expires_at <= ?",
      now,
    );
    for (const r of rows) {
      this.run("UPDATE join_reservations SET status = 'EXPIRED' WHERE id = ?", r.id);
      this.run(
        "UPDATE participants SET status = 'EXPIRED' WHERE id = ? AND status IN ('RESERVED','PENDING_PAYMENT')",
        r.participant_id,
      );
    }
    return rows.map((r) => r.participant_id);
  }

  // ---- invoices -----------------------------------------------------------
  insertInvoice(i: InvoiceRow): void {
    this.run(
      `INSERT INTO invoices (id, participant_id, reservation_id, match_id, provider, lnbits_checking_id, payment_hash,
         amount_sats, bolt11, memo, expires_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      i.id,
      i.participant_id,
      i.reservation_id,
      i.match_id,
      i.provider,
      i.lnbits_checking_id,
      i.payment_hash,
      i.amount_sats,
      i.bolt11,
      i.memo,
      i.expires_at,
      i.status,
      i.created_at,
    );
  }
  getInvoice(id: string): InvoiceRow | undefined {
    return this.get<InvoiceRow>('SELECT * FROM invoices WHERE id = ?', id);
  }
  getInvoiceByPaymentHash(hash: string): InvoiceRow | undefined {
    return this.get<InvoiceRow>('SELECT * FROM invoices WHERE payment_hash = ?', hash);
  }
  latestInvoiceForReservation(reservationId: string): InvoiceRow | undefined {
    return this.get<InvoiceRow>(
      'SELECT * FROM invoices WHERE reservation_id = ? ORDER BY created_at DESC LIMIT 1',
      reservationId,
    );
  }
  /** Invoices that still need provider checks (pending, or recently expired to catch late payments). */
  invoicesToCheck(now: number, lateGraceMs: number): InvoiceRow[] {
    return this.all<InvoiceRow>(
      "SELECT * FROM invoices WHERE status = 'PENDING' AND expires_at > ? ORDER BY created_at",
      now - lateGraceMs,
    );
  }
  listInvoices(matchId: string | null, limit: number): InvoiceRow[] {
    return matchId
      ? this.all<InvoiceRow>('SELECT * FROM invoices WHERE match_id = ? ORDER BY created_at DESC LIMIT ?', matchId, limit)
      : this.all<InvoiceRow>('SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?', limit);
  }
  updateInvoice(
    id: string,
    patch: Partial<
      Pick<
        InvoiceRow,
        | 'status'
        | 'verified_at'
        | 'fulfillment_at'
        | 'last_checked_at'
        | 'check_failures'
        | 'late_payment_disposition'
        | 'late_payment_note'
        | 'carryover_pass_code'
        | 'bolt11'
      >
    >,
  ): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    this.run(`UPDATE invoices SET ${sets} WHERE id = ?`, ...keys.map((k) => patch[k] ?? null), id);
  }
  invoiceSummary(matchId: string | null): Record<string, { count: number; sats: number }> {
    const rows = matchId
      ? this.all<{ status: string; n: number; sats: number }>(
          'SELECT status, COUNT(*) AS n, COALESCE(SUM(amount_sats),0) AS sats FROM invoices WHERE match_id = ? GROUP BY status',
          matchId,
        )
      : this.all<{ status: string; n: number; sats: number }>(
          'SELECT status, COUNT(*) AS n, COALESCE(SUM(amount_sats),0) AS sats FROM invoices GROUP BY status',
        );
    return Object.fromEntries(rows.map((r) => [r.status, { count: r.n, sats: r.sats }]));
  }
  /** Remove BOLT11 strings from settled/expired invoices older than the retention window. */
  purgeBolt11(olderThan: number): number {
    const r = this.db
      .prepare("UPDATE invoices SET bolt11 = NULL WHERE bolt11 IS NOT NULL AND created_at < ? AND status != 'PENDING'")
      .run(olderThan);
    return Number(r.changes);
  }

  // ---- actions ------------------------------------------------------------
  insertAction(
    id: string,
    matchId: string,
    participantId: string,
    clientActionId: string,
    result: ActionResult,
    revision: number,
    now: number,
  ): void {
    this.run(
      `INSERT INTO actions (id, client_action_id, participant_id, match_id, type, target_region_id, accepted_at,
         at_game_ms, result, ok, state_revision, ap_before, ap_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      clientActionId,
      participantId,
      matchId,
      result.actionType,
      result.regionId,
      now,
      result.atGameMs,
      result.code,
      result.ok ? 1 : 0,
      revision,
      result.apBefore,
      result.apAfter,
    );
  }
  recentActionResults(participantId: string, limit: number): ActionResult[] {
    return this.all<{
      type: ActionResult['actionType'];
      target_region_id: ActionResult['regionId'];
      result: ActionResult['code'];
      ok: number;
      ap_before: number;
      ap_after: number;
      at_game_ms: number;
    }>(
      'SELECT type, target_region_id, result, ok, ap_before, ap_after, at_game_ms FROM actions WHERE participant_id = ? ORDER BY accepted_at DESC, rowid DESC LIMIT ?',
      participantId,
      limit,
    ).map((r) => ({
      ok: r.ok === 1,
      code: r.result,
      actionType: r.type,
      regionId: r.target_region_id,
      apBefore: r.ap_before,
      apAfter: r.ap_after,
      atGameMs: r.at_game_ms,
    }));
  }
  actionCounts(matchId: string): { ok: number; rejected: number } {
    const row = this.get<{ ok: number; rejected: number }>(
      'SELECT COALESCE(SUM(ok),0) AS ok, COALESCE(SUM(1 - ok),0) AS rejected FROM actions WHERE match_id = ?',
      matchId,
    );
    return row ?? { ok: 0, rejected: 0 };
  }

  // ---- passes -------------------------------------------------------------
  insertPass(p: PassRow): void {
    this.run(
      `INSERT INTO sponsored_passes (id_hash, label, match_id, issued_by, issued_at, expires_at, status, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id_hash,
      p.label,
      p.match_id,
      p.issued_by,
      p.issued_at,
      p.expires_at,
      p.status,
      p.kind,
    );
  }
  getPass(hash: string): PassRow | undefined {
    return this.get<PassRow>('SELECT * FROM sponsored_passes WHERE id_hash = ?', hash);
  }
  redeemPass(hash: string, participantId: string, now: number): boolean {
    const r = this.db
      .prepare(
        "UPDATE sponsored_passes SET status = 'REDEEMED', redeemed_at = ?, redeemed_by_participant_id = ? WHERE id_hash = ? AND status = 'ISSUED' AND expires_at > ?",
      )
      .run(now, participantId, hash, now);
    return Number(r.changes) === 1;
  }
  revokePass(hash: string): boolean {
    const r = this.db
      .prepare("UPDATE sponsored_passes SET status = 'REVOKED' WHERE id_hash = ? AND status = 'ISSUED'")
      .run(hash);
    return Number(r.changes) === 1;
  }
  listPasses(limit: number): PassRow[] {
    return this.all<PassRow>('SELECT * FROM sponsored_passes ORDER BY issued_at DESC LIMIT ?', limit);
  }
  passSummary(): Record<string, number> {
    const rows = this.all<{ status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM sponsored_passes GROUP BY status',
    );
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  // ---- audit --------------------------------------------------------------
  audit(actor: string, action: string, targetId: string | null, beforeAfter: unknown, now: number): void {
    this.run(
      'INSERT INTO admin_audit_log (actor, action, target_id, before_after_json, timestamp) VALUES (?, ?, ?, ?, ?)',
      actor,
      action,
      targetId,
      beforeAfter === undefined ? null : JSON.stringify(beforeAfter),
      now,
    );
  }
  listAudit(limit: number): AuditRow[] {
    return this.all<AuditRow>('SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT ?', limit);
  }
}
