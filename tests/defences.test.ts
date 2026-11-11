import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, type EnemyType } from "../games/zid/config.js";
import { overlapsStronghold } from "../games/zid/grid.js";
import { nextTile, pathField } from "../games/zid/path.js";
import {
  buildBarricade,
  buildTurret,
  checkBuild,
  createState,
  damageStructure,
  recycleStructure,
  recycleValue,
  reinforceBarricade,
  repair,
  repairQuote,
  startWaveNow,
  step,
  structureAt,
  upgradeTurret,
  type GameState,
  type Structure,
} from "../games/zid/sim.js";

const cfg = baseConfig;
const DT = 1 / 30;

/** Prep state with plenty of supplies. */
function prep(currency = 10_000): GameState {
  const s = createState(cfg, 1);
  s.currency = currency;
  return s;
}

/** Turn a prep state into an assault with no natural spawns. */
function assault(s: GameState): void {
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
}

function addZombie(s: GameState, type: EnemyType, x: number, y: number, hp?: number): void {
  const st = cfg.enemies[type];
  const h = hp ?? st.maxHp;
  s.enemies.push({ id: s.nextEnemyId++, type, maxHp: h, x, y, hp: h, attackCooldown: 0, attacking: false });
}

function run(s: GameState, seconds: number): void {
  for (let i = 0; i < seconds * 30 && s.phase === "wave"; i++) step(s, cfg, DT);
}

/** Every tile touching the stronghold's tiles (8-way), i.e. a full ring. */
function ring(): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 9; c++) {
      if (overlapsStronghold(cfg, c, r)) continue;
      let touches = false;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (overlapsStronghold(cfg, c + dc, r + dr)) touches = true;
      if (touches) out.push([c, r]);
    }
  }
  return out;
}

const built = (r: ReturnType<typeof buildTurret>): Structure => {
  assert.ok(r.ok, JSON.stringify(r));
  return r.structure;
};

// --- Structure health -------------------------------------------------------

test("structures have their own health, separate from the stronghold", () => {
  const s = prep();
  const t = built(buildTurret(s, cfg, 2, 8));
  const b = built(buildBarricade(s, cfg, 4, 5));
  assert.equal(t.hp, cfg.turret.maxHp);
  assert.equal(b.hp, cfg.barricade.maxHp);
  damageStructure(s, t, 30);
  assert.equal(t.hp, cfg.turret.maxHp - 30);
  assert.equal(b.hp, cfg.barricade.maxHp);
  assert.equal(s.stronghold.hp, cfg.stronghold.maxHp);
});

test("a destroyed turret becomes rubble: keeps the tile, stops firing, stops blocking", () => {
  const s = prep();
  const t = built(buildTurret(s, cfg, 4, 5));
  assert.equal(damageStructure(s, t, 1e6), true);
  assert.equal(t.destroyed, true);
  assert.equal(t.hp, 0);
  assert.equal(structureAt(s, 4, 5), t, "rubble still occupies the tile");
  assert.equal(checkBuild(s, cfg, 4, 5), "occupied", "rubble can't be built over");
  assert.equal(pathField(s, cfg).blocker[5 * 9 + 4], null, "rubble is walkable");
  assert.equal(damageStructure(s, t, 10), false, "rubble can't be destroyed again");
  assault(s);
  addZombie(s, "walker", t.x + 100, t.y, 1e9);
  run(s, 2);
  assert.equal(s.shotsFired, 0, "rubble does not fire");
});

// --- Repairs ----------------------------------------------------------------

test("repair: restores in proportion, never above max, and costs a share of what was spent", () => {
  const s = prep(1000);
  const t = built(buildTurret(s, cfg, 2, 8));
  damageStructure(s, t, 60);
  const q = repairQuote(s, cfg, { kind: "structure", id: t.id });
  assert.ok(typeof q !== "string");
  assert.equal(q.hp, 60);
  assert.equal(q.cost, Math.ceil((60 * t.spent * cfg.repair.structureShare) / t.maxHp));
  const before = s.currency;
  assert.ok(repair(s, cfg, { kind: "structure", id: t.id }).ok);
  assert.equal(t.hp, t.maxHp);
  assert.equal(before - s.currency, q.cost);
  assert.deepEqual(repair(s, cfg, { kind: "structure", id: t.id }), { ok: false, reason: "nothing-to-repair" });
  assert.equal(before - s.currency, q.cost, "invalid repair deducts nothing");
});

test("repair: partial when supplies are short; refused when broke or mid-assault, with no deduction", () => {
  const s = prep(1000);
  const t = built(buildTurret(s, cfg, 2, 8));
  damageStructure(s, t, 100);
  s.currency = 5;
  assert.ok(repair(s, cfg, { kind: "structure", id: t.id }).ok);
  assert.ok(t.hp > cfg.turret.maxHp - 100 && t.hp < cfg.turret.maxHp, `partial repair to ${t.hp}`);
  assert.ok(s.currency >= 0);
  s.currency = 0;
  const hp = t.hp;
  assert.deepEqual(repair(s, cfg, { kind: "structure", id: t.id }), { ok: false, reason: "insufficient-funds" });
  assert.equal(t.hp, hp);
  s.currency = 1000;
  assault(s);
  assert.deepEqual(repair(s, cfg, { kind: "structure", id: t.id }), { ok: false, reason: "assault-active" });
  assert.deepEqual(repair(s, cfg, { kind: "stronghold" }), { ok: false, reason: "assault-active" });
  assert.equal(s.currency, 1000);
});

