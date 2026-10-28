import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Schema migrations. Append only; never edit an applied migration.
 * Times: *_at columns are UTC epoch ms; *_game_ms / t columns are match clock ms.
 * Amounts are integer sats.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    config_version TEXT NOT NULL,
    config_json TEXT NOT NULL,
    seed INTEGER NOT NULL,
    status TEXT NOT NULL,
    clock_ms INTEGER NOT NULL DEFAULT 0,
    lobby_opened_at INTEGER,
    started_at INTEGER,
    action_closed_at INTEGER,
    ended_at INTEGER,
    paused_duration_ms INTEGER NOT NULL DEFAULT 0,
    winner_team_id TEXT,
    result_json TEXT,
    final_snapshot_json TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE match_commands (
    match_id TEXT NOT NULL REFERENCES matches(id),
    idx INTEGER NOT NULL,
    t INTEGER NOT NULL,
    command_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (match_id, idx)
  );

  CREATE TABLE game_events (
    match_id TEXT NOT NULL REFERENCES matches(id),
    seq INTEGER NOT NULL,
    t INTEGER NOT NULL,
    game_ms INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    state_revision INTEGER NOT NULL,
    PRIMARY KEY (match_id, seq)
  );

  CREATE TABLE teams (
    match_id TEXT NOT NULL REFERENCES matches(id),
    team_id TEXT NOT NULL,
    robot_id TEXT NOT NULL,
    health INTEGER NOT NULL,
    energy INTEGER NOT NULL,
    participant_count INTEGER NOT NULL,
    region_count INTEGER NOT NULL,
    action_count INTEGER NOT NULL,
    PRIMARY KEY (match_id, team_id)
  );

  CREATE TABLE region_states (
    match_id TEXT NOT NULL REFERENCES matches(id),
    region_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    owner_team_id TEXT,
    contested_by_team_id TEXT,
    contested_until INTEGER,
    shield_charges INTEGER NOT NULL,
    shield_expires_at INTEGER,
    revision INTEGER NOT NULL,
    PRIMARY KEY (match_id, region_id)
  );

  CREATE TABLE clashes (
    match_id TEXT NOT NULL REFERENCES matches(id),
    clash_index INTEGER NOT NULL,
    resolved_at_game_ms INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    raijin_damage INTEGER NOT NULL,
    fujin_damage INTEGER NOT NULL,
    resulting_hp_json TEXT NOT NULL,
    special_flags_json TEXT NOT NULL,
    PRIMARY KEY (match_id, clash_index)
  );

  CREATE TABLE participants (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id),
    team_id TEXT NOT NULL,
    nickname_sanitized TEXT NOT NULL,
    nickname_hidden INTEGER NOT NULL DEFAULT 0,
    session_id_hash TEXT NOT NULL UNIQUE,
    device_hash TEXT,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    ap_total INTEGER NOT NULL DEFAULT 0,
    sponsored_pass_id TEXT
  );
  CREATE INDEX participants_match ON participants(match_id, status);
  CREATE INDEX participants_device ON participants(match_id, device_hash);

  CREATE TABLE join_reservations (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id),
    team_id TEXT NOT NULL,
    participant_id TEXT NOT NULL REFERENCES participants(id),
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX reservations_match ON join_reservations(match_id, status);

  CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL REFERENCES participants(id),
    reservation_id TEXT NOT NULL REFERENCES join_reservations(id),
    match_id TEXT NOT NULL REFERENCES matches(id),
    provider TEXT NOT NULL,
    lnbits_checking_id TEXT NOT NULL,
    payment_hash TEXT NOT NULL,
    amount_sats INTEGER NOT NULL,
    bolt11 TEXT,
    memo TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    verified_at INTEGER,
    fulfillment_at INTEGER,
    last_checked_at INTEGER,
    check_failures INTEGER NOT NULL DEFAULT 0,
    late_payment_disposition TEXT,
    late_payment_note TEXT,
    carryover_pass_code TEXT
  );
  CREATE UNIQUE INDEX invoices_payment_hash ON invoices(payment_hash);
  CREATE INDEX invoices_status ON invoices(status);

  CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    client_action_id TEXT NOT NULL,
    participant_id TEXT NOT NULL REFERENCES participants(id),
    match_id TEXT NOT NULL REFERENCES matches(id),
    type TEXT NOT NULL,
    target_region_id TEXT,
    accepted_at INTEGER NOT NULL,
    at_game_ms INTEGER NOT NULL,
    result TEXT NOT NULL,
    ok INTEGER NOT NULL,
    state_revision INTEGER NOT NULL,
    ap_before INTEGER NOT NULL,
    ap_after INTEGER NOT NULL
  );
  CREATE INDEX actions_participant ON actions(participant_id, accepted_at);

  CREATE TABLE sponsored_passes (
    id_hash TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    match_id TEXT,
    issued_by TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    redeemed_at INTEGER,
    redeemed_by_participant_id TEXT,
    status TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'SPONSORED'
  );

  CREATE TABLE admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    before_after_json TEXT,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  `,
];

export type Db = DatabaseSync;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
    v: number | null;
  };
  const current = row.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[i]!);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        i + 1,
        Date.now(),
      );
    });
  }
}

/**
 * Run fn inside a write transaction. node:sqlite is synchronous, and the game
 * server runs one match on one event loop, so a transaction plus synchronous
 * engine calls give us atomic "check AP -> apply -> persist" sequences.
 */
const txDepth = new WeakMap<Db, number>();

export function transaction<T>(db: Db, fn: () => T): T {
  const depth = txDepth.get(db) ?? 0;
  // Nested calls join the outer transaction.
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth.set(db, 0);
  }
}
