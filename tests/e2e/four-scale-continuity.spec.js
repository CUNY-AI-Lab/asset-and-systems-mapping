import { readFile } from 'node:fs/promises';
import { parseProject } from '../../src/domain.js';
import { test, expect, captureSourceRenderedScreenshot, scanAccessibility, assertNoAccessibilityViolations } from './support/test.js';
import { buildEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { mapCommand, showMap, notebookSection } from './support/notebook.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';
const read = page => page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE_KEY);
test('the four exercises keep earlier work visible and build larger and cross-scale links through failure and reload', async ({page,makeAxeBuilder},testInfo)=>{
 test.setTimeout(90000);
 const p=buildEastHarlemDisabilityProject();p.activeScale='micro';p.stage=3;p.furthestStage=4;p.preflight=null;
 p.graph.nodes=p.graph.nodes.filter(n=>n.scale==='micro');p.graph.edges=p.graph.edges.filter(e=>e.scale==='meso');p.candidates={nodes:[],edges:[]};
 const [home,center]=p.graph.nodes;
 p.graph.edges.push({...structuredClone(p.graph.edges[0]),id:'legacy-micro-link',source:home.id,target:center.id,sourceLabel:home.label,targetLabel:center.label,scale:'micro',verb:'coordinates with',claimState:'inference',evidence:'Synthetic earlier relationship awaiting verification.',annotation:{id:'legacy-micro-link-annotation',text:'Keep this earlier relationship.'}});
 p.instructor.evidenceRequired=false;
 const notes={micro:'Residents rely on schools, housing staff and local services.',meso:'Teachers and residents need a clearer way to coordinate appointments.',exosphere:'Funding decisions connect the housing authority to local maintenance.',macrosphere:'The policy affects local repairs; its impact still needs evidence.'};
 for(const scale of p.releasedScales) p.levelProgress[scale]={stage:3,reflection:notes[scale]};
 p.reflection=p.levelProgress.micro.reflection;
 p.graph.nodes[0].annotations.analytical.text='Preserve this manual interpretation.';
 const original=structuredClone(p.graph);let attempts=0;
 await page.route('**/api/preflight/evaluations',route=>{attempts++;return route.fulfill({status:503,json:{error:'Synthetic guidance unavailable.',details:{code:'provider_unavailable'}}});});
 await page.addInitScript(({key,value})=>{if(!localStorage.getItem('four-scale-seeded')){localStorage.setItem(key,value);localStorage.setItem('four-scale-seeded','1');}},{key:STORAGE_KEY,value:JSON.stringify(p)});
 await page.goto('/');await page.getByRole('textbox',{name:'Class code'}).fill('101');await page.getByRole('button',{name:'Continue',exact:true}).click();
 const open=()=>page.getByRole('article',{name:p.title}).getByRole('button',{name:'Open project'}).click();await open();
 await showMap(page);await expect(page.locator('.graph-node')).toHaveCount(6);await expect(page.locator('.graph-edge')).toHaveCount(0);
 await page.getByRole('combobox',{name:'Work level'}).selectOption('meso');await showMap(page);await expect(page.locator('.graph-node')).toHaveCount(6);await expect(page.locator('.graph-edge')).toHaveCount(original.edges.length);
 await page.getByRole('combobox',{name:'Work level'}).selectOption('exosphere');await showMap(page);await expect(page.locator('.graph-node')).toHaveCount(6);await expect(page.locator('.graph-edge')).toHaveCount(original.edges.length);
 await notebookSection(page,'suggestions');await page.getByRole('button',{name:'Generate guidance',exact:true}).click();await expect(page.locator('.suggestions-review [role="alert"]')).toBeVisible();await showMap(page);
 expect(attempts).toBe(1);expect((await read(page)).graph).toEqual(original);
 for(const [label,type] of [['City Housing Authority','agency'],['Public housing funding policy','policy']]){
  await mapCommand(page,'Add item');const form=page.locator('.add-form');await form.getByRole('textbox',{name:'Label',exact:true}).fill(label);await form.getByRole('combobox',{name:'Type',exact:true}).selectOption(type);await form.getByRole('button',{name:'Add node',exact:true}).click();await expect.poll(async()=>(await read(page)).graph.nodes.some(n=>n.label===label)).toBe(true);await showMap(page);
 }
 await expect(page.locator('.graph-node')).toHaveCount(8);await expect(page.locator('.graph-edge')).toHaveCount(original.edges.length);
 const exo=await read(page);const authority=exo.graph.nodes.find(n=>n.label==='City Housing Authority'),policy=exo.graph.nodes.find(n=>n.label==='Public housing funding policy');
 for(const node of original.nodes)expect(exo.graph.nodes.find(n=>n.id===node.id)).toEqual(node);
 await captureSourceRenderedScreenshot(page,testInfo,'Exo adds larger nodes to the existing local map');
 await page.getByRole('combobox',{name:'Work level'}).selectOption('macrosphere');await showMap(page);await expect(page.locator('.graph-node')).toHaveCount(8);
 async function begin(from,to){const node=page.locator(`[data-graph-id="${from}"]`);await node.focus();await node.press('Enter');await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('button',{name:/^Connect from /}).click();const target=page.locator(`[data-graph-id="${to}"]`);await target.focus();await target.press('Enter');await page.getByRole('button',{name:'Edit',exact:true}).click();}
 await begin(authority.id,policy.id);const form=page.locator('.add-form');await form.getByRole('textbox',{name:'Relationship',exact:true}).fill('administers');await form.getByRole('combobox',{name:'Direction',exact:true}).selectOption('source to target');await form.getByRole('button',{name:'Add relationship',exact:true}).click();await showMap(page);
 await begin(policy.id,original.nodes[0].id);await form.getByRole('combobox',{name:'Direction',exact:true}).selectOption('varies');await form.getByRole('button',{name:'Close',exact:true}).click();
 await page.reload();await open();await showMap(page);await expect(page.locator('.graph-node')).toHaveCount(8);await expect(page.locator('.relationship-draft-preview')).toBeVisible();await page.getByRole('button',{name:'Resume relationship',exact:true}).click();await expect(form.getByRole('textbox',{name:'Relationship',exact:true})).toHaveValue('');await form.getByRole('button',{name:'Add relationship',exact:true}).click();await showMap(page);
 await expect(page.locator('.graph-edge')).toHaveCount(original.edges.length+2);await expect.poll(async()=>(await read(page)).graph.edges.filter(e=>e.scale==='macrosphere').length).toBe(2);const complete=await read(page);
 expect(complete.graph.edges.filter(e=>e.scale==='macrosphere')).toHaveLength(2);expect(complete.graph.edges.find(e=>e.source===policy.id&&e.target===original.nodes[0].id).verb).toBe('');
 for(const scale of ['micro','meso','exosphere','macrosphere']){await page.getByRole('combobox',{name:'Work level'}).selectOption(scale);await showMap(page);await expect(page.locator('.graph-node')).toHaveCount(['micro','meso'].includes(scale)?6:8);expect((await read(page)).graph).toEqual(complete.graph);expect((await read(page)).levelProgress[scale].reflection).toBe(p.levelProgress[scale].reflection);}
 await page.reload();await open();await showMap(page);await expect(page.locator('.graph-node')).toHaveCount(8);await expect(page.locator('.graph-edge')).toHaveCount(original.edges.length+2);
 for(const node of original.nodes)expect((await read(page)).graph.nodes.find(n=>n.id===node.id)).toEqual(node);
 assertNoAccessibilityViolations(await scanAccessibility(page,makeAxeBuilder,testInfo,'Cumulative Macro map'));
 await captureSourceRenderedScreenshot(page,testInfo,'Macro connects larger and local nodes without losing earlier work');
 await notebookSection(page,'review');
 await page.getByRole('button',{name:'Complete Macro-level',exact:true}).click();
 await expect(page.getByRole('heading',{name:p.title,exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Micro-level summary'})).toContainText('6 nodes · 1 relationship');
 await expect.poll(async()=>{
  const title=await page.getByRole('heading',{name:p.title,exact:true}).boundingBox();
  const header=await page.locator('.app-header').boundingBox();
  return title.y >= header.y+header.height;
 }).toBe(true);
 await captureSourceRenderedScreenshot(page,testInfo,'Completion synthesizes saved work with cumulative exports');
 expect((await read(page)).graph).toEqual(complete.graph);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Private backup',exact:true}).click();const backup=await pending;
 const exported=parseProject(await readFile(await backup.path(),'utf8'));
 expect(exported.graph).toEqual(complete.graph);
 for(const scale of p.releasedScales)expect(exported.levelProgress[scale].reflection).toBe(p.levelProgress[scale].reflection);
 const originalToBlob=await page.evaluate(()=>{window.__completionToBlob=HTMLCanvasElement.prototype.toBlob;return true;});expect(originalToBlob).toBe(true);
 await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);};});
 await page.getByRole('button',{name:'PNG',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect((await read(page)).graph).toEqual(complete.graph);
 await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=window.__completionToBlob;delete window.__completionToBlob;});
 for(const format of ['PNG','PDF']){const next=page.waitForEvent('download');await page.getByRole('button',{name:format,exact:true}).click();const file=await next;expect((await readFile(await file.path())).length).toBeGreaterThan(1000);}
 assertNoAccessibilityViolations(await scanAccessibility(page,makeAxeBuilder,testInfo,'Completion and exports'));
 await page.getByRole('button',{name:'Return to map',exact:true}).scrollIntoViewIfNeeded();
 const formatButtons=await page.locator('.completion-format-actions button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};}));
 expect(formatButtons).toHaveLength(4);
 for(const button of formatButtons){expect(button.height).toBeGreaterThanOrEqual(44);expect(Math.abs(button.height-formatButtons[0].height)).toBeLessThan(1);expect(Math.abs(button.width-formatButtons[0].width)).toBeLessThan(1);}
 const phone=testInfo.project.name==='chromium-phone';
 expect(Math.abs(formatButtons[0].y-formatButtons[1].y)).toBeLessThan(1);
 if(phone){expect(formatButtons[2].y).toBeGreaterThan(formatButtons[0].bottom);expect(formatButtons[2].x).toBe(formatButtons[0].x);}
 else for(const button of formatButtons)expect(Math.abs(button.y-formatButtons[0].y)).toBeLessThan(1);
 const returnButton=await page.getByRole('button',{name:'Return to map',exact:true}).boundingBox();
 expect(returnButton.y).toBeGreaterThan(Math.max(...formatButtons.map(button=>button.bottom)));
 const formatGroup=await page.locator('.completion-format-actions').boundingBox();
 expect(Math.abs(returnButton.width-(phone?formatGroup.width:formatButtons[0].width))).toBeLessThan(1);
 await expect(page.getByRole('heading',{name:'Project complete',exact:true})).toHaveCount(0);
 await captureSourceRenderedScreenshot(page,testInfo,'Completion export controls and return to map');
 await page.getByRole('button',{name:'Return to map',exact:true}).click();await expect(page.locator('.graph-node')).toHaveCount(8);
 await notebookSection(page,'review');await page.getByRole('button',{name:'View summary',exact:true}).click();await expect(page.getByRole('heading',{name:p.title,exact:true})).toBeVisible();
 const completed=await read(page);expect(completed.events.filter(event=>event.action==='scale.cycle-completed'&&event.detail==='Macro-level completed')).toHaveLength(1);
 await page.reload();await open();await expect(page.getByRole('heading',{name:p.title,exact:true})).toBeVisible();expect((await read(page)).graph).toEqual(complete.graph);

});
