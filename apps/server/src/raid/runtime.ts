import type { GameConfig, GameEvent, RaidState } from '@sats-wars/shared';
import { isClockRunning } from '@sats-wars/shared';
import {
  type EngineCommand,
  type ReduceResult,
  createRaidState,
  reduce,
  snapshotCore,
} from '@sats-wars/game-engine';
import type { MonoClock, WallClock } from '../clock';
import type { Repo } from '../db/repo';
import { moderateNames } from './names';

/** Distributive Omit so each command variant keeps its own fields. */
export type CommandInput = EngineCommand extends infer C
  ? C extends EngineCommand
    ? Omit<C, 't'>
    : never
  : never;

export type RuntimeListener = (events: GameEvent[], state: RaidState) => void;

const RECENT_EVENTS = 30;

/** What the venue screen may show for a pilot. */
export interface NamePolicy {
  /** Pilot chose to show their callsign on the venue screen. */
  show: boolean;
  /** Operators hid this pilot's name. */
  hidden: boolean;
  /** Pseudonym shown otherwise (e.g. PILOT-00821). */
  pseudonym: string;
}

/**
 * Owns one raid: engine state, the pause-corrected raid clock, persistence of
 * the command log/events, and fan-out to listeners. All mutations go through
 * dispatch(), which is synchronous, so commands are strictly serialized.
 */
export class RaidRuntime {
  private baseClock = 0;
  private runningSince: number | null = null;
  private commandIdx: number;
  private listeners = new Set<RuntimeListener>();
  private recent: GameEvent[];
  private names = new Map<string, NamePolicy>();
  private lastClockPersist = 0;
  /** Global switch: hide every pilot name on public screens. */
  namesHidden = false;
  /** Number of demo bot pilots that flew (bots never enter leaderboards). */
  botsAboard = 0;

  private constructor(
    public state: RaidState,
    private repo: Repo,
    private mono: MonoClock,
    private wall: WallClock,
    commandIdx: number,
  ) {
    this.commandIdx = commandIdx;
    this.recent = repo.recentEvents(state.raidId, RECENT_EVENTS);
    this.baseClock = state.clockMs;
    this.syncClock();
  }

  static create(
    repo: Repo,
    raidId: string,
    eventId: string,
    config: GameConfig,
    seed: number,
    mono: MonoClock,
    wall: WallClock,
  ): RaidRuntime {
    const state = createRaidState(raidId, config, seed);
    repo.tx(() => {
      repo.insertRaid(raidId, eventId, config, state.configHash, seed, wall.now());
      repo.saveRaidProjection(state, wall.now());
    });
    return new RaidRuntime(state, repo, mono, wall, 0);
  }

  /**
   * Rebuild from the command log after a restart. A raid that was running is
   * put into PAUSED (reason SERVER_RESTART); the manager may auto-resume it.
   */
  static recover(repo: Repo, raidId: string, mono: MonoClock, wall: WallClock): RaidRuntime {
    const row = repo.getRaid(raidId);
    if (!row) throw new Error(`raid ${raidId} not found`);
    const config = JSON.parse(row.config_json) as GameConfig;
    const commands = repo.loadCommands(raidId);
    let state = createRaidState(raidId, config, row.seed);
    const events: GameEvent[] = [];
    for (const cmd of commands) {
      const r = reduce(state, cmd);
      state = r.state;
      events.push(...r.events);
    }
    const rt = new RaidRuntime(state, repo, mono, wall, commands.length);
    rt.botsAboard = row.bots;
    rt.baseClock = Math.max(state.clockMs, row.clock_ms);
    rt.runningSince = null;
    repo.tx(() => repo.insertEvents(events, state.revision));
    if (isClockRunning(state.status))
      rt.dispatchAt({ type: 'PAUSE', reason: 'SERVER_RESTART' }, rt.baseClock);
    else rt.persistProjection();
    rt.recent = repo.recentEvents(raidId, RECENT_EVENTS);
    return rt;
  }

  get raidId(): string {
    return this.state.raidId;
  }

  /** Current pause-corrected raid clock. */
  nowT(): number {
    return this.runningSince === null
      ? this.baseClock
      : this.baseClock + (this.mono.now() - this.runningSince);
  }

  /** Estimated current game ms, without mutating state. */
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
   * Apply a command at the current clock. `persistExtra` runs inside the same
   * DB transaction (e.g. to store an idempotent submission), so state, command
   * log and side tables commit atomically; if anything throws, in-memory state
   * is unchanged.
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
    // Commands that changed nothing (refused task requests, duplicate boards…)
    // are not logged: a phone mashing a button must not grow the log. Replay
    // equivalence holds because a refused command only advanced the clock,
    // which the next logged command does anyway.
    const prev = this.state;
    const changed =
      r.events.length > 0 ||
      r.state.rng !== prev.rng ||
      r.state.nextId !== prev.nextId ||
      JSON.stringify(r.state.pilots) !== JSON.stringify(prev.pilots);
    const isTick = cmd.type === 'TICK';
    const logged = !isTick && (changed || cmd.type === 'PAUSE' || cmd.type === 'RESUME');
    const now = this.wall.now();
    if (logged || r.events.length > 0 || persistExtra) {
      this.repo.tx(() => {
        if (logged) this.repo.appendCommand(this.raidId, this.commandIdx, cmd, now);
        this.repo.insertEvents(r.events, r.state.revision);
        if (r.events.length > 0 || logged)
          this.repo.saveRaidProjection(r.state, now, undefined, this.botsAboard);
        persistExtra?.(r);
      });
      if (logged) this.commandIdx++;
    }
    this.state = r.state;
    this.syncClock();
    if (isTick && now - this.lastClockPersist > 1000) {
      this.repo.updateRaidClock(this.raidId, this.state.clockMs);
      this.lastClockPersist = now;
    }
    if (r.events.length > 0) {
      this.recent.push(...r.events);
      if (this.recent.length > RECENT_EVENTS)
        this.recent.splice(0, this.recent.length - RECENT_EVENTS);
      const shown = r.events.map((e) => this.presentEvent(e));
      for (const l of this.listeners) l(shown, this.state);
    }
    return r;
  }

  persistProjection(finalSnapshot?: unknown): void {
    this.repo.tx(() =>
      this.repo.saveRaidProjection(this.state, this.wall.now(), finalSnapshot, this.botsAboard),
    );
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

  // ---- presentation (moderation & consent) ---------------------------------

  setNamePolicy(pilotId: string, policy: NamePolicy): void {
    this.names.set(pilotId, policy);
  }

  /** Public name: the callsign only with the pilot's consent and not hidden. */
  displayName = (pilotId: string, callsign: string): string => {
    const p = this.names.get(pilotId);
    if (!p) return callsign; // bots / assist AI
    if (this.namesHidden || p.hidden || !p.show) return p.pseudonym;
    return callsign;
  };

  /** Public names everywhere in an event (data, crew, MVPs in a result). */
  presentEvent(e: GameEvent): GameEvent {
    return moderateNames(e, this.displayName);
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
      crew: moderateNames(core.crew, this.displayName),
      result: moderateNames(core.result, this.displayName),
      clockMs: core.clockMs + delta,
      gameMs: core.gameMs + delta,
    };
  }
}
