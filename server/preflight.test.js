// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateSubmission } from '../src/domain.js';
import { createSystemsMappingApp } from './app.js';
import {
  DEFAULT_TEACHING_PROFILE,
  teachingProfileFingerprint,
} from './config.js';
import { assertDatabaseIntegrity } from './database.js';

const BASE_URL = 'http://127.0.0.1:4177';
const BOOTSTRAP_TOKEN = 'preflight-test-bootstrap-token';
const TEACHER_PASSPHRASE = 'preflight teacher phrase';
const JSON_HEADERS = { 'content-type': 'application/json' };

function request(app, path, options = {}) {
  return app.request(`${BASE_URL}${path}`, options);
}

function browserRequest(app, path, options = {}) {
  return request(app, path, {
    ...options,
    headers: { origin: BASE_URL, 'sec-fetch-site': 'same-origin', ...(options.headers || {}) },
  });
}

function postJson(app, path, body, { cookie, headers, ...options } = {}) {
  return browserRequest(app, path, {
    method: 'POST',
    ...options,
    headers: { ...JSON_HEADERS, ...(cookie ? { cookie } : {}), ...(headers || {}) },
    body: JSON.stringify(body),
  });
}

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';')[0];
}

function criterion(id, hardBlock, status = 'met') {
  return {
    id,
    status,
    evidence: status === 'met' ? 'Memo sentence 1' : 'No supporting passage located',
    ...(status === 'met' ? { evidenceLocator: 'Memo sentence 1' } : {}),
    rationale: `${id} has a bounded rationale.`,
    missingVariable: status === 'met' ? null : `${id} needs another source statement.`,
    nextAction: `Review ${id} before continuing.`,
    confidence: status === 'met' ? 0.92 : 0.58,
    hardBlock,
  };
}

function suggestion() {
  return {
    hard: [1, 2, 3, 4].map((index) => criterion(`H${index}`, true)),
    scored: [1, 2, 3, 4, 5, 6, 7, 8].map((index) => criterion(`C${index}`, false, index <= 6 ? 'met' : 'unmet')),
    hardPass: true,
    score: 6,
    threshold: 6,
    outcome: 'pass',
    evaluatedAt: '2027-01-15T08:00:00.000Z',
    configurationSnapshot: { kind: 'provider-placeholder' },
  };
}

function suggestionWithRedirects() {
  const output = suggestion();
  const repeatedAction = `  Return   to the source fields and name what is missing. ${'x'.repeat(1100)}  `;
  output.hard[0] = {
    ...criterion('H1', true, 'unmet'),
    nextAction: repeatedAction,
    evidenceExcerpt: `  Memo   sentence one. ${'y'.repeat(4100)}  `,
  };
  output.hard[1] = { ...criterion('H2', true, 'unmet'), nextAction: repeatedAction.toLowerCase() };
  output.scored[0] = {
    ...criterion('C1', false, 'unmet'),
    nextAction: 'Frame one source-grounded question.',
  };
  output.scored[6].nextAction = 'Identify one resource already named in the source.';
  output.scored[7].nextAction = 'Mark one uncertainty that the source cannot resolve.';
  output.hardPass = false;
  output.score = 5;
  output.outcome = 'hold';
  return output;
}

function suggestionWithoutRedirects() {
  const output = suggestion();
  output.scored = output.scored.map((entry) => ({
    ...entry,
    status: 'met',
    evidence: 'Memo sentence 1',
    evidenceLocator: 'Memo sentence 1',
    missingVariable: null,
    confidence: 0.92,
  }));
  output.score = 8;
  return output;
}

function submissionBody(overrides = {}) {
  return {
    projectMetadata: {
      projectId: 'project_review_1',
      submissionId: 'submission_review_1',
      title: 'Family access review',
      author: 'Student-chosen label',
      schemaVersion: 2,
      stage: 2,
      clientUpdatedAt: '2027-01-15T08:00:00.000Z',
    },
    activeScale: 'micro',
    stageId: 'review-suggestions',
    inquiry: 'How do schools shape family access to services?',
    sourceRecord: {
      id: 'submission_review_1',
      title: 'Family access memo',
      author: 'Student researcher',
      date: '2027-01-15',
      sourceType: 'course memo',
      location: 'CALI 2026 / course workspace',
      rights: 'Course use only',
      sensitive: false,
      consent: false,
      evidenceOwnership: 'Source claims and student interpretation are labeled separately',
      revision: 1,
      fingerprint: 'source_snapshot_1',
    },
    sourceMaterial: '  The exact memo text is preserved. A school refers a family to an agency.\n',
    studentAnnotation: 'The referral handoff may create a delay.',
    projectOverlay: {
      id: 'preflight-grounded-v1',
      profileVersion: '1.0.0',
      outputSchemaVersion: 'systems-mapping.preflight-result.v1',
      label: 'Grounded preflight evaluator',
      provider: 'local-deterministic',
      baseModel: 'STEM Splitter',
      customInstructions: 'Ask one repair question at a time.',
      contextLimit: 32_000,
      confidenceThreshold: 0.72,
      relationVocabulary: ['provides', 'refers', 'shapes'],
      revision: 1,
      fingerprint: 'project_overlay_1',
    },
    ...overrides,
  };
}

function nearLimitSourceRecord(targetBytes = 16_300) {
  const sourceRecord = {
    ...submissionBody().sourceRecord,
    location: 'l'.repeat(5000),
    rights: 'r'.repeat(5000),
    evidenceOwnership: 'e'.repeat(5000),
  };
  const remaining = targetBytes - Buffer.byteLength(JSON.stringify(sourceRecord), 'utf8');
  if (remaining < 0 || sourceRecord.evidenceOwnership.length + remaining > 8000) {
    throw new Error('Near-limit fixture is outside the configured source-record bounds.');
  }
  sourceRecord.evidenceOwnership += 'x'.repeat(remaining);
  return sourceRecord;
}

