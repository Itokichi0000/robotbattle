import { describe, expect, it } from 'vitest';
import type { ClashRecord } from '@sats-wars/shared';
import { ArenaDirector } from './director';
import { buildFujin, buildRaijin, JOINT_NAMES } from './robots/build';
import { applyClip } from './robots/animate';
import { CLIP_NAMES } from './director';

function clash(over: Partial<ClashRecord> = {}): ClashRecord {
  const snap = (teamId: 'RAIJIN' | 'FUJIN') => ({
    teamId,
    hpBefore: 100,
    energyBefore: 0,
    activeAttackRegions: 0,
    activeDefenseRegions: 0,
    activeEnergyRegions: 0,
  });
  return {
    clashIndex: 0,
    atGameMs: 45_000,
    snapshot: { RAIJIN: snap('RAIJIN'), FUJIN: snap('FUJIN') },
    outcome: {
      RAIJIN: { teamId: 'RAIJIN', damageDealt: 12, special: false, energyBonus: 0, hpAfter: 90, energyAfter: 0 },
      FUJIN: { teamId: 'FUJIN', damageDealt: 10, special: false, energyBonus: 0, hpAfter: 88, energyAfter: 0 },
    },
    ko: [],
    isFinal: false,
    ...over,
  };
}

function run(d: ArenaDirector, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) d.update(1 / 60);
}

describe('ArenaDirector', () => {
  it('updates displayed HP only at the hit beat and to server values', () => {
    const d = new ArenaDirector();
    const hp: Array<Record<string, number>> = [];
    d.onHp((h) => hp.push({ ...h }));
    d.play({ kind: 'clash', clash: clash() });
    run(d, 0.5);
    expect(d.displayHp).toEqual({ RAIJIN: 100, FUJIN: 100 });
    run(d, 1);
    expect(d.displayHp).toEqual({ RAIJIN: 90, FUJIN: 88 });
    run(d, 3);
    expect(d.camera.preset).toBe('overview');
    expect(d.robots.RAIJIN.clip).toBe('Idle');
    expect(hp).toHaveLength(1);
  });

  it('plays a special cinematic first and shortens it in reduced-motion mode', () => {
    const special = clash({
      outcome: {
        RAIJIN: { teamId: 'RAIJIN', damageDealt: 22, special: true, energyBonus: 0, hpAfter: 90, energyAfter: 5 },
        FUJIN: { teamId: 'FUJIN', damageDealt: 10, special: false, energyBonus: 0, hpAfter: 78, energyAfter: 0 },
      },
    });
    const d = new ArenaDirector();
    const banners: string[] = [];
    d.onBanner((b) => b && banners.push(b.textJa));
    d.play({ kind: 'clash', clash: special });
    run(d, 0.1);
    expect(d.robots.RAIJIN.clip).toBe('Special');
    expect(d.camera.preset).toBe('specialRAIJIN');
    expect(banners[0]).toContain('天雷轟破');
    run(d, 3);
    expect(d.displayHp.FUJIN).toBe(100);
    run(d, 1.5);
    expect(d.displayHp.FUJIN).toBe(78);

    const r = new ArenaDirector();
    r.settings = { reducedMotion: true, shakeScale: 1, shortSpecials: true };
    r.play({ kind: 'clash', clash: special });
    run(r, 2.6);
    expect(r.displayHp.FUJIN).toBe(78);
    expect(r.shake).toBe(0);
  });

  it('KO leaves the loser in Defeat and result shows the winner', () => {
    const d = new ArenaDirector();
    d.play({ kind: 'clash', clash: clash({ ko: ['FUJIN'] }) });
    d.play({ kind: 'result', winner: 'RAIJIN' });
    run(d, 8);
    expect(d.robots.FUJIN.clip).toBe('Defeat');
    expect(d.robots.RAIJIN.clip).toBe('Victory');
    expect(d.banner?.textJa).toContain('雷神の勝利');
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
