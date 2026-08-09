import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';
import { evaluateSubmission } from '../src/domain.js';
import {
  clearSession,
  clearStudentSession,
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
  verifyPassphrase,
} from './auth.js';
import {
  composeEffectivePrompt,
  CONFIG_KINDS,
  EFFECTIVE_SCALES,
  fingerprint,
  FIXED_GUARDRAILS,
} from './config.js';
import { inTransaction, openDataStore, prototypeEventAudit } from './database.js';
import { OLLAMA_CLOUD_LIMITS, requestOllamaSuggestion } from './ollama.js';

const DEFAULT_TEACHER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_STUDENT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_PROTOTYPE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PREFLIGHT_SUBMISSION_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_PREFLIGHT_EVALUATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PREFLIGHT_PENDING_RETENTION_DAYS = 30;
const DEFAULT_PREFLIGHT_DECIDED_RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLASS_CODE = '101';
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
const PREFLIGHT_SCALES = new Set(['micro', 'meso', 'macro', 'integration']);
const PREFLIGHT_STATUSES = new Set(['pending', 'approved', 'rejected']);
const PREFLIGHT_DECISIONS = new Set(['approve', 'revise_and_approve', 'reject']);
const PROJECT_METADATA_RULES = Object.freeze({
  id: { type: 'string', max: 200 },
  projectId: { type: 'string', max: 200 },
  submissionId: { type: 'string', max: 200 },
  title: { type: 'string', max: 500, empty: true },
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
const SUGGESTION_KEYS = [
  'hard', 'scored', 'hardPass', 'score', 'threshold', 'outcome', 'evaluatedAt', 'configurationSnapshot',
];
const CRITERION_KEYS = [
  'id', 'status', 'evidence', 'evidenceLocator', 'evidenceExcerpt', 'evidenceHash', 'evidenceId',
  'sourceId', 'evidenceRefs', 'rationale', 'missingVariable', 'nextAction', 'confidence',
  'hardBlock', 'relationshipCount', 'sourceLabel', 'targetLabel', 'verb', 'scale',
];
const OLLAMA_SUGGESTION_SCHEMA_INSTRUCTION = [
  'AUTHORITATIVE SUGGESTION JSON CONTRACT',
  'Return one object with exactly these keys: hard, scored, hardPass, score, threshold, outcome, evaluatedAt, configurationSnapshot.',
  'hard must be an array of exactly four criterion objects in ID order H1, H2, H3, H4.',
  'scored must be an array of exactly eight criterion objects in ID order C1, C2, C3, C4, C5, C6, C7, C8.',
  'Every criterion must include exactly these required keys: id, status, evidence, rationale, missingVariable, nextAction, confidence, hardBlock.',
  `A criterion may additionally include only these evidence keys: ${CRITERION_KEYS.filter((key) => ![
    'id', 'status', 'evidence', 'rationale', 'missingVariable', 'nextAction', 'confidence', 'hardBlock',
  ].includes(key)).join(', ')}.`,
  'status must be met or unmet. missingVariable must be null or a string. confidence must be a number from 0 through 1.',
  'hardBlock must be true for H1-H4 and false for C1-C8.',
  'hardPass must equal whether all four hard criteria are met. score must equal the number of met scored criteria. threshold must be 6.',
  'outcome must be hold when hardPass is false, pass when hardPass is true and score is at least threshold, and conditional otherwise.',
  'evaluatedAt must be an ISO timestamp string. configurationSnapshot must be an object; the server will replace both with authoritative values.',
  'Do not add review, prose outside the object, Markdown, graph operations, or any unlisted key.',
].join('\n');
const PROTOTYPE_EVENTS = new Set([
  'project_started',
  'project_resumed',
  'stage_viewed',
  'stage_completed',
  'node_moved',
  'viewport_changed',
  'annotation_saved',
  'project_exported',
  'project_imported',
  'recovery_exported',
]);
const PROTOTYPE_STAGES = new Map([
  ['Select scale', 0],
  ['Source intake', 1],
  ['Suggestion review', 2],
  ['Instructor response', 3],
  ['Candidate review', 4],
  ['Map studio', 5],
  ['Revision and export', 6],
]);
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
  requireObjectKeys(value, [
    'id', 'title', 'author', 'date', 'sourceType', 'location', 'rights',
    'sensitive', 'consent', 'evidenceOwnership',
  ], 'sourceRecord');
  const validated = {};
  for (const key of ['id', 'title', 'author', 'date', 'sourceType', 'location', 'rights', 'evidenceOwnership']) {
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

function validateCriterion(value, name, expectedId, hardBlock) {
  assertOnlyNamedKeys(value, CRITERION_KEYS, name);
  if (value.id !== expectedId) throw new HttpError(400, `${name}.id must be ${expectedId}.`);
  if (!['met', 'unmet'].includes(value.status)) throw new HttpError(400, `${name}.status must be met or unmet.`);
  requireSnapshotText(value.evidence, `${name}.evidence`, { max: 32_000 });
  requireSnapshotText(value.rationale, `${name}.rationale`, { max: 8000 });
  requireSnapshotText(value.nextAction, `${name}.nextAction`, { max: 8000 });
  if (value.missingVariable !== null) requireSnapshotText(value.missingVariable, `${name}.missingVariable`, { max: 8000 });
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new HttpError(400, `${name}.confidence must be a finite number between 0 and 1.`);
  }
  if (value.hardBlock !== hardBlock) throw new HttpError(400, `${name}.hardBlock is inconsistent with its criterion group.`);
  for (const field of ['evidenceLocator', 'evidenceExcerpt', 'evidenceHash', 'evidenceId', 'sourceId', 'sourceLabel', 'targetLabel', 'verb']) {
    if (value[field] !== undefined) requireSnapshotText(value[field], `${name}.${field}`, { max: field === 'evidenceExcerpt' ? 32_000 : 1000 });
  }
  if (value.relationshipCount !== undefined) requireInteger(value.relationshipCount, `${name}.relationshipCount`, 0, 1000);
  if (value.scale !== undefined && !PREFLIGHT_SCALES.has(value.scale)) throw new HttpError(400, `${name}.scale is not supported.`);
  if (value.evidenceRefs !== undefined && !Array.isArray(value.evidenceRefs)) throw new HttpError(400, `${name}.evidenceRefs must be an array.`);
}

function validateSuggestion(value, name = 'suggestion') {
  validateBoundedJson(value, name);
  assertOnlyNamedKeys(value, SUGGESTION_KEYS, name);
  requireObjectKeys(value, SUGGESTION_KEYS, name);
  if (!Array.isArray(value.hard) || value.hard.length !== 4) throw new HttpError(400, `${name}.hard must contain four criteria.`);
  if (!Array.isArray(value.scored) || value.scored.length !== 8) throw new HttpError(400, `${name}.scored must contain eight criteria.`);
  value.hard.forEach((criterion, index) => validateCriterion(criterion, `${name}.hard[${index}]`, `H${index + 1}`, true));
  value.scored.forEach((criterion, index) => validateCriterion(criterion, `${name}.scored[${index}]`, `C${index + 1}`, false));
  const hardPass = value.hard.every((criterion) => criterion.status === 'met');
  const score = value.scored.filter((criterion) => criterion.status === 'met').length;
  if (value.hardPass !== hardPass) throw new HttpError(400, `${name}.hardPass does not match its criteria.`);
  if (value.score !== score) throw new HttpError(400, `${name}.score does not match its criteria.`);
  requireInteger(value.threshold, `${name}.threshold`, 1, 8);
  const outcome = !hardPass ? 'hold' : score >= value.threshold ? 'pass' : 'conditional';
  if (value.outcome !== outcome) throw new HttpError(400, `${name}.outcome does not match its criteria.`);
  requireTimestamp(value.evaluatedAt, `${name}.evaluatedAt`);
  validateBoundedJson(value.configurationSnapshot, `${name}.configurationSnapshot`);
  return value;
}

function validatePreflightEvaluationRequest(value) {
  assertOnlyKeys(value, [
    'projectMetadata', 'activeScale', 'inquiry', 'sourceRecord', 'sourceMaterial', 'projectOverlay',
  ]);
  const projectMetadata = validateProjectMetadata(value.projectMetadata);
  if (!PREFLIGHT_SCALES.has(value.activeScale)) throw new HttpError(400, 'activeScale is not supported.');
  const inquiry = requireSnapshotText(value.inquiry, 'inquiry', { max: 8000 });
  const sourceRecord = validateSourceRecord(value.sourceRecord);
  const sourceMaterial = requireSnapshotText(value.sourceMaterial, 'sourceMaterial', { max: 500_000 });
  const { metadata: projectOverlay, customInstructions } = validateProjectOverlay(value.projectOverlay);
  return {
    projectMetadata,
    activeScale: value.activeScale,
    inquiry,
    sourceRecord,
    sourceMaterial,
    projectOverlay,
    customInstructions,
  };
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

function authoritativeRuntimeMetadata(value, { provider, model, createdAt }) {
  if (!isPlainObject(value)) value = {};
  const metadata = { provider, model, createdAt: new Date(createdAt).toISOString() };
  if (provider === 'ollama-cloud') {
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

function evaluationConfigSnapshot(effective, projectOverlay, customInstructions, activeScale, createdAt) {
  const shared = publicSnapshotMetadata(effective);
  return {
    kind: 'preflight',
    activeScale,
    capturedAt: new Date(createdAt).toISOString(),
    shared: {
      fingerprint: shared.fingerprint,
      revision: shared.revision,
      moduleVersions: shared.moduleVersions,
    },
    projectOverlay,
    effectiveFingerprint: fingerprint(`${shared.fingerprint}:${fingerprint(JSON.stringify({ projectOverlay, customInstructions }))}`),
  };
}

function preflightEvaluationResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    suggestion: storedJson(row.suggestion),
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

function preflightSubmissionRow(row, { includeTeacher = false } = {}) {
  if (!row) return null;
  const projectMetadata = storedJson(row.projectMetadata);
  return {
    id: row.id,
    projectId: projectMetadata.projectId ?? projectMetadata.id,
    projectMetadata,
    activeScale: row.activeScale,
    inquiry: row.inquiry,
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
    revisedSuggestion: row.revisedSuggestion ?? null,
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
    revisedSuggestion: row.revisedSuggestion ?? null,
  };
}

function preflightReviewEventRow(row) {
  return {
    id: row.id,
    decision: row.decision,
    fromRevision: row.fromRevision,
    toRevision: row.toRevision,
    instructorAnnotation: row.instructorAnnotation,
    revisedSuggestion: row.revisedSuggestion ?? null,
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
  ps.revised_suggestion AS revisedSuggestion
`;

async function preflightEvaluationById(db, evaluationId) {
  const row = await db.prepare(`
    SELECT id, suggestion_json AS suggestion, config_snapshot_json AS configSnapshot,
      runtime_metadata_json AS runtimeMetadata, created_at AS createdAt, expires_at AS expiresAt
    FROM preflight_evaluations WHERE id = ?
  `).get(evaluationId);
  return preflightEvaluationResponse(row);
}

async function studentPreflightSubmission(db, submissionId) {
  const row = await db.prepare(`
    SELECT ps.id, ps.project_metadata_json AS projectMetadata, ps.status, ps.decision,
      ps.revision, ps.created_at AS createdAt, ps.updated_at AS updatedAt,
      ps.reviewed_at AS reviewedAt, ps.instructor_annotation AS instructorAnnotation,
      ps.revised_suggestion AS revisedSuggestion
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
      e.revised_suggestion AS revisedSuggestion, e.decided_at AS decidedAt,
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
  return {
    id: row.id,
    projectId: projectMetadata.projectId ?? projectMetadata.id,
    projectTitle: projectMetadata.title || '',
    activeScale: row.activeScale,
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

async function listModules(db, where = '', parameters = []) {
  return (await db.prepare(`
    SELECT pm.id, pm.config_kind AS configKind, pm.scale, pm.module_key AS moduleKey,
      pm.label, pm.description, pm.content, pm.revision, pm.fingerprint,
      pm.updated_at AS updatedAt, a.display_name AS updatedByName
    FROM prompt_modules pm
    LEFT JOIN accounts a ON a.id = pm.updated_by
    ${where}
    ORDER BY CASE pm.config_kind WHEN 'preflight' THEN 1 ELSE 2 END,
      CASE pm.scale WHEN 'global' THEN 0 WHEN 'micro' THEN 1 WHEN 'meso' THEN 2 WHEN 'macro' THEN 3 ELSE 4 END,
      ${MODULE_ORDER_SQL}
  `).all(...parameters)).map(moduleRow);
}

async function effectiveSnapshot(db, configKind, scale, includeModules = false) {
  if (!CONFIG_KINDS.includes(configKind)) throw new HttpError(400, 'configKind must be preflight or builder.');
  if (!EFFECTIVE_SCALES.includes(scale)) throw new HttpError(400, 'scale must be micro, meso, macro, or integration.');
  const modules = await listModules(db, 'WHERE pm.config_kind = ? AND pm.scale IN (?, ?)', [configKind, 'global', scale]);
  const effectivePrompt = composeEffectivePrompt({ configKind, scale, modules });
  const snapshot = {
    configKind,
    scale,
    effectivePrompt,
    fixedGuardrails: FIXED_GUARDRAILS.join('\n'),
    fingerprint: fingerprint(effectivePrompt),
    revision: Math.max(...modules.map((module) => module.revision)),
    moduleVersions: modules.map(({ id, revision, fingerprint: moduleFingerprint }) => ({ id, revision, fingerprint: moduleFingerprint })),
  };
  if (includeModules) snapshot.modules = modules;
  return snapshot;
}

function publicSnapshotMetadata(snapshot) {
  return {
    configKind: snapshot.configKind,
    scale: snapshot.scale,
    fingerprint: snapshot.fingerprint,
    revision: snapshot.revision,
    moduleVersions: snapshot.moduleVersions,
    guardrailsFingerprint: fingerprint(snapshot.fixedGuardrails),
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
  return {
    acquire() {
      if (active >= limit) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}

function tooManyAttempts(retryAfterSeconds, message) {
  return new HttpError(429, message, { retryAfterSeconds }, { 'Retry-After': String(retryAfterSeconds) });
}

function validatePrototypeMetadata(metadata) {
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
}) {
  const metadataJson = JSON.stringify(metadata);
  await inTransaction(db, async () => {
    await db.advisoryTransactionLock?.('prototype-events');
    await prunePrototypeEvents(db, { recordedAt, retentionMs, maxRows });
    await db.prepare(`
      INSERT INTO prototype_events
        (session_kind, session_ref, event_name, stage, metadata_json, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionKind, sessionRef, event, stage, metadataJson, recordedAt);
    await prunePrototypeEvents(db, { recordedAt, retentionMs, maxRows });
  });
}

function prunePrototypeEvents(db, { recordedAt, retentionMs, maxRows }) {
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
  const db = options.db || openDataStore({
    databaseUrl: options.databaseUrl,
    dbPath: options.dbPath,
    postgres: options.postgres,
  });
  const ownsDatabase = !options.db;
  const now = options.now ?? Date.now;
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
  const preflightEvaluationLimit = positiveInteger(options.preflightEvaluationLimit, 'preflightEvaluationLimit', 5, { max: 100 });
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
  const preflightMaxActiveEvaluationsPerSession = positiveInteger(
    options.preflightMaxActiveEvaluationsPerSession,
    'preflightMaxActiveEvaluationsPerSession',
    3,
    { max: 20 },
  );
  const preflightMaxActiveEvaluationsTotal = positiveInteger(
    options.preflightMaxActiveEvaluationsTotal,
    'preflightMaxActiveEvaluationsTotal',
    100,
    { max: 10_000 },
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
  const suggestionRuntime = Object.freeze(ollamaConfig
    ? {
      provider: 'ollama-cloud',
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
  let teacherBootstrapToken = options.teacherBootstrapToken ?? null;
  if (hostedMode) {
    if (typeof classCode !== 'string' || classCode.length < 10 || classCode.length > 32
      || classCode === DEFAULT_CLASS_CODE || new Set(classCode).size < 6) {
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
    });
    return continueWith(prototypeResult, () => continueWith(
      purgeExpiredPreflightSubmissions(db, {
        purgedAt: recordedAt,
        pendingRetentionDays: preflightPendingRetentionDays,
        decidedRetentionDays: preflightDecidedRetentionDays,
        limit: preflightRetentionPurgeLimit,
      }),
      () => purgeExpiredPreflightEvaluations(db, {
        expiredAt: recordedAt,
        limit: preflightEvaluationPurgeLimit,
      }),
    ));
  });
  const ready = db.dialect === 'postgres'
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
  const preflightEvaluationCapacity = concurrencyLimiter(preflightEvaluationConcurrency);
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
    console.error('Systems Mapping request failed with an internal error.');
    return context.json({ error: 'Internal server error.' }, 500);
  });

  app.use('*', async (context, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) context.header(name, value);
    if (context.req.path.startsWith('/api/') || !context.req.path.startsWith('/assets/')) {
      context.header('Cache-Control', 'no-store');
      context.header('Pragma', 'no-cache');
    }
    await ready;
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
  });

  const ensureNotBlocked = (limiter, key, message) => {
    const retryAfterSeconds = limiter.blocked(key);
    if (retryAfterSeconds) throw tooManyAttempts(retryAfterSeconds, message);
  };

  const registerTeacherFailure = (key) => {
    const failure = teacherLimiter.fail(key);
    if (failure.blocked) throw tooManyAttempts(failure.retryAfterSeconds, 'Too many teacher authentication attempts. Try again later.');
    throw new HttpError(401, 'Teacher credentials were not accepted.');
  };

  app.use('/api/auth/*', async (context, next) => {
    if (context.req.method !== 'POST' || !['/api/auth/claim', '/api/auth/login'].includes(context.req.path)) {
      await next();
      return;
    }
    const release = teacherConcurrency.acquire();
    if (!release) throw tooManyAttempts(1, 'Too many teacher authentication attempts. Try again later.');
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
    ensureNotBlocked(teacherLimiter, attemptKey, 'Too many teacher authentication attempts. Try again later.');
    if (teacherBootstrapToken === null) throw new HttpError(503, 'Teacher account claim is unavailable.');
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
    ensureNotBlocked(teacherLimiter, attemptKey, 'Too many teacher authentication attempts. Try again later.');
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
    if (ollamaConfig && Buffer.byteLength(input.sourceMaterial, 'utf8') > OLLAMA_CLOUD_LIMITS.sourceTextBytes) {
      throw new HttpError(
        413,
        `sourceMaterial must contain no more than ${OLLAMA_CLOUD_LIMITS.sourceTextBytes} UTF-8 bytes for this suggestion runtime.`,
      );
    }
    if (ollamaConfig && Buffer.byteLength(input.inquiry, 'utf8') > OLLAMA_CLOUD_LIMITS.inquiryBytes) {
      throw new HttpError(
        413,
        `inquiry must contain no more than ${OLLAMA_CLOUD_LIMITS.inquiryBytes} UTF-8 bytes for this suggestion runtime.`,
      );
    }
    const rate = preflightEvaluationLimiter.take(student.sessionRef);
    if (!rate.allowed) {
      throw tooManyAttempts(rate.retryAfterSeconds, 'Preflight evaluation limit reached for this class session. Try again later.');
    }
    const release = preflightEvaluationCapacity.acquire();
    if (!release) throw tooManyAttempts(1, 'Preflight evaluation capacity is busy. Try again shortly.');

    const evaluationId = randomBytes(24).toString('base64url');
    const createdAt = clockValue(now);
    const expiresAt = createdAt + preflightEvaluationTtlMs;
    let suggestion;
    let configSnapshot;
    let runtimeMetadata;
    try {
      const effective = await effectiveSnapshot(db, 'preflight', input.activeScale, true);
      configSnapshot = evaluationConfigSnapshot(
        effective,
        input.projectOverlay,
        input.customInstructions,
        input.activeScale,
        createdAt,
      );
      if (ollamaConfig) {
        try {
          const systemPrompt = input.customInstructions
            ? `${effective.effectivePrompt}\n\nSTUDENT PROJECT OVERLAY\n[Custom instructions]\n${input.customInstructions}\n\n${OLLAMA_SUGGESTION_SCHEMA_INSTRUCTION}`
            : `${effective.effectivePrompt}\n\n${OLLAMA_SUGGESTION_SCHEMA_INSTRUCTION}`;
          const generated = await ollamaRequest({
            systemPrompt,
            activeScale: input.activeScale,
            inquiry: input.inquiry,
            sourceMetadata: input.sourceRecord,
            sourceText: input.sourceMaterial,
          }, ollamaConfig);
          validateSuggestion(generated.suggestion, 'generated suggestion');
          suggestion = { ...structuredClone(generated.suggestion), evaluatedAt: new Date(createdAt).toISOString(), configurationSnapshot: configSnapshot };
          validateSuggestion(suggestion);
          runtimeMetadata = authoritativeRuntimeMetadata(generated.metadata, {
            provider: 'ollama-cloud',
            model: ollamaConfig.model,
            createdAt,
          });
        } catch {
          throw new HttpError(502, 'Suggestion generation is temporarily unavailable.');
        }
      } else {
        suggestion = evaluateSubmission(
          { ...input.sourceRecord, text: input.sourceMaterial },
          input.activeScale,
          6,
        );
        suggestion.evaluatedAt = new Date(createdAt).toISOString();
        suggestion.configurationSnapshot = configSnapshot;
        validateSuggestion(suggestion);
        runtimeMetadata = authoritativeRuntimeMetadata({}, {
          provider: 'deterministic',
          model: 'STEM Splitter',
          createdAt,
        });
      }

      await inTransaction(db, async () => {
        await db.advisoryTransactionLock?.('preflight-evaluations:active-cap');
        await purgeExpiredPreflightEvaluations(db, { expiredAt: createdAt, limit: preflightEvaluationPurgeLimit });
        const { count, sessionCount } = await db.prepare(`
          SELECT COUNT(*) AS count,
            SUM(CASE WHEN student_session_ref = ? THEN 1 ELSE 0 END) AS sessionCount
          FROM preflight_evaluations
          WHERE consumed_at IS NULL AND expires_at > ?
        `).get(student.sessionRef, createdAt);
        if ((sessionCount ?? 0) >= preflightMaxActiveEvaluationsPerSession) {
          throw new HttpError(429, 'This class session already has the maximum number of active preflight evaluations.');
        }
        if (count >= preflightMaxActiveEvaluationsTotal) {
          throw new HttpError(429, 'The course has reached its active preflight evaluation limit.');
        }
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
          input.inquiry,
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
      await purgeExpiredPreflightEvaluations(db, { expiredAt: submittedAt, limit: preflightEvaluationPurgeLimit });
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
      throw new HttpError(409, 'The preflight evaluation is unavailable, expired, or already used.');
    }
    return context.json({
      submission: await studentPreflightSubmission(db, submissionId),
    }, 201);
  });

  app.get('/api/preflight/submissions/:id', async (context) => {
    const student = await currentStudentSession(context, db, now);
    if (!student) throw new HttpError(401, 'Student class access is required.');
    const submissionId = context.req.param('id');
    if (!validSubmissionId(submissionId)) throw new HttpError(404, 'Preflight submission not found.');
    const submission = await studentPreflightSubmission(db, submissionId);
    if (!submission) throw new HttpError(404, 'Preflight submission not found.');
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
    const metadata = validatePrototypeMetadata(body.metadata);
    await record({
      sessionKind: 'student',
      sessionRef: student.sessionRef,
      event: body.event,
      stage,
      metadata,
    });
    return context.json({ accepted: true }, 202);
  });

  app.use('/api/teacher/*', async (context, next) => {
    const session = await currentTeacherSession(context, db, now);
    if (!session) throw new HttpError(401, 'Teacher authentication is required.');
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
    }));
    const where = status === 'all' ? '' : 'WHERE ps.status = ?';
    const parameters = status === 'all' ? [200] : [status, 200];
    const rows = await db.prepare(`
      SELECT ps.id, ps.project_metadata_json AS projectMetadata,
        ps.active_scale AS activeScale, ps.status, ps.decision, ps.revision,
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
    if (!validSubmissionId(submissionId)) throw new HttpError(404, 'Preflight submission not found.');
    const detail = await teacherPreflightDetail(db, submissionId);
    if (!detail) throw new HttpError(404, 'Preflight submission not found.');
    return context.json(detail);
  });

  app.post('/api/teacher/preflight-submissions/:id/decision', async (context) => {
    const submissionId = context.req.param('id');
    if (!validSubmissionId(submissionId)) throw new HttpError(404, 'Preflight submission not found.');
    const body = await parseJsonBody(context, PREFLIGHT_DECISION_BODY_LIMIT_BYTES);
    assertOnlyKeys(body, ['decision', 'instructorAnnotation', 'revisedSuggestion', 'expectedRevision']);
    if (!PREFLIGHT_DECISIONS.has(body.decision)) {
      throw new HttpError(400, 'decision must be approve, revise_and_approve, or reject.');
    }
    const instructorAnnotation = requireString(body.instructorAnnotation, 'instructorAnnotation', { min: 1, max: 8000 });
    const expectedRevision = requireInteger(body.expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER);
    const hasRevisedSuggestion = Object.hasOwn(body, 'revisedSuggestion');
    if (body.decision !== 'revise_and_approve' && hasRevisedSuggestion) {
      throw new HttpError(400, 'revisedSuggestion is supported only for revise_and_approve.');
    }
    if (body.decision === 'revise_and_approve' && !hasRevisedSuggestion) {
      throw new HttpError(400, 'revisedSuggestion is required for revise_and_approve.');
    }
    const revisedSuggestion = hasRevisedSuggestion
      ? requireString(body.revisedSuggestion, 'revisedSuggestion', { min: 1, max: 20_000 })
      : null;
    const actor = context.get('teacher');
    const decidedAt = clockValue(now);
    const nextRevision = expectedRevision + 1;
    const status = body.decision === 'reject' ? 'rejected' : 'approved';
    const existing = await teacherPreflightSubmission(db, submissionId);
    if (!existing) throw new HttpError(404, 'Preflight submission not found.');
    if (existing.status !== 'pending' || existing.revision !== expectedRevision) {
      throw new HttpError(409, 'This preflight submission changed after it was loaded.', { current: existing });
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
        revisedSuggestion,
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
          revisedSuggestion,
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
      throw new HttpError(409, 'This preflight submission changed after it was loaded.', { current });
    }
    return context.json(await teacherPreflightDetail(db, submissionId));
  });

  app.get('/api/teacher/modules', async (context) => context.json({ modules: await listModules(db) }));

  app.put('/api/teacher/modules/:id', async (context) => {
    const body = await parseJsonBody(context);
    assertOnlyKeys(body, ['content', 'changeNote', 'expectedRevision']);
    const moduleId = context.req.param('id');
    const content = requireString(body.content, 'content');
    const changeNote = requireString(body.changeNote, 'changeNote', { min: 3, max: 500 });
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1) throw new HttpError(400, 'expectedRevision must be a positive integer.');
    const actor = context.get('teacher');
    const existing = await db.prepare('SELECT id, revision FROM prompt_modules WHERE id = ?').get(moduleId);
    if (!existing) throw new HttpError(404, 'Prompt module not found.');
    if (existing.revision !== body.expectedRevision) {
      const current = (await listModules(db, 'WHERE pm.id = ?', [moduleId]))[0];
      throw new HttpError(409, 'This module changed after it was loaded.', { current });
    }
    const changedAt = new Date(clockValue(now)).toISOString();
    const nextRevision = existing.revision + 1;
    const nextFingerprint = fingerprint(content);
    const changes = await inTransaction(db, async () => {
      const result = await db.prepare(`
        UPDATE prompt_modules
        SET content = ?, revision = ?, fingerprint = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND revision = ?
      `).run(content, nextRevision, nextFingerprint, changedAt, actor.id, moduleId, body.expectedRevision);
      if (result.changes !== 1) return false;
      await db.prepare(`
        INSERT INTO prompt_module_history
          (module_id, revision, content, fingerprint, change_note, changed_at, changed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(moduleId, nextRevision, content, nextFingerprint, changeNote, changedAt, actor.id);
      return true;
    });
    if (!changes) {
      const current = (await listModules(db, 'WHERE pm.id = ?', [moduleId]))[0];
      throw new HttpError(409, 'This module changed after it was loaded.', { current });
    }
    return context.json({ module: (await listModules(db, 'WHERE pm.id = ?', [moduleId]))[0] });
  });

  app.get('/api/teacher/history', async (context) => {
    const requestedLimit = Number.parseInt(context.req.query('limit') || '50', 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 50;
    const history = (await db.prepare(`
      SELECT h.id, h.module_id AS moduleId, pm.config_kind AS configKind, pm.scale,
        pm.module_key AS moduleKey, pm.label, h.revision, h.content, h.fingerprint,
        h.change_note AS changeNote, h.changed_at AS changedAt, a.display_name AS changedByName
      FROM prompt_module_history h
      JOIN prompt_modules pm ON pm.id = h.module_id
      LEFT JOIN accounts a ON a.id = h.changed_by
      ORDER BY h.id DESC LIMIT ?
    `).all(limit)).map((entry) => ({ ...entry, changedByName: entry.changedByName ?? null }));
    return context.json({ history });
  });

  app.get('/api/teacher/effective', async (context) => {
    const configKind = context.req.query('configKind') || 'preflight';
    const scale = context.req.query('scale') || 'micro';
    return context.json(await effectiveSnapshot(db, configKind, scale, true));
  });

  app.get('/api/teacher/prototype-audit', async (context) => context.json({ prototypeEvents: await prototypeEventAudit(db) }));

  app.get('/api/config/public', async (context) => {
    const student = await currentStudentSession(context, db, now);
    const teacher = student ? null : await currentTeacherSession(context, db, now);
    if (!student && !teacher) throw new HttpError(401, 'Student class access or teacher authentication is required.');
    const configKind = context.req.query('configKind') || 'preflight';
    const scale = context.req.query('scale') || 'micro';
    return context.json(publicSnapshotMetadata(await effectiveSnapshot(db, configKind, scale, false)));
  });

  app.all('/api/*', (context) => context.json({ error: 'API route not found.' }, 404));

  const close = () => {
    if (ownsDatabase) return db.close();
    return undefined;
  };
  return { app, db, close, ready, hostedMode };
}
