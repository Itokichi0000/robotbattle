import type {
  GameConfig,
  GameEvent,
  InvoiceStatus,
  RaidResult,
  RaidState,
  RobotId,
  Role,
} from '@sats-wars/shared';
import type { EngineCommand } from '@sats-wars/game-engine';
import { type Db, transaction } from './database';

export interface RaidRow {
  id: string;
  event_id: string;
  config_version: string;
  config_hash: string;
  config_json: string;
  seed: number;
  status: string;
  phase: string;
  clock_ms: number;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  outcome: string | null;
  score_total: number | null;
  assisted: number | null;
  bots: number;
  result_json: string | null;
  final_snapshot_json: string | null;
}

export type AuthKind = 'GUEST' | 'LIGHTNING' | 'MOCK';

export interface PilotRow {
  id: string;
  code: string;
  callsign: string;
  callsign_hidden: number;
  avatar: string;
  locale: string;
  show_name: number;
  reduced_motion: number;
  assist_mode: number;
  auth_type: AuthKind;
  device_hash: string | null;
  sorties: number;
  victories: number;
  rank_points: number;
  roles_done: string;
  titles_json: string;
  pass_credits: number;
  merged_into: string | null;
  created_at: number;
  last_seen_at: number;
  deleted_at: number | null;
  equipped_json: string;
  show_avatar: number;
  nostr_pubkey: string | null;
  nostr_show: number;
}

