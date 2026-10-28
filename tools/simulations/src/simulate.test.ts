import { describe, expect, it } from 'vitest';
import { aggregate, simulateCampaign } from './simulate';

describe('campaign simulator', () => {
  it('is deterministic per seed and always ends with Japan falling', () => {
    const o = { seed: 7, autoShare: 0.6 };
    const a = simulateCampaign(o);
    expect(simulateCampaign(o)).toEqual(a);
    expect(a.fell).toBe(true);
    expect(a.reachedWave).toBeGreaterThanOrEqual(2);
    // Only successful moves are charged.
    expect(a.sats).toBe(a.actions * 21);
  });

  it('choosing well lasts at least as long as random play, and campaigns are not endless', () => {
    const n = 30;
    const smart = aggregate(Array.from({ length: n }, (_, i) => simulateCampaign({ seed: i * 13 + 1, autoShare: 1 })));
    const random = aggregate(Array.from({ length: n }, (_, i) => simulateCampaign({ seed: i * 13 + 1, autoShare: 0 })));
    expect(smart.waveMean).toBeGreaterThanOrEqual(random.waveMean);
    expect(random.waveMean).toBeGreaterThanOrEqual(3);
    expect(smart.fellShare).toBe(1);
    expect(smart.actionsMean).toBeLessThan(600);
  }, 60_000);
});
