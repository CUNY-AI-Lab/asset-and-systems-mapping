// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSystemsMappingApp } from './app.js';
import { issueSession, issueStudentSession, STUDENT_SESSION_COOKIE, TEACHER_SESSION_COOKIE } from './auth.js';
import { openDatabase } from './database.js';
import { MAX_RETENTION_HOLD_MS, parseRetentionHoldUntil, retentionCleanupAllowed } from './retention.js';

const DAY_MS = 86400000;
const BASE_TIME = Date.parse('2026-10-03T17:00:00.000Z');
const ORIGIN = 'http://127.0.0.1:4177';
const EXPIRED_EVALUATION = 'e'.repeat(32);
const EXPIRED_PENDING = 'p'.repeat(32);
const EXPIRED_DECIDED = 'd'.repeat(32);
const OLD_LINK = 'old_project_link_capability';

describe('bounded operator migration retention hold', () => {
  it('accepts a UTC deadline of at most seven days and resumes at that instant', () => {
    const until = parseRetentionHoldUntil(new Date(BASE_TIME + MAX_RETENTION_HOLD_MS).toISOString(), { now: () => BASE_TIME });
    expect(retentionCleanupAllowed(until, until - 1)).toBe(false);
    expect(retentionCleanupAllowed(until, until)).toBe(true);
    expect(parseRetentionHoldUntil('2026-10-03T18:00:00Z', { now: () => BASE_TIME })).toBe(BASE_TIME + 3600000);
  });

  it('rejects malformed, non-UTC, impossible, and overlong deadlines', () => {
    for (const value of ['', 'tomorrow', '2026-10-03', '2026-02-30T18:00:00Z', '2026-10-03T18:00:00+00:00', 123,
      new Date(BASE_TIME + MAX_RETENTION_HOLD_MS + 1).toISOString()]) {
      expect(() => parseRetentionHoldUntil(value, { now: () => BASE_TIME })).toThrow(/UTC ISO timestamp/);
    }
  });

  it('keeps default cleanup enabled and permits restart with an elapsed deadline', () => {
    expect(parseRetentionHoldUntil(undefined)).toBeNull();
    expect(retentionCleanupAllowed(null, BASE_TIME)).toBe(true);
    const elapsed = parseRetentionHoldUntil('2026-10-02T18:00:00Z', { now: () => BASE_TIME });
    expect(retentionCleanupAllowed(elapsed, BASE_TIME)).toBe(true);
  });
});

