// @vitest-environment node
import { beforeAll, afterAll, test, expect } from 'vitest';
import { createTestHarness } from 'wrangler';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { mkdir, writeFile } from 'node:fs/promises';
import { serializedEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';
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
browserTest('signed-out visitors use a one-field popup without login or identity attachment',async()=>{
 await control({resetReports:true});const {browser,page,errors}=await browserFixture({width:1280,height:900});
 try {
  await page.goto(url.href);await page.getByRole('button',{name:'Report a problem',exact:true}).click();
  const description=page.getByLabel('What went wrong?');await browserExpect(description).toBeEditable();
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
    const description = page.getByLabel('What went wrong?'); await browserExpect(description).toBeEditable();
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
    project.activeScale = 'meso'; project.stage = 3;
    project.levelProgress.meso = { ...project.levelProgress.meso, stage: 3 };
    await control({ project, resetReports: true }); const { browser, page, errors, signIn } = await browserFixture(viewport);
    try {
      await signIn('alice'); await page.goto(url.href);
      await page.getByRole('article', { name: project.title, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
      await browserExpect(page.locator('.workspace--studio')).toBeVisible();
      const trigger = page.getByRole('button', { name: 'Report a problem', exact: true });
      const panel = page.getByRole('dialog', { name: 'Report a problem', exact: true });
      const close = page.getByRole('button', { name: 'Close bug report', exact: true });
      const description = page.getByLabel('What went wrong?');
      const reportHost = await page.locator('.bug-report-host').elementHandle();
      await browserExpect(page.locator('.app-header--student .workspace-bug-report .bug-report__trigger')).toBeVisible();
      await browserExpect(page.locator('.bug-report-footer')).toBeHidden();
      await browserExpect(panel).toBeHidden();
      await browserExpect(page.getByRole('combobox', { name: 'Work level', exact: true })).toHaveValue('meso');
      const layout = await page.evaluate(() => {
        const rect = selector => {
          const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height, right, bottom };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight },
          header: rect('.app-header--student'), map: rect('.map-layout'),
          project: rect('.project-menu > summary'), tools: rect('.notebook-map-tools > summary'),
          level: rect('.notebook-switch .notebook-level select'), navigation: rect('.notebook-switch'),
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
      expect(layout.tools.right).toBeLessThanOrEqual(layout.level.x + 1);
      expect(layout.navigation.right).toBeLessThanOrEqual(viewport.width);
      expect(Math.abs(layout.tools.y - layout.level.y)).toBeLessThanOrEqual(2);
      if (viewport.width < 600) {
        expect(layout.brandDisplay).toBe('none');
        expect(layout.map.height).toBeGreaterThan(viewport.height * 0.85);
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
      await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Notebook', exact: true }).click();
      await browserExpect(page.getByRole('combobox', { name: 'Notebook section' })).toBeVisible();
      await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Map', exact: true }).click();
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
      await page.locator('.notebook-map-tools > summary').click(); await page.getByRole('button', { name: 'Full screen map', exact: true }).click();
      await browserExpect(page.locator('.bug-report-host')).toBeHidden(); await page.keyboard.press('Escape');
      await browserExpect(page.locator('.bug-report-host')).toBeVisible();
      await page.locator('[data-graph-id="node_e2e_resident"]').click();
      await browserExpect(page.getByRole('navigation',{name:'Workspace',exact:true}).getByRole('button',{name:'Map',exact:true})).toHaveAttribute('aria-pressed','true');
      await page.getByRole('button',{name:'Edit',exact:true}).click();
      await browserExpect(page.locator('.inspector__head h2')).toHaveText('Edit');
      await browserExpect(page.locator('.item-editor-title p')).toHaveText('Resident');
      if (process.env.BUG_REPORT_SCREENSHOTS) {
        const editorBounds = await page.locator('.inspector__head').evaluate(element => {
          const bounds = node => ({ className: node.className, rect: node.getBoundingClientRect().toJSON(), width: getComputedStyle(node).width, flex: getComputedStyle(node).flex, display: getComputedStyle(node).display });
          return { head: bounds(element), children: [...element.children].map(bounds), done: bounds(element.querySelector('.inspector-done')), scroller: bounds(element.parentElement) };
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
      await page.getByRole('button',{name:'Edit',exact:true}).click();
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
      await browserExpect(form.getByRole('combobox', { name: 'From', exact: true })).toBeInViewport({ ratio: 1 });
      await browserExpect(form.getByRole('combobox', { name: 'To', exact: true })).toBeInViewport({ ratio: 1 });
      if (process.env.BUG_REPORT_SCREENSHOTS) {
        await page.screenshot({ animations: 'disabled', path: `${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-relationship.png` });
      }
      await form.getByRole('button', { name: 'Close', exact: true }).click();
      await browserExpect(page.locator('.canvas-wrap')).toBeVisible();
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }
}, 60000);

test('unconfigured Redmine exposes contact email fallback while retaining sign-in checks', async () => {
 await control({resetReports:true,reportMode:'redmine'});
 const response=await request('/api/bug-reports/availability','');
 expect(await response.json()).toEqual({enabled:true,mode:'contact',delivery:'email',fallback:null});
 expect((await submit(sample,'')).status).toBe(401);
 await control({reportMode:'redmine',binding:false});
 expect(await (await request('/api/bug-reports/availability','')).json()).toEqual({enabled:false,mode:'contact',delivery:'email',fallback:null});
 expect((await submit(sample,'')).status).toBe(503);
 expect((await stats()).calls).toHaveLength(0);
 await control({resetReports:true});
});
