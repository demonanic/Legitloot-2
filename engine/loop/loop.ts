/**
 * Fixed-timestep game loop with an explicit lifecycle.
 *
 * Simulation runs at a fixed rate (default 30 Hz) independent of rendering.
 * Long gaps (backgrounded tab, debugger, slow device) are clamped so the
 * simulation never tries to "catch up" with a burst of steps.
 *
 * The clock and frame scheduler are injectable so the loop is fully testable
 * without a browser.
 */

export type LoopState = "idle" | "running" | "paused" | "stopped";

export interface LoopStats {
  /** Rendered frames per second, averaged over the last ~0.5 s. */
  fps: number;
  /** Average milliseconds spent in update() per simulation step. */
  stepMs: number;
  /** Simulation steps performed in the last frame. */
  stepsLastFrame: number;
  /** Total simulation steps since start. */
  totalSteps: number;
  /** Frames whose elapsed time was clamped (long gap or catch-up limit). */
  clampedFrames: number;
}

export interface LoopOptions {
  /** Simulation steps per second. Default 30. */
  stepHz?: number;
  /** Most simulation steps allowed in one frame. Default 5. */
  maxStepsPerFrame?: number;
  /** Elapsed time above this (ms) is treated as a gap and dropped. Default 250. */
  maxFrameMs?: number;
  /** Advance the simulation by one fixed step of `dt` seconds. */
  update: (dt: number) => void;
  /** Draw. `alpha` is how far (0..1) the clock is between the last two steps. */
  render: (alpha: number) => void;
  /** Millisecond clock. Default performance.now. */
  now?: () => number;
  /** Frame scheduler. Default requestAnimationFrame. */
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (id: number) => void;
}

export interface Loop {
  readonly state: LoopState;
  readonly stats: Readonly<LoopStats>;
  readonly stepSeconds: number;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Run one frame manually with the given timestamp (used by tests). */
  frame(t: number): void;
}

export function createLoop(opts: LoopOptions): Loop {
  const stepHz = opts.stepHz ?? 30;
  const stepMs = 1000 / stepHz;
  const stepSeconds = 1 / stepHz;
  const maxSteps = opts.maxStepsPerFrame ?? 5;
  const maxFrameMs = opts.maxFrameMs ?? 250;
  const now = opts.now ?? (() => performance.now());
  const requestFrame = opts.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const cancelFrame = opts.cancelFrame ?? ((id) => cancelAnimationFrame(id));

  let state: LoopState = "idle";
  let last = 0;
  let acc = 0;
  let handle: number | null = null;
  let fpsFrames = 0;
  let fpsWindowStart = 0;
  let stepTimeTotal = 0;
  let stepTimeCount = 0;

  const stats: LoopStats = { fps: 0, stepMs: 0, stepsLastFrame: 0, totalSteps: 0, clampedFrames: 0 };

  function schedule(): void {
    handle = requestFrame((t) => {
      handle = null;
      if (state !== "running") return;
      frame(t);
      if (state === "running") schedule();
    });
  }

  function frame(t: number): void {
    let elapsed = t - last;
    last = t;
    if (elapsed < 0) elapsed = 0;
    if (elapsed > maxFrameMs) {
      // A gap (tab hidden, debugger, very slow frame): drop it instead of catching up.
      elapsed = stepMs;
      stats.clampedFrames++;
    }
    acc += elapsed;

    let steps = 0;
    while (acc >= stepMs && steps < maxSteps) {
      const s0 = now();
      opts.update(stepSeconds);
      stepTimeTotal += now() - s0;
      stepTimeCount++;
      acc -= stepMs;
      steps++;
    }
    if (steps === maxSteps && acc >= stepMs) {
      // Still behind after the per-frame cap: discard the backlog.
      acc = acc % stepMs;
      stats.clampedFrames++;
    }
    stats.stepsLastFrame = steps;
    stats.totalSteps += steps;

    opts.render(acc / stepMs);

    fpsFrames++;
    const windowMs = t - fpsWindowStart;
    if (windowMs >= 500) {
      stats.fps = (fpsFrames * 1000) / windowMs;
      stats.stepMs = stepTimeCount ? stepTimeTotal / stepTimeCount : 0;
      fpsFrames = 0;
      fpsWindowStart = t;
      stepTimeTotal = 0;
      stepTimeCount = 0;
    }
  }

  function begin(): void {
    last = now();
    fpsWindowStart = last;
    fpsFrames = 0;
    acc = 0;
    state = "running";
    schedule();
  }

  return {
    get state() {
      return state;
    },
    stats,
    stepSeconds,
    start() {
      if (state !== "idle") return;
      begin();
    },
    pause() {
      if (state !== "running") return;
      state = "paused";
      if (handle !== null) cancelFrame(handle);
      handle = null;
    },
    resume() {
      if (state !== "paused") return;
      // Restart the clock so the paused time is never simulated.
      begin();
    },
    stop() {
      if (handle !== null) cancelFrame(handle);
      handle = null;
      state = "stopped";
    },
    frame(t: number) {
      if (state !== "running") return;
      frame(t);
    },
  };
}

/** Minimal shape of `document` the visibility binding needs. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", cb: () => void): void;
  removeEventListener(type: "visibilitychange", cb: () => void): void;
}

/**
 * Pause the loop while the page is hidden and resume when it is visible again.
 * Returns an unbind function.
 */
export function bindVisibility(loop: Loop, doc: VisibilitySource, onChange?: (hidden: boolean) => void): () => void {
  const handler = () => {
    const hidden = doc.visibilityState === "hidden";
    if (hidden) loop.pause();
    else loop.resume();
    onChange?.(hidden);
  };
  doc.addEventListener("visibilitychange", handler);
  return () => doc.removeEventListener("visibilitychange", handler);
}
