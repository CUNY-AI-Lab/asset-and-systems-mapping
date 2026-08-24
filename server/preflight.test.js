// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deterministicMemoReview } from '../src/domain.js';
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

function memoReviewFixture() {
  return {
    guidance: [
      {
        point: `  The memo   already grounds the referral. ${'x'.repeat(1100)}  `,
        evidenceExcerpt: `  Memo   sentence one. ${'y'.repeat(4100)}  `,
      },
      { point: 'Ask one question about a specific passage in the memo.' },
    ],
    nodes: [
      { label: '  School  ', type: 'organization', scale: 'meso', evidence: 'A school refers a family to an agency.' },
      { label: 'Family', type: 'family', scale: 'micro', evidence: 'A school refers a family to an agency.' },
      { label: 'family', type: 'family', scale: 'micro', evidence: 'duplicate label must be dropped' },
      { label: 'Agency', type: 'not-a-type', scale: 'not-a-scale', evidence: '' },
    ],
    connections: [
      { source: 'School', target: 'Family', verb: '  refers  ', rationale: 'The memo names the referral directly.' },
      { source: 'School', target: 'School', verb: 'loops', rationale: 'self loops must be dropped' },
      { source: 'School', target: 'Unknown Node', verb: 'points', rationale: 'unknown endpoints must be dropped' },
    ],
    example: 'One evident connection: School refers Family, because the memo names the referral directly.',
    readiness: { ready: true, note: '  The memo   already supports mapping. Continue to choose nodes.  ' },
  };
}

function sparseMemoReviewFixture() {
  return { guidance: [], nodes: [], connections: [], example: null, readiness: { ready: false, note: '' } };
}

function submissionBody(overrides = {}) {
  const activeScale = overrides.activeScale || 'micro';
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
    activeScale,
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
      evidenceOwnership: 'What the memo says and what the student thinks it means are labeled separately',
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
    ...(activeScale === 'meso' ? { carriedNodes: [
      { id: 'node_school', label: 'School', type: 'setting', scale: 'micro' },
      { id: 'node_family', label: 'Family', type: 'setting', scale: 'micro' },
      { id: 'node_agency', label: 'Agency setting', type: 'setting', scale: 'micro' },
    ] } : {}),
    ...overrides,
  };
}

