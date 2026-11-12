import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig } from "../games/zid/config.js";
import { buildableTiles } from "../games/zid/grid.js";
import { panelModel } from "../games/zid/panel.js";
import {
  buildBarricade,
  buildMortar,
  buildTurret,
  checkBuild,
  createState,
  damageEnemy,
  damageStructure,
  nextBaseUpgradeCost,
  nextUpgradeCost,
  pickTarget,
  recycleStructure,
  startWaveNow,
  step,
  turretRange,
  upgradeBase,
  upgradeTurret,
  type GameState,
} from "../games/zid/sim.js";

const cfg = baseConfig;
const DT = 1 / 30;
const levels = cfg.stronghold.levels;

function prep(currency = 10_000): GameState {
  const s = createState(cfg, 1);
  s.currency = currency;
  return s;
}

/** Buildable tiles, in a fixed order. */
const TILES: [number, number][] = buildableTiles(cfg).map((t) => [t.col, t.row]);

// --- Range upgrade --------------------------------------------------------------

test("range: a machine gun's Range upgrade widens its reach per level", () => {
  const s = prep();
  const t = buildTurret(s, cfg, 4, 4);
  assert.ok(t.ok);
  const r0 = turretRange(cfg, t.structure);
  assert.equal(r0, cfg.turret.range);
  assert.ok(upgradeTurret(s, cfg, t.structure.id, "range").ok);
  assert.equal(turretRange(cfg, t.structure), cfg.turret.range * (1 + cfg.upgrades.range.perLevel));
  assert.equal(s.currency, 10_000 - cfg.turret.cost - cfg.upgrades.range.costs[0]!);
});

test("range: an upgraded gun shoots zombies the base range can't reach", () => {
  const s = prep();
  const t = buildTurret(s, cfg, 4, 4).ok ? s.structures[0]! : null!;
  upgradeTurret(s, cfg, t.id, "range");
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  const d = cfg.turret.range + 20;
  s.enemies.push({ id: s.nextEnemyId++, type: "walker", maxHp: 1e6, x: t.x, y: t.y - d, hp: 1e6, attackCooldown: 0, attacking: false });
  assert.equal(pickTarget(s, cfg, t), null, "out of base range");
  assert.ok(pickTarget(s, cfg, t, turretRange(cfg, t)));
  step(s, cfg, DT);
  assert.ok(s.shotsFired > 0);
});

test("range: mortars can't take the Range upgrade", () => {
  const s = prep();
  const m = buildMortar(s, cfg, 4, 4);
  assert.ok(m.ok);
  assert.equal(nextUpgradeCost(cfg, m.structure, "range"), null);
  assert.deepEqual(upgradeTurret(s, cfg, m.structure.id, "range"), { ok: false, reason: "not-for-mortar" });
});

test("menu: a machine gun offers Speed, Damage, Range, Repair and Recycle", () => {
  const s = prep();
  buildTurret(s, cfg, 4, 4);
  const menu = panelModel(s, cfg, { col: 4, row: 4 });
  assert.deepEqual(
    menu.buttons.map((b) => [b.slot, b.action.kind]),
    [["a0", "upgrade"], ["b0", "upgrade"], ["a1", "upgrade"], ["b1", "repair"], ["a2", "recycle"], ["close", "close"]],
  );
  assert.match(menu.buttons[2]!.label, /^Range 1\/3/);
});

// --- Caps and base upgrades -------------------------------------------------

test("caps: the starting base allows its listed machine guns and mortars; barricades are unlimited", () => {
  const s = prep();
  let tiles = [...TILES];
  for (let i = 0; i < levels[0]!.machineGuns; i++) assert.ok(buildTurret(s, cfg, ...tiles.shift()!).ok);
  assert.equal(checkBuild(s, cfg, ...tiles[0]!, "machine-gun"), "limit-reached");
  for (let i = 0; i < levels[0]!.mortars; i++) assert.ok(buildMortar(s, cfg, ...tiles.shift()!).ok);
  assert.equal(checkBuild(s, cfg, ...tiles[0]!, "mortar"), "limit-reached");
  const before = s.currency;
  assert.deepEqual(buildTurret(s, cfg, ...tiles[0]!), { ok: false, reason: "limit-reached" });
  assert.equal(s.currency, before, "a refused build costs nothing");
  for (const t of tiles.slice(0, 8)) assert.ok(buildBarricade(s, cfg, ...t).ok);
});

