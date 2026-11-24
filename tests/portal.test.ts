import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig } from "../games/zvhm/config.js";
import { createState } from "../games/zvhm/sim.js";
import { createPortalReporter, parentPoster, portalStats, type PortalMessage, PORTAL_ORIGIN, PORTAL_QUEUE_LIMIT } from "../games/zvhm/portal.js";

function recorder() {
  const sent: PortalMessage[] = [];
  return { sent, reporter: createPortalReporter((m) => sent.push(m), "0.1.0") };
}

test("portal: a new run sends run-start once", () => {
  const { sent, reporter } = recorder();
  const s = createState(baseConfig, 1);
  reporter.update(s);
  reporter.update(s);
  assert.deepEqual(sent, [{ type: "legitloot:game", version: 1, game: "zvhm", event: "run-start", clientVersion: "0.1.0" }]);
});

test("portal: one checkpoint per cleared wave, with whole-number totals", () => {
  const { sent, reporter } = recorder();
  const s = createState(baseConfig, 1);
  reporter.update(s);
  s.kills = 40;
  reporter.update(s);
  assert.equal(sent.length, 1, "kills alone send nothing");
  s.wavesCleared = 1;
  reporter.update(s);
  reporter.update(s);
  s.wavesCleared = 2;
  s.kills = 95;
  s.bossesKilled = 0;
  reporter.update(s);
  assert.deepEqual(sent.slice(1).map((m) => [m.event, m.stats]), [
    ["checkpoint", { waves_cleared: 1, kills: 40, bosses_killed: 0 }],
    ["checkpoint", { waves_cleared: 2, kills: 95, bosses_killed: 0 }],
  ]);
});

test("portal: defeat sends run-end once, then a restart is a new run", () => {
  const { sent, reporter } = recorder();
  const s = createState(baseConfig, 1);
  reporter.update(s);
  s.wavesCleared = 4;
  s.kills = 210;
  s.bossesKilled = 0;
  s.phase = "lost";
  reporter.update(s);
  reporter.update(s);
  assert.deepEqual(sent.map((m) => m.event), ["run-start", "run-end"], "defeat after clearing waves still ends once");
  assert.deepEqual(sent[1]!.stats, { waves_cleared: 4, kills: 210, bosses_killed: 0 });
  const next = createState(baseConfig, 2);
  reporter.update(next);
  assert.deepEqual(sent.map((m) => m.event), ["run-start", "run-end", "run-start"]);
});

test("portal: stats are clean non-negative integers", () => {
  assert.deepEqual(portalStats({ wavesCleared: 3, kills: 12.7, bossesKilled: -1 }), { waves_cleared: 3, kills: 12, bosses_killed: 0 });
  assert.deepEqual(portalStats({ wavesCleared: NaN, kills: Infinity, bossesKilled: 1 }), { waves_cleared: 0, kills: 0, bosses_killed: 1 });
});

function fakeWindow(postMessage: (m: unknown, origin: string) => void) {
  const parent = { postMessage };
  let listener: ((e: MessageEvent) => void) | null = null;
  const win = {
    parent,
    addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type === "message") listener = fn;
    },
  };
  const deliver = (origin: string, data: unknown, source: unknown = parent) =>
    listener!({ origin, data, source } as unknown as MessageEvent);
  return { win: win as unknown as Window, deliver };
}
const start = { type: "legitloot:game", version: 1, game: "zvhm", event: "run-start" } as const;

test("portal: nothing is sent when the game is not embedded", () => {
  const alone = { addEventListener: () => {} } as unknown as Window;
  (alone as unknown as { parent: Window }).parent = alone;
  assert.equal(parentPoster(alone), null);
});

test("portal: holds messages until legitloot.site says ready, then sends them in order", () => {
  const posts: [unknown, string][] = [];
  const { win, deliver } = fakeWindow((m, origin) => posts.push([m, origin]));
  const post = parentPoster(win)!;
  post(start);
  post({ ...start, event: "checkpoint", stats: { waves_cleared: 1, kills: 3, bosses_killed: 0 } });
  assert.equal(posts.length, 0, "held until ready");
  deliver("https://evil.example", { type: "legitloot:portal", event: "ready" });
  deliver(PORTAL_ORIGIN, { type: "legitloot:portal", event: "ready" }, {});
  deliver(PORTAL_ORIGIN, { type: "legitloot:portal", event: "other" });
  assert.equal(posts.length, 0, "wrong origin, source or event is ignored");
  deliver(PORTAL_ORIGIN, { type: "legitloot:portal", event: "ready" });
  assert.deepEqual(posts.map(([m]) => (m as PortalMessage).event), ["run-start", "checkpoint"]);
  assert.ok(posts.every(([, origin]) => origin === "https://legitloot.site"));
  post({ ...start, event: "run-end", stats: { waves_cleared: 1, kills: 4, bosses_killed: 0 } });
  assert.equal(posts.length, 3, "sent straight away once ready");
});

test("portal: the hold queue is bounded and posting never throws", () => {
  const posts: unknown[] = [];
  const { win, deliver } = fakeWindow((m) => posts.push(m));
  const post = parentPoster(win)!;
  for (let i = 0; i < PORTAL_QUEUE_LIMIT + 50; i++) post(start);
  deliver(PORTAL_ORIGIN, { type: "legitloot:portal", event: "ready" });
  assert.equal(posts.length, PORTAL_QUEUE_LIMIT);

  const { win: w2, deliver: d2 } = fakeWindow(() => {
    throw new Error("blocked");
  });
  const p2 = parentPoster(w2)!;
  d2(PORTAL_ORIGIN, { type: "legitloot:portal", event: "ready" });
  assert.doesNotThrow(() => p2(start));
});
