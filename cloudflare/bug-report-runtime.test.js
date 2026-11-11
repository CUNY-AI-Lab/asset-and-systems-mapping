// @vitest-environment node
import { beforeAll, afterAll, test, expect } from 'vitest';
import { createTestHarness } from 'wrangler';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { mkdir, writeFile } from 'node:fs/promises';
import { serializedEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';
import { appendSubmittedNodes } from '../src/memoWorkflow.js';
import { connectedMicroProject } from '../tests/e2e/fixtures/connected-micro-project.js';
let harness, url, worker;
const sample = { reportId: '11111111-1111-4111-8111-111111111111', description: 'The map could not be saved after opening my project.', path: '/' };
const control = value => harness.fetch('/__bug-fixture', { method: 'POST', body: JSON.stringify(value) });
const stats = async () => (await (await harness.fetch('/__bug-fixture')).json());
const request = (path, who = 'alice', options = {}) => worker.fetch(new URL(path, url), { ...options,
  headers: { origin: url.origin, ...(who ? { cookie: `bug-fixture-session=${who}` } : {}), ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
const submit = async (data, who = 'alice', headers = {}) => request('/api/bug-reports', who, { method: 'POST', headers, body: JSON.stringify(data) });
beforeAll(async () => {
  const issuer = await createTestIdentityIssuer(), tokens = {};
  for (const [name, subject] of [['alice', TEST_SUBJECTS.alice], ['bob', TEST_SUBJECTS.bob]]) tokens[name] = {
    subject, sessionToken: crypto.randomUUID() + '.' + 's'.repeat(43),
    appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject }),
    gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }),
  };
  harness = createTestHarness({ workers: [{ config: {
    name: 'mapping-bug-report-test', main: 'cloudflare/test-bug-report-worker.ts',
    compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    assets: { directory: './dist-cloudflare', binding: 'ASSETS', run_worker_first: true, not_found_handling: 'single-page-application' },
    vars: { PUBLIC_ORIGIN: 'https://systems.test', LOGIN_URL: '/auth/start', RELEASE: 'bug-report-fixture',
      CAIL_IDENTITY_JWKS: issuer.jwksJson, TEST_TOKENS: JSON.stringify(tokens), COURSE_ACCESS_ENABLED: 'true', COURSE_IDS: 'synthetic-course' },
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '884477', simple: { limit: 1000, period: 60 } }],
  } }] });
  ({ url } = await harness.listen()); worker = harness.getWorker('mapping-bug-report-test');
}, 30000);
afterAll(async () => { await harness?.close(); });

test('anonymous report route skips identity while protected project and instructor APIs still deny access',async()=>{
 await control({resetReports:true,denied:true,identityMode:'expired'});
 const response=await submit(sample,'');expect(response.status).toBe(200);
 expect(await response.json()).toEqual({ok:true,status:'accepted',reportId:sample.reportId});
 expect(await stats()).toMatchObject({identityCalls:0,membershipCalls:0,courseCalls:0});
 for(const path of ['/api/cloud/projects','/api/cloud/courses','/api/teacher/courses']) expect((await request(path,'')).status).toBe(401);
});
test('origin failures, absent capability and ingress limits prevent report writes',async()=>{
 await control({resetReports:true});
 for(const headers of [{origin:'https://foreign.example'},{origin:'null'},{'sec-fetch-site':'cross-site'},{referer:'https://foreign.example/'}])expect((await submit(sample,'',headers)).status).toBe(403);
 expect((await stats()).calls).toHaveLength(0);
 await control({binding:false});expect((await submit(sample,'')).status).toBe(503);
 await control({limited:true});expect((await submit(sample,'')).status).toBe(429);expect((await stats()).calls).toHaveLength(0);
});
test('shared tokens and browser identities never reach the reporting receiver',async()=>{
 await control({resetReports:true});
 expect((await submit({...sample,subject:TEST_SUBJECTS.bob},'')).status).toBe(400);
 expect((await submit({...sample,path:'/p/secretSharedMapCapability12345'},'')).status).toBe(200);
 const result=await stats();expect(result.courseCalls).toBe(0);expect(result.calls[0].path).toBe('/p/:shared-map');
 expect(result.calls[0]).not.toHaveProperty('subject');expect(JSON.stringify(result.calls)).not.toContain('secretSharedMap');
});
test('lost acknowledgement uses the same UUID and one stored synthetic receipt',async()=>{
 await control({mode:'lost-ack',resetReports:true});expect((await submit(sample,'')).status).toBe(503);expect((await stats()).stored).toBe(1);
 await control({});expect((await submit(sample,'')).status).toBe(200);expect((await stats()).stored).toBe(1);
 expect((await submit({...sample,description:'Different text for this report reference.'},'')).status).toBe(409);
});

