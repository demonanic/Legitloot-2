/**
 * Browser entry point: the game, playable offline.
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
import { forgivingTile, overlapsStronghold, tileStatus } from "./grid.js";
import type { PanelAction } from "./panel.js";
import {
  activateBoost,
  aimMortars,
  collectPickup,
  pickupAt,
  buildStructure,
  createState,
  recycleStructure,
  reinforceBarricade,
  repair,
  startWaveNow,
  step,
  structureAt,
  sendTruck,
  useSalvage,
  upgradeBase,
  upgradeTurret,
  type GameState,
  type ManageResult,
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
// The build menu remembers its last page, so placing several traps in a row is quick.
function savedRanges(): boolean {
  try {
    return localStorage.getItem("zid.ranges") !== "off";
  } catch {
    return true;
  }
}
/** The permanent Salvage stockpile lives in the browser, so it survives defeat and closing the page. */
function loadSalvage(): number {
  try {
    const n = Number(localStorage.getItem("zid.salvage"));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}
function saveSalvage(n: number): void {
  try {
    localStorage.setItem("zid.salvage", String(n));
  } catch {
    // Storage unavailable: the stockpile just lasts for this visit.
  }
}
const view: ViewState = { toast: null, selected: null, recycleArmedUntil: 0, buildPage: "weapons", showRanges: savedRanges(), salvage: loadSalvage() };
/** Salvage this run has already added to the stockpile. */
let salvageSaved = 0;
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

function report(res: ManageResult): void {
  if (!res.ok) toast(MANAGE_MESSAGES[res.reason]);
}

/** Every menu action goes through a validated simulation command. */
function runPanelAction(action: PanelAction): void {
  const sel = view.selected;
  if (!sel) return;
  const st = selectedStructure();
  if (action.kind !== "recycle") view.recycleArmedUntil = 0;
  switch (action.kind) {
    case "close":
      view.selected = null;
      return;
    case "page":
      view.buildPage = action.page;
      return;
    case "build": {
      const res = buildStructure(state, cfg, action.structure, sel.col, sel.row);
      if (res.ok) view.selected = null;
      else toast(BUILD_MESSAGES[res.reason]);
      return;
    }
    case "upgrade":
      if (st) report(upgradeTurret(state, cfg, st.id, action.path));
      return;
    case "send-truck": {
      const res = sendTruck(state, cfg);
      if (res.ok) toast("Salvage run paid for · the truck leaves when the wave starts");
      else if (res.reason === "insufficient-funds") toast(MANAGE_MESSAGES["insufficient-funds"]);
      return;
    }
    case "upgrade-base":
      report(upgradeBase(state, cfg));
      return;
    case "reinforce":
      if (st) report(reinforceBarricade(state, cfg, st.id));
      return;
    case "repair":
      report(repair(state, cfg, st ? { kind: "structure", id: st.id } : { kind: "stronghold" }));
      return;
    case "recycle": {
      if (!st) return;
      // Destructive: require a second tap within 3 seconds.
      if (view.recycleArmedUntil <= state.time) {
        view.recycleArmedUntil = state.time + 3;
        return;
      }
      view.recycleArmedUntil = 0;
      const res = recycleStructure(state, cfg, st.id);
      if (res.ok) view.selected = null;
      else report(res);
      return;
    }
  }
}

const regions = uiRegions(cfg, () => state, () => view, {
  startNow: () => startWaveNow(state, cfg),
  useSalvage: () => {
    const spent = useSalvage(state, cfg, view.salvage);
    if (spent > 0) {
      view.salvage -= spent;
      saveSalvage(view.salvage);
      toast(`+${spent * cfg.salvage.suppliesPerSalvage} Supplies from your Salvage`);
    }
  },
  boost: (kind) => {
    const res = activateBoost(state, cfg, kind);
    if (!res.ok) {
      if (res.reason === "locked") toast("Upgrade the base to unlock");
      return;
    }
    toast(
      kind === "overdrive"
        ? "Overdrive! Weapons fire twice as fast"
        : kind === "bounty"
          ? `Bounty! Kills pay ×${cfg.boost.bounty.drops}`
          : kind === "airstrike"
            ? "Airstrike inbound!"
            : "Force field up! The base is safe and healing",
    );
  },
  panel: (action) => runPanelAction(action),
  restart: () => {
    state = newRun();
    salvageSaved = 0;
    view.toast = null;
    view.selected = null;
    view.recycleArmedUntil = 0;
  },
  toggleRanges: () => {
    view.showRanges = !view.showRanges;
    try {
      localStorage.setItem("zid.ranges", view.showRanges ? "on" : "off");
    } catch {
      // Storage unavailable: the choice just lasts for this visit.
    }
  },
  toggleDiagnostics: () => {
    showDiag = !showDiag;
  },
});

bindTaps(canvas, renderer.toWorld, (p) => {
  routeTap(p, regions, (wp) => {
    // World tap: choose a tile. Building happens only after "Build" is pressed.
    // Forgiving: a tap just outside a usable tile still picks it.
    const tile = forgivingTile(cfg, wp.x, wp.y, (c, r) => !!structureAt(state, c, r) || overlapsStronghold(cfg, c, r));
    const status = tile ? tileStatus(cfg, tile.col, tile.row) : "out-of-bounds";
    // Pickups come first: a tap on one collects it and does nothing else.
    const pickup = pickupAt(state, cfg, wp.x, wp.y);
    if (pickup) {
      const got = collectPickup(state, cfg, pickup.id);
      if (got.ok && got.kind === "health") toast(`Stronghold +${got.amount} health`);
      return;
    }
    if (state.phase === "wave") {
      // Tapping the stronghold or something you built opens emergency repairs.
      if (tile && (structureAt(state, tile.col, tile.row) || overlapsStronghold(cfg, tile.col, tile.row))) {
        view.selected = tile;
        return;
      }
      view.selected = null;
      // With mortars on the field, each tap aims one mortar (split fire);
      // tapping a crosshair hands that mortar back to automatic.
      if (state.structures.some((st) => st.kind === "mortar" && !st.destroyed)) {
        const res = aimMortars(state, cfg, wp);
        if (res.ok && res.action === "freed") toast("Mortar back on automatic");
        else if (!res.ok && res.reason === "out-of-reach") toast("No mortar can reach there");
        return;
      }
      if (status !== "out-of-bounds" && status !== "outside-perimeter") toast(BUILD_MESSAGES["assault-active"]);
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
    // Bank Salvage the moment a haul is unloaded, so it is safe whatever happens next.
    if (!stress && state.salvageBanked > salvageSaved) {
      view.salvage += state.salvageBanked - salvageSaved;
      salvageSaved = state.salvageBanked;
      saveSalvage(view.salvage);
    }
    if (state.phase === "lost") view.selected = null;
    else if (state.phase === "wave" && view.selected) {
      // Only things that can be repaired stay selected once the assault starts.
      const t = view.selected;
      if (!structureAt(state, t.col, t.row) && !overlapsStronghold(cfg, t.col, t.row)) view.selected = null;
    }
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
