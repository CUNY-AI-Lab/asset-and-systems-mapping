// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createSystemsMappingApp } from './app.js';

const ORIGIN = 'https://mapping.example.edu';
const JSON_HEADERS = { 'content-type': 'application/json' };
const HOSTED_CLASS_CODE = 'CALI2026Map7Qv9Wx3Z';
const RETENTION_DAYS = { evaluation: 1, pending: 30, decided: 180 };
const SUGGESTION_RUNTIME = { provider: 'deterministic', model: 'STEM Splitter' };

function hostedRequest(system, path, options = {}) {
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

function postJson(system, path, body, options = {}) {
  return hostedRequest(system, path, {
    ...options,
    method: 'POST',
    headers: { ...JSON_HEADERS, ...(options.headers || {}) },
    body: JSON.stringify(body),
  });
}

function createHosted(options = {}) {
  return createSystemsMappingApp({
    dbPath: ':memory:',
    hostedMode: true,
    publicOrigin: ORIGIN,
    trustedProxyHops: 1,
    classCode: HOSTED_CLASS_CODE,
    teacherBootstrapToken: 'operator-controlled-bootstrap',
    teacherAttemptLimit: 2,
    ...options,
  });
}

function hostedSubmission() {
  return {
    projectMetadata: { projectId: 'hosted-project', title: 'Hosted review snapshot' },
    activeScale: 'micro',
    stageId: 'review-suggestions',
    inquiry: 'How does the hosted course review preserve feedback?',
    sourceRecord: {
      id: 'hosted-source',
      title: 'Hosted source',
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
    studentAnnotation: 'Review this handoff.',
    projectOverlay: {
      id: 'hosted-overlay',
      profileVersion: '1.0.0',
      outputSchemaVersion: 'systems-mapping.preflight-result.v1',
      label: 'Hosted preflight',
      provider: 'local-deterministic',
      baseModel: 'STEM Splitter',
      customInstructions: 'Ask one repair question at a time.',
      contextLimit: 32_000,
      confidenceThreshold: 0.72,
      relationVocabulary: ['provides', 'refers', 'shapes'],
      revision: 1,
      fingerprint: 'hosted-overlay-fingerprint',
    },
  };
}

describe('hosted runtime guardrails', () => {
  it('requires an explicit HTTPS origin and exact public Host/Origin', async () => {
    expect(() => createSystemsMappingApp({ dbPath: ':memory:', hostedMode: true }))
      .toThrow('Hosted mode requires an HTTPS publicOrigin');
    expect(() => createSystemsMappingApp({ dbPath: ':memory:', hostedMode: true, publicOrigin: 'http://mapping.example.edu' }))
      .toThrow('Hosted mode requires an HTTPS publicOrigin');
    expect(() => createHosted({ classCode: undefined })).toThrow('Hosted mode requires an explicit classCode');
    expect(() => createHosted({ classCode: '101' })).toThrow('Hosted mode requires an explicit classCode');
    expect(() => createHosted({ classCode: 'aaaaaaaaaa' })).toThrow('Hosted mode requires an explicit classCode');
    expect(() => createHosted({ publicDemo: true, classCode: HOSTED_CLASS_CODE })).toThrow('Hosted mode requires an explicit classCode');

    const publicDemo = createHosted({ publicDemo: true, classCode: '101' });
    try {
      expect((await postJson(publicDemo, '/api/student/access', { code: '101' })).status).toBe(201);
    } finally {
      await publicDemo.close();
    }

    const system = createHosted();
    try {
      expect((await hostedRequest(system, '/api/health')).status).toBe(200);
      expect(await (await hostedRequest(system, '/api/auth/accounts')).json()).toEqual({
        teacherAccess: { mode: 'manual', claimEnabled: true },
        runtime: {
          persistence: 'course-server', hosted: true, retentionDays: RETENTION_DAYS,
          suggestionRuntime: SUGGESTION_RUNTIME,
        },
      });
      expect((await hostedRequest(system, '/api/auth/logout', {
        method: 'POST', headers: { origin: 'https://attacker.invalid' },
      })).status).toBe(403);
      expect((await hostedRequest(system, '/api/health', {
        headers: { host: 'attacker.invalid' },
      })).status).toBe(200);
      expect((await hostedRequest(system, '/api/health', {
        headers: { 'x-forwarded-proto': 'http' },
      })).status).toBe(200);
      expect((await hostedRequest(system, '/api/auth/accounts', {
        headers: { host: 'attacker.invalid' },
      })).status).toBe(421);
    } finally {
      await system.close();
    }
  });

  it('enables Secure hosted class sessions with bounded activity and minimized preflight persistence', async () => {
    const system = createHosted();
    try {
      const access = await postJson(system, '/api/student/access', { code: HOSTED_CLASS_CODE });
      expect(access.status).toBe(201);
      expect(await access.json()).toEqual({
        access: {
          expiresAt: expect.any(String), persistence: 'course-server', retentionDays: RETENTION_DAYS,
          suggestionRuntime: SUGGESTION_RUNTIME,
        },
      });
      expect(access.headers.get('set-cookie')).toContain('Secure');
      expect(access.headers.get('set-cookie')).toContain('HttpOnly');
      expect(access.headers.get('set-cookie')).toContain('SameSite=Strict');
      expect(access.headers.get('set-cookie')).not.toContain(HOSTED_CLASS_CODE);
      const cookie = access.headers.get('set-cookie').split(';')[0];
      expect(await (await hostedRequest(system, '/api/student/session', { headers: { cookie } })).json()).toEqual({
        access: {
          expiresAt: expect.any(String), persistence: 'course-server', retentionDays: RETENTION_DAYS,
          suggestionRuntime: SUGGESTION_RUNTIME,
        },
      });
      const publicConfig = await hostedRequest(system, '/api/config/public?configKind=preflight&scale=micro', {
        headers: { cookie },
      });
      expect(publicConfig.status).toBe(200);
      expect(await publicConfig.json()).toMatchObject({ configKind: 'preflight', scale: 'micro' });
      const activity = await postJson(system, '/api/prototype/events', {
        event: 'stage_viewed', stage: 'Review suggestions', metadata: { stageIndex: 1 },
      }, { headers: { cookie } });
      expect(activity.status).toBe(202);
      expect(await activity.json()).toEqual({ accepted: true });
      const { studentAnnotation, ...evaluationBody } = hostedSubmission();
      const evaluated = await postJson(system, '/api/preflight/evaluations', evaluationBody, {
        headers: { cookie },
      });
      expect(evaluated.status).toBe(201);
      const evaluation = (await evaluated.json()).evaluation;
      expect(evaluation).toMatchObject({
        runtime: { provider: 'deterministic', model: 'STEM Splitter' },
        review: expect.objectContaining({
          guidance: expect.any(Array),
          nodes: expect.any(Array),
          connections: expect.any(Array),
        }),
      });
      expect(evaluation).not.toHaveProperty('suggestion');
      expect(evaluation.configSnapshot.projectOverlay).not.toHaveProperty('customInstructions');
      const submitted = await postJson(system, '/api/preflight/submissions', {
        evaluationId: evaluation.id,
        studentAnnotation,
      }, { headers: { cookie } });
      expect(submitted.status).toBe(201);
      const record = (await submitted.json()).submission;
      expect(record).toMatchObject({ projectId: 'hosted-project', status: 'pending', revision: 1 });
      expect(record).not.toHaveProperty('sourceMaterial');
      expect(record).not.toHaveProperty('suggestion');
      expect(record).not.toHaveProperty('configSnapshot');
      expect((await hostedRequest(system, `/api/preflight/submissions/${record.id}`, {
        headers: { cookie },
      })).status).toBe(200);
      const logout = await postJson(system, '/api/student/logout', {}, { headers: { cookie } });
      expect(logout.status).toBe(200);
      expect(logout.headers.get('set-cookie')).toContain('Secure');
      expect(await (await hostedRequest(system, '/api/student/session', { headers: { cookie } })).json()).toEqual({ access: null });
      expect(system.db.prepare('SELECT COUNT(*) AS count FROM student_sessions').get().count).toBe(0);
      expect(system.db.prepare(`
        SELECT COUNT(*) AS count FROM prototype_events WHERE event_name = 'stage_viewed'
      `).get().count).toBe(1);
      expect(system.db.prepare(`
        SELECT stage, metadata_json AS metadata
        FROM prototype_events WHERE event_name = 'stage_viewed'
      `).get()).toEqual({ stage: 1, metadata: '{"stageIndex":1}' });
      expect(JSON.stringify(system.db.prepare('SELECT * FROM prototype_events').all())).not.toContain('Review this handoff.');
      expect(system.db.prepare('SELECT COUNT(*) AS count FROM preflight_submissions').get().count).toBe(1);
      expect(JSON.stringify(system.db.prepare('SELECT * FROM preflight_evaluations').all()))
        .not.toContain(hostedSubmission().projectOverlay.customInstructions);
    } finally {
      await system.close();
    }
  });

  it('forces Secure teacher cookies and keeps public configuration behind teacher authentication', async () => {
    const system = createHosted();
    try {
      expect((await hostedRequest(system, '/api/config/public')).status).toBe(401);
      const claim = await postJson(system, '/api/auth/claim', {
        userId: 'zach-muhlbauer',
        passphrase: 'a hosted teacher phrase',
        bootstrapToken: 'operator-controlled-bootstrap',
      });
      expect(claim.status).toBe(201);
      expect(claim.headers.get('set-cookie')).toContain('Secure');
      expect(claim.headers.get('set-cookie')).toContain('HttpOnly');
      expect(claim.headers.get('set-cookie')).toContain('SameSite=Strict');
      const cookie = claim.headers.get('set-cookie').split(';')[0];
      expect((await hostedRequest(system, '/api/config/public', { headers: { cookie } })).status).toBe(200);
      const reviewQueue = await hostedRequest(system, '/api/teacher/preflight-submissions', { headers: { cookie } });
      expect(reviewQueue.status).toBe(200);
      expect(await reviewQueue.json()).toEqual({ submissions: [] });
    } finally {
      await system.close();
    }
  });

  it('keys hosted authentication limits by the proxy-vetted client address', async () => {
    const system = createHosted();
    try {
      const attempt = (prefix, actual) => postJson(system, '/api/auth/login', {
        userId: 'zach-muhlbauer', passphrase: 'a wrong hosted phrase',
      }, { headers: { 'x-forwarded-for': `${prefix}, ${actual}` } });
      expect((await attempt('198.51.100.1', '203.0.113.40')).status).toBe(401);
      expect((await attempt('198.51.100.2', '203.0.113.40')).status).toBe(429);
      expect((await attempt('198.51.100.2', '203.0.113.41')).status).toBe(401);
    } finally {
      await system.close();
    }
  });

  it('rate-limits successful hosted class-session issuance by the proxy-vetted client', async () => {
    const system = createHosted({ studentSessionIssueLimit: 2, studentSessionIssueWindowMs: 60_000 });
    try {
      const access = (spoofedPrefix) => postJson(system, '/api/student/access', {
        code: HOSTED_CLASS_CODE,
      }, { headers: { 'x-forwarded-for': `${spoofedPrefix}, 203.0.113.90` } });
      expect((await access('198.51.100.1')).status).toBe(201);
      expect((await access('198.51.100.2')).status).toBe(201);
      const limited = await access('198.51.100.3');
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBe('60');
      expect(system.db.prepare('SELECT COUNT(*) AS count FROM student_sessions').get().count).toBe(2);
    } finally {
      await system.close();
    }
  });
});
