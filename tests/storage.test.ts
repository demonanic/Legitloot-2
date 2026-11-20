import { test } from "node:test";
import assert from "node:assert/strict";
import { SAVE_KEYS, migrateSaves, saveKey } from "../games/zvhm/storage.js";

function store(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test("storage: saves use the zvhm. prefix", () => {
  assert.equal(saveKey("salvage"), "zvhm.salvage");
  assert.deepEqual([...SAVE_KEYS].sort(), ["ranges", "salvage", "sound", "survivors", "tutorial"]);
});

test("storage: old zid. saves carry over once, and the old keys stay", () => {
  const s = store({ "zid.salvage": "340", "zid.survivors": '["scout"]', "zid.sound": "off", "unrelated": "x" });
  assert.deepEqual(migrateSaves(s).sort(), ["salvage", "sound", "survivors"]);
  assert.equal(s.getItem("zvhm.salvage"), "340");
  assert.equal(s.getItem("zvhm.survivors"), '["scout"]');
  assert.equal(s.getItem("zvhm.sound"), "off");
  assert.equal(s.getItem("zvhm.tutorial"), null, "nothing to copy");
  assert.equal(s.getItem("zid.salvage"), "340", "old key left alone");
  assert.deepEqual(migrateSaves(s), [], "second load copies nothing");
});

test("storage: newer saves are never overwritten by old ones", () => {
  const s = store({ "zid.salvage": "10", "zvhm.salvage": "900" });
  assert.deepEqual(migrateSaves(s), []);
  assert.equal(s.getItem("zvhm.salvage"), "900");
});
