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
  shotguns: number;
  flamers: number;
  /** Mines and trip wires together. */
  traps: number;
  maxHp: number;
}

export type SurvivorPerk = "collector" | "marksman" | "mechanic";
export interface SurvivorDef {
  id: string;
  name: string;
  role: string;
  /** Permanent Salvage to unlock, once. */
  cost: number;
  maxHp: number;
  speed: number;
  range: number;
  fireRate: number;
  /** Damage per bullet (per pellet when `pellets` > 1). */
  damage: number;
  pellets: number;
  /**
   * collector: runs to pickups and grabs them. marksman: picks the toughest
   * target and does `perkValue` times damage to brutes. mechanic: repairs the
   * stronghold by `perkValue` health per second while near it.
   */
  perk: SurvivorPerk;
  perkValue: number;
  perkText: string;
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
    /** Tiles kept clear beside the door for the salvage truck to park on. Nothing can be built there. */
    truckBay: [number, number][];
  };
  economy: { startCurrency: number };
  /**
   * Salvage: the permanent stockpile that survives defeat. It comes only from
   * salvage runs (a share of every haul unloaded) and can be turned into extra
   * starting Supplies at the beginning of a later run, up to a cap per run.
   * Run Supplies themselves are always lost on defeat.
   */
  salvage: { shareOfHaul: number; suppliesPerSalvage: number; maxStartBonus: number };
  /**
   * Survivors: fighters unlocked for good with permanent Salvage. They act on
   * their own: hold a post near the stronghold, shoot what comes in range,
   * keep their distance, and fall back to the door to recover when badly
   * hurt. Zombies that get close attack them. One who goes down is out until
   * the next wave. Once per run, if the stronghold would fall while a
   * survivor is still standing, they make a last stand instead.
   */
  survivors: {
    /** How far from the stronghold's centre they will roam. */
    leash: number;
    /** Zombies this close to a survivor go for them. */
    aggroRadius: number;
    /** Below this share of health they fall back to the door. */
    retreatBelow: number;
    /** Health regained per second while sheltering at the door. */
    regenPerSecond: number;
    /** Extra damage per base level above the first (0.35 = +35% each). */
    damagePerBaseLevel: number;
    projectileSpeed: number;
    lastStand: { healShare: number; shieldSeconds: number };
    roster: SurvivorDef[];
  };
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
  /** Shotgun: short range; each shot is a fan of pellets that fade at the end of their reach. */
  shotgun: {
    cost: number;
    range: number;
    fireRate: number;
    pellets: number;
    /** Damage per pellet at level 0. */
    damage: number;
    /** Full width of the fan, radians. */
    spread: number;
    projectileSpeed: number;
    radius: number;
    maxHp: number;
    upgradeCostMultiplier: number;
  };
  /**
   * Flamethrower: very short range; every tick burns every zombie inside its
   * cone, and sets them alight so they keep taking damage for a while.
   */
  flamer: {
    cost: number;
    range: number;
    /** Half-width of the cone, radians. */
    halfAngle: number;
    /** Damage ticks per second at level 0, and damage per tick. */
    fireRate: number;
    damage: number;
    burnSeconds: number;
    /** Burn damage per second, as a share of the flame's damage per second. */
    burnShare: number;
    radius: number;
    maxHp: number;
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
  /** The base level (1 = the starting base) from which each kind can be built. */
  unlocks: Record<"machine-gun" | "gatling" | "rocket" | "mortar" | "shotgun" | "flamer" | "barricade" | "mine" | "tripwire", number>;
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
    /** Repairs and re-arming during an assault cost this many times the normal price. */
    assaultMultiplier: number;
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
  /**
   * Pickups: icons that appear inside the fence during an assault. Tap one
   * before it fades to collect it. "health" repairs the stronghold at once;
   * "supplies" adds Supplies.
   */
  pickups: {
    /** Seconds between pickups, rolled in this range. 0 max = never. */
    everyMin: number;
    everyMax: number;
    lifeSeconds: number;
    /** How close a tap must be to collect. */
    tapRadius: number;
    /** Chance a pickup is health (only when the stronghold is damaged). */
    healthChance: number;
    /** Health restored, as a share of the stronghold's maximum. */
    healShare: number;
    suppliesMin: number;
    suppliesMax: number;
  };
  /**
   * The charge meter: kills fill it; when full the player triggers one boost
   * during an assault. Overdrive speeds every weapon up; Bounty multiplies
   * Supplies from kills. No charge builds while a boost is running.
   */
  /**
   * The salvage truck. Queue a run between waves; it drives out when the
   * assault starts, is away for the rest of that wave, comes back during the
   * next one and unloads beside the stronghold. Zombies near it attack it on
   * the way out, on the way back and while it unloads; if it is destroyed the
   * load is lost. What happens off screen is rolled when it leaves the field.
   */
  truck: {
    cost: number;
    maxHp: number;
    speed: number;
    /** Radians per second it can turn; it slows down in tight turns. */
    turnRate: number;
    /** How quickly it picks up speed and how hard it can brake, per second. */
    accel: number;
    brake: number;
    length: number;
    width: number;
    /** Zombies this close to it go for the truck instead of the base. */
    aggroRadius: number;
    unloadSeconds: number;
    /** Seconds into the next assault before it reappears, rolled in this range. */
    returnMin: number;
    returnMax: number;
    /** Supplies brought back on a normal success: rolled in this range, plus `loadPerWave` per wave reached. */
    loadMin: number;
    loadMax: number;
    loadPerWave: number;
    /** Chances of the other outcomes; the rest are normal successes. A jackpot doubles the load and fills the charge meter. */
    odds: { jackpot: number; empty: number; lost: number };
  };
  boost: {
    killsToFill: number;
    overdrive: { seconds: number; fireRate: number };
    bounty: { seconds: number; drops: number };
    /**
     * Airstrike: crosshairs mark a line of drop zones through the thickest
     * crowd, then bombs land one after another. Never on the stronghold.
     * Damage is `damageWalkers` times a walker's health on the current wave.
     */
    airstrike: { bombs: number; spacing: number; radius: number; warnSeconds: number; interval: number; damageWalkers: number; unlockBase: number };
    /** Force field: the stronghold takes no damage and regains health while it runs. */
    shield: { seconds: number; regenPerSecond: number; unlockBase: number };
  };
  /** Provisional design target used by scripts/balance.mjs, not by the game. */
  balance: { typicalDefeatWaveMin: number; typicalDefeatWaveMax: number };
}

