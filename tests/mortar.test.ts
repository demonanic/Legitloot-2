import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, type EnemyType } from "../games/zid/config.js";
import { panelModel } from "../games/zid/panel.js";
import { playRun, sensiblePlayer } from "../games/zid/bots.js";
import { wavePlan } from "../games/zid/waves.js";
import {
  aimMortars,
  buildMortar,
  buildTurret,
  createState,
  damageStructure,
  mortarTarget,
  nextUpgradeCost,
  recycleStructure,
  recycleValue,
  repair,
  startWaveNow,
  step,
  turretStats,
  upgradeBase,
  upgradeTurret,
  type GameState,
  type Structure,
} from "../games/zid/sim.js";

const cfg = baseConfig;
const DT = 1 / 30;

function prep(currency = 10_000): GameState {
  const s = createState(cfg, 1);
  s.currency = currency;
  return s;
}

function assault(s: GameState): void {
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
}

function add(s: GameState, x: number, y: number, hp = 1000, type: EnemyType = "walker"): void {
  s.enemies.push({ id: s.nextEnemyId++, type, maxHp: hp, x, y, hp, attackCooldown: 0, attacking: false });
}

/** A mortar on tile (4, 4), well north of the stronghold. */
function withMortar(s: GameState): Structure {
  const r = buildMortar(s, cfg, 4, 4);
  assert.ok(r.ok, JSON.stringify(r));
  return r.structure;
}

/** Freeze zombies in place so geometry stays put while shells fly. */
function freeze(s: GameState): void {
  for (const e of s.enemies) e.attackCooldown = 1e9;
}

function stepFor(s: GameState, seconds: number, hold = true): void {
  for (let i = 0; i < seconds * 30; i++) {
    if (hold) {
      // Pin zombies where the test put them.
      const pos = s.enemies.map((e) => [e.x, e.y] as const);
      step(s, cfg, DT);
      s.enemies.forEach((e, k) => {
        if (pos[k]) [e.x, e.y] = pos[k]!;
      });
    } else step(s, cfg, DT);
  }
}

test("mortar: builds for its own price, with its own health, and counts as a turret", () => {
  const s = prep(200);
  const m = withMortar(s);
  assert.equal(s.currency, 200 - cfg.mortar.cost);
  assert.equal(m.kind, "mortar");
  assert.equal(m.maxHp, cfg.mortar.maxHp);
  assert.ok(m.turret);
});

test("mortar: a shell takes time to land, then hits every zombie in the blast once", () => {
  const s = prep();
  const m = withMortar(s);
  assault(s);
  // A clump 250 px south-west of the mortar, plus one zombie far outside the blast.
  const cx = m.x;
  const cy = m.y + 250;
  add(s, cx, cy);
  add(s, cx + 30, cy);
  add(s, cx - 30, cy + 20);
  add(s, cx + cfg.mortar.blastRadius * 3, cy);
  freeze(s);
  step(s, cfg, DT);
  assert.equal(s.shells.length, 1, "one shell in the air");
  const hpAfterLaunch = s.enemies.map((e) => e.hp);
  assert.deepEqual(hpAfterLaunch, [1000, 1000, 1000, 1000], "nothing is hurt while the shell flies");
  const flight = s.shells[0]!.total;
  assert.ok(flight > 0.5, `flight ${flight}`);
  stepFor(s, flight + 0.1);
  const dmg = turretStats(cfg, m.turret!, "mortar").damage;
  const hits = s.enemies.map((e) => 1000 - e.hp);
  // Several shells may have landed by now; each clump member took the same whole number of hits.
  const n = hits[0]! / dmg;
  assert.ok(n >= 1 && Number.isInteger(Math.round(n * 1000) / 1000));
  assert.equal(hits[1], hits[0]);
  assert.equal(hits[2], hits[0]);
  assert.equal(hits[3], 0, "the zombie outside the blast is untouched");
});

test("mortar: one kill pays once even when several shells land on it", () => {
  const s = prep();
  const m = withMortar(s);
  assault(s);
  add(s, m.x, m.y + 250, 1);
  freeze(s);
  const kills0 = s.kills;
  step(s, cfg, DT);
  // Fake a second shell on the same spot.
  s.shells.push({ ...s.shells[0]! });
  stepFor(s, 3);
  assert.equal(s.kills - kills0, 1);
});

test("mortar: can't hit anything inside its minimum range, or beyond its range", () => {
  const s = prep();
  const m = withMortar(s);
  assault(s);
  add(s, m.x, m.y + cfg.mortar.minRange - 20);
  add(s, m.x, m.y + cfg.mortar.range + 40);
  assert.equal(mortarTarget(s, cfg, m), null);
  freeze(s);
  stepFor(s, 3);
  assert.equal(s.shells.length + s.blasts.length, 0);
});

