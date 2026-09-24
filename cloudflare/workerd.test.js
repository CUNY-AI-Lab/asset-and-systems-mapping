// @vitest-environment node
import { beforeAll, afterAll, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { createDefaultProject, serializeProject } from '../src/domain.js';
import { chromium, expect as browserExpect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serializedEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';

const ORIGIN = 'https://systems-mapping.ailab-452.workers.dev';
let harness, worker, services;
const request = (path, who = 'alice', options = {}) => worker.fetch(ORIGIN + path, { redirect: 'manual', ...options, headers: { cookie: `__Host-systems-mapping-session=${who}`, origin: ORIGIN, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
const control = value => services.fetch('https://fixtures.test/control', { method: 'POST', body: JSON.stringify(value) });
const newProject = () => { const project = createDefaultProject(); project.id = 'account-map'; project.title = 'Preserved account map'; return project; };

beforeAll(async () => {
  const issuer = await createTestIdentityIssuer();
  const tokens = {};
  for (const [name, subject] of [['alice', TEST_SUBJECTS.alice], ['bob', TEST_SUBJECTS.bob], ['admin', 'cail-33333333333333333333333333333333']]) tokens[name] = {
    subject, appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject }), gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }),
  };
  harness = createTestHarness({ workers: [{ config: {
    name: 'systems-mapping-test', main: 'cloudflare/worker.ts', compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    vars: { PUBLIC_ORIGIN: ORIGIN, LOGIN_URL: '/auth/start', COURSE_ID: 'test-course', RELEASE: 'test-release', GATEWAY_MODEL: 'glm-5.2', CAIL_IDENTITY_JWKS: issuer.jwksJson },
    assets: { directory: './dist-cloudflare', binding: 'ASSETS', run_worker_first: true, not_found_handling: 'single-page-application' },
    durable_objects: { bindings: [{ name: 'COURSES', class_name: 'MappingCourse' }] }, exports: { MappingCourse: { type: 'durable-object', storage: 'sqlite' } },
    services: [{ binding: 'IDENTITY', service: 'systems-fixture', entrypoint: 'Identity' }, { binding: 'ADMISSION_RESOLVER', service: 'systems-fixture', entrypoint: 'Admission' }, { binding: 'GATEWAY', service: 'systems-fixture' }],
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '9876523', simple: { limit: 10000, period: 60 } }],
  } }, { config: { name: 'systems-fixture', main: 'cloudflare/test-services.ts', compatibility_date: '2026-09-08', vars: { TEST_TOKENS: JSON.stringify(tokens) } } }] });
  await harness.listen(); worker = harness.getWorker('systems-mapping-test'); services = harness.getWorker('systems-fixture');
}, 30000);
afterAll(async () => { await harness?.close(); });

test('production entrypoint rejects forged headers, other origins, encoded paths and cross-origin writes', async () => {
  expect((await request('/api/health', '')).status).toBe(200);
  expect((await request('/api/cloud/account', '', { headers: { 'x-cail-identity-jwt': 'forged', 'x-cail-subject': TEST_SUBJECTS.alice } })).status).toBe(401);
  expect((await worker.fetch('https://other.example/api/cloud/account')).status).toBe(404);
  const malformed = await request('/api/cloud/%70rojects');
  expect(malformed.status).toBe(400); expect(malformed.headers.get('cache-control')).toContain('no-store');
  expect(malformed.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  expect((await request('/api/cloud/projects/account-map', 'alice', { method: 'PUT', headers: { origin: 'https://other.example' }, body: '{}' })).status).toBe(403);
});
test('account projects isolate users, reject stale writes, and survive a real Durable Object eviction', async () => {
  const alice = await (await request('/api/cloud/account')).json(), bob = await (await request('/api/cloud/account', 'bob')).json();
  expect(alice.account.cacheKey).not.toBe(bob.account.cacheKey);
  expect((await request('/api/cloud/projects', 'bob', { headers: { 'x-systems-account-cache': alice.account.cacheKey } })).status).toBe(409);
  const project = newProject();
  const put = revision => request('/api/cloud/projects/account-map', 'alice', { method: 'PUT', body: JSON.stringify({ project: serializeProject(project), revision }) });
  expect((await put(0)).status).toBe(200); expect((await put(0)).status).toBe(409);
  expect((await request('/api/cloud/projects/account-map', 'bob')).status).toBe(404);
  expect((await (await request('/api/cloud/projects', 'bob')).json()).projects).toEqual([]);
  await worker.evictDurableObject('COURSES', { name: 'test-course' });
  expect(JSON.parse((await (await request('/api/cloud/projects/account-map')).json()).project).title).toBe(project.title);
  const raced = await Promise.all([put(1), put(1)]); expect(raced.map(value => value.status).sort()).toEqual([200, 409]);
});
test('current membership and instructor authority are checked on the next request', async () => {
  expect((await request('/api/teacher/profiles')).status).toBe(403);
  expect((await request('/api/teacher/profiles', 'admin')).status).toBe(200);
  await control({ denied: true }); expect((await request('/api/cloud/account')).status).toBe(403);
  await control({ denied: false }); expect((await request('/api/cloud/account')).status).toBe(200);
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
test('structured model validation and quota refusals make exactly one attempt and preserve safe metadata', async () => {
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
    const stats = await (await services.fetch('https://fixtures.test/control')).json();
    expect(stats.calls).toBe(1); expect(stats.captured).toMatchObject({ model: 'glm-5.2', identity: true, authorization: false });
    if (mode === 'quota') expect(body.details).toMatchObject({ code: 'quota_exceeded', shouldRetry: false, requestId: '01900000-0000-7000-8000-000000000001' });
  }
  expect((await (await request('/api/cloud/quota')).json()).quota.remaining_percent).toBe(90);
});
test('login callback establishes an opaque HttpOnly session and logout revokes it', async () => {
  const start = await request('/auth/start', '');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const state = JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))).state;
  const callback = await request(`/auth/callback?code=${crypto.randomUUID()}&state=${state}`, '', { headers: { cookie } });
  expect(callback.status).toBe(302); expect(callback.headers.get('set-cookie')).toContain('Secure; HttpOnly; SameSite=Lax');
  const session = callback.headers.get('set-cookie').split(';')[0];
  expect((await request('/api/cloud/account', '', { headers: { cookie: session } })).status).toBe(200);
  expect((await request('/auth/logout', '', { method: 'POST', headers: { cookie: session } })).status).toBe(302);
  expect((await request('/api/cloud/account', '', { headers: { cookie: session } })).status).toBe(401);
});

