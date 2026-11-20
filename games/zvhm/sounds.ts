/**
 * What the game sounds like, and when. `soundEvents` compares two moments of
 * the game and names the sounds that should play; it is pure, so it is tested
 * without audio. The engine's synth plays them.
 */
import type { MusicSpec, SoundSpec } from "../../engine/audio/audio.js";
import type { GameState, StructureKind } from "./sim.js";

export type SoundName =
  | "shot"
  | "shotgun"
  | "flame"
  | "zap"
  | "beam"
  | "cannon"
  | "rocket"
  | "blast"
  | "acid"
  | "stomp"
  | "spit"
  | "hit"
  | "wreck"
  | "build"
  | "coin"
  | "wave"
  | "warning"
  | "cleared"
  | "boss"
  | "bossDown"
  | "perk"
  | "lost";

export const SOUNDS: Record<SoundName, SoundSpec> = {
  shot: { minGap: 0.06, voices: [{ kind: "noise", seconds: 0.05, gain: 0.07, filter: 3200, filterTo: 900 }] },
  shotgun: { minGap: 0.12, voices: [{ kind: "noise", seconds: 0.14, gain: 0.16, filter: 2200, filterTo: 300 }] },
  flame: { minGap: 0.14, voices: [{ kind: "noise", seconds: 0.18, gain: 0.06, filter: 900, filterTo: 500 }] },
  zap: {
    minGap: 0.1,
    voices: [
      { kind: "tone", wave: "sawtooth", freq: 900, to: 1600, seconds: 0.1, gain: 0.05 },
      { kind: "noise", seconds: 0.08, gain: 0.05, filter: 6000 },
    ],
  },
  beam: {
    minGap: 0.2,
    voices: [
      { kind: "tone", wave: "sine", freq: 2200, to: 180, seconds: 0.45, gain: 0.12 },
      { kind: "noise", seconds: 0.3, gain: 0.1, filter: 5000, filterTo: 400 },
    ],
  },
  cannon: { minGap: 0.12, voices: [{ kind: "tone", wave: "sine", freq: 140, to: 55, seconds: 0.22, gain: 0.18 }, { kind: "noise", seconds: 0.1, gain: 0.08, filter: 1200 }] },
  rocket: { minGap: 0.12, voices: [{ kind: "noise", seconds: 0.35, gain: 0.08, filter: 500, filterTo: 2500 }] },
  blast: {
    minGap: 0.08,
    voices: [
      { kind: "noise", seconds: 0.55, gain: 0.3, filter: 1400, filterTo: 120 },
      { kind: "tone", wave: "sine", freq: 90, to: 35, seconds: 0.4, gain: 0.22 },
    ],
  },
  acid: {
    minGap: 0.08,
    voices: [
      { kind: "noise", seconds: 0.4, gain: 0.22, filter: 1800, filterTo: 300 },
      { kind: "tone", wave: "square", freq: 300, to: 90, seconds: 0.2, gain: 0.06 },
    ],
  },
  stomp: {
    minGap: 0.3,
    voices: [
      { kind: "tone", wave: "sine", freq: 70, to: 28, seconds: 0.5, gain: 0.35 },
      { kind: "noise", seconds: 0.4, gain: 0.18, filter: 350, filterTo: 80 },
    ],
  },
  spit: { minGap: 0.15, voices: [{ kind: "tone", wave: "square", freq: 520, to: 220, seconds: 0.09, gain: 0.04 }] },
  hit: { minGap: 0.25, voices: [{ kind: "tone", wave: "square", freq: 170, to: 95, seconds: 0.12, gain: 0.09 }] },
  wreck: {
    minGap: 0.2,
    voices: [
      { kind: "noise", seconds: 0.7, gain: 0.25, filter: 900, filterTo: 90 },
      { kind: "tone", wave: "sawtooth", freq: 110, to: 30, seconds: 0.5, gain: 0.08 },
    ],
  },
  build: { voices: [{ kind: "tone", wave: "square", freq: 330, to: 520, seconds: 0.09, gain: 0.07 }, { kind: "noise", seconds: 0.05, gain: 0.05, filter: 2500 }] },
  coin: {
    minGap: 0.08,
    voices: [
      { kind: "tone", wave: "sine", freq: 988, seconds: 0.08, gain: 0.08 },
      { kind: "tone", wave: "sine", freq: 1319, seconds: 0.14, gain: 0.08, at: 0.07 },
    ],
  },
  wave: {
    minGap: 1,
    voices: [
      { kind: "tone", wave: "sawtooth", freq: 110, seconds: 1.1, gain: 0.1 },
      { kind: "tone", wave: "sawtooth", freq: 165, seconds: 1.1, gain: 0.07 },
    ],
  },
  warning: {
    minGap: 1,
    voices: [
      { kind: "tone", wave: "triangle", freq: 440, to: 660, seconds: 0.35, gain: 0.1 },
      { kind: "tone", wave: "triangle", freq: 440, to: 660, seconds: 0.35, gain: 0.1, at: 0.45 },
    ],
  },
  cleared: {
    minGap: 1,
    voices: [
      { kind: "tone", wave: "triangle", freq: 523, seconds: 0.14, gain: 0.1 },
      { kind: "tone", wave: "triangle", freq: 659, seconds: 0.14, gain: 0.1, at: 0.12 },
      { kind: "tone", wave: "triangle", freq: 784, seconds: 0.3, gain: 0.1, at: 0.24 },
    ],
  },
  boss: {
    minGap: 1,
    voices: [
      { kind: "tone", wave: "sawtooth", freq: 95, to: 48, seconds: 1.3, gain: 0.16 },
      { kind: "noise", seconds: 1.1, gain: 0.12, filter: 500, filterTo: 150 },
    ],
  },
  bossDown: {
    minGap: 1,
    voices: [
      { kind: "noise", seconds: 0.8, gain: 0.3, filter: 1200, filterTo: 80 },
      { kind: "tone", wave: "triangle", freq: 392, seconds: 0.18, gain: 0.1, at: 0.25 },
      { kind: "tone", wave: "triangle", freq: 523, seconds: 0.18, gain: 0.1, at: 0.4 },
      { kind: "tone", wave: "triangle", freq: 784, seconds: 0.45, gain: 0.1, at: 0.55 },
    ],
  },
  perk: {
    voices: [
      { kind: "tone", wave: "sine", freq: 784, seconds: 0.12, gain: 0.09 },
      { kind: "tone", wave: "sine", freq: 1047, seconds: 0.12, gain: 0.09, at: 0.09 },
      { kind: "tone", wave: "sine", freq: 1319, seconds: 0.3, gain: 0.09, at: 0.18 },
    ],
  },
  lost: {
    minGap: 2,
    voices: [
      { kind: "tone", wave: "sawtooth", freq: 330, to: 82, seconds: 1.6, gain: 0.12 },
      { kind: "noise", seconds: 1.2, gain: 0.15, filter: 600, filterTo: 60 },
    ],
  },
};

