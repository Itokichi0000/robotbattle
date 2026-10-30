import type { RouterPuzzle, RouterTile } from '@swed/shared';
import type { RngHolder } from './rng';
import { nextRandom, randomPick } from './rng';

/**
 * POWER B's circuit puzzle (spec §5.5: reconnect cut routes, not a tapping game).
 * A 3×3 grid of straight (I) and corner (L) conduits; rotate them so power enters on the
 * left at entryRow and leaves on the right at exitRow. The server generates the puzzle
 * from the match RNG and judges the rotations the phone submits.
 * Sides: 0 = up, 1 = right, 2 = down, 3 = left. Rotation = quarter turns clockwise.
 */

export const GRID = 3;

const BASE: Record<RouterTile['type'], readonly [number, number]> = {
  I: [1, 3],
  L: [0, 1],
};

export function tileSides(type: RouterTile['type'], rot: number): [number, number] {
  const [a, b] = BASE[type];
  return [(a + rot) % 4, (b + rot) % 4];
}

const STEP: Record<number, [number, number]> = { 0: [-1, 0], 1: [0, 1], 2: [1, 0], 3: [0, -1] };

/**
 * Follows the conduit from the entry. `cells` are the tiles power reaches (for drawing the
 * lit path on the phone); `connected` is true only if it leaves the right edge at exitRow.
 */
export function tracePath(
  p: RouterPuzzle,
  rotations: readonly number[],
): { cells: number[]; connected: boolean } {
  const cells: number[] = [];
  let r = p.entryRow;
  let c = 0;
  let inSide = 3;
  for (let guard = 0; guard < GRID * GRID + 1; guard++) {
    const idx = r * GRID + c;
    const tile = p.tiles[idx];
    if (!tile || cells.includes(idx)) return { cells, connected: false };
    const [a, b] = tileSides(tile.type, (((rotations[idx] ?? 0) % 4) + 4) % 4);
    if (a !== inSide && b !== inSide) return { cells, connected: false };
    cells.push(idx);
    const out = a === inSide ? b : a;
    if (out === 1 && c === GRID - 1) return { cells, connected: r === p.exitRow };
    const [dr, dc] = STEP[out]!;
    r += dr;
    c += dc;
    if (r < 0 || r >= GRID || c < 0 || c >= GRID) return { cells, connected: false };
    inSide = (out + 2) % 4;
  }
  return { cells, connected: false };
}

/** True if the rotations carry power from the entry to the exit (the server's judgement). */
export function routeConnects(p: RouterPuzzle, rotations: readonly number[]): boolean {
  return tracePath(p, rotations).connected;
}

function tileFor(inSide: number, outSide: number): RouterTile {
  for (const type of ['I', 'L'] as const) {
    for (let rot = 0; rot < 4; rot++) {
      const [a, b] = tileSides(type, rot);
      if ((a === inSide && b === outSide) || (a === outSide && b === inSide)) return { type, rot };
    }
  }
  throw new Error('unreachable tile');
}

/** A fresh, solvable, scrambled puzzle drawn from the match RNG. */
export function generatePuzzle(h: RngHolder): RouterPuzzle {
  const entryRow = Math.floor(nextRandom(h) * GRID);
  const exitRow = Math.floor(nextRandom(h) * GRID);
  const solution = new Map<number, RouterTile>();
  let r = entryRow;
  let c = 0;
  let inSide = 3;
  const visited = new Set<number>();
  for (let guard = 0; guard < 20; guard++) {
    visited.add(r * GRID + c);
    let out: number;
    if (c === GRID - 1) {
      out = r === exitRow ? 1 : r < exitRow ? 2 : 0;
    } else {
      const options = [1];
      if (r > 0 && !visited.has((r - 1) * GRID + c) && inSide !== 0) options.push(0);
      if (r < GRID - 1 && !visited.has((r + 1) * GRID + c) && inSide !== 2) options.push(2);
      out = randomPick(h, options);
    }
    solution.set(r * GRID + c, tileFor(inSide, out));
    if (out === 1 && c === GRID - 1) break;
    const [dr, dc] = STEP[out]!;
    r += dr;
    c += dc;
    inSide = (out + 2) % 4;
  }
  const tiles: RouterTile[] = [];
  for (let i = 0; i < GRID * GRID; i++) {
    const sol = solution.get(i);
    const type = sol ? sol.type : nextRandom(h) < 0.5 ? 'I' : 'L';
    tiles.push({ type, rot: Math.floor(nextRandom(h) * 4) });
  }
  const p: RouterPuzzle = { entryRow, exitRow, tiles };
  if (
    routeConnects(
      p,
      tiles.map((t) => t.rot),
    )
  ) {
    // Never hand out a puzzle that is already solved.
    const first = [...solution.keys()][0]!;
    tiles[first] = { ...tiles[first]!, rot: (tiles[first]!.rot + 1) % 4 };
  }
  return p;
}

/** Depth-first solver (bots, tests). Returns full rotations, or null if unsolvable. */
export function solvePuzzle(p: RouterPuzzle): number[] | null {
  const rot = p.tiles.map((t) => t.rot);
  const visited = new Set<number>();
  const walk = (r: number, c: number, inSide: number): boolean => {
    const idx = r * GRID + c;
    if (visited.has(idx)) return false;
    const tile = p.tiles[idx]!;
    visited.add(idx);
    for (let k = 0; k < 4; k++) {
      const [a, b] = tileSides(tile.type, k);
      if (a !== inSide && b !== inSide) continue;
      const out = a === inSide ? b : a;
      rot[idx] = k;
      if (out === 1 && c === GRID - 1) {
        if (r === p.exitRow) return true;
        continue;
      }
      const [dr, dc] = STEP[out]!;
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) continue;
      if (walk(nr, nc, (out + 2) % 4)) return true;
    }
    visited.delete(idx);
    rot[idx] = tile.rot;
    return false;
  };
  return walk(p.entryRow, 0, 3) ? rot : null;
}
