/** Offscreen canvas helpers (browser only). */

export type Ctx2D = CanvasRenderingContext2D;

/** Create a detached canvas with a 2D context. Sizes are clamped to at least 1 px. */
export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

export function get2d(canvas: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): Ctx2D {
  const ctx = canvas.getContext('2d', opts);
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx as Ctx2D;
}
