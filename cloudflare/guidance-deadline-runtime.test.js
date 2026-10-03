// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';

const ORIGIN = 'https://systems-mapping.ailab-452.workers.dev';
const REQUEST_ID = '01900000-0000-7000-8000-000000000071';
let harness, worker;
const request = (path, options = {}) => worker.fetch(ORIGIN + path, { ...options, headers: {
  cookie: '__Host-systems-mapping-session=alice', origin: ORIGIN, 'content-type': 'application/json',
  ...(options.headers || {}),
} });

beforeAll(async () => {
  const issuer = await createTestIdentityIssuer();
  const subject = TEST_SUBJECTS.alice;
  const tokens = { alice: { subject,
    appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject }),
    gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }),
  }, admin: { subject: 'cail-33333333333333333333333333333333' } };
  harness = createTestHarness({ workers: [{ config: {
    name: 'systems-guidance-deadline-test', main: 'cloudflare/test-guidance-deadline.ts', compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    vars: { PUBLIC_ORIGIN: ORIGIN, LOGIN_URL: '/auth/start', COURSE_ID: 'deadline-test-course', RELEASE: 'deadline-test', GATEWAY_MODEL: 'glm-5.3-flash', GUIDANCE_CONCURRENCY: '8', CAIL_IDENTITY_JWKS: issuer.jwksJson },
    durable_objects: { bindings: [{ name: 'COURSES', class_name: 'StalledCourse' }] },
    exports: { StalledCourse: { type: 'durable-object', storage: 'sqlite' } },
    services: [{ binding: 'IDENTITY', service: 'systems-deadline-fixture', entrypoint: 'Identity' }, { binding: 'ADMISSION_RESOLVER', service: 'systems-deadline-fixture', entrypoint: 'Admission' }, { binding: 'GATEWAY', service: 'systems-deadline-fixture' }],
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '9876525', simple: { limit: 60, period: 60 } }],
  } }, { config: { name: 'systems-deadline-fixture', main: 'cloudflare/test-services.ts', compatibility_date: '2026-09-08', vars: { TEST_TOKENS: JSON.stringify(tokens) } } }] });
  await harness.listen();
  worker = harness.getWorker('systems-guidance-deadline-test');
  expect((await request('/api/cloud/account')).status).toBe(200);
}, 30000);
afterAll(async () => { await harness?.close(); });

test('a stalled course RPC returns a safe504 while its work remains independently in flight', async () => {
  const start = Date.now();
  const response = await request('/api/preflight/evaluations', { method: 'POST', body: '{}', headers: { 'x-request-id': REQUEST_ID } });
  expect(response.status).toBe(504);
  expect(Date.now() - start).toBeLessThan(1500);
  expect(response.headers.get('x-request-id')).toBe(REQUEST_ID);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.has('retry-after')).toBe(false);
  expect(await response.json()).toEqual({ error: 'Guidance took too long', details: { code: 'guidance_timeout', shouldRetry: false } });
  const inFlight = await request('/api/cloud/account');
  expect(inFlight.status).toBe(200);
  expect(await inFlight.json()).toEqual({ started: 1, completed: 0 });
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(await (await request('/api/cloud/account')).json()).toEqual({ started: 1, completed: 1 });
});

test('the ordinary project API is not shortened by the guidance-only deadline', async () => {
  const start = Date.now();
  const response = await request('/api/cloud/projects', { method: 'POST', body: '{}' });
  expect(response.status).toBe(200);
  expect(Date.now() - start).toBeGreaterThanOrEqual(900);
  expect(await response.json()).toEqual({ result: 'late' });
});
