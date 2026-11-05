// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { RedmineReports, reportDelivery, reportFallback, reportsEnabled } from './redmine-reports';
import { readFileSync } from 'node:fs';
let db: DatabaseSync;
afterEach(() => { if (db?.isOpen) db.close(); vi.unstubAllGlobals(); });
function setup(env: Record<string, unknown> = {}) {
  db = new DatabaseSync(':memory:');
  const posts: any[] = [];
  const fetch = vi.fn(async (_url: unknown, options: any) => {
    expect(options.redirect).toBe('manual');
    expect(options.headers.get('X-Redmine-API-Key')).toBe('fixture-key');
    posts.push(JSON.parse(options.body));
    return Response.json({ issue: { id: 123 } }, { status: 201 });
  });
  vi.stubGlobal('fetch', fetch);
  const storage = { transactionSync: (fn: () => unknown) => fn(), sync: async () => {} };
  const runtimeEnv = { REDMINE_API_KEY: 'fixture-key', RELEASE: 'fixture', PUBLIC_ORIGIN: 'https://systems.test', ...env };
  const reports = new RedmineReports(db as any, storage as any, runtimeEnv);
  const request = (body: any, guest = false) => new Request('https://systems.test/api/bug-reports' + (guest ? '/guest' : ''), { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.5' }, body: JSON.stringify(body) });
  return { reports, posts, request, fetch, storage, runtimeEnv };
}
const storedReceipt = () => db.prepare(`SELECT r.state,r.issue_id,COALESCE(d.delivery,'redmine') AS delivery,COALESCE(d.fallback_safe,0) AS fallback_safe FROM bug_reports r LEFT JOIN bug_report_delivery d ON d.kind='bug_reports' AND d.owner=r.owner AND d.report_id=r.report_id WHERE r.owner=? AND r.report_id=?`).get(body.expectedActor, body.reportId);
const body = { reportId: '11111111-1111-4111-8111-111111111111', expectedActor: 'a'.repeat(64), description: 'Synthetic student report only.', path: '/' };
test('private SSO reports preserve the verified name and create only one ticket', async () => {
  const { reports, request, posts } = setup();
  expect((await reports.request(request({ ...body, expectedActor: 'b'.repeat(64) }), body.expectedActor, 'Sam Student')).status).toBe(409);
  expect(posts).toHaveLength(0);
  expect((await reports.request(request(body), body.expectedActor, 'Sam Student')).status).toBe(200);
  expect((await reports.request(request(body), body.expectedActor, 'Sam Student')).status).toBe(200);
  expect(posts).toHaveLength(1);
  expect(posts[0].issue).toMatchObject({ project_id: 15, tracker_id: 2, is_private: true });
  expect(posts[0].issue.description).toContain('SSO preferred name: Sam Student');
  expect(db.prepare('SELECT state,issue_id FROM bug_reports').get()).toEqual({ state: 'saved', issue_id: 123 });
});
test('guest validation is enforced by the server and contacts are labeled unverified', async () => {
  const { reports, request, posts } = setup();
  const { expectedActor: _, ...data } = body;
  const guest = { ...data, firstName: 'Sample', lastName: 'Student', email: 'sample@example.com' };
  expect((await reports.request(request(guest, true), null, null, 'b'.repeat(64))).status).toBe(400);
  expect(posts).toHaveLength(0); guest.email = 'sample@college.edu';
  expect((await reports.request(request(guest, true), null, null, 'b'.repeat(64))).status).toBe(200);
  expect(posts[0].issue.description).toContain('Contact email (unverified): sample@college.edu');
  expect(posts[0].issue.is_private).toBe(true);
});

function emailService() {
  const accepted = new Map<string, string>();
  const submitPublic = vi.fn(async (input: any) => {
    const previous = accepted.get(input.reportId);
    if (previous && previous !== input.description) return { ok: false as const, code: 'idempotency_conflict' as const, retryable: false };
    accepted.set(input.reportId, input.description);
    return { ok: true as const, status: 'accepted' as const, reportId: input.reportId };
  });
  return { submitPublic, accepted };
}

test('an earlier email preference uses one durable email receipt after switching to Redmine', async () => {
  const service = emailService();
  const { reports, request, fetch, storage, runtimeEnv } = setup({ BUG_REPORT_MODE: 'email', BUG_REPORTS: service });
  const first = await (await reports.request(request(body), body.expectedActor, 'Sam Student')).json();
  expect(first).toMatchObject({ ok: true, status: 'accepted', delivery: 'email', reportId: body.reportId });
  expect(first.deliveryReference).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(service.submitPublic.mock.calls[0][0]).toMatchObject({ reportId: first.deliveryReference, description: body.description, path: '/', release: 'fixture' });
  expect(Object.keys(service.submitPublic.mock.calls[0][0]).sort()).toEqual(['description', 'origin', 'path', 'rateDay', 'rateKey', 'release', 'reportId']);
  expect(JSON.stringify(service.submitPublic.mock.calls)).not.toContain('Sam Student');
  expect(JSON.stringify(service.submitPublic.mock.calls)).not.toContain('192.0.2.5');
  const restarted = new RedmineReports(db as any, storage as any, { ...runtimeEnv, BUG_REPORT_MODE: 'redmine', REDMINE_API_KEY: 'fixture-key' });
  expect(await (await restarted.request(request(body), body.expectedActor)).json()).toEqual(first);
  expect(fetch).not.toHaveBeenCalled();
  expect(service.submitPublic).toHaveBeenCalledTimes(1);
  expect(storedReceipt()).toMatchObject({ state: 'saved', delivery: 'email', issue_id: null });
});

test('both release configurations explicitly choose direct Redmine ticketing', () => {
  for (const path of ['../wrangler.jsonc', '../wrangler.dev.jsonc']) {
    expect(readFileSync(new URL(path, import.meta.url), 'utf8')).toMatch(/"BUG_REPORT_MODE"\s*:\s*"redmine"/);
  }
});

test('explicit Redmine without its key fails closed even when an email binding exists', async () => {
  const service = emailService();
  const { reports, request, fetch, runtimeEnv } = setup({ BUG_REPORT_MODE: 'redmine', REDMINE_API_KEY: undefined, BUG_REPORTS: service });
  expect(reportDelivery(runtimeEnv)).toBe('redmine');
  expect(reportFallback(runtimeEnv)).toBeNull();
  expect(reportsEnabled(runtimeEnv)).toBe(false);
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
  expect(service.submitPublic).not.toHaveBeenCalled();
  expect(db.prepare('SELECT count(*) AS count FROM bug_reports').get()).toEqual({ count: 0 });
});

test('explicit Redmine routes a feature request privately without an email dispatch', async () => {
  const service = emailService();
  const { reports, request, posts, runtimeEnv } = setup({ BUG_REPORT_MODE: 'redmine', BUG_REPORTS: service });
  const feature = { ...body, description: 'Please add keyboard shortcuts for switching notebook views.' };
  expect(reportFallback(runtimeEnv)).toBeNull();
  expect(await (await reports.request(request(feature), body.expectedActor)).json()).toMatchObject({ ok: true, status: 'saved', delivery: 'redmine' });
  expect(posts).toHaveLength(1);
  expect(posts[0].issue).toMatchObject({ project_id: 15, tracker_id: 2, is_private: true });
  expect(posts[0].issue.description).toContain(feature.description);
  expect(service.submitPublic).not.toHaveBeenCalled();
});

test.each([400, 401, 403, 404, 422, 429])('explicit Redmine rejection %i never changes delivery to email', async status => {
  const service = emailService();
  const { reports, request, fetch } = setup({ BUG_REPORT_MODE: 'redmine', BUG_REPORTS: service });
  fetch.mockImplementation(async () => Response.json({ error: 'Synthetic rejection' }, { status }));
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(status === 429 ? 429 : 502);
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(status === 429 ? 429 : 502);
  expect(storedReceipt()).toMatchObject({ delivery: 'redmine', state: status === 429 ? 'retryable' : 'rejected' });
  expect(service.submitPublic).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(status === 429 ? 2 : 1);
});

test.each([400, 401, 403, 404, 422, 429])('definitive Redmine rejection %i falls back once with the same email reference', async status => {
  const service = emailService();
  const { reports, request, fetch } = setup({ BUG_REPORTS: service });
  fetch.mockImplementation(async () => Response.json({ error: 'Synthetic rejection' }, { status }));
  const first = await (await reports.request(request(body), body.expectedActor)).json();
  expect(first).toMatchObject({ status: 'accepted', delivery: 'email' });
  expect(await (await reports.request(request(body), body.expectedActor)).json()).toEqual(first);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(service.submitPublic).toHaveBeenCalledTimes(1);
});

test.each([301, 302, 307, 308, 408, 500, 502, 503])('uncertain Redmine response %i stays pending and uses lookup instead of another channel', async status => {
  const service = emailService();
  const { reports, request, fetch, storage, runtimeEnv } = setup({ BUG_REPORTS: service });
  fetch.mockImplementationOnce(async () => Response.json({ error: 'Synthetic uncertain response' }, { status }));
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(503);
  const restarted = new RedmineReports(db as any, storage as any, { ...runtimeEnv, BUG_REPORT_MODE: 'email' });
  fetch.mockImplementationOnce(async () => Response.json({ issues: [{ id: 456, subject: `System Mapping bug report [sm-report:${body.expectedActor.slice(0,16)}:${body.reportId}]` }], total_count: 1 }));
  expect(await (await restarted.request(request(body), body.expectedActor)).json()).toMatchObject({ status: 'saved', delivery: 'redmine' });
  expect(fetch.mock.calls[0][1].method).toBe('POST');
  expect(fetch.mock.calls[1][1].method).toBeUndefined();
  expect(service.submitPublic).not.toHaveBeenCalled();
});

test('lost Redmine acknowledgement and unreadable success never dispatch email', async () => {
  const service = emailService();
  const { reports, request, fetch } = setup({ BUG_REPORTS: service });
  fetch.mockRejectedValueOnce(new Error('Synthetic lost acknowledgement'));
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(503);
  fetch.mockImplementationOnce(async () => Response.json({ issues: [], total_count: 0 }));
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(503);
  fetch.mockImplementationOnce(async () => new Response('Unparseable success', { status: 201 }));
  expect((await reports.request(request({ ...body, reportId: '22222222-2222-4222-8222-222222222222' }), body.expectedActor)).status).toBe(503);
  expect(service.submitPublic).not.toHaveBeenCalled();
});

test('a timed-out Redmine request remains pending after its bounded deadline', async () => {
  const service = emailService();
  const { reports, request, fetch } = setup({ BUG_REPORTS: service });
  fetch.mockImplementation(() => new Promise(() => {}));
  vi.useFakeTimers();
  try {
    const pending = reports.request(request(body), body.expectedActor);
    await vi.advanceTimersByTimeAsync(18_001);
    expect((await pending).status).toBe(503);
    expect(service.submitPublic).not.toHaveBeenCalled();
    expect(storedReceipt()).toMatchObject({ state: 'pending', delivery: 'redmine' });
  } finally { vi.useRealTimers(); }
});

test('lost email acknowledgement survives restart and checks the same upstream receipt', async () => {
  const service = emailService();
  const original = service.submitPublic.getMockImplementation()!;
  service.submitPublic.mockImplementationOnce(async input => {
    await original(input);
    throw new Error('Synthetic acknowledgement loss after acceptance');
  });
  const { reports, request, fetch, storage, runtimeEnv } = setup({ BUG_REPORT_MODE: 'email', BUG_REPORTS: service });
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(503);
  expect(service.accepted.size).toBe(1);
  const restarted = new RedmineReports(db as any, storage as any, { ...runtimeEnv, BUG_REPORT_MODE: 'redmine' });
  const receipt = await (await restarted.request(request(body), body.expectedActor)).json();
  expect(receipt).toMatchObject({ status: 'accepted', delivery: 'email' });
  expect(service.submitPublic.mock.calls[0][0].reportId).toBe(service.submitPublic.mock.calls[1][0].reportId);
  expect(service.accepted.size).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
  expect((await restarted.request(request({ ...body, description: 'Changed report text for this same reference.' }), body.expectedActor)).status).toBe(409);
  expect(service.submitPublic).toHaveBeenCalledTimes(2);
});

test.each(['rate_limited', 'unavailable'])('explicit retryable email refusal %s preserves its reference', async code => {
  const service = emailService();
  service.submitPublic.mockResolvedValueOnce({ ok: false, code, retryable: true, retryAfterSeconds: 60 } as any);
  const { reports, request } = setup({ BUG_REPORT_MODE: 'email', BUG_REPORTS: service });
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(code === 'rate_limited' ? 429 : 503);
  expect(storedReceipt()).toMatchObject({ state: 'retryable', delivery: 'email' });
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(200);
  expect(service.submitPublic.mock.calls[0][0].reportId).toBe(service.submitPublic.mock.calls[1][0].reportId);
});

test('contact and identity validation still precedes fallback and email preserves all 4000 description characters', async () => {
  const service = emailService();
  const { reports, request } = setup({ BUG_REPORT_MODE: 'email', BUG_REPORTS: service });
  expect((await reports.request(request({ ...body, expectedActor: 'b'.repeat(64) }), body.expectedActor)).status).toBe(409);
  expect((await reports.request(request(body), null)).status).toBe(403);
  const { expectedActor: _, ...guest } = body;
  expect((await reports.request(request({ ...guest, firstName: 'Sample', lastName: 'Student', email: 'sample@example.com' }, true), null, null, 'b'.repeat(64))).status).toBe(400);
  expect(service.submitPublic).not.toHaveBeenCalled();
  const description = 'Synthetic report. '.padEnd(4000, 'x');
  const accepted = await reports.request(request({ ...guest, description, firstName: 'Sample', lastName: 'Student', email: 'sample@college.edu' }, true), null, null, 'b'.repeat(64));
  expect(accepted.status).toBe(200);
  expect(service.submitPublic.mock.calls[0][0].description).toBe(description);
  expect(JSON.stringify(service.submitPublic.mock.calls)).not.toContain('sample@college.edu');
});

test('migration preserves older rejected receipts without assuming email fallback is safe', async () => {
  const service = emailService();
  const { reports, request, fetch, storage, runtimeEnv } = setup();
  fetch.mockImplementationOnce(async () => Response.json({ error: 'Forbidden' }, { status: 403 }));
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(502);
  // Recreate the old receipt shape, whose rejected state also included redirects.
  db.exec('DELETE FROM bug_report_delivery;');
  expect(db.prepare('PRAGMA table_info(bug_reports)').all().map((column: any) => column.name)).toEqual(['owner', 'report_id', 'fingerprint', 'created_at', 'state', 'issue_id']);
  const restarted = new RedmineReports(db as any, storage as any, { ...runtimeEnv, BUG_REPORT_MODE: 'email', BUG_REPORTS: service });
  expect((await restarted.request(request(body), body.expectedActor)).status).toBe(502);
  expect(storedReceipt()).toMatchObject({ state: 'rejected', delivery: 'redmine', fallback_safe: 0 });
  expect(service.submitPublic).not.toHaveBeenCalled();
});

test('concurrent email requests share one in-flight submission', async () => {
  const service = emailService();
  let finish: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const original = service.submitPublic.getMockImplementation()!;
  service.submitPublic.mockImplementation(async input => { await ready; return original(input); });
  const { reports, request } = setup({ BUG_REPORT_MODE: 'email', BUG_REPORTS: service });
  const first = reports.request(request(body), body.expectedActor);
  await vi.waitFor(() => expect(service.submitPublic).toHaveBeenCalledTimes(1));
  expect((await reports.request(request(body), body.expectedActor)).status).toBe(202);
  finish!();
  expect((await first).status).toBe(200);
  expect(service.submitPublic).toHaveBeenCalledTimes(1);
});