test("mortar: on automatic it fires at the thickest crowd", () => {
  const s = prep();
  const m = withMortar(s);
  assault(s);
  add(s, m.x - 150, m.y + 200); // a lone zombie
  for (let i = 0; i < 5; i++) add(s, m.x + 120 + i * 10, m.y + 300); // a crowd
  const t = mortarTarget(s, cfg, m)!;
  assert.ok(t.x > m.x + 100, `aimed at ${t.x}`);
});

test("aim: tap-to-aim only during an assault and only with a working mortar", () => {
  const s = prep();
  assert.deepEqual(aimMortars(s, cfg, { x: 100, y: 100 }), { ok: false, reason: "not-in-assault" });
  const s2 = prep();
  assault(s2);
  assert.deepEqual(aimMortars(s2, cfg, { x: 100, y: 100 }), { ok: false, reason: "no-mortars" });
  const s3 = prep();
  const m = withMortar(s3);
  assault(s3);
  damageStructure(s3, m, 1e9);
  assert.deepEqual(aimMortars(s3, cfg, { x: 100, y: 100 }), { ok: false, reason: "no-mortars" }, "rubble can't fire");
});

test("aim: a tap sends one mortar's shells there, even with zombies elsewhere; tapping the crosshair frees it", () => {
  const s = prep();
  const m = withMortar(s);
  assault(s);
  add(s, m.x - 200, m.y + 250);
  const aim = { x: m.x + 150, y: m.y + 280 };
  assert.deepEqual(aimMortars(s, cfg, aim), { ok: true, action: "aimed", mortarId: m.id });
  step(s, cfg, DT);
  assert.equal(s.shells.length, 1);
  assert.deepEqual([s.shells[0]!.tx, s.shells[0]!.ty], [aim.x, aim.y]);
  assert.deepEqual(aimMortars(s, cfg, { x: aim.x + 20, y: aim.y - 10 }), { ok: true, action: "freed", mortarId: m.id });
  assert.equal(m.turret!.aimPoint, null);
  assert.deepEqual(mortarTarget(s, cfg, m), { x: s.enemies[0]!.x, y: s.enemies[0]!.y });
});

test("aim: a spot no mortar can reach is refused", () => {
  const s = prep();
  const m = withMortar(s);
  assault(s);
  assert.deepEqual(aimMortars(s, cfg, { x: m.x + 10, y: m.y + 10 }), { ok: false, reason: "out-of-reach" }, "dead zone");
  assert.deepEqual(aimMortars(s, cfg, { x: m.x, y: m.y + cfg.mortar.range + 50 }), { ok: false, reason: "out-of-reach" }, "too far");
  assert.equal(m.turret!.aimPoint, null);
});

test("aim: crosshairs and shells in the air are cleared when the wave ends", () => {
  const s = prep();
  const m = withMortar(s);
  assault(s);
  assert.ok(aimMortars(s, cfg, { x: m.x, y: m.y + 250 }).ok);
  step(s, cfg, DT); // no enemies left: wave clears
  assert.equal(s.phase, "prep");
  assert.equal(m.turret!.aimPoint, null);
  assert.equal(s.shells.length, 0);
});

test("split fire: each tap claims the closest free mortar in reach; when all are aimed the closest one moves", () => {
  const s = prep();
  assert.ok(upgradeBase(s, cfg).ok);
  const a = buildMortar(s, cfg, 2, 4);
  const b = buildMortar(s, cfg, 6, 4);
  assert.ok(a.ok && b.ok);
  const ma = a.structure;
  const mb = b.structure;
  assault(s);
  // Both mortars reach every spot used here.
  const p1 = { x: ma.x + 40, y: 600 }; // closer to A
  const r1 = aimMortars(s, cfg, p1);
  assert.deepEqual(r1, { ok: true, action: "aimed", mortarId: ma.id });
  const p2 = { x: ma.x + 100, y: 700 }; // still closer to A, but A is taken
  assert.deepEqual(aimMortars(s, cfg, p2), { ok: true, action: "aimed", mortarId: mb.id });
  assert.deepEqual(ma.turret!.aimPoint, p1);
  assert.deepEqual(mb.turret!.aimPoint, p2);
  // Both aimed: a third spot moves the closest one.
  const p3 = { x: mb.x - 20, y: 560 };
  assert.deepEqual(aimMortars(s, cfg, p3), { ok: true, action: "aimed", mortarId: mb.id });
  assert.deepEqual(ma.turret!.aimPoint, p1, "A keeps its target");
});

