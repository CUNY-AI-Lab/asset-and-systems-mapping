import { createHash } from 'node:crypto';
import { boundedText, withDeadline, withSignal } from './bounded.js';
import { durableDatabase } from './database.js';

type ReportEnv = { REDMINE_API_KEY?: string; RELEASE: string };
type Receipt = { fingerprint: string; state: string; created_at: string; issue_id: number | null };
const BASE = new URL('https://tools.ailab.gc.cuny.edu/help/');
const PROJECT = 15, TRACKER = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const subject = (id: string, owner: string) => `System Mapping bug report [sm-report:${owner.slice(0,16)}:${id}]`;
const fail = (code: string, status: number, retryAfterSeconds?: number) => Response.json({ ok: false, code,
  ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
}, { status, ...(retryAfterSeconds ? { headers: { 'Retry-After': String(retryAfterSeconds) } } : {}) });

// Bound the complete response, including its body, and never follow a redirect
// carrying the API key to another host. Upstream responses are not logged.
async function redmine(env: ReportEnv, resource: string, signal: AbortSignal, init: RequestInit = {}) {
  if (!env.REDMINE_API_KEY) throw new Error('redmine_unconfigured');
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Redmine-API-Key', env.REDMINE_API_KEY);
  const response = await withSignal(fetch(new URL(resource, BASE), { ...init, headers, redirect: 'error', signal }), signal);
  const text = await boundedText(response, signal, 2 * 1024 * 1024);
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* Treat unreadable success as uncertain delivery. */ }
  return { status: response.status, ok: response.ok, data };
}

async function findIssue(env: ReportEnv, id: string, owner: string, createdAt: string, signal: AbortSignal): Promise<number | null> {
  const params = new URLSearchParams({ project_id: String(PROJECT), tracker_id: String(TRACKER),
    status_id: '*', created_on: `>=${new Date(Date.parse(createdAt) - 300000).toISOString()}`,
    sort: 'created_on:asc', limit: '100',
  });
  for (let offset = 0; offset < 1000;) {
    params.set('offset', String(offset));
    const { ok, data } = await redmine(env, `issues.json?${params}`, signal);
    if (!ok || !Array.isArray(data?.issues) || !Number.isSafeInteger(data.total_count)) throw new Error('lookup_unavailable');
    const issue = data.issues.find((value: any) => value.subject === subject(id, owner));
    if (issue && Number.isSafeInteger(issue.id) && issue.id > 0) return issue.id;
    offset += data.issues.length;
    if (!data.issues.length || offset >= data.total_count) return null;
  }
  throw new Error('lookup_incomplete');
}

/** Private report receipts share Dev's existing isolated Durable Object. */
export class RedmineReports {
  private active = new Set<string>();
  constructor(private db: ReturnType<typeof durableDatabase>, private storage: DurableObjectStorage, private env: ReportEnv) {
    db.exec(`CREATE TABLE IF NOT EXISTS bug_reports (
      owner TEXT NOT NULL, report_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','saved','rejected','retryable')),
      issue_id INTEGER, PRIMARY KEY(owner,report_id)
    );
    CREATE INDEX IF NOT EXISTS bug_reports_owner_time ON bug_reports(owner,created_at);`);
  }

