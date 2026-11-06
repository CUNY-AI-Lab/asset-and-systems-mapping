import { notebookSection, projectMenu, openTools } from '../tests/e2e/support/notebook.js';
// @vitest-environment node
import { beforeAll, afterAll, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { createDefaultProject, parseProject, serializeProject } from '../src/domain.js';
import { chromium, expect as browserExpect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { serializedEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';
import { DEFAULT_TEACHING_PROFILE } from '../server/config.js';
import { STORAGE_KEY } from '../src/projectLibrary.js';
import { groupProject } from '../tests/fixtures/group-project.js';
import { beginPart2 } from '../src/projectMemo.js';
import { STRONG_MACRO_MEMO } from '../tests/fixtures/two-memo-cases.js';

const ORIGIN = 'https://systems-mapping.ailab-452.workers.dev';
const sessions = Object.fromEntries(['alice', 'bob', 'admin', 'instructor'].map(name => [name, crypto.randomUUID() + '.' + 's'.repeat(43)]));
let harness, worker, services;
const request = (path, who = 'alice', options = {}) => worker.fetch(ORIGIN + path, { redirect: 'manual', ...options, headers: { cookie: `__Host-systems-mapping-session=${sessions[who] || ''}`, origin: ORIGIN, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
const control = value => services.fetch('https://fixtures.test/control', { method: 'POST', body: JSON.stringify(value) });
const newProject = () => { const project = createDefaultProject(); project.id = 'account-map'; project.title = 'Preserved account map'; return project; };
const expectFullMap = async page => {
  await openTools(page);
  await page.getByRole('combobox', { name: 'Show map layer' }).selectOption('all');
  await page.getByRole('navigation',{name:'Workspace',exact:true}).getByRole('button',{name:'Notebook',exact:true}).click();
  // Eight visible nodes share three regions; the ninth legacy Meso record remains saved.
  await browserExpect(page.locator('.graph-node')).toHaveCount(8);
};

beforeAll(async () => {
  const issuer = await createTestIdentityIssuer();
  const tokens = {};
  for (const [name, subject] of [['alice', TEST_SUBJECTS.alice], ['bob', TEST_SUBJECTS.bob], ['admin', 'cail-33333333333333333333333333333333']]) tokens[name] = {
    subject, sessionToken: sessions[name], appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject, ...(name === 'alice' ? { name: 'Sam Student', email:'synthetic-student@example.edu' } : {}) }), gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }),
  };
  harness = createTestHarness({ workers: [{ config: {
    name: 'systems-mapping-test', main: 'cloudflare/worker.ts', compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    vars: { PUBLIC_ORIGIN: ORIGIN, LOGIN_URL: '/auth/start', COURSE_ID: 'test-course', RELEASE: 'test-release', GATEWAY_MODEL: 'glm-5.3-flash', GUIDANCE_CONCURRENCY: '8', CAIL_IDENTITY_JWKS: issuer.jwksJson },
    assets: { directory: './dist-cloudflare', binding: 'ASSETS', run_worker_first: true, not_found_handling: 'single-page-application' },
    durable_objects: { bindings: [{ name: 'COURSES', class_name: 'MappingCourse' }] }, exports: { MappingCourse: { type: 'durable-object', storage: 'sqlite' } },
    services: [{ binding: 'IDENTITY', service: 'systems-fixture', entrypoint: 'Identity' }, { binding: 'ADMISSION_RESOLVER', service: 'systems-fixture', entrypoint: 'Admission' }, { binding: 'GATEWAY', service: 'systems-fixture' }],
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '9876523', simple: { limit: 10000, period: 60 } }],
  } }, { config: { name: 'systems-fixture', main: 'cloudflare/test-services.ts', compatibility_date: '2026-09-08', vars: { TEST_TOKENS: JSON.stringify(tokens) } } }] });
  await harness.listen(); worker = harness.getWorker('systems-mapping-test'); services = harness.getWorker('systems-fixture');
}, 30000);
afterAll(async () => { await harness?.close(); });

