import { expect, test, scanAccessibility, assertNoAccessibilityViolations, captureSourceRenderedScreenshot } from './support/test.js';
import { serializedEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

async function expectDottedPreview(preview) {
  await expect(preview).toBeAttached();
  const line = await preview.evaluate(el => {
    const bounds=el.getBoundingClientRect(),canvas=el.ownerSVGElement.getBoundingClientRect(),style=getComputedStyle(el);
    return {length:el.getTotalLength(),display:style.display,visibility:style.visibility,strokeWidth:parseFloat(style.strokeWidth),onCanvas:bounds.right>=canvas.left&&bounds.left<=canvas.right&&bounds.bottom>=canvas.top&&bounds.top<=canvas.bottom};
  });
  // A horizontal SVG line has zero CSS-box height even when its stroke is
  // visibly painted. Check the actual segment and canvas intersection.
  expect(line.length).toBeGreaterThan(40);expect(line.strokeWidth).toBeGreaterThan(0);
  expect(line.display).not.toBe('none');expect(line.visibility).toBe('visible');expect(line.onCanvas).toBe(true);
}

test('selection preserves Notebook choice and the compact editor preserves saved work', async ({ page, makeAxeBuilder }, testInfo) => {
  let modelCalls = 0;
  await page.route('**/api/preflight/evaluations', route => { modelCalls++; return route.abort(); });
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem('compact-seeded')) { localStorage.setItem(key, value); localStorage.setItem('compact-seeded', '1'); } }, { key: STORAGE_KEY, value: serializedEastHarlemDisabilityProject() });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const open = () => page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
  await open();
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('micro');
  const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await nav.getByRole('button', { name: 'Map', exact: true }).click();
  const node = page.locator('.graph-node').first();
  await node.focus(); await node.press('Enter');
  await expect(nav.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const notebook = page.getByRole('complementary', { name: 'Notebook', exact: true });
  await expect(notebook.getByRole('heading', { name: 'Edit', exact: true })).toBeVisible();
  expect(await notebook.locator('input:visible, select:visible, textarea:visible').count()).toBe(2);
  const interpretation = notebook.getByRole('textbox', { name: 'Interpretation', exact: true });
  await expect(interpretation).not.toHaveAttribute('placeholder');
  const text = 'Synthetic observation: the resource center connects people. I need to check who coordinates appointments.';
  await interpretation.fill(text); await interpretation.blur();
  await page.locator('.inspector__scroll').evaluate(el => { el.scrollTop = 0; });
  await captureSourceRenderedScreenshot(page, testInfo, 'Compact node editor');
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Compact node editor'));
  const savedText = `${text} What is still uncertain?`;
  await interpretation.fill(savedText); await interpretation.blur();
  await nav.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('meso');
  await nav.getByRole('button', { name: 'Map', exact: true }).click();
  const edge = page.locator('.graph-edge').first(); await edge.focus(); await edge.press('Enter');
  await expect(nav.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(notebook.getByRole('heading', { name: 'Edit', exact: true })).toBeVisible();
  expect(await notebook.locator('input:visible, select:visible, textarea:visible').count()).toBe(3);
  await captureSourceRenderedScreenshot(page, testInfo, 'Compact relationship editor');
  await nav.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('micro');
  await nav.getByRole('button', { name: 'Notebook', exact: true }).click();
  await notebook.getByRole('combobox', { name: 'Notebook section' }).selectOption('review');
  await expect(notebook.getByRole('heading', { name: 'Field Notes (Required)' })).toBeVisible();
  const notes = notebook.getByRole('textbox', { name: 'Field notes (required)', exact: true });
  await notes.fill('Synthetic field note: ask who coordinates these services.'); await notes.blur();
  await expect(page.getByRole('button', { name: 'Continue to Meso', exact: true })).toBeVisible();
  await captureSourceRenderedScreenshot(page, testInfo, 'Compact required Field Notes');
  await page.reload(); await open();
  await nav.getByRole('button', { name: 'Notebook', exact: true }).click();
  await expect(notes).toHaveValue('Synthetic field note: ask who coordinates these services.');
  await nav.getByRole('button', { name: 'Map', exact: true }).click();
  await page.locator('.graph-node').first().focus(); await page.locator('.graph-node').first().press('Enter');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(interpretation).toHaveValue(savedText);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(modelCalls).toBe(0);
});

