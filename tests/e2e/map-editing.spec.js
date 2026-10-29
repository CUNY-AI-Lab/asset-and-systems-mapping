import { expect, test, captureSourceRenderedScreenshot, scanAccessibility, assertNoAccessibilityViolations } from './support/test.js';
import { mapCommand, notebookSection, showMap, openTools } from './support/notebook.js';
import { buildEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { serializeProject } from '../../src/domain.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

const residentId = 'node_e2e_resident';
const edgeId = 'edge_e2e_attendant_assists_resident';
const inspector = page => page.locator('#map-inspector');
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const geometry = page => page.locator('#systems-map-canvas').evaluate(svg => ({
  camera: svg.querySelector('.viewport-layer').getAttribute('transform'),
  viewBox: svg.getAttribute('viewBox'),
  nodes: [...svg.querySelectorAll('.graph-node')].map(node => [node.dataset.graphId, node.getAttribute('transform')]),
}));

async function openProject(page, project) {
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('editing-fixture-loaded')) return;
    localStorage.setItem(key, value);
    sessionStorage.setItem('editing-fixture-loaded', 'yes');
  }, { key: STORAGE_KEY, value: serializeProject(project) });
  await page.goto('/');
  await expect(page).toHaveTitle(/Systems Mapping/);
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Systems map' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function selectItem(page, id) {
  await showMap(page);
  const project = await stored(page);
  const item = project.graph.nodes.find(node => node.id === id) || project.graph.edges.find(edge => edge.id === id);
  expect(item, `Saved map item ${id}`).toBeTruthy();
  const fullMap = page.getByRole('button', { name: 'Show full map', exact: true });
  if (await fullMap.isVisible()) await fullMap.click();
  await openTools(page);
  await page.getByRole('combobox', { name: 'Show map layer' }).selectOption(item.scale);
  const savedLinkage = item.scale === 'meso' && !item.source;
  await mapCommand(page, savedLinkage ? 'List' : 'Canvas');
  if (savedLinkage) {
    // Earlier projects retain their scoped Meso records in List; new Meso
    // relationships use the existing Micro nodes on the canvas.
    await page.getByRole('button', { name: `Open details for ${item.label}`, exact: true }).click();
  } else {
    await page.locator(`[data-graph-id="${id}"]`).press('Enter');
  }
  await expect(inspector(page)).toBeVisible();
  // Let the phone drawer resize and selected-item fit finish before taking
  // the camera snapshot that later edits must preserve.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function fixture() {
  const project = buildEastHarlemDisabilityProject();
  project.reflection = 'Preserve these synthetic Field Notes exactly.';
  project.levelProgress.macrosphere.reflection = project.reflection;
  project.graph.nodes.find(node => node.id === residentId).annotations.analytical.text = 'A preserved interpretation.';
  project.graph.edges.find(edge => edge.id === edgeId).annotation.text = 'A preserved connection annotation.';
  return project;
}

