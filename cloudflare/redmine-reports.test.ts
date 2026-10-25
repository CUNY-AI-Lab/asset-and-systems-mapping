// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { RedmineReports } from './redmine-reports';
let db: DatabaseSync;
afterEach(() => { db?.close(); vi.unstubAllGlobals(); });
function setup() {
  db = new DatabaseSync(':memory:');
  const posts: any[] = [];
  const fetch = vi.fn(async (_url: unknown, options: any) => {
    expect(options.redirect).toBe('manual');
    expect(options.headers.get('X-Redmine-API-Key')).toBe('fixture-key');
    posts.push(JSON.parse(options.body));
    return Response.json({ issue: { id: 123 } }, { status: 201 });
  });
  vi.stubGlobal('fetch', fetch);
  const reports = new RedmineReports(db as any, { transactionSync: (fn: () => unknown) => fn() } as any, { REDMINE_API_KEY: 'fixture-key', RELEASE: 'fixture' });
  const request = (body: any, guest = false) => new Request('https://systems.test/api/bug-reports' + (guest ? '/guest' : ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { reports, posts, request };
}
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