  async request(request: Request, owner: string): Promise<Response> {
    const url = new URL(request.url);
    if (url.search) return fail('invalid', 400);
    if (!this.env.REDMINE_API_KEY) return fail('disabled', 503);
    if (url.pathname === '/api/bug-reports/session') {
      return request.method === 'GET' ? Response.json({ ok: true, expectedActor: owner }) : fail('method_not_allowed', 405);
    }
    if (request.method !== 'POST') return fail('method_not_allowed', 405);
    let body;
    try {
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('content_type');
      body = await withDeadline(async signal => JSON.parse(await boundedText(request, signal, 32768)), request.signal, 5000);
    } catch { return fail('invalid', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== 'description,expectedActor,path,reportId'
      || typeof body.reportId !== 'string' || !UUID.test(body.reportId)
      || typeof body.expectedActor !== 'string' || !/^[0-9a-f]{64}$/.test(body.expectedActor)
      || !['/','/teacher.html','/account.html','/p/:shared-map'].includes(body.path)
      || typeof body.description !== 'string' || body.description.length > 4000) return fail('invalid', 400);
    if (body.expectedActor !== owner) return fail('account_changed', 403);
    const description = body.description.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
    if (description.length < 10 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(description)) return fail('invalid', 400);
    const id = body.reportId as string;
    const fingerprint = digest(`${id}\n${body.path}\n${description}`);
    const lock = `${owner}:${id}`;
    if (this.active.has(lock)) return fail('pending', 202, 5);
    this.active.add(lock);
    try {
      const createdAt = new Date().toISOString();
      const start = this.storage.transactionSync(() => {
        const existing = this.db.prepare('SELECT fingerprint,state,created_at,issue_id FROM bug_reports WHERE owner=? AND report_id=?').get(owner, id) as Receipt | undefined;
        if (existing) return { existing };
        const recent = this.db.prepare('SELECT count(*) AS n, min(created_at) AS oldest FROM bug_reports WHERE owner=? AND created_at>=?')
          .get(owner, new Date(Date.now() - 86400000).toISOString());
        if (recent.n >= 10) return { limited: Math.max(60, Math.ceil((Date.parse(recent.oldest) + 86400000 - Date.now()) / 1000)) };
        this.db.prepare("INSERT INTO bug_reports VALUES (?,?,?,?,'pending',NULL)").run(owner, id, fingerprint, createdAt);
        return { createdAt };
      });
      if ('limited' in start) return fail('rate_limited', 429, start.limited);
      const existing = start.existing;
      if (existing && existing.fingerprint !== fingerprint) return fail('idempotency_conflict', 409);
      const at = existing?.created_at ?? createdAt;
      const saved = () => Response.json({ ok: true, status: 'saved', reportId: id, createdAt: at });
      const saveReceipt = (issueId: number) => {
        this.db.prepare("UPDATE bug_reports SET state='saved',issue_id=? WHERE owner=? AND report_id=?").run(issueId, owner, id);
        return saved();
      };
      if (existing?.state === 'saved') return saved();
      if (existing?.state === 'rejected') return fail('redmine_rejected', 502);
      return await withDeadline(async signal => {
        if (existing?.state === 'pending') {
          const issueId = await findIssue(this.env, id, owner, at, signal);
          // Redmine has no idempotency-key API. A lost acknowledgement must
          // never trigger another POST; it can only reconcile the receipt.
          return issueId === null ? fail('pending', 503, 60) : saveReceipt(issueId);
        }
        if (existing?.state === 'retryable') {
          this.db.prepare("UPDATE bug_reports SET state='pending' WHERE owner=? AND report_id=?").run(owner, id);
        }
        const page = ({ '/': 'Workspace', '/teacher.html': 'Instructor', '/account.html': 'Account', '/p/:shared-map': 'Shared map' } as Record<string,string>)[body.path];
        const result = await redmine(this.env, 'issues.json', signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issue: { project_id: PROJECT, tracker_id: TRACKER, subject: subject(id, owner), is_private: true,
            description: [`CAIL account reference: ${owner.slice(0,16)}`, `Page: ${page}`, `System Mapping release: ${this.env.RELEASE}`,
              `Reported at: ${at}`, `Report reference: ${id}`, '', description].join('\n'),
          } }),
        });
        if (result.ok) {
          const issueId = result.data?.issue?.id;
          return Number.isSafeInteger(issueId) && issueId > 0 ? saveReceipt(issueId) : fail('pending', 503, 60);
        }
        if (result.status === 429) {
          this.db.prepare("UPDATE bug_reports SET state='retryable' WHERE owner=? AND report_id=?").run(owner, id);
          return fail('rate_limited', 429, 60);
        }
        if ([400,401,403,404,422].includes(result.status)) {
          this.db.prepare("UPDATE bug_reports SET state='rejected' WHERE owner=? AND report_id=?").run(owner, id);
          return fail('redmine_rejected', 502);
        }
        return fail('pending', 503, 60);
      }, undefined, 18000);
    } catch { return fail('pending', 503, 60); }
    finally { this.active.delete(lock); }
  }
}
