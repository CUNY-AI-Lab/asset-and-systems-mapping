import { createHash } from 'node:crypto';
import { withDeadline, withSignal } from './bounded.js';

/** Authenticated reports use Admission's private, durable store. No email path. */
export type BugReport = { reportId: string; description: string; path: string; expectedActor: string };
type FailureCode = 'invalid' | 'forbidden' | 'not_admitted' | 'idempotency_conflict' | 'rate_limited' | 'unavailable';
type LocalFailureCode = FailureCode | 'account_changed';
export type BugReportResult = { ok: true; status: 'saved'; reportId: string; createdAt: string } |
  { ok: false; code: FailureCode; retryable: boolean; retryAfterSeconds?: number };
export type BugReportService = {
  submitAuthenticated(report: { reportId: string; subject: string; description: string; origin: string; path: string; release: string }): Promise<BugReportResult>;
};
type Options = { origin: string; subject: string; release: string; service?: BugReportService };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODES = new Set<FailureCode>(['invalid', 'forbidden', 'not_admitted', 'idempotency_conflict', 'rate_limited', 'unavailable']);
const statuses = { invalid: 400, forbidden: 403, not_admitted: 403, account_changed: 409, idempotency_conflict: 409, rate_limited: 429, unavailable: 503 };
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function response(result: BugReportResult) {
  return Response.json(result, { status: result.ok ? 200 : statuses[result.code], headers: {
    ...headers, ...(!result.ok && result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : {}),
  } });
}
function failure(code: LocalFailureCode, retryable = false) {
  return Response.json({ ok: false, code, retryable }, { status: statuses[code], headers });
}

// An account comparison marker, never an authentication credential. It remains
// stable across same-account sign-in and never leaves the browser/app boundary.
export function reportActor(subject: string) {
  return createHash('sha256').update(`cail-report-actor:v1\nsystems-mapping\n${subject}`).digest('hex');
}
export function normalizeReportPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (['/', '/p/:shared-map'].includes(value)) return value;
  return /^\/p\/[A-Za-z0-9_-]{20,64}\/?$/.test(value) ? '/p/:shared-map' : null;
}
async function readReport(request: Request): Promise<BugReport | null> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !request.body) return null;
  const claimed = request.headers.get('content-length');
  if (claimed && (!/^\d+$/.test(claimed) || Number(claimed) > 16384)) return null;
  const reader = request.body.getReader();
  try {
    const text = await withDeadline(async signal => {
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }); let text = '', bytes = 0;
      while (true) {
        const part = await withSignal(reader.read(), signal); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > 16384) throw new Error('size');
        text += decoder.decode(part.value, { stream: true });
      }
      return text + decoder.decode();
    }, request.signal, 5000);
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'description,expectedActor,path,reportId') return null;
    if (!['reportId', 'description', 'path', 'expectedActor'].every(key => typeof data[key] === 'string')
      || !UUID.test(data.reportId) || !/^[0-9a-f]{64}$/.test(data.expectedActor) || data.description.length > 4000) return null;
    const description = data.description.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
    const path = normalizeReportPath(data.path);
    if (!path || description.length < 10 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(description)) return null;
    return { reportId: data.reportId, description, path, expectedActor: data.expectedActor };
  } catch { return null; }
  finally { void reader.cancel().catch(() => {}); }
}

// The production caller must first run authorize() and the existing account
// limiter. A browser body/header can never supply options.subject.
export async function handleBugReport(request: Request, options: Options): Promise<Response> {
  const url = new URL(request.url), session = url.pathname === '/api/bug-reports/session';
  const method = session ? 'GET' : 'POST';
  if (request.method !== method) return new Response(null, { status: 405, headers: { ...headers, Allow: method } });
  if (url.origin !== options.origin || url.search || request.headers.get('sec-fetch-site') === 'cross-site'
    || (request.headers.has('origin') && request.headers.get('origin') !== options.origin)
    || (!session && !request.headers.has('origin'))) return failure('forbidden');
  const referer = request.headers.get('referer');
  if (referer) {
    try { if (new URL(referer).origin !== options.origin) return failure('forbidden'); }
    catch { return failure('forbidden'); }
  }
  if (!/^cail-[0-9a-f]{32}$/.test(options.subject)) return failure('forbidden');
  const expectedActor = reportActor(options.subject);
  if (session) return Response.json({ ok: true, expectedActor }, { headers });
  const report = await readReport(request);
  if (!report) return failure('invalid');
  if (report.expectedActor !== expectedActor) return failure('account_changed');
  if (!options.service || typeof options.release !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(options.release)) return failure('unavailable', true);
  try {
    const result = await withDeadline(async signal => {
      if (signal.aborted) throw signal.reason;
      return withSignal(options.service!.submitAuthenticated({ reportId: report.reportId, subject: options.subject,
        description: report.description, origin: options.origin, path: report.path, release: options.release }), signal);
    }, request.signal, 20000);
    if (result?.ok === true && result.status === 'saved' && result.reportId === report.reportId
      && typeof result.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.createdAt)
      && Number.isFinite(Date.parse(result.createdAt)) && new Date(result.createdAt).toISOString() === result.createdAt) {
      return response({ ok: true, status: 'saved', reportId: result.reportId, createdAt: result.createdAt });
    }
    if (result?.ok === false && CODES.has(result.code) && typeof result.retryable === 'boolean') {
      const retryAfterSeconds = Number.isSafeInteger(result.retryAfterSeconds) && result.retryAfterSeconds! > 0 && result.retryAfterSeconds! <= 86400 ? result.retryAfterSeconds : undefined;
      return response({ ok: false, code: result.code, retryable: result.retryable,
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
    }
  } catch { /* An acknowledgement can be lost after persistence. Retry the same ID. */ }
  return failure('unavailable', true);
}
