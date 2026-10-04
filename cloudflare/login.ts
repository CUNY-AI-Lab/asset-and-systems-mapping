import { uniqueCookie, parseLoginTransaction, LOGIN_TTL_MS, validSessionToken } from './session-contract/session.js';
import { boundedRpc } from './bounded.js';
export type Identities = { ok: true; appJwt: string; gatewayJwt: string } | { ok: false; status: number };
export interface IdentityClient {
  begin(challenge: string, state: string): Promise<{ url: string }>;
  redeem(code: string, verifier: string): Promise<{ ok: true; token: string; expiresAt: number } | { ok: false; status: number }>;
  identities(token: string): Promise<Identities>;
  revoke(token: string): Promise<unknown>;
}
const sessionName = '__Host-systems-mapping-session';
const loginName = '__Host-systems-mapping-login';
const returnPath = (value: unknown) => typeof value === 'string' && /^\/p\/[A-Za-z0-9_-]{20,64}\/?$/.test(value) ? value : '/';
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)));
export const readCookie = (request: Request, name = sessionName) => uniqueCookie(request, name);
const cookie = (name: string, value: string, seconds: number) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
function redirect(location: string, cookies: string[]) {
  const headers = new Headers({ location, 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer' });
  for (const value of cookies) headers.append('Set-Cookie',value);
  return new Response(null,{status:302,headers});
}
export async function login(request: Request, identity: IdentityClient): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/auth/start' && request.method === 'GET') {
    const verifier = random(), state = random();
    const challenge = base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    const target = await boundedRpc(identity.begin(challenge,state),request.signal);
    const parsed = new URL(target.url);
    if (parsed.origin !== 'https://tools.ailab.gc.cuny.edu' || parsed.pathname !== '/worker-login' || parsed.username || parsed.password || parsed.hash) throw new Error('login target');
    return redirect(target.url,[cookie(loginName,encodeURIComponent(JSON.stringify({verifier,state,returnTo:returnPath(url.searchParams.get('returnTo')),expiresAt:Date.now()+LOGIN_TTL_MS})),600)]);
  }
  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const fail = (status: number) => {
      const response = Response.json({error:'CUNY sign-in could not be completed.'},{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      response.headers.append('Set-Cookie',cookie(loginName,'',0));
      return response;
    };
    const saved = parseLoginTransaction(readCookie(request,loginName),url.searchParams);
    if (!saved) return fail(401);
    const code = url.searchParams.get('code')!;
    let result;
    try { result = await boundedRpc(identity.redeem(code,saved.verifier),request.signal); }
    catch { return fail(503); }
    if (!result.ok) return fail([401,403].includes(result.status) ? result.status : 503);
    if (!validSessionToken(result.token) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) return fail(503);
    const previous = readCookie(request);
    if (validSessionToken(previous) && previous !== result.token) {
      try { await boundedRpc(identity.revoke(previous),request.signal); }
      catch {
        // Do not install a replacement when retiring the old session is uncertain.
        try { await boundedRpc(identity.revoke(result.token),request.signal); } catch { /* No browser installation. */ }
        return fail(503);
      }
    }
    return redirect(returnPath(saved.returnTo),[cookie(sessionName,result.token,Math.min(86400,Math.max(0,Math.floor((result.expiresAt-Date.now())/1000)))),cookie(loginName,'',0)]);
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    const token=readCookie(request);
    try { if (token) await boundedRpc(identity.revoke(token),request.signal); }
    catch {
      const response = Response.json({error:'Signed out of this browser. Server session revocation could not be confirmed.'},{status:503,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      response.headers.append('Set-Cookie',cookie(sessionName,'',0));
      response.headers.append('Set-Cookie',cookie(loginName,'',0));
      return response;
    }
    return redirect('/',[cookie(sessionName,'',0),cookie(loginName,'',0)]);
  }
  return new Response(null,{status:405});
}
