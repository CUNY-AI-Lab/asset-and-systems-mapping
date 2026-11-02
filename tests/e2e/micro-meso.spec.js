import { readFile } from 'node:fs/promises';
import { test, expect, captureSourceRenderedScreenshot, scanAccessibility, assertNoAccessibilityViolations } from './support/test.js';
import { buildEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { projectMenu, showMap, mapCommand, openTools, editSelected } from './support/notebook.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

const readProject = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const positions = page => page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.graphId, node.getAttribute('transform')])));
const microCircle = page => page.locator('.shared-micro-boundary ellipse').evaluate(ellipse => ['cx', 'cy', 'rx', 'ry'].map(name => Number(ellipse.getAttribute(name))));

async function expectSharedMicroCircle(page) {
  await expect(page.locator('[data-ecology-layer]')).toHaveCount(1);
  await expect(page.locator('[data-ecology-layer="micro"]')).toHaveCount(1);
  const outside = await page.locator('.graph-canvas').evaluate(svg => {
    const ellipse = svg.querySelector('.shared-micro-boundary ellipse');
    const [cx, cy, rx, ry] = ['cx', 'cy', 'rx', 'ry'].map(name => Number(ellipse.getAttribute(name)));
    const inside = point => ((point.x - cx) / rx) ** 2 + ((point.y - cy) / ry) ** 2 <= 1.0001;
    const camera = svg.querySelector('.viewport-layer').getScreenCTM().inverse();
    const issues = [];
    for (const element of svg.querySelectorAll('.node-card, .edge-label-bg')) {
      const box = element.getBoundingClientRect();
      const points = [[box.left, box.top], [box.right, box.top], [box.left, box.bottom], [box.right, box.bottom]];
      if (points.some(([x, y]) => !inside(new DOMPoint(x, y).matrixTransform(camera)))) issues.push(element.closest('[data-graph-id], [data-edge-id]')?.dataset.graphId || 'relationship label');
    }
    for (const path of svg.querySelectorAll('.edge-line')) {
      const length = path.getTotalLength();
      if (Array.from({ length: 31 }, (_, i) => path.getPointAtLength(length * i / 30)).some(point => !inside(point))) issues.push(path.closest('[data-graph-id]').dataset.graphId);
    }
    return issues;
  });
  expect(outside, 'Nodes, relationship labels, and arrows stay inside the single shared Micro circle').toEqual([]);
}

