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
import { tileAt, tileStatus } from "./grid.js";
import { buildTurret, createState, startWaveNow, step, type GameState } from "./sim.js";
import { createStressRun } from "./stress.js";
import { BUILD_MESSAGES, draw, uiRegions, type ViewState } from "./view.js";

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
const view: ViewState = { toast: null, selected: null };
let showDiag = params.has("diag") || stress;

function newRun(): GameState {
  const seed = fixedSeed ?? (Date.now() & 0x7fffffff);
  return stress ? createStressRun(cfg, seed) : createState(cfg, seed);
}

function toast(text: string): void {
  view.toast = { text, until: state.time + 1.6 };
}

const regions = uiRegions(cfg, () => state, () => view, {
  startNow: () => startWaveNow(state, cfg),
  confirmBuild: () => {
    const sel = view.selected;
    if (!sel) return;
    // The simulation validates again; the panel's state is only a preview.
    const res = buildTurret(state, cfg, sel.col, sel.row);
    if (res.ok) view.selected = null;
    else toast(BUILD_MESSAGES[res.reason]);
  },
  cancelSelection: () => {
    view.selected = null;
  },
  restart: () => {
    state = newRun();
    view.toast = null;
    view.selected = null;
  },
  toggleDiagnostics: () => {
    showDiag = !showDiag;
  },
});

bindTaps(canvas, renderer.toWorld, (p) => {
  routeTap(p, regions, (wp) => {
    // World tap: choose a tile. Building happens only after "Build" is pressed.
    const tile = tileAt(cfg, wp.x, wp.y);
    const status = tile ? tileStatus(cfg, tile.col, tile.row) : "out-of-bounds";
    if (state.phase === "wave") {
      if (status !== "out-of-bounds" && status !== "outside-perimeter") toast(BUILD_MESSAGES["assault-active"]);
      return;
    }
    if (state.phase === "lost") return;
    if (!tile || status === "out-of-bounds" || status === "outside-perimeter") {
      view.selected = null;
      return;
    }
    view.selected = tile;
  });
});

const loop = createLoop({
  stepHz: 30,
  update: (dt) => {
    step(state, cfg, dt);
    if (state.phase === "wave" || state.phase === "lost") view.selected = null;
  },
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
