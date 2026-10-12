// @vitest-environment node
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { createDefaultProject, serializeProject } from '../src/domain.js';

const ORIGIN = 'https://systems-mapping.ailab-452.workers.dev';
let harness, worker, services;
const request = (path, who = 'alice', options = {}) => worker.fetch(ORIGIN + path, { redirect: 'manual', ...options, headers: { cookie: `__Host-systems-mapping-session=${who}`, origin: ORIGIN, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
const control = value => services.fetch('https://fixtures.test/control', { method: 'POST', body: JSON.stringify(value) });
const newProject = () => { const project = createDefaultProject(); project.id = 'account-map'; project.title = 'Preserved account map'; return project; };

beforeAll(async () => {
  const issuer = await createTestIdentityIssuer();
  const tokens = {};
  for (const [name, subject] of [['alice', TEST_SUBJECTS.alice], ['bob', TEST_SUBJECTS.bob], ['admin', 'cail-33333333333333333333333333333333'], ['instructor', 'cail-44444444444444444444444444444444']]) tokens[name] = {
    subject, appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject }), gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }),
  };
  harness = createTestHarness({ workers: [{ config: {
    name: 'systems-mapping-test', main: 'cloudflare/worker.ts', compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    vars: { PUBLIC_ORIGIN: ORIGIN, LOGIN_URL: '/auth/start', COURSE_ID: 'test-course', COURSE_ACCESS_ENABLED: 'true', COURSE_IDS: 'synthetic-course-a,synthetic-course-b', RELEASE: 'test-release', GATEWAY_MODEL: 'glm-5.3-flash', GUIDANCE_CONCURRENCY: '8', CAIL_IDENTITY_JWKS: issuer.jwksJson },
    assets: { directory: './dist-cloudflare', binding: 'ASSETS', run_worker_first: true, not_found_handling: 'single-page-application' },
    durable_objects: { bindings: [{ name: 'COURSES', class_name: 'MappingCourse' }] }, exports: { MappingCourse: { type: 'durable-object', storage: 'sqlite' } },
    services: [{ binding: 'IDENTITY', service: 'systems-fixture', entrypoint: 'Identity' }, { binding: 'ADMISSION_RESOLVER', service: 'systems-fixture', entrypoint: 'Admission' }, { binding: 'GATEWAY', service: 'systems-fixture' }],
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '9876523', simple: { limit: 10000, period: 60 } }],
  } }, { config: { name: 'systems-fixture', main: 'cloudflare/test-services.ts', compatibility_date: '2026-09-08', vars: { TEST_TOKENS: JSON.stringify(tokens) } } }] });
  await harness.listen(); worker = harness.getWorker('systems-mapping-test'); services = harness.getWorker('systems-fixture');
}, 30000);
afterAll(async () => { await harness?.close(); });

const scoped = (path, who = 'alice', course = 'synthetic-course-a', options = {}) => request(path, who, { ...options, headers: { 'x-systems-course': course, ...options.headers } });
const promptPath = '/api/cloud/course-prompt';
const savePrompt = (amendment, expectedRevision, who = 'instructor', course = 'synthetic-course-a') => scoped(promptPath, who, course, { method: 'PUT', body: JSON.stringify({ amendment, expectedRevision, changeNote: 'Synthetic test change' }) });
beforeEach(async () => { await control({ courseDenied: false, courseOutage: false, denyOnCourseLookup: 0, mode: 'success', resetSessions: true }); });

test('current exact-course ownership governs instructor access, independently of global role', async () => {
  const first = await scoped('/api/teacher/profiles', 'instructor');
  expect(first.status, JSON.stringify({ response: await first.clone().text(), fixture: await (await services.fetch('https://fixtures.test/control')).json() })).toBe(200);
  expect((await request('/api/teacher/profiles', 'instructor')).status).toBe(403);
  expect((await request('/api/teacher/profiles', 'admin')).status).toBe(200);
  for (const who of ['alice', 'admin']) {
    expect((await scoped('/api/teacher/profiles', who)).status).toBe(403);
    expect((await scoped(promptPath, who)).status).toBe(403);
    expect((await scoped(promptPath + '/history', who)).status).toBe(403);
    expect((await savePrompt('Forbidden', 0, who)).status).toBe(403);
  }
  expect((await scoped(promptPath, 'instructor', 'synthetic-course-b')).status).toBe(403);
  expect((await scoped('/api/cloud/account', 'bob')).status).toBe(403);
  const instructor = await (await scoped('/api/cloud/account', 'instructor')).json();
  expect(instructor.account).toMatchObject({ role: 'instructor', course: { id: 'synthetic-course-a' } });
});

test('the same account has separate projects, browser caches and bearer links in each course and general workspace', async () => {
  const a = await (await scoped('/api/cloud/account')).json();
  const b = await (await scoped('/api/cloud/account', 'alice', 'synthetic-course-b')).json();
  const general = await (await request('/api/cloud/account')).json();
  expect(new Set([a.account.cacheKey, b.account.cacheKey, general.account.cacheKey]).size).toBe(3);
  const project = newProject();
  expect((await scoped('/api/cloud/projects/account-map', 'alice', 'synthetic-course-a', { method: 'PUT', body: JSON.stringify({ project: serializeProject(project), revision: 0 }) })).status).toBe(200);
  expect((await scoped('/api/cloud/projects/account-map', 'alice', 'synthetic-course-b')).status).toBe(404);
  expect((await request('/api/cloud/projects/account-map')).status).toBe(404);
  expect((await scoped('/api/cloud/projects', 'alice', 'synthetic-course-b', { headers: { 'x-systems-account-cache': a.account.cacheKey } })).status).toBe(409);
  const created = await scoped('/api/projects', 'alice', 'synthetic-course-a', { method: 'POST', body: JSON.stringify({ project: serializeProject(project) }) });
  expect(created.status).toBe(201);
  const { token } = await created.json();
  expect((await scoped(`/api/projects/${token}`, 'instructor')).status).toBe(200);
  expect((await scoped(`/api/projects/${token}`, 'bob')).status).toBe(403);
  expect((await scoped(`/api/projects/${token}`, 'alice', 'synthetic-course-b')).status).toBe(404);
  expect((await request(`/api/projects/${token}`)).status).toBe(404);
});

