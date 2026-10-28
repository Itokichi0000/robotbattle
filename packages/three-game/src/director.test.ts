import { describe, expect, it } from 'vitest';
import type { RaidResult } from '@sats-wars/shared';
import { ArenaDirector, type Cue, type DirectorEffect } from './director';
import { buildFujin, buildRaijin, JOINT_NAMES } from './robots/build';
import { applyClip } from './robots/animate';
import { CLIP_NAMES } from './director';
import { BOSS_POSITION, resolveFxTarget } from './layout';

function run(d: ArenaDirector, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) d.update(1 / 60);
}

const gunnerHit = (over: Partial<{ defeated: boolean; enemyId: number }> = {}): Cue => ({
  kind: 'task',
  role: 'GUNNER',
  robot: 'RAIJIN',
  success: 1,
  callsign: 'PILOT-00821',
  assist: false,
  effect: { kind: 'DAMAGE', enemyId: over.enemyId ?? 7, enemyKind: 'BOSS', weakpoint: 'CORE', amount: 40, defeated: over.defeated ?? false, note: null },
});

function result(outcome: RaidResult['outcome']): RaidResult {
  return {
    outcome,
    reason: outcome === 'SUCCEEDED' ? 'BOSS_DEFEATED' : 'TIMEOUT',
    endedAtGameMs: 400_000,
    clearTimeMs: outcome === 'SUCCEEDED' ? 400_000 : null,
    survivingCities: 6,
    cityHpTotal: 500,
    syncAverage: 60,
    syncPeak: 90,
    special: 'ACTIVATED',
    score: { citySurvival: 250, speed: 150, coordination: 120, bossDefeat: 200, total: 720 },
    mvps: {},
    pilots: 5,
    bots: 0,
    assisted: false,
    configHash: 'h',
    stats: { tasks: 1, successes: 1, enemiesDefeated: 1, cityDamageTaken: 0, shieldAbsorbed: 0, energyRouted: 0, repairs: 0, syncSum: 0, syncSamples: 0, syncPeak: 0, assistActions: 0, peakPilots: 5 },
  };
}

