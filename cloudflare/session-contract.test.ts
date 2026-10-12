import { test } from 'vitest';
import assert from 'node:assert/strict';
import { login, readCookie, returnPath } from './login.ts';
const origin='https://systems-mapping.ailab-452.workers.dev';
const sessionName='__Host-systems-mapping-session', loginName='__Host-systems-mapping-login';
test('course selection and course project links survive only bounded local login returns', () => {
  for (const path of ['/?course=synthetic-course-a', '/p/abcdefghijklmnopqrst?course=synthetic-course-a']) assert.equal(returnPath(path), path);
  for (const path of ['//other.example/?course=synthetic-course-a', '/?course=a&course=b', '/?course=search', '/?course=a#fragment', '/?course=a&next=https://other.example', '/?course=%61', '/teacher?course=a']) assert.equal(returnPath(path), '/');
});
function fixture() {
 let calls=0;const used=new Set<string>();
 const token=crypto.randomUUID()+'.'+'s'.repeat(43);
 const identity={begin:async()=>({url:'https://tools.ailab.gc.cuny.edu/worker-login'}),redeem:async(code:string)=>{calls++;if(used.has(code))return {ok:false as const,status:401};used.add(code);return {ok:true as const,token,expiresAt:Date.now()+3600000};},identities:async()=>({ok:false as const,status:401}),revoke:async()=>({revoked:true})};
 const req=(path:string,cookie='',method='GET')=>new Request(origin+path,{method,headers:{cookie,origin}});
 return {identity,req,token,calls:()=>calls};
}
async function transaction(f:ReturnType<typeof fixture>) {
 const start=await login(f.req('/auth/start'),f.identity);
 const cookie=start.headers.get('set-cookie')!.split(';')[0];
 const saved=JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=')+1)));
 const path='/auth/callback?code='+crypto.randomUUID()+'&state='+saved.state;
 return {cookie,saved,path};
}
test('fresh handoff and replay rejection use the service authority',async()=>{
 const f=fixture(), t=await transaction(f);
 const success=await login(f.req(t.path,t.cookie),f.identity);
 assert.equal(success.status,302); assert.match(success.headers.get('set-cookie')!,/HttpOnly/);
 assert.equal((await login(f.req(t.path,t.cookie),f.identity)).status,401);
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
 assert.equal((await login(f.req(t.path,t.cookie+'; '+sessionName+'='+previous),f.identity)).status,302);
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
