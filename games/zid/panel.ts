/**
 * The bottom menu for whatever tile is selected. One model drives both the
 * drawing and the tap handling, so a button can never show one thing and do
 * another. Every action still goes through the simulation's validated
 * commands; the model only decides which buttons to offer.
 */

import type { GameConfig } from "./config.js";
import { overlapsStronghold, type Tile } from "./grid.js";
import {
  buildCost,
  checkBuild,
  checkReinforce,
  checkUpgrade,
  nextReinforceCost,
  nextUpgradeCost,
  recycleValue,
  repairQuote,
  structureAt,
  turretStats,
  type GameState,
  type Structure,
} from "./sim.js";

export type PanelSlot = "a0" | "b0" | "a1" | "b1" | "close";

export type PanelAction =
  | { kind: "build-turret" }
  | { kind: "build-mortar" }
  | { kind: "build-barricade" }
  | { kind: "upgrade"; path: "speed" | "strength" }
  | { kind: "reinforce" }
  | { kind: "repair" }
  | { kind: "recycle" }
  | { kind: "close" };

export interface PanelButton {
  slot: PanelSlot;
  label: string;
  enabled: boolean;
  action: PanelAction;
  /** Recycle asks for a second tap. */
  confirm?: boolean;
}

export interface PanelModel {
  title: string;
  /** Short reason shown when a choice is unavailable. */
  note: string | null;
  buttons: PanelButton[];
  target: { kind: "tile" } | { kind: "stronghold" } | { kind: "structure"; structure: Structure };
}

function repairButton(s: GameState, cfg: GameConfig, slot: PanelSlot, st: Structure | null, label: string): PanelButton {
  const q = repairQuote(s, cfg, st ? { kind: "structure", id: st.id } : { kind: "stronghold" });
  if (typeof q === "string") {
    const text = q === "nothing-to-repair" ? `${label} · full` : `${label}`;
    return { slot, label: text, enabled: false, action: { kind: "repair" } };
  }
  return { slot, label: `${label} · ${q.cost}`, enabled: true, action: { kind: "repair" } };
}

function recycleButton(cfg: GameConfig, s: GameState, st: Structure): PanelButton {
  const busy = s.phase === "wave" || s.phase === "lost";
  return { slot: "b1", label: `Recycle · +${recycleValue(cfg, st)}`, enabled: !busy, action: { kind: "recycle" }, confirm: true };
}

export function panelModel(s: GameState, cfg: GameConfig, sel: Tile): PanelModel {
  const close: PanelButton = { slot: "close", label: "Close", enabled: true, action: { kind: "close" } };
  const st = structureAt(s, sel.col, sel.row);

  if (!st && overlapsStronghold(cfg, sel.col, sel.row)) {
    const sh = s.stronghold;
    return {
      title: `Stronghold · ${Math.ceil(sh.hp)} / ${sh.maxHp} health`,
      note: null,
      buttons: [{ ...repairButton(s, cfg, "a0", null, "Repair stronghold") }, close],
      target: { kind: "stronghold" },
    };
  }

  if (!st) {
    const turretWhy = checkBuild(s, cfg, sel.col, sel.row, "machine-gun");
    const mortarWhy = checkBuild(s, cfg, sel.col, sel.row, "mortar");
    const barrWhy = checkBuild(s, cfg, sel.col, sel.row, "barricade");
    const blocked = turretWhy && turretWhy !== "insufficient-funds" ? turretWhy : null;
    return {
      title: blocked ? "Can't build here" : "Build here",
      note: blocked,
      buttons: [
        { slot: "a0", label: `Turret · ${buildCost(cfg, "machine-gun")}`, enabled: !turretWhy, action: { kind: "build-turret" } },
        { slot: "b0", label: `Mortar · ${buildCost(cfg, "mortar")}`, enabled: !mortarWhy, action: { kind: "build-mortar" } },
        { slot: "a1", label: `Barricade · ${buildCost(cfg, "barricade")}`, enabled: !barrWhy, action: { kind: "build-barricade" } },
        close,
      ],
      target: { kind: "tile" },
    };
  }

  const name = st.kind === "barricade" ? "Barricade" : st.kind === "mortar" ? "Mortar" : "Machine gun";
  if (st.destroyed) {
    return {
      title: `${name} · destroyed (rubble)`,
      note: null,
      buttons: [repairButton(s, cfg, "a0", st, "Rebuild"), recycleButton(cfg, s, st), close],
      target: { kind: "structure", structure: st },
    };
  }

  if (st.turret) {
    const stats = turretStats(cfg, st.turret, st.kind);
    const up = (slot: PanelSlot, label: string, path: "speed" | "strength"): PanelButton => {
      const cost = nextUpgradeCost(cfg, st, path);
      const max = cfg.upgrades[path].costs.length;
      return {
        slot,
        label: cost === null ? `${label} MAX` : `${label} ${st.turret![path] + 1}/${max} · ${cost}`,
        enabled: checkUpgrade(s, cfg, st.id, path) === null,
        action: { kind: "upgrade", path },
      };
    };
    return {
      title: `${name} · ${Math.ceil(st.hp)}/${st.maxHp} hp · ${stats.fireRate.toFixed(1)}/s · ${stats.damage.toFixed(1)} dmg`,
      note: null,
      buttons: [up("a0", "Speed", "speed"), up("b0", "Damage", "strength"), repairButton(s, cfg, "a1", st, "Repair"), recycleButton(cfg, s, st), close],
      target: { kind: "structure", structure: st },
    };
  }

  const rCost = nextReinforceCost(cfg, st);
  const rMax = cfg.barricade.reinforce.costs.length;
  return {
    title: `${name} · ${Math.ceil(st.hp)}/${st.maxHp} hp`,
    note: null,
    buttons: [
      {
        slot: "a0",
        label: rCost === null ? "Reinforce MAX" : `Reinforce ${st.reinforce + 1}/${rMax} · ${rCost}`,
        enabled: checkReinforce(s, cfg, st.id) === null,
        action: { kind: "reinforce" },
      },
      repairButton(s, cfg, "b0", st, "Repair"),
      recycleButton(cfg, s, st),
      close,
    ],
    target: { kind: "structure", structure: st },
  };
}
