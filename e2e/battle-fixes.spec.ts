/**
 * Battle-lane regression checks that need a real browser (B2, B3, B7, B11, B12c, B14).
 * Runs against the app route like e2e/battle.spec.ts (BATTLE_BASE_PATH overrides the query base).
 */
import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any;

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => {
    const g = (window as unknown as { __game?: G }).__game;
    return !!g && !!g.world && g.world.countdown <= 0;
  }, null, { timeout: 30_000 });
}

function game<T>(page: Page, fn: (g: G) => T): Promise<T> {
  return page.evaluate((src) => new Function('g', `return (${src})(g);`)((window as unknown as { __game: G }).__game), fn.toString()) as Promise<T>;
}

test('B2/B3: pause shows a top-bar pill, keeps the centre clear, and speed buttons keep the pause', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page, 'battle=holdfast&depth=2&seed=1');
  await page.keyboard.press('F2');
  await expect(page.locator('.bt-pause-pill')).toBeVisible();
  const pill = (await page.locator('.bt-pause-pill').boundingBox())!;
  expect(pill.y + pill.height).toBeLessThanOrEqual(40); // inside the top bar
  const centralText = await page.evaluate(() => {
    const c = (window as unknown as { __game: G }).__game.camera;
    const top = c.topInset;
    const bot = c.viewH - c.bottomInset;
    const box = { x0: c.viewW * 0.25, x1: c.viewW * 0.75, y0: top + (bot - top) * 0.25, y1: top + (bot - top) * 0.75 };
    return [...document.querySelectorAll('.bt-hud *')].filter((el) => {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > box.x0 && r.left < box.x1 && r.bottom > box.y0 && r.top < box.y1;
    }).length;
  });
  expect(centralText).toBe(0);

  const t0 = await game(page, (g) => g.world.time as number);
  await page.locator('.bt-speed-btn', { hasText: '2×' }).click();
  await page.waitForTimeout(1500);
  expect(await game(page, (g) => ({ paused: g.ui.paused, speed: g.ui.speed, t: g.world.time }))).toEqual({ paused: true, speed: 2, t: t0 });
  await page.keyboard.press('F2');
  await expect.poll(() => game(page, (g) => g.world.time as number)).toBeGreaterThan(t0);
  expect(await game(page, (g) => g.ui.speed)).toBe(2);
});

test('B7: a click right after a selection change acts on the new selection', async ({ page }) => {
  await boot(page, 'battle=raze&depth=1&seed=7');
  await page.keyboard.press('Backquote');
  await expect(page.locator('.bt-cmd').first().locator('.bt-cmd-key')).toHaveText('Q'); // Warden card painted
  const r = await page.evaluate(() => {
    const g = (window as unknown as { __game: G }).__game;
    g.select([g.world.hearthId]);
    document.querySelectorAll('.bt-cmd')[0].dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    return { queue: g.world.entities.get(g.world.hearthId).queue.length, abilityReady: g.world.players[0].abilityReadyTick.Q <= g.world.tick };
  });
  expect(r).toEqual({ queue: 1, abilityReady: true });
});

test('B12c: with the Hawk armed, a minimap click casts it instead of moving the camera', async ({ page }) => {
  await boot(page, 'battle=raze&depth=1&seed=7');
  await game(page, (g) => {
    g.world.players[0].flags.hawk = 1;
    g.step(1);
  });
  await page.keyboard.press('Backquote');
  await expect(page.locator('.bt-cmd').nth(1).locator('.bt-cmd-key')).toHaveText('W');
  await page.keyboard.press('KeyW');
  expect(await game(page, (g) => g.ui.targeting?.slot)).toBe('W');
  const cam0 = await game(page, (g) => [g.camera.x, g.camera.y]);
  const mm = (await page.locator('.bt-minimap-canvas').boundingBox())!;
  await page.mouse.click(mm.x + mm.width * 0.8, mm.y + mm.height * 0.2);
  expect(await game(page, (g) => g.ui.targeting)).toBeNull();
  expect(await game(page, (g) => g.world.players[0].abilityReadyTick.W > g.world.tick)).toBe(true);
  expect(await game(page, (g) => [g.camera.x, g.camera.y])).toEqual(cam0);
});

test('B11: a resize keeps the centred Hearth in the middle; 2560×1440 starts zoomed in with a 1.6 HUD', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await boot(page, 'battle=holdfast&depth=2&seed=1');
  const hearth = await game(page, (g) => {
    const h = g.world.entities.get(g.world.hearthId);
    g.camera.centerOn(h.x, h.y);
    return { x: h.x as number, y: h.y as number };
  });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(500);
  const c = await game(page, (g) => {
    const cam = g.camera;
    const playH = cam.viewH - cam.bottomInset - cam.topInset;
    return { x: cam.x + cam.viewW / 2 / cam.scale, y: cam.y + (cam.topInset + playH / 2) / cam.scale };
  });
  expect(Math.hypot(c.x - hearth.x, c.y - hearth.y)).toBeLessThan(2);

  await page.setViewportSize({ width: 2560, height: 1440 });
  await boot(page, 'battle=raze&depth=1&seed=3');
  const r = await game(page, (g) => {
    const v = g.camera.visibleRect();
    return { zoom: g.camera.zoom, visW: v.x1 - v.x0, mapW: g.world.map.w, s: getComputedStyle(document.querySelector('.bt-hud')!).getPropertyValue('--s') };
  });
  expect(r.zoom).toBeCloseTo(1.4, 5);
  expect(r.visW).toBeLessThan(r.mapW + 4); // at most the 2-tile clamp margin, no wide side bars
  expect(Number(r.s)).toBeCloseTo(1.6, 2);
});

test('B14: hotkey badges follow a QWERTZ layout map; bindings stay on e.code', async ({ page }) => {
  await page.addInitScript(() => {
    const map = new Map([
      ['KeyZ', 'y'],
      ['KeyY', 'z'],
    ]);
    Object.defineProperty(navigator, 'keyboard', { configurable: true, value: { getLayoutMap: async () => map } });
  });
  await boot(page, 'battle=raze&depth=1&seed=7');
  await page.keyboard.press('KeyH');
  const research = page.locator('.bt-cmd').nth(5).locator('.bt-cmd-key'); // Z slot (first research)
  await expect(research).toHaveText('Y');
  await expect(page.locator('.bt-cmd').first().locator('.bt-cmd-key')).toHaveText('Q');
});
