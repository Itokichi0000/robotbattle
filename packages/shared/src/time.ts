import type { MatchStatus } from './state';

export function isClockRunning(status: MatchStatus): boolean {
  return status === 'LOBBY' || status === 'LIVE' || status === 'FINALIZING';
}

/** mm:ss for non-negative ms (rounds up so "0:01" is shown until the last ms). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface ClockAnchor {
  clockMs: number;
  gameMs: number;
  running: boolean;
  /** Server epoch ms at which clockMs/gameMs were sampled. */
  serverTime: number;
}

/** Estimate current clock values from an anchor and the client's estimate of server time. */
export function estimateClock(anchor: ClockAnchor, serverNow: number): { clockMs: number; gameMs: number } {
  if (!anchor.running) return { clockMs: anchor.clockMs, gameMs: anchor.gameMs };
  const elapsed = Math.max(0, serverNow - anchor.serverTime);
  return { clockMs: anchor.clockMs + elapsed, gameMs: anchor.gameMs + elapsed };
}
