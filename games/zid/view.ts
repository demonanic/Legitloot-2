/**
 * Drawing and on-canvas UI. Placeholder art only: flat shapes
 * in neutral colours until the comic-book art exists.
 */

import { rectRegion, type UiRegion } from "../../engine/input/input.js";
import type { GameConfig } from "./config.js";
import { buildableTiles, gridSize, tileCenter, type Tile } from "./grid.js";
import { panelModel, type PanelAction, type PanelSlot } from "./panel.js";
import { remainingEnemies, structureAt, type BuildRejection, type GameState, type ManageRejection } from "./sim.js";

const C = {
  ground: "#1c1e1b",
  grid: "#242723",
  stronghold: "#585d55",
  strongholdEdge: "#8b9086",
  slotEmpty: "#8b9086",
  perimeter: "#c9b98a",
  buildable: "rgba(241,238,227,0.06)",
  buildableEdge: "rgba(241,238,227,0.16)",
  rock: "#3a3d38",
  rockEdge: "#5b5f57",
  turret: "#a9b0a5",
  barricade: "#7b6a4f",
  barricadeEdge: "#b39a6e",
  rubble: "#4d4a44",
  barrel: "#d7dcd3",
  walker: "#6e7b5b",
  walkerEdge: "#2f3527",
  walkerAttack: "#9c4a3c",
  runner: "#a9b88e",
  brute: "#3f4a33",
  bullet: "#e9d68d",
  hudBg: "rgba(10,11,10,0.72)",
  text: "#eef0ea",
  quiet: "#a3a89f",
  good: "#8fc06b",
  bad: "#d0584a",
  warn: "#e2b04a",
  button: "#eef0ea",
  buttonText: "#151614",
};

export interface Toast {
  text: string;
  until: number;
}

export interface ViewState {
  toast: Toast | null;
  /** Tile chosen for construction or management, awaiting a choice. UI state only. */
  selected: Tile | null;
  /** Recycle needs a second tap before this game time. */
  recycleArmedUntil: number;
}

export const MANAGE_MESSAGES: Record<ManageRejection, string> = {
  "run-over": "The run is over",
  "assault-active": "Upgrade and repair between waves",
  "no-such-structure": "Nothing there",
  "not-a-turret": "Only turrets can be upgraded",
  "not-a-barricade": "Only barricades can be reinforced",
  destroyed: "Rebuild it first",
  "nothing-to-repair": "Already at full health",
  "max-level": "Already at max level",
  "insufficient-funds": "Not enough supplies",
};

/** Player-facing text for each build rejection. */
export const BUILD_MESSAGES: Record<BuildRejection, string> = {
  "run-over": "The run is over",
  "assault-active": "Build between waves",
  "out-of-bounds": "Nothing to build there",
  "outside-perimeter": "Build inside the fence",
  "invalid-terrain": "Can't build on that ground",
  occupied: "That tile is taken",
  "insufficient-funds": "Not enough supplies",
};

export interface UiActions {
  startNow(): void;
  /** Run a bottom-menu action for the selected tile. */
  panel(action: PanelAction): void;
  restart(): void;
  toggleDiagnostics(): void;
}

/** Fixed button rectangles in world units, shared by drawing and hit tests. */
export function buttonRects(cfg: GameConfig) {
  const w = cfg.world.width;
  const h = cfg.world.height;
  return {
    startNow: { x: w / 2 - 150, y: h - 132, w: 300, h: 76 },
    slots: {
      a0: { x: 40, y: h - 316, w: 310, h: 76 },
      b0: { x: 370, y: h - 316, w: 310, h: 76 },
      a1: { x: 40, y: h - 224, w: 310, h: 76 },
      b1: { x: 370, y: h - 224, w: 310, h: 76 },
      close: { x: 460, y: h - 132, w: 220, h: 76 },
    } satisfies Record<PanelSlot, { x: number; y: number; w: number; h: number }>,
    /** Backing behind the bottom menu; blocks taps on tiles underneath. */
    panel: { x: 0, y: h - 400, w, h: 400 },
    restart: { x: w / 2 - 150, y: h / 2 + 150, w: 300, h: 84 },
    diagnostics: { x: w - 104, y: 14, w: 90, h: 50 },
  };
}