test("repair: the stronghold repairs up to its maximum at a per-health cost", () => {
  const s = prep(1000);
  s.stronghold.hp = 300;
  assert.ok(repair(s, cfg, { kind: "stronghold" }).ok);
  assert.equal(s.stronghold.hp, s.stronghold.maxHp);
  assert.equal(1000 - s.currency, Math.ceil(100 * cfg.repair.strongholdCostPerHp));
  assert.deepEqual(repair(s, cfg, { kind: "stronghold" }), { ok: false, reason: "nothing-to-repair" });
});

test("rubble: rebuilding restores the turret with its upgrades", () => {
  const s = prep();
  const t = built(buildTurret(s, cfg, 2, 8));
  upgradeTurret(s, cfg, t.id, "speed");
  upgradeTurret(s, cfg, t.id, "strength");
  damageStructure(s, t, 1e6);
  const before = s.currency;
  assert.ok(repair(s, cfg, { kind: "structure", id: t.id }).ok);
  assert.equal(t.destroyed, false);
  assert.equal(t.hp, t.maxHp);
  assert.equal(t.turret!.speed, 1);
  assert.equal(t.turret!.strength, 1);
  assert.equal(before - s.currency, Math.ceil(t.spent * cfg.repair.rubbleShare));
});

test("recycle: intact returns more than rubble; both free the tile", () => {
  const s = prep();
  const a = built(buildTurret(s, cfg, 2, 8));
  const b = built(buildTurret(s, cfg, 6, 8));
  damageStructure(s, b, 1e6);
  assert.ok(recycleValue(cfg, a) > recycleValue(cfg, b));
  let c = s.currency;
  assert.ok(recycleStructure(s, cfg, a.id).ok);
  assert.equal(s.currency - c, Math.floor(a.spent * cfg.recycle.intactShare));
  c = s.currency;
  assert.ok(recycleStructure(s, cfg, b.id).ok);
  assert.equal(s.currency - c, Math.floor(b.spent * cfg.recycle.rubbleShare));
  assert.equal(checkBuild(s, cfg, 2, 8), null);
  assert.equal(checkBuild(s, cfg, 6, 8), null);
});

// --- Barricades -------------------------------------------------------------

test("barricades: placed on buildable tiles only, cost deducted, occupied and assault rejected", () => {
  const s = prep(100);
  const b = built(buildBarricade(s, cfg, 3, 5));
  assert.equal(s.currency, 100 - cfg.barricade.cost);
  assert.equal(b.kind, "barricade");
  assert.equal(b.turret, null);
  assert.deepEqual(buildBarricade(s, cfg, 3, 5), { ok: false, reason: "occupied" });
  assert.deepEqual(buildTurret(s, cfg, 3, 5), { ok: false, reason: "occupied" });
  assert.deepEqual(buildBarricade(s, cfg, 0, 0), { ok: false, reason: "outside-perimeter" });
  assert.deepEqual(buildBarricade(s, cfg, 2, 5), { ok: false, reason: "invalid-terrain" });
  const c = s.currency;
  assault(s);
  assert.deepEqual(buildBarricade(s, cfg, 4, 5), { ok: false, reason: "assault-active" });
  assert.equal(s.currency, c);
});

test("barricades: reinforcement raises health, costs per level, has a max, and is barricade-only", () => {
  const s = prep();
  const b = built(buildBarricade(s, cfg, 3, 5));
  const t = built(buildTurret(s, cfg, 5, 5));
  for (let i = 0; i < cfg.barricade.reinforce.costs.length; i++) {
    const c = s.currency;
    const max = b.maxHp;
    assert.ok(reinforceBarricade(s, cfg, b.id).ok);
    assert.equal(c - s.currency, cfg.barricade.reinforce.costs[i]);
    assert.ok(b.maxHp > max);
    assert.equal(b.hp, b.maxHp);
  }
  assert.deepEqual(reinforceBarricade(s, cfg, b.id), { ok: false, reason: "max-level" });
  assert.deepEqual(reinforceBarricade(s, cfg, t.id), { ok: false, reason: "not-a-barricade" });
  assert.deepEqual(upgradeTurret(s, cfg, b.id, "speed"), { ok: false, reason: "not-a-turret" });
});

// --- Pathfinding ------------------------------------------------------------

test("pathing: with nothing built, zombies reach and attack the stronghold", () => {
  const s = prep();
  assault(s);
  addZombie(s, "walker", 360, 40);
  run(s, 30);
  assert.ok(s.damageTaken > 0);
});

