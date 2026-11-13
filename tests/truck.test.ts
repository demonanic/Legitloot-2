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
  assert.ok(pathWith(true) > pathWith(false) + 5, `${pathWith(true).toFixed(0)} vs ${pathWith(false).toFixed(0)}`);
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

// --- Route planning and collisions -----------------------------------------------

import { buildStructure, planTruckPath, truckTouches } from "../games/zid/sim.js";
import { tileStatus } from "../games/zid/grid.js";

/** Drive a departure to the end, checking the body never touches what it must avoid. */
function driveOut(s: GameState, cfg: GameConfig, level: 1 | 2): { steps: number; maxAccel: number; maxBrake: number } {
  const keeper = assault(s, cfg);
  step(s, cfg, DT);
  let steps = 0;
  let prevV = s.truck.speed;
  let maxAccel = 0;
  let maxBrake = 0;
  let left = false;
  while (s.truck.state === "departing" && steps < 60 * 30) {
    step(s, cfg, DT);
    keeper.x = 360;
    keeper.y = 5;
    steps++;
    const t = s.truck;
    if (t.state !== "departing") break;
    // Leaving the bay it may brush its own starting tiles; after that, nothing.
    if (!left && !truckTouches(s, cfg, t.x, t.y, t.heading, 1)) left = true;
    if (left) assert.equal(truckTouches(s, cfg, t.x, t.y, t.heading, level), false, `touching something at (${t.x.toFixed(0)}, ${t.y.toFixed(0)})`);
    maxAccel = Math.max(maxAccel, (t.speed - prevV) / DT);
    maxBrake = Math.max(maxBrake, (prevV - t.speed) / DT);
    prevV = t.speed;
  }
  assert.equal(s.truck.state, "away", "it got out");
  return { steps, maxAccel, maxBrake };
}

test("truck bay: the two tiles beside the door can't be built on", () => {
  const cfg = SUCCESS;
  for (const [c, r] of cfg.construction.truckBay) assert.equal(tileStatus(cfg, c, r), "invalid-terrain");
  const park = truckParking(cfg);
  const s = createState(cfg, 1);
  assert.equal(truckTouches(s, cfg, park.x, park.y, 0, 1), false);
});

test("truck route: on an open field it never drives over a rock or the stronghold, on any seed", () => {
  const cfg = SUCCESS;
  for (let seed = 1; seed <= 8; seed++) {
    const s = createState(cfg, seed);
    s.currency = 500;
    sendTruck(s, cfg);
    driveOut(s, cfg, 2);
  }
});

test("truck route: it goes round weapons, walls and traps instead of over them", () => {
  const cfg = SUCCESS;
  for (let seed = 1; seed <= 6; seed++) {
    const s = createState(cfg, seed);
    s.currency = 10_000;
    s.stronghold.level = 4;
    // Clutter south, east and west of the bay, leaving gaps to find.
    const spots: [string, number, number][] = [
      ["machine-gun", 3, 12], ["barricade", 4, 13], ["mortar", 6, 12], ["mine", 5, 14], ["barricade", 2, 11],
      ["machine-gun", 7, 11], ["tripwire", 3, 14], ["barricade", 6, 14], ["machine-gun", 2, 13], ["barricade", 7, 12],
    ];
    for (const [kind, c, r] of spots) assert.ok(buildStructure(s, cfg, kind as never, c, r).ok, `${kind} at ${c},${r}`);
    sendTruck(s, cfg);
    driveOut(s, cfg, 1);
  }
});

test("truck route: walled in completely, it pushes through your structures but still never a rock or the stronghold", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 2);
  s.currency = 10_000;
  for (const [c, r] of [[3, 10], [3, 11], [3, 12], [4, 12], [5, 12], [6, 12], [6, 11], [6, 10]] as const) {
    assert.ok(buildStructure(s, cfg, "barricade", c, r).ok, `wall at ${c},${r}`);
  }
  sendTruck(s, cfg);
  const keeper = assault(s, cfg);
  let steps = 0;
  while (s.truck.state !== "away" && steps++ < 90 * 30) {
    step(s, cfg, DT);
    keeper.x = 360;
    keeper.y = 5;
    if (s.truck.state === "departing") assert.equal(truckTouches(s, cfg, s.truck.x, s.truck.y, s.truck.heading, 2), false);
  }
  assert.equal(s.truck.state, "away");
});

test("truck route: the plan is a short list of long straight runs, not a tile-by-tile zig-zag", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  const park = truckParking(cfg);
  const path = planTruckPath(s, cfg, park, { x: 360, y: cfg.world.height + 60 });
  assert.ok(path.length <= 3, `${path.length} waypoints on an open field`);
  s.currency = 1000;
  buildStructure(s, cfg, "barricade", 4, 13);
  buildStructure(s, cfg, "barricade", 5, 13);
  const round = planTruckPath(s, cfg, park, { x: 360, y: cfg.world.height + 60 });
  assert.ok(round.length >= 2 && round.length <= 6, `${round.length} waypoints round a wall`);
});

test("truck speed: it pulls away and brakes gradually, never jumping to full speed", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  s.currency = 500;
  sendTruck(s, cfg);
  const { maxAccel, maxBrake } = driveOut(s, cfg, 2);
  assert.ok(maxAccel <= cfg.truck.accel + 1e-6, `accel ${maxAccel}`);
  assert.ok(maxBrake <= cfg.truck.brake + 1e-6, `brake ${maxBrake}`);
});

