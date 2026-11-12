import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig } from "../games/zid/config.js";
import { tileStatus, tileAt } from "../games/zid/grid.js";
import { playRun, sensiblePlayer } from "../games/zid/bots.js";
import {
  activateBoost,
  buildTurret,
  collectPickup,
  createState,
  damageEnemy,
  pickupAt,
  startWaveNow,
  step,
  type GameState,
} from "../games/zid/sim.js";

const cfg = baseConfig;
const DT = 1 / 30;

/** An assault with no spawns left and one unkillable zombie parked far away, so the wave keeps running. */
function assault(): GameState {
  const s = createState(cfg, 1);
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  s.enemies.push({ id: s.nextEnemyId++, type: "walker", maxHp: 1e12, x: 5, y: 5, hp: 1e12, attackCooldown: 1e9, attacking: false });
  return s;
}
function run(s: GameState, seconds: number): void {
  for (let i = 0; i < seconds * 30; i++) {
    step(s, cfg, DT);
    s.enemies[0]!.x = 5;
    s.enemies[0]!.y = 5;
  }
}
function kill(s: GameState, type: "walker" | "brute" = "walker"): void {
  const e = { id: s.nextEnemyId++, type, maxHp: 1, x: 300, y: 300, hp: 1, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  damageEnemy(s, cfg, e, 5);
  s.enemies.pop();
}

test("pickups: appear during an assault on a buildable tile, and fade if not collected", () => {
  const s = assault();
  run(s, cfg.pickups.everyMin - 0.5);
  assert.equal(s.pickups.length, 0);
  run(s, 1);
  assert.equal(s.pickups.length, 1);
  const p = s.pickups[0]!;
  const t = tileAt(cfg, p.x, p.y)!;
  assert.equal(tileStatus(cfg, t.col, t.row), "buildable");
  assert.equal(p.kind, "supplies", "no health pickups while the stronghold is undamaged");
  run(s, cfg.pickups.lifeSeconds - 1.2);
  assert.equal(s.pickups.some((q) => q.id === p.id), true);
  run(s, 1.5);
  assert.equal(s.pickups.some((q) => q.id === p.id), false, "faded");
});

test("pickups: none appear between waves", () => {
  const s = createState(cfg, 1);
  for (let i = 0; i < 15 * 30; i++) step(s, cfg, DT);
  assert.equal(s.phase, "prep");
  assert.equal(s.pickups.length, 0);
});

test("pickups: a tap nearby collects; Supplies are added once", () => {
  const s = assault();
  s.pickups.push({ id: 99, kind: "supplies", x: 200, y: 400, amount: 20, life: 5 });
  assert.equal(pickupAt(s, cfg, 200 + cfg.pickups.tapRadius + 5, 400), null);
  const p = pickupAt(s, cfg, 215, 410)!;
  assert.equal(p.id, 99);
  const before = s.currency;
  assert.deepEqual(collectPickup(s, cfg, 99), { ok: true, kind: "supplies", amount: 20 });
  assert.equal(s.currency, before + 20);
  assert.deepEqual(collectPickup(s, cfg, 99), { ok: false });
  assert.equal(s.currency, before + 20);
});

test("pickups: health repairs the stronghold at once, never above its maximum", () => {
  const s = assault();
  s.stronghold.hp = 100;
  s.pickups.push({ id: 1, kind: "health", x: 200, y: 400, amount: 0, life: 5 });
  const heal = s.stronghold.maxHp * cfg.pickups.healShare;
  assert.deepEqual(collectPickup(s, cfg, 1), { ok: true, kind: "health", amount: heal });
  assert.equal(s.stronghold.hp, 100 + heal);
  s.stronghold.hp = s.stronghold.maxHp - 3;
  s.pickups.push({ id: 2, kind: "health", x: 200, y: 400, amount: 0, life: 5 });
  collectPickup(s, cfg, 2);
  assert.equal(s.stronghold.hp, s.stronghold.maxHp);
});

test("pickups: health pickups do appear once the stronghold is damaged", () => {
  const s = assault();
  s.stronghold.hp = 50;
  const kinds = new Set<string>();
  for (let i = 0; i < 40 && kinds.size < 2; i++) {
    run(s, cfg.pickups.everyMax);
    for (const p of s.pickups) kinds.add(p.kind);
  }
  assert.deepEqual([...kinds].sort(), ["health", "supplies"]);
});

test("pickups: they don't disturb the wave's own random rolls", () => {
  const a = createState(cfg, 7);
  const b = createState(cfg, 7);
  const off = { ...cfg, pickups: { ...cfg.pickups, everyMax: 0 } };
  startWaveNow(a, cfg);
  startWaveNow(b, off);
  for (let i = 0; i < 30 * 30; i++) {
    step(a, cfg, DT);
    step(b, off, DT);
  }
  assert.ok(a.nextPickupId > 1, "pickups appeared");
  assert.equal(a.rng, b.rng);
  assert.equal(a.kills, b.kills);
  assert.equal(a.stronghold.hp, b.stronghold.hp);
});

test("charge: kills fill the meter; it stops at full and waits", () => {
  const s = assault();
  for (let i = 0; i < cfg.boost.killsToFill - 1; i++) kill(s);
  assert.ok(s.charge < 1);
  assert.deepEqual(activateBoost(s, cfg, "overdrive"), { ok: false, reason: "not-charged" });
  kill(s);
  kill(s);
  assert.equal(s.charge, 1);
});

test("boost: only during an assault, spends the whole meter, and one at a time", () => {
  const s = createState(cfg, 1);
  s.charge = 1;
  assert.deepEqual(activateBoost(s, cfg, "overdrive"), { ok: false, reason: "not-in-assault" });
  const w = assault();
  w.charge = 1;
  assert.deepEqual(activateBoost(w, cfg, "overdrive"), { ok: true });
  assert.equal(w.charge, 0);
  w.charge = 1;
  assert.deepEqual(activateBoost(w, cfg, "bounty"), { ok: false, reason: "already-active" });
  kill(w);
  assert.equal(w.charge, 1, "no charge builds during a boost");
  run(w, cfg.boost.overdrive.seconds + 0.2);
  assert.equal(w.boost, null);
});

test("overdrive: weapons fire at the configured multiple for its duration", () => {
  const count = (boosted: boolean): number => {
    const s = createState({ ...cfg, pickups: { ...cfg.pickups, everyMax: 0 } }, 1);
    s.currency = 1000;
    // Build one machine gun next to a parked, unkillable zombie.
    const sim = s;
    return (() => {
      const r = buildOne(sim);
      startWaveNow(sim, cfg);
      sim.nextSpawn = sim.spawns.length;
      sim.enemies.push({ id: sim.nextEnemyId++, type: "walker", maxHp: 1e12, x: r.x, y: r.y - 100, hp: 1e12, attackCooldown: 1e9, attacking: false });
      if (boosted) {
        sim.charge = 1;
        activateBoost(sim, cfg, "overdrive");
      }
      for (let i = 0; i < 4 * 30; i++) {
        step(sim, cfg, DT);
        sim.enemies[0]!.x = r.x;
        sim.enemies[0]!.y = r.y - 100;
      }
      return sim.shotsFired;
    })();
  };
  const normal = count(false);
  const fast = count(true);
  assert.ok(normal > 0);
  assert.ok(Math.abs(fast / normal - cfg.boost.overdrive.fireRate) < 0.15, `${fast} vs ${normal}`);
});

function buildOne(s: GameState): { x: number; y: number } {
  const r = buildTurret(s, cfg, 4, 5);
  assert.ok(r.ok);
  return r.structure;
}

test("bounty: kills pay the multiple while it runs, then go back to normal", () => {
  const a = assault();
  const b = assault();
  b.charge = 1;
  activateBoost(b, cfg, "bounty");
  const c0 = a.currency;
  for (let i = 0; i < 10; i++) {
    kill(a, "brute");
    kill(b, "brute");
  }
  assert.equal(b.currency - c0, (a.currency - c0) * cfg.boost.bounty.drops);
});

test("splats: every kill leaves one, and they fade", () => {
  const s = assault();
  kill(s);
  kill(s, "brute");
  assert.deepEqual(s.splats.map((p) => p.type), ["walker", "brute"]);
  run(s, 5.2);
  assert.equal(s.splats.length, 0);
});

test("balance: with pickups and boosts, the sensible player still falls inside the target band", () => {
  const waves: number[] = [];
  for (let seed = 1; seed <= 12; seed++) waves.push(playRun(cfg, seed, sensiblePlayer, 40).defeatWave ?? 41);
  waves.sort((x, y) => x - y);
  const median = (waves[5]! + waves[6]!) / 2;
  assert.ok(median >= cfg.balance.typicalDefeatWaveMin && median <= cfg.balance.typicalDefeatWaveMax, `median ${median}: ${waves}`);
});

test("barrels: each Speed level adds one, and they fire in turn", async () => {
  const { barrelCount, lastBarrel, upgradeTurret, buildStructure } = await import("../games/zid/sim.js");
  const s = createState(cfg, 1);
  s.currency = 10_000;
  s.stronghold.level = 3;
  const mg = buildStructure(s, cfg, "machine-gun", 4, 5);
  const rk = buildStructure(s, cfg, "rocket", 5, 5);
  assert.ok(mg.ok && rk.ok);
  assert.equal(barrelCount(mg.structure), 1);
  assert.equal(barrelCount(rk.structure), 2);
  upgradeTurret(s, cfg, rk.structure.id, "speed");
  upgradeTurret(s, cfg, mg.structure.id, "speed");
  assert.equal(barrelCount(rk.structure), 3);
  assert.equal(barrelCount(mg.structure), 2);
  const seen: number[] = [];
  for (let i = 1; i <= 6; i++) {
    rk.structure.turret!.shots = i;
    seen.push(lastBarrel(rk.structure));
  }
  assert.deepEqual(seen, [0, 1, 2, 0, 1, 2]);
});

test("barrels: a multi-barrel gun still hits what it aims at", async () => {
  const { upgradeTurret, buildStructure } = await import("../games/zid/sim.js");
  const s = createState({ ...cfg, pickups: { ...cfg.pickups, everyMax: 0 } }, 1);
  s.currency = 10_000;
  const mg = buildStructure(s, cfg, "machine-gun", 4, 5);
  assert.ok(mg.ok);
  for (let i = 0; i < 3; i++) upgradeTurret(s, cfg, mg.structure.id, "speed");
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  const e = { id: s.nextEnemyId++, type: "runner" as const, maxHp: 1e9, x: mg.structure.x + 40, y: mg.structure.y - 150, hp: 1e9, attackCooldown: 1e9, attacking: false };
  s.enemies.push(e);
  for (let i = 0; i < 3 * 30; i++) {
    step(s, cfg, DT);
    e.x = mg.structure.x + 40;
    e.y = mg.structure.y - 150;
  }
  const hits = (1e9 - e.hp) / cfg.turret.damage;
  assert.ok(s.shotsFired >= 30);
  assert.ok(hits >= s.shotsFired * 0.9, `${hits} hits of ${s.shotsFired} shots`);
});
