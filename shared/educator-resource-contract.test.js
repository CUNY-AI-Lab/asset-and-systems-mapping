import { describe, expect, it } from 'vitest';
import {
  COURSE_PROGRESSION_SCHEMA_VERSION,
  defineEducatorResource,
  EDUCATOR_RESOURCE_SCHEMA_VERSION,
  normalizeCourseProgression,
  normalizeTeachingProfile,
  moduleEffects,
  TEACHING_PROFILE_SCHEMA_VERSION,
} from './educator-resource-contract.js';

const definition = () => ({
  schemaVersion: EDUCATOR_RESOURCE_SCHEMA_VERSION,
  id: 'example-resource',
  label: 'Example resource',
  configurationKinds: [{ id: 'guide', label: 'Guide' }],
  scopes: [{ id: 'global', label: 'All contexts' }],
  runtimes: [{ id: 'deterministic', label: 'Deterministic', teacherModulesAffectOutput: false, disclosure: 'Recorded as provenance.' }],
  modules: [{ id: 'purpose', label: 'Purpose', description: 'What the resource does.', effects: { deterministic: ['provenance'] } }],
  fixedGuardrails: [{ id: 'grounding', label: 'Use only supplied evidence.' }],
});

describe('educator resource contract', () => {
  it('normalizes a portable framework-neutral resource manifest', () => {
    const resource = defineEducatorResource(definition());
    expect(resource.id).toBe('example-resource');
    expect(moduleEffects(resource, 'purpose', 'deterministic')).toEqual(['provenance']);
    expect(Object.isFrozen(resource)).toBe(true);
  });

  it('rejects unknown runtime effects and duplicate identifiers', () => {
    const unknownEffect = definition();
    unknownEffect.modules[0].effects.deterministic = ['changes-everything'];
    expect(() => defineEducatorResource(unknownEffect)).toThrow(/unsupported effect/);

    const duplicateScope = definition();
    duplicateScope.scopes.push({ id: 'global', label: 'Duplicate' });
    expect(() => defineEducatorResource(duplicateScope)).toThrow(/duplicate id global/);
  });

  it('preserves the earlier cross-application profile contract for adapters', () => {
    const profile = normalizeTeachingProfile({
      schemaVersion: TEACHING_PROFILE_SCHEMA_VERSION,
      focus: '  Attend to relationships. ',
      evidence: 'Return to source passages.',
      questions: 'Ask one focused question.',
      privacy: 'Remove unnecessary identifying details.',
      contextAdjustments: { micro: '', meso: 'Name organizational roles.' },
    }, { contextIds: ['micro', 'meso'] });
    expect(profile.focus).toBe('Attend to relationships.');
    expect(profile.contextAdjustments.meso).toBe('Name organizational roles.');
    expect(() => normalizeTeachingProfile({ ...profile, extra: true }, { contextIds: ['micro', 'meso'] })).toThrow(/fields/);
  });

  it('normalizes bounded guidance and supporting material for a registered progression', () => {
    const progression = normalizeCourseProgression({
      schemaVersion: COURSE_PROGRESSION_SCHEMA_VERSION,
      stages: {
        source: { guidance: '  Return to the source. ', materials: 'Course reading excerpt.' },
        map: { guidance: '', materials: '' },
      },
    }, { stageIds: ['source', 'map'] });
    expect(progression.stages.source.guidance).toBe('Return to the source.');
    expect(progression.stages.source.materials).toBe('Course reading excerpt.');
    expect(() => normalizeCourseProgression({ ...progression, extra: true }, { stageIds: ['source', 'map'] })).toThrow(/fields/);
    expect(() => normalizeCourseProgression({
      ...progression,
      stages: { source: progression.stages.source },
    }, { stageIds: ['source', 'map'] })).toThrow(/registered progression/);
  });
});