function connectionBody(overrides = {}) {
  const overlay = submissionBody().projectOverlay;
  return {
    activeScale: 'meso',
    inquiry: 'How do schools shape family access to services?',
    prompt: 'Families ask schools for help, and schools refer them to agencies.',
    nodes: [
      { id: 'node_family', label: 'Family', type: 'family', scale: 'micro' },
      { id: 'node_school', label: 'School', type: 'organization', scale: 'micro' },
      { id: 'node_agency', label: 'Agency', type: 'agency', scale: 'micro' },
    ],
    relationships: [{ source: 'node_school', target: 'node_agency', verb: 'refers to' }],
    projectOverlay: {
      ...overlay,
      id: 'graph-builder-v1',
      outputSchemaVersion: 'systems-mapping.graph-operations.v1',
      label: 'Map builder',
      customInstructions: 'Keep the student wording visible and offer no more than four connections.',
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
      'configSnapshot', 'createdAt', 'expiresAt', 'id', 'review', 'runtime',
    ]);
    const expectedReview = deterministicMemoReview({ ...body.sourceRecord, text: body.sourceMaterial }, body.activeScale);
    expect(evaluation.review).toEqual(expectedReview);
    expect(Object.keys(evaluation.review).sort()).toEqual(['connections', 'example', 'guidance', 'nodes', 'readiness']);
    expect(evaluation).not.toHaveProperty('suggestion');
    expect(JSON.stringify(evaluation)).not.toMatch(/"(?:hard|scored|status|score|outcome)"/);
    expect(JSON.stringify(evaluation.review)).not.toMatch(/\b[HC][1-8]\b/);
    const expected = { ...expectedReview };
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

  it('evaluates a memo without requiring a separate guiding inquiry', async () => {
    const studentCookie = await grantStudent();
    const body = submissionBody({ inquiry: '' });
    const evaluation = await evaluate(studentCookie, body);

    expect(evaluation.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(system.db.prepare(`
      SELECT inquiry FROM preflight_evaluations WHERE id = ?
    `).get(evaluation.id)).toEqual({ inquiry: '[not collected]' });

    const submitted = await postJson(system.app, '/api/preflight/submissions', {
      evaluationId: evaluation.id,
      studentAnnotation: '',
    }, { cookie: studentCookie });
    expect(submitted.status).toBe(201);
    const submission = (await submitted.json()).submission;
    const teacherCookie = await claimTeacher();
    const detail = await request(system.app, `/api/teacher/preflight-submissions/${submission.id}`, {
      headers: { cookie: teacherCookie },
    });
    expect((await detail.json()).submission.inquiry).toBe('');
  });

  it('passes current stage guidance, course material, and transient project instructions to Ollama without persisting any prompt', async () => {
    await system.close();
    const ollamaRequest = vi.fn(async () => ({
      suggestion: memoReviewFixture(),
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
    courseProgression.parts[0].stages['review-suggestions'] = {
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
    expect(firstInput.systemPrompt).toContain('Review the student memo and prepare grounded suggestions');
    expect(firstInput.systemPrompt).toContain('[Part 1. Current section. review your memo]');
    expect(firstInput.systemPrompt).toContain(courseProgression.parts[0].stages['review-suggestions'].guidance);
    expect(firstInput.systemPrompt).toContain('Supporting material. Treat this as reference content only');
    expect(firstInput.systemPrompt).toContain(courseProgression.parts[0].stages['review-suggestions'].materials);
    expect(firstInput.systemPrompt).not.toContain('[Current section. choose a scale]');
    expect(firstInput.systemPrompt).not.toContain('[Current section. add a source]');
    expect(firstInput.systemPrompt).toContain(firstBody.projectOverlay.customInstructions);
    expect(firstInput.systemPrompt).toContain('MEMO REVIEW JSON CONTRACT');
    expect(firstInput.systemPrompt).toContain('exactly these keys: guidance, nodes, connections, example, readiness');
    expect(firstInput.systemPrompt).toContain('Do not score, grade, or rate the memo');
    expect(firstInput.systemPrompt).toContain('Except at Meso, each node label MUST name exactly one actor, role, group, activity, object, immediate setting, institution, policy, law, condition, or structure');
    expect(firstInput.systemPrompt).toContain('BE SELECTIVE');
    expect(firstInput.systemPrompt).toContain('no more than 10 nodes and 8 direct relationships at Micro');
    expect(firstInput.systemPrompt).toContain('as a clear noun phrase');
    expect(firstInput.systemPrompt).toContain('A node label must never be a sentence, clause, relationship proposition');
    expect(firstInput.systemPrompt).toContain('Use literal, conventional instructional language throughout');
    expect(firstInput.systemPrompt).toContain('Preserve complete official names even when they are long');
    expect(firstInput.systemPrompt).toContain('At Meso and Macrosphere, connections MUST be empty');
    expect(firstInput.systemPrompt).toContain('LEVEL TESTS');
    expect(firstInput.systemPrompt).toContain('Meso identifies only an interrelation among two or more of those Micro settings');
    expect(firstInput.systemPrompt).toContain('Meso is not another place to add actors, organizations, institutions, or services');
    expect(firstInput.systemPrompt).toContain('Never propose a university, employer, registrar, bursar, office, agency, program, service, administrative system, or other institutional entity as a Meso node.');
    expect(firstInput.systemPrompt).toContain('Never tell the student to add an institution, office, administrator, employer, service, policy, or other entity at Meso.');
    expect(firstInput.systemPrompt).toContain('verb MUST be exactly one of: funds, administers, regulates');
    expect(firstInput.systemPrompt).toContain('deontic must be exactly one of: shapes, mandates, prohibits');
    expect(firstInput.systemPrompt.lastIndexOf('MEMO REVIEW JSON CONTRACT'))
      .toBeGreaterThan(firstInput.systemPrompt.lastIndexOf(firstBody.projectOverlay.customInstructions));
    expect(first.runtime).toEqual({
      provider: 'ollama-cloud',
      model: 'server-model',
      createdAt: '2027-01-15T08:00:00.000Z',
      maxSourceBytes: 131_072,
      requestedModel: 'server-model',
      evalCount: 42,
    });
    expect(first.review.guidance).toHaveLength(2);
    expect(first.review.guidance[0].point.length).toBeLessThanOrEqual(500);
    expect(first.review.guidance[0].point).not.toMatch(/\s{2,}/);
    expect(first.review.guidance[0].evidenceExcerpt.length).toBeLessThanOrEqual(500);
    expect(first.review.guidance[0].evidenceExcerpt).not.toMatch(/\s{2,}/);
    expect(first.review.guidance[1]).toEqual({
      point: 'Ask one question about a specific passage in the memo.',
    });
    expect(first.review.nodes).toEqual([
      { label: 'School', type: 'organization', scale: 'micro', evidence: 'A school refers a family to an agency.' },
      { label: 'Family', type: 'family', scale: 'micro', evidence: 'A school refers a family to an agency.' },
    ]);
    expect(first.review.connections).toEqual([{
      source: 'School', target: 'Family', sourceLabel: 'School', targetLabel: 'Family',
      verb: 'refers', rationale: 'The memo names the referral directly.',
    }]);
    expect(first.review.example).toBeNull();
    expect(first.review.readiness).toEqual({
      ready: true,
      note: 'The memo already supports mapping. Continue to choose nodes.',
    });
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
      suggestion: sparseMemoReviewFixture(),
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    });
    const sparse = await evaluate(studentCookie, submissionBody({
      projectMetadata: { projectId: 'sparse_review', title: 'Sparse review still responds' },
    }));
    expect(sparse.review).toEqual(sparseMemoReviewFixture());
    expect(sparse).not.toHaveProperty('suggestion');

    ollamaRequest.mockResolvedValueOnce({
      suggestion: { hard: [], scored: [], fabricatedProviderField: 'must fail closed' },
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
      error: 'The memo must contain no more than 131072 UTF-8 bytes for this suggestion runtime.',
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

  it('drops provider clause labels at every level without guessing, while preserving discrete labels and official names', async () => {
    await system.close();
    const fullClause = 'Adult Participants face delays when the Accessible Van Program is unavailable.';
    const shortClause = 'Adult Participants face delays';
    const officialName = 'New York State Office for People with Developmental Disabilities and Community-Based Access Coordination';
    const ollamaRequest = vi.fn(async () => ({
      suggestion: {
        guidance: [],
        nodes: [
          { label: fullClause, type: 'event', scale: 'micro', evidence: fullClause },
          { label: shortClause, type: 'event', scale: 'micro', evidence: fullClause },
          { label: 'Adult Participants', type: 'person', scale: 'micro', evidence: fullClause },
          { label: 'Accessible Van Program', type: 'service', scale: 'micro', evidence: fullClause },
          { label: officialName, type: 'agency', scale: 'micro', evidence: 'The office coordinates access.' },
        ],
        connections: [],
        example: null,
        readiness: { ready: true, note: 'Ready.' },
      },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'micro-discrete-provider-nodes.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    const studentCookie = await grantStudent();
    const micro = await evaluate(studentCookie, submissionBody({ sourceMaterial: fullClause }));

    expect(micro.review.nodes.map(({ label }) => label)).toEqual([
      'Adult Participants',
      'Accessible Van Program',
      officialName,
    ]);
    expect(micro.review.nodes[0].evidence).toBe(fullClause);
    expect(micro.review.nodes.map(({ label }) => label)).not.toEqual(expect.arrayContaining([fullClause, shortClause]));
    expect(micro.review.readiness.ready).toBe(true);
    const storedMicro = JSON.parse(system.db.prepare(`
      SELECT suggestion_json AS suggestion FROM preflight_evaluations WHERE id = ?
    `).get(micro.id).suggestion);
    expect(storedMicro.nodes).toEqual(micro.review.nodes);

    const exosphere = await evaluate(studentCookie, submissionBody({
      activeScale: 'exosphere',
      projectMetadata: { projectId: 'outer_label_contract', title: 'Outer level remains unchanged' },
      sourceMaterial: fullClause,
    }));
    // The discrete-label rule now holds at every level: clauses are dropped
    // at Exosphere too, while complete official names always survive.
    expect(exosphere.review.nodes.map(({ label }) => label)).toEqual([
      'Accessible Van Program',
      officialName,
    ]);
    expect(ollamaRequest).toHaveBeenCalledTimes(2);
  });

  it('gives Meso review scoped mesosystems and rejects unknown setting IDs', async () => {
    await system.close();
    const ollamaRequest = vi.fn(async () => ({
      suggestion: {
        guidance: [{ point: 'Review node_school and node_family as one mesosystem.' }],
        nodes: [
          { label: 'Family–school coordination', type: 'mesosystem', scale: 'meso', evidence: 'The memo places both settings in the person’s immediate experience.', scope: ['node_school', 'node_family'] },
          { label: 'Unknown setting mesosystem', type: 'mesosystem', scale: 'meso', evidence: 'Unsupported.', scope: ['node_school', 'node_unknown'] },
        ],
        connections: [{ source: 'node_school', target: 'node_family', verb: 'refers', rationale: 'Meso must discard this edge.' }],
        example: 'The node_school and node_family settings form one mesosystem.',
        readiness: { ready: true, note: 'The node_school and node_family mesosystem is supported.' },
      },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'meso-carried-nodes.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    const studentCookie = await grantStudent();
    const body = submissionBody({ activeScale: 'meso' });
    const evaluation = await evaluate(studentCookie, body);

    expect(ollamaRequest).toHaveBeenCalledTimes(1);
    expect(ollamaRequest.mock.calls[0][0].carriedNodes).toEqual(body.carriedNodes);
    expect(ollamaRequest.mock.calls[0][0].systemPrompt).toContain('scope containing the exact IDs of 2 or more Micro settings already on the map');
    expect(evaluation.review.nodes).toEqual([{
      label: 'Family–school coordination', type: 'mesosystem', scale: 'meso',
      evidence: 'The memo places both settings in the person’s immediate experience.',
      scope: [{ id: 'node_school', label: 'School' }, { id: 'node_family', label: 'Family' }],
    }]);
    expect(evaluation.review.connections).toEqual([]);
    expect(evaluation.review.readiness.ready).toBe(true);
    expect(evaluation.review.guidance[0].point).toBe('Review School and Family as one mesosystem.');
    expect(evaluation.review.example).toBeNull();
    expect(evaluation.review.readiness.note).toBe('The review found 1 possible mesosystem among Micro settings already on the map.');
    expect(JSON.stringify({
      guidance: evaluation.review.guidance,
      example: evaluation.review.example,
      readiness: evaluation.review.readiness,
    })).not.toMatch(/node_(?:school|family)/);

    const invalid = await postJson(system.app, '/api/preflight/evaluations', {
      ...body,
      projectMetadata: { projectId: 'invalid_carried_node', title: 'Invalid carried node' },
      carriedNodes: [{ ...body.carriedNodes[0], unexpected: true }],
    }, { cookie: studentCookie });
    expect(invalid.status).toBe(400);
    expect(ollamaRequest).toHaveBeenCalledTimes(1);

    const inappropriate = await postJson(system.app, '/api/preflight/evaluations', {
      ...submissionBody(),
      carriedNodes: body.carriedNodes,
    }, { cookie: studentCookie });
    expect(inappropriate.status).toBe(400);
    expect(ollamaRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps institutions and institutional guidance out of Meso for the CUNY Reddit memo', async () => {
    await system.close();
    const ollamaRequest = vi.fn(async () => ({
      suggestion: {
        guidance: [
          { point: 'Map the CUNY registrar and bursar at the Meso level.' },
          { point: 'Treat the employer as a Meso-level institution.' },
        ],
        nodes: [
          {
            label: 'CUNY administrative systems', type: 'mesosystem', scale: 'meso',
            evidence: 'The memo names graduation processing, billing, and registration.',
            scope: ['node_reddit', 'node_workplace'],
          },
          {
            label: 'Registrar and bursar coordination', type: 'mesosystem', scale: 'meso',
            evidence: 'The memo names delayed diplomas and payment plans.',
            scope: ['node_reddit', 'node_workplace'],
          },
          {
            label: 'Work–online peer support coordination', type: 'mesosystem', scale: 'meso',
            evidence: 'The posting history documents a working student repeatedly turning to Reddit when institutional systems were unclear or incompatible with work.',
            scope: ['node_reddit', 'node_workplace'],
          },
        ],
        connections: [{ source: 'node_reddit', target: 'node_workplace', verb: 'supports', rationale: 'Meso must discard this edge.' }],
        example: 'The CUNY registrar, bursar, and employer are Meso institutions.',
        readiness: { ready: true, note: 'Add the registrar, bursar, and employer at Meso.' },
      },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'meso-cuny-reddit-boundary.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    const studentCookie = await grantStudent();
    const body = submissionBody({
      activeScale: 'meso',
      sourceMaterial: `Brief memo — u/DalekSupreme23

From 2020–2024, this user posted in r/CUNY every calendar year—eight submissions total. They primarily sought peer help navigating CUNY: delayed diplomas, tuition payment plans, COVID testing, course scheduling, instructors, and registration.

Overall, the posting history documents a working student repeatedly turning to Reddit when institutional systems were unclear or incompatible with work.`,
      carriedNodes: [
        { id: 'node_reddit', label: 'r/CUNY', type: 'setting', scale: 'micro' },
        { id: 'node_workplace', label: 'Workplace', type: 'setting', scale: 'micro' },
      ],
    });
    const evaluation = await evaluate(studentCookie, body);

    const systemPrompt = ollamaRequest.mock.calls[0][0].systemPrompt;
    expect(systemPrompt).toContain('Meso does not add actors, organizations, institutions, services, or institutional actions.');
    expect(systemPrompt).toContain('Named universities, employers, offices, agencies, and service systems belong in Exosphere, not Meso.');
    expect(evaluation.review.nodes).toEqual([{
      label: 'Work–online peer support coordination',
      type: 'mesosystem',
      scale: 'meso',
      evidence: 'The posting history documents a working student repeatedly turning to Reddit when institutional systems were unclear or incompatible with work.',
      scope: [
        { id: 'node_reddit', label: 'r/CUNY' },
        { id: 'node_workplace', label: 'Workplace' },
      ],
    }]);
    expect(evaluation.review.connections).toEqual([]);
    expect(evaluation.review.guidance).toEqual([{ point: 'Review r/CUNY and Workplace as one mesosystem.' }]);
    expect(evaluation.review.example).toBeNull();
    expect(evaluation.review.readiness).toEqual({
      ready: true,
      note: 'The review found 1 possible mesosystem among Micro settings already on the map.',
    });
    expect(JSON.stringify(evaluation.review)).not.toMatch(/Meso-level institution|add the registrar|CUNY administrative systems|Registrar and bursar coordination/);
  });

  it('lets Exosphere reviews tie new institutions to carried map nodes without re-proposing them', async () => {
    await system.close();
    const carriedNodes = [
      { id: 'node_school', label: 'School', type: 'setting', scale: 'micro' },
      { id: 'node_family', label: 'Family', type: 'family', scale: 'micro' },
    ];
    const ollamaRequest = vi.fn(async () => ({
      suggestion: {
        guidance: [{ point: 'The memo names an indirect funder.' }],
        nodes: [
          { label: 'School', type: 'organization', scale: 'exosphere', evidence: 'Already mapped; must not repeat.' },
          { label: 'City Education Foundation', type: 'agency', scale: 'exosphere', evidence: 'The foundation pays for the program.' },
          { label: 'CUNY', type: 'institution', scale: 'exosphere', evidence: 'CUNY sets institution-wide rules.' },
        ],
        connections: [
          { source: 'City Education Foundation', target: 'School', verb: 'funds', rationale: 'The foundation pays for the program.' },
          { source: 'CUNY', target: 'Family', verb: 'sets rules for', rationale: 'CUNY sets institution-wide rules affecting families.' },
          { source: 'City Education Foundation', target: 'Unknown Body', verb: 'reports to', rationale: 'Unknown endpoints are rejected.' },
          { source: 'School', target: 'Family', verb: 'refers', rationale: 'Already mapped; must not repeat.' },
        ],
        example: 'City Education Foundation funds School.',
        readiness: { ready: true, note: 'The memo supports an Exosphere cycle.' },
      },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'exosphere-carried-nodes.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    const studentCookie = await grantStudent();
    const carriedConnections = [{ source: 'node_school', target: 'node_family', verb: 'refers' }];
    const body = submissionBody({ activeScale: 'exosphere', carriedNodes, carriedConnections });
    const evaluation = await evaluate(studentCookie, body);

    expect(ollamaRequest).toHaveBeenCalledTimes(1);
    expect(ollamaRequest.mock.calls[0][0].carriedNodes).toEqual(carriedNodes);
    expect(ollamaRequest.mock.calls[0][0].carriedConnections).toEqual(carriedConnections);
    expect(evaluation.review.nodes.map(({ label }) => label)).toEqual(['City Education Foundation', 'CUNY']);
    expect(evaluation.review.connections).toEqual([
      {
        source: 'City Education Foundation',
        target: 'node_school',
        sourceLabel: 'City Education Foundation',
        targetLabel: 'School',
        verb: 'funds',
        rationale: 'The foundation pays for the program.',
      },
      {
        source: 'CUNY',
        target: 'node_family',
        sourceLabel: 'CUNY',
        targetLabel: 'Family',
        verb: 'sets rules for',
        rationale: 'CUNY sets institution-wide rules affecting families.',
      },
    ]);

    // The stored review replays with the same endpoints intact.
    const readBack = await system.app.request('http://127.0.0.1:4177/api/preflight/evaluations/current', {
      headers: { origin: 'http://127.0.0.1:4177', 'sec-fetch-site': 'same-origin', cookie: studentCookie },
    });
    if (readBack.status === 200) {
      const stored = (await readBack.json()).evaluation;
      expect(stored.review.connections).toEqual(evaluation.review.connections);
    }
  });

  it('holds Exosphere connections to the institutional register, the carried-map anchor, and the basis marker', async () => {
    await system.close();
    const carriedNodes = [
      { id: 'node_school', label: 'School', type: 'setting', scale: 'micro' },
      { id: 'node_family', label: 'Family', type: 'family', scale: 'micro' },
    ];
    const ollamaRequest = vi.fn(async () => ({
      suggestion: {
        guidance: [{ point: 'Institutions sit behind the mapped settings.' }],
        nodes: [
          { label: 'Google Identity Service', type: 'service', scale: 'exosphere', evidence: 'Verify: who operates the sign-in the school requires?', basis: 'inference' },
          { label: 'Printing Vendor Corporation', type: 'organization', scale: 'exosphere', evidence: 'The memo names the vendor.' },
        ],
        connections: [
          { source: 'Google Identity Service', target: 'School', verb: 'sets rules for', rationale: 'Sign-in policy governs the portal.' },
          // An off-register verb has no place here, so the connection drops.
          { source: 'Google Identity Service', target: 'Family', verb: 'synergizes', rationale: 'Register violation.' },
          // Near-register verbs coerce to their canonical entry.
          { source: 'Google Identity Service', target: 'School', verb: 'oversees', rationale: 'Alias resolves to regulates.' },
          // A pathway between two floating new nodes never lands on the map.
          { source: 'Google Identity Service', target: 'Printing Vendor Corporation', verb: 'funds', rationale: 'No carried anchor.' },
        ],
        example: null,
        readiness: { ready: true, note: 'Pathways land on the map.' },
      },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'exosphere-register.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    const studentCookie = await grantStudent();
    const evaluation = await evaluate(studentCookie, submissionBody({ activeScale: 'exosphere', carriedNodes }));
    expect(evaluation.review.nodes).toEqual([
      { label: 'Google Identity Service', type: 'service', scale: 'exosphere', evidence: 'Verify: who operates the sign-in the school requires?', basis: 'inference' },
      { label: 'Printing Vendor Corporation', type: 'organization', scale: 'exosphere', evidence: 'The memo names the vendor.', basis: 'memo' },
    ]);
    expect(evaluation.review.connections).toEqual([
      { source: 'Google Identity Service', target: 'node_school', sourceLabel: 'Google Identity Service', targetLabel: 'School', verb: 'sets rules for', rationale: 'Sign-in policy governs the portal.' },
      { source: 'Google Identity Service', target: 'node_school', sourceLabel: 'Google Identity Service', targetLabel: 'School', verb: 'regulates', rationale: 'Alias resolves to regulates.' },
    ]);
  });

  it('returns Macrosphere structures with resolved scopes and deontic verbs, never connections', async () => {
    await system.close();
    const carriedNodes = [
      { id: 'node_school', label: 'School', type: 'setting', scale: 'micro' },
      { id: 'node_family', label: 'Family', type: 'family', scale: 'micro' },
      { id: 'node_agency', label: 'Agency', type: 'agency', scale: 'exosphere' },
    ];
    const ollamaRequest = vi.fn(async () => ({
      suggestion: {
        guidance: [{ point: 'One structure conditions several mapped elements.' }],
        nodes: [
          {
            label: 'Universal Pre-K Law', type: 'law', scale: 'macrosphere',
            evidence: 'Eligibility rules recur across the memo.', basis: 'memo',
            deontic: 'defines eligibility for',
            scope: ['School', 'node_family', 'Unknown Thing', 'School'],
          },
          {
            label: 'Gendered Planning Norms', type: 'belief', scale: 'macrosphere',
            evidence: 'Verify: who is assumed to plan?', basis: 'inference',
            // A condition with only one affected element is incomplete and drops.
            deontic: 'synergizes',
            scope: [{ id: 'node_agency', label: 'Agency' }],
          },
          {
            label: 'CUNY', type: 'structure', scale: 'macrosphere',
            evidence: 'CUNY is a named institution and must remain in Exosphere.', basis: 'memo',
            deontic: 'shapes',
            scope: ['node_school', 'node_family'],
          },
        ],
        // Any macro connection is scale confusion; the server never passes one through.
        connections: [
          { source: 'Universal Pre-K Law', target: 'School', verb: 'shapes', rationale: 'Must be dropped.' },
        ],
        example: null,
        readiness: { ready: true, note: 'One structure has a scope.' },
      },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'macrosphere-scopes.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    const studentCookie = await grantStudent();
    const evaluation = await evaluate(studentCookie, submissionBody({ activeScale: 'macrosphere', carriedNodes }));
    expect(evaluation.review.connections).toEqual([]);
    expect(evaluation.review.nodes).toEqual([
      {
        label: 'Universal Pre-K Law', type: 'law', scale: 'macrosphere',
        evidence: 'Eligibility rules recur across the memo.', basis: 'memo',
        deontic: 'defines eligibility for',
        scope: [{ id: 'node_school', label: 'School' }, { id: 'node_family', label: 'Family' }],
      },
    ]);

    // The stored review replays scope pairs without carried context.
    const readBack = await system.app.request('http://127.0.0.1:4177/api/preflight/evaluations/current', {
      headers: { origin: 'http://127.0.0.1:4177', 'sec-fetch-site': 'same-origin', cookie: studentCookie },
    });
    if (readBack.status === 200) {
      const stored = (await readBack.json()).evaluation;
      expect(stored.review.nodes).toEqual(evaluation.review.nodes);
      expect(stored.review.connections).toEqual([]);
    }
  });

  it('removes retired interface language from generated labels and student-facing review prose at every level', async () => {
    await system.close();
    const carriedNodes = [
      { id: 'node_classroom', label: 'Classroom', type: 'setting', scale: 'micro' },
      { id: 'node_workplace', label: 'Workplace', type: 'setting', scale: 'micro' },
    ];
    const suggestions = {
      micro: {
        nodes: [
          { label: 'Has energy', type: 'person', scale: 'micro', evidence: 'Discard this category.' },
          { label: 'Maya Rivera', type: 'person', scale: 'micro', evidence: 'The memo names Maya.' },
          { label: 'Classroom', type: 'setting', scale: 'micro', evidence: 'The memo names a classroom.' },
        ],
      },
      meso: {
        nodes: [
          { label: 'Pattern with no door', type: 'mesosystem', scale: 'meso', evidence: 'Discard this category.', scope: ['node_classroom', 'node_workplace'] },
          { label: 'classroom–workplace transition planning', type: 'mesosystem', scale: 'meso', evidence: 'The memo connects both settings through transition planning.', scope: ['node_classroom', 'node_workplace'] },
        ],
      },
      exosphere: {
        nodes: [
          { label: 'This Ring Holds Services Office', type: 'institution', scale: 'exosphere', evidence: 'Discard this category.', basis: 'inference' },
          { label: 'East Harlem Disability Services Office', type: 'institution', scale: 'exosphere', evidence: 'The memo names the office.', basis: 'memo' },
        ],
      },
      macrosphere: {
        nodes: [
          { label: 'Patterns without a door', type: 'structure', scale: 'macrosphere', evidence: 'Discard this category.', basis: 'inference', deontic: 'shapes', scope: ['node_classroom', 'node_workplace'] },
          { label: 'Inaccessible transit policy', type: 'policy', scale: 'macrosphere', evidence: 'The memo describes a transit barrier.', basis: 'memo', deontic: 'constrains', scope: ['node_classroom', 'node_workplace'] },
        ],
      },
    };
    const ollamaRequest = vi.fn(async ({ activeScale }) => ({
      suggestion: {
        guidance: [
          { point: 'Ripples outward across the map.' },
          { point: 'Review the supported people, settings, and conditions.' },
        ],
        nodes: suggestions[activeScale].nodes,
        connections: [],
        example: 'This ring holds the relevant items.',
        readiness: { ready: true, note: 'Never in the room, but still influential.' },
      },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'retired-interface-language.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    const studentCookie = await grantStudent();
    const reviews = {};
    for (const activeScale of ['micro', 'meso', 'exosphere', 'macrosphere']) {
      reviews[activeScale] = (await evaluate(studentCookie, submissionBody({
        activeScale,
        ...(activeScale === 'micro' ? {} : { carriedNodes }),
      }))).review;
    }

    expect(reviews.micro.nodes.map(({ label }) => label)).toEqual(['Maya Rivera', 'Classroom']);
    expect(reviews.meso.nodes.map(({ label }) => label)).toEqual(['classroom–workplace transition planning']);
    expect(reviews.exosphere.nodes.map(({ label }) => label)).toEqual(['East Harlem Disability Services Office']);
    expect(reviews.macrosphere.nodes.map(({ label }) => label)).toEqual(['Inaccessible transit policy']);
    expect(reviews.micro.guidance).toEqual([{ point: 'Review the supported people, settings, and conditions.' }]);
    expect(reviews.exosphere.example).toBeNull();
    expect(reviews.macrosphere.example).toBeNull();
    expect(reviews.micro.readiness.note).toBe('');
    expect(reviews.exosphere.readiness.note).toBe('');
    expect(reviews.macrosphere.readiness.note).toBe('');
    expect(JSON.stringify(reviews)).not.toMatch(/stuck|has energy|ripples? outward|in the room|ring holds|patterns? (?:with no|without)|doorless/i);
  });

  it('removes setting-to-setting connections from a Micro review before the project can save them', async () => {
    await system.close();
    const ollamaRequest = vi.fn(async () => ({
      suggestion: {
        guidance: [],
        nodes: [
          { label: 'Participant A', type: 'person', scale: 'micro', evidence: 'The memo names Participant A.' },
          { label: 'Family apartment', type: 'setting', scale: 'micro', evidence: 'Participant A lives in the apartment.' },
          { label: 'Transition classroom', type: 'setting', scale: 'micro', evidence: 'Participant A attends the classroom.' },
        ],
        connections: [
          { source: 'Family apartment', target: 'Transition classroom', verb: 'coordinates access with', rationale: 'This belongs at Meso.' },
          { source: 'Participant A', target: 'Transition classroom', verb: 'attends', rationale: 'The memo directly supports attendance.' },
        ],
        example: null,
        readiness: { ready: true, note: 'The memo supports Micro mapping.' },
      },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'micro-setting-edge-filter.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    const studentCookie = await grantStudent();
    const review = (await evaluate(studentCookie, submissionBody())).review;

    expect(review.connections).toEqual([expect.objectContaining({
      sourceLabel: 'Participant A',
      targetLabel: 'Transition classroom',
      verb: 'attends',
    })]);
  });

  it('uses student wording and current Teacher Console settings to suggest map connections without applying or storing them', async () => {
    const localCookie = await grantStudent();
    const unavailable = await postJson(system.app, '/api/map/connections', connectionBody(), { cookie: localCookie });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: 'Connection suggestions are not available for this class.' });

    await system.close();
    const ollamaRequest = vi.fn(async () => ({
      suggestion: {
        connections: [{
          source: 'node_school',
          target: 'node_agency',
          verb: 'refers to',
          rationale: 'The student already described this connection.',
        }, {
          source: 'node_family',
          target: 'node_school',
          verb: 'asks for help from',
          rationale: 'The student says families ask schools for help.',
        }],
      },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    }));
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'connection-suggestions.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' },
      ollamaRequest,
    });
    const courseProgression = structuredClone(DEFAULT_TEACHING_PROFILE);
    courseProgression.parts[0].stages['choose-what-to-map'] = {
      guidance: 'For this session, focus suggestions on delays, handoffs, and paths to help.',
      materials: 'Use the assigned class discussion about referral handoffs as background only.',
    };
    system.db.prepare(`
      UPDATE teaching_profiles
      SET profile_json = ?, fingerprint = ?
      WHERE id = 'systems-mapping-default'
    `).run(JSON.stringify(courseProgression), teachingProfileFingerprint(courseProgression));

    expect((await postJson(system.app, '/api/map/connections', connectionBody())).status).toBe(401);
    const studentCookie = await grantStudent();
    const body = connectionBody({ activeScale: 'micro' });
    const response = await postJson(system.app, '/api/map/connections', body, { cookie: studentCookie });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      connections: [{
        source: 'node_family',
        target: 'node_school',
        verb: 'asks for help from',
        rationale: 'The student says families ask schools for help.',
      }],
    });
    expect(ollamaRequest).toHaveBeenCalledTimes(1);
    const mesoRequest = await postJson(system.app, '/api/map/connections', connectionBody(), { cookie: studentCookie });
    expect(mesoRequest.status).toBe(400);
    expect(await mesoRequest.json()).toEqual({ error: 'Meso shows how Micro settings relate to one another. Add direct connections at Micro.' });
    const input = ollamaRequest.mock.calls[0][0];
    expect(input.systemPrompt).toContain('[Part 1. Current section. choose map elements]');
    expect(input.systemPrompt).toContain(courseProgression.parts[0].stages['choose-what-to-map'].guidance);
    expect(input.systemPrompt).toContain(courseProgression.parts[0].stages['choose-what-to-map'].materials);
    expect(input.systemPrompt).toContain(body.projectOverlay.customInstructions);
    expect(input.systemPrompt).toContain('MAP CONNECTION JSON CONTRACT');
    expect(input.sourceMetadata).toEqual({ nodes: body.nodes, existingConnections: body.relationships });
    expect(input.sourceText).toBe(body.prompt);
    expect(input.inquiry).toBe(body.inquiry);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_evaluations').get().count).toBe(0);
    expect(JSON.stringify(system.db.prepare('SELECT * FROM prototype_events').all())).not.toContain(body.prompt);
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
      suggestion: memoReviewFixture(),
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    });
    expect((await firstRequest).status).toBe(201);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_evaluations').get().count).toBe(1);
  });

  it('keeps only the newest review capability active without blocking later scales or cycles', async () => {
    const studentCookie = await grantStudent();
    const scales = ['micro', 'meso', 'exosphere', 'macrosphere', 'micro', 'meso'];
    const evaluations = [];
    for (const [index, activeScale] of scales.entries()) {
      evaluations.push(await evaluate(studentCookie, submissionBody({
        activeScale,
        projectMetadata: { projectId: `cycle_${index}`, title: `Cycle ${index + 1}` },
      })));
    }

    expect(evaluations).toHaveLength(scales.length);
    const rows = system.db.prepare(`
      SELECT id, consumed_at AS consumedAt FROM preflight_evaluations ORDER BY created_at, id
    `).all();
    expect(rows).toHaveLength(scales.length);
    expect(rows.filter(({ consumedAt }) => consumedAt === null)).toHaveLength(1);
    expect(rows.find(({ id }) => id === evaluations.at(-1).id)?.consumedAt).toBeNull();
    expect(rows.filter(({ id }) => id !== evaluations.at(-1).id).every(({ consumedAt }) => consumedAt !== null)).toBe(true);
  });

  it('does not impose a course-wide active-evaluation ceiling across student sessions', async () => {
    await system.close();
    system = createSystemsMappingApp({
      dbPath: join(tempDirectory, 'evaluation-no-course-cap.sqlite'),
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      // This retired option deliberately proves that an earlier one-item cap
      // cannot reappear as a workflow gate.
      preflightMaxActiveEvaluationsTotal: 1,
    });
    const firstStudent = await grantStudent();
    const secondStudent = await grantStudent();
    expect((await evaluate(firstStudent, submissionBody({ projectMetadata: { projectId: 'no_cap_one' } }))).id).toBeTruthy();
    expect((await evaluate(secondStudent, submissionBody({ projectMetadata: { projectId: 'no_cap_two' } }))).id).toBeTruthy();
    expect(system.db.prepare(`
      SELECT COUNT(*) AS count FROM preflight_evaluations
      WHERE consumed_at IS NULL AND expires_at > ?
    `).get(currentTime).count).toBe(2);
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
      sourceMaterial: 'UNIQUE EXPIRED PENDING MEMO CONTENT',
      studentAnnotation: 'UNIQUE EXPIRED PENDING NOTE',
    }));
    const oldDecided = await submit(studentCookie, submissionBody({
      projectMetadata: { projectId: 'old_decided_project', title: 'Expired decided snapshot' },
      sourceMaterial: 'UNIQUE EXPIRED DECIDED MEMO CONTENT',
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
      sourceMaterial: 'CURRENT MEMO CONTENT',
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
    expect(serializedAudit).not.toContain('MEMO CONTENT');
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
      guidance: expect.any(Array),
      nodes: expect.any(Array),
      connections: expect.any(Array),
      readiness: expect.objectContaining({ ready: expect.any(Boolean) }),
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
      submissionBody({ sourceRecord: { ...submissionBody().sourceRecord, id: undefined } }),
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
      studentAnnotation: 'Near-limit memo details.',
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
    expect(summaries[0].coursePart).toEqual({ id: 'part-1', label: 'Part 1', scaleIds: ['micro', 'meso'] });
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
          guidance: expect.any(Array),
          nodes: expect.any(Array),
          connections: expect.any(Array),
          readiness: expect.objectContaining({ ready: expect.any(Boolean) }),
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
      { decision: 'revise_and_approve', instructorAnnotation: 'Use this.', focusedQuestion: memoReviewFixture(), expectedRevision: 1 },
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
