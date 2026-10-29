import { afterEach, describe, expect, it } from 'vitest';
import { mulberry32, solveTask } from '@sats-wars/game-engine';
import type { Task } from '@sats-wars/shared';
import {
  type PilotHandle,
  type TestServer,
  admin,
  auth,
  board,
  guest,
  makeServer,
  requestTask,
  startRaid,
  submitTask,
} from './helpers';

let s: TestServer | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

const DEMO = { DEMO_MODE: 'true' };

async function playOnce(srv: TestServer, p: PilotHandle) {
  const body = (await requestTask(srv, p)).json() as { code: string; task: Task | null };
  if (body.code !== 'OK' || !body.task) return body.code;
  const input = solveTask(body.task.params, 1, mulberry32(1), 700);
  await srv.advance(('stopAtMs' in input ? input.stopAtMs : 1500) + 100);
  await submitTask(srv, p, body.task.taskId, input);
  return 'OK';
}

const me = async (srv: TestServer, p: PilotHandle) =>
  (await srv.inject({ url: '/api/me', headers: auth(p.token) })).json().pilot;

const patchMe = (srv: TestServer, p: PilotHandle, payload: Record<string, unknown>) =>
  srv.inject({ method: 'PATCH', url: '/api/me', headers: auth(p.token), payload });

