/**
 * Battle shell smoke (GDD §Q g, battle part): load a quick battle, wait for the Kindle countdown,
 * box-select Tillers, right-click a Thicket (Grain rises after stepping), select the Hearth and
 * train a Tiller (Q), place a Cottage (C + click), then __game.win() → banner → end callback.
 *
 * BATTLE_PATH defaults to the app route (?battle=raze); the battle-shell dev page works too:
 *   BATTLE_PATH='/battle.html?battle=raze&seed=7'
 * BATTLE_SHOTS=<dir> saves screenshots of each stage.
 */
import { expect, test, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };

const BATTLE_PATH = process.env.BATTLE_PATH ?? '/?battle=raze&seed=7&depth=1';
const SHOTS = process.env.BATTLE_SHOTS;

interface P {
  x: number;
  y: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** World tiles → page CSS px. */
async function toScreen(page: Page, x: number, y: number): Promise<P> {
  return page.evaluate(
    ([wx, wy]) => {
      const g = (window as unknown as { __game: G }).__game;
      const p = g.camera.worldToScreen(wx, wy);
      const r = (document.querySelector('.bt-canvas') as HTMLElement).getBoundingClientRect();
      return { x: p.x + r.left, y: p.y + r.top };
    },
    [x, y] as [number, number],
  );
}

async function centerOn(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([wx, wy]) => (window as unknown as { __game: G }).__game.camera.centerOn(wx, wy), [x, y] as [number, number]);
}

/** Largest group of Tillers whose bounding box holds no other own unit (so box select takes Tillers only). */
async function tillerBox(page: Page): Promise<{ ids: number[]; x0: number; y0: number; x1: number; y1: number }> {
  return page.evaluate(() => {
    const g = (window as unknown as { __game: G }).__game;
    const own = g.world.units.filter((u: G) => u.alive && u.owner === 0);
    const tillers = own.filter((u: G) => u.type === 'tiller');
    const others = own.filter((u: G) => u.type !== 'tiller');
    let best = { ids: [tillers[0].id], x0: tillers[0].x - 0.3, y0: tillers[0].y - 0.3, x1: tillers[0].x + 0.3, y1: tillers[0].y + 0.3 };
    for (const a of tillers) {
      for (const b of tillers) {
        const x0 = Math.min(a.x, b.x) - 0.3;
        const x1 = Math.max(a.x, b.x) + 0.3;
        const y0 = Math.min(a.y, b.y) - 0.3;
        const y1 = Math.max(a.y, b.y) + 0.3;
        const inBox = (u: G): boolean => u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1;
        if (others.some(inBox)) continue;
        const ids = tillers.filter(inBox).map((u: G) => u.id);
        if (ids.length > best.ids.length) best = { ids, x0, y0, x1, y1 };
      }
    }
    return best;
  });
}

