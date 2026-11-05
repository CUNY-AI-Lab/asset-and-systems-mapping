import { createHash } from 'node:crypto';
import { boundedText, withDeadline, withSignal } from './bounded.js';
import { durableDatabase } from './database.js';
import type { BugReportService } from './bug-reports';
import { parseGuestContact, type GuestContact } from '../src/support/contact.js';

type ReportEnv = { REDMINE_API_KEY?: string; RELEASE: string; PUBLIC_ORIGIN?: string; BUG_REPORT_MODE?: string; BUG_REPORTS?: BugReportService };
type Delivery = 'redmine' | 'email';
type Receipt = { fingerprint: string; state: string; created_at: string; issue_id: number | null; delivery: Delivery; fallback_safe: number };
export const contactReporting = (env: ReportEnv) => ['redmine', 'email'].includes(env.BUG_REPORT_MODE || '') || Boolean(env.REDMINE_API_KEY);
export const reportDelivery = (env: ReportEnv): Delivery => env.BUG_REPORT_MODE === 'redmine' ? 'redmine'
  : env.BUG_REPORT_MODE === 'email' || !env.REDMINE_API_KEY ? 'email' : 'redmine';
export const reportFallback = (env: ReportEnv): 'email' | null => env.BUG_REPORT_MODE !== 'redmine'
  && reportDelivery(env) === 'redmine' && Boolean(env.BUG_REPORTS) ? 'email' : null;
