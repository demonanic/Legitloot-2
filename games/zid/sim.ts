/**
 * Pure, deterministic game simulation.
 *
 * No DOM, no clock, no Math.random: given the same seed, config and commands,
 * the state after N steps is identical. All state is plain JSON.
 */

import { ENEMY_TYPES, type Edge, type EnemyType, type GameConfig } from "./config.js";
import { tileCenter, tileOrigin, tileStatus, type TileStatus } from "./grid.js";
import { clampTile, nextTile, pathField } from "./path.js";
import { wavePlan } from "./waves.js";

/** The run is endless: prep -> warning -> wave repeats until the stronghold falls ("lost"). */
export type Phase = "prep" | "warning" | "wave" | "lost";

export type UpgradePathId = "speed" | "strength" | "range";
export const UPGRADE_PATHS: readonly UpgradePathId[] = ["speed", "strength", "range"];

export interface Turret {
  cooldown: number;
  /** Upgrade levels; a turret may take both paths. */
  speed: number;
  strength: number;
  /** Range level (machine gun only). */
  range: number;
  /** Radians; for drawing only. */
  aim: number;
  targetId: number | null;
  /** Mortars only: where the player told this mortar to fire this assault. */
  aimPoint: { x: number; y: number } | null;
  /** Game time of the last shot, for recoil, flash and smoke. */
  lastShot: number;
  /** Gatling only: 0..1 how far spun up, and the barrel angle for drawing. */
  spin: number;
  barrel: number;
}

export type StructureKind = "machine-gun" | "gatling" | "rocket" | "mortar" | "barricade" | "mine" | "tripwire";
export const TURRET_KINDS: readonly StructureKind[] = ["machine-gun", "gatling", "rocket", "mortar"];
export const TRAP_KINDS: readonly StructureKind[] = ["mine", "tripwire"];
export const ALL_KINDS: readonly StructureKind[] = ["machine-gun", "gatling", "rocket", "mortar", "mine", "tripwire", "barricade"];

export function isTrap(kind: StructureKind): boolean {
  return kind === "mine" || kind === "tripwire";
}

/** Player-facing names. */
export const KIND_NAMES: Record<StructureKind, string> = {
  "machine-gun": "Machine gun",
  gatling: "Gatling gun",
  rocket: "Rocket launcher",
  mortar: "Mortar",
  barricade: "Barricade",
  mine: "Proximity mine",
  tripwire: "Trip wire",
};

/** Anything built on a construction tile. */
export interface Structure {
  id: number;
  kind: StructureKind;
  col: number;
  row: number;
  /** Tile centre, world units. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Destroyed structures are rubble: they keep the tile, stop working and no longer block. */
  destroyed: boolean;
  /** Supplies spent on it so far (build, upgrades, reinforcement); basis for repair and recycle. */
  spent: number;
  /** Barricade reinforcement level. */
  reinforce: number;
  /** Turret state for weapons; null for barricades and traps. */
  turret: Turret | null;
  /** Trip wires: the wire's angle (radians), across the zombies' approach. */
  facing: number;
}

/** A rocket in flight, homing on `targetId`. `trail` is for drawing only. */
export interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetId: number | null;
  damage: number;
  splash: number;
  life: number;
  trail: [number, number][];
}

/** A short on-screen notice, e.g. an unlock. For drawing only. */
export interface Notice {
  text: string;
  life: number;
}

/** A mortar shell in flight. It lands at (tx, ty) when `left` reaches 0. */
export interface Shell {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  total: number;
  left: number;
  damage: number;
  radius: number;
}

/** A floating "+N" where a zombie dropped Supplies, for drawing only. */
export interface Popup {
  x: number;
  y: number;
  amount: number;
  life: number;
}

/** A brief explosion marker, for drawing only. */
export interface Blast {
  x: number;
  y: number;
  r: number;
  life: number;
}

export interface Enemy {
  id: number;
  type: EnemyType;
  maxHp: number;
  x: number;
  y: number;
  hp: number;
  attackCooldown: number;
  attacking: boolean;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  life: number;
}

export interface Spawn {
  at: number;
  type: EnemyType;
  hp: number;
  x: number;
  y: number;
}

export interface GameState {
  seed: number;
  rng: number;
  phase: Phase;
  /** Seconds left in prep / warning. */
  phaseTimer: number;
  /** Seconds since the current wave started. */
  waveTime: number;
  /** Current wave number, starting at 1. */
  wave: number;
  /** Waves fully cleared this run. */
  wavesCleared: number;
  /** Total simulated seconds. */
  time: number;
  currency: number;
  stronghold: { x: number; y: number; halfSize: number; hp: number; maxHp: number; level: number };
  structures: Structure[];
  nextStructureId: number;
  /** Bumped whenever anything that affects zombie pathing changes. */
  layoutVersion: number;
  enemies: Enemy[];
  projectiles: Projectile[];
  shells: Shell[];
  rockets: Rocket[];
  blasts: Blast[];
  notices: Notice[];
  /** Floating "+N" Supplies from kills, for drawing only. */
  popups: Popup[];
  spawns: Spawn[];
  nextSpawn: number;
  nextEnemyId: number;
  kills: number;
  /** Supplies earned from kills this run (for reports). */
  earned: number;
  spawned: number;
  shotsFired: number;
  damageTaken: number;
}

