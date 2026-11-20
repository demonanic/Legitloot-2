/**
 * The tutorial: a short guided start for first-time players, then one-time
 * tips the first time each mechanic shows up, and a "How to play" reference
 * that pages through every tip. Pure logic and layout; drawing lives in
 * view.ts and storage in main.ts.
 */
import type { GameConfig } from "./config.js";
import type { GameState } from "./sim.js";

export type TipId =
  | "welcome"
  | "supplies"
  | "build"
  | "manage"
  | "start"
  | "wave"
  | "preview"
  | "pickup"
  | "charge"
  | "mortar"
  | "survivors"
  | "base"
  | "truck"
  | "salvage"
  | "defeat";

/** What a tip points at; view.ts turns these into rectangles. */
export type TipHighlight = "supplies" | "start" | "boosts" | "pickup" | "base" | "salvage" | "meter" | "preview";

export interface Tip {
  id: TipId;
  title: string;
  body: string;
  /** "info" waits for Got it; "do" waits for the player to do something (see `done`). */
  kind: "info" | "do";
  /** Part of the guided start on a player's first run, shown in order before wave 1. */
  guided?: boolean;
  /** Where the card sits: "top" leaves the field below it free to tap. */
  where: "top" | "middle";
  /** When a one-time tip is due (contextual tips only). */
  when?: (s: GameState, salvage: number) => boolean;
  /** For "do" tips: the step is complete. */
  done?: (s: GameState) => boolean;
  highlight?: TipHighlight;
}

const hasKind = (s: GameState, kinds: readonly string[]) => s.structures.some((st) => kinds.includes(st.kind) && !st.destroyed);
const WEAPONS = ["machine-gun", "gatling", "rocket", "mortar", "shotgun", "flamer", "tesla", "railgun"];

export const TIPS: readonly Tip[] = [
  {
    id: "welcome",
    title: "Welcome to Z.V.H.M.",
    body: "This is Zombies vs Heavy Metal. Zombies attack in waves from every side. Keep the stronghold in the middle standing. If its health reaches zero, the run is over.",
    kind: "info",
    guided: true,
    where: "middle",
  },
  {
    id: "supplies",
    title: "Supplies",
    body: "Top left. They pay for everything you build. Kills drop more, shown as +N. Supplies are lost when a run ends.",
    kind: "info",
    guided: true,
    where: "middle",
    highlight: "supplies",
  },
  {
    id: "build",
    title: "Build your first turret",
    body: "Tap a lit tile near the stronghold, then tap Turret.",
    kind: "do",
    guided: true,
    where: "top",
    done: (s) => hasKind(s, WEAPONS),
  },
  {
    id: "manage",
    title: "Upgrade, repair, recycle",
    body: "Tap anything you built to upgrade it (Speed, Damage, Range), repair it, or recycle it for part of its cost. Building and upgrading only happen between waves.",
    kind: "info",
    guided: true,
    where: "middle",
  },
  {
    id: "start",
    title: "Ready",
    body: "The wave starts when the timer runs out, or tap Start wave now. Good luck.",
    kind: "info",
    guided: true,
    where: "middle",
    highlight: "start",
  },
  {
    id: "wave",
    title: "During a wave",
    body: "Your weapons fire on their own. Tap the stronghold or anything you built for emergency repairs, at 50% extra. Everything else waits for the next break.",
    kind: "info",
    where: "middle",
    when: (s) => s.phase === "wave",
  },
  {
    id: "pickup",
    title: "Pickups",
    body: "Tap the gold $ for Supplies and the green cross to heal the stronghold. Be quick: they fade.",
    kind: "info",
    where: "middle",
    when: (s) => s.phase === "wave" && s.pickups.length > 0,
    highlight: "pickup",
  },
  {
    id: "charge",
    title: "Charge meter full",
    body: "Kills fill the meter at the bottom. When it's full, pick a boost. Airstrike and Force field unlock as you upgrade the base.",
    kind: "info",
    where: "top",
    when: (s) => s.phase === "wave" && s.charge >= 1 && !s.boost,
    highlight: "boosts",
  },
  {
    id: "mortar",
    title: "Aiming mortars",
    body: "Mortars fire on their own, but you can tap the map to aim one. Each tap aims another. Tap a crosshair to free it.",
    kind: "info",
    where: "middle",
    when: (s) => s.phase === "wave" && hasKind(s, ["mortar"]),
  },
  {
    id: "survivors",
    title: "Survivors",
    body: "Survivors fight on their own and level up from kills, getting new weapons at levels 3 and 5. If one goes down, they're back next wave.",
    kind: "info",
    where: "middle",
    when: (s) => s.phase === "wave" && s.survivors.some((v) => !v.downed),
  },
  {
    id: "base",
    title: "The base menu",
    body: "Tap the stronghold between waves. Upgrade the base for more weapons and new unlocks, send the salvage truck, recruit survivors and convert Salvage.",
    kind: "info",
    where: "top",
    when: (s) => s.phase === "prep" && s.wavesCleared >= 1,
    highlight: "base",
  },
  {
    id: "preview",
    title: "Next wave",
    body: "The strip at the top shows who is coming next. New kinds get a short tip, and red arrows show which sides they will come from.",
    kind: "info",
    where: "middle",
    when: (s) => s.phase === "prep" && s.wave >= 2,
    highlight: "preview",
  },
  {
    id: "truck",
    title: "The truck is back",
    body: "Protect the salvage truck while it unloads, or the load is lost. Part of every haul becomes Salvage.",
    kind: "info",
    where: "top",
    when: (s) => s.truck.state === "arriving",
  },
  {
    id: "salvage",
    title: "Salvage",
    body: "Salvage is the one thing you keep after losing. Spend it on survivors, who join every run, or convert it to Supplies.",
    kind: "info",
    where: "middle",
    when: (s, salvage) => salvage > 0 && s.phase === "prep",
    highlight: "salvage",
  },
  {
    id: "defeat",
    title: "Overrun",
    body: "Supplies are lost, but Salvage stays. Send the salvage truck between waves to build it up, then recruit survivors to start stronger.",
    kind: "info",
    where: "top",
    when: (s) => s.phase === "lost",
  },
];

