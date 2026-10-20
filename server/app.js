import { appendCoursePrompt } from '../shared/course-prompt.js';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';
import { STUDENT_JUDGMENT_INSTRUCTION, validateStudentJudgments } from '../shared/student-judgments.js';
import { MAP_CHECK_INTENTS, MAP_CHECK_LIMITS, MEMO_REVIEW_SCALE_LIMITS } from '../shared/memo-review-limits.js';
import { fieldNotesQuestions } from '../shared/field-notes.js';
import { FIELD_NOTES_CONTEXT_INSTRUCTION, validateFieldNotesContext } from '../shared/field-notes-context.js';
import {
  containsRetiredSystemsLanguage,
  deterministicMemoReview,
  EXOSPHERE_NODE_TYPES,
  isDiscreteMicroNodeLabel,
  isStatementMapElementLabel,
  isObviousLowerLevelMacroLabel,
  isNamedInstitutionLabel,
  isMesosystemLabel,
  isNodeTypeAllowedAtScale,
  MACROSPHERE_NODE_TYPES,
  MESOSYSTEM_NODE_TYPE,
  MICRO_SETTING_NODE_TYPES,
  NODE_TYPES,
  normalizeMapElementLabel,
  normalizeMicroNodeLabel,
  PROJECT_LIMITS,
  SCALE_VERB_LEXICONS,
  scaleLexiconVerb,
} from '../src/domain.js';
import {
  SYSTEMS_MAPPING_STAGE_IDS,
  SYSTEMS_MAPPING_STAGES,
  systemsMappingStage,
} from '../shared/systems-mapping-stages.js';
import {
  STUDENT_WORKFLOW_EVALUATION_EVENT,
  validateStudentWorkflowEvaluationMetadata,
} from '../shared/student-workflow-evaluation.js';
import {
  clearSession,
  clearStudentSession,
  consumePasswordReset,
  constantTimeSecretEqual,
  currentStudentSession,
  currentTeacherSession,
  currentUser,
  hashPassphrase,
  issueSession,
  issueStudentSession,
  setSessionCookie,
  setStudentSessionCookie,
  validatePassphrase,
  validPasswordResetToken,
  verifyPassphrase,
} from './auth.js';
import {
  composeEffectivePrompt,
  CONFIG_KINDS,
  coursePartsForTeachingProfile,
  EFFECTIVE_SCALES,
  fingerprint,
  FIXED_GUARDRAILS,
  normalizeSystemsMappingTeachingProfile,
  SYSTEMS_MAPPING_EDUCATOR_RESOURCE,
  teachingProfileFingerprint,
} from './config.js';
import {
  inTransaction,
  openDataStore,
  prototypeEventAudit,
  studentWorkflowEvaluationReport,
} from './database.js';
import { OllamaCloudError, OLLAMA_CLOUD_LIMITS, requestOllamaSuggestion } from './ollama.js';
import { parseRetentionHoldUntil, retentionCleanupAllowed } from './retention.js';

const DEFAULT_TEACHER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_STUDENT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_PROTOTYPE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PREFLIGHT_SUBMISSION_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_PREFLIGHT_EVALUATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PREFLIGHT_PENDING_RETENTION_DAYS = 30;
const DEFAULT_PREFLIGHT_DECIDED_RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SAVED_PROJECT_TTL_MS = 90 * DAY_MS;
const DEFAULT_CLASS_CODE = '101';
const UNRECORDED_INQUIRY = '[not collected]';
const JSON_BODY_LIMIT_BYTES = 64 * 1024;
const CLASS_CODE_BODY_LIMIT_BYTES = 1024;
const AUTH_BODY_LIMIT_BYTES = 8 * 1024;
const PROTOTYPE_BODY_LIMIT_BYTES = 2 * 1024;
const PREFLIGHT_SUBMISSION_BODY_LIMIT_BYTES = 768 * 1024;
const PREFLIGHT_CONSUME_BODY_LIMIT_BYTES = 8 * 1024;
const PREFLIGHT_DECISION_BODY_LIMIT_BYTES = 96 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const STUDENT_ATTEMPT_BUCKET = 'loopback-student-access';
const TEACHER_ATTEMPT_BUCKET = 'loopback-teacher-auth';
const PROTOTYPE_RATE_BUCKET = 'loopback-prototype-events';
const STUDENT_SESSION_ISSUE_BUCKET = 'student-session-issuance';
const SAVED_PROJECT_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const SAVED_PROJECT_JSON_LIMIT = 2_000_000;
const SAVED_PROJECT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
const PREFLIGHT_SCALES = new Set(['micro', 'meso', 'exosphere', 'macrosphere']);
const PREFLIGHT_STATUSES = new Set(['pending', 'approved', 'rejected']);
const PREFLIGHT_DECISIONS = new Set(['approve', 'revise_and_approve', 'reject']);
const STUDENT_REDIRECT_ACTION_MAX_CHARS = 500;
const STUDENT_REDIRECT_EVIDENCE_MAX_CHARS = 280;
const PROJECT_METADATA_RULES = Object.freeze({
  id: { type: 'string', max: 200 },
  projectId: { type: 'string', max: 200 },
  submissionId: { type: 'string', max: 200 },
  title: { type: 'string', max: 500, empty: true },
  participantName: { type: 'string', max: 500, empty: true },
  author: { type: 'string', max: 500, empty: true },
  date: { type: 'string', max: 100, empty: true },
  sourceType: { type: 'string', max: 500, empty: true },
  sourceTitle: { type: 'string', max: 500, empty: true },
  sharingTier: { type: 'enum', values: ['private', 'course', 'CUNY', 'public'] },
  schemaVersion: { type: 'integer', min: 1, max: 100 },
  stage: { type: 'integer', min: 0, max: 6 },
  furthestStage: { type: 'integer', min: 0, max: 6 },
  clientUpdatedAt: { type: 'timestamp' },
});
const SOURCE_RECORD_KEYS = Object.freeze([
  'id', 'title', 'author', 'date', 'sourceType', 'location', 'rights',
  'sensitive', 'consent', 'evidenceOwnership', 'fileName', 'fileSize', 'revision', 'fingerprint',
]);
const PROJECT_OVERLAY_KEYS = Object.freeze([
  'id', 'profileVersion', 'outputSchemaVersion', 'label', 'provider', 'baseModel',
  'customInstructions', 'contextLimit', 'confidenceThreshold', 'relationVocabulary', 'revision', 'fingerprint',
]);
const MEMO_REVIEW_NODE_TYPES = NODE_TYPES;
const MEMO_REVIEW_LIMITS = Object.freeze({
  guidance: 3, nodes: 20, connections: 12, point: 500, evidence: 500,
  label: 200, verb: 100, rationale: 1000, example: 1000, note: 500,
});
// Per-level ceilings keep the review focused: a student decides on a handful
// of strong, concrete items instead of triaging everything the model can find.
// Macrosphere structures carry a scope (mapped elements they condition)
// instead of connections.
// MEMO_REVIEW_SCALE_LIMITS lives in shared/memo-review-limits.js so the
// Gateway adapter's compact instruction cannot drift from the validator.
const OLLAMA_SUGGESTION_SCHEMA_INSTRUCTION = [
  STUDENT_JUDGMENT_INSTRUCTION,
  FIELD_NOTES_CONTEXT_INSTRUCTION,
  'MEMO REVIEW JSON CONTRACT',
  'Read the student memo as an interested, encouraging reviewer. Ground every statement in the memo itself, quoting or closely paraphrasing actual passages. Do not score, grade, or rate the memo, and do not use rubric labels or criterion identifiers.',
  'Return one object with exactly these keys: guidance, nodes, connections, example, readiness.',
  'BE SELECTIVE. Propose only the clearest, best-evidenced items and stop: no more than 10 nodes and 8 direct relationships at Micro, 6 mesosystems at Meso, 6 new outside decision settings with 5 pathways at Exosphere, and 6 structures at Macrosphere. Fewer strong items always beat more weak ones. Never propose near-duplicates, spelling variants, or two labels for the same actor.',
  `guidance must be an array of no more than 3 objects, each with a required point and an optional evidenceExcerpt quoting the memo passage it refers to. Each point should either name something the memo already supports or raise a genuine question worth pursuing. Never tell the student to return to or rewrite the memo; suggest what to strengthen in place or carry forward to the map.`,
  `nodes must be an array of objects with exactly these keys: label, type, scale, evidence — plus scope at Meso, basis at Exosphere and Macrosphere, and deontic and scope at Macrosphere. type must be one of ${MEMO_REVIEW_NODE_TYPES.join(', ')}. scale must be one of micro, meso, exosphere, macrosphere. evidence must quote or closely paraphrase the memo passage that supports the node — or, for an inferred item, say plainly what the student should verify.`,
  'Except at Meso, each node label MUST be the shortest complete memo-supported referring expression for exactly one accepted map element. Resolve every pronoun or coreference to a concrete named or role-resolved label supported by the memo; if the referent is not unambiguous, omit it. Never attach location, schedule, action, relationship, or explanatory material merely to make a label longer; keep those details in evidence, and emit a separately supported setting only when it is independently relevant. Never use pronouns, possessive references, dates, times, schedules, frequency phrases, modifiers, quantifiers, action verbs, clauses, fragments, relationship propositions, outcomes, or explanations as node labels. At Meso, each node instead names one mesosystem formed by two or more Micro settings. Never invent abstractions such as "Access to Services" or "Community Wellbeing". Preserve complete official names even when they are long.',
  'Use literal, conventional instructional language throughout. Do not use invented category labels, slogans, or figurative spatial descriptions in node labels, guidance, examples, or readiness notes.',
  'Keep every suggestion and every sentence of guidance within the active scale. At Macrosphere, discuss only validated broader conditions and the map items they affect; do not discuss missing institutions or outside decision pathways. At Exosphere, discuss only named outside decision settings and their supported pathways into immediate settings. Call these Exo-level connections in student-facing text. At Meso, discuss only interrelations among Micro settings. At Micro, discuss only discrete immediate elements and direct relationships.',
  'SCALE BOUNDARIES — assign each item by the focal person\'s participation and the pathway of effect, never by entity kind, size, or fame. Micro identifies immediate settings the person participates in, their people, roles, activities, objects, and resources, and direct interactions. A named organization, institution, agency, or service remains at Micro when the person participates there directly. Meso identifies only a noun-labeled interrelation among two or more of those Micro settings; it is not another place to add entities or directional connections. Exosphere identifies outside decision settings whose actions reach an immediate Micro setting even though the person does not participate in the decision setting. Macrosphere identifies broader laws, public policies, economic conditions, histories, structures, and cultural beliefs that shape multiple parts of the map. Do not restate lower-level items at a higher level.',
  `At Micro, propose only bounded people, roles, groups, immediate settings, named activities, tangible objects, or resources that the memo supports. Preserve an organization, institution, agency, or service as its actual entity type while assigning it to Micro when the focal person participates there. A named activity must still be a complete noun phrase, never the action verb or a sentence fragment. A Micro setting used at Meso may have one of these types: ${MICRO_SETTING_NODE_TYPES.join(', ')}. At Exosphere, node type MUST be one of: ${EXOSPHERE_NODE_TYPES.join(', ')}. At Macrosphere, node type MUST be one of: ${MACROSPHERE_NODE_TYPES.join(', ')}. At Exosphere and Macrosphere, DO NOT limit yourself to what the memo names: examine the carried map for outside decision settings that act indirectly and broader conditions that shape several map items. Set basis to "memo" when the memo names the item, or "inference" when the item is inferred from the mapped context; its evidence must say what to verify.`,
  'When the project input includes carriedNodes, those elements are ALREADY on the student\'s map. Never repeat one in nodes. At Meso, each scope entry must use the exact ID of a Micro setting already on the map. At Exosphere, connections may use an existing Micro setting\'s exact label as the endpoint of an outside decision pathway. At Macrosphere, scope entries must use exact IDs from carriedNodes and must never refer to another Macrosphere item.',
  'When the project input includes carriedConnections, those relationships are ALREADY on the student\'s map. Never propose a connection that repeats one.',
  `connections must be an array of objects with exactly these keys: source, target, verb, rationale. At Micro, source and target must exactly match accepted node labels or exact supplied node IDs, endpoints must differ, and the rationale must point to direct evidence for a relationship among accepted Micro elements, including resources and directly participated institutions or services. A person, role, or group may directly attend, use, visit, receive from, or otherwise interact with a setting; only setting-to-setting interrelations are excluded from Micro and belong at Meso. Never turn a schedule fact, unresolved coreference fragment, or invented noun phrase into a Micro connection. At Meso and Macrosphere, connections MUST be empty. For Exosphere, every connection MUST join one proposed outside decision setting to one carried Micro setting, endpoints must differ, verb MUST be exactly one of: ${SCALE_VERB_LEXICONS.exosphere.join(', ')}. rationale must identify the supported decision or resource pathway.`,
  'At Micro, use a short plain active verb phrase for a concrete action or exchange that matters to the mapped situation. Do not use mere co-residence or co-presence, vague collaboration, or generic planning as a relationship unless the memo makes that tie analytically consequential and names what passes between the endpoints.',
  `At Meso each node must have type "${MESOSYSTEM_NODE_TYPE}", a neutral noun-phrase label that names the interrelation with a relational noun such as "coordination", "communication", "overlap", "conflict", or "transition", and a scope containing the exact IDs of 2 or more Micro settings already on the map. A Micro setting may have one of these types: ${MICRO_SETTING_NODE_TYPES.join(', ')}. Meso represents the interrelation of those settings and never adds a directional connection. Never propose a university, employer, registrar, bursar, office, agency, program, service, administrative system, or other entity as a new Meso node. An organization, institution, agency, or service already mapped as a directly participated Micro setting may appear only through its exact scope ID.`,
  'At Meso, guidance and readiness text may discuss only the proposed interrelations and the human-readable labels of their scoped Micro settings. Never tell the student to add an institution, office, administrator, employer, service, policy, or other entity at Meso.',
  'EXOSPHERE/MACROSPHERE BOUNDARY: Exosphere is a relational placement, not an institution category. Place a concrete institution or service at Micro when the focal person participates there; place it at Exosphere only when its relevant decisions occur outside the immediate settings and a supported pathway reaches a Micro setting. An operational rule explicitly owned by that named outside decision setting may remain at Exosphere. Macrosphere is reserved for broader laws, public policies, economic conditions, histories, cultural beliefs, and structures. Never repeat a concrete institution as a Macrosphere condition.',
  `EXOSPHERE FINAL CHECK: every node label must be a specific proper name, official acronym, named service, named public-benefit program, or operational rule explicitly scoped to a named outside decision setting. A generic category is not an Exosphere node: omit labels such as "home care agency", "legal services office", "scheduling office", "union", "employer", "benefits office", "service system", or an unnamed hospital, college, clinic, center, program, or agency. An inferred node must still supply a specific proper name and mark basis "inference"; otherwise raise the gap only in guidance. Choose node type only from: ${EXOSPHERE_NODE_TYPES.join(', ')}. Every proposed Exosphere node must have one connection to one carried Micro setting, never another proposed or carried outer-level item, and must use exactly one allowed Exosphere verb. Use human-readable labels rather than node IDs in guidance, rationale, readiness, and example text.`,
  `At Macrosphere each node is a structure and relates to the map through its scope, never through connections: scope must be an array of 2 or more exact IDs from carriedNodes that the structure conditions the same way, and deontic must be exactly one of: ${SCALE_VERB_LEXICONS.macrosphere.join(', ')} — how the structure operates on its scope.`,
  'For Meso, use the human-readable carriedNodes labels, not their IDs, in guidance and readiness text. For Micro and Meso, example must be null. For Exosphere and Macrosphere, example may be a short plain-language paragraph, or null, that explains one outside decision pathway or broader condition.',
  'readiness must be an object with exactly the keys ready and note. For Micro, ready means the memo supports at least two clear nodes. For Meso, ready means at least one mesosystem includes two or more Micro settings already on the map. For Exosphere, ready means at least one named outside decision setting has an evident pathway to a carried Micro setting. For Macrosphere, ready means at least one broader condition affects two or more map items. Readiness never blocks the student from continuing.',
  'FINAL OUTPUT SHAPE: return exactly five top-level keys and no wrapper or metadata: {"guidance":[],"nodes":[],"connections":[],"example":null,"readiness":{"ready":false,"note":"Short plain-language note."}}. Fill the arrays and readiness values under the active-scale rules above. Never add suggestion, review, result, activeScale, scale, confidence, metadata, or any sixth top-level key.',
  'Do not add any other keys, Markdown, or prose outside the object.',
].join('\n');
const CONNECTION_SUGGESTION_SCHEMA_INSTRUCTION = [
  STUDENT_JUDGMENT_INSTRUCTION,
  'MAP CONNECTION JSON CONTRACT',
  'The student has already chosen the nodes. Use only the exact node IDs supplied in the project input; never write a pronoun, alias, schedule phrase, or new noun phrase as an endpoint.',
  'Use the student description to suggest only direct, evidence-backed connections among those accepted nodes. Do not add nodes or facts that the student did not provide.',
  'Do not suggest a connection that already appears in existingConnections.',
  'Return one object with exactly one key: connections.',
  'connections must be an array of no more than 12 objects.',
  'Each connection must contain exactly four keys: source, target, verb, rationale.',
  'source and target must be different node IDs from the supplied nodes.',
  `At Micro, both endpoints must be accepted Micro elements and verb must name a direct relationship among people, roles, groups, settings, activities, objects, resources, or directly participated institutions and services. Direct actor-to-setting relationships are valid; never return a Micro connection between two settings, because their interrelation belongs at Meso. Never turn a schedule fact or unresolved coreference into a relationship. At Exosphere, one endpoint must be an outside Exosphere decision setting and the other an immediate Micro setting, and verb must be exactly one of: ${SCALE_VERB_LEXICONS.exosphere.join(', ')}.`,
  'At Micro, use a short plain active verb phrase for a concrete action or exchange that matters to the mapped situation. Do not use mere co-residence or co-presence, vague collaboration, or generic planning unless the student description makes that tie analytically consequential and names what passes between the endpoints.',
  'rationale must quote or closely paraphrase the exact student-description evidence for the relationship.',
  'Do not add confidence scores, evidence claims, Markdown, or prose outside the object.',
].join('\n');
const MAP_CHECK_SCHEMA_INSTRUCTION = [
  STUDENT_JUDGMENT_INSTRUCTION,
  'MAP CHECK JSON CONTRACT',
  'The student has already built this part of the map. carriedNodes and carriedConnections ARE the map. memoDetails.intent names the check: gaps, connection, or synthesis. memoDetails.focus identifies the selected item when there is one. memoDetails.scopes lists mesosystem and condition memberships as exact IDs.',
  'Never propose new map elements, relationships, labels, or evidence text. Point the student at what to verify, ask, or weigh. Use human-readable labels in point text and exact supplied IDs only in refs.',
  `Return one object with exactly one key: notes. notes is an array of 1 to ${MAP_CHECK_LIMITS.notes} objects, each with exactly the keys kind, point, refs.`,
  'kind: for gaps, "gap" or "question"; for connection, "evidence" or "question"; for synthesis, "claim" or "question".',
  `point: at most ${MAP_CHECK_LIMITS.point} characters of plain instructional language. Do not score, grade, praise, or use rubric labels.`,
  `refs: 1 to ${MAP_CHECK_LIMITS.refs} exact IDs from carriedNodes or carriedConnections that the note is about.`,
  'For gaps: name what the active level still needs given the carried map, such as a mesosystem that links only one setting, an outside decision setting without a pathway into a Micro setting, a condition that reaches only one item, or a relationship whose verb does not say what passes between its endpoints. Ask one question the memo could answer.',
  'For connection: for the focused item, say what evidence would strengthen or challenge it, which direction, frequency, or condition remains unclear, and what the student should look for in the memo or in a further source.',
  'For synthesis: offer at most two claims the map now supports in answer to the inquiry, each tied to the items that support it, and the questions that remain open.',
  'Do not add any other keys, Markdown, or prose outside the object.',
].join('\n');
const PROTOTYPE_EVENTS = new Set([
  'project_started',
  'project_resumed',
  'stage_viewed',
  'stage_completed',
  'node_moved',
  'viewport_changed',
  'map_arranged',
  'map_previewed',
  'map_preview_closed',
  'annotation_saved',
  'project_exported',
  'project_imported',
  'recovery_exported',
  STUDENT_WORKFLOW_EVALUATION_EVENT,
]);
const PROTOTYPE_STAGES = new Map(SYSTEMS_MAPPING_STAGES.map(({ label }, index) => [label, index]));
[
  ['Choose a scale', 0],
  ['Add a source', 0],
  ['Review suggestions', 1],
  ["Check your instructor's response", 1],
  ['Choose nodes and describe connections', 2],
  ['Connect the map', 2],
  ['Build the map', 3],
  ['Revise and export', 4],
].forEach(([label, index]) => PROTOTYPE_STAGES.set(label, index));
const canonicalStageId = (stageId) => ({
  'choose-scale': 'add-source',
  'check-instructor-response': 'review-suggestions',
  'connect-map': 'choose-what-to-map',
})[stageId] || stageId;
const PROTOTYPE_METADATA_RULES = Object.freeze({
  stageIndex: { type: 'integer', min: 0, max: 6 },
  sourceCount: { type: 'integer', min: 0, max: 1000 },
  nodeCount: { type: 'integer', min: 0, max: 10_000 },
  edgeCount: { type: 'integer', min: 0, max: 20_000 },
  relationshipCount: { type: 'integer', min: 0, max: 20_000 },
  annotationCount: { type: 'integer', min: 0, max: 30_000 },
  durationMs: { type: 'integer', min: 0, max: 86_400_000 },
  fromStage: { type: 'integer', min: 0, max: 6 },
  toStage: { type: 'integer', min: 0, max: 6 },
  zoomPercent: { type: 'number', min: 25, max: 400 },
  hadRecovery: { type: 'boolean' },
  keyboard: { type: 'boolean' },
  pointer: { type: 'boolean' },
  success: { type: 'boolean' },
});
const MODULE_ORDER_SQL = `CASE module_key
  WHEN 'purpose' THEN 1
  WHEN 'evidence' THEN 2
  WHEN 'privacy' THEN 3
  WHEN 'scale_rubric' THEN 4
  WHEN 'interaction' THEN 5
  WHEN 'output' THEN 6
  ELSE 99 END`;
const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'none'; worker-src 'none'; manifest-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

class HttpError extends Error {
  constructor(status, message, details, headers) {
    super(message);
    this.status = status;
    this.details = details;
    this.headers = headers;
  }
}

function generationFailureDetails(error, provider) {
  if (provider !== 'cail-gateway') return undefined;
  const details = { code: 'guidance_unavailable', retryable: error?.retryable === true };
  if (details.retryable && Number.isSafeInteger(error?.retryAfterSeconds)
    && error.retryAfterSeconds >= 1) {
    details.retryAfterSeconds = error.retryAfterSeconds;
  }
  if (error instanceof OllamaCloudError && typeof error.supportReference === 'string'
    && /^[A-Za-z0-9._-]{1,100}$/u.test(error.supportReference)) {
    details.supportReference = error.supportReference;
  }
  return details;
}

class MemoReviewSemanticError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MemoReviewSemanticError';
    this.code = 'MEMO_REVIEW_SEMANTIC_INVALID';
    this.feedback = [
      'Return a complete replacement JSON object; do not patch or explain the earlier response.',
      'The replacement must have exactly five top-level keys and no wrapper: guidance, nodes, connections, example, readiness.',
      'Every node label must be one complete, concrete noun phrase for one accepted map element.',
      'Resolve pronouns and coreference to a named or role-resolved element. Omit unresolved references, dates, times, frequencies, schedules, modifiers, quantifiers, action fragments, clauses, and dangling phrases from nodes.',
      'At Micro, return discrete immediate elements and direct memo-supported actions. Never return a relationship between two immediate settings; that interrelation belongs at Meso.',
      'At Meso, return scoped mesosystems that each use at least two supplied Micro settings. Return no relationship edge.',
      'At Exosphere, return named outside decision settings with one supported pathway into one supplied Micro setting.',
      'At Macrosphere, return broader conditions scoped to at least two supplied map items. Return no relationship edge.',
      'Every relationship endpoint must exactly match an accepted node label or supplied node ID. Use only a short, plain active verb phrase for a concrete, supported action or exchange.',
      `Validation failure: ${message}`,
    ].join('\n');
  }
}

function positiveInteger(value, name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return resolved;
}

async function boundedDatabaseHealthCheck(db, timeoutMs) {
  let timeout;
  try {
    const check = Promise.resolve().then(async () => {
      if (typeof db.healthCheck === 'function') return db.healthCheck();
      return (await db.prepare('SELECT 1 AS ok').get())?.ok === 1;
    });
    const deadline = new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
      timeout.unref?.();
    });
    return (await Promise.race([check, deadline])) === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function clockValue(now) {
  const value = Number(now());
  if (!Number.isFinite(value)) throw new TypeError('The application clock must return a finite timestamp.');
  return Math.trunc(value);
}

function isoTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Session expiry must be a valid timestamp.');
  return date.toISOString();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyKeys(record, keys) {
  if (!isPlainObject(record)) throw new HttpError(400, 'Request body must be a JSON object.');
  const allowed = new Set(keys);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new HttpError(400, 'Request body contains an unsupported field.');
  }
}

function assertOnlyNamedKeys(record, keys, name) {
  if (!isPlainObject(record)) throw new HttpError(400, `${name} must be a JSON object.`);
  const allowed = new Set(keys);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new HttpError(400, `${name} contains an unsupported field.`);
  }
}

async function parseJsonBody(context, maxBytes = JSON_BODY_LIMIT_BYTES) {
  const contentType = (context.req.header('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.');

  const rawLength = context.req.header('content-length');
  if (rawLength !== undefined) {
    if (!/^\d+$/.test(rawLength)) throw new HttpError(400, 'Content-Length must be valid.');
    if (Number(rawLength) > maxBytes) throw new HttpError(413, `Request body must be no more than ${maxBytes} bytes.`);
  }

  const reader = context.req.raw.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request body must be valid JSON.');
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, `Request body must be no more than ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function expectedSavedProjectRevision(body, context) {
  assertOnlyKeys(body, ['expectedRevision']);
  const expectedRevision = requireInteger(body.expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER);
  const ifMatch = context.req.header('if-match');
  if (ifMatch !== undefined) {
    const match = /^"([1-9]\d*)"$/.exec(ifMatch.trim());
    const headerRevision = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(headerRevision)) {
      throw new HttpError(400, 'If-Match must contain one quoted positive project revision.');
    }
    if (headerRevision !== expectedRevision) {
      throw new HttpError(400, 'If-Match must match expectedRevision.');
    }
  }
  return expectedRevision;
}

function parseSavedProjectPayload(body, context = null) {
  assertOnlyKeys(body, context ? ['project', 'expectedRevision'] : ['project']);
  if (typeof body.project !== 'string' || body.project.length < 2 || body.project.length > SAVED_PROJECT_JSON_LIMIT) {
    throw new HttpError(400, `project must be serialized JSON of 2 to ${SAVED_PROJECT_JSON_LIMIT} characters.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(body.project);
  } catch {
    throw new HttpError(400, 'project must be valid JSON.');
  }
  if (!isPlainObject(parsed)) throw new HttpError(400, 'project must be a JSON object.');
  if (typeof parsed.id !== 'string' || parsed.id.length < 1 || parsed.id.length > 200) {
    throw new HttpError(400, 'project.id must be a string of 1 to 200 characters.');
  }
  return {
    serialized: body.project,
    projectId: parsed.id,
    ...(context ? { expectedRevision: expectedSavedProjectRevision({ expectedRevision: body.expectedRevision }, context) } : {}),
  };
}

function savedProjectMetadata(row) {
  return {
    revision: row.revision,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

function assertSavedProjectActive(row, currentTime) {
  if (row.revokedAt !== null && row.revokedAt !== undefined) {
    throw new HttpError(410, 'This project link has been revoked.');
  }
  if (row.expiresAt !== null && row.expiresAt !== undefined && row.expiresAt <= currentTime) {
    throw new HttpError(410, 'This project link has expired.');
  }
}

function staleSavedProjectError(row) {
  return new HttpError(
    409,
    'This project link changed in another session. Refresh it before saving again.',
    savedProjectMetadata(row),
  );
}

function setSavedProjectEtag(context, revision) {
  context.header('ETag', `"${revision}"`);
}

function requireString(value, name, { min = 1, max = 20_000 } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw new HttpError(400, `${name} must contain at least ${min} character${min === 1 ? '' : 's'}.`);
  if (trimmed.length > max) throw new HttpError(400, `${name} must contain no more than ${max} characters.`);
  return trimmed;
}

function requireSnapshotText(value, name, { min = 1, max }) {
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be a string.`);
  if (value.trim().length < min) throw new HttpError(400, `${name} must contain at least ${min} character${min === 1 ? '' : 's'}.`);
  if (value.length > max) throw new HttpError(400, `${name} must contain no more than ${max} characters.`);
  return value;
}

function requireInteger(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function requireTimestamp(value, name) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100 || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${name} must be a valid timestamp string.`);
  }
  return value;
}

function validateProjectMetadata(value) {
  assertOnlyNamedKeys(value, Object.keys(PROJECT_METADATA_RULES), 'projectMetadata');
  if (!Object.hasOwn(value, 'id') && !Object.hasOwn(value, 'projectId')) {
    throw new HttpError(400, 'projectMetadata must include id or projectId.');
  }
  const validated = {};
  for (const [key, entry] of Object.entries(value)) {
    const rule = PROJECT_METADATA_RULES[key];
    if (rule.type === 'string') {
      validated[key] = requireSnapshotText(entry, `projectMetadata.${key}`, {
        min: rule.empty ? 0 : 1,
        max: rule.max,
      });
    } else if (rule.type === 'integer') {
      validated[key] = requireInteger(entry, `projectMetadata.${key}`, rule.min, rule.max);
    } else if (rule.type === 'timestamp') {
      validated[key] = requireTimestamp(entry, `projectMetadata.${key}`);
    } else if (!rule.values.includes(entry)) {
      throw new HttpError(400, `projectMetadata.${key} is not supported.`);
    } else {
      validated[key] = entry;
    }
  }
  const serialized = JSON.stringify(validated);
  if (Buffer.byteLength(serialized, 'utf8') > 4096) {
    throw new HttpError(400, 'projectMetadata must contain no more than 4096 serialized bytes.');
  }
  return validated;
}

function requireObjectKeys(value, keys, name) {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new HttpError(400, `${name}.${key} is required.`);
  }
}

function validateSourceRecord(value) {
  assertOnlyNamedKeys(value, SOURCE_RECORD_KEYS, 'sourceRecord');
  requireObjectKeys(value, ['id', 'sensitive', 'consent'], 'sourceRecord');
  const validated = {};
  for (const key of ['id', 'title', 'author', 'date', 'sourceType', 'location', 'rights', 'evidenceOwnership']) {
    if (!Object.hasOwn(value, key)) continue;
    const max = key === 'id' ? 200 : ['title', 'author', 'sourceType'].includes(key) ? 500 : 8000;
    validated[key] = requireSnapshotText(value[key], `sourceRecord.${key}`, { min: key === 'id' ? 1 : 0, max });
  }
  for (const key of ['sensitive', 'consent']) {
    if (typeof value[key] !== 'boolean') throw new HttpError(400, `sourceRecord.${key} must be a boolean.`);
    validated[key] = value[key];
  }
  if (value.fileName !== undefined) validated.fileName = requireSnapshotText(value.fileName, 'sourceRecord.fileName', { min: 0, max: 1000 });
  if (value.fileSize !== undefined) validated.fileSize = requireInteger(value.fileSize, 'sourceRecord.fileSize', 0, 8 * 1024 * 1024);
  if (value.revision !== undefined) validated.revision = requireInteger(value.revision, 'sourceRecord.revision', 1, Number.MAX_SAFE_INTEGER);
  if (value.fingerprint !== undefined) validated.fingerprint = requireSnapshotText(value.fingerprint, 'sourceRecord.fingerprint', { min: 1, max: 500 });
  if (Buffer.byteLength(JSON.stringify(validated), 'utf8') > 16_384) {
    throw new HttpError(400, 'sourceRecord must contain no more than 16384 serialized bytes.');
  }
  return validated;
}

function validateProjectOverlay(value) {
  validateBoundedJson(value, 'projectOverlay');
  assertOnlyNamedKeys(value, PROJECT_OVERLAY_KEYS, 'projectOverlay');
  requireObjectKeys(value, PROJECT_OVERLAY_KEYS, 'projectOverlay');
  const validated = {};
  for (const key of ['id', 'profileVersion', 'outputSchemaVersion', 'label', 'provider', 'baseModel', 'fingerprint']) {
    validated[key] = requireSnapshotText(value[key], `projectOverlay.${key}`, { min: 1, max: 500 });
  }
  validated.contextLimit = requireInteger(value.contextLimit, 'projectOverlay.contextLimit', 1, 1_000_000);
  if (typeof value.confidenceThreshold !== 'number' || !Number.isFinite(value.confidenceThreshold)
    || value.confidenceThreshold < 0 || value.confidenceThreshold > 1) {
    throw new HttpError(400, 'projectOverlay.confidenceThreshold must be a finite number between 0 and 1.');
  }
  validated.confidenceThreshold = value.confidenceThreshold;
  if (!Array.isArray(value.relationVocabulary) || value.relationVocabulary.length < 1 || value.relationVocabulary.length > 100) {
    throw new HttpError(400, 'projectOverlay.relationVocabulary must contain between 1 and 100 relationships.');
  }
  validated.relationVocabulary = value.relationVocabulary.map((verb, index) => requireSnapshotText(
    verb,
    `projectOverlay.relationVocabulary[${index}]`,
    { min: 1, max: 100 },
  ));
  validated.revision = requireInteger(value.revision, 'projectOverlay.revision', 1, Number.MAX_SAFE_INTEGER);
  const customInstructions = requireSnapshotText(
    value.customInstructions,
    'projectOverlay.customInstructions',
    { min: 0, max: 16_000 },
  );
  return { metadata: validated, customInstructions };
}

