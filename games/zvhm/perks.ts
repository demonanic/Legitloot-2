/**
 * Run perks: after each cleared wave the player picks one of three. Perks
 * stack up to a level cap and last for the run. Pure definitions; the
 * simulation applies the effects.
 */
import type { GameConfig } from "./config.js";
import type { StructureKind } from "./sim.js";

export type PerkId =
  | "hot-barrels"
  | "heavy-rounds"
  | "big-bang"
  | "napalm"
  | "overcharge"
  | "capacitors"
  | "armor-piercing"
  | "reinforced"
  | "field-medic"
  | "scavenger"
  | "quick-charge"
  | "survivor-training";

export type Perks = Partial<Record<PerkId, number>>;

export interface PerkDef {
  id: PerkId;
  name: string;
  /** What one level does, shown on the card. */
  text: string;
  max: number;
  /** Effect per level (meaning depends on the perk). */
  per: number;
  /** Which weapon kinds must be unlocked for the perk to be worth offering (any one is enough). */
  needs?: StructureKind[];
}

export const PERKS: readonly PerkDef[] = [
  { id: "hot-barrels", name: "Hot Barrels", text: "Every weapon fires 8% faster", max: 3, per: 0.08 },
  { id: "heavy-rounds", name: "Heavy Rounds", text: "Guns, Gatlings and shotguns +12% damage", max: 3, per: 0.12 },
  { id: "big-bang", name: "Big Bang", text: "Mortar and rocket blasts +15% damage", max: 3, per: 0.15, needs: ["mortar", "rocket"] },
  { id: "napalm", name: "Napalm", text: "Flamethrowers +25% damage", max: 2, per: 0.25, needs: ["flamer"] },
  { id: "overcharge", name: "Overcharge", text: "Tesla coils +25% damage", max: 2, per: 0.25, needs: ["tesla"] },
  { id: "capacitors", name: "Capacitors", text: "Railguns charge 25% faster", max: 2, per: 0.25, needs: ["railgun"] },
  { id: "armor-piercing", name: "Armor Piercing", text: "Bullets do 25% more to Armored", max: 2, per: 0.25 },
  { id: "reinforced", name: "Reinforced", text: "Everything you build +15% health", max: 3, per: 0.15 },
  { id: "field-medic", name: "Field Medic", text: "Stronghold heals 1.5 health/s in waves", max: 3, per: 1.5 },
  { id: "scavenger", name: "Scavenger", text: "Kills drop 12% more Supplies", max: 3, per: 0.12 },
  { id: "quick-charge", name: "Quick Charge", text: "Charge meter fills 20% faster", max: 3, per: 0.2 },
  { id: "survivor-training", name: "Training", text: "Survivors +20% damage", max: 3, per: 0.2 },
];

const BY_ID = new Map(PERKS.map((p) => [p.id, p]));

export function perkDef(id: PerkId): PerkDef {
  return BY_ID.get(id)!;
}

export function perkLevel(perks: Perks | undefined, id: PerkId): number {
  return perks?.[id] ?? 0;
}

/** Effect of a perk at its current level: level × per. */
export function perkBonus(perks: Perks | undefined, id: PerkId): number {
  return perkLevel(perks, id) * perkDef(id).per;
}

const BULLET_WEAPONS: readonly StructureKind[] = ["machine-gun", "gatling", "shotgun"];

/** Fire-rate and damage multipliers from perks for one kind of weapon. */
export function weaponPerkScale(perks: Perks | undefined, kind: StructureKind): { rate: number; damage: number } {
  let rate = 1 + perkBonus(perks, "hot-barrels");
  let damage = 1;
  if (BULLET_WEAPONS.includes(kind)) damage += perkBonus(perks, "heavy-rounds");
  if (kind === "mortar" || kind === "rocket") damage += perkBonus(perks, "big-bang");
  if (kind === "flamer") damage += perkBonus(perks, "napalm");
  if (kind === "tesla") damage += perkBonus(perks, "overcharge");
  if (kind === "railgun") rate *= 1 + perkBonus(perks, "capacitors");
  return { rate, damage };
}

/** Perks still worth offering: not maxed, and their weapon is in play. */
export function eligiblePerks(perks: Perks, unlocked: (kind: StructureKind) => boolean, opts: { survivors: boolean; armoredSoon: boolean }): PerkId[] {
  return PERKS.filter((p) => {
    if (perkLevel(perks, p.id) >= p.max) return false;
    if (p.needs && !p.needs.some(unlocked)) return false;
    if (p.id === "survivor-training" && !opts.survivors) return false;
    if (p.id === "armor-piercing" && !opts.armoredSoon) return false;
    return true;
  }).map((p) => p.id);
}

/** Draw up to `n` distinct perks from `pool` with the given random source. */
export function drawPerks(pool: readonly PerkId[], n: number, random: () => number): PerkId[] {
  const left = [...pool];
  const out: PerkId[] = [];
  while (out.length < n && left.length > 0) {
    const i = Math.floor(random() * left.length);
    out.push(left.splice(i, 1)[0]!);
  }
  return out;
}

/** Config hook kept small: how many choices an offer shows. */
export function offerSize(cfg: GameConfig): number {
  return cfg.perks.choices;
}
