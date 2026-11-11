import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig } from "../games/zid/config.js";
import { buildableTiles, gridSize, pointInPolygon, tileAt, tileCenter, tileStatus } from "../games/zid/grid.js";
import { buildTurret, checkBuild, createState, startWaveNow, step, structureAt } from "../games/zid/sim.js";

const cfg = baseConfig;
const DT = 1 / 30;

/** A buildable tile, an outside tile and a rock tile, found from config rather than hard-coded. */
function tiles() {
  const { cols, rows } = gridSize(cfg);
  let outside: [number, number] | null = null;
  for (let r = 0; r < rows && !outside; r++) {
    for (let c = 0; c < cols && !outside; c++) if (tileStatus(cfg, c, r) === "outside-perimeter") outside = [c, r];
  }
  const rock = cfg.construction.invalidTerrain[0]!;
  const b = buildableTiles(cfg)[0]!;
  return { buildable: [b.col, b.row] as [number, number], outside: outside!, rock };
}

test("grid: tiles are large enough for touch", () => {
  // 44 CSS px minimum on a 412 px-wide phone showing a 720-unit-wide world.
  const cssPx = cfg.construction.tileSize * (412 / cfg.world.width);
  assert.ok(cssPx >= 44, `tile is ${cssPx.toFixed(1)} CSS px`);
});

test("grid: the perimeter is a custom shape, not a rectangle", () => {
  assert.ok(cfg.construction.perimeter.length > 4);
  // Same row, same distance from centre, different status = not a simple box.
  const { rows, cols } = gridSize(cfg);
  let irregular = false;
  for (let r = 0; r < rows; r++) {
    const inRow = Array.from({ length: cols }, (_, c) => tileStatus(cfg, c, r) !== "outside-perimeter");
    const first = inRow.indexOf(true);
    const last = inRow.lastIndexOf(true);
    if (first !== -1 && first !== cols - 1 - last) irregular = true;
  }
  assert.ok(irregular, "the boundary is not symmetric in every row");
});

test("grid: the stronghold sits inside the boundary and its tiles are not buildable", () => {
  const sh = cfg.stronghold;
  assert.ok(pointInPolygon(sh.x, sh.y, cfg.construction.perimeter));
  const t = tileAt(cfg, sh.x, sh.y)!;
  assert.equal(tileStatus(cfg, t.col, t.row), "invalid-terrain");
});

test("grid: tileAt and tileCenter agree", () => {
  for (const t of buildableTiles(cfg)) {
    const c = tileCenter(cfg, t.col, t.row);
    assert.deepEqual(tileAt(cfg, c.x, c.y), t);
  }
  assert.equal(tileAt(cfg, -1, 10), null);
  assert.equal(tileAt(cfg, 10, cfg.world.height + 1), null);
});

test("construction: valid placement anywhere buildable, not just the old mounts", () => {
  const s = createState(cfg, 1);
  const { buildable } = tiles();
  const res = buildTurret(s, cfg, ...buildable);
  assert.equal(res.ok, true);
  const st = structureAt(s, ...buildable)!;
  assert.deepEqual(tileCenter(cfg, ...buildable), { x: st.x, y: st.y });
  assert.equal(s.currency, cfg.economy.startCurrency - cfg.turret.cost);
});

test("construction: outside-boundary, invalid-terrain and off-grid are rejected with no deduction", () => {
  const s = createState(cfg, 1);
  const { outside, rock } = tiles();
  const c0 = s.currency;
  assert.deepEqual(buildTurret(s, cfg, ...outside), { ok: false, reason: "outside-perimeter" });
  assert.deepEqual(buildTurret(s, cfg, rock[0], rock[1]), { ok: false, reason: "invalid-terrain" });
  const sh = tileAt(cfg, cfg.stronghold.x, cfg.stronghold.y)!;
  assert.deepEqual(buildTurret(s, cfg, sh.col, sh.row), { ok: false, reason: "invalid-terrain" });
  assert.deepEqual(buildTurret(s, cfg, -1, 0), { ok: false, reason: "out-of-bounds" });
  assert.deepEqual(buildTurret(s, cfg, 1.5, 3), { ok: false, reason: "out-of-bounds" });
  assert.equal(s.currency, c0);
  assert.equal(s.structures.length, 0);
});

test("construction: an occupied tile cannot be reused", () => {
  const s = createState(cfg, 1);
  const { buildable } = tiles();
  buildTurret(s, cfg, ...buildable);
  const c = s.currency;
  assert.deepEqual(buildTurret(s, cfg, ...buildable), { ok: false, reason: "occupied" });
  assert.equal(s.currency, c);
  assert.equal(s.structures.length, 1);
});

test("construction: refused during an assault, allowed again in the next prep", () => {
  const s = createState(cfg, 4);
  const [a, b, c] = buildableTiles(cfg);
  buildTurret(s, cfg, a!.col, a!.row);
  startWaveNow(s, cfg);
  const before = s.currency;
  assert.deepEqual(buildTurret(s, cfg, b!.col, b!.row), { ok: false, reason: "assault-active" });
  assert.equal(s.currency, before);
  s.enemies = [];
  s.nextSpawn = s.spawns.length; // end the wave
  step(s, cfg, DT);
  assert.equal(s.phase, "prep");
  s.currency = cfg.turret.cost;
  assert.equal(buildTurret(s, cfg, c!.col, c!.row).ok, true);
});

test("construction: checkBuild is a pure preview that matches buildTurret", () => {
  const s = createState(cfg, 1);
  const before = JSON.stringify(s);
  for (const t of buildableTiles(cfg).slice(0, 5)) assert.equal(checkBuild(s, cfg, t.col, t.row), null);
  assert.equal(JSON.stringify(s), before, "checkBuild changes nothing");
  s.currency = 0;
  const t = buildableTiles(cfg)[0]!;
  assert.equal(checkBuild(s, cfg, t.col, t.row), "insufficient-funds");
  assert.deepEqual(buildTurret(s, cfg, t.col, t.row), { ok: false, reason: "insufficient-funds" });
});

test("construction: many turrets can be placed, limited only by space and supplies", () => {
  const s = createState(cfg, 1);
  s.currency = 1e6;
  let built = 0;
  for (const t of buildableTiles(cfg)) if (buildTurret(s, cfg, t.col, t.row).ok) built++;
  assert.equal(built, buildableTiles(cfg).length);
  assert.ok(built > 20, `only ${built} buildable tiles`);
  assert.equal(new Set(s.structures.map((st) => `${st.col},${st.row}`)).size, built, "no tile reused");
  assert.equal(s.currency, 1e6 - built * cfg.turret.cost);
});
