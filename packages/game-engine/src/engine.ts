import type {
  ActionErrorCode,
  ActionResult,
  AlienAttack,
  Enemy,
  EnemyKind,
  EventPatch,
  GameConfig,
  GameEvent,
  Landing,
  MatchState,
  MatchStatus,
  PlayerAction,
  RegionId,
  RegionState,
  ResolvedAction,
} from '@sats-wars/shared';
import { REGION_IDS, REGION_NEIGHBORS } from '@sats-wars/shared';
import { enemyStats, isBossWave, landingsPerTurn, recommendAction, waveSize } from './rules';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Every command carries the pause-corrected match clock `t` (ms). */
export type EngineCommand =
  | { type: 'START'; t: number }
  | { type: 'TICK'; t: number }
  | {
      type: 'ACT';
      t: number;
      participantId: string;
      nickname: string;
      action: PlayerAction;
      regionId?: RegionId;
      enemyId?: number;
    }
  | { type: 'PAUSE'; t: number; reason: string }
  | { type: 'RESUME'; t: number }
  | { type: 'CANCEL'; t: number; reason: string };

export type CommandOutcome =
  | { kind: 'none' }
  | { kind: 'action'; result: ActionResult }
  | { kind: 'rejected'; reason: string };

export interface ReduceResult {
  state: MatchState;
  events: GameEvent[];
  outcome: CommandOutcome;
}