test("caps: rubble still counts; recycling it frees the slot", () => {
  const s = prep();
  for (let i = 0; i < levels[0]!.machineGuns; i++) buildTurret(s, cfg, ...TILES[i]!);
  const first = s.structures[0]!;
  damageStructure(s, first, 1e9);
  assert.equal(checkBuild(s, cfg, ...TILES[10]!, "machine-gun"), "limit-reached");
  assert.ok(recycleStructure(s, cfg, first.id).ok);
  assert.equal(checkBuild(s, cfg, ...TILES[10]!, "machine-gun"), null);
});

test("base upgrade: costs Supplies, raises the caps and adds already-repaired health", () => {
  const s = prep(1000);
  s.stronghold.hp = 300;
  const cost = nextBaseUpgradeCost(s, cfg)!;
  assert.equal(cost, levels[1]!.cost);
  assert.ok(upgradeBase(s, cfg).ok);
  assert.equal(s.currency, 1000 - cost);
  assert.equal(s.stronghold.level, 1);
  assert.equal(s.stronghold.maxHp, levels[1]!.maxHp);
  assert.equal(s.stronghold.hp, 300 + levels[1]!.maxHp - levels[0]!.maxHp);
  for (let i = 0; i < levels[1]!.machineGuns; i++) assert.ok(buildTurret(s, cfg, ...TILES[i]!).ok, `gun ${i}`);
});

test("base upgrade: between waves only, needs Supplies, stops at the top level", () => {
  const s = prep(0);
  assert.deepEqual(upgradeBase(s, cfg), { ok: false, reason: "insufficient-funds" });
  s.currency = 1e6;
  startWaveNow(s, cfg);
  assert.deepEqual(upgradeBase(s, cfg), { ok: false, reason: "assault-active" });
  const t = prep(1e6);
  for (let i = 1; i < levels.length; i++) assert.ok(upgradeBase(t, cfg).ok);
  assert.equal(nextBaseUpgradeCost(t, cfg), null);
  assert.deepEqual(upgradeBase(t, cfg), { ok: false, reason: "max-level" });
});

test("menu: the stronghold offers Repair and Upgrade base, and says what the next level allows", () => {
  const s = prep();
  const menu = panelModel(s, cfg, { col: 4, row: 9 });
  assert.deepEqual(menu.buttons.map((b) => b.action.kind), ["repair", "upgrade-base", "send-truck", "close"]);
  assert.match(menu.title, /^Base level 1/);
  assert.match(menu.info!, new RegExp(`→ ${levels[1]!.machineGuns}, ${levels[1]!.mortars} · unlocks Trip wire`));
});

test("menu: build buttons show how many of each are built against the cap", () => {
  const s = prep();
  buildTurret(s, cfg, 1, 4);
  const menu = panelModel(s, cfg, { col: 2, row: 4 });
  assert.match(menu.buttons[0]!.label, new RegExp(`^Turret 1/${levels[0]!.machineGuns}`));
  assert.match(menu.buttons[3]!.label, new RegExp(`^Mortar 0/${levels[0]!.mortars}`));
});

test("popups: a paying kill leaves a floating +N that rises and fades", () => {
  const s = prep();
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  const e = { id: s.nextEnemyId++, type: "brute" as const, maxHp: 1, x: 100, y: 100, hp: 1, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  const before = s.currency;
  assert.ok(damageEnemy(s, cfg, e, 5), "brutes always drop");
  assert.equal(s.popups.length, 1);
  assert.equal(s.popups[0]!.amount, s.currency - before);
  s.enemies.push({ id: s.nextEnemyId++, type: "walker", maxHp: 1e9, x: 600, y: 1200, hp: 1e9, attackCooldown: 0, attacking: false });
  step(s, cfg, 0.5);
  assert.ok(s.popups[0]!.y < 100, "rises");
  step(s, cfg, 0.6);
  assert.equal(s.popups.length, 0, "gone after a second");
});