test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1')('printed and scalable map downloads preserve the canvas drawing', async () => {
  const fixture = groupProject();
  fixture.id='drawing-browser'; fixture.title='Saved map drawing';
  fixture.layout={...fixture.layout,autoFit:true,manualNodeIds:fixture.graph.nodes.map(n=>n.id),readingAspect:1.8};
  const visible=fixture.graph.nodes.filter(n=>n.status!=='rejected' && n.claimState!=='retired' && n.scale!=='meso');
  const ids=new Set(visible.map(n=>n.id));
  const liveEdges=fixture.graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)&&e.status!=='rejected'&&e.claimState!=='retired');
  expect((await request('/api/cloud/projects/'+fixture.id,'alice',{method:'PUT',body:JSON.stringify({project:serializeProject(fixture),revision:0})})).status).toBe(200);
  const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  try {
    await context.addCookies([{name:'__Host-systems-mapping-session',value:sessions.alice,url:ORIGIN,secure:true,httpOnly:true,sameSite:'Lax'}]);
    await context.route('**/*',async route=>{
      const source=route.request();if(new URL(source.url()).origin!==ORIGIN)return route.abort();
      const response=await worker.fetch(source.url(),{method:source.method(),headers:await source.allHeaders(),body:source.postDataBuffer()??undefined,redirect:'manual'});
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    });
    const page=await context.newPage();
    await page.goto(ORIGIN);
    await page.getByRole('article',{name:fixture.title}).getByRole('button',{name:'Open project'}).click();
    await openTools(page);
    await page.getByRole('combobox',{name:'Show map layer'}).selectOption('all');
    await browserExpect(page.locator('.graph-node')).toHaveCount(visible.length);
    await browserExpect(page.locator('.graph-edge-label')).toHaveCount(liveEdges.length);
    await page.evaluate(()=>document.fonts.ready);
    // Read the live browser's actual drawing and the independently downloaded SVG.
    const geometry=source=>{
      const root=source ? new DOMParser().parseFromString(source,'image/svg+xml').documentElement : document.querySelector('svg.graph-canvas');
      const all=selector=>[...root.querySelectorAll(selector)];
      const ink=(el,name)=>source?el.getAttribute(name):getComputedStyle(el).getPropertyValue(name);
      return {
        cards:all('[data-graph-id][data-full-label]').map(n=>{const r=n.querySelector('rect');return [n.dataset.graphId,n.getAttribute('transform'),r.getAttribute('width'),r.getAttribute('height'),ink(r,'fill'),ink(r,'stroke'),n.querySelector('text').textContent];}).sort(),
        lines:all('[data-graph-id]:not([data-full-label])').map(g=>{const p=g.querySelector('path:last-of-type');return [g.dataset.graphId,p.getAttribute('d'),p.hasAttribute('marker-start'),p.hasAttribute('marker-end'),ink(p,'stroke')];}).sort(),
        labels:all('[data-edge-id]').map(g=>{const r=g.querySelector(':scope > rect');return [g.dataset.edgeId,g.dataset.fullLabel,r?.getAttribute('x'),r?.getAttribute('y'),r?.getAttribute('width')];}).sort(),
        branches:all('path[data-group-member]').map(p=>[p.dataset.groupMember,p.getAttribute('d')]).sort(),
        rings:all('[data-ecology-layer] ellipse').map(r=>['cx','cy','rx','ry'].map(k=>r.getAttribute(k))),
      };
    };
    const before=await page.evaluate(geometry,null);
    await projectMenu(page,'Export & share');
    const dialog=page.getByRole('dialog',{name:'Export & share'});
    const file=async format=>{
      await dialog.getByRole('combobox',{name:'File format'}).selectOption(format);
      const pending=page.waitForEvent('download');
      await dialog.getByRole('button',{name:'Download',exact:true}).click();
      return readFile(await (await pending).path());
    };
    const svg=(await file('svg')).toString();
    expect(await page.evaluate(geometry,svg)).toEqual(before);
    expect(before.cards.length).toBe(visible.length);
    expect(before.branches.length).toBeGreaterThan(1);
    expect(svg).not.toContain(fixture.submission.text);
    expect(svg).toContain('data:font/woff2;base64,');
    const png=await file('png'),pdf=await file('pdf');
    expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(pdf.subarray(0,8).toString()).toBe('%PDF-1.4');
    const image=pdf.toString('latin1').match(/\/Subtype \/Image \/Width (\d+) \/Height (\d+)/);
    expect([+image[1],+image[2]]).toEqual([png.readUInt32BE(16),png.readUInt32BE(20)]);
  } finally {await browser.close();}
},120000);

