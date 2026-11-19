import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, ENEMY_TYPES, type EnemyType } from "../games/zid/config.js";
import { ZOMBIE_NAMES, ZOMBIE_TIPS, spawnEdge, wavePreview } from "../games/zid/preview.js";
import { createState, startWaveNow, step, type Spawn } from "../games/zid/sim.js";
import { dueTip } from "../games/zid/tutorial.js";

const cfg = baseConfig;
const DT = 1 / 30;
const { width: W, height: H } = cfg.world;

const sp = (type: EnemyType, x: number, y: number): Spawn => ({ at: 0, type, hp: 1, x, y });

test("preview: counts match the rolled wave exactly", () => {
  const s = createState(cfg, 4);
  // Roll wave 9 by clearing wave 8.
  s.wave = 8;
  startWaveNow(s, cfg);
  s.nextSpawn = s.spawns.length;
  s.enemies = [];
  step(s, cfg, DT);
  assert.equal(s.phase, "prep");
  const p = wavePreview(cfg, s.wave, s.spawns, s.seenTypes);
  assert.equal(p.count, s.spawns.length);
  assert.equal(p.types.reduce((n, t) => n + t.count, 0), p.count);
  for (const t of p.types) assert.equal(t.count, s.spawns.filter((x) => x.type === t.type).length);
  for (let i = 1; i < p.types.length; i++) assert.ok(p.types[i - 1]!.count >= p.types[i]!.count, "most first");
  assert.equal(p.sides.reduce((n, x) => n + x.count, 0), p.count);
});

test("preview: sides come from spawn positions, and a side with half or more is the main one", () => {
  assert.equal(spawnEdge(cfg, { x: 100, y: -10 }), "north");
  assert.equal(spawnEdge(cfg, { x: 100, y: H + 10 }), "south");
  assert.equal(spawnEdge(cfg, { x: -10, y: 300 }), "west");
  assert.equal(spawnEdge(cfg, { x: W + 10, y: 300 }), "east");
  const lop = [sp("walker", -10, 300), sp("walker", -10, 500), sp("walker", -10, 400), sp("runner", 100, -10)];
  const p = wavePreview(cfg, 3, lop);
  assert.equal(p.mainSide, "west");
  assert.equal(p.sides[0]!.edge, "west");
  assert.equal(p.sides[0]!.along, 400);
  const even = [sp("walker", -10, 300), sp("walker", W + 10, 300), sp("walker", 100, -10)];
  assert.equal(wavePreview(cfg, 3, even).mainSide, null);
});

test("preview: types not yet met this run are new; walkers never are", () => {
  const spawns = [sp("walker", -10, 1), sp("spitter", -10, 1), sp("runner", -10, 1)];
  assert.deepEqual(wavePreview(cfg, 5, spawns, ["walker", "runner"]).newTypes, ["spitter"]);
  assert.deepEqual(wavePreview(cfg, 5, spawns, ["walker", "runner", "spitter"]).newTypes, []);
  assert.deepEqual(wavePreview(cfg, 1, [sp("walker", -10, 1)], []).newTypes, []);
});

test("preview: the run remembers which types have spawned", () => {
  const s = createState(cfg, 2);
  assert.equal(s.seenTypes.length, 0);
  startWaveNow(s, cfg);
  for (let i = 0; i < 30 * 3; i++) step(s, cfg, DT);
  assert.ok(s.seenTypes.includes("walker"));
  for (const t of s.seenTypes) assert.ok(s.spawns.slice(0, s.nextSpawn).some((x) => x.type === t));
});

test("preview: an empty schedule previews nothing", () => {
  const p = wavePreview(cfg, 4, []);
  assert.equal(p.count, 0);
  assert.equal(p.mainSide, null);
  assert.deepEqual(p.sides, []);
});

test("preview: every type has a name and a short tip", () => {
  for (const t of ENEMY_TYPES) {
    assert.ok(ZOMBIE_NAMES[t].length > 0);
    assert.ok(ZOMBIE_TIPS[t].length > 0 && ZOMBIE_TIPS[t].length <= 50, `${t}: ${ZOMBIE_TIPS[t].length}`);
  }
});

test("tutorial: the Next wave tip comes up in the break before wave 2", () => {
  const s = createState(cfg, 1);
  const seen = ["welcome", "supplies", "build", "manage", "start", "wave", "base"] as const;
  assert.notEqual(dueTip({ seen: [...seen], off: false }, s, 0), "preview", "not before wave 1");
  s.wave = 2;
  assert.equal(dueTip({ seen: [...seen], off: false }, s, 0), "preview");
});
