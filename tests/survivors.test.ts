import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, type GameConfig } from "../games/zid/config.js";
import { panelModel } from "../games/zid/panel.js";
import { playRun, sensiblePlayer } from "../games/zid/bots.js";
import {
  addSurvivor,
  buildStructure,
  createState,
  startWaveNow,
  step,
  survivorDamage,
  survivorDef,
  type Enemy,
  type GameState,
} from "../games/zid/sim.js";

const cfg: GameConfig = { ...baseConfig, pickups: { ...baseConfig.pickups, everyMax: 0 } };
const DT = 1 / 30;
const ALL = cfg.survivors.roster.map((d) => d.id);

function zombie(s: GameState, x: number, y: number, hp = 1e9, type: Enemy["type"] = "walker"): Enemy {
  const e: Enemy = { id: s.nextEnemyId++, type, maxHp: hp, x, y, hp, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  return e;
}
function assault(s: GameState): Enemy {
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  const keeper = zombie(s, 700, 1270);
  keeper.attackCooldown = 1e9;
  return keeper;
}
function run(s: GameState, seconds: number, pin: Enemy[] = [], until?: () => boolean): void {
  const pos = pin.map((e) => [e.x, e.y] as const);
  for (let i = 0; i < seconds * 30; i++) {
    step(s, cfg, DT);
    pin.forEach((e, k) => ([e.x, e.y] = pos[k]!));
    if (until?.()) break;
  }
}
const one = (s: GameState, id: string) => s.survivors.find((v) => v.id === id)!;

test("survivors: a run starts with exactly the ones unlocked, each at their own post outside the walls", () => {
  assert.equal(createState(cfg, 1).survivors.length, 0);
  const s = createState(cfg, 1, { survivors: ["scout", "mechanic", "nobody"] });
  assert.deepEqual(s.survivors.map((v) => v.id), ["scout", "mechanic"]);
  const all = createState(cfg, 1, { survivors: ALL });
  const sh = all.stronghold;
  for (const v of all.survivors) {
    assert.ok(Math.abs(v.x - sh.x) >= sh.halfSize || Math.abs(v.y - sh.y) >= sh.halfSize, "outside the stronghold");
    assert.equal(v.hp, survivorDef(cfg, v.id)!.maxHp);
  }
  const spots = new Set(all.survivors.map((v) => `${Math.round(v.x)},${Math.round(v.y)}`));
  assert.equal(spots.size, ALL.length);
  assert.equal(addSurvivor(all, cfg, "scout"), false, "no duplicates");
});

test("survivors: they shoot zombies that come into range, and kills pay like any other", () => {
  const s = createState(cfg, 1, { survivors: ["marksman"] });
  const keeper = assault(s);
  const v = one(s, "marksman");
  const def = survivorDef(cfg, "marksman")!;
  const e = zombie(s, v.x + 120, v.y - 60, 60);
  e.attackCooldown = 1e9;
  const kills = s.kills;
  run(s, 6, [keeper, e], () => e.hp <= 0);
  assert.ok(e.hp <= 0, "shot dead");
  assert.equal(s.kills, kills + 1);
  assert.ok(def.range >= Math.hypot(120, 60));
});

test("survivors: they stay on a leash near the stronghold and never walk through it, rocks or anything built", () => {
  const s = createState(cfg, 1, { survivors: ALL });
  s.currency = 5000;
  for (const [c, r] of [[3, 8], [6, 8], [3, 11], [6, 11], [2, 9], [7, 10]] as const) buildStructure(s, cfg, "barricade", c, r);
  const keeper = assault(s);
  // Zombies all round, some far out to tempt them.
  const pins = [keeper];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const z = zombie(s, s.stronghold.x + Math.cos(a) * 330, s.stronghold.y + Math.sin(a) * 330);
    z.attackCooldown = 1e9;
    pins.push(z);
  }
  const sh = s.stronghold;
  for (let i = 0; i < 20 * 30; i++) {
    run(s, DT, pins);
    for (const v of s.survivors) {
      assert.ok(Math.hypot(v.x - sh.x, v.y - sh.y) <= cfg.survivors.leash + 6, `${v.id} strayed`);
      assert.ok(Math.abs(v.x - sh.x) >= sh.halfSize || Math.abs(v.y - sh.y) >= sh.halfSize, `${v.id} inside the stronghold`);
      for (const st of s.structures) assert.ok(Math.hypot(v.x - st.x, v.y - st.y) >= 20, `${v.id} inside a barricade`);
    }
  }
});