async function browserFixture(viewport) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport }); const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const signIn = async who => {
    await context.clearCookies();
    if (who) await context.addCookies([{ name: 'bug-fixture-session', value: who, url: url.origin }]);
  };
  return { browser, context, page, errors, signIn };
}
const browserTest = test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1');
browserTest('Projects keeps the two-field creation form prominent and existing names searchable at desktop and phone widths', async () => {
  if (process.env.WORKSPACE_SCREENSHOTS) await mkdir(process.env.WORKSPACE_SCREENSHOTS, { recursive: true });
  for (const viewport of [{ width: 806, height: 758 }, { width: 390, height: 844 }]) {
    const project = JSON.parse(serializedEastHarlemDisabilityProject());
    project.id = `project-page-${viewport.width}`;
    project.participantName = 'Community study group';
    await control({ project });
    const { browser, page, errors, signIn } = await browserFixture(viewport);
    try {
      await signIn('alice'); await page.goto(url.href);
      const form = page.getByRole('form', { name: 'New project', exact: true });
      await browserExpect(form).toBeInViewport({ ratio: 1 });
      await browserExpect(form.getByRole('textbox')).toHaveCount(2);
      const title = form.getByRole('textbox', { name: 'Project', exact: true });
      const creator = form.getByRole('textbox', { name: 'Name', exact: true });
      await browserExpect(title).toHaveValue('');
      for (const control of [title, creator, form.getByRole('button', { name: 'New project', exact: true })]) {
        await browserExpect(control).toBeInViewport({ ratio: 1 });
        expect(await control.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }
      const saved = page.getByRole('region', { name: 'Saved projects', exact: true });
      const record = saved.getByRole('article', { name: project.title, exact: true });
      await browserExpect(record.getByText(project.participantName, { exact: true })).toBeVisible();
      await browserExpect(saved.getByRole('combobox')).toHaveCount(0);
      expect(await form.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(await saved.evaluate(element => element.getBoundingClientRect().top));
      const search = saved.getByRole('searchbox', { name: 'Find projects', exact: true });
      await search.fill('community study'); await browserExpect(record).toBeVisible();
      await search.fill('no such project'); await browserExpect(saved.getByText('No matching projects.')).toBeVisible();
      await search.fill(project.title); await browserExpect(record).toBeVisible();
      await search.fill('');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.WORKSPACE_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: `${process.env.WORKSPACE_SCREENSHOTS}/${viewport.width}-projects.png` });
      await title.fill('Neighborhood learning map'); await creator.fill('Study group A');
      const newSave = page.waitForRequest(request => request.method() === 'PUT' && new URL(request.url()).pathname.startsWith('/api/cloud/projects/'));
      await form.getByRole('button', { name: 'New project', exact: true }).click();
      const savedProject = JSON.parse((await newSave).postDataJSON().project);
      expect(savedProject).toMatchObject({ title: 'Neighborhood learning map', participantName: 'Study group A' });
      expect(savedProject.id).not.toBe(project.id);
      expect(savedProject.graph.nodes).toEqual([]);
      await browserExpect(page.locator('.workspace--studio')).toBeVisible();
      expect(JSON.parse((await (await request(`/api/cloud/projects/${project.id}`)).json()).project)).toEqual(project);
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }
}, 60000);
browserTest('account Micro map centers its connected network and keeps routes away from isolated items',async()=>{
  const project=connectedMicroProject();
  await control({project,resetReports:true});
  const {browser,page,errors,signIn}=await browserFixture({width:1280,height:900});
  try {
    await signIn('alice');await page.goto(url.href);
    await page.getByRole('article',{name:project.title,exact:true}).getByRole('button',{name:'Open project',exact:true}).click();
    await browserExpect(page.locator('.graph-node')).toHaveCount(12);
    // Opening a map never rearranges it; the network arrangement is the explicit Arrange map in Tools.
    await page.getByRole('button',{name:'Tools',exact:true}).click();
    await page.getByRole('button',{name:'Arrange map',exact:true}).click();
    await page.waitForTimeout(400);
    const hide=page.getByRole('button',{name:'Hide sidebar',exact:true});
    if(await hide.isVisible())await hide.click();
    const quality=await page.locator('.graph-canvas').evaluate(svg=>{
      const cards=[...svg.querySelectorAll('.graph-node .node-card')].map(el=>({id:el.closest('.graph-node').dataset.graphId,box:el.getBoundingClientRect()}));
      const core=cards.filter(c=>Number(c.id.split('-')[1])<8),isolated=cards.filter(c=>Number(c.id.split('-')[1])>=8);
      const separated=isolated.every(c=>c.box.left>Math.max(...core.map(c=>c.box.right)))||isolated.every(c=>c.box.top>Math.max(...core.map(c=>c.box.bottom)));
      const hits=[...svg.querySelectorAll('.edge-line')].some(path=>Array.from({length:121},(_,i)=>path.getPointAtLength(path.getTotalLength()*i/120)).some(p=>{
        const point=new DOMPoint(p.x,p.y).matrixTransform(path.getScreenCTM());
        return isolated.some(({box:b})=>point.x>b.left&&point.x<b.right&&point.y>b.top&&point.y<b.bottom);
      }));
      const minNodeFont=Math.min(...[...svg.querySelectorAll('.node-label')].map(el=>parseFloat(getComputedStyle(el).fontSize)*Math.abs(el.getScreenCTM().a)));
      return {separated,hits,minNodeFont};
    });
    expect(quality).toMatchObject({separated:true,hits:false});
    expect(quality.minNodeFont).toBeGreaterThanOrEqual(14);
    if(process.env.WORKSPACE_SCREENSHOTS) {
      await mkdir(process.env.WORKSPACE_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:`${process.env.WORKSPACE_SCREENSHOTS}/connected-micro-account.png`});
      await page.evaluate(()=>{localStorage.setItem('systems-mapping.theme','dark');document.documentElement.dataset.theme='dark';});
      await page.screenshot({path:`${process.env.WORKSPACE_SCREENSHOTS}/connected-micro-account-dark.png`});
    }
    await page.locator('[data-graph-id="micro-2"]').click();
    await page.getByRole('button',{name:'Hide sidebar',exact:true}).click();
    const edit=page.getByRole('group',{name:'Selected map item'}).getByRole('button',{name:'Edit',exact:true});
    await browserExpect(edit).toBeVisible();
    expect(await edit.evaluate(el=>el.getBoundingClientRect().left)).toBeLessThan(640);
    expect(await page.locator('.map-context-actions .selected-item-edit').count()).toBe(0);
    await edit.click();
    await browserExpect(page.getByRole('textbox',{name:'Label',exact:true})).toHaveValue('Librarian Jo');
    expect(errors).toEqual([]);
  } finally {await browser.close();}
},60000);

