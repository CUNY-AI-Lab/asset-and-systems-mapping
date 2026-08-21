// @vitest-environment node

import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSystemsMappingApp } from './app.js';

const { Pool } = pg;

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
    stageId: 'review-suggestions',
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

function postgresSchemaUrl(baseUrl, schema) {
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  return url.toString();
}

async function createLegacyV8Schema(baseUrl, schema, fixture) {
  if (!/^[a-z][a-z0-9_]+$/.test(schema)) throw new Error('Unsafe PostgreSQL test schema name.');
  const pool = new Pool({ connectionString: baseUrl, max: 1, allowExitOnIdle: false });
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE prompt_modules (
        id TEXT PRIMARY KEY,
        config_kind TEXT NOT NULL CHECK(config_kind IN ('preflight', 'builder')),
        scale TEXT NOT NULL CONSTRAINT prompt_modules_scale_check
          CHECK(scale IN ('global', 'micro', 'meso', 'macro', 'integration')),
        module_key TEXT NOT NULL CHECK(module_key IN ('purpose', 'evidence', 'privacy', 'scale_rubric', 'interaction', 'output')),
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        content TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
        fingerprint TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        updated_by TEXT,
        UNIQUE(config_kind, scale, module_key)
      );

      CREATE TABLE prompt_module_history (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES prompt_modules(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK(revision >= 1),
        content TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        change_note TEXT NOT NULL,
        changed_at TIMESTAMPTZ NOT NULL,
        changed_by TEXT,
        UNIQUE(module_id, revision)
      );

      CREATE TABLE preflight_evaluations (
        id TEXT PRIMARY KEY CHECK(char_length(id) = 32),
        student_session_ref TEXT NOT NULL CHECK(char_length(student_session_ref) = 16),
        project_metadata_json JSONB NOT NULL,
        active_scale TEXT NOT NULL CONSTRAINT preflight_evaluations_active_scale_check
          CHECK(active_scale IN ('micro', 'meso', 'macro', 'integration')),
        inquiry TEXT NOT NULL,
        source_record_json JSONB NOT NULL,
        source_material TEXT NOT NULL,
        project_overlay_json JSONB NOT NULL,
        suggestion_json JSONB NOT NULL,
        config_snapshot_json JSONB NOT NULL,
        runtime_metadata_json JSONB NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        consumed_at BIGINT
      );

      CREATE TABLE preflight_submissions (
        id TEXT PRIMARY KEY CHECK(char_length(id) = 32),
        student_session_ref TEXT NOT NULL CHECK(char_length(student_session_ref) = 16),
        project_metadata_json JSONB NOT NULL,
        active_scale TEXT NOT NULL CONSTRAINT preflight_submissions_active_scale_check
          CHECK(active_scale IN ('micro', 'meso', 'macro', 'integration')),
        inquiry TEXT NOT NULL,
        source_material TEXT NOT NULL,
        source_record_json JSONB,
        student_annotation TEXT NOT NULL,
        suggestion_json JSONB NOT NULL,
        config_snapshot_json JSONB NOT NULL,
        runtime_metadata_json JSONB,
        status TEXT NOT NULL DEFAULT 'pending',
        decision TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        reviewed_at BIGINT,
        reviewing_teacher_id TEXT,
        instructor_annotation TEXT,
        revised_suggestion TEXT
      );

      CREATE TABLE saved_projects (
        token_hash TEXT PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
        project_id TEXT NOT NULL,
        project_json TEXT NOT NULL,
        created_session_ref TEXT NOT NULL CHECK(length(created_session_ref) = 16),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      INSERT INTO schema_migrations (version)
      SELECT generate_series(1, 8);
    `);

    for (const module of fixture.modules) {
      await client.query(`
        INSERT INTO prompt_modules (
          id, config_kind, scale, module_key, label, description, content,
          revision, fingerprint, updated_at, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)
      `, [
        module.id,
        module.configKind,
        module.scale,
        module.moduleKey,
        module.label,
        module.description,
        module.content,
        module.revision,
        module.fingerprint,
        module.updatedAt,
      ]);
      await client.query(`
        INSERT INTO prompt_module_history (
          id, module_id, revision, content, fingerprint, change_note, changed_at, changed_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
      `, [
        module.historyId,
        module.id,
        module.revision,
        module.content,
        module.fingerprint,
        module.changeNote,
        module.updatedAt,
      ]);
    }

    await client.query(`
      INSERT INTO preflight_evaluations (
        id, student_session_ref, project_metadata_json, active_scale, inquiry,
        source_record_json, source_material, project_overlay_json, suggestion_json,
        config_snapshot_json, runtime_metadata_json, created_at, expires_at, consumed_at
      ) VALUES (
        $1, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb,
        $10::jsonb, $11::jsonb, $12, $13, NULL
      )
    `, [
      fixture.evaluation.id,
      fixture.sessionRef,
      JSON.stringify(fixture.evaluation.projectMetadata),
      fixture.evaluation.activeScale,
      fixture.evaluation.inquiry,
      JSON.stringify(fixture.evaluation.sourceRecord),
      fixture.evaluation.sourceMaterial,
      JSON.stringify(fixture.evaluation.projectOverlay),
      JSON.stringify(fixture.evaluation.suggestion),
      JSON.stringify(fixture.evaluation.configSnapshot),
      JSON.stringify(fixture.evaluation.runtimeMetadata),
      fixture.createdAt,
      fixture.expiresAt,
    ]);

    await client.query(`
      INSERT INTO preflight_submissions (
        id, student_session_ref, project_metadata_json, active_scale, inquiry,
        source_material, source_record_json, student_annotation, suggestion_json,
        config_snapshot_json, runtime_metadata_json, status, decision, revision,
        created_at, updated_at, reviewed_at, reviewing_teacher_id,
        instructor_annotation, revised_suggestion
      ) VALUES (
        $1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8, $9::jsonb,
        $10::jsonb, $11::jsonb, 'pending', NULL, $12, $13, $13,
        NULL, NULL, NULL, NULL
      )
    `, [
      fixture.submission.id,
      fixture.sessionRef,
      JSON.stringify(fixture.submission.projectMetadata),
      fixture.submission.activeScale,
      fixture.submission.inquiry,
      fixture.submission.sourceMaterial,
      JSON.stringify(fixture.submission.sourceRecord),
      fixture.submission.studentAnnotation,
      JSON.stringify(fixture.submission.suggestion),
      JSON.stringify(fixture.submission.configSnapshot),
      JSON.stringify(fixture.submission.runtimeMetadata),
      fixture.submission.revision,
      fixture.createdAt,
    ]);

    await client.query(`
      INSERT INTO saved_projects (
        token_hash, project_id, project_json, created_session_ref, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $5)
    `, [
      fixture.savedProject.tokenHash,
      fixture.savedProject.projectId,
      JSON.stringify(fixture.savedProject.project),
      fixture.sessionRef,
      fixture.createdAt,
    ]);
  } finally {
    client.release();
    await pool.end();
  }
}

async function dropPostgresTestSchema(baseUrl, schema) {
  if (!/^[a-z][a-z0-9_]+$/.test(schema)) throw new Error('Unsafe PostgreSQL test schema name.');
  const pool = new Pool({ connectionString: baseUrl, max: 1, allowExitOnIdle: false });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await pool.end();
  }
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
      expect((await second.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).count).toBe(9);
      expect((await second.db.prepare('SELECT COUNT(*) AS count FROM accounts').get()).count).toBe(2);
      expect((await second.db.prepare('SELECT COUNT(*) AS count FROM prompt_modules').get()).count).toBe(60);
      expect((await second.db.prepare('SELECT COUNT(*) AS count FROM prompt_module_history').get()).count).toBe(60);
      expect((await second.db.prepare('SELECT COUNT(*) AS count FROM teaching_profiles').get()).count).toBe(1);
      expect((await second.db.prepare('SELECT COUNT(*) AS count FROM teaching_profile_events').get()).count).toBe(1);
      expect((await second.db.prepare(`
        SELECT COUNT(*) AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN (
          'preflight_evaluations', 'preflight_submissions', 'preflight_review_events',
          'preflight_retention_purge_guard', 'preflight_retention_purges', 'saved_projects'
        )
      `).get()).count).toBe(6);
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

    const catalog = await (await request(system, '/api/teacher/profiles', { headers: { cookie } })).json();
    expect(catalog.resource.modules).toHaveLength(5);
    const created = await jsonMutation(system, 'POST', '/api/teacher/profiles', {
      name: 'Concurrent course draft',
      note: 'Exercise concurrent profile updates',
      sourceProfileId: catalog.activeProfileId,
    }, cookie);
    expect(created.status).toBe(201);
    const draft = await created.json();
    const bodies = ['First concurrent revision.', 'Second concurrent revision.'].map((suffix) => ({
      name: 'Concurrent course draft',
      profile: {
        ...draft.profile.profile,
        parts: draft.profile.profile.parts.map((part, index) => index === 0 ? {
          ...part,
          stages: {
            ...part.stages,
            'review-suggestions': {
              ...part.stages['review-suggestions'],
              guidance: suffix,
            },
          },
        } : part),
      },
      note: suffix,
      expectedRevision: draft.profile.revision,
    }));
    const responses = await Promise.all(bodies.map((body) => jsonMutation(
      system,
      'PUT',
      `/api/teacher/profiles/${draft.profile.id}`,
      body,
      cookie,
    )));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await system.db.prepare(`
      SELECT COUNT(*) AS count FROM teaching_profile_events
      WHERE profile_id = ? AND action = 'updated' AND revision = ?
    `).get(draft.profile.id, draft.profile.revision + 1)).count).toBe(1);
    expect((await request(system, '/api/config/public', { headers: { cookie } })).status).toBe(200);

    const studentAccess = await jsonMutation(system, 'POST', '/api/student/access', { code: HOSTED_CLASS_CODE });
    expect(studentAccess.status).toBe(201);
    expect(studentAccess.headers.get('set-cookie')).toContain('Secure');
    const studentCookie = studentAccess.headers.get('set-cookie').split(';')[0];
    expect((await request(system, '/api/config/public', { headers: { cookie: studentCookie } })).status).toBe(200);
    const hostedActivity = await jsonMutation(system, 'POST', '/api/prototype/events', {
      event: 'stage_viewed',
      stage: 'Review suggestions',
      metadata: { stageIndex: 1 },
    }, studentCookie);
    expect(hostedActivity.status).toBe(202);
    expect(await hostedActivity.json()).toEqual({ accepted: true });
    expect(await system.db.prepare(`
      SELECT stage, metadata_json AS metadata
      FROM prototype_events WHERE event_name = ?
      ORDER BY id DESC LIMIT 1
    `).get('stage_viewed')).toEqual({ stage: 1, metadata: '{"stageIndex":1}' });
    const hostedProjectId = `hosted_postgres_${Date.now()}`;
    const hostedEvaluation = await jsonMutation(system, 'POST', '/api/preflight/evaluations', preflightEvaluation(
      hostedProjectId,
      { sourceRecord: nearLimitSourceRecord(hostedProjectId) },
    ), studentCookie);
    expect(hostedEvaluation.status).toBe(201);
    const hostedCapability = (await hostedEvaluation.json()).evaluation;
    expect(hostedCapability).toMatchObject({
      runtime: { provider: 'deterministic', model: 'STEM Splitter' },
      review: {
        nodes: expect.any(Array),
        connections: [],
      },
    });
    expect(Object.keys(hostedCapability.review).sort()).toEqual([
      'connections', 'example', 'guidance', 'nodes', 'readiness',
    ]);
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
    const focusedQuestion = 'Which passage in the memo most directly supports the relationship you mapped?';
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
        metadata: { stageIndex: 3, nodeCount: 4, keyboard: true },
      }, cookie);
      expect(event.status).toBe(202);
      expect((await localSystem.db.prepare('SELECT COUNT(*) AS count FROM student_sessions').get()).count)
        .toBe(baselineStudentSessions + 1);
      const stored = await localSystem.db.prepare(`
        SELECT metadata_json AS metadata FROM prototype_events WHERE event_name = ?
      `).get('node_moved');
      expect(stored.metadata).toBe('{"stageIndex":3,"nodeCount":4,"keyboard":true}');
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

  it('upgrades a populated v8 Macro and Integration schema without losing custom data', async () => {
    const schema = `legacy_v8_${process.pid}_${Date.now()}`;
    const scopedDatabaseUrl = postgresSchemaUrl(databaseUrl, schema);
    const moduleFingerprints = ['1'.repeat(64), '2'.repeat(64)];
    const fixture = {
      createdAt: 1_790_000_000_000,
      expiresAt: 1_790_086_400_000,
      sessionRef: 'v8session0000001',
      modules: [
        {
          id: 'preflight.macro.purpose',
          configKind: 'preflight',
          scale: 'macro',
          moduleKey: 'purpose',
          label: 'Custom Macro purpose',
          description: 'Instructor-authored purpose retained from v8.',
          content: 'Keep this custom Macro prompt and its evidence language exactly.',
          revision: 7,
          fingerprint: moduleFingerprints[0],
          updatedAt: '2026-07-01T12:00:00.000Z',
          historyId: 81_001,
          changeNote: 'Maria customized Macro framing',
        },
        {
          id: 'builder.integration.output',
          configKind: 'builder',
          scale: 'integration',
          moduleKey: 'output',
          label: 'Custom Integration output',
          description: 'Instructor-authored output retained from v8.',
          content: 'Keep this custom Integration output and review language exactly.',
          revision: 4,
          fingerprint: moduleFingerprints[1],
          updatedAt: '2026-07-02T15:30:00.000Z',
          historyId: 81_002,
          changeNote: 'Zach customized Integration output',
        },
      ],
      evaluation: {
        id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        activeScale: 'macro',
        inquiry: 'How do municipal decisions shape access to disability services?',
        projectMetadata: { projectId: 'legacy-project-01', title: 'East Harlem Disability Services' },
        sourceRecord: {
          id: 'memo-east-harlem-01',
          title: 'East Harlem service coordination memo',
          evidence: { id: 'source-evidence-01', excerpt: 'Three agencies share the same referral form.' },
        },
        sourceMaterial: 'A municipal office funds three agencies that coordinate referrals in East Harlem.',
        projectOverlay: {
          id: 'legacy-overlay-01',
          profileVersion: '8.4.0',
          activeScale: 'macro',
          scale: 'integration',
          scaleIds: ['micro', 'macro', 'integration'],
          releasedScales: ['micro', 'meso', 'macro'],
          completedScales: ['macro', 'integration'],
          moduleRefs: [
            { id: 'preflight.macro.purpose', revision: 7 },
            { id: 'builder.integration.output', revision: 4 },
          ],
          evidence: {
            id: 'overlay-evidence-01',
            excerpt: 'Macro and Integration remain ordinary words in this evidence excerpt.',
          },
        },
        suggestion: {
          guidance: ['Keep the student evidence attached.'],
          nodes: [
            {
              id: 'node-macro-policy',
              scale: 'macro',
              label: 'NYC disability-services funding office',
              evidence: { id: 'node-evidence-01', excerpt: 'The office renews annual contracts.', page: 3 },
            },
            {
              id: 'node-integration-access',
              scale: 'integration',
              label: 'Cross-agency access strategy',
              evidence: { id: 'node-evidence-02', excerpt: 'Partners share one intake route.', page: 4 },
            },
          ],
          connections: [
            {
              id: 'edge-integration-01',
              scale: 'integration',
              source: 'node-macro-policy',
              target: 'node-integration-access',
              annotation: 'Funding rules shape the shared intake route.',
              evidence: { id: 'edge-evidence-01', excerpt: 'Contract terms require shared reporting.', page: 5 },
            },
          ],
          readiness: { releasedScales: ['micro', 'macro'], completedScales: ['macro'] },
        },
        configSnapshot: {
          kind: 'preflight',
          activeScale: 'macro',
          shared: {
            revision: 13,
            moduleVersions: [
              { id: 'preflight.macro.purpose', revision: 7, fingerprint: moduleFingerprints[0] },
              { id: 'builder.integration.output', revision: 4, fingerprint: moduleFingerprints[1] },
            ],
            courseParts: [
              { id: 'part-1', label: 'Part 1', scaleIds: ['micro', 'meso'] },
              { id: 'part-2', label: 'Part 2', scaleIds: ['macro', 'integration'] },
            ],
          },
          projectOverlay: { activeScale: 'integration', scaleIds: ['macro', 'integration'] },
          evidence: { id: 'config-evidence-01', excerpt: 'Configuration provenance is retained.' },
        },
        runtimeMetadata: { provider: 'deterministic', model: 'legacy-v8', revision: 12 },
      },
      submission: {
        id: 'ssssssssssssssssssssssssssssssss',
        activeScale: 'integration',
        revision: 6,
        inquiry: 'How do municipal decisions shape access to disability services?',
        projectMetadata: { projectId: 'legacy-project-01', title: 'East Harlem Disability Services' },
        sourceMaterial: 'A municipal office funds three agencies that coordinate referrals in East Harlem.',
        sourceRecord: {
          id: 'memo-east-harlem-01',
          evidence: { id: 'submission-source-evidence', excerpt: 'Students interviewed two partner agencies.' },
        },
        studentAnnotation: 'The relationship reflects our memo and interview notes.',
        suggestion: {
          nodes: [{ id: 'submission-node-01', scale: 'integration', evidence: { id: 'submission-node-evidence', excerpt: 'One route spans all partners.' } }],
          connections: [{ id: 'submission-edge-01', scale: 'macro', evidence: { id: 'submission-edge-evidence', excerpt: 'Funding determines staffing.' } }],
          scaleIds: ['macro', 'integration'],
        },
        configSnapshot: {
          activeScale: 'integration',
          releasedScales: ['micro', 'meso', 'macro', 'integration'],
          completedScales: ['micro', 'macro'],
          moduleVersions: [{ id: 'builder.integration.output', revision: 4, fingerprint: moduleFingerprints[1] }],
          evidence: { id: 'submission-config-evidence', excerpt: 'Review configuration 13.' },
        },
        runtimeMetadata: { provider: 'deterministic', sequence: 99 },
      },
      savedProject: {
        tokenHash: 'a'.repeat(64),
        projectId: 'legacy-project-01',
        project: {
          schemaVersion: 5,
          id: 'legacy-project-01',
          title: 'East Harlem Disability Services',
          activeScale: 'macro',
          releasedScales: ['micro', 'meso', 'macro', 'integration'],
          completedScales: ['micro', 'meso', 'macro'],
          graph: {
            nodes: [
              { id: 'saved-node-01', scale: 'macro', label: 'Municipal funding office', evidence: { id: 'saved-node-evidence', excerpt: 'Budget line 22 funds navigation.' } },
              { id: 'saved-node-02', scale: 'integration', label: 'Accessible intake network', evidence: { id: 'saved-node-evidence-02', excerpt: 'Partners use one accessible form.' } },
            ],
            edges: [
              { id: 'saved-edge-01', scale: 'integration', from: 'saved-node-01', to: 'saved-node-02', evidence: { id: 'saved-edge-evidence', excerpt: 'The contract links funds to access.' } },
            ],
          },
          configs: {
            builder: {
              activeScale: 'integration',
              moduleVersions: [{ id: 'builder.integration.output', revision: 4, fingerprint: moduleFingerprints[1] }],
            },
          },
          evidence: { id: 'saved-project-evidence', excerpt: 'Macro and Integration text is student-authored.' },
        },
      },
    };

    const expectedEvaluation = {
      activeScale: 'exosphere',
      projectOverlay: {
        ...fixture.evaluation.projectOverlay,
        activeScale: 'exosphere',
        scale: 'macrosphere',
        scaleIds: ['micro', 'exosphere', 'macrosphere'],
        releasedScales: ['micro', 'meso', 'exosphere'],
        completedScales: ['exosphere', 'macrosphere'],
        moduleRefs: [
          { id: 'preflight.exosphere.purpose', revision: 7 },
          { id: 'builder.macrosphere.output', revision: 4 },
        ],
      },
      suggestion: {
        ...fixture.evaluation.suggestion,
        nodes: [
          { ...fixture.evaluation.suggestion.nodes[0], scale: 'exosphere' },
          { ...fixture.evaluation.suggestion.nodes[1], scale: 'macrosphere' },
        ],
        connections: [{ ...fixture.evaluation.suggestion.connections[0], scale: 'macrosphere' }],
        readiness: { releasedScales: ['micro', 'exosphere'], completedScales: ['exosphere'] },
      },
      configSnapshot: {
        ...fixture.evaluation.configSnapshot,
        activeScale: 'exosphere',
        shared: {
          ...fixture.evaluation.configSnapshot.shared,
          moduleVersions: [
            { id: 'preflight.exosphere.purpose', revision: 7, fingerprint: moduleFingerprints[0] },
            { id: 'builder.macrosphere.output', revision: 4, fingerprint: moduleFingerprints[1] },
          ],
          courseParts: [
            fixture.evaluation.configSnapshot.shared.courseParts[0],
            { ...fixture.evaluation.configSnapshot.shared.courseParts[1], scaleIds: ['exosphere', 'macrosphere'] },
          ],
        },
        projectOverlay: { activeScale: 'macrosphere', scaleIds: ['exosphere', 'macrosphere'] },
      },
    };
    const expectedSubmission = {
      activeScale: 'macrosphere',
      revision: 6,
      suggestion: {
        ...fixture.submission.suggestion,
        nodes: [{ ...fixture.submission.suggestion.nodes[0], scale: 'macrosphere' }],
        connections: [{ ...fixture.submission.suggestion.connections[0], scale: 'exosphere' }],
        scaleIds: ['exosphere', 'macrosphere'],
      },
      configSnapshot: {
        ...fixture.submission.configSnapshot,
        activeScale: 'macrosphere',
        releasedScales: ['micro', 'meso', 'exosphere', 'macrosphere'],
        completedScales: ['micro', 'exosphere'],
        moduleVersions: [{ id: 'builder.macrosphere.output', revision: 4, fingerprint: moduleFingerprints[1] }],
      },
    };
    const expectedSavedProject = {
      ...fixture.savedProject.project,
      activeScale: 'exosphere',
      releasedScales: ['micro', 'meso', 'exosphere', 'macrosphere'],
      completedScales: ['micro', 'meso', 'exosphere'],
      graph: {
        nodes: [
          { ...fixture.savedProject.project.graph.nodes[0], scale: 'exosphere' },
          { ...fixture.savedProject.project.graph.nodes[1], scale: 'macrosphere' },
        ],
        edges: [{ ...fixture.savedProject.project.graph.edges[0], scale: 'macrosphere' }],
      },
      configs: {
        builder: {
          activeScale: 'macrosphere',
          moduleVersions: [{ id: 'builder.macrosphere.output', revision: 4, fingerprint: moduleFingerprints[1] }],
        },
      },
    };

    let legacySystem;
    let reopened;
    try {
      await createLegacyV8Schema(databaseUrl, schema, fixture);
      legacySystem = createSystemsMappingApp({
        databaseUrl: scopedDatabaseUrl,
        hostedMode: false,
        postgres: { maxConnections: 2 },
      });
      await legacySystem.ready;

      expect(await legacySystem.db.prepare(`
        SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 9
      `).get()).toEqual({ count: 1 });

      const modules = await legacySystem.db.prepare(`
        SELECT id, scale, revision, content, fingerprint
        FROM prompt_modules WHERE fingerprint IN (?, ?) ORDER BY id
      `).all(...moduleFingerprints);
      expect(modules).toEqual([
        {
          id: 'builder.macrosphere.output',
          scale: 'macrosphere',
          revision: 4,
          content: fixture.modules[1].content,
          fingerprint: moduleFingerprints[1],
        },
        {
          id: 'preflight.exosphere.purpose',
          scale: 'exosphere',
          revision: 7,
          content: fixture.modules[0].content,
          fingerprint: moduleFingerprints[0],
        },
      ]);
      expect((await legacySystem.db.prepare(`
        SELECT COUNT(*) AS count FROM prompt_modules
        WHERE id IN ('preflight.macro.purpose', 'builder.integration.output')
      `).get()).count).toBe(0);

      const history = await legacySystem.db.prepare(`
        SELECT id, module_id AS moduleId, revision, content, fingerprint,
          change_note AS changeNote, changed_at AS changedAt
        FROM prompt_module_history WHERE id IN (?, ?) ORDER BY id
      `).all(...fixture.modules.map(({ historyId }) => historyId));
      expect(history).toEqual(fixture.modules.map((module) => ({
        id: module.historyId,
        moduleId: module.id.replace('.macro.', '.exosphere.').replace('.integration.', '.macrosphere.'),
        revision: module.revision,
        content: module.content,
        fingerprint: module.fingerprint,
        changeNote: module.changeNote,
        changedAt: module.updatedAt,
      })));

      const evaluation = await legacySystem.db.prepare(`
        SELECT id, active_scale AS activeScale, project_metadata_json AS projectMetadata,
          source_record_json AS sourceRecord, project_overlay_json AS projectOverlay,
          suggestion_json AS suggestion, config_snapshot_json AS configSnapshot,
          runtime_metadata_json AS runtimeMetadata, source_material AS sourceMaterial
        FROM preflight_evaluations WHERE id = ?
      `).get(fixture.evaluation.id);
      expect(evaluation).toEqual({
        id: fixture.evaluation.id,
        ...expectedEvaluation,
        projectMetadata: fixture.evaluation.projectMetadata,
        sourceRecord: fixture.evaluation.sourceRecord,
        runtimeMetadata: fixture.evaluation.runtimeMetadata,
        sourceMaterial: fixture.evaluation.sourceMaterial,
      });

      const submission = await legacySystem.db.prepare(`
        SELECT id, active_scale AS activeScale, revision,
          source_record_json AS sourceRecord, student_annotation AS studentAnnotation,
          suggestion_json AS suggestion, config_snapshot_json AS configSnapshot,
          runtime_metadata_json AS runtimeMetadata, source_material AS sourceMaterial
        FROM preflight_submissions WHERE id = ?
      `).get(fixture.submission.id);
      expect(submission).toEqual({
        id: fixture.submission.id,
        ...expectedSubmission,
        sourceRecord: fixture.submission.sourceRecord,
        studentAnnotation: fixture.submission.studentAnnotation,
        runtimeMetadata: fixture.submission.runtimeMetadata,
        sourceMaterial: fixture.submission.sourceMaterial,
      });

      const savedProjectRow = await legacySystem.db.prepare(`
        SELECT token_hash AS tokenHash, project_id AS projectId, project_json AS projectJson,
          created_session_ref AS createdSessionRef, created_at AS createdAt, updated_at AS updatedAt
        FROM saved_projects WHERE token_hash = ?
      `).get(fixture.savedProject.tokenHash);
      expect(savedProjectRow).toEqual({
        tokenHash: fixture.savedProject.tokenHash,
        projectId: fixture.savedProject.projectId,
        projectJson: JSON.stringify(expectedSavedProject),
        createdSessionRef: fixture.sessionRef,
        createdAt: fixture.createdAt,
        updatedAt: fixture.createdAt,
      });
      expect(JSON.parse(savedProjectRow.projectJson)).toEqual(expectedSavedProject);

      await expect(legacySystem.db.prepare(`
        UPDATE prompt_modules SET scale = 'macro' WHERE id = ?
      `).run('preflight.exosphere.purpose')).rejects.toThrow(/prompt_modules_scale_check|check constraint/i);
      await expect(legacySystem.db.prepare(`
        UPDATE preflight_evaluations SET active_scale = 'integration' WHERE id = ?
      `).run(fixture.evaluation.id)).rejects.toThrow(/preflight_evaluations_active_scale_check|check constraint/i);
      await expect(legacySystem.db.prepare(`
        UPDATE preflight_submissions SET active_scale = 'macro' WHERE id = ?
      `).run(fixture.submission.id)).rejects.toThrow(/preflight_submissions_active_scale_check|check constraint/i);

      const snapshot = {
        modules,
        history,
        evaluation,
        submission,
        savedProjectRow,
      };
      await legacySystem.close();
      legacySystem = null;

      reopened = createSystemsMappingApp({
        databaseUrl: scopedDatabaseUrl,
        hostedMode: false,
        postgres: { maxConnections: 2 },
      });
      await reopened.ready;
      expect(await reopened.db.prepare(`
        SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 9
      `).get()).toEqual({ count: 1 });
      expect(await reopened.db.prepare(`
        SELECT id, scale, revision, content, fingerprint
        FROM prompt_modules WHERE fingerprint IN (?, ?) ORDER BY id
      `).all(...moduleFingerprints)).toEqual(snapshot.modules);
      expect(await reopened.db.prepare(`
        SELECT id, module_id AS moduleId, revision, content, fingerprint,
          change_note AS changeNote, changed_at AS changedAt
        FROM prompt_module_history WHERE id IN (?, ?) ORDER BY id
      `).all(...fixture.modules.map(({ historyId }) => historyId))).toEqual(snapshot.history);
      expect(await reopened.db.prepare(`
        SELECT id, active_scale AS activeScale, project_metadata_json AS projectMetadata,
          source_record_json AS sourceRecord, project_overlay_json AS projectOverlay,
          suggestion_json AS suggestion, config_snapshot_json AS configSnapshot,
          runtime_metadata_json AS runtimeMetadata, source_material AS sourceMaterial
        FROM preflight_evaluations WHERE id = ?
      `).get(fixture.evaluation.id)).toEqual(snapshot.evaluation);
      expect(await reopened.db.prepare(`
        SELECT id, active_scale AS activeScale, revision,
          source_record_json AS sourceRecord, student_annotation AS studentAnnotation,
          suggestion_json AS suggestion, config_snapshot_json AS configSnapshot,
          runtime_metadata_json AS runtimeMetadata, source_material AS sourceMaterial
        FROM preflight_submissions WHERE id = ?
      `).get(fixture.submission.id)).toEqual(snapshot.submission);
      expect(await reopened.db.prepare(`
        SELECT token_hash AS tokenHash, project_id AS projectId, project_json AS projectJson,
          created_session_ref AS createdSessionRef, created_at AS createdAt, updated_at AS updatedAt
        FROM saved_projects WHERE token_hash = ?
      `).get(fixture.savedProject.tokenHash)).toEqual(snapshot.savedProjectRow);
    } finally {
      await legacySystem?.close();
      await reopened?.close();
      await dropPostgresTestSchema(databaseUrl, schema);
    }
  }, 30_000);
});
