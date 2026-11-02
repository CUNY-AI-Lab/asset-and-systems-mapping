import { test, expect, captureSourceRenderedScreenshot, scanAccessibility, assertNoAccessibilityViolations } from './support/test.js';
import { buildEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { showMap } from './support/notebook.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';
test('legacy scope memberships have traceable, synchronized graph/list links without becoming edges', async ({page,makeAxeBuilder},testInfo)=>{
 const p=buildEastHarlemDisabilityProject();p.activeScale='macrosphere';p.stage=3;
 const owner=p.graph.nodes.find(n=>n.scale==='macrosphere');owner.label='Historic public housing underinvestment';
 const original=structuredClone(p.graph), edgeCount=p.graph.edges.length;
 await page.addInitScript(({key,value})=>localStorage.setItem(key,value),{key:STORAGE_KEY,value:JSON.stringify(p)});
 await page.goto('/');await page.getByRole('textbox',{name:'Class code'}).fill('101');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('article',{name:p.title}).getByRole('button',{name:'Open project'}).click();await showMap(page);
 const node=page.locator(`[data-graph-id="${owner.id}"]`);await node.focus();await node.press('Enter');
 await expect(page.locator('.scope-influence')).toHaveCount(owner.scopeNodeIds.length);
 for(const id of owner.scopeNodeIds){const trace=page.locator(`[data-scope-source="${owner.id}"][data-scope-target="${id}"]`);await expect(trace).toBeVisible();await expect(trace).toHaveAttribute('aria-label',/Scope membership, not a direct relationship/);await expect(trace.locator('.scope-influence-line')).toHaveAttribute('stroke-dasharray','8 4 2 4');await expect(trace.locator('.scope-influence-line')).not.toHaveAttribute('marker-end');expect(await trace.locator('.scope-influence-line').getAttribute('d')).toMatch(/^M.*L/);}
 await expect(page.locator('.graph-edge')).toHaveCount(edgeCount);
 await captureSourceRenderedScreenshot(page,testInfo,'Stored Macro scopes traced to their local endpoints');
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('.map-connections > summary').click();
 const target=p.graph.nodes.find(n=>n.id===owner.scopeNodeIds[0]);
 const list=page.locator('.map-connections');const button=list.getByRole('button',{name:new RegExp(target.label)});await button.click();
 const selected=page.locator(`[data-scope-source="${owner.id}"][data-scope-target="${target.id}"]`);await expect(selected).toHaveAttribute('aria-pressed','true');await expect(button).toHaveAttribute('aria-pressed','true');
 const otherId=owner.scopeNodeIds[1];const other=page.locator(`[data-scope-source="${owner.id}"][data-scope-target="${otherId}"]`);await other.focus();await other.press('Enter');await expect(other).toHaveAttribute('aria-pressed','true');await expect(button).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).graph,STORAGE_KEY)).toEqual(original);
 assertNoAccessibilityViolations(await scanAccessibility(page,makeAxeBuilder,testInfo,'Scoped influence selection'));
 await captureSourceRenderedScreenshot(page,testInfo,'Scope list and graph share the selected endpoint');
});
