import { CourseAccessError, resolveCourseAccess, courseFailure, courseRoster, allowedCourseIds, type CourseAccessEnv, type CourseAccess } from './course-access';
import { currentCoursePrompt, coursePromptRequest } from './course-prompt';
import { DurableObject } from 'cloudflare:workers';
import { createHash } from 'node:crypto';
import { correlationFromHeaders, type CailCorrelation } from '@cuny-ai-lab/cail-log';
import { authorize, verifierConfigs, type Principal, type IdentityEnv } from './identity';
import { requestLog } from './log.js';
import { boundedText, boundedRpc, withDeadline, withSignal } from './bounded.js';
import { createSystemsMappingApp } from '../server/app.js';
import { initializeDurableDatabase } from '../server/database.js';
import { gatewaySuggestion, gatewayClient, safeGatewayFailure, canonicalModel, REQUEST_ID } from './gateway.js';
import { login, signInFailure } from './login';
import { parseProject } from '../src/domain.js';
import { durableDatabase } from './database.js';
import { apiRateLimitKey } from './request-load.js';
import { boundedGuidanceRequest, GUIDANCE_DEADLINE_MS, isGuidanceRequest } from './guidance-deadline.js';
import { GuidanceJobs } from './guidance-jobs.js';
import { DEMO_COURSE_ID, demonstrationProgress } from './demo-course';
import { SubmittedRevisions } from './submitted-revisions.js';
import { handleBugReport, type BugReportService } from './bug-reports';

