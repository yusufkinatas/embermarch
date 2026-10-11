/**
 * Battle camera: the shared render Camera plus the point the player is looking at, so a window
 * resize keeps it in view (B11), and a top clamp that lets the map's top rows be panned out from
 * under the objective tracker and Horn. camera.ts stays untouched.
 */
import { Camera } from '../render/camera';

/** The void margin (tiles) Camera.clampToMap allows around the map. */
const CLAMP_MARGIN = 2;

export class BattleCamera extends Camera {
  /**
   * Bottom of the top HUD band in CSS px (top bar + objective tracker / Horn / boss bar), measured by
   * the HUD. A pan may scroll past the map's top edge by this much instead of the top bar alone, so
   * trees and building spots in the top rows can be brought out from under the tracker. 0 = off.
   */
  topBand = 0;
  /** Last centerOn target and the camera position it produced (clamping may keep it off-centre). */
  private lastCentre: { x: number; y: number; camX: number; camY: number } | null = null;
  private centring = false;

  /** Centres on the playfield exactly as before: jumps (H, Space, the opening view) keep the top-bar clamp. */
  override centerOn(wx: number, wy: number): void {
    this.centring = true;
    try {
      super.centerOn(wx, wy);
    } finally {
      this.centring = false;
    }
    this.lastCentre = { x: wx, y: wy, camX: this.x, camY: this.y };
  }

  /**
   * Camera.clampToMap with the top pad widened for pans and zooms (camera.ts stays frozen): map row 0
   * may come down to half a tile below the HUD band, instead of 2 tiles below the top bar.
   */
  override clampToMap(): void {
    const band = this.centring ? 0 : this.topBand;
    // Camera.clampToMap adds CLAMP_MARGIN tiles above the top pad; keep half a tile of it below the band.
    const pad = band - (CLAMP_MARGIN - 0.5) * this.scale;
    if (!(pad > this.topInset)) {
      super.clampToMap();
      return;
    }
    // Camera.clampToMap reads topInset only for its top pad.
    const top = this.topInset;
    this.topInset = pad;
    try {
      super.clampToMap();
    } finally {
      this.topInset = top;
    }
  }

  /** World point at the middle of the playfield (between the top bar and the bottom panel). */
  playfieldCentre(): { x: number; y: number } {
    const playH = this.viewH - this.bottomInset - this.topInset;
    return { x: this.x + this.viewW / 2 / this.scale, y: this.y + (this.topInset + playH / 2) / this.scale };
  }

  /**
   * What the player is looking at: the last centred target (H, Space, group recall, minimap) while
   * the view has not moved since, else the playfield centre. Near a map corner the clamp keeps the
   * target off-centre, so the target itself is the better anchor.
   */
  focusPoint(): { x: number; y: number } {
    const f = this.lastCentre;
    if (f && Math.abs(f.camX - this.x) < 1e-6 && Math.abs(f.camY - this.y) < 1e-6) return { x: f.x, y: f.y };
    return this.playfieldCentre();
  }
}
