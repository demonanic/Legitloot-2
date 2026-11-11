/**
 * Browser entry point for Milestone 1: one wave, playable offline.
 *
 * URL options:
 *   ?seed=123   fixed spawn layout
 *   ?stress     performance test (50 walkers, ~100 projectiles)
 *   ?diag       open the diagnostics overlay on load
 */

import { bindTaps, routeTap } from "../../engine/input/input.js";
import { bindVisibility, createLoop } from "../../engine/loop/loop.js";
import { createRenderer } from "../../engine/render/render.js";
import { baseConfig, stressConfig } from "./config.js";
import { buildTurret, createState, slotAt, startWaveNow, step, type BuildResult, type GameState } from "./sim.js";
import { draw, uiRegions, type ViewState } from "./view.js";

const params = new URLSearchParams(location.search);
const stress = params.has("stress");
const cfg = stress ? stressConfig() : baseConfig;
const seedParam = Number(params.get("seed"));
const fixedSeed = Number.isFinite(seedParam) && params.has("seed") ? seedParam : null;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const diagEl = document.getElementById("diag") as HTMLElement;
const renderer = createRenderer(canvas, {
  worldWidth: cfg.world.width,
  worldHeight: cfg.world.height,
  background: "#0d0e0d",
});

let state: GameState = newRun();
const view: ViewState = { toast: null };
let showDiag = params.has("diag") || stress;

function newRun(): GameState {
  const seed = fixedSeed ?? (Date.now() & 0x7fffffff);
  const s = createState(cfg, seed);
  if (stress) {
    for (const sl of s.slots) buildTurret(s, { ...cfg, turret: { ...cfg.turret, cost: 0 } }, sl.id);
  }
  return s;
}

const REASONS: Record<Exclude<BuildResult, { ok: true }>["reason"], string> = {
  "insufficient-funds": `Not enough ${cfg.currencyLabel.toLowerCase()}`,
  occupied: "That mount already has a turret",
  "no-such-slot": "Nothing to build there",
  "run-over": "The run is over",
  "assault-active": "Build between waves",
};

const regions = uiRegions(cfg, () => state, {
  startNow: () => startWaveNow(state, cfg),
  restart: () => {
    state = newRun();
    view.toast = null;
  },
  toggleDiagnostics: () => {
    showDiag = !showDiag;
  },
});

bindTaps(canvas, renderer.toWorld, (p) => {
  routeTap(p, regions, (wp) => {
    const slot = slotAt(state, wp.x, wp.y, cfg.turret.radius + 26);
    if (!slot) return;
    const res = buildTurret(state, cfg, slot.id);
    if (!res.ok) view.toast = { text: REASONS[res.reason], until: state.time + 1.6 };
  });
});

const loop = createLoop({
  stepHz: 30,
  update: (dt) => step(state, cfg, dt),
  render: () => {
    renderer.beginFrame();
    draw(renderer.ctx, state, cfg, view, showDiag);
  },
});

let diagTimer = 0;
function updateDiagnostics(): void {
  diagEl.hidden = !showDiag;
  if (!showDiag) return;
  const st = loop.stats;
  diagEl.textContent =
    `FPS ${st.fps.toFixed(0)}  sim ${st.stepMs.toFixed(2)} ms/step\n` +
    `entities ${state.enemies.length} walkers  ${state.projectiles.length} shots\n` +
    `steps ${st.totalSteps}  clamped ${st.clampedFrames}  ${loop.state}` +
    (stress ? "\nSTRESS TEST" : "");
}
diagTimer = window.setInterval(updateDiagnostics, 250);

window.addEventListener("resize", () => renderer.resize());
bindVisibility(loop, document);
loop.start();

// Exposed for automated browser checks only; not a gameplay API.
(window as unknown as { __zid: unknown }).__zid = {
  get state() {
    return state;
  },
  loop,
  diagTimer,
};
