import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig } from "../games/zid/config.js";
import { panelModel } from "../games/zid/panel.js";
import { wavePlan } from "../games/zid/waves.js";
import {
  activateBoost,
  barrelCount,
  buildStructure,
  checkBuild,
  createState,
  planAirstrike,
  startWaveNow,
  step,
  upgradeTurret,
  type Enemy,
  type GameState,
} from "../games/zid/sim.js";

const cfg = { ...baseConfig, pickups: { ...baseConfig.pickups, everyMax: 0 } };
const DT = 1 / 30;

function assault(baseLevel = 5): GameState {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  s.stronghold.level = baseLevel - 1;
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  return s;
}
function zombie(s: GameState, x: number, y: number, hp = 1e9, type: Enemy["type"] = "walker"): Enemy {
  const e: Enemy = { id: s.nextEnemyId++, type, maxHp: hp, x, y, hp, attackCooldown: 1e9, attacking: false };
  s.enemies.push(e);
  return e;
}
/** Step while pinning every zombie where it stands. */
function run(s: GameState, seconds: number): void {
  for (let i = 0; i < seconds * 30; i++) {
    const pos = s.enemies.map((e) => [e.x, e.y] as const);
    step(s, cfg, DT);
    s.enemies.forEach((e, k) => {
      if (pos[k]) [e.x, e.y] = pos[k]!;
    });
  }
}

// --- Airstrike -----------------------------------------------------------------

test("airstrike: locked until its base level, then spends the meter", () => {
  const s = assault(1);
  zombie(s, 100, 100);
  s.charge = 1;
  assert.deepEqual(activateBoost(s, cfg, "airstrike"), { ok: false, reason: "locked" });
  assert.equal(s.charge, 1, "a refused boost keeps the charge");
  s.stronghold.level = cfg.boost.airstrike.unlockBase - 1;
  assert.deepEqual(activateBoost(s, cfg, "airstrike"), { ok: true });
  assert.equal(s.charge, 0);
});

test("airstrike: drop zones run in a straight line through the thickest crowd and never touch the stronghold", () => {
  const s = assault();
  for (let i = 0; i < 8; i++) zombie(s, 200 + i * 6, 300);
  for (let i = 0; i < 4; i++) zombie(s, 560 + i * 6, 420);
  zombie(s, 100, 1100);
  const zones = planAirstrike(s, cfg);
  assert.ok(zones.length >= 5, `${zones.length} zones`);
  const a = cfg.boost.airstrike;
  assert.ok(zones.some((z) => Math.hypot(z.x - 200, z.y - 300) <= a.radius), "covers the big crowd");
  assert.ok(zones.some((z) => Math.hypot(z.x - 560, z.y - 420) <= a.radius), "and heads over the second one");
  // Collinear.
  const [p, q] = [zones[0]!, zones[zones.length - 1]!];
  for (const z of zones) {
    const cross = (q.x - p.x) * (z.y - p.y) - (q.y - p.y) * (z.x - p.x);
    assert.ok(Math.abs(cross) < 1e-6 * (1 + Math.hypot(q.x - p.x, q.y - p.y)) * 1000);
  }
  const sh = s.stronghold;
  for (const z of zones) assert.ok(Math.hypot(z.x - sh.x, z.y - sh.y) >= sh.halfSize * Math.SQRT2, "off the house");
});

test("airstrike: a crowd at the stronghold's walls gets no bomb on the house", () => {
  const s = assault();
  const sh = s.stronghold;
  for (let i = 0; i < 10; i++) zombie(s, sh.x + (i - 5) * 5, sh.y - sh.halfSize - 10);
  const zones = planAirstrike(s, cfg);
  for (const z of zones) assert.ok(Math.hypot(z.x - sh.x, z.y - sh.y) >= sh.halfSize * Math.SQRT2);
});

