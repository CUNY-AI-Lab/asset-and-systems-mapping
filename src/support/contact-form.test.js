// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { mountBugReport } from './contact-form.js';
import { parseGuestContact } from './contact.js';
let dispose;
afterEach(() => { dispose?.(); dispose = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });
function setup(signedIn = false) {
  let actor = 'a'.repeat(64);
  const posts = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (!options.method) return Response.json(signedIn ? { ok: true, expectedActor: actor, preferredName: 'Sam Student' } : { ok: false }, { status: signedIn ? 200 : 401 });
    const data = JSON.parse(options.body); posts.push({ url, data });
    return Response.json({ ok: true, status: 'saved', reportId: data.reportId, createdAt: new Date().toISOString() });
  }));
  const host = document.createElement('section'); document.body.append(host);
  dispose = mountBugReport(host, { loginUrl: '/auth/start', loginClassName: 'button studio-action', path: () => '/' });
  host.querySelector('.bug-report__trigger').click();
  return { host, posts, setActor: value => { actor = value; } };
}
function fill(host, name, value) {
  const input = host.querySelector(`[name="${name}"]`); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
}
const submit = host => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
test('recognizes SSO automatically and sends only the server comparison marker', async () => {
  const { host, posts } = setup(true);
  await vi.waitFor(() => expect(host.textContent).toContain('Reporting as Sam Student'));
  expect(host.querySelector('.bug-report__session').hidden).toBe(true);
  fill(host, 'description', 'The student map could not be saved.'); submit(host);
  await vi.waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].url).toBe('/api/bug-reports');
  expect(posts[0].data.expectedActor).toBe('a'.repeat(64));
  expect(posts[0].data).not.toHaveProperty('preferredName');
  await vi.waitFor(() => expect(host.textContent).toContain('Sent. Thank you.'));
});
test('guest details appear above the description and reject non-edu email before sending', async () => {
  const { host, posts } = setup();
  await vi.waitFor(() => expect(host.querySelector('form').getAttribute('aria-busy')).toBe('false'));
  expect(host.querySelector('.bug-report__session').hidden).toBe(false);
  expect(host.querySelector('.bug-report__contact').hidden).toBe(true);
  host.querySelector('.bug-report__guest-toggle').click();
  expect(host.querySelector('.bug-report__contact').hidden).toBe(false);
  expect(host.querySelector('.bug-report__contact').compareDocumentPosition(host.querySelector('textarea')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fill(host, 'firstName', 'Sample'); fill(host, 'lastName', 'Student'); fill(host, 'email', 'sample@example.com');
  fill(host, 'description', 'The student map could not be saved.'); submit(host);
  expect(host.textContent).toContain('Use a valid .edu email address.'); expect(posts).toHaveLength(0);
  fill(host, 'email', 'sample@college.edu'); submit(host);
  await vi.waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ url: '/api/bug-reports/guest', data: { firstName: 'Sample', lastName: 'Student', email: 'sample@college.edu' } });
  expect(host.querySelector('details')).toBeNull();
  expect(host.querySelector('.bug-report__support a').href).toBe('mailto:ailab@gc.cuny.edu');
});
test('a changed SSO account cannot submit the earlier account draft', async () => {
  const { host, posts, setActor } = setup(true);
  await vi.waitFor(() => expect(host.textContent).toContain('Reporting as Sam Student'));
  fill(host, 'description', 'Keep this draft with the original student.');
  setActor('b'.repeat(64)); submit(host);
  await vi.waitFor(() => expect(host.textContent).toContain('original account'));
  expect(posts).toHaveLength(0);
});
test.each(['person@example.com', 'person@college.edu.attacker.test', 'person@.edu', 'person@@college.edu'])('rejects invalid .edu contact %s', email => {
  expect(parseGuestContact({ firstName: 'Sample', lastName: 'Student', email }).ok).toBe(false);
});
