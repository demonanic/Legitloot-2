/**
 * Construction grid and property perimeter.
 *
 * The world is divided into square tiles sized for touch. A tile is buildable
 * when its centre lies inside the property boundary polygon, it is not marked
 * as invalid terrain, and it does not overlap the stronghold. Everything here
 * is pure and derived from config, so the simulation and the UI share one
 * definition of "buildable".
 */

import type { GameConfig } from "./config.js";

export interface Tile {
  col: number;
  row: number;
}

export type TileStatus = "buildable" | "out-of-bounds" | "outside-perimeter" | "invalid-terrain";

export function gridSize(cfg: GameConfig): { cols: number; rows: number } {
  const t = cfg.construction.tileSize;
  const o = cfg.construction.origin;
  return { cols: Math.floor((cfg.world.width - 2 * o.x) / t), rows: Math.floor((cfg.world.height - 2 * o.y) / t) };
}

/** Top-left corner of a tile in world units. */
export function tileOrigin(cfg: GameConfig, col: number, row: number): { x: number; y: number } {
  const t = cfg.construction.tileSize;
  const o = cfg.construction.origin;
  return { x: o.x + col * t, y: o.y + row * t };
}

export function tileCenter(cfg: GameConfig, col: number, row: number): { x: number; y: number } {
  const t = cfg.construction.tileSize;
  const p = tileOrigin(cfg, col, row);
  return { x: p.x + t / 2, y: p.y + t / 2 };
}

/** Tile containing a world point, or null outside the grid. */
export function tileAt(cfg: GameConfig, x: number, y: number): Tile | null {
  const t = cfg.construction.tileSize;
  const o = cfg.construction.origin;
  const col = Math.floor((x - o.x) / t);
  const row = Math.floor((y - o.y) / t);
  const { cols, rows } = gridSize(cfg);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  return { col, row };
}

/** Even-odd ray casting. Points exactly on an edge may land either side. */
export function pointInPolygon(x: number, y: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function overlapsStronghold(cfg: GameConfig, col: number, row: number): boolean {
  const t = cfg.construction.tileSize;
  const sh = cfg.stronghold;
  const { x: x0, y: y0 } = tileOrigin(cfg, col, row);
  return x0 < sh.x + sh.halfSize && x0 + t > sh.x - sh.halfSize && y0 < sh.y + sh.halfSize && y0 + t > sh.y - sh.halfSize;
}

/** Terrain status of a tile, ignoring anything built on it. */
export function tileStatus(cfg: GameConfig, col: number, row: number): TileStatus {
  const { cols, rows } = gridSize(cfg);
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cols || row >= rows) {
    return "out-of-bounds";
  }
  const c = tileCenter(cfg, col, row);
  if (!pointInPolygon(c.x, c.y, cfg.construction.perimeter)) return "outside-perimeter";
  if (overlapsStronghold(cfg, col, row)) return "invalid-terrain";
  if (cfg.construction.invalidTerrain.some(([tc, tr]) => tc === col && tr === row)) return "invalid-terrain";
  return "buildable";
}

const cache = new WeakMap<GameConfig, Tile[]>();

/** Every buildable tile, in row-major order. Cached per config object. */
export function buildableTiles(cfg: GameConfig): Tile[] {
  let list = cache.get(cfg);
  if (!list) {
    list = [];
    const { cols, rows } = gridSize(cfg);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) if (tileStatus(cfg, col, row) === "buildable") list.push({ col, row });
    }
    cache.set(cfg, list);
  }
  return list;
}

/**
 * Forgiving taps: the tile under the point, or if that tile is neither
 * buildable nor `occupied`, a neighbouring tile that is, when the point is
 * within `slack` world units of its edge. Picks the nearest such tile.
 */
export function forgivingTile(
  cfg: GameConfig,
  x: number,
  y: number,
  occupied: (col: number, row: number) => boolean,
  slack = 14,
): Tile | null {
  const t = cfg.construction.tileSize;
  const here = tileAt(cfg, x, y);
  const good = (c: number, r: number) => occupied(c, r) || tileStatus(cfg, c, r) === "buildable";
  if (here && good(here.col, here.row)) return here;
  const o = cfg.construction.origin;
  const c0 = Math.floor((x - o.x) / t);
  const r0 = Math.floor((y - o.y) / t);
  let best: Tile | null = null;
  let bestD = slack;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = c0 + dc;
      const r = r0 + dr;
      if (tileStatus(cfg, c, r) === "out-of-bounds" || !good(c, r)) continue;
      const p = tileOrigin(cfg, c, r);
      const d = Math.hypot(Math.max(p.x - x, 0, x - (p.x + t)), Math.max(p.y - y, 0, y - (p.y + t)));
      if (d <= bestD) {
        best = { col: c, row: r };
        bestD = d;
      }
    }
  }
  return best ?? here;
}
