// @vitest-environment node
import { beforeAll, afterAll, afterEach, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createDefaultProject, serializeProject } from '../src/domain.js';
import { projectMenu } from '../tests/e2e/support/notebook.js';

const WORKER = 'https://systems-mapping.ailab-452.workers.dev';
const TOOLS = 'https://tools.ailab.gc.cuny.edu';
const MOUNT = '/systems-mapping';
let harness, worker, ingress, fixture, reports, tokens, invalidLegs;
const headersFor = (who = 'alice') => ({
  'x-cail-identity-jwt': tokens[who].appJwt,
  'x-cail-gateway-identity-jwt': tokens[who].gatewayJwt,
});
const request = (path, { who = 'alice', headers = {}, ...options } = {}) => ingress.fetch(TOOLS + MOUNT + path, {
  redirect: 'manual', ...options,
  headers: { ...headersFor(who), origin: TOOLS, 'content-type': 'application/json', ...headers },
});
const control = body => fixture.fetch('https://fixtures.test/control', { method: 'POST', body: JSON.stringify(body) });

beforeAll(async () => {
  const issuer = await createTestIdentityIssuer();
  invalidLegs = {
    expired: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject: TEST_SUBJECTS.alice, expiresInSeconds: -120 }),
    audience: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: TEST_SUBJECTS.alice }),
    issuer: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject: TEST_SUBJECTS.alice, issuer: 'https://foreign.example' }),
  };
  tokens = {};
  for (const [who, subject] of [['alice', TEST_SUBJECTS.alice], ['bob', TEST_SUBJECTS.bob], ['admin', 'cail-33333333333333333333333333333333']]) {
    tokens[who] = { subject, sessionToken: crypto.randomUUID() + '.' + 's'.repeat(43),
      appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject }),
      gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }) };
  }
  harness = createTestHarness({ workers: [{ config: {
    name: 'systems-mount-test', main: 'cloudflare/worker.ts', compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    vars: { PUBLIC_ORIGIN: WORKER, LOGIN_URL: '/auth/start', COURSE_ID: 'mount-test', RELEASE: 'mount-test', GATEWAY_MODEL: 'gpt-oss-120b', GUIDANCE_CONCURRENCY: '8', CAIL_IDENTITY_JWKS: issuer.jwksJson },
    assets: { directory: './dist-cloudflare', binding: 'ASSETS', run_worker_first: true, not_found_handling: 'single-page-application' },
    durable_objects: { bindings: [{ name: 'COURSES', class_name: 'MappingCourse' }] }, exports: { MappingCourse: { type: 'durable-object', storage: 'sqlite' } },
    services: [{ binding: 'IDENTITY', service: 'systems-mount-fixture', entrypoint: 'Identity' }, { binding: 'ADMISSION_RESOLVER', service: 'systems-mount-fixture', entrypoint: 'Admission' }, { binding: 'GATEWAY', service: 'systems-mount-fixture' }, { binding: 'BUG_REPORTS', service: 'systems-mount-reports', entrypoint: 'ReportEmail' }],
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '9876534', simple: { limit: 10000, period: 60 } }],
  } }, { config: { name: 'systems-mount-fixture', main: 'cloudflare/test-services.ts', compatibility_date: '2026-09-08', vars: { TEST_TOKENS: JSON.stringify(tokens) } } },
  { config: { name: 'systems-mount-ingress', main: 'cloudflare/test-tools-ingress.ts', compatibility_date: '2026-09-08', services: [{ binding: 'APP', service: 'systems-mount-test', entrypoint: 'ToolsApp' }] } },
  { config: { name: 'systems-mount-reports', main: 'cloudflare/test-report-email-service.ts', compatibility_date: '2026-09-08' } }] });
  await harness.listen();
  worker = harness.getWorker('systems-mount-test');
  fixture = harness.getWorker('systems-mount-fixture');
  ingress = harness.getWorker('systems-mount-ingress');
  reports = harness.getWorker('systems-mount-reports');
}, 30000);
afterEach(async () => { await control({ denied: false }); });
afterAll(async () => { await harness?.close(); });

test('Tools and Worker sessions address the same saved account maps', async () => {
  const project = createDefaultProject(); project.id = 'mounted-map'; project.title = 'One saved map';
  const saved = await worker.fetch(WORKER + '/api/cloud/projects/' + project.id, { method: 'PUT', headers: {
    cookie: `__Host-systems-mapping-session=${tokens.alice.sessionToken}`, origin: WORKER, 'content-type': 'application/json',
  }, body: JSON.stringify({ project: serializeProject(project), revision: 0 }) });
  expect(saved.status).toBe(200);
  const reopened = await request('/api/cloud/projects/' + project.id);
  expect(reopened.status).toBe(200);
  expect(JSON.parse((await reopened.json()).project).title).toBe('One saved map');
  expect((await request('/api/cloud/projects/' + project.id, { who: 'bob' })).status).toBe(404);
});

test('public Worker requests cannot select the private Tools identity boundary', async () => {
  const response = await worker.fetch(WORKER + '/api/cloud/account', { headers: headersFor() });
  expect(response.status).toBe(401);
});

test.each([
  ['missing app leg', { 'x-cail-identity-jwt': '' }],
  ['missing Gateway leg', { 'x-cail-gateway-identity-jwt': '' }],
  ['forged app leg', { 'x-cail-identity-jwt': 'forged' }],
  ['forged Gateway leg', { 'x-cail-gateway-identity-jwt': 'forged' }],
])('rejects %s on the private receiver', async (_name, headers) => {
  expect((await request('/api/cloud/account', { headers })).status).toBe(401);
});

