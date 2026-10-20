import { FIELD_NOTES_QUESTION_LIMIT } from './field-notes.js';

export const EDUCATOR_RESOURCE_SCHEMA_VERSION = 'cuny.educator-resource.v1';
export const EDUCATOR_VERSION_STATUSES = Object.freeze(['draft', 'active', 'retired']);
export const EDUCATOR_MODULE_EFFECTS = Object.freeze([
  'provenance',
  'student-projection',
  'teacher-artifact',
  'runtime-behavior',
]);
export const TEACHING_PROFILE_SCHEMA_VERSION = 'cuny.teaching-profile.v1';
export const COURSE_PROGRESSION_SCHEMA_VERSION = 'cuny.course-progression.v3';
export const LEGACY_COURSE_PROGRESSION_SCHEMA_VERSION = 'cuny.course-progression.v1';
export const LEGACY_PARTS_COURSE_PROGRESSION_SCHEMA_VERSION = 'cuny.course-progression.v2';

function fail(message) {
  throw new TypeError(`Educator resource: ${message}`);
}

function identifier(value, name) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)) {
    fail(`${name} must be a stable lowercase identifier.`);
  }
  return value;
}

function text(value, name, maximum = 500) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > maximum) {
    fail(`${name} must contain 1-${maximum} characters.`);
  }
  return value.trim();
}

function uniqueRecords(records, name, normalize) {
  if (!Array.isArray(records) || records.length < 1) fail(`${name} must be a non-empty array.`);
  const seen = new Set();
  return records.map((record, index) => {
    const normalized = normalize(record, `${name}[${index}]`);
    if (seen.has(normalized.id)) fail(`${name} contains duplicate id ${normalized.id}.`);
    seen.add(normalized.id);
    return normalized;
  });
}

function normalizeContext(record, name) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`${name} must be an object.`);
  return Object.freeze({
    id: identifier(record.id, `${name}.id`),
    label: text(record.label, `${name}.label`, 120),
  });
}

function normalizeRuntime(record, name) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`${name} must be an object.`);
  return Object.freeze({
    id: identifier(record.id, `${name}.id`),
    label: text(record.label, `${name}.label`, 120),
    teacherModulesAffectOutput: Boolean(record.teacherModulesAffectOutput),
    disclosure: text(record.disclosure, `${name}.disclosure`, 500),
  });
}

function normalizeModule(record, name, runtimeIds) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`${name} must be an object.`);
  if (!record.effects || typeof record.effects !== 'object' || Array.isArray(record.effects)) {
    fail(`${name}.effects must be an object keyed by runtime id.`);
  }
  const effects = {};
  for (const runtimeId of runtimeIds) {
    const runtimeEffects = record.effects[runtimeId];
    if (!Array.isArray(runtimeEffects) || runtimeEffects.length < 1) {
      fail(`${name}.effects.${runtimeId} must be a non-empty array.`);
    }
    const uniqueEffects = [...new Set(runtimeEffects)];
    if (uniqueEffects.some((effect) => !EDUCATOR_MODULE_EFFECTS.includes(effect))) {
      fail(`${name}.effects.${runtimeId} contains an unsupported effect.`);
    }
    effects[runtimeId] = Object.freeze(uniqueEffects);
  }
  for (const runtimeId of Object.keys(record.effects)) {
    if (!runtimeIds.has(runtimeId)) fail(`${name}.effects contains unknown runtime ${runtimeId}.`);
  }
  return Object.freeze({
    id: identifier(record.id, `${name}.id`),
    label: text(record.label, `${name}.label`, 120),
    description: text(record.description, `${name}.description`, 500),
    editable: record.editable !== false,
    effects: Object.freeze(effects),
  });
}

export function defineEducatorResource(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) fail('definition must be an object.');
  if (definition.schemaVersion !== EDUCATOR_RESOURCE_SCHEMA_VERSION) fail(`schemaVersion must be ${EDUCATOR_RESOURCE_SCHEMA_VERSION}.`);
  const runtimes = uniqueRecords(definition.runtimes, 'runtimes', normalizeRuntime);
  const runtimeIds = new Set(runtimes.map(({ id }) => id));
  const resource = {
    schemaVersion: EDUCATOR_RESOURCE_SCHEMA_VERSION,
    id: identifier(definition.id, 'id'),
    label: text(definition.label, 'label', 120),
    configurationKinds: uniqueRecords(definition.configurationKinds, 'configurationKinds', normalizeContext),
    scopes: uniqueRecords(definition.scopes, 'scopes', normalizeContext),
    runtimes,
    modules: uniqueRecords(definition.modules, 'modules', (record, name) => normalizeModule(record, name, runtimeIds)),
    fixedGuardrails: Object.freeze(uniqueRecords(
      definition.fixedGuardrails,
      'fixedGuardrails',
      (record, name) => normalizeContext(record, name),
    )),
  };
  return Object.freeze(resource);
}

