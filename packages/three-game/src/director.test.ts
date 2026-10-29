import { describe, expect, it } from 'vitest';
import type { RaidResult } from '@sats-wars/shared';
import {
  ArenaDirector,
  CLIP_DURATION,
  type Cue,
  type DirectorEffect,
  REQUIRED_CLIPS,
  resolveClip,
} from './director';
import {
  buildFujin,
  buildRaijin,
  damageStageFor,
  JOINT_NAMES,
  setDamageStage,
} from './robots/build';
import { applyClip } from './robots/animate';
import { CLIP_NAMES } from './director';
import { BOSS_POSITION, resolveFxTarget } from './layout';
import { SEATS_PER_ROLE, placeCrew, rotatingTags, seatPosition } from './CockpitBay';

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
  effect: {
    kind: 'DAMAGE',
    enemyId: over.enemyId ?? 7,
    enemyKind: 'BOSS',
    weakpoint: 'CORE',
    amount: 40,
    defeated: over.defeated ?? false,
    note: null,
  },
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
    stats: {
      tasks: 1,
      successes: 1,
      enemiesDefeated: 1,
      cityDamageTaken: 0,
      shieldAbsorbed: 0,
      energyRouted: 0,
      repairs: 0,
      syncSum: 0,
      syncSamples: 0,
      syncPeak: 0,
      assistActions: 0,
      peakPilots: 5,
    },
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
    // The bolt leaves on the strike frame of the swing, with a hit-stop.
    expect(fx.find((e) => e.kind === 'lightning')).toBeUndefined();
    let froze = false;
    for (let i = 0; i < 24; i++) {
      d.update(1 / 60);
      froze ||= d.scale < 0.5;
    }
    expect(fx.find((e) => e.kind === 'lightning')).toMatchObject({
      from: { kind: 'robot', id: 'RAIJIN' },
      to: { kind: 'enemy', id: 7 },
    });
    expect(sounds).toContain('thunder');
    expect(sounds).toContain('impact');
    expect(froze).toBe(true);
    run(d, 2);
    expect(d.robots.RAIJIN.clip).toBe('Idle');
  });

  it('guardian shields, router energy and engineer repairs aim at their targets', () => {
    const d = new ArenaDirector();
    const fx: DirectorEffect[] = [];
    d.onEffect((e) => fx.push(e));
    d.play({
      kind: 'task',
      role: 'GUARDIAN',
      robot: 'FUJIN',
      success: 1,
      callsign: 'a',
      assist: false,
      effect: { kind: 'SHIELD', cityId: 'kanto', amount: 40 },
    });
    d.play({
      kind: 'task',
      role: 'ROUTER',
      robot: 'RAIJIN',
      success: 1,
      callsign: 'b',
      assist: false,
      effect: { kind: 'ENERGY', sink: 'RESERVE', amount: 18 },
    });
    d.play({
      kind: 'task',
      role: 'ENGINEER',
      robot: 'FUJIN',
      success: 1,
      callsign: 'c',
      assist: false,
      effect: { kind: 'REPAIR', repair: { type: 'CITY', cityId: 'kinki' }, amount: 15 },
    });
    expect(fx.find((e) => e.kind === 'shield')!.to).toEqual({ kind: 'city', id: 'kanto' });
    expect(fx.find((e) => e.kind === 'energy')!.to).toEqual({ kind: 'reserve' });
    expect(fx.find((e) => e.kind === 'repair')!.to).toEqual({ kind: 'city', id: 'kinki' });
    expect(d.robots.FUJIN.clip).toBe('ShieldDeploy');
    // A failed minigame shows nothing on the big screen.
    const n = fx.length;
    d.play({
      kind: 'task',
      role: 'GUNNER',
      robot: 'RAIJIN',
      success: 0,
      callsign: 'x',
      assist: false,
      effect: null,
    });
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
    run(d, 1);
    expect(fx.filter((e) => e.kind === 'impact')).toHaveLength(50);
    expect(fx.filter((e) => e.kind === 'lightning').length).toBeLessThanOrEqual(4);
    expect(sounds.filter((s) => s === 'hit').length).toBeLessThanOrEqual(13);
  });

  it('enemy attacks draw beams to each city and the struck robot; absorbed hits show the shield', () => {
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
      { kind: 'robot', id: 'RAIJIN' },
    ]);
    expect(fx.some((e) => e.kind === 'impact' && e.to?.kind === 'robot')).toBe(true);
    expect(
      fx.some((e) => e.kind === 'shield' && e.to?.kind === 'city' && e.to.id === 'kyushu'),
    ).toBe(true);
    // NULL CORE's beam is a heavy blow; escorts only jolt.
    expect(d.robots.RAIJIN.clip).toBe('HitHeavy');
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
    // The charge-up (gods glowing, then a look at the pilots inside) plays first.
    run(d, 0.1);
    expect(d.camera.preset).toBe('specialCharge');
    run(d, 2);
    expect(d.camera.preset).toBe('cockpit');
    run(d, 2);
    expect(d.camera.preset).toBe('special');
    expect(d.robots.RAIJIN.clip).toBe('Special');
    expect(banners).toContain('神雷風陣、発動！');
    const f = new ArenaDirector();
    const fb: string[] = [];
    f.onBanner((b) => b && fb.push(b.textJa));
    f.play({
      kind: 'specialResolved',
      outcome: 'FAILED',
      damage: 0,
      bossId: 9,
      cityHits: [{ cityId: 'kanto', damage: 25, absorbed: 0, hpAfter: 75, destroyed: false }],
    });
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
    // The crew first, then the gods' pose and the result.
    expect(d.camera.preset).toBe('cockpit');
    run(d, 2.5);
    expect(d.camera.preset).toBe('final');
    expect(d.banner).toMatchObject({ kind: 'victory', textJa: '地球防衛成功！' });
    expect(d.robots.RAIJIN.clip).toBe('Victory');
    const f = new ArenaDirector();
    f.play({ kind: 'raidEnded', result: result('FAILED') });
    run(f, 3);
    expect(f.banner?.textJa).toBe('防衛失敗…');
    expect(f.robots.FUJIN.clip).toBe('Defeat');
  });

  it('effect targets resolve to world positions (boss, escorts over their target city)', () => {
    const ctx = {
      enemies: [
        {
          id: 1,
          kind: 'BOSS' as const,
          hp: 1,
          hpMax: 1,
          ai: 'IDLE' as const,
          aiUntil: 0,
          weaken: 0,
          lastTargets: [],
          partHits: { CORE: 0, ARM: 0, LEG: 0 },
          attacks: 0,
          training: false,
        },
        {
          id: 2,
          kind: 'SCOUT' as const,
          hp: 1,
          hpMax: 1,
          ai: 'TELEGRAPH' as const,
          aiUntil: 0,
          weaken: 0,
          lastTargets: [],
          partHits: { CORE: 0, ARM: 0, LEG: 0 },
          attacks: 0,
          training: false,
        },
      ],
      telegraphs: [
        {
          id: 5,
          enemyId: 2,
          kind: 'BEAM' as const,
          targets: ['kanto' as const],
          direction: 'UP' as const,
          startsAt: 0,
          resolvesAt: 9000,
          damage: 10,
          delayed: false,
        },
      ],
    };
    expect(resolveFxTarget({ kind: 'enemy', id: 1 }, ctx)!.equals(BOSS_POSITION)).toBe(true);
    const escort = resolveFxTarget({ kind: 'enemy', id: 2 }, ctx)!;
    const city = resolveFxTarget({ kind: 'city', id: 'kanto' }, ctx)!;
    expect(escort.distanceTo(city)).toBeLessThan(4);
  });
});

