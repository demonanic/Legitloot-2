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
  turretRange,
  isTrap,
  isUnlocked,
  trapDamageMultiplier,
  KIND_NAMES,
  buildLimit,
  countKind,
  checkBaseUpgrade,
  checkSendTruck,
  nextBaseUpgradeCost,
  type UpgradePathId,
  type StructureKind,
  type GameState,
  type Structure,
} from "./sim.js";

/** The build menu has two pages: weapons, and traps & walls. */
export type BuildPage = "weapons" | "close" | "traps" | "survivors";

export type PanelSlot = "a0" | "b0" | "a1" | "b1" | "a2" | "close";

export type PanelAction =
  | { kind: "build"; structure: StructureKind }
  | { kind: "page"; page: BuildPage }
  | { kind: "upgrade"; path: UpgradePathId }
  | { kind: "upgrade-base" }
  | { kind: "send-truck" }
  | { kind: "unlock-survivor"; id: string }
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
  /** Optional second line of plain information under the title. */
  info?: string;
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

function recycleButton(cfg: GameConfig, s: GameState, st: Structure, slot: PanelSlot = "b1"): PanelButton {
  const busy = s.phase === "wave" || s.phase === "lost";
  return { slot, label: `Recycle · +${recycleValue(cfg, st)}`, enabled: !busy, action: { kind: "recycle" }, confirm: true };
}