export function moduleEffects(resource, moduleId, runtimeId) {
  const module = resource?.modules?.find((candidate) => candidate.id === moduleId);
  if (!module) fail(`unknown module ${moduleId}.`);
  if (!resource?.runtimes?.some((runtime) => runtime.id === runtimeId)) fail(`unknown runtime ${runtimeId}.`);
  return module.effects[runtimeId];
}

function profileText(value, name, { required = true, maximum = 8000 } = {}) {
  if (typeof value !== 'string') fail(`${name} must be a string.`);
  const normalized = value.trim();
  if (required && !normalized) fail(`${name} is required.`);
  if (value.length > maximum) fail(`${name} must contain no more than ${maximum} characters.`);
  return normalized;
}

export function normalizeTeachingProfile(value, { contextIds = [] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('teaching profile must be an object.');
  const expectedKeys = ['schemaVersion', 'focus', 'evidence', 'questions', 'privacy', 'contextAdjustments'];
  const keys = Object.keys(value);
  if (keys.some((key) => !expectedKeys.includes(key)) || expectedKeys.some((key) => !keys.includes(key))) {
    fail('teaching profile fields do not match the supported schema.');
  }
  if (value.schemaVersion !== TEACHING_PROFILE_SCHEMA_VERSION) {
    fail(`teaching profile schemaVersion must be ${TEACHING_PROFILE_SCHEMA_VERSION}.`);
  }
  if (!value.contextAdjustments || typeof value.contextAdjustments !== 'object' || Array.isArray(value.contextAdjustments)) {
    fail('teaching profile contextAdjustments must be an object.');
  }
  const allowedContexts = new Set(contextIds);
  const adjustmentKeys = Object.keys(value.contextAdjustments);
  if (adjustmentKeys.some((key) => !allowedContexts.has(key)) || contextIds.some((key) => !adjustmentKeys.includes(key))) {
    fail('teaching profile contextAdjustments do not match the registered contexts.');
  }
  const contextAdjustments = Object.fromEntries(contextIds.map((contextId) => [
    contextId,
    profileText(value.contextAdjustments[contextId], `contextAdjustments.${contextId}`, { required: false, maximum: 4000 }),
  ]));
  return Object.freeze({
    schemaVersion: TEACHING_PROFILE_SCHEMA_VERSION,
    focus: profileText(value.focus, 'focus'),
    evidence: profileText(value.evidence, 'evidence'),
    questions: profileText(value.questions, 'questions'),
    privacy: profileText(value.privacy, 'privacy'),
    contextAdjustments: Object.freeze(contextAdjustments),
  });
}

function normalizeProgressionStage(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object.`);
  const expectedKeys = ['guidance', 'materials'];
  const keys = Object.keys(value);
  if (keys.some((key) => !expectedKeys.includes(key)) || expectedKeys.some((key) => !keys.includes(key))) {
    fail(`${name} fields do not match the supported schema.`);
  }
  return Object.freeze({
    guidance: profileText(value.guidance, `${name}.guidance`, { required: false, maximum: 2500 }),
    materials: profileText(value.materials, `${name}.materials`, { required: false, maximum: 4000 }),
  });
}

function normalizeProgressionPart(value, name, stageIds, allowedScaleIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object.`);
  const expectedKeys = ['id', 'label', 'scaleIds', 'stages'];
  const keys = Object.keys(value);
  if (keys.some((key) => !expectedKeys.includes(key)) || expectedKeys.some((key) => !keys.includes(key))) {
    fail(`${name} fields do not match the supported schema.`);
  }
  if (!Array.isArray(value.scaleIds) || value.scaleIds.length < 1) fail(`${name}.scaleIds must be a non-empty array.`);
  const scaleIds = value.scaleIds.map((scaleId, index) => identifier(scaleId, `${name}.scaleIds[${index}]`));
  if (new Set(scaleIds).size !== scaleIds.length) fail(`${name}.scaleIds must not contain duplicates.`);
  if (scaleIds.some((scaleId) => !allowedScaleIds.has(scaleId))) fail(`${name}.scaleIds contains an unsupported scale.`);
  if (!value.stages || typeof value.stages !== 'object' || Array.isArray(value.stages)) {
    fail(`${name}.stages must be an object.`);
  }
  const allowedStages = new Set(stageIds);
  const suppliedStages = Object.keys(value.stages);
  if (suppliedStages.some((key) => !allowedStages.has(key)) || stageIds.some((key) => !suppliedStages.includes(key))) {
    fail(`${name}.stages do not match the registered progression.`);
  }
  return Object.freeze({
    id: identifier(value.id, `${name}.id`),
    label: profileText(value.label, `${name}.label`, { maximum: 120 }),
    scaleIds: Object.freeze(scaleIds),
    stages: Object.freeze(Object.fromEntries(stageIds.map((stageId) => [
      stageId,
      normalizeProgressionStage(value.stages[stageId], `${name}.stages.${stageId}`),
    ]))),
  });
}

