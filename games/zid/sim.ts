/**
 * Pure, deterministic game simulation.
 *
 * No DOM, no clock, no Math.random: given the same seed, config and commands,
 * the state after N steps is identical. All state is plain JSON.
 */

import { ENEMY_TYPES, type Edge, type EnemyType, type GameConfig } from "./config.js";
import { buildableTiles, gridSize, overlapsStronghold, tileCenter, tileOrigin, tileStatus, type TileStatus } from "./grid.js";
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
  /** Shots fired so far; picks which barrel or tube fires next. */
  shots: number;
  /** Gatling only: 0..1 how far spun up, and the barrel angle for drawing. */
  spin: number;
  barrel: number;
}

export type StructureKind = "machine-gun" | "gatling" | "rocket" | "mortar" | "shotgun" | "flamer" | "barricade" | "mine" | "tripwire";
export const TURRET_KINDS: readonly StructureKind[] = ["machine-gun", "gatling", "rocket", "mortar", "shotgun", "flamer"];
export const TRAP_KINDS: readonly StructureKind[] = ["mine", "tripwire"];
export const ALL_KINDS: readonly StructureKind[] = ["machine-gun", "gatling", "rocket", "mortar", "shotgun", "flamer", "mine", "tripwire", "barricade"];

export function isTrap(kind: StructureKind): boolean {
  return kind === "mine" || kind === "tripwire";
}

/** Player-facing names. */
export const KIND_NAMES: Record<StructureKind, string> = {
  "machine-gun": "Machine gun",
  gatling: "Gatling gun",
  shotgun: "Shotgun",
  flamer: "Flamethrower",
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

/** Where a zombie died, for drawing only. */
export interface Splat {
  x: number;
  y: number;
  type: EnemyType;
  /** Fixed per-splat number so its shape doesn't flicker. */
  shape: number;
  life: number;
}

export type PickupKind = "health" | "supplies";
export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  /** Supplies given (0 for health). */
  amount: number;
  life: number;
}

export type TruckState = "parked" | "queued" | "departing" | "away" | "arriving" | "unloading" | "wrecked";
export type TruckOutcome = "success" | "jackpot" | "empty" | "lost";
export interface Truck {
  state: TruckState;
  x: number;
  y: number;
  /** Radians; it drives the way it faces and steers toward its target. */
  heading: number;
  /** Current speed (slower in tight turns), for drawing. */
  speed: number;
  hp: number;
  maxHp: number;
  /** Where it is steering to. */
  tx: number;
  ty: number;
  /** Supplies on board (arriving and unloading). */
  load: number;
  outcome: TruckOutcome | null;
  /** Countdown: until it reappears (away), or until unloading finishes. */
  timer: number;
  /** Set when the wave it left in has been cleared: it comes back next assault. */
  due: boolean;
  /** Completed runs, for the end screen. */
  runs: number;
  /** The route it is following: waypoints left to visit, ending at (tx, ty). */
  path: { x: number; y: number }[];
  /** Layout the route was planned for; a change means plan again. */
  pathVersion: number;
  /** True when the only route goes through something built: then it pushes through. */
  forced: boolean;
}

/** Where the truck parks: the middle of its bay beside the door, facing east. */
export function truckParking(cfg: GameConfig): { x: number; y: number } {
  const bay = cfg.construction.truckBay;
  if (bay.length === 0) {
    const sh = cfg.stronghold;
    return { x: sh.x, y: sh.y + sh.halfSize + cfg.truck.width / 2 + 6 };
  }
  let x = 0;
  let y = 0;
  for (const [col, row] of bay) {
    const c = tileCenter(cfg, col, row);
    x += c.x;
    y += c.y;
  }
  return { x: x / bay.length, y: y / bay.length };
}

function newTruck(cfg: GameConfig): Truck {
  const p = truckParking(cfg);
  return { state: "parked", x: p.x, y: p.y, heading: 0, speed: 0, hp: cfg.truck.maxHp, maxHp: cfg.truck.maxHp, tx: p.x, ty: p.y, load: 0, outcome: null, timer: 0, due: false, runs: 0, path: [], pathVersion: -1, forced: false };
}

/** Whether zombies can hurt the truck right now. */
export function truckExposed(s: GameState): boolean {
  const st = s.truck.state;
  return st === "departing" || st === "arriving" || st === "unloading";
}

/** How much stockpiled Salvage this run may still turn into starting Supplies (only before the first wave). */
export function salvageUsable(s: GameState, cfg: GameConfig, stockpile: number): number {
  if (s.wave !== 1 || (s.phase !== "prep" && s.phase !== "warning") || s.wavesCleared > 0) return 0;
  const room = cfg.salvage.maxStartBonus / cfg.salvage.suppliesPerSalvage - s.salvageUsed;
  return Math.max(0, Math.min(Math.floor(stockpile), Math.floor(room)));
}

/**
 * Turn stockpiled Salvage into starting Supplies. Returns how much Salvage
 * was spent (0 if none could be); the caller takes it off the stockpile.
 */
export function useSalvage(s: GameState, cfg: GameConfig, stockpile: number): number {
  const amount = salvageUsable(s, cfg, stockpile);
  if (amount <= 0) return 0;
  s.salvageUsed += amount;
  s.currency += amount * cfg.salvage.suppliesPerSalvage;
  return amount;
}

export type TruckRejection = "run-over" | "assault-active" | "truck-busy" | "insufficient-funds";

export function checkSendTruck(s: GameState, cfg: GameConfig): TruckRejection | null {
  if (s.phase === "lost") return "run-over";
  if (s.phase === "wave") return "assault-active";
  if (s.truck.state !== "parked") return "truck-busy";
  if (s.currency < cfg.truck.cost) return "insufficient-funds";
  return null;
}

