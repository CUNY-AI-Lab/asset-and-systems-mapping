import { test, expect, captureSourceRenderedScreenshot } from './support/test.js';
import { serializedEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { openTools, showMap, editSelected } from './support/notebook.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

const residentId = 'node_e2e_resident';
const savedProject = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const displayedPositions = page => page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.graphId, node.getAttribute('transform')])));
const nodePosition = (project, id = residentId) => {
  const node = project.graph.nodes.find(item => item.id === id);
  return { x: node.x, y: node.y };
};
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const sizes = testInfo => testInfo.project.name.includes('phone')
  ? [{ width: 390, height: 844 }, { width: 375, height: 667 }]
  : [{ width: 1440, height: 1000 }];

async function openMeso(page) {
  await page.goto('/');
  const login = page.getByRole('textbox', { name: 'Class code' });
  if (await login.isVisible()) {
    await login.fill('101');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('meso');
  await showMap(page);
  await openTools(page);
  const tools = page.locator('.notebook-map-tools');
  await tools.getByRole('combobox', { name: 'Show map layer' }).selectOption('meso');
  await tools.getByRole('button', { name: 'Fit map', exact: true }).click();
  if (await tools.evaluate(element => element.open)) await tools.locator(':scope > summary').click();
  await settle(page);
}

async function selectResident(page, phone) {
  const resident = page.locator(`[data-graph-id="${residentId}"]`);
  if (phone) await resident.tap();
  else await resident.click();
  await editSelected(page);
  await expect(page.getByRole('complementary',{name:'Notebook'}).getByRole('textbox',{name:'Label',exact:true})).toHaveValue('Resident');
  await expect(resident).toHaveAttribute('aria-pressed', 'true');
  await settle(page);
  return resident;
}

async function dragResident(page, phone, direction = 1) {
  const node = page.locator(`[data-graph-id="${residentId}"]`);
  const before = await node.getAttribute('transform');
  const bounds = await node.boundingBox();
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const hit = await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('[data-graph-id]')?.dataset.graphId, start);
  expect(hit, 'The selected node stays reachable while its details are open').toBe(residentId);
  await page.evaluate(() => {
    window.__mapDragEvents = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      document.addEventListener(type, event => window.__mapDragEvents.push({ type, pointerType: event.pointerType, trusted: event.isTrusted }), { capture: true, once: type !== 'pointermove' });
    }
  });
  const positions = [];
  const session = phone ? await page.context().newCDPSession(page) : null;
  try {
    if (phone) await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
    else { await page.mouse.move(start.x, start.y); await page.mouse.down(); }
    for (let step = 1; step <= 6; step += 1) {
      const point = { x: start.x + direction * step * 5, y: start.y + direction * step * 3 };
      if (phone) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      else await page.mouse.move(point.x, point.y);
      await settle(page);
      positions.push(await node.getAttribute('transform'));
    }
    expect(positions.at(-1), 'Dragging moves the node before release').not.toBe(before);
    expect(new Set(positions).size, 'The node follows successive pointer movements').toBeGreaterThan(2);
  } finally {
    if (phone) { await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await session.detach(); }
    else await page.mouse.up();
  }
  await settle(page);
  const events = await page.evaluate(() => window.__mapDragEvents);
  expect(events.some(event => event.type === 'pointerdown' && event.pointerType === (phone ? 'touch' : 'mouse') && event.trusted)).toBe(true);
  expect(events.some(event => event.type === 'pointerup' && event.pointerType === (phone ? 'touch' : 'mouse') && event.trusted)).toBe(true);
  expect(events.filter(event => event.type === 'pointercancel')).toEqual([]);
  return { before, positions, events, requestedDelta: { x: direction * 30, y: direction * 18 } };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: STORAGE_KEY, value: serializedEastHarlemDisabilityProject() });
});

test('Project, Map tools, and work level share one accessible row with more room for the map', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  for (const size of sizes(testInfo)) {
    await page.setViewportSize(size);
    await openMeso(page);
    const controls = [page.locator('.project-menu > summary'), page.getByRole('combobox', { name: 'Work level' }), page.getByRole('button', { name: 'Map', exact: true }), page.getByRole('button', { name: 'Notebook', exact: true }), page.locator('.notebook-map-tools > summary')];
    const bounds = await Promise.all(controls.map(control => control.boundingBox()));
    for (const [index, box] of bounds.entries()) {
      await expect(controls[index]).toBeInViewport({ ratio: 1 });
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.y).toBeLessThan(64);
      if (index) expect(box.x).toBeGreaterThanOrEqual(bounds[index - 1].x + bounds[index - 1].width);
    }
    expect(Math.max(...bounds.map(box => box.y)) - Math.min(...bounds.map(box => box.y))).toBeLessThanOrEqual(4);
    const canvas = page.locator('.canvas-wrap');
    await expect(canvas).toBeVisible();
    expect((await canvas.boundingBox()).height).toBeGreaterThanOrEqual(size.height - 130);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.getByRole('button', { name: 'Connect nodes', exact: true })).toHaveCount(0);
    await captureSourceRenderedScreenshot(page, testInfo, `Workspace controls ${size.width}x${size.height}`);
    await openTools(page);
    const menu = page.locator('.notebook-tools-body');
    await expect(menu).toBeInViewport({ ratio: 1 });
    const menuBounds = await menu.boundingBox();
    expect(menuBounds.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(size.height);
    for (const control of await menu.locator('button,select').all()) {
      await expect(control).toBeInViewport({ ratio: 1 });
      expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    await captureSourceRenderedScreenshot(page, testInfo, `Open Map tools ${size.width}x${size.height}`);
    await page.locator('.notebook-map-tools > summary').click();
    await selectResident(page, size.width < 600);
    await expect(canvas).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect from Resident', exact: true })).toBeVisible();
    await captureSourceRenderedScreenshot(page, testInfo, `Selected Resident with visible map ${size.width}x${size.height}`);
  }
});

