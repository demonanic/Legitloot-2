/**
 * Pointer input with UI / world separation.
 *
 * A tap is offered to UI regions first (topmost first). Only if no region
 * contains the point does the world handler receive it, so pressing a button
 * can never also trigger the gameplay action underneath it.
 */

import type { Point } from "../render/render.js";

export interface UiRegion {
  id: string;
  /** Hit test in world units. */
  contains(p: Point): boolean;
  /** Return false to let the tap fall through to regions below / the world. */
  onTap(p: Point): boolean | void;
  /** Disabled regions are skipped entirely. */
  enabled?: () => boolean;
}

export type TapTarget = { kind: "ui"; id: string } | { kind: "world" };

/**
 * Route one tap. `regions` is ordered bottom-to-top (later = drawn on top).
 * Pure apart from the handlers it calls.
 */
export function routeTap(p: Point, regions: readonly UiRegion[], onWorld: (p: Point) => void): TapTarget {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]!;
    if (r.enabled && !r.enabled()) continue;
    if (!r.contains(p)) continue;
    if (r.onTap(p) !== false) return { kind: "ui", id: r.id };
  }
  onWorld(p);
  return { kind: "world" };
}

export interface TapRecognizerOptions {
  /** A press that moves further than this (CSS px) is a drag, not a tap. Default 12. */
  slop?: number;
  /** A press held longer than this (ms) is not a tap. Default 500. */
  maxMs?: number;
}

export interface PointerSample {
  id: number;
  x: number;
  y: number;
  t: number;
}

/**
 * Turns pointer down/move/up/cancel into taps. DOM-free so it can be tested.
 */
export function createTapRecognizer(onTap: (x: number, y: number) => void, opts: TapRecognizerOptions = {}) {
  const slop = opts.slop ?? 12;
  const maxMs = opts.maxMs ?? 500;
  const active = new Map<number, { x: number; y: number; t: number; moved: boolean }>();
  return {
    down(s: PointerSample) {
      active.set(s.id, { x: s.x, y: s.y, t: s.t, moved: false });
    },
    move(s: PointerSample) {
      const a = active.get(s.id);
      if (a && Math.hypot(s.x - a.x, s.y - a.y) > slop) a.moved = true;
    },
    up(s: PointerSample) {
      const a = active.get(s.id);
      active.delete(s.id);
      if (!a || a.moved) return;
      if (s.t - a.t > maxMs) return;
      onTap(s.x, s.y);
    },
    cancel(s: PointerSample) {
      active.delete(s.id);
    },
  };
}

/**
 * Bind tap recognition to an element. `toWorld` converts client coordinates.
 * Returns an unbind function.
 */
export function bindTaps(
  el: HTMLElement,
  toWorld: (clientX: number, clientY: number) => Point,
  onTap: (p: Point) => void,
  opts?: TapRecognizerOptions,
): () => void {
  const rec = createTapRecognizer((x, y) => onTap(toWorld(x, y)), opts);
  const sample = (e: PointerEvent): PointerSample => ({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
  const down = (e: PointerEvent) => {
    e.preventDefault();
    rec.down(sample(e));
  };
  const move = (e: PointerEvent) => rec.move(sample(e));
  const up = (e: PointerEvent) => rec.up(sample(e));
  const cancel = (e: PointerEvent) => rec.cancel(sample(e));
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.style.touchAction = "none";
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
  };
}

/** Axis-aligned rectangle region helper. */
export function rectRegion(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
  onTap: (p: Point) => boolean | void,
  enabled?: () => boolean,
): UiRegion {
  const region: UiRegion = {
    id,
    contains: (p) => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h,
    onTap,
  };
  if (enabled) region.enabled = enabled;
  return region;
}
