import type { GameEvent } from './events';
import type { ClockTick, PublicRaidSnapshot } from './protocol';
import { isClockRunning } from './time';

export type ApplyResult = 'applied' | 'duplicate' | 'gap' | 'ignored';

const MAX_RECENT = 30;

/**
 * Client-side mirror of the public raid state.
 * - Starts from a full snapshot, then applies seq-numbered events.
 * - Duplicate events (seq <= lastSeq) are ignored, so redelivery is harmless.
 * - A gap (seq > lastSeq + 1, other raid, or clock tick ahead of us) returns
 *   'gap' and the caller must request a fresh snapshot.
 * The store never computes game rules; it only takes the server's post-state.
 */
export class RaidStore {
  private snap: PublicRaidSnapshot | null = null;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: GameEvent) => void>();
  version = 0;

  get snapshot(): PublicRaidSnapshot | null {
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

  applySnapshot(next: PublicRaidSnapshot): ApplyResult {
    const cur = this.snap;
    if (cur && cur.raidId === next.raidId && next.lastSeq < cur.lastSeq) return 'ignored';
    this.snap = next;
    this.notify();
    return 'applied';
  }

  /** @param serverNow client's estimate of the server's epoch ms (for clock anchoring) */
  applyEvent(e: GameEvent, serverNow: number): ApplyResult {
    const cur = this.snap;
    if (!cur || cur.raidId !== e.raidId) return 'gap';
    if (e.seq <= cur.lastSeq) return 'duplicate';
    if (e.seq !== cur.lastSeq + 1) return 'gap';
    const p = e.patch;
    const next: PublicRaidSnapshot = {
      ...cur,
      lastSeq: e.seq,
      status: p.status,
      phase: p.phase,
      running: isClockRunning(p.status),
      pausedFrom: p.pausedFrom,
      liveStartClock: p.liveStartClock,
      cities: p.cities,
      robots: p.robots,
      reserveEnergy: p.reserveEnergy,
      jammedUntil: p.jammedUntil,
      enemies: p.enemies,
      telegraphs: p.telegraphs,
      bossId: p.bossId,
      sync: p.sync,
      special: p.special,
      stats: p.stats,
      result: p.result,
      crew: p.crew ?? cur.crew,
      pauseReason: p.status === 'PAUSED' ? cur.pauseReason : null,
      // Re-anchor the clock at the event time.
      clockMs: e.t,
      gameMs: e.gameMs,
      serverTime: serverNow,
      recentEvents: [...cur.recentEvents, e].slice(-MAX_RECENT),
    };
    if (e.type === 'RAID_STATUS_CHANGED' && e.data.to === 'PAUSED')
      next.pauseReason = e.data.reason;
    this.snap = next;
    this.notify();
    for (const l of this.eventListeners) l(e);
    return 'applied';
  }

  /** Server-side fields that change without a game event (presence, broadcast, join state...). */
  applyPatch(patch: Partial<PublicRaidSnapshot>): void {
    if (!this.snap) return;
    this.snap = { ...this.snap, ...patch };
    this.notify();
  }

  applyClock(tick: ClockTick): ApplyResult {
    const cur = this.snap;
    if (!cur || cur.raidId !== tick.raidId) return 'gap';
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