test('trusted selected-node drags follow movement, save, and reload while connection cancellation retains the source', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const size of sizes(testInfo)) {
    await page.setViewportSize(size);
    await openMeso(page);
    const phone = size.width < 600;
    for (const state of ['details open', 'returned to Map']) {
      await selectResident(page, phone);
      if (state === 'returned to Map') { await showMap(page); await settle(page); }
      await expect(page.locator('.canvas-wrap')).toBeVisible();
      const before = await savedProject(page);
      const beforeDisplayed = await displayedPositions(page);
      // Exercise both directions so repeated viewport checks keep clear of
      // neighboring cards while verifying each saved arrangement independently.
      const evidence = await dragResident(page, phone, state === 'returned to Map' ? -1 : 1);
      await expect.poll(async () => nodePosition(await savedProject(page)), { timeout: 6000 }).not.toEqual(nodePosition(before));
      const saved = await savedProject(page);
      const afterDisplayed = await displayedPositions(page);
      // The first phone move makes its compact overview the saved coordinate
      // frame. Compare the displayed graph so that conversion is allowed while
      // every other visible node keeps its actual position in the arrangement.
      expect(Object.fromEntries(Object.entries(afterDisplayed).filter(([id]) => id !== residentId))).toEqual(Object.fromEntries(Object.entries(beforeDisplayed).filter(([id]) => id !== residentId)));
      const hiddenPositions = project => project.graph.nodes.filter(node => !Object.hasOwn(beforeDisplayed, node.id)).map(({ id, x, y }) => ({ id, x, y }));
      expect(hiddenPositions(saved)).toEqual(hiddenPositions(before));
      expect(saved.graph.edges).toEqual(before.graph.edges);
      await testInfo.attach(`Drag ${state} ${size.width}x${size.height}`, { body: JSON.stringify({ viewport: size, state, before: nodePosition(before), after: nodePosition(saved), beforeDisplayed, afterDisplayed, ...evidence }, null, 2), contentType: 'application/json' });
      await captureSourceRenderedScreenshot(page, testInfo, `Dragged Resident ${state} ${size.width}x${size.height}`);
      await page.reload();
      await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
      expect(nodePosition(await savedProject(page))).toEqual(nodePosition(saved));
      await showMap(page);
      await settle(page);
      expect(await displayedPositions(page)).toEqual(afterDisplayed);
    }
    await selectResident(page, phone);
    await page.getByRole('button', { name: 'Connect from Resident', exact: true }).click();
    await expect(page.locator('.map-connect-status')).toContainText('Resident');
    await page.keyboard.press('Escape');
    await expect(page.locator('.map-connect-status')).toHaveCount(0);
    await expect(page.locator(`[data-graph-id="${residentId}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.add-form')).toHaveCount(0);
    await page.getByRole('button',{name:'Resume relationship',exact:true}).click();
    await page.getByRole('button',{name:'Discard relationship',exact:true}).click();
    await selectResident(page, phone);
    await page.getByRole('button', { name: 'Connect from Resident', exact: true }).click();
    const target = page.locator('[data-graph-id="node_e2e_resource_navigator"]');
    if (phone) await target.tap(); else await target.click();
    await expect(page.getByRole('navigation',{name:'Workspace',exact:true}).getByRole('button',{name:'Map',exact:true})).toHaveAttribute('aria-pressed','true');
    await editSelected(page);
    const form = page.locator('.add-form');
    await expect(form).toBeVisible();
    await expect(page.locator('.inspector__head h2')).toHaveText('Resident and Resource navigator');
    await expect(form.getByRole('combobox', { name: 'From', exact: true })).toHaveValue(residentId);
    await expect(form.getByRole('combobox', { name: 'To', exact: true })).toHaveValue('node_e2e_resource_navigator');
    await expect(page.locator('#inspector-add-actions')).toHaveCount(0);
    await captureSourceRenderedScreenshot(page, testInfo, `Native target tap keeps the connection editor ${size.width}x${size.height}`);
    // Each viewport starts a separate synthetic gesture. Closing preserves a
    // draft, so explicitly discard this fixture before the next viewport.
    await form.getByRole('button',{name:'Discard relationship',exact:true}).click();
    await expect(page.locator('.relationship-draft-preview')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