test('contextual manual item edits cancel, validate, save, reload, and keep the selected view stable', async ({ page, makeAxeBuilder }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await openProject(page, fixture());
  await selectItem(page, residentId);
  const before = await stored(page);
  const label = inspector(page).getByRole('textbox', { name: 'Label', exact: true });
  await label.fill('Discarded label');
  await inspector(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(label).toHaveValue('Resident');
  await label.fill('Escape this draft');
  await label.press('Escape');
  await expect(label).toHaveValue('Resident');
  await label.fill('');
  await inspector(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(inspector(page).getByRole('alert')).toHaveText('Enter a label of 1–200 characters.');
  expect((await stored(page)).graph).toEqual(before.graph);
  await inspector(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await label.fill('Unsaved selection draft');
  await selectItem(page, edgeId);
  await expect(inspector(page).getByRole('textbox', { name: 'Relationship', exact: true })).toHaveValue('assists');
  await selectItem(page, residentId);
  await expect(label).toHaveValue('Resident');
  const view = await geometry(page);
  const newLabel = 'Neighborhood resident and community participant';
  await label.fill(newLabel);
  await label.press('Tab');
  expect((await stored(page)).graph).toEqual(before.graph);
  await inspector(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await stored(page)).graph.nodes.find(node => node.id === residentId).label).toBe(newLabel);
  expect(await geometry(page)).toEqual(view);
  await captureSourceRenderedScreenshot(page, testInfo, 'Selected item label saved');
  await selectItem(page, edgeId);
  const relationship = inspector(page).getByRole('textbox', { name: 'Relationship', exact: true });
  const edgeView = await geometry(page);
  const wording = 'helps coordinate appointments and daily support';
  await relationship.fill(wording);
  await inspector(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await stored(page)).graph.edges.find(edge => edge.id === edgeId).verb).toBe(wording);
  expect(await geometry(page)).toEqual(edgeView);
  const saved = await stored(page);
  expect(saved.graph.nodes.find(node => node.id === residentId)).toEqual({ ...before.graph.nodes.find(node => node.id === residentId), label: newLabel });
  expect(saved.graph.edges.find(edge => edge.id === edgeId)).toEqual({ ...before.graph.edges.find(edge => edge.id === edgeId), verb: wording, targetLabel: newLabel });
  expect(saved.candidates).toEqual(before.candidates);
  expect(saved.viewport).toEqual(before.viewport);
  expect(saved.submission).toEqual(before.submission);
  expect(saved.levelProgress).toEqual(before.levelProgress);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Selected relationship editor'));
  await captureSourceRenderedScreenshot(page, testInfo, 'Selected relationship saved');
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await selectItem(page, edgeId);
  await expect(relationship).toHaveValue(wording);
  expect((await stored(page)).graph).toEqual(saved.graph);
  expect(errors).toEqual([]);
});

test('candidate and selected connection wording stay synchronized before and after finishing review', async ({ page }, testInfo) => {
  const project = fixture();
  project.activeScale = 'meso';
  project.instructor.requireStudentConfirmation = true;
  project.candidates = {
    nodes: [structuredClone(project.graph.nodes.find(node => node.id === residentId))],
    edges: [structuredClone(project.graph.edges.find(edge => edge.id === edgeId))],
  };
  await openProject(page, project);
  await selectItem(page, edgeId);
  await inspector(page).getByRole('textbox', { name: 'Relationship', exact: true }).fill('provides daily support to');
  await inspector(page).getByRole('button', { name: 'Save', exact: true }).click();
  await notebookSection(page, 'suggestions');
  await page.getByRole('combobox', { name: 'Suggestion type' }).selectOption('edges');
  const details = page.locator('.candidate-details');
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
  const candidate = page.getByRole('textbox', { name: 'Direct connection' });
  await expect(candidate).toHaveValue('provides daily support to');
  await candidate.fill('coordinates home appointments with');
  await inspector(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await stored(page)).graph.edges.find(edge => edge.id === edgeId).verb).toBe('coordinates home appointments with');
  const beforeCommit = await stored(page);
  expect(beforeCommit.candidates.edges[0].verb).toBe('coordinates home appointments with');
  await page.getByRole('button', { name: 'Finish review' }).click();
  await selectItem(page, edgeId);
  await expect(inspector(page).getByRole('textbox', { name: 'Relationship', exact: true })).toHaveValue('coordinates home appointments with');
  expect((await stored(page)).graph.edges.find(edge => edge.id === edgeId)).toEqual(beforeCommit.graph.edges.find(edge => edge.id === edgeId));
  await captureSourceRenderedScreenshot(page, testInfo, 'Candidate wording synchronized');
});

