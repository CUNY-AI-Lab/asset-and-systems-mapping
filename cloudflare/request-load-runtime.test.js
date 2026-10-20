// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';

const ORIGIN = 'https://systems-mapping.ailab-452.workers.dev';
const RATE_LIMIT_PERIOD_SECONDS = 60;
const WINDOW_MS = RATE_LIMIT_PERIOD_SECONDS * 1000;
const TEST_TIMEOUT_MS = 5000;
const sessions = Object.fromEntries(['alice', 'bob', 'admin', 'instructor'].map(name => [name, crypto.randomUUID() + '.' + 's'.repeat(43)]));
let harness, worker;
let testWindow;
const account = who => worker.fetch(ORIGIN + '/api/cloud/account', {
  headers: { 'cf-connecting-ip': '203.0.113.10', ...(who ? { cookie: `__Host-systems-mapping-session=${sessions[who] || ''}` } : {}) },
});

beforeAll(async () => {
  const issuer = await createTestIdentityIssuer();
  const tokens = {};
  for (const [name, subject] of [['alice', TEST_SUBJECTS.alice], ['bob', TEST_SUBJECTS.bob], ['admin', 'cail-33333333333333333333333333333333']]) {
    tokens[name] = { subject, sessionToken: sessions[name],
      appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject }),
      gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }),
    };
  }
  harness = createTestHarness({ workers: [{ config: {
    name: 'systems-load-test', main: 'cloudflare/worker.ts', compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    vars: { PUBLIC_ORIGIN: ORIGIN, LOGIN_URL: '/auth/start', COURSE_ID: 'load-test-course', RELEASE: 'load-test', GATEWAY_MODEL: 'glm-5.3-flash', GUIDANCE_CONCURRENCY: '8', CAIL_IDENTITY_JWKS: issuer.jwksJson },
    durable_objects: { bindings: [{ name: 'COURSES', class_name: 'MappingCourse' }] },
    exports: { MappingCourse: { type: 'durable-object', storage: 'sqlite' } },
    services: [{ binding: 'IDENTITY', service: 'systems-load-fixture', entrypoint: 'Identity' }, { binding: 'ADMISSION_RESOLVER', service: 'systems-load-fixture', entrypoint: 'Admission' }, { binding: 'GATEWAY', service: 'systems-load-fixture' }],
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '9876524', simple: { limit: 2, period: RATE_LIMIT_PERIOD_SECONDS } }],
  } }, { config: { name: 'systems-load-fixture', main: 'cloudflare/test-services.ts', compatibility_date: '2026-09-08', vars: { TEST_TOKENS: JSON.stringify(tokens) } } }] });
  await harness.listen();
  worker = harness.getWorker('systems-load-test');
}, 30000);
afterAll(async () => { await harness?.close(); });

beforeEach(async () => {
  testWindow = undefined;
  // Miniflare uses floor(Date.now() / period): counters reset at wall-clock
  // boundaries, not 60 seconds after this test's first request. Keep the entire
  // assertion budget in one window, using the real binding and real clock.
  const remaining = WINDOW_MS - Date.now() % WINDOW_MS;
  if (remaining <= TEST_TIMEOUT_MS + 1000) {
    await new Promise(resolve => setTimeout(resolve, remaining + 100));
  }
  testWindow = Math.floor(Date.now() / WINDOW_MS);
}, 10000);
afterEach(() => {
  if (testWindow !== undefined) {
    expect(Math.floor(Date.now() / WINDOW_MS), 'Rate-limit assertions must stay in the same fixed window').toBe(testWindow);
  }
});

test('the real Worker preserves independent account limits on a shared campus IP', async () => {
  expect((await account('alice')).status).toBe(200);
  expect((await account('alice')).status).toBe(200);
  const limited = await account('alice');
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).toBe('60');
  expect((await limited.json()).details.retryAfterSeconds).toBe(60);
  expect((await account('bob')).status).toBe(200);
  expect((await account('bob')).status).toBe(200);
}, TEST_TIMEOUT_MS);

test('anonymous traffic remains limited without spending a signed-in account allowance', async () => {
  expect((await account()).status).toBe(401);
  expect((await account()).status).toBe(401);
  expect((await account()).status).toBe(429);
  expect((await account('admin')).status).toBe(200);
}, TEST_TIMEOUT_MS);

test('a full shared-IP login bucket cannot block callback recovery or same-origin logout', async () => {
  const request = (path, options = {}) => worker.fetch(ORIGIN + path, {
    redirect: 'manual', ...options,
    headers: { origin: ORIGIN, accept: 'text/html', 'cf-connecting-ip': '203.0.113.12', ...options.headers },
  });
  const start = await request('/auth/start');
  expect(start.status).toBe(303);
  const transaction = start.headers.get('set-cookie').split(';')[0];
  const { state } = JSON.parse(decodeURIComponent(transaction.slice(transaction.indexOf('=') + 1)));
  expect((await request('/auth/start')).status).toBe(303);
  const limited = await request('/auth/start');
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).toBe('60');
  expect(limited.headers.get('content-type')).toContain('text/html');
  expect(limited.headers.get('referrer-policy')).toBe('no-referrer');
  expect(limited.headers.get('content-security-policy')).toContain("default-src 'none'");

  const callback = await request(`/auth/callback?code=${crypto.randomUUID()}&state=${state}`, { headers: { cookie: transaction } });
  expect(callback.status).toBe(303);
  const sessionCookie = callback.headers.get('set-cookie').split(';')[0];
  const stale = await request('/auth/callback?code=expired&state=expired', { headers: { cookie: sessionCookie } });
  expect(stale.status).toBe(303);
  expect(stale.headers.get('location')).toBe('/');
  expect(stale.headers.get('set-cookie')).not.toContain(sessionCookie);

  const signedOut = await request('/auth/logout', { method: 'POST', headers: { cookie: sessionCookie } });
  expect(signedOut.status).toBe(303);
  expect(signedOut.headers.getSetCookie()).toHaveLength(2);
  for (const cleared of signedOut.headers.getSetCookie()) expect(cleared).toContain('Max-Age=0');
  expect((await request('/api/cloud/account', { headers: { cookie: sessionCookie } })).status).toBe(401);
  const wrongMethod = await request('/auth/logout');
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get('allow')).toBe('POST');
}, TEST_TIMEOUT_MS);