describe('cinematic timing (hit-stop, slow motion, shots, accents)', () => {
  it('a hit-stop freezes only the show, briefly, and never more than ~2 per second', () => {
    const d = new ArenaDirector();
    d.play({ kind: 'cityDestroyed', cityId: 'kanto' });
    const t0 = d.time;
    d.update(0.05);
    // The show barely moves during the freeze; real time keeps going.
    expect(d.time - t0).toBeLessThan(0.01);
    expect(d.realTime).toBeCloseTo(0.05, 5);
    run(d, 0.2);
    expect(d.scale).toBe(1);
    // A second blow right away does not freeze again (no stutter under a crowd).
    d.play({ kind: 'cityDestroyed', cityId: 'tohoku' });
    const t1 = d.time;
    d.update(0.05);
    expect(d.time - t1).toBeCloseTo(0.05, 5);
  });

  it('screen accents are at most 2 Hz and off with reduced motion', () => {
    const d = new ArenaDirector();
    let flashes = 0;
    let prev = 0;
    for (let i = 0; i < 120; i++) {
      d.play({ kind: 'cityDestroyed', cityId: 'kanto' });
      d.update(1 / 60);
      if (d.flash > prev + 0.05) flashes++;
      prev = d.flash;
    }
    // 2 s of non-stop blows: no more than 4 flashes plus the first.
    expect(flashes).toBeLessThanOrEqual(5);
    const r = new ArenaDirector();
    r.settings = { reducedMotion: true, shakeScale: 1, shortSpecials: false };
    r.play({ kind: 'cityDestroyed', cityId: 'kanto' });
    expect(r.flash).toBe(0);
    expect(r.aberration).toBe(0);
  });

  it('the full special plays its shots in order with cinema bars and slow motion at the blow', () => {
    const d = new ArenaDirector();
    const bars: boolean[] = [];
    const sounds: string[] = [];
    d.onLetterbox((on) => bars.push(on));
    d.onSound((s) => sounds.push(s));
    d.play({ kind: 'specialResolved', outcome: 'ACTIVATED', damage: 250, bossId: 9, cityHits: [] });
    const shots: string[] = [];
    let slowest = 1;
    for (let i = 0; i < 60 * 9; i++) {
      d.update(1 / 60);
      const shot = d.camera.shot;
      if (shot && shots[shots.length - 1] !== shot) shots.push(shot);
      slowest = Math.min(slowest, d.scale);
    }
    expect(shots).toEqual(['specialRise', 'specialLaunch', 'bossImpact', 'heroes']);
    expect(bars).toEqual([true, false]);
    expect(slowest).toBeLessThan(0.5);
    expect(sounds).toEqual(expect.arrayContaining(['special', 'whoosh', 'impact']));
    expect(d.camera).toMatchObject({ preset: 'overview', shot: null });
    // Partial and failure use their own shorter cuts.
    const f = new ArenaDirector();
    f.play({ kind: 'specialResolved', outcome: 'FAILED', damage: 0, bossId: 9, cityHits: [] });
    run(f, 0.1);
    expect(f.camera.shot).toBe('bossGlare');
    expect(f.letterbox).toBe(true);
    run(f, 3);
    expect(f.letterbox).toBe(false);
  });

  it('NULL CORE breaks apart in a chain of blasts before the result', () => {
    const d = new ArenaDirector();
    const fx: DirectorEffect[] = [];
    d.onEffect((e) => fx.push(e));
    d.play({ kind: 'enemyDefeated', enemyId: 9, enemyKind: 'BOSS', callsign: 'PILOT-7' });
    d.play({ kind: 'raidEnded', result: result('SUCCEEDED') });
    run(d, 0.1);
    expect(d.camera.shot).toBe('bossDown');
    expect(d.banner?.textJa).toBe('NULL CORE 撃破！');
    run(d, 2.6);
    expect(fx.filter((e) => e.kind === 'explosion').length).toBe(4);
    // Then the crew and the result, as before.
    run(d, 3);
    expect(d.camera.preset).toBe('final');
    expect(d.banner?.kind).toBe('victory');
  });

  it('a fallen city gets a short push-in on it, not during a cinematic, not with reduced motion', () => {
    const d = new ArenaDirector();
    d.play({ kind: 'cityDestroyed', cityId: 'kyushu' });
    expect(d.camera).toMatchObject({ shot: 'cityFall', anchor: { kind: 'city', id: 'kyushu' } });
    run(d, 2.2);
    expect(d.camera.shot).toBeNull();
    const busy = new ArenaDirector();
    busy.play({ kind: 'enemySpawned', enemyId: 9, enemyKind: 'BOSS' });
    run(busy, 0.1);
    busy.play({ kind: 'cityDestroyed', cityId: 'kyushu' });
    expect(busy.camera.shot).toBe('bossReveal');
    const r = new ArenaDirector();
    r.settings = { reducedMotion: true, shakeScale: 1, shortSpecials: false };
    r.play({ kind: 'cityDestroyed', cityId: 'kyushu' });
    expect(r.camera.shot).toBeNull();
  });

  it('the score follows the raid: waves, the boss, the result, back to calm', () => {
    const d = new ArenaDirector();
    const cues: string[] = [];
    d.onMusic((c) => cues.push(c));
    d.play({ kind: 'raidStart' });
    run(d, 3);
    d.play({ kind: 'phase', phase: 'WAVE_2' });
    run(d, 1);
    d.play({ kind: 'phase', phase: 'FINAL_WAVE' });
    run(d, 1);
    d.play({ kind: 'raidEnded', result: result('FAILED') });
    run(d, 3);
    d.reset();
    expect(cues).toEqual(['wave', 'battle', 'boss', 'defeat', 'calm']);
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

describe('cockpit (spec D4) and camera beats (D6)', () => {
  it('boarding lights a seat, success pulses it; a boarding burst gets one short cockpit look', () => {
    const d = new ArenaDirector();
    run(d, 1);
    d.play({ kind: 'boarded', callsign: 'A', robot: 'RAIJIN', pilotId: 'p1' });
    expect(d.boardedAt.get('p1')).toBe(d.time);
    expect(d.camera.preset).toBe('cockpit');
    run(d, 3);
    expect(d.camera.preset).toBe('overview');
    d.play({ kind: 'boarded', callsign: 'B', robot: 'FUJIN', pilotId: 'p2' });
    expect(d.camera.preset).toBe('overview'); // throttled: no jump-cut montage
    d.play({
      kind: 'task',
      role: 'GUARDIAN',
      robot: 'FUJIN',
      success: 1,
      callsign: 'B',
      assist: false,
      pilotId: 'p2',
      effect: { kind: 'SHIELD', cityId: 'kanto', amount: 40 },
    });
    expect(d.pulsedAt.get('p2')).toBe(d.time);
  });

  it('reduced motion: no camera beats, no cockpit cut before the result', () => {
    const d = new ArenaDirector();
    d.settings = { ...d.settings, reducedMotion: true };
    run(d, 1);
    d.play({ kind: 'boarded', callsign: 'A', robot: 'RAIJIN', pilotId: 'p1' });
    expect(d.camera.preset).toBe('overview');
  });
});

describe('cockpit seating', () => {
  it('places 100 pilots without overlap, caps seats per role, rotates only consented names', () => {
    const crew = Array.from({ length: 100 }, (_, i) => ({
      pilotId: `p${i}`,
      callsign: `P${i}`,
      role: (['GUNNER', 'GUARDIAN', 'ROUTER', 'ENGINEER'] as const)[i % 4]!,
      robot: 'RAIJIN' as const,
      isBot: false,
      named: i % 3 === 0,
    }));
    const { placed, overflow } = placeCrew(crew);
    expect(placed.length).toBe(4 * SEATS_PER_ROLE);
    expect(overflow.GUNNER).toBe(0);
    const pts = placed.map((p) => seatPosition(p.roleIndex, p.slot));
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        expect(pts[i]!.distanceTo(pts[j]!)).toBeGreaterThan(0.5);
    const tags = rotatingTags(placed, new Map(), 0);
    expect(tags.length).toBeLessThanOrEqual(8);
    expect(tags.every((t) => t.member.named)).toBe(true);
    const later = rotatingTags(placed, new Map(), 4);
    expect(later.map((t) => t.member.pilotId)).not.toEqual(tags.map((t) => t.member.pilotId));
    const more = placeCrew([
      ...crew,
      ...crew
        .slice(0, 40)
        .map((m) => ({ ...m, pilotId: `x${m.pilotId}`, role: 'GUNNER' as const })),
    ]);
    expect(more.overflow.GUNNER).toBeGreaterThan(0);
  });
});

describe('cheers', () => {
  it('a roaring room glows brighter than a lone cheer (rate, not raw count)', () => {
    const d = new ArenaDirector();
    d.play({ kind: 'cheer' });
    const lone = d.cheerIntensity();
    for (let i = 0; i < 30; i++) {
      run(d, 0.1);
      d.play({ kind: 'cheer' });
    }
    expect(d.cheerIntensity()).toBeGreaterThan(lone + 0.4);
    run(d, 30);
    expect(d.cheerIntensity()).toBeLessThan(0.35);
  });
});

describe('spec animations (D1/D2)', () => {
  it('every required clip of each robot resolves to a procedural clip with a duration', () => {
    for (const team of ['RAIJIN', 'FUJIN'] as const)
      for (const name of REQUIRED_CLIPS[team]) {
        const clip = resolveClip(name);
        expect(clip, `${team} ${name}`).not.toBeNull();
        expect(CLIP_DURATION[clip!]).toBeGreaterThan(0);
      }
    expect(resolveClip('Punch')).toBe('AttackLight');
    expect(resolveClip('nope')).toBeNull();
  });

  it('gunner charge, boarding and the special charge-up use their own motions', () => {
    const d = new ArenaDirector();
    run(d, 1);
    d.play({
      kind: 'task',
      role: 'GUNNER',
      robot: 'RAIJIN',
      success: 1,
      callsign: 'A',
      assist: false,
      effect: { kind: 'ENERGY', sink: 'RAIJIN', amount: 12 },
    });
    expect(d.robots.RAIJIN.clip).toBe('Charge');
    run(d, 3);
    d.play({ kind: 'boarded', callsign: 'B', robot: 'FUJIN', pilotId: 'b' });
    expect(d.robots.FUJIN.clip).toBe('Boarding');
    const s = new ArenaDirector();
    s.play({ kind: 'specialOpen' });
    run(s, 0.1);
    expect(s.robots.RAIJIN.clip).toBe('Charge');
    expect(s.robots.FUJIN.clip).toBe('Hover');
  });
});

describe('robot damage stages (spec D1: cracks and opened plates, not red paint)', () => {
  it('maps hull to stages and shows the parts cumulatively', () => {
    expect([100, 70, 69, 40, 39, 0].map(damageStageFor)).toEqual([0, 0, 1, 1, 2, 2]);
    for (const build of [buildRaijin, buildFujin]) {
      const rig = build();
      expect(rig.damage[1].length).toBeGreaterThan(0);
      expect(rig.damage[2].length).toBeGreaterThan(0);
      const visible = () => [rig.damage[1], rig.damage[2]].map((g) => g.every((o) => o.visible));
      setDamageStage(rig, 0);
      expect([rig.damage[1], rig.damage[2]].flat().some((o) => o.visible)).toBe(false);
      setDamageStage(rig, 1);
      expect(visible()).toEqual([true, false]);
      setDamageStage(rig, 2);
      expect(visible()).toEqual([true, true]);
      rig.dispose();
    }
  });
});
