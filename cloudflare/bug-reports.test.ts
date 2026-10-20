// @vitest-environment node
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleBugReport, normalizeReportPath, reportActor, type BugReportService } from './bug-reports.ts';
const contract = JSON.parse(readFileSync(new URL('./bug-report-v2.json', import.meta.url), 'utf8'));
const { subject, origin, reportId, description, release } = contract.input;
const report = { reportId, description, path: '/p/:shared-map', expectedActor: reportActor(subject) };
const request = (data: unknown = report, headers: Record<string, string> = {}) => new Request(`${origin}/api/bug-reports`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(data),
});
function fixture() {
  const calls: Parameters<BugReportService['submitAuthenticated']>[0][] = [];
  const options = { origin, subject, release, service: { submitAuthenticated: async (input: Parameters<BugReportService['submitAuthenticated']>[0]) => {
    calls.push(input); return contract.saved;
  } } };
  return { options, calls };
}
test('verified subject and deployment metadata replace browser claims and capability paths are removed', async () => {
  const { options, calls } = fixture();
  const token = 'privateProjectBearerToken12345';
  const response = await handleBugReport(request({ ...report, path: `/p/${token}`, description: '\t First line\r\nsecond line  ' }, { cookie: 'private-session', authorization: 'never-forward', 'x-cail-subject': 'forged' }), options);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual(contract.saved);
  expect(calls).toEqual([{ reportId, subject, description: 'First line\nsecond line', origin, path: '/p/:shared-map', release }]);
  expect(JSON.stringify(calls)).not.toMatch(/privateProject|private-session|never-forward|expectedActor/);
});
test('the session marker is opaque and stable but a different account cannot submit the old draft', async () => {
  const { options, calls } = fixture();
  const session = await handleBugReport(new Request(`${origin}/api/bug-reports/session`), options);
  expect(await session.json()).toEqual({ ok: true, expectedActor: report.expectedActor });
  expect(report.expectedActor).toMatch(/^[a-f0-9]{64}$/); expect(report.expectedActor).not.toContain(subject);
  const changed = await handleBugReport(request(), { ...options, subject: 'cail-22222222222222222222222222222222' });
  expect(changed.status).toBe(409); expect(await changed.json()).toEqual({ ok: false, code: 'account_changed', retryable: false });
  expect(calls).toHaveLength(0);
});
test('unknown fields, forged identity, controls, malformed bodies and excess size never reach the receiver', async () => {
  const { options, calls } = fixture();
  for (const data of [null, [], { ...report, subject }, { ...report, name: 'Name' }, { ...report, email: 'x@example.edu' },
    { ...report, app: 'stem-splitter' }, { ...report, release: 'forged' }, { ...report, createdAt: '2026-01-01' },
    { ...report, expectedActor: subject }, { ...report, reportId: 'invalid' }, { ...report, description: 'short' },
    { ...report, description: 'a'.repeat(4001) }, { ...report, description: 'before\u0000after' }]) {
    expect((await handleBugReport(request(data), options)).status).toBe(400);
  }
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(17000))); controller.close(); } });
  expect((await handleBugReport(new Request(`${origin}/api/bug-reports`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit), options)).status).toBe(400);
  expect(calls).toHaveLength(0);
});
test('routes omit queries, fragments and identifiers instead of accepting arbitrary URLs', async () => {
  const { options, calls } = fixture();
  for (const path of ['/teacher', '/student', '/p/private-token?secret=yes', '/?course=private', '/#secret', 'https://foreign.example/', '/api/projects/private', '//foreign.example', '/p/%61'.repeat(20)]) {
    expect(normalizeReportPath(path)).toBeNull(); expect((await handleBugReport(request({ ...report, path }), options)).status).toBe(400);
  }
  expect(normalizeReportPath('/p/' + 'a'.repeat(32) + '/')).toBe('/p/:shared-map');
  expect(calls).toHaveLength(0);
});
test('same-origin JSON POST and same-origin session reads retain method and CSRF boundaries', async () => {
  const { options, calls } = fixture();
  for (const headers of [{ origin: '' }, { origin: 'null' }, { origin: 'https://foreign.example' }, { 'sec-fetch-site': 'cross-site' }, { referer: 'https://foreign.example/private' }]) {
    expect((await handleBugReport(request(report, headers), options)).status).toBe(403);
  }
  expect((await handleBugReport(new Request(`${origin}/api/bug-reports/session`, { headers: { 'sec-fetch-site': 'cross-site' } }), options)).status).toBe(403);
  for (const suppliedOrigin of ['https://foreign.example', 'null', '']) {
    expect((await handleBugReport(new Request(`${origin}/api/bug-reports/session`, { headers: { origin: suppliedOrigin } }), options)).status).toBe(403);
  }
  const method = await handleBugReport(new Request(`${origin}/api/bug-reports`), options);
  expect(method.status).toBe(405); expect(method.headers.get('allow')).toBe('POST');
  expect((await handleBugReport(request(report, { 'content-type': 'text/plain' }), options)).status).toBe(400);
  expect(calls).toHaveLength(0);
});
test('missing capability or invalid release fails closed without forwarding', async () => {
  const { options, calls } = fixture();
  expect((await handleBugReport(request(), { ...options, service: undefined })).status).toBe(503);
  for (const release of [undefined, 123, '', 'forged\nheader', 'a'.repeat(81)]) expect((await handleBugReport(request(), { ...options, release: release as string })).status).toBe(503);
  expect(calls).toHaveLength(0);
});
test('lost acknowledgement and malformed success become explicit same-ID retry without service details', async () => {
  const { options } = fixture();
  for (const service of [
    { submitAuthenticated: async () => { throw new Error('private storage details'); } },
    { submitAuthenticated: async () => ({ ...contract.saved, reportId: crypto.randomUUID() }) },
    { submitAuthenticated: async () => ({ ...contract.saved, status: 'accepted' }) },
    { submitAuthenticated: async () => ({ ...contract.saved, createdAt: 'not-a-date' }) },
  ]) {
    const response = await handleBugReport(request(), { ...options, service: service as BugReportService });
    expect(response.status).toBe(503); expect(await response.json()).toEqual(contract.unavailable);
  }
});
test('only typed failure fields and bounded retry delays reach the browser', async () => {
  const { options } = fixture();
  for (const [code, status] of [['not_admitted', 403], ['rate_limited', 429], ['unavailable', 503], ['idempotency_conflict', 409]] as const) {
    const response = await handleBugReport(request(), { ...options, service: { submitAuthenticated: async () => ({ ok: false, code, retryable: true, retryAfterSeconds: 60, private: 'must disappear' }) } });
    expect(response.status).toBe(status); expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toEqual({ ok: false, code, retryable: true, retryAfterSeconds: 60 });
  }
});
test('an already-cancelled submission never starts the report RPC', async () => {
  const { options, calls } = fixture(); const controller = new AbortController(); controller.abort();
  await handleBugReport(new Request(request(), { signal: controller.signal }), options);
  expect(calls).toHaveLength(0);
});
