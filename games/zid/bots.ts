/**
 * Scripted players for balance testing. They act only through the same
 * public commands a human uses (build, upgrade, early launch), during
 * preparation, so they can never bypass a game rule.
 */

import type { GameConfig } from "./config.js";
import { buildableTiles, tileCenter, type Tile } from "./grid.js";
import {
  buildCost,
  buildStructure,
  buildTurret,
  checkUpgrade,
  createState,
  nextUpgradeCost,
  repair,
  startWaveNow,
  step,
  structureAt,
  upgradeTurret,
  type GameState,
  type StructureKind,
} from "./sim.js";

export type Player = (s: GameState, cfg: GameConfig) => void;

/** Buildable tiles nearest the stronghold first. */
function tilesByDistance(cfg: GameConfig): Tile[] {
  return buildableTiles(cfg)
    .map((t) => {
      const c = tileCenter(cfg, t.col, t.row);
      return { t, d: Math.hypot(c.x - cfg.stronghold.x, c.y - cfg.stronghold.y) };
    })
    .sort((a, b) => a.d - b.d || a.t.row - b.t.row || a.t.col - b.t.col)
    .map((x) => x.t);
}

function buildNearest(s: GameState, cfg: GameConfig, kind: StructureKind = "machine-gun"): boolean {
  if (s.currency < buildCost(cfg, kind)) return false;
  const t = tilesByDistance(cfg).find((t) => !structureAt(s, t.col, t.row));
  return !!t && buildStructure(s, cfg, kind, t.col, t.row).ok;
}

/** Every third weapon from wave 3 on is a mortar. */
function nextWeapon(s: GameState): StructureKind {
  const weapons = s.structures.filter((st) => st.turret).length;
  return s.wave >= 3 && weapons % 3 === 2 ? "mortar" : "machine-gun";
}

/** Repairs first, then builds turrets near the stronghold, then buys the cheapest available upgrade. */
export const sensiblePlayer: Player = (s, cfg) => {
  for (const st of s.structures) if (st.destroyed || st.hp < st.maxHp) repair(s, cfg, { kind: "structure", id: st.id });
  if (s.stronghold.hp < s.stronghold.maxHp * 0.7) repair(s, cfg, { kind: "stronghold" });
  for (let guard = 0; guard < 200; guard++) {
    const want = 2 + Math.floor((s.wave - 1) / 2);
    if (s.structures.length < want && buildNearest(s, cfg, nextWeapon(s))) continue;
    let best: { id: number; path: "speed" | "strength"; cost: number } | null = null;
    for (const st of s.structures) {
      for (const path of ["speed", "strength"] as const) {
        if (checkUpgrade(s, cfg, st.id, path) !== null) continue;
        const cost = nextUpgradeCost(cfg, st, path)!;
        if (!best || cost < best.cost) best = { id: st.id, path, cost };
      }
    }
    if (best && upgradeTurret(s, cfg, best.id, best.path).ok) continue;
    if (buildNearest(s, cfg, nextWeapon(s))) continue;
    break;
  }
};

/** Only ever builds turrets; never upgrades. */
export const buildOnlyPlayer: Player = (s, cfg) => {
  while (s.currency >= cfg.turret.cost && buildNearest(s, cfg));
};

/** Builds the starting turrets and nothing else. */
export const passivePlayer: Player = (s, cfg) => {
  if (s.wave === 1) buildOnlyPlayer(s, cfg);
};

export interface RunResult {
  /** Wave the stronghold fell on, or null if it survived `maxWave`. */
  defeatWave: number | null;
  /** Per wave: Supplies before it, stronghold damage taken, structures wrecked. */
  perWave: { wave: number; supplies: number; damage: number; wrecked: number }[];
  earned: number;
}

/** Play a whole run: spend in prep, launch early, fight, repeat. */
export function playRun(cfg: GameConfig, seed: number, player: Player, maxWave = 40): RunResult {
  const s = createState(cfg, seed);
  const perWave: RunResult["perWave"] = [];
  while (s.phase !== "lost" && s.wave <= maxWave) {
    player(s, cfg);
    const wave = s.wave;
    const hp0 = s.stronghold.hp;
    const supplies = s.currency;
    const intact0 = s.structures.filter((st) => !st.destroyed).length;
    startWaveNow(s, cfg);
    for (let i = 0; s.phase === "wave" && i < 30 * 600; i++) step(s, cfg, 1 / 30);
    const wrecked = Math.max(0, intact0 - s.structures.filter((st) => !st.destroyed).length);
    perWave.push({ wave, supplies, damage: hp0 - s.stronghold.hp, wrecked });
  }
  return { defeatWave: s.phase === "lost" ? s.wave : null, perWave, earned: s.earned };
}