/** Pay for a salvage run. The truck leaves when the next assault starts. */
export function sendTruck(s: GameState, cfg: GameConfig): { ok: true } | { ok: false; reason: TruckRejection } {
  const reason = checkSendTruck(s, cfg);
  if (reason) return { ok: false, reason };
  s.currency -= cfg.truck.cost;
  s.truck.state = "queued";
  // Pick its way out now, so the driver can line the truck up while waiting.
  routeTruck(s, cfg, truckGate(s, cfg));
  return { ok: true };
}

/** A point just off one of the three edges the truck uses (never north: the base is in the way). */
function truckGate(s: GameState, cfg: GameConfig): { x: number; y: number } {
  const { width: w, height: h } = cfg.world;
  const pick = Math.floor(pickupRandom(s) * 3);
  const along = 0.25 + pickupRandom(s) * 0.5;
  const p = truckParking(cfg);
  if (pick === 0) return { x: -60, y: p.y + (h - p.y) * along * 0.8 };
  if (pick === 1) return { x: w + 60, y: p.y + (h - p.y) * along * 0.8 };
  return { x: w * along, y: h + 60 };
}

function truckNotice(s: GameState, text: string): void {
  s.notices.push({ text, life: 5 });
}

/** What the truck must not drive through: 2 = never (rocks, the stronghold), 1 = things you built, 0 = open ground. */
function truckBlock(s: GameState, cfg: GameConfig, col: number, row: number): 0 | 1 | 2 {
  const { cols, rows } = gridSize(cfg);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return 0; // beyond the grid is open ground
  if (overlapsStronghold(cfg, col, row)) return 2;
  if (cfg.construction.invalidTerrain.some(([c, r]) => c === col && r === row)) return 2;
  return structureAt(s, col, row) ? 1 : 0;
}

/** As truckBlock, for a world point. */
function truckBlockAt(s: GameState, cfg: GameConfig, x: number, y: number): 0 | 1 | 2 {
  const t = cfg.construction.tileSize;
  const o = cfg.construction.origin;
  return truckBlock(s, cfg, Math.floor((x - o.x) / t), Math.floor((y - o.y) / t));
}

/** How far each kind of thing reaches from the middle of its tile, for the truck's collisions. */
function assetRadius(kind: StructureKind | "rock"): number {
  return kind === "rock" ? 26 : kind === "barricade" ? 26 : kind === "mine" || kind === "tripwire" ? 14 : 23;
}

/**
 * Whether the truck's body (a rectangle turned to its heading) overlaps
 * anything solid: the stronghold and rocks (level 2), plus everything built,
 * rubble and traps included (level 1). Uses each thing's real footprint, not
 * its whole tile.
 */
export function truckTouches(s: GameState, cfg: GameConfig, x: number, y: number, heading: number, level: 1 | 2 = 1): boolean {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const hl = cfg.truck.length / 2;
  const hw = cfg.truck.width / 2;
  // Circle against the turned rectangle: bring the circle's centre into the truck's own frame.
  const hits = (cx: number, cy: number, r: number): boolean => {
    const dx = cx - x;
    const dy = cy - y;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const nx = Math.max(-hl, Math.min(hl, lx));
    const ny = Math.max(-hw, Math.min(hw, ly));
    return Math.hypot(lx - nx, ly - ny) < r;
  };
  // Stronghold: its square against the truck's corners and edge midpoints.
  const sh = s.stronghold;
  for (const f of [-1, -0.5, 0, 0.5, 1]) {
    for (const w of [-1, 0, 1]) {
      const px = x + cos * hl * f - sin * hw * w;
      const py = y + sin * hl * f + cos * hw * w;
      if (Math.abs(px - sh.x) < sh.halfSize && Math.abs(py - sh.y) < sh.halfSize) return true;
    }
  }
  for (const [col, row] of cfg.construction.invalidTerrain) {
    const c = tileCenter(cfg, col, row);
    if (hits(c.x, c.y, assetRadius("rock"))) return true;
  }
  if (level === 2) return false;
  for (const st of s.structures) if (hits(st.x, st.y, assetRadius(st.kind))) return true;
  return false;
}

/** A straight run between two points keeps the whole body clear of everything built and every rock. */
function truckClearRun(s: GameState, cfg: GameConfig, ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(d / 12));
  const nx = -(by - ay) / (d || 1);
  const ny = (bx - ax) / (d || 1);
  const pad = cfg.truck.width / 2 + 6;
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const y = ay + ((by - ay) * i) / n;
    for (const w of [-pad, 0, pad]) if (truckBlockAt(s, cfg, x + nx * w, y + ny * w) >= 1) return false;
  }
  return true;
}

/**
 * Plan a route for the truck across the tile grid: around rocks, the
 * stronghold and everything built. If you have walled it in, it goes through
 * as few of your structures as it can (never rocks or the stronghold). The
 * tile route is then straightened wherever a direct run is clear, so it
 * drives in long lines and wide corners instead of zig-zagging tile to tile.
 */
