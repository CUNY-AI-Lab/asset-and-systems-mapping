import { expect, test, scanAccessibility, assertNoAccessibilityViolations, captureSourceRenderedScreenshot } from './support/test.js';
import { openTools, mapCommand } from './support/notebook.js';
import { serializedEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: serializedEastHarlemDisabilityProject() });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
});

test('expanded map tools stay readable and contained, including at short phone sizes', async ({ page, makeAxeBuilder }, testInfo) => {
  const widths = testInfo.project.name.includes('phone') ? [390, 320] : [1440, 1024, 768];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 390 ? 568 : 900 });
    await openTools(page);
    const menu = page.locator('.notebook-tools-body');
    const bounds = await menu.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await menu.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const select = await menu.getByRole('combobox', { name: 'Show map layer' }).boundingBox();
    expect(select.width).toBeGreaterThan(170);
    expect(select.height).toBeGreaterThanOrEqual(44);
    expect(select.height).toBeLessThan(60);
    const fit = await menu.getByRole('button', { name: 'Fit map', exact: true }).boundingBox();
    expect(fit.width).toBeGreaterThan(100);
    expect(fit.height).toBeLessThan(60);
    await expect(menu.getByRole('button', { name: 'Map notes' })).toHaveCount(0);
    assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, `Open map tools ${width}`));
    await captureSourceRenderedScreenshot(page, testInfo, `Open map tools ${width}`);
    await page.keyboard.press('Escape');
    await expect(page.locator('.notebook-map-tools')).not.toHaveAttribute('open', '');
    await expect(page.locator('.notebook-map-tools > summary')).toBeFocused();
    await openTools(page);
    await page.locator('.notebook-level').click();
    await expect(page.locator('.notebook-map-tools')).not.toHaveAttribute('open', '');
  }
});

test('full screen opens the canvas from notebook or list and has a visible exit', async ({ page, makeAxeBuilder }, testInfo) => {
  const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  for (const from of ['notebook', 'list']) {
    if (from === 'notebook') {
      await nav.getByRole('button', { name: 'Notebook', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Field notes (required)' })).toBeVisible();
      await expect(page.locator('#map-inspector textarea:visible')).toHaveCount(1);
      await expect(page.getByText('Ask the map', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Notebook entries', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Reflect on this level' })).toHaveCount(0);
      await expect(page.locator('#map-inspector .revision-status')).toHaveCount(0);
    } else await mapCommand(page, 'List');
    await mapCommand(page, 'Full screen map');
    await expect(page.locator('#map-inspector')).not.toBeVisible();
    await expect(page.locator('.map-list-view')).toHaveCount(0);
    const canvas = page.locator('.canvas-wrap');
    await expect(canvas).toBeVisible();
    const viewport = page.viewportSize();
    await expect.poll(async () => (await canvas.boundingBox()).height).toBeGreaterThan(viewport.height * .85);
    const stage = await page.locator('.map-stage').boundingBox();
    expect(stage.x).toBe(0); expect(stage.y).toBe(0);
    expect(stage.width).toBe(viewport.width); expect(stage.height).toBe(viewport.height);
    const exit = page.getByRole('button', { name: 'Exit full screen', exact: true });
    await expect(exit).toBeInViewport();
    assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, `Full screen from ${from}`));
    await captureSourceRenderedScreenshot(page, testInfo, `Full screen from ${from}`);
    await exit.click();
    await expect(page.locator('.map-stage')).not.toHaveClass(/is-fullscreen/);
    await expect(nav).toBeVisible();
  }
  await nav.getByRole('button', { name: 'Notebook', exact: true }).click();
  await page.getByRole('combobox', { name: 'Notebook section' }).selectOption('suggestions');
  // Existing work can continue; generating another reading is optional.
  await expect(page.getByRole('button', { name: 'Generate guidance' })).toHaveClass(/button--ghost/);
  await expect(page.locator('#map-inspector .button:visible:not(.button--ghost)')).toHaveCount(1);
});
