import { DurableObject } from 'cloudflare:workers';
import { createHash } from 'node:crypto';
import { correlationFromHeaders, type CailCorrelation } from '@cuny-ai-lab/cail-log';
import { authorize, verifierConfigs, type Principal, type IdentityEnv } from './identity';
import { requestLog } from './log.js';
import { boundedText, boundedRpc, withDeadline } from './bounded.js';
import { createSystemsMappingApp } from '../server/app.js';
import { initializeDurableDatabase } from '../server/database.js';
import { gatewaySuggestion, gatewayClient, safeGatewayFailure, canonicalModel, REQUEST_ID } from './gateway.js';
import { login } from './login';
import { parseProject } from '../src/domain.js';
import { durableDatabase } from './database.js';

const HEADERS = {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};
type Bindings = Omit<Env, 'IDENTITY' | 'ADMISSION_RESOLVER'> & IdentityEnv;
const failure = (error: string, status: number) => Response.json({ error }, { status });
function securedResponse(response: Response, requestId: string) {
  const headers = new Headers(response.headers);
  headers.set('x-request-id', requestId);
  for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function requestCorrelation(request: Request) {
  const headers = new Headers(request.headers);
  const id = headers.get('x-cail-request-id') ?? headers.get('x-request-id');
  if (id && REQUEST_ID.test(id)) headers.set('x-cail-request-id', id);
  return correlationFromHeaders(headers);
}

async function boundedJson(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('content-type');
  return withDeadline(async signal => JSON.parse(await boundedText(request, signal, 2 * 1024 * 1024)), request.signal, 10000);
}

// One database per teaching workspace; account ownership is enforced inside it.
// This namespace is independent from Railway and from STEM Splitter.
export class MappingCourse extends DurableObject<Bindings> {
  db;
  system!: ReturnType<typeof createSystemsMappingApp>;
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.db = durableDatabase(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      initializeDurableDatabase(this.db);
      this.db.exec(`CREATE TABLE IF NOT EXISTS cloud_projects (
        owner TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, project TEXT NOT NULL,
        revision INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner,id)
      );
      CREATE TABLE IF NOT EXISTS cloud_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, project_id TEXT NOT NULL,
        event TEXT NOT NULL CHECK(event IN ('created','saved','opened')), revision INTEGER NOT NULL, at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cloud_activity_owner ON cloud_activity(owner, at);
      CREATE TABLE IF NOT EXISTS cloud_accounts (owner TEXT PRIMARY KEY, cache_key TEXT NOT NULL);`);
      this.db.finishInitialization();
      this.system = createSystemsMappingApp({ db: this.db, publicOrigin: env.PUBLIC_ORIGIN, hostedMode: true, classCode: 'cail-only-no-class-code-827361',
        ollamaConfig: { apiKey: 'private-service-binding', model: env.GATEWAY_MODEL }, suggestionProvider: 'cail-gateway',
        suggestionFailure: (error: unknown, context: any) => safeGatewayFailure(error, context.env.verifiedAccount.correlation.request_id),
        onInternalError: (context: any) => requestLog(env.RELEASE, context.env.verifiedAccount.correlation.request_id).failure(),
        ollamaRequest: (input: any, config: any, options: any) => {
          const { gatewayJwt, correlation } = options.context;
          return gatewaySuggestion(env.GATEWAY, gatewayJwt, env.GATEWAY_MODEL, correlation, requestLog(env.RELEASE, correlation.request_id).gateway)(input, config, { signal: options.signal });
        },
      });
      await this.system.ready;
    });
  }

  async health(): Promise<boolean> {
    await this.system.ready;
    return this.db.healthCheck();
  }

  async request(request: Request, principal: Principal, correlation: CailCorrelation = correlationFromHeaders(request.headers)): Promise<Response> {
    const url = new URL(request.url);
    const owner = digest(principal.subject);
    const path = url.pathname;
    const expectedCache = request.headers.get('x-systems-account-cache');
    if (expectedCache && path !== '/api/cloud/account') {
      const account = this.db.prepare('SELECT cache_key FROM cloud_accounts WHERE owner=?').get(owner);
      if (account?.cache_key !== expectedCache) return failure('The signed-in account changed. Reload to open its workspace. Your device copy is preserved.', 409);
    }
    if (path === '/api/cloud/account' && request.method === 'GET') {
      this.db.prepare('INSERT OR IGNORE INTO cloud_accounts VALUES (?,?)').run(owner, crypto.randomUUID());
      return Response.json({ account: { cacheKey: this.db.prepare('SELECT cache_key FROM cloud_accounts WHERE owner=?').get(owner).cache_key,
        role: principal.admin ? 'instructor' : 'student' } });
    }
    if (path === '/api/cloud/projects' && request.method === 'GET') {
      const projects = this.db.prepare('SELECT id,title,revision,updated_at AS updatedAt FROM cloud_projects WHERE owner=? ORDER BY updated_at DESC LIMIT 200').all(owner);
      return Response.json({ projects });
    }
    const projectId = /^\/api\/cloud\/projects\/([^/]+)$/.exec(path)?.[1];
    if (projectId) {
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(projectId)) return failure('Invalid project ID.', 400);
      if (request.method === 'GET') {
        const row = this.db.prepare('SELECT project,revision FROM cloud_projects WHERE owner=? AND id=?').get(owner, projectId);
        if (!row) return failure('Project not found.', 404);
        this.db.prepare('INSERT INTO cloud_activity(owner,project_id,event,revision,at) VALUES (?,?,?,?,?)').run(owner, projectId, 'opened', row.revision, new Date().toISOString());
        return Response.json(row);
      }
      if (request.method === 'PUT') {
        let body, project;
        try {
          body = await boundedJson(request);
          if (Object.keys(body).sort().join(',') !== 'project,revision' || typeof body.project !== 'string' || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error('shape');
          project = parseProject(body.project);
          if (project.id !== projectId) throw new Error('id');
        } catch { return failure('This project could not be saved. Check its contents and try again.', 400); }
        return this.ctx.storage.transactionSync(() => {
          const existing = this.db.prepare('SELECT revision FROM cloud_projects WHERE owner=? AND id=?').get(owner, projectId);
          if ((existing?.revision ?? 0) !== body.revision) return failure('This project changed in another tab. Reload it before saving more changes.', 409);
          if (!existing && this.db.prepare('SELECT count(*) AS n FROM cloud_projects WHERE owner=?').get(owner).n >= 200) return failure('Your workspace has reached its project limit.', 409);
          const revision = body.revision + 1;
          const at = new Date().toISOString();
          this.db.prepare(`INSERT INTO cloud_projects VALUES (?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET
            title=excluded.title, project=excluded.project, revision=excluded.revision, updated_at=excluded.updated_at`)
            .run(owner, projectId, project.title, body.project, revision, at);
          this.db.prepare('INSERT INTO cloud_activity(owner,project_id,event,revision,at) VALUES (?,?,?,?,?)').run(owner, projectId, existing ? 'saved' : 'created', revision, at);
          // Activity is operational metadata, not a second copy of memo content.
          this.db.prepare("DELETE FROM cloud_activity WHERE owner=? AND at < ?").run(owner, new Date(Date.now() - 90 * 86400000).toISOString());
          return Response.json({ revision, updatedAt: at });
        });
      }
      return failure('Method not allowed.', 405);
    }
    if (path.startsWith('/api/cloud/')) return failure('Not found.', 404);
    if (path.startsWith('/api/teacher/') && !principal.admin) return failure('Instructor access is required.', 403);
    if (path === '/api/student/access' || path.startsWith('/api/auth/') && !['/api/auth/me'].includes(path)) {
      return failure('Use CUNY Login for this workspace.', 403);
    }
    // Account maps are private. An explicitly created project link remains a
    // bearer capability plus current membership, as in the original product.
    const session = { expiresAt: Math.min(principal.expiresAt, Date.now() + 3600000), sessionRef: owner.slice(0,16) };
    let teacherSession = null;
    if (principal.admin) {
      this.db.prepare('INSERT OR IGNORE INTO accounts(id,display_name,created_at) VALUES (?,?,?)').run(owner, 'Course instructor', new Date().toISOString());
      teacherSession = { ...session, user: { id: owner, displayName: 'Course instructor' } };
    }
    const { app } = this.system;
    const internalHeaders = new Headers(request.headers);
    internalHeaders.set('host',url.host);
    internalHeaders.delete('x-forwarded-proto');
    return app.fetch(new Request(request,{headers:internalHeaders}), { verifiedAccount: { studentSession: session, teacherSession, gatewayJwt: principal.gatewayJwt, correlation } });
  }
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    let response: Response;
    const correlation = requestCorrelation(request);
    try {
      const url = new URL(request.url);
      if (url.origin !== env.PUBLIC_ORIGIN) return securedResponse(failure('Not found.', 404), correlation.request_id);
      if (!['GET','HEAD','OPTIONS'].includes(request.method) && (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site')) return securedResponse(failure('Request origin was not accepted.',403), correlation.request_id);
      if (url.pathname.includes('%') && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))) return securedResponse(failure('Invalid request path.', 400), correlation.request_id);
      const sanitized = new Headers(request.headers);
      for (const name of [...sanitized.keys()]) {
        if (name === 'authorization' || name === 'cookie' || name === 'cf-access-jwt-assertion' || name.startsWith('x-cail-')) sanitized.delete(name);
      }
      sanitized.set('x-request-id', correlation.request_id);
      const internal = new Request(request, { headers: sanitized });
      if (url.pathname === '/api/health') {
        const configs = await verifierConfigs(env);
        const configured = configs.every(value => value.ok) && canonicalModel(env.GATEWAY_MODEL) && Boolean(env.IDENTITY && env.ADMISSION_RESOLVER && env.GATEWAY && env.COURSES);
        const ready = configured && await boundedRpc(env.COURSES.getByName(env.COURSE_ID).health(), request.signal);
        response = Response.json({ status: ready ? 'ok' : 'unavailable', release: env.RELEASE, auth: 'cuny', storage: 'isolated-cloudflare' }, { status: ready ? 200 : 503 });
      }
      else if (url.pathname === '/api/cloud/runtime') response = Response.json({ loginUrl: env.LOGIN_URL });
      else if (url.pathname.startsWith('/auth/')) {
        const limit = await env.REQUEST_LIMIT.limit({ key: 'login:' + (request.headers.get('cf-connecting-ip') || 'unknown') });
        response = limit.success ? await login(request,env.IDENTITY) : failure('Please wait before signing in again.',429);
      }
      else if (url.pathname.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(request.method) && request.headers.get('origin') !== new URL(request.url).origin) response = failure('Request origin was not accepted.', 403);
        else {
          const limit = await env.REQUEST_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
          if (!limit.success) response = failure('Please wait a moment and try again.', 429);
          else {
            const principal = await authorize(request, env);
            if (principal instanceof Response) response = principal;
            else if (url.pathname === '/api/cloud/quota' && request.method === 'GET') {
              try {
                const quota = await withDeadline(signal => gatewayClient(env.GATEWAY).getQuota({ kind: 'jwt', token: principal.gatewayJwt }, { signal }), request.signal, 5000);
                response = Response.json({ quota });
              } catch { response = Response.json({ quota: null, error: 'Model usage is temporarily unavailable.' }, { status: 503 }); }
            } else response = await env.COURSES.getByName(env.COURSE_ID).request(internal, principal, correlation);
          }
        }
      } else response = await env.ASSETS.fetch(internal);
    } catch {
      requestLog(env.RELEASE, correlation.request_id).failure();
      response = failure('Systems Mapping is temporarily unavailable. Please try again.', 503);
    }
    return securedResponse(response, correlation.request_id);
  },
} satisfies ExportedHandler<Bindings>;