async function boxSelect(page: Page, box: { x0: number; y0: number; x1: number; y1: number }): Promise<void> {
  await centerOn(page, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
  const a = await toScreen(page, box.x0, box.y0);
  const b = await toScreen(page, box.x1, box.y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

test('battle shell: select, gather, train, build, win', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BATTLE_PATH);
  await page.waitForFunction(() => {
    const g = (window as unknown as { __game?: G }).__game;
    return !!g && typeof g.state === 'function' && !!document.querySelector('.bt-hud');
  });
  await shot(page, 'battle-0-kindle');

  // Kindle countdown runs in real time.
  await page.waitForFunction(() => (window as unknown as { __game: G }).__game.state().countdown <= 0, null, { timeout: 20_000 });
  await expect(page.locator('.bt-top .bt-clock')).toBeVisible();
  // Active pause keeps the test deterministic; orders are still accepted and step() advances.
  await page.evaluate(() => (window as unknown as { __game: G }).__game.pause(true));

  // 1. Box-select Tillers.
  const box = await tillerBox(page);
  expect(box.ids.length).toBeGreaterThanOrEqual(2);
  await boxSelect(page, box);
  const sel = await page.evaluate(() => (window as unknown as { __game: G }).__game.state().selection as number[]);
  expect([...sel].sort((a, b) => a - b)).toEqual([...box.ids].sort((a, b) => a - b));
  await expect(page.locator('.bt-selection[data-mode="group"]')).toBeVisible();
  await expect(page.locator('.bt-card .bt-cmd:not(.empty)').first()).toBeVisible();
  await shot(page, 'battle-1-selected');

  // 2. Right-click the nearest Thicket → Grain rises after stepping.
  const thicket = await page.evaluate(() => {
    const g = (window as unknown as { __game: G }).__game;
    const w = g.world;
    const hearth = w.entities.get(w.hearthId);
    const t = w.resources
      .filter((r: G) => r.alive && r.type === 'thicket')
      .sort((a: G, b: G) => Math.hypot(a.x - hearth.x, a.y - hearth.y) - Math.hypot(b.x - hearth.x, b.y - hearth.y))[0];
    return { x: t.x, y: t.y };
  });
  await centerOn(page, thicket.x, thicket.y);
  const tp = await toScreen(page, thicket.x, thicket.y);
  await page.mouse.click(tp.x, tp.y, { button: 'right' });
  const gathering = await page.evaluate(
    (ids) => ids.filter((id: number) => (window as unknown as { __game: G }).__game.world.entities.get(id)?.order.type === 'gather').length,
    box.ids,
  );
  expect(gathering).toBe(box.ids.length);
  const grain0 = await page.evaluate(() => (window as unknown as { __game: G }).__game.state().res.grain as number);
  await page.evaluate(() => (window as unknown as { __game: G }).__game.step(30));
  const grain1 = await page.evaluate(() => (window as unknown as { __game: G }).__game.state().res.grain as number);
  expect(grain1).toBeGreaterThan(grain0);
  await shot(page, 'battle-2-gathering');

  // 3. H selects the Hearth, Q trains a Tiller.
  await page.keyboard.press('KeyH');
  const hearthQueued = async (): Promise<number> =>
    page.evaluate(() => {
      const g = (window as unknown as { __game: G }).__game;
      return g.world.entities.get(g.world.hearthId).queue.length as number;
    });
  const q0 = await hearthQueued();
  await page.keyboard.press('KeyQ');
  expect(await hearthQueued()).toBe(q0 + 1);
  await expect(page.locator('.bt-selection[data-mode="building"]')).toBeVisible();
  await page.waitForTimeout(250);
  await shot(page, 'battle-3-hearth');

  // 4. Tillers + C → place a Cottage.
  await boxSelect(page, await tillerBox(page));
  await page.keyboard.press('KeyC');
  expect(await page.evaluate(() => (window as unknown as { __game: G }).__game.ui.placement?.building)).toBe('cottage');
  const hearth = await page.evaluate(() => {
    const g = (window as unknown as { __game: G }).__game;
    const h = g.world.entities.get(g.world.hearthId);
    return { x: h.x, y: h.y };
  });
  await centerOn(page, hearth.x, hearth.y);
  let placed: P | null = null;
  for (let r = 4; r <= 10 && !placed; r++) {
    for (let a = 0; a < 16 && !placed; a++) {
      const wx = hearth.x + Math.cos((a / 16) * Math.PI * 2) * r;
      const wy = hearth.y + Math.sin((a / 16) * Math.PI * 2) * r;
      const p = await toScreen(page, wx, wy);
      if (p.y < 60 || p.y > 520) continue;
      await page.mouse.move(p.x, p.y);
      if (await page.evaluate(() => (window as unknown as { __game: G }).__game.ui.placement?.ok)) placed = p;
    }
  }
  expect(placed).not.toBeNull();
  await shot(page, 'battle-4-placing');
  const cottages = async (): Promise<number> =>
    page.evaluate(() => (window as unknown as { __game: G }).__game.world.buildings.filter((b: G) => b.alive && b.type === 'cottage').length as number);
  const c0 = await cottages();
  await page.mouse.click(placed!.x, placed!.y);
  expect(await cottages()).toBe(c0 + 1);
  expect(await page.evaluate(() => (window as unknown as { __game: G }).__game.ui.placement)).toBeNull();

  // 5. Win → banner → end callback.
  await page.evaluate(() => {
    const g = (window as unknown as { __game: G }).__game;
    g.pause(false);
    g.win();
  });
  await expect(page.locator('.bt-banner.victory')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(900); // let the banner sweep in
  await shot(page, 'battle-5-victory');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __battleResult?: { outcome: string } | null; __game?: G };
      if (w.__battleResult) return w.__battleResult.outcome === 'victory';
      const g = w.__game;
      return !!g && typeof g.screen === 'function' && g.screen() !== 'battle';
    },
    null,
    { timeout: 8_000 },
  );
  expect(errors).toEqual([]);
});

test('battle shell: pause menu, Esc chain and Counter Wheel', async ({ page }) => {
  await page.goto(BATTLE_PATH);
  await page.waitForFunction(() => !!(window as unknown as { __game?: G }).__game?.state);
  await page.evaluate(() => (window as unknown as { __game: G }).__game.step(3.5));
  // Tab holds the Counter Wheel.
  await page.keyboard.down('Tab');
  await expect(page.locator('.bt-wheel')).toBeVisible();
  await page.waitForTimeout(250);
  await shot(page, 'battle-6-wheel');
  await page.keyboard.up('Tab');
  await expect(page.locator('.bt-wheel')).toBeHidden();
  // Esc with nothing selected opens the pause menu; Retreat is locked before 3:00.
  await page.keyboard.press('Escape');
  await expect(page.locator('.bt-menu')).toBeVisible();
  await expect(page.locator('.bt-menu-btn.warn')).toBeDisabled();
  await page.waitForTimeout(300);
  await shot(page, 'battle-7-menu');
  await page.keyboard.press('Escape');
  await expect(page.locator('.bt-menu')).toBeHidden();
  // From 3:00 Sound the Retreat ends the battle as a retreat.
  await page.evaluate(() => (window as unknown as { __game: G }).__game.step(181));
  await page.keyboard.press('Escape');
  await expect(page.locator('.bt-menu-btn.warn')).toBeEnabled();
  await page.locator('.bt-menu-btn.warn').click();
  await page.locator('.bt-menu-btn.warn').click();
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __battleResult?: { outcome: string } | null; __game?: G };
      if (w.__battleResult) return w.__battleResult.outcome === 'retreat';
      const g = w.__game;
      return !!g && typeof g.screen === 'function' && g.screen() !== 'battle';
    },
    null,
    { timeout: 8_000 },
  );
});

