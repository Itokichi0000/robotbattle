import type { GameConfig, GameEvent, MatchState } from '@sats-wars/shared';
import { isClockRunning } from '@sats-wars/shared';
import {
  type EngineCommand,
  type ReduceResult,
  createMatchState,
  reduce,
  snapshotCore,
} from '@sats-wars/game-engine';
import type { MonoClock, WallClock } from '../clock';
import type { Repo } from '../db/repo';

/** Distributive Omit so each command variant keeps its own fields. */
export type CommandInput = EngineCommand extends infer C
  ? C extends EngineCommand
    ? Omit<C, 't'>
    : never
  : never;

export type RuntimeListener = (events: GameEvent[], state: MatchState) => void;

const RECENT_EVENTS = 30;
const HIDDEN_NAME = '匿名 / Anonymous';

/**
 * Owns one campaign: engine state, the pause-corrected match clock, persistence
 * of the command log/events, and fan-out to listeners. All mutations go through
 * dispatch(), which is synchronous, so commands are strictly serialized.
 */
export class MatchRuntime {
  private baseClock = 0;
  private runningSince: number | null = null;
  private commandIdx: number;
  private listeners = new Set<RuntimeListener>();
  private recent: GameEvent[];
  private hidden: Set<string>;
  private lastClockPersist = 0;

  private constructor(
    public state: MatchState,
    private repo: Repo,
    private mono: MonoClock,
    private wall: WallClock,
    commandIdx: number,
  ) {
    this.commandIdx = commandIdx;
    this.recent = repo.recentEvents(state.matchId, RECENT_EVENTS);
    this.hidden = new Set(repo.hiddenPlayerIds());
    this.baseClock = state.clockMs;
    this.syncClock();
  }

  static create(
    repo: Repo,
    matchId: string,
    config: GameConfig,
    seed: number,
    mono: MonoClock,
    wall: WallClock,
  ): MatchRuntime {
    const state = createMatchState(matchId, config, seed);
    repo.tx(() => {
      repo.insertMatch(matchId, config, seed, wall.now());
      repo.saveMatchProjection(state, wall.now());
    });
    return new MatchRuntime(state, repo, mono, wall, 0);
  }

  /**
   * Rebuild from the command log after a restart. A match that was running is
   * put into PAUSED (reason SERVER_RESTART) so the operator decides when to resume.
   */
  static recover(repo: Repo, matchId: string, mono: MonoClock, wall: WallClock): MatchRuntime {
    const row = repo.getMatch(matchId);
    if (!row) throw new Error(`match ${matchId} not found`);
    const config = JSON.parse(row.config_json) as GameConfig;
    const commands = repo.loadCommands(matchId);
    let state = createMatchState(matchId, config, row.seed);
    const events: GameEvent[] = [];
    for (const cmd of commands) {
      const r = reduce(state, cmd);
      state = r.state;
      events.push(...r.events);
    }
    const rt = new MatchRuntime(state, repo, mono, wall, commands.length);
    // Catch up to the last persisted clock, then pause if it was running.
    rt.baseClock = Math.max(state.clockMs, row.clock_ms);
    rt.runningSince = null;
    repo.tx(() => repo.insertEvents(events, state.revision));
    if (isClockRunning(state.status)) {
      rt.dispatchAt({ type: 'PAUSE', reason: 'SERVER_RESTART' }, rt.baseClock);
    } else {
      rt.persistProjection();
    }
    rt.recent = repo.recentEvents(matchId, RECENT_EVENTS);
    return rt;
  }

  get matchId(): string {
    return this.state.matchId;
  }

  /** Current pause-corrected match clock. */
  nowT(): number {
    return this.runningSince === null
      ? this.baseClock
      : this.baseClock + (this.mono.now() - this.runningSince);
  }

