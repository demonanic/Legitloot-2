import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, stressConfig } from "../games/zid/config.js";
import { buildTurret, createState, startWaveNow, step } from "../games/zid/sim.js";
import { createStressRun } from "../games/zid/stress.js";

const DT = 1 / 30;

test("stress: turrets are built legally in prep, then the assault starts", () => {
  const cfg = stressConfig();
  const s = createStressRun(cfg, 1);
  assert.equal(s.phase, "wave");
  assert.equal(s.slots.filter((sl) => sl.turret).length, s.slots.length);
});

test("stress: reaches 50 walkers and at least 100 projectiles at once", () => {
  const cfg = stressConfig();
  const s = createStressRun(cfg, 1);
  let maxWalkers = 0;
  let maxShots = 0;
  for (let i = 0; i < 30 * 10; i++) {
    step(s, cfg, DT);
    maxWalkers = Math.max(maxWalkers, s.enemies.length);
    maxShots = Math.max(maxShots, s.projectiles.length);
  }
  assert.equal(maxWalkers, 50);
  assert.ok(maxShots >= 100, `peak projectiles ${maxShots}`);
  assert.ok(maxShots <= cfg.limits.maxProjectiles, "projectile cap respected");
  assert.equal(s.enemies.length, 50, "walkers survive, so the load is sustained");
});

test("stress setup does not weaken the normal assault build lock", () => {
  const s = createState(baseConfig, 1);
  startWaveNow(s, baseConfig);
  assert.deepEqual(buildTurret(s, baseConfig, "west"), { ok: false, reason: "assault-active" });
  const t = createStressRun(stressConfig(), 2);
  t.slots[0]!.turret = null;
  assert.deepEqual(buildTurret(t, stressConfig(), t.slots[0]!.id), { ok: false, reason: "assault-active" });
});