test('relationship draft survives navigation and reload; blank wording commits without losing direction', async ({ page }, testInfo) => {
  await page.route('**/api/preflight/evaluations', route => route.abort());
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem('draft-fixture-seeded')) { localStorage.setItem(key, value); localStorage.setItem('draft-fixture-seeded', '1'); } }, { key: STORAGE_KEY, value: serializedEastHarlemDisabilityProject() });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const open = () => page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
  await open();
  const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('meso');
  await nav.getByRole('button', { name: 'Map', exact: true }).click();
  const nodes = page.locator('.graph-node');
  const sourceId = await nodes.nth(0).getAttribute('data-graph-id');
  const targetId = await nodes.nth(1).getAttribute('data-graph-id');
  const edgeCount = await page.locator('.graph-edge').count();
  const originalIds = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).graph.edges.map(e => e.id), STORAGE_KEY);
  await nodes.first().focus(); await nodes.first().press('Enter');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: /^Connect from / }).click();
  await nodes.nth(1).focus(); await nodes.nth(1).press('Enter');
  await expect(nav.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const preview = page.locator('.relationship-draft-preview line');
  await expectDottedPreview(preview);
  expect(await preview.getAttribute('x1')).not.toBe(await preview.getAttribute('x2'));
  await expect(preview).toHaveAttribute('stroke-dasharray', '3 6');
  await expect(page.locator('.graph-edge')).toHaveCount(edgeCount);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.locator('.add-form');
  await expect(form.locator('input,select,textarea')).toHaveCount(4);
  await expect(form.getByRole('textbox', { name: 'Relationship', exact: true })).toHaveValue('');
  await form.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('varies');
  await form.getByRole('button', { name: 'Close', exact: true }).click();
  await expectDottedPreview(preview);
  await nodes.first().focus(); await nodes.first().press('Enter');
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('micro');
  await expect(preview).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('meso');
  await expectDottedPreview(preview);
  await page.reload(); await open();
  await nav.getByRole('button', { name: 'Map', exact: true }).click();
  await expectDottedPreview(preview);
  await page.getByRole('button', { name: 'Resume relationship', exact: true }).click();
  await expect(form.getByRole('combobox', { name: 'From', exact: true })).toHaveValue(sourceId);
  await expect(form.getByRole('combobox', { name: 'To', exact: true })).toHaveValue(targetId);
  await expect(form.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue('varies');
  if (testInfo.project.name === 'chromium-phone') {
    await expect(nodes).toHaveCount(6);
    await expect.poll(async () => nodes.evaluateAll(items => Math.min(...items.map(item => item.getBoundingClientRect().width)))).toBeGreaterThan(70);
  }
  await captureSourceRenderedScreenshot(page, testInfo, 'Cached dotted relationship draft');
  await form.getByRole('button', { name: 'Add relationship', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).graph.edges.length, STORAGE_KEY)).toBe(originalIds.length + 1);
  const saved = await page.evaluate(({ key, originalIds }) => JSON.parse(localStorage.getItem(key)).graph.edges.find(e => !originalIds.includes(e.id)), { key: STORAGE_KEY, originalIds });
  expect(saved.verb).toBe(''); expect(saved.relationshipProcess.direction).toBe('varies');
  await page.reload(); await open();
  await nav.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume relationship', exact: true })).toHaveCount(0);
  const edge = page.locator(`[data-graph-id="${saved.id}"]`);
  await expect(edge.locator('.edge-line')).not.toHaveAttribute('marker-end');
  await expect(edge.locator('.edge-line')).not.toHaveAttribute('marker-start');
  await expect(edge).toHaveAttribute('aria-label', /direction: varies/);
  await expect(page.locator(`[data-edge-id="${saved.id}"]`)).not.toContainText('direction varies');
  await expect(page.locator(`[data-edge-id="${saved.id}"] .edge-direction-symbol`)).toBeVisible();
  await edge.focus(); await edge.press('Enter'); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const wording = page.getByRole('textbox', { name: 'Relationship', exact: true });
  await wording.fill('shelters'); await wording.press('Enter');
  await expect(page.locator(`[data-edge-id="${saved.id}"] .edge-label`)).toHaveText('shelters');
  await nav.getByRole('button', { name: 'Map', exact: true }).click();
  await captureSourceRenderedScreenshot(page, testInfo, 'Relationship wording and separate direction symbol');
  await nodes.first().focus(); await nodes.first().press('Enter'); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: /^Connect from / }).click();
  await nodes.nth(1).focus(); await nodes.nth(1).press('Enter'); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await form.getByRole('button', { name: 'Discard relationship', exact: true }).click();
  await page.reload(); await open();
  await expect(page.getByRole('button', { name: 'Resume relationship', exact: true })).toHaveCount(0);
  await expect(preview).toHaveCount(0);
});

