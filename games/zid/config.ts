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
  /**
   * Construction area. Tiles are square and sized for touch: 80 world units is
   * about 46 CSS px on a 412 px-wide phone (44 px is the minimum touch target).
   */
  construction: {
    tileSize: number;
    /** Property boundary, world units, in order. A tile is inside when its centre is. */
    perimeter: [number, number][];
    /** Tiles inside the boundary that cannot be built on (placeholder terrain), as [col, row]. */
    invalidTerrain: [number, number][];
  };
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
  construction: {
    tileSize: 80,
    perimeter: [
      [120, 330], [400, 300], [610, 360], [640, 560], [600, 720], [650, 900],
      [560, 1030], [330, 1060], [130, 990], [90, 780], [140, 600], [80, 450],
    ],
    invalidTerrain: [
      [2, 5],
      [6, 11],
    ],
  },
  economy: { startCurrency: 100 },
  turret: { cost: 50, range: 300, fireRate: 5, damage: 4, projectileSpeed: 720, radius: 22 },
  walker: { maxHp: 26, speed: 30, radius: 14, structureDamage: 8, attackCooldown: 1, reward: 6 },
  wave: { prepSeconds: 20, warningSeconds: 3, count: 46, spawnSeconds: 40, edges: ["north", "south", "east", "west"] },
  projectile: { radius: 3, maxLifetime: 1.2 },
  limits: { maxEnemies: 200, maxProjectiles: 400 },
};

/**
 * Performance test setup for the acceptance check "60 FPS with 50 zombies and
 * 100 projectiles on screen". Walkers are effectively unkillable and all 50
 * spawn at once. The run starts in a short preparation phase so the stress
 * turrets are built through the normal, legal build path (see stress.ts).
 */
export function stressConfig(base: GameConfig = baseConfig): GameConfig {
  return {
    ...base,
    economy: { startCurrency: 0 },
    stronghold: { ...base.stronghold, maxHp: 1e9 },
    // Long range and slow walkers keep projectiles in flight for a steady load,
    // instead of collapsing to point-blank shots once walkers reach the turrets.
    turret: { ...base.turret, cost: 0, fireRate: 100, damage: 0, range: 1500 },
    walker: { ...base.walker, maxHp: 1e9, speed: 1.5 },
    wave: { ...base.wave, prepSeconds: 1, warningSeconds: 0, count: 50, spawnSeconds: 0.1 },
  };
}