// Preserve this legacy field as JSON data only; it does not alter course behavior.
function cloneIntakeQuestions(value) {
  const ancestors = new WeakSet();
  let remaining = 60_000;
  const charge = (size) => {
    remaining -= size;
    if (remaining < 0) fail('course progression is too large.');
  };
  const visit = (item, depth = 0) => {
    if (depth > 64) fail('intakeQuestions exceeds the supported JSON depth.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item))) {
      charge(JSON.stringify(item).length);
      return;
    }
    if (!item || typeof item !== 'object' || ancestors.has(item)) fail('intakeQuestions must contain finite JSON data.');
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      fail('intakeQuestions must contain finite JSON data.');
    }
    const fields = Object.getOwnPropertyDescriptors(item);
    if (Object.getOwnPropertySymbols(item).length) fail('intakeQuestions must contain finite JSON data.');
    const keys = Object.keys(fields).filter((key) => !Array.isArray(item) || key !== 'length');
    if (Array.isArray(item) && (keys.length !== item.length || keys.some((key, index) => key !== String(index)))) {
      fail('intakeQuestions must contain finite JSON data.');
    }
    ancestors.add(item);
    charge(2 + Math.max(0, keys.length - 1));
    for (const key of keys) {
      const field = fields[key];
      if (!Object.hasOwn(field, 'value') || !field.enumerable) fail('intakeQuestions must contain finite JSON data.');
      if (!Array.isArray(item)) charge(JSON.stringify(key).length + 1);
      visit(field.value, depth + 1);
    }
    ancestors.delete(item);
  };
  visit(value);
  return JSON.parse(JSON.stringify(value));
}

export function normalizeCourseProgression(value, { stageIds = [], scaleIds = [] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('course progression must be an object.');
  const expectedKeys = ['schemaVersion', 'parts'];
  const optionalKeys = ['intakeQuestions', 'fieldNotesQuestions'];
  const keys = Object.keys(value);
  if (keys.some((key) => !expectedKeys.includes(key) && !optionalKeys.includes(key)) || expectedKeys.some((key) => !keys.includes(key))) {
    fail('course progression fields do not match the supported schema.');
  }
  if (value.schemaVersion !== COURSE_PROGRESSION_SCHEMA_VERSION) {
    fail(`course progression schemaVersion must be ${COURSE_PROGRESSION_SCHEMA_VERSION}.`);
  }
  const allowedScaleIds = new Set(scaleIds);
  const parts = uniqueRecords(
    value.parts,
    'parts',
    (part, name) => normalizeProgressionPart(part, name, stageIds, allowedScaleIds),
  );
  const suppliedScaleIds = parts.flatMap((part) => part.scaleIds);
  if (new Set(suppliedScaleIds).size !== suppliedScaleIds.length) fail('course progression assigns a scale to more than one part.');
  if (suppliedScaleIds.length !== scaleIds.length || scaleIds.some((scaleId) => !suppliedScaleIds.includes(scaleId))) {
    fail('course progression parts do not cover the registered scales.');
  }
  const optionalFields = {};
  if (Object.hasOwn(value, 'fieldNotesQuestions')) {
    const questions = value.fieldNotesQuestions;
    if (!questions || typeof questions !== 'object' || Array.isArray(questions)
      || Object.keys(questions).length !== scaleIds.length
      || Object.keys(questions).some(key => !allowedScaleIds.has(key))) fail('Field Notes questions must cover each registered scale.');
    optionalFields.fieldNotesQuestions = Object.freeze(Object.fromEntries(scaleIds.map(scale => [
      scale, text(questions[scale], `fieldNotesQuestions.${scale}`, FIELD_NOTES_QUESTION_LIMIT),
    ])));
  }
  if (Object.hasOwn(value, 'intakeQuestions')) {
    const field = Object.getOwnPropertyDescriptor(value, 'intakeQuestions');
    if (!Object.hasOwn(field, 'value')) fail('intakeQuestions must contain finite JSON data.');
    optionalFields.intakeQuestions = cloneIntakeQuestions(field.value);
  }
  const normalized = Object.freeze({
    schemaVersion: COURSE_PROGRESSION_SCHEMA_VERSION,
    parts: Object.freeze(parts),
    ...optionalFields,
  });
  const serialized = JSON.stringify(normalized);
  if (serialized.length > 60_000 || (Object.hasOwn(optionalFields, 'intakeQuestions')
    && new TextEncoder().encode(serialized).length > 60_000)) fail('course progression is too large.');
  return normalized;
}
