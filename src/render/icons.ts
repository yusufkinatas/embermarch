/** Procedural icons/portraits for HUD and screens. OWNER: render. */
import type { IconKind } from '../game/types';
import type { Owner } from '../sim/types';

/** Draw an icon centered at (x, y) with the given size (CSS px) into ctx. */
export function drawIcon(ctx: CanvasRenderingContext2D, kind: IconKind, owner: Owner, x: number, y: number, size: number): void {
  throw new Error('not implemented');
}

/** Cached PNG data URL of an icon (for <img> in DOM UI). */
export function iconUrl(kind: IconKind, owner: Owner, size: number): string {
  throw new Error('not implemented');
}
