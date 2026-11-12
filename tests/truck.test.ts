import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, type GameConfig } from "../games/zid/config.js";
import { panelModel } from "../games/zid/panel.js";
import {
  checkSendTruck,
  createState,
  sendTruck,
  startWaveNow,
  step,
  truckExposed,
  truckParking,
  type Enemy,
  type GameState,
} from "../games/zid/sim.js";

const DT = 1 / 30;
/** A config whose runs always end one way, with no pickups to muddy the Supplies count. */
function cfgWith(odds: { jackpot: number; empty: number; lost: number }): GameConfig {
  return { ...baseConfig, pickups: { ...baseConfig.pickups, everyMax: 0 }, truck: { ...baseConfig.truck, odds } };
}
const SUCCESS = cfgWith({ jackpot: 0, empty: 0, lost: 0 });

function zombie(s: GameState, x: number, y: number, hp = 1e9, type: Enemy["type"] = "walker"): Enemy {
  const e: Enemy = { id: s.nextEnemyId++, type, maxHp: hp, x, y, hp, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  return e;
}
/** Start an assault with no spawns and one harmless zombie parked in the far north to keep it running. */
function assault(s: GameState, cfg: GameConfig): Enemy {
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  const keeper = zombie(s, 360, 5);
  keeper.attackCooldown = 1e9;
  return keeper;
}
function run(s: GameState, cfg: GameConfig, seconds: number, pin: Enemy[] = [], until?: () => boolean): number {
  const pos = pin.map((e) => [e.x, e.y] as const);
  let t = 0;
  for (let i = 0; i < seconds * 30; i++) {
    step(s, cfg, DT);
    pin.forEach((e, k) => ([e.x, e.y] = pos[k]!));
    t += DT;
    if (until?.()) break;
  }
  return t;
}
/** Clear the current wave by removing every zombie. */
function clearWave(s: GameState, cfg: GameConfig): void {
  s.enemies = [];
  step(s, cfg, DT);
  assert.equal(s.phase, "prep");
}

test("truck: a run is paid for between waves only, one at a time", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  s.currency = cfg.truck.cost - 1;
  assert.deepEqual(sendTruck(s, cfg), { ok: false, reason: "insufficient-funds" });
  s.currency = 500;
  assert.deepEqual(sendTruck(s, cfg), { ok: true });
  assert.equal(s.currency, 500 - cfg.truck.cost);
  assert.equal(s.truck.state, "queued");
  assert.equal(checkSendTruck(s, cfg), "truck-busy");
  const t = createState(cfg, 1);
  t.currency = 500;
  assault(t, cfg);
  assert.deepEqual(sendTruck(t, cfg), { ok: false, reason: "assault-active" });
});

test("truck: it sits parked and safe until the assault starts, then drives off the field", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  s.currency = 500;
  sendTruck(s, cfg);
  const park = truckParking(cfg);
  for (let i = 0; i < 60; i++) step(s, cfg, DT);
  assert.equal(s.truck.state, "queued");
  assert.deepEqual([s.truck.x, s.truck.y], [park.x, park.y]);
  assert.equal(truckExposed(s), false);
  const keeper = assault(s, cfg);
  step(s, cfg, DT);
  assert.equal(s.truck.state, "departing");
  assert.equal(truckExposed(s), true);
  const took = run(s, cfg, 30, [keeper], () => s.truck.state === "away");
  assert.equal(s.truck.state, "away");
  assert.ok(took > 3 && took < 20, `left in ${took.toFixed(1)}s`);
});

test("truck: it steers in a curve at a limited turn rate, never jumping or snapping round", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 3);
  s.currency = 500;
  sendTruck(s, cfg);
  const keeper = assault(s, cfg);
  step(s, cfg, DT);
  let prev = { x: s.truck.x, y: s.truck.y, h: s.truck.heading };
  let turned = 0;
  let path = 0;
  const start = { ...prev };
  while (s.truck.state === "departing") {
    step(s, cfg, DT);
    keeper.x = 360;
    keeper.y = 5;
    const t = s.truck;
    if (t.state !== "departing") break;
    const moved = Math.hypot(t.x - prev.x, t.y - prev.y);
    assert.ok(moved <= cfg.truck.speed * DT + 1e-6, "no jumps");
    let dh = t.heading - prev.h;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    assert.ok(Math.abs(dh) <= cfg.truck.turnRate * DT + 1e-6, "turn rate respected");
    // It always moves the way it faces.
    if (moved > 0.01) assert.ok(Math.abs(Math.atan2(t.y - prev.y, t.x - prev.x) - prev.h) < 0.2 || Math.abs(dh) > 0);
    turned += Math.abs(dh);
    path += moved;
    prev = { x: t.x, y: t.y, h: t.heading };
  }
  const straight = Math.hypot(prev.x - start.x, prev.y - start.y);
  assert.ok(turned > 0.3, `it had to turn (${turned.toFixed(2)} rad)`);
  assert.ok(path > straight + 2, `curved path ${path.toFixed(0)} vs straight ${straight.toFixed(0)}`);
});

