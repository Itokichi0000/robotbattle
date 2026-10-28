import { describe, expect, it } from 'vitest';
import type { TeamId } from '@sats-wars/shared';
import { ArenaDirector, type Cue, type DirectorEffect } from './director';
import { buildFujin, buildRaijin, JOINT_NAMES } from './robots/build';
import { applyClip } from './robots/animate';
import { CLIP_NAMES } from './director';

function run(d: ArenaDirector, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) d.update(1 / 60);
}

function zap(teamId: TeamId, hp: Record<TeamId, number>, over: Partial<Extract<Cue, { kind: 'zap' }>> = {}): Cue {
  return { kind: 'zap', teamId, nickname: 'たろう', damage: 10, special: false, pinch: false, ko: false, hp, ...over };
}

function startRound(d: ArenaDirector) {
  d.play({
    kind: 'roundStart',
    roundIndex: 2,
    roundsTotal: 8,
    regionId: 'kanto',
    hpMax: 200,
    hp: { RAIJIN: 200, FUJIN: 200 },
  });
}

describe('ArenaDirector', () => {
  it('round start: shows the region at stake, then FIGHT with robots in stance', () => {
    const d = new ArenaDirector();
    const banners: string[] = [];
    const fx: DirectorEffect[] = [];
    d.onBanner((b) => b && banners.push(b.textJa));
    d.onEffect((e) => fx.push(e));
    startRound(d);
    run(d, 0.1);
    expect(d.camera.preset).toBe('mapFocus');
    expect(banners[0]).toBe('第3戦　関東をかけて！');
    expect(fx.some((e) => e.kind === 'regionPulse' && e.regionId === 'kanto')).toBe(true);
    expect(d.hpMax).toBe(200);
    run(d, 2);
    expect(d.camera.preset).toBe('overview');
    expect(banners).toContain('FIGHT!');
    expect(d.robots.RAIJIN.advance).toBeGreaterThan(0);
  });

  it('each punch updates HP to the server value immediately and swings the attacker', () => {
    const d = new ArenaDirector();
    startRound(d);
    run(d, 2.5);
    const hp: Array<Record<string, number>> = [];
    d.onHp((h) => hp.push({ ...h }));
    d.play(zap('RAIJIN', { RAIJIN: 200, FUJIN: 190 }));
    expect(d.displayHp).toEqual({ RAIJIN: 200, FUJIN: 190 });
    expect(d.robots.RAIJIN.clip).toMatch(/^Attack/);
    expect(d.robots.FUJIN.clip).toBe('HitReact');
    expect(hp).toHaveLength(1);
    run(d, 2);
    expect(d.robots.RAIJIN.clip).toBe('Idle');
  });

  it('a crowd tapping fast is throttled: every punch flashes, heavy effects and sounds do not strobe', () => {
    const d = new ArenaDirector();
    startRound(d);
    run(d, 2.5);
    const fx: DirectorEffect[] = [];
    const sounds: string[] = [];
    d.onEffect((e) => fx.push(e));
    d.onSound((s) => sounds.push(s));
    let hpF = 200;
    // 50 punches within one second.
    for (let i = 0; i < 50; i++) {
      hpF -= 2;
      d.play(zap('RAIJIN', { RAIJIN: 200, FUJIN: hpF }));
      d.update(0.02);
    }
    expect(fx.filter((e) => e.kind === 'impact')).toHaveLength(50);
    expect(fx.filter((e) => e.kind === 'lightning').length).toBeLessThanOrEqual(4);
    expect(sounds.filter((s) => s === 'hit').length).toBeLessThanOrEqual(13);
    expect(d.displayHp.FUJIN).toBe(100);
  });

  it('special: banner with the name, short cut when specials come often or in reduced-motion', () => {
    const d = new ArenaDirector();
    startRound(d);
    run(d, 2.5);
    const banners: Array<{ ja: string; sub?: string }> = [];
    d.onBanner((b) => b && banners.push({ ja: b.textJa, sub: b.subJa }));
    d.play(zap('RAIJIN', { RAIJIN: 200, FUJIN: 140 }, { special: true, damage: 60 }));
    expect(d.robots.RAIJIN.clip).toBe('Special');
    expect(d.camera.preset).toBe('specialRAIJIN');
    expect(banners[0]!.ja).toContain('天雷轟破');
    expect(banners[0]!.sub).toContain('たろう');
    run(d, 2);
    expect(d.camera.preset).toBe('overview');
    // A second special soon after uses the short cut (no camera move).
    d.play(zap('FUJIN', { RAIJIN: 140, FUJIN: 140 }, { special: true, damage: 60 }));
    expect(d.camera.preset).toBe('overview');

    const r = new ArenaDirector();
    r.settings = { reducedMotion: true, shakeScale: 1, shortSpecials: false };
    startRound(r);
    run(r, 2);
    r.play(zap('FUJIN', { RAIJIN: 140, FUJIN: 200 }, { special: true, damage: 60 }));
    expect(r.camera.preset).toBe('overview');
    expect(r.shake).toBe(0);
  });

  it('pinch is announced once per team per round', () => {
    const d = new ArenaDirector();
    startRound(d);
    run(d, 2.5);
    const banners: string[] = [];
    d.onBanner((b) => b && banners.push(b.textJa));
    d.play(zap('FUJIN', { RAIJIN: 50, FUJIN: 200 }, { pinch: true, damage: 15 }));
    d.update(0.3);
    d.play(zap('FUJIN', { RAIJIN: 50, FUJIN: 185 }, { pinch: true, damage: 15 }));
    expect(banners.filter((b) => b.includes('ピンチ'))).toHaveLength(1);
  });

  it('KO: winner celebrates, loser falls, the captured region pulses on the map', () => {
    const d = new ArenaDirector();
    startRound(d);
    run(d, 2.5);
    const fx: DirectorEffect[] = [];
    d.onEffect((e) => fx.push(e));
    d.play(zap('RAIJIN', { RAIJIN: 120, FUJIN: 0 }, { ko: true }));
    d.play({ kind: 'roundEnd', winner: 'RAIJIN', reason: 'KO', regionId: 'kanto', finisher: 'たろう' });
    run(d, 1);
    expect(d.robots.FUJIN.clip).toBe('Defeat');
    expect(d.robots.RAIJIN.clip).toBe('Victory');
    expect(d.banner?.textJa).toBe('KO！ 雷神の勝ち');
    expect(d.banner?.subJa).toContain('たろう');
    run(d, 2);
    expect(d.camera.preset).toBe('mapFocus');
    expect(fx.some((e) => e.kind === 'regionPulse' && e.teamId === 'RAIJIN')).toBe(true);
    run(d, 3);
    expect(d.camera.preset).toBe('overview');
  });

  it('time-up draw and season champion banners', () => {
    const d = new ArenaDirector();
    d.play({ kind: 'roundEnd', winner: null, reason: 'DRAW', regionId: 'kyushu', finisher: null });
    run(d, 0.2);
    expect(d.banner?.textJa).toBe('引き分け！');
    run(d, 6);
    d.play({ kind: 'seasonEnd', winner: 'FUJIN', regionCounts: { RAIJIN: 3, FUJIN: 5 } });
    run(d, 1);
    expect(d.banner).toMatchObject({ kind: 'champion', textJa: '風神 全国制覇！', subJa: '雷神 3 – 5 風神' });
    expect(d.robots.FUJIN.clip).toBe('Victory');
  });

  it('syncHp overrides display immediately', () => {
    const d = new ArenaDirector();
    d.syncHp({ RAIJIN: 40, FUJIN: 55 });
    expect(d.displayHp).toEqual({ RAIJIN: 40, FUJIN: 55 });
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