export function planTruckPath(
  s: GameState,
  cfg: GameConfig,
  from: { x: number; y: number },
  to: { x: number; y: number },
  info?: { forced: boolean },
): { x: number; y: number }[] {
  const { cols, rows } = gridSize(cfg);
  const t = cfg.construction.tileSize;
  const o = cfg.construction.origin;
  const clampTileOf = (p: { x: number; y: number }) => ({
    col: Math.min(cols - 1, Math.max(0, Math.floor((p.x - o.x) / t))),
    row: Math.min(rows - 1, Math.max(0, Math.floor((p.y - o.y) / t))),
  });
  const a = clampTileOf(from);
  const b = clampTileOf(to);
  const n = cols * rows;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const startI = a.row * cols + a.col;
  const goalI = b.row * cols + b.col;
  const stepCost = (col: number, row: number, i: number): number => {
    if (i === startI || i === goalI) return 1;
    const k = truckBlock(s, cfg, col, row);
    return k === 2 ? Infinity : k === 1 ? 60 : 1;
  };
  dist[startI] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i]! < best) {
        best = dist[i]!;
        u = i;
      }
    }
    if (u < 0 || u === goalI) break;
    done[u] = 1;
    const uc = u % cols;
    const ur = (u - uc) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const c = uc + dc;
        const r = ur + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const v = r * cols + c;
        const w = stepCost(c, r, v);
        if (!Number.isFinite(w)) continue;
        // No squeezing diagonally past a corner of something solid.
        if (dr && dc && (truckBlock(s, cfg, uc + dc, ur) >= 1 || truckBlock(s, cfg, uc, ur + dr) >= 1)) continue;
        const nd = dist[u]! + w * (dr && dc ? Math.SQRT2 : 1);
        if (nd < dist[v]!) {
          dist[v] = nd;
          prev[v] = u;
        }
      }
    }
  }
  const tiles: { x: number; y: number }[] = [];
  if (Number.isFinite(dist[goalI]!)) {
    for (let i = goalI; i !== -1 && i !== startI; i = prev[i]!) {
      const c = i % cols;
      tiles.push(tileCenter(cfg, c, (i - c) / cols));
      // Walled in: the only way out goes through something you built.
      if (info && i !== goalI && truckBlock(s, cfg, c, (i - c) / cols) === 1) info.forced = true;
    }
    tiles.reverse();
  }
  const raw = [{ x: from.x, y: from.y }, ...tiles, { x: to.x, y: to.y }];
  // Straighten: from each point, jump to the farthest later point with a clear run.
  const out: { x: number; y: number }[] = [];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && !truckClearRun(s, cfg, raw[i]!.x, raw[i]!.y, raw[j]!.x, raw[j]!.y)) j--;
    out.push(raw[j]!);
    i = j;
  }
  return out;
}

function routeTruck(s: GameState, cfg: GameConfig, to: { x: number; y: number }): void {
  const t = s.truck;
  t.tx = to.x;
  t.ty = to.y;
  const info = { forced: false };
  t.path = planTruckPath(s, cfg, t, to, info);
  t.forced = info.forced;
  t.pathVersion = s.layoutVersion;
}

/**
 * Drive along the planned route: aim at the next waypoint, turn at a limited
 * rate (so it curves rather than snapping), ease the speed up and down, slow
 * for corners and for the final approach, and swerve a little round zombies
 * when there is room. It never enters a rock, the stronghold or anything built
 * unless the route itself had to go through it.
 */
function driveTruck(s: GameState, cfg: GameConfig, dt: number): number {
  const t = s.truck;
  const c = cfg.truck;
  if (t.pathVersion !== s.layoutVersion) routeTruck(s, cfg, { x: t.tx, y: t.ty });
  // Tick off waypoints as it reaches them (the last one is the destination itself).
  while (t.path.length > 1 && Math.hypot(t.path[0]!.x - t.x, t.path[0]!.y - t.y) < 34) t.path.shift();
  const aim = t.path[0] ?? { x: t.tx, y: t.ty };
  const dist = Math.hypot(t.tx - t.x, t.ty - t.y);
  const base = Math.atan2(aim.y - t.y, aim.x - t.x);
  // Swerve: each zombie ahead and close pushes the heading away from itself.
  let push = 0;
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const dx = e.x - t.x;
    const dy = e.y - t.y;
    const d = Math.hypot(dx, dy);
    if (d > 110 || d < 1) continue;
    let rel = Math.atan2(dy, dx) - t.heading;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    if (Math.abs(rel) > 1.1) continue; // not in front
    push += (rel >= 0 ? -1 : 1) * (1 - d / 110) * 0.7;
  }
  // Close to the destination the swerve fades, so it can actually arrive.
  const swerve = Math.max(-0.8, Math.min(0.8, push)) * Math.min(1, dist / 160);
  const attempt = (want: number): { x: number; y: number; h: number; v: number; diff: number } => {
    let diff = want - t.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const h = t.heading + Math.max(-c.turnRate * dt, Math.min(c.turnRate * dt, diff));
    // Slower through corners and on the final approach; speed eases toward that target.
    const cornering = 1 - 0.6 * Math.min(1, Math.abs(diff) / 1.2);
    const braking = t.state === "arriving" ? Math.min(1, 0.3 + dist / 170) : 1;
    const target = c.speed * cornering * braking;
    const v = target > t.speed ? Math.min(target, t.speed + c.accel * dt) : Math.max(target, t.speed - c.brake * dt);
    return { x: t.x + Math.cos(h) * v * dt, y: t.y + Math.sin(h) * v * dt, h, v, diff };
  };
  // Whatever it already overlaps (leaving the bay, or a route forced through a wall) doesn't count against it.
  const already = t.forced ? 2 : truckTouches(s, cfg, t.x, t.y, t.heading) ? (truckTouches(s, cfg, t.x, t.y, t.heading, 2) ? 3 : 2) : 1;
  const ok = (m: { x: number; y: number; h: number }) => already === 3 || !truckTouches(s, cfg, m.x, m.y, m.h, already as 1 | 2);
  let move = attempt(base + swerve);
  if (!ok(move)) move = attempt(base);
  if (!ok(move)) {
    // Something is in the way of that line: brake, and look for a nearby heading that is clear,
    // preferring the one closest to where it wants to go.
    const v = Math.max(16, t.speed - c.brake * dt);
    let found: typeof move | null = null;
    for (let k = 0; k <= 8 && !found; k++) {
      for (const sign of k === 0 ? [0] : [1, -1]) {
        const h = t.heading + sign * Math.min(k * 0.35, c.turnRate * dt * (k === 0 ? 0 : 1));
        const cand = { x: t.x + Math.cos(h) * v * dt, y: t.y + Math.sin(h) * v * dt, h, v, diff: move.diff };
        if (ok(cand)) {
          found = cand;
          break;
        }
      }
    }
    // Nothing clear: turn on the spot toward the route (never into a rock or the stronghold).
    const spot = { x: t.x, y: t.y, h: move.h, v: 0, diff: move.diff };
    move = found ?? (!truckTouches(s, cfg, spot.x, spot.y, spot.h, 2) ? spot : { ...spot, h: t.heading });
  }
  t.heading = move.h;
  t.speed = move.v;
  t.x = move.x;
  t.y = move.y;
  // Zombies don't stand inside it: anything it reaches is shouldered aside.
  const reach = c.width / 2 + 4;
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const dx = e.x - t.x;
    const dy = e.y - t.y;
    const d = Math.hypot(dx, dy);
    const min = reach + cfg.enemies[e.type].radius * 0.6;
    if (d < min && d > 0.01) {
      e.x += (dx / d) * (min - d);
      e.y += (dy / d) * (min - d);
    }
  }
  return dist;
}

