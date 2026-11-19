/**
 * Small synthesized audio: named sounds built from tones and filtered noise,
 * a mute switch, and a looping backing track whose drive follows an
 * intensity value. No samples, no files. Silent (and harmless) where Web
 * Audio is missing, and until `unlock()` is called from a user gesture.
 */

export interface ToneVoice {
  kind: "tone";
  wave: OscillatorType;
  freq: number;
  /** Glide to this frequency over the voice's length. */
  to?: number;
  seconds: number;
  gain: number;
  /** Start this many seconds after the sound is triggered. */
  at?: number;
}

export interface NoiseVoice {
  kind: "noise";
  seconds: number;
  gain: number;
  /** Low-pass cutoff in Hz, optionally sweeping to `filterTo`. */
  filter: number;
  filterTo?: number;
  at?: number;
}

export type Voice = ToneVoice | NoiseVoice;

export interface SoundSpec {
  voices: Voice[];
  /** Ignore repeats closer together than this (seconds). */
  minGap?: number;
}

export interface MusicSpec {
  /** Base pitch (Hz) and the bass line in semitones from it, one per beat. */
  root: number;
  line: number[];
  /** Beats per minute at intensity 0 and 1. */
  bpm: [number, number];
}

export interface GameAudio {
  /** Call from a tap or click: browsers only allow sound after a gesture. */
  unlock(): void;
  play(name: string): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** 0..1 drives the backing track; null stops it. */
  setIntensity(level: number | null): void;
  /** Silence everything while the page is in the background. */
  setPaused(paused: boolean): void;
}

/** Per-name rate limit, kept separate so it can be tested without audio. */
export function createThrottle(): (name: string, now: number, minGap: number) => boolean {
  const last = new Map<string, number>();
  return (name, now, minGap) => {
    const t = last.get(name);
    if (t !== undefined && now - t < minGap) return false;
    last.set(name, now);
    return true;
  };
}

type Ctx = AudioContext;

export function createAudio(sounds: Record<string, SoundSpec>, music?: MusicSpec, makeContext?: () => Ctx | null): GameAudio {
  let ctx: Ctx | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = false;
  let intensity: number | null = null;
  let nextBeat = 0;
  let beat = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const allow = createThrottle();

  const make =
    makeContext ??
    (() => {
      const C = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      return C ? new C() : null;
    });

  function ensure(): boolean {
    if (ctx) return true;
    try {
      ctx = make();
    } catch {
      ctx = null;
    }
    if (!ctx) return false;
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(comp);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function voice(v: Voice, start: number, scale = 1): void {
    if (!ctx || !master) return;
    const t0 = start + (v.at ?? 0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v.gain * scale), t0 + Math.min(0.01, v.seconds / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + v.seconds);
    g.connect(master);
    if (v.kind === "tone") {
      const o = ctx.createOscillator();
      o.type = v.wave;
      o.frequency.setValueAtTime(v.freq, t0);
      if (v.to) o.frequency.exponentialRampToValueAtTime(Math.max(1, v.to), t0 + v.seconds);
      o.connect(g);
      o.start(t0);
      o.stop(t0 + v.seconds + 0.02);
    } else if (noise) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(v.filter, t0);
      if (v.filterTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, v.filterTo), t0 + v.seconds);
      src.connect(f);
      f.connect(g);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + v.seconds + 0.02);
    }
  }

  // Backing track: schedule a little ahead on a timer.
  function schedule(): void {
    if (!ctx || !music || intensity === null || muted) return;
    const k = Math.max(0, Math.min(1, intensity));
    const spb = 60 / (music.bpm[0] + (music.bpm[1] - music.bpm[0]) * k);
    if (nextBeat < ctx.currentTime) nextBeat = ctx.currentTime + 0.05;
    while (nextBeat < ctx.currentTime + 0.3) {
      const semis = music.line[beat % music.line.length]!;
      const f = music.root * Math.pow(2, semis / 12);
      voice({ kind: "tone", wave: "triangle", freq: f, seconds: spb * 0.9, gain: 0.05 + 0.07 * k }, nextBeat);
      if (k > 0.45 && beat % 2 === 1) voice({ kind: "noise", seconds: 0.05, gain: 0.03 + 0.04 * k, filter: 7000 }, nextBeat);
      if (k > 0.8 && beat % 4 === 0) voice({ kind: "tone", wave: "sine", freq: 55, to: 40, seconds: 0.25, gain: 0.12 }, nextBeat);
      nextBeat += spb;
      beat++;
    }
  }

  return {
    unlock() {
      if (!ensure() || !ctx) return;
      if (ctx.state === "suspended") void ctx.resume();
      if (music && !timer) timer = setInterval(schedule, 100);
    },
    play(name) {
      const spec = sounds[name];
      if (!spec || muted || !ctx || ctx.state !== "running") return;
      if (!allow(name, ctx.currentTime, spec.minGap ?? 0.03)) return;
      for (const v of spec.voices) voice(v, ctx.currentTime);
    },
    setMuted(m) {
      muted = m;
      if (ctx && master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.02);
    },
    get muted() {
      return muted;
    },
    setIntensity(level) {
      intensity = level;
    },
    setPaused(paused) {
      if (!ctx) return;
      if (paused && ctx.state === "running") void ctx.suspend();
      if (!paused && ctx.state === "suspended") void ctx.resume();
    },
  };
}