const emptyStats = () => ({ actions: 0, kills: 0, alienTurns: 0, regionsLost: 0, regionsLiberated: 0, combos: 0 });

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createMatchState(matchId: string, config: GameConfig, seed = 1): MatchState {
  const regions = {} as Record<RegionId, RegionState>;
  for (const regionId of REGION_IDS) regions[regionId] = { regionId, cityHp: config.cityHpMax, fallen: false, shield: 0 };
  return {
    matchId,
    config: structuredClone(config),
    seed,
    rng: seed >>> 0,
    status: 'CREATED',
    pausedFrom: null,
    pauseReason: null,
    clockMs: 0,
    liveStartClock: null,
    gameMs: 0,
    wave: 0,
    waveRemaining: 0,
    actionsThisTurn: 0,
    combo: 0,
    regions,
    enemies: [],
    incoming: [],
    nextEnemyId: 1,
    stats: emptyStats(),
    result: null,
    seq: 0,
    revision: 0,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer: (state, command) -> (newState, events, outcome).
 * The input is never mutated. Nothing happens with time alone: the aliens
 * move only after every `actionsPerTurn` player actions, so a quiet venue
 * simply waits for the next person. `t` is kept for the clock display and
 * for deterministic replay.
 */
export function reduce(prev: MatchState, cmd: EngineCommand): ReduceResult {
  const ctx = new Ctx(structuredClone(prev));
  advanceTo(ctx, cmd.t);
  let outcome: CommandOutcome = { kind: 'none' };
  switch (cmd.type) {
    case 'TICK':
      break;
    case 'START':
      outcome = start(ctx);
      break;
    case 'ACT':
      outcome = { kind: 'action', result: act(ctx, cmd) };
      break;
    case 'PAUSE':
      outcome = pause(ctx, cmd.reason);
      break;
    case 'RESUME':
      outcome = resume(ctx);
      break;
    case 'CANCEL':
      outcome = cancel(ctx, cmd.reason);
      break;
  }
  // Revision tracks applied events so it is identical under replay.
  ctx.state.revision = ctx.state.seq;
  return { state: ctx.state, events: ctx.events, outcome };
}

/** Replay a full command log from scratch (recovery and verification). */
export function replay(
  matchId: string,
  config: GameConfig,
  seed: number,
  commands: EngineCommand[],
): { state: MatchState; events: GameEvent[] } {
  let state = createMatchState(matchId, config, seed);
  const events: GameEvent[] = [];
  for (const cmd of commands) {
    const r = reduce(state, cmd);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

class Ctx {
  events: GameEvent[] = [];
  constructor(public state: MatchState) {}

  emit<T extends GameEvent['type']>(type: T, data: Extract<GameEvent, { type: T }>['data'], patch: EventPatch): GameEvent {
    const s = this.state;
    s.seq += 1;
    const event = {
      matchId: s.matchId,
      seq: s.seq,
      t: s.clockMs,
      gameMs: s.gameMs,
      type,
      data,
      patch: structuredClone(patch),
    } as GameEvent;
    this.events.push(event);
    return event;
  }

  /** The whole (small) board, sent with every board-changing event. */
  board(): EventPatch {
    const s = this.state;
    return {
      wave: s.wave,
      waveRemaining: s.waveRemaining,
      actionsThisTurn: s.actionsThisTurn,
      combo: s.combo,
      regions: REGION_IDS.map((id) => s.regions[id]),
      enemies: s.enemies,
      incoming: s.incoming,
      stats: s.stats,
      result: s.result,
    };
  }

  setStatus(to: MatchStatus, reason: string | null): void {
    const from = this.state.status;
    this.state.status = to;
    this.emit(
      'MATCH_STATUS_CHANGED',
      { from, to, reason },
      { status: to, pausedFrom: this.state.pausedFrom, liveStartClock: this.state.liveStartClock },
    );
  }

  /** mulberry32 step on the state's own RNG, so replays land aliens identically. */
  rand(): number {
    const s = this.state;
    s.rng = (s.rng + 0x6d2b79f5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rand() * items.length)]!;
  }
}

function advanceTo(ctx: Ctx, rawT: number): void {
  const s = ctx.state;
  const t = Math.max(s.clockMs, rawT);
  if (s.status === 'LIVE' && s.liveStartClock !== null) s.gameMs = t - s.liveStartClock;
  s.clockMs = t;
}

// ---------------------------------------------------------------------------
// Waves and landings
// ---------------------------------------------------------------------------

function newEnemy(ctx: Ctx, kind: EnemyKind, regionId: RegionId): Enemy {
  const s = ctx.state;
  const st = enemyStats(s.config, kind, s.wave);
  return { id: s.nextEnemyId++, kind, regionId, hp: st.hp, hpMax: st.hp, attack: st.attack };
}

/** Announce the next alien turn's landings (shown on screen in advance). */
function planIncoming(ctx: Ctx): void {
  const s = ctx.state;
  const c = s.config;
  const standing = REGION_IDS.filter((id) => !s.regions[id].fallen);
  const where = standing.length ? standing : REGION_IDS;
  const incoming: Landing[] = [];
  const n = Math.min(landingsPerTurn(c, s.wave), s.waveRemaining);
  for (let i = 0; i < n; i++) {
    const first = s.waveRemaining === waveSize(c, s.wave);
    const kind: EnemyKind =
      first && isBossWave(c, s.wave)
        ? 'MOTHERSHIP'
        : s.wave >= c.walkersFromWave && ctx.rand() < 0.35
          ? 'WALKER'
          : 'SCOUT';
    incoming.push({ kind, regionId: ctx.pick(where), spread: false });
    s.waveRemaining -= 1;
  }
  // Captured regions send a scout into a standing neighbour every turn.
  for (const id of REGION_IDS) {
    if (!s.regions[id].fallen) continue;
    const targets = REGION_NEIGHBORS[id].filter((n2) => !s.regions[n2].fallen);
    if (targets.length) incoming.push({ kind: 'SCOUT', regionId: ctx.pick(targets), spread: true });
  }
  s.incoming = incoming;
}

function landIncoming(ctx: Ctx): Enemy[] {
  const s = ctx.state;
  const landed = s.incoming.map((l) => newEnemy(ctx, l.kind, l.regionId));
  s.enemies.push(...landed);
  s.incoming = [];
  return landed;
}

function startWave(ctx: Ctx, wave: number): void {
  const s = ctx.state;
  s.wave = wave;
  s.waveRemaining = waveSize(s.config, wave);
  ctx.emit('WAVE_STARTED', { wave, aliens: s.waveRemaining, boss: isBossWave(s.config, wave) }, { wave, waveRemaining: s.waveRemaining });
  keepBoardBusy(ctx);
}

/**
 * Keep the game moving:
 * - A wave is cleared once all its aliens have landed and no alien is left in
 *   a standing region (occupiers of captured regions stay and keep spreading,
 *   so ignoring them is never free). Cities are repaired, the next wave starts.
 * - If the map is empty mid-wave, the next landing happens at once, so there
 *   is always something to hit.
 */
function keepBoardBusy(ctx: Ctx): void {
  const s = ctx.state;
  const inStanding = () => s.enemies.some((e) => !s.regions[e.regionId].fallen);
  const waveLandingsLeft = () => s.waveRemaining > 0 || s.incoming.some((l) => !l.spread);
  for (let guard = 0; guard < 4 && s.status === 'LIVE'; guard++) {
    if (!waveLandingsLeft() && !inStanding()) {
      const heal = s.config.waveClearHeal;
      for (const id of REGION_IDS) {
        const r = s.regions[id];
        if (!r.fallen) r.cityHp = Math.min(s.config.cityHpMax, r.cityHp + heal);
      }
      ctx.emit('WAVE_CLEARED', { wave: s.wave }, ctx.board());
      startWave(ctx, s.wave + 1);
      return;
    }
    if (s.enemies.length > 0) return;
    if (s.incoming.length === 0) planIncoming(ctx);
    const landed = landIncoming(ctx);
    planIncoming(ctx);
    ctx.emit('ALIENS_LANDED', { landed }, ctx.board());
  }
}

function alienTurn(ctx: Ctx): void {
  const s = ctx.state;
  const attacks: AlienAttack[] = [];
  const fell: RegionId[] = [];
  for (const id of REGION_IDS) {
    const r = s.regions[id];
    if (r.fallen) continue;
    const damage = s.enemies.filter((e) => e.regionId === id).reduce((a, e) => a + e.attack, 0);
    if (damage === 0) continue;
    const absorbed = Math.min(r.shield, damage);
    r.cityHp = Math.max(0, r.cityHp - (damage - absorbed));
    const didFall = r.cityHp === 0;
    if (didFall) {
      r.fallen = true;
      s.stats.regionsLost += 1;
      fell.push(id);
    }
    attacks.push({ regionId: id, damage, absorbed, cityHpAfter: r.cityHp, fell: didFall });
  }
  for (const id of REGION_IDS) s.regions[id].shield = 0;
  const landed = landIncoming(ctx);
  s.stats.alienTurns += 1;
  s.actionsThisTurn = 0;
  const japanFallen = REGION_IDS.filter((id) => s.regions[id].fallen).length >= s.config.fallLimit;
  if (!japanFallen) planIncoming(ctx);
  ctx.emit('ALIEN_TURN', { turn: s.stats.alienTurns, attacks, landed, fell }, ctx.board());
  if (japanFallen) {
    endCampaign(ctx, 'JAPAN_FALLEN');
    return;
  }
  keepBoardBusy(ctx);
}

function endCampaign(ctx: Ctx, reason: 'JAPAN_FALLEN' | 'CANCELLED', statusReason: string = reason): void {
  const s = ctx.state;
  s.result = {
    reason,
    wavesCleared: Math.max(0, s.wave - 1),
    reachedWave: s.wave,
    stats: { ...s.stats },
    endedAtGameMs: s.gameMs,
  };
  s.incoming = [];
  if (reason === 'JAPAN_FALLEN') ctx.emit('JAPAN_FALLEN', { result: s.result }, ctx.board());
  ctx.setStatus(reason === 'JAPAN_FALLEN' ? 'FINISHED' : 'CANCELLED', statusReason);
}

// ---------------------------------------------------------------------------
// Lifecycle commands
// ---------------------------------------------------------------------------

function start(ctx: Ctx): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'CREATED') return { kind: 'rejected', reason: `cannot start from ${s.status}` };
  s.liveStartClock = s.clockMs;
  s.gameMs = 0;
  ctx.setStatus('LIVE', 'CAMPAIGN_START');
  startWave(ctx, 1);
  return { kind: 'none' };
}

function pause(ctx: Ctx, reason: string): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'LIVE') return { kind: 'rejected', reason: `cannot pause from ${s.status}` };
  s.pausedFrom = s.status;
  s.pauseReason = reason;
  ctx.setStatus('PAUSED', reason);
  return { kind: 'none' };
}