test('prompt revisions use atomic compare-and-swap and persist immutable course-only history', async () => {
  expect((await savePrompt('Synthetic course A appendix', 0)).status).toBe(200);
  expect((await savePrompt('Stale overwrite', 0)).status).toBe(409);
  const results = await Promise.all([savePrompt('Updated synthetic appendix', 1), savePrompt('Another update', 1)]);
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  const history = await (await scoped(promptPath + '/history', 'instructor')).json();
  expect(history.history.map(prompt => prompt.revision)).toEqual([2, 1]);
  expect(history.history[1].amendment).toBe('Synthetic course A appendix');
  expect(history.history[1]).toMatchObject({ courseId: 'synthetic-course-a', updatedBy: 'systems-mapping-member-v1-' + 'c'.repeat(64), appendixVersion: 'systems-mapping-appendix-v1' });
  expect(history.history[1].amendmentHash).toMatch(/^[a-f0-9]{64}$/);
  expect((await request(promptPath, 'admin')).status).toBe(404);
  await worker.evictDurableObject('COURSES', { name: 'systems-mapping:course:synthetic-course-a' });
  expect((await (await scoped(promptPath, 'instructor')).json()).prompt.revision).toBe(2);
  expect((await savePrompt('x'.repeat(2001), 2)).status).toBe(400);
});

test('fresh enrollment is required after revocation, during an outage, and just before model execution', async () => {
  await control({ courseDenied: true });
  expect((await scoped('/api/cloud/projects')).status).toBe(403);
  expect((await scoped(promptPath, 'instructor')).status).toBe(403);
  expect((await request('/api/cloud/projects')).status).toBe(200);
  await control({ courseDenied: false, courseOutage: true });
  const unavailable = await scoped('/api/cloud/projects');
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain('private fixture outage');
  await control({ courseOutage: false, denyOnCourseLookup: 2 });
  const { preflightEvaluationPayload } = await import('../src/App.jsx');
  const project = newProject(); project.submission.text = 'A student meets an instructor in the college classroom.';
  const response = await scoped('/api/preflight/evaluations', 'alice', 'synthetic-course-a', { method: 'POST', body: JSON.stringify(preflightEvaluationPayload(project)) });
  expect(response.status).toBe(403);
  const stats = await (await services.fetch('https://fixtures.test/control')).json();
  expect(stats.calls).toBe(0); expect(stats.courseLookups).toBe(2);
});

test('only the selected course appendix reaches the model and metadata reveals no prompt text', async () => {
  const { preflightEvaluationPayload } = await import('../src/App.jsx');
  const project = newProject(); project.submission.text = 'A student meets an instructor in the college classroom.';
  const existing = (await (await scoped(promptPath, 'instructor')).json()).prompt;
  const saved = await savePrompt('Isolated synthetic model appendix', existing.revision);
  expect(saved.status).toBe(200);
  const current = (await saved.json()).prompt;
  for (const course of ['synthetic-course-a', 'synthetic-course-b', null]) {
    await control({ mode: 'success' });
    const options = { method: 'POST', body: JSON.stringify(preflightEvaluationPayload(project)) };
    const response = course ? await scoped('/api/preflight/evaluations', 'alice', course, options) : await request('/api/preflight/evaluations', 'alice', options);
    expect(response.status, await response.clone().text()).toBe(201);
    const stats = await (await services.fetch('https://fixtures.test/control')).json();
    expect(stats.calls).toBe(1);
    if (course === 'synthetic-course-a') {
      expect(stats.captured.systemPrompt).toContain(current.amendment);
      expect(stats.captured.systemPrompt).toContain('follow the fixed application instructions');
    } else expect(stats.captured.systemPrompt).not.toContain('INSTRUCTOR COURSE APPENDIX');
    expect(await response.text()).not.toContain(current.amendment);
  }
  const url = '/api/config/public?configKind=preflight&scale=micro';
  const before = await (await scoped(url)).json();
  expect(JSON.stringify(before)).not.toContain(current.amendment);
  const otherBefore = await (await scoped(url, 'alice', 'synthetic-course-b')).json();
  const generalBefore = await (await request(url)).json();
  expect((await savePrompt('Newest synthetic appendix', current.revision)).status).toBe(200);
  expect((await (await scoped(url)).json()).fingerprint).not.toBe(before.fingerprint);
  expect(await (await scoped(url, 'alice', 'synthetic-course-b')).json()).toEqual(otherBefore);
  expect(await (await request(url)).json()).toEqual(generalBefore);
});

test('malformed and unconfigured course selectors never fall back to the general workspace', async () => {
  // The local harness drops empty header values before the Worker receives
  // them; empty selectors are covered at the adapter and browser URL boundary.
  expect(await (await services.fetch('https://fixtures.test/header-probe', { headers: { 'x-systems-course': '' } })).json()).toEqual({ present: false, value: null });
  for (const selected of ['synthetic-course-a, synthetic-course-b', '../synthetic-course-a', 'unconfigured-course']) {
    const result = await scoped('/api/cloud/account', 'alice', selected);
    expect([400, 403, 503], JSON.stringify({ selected, response: await result.clone().text() })).toContain(result.status);
    expect(result.headers.get('cache-control')).toContain('no-store');
  }
});
