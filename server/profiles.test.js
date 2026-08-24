// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COURSE_PROGRESSION_SCHEMA_VERSION } from '../shared/educator-resource-contract.js';
import { createSystemsMappingApp } from './app.js';
import { fingerprint, moduleSeeds } from './config.js';

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
  let databasePath;
  let system;
  let teacherCookie;
  let studentCookie;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'systems-mapping-profiles-'));
    databasePath = join(directory, 'profiles.sqlite');
    system = createSystemsMappingApp({
      dbPath: databasePath,
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

  it('exposes the five-stage cycle and keeps draft changes out of the active runtime until publication', async () => {
    expect((await request(system.app, '/api/teacher/profiles')).status).toBe(401);

    const catalogResponse = await request(system.app, '/api/teacher/profiles', { headers: { cookie: teacherCookie } });
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json();
    expect(catalog.resource.modules.map(({ id }) => id)).toEqual([
      'add-source', 'review-suggestions', 'choose-what-to-map', 'build-map', 'revise-and-export',
    ]);
    expect(catalog.profiles).toHaveLength(1);
    expect(catalog.profiles[0]).not.toHaveProperty('profile');
    expect(catalog.profiles[0].status).toBe('active');

    const before = await (await request(system.app, '/api/config/public?configKind=preflight&scale=micro', { headers: { cookie: studentCookie } })).json();
    const create = await jsonRequest(system.app, 'POST', '/api/teacher/profiles', {
      name: 'Evidence guidance',
      note: 'Focus the questions on relationships',
      sourceProfileId: catalog.activeProfileId,
    }, teacherCookie);
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.profile.status).toBe('draft');
    expect(created.profile.parentId).toBe(catalog.activeProfileId);

    const changedProfile = {
      ...created.profile.profile,
      parts: created.profile.profile.parts.map((part, index) => index === 0 ? {
        ...part,
        stages: {
          ...part.stages,
          'review-suggestions': {
            guidance: 'Return first to the passage that names a relationship between two actors.',
            materials: 'Use the course reading on actor and relationship mapping.',
          },
        },
      } : part),
    };
    const save = await jsonRequest(system.app, 'PUT', `/api/teacher/profiles/${created.profile.id}`, {
      name: 'Evidence guidance',
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

    await system.db.prepare("UPDATE prompt_modules SET revision = 99 WHERE id = 'preflight.micro.purpose'").run();

    const preview = await (await request(system.app, `/api/teacher/profiles/${created.profile.id}/preview?configKind=preflight&scale=micro&stageId=review-suggestions`, { headers: { cookie: teacherCookie } })).json();
    expect(preview).toMatchObject({
      part: { id: 'part-1', label: 'Part 1' },
      scale: 'micro',
      stageId: 'review-suggestions',
      guidance: changedProfile.parts[0].stages['review-suggestions'].guidance,
      materials: changedProfile.parts[0].stages['review-suggestions'].materials,
      revision: 2,
    });
    expect(Object.keys(preview).sort()).toEqual(['guidance', 'materials', 'part', 'revision', 'scale', 'stageId']);
    expect(preview).not.toHaveProperty('effectivePrompt');
    expect(preview).not.toHaveProperty('fingerprint');

    const stale = await jsonRequest(system.app, 'PUT', `/api/teacher/profiles/${created.profile.id}`, {
      name: 'Evidence guidance',
      profile: changedProfile,
      note: 'Stale revision should fail',
      expectedRevision: 1,
    }, teacherCookie);
    expect(stale.status).toBe(409);
    expect((await stale.json()).details.current.revision).toBe(2);

    const publish = await jsonRequest(system.app, 'POST', `/api/teacher/profiles/${created.profile.id}/publish`, {
      note: 'Publish the evidence guidance',
      expectedRevision: 2,
    }, teacherCookie);
    expect(publish.status).toBe(200);
    const published = await publish.json();
    expect(published.profile.status).toBe('active');
    expect(published.events[0].action).toBe('published');

    const after = await (await request(system.app, '/api/config/public?configKind=preflight&scale=micro', { headers: { cookie: studentCookie } })).json();
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.moduleVersions.at(-1)).toMatchObject({ id: `teaching-profile.${created.profile.id}`, revision: 2 });
  });

  it('rejects malformed or extended profile documents', async () => {
    const catalog = await (await request(system.app, '/api/teacher/profiles', { headers: { cookie: teacherCookie } })).json();
    const created = await (await jsonRequest(system.app, 'POST', '/api/teacher/profiles', {
      name: 'Invalid draft',
      note: 'Exercise strict profile validation',
    }, teacherCookie)).json();
    const invalid = {
      ...created.profile.profile,
      schemaVersion: COURSE_PROGRESSION_SCHEMA_VERSION,
      hiddenInstruction: 'Unsupported',
    };
    const response = await jsonRequest(system.app, 'PUT', `/api/teacher/profiles/${created.profile.id}`, {
      name: 'Invalid draft',
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

  it('atomically upgrades an earlier course profile with a matching revisioned event exactly once', () => {
    const legacyProfile = {
      schemaVersion: 'cuny.teaching-profile.v1',
      focus: 'Keep attention on how institutional actors shape access.',
      evidence: 'Require a passage from the memo for each proposed relationship.',
      questions: 'Ask one question that returns the student to the source.',
      privacy: 'Keep sensitive source detail out of shared exports.',
      contextAdjustments: {
        micro: 'Attend to people and direct encounters.',
        meso: 'Attend to organizations and programs.',
        macro: 'Attend to policy and institutions.',
        integration: 'Compare confirmed relationships across scales.',
      },
    };
    system.db.prepare(`
      UPDATE teaching_profiles
      SET profile_json = ?, fingerprint = ?
      WHERE id = 'systems-mapping-default'
    `).run(JSON.stringify(legacyProfile), 'd'.repeat(64));
    system.close();

    system = createSystemsMappingApp({ dbPath: databasePath, teacherBootstrapToken: BOOTSTRAP_TOKEN });
    const upgradedRow = system.db.prepare(`
      SELECT revision, profile_json AS profileJson, fingerprint
      FROM teaching_profiles WHERE id = 'systems-mapping-default'
    `).get();
    const upgraded = JSON.parse(upgradedRow.profileJson);
    expect(upgradedRow.revision).toBe(2);
    expect(upgradedRow.fingerprint).toBe(fingerprint(upgradedRow.profileJson));
    expect(upgraded.schemaVersion).toBe(COURSE_PROGRESSION_SCHEMA_VERSION);
    expect(upgraded.parts[0].stages['add-source'].guidance).toContain(legacyProfile.focus);
    expect(upgraded.parts[0].stages['add-source'].materials).toContain(legacyProfile.contextAdjustments.micro);
    expect(upgraded.parts[0].stages['add-source'].guidance).toContain(legacyProfile.evidence);
    expect(upgraded.parts[0].stages['add-source'].guidance).toContain(legacyProfile.privacy);
    expect(upgraded.parts[0].stages['review-suggestions'].guidance).toBe(legacyProfile.questions);
    expect(upgraded.parts[1].stages['add-source'].materials).toContain(legacyProfile.contextAdjustments.macro);
    const upgradeEvents = () => system.db.prepare(`
      SELECT action, revision, profile_json AS profileJson, fingerprint, note
      FROM teaching_profile_events
      WHERE profile_id = 'systems-mapping-default'
        AND note = 'Updated default scale semantics'
      ORDER BY id
    `).all();
    expect(upgradeEvents()).toEqual([{
      action: 'updated',
      revision: 2,
      profileJson: upgradedRow.profileJson,
      fingerprint: upgradedRow.fingerprint,
      note: 'Updated default scale semantics',
    }]);

    system.close();
    system = createSystemsMappingApp({ dbPath: databasePath, teacherBootstrapToken: BOOTSTRAP_TOKEN });
    expect(system.db.prepare(`
      SELECT revision FROM teaching_profiles WHERE id = 'systems-mapping-default'
    `).get().revision).toBe(2);
    expect(upgradeEvents()).toHaveLength(1);
  });

  it('updates untouched prompt defaults without overwriting instructor-authored module content', () => {
    const legacyMacroPurpose = 'Focus Macro work on agencies, offices, funders, decision-making bodies, laws, beliefs, public narratives, and histories that affect the population.';
    const previousMesoPurpose = 'Focus Meso work on interrelations among two or more immediate settings already mapped in Micro.';
    const customBuilderPurpose = 'Keep this instructor-authored Exosphere purpose exactly.';
    system.db.prepare(`
      UPDATE prompt_modules SET content = ?, revision = 1, fingerprint = ?
      WHERE id = 'preflight.exosphere.purpose'
    `).run(legacyMacroPurpose, fingerprint(legacyMacroPurpose));
    system.db.prepare(`
      UPDATE prompt_modules SET content = ?, revision = 5, fingerprint = ?
      WHERE id = 'preflight.meso.purpose'
    `).run(previousMesoPurpose, fingerprint(previousMesoPurpose));
    system.db.prepare(`
      UPDATE prompt_modules SET content = ?, revision = 1, fingerprint = ?
      WHERE id = 'builder.exosphere.purpose'
    `).run(customBuilderPurpose, fingerprint(customBuilderPurpose));
    system.close();

    system = createSystemsMappingApp({ dbPath: databasePath, teacherBootstrapToken: BOOTSTRAP_TOKEN });
    const currentDefault = moduleSeeds().find(({ id }) => id === 'preflight.exosphere.purpose');
    const currentMesoDefault = moduleSeeds().find(({ id }) => id === 'preflight.meso.purpose');
    expect(system.db.prepare(`
      SELECT content, revision, fingerprint FROM prompt_modules
      WHERE id = 'preflight.exosphere.purpose'
    `).get()).toEqual({ content: currentDefault.content, revision: 2, fingerprint: currentDefault.fingerprint });
    expect(system.db.prepare(`
      SELECT content, revision, fingerprint FROM prompt_modules
      WHERE id = 'preflight.meso.purpose'
    `).get()).toEqual({ content: currentMesoDefault.content, revision: 6, fingerprint: currentMesoDefault.fingerprint });
    expect(system.db.prepare(`
      SELECT content, revision, fingerprint FROM prompt_modules
      WHERE id = 'builder.exosphere.purpose'
    `).get()).toEqual({ content: customBuilderPurpose, revision: 1, fingerprint: fingerprint(customBuilderPurpose) });
    const upgradeHistoryCount = () => system.db.prepare(`
      SELECT COUNT(*) AS count FROM prompt_module_history
      WHERE module_id = 'preflight.exosphere.purpose'
        AND revision = 2
        AND change_note = 'Updated default scale semantics'
    `).get().count;
    expect(upgradeHistoryCount()).toBe(1);

    system.close();
    system = createSystemsMappingApp({ dbPath: databasePath, teacherBootstrapToken: BOOTSTRAP_TOKEN });
    expect(upgradeHistoryCount()).toBe(1);
  });

  it('advances every untouched production Micro prompt module to the entity-resolution contract', () => {
    const previousMicroContent = {
      purpose: 'Focus Micro work on the activities, roles, interpersonal relationships, objects, and immediate settings the person directly encounters.',
      evidence: 'Use a specific noun phrase for each person, role, activity, object, or immediate setting. Use a direct relationship verb only when the memo supports what happens between two Micro elements. Show which voices are represented or missing and use community research or other data when available.',
      scale_rubric: 'Micro work should show the immediate settings and direct activities, roles, and interpersonal relationships in which the person participates.',
      output: 'Return Micro nodes for exactly one discrete actor or object each, including a person, role, activity, object, or immediate setting. Write each label as a noun phrase, not a sentence, clause, proposition, action, relationship, finding, or explanation. Preserve a complete official name even when it is long. Return supported direct connections among proposed or existing Micro nodes with concise relationship verbs.',
    };
    const moduleIds = [];
    for (const configKind of ['preflight', 'builder']) {
      for (const [moduleKey, content] of Object.entries(previousMicroContent)) {
        const id = `${configKind}.micro.${moduleKey}`;
        moduleIds.push(id);
        system.db.prepare(`
          UPDATE prompt_modules SET content = ?, revision = 7, fingerprint = ?
          WHERE id = ?
        `).run(content, fingerprint(content), id);
      }
    }
    system.close();

    system = createSystemsMappingApp({ dbPath: databasePath, teacherBootstrapToken: BOOTSTRAP_TOKEN });
    const currentById = new Map(moduleSeeds().map((module) => [module.id, module]));
    for (const id of moduleIds) {
      const current = currentById.get(id);
      expect(system.db.prepare(`
        SELECT content, revision, fingerprint FROM prompt_modules WHERE id = ?
      `).get(id)).toEqual({ content: current.content, revision: 8, fingerprint: current.fingerprint });
      expect(system.db.prepare(`
        SELECT COUNT(*) AS count FROM prompt_module_history
        WHERE module_id = ? AND revision = 8 AND change_note = 'Updated default scale semantics'
      `).get(id).count).toBe(1);
    }

    system.close();
    system = createSystemsMappingApp({ dbPath: databasePath, teacherBootstrapToken: BOOTSTRAP_TOKEN });
    for (const id of moduleIds) {
      expect(system.db.prepare(`
        SELECT COUNT(*) AS count FROM prompt_module_history
        WHERE module_id = ? AND revision = 8 AND change_note = 'Updated default scale semantics'
      `).get(id).count).toBe(1);
    }
  });
});
