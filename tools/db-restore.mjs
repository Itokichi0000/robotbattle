#!/usr/bin/env node
// Restore the SQLite database from a backup (tools/db-backup or the server's
// BACKUP_DIR). The server MUST be stopped: this refuses while /healthz answers.
//   node tools/db-restore.mjs <backup.db> [--db ./data/sats-wars.db] [--server http://localhost:4000]
// The current database is kept next to it as <name>.before-restore-<time>.db.
import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const backup = args.find(
  (a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'),
);
const target = flag('--db', process.env.DATABASE_PATH ?? './data/sats-wars.db');
const server = flag('--server', 'http://localhost:4000');
if (!backup || !existsSync(backup)) {
  console.error('usage: node tools/db-restore.mjs <backup.db> [--db path] [--server url]');
  process.exit(1);
}

try {
  const res = await fetch(`${server}/healthz`, { signal: AbortSignal.timeout(1500) });
  if (res.ok) {
    console.error(
      `The game server at ${server} is running. Stop it first (restoring under it corrupts data).`,
    );
    process.exit(2);
  }
} catch {
  // not reachable: good
}

// Sanity check: the backup opens and has our tables.
const check = new DatabaseSync(backup, { readOnly: true });
const tables = check
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()
  .map((r) => r.name);
check.close();
for (const t of ['raids', 'pilots', 'raid_commands', 'schema_migrations'])
  if (!tables.includes(t)) {
    console.error(`${backup} is not a SATS WARS database (missing ${t}).`);
    process.exit(3);
  }

if (existsSync(target)) {
  const keep = `${target}.before-restore-${new Date().toISOString().replace(/[-:.]/g, '')}.db`;
  renameSync(target, keep);
  console.log(`current database kept as ${keep}`);
}
for (const ext of ['-wal', '-shm']) rmSync(`${target}${ext}`, { force: true });
copyFileSync(backup, target);
console.log(`restored ${backup} → ${target}. Start the server: an unfinished raid resumes paused.`);
