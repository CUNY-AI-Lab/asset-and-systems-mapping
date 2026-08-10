// @vitest-environment node

import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSystemsMappingApp } from './app.js';

const databaseUrl = process.env.TEST_POSTGRES_URL || null;
const ORIGIN = 'https://mapping.example.edu';
const BOOTSTRAP = 'disposable-postgres-bootstrap';
const PASSPHRASE = 'disposable postgres teacher phrase';
const HOSTED_CLASS_CODE = 'CALI2026Map7Qv9Wx3Z';

if (databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test')) {
    throw new Error('TEST_POSTGRES_URL must target a loopback database whose name ends in _test.');
  }
}

function request(system, path, options = {}) {
  return system.app.request(`${ORIGIN}${path}`, {
    ...options,
    headers: {
      host: 'mapping.example.edu',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.9',
      ...(options.headers || {}),
    },
  });
}

function jsonMutation(system, method, path, body, cookie) {
  return request(system, path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function localMutation(system, path, body, cookie) {
  const origin = 'http://127.0.0.1:4177';
  return system.app.request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      origin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function preflightEvaluation(projectId, overrides = {}) {
  return {
    projectMetadata: { projectId, title: 'PostgreSQL review snapshot' },
    activeScale: 'micro',
    inquiry: 'How does PostgreSQL preserve course review feedback?',
    sourceRecord: {
      id: `${projectId}_source`,
      title: 'PostgreSQL source',
      author: 'Student researcher',
      date: '2027-01-15',
      sourceType: 'course memo',
      location: 'CALI 2026',
      rights: 'Course use only',
      sensitive: false,
      consent: false,
      evidenceOwnership: 'Student interpretation remains labeled',
    },
    sourceMaterial: 'A school refers a family to an agency. The agency provides guidance to the family.',
    projectOverlay: {
      id: 'postgres-overlay',
      profileVersion: '1.0.0',
      outputSchemaVersion: 'systems-mapping.preflight-result.v1',
      label: 'PostgreSQL preflight',
      provider: 'local-deterministic',
      baseModel: 'STEM Splitter',
      customInstructions: 'Ask one repair question at a time.',
      contextLimit: 32_000,
      confidenceThreshold: 0.72,
      relationVocabulary: ['provides', 'refers', 'shapes'],
      revision: 1,
      fingerprint: 'postgres-overlay-fingerprint',
    },
    ...overrides,
  };
}

function nearLimitSourceRecord(projectId, targetBytes = 16_300) {
  const sourceRecord = {
    ...preflightEvaluation(projectId).sourceRecord,
    location: 'l'.repeat(5000),
    rights: 'r'.repeat(5000),
    evidenceOwnership: 'e'.repeat(5000),
  };
  const remaining = targetBytes - Buffer.byteLength(JSON.stringify(sourceRecord), 'utf8');
  if (remaining < 0 || sourceRecord.evidenceOwnership.length + remaining > 8000) {
    throw new Error('Near-limit PostgreSQL source-record fixture is invalid.');
  }
  sourceRecord.evidenceOwnership += 'x'.repeat(remaining);
  return sourceRecord;
}

describe.runIf(Boolean(databaseUrl))('PostgreSQL runtime integration', () => {
  let system;

  beforeAll(async () => {
    system = createSystemsMappingApp({
      databaseUrl,
      hostedMode: true,
      publicOrigin: ORIGIN,
      trustedProxyHops: 1,
      classCode: HOSTED_CLASS_CODE,
      teacherBootstrapToken: BOOTSTRAP,
      postgres: { maxConnections: 3 },
    });
    await system.ready;
  });

  afterAll(async () => {
    await system?.close();
  });

  it('migrates and seeds idempotently under an advisory lock', async () => {
    const second = createSystemsMappingApp({
      databaseUrl,
      hostedMode: true,
      publicOrigin: ORIGIN,
      trustedProxyHops: 1,
      classCode: HOSTED_CLASS_CODE,
      postgres: { maxConnections: 2 },
    });
    try {
      await second.ready;
      expect((await second.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).count).toBe(4);
      expect((await second.db.prepare('SELECT COUNT(*) AS count FROM accounts').get()).count).toBe(2);
      expect((await second.db.prepare('SELECT COUNT(*) AS count FROM prompt_modules').get()).count).toBe(60);
      expect((await second.db.prepare('SELECT COUNT(*) AS count FROM prompt_module_history').get()).count).toBe(60);
      expect((await second.db.prepare(`
        SELECT COUNT(*) AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN (
          'preflight_evaluations', 'preflight_submissions', 'preflight_review_events',
          'preflight_retention_purge_guard', 'preflight_retention_purges'
        )
      `).get()).count).toBe(5);
    } finally {
      await second.close();
    }
  });

  it('persists teacher auth and resolves optimistic revision races transactionally', async () => {
    expect(await (await request(system, '/api/health')).json()).toEqual({ status: 'ok' });
    expect((await jsonMutation(system, 'POST', '/api/student/access', { code: '101' })).status).toBe(401);
    const claim = await jsonMutation(system, 'POST', '/api/auth/claim', {
      userId: 'zach-muhlbauer',
      passphrase: PASSPHRASE,
      bootstrapToken: BOOTSTRAP,
    });
    expect(claim.status).toBe(201);
    expect(claim.headers.get('set-cookie')).toContain('Secure');
    const cookie = claim.headers.get('set-cookie').split(';')[0];

    const account = await system.db.prepare(`
      SELECT passphrase_hash AS passphraseHash, passphrase_salt AS passphraseSalt
      FROM accounts WHERE id = ?
    `).get('zach-muhlbauer');
    expect(Buffer.isBuffer(account.passphraseHash)).toBe(true);
    expect(Buffer.isBuffer(account.passphraseSalt)).toBe(true);

    const modules = (await (await request(system, '/api/teacher/modules', { headers: { cookie } })).json()).modules;
    const target = modules.find((module) => module.id === 'builder.meso.interaction');
    const bodies = ['First concurrent revision.', 'Second concurrent revision.'].map((suffix) => ({
      content: `${target.content} ${suffix}`,
      changeNote: suffix,
      expectedRevision: target.revision,
    }));
    const responses = await Promise.all(bodies.map((body) => jsonMutation(
      system,
      'PUT',
      `/api/teacher/modules/${target.id}`,
      body,
      cookie,
    )));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await system.db.prepare(`
      SELECT COUNT(*) AS count FROM prompt_module_history WHERE module_id = ? AND revision = ?
    `).get(target.id, target.revision + 1)).count).toBe(1);
    expect((await request(system, '/api/config/public', { headers: { cookie } })).status).toBe(200);

    const studentAccess = await jsonMutation(system, 'POST', '/api/student/access', { code: HOSTED_CLASS_CODE });
    expect(studentAccess.status).toBe(201);
    expect(studentAccess.headers.get('set-cookie')).toContain('Secure');
    const studentCookie = studentAccess.headers.get('set-cookie').split(';')[0];
    expect((await request(system, '/api/config/public', { headers: { cookie: studentCookie } })).status).toBe(200);
    const hostedActivity = await jsonMutation(system, 'POST', '/api/prototype/events', {
      event: 'stage_viewed',
      stage: 'Review suggestions',
      metadata: { stageIndex: 2 },
    }, studentCookie);
    expect(hostedActivity.status).toBe(202);
    expect(await hostedActivity.json()).toEqual({ accepted: true });
    expect(await system.db.prepare(`
      SELECT stage, metadata_json AS metadata
      FROM prototype_events WHERE event_name = ?
      ORDER BY id DESC LIMIT 1
    `).get('stage_viewed')).toEqual({ stage: 2, metadata: '{"stageIndex":2}' });
    const hostedProjectId = `hosted_postgres_${Date.now()}`;
    const hostedEvaluation = await jsonMutation(system, 'POST', '/api/preflight/evaluations', preflightEvaluation(
      hostedProjectId,
      { sourceRecord: nearLimitSourceRecord(hostedProjectId) },
    ), studentCookie);
    expect(hostedEvaluation.status).toBe(201);
    const hostedCapability = (await hostedEvaluation.json()).evaluation;
    expect(hostedCapability).toMatchObject({
      runtime: { provider: 'deterministic', model: 'STEM Splitter' },
      redirects: expect.any(Array),
    });
    expect(hostedCapability.redirects.length).toBeLessThanOrEqual(3);
    expect(hostedCapability).not.toHaveProperty('suggestion');
    expect(hostedCapability.configSnapshot.projectOverlay).not.toHaveProperty('customInstructions');
    expect(Buffer.byteLength(JSON.stringify(nearLimitSourceRecord(hostedProjectId)), 'utf8')).toBe(16_300);
    const hostedSubmission = await jsonMutation(system, 'POST', '/api/preflight/submissions', {
      evaluationId: hostedCapability.id,
      studentAnnotation: 'Review the hosted handoff.',
    }, studentCookie);
    expect(hostedSubmission.status).toBe(201);
    const hostedRecord = (await hostedSubmission.json()).submission;
    expect(hostedRecord).toMatchObject({ status: 'pending', revision: 1 });
    expect(hostedRecord).not.toHaveProperty('sourceMaterial');
    const focusedQuestion = 'Which source passage most directly supports the relationship you mapped?';
    const hostedDecision = await jsonMutation(
      system,
      'POST',
      `/api/teacher/preflight-submissions/${hostedRecord.id}/decision`,
      {
        decision: 'revise_and_approve',
        instructorAnnotation: 'Approved after one focused source check in hosted PostgreSQL.',
        focusedQuestion,
        expectedRevision: 1,
      },
      cookie,
    );
    expect(hostedDecision.status).toBe(200);
    const hostedDecisionBody = await hostedDecision.json();
    expect(hostedDecisionBody.submission).toMatchObject({
      status: 'approved',
      decision: 'revise_and_approve',
      focusedQuestion,
      revision: 2,
    });
    expect(hostedDecisionBody.submission).not.toHaveProperty('revisedSuggestion');
    expect(hostedDecisionBody.reviewEvents.at(-1)).toMatchObject({
      decision: 'revise_and_approve',
      focusedQuestion,
      fromRevision: 1,
      toRevision: 2,
    });
    expect(hostedDecisionBody.reviewEvents.at(-1)).not.toHaveProperty('revisedSuggestion');
    const studentStatus = await request(system, `/api/preflight/submissions/${hostedRecord.id}`, {
      headers: { cookie: studentCookie },
    });
    const studentStatusRecord = (await studentStatus.json()).submission;
    expect(studentStatusRecord).toMatchObject({
      status: 'approved',
      decision: 'revise_and_approve',
      focusedQuestion,
      revision: 2,
    });
    expect(studentStatusRecord).not.toHaveProperty('revisedSuggestion');
    expect(await system.db.prepare(`
      SELECT revised_suggestion AS focusedQuestion
      FROM preflight_submissions
      WHERE id = ?
    `).get(hostedRecord.id)).toEqual({ focusedQuestion });
    await expect(system.db.prepare('DELETE FROM preflight_review_events WHERE submission_id = ?').run(hostedRecord.id))
      .rejects.toThrow(/append-only/);

    const expiredAt = Date.now() - 181 * 24 * 60 * 60 * 1000 - 1000;
    await system.db.prepare(`
      UPDATE preflight_submissions
      SET created_at = ?, updated_at = ?, reviewed_at = ?
      WHERE id = ?
    `).run(expiredAt, expiredAt, expiredAt, hostedRecord.id);
    expect((await request(system, '/api/teacher/preflight-submissions?status=all', {
      headers: { cookie },
    })).status).toBe(200);
    expect(await system.db.prepare('SELECT COUNT(*) AS count FROM preflight_submissions WHERE id = ?').get(hostedRecord.id))
      .toEqual({ count: 0 });
    expect(await system.db.prepare('SELECT COUNT(*) AS count FROM preflight_review_events WHERE submission_id = ?').get(hostedRecord.id))
      .toEqual({ count: 0 });
    expect(await system.db.prepare(`
      SELECT submission_ref_hash AS submissionRefHash, status, decision, purged_by AS purgedBy
      FROM preflight_retention_purges WHERE submission_ref_hash = ?
    `).get(createHash('sha256').update(hostedRecord.id).digest('hex'))).toEqual({
      submissionRefHash: createHash('sha256').update(hostedRecord.id).digest('hex'),
      status: 'approved',
      decision: 'revise_and_approve',
      purgedBy: 'retention',
    });
  });

  it('preserves the local-only student-session and minimized-event contract on PostgreSQL', async () => {
    const localSystem = createSystemsMappingApp({
      databaseUrl,
      hostedMode: false,
      postgres: { maxConnections: 2 },
    });
    try {
      await localSystem.ready;
      const baselineStudentSessions = (await localSystem.db.prepare('SELECT COUNT(*) AS count FROM student_sessions').get()).count;
      const access = await localMutation(localSystem, '/api/student/access', { code: '101' });
      expect(access.status).toBe(201);
      const cookie = access.headers.get('set-cookie').split(';')[0];
      const event = await localMutation(localSystem, '/api/prototype/events', {
        event: 'node_moved',
        stage: 'Build the map',
        metadata: { stageIndex: 5, nodeCount: 4, keyboard: true },
      }, cookie);
      expect(event.status).toBe(202);
      expect((await localSystem.db.prepare('SELECT COUNT(*) AS count FROM student_sessions').get()).count)
        .toBe(baselineStudentSessions + 1);
      const stored = await localSystem.db.prepare(`
        SELECT metadata_json AS metadata FROM prototype_events WHERE event_name = ?
      `).get('node_moved');
      expect(stored.metadata).toBe('{"stageIndex":5,"nodeCount":4,"keyboard":true}');
      expect(stored.metadata).not.toContain('source');

      const projectId = `postgres_project_${Date.now()}`;
      const evaluated = await localMutation(
        localSystem,
        '/api/preflight/evaluations',
        preflightEvaluation(projectId),
        cookie,
      );
      expect(evaluated.status).toBe(201);
      const evaluation = (await evaluated.json()).evaluation;
      const submitted = await localMutation(localSystem, '/api/preflight/submissions', {
        evaluationId: evaluation.id,
        studentAnnotation: 'Review the agency handoff.',
      }, cookie);
      expect(submitted.status).toBe(201);
      const submission = (await submitted.json()).submission;
      expect(submission.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect((await localSystem.db.prepare('SELECT COUNT(*) AS count FROM preflight_submissions WHERE id = ?').get(submission.id)).count)
        .toBe(1);

      const login = await localMutation(localSystem, '/api/auth/login', {
        userId: 'zach-muhlbauer', passphrase: PASSPHRASE,
      });
      expect(login.status).toBe(200);
      const teacherCookie = login.headers.get('set-cookie').split(';')[0];
      const reviewed = await localMutation(localSystem, `/api/teacher/preflight-submissions/${submission.id}/decision`, {
        decision: 'approve',
        instructorAnnotation: 'PostgreSQL transaction approved this snapshot.',
        expectedRevision: 1,
      }, teacherCookie);
      expect(reviewed.status).toBe(200);
      expect((await reviewed.json()).submission).toMatchObject({ status: 'approved', decision: 'approve', revision: 2 });
      expect((await localSystem.db.prepare('SELECT COUNT(*) AS count FROM preflight_review_events WHERE submission_id = ?').get(submission.id)).count)
        .toBe(1);
      expect((await localMutation(localSystem, '/api/student/logout', {}, cookie)).status).toBe(200);
      expect((await localSystem.db.prepare('SELECT COUNT(*) AS count FROM student_sessions').get()).count)
        .toBe(baselineStudentSessions);
    } finally {
      await localSystem.close();
    }
  });
});
