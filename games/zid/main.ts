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
import {
  buildTurret,
  createState,
  recycleStructure,
  startWaveNow,
  step,
  structureAt,
  upgradeTurret,
  type GameState,
  type UpgradePathId,
} from "./sim.js";
import { createStressRun } from "./stress.js";
import { BUILD_MESSAGES, MANAGE_MESSAGES, draw, uiRegions, type ViewState } from "./view.js";

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
const view: ViewState = { toast: null, selected: null, recycleArmedUntil: 0 };
let showDiag = params.has("diag") || stress;

function newRun(): GameState {
  const seed = fixedSeed ?? (Date.now() & 0x7fffffff);
  return stress ? createStressRun(cfg, seed) : createState(cfg, seed);
}

function toast(text: string): void {
  view.toast = { text, until: state.time + 1.6 };
}

function selectedStructure() {
  const sel = view.selected;
  return sel ? structureAt(state, sel.col, sel.row) : null;
}

function upgrade(path: UpgradePathId): void {
  const st = selectedStructure();
  if (!st) return;
  const res = upgradeTurret(state, cfg, st.id, path);
  if (!res.ok) toast(MANAGE_MESSAGES[res.reason]);
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
    view.recycleArmedUntil = 0;
  },
  upgradeSpeed: () => upgrade("speed"),
  upgradeStrength: () => upgrade("strength"),
  recycle: () => {
    const st = selectedStructure();
    if (!st) return;
    // Destructive and unrefunded: require a second tap within 3 seconds.
    if (view.recycleArmedUntil <= state.time) {
      view.recycleArmedUntil = state.time + 3;
      return;
    }
    view.recycleArmedUntil = 0;
    const res = recycleStructure(state, cfg, st.id);
    if (res.ok) view.selected = null;
    else toast(MANAGE_MESSAGES[res.reason]);
  },
  restart: () => {
    state = newRun();
    view.toast = null;
    view.selected = null;
    view.recycleArmedUntil = 0;
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
      if (tile && structureAt(state, tile.col, tile.row)) toast(MANAGE_MESSAGES["assault-active"]);
      else if (status !== "out-of-bounds" && status !== "outside-perimeter") toast(BUILD_MESSAGES["assault-active"]);
      return;
    }
    if (state.phase === "lost") return;
    if (!tile || status === "out-of-bounds" || status === "outside-perimeter") {
      view.selected = null;
      return;
    }
    if (view.selected?.col !== tile.col || view.selected?.row !== tile.row) view.recycleArmedUntil = 0;
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
