import type {
  GameConfig,
  GameEvent,
  InvoiceStatus,
  MatchState,
  SeasonResult,
  TeamId,
  ZapResult,
} from '@sats-wars/shared';
import type { EngineCommand } from '@sats-wars/game-engine';
import { type Db, transaction } from './database';

export interface MatchRow {
  id: string;
  config_version: string;
  config_json: string;
  seed: number;
  status: string;
  phase: string;
  clock_ms: number;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  winner_team_id: string | null;
  result_json: string | null;
  final_snapshot_json: string | null;
}

export interface PlayerRow {
  id: string;
  session_id_hash: string;
  device_hash: string | null;
  nickname: string;
  nickname_hidden: number;
  team_id: TeamId;
  credit_sats: number;
  zaps_total: number;
  kos: number;
  created_at: number;
  last_seen_at: number;
}

export interface InvoiceRow {
  id: string;
  player_id: string;
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
  credited_at: number | null;
  last_checked_at: number | null;
  check_failures: number;
}

export interface ZapRow {
  id: string;
  player_id: string;
  match_id: string;
  client_action_id: string;
  round_index: number | null;
  team_id: TeamId;
  code: ZapResult['code'];
  damage: number;
  special: number;
  pinch: number;
  cost_sats: number;
  at_game_ms: number;
  created_at: number;
}

export interface PassRow {
  id_hash: string;
  label: string;
  amount_sats: number;
  issued_by: string;
  issued_at: number;
  expires_at: number;
  redeemed_at: number | null;
  redeemed_by_player_id: string | null;
  status: 'ISSUED' | 'REDEEMED' | 'REVOKED';
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target_id: string | null;
  before_after_json: string | null;
  timestamp: number;
}

