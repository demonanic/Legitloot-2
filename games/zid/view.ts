/**
 * Drawing and on-canvas UI for Milestone 1. Placeholder art only: flat shapes
 * in neutral colours until the comic-book art exists.
 */

import { rectRegion, type UiRegion } from "../../engine/input/input.js";
import type { GameConfig } from "./config.js";
import { remainingEnemies, type GameState } from "./sim.js";

const C = {
  ground: "#1c1e1b",
  grid: "#242723",
  stronghold: "#585d55",
  strongholdEdge: "#8b9086",
  slotEmpty: "#8b9086",
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
}

export interface UiActions {
  startNow(): void;
  restart(): void;
  toggleDiagnostics(): void;
}

/** Fixed button rectangles in world units, shared by drawing and hit tests. */
export function buttonRects(cfg: GameConfig) {
  const w = cfg.world.width;
  const h = cfg.world.height;
  return {
    startNow: { x: w / 2 - 150, y: h - 132, w: 300, h: 76 },
    restart: { x: w / 2 - 150, y: h / 2 + 150, w: 300, h: 84 },
    diagnostics: { x: w - 104, y: 14, w: 90, h: 50 },
  };
}

export function uiRegions(cfg: GameConfig, getState: () => GameState, act: UiActions): UiRegion[] {
  const r = buttonRects(cfg);
  const over = () => getState().phase === "lost";
  return [
    rectRegion("start-now", r.startNow, () => act.startNow(), () => getState().phase === "prep"),
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

function button(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, label: string): void {
  ctx.fillStyle = C.button;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
  ctx.fill();
  ctx.fillStyle = C.buttonText;
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
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 40) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let y = 0; y <= H; y += 40) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();

  // Turret range rings, faint, so placement reads.
  ctx.strokeStyle = "rgba(233,214,141,0.08)";
  ctx.lineWidth = 2;
  for (const sl of s.slots) {
    if (!sl.turret) continue;
    ctx.beginPath();
    ctx.arc(sl.x, sl.y, cfg.turret.range, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Stronghold.
  const sh = s.stronghold;
  ctx.fillStyle = C.stronghold;
  ctx.strokeStyle = C.strongholdEdge;
  ctx.lineWidth = 4;
  ctx.fillRect(sh.x - sh.halfSize, sh.y - sh.halfSize, sh.halfSize * 2, sh.halfSize * 2);
  ctx.strokeRect(sh.x - sh.halfSize, sh.y - sh.halfSize, sh.halfSize * 2, sh.halfSize * 2);
  bar(ctx, sh.x - 70, sh.y - sh.halfSize - 26, 140, 12, sh.hp / sh.maxHp, sh.hp / sh.maxHp > 0.35 ? C.good : C.bad);

  // Hardpoints and turrets.
  const canAfford = s.currency >= cfg.turret.cost;
  for (const sl of s.slots) {
    if (!sl.turret) {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = canAfford ? C.text : C.slotEmpty;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sl.x, sl.y, cfg.turret.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = canAfford ? C.text : C.quiet;
      ctx.font = "700 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`+${cfg.turret.cost}`, sl.x, sl.y + 1);
    } else {
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

  // Prep prompt and skip button.
  if (s.phase === "prep") {
    ctx.fillStyle = C.text;
    ctx.font = "700 24px system-ui, sans-serif";
    const prompt = s.slots.some((sl) => !sl.turret)
      ? `Tap a + mount to build a turret (${cfg.turret.cost})`
      : "Defenses ready";
    ctx.fillText(prompt, W / 2, r.startNow.y - 40);
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
