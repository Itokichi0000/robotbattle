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
  -- One row per campaign ("match"). Engine state is rebuilt from match_commands.
  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    config_version TEXT NOT NULL,
    config_json TEXT NOT NULL,
    seed INTEGER NOT NULL,
    status TEXT NOT NULL,
    clock_ms INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER,
    ended_at INTEGER,
    reached_wave INTEGER,
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

  -- Players live across campaigns: credit (prepaid sats) carries over all day.
  -- Everyone defends Japan together, so a player has no team.
  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    session_id_hash TEXT NOT NULL UNIQUE,
    device_hash TEXT,
    nickname TEXT NOT NULL,
    nickname_hidden INTEGER NOT NULL DEFAULT 0,
    credit_sats INTEGER NOT NULL DEFAULT 0 CHECK (credit_sats >= 0),
    actions_total INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX players_device ON players(device_hash);
  CREATE INDEX players_seen ON players(last_seen_at);

  -- Every change to a credit balance, for accounting and support.
  CREATE TABLE credit_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL REFERENCES players(id),
    delta_sats INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX credit_ledger_player ON credit_ledger(player_id, id);

  CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id),
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
    credited_at INTEGER,
    last_checked_at INTEGER,
    check_failures INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX invoices_payment_hash ON invoices(payment_hash);
  CREATE INDEX invoices_status ON invoices(status);
  CREATE INDEX invoices_player ON invoices(player_id, created_at);

  -- Accepted (charged) actions only; the unique key makes client retries idempotent.
  CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id),
    match_id TEXT NOT NULL REFERENCES matches(id),
    client_action_id TEXT NOT NULL,
    action TEXT NOT NULL,
    region_id TEXT,
    damage INTEGER NOT NULL,
    kills INTEGER NOT NULL,
    liberated INTEGER NOT NULL,
    cost_sats INTEGER NOT NULL,
    at_game_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (player_id, client_action_id)
  );
  CREATE INDEX actions_match_player ON actions(match_id, player_id);

  CREATE TABLE sponsored_passes (
    id_hash TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    amount_sats INTEGER NOT NULL,
    issued_by TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    redeemed_at INTEGER,
    redeemed_by_player_id TEXT,
    status TEXT NOT NULL
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
  // Databases from earlier prototypes (land-grab, ZAP BATTLE) used a different schema.
  const legacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('participants', 'zaps', 'rounds')")
    .get();
  if (legacy) {
    throw new Error(
      'This database uses the old prototype schema. Point DATABASE_PATH to a new file (default ./data/sats-wars-v3.db).',
    );
  }
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
 * engine calls give us atomic "check credit -> apply -> persist" sequences.
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