test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1')('Chrome two-memo workflow keeps separate uploads, student relationships and three nested spheres', async () => {
  await control({mode:'nodes'});
  const project=newProject();project.id='browser-node-workflow';project.title='Two separate memos';
  project.stage=project.furthestStage=0;project.activeScale='micro';project.releasedScales=['micro'];project.completedScales=[];
  project.submission.text='';delete project.submission.fingerprint;project.preflight=null;project.graph={nodes:[],edges:[]};project.candidates={nodes:[],edges:[]};
  expect((await request(`/api/cloud/projects/${project.id}`,'alice',{method:'PUT',body:JSON.stringify({project:serializeProject(project),revision:0})})).status).toBe(200);
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.addCookies([{name:'__Host-systems-mapping-session',value:sessions.alice,url:ORIGIN,secure:true,httpOnly:true,sameSite:'Lax'}]);
  await context.route('**/*',async route=>{
    const source=route.request();if(new URL(source.url()).origin!==ORIGIN)return route.abort();
    const response=await worker.fetch(source.url(),{method:source.method(),headers:await source.allHeaders(),body:source.postDataBuffer()??undefined,redirect:'manual'});
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const stored=async()=>JSON.parse((await(await request(`/api/cloud/projects/${project.id}`)).json()).project);
  const first='Residents meet in the community room.';
  const second='Residents do not participate in City Housing Authority staffing meetings. City Housing Authority allocates repair staff, affecting repair visits to residents at home. Unequal housing investment delays elevator repairs.';
  try {
    await page.goto(ORIGIN);await page.getByRole('article',{name:project.title}).getByRole('button',{name:'Open project'}).click();
    await page.getByLabel('Upload Part 1 memo',{exact:true}).setInputFiles({name:'first.txt',mimeType:'text/plain',buffer:Buffer.from(first)});
    await page.getByRole('button',{name:'Submit memo and add nodes',exact:true}).click();
    await browserExpect(page.locator('.graph-node')).toHaveCount(2);await browserExpect(page.locator('.graph-edge')).toHaveCount(0);
    await browserExpect(page.getByText('Set aside',{exact:true})).toHaveCount(0);
    await page.locator('.graph-node').filter({hasText:'Residents'}).press('Enter');
    // Rendering the returned nodes precedes the debounced account save.
    // Read the baseline only after the server has that same result.
    await browserExpect.poll(async()=>(await stored()).graph.nodes.some(node=>node.label==='Residents')).toBe(true);
    const residentBefore=(await stored()).graph.nodes.find(node=>node.label==='Residents');
    await browserExpect(page.getByRole('button',{name:'Save classification',exact:true})).toHaveCount(0);
    await page.getByRole('combobox',{name:'Type',exact:true}).selectOption('role');
    await page.getByRole('button',{name:'Save classification',exact:true}).click();
    await browserExpect.poll(async()=>(await stored()).graph.nodes.find(node=>node.id===residentBefore.id)?.type).toBe('role');
    const residentAfter=(await stored()).graph.nodes.find(node=>node.id===residentBefore.id);
    expect(residentAfter.evidence).toBe(residentBefore.evidence);
    expect(residentAfter.annotations).toEqual(residentBefore.annotations);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await browserExpect.poll(async()=>(await stored()).graph.nodes.find(node=>node.id===residentBefore.id)?.type).toBe('group');
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    await browserExpect.poll(async()=>(await stored()).graph.nodes.find(node=>node.id===residentBefore.id)?.type).toBe('role');
    await page.getByRole('button',{name:'Remove',exact:true}).click();
    await browserExpect(page.getByRole('button',{name:'Add to map',exact:true})).toBeVisible();
    await browserExpect.poll(async()=>(await stored()).graph.nodes.find(node=>node.id===residentBefore.id)?.claimState).toBe('retired');
    await page.reload();
    await page.getByRole('article',{name:project.title}).getByRole('button',{name:'Open project'}).click();
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await browserExpect(page.locator('.graph-node')).toHaveCount(2);
    await browserExpect.poll(async()=>(await stored()).graph.nodes.find(node=>node.id===residentBefore.id)?.claimState).toBe(residentAfter.claimState);
    await page.locator('.graph-node').filter({hasText:'Residents'}).press('Enter');
    await browserExpect(page.getByRole('heading',{name:'Edit',exact:true})).toHaveCount(0);
    await browserExpect(page.locator('button[aria-label="Hide sidebar"] svg')).toHaveCount(0);
    await browserExpect(page.locator('.inspector-evidence strong')).toHaveText('Residents');
    const hierarchy=await page.locator('#map-inspector').evaluate(panel=>{
      const size=selector=>parseFloat(getComputedStyle(panel.querySelector(selector)).fontSize);
      return {label:size('.field__label'),value:size('select'),caption:size('.inspector-item-state'),title:size('.inspector-item-heading h2'),
        actionWidth:panel.querySelector('.notebook-next').getBoundingClientRect().width,panelWidth:panel.getBoundingClientRect().width};
    });
    expect(hierarchy.label).toBeLessThan(hierarchy.value);
    expect(hierarchy.caption).toBeLessThan(hierarchy.title);
    expect(hierarchy.actionWidth).toBeLessThan(hierarchy.panelWidth*.65);
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await browserExpect(page.getByRole('heading',{name:'Micro · local nodes',exact:true})).toBeVisible();
    await browserExpect(page.getByRole('button',{name:'Continue',exact:true})).toBeInViewport();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await browserExpect(page.getByRole('heading',{name:'Micro · local nodes',exact:true})).toBeVisible();
    await browserExpect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.locator('.graph-node').filter({hasText:'Residents'}).press('Enter');
    await page.getByRole('button',{name:'Connect from Residents',exact:true}).click();
    await browserExpect(page.getByRole('button',{name:'Continue',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await browserExpect(page.getByRole('button',{name:'Resume relationship',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Connect from Residents',exact:true}).click();
    const relationshipTarget = page.locator('.graph-node').filter({hasText:'Community room'});
    await relationshipTarget.focus();
    // A deferred source-focus callback must not steal the target's next key.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await browserExpect(relationshipTarget).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('textbox',{name:'Relationship',exact:true}).fill('meet in');
    await page.getByRole('button',{name:'Add relationship',exact:true}).click();
    await browserExpect(page.locator('.graph-edge')).toHaveCount(1);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await browserExpect(page.getByRole('textbox',{name:'Second memo',exact:true})).toHaveValue('');
    await browserExpect(page.locator('.memo-workspace')).not.toContainText('first.txt');
    await page.getByLabel('Upload Part 2 memo',{exact:true}).setInputFiles({name:'second.txt',mimeType:'text/plain',buffer:Buffer.from(second)});
    await page.getByRole('button',{name:'Submit memo and add nodes',exact:true}).click();
    await browserExpect(page.locator('.graph-node')).toHaveCount(4);await browserExpect(page.locator('.graph-edge')).toHaveCount(1);
    await browserExpect(page.locator('.ecology-layers [data-ecology-layer]')).toHaveCount(3);
    await page.locator('.graph-node').filter({hasText:'City Housing Authority'}).press('Enter');
    await page.getByRole('button',{name:'Connect from City Housing Authority',exact:true}).click();
    await page.getByRole('group',{name:'Local relationships',exact:true}).getByRole('checkbox').check();
    await page.getByRole('textbox',{name:'Relationship',exact:true}).fill('allocates staff for');
    await page.getByRole('textbox',{name:'Evidence or question',exact:true}).fill('A student interpretation of the second memo.');
    await page.getByRole('button',{name:'Add relationship',exact:true}).click();
    await browserExpect(page.locator('.graph-edge')).toHaveCount(2);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await browserExpect(page.getByRole('heading',{name:'Macro · broader conditions'})).toBeVisible();
    expect((await(await services.fetch('https://fixtures.test/control')).json()).calls).toBe(2);
    await browserExpect.poll(async()=> (await stored()).graph.edges.length).toBe(2);
    const before=await stored();expect(before.submission.text).toBe(first);expect(before.part2Submission.text).toBe(second);
    expect(before.graph.edges[1].relationshipIds).toEqual([before.graph.edges[0].id]);
    await page.getByRole('button',{name:'Hide sidebar',exact:true}).click();await browserExpect(page.getByRole('complementary',{name:'Notebook'})).toHaveCount(0);
    await page.getByRole('button',{name:'Notebook',exact:true}).click();
    const resizer=page.getByRole('separator',{name:'Resize sidebar',exact:true});
    for(const viewportWidth of [1024,1440]) {
      await page.setViewportSize({width:viewportWidth,height:1000});
      await browserExpect(resizer).toBeVisible();
      const width=Number(await resizer.getAttribute('aria-valuenow'));await resizer.press('ArrowLeft');await browserExpect(resizer).toHaveAttribute('aria-valuenow',String(width+16));
    }
    await page.getByRole('button',{name:'Tools',exact:true}).click();await browserExpect(page.locator('#map-inspector .notebook-tools-inline')).toBeVisible();await browserExpect(page.locator('.notebook-tools-panel')).toHaveCount(0);
    await browserExpect(page.getByRole('checkbox',{name:'Auto-fit layout'})).toBeChecked();
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:'/tmp/systems-three-spheres-desktop.png'});
    await page.reload();await page.getByRole('article',{name:project.title}).getByRole('button',{name:'Open project'}).click();
    await browserExpect(page.locator('.graph-node')).toHaveCount(4);expect((await stored()).graph).toEqual(before.graph);
    await browserExpect(page.getByRole('complementary',{name:'Notebook'})).toBeVisible();
    for(const width of [390,320]){await page.setViewportSize({width,height:844});await browserExpect(page.locator('.graph-node')).toHaveCount(4);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await browserExpect(page.getByRole('button',{name:'Finish map',exact:true})).toBeInViewport();}
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:'/tmp/systems-three-spheres-phone.png'});expect(errors).toEqual([]);
  } finally {await context.unrouteAll({behavior:'wait'});await browser.close();await control({mode:'success'});}
},60000);

test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1')('Chrome reopens a saved legacy review without resubmission', async () => {
  const project = JSON.parse(serializedEastHarlemDisabilityProject());
  project.id='legacy-review-notebook';project.title='Legacy mapped review';project.activeScale='micro';project.stage=2;
  expect((await request(`/api/cloud/projects/${project.id}`,'alice',{method:'PUT',body:JSON.stringify({project:serializeProject(project),revision:0})})).status).toBe(200);
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1024,height:900}});
  await context.addCookies([{name:'__Host-systems-mapping-session',value:sessions.alice,url:ORIGIN,secure:true,httpOnly:true,sameSite:'Lax'}]);
  await context.route('**/*',async route=>{
    const source=route.request();if(new URL(source.url()).origin!==ORIGIN)return route.abort();
    const response=await worker.fetch(source.url(),{method:source.method(),headers:await source.allHeaders(),body:source.postDataBuffer()??undefined,redirect:'manual'});
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  const page=await context.newPage();
  try {
    for(let reopen=0;reopen<2;reopen++){
      await page.goto(ORIGIN);await page.getByRole('article',{name:project.title}).getByRole('button',{name:'Open project'}).click();
      await browserExpect(page.getByRole('heading',{name:'Micro · local nodes',exact:true})).toBeVisible();
      await browserExpect(page.getByRole('button',{name:'Submit memo and add nodes',exact:true})).toHaveCount(0);
      await browserExpect(page.getByRole('button',{name:'Continue',exact:true})).toBeInViewport();
    }
    // Opening Memo is a view change and must not request another model read.
    const renderedBefore=await page.locator('.graph-node').count();
    const callsBefore=(await(await services.fetch('https://fixtures.test/control')).json()).calls;
    await page.getByRole('button',{name:'Memo',exact:true}).click();
    await browserExpect(page.getByRole('textbox',{name:'First memo',exact:true})).toHaveValue(project.submission.text);
    expect((await(await services.fetch('https://fixtures.test/control')).json()).calls).toBe(callsBefore);
    await browserExpect(page.locator('.graph-node')).toHaveCount(renderedBefore);
  } finally {await context.unrouteAll({behavior:'wait'});await browser.close();}
},30000);

