/**
 * Zombie Invasion Defense (working title) — Milestone 1 configuration.
 *
 * Every number here is a PROVISIONAL balance value, not a locked decision.
 * Game rules read from this object; the engine never sees it.
 */

export type Edge = "north" | "south" | "east" | "west";

export interface GameConfig {
  world: { width: number; height: number };
  /** Label shown for the run currency. The final name is an open decision. */
  currencyLabel: string;
  stronghold: { x: number; y: number; halfSize: number; maxHp: number };
  /** Fixed turret mounts on the stronghold (Zone A), as offsets from its centre. */
  hardpoints: { id: string; dx: number; dy: number }[];
  economy: { startCurrency: number };
  turret: {
    cost: number;
    range: number;
    /** Shots per second. */
    fireRate: number;
    damage: number;
    projectileSpeed: number;
    radius: number;
  };
  walker: {
    maxHp: number;
    /** World units per second. */
    speed: number;
    radius: number;
    structureDamage: number;
    attackCooldown: number;
    reward: number;
  };
  wave: {
    prepSeconds: number;
    warningSeconds: number;
    count: number;
    /** Spawns are spread across this many seconds. */
    spawnSeconds: number;
    edges: Edge[];
  };
  projectile: { radius: number; maxLifetime: number };
  limits: { maxEnemies: number; maxProjectiles: number };
}

export const baseConfig: GameConfig = {
  world: { width: 720, height: 1280 },
  currencyLabel: "Supplies",
  stronghold: { x: 360, y: 660, halfSize: 52, maxHp: 400 },
  hardpoints: [
    { id: "west", dx: -88, dy: 0 },
    { id: "east", dx: 88, dy: 0 },
  ],
  economy: { startCurrency: 100 },
  turret: { cost: 50, range: 300, fireRate: 5, damage: 4, projectileSpeed: 720, radius: 22 },
  walker: { maxHp: 26, speed: 30, radius: 14, structureDamage: 8, attackCooldown: 1, reward: 6 },
  wave: { prepSeconds: 20, warningSeconds: 3, count: 46, spawnSeconds: 40, edges: ["north", "south", "east", "west"] },
  projectile: { radius: 3, maxLifetime: 1.2 },
  limits: { maxEnemies: 200, maxProjectiles: 400 },
};

/**
 * Performance test setup for the acceptance check "60 FPS with 50 zombies and
 * 100 projectiles on screen". Both hardpoints start built, walkers are
 * effectively unkillable and all 50 spawn at once.
 */
export function stressConfig(base: GameConfig = baseConfig): GameConfig {
  return {
    ...base,
    economy: { startCurrency: 0 },
    stronghold: { ...base.stronghold, maxHp: 1e9 },
    turret: { ...base.turret, fireRate: 260, damage: 0 },
    walker: { ...base.walker, maxHp: 1e9, speed: 12 },
    wave: { ...base.wave, prepSeconds: 0, warningSeconds: 0, count: 50, spawnSeconds: 0.1 },
  };
}