describe('retention hold across server cleanup paths', () => {
  let db;
  let system;
  let now;
  let until;

  beforeEach(() => {
    now = BASE_TIME;
    until = BASE_TIME + 3600000;
    db = openDatabase(':memory:');
    const old = BASE_TIME - 181 * DAY_MS;
    db.prepare(`INSERT INTO prototype_events
      (session_kind,session_ref,event_name,stage,metadata_json,recorded_at)
      VALUES ('student','0123456789abcdef','project_started',0,'{}',?)`).run(old);
    db.prepare(`INSERT INTO preflight_evaluations
      (id,student_session_ref,project_metadata_json,active_scale,inquiry,source_record_json,source_material,
        project_overlay_json,suggestion_json,config_snapshot_json,runtime_metadata_json,created_at,expires_at)
      VALUES (?,'0123456789abcdef','{}','micro','Question','{}','Retained memo','{}','{}','{}','{}',?,?)`)
      .run(EXPIRED_EVALUATION, old, old + DAY_MS);
    db.prepare(`INSERT INTO preflight_submissions
      (id,student_session_ref,project_metadata_json,active_scale,inquiry,source_material,student_annotation,
        suggestion_json,config_snapshot_json,status,created_at,updated_at)
      VALUES (?,'0123456789abcdef','{}','micro','Question','Retained memo','','{}','{}','pending',?,?)`)
      .run(EXPIRED_PENDING, old, old);
    db.prepare(`INSERT INTO preflight_submissions
      (id,student_session_ref,project_metadata_json,active_scale,inquiry,source_material,student_annotation,
        suggestion_json,config_snapshot_json,status,decision,revision,created_at,updated_at,reviewed_at,
        reviewing_teacher_id,instructor_annotation)
      VALUES (?,'0123456789abcdef','{}','micro','Question','Retained memo','','{}','{}','approved','approve',2,?,?,?,
        'maria-mavrides-calderon','Retained feedback')`).run(EXPIRED_DECIDED, old, old, old);
    db.prepare(`INSERT INTO preflight_review_events
      (submission_id,decision,from_revision,to_revision,instructor_annotation,decided_at,reviewing_teacher_id)
      VALUES (?,'approve',1,2,'Retained feedback',?,'maria-mavrides-calderon')`).run(EXPIRED_DECIDED, old);
    db.prepare(`INSERT INTO saved_projects
      (token_hash,project_id,project_json,created_session_ref,created_at,updated_at,revision,expires_at)
      VALUES (?,'old_project','{"id":"old_project"}','0123456789abcdef',?,?,1,?)`)
      .run(createHash('sha256').update(OLD_LINK).digest('hex'), old, old, old + DAY_MS);
    system = createSystemsMappingApp({ db, now: () => now, retentionHoldUntil: new Date(until).toISOString(),
      prototypeMaxRows: 1, preflightEvaluationTtlMs: 1000 });
  });

  afterEach(() => { db.close(); });

  function count(table) { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }

  function request(path, { method = 'GET', cookie, body } = {}) {
    return system.app.request(`${ORIGIN}${path}`, { method,
      headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }

  async function cookies() {
    const student = await issueStudentSession(db, 2 * DAY_MS, { now: () => now });
    const teacher = await issueSession(db, 'maria-mavrides-calderon', 2 * DAY_MS, { now: () => now });
    return { student: `${STUDENT_SESSION_COOKIE}=${student.token}`, teacher: `${TEACHER_SESSION_COOKIE}=${teacher.token}` };
  }

  function evaluationBody() {
    return { projectMetadata: { projectId: 'hold_test', title: 'Synthetic retention test' }, activeScale: 'micro',
      stageId: 'review-suggestions', inquiry: 'Who helps the family?',
      sourceRecord: { id: 'hold_memo', title: 'Memo', author: '', date: '', sourceType: 'course memo', location: '',
        rights: '', sensitive: false, consent: false, evidenceOwnership: '' },
      sourceMaterial: 'A family visits a clinic.',
      projectOverlay: { id: 'hold_overlay', profileVersion: '1.0.0', outputSchemaVersion: 'systems-mapping.preflight-result.v1',
        label: 'Test', provider: 'local-deterministic', baseModel: 'STEM Splitter', customInstructions: '', contextLimit: 32000,
        confidenceThreshold: 0.72, relationVocabulary: ['helps'], revision: 1, fingerprint: 'hold-fingerprint' } };
  }

  it('preserves expired content at startup and leaves ordinary startup retention unchanged', async () => {
    await system.ready;
    expect(count('preflight_evaluations')).toBe(1);
    expect(count('preflight_submissions')).toBe(2);
    expect(count('preflight_review_events')).toBe(1);
    expect(count('prototype_events')).toBe(1);
    expect(count('saved_projects')).toBe(1);
    system = createSystemsMappingApp({ db, now: () => now });
    await system.ready;
    expect(count('preflight_evaluations')).toBe(0);
    expect(count('preflight_submissions')).toBe(0);
    expect(count('preflight_review_events')).toBe(0);
    expect(count('prototype_events')).toBe(0);
    expect(count('preflight_retention_purges')).toBe(2);
    expect(count('saved_projects')).toBe(1);
  });

  it('holds queue reads, events, evaluation issue/consume, and project-link cleanup until the deadline', async () => {
    await system.ready;
    const session = await cookies();
    expect((await request('/api/teacher/preflight-submissions?status=all', { cookie: session.teacher })).status).toBe(200);
    expect(count('preflight_submissions')).toBe(2);
    expect(count('preflight_review_events')).toBe(1);
    expect((await request('/api/prototype/events', { method: 'POST', cookie: session.student,
      body: { event: 'project_started', metadata: {} } })).status).toBe(202);
    expect(count('prototype_events')).toBe(2);
    const issued = await request('/api/preflight/evaluations', { method: 'POST', cookie: session.student, body: evaluationBody() });
    expect(issued.status).toBe(201);
    const evaluation = (await issued.json()).evaluation;
    expect(count('preflight_evaluations')).toBe(2);
    expect((await request('/api/preflight/submissions', { method: 'POST', cookie: session.student,
      body: { evaluationId: evaluation.id, studentAnnotation: '' } })).status).toBe(201);
    expect(count('preflight_evaluations')).toBe(2);
    expect((await request('/api/projects', { method: 'POST', cookie: session.student,
      body: { project: JSON.stringify({ id: 'fresh_project', schemaVersion: 5 }) } })).status).toBe(201);
    expect(count('saved_projects')).toBe(2);

    now = until;
    expect((await request('/api/teacher/preflight-submissions?status=all', { cookie: session.teacher })).status).toBe(200);
    expect(count('preflight_submissions')).toBe(1);
    expect(count('preflight_review_events')).toBe(0);
    expect((await request('/api/prototype/events', { method: 'POST', cookie: session.student,
      body: { event: 'project_started', metadata: {} } })).status).toBe(202);
    expect(count('prototype_events')).toBe(1);
    expect((await request('/api/preflight/evaluations', { method: 'POST', cookie: session.student, body: evaluationBody() })).status).toBe(201);
    expect(count('preflight_evaluations')).toBe(1);
    expect((await request('/api/projects', { method: 'POST', cookie: session.student,
      body: { project: JSON.stringify({ id: 'later_project', schemaVersion: 5 }) } })).status).toBe(201);
    expect(count('saved_projects')).toBe(2);
  });

  it('does not extend expired links, bypass authentication, or prevent explicit deletion', async () => {
    await system.ready;
    const session = await cookies();
    expect((await request(`/api/projects/${OLD_LINK}`)).status).toBe(401);
    expect((await request(`/api/projects/${OLD_LINK}`, { cookie: session.student })).status).toBe(410);
    expect((await request('/api/teacher/preflight-submissions', { cookie: session.student })).status).toBe(401);
    expect((await request('/api/preflight/submissions', { method: 'POST', cookie: session.student,
      body: { evaluationId: EXPIRED_EVALUATION, studentAnnotation: '' } })).status).toBe(409);
    expect(count('preflight_evaluations')).toBe(1);
    expect((await request(`/api/projects/${OLD_LINK}`, { method: 'DELETE', cookie: session.student,
      body: { expectedRevision: 1 } })).status).toBe(200);
    expect(count('saved_projects')).toBe(0);
  });
});