export type CreditReason = 'TOPUP' | 'PASS' | 'ZAP' | 'ADJUST';

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
  private run(sql: string, ...params: Params): number {
    return Number(this.db.prepare(sql).run(...params).changes);
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
      "INSERT INTO matches (id, config_version, config_json, seed, status, phase, created_at) VALUES (?, ?, ?, ?, 'CREATED', 'OPENING', ?)",
      id,
      config.version,
      JSON.stringify(config),
      seed,
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

  /** Persist the engine-derived match row for querying/reporting. */
  saveMatchProjection(s: MatchState, now: number, finalSnapshot?: unknown): void {
    this.run(
      `UPDATE matches SET status = ?, phase = ?, clock_ms = ?, revision = ?,
         started_at = COALESCE(started_at, ?), ended_at = COALESCE(ended_at, ?),
         winner_team_id = ?, result_json = ?, final_snapshot_json = COALESCE(?, final_snapshot_json)
       WHERE id = ?`,
      s.status,
      s.phase,
      s.clockMs,
      s.revision,
      s.liveStartClock !== null ? now : null,
      s.status === 'FINISHED' || s.status === 'CANCELLED' ? now : null,
      s.result?.winnerTeamId ?? null,
      s.result ? JSON.stringify(s.result) : null,
      finalSnapshot ? JSON.stringify(finalSnapshot) : null,
      s.matchId,
    );
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
      if (e.type === 'ROUND_ENDED') {
        const r = e.data.summary;
        this.run(
          `INSERT OR IGNORE INTO rounds (match_id, round_index, region_id, hp_max, winner_team_id, end_reason, duration_ms,
             zaps_raijin, zaps_fujin, finisher_player_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          e.matchId,
          r.index,
          r.regionId,
          r.hpMax,
          r.winnerTeamId,
          r.endReason,
          r.durationMs,
          r.zaps.RAIJIN,
          r.zaps.FUJIN,
          r.finisher?.participantId ?? null,
        );
      }
    }
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

  loadEvents(matchId: string, afterSeq = 0, limit = 10_000): GameEvent[] {
    return this.all<{ payload_json: string }>(
      'SELECT payload_json FROM game_events WHERE match_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      matchId,
      afterSeq,
      limit,
    ).map((r) => JSON.parse(r.payload_json) as GameEvent);
  }

  getResult(matchId: string): SeasonResult | null {
    const row = this.getMatch(matchId);
    return row?.result_json ? (JSON.parse(row.result_json) as SeasonResult) : null;
  }

  // ---- players & credit ---------------------------------------------------
  insertPlayer(p: PlayerRow): void {
    this.run(
      `INSERT INTO players (id, session_id_hash, device_hash, nickname, nickname_hidden, team_id, credit_sats,
         zaps_total, kos, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id,
      p.session_id_hash,
      p.device_hash,
      p.nickname,
      p.nickname_hidden,
      p.team_id,
      p.credit_sats,
      p.zaps_total,
      p.kos,
      p.created_at,
      p.last_seen_at,
    );
  }
  getPlayer(id: string): PlayerRow | undefined {
    return this.get<PlayerRow>('SELECT * FROM players WHERE id = ?', id);
  }
  getPlayerBySession(hash: string): PlayerRow | undefined {
    return this.get<PlayerRow>('SELECT * FROM players WHERE session_id_hash = ?', hash);
  }
  getPlayerByDevice(deviceHash: string): PlayerRow | undefined {
    return this.get<PlayerRow>(
      'SELECT * FROM players WHERE device_hash = ? ORDER BY created_at DESC LIMIT 1',
      deviceHash,
    );
  }
  /** Rotate the session token (used when a device re-joins and we re-issue its token). */
  setPlayerSession(id: string, sessionHash: string): void {
    this.run('UPDATE players SET session_id_hash = ? WHERE id = ?', sessionHash, id);
  }
  setPlayerTeam(id: string, teamId: TeamId): void {
    this.run('UPDATE players SET team_id = ? WHERE id = ?', teamId, id);
  }
  setPlayerNickname(id: string, nickname: string): void {
    this.run('UPDATE players SET nickname = ? WHERE id = ?', nickname, id);
  }
  setNicknameHidden(id: string, hidden: boolean): void {
    this.run('UPDATE players SET nickname_hidden = ? WHERE id = ?', hidden ? 1 : 0, id);
  }
  hiddenPlayerIds(): string[] {
    return this.all<{ id: string }>('SELECT id FROM players WHERE nickname_hidden = 1').map((r) => r.id);
  }
  touchPlayer(id: string, now: number): void {
    this.run('UPDATE players SET last_seen_at = ? WHERE id = ?', now, id);
  }
  listPlayers(limit: number): PlayerRow[] {
    return this.all<PlayerRow>('SELECT * FROM players ORDER BY last_seen_at DESC LIMIT ?', limit);
  }
  /** Players per team active since `since` (shown as supporters on the screens). */
  supporters(since: number): Record<TeamId, number> {
    const out: Record<TeamId, number> = { RAIJIN: 0, FUJIN: 0 };
    for (const r of this.all<{ team_id: TeamId; n: number }>(
      'SELECT team_id, COUNT(*) AS n FROM players WHERE last_seen_at >= ? GROUP BY team_id',
      since,
    ))
      out[r.team_id] = r.n;
    return out;
  }

  /**
   * Change a balance and write the ledger entry in one step. Returns the new
   * balance, or null when a debit would make it negative (nothing changes).
   */
  changeCredit(
    playerId: string,
    delta: number,
    reason: CreditReason,
    refId: string | null,
    now: number,
  ): number | null {
    const changed = this.run(
      'UPDATE players SET credit_sats = credit_sats + ? WHERE id = ? AND credit_sats + ? >= 0',
      delta,
      playerId,
      delta,
    );
    if (changed !== 1) return null;
    const balance = this.getPlayer(playerId)!.credit_sats;
    this.run(
      'INSERT INTO credit_ledger (player_id, delta_sats, balance_after, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      playerId,
      delta,
      balance,
      reason,
      refId,
      now,
    );
    return balance;
  }
  creditTotals(): { outstanding: number; toppedUp: number; passes: number; spent: number; adjusted: number } {
    const sum = (reason: CreditReason) =>
      this.get<{ s: number }>('SELECT COALESCE(SUM(delta_sats), 0) AS s FROM credit_ledger WHERE reason = ?', reason)!.s;
    return {
      outstanding: this.get<{ s: number }>('SELECT COALESCE(SUM(credit_sats), 0) AS s FROM players')!.s,
      toppedUp: sum('TOPUP'),
      passes: sum('PASS'),
      spent: -sum('ZAP'),
      adjusted: sum('ADJUST'),
    };
  }

  // ---- zaps ---------------------------------------------------------------
  getZap(playerId: string, clientActionId: string): ZapRow | undefined {
    return this.get<ZapRow>(
      'SELECT * FROM zaps WHERE player_id = ? AND client_action_id = ?',
      playerId,
      clientActionId,
    );
  }
  insertZap(z: ZapRow): void {
    this.run(
      `INSERT INTO zaps (id, player_id, match_id, client_action_id, round_index, team_id, code, damage, special, pinch,
         cost_sats, at_game_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      z.id,
      z.player_id,
      z.match_id,
      z.client_action_id,
      z.round_index,
      z.team_id,
      z.code,
      z.damage,
      z.special,
      z.pinch,
      z.cost_sats,
      z.at_game_ms,
      z.created_at,
    );
    this.run(
      'UPDATE players SET zaps_total = zaps_total + 1, kos = kos + ? WHERE id = ?',
      z.code === 'KO' ? 1 : 0,
      z.player_id,
    );
  }
  recentZaps(playerId: string, limit: number): ZapRow[] {
    return this.all<ZapRow>(
      'SELECT * FROM zaps WHERE player_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      playerId,
      limit,
    );
  }
  zapCountInMatch(matchId: string, playerId: string): number {
    return (
      this.get<{ n: number }>('SELECT COUNT(*) AS n FROM zaps WHERE match_id = ? AND player_id = ?', matchId, playerId)
        ?.n ?? 0
    );
  }
  zapStats(matchId: string): { zaps: number; players: number } {
    return (
      this.get<{ zaps: number; players: number }>(
        'SELECT COUNT(*) AS zaps, COUNT(DISTINCT player_id) AS players FROM zaps WHERE match_id = ?',
        matchId,
      ) ?? { zaps: 0, players: 0 }
    );
  }

  // ---- invoices -----------------------------------------------------------
  insertInvoice(i: InvoiceRow): void {
    this.run(
      `INSERT INTO invoices (id, player_id, provider, lnbits_checking_id, payment_hash, amount_sats, bolt11, memo,
         expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      i.id,
      i.player_id,
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
  pendingInvoiceForPlayer(playerId: string, now: number): InvoiceRow | undefined {
    return this.get<InvoiceRow>(
      "SELECT * FROM invoices WHERE player_id = ? AND status = 'PENDING' AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
      playerId,
      now,
    );
  }
  /**
   * Every PENDING invoice. Ones past expiry + grace are checked one last time
   * (a late settlement still becomes credit) and then closed as EXPIRED.
   */
  invoicesToCheck(): InvoiceRow[] {
    return this.all<InvoiceRow>("SELECT * FROM invoices WHERE status = 'PENDING' ORDER BY created_at");
  }
  listInvoices(limit: number): InvoiceRow[] {
    return this.all<InvoiceRow>('SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?', limit);
  }
  updateInvoice(
    id: string,
    patch: Partial<
      Pick<InvoiceRow, 'status' | 'verified_at' | 'credited_at' | 'last_checked_at' | 'check_failures' | 'bolt11'>
    >,
  ): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    this.run(`UPDATE invoices SET ${sets} WHERE id = ?`, ...keys.map((k) => patch[k] ?? null), id);
  }
  /** Atomically flip PENDING -> PAID. Returns false if it was already handled. */
  markInvoicePaid(id: string, now: number): boolean {
    return (
      this.run(
        "UPDATE invoices SET status = 'PAID', verified_at = ?, credited_at = ? WHERE id = ? AND status = 'PENDING'",
        now,
        now,
        id,
      ) === 1
    );
  }
  invoiceSummary(): Record<string, { count: number; sats: number }> {
    const rows = this.all<{ status: string; n: number; sats: number }>(
      'SELECT status, COUNT(*) AS n, COALESCE(SUM(amount_sats),0) AS sats FROM invoices GROUP BY status',
    );
    return Object.fromEntries(rows.map((r) => [r.status, { count: r.n, sats: r.sats }]));
  }
  /** Remove BOLT11 strings from settled/expired invoices older than the retention window. */
  purgeBolt11(olderThan: number): number {
    return this.run(
      "UPDATE invoices SET bolt11 = NULL WHERE bolt11 IS NOT NULL AND created_at < ? AND status != 'PENDING'",
      olderThan,
    );
  }

  // ---- passes -------------------------------------------------------------
  insertPass(p: PassRow): void {
    this.run(
      `INSERT INTO sponsored_passes (id_hash, label, amount_sats, issued_by, issued_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      p.id_hash,
      p.label,
      p.amount_sats,
      p.issued_by,
      p.issued_at,
      p.expires_at,
      p.status,
    );
  }
  getPass(hash: string): PassRow | undefined {
    return this.get<PassRow>('SELECT * FROM sponsored_passes WHERE id_hash = ?', hash);
  }
  redeemPass(hash: string, playerId: string, now: number): boolean {
    return (
      this.run(
        "UPDATE sponsored_passes SET status = 'REDEEMED', redeemed_at = ?, redeemed_by_player_id = ? WHERE id_hash = ? AND status = 'ISSUED' AND expires_at > ?",
        now,
        playerId,
        hash,
        now,
      ) === 1
    );
  }
  revokePass(hash: string): boolean {
    return this.run("UPDATE sponsored_passes SET status = 'REVOKED' WHERE id_hash = ? AND status = 'ISSUED'", hash) === 1;
  }
  listPasses(limit: number): PassRow[] {
    return this.all<PassRow>('SELECT * FROM sponsored_passes ORDER BY issued_at DESC LIMIT ?', limit);
  }
  passSummary(): Record<string, { count: number; sats: number }> {
    const rows = this.all<{ status: string; n: number; sats: number }>(
      'SELECT status, COUNT(*) AS n, COALESCE(SUM(amount_sats),0) AS sats FROM sponsored_passes GROUP BY status',
    );
    return Object.fromEntries(rows.map((r) => [r.status, { count: r.n, sats: r.sats }]));
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