function validateBoundedJson(value, name, {
  maxDepth = 12,
  maxWork = 10_000,
  maxObjectKeys = 200,
  maxArrayItems = 1000,
  maxString = 32_000,
  maxSerialized = 65_536,
} = {}) {
  if (!isPlainObject(value)) throw new HttpError(400, `${name} must be a JSON object.`);
  let work = 0;
  const visit = (entry, depth, path) => {
    work += 1;
    if (work > maxWork) throw new HttpError(400, `${name} is too complex.`);
    if (depth > maxDepth) throw new HttpError(400, `${name} is nested too deeply.`);
    if (typeof entry === 'string') {
      if (entry.length > maxString) throw new HttpError(400, `${path} is too long.`);
      return;
    }
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new HttpError(400, `${path} must be a finite number.`);
      return;
    }
    if (entry === null || typeof entry === 'boolean') return;
    if (Array.isArray(entry)) {
      if (entry.length > maxArrayItems) throw new HttpError(400, `${path} contains too many items.`);
      entry.forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`));
      return;
    }
    if (!isPlainObject(entry)) throw new HttpError(400, `${path} contains an unsupported value.`);
    const keys = Object.keys(entry);
    if (keys.length > maxObjectKeys) throw new HttpError(400, `${path} contains too many fields.`);
    for (const key of keys) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw new HttpError(400, `${path} contains an unsupported field.`);
      }
      visit(entry[key], depth + 1, `${path}.${key}`);
    }
  };
  visit(value, 0, name);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > maxSerialized) {
    throw new HttpError(400, `${name} must contain no more than ${maxSerialized} serialized bytes.`);
  }
  return value;
}

function normalizedEntityLabel(value) {
  return String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, ' ').trim().toLocaleLowerCase();
}

function entityLabelAliases(value) {
  const raw = String(value || '').trim();
  const aliases = new Set();
  const normalized = normalizedEntityLabel(raw);
  if (normalized) aliases.add(normalized);
  for (const match of raw.matchAll(/\(([A-Z][A-Z0-9-]{1,15})\)/g)) aliases.add(normalizedEntityLabel(match[1]));
  const words = raw.match(/[A-Za-z0-9]+/g) || [];
  const significant = words.filter((word) => !/^(?:a|an|and|at|for|in|of|on|the|to|with)$/i.test(word));
  if (significant.length >= 2 && significant.length <= 8) aliases.add(significant.map((word) => word[0]).join('').toLocaleLowerCase());
  return [...aliases].filter((alias) => alias.length >= 3);
}

function macroLabelRepeatsInstitution(label, carriedNodes) {
  if (isNamedInstitutionLabel(label)) return true;
  const normalized = normalizedEntityLabel(label);
  if (!normalized) return false;
  return (Array.isArray(carriedNodes) ? carriedNodes : [])
    .filter((node) => ['organization', 'institution', 'agency', 'service'].includes(node.type) || isNamedInstitutionLabel(node.label))
    .some((node) => entityLabelAliases(node.label).some((alias) => (
      normalized === alias || normalized.startsWith(`${alias} `) || normalized.endsWith(` ${alias}`) || normalized.includes(` ${alias} `)
    )));
}

function naturalLanguageList(values) {
  if (values.length < 2) return values[0] || '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function validateGeneratedMemoReviewAtomically(value, activeScale, carriedNodes, carriedConnections) {
  const hasExactKeys = (record, required, optional = []) => {
    if (!isPlainObject(record)) return false;
    const allowed = new Set([...required, ...optional]);
    const keys = Object.keys(record);
    return required.every((key) => Object.hasOwn(record, key))
      && keys.every((key) => allowed.has(key));
  };
  const exactText = (candidate, maximum, { empty = false } = {}) => {
    if (typeof candidate !== 'string') return null;
    if (empty && candidate === '') return '';
    const collapsed = collapsedRedirectText(candidate, maximum);
    return collapsed === candidate ? collapsed : null;
  };
  if (!isPlainObject(value)) throw new MemoReviewSemanticError('The response is not a JSON object.');
  const requiredKeys = ['guidance', 'nodes', 'connections', 'example', 'readiness'];
  const valueKeys = Object.keys(value).sort();
  if (valueKeys.length !== requiredKeys.length || requiredKeys.some((key) => !Object.hasOwn(value, key))) {
    throw new MemoReviewSemanticError('The response does not contain exactly guidance, nodes, connections, example, and readiness.');
  }
  const scaleLimits = MEMO_REVIEW_SCALE_LIMITS[activeScale] || MEMO_REVIEW_SCALE_LIMITS.micro;
  if (!Array.isArray(value.guidance) || value.guidance.length > MEMO_REVIEW_LIMITS.guidance) {
    throw new MemoReviewSemanticError(`guidance must contain no more than ${MEMO_REVIEW_LIMITS.guidance} items.`);
  }
  if (!Array.isArray(value.nodes) || value.nodes.length > Math.min(scaleLimits.nodes, MEMO_REVIEW_LIMITS.nodes)) {
    throw new MemoReviewSemanticError(`nodes exceeds the ${activeScale} limit.`);
  }
  if (!Array.isArray(value.connections) || value.connections.length > Math.min(scaleLimits.connections || MEMO_REVIEW_LIMITS.connections, MEMO_REVIEW_LIMITS.connections)) {
    throw new MemoReviewSemanticError(`connections exceeds the ${activeScale} limit.`);
  }
  if ((activeScale === 'meso' || activeScale === 'macrosphere') && value.connections.length) {
    throw new MemoReviewSemanticError(`${activeScale} must use scoped nodes and an empty connections array.`);
  }
  value.guidance.forEach((item, index) => {
    if (!hasExactKeys(item, ['point'], ['evidenceExcerpt'])) {
      throw new MemoReviewSemanticError(`guidance[${index}] does not use the exact guidance fields.`);
    }
    const point = exactText(item.point, MEMO_REVIEW_LIMITS.point);
    const evidenceExcerpt = Object.hasOwn(item, 'evidenceExcerpt')
      ? exactText(item.evidenceExcerpt, MEMO_REVIEW_LIMITS.evidence)
      : null;
    if (!point || containsRetiredSystemsLanguage(point)
      || (Object.hasOwn(item, 'evidenceExcerpt') && !evidenceExcerpt)) {
      throw new MemoReviewSemanticError(`guidance[${index}] is not complete text within the response limits.`);
    }
  });
  if (!hasExactKeys(value.readiness, ['ready', 'note'])
    || typeof value.readiness.ready !== 'boolean'
    || !exactText(value.readiness.note, MEMO_REVIEW_LIMITS.note)) {
    throw new MemoReviewSemanticError('readiness must contain exactly a boolean ready value and a complete note.');
  }
  if (activeScale === 'micro' || activeScale === 'meso') {
    if (value.example !== null) throw new MemoReviewSemanticError(`${activeScale} example must be null.`);
  } else if (value.example !== null && !exactText(value.example, MEMO_REVIEW_LIMITS.example)) {
    throw new MemoReviewSemanticError('example must be null or complete text within the response limit.');
  }

  const carriedById = new Map((Array.isArray(carriedNodes) ? carriedNodes : []).map((node) => [node.id, node]));
  const carriedByExactLabel = new Map([...carriedById.values()].map((node) => [node.label, node]));
  const carriedByLowerLabel = new Map([...carriedById.values()].map((node) => [node.label.toLocaleLowerCase(), node]));
  const proposedByExactLabel = new Map();
  const proposedByLowerLabel = new Map();
  const nodeKeysByScale = {
    micro: ['label', 'type', 'scale', 'evidence'],
    meso: ['label', 'type', 'scale', 'evidence', 'scope'],
    exosphere: ['label', 'type', 'scale', 'evidence', 'basis'],
    macrosphere: ['label', 'type', 'scale', 'evidence', 'basis', 'deontic', 'scope'],
  };
  value.nodes.forEach((node, index) => {
    if (!hasExactKeys(node, nodeKeysByScale[activeScale])) throw new MemoReviewSemanticError(`nodes[${index}] does not use the exact ${activeScale} node fields.`);
    const label = exactText(node.label, MEMO_REVIEW_LIMITS.label);
    const evidence = exactText(node.evidence, MEMO_REVIEW_LIMITS.evidence);
    if (!label || !evidence || typeof node.type !== 'string' || typeof node.scale !== 'string') {
      throw new MemoReviewSemanticError(`nodes[${index}] is not a complete node object.`);
    }
    const canonicalLabel = normalizeMapElementLabel(label, { micro: activeScale === 'micro' });
    if (!canonicalLabel || canonicalLabel !== label || isStatementMapElementLabel(label)) throw new MemoReviewSemanticError(`nodes[${index}].label must name a complete map element rather than a statement.`);
    if (node.scale !== activeScale) throw new MemoReviewSemanticError(`nodes[${index}].scale does not match the active scale.`);
    if (!isNodeTypeAllowedAtScale(node.type, activeScale)) throw new MemoReviewSemanticError(`nodes[${index}].type does not belong at ${activeScale}.`);
    if (activeScale === 'micro' && !isDiscreteMicroNodeLabel(label)) throw new MemoReviewSemanticError(`nodes[${index}].label is a reference, action, clause, fragment, or non-entity Micro label.`);
    if (activeScale === 'meso' && (!isMesosystemLabel(label) || node.type !== MESOSYSTEM_NODE_TYPE)) throw new MemoReviewSemanticError(`nodes[${index}] is not a scoped mesosystem.`);
    if (activeScale === 'exosphere' && !isNamedInstitutionLabel(label)) throw new MemoReviewSemanticError(`nodes[${index}].label is not a named institution or service system.`);
    if (activeScale === 'macrosphere' && (isNamedInstitutionLabel(label) || isObviousLowerLevelMacroLabel(label))) throw new MemoReviewSemanticError(`nodes[${index}].label does not name a broader condition.`);
    if ((activeScale === 'exosphere' || activeScale === 'macrosphere') && !['memo', 'inference'].includes(node.basis)) {
      throw new MemoReviewSemanticError(`nodes[${index}].basis must be exactly memo or inference.`);
    }
    if (activeScale === 'macrosphere' && !SCALE_VERB_LEXICONS.macrosphere.includes(node.deontic)) {
      throw new MemoReviewSemanticError(`nodes[${index}].deontic must use the exact Macrosphere register.`);
    }
    const lower = label.toLocaleLowerCase();
    if (proposedByLowerLabel.has(lower) || (activeScale !== 'meso' && carriedByLowerLabel.has(lower))) throw new MemoReviewSemanticError(`nodes[${index}].label duplicates an existing or proposed element.`);
    proposedByExactLabel.set(label, node);
    proposedByLowerLabel.set(lower, node);
    if (activeScale === 'meso' || activeScale === 'macrosphere') {
      if (!Array.isArray(node.scope) || node.scope.length < 2 || node.scope.length > (scaleLimits.scope || PROJECT_LIMITS.scopeMembers)) {
        throw new MemoReviewSemanticError(`nodes[${index}].scope must contain at least two supplied node IDs.`);
      }
      const scopeIds = node.scope;
      if (scopeIds.some((id) => exactText(id, MEMO_REVIEW_LIMITS.label) !== id || !carriedById.has(id)) || new Set(scopeIds).size !== scopeIds.length) {
        throw new MemoReviewSemanticError(`nodes[${index}].scope must use unique supplied node IDs.`);
      }
      if (activeScale === 'meso' && scopeIds.some((id) => !MICRO_SETTING_NODE_TYPES.includes(carriedById.get(id)?.type))) {
        throw new MemoReviewSemanticError(`nodes[${index}].scope must contain only Micro settings.`);
      }
      if (activeScale === 'macrosphere' && scopeIds.some((id) => carriedById.get(id)?.scale === 'macrosphere')) {
        throw new MemoReviewSemanticError(`nodes[${index}].scope cannot contain another Macrosphere item.`);
      }
    }
  });

  const resolveEndpoint = (reference) => {
    if (!exactText(reference, MEMO_REVIEW_LIMITS.label)) return null;
    const carriedByReference = carriedById.get(reference) || carriedByExactLabel.get(reference);
    if (carriedByReference) return {
      node: carriedByReference,
      reference: carriedByReference.id,
      label: carriedByReference.label,
      carried: true,
    };
    const proposed = proposedByExactLabel.get(reference);
    return proposed ? { node: proposed, reference: proposed.label, label: proposed.label, carried: false } : null;
  };
  const carriedConnectionKeys = new Set((Array.isArray(carriedConnections) ? carriedConnections : [])
    .map((connection) => `${connection.source}\u0000${String(connection.verb || '').trim().toLocaleLowerCase()}\u0000${connection.target}`));
  const seenConnections = new Set();
  const expectedConnections = [];
  const connectedProposedExosphereLabels = new Set();
  value.connections.forEach((connection, index) => {
    if (!hasExactKeys(connection, ['source', 'target', 'verb', 'rationale'])) throw new MemoReviewSemanticError(`connections[${index}] does not use the exact relationship fields.`);
    const sourceResolution = resolveEndpoint(connection.source);
    const targetResolution = resolveEndpoint(connection.target);
    const verb = exactText(connection.verb, MEMO_REVIEW_LIMITS.verb);
    const rationale = exactText(connection.rationale, MEMO_REVIEW_LIMITS.rationale);
    if (!sourceResolution || !targetResolution || sourceResolution.node === targetResolution.node || sourceResolution.reference === targetResolution.reference) {
      throw new MemoReviewSemanticError(`connections[${index}] does not use two different accepted-node endpoints.`);
    }
    if (!verb || !rationale) throw new MemoReviewSemanticError(`connections[${index}] must contain a complete verb and rationale.`);
    const sourceNode = sourceResolution.node;
    const targetNode = targetResolution.node;
    if (activeScale === 'micro' && (sourceNode.scale !== 'micro' || targetNode.scale !== 'micro')) {
      throw new MemoReviewSemanticError(`connections[${index}] does not stay within Micro.`);
    }
    if (activeScale === 'micro' && MICRO_SETTING_NODE_TYPES.includes(sourceNode.type) && MICRO_SETTING_NODE_TYPES.includes(targetNode.type)) {
      throw new MemoReviewSemanticError(`connections[${index}] is an interrelation between two settings and belongs at Meso.`);
    }
    if (activeScale === 'exosphere') {
      if (!SCALE_VERB_LEXICONS.exosphere.includes(verb)) {
        throw new MemoReviewSemanticError(`connections[${index}].verb must use the exact Exosphere register.`);
      }
      const sourceIsDecisionSetting = sourceNode.scale === 'exosphere';
      const targetIsDecisionSetting = targetNode.scale === 'exosphere';
      const sourceIsImmediateSetting = sourceResolution.carried
        && sourceNode.scale === 'micro' && MICRO_SETTING_NODE_TYPES.includes(sourceNode.type);
      const targetIsImmediateSetting = targetResolution.carried
        && targetNode.scale === 'micro' && MICRO_SETTING_NODE_TYPES.includes(targetNode.type);
      if (!((sourceIsDecisionSetting && targetIsImmediateSetting)
        || (targetIsDecisionSetting && sourceIsImmediateSetting))) {
        throw new MemoReviewSemanticError(`connections[${index}] must connect one outside decision setting to one supplied Micro setting.`);
      }
      if (sourceIsDecisionSetting && !sourceResolution.carried) connectedProposedExosphereLabels.add(sourceResolution.label);
      if (targetIsDecisionSetting && !targetResolution.carried) connectedProposedExosphereLabels.add(targetResolution.label);
    }
    const key = `${sourceResolution.reference}\u0000${verb.toLocaleLowerCase()}\u0000${targetResolution.reference}`;
    if (seenConnections.has(key) || carriedConnectionKeys.has(key)) throw new MemoReviewSemanticError(`connections[${index}] repeats a relationship.`);
    seenConnections.add(key);
    expectedConnections.push({
      source: sourceResolution.reference,
      target: targetResolution.reference,
      sourceLabel: sourceResolution.label,
      targetLabel: targetResolution.label,
      verb,
      rationale,
    });
  });
  if (activeScale === 'exosphere') {
    value.nodes.forEach((node, index) => {
      if (!connectedProposedExosphereLabels.has(node.label)) {
        throw new MemoReviewSemanticError(`nodes[${index}] must have a supported pathway to a supplied Micro setting.`);
      }
    });
  }

  const normalizedReview = normalizeMemoReview(value, activeScale, 'generated memo review', carriedNodes, carriedConnections);
  // normalizeMemoReview also replays older stored reviews, where Meso and
  // Macrosphere narrative was historically derived from validated scopes.
  // Generated provider responses use their already-validated narrative
  // verbatim: accepting one response and then replacing part of it would
  // violate the atomic generation contract.
  const normalized = (activeScale === 'meso' || activeScale === 'macrosphere')
    ? {
      ...normalizedReview,
      guidance: value.guidance.map((item) => ({ ...item })),
      readiness: { ...value.readiness },
    }
    : normalizedReview;
  if (normalized.guidance.length !== value.guidance.length
    || normalized.nodes.length !== value.nodes.length || normalized.connections.length !== value.connections.length) {
    throw new MemoReviewSemanticError('One or more response items failed the complete response contract.');
  }
  if (normalized.guidance.some((item, index) => (
    item.point !== value.guidance[index].point
    || item.evidenceExcerpt !== value.guidance[index].evidenceExcerpt
  ))) throw new MemoReviewSemanticError('Guidance text was not preserved exactly.');
  normalized.nodes.forEach((node, index) => {
    const proposed = value.nodes[index];
    if (node.label !== proposed.label || node.type !== proposed.type || node.scale !== proposed.scale
      || node.evidence !== proposed.evidence || node.basis !== proposed.basis
      || node.deontic !== proposed.deontic) {
      throw new MemoReviewSemanticError(`nodes[${index}] changed during semantic normalization.`);
    }
    if (activeScale === 'meso' || activeScale === 'macrosphere') {
      const normalizedScopeIds = node.scope.map((member) => member.id);
      if (normalizedScopeIds.length !== proposed.scope.length
        || normalizedScopeIds.some((id, memberIndex) => id !== proposed.scope[memberIndex])) {
        throw new MemoReviewSemanticError(`nodes[${index}].scope changed during semantic normalization.`);
      }
    }
  });
  normalized.connections.forEach((connection, index) => {
    const expected = expectedConnections[index];
    if (!expected || ['source', 'target', 'sourceLabel', 'targetLabel', 'verb', 'rationale']
      .some((field) => connection[field] !== expected[field])) {
      throw new MemoReviewSemanticError(`connections[${index}] changed during semantic normalization.`);
    }
  });
  if (normalized.readiness.ready !== value.readiness.ready
    || normalized.readiness.note !== value.readiness.note
    || normalized.example !== value.example) {
    throw new MemoReviewSemanticError('Readiness or example content changed during semantic normalization.');
  }
  return normalized;
}

function normalizeMemoReview(value, activeScale, name = 'memo review', carriedNodes = null, carriedConnections = null) {
  if (!isPlainObject(value)) throw new HttpError(400, `${name} must be an object.`);
  if (!['guidance', 'nodes', 'connections', 'readiness', 'example'].some((key) => Object.hasOwn(value, key))) {
    throw new HttpError(400, `${name} does not follow the memo review contract.`);
  }
  validateBoundedJson(value, name, { maxSerialized: 64_000, maxObjectKeys: 400 });
  const scaleLimits = MEMO_REVIEW_SCALE_LIMITS[activeScale] || MEMO_REVIEW_SCALE_LIMITS.micro;
  const carriedNodeById = new Map((Array.isArray(carriedNodes) ? carriedNodes : []).map((node) => [node.id, node]));
  const carriedNodeByLabel = new Map([...carriedNodeById.values()].map((node) => [node.label.trim().toLocaleLowerCase(), node]));
  const carriedConnectionKeys = new Set((Array.isArray(carriedConnections) ? carriedConnections : [])
    .map((connection) => `${connection.source}\u0000${connection.verb.trim().toLocaleLowerCase()}\u0000${connection.target}`));
  const humanizeCarriedIds = (input, maximum) => {
    let text = collapsedRedirectText(input, maximum * 2);
    if (!text) return collapsedRedirectText(text, maximum);
    [...carriedNodeById.values()]
      .sort((left, right) => right.id.length - left.id.length)
      .forEach((node) => { text = text.split(node.id).join(node.label); });
    return collapsedRedirectText(text, maximum);
  };
  const guidance = (Array.isArray(value.guidance) ? value.guidance : [])
    .map((item) => {
      if (!isPlainObject(item)) return null;
      const point = humanizeCarriedIds(item.point, MEMO_REVIEW_LIMITS.point);
      if (!point || containsRetiredSystemsLanguage(point)) return null;
      const evidenceExcerpt = humanizeCarriedIds(item.evidenceExcerpt, MEMO_REVIEW_LIMITS.evidence);
      return { point, ...(evidenceExcerpt ? { evidenceExcerpt } : {}) };
    })
    .filter(Boolean)
    .slice(0, MEMO_REVIEW_LIMITS.guidance);
  const seenLabels = new Set();
  // The discrete-noun-phrase rule applies at every level. Meso is the one
  // specialized node type: a mesosystem scopes two or more carried Micro
  // settings and never stores a relationship verb.
  const nodes = (Array.isArray(value.nodes) ? value.nodes : [])
    .map((node) => {
      if (!isPlainObject(node)) return null;
      const inputLabel = collapsedRedirectText(node.label, MEMO_REVIEW_LIMITS.label);
      const literalLabel = inputLabel?.replace(/^["'“”‘’\s]+|["'“”‘’\s.!?;,]+$/g, '');
      const normalizedLabel = normalizeMicroNodeLabel(inputLabel);
      const completeNounPhrase = normalizedLabel && normalizedLabel === literalLabel;
      const label = activeScale === 'micro'
        ? (isDiscreteMicroNodeLabel(node.label) && normalizedLabel)
        : activeScale === 'meso'
          ? (isMesosystemLabel(node.label) && normalizedLabel)
          : activeScale === 'macrosphere'
            ? (!containsRetiredSystemsLanguage(literalLabel) && !isObviousLowerLevelMacroLabel(literalLabel) && literalLabel)
            : (completeNounPhrase && normalizedLabel);
      if (!label || seenLabels.has(label.toLocaleLowerCase())) return null;
      if (activeScale !== 'meso' && carriedNodeByLabel.has(label.toLocaleLowerCase())) return null;
      const outerLevel = activeScale === 'exosphere' || activeScale === 'macrosphere';
      // Meso and Macrosphere both use scopes, for different reasons. A Meso
      // scope identifies immediate settings in one mesosystem. A Macrosphere
      // scope identifies mapped elements conditioned by one structure.
      const scope = [];
      if (activeScale === 'meso' || activeScale === 'macrosphere') {
        const seenScope = new Set();
        (Array.isArray(node.scope) ? node.scope : []).forEach((entry) => {
          let resolved = null;
          if (isPlainObject(entry)) {
            const entryId = collapsedRedirectText(entry.id, MEMO_REVIEW_LIMITS.label);
            const entryLabel = collapsedRedirectText(entry.label, MEMO_REVIEW_LIMITS.label);
            if (carriedNodes === null) resolved = entryId ? { id: entryId, label: entryLabel || entryId } : null;
            else {
              const carried = carriedNodeById.get(entryId)
                || carriedNodeByLabel.get((entryLabel || entryId || '').toLocaleLowerCase());
              resolved = carried ? { id: carried.id, label: carried.label, type: carried.type, scale: carried.scale } : null;
            }
          } else {
            const reference = collapsedRedirectText(entry, MEMO_REVIEW_LIMITS.label);
            if (reference) {
              if (carriedNodes === null) resolved = { id: reference, label: reference };
              else {
                const carried = carriedNodeById.get(reference) || carriedNodeByLabel.get(reference.toLocaleLowerCase());
                resolved = carried ? { id: carried.id, label: carried.label, type: carried.type, scale: carried.scale } : null;
              }
            }
          }
          if (activeScale === 'meso' && carriedNodes !== null && !MICRO_SETTING_NODE_TYPES.includes(resolved?.type)) return;
          if (activeScale === 'macrosphere' && carriedNodes !== null && resolved?.scale === 'macrosphere') return;
          if (!resolved || containsRetiredSystemsLanguage(resolved.label) || seenScope.has(resolved.id)) return;
          seenScope.add(resolved.id);
          scope.push({ id: resolved.id, label: resolved.label });
        });
      }
      if (activeScale === 'meso' && scope.length < 2) return null;
      if (activeScale === 'macrosphere' && scope.length < 2) return null;
      if (activeScale === 'meso' && !isMesosystemLabel(label)) return null;
      const type = activeScale === 'meso'
        ? MESOSYSTEM_NODE_TYPE
        : (MEMO_REVIEW_NODE_TYPES.includes(node.type) && node.type !== MESOSYSTEM_NODE_TYPE ? node.type : null);
      if (!type) return null;
      if (!isNodeTypeAllowedAtScale(type, activeScale)) return null;
      if (activeScale === 'exosphere' && !isNamedInstitutionLabel(label)) return null;
      if (activeScale === 'macrosphere' && (containsRetiredSystemsLanguage(label) || macroLabelRepeatsInstitution(label, carriedNodes) || isObviousLowerLevelMacroLabel(label))) return null;
      seenLabels.add(label.toLocaleLowerCase());
      return {
        label,
        type,
        scale: activeScale,
        evidence: collapsedRedirectText(node.evidence, MEMO_REVIEW_LIMITS.evidence) || '',
        ...(outerLevel ? { basis: node.basis === 'inference' ? 'inference' : 'memo' } : {}),
        ...(activeScale === 'meso' ? { scope: scope.slice(0, scaleLimits.scope || 12) } : {}),
        ...(activeScale === 'macrosphere' ? {
          deontic: scaleLexiconVerb('macrosphere', node.deontic) || 'shapes',
          scope: scope.slice(0, scaleLimits.scope || 12),
        } : {}),
      };
    })
    .filter(Boolean)
    .slice(0, Math.min(scaleLimits.nodes, MEMO_REVIEW_LIMITS.nodes));
  const nodeByLower = new Map(nodes.map((node) => [node.label.toLocaleLowerCase(), node.label]));
  const nodeRecordByLower = new Map(nodes.map((node) => [node.label.toLocaleLowerCase(), node]));
  const seenConnections = new Set();
  // Meso and Macrosphere never arrive as connections. Meso uses mesosystem
  // scopes; Macrosphere uses structure scopes.
  const connections = ((activeScale === 'meso' || activeScale === 'macrosphere') ? [] : (Array.isArray(value.connections) ? value.connections : []))
    .map((connection) => {
      if (!isPlainObject(connection)) return null;
      const sourceReference = collapsedRedirectText(connection.source, MEMO_REVIEW_LIMITS.label);
      const targetReference = collapsedRedirectText(connection.target, MEMO_REVIEW_LIMITS.label);
      let source;
      let target;
      let sourceLabel;
      let targetLabel;
      if (activeScale === 'micro' && carriedNodes === null) {
        source = sourceReference;
        target = targetReference;
        sourceLabel = collapsedRedirectText(connection.sourceLabel, MEMO_REVIEW_LIMITS.label) || sourceReference;
        targetLabel = collapsedRedirectText(connection.targetLabel, MEMO_REVIEW_LIMITS.label) || targetReference;
      } else if (activeScale === 'micro') {
        const resolveMicroEndpoint = (reference) => {
          const carriedById = carriedNodeById.get(reference);
          if (carriedById) return { reference: carriedById.id, label: carriedById.label };
          const carriedByLabel = carriedNodeByLabel.get(reference.toLocaleLowerCase());
          if (carriedByLabel) return { reference: carriedByLabel.id, label: carriedByLabel.label };
          const proposed = nodeByLower.get(reference.toLocaleLowerCase());
          return proposed ? { reference: proposed, label: proposed } : null;
        };
        const resolvedSource = resolveMicroEndpoint(sourceReference);
        const resolvedTarget = resolveMicroEndpoint(targetReference);
        source = resolvedSource?.reference;
        target = resolvedTarget?.reference;
        sourceLabel = resolvedSource?.label;
        targetLabel = resolvedTarget?.label;
      } else if (carriedNodes === null) {
        // Stored reviews replay without the carried-node context, so trust the
        // id/label pairs the generation-time validation already resolved.
        source = sourceReference;
        target = targetReference;
        sourceLabel = collapsedRedirectText(connection.sourceLabel, MEMO_REVIEW_LIMITS.label) || sourceReference;
        targetLabel = collapsedRedirectText(connection.targetLabel, MEMO_REVIEW_LIMITS.label) || targetReference;
      } else {
        // Exosphere and Macrosphere endpoints may be a newly proposed node's
        // label or an already-mapped carried node. Carried endpoints keep
        // their durable graph IDs so the client cannot duplicate them.
        const resolveEndpoint = (reference) => {
          if (!reference) return null;
          const carriedById = carriedNodeById.get(reference);
          if (carriedById) return { reference: carriedById.id, label: carriedById.label, scale: carriedById.scale, type: carriedById.type, carried: true };
          const lower = reference.toLocaleLowerCase();
          const carried = carriedNodeByLabel.get(lower);
          if (carried) return { reference: carried.id, label: carried.label, scale: carried.scale, type: carried.type, carried: true };
          const proposed = nodeRecordByLower.get(lower);
          return proposed ? { reference: proposed.label, label: proposed.label, scale: proposed.scale, type: proposed.type, carried: false } : null;
        };
        const resolvedSource = resolveEndpoint(sourceReference);
        const resolvedTarget = resolveEndpoint(targetReference);
        if (activeScale === 'exosphere') {
          const sourceIsDecisionSetting = resolvedSource?.scale === 'exosphere';
          const targetIsDecisionSetting = resolvedTarget?.scale === 'exosphere';
          const sourceIsImmediateSetting = resolvedSource?.carried && resolvedSource.scale === 'micro'
            && MICRO_SETTING_NODE_TYPES.includes(resolvedSource.type);
          const targetIsImmediateSetting = resolvedTarget?.carried && resolvedTarget.scale === 'micro'
            && MICRO_SETTING_NODE_TYPES.includes(resolvedTarget.type);
          if (!((sourceIsDecisionSetting && targetIsImmediateSetting)
            || (targetIsDecisionSetting && sourceIsImmediateSetting))) return null;
        }
        source = resolvedSource?.reference;
        target = resolvedTarget?.reference;
        sourceLabel = resolvedSource?.label;
        targetLabel = resolvedTarget?.label;
      }
      let verb = collapsedRedirectText(connection.verb, MEMO_REVIEW_LIMITS.verb);
      // The institutional register is closed at generation time; stored
      // reviews replay whatever verb was resolved when they were generated.
      if (activeScale === 'exosphere' && carriedNodes !== null && verb) verb = scaleLexiconVerb('exosphere', verb);
      if (activeScale === 'micro') {
        const endpointNode = (reference, label) => carriedNodeById.get(reference)
          || carriedNodeByLabel.get(String(label || reference || '').toLocaleLowerCase())
          || nodeRecordByLower.get(String(label || reference || '').toLocaleLowerCase());
        const sourceNode = endpointNode(source, sourceLabel);
        const targetNode = endpointNode(target, targetLabel);
        if (MICRO_SETTING_NODE_TYPES.includes(sourceNode?.type) && MICRO_SETTING_NODE_TYPES.includes(targetNode?.type)) return null;
      }
      if (!source || !target || source === target || !verb
        || containsRetiredSystemsLanguage(sourceLabel) || containsRetiredSystemsLanguage(targetLabel)) return null;
      const key = `${source}\u0000${verb.toLocaleLowerCase()}\u0000${target}`;
      if (seenConnections.has(key) || carriedConnectionKeys.has(key)) return null;
      seenConnections.add(key);
      return {
        source,
        target,
        ...(sourceLabel ? { sourceLabel } : {}),
        ...(targetLabel ? { targetLabel } : {}),
        verb,
        rationale: humanizeCarriedIds(connection.rationale, MEMO_REVIEW_LIMITS.rationale) || '',
      };
    })
    .filter(Boolean)
    .slice(0, Math.min(scaleLimits.connections || MEMO_REVIEW_LIMITS.connections, MEMO_REVIEW_LIMITS.connections));
  // Meso's model prose is not authoritative scale classification. Build the
  // student-facing guidance from the scoped settings that passed validation,
  // so a provider cannot tell students to place registrars, employers, or
  // other institutions at Meso even when it returns a malformed explanation.
  const studentGuidance = activeScale === 'meso'
    ? nodes.map((node) => ({
      point: `Review whether ${naturalLanguageList(node.scope.map(({ label }) => label))} form one mesosystem.`,
    })).slice(0, MEMO_REVIEW_LIMITS.guidance)
    : activeScale === 'macrosphere'
      ? nodes.map((node) => ({
        point: `Review the effects of ${node.label} on ${naturalLanguageList(node.scope.map(({ label }) => label))}.`,
      })).slice(0, MEMO_REVIEW_LIMITS.guidance)
      : guidance;
  const providerExample = humanizeCarriedIds(value.example, MEMO_REVIEW_LIMITS.example);
  const example = activeScale === 'micro' || activeScale === 'meso' || containsRetiredSystemsLanguage(providerExample)
    ? null
    : providerExample || null;
  const storedLegacyMeso = activeScale === 'meso' && carriedNodes === null && nodes.length === 0;
  let readinessNote = humanizeCarriedIds(isPlainObject(value.readiness) ? value.readiness.note : null, MEMO_REVIEW_LIMITS.note) || '';
  if (containsRetiredSystemsLanguage(readinessNote)) readinessNote = '';
  if (activeScale === 'meso') {
    readinessNote = nodes.length > 0
      ? `The review found ${nodes.length} possible ${nodes.length === 1 ? 'mesosystem' : 'mesosystems'} among Micro settings already on the map.`
      : 'No supported interrelation among two or more Micro settings was found. You can continue and identify the settings that form a mesosystem.';
  }
  if (activeScale === 'macrosphere') {
    readinessNote = nodes.length > 0
      ? nodes.length === 1
        ? 'The review found 1 possible Macrosphere condition affecting at least two map items.'
        : `The review found ${nodes.length} possible Macrosphere conditions, each affecting at least two map items.`
      : 'No supported Macrosphere condition affecting at least two map items was found. You can revise the memo or continue without adding one.';
  }
  if (storedLegacyMeso) readinessNote = 'This earlier Meso review needs to be refreshed. Meso now identifies interrelations among two or more Micro settings.';
  const readiness = {
    ready: activeScale === 'micro'
      ? nodes.length + carriedNodeById.size >= 2
      : activeScale === 'meso'
        ? nodes.length >= 1
        : isPlainObject(value.readiness) && value.readiness.ready === true,
    note: readinessNote,
  };
  return {
    guidance: storedLegacyMeso ? [{ point: 'Refresh this review to identify mesosystems from the settings already mapped in Micro.' }] : studentGuidance,
    nodes,
    connections,
    example: storedLegacyMeso ? null : example,
    readiness,
  };
}

function validatePreflightEvaluationRequest(value) {
  assertOnlyKeys(value, [
    'projectMetadata', 'activeScale', 'stageId', 'inquiry', 'sourceRecord', 'sourceMaterial', 'projectOverlay', 'carriedNodes', 'carriedConnections', 'studentJudgments', 'fieldNotes',
  ]);
  const projectMetadata = validateProjectMetadata(value.projectMetadata);
  if (!PREFLIGHT_SCALES.has(value.activeScale)) throw new HttpError(400, 'activeScale is not supported.');
  const hasCarriedNodes = Object.hasOwn(value, 'carriedNodes');
  if (value.activeScale === 'meso' && !hasCarriedNodes) throw new HttpError(400, 'carriedNodes is required for Meso.');
  if (hasCarriedNodes && (!Array.isArray(value.carriedNodes) || value.carriedNodes.length > PROJECT_LIMITS.nodes)) {
    throw new HttpError(400, `carriedNodes must contain no more than ${PROJECT_LIMITS.nodes} items.`);
  }
  const seenCarriedNodeIds = new Set();
  const carriedNodes = hasCarriedNodes ? value.carriedNodes.map((node, index) => {
    const nodeName = `carriedNodes[${index}]`;
    assertOnlyNamedKeys(node, ['id', 'label', 'type', 'scale'], nodeName);
    requireObjectKeys(node, ['id', 'label', 'type', 'scale'], nodeName);
    const id = requireSnapshotText(node.id, `${nodeName}.id`, { max: 200 });
    if (seenCarriedNodeIds.has(id)) throw new HttpError(400, `${nodeName}.id must be unique.`);
    seenCarriedNodeIds.add(id);
    const type = requireSnapshotText(node.type, `${nodeName}.type`, { max: 100 });
    if (!MEMO_REVIEW_NODE_TYPES.includes(type)) throw new HttpError(400, `${nodeName}.type is not supported.`);
    const scale = requireSnapshotText(node.scale, `${nodeName}.scale`, { max: 100 });
    if (!PREFLIGHT_SCALES.has(scale)) throw new HttpError(400, `${nodeName}.scale is not supported.`);
    if (value.activeScale === 'meso' && scale !== 'micro') throw new HttpError(400, `${nodeName}.scale must be micro for Meso review.`);
    if (value.activeScale === 'meso' && !MICRO_SETTING_NODE_TYPES.includes(type)) throw new HttpError(400, `${nodeName}.type must identify an immediate Micro setting for Meso review.`);
    const label = requireSnapshotText(node.label, `${nodeName}.label`, { max: MEMO_REVIEW_LIMITS.label });
    if (containsRetiredSystemsLanguage(label)) throw new HttpError(400, `${nodeName}.label must name the map element directly.`);
    return {
      id,
      label,
      type,
      scale,
    };
  }) : [];
  const hasCarriedConnections = Object.hasOwn(value, 'carriedConnections');
  if (hasCarriedConnections && (!Array.isArray(value.carriedConnections) || value.carriedConnections.length > PROJECT_LIMITS.edges)) {
    throw new HttpError(400, `carriedConnections must contain no more than ${PROJECT_LIMITS.edges} items.`);
  }
  const carriedConnections = hasCarriedConnections ? value.carriedConnections.map((connection, index) => {
    const connectionName = `carriedConnections[${index}]`;
    assertOnlyNamedKeys(connection, ['source', 'target', 'verb'], connectionName);
    requireObjectKeys(connection, ['source', 'target', 'verb'], connectionName);
    return {
      source: requireSnapshotText(connection.source, `${connectionName}.source`, { max: 200 }),
      target: requireSnapshotText(connection.target, `${connectionName}.target`, { max: 200 }),
      verb: requireSnapshotText(connection.verb, `${connectionName}.verb`, { max: MEMO_REVIEW_LIMITS.verb }),
    };
  }) : [];
  const stageId = canonicalStageId(value.stageId);
  if (!SYSTEMS_MAPPING_STAGE_IDS.includes(stageId)) throw new HttpError(400, 'stageId is not supported.');
  const inquiry = requireSnapshotText(value.inquiry, 'inquiry', { min: 0, max: 8000 });
  const sourceRecord = validateSourceRecord(value.sourceRecord);
  let studentJudgments;
  try { studentJudgments = validateStudentJudgments(value.studentJudgments); }
  catch { throw new HttpError(400, 'Student judgments are invalid.'); }
  let fieldNotes;
  try { fieldNotes = validateFieldNotesContext(value.fieldNotes, value.activeScale); }
  catch { throw new HttpError(400, 'Previous-level Field Notes must be a bounded excerpt from the preceding scale.'); }
  const sourceMaterial = requireSnapshotText(value.sourceMaterial, 'sourceMaterial', { max: 500_000 });
  const { metadata: projectOverlay, customInstructions } = validateProjectOverlay(value.projectOverlay);
  return {
    projectMetadata,
    activeScale: value.activeScale,
    stageId,
    inquiry,
    sourceRecord,
    studentJudgments,
    fieldNotes,
    sourceMaterial,
    projectOverlay,
    customInstructions,
    carriedNodes,
    carriedConnections,
  };
}

function validateConnectionSuggestionRequest(value) {
  assertOnlyKeys(value, ['activeScale', 'inquiry', 'prompt', 'nodes', 'relationships', 'projectOverlay', 'studentJudgments']);
  let studentJudgments;
  try { studentJudgments = validateStudentJudgments(value.studentJudgments); }
  catch { throw new HttpError(400, 'Student judgments are invalid.'); }
  if (!PREFLIGHT_SCALES.has(value.activeScale)) throw new HttpError(400, 'activeScale is not supported.');
  if (value.activeScale === 'meso') throw new HttpError(400, 'Meso shows how Micro settings relate to one another. Add direct connections at Micro.');
  if (value.activeScale === 'macrosphere') throw new HttpError(400, 'Macrosphere uses structure scopes and does not use relationship edges.');
  const inquiry = requireSnapshotText(value.inquiry, 'inquiry', { min: 0, max: 8000 });
  const prompt = requireSnapshotText(value.prompt, 'prompt', { max: 4000 });
  if (!Array.isArray(value.nodes) || value.nodes.length < 2 || value.nodes.length > 50) {
    throw new HttpError(400, 'nodes must contain between 2 and 50 items.');
  }
  const nodes = value.nodes.map((node, index) => {
    const name = `nodes[${index}]`;
    assertOnlyNamedKeys(node, ['id', 'label', 'type', 'scale'], name);
    requireObjectKeys(node, ['id', 'label', 'type', 'scale'], name);
    const scale = requireSnapshotText(node.scale, `${name}.scale`, { max: 40 });
    if (!PREFLIGHT_SCALES.has(scale)) throw new HttpError(400, `${name}.scale is not supported.`);
    const label = requireSnapshotText(node.label, `${name}.label`, { max: 200 });
    if (containsRetiredSystemsLanguage(label)) throw new HttpError(400, `${name}.label must name the map element directly.`);
    return {
      id: requireSnapshotText(node.id, `${name}.id`, { max: 200 }),
      label,
      type: requireSnapshotText(node.type, `${name}.type`, { max: 100 }),
      scale,
    };
  });
  const nodeIds = new Set(nodes.map(({ id }) => id));
  if (nodeIds.size !== nodes.length) throw new HttpError(400, 'nodes must not contain duplicate IDs.');
  if (!Array.isArray(value.relationships) || value.relationships.length > 100) {
    throw new HttpError(400, 'relationships must be an array of no more than 100 items.');
  }
  const relationships = value.relationships.map((relationship, index) => {
    const name = `relationships[${index}]`;
    assertOnlyNamedKeys(relationship, ['source', 'target', 'verb'], name);
    requireObjectKeys(relationship, ['source', 'target', 'verb'], name);
    const source = requireSnapshotText(relationship.source, `${name}.source`, { max: 200 });
    const target = requireSnapshotText(relationship.target, `${name}.target`, { max: 200 });
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) {
      throw new HttpError(400, `${name} must connect two different supplied nodes.`);
    }
    return { source, target, verb: requireSnapshotText(relationship.verb, `${name}.verb`, { max: 100 }) };
  });
  const { metadata: projectOverlay, customInstructions } = validateProjectOverlay(value.projectOverlay);
  return {
    activeScale: value.activeScale,
    inquiry,
    prompt,
    studentJudgments,
    nodes,
    relationships,
    projectOverlay,
    customInstructions,
  };
}

function validateMapCheckRequest(value) {
  assertOnlyKeys(value, ['activeScale', 'intent', 'inquiry', 'memoExcerpt', 'nodes', 'relationships', 'scopes', 'focus', 'projectOverlay', 'studentJudgments']);
  let studentJudgments;
  try { studentJudgments = validateStudentJudgments(value.studentJudgments); }
  catch { throw new HttpError(400, 'Student judgments are invalid.'); }
  if (!PREFLIGHT_SCALES.has(value.activeScale)) throw new HttpError(400, 'activeScale is not supported.');
  if (typeof value.intent !== 'string' || !Object.hasOwn(MAP_CHECK_INTENTS, value.intent)) throw new HttpError(400, 'intent is not supported.');
  if (value.intent === 'synthesis' && value.activeScale !== 'macrosphere') throw new HttpError(400, 'A synthesis check belongs at Macro-level.');
  const inquiry = requireSnapshotText(value.inquiry, 'inquiry', { min: 0, max: 8000 });
  const memoExcerpt = requireSnapshotText(value.memoExcerpt, 'memoExcerpt', { min: 0, max: MAP_CHECK_LIMITS.memoExcerpt });
  if (!Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > 50) {
    throw new HttpError(400, 'nodes must contain between 1 and 50 items.');
  }
  const nodes = value.nodes.map((node, index) => {
    const name = `nodes[${index}]`;
    assertOnlyNamedKeys(node, ['id', 'label', 'type', 'scale'], name);
    requireObjectKeys(node, ['id', 'label', 'type', 'scale'], name);
    const scale = requireSnapshotText(node.scale, `${name}.scale`, { max: 40 });
    if (!PREFLIGHT_SCALES.has(scale)) throw new HttpError(400, `${name}.scale is not supported.`);
    return {
      id: requireSnapshotText(node.id, `${name}.id`, { max: 200 }),
      label: requireSnapshotText(node.label, `${name}.label`, { max: 200 }),
      type: requireSnapshotText(node.type, `${name}.type`, { max: 100 }),
      scale,
    };
  });
  const nodeIds = new Set(nodes.map(({ id }) => id));
  if (nodeIds.size !== nodes.length) throw new HttpError(400, 'nodes must not contain duplicate IDs.');
  if (!Array.isArray(value.relationships) || value.relationships.length > 100) {
    throw new HttpError(400, 'relationships must be an array of no more than 100 items.');
  }
  const relationshipIds = new Set();
  const relationships = value.relationships.map((relationship, index) => {
    const name = `relationships[${index}]`;
    assertOnlyNamedKeys(relationship, ['id', 'source', 'target', 'verb'], name);
    requireObjectKeys(relationship, ['id', 'source', 'target', 'verb'], name);
    const id = requireSnapshotText(relationship.id, `${name}.id`, { max: 200 });
    if (relationshipIds.has(id) || nodeIds.has(id)) throw new HttpError(400, `${name}.id must be unique.`);
    relationshipIds.add(id);
    const source = requireSnapshotText(relationship.source, `${name}.source`, { max: 200 });
    const target = requireSnapshotText(relationship.target, `${name}.target`, { max: 200 });
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) {
      throw new HttpError(400, `${name} must connect two different supplied nodes.`);
    }
    return { id, source, target, verb: requireSnapshotText(relationship.verb, `${name}.verb`, { max: 100 }) };
  });
  if (!Array.isArray(value.scopes) || value.scopes.length > 50) throw new HttpError(400, 'scopes must be an array of no more than 50 items.');
  const scopes = value.scopes.map((scope, index) => {
    const name = `scopes[${index}]`;
    assertOnlyNamedKeys(scope, ['id', 'memberIds'], name);
    requireObjectKeys(scope, ['id', 'memberIds'], name);
    const id = requireSnapshotText(scope.id, `${name}.id`, { max: 200 });
    if (!nodeIds.has(id)) throw new HttpError(400, `${name}.id must name a supplied node.`);
    if (!Array.isArray(scope.memberIds) || scope.memberIds.length < 1 || scope.memberIds.length > 40) throw new HttpError(400, `${name}.memberIds must contain between 1 and 40 node IDs.`);
    const memberIds = scope.memberIds.map((memberId, memberIndex) => requireSnapshotText(memberId, `${name}.memberIds[${memberIndex}]`, { max: 200 }));
    if (new Set(memberIds).size !== memberIds.length || memberIds.some((memberId) => !nodeIds.has(memberId) || memberId === id)) throw new HttpError(400, `${name}.memberIds must be distinct supplied nodes.`);
    return { id, memberIds };
  });
  let focus = null;
  if (value.focus !== null && value.focus !== undefined) {
    assertOnlyNamedKeys(value.focus, ['kind', 'id'], 'focus');
    requireObjectKeys(value.focus, ['kind', 'id'], 'focus');
    if (!['node', 'relationship', 'scope'].includes(value.focus.kind)) throw new HttpError(400, 'focus.kind is not supported.');
    const id = requireSnapshotText(value.focus.id, 'focus.id', { max: 200 });
    if (value.focus.kind === 'relationship' ? !relationshipIds.has(id) : !nodeIds.has(id)) throw new HttpError(400, 'focus.id must name a supplied map item.');
    focus = { kind: value.focus.kind, id };
  }
  if (value.intent === 'connection' && !focus) throw new HttpError(400, 'A connection check needs a focused map item.');
  const { metadata: projectOverlay, customInstructions } = validateProjectOverlay(value.projectOverlay);
  return { activeScale: value.activeScale, intent: value.intent, inquiry, memoExcerpt, studentJudgments, nodes, relationships, scopes, focus, projectOverlay, customInstructions };
}

function validateGeneratedMapCheck(value, intent, refIds) {
  validateBoundedJson(value, 'generated map check', { maxSerialized: 16_000, maxObjectKeys: 40 });
  assertOnlyNamedKeys(value, ['notes'], 'generated map check');
  requireObjectKeys(value, ['notes'], 'generated map check');
  if (!Array.isArray(value.notes) || value.notes.length < 1 || value.notes.length > MAP_CHECK_LIMITS.notes) {
    throw new HttpError(400, `generated map check must contain between 1 and ${MAP_CHECK_LIMITS.notes} notes.`);
  }
  const kinds = new Set(MAP_CHECK_INTENTS[intent]);
  return value.notes.map((note, index) => {
    const name = `notes[${index}]`;
    assertOnlyNamedKeys(note, ['kind', 'point', 'refs'], name);
    requireObjectKeys(note, ['kind', 'point', 'refs'], name);
    if (!kinds.has(note.kind)) throw new HttpError(400, `${name}.kind is not allowed for a ${intent} check.`);
    const point = requireSnapshotText(note.point, `${name}.point`, { max: MAP_CHECK_LIMITS.point }).trim();
    if (/[\u0000-\u001f\u007f]/.test(point)) throw new HttpError(400, `${name}.point contains control characters.`);
    if (!Array.isArray(note.refs) || note.refs.length < 1 || note.refs.length > MAP_CHECK_LIMITS.refs) throw new HttpError(400, `${name}.refs must contain between 1 and ${MAP_CHECK_LIMITS.refs} map IDs.`);
    const refs = note.refs.map((ref, refIndex) => requireSnapshotText(ref, `${name}.refs[${refIndex}]`, { max: 200 }));
    if (new Set(refs).size !== refs.length || refs.some((ref) => !refIds.has(ref))) throw new HttpError(400, `${name}.refs must name distinct supplied map items.`);
    return { kind: note.kind, point, refs };
  });
}

function validateGeneratedConnections(value, nodes, activeScale) {
  validateBoundedJson(value, 'generated connections', { maxSerialized: 32_000, maxObjectKeys: 80 });
  assertOnlyNamedKeys(value, ['connections'], 'generated connections');
  requireObjectKeys(value, ['connections'], 'generated connections');
  if (!Array.isArray(value.connections) || value.connections.length > 12) {
    throw new HttpError(400, 'generated connections must contain no more than 12 items.');
  }
  const seen = new Set();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return value.connections.map((connection, index) => {
    const name = `generated connections.connections[${index}]`;
    assertOnlyNamedKeys(connection, ['source', 'target', 'verb', 'rationale'], name);
    requireObjectKeys(connection, ['source', 'target', 'verb', 'rationale'], name);
    const source = requireSnapshotText(connection.source, `${name}.source`, { max: 200 });
    const target = requireSnapshotText(connection.target, `${name}.target`, { max: 200 });
    const verb = requireSnapshotText(connection.verb, `${name}.verb`, { max: 100 });
    const rationale = requireSnapshotText(connection.rationale, `${name}.rationale`, { max: 1000 });
    if (collapsedRedirectText(source, 200) !== source || collapsedRedirectText(target, 200) !== target
      || collapsedRedirectText(verb, 100) !== verb || collapsedRedirectText(rationale, 1000) !== rationale) {
      throw new HttpError(400, `${name} must use complete text without whitespace coercion.`);
    }
    const sourceNode = nodeById.get(source);
    const targetNode = nodeById.get(target);
    if (!sourceNode || !targetNode || source === target) {
      throw new HttpError(400, `${name} must connect two different supplied nodes.`);
    }
    if (activeScale === 'micro' && (sourceNode.scale !== 'micro' || targetNode.scale !== 'micro')) {
      throw new HttpError(400, `${name} must connect two Micro elements.`);
    }
    if (activeScale === 'micro' && MICRO_SETTING_NODE_TYPES.includes(sourceNode.type) && MICRO_SETTING_NODE_TYPES.includes(targetNode.type)) {
      throw new HttpError(400, `${name} is a setting-to-setting interrelation and belongs at Meso.`);
    }
    if (activeScale === 'exosphere') {
      const endpointScales = new Set([sourceNode.scale, targetNode.scale]);
      const microNode = sourceNode.scale === 'micro' ? sourceNode : targetNode.scale === 'micro' ? targetNode : null;
      if (!(endpointScales.has('exosphere') && microNode && MICRO_SETTING_NODE_TYPES.includes(microNode.type))) {
        throw new HttpError(400, `${name} must connect one outside Exosphere decision setting to one immediate Micro setting.`);
      }
      if (!SCALE_VERB_LEXICONS.exosphere.includes(verb)) throw new HttpError(400, `${name}.verb must use the exact Exosphere decision-path register.`);
    }
    const key = `${source}\u0000${verb.toLocaleLowerCase()}\u0000${target}`;
    if (seen.has(key)) throw new HttpError(400, 'generated connections must not contain duplicates.');
    seen.add(key);
    return {
      source,
      target,
      verb,
      rationale,
    };
  });
}

function validatePreflightConsumeRequest(value) {
  assertOnlyKeys(value, ['evaluationId', 'studentAnnotation']);
  if (!validSubmissionId(value.evaluationId)) throw new HttpError(400, 'evaluationId is invalid.');
  const studentAnnotation = value.studentAnnotation === undefined
    ? ''
    : requireSnapshotText(value.studentAnnotation, 'studentAnnotation', { min: 0, max: 4000 });
  return { evaluationId: value.evaluationId, studentAnnotation };
}

const OLLAMA_RUNTIME_INTEGER_FIELDS = Object.freeze([
  'totalDurationNs', 'loadDurationNs', 'promptEvalCount', 'promptEvalDurationNs',
  'evalCount', 'evalDurationNs',
]);

const MODEL_SUGGESTION_PROVIDERS = new Set(['ollama-cloud', 'openrouter', 'cail-gateway']);

function authoritativeRuntimeMetadata(value, { provider, model, createdAt }) {
  if (!isPlainObject(value)) value = {};
  // A fallback runtime may serve the request through a different provider than
  // the configured primary; the stored metadata records the one that answered.
  const servedProvider = MODEL_SUGGESTION_PROVIDERS.has(value.provider) ? value.provider : provider;
  const servedModel = MODEL_SUGGESTION_PROVIDERS.has(servedProvider) && typeof value.model === 'string' && value.model.length > 0
    ? requireSnapshotText(value.model, 'runtime.model', { max: 200 })
    : model;
  const metadata = { provider: servedProvider, model: servedModel, createdAt: new Date(createdAt).toISOString() };
  if (MODEL_SUGGESTION_PROVIDERS.has(servedProvider)) {
    metadata.maxSourceBytes = OLLAMA_CLOUD_LIMITS.sourceTextBytes;
    if (value.requestedModel !== undefined) metadata.requestedModel = requireSnapshotText(value.requestedModel, 'runtime.requestedModel', { max: 200 });
    if (value.doneReason !== undefined) metadata.doneReason = requireSnapshotText(value.doneReason, 'runtime.doneReason', { max: 100 });
    for (const key of OLLAMA_RUNTIME_INTEGER_FIELDS) {
      if (value[key] !== undefined) metadata[key] = requireInteger(value[key], `runtime.${key}`, 0, Number.MAX_SAFE_INTEGER);
    }
  }
  validateBoundedJson(metadata, 'runtime', { maxSerialized: 4096, maxObjectKeys: 16 });
  return metadata;
}

function evaluationConfigSnapshot(effective, projectOverlay, customInstructions, activeScale, stageId, createdAt) {
  const shared = publicSnapshotMetadata(effective);
  return {
    kind: 'preflight',
    activeScale,
    stageId,
    capturedAt: new Date(createdAt).toISOString(),
    shared: {
      fingerprint: shared.fingerprint,
      revision: shared.revision,
      moduleVersions: shared.moduleVersions,
      courseParts: shared.courseParts,
    },
    projectOverlay,
    effectiveFingerprint: fingerprint(`${shared.fingerprint}:${fingerprint(JSON.stringify({ projectOverlay, customInstructions }))}`),
  };
}

function collapsedRedirectText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  if (!collapsed) return null;
  if (collapsed.length <= maxLength) return collapsed;
  const candidate = collapsed.slice(0, maxLength + 1);
  const wordBoundary = candidate.lastIndexOf(' ');
  return wordBoundary >= Math.floor(maxLength / 2)
    ? candidate.slice(0, wordBoundary)
    : collapsed.slice(0, maxLength);
}

function sourcePassageForRedirect(criterion) {
  const evidenceExcerpt = collapsedRedirectText(criterion.evidenceExcerpt, STUDENT_REDIRECT_EVIDENCE_MAX_CHARS);
  const evidence = evidenceExcerpt
    ?? collapsedRedirectText(criterion.evidence, STUDENT_REDIRECT_EVIDENCE_MAX_CHARS);
  if (!evidence || /^(?:no supporting passage located|no evidence (?:located|found)|not found)$/iu.test(evidence)) return null;
  return evidence;
}

function storedAtomicMemoReview(value, activeScale) {
  const fail = () => { throw new Error('invalid atomic memo review'); };
  const exactKeys = (record, keys) => isPlainObject(record)
    && Object.keys(record).length === keys.length
    && keys.every((key) => Object.hasOwn(record, key));
  const exactText = (candidate, maximum, { empty = false } = {}) => {
    if (empty && candidate === '') return true;
    return typeof candidate === 'string' && collapsedRedirectText(candidate, maximum) === candidate;
  };
  try {
    const keys = ['guidance', 'nodes', 'connections', 'example', 'readiness'];
    if (!exactKeys(value, keys)) fail();
    const scaleLimits = MEMO_REVIEW_SCALE_LIMITS[activeScale] || MEMO_REVIEW_SCALE_LIMITS.micro;
    if (!Array.isArray(value.guidance) || value.guidance.length > MEMO_REVIEW_LIMITS.guidance) fail();
    value.guidance.forEach((item) => {
      const itemKeys = Object.hasOwn(item, 'evidenceExcerpt') ? ['point', 'evidenceExcerpt'] : ['point'];
      if (!exactKeys(item, itemKeys) || !exactText(item.point, MEMO_REVIEW_LIMITS.point)
        || containsRetiredSystemsLanguage(item.point)
        || (Object.hasOwn(item, 'evidenceExcerpt') && !exactText(item.evidenceExcerpt, MEMO_REVIEW_LIMITS.evidence))) fail();
    });
    if (!Array.isArray(value.nodes) || value.nodes.length > Math.min(scaleLimits.nodes, MEMO_REVIEW_LIMITS.nodes)) fail();
    const nodeKeys = {
      micro: ['label', 'type', 'scale', 'evidence'],
      meso: ['label', 'type', 'scale', 'evidence', 'scope'],
      exosphere: ['label', 'type', 'scale', 'evidence', 'basis'],
      macrosphere: ['label', 'type', 'scale', 'evidence', 'basis', 'deontic', 'scope'],
    }[activeScale];
    const seenLabels = new Set();
    const nodeByReference = new Map();
    value.nodes.forEach((node) => {
      if (!exactKeys(node, nodeKeys) || !exactText(node.label, MEMO_REVIEW_LIMITS.label)
        || !exactText(node.evidence, MEMO_REVIEW_LIMITS.evidence) || node.scale !== activeScale
        || !isNodeTypeAllowedAtScale(node.type, activeScale)
        || normalizeMapElementLabel(node.label, { micro: activeScale === 'micro' }) !== node.label) fail();
      const lower = node.label.toLocaleLowerCase();
      if (seenLabels.has(lower)) fail();
      seenLabels.add(lower);
      nodeByReference.set(node.label, node);
      if (activeScale === 'micro' && !isDiscreteMicroNodeLabel(node.label)) fail();
      if (activeScale === 'meso' && (node.type !== MESOSYSTEM_NODE_TYPE || !isMesosystemLabel(node.label))) fail();
      if (activeScale === 'exosphere' && (!isNamedInstitutionLabel(node.label) || !['memo', 'inference'].includes(node.basis))) fail();
      if (activeScale === 'macrosphere' && (isNamedInstitutionLabel(node.label)
        || isObviousLowerLevelMacroLabel(node.label) || !['memo', 'inference'].includes(node.basis)
        || !SCALE_VERB_LEXICONS.macrosphere.includes(node.deontic))) fail();
      if (activeScale === 'meso' || activeScale === 'macrosphere') {
        if (!Array.isArray(node.scope) || node.scope.length < 2 || node.scope.length > (scaleLimits.scope || PROJECT_LIMITS.scopeMembers)) fail();
        const ids = new Set();
        node.scope.forEach((member) => {
          if (!exactKeys(member, ['id', 'label']) || !exactText(member.id, MEMO_REVIEW_LIMITS.label)
            || !exactText(member.label, MEMO_REVIEW_LIMITS.label) || ids.has(member.id)) fail();
          ids.add(member.id);
        });
      }
    });
    if (!Array.isArray(value.connections)
      || value.connections.length > Math.min(scaleLimits.connections || MEMO_REVIEW_LIMITS.connections, MEMO_REVIEW_LIMITS.connections)
      || ((activeScale === 'meso' || activeScale === 'macrosphere') && value.connections.length)) fail();
    const seenConnections = new Set();
    value.connections.forEach((connection) => {
      if (!exactKeys(connection, ['source', 'target', 'sourceLabel', 'targetLabel', 'verb', 'rationale'])
        || !exactText(connection.source, MEMO_REVIEW_LIMITS.label)
        || !exactText(connection.target, MEMO_REVIEW_LIMITS.label)
        || !exactText(connection.sourceLabel, MEMO_REVIEW_LIMITS.label)
        || !exactText(connection.targetLabel, MEMO_REVIEW_LIMITS.label)
        || !exactText(connection.verb, MEMO_REVIEW_LIMITS.verb)
        || !exactText(connection.rationale, MEMO_REVIEW_LIMITS.rationale)
        || connection.source === connection.target
        || normalizeMapElementLabel(connection.sourceLabel, { micro: activeScale === 'micro' }) !== connection.sourceLabel
        || normalizeMapElementLabel(connection.targetLabel, { micro: activeScale === 'micro' }) !== connection.targetLabel) fail();
      const key = `${connection.source}\u0000${connection.verb.toLocaleLowerCase()}\u0000${connection.target}`;
      if (seenConnections.has(key)) fail();
      seenConnections.add(key);
      if (activeScale === 'micro') {
        const sourceNode = nodeByReference.get(connection.source) || nodeByReference.get(connection.sourceLabel);
        const targetNode = nodeByReference.get(connection.target) || nodeByReference.get(connection.targetLabel);
        if (MICRO_SETTING_NODE_TYPES.includes(sourceNode?.type) && MICRO_SETTING_NODE_TYPES.includes(targetNode?.type)) fail();
      }
      if (activeScale === 'exosphere' && !SCALE_VERB_LEXICONS.exosphere.includes(connection.verb)) fail();
    });
    if ((activeScale === 'micro' || activeScale === 'meso') ? value.example !== null
      : value.example !== null && !exactText(value.example, MEMO_REVIEW_LIMITS.example)) fail();
    if (!exactKeys(value.readiness, ['ready', 'note']) || typeof value.readiness.ready !== 'boolean'
      || !exactText(value.readiness.note, MEMO_REVIEW_LIMITS.note)) fail();
    return value;
  } catch {
    throw new HttpError(500, 'This stored review is unavailable. Request guidance again.');
  }
}

function studentMemoReview(value, activeScale = 'micro') {
  const suggestion = storedJson(value);
  if (!PREFLIGHT_SCALES.has(activeScale)) activeScale = 'micro';
  if (Array.isArray(suggestion?.hard) || Array.isArray(suggestion?.scored)) {
    // Legacy rubric rows keep responding: unmet next actions become guidance.
    const criteria = [
      ...(Array.isArray(suggestion.hard) ? suggestion.hard : []),
      ...(Array.isArray(suggestion.scored) ? suggestion.scored : []),
    ].filter(({ status }) => status === 'unmet');
    const seen = new Set();
    const guidance = [];
    for (const criterion of criteria) {
      const point = collapsedRedirectText(criterion.nextAction, STUDENT_REDIRECT_ACTION_MAX_CHARS);
      if (!point) continue;
      const dedupeKey = point.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const evidenceExcerpt = sourcePassageForRedirect(criterion);
      guidance.push({ point, ...(evidenceExcerpt ? { evidenceExcerpt } : {}) });
      if (guidance.length === MEMO_REVIEW_LIMITS.guidance) break;
    }
    return {
      guidance,
      nodes: [],
      connections: [],
      example: null,
      readiness: { ready: suggestion.outcome === 'pass', note: '' },
    };
  }
  const {
    evaluatedAt: _evaluatedAt,
    configurationSnapshot: _configurationSnapshot,
    generationContract: _generationContract,
    ...review
  } = suggestion;
  if (_generationContract === 'atomic-v1') return storedAtomicMemoReview(review, activeScale);
  const normalized = normalizeMemoReview(review, activeScale, 'stored memo review');
  return normalized;
}

function preflightEvaluationResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    review: studentMemoReview(row.suggestion, row.activeScale),
    configSnapshot: storedJson(row.configSnapshot),
    runtime: storedJson(row.runtimeMetadata),
    createdAt: responseTimestamp(row.createdAt),
    expiresAt: responseTimestamp(row.expiresAt),
  };
}

function storedJson(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function responseTimestamp(value) {
  if (value === null || value === undefined) return null;
  return new Date(Number(value)).toISOString();
}

function databaseTimestamp(value) {
  if (value === null || value === undefined) return null;
  const date = typeof value === 'number' || /^\d+$/.test(String(value))
    ? new Date(Number(value))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function preflightSubmissionRow(row, { includeTeacher = false } = {}) {
  if (!row) return null;
  const projectMetadata = storedJson(row.projectMetadata);
  return {
    id: row.id,
    projectId: projectMetadata.projectId ?? projectMetadata.id,
    projectMetadata,
    activeScale: row.activeScale,
    inquiry: row.inquiry === UNRECORDED_INQUIRY ? '' : row.inquiry,
    sourceMaterial: row.sourceMaterial,
    sourceRecord: row.sourceRecord === null || row.sourceRecord === undefined ? null : storedJson(row.sourceRecord),
    studentAnnotation: row.studentAnnotation,
    suggestion: storedJson(row.suggestion),
    configSnapshot: storedJson(row.configSnapshot),
    runtime: row.runtimeMetadata === null || row.runtimeMetadata === undefined ? null : storedJson(row.runtimeMetadata),
    status: row.status,
    decision: row.decision ?? null,
    revision: row.revision,
    submittedAt: responseTimestamp(row.createdAt),
    updatedAt: responseTimestamp(row.updatedAt),
    reviewedAt: responseTimestamp(row.reviewedAt),
    instructorAnnotation: row.instructorAnnotation ?? null,
    focusedQuestion: row.focusedQuestion ?? null,
    ...(includeTeacher ? {
      reviewingTeacher: row.reviewerId
        ? { id: row.reviewerId, displayName: row.reviewerDisplayName }
        : null,
    } : {}),
  };
}

function studentPreflightStatusRow(row) {
  if (!row) return null;
  const projectMetadata = storedJson(row.projectMetadata);
  return {
    id: row.id,
    projectId: projectMetadata.projectId ?? projectMetadata.id,
    status: row.status,
    decision: row.decision ?? null,
    revision: row.revision,
    submittedAt: responseTimestamp(row.createdAt),
    updatedAt: responseTimestamp(row.updatedAt),
    reviewedAt: responseTimestamp(row.reviewedAt),
    instructorAnnotation: row.instructorAnnotation ?? null,
    focusedQuestion: row.focusedQuestion ?? null,
  };
}

function preflightReviewEventRow(row) {
  return {
    id: row.id,
    decision: row.decision,
    fromRevision: row.fromRevision,
    toRevision: row.toRevision,
    instructorAnnotation: row.instructorAnnotation,
    focusedQuestion: row.focusedQuestion ?? null,
    decidedAt: responseTimestamp(row.decidedAt),
    reviewingTeacher: { id: row.reviewerId, displayName: row.reviewerDisplayName },
  };
}

function validSubmissionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
}

function continueWith(value, callback) {
  return value && typeof value.then === 'function' ? value.then(callback) : callback(value);
}

const PREFLIGHT_SUBMISSION_SELECT = `
  ps.id, ps.project_metadata_json AS projectMetadata, ps.active_scale AS activeScale,
  ps.inquiry, ps.source_material AS sourceMaterial, ps.source_record_json AS sourceRecord,
  ps.student_annotation AS studentAnnotation,
  ps.suggestion_json AS suggestion, ps.config_snapshot_json AS configSnapshot,
  ps.runtime_metadata_json AS runtimeMetadata,
  ps.status, ps.decision, ps.revision, ps.created_at AS createdAt, ps.updated_at AS updatedAt,
  ps.reviewed_at AS reviewedAt, ps.instructor_annotation AS instructorAnnotation,
  ps.revised_suggestion AS focusedQuestion
`;

async function preflightEvaluationById(db, evaluationId) {
  const row = await db.prepare(`
    SELECT id, suggestion_json AS suggestion, config_snapshot_json AS configSnapshot,
      runtime_metadata_json AS runtimeMetadata, active_scale AS activeScale,
      created_at AS createdAt, expires_at AS expiresAt
    FROM preflight_evaluations WHERE id = ?
  `).get(evaluationId);
  return preflightEvaluationResponse(row);
}

async function studentPreflightSubmission(db, submissionId) {
  const row = await db.prepare(`
    SELECT ps.id, ps.project_metadata_json AS projectMetadata, ps.status, ps.decision,
      ps.revision, ps.created_at AS createdAt, ps.updated_at AS updatedAt,
      ps.reviewed_at AS reviewedAt, ps.instructor_annotation AS instructorAnnotation,
      ps.revised_suggestion AS focusedQuestion
    FROM preflight_submissions ps
    WHERE ps.id = ?
  `).get(submissionId);
  return studentPreflightStatusRow(row);
}

async function teacherPreflightSubmission(db, submissionId) {
  const row = await db.prepare(`
    SELECT ${PREFLIGHT_SUBMISSION_SELECT},
      ps.reviewing_teacher_id AS reviewerId, a.display_name AS reviewerDisplayName
    FROM preflight_submissions ps
    LEFT JOIN accounts a ON a.id = ps.reviewing_teacher_id
    WHERE ps.id = ?
  `).get(submissionId);
  return preflightSubmissionRow(row, { includeTeacher: true });
}

async function teacherPreflightReviewEvents(db, submissionId) {
  return (await db.prepare(`
    SELECT e.id, e.decision, e.from_revision AS fromRevision, e.to_revision AS toRevision,
      e.instructor_annotation AS instructorAnnotation,
      e.revised_suggestion AS focusedQuestion, e.decided_at AS decidedAt,
      e.reviewing_teacher_id AS reviewerId, a.display_name AS reviewerDisplayName
    FROM preflight_review_events e
    JOIN accounts a ON a.id = e.reviewing_teacher_id
    WHERE e.submission_id = ?
    ORDER BY e.id
  `).all(submissionId)).map(preflightReviewEventRow);
}

async function teacherPreflightDetail(db, submissionId) {
  const submission = await teacherPreflightSubmission(db, submissionId);
  if (!submission) return null;
  return { submission, reviewEvents: await teacherPreflightReviewEvents(db, submissionId) };
}

function preflightSubmissionSummaryRow(row) {
  const projectMetadata = storedJson(row.projectMetadata);
  const configSnapshot = row.configSnapshot === undefined ? null : storedJson(row.configSnapshot);
  const coursePart = configSnapshot?.shared?.courseParts?.find(({ scaleIds }) => scaleIds.includes(row.activeScale)) ?? null;
  return {
    id: row.id,
    projectId: projectMetadata.projectId ?? projectMetadata.id,
    projectTitle: projectMetadata.title || '',
    activeScale: row.activeScale,
    coursePart,
    status: row.status,
    decision: row.decision ?? null,
    revision: row.revision,
    submittedAt: responseTimestamp(row.createdAt),
    updatedAt: responseTimestamp(row.updatedAt),
    reviewedAt: responseTimestamp(row.reviewedAt),
  };
}

function requireAccountId(value) {
  const id = requireString(value, 'userId', { max: 100 });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new HttpError(401, 'Teacher credentials were not accepted.');
  return id;
}

function publicUser(row) {
  return row ? { id: row.id, displayName: row.displayName } : null;
}

function moduleRow(row) {
  return {
    id: row.id,
    configKind: row.configKind,
    scale: row.scale,
    moduleKey: row.moduleKey,
    label: row.label,
    description: row.description,
    content: row.content,
    revision: row.revision,
    fingerprint: row.fingerprint,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName ?? null,
  };
}

function teachingProfileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    revision: row.revision,
    profile: storedJson(row.profile),
    fingerprint: row.fingerprint,
    parentId: row.parentId ?? null,
    createdAt: databaseTimestamp(row.createdAt),
    createdByName: row.createdByName ?? null,
    updatedAt: databaseTimestamp(row.updatedAt),
    updatedByName: row.updatedByName ?? null,
    publishedAt: databaseTimestamp(row.publishedAt),
    publishedByName: row.publishedByName ?? null,
  };
}

const TEACHING_PROFILE_SELECT = `
  SELECT tp.id, tp.name, tp.status, tp.revision, tp.profile_json AS profile,
    tp.fingerprint, tp.parent_id AS parentId, tp.created_at AS createdAt,
    creator.display_name AS createdByName, tp.updated_at AS updatedAt,
    updater.display_name AS updatedByName, tp.published_at AS publishedAt,
    publisher.display_name AS publishedByName
  FROM teaching_profiles tp
  LEFT JOIN accounts creator ON creator.id = tp.created_by
  LEFT JOIN accounts updater ON updater.id = tp.updated_by
  LEFT JOIN accounts publisher ON publisher.id = tp.published_by
`;

async function listTeachingProfiles(db) {
  const rows = await db.prepare(`${TEACHING_PROFILE_SELECT}
    ORDER BY CASE tp.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
      tp.updated_at DESC
  `).all();
  return rows.map(teachingProfileRow);
}

async function teachingProfileById(db, profileId) {
  return teachingProfileRow(await db.prepare(`${TEACHING_PROFILE_SELECT} WHERE tp.id = ?`).get(profileId));
}

async function activeTeachingProfile(db) {
  return teachingProfileRow(await db.prepare(`${TEACHING_PROFILE_SELECT} WHERE tp.status = 'active'`).get());
}

function teachingProfileSummary(profile) {
  const { profile: _profile, ...summary } = profile;
  return summary;
}

async function teachingProfileEvents(db, profileId) {
  const rows = await db.prepare(`
    SELECT e.id, e.action, e.revision, e.fingerprint, e.note,
      e.occurred_at AS occurredAt, a.display_name AS actorName
    FROM teaching_profile_events e
    LEFT JOIN accounts a ON a.id = e.actor_id
    WHERE e.profile_id = ?
    ORDER BY e.id DESC LIMIT 100
  `).all(profileId);
  return rows.map((event) => ({
    ...event,
    occurredAt: databaseTimestamp(event.occurredAt),
    actorName: event.actorName ?? null,
  }));
}

function requireTeachingProfile(value) {
  try {
    return normalizeSystemsMappingTeachingProfile(value);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

function requireTeachingProfileId(value, name = 'profileId') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(value)) {
    throw new HttpError(400, `${name} is invalid.`);
  }
  return value;
}

async function listModules(db, where = '', parameters = []) {
  return (await db.prepare(`
    SELECT pm.id, pm.config_kind AS configKind, pm.scale, pm.module_key AS moduleKey,
      pm.label, pm.description, pm.content, pm.revision, pm.fingerprint,
      pm.updated_at AS updatedAt, a.display_name AS updatedByName
    FROM prompt_modules pm
    LEFT JOIN accounts a ON a.id = pm.updated_by
    ${where}
    ORDER BY CASE pm.config_kind WHEN 'preflight' THEN 1 ELSE 2 END,
      CASE pm.scale WHEN 'global' THEN 0 WHEN 'micro' THEN 1 WHEN 'meso' THEN 2 WHEN 'exosphere' THEN 3 ELSE 4 END,
      ${MODULE_ORDER_SQL}
  `).all(...parameters)).map(moduleRow);
}

async function effectiveSnapshot(db, configKind, scale, includeModules = false, profileOverride = null, stageId = null, coursePrompt = null) {
  if (!CONFIG_KINDS.includes(configKind)) throw new HttpError(400, 'configKind must be preflight or builder.');
  if (!EFFECTIVE_SCALES.includes(scale)) throw new HttpError(400, 'scale must be micro, meso, exosphere, or macrosphere.');
  const effectiveStageId = canonicalStageId(stageId || (configKind === 'builder' ? 'build-map' : 'review-suggestions'));
  if (!systemsMappingStage(effectiveStageId)) throw new HttpError(400, 'stageId is not supported.');
  const modules = await listModules(db, 'WHERE pm.config_kind = ? AND pm.scale IN (?, ?)', [configKind, 'global', scale]);
  const teachingProfile = profileOverride ?? await activeTeachingProfile(db);
  if (!teachingProfile) throw new HttpError(503, 'No course settings are published. Publish a draft in the Instructor Console, then try again.');
  const effectivePrompt = appendCoursePrompt(composeEffectivePrompt({
    configKind,
    scale,
    modules,
    teachingProfile: teachingProfile.profile,
    stageId: effectiveStageId,
  }), coursePrompt?.amendment);
  const snapshot = {
    configKind,
    scale,
    stageId: effectiveStageId,
    effectivePrompt,
    fixedGuardrails: FIXED_GUARDRAILS.join('\n'),
    fingerprint: fingerprint(effectivePrompt),
    revision: Math.max(teachingProfile.revision, ...modules.map((module) => module.revision), coursePrompt?.revision ?? 0),
    moduleVersions: [
      ...modules.map(({ id, revision, fingerprint: moduleFingerprint }) => ({ id, revision, fingerprint: moduleFingerprint })),
      { id: `teaching-profile.${teachingProfile.id}`, revision: teachingProfile.revision, fingerprint: teachingProfile.fingerprint },
      ...(coursePrompt ? [{ id: 'course-appendix', revision: coursePrompt.revision, fingerprint: fingerprint(coursePrompt.amendment) }] : []),
    ],
    courseParts: coursePartsForTeachingProfile(teachingProfile.profile),
    fieldNotesQuestions: fieldNotesQuestions(teachingProfile.profile),
  };
  if (includeModules) {
    snapshot.modules = modules;
    snapshot.teachingProfile = teachingProfile;
  }
  return snapshot;
}

function publicSnapshotMetadata(snapshot) {
  return {
    configKind: snapshot.configKind,
    scale: snapshot.scale,
    stageId: snapshot.stageId,
    fingerprint: snapshot.fingerprint,
    revision: snapshot.revision,
    moduleVersions: snapshot.moduleVersions,
    guardrailsFingerprint: fingerprint(snapshot.fixedGuardrails),
    courseParts: snapshot.courseParts,
    fieldNotesQuestions: snapshot.fieldNotesQuestions,
  };
}

function trustedOrigin(context, { publicOrigin, trustedProxyHops }) {
  const requestUrl = new URL(context.req.url);
  if (publicOrigin) {
    const expected = new URL(publicOrigin);
    const hostHeader = context.req.header('host');
    if (!hostHeader || hostHeader.toLowerCase() !== expected.host.toLowerCase()) {
      throw new HttpError(421, 'Request host is not trusted.');
    }
    const forwardedProtocols = (context.req.header('x-forwarded-proto') || '')
      .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    const observedProtocol = trustedProxyHops > 0 && forwardedProtocols.length > 0
      ? forwardedProtocols.at(-1)
      : requestUrl.protocol.slice(0, -1).toLowerCase();
    if (`${observedProtocol}:` !== expected.protocol) throw new HttpError(421, 'Request host is not trusted.');
    return expected.origin;
  }
  if (!LOOPBACK_HOSTS.has(requestUrl.hostname.toLowerCase())) {
    throw new HttpError(421, 'Request host is not trusted.');
  }
  const hostHeader = context.req.header('host');
  if (hostHeader) {
    let headerUrl;
    try {
      headerUrl = new URL(`${requestUrl.protocol}//${hostHeader}`);
    } catch {
      throw new HttpError(421, 'Request host is not trusted.');
    }
    if (!LOOPBACK_HOSTS.has(headerUrl.hostname.toLowerCase()) || headerUrl.host.toLowerCase() !== requestUrl.host.toLowerCase()) {
      throw new HttpError(421, 'Request host is not trusted.');
    }
  }
  return requestUrl.origin;
}

