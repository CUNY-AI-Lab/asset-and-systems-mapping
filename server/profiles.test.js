// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEACHING_PROFILE_SCHEMA_VERSION } from '../shared/educator-resource-contract.js';
import { createSystemsMappingApp } from './app.js';

const BASE_URL = 'http://127.0.0.1:4177';
const BOOTSTRAP_TOKEN = 'profile-test-bootstrap-token';
const PASSPHRASE = 'profile test teacher phrase';

function request(app, path, options = {}) {
  return app.request(`${BASE_URL}${path}`, options);
}

function jsonRequest(app, method, path, body, cookie) {
  return request(app, path, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: BASE_URL,
      'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';')[0];
}

describe('teaching profiles', () => {
  let directory;
  let system;
  let teacherCookie;
  let studentCookie;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'systems-mapping-profiles-'));
    system = createSystemsMappingApp({
      dbPath: join(directory, 'profiles.sqlite'),
      teacherBootstrapToken: BOOTSTRAP_TOKEN,
    });
    const claim = await jsonRequest(system.app, 'POST', '/api/auth/claim', {
      userId: 'zach-muhlbauer',
      passphrase: PASSPHRASE,
      bootstrapToken: BOOTSTRAP_TOKEN,
    });
    expect(claim.status).toBe(201);
    teacherCookie = cookieFrom(claim);
    const access = await jsonRequest(system.app, 'POST', '/api/student/access', { code: '101' });
    expect(access.status).toBe(201);
    studentCookie = cookieFrom(access);
  });

  afterEach(() => {
    system.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('exposes five teacher-facing sections and keeps draft changes out of the active runtime until publication', async () => {
    expect((await request(system.app, '/api/teacher/profiles')).status).toBe(401);

    const catalogResponse = await request(system.app, '/api/teacher/profiles', { headers: { cookie: teacherCookie } });
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json();
    expect(catalog.resource.modules.map(({ id }) => id)).toEqual(['focus', 'evidence', 'questions', 'privacy', 'scale-adjustments']);
    expect(catalog.profiles).toHaveLength(1);
    expect(catalog.profiles[0]).not.toHaveProperty('profile');
    expect(catalog.profiles[0].status).toBe('active');

    const before = await (await request(system.app, '/api/config/public?configKind=preflight&scale=micro', { headers: { cookie: studentCookie } })).json();
    const create = await jsonRequest(system.app, 'POST', '/api/teacher/profiles', {
      name: 'Evidence trial',
      note: 'Test a more focused evidence return',
      sourceProfileId: catalog.activeProfileId,
    }, teacherCookie);
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.profile.status).toBe('draft');
    expect(created.profile.parentId).toBe(catalog.activeProfileId);

    const changedProfile = {
      ...created.profile.profile,
      focus: 'Return first to the passage that names a relationship between two actors.',
    };
    const save = await jsonRequest(system.app, 'PUT', `/api/teacher/profiles/${created.profile.id}`, {
      name: 'Evidence trial',
      profile: changedProfile,
      note: 'Focus the first prompt on relationships',
      expectedRevision: 1,
    }, teacherCookie);
    expect(save.status).toBe(200);
    const saved = await save.json();
    expect(saved.profile.revision).toBe(2);
    expect(saved.events[0]).toMatchObject({ action: 'updated', revision: 2 });

    const stillActive = await (await request(system.app, '/api/config/public?configKind=preflight&scale=micro', { headers: { cookie: studentCookie } })).json();
    expect(stillActive.fingerprint).toBe(before.fingerprint);

    const preview = await (await request(system.app, `/api/teacher/profiles/${created.profile.id}/preview?configKind=preflight&scale=micro`, { headers: { cookie: teacherCookie } })).json();
    expect(preview.fingerprint).not.toBe(before.fingerprint);
    expect(preview.effectivePrompt).toContain(changedProfile.focus);
    expect(Object.keys(preview).sort()).toEqual(['configKind', 'effectivePrompt', 'fingerprint', 'revision', 'scale']);

    const stale = await jsonRequest(system.app, 'PUT', `/api/teacher/profiles/${created.profile.id}`, {
      name: 'Evidence trial',
      profile: changedProfile,
      note: 'Stale revision should fail',
      expectedRevision: 1,
    }, teacherCookie);
    expect(stale.status).toBe(409);
    expect((await stale.json()).details.current.revision).toBe(2);

    const publish = await jsonRequest(system.app, 'POST', `/api/teacher/profiles/${created.profile.id}/publish`, {
      note: 'Publish the evidence trial',
      expectedRevision: 2,
    }, teacherCookie);
    expect(publish.status).toBe(200);
    const published = await publish.json();
    expect(published.profile.status).toBe('active');
    expect(published.events[0].action).toBe('published');

    const after = await (await request(system.app, '/api/config/public?configKind=preflight&scale=micro', { headers: { cookie: studentCookie } })).json();
    expect(after.fingerprint).toBe(preview.fingerprint);
    expect(after.moduleVersions.at(-1)).toMatchObject({ id: `teaching-profile.${created.profile.id}`, revision: 2 });
  });

  it('rejects malformed or extended profile documents', async () => {
    const catalog = await (await request(system.app, '/api/teacher/profiles', { headers: { cookie: teacherCookie } })).json();
    const created = await (await jsonRequest(system.app, 'POST', '/api/teacher/profiles', {
      name: 'Invalid trial',
      note: 'Exercise strict profile validation',
    }, teacherCookie)).json();
    const invalid = {
      ...created.profile.profile,
      schemaVersion: TEACHING_PROFILE_SCHEMA_VERSION,
      hiddenInstruction: 'Unsupported',
    };
    const response = await jsonRequest(system.app, 'PUT', `/api/teacher/profiles/${created.profile.id}`, {
      name: 'Invalid trial',
      profile: invalid,
      note: 'This must not save',
      expectedRevision: 1,
    }, teacherCookie);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/fields/);
    expect(catalog.activeProfileId).toBe('systems-mapping-default');
  });

  it('keeps profile history append-only in SQLite', () => {
    expect(() => system.db.prepare('UPDATE teaching_profile_events SET note = ? WHERE id = 1').run('Rewrite history')).toThrow(/append-only/);
    expect(() => system.db.prepare('DELETE FROM teaching_profile_events WHERE id = 1').run()).toThrow(/append-only/);
  });
});