/** A slow, low backing line; it quickens and fills out as the fight heats up. */
export const MUSIC: MusicSpec = { root: 55, line: [0, 0, 3, 0, 5, 0, 3, 2], bpm: [70, 128] };

const KIND_SOUND: Partial<Record<StructureKind, SoundName>> = {
  "machine-gun": "shot",
  gatling: "shot",
  shotgun: "shotgun",
  flamer: "flame",
  tesla: "zap",
  railgun: "beam",
  mortar: "cannon",
  rocket: "rocket",
};

/** The few facts sound depends on, taken after each step. */
export interface SoundSnapshot {
  phase: GameState["phase"];
  shots: Map<number, number>;
  shotsFired: number;
  blasts: Set<object>;
  spits: Set<object>;
  hp: number;
  wrecked: number;
  built: number;
  bosses: Set<number>;
  bossesKilled: number;
  perkLevels: number;
}

export function soundSnapshot(s: GameState): SoundSnapshot {
  return {
    phase: s.phase,
    shots: new Map(s.structures.filter((st) => st.turret).map((st) => [st.id, st.turret!.shots])),
    shotsFired: s.shotsFired,
    blasts: new Set(s.blasts),
    spits: new Set(s.spits),
    hp: s.stronghold.hp,
    wrecked: s.structures.filter((st) => st.destroyed).length,
    built: s.nextStructureId,
    bosses: new Set(s.enemies.filter((e) => e.type === "boss").map((e) => e.id)),
    bossesKilled: s.bossesKilled,
    perkLevels: Object.values(s.perks).reduce((n, v) => n + (v ?? 0), 0),
  };
}

/** Sounds for what changed between two snapshots, loudest moments first. */
export function soundEvents(prev: SoundSnapshot, now: SoundSnapshot): SoundName[] {
  const out: SoundName[] = [];
  const add = (n: SoundName) => {
    if (!out.includes(n)) out.push(n);
  };
  if (prev.phase !== now.phase) {
    if (now.phase === "lost") add("lost");
    else if (now.phase === "wave") add("wave");
    else if (now.phase === "warning") add("warning");
    else if (now.phase === "prep" && prev.phase === "wave") add("cleared");
  }
  if (now.bossesKilled > prev.bossesKilled) add("bossDown");
  for (const id of now.bosses) if (!prev.bosses.has(id)) add("boss");
  if (now.perkLevels > prev.perkLevels) add("perk");
  if (now.wrecked > prev.wrecked) add("wreck");
  for (const b of now.blasts as Set<{ kind?: string }>) {
    if (prev.blasts.has(b)) continue;
    add(b.kind === "stomp" ? "stomp" : b.kind === "acid" ? "acid" : "blast");
  }
  if (now.hp < prev.hp && now.phase !== "lost") add("hit");
  for (const sp of now.spits) if (!prev.spits.has(sp)) add("spit");
  if (now.built > prev.built) add("build");
  return out;
}

/** Which weapon sounds to play: one per kind that fired since the last snapshot. */
export function weaponSounds(prev: SoundSnapshot, now: SoundSnapshot, kindOf: (id: number) => StructureKind | undefined): SoundName[] {
  const out: SoundName[] = [];
  for (const [id, n] of now.shots) {
    const before = prev.shots.get(id) ?? n;
    if (n <= before) continue;
    const k = kindOf(id);
    const name = k ? KIND_SOUND[k] : undefined;
    if (name && !out.includes(name)) out.push(name);
  }
  // Survivors shoot too; their shots only show in the total.
  const turret = [...now.shots].reduce((n, [id, v]) => n + Math.max(0, v - (prev.shots.get(id) ?? v)), 0);
  if (now.shotsFired - prev.shotsFired > turret && !out.includes("shot")) out.push("shot");
  return out;
}

/** How hard the backing track drives: calm in the break, building in the warning, full with a boss out. */
export function musicIntensity(s: GameState): number | null {
  if (s.phase === "lost") return null;
  if (s.phase === "prep") return 0.15;
  if (s.phase === "warning") return 0.5;
  const boss = s.enemies.some((e) => e.type === "boss" && e.hp > 0);
  return boss ? 1 : 0.6;
}
