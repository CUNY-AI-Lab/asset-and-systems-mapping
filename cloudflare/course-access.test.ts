// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { COURSE_APP, CourseAccessError, courseFailure, courseRoster, resolveCourseAccess, validCourseId, type CourseAccessEnv } from './course-access';

// Synthetic fixtures exercise the proposed wire only; they are not live grants.
const now = Date.parse('2026-10-12T18:00:00.000Z');
const subject = `cail-${'a'.repeat(32)}`;
const classId = 'synthetic-course-a';
const iso = (offset: number) => new Date(now + offset).toISOString();
const receipt = (overrides: Record<string, unknown> = {}) => ({
  ok: true, classId, className: 'Synthetic course A', term: 'Fall 2026', section: '01',
  memberId: `systems-mapping-member-v1-${'a'.repeat(64)}`,
  displayName: null, displayNameSource: 'unavailable', participant: true, owner: false,
  startsAt: iso(-60000), checkedAt: iso(0), expiresAt: iso(60000), revision: 1, guestInstructor: false, capabilities: { instructorPanel: Boolean(overrides.owner || overrides.guestInstructor), rosterRead: Boolean(overrides.owner || overrides.guestInstructor), promptRead: Boolean(overrides.owner || overrides.guestInstructor), promptWrite: Boolean(overrides.owner || overrides.guestInstructor) }, ...overrides,
});

