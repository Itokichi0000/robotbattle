import { performance } from 'node:perf_hooks';

/** Monotonic time source (ms). Immune to wall-clock jumps. */
export interface MonoClock {
  now(): number;
}

/** Wall clock (epoch ms) for persisted timestamps and client time sync. */
export interface WallClock {
  now(): number;
}

export const systemMonoClock: MonoClock = { now: () => performance.now() };
export const systemWallClock: WallClock = { now: () => Date.now() };

/** Controllable clock for tests: advances both monotonic and wall time together. */
export class FakeClock implements MonoClock, WallClock {
  constructor(private ms = 1_700_000_000_000) {}
  now(): number {
    return this.ms;
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}