function wreckTruck(s: GameState): void {
  const t = s.truck;
  s.blasts.push({ x: t.x, y: t.y, r: 70, life: BLAST_SECONDS });
  truckNotice(s, t.load > 0 ? "Truck destroyed · load lost" : "Truck destroyed");
  t.state = "wrecked";
  t.load = 0;
  t.speed = 0;
  t.due = false;
}

/** Roll what happens off screen, with the pickup stream so wave rolls are untouched. */
function rollTruckOutcome(s: GameState, cfg: GameConfig): void {
  const t = s.truck;
  const c = cfg.truck;
  const r = pickupRandom(s);
  const base = c.loadMin + Math.floor(pickupRandom(s) * (c.loadMax - c.loadMin + 1)) + c.loadPerWave * s.wave;
  if (r < c.odds.lost) [t.outcome, t.load] = ["lost", 0];
  else if (r < c.odds.lost + c.odds.empty) [t.outcome, t.load] = ["empty", 0];
  else if (r < c.odds.lost + c.odds.empty + c.odds.jackpot) [t.outcome, t.load] = ["jackpot", base * 2];
  else [t.outcome, t.load] = ["success", base];
}

function stepTruck(s: GameState, cfg: GameConfig, dt: number): void {
  const t = s.truck;
  const c = cfg.truck;
  const park = truckParking(cfg);
  if (truckExposed(s) && t.hp <= 0) {
    wreckTruck(s);
    return;
  }
  switch (t.state) {
    case "queued":
      if (s.phase !== "wave") {
        // Waiting to go: ease round in the bay to face the way out.
        if (t.pathVersion !== s.layoutVersion) routeTruck(s, cfg, { x: t.tx, y: t.ty });
        const first = t.path[0] ?? { x: t.tx, y: t.ty };
        let d = Math.atan2(first.y - t.y, first.x - t.x) - t.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        t.heading += Math.max(-0.9 * dt, Math.min(0.9 * dt, d));
        return;
      }
      {
        t.state = "departing";
        routeTruck(s, cfg, { x: t.tx, y: t.ty });
        truckNotice(s, "Salvage truck heading out");
      }
      return;
    case "departing": {
      driveTruck(s, cfg, dt);
      const { width: w, height: h } = cfg.world;
      if (t.x < -40 || t.x > w + 40 || t.y > h + 40 || t.y < -40) {
        t.state = "away";
        t.speed = 0;
        t.due = s.phase !== "wave"; // left after the wave was already over
        rollTruckOutcome(s, cfg);
        t.timer = c.returnMin + pickupRandom(s) * (c.returnMax - c.returnMin);
      }
      return;
    }
    case "away": {
      if (!t.due || s.phase !== "wave") return;
      t.timer -= dt;
      if (t.timer > 0) return;
      t.due = false;
      if (t.outcome === "lost") {
        truckNotice(s, "The crew never made it back");
        t.state = "wrecked";
        return;
      }
      const gate = truckGate(s, cfg);
      t.x = gate.x;
      t.y = gate.y;
      t.state = "arriving";
      routeTruck(s, cfg, park);
      const first = t.path[0] ?? park;
      t.heading = Math.atan2(first.y - gate.y, first.x - gate.x);
      t.speed = cfg.truck.speed * 0.8;
      truckNotice(s, t.outcome === "empty" ? "Truck coming back empty" : "Truck is back · cover it");
      return;
    }
    case "arriving": {
      let dist = Math.hypot(park.x - t.x, park.y - t.y);
      if (dist > 40) {
        driveTruck(s, cfg, dt);
        return;
      }
      // Docking: roll the last few metres straight into the bay and square up, facing east.
      const roll = Math.min(dist, Math.max(14, t.speed - c.brake * dt) * dt);
      t.speed = dt > 0 ? roll / dt : 0;
      if (dist > 0) {
        t.x += ((park.x - t.x) / dist) * roll;
        t.y += ((park.y - t.y) / dist) * roll;
      }
      const square = Math.atan2(Math.sin(-t.heading), Math.cos(-t.heading));
      t.heading += Math.max(-c.turnRate * dt, Math.min(c.turnRate * dt, square));
      dist -= roll;
      if (dist <= 1) {
        t.x = park.x;
        t.y = park.y;
        t.speed = 0;
        if (t.load > 0) {
          t.state = "unloading";
          t.timer = c.unloadSeconds;
        } else finishRun(s, cfg);
      }
      return;
    }
    case "unloading": {
      // Straighten up while it sits there.
      t.heading += Math.atan2(Math.sin(-t.heading), Math.cos(-t.heading)) * Math.min(1, dt * 4);
      t.timer -= dt;
      if (t.timer <= 0) finishRun(s, cfg);
      return;
    }
    default:
      return;
  }
}

function finishRun(s: GameState, cfg: GameConfig): void {
  const t = s.truck;
  if (t.load > 0) {
    s.currency += t.load;
    s.earned += t.load;
    s.popups.push({ x: t.x, y: t.y - 20, amount: t.load, life: POPUP_SECONDS * 2 });
    // A share of every haul goes to the permanent stockpile.
    s.salvageBanked += Math.round(t.load * cfg.salvage.shareOfHaul);
    if (t.outcome === "jackpot") {
      s.charge = 1;
      truckNotice(s, `Jackpot! +${t.load} and a full charge`);
    } else truckNotice(s, `Salvage unloaded · +${t.load} Supplies`);
  } else truckNotice(s, "No luck this run");
  t.runs++;
  resetTruck(s, cfg);
}

