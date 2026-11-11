/**
 * Stress-test run: builds every stress turret during preparation (a legal
 * build, through the normal validation), then launches the assault early.
 * The normal rule that construction is refused during assaults is untouched.
 */

import type { GameConfig } from "./config.js";
import { buildTurret, createState, startWaveNow, type GameState } from "./sim.js";

export function createStressRun(cfg: GameConfig, seed: number): GameState {
  const s = createState(cfg, seed);
  if (s.phase !== "prep") throw new Error("stress config must start in preparation");
  for (const slot of s.slots) {
    const res = buildTurret(s, cfg, slot.id);
    if (!res.ok) throw new Error(`stress turret on ${slot.id} refused: ${res.reason}`);
  }
  startWaveNow(s, cfg);
  return s;
}
