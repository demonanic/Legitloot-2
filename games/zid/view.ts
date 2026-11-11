/**
 * Drawing and on-canvas UI for Milestone 1. Placeholder art only: flat shapes
 * in neutral colours until the comic-book art exists.
 */

import { rectRegion, type UiRegion } from "../../engine/input/input.js";
import type { GameConfig } from "./config.js";
import { buildableTiles, gridSize, tileCenter, type Tile } from "./grid.js";
import { checkBuild, remainingEnemies, structureAt, type BuildRejection, type GameState } from "./sim.js";

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
  barrel: "#d7dcd3",
  walker: "#6e7b5b",
  walkerEdge: "#2f3527",
  walkerAttack: "#9c4a3c",
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
  /** Tile chosen for construction, awaiting confirmation. UI state only. */
  selected: Tile | null;
}

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
  confirmBuild(): void;
  cancelSelection(): void;
  restart(): void;
  toggleDiagnostics(): void;
}

/** Fixed button rectangles in world units, shared by drawing and hit tests. */
export function buttonRects(cfg: GameConfig) {
  const w = cfg.world.width;
  const h = cfg.world.height;
  return {
    startNow: { x: w / 2 - 150, y: h - 132, w: 300, h: 76 },
    build: { x: 40, y: h - 132, w: 400, h: 76 },
    cancel: { x: 460, y: h - 132, w: 220, h: 76 },
    restart: { x: w / 2 - 150, y: h / 2 + 150, w: 300, h: 84 },
    diagnostics: { x: w - 104, y: 14, w: 90, h: 50 },
  };
}

export function uiRegions(cfg: GameConfig, getState: () => GameState, getView: () => ViewState, act: UiActions): UiRegion[] {
  const r = buttonRects(cfg);
  const over = () => getState().phase === "lost";
  const selecting = () => getView().selected !== null && !over();
  return [
    rectRegion("start-now", r.startNow, () => act.startNow(), () => getState().phase === "prep" && !selecting()),
    rectRegion("build", r.build, () => act.confirmBuild(), selecting),
    rectRegion("cancel", r.cancel, () => act.cancelSelection(), selecting),
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
  ctx.font = "800 30px system-ui, sans-serif";
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
    ctx.beginPath();
    ctx.arc(st.x, st.y, cfg.turret.range, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Selected tile and a preview of what would be built.
  const sel = view.selected;
  const selReason = sel ? checkBuild(s, cfg, sel.col, sel.row) : null;
  if (sel && s.phase !== "lost") {
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

  // Turrets.
  for (const sl of s.structures) {
    {
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
    }
  }

  // Walkers.
  const wr = cfg.walker.radius;
  for (const e of s.enemies) {
    ctx.fillStyle = e.attacking ? C.walkerAttack : C.walker;
    ctx.strokeStyle = C.walkerEdge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, wr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (e.hp < cfg.walker.maxHp) bar(ctx, e.x - wr, e.y - wr - 9, wr * 2, 4, e.hp / cfg.walker.maxHp, C.bad);
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

  // Construction panel, or the prompt and skip button.
  if (sel && s.phase !== "lost") {
    ctx.fillStyle = selReason ? C.warn : C.text;
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.fillText(selReason ? BUILD_MESSAGES[selReason] : `Machine-gun turret · range ${cfg.turret.range}`, W / 2, r.build.y - 40);
    button(ctx, r.build, `Build turret · ${cfg.turret.cost}`, selReason ? "disabled" : "primary");
    button(ctx, r.cancel, "Cancel", "secondary");
  } else if (s.phase === "prep") {
    ctx.fillStyle = C.text;
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.fillText(`Tap a tile inside the fence to place a turret (${cfg.turret.cost})`, W / 2, r.startNow.y - 40);
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