function resetTruck(s: GameState, cfg: GameConfig): void {
  const runs = s.truck.runs;
  s.truck = newTruck(cfg);
  s.truck.runs = runs;
}

export type BoostKind = "overdrive" | "bounty" | "airstrike" | "shield";
export const BOOST_KINDS: readonly BoostKind[] = ["overdrive", "bounty", "airstrike", "shield"];

/** One bomb of an airstrike: a marked drop zone that goes off when `delay` runs out. */
export interface Bomb {
  x: number;
  y: number;
  delay: number;
  total: number;
  damage: number;
  radius: number;
}
export const SPLAT_SECONDS = 5;

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
  /** Seconds left on fire, and the damage per second while burning. */
  burn?: number;
  burnDps?: number;
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
  /** Splatters where zombies died, for drawing only. */
  splats: Splat[];
  /** Collectable icons on the field. */
  pickups: Pickup[];
  nextPickupId: number;
  /** Seconds of assault until the next pickup appears. */
  pickupTimer: number;
  /** Separate random stream for pickups, so they never disturb wave rolls. */
  pickupRng: number;
  /** Charge meter, 0..1. */
  charge: number;
  /** The boost running now, if any. */
  boost: { kind: BoostKind; left: number; total: number } | null;
  truck: Truck;
  /** Permanent Salvage banked by this run's hauls so far (kept after defeat). */
  salvageBanked: number;
  /** Salvage from the stockpile turned into starting Supplies for this run. */
  salvageUsed: number;
  /** Airstrike bombs still to land. */
  bombs: Bomb[];
  /** The bomber's pass, for drawing only: from, to, and progress. */
  flyover: { x0: number; y0: number; x1: number; y1: number; t: number; total: number } | null;
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
    splats: [],
    pickups: [],
    nextPickupId: 1,
    pickupTimer: cfg.pickups.everyMin,
    pickupRng: (seed ^ 0x51ed27) | 0,
    charge: 0,
    boost: null,
    bombs: [],
    flyover: null,
    truck: newTruck(cfg),
    salvageBanked: 0,
    salvageUsed: 0,
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
    case "shotgun":
      return cfg.shotgun.cost;
    case "flamer":
      return cfg.flamer.cost;
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
    case "shotgun":
      return cfg.shotgun.maxHp;
    case "flamer":
      return cfg.flamer.maxHp;
    case "rocket":
      return cfg.rocket.maxHp;
    case "mine":
    case "tripwire":
      return 1;
    default:
      return cfg.turret.maxHp;
  }
}

/** Whether this kind can be built yet: the base must be at its unlock level. */
export function isUnlocked(s: GameState, cfg: GameConfig, kind: StructureKind): boolean {
  return s.stronghold.level + 1 >= cfg.unlocks[kind];
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
    case "shotgun":
      return lvl.shotguns;
    case "flamer":
      return lvl.flamers;
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
  for (const k of ALL_KINDS) {
    if (cfg.unlocks[k] === s.stronghold.level + 1) s.notices.push({ text: `Unlocked: ${KIND_NAMES[k]}`, life: 5 });
  }
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
      ? { cooldown: 0, speed: 0, strength: 0, range: 0, aim: -Math.PI / 2, targetId: null, aimPoint: null, lastShot: -1e9, shots: 0, spin: 0, barrel: 0 }
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
    st.kind === "mortar" ? cfg.mortar.upgradeCostMultiplier : st.kind === "gatling" ? cfg.gatling.upgradeCostMultiplier : st.kind === "rocket" ? cfg.rocket.upgradeCostMultiplier : st.kind === "shotgun" ? cfg.shotgun.upgradeCostMultiplier : st.kind === "flamer" ? cfg.flamer.upgradeCostMultiplier : 1;
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
  // Emergency work during an assault is allowed, at a higher price.
  const mult = s.phase === "wave" ? cfg.repair.assaultMultiplier : 1;
  if (target.kind === "stronghold") {
    const missing = s.stronghold.maxHp - s.stronghold.hp;
    if (missing <= 0) return "nothing-to-repair";
    const per = cfg.repair.strongholdCostPerHp * mult;
    const hp = Math.min(missing, Math.floor(s.currency / per));
    if (hp <= 0) return "insufficient-funds";
    return { hp, cost: Math.ceil(hp * per), rebuild: false };
  }
  const st = structureById(s, target.id);
  if (!st) return "no-such-structure";
  if (st.destroyed) {
    const cost = Math.ceil(st.spent * cfg.repair.rubbleShare * mult);
    if (s.currency < cost) return "insufficient-funds";
    return { hp: st.maxHp, cost, rebuild: true };
  }
  const missing = st.maxHp - st.hp;
  if (missing <= 0) return "nothing-to-repair";
  const per = ((st.spent * cfg.repair.structureShare) / st.maxHp) * mult;
  const hp = per > 0 ? Math.min(missing, Math.floor(s.currency / per)) : missing;
  if (hp <= 0) return "insufficient-funds";
  return { hp, cost: Math.ceil(hp * per), rebuild: false };
}

/** Repair the stronghold or a structure (including rebuilding rubble and re-arming traps). Costs more during an assault. */
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
  let rate = cfg.turret.fireRate;
  let dmg = cfg.turret.damage;
  if (kind === "mortar") [rate, dmg] = [cfg.mortar.fireRate, cfg.mortar.damage];
  else if (kind === "rocket") [rate, dmg] = [cfg.rocket.fireRate, cfg.rocket.damage];
  else if (kind === "gatling") [rate, dmg] = [g.minRate + (g.maxRate - g.minRate) * t.spin, g.damage];
  else if (kind === "shotgun") [rate, dmg] = [cfg.shotgun.fireRate, cfg.shotgun.damage];
  else if (kind === "flamer") [rate, dmg] = [cfg.flamer.fireRate, cfg.flamer.damage];
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

