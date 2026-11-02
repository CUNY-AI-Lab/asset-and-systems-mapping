import { createHash } from 'node:crypto';

const TTL = 86400000;
const retryCodes = new Set(['upstream_rate_limited', 'upstream_unavailable', 'model_unavailable', 'guidance_in_progress']);
function canonical(value, depth = 0) {
  if (depth > 24) throw new Error('input_depth');
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], depth + 1)]));
  return value;
}
export function guidanceJobKey(owner, kind, input, scope) {
  const stable = structuredClone(input);
  if (stable.projectMetadata) for (const field of ['clientUpdatedAt', 'stage', 'furthestStage']) delete stable.projectMetadata[field];
  return createHash('sha256').update(JSON.stringify(canonical({ owner, kind, input: stable, scope }))).digest('hex');
}

// Inputs and outcomes live alongside account maps. Tokens stay in the current
// authenticated invocation. A process interruption leaves an explicit outcome
// requiring a deliberate retry, since provider completion may be uncertain.
export class GuidanceJobs {
  constructor(db, waitUntil, now = Date.now) {
    this.db = db; this.waitUntil = waitUntil; this.now = now; this.running = new Map(); this.attempts = new Map();
    db.exec(`CREATE TABLE IF NOT EXISTS cloud_guidance_jobs (
      owner TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,input TEXT NOT NULL,scope TEXT NOT NULL,
      state TEXT NOT NULL,attempts INTEGER NOT NULL,retry_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,outcome TEXT,status INTEGER,retry_tokens TEXT NOT NULL,attempt_id TEXT,PRIMARY KEY(owner,id)
    );
    CREATE TABLE IF NOT EXISTS cloud_guidance_requests (
      owner TEXT NOT NULL,token TEXT NOT NULL,job_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,token)
    );`);
  }
  purge() {
    this.db.prepare("DELETE FROM cloud_guidance_jobs WHERE created_at<=? AND (state!='running' OR updated_at<=?)").run(this.now() - TTL, this.now() - 90000);
    this.db.prepare('DELETE FROM cloud_guidance_requests WHERE created_at<=?').run(this.now() - 7 * TTL);
  }
  nextCleanup() {
    const job = this.db.prepare("SELECT min(CASE WHEN state='running' THEN max(created_at+86400000,updated_at+90000) ELSE created_at+86400000 END) AS at FROM cloud_guidance_jobs").get().at;
    const request = this.db.prepare('SELECT min(created_at) AS at FROM cloud_guidance_requests').get().at;
    const times = [job, request === null ? null : request + 7 * TTL].filter(value => value !== null);
    return times.length ? Math.max(this.now() + 1000, Math.min(...times)) : null;
  }
  row(owner, id) { return this.db.prepare('SELECT * FROM cloud_guidance_jobs WHERE owner=? AND id=?').get(owner, id); }
  view(row) {
    return { job: { id: row.id, state: row.state, attempts: row.attempts, retryAt: row.retry_at,
      createdAt: row.created_at, updatedAt: row.updated_at },
      ...(row.outcome ? { result: JSON.parse(row.outcome), resultStatus: row.status } : {}) };
  }
  read(owner, id) {
    let row = this.row(owner, id);
    if (!row || row.created_at + TTL <= this.now() && !(row.state === 'running' && row.updated_at + 90000 > this.now())) return null;
    if (row.state === 'running' && this.running.get(id) !== row.attempt_id) {
      this.fail(owner, id, 'Generation was interrupted. Your existing work was not changed. Choose Try again to start another attempt.', 'guidance_interrupted', row.attempt_id);
      row = this.row(owner, id);
    }
    return this.view(row);
  }
  fail(owner, id, error, code, attemptId) {
    this.db.prepare("UPDATE cloud_guidance_jobs SET state='failed',outcome=?,status=503,updated_at=? WHERE owner=? AND id=? AND attempt_id=?")
      .run(JSON.stringify({ error, details: { code, shouldRetry: false } }), this.now(), owner, id, attemptId);
  }
  create(owner, kind, input, scope, retry, run, requestToken = crypto.randomUUID()) {
    if (!['memo', 'connections', 'map-check'].includes(kind) || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('job_input');
    const encoded = JSON.stringify(input);
    if (new TextEncoder().encode(encoded).byteLength > 768 * 1024) throw new Error('job_input_size');
    const id = guidanceJobKey(owner, kind, input, scope), now = this.now();
    this.purge();
    const known = this.db.prepare('SELECT job_id FROM cloud_guidance_requests WHERE owner=? AND token=?').get(owner, requestToken);
    if (known) {
      if (!this.row(owner, known.job_id)) return { expired: true };
      if (known.job_id !== id) return { conflict: true };
      return this.resume(owner, id, scope, run);
    }
    if (this.db.prepare('SELECT count(*) AS n FROM cloud_guidance_requests WHERE owner=?').get(owner).n >= 1000) throw new Error('request_limit');
    this.db.prepare('INSERT INTO cloud_guidance_requests VALUES (?,?,?,?)').run(owner, requestToken, id, now);
    let row = this.row(owner, id);
    if (!row) {
      if (this.db.prepare('SELECT count(*) AS n FROM cloud_guidance_jobs WHERE owner=?').get(owner).n >= 40) throw new Error('job_limit');
      this.db.prepare('INSERT INTO cloud_guidance_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(owner, id, kind, encoded, scope, 'queued', 0, 0, now, now, null, null, JSON.stringify(typeof retry === 'string' ? [retry] : []), null);
    } else {
      this.read(owner, id);
      row = this.row(owner, id);
      const tokens = JSON.parse(row.retry_tokens);
      if (typeof retry === 'string' && /^[0-9a-f-]{36}$/.test(retry) && !tokens.includes(retry)) {
        if (tokens.length >= 20) throw new Error('retry_limit');
        tokens.push(retry);
        this.db.prepare('UPDATE cloud_guidance_jobs SET retry_tokens=? WHERE owner=? AND id=?').run(JSON.stringify(tokens), owner, id);
        if (row.state === 'failed') this.db.prepare("UPDATE cloud_guidance_jobs SET state='queued',attempts=0,retry_at=0,outcome=NULL,status=NULL,updated_at=? WHERE owner=? AND id=?").run(now, owner, id);
      }
    }
    return this.resume(owner, id, scope, run);
  }
  resume(owner, id, scope, run) {
    const current = this.read(owner, id);
    if (!current) return null;
    const row = this.row(owner, id);
    if (row.scope !== scope) return { conflict: true };
    if (['queued', 'retry_wait'].includes(row.state) && row.retry_at <= this.now()) {
      const attemptId = crypto.randomUUID();
      this.db.prepare("UPDATE cloud_guidance_jobs SET state='running',attempts=attempts+1,updated_at=?,attempt_id=? WHERE owner=? AND id=?").run(this.now(), attemptId, owner, id);
      this.running.set(id, attemptId);
      const pending = this.execute(owner, id, run, attemptId).finally(() => { if (this.running.get(id) === attemptId) { this.running.delete(id); this.attempts.delete(id); } });
      this.attempts.set(id, pending);
      this.waitUntil(pending);
    }
    return this.view(this.row(owner, id));
  }
  // Long-poll support: hold a read until the in-memory attempt settles or the
  // wait expires. A job owned by another instance has no attempt here and
  // returns immediately, so the caller falls back to ordinary polling.
  async wait(id, milliseconds) {
    const pending = this.attempts.get(id);
    if (!pending) return false;
    let timer;
    try {
      await Promise.race([pending, new Promise(resolve => { timer = setTimeout(resolve, milliseconds); })]);
    } finally { clearTimeout(timer); }
    return true;
  }
  async execute(owner, id, run, attemptId) {
    try {
      const row = this.row(owner, id);
      const response = await run(row.kind, JSON.parse(row.input));
      const result = await response.json();
      const safeRetry = !response.ok && retryCodes.has(result?.details?.code) && result.details.shouldRetry === true && row.attempts < 3;
      const delay = Math.max(2 ** row.attempts, Number.isSafeInteger(result?.details?.retryAfterSeconds) ? result.details.retryAfterSeconds : 1);
      const retryAt = safeRetry ? this.now() + Math.min(86400, delay) * 1000 : 0;
      this.db.prepare('UPDATE cloud_guidance_jobs SET state=?,retry_at=?,updated_at=?,outcome=?,status=? WHERE owner=? AND id=? AND attempt_id=?')
        .run(response.ok ? 'succeeded' : safeRetry ? 'retry_wait' : 'failed', retryAt, this.now(), JSON.stringify(result), response.status, owner, id, attemptId);
    } catch {
      this.fail(owner, id, 'Generation ended before its result could be confirmed. Your existing work was not changed. Choose Try again to start another attempt.', 'guidance_interrupted', attemptId);
    }
  }
}
