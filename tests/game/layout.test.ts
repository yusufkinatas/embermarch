/** Viewport layout helpers: HUD scale and start zoom (B11), edge markers clear of the Horn (B5). */
import { describe, expect, it } from 'vitest';
import { LABEL_FIT_CHAR, LABEL_LINE, clearOfRect, labelShift, stackLabels } from '../../src/game/hud/edgeArrows';
import { HUD_SCALE_MAX, HUD_SCALE_PHONE, hudScale, maxZoomFor, startZoom } from '../../src/game/hud/hud';
import { BattleCamera } from '../../src/game/battleCamera';
import { Camera } from '../../src/render/camera';

describe('HUD scale and default zoom', () => {
  it('keeps 1280×720 and 1600×900 as before and grows to 1.6 at 1440p', () => {
    expect(hudScale(1280, 720)).toBe(1);
    expect(hudScale(1600, 900)).toBe(1.25);
    expect(hudScale(2560, 1440)).toBe(HUD_SCALE_MAX);
    expect(HUD_SCALE_MAX).toBe(1.6);
    expect(hudScale(1000, 600)).toBe(0.85);
  });

  it('start zoom is 1 up to 900 px tall and 1.4 at 1440p; tall screens zoom further', () => {
    expect(startZoom(720)).toBe(1);
    expect(startZoom(900)).toBe(1);
    expect(startZoom(1080)).toBeCloseTo(1.2, 6);
    expect(startZoom(1440)).toBe(1.4);
    expect(maxZoomFor(900)).toBe(1.5);
    expect(maxZoomFor(1440)).toBe(1.8);
  });

  it('at 2560×1440 the start zoom leaves at most the 2-tile clamp margin on a 56-tile map', () => {
    const c = new Camera();
    c.setMapSize(56, 56);
    c.zoom = startZoom(1440);
    c.topInset = Math.round(32 * hudScale(2560, 1440));
    c.bottomInset = Math.round(170 * hudScale(2560, 1440));
    c.setViewport(2560, 1440);
    c.centerOn(28, 28);
    const r = c.visibleRect();
    expect(r.x1 - r.x0).toBeLessThan(56 + 4);
    expect(r.x0).toBeGreaterThanOrEqual(-2);
  });
});

describe('clearOfRect (edge markers vs the Horn column)', () => {
  const horn = { x0: 600, y0: 40, x1: 1000, y1: 180 };
  it('moves a top marker under the Horn column straight down below it', () => {
    const p = clearOfRect({ x: 800, y: 160 }, 'Spent 0:38 · 31 tiles'.length, 1.25, horn);
    expect(p.x).toBe(800);
    expect(p.y).toBeGreaterThan(180 + 15);
  });
  it('leaves markers elsewhere alone', () => {
    expect(clearOfRect({ x: 200, y: 160 }, 6, 1.25, horn)).toEqual({ x: 200, y: 160 });
    expect(clearOfRect({ x: 800, y: 400 }, 6, 1.25, horn)).toEqual({ x: 800, y: 400 });
    expect(clearOfRect({ x: 800, y: 160 }, 6, 1.25, null)).toEqual({ x: 800, y: 160 });
  });
});

describe('labelShift (edge marker labels stay on screen)', () => {
  const label = 'Spent 0:17 · 36 tiles'.length;
  it('pulls a long label at the right edge back inside the viewport', () => {
    const dx = labelShift(1600 - 34 * 1.25, label, 1.25, 1600);
    expect(dx).toBeLessThan(0);
    const half = (label * LABEL_FIT_CHAR * 1.25) / 2;
    expect(1600 - 34 * 1.25 + dx + half).toBeLessThanOrEqual(1600 - 6 + 1e-9);
  });
  it('pushes a long label at the left edge to the right', () => {
    expect(labelShift(34, label, 1, 1280)).toBeGreaterThan(0);
  });
  it('leaves short labels and centred markers alone', () => {
    expect(labelShift(1600 - 34 * 1.25, 'Wave 2'.length, 1.25, 1600)).toBe(0);
    expect(labelShift(800, label, 1.25, 1600)).toBe(0);
  });
});