export interface SessionRow {
  id_hash: string;
  pilot_id: string;
  kind: AuthKind;
  issued_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export interface ChallengeRow {
  id: string;
  k1_hash: string;
  session_binding_hash: string;
  purpose: 'LOGIN' | 'LINK';
  pilot_id: string | null;
  status: 'PENDING' | 'VERIFIED' | 'CONSUMED' | 'EXPIRED' | 'FAILED';
  attempts: number;
  result_pilot_id: string | null;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

export type EntitlementSource = 'FREE' | 'SPONSORED' | 'LIGHTNING' | 'DEMO' | 'CREDIT';

export interface EntitlementRow {
  id: string;
  raid_id: string;
  pilot_id: string;
  source: EntitlementSource;
  source_id: string | null;
  granted_at: number;
  revoked_at: number | null;
}

export interface InvoiceRow {
  id: string;
  pilot_id: string;
  raid_id: string;
  provider: string;
  checking_id: string;
  payment_hash: string;
  amount_sats: number;
  bolt11: string | null;
  memo: string;
  expires_at: number;
  status: InvoiceStatus;
  created_at: number;
  verified_at: number | null;
  entitlement_granted_at: number | null;
  late_policy: 'NEXT_RAID_CREDIT' | null;
  last_checked_at: number | null;
  check_failures: number;
}

export interface SponsoredPassRow {
  id_hash: string;
  label: string;
  raid_id: string | null;
  issued_by: string;
  issued_at: number;
  expires_at: number;
  redeemed_by: string | null;
  redeemed_at: number | null;
  redeemed_raid_id: string | null;
  status: 'ISSUED' | 'REDEEMED' | 'REVOKED';
}

export interface PassportRow {
  id: number;
  pilot_id: string;
  event_id: string;
  raid_id: string;
  role: Role;
  outcome: RaidResult['outcome'];
  score: number;
  contribution_json: string;
  titles_json: string;
  created_at: number;
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
  private run(sql: string, ...params: Params): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  ping(): boolean {
    return this.get<{ ok: number }>('SELECT 1 AS ok')?.ok === 1;
  }

  // ---- settings -----------------------------------------------------------
  getSetting<T>(key: string): T | undefined {
    const row = this.get<{ value_json: string }>(
      'SELECT value_json FROM settings WHERE key = ?',
      key,
    );
    return row ? (JSON.parse(row.value_json) as T) : undefined;
  }
  setSetting(key: string, value: unknown): void {
    this.run(
      'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      key,
      JSON.stringify(value),
    );
  }

  // ---- raids ----------------------------------------------------------------
  insertRaid(
    id: string,
    eventId: string,
    config: GameConfig,
    configHash: string,
    seed: number,
    now: number,
  ): void {
    this.run(
      "INSERT INTO raids (id, event_id, config_version, config_hash, config_json, seed, status, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, 'CREATED', 'LOBBY', ?)",
      id,
      eventId,
      config.version,
      configHash,
      JSON.stringify(config),
      seed,
      now,
    );
  }
  getRaid(id: string): RaidRow | undefined {
    return this.get<RaidRow>('SELECT * FROM raids WHERE id = ?', id);
  }
  latestUnfinishedRaid(): RaidRow | undefined {
    return this.get<RaidRow>(
      "SELECT * FROM raids WHERE status NOT IN ('ENDED', 'CANCELLED') ORDER BY created_at DESC LIMIT 1",
    );
  }
  listRaids(limit: number): RaidRow[] {
    return this.all<RaidRow>('SELECT * FROM raids ORDER BY created_at DESC LIMIT ?', limit);
  }
  appendCommand(raidId: string, idx: number, cmd: EngineCommand, now: number): void {
    this.run(
      'INSERT INTO raid_commands (raid_id, idx, t, command_json, created_at) VALUES (?, ?, ?, ?, ?)',
      raidId,
      idx,
      cmd.t,
      JSON.stringify(cmd),
      now,
    );
  }
  loadCommands(raidId: string): EngineCommand[] {
    return this.all<{ command_json: string }>(
      'SELECT command_json FROM raid_commands WHERE raid_id = ? ORDER BY idx',
      raidId,
    ).map((r) => JSON.parse(r.command_json) as EngineCommand);
  }
  saveRaidProjection(s: RaidState, now: number, finalSnapshot?: unknown, bots = 0): void {
    const ended = s.status === 'ENDED' || s.status === 'CANCELLED';
    this.run(
      `UPDATE raids SET status = ?, phase = ?, clock_ms = ?, revision = ?,
         started_at = COALESCE(started_at, CASE WHEN ? THEN ? END),
         ended_at = COALESCE(ended_at, CASE WHEN ? THEN ? END),
         outcome = ?, score_total = ?, assisted = ?, bots = MAX(bots, ?), result_json = ?,
         final_snapshot_json = COALESCE(?, final_snapshot_json)
       WHERE id = ?`,
      s.status,
      s.phase,
      s.clockMs,
      s.revision,
      s.liveStartClock !== null ? 1 : 0,
      now,
      ended ? 1 : 0,
      now,
      s.result?.outcome ?? null,
      s.result?.score.total ?? null,
      s.result ? (s.result.assisted ? 1 : 0) : null,
      bots,
      s.result ? JSON.stringify(s.result) : null,
      finalSnapshot ? JSON.stringify(finalSnapshot) : null,
      s.raidId,
    );
  }
  updateRaidClock(raidId: string, clockMs: number): void {
    this.run('UPDATE raids SET clock_ms = ? WHERE id = ?', clockMs, raidId);
  }
  insertEvents(events: GameEvent[], revision: number): void {
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO raid_events (raid_id, seq, t, game_ms, type, payload_json, state_revision) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const e of events)
      stmt.run(e.raidId, e.seq, e.t, e.gameMs, e.type, JSON.stringify(e), revision);
  }
  recentEvents(raidId: string, limit: number): GameEvent[] {
    return this.all<{ payload_json: string }>(
      'SELECT payload_json FROM raid_events WHERE raid_id = ? ORDER BY seq DESC LIMIT ?',
      raidId,
      limit,
    )
      .map((r) => JSON.parse(r.payload_json) as GameEvent)
      .reverse();
  }
  loadEvents(raidId: string, afterSeq = 0, limit = 10_000): GameEvent[] {
    return this.all<{ payload_json: string }>(
      'SELECT payload_json FROM raid_events WHERE raid_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      raidId,
      afterSeq,
      limit,
    ).map((r) => JSON.parse(r.payload_json) as GameEvent);
  }
  /** Same-rules leaderboard: raids with the same config hash and assist flag. */
  leaderboard(configHash: string, assisted: boolean, limit: number): RaidRow[] {
    return this.all<RaidRow>(
      "SELECT * FROM raids WHERE config_hash = ? AND assisted = ? AND status = 'ENDED' AND score_total IS NOT NULL AND bots = 0 ORDER BY score_total DESC, ended_at LIMIT ?",
      configHash,
      assisted ? 1 : 0,
      limit,
    );
  }
  bestScore(configHash: string): number | null {
    return this.get<{ s: number | null }>(
      "SELECT MAX(score_total) AS s FROM raids WHERE config_hash = ? AND status = 'ENDED' AND bots = 0",
      configHash,
    )!.s;
  }

  // ---- pilots ----------------------------------------------------------------
  insertPilot(
    p: Omit<
      PilotRow,
      | 'sorties'
      | 'victories'
      | 'rank_points'
      | 'roles_done'
      | 'titles_json'
      | 'pass_credits'
      | 'merged_into'
      | 'deleted_at'
      | 'equipped_json'
      | 'show_avatar'
      | 'nostr_pubkey'
      | 'nostr_show'
    >,
  ): void {
    this.run(
      `INSERT INTO pilots (id, code, callsign, callsign_hidden, avatar, locale, show_name, reduced_motion, assist_mode, auth_type, device_hash, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id,
      p.code,
      p.callsign,
      p.callsign_hidden,
      p.avatar,
      p.locale,
      p.show_name,
      p.reduced_motion,
      p.assist_mode,
      p.auth_type,
      p.device_hash,
      p.created_at,
      p.last_seen_at,
    );
  }
  getPilot(id: string): PilotRow | undefined {
    return this.get<PilotRow>('SELECT * FROM pilots WHERE id = ? AND deleted_at IS NULL', id);
  }
  getGuestByDevice(deviceHash: string): PilotRow | undefined {
    return this.get<PilotRow>(
      "SELECT * FROM pilots WHERE device_hash = ? AND auth_type = 'GUEST' AND deleted_at IS NULL AND merged_into IS NULL ORDER BY created_at DESC LIMIT 1",
      deviceHash,
    );
  }
  updatePilot(
    id: string,
    patch: Partial<
      Pick<
        PilotRow,
        | 'callsign'
        | 'avatar'
        | 'locale'
        | 'show_name'
        | 'reduced_motion'
        | 'assist_mode'
        | 'auth_type'
        | 'device_hash'
        | 'callsign_hidden'
        | 'merged_into'
        | 'equipped_json'
        | 'show_avatar'
        | 'nostr_show'
      >
    >,
  ): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (!keys.length) return;
    this.run(
      `UPDATE pilots SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      ...keys.map((k) => patch[k] as string | number | null),
      id,
    );
  }
  touchPilot(id: string, now: number): void {
    this.run('UPDATE pilots SET last_seen_at = ? WHERE id = ?', now, id);
  }
  hiddenPilotIds(): string[] {
    return this.all<{ id: string }>('SELECT id FROM pilots WHERE callsign_hidden = 1').map(
      (r) => r.id,
    );
  }
  listPilots(limit: number): PilotRow[] {
    return this.all<PilotRow>(
      'SELECT * FROM pilots WHERE deleted_at IS NULL ORDER BY last_seen_at DESC LIMIT ?',
      limit,
    );
  }
  pilotsActiveSince(since: number): number {
    return this.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM pilots WHERE last_seen_at >= ? AND deleted_at IS NULL',
      since,
    )!.n;
  }
  recordSortie(
    id: string,
    won: boolean,
    rolesDone: string,
    titles: string[],
    rankPoints: number,
  ): void {
    this.run(
      'UPDATE pilots SET sorties = sorties + 1, victories = victories + ?, roles_done = ?, titles_json = ?, rank_points = ? WHERE id = ?',
      won ? 1 : 0,
      rolesDone,
      JSON.stringify(titles),
      rankPoints,
      id,
    );
  }
  changePassCredits(id: string, delta: number): boolean {
    return (
      this.run(
        'UPDATE pilots SET pass_credits = pass_credits + ? WHERE id = ? AND pass_credits + ? >= 0',
        delta,
        id,
        delta,
      ) === 1
    );
  }
  /** Account deletion: anonymise, keep aggregate raid records consistent. */
  deletePilot(id: string, now: number): void {
    this.run(
      "UPDATE pilots SET callsign = 'deleted', callsign_hidden = 1, device_hash = NULL, deleted_at = ?, titles_json = '[]', equipped_json = '{}', show_avatar = 0, nostr_pubkey = NULL, nostr_show = 0 WHERE id = ?",
      now,
      id,
    );
    this.run('DELETE FROM pilot_cosmetics WHERE pilot_id = ?', id);
    this.run(
      'UPDATE sessions SET revoked_at = ? WHERE pilot_id = ? AND revoked_at IS NULL',
      now,
      id,
    );
    this.run(
      'UPDATE pilot_auth_keys SET revoked_at = ? WHERE pilot_id = ? AND revoked_at IS NULL',
      now,
      id,
    );
  }

