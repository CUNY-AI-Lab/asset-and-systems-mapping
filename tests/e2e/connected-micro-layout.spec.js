import { test, expect, captureSourceRenderedScreenshot } from './support/test.js';
import { connectedMicroProject } from './fixtures/connected-micro-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';
import { showMap, mapCommand } from './support/notebook.js';

// Relationships never reorder the cluster on their own; the hub layout is an
// explicit Arrange, after which manual placement is kept across reload.
test('busy Micro map centers its participant and separates unconnected items, with saved manual placement',async({page},testInfo)=>{
  const project=connectedMicroProject();
  await page.addInitScript(({key,project})=>{if(!localStorage.getItem('micro-layout-seeded')){localStorage.setItem(key,JSON.stringify(project));localStorage.setItem('micro-layout-seeded','1');}},{key:STORAGE_KEY,project});
  await page.goto('/');
  await page.getByRole('textbox',{name:'Class code'}).fill('101');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const open=()=>page.getByRole('article',{name:project.title}).getByRole('button',{name:'Open project'}).click();
  await open();await showMap(page);
  await expect(page.locator('.graph-node')).toHaveCount(12);
  const positions=()=>page.locator('.graph-node').evaluateAll(elements=>Object.fromEntries(elements.map(el=>[el.dataset.graphId,el.getAttribute('transform')])));
  const initial=await positions();
  await mapCommand(page,'Arrange map');
  await expect.poll(positions).not.toEqual(initial);
  const boxes=await page.locator('.graph-node .node-card').evaluateAll(elements=>elements.map(el=>{const b=el.getBoundingClientRect();return {id:el.closest('.graph-node').dataset.graphId,left:b.left,right:b.right,top:b.top,bottom:b.bottom};}));
  expect(boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top))).toBe(false);
  const core=boxes.filter(b=>Number(b.id.split('-')[1])<8),isolated=boxes.filter(b=>Number(b.id.split('-')[1])>=8);
  expect(isolated.every(b=>b.left>Math.max(...core.map(b=>b.right)))||isolated.every(b=>b.top>Math.max(...core.map(b=>b.bottom)))).toBe(true);
  await captureSourceRenderedScreenshot(page,testInfo,'Connected Micro map with a central participant and grouped isolated nodes');
  const hub=page.locator('[data-graph-id="micro-0"]');await hub.focus();await hub.press('Shift+ArrowLeft');
  await expect.poll(async()=>(await positions())['micro-0']).not.toBe(initial['micro-0']);
  const moved=await positions();
  await page.reload();await open();await showMap(page);
  expect(await positions()).toEqual(moved);
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE_KEY);
  expect(saved.graph.edges).toEqual(project.graph.edges);
});