const HEADERS = {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};
type Bindings = Omit<Env, 'IDENTITY' | 'ADMISSION_RESOLVER'> & IdentityEnv & Pick<CourseAccessEnv, 'COURSE_ACCESS_ENABLED' | 'COURSE_IDS'> & { BUG_REPORTS?: BugReportService };
const failure = (error: string, status: number, retryAfterSeconds?: number) => Response.json({ error,
  ...(retryAfterSeconds ? { details: { retryAfterSeconds } } : {}),
}, { status, ...(retryAfterSeconds ? { headers: { 'Retry-After': String(retryAfterSeconds) } } : {}) });
function securedResponse(response: Response, requestId: string, authentication = false) {
  const headers = new Headers(response.headers);
  headers.set('x-request-id', requestId);
  for (const [key, value] of Object.entries(HEADERS)) {
    if (authentication && key === 'Content-Security-Policy' && headers.has(key)) continue;
    headers.set(key, value);
  }
  // Native form POSTs from no-referrer documents send Origin: null. Keep
  // same-origin logout verifiable without sharing referrers with other sites.
  // API responses and authentication redirects retain no-referrer.
  if (!authentication && headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/html') {
    headers.set('Referrer-Policy', 'same-origin');
  }
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
  jobs!: GuidanceJobs;
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
      CREATE TABLE IF NOT EXISTS cloud_accounts (owner TEXT PRIMARY KEY, cache_key TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cloud_course_visits (owner TEXT PRIMARY KEY, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);`);
      this.db.finishInitialization();
      this.submissions = new SubmittedRevisions(this.db);
      this.jobs = new GuidanceJobs(this.db, (pending: Promise<unknown>) => ctx.waitUntil(pending));
      this.system = createSystemsMappingApp({ db: this.db, publicOrigin: env.PUBLIC_ORIGIN, hostedMode: true, classCode: 'cail-only-no-class-code-827361',
        preflightEvaluationConcurrency: Number(env.GUIDANCE_CONCURRENCY),
        ollamaConfig: { apiKey: 'private-service-binding', model: env.GATEWAY_MODEL }, suggestionProvider: 'cail-gateway',
        suggestionFailure: (error: unknown, context: any) => error instanceof CourseAccessError
          ? { status: error.status, message: error.status === 409 ? 'Course guidance changed. Refresh the course settings and request guidance again.' : 'Course access could not be verified. Reload your course and try again.', details: { code: error.code, shouldRetry: false } }
          : safeGatewayFailure(error, context.env.verifiedAccount.correlation.request_id),
        onInternalError: (context: any) => requestLog(env.RELEASE, context.env.verifiedAccount.correlation.request_id).failure(),
        ollamaRequest: async (input: any, config: any, options: any) => {
          const { gatewayJwt, correlation, course, subject, coursePrompt, guidanceTimeoutMs } = options.context;
          if (course) {
            await resolveCourseAccess(env, subject, course.classId, options.signal);
            const current = await currentCoursePrompt(this.ctx.storage);
            if (current.revision !== coursePrompt.revision) throw new CourseAccessError(409, 'course_prompt_changed');
          }
          return gatewaySuggestion(env.GATEWAY, gatewayJwt, env.GATEWAY_MODEL, correlation, requestLog(env.RELEASE, correlation.request_id).gateway)(input, config, { signal: options.signal, ...(options.kind ? { kind: options.kind } : {}), ...(guidanceTimeoutMs ? { timeoutMs: guidanceTimeoutMs } : {}) });
        },
      });
      await this.system.ready;
    });
  }

  async health(): Promise<boolean> {
    await this.system.ready;
    return this.db.healthCheck();
  }

  submissions!: SubmittedRevisions;

  async alarm(): Promise<void> {
    this.jobs.purge();
    const next = this.jobs.nextCleanup();
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  async visit(course: CourseAccess): Promise<void> {
    if (!course.participant || course.owner || Date.parse(course.expiresAt) <= Date.now()) return;
    const owner = digest(course.memberId), at = new Date().toISOString();
    this.db.prepare(`INSERT INTO cloud_course_visits VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET last_seen=excluded.last_seen`).run(owner, at, at);
  }

  async request(request: Request, principal: Principal, correlation: CailCorrelation = correlationFromHeaders(request.headers), guidanceDeadline?: number, durableGuidance = false): Promise<Response> {
    const url = new URL(request.url);
    const owner = digest(principal.course?.memberId ?? principal.subject);
    const path = url.pathname;
    const expectedCache = request.headers.get('x-systems-account-cache');
    if (expectedCache && path !== '/api/cloud/account') {
      const account = this.db.prepare('SELECT cache_key FROM cloud_accounts WHERE owner=?').get(owner);
      if (account?.cache_key !== expectedCache) return failure('The signed-in account changed. Reload to open its workspace. Your device copy is preserved.', 409);
    }
    if (path === '/api/cloud/guidance-jobs' || path.startsWith('/api/cloud/guidance-jobs/')) {
      const match = /^\/api\/cloud\/guidance-jobs\/([0-9a-f]{64})(\/resume)?$/.exec(path);
      const creating = path === '/api/cloud/guidance-jobs' && request.method === 'POST';
      if (!creating && (!match || request.method !== (match[2] ? 'POST' : 'GET'))) return failure('Job request unavailable.', 404);
      let body: any;
      try { body = creating ? await boundedJson(request) : this.jobs.row(owner, match![1]); }
      catch { return failure('The generation request could not be read.', 400); }
      if (!body) return failure('Generation request unavailable.', 404);
      if (creating && (typeof body.requestToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.requestToken))) return failure('Generation request identity is required.', 400);
      let input: any;
      try { input = creating ? body.input : JSON.parse(body.input); }
      catch { return failure('Generation request unavailable.', 404); }
      if (!['memo','connections','map-check'].includes(body.kind) || !input || typeof input !== 'object') return failure('Choose a supported generation request.', 400);
      const params = new URLSearchParams({ configKind: body.kind === 'memo' ? 'preflight' : 'builder', scale: input.activeScale || 'micro',
        stageId: body.kind === 'memo' ? input.stageId || 'review-suggestions' : body.kind === 'map-check' ? (input.intent === 'synthesis' ? 'revise-and-export' : 'build-map') : 'choose-what-to-map' });
      const config = await this.request(new Request(url.origin + '/api/config/public?' + params), principal, correlation);
      if (!config.ok) return config;
      const scope = JSON.stringify({ config: await config.json(), model: this.env.GATEWAY_MODEL });
      const run = async (kind: string, savedInput: unknown) => {
        if (principal.expiresAt <= Date.now()) return failure('Sign in again to continue generation.', 401);
        const target = kind === 'memo' ? '/api/preflight/evaluations' : kind === 'map-check' ? '/api/map/check' : '/api/map/connections';
        // The browser can disconnect while this bounded attempt finishes. Its
        // current verified credentials remain in memory for this attempt only.
        return this.request(new Request(url.origin + target, { method: 'POST', headers: { 'content-type': 'application/json', origin: url.origin }, body: JSON.stringify(savedInput) }), principal, correlation, Date.now() + 90000, true);
      };
      // A read may hold for up to 20 seconds while the attempt runs here, so the
      // browser polls about ten times less often per action.
      if (!creating && !match![2] && url.searchParams.get('wait') === '1' && ['queued', 'running'].includes(body.state)) await this.jobs.wait(match![1], 20000);
      let result;
      try {
        result = creating ? this.jobs.create(owner, body.kind, input, scope, body.retryToken, run, body.requestToken)
          : match![2] ? this.jobs.resume(owner, match![1], scope, run)
          : body.scope === scope ? this.jobs.read(owner, match![1]) : { conflict: true };
      } catch { return failure('This generation request exceeds the workspace limit or has invalid input.', 400); }
      if (!result) return failure('Generation request expired. Your saved map remains available.', 404);
      if ('expired' in result) return failure('Generation request expired. Choose Generate again to start a new request.', 410);
      if ('conflict' in result) return failure('Course guidance changed. Start generation again with the current settings.', 409);
      if (creating) {
        const next = this.jobs.nextCleanup(), current = await this.ctx.storage.getAlarm();
        if (next !== null && (current === null || next < current)) await this.ctx.storage.setAlarm(next);
      }
      return Response.json(result, { status: ['succeeded','failed'].includes(result.job.state) ? 200 : 202 });
    }
    if (path === '/api/cloud/course-prompt' || path === '/api/cloud/course-prompt/history') {
      if (!principal.course) return failure('Open a course to view its guidance.', 404);
      return coursePromptRequest(request, this.ctx.storage, principal.course.capabilities, principal.course);
    }
    if (path === '/api/cloud/account' && request.method === 'GET') {
      if (principal.course) await this.visit(principal.course);
      this.db.prepare('INSERT OR IGNORE INTO cloud_accounts VALUES (?,?)').run(owner, crypto.randomUUID());
      return Response.json({ account: { cacheKey: this.db.prepare('SELECT cache_key FROM cloud_accounts WHERE owner=?').get(owner).cache_key,
        role: principal.admin ? 'instructor' : 'student',
        course: principal.course ? { id: principal.course.classId, name: principal.course.className, term: principal.course.term, section: principal.course.section, guestInstructor: principal.course.guestInstructor, capabilities: principal.course.capabilities, promptRevision: (await currentCoursePrompt(this.ctx.storage)).revision } : null } });
    }
    if (path === '/api/cloud/course-students' && request.method === 'GET') {
      if (!principal.course?.capabilities.rosterRead) return courseFailure(new CourseAccessError(403, 'not_owner'));
      if ([...url.searchParams.keys()].some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1) return courseFailure(new CourseAccessError(400, 'cursor_invalid'));
      try {
        const roster = await courseRoster(this.env, principal.subject, principal.course, url.searchParams.get('cursor') ?? undefined, request.signal);
        const students = roster.participants.flatMap(member => {
          const studentOwner = digest(member.memberId);
          const visit = this.db.prepare('SELECT first_seen AS firstSeen,last_seen AS lastSeen FROM cloud_course_visits WHERE owner=?').get(studentOwner);
          if (!visit) return [];
          const rows = this.db.prepare('SELECT id,title,project,revision,updated_at AS updatedAt FROM cloud_projects WHERE owner=? ORDER BY updated_at DESC LIMIT 20').all(studentOwner);
          const projectCount = this.db.prepare('SELECT count(*) AS count FROM cloud_projects WHERE owner=?').get(studentOwner).count;
          const projects = rows.map((row: any) => {
            const project = parseProject(row.project);
            return { id: row.id, title: row.title, revision: row.revision, updatedAt: row.updatedAt, activeScale: project.activeScale,
              submittedRevisions: this.submissions.summary(studentOwner, row.id),
              levels: ['micro','meso','exosphere','macrosphere'].map(scale => ({ scale, stage: project.levelProgress[scale].stage,
                completed: project.completedScales.includes(scale), started: project.activeScale === scale || project.levelProgress[scale].stage > 1 || project.completedScales.includes(scale) || project.graph.nodes.some((node: any) => node.scale === scale) })) };
          });
          return [{ memberId: member.memberId, displayName: member.displayName, displayNameSource: member.displayNameSource, ...visit, projectCount, projects }];
        });
        return Response.json({ students, demonstrationStudents: principal.course.classId === DEMO_COURSE_ID
          ? [demonstrationProgress()] : [], nextCursor: roster.nextCursor });
      } catch (error) { return courseFailure(error); }
    }
    const revisionPath = /^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,128})\/submitted-revisions$/.exec(path);
    if (revisionPath) {
      if (!principal.course?.participant || principal.course.owner) return failure('Course student access is required.', 403);
      if (request.method !== 'POST') return failure('Instructor access is required to read revision counts.', 403);
      let body;
      try { body = await boundedJson(request); } catch { return failure('Choose a saved revision to submit.', 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'revision' || !Number.isSafeInteger(body.revision) || body.revision < 1) return failure('Choose a saved revision to submit.', 400);
      const row = this.db.prepare('SELECT project,revision FROM cloud_projects WHERE owner=? AND id=?').get(owner, revisionPath[1]);
      if (!row) return failure('Save this course map before submitting a revision.', 404);
      if (row.revision !== body.revision) return failure('The saved map changed. Review it before submitting.', 409);
      const project = parseProject(row.project);
      if (project.stage === 1 && !project.preflight?.memoReview) return failure('Complete the memo review before submitting this stage.', 409);
      return Response.json(this.submissions.submit(owner, project, row.revision));
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
    const coursePrompt = principal.course ? await currentCoursePrompt(this.ctx.storage) : undefined;
    const dispatch = (signal: AbortSignal) => app.fetch(new Request(request, { headers: internalHeaders, signal }),
      { verifiedAccount: { studentSession: session, teacherSession, gatewayJwt: principal.gatewayJwt, correlation, course: principal.course, subject: principal.subject, coursePrompt, ...(durableGuidance ? { guidanceTimeoutMs: 85000 } : {}) } });
    if (isGuidanceRequest(request)) {
      // Transfer an absolute time, not an AbortSignal, across the RPC boundary.
      // Late dispatch must not start a model after the browser has stopped waiting.
      const remaining = Math.min((durableGuidance ? 90000 : GUIDANCE_DEADLINE_MS) - 500, (guidanceDeadline ?? Date.now() + GUIDANCE_DEADLINE_MS) - Date.now() - 500);
      if (remaining <= 0) throw new DOMException('Request deadline exceeded', 'TimeoutError');
      return withDeadline(signal => withSignal(Promise.resolve(dispatch(signal)), signal), request.signal, remaining);
    }
    return dispatch(request.signal);
  }
}

async function handleRequest(request: Request, env: Bindings, correlation: CailCorrelation, guidanceDeadline?: number): Promise<Response> {
    let response: Response;
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'https:' || url.origin !== env.PUBLIC_ORIGIN) return securedResponse(failure('Not found.', 404), correlation.request_id);
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
      else if (request.method === 'GET' && url.pathname === '/api/bug-reports/availability') {
        response = Response.json({ enabled: Boolean(env.BUG_REPORTS) }, { headers: { 'Cache-Control': 'no-store' } });
      }
      else if (url.pathname === '/api/bug-reports' || url.pathname === '/api/bug-reports/session') {
        response = await handleBugReport(internal, { origin: env.PUBLIC_ORIGIN, release: env.RELEASE,
          service: env.BUG_REPORTS, limiter: env.REQUEST_LIMIT });
      }
      else if (url.pathname.startsWith('/auth/')) {
        // Limit new handoffs only. A busy shared IP must not prevent callback
        // completion or clearing/revoking this browser's existing session.
        if (url.pathname === '/auth/start' && request.method === 'GET') {
          try {
            const limit = await boundedRpc(env.REQUEST_LIMIT.limit({ key: 'login:' + (request.headers.get('cf-connecting-ip') || 'unknown') }), request.signal);
            response = limit.success ? await login(request, env.IDENTITY, { CAIL_IDENTITY_JWKS: env.CAIL_IDENTITY_JWKS }) : signInFailure(request, 429);
          } catch { response = signInFailure(request, 503); }
        } else response = await login(request, env.IDENTITY, { CAIL_IDENTITY_JWKS: env.CAIL_IDENTITY_JWKS });
      }
      else if (url.pathname.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(request.method) && request.headers.get('origin') !== new URL(request.url).origin) response = failure('Request origin was not accepted.', 403);
        else {
          let principal = await authorize(request, env);
          const selectedCourse = request.headers.get('x-systems-course');
          if (!(principal instanceof Response) && request.headers.has('x-systems-course')) {
            try {
              const course = await resolveCourseAccess(env, principal.subject, selectedCourse ?? '', request.signal);
              principal = { ...principal, admin: course.capabilities.instructorPanel, expiresAt: Math.min(principal.expiresAt, Date.parse(course.expiresAt)), course };
            } catch (error) { principal = courseFailure(error); }
          }
          const limit = await env.REQUEST_LIMIT.limit({ key: apiRateLimitKey(request, principal instanceof Response ? null : principal.subject) });
          if (!limit.success) response = failure('Please wait a moment and try again.', 429,60);
          else {
            if (principal instanceof Response) response = principal;
            else if (url.pathname === '/api/cloud/courses' && request.method === 'GET') {
              try {
                const courses = await withDeadline(async signal => {
                  const found = [];
                  if (env.COURSE_ACCESS_ENABLED === 'true') {
                    for (const classId of allowedCourseIds(env)) {
                      let course;
                      try { course = await resolveCourseAccess(env, principal.subject, classId, signal); }
                      catch (error) { if (error instanceof CourseAccessError && error.status === 403) continue; throw error; }
                      await boundedRpc(env.COURSES.getByName(`systems-mapping:course:${classId}`).visit(course), signal);
                      found.push({ id: course.classId, name: course.className, term: course.term, section: course.section, guestInstructor: course.guestInstructor, role: course.capabilities.instructorPanel ? 'instructor' : 'student' });
                    }
                  }
                  return found;
                }, request.signal, 8000);
                response = Response.json({ courses });
              } catch (error) { response = courseFailure(error); }
            }
            else if (url.pathname === '/api/cloud/quota' && request.method === 'GET') {
              try {
                const quota = await withDeadline(signal => gatewayClient(env.GATEWAY).getQuota({ kind: 'jwt', token: principal.gatewayJwt }, { signal }), request.signal, 5000);
                response = Response.json({ quota });
              } catch { response = Response.json({ quota: null, error: 'Model usage is temporarily unavailable.' }, { status: 503 }); }
            } else response = await env.COURSES.getByName(principal.course ? `systems-mapping:course:${principal.course.classId}` : env.COURSE_ID).request(internal, principal, correlation, guidanceDeadline);
          }
        }
      } else response = await env.ASSETS.fetch(internal);
    } catch (error) {
      if (isGuidanceRequest(request) && error instanceof Error && error.name === 'TimeoutError') throw error;
      requestLog(env.RELEASE, correlation.request_id).failure();
      response = failure('Systems Mapping is temporarily unavailable. Please try again.', 503);
    }
    return securedResponse(response, correlation.request_id, new URL(request.url).pathname.startsWith('/auth/'));
}

// The override is for the local runtime harness, never an environment setting.
// Production uses 28s, below the browser's 30s whole-request bound.
export function createMappingHandler({ testOnlyGuidanceTimeoutMs = GUIDANCE_DEADLINE_MS } = {}) {
  return {
    async fetch(request: Request, env: Bindings): Promise<Response> {
      const correlation = requestCorrelation(request);
      if (!isGuidanceRequest(request)) return handleRequest(request, env, correlation);
      try {
        const deadline = Date.now() + testOnlyGuidanceTimeoutMs;
        return await boundedGuidanceRequest(request, (timed: Request) => handleRequest(timed, env, correlation, deadline), testOnlyGuidanceTimeoutMs);
      } catch (error) {
        requestLog(env.RELEASE, correlation.request_id).failure();
        const cancelled = request.signal.aborted;
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        return securedResponse(Response.json({
          error: cancelled ? 'Guidance was cancelled' : 'Couldn’t generate guidance — Try again',
          details: { code: cancelled ? 'guidance_cancelled' : timedOut ? 'guidance_timeout' : 'guidance_unavailable', shouldRetry: false },
        }, { status: cancelled ? 499 : timedOut ? 504 : 503 }), correlation.request_id);
      }
    },
  } satisfies ExportedHandler<Bindings>;
}

export default createMappingHandler();