/**
 * How many barrels (machine gun), tubes (mortar, rocket launcher) a weapon
 * shows. Each Speed level adds one; they fire in turn.
 */
export function barrelCount(st: Structure): number {
  const speed = st.turret?.speed ?? 0;
  if (st.kind === "rocket" || st.kind === "shotgun") return 2 + speed;
  if (st.kind === "machine-gun" || st.kind === "mortar") return 1 + speed;
  return 1;
}

/** Sideways spacing between neighbouring barrels, in world units. */
export function barrelSpacing(st: Structure): number {
  return st.kind === "rocket" ? 12 : st.kind === "mortar" ? 13 : st.kind === "shotgun" ? 8 : 7;
}

/** Which barrel fired last (0-based, left to right). */
export function lastBarrel(st: Structure): number {
  const n = barrelCount(st);
  return (((st.turret?.shots ?? 0) - 1) % n + n) % n;
}

/** Sideways offset of the barrel that fired last, relative to the weapon's centre line. */
function barrelOffset(st: Structure, _tur: Turret): number {
  const n = barrelCount(st);
  return (lastBarrel(st) - (n - 1) / 2) * barrelSpacing(st);
}

/** A machine gun's reach after Range upgrades (mortars use their own fixed range). */
export function turretRange(cfg: GameConfig, st: Structure): number {
  if (st.kind === "mortar") return cfg.mortar.range;
  if (st.kind === "gatling") return cfg.gatling.range;
  if (st.kind === "rocket") return cfg.rocket.range;
  if (st.kind === "shotgun") return cfg.shotgun.range;
  if (st.kind === "flamer") return cfg.flamer.range;
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
    const bounty = s.boost?.kind === "bounty" ? cfg.boost.bounty.drops : 1;
    const drop = rollDrop(s, cfg, e.type) * bounty;
    if (!s.boost) s.charge = Math.min(1, s.charge + 1 / cfg.boost.killsToFill);
    if (s.splats.length >= 140) s.splats.shift();
    s.splats.push({ x: e.x, y: e.y, type: e.type, shape: e.id, life: SPLAT_SECONDS });
    s.currency += drop;
    s.earned += drop;
    if (drop > 0 && s.popups.length < 80) s.popups.push({ x: e.x, y: e.y, amount: drop, life: POPUP_SECONDS });
    return true;
  }
  return false;
}

function pickupRandom(s: GameState): number {
  s.pickupRng = (s.pickupRng + 0x6d2b79f5) | 0;
  let t = s.pickupRng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Airstrike bombs count down and go off, hitting every zombie in the blast. Structures and the stronghold are never hurt. */
function stepBombs(s: GameState, cfg: GameConfig, dt: number): void {
  if (s.flyover) {
    s.flyover.t += dt;
    if (s.flyover.t >= s.flyover.total) s.flyover = null;
  }
  if (s.bombs.length === 0) return;
  const kept: Bomb[] = [];
  for (const b of s.bombs) {
    b.delay -= dt;
    if (b.delay > 0) {
      kept.push(b);
      continue;
    }
    const r2 = b.radius * b.radius;
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      if (dx * dx + dy * dy <= r2) damageEnemy(s, cfg, e, b.damage);
    }
    s.blasts.push({ x: b.x, y: b.y, r: b.radius, life: BLAST_SECONDS });
  }
  s.bombs = kept;
}

/** Pickups appear only during an assault, on a random tile inside the fence, and fade. */
function stepPickups(s: GameState, cfg: GameConfig, dt: number): void {
  if (s.pickups.length > 0) {
    for (const p of s.pickups) p.life -= dt;
    s.pickups = s.pickups.filter((p) => p.life > 0);
  }
  const pc = cfg.pickups;
  if (s.phase !== "wave" || pc.everyMax <= 0) return;
  s.pickupTimer -= dt;
  if (s.pickupTimer > 0) return;
  s.pickupTimer = pc.everyMin + pickupRandom(s) * (pc.everyMax - pc.everyMin);
  const tiles = buildableTiles(cfg);
  if (tiles.length === 0) return;
  const tile = tiles[Math.floor(pickupRandom(s) * tiles.length)]!;
  const hurt = s.stronghold.hp < s.stronghold.maxHp;
  const kind: PickupKind = hurt && pickupRandom(s) < pc.healthChance ? "health" : "supplies";
  const amount = kind === "supplies" ? pc.suppliesMin + Math.floor(pickupRandom(s) * (pc.suppliesMax - pc.suppliesMin + 1)) : 0;
  const c = tileCenter(cfg, tile.col, tile.row);
  s.pickups.push({ id: s.nextPickupId++, kind, x: c.x, y: c.y, amount, life: pc.lifeSeconds });
}

