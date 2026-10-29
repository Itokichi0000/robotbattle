#!/usr/bin/env node
// One-off consistent copy of the live database (works while the server runs).
//   node tools/db-backup.mjs [--db ./data/sats-wars.db] [--out ./data/backups]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const src = flag('--db', process.env.DATABASE_PATH ?? './data/sats-wars.db');
const outDir = flag('--out', process.env.BACKUP_DIR ?? './data/backups');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
const out = resolve(join(outDir, `sats-wars-${stamp}-manual.db`));
const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log(out);
