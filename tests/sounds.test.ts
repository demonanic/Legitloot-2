import { test } from "node:test";
import assert from "node:assert/strict";
import { createAudio, createThrottle } from "../engine/audio/audio.js";
import { baseConfig } from "../games/zid/config.js";
import { buildMortar, buildTurret, choosePerk, createState, startWaveNow, step, type GameState } from "../games/zid/sim.js";
import { MUSIC, SOUNDS, musicIntensity, soundEvents, soundSnapshot, weaponSounds, type SoundName } from "../games/zid/sounds.js";

const cfg = baseConfig;
const DT = 1 / 30;

/** A stand-in AudioContext that records what gets started. */
function fakeContext() {
  const started: string[] = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect() {}, gain: param(), frequency: param() });
  const ctx = {
    state: "running",
    currentTime: 0,
    suspend: async function (this: { state: string }) {
      this.state = "suspended";
    },
    sampleRate: 8000,
    destination: {},
    resume: async () => {},
    createDynamicsCompressor: node,
    createGain: node,
    createBiquadFilter: () => ({ ...node(), type: "" }),
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
    createOscillator: () => ({ ...node(), type: "", start: () => started.push("tone"), stop() {} }),
    createBufferSource: () => ({ ...node(), buffer: null, loop: false, start: () => started.push("noise"), stop() {} }),
  };
  return { ctx, started };
}

test("audio: repeats closer than the gap are dropped, per sound", () => {
  const allow = createThrottle();
  assert.ok(allow("a", 0, 0.1));
  assert.ok(!allow("a", 0.05, 0.1));
  assert.ok(allow("b", 0.05, 0.1), "other sounds are independent");
  assert.ok(allow("a", 0.11, 0.1));
});

test("audio: without Web Audio everything is a harmless no-op", () => {
  const a = createAudio(SOUNDS, MUSIC, () => null);
  a.unlock();
  a.play("shot");
  a.setIntensity(1);
  a.setMuted(true);
  assert.equal(a.muted, true);
});

test("audio: nothing plays before unlock; after it each voice starts; muted plays nothing", () => {
  const { ctx, started } = fakeContext();
  const a = createAudio(SOUNDS, undefined, () => ctx as unknown as AudioContext);
  a.play("blast");
  assert.equal(started.length, 0, "locked until a tap");
  a.unlock();
  a.play("blast");
  assert.deepEqual(started, ["noise", "tone"]);
  ctx.currentTime = 1;
  a.setMuted(true);
  a.play("blast");
  assert.equal(started.length, 2);
  a.setMuted(false);
  a.play("nope");
  assert.equal(started.length, 2, "unknown names are ignored");
  a.setPaused(true);
  assert.equal(ctx.state, "suspended");
  a.play("shot");
  assert.equal(started.length, 2, "nothing plays in the background");
});

test("sounds: every sound has voices at sane volumes", () => {
  for (const [name, spec] of Object.entries(SOUNDS)) {
    assert.ok(spec.voices.length > 0, name);
    for (const v of spec.voices) {
      assert.ok(v.gain > 0 && v.gain <= 0.4, `${name} gain ${v.gain}`);
      assert.ok(v.seconds > 0 && v.seconds <= 2, name);
    }
  }
});

test("sounds: phase changes ring out", () => {
  const s = createState(cfg, 1);
  let prev = soundSnapshot(s);
  startWaveNow(s, cfg);
  assert.deepEqual(soundEvents(prev, soundSnapshot(s)), ["wave"]);
  prev = soundSnapshot(s);
  s.nextSpawn = s.spawns.length;
  s.enemies = [];
  step(s, cfg, DT);
  assert.ok(soundEvents(prev, soundSnapshot(s)).includes("cleared"));
  prev = soundSnapshot(s);
  s.phase = "lost";
  assert.deepEqual(soundEvents(prev, soundSnapshot(s)), ["lost"]);
});

