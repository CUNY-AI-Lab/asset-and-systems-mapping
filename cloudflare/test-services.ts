// Test-harness-only services. Never referenced by a release configuration.
import { WorkerEntrypoint } from 'cloudflare:workers';
type FixtureEnv = { TEST_TOKENS: string };
let mode = 'success';
let calls = 0;
let captured: Record<string, unknown> | null = null;
let denied = false;
let courseDenied = false;
let courseOutage = false;
let courseLookups = 0;
let denyOnCourseLookup = 0;
let courseProfile = { displayName: null as string | null, displayNameSource: 'unavailable' };
const revoked = new Set<string>();
const loginToken = '00000000-0000-4000-8000-000000000001.' + 's'.repeat(43);
export class Identity extends WorkerEntrypoint<FixtureEnv> {
  async begin(_challenge: string, _state: string) { return { url: 'https://tools.ailab.gc.cuny.edu/worker-login?request=fixture' }; }
  async redeem(_code: string, _verifier: string) { revoked.delete(loginToken); return { ok: true, token: loginToken, expiresAt: Date.now() + 60000 }; }
  async identities(token: string) {
    if (revoked.has(token)) return { ok: false, status: 401 };
    const tokens: Record<string, { subject: string; appJwt: string; gatewayJwt: string; sessionToken?: string }> = JSON.parse(this.env.TEST_TOKENS);
    const value = token === loginToken ? tokens.alice : Object.values(tokens).find(entry => entry.sessionToken === token);
    return value ? { ok: true, ...value } : { ok: false, status: 401 };
  }
  async revoke(token: string) { revoked.add(token); return { revoked: true }; }
}
export class Admission extends WorkerEntrypoint<FixtureEnv> {
  async listCourseRosterV2({ subject, app, classId }: { subject: string; app: string; classId: string }) {
    const access = await this.resolveCourseAccessV2({ subject, app, classId });
    if (!access.ok) return access;
    if (!access.capabilities.rosterRead) return { ok: false, code: 'not_owner', retryable: false };
    return { ok: true, classId, checkedAt: access.checkedAt, expiresAt: access.expiresAt, revision: 1, nextCursor: null,
      participants: [{ memberId: 'systems-mapping-member-v1-' + 'a'.repeat(64), displayName: 'Alice Student', displayNameSource: 'verified_profile', startsAt: access.startsAt, expiresAt: access.expiresAt }] };
  }
  async resolveCourseAccessV2({ subject, app, classId }: { subject: string; app: string; classId: string }) {
    courseLookups++;
    if (courseOutage) throw new Error('private fixture outage');
    const tokens = JSON.parse(this.env.TEST_TOKENS);
    const who = Object.keys(tokens).find(name => tokens[name].subject === subject);
    const owner = who === 'instructor' && classId === 'synthetic-course-a';
    const guestInstructor = who === 'guest' && classId === 'cail-teaching-tools-demo';
    const participant = who === 'alice' && ['synthetic-course-a', 'synthetic-course-b'].includes(classId)
      || who === 'bob' && classId === 'synthetic-course-b' || who === 'admin' && classId === 'synthetic-course-a';
    if (app !== 'systems-mapping' || courseDenied || (denyOnCourseLookup > 0 && courseLookups >= denyOnCourseLookup) || (!owner && !participant && !guestInstructor)) return { ok: false, code: 'not_enrolled', retryable: false };
    return { ok: true, classId, className: 'Synthetic ' + classId, term: 'Test term', section: 'Test section',
      memberId: 'systems-mapping-member-v1-' + (who === 'alice' ? 'a' : who === 'bob' ? 'b' : who === 'instructor' ? 'c' : 'd').repeat(64),
      ...courseProfile, participant, owner, guestInstructor,
      capabilities: { instructorPanel: owner || guestInstructor, rosterRead: owner || guestInstructor, promptRead: owner || guestInstructor, promptWrite: owner || guestInstructor },
      startsAt: new Date(Date.now() - 60000).toISOString(), checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), revision: 1 };
  }
  async resolveMembership({ subject }: { subject: string }) {
    if (denied) return { ok: false, code: 'not_admitted' };
    const admin = subject === JSON.parse(this.env.TEST_TOKENS).admin.subject;
    return { ok: true, accessRole: admin ? 'admin' : 'member', budgetScope: admin ? 'admin' : 'person', revision: 1, expiresAt: new Date(Date.now() + 60000).toISOString() };
  }
}
export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === '/header-probe') return Response.json({ present: request.headers.has('x-systems-course'), value: request.headers.get('x-systems-course') });
    if (url.pathname === '/control') {
      if (request.method === 'POST') { const value = await request.json<{ mode?: string; denied?: boolean; resetSessions?: boolean; courseDenied?: boolean; courseOutage?: boolean; denyOnCourseLookup?: number; courseProfile?: typeof courseProfile | null }>(); mode = value.mode ?? mode; courseDenied = value.courseDenied ?? courseDenied; courseOutage = value.courseOutage ?? courseOutage; denyOnCourseLookup = value.denyOnCourseLookup ?? denyOnCourseLookup; if (Object.hasOwn(value, 'courseProfile')) courseProfile = value.courseProfile ?? { displayName: null, displayNameSource: 'unavailable' }; courseLookups = 0; denied = value.denied ?? denied; if (value.resetSessions) revoked.clear(); calls = 0; captured = null; }
      return Response.json({ calls, captured, courseLookups });
    }
    if (url.pathname === '/v1/quota') return Response.json({ object: 'quota', managed_by: 'cloudflare', state: 'estimated', unit: 'microdollar', currency: 'USD', limit: 1000, estimated_used: 100, estimated_remaining: 900, used_percent: 10, remaining_percent: 90, window_seconds: 86400, window_technique: 'fixed', calculated_at: Date.now() });
    if (url.pathname !== '/v1/chat/completions') return new Response(null, { status: 404 });
    calls++;
    const body = await request.json<Record<string, unknown>>();
    captured = { systemPrompt: (body.messages as { role: string; content: string }[])?.find(message => message.role === 'system')?.content, model: body.model, identity: Boolean(request.headers.get('x-cail-identity-jwt')), authorization: request.headers.has('authorization'), requestId: request.headers.get('x-cail-request-id') };
    if (mode === 'stall') await new Promise(resolve => setTimeout(resolve, 4000));
    if (mode === 'fallback' && body.model === 'glm-5.3-flash') return Response.json({ error: { code: 'upstream_unavailable', type: 'upstream_error', message: 'Controlled refusal', param: null } }, { status: 503, headers: { 'x-should-retry': 'true', 'retry-after': '1' } });
    if (mode === 'quota') return Response.json({ error: { code: 'quota_exceeded', type: 'insufficient_quota', message: 'Test refusal', param: null } }, { status: 429, headers: { 'x-should-retry': 'false', 'x-request-id': request.headers.get('x-cail-request-id')! } });
    const suggestion = mode === 'invalid' ? { unsupported: 'Invalid structured output' } : { guidance: [{ point: 'Identify the immediate setting in this synthetic memo.' }], nodes: [], connections: [], example: null, readiness: { ready: false, note: 'More detail would support a map.' } };
    return Response.json({ model: body.model, created: Math.floor(Date.now() / 1000), choices: [{ message: { role: 'assistant', content: JSON.stringify(suggestion) }, finish_reason: 'stop' }] });
  },
};
