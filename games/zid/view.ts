/**
 * Drawing and on-canvas UI. Placeholder art only: flat shapes
 * in neutral colours until the comic-book art exists.
 */

import { rectRegion, type UiRegion } from "../../engine/input/input.js";
import type { GameConfig } from "./config.js";
import { buildableTiles, gridSize, tileCenter, type Tile } from "./grid.js";
import { panelModel, type BuildPage, type PanelAction, type PanelSlot } from "./panel.js";
import {
  BLAST_SECONDS,
  POPUP_SECONDS,
  remainingEnemies,
  structureAt,
  turretRange,
  type BuildRejection,
  type GameState,
  type ManageRejection,
  type Structure,
} from "./sim.js";

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
  mortar: "#8d8a6e",
  shell: "#f1eee3",
  blast: "#e2884a",
  aim: "#e2584a",
  flash: "#fff2b0",
  smoke: "rgba(200,204,196,",
  coin: "#e9c24a",
  coinEdge: "#8a6a1c",
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
  /** Which build-menu page is showing. */
  buildPage: BuildPage;
}

export const MANAGE_MESSAGES: Record<ManageRejection, string> = {
  "run-over": "The run is over",
  "assault-active": "Upgrade and repair between waves",
  "no-such-structure": "Nothing there",
  "not-a-turret": "Only turrets can be upgraded",
  "not-a-barricade": "Only barricades can be reinforced",
  "not-for-mortar": "Mortars can't upgrade range",
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
  "limit-reached": "Limit reached · upgrade the base",
  locked: "Not unlocked yet",
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
      a2: { x: 40, y: h - 132, w: 310, h: 76 },
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
    return panelModel(getState(), cfg, sel, getView().buildPage).buttons.find((b) => b.slot === slot) ?? null;
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
    slotRegion("a2"),
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
  const O = cfg.construction.origin;
  const { cols, rows } = gridSize(cfg);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= cols; c++) {
    ctx.moveTo(O.x + c * T, 0);
    ctx.lineTo(O.x + c * T, H);
  }
  for (let r = 0; r <= rows; r++) {
    ctx.moveTo(0, O.y + r * T);
    ctx.lineTo(W, O.y + r * T);
  }
  ctx.stroke();

  // Buildable tiles, shown while building is allowed.
  const building = s.phase === "prep" || s.phase === "warning";
  if (building) {
    for (const t of buildableTiles(cfg)) {
      if (structureAt(s, t.col, t.row)) continue;
      ctx.fillStyle = C.buildable;
      ctx.fillRect(O.x + t.col * T + 3, O.y + t.row * T + 3, T - 6, T - 6);
      ctx.strokeStyle = C.buildableEdge;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(O.x + t.col * T + 3, O.y + t.row * T + 3, T - 6, T - 6);
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
    ctx.arc(st.x, st.y, turretRange(cfg, st), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Selected tile and a preview of what would be built.
  const sel = view.selected;
  const selStructure = sel ? structureAt(s, sel.col, sel.row) : null;
  const model = sel && s.phase !== "lost" ? panelModel(s, cfg, sel, view.buildPage) : null;
  const selReason = model?.note ?? null;
  if (sel && selStructure && s.phase !== "lost") {
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 4;
    ctx.strokeRect(O.x + sel.col * T + 2, O.y + sel.row * T + 2, T - 4, T - 4);
    ctx.strokeStyle = "rgba(241,238,227,0.4)";
    ctx.lineWidth = 2;
    if (selStructure.turret && !selStructure.destroyed) {
      const isMortar = selStructure.kind === "mortar";
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(selStructure.x, selStructure.y, turretRange(cfg, selStructure), 0, Math.PI * 2);
      ctx.stroke();
      if (isMortar) {
        // Dead zone: the mortar can't hit anything this close.
        ctx.strokeStyle = "rgba(208,88,74,0.5)";
        ctx.beginPath();
        ctx.arc(selStructure.x, selStructure.y, cfg.mortar.minRange, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  } else if (sel && model?.target.kind === "tile" && s.phase !== "lost") {
    const c = tileCenter(cfg, sel.col, sel.row);
    const ok = selReason === null;
    ctx.strokeStyle = ok ? C.good : C.warn;
    ctx.lineWidth = 4;
    ctx.strokeRect(O.x + sel.col * T + 2, O.y + sel.row * T + 2, T - 4, T - 4);
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

  // Structures: traps, rubble, barricades, weapons.
  for (const sl of s.structures) {
    if (sl.kind === "mine" || sl.kind === "tripwire") {
      drawTrap(ctx, cfg, s, sl);
      continue;
    }
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
    if (sl.kind === "mortar") drawMortar(ctx, cfg, s, sl);
    else if (sl.kind === "gatling") drawGatling(ctx, cfg, s, sl);
    else if (sl.kind === "rocket") drawRocketLauncher(ctx, cfg, s, sl);
    else drawMachineGun(ctx, cfg, s, sl);
    {
      // Upgrade pips: speed (left, amber) and damage (right, red), one per level.
      for (let i = 0; i < sl.turret.speed; i++) {
        ctx.fillStyle = C.warn;
        ctx.fillRect(sl.x - 27, sl.y + 22 - i * 8, 6, 5);
      }
      for (let i = 0; i < sl.turret.strength; i++) {
        ctx.fillStyle = C.bad;
        ctx.fillRect(sl.x + 21, sl.y + 22 - i * 8, 6, 5);
      }
      // Range pips: blue, along the bottom.
      for (let i = 0; i < sl.turret.range; i++) {
        ctx.fillStyle = "#7fb0d8";
        ctx.fillRect(sl.x - 11 + i * 8, sl.y + 27, 5, 5);
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

  // Rockets: smoke trail, flame, body.
  for (const k of s.rockets) {
    for (let i = 0; i < k.trail.length; i++) {
      const [tx, ty] = k.trail[i]!;
      const a = (i + 1) / k.trail.length;
      ctx.fillStyle = `${C.smoke}${(0.28 * a).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(tx, ty, 3 + (1 - a) * 7, 0, Math.PI * 2);
      ctx.fill();
    }
    const ang = Math.atan2(k.vy, k.vx);
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    ctx.fillStyle = s.time % 0.1 < 0.05 ? "#ffd27a" : "#ff8a3a";
    ctx.beginPath();
    ctx.arc(k.x - c * 10, k.y - sn * 10, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#d9dccf";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(k.x - c * 8, k.y - sn * 8);
    ctx.lineTo(k.x + c * 6, k.y + sn * 6);
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.fillStyle = C.bad;
    ctx.beginPath();
    ctx.arc(k.x + c * 7, k.y + sn * 7, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mortar shells: a dot that rises and falls between mortar and landing spot,
  // with a shadow ring growing at the landing spot.
  for (const sh of s.shells) {
    const t = 1 - sh.left / sh.total;
    const x = sh.sx + (sh.tx - sh.sx) * t;
    const y = sh.sy + (sh.ty - sh.sy) * t - Math.sin(Math.PI * t) * 120;
    ctx.strokeStyle = "rgba(226,136,74,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sh.tx, sh.ty, sh.radius * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = C.shell;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const b of s.blasts) drawBlast(ctx, b.x, b.y, b.r, BLAST_SECONDS - b.life);

  // Supplies picked up from kills: a coin and "+N" floating up.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of s.popups) {
    const age = POPUP_SECONDS - p.life;
    const a = Math.min(1, p.life / 0.35) * Math.min(1, age / 0.08);
    const pop = 1 + 0.35 * Math.max(0, 1 - age / 0.15);
    ctx.globalAlpha = a;
    ctx.fillStyle = C.coin;
    ctx.strokeStyle = C.coinEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x - 16, p.y, 9 * pop, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = `800 ${Math.round(24 * pop)}px system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(10,11,10,0.8)";
    ctx.strokeText(`+${p.amount}`, p.x + 12, p.y);
    ctx.fillStyle = C.coin;
    ctx.fillText(`+${p.amount}`, p.x + 12, p.y);
  }
  ctx.globalAlpha = 1;

  // Crosshairs: one per aimed mortar, with a faint line back to its mortar.
  if (s.phase === "wave") {
    const pulse = 0.6 + 0.4 * Math.sin(s.time * 8);
    for (const m of s.structures) {
      const a = m.turret?.aimPoint;
      if (!a || m.destroyed) continue;
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = C.aim;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(a.x, a.y, cfg.mortar.blastRadius, 0, Math.PI * 2);
      ctx.moveTo(a.x - 30, a.y);
      ctx.lineTo(a.x + 30, a.y);
      ctx.moveTo(a.x, a.y - 30);
      ctx.lineTo(a.x, a.y + 30);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

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
  if (s.phase === "wave" && s.structures.some((st) => st.kind === "mortar" && !st.destroyed)) {
    ctx.fillStyle = C.hudBg;
    ctx.fillRect(0, 78, W, 40);
    const aimed = s.structures.filter((st) => st.turret?.aimPoint && !st.destroyed).length;
    const total = s.structures.filter((st) => st.kind === "mortar" && !st.destroyed).length;
    ctx.fillStyle = aimed ? C.aim : C.quiet;
    ctx.font = "700 20px system-ui, sans-serif";
    ctx.fillText(
      aimed ? `${aimed}/${total} mortar${total === 1 ? "" : "s"} aimed · tap a crosshair to free it` : "Tap the map to aim a mortar",
      W / 2,
      98,
    );
  }

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
    const heading = model.note ? BUILD_MESSAGES[model.note as BuildRejection] ?? model.title : model.title;
    if (model.info) {
      ctx.fillText(heading, W / 2, r.slots.a0.y - 62);
      ctx.fillStyle = C.quiet;
      ctx.font = "600 20px system-ui, sans-serif";
      ctx.fillText(model.info, W / 2, r.slots.a0.y - 30);
    } else ctx.fillText(heading, W / 2, r.slots.a0.y - 40);
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

  // Unlock notices: a banner under the HUD.
  if (s.notices.length > 0) {
    const n = s.notices[0]!;
    const a = Math.min(1, n.life / 0.6, (5 - n.life) / 0.25);
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = "rgba(226,176,74,0.95)";
    roundRect(ctx, W / 2 - 250, 180, 500, 70, 12);
    ctx.fill();
    ctx.fillStyle = C.buttonText;
    ctx.font = "900 30px system-ui, sans-serif";
    ctx.fillText(n.text.toUpperCase(), W / 2, 216);
    ctx.globalAlpha = 1;
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

/** 0..1, how fresh the last shot is over `window` seconds (1 = just fired). */
function fresh(s: GameState, lastShot: number, window: number): number {
  return Math.max(0, 1 - (s.time - lastShot) / window);
}

/** Wisps of smoke rising from a barrel tip after firing. */
function drawSmoke(ctx: CanvasRenderingContext2D, s: GameState, x: number, y: number, lastShot: number, life: number, size: number): void {
  const age = s.time - lastShot;
  if (age < 0 || age > life) return;
  const fade = 1 - age / life;
  for (let i = 0; i < 3; i++) {
    const t = age + i * 0.12;
    ctx.fillStyle = `${C.smoke}${(0.35 * fade).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x + Math.sin(s.time * 3 + i * 2) * 5, y - t * 40 - i * 4, size * (0.6 + t), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMachineGun(ctx: CanvasRenderingContext2D, cfg: GameConfig, s: GameState, sl: Structure): void {
  const t = sl.turret!;
  if (sl.hp < sl.maxHp) bar(ctx, sl.x - 30, sl.y - 38, 60, 6, sl.hp / sl.maxHp, C.warn);
  const kick = fresh(s, t.lastShot, 0.09);
  const cos = Math.cos(t.aim);
  const sin = Math.sin(t.aim);
  // Recoil: the whole gun nudges back, the barrel more.
  const bx = sl.x - cos * kick * 3;
  const by = sl.y - sin * kick * 3;
  ctx.fillStyle = C.turret;
  ctx.beginPath();
  ctx.arc(bx, by, cfg.turret.radius, 0, Math.PI * 2);
  ctx.fill();
  const len = cfg.turret.radius + 12 - kick * 7;
  const tipX = bx + cos * len;
  const tipY = by + sin * len;
  ctx.strokeStyle = C.barrel;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.lineCap = "butt";
  // Muzzle flash: a short bright burst at the tip.
  const flash = fresh(s, t.lastShot, 0.06);
  if (flash > 0) {
    ctx.fillStyle = C.flash;
    ctx.globalAlpha = flash;
    ctx.beginPath();
    const fx = tipX + cos * 8;
    const fy = tipY + sin * 8;
    for (let i = 0; i < 6; i++) {
      const ang = t.aim + (i * Math.PI) / 3;
      const r = i % 2 === 0 ? 14 : 6;
      ctx.lineTo(fx + Math.cos(ang) * r, fy + Math.sin(ang) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  drawSmoke(ctx, s, tipX, tipY, t.lastShot, 0.9, 4);
}

function drawMortar(ctx: CanvasRenderingContext2D, cfg: GameConfig, s: GameState, sl: Structure): void {
  const t = sl.turret!;
  if (sl.hp < sl.maxHp) bar(ctx, sl.x - 30, sl.y - 38, 60, 6, sl.hp / sl.maxHp, C.warn);
  const m = cfg.mortar.radius;
  const kick = fresh(s, t.lastShot, 0.3);
  // The base thumps down when it fires.
  const squash = 1 - 0.12 * kick;
  ctx.fillStyle = C.mortar;
  ctx.strokeStyle = C.walkerEdge;
  ctx.lineWidth = 3;
  roundRect(ctx, sl.x - m / squash, sl.y - m * squash, (m * 2) / squash, m * 2 * squash, 10);
  ctx.fill();
  ctx.stroke();
  // Short, fat tube pointing at the target; it drops back on firing.
  const off = 8 - kick * 6;
  const tx = sl.x + Math.cos(t.aim) * off;
  const ty = sl.y + Math.sin(t.aim) * off;
  ctx.fillStyle = C.barrel;
  ctx.beginPath();
  ctx.arc(tx, ty, 12 + kick * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.walkerEdge;
  ctx.beginPath();
  ctx.arc(tx, ty, 6, 0, Math.PI * 2);
  ctx.fill();
  const flash = fresh(s, t.lastShot, 0.14);
  if (flash > 0) {
    ctx.fillStyle = C.flash;
    ctx.globalAlpha = flash;
    ctx.beginPath();
    ctx.arc(tx, ty, 10 + (1 - flash) * 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  drawSmoke(ctx, s, tx, ty, t.lastShot, 1.4, 7);
}

/** A landed shell: flash, shockwave ring, flying debris, then smoke. */
function drawBlast(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, age: number): void {
  if (age < 0.2) {
    const k = age / 0.2;
    ctx.fillStyle = `rgba(255,236,170,${0.85 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(x, y, r * (0.5 + 0.6 * k), 0, Math.PI * 2);
    ctx.fill();
  }
  if (age < 0.45) {
    const k = age / 0.45;
    ctx.strokeStyle = `rgba(226,136,74,${0.8 * (1 - k)})`;
    ctx.lineWidth = 6 * (1 - k) + 1;
    ctx.beginPath();
    ctx.arc(x, y, r * (0.4 + 0.9 * k), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (age < 0.5) {
    const k = age / 0.5;
    ctx.fillStyle = `rgba(120,104,80,${1 - k})`;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.4;
      const d = r * 1.1 * k;
      ctx.fillRect(x + Math.cos(ang) * d - 3, y + Math.sin(ang) * d - 3 - 30 * Math.sin(Math.PI * k), 6, 6);
    }
  }
  if (age > 0.12) {
    const k = Math.min(1, (age - 0.12) / (BLAST_SECONDS - 0.12));
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      ctx.fillStyle = `${C.smoke}${(0.3 * (1 - k)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(ang) * r * 0.35, y + Math.sin(ang) * r * 0.35 - k * 25, r * (0.25 + 0.3 * k), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawTrap(ctx: CanvasRenderingContext2D, cfg: GameConfig, s: GameState, sl: Structure): void {
  if (sl.kind === "mine") {
    if (sl.destroyed) {
      // Scorch mark.
      ctx.fillStyle = "rgba(20,18,15,0.7)";
      ctx.beginPath();
      ctx.arc(sl.x, sl.y, 18, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.fillStyle = "#4e5747";
    ctx.strokeStyle = "#252a21";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sl.x, sl.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#7d8673";
    ctx.beginPath();
    ctx.arc(sl.x, sl.y, 6, 0, Math.PI * 2);
    ctx.fill();
    // Blinking arming light.
    const on = (s.time + sl.id * 0.37) % 1.2 < 0.25;
    ctx.fillStyle = on ? "#ff4a3a" : "#5b2420";
    ctx.beginPath();
    ctx.arc(sl.x + 7, sl.y - 7, 3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Trip wire: two stakes and the wire between them, across the approach.
  const half = cfg.construction.tileSize / 2 - 4;
  const ux = Math.cos(sl.facing);
  const uy = Math.sin(sl.facing);
  const ax = sl.x - ux * half;
  const ay = sl.y - uy * half;
  const bx = sl.x + ux * half;
  const by = sl.y + uy * half;
  if (sl.destroyed) {
    ctx.strokeStyle = "rgba(200,190,160,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + ux * 10 + 4, ay + uy * 10 + 6);
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - ux * 10 - 4, by - uy * 10 + 6);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "#d8cfa6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    // A faint glint travelling along the wire.
    const t = (s.time * 0.6 + sl.id * 0.21) % 1;
    ctx.fillStyle = "rgba(255,250,220,0.8)";
    ctx.beginPath();
    ctx.arc(ax + (bx - ax) * t, ay + (by - ay) * t, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Charges along the wire.
    ctx.fillStyle = "#6b5a3a";
    for (const f of [-0.5, 0, 0.5]) {
      ctx.fillRect(sl.x + ux * f * half * 1.2 - 4, sl.y + uy * f * half * 1.2 - 4, 8, 8);
    }
  }
  for (const [x, y] of [[ax, ay], [bx, by]] as const) {
    ctx.fillStyle = "#8a7a55";
    ctx.strokeStyle = "#3a3222";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawGatling(ctx: CanvasRenderingContext2D, cfg: GameConfig, s: GameState, sl: Structure): void {
  const t = sl.turret!;
  if (sl.hp < sl.maxHp) bar(ctx, sl.x - 26, sl.y - 34, 52, 6, sl.hp / sl.maxHp, C.warn);
  const r = cfg.gatling.radius;
  const cos = Math.cos(t.aim);
  const sin = Math.sin(t.aim);
  const kick = fresh(s, t.lastShot, 0.05);
  const bx = sl.x - cos * kick * 2;
  const by = sl.y - sin * kick * 2;
  // Body: an octagon.
  ctx.fillStyle = "#8e978a";
  ctx.strokeStyle = C.walkerEdge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ctx.lineTo(bx + Math.cos(a) * r, by + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Barrel cluster: six barrels seen from above, their sideways offset follows
  // the spin angle so the cluster visibly rotates.
  const len = r + 16;
  const px = -sin;
  const py = cos;
  const heat = t.spin;
  for (let i = 0; i < 6; i++) {
    const a = t.barrel + (i / 6) * Math.PI * 2;
    const off = Math.sin(a) * 6;
    const depth = Math.cos(a); // front barrels drawn brighter
    const shade = Math.round(150 + 70 * depth);
    const hot = Math.round(heat * 90 * (0.5 + 0.5 * depth));
    ctx.strokeStyle = `rgb(${Math.min(255, shade + hot)},${shade - Math.round(hot * 0.3)},${shade - hot})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bx + px * off + cos * 6, by + py * off + sin * 6);
    ctx.lineTo(bx + px * off + cos * len, by + py * off + sin * len);
    ctx.stroke();
  }
  // Barrel collars.
  ctx.strokeStyle = "#3a3f36";
  ctx.lineWidth = 3;
  for (const f of [0.55, 0.95]) {
    ctx.beginPath();
    ctx.moveTo(bx + cos * len * f + px * 8, by + sin * len * f + py * 8);
    ctx.lineTo(bx + cos * len * f - px * 8, by + sin * len * f - py * 8);
    ctx.stroke();
  }
  const tipX = bx + cos * (len + 4);
  const tipY = by + sin * (len + 4);
  const flash = fresh(s, t.lastShot, 0.05);
  if (flash > 0) {
    ctx.globalAlpha = flash;
    ctx.fillStyle = C.flash;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = t.aim + (i * Math.PI) / 4 + t.barrel;
      const rr = i % 2 === 0 ? 14 : 5;
      ctx.lineTo(tipX + Math.cos(a) * rr, tipY + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  drawSmoke(ctx, s, tipX, tipY, t.lastShot, 1.1, 4 + 3 * heat);
}

function drawRocketLauncher(ctx: CanvasRenderingContext2D, cfg: GameConfig, s: GameState, sl: Structure): void {
  const t = sl.turret!;
  if (sl.hp < sl.maxHp) bar(ctx, sl.x - 26, sl.y - 34, 52, 6, sl.hp / sl.maxHp, C.warn);
  const r = cfg.rocket.radius;
  const cos = Math.cos(t.aim);
  const sin = Math.sin(t.aim);
  const px = -sin;
  const py = cos;
  const kick = fresh(s, t.lastShot, 0.35);
  // Base plate.
  ctx.fillStyle = "#6f7564";
  ctx.strokeStyle = C.walkerEdge;
  ctx.lineWidth = 3;
  roundRect(ctx, sl.x - r, sl.y - r, r * 2, r * 2, 6);
  ctx.fill();
  ctx.stroke();
  // Twin tubes, kicking back when one fires.
  const back = kick * 6;
  for (const side of [-1, 1]) {
    const ox = sl.x + px * side * 7 - cos * back;
    const oy = sl.y + py * side * 7 - sin * back;
    ctx.strokeStyle = "#3c4436";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(ox - cos * 14, oy - sin * 14);
    ctx.lineTo(ox + cos * 18, oy + sin * 18);
    ctx.stroke();
    ctx.strokeStyle = "#c7cbbd";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(ox - cos * 12, oy - sin * 12);
    ctx.lineTo(ox + cos * 16, oy + sin * 16);
    ctx.stroke();
    ctx.fillStyle = "#24281f";
    ctx.beginPath();
    ctx.arc(ox + cos * 17, oy + sin * 17, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Back-blast: a cone of fire and smoke behind the launcher right after firing.
  const blastK = fresh(s, t.lastShot, 0.45);
  if (blastK > 0) {
    const bx = sl.x - cos * (r + 6);
    const by = sl.y - sin * (r + 6);
    for (let i = 0; i < 4; i++) {
      const d = (1 - blastK) * 30 + i * 7;
      ctx.fillStyle = i === 0 && blastK > 0.6 ? `rgba(255,200,110,${blastK.toFixed(3)})` : `${C.smoke}${(0.35 * blastK).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(bx - cos * d + px * (i - 1.5) * 4, by - sin * d + py * (i - 1.5) * 4, 6 + (1 - blastK) * 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  drawSmoke(ctx, s, sl.x + cos * 18, sl.y + sin * 18, t.lastShot, 1.0, 5);
}