describe('persistent preflight suggestion review queue', () => {
  let currentTime;
  let system;
  let tempDirectory;

  beforeEach(() => {
    currentTime = 1_800_000_000_000;
    tempDirectory = mkdtempSync(join(tmpdir(), 'systems-mapping-preflight-'));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'review.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      studentSessionTtlMs: 60_000,
    });
  });

  afterEach(async () => {
    await system.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  async function grantStudent() {
    const response = await postJson(system.app, '/api/student/access', { code: '101' });
    expect(response.status).toBe(201);
    return cookieFrom(response);
  }

  async function claimTeacher(accountId = 'maria-mavrides-calderon') {
    const response = await postJson(system.app, '/api/auth/claim', {
      userId: accountId,
      passphrase: TEACHER_PASSPHRASE,
      bootstrapToken: BOOTSTRAP_TOKEN,
    });
    expect(response.status).toBe(201);
    return cookieFrom(response);
  }

  async function loginTeacher(accountId = 'maria-mavrides-calderon') {
    const response = await postJson(system.app, '/api/auth/login', {
      userId: accountId,
      passphrase: TEACHER_PASSPHRASE,
    });
    expect(response.status).toBe(200);
    return cookieFrom(response);
  }

  async function evaluate(cookie, body = submissionBody()) {
    const { studentAnnotation: _studentAnnotation, ...evaluationBody } = body;
    const response = await postJson(system.app, '/api/preflight/evaluations', evaluationBody, { cookie });
    expect(response.status).toBe(201);
    return (await response.json()).evaluation;
  }

  async function submit(cookie, body = submissionBody()) {
    const evaluation = await evaluate(cookie, body);
    const response = await postJson(system.app, '/api/preflight/submissions', {
      evaluationId: evaluation.id,
      studentAnnotation: body.studentAnnotation ?? '',
    }, { cookie });
    expect(response.status).toBe(201);
    return (await response.json()).submission;
  }

  it('migrates strict constrained tables and database-level append-only review events', async () => {
    const tables = system.db.prepare(`
      SELECT name, strict FROM pragma_table_list
      WHERE name IN (
        'preflight_evaluations', 'preflight_submissions', 'preflight_review_events',
        'preflight_retention_purge_guard', 'preflight_retention_purges'
      ) ORDER BY name
    `).all();
    expect(tables).toEqual([
      { name: 'preflight_evaluations', strict: 1 },
      { name: 'preflight_retention_purge_guard', strict: 1 },
      { name: 'preflight_retention_purges', strict: 1 },
      { name: 'preflight_review_events', strict: 1 },
      { name: 'preflight_submissions', strict: 1 },
    ]);
    const indexes = system.db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'preflight_%_idx' ORDER BY name
    `).all().map(({ name }) => name);
    expect(indexes).toEqual(expect.arrayContaining([
      'preflight_review_events_reviewer_idx',
      'preflight_review_events_submission_idx',
      'preflight_evaluations_expiry_idx',
      'preflight_evaluations_session_idx',
      'preflight_submissions_queue_idx',
      'preflight_submissions_reviewer_idx',
      'preflight_submissions_student_idx',
    ]));

    const studentCookie = await grantStudent();
    const teacherCookie = await claimTeacher();
    const created = await submit(studentCookie);
    const decided = await postJson(system.app, `/api/teacher/preflight-submissions/${created.id}/decision`, {
      decision: 'approve',
      instructorAnnotation: 'The evidence can move to candidate review.',
      expectedRevision: 1,
    }, { cookie: teacherCookie });
    expect(decided.status).toBe(200);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_review_events').get().count).toBe(1);
    expect(() => system.db.prepare('UPDATE preflight_review_events SET instructor_annotation = ?').run('tampered'))
      .toThrow(/append-only/);
    expect(() => system.db.prepare('DELETE FROM preflight_review_events').run()).toThrow(/append-only/);
    expect(() => system.db.prepare(`
      INSERT INTO preflight_review_events (
        submission_id, decision, from_revision, to_revision, instructor_annotation,
        revised_suggestion, decided_at, reviewing_teacher_id
      ) VALUES (?, 'revise_and_approve', 2, 3, ?, NULL, ?, ?)
    `).run(created.id, 'Missing revised text must fail.', currentTime, 'maria-mavrides-calderon')).toThrow(/constraint/i);
    expect(assertDatabaseIntegrity(system.db)).toBe(true);
  });

  it('creates authoritative one-time evaluations, binds them to the session, and purges expired raw inputs', async () => {
    await system.close();
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'evaluation-capabilities.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      studentSessionTtlMs: 60_000,
      preflightEvaluationTtlMs: 1000,
    });
    const studentCookie = await grantStudent();
    const body = submissionBody();
    const evaluation = await evaluate(studentCookie, body);
    expect(evaluation.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(evaluation).toMatchObject({
      runtime: { provider: 'deterministic', model: 'STEM Splitter', createdAt: '2027-01-15T08:00:00.000Z' },
      createdAt: '2027-01-15T08:00:00.000Z',
      expiresAt: '2027-01-15T08:00:01.000Z',
    });
    expect(Object.keys(evaluation).sort()).toEqual([
      'configSnapshot', 'createdAt', 'expiresAt', 'id', 'redirects', 'runtime',
    ]);
    expect(evaluation.redirects).toEqual([
      {
        action: 'Complete the missing memo or source fields.',
        evidenceExcerpt: 'Memo text and metadata panel',
      },
      {
        action: 'Add two statements naming who acts on whom and how.',
        evidenceExcerpt: 'A school refers a family to an agency.',
      },
      {
        action: 'State one bounded question the map will help answer.',
      },
    ]);
    expect(evaluation.redirects).toHaveLength(3);
    for (const redirect of evaluation.redirects) {
      expect(Object.keys(redirect).sort()).toEqual(
        redirect.evidenceExcerpt === undefined ? ['action'] : ['action', 'evidenceExcerpt'],
      );
    }
    expect(evaluation).not.toHaveProperty('suggestion');
    expect(JSON.stringify(evaluation)).not.toMatch(/"(?:hard|scored|status|score|outcome)"/);
    expect(JSON.stringify(evaluation.redirects)).not.toMatch(/\b[HC][1-8]\b/);
    const expected = evaluateSubmission({ ...body.sourceRecord, text: body.sourceMaterial }, body.activeScale, 6);
    expected.evaluatedAt = evaluation.createdAt;
    expected.configurationSnapshot = evaluation.configSnapshot;
    expect(evaluation.configSnapshot.projectOverlay).not.toHaveProperty('customInstructions');
    expect(JSON.stringify(evaluation)).not.toContain(body.projectOverlay.customInstructions);

    const stored = system.db.prepare(`
      SELECT source_material AS sourceMaterial, source_record_json AS sourceRecord,
        project_overlay_json AS projectOverlay, runtime_metadata_json AS runtimeMetadata,
        suggestion_json AS suggestion, consumed_at AS consumedAt
      FROM preflight_evaluations WHERE id = ?
    `).get(evaluation.id);
    expect(stored.sourceMaterial).toBe(body.sourceMaterial);
    expect(JSON.parse(stored.sourceRecord)).toEqual(body.sourceRecord);
    expect(JSON.parse(stored.projectOverlay)).toEqual(evaluation.configSnapshot.projectOverlay);
    expect(JSON.parse(stored.runtimeMetadata)).toEqual(evaluation.runtime);
    expect(JSON.parse(stored.suggestion)).toEqual(expected);
    expect(stored.consumedAt).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(body.projectOverlay.customInstructions);

    const otherSession = await grantStudent();
    expect((await postJson(system.app, '/api/preflight/submissions', {
      evaluationId: evaluation.id, studentAnnotation: 'Stolen capability attempt.',
    }, { cookie: otherSession })).status).toBe(409);
    const consumed = await postJson(system.app, '/api/preflight/submissions', {
      evaluationId: evaluation.id, studentAnnotation: body.studentAnnotation,
    }, { cookie: studentCookie });
    expect(consumed.status).toBe(201);
    expect((await consumed.json()).submission).toMatchObject({ projectId: 'project_review_1', status: 'pending' });
    expect((await postJson(system.app, '/api/preflight/submissions', {
      evaluationId: evaluation.id, studentAnnotation: 'Reuse attempt.',
    }, { cookie: studentCookie })).status).toBe(409);

    const expiring = await evaluate(studentCookie, submissionBody({
      projectMetadata: { projectId: 'expiring_evaluation', title: 'Expires without submission' },
    }));
    currentTime += 1001;
    expect((await postJson(system.app, '/api/preflight/submissions', {
      evaluationId: expiring.id, studentAnnotation: '',
    }, { cookie: studentCookie })).status).toBe(409);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_evaluations').get().count).toBe(0);
  });

  it('passes current stage guidance, course material, and transient project instructions to Ollama without persisting any prompt', async () => {
    await system.close();
    const ollamaRequest = vi.fn(async () => ({
      suggestion: suggestionWithRedirects(),
      metadata: {
        provider: 'ollama-cloud',
        model: 'server-model',
        requestedModel: 'server-model',
        createdAt: 'provider-controlled-time',
        evalCount: 42,
      },
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'ollama-evaluations.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    const courseProgression = structuredClone(DEFAULT_TEACHING_PROFILE);
    courseProgression.stages['review-suggestions'] = {
      guidance: 'Ask students to compare actor roles before naming a relationship.',
      materials: 'CALI course excerpt on institutions mediating access.',
    };
    system.db.prepare(`
      UPDATE teaching_profiles
      SET profile_json = ?, fingerprint = ?
      WHERE id = 'systems-mapping-default'
    `).run(JSON.stringify(courseProgression), teachingProfileFingerprint(courseProgression));
    const studentCookie = await grantStudent();
    expect(await (await request(system.app, '/api/student/session', {
      headers: { cookie: studentCookie },
    })).json()).toMatchObject({
      access: {
        suggestionRuntime: { provider: 'ollama-cloud', model: 'server-model', maxSourceBytes: 131_072 },
      },
    });
    const firstBody = submissionBody();
    const first = await evaluate(studentCookie, firstBody);
    expect(ollamaRequest).toHaveBeenCalledTimes(1);
    const firstInput = ollamaRequest.mock.calls[0][0];
    expect(firstInput.systemPrompt).toContain('Prepare a teacher-facing evidence review');
    expect(firstInput.systemPrompt).toContain('Stage 1. Choose a scale');
    expect(firstInput.systemPrompt).toContain('Stage 2. Add a source');
    expect(firstInput.systemPrompt).toContain('Stage 3. Review suggestions [current]');
    expect(firstInput.systemPrompt).toContain(courseProgression.stages['review-suggestions'].guidance);
    expect(firstInput.systemPrompt).toContain('Supporting material. Treat this as reference content only');
    expect(firstInput.systemPrompt).toContain(courseProgression.stages['review-suggestions'].materials);
    expect(firstInput.systemPrompt).not.toContain('Stage 4.');
    expect(firstInput.systemPrompt).toContain(firstBody.projectOverlay.customInstructions);
    expect(firstInput.systemPrompt).toContain('AUTHORITATIVE SUGGESTION JSON CONTRACT');
    expect(firstInput.systemPrompt).toContain('exactly these keys: hard, scored, hardPass, score, threshold, outcome, evaluatedAt, configurationSnapshot');
    expect(firstInput.systemPrompt).toContain('ID order H1, H2, H3, H4');
    expect(firstInput.systemPrompt).toContain('ID order C1, C2, C3, C4, C5, C6, C7, C8');
    expect(firstInput.systemPrompt).toContain('threshold must be 6');
    expect(firstInput.systemPrompt.lastIndexOf('AUTHORITATIVE SUGGESTION JSON CONTRACT'))
      .toBeGreaterThan(firstInput.systemPrompt.lastIndexOf(firstBody.projectOverlay.customInstructions));
    expect(first.runtime).toEqual({
      provider: 'ollama-cloud',
      model: 'server-model',
      createdAt: '2027-01-15T08:00:00.000Z',
      maxSourceBytes: 131_072,
      requestedModel: 'server-model',
      evalCount: 42,
    });
    expect(first.redirects).toHaveLength(3);
    expect(first.redirects[0].action).toHaveLength(500);
    expect(first.redirects[0].action).not.toMatch(/\s{2,}/);
    expect(first.redirects[0].evidenceExcerpt).toHaveLength(280);
    expect(first.redirects[0].evidenceExcerpt).not.toMatch(/\s{2,}/);
    expect(first.redirects[1]).toEqual({
      action: 'Frame one source-grounded question.',
    });
    expect(first.redirects[2]).toEqual({
      action: 'Identify one resource already named in the source.',
    });
    expect(JSON.stringify(first.redirects)).not.toContain('No supporting passage located');
    expect(first).not.toHaveProperty('suggestion');

    const changedContent = 'Apply the revised teacher-authored CALI scale rubric marker OLLAMA_PROMPT_REVISION_TWO.';
    system.db.prepare(`
      UPDATE prompt_modules
      SET content = ?, revision = 2, fingerprint = ?
      WHERE id = 'preflight.micro.scale_rubric'
    `).run(changedContent, createHash('sha256').update(changedContent).digest('hex'));
    const second = await evaluate(studentCookie, submissionBody({
      projectMetadata: { projectId: 'ollama_revision_two', title: 'Updated configuration evaluation' },
    }));
    expect(ollamaRequest).toHaveBeenCalledTimes(2);
    expect(ollamaRequest.mock.calls[1][0].systemPrompt).toContain('OLLAMA_PROMPT_REVISION_TWO');
    expect(second.configSnapshot.shared.revision).toBe(2);
    expect(second.configSnapshot.shared.fingerprint).not.toBe(first.configSnapshot.shared.fingerprint);

    ollamaRequest.mockResolvedValueOnce({
      suggestion: suggestionWithoutRedirects(),
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    });
    const noRedirects = await evaluate(studentCookie, submissionBody({
      projectMetadata: { projectId: 'no_redirects', title: 'No student redirect required' },
    }));
    expect(noRedirects.redirects).toEqual([]);
    expect(noRedirects).not.toHaveProperty('suggestion');

    ollamaRequest.mockResolvedValueOnce({
      suggestion: { ...suggestion(), fabricatedProviderField: 'must fail closed' },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    });
    const { studentAnnotation: _annotation, ...thirdBody } = submissionBody({
      projectMetadata: { projectId: 'malformed_provider_result', title: 'Must not persist' },
    });
    const malformed = await postJson(system.app, '/api/preflight/evaluations', thirdBody, { cookie: studentCookie });
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toEqual({ error: 'Suggestion generation is temporarily unavailable.' });
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_evaluations').get().count).toBe(3);

    const oversizedSource = 'é'.repeat(70_000);
    expect(Buffer.byteLength(oversizedSource, 'utf8')).toBeGreaterThan(131_072);
    const oversized = await postJson(system.app, '/api/preflight/evaluations', {
      ...thirdBody,
      projectMetadata: { projectId: 'oversized_cloud_source', title: 'Must be rejected before provider use' },
      sourceMaterial: oversizedSource,
    }, { cookie: studentCookie });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({
      error: 'sourceMaterial must contain no more than 131072 UTF-8 bytes for this suggestion runtime.',
    });
    expect(ollamaRequest).toHaveBeenCalledTimes(4);

    const serializedDatabase = JSON.stringify([
      ...system.db.prepare('SELECT * FROM preflight_evaluations').all(),
      ...system.db.prepare('SELECT * FROM preflight_submissions').all(),
    ]);
    expect(serializedDatabase).not.toContain(firstBody.projectOverlay.customInstructions);
    expect(serializedDatabase).not.toContain('FIXED GUARDRAILS');
    expect(serializedDatabase).not.toContain('fresh-test-only-server-key');
  });

  it('rate-limits and serially bounds authoritative evaluation generation without persisting rejected attempts', async () => {
    await system.close();
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'evaluation-rate.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      preflightEvaluationLimit: 2,
      preflightEvaluationWindowMs: 60_000,
      preflightMaxActiveEvaluationsPerSession: 10,
    });
    let studentCookie = await grantStudent();
    await evaluate(studentCookie, submissionBody({
      projectMetadata: { projectId: 'rate_one', title: 'First allowed evaluation' },
    }));
    await evaluate(studentCookie, submissionBody({
      projectMetadata: { projectId: 'rate_two', title: 'Second allowed evaluation' },
    }));
    const { studentAnnotation: _annotation, ...rateBody } = submissionBody({
      projectMetadata: { projectId: 'rate_rejected', title: 'Must not persist' },
    });
    const rateLimited = await postJson(system.app, '/api/preflight/evaluations', rateBody, { cookie: studentCookie });
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get('retry-after')).toBe('60');
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_evaluations').get().count).toBe(2);

    await system.close();
    let releaseProvider;
    let markProviderEntered;
    const providerEntered = new Promise((resolve) => { markProviderEntered = resolve; });
    const ollamaRequest = vi.fn(() => new Promise((resolve) => {
      releaseProvider = resolve;
      markProviderEntered();
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'evaluation-concurrency.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      preflightEvaluationLimit: 10,
      preflightEvaluationConcurrency: 1,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    studentCookie = await grantStudent();
    const { studentAnnotation: _firstAnnotation, ...firstBody } = submissionBody({
      projectMetadata: { projectId: 'concurrency_one', title: 'In-flight evaluation' },
    });
    const firstRequest = postJson(system.app, '/api/preflight/evaluations', firstBody, { cookie: studentCookie });
    await providerEntered;
    const { studentAnnotation: _secondAnnotation, ...secondBody } = submissionBody({
      projectMetadata: { projectId: 'concurrency_rejected', title: 'Must not reach provider' },
    });
    const busy = await postJson(system.app, '/api/preflight/evaluations', secondBody, { cookie: studentCookie });
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('1');
    expect(ollamaRequest).toHaveBeenCalledTimes(1);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_evaluations').get().count).toBe(0);
    releaseProvider({
      suggestion: suggestion(),
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    });
    expect((await firstRequest).status).toBe(201);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_evaluations').get().count).toBe(1);
  });

  it('purges expired raw snapshots in bounded batches and preserves only an append-only hashed audit', async () => {
    await system.close();
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'retention.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      studentSessionTtlMs: 60_000,
      preflightRetentionPurgeLimit: 1,
    });
    const studentCookie = await grantStudent();
    const teacherCookie = await claimTeacher();
    const oldPending = await submit(studentCookie, submissionBody({
      projectMetadata: { projectId: 'old_pending_project', title: 'Expired pending snapshot' },
      sourceMaterial: 'UNIQUE EXPIRED PENDING SOURCE MATERIAL',
      studentAnnotation: 'UNIQUE EXPIRED PENDING NOTE',
    }));
    const oldDecided = await submit(studentCookie, submissionBody({
      projectMetadata: { projectId: 'old_decided_project', title: 'Expired decided snapshot' },
      sourceMaterial: 'UNIQUE EXPIRED DECIDED SOURCE MATERIAL',
      studentAnnotation: 'UNIQUE EXPIRED DECIDED NOTE',
    }));
    expect((await postJson(system.app, `/api/teacher/preflight-submissions/${oldDecided.id}/decision`, {
      decision: 'approve',
      instructorAnnotation: 'UNIQUE EXPIRED INSTRUCTOR ANNOTATION',
      expectedRevision: 1,
    }, { cookie: teacherCookie })).status).toBe(200);
    expect(() => system.db.prepare('DELETE FROM preflight_submissions WHERE id = ?').run(oldPending.id))
      .toThrow(/retention-managed/);

    currentTime += 181 * 24 * 60 * 60 * 1000 + 1;
    const freshStudentCookie = await grantStudent();
    const retained = await submit(freshStudentCookie, submissionBody({
      projectMetadata: { projectId: 'current_project', title: 'Current pending snapshot' },
      sourceMaterial: 'CURRENT SOURCE MATERIAL',
      studentAnnotation: 'CURRENT NOTE',
    }));
    const freshTeacherCookie = await loginTeacher();

    expect((await request(system.app, '/api/teacher/preflight-submissions?status=all', {
      headers: { cookie: freshTeacherCookie },
    })).status).toBe(200);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_retention_purges').get().count).toBe(1);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_submissions').get().count).toBe(2);

    const secondBatch = await request(system.app, '/api/teacher/preflight-submissions?status=all', {
      headers: { cookie: freshTeacherCookie },
    });
    expect(secondBatch.status).toBe(200);
    expect((await secondBatch.json()).submissions.map(({ id }) => id)).toEqual([retained.id]);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_submissions').get().count).toBe(1);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_review_events').get().count).toBe(0);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_retention_purge_guard').get().count).toBe(0);
    expect((await request(system.app, `/api/preflight/submissions/${oldPending.id}`, {
      headers: { cookie: freshStudentCookie },
    })).status).toBe(404);

    const audits = system.db.prepare(`
      SELECT submission_ref_hash AS submissionRefHash, status, decision,
        purged_at AS purgedAt, purged_by AS purgedBy
      FROM preflight_retention_purges ORDER BY status
    `).all();
    expect(audits).toEqual([
      {
        submissionRefHash: createHash('sha256').update(oldDecided.id).digest('hex'),
        status: 'approved',
        decision: 'approve',
        purgedAt: currentTime,
        purgedBy: 'retention',
      },
      {
        submissionRefHash: createHash('sha256').update(oldPending.id).digest('hex'),
        status: 'pending',
        decision: null,
        purgedAt: currentTime,
        purgedBy: 'retention',
      },
    ]);
    const serializedAudit = JSON.stringify(audits);
    expect(serializedAudit).not.toContain('SOURCE MATERIAL');
    expect(serializedAudit).not.toContain('ANNOTATION');
    expect(serializedAudit).not.toContain(oldPending.id);
    expect(() => system.db.prepare('UPDATE preflight_retention_purges SET purged_at = purged_at + 1').run())
      .toThrow(/append-only/);
    expect(() => system.db.prepare('DELETE FROM preflight_retention_purges').run()).toThrow(/append-only/);
    expect(assertDatabaseIntegrity(system.db)).toBe(true);
  });

  it('creates random capability IDs, minimizes student responses, and recovers status after a fresh class grant', async () => {
    expect((await postJson(system.app, '/api/preflight/submissions', submissionBody())).status).toBe(401);
    const firstStudent = await grantStudent();
    const created = await submit(firstStudent);
    expect(created.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.projectId).toBe('project_review_1');
    expect(created).toMatchObject({
      status: 'pending',
      decision: null,
      revision: 1,
      submittedAt: '2027-01-15T08:00:00.000Z',
      reviewedAt: null,
      instructorAnnotation: null,
      focusedQuestion: null,
    });
    expect(Object.keys(created).sort()).toEqual([
      'decision', 'focusedQuestion', 'id', 'instructorAnnotation', 'projectId', 'reviewedAt',
      'revision', 'status', 'submittedAt', 'updatedAt',
    ]);
    expect(created).not.toHaveProperty('sourceMaterial');
    expect(created).not.toHaveProperty('suggestion');
    expect(created).not.toHaveProperty('configSnapshot');
    expect(created).not.toHaveProperty('projectMetadata');
    expect(created).not.toHaveProperty('reviewingTeacher');
    expect((await request(system.app, `/api/preflight/submissions/${created.id}`)).status).toBe(401);

    const secondStudent = await grantStudent();
    const recoveredByCapability = await request(system.app, `/api/preflight/submissions/${created.id}`, {
      headers: { cookie: secondStudent },
    });
    expect(recoveredByCapability.status).toBe(200);
    expect((await recoveredByCapability.json()).submission).toEqual(created);
    const absent = await request(system.app, `/api/preflight/submissions/${'z'.repeat(32)}`, {
      headers: { cookie: secondStudent },
    });
    expect(absent.status).toBe(404);

    const own = await request(system.app, `/api/preflight/submissions/${created.id}`, {
      headers: { cookie: firstStudent },
    });
    expect(own.status).toBe(200);
    expect((await own.json()).submission).toEqual(created);
    expect(own.headers.get('cache-control')).toBe('no-store');
    const stored = system.db.prepare(`
      SELECT project_metadata_json AS projectMetadata, source_material AS sourceMaterial,
        source_record_json AS sourceRecord, suggestion_json AS suggestion,
        config_snapshot_json AS configSnapshot, runtime_metadata_json AS runtimeMetadata
      FROM preflight_submissions WHERE id = ?
    `).get(created.id);
    expect(JSON.parse(stored.projectMetadata)).toEqual(submissionBody().projectMetadata);
    expect(stored.sourceMaterial).toBe(submissionBody().sourceMaterial);
    expect(JSON.parse(stored.sourceRecord)).toEqual(submissionBody().sourceRecord);
    expect(JSON.parse(stored.suggestion)).toMatchObject({
      hard: expect.any(Array),
      scored: expect.any(Array),
      threshold: 6,
      evaluatedAt: '2027-01-15T08:00:00.000Z',
    });
    expect(JSON.parse(stored.suggestion).configurationSnapshot).toEqual(JSON.parse(stored.configSnapshot));
    expect(JSON.parse(stored.configSnapshot).projectOverlay).toEqual((({ customInstructions: _prompt, ...metadata }) => metadata)(submissionBody().projectOverlay));
    expect(JSON.parse(stored.runtimeMetadata)).toEqual({
      provider: 'deterministic',
      model: 'STEM Splitter',
      createdAt: '2027-01-15T08:00:00.000Z',
    });
    expect(JSON.stringify(stored)).not.toContain(submissionBody().projectOverlay.customInstructions);

    currentTime += 60_001;
    expect((await request(system.app, `/api/preflight/submissions/${created.id}`, {
      headers: { cookie: firstStudent },
    })).status).toBe(401);
    const refreshedStudent = await grantStudent();
    const afterExpiry = await request(system.app, `/api/preflight/submissions/${created.id}`, {
      headers: { cookie: refreshedStudent },
    });
    expect(afterExpiry.status).toBe(200);
    expect((await afterExpiry.json()).submission).toEqual(created);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_submissions').get().count).toBe(1);
  });

  it('rejects unknown, malformed, inconsistent, and oversized submission state', async () => {
    const studentCookie = await grantStudent();
    const invalidBodies = [
      { ...submissionBody(), graph: { nodes: [{ private: 'must not be accepted' }] } },
      submissionBody({ activeScale: 'planetary' }),
      submissionBody({ projectMetadata: { projectId: 'project_1', privateTranscript: 'not allowed' } }),
      submissionBody({ sourceRecord: { ...submissionBody().sourceRecord, consent: 'yes' } }),
      submissionBody({ sourceRecord: { ...submissionBody().sourceRecord, location: undefined } }),
      submissionBody({ projectOverlay: { ...submissionBody().projectOverlay, fixedPrompt: 'must not travel' } }),
      submissionBody({ sourceMaterial: '   ' }),
    ];
    for (const body of invalidBodies) {
      const { studentAnnotation: _studentAnnotation, ...evaluationBody } = body;
      const response = await postJson(system.app, '/api/preflight/evaluations', evaluationBody, { cookie: studentCookie });
      expect(response.status).toBe(400);
    }
    expect((await postJson(system.app, '/api/preflight/submissions', submissionBody(), { cookie: studentCookie })).status).toBe(400);
    expect((await postJson(system.app, '/api/preflight/submissions', {
      evaluationId: 'x'.repeat(32), studentAnnotation: '',
    }, { cookie: studentCookie })).status).toBe(409);
    const oversized = await browserRequest(system.app, '/api/preflight/evaluations', {
      method: 'POST',
      headers: { ...JSON_HEADERS, cookie: studentCookie, 'content-length': String(768 * 1024 + 1) },
      body: '{}',
    });
    expect(oversized.status).toBe(413);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_submissions').get().count).toBe(0);
  });

  it('accepts source-record JSON near the app byte ceiling and rejects multibyte overflow before persistence', async () => {
    const studentCookie = await grantStudent();
    const nearLimit = nearLimitSourceRecord();
    expect(Buffer.byteLength(JSON.stringify(nearLimit), 'utf8')).toBe(16_300);
    const evaluation = await evaluate(studentCookie, submissionBody({ sourceRecord: nearLimit }));
    expect((await postJson(system.app, '/api/preflight/submissions', {
      evaluationId: evaluation.id,
      studentAnnotation: 'Near-limit source metadata.',
    }, { cookie: studentCookie })).status).toBe(201);

    const multibyteOverflow = {
      ...submissionBody().sourceRecord,
      location: 'é'.repeat(8000),
      rights: 'é'.repeat(100),
    };
    expect(JSON.stringify(multibyteOverflow).length).toBeLessThan(16_384);
    expect(Buffer.byteLength(JSON.stringify(multibyteOverflow), 'utf8')).toBeGreaterThan(16_384);
    const { studentAnnotation: _studentAnnotation, ...overflowBody } = submissionBody({
      projectMetadata: { projectId: 'multibyte_overflow', title: 'Must be rejected before storage' },
      sourceRecord: multibyteOverflow,
    });
    expect((await postJson(system.app, '/api/preflight/evaluations', overflowBody, { cookie: studentCookie })).status).toBe(400);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_submissions').get().count).toBe(1);
  });

  it('caps pending rows per session and across the course without persisting rejected attempts', async () => {
    await system.close();
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'bounded-review.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      preflightSubmissionLimit: 10,
      preflightSubmissionWindowMs: 60_000,
      preflightMaxPendingPerSession: 2,
      preflightMaxPendingTotal: 3,
    });
    const firstSession = await grantStudent();
    await submit(firstSession);
    await submit(firstSession, submissionBody({
      projectMetadata: { projectId: 'project_session_two', title: 'Second pending item' },
    }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const body = submissionBody({
        projectMetadata: { projectId: `project_rejected_${attempt}`, title: 'Must not persist' },
      });
      const evaluation = await evaluate(firstSession, body);
      const limited = await postJson(system.app, '/api/preflight/submissions', {
        evaluationId: evaluation.id, studentAnnotation: body.studentAnnotation,
      }, { cookie: firstSession });
      expect(limited.status).toBe(429);
    }
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_submissions').get().count).toBe(2);

    const secondSession = await grantStudent();
    await submit(secondSession, submissionBody({
      projectMetadata: { projectId: 'project_course_three', title: 'Course cap item' },
    }));
    const thirdSession = await grantStudent();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const body = submissionBody({
        projectMetadata: { projectId: `project_course_rejected_${attempt}`, title: 'Course queue full' },
      });
      const evaluation = await evaluate(thirdSession, body);
      const full = await postJson(system.app, '/api/preflight/submissions', {
        evaluationId: evaluation.id, studentAnnotation: body.studentAnnotation,
      }, { cookie: thirdSession });
      expect(full.status).toBe(429);
    }
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_submissions').get().count).toBe(3);
    expect(assertDatabaseIntegrity(system.db)).toBe(true);
  });

  it('gives authenticated teachers a status-filtered queue and identity-bearing detail only', async () => {
    const studentCookie = await grantStudent();
    const first = await submit(studentCookie);
    currentTime += 1000;
    const second = await submit(studentCookie, submissionBody({
      projectMetadata: { projectId: 'project_review_2', title: 'Second review' },
    }));
    expect((await request(system.app, '/api/teacher/preflight-submissions')).status).toBe(401);
    const teacherCookie = await claimTeacher();

    const pending = await request(system.app, '/api/teacher/preflight-submissions', {
      headers: { cookie: teacherCookie },
    });
    expect(pending.status).toBe(200);
    const summaries = (await pending.json()).submissions;
    expect(summaries.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(summaries[0].projectTitle).toBe('Family access review');
    expect(summaries[0]).not.toHaveProperty('projectMetadata');
    expect(summaries[0]).not.toHaveProperty('inquiry');
    expect(summaries[0]).not.toHaveProperty('sourceMaterial');
    expect(summaries[0]).not.toHaveProperty('suggestion');

    const detail = await request(system.app, `/api/teacher/preflight-submissions/${first.id}`, {
      headers: { cookie: teacherCookie },
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({
      submission: expect.objectContaining({
        id: first.id,
        sourceMaterial: submissionBody().sourceMaterial,
        suggestion: expect.objectContaining({
          hard: expect.arrayContaining([expect.objectContaining({ id: 'H1', status: expect.any(String) })]),
          scored: expect.arrayContaining([expect.objectContaining({ id: 'C1', status: expect.any(String) })]),
          score: expect.any(Number),
          outcome: expect.any(String),
        }),
        reviewingTeacher: null,
      }),
      reviewEvents: [],
    });
    expect((await request(system.app, '/api/teacher/preflight-submissions?status=unknown', {
      headers: { cookie: teacherCookie },
    })).status).toBe(400);
  });

  it('records a bounded focused question transactionally and reveals feedback without teacher identity to its student', async () => {
    const studentCookie = await grantStudent();
    const teacherCookie = await claimTeacher();
    const created = await submit(studentCookie);
    const focusedQuestion = 'Which memo sentence best supports the referral interpretation?';
    currentTime += 5000;
    const response = await postJson(system.app, `/api/teacher/preflight-submissions/${created.id}/decision`, {
      decision: 'revise_and_approve',
      instructorAnnotation: 'Return to the referral evidence before choosing candidates.',
      focusedQuestion,
      expectedRevision: 1,
    }, { cookie: teacherCookie });
    expect(response.status).toBe(200);
    const detail = await response.json();
    expect(detail.submission).toMatchObject({
      status: 'approved',
      decision: 'revise_and_approve',
      revision: 2,
      instructorAnnotation: 'Return to the referral evidence before choosing candidates.',
      focusedQuestion,
      reviewingTeacher: { id: 'maria-mavrides-calderon', displayName: 'Maria Mavrides Calderon' },
    });
    expect(detail.submission).not.toHaveProperty('revisedSuggestion');
    expect(detail.reviewEvents).toEqual([expect.objectContaining({
      decision: 'revise_and_approve',
      fromRevision: 1,
      toRevision: 2,
      focusedQuestion,
      reviewingTeacher: { id: 'maria-mavrides-calderon', displayName: 'Maria Mavrides Calderon' },
    })]);
    expect(detail.reviewEvents[0]).not.toHaveProperty('revisedSuggestion');

    const studentResponse = await request(system.app, `/api/preflight/submissions/${created.id}`, {
      headers: { cookie: studentCookie },
    });
    const studentRecord = (await studentResponse.json()).submission;
    expect(studentRecord).toMatchObject({
      status: 'approved',
      decision: 'revise_and_approve',
      revision: 2,
      focusedQuestion,
    });
    expect(studentRecord).not.toHaveProperty('revisedSuggestion');
    expect(studentRecord).not.toHaveProperty('reviewingTeacher');
    expect(JSON.stringify(studentRecord)).not.toContain('Maria Mavrides Calderon');
    expect(JSON.stringify(studentRecord)).not.toContain('maria-mavrides-calderon');
    expect(system.db.prepare(`
      SELECT source_material AS sourceMaterial, revised_suggestion AS storedFocusedQuestion
      FROM preflight_submissions WHERE id = ?
    `).get(created.id)).toEqual({
      sourceMaterial: submissionBody().sourceMaterial,
      storedFocusedQuestion: focusedQuestion,
    });
  });

  it('enforces decision fields and resolves optimistic races with one append-only winner', async () => {
    const studentCookie = await grantStudent();
    const teacherCookie = await claimTeacher();
    const created = await submit(studentCookie);
    const invalid = [
      { decision: 'approve', instructorAnnotation: '', expectedRevision: 1 },
      { decision: 'approve', instructorAnnotation: 'Looks good.', revisedSuggestion: 'Not allowed for approve.', expectedRevision: 1 },
      { decision: 'reject', instructorAnnotation: 'Needs another source.', revisedSuggestion: 'Not allowed for reject.', expectedRevision: 1 },
      { decision: 'approve', instructorAnnotation: 'Looks good.', focusedQuestion: 'Not allowed for approve.', expectedRevision: 1 },
      { decision: 'reject', instructorAnnotation: 'Needs another source.', focusedQuestion: 'Not allowed for reject.', expectedRevision: 1 },
      { decision: 'revise_and_approve', instructorAnnotation: 'Use this.', focusedQuestion: suggestion(), expectedRevision: 1 },
      { decision: 'revise_and_approve', instructorAnnotation: 'Use this.', focusedQuestion: '   ', expectedRevision: 1 },
      { decision: 'revise_and_approve', instructorAnnotation: 'Use this.', focusedQuestion: 'x'.repeat(1001), expectedRevision: 1 },
      { decision: 'revise_and_approve', instructorAnnotation: 'Use this.', expectedRevision: 1 },
      { decision: 'not-a-decision', instructorAnnotation: 'Invalid.', expectedRevision: 1 },
      { decision: 'approve', instructorAnnotation: 'Stale.', expectedRevision: 2 },
    ];
    for (const body of invalid) {
      const response = await postJson(system.app, `/api/teacher/preflight-submissions/${created.id}/decision`, body, {
        cookie: teacherCookie,
      });
      expect([400, 409]).toContain(response.status);
    }
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_review_events').get().count).toBe(0);

    const decisions = await Promise.all([
      postJson(system.app, `/api/teacher/preflight-submissions/${created.id}/decision`, {
        decision: 'approve', instructorAnnotation: 'Approved from the first review.', expectedRevision: 1,
      }, { cookie: teacherCookie }),
      postJson(system.app, `/api/teacher/preflight-submissions/${created.id}/decision`, {
        decision: 'reject', instructorAnnotation: 'A concurrent rejection that must not win.', expectedRevision: 1,
      }, { cookie: teacherCookie }),
    ]);
    expect(decisions.map(({ status }) => status).sort()).toEqual([200, 409]);
    const conflict = decisions.find(({ status }) => status === 409);
    expect((await conflict.json()).details.current).toMatchObject({
      status: 'approved', decision: 'approve', revision: 2,
    });
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_review_events').get().count).toBe(1);
    expect(system.db.prepare('SELECT revision, status, decision FROM preflight_submissions WHERE id = ?').get(created.id))
      .toEqual({ revision: 2, status: 'approved', decision: 'approve' });

    const approved = await request(system.app, '/api/teacher/preflight-submissions?status=approved', {
      headers: { cookie: teacherCookie },
    });
    expect((await approved.json()).submissions.map(({ id }) => id)).toEqual([created.id]);
    const pending = await request(system.app, '/api/teacher/preflight-submissions', {
      headers: { cookie: teacherCookie },
    });
    expect((await pending.json()).submissions).toEqual([]);
  });
});
