import { uniqueCookie, parseLoginTransaction, LOGIN_TTL_MS, validSessionToken } from './session-contract/session.js';
import { boundedRpc } from './bounded.js';
import { CAIL_CANONICAL_ISSUER, loadIdentityVerifierConfig, verifyIdentityJwt } from '@cuny-ai-lab/cail-identity';
import publicJwks from './jwks.json';
export type Identities = { ok: true; appJwt: string; gatewayJwt: string } | { ok: false; status: number };
export interface IdentityClient {
  begin(challenge: string, state: string): Promise<{ url: string }>;
  redeem(code: string, verifier: string): Promise<{ ok: true; token: string; expiresAt: number } | { ok: false; status: number }>;
  identities(token: string): Promise<Identities>;
  revoke(token: string): Promise<unknown>;
}
export interface LoginOptions { CAIL_IDENTITY_JWKS?: string }
const sessionName = '__Host-systems-mapping-session';
const loginName = '__Host-systems-mapping-login';
export function returnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) return '/';
  const match = /^(\/|\/p\/[A-Za-z0-9_-]{20,64}\/?)(?:\?course=([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?))?$/.exec(value);
  if (!match || match[0] !== value || match[2] === 'search') return '/';
  return value;
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)));
export const readCookie = (request: Request, name = sessionName) => uniqueCookie(request, name);
const cookie = (name: string, value: string, seconds: number) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
function redirect(location: string, cookies: string[]) {
  const headers = new Headers({ location, 'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer' });
  for (const value of cookies) headers.append('Set-Cookie',value);
  return new Response(null,{status:303,headers});
}

function isDocumentNavigation(request: Request): boolean {
  const destination = request.headers.get('sec-fetch-dest');
  return destination === null ? request.headers.get('accept')?.includes('text/html') === true : destination === 'document';
}

function recoveryPage(status: number, title: string, message: string, action: string): Response {
  // Every string and link on this page is application-owned. Never include a
  // callback code, state, JWT, service diagnostic or caller-selected path.
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Systems Mapping · Account</title><style>body{font-family:system-ui,sans-serif;line-height:1.6;margin:0;padding:1.5rem}main{max-width:38rem;margin:4rem auto}h1{font-size:1.75rem;line-height:1.2}a{color:inherit}p{margin:1.25rem 0}</style></head><body><main><h1>${title}</h1><p>${message}</p>${action}<p><a href="/">Back to Systems Mapping</a></p></main></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" },
  });
}

