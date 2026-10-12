import type { CourseAccess } from './course-access';
import { CAIL_CANONICAL_ISSUER, loadIdentityVerifierConfig, verifyIdentityJwt } from '@cuny-ai-lab/cail-identity';
import { boundedRpc } from './bounded.js';
import { readCookie, type IdentityClient } from './login';
import publicJwks from './jwks.json';

export type Principal = { subject: string; admin: boolean; expiresAt: number; gatewayJwt: string; course?: CourseAccess };
export type IdentityEnv = {
  IDENTITY: IdentityClient;
  ADMISSION_RESOLVER: { resolveMembership(input: { subject: string }): Promise<unknown>; resolveCourseAccess?(input: { subject: string; app: string; classId: string }): Promise<unknown> };
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
  if (!cookie || cookie.length > 200) return authFailure(401, 'authentication_required');
  let grants;
  try { grants = await boundedRpc(env.IDENTITY.identities(cookie), request.signal); }
  catch { return authFailure(503, 'identity_unavailable'); }
  if (!grants || typeof grants !== 'object') return authFailure(503, 'identity_unavailable');
  if (grants.ok !== true) return authFailure(grants.status === 403 ? 403 : grants.status === 401 ? 401 : 503,
    grants.status === 403 ? 'admission_required' : grants.status === 401 ? 'session_invalid' : 'identity_unavailable');
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
  return { subject: appIdentity.subject, admin: value.accessRole === 'admin', expiresAt, gatewayJwt: grants.gatewayJwt };
}
