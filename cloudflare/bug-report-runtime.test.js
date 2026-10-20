// @vitest-environment node
import { beforeAll, afterAll, test, expect } from 'vitest';
import { createTestHarness } from 'wrangler';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { mkdir } from 'node:fs/promises';
import { serializedEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';
let harness, url, worker;
const sample = { reportId: '11111111-1111-4111-8111-111111111111', description: 'The map could not be saved after opening my project.', path: '/' };
const control = value => harness.fetch('/__bug-fixture', { method: 'POST', body: JSON.stringify(value) });
const stats = async () => (await (await harness.fetch('/__bug-fixture')).json());
const request = (path, who = 'alice', options = {}) => worker.fetch(new URL(path, url), { ...options,
  headers: { origin: url.origin, ...(who ? { cookie: `bug-fixture-session=${who}` } : {}), ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
const actor = async who => (await (await request('/api/bug-reports/session', who)).json()).expectedActor;
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

test('the production report route requires both real verified JWT legs and fresh membership', async () => {
  await control({ resetReports: true }); const expectedActor = await actor('alice');
  expect((await submit({ ...sample, expectedActor }, '', { 'x-cail-subject': TEST_SUBJECTS.alice })).status).toBe(401);
  for (const identityMode of ['expired', 'forged', 'mismatch']) {
    await control({ identityMode }); expect((await submit({ ...sample, expectedActor })).status).toBe(401);
    expect((await stats()).calls).toHaveLength(0);
  }
  await control({ denied: true }); expect((await submit({ ...sample, expectedActor })).status).toBe(403);
  expect((await stats()).calls).toHaveLength(0);
  await control({}); const response = await submit({ ...sample, expectedActor });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toMatchObject({ ok: true, status: 'saved', reportId: sample.reportId });
  expect(await stats()).toMatchObject({ identityCalls: 1, membershipCalls: 1 });
});
test('account changes, origin failures, absent capability and existing ingress limits prevent writes', async () => {
  await control({ resetReports: true }); const expectedActor = await actor('alice');
  expect((await submit({ ...sample, expectedActor }, 'bob')).status).toBe(409);
  for (const headers of [{ origin: 'https://foreign.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { referer: 'https://foreign.example/' }]) {
    expect((await submit({ ...sample, expectedActor }, 'alice', headers)).status).toBe(403);
  }
  expect((await stats()).calls).toHaveLength(0);
  await control({ binding: false }); expect((await submit({ ...sample, expectedActor })).status).toBe(503);
  expect((await stats()).calls).toHaveLength(0);
  await control({ limited: true }); expect((await submit({ ...sample, expectedActor })).status).toBe(429);
  expect((await stats()).calls).toHaveLength(0);
});
test('reporting bypasses course failure while sanitizing context and rejecting browser identity fields', async () => {
  await control({ resetReports: true }); const expectedActor = await actor('alice');
  const token = 'secretSharedMapCapability12345';
  expect((await submit({ ...sample, expectedActor, subject: TEST_SUBJECTS.bob })).status).toBe(400);
  const response = await submit({ ...sample, expectedActor, path: `/p/${token}` }, 'alice', { 'x-systems-course': 'synthetic-course' });
  expect(response.status).toBe(200);
  const result = await stats(); expect(result.courseCalls).toBe(0);
  expect(result.calls).toEqual([{ reportId: sample.reportId, subject: TEST_SUBJECTS.alice, description: sample.description,
    origin: 'https://systems.test', path: '/p/:shared-map', release: 'bug-report-fixture' }]);
  expect(JSON.stringify(result.calls)).not.toContain(token);
});
test('a lost acknowledgement is safely retried with the identical UUID and one stored fixture record', async () => {
  await control({ mode: 'lost-ack', resetReports: true }); const data = { ...sample, expectedActor: await actor('alice') };
  expect((await submit(data)).status).toBe(503); expect((await stats()).stored).toBe(1);
  await control({}); const result = await submit(data);
  expect(result.status).toBe(200); expect((await stats()).stored).toBe(1);
  expect((await submit({ ...data, description: 'Different text with the same report reference.' })).status).toBe(409);
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
browserTest('one-field footer preserves its draft through expiry and refuses attribution to another account', async () => {
  await control({ resetReports: true }); const { browser, page, errors, signIn } = await browserFixture({ width: 1280, height: 900 });
  try {
    await page.goto(url.href); await page.getByRole('button', { name: 'Report a bug', exact: true }).focus(); await page.keyboard.press('Enter');
    const description = page.getByLabel('Description of the bug');
    await browserExpect(page.getByRole('link', { name: 'CUNY Login (opens a new tab)' })).toBeVisible();
    await browserExpect(page.locator('.bug-report input')).toHaveCount(0);
    await browserExpect(page.locator('.bug-report textarea')).toHaveCount(1);
    await signIn('alice'); await page.getByRole('button', { name: 'Check sign-in', exact: true }).click();
    await browserExpect(description).toBeEditable(); await description.fill(sample.description);
    await signIn(null); await page.getByRole('button', { name: 'Send bug report' }).click();
    await browserExpect(page.locator('.bug-report__status')).toContainText('Keep this tab open');
    await browserExpect(description).toHaveValue(sample.description); expect((await stats()).calls).toHaveLength(0);
    await signIn('bob'); await page.getByRole('button', { name: 'Check sign-in', exact: true }).click();
    await browserExpect(page.locator('.bug-report__status')).toContainText('account changed');
    await browserExpect(description).toHaveValue(sample.description);
    await browserExpect(page.getByRole('button', { name: 'Send bug report' })).toBeDisabled();
    await signIn('alice'); await page.getByRole('button', { name: 'Check sign-in', exact: true }).click();
    await browserExpect(description).toBeEditable(); expect((await stats()).calls).toHaveLength(0);
    await page.getByRole('button', { name: 'Send bug report' }).click();
    await browserExpect(page.locator('.bug-report__status')).toContainText('saved for the Lab administrators');
    const result = await stats(); expect(result.calls).toHaveLength(1); expect(result.calls[0].subject).toBe(TEST_SUBJECTS.alice);
    expect(await page.evaluate(value => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(item => item.includes(value)), sample.description)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60000);
browserTest('lost acknowledgements keep the same report and exclude shared-link tokens before browser transmission', async () => {
  await control({ mode: 'lost-ack', resetReports: true }); const { browser, page, signIn } = await browserFixture({ width: 390, height: 844 });
  try {
    await signIn('alice'); await page.goto(url.href); await page.getByRole('button', { name: 'Report a bug', exact: true }).click();
    const description = page.getByLabel('Description of the bug'); await browserExpect(description).toBeEditable();
    await page.evaluate(() => history.replaceState(null, '', '/p/secretSharedMapCapability12345?secret=query#fragment'));
    await description.fill(sample.description); const posted = [];
    page.on('request', request => { if (request.url().endsWith('/api/bug-reports')) posted.push(request.postDataJSON()); });
    await page.getByRole('button', { name: 'Send bug report' }).click();
    await browserExpect(page.getByRole('button', { name: 'Check report status' })).toBeVisible();
    await browserExpect(description).not.toBeEditable(); expect((await stats()).stored).toBe(1); expect(posted).toHaveLength(1);
    await browserExpect(page.getByRole('group', { name: 'Report page context' })).toHaveText('This pageShared map');
    expect(posted[0].path).toBe('/p/:shared-map'); expect(JSON.stringify(posted)).not.toMatch(/secret|query|fragment/);
    await page.keyboard.press('Escape');
    await browserExpect(page.getByRole('button', { name: 'Report a bug', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Report a bug', exact: true }).click();
    await browserExpect(description).toHaveValue(sample.description);
    await browserExpect(page.getByRole('button', { name: 'Check report status' })).toBeEnabled();
    expect(posted).toHaveLength(1);
    await control({}); await page.getByRole('button', { name: 'Check report status' }).click();
    await browserExpect(page.getByRole('button', { name: 'Report saved' })).toBeVisible();
    expect(posted).toHaveLength(2); expect(posted[1]).toEqual(posted[0]); expect((await stats()).stored).toBe(1);
  } finally { await browser.close(); }
}, 60000);
browserTest('compact pop-out preserves keyboard focus, draft and map navigation on desktop and phone', async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const project = JSON.parse(serializedEastHarlemDisabilityProject()); project.id = 'bug-report-saved-map';
    await control({ project, resetReports: true }); const { browser, page, errors, signIn } = await browserFixture(viewport);
    try {
      await signIn('alice'); await page.goto(url.href);
      await page.getByRole('article', { name: project.title, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
      await browserExpect(page.locator('.workspace--studio')).toBeVisible();
      const trigger = page.getByRole('button', { name: 'Report a bug', exact: true });
      const panel = page.getByRole('dialog', { name: 'Report a bug', exact: true });
      const close = page.getByRole('button', { name: 'Close bug report', exact: true });
      const description = page.getByLabel('Description of the bug');
      await browserExpect(panel).toBeHidden();
      if (process.env.BUG_REPORT_SCREENSHOTS) {
        await mkdir(process.env.BUG_REPORT_SCREENSHOTS, { recursive: true });
        await page.screenshot({ animations: 'disabled', path: `${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-closed.png` });
      }
      await trigger.focus(); await page.keyboard.press('Enter');
      await browserExpect(panel).toBeVisible(); await browserExpect(close).toBeFocused();
      await browserExpect(description).toBeEditable();
      await page.keyboard.press('Tab'); await browserExpect(description).toBeFocused();
      await description.fill('The map controls look different after I reopen this project.');
      await page.keyboard.press('Tab'); await browserExpect(page.getByRole('button', { name: 'Send bug report' })).toBeFocused();
      await browserExpect(page.getByRole('group', { name: 'Report page context' })).toHaveText('This pageWorkspace');
      await browserExpect.poll(() => page.evaluate(() => {
        const map = document.querySelector('.map-layout').getBoundingClientRect();
        const nav = document.querySelector('.notebook-footer').getBoundingClientRect();
        const support = document.querySelector('.bug-report-footer').getBoundingClientRect();
        const popout = document.querySelector('.bug-report__panel').getBoundingClientRect();
        return map.bottom <= nav.top + 2 && nav.bottom <= support.top + 2 && support.height <= 60
          && popout.bottom <= nav.top - 4 && popout.top >= 10 && popout.left >= 10 && popout.right <= innerWidth - 10;
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.BUG_REPORT_SCREENSHOTS) {
        await page.screenshot({ animations: 'disabled', path: `${process.env.BUG_REPORT_SCREENSHOTS}/mapping-${viewport.width}-popout.png` });
      }
      await description.evaluate(element => { element.style.height = '220px'; });
      await browserExpect.poll(() => page.evaluate(() => {
        const panel = document.querySelector('.bug-report__panel').getBoundingClientRect();
        const nav = document.querySelector('.notebook-footer').getBoundingClientRect();
        return panel.top >= 10 && panel.bottom <= nav.top - 4;
      })).toBe(true);
      await page.keyboard.press('Escape'); await browserExpect(panel).toBeHidden(); await browserExpect(trigger).toBeFocused();
      await browserExpect(trigger).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter'); await browserExpect(description).toHaveValue('The map controls look different after I reopen this project.');
      await close.click(); await browserExpect(panel).toBeHidden(); await browserExpect(trigger).toBeFocused();
      await page.emulateMedia({ reducedMotion: 'reduce' }); await trigger.click();
      await browserExpect(description).toBeEditable();
      expect(await panel.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
      await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Notebook', exact: true }).click();
      await browserExpect(panel).toBeHidden();
      await browserExpect(page.getByRole('combobox', { name: 'Notebook section' })).toBeVisible();
      await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Map', exact: true }).click();
      await page.locator('.notebook-map-tools > summary').click(); await page.getByRole('button', { name: 'Full screen map', exact: true }).click();
      await browserExpect(page.locator('.bug-report-footer')).toBeHidden(); await page.keyboard.press('Escape');
      await browserExpect(page.locator('.bug-report-footer')).toBeVisible(); expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }
}, 60000);
