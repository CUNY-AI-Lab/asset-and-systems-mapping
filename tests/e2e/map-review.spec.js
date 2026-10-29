import { openTools, mapCommand, notebookSection, showMap, projectMenu, preferences } from './support/notebook.js';
import { expect, test, scanAccessibility, assertNoAccessibilityViolations, captureSourceRenderedScreenshot } from './support/test.js';
import { serializedEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

async function openProject(page, activeScale) {
  const fixture = JSON.parse(serializedEastHarlemDisabilityProject());
  if (activeScale) fixture.activeScale = activeScale;
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: JSON.stringify(fixture) });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
  await openTools(page);
  await page.getByRole('combobox', { name: 'Show map layer' }).selectOption('all');
  await page.locator('.notebook-map-tools > summary').click();
  await expect(page.locator('.graph-node')).toHaveCount(8);
  // The earlier Meso linkage remains saved and available through the list.
  expect((await readProject(page)).graph.nodes).toHaveLength(9);
  await mapCommand(page, 'Fit map');
}

async function readProject(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

test('students trace scopes in both directions, cross filtered layers, and return to their previous item', async ({ page, makeAxeBuilder }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await openProject(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const footerTop = await page.locator('.app-footer').evaluate((element) => element.getBoundingClientRect().top);
  await openTools(page);
  for (const name of ['Fit map', 'Full screen map']) {
    const bounds = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(footerTop);
  }
  const before = (await readProject(page)).graph;
  await openTools(page);
  await page.getByRole('combobox', { name: 'Show map layer' }).selectOption('micro');
  await page.locator('.notebook-map-tools > summary').click();
  await page.locator('[data-graph-id="node_e2e_home_setting"]').press('Enter');
  const inspector = page.getByRole('complementary', { name: 'Notebook' });
  await inspector.locator('.map-connections > summary').click();
  await expect(inspector.getByRole('region', { name: 'Part of mesosystems' })).toBeVisible();
  await inspector.getByRole('region', { name: 'Broader conditions' }).getByRole('button', { name: /State home care reimbursement policy/ }).click();
  await expect(page.locator('.notebook-map-tools select[aria-label="Show map layer"]')).toHaveValue('all');
  await expect(inspector.getByRole('heading', { name: 'State home care reimbursement policy', exact: true })).toBeVisible();
  await inspector.locator('.map-connections > summary').click();
  await expect(inspector.getByRole('region', { name: 'Affected map items' }).getByRole('button')).toHaveCount(3);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Expanded cross-level connections'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Expanded cross-level connections');
  await inspector.getByRole('button', { name: 'Back to Apartment building' }).click();
  await expect(page.locator('.notebook-map-tools select[aria-label="Show map layer"]')).toHaveValue('micro');
  await expect(inspector.getByRole('heading', { name: 'Apartment building', exact: true })).toBeVisible();
  expect((await readProject(page)).graph).toEqual(before);
  expect(errors).toEqual([]);
});

test('search finds hidden levels and list inspection restores keyboard focus', async ({ page, makeAxeBuilder }, testInfo) => {
  await openProject(page);
  const originalGraph = (await readProject(page)).graph;
  const visibleIds = () => page.locator('.graph-node, .graph-edge').evaluateAll(elements => elements.map(element => element.dataset.graphId).sort());
  const originalVisibleIds = await visibleIds();
  await openTools(page);
  await page.getByRole('combobox', { name: 'Show map layer' }).selectOption('micro');
  await page.locator('.notebook-map-tools > summary').click();
  await openTools(page);
  await page.locator('.map-search > summary').click();
  const search = page.getByRole('searchbox', { name: 'Find map item' });
  await expect(search).toBeFocused();
  await search.fill('reimbursement');
  await page.getByRole('search', { name: 'Find map elements' }).getByRole('button', { name: /State home care reimbursement policy/ }).click();
  await expect(page.locator('.notebook-map-tools select[aria-label="Show map layer"]')).toHaveValue('all');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const fullMap = page.getByRole('button', { name: 'Show full map', exact: true });
  if (await fullMap.isVisible()) await fullMap.click();
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  expect(await visibleIds()).toEqual(originalVisibleIds);
  expect((await readProject(page)).graph).toEqual(originalGraph);
  await mapCommand(page, 'List');
  const item = page.getByRole('button', { name: 'Open details for Apartment building', exact: true });
  await item.click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(item).toBeFocused();
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'List after inspection'));
});

test('layout undo restores positions without replacing annotations and the canvas supports zoom shortcuts', async ({ page }) => {
  await openProject(page);
  const canvas = page.locator('.graph-canvas');
  await canvas.focus();
  const transform = () => page.locator('.viewport-layer').getAttribute('transform');
  const initial = await transform();
  await canvas.press('+');
  await expect.poll(transform).not.toEqual(initial);
  await canvas.press('0');
  const nodes = page.locator('.graph-node');
  const positions = () => nodes.evaluateAll((items) => items.map((item) => [item.getAttribute('data-graph-id'), item.getAttribute('transform')]));
  // Phone overview is already arranged. Move an item so undo has a real change.
  const initialPositions = await positions();
  await page.locator('[data-graph-id="node_e2e_resident"]').press('Shift+ArrowRight');
  await expect.poll(positions).not.toEqual(initialPositions);
  const before = await positions();
  await mapCommand(page, 'Arrange map');
  await expect.poll(positions).not.toEqual(before);
  const arranged = await positions();
  await notebookSection(page, 'review');
  const field = page.getByRole('textbox', { name: 'Field notes (required)' });
  await field.fill('Layout changes must preserve this interpretation.');
  await showMap(page);
  await canvas.press('Control+z');
  await expect.poll(positions).toEqual(before);
  await expect.poll(async () => (await readProject(page)).reflection).toBe('Layout changes must preserve this interpretation.');
  await canvas.press('Control+Shift+z');
  await expect.poll(positions).toEqual(arranged);
});

