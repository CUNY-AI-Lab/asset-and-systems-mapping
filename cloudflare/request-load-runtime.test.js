// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';

const ORIGIN = 'https://systems-mapping.ailab-452.workers.dev';
let harness, worker;
const account = who => worker.fetch(ORIGIN + '/api/cloud/account', {
  headers: { 'cf-connecting-ip': '203.0.113.10', ...(who ? { cookie: `__Host-systems-mapping-session=${who}` } : {}) },
});

beforeAll(async () => {
  const issuer = await createTestIdentityIssuer();
  const tokens = {};
  for (const [name, subject] of [['alice', TEST_SUBJECTS.alice], ['bob', TEST_SUBJECTS.bob], ['admin', 'cail-33333333333333333333333333333333']]) {
    tokens[name] = { subject,
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
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '9876524', simple: { limit: 2, period: 60 } }],
  } }, { config: { name: 'systems-load-fixture', main: 'cloudflare/test-services.ts', compatibility_date: '2026-09-08', vars: { TEST_TOKENS: JSON.stringify(tokens) } } }] });
  await harness.listen();
  worker = harness.getWorker('systems-load-test');
}, 30000);
afterAll(async () => { await harness?.close(); });

test('the real Worker preserves independent account limits on a shared campus IP', async () => {
  expect((await account('alice')).status).toBe(200);
  expect((await account('alice')).status).toBe(200);
  const limited = await account('alice');
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).toBe('60');
  expect((await limited.json()).details.retryAfterSeconds).toBe(60);
  expect((await account('bob')).status).toBe(200);
  expect((await account('bob')).status).toBe(200);
});

test('anonymous traffic remains limited without spending a signed-in account allowance', async () => {
  expect((await account()).status).toBe(401);
  expect((await account()).status).toBe(401);
  expect((await account()).status).toBe(429);
  expect((await account('admin')).status).toBe(200);
});
