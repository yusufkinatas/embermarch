/**
 * App flow smoke (GDD §Q g): Title → New Run → Setup → Run Map → start node → Briefing → Begin →
 * battle mounts → __game.win() → Results → Reward pick → Retinue → Run Map shows progress.
 * Screenshots of every screen land in test-results/app/.
 */
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'test-results/app';

type GameWindow = Window & { __game?: Record<string, unknown> & { screen?: () => string } };

async function screenIs(page: Page, id: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction((want) => (window as GameWindow).__game?.screen?.() === want, id, { timeout });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function freshProfile(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/${query}`);
}

test('full flow: title to battle to rewards and back to the map', async ({ page }) => {
  const errors = collectErrors(page);
  await freshProfile(page, '?seed=20261010');

  // Title
  await screenIs(page, 'title');
  await expect(page.locator('.title-logo')).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, '01-title');
  await page.getByRole('button', { name: /New Run/i }).click();

  // Run Setup
  await screenIs(page, 'setup');
  await expect(page.locator('.house-card.selected')).toHaveCount(1);
  await expect(page.locator('.seed-input')).toHaveValue('20261010');
  await shot(page, '02-setup');
  await page.getByRole('button', { name: /Begin the March/i }).click();

  // Run Map (fresh profile: no Opening Boon)
  await screenIs(page, 'map');
  const seed = await page.evaluate(() => ((window as GameWindow).__game!.run as () => { seed: number })().seed);
  expect(seed).toBe(20261010);
  await expect(page.locator('.rn.clickable')).toHaveCount(1);
  await page.waitForTimeout(500);
  await shot(page, '03-map');
  await page.locator('.rn.clickable').first().click();

  // Briefing
  await screenIs(page, 'briefing');
  await expect(page.locator('.vanguard-card.selected')).toHaveCount(1);
  await page.locator('.vanguard-card').nth(1).click();
  await expect(page.locator('.vanguard-card.selected')).toContainText('Bowyard');
  await shot(page, '04-briefing');
  await page.getByRole('button', { name: /Begin Battle/i }).click();

  // Battle
  await screenIs(page, 'battle');
  await page.waitForFunction(() => typeof (window as GameWindow).__game?.win === 'function', undefined, { timeout: 15_000 });
  await page.waitForTimeout(1200);
  await shot(page, '05-battle');
  await page.evaluate(() => ((window as GameWindow).__game!.win as () => void)());

  // Results
  await screenIs(page, 'results', 20_000);
  await expect(page.locator('.rb-text')).toHaveText(/Victory/i);
  await page.waitForTimeout(1600);
  await shot(page, '06-results');
  await page.getByRole('button', { name: /^Continue/i }).click();

  // Reward (column 1 is always a Draft)
  await screenIs(page, 'reward');
  await page.waitForTimeout(1500);
  await shot(page, '07-reward');
  const cards = page.locator('.flip-front .card');
  expect(await cards.count()).toBeGreaterThan(0);
  await cards.first().click();
  await page.getByRole('button', { name: /^Claim/i }).click();

  // Retinue (only when someone survived to be carried)
  await page.waitForFunction(() => ['retinue', 'map', 'reward'].includes((window as GameWindow).__game?.screen?.() ?? ''));
  let screen = await page.evaluate(() => (window as GameWindow).__game!.screen!());
  if (screen === 'retinue') {
    await page.waitForTimeout(400);
    await shot(page, '08-retinue');
    await page.getByRole('button', { name: /March on/i }).click();
  }

  // Back on the map with progress
  await screenIs(page, 'map');
  screen = await page.evaluate(() => (window as GameWindow).__game!.screen!());
  expect(screen).toBe('map');
  const progress = await page.evaluate(() => {
    const r = ((window as GameWindow).__game!.run as () => { nodesDone: string[]; map: { startId: string }; drafts: string[] })();
    return { done: r.nodesDone, start: r.map.startId, drafts: r.drafts.length };
  });
  expect(progress.done).toContain(progress.start);
  expect(progress.drafts).toBe(1);
  await expect(page.locator('.edge.traveled')).toHaveCount(0); // only the start node is done: no edge walked yet
  await expect(page.locator('.rn.st-current')).toHaveCount(1);
  expect(await page.locator('.rn.clickable').count()).toBeGreaterThan(1);
  await page.waitForTimeout(800);
  await shot(page, '09-map-progress');

  // Continue survives a reload
  await page.reload();
  await screenIs(page, 'title');
  await expect(page.getByRole('button', { name: /Continue the March/i })).toBeVisible();
  await page.getByRole('button', { name: /Continue the March/i }).click();
  await screenIs(page, 'map');

  expect(errors).toEqual([]);
});

test('meta screens: Hall of Banners, How to Play, Settings', async ({ page }) => {
  const errors = collectErrors(page);
  await freshProfile(page);
  await screenIs(page, 'title');

  await page.getByRole('button', { name: /Hall of Banners/i }).click();
  await screenIs(page, 'hall');
  await expect(page.locator('.hall-banner')).toHaveCount(14);
  await page.waitForTimeout(500);
  await shot(page, '10-hall');
  await page.getByRole('button', { name: /Title/i }).click();

  await page.getByRole('button', { name: /How to Play/i }).click();
  await screenIs(page, 'howto');
  await page.getByRole('button', { name: /Counter Wheel/i }).click();
  await expect(page.locator('.counter-wheel')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, '11-howto-wheel');
  await page.keyboard.press('Escape');
  await screenIs(page, 'title');

  await page.getByRole('button', { name: /Settings/i }).click();
  await expect(page.locator('.settings-modal')).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole('switch', { name: /Edge panning/i }).click();
  const edgePan = await page.evaluate(() => ((window as GameWindow).__game!.meta as () => { settings: { edgePan: boolean } })().settings.edgePan);
  expect(edgePan).toBe(false);
  await shot(page, '12-settings');
  await page.getByRole('button', { name: /Done/i }).click();
  await expect(page.locator('.settings-modal')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('quick battle URL param mounts the battle and returns to Title', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?battle=raze&depth=2&seed=7');
  await screenIs(page, 'battle');
  await page.waitForFunction(() => typeof (window as GameWindow).__game?.win === 'function');
  await page.evaluate(() => ((window as GameWindow).__game!.win as () => void)());
  await screenIs(page, 'results', 20_000);
  await page.getByRole('button', { name: /Return to Title/i }).click();
  await screenIs(page, 'title');
  expect(errors).toEqual([]);
});

/** Dispatch a cancelable contextmenu event at the first element matching `sel`; true if the app prevented it. */
async function contextMenuPrevented(page: Page, sel: string): Promise<boolean> {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`no element ${s}`);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, sel);
}

test('no browser context menu on the app screens, except in text fields', async ({ page }) => {
  const errors = collectErrors(page);
  await freshProfile(page, '?seed=4004');
  await screenIs(page, 'title');
  expect(await contextMenuPrevented(page, '.title-scr')).toBe(true);
  await page.getByRole('button', { name: /New Run/i }).click();
  await screenIs(page, 'setup');
  expect(await contextMenuPrevented(page, '.setup-scr')).toBe(true);
  expect(await contextMenuPrevented(page, '.seed-input')).toBe(false);
  await page.getByRole('button', { name: /Begin the March/i }).click();
  await screenIs(page, 'map');
  expect(await contextMenuPrevented(page, '.map-svg')).toBe(true);
  await page.locator('.rn.clickable').first().click();
  await screenIs(page, 'briefing');
  expect(await contextMenuPrevented(page, '.briefing-scr')).toBe(true);
  expect(errors).toEqual([]);
});

test('a battle briefing is a preview: Back keeps every road open, Begin Battle commits', async ({ page }) => {
  const errors = collectErrors(page);
  await freshProfile(page, '?seed=4004');
  await screenIs(page, 'title');
  await page.evaluate(() => ((window as GameWindow).__game!.newRun as (o: object) => unknown)({ seed: 4004 }));
  await screenIs(page, 'map');
  await page.locator('.rn.clickable').first().click();
  await screenIs(page, 'briefing');
  await page.getByRole('button', { name: /Begin Battle/i }).click();
  await screenIs(page, 'battle');
  await page.waitForFunction(() => typeof (window as GameWindow).__game?.win === 'function', undefined, { timeout: 15_000 });
  await page.evaluate(() => ((window as GameWindow).__game!.win as () => void)());
  await screenIs(page, 'results', 20_000);
  for (let i = 0; i < 6 && (await page.evaluate(() => (window as GameWindow).__game!.screen!())) !== 'map'; i++) {
    const s = await page.evaluate(() => (window as GameWindow).__game!.screen!());
    if (s === 'results') await page.getByRole('button', { name: /^Continue/i }).click();
    else if (s === 'reward') await page.getByRole('button', { name: /Skip/i }).click();
    else if (s === 'retinue') await page.getByRole('button', { name: /March on/i }).click();
    await page.waitForTimeout(400);
  }
  await screenIs(page, 'map');

  type RunLite = { currentNode: string; stats: { nodesVisited: number }; map: { columns: string[][]; nodes: Record<string, { type: string }> } };
  const run = () => page.evaluate(() => ((window as GameWindow).__game!.run as () => RunLite)());
  const before = await run();
  const col2 = before.map.columns[1];
  const a = col2.find((id) => before.map.nodes[id].type === 'battle')!;
  const b = col2.find((id) => id !== a)!;
  await page.locator(`.rn[data-node="${a}"]`).click();
  await screenIs(page, 'briefing');
  const previewed = await run();
  expect(previewed.currentNode).toBe(before.currentNode);
  expect(previewed.stats.nodesVisited).toBe(before.stats.nodesVisited);
  await page.getByRole('button', { name: /^Back/i }).click();
  await screenIs(page, 'map');
  await expect(page.locator(`.rn[data-node="${b}"]`)).toHaveClass(/clickable/);
  await page.locator(`.rn[data-node="${b}"] .rn-hit`).hover();
  await expect(page.locator('.tooltip.show')).toContainText('Click to march here');

  await page.locator(`.rn[data-node="${a}"]`).click();
  await screenIs(page, 'briefing');
  await page.getByRole('button', { name: /Begin Battle/i }).click();
  await screenIs(page, 'battle');
  const committed = await run();
  expect(committed.currentNode).toBe(a);
  expect(committed.stats.nodesVisited).toBe(before.stats.nodesVisited + 1);
  expect(errors).toEqual([]);
});
