import { randomUUID } from 'node:crypto';
import {
  advanceTo,
  botChoose,
  countedPlayers,
  createMatch,
  isRoundOver,
  reduce,
  toPublicState,
  type EngineCommand,
  type ReduceResult,
} from '@swed/game-engine';
import { PRESETS } from '@swed/shared';
import type {
  ActionKind,
  ActionResult,
  MatchEvent,
  MatchEventMsg,
  MatchSnapshotMsg,
  MatchState,
  PilotActionReq,
  PresetId,
} from '@swed/shared';
import type { Db } from './db';
import { audit, nowIso, tx } from './db';
import type { PilotRow } from './sessions';

/**
 * Owns the one live match (D-033 crowd raid). Simulation ticks at 20 Hz on a pause-corrected
 * clock; public snapshots go out at 10 Hz (sooner right after something happened); confirmed
 * events go out immediately. Several displays never run several games: they all watch this.
 */

export const TICK_MS = 50;
const SNAPSHOT_MS = 100;

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
  /** Randomness for demo bots only (never for rules). */
  random?: () => number;
  log?: { info: (o: object, msg?: string) => void; warn: (o: object, msg?: string) => void };
}

type CommandInput = EngineCommand extends infer C
  ? C extends { t: number }
    ? Omit<C, 't'>
    : never
  : never;

interface BotState {
  pilotId: string;
  nextTapAt: number;
}

export class MatchRuntime {
  state!: MatchState;
  clock!: MatchClock;
  nextPresetId: PresetId;
  autoStart = true;
  demoBots = false;
  private matchNumber = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastSnapshotAt = -Infinity;
  private urgent = false;
  private recordedResult = false;
  private readonly source: () => number;
  private readonly seed: () => number;
  private readonly random: () => number;
  private readonly insertMatch: ReturnType<Db['prepare']>;
  private readonly insertAction: ReturnType<Db['prepare']>;
  private bots: BotState[] = [];
  private botSeq = 0;
  private lastBotTick = 0;
  /** The match the bot timers belong to: a new match restarts its clock near zero. */
  private botMatchId = '';