  // ---- sessions & auth -------------------------------------------------------
  insertSession(s: SessionRow): void {
    this.run(
      'INSERT INTO sessions (id_hash, pilot_id, kind, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)',
      s.id_hash,
      s.pilot_id,
      s.kind,
      s.issued_at,
      s.expires_at,
    );
  }
  getSession(idHash: string): SessionRow | undefined {
    return this.get<SessionRow>('SELECT * FROM sessions WHERE id_hash = ?', idHash);
  }
  revokeSession(idHash: string, now: number): void {
    this.run(
      'UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL',
      now,
      idHash,
    );
  }
  revokeAllSessions(pilotId: string, now: number): number {
    return this.run(
      'UPDATE sessions SET revoked_at = ? WHERE pilot_id = ? AND revoked_at IS NULL',
      now,
      pilotId,
    );
  }
  insertChallenge(c: ChallengeRow): void {
    this.run(
      'INSERT INTO auth_challenges (id, k1_hash, session_binding_hash, purpose, pilot_id, status, attempts, result_pilot_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?)',
      c.id,
      c.k1_hash,
      c.session_binding_hash,
      c.purpose,
      c.pilot_id,
      c.status,
      c.expires_at,
      c.created_at,
    );
  }
  getChallenge(id: string): ChallengeRow | undefined {
    return this.get<ChallengeRow>('SELECT * FROM auth_challenges WHERE id = ?', id);
  }
  getChallengeByK1Hash(hash: string): ChallengeRow | undefined {
    return this.get<ChallengeRow>('SELECT * FROM auth_challenges WHERE k1_hash = ?', hash);
  }
  /** Atomic PENDING -> VERIFIED flip: exactly one callback can win. */
  verifyChallenge(id: string, pilotId: string, now: number): boolean {
    return (
      this.run(
        "UPDATE auth_challenges SET status = 'VERIFIED', result_pilot_id = ?, used_at = ? WHERE id = ? AND status = 'PENDING' AND expires_at > ?",
        pilotId,
        now,
        id,
        now,
      ) === 1
    );
  }
  setChallengeStatus(id: string, status: ChallengeRow['status']): boolean {
    return this.run('UPDATE auth_challenges SET status = ? WHERE id = ?', status, id) === 1;
  }
  /** VERIFIED -> CONSUMED by the bound browser session (once). */
  consumeChallenge(id: string): boolean {
    return (
      this.run(
        "UPDATE auth_challenges SET status = 'CONSUMED' WHERE id = ? AND status = 'VERIFIED'",
        id,
      ) === 1
    );
  }
  bumpChallengeAttempts(id: string): void {
    this.run('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?', id);
  }
  purgeChallenges(olderThan: number): void {
    this.run('DELETE FROM auth_challenges WHERE created_at < ?', olderThan);
  }
  getAuthKey(
    fingerprint: string,
  ): { id: string; pilot_id: string; revoked_at: number | null } | undefined {
    return this.get(
      'SELECT id, pilot_id, revoked_at FROM pilot_auth_keys WHERE key_fingerprint = ?',
      fingerprint,
    );
  }
  insertAuthKey(
    id: string,
    pilotId: string,
    provider: string,
    fingerprint: string,
    now: number,
  ): void {
    this.run(
      'INSERT INTO pilot_auth_keys (id, pilot_id, provider, key_fingerprint, linked_at) VALUES (?, ?, ?, ?, ?)',
      id,
      pilotId,
      provider,
      fingerprint,
      now,
    );
  }
  activeAuthKeys(pilotId: string): number {
    return this.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM pilot_auth_keys WHERE pilot_id = ? AND revoked_at IS NULL',
      pilotId,
    )!.n;
  }

  // ---- entitlements & crew --------------------------------------------------
  getEntitlement(raidId: string, pilotId: string): EntitlementRow | undefined {
    return this.get<EntitlementRow>(
      'SELECT * FROM entitlements WHERE raid_id = ? AND pilot_id = ? AND revoked_at IS NULL',
      raidId,
      pilotId,
    );
  }
  /** Returns false if the pilot already holds a pass for this raid (UNIQUE). */
  insertEntitlement(e: Omit<EntitlementRow, 'revoked_at'>): boolean {
    return (
      this.run(
        'INSERT OR IGNORE INTO entitlements (id, raid_id, pilot_id, source, source_id, granted_at) VALUES (?, ?, ?, ?, ?, ?)',
        e.id,
        e.raid_id,
        e.pilot_id,
        e.source,
        e.source_id,
        e.granted_at,
      ) === 1
    );
  }
  entitlementSummary(raidId: string): Record<string, number> {
    const rows = this.all<{ source: string; n: number }>(
      'SELECT source, COUNT(*) AS n FROM entitlements WHERE raid_id = ? GROUP BY source',
      raidId,
    );
    return Object.fromEntries(rows.map((r) => [r.source, r.n]));
  }
  insertPilotRaid(raidId: string, pilotId: string, role: Role, robot: RobotId, now: number): void {
    this.run(
      'INSERT OR IGNORE INTO pilot_raids (raid_id, pilot_id, role, robot, joined_at) VALUES (?, ?, ?, ?, ?)',
      raidId,
      pilotId,
      role,
      robot,
      now,
    );
  }

  // ---- submissions ----------------------------------------------------------
  getSubmission(
    pilotId: string,
    clientSubmissionId: string,
  ): { result_json: string; raid_id: string } | undefined {
    return this.get(
      'SELECT result_json, raid_id FROM submissions WHERE pilot_id = ? AND client_submission_id = ?',
      pilotId,
      clientSubmissionId,
    );
  }
  insertSubmission(
    pilotId: string,
    clientSubmissionId: string,
    raidId: string,
    taskId: string,
    resultJson: string,
    now: number,
  ): void {
    this.run(
      'INSERT INTO submissions (pilot_id, client_submission_id, raid_id, task_id, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      pilotId,
      clientSubmissionId,
      raidId,
      taskId,
      resultJson,
      now,
    );
  }

  // ---- invoices ---------------------------------------------------------------
  insertInvoice(i: InvoiceRow): void {
    this.run(
      `INSERT INTO invoices (id, pilot_id, raid_id, provider, checking_id, payment_hash, amount_sats, bolt11, memo, expires_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      i.id,
      i.pilot_id,
      i.raid_id,
      i.provider,
      i.checking_id,
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
  pendingInvoiceFor(pilotId: string, raidId: string, now: number): InvoiceRow | undefined {
    return this.get<InvoiceRow>(
      "SELECT * FROM invoices WHERE pilot_id = ? AND raid_id = ? AND status = 'PENDING' AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
      pilotId,
      raidId,
      now,
    );
  }
  invoicesToCheck(): InvoiceRow[] {
    return this.all<InvoiceRow>(
      "SELECT * FROM invoices WHERE status = 'PENDING' ORDER BY created_at",
    );
  }
  listInvoices(limit: number): InvoiceRow[] {
    return this.all<InvoiceRow>('SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?', limit);
  }
  updateInvoice(
    id: string,
    patch: Partial<
      Pick<
        InvoiceRow,
        'status' | 'last_checked_at' | 'check_failures' | 'entitlement_granted_at' | 'late_policy'
      >
    >,
  ): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (!keys.length) return;
    this.run(
      `UPDATE invoices SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      ...keys.map((k) => patch[k] as string | number | null),
      id,
    );
  }
  /** Atomic flip to PAID; returns true only for the call that actually flipped it. */
  markInvoicePaid(id: string, now: number): boolean {
    return (
      this.run(
        "UPDATE invoices SET status = 'PAID', verified_at = ? WHERE id = ? AND status IN ('PENDING', 'EXPIRED')",
        now,
        id,
      ) === 1
    );
  }
  invoiceSummary(): Record<string, { count: number; sats: number }> {
    const rows = this.all<{ status: string; n: number; sats: number }>(
      'SELECT status, COUNT(*) AS n, COALESCE(SUM(amount_sats), 0) AS sats FROM invoices GROUP BY status',
    );
    return Object.fromEntries(rows.map((r) => [r.status, { count: r.n, sats: r.sats }]));
  }
  purgeBolt11(olderThan: number): number {
    return this.run(
      "UPDATE invoices SET bolt11 = NULL WHERE bolt11 IS NOT NULL AND status != 'PENDING' AND created_at < ?",
      olderThan,
    );
  }

  // ---- sponsored passes ----------------------------------------------------------
  insertSponsoredPass(
    p: Omit<SponsoredPassRow, 'redeemed_by' | 'redeemed_at' | 'redeemed_raid_id'>,
  ): void {
    this.run(
      'INSERT INTO sponsored_passes (id_hash, label, raid_id, issued_by, issued_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      p.id_hash,
      p.label,
      p.raid_id,
      p.issued_by,
      p.issued_at,
      p.expires_at,
      p.status,
    );
  }
  getSponsoredPass(hash: string): SponsoredPassRow | undefined {
    return this.get<SponsoredPassRow>('SELECT * FROM sponsored_passes WHERE id_hash = ?', hash);
  }
  redeemSponsoredPass(hash: string, pilotId: string, raidId: string, now: number): boolean {
    return (
      this.run(
        "UPDATE sponsored_passes SET status = 'REDEEMED', redeemed_by = ?, redeemed_at = ?, redeemed_raid_id = ? WHERE id_hash = ? AND status = 'ISSUED' AND expires_at > ?",
        pilotId,
        now,
        raidId,
        hash,
        now,
      ) === 1
    );
  }
  revokeSponsoredPass(hash: string): boolean {
    return (
      this.run(
        "UPDATE sponsored_passes SET status = 'REVOKED' WHERE id_hash = ? AND status = 'ISSUED'",
        hash,
      ) === 1
    );
  }
  listSponsoredPasses(limit: number): SponsoredPassRow[] {
    return this.all<SponsoredPassRow>(
      'SELECT * FROM sponsored_passes ORDER BY issued_at DESC LIMIT ?',
      limit,
    );
  }
  sponsoredSummary(): Record<string, number> {
    const rows = this.all<{ status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM sponsored_passes GROUP BY status',
    );
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  // ---- passport -------------------------------------------------------------------
  insertPassport(p: Omit<PassportRow, 'id'>): void {
    this.run(
      'INSERT OR IGNORE INTO passport_history (pilot_id, event_id, raid_id, role, outcome, score, contribution_json, titles_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      p.pilot_id,
      p.event_id,
      p.raid_id,
      p.role,
      p.outcome,
      p.score,
      p.contribution_json,
      p.titles_json,
      p.created_at,
    );
  }
  passportHistory(pilotId: string, limit = 50): PassportRow[] {
    return this.all<PassportRow>(
      'SELECT * FROM passport_history WHERE pilot_id = ? ORDER BY created_at DESC LIMIT ?',
      pilotId,
      limit,
    );
  }
  /** Guest merge: career counters and credits move to the target; titles are unioned by the caller. */
  mergePilotInto(
    fromId: string,
    toId: string,
    titlesJson: string,
    rolesDone: string,
    now: number,
  ): void {
    const from = this.getPilot(fromId)!;
    this.run(
      'UPDATE pilots SET sorties = sorties + ?, victories = victories + ?, rank_points = rank_points + ?, pass_credits = pass_credits + ?, titles_json = ?, roles_done = ? WHERE id = ?',
      from.sorties,
      from.victories,
      from.rank_points,
      from.pass_credits,
      titlesJson,
      rolesDone,
      toId,
    );
    this.run(
      'UPDATE pilots SET merged_into = ?, pass_credits = 0, device_hash = NULL, last_seen_at = ? WHERE id = ?',
      toId,
      now,
      fromId,
    );
    this.run(
      'UPDATE sessions SET revoked_at = ? WHERE pilot_id = ? AND revoked_at IS NULL',
      now,
      fromId,
    );
  }
  // ---- optional Nostr key ---------------------------------------------------------
  pilotByNostrKey(pubkey: string): PilotRow | undefined {
    return this.get<PilotRow>(
      'SELECT * FROM pilots WHERE nostr_pubkey = ? AND deleted_at IS NULL',
      pubkey,
    );
  }
  setNostrKey(pilotId: string, pubkey: string | null): void {
    this.run(
      'UPDATE pilots SET nostr_pubkey = ?, nostr_show = CASE WHEN ? IS NULL THEN 0 ELSE nostr_show END WHERE id = ?',
      pubkey,
      pubkey,
      pilotId,
    );
  }

  // ---- cosmetics -------------------------------------------------------------------
  /** Record newly unlocked items (idempotent). Returns the ids that were new. */
  unlockCosmetics(pilotId: string, ids: string[], now: number, raidId: string | null): string[] {
    const fresh: string[] = [];
    for (const id of ids)
      if (
        this.run(
          'INSERT OR IGNORE INTO pilot_cosmetics (pilot_id, cosmetic_id, unlocked_at, raid_id) VALUES (?, ?, ?, ?)',
          pilotId,
          id,
          now,
          raidId,
        ) === 1
      )
        fresh.push(id);
    return fresh;
  }
  pilotCosmetics(pilotId: string): Array<{ cosmetic_id: string; unlocked_at: number }> {
    return this.all(
      'SELECT cosmetic_id, unlocked_at FROM pilot_cosmetics WHERE pilot_id = ? ORDER BY unlocked_at',
      pilotId,
    );
  }
  /** Venue event ids the pilot flew at (passport history). */
  pilotEvents(pilotId: string): string[] {
    return this.all<{ event_id: string }>(
      'SELECT DISTINCT event_id FROM passport_history WHERE pilot_id = ?',
      pilotId,
    ).map((r) => r.event_id);
  }
  /** Guest merge: move history to the target pilot (skips raids both flew). */
  moveHistory(fromPilot: string, toPilot: string): void {
    this.run(
      'UPDATE OR IGNORE passport_history SET pilot_id = ? WHERE pilot_id = ?',
      toPilot,
      fromPilot,
    );
    this.run(
      'UPDATE OR IGNORE pilot_cosmetics SET pilot_id = ? WHERE pilot_id = ?',
      toPilot,
      fromPilot,
    );
  }

  // ---- audit ------------------------------------------------------------------------
  audit(
    actor: string,
    action: string,
    targetId: string | null,
    beforeAfter: unknown,
    now: number,
  ): void {
    this.run(
      'INSERT INTO admin_audit_log (actor, action, target_id, before_after_json, timestamp) VALUES (?, ?, ?, ?, ?)',
      actor,
      action,
      targetId,
      beforeAfter === undefined || beforeAfter === null ? null : JSON.stringify(beforeAfter),
      now,
    );
  }
  listAudit(limit: number): AuditRow[] {
    return this.all<AuditRow>('SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT ?', limit);
  }
}