/** mulberry32, stored as a plain number in state so it serialises. */
function nextRandom(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function edgePoint(s: GameState, cfg: GameConfig, edge: Edge, radius: number): { x: number; y: number } {
  const { width: w, height: h } = cfg.world;
  const pad = radius + 4;
  const u = nextRandom(s);
  switch (edge) {
    case "north":
      return { x: pad + u * (w - 2 * pad), y: -pad };
    case "south":
      return { x: pad + u * (w - 2 * pad), y: h + pad };
    case "west":
      return { x: -pad, y: pad + u * (h - 2 * pad) };
    case "east":
      return { x: w + pad, y: pad + u * (h - 2 * pad) };
  }
}

export function createState(cfg: GameConfig, seed: number): GameState {
  const sh = cfg.stronghold;
  const s: GameState = {
    seed,
    rng: seed | 0,
    phase: cfg.wave.prepSeconds > 0 ? "prep" : cfg.wave.warningSeconds > 0 ? "warning" : "wave",
    phaseTimer: cfg.wave.prepSeconds > 0 ? cfg.wave.prepSeconds : cfg.wave.warningSeconds,
    waveTime: 0,
    wave: 1,
    wavesCleared: 0,
    time: 0,
    currency: cfg.economy.startCurrency,
    stronghold: { x: sh.x, y: sh.y, halfSize: sh.halfSize, hp: sh.levels[0]?.maxHp ?? sh.maxHp, maxHp: sh.levels[0]?.maxHp ?? sh.maxHp, level: 0 },
    structures: [],
    nextStructureId: 1,
    layoutVersion: 0,
    enemies: [],
    projectiles: [],
    shells: [],
    rockets: [],
    blasts: [],
    notices: [],
    popups: [],
    spawns: [],
    nextSpawn: 0,
    nextEnemyId: 1,
    kills: 0,
    earned: 0,
    spawned: 0,
    shotsFired: 0,
    damageTaken: 0,
  };
  rollWave(s, cfg);
  return s;
}

function pickType(s: GameState, mix: Record<EnemyType, number>): EnemyType {
  let u = nextRandom(s);
  for (const t of ENEMY_TYPES) {
    if (u < mix[t]) return t;
    u -= mix[t];
  }
  return "walker";
}

/** Pre-roll the current wave's spawn schedule from its plan, so it is fixed by the seed. */
function rollWave(s: GameState, cfg: GameConfig): void {
  s.spawns = [];
  s.nextSpawn = 0;
  s.waveTime = 0;
  const plan = wavePlan(cfg, s.wave);
  const edges = cfg.wave.edges;
  // A lopsided wave favours one side, chosen by the seed.
  const main = plan.lopsidedShare > 0 ? edges[Math.floor(nextRandom(s) * edges.length)] : undefined;
  const n = plan.count;
  // Packs: tight clumps from one spot at one moment, at random times in the window.
  const packs = plan.packShare > 0 && plan.packSize > 1 ? Math.floor((n * plan.packShare) / plan.packSize) : 0;
  for (let g = 0; g < packs; g++) {
    const edge = main ?? edges[Math.floor(nextRandom(s) * edges.length)] ?? "north";
    const at = nextRandom(s) * plan.spawnSeconds;
    for (let k = 0; k < plan.packSize; k++) {
      const type = pickType(s, plan.mix);
      const p = edgePoint(s, cfg, edge, cfg.enemies[type].radius);
      const hp = Math.round(cfg.enemies[type].maxHp * plan.hpMultiplier);
      if (k > 0) {
        // Keep the pack together: members land near the leader.
        const lead = s.spawns[s.spawns.length - k]!;
        const spread = (nextRandom(s) - 0.5) * 90;
        if (edge === "north" || edge === "south") p.x = Math.min(cfg.world.width - 20, Math.max(20, lead.x + spread));
        else p.y = Math.min(cfg.world.height - 20, Math.max(20, lead.y + spread));
      }
      s.spawns.push({ at: at + k * 0.15, type, hp, x: p.x, y: p.y });
    }
  }
  const rest = n - packs * plan.packSize;
  const gap = rest > 1 ? plan.spawnSeconds / rest : 0;
  for (let i = 0; i < rest; i++) {
    const type = pickType(s, plan.mix);
    const roll = nextRandom(s);
    const edge = main && roll < plan.lopsidedShare ? main : edges[Math.floor(nextRandom(s) * edges.length)] ?? "north";
    const jitter = (nextRandom(s) - 0.5) * gap * 0.8;
    const p = edgePoint(s, cfg, edge, cfg.enemies[type].radius);
    const hp = Math.round(cfg.enemies[type].maxHp * plan.hpMultiplier);
    s.spawns.push({ at: Math.max(0, i * gap + jitter), type, hp, x: p.x, y: p.y });
  }
  s.spawns.sort((a, b) => a.at - b.at);
}

export type BuildRejection =
  | "run-over"
  | "assault-active"
  | Exclude<TileStatus, "buildable">
  | "occupied"
  | "limit-reached"
  | "locked"
  | "insufficient-funds";

export type BuildResult = { ok: true; structure: Structure } | { ok: false; reason: BuildRejection };

/** The structure on a tile, if any. */
export function structureAt(s: GameState, col: number, row: number): Structure | null {
  return s.structures.find((st) => st.col === col && st.row === row) ?? null;
}

export function buildCost(cfg: GameConfig, kind: StructureKind): number {
  switch (kind) {
    case "barricade":
      return cfg.barricade.cost;
    case "mortar":
      return cfg.mortar.cost;
    case "gatling":
      return cfg.gatling.cost;
    case "rocket":
      return cfg.rocket.cost;
    case "mine":
      return cfg.mine.cost;
    case "tripwire":
      return cfg.tripwire.cost;
    default:
      return cfg.turret.cost;
  }
}

function kindMaxHp(cfg: GameConfig, kind: StructureKind): number {
  switch (kind) {
    case "barricade":
      return cfg.barricade.maxHp;
    case "mortar":
      return cfg.mortar.maxHp;
    case "gatling":
      return cfg.gatling.maxHp;
    case "rocket":
      return cfg.rocket.maxHp;
    case "mine":
    case "tripwire":
      return 1;
    default:
      return cfg.turret.maxHp;
  }
}

/** Whether this kind can be built yet in the run. */
export function isUnlocked(s: GameState, cfg: GameConfig, kind: StructureKind): boolean {
  return s.wave >= cfg.unlocks[kind];
}

/**
 * Why a structure could not be built on a tile right now, or null if it can.
 * Pure: never changes state. The UI uses this for previews; the simulation
 * uses it to validate. Rubble still occupies its tile.
 */
export function checkBuild(s: GameState, cfg: GameConfig, col: number, row: number, kind: StructureKind = "machine-gun"): BuildRejection | null {
  if (s.phase === "lost") return "run-over";
  if (s.phase === "wave") return "assault-active";
  const status = tileStatus(cfg, col, row);
  if (status !== "buildable") return status;
  if (structureAt(s, col, row)) return "occupied";
  if (!isUnlocked(s, cfg, kind)) return "locked";
  const limit = buildLimit(s, cfg, kind);
  if (limit !== null && countKind(s, kind) >= limit) return "limit-reached";
  if (s.currency < buildCost(cfg, kind)) return "insufficient-funds";
  return null;
}

/** How many of this kind the current base level allows; null = no limit. Rubble counts. */
export function buildLimit(s: GameState, cfg: GameConfig, kind: StructureKind): number | null {
  const lvl = baseLevel(s, cfg);
  switch (kind) {
    case "barricade":
      return null;
    case "mortar":
      return lvl.mortars;
    case "gatling":
      return lvl.gatlings;
    case "rocket":
      return lvl.rockets;
    case "mine":
    case "tripwire":
      return lvl.traps;
    default:
      return lvl.machineGuns;
  }
}

/** How many count against this kind's limit (mines and trip wires share one). Spent traps and rubble count. */
export function countKind(s: GameState, kind: StructureKind): number {
  if (isTrap(kind)) return s.structures.filter((st) => isTrap(st.kind)).length;
  return s.structures.filter((st) => st.kind === kind).length;
}

function baseLevel(s: GameState, cfg: GameConfig) {
  const levels = cfg.stronghold.levels;
  return levels[Math.min(s.stronghold.level, levels.length - 1)]!;
}

/** Price of the next base upgrade, or null at the top level. */
export function nextBaseUpgradeCost(s: GameState, cfg: GameConfig): number | null {
  const next = cfg.stronghold.levels[s.stronghold.level + 1];
  return next ? next.cost : null;
}

export function checkBaseUpgrade(s: GameState, cfg: GameConfig): ManageRejection | null {
  if (s.phase === "lost") return "run-over";
  if (s.phase === "wave") return "assault-active";
  const cost = nextBaseUpgradeCost(s, cfg);
  if (cost === null) return "max-level";
  if (s.currency < cost) return "insufficient-funds";
  return null;
}

/**
 * Upgrade the base: more machine guns and mortars allowed, and more
 * stronghold health (the added health comes already repaired).
 */
export function upgradeBase(s: GameState, cfg: GameConfig): ManageResult {
  const reason = checkBaseUpgrade(s, cfg);
  if (reason) return { ok: false, reason };
  s.currency -= nextBaseUpgradeCost(s, cfg)!;
  s.stronghold.level++;
  const max = baseLevel(s, cfg).maxHp;
  s.stronghold.hp += max - s.stronghold.maxHp;
  s.stronghold.maxHp = max;
  return { ok: true };
}

/**
 * Build a structure on a construction tile. Validation happens before any
 * state change; a rejected build never deducts currency. Construction is a
 * preparation action: it is refused while an assault is active.
 */
export function buildStructure(s: GameState, cfg: GameConfig, kind: StructureKind, col: number, row: number): BuildResult {
  const reason = checkBuild(s, cfg, col, row, kind);
  if (reason) return { ok: false, reason };
  const cost = buildCost(cfg, kind);
  s.currency -= cost;
  const c = tileCenter(cfg, col, row);
  const maxHp = kindMaxHp(cfg, kind);
  // Trip wires stretch across the line from the tile to the stronghold.
  const facing = Math.atan2(s.stronghold.y - c.y, s.stronghold.x - c.x) + Math.PI / 2;
  const structure: Structure = {
    id: s.nextStructureId++,
    kind,
    col,
    row,
    x: c.x,
    y: c.y,
    hp: maxHp,
    maxHp,
    destroyed: false,
    spent: cost,
    reinforce: 0,
    turret: TURRET_KINDS.includes(kind)
      ? { cooldown: 0, speed: 0, strength: 0, range: 0, aim: -Math.PI / 2, targetId: null, aimPoint: null, lastShot: -1e9, spin: 0, barrel: 0 }
      : null,
    facing,
  };
  s.structures.push(structure);
  s.layoutVersion++;
  return { ok: true, structure };
}

/** Build a machine-gun turret. */
export function buildTurret(s: GameState, cfg: GameConfig, col: number, row: number): BuildResult {
  return buildStructure(s, cfg, "machine-gun", col, row);
}

/** Build a mortar. */
export function buildMortar(s: GameState, cfg: GameConfig, col: number, row: number): BuildResult {
  return buildStructure(s, cfg, "mortar", col, row);
}

/** Build a barricade. */
export function buildBarricade(s: GameState, cfg: GameConfig, col: number, row: number): BuildResult {
  return buildStructure(s, cfg, "barricade", col, row);
}

export type ManageRejection =
  | "run-over"
  | "assault-active"
  | "no-such-structure"
  | "not-a-turret"
  | "not-a-barricade"
  | "not-for-mortar"
  | "destroyed"
  | "nothing-to-repair"
  | "max-level"
  | "insufficient-funds";
export type ManageResult = { ok: true } | { ok: false; reason: ManageRejection };

export function structureById(s: GameState, id: number): Structure | null {
  return s.structures.find((st) => st.id === id) ?? null;
}

/** Cost of the next level on a path, or null at max level. */
export function nextUpgradeCost(cfg: GameConfig, st: Structure, path: UpgradePathId): number | null {
  if (!st.turret) return null;
  if (path === "range" && st.kind !== "machine-gun") return null;
  const costs = cfg.upgrades[path].costs;
  const level = st.turret[path];
  if (level >= costs.length) return null;
  const base = costs[level]!;
  // Heavier weapons' upgrades cost more, rounded to a multiple of 5.
  const mult =
    st.kind === "mortar" ? cfg.mortar.upgradeCostMultiplier : st.kind === "gatling" ? cfg.gatling.upgradeCostMultiplier : st.kind === "rocket" ? cfg.rocket.upgradeCostMultiplier : 1;
  return mult === 1 ? base : Math.round((base * mult) / 5) * 5;
}

/** Why an upgrade can't happen right now, or null if it can. Pure. */
export function checkUpgrade(s: GameState, cfg: GameConfig, id: number, path: UpgradePathId): ManageRejection | null {
  if (s.phase === "lost") return "run-over";
  if (s.phase === "wave") return "assault-active";
  const st = structureById(s, id);
  if (!st) return "no-such-structure";
  if (!st.turret) return "not-a-turret";
  if (path === "range" && st.kind !== "machine-gun") return "not-for-mortar";
  if (st.destroyed) return "destroyed";
  const cost = nextUpgradeCost(cfg, st, path);
  if (cost === null) return "max-level";
  if (s.currency < cost) return "insufficient-funds";
  return null;
}

/**
 * Raise one upgrade path on a turret by a level. Preparation only. A turret
 * may take both Speed and Strength. Rejections never deduct supplies.
 */
export function upgradeTurret(s: GameState, cfg: GameConfig, id: number, path: UpgradePathId): ManageResult {
  const reason = checkUpgrade(s, cfg, id, path);
  if (reason) return { ok: false, reason };
  const st = structureById(s, id)!;
  const cost = nextUpgradeCost(cfg, st, path)!;
  s.currency -= cost;
  st.spent += cost;
  st.turret![path]++;
  return { ok: true };
}

/** Cost of the next reinforcement level for a barricade, or null at max. */
export function nextReinforceCost(cfg: GameConfig, st: Structure): number | null {
  if (st.kind !== "barricade") return null;
  const costs = cfg.barricade.reinforce.costs;
  return st.reinforce < costs.length ? costs[st.reinforce]! : null;
}

export function checkReinforce(s: GameState, cfg: GameConfig, id: number): ManageRejection | null {
  if (s.phase === "lost") return "run-over";
  if (s.phase === "wave") return "assault-active";
  const st = structureById(s, id);
  if (!st) return "no-such-structure";
  if (st.kind !== "barricade") return "not-a-barricade";
  if (st.destroyed) return "destroyed";
  const cost = nextReinforceCost(cfg, st);
  if (cost === null) return "max-level";
  if (s.currency < cost) return "insufficient-funds";
  return null;
}

/** Reinforce a barricade: raises its maximum health and adds the same to its current health. */
export function reinforceBarricade(s: GameState, cfg: GameConfig, id: number): ManageResult {
  const reason = checkReinforce(s, cfg, id);
  if (reason) return { ok: false, reason };
  const st = structureById(s, id)!;
  const cost = nextReinforceCost(cfg, st)!;
  s.currency -= cost;
  st.spent += cost;
  st.reinforce++;
  const newMax = Math.round(cfg.barricade.maxHp * (1 + cfg.barricade.reinforce.perLevel * st.reinforce));
  st.hp += newMax - st.maxHp;
  st.maxHp = newMax;
  s.layoutVersion++;
  return { ok: true };
}

export type RepairTarget = { kind: "stronghold" } | { kind: "structure"; id: number };

export interface RepairQuote {
  /** Health restored if the repair goes ahead now (may be partial if supplies are short). */
  hp: number;
  cost: number;
  /** True when this rebuilds rubble. */
  rebuild: boolean;
}

/**
 * What a repair would restore and cost right now, or why it can't happen.
 * Intact structures and the stronghold repair in proportion to missing
 * health, partially if supplies run short. Rubble is rebuilt whole, with its
 * upgrades, for a fixed share of what was spent. Pure.
 */
export function repairQuote(s: GameState, cfg: GameConfig, target: RepairTarget): RepairQuote | ManageRejection {
  if (s.phase === "lost") return "run-over";
  if (s.phase === "wave") return "assault-active";
  if (target.kind === "stronghold") {
    const missing = s.stronghold.maxHp - s.stronghold.hp;
    if (missing <= 0) return "nothing-to-repair";
    const per = cfg.repair.strongholdCostPerHp;
    const hp = Math.min(missing, Math.floor(s.currency / per));
    if (hp <= 0) return "insufficient-funds";
    return { hp, cost: Math.ceil(hp * per), rebuild: false };
  }
  const st = structureById(s, target.id);
  if (!st) return "no-such-structure";
  if (st.destroyed) {
    const cost = Math.ceil(st.spent * cfg.repair.rubbleShare);
    if (s.currency < cost) return "insufficient-funds";
    return { hp: st.maxHp, cost, rebuild: true };
  }
  const missing = st.maxHp - st.hp;
  if (missing <= 0) return "nothing-to-repair";
  const per = (st.spent * cfg.repair.structureShare) / st.maxHp;
  const hp = per > 0 ? Math.min(missing, Math.floor(s.currency / per)) : missing;
  if (hp <= 0) return "insufficient-funds";
  return { hp, cost: Math.ceil(hp * per), rebuild: false };
}

/** Repair the stronghold or a structure (including rebuilding rubble). Preparation only. */
export function repair(s: GameState, cfg: GameConfig, target: RepairTarget): ManageResult {
  const q = repairQuote(s, cfg, target);
  if (typeof q === "string") return { ok: false, reason: q };
  s.currency -= q.cost;
  if (target.kind === "stronghold") {
    s.stronghold.hp = Math.min(s.stronghold.maxHp, s.stronghold.hp + q.hp);
    return { ok: true };
  }
  const st = structureById(s, target.id)!;
  if (q.rebuild) {
    st.destroyed = false;
    st.hp = st.maxHp;
    if (st.turret) st.turret.cooldown = 0;
  } else {
    st.hp = Math.min(st.maxHp, st.hp + q.hp);
  }
  s.layoutVersion++;
  return { ok: true };
}

/** Supplies returned for recycling a structure now: a share of what was spent. */
export function recycleValue(cfg: GameConfig, st: Structure): number {
  return Math.floor(st.spent * (st.destroyed ? cfg.recycle.rubbleShare : cfg.recycle.intactShare));
}

/** Damage a structure; at 0 health it becomes rubble. Returns true if this hit destroyed it. */
export function damageStructure(s: GameState, st: Structure, amount: number): boolean {
  if (st.destroyed) return false;
  st.hp -= amount;
  s.layoutVersion++;
  if (st.hp <= 0) {
    st.hp = 0;
    st.destroyed = true;
    if (st.turret) st.turret.targetId = null;
    return true;
  }
  return false;
}

/** Effective shots per second and damage per shot for a turret or mortar, after upgrades. */
export function turretStats(cfg: GameConfig, t: Turret, kind: StructureKind = "machine-gun"): { fireRate: number; damage: number } {
  const g = cfg.gatling;
  const rate =
    kind === "mortar" ? cfg.mortar.fireRate : kind === "rocket" ? cfg.rocket.fireRate : kind === "gatling" ? g.minRate + (g.maxRate - g.minRate) * t.spin : cfg.turret.fireRate;
  const dmg = kind === "mortar" ? cfg.mortar.damage : kind === "rocket" ? cfg.rocket.damage : kind === "gatling" ? g.damage : cfg.turret.damage;
  return {
    fireRate: rate * (1 + cfg.upgrades.speed.perLevel * t.speed),
    damage: dmg * (1 + cfg.upgrades.strength.perLevel * t.strength),
  };
}

export type AimRejection = "not-in-assault" | "no-mortars" | "out-of-reach";
export type AimResult = { ok: true; action: "aimed" | "freed"; mortarId: number } | { ok: false; reason: AimRejection };

/** Whether a working mortar can drop a shell on this point. */
export function mortarReaches(cfg: GameConfig, st: Structure, x: number, y: number): boolean {
  const d = Math.hypot(x - st.x, y - st.y);
  return st.kind === "mortar" && !st.destroyed && d >= cfg.mortar.minRange && d <= cfg.mortar.range;
}

/** Distance within which a tap counts as tapping an existing crosshair. */
export const AIM_TAP_RADIUS = 60;

/**
 * Tap-to-aim during an assault, one mortar per tap ("split fire"):
 * - tapping an existing crosshair frees that mortar back to automatic;
 * - otherwise the closest mortar that can reach the spot and isn't aimed yet
 *   takes it; if every mortar in reach is already aimed, the closest one is
 *   moved here.
 * Crosshairs are cleared when the wave ends.
 */
export function aimMortars(s: GameState, cfg: GameConfig, point: { x: number; y: number }): AimResult {
  if (s.phase !== "wave") return { ok: false, reason: "not-in-assault" };
  const mortars = s.structures.filter((st) => st.kind === "mortar" && !st.destroyed && st.turret);
  if (mortars.length === 0) return { ok: false, reason: "no-mortars" };
  let hit: Structure | null = null;
  let hitD = AIM_TAP_RADIUS;
  for (const m of mortars) {
    const a = m.turret!.aimPoint;
    if (!a) continue;
    const d = Math.hypot(point.x - a.x, point.y - a.y);
    if (d <= hitD) {
      hit = m;
      hitD = d;
    }
  }
  if (hit) {
    hit.turret!.aimPoint = null;
    return { ok: true, action: "freed", mortarId: hit.id };
  }
  const reach = mortars
    .filter((m) => mortarReaches(cfg, m, point.x, point.y))
    .sort((a, b) => Math.hypot(point.x - a.x, point.y - a.y) - Math.hypot(point.x - b.x, point.y - b.y) || a.id - b.id);
  if (reach.length === 0) return { ok: false, reason: "out-of-reach" };
  const pick = reach.find((m) => !m.turret!.aimPoint) ?? reach[0]!;
  pick.turret!.aimPoint = { x: point.x, y: point.y };
  return { ok: true, action: "aimed", mortarId: pick.id };
}

/** Release every mortar back to automatic. */
export function releaseMortars(s: GameState): void {
  for (const st of s.structures) if (st.turret) st.turret.aimPoint = null;
}

export function mortarTarget(s: GameState, cfg: GameConfig, st: Structure): { x: number; y: number } | null {
  const m = cfg.mortar;
  const inReach = (x: number, y: number) => {
    const d = Math.hypot(x - st.x, y - st.y);
    return d >= m.minRange && d <= m.range;
  };
  const aim = st.turret?.aimPoint;
  if (aim && inReach(aim.x, aim.y)) return aim;
  let best: Enemy | null = null;
  let bestCount = 0;
  let bestD = Infinity;
  const r2 = m.blastRadius * m.blastRadius;
  for (const e of s.enemies) {
    if (e.hp <= 0 || !inReach(e.x, e.y)) continue;
    let count = 0;
    for (const o of s.enemies) {
      if (o.hp <= 0) continue;
      const dx = o.x - e.x;
      const dy = o.y - e.y;
      if (dx * dx + dy * dy <= r2) count++;
    }
    const d = Math.hypot(e.x - s.stronghold.x, e.y - s.stronghold.y);
    if (count > bestCount || (count === bestCount && (d < bestD || (d === bestD && best && e.id < best.id)))) {
      best = e;
      bestCount = count;
      bestD = d;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Recycle a structure or its rubble: it is removed, its tile freed, and a
 * share of what was spent returned (less for rubble). Preparation only.
 */
export function recycleStructure(s: GameState, cfg: GameConfig, id: number): ManageResult {
  if (s.phase === "lost") return { ok: false, reason: "run-over" };
  if (s.phase === "wave") return { ok: false, reason: "assault-active" };
  const i = s.structures.findIndex((st) => st.id === id);
  if (i === -1) return { ok: false, reason: "no-such-structure" };
  s.currency += recycleValue(cfg, s.structures[i]!);
  s.structures.splice(i, 1);
  s.layoutVersion++;
  return { ok: true };
}

/** Early launch: skip the rest of the preparation countdown and start the assault immediately. */
export function startWaveNow(s: GameState, _cfg: GameConfig): void {
  if (s.phase !== "prep") return;
  s.phase = "wave";
  s.phaseTimer = 0;
}

/**
 * Targeting rule (one simple default): the enemy in range that is closest to
 * the stronghold. Ties go to the lowest id, so the choice is deterministic.
 */
export function pickTarget(s: GameState, cfg: GameConfig, from: { x: number; y: number }, range = cfg.turret.range): Enemy | null {
  let best: Enemy | null = null;
  let bestD = Infinity;
  const r2 = range * range;
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    if (dx * dx + dy * dy > r2) continue;
    const d = Math.hypot(e.x - s.stronghold.x, e.y - s.stronghold.y);
    if (d < bestD || (d === bestD && best && e.id < best.id)) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** A machine gun's reach after Range upgrades (mortars use their own fixed range). */
export function turretRange(cfg: GameConfig, st: Structure): number {
  if (st.kind === "mortar") return cfg.mortar.range;
  if (st.kind === "gatling") return cfg.gatling.range;
  if (st.kind === "rocket") return cfg.rocket.range;
  return cfg.turret.range * (1 + cfg.upgrades.range.perLevel * (st.turret?.range ?? 0));
}

/** Roll a kill's random, type-weighted Supplies drop from the seeded RNG. */
export function rollDrop(s: GameState, cfg: GameConfig, type: EnemyType): number {
  const d = cfg.enemies[type].drop;
  if (nextRandom(s) >= d.chance) return 0;
  return d.min + Math.floor(nextRandom(s) * (d.max - d.min + 1));
}

/** Apply damage; returns true if this hit killed the enemy. A kill pays out exactly once. */
export function damageEnemy(s: GameState, cfg: GameConfig, e: Enemy, amount: number): boolean {
  if (e.hp <= 0) return false;
  e.hp -= amount;
  if (e.hp <= 0) {
    e.hp = 0;
    s.kills++;
    const drop = rollDrop(s, cfg, e.type);
    s.currency += drop;
    s.earned += drop;
    if (drop > 0 && s.popups.length < 80) s.popups.push({ x: e.x, y: e.y, amount: drop, life: POPUP_SECONDS });
    return true;
  }
  return false;
}

export const POPUP_SECONDS = 1;
export const BLAST_SECONDS = 0.9;

/** Distance from a point to the stronghold's square edge (0 when touching). */
function distanceToStronghold(s: GameState, x: number, y: number): number {
  const h = s.stronghold.halfSize;
  const dx = Math.max(Math.abs(x - s.stronghold.x) - h, 0);
  const dy = Math.max(Math.abs(y - s.stronghold.y) - h, 0);
  return Math.hypot(dx, dy);
}

export function step(s: GameState, cfg: GameConfig, dt: number): void {
  s.time += dt;
  if (s.phase === "lost") {
    stepProjectiles(s, cfg, dt);
    stepBlasts(s, dt);
    return;
  }

  if (s.phase === "prep" || s.phase === "warning") {
    s.phaseTimer -= dt;
    if (s.phaseTimer <= 0) {
      if (s.phase === "prep" && cfg.wave.warningSeconds > 0) {
        s.phase = "warning";
        s.phaseTimer = cfg.wave.warningSeconds;
      } else {
        s.phase = "wave";
        s.phaseTimer = 0;
      }
    }
  }

  if (s.phase === "wave") {
    s.waveTime += dt;
    while (s.nextSpawn < s.spawns.length && s.spawns[s.nextSpawn]!.at <= s.waveTime) {
      const sp = s.spawns[s.nextSpawn++]!;
      if (s.enemies.length >= cfg.limits.maxEnemies) continue;
      s.enemies.push({
        id: s.nextEnemyId++,
        type: sp.type,
        maxHp: sp.hp,
        x: sp.x,
        y: sp.y,
        hp: sp.hp,
        attackCooldown: 0,
        attacking: false,
      });
      s.spawned++;
    }
  }

  stepEnemies(s, cfg, dt);
  stepTraps(s, cfg);
  stepTurrets(s, cfg, dt);
  stepProjectiles(s, cfg, dt);
  stepRockets(s, cfg, dt);
  stepShells(s, cfg, dt);
  stepBlasts(s, dt);

  // Remove the dead.
  if (s.enemies.some((e) => e.hp <= 0)) s.enemies = s.enemies.filter((e) => e.hp > 0);

  if (s.stronghold.hp <= 0) {
    s.stronghold.hp = 0;
    s.phase = "lost";
  } else if (s.phase === "wave" && s.nextSpawn >= s.spawns.length && s.enemies.length === 0) {
    // Wave cleared: back to preparation for the next one.
    releaseMortars(s);
    s.shells = [];
    s.wavesCleared++;
    s.wave++;
    s.rockets = [];
    for (const k of ALL_KINDS) {
      if (cfg.unlocks[k] === s.wave && s.wave > 1) s.notices.push({ text: `Unlocked: ${KIND_NAMES[k]}`, life: 5 });
    }
    rollWave(s, cfg);
    if (cfg.wave.prepSeconds > 0) {
      s.phase = "prep";
      s.phaseTimer = cfg.wave.prepSeconds;
    } else if (cfg.wave.warningSeconds > 0) {
      s.phase = "warning";
      s.phaseTimer = cfg.wave.warningSeconds;
    }
  }
}

/** Distance from a point to a tile's square edge (0 when touching or inside). */
function distanceToTile(cfg: GameConfig, col: number, row: number, x: number, y: number): number {
  const t = cfg.construction.tileSize;
  const p = tileOrigin(cfg, col, row);
  const dx = Math.max(p.x - x, 0, x - (p.x + t));
  const dy = Math.max(p.y - y, 0, y - (p.y + t));
  return Math.hypot(dx, dy);
}

function moveToward(e: Enemy, tx: number, ty: number, maxMove: number): void {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-9) return;
  const m = Math.min(maxMove, len);
  e.x += (dx / len) * m;
  e.y += (dy / len) * m;
}

/** One hit's worth of attack timing. Returns true when a hit lands this step. */
function attackTick(e: Enemy, cooldown: number, dt: number): boolean {
  e.attacking = true;
  e.attackCooldown -= dt;
  if (e.attackCooldown > 0) return false;
  e.attackCooldown += cooldown;
  return true;
}

/**
 * Zombies follow the path field towards the stronghold. Near it they close in
 * directly and attack it. If the cheapest way forward is a tile holding an
 * intact structure (only when no open route exists), they attack that
 * structure until it falls to rubble.
 */
function stepEnemies(s: GameState, cfg: GameConfig, dt: number): void {
  // One field per step: hits during this step take effect next step.
  const field = pathField(s, cfg);
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const w = cfg.enemies[e.type];
    const shGap = distanceToStronghold(s, e.x, e.y) - w.radius;
    if (shGap <= 0) {
      if (attackTick(e, w.attackCooldown, dt)) {
        s.stronghold.hp -= w.structureDamage;
        s.damageTaken += w.structureDamage;
      }
      continue;
    }
    const cur = clampTile(cfg, field, e.x, e.y);
    const curIndex = cur.row * field.cols + cur.col;
    if (field.goal[curIndex] || field.dist[curIndex]! <= Math.SQRT2 + 1e-9) {
      // Next to the stronghold: close in directly.
      e.attacking = false;
      const dx = s.stronghold.x - e.x;
      const dy = s.stronghold.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      const m = Math.min(w.speed * dt, shGap);
      e.x += (dx / len) * m;
      e.y += (dy / len) * m;
      continue;
    }
    const next = nextTile(cfg, field, cur.col, cur.row);
    if (!next) continue;
    const blocker = field.blocker[next.row * field.cols + next.col];
    if (blocker && !blocker.destroyed) {
      const gap = distanceToTile(cfg, next.col, next.row, e.x, e.y) - w.radius;
      if (gap > 0) {
        e.attacking = false;
        moveToward(e, blocker.x, blocker.y, Math.min(w.speed * dt, gap));
      } else if (attackTick(e, w.attackCooldown, dt)) {
        damageStructure(s, blocker, w.structureDamage);
      }
      continue;
    }
    e.attacking = false;
    const c = tileCenter(cfg, next.col, next.row);
    moveToward(e, c.x, c.y, w.speed * dt);
  }
}

function stepTurrets(s: GameState, cfg: GameConfig, dt: number): void {
  for (const slot of s.structures) {
    const tur = slot.turret;
    if (!tur || slot.destroyed) continue;
    if (slot.kind === "mortar") {
      stepMortar(s, cfg, slot, tur, dt);
      continue;
    }
    if (slot.kind === "rocket") {
      stepRocketLauncher(s, cfg, slot, tur, dt);
      continue;
    }
    const gatling = slot.kind === "gatling";
    const t = gatling ? cfg.gatling : cfg.turret;
    tur.cooldown -= dt;
    const target = pickTarget(s, cfg, slot, turretRange(cfg, slot));
    tur.targetId = target ? target.id : null;
    if (gatling) {
      // Spins up while it has something to shoot, winds down when it doesn't.
      tur.spin = target ? Math.min(1, tur.spin + dt / cfg.gatling.spinUpSeconds) : Math.max(0, tur.spin - dt / cfg.gatling.spinDownSeconds);
      tur.barrel = (tur.barrel + dt * (2 + 28 * tur.spin)) % (Math.PI * 2);
    }
    const stats = turretStats(cfg, tur, slot.kind);
    const interval = 1 / stats.fireRate;
    if (!target) {
      if (tur.cooldown < 0) tur.cooldown = 0;
      continue;
    }
    tur.aim = Math.atan2(target.y - slot.y, target.x - slot.x);
    while (tur.cooldown <= 0) {
      tur.cooldown += interval;
      tur.lastShot = s.time;
      if (s.projectiles.length >= cfg.limits.maxProjectiles) continue;
      const cos = Math.cos(tur.aim);
      const sin = Math.sin(tur.aim);
      s.projectiles.push({
        x: slot.x + cos * t.radius,
        y: slot.y + sin * t.radius,
        vx: cos * t.projectileSpeed,
        vy: sin * t.projectileSpeed,
        damage: stats.damage,
        life: cfg.projectile.maxLifetime,
      });
      s.shotsFired++;
    }
  }
}

function stepRocketLauncher(s: GameState, cfg: GameConfig, slot: Structure, tur: Turret, dt: number): void {
  const r = cfg.rocket;
  const stats = turretStats(cfg, tur, "rocket");
  tur.cooldown -= dt;
  // Rockets go for the toughest zombie in range (ties: closest to the stronghold, then id).
  let target: Enemy | null = null;
  for (const e of s.enemies) {
    if (e.hp <= 0 || Math.hypot(e.x - slot.x, e.y - slot.y) > r.range) continue;
    if (!target || e.hp > target.hp || (e.hp === target.hp && e.id < target.id)) target = e;
  }
  tur.targetId = target ? target.id : null;
  if (!target) {
    if (tur.cooldown < 0) tur.cooldown = 0;
    return;
  }
  tur.aim = Math.atan2(target.y - slot.y, target.x - slot.x);
  if (tur.cooldown > 0) return;
  tur.cooldown += 1 / stats.fireRate;
  if (tur.cooldown < 0) tur.cooldown = 0;
  tur.lastShot = s.time;
  const cos = Math.cos(tur.aim);
  const sin = Math.sin(tur.aim);
  const splash = r.splashDamage * (1 + cfg.upgrades.strength.perLevel * tur.strength);
  s.rockets.push({
    x: slot.x + cos * r.radius,
    y: slot.y + sin * r.radius,
    vx: cos * r.speed,
    vy: sin * r.speed,
    targetId: target.id,
    damage: stats.damage,
    splash,
    life: r.maxLifetime,
    trail: [],
  });
  s.shotsFired++;
}

/** Damage every living zombie within `radius` of a point once. Returns how many were hit. */
function blast(s: GameState, cfg: GameConfig, x: number, y: number, radius: number, damage: number, hitIds?: Set<number>): number {
  let n = 0;
  for (const e of s.enemies) {
    if (e.hp <= 0 || hitIds?.has(e.id)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const rr = radius + cfg.enemies[e.type].radius * 0.5;
    if (dx * dx + dy * dy <= rr * rr) {
      hitIds?.add(e.id);
      damageEnemy(s, cfg, e, damage);
      n++;
    }
  }
  return n;
}

/** Rockets home on their target (or the nearest zombie if it died) and burst on contact. */
function stepRockets(s: GameState, cfg: GameConfig, dt: number): void {
  if (s.rockets.length === 0) return;
  const r = cfg.rocket;
  const kept: Rocket[] = [];
  for (const k of s.rockets) {
    let target = k.targetId !== null ? s.enemies.find((e) => e.id === k.targetId && e.hp > 0) ?? null : null;
    if (!target) {
      let bestD = 220;
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        const d = Math.hypot(e.x - k.x, e.y - k.y);
        if (d < bestD) {
          bestD = d;
          target = e;
        }
      }
      k.targetId = target ? target.id : null;
    }
    if (target) {
      const want = Math.atan2(target.y - k.y, target.x - k.x);
      const have = Math.atan2(k.vy, k.vx);
      let diff = want - have;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.max(-r.turnRate * dt, Math.min(r.turnRate * dt, diff));
      const a = have + turn;
      k.vx = Math.cos(a) * r.speed;
      k.vy = Math.sin(a) * r.speed;
    }
    k.trail.push([k.x, k.y]);
    if (k.trail.length > 10) k.trail.shift();
    k.x += k.vx * dt;
    k.y += k.vy * dt;
    k.life -= dt;
    let hit: Enemy | null = null;
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const rr = cfg.enemies[e.type].radius + 5;
      if ((e.x - k.x) ** 2 + (e.y - k.y) ** 2 <= rr * rr) {
        hit = e;
        break;
      }
    }
    if (hit || k.life <= 0) {
      const ids = new Set<number>();
      if (hit) {
        ids.add(hit.id);
        damageEnemy(s, cfg, hit, k.damage);
      }
      blast(s, cfg, k.x, k.y, r.splashRadius, k.splash, ids);
      s.blasts.push({ x: k.x, y: k.y, r: r.splashRadius, life: BLAST_SECONDS });
      continue;
    }
    kept.push(k);
  }
  s.rockets = kept;
}

/** Trap damage multiplier from the base level. */
export function trapDamageMultiplier(s: GameState, cfg: GameConfig): number {
  return 1 + cfg.trapDamagePerBaseLevel * s.stronghold.level;
}

/** Armed traps go off when a zombie reaches them; they never block or get attacked. */
function stepTraps(s: GameState, cfg: GameConfig): void {
  const mult = trapDamageMultiplier(s, cfg);
  for (const st of s.structures) {
    if (st.destroyed || !isTrap(st.kind)) continue;
    if (st.kind === "mine") {
      const m = cfg.mine;
      const trig = s.enemies.some((e) => e.hp > 0 && Math.hypot(e.x - st.x, e.y - st.y) <= m.triggerRadius + cfg.enemies[e.type].radius);
      if (!trig) continue;
      blast(s, cfg, st.x, st.y, m.blastRadius, m.damage * mult);
      s.blasts.push({ x: st.x, y: st.y, r: m.blastRadius, life: BLAST_SECONDS });
      st.destroyed = true;
      continue;
    }
    // Trip wire: anyone crossing the wire's segment sets it off.
    const w = cfg.tripwire;
    const half = cfg.construction.tileSize / 2;
    const ux = Math.cos(st.facing);
    const uy = Math.sin(st.facing);
    const crossed = s.enemies.some((e) => {
      if (e.hp <= 0) return false;
      const dx = e.x - st.x;
      const dy = e.y - st.y;
      const along = dx * ux + dy * uy;
      const across = Math.abs(-dx * uy + dy * ux);
      return Math.abs(along) <= half && across <= cfg.enemies[e.type].radius + 4;
    });
    if (!crossed) continue;
    const ids = new Set<number>();
    for (let i = 0; i < w.blasts; i++) {
      const f = w.blasts === 1 ? 0 : i / (w.blasts - 1) - 0.5;
      const bx = st.x + ux * f * w.length;
      const by = st.y + uy * f * w.length;
      blast(s, cfg, bx, by, w.blastRadius, w.damage * mult, ids);
      s.blasts.push({ x: bx, y: by, r: w.blastRadius, life: BLAST_SECONDS - i * 0.06 });
    }
    st.destroyed = true;
  }
}

function stepMortar(s: GameState, cfg: GameConfig, slot: Structure, tur: Turret, dt: number): void {
  const m = cfg.mortar;
  const stats = turretStats(cfg, tur, "mortar");
  tur.cooldown -= dt;
  const target = mortarTarget(s, cfg, slot);
  tur.targetId = null;
  if (!target) {
    if (tur.cooldown < 0) tur.cooldown = 0;
    return;
  }
  tur.aim = Math.atan2(target.y - slot.y, target.x - slot.x);
  if (tur.cooldown > 0) return;
  tur.cooldown += 1 / stats.fireRate;
  if (tur.cooldown < 0) tur.cooldown = 0;
  tur.lastShot = s.time;
  const flight = m.shellBaseSeconds + Math.hypot(target.x - slot.x, target.y - slot.y) / m.shellSpeed;
  s.shells.push({ sx: slot.x, sy: slot.y, tx: target.x, ty: target.y, total: flight, left: flight, damage: stats.damage, radius: m.blastRadius });
  s.shotsFired++;
}

/** Move shells along; a landed shell hits every living zombie in its blast once. */
function stepShells(s: GameState, cfg: GameConfig, dt: number): void {
  if (s.shells.length === 0) return;
  const kept: Shell[] = [];
  for (const sh of s.shells) {
    sh.left -= dt;
    if (sh.left > 0) {
      kept.push(sh);
      continue;
    }
    const r2 = sh.radius * sh.radius;
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.x - sh.tx;
      const dy = e.y - sh.ty;
      if (dx * dx + dy * dy <= r2) damageEnemy(s, cfg, e, sh.damage);
    }
    s.blasts.push({ x: sh.tx, y: sh.ty, r: sh.radius, life: BLAST_SECONDS });
  }
  s.shells = kept;
}

function stepBlasts(s: GameState, dt: number): void {
  if (s.blasts.length > 0) {
    for (const b of s.blasts) b.life -= dt;
    s.blasts = s.blasts.filter((b) => b.life > 0);
  }
  if (s.notices.length > 0) {
    for (const n of s.notices) n.life -= dt;
    s.notices = s.notices.filter((n) => n.life > 0);
  }
  if (s.popups.length > 0) {
    for (const p of s.popups) {
      p.life -= dt;
      p.y -= 50 * dt;
    }
    s.popups = s.popups.filter((p) => p.life > 0);
  }
}

function stepProjectiles(s: GameState, cfg: GameConfig, dt: number): void {
  const { width: w, height: h } = cfg.world;
  const kept: Projectile[] = [];
  for (const p of s.projectiles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0 || p.x < -50 || p.y < -50 || p.x > w + 50 || p.y > h + 50) continue;
    let hit = false;
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const hitR = cfg.enemies[e.type].radius + cfg.projectile.radius;
      if (dx * dx + dy * dy <= hitR * hitR) {
        damageEnemy(s, cfg, e, p.damage);
        hit = true;
        break;
      }
    }
    if (!hit) kept.push(p);
  }
  s.projectiles = kept;
}

/** Enemies still to come or alive in the current wave. */
export function remainingEnemies(s: GameState): number {
  return s.spawns.length - s.nextSpawn + s.enemies.length;
}