test('battle shell: groups, camera, minimap, rally, speed and pause controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BATTLE_PATH);
  await page.waitForFunction(() => !!(window as unknown as { __game?: G }).__game?.state);
  await page.evaluate(() => {
    const g = (window as unknown as { __game: G }).__game;
    g.step(3.5);
    g.pause(true);
  });
  const game = <T>(fn: (g: G) => T): Promise<T> =>
    page.evaluate((src) => new Function('g', `return (${src})(g);`)((window as unknown as { __game: G }).__game), fn.toString()) as Promise<T>;

  // Control group: Alt+1 assigns, Escape deselects, 1 recalls.
  const courser = await game((g) => g.world.units.find((u: G) => u.owner === 0 && u.type === 'courser').id as number);
  await game((g) => g.select([g.world.units.find((u: G) => u.owner === 0 && u.type === 'courser').id]));
  await page.keyboard.press('Alt+Digit1');
  await page.keyboard.press('Escape');
  expect(await game((g) => g.state().selection.length)).toBe(0);
  await page.keyboard.press('Digit1');
  expect(await game((g) => g.state().selection)).toEqual([courser]);
  await expect(page.locator('.bt-group').first()).not.toHaveClass(/empty/);

  // Speed, pause, mute keys.
  await page.keyboard.press('Equal');
  expect(await game((g) => g.ui.speed)).toBe(1.5);
  await page.keyboard.press('Minus');
  expect(await game((g) => g.ui.speed)).toBe(1);
  await page.keyboard.press('F2');
  expect(await game((g) => g.ui.paused)).toBe(false);
  await page.keyboard.press('F2');
  expect(await game((g) => g.ui.paused)).toBe(true);

  // Wheel zoom at the cursor, arrow-key pan.
  const z0 = await game((g) => g.camera.zoom as number);
  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => game((g) => g.camera.zoom as number)).toBeGreaterThan(z0);
  const x0 = await game((g) => g.camera.x as number);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  expect(await game((g) => g.camera.x as number)).toBeGreaterThan(x0);

  // Minimap click jumps the camera.
  const mm = await page.locator('.bt-minimap-canvas').boundingBox();
  expect(mm).not.toBeNull();
  await page.mouse.click(mm!.x + mm!.width * 0.5, mm!.y + mm!.height * 0.5);
  const center = await game((g) => {
    const c = g.camera;
    const playH = c.viewH - c.bottomInset - c.topInset;
    return { x: c.x + c.viewW / 2 / c.scale, y: c.y + (c.topInset + playH / 2) / c.scale, w: g.world.map.w };
  });
  expect(Math.abs(center.x - center.w / 2)).toBeLessThan(4);

  // A building's rally point: select the Vanguard Muster Hall, right-click the ground.
  const hall = await game((g) => {
    const b = g.world.buildings.find((x: G) => x.owner === 0 && x.type === 'muster_hall');
    g.select([b.id]);
    g.camera.centerOn(b.x, b.y);
    return { id: b.id as number, x: b.x as number, y: b.y as number };
  });
  const rp = await toScreen(page, hall.x + 3, hall.y + 3);
  await page.mouse.click(rp.x, rp.y, { button: 'right' });
  expect(await game((g) => !!g.world.buildings.find((b: G) => b.type === 'muster_hall' && b.owner === 0).rally)).toBe(true);
  await expect(page.locator('.bt-selection[data-mode="building"] .bt-rally')).toBeVisible();

  // Double-click a Tiller selects every Tiller on screen.
  const t = await game((g) => {
    const u = g.world.units.find((x: G) => x.owner === 0 && x.type === 'tiller');
    g.camera.centerOn(u.x, u.y);
    return { x: u.x as number, y: u.y as number };
  });
  const tp = await toScreen(page, t.x, t.y);
  await page.mouse.dblclick(tp.x, tp.y);
  const selTypes = await game((g) => [...new Set(g.state().selection.map((id: number) => g.world.entities.get(id).type))]);
  expect(selTypes).toEqual(['tiller']);
  expect(await game((g) => g.state().selection.length as number)).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
