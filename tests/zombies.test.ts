import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, type EnemyType } from "../games/zvhm/config.js";
import { buildTurret, createState, damageEnemy, startWaveNow, step, type Enemy, type GameState } from "../games/zvhm/sim.js";
import { wavePlan } from "../games/zvhm/waves.js";

const cfg = baseConfig;
const DT = 1 / 30;

/** A wave in progress with nothing left to spawn, so only the zombies a test adds are on the field. */
function field(): GameState {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  return s;
}

function go(s: GameState): void {
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  s.enemies = [];
}

function zombie(s: GameState, type: EnemyType, x: number, y: number, hp = 1e6): Enemy {
  const e: Enemy = { id: s.nextEnemyId++, type, maxHp: hp, x, y, hp, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  return e;
}

test("armored: bullets do only a fraction of their damage", () => {
  const s = field();
  go(s);
  const a = zombie(s, "armored", 360, 200);
  const w = zombie(s, "walker", 200, 200);
  s.projectiles.push({ x: a.x, y: a.y, vx: 0, vy: 0, damage: 20, life: 1 });
  s.projectiles.push({ x: w.x, y: w.y, vx: 0, vy: 0, damage: 20, life: 1 });
  step(s, cfg, DT);
  assert.equal(1e6 - w.hp, 20);
  assert.equal(1e6 - a.hp, 20 * cfg.enemies.armored.bulletFactor!);
});

test("armored: fire and blasts hit it in full", () => {
  const s = field();
  go(s);
  const a = zombie(s, "armored", 360, 200);
  damageEnemy(s, cfg, a, 50);
  assert.equal(1e6 - a.hp, 50);
});

test("spitter: stops in range of a weapon and wears it down with acid", () => {
  const s = field();
  const t = buildTurret(s, cfg, 4, 4);
  assert.ok(t.ok);
  go(s);
  const st = t.structure;
  const sp = cfg.enemies.spitter.spit!;
  const z = zombie(s, "spitter", st.x, st.y - sp.range + 20);
  // Keep the gun from killing it so the acid can be measured.
  const startY = z.y;
  const hp0 = st.hp;
  for (let i = 0; i < 30 * 5; i++) step(s, cfg, DT);
  assert.equal(z.y, startY, "it stands still while spitting");
  assert.ok(z.attacking);
  const hits = Math.round((hp0 - st.hp) / sp.damage);
  assert.ok(hits >= 2 && hits <= 3, `about one glob every ${sp.cooldown}s, got ${hits}`);
});

test("spitter: with nothing in range it keeps walking", () => {
  const s = field();
  go(s);
  const z = zombie(s, "spitter", 360, 40);
  for (let i = 0; i < 30; i++) step(s, cfg, DT);
  assert.ok(z.y > 40, "moved toward the base");
  assert.equal(s.spits.length, 0);
});

test("spitter: acid in flight is cleared when the wave ends", () => {
  const s = field();
  go(s);
  s.spits.push({ sx: 0, sy: 0, tx: 100, ty: 100, total: 5, left: 5, damage: 1, target: 999 });
  step(s, cfg, DT);
  assert.equal(s.phase, "prep");
  assert.equal(s.spits.length, 0);
});

test("boomer: explodes on reaching a weapon, hurting what is near and dropping nothing", () => {
  const s = field();
  const t = buildTurret(s, cfg, 4, 4);
  assert.ok(t.ok);
  go(s);
  const st = t.structure;
  const b = zombie(s, "boomer", st.x, st.y - 30);
  const hp0 = st.hp;
  const kills0 = s.kills;
  const cash0 = s.currency;
  step(s, cfg, DT);
  assert.equal(b.hp, 0);
  assert.equal(hp0 - st.hp, cfg.enemies.boomer.blast!.damage);
  assert.equal(s.kills, kills0, "a boomer that reaches you is not a kill");
  assert.equal(s.currency, cash0);
  assert.ok(s.blasts.some((x) => x.kind === "acid"));
});

test("boomer: shot dead, it bursts and hurts only the zombies around it", () => {
  const s = field();
  const t = buildTurret(s, cfg, 4, 4);
  assert.ok(t.ok);
  go(s);
  const b = zombie(s, "boomer", 200, 200, 1);
  const near = zombie(s, "walker", 230, 200);
  const far = zombie(s, "walker", 400, 200);
  const hp0 = t.structure.hp;
  assert.ok(damageEnemy(s, cfg, b, 5) !== undefined);
  const expected = cfg.enemies.walker.maxHp * wavePlan(cfg, s.wave).hpMultiplier * cfg.enemies.boomer.blast!.zombieShare;
  assert.ok(Math.abs(1e6 - near.hp - expected) < 1e-6);
  assert.equal(far.hp, 1e6);
  assert.equal(t.structure.hp, hp0);
});

test("boomer: bursts chain through other boomers", () => {
  const s = field();
  go(s);
  const a = zombie(s, "boomer", 200, 200, 1);
  const b = zombie(s, "boomer", 250, 200, 1);
  const w = zombie(s, "walker", 300, 200);
  damageEnemy(s, cfg, a, 5);
  assert.equal(b.hp, 0);
  assert.ok(w.hp < 1e6, "the second burst reached the walker");
});

test("screamer: zombies near it move faster", () => {
  const run = (withScreamer: boolean): number => {
    const s = field();
    go(s);
    const w = zombie(s, "walker", 360, 40);
    if (withScreamer) zombie(s, "screamer", 330, 40);
    for (let i = 0; i < 15; i++) step(s, cfg, DT);
    return Math.hypot(w.x - 360, w.y - 40);
  };
  const plain = run(false);
  const fast = run(true);
  assert.ok(Math.abs(fast / plain - (1 + cfg.enemies.screamer.aura!.speedBoost)) < 0.05, `${fast} vs ${plain}`);
});

test("new zombies: each type has a distinct counter-worthy trait", () => {
  assert.ok(cfg.enemies.armored.bulletFactor! < 1);
  assert.ok(cfg.enemies.spitter.spit!.range > cfg.enemies.walker.radius * 4);
  assert.ok(cfg.enemies.boomer.blast!.damage > 0);
  assert.ok(cfg.enemies.screamer.aura!.speedBoost > 0);
});
