/**
 * Zombie Invasion Defense (working title) — game configuration.
 *
 * Every number here is a PROVISIONAL balance value, not a locked decision.
 * Values marked "tuned" were chosen with scripts/balance.mjs against the
 * provisional target in `balance`. Game rules read from this object; the
 * engine never sees it.
 */

export type Edge = "north" | "south" | "east" | "west";
export type EnemyType = "walker" | "runner" | "brute";
export const ENEMY_TYPES: readonly EnemyType[] = ["walker", "runner", "brute"];

export interface EnemyStats {
  maxHp: number;
  /** World units per second. */
  speed: number;
  radius: number;
  /** Damage per hit on the stronghold. */
  structureDamage: number;
  /** Seconds between hits. */
  attackCooldown: number;
  /** Supplies drop: `chance` (0..1) of dropping between `min` and `max` inclusive. */
  drop: { chance: number; min: number; max: number };
}

export interface UpgradePath {
  /** Cost of each level; the array length is the maximum level. */
  costs: number[];
  /** Added per level as a fraction of the base value (0.3 = +30% per level). */
  perLevel: number;
}

export interface WaveRules {
  /** Enemies in wave 1, and how many more each later wave adds. */
  baseCount: number;
  countPerWave: number;
  /** Enemy health compounds by this fraction per wave after the first (0.1 = ×1.1 each wave). */
  hpGrowthPerWave: number;
  /** Runner share of a wave: starts at `runnerFrom`, rises by `runnerShareStep` per wave, capped. */
  runnerFrom: number;
  runnerShareStep: number;
  runnerShareMax: number;
  /** Brute share: starts at `bruteFrom`, rises by `bruteShareStep` per wave, capped. */
  bruteFrom: number;
  bruteShareStep: number;
  bruteShareMax: number;
  /** Spawn window: `spawnBaseSeconds` + `spawnSecondsPerWave` × (wave − 1), capped. */
  spawnBaseSeconds: number;
  spawnSecondsPerWave: number;
  spawnMaxSeconds: number;
  /** From this wave, waves lean towards one side: this share of spawns comes from it. */
  lopsidedFrom: number;
  lopsidedShare: number;
}

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
    /** Shots per second at level 0. */
    fireRate: number;
    /** Damage per shot at level 0. */
    damage: number;
    projectileSpeed: number;
    radius: number;
  };
  /** Turret upgrades. A turret may take both paths. Preparation only. */
  upgrades: { speed: UpgradePath; strength: UpgradePath };
  enemies: Record<EnemyType, EnemyStats>;
  wave: {
    prepSeconds: number;
    warningSeconds: number;
    edges: Edge[];
  };
  waves: WaveRules;
  projectile: { radius: number; maxLifetime: number };
  limits: { maxEnemies: number; maxProjectiles: number };
  /** Provisional design target used by scripts/balance.mjs, not by the game. */
  balance: { typicalDefeatWaveMin: number; typicalDefeatWaveMax: number };
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
  upgrades: {
    // tuned: per supply spent, an upgrade is roughly as strong as a new turret,
    // and the two paths multiply, so investing in one turret pays off.
    speed: { costs: [30, 50, 80], perLevel: 0.5 },
    strength: { costs: [30, 50, 80], perLevel: 0.5 },
  },
  enemies: {
    walker: { maxHp: 26, speed: 30, radius: 14, structureDamage: 8, attackCooldown: 1, drop: { chance: 0.6, min: 3, max: 6 } },
    runner: { maxHp: 14, speed: 64, radius: 11, structureDamage: 5, attackCooldown: 0.6, drop: { chance: 0.5, min: 2, max: 4 } },
    brute: { maxHp: 150, speed: 17, radius: 22, structureDamage: 30, attackCooldown: 1.4, drop: { chance: 1, min: 12, max: 20 } },
  },
  wave: { prepSeconds: 20, warningSeconds: 3, edges: ["north", "south", "east", "west"] },
  waves: {
    baseCount: 40,
    countPerWave: 6,
    hpGrowthPerWave: 0.28, // tuned with scripts/balance.mjs: sensible player falls around waves 11-13
    runnerFrom: 2,
    runnerShareStep: 0.05,
    runnerShareMax: 0.3,
    bruteFrom: 4,
    bruteShareStep: 0.02,
    bruteShareMax: 0.12,
    spawnBaseSeconds: 36,
    spawnSecondsPerWave: 2,
    spawnMaxSeconds: 60,
    lopsidedFrom: 3,
    lopsidedShare: 0.55,
  },
  projectile: { radius: 3, maxLifetime: 1.2 },
  limits: { maxEnemies: 260, maxProjectiles: 400 },
  balance: { typicalDefeatWaveMin: 10, typicalDefeatWaveMax: 15 },
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
    enemies: { ...base.enemies, walker: { ...base.enemies.walker, maxHp: 1e9, speed: 1.5 } },
    wave: { ...base.wave, prepSeconds: 1, warningSeconds: 0 },
    waves: {
      ...base.waves,
      baseCount: 50,
      countPerWave: 0,
      hpGrowthPerWave: 0,
      runnerFrom: 1e9,
      bruteFrom: 1e9,
      spawnBaseSeconds: 0.1,
      spawnSecondsPerWave: 0,
      lopsidedFrom: 1e9,
    },
  };
}