export function signInFailure(request: Request, status = 401): Response {
  const safe = status === 401 || status === 403 || status === 429 ? status : 503;
  const title = safe === 401 ? 'Start sign-in again' : safe === 403 ? 'Lab access required'
    : safe === 429 ? 'Wait a minute before trying again' : 'Sign-in is temporarily unavailable';
  const message = safe === 401 ? 'This sign-in link is no longer active. Sign in again to continue.'
    : safe === 403 ? 'You need active CUNY AI Lab access to continue. Request access, or contact the Lab if you were recently approved.'
    : safe === 429 ? 'You have tried signing in several times. Wait a minute and try again. Your saved maps have not changed.'
    : 'We could not reach the sign-in service. Try again shortly. Your saved maps have not changed.';
  const code = safe === 401 ? 'authentication_required' : safe === 403 ? 'admission_required'
    : safe === 429 ? 'sign_in_rate_limited' : 'identity_unavailable';
  const action = safe === 403
    ? '<p><a href="https://ailab.gc.cuny.edu/request-access/">Request Lab access</a></p><p><a href="mailto:ailab@gc.cuny.edu">Contact the Lab</a></p>'
    : `<p><a href="/auth/start">${safe === 401 ? 'CUNY Login' : 'Try again'}</a></p>`;
  const response = isDocumentNavigation(request) ? recoveryPage(safe, title, message, action)
    : Response.json({ error: message, details: { code } }, { status: safe, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  if (safe === 429) response.headers.set('Retry-After', '60');
  return response;
}

const sessionToken = (value: unknown): value is string => validSessionToken(value) && value.length === 80;
const rpc = <T>(request: Request, run: () => Promise<T>): Promise<T> => {
  if (request.signal.aborted) return Promise.reject(request.signal.reason);
  return boundedRpc(Promise.resolve().then(() => {
    if (request.signal.aborted) throw request.signal.reason;
    return run();
  }), request.signal);
};

async function existingSessionStatus(request: Request, identity: IdentityClient | undefined, options: LoginOptions): Promise<200 | 401 | 403 | 503> {
  const token = readCookie(request);
  if (!sessionToken(token)) return 401;
  if (!identity) return 503;
  try {
    // Doorway rechecks its session and Admission. A cookie alone is never proof
    // of access, and navigation still requires the exact Systems app identity.
    const result = await rpc(request, () => identity.identities(token));
    if (result?.ok !== true) return result?.ok === false && (result.status === 401 || result.status === 403) ? result.status : 503;
    const verifier = await loadIdentityVerifierConfig({ jwks: options.CAIL_IDENTITY_JWKS ?? JSON.stringify(publicJwks),
      issuer: CAIL_CANONICAL_ISSUER, expectedAudience: 'cail:systems-mapping', supportedIssuers: [CAIL_CANONICAL_ISSUER] });
    if (!verifier.ok || typeof result.appJwt !== 'string' || !result.appJwt || result.appJwt.length > 16384) return 503;
    return await verifyIdentityJwt(result.appJwt, verifier.config) ? 200 : 503;
  } catch { return 503; }
}

async function callbackFailure(request: Request, identity: IdentityClient | undefined, options: LoginOptions, status = 401): Promise<Response> {
  const current = status === 401 && isDocumentNavigation(request)
    ? await existingSessionStatus(request, identity, options) : status;
  // Recovery only navigates home. A stale transaction cannot choose a return
  // path, renew the browser session, or replay its one-use callback grant.
  const response = current === 200 ? redirect('/', []) : signInFailure(request, current);
  response.headers.append('Set-Cookie', cookie(loginName, '', 0));
  return response;
}

export async function login(request: Request, identity: IdentityClient | undefined, options: LoginOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/auth/start' && request.method === 'GET') {
    if (!identity) return signInFailure(request, 503);
    try {
      if (isDocumentNavigation(request)) {
        const status = await existingSessionStatus(request, identity, options);
        if (status === 200) return redirect(returnPath(url.searchParams.get('returnTo')), []);
        if (status !== 401) return signInFailure(request, status);
      }
      const verifier = random(), state = random();
      const challenge = base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
      const target = await rpc(request, () => identity.begin(challenge,state));
      const parsed = new URL(target.url);
      if (parsed.origin !== 'https://tools.ailab.gc.cuny.edu' || parsed.pathname !== '/worker-login' || parsed.username || parsed.password || parsed.hash) return signInFailure(request, 503);
      return redirect(target.url,[cookie(loginName,encodeURIComponent(JSON.stringify({verifier,state,returnTo:returnPath(url.searchParams.get('returnTo')),expiresAt:Date.now()+LOGIN_TTL_MS})),600)]);
    } catch { return signInFailure(request, 503); }
  }
  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const fail = (status: number) => callbackFailure(request, identity, options, status);
    const saved = parseLoginTransaction(readCookie(request,loginName),url.searchParams);
    if (!saved) return fail(401);
    if (!identity) return fail(503);
    const code = url.searchParams.get('code')!;
    let result;
    try { result = await rpc(request, () => identity.redeem(code,saved.verifier)); }
    catch { return fail(503); }
    if (result?.ok !== true) return fail(result?.ok === false && [401,403].includes(result.status) ? result.status : 503);
    if (!sessionToken(result.token) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) return fail(503);
    const previous = readCookie(request);
    if (sessionToken(previous) && previous !== result.token) {
      try { await rpc(request, () => identity.revoke(previous)); }
      catch {
        // Do not install a replacement when retiring the old session is uncertain.
        try { await rpc(request, () => identity.revoke(result.token)); } catch { /* No browser installation. */ }
        return fail(503);
      }
    }
    return redirect(returnPath(saved.returnTo),[cookie(sessionName,result.token,Math.min(86400,Math.max(0,Math.floor((result.expiresAt-Date.now())/1000)))),cookie(loginName,'',0)]);
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return signInFailure(request, 403);
    const token=readCookie(request);
    try {
      if (sessionToken(token)) {
        if (!identity) throw new Error('identity unavailable');
        await rpc(request, () => identity.revoke(token));
      }
    }
    catch {
      const response = recoveryPage(503, 'Signed out of this browser',
        'We could not confirm that your server session ended. Close any other Systems Mapping tabs on this device.', '');
      response.headers.append('Set-Cookie',cookie(sessionName,'',0));
      response.headers.append('Set-Cookie',cookie(loginName,'',0));
      return response;
    }
    return redirect('/',[cookie(sessionName,'',0),cookie(loginName,'',0)]);
  }
  return new Response(null,{status:405,headers:{Allow:url.pathname === '/auth/logout' ? 'POST' : 'GET'}});
}