test("mortar upgrades: both Speed and Damage, priced higher than the machine gun's", () => {
  const s = prep();
  const m = withMortar(s);
  const base = turretStats(cfg, m.turret!, "mortar");
  const price = nextUpgradeCost(cfg, m, "speed")!;
  assert.ok(price > cfg.upgrades.speed.costs[0]!);
  assert.ok(upgradeTurret(s, cfg, m.id, "speed").ok);
  assert.ok(upgradeTurret(s, cfg, m.id, "strength").ok);
  const up = turretStats(cfg, m.turret!, "mortar");
  assert.ok(up.fireRate > base.fireRate);
  assert.ok(up.damage > base.damage);
  assert.equal(m.spent, cfg.mortar.cost + price + nextUpgradeCostAt(m, "strength", 0));
});

function nextUpgradeCostAt(_m: Structure, path: "speed" | "strength", level: number): number {
  return Math.round((cfg.upgrades[path].costs[level]! * cfg.mortar.upgradeCostMultiplier) / 5) * 5;
}

test("mortar rubble: can be rebuilt with upgrades kept, or recycled for the rubble share", () => {
  const s = prep();
  const m = withMortar(s);
  upgradeTurret(s, cfg, m.id, "strength");
  damageStructure(s, m, 1e9);
  assert.ok(m.destroyed);
  assert.ok(repair(s, cfg, { kind: "structure", id: m.id }).ok);
  assert.equal(m.destroyed, false);
  assert.equal(m.turret!.strength, 1);
  damageStructure(s, m, 1e9);
  const value = recycleValue(cfg, m);
  assert.equal(value, Math.floor(m.spent * cfg.recycle.rubbleShare));
  const before = s.currency;
  assert.ok(recycleStructure(s, cfg, m.id).ok);
  assert.equal(s.currency, before + value);
});

test("menu: empty tiles offer Turret, Mortar and Barricade; a mortar offers Speed, Damage, Repair, Recycle", () => {
  const s = prep();
  const empty = panelModel(s, cfg, { col: 2, row: 4 });
  assert.deepEqual(
    empty.buttons.map((b) => [b.slot, b.action.kind]),
    [["a0", "build-turret"], ["b0", "build-mortar"], ["a1", "build-barricade"], ["close", "close"]],
  );
  withMortar(s);
  const menu = panelModel(s, cfg, { col: 4, row: 4 });
  assert.match(menu.title, /^Mortar/);
  assert.deepEqual(menu.buttons.map((b) => b.action.kind), ["upgrade", "upgrade", "repair", "recycle", "close"]);
});

test("machine gun is unaffected: its stats and upgrade prices are unchanged", () => {
  const s = prep();
  const r = buildTurret(s, cfg, 2, 4);
  assert.ok(r.ok);
  assert.equal(nextUpgradeCost(cfg, r.structure, "speed"), cfg.upgrades.speed.costs[0]);
  assert.equal(turretStats(cfg, r.structure.turret!).fireRate, cfg.turret.fireRate);
});

// --- Packs and early danger ----------------------------------------------------

test("packs: from wave 2, part of each wave arrives in tight clumps", () => {
  assert.equal(wavePlan(cfg, 1).packShare, 0);
  const p = wavePlan(cfg, 4);
  assert.ok(p.packShare > 0 && p.packSize > 1);
  const s2 = createState(cfg, 5);
  s2.wave = 3;
  startWaveNow(s2, cfg);
  s2.nextSpawn = s2.spawns.length;
  s2.enemies = [];
  step(s2, cfg, DT); // clears wave 3, rolls wave 4
  assert.equal(s2.wave, 4);
  // Find bursts: at least packSize spawns within 1.5 s and 120 px of each other.
  const sp = s2.spawns;
  let clumps = 0;
  for (const a of sp) {
    const near = sp.filter((b) => Math.abs(b.at - a.at) <= 1.5 && Math.hypot(b.x - a.x, b.y - a.y) <= 120);
    if (near.length >= p.packSize) clumps++;
  }
  assert.ok(clumps >= p.packSize, `found ${clumps} spawns sitting in a clump`);
  assert.equal(sp.length, p.count);
});

test("early danger: a sensible player usually gets hit in waves 1-3, but no run ends before wave 6", () => {
  let hitEarly = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = playRun(cfg, seed, sensiblePlayer, 40);
    assert.ok(r.defeatWave === null || r.defeatWave >= 6, `seed ${seed} fell on wave ${r.defeatWave}`);
    if (r.perWave.some((w) => w.wave <= 3 && (w.damage > 0 || w.wrecked > 0))) hitEarly++;
  }
  assert.ok(hitEarly >= 8, `only ${hitEarly}/12 runs took damage in waves 1-3`);
});
