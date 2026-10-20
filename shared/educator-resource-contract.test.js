import { describe, expect, it } from 'vitest';
import { DEFAULT_FIELD_NOTES_QUESTIONS, FIELD_NOTES_QUESTION_LIMIT } from './field-notes.js';
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
      evidence: 'Return to passages in the memo.',
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
      parts: [
        {
          id: 'part-1',
          label: 'Part 1',
          scaleIds: ['micro', 'meso'],
          stages: {
            source: { guidance: '  Return to the source. ', materials: 'Course reading excerpt.' },
            map: { guidance: '', materials: '' },
          },
        },
        {
          id: 'part-2',
          label: 'Part 2',
          scaleIds: ['exosphere', 'macrosphere'],
          stages: {
            source: { guidance: '', materials: '' },
            map: { guidance: 'Connect earlier work.', materials: '' },
          },
        },
      ],
    }, { stageIds: ['source', 'map'], scaleIds: ['micro', 'meso', 'exosphere', 'macrosphere'] });
    expect(progression.parts[0].stages.source.guidance).toBe('Return to the source.');
    expect(progression.parts[0].stages.source.materials).toBe('Course reading excerpt.');
    expect(() => normalizeCourseProgression(
      { ...progression, extra: true },
      { stageIds: ['source', 'map'], scaleIds: ['micro', 'meso', 'exosphere', 'macrosphere'] },
    )).toThrow(/fields/);
    expect(() => normalizeCourseProgression({
      ...progression,
      parts: [
        { ...progression.parts[0], stages: { source: progression.parts[0].stages.source } },
        progression.parts[1],
      ],
    }, { stageIds: ['source', 'map'], scaleIds: ['micro', 'meso', 'exosphere', 'macrosphere'] })).toThrow(/registered progression/);
  });

  it('requires every registered scale to appear in exactly one part', () => {
    const stages = {
      source: { guidance: '', materials: '' },
      map: { guidance: '', materials: '' },
    };
    const base = {
      schemaVersion: COURSE_PROGRESSION_SCHEMA_VERSION,
      parts: [
        { id: 'part-1', label: 'Part 1', scaleIds: ['micro', 'meso'], stages },
        { id: 'part-2', label: 'Part 2', scaleIds: ['exosphere', 'macrosphere'], stages },
      ],
    };
    const options = { stageIds: ['source', 'map'], scaleIds: ['micro', 'meso', 'exosphere', 'macrosphere'] };
    expect(normalizeCourseProgression(base, options).parts).toHaveLength(2);
    expect(() => normalizeCourseProgression({
      ...base,
      parts: [base.parts[0], { ...base.parts[1], scaleIds: ['meso', 'macrosphere'] }],
    }, options)).toThrow(/more than one part/);
    expect(() => normalizeCourseProgression({
      ...base,
      parts: [base.parts[0], { ...base.parts[1], scaleIds: ['exosphere'] }],
    }, options)).toThrow(/do not cover/);
    expect(() => normalizeCourseProgression({
      ...base,
      parts: [base.parts[0], { ...base.parts[1], scaleIds: ['exosphere', 'unsupported'] }],
    }, options)).toThrow(/unsupported scale/);
  });

  it('requires a bounded nonblank Field Notes question for every registered scale when configured', () => {
    const scaleIds = Object.keys(DEFAULT_FIELD_NOTES_QUESTIONS);
    const base = {
      schemaVersion: COURSE_PROGRESSION_SCHEMA_VERSION,
      parts: [{ id: 'part-1', label: 'Part 1', scaleIds, stages: { map: { guidance: '', materials: '' } } }],
    };
    const options = { stageIds: ['map'], scaleIds };
    expect(normalizeCourseProgression(base, options)).not.toHaveProperty('fieldNotesQuestions');
    const normalize = fieldNotesQuestions => normalizeCourseProgression({ ...base, fieldNotesQuestions }, options);
    expect(normalize(DEFAULT_FIELD_NOTES_QUESTIONS).fieldNotesQuestions).toEqual(DEFAULT_FIELD_NOTES_QUESTIONS);
    for (const questions of [null, [], {}, { ...DEFAULT_FIELD_NOTES_QUESTIONS, unknown: 'Extra' },
      { ...DEFAULT_FIELD_NOTES_QUESTIONS, micro: ' \n ' },
      { ...DEFAULT_FIELD_NOTES_QUESTIONS, micro: 42 },
      { ...DEFAULT_FIELD_NOTES_QUESTIONS, micro: 'x'.repeat(FIELD_NOTES_QUESTION_LIMIT + 1) }]) {
      expect(() => normalize(questions)).toThrow();
    }
  });

  it('preserves optional intakeQuestions only as bounded finite JSON data', () => {
    const base = {
      schemaVersion: COURSE_PROGRESSION_SCHEMA_VERSION,
      parts: [{ id: 'part-1', label: 'Part 1', scaleIds: ['micro'], stages: { map: { guidance: '', materials: '' } } }],
    };
    const options = { stageIds: ['map'], scaleIds: ['micro'] };
    const cyclic = {};
    cyclic.self = cyclic;
    const getter = Object.defineProperty({}, 'question', { enumerable: true, get() { throw new Error('must not execute'); } });
    const toJSON = { toJSON() { throw new Error('must not execute'); } };
    for (const intakeQuestions of [undefined, NaN, Infinity, 1n, () => null, Symbol('question'), cyclic, getter, toJSON, new Date(), [undefined], new Array(1)]) {
      expect(() => normalizeCourseProgression({ ...base, intakeQuestions }, options)).toThrow(/finite JSON data/);
    }
    for (const intakeQuestions of [null, false, 0, '', [], { question: '  Original text\n', required: false }]) {
      expect(normalizeCourseProgression({ ...base, intakeQuestions }, options).intakeQuestions).toEqual(intakeQuestions);
    }
    expect(() => normalizeCourseProgression({ ...base, intakeQuestions: 'x'.repeat(60_000) }, options)).toThrow(/too large/);
    expect(() => normalizeCourseProgression({ ...base, intakeQuestions: 'é'.repeat(30_000) }, options)).toThrow(/too large/);
    const oversizedProfile = { ...base, intakeQuestions: 'x'.repeat(59_800), parts: [{ ...base.parts[0], stages: { map: { guidance: 'y'.repeat(500), materials: '' } } }] };
    expect(() => normalizeCourseProgression(oversizedProfile, options)).toThrow(/too large/);
    const deep = Array.from({ length: 65 }).reduce((value) => [value], null);
    expect(() => normalizeCourseProgression({ ...base, intakeQuestions: deep }, options)).toThrow(/JSON depth/);
    expect(() => normalizeCourseProgression({ ...base, intakeQuestions: [], unknownField: true }, options)).toThrow(/fields do not match/);
  });
});
