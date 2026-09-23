// @vitest-environment node
import { beforeAll, expect, test } from 'vitest';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { authorize, type IdentityEnv } from './identity';
import { login } from './login';

let issuer: Awaited<ReturnType<typeof createTestIdentityIssuer>>;
beforeAll(async () => { issuer = await createTestIdentityIssuer(); });
const request = (cookie = 'alice') => new Request('https://systems-mapping.ailab-452.workers.dev/api/cloud/account', { headers: cookie ? { cookie: `__Host-systems-mapping-session=${cookie}` } : {} });
async function environment() {
  const grants = { ok: true as const, appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject: TEST_SUBJECTS.alice }), gatewayJwt: await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: TEST_SUBJECTS.alice }) };
  const membership = { ok: true, accessRole: 'member', budgetScope: 'person', revision: 1, expiresAt: new Date(Date.now() + 60000).toISOString() };
  const env = { CAIL_IDENTITY_JWKS: issuer.jwksJson, IDENTITY: { identities: async () => grants }, ADMISSION_RESOLVER: { resolveMembership: async () => membership } } as unknown as IdentityEnv;
  return { env, grants, membership };
}
test('configuration, absent session and invalid identities have distinct boundaries', async () => {
  const { env, grants } = await environment();
  expect((await authorize(request(''), env) as Response).status).toBe(401);
  expect((await authorize(request(''), { ...env, CAIL_IDENTITY_JWKS: '{}' }) as Response).status).toBe(503);
  for (const token of ['forged', await issuer.mintIdentityJwt({ audience: 'cail:gateway' }), await issuer.mintIdentityJwt({ audience: ['cail:systems-mapping'] }), await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', expiresInSeconds: -120 }), await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', issuer: 'https://invalid.example' })]) {
    grants.appJwt = token;
    expect((await authorize(request(), env) as Response).status).toBe(401);
  }
});
test('both exact identity legs must describe one subject; JWT entitlements do not grant instructor authority', async () => {
  const { env, grants } = await environment();
  grants.appJwt = await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', subject: TEST_SUBJECTS.alice, entitlements: ['admin'] });
  expect(await authorize(request(), env)).toMatchObject({ subject: TEST_SUBJECTS.alice, admin: false });
  grants.gatewayJwt = await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: TEST_SUBJECTS.bob });
  expect((await authorize(request(), env) as Response).status).toBe(401);
});
test('fresh Admission expiry, role and membership govern every request', async () => {
  const { env, membership } = await environment();
  expect(await authorize(request(), env)).toMatchObject({ admin: false });
  membership.accessRole = membership.budgetScope = 'admin';
  expect(await authorize(request(), env)).toMatchObject({ admin: true });
  membership.budgetScope = 'person';
  expect((await authorize(request(), env) as Response).status).toBe(503);
  membership.accessRole = 'member'; membership.revision = -1;
  expect((await authorize(request(), env) as Response).status).toBe(503);
  membership.revision = 1; membership.expiresAt = new Date(Date.now() - 1).toISOString();
  expect((await authorize(request(), env) as Response).status).toBe(403);
  env.ADMISSION_RESOLVER.resolveMembership = async () => ({ ok: false, code: 'not_admitted' });
  expect((await authorize(request(), env) as Response).status).toBe(403);
  env.ADMISSION_RESOLVER.resolveMembership = async () => { throw new Error('private details'); };
  const result = await authorize(request(), env) as Response;
  expect(result.status).toBe(503); expect(await result.text()).not.toContain('private details');
});
test('PKCE sign-in keeps proofs and opaque sessions in HttpOnly cookies and rejects non-v4 codes', async () => {
  let calls = 0;
  const token = `${crypto.randomUUID()}.${'s'.repeat(43)}`;
  const identity = { begin: async () => ({ url: 'https://tools.ailab.gc.cuny.edu/worker-login?request=fixture' }), redeem: async () => { calls++; return { ok: true as const, token, expiresAt: Date.now() + 60000 }; }, identities: async () => ({ ok: false as const, status: 401 }), revoke: async () => ({ revoked: true }) };
  const start = await login(new Request('https://systems-mapping.ailab-452.workers.dev/auth/start'), identity);
  expect(start.status).toBe(302);
  const proofCookie = start.headers.get('set-cookie')!;
  expect(proofCookie).toContain('Secure; HttpOnly; SameSite=Lax');
  const cookie = proofCookie.split(';')[0];
  const saved = JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)));
  const callback = (code: string, state = saved.state) => new Request(`https://systems-mapping.ailab-452.workers.dev/auth/callback?code=${code}&state=${state}`, { headers: { cookie } });
  expect((await login(callback(crypto.randomUUID(), 'wrong-state'), identity)).status).toBe(401);
  expect((await login(callback('01900000-0000-7000-8000-000000000001'), identity)).status).toBe(401);
  expect(calls).toBe(0);
  const accepted = await login(callback(crypto.randomUUID()), identity);
  expect(calls).toBe(1); expect(accepted.headers.get('set-cookie')).toContain(token);
  expect(accepted.headers.get('location')).toBe('/'); expect(await accepted.text()).toBe('');
  for (const [target, expected] of [['/p/' + 'a'.repeat(32), '/p/' + 'a'.repeat(32)], ['https://other.example/', '/'], ['//other.example/', '/']]) {
    const next = await login(new Request(`https://systems-mapping.ailab-452.workers.dev/auth/start?returnTo=${encodeURIComponent(target)}`), identity);
    const nextCookie = next.headers.get('set-cookie')!.split(';')[0];
    const nextSaved = JSON.parse(decodeURIComponent(nextCookie.slice(nextCookie.indexOf('=') + 1)));
    const returned = await login(new Request(`https://systems-mapping.ailab-452.workers.dev/auth/callback?code=${crypto.randomUUID()}&state=${nextSaved.state}`, { headers: { cookie: nextCookie } }), identity);
    expect(returned.headers.get('location')).toBe(expected);
  }
});