describe('cosmetics (spec C10): earned by the career, equip only what is unlocked', () => {
  it('defaults first; a sortie and a venue event unlock items; locked items are refused; looks need consent', async () => {
    s = await makeServer({ env: DEMO });
    const token = await s.adminToken();
    // A named venue event for the next raid (the current lobby keeps its event).
    await s.inject({
      method: 'PUT',
      url: '/api/admin/next-raid',
      headers: auth(token),
      payload: { eventId: 'btc-tokyo-2026', venueName: 'Tokyo <Hall>', arenaLocale: 'en' },
    });
    await admin(s, token, { command: 'NEXT_RAID' });
    const snap = (await s.inject({ url: '/api/public/current-raid' })).json().snapshot;
    expect(snap).toMatchObject({
      eventId: 'btc-tokyo-2026',
      venueName: 'Tokyo Hall',
      arenaLocale: 'en',
    });

    const a = await guest(s, { callsign: 'ACE' });
    const fresh = await me(s, a);
    expect(fresh.cosmetics.equipped).toMatchObject({
      HELMET: 'helmet-standard',
      LICENSE_BG: 'bg-standard',
    });
    expect(fresh.cosmetics.unlocked).not.toContain('bg-circuit');
    expect((await patchMe(s, a, { equip: { LICENSE_BG: 'bg-circuit' } })).statusCode).toBe(400);

    await board(s, a, 'GUARDIAN');
    await startRaid(s);
    await s.advance(3000);
    expect(await playOnce(s, a)).toBe('OK');
    await admin(s, token, { command: 'END', reason: 'test' });

    const after = await me(s, a);
    expect(after.cosmetics.unlocked).toEqual(
      expect.arrayContaining(['bg-circuit', 'bg-venue', 'helmet-venue']),
    );
    // Wrong slot is refused too.
    expect((await patchMe(s, a, { equip: { HELMET: 'bg-venue' } })).statusCode).toBe(400);
    const ok = await patchMe(s, a, { equip: { LICENSE_BG: 'bg-venue', HELMET: 'helmet-venue' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pilot.cosmetics.equipped).toMatchObject({
      LICENSE_BG: 'bg-venue',
      HELMET: 'helmet-venue',
    });

    // Cockpit look only with consent.
    await admin(s, token, { command: 'NEXT_RAID' });
    await board(s, a, 'GUNNER');
    const crew = () =>
      s!.inject({ url: '/api/public/current-raid' }).then((r) => r.json().snapshot.crew[0]);
    expect((await crew()).look).toBeUndefined();
    await patchMe(s, a, { showAvatarOnArena: true });
    expect((await crew()).look).toMatchObject({ helmet: '#EFF5FF' });
    const card = await s.inject({ url: '/api/passport-card', headers: auth(a.token) });
    expect(card.statusCode).toBe(200);
    expect(card.headers['content-type']).toContain('image/svg+xml');
    expect(card.body).toContain('ACE');
    expect(card.body).toContain('btc-tokyo-2026');
    const anon = await s.inject({ url: '/api/passport-card?anonymous=1', headers: auth(a.token) });
    expect(anon.body).not.toContain('ACE');
    expect(anon.body).toMatch(/PILOT-\d+/);
    expect((await s.inject({ url: '/api/passport-card' })).statusCode).toBe(401);
    const ach = await s.inject({ url: '/api/me/achievements', headers: auth(a.token) });
    expect(ach.statusCode).toBe(200);
    expect(ach.json().cosmetics.find((c: { id: string }) => c.id === 'bg-venue')).toMatchObject({
      unlocked: true,
    });
  });
});

describe('operators: next raid, venue screen, rehearsal', () => {
  it('a difficulty preset rebuilds the next config (new hash), never the running raid', async () => {
    s = await makeServer({ env: DEMO });
    const token = await s.adminToken();
    const before = s.services.manager.current().state.configHash;
    const res = await s.inject({
      method: 'PUT',
      url: '/api/admin/next-raid',
      headers: auth(token),
      payload: { preset: 'HARD', ticketPriceSats: 42, maxPilots: 50 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().config).toMatchObject({
      difficultyPreset: 'HARD',
      ticketPriceSats: 42,
      maxPilots: 50,
    });
    expect(s.services.manager.current().state.configHash).toBe(before);
    await admin(s, token, { command: 'NEXT_RAID' });
    const st = s.services.manager.current().state;
    expect(st.config.difficultyPreset).toBe('HARD');
    expect(st.configHash).not.toBe(before);
    // Bad event ids are refused.
    const bad = await s.inject({
      method: 'PUT',
      url: '/api/admin/next-raid',
      headers: auth(token),
      payload: { eventId: 'Bad Id!' },
    });
    expect(bad.statusCode).toBe(400);
    const audit = (await s.inject({ url: '/api/admin/audit', headers: auth(token) })).json();
    expect(JSON.stringify(audit)).toContain('SET_NEXT_CONFIG');
  });

  it('venue screen display is pushed in the snapshot; rehearsal is DEMO-only and leaves the leaderboard', async () => {
    s = await makeServer({ env: DEMO });
    const token = await s.adminToken();
    await admin(s, token, {
      command: 'SET_ARENA_DISPLAY',
      renderer: '2d',
      quality: 'low',
      volume: 0.3,
      showQr: true,
    });
    const snap = (await s.inject({ url: '/api/public/current-raid' })).json().snapshot;
    expect(snap.arenaDisplay).toMatchObject({ renderer: '2d', quality: 'low', volume: 0.3 });
    expect(snap.arenaDisplay.rev).toBeGreaterThan(0);

    const a = await guest(s);
    await board(s, a, 'GUNNER');
    await startRaid(s);
    await s.advance(1000);
    const n = s.services.manager.current().state.enemies.length;
    await admin(s, token, { command: 'DEMO_SPAWN', kind: 'SIEGE' });
    expect(s.services.manager.current().state.enemies.length).toBe(n + 1);
    expect(s.services.manager.current().botsAboard).toBeGreaterThan(0);
    await admin(s, token, { command: 'DEMO_ARENA_CUE', cue: 'SPECIAL_ACTIVATED' });

    await s.close();
    s = await makeServer({ env: {} });
    const t2 = await s.adminToken();
    const refused = await s.inject({
      method: 'POST',
      url: '/api/admin/command',
      headers: auth(t2),
      payload: { command: 'DEMO_SPAWN', kind: 'SCOUT' },
    });
    expect(refused.statusCode).toBe(403);
  });
});

describe('spec API contract (F5 aliases by raid id)', () => {
  it('status / reserve / board / tasks / submit by id; other ids are refused; admin raids, lifecycle, metrics', async () => {
    s = await makeServer({ env: DEMO });
    const token = await s.adminToken();
    const id = s.services.manager.current().raidId;
    const st = (await s.inject({ url: `/api/raids/${id}/status` })).json();
    expect(st).toMatchObject({ raidId: id, current: true, joinOpen: true, passMode: 'FREE' });
    const a = await guest(s);
    const reserve = await s.inject({
      method: 'POST',
      url: `/api/raids/${id}/join/reserve`,
      headers: auth(a.token),
    });
    expect(reserve.json()).toMatchObject({ joinOpen: true, entitled: false });
    expect(
      (
        await s.inject({
          method: 'POST',
          url: '/api/raids/raid-old/board',
          headers: auth(a.token),
          payload: { role: 'GUNNER' },
        })
      ).statusCode,
    ).toBe(409);
    const b = await s.inject({
      method: 'POST',
      url: `/api/raids/${id}/board`,
      headers: auth(a.token),
      payload: { role: 'GUARDIAN' },
    });
    expect(b.statusCode).toBe(200);

    const start = await s.inject({
      method: 'POST',
      url: `/api/admin/raids/${id}/start`,
      headers: auth(token),
    });
    expect(start.statusCode).toBe(200);
    await s.advance(2000);
    const req = (
      await s.inject({
        method: 'POST',
        url: `/api/raids/${id}/tasks`,
        headers: auth(a.token),
        payload: {},
      })
    ).json();
    expect(req.code).toBe('OK');
    const open = (await s.inject({ url: `/api/raids/${id}/tasks`, headers: auth(a.token) })).json();
    expect(open.task.taskId).toBe(req.task.taskId);
    const input = solveTask(req.task.params, 1, mulberry32(1), 700);
    await s.advance(('releaseAtMs' in input ? input.releaseAtMs : 1500) + 100);
    const sub = await s.inject({
      method: 'POST',
      url: `/api/raids/${id}/tasks/${req.task.taskId}/submit`,
      headers: auth(a.token),
      payload: { clientSubmissionId: 'alias-sub-0001', input },
    });
    expect(sub.json().result.ok).toBe(true);

    const metrics = (await s.inject({ url: '/api/admin/metrics', headers: auth(token) })).json();
    expect(metrics.crew).toMatchObject({ total: 1 });
    expect(metrics.raid.raidId).toBe(id);
    expect((await s.inject({ url: '/api/admin/metrics' })).statusCode).toBe(401);
    const stop = await s.inject({
      method: 'POST',
      url: '/api/admin/emergency-stop',
      headers: auth(token),
    });
    expect(stop.statusCode).toBe(200);
    expect(s.services.manager.current().state.status).toBe('PAUSED');
    await s.inject({ method: 'POST', url: `/api/admin/raids/${id}/end`, headers: auth(token) });
    const created = await s.inject({
      method: 'POST',
      url: '/api/admin/raids',
      headers: auth(token),
      payload: { preset: 'EASY', eventId: 'test-event' },
    });
    expect(created.statusCode).toBe(200);
    const list = (await s.inject({ url: '/api/admin/raids', headers: auth(token) })).json();
    expect(list.current).toBe(created.json().raidId);
    expect(list.raids.map((r: { raidId: string }) => r.raidId)).toContain(id);
    expect(s.services.manager.current().state.config.difficultyPreset).toBe('EASY');

    const link = await s.inject({
      method: 'POST',
      url: '/api/me/link-wallet/start',
      headers: auth(a.token),
    });
    expect(link.statusCode).toBe(200);
    expect(link.json().challengeId).toBeTruthy();
  });
});

describe('security headers', () => {
  it('API responses forbid loading and framing (CSP default-src none)', async () => {
    s = await makeServer({ env: DEMO });
    const res = await s.inject({ url: '/api/public/current-raid' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