function resume(ctx: Ctx): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'PAUSED' || s.pausedFrom === null) return { kind: 'rejected', reason: `cannot resume from ${s.status}` };
  const to = s.pausedFrom;
  s.pausedFrom = null;
  s.pauseReason = null;
  // The game clock does not run while paused: re-anchor so gameMs continues.
  if (s.liveStartClock !== null) s.liveStartClock = s.clockMs - s.gameMs;
  ctx.setStatus(to, 'RESUMED');
  return { kind: 'none' };
}

function cancel(ctx: Ctx, reason: string): CommandOutcome {
  const s = ctx.state;
  if (s.status === 'FINISHED' || s.status === 'CANCELLED') return { kind: 'rejected', reason: `cannot cancel from ${s.status}` };
  s.pausedFrom = null;
  endCampaign(ctx, 'CANCELLED', reason);
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// Player action
// ---------------------------------------------------------------------------

function act(ctx: Ctx, cmd: Extract<EngineCommand, { type: 'ACT' }>): ActionResult {
  const s = ctx.state;
  const c = s.config;
  const fail = (code: ActionErrorCode, action: ResolvedAction | null = null, regionId: RegionId | null = null): ActionResult => ({
    ok: false,
    code,
    action,
    regionId,
    damage: 0,
    kills: 0,
    liberated: false,
    triggeredAlienTurn: false,
    atGameMs: s.gameMs,
  });
  if (s.status === 'PAUSED') return fail('PAUSED');
  if (s.status !== 'LIVE') return fail('NOT_LIVE');

  // Resolve AUTO and missing targets to concrete choices.
  let action: ResolvedAction;
  let regionId = cmd.regionId;
  let enemyId = cmd.enemyId;
  const auto = cmd.action === 'AUTO';
  if (auto) {
    const plan = recommendAction(s);
    if (!plan) return fail('NO_TARGET');
    action = plan.action;
    regionId = plan.regionId;
    enemyId = plan.enemyId;
  } else {
    action = cmd.action as ResolvedAction;
  }
  const byId = enemyId !== undefined ? s.enemies.find((e) => e.id === enemyId) : undefined;
  if (byId) regionId = byId.regionId;
  if (regionId === undefined) {
    const plan = recommendAction(s);
    if (!plan) return fail('NO_TARGET', action);
    regionId = plan.regionId;
  }
  const region = s.regions[regionId];
  const here = s.enemies.filter((e) => e.regionId === regionId);

  let targets: Enemy[] = [];
  let perHit = 0;
  switch (action) {
    case 'RAIJIN': {
      if (here.length === 0) return fail('NO_TARGET', action, regionId);
      const killable = here.filter((e) => e.hp <= c.raijinDamage).sort((a, b) => b.attack - a.attack || a.id - b.id)[0];
      const chosen = byId && byId.regionId === regionId ? byId : (killable ?? [...here].sort((a, b) => b.attack - a.attack || a.id - b.id)[0]!);
      targets = [chosen];
      perHit = c.raijinDamage;
      break;
    }
    case 'FUJIN':
      if (here.length === 0) return fail('NO_TARGET', action, regionId);
      targets = here;
      perHit = c.fujinDamage;
      break;
    case 'COMBO':
      if (s.combo < c.comboGaugeMax) return fail('COMBO_NOT_READY', action, regionId);
      if (here.length === 0) return fail('NO_TARGET', action, regionId);
      targets = here;
      perHit = c.comboDamage;
      break;
    case 'SHIELD':
      if (region.fallen) return fail('REGION_FALLEN', action, regionId);
      if (region.shield > 0) return fail('ALREADY_SHIELDED', action, regionId);
      break;
  }

  let damage = 0;
  for (const e of targets) {
    const dealt = Math.min(e.hp, perHit);
    e.hp -= dealt;
    damage += dealt;
  }
  const dead = new Set(targets.filter((e) => e.hp <= 0).map((e) => e.id));
  s.enemies = s.enemies.filter((e) => !dead.has(e.id));
  s.stats.kills += dead.size;
  if (action === 'SHIELD') region.shield = c.shieldAbsorb;
  if (action === 'COMBO') {
    s.combo = 0;
    s.stats.combos += 1;
    if (!region.fallen) region.cityHp = Math.min(c.cityHpMax, region.cityHp + c.comboHeal);
  } else {
    s.combo = Math.min(c.comboGaugeMax, s.combo + 1);
  }
  let liberated = false;
  if (region.fallen && !s.enemies.some((e) => e.regionId === regionId)) {
    region.fallen = false;
    region.cityHp = c.liberateHp;
    s.stats.regionsLiberated += 1;
    liberated = true;
  }
  s.stats.actions += 1;
  s.actionsThisTurn += 1;

  const event = ctx.emit(
    'PLAYER_ACTION',
    {
      participantId: cmd.participantId,
      nickname: cmd.nickname,
      action,
      auto,
      regionId,
      targetIds: targets.map((e) => e.id),
      damage,
      kills: dead.size,
      liberated,
    },
    ctx.board(),
  );
  const result: ActionResult = {
    ok: true,
    code: 'OK',
    action,
    regionId,
    damage,
    kills: dead.size,
    liberated,
    triggeredAlienTurn: false,
    atGameMs: s.gameMs,
    eventSeq: event.seq,
  };
  if (s.actionsThisTurn >= c.actionsPerTurn) {
    result.triggeredAlienTurn = true;
    alienTurn(ctx);
  } else {
    keepBoardBusy(ctx);
  }
  return result;
}
