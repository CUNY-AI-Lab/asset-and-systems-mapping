// Local browser fixture only, never referenced by release configuration.
import app from './worker';
let mode = 'accepted', signedIn = false;
let calls: unknown[] = [];
const reports = new Map<string, unknown>();
export default {
  async fetch(request: Request, env: any) {
    const headers = new Headers(request.headers); headers.set('cf-connecting-ip', '192.0.2.5');
    request = new Request(request, { headers });
    const url = new URL(request.url);
    if (url.pathname === '/__bug-fixture') {
      if (request.method === 'POST') { const data = await request.json<any>(); mode = data.mode; signedIn = Boolean(data.signedIn); calls = []; reports.clear(); }
      return Response.json({ mode, calls });
    }
    if (signedIn && url.pathname === '/api/cloud/account') return Response.json({ account: { cacheKey: 'bug-report-browser-fixture', role: 'student' } });
    if (signedIn && url.pathname === '/api/cloud/projects') return Response.json({ projects: [] });
    if (signedIn && url.pathname.startsWith('/api/cloud/projects/') && request.method === 'PUT') return Response.json({ revision: 1 });
    if (signedIn && url.pathname === '/api/cloud/quota') return Response.json({ quota: { remaining_percent: 90 } });
    if (signedIn && url.pathname === '/api/student/session') return Response.json({ access: {
      expiresAt: new Date(Date.now() + 3600000).toISOString(), persistence: 'local-server',
      retentionDays: { evaluation: 1, pending: 30, decided: 180 },
      suggestionRuntime: { provider: 'deterministic', model: 'fixture' },
    } });
    if (signedIn && url.pathname === '/api/config/public') return Response.json({
      configKind: url.searchParams.get('configKind'), scale: url.searchParams.get('scale'),
      fingerprint: 'fixture-config', guardrailsFingerprint: 'fixture-guardrails', revision: 1, moduleVersions: [],
    });
    if (signedIn && url.pathname === '/api/prototype/events') return Response.json({ ok: true });
    const service = { submit: async (report: any) => {
      calls.push(report);
      if (mode === 'unavailable') return { ok: false, code: 'unavailable', retryable: true, retryAfterSeconds: 1 };
      if (mode === 'unknown') return { ok: false, code: 'delivery_unknown', retryable: false, reportId: report.reportId };
      if (!reports.has(report.reportId)) reports.set(report.reportId, { ok: true, status: 'accepted', reportId: report.reportId });
      return reports.get(report.reportId);
    } };
    return app.fetch(request, { ...env, PUBLIC_ORIGIN: url.origin, BUG_REPORTS: service,
      IDENTITY: { identities: async () => ({ ok: false, status: 401 }) },
      ADMISSION_RESOLVER: { resolveMembership: async () => ({ ok: false, code: 'not_admitted' }) },
    });
  },
};
