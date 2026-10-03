// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { createDefaultProject } from '../src/domain.js';
import { preflightEvaluationPayload } from '../src/App.jsx';

const ORIGIN = 'https://systems-mapping.ailab-452.workers.dev';
let harness, worker, services;
const request = (path, options = {}) => worker.fetch(ORIGIN + path, { ...options, headers: {
  cookie: '__Host-systems-mapping-session=alice', origin: ORIGIN, 'content-type': 'application/json',
  ...(options.headers || {}),
} });
const control = mode => services.fetch('https://fixtures.test/control', { method: 'POST', body: JSON.stringify({ mode }) });

beforeAll(async () => {
  const issuer = await createTestIdentityIssuer();
  const subject = TEST_SUBJECTS.alice;
  const tokens = { alice: { subject,
    appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject }),
    gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }),
  }, admin: { subject: TEST_SUBJECTS.bob } };
  harness = createTestHarness({ workers: [{ config: {
    name: 'systems-model-deadline-test', main: 'cloudflare/test-model-deadline.ts', compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'],
    vars: { PUBLIC_ORIGIN: ORIGIN, LOGIN_URL: '/auth/start', COURSE_ID: 'model-deadline-course', RELEASE: 'deadline-test', GATEWAY_MODEL: 'glm-5.3-flash', GUIDANCE_CONCURRENCY: '8', CAIL_IDENTITY_JWKS: issuer.jwksJson },
    durable_objects: { bindings: [{ name: 'COURSES', class_name: 'MappingCourse' }] },
    exports: { MappingCourse: { type: 'durable-object', storage: 'sqlite' } },
    services: [{ binding: 'IDENTITY', service: 'model-deadline-fixture', entrypoint: 'Identity' }, { binding: 'ADMISSION_RESOLVER', service: 'model-deadline-fixture', entrypoint: 'Admission' }, { binding: 'GATEWAY', service: 'model-deadline-fixture' }],
    ratelimits: [{ name: 'REQUEST_LIMIT', namespace_id: '9876526', simple: { limit: 60, period: 60 } }],
  } }, { config: { name: 'model-deadline-fixture', main: 'cloudflare/test-services.ts', compatibility_date: '2026-09-08', vars: { TEST_TOKENS: JSON.stringify(tokens) } } }] });
  await harness.listen();
  worker = harness.getWorker('systems-model-deadline-test');
  services = harness.getWorker('model-deadline-fixture');
  expect((await request('/api/cloud/account')).status).toBe(200);
}, 30000);
afterAll(async () => { await harness?.close(); });

test('deadline crosses the real course RPC, releases the permit, and never saves the late response', async () => {
  const project = createDefaultProject();
  project.submission.text = 'A student meets an instructor in a college classroom.';
  const generate = () => request('/api/preflight/evaluations', { method: 'POST', body: JSON.stringify(preflightEvaluationPayload(project)) });
  await control('stall');
  const start = Date.now();
  const response = await generate();
  expect(response.status).toBe(504);
  expect(Date.now() - start).toBeLessThan(2000);
  expect((await response.json()).details.code).toBe('guidance_timeout');
  await control('success');
  const retry = await generate();
  expect(retry.status).toBe(201);
  const accepted = (await retry.json()).evaluation.id;
  await new Promise(resolve => setTimeout(resolve, 4000));
  const storage = await worker.getDurableObjectStorage('COURSES', { name: 'model-deadline-course' });
  expect(await storage.exec('SELECT id FROM preflight_evaluations')).toEqual([{ id: accepted }]);
}, 10000);
