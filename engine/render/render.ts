/**
 * Canvas 2D renderer with a fixed world size, letterboxed to fit any screen.
 *
 * Games draw in world units; the renderer handles device pixel ratio,
 * fitting, and converting screen coordinates back to world coordinates.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  /** World units to CSS pixels. */
  scale: number;
  /** CSS-pixel offset of the world origin inside the canvas. */
  offsetX: number;
  offsetY: number;
}

/** Fit a world of size w×h inside a screen of size sw×sh, centred. Pure. */
export function fitViewport(worldW: number, worldH: number, screenW: number, screenH: number): Viewport {
  const scale = Math.min(screenW / worldW, screenH / worldH);
  return {
    scale,
    offsetX: (screenW - worldW * scale) / 2,
    offsetY: (screenH - worldH * scale) / 2,
  };
}

/** Convert a CSS-pixel point inside the canvas to world units. Pure. */
export function screenToWorld(v: Viewport, p: Point): Point {
  return { x: (p.x - v.offsetX) / v.scale, y: (p.y - v.offsetY) / v.scale };
}

export interface RendererOptions {
  worldWidth: number;
  worldHeight: number;
  /** Colour behind the letterbox bars. */
  background?: string;
  /** Cap on device pixel ratio, to bound fill cost on dense phone screens. Default 2. */
  maxPixelRatio?: number;
}

export interface Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly viewport: Readonly<Viewport>;
  /** Re-measure the canvas; call on resize and orientation change. */
  resize(): void;
  /** Clear the frame and set the world transform. Draw in world units after this. */
  beginFrame(): void;
  toWorld(clientX: number, clientY: number): Point;
}

export function createRenderer(canvas: HTMLCanvasElement, opts: RendererOptions): Renderer {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D is not available");
  const maxDpr = opts.maxPixelRatio ?? 2;
  const bg = opts.background ?? "#000";
  let dpr = 1;
  let vp: Viewport = { scale: 1, offsetX: 0, offsetY: 0 };

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    vp = fitViewport(opts.worldWidth, opts.worldHeight, rect.width, rect.height);
  }

  resize();

  return {
    ctx,
    worldWidth: opts.worldWidth,
    worldHeight: opts.worldHeight,
    get viewport() {
      return vp;
    },
    resize,
    beginFrame() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const s = vp.scale * dpr;
      ctx.setTransform(s, 0, 0, s, vp.offsetX * dpr, vp.offsetY * dpr);
    },
    toWorld(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      return screenToWorld(vp, { x: clientX - rect.left, y: clientY - rect.top });
    },
  };
}