test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1')('Chrome account flow preserves map edits and exported content across reload and account switching', async () => {
  const fixture = JSON.parse(serializedEastHarlemDisabilityProject());
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
    await browserExpect(page.getByRole('link', { name: 'CUNY Login' })).toBeVisible();
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: 'alice', url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await page.reload();
    await browserExpect(page.getByText('approximately 90% remaining', { exact: false })).toBeVisible();
    await page.getByRole('listitem').filter({ hasText: 'East Harlem disability resources' }).getByRole('button', { name: 'Continue' }).click();
    await browserExpect(page.locator('.graph-node')).toHaveCount(9);
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const note = page.getByRole('textbox', { name: 'Map note', exact: true });
    await note.fill('Account map edit survives restart and export.');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    const stored = JSON.parse((await (await request('/api/cloud/projects/browser-map')).json()).project);
    expect(stored.mapAnnotation.text).toBe('Account map edit survives restart and export.');
    await page.reload();
    await page.getByRole('listitem').filter({ hasText: 'East Harlem disability resources' }).getByRole('button', { name: 'Continue' }).click();
    await browserExpect(page.locator('.graph-node')).toHaveCount(9);
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    failCloudWrites = true;
    await page.getByRole('textbox', { name: 'Map note', exact: true }).fill('Unsynced work is recovered after a storage interruption.');
    await page.getByRole('textbox', { name: 'Map note', exact: true }).press('Tab');
    await browserExpect(page.getByRole('alert')).toContainText('Synthetic storage interruption');
    failCloudWrites = false;
    await page.reload();
    await page.getByRole('listitem').filter({ hasText: 'East Harlem disability resources' }).getByRole('button', { name: 'Continue' }).click();
    await browserExpect.poll(async () => JSON.parse((await (await request('/api/cloud/projects/browser-map')).json()).project).mapAnnotation.text).toBe('Unsynced work is recovered after a storage interruption.');
    await page.screenshot({ path: '/tmp/cail-systems-cloudflare-desktop.png' });
    await page.getByRole('button', { name: /^Progress:/ }).click();
    await page.getByRole('dialog', { name: 'Progress' }).getByRole('button', { name: /Revise and export/i }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
    expect(exported.mapAnnotation.text).toBe('Unsynced work is recovered after a storage interruption.');
    expect(exported.graph.nodes.map(node => node.id)).toEqual(stored.graph.nodes.map(node => node.id));
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: '/tmp/cail-systems-cloudflare-phone.png' });
    await context.clearCookies();
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: 'bob', url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto(ORIGIN);
    await browserExpect(page.getByText('No saved projects yet.')).toBeVisible();
    await browserExpect(page.getByText('approximately 90% remaining', { exact: false })).toBeVisible();
    expect(await page.getByText('East Harlem disability resources').count()).toBe(0);
    const shared = await (await request('/api/projects', 'alice', { method: 'POST', body: JSON.stringify({ project: serializeProject(fixture) }) })).json();
    await context.clearCookies();
    await page.goto(`${ORIGIN}/p/${shared.token}`);
    await browserExpect(page.getByRole('link', { name: 'CUNY Login' })).toHaveAttribute('href', `/auth/start?returnTo=${encodeURIComponent(`/p/${shared.token}`)}`);
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: 'bob', url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await page.reload();
    await browserExpect(page.locator('.graph-node')).toHaveCount(9);
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    await browserExpect(page.getByRole('listitem').filter({ hasText: 'East Harlem disability resources' })).toBeVisible();
    await context.clearCookies();
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: 'admin', url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto(ORIGIN);
    await page.getByRole('button', { name: 'Teacher Console', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Teacher Console', exact: true })).toBeVisible();
    await browserExpect(page.getByRole('tab', { name: 'Review submissions', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Course settings', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Course settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await browserExpect(page.getByText('approximately 90% remaining', { exact: false })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.unrouteAll({ behavior: 'wait' }); await browser.close(); }
}, 45000);