test("truck: it swerves around zombies in its way", () => {
  const cfg = SUCCESS;
  const pathWith = (block: boolean): number => {
    const s = createState(cfg, 3);
    s.currency = 500;
    sendTruck(s, cfg);
    const keeper = assault(s, cfg);
    step(s, cfg, DT);
    const pin = [keeper];
    if (block) {
      // A harmless clump straight down its route (they can't attack: cooldown held).
      const t = s.truck;
      const a = Math.atan2(t.ty - t.y, t.tx - t.x);
      for (let i = 0; i < 3; i++) {
        const z = zombie(s, t.x + Math.cos(a) * (190 + i * 12), t.y + Math.sin(a) * (190 + i * 12));
        z.attackCooldown = 1e9;
        pin.push(z);
      }
    }
    let sideways = 0;
    const t0 = { x: s.truck.x, y: s.truck.y };
    const a0 = Math.atan2(s.truck.ty - t0.y, s.truck.tx - t0.x);
    while (s.truck.state === "departing") {
      const pos = pin.map((e) => [e.x, e.y] as const);
      step(s, { ...cfg, truck: { ...cfg.truck, aggroRadius: 0 } }, DT);
      pin.forEach((e, k) => ([e.x, e.y] = pos[k]!));
      const dx = s.truck.x - t0.x;
      const dy = s.truck.y - t0.y;
      sideways = Math.max(sideways, Math.abs(-Math.sin(a0) * dx + Math.cos(a0) * dy));
    }
    return sideways;
  };
  assert.ok(pathWith(true) > pathWith(false) + 15, `${pathWith(true).toFixed(0)} vs ${pathWith(false).toFixed(0)}`);
});

test("truck: a successful run comes back next wave, unloads beside the base, and pays out once", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  s.currency = 500;
  sendTruck(s, cfg);
  let keeper = assault(s, cfg);
  run(s, cfg, 30, [keeper], () => s.truck.state === "away");
  // Still away for the rest of this wave.
  run(s, cfg, 20, [keeper]);
  assert.equal(s.truck.state, "away");
  clearWave(s, cfg);
  assert.equal(checkSendTruck(s, cfg), "truck-busy");
  keeper = assault(s, cfg);
  run(s, cfg, cfg.truck.returnMax + 1, [keeper], () => s.truck.state === "arriving");
  assert.equal(s.truck.state, "arriving");
  const load = s.truck.load;
  assert.ok(load >= cfg.truck.loadMin, `load ${load}`);
  const before = s.currency;
  run(s, cfg, 40, [keeper], () => s.truck.state === "unloading");
  assert.equal(s.truck.state, "unloading");
  const park = truckParking(cfg);
  assert.deepEqual([s.truck.x, s.truck.y], [park.x, park.y]);
  assert.equal(s.currency, before, "nothing is paid until unloading finishes");
  run(s, cfg, cfg.truck.unloadSeconds - 0.5, [keeper]);
  assert.equal(s.truck.state, "unloading");
  run(s, cfg, 1, [keeper]);
  assert.equal(s.truck.state, "parked");
  assert.equal(s.currency, before + load);
  assert.equal(s.truck.runs, 1);
  assert.equal(s.truck.hp, s.truck.maxHp, "ready for the next run");
});

test("truck: zombies near it attack it while it leaves; destroying it loses the run", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  s.currency = 500;
  sendTruck(s, cfg);
  assault(s, cfg);
  step(s, cfg, DT);
  // A pack of brutes right on top of it.
  for (let i = 0; i < 12; i++) zombie(s, s.truck.x + 20 + i, s.truck.y + 30, 1e9, "brute");
  const hp = s.truck.hp;
  run(s, cfg, 2);
  assert.ok(s.truck.hp < hp, "took damage while departing");
  run(s, cfg, 30, [], () => s.truck.state === "wrecked");
  assert.equal(s.truck.state, "wrecked");
  const money = s.currency;
  clearWave(s, cfg);
  assert.equal(s.truck.state, "parked", "a new truck is ready after the wave");
  assert.equal(s.currency, money, "nothing came back");
});

