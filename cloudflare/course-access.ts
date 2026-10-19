import { DEMO_COURSE_ID } from './demo-course';
import { withDeadline, withSignal } from './bounded.js';

/** Systems Mapping counterpart of Admission's private course wire v2.
 * Admission gives each application its own member IDs and roster cursors. */
export const COURSE_APP = 'systems-mapping' as const;

export interface CourseAccess {
  ok: true;
  classId: string;
  className: string;
  term: string;
  section: string;
  memberId: string;
  displayName: string | null;
  displayNameSource: 'verified_profile' | 'unavailable';
  participant: boolean;
  owner: boolean;
  guestInstructor: boolean;
  capabilities: { instructorPanel: boolean; rosterRead: boolean; promptRead: boolean; promptWrite: boolean };
  startsAt: string;
  checkedAt: string;
  expiresAt: string;
  revision: number;
}

export interface AdmissionCourseResolver {
  resolveCourseAccessV2?(input: { subject: string; app: typeof COURSE_APP; classId: string }): Promise<unknown>;
  listCourseRosterV2?(input: { subject: string; app: typeof COURSE_APP; classId: string; limit: number; cursor?: string }): Promise<unknown>;
}

export interface CourseAccessEnv {
  COURSE_ACCESS_ENABLED?: string;
  /** Deployment-owned, comma-separated course IDs. No default course or roster. */
  COURSE_IDS?: string;
  ADMISSION_RESOLVER?: AdmissionCourseResolver;
}

export class CourseAccessError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409 | 503, public readonly code: string) {
    super(code);
    this.name = 'CourseAccessError';
  }
}

const classIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const memberIdPattern = /^systems-mapping-member-v1-[0-9a-f]{64}$/;
const subjectPattern = /^cail-[0-9a-f]{32}$/;
const failureCodes = new Set(['invalid', 'not_admitted', 'not_enrolled', 'scheduled', 'expired', 'revoked', 'not_owner', 'cursor_invalid', 'stale_cursor']);
const accessFields = ['ok', 'classId', 'className', 'term', 'section', 'memberId', 'displayName', 'displayNameSource', 'participant', 'owner', 'guestInstructor', 'capabilities', 'startsAt', 'checkedAt', 'expiresAt', 'revision'];

export const validCourseId = (value: unknown): value is string =>
  typeof value === 'string' && value === value.trim() && classIdPattern.test(value) && value !== 'search';

function exactFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  // Workerd attaches its disposal hook to serialized RPC return objects.
  // That runtime symbol is not part of Admission's receipt contract.
  const keys = Reflect.ownKeys(value).filter(key => key !== Symbol.dispose);
  return keys.length === fields.length && keys.every(key => typeof key === 'string' && fields.includes(key));
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
}

function canonicalDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validReceipt(value: unknown, classId: string, now: number): value is CourseAccess {
  if (!exactFields(value, accessFields)) return false;
  return value.ok === true && validCourseId(value.classId) && value.classId === classId
    && boundedText(value.className, 200) && boundedText(value.term, 120) && boundedText(value.section, 120)
    && typeof value.memberId === 'string' && value.memberId === value.memberId.trim() && memberIdPattern.test(value.memberId)
    && ((value.displayName === null && value.displayNameSource === 'unavailable')
      || (boundedText(value.displayName, 160) && value.displayNameSource === 'verified_profile'))
    && typeof value.participant === 'boolean' && typeof value.owner === 'boolean' && typeof value.guestInstructor === 'boolean' && (value.participant || value.owner || value.guestInstructor)
    && exactFields(value.capabilities, ['instructorPanel', 'rosterRead', 'promptRead', 'promptWrite'])
    && Object.values(value.capabilities).every(flag => flag === (value.owner || value.guestInstructor))
    && (!value.guestInstructor || (!value.owner && !value.participant && value.classId === DEMO_COURSE_ID))
    && canonicalDate(value.startsAt) && canonicalDate(value.checkedAt) && canonicalDate(value.expiresAt)
    && Date.parse(value.checkedAt) <= now + 5000 && now - Date.parse(value.checkedAt) < 30000
    && Date.parse(value.expiresAt) > now && Date.parse(value.checkedAt) < Date.parse(value.expiresAt)
    && Date.parse(value.startsAt) <= Date.parse(value.checkedAt)
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0;
}

function denialCode(value: unknown): string | null {
  return exactFields(value, ['ok', 'code', 'retryable']) && value.ok === false && value.retryable === false
    && typeof value.code === 'string' && failureCodes.has(value.code) ? value.code : null;
}

export function allowedCourseIds(env: CourseAccessEnv): string[] {
  if (env.COURSE_IDS === undefined) return [];
  if (typeof env.COURSE_IDS !== 'string') throw new CourseAccessError(503, 'course_configuration_unavailable');
  if (env.COURSE_IDS.trim() === '') return [];
  const ids = env.COURSE_IDS.split(',').map(id => id.trim());
  if (ids.length > 20 || ids.some(id => !validCourseId(id))) {
    throw new CourseAccessError(503, 'course_configuration_unavailable');
  }
  return [...new Set(ids)];
}

export interface CourseStudent {
  memberId: string;
  displayName: string | null;
  displayNameSource: 'verified_profile' | 'unavailable';
  startsAt: string;
  expiresAt: string;
}

