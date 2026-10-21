// Local synthetic/browser fixture only. Release config never references this file.
import app from './worker';
let mode = 'saved', denied = false, identityMode = 'valid', binding = true, limited = false;
let project: any = null;
let calls: any[] = [], identityCalls = 0, membershipCalls = 0, courseCalls = 0;
const reports = new Map<string, any>();
export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url), tokens = JSON.parse(env.TEST_TOKENS);
    if (url.pathname === '/__bug-fixture') {
      if (request.method === 'POST') {
        const data = await request.json<any>();
        mode = data.mode ?? 'saved'; denied = Boolean(data.denied); identityMode = data.identityMode ?? 'valid';
        binding = data.binding !== false; limited = Boolean(data.limited); project = data.project ?? null;
        calls = []; identityCalls = 0; membershipCalls = 0; courseCalls = 0;
        if (data.resetReports) reports.clear();
      }
      return Response.json({ mode, calls, stored: reports.size, identityCalls, membershipCalls, courseCalls });
    }
    const who = /(?:^|;\s*)bug-fixture-session=(alice|bob)(?:;|$)/.exec(request.headers.get('cookie') ?? '')?.[1];
    const signedIn = Boolean(who) && !denied;
    if (signedIn && url.pathname === '/api/cloud/account') return Response.json({ account: { cacheKey: `bug-report-browser-${who}`, role: 'student' } });
    if (signedIn && url.pathname === '/api/cloud/projects') return Response.json({ projects: project ? [{ id: project.id, title: project.title, revision: 1, updatedAt: project.updatedAt }] : [] });
    if (signedIn && project && url.pathname === `/api/cloud/projects/${project.id}` && request.method === 'GET') return Response.json({ project: JSON.stringify(project), revision: 1 });
    if (signedIn && url.pathname === '/api/cloud/courses') return Response.json({ courses: [] });
    if (signedIn && url.pathname.startsWith('/api/cloud/projects/') && request.method === 'PUT') return Response.json({ revision: 1 });
    if (signedIn && url.pathname === '/api/cloud/quota') return Response.json({ quota: { remaining_percent: 90 } });
    if (signedIn && url.pathname === '/api/student/session') return Response.json({ access: {
      expiresAt: new Date(Date.now() + 3600000).toISOString(), persistence: 'local-server',
      retentionDays: { evaluation: 1, pending: 30, decided: 180 }, suggestionRuntime: { provider: 'deterministic', model: 'fixture' },
    } });
    if (signedIn && url.pathname === '/api/config/public') return Response.json({
      configKind: url.searchParams.get('configKind'), scale: url.searchParams.get('scale'),
      fingerprint: 'fixture-config', guardrailsFingerprint: 'fixture-guardrails', revision: 1, moduleVersions: [],
    });
    if (signedIn && url.pathname === '/api/prototype/events') return Response.json({ ok: true });
    const service = { submitPublic: async (report: any) => {
      calls.push(report);
      if (mode === 'unavailable') return { ok: false, code: 'unavailable', retryable: true };
      if (mode === 'rate_limited') return { ok: false, code: 'rate_limited', retryable: true, retryAfterSeconds: 1 };
      const key = report.reportId, previous = reports.get(key);
      if (previous && previous.description !== report.description) return { ok: false, code: 'idempotency_conflict', retryable: false };
      if (!previous) reports.set(key, { description: report.description, result: { ok: true, status: 'accepted', reportId: report.reportId } });
      if (mode === 'lost-ack') throw new Error('Injected acknowledgement loss after fixture persistence');
      return reports.get(key).result;
    } };
    // The harness serves HTTP. Restate only the harness's own origin as HTTPS;
    // the production handler still sees foreign Origin/Referer values unchanged.
    const appOrigin = 'https://systems.test', appHeaders = new Headers(request.headers);
    if (appHeaders.get('origin') === url.origin) appHeaders.set('origin', appOrigin);
    const referer = appHeaders.get('referer');
    if (referer?.startsWith(url.origin + '/')) appHeaders.set('referer', appOrigin + referer.slice(url.origin.length));
    appHeaders.set('cf-connecting-ip', '192.0.2.5');
    if (who) appHeaders.set('cookie', `__Host-systems-mapping-session=${tokens[who].sessionToken}`);
    request = new Request(appOrigin + url.pathname + url.search, { method: request.method, headers: appHeaders, body: request.body, redirect: 'manual' });
    return app.fetch(request, { ...env, PUBLIC_ORIGIN: appOrigin, BUG_REPORTS: binding ? service : undefined,
      REQUEST_LIMIT: limited ? { limit: async () => ({ success: false }) } : env.REQUEST_LIMIT,
      IDENTITY: { identities: async (token: string) => {
        identityCalls++;
        const entry: any = Object.values(tokens).find((candidate: any) => candidate.sessionToken === token);
        if (!entry || identityMode === 'expired') return { ok: false, status: 401 };
        return { ok: true, appJwt: identityMode === 'forged' ? 'forged' : entry.appJwt,
          gatewayJwt: identityMode === 'mismatch' ? tokens.bob.gatewayJwt : entry.gatewayJwt };
      } },
      ADMISSION_RESOLVER: {
        resolveMembership: async () => {
          membershipCalls++;
          if (denied) return { ok: false, code: 'not_admitted' };
          return { ok: true, accessRole: 'member', budgetScope: 'person', revision: 1, expiresAt: new Date(Date.now() + 3600000).toISOString() };
        },
        resolveCourseAccessV2: async () => { courseCalls++; throw new Error('Injected course outage'); },
      },
    });
  },
};
