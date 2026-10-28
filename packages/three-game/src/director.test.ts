import { describe, expect, it } from 'vitest';
import { ArenaDirector, type Cue, type DirectorEffect } from './director';
import { buildFujin, buildRaijin, JOINT_NAMES } from './robots/build';
import { applyClip } from './robots/animate';
import { CLIP_NAMES } from './director';

function run(d: ArenaDirector, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) d.update(1 / 60);
}

function action(over: Partial<Extract<Cue, { kind: 'action' }>> = {}): Cue {
  return { kind: 'action', action: 'RAIJIN', regionId: 'kanto', nickname: 'たろう', damage: 30, kills: 0, liberated: false, ...over };
}

describe('ArenaDirector', () => {
  it('a Raijin strike swings the robot and sends lightning to the targeted region', () => {
    const d = new ArenaDirector();
    const fx: DirectorEffect[] = [];
    const sounds: string[] = [];
    d.onEffect((e) => fx.push(e));
    d.onSound((s) => sounds.push(s));
    d.play(action({ kills: 1 }));
    expect(d.robots.RAIJIN.clip).toBe('AttackHeavy');
    expect(fx.find((e) => e.kind === 'lightning')).toMatchObject({ regionId: 'kanto', teamId: 'RAIJIN' });
    expect(fx.some((e) => e.kind === 'sparks' && e.regionId === 'kanto')).toBe(true);
    expect(sounds).toContain('thunder');
    run(d, 2);
    expect(d.robots.RAIJIN.clip).toBe('Idle');
  });

  it('Fujin uses wind; a barrier glows on the region', () => {
    const d = new ArenaDirector();
    const fx: DirectorEffect[] = [];
    d.onEffect((e) => fx.push(e));
    d.play(action({ action: 'FUJIN', regionId: 'kinki' }));
    d.play(action({ action: 'SHIELD', regionId: 'tohoku' }));
    expect(fx.find((e) => e.kind === 'wind')).toMatchObject({ regionId: 'kinki' });
    expect(fx.find((e) => e.kind === 'shield')).toMatchObject({ regionId: 'tohoku' });
    expect(d.robots.FUJIN.clip).toBe('AttackLight');
  });

  it('a crowd acting fast is throttled: every hit flashes, heavy effects and sounds do not strobe', () => {
    const d = new ArenaDirector();
    const fx: DirectorEffect[] = [];
    const sounds: string[] = [];
    d.onEffect((e) => fx.push(e));
    d.onSound((s) => sounds.push(s));
    for (let i = 0; i < 50; i++) {
      d.play(action());
      d.update(0.02);
    }
    expect(fx.filter((e) => e.kind === 'impact')).toHaveLength(50);
    expect(fx.filter((e) => e.kind === 'lightning').length).toBeLessThanOrEqual(4);
    expect(sounds.filter((s) => s === 'hit').length).toBeLessThanOrEqual(13);
  });

  it('the combo plays both gods and names the player; short in reduced motion', () => {
    const d = new ArenaDirector();
    const banners: Array<{ ja: string; sub?: string }> = [];
    d.onBanner((b) => b && banners.push({ ja: b.textJa, sub: b.subJa }));
    d.play(action({ action: 'COMBO', kills: 3 }));
    expect(d.robots.RAIJIN.clip).toBe('Special');
    expect(d.robots.FUJIN.clip).toBe('Special');
    expect(d.camera.preset).toBe('final');
    expect(banners[0]!.ja).toContain('風神雷神');
    expect(banners[0]!.sub).toContain('たろう');
    run(d, 2.5);
    expect(d.camera.preset).toBe('overview');
    const r = new ArenaDirector();
    r.settings = { reducedMotion: true, shakeScale: 1, shortSpecials: false };
    r.play(action({ action: 'COMBO' }));
    expect(r.camera.preset).toBe('overview');
    expect(r.shake).toBe(0);
  });

  it('alien turn: map camera, attacks on each hit region, and a capture banner', () => {
    const d = new ArenaDirector();
    const fx: DirectorEffect[] = [];
    const banners: string[] = [];
    d.onEffect((e) => fx.push(e));
    d.onBanner((b) => b && banners.push(b.textJa));
    d.play({
      kind: 'alienTurn',
      attacks: [
        { regionId: 'tohoku', damage: 20, absorbed: 0, cityHpAfter: 0, fell: true },
        { regionId: 'kyushu', damage: 10, absorbed: 10, cityHpAfter: 70, fell: false },
      ],
      fell: ['tohoku'],
      landed: ['kanto'],
    });
    run(d, 0.1);
    expect(d.camera.preset).toBe('mapFocus');
    expect(banners[0]).toBe('エイリアンの攻撃！');
    run(d, 1.5);
    expect(fx.filter((e) => e.kind === 'alienAttack').map((e) => e.regionId)).toEqual(['tohoku', 'kyushu']);
    expect(fx.some((e) => e.kind === 'shield' && e.regionId === 'kyushu')).toBe(true);
    expect(fx.some((e) => e.kind === 'landing' && e.regionId === 'kanto')).toBe(true);
    run(d, 1);
    expect(banners).toContain('東北 がとられた！');
    run(d, 3);
    expect(d.camera.preset).toBe('overview');
  });

  it('liberation, wave clear and Japan fallen banners', () => {
    const d = new ArenaDirector();
    d.play(action({ liberated: true, regionId: 'hokkaido' }));
    expect(d.banner?.textJa).toBe('北海道 奪還！');
    d.play({ kind: 'waveCleared', wave: 3 });
    run(d, 0.1);
    expect(d.banner?.textJa).toBe('ウェーブ3 クリア！');
    run(d, 3);
    d.play({ kind: 'japanFallen', reachedWave: 7 });
    run(d, 0.5);
    expect(d.banner).toMatchObject({ kind: 'gameover', textJa: '日本陥落…' });
    expect(d.banner?.subJa).toContain('ウェーブ7');
    expect(d.robots.RAIJIN.clip).toBe('Defeat');
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
