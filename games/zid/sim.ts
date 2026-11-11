/**
 * Pure, deterministic simulation for Milestone 1.
 *
 * No DOM, no clock, no Math.random: given the same seed, config and commands,
 * the state after N steps is identical. All state is plain JSON.
 */

import type { Edge, GameConfig } from "./config.js";

/** The run is endless: prep -> warning -> wave repeats until the stronghold falls ("lost"). */
export type Phase = "prep" | "warning" | "wave" | "lost";

export interface Turret {
  cooldown: number;
  /** Radians; for drawing only. */
  aim: number;
  targetId: number | null;
}

export interface Slot {
  id: string;
  x: number;
  y: number;
  turret: Turret | null;
}

export interface Enemy {
  id: number;
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
  slots: Slot[];
  enemies: Enemy[];
  projectiles: Projectile[];
  spawns: Spawn[];
  nextSpawn: number;
  nextEnemyId: number;
  kills: number;
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

function edgePoint(s: GameState, cfg: GameConfig, edge: Edge): { x: number; y: number } {
  const { width: w, height: h } = cfg.world;
  const pad = cfg.walker.radius + 4;
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
    slots: cfg.hardpoints.map((h) => ({ id: h.id, x: sh.x + h.dx, y: sh.y + h.dy, turret: null })),
    enemies: [],
    projectiles: [],
    spawns: [],
    nextSpawn: 0,
    nextEnemyId: 1,
    kills: 0,
    spawned: 0,
    shotsFired: 0,
    damageTaken: 0,
  };
  rollWave(s, cfg);
  return s;
}

/**
 * Pre-roll one wave's spawn schedule so it is fixed by the seed.
 * Every wave uses the same configured size: the wave scaling curve is an open decision.
 */
function rollWave(s: GameState, cfg: GameConfig): void {
  s.spawns = [];
  s.nextSpawn = 0;
  s.waveTime = 0;
  const n = cfg.wave.count;
  const gap = n > 1 ? cfg.wave.spawnSeconds / n : 0;
  for (let i = 0; i < n; i++) {
    const edge = cfg.wave.edges[Math.floor(nextRandom(s) * cfg.wave.edges.length)] ?? "north";
    const jitter = (nextRandom(s) - 0.5) * gap * 0.8;
    const p = edgePoint(s, cfg, edge);
    s.spawns.push({ at: Math.max(0, i * gap + jitter), x: p.x, y: p.y });
  }
  s.spawns.sort((a, b) => a.at - b.at);
}

export type BuildResult =
  | { ok: true }
  | { ok: false; reason: "run-over" | "assault-active" | "no-such-slot" | "occupied" | "insufficient-funds" };

/**
 * Build a turret on a hardpoint. Validation happens before any state change;
 * a rejected build never deducts currency. Turret construction is a
 * preparation action: it is refused while an assault is active.
 */
export function buildTurret(s: GameState, cfg: GameConfig, slotId: string): BuildResult {
  if (s.phase === "lost") return { ok: false, reason: "run-over" };
  if (s.phase === "wave") return { ok: false, reason: "assault-active" };
  const slot = s.slots.find((sl) => sl.id === slotId);
  if (!slot) return { ok: false, reason: "no-such-slot" };
  if (slot.turret) return { ok: false, reason: "occupied" };
  if (s.currency < cfg.turret.cost) return { ok: false, reason: "insufficient-funds" };
  s.currency -= cfg.turret.cost;
  slot.turret = { cooldown: 0, aim: -Math.PI / 2, targetId: null };
  return { ok: true };
}

/** Early launch: skip the rest of the preparation countdown and start the assault immediately. */
export function startWaveNow(s: GameState, _cfg: GameConfig): void {
  if (s.phase !== "prep") return;
  s.phase = "wave";
  s.phaseTimer = 0;
}

/** Slot whose mount is within `radius` of a world point, if any. */
export function slotAt(s: GameState, x: number, y: number, radius: number): Slot | null {
  let best: Slot | null = null;
  let bestD = radius;
  for (const sl of s.slots) {
    const d = Math.hypot(sl.x - x, sl.y - y);
    if (d <= bestD) {
      best = sl;
      bestD = d;
    }
  }
  return best;
}

/**
 * Targeting rule (one simple default): the enemy in range that is closest to
 * the stronghold. Ties go to the lowest id, so the choice is deterministic.
 */
export function pickTarget(s: GameState, cfg: GameConfig, slot: Slot): Enemy | null {
  let best: Enemy | null = null;
  let bestD = Infinity;
  const r2 = cfg.turret.range * cfg.turret.range;
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const dx = e.x - slot.x;
    const dy = e.y - slot.y;
    if (dx * dx + dy * dy > r2) continue;
    const d = Math.hypot(e.x - s.stronghold.x, e.y - s.stronghold.y);
    if (d < bestD || (d === bestD && best && e.id < best.id)) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** Apply damage; returns true if this hit killed the enemy. */
export function damageEnemy(s: GameState, cfg: GameConfig, e: Enemy, amount: number): boolean {
  if (e.hp <= 0) return false;
  e.hp -= amount;
  if (e.hp <= 0) {
    e.hp = 0;
    s.kills++;
    s.currency += cfg.walker.reward;
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
      s.enemies.push({ id: s.nextEnemyId++, x: sp.x, y: sp.y, hp: cfg.walker.maxHp, attackCooldown: 0, attacking: false });
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
  const w = cfg.walker;
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
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
  const interval = 1 / t.fireRate;
  for (const slot of s.slots) {
    const tur = slot.turret;
    if (!tur) continue;
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
        damage: t.damage,
        life: cfg.projectile.maxLifetime,
      });
      s.shotsFired++;
    }
  }
}

function stepProjectiles(s: GameState, cfg: GameConfig, dt: number): void {
  const hitR = cfg.walker.radius + cfg.projectile.radius;
  const hitR2 = hitR * hitR;
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
      if (dx * dx + dy * dy <= hitR2) {
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
