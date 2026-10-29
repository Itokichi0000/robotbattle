/** mulberry32 over a uint32 kept in the match state, so replays are bit-identical. */
export interface RngHolder {
  rng: number;
}

export function nextRandom(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) >>> 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomBetween(h: RngHolder, min: number, max: number): number {
  return min + (max - min) * nextRandom(h);
}

export function randomPick<T>(h: RngHolder, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(nextRandom(h) * items.length))]!;
}

export function weightedPick<T extends { weight: number }>(h: RngHolder, items: readonly T[]): T {
  const total = items.reduce((a, i) => a + i.weight, 0);
  let r = nextRandom(h) * total;
  for (const i of items) {
    r -= i.weight;
    if (r < 0) return i;
  }
  return items[items.length - 1]!;
}
