import { randomUUID } from 'node:crypto';
import {
  advanceTo,
  botDecide,
  createMatch,
  isRoundOver,
  reduce,
  toPublicState,
  type BotMemory,
  type EngineCommand,
  type ReduceResult,
} from '@swed/game-engine';
import { isSeatOpen, PRESETS, SEAT_IDS, SEATS } from '@swed/shared';
import type {
  ActionResult,
  MatchEvent,
  MatchEventMsg,
  MatchSnapshotMsg,
  MatchState,
  PilotActionReq,
  PresetId,
  SeatId,
  SeatRequestResult,
} from '@swed/shared';
import type { Db } from './db';
import { audit, nowIso, tx } from './db';
import type { PilotRow } from './sessions';

/**
 * Owns the one live match. Simulation ticks at 20 Hz on a pause-corrected clock; public
 * snapshots go out at 10 Hz (sooner right after a command); confirmed events go out
 * immediately. Running several displays never runs several games: they all watch this.
 */

export const TICK_MS = 50;
const SNAPSHOT_MS = 100;
/** Demo bots act about three times a second, like attentive people. */
const BOT_EVERY_MS = 300;
/** Demo mode starts a sortie when the lobby has been quiet this long. */
const DEMO_IDLE_START_MS = 12_000;

/** Monotonic match clock that stops while the operator has the match paused. */
export class MatchClock {
  private readonly base: number;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  constructor(private readonly source: () => number) {
    this.base = source();
  }
  now(): number {
    const s = this.pausedAt ?? this.source();
    return Math.max(0, Math.floor(s - this.base - this.pausedTotal));
  }
  pause(): void {
    if (this.pausedAt === null) this.pausedAt = this.source();
  }
  resume(): void {
    if (this.pausedAt !== null) {
      this.pausedTotal += this.source() - this.pausedAt;
      this.pausedAt = null;
    }
  }
}

export interface RuntimeHooks {
  events(msgs: MatchEventMsg[]): void;
  snapshot(msg: MatchSnapshotMsg): void;
  /** A new match replaced the old one (round over, reset, preset change). */
  matchReplaced?(msg: MatchSnapshotMsg): void;
}

export interface RuntimeDeps {
  db: Db;
  hooks: RuntimeHooks;
  presetId: PresetId;
  /** Monotonic ms source (performance.now in production, manual in tests). */
  source?: () => number;
  seed?: () => number;
  log?: { info: (o: object, msg?: string) => void; warn: (o: object, msg?: string) => void };
}

type CommandInput = EngineCommand extends infer C
  ? C extends { t: number }
    ? Omit<C, 't'>
    : never
  : never;

export class MatchRuntime {
  state!: MatchState;
  clock!: MatchClock;
  nextPresetId: PresetId;
  autoSupportDefault = true;
  private matchNumber = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastSnapshotAt = -Infinity;
  private urgent = false;
  private recordedResult = false;
  private readonly source: () => number;
  private readonly seed: () => number;
  private readonly row: ReturnType<Db['prepare']>;
  demoBots = false;
  private botMemory = new Map<SeatId, BotMemory>();
  private lastBotAt = -Infinity;
  private lobbyQuietSince = 0;
  private botActionSeq = 0;

