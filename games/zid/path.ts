/**
 * Simple, deterministic zombie pathing.
 *
 * One distance field over the construction grid, measured from the
 * stronghold's tiles. Open tiles cost 1 (diagonals √2). A tile holding an
 * intact structure costs `blockedTileCost + its health`, so zombies always
 * take an open route when one exists, and when fully enclosed they break
 * through the weakest blocker. Rubble and terrain are walkable. Diagonal
 * moves may not cut between two blocked tiles.
 *
 * Instinct only: every zombie follows the same field towards the stronghold.
 * No flanking, no coordination, no targeting of turrets for their own sake.
 */

import type { GameConfig } from "./config.js";
import { gridSize, overlapsStronghold } from "./grid.js";
import type { GameState, Structure } from "./sim.js";

export interface PathField {
  cols: number;
  rows: number;
  /** Cost to reach the stronghold from each tile (row * cols + col). */
  dist: Float64Array;
  /** Intact structure on each tile, or null. */
  blocker: (Structure | null)[];
  goal: Uint8Array;
}

const NEIGHBOURS: readonly [number, number, number][] = [
  [0, -1, 1],
  [1, 0, 1],
  [0, 1, 1],
  [-1, 0, 1],
  [1, -1, Math.SQRT2],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

const cache = new WeakMap<GameState, { version: number; cfg: GameConfig; field: PathField }>();

/** The field for the current layout; rebuilt only when `s.layoutVersion` changes. */
export function pathField(s: GameState, cfg: GameConfig): PathField {
  const hit = cache.get(s);
  if (hit && hit.version === s.layoutVersion && hit.cfg === cfg) return hit.field;
  const field = buildField(s, cfg);
  cache.set(s, { version: s.layoutVersion, cfg, field });
  return field;
}

function buildField(s: GameState, cfg: GameConfig): PathField {
  const { cols, rows } = gridSize(cfg);
  const n = cols * rows;
  const blocker: (Structure | null)[] = new Array(n).fill(null);
  for (const st of s.structures) if (!st.destroyed) blocker[st.row * cols + st.col] = st;
  const goal = new Uint8Array(n);
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (overlapsStronghold(cfg, c, r)) {
        goal[r * cols + c] = 1;
        dist[r * cols + c] = 0;
      }
    }
  }
  // Dijkstra, run backwards from the goal. 144 tiles: a linear scan is plenty.
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < best) best = dist[(u = i)]!;
    if (u === -1) break;
    done[u] = 1;
    const uc = u % cols;
    const ur = (u - uc) / cols;
    // Entering u from a neighbour costs u's own cost.
    const uBlock = blocker[u];
    const enterU = uBlock ? cfg.pathing.blockedTileCost + uBlock.hp : 0;
    for (const [dc, dr, step] of NEIGHBOURS) {
      const vc = uc + dc;
      const vr = ur + dr;
      if (vc < 0 || vr < 0 || vc >= cols || vr >= rows) continue;
      if (dc !== 0 && dr !== 0 && (isBlocked(blocker, cols, uc, vr) || isBlocked(blocker, cols, vc, ur))) continue;
      const v = vr * cols + vc;
      const nd = dist[u]! + step + enterU;
      if (nd < dist[v]!) dist[v] = nd;
    }
  }
  return { cols, rows, dist, blocker, goal };
}

function isBlocked(blocker: (Structure | null)[], cols: number, c: number, r: number): boolean {
  return blocker[r * cols + c] != null;
}

/** Tile containing a point, clamped onto the grid (zombies spawn just off it). */
export function clampTile(cfg: GameConfig, field: PathField, x: number, y: number): { col: number; row: number } {
  const t = cfg.construction.tileSize;
  return {
    col: Math.min(field.cols - 1, Math.max(0, Math.floor(x / t))),
    row: Math.min(field.rows - 1, Math.max(0, Math.floor(y / t))),
  };
}

/**
 * The next tile a zombie on (col,row) should head for: the neighbour that
 * reaches the stronghold most cheaply. Ties keep the fixed neighbour order.
 */
export function nextTile(cfg: GameConfig, field: PathField, col: number, row: number): { col: number; row: number } | null {
  const { cols, rows, dist, blocker } = field;
  let best: { col: number; row: number } | null = null;
  let bestD = Infinity;
  for (const [dc, dr, step] of NEIGHBOURS) {
    const vc = col + dc;
    const vr = row + dr;
    if (vc < 0 || vr < 0 || vc >= cols || vr >= rows) continue;
    if (dc !== 0 && dr !== 0 && (isBlocked(blocker, cols, col, vr) || isBlocked(blocker, cols, vc, row))) continue;
    const v = vr * cols + vc;
    const b = blocker[v];
    const d = dist[v]! + step + (b ? cfg.pathing.blockedTileCost + b.hp : 0);
    if (d < bestD) {
      bestD = d;
      best = { col: vc, row: vr };
    }
  }
  return best;
}
