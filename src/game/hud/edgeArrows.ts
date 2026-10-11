/**
 * Screen-edge chevrons toward off-screen threats, launching waves (red) and Spent Nests (amber).
 * Positioned every frame with transforms only (no layout).
 */
import type { ThreatMarkers } from '../alerts';
import { edgePlacement } from '../alerts';
import { h, setStyle, setText, toggleClass } from '../dom';
import type { HudContext } from './context';

const POOL = 6;
const INSET = 34;
/** CSS px (× HUD scale) kept clear below the top bar and above the bottom panel. */
const TOP_CLEAR = 72;
const BOTTOM_CLEAR = 56;

export class EdgeArrows {
  readonly el: HTMLDivElement;
  private readonly pool: { el: HTMLElement; label: HTMLElement }[] = [];

  constructor(parent: HTMLElement, private readonly ctx: HudContext, private readonly markers: ThreatMarkers) {
    this.el = h('div', 'bt-arrows', parent);
    for (let i = 0; i < POOL; i++) {
      const el = h('div', 'bt-arrow bt-hidden', this.el);
      h('div', 'bt-arrow-chev', el);
      const label = h('div', 'bt-arrow-label', el);
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const m = this.markers.items[i];
        if (m) this.ctx.actions.centerOn(m.x, m.y);
      });
      this.pool.push({ el, label });
    }
  }

  update(): void {
    const { camera, now, scale } = this.ctx;
    this.markers.expire(now);
    // Visible-check against the real play area; chevrons sit inside a rect that clears the top HUD row
    // (Horn, tracker) and the floating group / minimap buttons above the bottom panel.
    const play = { x0: 0, y0: camera.topInset, x1: camera.viewW, y1: camera.viewH - camera.bottomInset };
    const lane = { x0: 0, y0: camera.topInset + TOP_CLEAR * scale, x1: camera.viewW, y1: camera.viewH - camera.bottomInset - BOTTOM_CLEAR * scale };
    for (let i = 0; i < POOL; i++) {
      const slot = this.pool[i];
      const m = this.markers.items[i];
      const sp = m ? camera.worldToScreen(m.x, m.y) : null;
      const visible = !!sp && sp.x >= play.x0 && sp.x <= play.x1 && sp.y >= play.y0 && sp.y <= play.y1;
      // Anything outside the play area is also outside the (narrower) lane, so this always places.
      const pos = sp && !visible ? edgePlacement(sp.x, sp.y, lane, INSET) : null;
      toggleClass(slot.el, 'bt-hidden', !pos);
      if (!m || !pos) continue;
      setStyle(slot.el, 'transform', `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`);
      setStyle(slot.el, '--rot', `${pos.angle.toFixed(3)}rad`);
      toggleClass(slot.el, 'tone-threat', m.tone === 'threat');
      toggleClass(slot.el, 'tone-spent', m.tone === 'spent');
      toggleClass(slot.el, 'tone-muster', m.tone === 'muster');
      setText(slot.label, m.label);
    }
  }
}