test("survivors: zombies that reach one hurt them; they back away and keep shooting", () => {
  const s = createState(cfg, 1, { survivors: ["scout"] });
  assault(s);
  const v = one(s, "scout");
  const z = zombie(s, v.x + 18, v.y, 1e9, "brute");
  const start = { x: v.x, y: v.y };
  run(s, 3);
  assert.ok(v.hp < v.maxHp, "took a hit");
  assert.ok(Math.hypot(v.x - start.x, v.y - start.y) > 15, "moved off");
  assert.ok(z.hp < 1e9, "and shot back");
});

test("survivors: badly hurt, they fall back to the door and recover", () => {
  const s = createState(cfg, 1, { survivors: ["marksman"] });
  const keeper = assault(s);
  const v = one(s, "marksman");
  v.hp = v.maxHp * 0.2;
  run(s, 6, [keeper]);
  assert.equal(v.retreating, true);
  assert.ok(v.hp > v.maxHp * 0.2, "healing at the door");
  run(s, 40, [keeper], () => !v.retreating);
  assert.equal(v.retreating, false, "back out once recovered");
});

test("survivors: one who runs out of health is down for the wave and back, healed, for the next", () => {
  const s = createState(cfg, 1, { survivors: ["scout", "marksman"] });
  const keeper = assault(s);
  const v = one(s, "scout");
  v.hp = 0;
  run(s, 0.2, [keeper]);
  assert.equal(v.downed, true);
  const shots = s.shotsFired;
  const z = zombie(s, v.x + 10, v.y, 50);
  z.attackCooldown = 1e9;
  run(s, 2, [keeper, z]);
  assert.equal(v.downed, true, "stays down");
  assert.ok(s.shotsFired >= shots);
  s.enemies = [];
  step(s, cfg, DT);
  assert.equal(s.phase, "prep");
  assert.equal(v.downed, false);
  assert.equal(v.hp, v.maxHp);
});

test("perk: the scout runs to pickups and collects them", () => {
  const s = createState(cfg, 1, { survivors: ["scout"] });
  const keeper = assault(s);
  const v = one(s, "scout");
  s.pickups.push({ id: 77, kind: "supplies", x: v.x + 120, y: v.y + 40, amount: 20, life: 30 });
  const before = s.currency;
  run(s, 6, [keeper], () => s.pickups.length === 0);
  assert.equal(s.pickups.length, 0);
  assert.equal(s.currency, before + 20);
});

test("perk: the marksman picks the toughest target and hits brutes harder", () => {
  const s = createState(cfg, 1, { survivors: ["marksman"] });
  const keeper = assault(s);
  const v = one(s, "marksman");
  const def = survivorDef(cfg, "marksman")!;
  const weak = zombie(s, v.x - 60, v.y - 80, 500);
  const brute = zombie(s, v.x + 110, v.y - 120, 5000, "brute");
  weak.attackCooldown = brute.attackCooldown = 1e9;
  run(s, 1.5, [keeper, weak, brute]);
  assert.equal(weak.hp, 500, "ignores the nearer, weaker one");
  const hit = 5000 - brute.hp;
  assert.ok(hit > 0);
  const per = survivorDamage(s, cfg, def) * def.perkValue;
  assert.ok(Math.abs(hit / per - Math.round(hit / per)) < 1e-6, "every hit carries the brute bonus");
});

test("perk: the mechanic repairs the stronghold during an assault", () => {
  const s = createState(cfg, 1, { survivors: ["mechanic"] });
  const keeper = assault(s);
  s.stronghold.hp = 200;
  run(s, 10, [keeper]);
  const def = survivorDef(cfg, "mechanic")!;
  assert.ok(Math.abs(s.stronghold.hp - (200 + def.perkValue * 10)) < 0.5, `hp ${s.stronghold.hp}`);
});

