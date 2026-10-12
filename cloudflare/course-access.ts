import { withDeadline, withSignal } from './bounded.js';

/** Prospective Systems Mapping counterpart of Admission's private course wire v1.
 * The shared contract currently supports Stem only. These fields and the Systems
 * member namespace require upstream agreement before this feature is enabled.
 * Never use Stem's app literal or member IDs as a compatibility fallback. */
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
  startsAt: string;
  checkedAt: string;
  expiresAt: string;
  revision: number;
}

export interface AdmissionCourseResolver {
  resolveCourseAccess?(input: { subject: string; app: typeof COURSE_APP; classId: string }): Promise<unknown>;
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
const accessFields = ['ok', 'classId', 'className', 'term', 'section', 'memberId', 'displayName', 'displayNameSource', 'participant', 'owner', 'startsAt', 'checkedAt', 'expiresAt', 'revision'];

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
    && typeof value.participant === 'boolean' && typeof value.owner === 'boolean' && (value.participant || value.owner)
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

function allowedCourseIds(env: CourseAccessEnv): string[] {
  if (env.COURSE_IDS === undefined) return [];
  if (typeof env.COURSE_IDS !== 'string') throw new CourseAccessError(503, 'course_configuration_unavailable');
  if (env.COURSE_IDS.trim() === '') return [];
  const ids = env.COURSE_IDS.split(',').map(id => id.trim());
  if (ids.length > 20 || ids.some(id => !validCourseId(id))) {
    throw new CourseAccessError(503, 'course_configuration_unavailable');
  }
  return [...new Set(ids)];
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
      if (!resolver || !resolver.resolveCourseAccess) throw new Error('resolver unavailable');
      // Cloudflare exposes callable RPC methods as proxies, whose typeof may
      // be "object". Invoking inside the bounded thunk validates callability.
      // The thunk keeps missing methods, synchronous throws and cancellation in
      // the same bounded failure path as an asynchronous authority outage.
      return withSignal(Promise.resolve().then(() => {
        if (timed.aborted) throw timed.reason;
        return resolver.resolveCourseAccess!({ subject, app: COURSE_APP, classId });
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
