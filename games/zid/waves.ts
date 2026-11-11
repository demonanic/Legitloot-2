/**
 * Wave plan: what wave N contains. Pure and deterministic; the simulation
 * rolls actual spawn positions and types from this plan with its seeded RNG.
 */

import type { EnemyType, GameConfig } from "./config.js";

export interface WavePlan {
  wave: number;
  count: number;
  /** Share of each enemy type (sums to 1). */
  mix: Record<EnemyType, number>;
  /** Multiplier on every enemy's base health this wave. */
  hpMultiplier: number;
  spawnSeconds: number;
  /** Share of spawns from one side this wave (0 = even spread). */
  lopsidedShare: number;
}

function share(wave: number, from: number, step: number, max: number): number {
  if (wave < from) return 0;
  return Math.min(max, step * (wave - from + 1));
}

export function wavePlan(cfg: GameConfig, wave: number): WavePlan {
  const w = cfg.waves;
  const runner = share(wave, w.runnerFrom, w.runnerShareStep, w.runnerShareMax);
  const brute = share(wave, w.bruteFrom, w.bruteShareStep, w.bruteShareMax);
  return {
    wave,
    count: w.baseCount + w.countPerWave * (wave - 1),
    mix: { walker: 1 - runner - brute, runner, brute },
    // Compounding: turret firepower grows with accumulated income (roughly
    // quadratic in waves), so linear health growth is outpaced and runs never end.
    hpMultiplier: Math.pow(1 + w.hpGrowthPerWave, wave - 1),
    spawnSeconds: Math.min(w.spawnMaxSeconds, w.spawnBaseSeconds + w.spawnSecondsPerWave * (wave - 1)),
    lopsidedShare: wave >= w.lopsidedFrom ? w.lopsidedShare : 0,
  };
}

/**
 * A single number for how hard a wave is, used to check that difficulty rises
 * every wave without spikes: total enemy health plus weighted structural
 * threat. It is a yardstick for tests and the balance report, not a game rule.
 */
export function waveThreat(cfg: GameConfig, wave: number): number {
  const p = wavePlan(cfg, wave);
  let threat = 0;
  for (const t of ["walker", "runner", "brute"] as const) {
    const e = cfg.enemies[t];
    const n = p.count * p.mix[t];
    const hp = e.maxHp * p.hpMultiplier;
    const dps = e.structureDamage / e.attackCooldown;
    threat += n * (hp + dps * 4);
  }
  return threat / Math.max(1, p.spawnSeconds);
}
