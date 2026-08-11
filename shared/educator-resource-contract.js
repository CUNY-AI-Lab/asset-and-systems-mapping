export const EDUCATOR_RESOURCE_SCHEMA_VERSION = 'cuny.educator-resource.v1';
export const EDUCATOR_TRIAL_STATUSES = Object.freeze(['draft', 'active', 'retired']);
export const EDUCATOR_MODULE_EFFECTS = Object.freeze([
  'provenance',
  'student-projection',
  'teacher-artifact',
  'runtime-behavior',
]);
export const TEACHING_PROFILE_SCHEMA_VERSION = 'cuny.teaching-profile.v1';

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
