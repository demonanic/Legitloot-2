import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, type GameConfig } from "../games/zid/config.js";
import {
  buildTurret,
  createState,
  damageEnemy,
  pickTarget,
  slotAt,
  startWaveNow,
  step,
  type Enemy,
  type GameState,
} from "../games/zid/sim.js";

const DT = 1 / 30;

function enemy(s: GameState, x: number, y: number, hp = baseConfig.walker.maxHp): Enemy {
  const e: Enemy = { id: s.nextEnemyId++, x, y, hp, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  return e;
}

function runToEnd(s: GameState, cfg: GameConfig, onStep?: (s: GameState) => void, maxSeconds = 600): void {
  for (let i = 0; i < maxSeconds * 30 && s.phase !== "lost"; i++) {
    onStep?.(s);
    step(s, cfg, DT);
  }
}

test("build: success deducts the cost exactly once", () => {
  const s = createState(baseConfig, 1);
  const before = s.currency;
  const res = buildTurret(s, baseConfig, "west");
  assert.deepEqual(res, { ok: true });
  assert.equal(s.currency, before - baseConfig.turret.cost);
  assert.ok(s.slots.find((sl) => sl.id === "west")?.turret);
});

test("build: insufficient funds is rejected and deducts nothing", () => {
  const s = createState(baseConfig, 1);
  s.currency = baseConfig.turret.cost - 1;
  const res = buildTurret(s, baseConfig, "east");
  assert.deepEqual(res, { ok: false, reason: "insufficient-funds" });
  assert.equal(s.currency, baseConfig.turret.cost - 1);
  assert.equal(s.slots.find((sl) => sl.id === "east")?.turret, null);
});

test("build: an occupied mount is rejected and deducts nothing", () => {
  const s = createState(baseConfig, 1);
  s.currency = 1000;
  buildTurret(s, baseConfig, "west");
  const after = s.currency;
  assert.deepEqual(buildTurret(s, baseConfig, "west"), { ok: false, reason: "occupied" });
  assert.equal(s.currency, after);
});

test("build: unknown mount and finished runs are rejected", () => {
  const s = createState(baseConfig, 1);
  assert.deepEqual(buildTurret(s, baseConfig, "north"), { ok: false, reason: "no-such-slot" });
  s.phase = "lost";
  const c = s.currency;
  assert.deepEqual(buildTurret(s, baseConfig, "west"), { ok: false, reason: "run-over" });
  assert.equal(s.currency, c);
});

test("slotAt finds a mount only within the tap radius", () => {
  const s = createState(baseConfig, 1);
  const west = s.slots.find((sl) => sl.id === "west")!;
  assert.equal(slotAt(s, west.x + 10, west.y, 40)?.id, "west");
  assert.equal(slotAt(s, west.x + 200, west.y + 200, 40), null);
});

test("damage: a kill awards the reward exactly once", () => {
  const s = createState(baseConfig, 1);
  const e = enemy(s, 0, 0);
  const c0 = s.currency;
  assert.equal(damageEnemy(s, baseConfig, e, baseConfig.walker.maxHp - 1), false);
  assert.equal(s.kills, 0);
  assert.equal(damageEnemy(s, baseConfig, e, 5), true);
  assert.equal(damageEnemy(s, baseConfig, e, 5), false, "a dead enemy cannot die twice");
  assert.equal(s.kills, 1);
  assert.equal(s.currency, c0 + baseConfig.walker.reward);
});

test("projectiles hit and damage the first enemy they touch", () => {
  const s = createState(baseConfig, 1);
  const e = enemy(s, 100, 100);
  s.projectiles.push({ x: 90, y: 100, vx: 300, vy: 0, damage: 4, life: 1 });
  s.phase = "wave";
  s.nextSpawn = s.spawns.length; // no natural spawns
  step(s, baseConfig, DT);
  assert.equal(e.hp, baseConfig.walker.maxHp - 4);
  assert.equal(s.projectiles.length, 0, "the projectile is consumed on hit");
});

test("targeting: picks the in-range enemy closest to the stronghold", () => {
  const s = createState(baseConfig, 1);
  const west = s.slots.find((sl) => sl.id === "west")!;
  const far = enemy(s, west.x - 250, west.y); // in range, further from stronghold
  const near = enemy(s, west.x - 120, west.y); // in range, closer to stronghold
  enemy(s, west.x - 900, west.y); // out of range
  assert.equal(pickTarget(s, baseConfig, west)?.id, near.id);
  near.hp = 0;
  assert.equal(pickTarget(s, baseConfig, west)?.id, far.id, "dead enemies are ignored");
});

test("targeting: nothing in range means no target", () => {
  const s = createState(baseConfig, 1);
  enemy(s, -2000, -2000);
  assert.equal(pickTarget(s, baseConfig, s.slots[0]!), null);
});

test("phases: the countdown runs prep -> warning -> wave", () => {
  const s = createState(baseConfig, 1);
  assert.equal(s.phase, "prep");
  for (let i = 0; i < baseConfig.wave.prepSeconds * 30 + 2; i++) step(s, baseConfig, DT);
  assert.equal(s.phase, "warning");
  for (let i = 0; i < baseConfig.wave.warningSeconds * 30 + 2; i++) step(s, baseConfig, DT);
  assert.equal(s.phase, "wave");

});

test("early launch skips the rest of prep and starts the assault immediately", () => {
  const s = createState(baseConfig, 1);
  for (let i = 0; i < 90; i++) step(s, baseConfig, DT); // 3 s into prep
  startWaveNow(s, baseConfig);
  assert.equal(s.phase, "wave");
  assert.equal(s.phaseTimer, 0);
  assert.equal(s.waveTime, 0);
  step(s, baseConfig, DT);
  assert.equal(s.phase, "wave", "no warning phase after an early launch");
  startWaveNow(s, baseConfig);
  assert.equal(s.phase, "wave", "early launch does nothing outside prep");
});

test("turret construction is refused during an assault and deducts nothing", () => {
  const s = createState(baseConfig, 1);
  startWaveNow(s, baseConfig);
  const c = s.currency;
  assert.deepEqual(buildTurret(s, baseConfig, "west"), { ok: false, reason: "assault-active" });
  assert.equal(s.currency, c);
  assert.equal(s.slots.find((sl) => sl.id === "west")?.turret, null);
});

test("turret construction is allowed in prep and during the warning", () => {
  const s = createState(baseConfig, 1);
  assert.deepEqual(buildTurret(s, baseConfig, "west"), { ok: true });
  for (let i = 0; i < baseConfig.wave.prepSeconds * 30 + 2; i++) step(s, baseConfig, DT);
  assert.equal(s.phase, "warning");
  s.currency = baseConfig.turret.cost;
  assert.deepEqual(buildTurret(s, baseConfig, "east"), { ok: true });
});

test("clearing a wave returns to preparation and the loop continues", () => {
  const s = createState(baseConfig, 4);
  buildTurret(s, baseConfig, "west");
  s.currency += baseConfig.turret.cost;
  buildTurret(s, baseConfig, "east");
  startWaveNow(s, baseConfig);
  let guard = 0;
  while (s.phase === "wave" && guard++ < 30 * 300) step(s, baseConfig, DT);
  assert.equal(s.phase, "prep", "a cleared wave goes back to prep");
  assert.equal(s.wave, 2);
  assert.equal(s.wavesCleared, 1);
  assert.equal(s.kills, baseConfig.wave.count);
  assert.equal(s.phaseTimer, baseConfig.wave.prepSeconds);
  assert.equal(s.spawns.length, baseConfig.wave.count, "the next wave is scheduled");
  assert.equal(s.nextSpawn, 0);
  const supplies = s.currency;
  assert.ok(supplies > 0, "supplies earned in wave 1 carry into wave 2's prep");
  // The countdown then launches wave 2 automatically.
  for (let i = 0; i < (baseConfig.wave.prepSeconds + baseConfig.wave.warningSeconds) * 30 + 4; i++) step(s, baseConfig, DT);
  assert.equal(s.phase, "wave");
  assert.equal(s.wave, 2);
});

test("determinism: same seed and commands give identical state", () => {
  const play = () => {
    const s = createState(baseConfig, 42);
    buildTurret(s, baseConfig, "west");
    startWaveNow(s, baseConfig);
    for (let i = 0; i < 30 * 40; i++) {
      if (i === 300) buildTurret(s, baseConfig, "east");
      step(s, baseConfig, DT);
    }
    return JSON.stringify(s);
  };
  assert.equal(play(), play());
  const other = createState(baseConfig, 43);
  assert.notEqual(JSON.stringify(createState(baseConfig, 42).spawns), JSON.stringify(other.spawns));
});

test("spawns come from all four edges", () => {
  const s = createState(baseConfig, 7);
  const { width: w, height: h } = baseConfig.world;
  const edges = new Set(
    s.spawns.map((p) => (p.y < 0 ? "north" : p.y > h ? "south" : p.x < 0 ? "west" : p.x > w ? "east" : "inside")),
  );
  assert.ok(!edges.has("inside"));
  assert.equal(edges.size, 4);
});

test("balance: with no turrets the stronghold falls", () => {
  const s = createState(baseConfig, 3);
  runToEnd(s, baseConfig);
  assert.equal(s.phase, "lost");
});

test("balance: both mounts built before the assault clear wave 1 on 20 seeds", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = createState(baseConfig, seed);
    buildTurret(s, baseConfig, "west");
    s.currency += baseConfig.turret.cost; // second mount, as if earned
    buildTurret(s, baseConfig, "east");
    for (let i = 0; i < 30 * 300 && s.wavesCleared === 0 && s.phase !== "lost"; i++) step(s, baseConfig, DT);
    assert.equal(s.wavesCleared, 1, `seed ${seed} should clear wave 1`);
    assert.equal(s.kills, baseConfig.wave.count);
  }
});

