import type { GameEvent } from './events';
import type { ClockTick, PublicMatchSnapshot } from './protocol';
import type { RegionPaint, TeamState } from './state';
import { isClockRunning } from './time';

export type ApplyResult = 'applied' | 'duplicate' | 'gap' | 'ignored';

const MAX_RECENT = 30;

/**
 * Client-side mirror of the public match state.
 * - Starts from a full snapshot, then applies seq-numbered events.
 * - Duplicate events (seq <= lastSeq) are ignored, so redelivery is harmless.
 * - A gap (seq > lastSeq + 1, other match, or clock tick ahead of us) returns
 *   'gap' and the caller must request a fresh snapshot.
 * The store never computes game rules; it only applies server post-state patches.
 */
export class MatchStore {
  private snap: PublicMatchSnapshot | null = null;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: GameEvent) => void>();
  version = 0;

  get snapshot(): PublicMatchSnapshot | null {
    return this.snap;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fires for each newly applied event (not duplicates); used for VFX/audio cues. */
  onEvent(listener: (e: GameEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  applySnapshot(next: PublicMatchSnapshot): ApplyResult {
    const cur = this.snap;
    if (cur && cur.matchId === next.matchId && next.lastSeq < cur.lastSeq) return 'ignored';
    this.snap = next;
    this.notify();
    return 'applied';
  }

  /** @param serverNow client's estimate of the server's epoch ms (for clock anchoring) */
  applyEvent(e: GameEvent, serverNow: number): ApplyResult {
    const cur = this.snap;
    if (!cur || cur.matchId !== e.matchId) return 'gap';
    if (e.seq <= cur.lastSeq) return 'duplicate';
    if (e.seq !== cur.lastSeq + 1) return 'gap';
    const next: PublicMatchSnapshot = { ...cur, lastSeq: e.seq };
    const p = e.patch;
    if (p.regions?.length) {
      const byId = new Map<string, RegionPaint>(p.regions.map((r) => [r.regionId, r]));
      next.regions = cur.regions.map((r) => byId.get(r.regionId) ?? r);
    }
    if (p.teams?.length) {
      const teams = { ...cur.teams };
      for (const t of p.teams as TeamState[]) teams[t.teamId] = t;
      next.teams = teams;
    }
    if (p.status !== undefined) {
      next.status = p.status;
      next.running = isClockRunning(p.status);
      if (p.status !== 'PAUSED') next.pauseReason = null;
    }
    if (p.pausedFrom !== undefined) next.pausedFrom = p.pausedFrom;
    if (p.liveStartClock !== undefined) next.liveStartClock = p.liveStartClock;
    if (p.phase !== undefined) next.phase = p.phase;
    if (p.phaseEndsAt !== undefined) next.phaseEndsAt = p.phaseEndsAt;
    if (p.roundIndex !== undefined) next.roundIndex = p.roundIndex;
    if (p.round !== undefined) next.round = p.round;
    if (p.result !== undefined) next.result = p.result;
    if (e.type === 'MATCH_STATUS_CHANGED' && e.data.to === 'PAUSED')
      next.pauseReason = e.data.reason;
    if (e.type === 'ROUND_ENDED') next.rounds = [...cur.rounds, e.data.summary];
    // Re-anchor the clock at the event time.
    next.clockMs = e.t;
    next.gameMs = e.gameMs;
    next.serverTime = serverNow;
    next.recentEvents = [...cur.recentEvents, e].slice(-MAX_RECENT);
    this.snap = next;
    this.notify();
    for (const l of this.eventListeners) l(e);
    return 'applied';
  }

  applyPresence(supporters: PublicMatchSnapshot['supporters']): void {
    if (!this.snap) return;
    this.snap = { ...this.snap, supporters };
    this.notify();
  }

  applyClock(tick: ClockTick): ApplyResult {
    const cur = this.snap;
    if (!cur || cur.matchId !== tick.matchId) return 'gap';
    if (tick.lastSeq > cur.lastSeq) return 'gap';
    if (tick.lastSeq < cur.lastSeq) return 'ignored';
    this.snap = {
      ...cur,
      status: tick.status,
      clockMs: tick.clockMs,
      gameMs: tick.gameMs,
      liveStartClock: tick.liveStartClock,
      running: tick.running,
      serverTime: tick.serverTime,
    };
    this.notify();
    return 'applied';
  }
}
