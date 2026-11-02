import { test, expect, captureSourceRenderedScreenshot } from './support/test.js';
import { denseCumulativeProject } from './fixtures/readable-cumulative-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';
import { mapCommand, showMap } from './support/notebook.js';

const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const positions = page => page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.graphId, node.getAttribute('transform')])));
const view = page => page.locator('.viewport-layer').getAttribute('transform');

test('dense cumulative arrangement stays straight and visible, and intentional placement survives undo and reload', async ({page},testInfo) => {
  test.setTimeout(90000);
  const project=denseCumulativeProject(),before=structuredClone(project.graph);
  let paidRequests=0;
  await page.route('**/api/preflight/evaluations',route=>{paidRequests++;return route.abort();});
  await page.addInitScript(({key,value})=>{if(!localStorage.getItem('dense-seeded')){localStorage.setItem(key,value);localStorage.setItem('dense-seeded','1');}}, {key:STORAGE_KEY,value:JSON.stringify(project)});
  await page.goto('/');
  await page.getByRole('textbox',{name:'Class code'}).fill('101');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const open=()=>page.getByRole('article',{name:project.title}).getByRole('button',{name:'Open project'}).click();
  await open();await showMap(page);
  const nodes=page.locator('.graph-node'),edges=page.locator('.graph-edge');
  await expect(nodes).toHaveCount(16);await expect(edges).toHaveCount(project.graph.edges.length);
  const nav=page.getByRole('navigation',{name:'Workspace',exact:true}),container=page.locator('.map-stage');
  const navBox=await nav.boundingBox(),containerBox=await container.boundingBox();
  expect(navBox.x-containerBox.x).toBeLessThan(24);expect(navBox.y-containerBox.y).toBeLessThan(24);
  for(const layer of ['exosphere','macrosphere']) {
    await page.getByRole('combobox',{name:'Work level'}).selectOption(layer);await showMap(page);
    await mapCommand(page,'Fit map');
    await expect(nodes).toHaveCount(16);
    const quality=await page.locator('.graph-canvas').evaluate(svg=>{
      const cards=[...svg.querySelectorAll('.graph-node .node-card')].map(card=>card.getBoundingClientRect());
      let overlaps=0;
      for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++)if(cards[i].left<cards[j].right&&cards[i].right>cards[j].left&&cards[i].top<cards[j].bottom&&cards[i].bottom>cards[j].top)overlaps++;
      return {overlaps,opacities:[...svg.querySelectorAll('.graph-node,.graph-edge,.graph-edge-label')].map(node=>getComputedStyle(node).opacity),fills:[...svg.querySelectorAll('.ecology-layer>ellipse')].map(node=>getComputedStyle(node).fill),paths:[...svg.querySelectorAll('.edge-line')].map(node=>node.getAttribute('d'))};
    });
    expect(quality.overlaps).toBe(0);expect(new Set(quality.opacities)).toEqual(new Set(['1']));expect(new Set(quality.fills)).toEqual(new Set(['none']));
    for(const path of quality.paths)expect(path).toMatch(/^M -?[\d.]+ -?[\d.]+ L -?[\d.]+ -?[\d.]+$/);
    expect((await saved(page)).graph).toEqual(before);
    await captureSourceRenderedScreenshot(page,testInfo,`Dense ${layer==='exosphere'?'Exo':'Macro'} full map with straight connections`);
  }
  await mapCommand(page,'Arrange map');const arranged=await positions(page);
  await mapCommand(page,'Arrange map');expect(await positions(page)).toEqual(arranged);
  const node=nodes.first(),id=await node.getAttribute('data-graph-id');
  await node.focus();await node.press('Shift+ArrowLeft');
  await expect.poll(async()=>(await positions(page))[id]).not.toBe(arranged[id]);
  const moved=await positions(page);
  for(const [nodeId,position] of Object.entries(arranged))if(nodeId!==id)expect(moved[nodeId]).toBe(position);
  await expect.poll(async()=>(await saved(page)).layout?.manualNodeIds?.includes(id) || false).toBe(true);
  await page.locator('.graph-canvas').focus();await page.locator('.graph-canvas').press('ControlOrMeta+z');
  await expect.poll(()=>positions(page)).toEqual(arranged);
  await page.locator('.graph-canvas').press('ControlOrMeta+Shift+z');await expect.poll(()=>positions(page)).toEqual(moved);
  await page.reload();await open();await showMap(page);expect(await positions(page)).toEqual(moved);
  await mapCommand(page,'Fit map');
  const camera=await view(page);
  await nodes.first().focus();await nodes.first().press('Enter');
  await expect(nav.getByRole('button',{name:'Map',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await positions(page)).toEqual(moved);expect(await view(page)).toBe(camera);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  const label=page.getByRole('textbox',{name:'Label',exact:true});
  await label.fill('Apartment building and accessible entrance');await label.blur();
  expect(await positions(page)).toEqual(moved);expect(await view(page)).toBe(camera);
  await showMap(page);await page.reload();await open();await showMap(page);
  expect(await positions(page)).toEqual(moved);
  expect((await saved(page)).graph.edges).toEqual(before.edges);
  expect(paidRequests).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