export function tipById(id: TipId): Tip {
  return TIPS.find((t) => t.id === id)!;
}

/** What the player has seen, kept between visits. */
export interface TutorialProgress {
  seen: TipId[];
  /** Skipped: no more automatic tips (the "?" reference still works). */
  off: boolean;
}

export const NEW_PROGRESS: TutorialProgress = { seen: [], off: false };

/** Whether the guided start still has steps to show. */
export function guidedPending(p: TutorialProgress): boolean {
  return !p.off && TIPS.some((t) => t.guided && !p.seen.includes(t.id));
}

/**
 * The tip to show now, if any. The guided start only runs before the first
 * wave of a run; contextual tips appear the first time their moment comes.
 */
export function dueTip(p: TutorialProgress, s: GameState, salvage: number): TipId | null {
  if (p.off) return null;
  // Nothing pops up over the perk draft.
  if (s.perkOffer && s.phase === "prep") return null;
  if (s.wave === 1 && s.phase === "prep") {
    const g = TIPS.find((t) => t.guided && !p.seen.includes(t.id));
    if (g) return g.id;
  }
  for (const t of TIPS) {
    if (t.guided || p.seen.includes(t.id) || !t.when) continue;
    if (t.when(s, salvage)) return t.id;
  }
  return null;
}

/** Mark a tip as seen (returns a new progress object). */
export function markSeen(p: TutorialProgress, id: TipId): TutorialProgress {
  return p.seen.includes(id) ? p : { ...p, seen: [...p.seen, id] };
}

/** Skip the tutorial: the guided start ends and no more tips pop up. */
export function skipTutorial(p: TutorialProgress): TutorialProgress {
  return { seen: [...new Set([...p.seen, ...TIPS.filter((t) => t.guided).map((t) => t.id)])], off: true };
}

