// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { mountBugReport } from './contact-form.js';
import { parseGuestContact } from './contact.js';
let dispose;
afterEach(() => { dispose?.(); dispose = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });
function setup(signedIn = false, response = null, delivery = 'redmine', needsReplyEmail = false) {
  let actor = 'a'.repeat(64);
  const posts = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (!options.method) return Response.json(signedIn ? { ok: true, expectedActor: actor, preferredName: 'Sam Student', needsReplyEmail } : { ok: false }, { status: signedIn ? 200 : 401 });
    const data = JSON.parse(options.body); posts.push({ url, data });
    return response ? response(data, posts.length) : Response.json({ ok: true, status: 'saved', delivery: 'redmine', reportId: data.reportId, createdAt: new Date().toISOString() });
  }));
  const host = document.createElement('section'); document.body.append(host);
  dispose = mountBugReport(host, { delivery, loginUrl: '/auth/start', loginClassName: 'button studio-action', path: () => '/' });
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
  await vi.waitFor(() => expect(host.textContent).toContain('Saved to CAIL Ticketing.'));
});
test('names bugs and feature requests and explains direct private ticketing', async () => {
  const { host } = setup(true);
  await vi.waitFor(() => expect(host.textContent).toContain('Reporting as Sam Student'));
  expect(host.querySelector('h2').textContent).toBe('Report a bug or request a feature');
  expect(host.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Report a bug or request a feature');
  expect(host.querySelector('textarea').labels[0].textContent).toBe('What went wrong? What could be better?');
  expect(host.querySelector('.bug-report__delivery-help').textContent).toBe('Your report is sent directly to CAIL Ticketing as a private ticket.');
  expect(host.querySelector('.bug-report__delivery-help').textContent).not.toMatch(/email|fallback/);
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

test('email acceptance identifies its channel and receipt without claiming inbox delivery', async () => {
  const reference = '22222222-2222-4222-8222-222222222222';
  const { host } = setup(true, data => Response.json({ ok: true, status: 'accepted', delivery: 'email', reportId: data.reportId, deliveryReference: reference, createdAt: new Date().toISOString() }), 'email');
  await vi.waitFor(() => expect(host.textContent).toContain('Reporting as Sam Student'));
  expect(host.querySelector('.bug-report__delivery-help').textContent).toContain('description and page category are sent by email');
  fill(host, 'description', 'The student map could not be saved.'); submit(host);
  await vi.waitFor(() => expect(host.querySelector('.bug-report__status').textContent).toBe(`Accepted for email delivery. Reference: ${reference}.`));
  expect(host.querySelector('textarea').readOnly).toBe(true);
});

test('an uncertain delivery keeps the original draft and reference for the status check', async () => {
  const { host, posts } = setup(true, (data, count) => count === 1
    ? Response.json({ ok: false, code: 'delivery_unknown' }, { status: 503 })
    : Response.json({ ok: true, status: 'accepted', delivery: 'email', reportId: data.reportId, createdAt: new Date().toISOString() }));
  await vi.waitFor(() => expect(host.textContent).toContain('Reporting as Sam Student'));
  fill(host, 'description', 'Keep this report while its email receipt is checked.'); submit(host);
  await vi.waitFor(() => expect(host.querySelector('[type="submit"]').textContent).toBe('Check status'));
  expect(host.querySelector('textarea').readOnly).toBe(true);
  submit(host);
  await vi.waitFor(() => expect(host.querySelector('.bug-report__status').textContent).toContain('Accepted for email delivery.'));
  expect(posts).toHaveLength(2);
  expect(posts[1].data).toEqual(posts[0].data);
});

test('an unknown successful channel remains unconfirmed', async () => {
  const { host } = setup(true, data => Response.json({ ok: true, status: 'saved', delivery: 'unexpected', reportId: data.reportId, createdAt: new Date().toISOString() }));
  await vi.waitFor(() => expect(host.textContent).toContain('Reporting as Sam Student'));
  fill(host, 'description', 'Keep this report until its receipt is confirmed.'); submit(host);
  await vi.waitFor(() => expect(host.querySelector('[type="submit"]').textContent).toBe('Check status'));
});

test('an SSO session without a mailbox can confirm a .edu address with the original receipt', async () => {
  const {host, posts} = setup(true, data => Response.json({ok:true, status:'saved', delivery:'redmine', emailUpdates:'confirm', reportId:data.reportId, createdAt:new Date().toISOString()}), 'redmine', true);
  const email = host.querySelector('[name="replyEmail"]');
  await vi.waitFor(() => expect(email.disabled).toBe(false));
  fill(host, 'description', 'Please restore the missing map label.');
  fill(host, 'replyEmail', 'nope@example.com'); submit(host);
  expect(posts).toHaveLength(0);
  fill(host, 'replyEmail', 'Student@college.edu'); submit(host);
  await vi.waitFor(() => expect(host.textContent).toContain('Check your email to confirm updates.'));
  expect(posts[0].data.replyEmail).toBe('student@college.edu');
  expect(host.textContent).toContain(posts[0].data.reportId);
});
