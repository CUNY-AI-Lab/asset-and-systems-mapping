// @vitest-environment node
import { beforeAll, afterAll, afterEach, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createDefaultProject, serializeProject } from '../src/domain.js';
import { projectMenu } from '../tests/e2e/support/notebook.js';
import { STORAGE_KEY } from '../src/projectLibrary.js';

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
  headers: { ...(who ? headersFor(who) : {}), origin: TOOLS, 'content-type': 'application/json', ...headers },
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
  for (const [who, subject] of [['alice', TEST_SUBJECTS.alice], ['bob', TEST_SUBJECTS.bob], ['admin', 'cail-33333333333333333333333333333333'], ['instructor', 'cail-44444444444444444444444444444444']]) {
    tokens[who] = { subject, sessionToken: crypto.randomUUID() + '.' + 's'.repeat(43),
      appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject }),
      gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }) };
  }
  harness = createTestHarness({ workers: [{ config: {
    name: 'systems-mount-test', main: 'cloudflare/worker.ts', compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    // Email is a local receiver fixture; production remains Redmine-only.
    vars: { PUBLIC_ORIGIN: WORKER, LOGIN_URL: '/auth/start', COURSE_ID: 'mount-test', COURSE_ACCESS_ENABLED: 'true', COURSE_IDS: 'synthetic-course-a,synthetic-course-b', BUG_REPORT_MODE: 'email', RELEASE: 'mount-test', GATEWAY_MODEL: 'gpt-oss-120b', GUIDANCE_CONCURRENCY: '8', CAIL_IDENTITY_JWKS: issuer.jwksJson },
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
afterEach(async () => {
  await control({ denied: false, courseDenied: false });
  await reports.fetch('https://fixtures.test/control', { method: 'POST', body: '{}' });
});
afterAll(async () => { await harness?.close(); }, 30000);

const recoveryRequest = (action, body, cacheKey, options = {}) => request(`/api/cloud/browser-recovery/${action}`, {
  method: 'POST', body: JSON.stringify(body), ...options, headers: { 'x-systems-account-cache': cacheKey, ...options.headers },
});
const originalRecovery = (action, body, cacheKey, { who = 'alice', course } = {}) => worker.fetch(`${WORKER}/api/cloud/browser-recovery/${action}`, {
  method: 'POST', body: JSON.stringify(body), headers: { origin: WORKER, 'content-type': 'application/json',
    cookie: `__Host-systems-mapping-session=${tokens[who].sessionToken}`, 'x-systems-account-cache': cacheKey,
    ...(course ? { 'x-systems-course': course } : {}) },
});
test('browser recovery proves the same account across origins and consumes both opaque receipts once', async () => {
  const { account } = await (await request('/api/cloud/account')).json();
  expect(account.browserRecovery).toEqual({ peerOrigin: WORKER, peerPath: '/' });
  const nonce = 'a'.repeat(64), fingerprint = 'b'.repeat(64);
  const issued = await recoveryRequest('issue', { nonce }, account.cacheKey);
  expect(issued.status).toBe(200);
  expect(issued.headers.get('cache-control')).toContain('no-store');
  const proof = await issued.json();
  expect(Object.keys(proof).sort()).toEqual(['expiresAt', 'token']);
  expect(proof.token).toMatch(/^[0-9a-f]{64}$/);
  expect((await recoveryRequest('verify', { nonce, token: proof.token, fingerprint }, account.cacheKey)).status).toBe(409);
  expect((await originalRecovery('verify', { nonce, token: proof.token, fingerprint }, account.cacheKey, { who: 'bob' })).status).toBe(409);
  const verified = await originalRecovery('verify', { nonce, token: proof.token, fingerprint }, account.cacheKey);
  expect(verified.status).toBe(200);
  const receipt = await verified.json();
  expect((await originalRecovery('verify', { nonce, token: proof.token, fingerprint }, account.cacheKey)).status).toBe(409);
  expect((await recoveryRequest('consume', { nonce, token: receipt.token, fingerprint: 'c'.repeat(64) }, account.cacheKey)).status).toBe(409);
  expect((await recoveryRequest('consume', { nonce, token: receipt.token, fingerprint }, account.cacheKey)).status).toBe(200);
  expect((await recoveryRequest('consume', { nonce, token: receipt.token, fingerprint }, account.cacheKey)).status).toBe(409);
});
test('browser recovery retains course isolation, current Admission and cache fences', async () => {
  const headers = { 'x-systems-course': 'synthetic-course-a' };
  const { account } = await (await request('/api/cloud/account', { headers })).json();
  const nonce = 'd'.repeat(64), fingerprint = 'e'.repeat(64);
  const proof = await (await recoveryRequest('issue', { nonce }, account.cacheKey, { headers })).json();
  expect((await originalRecovery('verify', { nonce, token: proof.token, fingerprint }, account.cacheKey)).status).toBe(409);
  expect((await originalRecovery('verify', { nonce, token: proof.token, fingerprint }, account.cacheKey, { course: 'synthetic-course-b' })).status).toBe(409);
  await control({ courseDenied: true });
  expect((await originalRecovery('verify', { nonce, token: proof.token, fingerprint }, account.cacheKey, { course: 'synthetic-course-a' })).status).toBe(403);
  await control({ courseDenied: false });
  const verified = await originalRecovery('verify', { nonce, token: proof.token, fingerprint }, account.cacheKey, { course: 'synthetic-course-a' });
  expect(verified.status).toBe(200);
  const receipt = await verified.json();
  await control({ denied: true });
  expect((await recoveryRequest('consume', { nonce, token: receipt.token, fingerprint }, account.cacheKey, { headers })).status).toBe(403);
});
test('browser recovery rejects anonymous, partial, foreign-origin and oversized requests', async () => {
  const { account } = await (await request('/api/cloud/account')).json();
  const body = { nonce: 'f'.repeat(64) };
  expect((await recoveryRequest('issue', body, account.cacheKey, { who: null })).status).toBe(401);
  expect((await recoveryRequest('issue', body, account.cacheKey, { headers: { 'x-cail-identity-jwt': 'forged' } })).status).toBe(401);
  expect((await recoveryRequest('issue', body, account.cacheKey, { headers: { origin: 'https://foreign.example' } })).status).toBe(403);
  expect((await recoveryRequest('issue', body, '')).status).toBe(409);
  expect((await recoveryRequest('issue', { ...body, data: 'private map'.repeat(1000) }, account.cacheKey)).status).toBe(400);
  expect((await recoveryRequest('issue', { ...body, owner: 'alice' }, account.cacheKey)).status).toBe(400);
});
test('twenty racing source redemptions produce one receipt, including reverse recovery', async () => {
  const { account } = await (await request('/api/cloud/account')).json();
  const nonce = '1'.repeat(64), fingerprint = '2'.repeat(64);
  const proof = await (await originalRecovery('issue', { nonce }, account.cacheKey)).json();
  const results = await Promise.all(Array.from({ length: 20 }, () => recoveryRequest('verify', { nonce, token: proof.token, fingerprint }, account.cacheKey)));
  expect(results.filter(response => response.status === 200)).toHaveLength(1);
  expect(results.filter(response => response.status === 409)).toHaveLength(19);
  const receipt = await results.find(response => response.status === 200).json();
  expect((await originalRecovery('consume', { nonce, token: receipt.token, fingerprint }, account.cacheKey)).status).toBe(200);
});

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

test.each(['GET', 'HEAD'])('anonymous %s serves only the public frontend shell and files', async method => {
  await control({ denied: true });
  for (const path of ['/', '/p/abcdefghijklmnopqrst?course=seminar', '/theme.js', '/favicon.svg', '/favicon.png']) {
    const response = await request(path, { who: null, method });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('no-store');
    if (method === 'HEAD') expect(await response.text()).toBe('');
  }
  const index = await request('/index.html', { who: null, method });
  expect(index.status).toBe(307); expect(index.headers.get('location')).toBe(MOUNT + '/');
  const html = await (await request('/', { who: null })).text();
  const script = html.match(/<script type="module"[^>]+src="([^"]+)"/)[1];
  expect(script).toMatch(/^\/systems-mapping\/assets\//);
  const asset = await request(script.slice(MOUNT.length), { who: null, method });
  expect(asset.status).toBe(200); expect(asset.headers.get('content-type')).toMatch(/javascript/);
});

test.each(['/api', '/api/health', '/api/cloud/account', '/api/cloud/runtime', '/api/cloud/projects', '/api/bug-reports/session', '/api/config/public'])('anonymous requests cannot reach %s through the public shell', async path => {
  expect((await request(path, { who: null })).status).toBe(401);
});

test.each(['/auth/start', '/auth/logout', '/health', '/metrics', '/admin', '/p/short', '/assets/missing.js', '/assets/missing.html', '/assets/../../api/health'])('does not expose the non-frontend path %s', async path => {
  expect((await request(path, { who: null })).status).toBe(404);
});

test.each([['/', 'POST'], ['/theme.js', 'PUT'], ['/auth/login', 'POST'], ['/', 'OPTIONS']])('rejects %s %s outside the API', async (path, method) => {
  expect((await request(path, { who: null, method })).status).toBe(405);
});

test.each(['GET', 'HEAD'])('the explicit %s login callback verifies grants and preserves a safe page destination', async method => {
  expect((await request('/auth/login', { who: null, method })).status).toBe(401);
  for (const [target, expected] of [[null, MOUNT + '/'], [MOUNT, MOUNT + '/'], [MOUNT + '#details', MOUNT + '/#details'], [MOUNT + '/?course=seminar&view=instructor&context=teaching#details', MOUNT + '/?course=seminar&view=instructor&context=teaching#details'], [MOUNT + '/p/abcdefghijklmnopqrst?course=seminar', MOUNT + '/p/abcdefghijklmnopqrst?course=seminar']]) {
    const response = await request('/auth/login' + (target === null ? '' : '?returnTo=' + encodeURIComponent(target)), { method });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(expected);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
  }
  await control({ denied: true });
  expect((await request('/auth/login', { method })).status).toBe(403);
});

test.each(['', 'https://foreign.example/', TOOLS + MOUNT + '/', '//foreign.example/', MOUNT + '/api/cloud/projects', MOUNT + '/auth/login', MOUNT + '/index.html', MOUNT + '/p/short', MOUNT + '/../stem-splitter/', MOUNT + '/%2e%2e/stem-splitter/', MOUNT + '/%2fapi/health', MOUNT + '/\\foreign.example/', MOUNT + '/\n'])('rejects unsafe login return page %j', async target => {
  expect((await request('/auth/login?returnTo=' + encodeURIComponent(target))).status).toBe(400);
});

test('rejects duplicated login destinations and publishes the explicit runtime login route', async () => {
  expect((await request('/auth/login?returnTo=' + encodeURIComponent(MOUNT + '/') + '&returnTo=' + encodeURIComponent(MOUNT + '/'))).status).toBe(400);
  expect(await (await request('/api/cloud/runtime')).json()).toMatchObject({ loginUrl: MOUNT + '/auth/login' });
});

test.each([
  ['missing app leg', { 'x-cail-identity-jwt': '' }],
  ['missing Gateway leg', { 'x-cail-gateway-identity-jwt': '' }],
  ['forged app leg', { 'x-cail-identity-jwt': 'forged' }],
  ['forged Gateway leg', { 'x-cail-gateway-identity-jwt': 'forged' }],
])('rejects %s on the private receiver', async (_name, headers) => {
  expect((await request('/api/cloud/account', { headers })).status).toBe(401);
  expect((await request('/', { headers })).status).toBe(401);
  expect((await request('/auth/login', { headers })).status).toBe(401);
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
  const { expectedActor } = await (await request('/api/bug-reports/session')).json();
  const response = await request('/api/bug-reports', { method: 'POST', headers: { 'x-forwarded-for': '192.0.2.5' },
    body: JSON.stringify({ reportId: crypto.randomUUID(), expectedActor, description: 'Synthetic local reporting boundary check.', path: '/p/:shared-map' }) });
  expect(response.status).toBe(200);
  const { calls } = await (await reports.fetch('https://fixtures.test/control')).json();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ origin: TOOLS, path: '/p/:shared-map' });
  expect(JSON.stringify(calls)).not.toMatch(/abcdefghijklmnopqrst|192\.0\.2\.5/);
});

const guestReport = (changes = {}) => ({ reportId: crypto.randomUUID(), firstName: 'Sample', lastName: 'Student',
  email: 'mounted-guest@college.edu', description: 'Synthetic local mounted guest report.', path: '/p/:shared-map', ...changes });
const sendGuestReport = (body, headers = {}) => request('/api/bug-reports/guest', { who: null, method: 'POST',
  headers: { 'x-forwarded-for': '192.0.2.10', ...headers }, body: JSON.stringify(body) });

test('anonymous reporting preserves availability, trusted mount metadata and duplicate receipts', async () => {
  const legacy = await worker.fetch(WORKER + '/api/bug-reports/availability');
  const mounted = await request('/api/bug-reports/availability', { who: null });
  expect(legacy.status).toBe(200); expect(mounted.status).toBe(200);
  expect(await mounted.json()).toEqual(await legacy.json());
  const data = guestReport();
  const sent = await sendGuestReport(data);
  expect(sent.status).toBe(200);
  const receipt = await sent.json();
  expect(await (await sendGuestReport(data)).json()).toEqual(receipt);
  expect((await sendGuestReport({ ...data, description: 'Different content under the same receipt.' })).status).toBe(409);
  const { calls } = await (await reports.fetch('https://fixtures.test/control')).json();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ origin: TOOLS, path: '/p/:shared-map' });
  expect(JSON.stringify(calls)).not.toMatch(/mounted-guest@college\.edu|192\.0\.2\.10/);
  expect(sent.headers.get('cache-control')).toContain('no-store');
  expect(sent.headers.get('set-cookie')).toBeNull();
});

test('public reporting preserves origin, trusted-address, body and contact validation', async () => {
  for (const origin of ['', 'null', 'https://foreign.example']) expect((await sendGuestReport(guestReport(), { origin })).status).toBe(403);
  expect((await sendGuestReport(guestReport(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect((await sendGuestReport(guestReport(), { 'x-forwarded-for': '', 'cf-connecting-ip': '192.0.2.77' })).status).toBe(503);
  for (const body of [guestReport({ email: 'sample@example.com' }), guestReport({ path: '/p/private-capability' }),
    guestReport({ description: 'x'.repeat(4001) }), guestReport({ description: 'x'.repeat(33000) }), guestReport({ extra: true })]) {
    expect((await sendGuestReport(body)).status).toBe(400);
  }
  const { calls } = await (await reports.fetch('https://fixtures.test/control')).json();
  expect(calls).toEqual([]);
});

test('anonymous report allowance is exact and never downgrades supplied identity headers', async () => {
  for (const [path, method] of [['/api/bug-reports/availability', 'POST'], ['/api/bug-reports/availability', 'HEAD'],
    ['/api/bug-reports/guest', 'GET'], ['/api/bug-reports/guest', 'OPTIONS'], ['/api/bug-reports/session', 'GET'], ['/api/bug-reports', 'POST']]) {
    expect((await request(path, { who: null, method })).status).toBe(401);
  }
  for (const headers of [
    // Workerd drops empty headers at transport. Keep the other leg present so
    // these exercise a partial credential instead of an anonymous request.
    { ...headersFor(), 'x-cail-identity-jwt': '' }, { ...headersFor(), 'x-cail-gateway-identity-jwt': '' },
    { 'x-cail-identity-jwt': tokens.alice.appJwt }, { 'x-cail-gateway-identity-jwt': tokens.alice.gatewayJwt },
    { ...headersFor(), 'x-cail-identity-jwt': 'forged' },
    { ...headersFor(), 'x-cail-gateway-identity-jwt': tokens.bob.gatewayJwt },
    { ...headersFor(), 'x-cail-identity-jwt': invalidLegs.expired },
  ]) {
    expect((await request('/api/bug-reports/availability', { who: null, headers })).status,
      Object.entries(headers).map(([key, value]) => `${key}:${value ? 'supplied' : 'empty'}`).join(', ')).toBe(401);
    expect((await sendGuestReport(guestReport(), headers)).status).toBe(401);
  }
  await control({ denied: true });
  expect((await request('/api/bug-reports/availability')).status).toBe(403);
  expect((await request('/api/bug-reports/availability', { who: null })).status).toBe(200);
});

test('mounted guest reports retain per-contact and network limits', async () => {
  const headers = { 'x-forwarded-for': '192.0.2.20' };
  for (let i = 0; i < 10; i++) expect((await sendGuestReport(guestReport({ email: 'limit-one@college.edu' }), headers)).status).toBe(200);
  const contactLimit = await sendGuestReport(guestReport({ email: 'limit-one@college.edu' }), headers);
  expect(contactLimit.status).toBe(429); expect(Number(contactLimit.headers.get('retry-after'))).toBeGreaterThan(0);
  for (let i = 0; i < 10; i++) expect((await sendGuestReport(guestReport({ email: 'limit-two@college.edu' }), headers)).status).toBe(200);
  const networkLimit = await sendGuestReport(guestReport({ email: 'limit-three@college.edu' }), headers);
  expect(networkLimit.status).toBe(429);
  expect((await (await reports.fetch('https://fixtures.test/control')).json()).calls).toHaveLength(20);
});

test('course maps and caches match both origins while current ownership and enrollment remain required', async () => {
  const course = 'synthetic-course-a', courseHeader = { 'x-systems-course': course };
  const legacy = (path, options = {}) => worker.fetch(WORKER + path, { ...options, headers: {
    origin: WORKER, cookie: `__Host-systems-mapping-session=${tokens.alice.sessionToken}`,
    'content-type': 'application/json', ...courseHeader,
  } });
  const oldAccount = await (await legacy('/api/cloud/account')).json();
  expect((await (await request('/api/cloud/account', { headers: courseHeader })).json()).account.cacheKey).toBe(oldAccount.account.cacheKey);
  const project = createDefaultProject(); project.id = 'mounted-course-map'; project.title = 'Private course map';
  const path = '/api/cloud/projects/' + project.id;
  expect((await legacy(path, { method: 'PUT', body: JSON.stringify({ project: serializeProject(project), revision: 0 }) })).status).toBe(200);
  const original = await (await request(path, { headers: courseHeader })).json();
  expect(JSON.parse(original.project).title).toBe(project.title);
  project.title = 'Updated through Tools';
  expect((await request(path, { method: 'PUT', headers: { ...courseHeader, 'x-systems-account-cache': oldAccount.account.cacheKey },
    body: JSON.stringify({ project: serializeProject(project), revision: original.revision }) })).status).toBe(200);
  expect(JSON.parse((await (await legacy(path)).json()).project).title).toBe(project.title);
  for (const options of [{}, { headers: { 'x-systems-course': 'synthetic-course-b' } },
    { who: 'instructor', headers: courseHeader }, { who: 'admin', headers: courseHeader }]) expect((await request(path, options)).status).toBe(404);
  expect((await request(path, { headers: { ...courseHeader, 'x-systems-account-cache': crypto.randomUUID() } })).status).toBe(409);
  for (const who of ['alice', 'admin']) expect((await request('/api/cloud/course-students', { who, headers: courseHeader })).status).toBe(403);
  const roster = await request('/api/cloud/course-students', { who: 'instructor', headers: courseHeader });
  expect(roster.status).toBe(200); expect((await roster.json()).students[0].projects[0].title).toBe(project.title);
  await control({ courseDenied: true });
  expect((await request('/api/cloud/course-students', { who: 'instructor', headers: courseHeader })).status).toBe(403);
  expect((await request(path, { headers: courseHeader })).status).toBe(403);
  expect((await legacy(path)).status).toBe(403);
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

test('mounted landing loads anonymously and requests login only after the CUNY Login click', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', offline: true });
  let loginRequests = 0;
  const outside = [], requests = [], errors = [];
  try {
    await context.route('**/*', async route => {
      const source = route.request(), url = new URL(source.url());
      if (url.origin !== TOOLS || !url.pathname.startsWith(MOUNT + '/')) { outside.push(source.url()); return route.abort(); }
      requests.push(url.pathname);
      // Stop at Doorway's login boundary. Its callback and the receiver's
      // verified 303 are separate tests; no external SSO runs in this browser.
      if (url.pathname === MOUNT + '/auth/login') { loginRequests++; return route.fulfill({ status: 204 }); }
      const response = await ingress.fetch(source.url(), { method: source.method(), headers: await source.allHeaders(), body: source.postDataBuffer() ?? undefined, redirect: 'manual' });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const destination = MOUNT + '/?context=teaching#details';
    await page.goto(TOOLS + destination);
    await browserExpect(page.getByRole('heading', { name: 'Systems Mapping', exact: true })).toBeVisible();
    const login = page.getByRole('link', { name: 'CUNY Login', exact: true });
    await browserExpect(login).toBeVisible();
    await browserExpect(page.getByRole('button', { name: 'Report a bug', exact: true })).toBeVisible();
    await browserExpect(login).toHaveAttribute('href', MOUNT + '/auth/login?returnTo=' + encodeURIComponent(destination));
    expect(page.url()).toBe(TOOLS + destination);
    expect(loginRequests).toBe(0);
    expect(requests).toContain(MOUNT + '/api/cloud/account');
    expect(requests).not.toContain(MOUNT + '/api/cloud/projects');
    if (process.env.SYSTEMS_LANDING_SCREENSHOTS) await page.screenshot({ path: `${process.env.SYSTEMS_LANDING_SCREENSHOTS}/systems-anonymous-landing.png` });
    await login.click();
    await browserExpect.poll(() => loginRequests).toBe(1);
    expect(requests).toContain(MOUNT + '/auth/login');
    expect(outside).toEqual([]); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60000);

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

test('browser recovery uses a real popup/port, preserves the original open draft and stages conflicts without model calls', async () => {
  const course = 'synthetic-course-a', headers = { 'x-systems-course': course };
  const { account } = await (await request('/api/cloud/account', { headers })).json();
  const prefix = `systems-mapping.account.${account.cacheKey}.`;
  const project = createDefaultProject(); project.id = 'browser-recovery-fixture'; project.title = 'Original browser map';
  const originalBytes = serializeProject(project), destinationBytes = serializeProject({ ...project, title: 'Destination conflicting map' });
  const sourceEntries = [
    { name: prefix + STORAGE_KEY, value: originalBytes },
    { name: prefix + 'systems-mapping.pending-guidance.' + project.id, value: JSON.stringify({ requestToken: 'retained-fixture', jobId: 'never-resume', createdAt: Date.now() }) },
    { name: prefix + 'systems-mapping.relationship-draft.v1.' + project.id + '.micro', value: JSON.stringify({ version: 1, projectId: project.id, createdAt: project.createdAt, scale: 'micro', draft: { id: 'edge_pending_fixture', source: '', target: '', verb: 'Unfinished relationship fixture', evidence: '', claimState: 'research lead' } }) },
    { name: 'systems-mapping.theme', value: 'dark' },
    { name: 'systems-mapping.account.other.' + STORAGE_KEY, value: 'Other account private fixture' },
  ];
  const browser = await chromium.launch();
  const context = await browser.newContext({ offline: true, storageState: { cookies: [], origins: [
    { origin: WORKER, localStorage: sourceEntries },
    { origin: TOOLS, localStorage: [{ name: prefix + STORAGE_KEY, value: destinationBytes }, { name: 'systems-mapping.theme', value: 'light' }] },
  ] } });
  const outside = [], errors = [], requests = [];
  try {
    await context.route('**/*', async route => {
      const source = route.request(), url = new URL(source.url());
      if (![TOOLS, WORKER].includes(url.origin)) { outside.push(url.origin); return route.abort(); }
      if (url.origin === WORKER && url.pathname === '/fixture-original') return route.fulfill({ contentType: 'text/html', body: '<label>Unsaved node<textarea aria-label="Unsaved node"></textarea></label>' });
      requests.push([url.origin, url.pathname, source.method()]);
      const response = url.origin === TOOLS
        ? await ingress.fetch(source.url(), { method: source.method(), headers: { ...await source.allHeaders(), ...headersFor() }, body: source.postDataBuffer() ?? undefined, redirect: 'manual' })
        : await worker.fetch(source.url(), { method: source.method(), headers: { ...await source.allHeaders(), cookie: `__Host-systems-mapping-session=${tokens.alice.sessionToken}` }, body: source.postDataBuffer() ?? undefined, redirect: 'manual' });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const original = await context.newPage(); await original.goto(WORKER + '/fixture-original');
    await original.getByRole('textbox', { name: 'Unsaved node' }).fill('Unsaved Criticality fixture draft');
    const page = await context.newPage(); await page.goto(TOOLS + MOUNT + '/?course=' + course + '&browserRecovery=destination');
    await browserExpect(page.getByRole('button', { name: 'Read copies from the other address' })).toBeEnabled();
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Read copies from the other address' }).click();
    const popup = await popupPromise;
    await browserExpect(popup.getByRole('button', { name: 'Read browser copies', exact: true })).toBeEnabled();
    await popup.getByRole('button', { name: 'Read browser copies', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Review browser backup' })).toBeVisible();
    await browserExpect(page.getByRole('heading', { name: 'Original browser map' })).toBeVisible();
    await browserExpect(page.getByRole('status')).toContainText('Backup saved separately');
    expect(requests.filter(([, path, method]) => method !== 'GET' && !path.includes('/browser-recovery/'))).toEqual([]);
    expect(requests.some(([, path]) => /guidance|evaluations|connections|map\/check/.test(path))).toBe(false);
    expect(await page.evaluate(key => localStorage.getItem(key), prefix + STORAGE_KEY)).toBe(destinationBytes);
    expect(await page.evaluate(key => localStorage.getItem(key), prefix + 'systems-mapping.pending-guidance.' + project.id)).toBeNull();
    expect(await original.evaluate(() => Object.entries(localStorage).sort())).toEqual(sourceEntries.map(entry => [entry.name, entry.value]).sort());
    await browserExpect(original.getByRole('textbox', { name: 'Unsaved node' })).toHaveValue('Unsaved Criticality fixture draft');
    await page.reload();
    await page.getByText('Saved browser backups (1)', { exact: true }).click();
    await page.getByRole('button', { name: /Review backup from/ }).click();
    await browserExpect(page.getByRole('heading', { name: 'Original browser map' })).toBeVisible();
    await page.getByRole('button', { name: 'Save as a separate account map' }).click();
    await browserExpect(page.getByRole('button', { name: 'Separate map saved' })).toBeDisabled();
    expect(requests.filter(([, path, method]) => method === 'PUT' && path.includes('/api/cloud/projects/recovered_'))).toHaveLength(1);
    const records = await (await request('/api/cloud/projects', { headers })).json();
    const saved = records.projects.find(item => item.title === 'Original browser map (recovered copy)');
    expect(saved.id).not.toBe(project.id);
    await page.getByRole('button', { name: 'Restore relationship drafts to the new map' }).click();
    await browserExpect(page.getByRole('status')).toContainText('1 relationship drafts restored');
    const relationship = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), prefix + 'systems-mapping.relationship-draft.v1.' + saved.id + '.micro');
    expect(relationship).toMatchObject({ projectId: saved.id, draft: { verb: 'Unfinished relationship fixture' } });
    expect(await page.evaluate(key => localStorage.getItem(key), prefix + 'systems-mapping.pending-guidance.' + project.id)).toBeNull();
    expect((await request('/api/cloud/projects/' + saved.id, { who: 'bob', headers })).status).toBe(403);
    expect(await original.evaluate(() => Object.entries(localStorage).sort())).toEqual(sourceEntries.map(entry => [entry.name, entry.value]).sort());
    await browserExpect(original.getByRole('textbox', { name: 'Unsaved node' })).toHaveValue('Unsaved Criticality fixture draft');
    expect(outside).toEqual([]); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60000);