test("sounds: blasts, stomps, acid, bosses, perks, wrecks, hits and builds each have a cue", () => {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  const ev = (f: (s: GameState) => void): SoundName[] => {
    const prev = soundSnapshot(s);
    f(s);
    return soundEvents(prev, soundSnapshot(s));
  };
  assert.deepEqual(ev((x) => buildTurret(x, cfg, 4, 4)), ["build"]);
  assert.deepEqual(ev((x) => x.blasts.push({ x: 0, y: 0, r: 10, life: 1 })), ["blast"]);
  assert.deepEqual(ev((x) => x.blasts.push({ x: 0, y: 0, r: 10, life: 1, kind: "stomp" })), ["stomp"]);
  assert.deepEqual(ev((x) => x.blasts.push({ x: 0, y: 0, r: 10, life: 1, kind: "acid" })), ["acid"]);
  assert.deepEqual(ev(() => {}), [], "old blasts stay quiet");
  assert.deepEqual(ev((x) => x.spits.push({ sx: 0, sy: 0, tx: 1, ty: 1, total: 1, left: 1, damage: 1, target: 1 })), ["spit"]);
  assert.deepEqual(ev((x) => x.enemies.push({ id: 99, type: "boss", maxHp: 1, hp: 1, x: 0, y: 0, attackCooldown: 0, attacking: false })), ["boss"]);
  assert.deepEqual(ev((x) => (x.bossesKilled += 1)), ["bossDown"]);
  assert.deepEqual(ev((x) => (x.stronghold.hp -= 5)), ["hit"]);
  assert.deepEqual(ev((x) => (x.structures[0]!.destroyed = true)), ["wreck"]);
  assert.deepEqual(
    ev((x) => {
      x.perkOffer = ["scavenger"];
      choosePerk(x, "scavenger");
    }),
    ["perk"],
  );
});

test("sounds: each weapon kind that fires gets its own sound, once per step", () => {
  const s = createState(cfg, 1);
  s.currency = 10_000;
  const g = buildTurret(s, cfg, 4, 4);
  const m = buildMortar(s, cfg, 6, 4);
  assert.ok(g.ok && m.ok);
  const kinds = new Map(s.structures.map((st) => [st.id, st.kind]));
  const prev = soundSnapshot(s);
  g.structure.turret!.shots += 3;
  m.structure.turret!.shots += 1;
  s.shotsFired += 4;
  assert.deepEqual(weaponSounds(prev, soundSnapshot(s), (id) => kinds.get(id)).sort(), ["cannon", "shot"]);
  const p2 = soundSnapshot(s);
  s.shotsFired += 1; // a survivor's shot
  assert.deepEqual(weaponSounds(p2, soundSnapshot(s), (id) => kinds.get(id)), ["shot"]);
});

test("sounds: a real wave makes the expected noise", () => {
  const s = createState(cfg, 2);
  s.currency = 10_000;
  for (const [c, r] of [[2, 9], [7, 9], [4, 7]] as const) buildTurret(s, cfg, c, r);
  // Hold out whatever happens: this test is about the sounds, not the fight.
  s.stronghold.hp = s.stronghold.maxHp = 1e7;
  const kinds = () => new Map(s.structures.map((st) => [st.id, st.kind]));
  let prev = soundSnapshot(s);
  const heard = new Set<string>();
  startWaveNow(s, cfg);
  for (let i = 0; i < 30 * 200 && s.phase === "wave"; i++) {
    step(s, cfg, DT);
    const now = soundSnapshot(s);
    for (const n of [...soundEvents(prev, now), ...weaponSounds(prev, now, (id) => kinds().get(id))]) heard.add(n);
    prev = now;
  }
  for (const n of ["shot", "cleared"]) assert.ok(heard.has(n), `${n} in ${[...heard]}`);
});

test("sounds: the backing track is calm in the break and loudest with a boss out", () => {
  const s = createState(cfg, 1);
  const calm = musicIntensity(s)!;
  s.phase = "wave";
  const fight = musicIntensity(s)!;
  s.enemies.push({ id: 1, type: "boss", maxHp: 1, hp: 1, x: 0, y: 0, attackCooldown: 0, attacking: false });
  const boss = musicIntensity(s)!;
  assert.ok(calm < fight && fight < boss);
  s.phase = "lost";
  assert.equal(musicIntensity(s), null);
});