test('Micro and Meso dragging uses available canvas after zoom and resize and survives reload', async ({ page }, testInfo) => {
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem('drag-fixture-seeded')) { localStorage.setItem(key, value); localStorage.setItem('drag-fixture-seeded', '1'); } }, { key: STORAGE_KEY, value: serializedEastHarlemDisabilityProject() });
  await page.goto('/'); await page.getByRole('textbox', { name: 'Class code' }).fill('101'); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const open = () => page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
  await open(); const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  let id, last;
  for (const scale of ['micro', 'meso']) {
    await page.getByRole('combobox', { name: 'Work level' }).selectOption(scale);
    await nav.getByRole('button', { name: 'Map', exact: true }).click();
    await page.locator('.graph-canvas').focus();
    await page.locator('.graph-canvas').press('-');
    await page.locator('.graph-canvas').press('-');
    const cards = await page.locator('.graph-node').evaluateAll(els => els.map(el => ({ id: el.getAttribute('data-graph-id'), x: el.getBoundingClientRect().x, width: el.getBoundingClientRect().width })).sort((a,b) => b.x - a.x));
    id = cards[0].id;
    const node = page.locator(`[data-graph-id="${id}"]`);
    const rect = await node.boundingBox(), canvas = await page.locator('.graph-canvas').boundingBox();
    const previous = await node.evaluate(el => {
      const [,x,y]=el.getAttribute('transform').match(/translate\((-?[\d.]+) (-?[\d.]+)\)/);
      return {x:Number(x),y:Number(y)};
    });
    const startX = rect.x + rect.width / 2, startY = rect.y + rect.height / 2;
    const targetX = canvas.x + Math.max(40, canvas.width * .12);
    expect(startX).toBeGreaterThan(targetX + 10);
    await page.mouse.move(startX, startY); await page.mouse.down(); await page.mouse.move(targetX, startY, { steps: 12 }); await page.mouse.up();
    await expect.poll(() => node.evaluate(el => Number(el.getAttribute('transform').match(/translate\((-?[\d.]+)/)[1]))).toBeLessThan(previous.x - 10);
    const moved = await node.evaluate(el => {
      const [,x,y]=el.getAttribute('transform').match(/translate\((-?[\d.]+) (-?[\d.]+)\)/);
      return {x:Number(x),y:Number(y)};
    });
    await expect.poll(() => page.evaluate(({key,id}) => {
      const node=JSON.parse(localStorage.getItem(key)).graph.nodes.find(n=>n.id===id);
      return {x:node.x,y:node.y};
    }, {key:STORAGE_KEY,id})).toEqual(moved);
    last = moved;
    await expect(nav.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const old = page.viewportSize(); await page.setViewportSize({ width: old.width - 20, height: old.height }); await page.setViewportSize(old);
    const saved = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).graph.nodes.find(n => n.id === id), { key: STORAGE_KEY, id });
    expect({ x: saved.x, y: saved.y }).toEqual({ x: last.x, y: last.y });
  }
  await captureSourceRenderedScreenshot(page, testInfo, 'Meso node moved into left canvas');
  await page.reload(); await open();
  const restored = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).graph.nodes.find(n => n.id === id), { key: STORAGE_KEY, id });
  expect({ x: restored.x, y: restored.y }).toEqual({ x: last.x, y: last.y });
});
