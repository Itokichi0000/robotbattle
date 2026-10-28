import type { Direction, EnergySink, RouterNode, TaskDifficulty, TaskInput, TaskParams } from '@sats-wars/shared';
import { DIRECTIONS, ENERGY_SINKS } from '@sats-wars/shared';

/**
 * The four cockpit minigames. Parameters come from the raid's seeded RNG and
 * the server scores the pilot's raw input (where they stopped, which path they
 * drew...) — never a score the client claims. A client can still be scripted
 * (no anti-cheat is perfect); per-seat cooldowns and crowd normalisation cap
 * what any one pilot can do.
 */

export type Rand = () => number;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 0→1→0 sweep used by the GUNNER reticle. */
export function triangle(u: number): number {
  const f = ((u % 1) + 1) % 1;
  return f < 0.5 ? f * 2 : 2 - f * 2;
}

/** GUNNER reticle position (0..1) `ms` after the minigame started. Display uses the same function. */
export function reticleAt(p: Extract<TaskParams, { role: 'GUNNER' }>, ms: number): number {
  return triangle(ms / p.periodMs + p.phase);
}

/** GUARDIAN charge gauge (0..1, wraps) `ms` after the minigame started. */
export function gaugeAt(p: Extract<TaskParams, { role: 'GUARDIAN' }>, ms: number): number {
  return (((ms / p.periodMs) % 1) + 1) % 1;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function gunnerParams(rand: Rand, difficulty: TaskDifficulty, assistWidth = 1): TaskParams {
  const easy = difficulty === 'EASY';
  return {
    role: 'GUNNER',
    periodMs: Math.round((easy ? 2600 : 1800) + rand() * 700),
    phase: round2(rand()),
    ringCenter: round2(0.2 + rand() * 0.6),
    ringWidth: round2((easy ? 0.22 : 0.13) * assistWidth),
  };
}

export function guardianParams(rand: Rand, difficulty: TaskDifficulty, direction: Direction): TaskParams {
  const easy = difficulty === 'EASY';
  const width = easy ? 0.3 : 0.18;
  const from = round2(0.45 + rand() * (0.5 - width));
  return { role: 'GUARDIAN', direction, periodMs: Math.round((easy ? 2400 : 1700) + rand() * 500), greenFrom: from, greenTo: round2(from + width) };
}

/**
 * Energy routing puzzle inspired by payment routing (an abstraction, not a
 * Lightning simulation): connect the source to a robot or the reserve through
 * relays, avoiding blocked nodes, within `maxHops` links.
 * EASY: 3 nodes (source → relay → sink). NORMAL: 7 nodes (+1 blocked node when jammed).
 */
export function routerParams(rand: Rand, difficulty: TaskDifficulty, suggested: EnergySink, jammed: boolean): TaskParams {
  const nodes: RouterNode[] = [{ id: 0, x: 0.08, y: 0.5, kind: 'SOURCE' }];
  const edges: Array<[number, number]> = [];
  if (difficulty === 'EASY') {
    nodes.push({ id: 1, x: 0.5, y: 0.35 + rand() * 0.3, kind: 'RELAY' });
    nodes.push({ id: 2, x: 0.92, y: 0.5, kind: 'SINK', sink: suggested });
    edges.push([0, 1], [1, 2]);
    return { role: 'ROUTER', nodes, edges, maxHops: 2 };
  }
  const sinkY: Record<EnergySink, number> = { RAIJIN: 0.18, FUJIN: 0.5, RESERVE: 0.82 };
  const sinkIds = {} as Record<EnergySink, number>;
  // Two relays (upper/lower half) and one or two blocked decoys in between.
  const relayA = nodes.push({ id: nodes.length, x: 0.42 + rand() * 0.1, y: 0.2 + rand() * 0.15, kind: 'RELAY' }) - 1;
  const relayB = nodes.push({ id: nodes.length, x: 0.42 + rand() * 0.1, y: 0.65 + rand() * 0.15, kind: 'RELAY' }) - 1;
  const blocked: number[] = [];
  const nBlocked = jammed ? 2 : 1;
  for (let i = 0; i < nBlocked; i++) {
    blocked.push(nodes.push({ id: nodes.length, x: 0.3 + rand() * 0.35, y: 0.42 + (i - (nBlocked - 1) / 2) * 0.22, kind: 'BLOCKED' }) - 1);
  }
  for (const s of ENERGY_SINKS) sinkIds[s] = nodes.push({ id: nodes.length, x: 0.92, y: sinkY[s], kind: 'SINK', sink: s }) - 1;
  edges.push([0, relayA], [0, relayB], [relayA, relayB]);
  // Upper relay reaches Raijin directly, lower reaches the reserve; Fujin needs a choice.
  edges.push([relayA, sinkIds.RAIJIN], [relayB, sinkIds.RESERVE]);
  edges.push(rand() < 0.5 ? [relayA, sinkIds.FUJIN] : [relayB, sinkIds.FUJIN]);
  // Decoys: short-looking routes through blocked nodes.
  for (const b of blocked) {
    edges.push([0, b]);
    for (const s of ENERGY_SINKS) if (rand() < 0.6) edges.push([b, sinkIds[s]]);
  }
  return { role: 'ROUTER', nodes, edges, maxHops: 3 };
}

export function engineerParams(rand: Rand, difficulty: TaskDifficulty): TaskParams {
  const switchCount = difficulty === 'EASY' ? 4 : 6;
  const len = difficulty === 'EASY' ? 2 : 4;
  const pool = Array.from({ length: switchCount }, (_, i) => i);
  const order: number[] = [];
  for (let i = 0; i < len; i++) order.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  return { role: 'ENGINEER', switchCount, order };
}

export function randomDirection(rand: Rand): Direction {
  return DIRECTIONS[Math.floor(rand() * DIRECTIONS.length)]!;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type Evaluation = { valid: true; success: number; sink?: EnergySink } | { valid: false; reason: string };

/** Shortest number of links from the source to `target`, avoiding blocked nodes (BFS). */
export function shortestHops(p: Extract<TaskParams, { role: 'ROUTER' }>, target: number): number {
  const blocked = new Set(p.nodes.filter((n) => n.kind === 'BLOCKED').map((n) => n.id));
  const dist = new Map<number, number>([[0, 0]]);
  const queue = [0];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === target) return dist.get(cur)!;
    for (const [a, b] of p.edges) {
      const next = a === cur ? b : b === cur ? a : -1;
      if (next < 0 || blocked.has(next) || dist.has(next)) continue;
      dist.set(next, dist.get(cur)! + 1);
      queue.push(next);
    }
  }
  return Infinity;
}

