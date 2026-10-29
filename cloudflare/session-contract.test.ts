// @vitest-environment node
import { beforeAll, expect, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createTestIdentityIssuer } from '@cuny-ai-lab/cail-identity/testing';
import { login, readCookie, returnPath, signInFailure, type IdentityClient } from './login.ts';
const origin='https://systems-mapping.ailab-452.workers.dev';
const sessionName='__Host-systems-mapping-session', loginName='__Host-systems-mapping-login';
const documentHeaders = { accept: 'text/html', 'sec-fetch-dest': 'document' };
let issuer: Awaited<ReturnType<typeof createTestIdentityIssuer>>;
beforeAll(async () => { issuer = await createTestIdentityIssuer(); });
test('course selection and course project links survive only bounded local login returns', () => {
  for (const path of ['/?course=synthetic-course-a', '/p/abcdefghijklmnopqrst?course=synthetic-course-a', '/?view=instructor', '/?course=synthetic-course-a&view=instructor']) assert.equal(returnPath(path), path);
  for (const path of ['//other.example/?course=synthetic-course-a', '/?course=a&course=b', '/?course=search', '/?course=a#fragment', '/?course=a&next=https://other.example', '/?course=%61', '/teacher?course=a', '/?course=a\n', '/?view=admin', '/?view=instructor&view=instructor', '/?course=a?view=instructor', '/&view=instructor', '/p/abcdefghijklmnopqrst?course=a&view=instructor', '/?course=a&view=instructor#fragment', '/?course=a&view=instructor&next=https://other.example']) assert.equal(returnPath(path), '/');
});
function fixture() {
 let calls=0,begins=0;const used=new Set<string>();
 const token=crypto.randomUUID()+'.'+'s'.repeat(43);
 const identity: IdentityClient={begin:async()=>{begins++;return {url:'https://tools.ailab.gc.cuny.edu/worker-login'};},redeem:async(code:string)=>{calls++;if(used.has(code))return {ok:false as const,status:401};used.add(code);return {ok:true as const,token,expiresAt:Date.now()+3600000};},identities:async()=>({ok:false as const,status:401}),revoke:async()=>({revoked:true})};
 const req=(path:string,cookie='',method='GET',headers:Record<string,string>={})=>new Request(origin+path,{method,headers:{cookie,origin,...headers}});
 return {identity,req,token,calls:()=>calls,begins:()=>begins};
}
async function transaction(f:ReturnType<typeof fixture>, target = '/') {
 const start=await login(f.req('/auth/start?returnTo='+encodeURIComponent(target)),f.identity);
 const cookie=start.headers.get('set-cookie')!.split(';')[0];
 const saved=JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=')+1)));
 const path='/auth/callback?code='+crypto.randomUUID()+'&state='+saved.state;
 return {cookie,saved,path};
}
test('fresh handoff and replay rejection use the service authority',async()=>{
 const f=fixture(), t=await transaction(f);
 const success=await login(f.req(t.path,t.cookie),f.identity);
 assert.equal(success.status,303); assert.match(success.headers.get('set-cookie')!,/HttpOnly/);
 assert.equal((await login(f.req(t.path,t.cookie),f.identity)).status,401);
});
test('fresh sign-in returns to the bounded course instructor destination', async () => {
 const f = fixture(), target = '/?course=synthetic-course-a&view=instructor', t = await transaction(f, target);
 assert.equal(t.saved.returnTo, target);
 const success = await login(f.req(t.path, t.cookie), f.identity);
 assert.equal(success.status, 303);
 assert.equal(success.headers.get('location'), target);
});
test('duplicate session cookies are not accepted',()=>{
 const f=fixture();assert.equal(readCookie(f.req('/',sessionName+'=a; '+sessionName+'=b')),'');
});
test('duplicate callback parameters never redeem',async()=>{
 const f=fixture(), t=await transaction(f);
 assert.equal((await login(f.req(t.path+'&state='+t.saved.state,t.cookie),f.identity)).status,401);
 assert.equal(f.calls(),0);
});
test('expired transaction never redeems and clears its browser cookie',async()=>{
 const f=fixture(), t=await transaction(f);t.saved.expiresAt=Date.now()-1;
 const cookie=loginName+'='+encodeURIComponent(JSON.stringify(t.saved));
 const response=await login(f.req(t.path,cookie),f.identity);
 assert.equal(response.status,401);assert.equal(f.calls(),0);assert.match(response.headers.get('set-cookie')||'',/Max-Age=0/);
});
test('logout clears browser credentials even when remote revocation fails',async()=>{
 const f=fixture(); f.identity.revoke=async()=>{throw new Error('private outage detail');};
 const response=await login(f.req('/auth/logout',sessionName+'='+f.token,'POST'),f.identity);
 assert.equal(response.status,503);assert.match(response.headers.get('set-cookie')||'',/Max-Age=0/);
 assert.ok(!(await response.text()).includes('private outage detail'));
});
test('new session retires the previous app session',async()=>{
 const f=fixture(), t=await transaction(f);let retired='';
 f.identity.revoke=async(token?:string)=>{retired=token!;return {revoked:true};};
 const previous=crypto.randomUUID()+'.'+'p'.repeat(43);
 assert.equal((await login(f.req(t.path,t.cookie+'; '+sessionName+'='+previous),f.identity)).status,303);
 assert.equal(retired,previous);
});
test('failed previous-session retirement does not install the new session',async()=>{
 const f=fixture(), t=await transaction(f);const retired:string[]=[];
 const previous=crypto.randomUUID()+'.'+'p'.repeat(43);
 f.identity.revoke=async(token?:string)=>{retired.push(token!);if(token===previous)throw new Error('private failure');return {revoked:true};};
 const response=await login(f.req(t.path,t.cookie+'; '+sessionName+'='+previous),f.identity);
 assert.equal(response.status,503); assert.deepEqual(retired,[previous,f.token]);
 assert.ok(!response.headers.get('set-cookie')!.includes(f.token));
});
test('redeem outage is sanitized and clears only the pending transaction',async()=>{
 const f=fixture(), t=await transaction(f);f.identity.redeem=async()=>{throw new Error('private failure');};
 const response=await login(f.req(t.path,t.cookie),f.identity);
 assert.equal(response.status,503);assert.match(response.headers.get('set-cookie')||'',/Max-Age=0/);
 assert.ok(!(await response.text()).includes('private failure'));
});

