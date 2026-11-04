import { expect, test, captureSourceRenderedScreenshot, scanAccessibility, assertNoAccessibilityViolations } from './support/test.js';
import { notebookSection, showMap, projectMenu, openTools, editSelected } from './support/notebook.js';
import { readFile } from 'node:fs/promises';
import { buildEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { serializeProject } from '../../src/domain.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

for (const populated of [false, true]) {
  test(`save recovery stays above the ${populated ? 'populated' : 'empty'} map without losing work`, async ({ page, makeAxeBuilder }, testInfo) => {
    test.setTimeout(120_000);
    const project = buildEastHarlemDisabilityProject();
    if (!populated) project.graph = { nodes: [], edges: [] };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ key, value }) => {
      if (!sessionStorage.getItem('save-layout-seeded')) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('save-layout-seeded', 'yes');
      }
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (window.failProjectSave && key.startsWith('systems-mapping-studio.')) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    }, { key: STORAGE_KEY, value: serializeProject(project) });
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Class code' }).fill('101');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Open project', exact: true }).click();
    await notebookSection(page, 'suggestions');
    const memoDrawer = page.locator('.memo-drawer');
    if (!await memoDrawer.evaluate(el => el.open)) await memoDrawer.locator(':scope > summary').click();
    await page.evaluate(() => { window.failProjectSave = true; });
    const memo = `${project.submission.text} Preserve this synthetic ${populated ? 'populated' : 'empty'} map through recovery.`;
    await page.getByRole('textbox', { name: /^Memo/ }).fill(memo);
    const notice = page.locator('.workspace-save-notice');
    await expect(notice.getByRole('button', { name: 'Recover project' })).toBeVisible();
    const widths = testInfo.project.name.includes('phone') ? [390, 320] : [1440, 1024];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await showMap(page);
      await captureSourceRenderedScreenshot(page, testInfo, `Save warning ${populated ? 'populated' : 'empty'} ${width}`);
      const banner = await notice.boundingBox();
      const stage = await page.locator('.map-stage').boundingBox();
      const canvas = await page.locator('.canvas-wrap').boundingBox();
      expect(banner.y + banner.height).toBeLessThanOrEqual(stage.y + 1);
      expect(banner.height).toBeLessThan(120);
      expect(stage.width).toBeGreaterThan(width * .94);
      expect(canvas.width).toBeGreaterThan(width * .9);
      expect(canvas.height).toBeGreaterThan(450);
      const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth - innerWidth, height: document.documentElement.scrollHeight - innerHeight }));
      expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(0);
      expect(overflow.height, JSON.stringify(overflow)).toBeLessThanOrEqual(1);
      await notice.getByRole('button', { name: 'Recover project' }).press('Enter');
      const recovery = page.getByRole('dialog', { name: 'Save recovery' });
      await expect(recovery).toBeVisible();
      await recovery.getByRole('button', { name: 'Close Save recovery' }).click();
      await notebookSection(page, 'suggestions');
      if (!await memoDrawer.evaluate(el => el.open)) await memoDrawer.locator(':scope > summary').click();
      await expect(page.getByRole('textbox', { name: /^Memo/ })).toHaveValue(memo);
      expect((await page.locator('#map-inspector').boundingBox()).height).toBeGreaterThan(450);
      assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, `Recovery notebook ${width}`));
    }
    await page.evaluate(() => { window.failProjectSave = false; });
    await notice.getByRole('button', { name: 'Recover project' }).click();
    await page.getByRole('button', { name: /try again|Try saving again/ }).click();
    await expect(notice).toHaveCount(0);
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).part2Submission?.text, STORAGE_KEY)).toBe(memo);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    expect(saved.graph).toEqual(project.graph);
    expect(saved.submission).toEqual(project.submission);
    expect(saved.part2Submission.text).toBe(memo);
    expect(saved.reflection).toBe(project.reflection);
    await page.reload();
    await page.getByRole('button', { name: 'Open project', exact: true }).click();
    await notebookSection(page, 'suggestions');
    if (!await memoDrawer.evaluate(el => el.open)) await memoDrawer.locator(':scope > summary').click();
    await expect(page.getByRole('textbox', { name: /^Memo/ })).toHaveValue(memo);
    const reloaded = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    expect(reloaded.submission).toEqual(project.submission);
    expect(reloaded.part2Submission.text).toBe(memo);
    expect(reloaded.graph).toEqual(project.graph);
    expect(errors).toEqual([]);
  });
}

