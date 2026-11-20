import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig } from "../games/zvhm/config.js";
import { buildStructure, choosePerk, createState, startWaveNow, step } from "../games/zvhm/sim.js";
import {
  CARD_CHARS,
  NEW_PROGRESS,
  TIPS,
  cardLayout,
  dueTip,
  guidedPending,
  markSeen,
  parseProgress,
  skipTutorial,
  tipById,
  wrap,
  type TipId,
  type TutorialProgress,
} from "../games/zvhm/tutorial.js";

const cfg = { ...baseConfig, pickups: { ...baseConfig.pickups, everyMax: 0 } };
const GUIDED: TipId[] = ["welcome", "supplies", "build", "manage", "start"];

test("guided start: a new player gets the steps in order, before wave 1, one at a time", () => {
  const s = createState(cfg, 1);
  let p: TutorialProgress = { ...NEW_PROGRESS };
  const shown: TipId[] = [];
  for (let i = 0; i < 10; i++) {
    const t = dueTip(p, s, 0);
    if (!t || !tipById(t).guided) break;
    shown.push(t);
    p = markSeen(p, t);
  }
  assert.deepEqual(shown, GUIDED);
  assert.equal(guidedPending(p), false);
});

test("guided start: the build step waits until a weapon is actually built", () => {
  const tip = tipById("build");
  assert.equal(tip.kind, "do");
  const s = createState(cfg, 1);
  assert.equal(tip.done!(s), false);
  assert.ok(buildStructure(s, cfg, "barricade", 3, 9).ok);
  assert.equal(tip.done!(s), false, "a barricade isn't a weapon");
  assert.ok(buildStructure(s, cfg, "machine-gun", 6, 9).ok);
  assert.equal(tip.done!(s), true);
});

test("guided start: only offered before the first wave; later the one-time tips take over", () => {
  const s = createState(cfg, 1);
  startWaveNow(s, cfg);
  assert.equal(dueTip({ ...NEW_PROGRESS }, s, 0), "wave");
});

test("one-time tips: each appears when its moment comes, and never again once seen", () => {
  const all = GUIDED.reduce((p, id) => markSeen(p, id), { ...NEW_PROGRESS } as TutorialProgress);
  const s = createState(cfg, 1);
  assert.equal(dueTip(all, s, 0), null, "nothing to say yet");
  startWaveNow(s, cfg);
  assert.equal(dueTip(all, s, 0), "wave");
  const p = markSeen(all, "wave");
  assert.equal(dueTip(p, s, 0), null);
  s.pickups.push({ id: 1, kind: "supplies", x: 200, y: 400, amount: 10, life: 5 });
  assert.equal(dueTip(p, s, 0), "pickup");
  s.pickups = [];
  s.charge = 1;
  assert.equal(dueTip(p, s, 0), "charge");
  s.charge = 0;
  // After the first wave: the base menu.
  s.enemies = [];
  s.nextSpawn = s.spawns.length;
  step(s, cfg, 1 / 30);
  assert.equal(s.phase, "prep");
  // The perk draft comes first; no tip covers it.
  assert.ok(s.perkOffer);
  assert.equal(dueTip(p, s, 0), null);
  choosePerk(s, s.perkOffer[0]!);
  assert.equal(dueTip(p, s, 0), "base");
  // Salvage once there is some.
  const pb = markSeen(p, "base");
  assert.equal(dueTip(pb, s, 0), "preview");
  const q = markSeen(pb, "preview");
  assert.equal(dueTip(q, s, 0), null);
  assert.equal(dueTip(q, s, 30), "salvage");
  // Defeat.
  s.phase = "lost";
  assert.equal(dueTip(q, s, 0), "defeat");
});

test("skipping ends the guided start and stops automatic tips; the reference still has everything", () => {
  const p = skipTutorial({ ...NEW_PROGRESS });
  const s = createState(cfg, 1);
  assert.equal(dueTip(p, s, 0), null);
  startWaveNow(s, cfg);
  assert.equal(dueTip(p, s, 0), null);
  assert.equal(guidedPending(p), false);
  assert.ok(TIPS.length >= 12);
});

test("stored progress survives a round trip and junk is ignored", () => {
  const p = markSeen(markSeen({ ...NEW_PROGRESS }, "welcome"), "pickup");
  assert.deepEqual(parseProgress(JSON.stringify(p)), p);
  assert.deepEqual(parseProgress(null), NEW_PROGRESS);
  assert.deepEqual(parseProgress("not json"), NEW_PROGRESS);
  assert.deepEqual(parseProgress(JSON.stringify({ seen: ["welcome", "nonsense", 7], off: "yes" })), { seen: ["welcome"], off: false });
});

test("every tip fits on screen: wrapped lines stay short and every card and button is inside the world", () => {
  const W = cfg.world.width;
  const H = cfg.world.height;
  for (const t of TIPS) {
    for (const line of wrap(t.body)) assert.ok(line.length <= CARD_CHARS, `${t.id}: "${line}"`);
    const modes = [{ kind: "guided" as const }, { kind: "tip" as const }, { kind: "help" as const, index: TIPS.indexOf(t) }];
    for (const m of modes) {
      const c = cardLayout(cfg, t.id, m);
      assert.ok(c.card.x >= 0 && c.card.y >= 0 && c.card.x + c.card.w <= W && c.card.y + c.card.h <= H, `${t.id} ${m.kind} card`);
      for (const b of c.buttons) {
        const r = b.rect;
        assert.ok(r.x >= c.card.x && r.y >= c.card.y && r.x + r.w <= c.card.x + c.card.w && r.y + r.h <= c.card.y + c.card.h, `${t.id} ${b.id} inside card`);
      }
      // Buttons don't overlap each other.
      for (let i = 0; i < c.buttons.length; i++) {
        for (let j = i + 1; j < c.buttons.length; j++) {
          const a = c.buttons[i]!.rect;
          const b = c.buttons[j]!.rect;
          assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${t.id}: ${c.buttons[i]!.id} vs ${c.buttons[j]!.id}`);
        }
      }
    }
  }
});

test("cards: guided info steps offer Got it and Skip; the do step offers only Skip; the reference pages with Back and Next", () => {
  const ids = (id: TipId, m: Parameters<typeof cardLayout>[2]) => cardLayout(cfg, id, m).buttons.map((b) => b.id);
  assert.deepEqual(ids("welcome", { kind: "guided" }), ["ok", "skip"]);
  assert.deepEqual(ids("build", { kind: "guided" }), ["skip"]);
  assert.deepEqual(ids("pickup", { kind: "tip" }), ["ok"]);
  const first = cardLayout(cfg, TIPS[0]!.id, { kind: "help", index: 0 });
  assert.deepEqual(first.buttons.map((b) => [b.id, b.enabled]), [["back", false], ["close", true], ["next", true]]);
  const last = cardLayout(cfg, TIPS[TIPS.length - 1]!.id, { kind: "help", index: TIPS.length - 1 });
  assert.equal(last.buttons.find((b) => b.id === "next")!.enabled, false);
  assert.equal(first.counter, `Z.V.H.M. 1/${TIPS.length}`);
  // The do step sits at the top, leaving the field near the stronghold free to tap.
  assert.ok(cardLayout(cfg, "build", { kind: "guided" }).card.y + cardLayout(cfg, "build", { kind: "guided" }).card.h < cfg.stronghold.y - 200);
});
