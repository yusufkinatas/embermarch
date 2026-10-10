import { clamp } from '../core/math';
import { TILE_PX } from '../sim/types';

/**
 * Camera shared by renderer and input. (x, y) is the WORLD position (in tiles)
 * shown at the top-left corner of the viewport. Screen coordinates are CSS pixels
 * relative to the game canvas.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  /** Viewport size in CSS px. */
  viewW = 1280;
  viewH = 720;
  /** Bottom HUD height in CSS px (area of the canvas covered by the panel). */
  bottomInset = 170;
  /** Top bar height in CSS px. */
  topInset = 32;
  minZoom = 0.75;
  maxZoom = 1.5;
  /** Map size in tiles (for clamping). */
  mapW = 64;
  mapH = 64;

  get scale(): number {
    return TILE_PX * this.zoom;
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.scale, y: (wy - this.y) * this.scale };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx / this.scale + this.x, y: sy / this.scale + this.y };
  }

  /** Visible world rect in tiles (whole viewport). */
  visibleRect(): { x0: number; y0: number; x1: number; y1: number } {
    return { x0: this.x, y0: this.y, x1: this.x + this.viewW / this.scale, y1: this.y + this.viewH / this.scale };
  }

  /** Center the camera on a world point, accounting for the HUD insets. */
  centerOn(wx: number, wy: number): void {
    const playH = this.viewH - this.bottomInset - this.topInset;
    this.x = wx - this.viewW / 2 / this.scale;
    this.y = wy - (this.topInset + playH / 2) / this.scale;
    this.clampToMap();
  }

  /** Pan by a screen-space delta in CSS px. */
  panBy(dx: number, dy: number): void {
    this.x += dx / this.scale;
    this.y += dy / this.scale;
    this.clampToMap();
  }

  /** Zoom by a factor keeping the world point under (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToMap();
  }

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.clampToMap();
  }

  setMapSize(w: number, h: number): void {
    this.mapW = w;
    this.mapH = h;
    this.clampToMap();
  }

  clampToMap(): void {
    const margin = 2;
    const visW = this.viewW / this.scale;
    const visH = (this.viewH - this.bottomInset) / this.scale;
    const topPad = this.topInset / this.scale;
    const minX = -margin;
    const maxX = this.mapW + margin - visW;
    const minY = -margin - topPad;
    const maxY = this.mapH + margin - visH;
    this.x = maxX < minX ? (minX + maxX) / 2 : clamp(this.x, minX, maxX);
    this.y = maxY < minY ? (minY + maxY) / 2 : clamp(this.y, minY, maxY);
  }
}