/** Read stored progress, tolerating anything malformed. */
export function parseProgress(raw: string | null): TutorialProgress {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<TutorialProgress> | null;
    if (!v || typeof v !== "object") return { ...NEW_PROGRESS };
    const ids = new Set(TIPS.map((t) => t.id as string));
    const seen = Array.isArray(v.seen) ? (v.seen.filter((x) => typeof x === "string" && ids.has(x)) as TipId[]) : [];
    return { seen, off: v.off === true };
  } catch {
    return { ...NEW_PROGRESS };
  }
}

// --- Card layout (shared by drawing and tap handling) ---------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CardButtonId = "ok" | "skip" | "back" | "next" | "close";
export interface CardLayout {
  card: Rect;
  title: string;
  lines: string[];
  /** "2 of 14" in the reference; empty otherwise. */
  counter: string;
  buttons: { id: CardButtonId; label: string; rect: Rect; primary: boolean; enabled: boolean }[];
}

/** Characters per line for the 25 px body text across the card. Conservative so nothing spills. */
export const CARD_CHARS = 52;
export const CARD_LINE = 34;

/** How wide a line of body text is, in world units (the game measures with its real font). */
export type Measure = (text: string) => number;

/** Body text area inside a card: card width minus padding, with a little slack for font rounding. */
export const CARD_TEXT_WIDTH = 720 - 60 - 2 * 28 - 12;

/**
 * Greedy word wrap. With `measure`, a line holds as many words as fit in
 * `maxWidth` of real text; without it (tests, no canvas) at most `max` characters.
 */
export function wrap(text: string, max = CARD_CHARS, measure?: Measure, maxWidth = CARD_TEXT_WIDTH): string[] {
  const fits = (candidate: string) => (measure ? measure(candidate) <= maxWidth : candidate.length <= max);
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (fits(line + " " + word)) line += " " + word;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Lay out a tip card. `mode` is "guided" (Got it / Skip tutorial), "tip"
 * (Got it only), or "help" with the page number (Back / Next / Close).
 */
export function cardLayout(
  cfg: GameConfig,
  id: TipId,
  mode: { kind: "guided" } | { kind: "tip" } | { kind: "help"; index: number },
  measure?: Measure,
): CardLayout {
  const tip = tipById(id);
  const W = cfg.world.width;
  const H = cfg.world.height;
  const pad = 28;
  const x = 30;
  const w = W - 60;
  const lines = wrap(tip.body, CARD_CHARS, measure, w - 2 * pad - 12);
  const h = 96 + lines.length * CARD_LINE + 24 + 72 + pad;
  // Help cards sit in the middle; tips that point at the field sit at the top.
  const y = mode.kind === "help" || tip.where === "middle" ? Math.round(H / 2 - h / 2 - 60) : 136;
  const by = y + h - pad - 72;
  const buttons: CardLayout["buttons"] = [];
  if (mode.kind === "help") {
    const n = TIPS.length;
    buttons.push(
      { id: "back", label: "‹ Back", rect: { x: x + pad, y: by, w: 170, h: 72 }, primary: false, enabled: mode.index > 0 },
      { id: "close", label: "Close", rect: { x: x + w / 2 - 95, y: by, w: 190, h: 72 }, primary: false, enabled: true },
      { id: "next", label: "Next ›", rect: { x: x + w - pad - 170, y: by, w: 170, h: 72 }, primary: true, enabled: mode.index < n - 1 },
    );
  } else {
    if (tip.kind === "info") buttons.push({ id: "ok", label: "Got it", rect: { x: x + w - pad - 220, y: by, w: 220, h: 72 }, primary: true, enabled: true });
    if (mode.kind === "guided") buttons.push({ id: "skip", label: "Skip tutorial", rect: { x: x + pad, y: by, w: 250, h: 72 }, primary: false, enabled: true });
  }
  return {
    card: { x, y, w, h },
    title: tip.title,
    lines,
    counter: mode.kind === "help" ? `Z.V.H.M. ${mode.index + 1}/${TIPS.length}` : "",
    buttons,
  };
}
