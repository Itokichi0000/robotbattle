import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Schema migrations. Append only; never edit an applied migration.
 * Times: *_at columns are UTC epoch ms; *_game_ms / t columns are raid clock ms.
 * Amounts are integer sats.
 */
const MIGRATIONS: string[] = [
  `
  -- One row per raid. Engine state is rebuilt from raid_commands (event sourcing).
  CREATE TABLE raids (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    config_version TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    config_json TEXT NOT NULL,
    seed INTEGER NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    clock_ms INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER,
    ended_at INTEGER,
    outcome TEXT,
    score_total INTEGER,
    assisted INTEGER,
    bots INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    final_snapshot_json TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX raids_rank ON raids(config_hash, assisted, score_total);

  CREATE TABLE raid_commands (
    raid_id TEXT NOT NULL REFERENCES raids(id),
    idx INTEGER NOT NULL,
    t INTEGER NOT NULL,
    command_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (raid_id, idx)
  );

  CREATE TABLE raid_events (
    raid_id TEXT NOT NULL REFERENCES raids(id),
    seq INTEGER NOT NULL,
    t INTEGER NOT NULL,
    game_ms INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    state_revision INTEGER NOT NULL,
    PRIMARY KEY (raid_id, seq)
  );

  -- Pilots live across raids and events. pilot ids are random (no sequence leaks).
  CREATE TABLE pilots (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    callsign TEXT NOT NULL,
    callsign_hidden INTEGER NOT NULL DEFAULT 0,
    avatar TEXT NOT NULL DEFAULT 'standard',
    locale TEXT NOT NULL DEFAULT 'ja',
    show_name INTEGER NOT NULL DEFAULT 0,
    reduced_motion INTEGER NOT NULL DEFAULT 0,
    assist_mode INTEGER NOT NULL DEFAULT 0,
    auth_type TEXT NOT NULL,
    device_hash TEXT,
    sorties INTEGER NOT NULL DEFAULT 0,
    victories INTEGER NOT NULL DEFAULT 0,
    rank_points INTEGER NOT NULL DEFAULT 0,
    roles_done TEXT NOT NULL DEFAULT '',
    titles_json TEXT NOT NULL DEFAULT '[]',
    pass_credits INTEGER NOT NULL DEFAULT 0 CHECK (pass_credits >= 0),
    merged_into TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX pilots_device ON pilots(device_hash);
  CREATE INDEX pilots_seen ON pilots(last_seen_at);

  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    kind TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE INDEX sessions_pilot ON sessions(pilot_id);

  -- LNURL-auth linking keys (domain-specific public keys). Fingerprint = sha256(key).
  CREATE TABLE pilot_auth_keys (
    id TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    provider TEXT NOT NULL,
    key_fingerprint TEXT NOT NULL UNIQUE,
    linked_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE INDEX pilot_auth_keys_pilot ON pilot_auth_keys(pilot_id);

  CREATE TABLE auth_challenges (
    id TEXT PRIMARY KEY,
    k1_hash TEXT NOT NULL UNIQUE,
    session_binding_hash TEXT NOT NULL,
    purpose TEXT NOT NULL,
    pilot_id TEXT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    result_pilot_id TEXT,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );

  -- Right to fly in one raid. One per (raid, pilot), whatever the source.
  CREATE TABLE entitlements (
    id TEXT PRIMARY KEY,
    raid_id TEXT NOT NULL REFERENCES raids(id),
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    source TEXT NOT NULL,
    source_id TEXT,
    granted_at INTEGER NOT NULL,
    revoked_at INTEGER,
    UNIQUE (raid_id, pilot_id)
  );

  CREATE TABLE pilot_raids (
    raid_id TEXT NOT NULL REFERENCES raids(id),
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    role TEXT NOT NULL,
    robot TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (raid_id, pilot_id)
  );

  -- Idempotent minigame submissions: a retried request returns the stored result.
  CREATE TABLE submissions (
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    client_submission_id TEXT NOT NULL,
    raid_id TEXT NOT NULL REFERENCES raids(id),
    task_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (pilot_id, client_submission_id)
  );

  CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    raid_id TEXT NOT NULL REFERENCES raids(id),
    provider TEXT NOT NULL,
    checking_id TEXT NOT NULL,
    payment_hash TEXT NOT NULL,
    amount_sats INTEGER NOT NULL,
    bolt11 TEXT,
    memo TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    verified_at INTEGER,
    entitlement_granted_at INTEGER,
    late_policy TEXT,
    last_checked_at INTEGER,
    check_failures INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX invoices_payment_hash ON invoices(payment_hash);
  CREATE INDEX invoices_status ON invoices(status);
  CREATE INDEX invoices_pilot ON invoices(pilot_id, created_at);

  CREATE TABLE sponsored_passes (
    id_hash TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    raid_id TEXT,
    issued_by TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    redeemed_by TEXT,
    redeemed_at INTEGER,
    redeemed_raid_id TEXT,
    status TEXT NOT NULL
  );

  CREATE TABLE passport_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    event_id TEXT NOT NULL,
    raid_id TEXT NOT NULL REFERENCES raids(id),
    role TEXT NOT NULL,
    outcome TEXT NOT NULL,
    score INTEGER NOT NULL,
    contribution_json TEXT NOT NULL,
    titles_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (pilot_id, raid_id)
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
  `
  -- Cosmetics (spec C10/F4 PilotCosmetic): unlock record + what is equipped.
  ALTER TABLE pilots ADD COLUMN equipped_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE pilots ADD COLUMN show_avatar INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE pilot_cosmetics (
    pilot_id TEXT NOT NULL REFERENCES pilots(id),
    cosmetic_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    raid_id TEXT,
    PRIMARY KEY (pilot_id, cosmetic_id)
  );
  `,
  `
  -- Optional Nostr key (display only). One key, one pilot.
  ALTER TABLE pilots ADD COLUMN nostr_pubkey TEXT;
  ALTER TABLE pilots ADD COLUMN nostr_show INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX pilots_nostr_pubkey ON pilots(nostr_pubkey) WHERE nostr_pubkey IS NOT NULL;
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
  // Databases from earlier prototypes (team battle, turn-based co-op) used a different schema.
  const legacy = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('participants', 'zaps', 'rounds', 'matches', 'players')",
    )
    .get();
  if (legacy) {
    throw new Error(
      'This database uses an old prototype schema. Point DATABASE_PATH to a new file (default ./data/sats-wars-raid.db).',
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
 * server runs one raid on one event loop, so a transaction plus synchronous
 * engine calls give us atomic "check pass -> apply -> persist" sequences.
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