function normalizedAddress(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim().replace(/^::ffff:/, '');
  return isIP(address) ? address : null;
}

function clientRateKey(context, bucket, { hostedMode, trustedProxyHops }) {
  if (!hostedMode) return bucket;
  let directAddress = null;
  try {
    directAddress = normalizedAddress(getConnInfo(context).remote.address);
  } catch {
    // Hono's in-memory request harness has no socket. It falls back to a bounded shared bucket.
  }
  let clientAddress = directAddress;
  if (trustedProxyHops > 0) {
    const forwarded = (context.req.header('x-forwarded-for') || '')
      .split(',').map(normalizedAddress).filter(Boolean);
    const chain = [...forwarded, ...(directAddress ? [directAddress] : [])];
    const index = directAddress
      ? chain.length - 1 - trustedProxyHops
      : chain.length - trustedProxyHops;
    clientAddress = index >= 0 ? chain[index] : null;
  }
  const correlation = createHash('sha256').update(clientAddress || 'unknown-proxy-client').digest('hex').slice(0, 16);
  return `${bucket}:${correlation}`;
}

function assertMutationOrigin(context, origin) {
  if (!context.req.path.startsWith('/api/') || !MUTATION_METHODS.has(context.req.method.toUpperCase())) return;
  const suppliedOrigin = context.req.header('origin');
  const fetchSite = context.req.header('sec-fetch-site');
  if (!suppliedOrigin) throw new HttpError(403, 'Request origin was rejected.');
  let parsed;
  try {
    parsed = new URL(suppliedOrigin);
  } catch {
    throw new HttpError(403, 'Request origin was rejected.');
  }
  if (suppliedOrigin !== parsed.origin || parsed.origin !== origin || (fetchSite && fetchSite !== 'same-origin')) {
    throw new HttpError(403, 'Request origin was rejected.');
  }
}