/** The pickup a tap at this point would collect, if any (closest within reach). */
export function pickupAt(s: GameState, cfg: GameConfig, x: number, y: number): Pickup | null {
  let best: Pickup | null = null;
  let bestD = cfg.pickups.tapRadius;
  for (const p of s.pickups) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Collect a pickup: health repairs the stronghold at once, supplies add Supplies. */
export function collectPickup(s: GameState, cfg: GameConfig, id: number): { ok: true; kind: PickupKind; amount: number } | { ok: false } {
  const i = s.pickups.findIndex((p) => p.id === id);
  if (i < 0 || s.phase === "lost") return { ok: false };
  const p = s.pickups.splice(i, 1)[0]!;
  let amount = p.amount;
  if (p.kind === "health") {
    const before = s.stronghold.hp;
    s.stronghold.hp = Math.min(s.stronghold.maxHp, before + s.stronghold.maxHp * cfg.pickups.healShare);
    amount = Math.round(s.stronghold.hp - before);
  } else {
    s.currency += amount;
    s.earned += amount;
    s.popups.push({ x: p.x, y: p.y, amount, life: POPUP_SECONDS });
  }
  return { ok: true, kind: p.kind, amount };
}

export type BoostRejection = "not-in-assault" | "not-charged" | "already-active" | "locked";

/** Base level a boost needs (1 = from the start). */
export function boostUnlockLevel(cfg: GameConfig, kind: BoostKind): number {
  return kind === "airstrike" ? cfg.boost.airstrike.unlockBase : kind === "shield" ? cfg.boost.shield.unlockBase : 1;
}
export function boostUnlocked(s: GameState, cfg: GameConfig, kind: BoostKind): boolean {
  return s.stronghold.level + 1 >= boostUnlockLevel(cfg, kind);
}

/**
 * Plan an airstrike: a straight line of drop zones through the thickest
 * crowd, pointed at the next-thickest one, skipping any spot whose blast
 * would touch the stronghold.
 */
export function planAirstrike(s: GameState, cfg: GameConfig): { x: number; y: number }[] {
  const a = cfg.boost.airstrike;
  const sh = s.stronghold;
  const alive = s.enemies.filter((e) => e.hp > 0);
  const crowd = (x: number, y: number) => alive.reduce((n, e) => n + (Math.hypot(e.x - x, e.y - y) <= a.radius ? 1 : 0), 0);
  let p = { x: sh.x, y: sh.y - 300 };
  let best = -1;
  for (const e of alive) {
    const c = crowd(e.x, e.y);
    if (c > best) {
      best = c;
      p = { x: e.x, y: e.y };
    }
  }
  // Direction: toward the thickest crowd that is far enough away to give the line a heading.
  let q: { x: number; y: number } | null = null;
  best = -1;
  for (const e of alive) {
    if (Math.hypot(e.x - p.x, e.y - p.y) < a.spacing * 2) continue;
    const c = crowd(e.x, e.y);
    if (c > best) {
      best = c;
      q = { x: e.x, y: e.y };
    }
  }
  // With no second crowd, fly across the approach: at right angles to the line from the stronghold.
  let ang = q ? Math.atan2(q.y - p.y, q.x - p.x) : Math.atan2(p.y - sh.y, p.x - sh.x) + Math.PI / 2;
  if (!Number.isFinite(ang)) ang = 0;
  const keepOut = sh.halfSize * Math.SQRT2 + a.radius * 0.6;
  const zones: { x: number; y: number }[] = [];
  // Start the line so that P and (if any) Q both fall inside it.
  const span = (a.bombs - 1) * a.spacing;
  const lead = q ? Math.min(span - a.spacing, Math.max(a.spacing, (span - Math.hypot(q.x - p.x, q.y - p.y)) / 2)) : span / 2;
  for (let i = 0; i < a.bombs; i++) {
    const d = i * a.spacing - lead;
    const x = p.x + Math.cos(ang) * d;
    const y = p.y + Math.sin(ang) * d;
    if (x < 0 || y < 0 || x > cfg.world.width || y > cfg.world.height) continue;
    if (Math.hypot(x - sh.x, y - sh.y) < keepOut) continue;
    zones.push({ x, y });
  }
  return zones;
}

/** Spend a full charge meter on a boost. Assault only. */
export function activateBoost(s: GameState, cfg: GameConfig, kind: BoostKind): { ok: true } | { ok: false; reason: BoostRejection } {
  if (s.phase !== "wave") return { ok: false, reason: "not-in-assault" };
  if (s.boost) return { ok: false, reason: "already-active" };
  if (s.charge < 1) return { ok: false, reason: "not-charged" };
  if (!boostUnlocked(s, cfg, kind)) return { ok: false, reason: "locked" };
  let seconds: number;
  if (kind === "airstrike") {
    const a = cfg.boost.airstrike;
    const zones = planAirstrike(s, cfg);
    const damage = cfg.enemies.walker.maxHp * wavePlan(cfg, s.wave).hpMultiplier * a.damageWalkers;
    zones.forEach((z, i) => {
      const delay = a.warnSeconds + i * a.interval;
      s.bombs.push({ x: z.x, y: z.y, delay, total: delay, damage, radius: a.radius });
    });
    seconds = a.warnSeconds + a.bombs * a.interval + 0.3;
    const first = zones[0];
    const last = zones[zones.length - 1];
    if (first && last && zones.length > 1) {
      const ang = Math.atan2(last.y - first.y, last.x - first.x);
      const over = 500;
      s.flyover = { x0: first.x - Math.cos(ang) * over, y0: first.y - Math.sin(ang) * over, x1: last.x + Math.cos(ang) * over, y1: last.y + Math.sin(ang) * over, t: 0, total: seconds + 0.6 };
    }
  } else {
    seconds = cfg.boost[kind].seconds;
  }
  s.charge = 0;
  s.boost = { kind, left: seconds, total: seconds };
  return { ok: true };
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

  stepPickups(s, cfg, dt);
  if (s.boost) {
    if (s.boost.kind === "shield") {
      s.stronghold.hp = Math.min(s.stronghold.maxHp, s.stronghold.hp + s.stronghold.maxHp * cfg.boost.shield.regenPerSecond * dt);
    }
    s.boost.left -= dt;
    if (s.boost.left <= 0) s.boost = null;
  }
  stepBombs(s, cfg, dt);
  stepBurns(s, cfg, dt);
  stepTruck(s, cfg, dt);
  stepEnemies(s, cfg, dt);
  stepTraps(s, cfg);
  stepTurrets(s, cfg, s.boost?.kind === "overdrive" ? dt * cfg.boost.overdrive.fireRate : dt);
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
    s.bombs = [];
    // The truck that left this wave comes back next wave; a wrecked one is replaced.
    if (s.truck.state === "away") s.truck.due = true;
    else if (s.truck.state === "wrecked") resetTruck(s, cfg);
    s.wavesCleared++;
    s.wave++;
    s.rockets = [];
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
  const truck = s.truck;
  const exposed = truckExposed(s);
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const w = cfg.enemies[e.type];
    const shGap = distanceToStronghold(s, e.x, e.y) - w.radius;
    // A truck in the open draws nearby zombies off their route.
    if (exposed && shGap > 0) {
      const td = Math.hypot(truck.x - e.x, truck.y - e.y);
      if (td <= cfg.truck.aggroRadius) {
        const gap = td - w.radius - cfg.truck.width / 2;
        if (gap > 0) {
          e.attacking = false;
          moveToward(e, truck.x, truck.y, Math.min(w.speed * dt, gap));
        } else if (attackTick(e, w.attackCooldown, dt)) {
          truck.hp -= w.structureDamage;
        }
        continue;
      }
    }
    if (shGap <= 0) {
      if (attackTick(e, w.attackCooldown, dt)) {
        // The force field soaks up every hit while it runs.
        if (s.boost?.kind !== "shield") {
          s.stronghold.hp -= w.structureDamage;
          s.damageTaken += w.structureDamage;
        }
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
    if (slot.kind === "shotgun") {
      stepShotgun(s, cfg, slot, tur, dt);
      continue;
    }
    if (slot.kind === "flamer") {
      stepFlamer(s, cfg, slot, tur, dt);
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
      tur.shots++;
      if (s.projectiles.length >= cfg.limits.maxProjectiles) continue;
      // Each barrel fires in turn from its own muzzle, straight at the target.
      const side = barrelOffset(slot, tur);
      const mx = slot.x + Math.cos(tur.aim) * t.radius - Math.sin(tur.aim) * side;
      const my = slot.y + Math.sin(tur.aim) * t.radius + Math.cos(tur.aim) * side;
      const shot = Math.atan2(target.y - my, target.x - mx);
      const cos = Math.cos(shot);
      const sin = Math.sin(shot);
      s.projectiles.push({
        x: mx,
        y: my,
        vx: cos * t.projectileSpeed,
        vy: sin * t.projectileSpeed,
        damage: stats.damage,
        life: cfg.projectile.maxLifetime,
      });
      s.shotsFired++;
    }
  }
}

/** Shotgun: a fan of short-lived pellets at the nearest threat, barrels firing in turn. */
function stepShotgun(s: GameState, cfg: GameConfig, slot: Structure, tur: Turret, dt: number): void {
  const g = cfg.shotgun;
  const stats = turretStats(cfg, tur, "shotgun");
  tur.cooldown -= dt;
  const target = pickTarget(s, cfg, slot, g.range);
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
  tur.shots++;
  const side = barrelOffset(slot, tur);
  const mx = slot.x + Math.cos(tur.aim) * g.radius - Math.sin(tur.aim) * side;
  const my = slot.y + Math.sin(tur.aim) * g.radius + Math.cos(tur.aim) * side;
  const life = (g.range * 1.15) / g.projectileSpeed;
  for (let i = 0; i < g.pellets; i++) {
    if (s.projectiles.length >= cfg.limits.maxProjectiles) break;
    const a = tur.aim + (g.pellets > 1 ? (i / (g.pellets - 1) - 0.5) * g.spread : 0);
    s.projectiles.push({ x: mx, y: my, vx: Math.cos(a) * g.projectileSpeed, vy: Math.sin(a) * g.projectileSpeed, damage: stats.damage, life });
  }
  s.shotsFired++;
}

/** Whether a point is inside a flamethrower's cone. */
function inCone(slot: Structure, aim: number, range: number, halfAngle: number, x: number, y: number, pad: number): boolean {
  const dx = x - slot.x;
  const dy = y - slot.y;
  const d = Math.hypot(dx, dy);
  if (d > range + pad) return false;
  let da = Math.atan2(dy, dx) - aim;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  return Math.abs(da) <= halfAngle + (d > 0 ? Math.atan2(pad, d) : Math.PI);
}

/** Flamethrower: each tick burns everything in the cone and sets it alight. */
function stepFlamer(s: GameState, cfg: GameConfig, slot: Structure, tur: Turret, dt: number): void {
  const f = cfg.flamer;
  const stats = turretStats(cfg, tur, "flamer");
  tur.cooldown -= dt;
  const target = pickTarget(s, cfg, slot, f.range);
  tur.targetId = target ? target.id : null;
  if (!target) {
    if (tur.cooldown < 0) tur.cooldown = 0;
    return;
  }
  // The nozzle swings toward the target rather than snapping, so the cone sweeps.
  const want = Math.atan2(target.y - slot.y, target.x - slot.x);
  let da = want - tur.aim;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  const turn = 5 * dt;
  tur.aim += Math.abs(da) <= turn ? da : Math.sign(da) * turn;
  tur.lastShot = s.time;
  while (tur.cooldown <= 0) {
    tur.cooldown += 1 / stats.fireRate;
    tur.shots++;
    s.shotsFired++;
    const burnDps = stats.damage * stats.fireRate * f.burnShare;
    for (const e of s.enemies) {
      if (e.hp <= 0 || !inCone(slot, tur.aim, f.range, f.halfAngle, e.x, e.y, cfg.enemies[e.type].radius)) continue;
      e.burn = f.burnSeconds;
      e.burnDps = Math.max(e.burnDps ?? 0, burnDps);
      damageEnemy(s, cfg, e, stats.damage);
    }
  }
}

/** Zombies set alight keep taking damage until the fire goes out. */
function stepBurns(s: GameState, cfg: GameConfig, dt: number): void {
  for (const e of s.enemies) {
    if (e.hp <= 0 || !e.burn || e.burn <= 0) continue;
    e.burn -= dt;
    damageEnemy(s, cfg, e, (e.burnDps ?? 0) * dt);
    if (e.burn <= 0) e.burnDps = 0;
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
  tur.shots++;
  const cos = Math.cos(tur.aim);
  const sin = Math.sin(tur.aim);
  const side = barrelOffset(slot, tur);
  const splash = r.splashDamage * (1 + cfg.upgrades.strength.perLevel * tur.strength);
  s.rockets.push({
    x: slot.x + cos * r.radius - sin * side,
    y: slot.y + sin * r.radius + cos * side,
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
  tur.shots++;
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
  if (s.splats.length > 0) {
    for (const p of s.splats) p.life -= dt;
    s.splats = s.splats.filter((p) => p.life > 0);
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