/**
 * Score a submission. `elapsedMs` is the server-side game time since the task
 * was handed out: a client claiming to have stopped the reticle later than
 * that (plus latency slack) is rejected.
 */
export function evaluateTask(params: TaskParams, input: TaskInput, elapsedMs: number, durationMs: number): Evaluation {
  if (params.role !== input.role) return { valid: false, reason: 'role mismatch' };
  const slack = 2500;
  switch (params.role) {
    case 'GUNNER': {
      const i = input as Extract<TaskInput, { role: 'GUNNER' }>;
      if (!Number.isFinite(i.stopAtMs) || i.stopAtMs < 0 || i.stopAtMs > durationMs || i.stopAtMs > elapsedMs + slack) {
        return { valid: false, reason: 'stop time out of range' };
      }
      const d = Math.abs(reticleAt(params, i.stopAtMs) - params.ringCenter);
      const half = params.ringWidth / 2;
      const success = d <= half ? 1 : Math.max(0, 1 - (d - half) / params.ringWidth);
      return { valid: true, success: round2(success) };
    }
    case 'GUARDIAN': {
      const i = input as Extract<TaskInput, { role: 'GUARDIAN' }>;
      if (!DIRECTIONS.includes(i.direction)) return { valid: false, reason: 'bad direction' };
      if (!Number.isFinite(i.releaseAtMs) || i.releaseAtMs < 0 || i.releaseAtMs > durationMs || i.releaseAtMs > elapsedMs + slack) {
        return { valid: false, reason: 'release time out of range' };
      }
      if (i.direction !== params.direction) return { valid: true, success: 0 };
      const g = gaugeAt(params, i.releaseAtMs);
      const success = g >= params.greenFrom && g <= params.greenTo ? 1 : g >= params.greenFrom - 0.12 && g <= params.greenTo + 0.12 ? 0.6 : 0.3;
      return { valid: true, success };
    }
    case 'ROUTER': {
      const i = input as Extract<TaskInput, { role: 'ROUTER' }>;
      const path = i.path;
      if (!Array.isArray(path) || path.length < 2 || path.length > params.nodes.length) return { valid: false, reason: 'bad path' };
      const byId = new Map(params.nodes.map((n) => [n.id, n]));
      if (path[0] !== 0) return { valid: false, reason: 'must start at the source' };
      const end = byId.get(path[path.length - 1]!);
      if (!end || end.kind !== 'SINK' || !end.sink) return { valid: false, reason: 'must end at a robot or the reserve' };
      const seen = new Set<number>();
      for (let k = 0; k < path.length; k++) {
        const id = path[k]!;
        const node = byId.get(id);
        if (!node || seen.has(id)) return { valid: false, reason: 'unknown or repeated node' };
        seen.add(id);
        if (k > 0) {
          const prev = path[k - 1]!;
          if (!params.edges.some(([a, b]) => (a === prev && b === id) || (a === id && b === prev))) return { valid: false, reason: 'no link' };
        }
        // Through a blocked node or too long: the energy does not arrive.
        if (node.kind === 'BLOCKED') return { valid: true, success: 0, sink: end.sink };
        if (k > 0 && k < path.length - 1 && node.kind !== 'RELAY') return { valid: false, reason: 'only relays in between' };
      }
      const hops = path.length - 1;
      if (hops > params.maxHops) return { valid: true, success: 0, sink: end.sink };
      const best = shortestHops(params, end.id);
      return { valid: true, success: round2(Math.min(1, best / hops)), sink: end.sink };
    }
    case 'ENGINEER': {
      const i = input as Extract<TaskInput, { role: 'ENGINEER' }>;
      const seq = i.sequence;
      if (!Array.isArray(seq) || seq.length > params.switchCount || seq.some((x) => !Number.isInteger(x) || x < 0 || x >= params.switchCount)) {
        return { valid: false, reason: 'bad sequence' };
      }
      let ok = 0;
      while (ok < params.order.length && seq[ok] === params.order[ok]) ok++;
      // Extra presses after a wrong one do not count; a perfect run must be exact.
      const exact = ok === params.order.length && seq.length === params.order.length;
      return { valid: true, success: exact ? 1 : round2(ok / params.order.length) };
    }
  }
}

