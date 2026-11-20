import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig } from "../games/zvhm/config.js";
import { wavePreview } from "../games/zvhm/preview.js";
import { buildTurret, createState, damageEnemy, startWaveNow, step, type Enemy, type GameState } from "../games/zvhm/sim.js";
import { bossesFor, wavePlan } from "../games/zvhm/waves.js";

const cfg = baseConfig;
const DT = 1 / 30;
const B = cfg.enemies.boss;

function rollWave(wave: number, seed = 3): GameState {
  const s = createState(cfg, seed);
  s.wave = wave - 1;
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  s.enemies = [];
  step(s, cfg, DT);
  assert.equal(s.wave, wave);
  return s;
}

function live(): GameState {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  return s;
}

function go(s: GameState): void {
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  s.enemies = [];
}

function boss(s: GameState, x: number, y: number, hp = 1e6): Enemy {
  const e: Enemy = { id: s.nextEnemyId++, type: "boss", maxHp: hp, x, y, hp, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  return e;
}

test("boss: one joins every fifth wave, two from wave 20, three from wave 35", () => {
  for (let w = 1; w <= 40; w++) {
    const n = bossesFor(cfg, w);
    if (w % 5 !== 0) assert.equal(n, 0, `wave ${w}`);
    else assert.equal(n, w < 20 ? 1 : w < 35 ? 2 : 3, `wave ${w}`);
    assert.equal(wavePlan(cfg, w).bosses, n);
    assert.equal(wavePlan(cfg, w).mix.boss, 0, "bosses are extra, never part of the mix");
  }
});

test("boss: a boss wave's schedule holds its bosses, scaled like everyone else, partway in", () => {
  const s = rollWave(10);
  const p = wavePlan(cfg, 10);
  const bosses = s.spawns.filter((x) => x.type === "boss");
  assert.equal(bosses.length, 1);
  assert.equal(bosses[0]!.hp, Math.round(B.maxHp * p.hpMultiplier));
  assert.ok(Math.abs(bosses[0]!.at - p.spawnSeconds * cfg.waves.bossAt) < 1e-9);
  assert.equal(s.spawns.length, p.count + 1);
  assert.equal(rollWave(11).spawns.filter((x) => x.type === "boss").length, 0);
});

test("boss: it gets on the field even when the zombie cap is reached", () => {
  const s = rollWave(5);
  startWaveNow(s, cfg);
  const i = s.spawns.findIndex((x) => x.type === "boss");
  s.nextSpawn = i;
  s.waveTime = s.spawns[i]!.at - DT / 2;
  for (let k = 0; k < cfg.limits.maxEnemies; k++)
    s.enemies.push({ id: s.nextEnemyId++, type: "walker", maxHp: 1e9, x: 5, y: 5, hp: 1e9, attackCooldown: 1e9, attacking: false });
  step(s, cfg, DT);
  assert.ok(s.enemies.some((e) => e.type === "boss"));
});

test("boss: stomps everything built within reach, then waits out its cooldown", () => {
  const s = live();
  const a = buildTurret(s, cfg, 4, 4);
  const far = buildTurret(s, cfg, 8, 4);
  assert.ok(a.ok && far.ok);
  go(s);
  const e = boss(s, a.structure.x, a.structure.y - 60);
  const hp0 = a.structure.hp;
  const farHp = far.structure.hp;
  let t = 0;
  while (a.structure.hp === hp0 && t < 5) {
    step(s, cfg, DT);
    t += DT;
  }
  assert.ok(t <= B.stomp!.cooldown / 2 + 0.1, `first stomp after ${t.toFixed(2)}s`);
  assert.ok(hp0 - a.structure.hp >= B.stomp!.damage);
  assert.equal(far.structure.hp, farHp, "out of reach");
  assert.ok(s.blasts.some((b) => b.kind === "stomp"));
  e.x = a.structure.x; // hold it in place for the cooldown check
  const after = a.structure.hp;
  const stompCd = e.stompCd!;
  assert.ok(stompCd > B.stomp!.cooldown - 0.1);
  for (let i = 0; i < Math.floor((B.stomp!.cooldown - 0.3) * 30); i++) {
    e.attackCooldown = 1e9; // no clawing, only stomps
    step(s, cfg, DT);
  }
  assert.ok(after - a.structure.hp < B.stomp!.damage, "no second stomp before the cooldown");
});

test("boss: below half health it charges faster", () => {
  const dist = (hpFrac: number): number => {
    const s = live();
    go(s);
    const e = boss(s, 360, 40, 1000);
    e.hp = 1000 * hpFrac;
    for (let i = 0; i < 15; i++) step(s, cfg, DT);
    return Math.hypot(e.x - 360, e.y - 40);
  };
  const calm = dist(0.9);
  const mad = dist(0.3);
  assert.ok(Math.abs(mad / calm - B.enrage!.speedFactor) < 0.05, `${mad} vs ${calm}`);
});

test("boss: killing one pays big and says so", () => {
  const s = live();
  go(s);
  const e = boss(s, 300, 300, 10);
  const cash = s.currency;
  damageEnemy(s, cfg, e, 50);
  assert.ok(s.currency - cash >= B.drop.min);
  assert.equal(s.bossesKilled, 1);
  assert.ok(s.notices.some((n) => n.text.startsWith("Boss down")));
});

test("boss: the preview counts bosses and never calls them new", () => {
  const s = rollWave(15);
  const p = wavePreview(cfg, s.wave, s.spawns, []);
  assert.equal(p.bosses, 1);
  assert.ok(!p.newTypes.includes("boss"));
  assert.equal(wavePreview(cfg, 20, rollWave(20).spawns).bosses, 2);
});