export function uiRegions(cfg: GameConfig, getState: () => GameState, getView: () => ViewState, act: UiActions): UiRegion[] {
  const r = buttonRects(cfg);
  const over = () => getState().phase === "lost";
  const selecting = () => getView().selected !== null && !over();
  const buttonIn = (slot: PanelSlot) => {
    const sel = getView().selected;
    if (!sel) return null;
    return panelModel(getState(), cfg, sel).buttons.find((b) => b.slot === slot) ?? null;
  };
  const slotRegion = (slot: PanelSlot) =>
    rectRegion(
      `panel-${slot}`,
      r.slots[slot],
      () => {
        const b = buttonIn(slot);
        if (b && b.enabled) act.panel(b.action);
      },
      () => selecting() && buttonIn(slot) !== null,
    );
  return [
    rectRegion("panel", r.panel, () => true, selecting),
    rectRegion("start-now", r.startNow, () => act.startNow(), () => getState().phase === "prep" && !selecting()),
    slotRegion("a0"),
    slotRegion("b0"),
    slotRegion("a1"),
    slotRegion("b1"),
    slotRegion("close"),
    rectRegion("diagnostics", r.diagnostics, () => act.toggleDiagnostics()),
    // While the end screen is up it blocks all world taps; only its button acts.
    rectRegion("end-screen", { x: 0, y: 0, w: cfg.world.width, h: cfg.world.height }, () => true, over),
    rectRegion("restart", r.restart, () => act.restart(), over),
  ];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function button(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  label: string,
  style: "primary" | "secondary" | "disabled" = "primary",
): void {
  ctx.fillStyle = style === "primary" ? C.button : style === "disabled" ? "#4a4d47" : "#2a2c29";
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
  ctx.fill();
  if (style === "secondary") {
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = style === "primary" ? C.buttonText : style === "disabled" ? "#9a9e96" : C.text;
  ctx.font = `800 ${label.length > 16 ? 26 : 30}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string): void {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function draw(ctx: CanvasRenderingContext2D, s: GameState, cfg: GameConfig, view: ViewState, showDiag: boolean): void {
  const W = cfg.world.width;
  const H = cfg.world.height;

  // Ground and grid.
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, W, H);
  const T = cfg.construction.tileSize;
  const { cols, rows } = gridSize(cfg);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= cols; c++) {
    ctx.moveTo(c * T, 0);
    ctx.lineTo(c * T, H);
  }
  for (let r = 0; r <= rows; r++) {
    ctx.moveTo(0, r * T);
    ctx.lineTo(W, r * T);
  }
  ctx.stroke();

  // Buildable tiles, shown while building is allowed.
  const building = s.phase === "prep" || s.phase === "warning";
  if (building) {
    for (const t of buildableTiles(cfg)) {
      if (structureAt(s, t.col, t.row)) continue;
      ctx.fillStyle = C.buildable;
      ctx.fillRect(t.col * T + 3, t.row * T + 3, T - 6, T - 6);
      ctx.strokeStyle = C.buildableEdge;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(t.col * T + 3, t.row * T + 3, T - 6, T - 6);
    }
  }

  // Invalid terrain (placeholder rocks).
  for (const [col, row] of cfg.construction.invalidTerrain) {
    const c = tileCenter(cfg, col, row);
    ctx.fillStyle = C.rock;
    ctx.strokeStyle = C.rockEdge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c.x - 26, c.y + 18);
    ctx.lineTo(c.x - 18, c.y - 14);
    ctx.lineTo(c.x + 4, c.y - 24);
    ctx.lineTo(c.x + 26, c.y - 6);
    ctx.lineTo(c.x + 22, c.y + 20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Property boundary.
  const per = cfg.construction.perimeter;
  ctx.strokeStyle = C.perimeter;
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 10]);
  ctx.beginPath();
  per.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Turret range rings, faint, so coverage reads.
  ctx.strokeStyle = "rgba(233,214,141,0.08)";
  ctx.lineWidth = 2;
  for (const st of s.structures) {
    if (!st.turret || st.destroyed) continue;
    ctx.beginPath();
    ctx.arc(st.x, st.y, cfg.turret.range, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Selected tile and a preview of what would be built.
  const sel = view.selected;
  const selStructure = sel ? structureAt(s, sel.col, sel.row) : null;
  const model = sel && s.phase !== "lost" ? panelModel(s, cfg, sel) : null;
  const selReason = model?.note ?? null;
  if (sel && selStructure && s.phase !== "lost") {
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 4;
    ctx.strokeRect(sel.col * T + 2, sel.row * T + 2, T - 4, T - 4);
    ctx.strokeStyle = "rgba(241,238,227,0.4)";
    ctx.lineWidth = 2;
    if (selStructure.turret && !selStructure.destroyed) {
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(selStructure.x, selStructure.y, cfg.turret.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else if (sel && model?.target.kind === "tile" && s.phase !== "lost") {
    const c = tileCenter(cfg, sel.col, sel.row);
    const ok = selReason === null;
    ctx.strokeStyle = ok ? C.good : C.warn;
    ctx.lineWidth = 4;
    ctx.strokeRect(sel.col * T + 2, sel.row * T + 2, T - 4, T - 4);
    if (ok) {
      ctx.strokeStyle = "rgba(143,192,107,0.45)";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, cfg.turret.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = C.turret;
      ctx.beginPath();
      ctx.arc(c.x, c.y, cfg.turret.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Stronghold.
  const sh = s.stronghold;
  ctx.fillStyle = C.stronghold;
  ctx.strokeStyle = C.strongholdEdge;
  ctx.lineWidth = 4;
  ctx.fillRect(sh.x - sh.halfSize, sh.y - sh.halfSize, sh.halfSize * 2, sh.halfSize * 2);
  ctx.strokeRect(sh.x - sh.halfSize, sh.y - sh.halfSize, sh.halfSize * 2, sh.halfSize * 2);
  bar(ctx, sh.x - 70, sh.y - sh.halfSize - 26, 140, 12, sh.hp / sh.maxHp, sh.hp / sh.maxHp > 0.35 ? C.good : C.bad);

  // Structures: rubble, barricades, turrets.
  for (const sl of s.structures) {
    if (sl.destroyed) {
      ctx.fillStyle = C.rubble;
      ctx.strokeStyle = C.rockEdge;
      ctx.lineWidth = 2;
      for (const [dx, dy, r] of [[-14, 8, 12], [10, 12, 10], [2, -10, 13], [16, -6, 7]] as const) {
        ctx.beginPath();
        ctx.arc(sl.x + dx, sl.y + dy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      continue;
    }
    if (!sl.turret) {
      const half = T / 2 - 8;
      ctx.fillStyle = C.barricade;
      ctx.strokeStyle = C.barricadeEdge;
      ctx.lineWidth = 3 + sl.reinforce * 2;
      ctx.fillRect(sl.x - half, sl.y - half, half * 2, half * 2);
      ctx.strokeRect(sl.x - half, sl.y - half, half * 2, half * 2);
      ctx.beginPath();
      ctx.moveTo(sl.x - half, sl.y - half);
      ctx.lineTo(sl.x + half, sl.y + half);
      ctx.moveTo(sl.x + half, sl.y - half);
      ctx.lineTo(sl.x - half, sl.y + half);
      ctx.stroke();
      if (sl.hp < sl.maxHp) bar(ctx, sl.x - half, sl.y - half - 10, half * 2, 6, sl.hp / sl.maxHp, C.warn);
      continue;
    }
    {
      if (sl.hp < sl.maxHp) bar(ctx, sl.x - 30, sl.y - 38, 60, 6, sl.hp / sl.maxHp, C.warn);
      ctx.fillStyle = C.turret;
      ctx.beginPath();
      ctx.arc(sl.x, sl.y, cfg.turret.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.barrel;
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sl.x, sl.y);
      ctx.lineTo(sl.x + Math.cos(sl.turret.aim) * (cfg.turret.radius + 12), sl.y + Math.sin(sl.turret.aim) * (cfg.turret.radius + 12));
      ctx.stroke();
      ctx.lineCap = "butt";
      // Upgrade pips: speed (left, amber) and damage (right, red), one per level.
      for (let i = 0; i < sl.turret.speed; i++) {
        ctx.fillStyle = C.warn;
        ctx.fillRect(sl.x - 30, sl.y + 26 - i * 9, 7, 6);
      }
      for (let i = 0; i < sl.turret.strength; i++) {
        ctx.fillStyle = C.bad;
        ctx.fillRect(sl.x + 23, sl.y + 26 - i * 9, 7, 6);
      }
    }
  }

  // Zombies: walkers (olive), runners (small, pale), brutes (large, dark).
  for (const e of s.enemies) {
    const r = cfg.enemies[e.type].radius;
    ctx.fillStyle = e.attacking ? C.walkerAttack : e.type === "runner" ? C.runner : e.type === "brute" ? C.brute : C.walker;
    ctx.strokeStyle = C.walkerEdge;
    ctx.lineWidth = e.type === "brute" ? 4 : 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (e.hp < e.maxHp) bar(ctx, e.x - r, e.y - r - 9, r * 2, 4, e.hp / e.maxHp, C.bad);
  }

  // Projectiles, drawn as short tracers.
  ctx.strokeStyle = C.bullet;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const p of s.projectiles) {
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
  }
  ctx.stroke();

  // HUD.
  ctx.fillStyle = C.hudBg;
  ctx.fillRect(0, 0, W, 78);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = C.text;
  ctx.font = "800 30px system-ui, sans-serif";
  ctx.fillText(`${cfg.currencyLabel} ${s.currency}`, 20, 40);
  ctx.textAlign = "center";
  let status = "";
  let color = C.text;
  if (s.phase === "prep") status = `Wave ${s.wave} in ${clock(s.phaseTimer)}`;
  else if (s.phase === "warning") {
    status = "Horde incoming";
    color = C.warn;
  } else if (s.phase === "wave") status = `Wave ${s.wave} · ${remainingEnemies(s)} left`;
  else status = "Stronghold destroyed";
  ctx.fillStyle = color;
  ctx.font = "800 28px system-ui, sans-serif";
  ctx.fillText(status, W / 2 + 40, 40);

  const r = buttonRects(cfg);
  ctx.strokeStyle = showDiag ? C.text : C.quiet;
  ctx.lineWidth = 2;
  roundRect(ctx, r.diagnostics.x, r.diagnostics.y, r.diagnostics.w, r.diagnostics.h, 8);
  ctx.stroke();
  ctx.fillStyle = showDiag ? C.text : C.quiet;
  ctx.font = "700 18px system-ui, sans-serif";
  ctx.fillText("FPS", r.diagnostics.x + r.diagnostics.w / 2, r.diagnostics.y + r.diagnostics.h / 2 + 1);

  // Warning flash.
  if (s.phase === "warning") {
    const pulse = 0.35 + 0.35 * Math.sin(s.time * 10);
    ctx.strokeStyle = `rgba(208,88,74,${pulse})`;
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.fillStyle = C.warn;
    ctx.font = "900 64px system-ui, sans-serif";
    ctx.fillText("INCOMING", W / 2, 300);
  }

  // Bottom menu for the selected tile, or the prompt and skip button.
  if (model) {
    ctx.fillStyle = "rgba(10,11,10,0.9)";
    ctx.fillRect(r.panel.x, r.panel.y, r.panel.w, r.panel.h);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, r.panel.y);
    ctx.lineTo(W, r.panel.y);
    ctx.stroke();
  }
  if (model) {
    ctx.fillStyle = model.note ? C.warn : C.text;
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.fillText(model.note ? BUILD_MESSAGES[model.note as BuildRejection] ?? model.title : model.title, W / 2, r.slots.a0.y - 40);
    const armed = view.recycleArmedUntil > s.time;
    for (const b of model.buttons) {
      const label = b.confirm && armed ? "Tap again to recycle" : b.label;
      const style = !b.enabled ? "disabled" : b.slot === "close" || b.confirm ? "secondary" : "primary";
      button(ctx, r.slots[b.slot], label, style);
    }  } else if (s.phase === "prep") {
    ctx.fillStyle = C.text;
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.fillText("Tap a tile to build, or anything you built to manage it", W / 2, r.startNow.y - 40);
    button(ctx, r.startNow, "Start wave now");
  }

  // Toast.
  if (view.toast && view.toast.until > s.time) {
    ctx.fillStyle = "rgba(10,11,10,0.85)";
    roundRect(ctx, W / 2 - 230, 104, 460, 56, 10);
    ctx.fill();
    ctx.fillStyle = C.warn;
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.fillText(view.toast.text, W / 2, 133);
  }

  // End screen.
  if (s.phase === "lost") {
    ctx.fillStyle = "rgba(8,9,8,0.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.bad;
    ctx.font = "900 72px system-ui, sans-serif";
    ctx.fillText("OVERRUN", W / 2, H / 2 - 120);
    ctx.fillStyle = C.text;
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.fillText(`Waves cleared ${s.wavesCleared}`, W / 2, H / 2 - 30);
    ctx.fillText(`Kills ${s.kills}`, W / 2, H / 2 + 14);
    ctx.fillText(`Time ${clock(s.time)}`, W / 2, H / 2 + 58);
    button(ctx, r.restart, "Play again");
  }
}