  /** Estimated current game ms (LIVE-relative), without mutating state. */
  nowGameMs(): number {
    const s = this.state;
    if (!isClockRunning(s.status) || s.liveStartClock === null) return s.gameMs;
    return this.nowT() - s.liveStartClock;
  }

  onEvents(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  tick(): ReduceResult {
    return this.dispatch({ type: 'TICK' });
  }

  /**
   * Apply a command at the current clock. `persistExtra` runs inside the same DB
   * transaction (e.g. to record an action row), so state, command log and side
   * tables commit atomically; if anything throws, in-memory state is unchanged.
   */
  dispatch(input: CommandInput, persistExtra?: (r: ReduceResult) => void): ReduceResult {
    return this.dispatchAt(input, this.nowT(), persistExtra);
  }

  private dispatchAt(
    input: CommandInput,
    t: number,
    persistExtra?: (r: ReduceResult) => void,
  ): ReduceResult {
    const cmd = { ...input, t } as EngineCommand;
    const r = reduce(this.state, cmd);
    const isTick = cmd.type === 'TICK';
    // A refused action (no target, paused…) changes nothing but the clock, so
    // it is not logged: a stale phone mashing a button must not grow the log.
    const refused =
      cmd.type === 'ACT' && r.events.length === 0 && r.outcome.kind === 'action' && !r.outcome.result.ok;
    const logged = !isTick && !refused;
    const now = this.wall.now();
    if (logged || r.events.length > 0 || persistExtra) {
      this.repo.tx(() => {
        if (logged) this.repo.appendCommand(this.matchId, this.commandIdx, cmd, now);
        this.repo.insertEvents(r.events, r.state.revision);
        if (r.events.length > 0 || logged) this.repo.saveMatchProjection(r.state, now);
        persistExtra?.(r);
      });
      if (logged) this.commandIdx++;
    }
    this.state = r.state;
    this.syncClock();
    if (isTick && now - this.lastClockPersist > 1000) {
      this.repo.updateMatchClock(this.matchId, this.state.clockMs);
      this.lastClockPersist = now;
    }
    if (r.events.length > 0) {
      this.recent.push(...r.events);
      if (this.recent.length > RECENT_EVENTS)
        this.recent.splice(0, this.recent.length - RECENT_EVENTS);
      for (const l of this.listeners)
        l(
          r.events.map((e) => this.presentEvent(e)),
          this.state,
        );
    }
    return r;
  }

  private persistProjection(): void {
    this.repo.tx(() => this.repo.saveMatchProjection(this.state, this.wall.now()));
  }

  private syncClock(): void {
    const running = isClockRunning(this.state.status);
    if (running && this.runningSince === null) {
      this.baseClock = this.state.clockMs;
      this.runningSince = this.mono.now();
    } else if (!running && this.runningSince !== null) {
      this.baseClock = this.state.clockMs;
      this.runningSince = null;
    }
  }

  // ---- presentation -----------------------------------------------------

  setNicknameHidden(participantId: string, hidden: boolean): void {
    if (hidden) this.hidden.add(participantId);
    else this.hidden.delete(participantId);
  }

  displayName = (participantId: string, nickname: string): string =>
    this.hidden.has(participantId) ? HIDDEN_NAME : nickname;

  /** Apply nickname moderation to an event before it leaves the server. */
  presentEvent(e: GameEvent): GameEvent {
    if (e.type === 'PLAYER_ACTION' && this.hidden.has(e.data.participantId)) {
      return { ...e, data: { ...e.data, nickname: HIDDEN_NAME } };
    }
    return e;
  }

  snapshotBase() {
    const core = snapshotCore(
      this.state,
      this.recent.map((e) => this.presentEvent(e)),
      this.wall.now(),
    );
    // Report the clock "now" rather than at the last tick.
    const t = this.nowT();
    const delta = core.running ? Math.max(0, t - core.clockMs) : 0;
    return {
      ...core,
      clockMs: core.clockMs + delta,
      gameMs: core.gameMs + delta,
    };
  }
}
