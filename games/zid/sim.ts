/**
 * Pure, deterministic game simulation.
 *
 * No DOM, no clock, no Math.random: given the same seed, config and commands,
 * the state after N steps is identical. All state is plain JSON.
 */

import { ENEMY_TYPES, type Edge, type EnemyType, type GameConfig } from "./config.js";
import { tileCenter, tileStatus, type TileStatus } from "./grid.js";
import { wavePlan } from "./waves.js";

/** The run is endless: prep -> warning -> wave repeats until the stronghold falls ("lost"). */
export type Phase = "prep" | "warning" | "wave" | "lost";

export type UpgradePathId = "speed" | "strength";

export interface Turret {
  cooldown: number;
  /** Upgrade levels; a turret may take both paths. */
  speed: number;
  strength: number;
  /** Radians; for drawing only. */
  aim: number;
  targetId: number | null;
}

export type StructureKind = "machine-gun";

/** Anything built on a construction tile. */
export interface Structure {
  id: number;
  kind: StructureKind;
  col: number;
  row: number;
  /** Tile centre, world units. */
  x: number;
  y: number;
  turret: Turret;
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
  stronghold: { x: number; y: number; halfSize: number; hp: number; maxHp: number };
  structures: Structure[];
  nextStructureId: number;
  enemies: Enemy[];
  projectiles: Projectile[];
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
    stronghold: { x: sh.x, y: sh.y, halfSize: sh.halfSize, hp: sh.maxHp, maxHp: sh.maxHp },
    structures: [],
    nextStructureId: 1,
    enemies: [],
    projectiles: [],
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
  const gap = n > 1 ? plan.spawnSeconds / n : 0;
  for (let i = 0; i < n; i++) {
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
  | "insufficient-funds";

export type BuildResult = { ok: true; structure: Structure } | { ok: false; reason: BuildRejection };

/** The structure on a tile, if any. */
export function structureAt(s: GameState, col: number, row: number): Structure | null {
  return s.structures.find((st) => st.col === col && st.row === row) ?? null;
}

/**
 * Why a machine-gun turret could not be built on a tile right now, or null if
 * it can. Pure: never changes state. The UI uses this for previews; the
 * simulation uses it to validate.
 */
export function checkBuild(s: GameState, cfg: GameConfig, col: number, row: number): BuildRejection | null {
  if (s.phase === "lost") return "run-over";
  if (s.phase === "wave") return "assault-active";
  const status = tileStatus(cfg, col, row);
  if (status !== "buildable") return status;
  if (structureAt(s, col, row)) return "occupied";
  if (s.currency < cfg.turret.cost) return "insufficient-funds";
  return null;
}

/**
 * Build a machine-gun turret on a construction tile. Validation happens before
 * any state change; a rejected build never deducts currency. Construction is a
 * preparation action: it is refused while an assault is active.
 */
export function buildTurret(s: GameState, cfg: GameConfig, col: number, row: number): BuildResult {
  const reason = checkBuild(s, cfg, col, row);
  if (reason) return { ok: false, reason };
  s.currency -= cfg.turret.cost;
  const c = tileCenter(cfg, col, row);
  const structure: Structure = {
    id: s.nextStructureId++,
    kind: "machine-gun",
    col,
    row,
    x: c.x,
    y: c.y,
    turret: { cooldown: 0, speed: 0, strength: 0, aim: -Math.PI / 2, targetId: null },
  };
  s.structures.push(structure);
  return { ok: true, structure };
}

export type ManageRejection = "run-over" | "assault-active" | "no-such-structure" | "max-level" | "insufficient-funds";
export type ManageResult = { ok: true } | { ok: false; reason: ManageRejection };

export function structureById(s: GameState, id: number): Structure | null {
  return s.structures.find((st) => st.id === id) ?? null;
}

/** Cost of the next level on a path, or null at max level. */
export function nextUpgradeCost(cfg: GameConfig, st: Structure, path: UpgradePathId): number | null {
  const costs = cfg.upgrades[path].costs;
  const level = st.turret[path];
  return level < costs.length ? costs[level]! : null;
}

/** Why an upgrade can't happen right now, or null if it can. Pure. */
export function checkUpgrade(s: GameState, cfg: GameConfig, id: number, path: UpgradePathId): ManageRejection | null {
  if (s.phase === "lost") return "run-over";
  if (s.phase === "wave") return "assault-active";
  const st = structureById(s, id);
  if (!st) return "no-such-structure";
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
  s.currency -= nextUpgradeCost(cfg, st, path)!;
  st.turret[path]++;
  return { ok: true };
}

/** Effective shots per second and damage per shot for a turret, after upgrades. */
export function turretStats(cfg: GameConfig, t: Turret): { fireRate: number; damage: number } {
  return {
    fireRate: cfg.turret.fireRate * (1 + cfg.upgrades.speed.perLevel * t.speed),
    damage: cfg.turret.damage * (1 + cfg.upgrades.strength.perLevel * t.strength),
  };
}

/**
 * Recycle (destroy) a structure: it is removed and its tile freed. There is
 * no refund. Preparation only.
 */
export function recycleStructure(s: GameState, _cfg: GameConfig, id: number): ManageResult {
  if (s.phase === "lost") return { ok: false, reason: "run-over" };
  if (s.phase === "wave") return { ok: false, reason: "assault-active" };
  const i = s.structures.findIndex((st) => st.id === id);
  if (i === -1) return { ok: false, reason: "no-such-structure" };
  s.structures.splice(i, 1);
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
export function pickTarget(s: GameState, cfg: GameConfig, from: { x: number; y: number }): Enemy | null {
  let best: Enemy | null = null;
  let bestD = Infinity;
  const r2 = cfg.turret.range * cfg.turret.range;
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
    return true;
  }
  return false;
}

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
  stepTurrets(s, cfg, dt);
  stepProjectiles(s, cfg, dt);

  // Remove the dead.
  if (s.enemies.some((e) => e.hp <= 0)) s.enemies = s.enemies.filter((e) => e.hp > 0);

  if (s.stronghold.hp <= 0) {
    s.stronghold.hp = 0;
    s.phase = "lost";
  } else if (s.phase === "wave" && s.nextSpawn >= s.spawns.length && s.enemies.length === 0) {
    // Wave cleared: back to preparation for the next one.
    s.wavesCleared++;
    s.wave++;
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

function stepEnemies(s: GameState, cfg: GameConfig, dt: number): void {
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const w = cfg.enemies[e.type];
    const gap = distanceToStronghold(s, e.x, e.y) - w.radius;
    if (gap > 0) {
      e.attacking = false;
      const dx = s.stronghold.x - e.x;
      const dy = s.stronghold.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      const move = Math.min(w.speed * dt, gap);
      e.x += (dx / len) * move;
      e.y += (dy / len) * move;
    } else {
      e.attacking = true;
      e.attackCooldown -= dt;
      if (e.attackCooldown <= 0) {
        e.attackCooldown += w.attackCooldown;
        s.stronghold.hp -= w.structureDamage;
        s.damageTaken += w.structureDamage;
      }
    }
  }
}

function stepTurrets(s: GameState, cfg: GameConfig, dt: number): void {
  const t = cfg.turret;
  for (const slot of s.structures) {
    const tur = slot.turret;
    const stats = turretStats(cfg, tur);
    const interval = 1 / stats.fireRate;
    tur.cooldown -= dt;
    const target = pickTarget(s, cfg, slot);
    tur.targetId = target ? target.id : null;
    if (!target) {
      if (tur.cooldown < 0) tur.cooldown = 0;
      continue;
    }
    tur.aim = Math.atan2(target.y - slot.y, target.x - slot.x);
    while (tur.cooldown <= 0) {
      tur.cooldown += interval;
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
