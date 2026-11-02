import { expect, test, scanAccessibility, assertNoAccessibilityViolations, captureSourceRenderedScreenshot } from './support/test.js';
import { notebookSection, showMap, projectMenu } from './support/notebook.js';
import { serializedEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

test('map and notebook fit every breakpoint with a resizable wide-screen dock and wrapping text', async ({ page, makeAxeBuilder }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'This audit explicitly exercises every viewport.');
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: serializedEastHarlemDisabilityProject() });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await showMap(page);
    const canvas = page.locator('.canvas-wrap');
    const before = await canvas.boundingBox();
    expect(before.width).toBeGreaterThan(width * .9);
    expect(before.height).toBeGreaterThan(900 * .65);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await notebookSection(page, 'review');
    const notebook = page.locator('#map-inspector');
    const handle = page.getByRole('separator', { name: 'Resize sidebar' });
    await expect(notebook).toBeVisible();
    if (width > 1100) {
      await handle.press('Home');
      const initial = Number(await handle.getAttribute('aria-valuenow'));
      await handle.press('ArrowLeft');
      expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(initial);
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 4 });
      await page.mouse.up();
      expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(initial);
      expect((await notebook.boundingBox()).width).toBeLessThanOrEqual(362);
    } else {
      await expect(handle).not.toBeVisible();
      await expect(canvas).not.toBeVisible();
      expect((await notebook.boundingBox()).width).toBeCloseTo(before.width, 0);
    }
    await notebook.getByRole('textbox', { name: 'Field notes (required)' }).fill('A student interpretation with enough detail to wrap comfortably at each viewport. '.repeat(4));
    await expect(notebook.locator('textarea:visible')).toHaveCount(1);
    expect(await notebook.locator('.inspector__scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, `Notebook at ${width}px`));
    await captureSourceRenderedScreenshot(page, testInfo, `Notebook at ${width}px`);
    await showMap(page);
    await expect(notebook).not.toBeVisible();
    expect((await canvas.boundingBox()).width).toBeCloseTo(before.width, 0);
    await captureSourceRenderedScreenshot(page, testInfo, `Map at ${width}px`);
    await page.locator('[data-graph-id="node_e2e_home_setting"]').press('Enter');
    await expect(notebook).not.toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(notebook.getByRole('heading', { name: 'Edit', exact: true })).toBeInViewport();
    await expect(notebook.getByRole('textbox', { name: 'Label', exact: true })).toHaveValue('Apartment building');
    await expect(notebook.getByRole('textbox', { name: 'Interpretation', exact: true })).toBeVisible();
    await expect(notebook.getByRole('button', { name: 'Remove from map', exact: true })).not.toBeVisible();
    expect(await notebook.locator('.inspector__scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, `Selected item at ${width}px`));
    await captureSourceRenderedScreenshot(page, testInfo, `Selected item at ${width}px`);
    await showMap(page);
    await projectMenu(page, 'Export & share');
    const dialog = page.getByRole('dialog', {name: 'Export & share'});
    const exports = dialog.locator('.export-dropdown');
    await expect(exports).not.toHaveAttribute('open', '');
    await exports.locator('summary').click();
    await expect(exports.getByRole('button', {name: /JSON Reopen/})).toBeVisible();
    assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, `Exports at ${width}px`));
    await dialog.getByRole('button', {name: 'Close Export & share'}).click();
  }
  expect(errors).toEqual([]);
});
