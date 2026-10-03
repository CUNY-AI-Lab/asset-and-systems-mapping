// Test-harness-only services. Never referenced by a release configuration.
import { WorkerEntrypoint } from 'cloudflare:workers';
type FixtureEnv = { TEST_TOKENS: string };
let mode = 'success';
let calls = 0;
let captured: Record<string, unknown> | null = null;
let denied = false;
const revoked = new Set<string>();
const loginToken = '00000000-0000-4000-8000-000000000001.' + 's'.repeat(43);
export class Identity extends WorkerEntrypoint<FixtureEnv> {
  async begin(_challenge: string, _state: string) { return { url: 'https://tools.ailab.gc.cuny.edu/worker-login?request=fixture' }; }
  async redeem(_code: string, _verifier: string) { revoked.delete(loginToken); return { ok: true, token: loginToken, expiresAt: Date.now() + 60000 }; }
  async identities(token: string) {
    if (revoked.has(token)) return { ok: false, status: 401 };
    const tokens = JSON.parse(this.env.TEST_TOKENS);
    const value = tokens[token === loginToken ? 'alice' : token];
    return value ? { ok: true, ...value } : { ok: false, status: 401 };
  }
  async revoke(token: string) { revoked.add(token); return { revoked: true }; }
}
export class Admission extends WorkerEntrypoint<FixtureEnv> {
  async resolveMembership({ subject }: { subject: string }) {
    if (denied) return { ok: false, code: 'not_admitted' };
    const admin = subject === JSON.parse(this.env.TEST_TOKENS).admin.subject;
    return { ok: true, accessRole: admin ? 'admin' : 'member', budgetScope: admin ? 'admin' : 'person', revision: 1, expiresAt: new Date(Date.now() + 60000).toISOString() };
  }
}
export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === '/control') {
      if (request.method === 'POST') { const value = await request.json<{ mode?: string; denied?: boolean }>(); mode = value.mode ?? mode; denied = value.denied ?? denied; calls = 0; captured = null; }
      return Response.json({ calls, captured });
    }
    if (url.pathname === '/v1/quota') return Response.json({ object: 'quota', managed_by: 'cloudflare', state: 'estimated', unit: 'microdollar', currency: 'USD', limit: 1000, estimated_used: 100, estimated_remaining: 900, used_percent: 10, remaining_percent: 90, window_seconds: 86400, window_technique: 'fixed', calculated_at: Date.now() });
    if (url.pathname !== '/v1/chat/completions') return new Response(null, { status: 404 });
    calls++;
    const body = await request.json<Record<string, unknown>>();
    captured = { model: body.model, identity: Boolean(request.headers.get('x-cail-identity-jwt')), authorization: request.headers.has('authorization'), requestId: request.headers.get('x-cail-request-id') };
    if (mode === 'quota') return Response.json({ error: { code: 'quota_exceeded', type: 'insufficient_quota', message: 'Test refusal', param: null } }, { status: 429, headers: { 'x-should-retry': 'false', 'x-request-id': request.headers.get('x-cail-request-id')! } });
    const suggestion = mode === 'invalid' ? { unsupported: 'Invalid structured output' } : { guidance: [{ point: 'Identify the immediate setting in this synthetic memo.' }], nodes: [], connections: [], example: null, readiness: { ready: false, note: 'More detail would support a map.' } };
    return Response.json({ model: body.model, created: Math.floor(Date.now() / 1000), choices: [{ message: { role: 'assistant', content: JSON.stringify(suggestion) }, finish_reason: 'stop' }] });
  },
};