function environment(...values: [unknown?]) {
  const value = values.length ? values[0] : receipt();
  const resolve = vi.fn(async () => value);
  const env: CourseAccessEnv = { COURSE_ACCESS_ENABLED: 'true', COURSE_IDS: classId, ADMISSION_RESOLVER: { resolveCourseAccessV2: resolve } };
  return { env, resolve };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

test('fresh exact owner roster accepts verified names and rejects stale or foreign data', async () => {
  const { env } = environment(receipt({ owner: true }));
  const course = await resolveCourseAccess(env, subject, classId);
  const member = { memberId: course.memberId, displayName: 'Alice Student', displayNameSource: 'verified_profile', startsAt: iso(-60000), expiresAt: iso(60000) };
  const page = { ok: true, classId, checkedAt: iso(0), expiresAt: iso(60000), revision: 1, participants: [member], nextCursor: null };
  const roster = vi.fn(async () => page);
  env.ADMISSION_RESOLVER!.listCourseRosterV2 = roster;
  await expect(courseRoster(env, subject, course, undefined)).resolves.toEqual({ participants: [member], nextCursor: null });
  expect(roster).toHaveBeenCalledWith({ subject, app: COURSE_APP, classId, limit: 40 });
  for (const invalid of [
    { ...page, classId: 'other-course' }, { ...page, checkedAt: iso(-30000) },
    { ...page, participants: [member, member] },
    { ...page, participants: [{ ...member, memberId: 'stem-member-v1-' + 'a'.repeat(64) }] },
    { ...page, participants: [{ ...member, displayNameSource: 'email' }] },
  ]) {
    roster.mockResolvedValueOnce(invalid);
    await expect(courseRoster(env, subject, course, undefined)).rejects.toMatchObject({ status: 503 });
  }
  await expect(courseRoster(env, subject, { ...course, owner: false, capabilities: { ...course.capabilities, rosterRead: false } }, undefined)).rejects.toMatchObject({ status: 403 });
});

test('a stalled roster call settles at its deadline', async () => {
  const { env } = environment(receipt({ owner: true }));
  const course = await resolveCourseAccess(env, subject, classId);
  env.ADMISSION_RESOLVER!.listCourseRosterV2 = () => new Promise(() => {});
  const result = expect(courseRoster(env, subject, course, undefined)).rejects.toMatchObject({ status: 503 });
  await vi.advanceTimersByTimeAsync(5000);
  await result;
});

test.each([
  ['a', true], ['a'.repeat(64), true], ['a-b-3', true], ['search', false], ['A', false],
  ['', false], ['a'.repeat(65), false], ['-a', false], ['a-', false], ['a/b', false],
  ['a\n', false], [null, false], [123, false],
])('course ID %j has validity %s', (value, valid) => { expect(validCourseId(value)).toBe(valid); });

test.each([
  { participant: true, owner: false },
  { participant: false, owner: true },
  { participant: true, owner: true },
])('only exact fresh receipt roles authorize access: %j', async roles => {
  const expected = receipt(roles);
  const { env, resolve } = environment(expected);
  const result = await resolveCourseAccess(env, subject, classId);
  expect(result).toEqual(expected);
  expect(result).not.toBe(expected);
  expect(resolve).toHaveBeenCalledExactlyOnceWith({ subject, app: COURSE_APP, classId });
  expect(COURSE_APP).toBe('systems-mapping');
  expect(vi.getTimerCount()).toBe(0);
});

test('bounded verified display names and exact clock boundaries remain valid', async () => {
  for (const changes of [
    { displayName: 'Synthetic instructor', displayNameSource: 'verified_profile' },
    { className: 'a'.repeat(200), term: 'b'.repeat(120), section: 'c'.repeat(120) },
    { displayName: 'a'.repeat(160), displayNameSource: 'verified_profile' },
    { startsAt: iso(5000), checkedAt: iso(5000), revision: 0 },
    { checkedAt: iso(-29999), expiresAt: iso(1) },
  ]) {
    const expected = receipt(changes);
    expect(await resolveCourseAccess(environment(expected).env, subject, classId)).toEqual(expected);
  }
});

test('every access rechecks course enrollment, including revocation after a success', async () => {
  const { env, resolve } = environment();
  await expect(resolveCourseAccess(env, subject, classId)).resolves.toMatchObject({ participant: true });
  resolve.mockResolvedValue({ ok: false, code: 'revoked', retryable: false });
  await expect(resolveCourseAccess(env, subject, classId)).rejects.toMatchObject({ status: 403, code: 'revoked' });
  expect(resolve).toHaveBeenCalledTimes(2);
});

test.each([undefined, 'false', 'TRUE', '1', ''])('course access is disabled unless explicitly true: %j', async enabled => {
  const { env, resolve } = environment(); env.COURSE_ACCESS_ENABLED = enabled;
  await expect(resolveCourseAccess(env, subject, classId)).rejects.toMatchObject({ status: 503, code: 'course_access_disabled' });
  expect(resolve).not.toHaveBeenCalled();
});

test.each([undefined, '', '   ', 'synthetic-course-b'])('unset or unmatched allowlist %j never grants an explicit scope', async ids => {
  const { env, resolve } = environment(); env.COURSE_IDS = ids;
  await expect(resolveCourseAccess(env, subject, classId)).rejects.toMatchObject({ status: 403, code: 'course_not_allowed' });
  expect(resolve).not.toHaveBeenCalled();
});

test.each(['search', 'bad/course', `${classId},`, `${classId},search`, Array.from({ length: 21 }, (_, i) => `course-${i}`).join(',')])('malformed allowlist %j fails closed', async ids => {
  const { env, resolve } = environment(); env.COURSE_IDS = ids;
  await expect(resolveCourseAccess(env, subject, classId)).rejects.toMatchObject({ status: 503, code: 'course_configuration_unavailable' });
  expect(resolve).not.toHaveBeenCalled();
});

test('trusted allowlist can contain several courses, but a receipt must match the selected one', async () => {
  const { env, resolve } = environment(); env.COURSE_IDS = ` ${classId}, synthetic-course-b,${classId} `;
  await expect(resolveCourseAccess(env, subject, classId)).resolves.toMatchObject({ classId });
  await expect(resolveCourseAccess(env, subject, 'synthetic-course-b')).rejects.toMatchObject({ status: 503 });
  expect(resolve).toHaveBeenLastCalledWith({ subject, app: 'systems-mapping', classId: 'synthetic-course-b' });
  resolve.mockResolvedValue(receipt({ classId: 'synthetic-course-b', memberId: `systems-mapping-member-v1-${'b'.repeat(64)}` }));
  await expect(resolveCourseAccess(env, subject, 'synthetic-course-b')).resolves.toMatchObject({ classId: 'synthetic-course-b' });
});

test('invalid course and noncanonical server subject never reach authority', async () => {
  const { env, resolve } = environment();
  await expect(resolveCourseAccess(env, subject, 'search')).rejects.toMatchObject({ status: 400, code: 'course_invalid' });
  for (const invalid of ['Maria', 'admin', 'someone@cuny.edu', `cail-${'A'.repeat(32)}`, `${subject}\n`, '']) {
    await expect(resolveCourseAccess(env, invalid, classId)).rejects.toMatchObject({ status: 503 });
  }
  expect(resolve).not.toHaveBeenCalled();
});

test.each([
  { ok: 'true' }, { classId: 'synthetic-course-b' }, { classId: 'search' },
  { memberId: `stem-member-v1-${'a'.repeat(64)}` }, { memberId: `systems-mapping-member-v1-${'A'.repeat(64)}` },
  { memberId: `systems-mapping-member-v1-${'a'.repeat(63)}` }, { memberId: null },
  { memberId: `systems-mapping-member-v1-${'a'.repeat(64)}\n` },
  { owner: 'true' }, { participant: 1 }, { participant: false, owner: false },
  { className: '' }, { className: '   ' }, { className: 'a'.repeat(201) }, { className: 'private\u0000value' },
  { term: '' }, { term: 'a'.repeat(121) }, { section: '' }, { section: 'a'.repeat(121) }, { section: 'a\u007f' },
  { displayName: null, displayNameSource: 'verified_profile' }, { displayName: 'name', displayNameSource: 'unavailable' },
  { displayName: '', displayNameSource: 'verified_profile' }, { displayName: 'a'.repeat(161), displayNameSource: 'verified_profile' },
  { displayName: 'private\nname', displayNameSource: 'verified_profile' }, { displayNameSource: 'browser' },
  { checkedAt: iso(-30000) }, { checkedAt: iso(5001) }, { expiresAt: iso(0) }, { expiresAt: iso(-1) },
  { startsAt: iso(1) }, { checkedAt: iso(1), expiresAt: iso(1) },
  { startsAt: '2026-02-30T00:00:00.000Z' }, { checkedAt: '2026-10-12T18:00:00Z' },
  { checkedAt: '2026-10-12T18:00:00.000+00:00' }, { expiresAt: '2026-13-01T00:00:00.000Z' },
  { revision: -1 }, { revision: 0.5 }, { revision: '1' }, { revision: Number.MAX_SAFE_INTEGER + 1 },
  { app: 'systems-mapping' }, { subject }, { admin: true }, { role: 'instructor' }, { unknown: 'private diagnostics' },
])('rejects malformed, stale, foreign or extended receipt %j', async change => {
  await expect(resolveCourseAccess(environment(receipt(change)).env, subject, classId))
    .rejects.toMatchObject({ status: 503, code: 'course_access_unavailable' });
});

test('all receipt fields must be present as own fields', async () => {
  for (const field of Object.keys(receipt())) {
    const incomplete: Record<string, unknown> = receipt(); delete incomplete[field];
    await expect(resolveCourseAccess(environment(incomplete).env, subject, classId)).rejects.toMatchObject({ status: 503 });
  }
  for (const value of [null, undefined, true, 1, 'ok', [], Object.create(receipt()), { ...receipt(), [Symbol('extra')]: true }]) {
    await expect(resolveCourseAccess(environment(value).env, subject, classId)).rejects.toMatchObject({ status: 503 });
  }
});

test('unreadable receipt data and hidden extra fields cannot become course authority', async () => {
  const unreadable = receipt();
  Object.defineProperty(unreadable, 'owner', { enumerable: true, get() { throw new Error('private receipt diagnostic'); } });
  const extended = receipt();
  Object.defineProperty(extended, 'admin', { value: true, enumerable: false });
  for (const value of [unreadable, extended]) {
    await expect(resolveCourseAccess(environment(value).env, subject, classId))
      .rejects.toMatchObject({ status: 503, code: 'course_access_unavailable' });
  }
});

test('Cloudflare RPC disposal metadata preserves strict success and denial receipts', async () => {
  const dispose = vi.fn();
  const success = receipt();
  // Workerd adds a non-enumerable disposer to every object RPC result.
  Object.defineProperty(success, Symbol.dispose, { value: dispose });
  const result = await resolveCourseAccess(environment(success).env, subject, classId);
  expect(result).toEqual(receipt());
  expect(Reflect.ownKeys(result)).not.toContain(Symbol.dispose);
  const denial = { ok: false, code: 'revoked', retryable: false };
  Object.defineProperty(denial, Symbol.dispose, { value: dispose });
  await expect(resolveCourseAccess(environment(denial).env, subject, classId))
    .rejects.toMatchObject({ status: 403, code: 'revoked' });
  expect(dispose).not.toHaveBeenCalled();
});

test('disposal metadata does not permit unknown symbols or invoke their getters', async () => {
  const getter = vi.fn(() => { throw new Error('private unexpected field'); });
  for (const key of [Symbol('unknown'), Symbol.asyncDispose, 'unknown']) {
    const value = receipt();
    Object.defineProperty(value, Symbol.dispose, { value: vi.fn() });
    Object.defineProperty(value, key, { enumerable: true, get: getter });
    await expect(resolveCourseAccess(environment(value).env, subject, classId))
      .rejects.toMatchObject({ status: 503, code: 'course_access_unavailable' });
  }
  expect(getter).not.toHaveBeenCalled();
});

test.each(['invalid', 'not_admitted', 'not_enrolled', 'scheduled', 'expired', 'revoked', 'not_owner', 'cursor_invalid', 'stale_cursor'])('exact authority denial %s is forbidden', async code => {
  await expect(resolveCourseAccess(environment({ ok: false, code, retryable: false }).env, subject, classId))
    .rejects.toMatchObject({ status: 403, code });
});

test.each([
  { ok: false, code: 'not_enrolled' }, { ok: false, code: 'revoked', retryable: true },
  { ok: false, code: 'not_enrolled', retryable: false, diagnostics: 'private' },
  { ok: false, code: 'unknown', retryable: false }, { ok: 'false', code: 'not_enrolled', retryable: false },
])('malformed denial %j is unavailable, not authoritative', async value => {
  await expect(resolveCourseAccess(environment(value).env, subject, classId)).rejects.toMatchObject({ status: 503 });
});

test('a global administrator or display name cannot replace current course ownership', async () => {
  const { env } = environment(receipt({ displayName: 'Maria', displayNameSource: 'verified_profile' }));
  const result = await resolveCourseAccess({ ...env, admin: true } as CourseAccessEnv, subject, classId);
  expect(result.owner).toBe(false);
  env.ADMISSION_RESOLVER!.resolveCourseAccessV2 = async () => ({ ok: false, code: 'not_enrolled', retryable: false });
  await expect(resolveCourseAccess({ ...env, admin: true } as CourseAccessEnv, subject, classId)).rejects.toMatchObject({ status: 403 });
});

test('missing resolver, synchronous throw and asynchronous outage are uniformly unavailable', async () => {
  const { env } = environment();
  for (const resolver of [undefined, {},
    { resolveCourseAccess: () => { throw new Error('secret synchronous diagnostics'); } },
    { resolveCourseAccess: async () => { throw new Error('secret upstream diagnostics'); } },
  ]) {
    await expect(resolveCourseAccess({ ...env, ADMISSION_RESOLVER: resolver }, subject, classId))
      .rejects.toMatchObject({ status: 503, code: 'course_access_unavailable' });
    expect(vi.getTimerCount()).toBe(0);
  }
});

test('an authority that ignores cancellation is bounded to five seconds', async () => {
  const { env, resolve } = environment();
  resolve.mockImplementation(() => new Promise(() => {}));
  const pending = resolveCourseAccess(env, subject, classId);
  const rejected = expect(pending).rejects.toMatchObject({ status: 503, code: 'course_access_unavailable' });
  await vi.advanceTimersByTimeAsync(5000);
  await rejected;
  expect(resolve).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test('cancellation ends local waiting and a cancelled request cannot begin an authority call', async () => {
  const { env, resolve } = environment();
  const aborted = new AbortController(); aborted.abort(new Error('private cancellation reason'));
  await expect(resolveCourseAccess(env, subject, classId, aborted.signal)).rejects.toMatchObject({ status: 503 });
  expect(resolve).not.toHaveBeenCalled();
  const controller = new AbortController();
  resolve.mockImplementation(() => new Promise(() => {}));
  const pending = resolveCourseAccess(env, subject, classId, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ status: 503, code: 'course_access_unavailable' });
  await Promise.resolve();
  controller.abort(new Error('private cancellation reason'));
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

test('receipt freshness is checked after the authority response arrives', async () => {
  const { env, resolve } = environment();
  resolve.mockImplementation(() => new Promise(done => { setTimeout(() => done(receipt({ checkedAt: iso(-27000) })), 4000); }));
  const pending = resolveCourseAccess(env, subject, classId);
  const rejected = expect(pending).rejects.toMatchObject({ status: 503 });
  await vi.advanceTimersByTimeAsync(4000);
  await rejected;
});

test.each([
  [503, 'course_access_unavailable', 'Course access is temporarily unavailable. Try again shortly.'],
  [403, 'not_enrolled', 'Your account does not have access to this course. Check your course link or ask your instructor for help.'],
  [403, 'not_owner', 'Only this course’s instructor can change its guidance. Ask your instructor for help.'],
  [409, 'course_prompt_conflict', 'The course settings changed. Reload them before saving again.'],
  [400, 'course_invalid', 'This course request could not be read. Open the course again and try again.'],
  [404, 'course_item_missing', 'This course item is no longer available. Open the course again.'],
] as const)('safe visible failure for %s/%s preserves the machine code', async (status, code, message) => {
  const response = courseFailure(new CourseAccessError(status, code));
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const body = await response.json() as { error: string; details: { code: string } };
  expect(body).toEqual({ error: message, details: { code } });
  expect(body.error).not.toContain(code);
});

test('unknown errors and malformed codes never expose diagnostics', async () => {
  for (const error of [new Error('secret provider diagnostic'), new CourseAccessError(503, 'secret=private\ntrace'), { status: 403, code: 'forged' }]) {
    const response = courseFailure(error);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Course access is temporarily unavailable. Try again shortly.', details: { code: 'course_access_unavailable' },
    });
  }
});


test('guest instructors receive explicit capabilities without ownership or student enrollment', async () => {
  const demoId = 'cail-teaching-tools-demo';
  const value = receipt({ classId: demoId, participant: false, owner: false, guestInstructor: true });
  const { env, resolve } = environment(value);
  env.COURSE_IDS = demoId;
  await expect(resolveCourseAccess(env, subject, demoId)).resolves.toMatchObject({ guestInstructor: true, owner: false, participant: false, capabilities: { promptWrite: true } });
  resolve.mockResolvedValueOnce({ ok: false, code: 'revoked', retryable: false });
  await expect(resolveCourseAccess(env, subject, demoId)).rejects.toMatchObject({ status: 403 });
  for (const invalid of [
    receipt({ capabilities: { instructorPanel: true, rosterRead: true, promptRead: true, promptWrite: true } }),
    receipt({ guestInstructor: true, participant: true }),
    { ...value, capabilities: { ...value.capabilities, promptWrite: 'true' } },
  ]) await expect(resolveCourseAccess(environment(invalid).env, subject, classId)).rejects.toMatchObject({ status: 503 });
});