for (const retainId of [false, true]) test(`unpublished course metadata saves, exports, and imports a populated map with ${retainId ? 'the same' : 'a different'} ID`, async ({ page }, testInfo) => {
  // The empty appendix is the existing course API contract, not generated guidance.
  await page.route('**/api/config/public?*', async route => {
    const response = await route.fetch();
    const snapshot = await response.json();
    snapshot.moduleVersions.push({ id: 'course-appendix', revision: 0, fingerprint: 'synthetic-empty-appendix' });
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start new project' }).click();
  const memo = 'This synthetic resident meets a navigator at a neighborhood center. No real person or organization is represented.';
  await page.getByRole('textbox', { name: /^Memo/ }).fill(memo);
  await page.getByRole('button', { name: 'Memo review', exact: true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).teacherGovernance?.preflight.moduleVersions.at(-1).revision, STORAGE_KEY)).toBe(0);
  await expect(page.locator('.workspace-save-notice')).toHaveCount(0);
  await projectMenu(page, 'Export & share');
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /^JSON/ }).click();
  const exported = JSON.parse(await readFile(await (await pendingDownload).path(), 'utf8'));
  expect(exported.submission.text).toBe(memo);
  expect(exported.graph).toEqual({ nodes: [], edges: [] });
  const imported = buildEastHarlemDisabilityProject();
  if (retainId) imported.id = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).id, STORAGE_KEY);
  await page.locator('.export-dropdown__import input').setInputFiles({ name: 'fabricated-map.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(imported)) });
  await expect(page.getByRole('combobox', { name: 'Work level' })).toHaveValue('macrosphere');
  await showMap(page);
  await openTools(page);
  await page.getByRole('combobox', { name: 'Show map layer' }).selectOption('all');
  await page.locator('.notebook-map-tools > summary').click();
  await expect(page.locator('.graph-node')).toHaveCount(8);
  const savedNodes = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).graph.nodes, STORAGE_KEY);
  expect(savedNodes).toHaveLength(9);
  expect(savedNodes.find(node => node.id === 'node_e2e_home_center_coordination')).toEqual(imported.graph.nodes.find(node => node.id === 'node_e2e_home_center_coordination'));
  await page.locator('[data-graph-id="node_e2e_resident"]').press('Enter');
  await editSelected(page);
  const inspector = page.locator('#map-inspector');
  await inspector.getByRole('textbox', { name: 'Label', exact: true }).fill('Synthetic resident after import');
  await inspector.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).graph.nodes.find(node => node.id === 'node_e2e_resident').label, STORAGE_KEY)).toBe('Synthetic resident after import');
  await captureSourceRenderedScreenshot(page, testInfo, 'Imported map editing after empty-course recovery');
  await page.reload();
  await page.getByRole('article', { name: imported.title }).getByRole('button', { name: 'Open project' }).click();
  await showMap(page);
  await openTools(page);
  await page.getByRole('combobox', { name: 'Show map layer' }).selectOption('all');
  await page.locator('.notebook-map-tools > summary').click();
  await expect(page.locator('.graph-node')).toHaveCount(8);
  const reloadedNodes = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).graph.nodes, STORAGE_KEY);
  expect(reloadedNodes).toHaveLength(9);
  expect(reloadedNodes.find(node => node.id === 'node_e2e_home_center_coordination')).toEqual(imported.graph.nodes.find(node => node.id === 'node_e2e_home_center_coordination'));
  expect(reloadedNodes.find(node => node.id === 'node_e2e_resident').label).toBe('Synthetic resident after import');
  await expect(page.locator('.workspace-save-notice')).toHaveCount(0);
});