test('production entrypoint rejects forged headers, other origins, encoded paths and cross-origin writes', async () => {
  expect((await request('/api/health', '')).status).toBe(200);
  const reporting = await request('/api/bug-reports/availability', '');
  expect(reporting.status).toBe(200);
  expect(await reporting.json()).toEqual({ enabled: false });
  expect(reporting.headers.get('cache-control')).toBe('private, no-store');
  expect((await request('/api/cloud/account', '', { headers: { 'x-cail-identity-jwt': 'forged', 'x-cail-subject': TEST_SUBJECTS.alice } })).status).toBe(401);
  expect((await worker.fetch('https://other.example/api/cloud/account')).status).toBe(404);
  const malformed = await request('/api/cloud/%70rojects');
  expect(malformed.status).toBe(400); expect(malformed.headers.get('cache-control')).toContain('no-store');
  expect(malformed.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  expect((await request('/api/cloud/projects/account-map', 'alice', { method: 'PUT', headers: { origin: 'https://other.example' }, body: '{}' })).status).toBe(403);
});
test('account projects isolate users, reject stale writes, and survive a real Durable Object eviction', async () => {
  const alice = await (await request('/api/cloud/account')).json(), bob = await (await request('/api/cloud/account', 'bob')).json();
  expect(alice.account.preferredName).toBe('Sam Student');
  expect(alice.account.email).toBe('synthetic-student@example.edu');
  expect(bob.account.preferredName).toBeNull();
  expect(bob.account.email).toBeNull();
  expect(alice.account.cacheKey).not.toBe(bob.account.cacheKey);
  expect((await request('/api/cloud/projects', 'bob', { headers: { 'x-systems-account-cache': alice.account.cacheKey } })).status).toBe(409);
  const project = newProject();
  project.layout = { phoneOverview: 'preserve' };
  const put = revision => request('/api/cloud/projects/account-map', 'alice', { method: 'PUT', body: JSON.stringify({ project: serializeProject(project), revision }) });
  expect((await put(0)).status).toBe(200); expect((await put(0)).status).toBe(409);
  expect((await request('/api/cloud/projects/account-map', 'bob')).status).toBe(404);
  expect((await (await request('/api/cloud/projects', 'bob')).json()).projects).toEqual([]);
  await worker.evictDurableObject('COURSES', { name: 'test-course' });
  const reopened = JSON.parse((await (await request('/api/cloud/projects/account-map')).json()).project);
  expect(reopened.title).toBe(project.title);
  expect(reopened.layout).toEqual({ phoneOverview: 'preserve' });
  const raced = await Promise.all([put(1), put(1)]); expect(raced.map(value => value.status).sort()).toEqual([200, 409]);
});
test('both memos and manual group membership survive account persistence and Durable Object eviction', async () => {
  const project = groupProject(); project.id = 'two-memo-account-map'; project.title = 'Two-memo persistence example';
  beginPart2(project); project.part2Submission.text = STRONG_MACRO_MEMO;
  const path = `/api/cloud/projects/${project.id}`;
  const put = revision => request(path, 'alice', { method: 'PUT', body: JSON.stringify({ project: serializeProject(project), revision }) });
  expect((await put(0)).status).toBe(200);
  expect((await request(path, 'bob')).status).toBe(404);
  const original = structuredClone(project.graph);
  const group = project.graph.edges.find(edge => edge.relationshipIds);
  group.relationshipIds = group.relationshipIds.slice(0, 1);
  group.annotation.text = 'Student-selected membership after checking both memos.';
  expect((await put(1)).status).toBe(200);
  await worker.evictDurableObject('COURSES', { name: 'test-course' });
  const reopened = JSON.parse((await (await request(path)).json()).project);
  expect(reopened.submission).toEqual(project.submission);
  expect(reopened.part2Submission).toEqual(project.part2Submission);
  expect(reopened.graph.edges.find(edge => edge.id === group.id)).toEqual(group);
  expect(reopened.graph.nodes).toEqual(original.nodes);
  expect(reopened.graph.edges.filter(edge => edge.scale === 'meso')).toEqual(original.edges.filter(edge => edge.scale === 'meso'));
  expect((await put(1)).status).toBe(409);
  expect((await request(path, 'bob')).status).toBe(404);
});
test('project progress is private metadata and revision-checked deletion never affects another owner',async()=>{
  const project=newProject();project.id='synthetic-notes-before-map';project.submission.text='A private synthetic memo.';project.reflection='A private synthetic observation.';
  project.levelProgress.meso.reflection='An archived synthetic observation.';
  const path='/api/cloud/projects/'+project.id;
  expect((await request(path,'alice',{method:'PUT',body:JSON.stringify({project:serializeProject(project),revision:0})})).status).toBe(200);
  const list=await (await request('/api/cloud/projects')).json();
  const row=list.projects.find(item=>item.id===project.id);
  expect(row.progress).toMatchObject({activeScale:'micro',stage:0,nodes:0,relationships:0,hasMemo:true,notes:2});
  expect(JSON.stringify(list)).not.toContain(project.submission.text);expect(JSON.stringify(list)).not.toContain(project.reflection);
  expect((await request(path,'bob',{method:'DELETE',body:JSON.stringify({revision:1})})).status).toBe(404);
  for(const body of [{},{revision:0},{revision:1,owner:'other'}])expect((await request(path,'alice',{method:'DELETE',body:JSON.stringify(body)})).status).toBe(400);
  expect((await request(path,'alice',{method:'DELETE',body:JSON.stringify({revision:2})})).status).toBe(409);
  expect((await request(path,'alice',{method:'DELETE',body:JSON.stringify({revision:1}),headers:{origin:'https://other.example'}})).status).toBe(403);
  expect((await request(path,'alice')).status).toBe(200);
  expect((await request(path,'alice',{method:'DELETE',body:JSON.stringify({revision:1})})).status).toBe(200);
  await worker.evictDurableObject('COURSES',{name:'test-course'});
  expect((await request(path)).status).toBe(404);
  expect((await request(path,'alice',{method:'PUT',body:JSON.stringify({project:serializeProject(project),revision:0})})).status).toBe(200);
  expect(JSON.parse((await (await request(path)).json()).project).reflection).toBe(project.reflection);
});
test('current membership and instructor authority are checked on the next request', async () => {
  expect((await request('/api/teacher/profiles')).status).toBe(403);
  expect((await request('/api/teacher/profiles', 'admin')).status).toBe(200);
  await control({ denied: true }); expect((await request('/api/cloud/account')).status).toBe(403);
  await control({ denied: false }); expect((await request('/api/cloud/account')).status).toBe(200);
});
test('populated legacy course profiles and account maps survive constructor upgrades', async () => {
  const storage = await worker.getDurableObjectStorage('COURSES', { name: 'test-course' });
  const profile = structuredClone(DEFAULT_TEACHING_PROFILE);
  profile.intakeQuestions = [{ id: 'focus', question: 'What would you like to understand?', required: false }];
  profile.parts[0].stages['review-suggestions'].guidance = 'Preserve this instructor guidance';
  await storage.exec('UPDATE teaching_profiles SET profile_json=?, fingerprint=? WHERE id=?',
    JSON.stringify(profile), 'a'.repeat(64), 'systems-mapping-default');

  await worker.evictDurableObject('COURSES', { name: 'test-course' });
  expect((await request('/api/health', '')).status).toBe(200);
  const [stored] = await storage.exec('SELECT profile_json AS profile, revision FROM teaching_profiles WHERE id=?', 'systems-mapping-default');
  const migrated = JSON.parse(stored.profile);
  expect(migrated.intakeQuestions).toEqual(profile.intakeQuestions);
  expect(migrated.parts[0].stages['review-suggestions'].guidance).toBe('Preserve this instructor guidance');
  expect(JSON.parse((await (await request('/api/cloud/projects/account-map')).json()).project).title).toBe('Preserved account map');
  expect((await request('/api/teacher/profiles', 'admin')).status).toBe(200);

  await worker.evictDurableObject('COURSES', { name: 'test-course' });
  expect((await request('/api/health', '')).status).toBe(200);
  const [again] = await storage.exec('SELECT profile_json AS profile, revision FROM teaching_profiles WHERE id=?', 'systems-mapping-default');
  expect(again).toEqual(stored);
});
test('explicit capability links preserve class sharing and optimistic revision semantics', async () => {
  const project = newProject();
  const created = await request('/api/projects', 'alice', { method: 'POST', body: JSON.stringify({ project: serializeProject(project) }) });
  expect(created.status).toBe(201);
  const link = await created.json();
  expect((await request(`/api/projects/${link.token}`, 'bob')).status).toBe(200);
  expect((await request(`/api/projects/${link.token}`, '')).status).toBe(401);
  const revoked = await request(`/api/projects/${link.token}/revoke`, 'alice', { method: 'POST', body: JSON.stringify({ expectedRevision: 1 }) });
  expect(revoked.status).toBe(200); expect((await request(`/api/projects/${link.token}`, 'bob')).status).toBe(410);
});
test('invalid structured output gets one corrective retry, quota refusals make exactly one attempt, and safe metadata is preserved', async () => {
  const project = newProject();
  // Uses the ordinary product request builder, including current ecological semantics.
  const { preflightEvaluationPayload } = await import('../src/App.jsx');
  project.submission.text = 'A student meets an instructor in a college classroom.';
  const payload = preflightEvaluationPayload(project);
  for (const mode of ['invalid', 'quota', 'success']) {
    await control({ mode });
    const response = await request('/api/preflight/evaluations', 'alice', { method: 'POST', body: JSON.stringify(payload), headers: { 'x-request-id': '01900000-0000-7000-8000-000000000001' } });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(mode === 'invalid' ? 502 : mode === 'quota' ? 429 : 201);
    if (mode === 'invalid') expect(body.details.correctiveRetries).toBe(1);
    const stats = await (await services.fetch('https://fixtures.test/control')).json();
    // A contract failure earns one corrective retry; a quota refusal and a success each make one call.
    expect(stats.calls).toBe(mode === 'invalid' ? 2 : 1); expect(stats.captured).toMatchObject({ model: 'glm-5.3-flash', identity: true, authorization: false });
    if (mode === 'quota') expect(body.details).toMatchObject({ code: 'quota_exceeded', shouldRetry: false, requestId: '01900000-0000-7000-8000-000000000001' });
  }
  expect((await (await request('/api/cloud/quota')).json()).quota.remaining_percent).toBe(90);
});
test('login callback establishes an opaque HttpOnly session and logout revokes it', async () => {
  const start = await request('/auth/start', '');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const state = JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))).state;
  const callback = await request(`/auth/callback?code=${crypto.randomUUID()}&state=${state}`, '', { headers: { cookie } });
  expect(callback.status).toBe(303); expect(callback.headers.get('set-cookie')).toContain('Secure; HttpOnly; SameSite=Lax');
  const session = callback.headers.get('set-cookie').split(';')[0];
  expect((await request('/api/cloud/account', '', { headers: { cookie: session } })).status).toBe(200);
  expect((await request('/auth/logout', '', { method: 'POST', headers: { cookie: session } })).status).toBe(303);
  expect((await request('/api/cloud/account', '', { headers: { cookie: session } })).status).toBe(401);
});