export async function courseRoster(env: CourseAccessEnv, subject: string, course: CourseAccess, cursor: string | undefined, signal?: AbortSignal): Promise<{ participants: CourseStudent[]; nextCursor: string | null }> {
  if (!course.capabilities.rosterRead) throw new CourseAccessError(403, 'not_owner');
  if (cursor !== undefined && !/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new CourseAccessError(400, 'cursor_invalid');
  let value: unknown;
  try {
    value = await withDeadline(timed => withSignal(Promise.resolve().then(() => {
      if (timed.aborted) throw timed.reason;
      return env.ADMISSION_RESOLVER!.listCourseRosterV2!({ subject, app: COURSE_APP, classId: course.classId, limit: 40, ...(cursor === undefined ? {} : { cursor }) });
    }), timed), signal, 5000);
  } catch { throw new CourseAccessError(503, 'course_access_unavailable'); }
  const denial = denialCode(value);
  if (denial) throw new CourseAccessError(403, denial);
  const now = Date.now();
  const fields = ['ok', 'classId', 'checkedAt', 'expiresAt', 'revision', 'participants', 'nextCursor'];
  if (!exactFields(value, fields) || value.ok !== true || value.classId !== course.classId
    || !canonicalDate(value.checkedAt) || !canonicalDate(value.expiresAt)
    || Date.parse(value.checkedAt) > now + 5000 || now - Date.parse(value.checkedAt) >= 30000
    || Date.parse(value.expiresAt) <= now || Date.parse(value.checkedAt) >= Date.parse(value.expiresAt)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || !(value.nextCursor === null || typeof value.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(value.nextCursor))
    || !Array.isArray(value.participants) || value.participants.length > 40) throw new CourseAccessError(503, 'course_access_unavailable');
  const participants: CourseStudent[] = [];
  const ids = new Set<string>();
  for (const row of value.participants) {
    if (!exactFields(row, ['memberId', 'displayName', 'displayNameSource', 'startsAt', 'expiresAt'])
      || typeof row.memberId !== 'string' || !memberIdPattern.test(row.memberId) || ids.has(row.memberId)
      || !((row.displayName === null && row.displayNameSource === 'unavailable') || boundedText(row.displayName, 160) && row.displayNameSource === 'verified_profile')
      || !canonicalDate(row.startsAt) || !canonicalDate(row.expiresAt)
      || Date.parse(row.startsAt) > now || Date.parse(row.expiresAt) <= now) throw new CourseAccessError(503, 'course_access_unavailable');
    ids.add(row.memberId);
    participants.push({ memberId: row.memberId, displayName: row.displayName as string | null, displayNameSource: row.displayNameSource as CourseStudent['displayNameSource'], startsAt: row.startsAt, expiresAt: row.expiresAt });
  }
  return { participants, nextCursor: value.nextCursor as string | null };
}

/** Call only with the canonical subject established by verified server identity.
 * A requested course selects a scope; only a fresh receipt grants its roles.
 * No cache or general/public fallback is allowed for explicit course requests. */
export async function resolveCourseAccess(env: CourseAccessEnv, subject: string, classId: string, signal?: AbortSignal): Promise<CourseAccess> {
  if (env.COURSE_ACCESS_ENABLED !== 'true') throw new CourseAccessError(503, 'course_access_disabled');
  if (!validCourseId(classId)) throw new CourseAccessError(400, 'course_invalid');
  if (!allowedCourseIds(env).includes(classId)) throw new CourseAccessError(403, 'course_not_allowed');
  if (typeof subject !== 'string' || subject.length !== 37 || !subjectPattern.test(subject)) throw new CourseAccessError(503, 'course_access_unavailable');

  let value: unknown;
  try {
    value = await withDeadline(timed => {
      if (timed.aborted) throw timed.reason;
      const resolver = env.ADMISSION_RESOLVER;
      if (!resolver || !resolver.resolveCourseAccessV2) throw new Error('resolver unavailable');
      // Cloudflare exposes callable RPC methods as proxies, whose typeof may
      // be "object". Invoking inside the bounded thunk validates callability.
      // The thunk keeps missing methods, synchronous throws and cancellation in
      // the same bounded failure path as an asynchronous authority outage.
      return withSignal(Promise.resolve().then(() => {
        if (timed.aborted) throw timed.reason;
        return resolver.resolveCourseAccessV2!({ subject, app: COURSE_APP, classId });
      }), timed);
    }, signal, 5000);
  } catch {
    throw new CourseAccessError(503, 'course_access_unavailable');
  }

  let denied: string | null = null;
  try {
    denied = denialCode(value);
    if (!denied && exactFields(value, accessFields)) {
      const snapshot = Object.fromEntries(accessFields.map(field => [field, value[field]]));
      if (validReceipt(snapshot, classId, Date.now())) return snapshot;
    }
  } catch {
    // An unreadable RPC value is an authority failure, never a role grant.
    throw new CourseAccessError(503, 'course_access_unavailable');
  }
  if (denied) throw new CourseAccessError(403, denied);
  throw new CourseAccessError(503, 'course_access_unavailable');
}

/** Diagnostics stay out of visible copy. Machine codes remain in details.code. */
export function courseFailure(error: unknown): Response {
  const failure = error instanceof CourseAccessError ? error : new CourseAccessError(503, 'course_access_unavailable');
  const code = failure.code === failure.code.trim() && /^[a-z][a-z0-9_]{0,63}$/.test(failure.code) ? failure.code : 'course_access_unavailable';
  const message = failure.status === 503 ? 'Course access is temporarily unavailable. Try again shortly.'
    : failure.status === 409 ? 'The course settings changed. Reload them before saving again.'
    : failure.status === 400 ? 'This course request could not be read. Open the course again and try again.'
    : failure.status === 404 ? 'This course item is no longer available. Open the course again.'
    : code === 'not_owner' ? 'Only this course’s instructor can change its guidance. Ask your instructor for help.'
    : 'Your account does not have access to this course. Check your course link or ask your instructor for help.';
  return Response.json({ error: message, details: { code } }, {
    status: failure.status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