// ---------------------------------------------------------------------------
// Solver (demo bots, simulator, tests)
// ---------------------------------------------------------------------------

/** Earliest time >= minMs at which a periodic signal with `period` reaches phase-offset `u`. */
function timeFor(u: number, phase: number, periodMs: number, minMs: number): number {
  let t = ((((u - phase) % 1) + 1) % 1) * periodMs;
  while (t < minMs) t += periodMs;
  return Math.round(t);
}

/**
 * Produce an input for a task like a pilot of the given skill (0..1) would:
 * skilled pilots hit the ring / pick the shortest route / press in order,
 * others miss by a little or a lot. Deterministic for a given `rand`.
 */
export function solveTask(params: TaskParams, skill: number, rand: Rand, minMs = 700, preferSink?: EnergySink): TaskInput {
  const good = rand() < skill;
  switch (params.role) {
    case 'GUNNER': {
      const u = rand() < 0.5 ? params.ringCenter / 2 : 1 - params.ringCenter / 2;
      let t = timeFor(u, params.phase, params.periodMs, minMs);
      if (!good) t += Math.round((0.06 + rand() * 0.2) * params.periodMs);
      return { role: 'GUNNER', stopAtMs: t };
    }
    case 'GUARDIAN': {
      const mid = (params.greenFrom + params.greenTo) / 2;
      const direction = good || rand() < 0.5 ? params.direction : DIRECTIONS.find((d) => d !== params.direction)!;
      let t = timeFor(mid, 0, params.periodMs, minMs);
      if (!good) t += Math.round((0.15 + rand() * 0.3) * params.periodMs);
      return { role: 'GUARDIAN', direction, releaseAtMs: t };
    }
    case 'ROUTER': {
      const sinks = params.nodes.filter((n) => n.kind === 'SINK');
      const blocked = new Set(params.nodes.filter((n) => n.kind === 'BLOCKED').map((n) => n.id));
      const target = sinks.find((n) => n.sink === preferSink) ?? sinks[Math.floor(rand() * sinks.length)]!;
      // BFS with parents for the shortest valid route.
      const parent = new Map<number, number>([[0, -1]]);
      const queue = [0];
      while (queue.length) {
        const cur = queue.shift()!;
        if (cur === target.id) break;
        for (const [a, b] of params.edges) {
          const next = a === cur ? b : b === cur ? a : -1;
          if (next < 0 || blocked.has(next) || parent.has(next)) continue;
          parent.set(next, cur);
          queue.push(next);
        }
      }
      const path: number[] = [];
      for (let n = target.id; n !== -1 && parent.has(n); n = parent.get(n)!) path.unshift(n);
      if (good && path[0] === 0) return { role: 'ROUTER', path };
      // A hurried pilot takes the tempting shortcut through a blocked node.
      const decoy = params.edges.find(([a, b]) => a === 0 && blocked.has(b));
      if (decoy) {
        const via = decoy[1];
        const out = params.edges.find(([a, b]) => a === via && params.nodes[b]?.kind === 'SINK');
        if (out) return { role: 'ROUTER', path: [0, via, out[1]] };
      }
      return { role: 'ROUTER', path: path[0] === 0 ? path : [0] };
    }
    case 'ENGINEER': {
      if (good) return { role: 'ENGINEER', sequence: [...params.order] };
      const seq = [...params.order];
      const k = Math.floor(rand() * seq.length);
      seq[k] = (seq[k]! + 1) % params.switchCount;
      return { role: 'ENGINEER', sequence: seq };
    }
  }
}