function pruneLimiterMap(map, checkedAt, maxKeys) {
  for (const [key, entry] of map) {
    if (entry.resetAt <= checkedAt) map.delete(key);
  }
  while (map.size >= maxKeys) map.delete(map.keys().next().value);
}

function failureLimiter({ limit, windowMs, now, maxKeys = 32 }) {
  const attempts = new Map();
  const active = (key) => {
    const entry = attempts.get(key);
    if (entry && entry.resetAt <= clockValue(now)) {
      attempts.delete(key);
      return null;
    }
    return entry ?? null;
  };
  const retryAfter = (entry) => Math.max(1, Math.ceil((entry.resetAt - clockValue(now)) / 1000));
  return {
    blocked(key) {
      const entry = active(key);
      return entry?.failures >= limit ? retryAfter(entry) : 0;
    },
    fail(key) {
      const checkedAt = clockValue(now);
      const entry = active(key) ?? {
        failures: 0,
        resetAt: checkedAt + windowMs,
        correlationRef: randomBytes(8).toString('hex'),
      };
      entry.failures += 1;
      if (!attempts.has(key)) pruneLimiterMap(attempts, checkedAt, maxKeys);
      attempts.set(key, entry);
      return {
        blocked: entry.failures >= limit,
        retryAfterSeconds: retryAfter(entry),
        correlationRef: entry.correlationRef,
      };
    },
    clear(key) {
      attempts.delete(key);
    },
  };
}

function rateLimiter({ limit, windowMs, now, maxKeys = 512 }) {
  const windows = new Map();
  return {
    take(key) {
      const checkedAt = clockValue(now);
      let entry = windows.get(key);
      if (!entry || entry.resetAt <= checkedAt) {
        if (!entry) pruneLimiterMap(windows, checkedAt, maxKeys);
        entry = { count: 0, resetAt: checkedAt + windowMs };
      }
      entry.count += 1;
      windows.set(key, entry);
      return entry.count <= limit
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - checkedAt) / 1000)) };
    },
  };
}

function concurrencyLimiter(limit) {
  let active = 0;
  const activeKeys = new Set();
  return {
    has(key) { return activeKeys.has(key); },
    acquire(key) {
      if (active >= limit || key !== undefined && activeKeys.has(key)) return null;
      active += 1;
      if (key !== undefined) activeKeys.add(key);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        if (key !== undefined) activeKeys.delete(key);
      };
    },
  };
}

function tooManyAttempts(retryAfterSeconds, message) {
  return new HttpError(429, message, { retryAfterSeconds }, { 'Retry-After': String(retryAfterSeconds) });
}

function validatePrototypeMetadata(metadata, event) {
  if (event === STUDENT_WORKFLOW_EVALUATION_EVENT) {
    try {
      return validateStudentWorkflowEvaluationMetadata(metadata);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  }
  if (metadata === undefined) return {};
  if (!isPlainObject(metadata)) throw new HttpError(400, 'metadata must be a JSON object.');
  const entries = Object.entries(metadata);
  if (entries.length > 8) throw new HttpError(400, 'metadata must contain no more than 8 fields.');
  const validated = {};
  for (const [key, value] of entries) {
    const rule = PROTOTYPE_METADATA_RULES[key];
    if (!rule) throw new HttpError(400, 'metadata contains an unsupported field.');
    if (rule.type === 'boolean') {
      if (typeof value !== 'boolean') throw new HttpError(400, `${key} must be a boolean.`);
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `${key} must be a finite number.`);
      if (rule.type === 'integer' && !Number.isInteger(value)) throw new HttpError(400, `${key} must be an integer.`);
      if (value < rule.min || value > rule.max) throw new HttpError(400, `${key} is outside the supported range.`);
    }
    validated[key] = value;
  }
  return validated;
}

