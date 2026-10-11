/**
 * Final fix pass, battle lane: real-browser checks for A+click on a Nest (B1) and the touch controls
 * on a phone (B2: "tap to select, tap the ground to move or attack, drag to pan").
 */
import { devices, expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any;

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => {
    const g = (window as unknown as { __game?: G }).__game;
    return !!g && !!g.world && g.world.countdown <= 0;
  }, null, { timeout: 30_000 });
}

/** World point → page px. */
function toScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ x, y }) => {
    const c = (window as unknown as { __game: G }).__game.camera;
    const r = document.querySelector('.bt-canvas')!.getBoundingClientRect();
    return { x: (x - c.x) * c.scale + r.left, y: (y - c.y) * c.scale + r.top };
  }, { x, y });
}

test('B1: A then a click on a Nest orders a direct attack; Bowmen do not stand idle beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await boot(page, 'battle=raze&depth=1&seed=3');
  const s = await page.evaluate(() => {
    const g = (window as unknown as { __game: G }).__game;
    const w = g.world;
    const h = w.entities.get(w.hearthId);
    const nest = w.buildings.filter((b: G) => b.alive && b.owner === 1 && b.type === 'thorn_nest').sort((a: G, b: G) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
    const d = Math.hypot(h.x - nest.x, h.y - nest.y);
    const sx = nest.x + ((h.x - nest.x) / d) * 6;
    const sy = nest.y + ((h.y - nest.y) / d) * 6;
    const ids = [0, 1, 2].map((i) => g.spawn('bowman', sx + i * 0.8, sy, 0)).concat([0, 1].map((i) => g.spawn('ashpike', sx + i * 0.8, sy + 1, 0)));
    g.reveal(true);
    g.camera.centerOn((nest.x + sx) / 2, (nest.y + sy) / 2);
    g.select(ids);
    return { ids, nest: { id: nest.id, x: nest.x, y: nest.y, hp: nest.hp } };
  });
  await page.keyboard.press('KeyA');
  const p = await toScreen(page, s.nest.x, s.nest.y);
  await page.mouse.click(p.x, p.y);
  const orders = await page.evaluate((ids) => ids.map((id: number) => (window as unknown as { __game: G }).__game.world.entities.get(id).order), s.ids);
  for (const o of orders) expect(o).toMatchObject({ type: 'attack', targetId: s.nest.id });
  await page.evaluate(() => (window as unknown as { __game: G }).__game.step(5));
  expect(await page.evaluate((id) => (window as unknown as { __game: G }).__game.world.entities.get(id).hp, s.nest.id)).toBeLessThan(s.nest.hp);
});

test.describe('B2: touch on a landscape phone', () => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Galaxy A55 landscape'];
  test.use(phone);

  test('tap selects a Tiller, a tap on open ground moves it, a one-finger drag pans', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await boot(page, 'battle=raze&depth=1&seed=3');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.bt-hud')!).getPropertyValue('--s'))).toBe('0.667');
    const t = await page.evaluate(() => {
      const g = (window as unknown as { __game: G }).__game;
      const w = g.world;
      const u = w.units.find((x: G) => x.alive && x.owner === 0 && x.type === 'tiller');
      g.camera.centerOn(u.x, u.y);
      // Open grass about 2 tiles away with nothing on it.
      for (let a = 0; a < 24; a++) {
        const x = u.x + Math.cos((a / 24) * Math.PI * 2) * 2;
        const y = u.y + Math.sin((a / 24) * Math.PI * 2) * 2;
        if (w.map.terrain[Math.floor(y) * w.map.w + Math.floor(x)] !== 0) continue;
        if (w.units.some((v: G) => v.alive && Math.hypot(v.x - x, v.y - y) < 0.8)) continue;
        const inRect = (e: G) => x >= e.tx - 0.3 && y >= e.ty - 0.3 && x < e.tx + e.w + 0.3 && y < e.ty + e.h + 0.3;
        if (w.buildings.some(inRect) || w.resources.some(inRect)) continue;
        return { id: u.id, x: u.x, y: u.y, gx: x, gy: y };
      }
      return null;
    });
    expect(t).not.toBeNull();
    const up = await toScreen(page, t!.x, t!.y);
    await page.touchscreen.tap(up.x, up.y);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __game: G }).__game.state().selection)).toEqual([t!.id]);
    const gp = await toScreen(page, t!.gx, t!.gy);
    await page.touchscreen.tap(gp.x, gp.y);
    expect(await page.evaluate((id) => (window as unknown as { __game: G }).__game.world.entities.get(id).order.type, t!.id)).toBe('move');
    await page.evaluate(() => (window as unknown as { __game: G }).__game.step(2.5));
    const moved = await page.evaluate((t) => {
      const u = (window as unknown as { __game: G }).__game.world.entities.get(t.id);
      return Math.hypot(u.x - t.gx, u.y - t.gy);
    }, t!);
    expect(moved).toBeLessThan(0.6);

    const cam0 = await page.evaluate(() => ({ ...(window as unknown as { __game: G }).__game.camera }));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 520, y: 200 }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 520 - i * 16, y: 200 - i * 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const cam1 = await page.evaluate(() => ({ x: (window as unknown as { __game: G }).__game.camera.x, sel: (window as unknown as { __game: G }).__game.state().selection, box: (window as unknown as { __game: G }).__game.ui.box }));
    expect(cam1.x - cam0.x).toBeGreaterThan(4);
    expect(cam1.sel).toEqual([t!.id]);
    expect(cam1.box).toBeNull();
    expect(errors).toEqual([]);
  });
});