test('logout rejects foreign, missing and null origins without revoking the session', async () => {
  for (const supplied of [null, 'null', 'https://other.example', ORIGIN]) {
    const headers = new Headers({ cookie: `__Host-systems-mapping-session=${sessions.alice}`, 'sec-fetch-site': supplied === ORIGIN ? 'cross-site' : 'same-origin' });
    if (supplied !== null) headers.set('origin', supplied);
    const response = await worker.fetch(`${ORIGIN}/auth/logout`, { method: 'POST', headers, redirect: 'manual' });
    expect(response.status).toBe(403);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect((await request('/api/cloud/account', 'alice')).status).toBe(200);
  }
  expect((await request('/auth/logout', 'alice')).status).toBe(405);
  expect((await request('/api/cloud/account', 'alice')).status).toBe(200);
});

test('HTML pages retain a same-origin referrer policy while APIs and auth redirects remain no-referrer', async () => {
  for (const path of ['/', '/teacher', '/p/a-local-project-link']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request(path, '', { method });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('referrer-policy')).toBe('same-origin');
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  }
  for (const path of ['/api/cloud/runtime', '/api/cloud/account', '/auth/start', '/auth/callback']) {
    expect((await request(path, '')).headers.get('referrer-policy')).toBe('no-referrer');
  }
});

