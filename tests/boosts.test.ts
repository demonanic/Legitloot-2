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
    ["shotgun", "flamer", "tesla", "railgun", "page", "close"],
  );
  assert.match(c.buttons[0]!.label, /base 2/);
  assert.deepEqual(c.buttons[4]!.action, { kind: "page", page: "traps" });
});

// --- Tesla coil ------------------------------------------------------------------

import { teslaChain, turretStats } from "../games/zid/sim.js";

function coil(s: GameState) {
  s.phase = "prep";
  const r = buildStructure(s, cfg, "tesla", 4, 5);
  assert.ok(r.ok, JSON.stringify(r));
  s.phase = "wave";
  return r.structure;
}

test("tesla: unlocks at base level 5 with its own limit", () => {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  assert.equal(cfg.unlocks.tesla, 5);
  s.stronghold.level = 3;
  assert.equal(checkBuild(s, cfg, 4, 5, "tesla"), "locked");
  s.stronghold.level = 4;
  assert.ok(buildStructure(s, cfg, "tesla", 4, 5).ok);
  assert.equal(checkBuild(s, cfg, 5, 5, "tesla"), "limit-reached");
  s.stronghold.level = 5;
  assert.equal(checkBuild(s, cfg, 5, 5, "tesla"), null);
});

test("tesla: the bolt jumps along zombies that are close enough, nearest first, and stops at a gap", () => {
  const s = assault();
  const c = coil(s);
  const gap = cfg.tesla.arcRadius - 20;
  const a = zombie(s, c.x, c.y - 100);
  const b = zombie(s, c.x + gap, c.y - 100);
  const d = zombie(s, c.x + gap * 2, c.y - 100);
  const far = zombie(s, c.x + gap * 2 + cfg.tesla.arcRadius + 40, c.y - 100); // too far to jump to
  const lone = zombie(s, c.x - 400, c.y + 500);
  assert.deepEqual(teslaChain(s, cfg, c).map((e) => e.enemy.id), [a.id, b.id, d.id]);
  step(s, cfg, DT);
  const dmg = turretStats(cfg, c.turret!, "tesla").damage;
  const f = cfg.tesla.falloff;
  assert.ok(Math.abs(1e9 - a.hp - dmg) < 1e-6, "full damage to the first");
  assert.ok(Math.abs(1e9 - b.hp - dmg * f) < 1e-6, "less to the second");
  assert.ok(Math.abs(1e9 - d.hp - dmg * f * f) < 1e-6, "less again to the third");
  assert.equal(far.hp, 1e9);
  assert.equal(lone.hp, 1e9);
  assert.equal(s.arcs.length, 1);
  assert.equal(s.arcs[0]!.segments.length, 3, "one piece of lightning per zombie struck");
});

test("tesla: one zombie is never struck twice by the same zap, and the chain has a maximum length", () => {
  const s = assault();
  const c = coil(s);
  // A tight clump of ten: plenty to jump to.
  const clump = Array.from({ length: 10 }, (_, i) => zombie(s, c.x + (i % 5) * 14, c.y - 90 - Math.floor(i / 5) * 14));
  const chain = teslaChain(s, cfg, c);
  assert.equal(chain.length, cfg.tesla.jumps + 1);
  assert.equal(new Set(chain.map((e) => e.enemy.id)).size, chain.length);
  step(s, cfg, DT);
  assert.equal(clump.filter((e) => e.hp < 1e9).length, cfg.tesla.jumps + 1);
});

test("tesla: nothing in range means no zap; a zombie out of range can still be reached by a jump", () => {
  const s = assault();
  const c = coil(s);
  const out = zombie(s, c.x, c.y - cfg.tesla.range - 60);
  run(s, 1);
  assert.equal(out.hp, 1e9);
  assert.equal(s.arcs.length, 0);
  const inside = zombie(s, c.x, c.y - cfg.tesla.range + 10);
  assert.ok(Math.hypot(out.x - inside.x, out.y - inside.y) <= cfg.tesla.arcRadius);
  run(s, 1);
  assert.ok(inside.hp < 1e9);
  assert.ok(out.hp < 1e9, "the bolt carried on to it");
});

test("tesla: kills along the chain each pay once; Speed and Damage upgrades apply", () => {
  const s = assault();
  const c = coil(s);
  for (let i = 0; i < 3; i++) zombie(s, c.x + i * 30, c.y - 100, 1);
  zombie(s, 700, 1270).attackCooldown = 1e9;
  const kills = s.kills;
  step(s, cfg, DT);
  assert.equal(s.kills - kills, 3);
  const base = turretStats(cfg, c.turret!, "tesla");
  s.phase = "prep";
  assert.ok(upgradeTurret(s, cfg, c.id, "speed").ok);
  assert.ok(upgradeTurret(s, cfg, c.id, "strength").ok);
  assert.deepEqual(upgradeTurret(s, cfg, c.id, "range"), { ok: false, reason: "not-for-mortar" });
  const up = turretStats(cfg, c.turret!, "tesla");
  assert.ok(up.fireRate > base.fireRate && up.damage > base.damage);
});

