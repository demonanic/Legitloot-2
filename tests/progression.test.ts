import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, type GameConfig } from "../games/zid/config.js";
import { buildOnlyPlayer, passivePlayer, playRun, sensiblePlayer } from "../games/zid/bots.js";
import {
  buildTurret,
  createState,
  nextUpgradeCost,
  recycleStructure,
  rollDrop,
  startWaveNow,
  step,
  structureAt,
  turretStats,
  upgradeTurret,
  type Enemy,
  type GameState,
} from "../games/zid/sim.js";
import { wavePlan, waveThreat } from "../games/zid/waves.js";

const cfg = baseConfig;
const DT = 1 / 30;
const T: [number, number] = [2, 8];

function withTurret(): { s: GameState; id: number } {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  const r = buildTurret(s, cfg, ...T);
  assert.ok(r.ok);
  return { s, id: r.structure.id };
}

/** A tough dummy in range that never moves, then fire for `seconds`. */
function fireFor(s: GameState, seconds: number): Enemy {
  const st = s.structures[0]!;
  const e: Enemy = { id: s.nextEnemyId++, type: "walker", maxHp: 1e9, x: st.x - 150, y: st.y, hp: 1e9, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  s.phase = "wave";
  s.nextSpawn = s.spawns.length;
  const speed = cfg.enemies.walker.speed;
  cfg.enemies.walker.speed = 0;
  try {
    for (let i = 0; i < seconds * 30; i++) step(s, cfg, DT);
  } finally {
    cfg.enemies.walker.speed = speed;
  }
  return e;
}

// --- Upgrades -------------------------------------------------------------

test("upgrade: Speed raises shots per second", () => {
  const a = withTurret();
  fireFor(a.s, 6);
  const b = withTurret();
  upgradeTurret(b.s, cfg, b.id, "speed");
  fireFor(b.s, 6);
  const ratio = b.s.shotsFired / a.s.shotsFired;
  assert.ok(Math.abs(ratio - (1 + cfg.upgrades.speed.perLevel)) < 0.06, `shots ratio ${ratio.toFixed(2)}`);
});

test("upgrade: Damage (Strength) raises damage per hit, not fire rate", () => {
  const a = withTurret();
  const ea = fireFor(a.s, 6);
  const b = withTurret();
  upgradeTurret(b.s, cfg, b.id, "strength");
  const eb = fireFor(b.s, 6);
  assert.equal(b.s.shotsFired, a.s.shotsFired, "same number of shots");
  const perHitA = (1e9 - ea.hp) / a.s.shotsFired;
  const perHitB = (1e9 - eb.hp) / b.s.shotsFired;
  assert.ok(Math.abs(perHitB / perHitA - (1 + cfg.upgrades.strength.perLevel)) < 0.01);
});

test("upgrade: one turret can take both paths, and they multiply", () => {
  const { s, id } = withTurret();
  assert.ok(upgradeTurret(s, cfg, id, "speed").ok);
  assert.ok(upgradeTurret(s, cfg, id, "strength").ok);
  const st = turretStats(cfg, s.structures[0]!.turret!);
  assert.equal(st.fireRate, cfg.turret.fireRate * (1 + cfg.upgrades.speed.perLevel));
  assert.equal(st.damage, cfg.turret.damage * (1 + cfg.upgrades.strength.perLevel));
});

test("upgrade: costs are deducted per level and max level is enforced", () => {
  const { s, id } = withTurret();
  const costs = cfg.upgrades.speed.costs;
  let spent = 0;
  for (const c of costs) {
    const before = s.currency;
    assert.ok(upgradeTurret(s, cfg, id, "speed").ok);
    assert.equal(before - s.currency, c);
    spent += c;
  }
  assert.equal(nextUpgradeCost(cfg, s.structures[0]!, "speed"), null);
  const before = s.currency;
  assert.deepEqual(upgradeTurret(s, cfg, id, "speed"), { ok: false, reason: "max-level" });
  assert.equal(s.currency, before);
  assert.equal(s.structures[0]!.turret!.speed, costs.length);
  assert.ok(spent > 0);
});

test("upgrade: refused without enough supplies, during assaults and for unknown turrets; never deducts", () => {
  const { s, id } = withTurret();
  s.currency = cfg.upgrades.strength.costs[0]! - 1;
  assert.deepEqual(upgradeTurret(s, cfg, id, "strength"), { ok: false, reason: "insufficient-funds" });
  assert.equal(s.currency, cfg.upgrades.strength.costs[0]! - 1);
  assert.deepEqual(upgradeTurret(s, cfg, 999, "strength"), { ok: false, reason: "no-such-structure" });
  s.currency = 1000;
  startWaveNow(s, cfg);
  assert.deepEqual(upgradeTurret(s, cfg, id, "speed"), { ok: false, reason: "assault-active" });
  assert.equal(s.currency, 1000);
  assert.equal(s.structures[0]!.turret!.speed, 0);
});

// --- Recycle --------------------------------------------------------------

test("recycle: removes the turret, frees the tile, returns a share of everything spent", () => {
  const { s, id } = withTurret();
  upgradeTurret(s, cfg, id, "speed");
  const spent = cfg.turret.cost + cfg.upgrades.speed.costs[0]!;
  const before = s.currency;
  assert.deepEqual(recycleStructure(s, cfg, id), { ok: true });
  assert.equal(s.currency - before, Math.floor(spent * cfg.recycle.intactShare));
  assert.equal(structureAt(s, ...T), null);
  assert.ok(buildTurret(s, cfg, ...T).ok, "the tile can be built on again");
});

test("recycle: refused during assaults and for unknown structures", () => {
  const { s, id } = withTurret();
  assert.deepEqual(recycleStructure(s, cfg, 999), { ok: false, reason: "no-such-structure" });
  startWaveNow(s, cfg);
  assert.deepEqual(recycleStructure(s, cfg, id), { ok: false, reason: "assault-active" });
  assert.equal(s.structures.length, 1);
});

// --- Enemy types and drops -----------------------------------------------

function lone(type: Enemy["type"], seconds: number): { s: GameState; e: Enemy } {
  const s = createState(cfg, 1);
  s.phase = "wave";
  s.nextSpawn = s.spawns.length;
  const st = cfg.enemies[type];
  const e: Enemy = { id: s.nextEnemyId++, type, maxHp: st.maxHp, x: 360, y: 60, hp: st.maxHp, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  for (let i = 0; i < seconds * 30; i++) step(s, cfg, DT);
  return { s, e };
}

test("enemies: runners move faster than walkers, brutes slower", () => {
  const moved = (t: Enemy["type"]) => lone(t, 2).e.y - 60;
  const w = moved("walker");
  const r = moved("runner");
  const b = moved("brute");
  assert.ok(r > w * 1.5, `runner ${r} vs walker ${w}`);
  assert.ok(b < w, `brute ${b} vs walker ${w}`);
});

test("enemies: brutes are tougher and hit the stronghold far harder", () => {
  const e = cfg.enemies;
  assert.ok(e.brute.maxHp > e.walker.maxHp * 3);
  assert.ok(e.runner.maxHp < e.walker.maxHp);
  // Damage dealt in the first 10 s of contact with the stronghold.
  const hit = (t: Enemy["type"]) => {
    const s = createState(cfg, 1);
    s.phase = "wave";
    s.nextSpawn = s.spawns.length;
    const st = cfg.enemies[t];
    const y = cfg.stronghold.y - cfg.stronghold.halfSize - st.radius;
    s.enemies.push({ id: 1, type: t, maxHp: st.maxHp, x: cfg.stronghold.x, y, hp: st.maxHp, attackCooldown: 0, attacking: false });
    for (let i = 0; i < 10 * 30; i++) step(s, cfg, DT);
    return s.damageTaken;
  };
  assert.ok(hit("brute") > hit("walker") * 2, `brute ${hit("brute")} vs walker ${hit("walker")}`);
});

test("drops: random, within each type's range, and reproducible from the seed", () => {
  const roll = (seed: number, type: Enemy["type"]) => {
    const s = createState(cfg, seed);
    return Array.from({ length: 200 }, () => rollDrop(s, cfg, type));
  };
  for (const type of ["walker", "runner", "brute"] as const) {
    const d = cfg.enemies[type].drop;
    const a = roll(5, type);
    assert.deepEqual(a, roll(5, type), "same seed, same drops");
    for (const v of a) assert.ok(v === 0 || (v >= d.min && v <= d.max));
    const zeroShare = a.filter((v) => v === 0).length / a.length;
    assert.ok(Math.abs(zeroShare - (1 - d.chance)) < 0.12, `${type} no-drop share ${zeroShare}`);
    if (d.chance < 1) assert.ok(new Set(a).size > 2, "drops vary");
  }
  assert.ok(Math.min(...roll(9, "brute")) >= cfg.enemies.brute.drop.min, "brutes always drop");
});

// --- Waves ----------------------------------------------------------------

test("waves: every wave is harder than the last, with no spike over 40%", () => {
  let prev = waveThreat(cfg, 1);
  for (let w = 2; w <= 30; w++) {
    const t = waveThreat(cfg, w);
    assert.ok(t > prev, `wave ${w} is not harder`);
    assert.ok(t / prev < 1.4, `wave ${w} jumps ${((t / prev - 1) * 100).toFixed(0)}%`);
    assert.ok(wavePlan(cfg, w).count > wavePlan(cfg, w - 1).count);
    prev = t;
  }
});

test("waves: runners and brutes arrive on schedule, and the mix always sums to 1", () => {
  for (let w = 1; w <= 30; w++) {
    const p = wavePlan(cfg, w);
    assert.ok(Math.abs(p.mix.walker + p.mix.runner + p.mix.brute - 1) < 1e-9);
    assert.equal(p.mix.runner > 0, w >= cfg.waves.runnerFrom);
    assert.equal(p.mix.brute > 0, w >= cfg.waves.bruteFrom);
  }
});

test("waves: rolled spawns match the plan's count and types", () => {
  const s = createState(cfg, 3);
  s.wave = 8;
  s.phase = "wave";
  // Advance the RNG through a fresh roll by clearing the wave.
  s.enemies = [];
  s.nextSpawn = s.spawns.length;
  step(s, cfg, DT);
  const p = wavePlan(cfg, 9);
  assert.equal(s.spawns.length, p.count);
  const brutes = s.spawns.filter((sp) => sp.type === "brute").length;
  assert.ok(brutes > 0 && brutes < p.count * 0.3);
  for (const sp of s.spawns) assert.equal(sp.hp, Math.round(cfg.enemies[sp.type].maxHp * p.hpMultiplier));
});

test("waves: lopsided waves send most enemies from one side", () => {
  const s = createState(cfg, 11);
  s.wave = cfg.waves.lopsidedFrom - 1;
  s.phase = "wave";
  s.nextSpawn = s.spawns.length;
  step(s, cfg, DT);
  const { width: w, height: h } = cfg.world;
  const side = (x: number, y: number) => (y < 0 ? "n" : y > h ? "s" : x < 0 ? "w" : x > w ? "e" : "?");
  const counts: Record<string, number> = {};
  for (const sp of s.spawns) counts[side(sp.x, sp.y)] = (counts[side(sp.x, sp.y)] ?? 0) + 1;
  const top = Math.max(...Object.values(counts)) / s.spawns.length;
  assert.ok(top > 0.5, `largest side share ${top.toFixed(2)}`);
});

// --- Balance across seeds ---------------------------------------------------

test("balance: a sensible player typically falls inside the target range (20 seeds)", () => {
  const waves: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const r = playRun(cfg, seed, sensiblePlayer, 40);
    assert.notEqual(r.defeatWave, null, `seed ${seed} never fell: the game must stay endless but beatable`);
    waves.push(r.defeatWave!);
  }
  waves.sort((a, b) => a - b);
  const median = (waves[9]! + waves[10]!) / 2;
  assert.ok(median >= cfg.balance.typicalDefeatWaveMin && median <= cfg.balance.typicalDefeatWaveMax, `median ${median}`);
});

test("balance: doing nothing after wave 1 loses early; investing matters", () => {
  const passive = playRun(cfg, 1, passivePlayer, 40).defeatWave!;
  const build = playRun(cfg, 1, buildOnlyPlayer, 40).defeatWave!;
  const sensible = playRun(cfg, 1, sensiblePlayer, 40).defeatWave!;
  assert.ok(passive <= 5, `passive lasted to wave ${passive}`);
  // Building helps; building, upgrading and repairing helps far more.
  assert.ok(build > passive + 2, `build-only ${build} vs passive ${passive}`);
  assert.ok(sensible > build + 3, `sensible ${sensible} vs build-only ${build}`);
});

test("economy: supplies never go negative across whole runs", () => {
  const cfgCheck: GameConfig = cfg;
  for (let seed = 1; seed <= 5; seed++) {
    const s = createState(cfgCheck, seed);
    for (let i = 0; i < 30 * 400 && s.phase !== "lost"; i++) {
      if (s.phase === "prep") sensiblePlayer(s, cfgCheck);
      assert.ok(s.currency >= 0);
      step(s, cfgCheck, DT);
    }
  }
});
