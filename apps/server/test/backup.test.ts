import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type TestServer,
  admin,
  auth,
  board,
  guest,
  makeServer,
  startRaid,
  tempDbPath,
} from './helpers';

let s: TestServer | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

const root = resolve(__dirname, '../../..');

describe('database backups and restore', () => {
  it('copies the database after each raid and on demand, keeps the newest N, and restores', async () => {
    const dbPath = tempDbPath();
    s = await makeServer({ dbPath, env: { DEMO_MODE: 'true', BACKUP_KEEP: '2' } });
    const dir = join(dirname(dbPath), 'backups');
    const token = await s.adminToken();
    const a = await guest(s, { callsign: 'KEEPME' });
    await board(s, a, 'GUNNER');
    await startRaid(s);
    await s.advance(1000);
    await admin(s, token, { command: 'END', reason: 'test' });
    expect(readdirSync(dir).some((f) => f.includes('raid-'))).toBe(true);

    for (let i = 0; i < 3; i++)
      expect(
        (await s.inject({ method: 'POST', url: '/api/admin/backups', headers: auth(token) }))
          .statusCode,
      ).toBe(200);
    const list = (await s.inject({ url: '/api/admin/backups', headers: auth(token) })).json();
    expect(list.backups).toHaveLength(2);
    expect(readdirSync(dir)).toHaveLength(2);
    const newest = join(dir, list.backups[0].file);
    // The copy is a complete database with the pilot in it.
    const copy = new DatabaseSync(newest, { readOnly: true });
    expect(
      (
        copy.prepare('SELECT callsign FROM pilots WHERE callsign = ?').get('KEEPME') as {
          callsign: string;
        }
      ).callsign,
    ).toBe('KEEPME');
    copy.close();
    await s.close();
    s = null;

    const target = join(dirname(dbPath), 'restored.db');
    const r = spawnSync(
      'node',
      [
        join(root, 'tools/db-restore.mjs'),
        newest,
        '--db',
        target,
        '--server',
        'http://127.0.0.1:9',
      ],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    expect(existsSync(target)).toBe(true);
    s = await makeServer({ dbPath: target, env: { DEMO_MODE: 'true' } });
    const pilots = (
      await s.inject({ url: '/api/admin/pilots', headers: auth(await s.adminToken()) })
    ).json();
    expect(JSON.stringify(pilots)).toContain('KEEPME');
  });
});