test("balance: a single turret is not enough (the second mount matters)", () => {
  let lost = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const s = createState(baseConfig, seed);
    buildTurret(s, baseConfig, "west");
    for (let i = 0; i < 30 * 300 && s.wavesCleared === 0 && s.phase !== "lost"; i++) step(s, baseConfig, DT);
    if (s.phase === "lost") lost++;
  }
  assert.ok(lost >= 8, `one turret lost only ${lost}/10`);
});

test("balance: starting supplies cover both mounts, and that clears wave 1 on 20 seeds", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = createState(baseConfig, seed);
    assert.deepEqual(buildTurret(s, baseConfig, "west"), { ok: true });
    assert.deepEqual(buildTurret(s, baseConfig, "east"), { ok: true }, "second mount affordable before wave 1");
    for (let i = 0; i < 30 * 300 && s.wavesCleared === 0 && s.phase !== "lost"; i++) step(s, baseConfig, DT);
    assert.equal(s.wavesCleared, 1, `seed ${seed} should clear wave 1`);
  }
});

test("a finished run stays finished", () => {
  const s = createState(baseConfig, 3);
  runToEnd(s, baseConfig);
  const phase = s.phase;
  for (let i = 0; i < 100; i++) step(s, baseConfig, DT);
  assert.equal(s.phase, phase);
});
