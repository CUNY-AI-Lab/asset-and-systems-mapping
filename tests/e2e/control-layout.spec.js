import { test, expect, captureSourceRenderedScreenshot, scanAccessibility, assertNoAccessibilityViolations } from './support/test.js';
import { openTools, preferences, projectMenu } from './support/notebook.js';
import { serializedEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

async function expectAlignedControls(controls, sameRow = true) {
  const boxes = await controls.evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  expect(boxes.length).toBeGreaterThan(1);
  for (const box of boxes) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(box.height - boxes[0].height)).toBeLessThanOrEqual(1);
    if (sameRow) expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1);
  }
}

test('adjacent actions align and export choices stay usable on desktop and phone', async ({ page, makeAxeBuilder }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: serializedEastHarlemDisabilityProject() });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();

  await openTools(page);
  await expectAlignedControls(page.locator('.map-tools-view > button'));
  await expectAlignedControls(page.locator('.map-tools-zoom > button'));
  const toolsHandle = page.getByRole('separator', { name: 'Resize map tools', exact: true });
  if (testInfo.project.name.includes('desktop')) {
    const panelBefore = await page.locator('.notebook-tools-panel').boundingBox();
    const canvasBefore = await page.locator('.canvas-wrap').boundingBox();
    await toolsHandle.press('Shift+ArrowLeft');
    await expect(toolsHandle).toHaveAttribute('aria-valuenow', '328');
    const handleBox = await toolsHandle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 - 24, handleBox.y + handleBox.height / 2);
    await page.mouse.up();
    await expect(toolsHandle).toHaveAttribute('aria-valuenow', '352');
    const panelAfter = await page.locator('.notebook-tools-panel').boundingBox();
    const canvasAfter = await page.locator('.canvas-wrap').boundingBox();
    expect(panelAfter.width - panelBefore.width).toBe(72);
    expect(canvasAfter).toEqual(canvasBefore);
    expect(await page.evaluate(() => localStorage.getItem('systems-mapping.map-tools-width'))).toBe('352');
    await captureSourceRenderedScreenshot(page, testInfo, 'Resized whole map tools panel');
    await toolsHandle.press('End');
    await expect(toolsHandle).toHaveAttribute('aria-valuenow', '480');
    await toolsHandle.press('Home');
    await expect(toolsHandle).toHaveAttribute('aria-valuenow', '280');
    await toolsHandle.press('Escape');
    await expect(page.locator('.notebook-map-tools')).not.toHaveAttribute('open', '');
    await expect(page.locator('.notebook-map-tools > summary')).toBeFocused();
    await openTools(page);
    await testInfo.attach('Map tools resize geometry', { contentType: 'application/json', body: JSON.stringify({ panelBefore, panelAfter, canvasBefore, canvasAfter }) });
  } else {
    await expect(toolsHandle).not.toBeVisible();
    expect((await page.locator('.notebook-tools-panel').boundingBox()).width).toBe(280);
  }
  await page.locator('.notebook-tools-body .map-search > summary').click();
  await page.getByRole('searchbox', { name: 'Find map item' }).fill('center');
  await expect(page.getByRole('search', { name: 'Find map elements' }).getByRole('button')).toHaveCount(2);
  await expect(page.locator('.notebook-tools-body').evaluate(element => element.scrollWidth <= element.clientWidth)).resolves.toBe(true);
  await captureSourceRenderedScreenshot(page, testInfo, 'Nested map controls');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await preferences(page);
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await captureSourceRenderedScreenshot(page, testInfo, 'Nested project preferences');
  await projectMenu(page, 'Export & share');
  const dialog = page.getByRole('dialog', { name: 'Export & share', exact: true });
  await expectAlignedControls(dialog.locator('.map-download__fields select, .map-download__submit'), !testInfo.project.name.includes('phone'));
  await expect(dialog.getByRole('combobox',{name:'File format'})).toBeEnabled();
  await expect(dialog.getByRole('combobox', { name: 'Export audience' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close Export & share', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('combobox',{name:'File format'})).toBeFocused();
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Aligned export choices'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Aligned export choices');

  await page.locator('.export-dropdown__import input').setInputFiles({ name: 'synthetic-invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).resolves.toBe(true);
  await captureSourceRenderedScreenshot(page, testInfo, 'Export import error');

  if (testInfo.project.name.includes('phone')) {
    await page.setViewportSize({ width: 320, height: 568 });
    await expectAlignedControls(dialog.locator('.map-download__fields select, .map-download__submit'), false);
    await expect(dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).resolves.toBe(true);
    await captureSourceRenderedScreenshot(page, testInfo, 'Narrow export choices');
    await page.setViewportSize({ width: 390, height: 844 });
  }

  await dialog.getByRole('button', { name: 'Project link', exact: true }).click();
  const linkDialog = page.getByRole('dialog', { name: 'Project link', exact: true });
  const linkActions = linkDialog.locator('.button-row > .button');
  async function expectCompactLinkActions() {
    await expect(linkActions).toHaveCount(2);
    await expectAlignedControls(linkActions);
    const [cancel, create] = await linkActions.evaluateAll(buttons => buttons.map(button => {
      const { x, width, height } = button.getBoundingClientRect();
      return { x, width, height };
    }));
    const dialogBox = await linkDialog.boundingBox();
    expect(cancel.width).toBeLessThan(120);
    expect(cancel.x + cancel.width).toBeLessThanOrEqual(create.x);
    expect(cancel.x).toBeGreaterThanOrEqual(dialogBox.x);
    expect(create.x + create.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
    await expect(linkDialog.evaluate(element => element.scrollWidth <= element.clientWidth)).resolves.toBe(true);
  }
  await expectCompactLinkActions();
  if (testInfo.project.name.includes('phone')) {
    await page.setViewportSize({ width: 320, height: 568 });
    await expectCompactLinkActions();
    await page.setViewportSize({ width: 390, height: 844 });
  }
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Aligned project link actions'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Aligned project link actions');
  await linkDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(linkDialog).not.toBeVisible();
  expect(errors).toEqual([]);
});