for (const kind of ["barricade", "machine-gun"] as const) {
  test(`pathing: a ${kind} in the way is walked around when a route exists`, () => {
    const s = prep();
    // Directly between a zombie due north and the stronghold.
    const st = built(kind === "barricade" ? buildBarricade(s, cfg, 4, 6) : buildTurret(s, cfg, 4, 6));
    assault(s);
    addZombie(s, "brute", 360, 40, 1e9);
    run(s, 60);
    assert.equal(st.hp, st.maxHp, `${kind} was attacked`);
    assert.ok(s.damageTaken > 0, "the zombie still reached the stronghold");
  });
}

test("pathing: building reroutes zombies", () => {
  const s = prep();
  const f0 = pathField(s, cfg);
  const step0 = nextTile(cfg, f0, 4, 5)!;
  assert.deepEqual(step0, { col: 4, row: 6 }, "straight down when open");
  buildBarricade(s, cfg, 4, 6);
  const step1 = nextTile(cfg, pathField(s, cfg), 4, 5)!;
  assert.notDeepEqual(step1, { col: 4, row: 6 });
});

test("pathing: fully enclosed zombies break through a blocker, then the route recovers", () => {
  const s = prep();
  const walls = ring().map(([c, r]) => built(buildBarricade(s, cfg, c, r)));
  assert.equal(walls.length, 14);
  assault(s);
  addZombie(s, "brute", 360, 40, 1e9);
  run(s, 120);
  const broken = walls.filter((w) => w.destroyed);
  assert.ok(broken.length >= 1, "a barricade was broken");
  assert.ok(s.damageTaken > 0, "then the stronghold was reached through the gap");
  assert.ok(walls.filter((w) => w.hp < w.maxHp).length <= 2, "it attacks one blocker, not all of them");
});

test("pathing: recycling a blocker in prep reopens the route", () => {
  const s = prep();
  const walls = ring().map(([c, r]) => built(buildBarricade(s, cfg, c, r)));
  const v0 = s.layoutVersion;
  const field = pathField(s, cfg);
  assert.ok(field.dist[0]! > cfg.pathing.blockedTileCost, "enclosed: every route costs a breach");
  // A wall on a side, not a corner: corners only touch diagonally, and
  // zombies may not squeeze diagonally between two walls.
  const side = walls.find((w) => w.col === 4 && w.row === 6)!;
  recycleStructure(s, cfg, side.id);
  assert.ok(s.layoutVersion > v0);
  assert.ok(pathField(s, cfg).dist[0]! < cfg.pathing.blockedTileCost, "open again");
});

test("pathing: brutes break barricades much faster than walkers", () => {
  const timeToBreak = (type: EnemyType) => {
    const s = prep();
    const walls = ring().map(([c, r]) => built(buildBarricade(s, cfg, c, r)));
    assault(s);
    addZombie(s, type, 360, 40, 1e9);
    // Time from the first hit to the breach (walking time excluded).
    let t = 0;
    let started = false;
    for (let i = 0; i < 600 * 30 && !walls.some((w) => w.destroyed); i++) {
      step(s, cfg, DT);
      if (!started && walls.some((w) => w.hp < w.maxHp)) started = true;
      if (started) t++;
    }
    return t / 30;
  };
  const brute = timeToBreak("brute");
  const walker = timeToBreak("walker");
  assert.ok(brute * 2 < walker, `brute ${brute.toFixed(1)}s vs walker ${walker.toFixed(1)}s`);
});

test("pathing is deterministic with structures on the field", () => {
  const play = () => {
    const s = createState(cfg, 21);
    s.currency = 10_000;
    for (const [c, r] of ring().slice(0, 9)) buildBarricade(s, cfg, c, r);
    buildTurret(s, cfg, 1, 9);
    startWaveNow(s, cfg);
    for (let i = 0; i < 30 * 50; i++) step(s, cfg, DT);
    return JSON.stringify(s);
  };
  assert.equal(play(), play());
});

test("menus: rubble offers Rebuild and Recycle; the stronghold offers Repair; empty tiles offer both builds", async () => {
  const { panelModel } = await import("../games/zid/panel.js");
  const s = prep();
  const t = built(buildTurret(s, cfg, 2, 8));
  damageStructure(s, t, 1e6);
  const rubble = panelModel(s, cfg, { col: 2, row: 8 });
  assert.deepEqual(rubble.buttons.map((b) => b.action.kind), ["repair", "recycle", "close"]);
  assert.ok(rubble.buttons[0]!.label.startsWith("Rebuild"));
  s.stronghold.hp = 200;
  const sh = panelModel(s, cfg, { col: 4, row: 7 });
  assert.equal(sh.target.kind, "stronghold");
  assert.equal(sh.buttons[0]!.action.kind, "repair");
  assert.ok(sh.buttons[0]!.enabled);
  const empty = panelModel(s, cfg, { col: 4, row: 5 });
  assert.deepEqual(empty.buttons.map((b) => b.action.kind), ["build-turret", "build-mortar", "build-barricade", "close"]);
  assert.ok(empty.buttons.every((b) => b.enabled));
  s.currency = 0;
  const poor = panelModel(s, cfg, { col: 4, row: 5 });
  assert.equal(poor.buttons[0]!.enabled, false, "turret greyed out without supplies");
});
