import { notebookSection, projectMenu } from '../tests/e2e/support/notebook.js';
// @vitest-environment node
import { beforeAll, afterAll, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { createDefaultProject, serializeProject } from '../src/domain.js';
import { chromium, expect as browserExpect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serializedEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';
import { DEFAULT_TEACHING_PROFILE } from '../server/config.js';
import { STORAGE_KEY } from '../src/projectLibrary.js';

const ORIGIN = 'https://systems-mapping.ailab-452.workers.dev';
const sessions = Object.fromEntries(['alice', 'bob', 'admin', 'instructor'].map(name => [name, crypto.randomUUID() + '.' + 's'.repeat(43)]));
let harness, worker, services;
const request = (path, who = 'alice', options = {}) => worker.fetch(ORIGIN + path, { redirect: 'manual', ...options, headers: { cookie: `__Host-systems-mapping-session=${sessions[who] || ''}`, origin: ORIGIN, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
const control = value => services.fetch('https://fixtures.test/control', { method: 'POST', body: JSON.stringify(value) });
const newProject = () => { const project = createDefaultProject(); project.id = 'account-map'; project.title = 'Preserved account map'; return project; };

beforeAll(async () => {
  const issuer = await createTestIdentityIssuer();
  const tokens = {};
  for (const [name, subject] of [['alice', TEST_SUBJECTS.alice], ['bob', TEST_SUBJECTS.bob], ['admin', 'cail-33333333333333333333333333333333']]) tokens[name] = {
    subject, sessionToken: sessions[name], appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject }), gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }),
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
    expect(stats.calls).toBe(1); expect(stats.captured).toMatchObject({ model: 'glm-5.3-flash', identity: true, authorization: false });
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

test.skipIf(process.env.SYSTEMS_MAPPING_BROWSER_ACCEPTANCE !== '1')('Chrome native sign-out works from student Projects and Teacher Console', async () => {
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
        if (who === 'admin') {
          await page.getByRole('button', { name: 'Teacher Console', exact: true }).click();
          await browserExpect(page.getByRole('heading', { name: 'Teacher Console', exact: true })).toBeVisible();
        }
        await page.getByText('Account', { exact: true }).click();
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
    await page.getByText('Account', { exact: true }).click();
    await browserExpect(page.getByText('approximately 90% remaining', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await browserExpect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
    await browserExpect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await browserExpect(page.locator('.graph-node')).toHaveCount(9);
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
    await browserExpect(page.locator('.graph-node')).toHaveCount(9);
    await notebookSection(page, 'review');
    await page.locator('.saved-map-note > summary').click();
    failCloudWrites = true;
    await page.getByRole('textbox', { name: 'Map note', exact: true }).fill('Unsynced work is recovered after a storage interruption.');
    await page.getByRole('textbox', { name: 'Map note', exact: true }).press('Tab');
    await browserExpect(page.getByRole('alert')).toContainText('Your unsynced copy remains on this device');
    failCloudWrites = false;
    await page.reload();
    await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
    await browserExpect.poll(async () => JSON.parse((await (await request('/api/cloud/projects/browser-map')).json()).project).mapAnnotation.text).toBe('Unsynced work is recovered after a storage interruption.');
    await page.screenshot({ path: '/tmp/cail-systems-cloudflare-desktop.png' });
    await projectMenu(page, 'Export & share');
    const download = page.waitForEvent('download');
    await page.locator('.export-dropdown > summary').click();
    await page.getByRole('button', { name: /^JSON/ }).click();
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
    await browserExpect(page.getByRole('heading', { name: 'Start your first map' })).toBeVisible();
    await page.getByText('Account', { exact: true }).click();
    await browserExpect(page.getByText('approximately 90% remaining', { exact: false })).toBeVisible();
    expect(await page.getByText('East Harlem disability resources').count()).toBe(0);
    const shared = await (await request('/api/projects', 'alice', { method: 'POST', body: JSON.stringify({ project: serializeProject(fixture) }) })).json();
    await context.clearCookies();
    await page.goto(`${ORIGIN}/p/${shared.token}`);
    await browserExpect(page.getByRole('link', { name: 'CUNY Login' })).toHaveAttribute('href', `/auth/start?returnTo=${encodeURIComponent(`/p/${shared.token}`)}`);
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: sessions.bob, url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await page.reload();
    await browserExpect(page.locator('.graph-node')).toHaveCount(9);
    await projectMenu(page, 'Projects');
    await browserExpect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    await browserExpect(page.getByRole('article', { name: 'East Harlem disability resources' })).toBeVisible();
    await context.clearCookies();
    await context.addCookies([{ name: '__Host-systems-mapping-session', value: sessions.admin, url: ORIGIN, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto(ORIGIN);
    await page.getByRole('button', { name: 'Teacher Console', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Teacher Console', exact: true })).toBeVisible();
    await browserExpect(page.getByRole('tab', { name: 'Submissions', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Course settings', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Course settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await page.getByText('Account', { exact: true }).click();
    await browserExpect(page.getByText('approximately 90% remaining', { exact: false })).toBeVisible();
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
  const assertSsoOnly = async () => {
    await browserExpect(page.getByLabel('Class code', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.__ssoClassCodeShown)).toBe(false);
    await browserExpect(page.getByRole('link', { name: 'CUNY Login', exact: true })).toHaveAttribute('href', '/auth/start');
  };
  const openAccountMap = async () => {
    await page.goto(ORIGIN);
    await page.getByRole('article', { name: fixture.title, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
  };
  try {
    await openAccountMap();
    await browserExpect(page.getByRole('status')).toHaveText('Checking sign-in…');
    await assertSsoOnly();
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
    await browserExpect(page.locator('.graph-node')).toHaveCount(9);
    await notebookSection(page, 'review');
    await page.locator('.saved-map-note > summary').click();
    const draft = 'Map note retained when CUNY sign-in expires';
    await page.getByRole('textbox', { name: 'Map note', exact: true }).fill(draft);
    // Leave the annotation focused: expiry must flush its pending edit before
    // hiding the editor, not rely on a blur or dashboard navigation to save it.
    await browserExpect(page.getByRole('alert')).toHaveText('Use CUNY Login to continue', { timeout: 8000 });
    await assertSsoOnly();
    const recovery = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), recoveryKey);
    expect(recovery.id).toBe(fixture.id);
    expect(recovery.mapAnnotation.text).toBe(draft);
    expect(recovery.graph.nodes).toHaveLength(9);
    await page.screenshot({ path: '/tmp/cail-systems-sso-expired.png' });

    sessionMode = 'success';
    await openAccountMap();
    await browserExpect(page.locator('.graph-node')).toHaveCount(9);
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
