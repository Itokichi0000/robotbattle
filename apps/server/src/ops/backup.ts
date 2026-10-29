import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Db } from '../db/database';

/**
 * Database backups (spec Phase 6/7: 会期終了後バックアップ, バックアップ自動化).
 * SQLite's `VACUUM INTO` writes a consistent copy of the live database (WAL
 * included) without stopping the server. Copies go to BACKUP_DIR with a UTC
 * timestamp; only the newest `keep` are kept. Restore with tools/db-restore.mjs
 * while the server is stopped.
 */
export interface BackupInfo {
  file: string;
  bytes: number;
  createdAt: number;
}

export class BackupService {
  constructor(
    private db: Db,
    private opts: { dir: string; keep: number; now: () => number; enabled: boolean },
  ) {}

  get enabled(): boolean {
    return this.opts.enabled;
  }

  /** Make a copy now. Returns its info, or null when backups are off (e.g. an in-memory DB). */
  run(reason: string): BackupInfo | null {
    if (!this.opts.enabled) return null;
    mkdirSync(this.opts.dir, { recursive: true });
    const stamp = new Date(this.opts.now()).toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
    const safeReason = reason.replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'manual';
    let file = join(this.opts.dir, `sats-wars-${stamp}-${safeReason}.db`);
    for (let i = 2; existsSync(file); i++)
      file = join(this.opts.dir, `sats-wars-${stamp}-${safeReason}-${i}.db`);
    // The path is ours (timestamp + sanitised reason): no user input reaches SQL.
    this.db.exec(`VACUUM INTO '${resolve(file).replace(/'/g, "''")}'`);
    this.rotate();
    const st = statSync(file);
    return { file, bytes: st.size, createdAt: st.mtimeMs };
  }

  list(): BackupInfo[] {
    if (!this.opts.enabled || !existsSync(this.opts.dir)) return [];
    return readdirSync(this.opts.dir)
      .filter((f) => /^sats-wars-.*\.db$/.test(f))
      .map((f) => {
        const st = statSync(join(this.opts.dir, f));
        return { file: join(this.opts.dir, f), bytes: st.size, createdAt: st.mtimeMs };
      })
      .sort((a, z) => z.createdAt - a.createdAt || z.file.localeCompare(a.file));
  }

  private rotate(): void {
    for (const old of this.list().slice(this.opts.keep)) rmSync(old.file, { force: true });
  }
}