async function signedFixture() {
  const f = fixture();
  const grants = { ok: true as const, appJwt: await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping' }), gatewayJwt: 'unused-navigation-leg' };
  const identities = vi.fn(async () => grants);
  f.identity.identities = identities;
  return { ...f, grants, identities, options: { CAIL_IDENTITY_JWKS: issuer.jwksJson } };
}

test('an existing verified Systems session navigates to its allowed destination without restarting login', async () => {
  for (const target of ['/', '/?course=synthetic-course-a', '/p/abcdefghijklmnopqrst?course=synthetic-course-a', 'https://other.example/']) {
    const f = await signedFixture();
    const response = await login(f.req('/auth/start?returnTo='+encodeURIComponent(target), sessionName+'='+f.token, 'GET', documentHeaders), f.identity, f.options);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(returnPath(target));
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(f.identities).toHaveBeenCalledExactlyOnceWith(f.token);
    expect(f.begins()).toBe(0);
    expect(f.calls()).toBe(0);
  }
});

test('session recovery is document navigation only, with Accept as a fallback when fetch destination is absent', async () => {
  for (const [headers, reused] of [[{ accept: 'text/html' }, true], [{ accept: 'text/html', 'sec-fetch-dest': 'empty' }, false], [{ accept: 'application/json' }, false]] as const) {
    const f = await signedFixture();
    const response = await login(f.req('/auth/start', sessionName+'='+f.token, 'GET', headers), f.identity, f.options);
    expect(response.headers.get('location')).toBe(reused ? '/' : 'https://tools.ailab.gc.cuny.edu/worker-login');
    expect(f.begins()).toBe(reused ? 0 : 1);
    expect(f.identities).toHaveBeenCalledTimes(reused ? 1 : 0);
  }
});

test('a cookie shape or duplicate cookie never substitutes for Doorway authority', async () => {
  const f = await signedFixture();
  for (const raw of [sessionName+'=invented', sessionName+'=01900000-0000-7000-8000-000000000001.'+'s'.repeat(43), sessionName+'='+f.token+'; '+sessionName+'='+f.token]) {
    const response = await login(f.req('/auth/start', raw, 'GET', documentHeaders), f.identity, f.options);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/worker-login');
  }
  expect(f.identities).not.toHaveBeenCalled();
});

test('stale callback documents recover home only after fresh Doorway and exact app verification', async () => {
  const f = await signedFixture(), target = '/p/abcdefghijklmnopqrst?course=synthetic-course-a';
  const t = await transaction(f, target);
  t.saved.expiresAt = Date.now()-1;
  const pending = loginName+'='+encodeURIComponent(JSON.stringify(t.saved));
  const response = await login(f.req(t.path, pending+'; '+sessionName+'='+f.token, 'GET', documentHeaders), f.identity, f.options);
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/');
  expect(response.headers.get('set-cookie')).toContain(loginName+'=;');
  expect(response.headers.get('set-cookie')).not.toContain(sessionName);
  expect(f.identities).toHaveBeenCalledExactlyOnceWith(f.token);
  expect(f.calls()).toBe(0);
});

test('a replay rejected by Doorway can recover navigation but never the stale destination or session', async () => {
  const f = await signedFixture(), target = '/?course=synthetic-course-a';
  const t = await transaction(f, target);
  expect((await login(f.req(t.path,t.cookie), f.identity,f.options)).headers.get('location')).toBe(target);
  const response = await login(f.req(t.path,t.cookie+'; '+sessionName+'='+f.token,'GET',documentHeaders),f.identity,f.options);
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/');
  expect(response.headers.get('set-cookie')).not.toContain(sessionName);
  expect(f.calls()).toBe(2);
  expect(f.identities).toHaveBeenCalledOnce();
});

test('non-document stale callbacks retain a structured denial and do not look up an existing session', async () => {
  const f = await signedFixture();
  const response = await login(f.req('/auth/callback?code=stale&state=stale',sessionName+'='+f.token),f.identity,f.options);
  expect(response.status).toBe(401);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(f.identities).not.toHaveBeenCalled();
});

test('navigation refuses wrong audience, expiry, signature and malformed JWT rather than restarting login', async () => {
  const f = await signedFixture();
  for (const appJwt of [
    'forged', '', 'x'.repeat(16385),
    await issuer.mintIdentityJwt({ audience: 'cail:stem-splitter' }),
    await issuer.mintIdentityJwt({ audience: 'cail:gateway' }),
    await issuer.mintIdentityJwt({ audience: ['cail:systems-mapping'] }),
    await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', expiresInSeconds: -120 }),
    await issuer.mintIdentityJwt({ audience: 'cail:systems-mapping', issuer: 'https://other.example' }),
  ]) {
    f.grants.appJwt = appJwt;
    for (const path of ['/auth/start', '/auth/callback?code=old&state=old']) {
      const response = await login(f.req(path,sessionName+'='+f.token,'GET',documentHeaders),f.identity,f.options);
      expect(response.status).toBe(503);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).not.toContain(appJwt || 'private diagnostic');
    }
  }
  expect(f.begins()).toBe(0);
  expect(f.calls()).toBe(0);
});

