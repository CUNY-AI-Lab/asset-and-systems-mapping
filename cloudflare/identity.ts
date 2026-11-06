import type { CourseAccess } from './course-access';
import { CAIL_CANONICAL_ISSUER, loadIdentityVerifierConfig, verifyIdentityJwt } from '@cuny-ai-lab/cail-identity';
import { boundedRpc } from './bounded.js';
import { readCookie, type IdentityClient } from './login';
import { validSessionToken } from './session-contract/session.js';
import publicJwks from './jwks.json';

export type Principal = { subject: string; preferredName?: string | null; email?: string | null; admin: boolean; expiresAt: number; gatewayJwt: string; course?: CourseAccess };
export type IdentityEnv = {
  IDENTITY: IdentityClient;
  ADMISSION_RESOLVER: { resolveMembership(input: { subject: string }): Promise<unknown>; resolveCourseAccessV2?(input: { subject: string; app: string; classId: string }): Promise<unknown> };
  CAIL_IDENTITY_JWKS?: string;
};
export const authFailure = (status: number, code: string) => Response.json({
  error: status === 503 ? 'Sign-in is temporarily unavailable.' : status === 403
    ? 'Active CUNY AI Lab access is required.' : 'Sign in with CUNY Login to continue.',
  details: { code },
}, { status });

export async function verifierConfigs(env: IdentityEnv) {
  const jwks = env.CAIL_IDENTITY_JWKS ?? JSON.stringify(publicJwks);
  return Promise.all(['cail:systems-mapping', 'cail:gateway'].map(expectedAudience =>
    loadIdentityVerifierConfig({ jwks, issuer: CAIL_CANONICAL_ISSUER, expectedAudience, supportedIssuers: [CAIL_CANONICAL_ISSUER] })));
}

export async function authorize(request: Request, env: IdentityEnv): Promise<Principal | Response> {
  // Configuration has a distinct 503 boundary, including when no cookie exists.
  const [appConfig, gatewayConfig] = await verifierConfigs(env);
  if (!appConfig.ok || !gatewayConfig.ok || !env.IDENTITY || !env.ADMISSION_RESOLVER) return authFailure(503, 'identity_verification_misconfigured');
  const cookie = readCookie(request);
  if (!validSessionToken(cookie)) return authFailure(401, 'authentication_required');
  const path = new URL(request.url).pathname;
  const report = path === "/api/bug-reports" || path === "/api/bug-reports/session";
  let grants;
  try { grants = await boundedRpc(report ? env.IDENTITY.identities(cookie, "private_report") : env.IDENTITY.identities(cookie), request.signal); }
  catch { return authFailure(503, 'identity_unavailable'); }
  if (!grants || typeof grants !== 'object') return authFailure(503, 'identity_unavailable');
  if (grants.ok !== true) return authFailure(grants.status === 403 ? 403 : grants.status === 401 ? 401 : 503,
    grants.status === 403 ? 'admission_required' : grants.status === 401 ? 'session_invalid' : 'identity_unavailable');
  if (typeof grants.appJwt !== 'string' || !grants.appJwt || grants.appJwt.length > 16384) return authFailure(503, 'identity_unavailable');
  if (typeof grants.gatewayJwt !== 'string' || !grants.gatewayJwt || grants.gatewayJwt.length > 16384) return authFailure(401, 'invalid_credential');
  const appIdentity = await verifyIdentityJwt(grants.appJwt, appConfig.config);
  const gatewayIdentity = await verifyIdentityJwt(grants.gatewayJwt, gatewayConfig.config);
  if (!appIdentity || !gatewayIdentity || appIdentity.subject !== gatewayIdentity.subject) return authFailure(401, 'invalid_credential');
  let membership: unknown;
  try { membership = await boundedRpc(env.ADMISSION_RESOLVER.resolveMembership({ subject: appIdentity.subject }), request.signal); }
  catch { return authFailure(503, 'admission_unavailable'); }
  if (!membership || typeof membership !== 'object') return authFailure(503, 'admission_unavailable');
  const value = membership as Record<string, unknown>;
  if (value.ok === false && value.code === 'not_admitted') return authFailure(403, 'admission_required');
  if (value.ok !== true || !['member', 'admin'].includes(String(value.accessRole))
    || !['person', 'person-plus', 'admin'].includes(String(value.budgetScope))
    || (value.accessRole === 'admin') !== (value.budgetScope === 'admin')
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) return authFailure(503, 'admission_unavailable');
  const expiresAt = Date.parse(value.expiresAt);
  if (expiresAt <= Date.now()) return authFailure(403, 'admission_required');
  const nameClaim = appIdentity.name || (report ? grants.reporter?.name : null);
  const emailClaim = (report ? grants.reporter?.email : null) || appIdentity.email;
  const preferredName = typeof nameClaim === 'string'
    ? nameClaim.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 160) || null : null;
  const email = typeof emailClaim === 'string' && emailClaim.length <= 254
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(emailClaim)
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClaim) ? emailClaim : null;
  return { subject: appIdentity.subject, preferredName, email, admin: value.accessRole === 'admin', expiresAt, gatewayJwt: grants.gatewayJwt };
}
