/**
 * Wave preview: what the next wave holds, read from its pre-rolled spawns.
 * Pure: no drawing, no state changes.
 */
import { ENEMY_TYPES, type Edge, type EnemyType, type GameConfig } from "./config.js";
import type { Spawn } from "./sim.js";

export interface SideCount {
  edge: Edge;
  count: number;
  /** Mean position along the edge (x for north/south, y for east/west). */
  along: number;
}

export interface WavePreview {
  wave: number;
  count: number;
  /** Types present, most numerous first. */
  types: { type: EnemyType; count: number }[];
  /** Types arriving for the first time this run. */
  newTypes: EnemyType[];
  /** Sides that send anyone, most first. */
  sides: SideCount[];
  /** The side sending at least half the wave, if any. */
  mainSide: Edge | null;
  /** Bosses in this wave. */
  bosses: number;
}

export const ZOMBIE_NAMES: Record<EnemyType, string> = {
  walker: "Walker",
  runner: "Runner",
  brute: "Brute",
  armored: "Armored",
  spitter: "Spitter",
  boomer: "Boomer",
  screamer: "Screamer",
  boss: "Boss",
};

/** One line on each type: what it does and how to deal with it. */
export const ZOMBIE_TIPS: Record<EnemyType, string> = {
  walker: "Slow and steady. Guns handle them.",
  runner: "Fast and fragile. Guard the stronghold.",
  brute: "Slow and tough, hits the base hard. Focus fire.",
  armored: "Bullets do half. Use shells, fire, arcs or beams.",
  spitter: "Spits acid at weapons from range. Outrange it.",
  boomer: "Explodes on contact. Shoot it before it arrives.",
  screamer: "Speeds up zombies near it. Kill it first.",
  boss: "Huge. Stomps weapons near it, charges when hurt.",
};

export function spawnEdge(cfg: GameConfig, sp: Pick<Spawn, "x" | "y">): Edge {
  if (sp.y < 0) return "north";
  if (sp.y > cfg.world.height) return "south";
  return sp.x < 0 ? "west" : "east";
}

/**
 * Summarise a wave from its rolled spawns. `seen` lists the types already met
 * this run; any other type present is reported as new.
 */
export function wavePreview(cfg: GameConfig, wave: number, spawns: readonly Spawn[], seen: readonly EnemyType[] = []): WavePreview {
  const byType = new Map<EnemyType, number>();
  const bySide = new Map<Edge, { count: number; sum: number }>();
  for (const sp of spawns) {
    byType.set(sp.type, (byType.get(sp.type) ?? 0) + 1);
    const edge = spawnEdge(cfg, sp);
    const side = bySide.get(edge) ?? { count: 0, sum: 0 };
    side.count++;
    side.sum += edge === "north" || edge === "south" ? sp.x : sp.y;
    bySide.set(edge, side);
  }
  const types = ENEMY_TYPES.filter((t) => byType.has(t))
    .map((type) => ({ type, count: byType.get(type)! }))
    .sort((a, b) => b.count - a.count);
  const newTypes = types.map((t) => t.type).filter((t) => t !== "walker" && t !== "boss" && !seen.includes(t));
  const sides = [...bySide.entries()]
    .map(([edge, v]) => ({ edge, count: v.count, along: v.sum / v.count }))
    .sort((a, b) => b.count - a.count);
  const top = sides[0];
  const mainSide = top && spawns.length > 0 && top.count / spawns.length >= 0.5 ? top.edge : null;
  return { wave, count: spawns.length, types, newTypes, sides, mainSide, bosses: byType.get("boss") ?? 0 };
}
