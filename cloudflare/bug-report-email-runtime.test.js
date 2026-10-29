// @vitest-environment node
import { beforeAll, afterAll, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { chromium, expect as browserExpect } from '@playwright/test';

const ORIGIN = 'https://systems.test';
const sessions = Object.fromEntries(['alice', 'admin'].map(name => [name, crypto.randomUUID() + '.' + 's'.repeat(43)]));
let harness, worker, email;
const request = (path, who = 'alice', options = {}) => worker.fetch(ORIGIN + path, { ...options, headers: {
  origin: ORIGIN, 'cf-connecting-ip': '192.0.2.5', ...(who ? { cookie: `__Host-systems-mapping-session=${sessions[who]}` } : {}),
  ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers,
} });
const control = (mode = 'accepted') => email.fetch('https://fixture.test/control', { method: 'POST', body: JSON.stringify({ mode }) });
const stats = async () => (await email.fetch('https://fixture.test/control')).json();
const report = async description => ({ reportId: crypto.randomUUID(), expectedActor: (await (await request('/api/bug-reports/session')).json()).expectedActor, description, path: '/' });
const submit = data => request('/api/bug-reports', 'alice', { method: 'POST', body: JSON.stringify(data) });

beforeAll(async () => {
  const issuer = await createTestIdentityIssuer(), tokens = {};
  for (const name of ['alice', 'admin']) {
    const subject = name === 'alice' ? TEST_SUBJECTS.alice : 'cail-33333333333333333333333333333333';
    tokens[name] = { subject, sessionToken: sessions[name], appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject, name: 'Sam Student' }), gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }) };
  }
  harness = createTestHarness({ workers: [{ config: {
    name: 'mapping-email-test', main: 'cloudflare/worker.ts', compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    vars: { PUBLIC_ORIGIN: ORIGIN, LOGIN_URL: '/auth/start', COURSE_ID: 'email-test-course', RELEASE: 'email-test-release', GATEWAY_MODEL: 'glm-5.3-flash', GUIDANCE_CONCURRENCY: '8', CAIL_IDENTITY_JWKS: issuer.jwksJson, BUG_REPORT_MODE: 'email' },
    assets: { directory: './dist-cloudflare', binding: 'ASSETS', run_worker_first: true, not_found_handling: 'single-page-application' },
    durable_objects: { bindings: [{ name: 'COURSES', class_name: 'MappingCourse' }] }, exports: { MappingCourse: { type: 'durable-object', storage: 'sqlite' } },
    services: [{ binding: 'IDENTITY', service: 'email-identity-fixture', entrypoint: 'Identity' }, { binding: 'ADMISSION_RESOLVER', service: 'email-identity-fixture', entrypoint: 'Admission' }, { binding: 'GATEWAY', service: 'email-identity-fixture' }, { binding: 'BUG_REPORTS', service: 'email-receiver-fixture', entrypoint: 'ReportEmail' }],
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '9876599', simple: { limit: 1000, period: 60 } }],
  } }, { config: { name: 'email-identity-fixture', main: 'cloudflare/test-services.ts', compatibility_date: '2026-09-08', vars: { TEST_TOKENS: JSON.stringify(tokens) } } },
  { config: { name: 'email-receiver-fixture', main: 'cloudflare/test-report-email-service.ts', compatibility_date: '2026-09-08' } }] });
  await harness.listen(); worker = harness.getWorker('mapping-email-test'); email = harness.getWorker('email-receiver-fixture');
}, 30000);
afterAll(async () => { await harness?.close(); });

test('real Worker and Durable Object preserve contact authorization and email receipts through eviction', async () => {
  await control();
  expect(await (await request('/api/bug-reports/availability', '')).json()).toEqual({ enabled: true, mode: 'contact', delivery: 'email', fallback: null });
  expect((await request('/api/bug-reports/session', '')).status).toBe(401);
  const data = await report('Synthetic runtime acceptance for report email.');
  expect((await submit({ ...data, expectedActor: 'f'.repeat(64) })).status).toBe(409);
  expect((await request('/api/bug-reports', '', { method: 'POST', body: JSON.stringify(data) })).status).toBe(401);
  const receipt = await (await submit(data)).json();
  expect(receipt).toMatchObject({ ok: true, status: 'accepted', delivery: 'email', reportId: data.reportId });
  await worker.evictDurableObject('COURSES', { name: 'email-test-course' });
  expect(await (await submit(data)).json()).toEqual(receipt);
  const state = await stats();
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0]).toMatchObject({ reportId: receipt.deliveryReference, description: data.description, path: '/' });
  expect(Object.keys(state.calls[0]).sort()).toEqual(['description', 'origin', 'path', 'rateDay', 'rateKey', 'release', 'reportId']);
  expect(JSON.stringify(state.calls)).not.toMatch(/Sam Student|192\.0\.2\.5|expectedActor/);
});

test('validated guests reach the same email receiver and cross-origin requests remain rejected', async () => {
  await control();
  const data = { reportId: crypto.randomUUID(), firstName: 'Sample', lastName: 'Student', email: 'sample@college.edu', description: 'Synthetic guest report for email fallback acceptance.', path: '/p/:shared-map' };
  const send = (value, headers = {}) => request('/api/bug-reports/guest', '', { method: 'POST', body: JSON.stringify(value), headers });
  expect((await send({ ...data, email: 'sample@example.com' })).status).toBe(400);
  expect((await send(data, { origin: 'https://other.test' })).status).toBe(403);
  expect((await send({ ...data, path: '/p/private-capability' })).status).toBe(400);
  const receipt = await (await send(data)).json();
  expect(receipt).toMatchObject({ status: 'accepted', delivery: 'email' });
  expect(await (await send(data)).json()).toEqual(receipt);
  expect((await stats()).calls).toHaveLength(1);
  expect(JSON.stringify((await stats()).calls)).not.toContain('sample@college.edu');
});

test('a lost email acknowledgement is checked with the same receiver reference after eviction', async () => {
  await control('lost-ack');
  const data = await report('Synthetic email acknowledgement loss, retain the receipt.');
  expect((await submit(data)).status).toBe(503);
  const first = await stats();
  expect(first.calls).toHaveLength(1);
  await worker.evictDurableObject('COURSES', { name: 'email-test-course' });
  await control();
  const receipt = await (await submit(data)).json();
  expect(receipt).toMatchObject({ status: 'accepted', delivery: 'email', deliveryReference: first.calls[0].reportId });
  expect((await stats()).receipts).toBe(first.receipts);
});

test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1')('account report form acknowledges email acceptance through the real Worker', async () => {
  await control();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: sessions.alice, url: ORIGIN, secure: true, httpOnly: true }]);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const source = route.request();
      if (new URL(source.url()).origin !== ORIGIN) return route.abort();
      const response = await worker.fetch(source.url(), { method: source.method(), headers: { ...await source.allHeaders(), 'cf-connecting-ip': '192.0.2.5' }, body: source.postData(), redirect: 'manual' });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    await page.goto(ORIGIN);
    await page.getByRole('button', { name: 'Report a bug', exact: true }).click();
    await browserExpect(page.getByText('Reporting as Sam Student')).toBeVisible();
    await page.getByRole('textbox', { name: 'What went wrong?' }).fill('Synthetic browser report through the email receiver.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await browserExpect(page.locator('.bug-report__status')).toContainText('Accepted for email delivery.');
    const state = await stats();
    expect(state.calls).toHaveLength(1);
    await browserExpect(page.locator('.bug-report__status')).toContainText(state.calls[0].reportId);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 30000);
