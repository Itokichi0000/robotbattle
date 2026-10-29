import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Thin synchronous persistence (node:sqlite). Every write path is "validate → reduce →
 * persist" inside one synchronous call: no await between the rule decision and the record.
 */

const MIGRATIONS: string[] = [
  `CREATE TABLE pilots (
     id TEXT PRIMARY KEY,
     public_name TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('DEMO_GUEST','LNURL')),
     created_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL
   )`,
  `CREATE TABLE pilot_sessions (
     token_hash TEXT PRIMARY KEY,
     pilot_id TEXT NOT NULL REFERENCES pilots(id),
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   )`,
  `CREATE TABLE operator_sessions (
     token_hash TEXT PRIMARY KEY,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   )`,
  `CREATE TABLE matches (
     id TEXT PRIMARY KEY,
     match_number INTEGER NOT NULL,
     preset_id TEXT NOT NULL,
     config_hash TEXT NOT NULL,
     seed INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     started_at TEXT,
     ended_at TEXT,
     outcome TEXT,
     reason TEXT,
     crew INTEGER,
     stats_json TEXT
   )`,
  `CREATE TABLE match_seats (
     match_id TEXT NOT NULL REFERENCES matches(id),
     seat_id TEXT NOT NULL,
     pilot_id TEXT NOT NULL,
     display_name TEXT NOT NULL,
     stats_json TEXT NOT NULL,
     PRIMARY KEY (match_id, seat_id, pilot_id)
   )`,
  `CREATE TABLE action_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     match_id TEXT NOT NULL,
     t INTEGER NOT NULL,
     pilot_id TEXT NOT NULL,
     seat_id TEXT NOT NULL,
     client_action_id TEXT NOT NULL,
     action_type TEXT NOT NULL,
     accepted INTEGER NOT NULL,
     reason TEXT,
     state_version INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     UNIQUE (match_id, pilot_id, client_action_id)
   )`,
  `CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     actor TEXT NOT NULL,
     action TEXT NOT NULL,
     detail TEXT NOT NULL
   )`,
  `CREATE INDEX idx_pilot_sessions_pilot ON pilot_sessions(pilot_id)`,
  `CREATE INDEX idx_action_events_match ON action_events(match_id)`,
];

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 2000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as
    { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    tx(db, () => {
      db.exec(MIGRATIONS[version]!);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
    });
    version += 1;
  }
  return db;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Secrets never reach the audit log: callers pass short, already-masked detail strings. */
export function audit(db: Db, actor: string, action: string, detail = ''): void {
  db.prepare('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)').run(
    nowIso(),
    actor,
    action,
    detail.slice(0, 500),
  );
}

export function recentAudit(db: Db, limit = 30) {
  return db
    .prepare('SELECT id, at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(limit) as Array<{ id: number; at: string; actor: string; action: string; detail: string }>;
}