test('rejects mismatched subjects on the two signed legs', async () => {
  expect((await request('/api/cloud/account', { headers: { 'x-cail-gateway-identity-jwt': tokens.bob.gatewayJwt } })).status).toBe(401);
});

test.each(['expired', 'audience', 'issuer'])('rejects an app leg with invalid %s', async key => {
  expect((await request('/api/cloud/account', { headers: { 'x-cail-identity-jwt': invalidLegs[key] } })).status).toBe(401);
});

test('the private receiver rechecks current Admission on pages and API calls', async () => {
  await control({ denied: true });
  expect((await request('/')).status).toBe(403);
  expect((await request('/api/cloud/account')).status).toBe(403);
});

test.each([
  [TOOLS + '/stem-splitter/api/cloud/account', 404],
  [TOOLS + '/systems-mapping-other/api/cloud/account', 404],
  [WORKER + MOUNT + '/api/cloud/account', 404],
  [TOOLS + MOUNT + '/auth/start', 404],
])('rejects the foreign receiver target %s', async (url, status) => {
  expect((await ingress.fetch(url, { headers: headersFor() })).status).toBe(status);
});

test.each(['https://foreign.example', 'null', ''])('rejects a write with Origin %s before translating it', async origin => {
  expect((await request('/api/cloud/projects/no-write', { method: 'PUT', headers: { origin }, body: '{}' })).status).toBe(403);
});

test('rejects cross-site writes even with a matching Origin', async () => {
  expect((await request('/api/cloud/projects/no-write', { method: 'PUT', headers: { 'sec-fetch-site': 'cross-site' }, body: '{}' })).status).toBe(403);
});

test('mounted report metadata identifies Tools without exposing the share token or client address', async () => {
  const response = await request('/api/bug-reports', { method: 'POST', headers: { 'x-forwarded-for': '192.0.2.5' },
    body: JSON.stringify({ reportId: crypto.randomUUID(), description: 'Synthetic local reporting boundary check.', path: '/p/abcdefghijklmnopqrst' }) });
  expect(response.status).toBe(200);
  const { calls } = await (await reports.fetch('https://fixtures.test/control')).json();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ origin: TOOLS, path: '/p/:shared-map' });
  expect(JSON.stringify(calls)).not.toMatch(/abcdefghijklmnopqrst|192\.0\.2\.5/);
});

test('asset canonical redirects remain under the Tools mount', async () => {
  const response = await request('/index.html');
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe(MOUNT + '/');
});

test('HTML at both hosts resolves its entry script, theme and styles under its own application', async () => {
  const response = await request('/p/abcdefghijklmnopqrst');
  const html = await response.text();
  expect(html).not.toContain('<base');
  const theme = html.match(/<script src="([^"]*theme\.js)"/)[1];
  expect(new URL(theme, TOOLS + MOUNT + '/p/abcdefghijklmnopqrst').pathname).toBe('/systems-mapping/theme.js');
  const script = html.match(/<script type="module"[^>]+src="([^"]+)"/)[1];
  expect(script).toMatch(/^\/systems-mapping\/assets\//);
  const asset = await request(script.slice(MOUNT.length));
  expect(asset.status).toBe(200);
  expect(asset.headers.get('content-type')).toMatch(/javascript/);
  const original = await worker.fetch(WORKER + '/p/abcdefghijklmnopqrst');
  const originalHtml = await original.text();
  expect(originalHtml).not.toContain('<base');
  expect(originalHtml).toMatch(/<script type="module"[^>]+src="\/assets\//);
});

test('mounted browser opens a shared map and keeps assets, API and navigation inside the mount', async () => {
  const project = createDefaultProject(); project.id = 'mounted-browser'; project.title = 'Mounted browser map';
  const created = await request('/api/projects', { method: 'POST', body: JSON.stringify({ project: serializeProject(project) }) });
  expect(created.status).toBe(201);
  const { token } = await created.json();
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const failures = [], outside = [];
  try {
    await context.route('**/*', async route => {
      const source = route.request(), url = new URL(source.url());
      if (url.origin !== TOOLS || !url.pathname.startsWith(MOUNT + '/')) { outside.push(source.url()); return route.abort(); }
      const response = await ingress.fetch(source.url(), { method: source.method(), headers: { ...await source.allHeaders(), ...headersFor() }, body: source.postDataBuffer() ?? undefined, redirect: 'manual' });
      if (response.status >= 400) failures.push([url.pathname, response.status]);
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(TOOLS + MOUNT + '/p/' + token);
    await browserExpect(page.getByRole('link', { name: 'Skip to workspace', exact: true })).toHaveJSProperty('href', page.url() + '#workspace');
    await browserExpect(page.getByRole('link', { name: 'Systems Mapping home', exact: true })).toHaveAttribute('href', MOUNT + '/');
    await browserExpect(page.locator('.header-sign-out').first()).toHaveAttribute('action', '/auth/logout');
    await projectMenu(page, 'Project details');
    await browserExpect(page.getByRole('textbox', { name: 'Project', exact: true })).toHaveValue('Mounted browser map');
    await page.reload();
    await projectMenu(page, 'Project details');
    await browserExpect(page.getByRole('textbox', { name: 'Project', exact: true })).toHaveValue('Mounted browser map');
    expect(page.url()).toBe(TOOLS + MOUNT + '/p/' + token);
    expect(outside).toEqual([]);
    expect(failures).toEqual([]);
  } finally { await browser.close(); }
}, 60000);