test('broken verifier configuration cannot recover an existing session', async () => {
  const f = await signedFixture();
  const response = await login(f.req('/auth/start',sessionName+'='+f.token,'GET',documentHeaders),f.identity,{CAIL_IDENTITY_JWKS:'{}'});
  expect(response.status).toBe(503);
  expect(f.begins()).toBe(0);
});

test.each([401,403,500])('current Doorway session denial %s determines stale callback recovery', async status => {
  const f = await signedFixture();
  f.identity.identities = async () => ({ok:false,status});
  const response = await login(f.req('/auth/callback',sessionName+'='+f.token,'GET',documentHeaders),f.identity,f.options);
  expect(response.status).toBe(status === 500 ? 503 : status);
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('content-type')).toContain('text/html');
  expect(response.headers.get('set-cookie')).toContain(loginName+'=;');
});

test.each([401,403,503])('callback denial %s supplies fixed HTML recovery without reflecting callback material', async status => {
  const f = fixture(), t = await transaction(f);
  f.identity.redeem = async () => ({ok:false,status});
  const response = await login(f.req(t.path+'&error=%3Cscript%3Eprivate%3C%2Fscript%3E',t.cookie,'GET',documentHeaders),f.identity);
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('text/html');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  const html = await response.text();
  expect(html).toContain(status === 403 ? 'Request Lab access' : '/auth/start');
  expect(html).not.toContain(t.saved.state);
  expect(html).not.toContain('private');
  expect(html).not.toContain('<script');
});

