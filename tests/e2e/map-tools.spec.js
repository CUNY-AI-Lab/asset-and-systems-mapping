import { expect, test, scanAccessibility, assertNoAccessibilityViolations, captureSourceRenderedScreenshot } from './support/test.js';
import { openTools, mapCommand } from './support/notebook.js';
import { serializedEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: STORAGE_KEY, value: serializedEastHarlemDisabilityProject() });
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
    // Project stays visible even when the narrowest layout moves Work level into its menu.
    await page.locator('.project-menu > summary').click();
    await expect(page.locator('.notebook-map-tools')).not.toHaveAttribute('open', '');
  }
});

test('map tool action rows align and search remains usable at narrow panel widths', async ({ page }) => {
  const phone = page.viewportSize().width <= 600;
  for (const width of phone ? [280] : [280, 240]) {
    await openTools(page);
    if (!phone) {
      const handle = page.getByRole('separator', { name: 'Resize map tools' });
      await handle.focus();
      await page.keyboard.press('Home');
      if (width === 240) for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowRight');
      await expect(handle).toHaveAttribute('aria-valuenow', String(width));
    }
    const body = page.locator('.notebook-tools-body');
    expect(await body.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const arrange = await body.getByRole('button', { name: 'Arrange map', exact: true }).boundingBox();
    const key = await body.getByRole('button', { name: 'Map key', exact: true }).boundingBox();
    expect(arrange.height).toBeGreaterThanOrEqual(44);
    expect(arrange.height).toBeCloseTo(key.height, 1);
    expect(arrange.y).toBeCloseTo(key.y, 1);
    expect(arrange.width).toBeCloseTo(key.width, 1);
    const zoom = await body.locator('.map-tools-zoom button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
    expect(new Set(zoom).size).toBe(1);
    await body.locator('.map-search > summary').click();
    const search = body.getByRole('searchbox', { name: 'Find map item' });
    await expect(search).toBeFocused();
    await search.fill('Resident');
    await expect(body.getByRole('status')).toContainText('1 match');
    expect(await body.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(body.locator('.map-search > summary')).toBeFocused();
    await expect(body.locator('.map-search')).not.toHaveAttribute('open', '');
    await page.locator('.notebook-map-tools > summary').focus();
    await page.keyboard.press('Escape');
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


for (const layer of ['all', 'meso']) test(`phone ${layer} relationship direction cues remain readable after fit and zoom`, async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('phone'), 'Mobile-only non-scaling arrow rendering');
  if (layer === 'meso') {
    await page.getByRole('combobox', { name: 'Work level' }).selectOption('meso');
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Map', exact: true }).click();
    await openTools(page);
    await page.getByRole('combobox', { name: 'Show map layer' }).selectOption('meso');
    await page.locator('.notebook-map-tools > summary').click();
  }
  if (layer === 'all') {
    await openTools(page);
    await page.getByRole('combobox', { name: 'Show map layer' }).selectOption('all');
    await page.locator('.notebook-map-tools > summary').click();
  }
  const graphBefore = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).graph, STORAGE_KEY);
  for (const action of ['Fit map', 'Zoom in', 'Zoom out']) {
    await mapCommand(page, action);
    const lines = page.locator('.graph-edge .edge-line');
    await expect(lines).toHaveCount(layer === 'meso' ? 4 : 5);
    if (layer === 'meso') await expect(page.locator('.graph-edge:not([data-edge-scale="meso"])')).toHaveCount(0);
    if (layer === 'meso' && action === 'Fit map') {
      await expect(page.locator('.graph-node')).toHaveCount(6);
      const clearance = await page.locator('.graph-canvas').evaluate(svg => {
        const cards = [...svg.querySelectorAll('.graph-node')].map(node => node.getBoundingClientRect());
        return [...svg.querySelectorAll('.edge-line')].map(path => {
          const matrix = path.getScreenCTM();
          const length = path.getTotalLength();
          const samples = Array.from({ length: 19 }, (_, i) => {
            const point = path.getPointAtLength(length * (i + 1) / 20);
            return new DOMPoint(point.x, point.y).matrixTransform(matrix);
          });
          return { length: length * Math.hypot(matrix.a, matrix.b),
            crossesCard: samples.some(p => cards.some(r => p.x > r.left + 2 && p.x < r.right - 2 && p.y > r.top + 2 && p.y < r.bottom - 2)) };
        });
      });
      for (const edge of clearance) {
        expect(edge.length).toBeGreaterThan(25);
        expect(edge.crossesCard).toBe(false);
      }
      for (const node of await page.locator('.graph-node').all()) await expect(node).toBeInViewport({ ratio: 1 });
    }
    const cues = await lines.evaluateAll(paths => paths.map(path => ({
      vectorEffect: getComputedStyle(path).vectorEffect,
      width: parseFloat(getComputedStyle(path).strokeWidth),
      opacity: getComputedStyle(path.parentElement).opacity,
      marker: path.getAttribute('marker-end'),
      endX: Number(path.getAttribute('x2')),
      endY: Number(path.getAttribute('y2')),
    })));
    for (const cue of cues) {
      expect(cue.vectorEffect).toBe('non-scaling-stroke');
      expect(cue.width).toBeGreaterThanOrEqual(2);
      expect(cue.opacity).toBe('1');
      expect(cue.marker).toBe('url(#arrowhead)');
      expect(Number.isFinite(cue.endX) && Number.isFinite(cue.endY)).toBe(true);
    }
    await expect(page.locator('#arrowhead')).toHaveAttribute('refX', '8');
    await expect(page.locator('#arrowhead')).toHaveAttribute('markerWidth', '6');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const graphAfter = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).graph, STORAGE_KEY);
  expect(graphAfter).toEqual(graphBefore);
});


test('phone Meso movement and Arrange preserve readable connector spacing', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('phone'), 'Phone Meso geometry');
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('meso');
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Map', exact: true }).click();
  await openTools(page);
  await page.getByRole('combobox', { name: 'Show map layer' }).selectOption('meso');
  await page.locator('.notebook-map-tools > summary').click();
  const node = page.locator('[data-graph-id="node_e2e_resource_center"]');
  const position = () => node.evaluate(el => el.getAttribute('transform').match(/[-\d.]+/g).map(Number));
  await expect(node).toBeInViewport({ ratio: 1 });
  const before = await position();
  await node.press('ArrowRight');
  await expect.poll(async () => (await position())[0]).toBeCloseTo(before[0] + 8, 1);
  expect((await position())[1]).toBeCloseTo(before[1], 1);
  const box = await node.boundingBox();
  const beforeDrag = await position();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await position())[0]).toBeGreaterThan(beforeDrag[0]);
  expect((await position())[1]).toBeCloseTo(beforeDrag[1], 0);
  await mapCommand(page, 'Arrange map');
  await mapCommand(page, 'Fit map');
  const lengths = await page.locator('.edge-line').evaluateAll(paths => paths.map(path => path.getTotalLength() * Math.hypot(path.getScreenCTM().a, path.getScreenCTM().b)));
  expect(Math.min(...lengths)).toBeGreaterThan(25);
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).events.some(event => event.action === 'map.arranged'), STORAGE_KEY)).toBe(true);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).graph, STORAGE_KEY);
  const center = saved.nodes.find(node => node.id === 'node_e2e_resource_center');
  expect(center).toBeTruthy();
  expect(Number.isFinite(center.x) && Number.isFinite(center.y)).toBe(true);
  await page.reload();
  await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).graph, STORAGE_KEY)).toEqual(saved);
});
