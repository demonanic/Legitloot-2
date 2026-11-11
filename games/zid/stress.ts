/**
 * Stress-test run: builds the stress turrets during preparation (a legal
 * build, through the normal validation), then launches the assault early.
 * The normal rule that construction is refused during assaults is untouched.
 */

import type { GameConfig } from "./config.js";
import { buildTurret, createState, startWaveNow, type GameState } from "./sim.js";

/** Four turrets around the stronghold, as [col, row]. */
export const STRESS_TURRET_TILES: readonly [number, number][] = [
  [3, 8],
  [6, 8],
  [3, 10],
  [6, 7],
];

export function createStressRun(cfg: GameConfig, seed: number): GameState {
  const s = createState(cfg, seed);
  if (s.phase !== "prep") throw new Error("stress config must start in preparation");
  for (const [col, row] of STRESS_TURRET_TILES) {
    const res = buildTurret(s, cfg, col, row);
    if (!res.ok) throw new Error(`stress turret on ${col},${row} refused: ${res.reason}`);
  }
  startWaveNow(s, cfg);
  return s;
}