describe('BattleCamera focus across a resize (B11a)', () => {
  /** What BattleController.resize does: read the focus, apply the new viewport + insets, re-centre. */
  function resize(c: BattleCamera, w: number, h: number): void {
    const f = c.focusPoint();
    const s = hudScale(w, h);
    c.topInset = Math.round(32 * s);
    c.bottomInset = Math.round(170 * s);
    c.maxZoom = maxZoomFor(h);
    c.setViewport(w, h);
    c.centerOn(f.x, f.y);
  }
  function cam(w: number, h: number): BattleCamera {
    const c = new BattleCamera();
    c.setMapSize(56, 56);
    c.zoom = startZoom(h);
    c.topInset = Math.round(32 * hudScale(w, h));
    c.bottomInset = Math.round(170 * hudScale(w, h));
    c.setViewport(w, h);
    return c;
  }

  it('a centred Hearth stays at the playfield centre from 1920×1080 to 1000×700', () => {
    const c = cam(1920, 1080);
    c.centerOn(28, 30);
    resize(c, 1000, 700);
    const p = c.playfieldCentre();
    expect(Math.hypot(p.x - 28, p.y - 30)).toBeLessThan(2);
  });

  it('a corner Hearth (clamped) is re-centred as far as the clamp allows, not left where the old view was', () => {
    const c = cam(1920, 1080);
    c.centerOn(11, 11);
    resize(c, 1000, 700);
    const ref = cam(1000, 700);
    ref.zoom = c.zoom; // a resize keeps the zoom
    ref.setViewport(1000, 700);
    ref.centerOn(11, 11);
    expect(c.x).toBeCloseTo(ref.x, 6);
    expect(c.y).toBeCloseTo(ref.y, 6);
  });

  it('after a pan the playfield centre is kept instead of the old target', () => {
    const c = cam(1600, 900);
    c.centerOn(28, 28);
    c.panBy(320, 0); // 10 tiles east
    const before = c.playfieldCentre();
    resize(c, 1280, 720);
    const after = c.playfieldCentre();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.01);
  });
});

describe('phone HUD scale (final fix pass B2)', () => {
  it('a landscape phone (shortest side under 500 px) goes down to 0.6; desktop sizes keep the 0.85 floor', () => {
    expect(hudScale(734, 343)).toBe(HUD_SCALE_PHONE); // iPhone 15 landscape
    expect(HUD_SCALE_PHONE).toBe(0.6);
    expect(hudScale(892, 412)).toBe(0.6); // Galaxy A55 landscape
    expect(hudScale(1024, 600)).toBe(0.85);
    expect(hudScale(1280, 720)).toBe(1);
    expect(hudScale(1600, 900)).toBe(1.25);
  });
});

describe('top HUD band clamp (final fix pass B7)', () => {
  function cam(): BattleCamera {
    const c = new BattleCamera();
    c.setMapSize(56, 56);
    c.zoom = 1;
    c.topInset = 40; // 32 × 1.25
    c.bottomInset = 213;
    c.setViewport(1600, 900);
    return c;
  }

  it('without a band the clamp is the shared Camera clamp', () => {
    const c = cam();
    const ref = new Camera();
    Object.assign(ref, { mapW: 56, mapH: 56, zoom: 1, topInset: 40, bottomInset: 213, viewW: 1600, viewH: 900 });
    c.panBy(0, -10000);
    ref.panBy(0, -10000);
    expect(c.y).toBeCloseTo(ref.y, 6);
    expect(c.y).toBeCloseTo(-2 - 40 / 32, 6);
  });

  it('a pan can bring map row 0 out from under a 140 px tracker band (half a tile below it)', () => {
    const c = cam();
    c.topBand = 140;
    c.panBy(0, -10000);
    expect(c.worldToScreen(0, 0).y).toBeCloseTo(140 + 16, 6);
    c.zoomAt(1.2, 800, 450);
    c.panBy(0, -10000);
    expect(c.worldToScreen(0, 0).y).toBeCloseTo(140 + 0.5 * c.scale, 6);
  });

  it('a band no lower than the top bar plus the margin changes nothing', () => {
    const c = cam();
    c.topBand = 40 + 1.5 * 32;
    c.panBy(0, -10000);
    expect(c.y).toBeCloseTo(-2 - 40 / 32, 6);
  });

  it('centerOn frames exactly as before (H, Space and the opening view do not show more void)', () => {
    const c = cam();
    const ref = cam();
    c.topBand = 140;
    c.centerOn(10, 3);
    ref.centerOn(10, 3);
    expect(c.y).toBeCloseTo(ref.y, 6);
    expect(c.y).toBeCloseTo(-2 - 40 / 32, 6);
  });
});

describe('stackLabels (edge labels on the same edge do not run into each other, B9)', () => {
  it('two labels side by side on the top edge: the second drops below the first', () => {
    const a = { x: 700, y: 120, len: 'Spent 0:09 · 39 tiles'.length };
    const b = { x: 760, y: 120, len: 'Wave 3'.length };
    const dy = stackLabels([a, b], 1.25);
    expect(dy[0]).toBe(0);
    expect(dy[1]).toBeGreaterThanOrEqual(LABEL_LINE * 1.25);
  });

  it('labels far apart, hidden slots and empty labels are left alone', () => {
    const dy = stackLabels([{ x: 200, y: 120, len: 6 }, null, { x: 900, y: 120, len: 6 }, { x: 905, y: 400, len: 0 }], 1);
    expect(dy).toEqual([0, 0, 0, 0]);
  });

  it('three labels on one spot stack into three rows; near the bottom they rise instead', () => {
    const at = { x: 50, y: 300, len: 12 };
    const dy = stackLabels([at, at, at], 1);
    expect(new Set(dy).size).toBe(3);
    expect([...dy].sort((p, q) => p - q)).toEqual([0, LABEL_LINE + 2, 2 * (LABEL_LINE + 2)]);
    const low = stackLabels([{ x: 50, y: 680, len: 12 }, { x: 52, y: 680, len: 12 }], 1, 700);
    expect(low[1]).toBeLessThanOrEqual(-(LABEL_LINE + 2));
  });
});
