import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, type EnemyType } from "../games/zid/config.js";
import { pathField } from "../games/zid/path.js";
import { panelModel } from "../games/zid/panel.js";
import {
  buildLimit,
  buildStructure,
  checkBuild,
  countKind,
  createState,
  repair,
  repairQuote,
  startWaveNow,
  step,
  structureAt,
  trapDamageMultiplier,
  turretStats,
  upgradeBase,
  type GameState,
  type Structure,
  type StructureKind,
} from "../games/zid/sim.js";

const cfg = baseConfig;
const DT = 1 / 30;

/** Prep state on a given wave, with plenty of supplies. */
/** A run with everything unlocked (base level 4) unless a lower base level is asked for. */
function prep(baseLevel = 4, currency = 10_000): GameState {
  const s = createState(cfg, 1);
  s.wave = 10;
  s.stronghold.level = baseLevel - 1;
  s.currency = currency;
  return s;
}

function assault(s: GameState): void {
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  s.enemies = [];
}

function add(s: GameState, x: number, y: number, hp = 1000, type: EnemyType = "walker") {
  const e = { id: s.nextEnemyId++, type, maxHp: hp, x, y, hp, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  return e;
}

function build(s: GameState, kind: StructureKind, col: number, row: number): Structure {
  const r = buildStructure(s, cfg, kind, col, row);
  assert.ok(r.ok, `${kind} on ${col},${row}: ${JSON.stringify(r)}`);
  return r.structure;
}

/** Hold zombies in place while stepping. */
function hold(s: GameState, seconds: number): void {
  for (let i = 0; i < seconds * 30; i++) {
    const pos = s.enemies.map((e) => [e.x, e.y] as const);
    step(s, cfg, DT);
    s.enemies.forEach((e, k) => {
      if (pos[k]) [e.x, e.y] = pos[k]!;
    });
  }
}

// --- Unlocks ------------------------------------------------------------------

test("unlocks: trip wire at base level 2, Gatling at 3, rockets at 4; locked builds are refused and shown", () => {
  const s = prep(1);
  for (const [kind, level] of [["tripwire", 2], ["gatling", 3], ["rocket", 4]] as const) {
    assert.equal(cfg.unlocks[kind], level);
    s.stronghold.level = level - 2;
    assert.equal(checkBuild(s, cfg, 2, 4, kind), "locked");
    s.stronghold.level = level - 1;
    assert.equal(checkBuild(s, cfg, 2, 4, kind), null);
  }
  s.stronghold.level = 0;
  s.wave = 30;
  assert.equal(checkBuild(s, cfg, 2, 4, "gatling"), "locked", "waves alone don't unlock anything");
  const menu = panelModel(s, cfg, { col: 2, row: 4 });
  const gat = menu.buttons.find((b) => b.action.kind === "build" && b.action.structure === "gatling")!;
  assert.equal(gat.enabled, false);
  assert.match(gat.label, /base 3/);
});

test("unlocks: upgrading the base shows a banner for what it unlocks", () => {
  const s = prep(2);
  s.wave = 1;
  s.phase = "prep";
  assert.ok(upgradeBase(s, cfg).ok);
  assert.equal(s.stronghold.level + 1, 3);
  assert.ok(s.notices.some((n) => /Gatling/.test(n.text)), JSON.stringify(s.notices));
});

// --- Gatling ------------------------------------------------------------------

test("gatling: fire rate spins up while it has targets and winds down without", () => {
  const s = prep();
  const g = build(s, "gatling", 4, 7);
  assault(s);
  assert.equal(turretStats(cfg, g.turret!, "gatling").fireRate, cfg.gatling.minRate);
  add(s, g.x, g.y - 100, 1e9);
  hold(s, cfg.gatling.spinUpSeconds + 0.2);
  assert.equal(g.turret!.spin, 1);
  assert.equal(turretStats(cfg, g.turret!, "gatling").fireRate, cfg.gatling.maxRate);
  const shots = s.shotsFired;
  hold(s, 1);
  assert.ok(s.shotsFired - shots >= cfg.gatling.maxRate - 1, `fired ${s.shotsFired - shots} in a second at full spin`);
  s.enemies = [];
  hold(s, cfg.gatling.spinDownSeconds + 0.1);
  assert.equal(g.turret!.spin, 0);
});

test("gatling: barrels turn faster as it spins up (drawing state)", () => {
  const s = prep();
  const g = build(s, "gatling", 4, 7);
  assault(s);
  const b0 = g.turret!.barrel;
  hold(s, 0.5);
  const idle = Math.abs(g.turret!.barrel - b0);
  add(s, g.x, g.y - 100, 1e9);
  hold(s, 2);
  const b1 = g.turret!.barrel;
  hold(s, 0.1);
  let fast = g.turret!.barrel - b1;
  if (fast < 0) fast += Math.PI * 2;
  assert.ok(fast / 0.1 > idle / 0.5 * 5, `spinning ${fast / 0.1} vs idle ${idle / 0.5}`);
});

// --- Rockets ------------------------------------------------------------------

test("rockets: go for the toughest zombie in range and hit it, splashing those nearby", () => {
  const s = prep();
  const r = build(s, "rocket", 4, 4);
  assault(s);
  const weak = add(s, r.x - 120, r.y + 150, 1000);
  const tough = add(s, r.x + 100, r.y + 180, 5000, "brute");
  const near = add(s, tough.x + 30, tough.y, 1000);
  hold(s, 0.05);
  assert.equal(s.rockets.length, 1);
  assert.equal(s.rockets[0]!.targetId, tough.id);
  hold(s, 2);
  assert.ok(tough.hp < 5000, "direct hit");
  assert.ok(near.hp < 1000, "splash");
  assert.equal(weak.hp, 1000, "the weak one far away is untouched");
});

test("rockets: home onto a moving target", () => {
  const s = prep();
  const r = build(s, "rocket", 4, 4);
  assault(s);
  const e = add(s, r.x, r.y + 200, 5000, "brute");
  step(s, cfg, DT);
  assert.equal(s.rockets.length, 1);
  // Move the target sideways each step; the rocket still connects.
  for (let i = 0; i < 90 && e.hp === 5000; i++) {
    e.x += 2;
    step(s, cfg, DT);
  }
  assert.ok(e.hp < 5000);
});

// --- Traps ----------------------------------------------------------------------

test("traps: never block zombies and are never attacked", () => {
  const s = prep();
  const before = pathField(s, cfg).dist.slice();
  build(s, "mine", 4, 6);
  build(s, "tripwire", 4, 11);
  const after = pathField(s, cfg).dist;
  assert.deepEqual(Array.from(after), Array.from(before), "same routes with traps down");
});

test("mine: a zombie stepping close sets it off; everyone in the blast is hit; then it's spent", () => {
  const s = prep();
  const m = build(s, "mine", 4, 5);
  assault(s);
  const far = add(s, m.x + 200, m.y, 1000);
  hold(s, 0.2);
  assert.equal(m.destroyed, false, "nobody near: still armed");
  const a = add(s, m.x + 20, m.y, 1000);
  const b = add(s, m.x - 40, m.y + 20, 1000);
  hold(s, 0.1);
  assert.equal(m.destroyed, true, "spent");
  const dmg = cfg.mine.damage * trapDamageMultiplier(s, cfg);
  assert.equal(1000 - a.hp, dmg);
  assert.equal(1000 - b.hp, dmg);
  assert.equal(far.hp, 1000);
  hold(s, 0.5);
  assert.equal(1000 - a.hp, dmg, "goes off once");
});

test("trip wire: the first zombie across sets off a line of blasts along the wire", () => {
  const s = prep();
  const w = build(s, "tripwire", 4, 5);
  assault(s);
  const ux = Math.cos(w.facing);
  const uy = Math.sin(w.facing);
  // Zombies standing along the wire's line, just beyond the tile, get caught.
  const along = add(s, w.x + ux * (cfg.tripwire.length / 2 - 5), w.y + uy * (cfg.tripwire.length / 2 - 5), 1000);
  const away = add(s, w.x - uy * 150, w.y + ux * 150, 1000);
  hold(s, 0.1);
  assert.equal(w.destroyed, false, "nobody on the wire inside the tile yet");
  const crosser = add(s, w.x, w.y, 1000);
  hold(s, 0.1);
  assert.equal(w.destroyed, true);
  assert.ok(crosser.hp < 1000);
  assert.ok(along.hp < 1000, "blasts run along the wire");
  assert.equal(away.hp, 1000);
  // Each zombie is hit once even where blasts overlap.
  assert.equal(1000 - crosser.hp, cfg.tripwire.damage * trapDamageMultiplier(s, cfg));
});

test("traps: spent traps re-arm between waves at the rubble rate, or recycle", () => {
  const s = prep();
  const m = build(s, "mine", 4, 5);
  m.destroyed = true;
  const q = repairQuote(s, cfg, { kind: "structure", id: m.id });
  assert.ok(typeof q !== "string");
  assert.equal(q.cost, Math.ceil(cfg.mine.cost * cfg.repair.rubbleShare));
  assert.ok(repair(s, cfg, { kind: "structure", id: m.id }).ok);
  assert.equal(m.destroyed, false);
  const menu = panelModel(s, cfg, { col: 4, row: 5 });
  assert.match(menu.title, /armed/);
  m.destroyed = true;
  const spent = panelModel(s, cfg, { col: 4, row: 5 });
  assert.match(spent.buttons[0]!.label, /^Re-arm/);
});

test("traps: mines and trip wires share one limit that grows with the base", () => {
  const s = prep(2);
  const limit = buildLimit(s, cfg, "mine")!;
  assert.equal(limit, buildLimit(s, cfg, "tripwire"));
  const tiles = [[1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [1, 5], [2, 5], [3, 5], [4, 5]] as const;
  for (let i = 0; i < limit; i++) build(s, i % 2 ? "mine" : "tripwire", tiles[i]![0], tiles[i]![1]);
  assert.equal(countKind(s, "mine"), limit);
  assert.equal(checkBuild(s, cfg, tiles[limit]![0], tiles[limit]![1], "mine"), "limit-reached");
  assert.ok(upgradeBase(s, cfg).ok);
  assert.ok(buildLimit(s, cfg, "mine")! > limit);
});

test("traps: damage grows with the base level", () => {
  const s = prep();
  const m0 = trapDamageMultiplier(s, cfg);
  upgradeBase(s, cfg);
  assert.ok(trapDamageMultiplier(s, cfg) > m0);
});

test("gatling and rocket limits are one each when they unlock", () => {
  const s = prep(4);
  s.stronghold.level = 2; // base 3: Gatling unlocked
  build(s, "gatling", 2, 4);
  assert.equal(checkBuild(s, cfg, 4, 4, "gatling"), "limit-reached");
  s.stronghold.level = 3; // base 4: rockets unlocked, a second Gatling allowed
  assert.equal(checkBuild(s, cfg, 4, 4, "gatling"), null);
  build(s, "rocket", 3, 4);
  assert.equal(checkBuild(s, cfg, 4, 4, "rocket"), "limit-reached");
});