export const baseConfig: GameConfig = {
  world: { width: 720, height: 1280 },
  currencyLabel: "Supplies",
  stronghold: {
    x: 360,
    y: 640,
    halfSize: 41,
    maxHp: 400,
    levels: [
      { cost: 0, machineGuns: 3, mortars: 1, gatlings: 1, rockets: 1, shotguns: 2, flamers: 1, traps: 6, maxHp: 400 },
      { cost: 100, machineGuns: 5, mortars: 2, gatlings: 1, rockets: 1, shotguns: 2, flamers: 1, traps: 10, maxHp: 480 },
      { cost: 180, machineGuns: 7, mortars: 3, gatlings: 1, rockets: 1, shotguns: 3, flamers: 1, traps: 14, maxHp: 560 },
      { cost: 280, machineGuns: 9, mortars: 4, gatlings: 2, rockets: 1, shotguns: 4, flamers: 2, traps: 18, maxHp: 640 },
      { cost: 400, machineGuns: 12, mortars: 5, gatlings: 3, rockets: 2, shotguns: 5, flamers: 3, traps: 24, maxHp: 720 },
    ],
  },
  construction: {
    tileSize: 64,
    origin: { x: 40, y: 0 },
    perimeter: [
      [180, 165], [360, 105], [545, 160], [665, 420], [625, 640], [665, 860],
      [560, 1135], [360, 1175], [185, 1120], [55, 860], [95, 640], [55, 420],
    ],
    truckBay: [
      [4, 11],
      [5, 11],
    ],
    invalidTerrain: [
      [2, 7],
      [7, 13],
      [4, 14],
    ],
  },
  economy: { startCurrency: 100 },
  salvage: { shareOfHaul: 0.2, suppliesPerSalvage: 1, maxStartBonus: 150 },
  survivors: {
    leash: 190,
    aggroRadius: 55,
    retreatBelow: 0.35,
    regenPerSecond: 6,
    damagePerBaseLevel: 0.35,
    projectileSpeed: 640,
    lastStand: { healShare: 0.25, shieldSeconds: 5 },
    roster: [
      { id: "scout", name: "Ray", role: "Scout", cost: 60, maxHp: 90, speed: 92, range: 150, fireRate: 4, damage: 3, pellets: 1, perk: "collector", perkValue: 0, perkText: "Grabs pickups for you" },
      { id: "marksman", name: "Dutch", role: "Marksman", cost: 120, maxHp: 110, speed: 62, range: 240, fireRate: 0.9, damage: 22, pellets: 1, perk: "marksman", perkValue: 1.5, perkText: "Hunts brutes, +50% damage to them" },
      { id: "mechanic", name: "Patch", role: "Mechanic", cost: 180, maxHp: 150, speed: 66, range: 120, fireRate: 1.1, damage: 5, pellets: 5, perk: "mechanic", perkValue: 1.2, perkText: "Shotgun; repairs the base as she fights" },
    ],
  },
  turret: { cost: 50, range: 174, fireRate: 5, damage: 4, projectileSpeed: 574, radius: 18, maxHp: 120 },
  mortar: {
    cost: 80,
    range: 353,
    minRange: 104,
    fireRate: 0.5,
    damage: 30,
    blastRadius: 60,
    shellBaseSeconds: 0.5,
    shellSpeed: 565,
    radius: 19,
    maxHp: 100,
    upgradeCostMultiplier: 1.5,
  },
  shotgun: { cost: 60, range: 135, fireRate: 1.2, pellets: 6, damage: 6, spread: 0.42, projectileSpeed: 600, radius: 19, maxHp: 130, upgradeCostMultiplier: 1.2 },
  flamer: { cost: 110, range: 115, halfAngle: 0.42, fireRate: 10, damage: 1.3, burnSeconds: 2.5, burnShare: 0.25, radius: 19, maxHp: 130, upgradeCostMultiplier: 1.4 },
  gatling: {
    cost: 90,
    range: 151,
    minRate: 3,
    maxRate: 16,
    spinUpSeconds: 1.6,
    spinDownSeconds: 1.2,
    damage: 2.5,
    projectileSpeed: 640,
    radius: 19,
    maxHp: 140,
    upgradeCostMultiplier: 1.3,
  },
  rocket: {
    cost: 120,
    range: 282,
    fireRate: 0.4,
    damage: 50,
    splashDamage: 30,
    splashRadius: 49,
    speed: 311,
    turnRate: 4,
    maxLifetime: 3,
    radius: 19,
    maxHp: 110,
    upgradeCostMultiplier: 1.6,
  },
  mine: { cost: 15, triggerRadius: 32, blastRadius: 60, damage: 120 },
  tripwire: { cost: 25, length: 192, blasts: 5, blastRadius: 32, damage: 70 },
  trapDamagePerBaseLevel: 0.6,
  unlocks: { "machine-gun": 1, mortar: 1, barricade: 1, mine: 1, tripwire: 2, shotgun: 2, gatling: 3, flamer: 3, rocket: 4 },
  barricade: { cost: 20, maxHp: 160, reinforce: { costs: [15, 25], perLevel: 0.5 } },
  repair: { structureShare: 0.5, rubbleShare: 0.6, strongholdCostPerHp: 0.25, assaultMultiplier: 1.5 },
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
    walker: { maxHp: 26, speed: 31, radius: 11, structureDamage: 8, attackCooldown: 1, drop: { chance: 0.6, min: 3, max: 6 } },
    runner: { maxHp: 14, speed: 67, radius: 8, structureDamage: 5, attackCooldown: 0.6, drop: { chance: 0.5, min: 2, max: 4 } },
    brute: { maxHp: 150, speed: 18, radius: 18, structureDamage: 30, attackCooldown: 1.4, drop: { chance: 1, min: 12, max: 20 } },
  },
  wave: { prepSeconds: 20, warningSeconds: 3, edges: ["north", "south", "east", "west"] },
  waves: {
    baseCount: 40,
    countPerWave: 6,
    hpGrowthPerWave: 0.285, // tuned with scripts/balance.mjs: sensible player falls around waves 11-15 and takes hits from wave 1
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
  pickups: { everyMin: 10, everyMax: 18, lifeSeconds: 7, tapRadius: 48, healthChance: 0.55, healShare: 0.1, suppliesMin: 12, suppliesMax: 25 },
  truck: {
    cost: 60,
    maxHp: 260,
    speed: 95,
    turnRate: 2.4,
    accel: 70,
    brake: 150,
    length: 72,
    width: 32,
    aggroRadius: 110,
    unloadSeconds: 8,
    returnMin: 4,
    returnMax: 12,
    loadMin: 130,
    loadMax: 190,
    loadPerWave: 8,
    odds: { jackpot: 0.1, empty: 0.2, lost: 0.1 },
  },
  boost: { killsToFill: 90, overdrive: { seconds: 8, fireRate: 2 }, bounty: { seconds: 12, drops: 3 },
    airstrike: { bombs: 9, spacing: 95, radius: 100, warnSeconds: 1.2, interval: 0.16, damageWalkers: 3, unlockBase: 2 },
    shield: { seconds: 6, regenPerSecond: 0.04, unlockBase: 3 },
  },
  balance: { typicalDefeatWaveMin: 10, typicalDefeatWaveMax: 18 },
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
    stronghold: { ...base.stronghold, maxHp: 1e9, levels: [{ cost: 0, machineGuns: 99, mortars: 99, gatlings: 99, rockets: 99, shotguns: 99, flamers: 99, traps: 99, maxHp: 1e9 }] },
    // Long range and slow walkers keep projectiles in flight for a steady load,
    // instead of collapsing to point-blank shots once walkers reach the turrets.
    turret: { ...base.turret, cost: 0, fireRate: 100, damage: 0, range: 1500 },
    enemies: { ...base.enemies, walker: { ...base.enemies.walker, maxHp: 1e9, speed: 1.5 } },
    wave: { ...base.wave, prepSeconds: 1, warningSeconds: 0 },
    pickups: { ...base.pickups, everyMax: 0 },
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