export const reportsEnabled = (env: ReportEnv) => reportDelivery(env) === 'email' ? Boolean(env.BUG_REPORTS) : Boolean(env.REDMINE_API_KEY);
// The shared receiver scopes UUIDs to an application. Derive a stable UUID per
// local owner/report so an unrelated reporter cannot reuse another receipt.
function emailReportId(owner: string, reportId: string) {
  const hex = digest(`systems-mapping-email:v1\n${owner}\n${reportId}`).slice(0, 32).split('');
  hex[12] = '4'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
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
  // Workers supports manual/follow only. Never forward the API key on redirects.
  const response = await withSignal(fetch(new URL(resource, BASE), { ...init, headers, redirect: 'manual', signal }), signal);
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

/** Private report receipts stay in this deployment's Durable Object. */
export class RedmineReports {
  private active = new Set<string>();
  constructor(private db: ReturnType<typeof durableDatabase>, private storage: DurableObjectStorage, private env: ReportEnv) {
    db.exec(`CREATE TABLE IF NOT EXISTS bug_reports (
      owner TEXT NOT NULL, report_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','saved','rejected','retryable')),
      issue_id INTEGER, PRIMARY KEY(owner,report_id)
    );
    CREATE INDEX IF NOT EXISTS bug_reports_owner_time ON bug_reports(owner,created_at);
    CREATE TABLE IF NOT EXISTS bug_report_guests (
      owner TEXT NOT NULL, report_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','saved','rejected','retryable')),
      issue_id INTEGER, rate_key TEXT NOT NULL, PRIMARY KEY(owner,report_id)
    );
    CREATE INDEX IF NOT EXISTS bug_report_guests_owner_time ON bug_report_guests(owner,created_at);
    CREATE INDEX IF NOT EXISTS bug_report_guests_rate_time ON bug_report_guests(rate_key,created_at);`);
    // Preserve the original receipt-table shapes for older release code.
    // Missing channel metadata identifies an earlier Redmine receipt.
    db.exec(`CREATE TABLE IF NOT EXISTS bug_report_delivery (
      kind TEXT NOT NULL CHECK(kind IN ('bug_reports','bug_report_guests')),
      owner TEXT NOT NULL, report_id TEXT NOT NULL,
      delivery TEXT NOT NULL CHECK(delivery IN ('redmine','email')),
      fallback_safe INTEGER NOT NULL DEFAULT 0 CHECK(fallback_safe IN (0,1)),
      PRIMARY KEY(kind,owner,report_id)
    )`);
  }

  async request(request: Request, accountOwner: string | null, preferredName?: string | null, rateKey?: string): Promise<Response> {
    const url = new URL(request.url);
    const guest = url.pathname === '/api/bug-reports/guest';
    if (guest ? accountOwner !== null || !rateKey || !/^[0-9a-f]{64}$/.test(rateKey) : !accountOwner) return fail('forbidden', 403);
    const table = guest ? 'bug_report_guests' : 'bug_reports';
    if (url.search) return fail('invalid', 400);
    if (!reportsEnabled(this.env)) return fail('disabled', 503);
    if (url.pathname === '/api/bug-reports/session') {
      return request.method === 'GET' ? Response.json({ ok: true, expectedActor: accountOwner, preferredName: preferredName ?? null }) : fail('method_not_allowed', 405);
    }
    if (request.method !== 'POST') return fail('method_not_allowed', 405);
    let body;
    try {
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('content_type');
      body = await withDeadline(async signal => JSON.parse(await boundedText(request, signal, 32768)), request.signal, 5000);
    } catch { return fail('invalid', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== (guest ? 'description,email,firstName,lastName,path,reportId' : 'description,expectedActor,path,reportId')
      || typeof body.reportId !== 'string' || !UUID.test(body.reportId)
      || (!guest && (typeof body.expectedActor !== 'string' || !/^[0-9a-f]{64}$/.test(body.expectedActor)))
      || !['/','/teacher.html','/account.html','/p/:shared-map'].includes(body.path)
      || typeof body.description !== 'string' || body.description.length > 4000) return fail('invalid', 400);
    if (!guest && body.expectedActor !== accountOwner) return fail('account_changed', 409);
    let contact: GuestContact | null = null;
    if (guest) {
      const parsed = parseGuestContact(body);
      if (!parsed.ok) return Response.json({ ok: false, code: 'invalid_contact', fields: parsed.errors }, { status: 400 });
      contact = parsed.contact;
    }
    const owner = contact ? digest(`guest-report-email:v1\n${contact.email}`) : accountOwner!;
    const description = body.description.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
    if (description.length < 10 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(description)) return fail('invalid', 400);
    const id = body.reportId as string;
    const fingerprint = digest(`${id}\n${body.path}\n${description}${contact ? `\n${JSON.stringify(contact)}` : ''}`);
    const lock = `${owner}:${id}`;
    if (this.active.has(lock)) return fail('pending', 202, 5);
    this.active.add(lock);
    try {
      const createdAt = new Date().toISOString();
      const start = this.storage.transactionSync(() => {
        const existing = this.db.prepare(`SELECT r.fingerprint,r.state,r.created_at,r.issue_id,
          COALESCE(d.delivery,'redmine') AS delivery,COALESCE(d.fallback_safe,0) AS fallback_safe
          FROM ${table} r LEFT JOIN bug_report_delivery d ON d.kind=? AND d.owner=r.owner AND d.report_id=r.report_id
          WHERE r.owner=? AND r.report_id=?`).get(table, owner, id) as Receipt | undefined;
        if (existing) return { existing };
        const recent = this.db.prepare(`SELECT count(*) AS n, min(created_at) AS oldest FROM ${table} WHERE owner=? AND created_at>=?`)
          .get(owner, new Date(Date.now() - 86400000).toISOString());
        if (recent.n >= 10) return { limited: Math.max(60, Math.ceil((Date.parse(recent.oldest) + 86400000 - Date.now()) / 1000)) };
        if (guest) {
          const network = this.db.prepare('SELECT count(*) AS n, min(created_at) AS oldest FROM bug_report_guests WHERE rate_key=? AND created_at>=?')
            .get(rateKey, new Date(Date.now() - 86400000).toISOString());
          if (network.n >= 20) return { limited: Math.max(60, Math.ceil((Date.parse(network.oldest) + 86400000 - Date.now()) / 1000)) };
          this.db.prepare("INSERT INTO bug_report_guests(owner,report_id,fingerprint,created_at,state,issue_id,rate_key) VALUES (?,?,?,?,'pending',NULL,?)").run(owner, id, fingerprint, createdAt, rateKey);
        } else this.db.prepare("INSERT INTO bug_reports(owner,report_id,fingerprint,created_at,state,issue_id) VALUES (?,?,?,?,'pending',NULL)").run(owner, id, fingerprint, createdAt);
        this.db.prepare('INSERT INTO bug_report_delivery(kind,owner,report_id,delivery) VALUES (?,?,?,?)').run(table, owner, id, reportDelivery(this.env));
        return { createdAt };
      });
      if ('limited' in start) return fail('rate_limited', 429, start.limited);
      const existing = start.existing;
      if (existing && existing.fingerprint !== fingerprint) return fail('idempotency_conflict', 409);
      const at = existing?.created_at ?? createdAt;
      let delivery = existing?.delivery ?? reportDelivery(this.env);
      const saved = () => Response.json({ ok: true, status: delivery === 'email' ? 'accepted' : 'saved', delivery, reportId: id, createdAt: at, ...(delivery === 'email' ? { deliveryReference: emailReportId(owner, id) } : {}) });
      const saveReceipt = (issueId: number | null) => {
        this.db.prepare(`UPDATE ${table} SET state='saved',issue_id=? WHERE owner=? AND report_id=?`).run(issueId, owner, id);
        return saved();
      };
      const sendEmail = async () => {
        if (!this.env.BUG_REPORTS || !this.env.PUBLIC_ORIGIN) return fail('unavailable', 503, 60);
        const ip = request.headers.get('cf-connecting-ip');
        if (!ip || !/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return fail('unavailable', 503, 60);
        // Persist the channel before dispatch. Retries use this exact derived
        // UUID; Admission owns the durable claim and email acceptance receipt.
        delivery = 'email';
        this.storage.transactionSync(() => {
          this.db.prepare(`INSERT INTO bug_report_delivery(kind,owner,report_id,delivery) VALUES (?,?,?,'email')
            ON CONFLICT(kind,owner,report_id) DO UPDATE SET delivery='email'`).run(table, owner, id);
          this.db.prepare(`UPDATE ${table} SET state='pending' WHERE owner=? AND report_id=?`).run(owner, id);
        });
        await this.storage.sync();
        const serviceId = emailReportId(owner, id);
        const rateDay = new Date().toISOString().slice(0, 10);
        let result;
        try {
          result = await withDeadline(signal => withSignal(this.env.BUG_REPORTS!.submitPublic({
            reportId: serviceId, description, origin: this.env.PUBLIC_ORIGIN!,
            path: body.path === '/p/:shared-map' ? '/p/:shared-map' : '/', release: this.env.RELEASE,
            rateDay, rateKey: digest(`cail-public-report:systems-mapping:${rateDay}:${ip}`),
          }), signal), undefined, 18000);
        } catch { return fail('delivery_unknown', 503, 60); }
        if (result?.ok === true && result.status === 'accepted' && result.reportId === serviceId) return saveReceipt(null);
        if (result?.ok === false) {
          const delay = Number.isSafeInteger(result.retryAfterSeconds) && result.retryAfterSeconds! > 0 && result.retryAfterSeconds! <= 86400 ? result.retryAfterSeconds : 60;
          if (result.code === 'rate_limited' || (result.code === 'unavailable' && result.retryable === true)) {
            this.db.prepare(`UPDATE ${table} SET state='retryable' WHERE owner=? AND report_id=?`).run(owner, id);
            return fail(result.code, result.code === 'rate_limited' ? 429 : 503, delay);
          }
          if (['invalid', 'forbidden', 'idempotency_conflict'].includes(result.code) || (result.code === 'unavailable' && result.retryable === false)) {
            this.db.prepare(`UPDATE ${table} SET state='rejected' WHERE owner=? AND report_id=?`).run(owner, id);
            return fail('email_rejected', 502);
          }
        }
        return fail('delivery_unknown', 503, 60);
      };
      if (existing?.state === 'saved') return saved();
      if (delivery === 'email') {
        if (existing?.state === 'rejected') return fail('email_rejected', 502);
        return await sendEmail();
      }
      // Only a definitive rejection permits changing delivery channels. A
      // pending Redmine attempt is reconciled even after switching to email.
      if (existing?.state === 'rejected' || existing?.state === 'retryable') {
        // Older rejected rows may represent redirects after an issue was
        // created. Only new classified rejections (or a 429) allow fallback.
        if (reportFallback(this.env) && (existing.state === 'retryable' || existing.fallback_safe === 1)) return await sendEmail();
        if (existing.state === 'rejected') return fail('redmine_rejected', 502);
      }
      return await withDeadline(async signal => {
        if (existing?.state === 'pending') {
          const issueId = await findIssue(this.env, id, owner, at, signal);
          // Redmine has no idempotency-key API. A lost acknowledgement must
          // never trigger another POST; it can only reconcile the receipt.
          return issueId === null ? fail('pending', 503, 60) : saveReceipt(issueId);
        }
        if (existing?.state === 'retryable') {
          this.db.prepare(`UPDATE ${table} SET state='pending' WHERE owner=? AND report_id=?`).run(owner, id);
        }
        const page = ({ '/': 'Workspace', '/teacher.html': 'Instructor', '/account.html': 'Account', '/p/:shared-map': 'Shared map' } as Record<string,string>)[body.path];
        await this.storage.sync();
        const result = await redmine(this.env, 'issues.json', signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issue: { project_id: PROJECT, tracker_id: TRACKER, subject: subject(id, owner), is_private: true,
            description: [...(contact ? [`Reporter (self-reported): ${contact.firstName} ${contact.lastName}`, `Contact email (unverified): ${contact.email}`]
              : [`CAIL account reference: ${owner.slice(0,16)}`, ...(preferredName ? [`SSO preferred name: ${preferredName}`] : [])]), `Page: ${page}`, `System Mapping release: ${this.env.RELEASE}`,
              `Reported at: ${at}`, `Report reference: ${id}`, '', description].join('\n'),
          } }),
        });
        if (result.ok) {
          const issueId = result.data?.issue?.id;
          return Number.isSafeInteger(issueId) && issueId > 0 ? saveReceipt(issueId) : fail('pending', 503, 60);
        }
        if (result.status === 429) {
          this.db.prepare(`UPDATE ${table} SET state='retryable' WHERE owner=? AND report_id=?`).run(owner, id);
          return reportFallback(this.env) ? sendEmail() : fail('rate_limited', 429, 60);
        }
        if ([400,401,403,404,422].includes(result.status)) {
          this.storage.transactionSync(() => {
            this.db.prepare(`UPDATE ${table} SET state='rejected' WHERE owner=? AND report_id=?`).run(owner, id);
            this.db.prepare(`INSERT INTO bug_report_delivery(kind,owner,report_id,delivery,fallback_safe) VALUES (?,?,?,'redmine',1)
              ON CONFLICT(kind,owner,report_id) DO UPDATE SET fallback_safe=1`).run(table, owner, id);
          });
          return reportFallback(this.env) ? sendEmail() : fail('redmine_rejected', 502);
        }
        return fail('pending', 503, 60);
      }, undefined, 18000);
    } catch { return fail('pending', 503, 60); }
    finally { this.active.delete(lock); }
  }
}