test('Micro keeps its arrangement while Meso connects the same nodes and saves arrow direction', async ({ page, makeAxeBuilder }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const fixture = buildEastHarlemDisabilityProject();
  fixture.schemaVersion = 7;
  fixture.activeScale = 'micro';
  fixture.stage = 3;
  fixture.furthestStage = 4;
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: STORAGE_KEY, value: JSON.stringify(fixture) });
  await page.goto('/');
  await expect(page).toHaveTitle(/Systems Mapping/);
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('article', { name: fixture.title }).getByRole('button', { name: 'Open project' }).click();
  await expect(page.locator('.graph-node')).toHaveCount(6);
  await expect(page.locator('.graph-edge')).toHaveCount(0);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  const microPositions = await positions(page);
  await expectSharedMicroCircle(page);
  const initialCircle = await microCircle(page);
  const savedPositions = (await readProject(page)).graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
  await captureSourceRenderedScreenshot(page, testInfo, 'Micro nodes');

  await page.getByRole('combobox', { name: 'Work level' }).selectOption('meso');
  await showMap(page);
  await expect(page.getByRole('button', { name: 'Connect nodes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Connect from / })).toHaveCount(0);
  await expect(page.locator('.graph-edge')).toHaveCount(4);
  await expect(page.locator('[data-ecology-layer="meso"]')).toHaveCount(0);
  expect(await positions(page)).toEqual(microPositions);
  await expectSharedMicroCircle(page);
  expect(await microCircle(page)).toEqual(initialCircle);
  const before = (await readProject(page)).graph.edges.length;
  const resident = page.locator('[data-graph-id="node_e2e_resident"]');
  await expect(resident).toBeVisible();
  await resident.focus();
  await resident.press('Enter');
  await editSelected(page);
  await page.getByRole('button', { name: 'Connect from Resident', exact: true }).click();
  await expect(page.locator('.map-connect-status')).toContainText('Resident selected');
  await page.keyboard.press('Escape');
  await expect(page.locator('.map-connect-status')).toHaveCount(0);
  expect((await readProject(page)).graph.edges).toHaveLength(before);
  await page.getByRole('button',{name:'Resume relationship',exact:true}).click();
  await page.getByRole('button',{name:'Discard relationship',exact:true}).click();

  await resident.click();
  await editSelected(page);
  await page.getByRole('button', { name: 'Connect from Resident', exact: true }).click();
  await page.locator('[data-graph-id="node_e2e_resource_navigator"]').click();
  await editSelected(page);
  const form = page.locator('.add-form');
  await expect(form.getByRole('combobox', { name: 'From', exact: true })).toHaveValue('node_e2e_resident');
  await expect(form.getByRole('combobox', { name: 'To', exact: true })).toHaveValue('node_e2e_resource_navigator');
  await captureSourceRenderedScreenshot(page, testInfo, 'Meso contextual source and target editor');
  await form.getByRole('textbox', { name: 'Relationship', exact: true }).fill('exchanges questions with');
  await form.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('both directions');
  await expect(form.getByRole('textbox', {name:'Evidence or question'})).toHaveCount(0);
  await form.getByRole('button', { name: 'Add relationship', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).graph.edges.length).toBe(before + 1);
  const added = (await readProject(page)).graph.edges.find(edge => edge.verb === 'exchanges questions with');
  expect(added.scale).toBe('meso');
  expect(added.relationshipProcess.direction).toBe('both directions');
  await showMap(page);
  const line = page.locator(`[data-graph-id="${added.id}"] .edge-line`);
  await expect(line).toHaveAttribute('marker-start', 'url(#arrowhead)');
  await expect(line).toHaveAttribute('marker-end', 'url(#arrowhead)');
  await page.locator(`[data-graph-id="${added.id}"]`).press('Enter');
  await editSelected(page);
  const relationshipEditor = page.locator('.map-text-editor').filter({ has: page.getByRole('textbox', { name: 'Relationship', exact: true }) });
  await relationshipEditor.getByRole('textbox', { name: 'Relationship', exact: true }).fill('shares questions with');
  await relationshipEditor.getByRole('textbox', { name: 'Relationship', exact: true }).press('Tab');
  expect((await readProject(page)).graph.edges.find(edge => edge.id === added.id).verb).toBe('exchanges questions with');
  await relationshipEditor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await readProject(page)).graph.edges.find(edge => edge.id === added.id).verb).toBe('shares questions with');
  await page.getByRole('combobox', { name: 'Arrow direction', exact: true }).selectOption('not yet known');
  await expect(page.locator('.item-editor-title em')).toContainText('direction not yet known');
  await expect(line).not.toHaveAttribute('marker-start');
  await expect(line).not.toHaveAttribute('marker-end');
  await page.getByRole('combobox', { name: 'Arrow direction', exact: true }).selectOption('target to source');
  await expect(page.locator('.item-editor-title em')).toHaveText('Resource navigator shares questions with Resident');
  await showMap(page);
  await expect(line).toHaveAttribute('marker-start', 'url(#arrowhead)');
  await expect(line).not.toHaveAttribute('marker-end');
  await page.locator(`[data-graph-id="${added.id}"]`).press('Enter');
  await editSelected(page);
  await page.getByRole('combobox', { name: 'Arrow direction', exact: true }).selectOption('both directions');
  await showMap(page);
  const fullMap = page.getByRole('button', { name: 'Show full map', exact: true });
  if (await fullMap.count()) await fullMap.click();
  await expect(line).toHaveAttribute('marker-start', 'url(#arrowhead)');
  await expect(line).toHaveAttribute('marker-end', 'url(#arrowhead)');
  const labelCollisions = await page.locator('.graph-canvas').evaluate(svg => {
    const cards = [...svg.querySelectorAll('.node-card')].map(card => ({
      id: card.closest('[data-graph-id]').dataset.graphId,
      bounds: card.getBoundingClientRect(),
    }));
    return [...svg.querySelectorAll('.graph-edge-label')].flatMap(label => {
      const bounds = label.querySelector('.edge-label-bg').getBoundingClientRect();
      return cards.filter(card => bounds.left < card.bounds.right && bounds.right > card.bounds.left
        && bounds.top < card.bounds.bottom && bounds.bottom > card.bounds.top)
        .map(card => ({ edge: label.dataset.edgeId, node: card.id }));
    });
  });
  expect(labelCollisions, 'Every visible relationship label must clear every node card').toEqual([]);
  await expectSharedMicroCircle(page);
  await captureSourceRenderedScreenshot(page, testInfo, 'Meso connections');
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Meso direct connection'));

  const linkedPositions=await positions(page);
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('micro');
  await showMap(page);
  await expect(page.locator('.graph-edge')).toHaveCount(0);
  expect(await positions(page)).toEqual(linkedPositions);
  await page.getByRole('combobox', { name: 'Work level' }).selectOption('meso');
  expect((await readProject(page)).graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(savedPositions);
  await page.reload();
  await page.getByRole('article', { name: fixture.title }).getByRole('button', { name: 'Open project' }).click();
  expect((await readProject(page)).graph.edges.find(edge => edge.id === added.id)).toMatchObject({ verb: 'shares questions with', relationshipProcess: { direction: 'both directions' } });
  expect((await readProject(page)).graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(savedPositions);
  await projectMenu(page, 'Export & share');
  await page.locator('.export-dropdown > summary').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /^JSON/ }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.graph.edges.find(edge => edge.id === added.id).relationshipProcess.direction).toBe('both directions');
  expect(errors).toEqual([]);
});