browserTest('account workspace keeps compact actions and one Tools scroller at five responsive sizes', async () => {
  const viewports = [{ width: 806, height: 758 }, { width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1024, height: 900 }, { width: 1440, height: 1000 }];
  if (process.env.WORKSPACE_SCREENSHOTS) await mkdir(process.env.WORKSPACE_SCREENSHOTS, { recursive: true });
  for (const viewport of viewports) {
    const project = JSON.parse(serializedEastHarlemDisabilityProject()); project.id = `responsive-map-${viewport.width}`;
    project.activeScale = 'micro';
    appendSubmittedNodes(project, { guidance: [], nodes: [], connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
    await control({ project, resetReports: true });
    const { browser, context, page, errors, signIn } = await browserFixture(viewport);
    try {
      await context.addInitScript(() => localStorage.setItem('systems-mapping.sidebar-width', '260'));
      await signIn('alice'); await page.goto(url.href);
      await page.getByRole('article', { name: project.title, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
      await browserExpect(page.locator('.app-header--student .brand__home')).toBeVisible();
      await browserExpect(page.locator('.app-header--student .brand__home')).toHaveText('Systems Mapping');
      const checkActions = async () => {
        for (const name of ['Back', 'Undo', 'Redo', 'Continue']) {
          const control = page.getByRole('button', { name, exact: true });
          await browserExpect(control).toBeInViewport({ ratio: 1 });
          const metrics = await control.evaluate(element => {
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            const range = document.createRange(); range.selectNodeContents(element);
            return { width: rect.width, height: rect.height, textHeight: range.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight) };
          });
          expect(metrics.width).toBeGreaterThanOrEqual(44); expect(metrics.height).toBeGreaterThanOrEqual(44);
          if (name === 'Back') expect(metrics.textHeight).toBeLessThanOrEqual(metrics.lineHeight + 2);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      };
      await checkActions();
      await page.getByRole('button', { name: 'Tools', exact: true }).click();
      expect(await page.getByRole('button', { name: 'Tools', exact: true }).evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, underlineWidth: style.borderBottomWidth, radius: style.borderRadius };
      })).toEqual({ background: 'rgba(0, 0, 0, 0)', underlineWidth: '2px', radius: '0px' });
      const tools = page.getByRole('region', { name: 'Map tools', exact: true });
      for (const name of ['Add item', 'Map key']) await browserExpect(tools.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
      await browserExpect(tools.getByRole('group', { name: 'Map zoom', exact: true }).getByRole('button')).toHaveText(['−', '+', 'Fit map']);
      expect(await tools.locator('.notebook-tools-body').evaluate(element => ({ maxHeight: getComputedStyle(element).maxHeight, overflowY: getComputedStyle(element).overflowY }))).toEqual({ maxHeight: 'none', overflowY: 'visible' });
      await tools.getByRole('button', { name: 'Full screen map', exact: true }).scrollIntoViewIfNeeded();
      await browserExpect(tools.getByRole('button', { name: 'Full screen map', exact: true })).toBeInViewport({ ratio: 1 });
      await checkActions();
      await page.locator('.inspector__scroll').evaluate(element => { element.scrollTop = 0; });
      if (process.env.WORKSPACE_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: `${process.env.WORKSPACE_SCREENSHOTS}/${viewport.width}-tools.png` });
      expect(await page.locator('.notebook-task-top').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(90);
      if ([806, 390].includes(viewport.width)) {
        await tools.getByRole('button', { name: 'List', exact: true }).click();
        const list = page.locator('.map-list-view--compact');
        await browserExpect(list).toBeVisible();
        const geometry = await list.evaluate(element => {
          const list = element.getBoundingClientRect(), sidebar = document.querySelector('#map-inspector').getBoundingClientRect();
          return { left: list.left, right: list.right, top: list.top, bottom: list.bottom, sidebarLeft: sidebar.left, sidebarTop: sidebar.top,
            heights: [...element.querySelectorAll('.map-list-record__button')].map(node => node.getBoundingClientRect().height) };
        });
        expect(geometry.heights.every(height => height >= 44 && height <= 64)).toBe(true);
        if (viewport.width === 806) expect(geometry.right).toBeLessThanOrEqual(geometry.sidebarLeft + 1);
        else expect(geometry.bottom).toBeLessThanOrEqual(geometry.sidebarTop + 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (process.env.WORKSPACE_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: `${process.env.WORKSPACE_SCREENSHOTS}/${viewport.width}-list.png` });
        await tools.getByRole('button', { name: 'Canvas', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Memo', exact: true }).click();
      await browserExpect(page.getByRole('region', { name: 'Memo editor', exact: true })).toBeVisible();
      await checkActions();
      expect(await page.getByRole('textbox', { name: 'First memo', exact: true }).evaluate(element => getComputedStyle(element, '::placeholder').fontSize)).toBe('14px');
      if (viewport.width <= 600) expect(await page.getByRole('textbox', { name: 'First memo', exact: true }).evaluate(element => getComputedStyle(element).fontSize)).toBe('16px');
      if (process.env.WORKSPACE_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: `${process.env.WORKSPACE_SCREENSHOTS}/${viewport.width}-memo.png` });
      await page.getByRole('button', { name: 'Notebook', exact: true }).click();
      await page.locator('[data-graph-id="node_e2e_resident"]').press('Enter');
      const itemHeader = page.locator('.inspector-item-header');
      await browserExpect(itemHeader.getByRole('heading', { name: 'Resident', exact: true })).toBeVisible();
      await browserExpect(itemHeader.getByText('On map', { exact: true })).toBeVisible();
      const widths = [];
      for (const name of ['Remove', 'Done']) {
        const button = itemHeader.getByRole('button', { name, exact: true });
        await browserExpect(button).toBeInViewport({ ratio: 1 });
        widths.push(await button.evaluate(element => element.getBoundingClientRect().width));
      }
      expect(Math.abs(widths[0] - widths[1])).toBeLessThan(1);
      expect(await itemHeader.getByRole('heading').evaluate(element => getComputedStyle(element).fontSize)).toBe('14px');
      const itemHeading = await itemHeader.locator('.inspector-item-heading').evaluate(element => {
        const title = element.querySelector('h2').getBoundingClientRect();
        const status = element.querySelector('.inspector-item-state').getBoundingClientRect();
        return { titleBottom: title.bottom, statusTop: status.top, titleLeft: title.left, statusLeft: status.left };
      });
      expect(itemHeading.statusTop).toBeGreaterThanOrEqual(itemHeading.titleBottom);
      expect(Math.abs(itemHeading.titleLeft - itemHeading.statusLeft)).toBeLessThan(1);
      await page.getByRole('radio', { name: 'Rose', exact: true }).check();
      await browserExpect(page.locator('[data-graph-id="node_e2e_resident"]')).toHaveAttribute('data-node-color', 'rose');
      if (process.env.WORKSPACE_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: `${process.env.WORKSPACE_SCREENSHOTS}/${viewport.width}-selected.png` });
      await page.getByRole('button', { name: 'About Systems Mapping', exact: true }).click();
      await browserExpect(page.getByRole('region', { name: 'About Systems Mapping', exact: true })).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Escape');
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }
}, 120000);
browserTest('signed-out visitors use a one-field popup without login or identity attachment',async()=>{
 await control({resetReports:true});const {browser,page,errors}=await browserFixture({width:1280,height:900});
 try {
  await page.goto(url.href);await page.getByRole('button',{name:'Report a problem',exact:true}).click();
  const description=page.getByLabel('What went wrong? What could be better?');await browserExpect(description).toBeEditable();
  await browserExpect(page.locator('.bug-report input')).toHaveCount(0);await browserExpect(page.locator('.bug-report textarea')).toHaveCount(1);
  await browserExpect(page.locator('.bug-report a')).toHaveCount(0);await description.fill(sample.description);
  await page.getByRole('button',{name:'Send report',exact:true}).click();await browserExpect(page.locator('.bug-report__status')).toContainText('accepted for email delivery');
  const result=await stats();expect(result.calls).toHaveLength(1);expect(result.calls[0]).not.toHaveProperty('subject');
  expect(await page.evaluate(value=>[...Object.values(localStorage),...Object.values(sessionStorage)].some(item=>item.includes(value)),sample.description)).toBe(false);
  expect(errors).toEqual([]);
 } finally {await browser.close();}
},60000);
browserTest('lost acknowledgements keep the same report and exclude shared-link tokens before browser transmission', async () => {
  await control({ mode: 'lost-ack', resetReports: true }); const { browser, page, signIn } = await browserFixture({ width: 390, height: 844 });
  try {
    await signIn('alice'); await page.goto(url.href); await page.getByRole('button', { name: 'Report a problem', exact: true }).click();
    const description = page.getByLabel('What went wrong? What could be better?'); await browserExpect(description).toBeEditable();
    await page.evaluate(() => history.replaceState(null, '', '/p/secretSharedMapCapability12345?secret=query#fragment'));
    await description.fill(sample.description); const posted = [];
    page.on('request', request => { if (request.url().endsWith('/api/bug-reports')) posted.push(request.postDataJSON()); });
    await page.getByRole('button', { name: 'Send report' }).click();
    await browserExpect(page.getByRole('button', { name: 'Check report status' })).toBeVisible();
    await browserExpect(description).not.toBeEditable(); expect((await stats()).stored).toBe(1); expect(posted).toHaveLength(1);
    await browserExpect(page.getByRole('group', { name: 'Report page context' })).toHaveText('This pageShared map');
    expect(posted[0].path).toBe('/p/:shared-map'); expect(JSON.stringify(posted)).not.toMatch(/secret|query|fragment/);
    await page.keyboard.press('Escape');
    await browserExpect(page.getByRole('button', { name: 'Report a problem', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Report a problem', exact: true }).click();
    await browserExpect(description).toHaveValue(sample.description);
    await browserExpect(page.getByRole('button', { name: 'Check report status' })).toBeEnabled();
    expect(posted).toHaveLength(1);
    await control({}); await page.getByRole('button', { name: 'Check report status' }).click();
    await browserExpect(page.getByRole('button', { name: 'Report sent' })).toBeVisible();
    expect(posted).toHaveLength(2); expect(posted[1]).toEqual(posted[0]); expect((await stats()).stored).toBe(1);
  } finally { await browser.close(); }
}, 60000);
browserTest('compact pop-out preserves keyboard focus, draft and map navigation on desktop and phone', async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const project = JSON.parse(serializedEastHarlemDisabilityProject()); project.id = 'bug-report-saved-map';
    project.activeScale = 'micro';
    appendSubmittedNodes(project, { guidance: [], nodes: [], connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
    project.activeScale = 'meso'; project.stage = 3;
    project.levelProgress.meso = { ...project.levelProgress.meso, stage: 3 };
    await control({ project, resetReports: true }); const { browser, page, errors, signIn } = await browserFixture(viewport);
    try {
      await signIn('alice'); await page.goto(url.href);
      await page.getByRole('article', { name: project.title, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
      await browserExpect(page.locator('.workspace--studio')).toBeVisible();
      const trigger = page.getByRole('button', { name: 'Report a problem', exact: true });
      const panel = page.getByRole('dialog', { name: 'Report a bug or request a feature', exact: true });
      const close = page.getByRole('button', { name: 'Close bug report', exact: true });
      const description = page.getByLabel('What went wrong? What could be better?');
      const reportHost = await page.locator('.bug-report-host').elementHandle();
      await browserExpect(page.locator('.app-header--student .workspace-bug-report .bug-report__trigger')).toBeVisible();
      await browserExpect(page.locator('.bug-report-footer')).toBeHidden();
      await browserExpect(panel).toBeHidden();
      await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Notebook', exact: true }).click();
      await browserExpect(page.getByRole('button', { name: 'Meso', exact: true })).toHaveAttribute('aria-current', 'step');
      const layout = await page.evaluate(() => {
        const rect = selector => {
          const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height, right, bottom };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight },
          header: rect('.app-header--student'), map: rect('.map-layout'), footer: rect('.project-footer'),
          project: rect('.project-menu > summary'), tools: rect('.notebook-switch button[aria-pressed="false"]'),
          level: rect('.workflow-steps'), navigation: rect('.notebook-switch'),
          report: rect('.workspace-bug-report .bug-report__trigger'),
          brandDisplay: getComputedStyle(document.querySelector('.app-header--student .brand')).display,
          script: document.querySelector('script[type="module"]').src,
          stylesheet: document.querySelector('link[rel="stylesheet"]').href,
        };
      });
      expect(layout.project.right).toBeLessThanOrEqual(layout.report.x + 1);
      expect(layout.report.y).toBeGreaterThanOrEqual(layout.header.y);
      expect(layout.report.bottom).toBeLessThanOrEqual(layout.header.bottom);
      expect(layout.map.y).toBeLessThanOrEqual(layout.header.bottom + 8);
      expect(layout.navigation.y).toBeGreaterThanOrEqual(layout.map.y);
      expect(layout.navigation.right).toBeLessThanOrEqual(viewport.width);
      if (viewport.width < 600) {
        expect(layout.brandDisplay).toBe('flex');
        expect(layout.map.bottom).toBeLessThanOrEqual(layout.footer.y);
        expect(layout.footer.y - layout.map.bottom).toBeLessThanOrEqual(12);
      }
      if (process.env.BUG_REPORT_SCREENSHOTS) {
        await mkdir(process.env.BUG_REPORT_SCREENSHOTS, { recursive: true });
        await writeFile(`${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-layout.json`, JSON.stringify(layout, null, 2));
        await page.screenshot({ animations: 'disabled', path: `${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-closed.png` });
      }
      await trigger.focus(); await page.keyboard.press('Enter');
      await browserExpect(panel).toBeVisible(); await browserExpect(close).toBeFocused();
      await browserExpect(description).toBeEditable();
      await page.keyboard.press('Tab'); await browserExpect(description).toBeFocused();
      await description.fill('The map controls look different after I reopen this project.');
      await page.keyboard.press('Tab'); await browserExpect(page.getByRole('button', { name: 'Send report' })).toBeFocused();
      await browserExpect(page.getByRole('group', { name: 'Report page context' })).toHaveText('This pageWorkspace');
      await browserExpect.poll(() => page.evaluate(() => {
        const map = document.querySelector('.map-layout').getBoundingClientRect();
        const nav = document.querySelector('.notebook-switch').getBoundingClientRect();
        const support = document.querySelector('.workspace-bug-report .bug-report__trigger').getBoundingClientRect();
        const header = document.querySelector('.app-header--student').getBoundingClientRect();
        const popout = document.querySelector('.bug-report__panel').getBoundingClientRect();
        return map.top <= header.bottom + 8 && support.top >= header.top && support.bottom <= header.bottom
          && support.width >= 44 && support.height >= 44
          && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bug-report-height')) === 0
          && popout.top >= support.bottom + 4 && popout.bottom <= innerHeight - 10 && popout.left >= 10 && popout.right <= innerWidth - 10;
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.BUG_REPORT_SCREENSHOTS) {
        await page.screenshot({ animations: 'disabled', path: `${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-popout.png` });
      }
      await description.evaluate(element => { element.style.height = '220px'; });
      await browserExpect.poll(() => page.evaluate(() => {
        const panel = document.querySelector('.bug-report__panel').getBoundingClientRect();
        const support = document.querySelector('.workspace-bug-report .bug-report__trigger').getBoundingClientRect();
        return panel.top >= support.bottom + 4 && panel.bottom <= innerHeight - 10;
      })).toBe(true);
      await page.keyboard.press('Escape'); await browserExpect(panel).toBeHidden(); await browserExpect(trigger).toBeFocused();
      await browserExpect(trigger).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter'); await browserExpect(description).toHaveValue('The map controls look different after I reopen this project.');
      await close.click(); await browserExpect(panel).toBeHidden(); await browserExpect(trigger).toBeFocused();
      await page.emulateMedia({ reducedMotion: 'reduce' }); await trigger.click();
      await browserExpect(description).toBeEditable();
      expect(await panel.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
      await page.locator('.project-menu > summary').click();
      await browserExpect(panel).toBeHidden();
      await page.locator('.project-menu > summary').click();
      await browserExpect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
      await page.locator('.project-menu > summary').click();
      await page.getByRole('button', { name: 'Projects', exact: true }).click();
      await browserExpect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
      await browserExpect(page.locator('.bug-report-footer')).toBeVisible();
      expect(await page.locator('.bug-report-host').evaluate((node, original) => node === original, reportHost)).toBe(true);
      await trigger.click();
      await browserExpect(description).toHaveValue('The map controls look different after I reopen this project.');
      await close.click();
      await page.getByRole('article', { name: project.title, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
      await browserExpect(page.locator('.app-header--student .workspace-bug-report .bug-report__trigger')).toBeVisible();
      expect(await page.locator('.bug-report-host').evaluate((node, original) => node === original, reportHost)).toBe(true);
      await trigger.click();
      await browserExpect(description).toHaveValue('The map controls look different after I reopen this project.');
      await close.click();
      await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Notebook', exact: true }).click();
      await page.getByRole('button', { name: 'Tools', exact: true }).click(); await page.getByRole('button', { name: 'Full screen map', exact: true }).click();
      await browserExpect(page.locator('.bug-report-host')).toBeHidden(); await page.keyboard.press('Escape');
      await browserExpect(page.locator('.bug-report-host')).toBeVisible();
      await page.locator('[data-graph-id="node_e2e_resident"]').click();
      await browserExpect(page.getByRole('navigation',{name:'Workspace',exact:true}).getByRole('button',{name:'Notebook',exact:true})).toHaveAttribute('aria-pressed','true');
      await browserExpect(page.locator('.inspector-item-header h2')).toHaveText('Resident');
      await browserExpect(page.locator('.inspector-item-header .inspector-item-state')).toHaveText('On map');
      await browserExpect(page.locator('#map-inspector').getByRole('heading', { name: 'Edit', exact: true })).toHaveCount(0);
      await browserExpect(page.locator('.inspector__head')).toHaveCount(0);
      if (process.env.BUG_REPORT_SCREENSHOTS) {
        const editorBounds = await page.locator('.inspector-item-header').evaluate(element => {
          const bounds = node => ({ className: node.className, rect: node.getBoundingClientRect().toJSON(), width: getComputedStyle(node).width, flex: getComputedStyle(node).flex, display: getComputedStyle(node).display });
          return { head: bounds(element), children: [...element.children].map(bounds), done: bounds(element.querySelector('.inspector-done')), scroller: bounds(element.parentElement.querySelector('.inspector__scroll')) };
        });
        await writeFile(`${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-editor.json`, JSON.stringify(editorBounds, null, 2));
      }
      await browserExpect(page.getByRole('button', { name: 'Done', exact: true })).toBeInViewport({ ratio: 1 });
      await browserExpect(page.locator('.canvas-wrap')).toBeVisible();
      const connect = page.getByRole('button', { name: 'Connect from Resident', exact: true });
      await browserExpect(connect).toBeVisible();
      if (process.env.BUG_REPORT_SCREENSHOTS) {
        await page.screenshot({ animations: 'disabled', path: `${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-selected.png` });
      }
      await connect.click();
      await page.locator('[data-graph-id="node_e2e_resource_navigator"]').click();
      const form = page.locator('.add-form');
      await browserExpect(form.getByRole('combobox', { name: 'From', exact: true })).toHaveValue('node_e2e_resident');
      await browserExpect(form.getByRole('combobox', { name: 'To', exact: true })).toHaveValue('node_e2e_resource_navigator');
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await form.evaluate(element => {
        const fields=element.querySelectorAll('select'), scroll=element.closest('.inspector__scroll');
        const from=fields[0].getBoundingClientRect(),to=fields[1].getBoundingClientRect(),bounds=scroll.getBoundingClientRect();
        scroll.scrollBy({top:(from.top+to.bottom)/2-(bounds.top+bounds.bottom)/2});
      });
      if (process.env.BUG_REPORT_SCREENSHOTS) {
        const metrics=await form.evaluate(element=>{
          const ancestors=[];let current=element;
          while(current){const r=current.getBoundingClientRect();ancestors.push({tag:current.tagName,className:current.className,top:r.top,bottom:r.bottom,clientHeight:current.clientHeight,scrollHeight:current.scrollHeight,scrollTop:current.scrollTop,overflow:getComputedStyle(current).overflow});current=current.parentElement;}
          return {ancestors,fields:[...element.querySelectorAll('select')].map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom};})};
        });
        await writeFile(`${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-controls.json`,JSON.stringify(metrics,null,2));
        await page.screenshot({path:`${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-controls.png`});
      }
      for (const name of ['From', 'To']) {
        const field = form.getByRole('combobox', { name, exact: true });
        await field.scrollIntoViewIfNeeded();
        await browserExpect(field).toBeInViewport({ ratio: 1 });
        await browserExpect(page.getByRole('button', { name: 'Add relationship', exact: true })).toBeInViewport({ ratio: 1 });
        await browserExpect(page.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport({ ratio: 1 });
      }
      if (process.env.BUG_REPORT_SCREENSHOTS) {
        await page.screenshot({ animations: 'disabled', path: `${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-relationship.png` });
      }
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await browserExpect(page.locator('.canvas-wrap')).toBeVisible();
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }
}, 60000);

test('explicit Redmine mode never substitutes email when its key is missing', async () => {
 await control({resetReports:true,reportMode:'redmine'});
 const response=await request('/api/bug-reports/availability','');
 expect(await response.json()).toEqual({enabled:false,mode:'contact',delivery:'redmine',fallback:null});
 expect((await submit(sample,'')).status).toBe(503);
 await control({reportMode:'redmine',binding:false});
 expect(await (await request('/api/bug-reports/availability','')).json()).toEqual({enabled:false,mode:'contact',delivery:'redmine',fallback:null});
 expect((await submit(sample,'')).status).toBe(503);
 expect((await stats()).calls).toHaveLength(0);
 await control({resetReports:true});
});