test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1')('Chrome native sign-out works from student Projects and Instructor Console', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const who of ['alice', 'admin']) {
      await control({ resetSessions: true });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addCookies([{ name: '__Host-systems-mapping-session', value: sessions[who], url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
      try {
        const page = await context.newPage();
        const bridge = await context.newCDPSession(page);
        const bridgeErrors = [];
        // Intercept every redirect hop as well as the initial request. Standard
        // Playwright routing handles only the first URL in a redirect chain.
        // Preserve the browser's Origin/Referer and native cookie handling.
        bridge.on('Fetch.requestPaused', async ({ requestId, request: source }) => {
          try {
            if (new URL(source.url).origin !== ORIGIN) return await bridge.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
            const response = await worker.fetch(source.url, { method: source.method, headers: source.headers, body: source.postData, redirect: 'manual' });
            const responseHeaders = [...response.headers].filter(([name]) => name !== 'set-cookie').map(([name, value]) => ({ name, value }));
            for (const value of response.headers.getSetCookie()) responseHeaders.push({ name: 'set-cookie', value });
            await bridge.send('Fetch.fulfillRequest', { requestId, responseCode: response.status, responseHeaders, body: Buffer.from(await response.arrayBuffer()).toString('base64') });
          } catch (error) {
            bridgeErrors.push(error.message);
            await bridge.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {});
          }
        });
        await bridge.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
        await page.goto(ORIGIN);
        await page.getByRole('button', { name: 'Account', exact: true }).click();
        if (who === 'admin') {
          await page.getByRole('tab', { name: 'Instructor Console', exact: true }).click();
          await browserExpect(page.getByRole('tab', { name: 'Submissions', exact: true })).toBeVisible();
          await page.getByRole('tab', { name: 'Overview', exact: true }).click();
        }
        const signedOut = page.waitForResponse(response => new URL(response.url()).pathname === '/auth/logout' && response.request().method() === 'POST');
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        const response = await signedOut;
        expect(await response.request().headerValue('origin')).toBe(ORIGIN);
        expect(response.status()).toBe(303);
        await browserExpect(page.getByRole('link', { name: 'CUNY Login', exact: true })).toBeVisible();
        expect(new URL(page.url()).pathname).toBe('/');
        expect((await context.cookies()).some(cookie => cookie.name === '__Host-systems-mapping-session')).toBe(false);
        expect((await request('/api/cloud/account', who)).status).toBe(401);
        expect(bridgeErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await control({ resetSessions: true });
    await browser.close();
  }
}, 30000);

test('a known availability refusal uses the admitted backup and records the model that answered', async () => {
  const { preflightEvaluationPayload } = await import('../src/App.jsx');
  const project = newProject();
  project.submission.text = 'A student meets an instructor in a college classroom.';
  await control({ mode: 'fallback' });
  const response = await request('/api/preflight/evaluations', 'alice', { method: 'POST', body: JSON.stringify(preflightEvaluationPayload(project)) });
  const body = await response.json();
  expect(response.status).toBe(201);
  expect(body.evaluation.runtime.model).toBe('gpt-oss-20b');
  const stats = await (await services.fetch('https://fixtures.test/control')).json();
  expect(stats.calls).toBe(2);
  expect(stats.captured).toMatchObject({ model: 'gpt-oss-20b', identity: true, authorization: false });
  await control({ mode: 'success' });
});

test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1')('Chrome account flow preserves map edits and exported content across reload and account switching', async () => {
  const fixture = JSON.parse(serializedEastHarlemDisabilityProject());
  fixture.mapAnnotation.text = 'A saved map note from an earlier version.';
  fixture.id = 'browser-map';
  expect((await request('/api/cloud/projects/browser-map', 'alice', { method: 'PUT', body: JSON.stringify({ project: serializeProject(fixture), revision: 0 }) })).status).toBe(200);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  let failCloudWrites = false;
  await context.route('**/*', async route => {
    const source = route.request();
    if (new URL(source.url()).origin !== ORIGIN) return route.abort();
    if (failCloudWrites && source.method() === 'PUT' && new URL(source.url()).pathname.startsWith('/api/cloud/projects/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic storage interruption"}' });
    const response = await worker.fetch(source.url(), { method: source.method(), headers: await source.allHeaders(), body: source.postDataBuffer() ?? undefined, redirect: 'manual' });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(ORIGIN);
    const login = page.getByRole('link', { name: 'CUNY Login', exact: true });
    await browserExpect(login).toBeVisible();
    await browserExpect(login).toHaveAttribute('href', '/auth/start');
    for (const width of [1440, 320, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      const bounds = await login.boundingBox();
      expect(bounds.width).toBeLessThan(160);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await browserExpect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await login.boundingBox()).width).toBeLessThan(160);
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await page.keyboard.press('Tab');
    await browserExpect(login).toBeFocused();
    expect(await login.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: sessions.alice, url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await page.reload();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await browserExpect(page.getByText('Approximately 90% remaining', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await browserExpect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
    await browserExpect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectFullMap(page);
    await notebookSection(page, 'review');
    await page.locator('.saved-map-note > summary').click();
    const note = page.getByRole('textbox', { name: 'Map note', exact: true });
    await note.fill('Account map edit survives restart and export.');
    await projectMenu(page, 'Projects');
    await browserExpect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await browserExpect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await browserExpect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const stored = JSON.parse((await (await request('/api/cloud/projects/browser-map')).json()).project);
    expect(stored.mapAnnotation.text).toBe('Account map edit survives restart and export.');
    await page.reload();
    await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
    await expectFullMap(page);
    await notebookSection(page, 'review');
    await page.locator('.saved-map-note > summary').click();
    failCloudWrites = true;
    await page.getByRole('textbox', { name: 'Map note', exact: true }).fill('Unsynced work is recovered after a storage interruption.');
    await page.getByRole('textbox', { name: 'Map note', exact: true }).press('Tab');
    await browserExpect(page.getByRole('alert')).toContainText('Your unsynced copy remains on this device');
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      // The wrapped account notice updates the measured stage inset on resize.
      await browserExpect.poll(async () => {
        const alert = await page.getByRole('alert').boundingBox();
        const stage = await page.locator('.map-stage').boundingBox();
        return alert.y + alert.height - stage.y;
      }).toBeLessThanOrEqual(1);
      const stage = await page.locator('.map-stage').boundingBox();
      expect(stage.width).toBeGreaterThan(width * .94);
      expect(stage.height).toBeGreaterThan(450);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    failCloudWrites = false;
    await page.reload();
    await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
    await browserExpect.poll(async () => JSON.parse((await (await request('/api/cloud/projects/browser-map')).json()).project).mapAnnotation.text).toBe('Unsynced work is recovered after a storage interruption.');
    await page.screenshot({ path: '/tmp/cail-systems-cloudflare-desktop.png' });
    await projectMenu(page, 'Export & share');
    const download = page.waitForEvent('download');
    await page.getByRole('combobox',{name:'File format'}).selectOption('json');
    await page.getByRole('button',{name:'Download',exact:true}).click();
    const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
    expect(exported.mapAnnotation.text).toBe('Unsynced work is recovered after a storage interruption.');
    expect(exported.graph.nodes.map(node => node.id)).toEqual(stored.graph.nodes.map(node => node.id));
    await page.setViewportSize({ width: 390, height: 844 });
    // The phone layout lands after the media-query listener re-renders, so poll rather than read once.
    await browserExpect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: '/tmp/cail-systems-cloudflare-phone.png' });
    await context.clearCookies();
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: sessions.bob, url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto(ORIGIN);
    await browserExpect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await browserExpect(page.getByRole('form', { name: 'New project', exact: true })).toBeVisible();
    await browserExpect(page.getByRole('article')).toHaveCount(0);
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await browserExpect(page.getByText('Approximately 90% remaining', { exact: false })).toBeVisible();
    expect(await page.getByText('East Harlem disability resources').count()).toBe(0);
    const shared = await (await request('/api/projects', 'alice', { method: 'POST', body: JSON.stringify({ project: serializeProject(fixture) }) })).json();
    await context.clearCookies();
    await page.goto(`${ORIGIN}/p/${shared.token}`);
    await browserExpect(page.getByRole('link', { name: 'CUNY Login' })).toHaveAttribute('href', `/auth/start?returnTo=${encodeURIComponent(`/p/${shared.token}`)}`);
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: sessions.bob, url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await page.reload();
    await expectFullMap(page);
    await projectMenu(page, 'Projects');
    await browserExpect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    await browserExpect(page.getByRole('article', { name: 'East Harlem disability resources' })).toBeVisible();
    await context.clearCookies();
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: sessions.admin, url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto(ORIGIN);
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('tab', { name: 'Instructor Console', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
    await browserExpect(page.getByRole('tab', { name: 'Submissions', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Course settings', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Field Notes prompts', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await browserExpect(page.getByText('Approximately 90% remaining', { exact: false })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.unrouteAll({ behavior: 'wait' }); await browser.close(); }
}, 45000);

test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1')('Chrome SSO access states preserve account drafts without offering a class code', async () => {
  const fixture = JSON.parse(serializedEastHarlemDisabilityProject());
  fixture.mapAnnotation.text = 'A saved map note from an earlier version.';
  fixture.id = 'browser-sso-map';
  fixture.title = 'SSO recovery map';
  expect((await request(`/api/cloud/projects/${fixture.id}`, 'alice', {
    method: 'PUT', body: JSON.stringify({ project: serializeProject(fixture), revision: 0 }),
  })).status).toBe(200);
  const { account } = await (await request('/api/cloud/account')).json();
  const recoveryKey = `systems-mapping.account.${account.cacheKey}.${STORAGE_KEY}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  let sessionMode = 'loading';
  let sessionReads = 0;
  let releaseSession;
  const sessionGate = new Promise(resolve => { releaseSession = resolve; });
  await context.addCookies([{ name: '__Host-systems-mapping-session', value: sessions.alice, url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(() => {
    window.__ssoClassCodeShown = false;
    new MutationObserver(() => {
      if (/class code/i.test(document.body?.innerText || '')) window.__ssoClassCodeShown = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await context.route('**/*', async route => {
    const source = route.request();
    const url = new URL(source.url());
    if (url.origin !== ORIGIN) return route.abort();
    // Only the local fixture's session response is varied; account storage and
    // identity verification still run through the ordinary Worker entrypoint.
    if (url.pathname === '/api/student/session') {
      sessionReads += 1;
      if (sessionMode === 'loading') await sessionGate;
      if (sessionMode === 'missing') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access: null }) });
      if (['invalid', 'denied', 'unavailable'].includes(sessionMode)) return route.fulfill({
        status: sessionMode === 'invalid' ? 401 : sessionMode === 'denied' ? 403 : 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic session check failure' }),
      });
    }
    const response = await worker.fetch(source.url(), { method: source.method(), headers: await source.allHeaders(), body: source.postDataBuffer() ?? undefined, redirect: 'manual' });
    if (url.pathname === '/api/student/session' && sessionMode === 'expiring') {
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.access).toBeTruthy();
      data.access.expiresAt = new Date(Date.now() + 5000).toISOString();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    }
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assertSsoOnly = async ({ checking = false } = {}) => {
    await browserExpect(page.getByLabel('Class code', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.__ssoClassCodeShown)).toBe(false);
    const login = page.getByRole('link', { name: 'CUNY Login', exact: true });
    if (checking) await browserExpect(login).toHaveCount(0);
    else await browserExpect(login).toHaveAttribute('href', '/auth/start');
  };
  const openAccountMap = async () => {
    await page.goto(ORIGIN);
    await page.getByRole('article', { name: fixture.title, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
  };
  try {
    await openAccountMap();
    await browserExpect(page.getByRole('status')).toHaveText('Checking sign-in…');
    await assertSsoOnly({ checking: true });
    sessionMode = 'missing';
    releaseSession();
    await browserExpect(page.getByRole('alert')).toHaveText('Use CUNY Login to continue');
    await assertSsoOnly();
    await browserExpect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);

    sessionMode = 'invalid';
    await openAccountMap();
    await browserExpect(page.getByRole('alert')).toHaveText('Use CUNY Login to continue');
    await assertSsoOnly();

    sessionMode = 'denied';
    await openAccountMap();
    await browserExpect(page.getByRole('alert')).toHaveText('CUNY AI Lab access required');
    await assertSsoOnly();
    await browserExpect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);

    sessionMode = 'unavailable';
    await openAccountMap();
    await browserExpect(page.getByRole('alert')).toHaveText('Sign-in check unavailable');
    await assertSsoOnly();
    await page.screenshot({ path: '/tmp/cail-systems-sso-unavailable.png' });
    sessionMode = 'expiring';
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expectFullMap(page);
    await notebookSection(page, 'review');
    await page.locator('.saved-map-note > summary').click();
    const draft = 'Map note retained when CUNY sign-in expires';
    await page.getByRole('textbox', { name: 'Map note', exact: true }).fill(draft);
    // A fresh grant from the ordinary Worker restores this same map. Leave the
    // annotation focused so renewal must flush it without a blur or navigation.
    const readsBeforeRenewal = sessionReads;
    await browserExpect.poll(() => sessionReads, { timeout: 8000 }).toBe(readsBeforeRenewal + 1);
    await expectFullMap(page);
    await browserExpect(page.getByRole('link', { name: 'CUNY Login', exact: true })).toHaveCount(0);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).mapAnnotation.text, recoveryKey)).toBe(draft);
    // A later check that cannot supply a grant must still hide the workspace.
    // The expiring fixture returns a fresh deadline on each successful read.
    sessionMode = 'missing';
    await browserExpect(page.getByRole('alert')).toHaveText('Use CUNY Login to continue', { timeout: 8000 });
    expect(sessionReads).toBe(readsBeforeRenewal + 2);
    await assertSsoOnly();
    const recovery = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), recoveryKey);
    expect(recovery.id).toBe(fixture.id);
    expect(recovery.mapAnnotation.text).toBe(draft);
    expect(recovery.graph.nodes).toHaveLength(9);
    await page.screenshot({ path: '/tmp/cail-systems-sso-expired.png' });

    sessionMode = 'success';
    await openAccountMap();
    await expectFullMap(page);
    await notebookSection(page, 'review');
    await page.locator('.saved-map-note > summary').click();
    await browserExpect(page.getByRole('textbox', { name: 'Map note', exact: true })).toHaveValue(draft);
    await browserExpect.poll(async () => JSON.parse((await (await request(`/api/cloud/projects/${fixture.id}`)).json()).project).mapAnnotation.text).toBe(draft);
    expect(await page.evaluate(() => window.__ssoClassCodeShown)).toBe(false);
    expect(errors).toEqual([]);
    await page.screenshot({ path: '/tmp/cail-systems-sso-recovered.png' });
  } finally {
    releaseSession();
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await browser.close();
  }
}, 45000);
