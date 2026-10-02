// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEACHING_PROFILE, teachingProfileShape } from './config.js';
import { initializeDurableDatabase, openDatabase } from './database.js';

describe('stored teaching profile upgrade diagnostics', () => {
  let db;
  afterEach(() => { db?.close(); db = null; });

  it('reports schema shape without instructor values and leaves invalid profiles unchanged', () => {
    db = openDatabase(':memory:');
    const profile = structuredClone(DEFAULT_TEACHING_PROFILE);
    profile.customInstructions = 'PRIVATE_INSTRUCTOR_TEXT';
    profile.parts[0].id = 'private-part-id';
    profile.parts[0].stages['build-map'].guidance = 'PRIVATE_GUIDANCE';
    const serialized = JSON.stringify(profile);
    db.prepare('UPDATE teaching_profiles SET profile_json = ?').run(serialized);
    const onProfileUpgradeFailure = vi.fn();

    expect(() => initializeDurableDatabase(db, { onProfileUpgradeFailure })).toThrow(
      'Educator resource: course progression fields do not match the supported schema.',
    );
    expect(onProfileUpgradeFailure).toHaveBeenCalledTimes(1);
    const shape = onProfileUpgradeFailure.mock.calls[0][0];
    expect(shape).toMatchObject({
      schemaVersion: 'cuny.course-progression.v3', rootKind: 'object',
      rootKeys: ['customInstructions', 'parts', 'schemaVersion'], partsKind: 'array', partCount: 2,
    });
    expect(shape.parts[0]).toMatchObject({
      keys: ['id', 'label', 'scaleIds', 'stages'], stagesKind: 'object',
      stageKeys: ['add-source', 'build-map', 'choose-what-to-map', 'review-suggestions', 'revise-and-export'],
    });
    expect(JSON.stringify(shape)).not.toMatch(/PRIVATE_|private-part-id/);
    expect(db.prepare('SELECT profile_json AS profile, revision FROM teaching_profiles').get())
      .toEqual({ profile: serialized, revision: 1 });
  });

  it('keeps the original schema error when the diagnostic callback fails', () => {
    db = openDatabase(':memory:');
    db.prepare('UPDATE teaching_profiles SET profile_json = ?').run(JSON.stringify({ schemaVersion: 'unknown', extra: true }));
    expect(() => initializeDurableDatabase(db, { onProfileUpgradeFailure() { throw new Error('Logging failed'); } }))
      .toThrow('Educator resource: course progression fields do not match the supported schema.');
  });

  it('bounds shape output and masks free-form keys and unsupported version values', () => {
    const profile = {
      schemaVersion: 'PRIVATE_VERSION_VALUE',
      'PRIVATE TEXT AS KEY': true,
      parts: Array.from({ length: 50 }, () => ({ id: 'PRIVATE_ID', stages: { 'PRIVATE STAGE TEXT': { guidance: 'PRIVATE_GUIDANCE' } } })),
    };
    const shape = teachingProfileShape(profile);
    expect(shape.schemaVersion).toBe('unrecognized');
    expect(shape.rootKeys).toContain('unrecognized-field');
    expect(shape.partCount).toBe(50);
    expect(shape.parts).toHaveLength(8);
    expect(JSON.stringify(shape)).not.toContain('PRIVATE');
  });
});
