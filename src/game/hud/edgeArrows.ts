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
/** Chevron half-size and label height below the chevron centre (CSS px × HUD scale). */
const CHEV_HALF = 15;
const LABEL_BELOW = 30;
/** Label top below the chevron centre (CSS px × HUD scale; matches .bt-arrow-label top). */
const LABEL_TOP = 16;
/** Rough label glyph width (CSS px × HUD scale per character, 11 px bold). */
const LABEL_CHAR = 6.6;

type Rect = { x0: number; y0: number; x1: number; y1: number };

/**
 * Keep a chevron and its label out of a HUD rect (the Horn + Spent ribbon column): a marker whose
 * box would overlap it moves straight down below the rect. Pure; exported for tests.
 */
export function clearOfRect(pos: { x: number; y: number }, labelLen: number, scale: number, avoid: Rect | null, gap = 4): { x: number; y: number } {
  if (!avoid) return pos;
  const halfW = Math.max(CHEV_HALF, (labelLen * LABEL_CHAR) / 2) * scale;
  const box = { x0: pos.x - halfW, y0: pos.y - CHEV_HALF * scale, x1: pos.x + halfW, y1: pos.y + LABEL_BELOW * scale };
  const overlap = box.x0 < avoid.x1 && box.x1 > avoid.x0 && box.y0 < avoid.y1 && box.y1 > avoid.y0;
  if (!overlap) return pos;
  return { x: pos.x, y: avoid.y1 + CHEV_HALF * scale + gap };
}

/** Label glyph width for fitting on screen (11 px bold Alegreya Sans averages ~3.8 px; ~15% margin). */
export const LABEL_FIT_CHAR = 4.4;

/**
 * Horizontal shift (px) that keeps a label centred under a chevron inside the viewport. The width is
 * estimated from the text length (labels are 11 px bold, scaled up with the HUD but never down), so
 * no layout is read per frame. Pure; exported for tests.
 */
export function labelShift(x: number, labelLen: number, scale: number, viewW: number, margin = 6): number {
  const half = (labelLen * LABEL_FIT_CHAR * Math.max(1, scale)) / 2;
  if (x + half > viewW - margin) return viewW - margin - (x + half);
  if (x - half < margin) return margin - (x - half);
  return 0;
}

/** Label line height in CSS px (11 px bold, line-height 1.25), × the HUD scale but never below 1. */
export const LABEL_LINE = 14;

export interface LabelBox {
  /** Label centre x and top y in HUD px. */
  x: number;
  y: number;
  len: number;
}

/**
 * Vertical offsets that keep edge labels apart: a label whose estimated box (LABEL_FIT_CHAR per
 * character, LABEL_LINE tall) overlaps an earlier one drops just below it ("Spent 0:09 · 39 tiles"
 * no longer runs into "Wave 3"), or rises above it when that would cross `maxY`. Null entries (hidden
 * slots) are skipped. Pure; exported for tests.
 */
export function stackLabels(boxes: readonly (LabelBox | null)[], scale: number, maxY = Infinity, gap = 2): number[] {
  const k = Math.max(1, scale);
  const hgt = LABEL_LINE * k;
  const out = boxes.map(() => 0);
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  boxes.forEach((b, i) => {
    if (!b || b.len <= 0) return;
    const half = (b.len * LABEL_FIT_CHAR * k) / 2;
    const x0 = b.x - half;
    const x1 = b.x + half;
    let dy = 0;
    for (let guard = 0; guard <= placed.length; guard++) {
      const y0 = b.y + dy;
      const hit = placed.find((p) => x0 < p.x1 + gap && x1 > p.x0 - gap && y0 < p.y1 + gap && y0 + hgt > p.y0 - gap);
      if (!hit) break;
      const below = hit.y1 + gap - b.y;
      dy = b.y + below + hgt <= maxY ? below : hit.y0 - gap - hgt - b.y;
    }
    out[i] = dy;
    placed.push({ x0, x1, y0: b.y + dy, y1: b.y + dy + hgt });
  });
  return out;
}

export class EdgeArrows {
  readonly el: HTMLDivElement;
  private readonly pool: { el: HTMLElement; label: HTMLElement }[] = [];
  /** Measured top-centre HUD column to keep clear (refreshed by the HUD at ~10 Hz). */
  private avoid: Rect | null = null;
  /** Labels hide (chevrons stay) while a centre callout such as LAST STAND or the end banner shows. */
  private labelsHidden = false;

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

  setAvoid(r: Rect | null): void {
    this.avoid = r;
  }

  setLabelsHidden(on: boolean): void {
    if (on === this.labelsHidden) return;
    this.labelsHidden = on;
    toggleClass(this.el, 'labels-hidden', on);
  }

  update(): void {
    const { camera, now, scale } = this.ctx;
    this.markers.expire(now);
    // Visible-check against the real play area; chevrons sit inside a rect that clears the top HUD row
    // (Horn, tracker) and the floating group / minimap buttons above the bottom panel.
    const play = { x0: 0, y0: camera.topInset, x1: camera.viewW, y1: camera.viewH - camera.bottomInset };
    const lane = { x0: 0, y0: camera.topInset + TOP_CLEAR * scale, x1: camera.viewW, y1: camera.viewH - camera.bottomInset - BOTTOM_CLEAR * scale };
    const boxes: (LabelBox | null)[] = [];
    for (let i = 0; i < POOL; i++) {
      const slot = this.pool[i];
      const m = this.markers.items[i];
      const sp = m ? camera.worldToScreen(m.x, m.y) : null;
      const visible = !!sp && sp.x >= play.x0 && sp.x <= play.x1 && sp.y >= play.y0 && sp.y <= play.y1;
      // Anything outside the play area is also outside the (narrower) lane, so this always places.
      const edge = sp && !visible ? edgePlacement(sp.x, sp.y, lane, INSET) : null;
      toggleClass(slot.el, 'bt-hidden', !edge);
      boxes.push(null);
      if (!m || !edge) continue;
      const pos = { ...clearOfRect(edge, m.label.length, scale, this.avoid), angle: edge.angle };
      setStyle(slot.el, 'transform', `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`);
      setStyle(slot.el, '--rot', `${pos.angle.toFixed(3)}rad`);
      toggleClass(slot.el, 'tone-threat', m.tone === 'threat');
      toggleClass(slot.el, 'tone-spent', m.tone === 'spent');
      toggleClass(slot.el, 'tone-muster', m.tone === 'muster');
      setText(slot.label, m.label);
      // "Spent 0:38 · 31 tiles" is wider than the edge inset: keep it on screen at the side edges.
      const lx = labelShift(pos.x, m.label.length, scale, camera.viewW);
      setStyle(slot.label, '--lx', `${lx.toFixed(1)}px`);
      if (!this.labelsHidden && m.label) boxes[i] = { x: pos.x + lx, y: pos.y + LABEL_TOP * scale, len: m.label.length };
    }
    // Labels on the same edge must not run into each other: stack them.
    const dys = stackLabels(boxes, scale, camera.viewH - camera.bottomInset);
    for (let i = 0; i < POOL; i++) setStyle(this.pool[i].label, '--ly', `${(dys[i] ?? 0).toFixed(1)}px`);
  }
}