test("truck: coming home it ends squarely in its bay, facing east, without touching anything on the way", () => {
  const cfg = SUCCESS;
  for (let seed = 1; seed <= 6; seed++) {
    const s = createState(cfg, seed);
    s.currency = 10_000;
    for (const [c, r] of [[3, 12], [6, 12], [2, 11], [7, 11], [4, 13]] as const) buildStructure(s, cfg, "barricade", c, r);
    sendTruck(s, cfg);
    let keeper = assault(s, cfg);
    run(s, cfg, 60, [keeper], () => s.truck.state === "away");
    clearWave(s, cfg);
    keeper = assault(s, cfg);
    run(s, cfg, 30, [keeper], () => s.truck.state === "arriving");
    let steps = 0;
    while (s.truck.state === "arriving" && steps++ < 60 * 30) {
      step(s, cfg, DT);
      keeper.x = 360;
      keeper.y = 5;
      const t = s.truck;
      if (t.state === "arriving") assert.equal(truckTouches(s, cfg, t.x, t.y, t.heading, 1), false, `seed ${seed} at (${t.x.toFixed(0)}, ${t.y.toFixed(0)})`);
    }
    assert.equal(s.truck.state, "unloading", `seed ${seed} docked`);
    const park = truckParking(cfg);
    assert.deepEqual([Math.round(s.truck.x), Math.round(s.truck.y)], [park.x, park.y]);
  }
});

// --- Salvage: what survives defeat --------------------------------------------------

import { salvageUsable, useSalvage } from "../games/zid/sim.js";

test("salvage: a share of every unloaded haul is banked; an empty or destroyed run banks nothing", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  s.currency = 500;
  sendTruck(s, cfg);
  let keeper = assault(s, cfg);
  run(s, cfg, 60, [keeper], () => s.truck.state === "away");
  clearWave(s, cfg);
  keeper = assault(s, cfg);
  run(s, cfg, 60, [keeper], () => s.truck.state === "unloading");
  const load = s.truck.load;
  assert.equal(s.salvageBanked, 0, "not until it is unloaded");
  run(s, cfg, cfg.truck.unloadSeconds + 1, [keeper]);
  assert.equal(s.salvageBanked, Math.round(load * cfg.salvage.shareOfHaul));
  const empty = cfgWith({ jackpot: 0, empty: 1, lost: 0 });
  const e = createState(empty, 1);
  e.currency = 500;
  sendTruck(e, empty);
  keeper = assault(e, empty);
  run(e, empty, 60, [keeper], () => e.truck.state === "away");
  clearWave(e, empty);
  keeper = assault(e, empty);
  run(e, empty, 80, [keeper], () => e.truck.state === "parked");
  assert.equal(e.salvageBanked, 0);
});

test("salvage: converts in chosen amounts, up to the cap for the run", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  const start = s.currency;
  assert.equal(salvageUsable(s, cfg, 40), 40);
  assert.equal(useSalvage(s, cfg, 40, 25), 25, "only the amount asked for");
  assert.equal(s.currency, start + 25 * cfg.salvage.suppliesPerSalvage);
  assert.equal(useSalvage(s, cfg, 15, 50), 15, "never more than the stockpile holds");
  // A big stockpile is capped per run.
  const left = cfg.salvage.maxStartBonus / cfg.salvage.suppliesPerSalvage - 40;
  assert.equal(useSalvage(s, cfg, 10_000), left);
  assert.equal(useSalvage(s, cfg, 10_000), 0, "cap reached");
  assert.equal(s.currency, start + cfg.salvage.maxStartBonus);
});

test("salvage: can be converted at any point in a run, between waves or mid-assault, but not after defeat", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  assault(s, cfg);
  assert.equal(useSalvage(s, cfg, 100, 25), 25, "mid-assault");
  clearWave(s, cfg);
  assert.equal(s.wave, 2);
  assert.equal(useSalvage(s, cfg, 100, 25), 25, "in a later wave's preparation");
  s.phase = "lost";
  assert.equal(useSalvage(s, cfg, 100, 25), 0);
});

test("menu: the base menu's convert page offers set amounts and everything allowed, in both phases", () => {
  const cfg = SUCCESS;
  const s = createState(cfg, 1);
  const base = panelModel(s, cfg, { col: 4, row: 9 }, "weapons", 60);
  const link = base.buttons.find((b) => b.slot === "a2")!;
  assert.deepEqual(link.action, { kind: "page", page: "salvage" });
  assert.match(link.label, /Convert Salvage \(60\)/);
  const page = panelModel(s, cfg, { col: 4, row: 9 }, "salvage", 60);
  const amounts = page.buttons.filter((b) => b.action.kind === "convert-salvage");
  assert.deepEqual(amounts.map((b) => [b.action.kind === "convert-salvage" ? b.action.amount : 0, b.enabled]), [[25, true], [50, true], [100, false], [60, true]]);
  assault(s, cfg);
  const hot = panelModel(s, cfg, { col: 4, row: 9 }, "weapons", 60);
  assert.ok(hot.buttons.some((b) => b.action.kind === "page" && b.action.page === "salvage" && b.enabled), "reachable mid-assault");
  assert.equal(panelModel(s, cfg, { col: 4, row: 9 }, "salvage", 60).buttons.filter((b) => b.action.kind === "convert-salvage").length, 4);
  const empty = panelModel(createState(cfg, 1), cfg, { col: 4, row: 9 }, "weapons", 0);
  assert.equal(empty.buttons.find((b) => b.slot === "a2")!.enabled, false);
});
