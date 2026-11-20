import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, type GameConfig } from "../games/zvhm/config.js";
import { PERKS, drawPerks, eligiblePerks, perkDef, weaponPerkScale, type PerkId } from "../games/zvhm/perks.js";
import {
  buildBarricade,
  buildMortar,
  buildTurret,
  choosePerk,
  createState,
  damageEnemy,
  startWaveNow,
  step,
  survivorDamage,
  survivorDef,
  turretStats,
  type Enemy,
  type GameState,
} from "../games/zvhm/sim.js";

const cfg = baseConfig;
const DT = 1 / 30;

/** Clear the current wave at once and land in the next break. */
function clearWave(s: GameState, c: GameConfig = cfg): void {
  startWaveNow(s, c);
  s.nextSpawn = s.spawns.length;
  s.enemies = [];
  step(s, c, DT);
}

/** Read the offer without TypeScript's narrowing from earlier checks. */
const offerOf = (s: GameState): PerkId[] | null => s.perkOffer;

function zombie(s: GameState, type: Enemy["type"], hp = 1e6): Enemy {
  const e: Enemy = { id: s.nextEnemyId++, type, maxHp: hp, x: 360, y: 200, hp, attackCooldown: 0, attacking: false };
  s.enemies.push(e);
  return e;
}

test("perks: each cleared wave offers three different perks, and none before wave 1", () => {
  const s = createState(cfg, 7);
  assert.ok(s.perkOffer === null);
  for (let w = 1; w <= 6; w++) {
    if (s.perkOffer) choosePerk(s, s.perkOffer[0]!);
    clearWave(s);
    const offer = offerOf(s);
    assert.equal(offer?.length, 3, `after wave ${w}`);
    assert.equal(new Set(offer).size, 3);
  }
});

test("perks: offers come from their own random stream, so waves roll the same with or without them", () => {
  const off: GameConfig = { ...cfg, perks: { ...cfg.perks, enabled: false } };
  const a = createState(cfg, 11);
  const b = createState(off, 11);
  for (let w = 0; w < 5; w++) {
    if (a.perkOffer) a.perkOffer = null;
    clearWave(a);
    clearWave(b, off);
    assert.deepEqual(a.spawns, b.spawns);
  }
  assert.equal(b.perkOffer, null, "disabled: no offers");
  const again = createState(cfg, 7);
  clearWave(again);
  const once = createState(cfg, 7);
  clearWave(once);
  assert.deepEqual(again.perkOffer, once.perkOffer, "same seed, same offer");
});

test("perks: weapon perks wait for their weapon, and maxed perks are never offered", () => {
  const start = eligiblePerks({}, () => false, { survivors: false, armoredSoon: false });
  for (const id of ["napalm", "overcharge", "capacitors", "big-bang", "survivor-training", "armor-piercing"] as PerkId[]) assert.ok(!start.includes(id), id);
  assert.ok(start.includes("hot-barrels") && start.includes("reinforced"));
  const all = eligiblePerks({}, () => true, { survivors: true, armoredSoon: true });
  assert.equal(all.length, PERKS.length);
  const maxed = Object.fromEntries(PERKS.map((p) => [p.id, p.max]));
  assert.deepEqual(eligiblePerks(maxed, () => true, { survivors: true, armoredSoon: true }), []);
  assert.deepEqual(drawPerks([], 3, Math.random), []);
  assert.equal(drawPerks(["napalm", "scavenger"], 3, Math.random).length, 2);
});

test("perks: picking takes one level, closes the offer, and only offered perks can be picked", () => {
  const s = createState(cfg, 7);
  assert.deepEqual(choosePerk(s, "hot-barrels"), { ok: false, reason: "no-offer" });
  clearWave(s);
  const offered = s.perkOffer![1]!;
  const other = PERKS.map((p) => p.id).find((id) => !s.perkOffer!.includes(id))!;
  assert.deepEqual(choosePerk(s, other), { ok: false, reason: "not-offered" });
  assert.ok(choosePerk(s, offered).ok);
  assert.equal(s.perks[offered], 1);
  assert.equal(s.perkOffer, null);
});

test("perks: the break waits while choosing, and starting the wave early forfeits the pick", () => {
  const s = createState(cfg, 7);
  clearWave(s);
  const t = s.phaseTimer;
  for (let i = 0; i < 60; i++) step(s, cfg, DT);
  assert.equal(s.phaseTimer, t);
  startWaveNow(s, cfg);
  assert.equal(s.perkOffer, null);
  assert.equal(s.phase, "wave");
});