test("airstrike: crosshairs first, then bombs land in sequence, hurting zombies only", () => {
  const s = assault();
  const built = buildStructure(s, cfg, "barricade", 2, 4);
  s.phase = "wave";
  const crowd = [zombie(s, 200, 300), zombie(s, 215, 310), zombie(s, 190, 290)];
  const far = zombie(s, 650, 1200);
  s.charge = 1;
  const hp0 = s.stronghold.hp;
  assert.ok(activateBoost(s, cfg, "airstrike").ok);
  const n = s.bombs.length;
  assert.ok(n >= 4);
  run(s, cfg.boost.airstrike.warnSeconds - 0.2);
  assert.equal(s.bombs.length, n, "still only crosshairs");
  assert.ok(crowd.every((e) => e.hp === 1e9));
  run(s, 0.4);
  assert.ok(s.bombs.length < n, "bombs have started landing");
  run(s, 3);
  assert.equal(s.bombs.length, 0);
  const expected = cfg.enemies.walker.maxHp * wavePlan(cfg, s.wave).hpMultiplier * cfg.boost.airstrike.damageWalkers;
  for (const e of crowd) assert.ok(1e9 - e.hp >= expected - 1e-6, `crowd took ${1e9 - e.hp}`);
  assert.equal(far.hp, 1e9, "a zombie well off the line is untouched");
  assert.equal(s.stronghold.hp, hp0);
  if (built.ok) assert.equal(built.structure.hp, built.structure.maxHp);
  assert.equal(s.boost, null, "the meter is free again afterwards");
});

test("airstrike: kills an ordinary crowd outright on the current wave", () => {
  const s = assault();
  s.wave = 9;
  const hp = cfg.enemies.walker.maxHp * wavePlan(cfg, 9).hpMultiplier;
  for (let i = 0; i < 6; i++) zombie(s, 200 + i * 8, 300, hp);
  zombie(s, 700, 1250); // keeps the wave alive
  const kills = s.kills;
  s.charge = 1;
  activateBoost(s, cfg, "airstrike");
  run(s, 4);
  assert.equal(s.kills - kills, 6);
});

// --- Force field -----------------------------------------------------------------

test("force field: the stronghold takes no damage and heals while it runs, then is vulnerable again", () => {
  const s = assault();
  const sh = s.stronghold;
  sh.hp = 100;
  for (let i = 0; i < 6; i++) {
    const e = zombie(s, sh.x - 30 + i * 12, sh.y - sh.halfSize - 5, 1e9, "brute");
    e.attackCooldown = 0;
  }
  s.charge = 1;
  assert.deepEqual(activateBoost({ ...s, stronghold: { ...sh, level: 0 } } as GameState, cfg, "shield"), { ok: false, reason: "locked" });
  assert.ok(activateBoost(s, cfg, "shield").ok);
  const taken = s.damageTaken;
  run(s, cfg.boost.shield.seconds - 0.2);
  assert.equal(s.damageTaken, taken, "no damage through the field");
  const healed = sh.hp - 100;
  const want = sh.maxHp * cfg.boost.shield.regenPerSecond * (cfg.boost.shield.seconds - 0.2);
  assert.ok(Math.abs(healed - want) < 3, `healed ${healed}, expected about ${want}`);
  run(s, 2.5);
  assert.equal(s.boost, null);
  assert.ok(s.damageTaken > taken, "hits land again once it drops");
});

test("force field: never heals past the maximum", () => {
  const s = assault();
  zombie(s, 5, 5);
  s.stronghold.hp = s.stronghold.maxHp - 2;
  s.charge = 1;
  activateBoost(s, cfg, "shield");
  run(s, 3);
  assert.equal(s.stronghold.hp, s.stronghold.maxHp);
});

// --- Shotgun -------------------------------------------------------------------

test("shotgun: unlocks at its base level and has its own limit", () => {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  assert.equal(checkBuild(s, cfg, 2, 4, "shotgun"), "locked");
  s.stronghold.level = cfg.unlocks.shotgun - 1;
  const lvl = cfg.stronghold.levels[s.stronghold.level]!;
  const tiles: [number, number][] = [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5]];
  for (let i = 0; i < lvl.shotguns; i++) assert.ok(buildStructure(s, cfg, "shotgun", ...tiles[i]!).ok);
  assert.equal(checkBuild(s, cfg, ...tiles[lvl.shotguns]!, "shotgun"), "limit-reached");
});