test('start failures and limiter failures use safe recovery with a useful next action', async () => {
  const f = fixture();
  for (const url of ['https://other.example/worker-login', 'https://tools.ailab.gc.cuny.edu/other', 'https://tools.ailab.gc.cuny.edu/worker-login#private']) {
    f.identity.begin = async () => ({url});
    const response = await login(f.req('/auth/start','','GET',documentHeaders),f.identity);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(url);
  }
  f.identity.begin = () => {throw new Error('private begin diagnostic');};
  const response = await login(f.req('/auth/start','','GET',documentHeaders),f.identity);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private begin diagnostic');
  const limited = signInFailure(f.req('/auth/start','','GET',documentHeaders),429);
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).toBe('60');
  expect(await limited.text()).toContain('Wait a minute');
});

test('logout uncertainty is safe HTML and clears both browser cookies even without a service', async () => {
  const f = fixture();
  for (const identity of [undefined, {...f.identity,revoke:async()=>{throw new Error('private server error');}}]) {
    const response = await login(f.req('/auth/logout',sessionName+'='+f.token,'POST',documentHeaders),identity);
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('set-cookie')).toContain(sessionName+'=;');
    expect(response.headers.get('set-cookie')).toContain(loginName+'=;');
    const html = await response.text();
    expect(html).toContain('Signed out of this browser');
    expect(html).toContain('Close any other Systems Mapping tabs');
    expect(html).not.toContain('private server error');
  }
});

test('logout still rejects cross-origin and cross-site requests before revocation or cookie mutation', async () => {
  const f = fixture(), revoke = vi.fn(async()=>({revoked:true})); f.identity.revoke = revoke;
  for (const headers of [{origin:'https://other.example'}, {origin:'null'}, {'sec-fetch-site':'cross-site'}]) {
    const response = await login(f.req('/auth/logout',sessionName+'='+f.token,'POST',headers),f.identity);
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  }
  expect(revoke).not.toHaveBeenCalled();
});

test('session lookups and logout revocation remain bounded during an outage', async () => {
  const f = await signedFixture();
  vi.useFakeTimers();
  try {
    f.identity.identities = () => new Promise(()=>{});
    const pending = login(f.req('/auth/start',sessionName+'='+f.token,'GET',documentHeaders),f.identity,f.options);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).status).toBe(503);
    expect(f.begins()).toBe(0);
    f.identity.revoke = () => new Promise(()=>{});
    const logout = login(f.req('/auth/logout',sessionName+'='+f.token,'POST',documentHeaders),f.identity);
    await vi.advanceTimersByTimeAsync(5000);
    const response = await logout;
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toContain(sessionName+'=;');
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('cancelled navigation never starts a new identity call', async () => {
  const f = await signedFixture();
  const controller = new AbortController(); controller.abort(new Error('private cancellation reason'));
  const request = new Request(f.req('/auth/start',sessionName+'='+f.token,'GET',documentHeaders), {signal:controller.signal});
  const response = await login(request,f.identity,f.options);
  expect(response.status).toBe(503);
  expect(f.identities).not.toHaveBeenCalled();
  expect(f.begins()).toBe(0);
  expect(await response.text()).not.toContain('private cancellation reason');
});

test('fresh handoffs retain strict UUIDv4 session validation and allowed course project paths', async () => {
  const f = fixture(), target = '/p/abcdefghijklmnopqrst?course=synthetic-course-a';
  const t = await transaction(f,target);
  const response = await login(f.req(t.path,t.cookie),f.identity);
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(target);
  for (const token of ['01900000-0000-7000-8000-000000000001.'+'s'.repeat(43), f.token+'\n']) {
    f.identity.redeem = async () => ({ok:true,token,expiresAt:Date.now()+60000});
    const refused = await login(f.req(t.path,t.cookie),f.identity);
    expect(refused.status).toBe(503);
    expect(refused.headers.get('set-cookie')).not.toContain(sessionName);
  }
});
