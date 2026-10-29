import { describe, expect, it } from 'vitest';
import { QualityGovernor } from './qualityGovernor';

const run = (g: QualityGovernor, fps: number, from: number, to: number) => {
  const changes: string[] = [];
  for (let t = from; t <= to; t++) {
    const c = g.sample(fps, t);
    if (c) changes.push(`${t}:${c}`);
  }
  return changes;
};

describe('QualityGovernor (auto quality reduction)', () => {
  it('steps down after sustained low FPS, then to 2D only when low still cannot hold 15 fps', () => {
    const g = new QualityGovernor({ ceiling: 'high' });
    expect(run(g, 18, 0, 13)).toEqual(['6:medium', '13:low']);
    expect(run(g, 12, 14, 40)).toEqual(['34:2d']);
    // 2D is final for this session (the operator can switch back).
    expect(g.sample(60, 41)).toBeNull();
  });

  it('ignores short dips and recovers up to the ceiling only', () => {
    const g = new QualityGovernor({ ceiling: 'medium' });
    expect(run(g, 10, 0, 3)).toEqual([]);
    expect(run(g, 40, 4, 10)).toEqual([]);
    expect(run(g, 20, 11, 17)).toEqual(['17:low']);
    expect(run(g, 58, 18, 60)).toEqual(['48:medium']);
    expect(run(g, 58, 61, 120)).toEqual([]);
  });

  it('ignores missing samples', () => {
    const g = new QualityGovernor({ ceiling: 'low' });
    expect(g.sample(0, 0)).toBeNull();
    expect(g.sample(Number.NaN, 1)).toBeNull();
  });
});