test("shotgun: each shot is a fan of pellets that can hit several zombies, and fades past its reach", () => {
  const s = assault();
  s.phase = "prep";
  const r = buildStructure(s, cfg, "shotgun", 4, 5);
  assert.ok(r.ok);
  s.phase = "wave";
  const g = r.structure;
  const near = [zombie(s, g.x - 25, g.y - 90), zombie(s, g.x, g.y - 95), zombie(s, g.x + 25, g.y - 90)];
  const beyond = zombie(s, g.x, g.y - cfg.shotgun.range * 1.6);
  step(s, cfg, DT);
  assert.equal(s.projectiles.length, cfg.shotgun.pellets);
  run(s, 3);
  assert.ok(near.filter((e) => e.hp < 1e9).length >= 2, "the fan catches more than one");
  assert.equal(beyond.hp, 1e9, "pellets fade before reaching far targets");
  assert.equal(barrelCount(g), 2);
  s.phase = "prep";
  upgradeTurret(s, cfg, g.id, "speed");
  assert.equal(barrelCount(g), 3);
});

// --- Flamethrower -----------------------------------------------------------------

test("flamethrower: burns everything in its cone at once, and nothing behind it or out of reach", () => {
  const s = assault();
  s.phase = "prep";
  const r = buildStructure(s, cfg, "flamer", 4, 5);
  assert.ok(r.ok);
  s.phase = "wave";
  const f = r.structure;
  const inCone = [zombie(s, f.x, f.y - 70), zombie(s, f.x + 15, f.y - 85), zombie(s, f.x - 15, f.y - 60)];
  const behind = zombie(s, f.x, f.y + cfg.flamer.range + 60);
  run(s, 2);
  for (const e of inCone) assert.ok(e.hp < 1e9, "burned");
  assert.equal(behind.hp, 1e9);
  const d = inCone.map((e) => 1e9 - e.hp);
  assert.ok(Math.max(...d) / Math.min(...d) < 1.6, `all take similar damage: ${d.map(Math.round)}`);
});

test("flamethrower: zombies stay alight and keep taking damage after leaving the flame, then it goes out", () => {
  const s = assault();
  s.phase = "prep";
  const r = buildStructure(s, cfg, "flamer", 4, 5);
  assert.ok(r.ok);
  s.phase = "wave";
  const f = r.structure;
  const e = zombie(s, f.x, f.y - 70);
  run(s, 1);
  assert.ok((e.burn ?? 0) > 0);
  // Carry it far away: the flamer can't reach, but the fire keeps burning.
  e.x = 40;
  e.y = 1240;
  const hp = e.hp;
  run(s, 1);
  assert.ok(e.hp < hp, "still burning");
  run(s, cfg.flamer.burnSeconds + 0.5);
  const after = e.hp;
  run(s, 1);
  assert.equal(e.hp, after, "the fire has gone out");
});

test("burning kills pay out once, like any other kill", () => {
  const s = assault();
  zombie(s, 5, 5);
  const e = zombie(s, 300, 300, 1, "brute");
  e.burn = 2;
  e.burnDps = 10;
  const kills = s.kills;
  run(s, 1);
  assert.equal(s.kills - kills, 1);
});

// --- Menus -----------------------------------------------------------------------

test("menu: a third build page offers Shotgun and Flamethrower; pages cycle", () => {
  const s = createState(cfg, 1);
  const w = panelModel(s, cfg, { col: 2, row: 4 }, "weapons");
  assert.deepEqual(w.buttons[4]!.action, { kind: "page", page: "close" });
  const c = panelModel(s, cfg, { col: 2, row: 4 }, "close");
  assert.deepEqual(
    c.buttons.map((b) => (b.action.kind === "build" ? b.action.structure : b.action.kind)),
    ["shotgun", "flamer", "page", "close"],
  );
  assert.match(c.buttons[0]!.label, /base 2/);
  assert.deepEqual(c.buttons[2]!.action, { kind: "page", page: "traps" });
});
