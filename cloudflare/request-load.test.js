// @vitest-environment node
import { expect, test } from 'vitest';
import { apiRateLimitKey } from './request-load.js';

const campusRequest = () => new Request('https://systems-mapping.ailab-452.workers.dev/api/cloud/projects', {
  headers: { 'cf-connecting-ip': '203.0.113.10', 'x-cail-subject': 'forged-account', cookie: 'private-cookie' },
});

test('students behind the same campus network have separate verified request allowances', () => {
  const first = apiRateLimitKey(campusRequest(), 'verified-student-one');
  const second = apiRateLimitKey(campusRequest(), 'verified-student-two');
  expect(first).not.toBe(second);
  expect(first).toBe(apiRateLimitKey(campusRequest(), 'verified-student-one'));
  expect(first).toMatch(/^account:[0-9a-f]{64}$/);
  expect(first).not.toMatch(/student|private|forged|203\.0/);
});

test('anonymous allowances remain IP-bound and cannot be selected with caller identity headers', () => {
  const first = apiRateLimitKey(campusRequest(), null);
  const second = apiRateLimitKey(campusRequest(), undefined);
  expect(first).toBe('anonymous:203.0.113.10');
  expect(first).toBe(second);
  expect(first).not.toBe(apiRateLimitKey(campusRequest(), 'verified-student-one'));
});
