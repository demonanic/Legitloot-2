import { test } from "node:test";
import assert from "node:assert/strict";
import { createTapRecognizer, rectRegion, routeTap } from "../engine/input/input.js";
import { bindVisibility, createLoop } from "../engine/loop/loop.js";
import { fitViewport, screenToWorld } from "../engine/render/render.js";

function manualLoop(stepHz = 30) {
  let clock = 0;
  let updates = 0;
  let renders = 0;
  const loop = createLoop({
    stepHz,
    update: () => {
      updates++;
    },
    render: () => {
      renders++;
    },
    now: () => clock,
    requestFrame: () => 0,
    cancelFrame: () => {},
  });
  return {
    loop,
    get updates() {
      return updates;
    },
    get renders() {
      return renders;
    },
    at(t: number) {
      clock = t;
      loop.frame(t);
    },
    setClock(t: number) {
      clock = t;
    },
  };
}

test("loop: simulation rate is fixed regardless of frame rate", () => {
  const a = manualLoop();
  a.loop.start();
  for (let t = 1; t <= 120; t++) a.at(t * (1000 / 120)); // 1 s at 120 FPS
  const b = manualLoop();
  b.loop.start();
  for (let t = 1; t <= 24; t++) b.at(t * (1000 / 24)); // 1 s at 24 FPS
  assert.ok(Math.abs(a.updates - 30) <= 1, `120 FPS gave ${a.updates} steps`);
  assert.ok(Math.abs(b.updates - 30) <= 1, `24 FPS gave ${b.updates} steps`);
  assert.equal(a.renders, 120);
  assert.equal(b.renders, 24);
});

test("loop: a long gap is dropped, not caught up in a burst", () => {
  const h = manualLoop();
  h.loop.start();
  h.at(33.4);
  const before = h.updates;
  h.at(33.4 + 60_000); // 60 s stall
  assert.ok(h.updates - before <= 1, `stall produced ${h.updates - before} steps`);
  assert.equal(h.loop.stats.clampedFrames, 1);
});

test("loop: slow frames are capped per frame", () => {
  const h = manualLoop();
  h.loop.start();
  h.at(240); // just under the gap threshold: 7 steps owed, cap is 5
  assert.equal(h.loop.stats.stepsLastFrame, 5);
});

test("loop: paused time is never simulated", () => {
  const h = manualLoop();
  h.loop.start();
  for (let t = 1; t <= 30; t++) h.at(t * 33.34);
  const steps = h.updates;
  h.loop.pause();
  assert.equal(h.loop.state, "paused");
  h.at(5000); // ignored while paused
  assert.equal(h.updates, steps);
  h.setClock(60_000);
  h.loop.resume();
  h.at(60_000 + 33.34);
  assert.ok(h.updates - steps <= 1);
});

test("visibility: hidden pauses, visible resumes", () => {
  const h = manualLoop();
  h.loop.start();
  let listener: (() => void) | null = null;
  const doc = {
    visibilityState: "visible",
    addEventListener: (_: "visibilitychange", cb: () => void) => {
      listener = cb;
    },
    removeEventListener: () => {},
  };
  bindVisibility(h.loop, doc);
  doc.visibilityState = "hidden";
  listener!();
  assert.equal(h.loop.state, "paused");
  doc.visibilityState = "visible";
  listener!();
  assert.equal(h.loop.state, "running");
});

test("input: a tap on UI never reaches the world", () => {
  let world = 0;
  let ui = 0;
  const regions = [rectRegion("button", { x: 0, y: 0, w: 100, h: 50 }, () => void ui++)];
  assert.deepEqual(routeTap({ x: 50, y: 25 }, regions, () => world++), { kind: "ui", id: "button" });
  assert.equal(ui, 1);
  assert.equal(world, 0);
  assert.deepEqual(routeTap({ x: 150, y: 25 }, regions, () => world++), { kind: "world" });
  assert.equal(world, 1);
});

test("input: topmost region wins; disabled regions are skipped", () => {
  const hits: string[] = [];
  let on = false;
  const regions = [
    rectRegion("under", { x: 0, y: 0, w: 100, h: 100 }, () => void hits.push("under")),
    rectRegion("over", { x: 0, y: 0, w: 100, h: 100 }, () => void hits.push("over"), () => on),
  ];
  routeTap({ x: 10, y: 10 }, regions, () => hits.push("world"));
  on = true;
  routeTap({ x: 10, y: 10 }, regions, () => hits.push("world"));
  assert.deepEqual(hits, ["under", "over"]);
});

test("input: drags and long presses are not taps", () => {
  const taps: number[][] = [];
  const r = createTapRecognizer((x, y) => taps.push([x, y]));
  r.down({ id: 1, x: 10, y: 10, t: 0 });
  r.up({ id: 1, x: 12, y: 11, t: 100 });
  r.down({ id: 2, x: 10, y: 10, t: 0 });
  r.move({ id: 2, x: 60, y: 10, t: 50 });
  r.up({ id: 2, x: 60, y: 10, t: 100 });
  r.down({ id: 3, x: 10, y: 10, t: 0 });
  r.up({ id: 3, x: 10, y: 10, t: 900 });
  r.down({ id: 4, x: 10, y: 10, t: 0 });
  r.cancel({ id: 4, x: 10, y: 10, t: 10 });
  r.up({ id: 4, x: 10, y: 10, t: 20 });
  assert.deepEqual(taps, [[12, 11]]);
});

test("render: viewport letterboxes and round-trips coordinates", () => {
  const v = fitViewport(720, 1280, 412, 915); // portrait phone
  assert.ok(Math.abs(v.scale - 412 / 720) < 1e-9);
  assert.equal(v.offsetX, 0);
  assert.ok(v.offsetY > 0);
  const w = screenToWorld(v, { x: 206, y: 915 / 2 });
  assert.ok(Math.abs(w.x - 360) < 1e-6 && Math.abs(w.y - 640) < 1e-6);
  const land = fitViewport(720, 1280, 2000, 900); // landscape: pillarboxed
  assert.equal(land.offsetY, 0);
  assert.ok(land.offsetX > 0);
});