describe('ArenaDirector', () => {
  it('a gunner hit swings Raijin and sends lightning to the enemy', () => {
    const d = new ArenaDirector();
    const fx: DirectorEffect[] = [];
    const sounds: string[] = [];
    d.onEffect((e) => fx.push(e));
    d.onSound((s) => sounds.push(s));
    d.play(gunnerHit());
    expect(d.robots.RAIJIN.clip).toBe('AttackHeavy');
    expect(fx.find((e) => e.kind === 'lightning')).toMatchObject({ from: { kind: 'robot', id: 'RAIJIN' }, to: { kind: 'enemy', id: 7 } });
    expect(sounds).toContain('thunder');
    run(d, 2);
    expect(d.robots.RAIJIN.clip).toBe('Idle');
  });

  it('guardian shields, router energy and engineer repairs aim at their targets', () => {
    const d = new ArenaDirector();
    const fx: DirectorEffect[] = [];
    d.onEffect((e) => fx.push(e));
    d.play({ kind: 'task', role: 'GUARDIAN', robot: 'FUJIN', success: 1, callsign: 'a', assist: false, effect: { kind: 'SHIELD', cityId: 'kanto', amount: 40 } });
    d.play({ kind: 'task', role: 'ROUTER', robot: 'RAIJIN', success: 1, callsign: 'b', assist: false, effect: { kind: 'ENERGY', sink: 'RESERVE', amount: 18 } });
    d.play({ kind: 'task', role: 'ENGINEER', robot: 'FUJIN', success: 1, callsign: 'c', assist: false, effect: { kind: 'REPAIR', repair: { type: 'CITY', cityId: 'kinki' }, amount: 15 } });
    expect(fx.find((e) => e.kind === 'shield')!.to).toEqual({ kind: 'city', id: 'kanto' });
    expect(fx.find((e) => e.kind === 'energy')!.to).toEqual({ kind: 'reserve' });
    expect(fx.find((e) => e.kind === 'repair')!.to).toEqual({ kind: 'city', id: 'kinki' });
    expect(d.robots.FUJIN.clip).toBe('Guard');
    // A failed minigame shows nothing on the big screen.
    const n = fx.length;
    d.play({ kind: 'task', role: 'GUNNER', robot: 'RAIJIN', success: 0, callsign: 'x', assist: false, effect: null });
    expect(fx).toHaveLength(n);
  });

  it('a busy crowd is throttled: every hit flashes, heavy effects and sounds do not strobe', () => {
    const d = new ArenaDirector();
    const fx: DirectorEffect[] = [];
    const sounds: string[] = [];
    d.onEffect((e) => fx.push(e));
    d.onSound((s) => sounds.push(s));
    for (let i = 0; i < 50; i++) {
      d.play(gunnerHit());
      d.update(0.02);
    }
    expect(fx.filter((e) => e.kind === 'impact')).toHaveLength(50);
    expect(fx.filter((e) => e.kind === 'lightning').length).toBeLessThanOrEqual(4);
    expect(sounds.filter((s) => s === 'hit').length).toBeLessThanOrEqual(13);
  });

  it('enemy attacks draw beams to each city; absorbed hits show the shield', () => {
    const d = new ArenaDirector();
    const fx: DirectorEffect[] = [];
    d.onEffect((e) => fx.push(e));
    d.play({
      kind: 'attack',
      enemyId: 3,
      enemyKind: 'BOSS',
      robotHit: 'RAIJIN',
      jam: false,
      hits: [
        { cityId: 'kanto', damage: 20, absorbed: 0, hpAfter: 80, destroyed: false },
        { cityId: 'kyushu', damage: 0, absorbed: 14, hpAfter: 100, destroyed: false },
      ],
    });
    expect(fx.filter((e) => e.kind === 'beam').map((e) => e.to)).toEqual([
      { kind: 'city', id: 'kanto' },
      { kind: 'city', id: 'kyushu' },
    ]);
    expect(fx.some((e) => e.kind === 'shield' && e.to?.kind === 'city' && e.to.id === 'kyushu')).toBe(true);
    expect(d.robots.RAIJIN.clip).toBe('HitReact');
  });

  it('NULL CORE enters with its own camera; the special has success, partial and failure cuts', () => {
    const d = new ArenaDirector();
    const banners: string[] = [];
    d.onBanner((b) => b && banners.push(b.textJa));
    d.play({ kind: 'enemySpawned', enemyId: 9, enemyKind: 'BOSS' });
    run(d, 0.1);
    expect(d.camera.preset).toBe('boss');
    expect(banners[0]).toContain('NULL CORE');
    run(d, 3.5);
    expect(d.camera.preset).toBe('overview');
    d.play({ kind: 'specialOpen' });
    run(d, 0.1);
    expect(banners).toContain('神雷風陣 起動準備');
    d.play({ kind: 'specialResolved', outcome: 'ACTIVATED', damage: 250, bossId: 9, cityHits: [] });
    // Queued right after the "stand by" banner's short hold.
    run(d, 0.7);
    expect(d.camera.preset).toBe('special');
    expect(d.robots.RAIJIN.clip).toBe('Special');
    expect(banners).toContain('神雷風陣、発動！');
    const f = new ArenaDirector();
    const fb: string[] = [];
    f.onBanner((b) => b && fb.push(b.textJa));
    f.play({ kind: 'specialResolved', outcome: 'FAILED', damage: 0, bossId: 9, cityHits: [{ cityId: 'kanto', damage: 25, absorbed: 0, hpAfter: 75, destroyed: false }] });
    run(f, 0.1);
    expect(fb[0]).toBe('神雷風陣 発動失敗…');
    const r = new ArenaDirector();
    r.settings = { reducedMotion: true, shakeScale: 1, shortSpecials: false };
    r.play({ kind: 'specialResolved', outcome: 'ACTIVATED', damage: 250, bossId: 9, cityHits: [] });
    run(r, 0.1);
    expect(r.camera.preset).toBe('overview');
    expect(r.shake).toBe(0);
  });

  it('city loss/rebuild banners and the end of the raid', () => {
    const d = new ArenaDirector();
    d.play({ kind: 'cityDestroyed', cityId: 'kanto' });
    expect(d.banner?.textJa).toBe('東京 機能停止！');
    d.play({ kind: 'cityRebuilt', cityId: 'kanto', callsign: 'PILOT-1' });
    expect(d.banner?.textJa).toBe('東京 復旧！');
    d.play({ kind: 'raidEnded', result: result('SUCCEEDED') });
    run(d, 0.5);
    expect(d.banner).toMatchObject({ kind: 'victory', textJa: '地球防衛成功！' });
    expect(d.robots.RAIJIN.clip).toBe('Victory');
    const f = new ArenaDirector();
    f.play({ kind: 'raidEnded', result: result('FAILED') });
    run(f, 0.5);
    expect(f.banner?.textJa).toBe('防衛失敗…');
    expect(f.robots.FUJIN.clip).toBe('Defeat');
  });

  it('effect targets resolve to world positions (boss, escorts over their target city)', () => {
    const ctx = {
      enemies: [
        { id: 1, kind: 'BOSS' as const, hp: 1, hpMax: 1, ai: 'IDLE' as const, aiUntil: 0, weaken: 0, lastTargets: [], partHits: { CORE: 0, ARM: 0, LEG: 0 }, attacks: 0, training: false },
        { id: 2, kind: 'SCOUT' as const, hp: 1, hpMax: 1, ai: 'TELEGRAPH' as const, aiUntil: 0, weaken: 0, lastTargets: [], partHits: { CORE: 0, ARM: 0, LEG: 0 }, attacks: 0, training: false },
      ],
      telegraphs: [{ id: 5, enemyId: 2, kind: 'BEAM' as const, targets: ['kanto' as const], direction: 'UP' as const, startsAt: 0, resolvesAt: 9000, damage: 10, delayed: false }],
    };
    expect(resolveFxTarget({ kind: 'enemy', id: 1 }, ctx)!.equals(BOSS_POSITION)).toBe(true);
    const escort = resolveFxTarget({ kind: 'enemy', id: 2 }, ctx)!;
    const city = resolveFxTarget({ kind: 'city', id: 'kanto' }, ctx)!;
    expect(escort.distanceTo(city)).toBeLessThan(4);
  });
});

describe('procedural robots', () => {
  it('both rigs expose the shared skeleton and survive every clip', () => {
    for (const rig of [buildRaijin(), buildFujin()]) {
      for (const j of JOINT_NAMES) expect(rig.joints[j]).toBeDefined();
      for (const clip of CLIP_NAMES) {
        for (const t of [0, 0.3, 1, 5]) applyClip(rig, clip, t, t);
        for (const j of JOINT_NAMES) {
          const r = rig.joints[j].rotation;
          expect(Number.isFinite(r.x + r.y + r.z)).toBe(true);
        }
      }
      rig.dispose();
    }
  });
});