test("truck: destroyed while unloading, the load is lost", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  s.currency = 500;
  sendTruck(s, cfg);
  let keeper = assault(s, cfg);
  run(s, cfg, 30, [keeper], () => s.truck.state === "away");
  clearWave(s, cfg);
  keeper = assault(s, cfg);
  run(s, cfg, 60, [keeper], () => s.truck.state === "unloading");
  assert.equal(s.truck.state, "unloading");
  const before = s.currency;
  for (let i = 0; i < 14; i++) zombie(s, s.truck.x - 40 + i * 6, s.truck.y + 45, 1e9, "brute");
  run(s, cfg, cfg.truck.unloadSeconds, [keeper], () => s.truck.state === "wrecked");
  assert.equal(s.truck.state, "wrecked");
  run(s, cfg, 3, [keeper]);
  assert.equal(s.currency, before);
});

test("truck: a parked or away truck can't be hurt, and zombies ignore it", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  assault(s, cfg);
  const z = zombie(s, s.truck.x + 60, s.truck.y + 60, 1e9, "brute");
  run(s, cfg, 5);
  assert.equal(s.truck.hp, s.truck.maxHp);
  assert.ok(z.attacking === false || s.damageTaken > 0, "it went for the base instead");
});

test("truck outcomes: an empty run comes back with nothing; a lost crew never returns; a jackpot fills the meter", () => {
  const play = (cfg: GameConfig): GameState => {
    const s = createState(cfg, 1);
    s.currency = 500;
    sendTruck(s, cfg);
    let keeper = assault(s, cfg);
    run(s, cfg, 30, [keeper], () => s.truck.state === "away");
    clearWave(s, cfg);
    keeper = assault(s, cfg);
    run(s, cfg, 80, [keeper], () => s.truck.state === "parked" || s.truck.state === "wrecked");
    return s;
  };
  const spent = 500 - baseConfig.truck.cost;
  const empty = play(cfgWith({ jackpot: 0, empty: 1, lost: 0 }));
  assert.equal(empty.truck.state, "parked");
  assert.equal(empty.currency, spent);
  const lost = play(cfgWith({ jackpot: 0, empty: 0, lost: 1 }));
  assert.equal(lost.truck.state, "wrecked");
  assert.equal(lost.currency, spent);
  const jackpot = play(cfgWith({ jackpot: 1, empty: 0, lost: 0 }));
  assert.equal(jackpot.truck.state, "parked");
  assert.ok(jackpot.currency - spent >= baseConfig.truck.loadMin * 2);
  assert.equal(jackpot.charge, 1);
});

test("truck: on average a run brings back more than it costs", () => {
  const c = baseConfig.truck;
  const mean = (c.loadMin + c.loadMax) / 2 + c.loadPerWave;
  const expected = (1 - c.odds.lost - c.odds.empty - c.odds.jackpot) * mean + c.odds.jackpot * mean * 2;
  assert.ok(expected > c.cost * 1.5, `expected ${expected.toFixed(0)} for ${c.cost}`);
});

test("truck: sending one never disturbs the wave's own random rolls", () => {
  const cfg = SUCCESS;
  const a = createState(cfg, 9);
  const b = createState(cfg, 9);
  a.currency = b.currency = 500;
  sendTruck(a, cfg);
  startWaveNow(a, cfg);
  startWaveNow(b, cfg);
  for (let i = 0; i < 10 * 30; i++) {
    step(a, cfg, DT);
    step(b, cfg, DT);
  }
  assert.equal(a.rng, b.rng);
});

test("menu: the base menu offers a salvage run and shows what the truck is doing", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  s.currency = 500;
  const btn = () => panelModel(s, cfg, { col: 4, row: 9 }).buttons.find((b) => b.action.kind === "send-truck")!;
  assert.match(btn().label, new RegExp(`Salvage run · ${cfg.truck.cost}`));
  assert.equal(btn().enabled, true);
  sendTruck(s, cfg);
  assert.match(btn().label, /leaves next wave/);
  assert.equal(btn().enabled, false);
});
