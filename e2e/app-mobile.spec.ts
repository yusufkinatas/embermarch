/**
 * Phones (the link is often opened from a chat app): the desktop notice shows, "Continue anyway" hides
 * it for good, and New Run → Begin the March → Begin Battle all sit inside the viewport in landscape.
 * Each phone runs in its own browser engine (iPhone: WebKit, Galaxy: Chromium). Desktop sees no notice.
 * Screenshots land in test-results/app-mobile/.
 */
import { devices, expect, test, type Locator, type Page } from '@playwright/test';

const SHOTS = 'test-results/app-mobile';
const PHONES = ['iPhone 15 landscape', 'Galaxy A55 landscape'] as const;

type GameWindow = Window & { __game?: { screen?: () => string } };

async function screenIs(page: Page, id: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction((want) => (window as GameWindow).__game?.screen?.() === want, id, { timeout });
}

/** Tap the centre of a control after checking it lies fully inside the viewport. */
async function tapInView(page: Page, loc: Locator): Promise<void> {
  const box = await loc.boundingBox();
  const vp = page.viewportSize();
  expect(box, 'control has a box').not.toBeNull();
  expect(vp).not.toBeNull();
  const b = box!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp!.width + 1);
  expect(b.y + b.height).toBeLessThanOrEqual(vp!.height + 1);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

for (const name of PHONES) {
  test(`${name}: desktop notice, Continue anyway is remembered, Begin buttons in view`, async ({ playwright, baseURL }) => {
    const device = devices[name];
    const browser = await playwright[device.defaultBrowserType].launch();
    try {
      const context = await browser.newContext({ ...device, baseURL });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const tag = name.replace(/\W+/g, '-');

      await page.goto('/?seed=20261011');
      await page.evaluate(() => localStorage.clear());
      await page.goto('/?seed=20261011');
      await screenIs(page, 'title');
      await page.evaluate(() => document.fonts.ready);

      // The notice, with the touch line the battle input implements.
      const notice = page.locator('.device-notice');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('Best on a computer');
      await expect(notice).toContainText('On touch: tap to select, tap the ground to move or attack, drag to pan.');
      await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${tag}-01-notice.png` });
      await tapInView(page, page.getByRole('button', { name: 'Continue anyway' }));
      await expect(notice).toHaveCount(0);

      // Remembered across a reload.
      await page.reload();
      await screenIs(page, 'title');
      await page.waitForTimeout(400);
      await expect(notice).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/${tag}-02-title.png` });

      await tapInView(page, page.getByRole('button', { name: /New Run/i }));
      await screenIs(page, 'setup');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${tag}-03-setup.png` });
      await tapInView(page, page.getByRole('button', { name: /Begin the March/i }));
      await screenIs(page, 'map');
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/${tag}-04-map.png` });
      const node = page.locator('.rn.clickable').first();
      await tapInView(page, node);
      // A first tap may only show the node tooltip on touch; a second one opens the briefing.
      if ((await page.evaluate(() => (window as GameWindow).__game?.screen?.())) !== 'briefing') await tapInView(page, node);
      await screenIs(page, 'briefing');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${tag}-05-briefing.png` });
      await tapInView(page, page.getByRole('button', { name: /Begin Battle/i }));
      await screenIs(page, 'battle', 20_000);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
}

test('desktop at 1600x900: no device notice, the Title is unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await screenIs(page, 'title');
  await page.waitForTimeout(400);
  await expect(page.locator('.device-notice')).toHaveCount(0);
  await expect(page.locator('.title-logo')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');
});