test("survivors hit harder as the base is upgraded", () => {
  const s = createState(cfg, 1, { survivors: ["scout"] });
  const def = survivorDef(cfg, "scout")!;
  const d0 = survivorDamage(s, cfg, def);
  s.stronghold.level = 3;
  assert.equal(survivorDamage(s, cfg, def), d0 * (1 + 3 * cfg.survivors.damagePerBaseLevel));
});

test("last stand: once per run, a standing survivor saves the stronghold; the second time it falls", () => {
  const s = createState(cfg, 1, { survivors: ["scout"] });
  const keeper = assault(s);
  s.stronghold.hp = 0;
  step(s, cfg, DT);
  assert.equal(s.phase, "wave", "still fighting");
  assert.equal(s.lastStandUsed, true);
  assert.equal(s.stronghold.hp, Math.round(s.stronghold.maxHp * cfg.survivors.lastStand.healShare));
  assert.equal(s.boost?.kind, "shield");
  // The force field holds for its few seconds even under attack.
  const sh = s.stronghold;
  for (let i = 0; i < 5; i++) zombie(s, sh.x - 20 + i * 10, sh.y - sh.halfSize - 4, 1e9, "brute");
  const taken = s.damageTaken;
  run(s, cfg.survivors.lastStand.shieldSeconds - 0.3, [keeper]);
  assert.equal(s.damageTaken, taken);
  run(s, 0.6, [keeper]);
  assert.equal(s.boost, null);
  s.stronghold.hp = 0;
  step(s, cfg, DT);
  assert.equal(s.phase, "lost");
});

test("last stand: needs someone on their feet; no survivors, or all downed, and the stronghold just falls", () => {
  const none = createState(cfg, 1);
  assault(none);
  none.stronghold.hp = 0;
  step(none, cfg, DT);
  assert.equal(none.phase, "lost");
  const down = createState(cfg, 1, { survivors: ["scout"] });
  assault(down);
  one(down, "scout").downed = true;
  down.stronghold.hp = 0;
  step(down, cfg, DT);
  assert.equal(down.phase, "lost");
  assert.equal(down.lastStandUsed, false);
});

test("menu: the base menu leads to a survivors page that shows prices against your Salvage", () => {
  const s = createState(cfg, 1, { survivors: ["scout"] });
  const base = panelModel(s, cfg, { col: 4, row: 9 }, "weapons", 130);
  const link = base.buttons.find((b) => b.action.kind === "page")!;
  assert.match(link.label, /Survivors 1\/3/);
  const page = panelModel(s, cfg, { col: 4, row: 9 }, "survivors", 130);
  assert.match(page.title, /Salvage 130/);
  const unlocks = page.buttons.filter((b) => b.action.kind === "unlock-survivor");
  assert.deepEqual(unlocks.map((b) => b.enabled), [false, true, false], "owned, affordable, too dear");
  assert.match(unlocks[0]!.label, /Ray · Scout ✓/);
  assert.match(unlocks[1]!.label, /Dutch · Marksman · 120/);
  // On any other tile that page means the ordinary build menu.
  const tile = panelModel(s, cfg, { col: 2, row: 4 }, "survivors", 130);
  assert.equal(tile.title, "Build a weapon");
});

test("balance: with every survivor a sensible player lasts longer, but not forever", () => {
  const waves = (survivors: string[]): number[] => {
    const out: number[] = [];
    for (let seed = 1; seed <= 8; seed++) out.push(playRun(cfg, seed, sensiblePlayer, 40, { survivors }).defeatWave ?? 41);
    return out.sort((a, b) => a - b);
  };
  const med = (a: number[]) => (a[3]! + a[4]!) / 2;
  const without = med(waves([]));
  const withAll = med(waves(ALL));
  assert.ok(withAll >= without + 1, `${withAll} vs ${without}`);
  assert.ok(withAll <= 30, `still ends: ${withAll}`);
});
