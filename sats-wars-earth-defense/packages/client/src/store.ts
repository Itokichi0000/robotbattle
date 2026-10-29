import { estimateMatchTime } from '@swed/game-engine';
import type { MatchEventMsg, MatchSnapshotMsg } from '@swed/shared';

/**
 * Client mirror of the authoritative match: latest snapshot + a stream of confirmed events.
 * Clients never compute outcomes; they interpolate time between 10 Hz snapshots only.
 */

export interface StoreState {
  snap: MatchSnapshotMsg | null;
  /** performance.now() when the snapshot arrived. */
  receivedAt: number;
  connected: boolean;
  /** Was connected before and is trying again. */
  reconnecting: boolean;
}

type Listener = () => void;
type EventListener = (e: MatchEventMsg) => void;

export class MatchStore {
  private state: StoreState = { snap: null, receivedAt: 0, connected: false, reconnecting: false };
  private readonly listeners = new Set<Listener>();
  private readonly eventListeners = new Set<EventListener>();
  private lastSeq = new Map<string, number>();

  getState = (): StoreState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  onEvent(fn: EventListener): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  applySnapshot(msg: MatchSnapshotMsg, nowMs: number): boolean {
    const cur = this.state.snap;
    if (cur && cur.matchId === msg.matchId && msg.version < cur.version) return false;
    this.set({ snap: msg, receivedAt: nowMs });
    return true;
  }

  /** Delivers each confirmed event once (seq is per match and strictly increasing). */
  applyEvent(msg: MatchEventMsg): boolean {
    const last = this.lastSeq.get(msg.matchId) ?? 0;
    if (msg.seq <= last) return false;
    this.lastSeq.set(msg.matchId, msg.seq);
    if (this.lastSeq.size > 8) this.lastSeq = new Map([...this.lastSeq].slice(-4));
    for (const l of this.eventListeners) l(msg);
    return true;
  }

  setConnection(connected: boolean): void {
    const wasConnected = this.state.connected || this.state.reconnecting;
    this.set({ connected, reconnecting: !connected && wasConnected });
  }

  /** Estimated authoritative match time now (ms). */
  matchTime(nowMs: number): number {
    const s = this.state.snap;
    if (!s) return 0;
    return estimateMatchTime(s.state, this.state.receivedAt, nowMs);
  }
}
