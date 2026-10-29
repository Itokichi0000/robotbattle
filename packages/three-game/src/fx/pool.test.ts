import { describe, expect, it } from 'vitest';
import { musicBar } from '../music';
import { DebrisPool, ParticlePool, buildRibbon } from './pool';

const seq = () => {
  let i = 0;
  const xs = [0.1, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8, 0.4, 0.6];
  return () => xs[i++ % xs.length]!;
};
const white = { r: 1, g: 1, b: 1 };

describe('particle pools (effects)', () => {
  it('spawns, ages and retires particles; the oldest are recycled when full', () => {
    const p = new ParticlePool(8);
    expect(
      p.spawn(
        { count: 5, origin: { x: 0, y: 2, z: 0 }, color: white, speed: 4, life: 1, size: 0.1 },
        seq(),
      ),
    ).toBe(5);
    expect(p.alive()).toBe(5);
    // Falls under gravity.
    p.step(0.1);
    const ys = Array.from({ length: 5 }, (_, i) => p.pos[i * 3 + 1]!);
    expect(Math.max(...ys)).toBeLessThan(2.6);
    // Asking for more than the pool holds recycles, never grows.
    p.spawn(
      { count: 20, origin: { x: 0, y: 0, z: 0 }, color: white, speed: 1, life: 1, size: 0.1 },
      seq(),
    );
    expect(p.alive()).toBe(8);
    for (let i = 0; i < 100; i++) p.step(0.05);
    expect(p.alive()).toBe(0);
    // An empty pool (low quality) is a no-op.
    expect(
      new ParticlePool(0).spawn({
        count: 9,
        origin: { x: 0, y: 0, z: 0 },
        color: white,
        speed: 1,
        life: 1,
        size: 1,
      }),
    ).toBe(0);
  });

  it('energy streams arrive at their target over their life', () => {
    const p = new ParticlePool(1);
    p.spawn(
      {
        count: 1,
        origin: { x: 0, y: 0, z: 0 },
        color: white,
        speed: 0,
        life: 1,
        size: 0.1,
        gravity: 0,
        drag: 0,
        toward: { x: 4, y: 2, z: -3 },
      },
      () => 0.5,
    );
    const maxLife = p.params[1]!;
    const steps = 50;
    for (let i = 0; i < steps - 1; i++) p.step(maxLife / steps);
    expect(p.pos[0]).toBeCloseTo(4 * (1 - 1 / steps), 1);
    expect(p.pos[2]).toBeCloseTo(-3 * (1 - 1 / steps), 1);
  });

  it('debris bounces on the stage floor and comes to rest; off the stage it falls away', () => {
    const d = new DebrisPool(2);
    d.spawn({ count: 1, origin: { x: 0, y: 3, z: 0 }, speed: 2, life: 5, size: 0.2 }, seq());
    let bounced = false;
    for (let i = 0; i < 200; i++) {
      d.step(0.01);
      if (d.pos[1]! === 0) bounced = true;
      expect(d.pos[1]!).toBeGreaterThanOrEqual(0);
    }
    expect(bounced).toBe(true);
    const off = new DebrisPool(1);
    off.spawn({ count: 1, origin: { x: 0, y: 14, z: -17 }, speed: 1, life: 5, size: 0.2 }, seq());
    for (let i = 0; i < 300; i++) off.step(0.01);
    expect(off.pos[1]!).toBeLessThan(0);
  });

  it('a ribbon is as wide as asked (tapered at the ends) and lies across the view', () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ];
    const out = new Float32Array(18);
    expect(buildRibbon(pts, { x: 1, y: 0, z: 10 }, 0.5, out)).toBe(18);
    // Middle point: full width, offset along Y (perpendicular to both the line and the view).
    const mid = [out[6]!, out[7]!, out[8]!, out[9]!, out[10]!, out[11]!];
    expect(Math.abs(mid[1]! - mid[4]!)).toBeCloseTo(0.5, 2);
    expect(mid[2]).toBeCloseTo(0, 5);
    // Ends are thinner.
    expect(Math.abs(out[1]! - out[4]!)).toBeLessThan(0.5);
    expect(buildRibbon(pts.slice(0, 1), { x: 0, y: 0, z: 1 }, 1, out)).toBe(0);
  });
});

describe('procedural score', () => {
  it('layers follow the cue: calm has no drums, battle adds snare, boss adds taiko and arpeggio', () => {
    const voices = (cue: Parameters<typeof musicBar>[0]) =>
      new Set(musicBar(cue, 0).map((n) => n.voice));
    expect([...voices('calm')].sort()).toEqual(['bass', 'pad']);
    expect(voices('wave').has('kick')).toBe(true);
    expect(voices('wave').has('snare')).toBe(false);
    expect(voices('battle').has('snare')).toBe(true);
    expect(voices('boss').has('taiko')).toBe(true);
    expect(voices('boss').has('lead')).toBe(true);
  });

  it('every note sits inside its bar, pitched voices have a frequency, and the loop is four bars', () => {
    for (const cue of ['calm', 'wave', 'battle', 'boss', 'victory', 'defeat'] as const)
      for (let bar = 0; bar < 8; bar++)
        for (const n of musicBar(cue, bar)) {
          expect(n.step).toBeGreaterThanOrEqual(0);
          expect(n.step).toBeLessThan(16);
          expect(n.vel).toBeGreaterThan(0);
          if (['bass', 'pad', 'lead'].includes(n.voice)) expect(n.freq).toBeGreaterThan(20);
        }
    expect(musicBar('battle', 5)).toEqual(musicBar('battle', 1));
    // Victory is in a major key (F♯ above D), the raid loop in D minor (F).
    const fSharp = 440 * 2 ** ((66 - 69) / 12);
    expect(musicBar('victory', 0).some((n) => Math.abs((n.freq ?? 0) - fSharp) < 0.01)).toBe(true);
    expect(musicBar('wave', 0).some((n) => Math.abs((n.freq ?? 0) - fSharp) < 0.01)).toBe(false);
  });
});