export function panelModel(s: GameState, cfg: GameConfig, sel: Tile, pageIn: BuildPage = "weapons", salvage = 0): PanelModel {
  const close: PanelButton = { slot: "close", label: "Close", enabled: true, action: { kind: "close" } };
  const st = structureAt(s, sel.col, sel.row);
  const onBase = !st && overlapsStronghold(cfg, sel.col, sel.row);
  // The survivors page belongs to the base menu; anywhere else it means the first build page.
  const page: BuildPage = pageIn === "survivors" && !onBase ? "weapons" : pageIn;

  if (onBase && page === "survivors" && s.phase !== "wave") {
    const slots: PanelSlot[] = ["a0", "b0", "a1", "b1"];
    const buttons: PanelButton[] = cfg.survivors.roster.slice(0, slots.length).map((d, i) => {
      const have = s.survivors.some((v) => v.id === d.id);
      return {
        slot: slots[i]!,
        label: have ? `${d.name} · ${d.role} ✓` : `${d.name} · ${d.role} · ${d.cost}`,
        enabled: !have && s.phase !== "lost" && salvage >= d.cost,
        action: { kind: "unlock-survivor", id: d.id },
      };
    });
    const next = cfg.survivors.roster.find((d) => !s.survivors.some((v) => v.id === d.id));
    return {
      title: `Survivors · Salvage ${salvage}`,
      note: null,
      info: next ? `${next.name}: ${next.perkText}` : "Everyone is with you",
      buttons: [...buttons, { slot: "a2", label: "‹ Base", enabled: true, action: { kind: "page", page: "weapons" } }, close],
      target: { kind: "stronghold" },
    };
  }

  if (!st && overlapsStronghold(cfg, sel.col, sel.row)) {
    const sh = s.stronghold;
    const lvl = cfg.stronghold.levels[sh.level];
    const upCost = nextBaseUpgradeCost(s, cfg);
    const next = cfg.stronghold.levels[sh.level + 1];
    if (s.phase === "wave") {
      return {
        title: `Base level ${sh.level + 1} · ${Math.ceil(sh.hp)} / ${sh.maxHp} health`,
        note: null,
        info: EMERGENCY_INFO(cfg),
        buttons: [repairButton(s, cfg, "a0", null, "Repair"), close],
        target: { kind: "stronghold" },
      };
    }
    return {
      title: `Base level ${sh.level + 1} · ${Math.ceil(sh.hp)} / ${sh.maxHp} health`,
      note: null,
      info: lvl
        ? `Turrets ${lvl.machineGuns}, mortars ${lvl.mortars}` +
          (next ? ` → ${next.machineGuns}, ${next.mortars}` + nextUnlock(cfg, sh.level + 2) : " · max level")
        : undefined,
      buttons: [
        repairButton(s, cfg, "a0", null, "Repair"),
        {
          slot: "b0",
          label: upCost === null ? "Base MAX" : `Upgrade base · ${upCost}`,
          enabled: checkBaseUpgrade(s, cfg) === null,
          action: { kind: "upgrade-base" },
        },
        {
          slot: "a1",
          label:
            s.truck.state === "parked"
              ? `Salvage run · ${cfg.truck.cost}`
              : s.truck.state === "queued"
                ? "Truck leaves next wave"
                : s.truck.state === "wrecked"
                  ? "Truck lost · new one next wave"
                  : s.truck.state === "away"
                    ? "Truck is away"
                    : "Truck is busy",
          enabled: checkSendTruck(s, cfg) === null,
          action: { kind: "send-truck" },
        },
        {
          slot: "b1",
          label: `Survivors ${s.survivors.length}/${cfg.survivors.roster.length} ›`,
          enabled: true,
          action: { kind: "page", page: "survivors" },
        },
        close,
      ],
      target: { kind: "stronghold" },
    };
  }

  if (!st) {
    const barrWhy = checkBuild(s, cfg, sel.col, sel.row, "barricade");
    // Tile problems show for every kind; the barricade check has no build cap.
    const blocked = barrWhy && barrWhy !== "insufficient-funds" ? barrWhy : null;
    const buildButton = (slot: PanelSlot, kind: StructureKind, name: string): PanelButton => {
      const why = checkBuild(s, cfg, sel.col, sel.row, kind);
      const action: PanelAction = { kind: "build", structure: kind };
      if (!isUnlocked(s, cfg, kind)) return { slot, label: `${name} · base ${cfg.unlocks[kind]}`, enabled: false, action };
      const limit = buildLimit(s, cfg, kind);
      if (limit === null) return { slot, label: `${name} · ${buildCost(cfg, kind)}`, enabled: !why, action };
      const n = countKind(s, kind);
      const label = n >= limit ? `${name} ${n}/${limit} · full` : `${name} ${n}/${limit} · ${buildCost(cfg, kind)}`;
      return { slot, label, enabled: !why, action };
    };
    const buttons: PanelButton[] =
      page === "weapons"
        ? [
            buildButton("a0", "machine-gun", "Turret"),
            buildButton("b0", "gatling", "Gatling"),
            buildButton("a1", "rocket", "Rockets"),
            buildButton("b1", "mortar", "Mortar"),
            { slot: "a2", label: "More weapons ›", enabled: true, action: { kind: "page", page: "close" } },
            close,
          ]
        : page === "close"
          ? [
              buildButton("a0", "shotgun", "Shotgun"),
              buildButton("b0", "flamer", "Flamer"),
              { slot: "a2", label: "Traps & walls ›", enabled: true, action: { kind: "page", page: "traps" } },
              close,
            ]
          : [
            buildButton("a0", "mine", "Mine"),
            buildButton("b0", "tripwire", "Trip wire"),
            buildButton("a1", "barricade", "Barricade"),
            { slot: "a2", label: "‹ Weapons", enabled: true, action: { kind: "page", page: "weapons" } },
            close,
          ];
    return {
      title: blocked ? "Can't build here" : page === "weapons" ? "Build a weapon" : page === "close" ? "Build a close-range weapon" : "Build a trap or wall",
      note: blocked,
      buttons,
      target: { kind: "tile" },
    };
  }

  const name = KIND_NAMES[st.kind];
  if (s.phase === "wave") {
    // Mid-assault: emergency repairs and re-arming only, at a higher price.
    const trap = isTrap(st.kind);
    const label = st.destroyed ? (trap ? "Re-arm" : "Rebuild") : "Repair";
    return {
      title: st.destroyed ? `${name} · ${trap ? "spent" : "destroyed"}` : `${name} · ${Math.ceil(st.hp)}/${st.maxHp} hp`,
      note: null,
      info: trap && !st.destroyed ? "Armed and waiting" : EMERGENCY_INFO(cfg),
      buttons: trap && !st.destroyed ? [close] : [repairButton(s, cfg, "a0", st, label), close],
      target: { kind: "structure", structure: st },
    };
  }
  if (st.destroyed && isTrap(st.kind)) {
    return {
      title: `${name} · spent`,
      note: null,
      buttons: [repairButton(s, cfg, "a0", st, "Re-arm"), recycleButton(cfg, s, st), close],
      target: { kind: "structure", structure: st },
    };
  }
  if (isTrap(st.kind)) {
    const mult = trapDamageMultiplier(s, cfg);
    const info =
      st.kind === "mine"
        ? `Goes off when a zombie comes close · ${Math.round(cfg.mine.damage * mult)} damage (grows with base level)`
        : `First zombie across sets off ${cfg.tripwire.blasts} blasts · ${Math.round(cfg.tripwire.damage * mult)} each (grows with base level)`;
    return {
      title: `${name} · armed`,
      note: null,
      info,
      buttons: [recycleButton(cfg, s, st), close],
      target: { kind: "structure", structure: st },
    };
  }
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
    const up = (slot: PanelSlot, label: string, path: UpgradePathId): PanelButton => {
      const cost = nextUpgradeCost(cfg, st, path);
      const max = cfg.upgrades[path].costs.length;
      return {
        slot,
        label: cost === null ? `${label} MAX` : `${label} ${st.turret![path] + 1}/${max} · ${cost}`,
        enabled: checkUpgrade(s, cfg, st.id, path) === null,
        action: { kind: "upgrade", path },
      };
    };
    if (st.kind === "machine-gun") {
      return {
        title: `${name} · ${Math.ceil(st.hp)}/${st.maxHp} hp · ${stats.fireRate.toFixed(1)}/s · ${stats.damage.toFixed(1)} dmg · range ${Math.round(turretRange(cfg, st))}`,
        note: null,
        buttons: [
          up("a0", "Speed", "speed"),
          up("b0", "Damage", "strength"),
          up("a1", "Range", "range"),
          repairButton(s, cfg, "b1", st, "Repair"),
          recycleButton(cfg, s, st, "a2"),
          close,
        ],
        target: { kind: "structure", structure: st },
      };
    }
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

/** " · unlocks Gatling" when that base level unlocks something, else "". */
function nextUnlock(cfg: GameConfig, baseLevel: number): string {
  const names: Record<string, string> = { tripwire: "Trip wire", shotgun: "Shotgun", flamer: "Flamethrower", gatling: "Gatling", rocket: "Rockets", mine: "Mines", mortar: "Mortar" };
  const kinds = Object.entries(cfg.unlocks)
    .filter(([, lvl]) => lvl === baseLevel)
    .map(([k]) => names[k] ?? k);
  return kinds.length ? ` · unlocks ${kinds.join(", ")}` : "";
}

const EMERGENCY_INFO = (cfg: GameConfig): string =>
  `Emergency work during an assault costs ${Math.round((cfg.repair.assaultMultiplier - 1) * 100)}% more`;