async function recordPrototypeEvent(db, {
  sessionKind,
  sessionRef,
  event,
  stage = null,
  metadata = {},
  recordedAt,
  retentionMs,
  maxRows,
  retentionHoldUntil = null,
}) {
  const metadataJson = JSON.stringify(metadata);
  await inTransaction(db, async () => {
    await db.advisoryTransactionLock?.('prototype-events');
    await prunePrototypeEvents(db, { recordedAt, retentionMs, maxRows, retentionHoldUntil });
    await db.prepare(`
      INSERT INTO prototype_events
        (session_kind, session_ref, event_name, stage, metadata_json, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionKind, sessionRef, event, stage, metadataJson, recordedAt);
    await prunePrototypeEvents(db, { recordedAt, retentionMs, maxRows, retentionHoldUntil });
  });
}

function prunePrototypeEvents(db, { recordedAt, retentionMs, maxRows, retentionHoldUntil = null }) {
  if (!retentionCleanupAllowed(retentionHoldUntil, recordedAt)) return 0;
  const pruneExpired = db.prepare('DELETE FROM prototype_events WHERE recorded_at < ?').run(recordedAt - retentionMs);
  const pruneRows = () => db.prepare(`
    DELETE FROM prototype_events WHERE id IN (
      SELECT id FROM prototype_events ORDER BY id DESC LIMIT -1 OFFSET ?
    )
  `).run(maxRows);
  return pruneExpired && typeof pruneExpired.then === 'function'
    ? pruneExpired.then(pruneRows)
    : pruneRows();
}

function purgeExpiredPreflightSubmissions(db, options) {
  if (!retentionCleanupAllowed(options.retentionHoldUntil ?? null, options.purgedAt)) return 0;
  if (db.dialect !== 'postgres') return purgeExpiredPreflightSubmissionsSqlite(db, options);
  return purgeExpiredPreflightSubmissionsAsync(db, options);
}

function purgeExpiredPreflightSubmissionsSqlite(db, {
  purgedAt,
  pendingRetentionDays,
  decidedRetentionDays,
  limit,
}) {
  const expired = db.prepare(`
    SELECT id, status, decision
    FROM preflight_submissions
    WHERE (status = 'pending' AND created_at < ?)
      OR (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_at < ?)
    ORDER BY
      CASE WHEN status = 'pending' THEN created_at ELSE reviewed_at END,
      id
    LIMIT ?
  `).all(
    purgedAt - pendingRetentionDays * DAY_MS,
    purgedAt - decidedRetentionDays * DAY_MS,
    limit,
  );
  if (expired.length === 0) return 0;
  const insertAudit = db.prepare(`
    INSERT INTO preflight_retention_purges
      (submission_ref_hash, status, decision, purged_at, purged_by)
    VALUES (?, ?, ?, ?, 'retention')
  `);
  for (const submission of expired) {
    insertAudit.run(
      createHash('sha256').update(submission.id).digest('hex'),
      submission.status,
      submission.decision ?? null,
      purgedAt,
    );
  }
  db.prepare(`
    INSERT INTO preflight_retention_purge_guard (singleton, reason)
    VALUES (1, 'retention')
  `).run();
  try {
    const placeholders = expired.map(() => '?').join(', ');
    const submissionIds = expired.map(({ id }) => id);
    db.prepare(`DELETE FROM preflight_review_events WHERE submission_id IN (${placeholders})`).run(...submissionIds);
    db.prepare(`DELETE FROM preflight_submissions WHERE id IN (${placeholders})`).run(...submissionIds);
  } finally {
    db.prepare(`
      DELETE FROM preflight_retention_purge_guard
      WHERE singleton = 1 AND reason = 'retention'
    `).run();
  }
  return expired.length;
}

async function purgeExpiredPreflightSubmissionsAsync(db, {
  purgedAt,
  pendingRetentionDays,
  decidedRetentionDays,
  limit,
}) {
  await db.advisoryTransactionLock?.('preflight-submissions:retention');
  const expired = await db.prepare(`
    SELECT id, status, decision
    FROM preflight_submissions
    WHERE (status = 'pending' AND created_at < ?)
      OR (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_at < ?)
    ORDER BY
      CASE WHEN status = 'pending' THEN created_at ELSE reviewed_at END,
      id
    LIMIT ?
  `).all(
    purgedAt - pendingRetentionDays * DAY_MS,
    purgedAt - decidedRetentionDays * DAY_MS,
    limit,
  );
  if (expired.length === 0) return 0;

  const insertAudit = db.prepare(`
    INSERT INTO preflight_retention_purges
      (submission_ref_hash, status, decision, purged_at, purged_by)
    VALUES (?, ?, ?, ?, 'retention')
  `);
  for (const submission of expired) {
    await insertAudit.run(
      createHash('sha256').update(submission.id).digest('hex'),
      submission.status,
      submission.decision ?? null,
      purgedAt,
    );
  }

  await db.prepare(`
    INSERT INTO preflight_retention_purge_guard (singleton, reason)
    VALUES (1, 'retention')
  `).run();
  try {
    const placeholders = expired.map(() => '?').join(', ');
    const submissionIds = expired.map(({ id }) => id);
    await db.prepare(`
      DELETE FROM preflight_review_events
      WHERE submission_id IN (${placeholders})
    `).run(...submissionIds);
    await db.prepare(`
      DELETE FROM preflight_submissions
      WHERE id IN (${placeholders})
    `).run(...submissionIds);
  } finally {
    await db.prepare(`
      DELETE FROM preflight_retention_purge_guard
      WHERE singleton = 1 AND reason = 'retention'
    `).run();
  }
  return expired.length;
}

function purgeExpiredPreflightEvaluations(db, options) {
  if (!retentionCleanupAllowed(options.retentionHoldUntil ?? null, options.expiredAt)) return 0;
  if (db.dialect !== 'postgres') {
    const rows = db.prepare(`
      SELECT id FROM preflight_evaluations
      WHERE expires_at <= ?
      ORDER BY expires_at, id
      LIMIT ?
    `).all(options.expiredAt, options.limit);
    if (rows.length === 0) return 0;
    const placeholders = rows.map(() => '?').join(', ');
    db.prepare(`DELETE FROM preflight_evaluations WHERE id IN (${placeholders})`)
      .run(...rows.map(({ id }) => id));
    return rows.length;
  }
  return purgeExpiredPreflightEvaluationsAsync(db, options);
}

async function purgeExpiredPreflightEvaluationsAsync(db, { expiredAt, limit }) {
  await db.advisoryTransactionLock?.('preflight-evaluations:expiry');
  const rows = await db.prepare(`
    SELECT id FROM preflight_evaluations
    WHERE expires_at <= ?
    ORDER BY expires_at, id
    LIMIT ?
  `).all(expiredAt, limit);
  if (rows.length === 0) return 0;
  const placeholders = rows.map(() => '?').join(', ');
  await db.prepare(`DELETE FROM preflight_evaluations WHERE id IN (${placeholders})`)
    .run(...rows.map(({ id }) => id));
  return rows.length;
}

export function createSystemsMappingApp(options = {}) {
  const now = options.now ?? Date.now;
  const retentionHoldUntil = parseRetentionHoldUntil(options.retentionHoldUntil, { now });
  const db = options.db || openDataStore({
    databaseUrl: options.databaseUrl,
    dbPath: options.dbPath,
    postgres: options.postgres,
  });
  const ownsDatabase = !options.db;
  const hostedMode = options.hostedMode ?? Boolean(options.databaseUrl || options.publicOrigin);
  let publicOrigin = null;
  if (options.publicOrigin !== undefined && options.publicOrigin !== null) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(options.publicOrigin);
    } catch {
      throw new TypeError('publicOrigin must be an absolute origin URL.');
    }
    if (parsedOrigin.origin !== options.publicOrigin || parsedOrigin.username || parsedOrigin.password) {
      throw new TypeError('publicOrigin must contain only a URL origin.');
    }
    publicOrigin = parsedOrigin.origin;
  }
  if (hostedMode && (!publicOrigin || new URL(publicOrigin).protocol !== 'https:')) {
    throw new TypeError('Hosted mode requires an HTTPS publicOrigin.');
  }
  const trustedProxyHops = options.trustedProxyHops ?? 0;
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0 || trustedProxyHops > 5) {
    throw new TypeError('trustedProxyHops must be an integer between 0 and 5.');
  }
  const teacherSessionTtlMs = positiveInteger(options.sessionTtlMs, 'sessionTtlMs', DEFAULT_TEACHER_SESSION_TTL_MS);
  const studentSessionTtlMs = positiveInteger(options.studentSessionTtlMs, 'studentSessionTtlMs', DEFAULT_STUDENT_SESSION_TTL_MS);
  const studentAttemptLimit = positiveInteger(options.studentAttemptLimit, 'studentAttemptLimit', 5, { max: 100 });
  const studentAttemptWindowMs = positiveInteger(options.studentAttemptWindowMs, 'studentAttemptWindowMs', DEFAULT_ATTEMPT_WINDOW_MS);
  const studentSessionIssueLimit = positiveInteger(options.studentSessionIssueLimit, 'studentSessionIssueLimit', 60, { max: 1000 });
  const studentSessionIssueWindowMs = positiveInteger(
    options.studentSessionIssueWindowMs,
    'studentSessionIssueWindowMs',
    DEFAULT_PREFLIGHT_SUBMISSION_WINDOW_MS,
  );
  const teacherAttemptLimit = positiveInteger(options.teacherAttemptLimit, 'teacherAttemptLimit', 5, { max: 100 });
  const teacherAttemptWindowMs = positiveInteger(options.teacherAttemptWindowMs, 'teacherAttemptWindowMs', DEFAULT_ATTEMPT_WINDOW_MS);
  const teacherAuthConcurrency = positiveInteger(options.teacherAuthConcurrency, 'teacherAuthConcurrency', 2, { max: 10 });
  const healthCheckTimeoutMs = positiveInteger(options.healthCheckTimeoutMs, 'healthCheckTimeoutMs', 2000, { max: 10_000 });
  const prototypeEventLimit = positiveInteger(options.prototypeEventLimit, 'prototypeEventLimit', 60, { max: 1000 });
  const prototypeEventWindowMs = positiveInteger(options.prototypeEventWindowMs, 'prototypeEventWindowMs', 60_000);
  const prototypeMaxRows = positiveInteger(options.prototypeMaxRows, 'prototypeMaxRows', 2000, { max: 100_000 });
  const prototypeRetentionMs = positiveInteger(options.prototypeRetentionMs, 'prototypeRetentionMs', DEFAULT_PROTOTYPE_RETENTION_MS);
  const savedProjectCreateLimit = positiveInteger(options.savedProjectCreateLimit, 'savedProjectCreateLimit', 10, { max: 1000 });
  const savedProjectCreateWindowMs = positiveInteger(
    options.savedProjectCreateWindowMs,
    'savedProjectCreateWindowMs',
    DEFAULT_PREFLIGHT_SUBMISSION_WINDOW_MS,
  );
  const savedProjectWriteLimit = positiveInteger(options.savedProjectWriteLimit, 'savedProjectWriteLimit', 600, { max: 100_000 });
  const savedProjectWriteWindowMs = positiveInteger(
    options.savedProjectWriteWindowMs,
    'savedProjectWriteWindowMs',
    DEFAULT_PREFLIGHT_SUBMISSION_WINDOW_MS,
  );
  const savedProjectMaxTotal = positiveInteger(options.savedProjectMaxTotal, 'savedProjectMaxTotal', 5000, { max: 1_000_000 });
  const savedProjectTtlMs = positiveInteger(
    options.savedProjectTtlMs,
    'savedProjectTtlMs',
    DEFAULT_SAVED_PROJECT_TTL_MS,
    { min: 1000, max: 3650 * DAY_MS },
  );
  const preflightSubmissionLimit = positiveInteger(options.preflightSubmissionLimit, 'preflightSubmissionLimit', 5, { max: 100 });
  const preflightSubmissionWindowMs = positiveInteger(
    options.preflightSubmissionWindowMs,
    'preflightSubmissionWindowMs',
    DEFAULT_PREFLIGHT_SUBMISSION_WINDOW_MS,
  );
  const preflightMaxPendingPerSession = positiveInteger(
    options.preflightMaxPendingPerSession,
    'preflightMaxPendingPerSession',
    3,
    { max: 20 },
  );
  const preflightMaxPendingTotal = positiveInteger(
    options.preflightMaxPendingTotal,
    'preflightMaxPendingTotal',
    100,
    { max: 10_000 },
  );
  const preflightEvaluationTtlMs = positiveInteger(
    options.preflightEvaluationTtlMs,
    'preflightEvaluationTtlMs',
    DEFAULT_PREFLIGHT_EVALUATION_TTL_MS,
    { min: 1000, max: 7 * DAY_MS },
  );
  const preflightEvaluationLimit = positiveInteger(options.preflightEvaluationLimit, 'preflightEvaluationLimit', 20, { max: 100 });
  const preflightEvaluationWindowMs = positiveInteger(
    options.preflightEvaluationWindowMs,
    'preflightEvaluationWindowMs',
    DEFAULT_PREFLIGHT_SUBMISSION_WINDOW_MS,
  );
  const preflightEvaluationConcurrency = positiveInteger(
    options.preflightEvaluationConcurrency,
    'preflightEvaluationConcurrency',
    2,
    { max: 10 },
  );
  const connectionSuggestionLimit = positiveInteger(options.connectionSuggestionLimit, 'connectionSuggestionLimit', 20, { max: 100 });
  const mapCheckLimit = positiveInteger(options.mapCheckLimit, 'mapCheckLimit', 20, { max: 100 });
  const connectionSuggestionWindowMs = positiveInteger(
    options.connectionSuggestionWindowMs,
    'connectionSuggestionWindowMs',
    DEFAULT_PREFLIGHT_SUBMISSION_WINDOW_MS,
  );
  const preflightEvaluationPurgeLimit = positiveInteger(
    options.preflightEvaluationPurgeLimit,
    'preflightEvaluationPurgeLimit',
    100,
    { max: 1000 },
  );
  const preflightPendingRetentionDays = positiveInteger(
    options.preflightPendingRetentionDays,
    'preflightPendingRetentionDays',
    DEFAULT_PREFLIGHT_PENDING_RETENTION_DAYS,
    { max: 3650 },
  );
  const preflightDecidedRetentionDays = positiveInteger(
    options.preflightDecidedRetentionDays,
    'preflightDecidedRetentionDays',
    DEFAULT_PREFLIGHT_DECIDED_RETENTION_DAYS,
    { max: 3650 },
  );
  const preflightRetentionPurgeLimit = positiveInteger(
    options.preflightRetentionPurgeLimit,
    'preflightRetentionPurgeLimit',
    100,
    { max: 1000 },
  );
  const secureCookies = hostedMode ? true : (options.secureCookies ?? process.env.COOKIE_SECURE === 'true');
  const persistence = hostedMode ? 'course-server' : 'local-server';
  const ollamaConfig = options.ollamaConfig ?? null;
  if (ollamaConfig !== null && (!isPlainObject(ollamaConfig)
    || typeof ollamaConfig.apiKey !== 'string' || ollamaConfig.apiKey.length < 1
    || typeof ollamaConfig.model !== 'string' || ollamaConfig.model.length < 1)) {
    throw new TypeError('ollamaConfig must be a validated Ollama Cloud configuration.');
  }
  const ollamaRequest = options.ollamaRequest ?? requestOllamaSuggestion;
  if (typeof ollamaRequest !== 'function') throw new TypeError('ollamaRequest must be a function.');
  const suggestionProvider = options.suggestionProvider ?? 'ollama-cloud';
  if (!MODEL_SUGGESTION_PROVIDERS.has(suggestionProvider)) {
    throw new TypeError('suggestionProvider must be a supported model provider.');
  }
  const suggestionRuntime = Object.freeze(ollamaConfig
    ? {
      provider: suggestionProvider,
      model: ollamaConfig.model,
      maxSourceBytes: OLLAMA_CLOUD_LIMITS.sourceTextBytes,
    }
    : { provider: 'deterministic', model: 'STEM Splitter' });
  const retentionDays = Object.freeze({
    evaluation: preflightEvaluationTtlMs / DAY_MS,
    pending: preflightPendingRetentionDays,
    decided: preflightDecidedRetentionDays,
  });
  const classCode = options.classCode ?? (hostedMode ? null : DEFAULT_CLASS_CODE);
  if (options.publicDemo !== undefined && typeof options.publicDemo !== 'boolean') {
    throw new TypeError('publicDemo must be a boolean when provided.');
  }
  const publicDemo = options.publicDemo === true;
  if (publicDemo && !hostedMode) {
    throw new TypeError('publicDemo may be enabled only in hosted mode.');
  }
  let teacherBootstrapToken = options.teacherBootstrapToken ?? null;
  if (hostedMode) {
    const validPublicDemoCode = publicDemo && classCode === DEFAULT_CLASS_CODE;
    const validPrivateClassCode = !publicDemo && typeof classCode === 'string'
      && classCode.length >= 10 && classCode.length <= 32
      && classCode !== DEFAULT_CLASS_CODE && new Set(classCode).size >= 6;
    if (!validPublicDemoCode && !validPrivateClassCode) {
      throw new TypeError('Hosted mode requires an explicit classCode between 10 and 32 characters with at least 6 distinct characters.');
    }
  } else if (typeof classCode !== 'string' || classCode.length < 1 || classCode.length > 32) {
    throw new TypeError('classCode must be a string between 1 and 32 characters.');
  }
  if (teacherBootstrapToken !== null
    && (typeof teacherBootstrapToken !== 'string' || teacherBootstrapToken.length < 16 || teacherBootstrapToken.length > 256)) {
    throw new TypeError('teacherBootstrapToken must be null or a string between 16 and 256 characters.');
  }
  const pruneAtStartup = () => inTransaction(db, () => {
    const recordedAt = clockValue(now);
    const prototypeResult = prunePrototypeEvents(db, {
      recordedAt,
      retentionMs: prototypeRetentionMs,
      maxRows: prototypeMaxRows,
      retentionHoldUntil,
    });
    return continueWith(prototypeResult, () => continueWith(
      purgeExpiredPreflightSubmissions(db, {
        purgedAt: recordedAt,
        pendingRetentionDays: preflightPendingRetentionDays,
        decidedRetentionDays: preflightDecidedRetentionDays,
        limit: preflightRetentionPurgeLimit,
        retentionHoldUntil,
      }),
      () => purgeExpiredPreflightEvaluations(db, {
        expiredAt: recordedAt,
        limit: preflightEvaluationPurgeLimit,
        retentionHoldUntil,
      }),
    ));
  });
  const ready = ['postgres', 'durable-sqlite'].includes(db.dialect)
    ? Promise.resolve(db.ready).then(pruneAtStartup)
    : (pruneAtStartup(), Promise.resolve());

  const app = new Hono();
  const studentLimiter = failureLimiter({ limit: studentAttemptLimit, windowMs: studentAttemptWindowMs, now });
  const teacherLimiter = failureLimiter({ limit: teacherAttemptLimit, windowMs: teacherAttemptWindowMs, now });
  const teacherConcurrency = concurrencyLimiter(teacherAuthConcurrency);
  const prototypeLimiter = rateLimiter({ limit: prototypeEventLimit, windowMs: prototypeEventWindowMs, now });
  const studentSessionIssueLimiter = rateLimiter({
    limit: studentSessionIssueLimit,
    windowMs: studentSessionIssueWindowMs,
    now,
  });
  const preflightSubmissionLimiter = rateLimiter({
    limit: preflightSubmissionLimit,
    windowMs: preflightSubmissionWindowMs,
    now,
  });
  const preflightEvaluationLimiter = rateLimiter({
    limit: preflightEvaluationLimit,
    windowMs: preflightEvaluationWindowMs,
    now,
  });
  const connectionSuggestionLimiter = rateLimiter({
    limit: connectionSuggestionLimit,
    windowMs: connectionSuggestionWindowMs,
    now,
  });
  const mapCheckLimiter = rateLimiter({
    limit: mapCheckLimit,
    windowMs: connectionSuggestionWindowMs,
    now,
  });
  const preflightEvaluationCapacity = concurrencyLimiter(preflightEvaluationConcurrency);
  const savedProjectCreateLimiter = rateLimiter({
    limit: savedProjectCreateLimit,
    windowMs: savedProjectCreateWindowMs,
    now,
  });
  const savedProjectWriteLimiter = rateLimiter({
    limit: savedProjectWriteLimit,
    windowMs: savedProjectWriteWindowMs,
    now,
  });
  const dummyPassphrase = randomBytes(32).toString('base64url');
  const dummySalt = randomBytes(16);
  let dummyCredentials;
  const getDummyCredentials = () => {
    dummyCredentials ??= hashPassphrase(dummyPassphrase, dummySalt);
    return dummyCredentials;
  };

  app.onError((error, context) => {
    if (error instanceof HttpError) {
      for (const [name, value] of Object.entries(error.headers ?? {})) context.header(name, value);
      return context.json({ error: error.message, ...(error.details ? { details: error.details } : {}) }, error.status);
    }
    // Request bodies, secrets, SQL parameters, and stack traces are deliberately omitted.
    if (options.onInternalError) options.onInternalError(context);
    else console.error('Systems Mapping request failed with an internal error.');
    return context.json({ error: 'Internal server error.' }, 500);
  });

  app.use('*', async (context, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) context.header(name, value);
    if (context.req.path.startsWith('/api/') || !context.req.path.startsWith('/assets/')) {
      context.header('Cache-Control', 'no-store');
      context.header('Pragma', 'no-cache');
    }
    await ready;
    if (hostedMode && context.req.path === '/api/health' && ['GET', 'HEAD'].includes(context.req.method.toUpperCase())) {
      await next();
      return;
    }
    const origin = trustedOrigin(context, { publicOrigin, trustedProxyHops });
    assertMutationOrigin(context, origin);
    context.set('requestOrigin', origin);
    await next();
  });

  const record = (entry) => recordPrototypeEvent(db, {
    ...entry,
    recordedAt: clockValue(now),
    retentionMs: prototypeRetentionMs,
    maxRows: prototypeMaxRows,
    retentionHoldUntil,
  });

  const ensureNotBlocked = (limiter, key, message) => {
    const retryAfterSeconds = limiter.blocked(key);
    if (retryAfterSeconds) throw tooManyAttempts(retryAfterSeconds, message);
  };

  const registerTeacherFailure = (key) => {
    const failure = teacherLimiter.fail(key);
    if (failure.blocked) throw tooManyAttempts(failure.retryAfterSeconds, 'Too many attempts. Wait a few minutes, then try again.');
    throw new HttpError(401, 'Teacher credentials were not accepted.');
  };

  app.use('/api/auth/*', async (context, next) => {
    if (context.req.method !== 'POST' || !['/api/auth/claim', '/api/auth/login', '/api/auth/reset-password'].includes(context.req.path)) {
      await next();
      return;
    }
    const release = teacherConcurrency.acquire();
    if (!release) throw tooManyAttempts(1, 'Too many attempts. Wait a few minutes, then try again.');
    try {
      await next();
    } finally {
      release();
    }
  });

  app.get('/api/health', async (context) => {
    if (!await boundedDatabaseHealthCheck(db, healthCheckTimeoutMs)) {
      return context.json({ status: 'unavailable' }, 503);
    }
    return context.json({ status: 'ok' });
  });

  app.get('/api/auth/accounts', (context) => context.json({
    teacherAccess: {
      mode: 'manual',
      claimEnabled: teacherBootstrapToken !== null,
    },
    runtime: { persistence, hosted: hostedMode, retentionDays, suggestionRuntime },
  }));

  app.post('/api/auth/claim', async (context) => {
    const attemptKey = clientRateKey(context, TEACHER_ATTEMPT_BUCKET, { hostedMode, trustedProxyHops });
    ensureNotBlocked(teacherLimiter, attemptKey, 'Too many attempts. Wait a few minutes, then try again.');
    if (teacherBootstrapToken === null) throw new HttpError(503, 'Teacher account setup is unavailable. Ask the course administrator for a new one-time setup code.');
    const body = await parseJsonBody(context, AUTH_BODY_LIMIT_BYTES);
    assertOnlyKeys(body, ['userId', 'passphrase', 'bootstrapToken']);

    let userId;
    try {
      userId = requireAccountId(body.userId);
    } catch {
      registerTeacherFailure(attemptKey);
    }
    if (validatePassphrase(body.passphrase) || typeof body.bootstrapToken !== 'string' || body.bootstrapToken.length > 256) {
      registerTeacherFailure(attemptKey);
    }

    const credentials = await hashPassphrase(body.passphrase);
    const account = await db.prepare('SELECT id, display_name AS displayName, passphrase_hash AS passphraseHash FROM accounts WHERE id = ?').get(userId);
    const bootstrapValid = constantTimeSecretEqual(body.bootstrapToken, teacherBootstrapToken);
    if (!bootstrapValid || !account || account.passphraseHash) registerTeacherFailure(attemptKey);

    let session;
    try {
      session = await inTransaction(db, async () => {
        const claimedAt = new Date(clockValue(now)).toISOString();
        const consumed = await db.prepare(`
          INSERT INTO teacher_bootstrap_uses (token_hash, used_at)
          VALUES (?, ?)
          ON CONFLICT(token_hash) DO NOTHING
        `).run(createHash('sha256').update(teacherBootstrapToken).digest('hex'), clockValue(now));
        if (consumed.changes !== 1) throw new HttpError(401, 'Teacher credentials were not accepted.');
        const updated = await db.prepare(`
          UPDATE accounts SET passphrase_hash = ?, passphrase_salt = ?, claimed_at = ?
          WHERE id = ? AND passphrase_hash IS NULL
        `).run(credentials.hash, credentials.salt, claimedAt, userId);
        if (updated.changes !== 1) throw new HttpError(401, 'Teacher credentials were not accepted.');
        return issueSession(db, userId, teacherSessionTtlMs, { now });
      });
    } catch (error) {
      if (error instanceof HttpError) registerTeacherFailure(attemptKey);
      throw error;
    }
    teacherLimiter.clear(attemptKey);
    // A bootstrap token authorizes exactly one claim for this server process.
    // A second local account requires an operator-controlled restart with a new token.
    teacherBootstrapToken = null;
    setSessionCookie(context, session.token, teacherSessionTtlMs, secureCookies);
    return context.json({ user: { id: account.id, displayName: account.displayName } }, 201);
  });

  app.post('/api/auth/login', async (context) => {
    const attemptKey = clientRateKey(context, TEACHER_ATTEMPT_BUCKET, { hostedMode, trustedProxyHops });
    ensureNotBlocked(teacherLimiter, attemptKey, 'Too many attempts. Wait a few minutes, then try again.');
    const body = await parseJsonBody(context, AUTH_BODY_LIMIT_BYTES);
    assertOnlyKeys(body, ['userId', 'passphrase']);
    let userId;
    try {
      userId = requireAccountId(body.userId);
    } catch {
      registerTeacherFailure(attemptKey);
    }
    if (validatePassphrase(body.passphrase)) registerTeacherFailure(attemptKey);

    const account = await db.prepare(`
      SELECT id, display_name AS displayName, passphrase_hash AS passphraseHash, passphrase_salt AS passphraseSalt
      FROM accounts WHERE id = ?
    `).get(userId);
    const fallback = await getDummyCredentials();
    const valid = account?.passphraseHash
      ? await verifyPassphrase(body.passphrase, account.passphraseHash, account.passphraseSalt)
      : await verifyPassphrase(body.passphrase, fallback.hash, fallback.salt);
    if (!valid) registerTeacherFailure(attemptKey);

    const session = await issueSession(db, account.id, teacherSessionTtlMs, { now });
    teacherLimiter.clear(attemptKey);
    setSessionCookie(context, session.token, teacherSessionTtlMs, secureCookies);
    return context.json({ user: publicUser(account) });
  });

  app.post('/api/auth/reset-password', async (context) => {
    const attemptKey = clientRateKey(context, TEACHER_ATTEMPT_BUCKET, { hostedMode, trustedProxyHops });
    ensureNotBlocked(teacherLimiter, attemptKey, 'Too many attempts. Wait a few minutes, then try again.');
    const body = await parseJsonBody(context, AUTH_BODY_LIMIT_BYTES);
    assertOnlyKeys(body, ['token', 'passphrase']);
    if (!validPasswordResetToken(body.token) || validatePassphrase(body.passphrase)) {
      const failure = teacherLimiter.fail(attemptKey);
      if (failure.blocked) throw tooManyAttempts(failure.retryAfterSeconds, 'Too many attempts. Wait a few minutes, then try again.');
      throw new HttpError(401, 'This password reset link is invalid or has expired. Ask the course administrator for a new link.');
    }
    const account = await consumePasswordReset(db, body.token, body.passphrase, { now });
    if (!account) {
      const failure = teacherLimiter.fail(attemptKey);
      if (failure.blocked) throw tooManyAttempts(failure.retryAfterSeconds, 'Too many attempts. Wait a few minutes, then try again.');
      throw new HttpError(401, 'This password reset link is invalid or has expired. Ask the course administrator for a new link.');
    }
    teacherLimiter.clear(attemptKey);
    return context.json({ reset: true });
  });

  app.get('/api/auth/me', async (context) => context.json({ user: publicUser(await currentUser(context, db, now)) }));

  app.post('/api/auth/logout', async (context) => {
    await clearSession(context, db, secureCookies);
    return context.json({ user: null });
  });

  app.post('/api/student/access', async (context) => {
    const attemptKey = clientRateKey(context, STUDENT_ATTEMPT_BUCKET, { hostedMode, trustedProxyHops });
    ensureNotBlocked(studentLimiter, attemptKey, 'Too many class-code attempts. Try again later.');
    const body = await parseJsonBody(context, CLASS_CODE_BODY_LIMIT_BYTES);
    assertOnlyKeys(body, ['code']);
    const valid = typeof body.code === 'string'
      && body.code.length <= 32
      && constantTimeSecretEqual(body.code, classCode);
    if (!valid) {
      const failure = studentLimiter.fail(attemptKey);
      await record({
        sessionKind: 'access_attempt',
        sessionRef: failure.correlationRef,
        event: 'class_access_failed',
        metadata: { throttled: failure.blocked },
      });
      if (failure.blocked) throw tooManyAttempts(failure.retryAfterSeconds, 'Too many class-code attempts. Try again later.');
      throw new HttpError(401, 'Class code was not accepted.');
    }

    if (hostedMode) {
      const issuance = studentSessionIssueLimiter.take(clientRateKey(
        context,
        STUDENT_SESSION_ISSUE_BUCKET,
        { hostedMode, trustedProxyHops },
      ));
      if (!issuance.allowed) {
        throw tooManyAttempts(issuance.retryAfterSeconds, 'Too many class sessions were requested. Try again later.');
      }
    }

    const session = await inTransaction(db, async () => {
      const issued = await issueStudentSession(db, studentSessionTtlMs, { now });
      await record({
        sessionKind: 'student',
        sessionRef: createHash('sha256').update(issued.token).digest('hex').slice(0, 16),
        event: 'class_access_succeeded',
      });
      return issued;
    });
    studentLimiter.clear(attemptKey);
    setStudentSessionCookie(context, session.token, studentSessionTtlMs, secureCookies);
    return context.json({
      access: { expiresAt: isoTimestamp(session.expiresAt), persistence, retentionDays, suggestionRuntime },
    }, 201);
  });

  app.get('/api/student/session', async (context) => {
    const session = await currentStudentSession(context, db, now);
    return context.json({
      access: session
        ? { expiresAt: isoTimestamp(session.expiresAt), persistence, retentionDays, suggestionRuntime }
        : null,
    });
  });

  app.post('/api/student/logout', async (context) => {
    await clearStudentSession(context, db, secureCookies);
    return context.json({ access: null });
  });

  app.post('/api/preflight/evaluations', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    const body = await parseJsonBody(context, PREFLIGHT_SUBMISSION_BODY_LIMIT_BYTES);
    const input = validatePreflightEvaluationRequest(body);
    const sourceMetadata = { ...input.sourceRecord, studentJudgments: input.studentJudgments, ...(input.fieldNotes ? { fieldNotes: input.fieldNotes } : {}) };
    if (ollamaConfig && Buffer.byteLength(JSON.stringify(sourceMetadata), 'utf8') > OLLAMA_CLOUD_LIMITS.sourceMetadataBytes) {
      throw new HttpError(413, 'The combined memo details, map choices and Field Notes excerpt exceed 16 KiB. Shorten the submitted metadata; your saved memo and notes are unchanged.');
    }
    if (ollamaConfig && Buffer.byteLength(input.sourceMaterial, 'utf8') > OLLAMA_CLOUD_LIMITS.sourceTextBytes) {
      throw new HttpError(
        413,
        `The memo must contain no more than ${OLLAMA_CLOUD_LIMITS.sourceTextBytes} UTF-8 bytes for this suggestion runtime.`,
      );
    }
    if (ollamaConfig && Buffer.byteLength(input.inquiry, 'utf8') > OLLAMA_CLOUD_LIMITS.inquiryBytes) {
      throw new HttpError(
        413,
        `inquiry must contain no more than ${OLLAMA_CLOUD_LIMITS.inquiryBytes} UTF-8 bytes for this suggestion runtime.`,
      );
    }
    if (preflightEvaluationCapacity.has(student.sessionRef)) {
      throw new HttpError(409, 'Guidance is already running', { code: 'guidance_in_progress', shouldRetry: true, retryAfterSeconds: 1 }, { 'Retry-After': '1' });
    }
    const release = preflightEvaluationCapacity.acquire(student.sessionRef);
    if (!release) throw tooManyAttempts(1, 'Guidance is busy. Try again shortly.');

    const evaluationId = randomBytes(24).toString('base64url');
    const createdAt = clockValue(now);
    const expiresAt = createdAt + preflightEvaluationTtlMs;
    let suggestion;
    let configSnapshot;
    let runtimeMetadata;
    try {
      // Capacity refusals and duplicate clicks do not consume the student's
      // generation allowance. No promise or model output is shared across requests.
      const rate = preflightEvaluationLimiter.take(student.sessionRef);
      if (!rate.allowed) {
        throw tooManyAttempts(rate.retryAfterSeconds, 'You have requested guidance several times in this class session. Try again later.');
      }
      context.req.raw.signal.throwIfAborted();
      const effective = await effectiveSnapshot(db, 'preflight', input.activeScale, true, null, input.stageId, context.env?.verifiedAccount?.coursePrompt);
      configSnapshot = evaluationConfigSnapshot(
        effective,
        input.projectOverlay,
        input.customInstructions,
        input.activeScale,
        input.stageId,
        createdAt,
      );
      if (ollamaConfig) {
        try {
          const systemPrompt = input.customInstructions
            ? `${effective.effectivePrompt}\n\nSTUDENT PROJECT OVERLAY\n[Custom instructions]\n${input.customInstructions}\n\n${OLLAMA_SUGGESTION_SCHEMA_INSTRUCTION}`
            : `${effective.effectivePrompt}\n\n${OLLAMA_SUGGESTION_SCHEMA_INSTRUCTION}`;
          const providerInput = {
            systemPrompt,
            activeScale: input.activeScale,
            inquiry: input.inquiry,
            sourceMetadata,
            sourceText: input.sourceMaterial,
            ...(input.activeScale === 'meso' || input.carriedNodes.length ? { carriedNodes: input.carriedNodes } : {}),
            ...(input.carriedConnections.length ? { carriedConnections: input.carriedConnections } : {}),
          };
          let generated = await ollamaRequest(providerInput, ollamaConfig, { signal: context.req.raw.signal, context: context.env?.verifiedAccount });
          let review;
          try {
            review = validateGeneratedMemoReviewAtomically(generated.suggestion, input.activeScale, input.carriedNodes, input.carriedConnections);
          } catch (error) {
            if (!(error instanceof MemoReviewSemanticError)) throw error;
            // CAIL Gateway owns provider/model failover. Do not silently issue a
            // second potentially billable request when its completed output is
            // unusable; keep the project editable and let the student choose.
            if (suggestionProvider === 'cail-gateway') throw error;
            generated = await ollamaRequest({
              ...providerInput,
              systemPrompt: `${systemPrompt}\n\nCORRECTIVE RETRY\n${error.feedback}`,
            }, ollamaConfig, { signal: context.req.raw.signal, context: context.env?.verifiedAccount });
            review = validateGeneratedMemoReviewAtomically(generated.suggestion, input.activeScale, input.carriedNodes, input.carriedConnections);
          }
          suggestion = {
            ...review,
            generationContract: 'atomic-v1',
            evaluatedAt: new Date(createdAt).toISOString(),
            configurationSnapshot: configSnapshot,
          };
          runtimeMetadata = authoritativeRuntimeMetadata(generated.metadata, {
            provider: suggestionProvider,
            model: ollamaConfig.model,
            createdAt,
          });
        } catch (error) {
          if (options.suggestionFailure) {
            const safe = options.suggestionFailure(error, context);
            throw new HttpError(safe.status, safe.message, safe.details, safe.headers);
          }
          // Code-only server log; provider bodies and memo content never land in logs.
          console.warn(
            'memo review generation failed:',
            error?.code ?? error?.name ?? 'unknown',
            error?.status ?? '',
            error instanceof MemoReviewSemanticError ? error.message : '',
          );
          throw new HttpError(
            502,
            'Suggestion generation is temporarily unavailable.',
            generationFailureDetails(error, suggestionProvider),
          );
        }
      } else {
        const deterministic = deterministicMemoReview({ ...input.sourceRecord, text: input.sourceMaterial }, input.activeScale, {
            carriedNodes: input.carriedNodes,
            carriedConnections: input.carriedConnections,
          });
        let review;
        try {
          // The local reader already resolves scope labels for its client
          // output; the provider contract accepts the same references as IDs.
          // Preserve every item and scope member, then apply the same validator.
          const providerReview = {
            ...deterministic,
            nodes: deterministic.nodes.map((node) => ({
              ...node,
              ...(Array.isArray(node.scope) ? { scope: node.scope.map(member => typeof member === 'string' ? member : member.id) } : {}),
            })),
          };
          review = validateGeneratedMemoReviewAtomically(providerReview, input.activeScale, input.carriedNodes, input.carriedConnections);
        } catch (error) {
          if (!(error instanceof MemoReviewSemanticError)) throw error;
          throw new HttpError(502, 'Suggestion generation is temporarily unavailable.');
        }
        suggestion = {
          ...review,
          generationContract: 'atomic-v1',
          evaluatedAt: new Date(createdAt).toISOString(),
          configurationSnapshot: configSnapshot,
        };
        runtimeMetadata = authoritativeRuntimeMetadata({}, {
          provider: 'deterministic',
          model: 'STEM Splitter',
          createdAt,
        });
      }

      context.req.raw.signal.throwIfAborted();
      await inTransaction(db, async () => {
        await db.advisoryTransactionLock?.('preflight-evaluations:issue');
        await purgeExpiredPreflightEvaluations(db, { expiredAt: createdAt, limit: preflightEvaluationPurgeLimit, retentionHoldUntil });
        // Only the newest review capability is usable for a class session. Older
        // unused reviews are no longer reachable from the student project and
        // must not accumulate into a workflow-blocking "active" ceiling.
        await db.prepare(`
          UPDATE preflight_evaluations SET consumed_at = ?
          WHERE student_session_ref = ? AND consumed_at IS NULL AND expires_at > ?
        `).run(createdAt, student.sessionRef, createdAt);
        await db.prepare(`
          INSERT INTO preflight_evaluations (
            id, student_session_ref, project_metadata_json, active_scale, inquiry,
            source_record_json, source_material, project_overlay_json, suggestion_json,
            config_snapshot_json, runtime_metadata_json, created_at, expires_at, consumed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `).run(
          evaluationId,
          student.sessionRef,
          JSON.stringify(input.projectMetadata),
          input.activeScale,
          input.inquiry || UNRECORDED_INQUIRY,
          JSON.stringify(input.sourceRecord),
          input.sourceMaterial,
          JSON.stringify(input.projectOverlay),
          JSON.stringify(suggestion),
          JSON.stringify(configSnapshot),
          JSON.stringify(runtimeMetadata),
          createdAt,
          expiresAt,
        );
      });
    } finally {
      release();
    }
    return context.json({ evaluation: await preflightEvaluationById(db, evaluationId) }, 201);
  });

  app.post('/api/map/connections', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    if (!ollamaConfig) throw new HttpError(503, 'Connection suggestions are not available for this class.');
    const body = await parseJsonBody(context, JSON_BODY_LIMIT_BYTES);
    const input = validateConnectionSuggestionRequest(body);
    const sourceMetadata = { nodes: input.nodes, existingConnections: input.relationships, studentJudgments: input.studentJudgments };
    if (Buffer.byteLength(JSON.stringify(sourceMetadata), 'utf8') > OLLAMA_CLOUD_LIMITS.sourceMetadataBytes) {
      throw new HttpError(413, 'Use fewer nodes or existing connections for this request.');
    }
    if (preflightEvaluationCapacity.has(student.sessionRef)) {
      throw new HttpError(409, 'Guidance is already running', { code: 'guidance_in_progress', shouldRetry: true, retryAfterSeconds: 1 }, { 'Retry-After': '1' });
    }
    const release = preflightEvaluationCapacity.acquire(student.sessionRef);
    if (!release) throw tooManyAttempts(1, 'Connection suggestions are busy. Try again shortly.');
    try {
      const rate = connectionSuggestionLimiter.take(student.sessionRef);
      if (!rate.allowed) {
        throw tooManyAttempts(rate.retryAfterSeconds, 'Connection suggestion limit reached for this class session. Try again later.');
      }
      context.req.raw.signal.throwIfAborted();
      const effective = await effectiveSnapshot(db, 'builder', input.activeScale, false, null, 'choose-what-to-map', context.env?.verifiedAccount?.coursePrompt);
      const systemPrompt = input.customInstructions
        ? `${effective.effectivePrompt}\n\nSTUDENT PROJECT OVERLAY\n[Custom instructions]\n${input.customInstructions}\n\n${CONNECTION_SUGGESTION_SCHEMA_INSTRUCTION}`
        : `${effective.effectivePrompt}\n\n${CONNECTION_SUGGESTION_SCHEMA_INSTRUCTION}`;
      let connections;
      try {
        const providerInput = {
          systemPrompt,
          activeScale: input.activeScale,
          inquiry: input.inquiry,
          sourceMetadata,
          sourceText: input.prompt,
        };
        const existingConnections = new Set(input.relationships.map(({ source, target, verb }) => `${source}\u0000${verb.trim().toLocaleLowerCase()}\u0000${target}`));
        const validateWholeResponse = (suggestion) => {
          const proposed = validateGeneratedConnections(suggestion, input.nodes, input.activeScale);
          if (proposed.some(({ source, target, verb }) => existingConnections.has(`${source}\u0000${verb.toLocaleLowerCase()}\u0000${target}`))) {
            throw new HttpError(400, 'generated connections repeats an existing relationship.');
          }
          return proposed;
        };
        let generated = await ollamaRequest(providerInput, ollamaConfig, { signal: context.req.raw.signal, context: context.env?.verifiedAccount, kind: 'connections' });
        try {
          connections = validateWholeResponse(generated.suggestion);
        } catch (error) {
          if (suggestionProvider === 'cail-gateway') throw error;
          generated = await ollamaRequest({
            ...providerInput,
            systemPrompt: `${systemPrompt}\n\nCORRECTIVE RETRY\nReturn one complete replacement JSON object. Do not patch, explain, filter, or reuse any part of the rejected response. Every relationship must use exact supplied node IDs, must be new, and must satisfy the active-scale contract.\nValidation failure: ${error.message}`,
          }, ollamaConfig, { signal: context.req.raw.signal, context: context.env?.verifiedAccount });
          connections = validateWholeResponse(generated.suggestion);
        }
      } catch (error) {
        if (options.suggestionFailure) {
          const safe = options.suggestionFailure(error, context);
          throw new HttpError(safe.status, safe.message, safe.details, safe.headers);
        }
        console.warn('connection suggestion generation failed:', error?.code ?? error?.name ?? 'unknown', error?.status ?? '');
        throw new HttpError(
          502,
          'Connection suggestions are temporarily unavailable.',
          generationFailureDetails(error, suggestionProvider),
        );
      }
      context.req.raw.signal.throwIfAborted();
      return context.json({ connections }, 201);
    } finally {
      release();
    }
  });

  // Map Check reasons over the student's carried map instead of rereading the
  // memo. It returns bounded notes tied to map IDs and never commits anything.
  app.post('/api/map/check', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    if (!ollamaConfig) throw new HttpError(503, 'Map checks are not available for this class.');
    const body = await parseJsonBody(context, JSON_BODY_LIMIT_BYTES);
    const input = validateMapCheckRequest(body);
    const sourceMetadata = { intent: input.intent, focus: input.focus, scopes: input.scopes, studentJudgments: input.studentJudgments };
    if (Buffer.byteLength(JSON.stringify(sourceMetadata), 'utf8') > OLLAMA_CLOUD_LIMITS.sourceMetadataBytes) {
      throw new HttpError(413, 'Use fewer scopes for this request.');
    }
    if (preflightEvaluationCapacity.has(student.sessionRef)) {
      throw new HttpError(409, 'Guidance is already running', { code: 'guidance_in_progress', shouldRetry: true, retryAfterSeconds: 1 }, { 'Retry-After': '1' });
    }
    const release = preflightEvaluationCapacity.acquire(student.sessionRef);
    if (!release) throw tooManyAttempts(1, 'Map checks are busy. Try again shortly.');
    try {
      const rate = mapCheckLimiter.take(student.sessionRef);
      if (!rate.allowed) {
        throw tooManyAttempts(rate.retryAfterSeconds, 'Map check limit reached for this class session. Try again later.');
      }
      context.req.raw.signal.throwIfAborted();
      const stageId = input.intent === 'synthesis' ? 'revise-and-export' : 'build-map';
      const effective = await effectiveSnapshot(db, 'builder', input.activeScale, false, null, stageId, context.env?.verifiedAccount?.coursePrompt);
      const systemPrompt = input.customInstructions
        ? `${effective.effectivePrompt}\n\nSTUDENT PROJECT OVERLAY\n[Custom instructions]\n${input.customInstructions}\n\n${MAP_CHECK_SCHEMA_INSTRUCTION}`
        : `${effective.effectivePrompt}\n\n${MAP_CHECK_SCHEMA_INSTRUCTION}`;
      let notes;
      try {
        const providerInput = {
          systemPrompt,
          activeScale: input.activeScale,
          inquiry: input.inquiry,
          sourceMetadata,
          sourceText: input.memoExcerpt.trim() || 'No memo excerpt was supplied. Reason only from the carried map, the inquiry, and the student judgments.',
          carriedNodes: input.nodes,
          carriedConnections: input.relationships,
        };
        const refIds = new Set([...input.nodes.map(({ id }) => id), ...input.relationships.map(({ id }) => id)]);
        // One attempt per explicit action. Invalid output is a visible failure,
        // never a second paid request.
        const generated = await ollamaRequest(providerInput, ollamaConfig, { signal: context.req.raw.signal, context: context.env?.verifiedAccount, kind: 'map-check' });
        notes = validateGeneratedMapCheck(generated.suggestion, input.intent, refIds);
      } catch (error) {
        if (options.suggestionFailure) {
          const safe = options.suggestionFailure(error, context);
          throw new HttpError(safe.status, safe.message, safe.details, safe.headers);
        }
        console.warn('map check generation failed:', error?.code ?? error?.name ?? 'unknown', error?.status ?? '');
        throw new HttpError(502, 'Map checks are temporarily unavailable.', generationFailureDetails(error, suggestionProvider));
      }
      context.req.raw.signal.throwIfAborted();
      return context.json({ intent: input.intent, notes }, 201);
    } finally {
      release();
    }
  });

  app.post('/api/preflight/submissions', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    const body = await parseJsonBody(context, PREFLIGHT_CONSUME_BODY_LIMIT_BYTES);
    const request = validatePreflightConsumeRequest(body);
    const rate = preflightSubmissionLimiter.take(student.sessionRef);
    if (!rate.allowed) {
      throw tooManyAttempts(rate.retryAfterSeconds, 'Preflight submission limit reached for this class session. Try again later.');
    }
    const submissionId = randomBytes(24).toString('base64url');
    const submittedAt = clockValue(now);
    const consumedEvaluation = await inTransaction(db, async () => {
      await db.advisoryTransactionLock?.('preflight-submissions:consume');
      await purgeExpiredPreflightEvaluations(db, { expiredAt: submittedAt, limit: preflightEvaluationPurgeLimit, retentionHoldUntil });
      const evaluation = await db.prepare(`
        SELECT project_metadata_json AS projectMetadata, active_scale AS activeScale,
          inquiry, source_record_json AS sourceRecord, source_material AS sourceMaterial,
          suggestion_json AS suggestion, config_snapshot_json AS configSnapshot,
          runtime_metadata_json AS runtimeMetadata
        FROM preflight_evaluations
        WHERE id = ? AND student_session_ref = ?
          AND consumed_at IS NULL AND expires_at > ?
      `).get(request.evaluationId, student.sessionRef, submittedAt);
      if (!evaluation) return false;

      const consumed = await db.prepare(`
        UPDATE preflight_evaluations SET consumed_at = ?
        WHERE id = ? AND student_session_ref = ?
          AND consumed_at IS NULL AND expires_at > ?
      `).run(submittedAt, request.evaluationId, student.sessionRef, submittedAt);
      if (consumed.changes !== 1) return false;

      const { count, sessionCount } = await db.prepare(`
        SELECT COUNT(*) AS count,
          SUM(CASE WHEN student_session_ref = ? THEN 1 ELSE 0 END) AS sessionCount
        FROM preflight_submissions
        WHERE status = 'pending'
      `).get(student.sessionRef);
      if ((sessionCount ?? 0) >= preflightMaxPendingPerSession) {
        throw new HttpError(429, 'This class session already has the maximum number of pending preflight submissions.');
      }
      if (count >= preflightMaxPendingTotal) {
        throw new HttpError(429, 'The course review queue has reached its pending submission limit.');
      }

      await db.prepare(`
        INSERT INTO preflight_submissions (
          id, student_session_ref, project_metadata_json, active_scale, inquiry,
          source_material, source_record_json, student_annotation, suggestion_json,
          config_snapshot_json, runtime_metadata_json, status, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)
      `).run(
        submissionId,
        student.sessionRef,
        evaluation.projectMetadata,
        evaluation.activeScale,
        evaluation.inquiry,
        evaluation.sourceMaterial,
        evaluation.sourceRecord,
        request.studentAnnotation,
        evaluation.suggestion,
        evaluation.configSnapshot,
        evaluation.runtimeMetadata,
        submittedAt,
        submittedAt,
      );
      return true;
    });
    if (!consumedEvaluation) {
      throw new HttpError(409, 'This guidance is unavailable, expired, or already used.');
    }
    return context.json({
      submission: await studentPreflightSubmission(db, submissionId),
    }, 201);
  });

  app.get('/api/preflight/submissions/:id', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    const submissionId = context.req.param('id');
    if (!validSubmissionId(submissionId)) throw new HttpError(404, 'This review is no longer available. Return to Review your memo and refresh the guidance.');
    const submission = await studentPreflightSubmission(db, submissionId);
    if (!submission) throw new HttpError(404, 'This review is no longer available. Return to Review your memo and refresh the guidance.');
    return context.json({ submission });
  });

  app.post('/api/prototype/events', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    const rate = prototypeLimiter.take(clientRateKey(context, PROTOTYPE_RATE_BUCKET, { hostedMode, trustedProxyHops }));
    if (!rate.allowed) throw tooManyAttempts(rate.retryAfterSeconds, 'Prototype activity limit reached. Try again later.');
    const body = await parseJsonBody(context, PROTOTYPE_BODY_LIMIT_BYTES);
    assertOnlyKeys(body, ['event', 'stage', 'metadata']);
    if (typeof body.event !== 'string' || !PROTOTYPE_EVENTS.has(body.event)) {
      throw new HttpError(400, 'event is not supported.');
    }
    const stage = body.stage === undefined ? null : PROTOTYPE_STAGES.get(body.stage);
    if (stage === undefined) {
      throw new HttpError(400, 'stage must be a canonical workflow stage label.');
    }
    const metadata = validatePrototypeMetadata(body.metadata, body.event);
    await record({
      sessionKind: 'student',
      sessionRef: student.sessionRef,
      event: body.event,
      stage,
      metadata,
    });
    return context.json({ accepted: true }, 202);
  });

  app.post('/api/projects', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    const rate = savedProjectCreateLimiter.take(student.sessionRef);
    if (!rate.allowed) throw tooManyAttempts(rate.retryAfterSeconds, 'Project link limit reached. Try again later.');
    const body = await parseJsonBody(context, SAVED_PROJECT_BODY_LIMIT_BYTES);
    const { serialized, projectId } = parseSavedProjectPayload(body);
    const token = randomBytes(24).toString('base64url');
    const savedAt = clockValue(now);
    const expiresAt = savedAt + savedProjectTtlMs;
    await inTransaction(db, async () => {
      await db.advisoryTransactionLock?.('saved-projects:capacity');
      if (retentionCleanupAllowed(retentionHoldUntil, savedAt)) {
        await db.prepare(`
          DELETE FROM saved_projects
          WHERE expires_at IS NOT NULL AND expires_at <= ?
        `).run(savedAt);
      }
      const total = await db.prepare('SELECT COUNT(*) AS count FROM saved_projects').get();
      if ((total?.count ?? 0) >= savedProjectMaxTotal) {
        throw new HttpError(507, 'The class workspace cannot store more project links right now.');
      }
      await db.prepare(`
        INSERT INTO saved_projects (
          token_hash, project_id, project_json, created_session_ref,
          created_at, updated_at, revision, expires_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL)
      `).run(
        createHash('sha256').update(token).digest('hex'),
        projectId,
        serialized,
        student.sessionRef,
        savedAt,
        savedAt,
        expiresAt,
      );
    });
    setSavedProjectEtag(context, 1);
    return context.json({
      token,
      revision: 1,
      updatedAt: savedAt,
      expiresAt,
      revokedAt: null,
    }, 201);
  });

  app.get('/api/projects/:token', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    const token = context.req.param('token');
    if (!SAVED_PROJECT_TOKEN_PATTERN.test(token)) throw new HttpError(404, 'Project link not found.');
    const row = await db.prepare(`
      SELECT project_id AS projectId, project_json AS project,
        revision, updated_at AS updatedAt, expires_at AS expiresAt, revoked_at AS revokedAt
      FROM saved_projects WHERE token_hash = ?
    `).get(createHash('sha256').update(token).digest('hex'));
    if (!row) throw new HttpError(404, 'Project link not found.');
    assertSavedProjectActive(row, clockValue(now));
    setSavedProjectEtag(context, row.revision);
    return context.json({ projectId: row.projectId, project: row.project, ...savedProjectMetadata(row) });
  });

  app.put('/api/projects/:token', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    const token = context.req.param('token');
    if (!SAVED_PROJECT_TOKEN_PATTERN.test(token)) throw new HttpError(404, 'Project link not found.');
    const rate = savedProjectWriteLimiter.take(student.sessionRef);
    if (!rate.allowed) throw tooManyAttempts(rate.retryAfterSeconds, 'Project sync limit reached. Try again later.');
    const body = await parseJsonBody(context, SAVED_PROJECT_BODY_LIMIT_BYTES);
    const { serialized, projectId, expectedRevision } = parseSavedProjectPayload(body, context);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const requestedAt = clockValue(now);
    const metadata = await inTransaction(db, async () => {
      await db.advisoryTransactionLock?.(`saved-project:${tokenHash}`);
      const row = await db.prepare(`
        SELECT project_id AS projectId, revision, updated_at AS updatedAt,
          expires_at AS expiresAt, revoked_at AS revokedAt
        FROM saved_projects WHERE token_hash = ?
      `).get(tokenHash);
      if (!row) throw new HttpError(404, 'Project link not found.');
      assertSavedProjectActive(row, requestedAt);
      if (row.projectId !== projectId) {
        throw new HttpError(409, 'This link belongs to a different project. Create a new link for this project.');
      }
      if (row.revision !== expectedRevision) throw staleSavedProjectError(row);
      const updatedAt = Math.max(requestedAt, row.updatedAt);
      const updated = await db.prepare(`
        UPDATE saved_projects
        SET project_json = ?, updated_at = ?, revision = revision + 1
        WHERE token_hash = ? AND project_id = ? AND revision = ?
          AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
      `).run(serialized, updatedAt, tokenHash, projectId, expectedRevision, requestedAt);
      if (updated.changes !== 1) {
        const current = await db.prepare(`
          SELECT revision, updated_at AS updatedAt,
            expires_at AS expiresAt, revoked_at AS revokedAt
          FROM saved_projects WHERE token_hash = ?
        `).get(tokenHash);
        if (!current) throw new HttpError(404, 'Project link not found.');
        assertSavedProjectActive(current, requestedAt);
        throw staleSavedProjectError(current);
      }
      return {
        revision: expectedRevision + 1,
        updatedAt,
        expiresAt: row.expiresAt ?? null,
        revokedAt: null,
      };
    });
    setSavedProjectEtag(context, metadata.revision);
    return context.json(metadata);
  });

  app.post('/api/projects/:token/revoke', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    const token = context.req.param('token');
    if (!SAVED_PROJECT_TOKEN_PATTERN.test(token)) throw new HttpError(404, 'Project link not found.');
    const rate = savedProjectWriteLimiter.take(student.sessionRef);
    if (!rate.allowed) throw tooManyAttempts(rate.retryAfterSeconds, 'Project sync limit reached. Try again later.');
    const body = await parseJsonBody(context, AUTH_BODY_LIMIT_BYTES);
    const expectedRevision = expectedSavedProjectRevision(body, context);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const requestedAt = clockValue(now);
    const result = await inTransaction(db, async () => {
      await db.advisoryTransactionLock?.(`saved-project:${tokenHash}`);
      const row = await db.prepare(`
        SELECT project_id AS projectId, revision, updated_at AS updatedAt,
          expires_at AS expiresAt, revoked_at AS revokedAt
        FROM saved_projects WHERE token_hash = ?
      `).get(tokenHash);
      if (!row) throw new HttpError(404, 'Project link not found.');
      assertSavedProjectActive(row, requestedAt);
      if (row.revision !== expectedRevision) throw staleSavedProjectError(row);
      const revokedAt = Math.max(requestedAt, row.updatedAt);
      const revoked = await db.prepare(`
        UPDATE saved_projects
        SET revoked_at = ?, updated_at = ?, revision = revision + 1
        WHERE token_hash = ? AND revision = ? AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
      `).run(revokedAt, revokedAt, tokenHash, expectedRevision, requestedAt);
      if (revoked.changes !== 1) {
        const current = await db.prepare(`
          SELECT revision, updated_at AS updatedAt,
            expires_at AS expiresAt, revoked_at AS revokedAt
          FROM saved_projects WHERE token_hash = ?
        `).get(tokenHash);
        if (!current) throw new HttpError(404, 'Project link not found.');
        assertSavedProjectActive(current, requestedAt);
        throw staleSavedProjectError(current);
      }
      return {
        projectId: row.projectId,
        revision: expectedRevision + 1,
        updatedAt: revokedAt,
        expiresAt: row.expiresAt ?? null,
        revokedAt,
      };
    });
    setSavedProjectEtag(context, result.revision);
    return context.json(result);
  });

  app.delete('/api/projects/:token', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    const token = context.req.param('token');
    if (!SAVED_PROJECT_TOKEN_PATTERN.test(token)) throw new HttpError(404, 'Project link not found.');
    const rate = savedProjectWriteLimiter.take(student.sessionRef);
    if (!rate.allowed) throw tooManyAttempts(rate.retryAfterSeconds, 'Project sync limit reached. Try again later.');
    const body = await parseJsonBody(context, AUTH_BODY_LIMIT_BYTES);
    const expectedRevision = expectedSavedProjectRevision(body, context);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const deleted = await inTransaction(db, async () => {
      await db.advisoryTransactionLock?.(`saved-project:${tokenHash}`);
      const row = await db.prepare(`
        SELECT project_id AS projectId, revision, updated_at AS updatedAt,
          expires_at AS expiresAt, revoked_at AS revokedAt
        FROM saved_projects WHERE token_hash = ?
      `).get(tokenHash);
      if (!row) throw new HttpError(404, 'Project link not found.');
      if (row.revision !== expectedRevision) throw staleSavedProjectError(row);
      const removed = await db.prepare(`
        DELETE FROM saved_projects WHERE token_hash = ? AND revision = ?
      `).run(tokenHash, expectedRevision);
      if (removed.changes !== 1) {
        const current = await db.prepare(`
          SELECT revision, updated_at AS updatedAt,
            expires_at AS expiresAt, revoked_at AS revokedAt
          FROM saved_projects WHERE token_hash = ?
        `).get(tokenHash);
        if (!current) throw new HttpError(404, 'Project link not found.');
        throw staleSavedProjectError(current);
      }
      return { deleted: true, projectId: row.projectId, ...savedProjectMetadata(row) };
    });
    return context.json(deleted);
  });

  app.use('/api/teacher/*', async (context, next) => {
    const session = await currentTeacherSession(context, db, now);
    if (!session) throw new HttpError(401, 'Sign in to use the Instructor Console.');
    context.set('teacher', session.user);
    await next();
  });

  app.get('/api/teacher/preflight-submissions', async (context) => {
    const requestedStatus = context.req.query('status');
    const status = requestedStatus === undefined ? 'pending' : requestedStatus;
    if (status !== 'all' && !PREFLIGHT_STATUSES.has(status)) {
      throw new HttpError(400, 'status must be pending, approved, rejected, or all.');
    }
    await inTransaction(db, () => purgeExpiredPreflightSubmissions(db, {
      purgedAt: clockValue(now),
      pendingRetentionDays: preflightPendingRetentionDays,
      decidedRetentionDays: preflightDecidedRetentionDays,
      limit: preflightRetentionPurgeLimit,
      retentionHoldUntil,
    }));
    const where = status === 'all' ? '' : 'WHERE ps.status = ?';
    const parameters = status === 'all' ? [200] : [status, 200];
    const rows = await db.prepare(`
      SELECT ps.id, ps.project_metadata_json AS projectMetadata,
        ps.config_snapshot_json AS configSnapshot, ps.active_scale AS activeScale,
        ps.status, ps.decision, ps.revision,
        ps.created_at AS createdAt, ps.updated_at AS updatedAt, ps.reviewed_at AS reviewedAt
      FROM preflight_submissions ps
      ${where}
      ORDER BY ps.created_at, ps.id
      LIMIT ?
    `).all(...parameters);
    return context.json({
      submissions: rows.map(preflightSubmissionSummaryRow),
    });
  });

  app.get('/api/teacher/preflight-submissions/:id', async (context) => {
    const submissionId = context.req.param('id');
    if (!validSubmissionId(submissionId)) throw new HttpError(404, 'This submission is no longer available. Select Refresh to update the review queue.');
    const detail = await teacherPreflightDetail(db, submissionId);
    if (!detail) throw new HttpError(404, 'This submission is no longer available. Select Refresh to update the review queue.');
    return context.json(detail);
  });

  app.post('/api/teacher/preflight-submissions/:id/decision', async (context) => {
    const submissionId = context.req.param('id');
    if (!validSubmissionId(submissionId)) throw new HttpError(404, 'This submission is no longer available. Select Refresh to update the review queue.');
    const body = await parseJsonBody(context, PREFLIGHT_DECISION_BODY_LIMIT_BYTES);
    assertOnlyKeys(body, ['decision', 'instructorAnnotation', 'focusedQuestion', 'expectedRevision']);
    if (!PREFLIGHT_DECISIONS.has(body.decision)) {
      throw new HttpError(400, 'decision must be approve, revise_and_approve, or reject.');
    }
    const instructorAnnotation = requireString(body.instructorAnnotation, 'instructorAnnotation', { min: 1, max: 8000 });
    const expectedRevision = requireInteger(body.expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER);
    const hasFocusedQuestion = Object.hasOwn(body, 'focusedQuestion');
    if (body.decision !== 'revise_and_approve' && hasFocusedQuestion) {
      throw new HttpError(400, 'focusedQuestion is supported only for revise_and_approve.');
    }
    if (body.decision === 'revise_and_approve' && !hasFocusedQuestion) {
      throw new HttpError(400, 'focusedQuestion is required for revise_and_approve.');
    }
    const focusedQuestion = hasFocusedQuestion
      ? requireString(body.focusedQuestion, 'focusedQuestion', { min: 1, max: 1000 })
      : null;
    const actor = context.get('teacher');
    const decidedAt = clockValue(now);
    const nextRevision = expectedRevision + 1;
    const status = body.decision === 'reject' ? 'rejected' : 'approved';
    const existing = await teacherPreflightSubmission(db, submissionId);
    if (!existing) throw new HttpError(404, 'This submission is no longer available. Select Refresh to update the review queue.');
    if (existing.status !== 'pending' || existing.revision !== expectedRevision) {
      throw new HttpError(409, 'Another session changed this submission after you opened it.', { current: existing });
    }
    const update = db.prepare(`
        UPDATE preflight_submissions
        SET status = ?, decision = ?, revision = ?, updated_at = ?, reviewed_at = ?,
          reviewing_teacher_id = ?, instructor_annotation = ?, revised_suggestion = ?
        WHERE id = ? AND status = 'pending' AND revision = ?
      `);
    const insertEvent = db.prepare(`
      INSERT INTO preflight_review_events (
        submission_id, decision, from_revision, to_revision, instructor_annotation,
        revised_suggestion, decided_at, reviewing_teacher_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const mutate = () => {
      const updated = update.run(
        status,
        body.decision,
        nextRevision,
        decidedAt,
        decidedAt,
        actor.id,
        instructorAnnotation,
        focusedQuestion,
        submissionId,
        expectedRevision,
      );
      const afterUpdate = (result) => {
        if (result.changes !== 1) return false;
        const inserted = insertEvent.run(
          submissionId,
          body.decision,
          expectedRevision,
          nextRevision,
          instructorAnnotation,
          focusedQuestion,
          decidedAt,
          actor.id,
        );
        return inserted && typeof inserted.then === 'function'
          ? inserted.then(() => true)
          : true;
      };
      return updated && typeof updated.then === 'function'
        ? updated.then(afterUpdate)
        : afterUpdate(updated);
    };
    const changed = await inTransaction(db, mutate);
    if (!changed) {
      const current = await teacherPreflightSubmission(db, submissionId);
      throw new HttpError(409, 'Another session changed this submission after you opened it.', { current });
    }
    return context.json(await teacherPreflightDetail(db, submissionId));
  });

  app.get('/api/teacher/prompt-preview', async (context) => {
    const kind = context.req.query('configKind') || 'preflight';
    const scale = context.req.query('scale') || 'micro';
    const stageId = context.req.query('stageId') || undefined;
    const base = await effectiveSnapshot(db, kind, scale, false, null, stageId);
    const effective = await effectiveSnapshot(db, kind, scale, false, null, stageId, context.env?.verifiedAccount?.coursePrompt);
    return context.json({ basePrompt: base.effectivePrompt, effectivePrompt: effective.effectivePrompt,
      baseFingerprint: base.fingerprint, effectiveFingerprint: effective.fingerprint,
      moduleVersions: effective.moduleVersions, configKind: kind, scale, stageId: effective.stageId });
  });

  app.get('/api/teacher/profiles', async (context) => {
    const profiles = await listTeachingProfiles(db);
    return context.json({
      resource: SYSTEMS_MAPPING_EDUCATOR_RESOURCE,
      runtime: suggestionRuntime,
      activeProfileId: profiles.find((profile) => profile.status === 'active')?.id ?? null,
      profiles: profiles.map(teachingProfileSummary),
    });
  });

  app.post('/api/teacher/profiles', async (context) => {
    const body = await parseJsonBody(context);
    assertOnlyKeys(body, ['name', 'note', 'sourceProfileId']);
    const name = requireString(body.name, 'name', { min: 1, max: 120 });
    const note = requireString(body.note, 'note', { min: 3, max: 500 });
    const actor = context.get('teacher');
    const sourceProfile = body.sourceProfileId === undefined
      ? await activeTeachingProfile(db)
      : await teachingProfileById(db, requireTeachingProfileId(body.sourceProfileId, 'sourceProfileId'));
    if (!sourceProfile) throw new HttpError(404, 'That course-settings version is no longer available. Refresh Versions and change history, then choose another version.');
    const profileId = randomBytes(24).toString('base64url');
    const occurredAt = new Date(clockValue(now)).toISOString();
    await inTransaction(db, async () => {
      await db.advisoryTransactionLock?.('teaching-profiles');
      const draftCount = (await db.prepare("SELECT COUNT(*) AS count FROM teaching_profiles WHERE status = 'draft'").get()).count;
      if (Number(draftCount) >= 20) throw new HttpError(409, 'The course already has 20 drafts. Publish one draft before creating another.');
      const profileJson = JSON.stringify(sourceProfile.profile);
      await db.prepare(`
        INSERT INTO teaching_profiles
          (id, name, status, revision, profile_json, fingerprint, parent_id,
            created_at, created_by, updated_at, updated_by, published_at, published_by)
        VALUES (?, ?, 'draft', 1, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `).run(
        profileId,
        name,
        profileJson,
        sourceProfile.fingerprint,
        sourceProfile.id,
        occurredAt,
        actor.id,
        occurredAt,
        actor.id,
      );
      await db.prepare(`
        INSERT INTO teaching_profile_events
          (profile_id, action, revision, profile_json, fingerprint, note, actor_id, occurred_at)
        VALUES (?, 'created', 1, ?, ?, ?, ?, ?)
      `).run(profileId, profileJson, sourceProfile.fingerprint, note, actor.id, occurredAt);
    });
    const profile = await teachingProfileById(db, profileId);
    return context.json({ profile, events: await teachingProfileEvents(db, profileId) }, 201);
  });

  app.get('/api/teacher/profiles/:id', async (context) => {
    const profileId = requireTeachingProfileId(context.req.param('id'));
    const profile = await teachingProfileById(db, profileId);
    if (!profile) throw new HttpError(404, 'That course-settings version is no longer available. Refresh Versions and change history.');
    return context.json({ profile, events: await teachingProfileEvents(db, profileId) });
  });

  app.put('/api/teacher/profiles/:id', async (context) => {
    const profileId = requireTeachingProfileId(context.req.param('id'));
    const body = await parseJsonBody(context);
    assertOnlyKeys(body, ['name', 'profile', 'note', 'expectedRevision']);
    const name = requireString(body.name, 'name', { min: 1, max: 120 });
    const note = requireString(body.note, 'note', { min: 3, max: 500 });
    const expectedRevision = requireInteger(body.expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER);
    const profileValue = requireTeachingProfile(body.profile);
    const profileJson = JSON.stringify(profileValue);
    const nextFingerprint = teachingProfileFingerprint(profileValue);
    const actor = context.get('teacher');
    const occurredAt = new Date(clockValue(now)).toISOString();
    const nextRevision = expectedRevision + 1;
    const changed = await inTransaction(db, async () => {
      const result = await db.prepare(`
        UPDATE teaching_profiles
        SET name = ?, revision = ?, profile_json = ?, fingerprint = ?,
          updated_at = ?, updated_by = ?
        WHERE id = ? AND status = 'draft' AND revision = ?
      `).run(name, nextRevision, profileJson, nextFingerprint, occurredAt, actor.id, profileId, expectedRevision);
      if (result.changes !== 1) return false;
      await db.prepare(`
        INSERT INTO teaching_profile_events
          (profile_id, action, revision, profile_json, fingerprint, note, actor_id, occurred_at)
        VALUES (?, 'updated', ?, ?, ?, ?, ?, ?)
      `).run(profileId, nextRevision, profileJson, nextFingerprint, note, actor.id, occurredAt);
      return true;
    });
    if (!changed) {
      const current = await teachingProfileById(db, profileId);
      if (!current) throw new HttpError(404, 'That course-settings version is no longer available. Refresh Versions and change history.');
      throw new HttpError(409, current.status === 'draft'
        ? 'Another session saved a newer revision of this draft.'
        : 'This version is published or has been replaced. Create a draft to edit the course settings.', { current });
    }
    return context.json({ profile: await teachingProfileById(db, profileId), events: await teachingProfileEvents(db, profileId) });
  });

  app.post('/api/teacher/profiles/:id/publish', async (context) => {
    const profileId = requireTeachingProfileId(context.req.param('id'));
    const body = await parseJsonBody(context);
    assertOnlyKeys(body, ['note', 'expectedRevision']);
    const note = requireString(body.note, 'note', { min: 3, max: 500 });
    const expectedRevision = requireInteger(body.expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER);
    const actor = context.get('teacher');
    const occurredAt = new Date(clockValue(now)).toISOString();
    await inTransaction(db, async () => {
      await db.advisoryTransactionLock?.('teaching-profiles');
      const target = await teachingProfileById(db, profileId);
      if (!target) throw new HttpError(404, 'That course-settings version is no longer available. Refresh Versions and change history.');
      if (target.status !== 'draft' || target.revision !== expectedRevision) {
        throw new HttpError(409, target.status === 'draft'
          ? 'Another session saved a newer revision of this draft.'
          : 'Only a draft can be published. Create or select a draft, then publish it.', { current: target });
      }
      const active = await activeTeachingProfile(db);
      if (active && active.id !== target.id) {
        await db.prepare(`
          UPDATE teaching_profiles SET status = 'retired', updated_at = ?, updated_by = ?
          WHERE id = ? AND status = 'active'
        `).run(occurredAt, actor.id, active.id);
        await db.prepare(`
          INSERT INTO teaching_profile_events
            (profile_id, action, revision, profile_json, fingerprint, note, actor_id, occurred_at)
          VALUES (?, 'retired', ?, ?, ?, ?, ?, ?)
        `).run(active.id, active.revision, JSON.stringify(active.profile), active.fingerprint, note, actor.id, occurredAt);
      }
      const published = await db.prepare(`
        UPDATE teaching_profiles
        SET status = 'active', updated_at = ?, updated_by = ?, published_at = ?, published_by = ?
        WHERE id = ? AND status = 'draft' AND revision = ?
      `).run(occurredAt, actor.id, occurredAt, actor.id, profileId, expectedRevision);
      if (published.changes !== 1) throw new HttpError(409, 'This draft changed while it was being published.');
      await db.prepare(`
        INSERT INTO teaching_profile_events
          (profile_id, action, revision, profile_json, fingerprint, note, actor_id, occurred_at)
        VALUES (?, 'published', ?, ?, ?, ?, ?, ?)
      `).run(profileId, target.revision, JSON.stringify(target.profile), target.fingerprint, note, actor.id, occurredAt);
    });
    return context.json({ profile: await teachingProfileById(db, profileId), events: await teachingProfileEvents(db, profileId) });
  });

  app.get('/api/teacher/profiles/:id/preview', async (context) => {
    const profileId = requireTeachingProfileId(context.req.param('id'));
    const profile = await teachingProfileById(db, profileId);
    if (!profile) throw new HttpError(404, 'That course-settings version is no longer available. Refresh Versions and change history.');
    const configKind = context.req.query('configKind') || 'preflight';
    const scale = context.req.query('scale') || 'micro';
    const stageId = canonicalStageId(context.req.query('stageId') || (configKind === 'builder' ? 'build-map' : 'review-suggestions'));
    const snapshot = await effectiveSnapshot(db, configKind, scale, false, profile, stageId, context.env?.verifiedAccount?.coursePrompt);
    const part = profile.profile.parts.find(({ scaleIds }) => scaleIds.includes(scale));
    const settings = part?.stages?.[stageId];
    if (!part || !settings) throw new HttpError(400, 'The selected part does not include this level and section. Choose a level and section listed under that part.');
    return context.json({
      scale: snapshot.scale,
      stageId: snapshot.stageId,
      part: { id: part.id, label: part.label },
      guidance: settings.guidance,
      materials: settings.materials,
      revision: profile.revision,
    });
  });

  app.get('/api/teacher/modules', () => {
    throw new HttpError(410, 'Teacher configuration now follows the sections in Course settings.');
  });

  app.put('/api/teacher/modules/:id', () => {
    throw new HttpError(410, 'Edit stage guidance from Course settings.');
  });

  app.get('/api/teacher/history', () => {
    throw new HttpError(410, 'Change history is available in Course settings.');
  });

  app.get('/api/teacher/effective', () => {
    throw new HttpError(410, 'Preview a saved stage from Course settings.');
  });

  app.get('/api/teacher/prototype-audit', async (context) => context.json({ prototypeEvents: await prototypeEventAudit(db) }));

  app.get('/api/teacher/student-workflow-evaluation-report', async (context) => {
    context.header('Content-Disposition', 'attachment; filename="student-workflow-evaluation-report.json"');
    return context.json({ evaluation: await studentWorkflowEvaluationReport(db) });
  });

  app.get('/api/config/public', async (context) => {
    const student = await currentStudentSession(context, db, now);
    const teacher = student ? null : await currentTeacherSession(context, db, now);
    if (!student && !teacher) throw new HttpError(401, 'Student class access or teacher authentication is required.');
    const configKind = context.req.query('configKind') || 'preflight';
    const scale = context.req.query('scale') || 'micro';
    const stageId = canonicalStageId(context.req.query('stageId') || (configKind === 'builder' ? 'build-map' : 'review-suggestions'));
    return context.json(publicSnapshotMetadata(await effectiveSnapshot(db, configKind, scale, false, null, stageId, context.env?.verifiedAccount?.coursePrompt)));
  });

  app.all('/api/*', (context) => context.json({ error: 'API route not found.' }, 404));

  const close = () => {
    if (ownsDatabase) return db.close();
    return undefined;
  };
  return { app, db, close, ready, hostedMode };
}