  constructor(private readonly deps: RuntimeDeps) {
    this.source = deps.source ?? (() => performance.now());
    this.seed = deps.seed ?? (() => Math.floor(Math.random() * 2 ** 32));
    this.random = deps.random ?? Math.random;
    this.nextPresetId = deps.presetId;
    this.insertMatch = deps.db.prepare(
      `INSERT INTO matches (id, match_number, preset_id, config_hash, seed, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.insertAction = deps.db.prepare(
      `INSERT OR IGNORE INTO action_events
         (match_id, t, pilot_id, seat_id, client_action_id, action_type, accepted, reason, state_version, created_at)
       VALUES (?, ?, ?, 'CROWD', ?, ?, ?, ?, ?, ?)`,
    );
    this.openMatch();
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
    return {
      matchId: this.state.matchId,
      phase: this.state.phase,
      version: this.state.version,
      serverTime: this.state.t,
      state: toPublicState(this.state),
    };
  }

  tick(): void {
    const r = advanceTo(this.state, this.clock.now());
    this.commit(r.state, r.events);
    if (isRoundOver(this.state)) {
      this.replaceMatch('ROUND_OVER');
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
    // Push at once only when something happened; a crowd mashing buttons is batched by the
    // engine and goes out with the 10 Hz snapshot.
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
    for (const e of events) {
      if (e.type === 'phase_changed' && e.to === 'BATTLE') {
        this.deps.db
          .prepare('UPDATE matches SET started_at = ?, crew = ? WHERE id = ?')
          .run(nowIso(), this.state.playersAtLaunch, this.state.matchId);
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
      const ins = db.prepare(
        `INSERT OR REPLACE INTO match_players (match_id, pilot_id, display_name, stats_json)
         VALUES (?, ?, ?, ?)`,
      );
      for (const p of Object.values(s.players)) {
        if (p.bot) continue;
        ins.run(s.matchId, p.pilotId, p.displayName, JSON.stringify(p.stats));
      }
    });
    this.deps.log?.info({ matchId: s.matchId, outcome, reason, stats: s.stats }, 'match finished');
  }

  /* -------------------------------------------------------------- matches */

  private openMatch(): void {
    this.matchNumber += 1;
    const seed = this.seed() >>> 0;
    this.state = createMatch({
      matchId: `m_${randomUUID().slice(0, 13)}`,
      matchNumber: this.matchNumber,
      config: PRESETS[this.nextPresetId],
      seed,
      autoStart: this.autoStart,
    });
    this.clock = new MatchClock(this.source);
    this.recordedResult = false;
    this.insertMatch.run(
      this.state.matchId,
      this.matchNumber,
      this.state.presetId,
      this.state.configHash,
      seed,
      nowIso(),
    );
  }

  /**
   * Ends the current match (recording an abort if it never finished) and opens the next.
   * Phones still connected stay in: they play the next round without scanning again.
   */
  replaceMatch(reason: 'ROUND_OVER' | 'RESET' | 'NEXT_ROUND' | 'PRESET') {
    const old = this.state;
    if (!old.result && old.phase !== 'LOBBY') {
      this.deps.db
        .prepare("UPDATE matches SET ended_at = ?, outcome = 'ABORTED', reason = ? WHERE id = ?")
        .run(nowIso(), reason, old.matchId);
    }
    this.openMatch();
    for (const p of Object.values(old.players)) {
      if (!p.connected) continue;
      this.command({
        type: 'PLAYER_JOIN',
        pilotId: p.pilotId,
        displayName: p.displayName,
        bot: p.bot,
      });
    }
    this.deps.log?.info({ reason, matchId: this.state.matchId }, 'match opened');
    const snap = this.snapshotMsg();
    this.lastSnapshotAt = this.source();
    this.deps.hooks.matchReplaced?.(snap);
    this.deps.hooks.snapshot(snap);
  }

  /* --------------------------------------------------------------- players */

  isJoined(pilotId: string): boolean {
    return !!this.state.players[pilotId];
  }

  /** A phone connected: it is in the crowd for this match (no seats, no limit). */
  connect(pilot: PilotRow, displayName: string): void {
    this.command({ type: 'PLAYER_JOIN', pilotId: pilot.id, displayName });
  }

  disconnect(pilotId: string): void {
    if (this.isJoined(pilotId))
      this.command({ type: 'PLAYER_CONNECTION', pilotId, connected: false });
  }

  leave(pilotId: string): void {
    this.command({ type: 'PLAYER_LEAVE', pilotId });
  }

  rename(pilotId: string, displayName: string): void {
    if (this.isJoined(pilotId)) this.command({ type: 'PLAYER_RENAME', pilotId, displayName });
  }

  pilotAction(pilot: PilotRow, req: PilotActionReq): ActionResult {
    if (req.matchId !== this.state.matchId) {
      return { clientActionId: req.clientActionId, accepted: false, reasonCode: 'STALE_MATCH' };
    }
    // Idempotency keys are namespaced per pilot: nobody can replay another pilot's key.
    const engineKey = `${pilot.id}:${req.clientActionId}`;
    const r = this.command({
      type: 'ACTION',
      pilotId: pilot.id,
      clientActionId: engineKey,
      kind: req.action.kind,
    });
    if (r.outcome.kind !== 'action') {
      return { clientActionId: req.clientActionId, accepted: false, reasonCode: 'INVALID' };
    }
    const res = r.outcome.result;
    // Cooldown refusals are the crowd mashing: not worth a row each.
    if (res.reasonCode !== 'COOLDOWN') {
      this.insertAction.run(
        this.state.matchId,
        this.state.t,
        pilot.id,
        req.clientActionId,
        req.action.kind,
        res.accepted ? 1 : 0,
        res.reasonCode ?? null,
        this.state.version,
        nowIso(),
      );
    }
    return { ...res, clientActionId: req.clientActionId };
  }

  /** Applies a settled Lightning action to the live match; false if the engine refused it. */
  applyPaid(
    intentId: string,
    pilotId: string | null,
    kind: ActionKind,
    virtual: boolean,
    settleMs: number | null = null,
  ): boolean {
    const r = this.command({ type: 'PAID_ACTION', intentId, pilotId, kind, virtual, settleMs });
    return r.outcome.kind === 'control' && r.outcome.ok;
  }

  /* ------------------------------------------------------------ demo bots */

  setDemoBots(enabled: boolean): void {
    this.demoBots = enabled;
    if (!enabled) {
      for (const b of this.bots) this.command({ type: 'PLAYER_LEAVE', pilotId: b.pilotId });
      this.bots = [];
    }
  }

  /**
   * Exhibition loop: labelled bots join the crowd and press what the big screen recommends.
   * Now and then one sends a VIRTUAL Lightning action (labelled DEMO), so the hall sees what
   * 21 sats does before anyone pays.
   */
  private runDemoBots(): void {
    const s = this.state;
    const c = s.config.bots;
    const now = this.state.t;
    while (this.bots.length < c.count) {
      const n = this.bots.length + 1;
      const pilotId = `bot:${n}`;
      this.bots.push({ pilotId, nextTapAt: 0 });
    }
    for (const b of this.bots) {
      if (!s.players[b.pilotId]) {
        this.command({
          type: 'PLAYER_JOIN',
          pilotId: b.pilotId,
          displayName: `DEMO-BOT ${b.pilotId.slice(4)}`,
          bot: true,
        });
      }
    }
    if (this.botMatchId !== s.matchId) {
      // Timers from the previous match are in its clock; kept, the bots would sit idle for as
      // long as that match ran (seen after RESET with bots left on).
      this.botMatchId = s.matchId;
      this.lastBotTick = now;
      for (const b of this.bots) b.nextTapAt = 0;
    }
    if (this.state.phase !== 'BATTLE' || this.state.paused) return;
    const dt = Math.max(0, now - this.lastBotTick) / 1000;
    this.lastBotTick = now;
    let pub = null;
    for (const b of this.bots) {
      if (b.nextTapAt > now) continue;
      b.nextTapAt = now + c.tapMinMs + this.random() * (c.tapMaxMs - c.tapMinMs);
      pub ??= toPublicState(this.state);
      const kind = botChoose(pub, this.random(), 0.8);
      this.botSeq += 1;
      this.command({
        type: 'ACTION',
        pilotId: b.pilotId,
        clientActionId: `demo-${this.state.matchId}-${this.botSeq}`,
        kind,
      });
    }
    if (dt > 0 && this.random() < c.paidChancePerSec * dt * this.bots.length) {
      this.botSeq += 1;
      this.command({
        type: 'PAID_ACTION',
        intentId: `demo-${this.state.matchId}-${this.botSeq}`,
        pilotId: null,
        kind: botChoose(toPublicState(this.state), 0, 1),
        virtual: true,
        bot: true,
        settleMs: null,
      });
    }
  }

  /* ------------------------------------------------------------- operator */

  setPreset(presetId: Exclude<PresetId, 'TEST'>): string {
    this.nextPresetId = presetId;
    if (this.state.phase === 'LOBBY') {
      this.replaceMatch('PRESET');
      return `preset ${presetId} applied now`;
    }
    return `preset ${presetId} applies from the next round`;
  }

  setAutoStart(enabled: boolean): void {
    this.autoStart = enabled;
    this.command({ type: 'SET_AUTO_START', enabled });
  }

  /** People (not bots) counted right now. */
  humans(): number {
    return countedPlayers(this.state).filter((p) => !p.bot).length;
  }

  audit(actor: string, action: string, detail = ''): void {
    audit(this.deps.db, actor, action, detail);
  }
}
