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
const proof = /^[A-Za-z0-9_-]{43}$/;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const returnPath = (value: unknown) => typeof value === 'string' && /^\/p\/[A-Za-z0-9_-]{20,64}\/?$/.test(value) ? value : '/';
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)));
export const readCookie = (request: Request, name = sessionName) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name+'='))?.slice(name.length+1) || '';
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
    return redirect(target.url,[cookie(loginName,encodeURIComponent(JSON.stringify({verifier,state,returnTo:returnPath(url.searchParams.get('returnTo'))})),600)]);
  }
  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const raw = readCookie(request,loginName);
    if (!raw || raw.length > 1000) return Response.json({error:'Start sign-in again.'},{status:401});
    let saved;
    try { saved=JSON.parse(decodeURIComponent(raw)); } catch { return Response.json({error:'Start sign-in again.'},{status:401}); }
    const code = url.searchParams.get('code');
    if (!saved || !proof.test(saved.verifier) || !proof.test(saved.state) || saved.state !== url.searchParams.get('state') || !code || !uuidV4.test(code)) return Response.json({error:'Start sign-in again.'},{status:401});
    const result = await boundedRpc(identity.redeem(code,saved.verifier),request.signal);
    if (!result.ok) return Response.json({error:'CUNY sign-in could not be completed.'},{status:[401,403].includes(result.status) ? result.status : 503});
    const pieces = typeof result.token === 'string' ? result.token.split('.') : [];
    if (pieces.length !== 2 || !uuidV4.test(pieces[0]) || !proof.test(pieces[1]) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error('session contract');
    return redirect(returnPath(saved.returnTo),[cookie(sessionName,result.token,Math.max(0,Math.floor((result.expiresAt-Date.now())/1000))),cookie(loginName,'',0)]);
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    const token=readCookie(request);
    if (token) await boundedRpc(identity.revoke(token),request.signal);
    return redirect('/',[cookie(sessionName,'',0),cookie(loginName,'',0)]);
  }
  return new Response(null,{status:405});
}