test('reflection reopens earlier levels without exposing repeated summaries or completing another level', async ({ page, makeAxeBuilder }, testInfo) => {
  await openProject(page);
  await notebookSection(page, 'review');
  await expect(page.locator('#map-inspector [data-next-action]')).toHaveAttribute('data-next-action', /continue-level|complete-level|project-complete/);
  await expect(page.locator('.revision-status, .project-overview')).toHaveCount(0);
  const completed = (await readProject(page)).completedScales;
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Cumulative revision'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Cumulative revision');
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('micro');
  await notebookSection(page, 'review');
  await expect(page.getByRole('textbox', { name: 'Field notes (required)' })).toBeVisible();
  await expect.poll(async () => (await readProject(page)).activeScale).toBe('micro');
  expect((await readProject(page)).completedScales).toEqual(completed);
});


test('Space and middle-button drags pan over nodes without moving them, and Escape cancels a gesture', async ({ page }) => {
  await openProject(page);
  const canvas = page.locator('.graph-canvas');
  const transform = () => page.locator('.viewport-layer').getAttribute('transform');
  const nodesBefore = (await readProject(page)).graph.nodes;
  const node = page.locator('[data-graph-id="node_e2e_resource_center"]');
  for (const button of ['left', 'middle']) {
    await mapCommand(page, 'Fit map');
    await canvas.focus();
    const box = await node.boundingBox();
    const before = await transform();
    if (button === 'left') await page.keyboard.down('Space');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button });
    await page.mouse.move(box.x + box.width / 2 + 38, box.y + box.height / 2 + 22, { steps: 4 });
    await page.mouse.up({ button });
    if (button === 'left') await page.keyboard.up('Space');
    await expect.poll(transform).not.toBe(before);
    expect((await readProject(page)).graph.nodes).toEqual(nodesBefore);
    await expect(page.getByRole('complementary', { name: 'Notebook' })).not.toBeVisible();
  }
  const beforeCancel = await transform();
  const box = await node.boundingBox();
  await canvas.focus();
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 4 });
  await expect.poll(transform).not.toBe(beforeCancel);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect.poll(transform).toBe(beforeCancel);
  expect((await readProject(page)).graph.nodes).toEqual(nodesBefore);
});

test('manual additions keep canonical level values and save an outside institution at Exo-level', async ({ page }) => {
  await openProject(page, 'micro');
  await mapCommand(page, 'Add item');
  const inspector = page.getByRole('complementary', { name: 'Notebook' });
  await inspector.getByRole('button', { name: 'Add', exact: true }).click();
  await inspector.getByRole('button', { name: 'Node', exact: true }).click();
  await inspector.getByRole('combobox', { name: 'Level', exact: true }).selectOption('exosphere');
  await expect(inspector.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('institution');
  await inspector.getByRole('textbox', { name: 'Label', exact: true }).fill('New York City Housing Authority');
  await inspector.getByRole('textbox', { name: 'Evidence or question', exact: true }).fill('Investigate how the housing authority funds accessible building entrances.');
  await inspector.getByRole('button', { name: 'Add node', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).graph.nodes.find((node) => node.label === 'New York City Housing Authority')?.scale).toBe('exosphere');
});


test('dark mode exposes readable connection and search controls', async ({ page, makeAxeBuilder }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('systems-mapping.theme', 'dark'));
  await openProject(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('[data-graph-id="node_e2e_home_setting"]').press('Enter');
  await page.getByRole('complementary', { name: 'Notebook' }).locator('.map-connections > summary').click();
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Dark map connections'));
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await openTools(page);
  await page.locator('.map-search > summary').click();
  await page.getByRole('searchbox', { name: 'Find map item' }).fill('center');
  await expect(page.getByRole('search', { name: 'Find map elements' }).getByRole('button')).toHaveCount(2);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Dark map search'));
});

test('list remains readable when switching themes in both directions', async ({ page, makeAxeBuilder }, testInfo) => {
  await openProject(page);
  await mapCommand(page, 'List');
  for (const theme of ['dark', 'light']) {
    await preferences(page);
    await page.getByRole('button', { name: `Switch to ${theme} mode` }).click();
    await page.locator('.project-menu > summary').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, `${theme} map list`));
    await captureSourceRenderedScreenshot(page, testInfo, `${theme} map list`);
  }
});

test('saved theme loads before React and skip link stays readable', async ({ page, makeAxeBuilder }, testInfo) => {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('systems-mapping.theme', 'dark'));
  // Hold the application bundle: theme restoration must not depend on React.
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.unroute('**/assets/*.js');
  errors.length = 0;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Systems Mapping', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Skip to workspace' }).focus();
  await expect(page.getByRole('link', { name: 'Skip to workspace' })).toBeFocused();
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Dark focused skip link'));
  expect(errors).toEqual([]);
});
