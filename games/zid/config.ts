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

export interface BaseLevel {
  /** Price of upgrading to this level (0 for the starting level). */
  cost: number;
  machineGuns: number;
  mortars: number;
  gatlings: number;
  rockets: number;
  /** Mines and trip wires together. */
  traps: number;
  maxHp: number;
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
  /**
   * Packs: from `packFrom`, part of each wave arrives in tight clumps of
   * `packSize` from one spot at once. Share and size grow per wave.
   */
  packFrom: number;
  packShareBase: number;
  packSharePerWave: number;
  packShareMax: number;
  packSizeBase: number;
  packSizePerWave: number;
  packSizeMax: number;
}

export interface GameConfig {
  world: { width: number; height: number };
  /** Label shown for the run currency. The final name is an open decision. */
  currencyLabel: string;
  /**
   * The stronghold. `levels[0]` is the starting base; each later level is a
   * base upgrade (bought between waves) that raises its health and how many
   * machine guns and mortars may be built. Barricades are never capped.
   */
  stronghold: { x: number; y: number; halfSize: number; maxHp: number; levels: BaseLevel[] };
  /**
   * Construction area. Tiles are square: 68 world units is about 39 CSS px on
   * a 412 px-wide phone, a little under the 44 px touch guideline, so taps
   * near a tile's edge are forgiven (see `forgivingTile`). The grid starts at
   * `origin` so it sits centred in the world.
   */
  construction: {
    tileSize: number;
    origin: { x: number; y: number };
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
    maxHp: number;
  };
  /**
   * Mortar: lobs shells that land after a delay and damage every zombie in the
   * blast. Can't hit anything closer than `minRange`. Fires at the densest
   * cluster on its own; during an assault the player may tap the map to aim it.
   */
  mortar: {
    cost: number;
    range: number;
    minRange: number;
    /** Shells per second at level 0. */
    fireRate: number;
    /** Blast damage at level 0. */
    damage: number;
    blastRadius: number;
    /** Flight time = shellBaseSeconds + distance / shellSpeed. */
    shellBaseSeconds: number;
    shellSpeed: number;
    radius: number;
    maxHp: number;
    /** Upgrade prices are the turret prices times this. */
    upgradeCostMultiplier: number;
  };
  /** Gatling gun: fire rate spins up from `minRate` to `maxRate` while it has targets. */
  gatling: {
    cost: number;
    range: number;
    minRate: number;
    maxRate: number;
    /** Seconds to spin from stopped to full speed, and back down. */
    spinUpSeconds: number;
    spinDownSeconds: number;
    damage: number;
    projectileSpeed: number;
    radius: number;
    maxHp: number;
    upgradeCostMultiplier: number;
  };
  /** Rocket launcher: slow homing rockets, a direct hit plus splash. */
  rocket: {
    cost: number;
    range: number;
    fireRate: number;
    damage: number;
    splashDamage: number;
    splashRadius: number;
    speed: number;
    /** Radians per second the rocket can turn to follow its target. */
    turnRate: number;
    maxLifetime: number;
    radius: number;
    maxHp: number;
    upgradeCostMultiplier: number;
  };
  /**
   * Traps sit on tiles but never block zombies and are never attacked. Each
   * goes off once; a spent trap is re-armed between waves (like rebuilding
   * rubble) or recycled.
   */
  mine: { cost: number; triggerRadius: number; blastRadius: number; damage: number };
  /** Trip wire: the first zombie to cross sets off a line of blasts along the wire. */
  tripwire: { cost: number; length: number; blasts: number; blastRadius: number; damage: number };
  /** Trap damage grows with the base: +this share per base level above the first. */
  trapDamagePerBaseLevel: number;
  /** The run's wave from which each kind can be built (1 = from the start). */
  unlocks: Record<"machine-gun" | "gatling" | "rocket" | "mortar" | "barricade" | "mine" | "tripwire", number>;
  /** Barricades block movement; reinforcing raises their maximum health. */
  barricade: { cost: number; maxHp: number; reinforce: UpgradePath };
  /**
   * Repairs and recycling, as shares of everything spent on a structure
   * (build + upgrades + reinforcement). Repairs restore health in
   * proportion; a structure can be partly repaired if supplies run short.
   */
  repair: {
    /** Full repair of an intact structure from 0 health costs this share of what was spent. */
    structureShare: number;
    /** Rebuilding rubble (with its upgrades) costs this share of what was spent. */
    rubbleShare: number;
    strongholdCostPerHp: number;
  };
  recycle: { intactShare: number; rubbleShare: number };
  /** Zombies take any open route; a blocked tile costs this much (plus its health) to path through. */
  pathing: { blockedTileCost: number };
  /** Turret upgrades. A turret may take every path. Range is machine gun only. Preparation only. */
  upgrades: { speed: UpgradePath; strength: UpgradePath; range: UpgradePath };
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
  stronghold: {
    x: 360,
    y: 640,
    halfSize: 44,
    maxHp: 400,
    levels: [
      { cost: 0, machineGuns: 3, mortars: 1, gatlings: 1, rockets: 1, traps: 6, maxHp: 400 },
      { cost: 100, machineGuns: 5, mortars: 2, gatlings: 1, rockets: 1, traps: 10, maxHp: 480 },
      { cost: 180, machineGuns: 7, mortars: 3, gatlings: 2, rockets: 2, traps: 14, maxHp: 560 },
      { cost: 280, machineGuns: 9, mortars: 4, gatlings: 3, rockets: 2, traps: 18, maxHp: 640 },
      { cost: 400, machineGuns: 12, mortars: 5, gatlings: 4, rockets: 3, traps: 24, maxHp: 720 },
    ],
  },
  construction: {
    tileSize: 68,
    origin: { x: 20, y: 28 },
    perimeter: [
      [95, 255], [360, 215], [625, 270], [650, 520], [615, 700], [650, 900],
      [590, 1070], [360, 1110], [120, 1040], [75, 800], [110, 600], [70, 420],
    ],
    invalidTerrain: [
      [2, 6],
      [7, 12],
      [4, 13],
    ],
  },
  economy: { startCurrency: 100 },
  turret: { cost: 50, range: 185, fireRate: 5, damage: 4, projectileSpeed: 610, radius: 19, maxHp: 120 },
  mortar: {
    cost: 80,
    range: 375,
    minRange: 110,
    fireRate: 0.5,
    damage: 30,
    blastRadius: 64,
    shellBaseSeconds: 0.5,
    shellSpeed: 600,
    radius: 20,
    maxHp: 100,
    upgradeCostMultiplier: 1.5,
  },
  gatling: {
    cost: 90,
    range: 160,
    minRate: 3,
    maxRate: 16,
    spinUpSeconds: 1.6,
    spinDownSeconds: 1.2,
    damage: 2.5,
    projectileSpeed: 680,
    radius: 20,
    maxHp: 140,
    upgradeCostMultiplier: 1.3,
  },
  rocket: {
    cost: 120,
    range: 300,
    fireRate: 0.4,
    damage: 50,
    splashDamage: 30,
    splashRadius: 52,
    speed: 330,
    turnRate: 4,
    maxLifetime: 3,
    radius: 20,
    maxHp: 110,
    upgradeCostMultiplier: 1.6,
  },
  mine: { cost: 15, triggerRadius: 34, blastRadius: 64, damage: 120 },
  tripwire: { cost: 25, length: 204, blasts: 5, blastRadius: 34, damage: 70 },
  trapDamagePerBaseLevel: 0.6,
  unlocks: { "machine-gun": 1, mortar: 1, barricade: 1, mine: 1, tripwire: 3, gatling: 5, rocket: 8 },
  barricade: { cost: 20, maxHp: 160, reinforce: { costs: [15, 25], perLevel: 0.5 } },
  repair: { structureShare: 0.5, rubbleShare: 0.6, strongholdCostPerHp: 0.25 },
  recycle: { intactShare: 0.5, rubbleShare: 0.25 },
  pathing: { blockedTileCost: 1000 },
  upgrades: {
    // tuned: per supply spent, an upgrade is roughly as strong as a new turret,
    // and the two paths multiply, so investing in one turret pays off.
    speed: { costs: [30, 50, 80], perLevel: 0.5 },
    strength: { costs: [30, 50, 80], perLevel: 0.5 },
    range: { costs: [25, 40, 60], perLevel: 0.2 },
  },
  enemies: {
    walker: { maxHp: 26, speed: 33, radius: 12, structureDamage: 8, attackCooldown: 1, drop: { chance: 0.6, min: 3, max: 6 } },
    runner: { maxHp: 14, speed: 71, radius: 9, structureDamage: 5, attackCooldown: 0.6, drop: { chance: 0.5, min: 2, max: 4 } },
    brute: { maxHp: 150, speed: 19, radius: 19, structureDamage: 30, attackCooldown: 1.4, drop: { chance: 1, min: 12, max: 20 } },
  },
  wave: { prepSeconds: 20, warningSeconds: 3, edges: ["north", "south", "east", "west"] },
  waves: {
    baseCount: 40,
    countPerWave: 6,
    hpGrowthPerWave: 0.27, // tuned with scripts/balance.mjs: sensible player falls around waves 11-15 and takes hits from wave 1
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
    packFrom: 2,
    packShareBase: 0.3,
    packSharePerWave: 0.03,
    packShareMax: 0.6,
    packSizeBase: 8,
    packSizePerWave: 0.5,
    packSizeMax: 16,
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
    stronghold: { ...base.stronghold, maxHp: 1e9, levels: [{ cost: 0, machineGuns: 99, mortars: 99, gatlings: 99, rockets: 99, traps: 99, maxHp: 1e9 }] },
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
      packFrom: 1e9,
    },
  };
}
