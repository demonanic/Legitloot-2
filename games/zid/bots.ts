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
  type UpgradePathId,
  UPGRADE_PATHS,
  buildLimit,
  countKind,
  isUnlocked,
  isTrap,
  upgradeBase,
  nextBaseUpgradeCost,
  collectPickup,
  activateBoost,
} from "./sim.js";

export interface Player {
  (s: GameState, cfg: GameConfig): void;
  /** Optional: called every step of an assault (collect pickups, fire boosts). */
  during?: (s: GameState, cfg: GameConfig) => void;
}

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

function buildNearest(s: GameState, cfg: GameConfig, kind: StructureKind = "machine-gun", skip = 0): boolean {
  if (s.currency < buildCost(cfg, kind)) return false;
  // Traps go a ring further out (`skip` tiles), leaving the inner tiles for guns.
  const t = tilesByDistance(cfg).slice(skip).find((t) => !structureAt(s, t.col, t.row));
  return !!t && buildStructure(s, cfg, kind, t.col, t.row).ok;
}

const WEAPON_PREFERENCE: readonly StructureKind[] = ["machine-gun", "gatling", "rocket", "mortar"];

/**
 * Build the unlocked weapon kind with the most room left under its cap
 * (mortars from wave 3); if every kind is full, upgrade the base instead.
 */
function buildWeapon(s: GameState, cfg: GameConfig): boolean {
  let best: StructureKind | null = null;
  let bestRoom = 0;
  for (const kind of WEAPON_PREFERENCE) {
    if (!isUnlocked(s, cfg, kind) || (kind === "mortar" && s.wave < 3)) continue;
    const room = (buildLimit(s, cfg, kind)! - countKind(s, kind)) / buildLimit(s, cfg, kind)!;
    if (room > bestRoom) {
      best = kind;
      bestRoom = room;
    }
  }
  if (best) return buildNearest(s, cfg, best);
  return upgradeBase(s, cfg).ok;
}

/** From wave 2, keep a few traps out: mines, plus trip wires once unlocked. */
function placeTraps(s: GameState, cfg: GameConfig): void {
  if (s.wave < 2) return;
  const want = Math.min(buildLimit(s, cfg, "mine")!, 1 + Math.floor(s.wave / 2));
  for (let guard = 0; guard < 20 && countKind(s, "mine") < want; guard++) {
    const kind: StructureKind = isUnlocked(s, cfg, "tripwire") && countKind(s, "tripwire") * 2 < countKind(s, "mine") ? "tripwire" : "mine";
    if (!buildNearest(s, cfg, kind, 0)) break;
  }
}

/** Repairs first, then builds turrets near the stronghold, then buys the cheapest available upgrade. */
export const sensiblePlayer: Player = (s, cfg) => {
  for (const st of s.structures) if (st.destroyed || st.hp < st.maxHp) repair(s, cfg, { kind: "structure", id: st.id });
  if (s.stronghold.hp < s.stronghold.maxHp * 0.7) repair(s, cfg, { kind: "stronghold" });
  // Chase unlocks: once the defence is up to strength, a base upgrade that
  // brings a new weapon comes before turret upgrades, if Supplies are left over.
  const nextLevel = s.stronghold.level + 2;
  const want = 2 + Math.floor((s.wave - 1) / 2);
  const cost = nextBaseUpgradeCost(s, cfg);
  if (
    cost !== null &&
    s.wave >= 4 &&
    Object.values(cfg.unlocks).includes(nextLevel) &&
    s.structures.filter((st) => st.turret).length >= want &&
    s.currency >= cost + 60
  ) {
    upgradeBase(s, cfg);
  }
  for (let guard = 0; guard < 200; guard++) {
    const want = 2 + Math.floor((s.wave - 1) / 2);
    const weapons = s.structures.filter((st) => st.turret).length;
    if (weapons < want && buildWeapon(s, cfg)) continue;
    let best: { id: number; path: UpgradePathId; cost: number } | null = null;
    for (const st of s.structures) {
      for (const path of UPGRADE_PATHS) {
        if (checkUpgrade(s, cfg, st.id, path) !== null) continue;
        const cost = nextUpgradeCost(cfg, st, path)!;
        if (!best || cost < best.cost) best = { id: st.id, path, cost };
      }
    }
    if (best && upgradeTurret(s, cfg, best.id, best.path).ok) continue;
    if (buildWeapon(s, cfg)) continue;
    break;
  }
};

/** The sensible player, plus traps laid close in. Experimental: where it lays traps is naive, so it is not used for balance. */
export const trapperPlayer: Player = (s, cfg) => {
  // Set aside about a quarter of the Supplies for re-arming and laying traps.
  const budget = Math.floor(s.currency * 0.25);
  const keep = s.currency - budget;
  s.currency = budget;
  for (const st of s.structures) if (st.destroyed && isTrap(st.kind)) repair(s, cfg, { kind: "structure", id: st.id });
  placeTraps(s, cfg);
  s.currency += keep;
  sensiblePlayer(s, cfg);
};

/** Only ever builds turrets (upgrading the base when full); never upgrades turrets. */
export const buildOnlyPlayer: Player = (s, cfg) => {
  for (let guard = 0; guard < 100; guard++) {
    if (countKind(s, "machine-gun") < buildLimit(s, cfg, "machine-gun")!) {
      if (!buildNearest(s, cfg)) break;
    } else if (!upgradeBase(s, cfg).ok) break;
  }
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
    const hit0 = s.damageTaken;
    const supplies = s.currency;
    const intact0 = s.structures.filter((st) => !st.destroyed).length;
    startWaveNow(s, cfg);
    for (let i = 0; s.phase === "wave" && i < 30 * 600; i++) {
      step(s, cfg, 1 / 30);
      player.during?.(s, cfg);
    }
    const wrecked = Math.max(0, intact0 - s.structures.filter((st) => !st.destroyed).length);
    perWave.push({ wave, supplies, damage: s.damageTaken - hit0, wrecked });
  }
  return { defeatWave: s.phase === "lost" ? s.wave : null, perWave, earned: s.earned };
}

/**
 * What an attentive player does mid-assault: grabs each pickup a couple of
 * seconds after it appears, and fires Overdrive when the meter is full and a
 * crowd is on the field.
 */
sensiblePlayer.during = (s, cfg) => {
  for (const p of [...s.pickups]) {
    if (p.life <= cfg.pickups.lifeSeconds - 2) collectPickup(s, cfg, p.id);
  }
  if (s.charge >= 1 && !s.boost && s.enemies.length >= 12) activateBoost(s, cfg, "overdrive");
};