test("menu: the Tesla coil is on the close-range page, marked with the base level it needs", () => {
  const s = createState(cfg, 1);
  const page = panelModel(s, cfg, { col: 2, row: 4 }, "close");
  const b = page.buttons.find((x) => x.action.kind === "build" && x.action.structure === "tesla")!;
  assert.equal(b.enabled, false);
  assert.match(b.label, /base 5/);
});

test("tesla: when the bolt runs out of zombies ahead, it forks back to one near an earlier strike", () => {
  const s = assault();
  const c = coil(s);
  const r = cfg.tesla.arcRadius;
  // Nearest to the coil is the middle one; one sits to its right, one to its left, each in reach of the middle only.
  const mid = zombie(s, c.x, c.y - 100);
  const right = zombie(s, c.x + r - 15, c.y - 110);
  const left = zombie(s, c.x - r + 5, c.y - 112);
  assert.ok(Math.hypot(left.x - right.x, left.y - right.y) > r, "left is out of reach of right");
  const chain = teslaChain(s, cfg, c);
  assert.deepEqual(chain.map((x) => x.enemy.id), [mid.id, right.id, left.id]);
  assert.deepEqual(chain.map((x) => x.from), [-1, 0, 0], "both branches leave the middle zombie");
  step(s, cfg, DT);
  assert.ok(left.hp < 1e9);
});

// --- Railgun ---------------------------------------------------------------------

import { railgunAim, railgunHits } from "../games/zid/sim.js";

function railgun(s: GameState) {
  s.phase = "prep";
  s.stronghold.level = 5; // base level 6
  const r = buildStructure(s, cfg, "railgun", 4, 7);
  assert.ok(r.ok, JSON.stringify(r));
  s.phase = "wave";
  return r.structure;
}

test("railgun: unlocks at base level 6 with a limit of one", () => {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  assert.equal(cfg.unlocks.railgun, 6);
  s.stronghold.level = 4;
  assert.equal(checkBuild(s, cfg, 4, 7, "railgun"), "locked");
  s.stronghold.level = 5;
  assert.ok(buildStructure(s, cfg, "railgun", 4, 7).ok);
  assert.equal(checkBuild(s, cfg, 5, 7, "railgun"), "limit-reached");
});

test("railgun: the beam passes through every zombie on the line, each taking full damage, and nothing off it", () => {
  const s = assault();
  const g = railgun(s);
  const line = [zombie(s, g.x, g.y - 80), zombie(s, g.x + 4, g.y - 200), zombie(s, g.x - 3, g.y - 380)];
  const off = zombie(s, g.x + 90, g.y - 200);
  const beyond = zombie(s, g.x, g.y - cfg.railgun.range - 80);
  step(s, cfg, DT);
  const dmg = turretStats(cfg, g.turret!, "railgun").damage;
  for (const e of line) assert.ok(Math.abs(1e9 - e.hp - dmg) < 1e-6, "full damage to each");
  assert.equal(off.hp, 1e9);
  assert.equal(beyond.hp, 1e9);
  assert.equal(s.beams.length, 1);
});

test("railgun: it picks the line through the most zombies, not the nearest one", () => {
  const s = assault();
  const g = railgun(s);
  const lone = zombie(s, g.x - 90, g.y - 40); // nearest, but alone
  const row = [zombie(s, g.x + 100, g.y - 100), zombie(s, g.x + 200, g.y - 200), zombie(s, g.x + 300, g.y - 300)];
  const aim = railgunAim(s, cfg, g)!;
  assert.equal(railgunHits(s, cfg, g, aim).length, 3);
  step(s, cfg, DT);
  assert.equal(lone.hp, 1e9);
  assert.ok(row.every((e) => e.hp < 1e9));
});

test("railgun: slow to fire; kills along the beam each pay once; Speed and Damage apply, Range doesn't", () => {
  const s = assault();
  const g = railgun(s);
  zombie(s, g.x, g.y - 300); // a target that survives, to keep it firing
  run(s, 1 / cfg.railgun.fireRate - 0.2);
  assert.equal(g.turret!.shots, 1, "one shot in its first charge cycle");
  const t = assault();
  const h = railgun(t);
  for (let i = 0; i < 4; i++) zombie(t, h.x, h.y - 60 - i * 40, 1);
  zombie(t, 700, 1270).attackCooldown = 1e9;
  const kills = t.kills;
  step(t, cfg, DT);
  assert.equal(t.kills - kills, 4);
  t.phase = "prep";
  const base = turretStats(cfg, h.turret!, "railgun");
  assert.ok(upgradeTurret(t, cfg, h.id, "speed").ok);
  assert.ok(upgradeTurret(t, cfg, h.id, "strength").ok);
  assert.deepEqual(upgradeTurret(t, cfg, h.id, "range"), { ok: false, reason: "not-for-mortar" });
  const up = turretStats(cfg, h.turret!, "railgun");
  assert.ok(up.fireRate > base.fireRate && up.damage > base.damage);
});
