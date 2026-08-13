// @vitest-environment node

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDENT_SESSION_COOKIE, TEACHER_SESSION_COOKIE } from './auth.js';
import { createSystemsMappingApp } from './app.js';
import { assertDatabaseIntegrity, inTransaction, prototypeEventAudit } from './database.js';

const BASE_URL = 'http://127.0.0.1:4177';
const BOOTSTRAP_TOKEN = 'operator-only-bootstrap-token';
const TEACHER_PASSPHRASE = 'locally chosen phrase';
const JSON_HEADERS = { 'content-type': 'application/json' };
const RETENTION_DAYS = { evaluation: 1, pending: 30, decided: 180 };
const SUGGESTION_RUNTIME = { provider: 'deterministic', model: 'STEM Splitter' };

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

function putJson(app, path, body, { cookie, headers, ...options } = {}) {
  return browserRequest(app, path, {
    method: 'PUT',
    ...options,
    headers: { ...JSON_HEADERS, ...(cookie ? { cookie } : {}), ...(headers || {}) },
    body: JSON.stringify(body),
  });
}

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';')[0];
}

function cookieValue(cookie) {
  return cookie?.slice(cookie.indexOf('=') + 1);
}

async function json(response) {
  return response.json();
}

describe('hardened Systems Mapping server', () => {
  let currentTime;
  let databasePath;
  let tempDirectory;
  let system;

  beforeEach(() => {
    currentTime = 1_800_000_000_000;
    tempDirectory = mkdtempSync(join(tmpdir(), 'systems-mapping-server-'));
    databasePath = join(tempDirectory, 'test.sqlite');
    system = createSystemsMappingApp({
      dbPath: databasePath,
      now: () => currentTime,
      sessionTtlMs: 60_000,
      studentSessionTtlMs: 10_000,
      studentAttemptLimit: 3,
      studentAttemptWindowMs: 10_000,
      teacherAttemptLimit: 3,
      teacherAttemptWindowMs: 10_000,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      prototypeEventLimit: 12,
      prototypeEventWindowMs: 10_000,
      prototypeMaxRows: 12,
      prototypeRetentionMs: 60_000,
      healthCheckTimeoutMs: 25,
    });
  });

  afterEach(() => {
    system.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  async function claimTeacher(accountId = 'zach-muhlbauer') {
    const response = await postJson(system.app, '/api/auth/claim', {
      userId: accountId,
      passphrase: TEACHER_PASSPHRASE,
      bootstrapToken: BOOTSTRAP_TOKEN,
    });
    expect(response.status).toBe(201);
    return cookieFrom(response);
  }

  async function grantStudent() {
    const response = await postJson(system.app, '/api/student/access', { code: '101' });
    expect(response.status).toBe(201);
    return cookieFrom(response);
  }

  it('publishes no teacher roster, prompt text, class code, or private account state', async () => {
    const bootstrapResponse = await request(system.app, '/api/auth/accounts');
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = await json(bootstrapResponse);
    expect(bootstrap).toEqual({
      teacherAccess: { mode: 'manual', claimEnabled: true },
      runtime: {
        persistence: 'local-server', hosted: false, retentionDays: RETENTION_DAYS, suggestionRuntime: SUGGESTION_RUNTIME,
      },
    });
    const serializedBootstrap = JSON.stringify(bootstrap);
    expect(serializedBootstrap).not.toContain('Zach');
    expect(serializedBootstrap).not.toContain('Maria');
    expect(serializedBootstrap).not.toContain(BOOTSTRAP_TOKEN);

    const unauthenticated = await request(system.app, '/api/config/public?configKind=preflight&scale=micro');
    expect(unauthenticated.status).toBe(401);

    const studentCookie = await grantStudent();
    const publicResponse = await request(system.app, '/api/config/public?configKind=preflight&scale=micro', {
      headers: { cookie: studentCookie },
    });
    expect(publicResponse.status).toBe(200);
    const snapshot = await json(publicResponse);
    expect(Object.keys(snapshot).sort()).toEqual([
      'configKind', 'courseParts', 'fingerprint', 'guardrailsFingerprint', 'moduleVersions', 'revision', 'scale', 'stageId',
    ]);
    expect(snapshot).toMatchObject({ configKind: 'preflight', scale: 'micro', stageId: 'review-suggestions', revision: 1 });
    expect(snapshot.courseParts).toEqual([
      { id: 'part-1', label: 'Part 1', scaleIds: ['micro', 'meso'] },
      { id: 'part-2', label: 'Part 2', scaleIds: ['macro', 'integration'] },
    ]);
    expect(snapshot.moduleVersions).toHaveLength(13);
    expect(snapshot.moduleVersions.at(-1).id).toBe('teaching-profile.systems-mapping-default');
    expect(snapshot).not.toHaveProperty('effectivePrompt');
    expect(snapshot).not.toHaveProperty('fixedGuardrails');
    expect(snapshot).not.toHaveProperty('modules');
    expect(JSON.stringify(snapshot)).not.toContain('Zach Muhlbauer');
    expect(JSON.stringify(snapshot)).not.toContain('Maria Mavrides Calderon');
  });

  it('reports database-backed readiness and bounds unavailable health checks', async () => {
    expect(await json(await request(system.app, '/api/health'))).toEqual({ status: 'ok' });
    const originalHealthCheck = system.db.healthCheck;
    try {
      system.db.healthCheck = () => false;
      const unavailable = await request(system.app, '/api/health');
      expect(unavailable.status).toBe(503);
      expect(await json(unavailable)).toEqual({ status: 'unavailable' });

      system.db.healthCheck = () => new Promise(() => {});
      const startedAt = performance.now();
      const timedOut = await request(system.app, '/api/health');
      expect(timedOut.status).toBe(503);
      expect(performance.now() - startedAt).toBeLessThan(500);

      system.db.healthCheck = async () => { throw new Error('injected outage'); };
      expect((await request(system.app, '/api/health')).status).toBe(503);
    } finally {
      system.db.healthCheck = originalHealthCheck;
    }
  });

  it('serializes unrelated async SQLite transactions across rollback boundaries', async () => {
    await system.ready;
    system.db.exec('CREATE TEMP TABLE transaction_probe (id INTEGER PRIMARY KEY) STRICT');
    let releaseFirst;
    let markFirstEntered;
    const firstEntered = new Promise((resolve) => { markFirstEntered = resolve; });
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const first = inTransaction(system.db, async () => {
      system.db.prepare('INSERT INTO transaction_probe (id) VALUES (?)').run(1);
      markFirstEntered();
      await firstGate;
      throw new Error('injected first transaction rollback');
    });
    await firstEntered;

    let secondResolved = false;
    const second = inTransaction(system.db, async () => {
      system.db.prepare('INSERT INTO transaction_probe (id) VALUES (?)').run(2);
      return 'second committed';
    }).then((value) => {
      secondResolved = true;
      return value;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    releaseFirst();
    await expect(first).rejects.toThrow('injected first transaction rollback');
    await expect(second).resolves.toBe('second committed');
    expect(system.db.prepare('SELECT id FROM transaction_probe ORDER BY id').all()).toEqual([{ id: 2 }]);
  });

  it('issues a distinct opaque student session, restores it, expires it, and logs out cleanly', async () => {
    expect(await json(await request(system.app, '/api/student/session'))).toEqual({ access: null });

    const accessResponse = await postJson(system.app, '/api/student/access', { code: '101' });
    expect(accessResponse.status).toBe(201);
    const expectedExpiry = new Date(currentTime + 10_000).toISOString();
    expect(await json(accessResponse)).toEqual({
      access: {
        expiresAt: expectedExpiry, persistence: 'local-server', retentionDays: RETENTION_DAYS,
        suggestionRuntime: SUGGESTION_RUNTIME,
      },
    });
    const setCookie = accessResponse.headers.get('set-cookie');
    const cookie = cookieFrom(accessResponse);
    expect(cookie).toMatch(new RegExp(`^${STUDENT_SESSION_COOKIE}=[A-Za-z0-9_-]{43}$`));
    expect(cookie).not.toContain('101');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/api');
    expect(setCookie).toContain('Priority=High');
    expect(setCookie).not.toContain(TEACHER_SESSION_COOKIE);

    const token = cookieValue(cookie);
    const stored = system.db.prepare('SELECT token_hash AS tokenHash FROM student_sessions').get();
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));

    const status = await request(system.app, '/api/student/session', { headers: { cookie } });
    expect(await json(status)).toEqual({
      access: {
        expiresAt: expectedExpiry, persistence: 'local-server', retentionDays: RETENTION_DAYS,
        suggestionRuntime: SUGGESTION_RUNTIME,
      },
    });
    expect((await json(await request(system.app, '/api/auth/me', { headers: { cookie } }))).user).toBeNull();
    expect((await request(system.app, '/api/teacher/modules', { headers: { cookie } })).status).toBe(401);

    currentTime += 10_001;
    expect(await json(await request(system.app, '/api/student/session', { headers: { cookie } }))).toEqual({ access: null });
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM student_sessions').get().count).toBe(0);
    expect((await request(system.app, '/api/config/public', { headers: { cookie } })).status).toBe(401);

    const freshCookie = await grantStudent();
    const logout = await browserRequest(system.app, '/api/student/logout', {
      method: 'POST', headers: { cookie: freshCookie },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toContain(`${STUDENT_SESSION_COOKIE}=;`);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM student_sessions').get().count).toBe(0);
  });

  it('throttles class-code failures deterministically without storing or echoing attempted codes', async () => {
    for (const [index, attemptedCode] of ['wrong-one', 'wrong-two', 'wrong-three'].entries()) {
      const response = await postJson(system.app, '/api/student/access', { code: attemptedCode });
      expect(response.status).toBe(index === 2 ? 429 : 401);
      expect(JSON.stringify(await json(response))).not.toContain(attemptedCode);
      if (index === 2) {
        expect(response.headers.get('retry-after')).toBe('10');
        expect((await json(await postJson(system.app, '/api/student/access', { code: '101' }))).error)
          .toContain('Too many class-code attempts');
      }
    }
    const events = system.db.prepare(`
      SELECT session_kind AS sessionKind, session_ref AS sessionRef, event_name AS event,
        metadata_json AS metadata FROM prototype_events ORDER BY id
    `).all();
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.sessionKind === 'access_attempt' && event.event === 'class_access_failed')).toBe(true);
    expect(events.every((event) => /^[a-f0-9]{16}$/.test(event.sessionRef))).toBe(true);
    expect(events.map((event) => event.metadata)).toEqual([
      '{"throttled":false}', '{"throttled":false}', '{"throttled":true}',
    ]);
    expect(JSON.stringify(events)).not.toContain('wrong-');
    expect(events[0].sessionRef).not.toBe(createHash('sha256').update(BASE_URL).digest('hex').slice(0, 16));

    currentTime += 10_001;
    expect((await postJson(system.app, '/api/student/access', { code: 'still-wrong' })).status).toBe(401);
    expect((await postJson(system.app, '/api/student/access', { code: '101' })).status).toBe(201);
  });

  it('cannot evade student or teacher throttles by varying an attacker-controlled loopback Host port', async () => {
    const mutationAtPort = (port, path, body) => {
      const origin = `http://127.0.0.1:${port}`;
      return system.app.request(`${origin}${path}`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, origin },
        body: JSON.stringify(body),
      });
    };

    const studentStatuses = [];
    for (const port of [4101, 4102, 4103]) {
      studentStatuses.push((await mutationAtPort(port, '/api/student/access', { code: 'wrong' })).status);
    }
    expect(studentStatuses).toEqual([401, 401, 429]);

    const teacherStatuses = [];
    for (const port of [4201, 4202, 4203]) {
      teacherStatuses.push((await mutationAtPort(port, '/api/auth/login', {
        userId: 'zach-muhlbauer', passphrase: 'short',
      })).status);
    }
    expect(teacherStatuses).toEqual([401, 401, 429]);
  });

  it('bounds concurrent expensive teacher authentication work', async () => {
    const responses = await Promise.all(Array.from({ length: 3 }, () => postJson(system.app, '/api/auth/login', {
      userId: 'missing-account',
      passphrase: 'a valid but incorrect phrase',
    })));
    expect(responses.map((response) => response.status).sort()).toEqual([401, 401, 429]);
    expect(responses.find((response) => response.status === 429)?.headers.get('retry-after')).toBe('1');
  });

  it('requires exact same-origin browser mutations and a trusted loopback Host', async () => {
    const crossOriginTargets = [
      ['/api/student/access', 'POST'],
      ['/api/student/logout', 'POST'],
      ['/api/auth/claim', 'POST'],
      ['/api/auth/login', 'POST'],
      ['/api/auth/logout', 'POST'],
      ['/api/prototype/events', 'POST'],
      ['/api/preflight/submissions', 'POST'],
      [`/api/teacher/preflight-submissions/${'a'.repeat(32)}/decision`, 'POST'],
      ['/api/teacher/modules/example', 'PUT'],
    ];
    for (const [path, method] of crossOriginTargets) {
      const response = await request(system.app, path, {
        method,
        headers: { ...JSON_HEADERS, origin: 'http://attacker.invalid', 'sec-fetch-site': 'cross-site' },
        body: JSON.stringify({}),
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }

    const originlessBrowser = await request(system.app, '/api/student/logout', {
      method: 'POST', headers: { 'sec-fetch-mode': 'cors' },
    });
    expect(originlessBrowser.status).toBe(403);

    const originlessCli = await request(system.app, '/api/student/access', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ code: '101' }),
    });
    expect(originlessCli.status).toBe(403);
    const exactOriginCli = await request(system.app, '/api/student/access', {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin: BASE_URL },
      body: JSON.stringify({ code: '101' }),
    });
    expect(exactOriginCli.status).toBe(201);

    const untrustedHost = await system.app.request('http://example.invalid/api/health');
    expect(untrustedHost.status).toBe(421);
    const mismatchedHost = await request(system.app, '/api/health', { headers: { host: 'localhost:4177' } });
    expect(mismatchedHost.status).toBe(421);
  });

  it('adds restrictive security headers and no-store policy to API, HTML, and errors', async () => {
    for (const response of [
      await request(system.app, '/api/health'),
      await request(system.app, '/api/not-found'),
      await request(system.app, '/'),
    ]) {
      expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('content-security-policy')).not.toContain("script-src 'unsafe-inline'");
      expect(response.headers.get('content-security-policy')).not.toContain('style-src-attr');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('permissions-policy')).toContain('microphone=()');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
    }
  });

  it('bounds JSON before parsing and rejects malformed, unsupported, and oversized bodies', async () => {
    const tooLarge = await browserRequest(system.app, '/api/student/access', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ code: 'x'.repeat(2000) }),
    });
    expect(tooLarge.status).toBe(413);

    const declaredTooLarge = await browserRequest(system.app, '/api/student/access', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'content-length': '2048' },
      body: '{}',
    });
    expect(declaredTooLarge.status).toBe(413);

    const malformed = await browserRequest(system.app, '/api/student/access', {
      method: 'POST', headers: JSON_HEADERS, body: '{',
    });
    expect(malformed.status).toBe(400);
    expect((await browserRequest(system.app, '/api/student/access', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    })).status).toBe(415);
    expect((await postJson(system.app, '/api/student/access', { code: '101', sourceText: 'must not be accepted' })).status).toBe(400);
  });

  it('uses a manual bootstrap ceremony, generic failures, bounded passphrases, and teacher throttling', async () => {
    const wrongBootstrap = await postJson(system.app, '/api/auth/claim', {
      userId: 'zach-muhlbauer', passphrase: TEACHER_PASSPHRASE, bootstrapToken: 'incorrect-bootstrap-token',
    });
    expect(wrongBootstrap.status).toBe(401);
    expect(await json(wrongBootstrap)).toEqual({ error: 'Teacher credentials were not accepted.' });
    expect(wrongBootstrap.headers.get('set-cookie')).toBeNull();

    const teacherCookie = await claimTeacher();
    expect(teacherCookie).toMatch(new RegExp(`^${TEACHER_SESSION_COOKIE}=[A-Za-z0-9_-]{43}$`));
    expect(teacherCookie).not.toContain(STUDENT_SESSION_COOKIE);
    const me = await json(await request(system.app, '/api/auth/me', { headers: { cookie: teacherCookie } }));
    expect(me.user).toEqual({ id: 'zach-muhlbauer', displayName: 'Zach Muhlbauer' });

    const storedAccount = system.db.prepare(`
      SELECT passphrase_hash AS passphraseHash, passphrase_salt AS passphraseSalt FROM accounts WHERE id = ?
    `).get('zach-muhlbauer');
    expect(ArrayBuffer.isView(storedAccount.passphraseHash)).toBe(true);
    expect(storedAccount.passphraseHash.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(storedAccount.passphraseHash).toString('utf8')).not.toContain(TEACHER_PASSPHRASE);
    expect(Buffer.from(storedAccount.passphraseSalt).toString('utf8')).not.toContain(TEACHER_PASSPHRASE);

    const duplicate = await postJson(system.app, '/api/auth/claim', {
      userId: 'zach-muhlbauer', passphrase: 'a different local phrase', bootstrapToken: BOOTSTRAP_TOKEN,
    });
    expect(duplicate.status).toBe(503);
    expect(await json(duplicate)).toEqual({ error: 'Teacher account claim is unavailable.' });
    expect(await json(await request(system.app, '/api/auth/accounts')))
      .toEqual({
        teacherAccess: { mode: 'manual', claimEnabled: false },
        runtime: {
          persistence: 'local-server', hosted: false, retentionDays: RETENTION_DAYS, suggestionRuntime: SUGGESTION_RUNTIME,
        },
      });

    const logout = await browserRequest(system.app, '/api/auth/logout', {
      method: 'POST', headers: { cookie: teacherCookie },
    });
    expect(logout.headers.get('set-cookie')).toContain(`${TEACHER_SESSION_COOKIE}=;`);

    currentTime += 10_001;
    const tooLong = 'x'.repeat(129);
    const invalidResponses = [];
    for (const passphrase of ['short', tooLong, 'also short']) {
      invalidResponses.push(await postJson(system.app, '/api/auth/login', { userId: 'zach-muhlbauer', passphrase }));
    }
    expect(invalidResponses.map((response) => response.status)).toEqual([401, 401, 429]);
    expect(invalidResponses[2].headers.get('retry-after')).toBe('10');
    expect(JSON.stringify(await json(invalidResponses[1]))).not.toContain(tooLong);

    currentTime += 10_001;
    const login = await postJson(system.app, '/api/auth/login', {
      userId: 'zach-muhlbauer', passphrase: TEACHER_PASSPHRASE,
    });
    expect(login.status).toBe(200);
    expect((await json(login)).user.displayName).toBe('Zach Muhlbauer');
    const loginCookie = cookieFrom(login);
    expect((await request(system.app, '/api/config/public?configKind=builder&scale=meso', {
      headers: { cookie: loginCookie },
    })).status).toBe(200);
    currentTime += 60_001;
    expect((await json(await request(system.app, '/api/auth/me', { headers: { cookie: loginCookie } }))).user).toBeNull();
    expect((await request(system.app, '/api/teacher/modules', { headers: { cookie: loginCookie } })).status).toBe(401);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(0);
  });

  it('requires an operator-supplied bootstrap token and gives student cookies no teacher authority', async () => {
    const studentCookie = await grantStudent();
    const invalidLogin = await postJson(system.app, '/api/auth/login', {
      userId: 'zach-muhlbauer', passphrase: TEACHER_PASSPHRASE,
    }, { cookie: studentCookie });
    expect(invalidLogin.status).toBe(401);
    const invalidClaim = await postJson(system.app, '/api/auth/claim', {
      userId: 'zach-muhlbauer', passphrase: TEACHER_PASSPHRASE, bootstrapToken: 'student-does-not-have-token',
    }, { cookie: studentCookie });
    expect(invalidClaim.status).toBe(401);
    expect((await request(system.app, '/api/teacher/modules', { headers: { cookie: studentCookie } })).status).toBe(401);

    const otherPath = join(tempDirectory, 'no-bootstrap.sqlite');
    const withoutBootstrap = createSystemsMappingApp({ dbPath: otherPath, now: () => currentTime });
    try {
      expect(await json(await request(withoutBootstrap.app, '/api/auth/accounts')))
        .toEqual({
          teacherAccess: { mode: 'manual', claimEnabled: false },
          runtime: {
            persistence: 'local-server', hosted: false, retentionDays: RETENTION_DAYS, suggestionRuntime: SUGGESTION_RUNTIME,
          },
        });
      const unavailable = await postJson(withoutBootstrap.app, '/api/auth/claim', {
        userId: 'zach-muhlbauer', passphrase: TEACHER_PASSPHRASE, bootstrapToken: BOOTSTRAP_TOKEN,
      });
      expect(unavailable.status).toBe(503);
      expect(JSON.stringify(await json(unavailable))).not.toContain(BOOTSTRAP_TOKEN);
    } finally {
      withoutBootstrap.close();
    }
  });

  it('keeps course-setting drafts authenticated, transactional, and concurrency-safe', async () => {
    const teacherCookie = await claimTeacher('maria-mavrides-calderon');
    const catalog = await json(await request(system.app, '/api/teacher/profiles', { headers: { cookie: teacherCookie } }));
    expect(catalog.resource.modules).toHaveLength(5);
    expect(catalog.resource.modules.map(({ id }) => id)).toEqual([
      'add-source', 'review-suggestions', 'choose-what-to-map', 'build-map', 'revise-and-export',
    ]);
    const active = await json(await request(system.app, `/api/teacher/profiles/${catalog.activeProfileId}`, { headers: { cookie: teacherCookie } }));
    const created = await json(await postJson(system.app, '/api/teacher/profiles', {
      name: 'Confirmation guidance',
      note: 'Clarify confirmation cadence',
      sourceProfileId: active.profile.id,
    }, { cookie: teacherCookie }));
    const nextProfile = {
      ...created.profile.profile,
      parts: created.profile.profile.parts.map((part, index) => index === 0 ? {
        ...part,
        stages: {
          ...part.stages,
          'review-suggestions': {
            ...part.stages['review-suggestions'],
            guidance: 'Ask one question and wait for the student response.',
          },
        },
      } : part),
    };
    const first = await putJson(system.app, `/api/teacher/profiles/${created.profile.id}`, {
      name: 'Confirmation guidance',
      profile: nextProfile,
      note: 'Clarify confirmation cadence',
      expectedRevision: 1,
    }, { cookie: teacherCookie });
    expect(first.status).toBe(200);
    expect((await json(first)).profile).toMatchObject({ revision: 2, profile: nextProfile, updatedByName: 'Maria Mavrides Calderon' });

    const stale = await putJson(system.app, `/api/teacher/profiles/${created.profile.id}`, {
      name: 'Stale draft',
      profile: {
        ...nextProfile,
        parts: nextProfile.parts.map((part, index) => index === 0 ? {
          ...part,
          stages: {
            ...part.stages,
            'review-suggestions': {
              ...part.stages['review-suggestions'],
              guidance: 'A stale replacement that must not win.',
            },
          },
        } : part),
      },
      note: 'Stale overwrite attempt',
      expectedRevision: 1,
    }, { cookie: teacherCookie });
    expect(stale.status).toBe(409);
    const staleBody = await json(stale);
    expect(staleBody.details.current.revision).toBe(2);
    expect(staleBody.details.current.profile).toEqual(nextProfile);

    const history = await json(await request(system.app, `/api/teacher/profiles/${created.profile.id}`, { headers: { cookie: teacherCookie } }));
    expect(history.events[0]).toMatchObject({ action: 'updated', revision: 2, note: 'Clarify confirmation cadence', actorName: 'Maria Mavrides Calderon' });
    expect((await putJson(system.app, '/api/teacher/modules/builder.meso.interaction', {
      content: 'Legacy direct edit', changeNote: 'Must be retired', expectedRevision: 1,
    }, { cookie: teacherCookie })).status).toBe(410);
    expect((await request(system.app, '/api/teacher/modules', { headers: { cookie: teacherCookie } })).status).toBe(410);
    expect((await request(system.app, '/api/teacher/history', { headers: { cookie: teacherCookie } })).status).toBe(410);
    expect((await request(system.app, '/api/teacher/effective', { headers: { cookie: teacherCookie } })).status).toBe(410);
    expect(assertDatabaseIntegrity(system.db)).toBe(true);
  });

  it('accepts only student-granted, allowlisted, value-minimized prototype events', async () => {
    const teacherCookie = await claimTeacher();
    expect((await postJson(system.app, '/api/prototype/events', {
      event: 'stage_viewed', stage: 'Build the map', metadata: { stageIndex: 5 },
    }, { cookie: teacherCookie })).status).toBe(401);

    const studentCookie = await grantStudent();
    const accepted = await postJson(system.app, '/api/prototype/events', {
      event: 'node_moved',
      stage: 'Build the map',
      metadata: { stageIndex: 3, nodeCount: 4, edgeCount: 3, keyboard: true },
    }, { cookie: studentCookie });
    expect(accepted.status).toBe(202);
    expect(await json(accepted)).toEqual({ accepted: true });

    for (const [stage, stageIndex] of [['Review suggestions', 1], ["Check your instructor's response", 1]]) {
      expect((await postJson(system.app, '/api/prototype/events', {
        event: 'stage_viewed', stage, metadata: { stageIndex },
      }, { cookie: studentCookie })).status).toBe(202);
    }

    const invalidPayloads = [
      { event: 'arbitrary_event', stage: 'Build the map' },
      { event: 'annotation_saved', stage: 'Invented stage' },
      { event: 'stage_viewed', stage: 'Preflight checklist', metadata: { stageIndex: 2 } },
      { event: 'stage_viewed', stage: 'Repair gate', metadata: { stageIndex: 3 } },
      { event: 'annotation_saved', stage: 'Build the map', metadata: { annotation: 'private note' } },
      { event: 'node_moved', stage: 'Build the map', metadata: { nodeCount: 'four' } },
      { event: 'node_moved', stage: 'Build the map', metadata: { nodeCount: 4 }, sourceText: 'private source' },
    ];
    for (const payload of invalidPayloads) {
      expect((await postJson(system.app, '/api/prototype/events', payload, { cookie: studentCookie })).status).toBe(400);
    }

    const stored = system.db.prepare(`
      SELECT session_kind AS sessionKind, session_ref AS sessionRef, event_name AS event,
        stage, metadata_json AS metadata FROM prototype_events WHERE event_name = 'node_moved'
    `).get();
    expect(stored).toEqual({
      sessionKind: 'student',
      sessionRef: expect.stringMatching(/^[a-f0-9]{16}$/),
      event: 'node_moved',
      stage: 3,
      metadata: '{"stageIndex":3,"nodeCount":4,"edgeCount":3,"keyboard":true}',
    });
    expect(JSON.stringify(system.db.prepare('SELECT * FROM prototype_events').all())).not.toContain('private');

    const auditResponse = await request(system.app, '/api/teacher/prototype-audit', { headers: { cookie: teacherCookie } });
    expect(auditResponse.status).toBe(200);
    const audit = (await json(auditResponse)).prototypeEvents;
    expect(audit.rowCount).toBeGreaterThanOrEqual(2);
    expect(Object.keys(audit).sort()).toEqual(['correlationCount', 'eventCounts', 'newestAt', 'oldestAt', 'rowCount']);
    expect(JSON.stringify(audit)).not.toContain('sessionRef');
    expect(prototypeEventAudit(system.db)).toEqual(audit);
  });

  it('atomically rolls back student session issuance when the required success event cannot be stored', async () => {
    system.db.exec(`
      CREATE TEMP TRIGGER reject_access_success
      BEFORE INSERT ON prototype_events
      WHEN NEW.event_name = 'class_access_succeeded'
      BEGIN
        SELECT RAISE(ABORT, 'injected prototype event failure');
      END;
    `);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await postJson(system.app, '/api/student/access', { code: '101' });
      expect(response.status).toBe(500);
      expect(await json(response)).toEqual({ error: 'Internal server error.' });
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(system.db.prepare('SELECT COUNT(*) AS count FROM student_sessions').get().count).toBe(0);
      expect(system.db.prepare(`
        SELECT COUNT(*) AS count FROM prototype_events WHERE event_name = 'class_access_succeeded'
      `).get().count).toBe(0);
      expect(errorLog).toHaveBeenCalledWith('Systems Mapping request failed with an internal error.');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('rate-limits and bounds prototype retention without retaining rejected bodies', async () => {
    system.close();
    databasePath = join(tempDirectory, 'bounded-events.sqlite');
    system = createSystemsMappingApp({
      dbPath: databasePath,
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      prototypeEventLimit: 3,
      prototypeEventWindowMs: 10_000,
      prototypeMaxRows: 3,
      prototypeRetentionMs: 1000,
    });
    const studentCookie = await grantStudent();
    for (let index = 0; index < 3; index += 1) {
      expect((await postJson(system.app, '/api/prototype/events', {
        event: 'stage_viewed', stage: 'Choose a scale', metadata: { stageIndex: 0, nodeCount: index },
      }, { cookie: studentCookie })).status).toBe(202);
    }
    const limited = await postJson(system.app, '/api/prototype/events', {
      event: 'stage_viewed', stage: 'Choose a scale', metadata: { stageIndex: 0 },
    }, { cookie: studentCookie });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('10');
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM prototype_events').get().count).toBe(3);

    currentTime += 10_001;
    expect((await postJson(system.app, '/api/prototype/events', {
      event: 'project_resumed', stage: 'Add a source', metadata: { stageIndex: 1 },
    }, { cookie: studentCookie })).status).toBe(202);
    const events = system.db.prepare('SELECT event_name AS event FROM prototype_events ORDER BY id').all();
    expect(events).toEqual([{ event: 'project_resumed' }]);

    system.close();
    currentTime += 1001;
    system = createSystemsMappingApp({
      dbPath: databasePath,
      now: () => currentTime,
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
      prototypeMaxRows: 3,
      prototypeRetentionMs: 1000,
    });
    await system.ready;
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM prototype_events').get().count).toBe(0);
  });

  it('sets SQLite safety pragmas, integrity checks, and owner-only database permissions', async () => {
    expect(system.db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    expect(system.db.prepare('PRAGMA trusted_schema').get().trusted_schema).toBe(0);
    expect(system.db.prepare('PRAGMA busy_timeout').get().timeout).toBe(5000);
    expect(system.db.prepare('PRAGMA secure_delete').get().secure_delete).toBe(1);
    expect(system.db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal');
    expect(assertDatabaseIntegrity(system.db)).toBe(true);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE passphrase_hash IS NOT NULL').get().count).toBe(0);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(0);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM student_sessions').get().count).toBe(0);
    expect(system.db.prepare('SELECT COUNT(*) AS count FROM prototype_events').get().count).toBe(0);
  });

  it('hardens an existing local database directory to owner-only permissions', async () => {
    system.close();
    const dataDirectory = join(tempDirectory, 'existing-data');
    mkdirSync(dataDirectory, { mode: 0o755 });
    chmodSync(dataDirectory, 0o755);
    databasePath = join(dataDirectory, 'permissions.sqlite');
    system = createSystemsMappingApp({ dbPath: databasePath, now: () => currentTime });
    expect(statSync(dataDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
  });
});