test("perks: Hot Barrels speeds every weapon; damage perks only touch their own weapons", () => {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  const g = buildTurret(s, cfg, 4, 4);
  const m = buildMortar(s, cfg, 6, 4);
  assert.ok(g.ok && m.ok);
  const gun = () => turretStats(cfg, g.structure.turret!, "machine-gun", s.perks);
  const mortar = () => turretStats(cfg, m.structure.turret!, "mortar", s.perks);
  const g0 = gun();
  const m0 = mortar();
  s.perks = { "hot-barrels": 2, "heavy-rounds": 1 };
  assert.ok(Math.abs(gun().fireRate / g0.fireRate - 1.16) < 1e-9);
  assert.ok(Math.abs(mortar().fireRate / m0.fireRate - 1.16) < 1e-9);
  assert.ok(Math.abs(gun().damage / g0.damage - 1.12) < 1e-9);
  assert.equal(mortar().damage, m0.damage);
  s.perks = { "big-bang": 1 };
  assert.ok(Math.abs(mortar().damage / m0.damage - 1.15) < 1e-9);
  assert.deepEqual(weaponPerkScale({ capacitors: 2 }, "railgun"), { rate: 1.5, damage: 1 });
  assert.deepEqual(weaponPerkScale({ napalm: 1, overcharge: 1 }, "flamer"), { rate: 1, damage: 1.25 });
});

test("perks: Armor Piercing lets bullets bite deeper into Armored", () => {
  const s = createState(cfg, 1);
  s.perks = { "armor-piercing": 2 };
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  s.enemies = [];
  const a = zombie(s, "armored");
  s.projectiles.push({ x: a.x, y: a.y, vx: 0, vy: 0, damage: 20, life: 1 });
  step(s, cfg, DT);
  assert.ok(Math.abs(1e6 - a.hp - 20 * Math.min(1, cfg.enemies.armored.bulletFactor! * 1.5)) < 1e-6);
});

test("perks: Reinforced lifts what is already built and what comes after", () => {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  const t = buildTurret(s, cfg, 4, 4);
  assert.ok(t.ok);
  t.structure.hp = t.structure.maxHp / 2;
  const max0 = t.structure.maxHp;
  clearWave(s);
  s.perkOffer = ["reinforced"];
  assert.ok(choosePerk(s, "reinforced").ok);
  assert.equal(t.structure.maxHp, Math.round(max0 * 1.15));
  assert.equal(t.structure.hp, Math.round((max0 / 2) * 1.15));
  const b = buildBarricade(s, cfg, 6, 6);
  assert.ok(b.ok);
  assert.equal(b.structure.maxHp, Math.round(cfg.barricade.maxHp * 1.15));
});

test("perks: Field Medic heals the stronghold during assaults only", () => {
  const s = createState(cfg, 1);
  s.perks = { "field-medic": 2 };
  s.stronghold.hp = 100;
  for (let i = 0; i < 30; i++) step(s, cfg, DT);
  assert.equal(s.stronghold.hp, 100, "not in the break");
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  s.enemies = [];
  zombie(s, "walker").x = 5;
  for (let i = 0; i < 30; i++) step(s, cfg, DT);
  assert.ok(Math.abs(s.stronghold.hp - (100 + 2 * perkDef("field-medic").per)) < 0.01);
});

test("perks: Scavenger pays more per kill, Quick Charge fills the meter faster", () => {
  const kill = (perks: GameState["perks"]) => {
    const s = createState(cfg, 5);
    s.perks = perks;
    startWaveNow(s, cfg);
    const cash = s.currency;
    damageEnemy(s, cfg, zombie(s, "brute", 1), 5);
    return { paid: s.currency - cash, charge: s.charge };
  };
  const plain = kill({});
  const scav = kill({ scavenger: 3 });
  assert.equal(scav.paid, Math.round(plain.paid * 1.36));
  const quick = kill({ "quick-charge": 2 });
  assert.ok(Math.abs(quick.charge / plain.charge - 1.4) < 1e-9);
});

test("perks: Training raises survivor damage", () => {
  const s = createState(cfg, 1);
  const def = survivorDef(cfg, "scout")!;
  const d0 = survivorDamage(s, cfg, def);
  s.perks = { "survivor-training": 3 };
  assert.ok(Math.abs(survivorDamage(s, cfg, def) / d0 - 1.6) < 1e-9);
});