test('Meso stays usable after guidance fails and compact editing preserves legacy metadata', async ({page,makeAxeBuilder},testInfo)=>{
  test.setTimeout(60000);
  const fixture=buildEastHarlemDisabilityProject();fixture.activeScale='meso';fixture.stage=1;fixture.levelProgress.meso={stage:1,reflection:''};fixture.preflight=null;fixture.candidates={nodes:[],edges:[]};
  const legacyEdge=structuredClone(fixture.graph.edges[0]);
  legacyEdge.relationshipProcess={direction:'target to source',strength:'contested',connectionStatus:'missing',familyCount:34,channel:'Paper form',connectingWork:'Parent'};
  fixture.graph.edges=[legacyEdge];const originalPositions=fixture.graph.nodes.map(({id,x,y})=>({id,x,y}));
  let calls=0;
  await page.route('**/api/preflight/evaluations',route=>{calls++;return route.fulfill({status:503,json:{error:'Synthetic guidance unavailable.',details:{code:'provider_unavailable'}}});});
  await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,value);},{key:STORAGE_KEY,value:JSON.stringify(fixture)});
  await page.goto('/');await page.getByRole('textbox',{name:'Class code'}).fill('101');await page.getByRole('button',{name:'Continue',exact:true}).click();
  const open=()=>page.getByRole('article',{name:fixture.title}).getByRole('button',{name:'Open project'}).click();await open();
  await page.getByRole('button',{name:'Generate guidance',exact:true}).click();await expect(page.locator('.suggestions-review [role="alert"]')).toBeVisible();await showMap(page);
  for(const [label,type] of [['School office','setting'],['Assistant principal','person']]){
    await mapCommand(page,'Add item');const form=page.locator('.add-form');
    await form.getByRole('textbox',{name:'Label',exact:true}).fill(label);await form.getByRole('combobox',{name:'Type',exact:true}).selectOption(type);
    await expect(form.getByRole('combobox',{name:'Level',exact:true})).toHaveValue('micro');
    await form.getByRole('textbox',{name:'Evidence or question'}).fill(`${label} is named in this synthetic classroom account.`);
    await form.getByRole('button',{name:'Add node',exact:true}).click();await expect.poll(async()=>(await readProject(page)).graph.nodes.some(node=>node.label===label)).toBe(true);
  }
  const added=(await readProject(page)).graph.nodes,principal=added.find(node=>node.label==='Assistant principal'),office=added.find(node=>node.label==='School office');
  expect(added.filter(node=>originalPositions.some(prior=>prior.id===node.id)).map(({id,x,y})=>({id,x,y}))).toEqual(originalPositions);
  await page.getByRole('button',{name:'Connect from Assistant principal',exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.locator(`[data-graph-id="${office.id}"]`).press('Enter');await editSelected(page);
  const form=page.locator('.add-form');await expect(form.locator('input,select,textarea')).toHaveCount(4);
  await form.getByRole('textbox',{name:'Relationship',exact:true}).fill('requests support from');
  await form.getByRole('combobox',{name:'Direction',exact:true}).selectOption('target to source');await form.getByRole('button',{name:'Add relationship',exact:true}).click();
  await expect.poll(async()=>(await readProject(page)).graph.edges.length).toBe(2);
  const edge=(await readProject(page)).graph.edges.find(edge=>edge.id!==legacyEdge.id);
  expect(edge).toMatchObject({source:principal.id,target:office.id,scale:'meso',relationshipProcess:{direction:'target to source'}});
  await showMap(page);await page.locator(`[data-graph-id="${legacyEdge.id}"]`).press('Enter');await editSelected(page);
  const inspector=page.getByRole('complementary',{name:'Notebook'});
  await expect(inspector.locator('.inspector__scroll').locator('input:visible,select:visible,textarea:visible')).toHaveCount(3);
  await expect(inspector.getByText('Connection details',{exact:true})).toHaveCount(0);
  await inspector.getByRole('textbox',{name:'Relationship',exact:true}).fill('supports appointment planning for');await inspector.getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(async()=>(await readProject(page)).graph.edges.find(edge=>edge.id===legacyEdge.id).verb).toBe('supports appointment planning for');
  expect((await readProject(page)).graph.edges.find(edge=>edge.id===legacyEdge.id).relationshipProcess).toEqual(legacyEdge.relationshipProcess);
  await captureSourceRenderedScreenshot(page,testInfo,'Compact Meso editing preserves earlier metadata');
  assertNoAccessibilityViolations(await scanAccessibility(page,makeAxeBuilder,testInfo,'Manual Meso repair'));
  await showMap(page);await page.reload();await open();
  expect((await readProject(page)).graph.edges.find(edge=>edge.id===legacyEdge.id)).toEqual({...legacyEdge,verb:'supports appointment planning for'});
  expect((await readProject(page)).graph.edges.find(item=>item.id===edge.id)).toEqual(edge);
  expect(calls).toBe(1);
  await showMap(page);await openTools(page);await page.locator('.map-search > summary').click();
  await page.getByRole('searchbox',{name:'Find map item'}).fill('Assistant principal');await page.getByRole('button',{name:'Assistant principal Micro-level',exact:true}).click();await editSelected(page);
  await expect(inspector.getByRole('textbox',{name:'Label',exact:true})).toHaveValue('Assistant principal');
});
