/**
 * Battle camera: the shared render Camera plus the point the player is looking at, so a window
 * resize keeps it in view (B11). camera.ts stays untouched; this subclass only records centerOn
 * targets.
 */
import { Camera } from '../render/camera';

export class BattleCamera extends Camera {
  /** Last centerOn target and the camera position it produced (clamping may keep it off-centre). */
  private lastCentre: { x: number; y: number; camX: number; camY: number } | null = null;

  override centerOn(wx: number, wy: number): void {
    super.centerOn(wx, wy);
    this.lastCentre = { x: wx, y: wy, camX: this.x, camY: this.y };
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