test('accepted Ask connections have a contextual relationship editor without candidate copies', async ({ page }, testInfo) => {
  const project = fixture();
  project.activeScale = 'meso';
  project.instructor.requireStudentConfirmation = true;
  await page.route('**/api/map/connections', route => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ connections: [{
    source: residentId, target: 'node_e2e_resource_navigator', verb: 'asks for assistance from', rationale: 'Synthetic model response for a local browser test.',
  }] }) }));
  await openProject(page, project);
  await notebookSection(page, 'suggestions');
  await page.getByRole('combobox', { name: 'Suggestion type' }).selectOption('suggest');
  await page.getByRole('button', { name: 'Suggest connections' }).click();
  await expect(page.getByRole('textbox', { name: 'Connection for suggestion 1' })).toHaveValue('asks for assistance from');
  await page.locator('.connection-suggestions').getByRole('button', { name: 'Add to map', exact: true }).click();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect.poll(async () => (await stored(page)).graph.edges.length).toBe(project.graph.edges.length + 1);
  const added = (await stored(page)).graph.edges.find(edge => edge.verb === 'asks for assistance from');
  await selectItem(page, added.id);
  await inspector(page).getByRole('textbox', { name: 'Relationship', exact: true }).fill('discusses access needs with');
  await inspector(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await stored(page)).graph.edges.find(edge => edge.id === added.id).verb).toBe('discusses access needs with');
  expect((await stored(page)).graph.edges.find(edge => edge.id === added.id)).toEqual({ ...added, verb: 'discusses access needs with' });
  expect((await stored(page)).candidates.edges).toEqual([]);
  await captureSourceRenderedScreenshot(page, testInfo, 'Accepted Ask relationship edited');
});

test('selected levels validate their own wording and compact controls fit narrow phones', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await openProject(page, fixture());
  const widths = testInfo.project.name.includes('phone') ? [320, 430] : [1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    for (const [id, invalid] of [
      ['node_e2e_mobility_scheduling_office', 'Transportation access'],
      ['node_e2e_home_care_policy', 'Regional Mobility Scheduling Office'],
      ['node_e2e_home_center_coordination', 'supports'],
    ]) {
      await selectItem(page, id);
      const original = (await stored(page)).graph.nodes.find(node => node.id === id);
      await inspector(page).getByRole('textbox', { name: 'Label', exact: true }).fill(invalid);
      await inspector(page).getByRole('button', { name: 'Save', exact: true }).click();
      await expect(inspector(page).getByRole('alert')).toBeVisible();
      expect((await stored(page)).graph.nodes.find(node => node.id === id)).toEqual(original);
      await inspector(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await selectItem(page, 'edge_e2e_office_rules_center');
    const relationship = inspector(page).getByRole('combobox', { name: 'Relationship', exact: true });
    const next = (await relationship.inputValue()) === 'funds' ? 'regulates' : 'funds';
    const before = await geometry(page);
    await relationship.selectOption(next);
    for (const name of ['Save', 'Cancel']) {
      const button = inspector(page).getByRole('button', { name, exact: true });
      await expect(button).toBeInViewport();
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    await captureSourceRenderedScreenshot(page, testInfo, `Relationship draft ${width}`);
    await inspector(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await stored(page)).graph.edges.find(edge => edge.id === 'edge_e2e_office_rules_center').verb).toBe(next);
    expect(await geometry(page)).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button')).toHaveCount(2);
    await selectItem(page, 'node_e2e_mobility_scheduling_office');
    const longLabel = 'United States Department of Transportation Federal Transit Administration';
    const label = inspector(page).getByRole('textbox', { name: 'Label', exact: true });
    if (await label.inputValue() !== longLabel) {
      const textView = await geometry(page);
      await label.fill(longLabel);
      await inspector(page).getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(async () => (await stored(page)).graph.nodes.find(node => node.id === 'node_e2e_mobility_scheduling_office').label).toBe(longLabel);
      expect(await geometry(page)).toEqual(textView);
    }
    await showMap(page);
    const fullMap = page.getByRole('button', { name: 'Show full map', exact: true });
    if (await fullMap.count()) await fullMap.click();
    await mapCommand(page, 'Arrange map');
    await page.locator('[data-graph-id="node_e2e_mobility_scheduling_office"]').press('ArrowRight');
    await expect(page.getByRole('heading', { name: 'Systems map' })).toBeVisible();
    await captureSourceRenderedScreenshot(page, testInfo, `Long label arranged ${width}`);

  }
  expect(errors).toEqual([]);
});