  constructor(private readonly deps: RuntimeDeps) {
    this.source = deps.source ?? (() => performance.now());
    this.seed = deps.seed ?? (() => Math.floor(Math.random() * 2 ** 32));
    this.nextPresetId = deps.presetId;
    this.row = this.deps.db.prepare(
      `INSERT INTO matches (id, match_number, preset_id, config_hash, seed, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.openMatch({ attract: true });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* ---------------------------------------------------------------- core */

  snapshotMsg(): MatchSnapshotMsg {
    const state = toPublicState(this.state);
    return {
      matchId: this.state.matchId,
      phase: this.state.phase,
      version: this.state.version,
      serverTime: this.state.t,
      state,
    };
  }

  tick(): void {
    const r = advanceTo(this.state, this.clock.now());
    this.commit(r.state, r.events);
    if (isRoundOver(this.state)) {
      this.replaceMatch('ROUND_OVER', { attract: true });
      return;
    }
    if (this.demoBots) this.runDemoBots();
    const now = this.source();
    if (this.urgent || now - this.lastSnapshotAt >= SNAPSHOT_MS) {
      this.urgent = false;
      this.lastSnapshotAt = now;
      this.deps.hooks.snapshot(this.snapshotMsg());
    }
  }

  /** Applies one engine command at the current match time. */
  command(input: CommandInput): ReduceResult {
    const t = this.clock.now();
    const r = reduce(this.state, { ...input, t } as EngineCommand);
    if (r.outcome.kind === 'control' && r.outcome.ok) {
      if (input.type === 'PAUSE') this.clock.pause();
      if (input.type === 'RESUME') this.clock.resume();
    }
    this.commit(r.state, r.events);
    // Push at once only when something happened; a refused tap waits for the 10 Hz snapshot,
    // so a crowd mashing buttons cannot double the screens' snapshot rate.
    if (r.events.length > 0) this.urgent = true;
    return r;
  }

  private commit(state: MatchState, events: MatchEvent[]): void {
    this.state = state;
    if (events.length === 0) return;
    this.persistMilestones(events);
    this.deps.hooks.events(
      events.map((e) => ({
        eventId: `${state.matchId}:${e.seq}`,
        matchId: state.matchId,
        seq: e.seq,
        serverTime: e.t,
        type: e.type,
        payload: e,
      })),
    );
  }

  private persistMilestones(events: MatchEvent[]): void {
    const db = this.deps.db;
    for (const e of events) {
      if (e.type === 'phase_changed' && e.to === 'WAVE_1') {
        db.prepare('UPDATE matches SET started_at = ?, crew = ? WHERE id = ?').run(
          nowIso(),
          this.state.crewAtLaunch,
          this.state.matchId,
        );
      }
      if (e.type === 'match_result' && !this.recordedResult) {
        this.recordedResult = true;
        this.recordResult(e.result.outcome, e.result.reason);
      }
    }
  }

  private recordResult(outcome: string, reason: string): void {
    const s = this.state;
    const db = this.deps.db;
    tx(db, () => {
      db.prepare(
        'UPDATE matches SET ended_at = ?, outcome = ?, reason = ?, stats_json = ? WHERE id = ?',
      ).run(nowIso(), outcome, reason, JSON.stringify(s.stats), s.matchId);
      for (const id of SEAT_IDS) {
        const seat = s.seats[id];
        if (!seat.pilotId) continue;
        db.prepare(
          `INSERT OR REPLACE INTO match_seats (match_id, seat_id, pilot_id, display_name, stats_json)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(s.matchId, id, seat.pilotId, seat.displayName ?? '', JSON.stringify(seat.stats));
      }
    });
    this.deps.log?.info({ matchId: s.matchId, outcome, reason, stats: s.stats }, 'match finished');
  }

  /* -------------------------------------------------------------- matches */

  private openMatch(opts: { attract: boolean }): void {
    this.matchNumber += 1;
    const seed = this.seed() >>> 0;
    this.state = createMatch({
      matchId: `m_${randomUUID().slice(0, 13)}`,
      matchNumber: this.matchNumber,
      config: PRESETS[this.nextPresetId],
      seed,
      autoSupport: this.autoSupportDefault,
      attract: opts.attract,
    });
    this.clock = new MatchClock(this.source);
    this.recordedResult = false;
    this.row.run(
      this.state.matchId,
      this.matchNumber,
      this.state.presetId,
      this.state.configHash,
      seed,
      nowIso(),
    );
  }

  /** Ends the current match (recording an abort if it never finished) and opens the next. */
  replaceMatch(
    reason: 'ROUND_OVER' | 'RESET' | 'NEXT_ROUND' | 'PRESET',
    opts: { attract: boolean; keepSeats?: boolean },
  ) {
    const old = this.state;
    if (!old.result && old.phase !== 'ATTRACT' && old.phase !== 'LOBBY') {
      this.deps.db
        .prepare("UPDATE matches SET ended_at = ?, outcome = 'ABORTED', reason = ? WHERE id = ?")
        .run(nowIso(), reason, old.matchId);
    }
    this.openMatch(opts);
    if (opts.keepSeats) {
      for (const id of SEAT_IDS) {
        const seat = old.seats[id];
        if (!seat.pilotId) continue;
        this.command({
          type: 'SEAT_JOIN',
          seatId: id,
          pilotId: seat.pilotId,
          displayName: seat.displayName ?? '',
          bot: seat.bot,
        });
        if (!seat.connected)
          this.command({ type: 'SEAT_CONNECTION', pilotId: seat.pilotId, connected: false });
        if (seat.ready) this.command({ type: 'SEAT_READY', pilotId: seat.pilotId });
      }
    }
    this.deps.log?.info({ reason, matchId: this.state.matchId }, 'match opened');
    const snap = this.snapshotMsg();
    this.lastSnapshotAt = this.source();
    this.deps.hooks.matchReplaced?.(snap);
    this.deps.hooks.snapshot(snap);
  }

  /* --------------------------------------------------------------- pilots */

  seatOf(pilotId: string): SeatId | null {
    return SEAT_IDS.find((id) => this.state.seats[id].pilotId === pilotId) ?? null;
  }

  joinSeat(
    pilot: PilotRow,
    matchId: string,
    seatId: SeatId,
    displayName: string,
  ): SeatRequestResult {
    if (matchId !== this.state.matchId) return { ok: false, reasonCode: 'STALE_MATCH' };
    const r = this.command({ type: 'SEAT_JOIN', seatId, pilotId: pilot.id, displayName });
    this.lobbyQuietSince = this.source();
    return r.outcome.kind === 'seat' ? r.outcome.result : { ok: false, reasonCode: 'INVALID' };
  }

  rename(pilotId: string, displayName: string): void {
    const seat = this.seatOf(pilotId);
    if (seat) this.command({ type: 'SEAT_RENAME', seatId: seat, displayName });
  }

  /** Applies a settled energy pulse to the live match; false if the engine refused it. */
  applyPulse(
    intentId: string,
    seatId: string | null,
    virtual: boolean,
    settleMs: number | null = null,
  ): boolean {
    const seat = SEAT_IDS.find((s) => s === seatId) ?? null;
    const r = this.command({ type: 'SATS_PULSE', intentId, seatId: seat, virtual, settleMs });
    return r.outcome.kind === 'control' && r.outcome.ok;
  }

  /* ------------------------------------------------------------ demo bots */

  setDemoBots(enabled: boolean): void {
    this.demoBots = enabled;
    this.lobbyQuietSince = this.source();
    if (!enabled) {
      for (const id of SEAT_IDS) {
        if (this.state.seats[id].bot) this.command({ type: 'SEAT_KICK', seatId: id });
      }
    }
  }

  /**
   * Exhibition loop: labelled bots fill empty seats before a sortie, start it after a quiet
   * lobby, and play with the same raw intents a phone sends. People can take any bot seat.
   */
  private runDemoBots(): void {
    const s = this.state;
    const now = this.source();
    if (s.phase === 'ATTRACT' || s.phase === 'LOBBY') {
      SEAT_IDS.forEach((id) => {
        if (!s.seats[id].pilotId && isSeatOpen(s.config, id)) {
          this.command({
            type: 'SEAT_JOIN',
            seatId: id,
            pilotId: `bot:${id}`,
            displayName: `DEMO-BOT ${SEATS[id].no}`,
            bot: true,
          });
          this.command({ type: 'SEAT_READY', pilotId: `bot:${id}` });
          this.botMemory.set(id, {});
        }
      });
      if (now - this.lobbyQuietSince >= DEMO_IDLE_START_MS) {
        this.command({ type: 'START' });
        this.lobbyQuietSince = now;
      }
      return;
    }
    if (now - this.lastBotAt < BOT_EVERY_MS) return;
    this.lastBotAt = now;
    const pub = toPublicState(this.state);
    for (const id of SEAT_IDS) {
      const seat = this.state.seats[id];
      if (!seat.bot || !seat.pilotId) continue;
      const action = botDecide(pub, id, this.state.t, 0.85, this.botMemory.get(id) ?? {});
      if (!action) continue;
      this.botActionSeq += 1;
      this.command({
        type: 'PILOT_ACTION',
        pilotId: seat.pilotId,
        seatId: id,
        clientActionId: `demo-${this.state.matchId}-${this.botActionSeq}`,
        action,
      });
    }
  }

  ready(pilot: PilotRow, matchId: string): SeatRequestResult {
    if (matchId !== this.state.matchId) return { ok: false, reasonCode: 'STALE_MATCH' };
    const r = this.command({ type: 'SEAT_READY', pilotId: pilot.id });
    return r.outcome.kind === 'seat' ? r.outcome.result : { ok: false, reasonCode: 'INVALID' };
  }

  leave(pilot: PilotRow, matchId: string): SeatRequestResult {
    if (matchId !== this.state.matchId) return { ok: true, seatId: null };
    this.command({ type: 'SEAT_LEAVE', pilotId: pilot.id });
    return { ok: true, seatId: null };
  }

  connection(pilotId: string, connected: boolean): void {
    if (this.seatOf(pilotId)) this.command({ type: 'SEAT_CONNECTION', pilotId, connected });
  }

  pilotAction(pilot: PilotRow, req: PilotActionReq): ActionResult {
    if (req.matchId !== this.state.matchId) {
      return { clientActionId: req.clientActionId, accepted: false, reasonCode: 'STALE_MATCH' };
    }
    // Idempotency keys are namespaced per pilot: nobody can replay another pilot's key.
    const engineKey = `${pilot.id}:${req.clientActionId}`;
    const r = this.command({
      type: 'PILOT_ACTION',
      pilotId: pilot.id,
      seatId: req.seatId,
      clientActionId: engineKey,
      action: req.action,
    });
    if (r.outcome.kind !== 'action') {
      return { clientActionId: req.clientActionId, accepted: false, reasonCode: 'INVALID' };
    }
    const res = r.outcome.result;
    this.deps.db
      .prepare(
        `INSERT OR IGNORE INTO action_events
           (match_id, t, pilot_id, seat_id, client_action_id, action_type, accepted, reason, state_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.state.matchId,
        this.state.t,
        pilot.id,
        req.seatId,
        req.clientActionId,
        req.action.actionType,
        res.accepted ? 1 : 0,
        res.reasonCode ?? null,
        this.state.version,
        nowIso(),
      );
    return { ...res, clientActionId: req.clientActionId };
  }

  /* ------------------------------------------------------------- operator */

  setPreset(presetId: Exclude<PresetId, 'TEST'>): string {
    this.nextPresetId = presetId;
    if (this.state.phase === 'ATTRACT' || this.state.phase === 'LOBBY') {
      this.replaceMatch('PRESET', { attract: this.state.phase === 'ATTRACT', keepSeats: true });
      return `preset ${presetId} applied now`;
    }
    return `preset ${presetId} applies from the next round`;
  }

  setAutoSupport(enabled: boolean): void {
    this.autoSupportDefault = enabled;
    this.command({ type: 'SET_AUTO_SUPPORT', enabled });
  }

  audit(actor: string, action: string, detail = ''): void {
    audit(this.deps.db, actor, action, detail);
  }
}
