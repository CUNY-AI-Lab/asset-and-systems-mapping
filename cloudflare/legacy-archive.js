import { createHash } from 'node:crypto';
import { inTransaction } from '../server/database.js';

// Offline preparation only. Nothing imports this module from a serving route.
// Source attribution is not an SSO identity or an authorization grant. A future
// reader must separately verify ownership of the explicitly assigned course.
export const LEGACY_ARCHIVE_ORIGIN = 'https://web-production-08455.up.railway.app';
export const LEGACY_ARCHIVE_LIMITS = Object.freeze({
  records: 50,
  batchBytes: 2 * 1024 * 1024,
  payloadBytes: 2 * 1024 * 1024 - 4096,
  depth: 24,
  work: 100_000,
});
const TABLE_COLUMNS = Object.freeze({
  accounts: ['id', 'display_name', 'created_at'],
  teaching_profiles: ['id', 'name', 'status', 'revision', 'profile_json', 'fingerprint', 'parent_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'published_at', 'published_by'],
  teaching_profile_events: ['profile_id', 'action', 'revision', 'profile_json', 'fingerprint', 'note', 'actor_id', 'occurred_at'],
  preflight_submissions: ['project_metadata_json', 'active_scale', 'inquiry', 'source_material', 'source_record_json', 'student_annotation', 'suggestion_json', 'config_snapshot_json', 'runtime_metadata_json', 'status', 'decision', 'revision', 'created_at', 'updated_at', 'reviewed_at', 'reviewing_teacher_id', 'instructor_annotation', 'revised_suggestion'],
  preflight_review_events: ['submission_ref', 'decision', 'from_revision', 'to_revision', 'instructor_annotation', 'revised_suggestion', 'decided_at', 'reviewing_teacher_id'],
  saved_projects: ['project_id', 'project_json', 'created_at', 'updated_at', 'revision', 'expires_at', 'revoked_at'],
  prompt_modules: ['id', 'config_kind', 'scale', 'module_key', 'label', 'description', 'content', 'revision', 'fingerprint', 'updated_at', 'updated_by'],
  prompt_module_history: ['module_id', 'revision', 'content', 'fingerprint', 'change_note', 'changed_at', 'changed_by'],
  preflight_retention_purges: ['submission_ref_hash', 'status', 'decision', 'purged_at', 'purged_by'],
});
export const LEGACY_ARCHIVE_TABLES = Object.freeze(Object.keys(TABLE_COLUMNS).sort());
const RAW_ONLY_COLUMNS = Object.freeze({
  accounts: ['passphrase_hash', 'passphrase_salt', 'claimed_at'],
  teaching_profile_events: ['id'],
  preflight_submissions: ['id', 'student_session_ref'],
  preflight_review_events: ['id', 'submission_id'],
  saved_projects: ['token_hash', 'created_session_ref'],
  prompt_module_history: ['id'],
  preflight_retention_purges: ['id'],
});
const NULLABLE_COLUMNS = Object.freeze({
  accounts: [],
  teaching_profiles: ['parent_id', 'created_by', 'updated_by', 'published_at', 'published_by'],
  teaching_profile_events: ['actor_id'],
  preflight_submissions: ['source_record_json', 'runtime_metadata_json', 'decision', 'reviewed_at', 'reviewing_teacher_id', 'instructor_annotation', 'revised_suggestion'],
  preflight_review_events: ['revised_suggestion'],
  saved_projects: ['expires_at', 'revoked_at'],
  prompt_modules: ['updated_by'],
  prompt_module_history: ['changed_by'],
  preflight_retention_purges: ['decision'],
});
const OPTIONAL_COLUMNS = new Set(['source_record_json', 'runtime_metadata_json', 'revision', 'expires_at', 'revoked_at']);
const INTEGER_COLUMNS = new Set(['revision', 'from_revision', 'to_revision', 'created_at', 'updated_at', 'reviewed_at', 'decided_at', 'expires_at', 'revoked_at', 'purged_at']);
const HASH = /^[0-9a-f]{64}$/;
const BATCH_ID = /^[A-Za-z0-9_-]{1,100}$/;
const CAPABILITY_KEYS = new Set(['evaluationid', 'reviewid', 'submissionid', 'preflightsubmissionid', 'evaluationtoken', 'reviewtoken', 'linktoken']);
const FORBIDDEN_KEYS = new Set(['proto', 'prototype', 'constructor', 'password', 'passwordhash', 'passwordsalt', 'passphrase', 'passphrasehash', 'passphrasesalt', 'apikey', 'secret', 'secretkey', 'secrettoken', 'privatekey', 'accesstoken', 'refreshtoken', 'authorization', 'cookie', 'token', 'jwt', 'assertion', 'accessgrant', 'sessiontoken', 'sessionid', 'sessionref', 'tokenhash', 'studentsessionref', 'createdsessionref', 'resettoken', 'bootstraptoken', 'gatewayjwt', 'appjwt', 'identityjwt', 'classcode', 'studentcode']);
const normalizeKey = key => key.toLowerCase().replace(/[^a-z0-9_]/g, '').replaceAll('_', '');
const bytes = value => new TextEncoder().encode(value).byteLength;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new LegacyArchiveError(code); };

export class LegacyArchiveError extends Error {
  constructor(code) {
    // Never put imported values, memo text, credentials, or identities in errors.
    super(`Legacy archive rejected: ${code}`);
    this.name = 'LegacyArchiveError';
    this.code = code;
  }
}

function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_shape');
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))) fail('invalid_fields');
}

function scanSafeJson(value) {
  const stack = [{ value, depth: 0 }];
  let work = 0;
  while (stack.length) {
    const current = stack.pop();
    if (++work > LEGACY_ARCHIVE_LIMITS.work || current.depth > LEGACY_ARCHIVE_LIMITS.depth) fail('payload_complexity');
    if (typeof current.value === 'string') {
      if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----/.test(current.value)
        || /(?:Authorization\s*:\s*Bearer\s+|\bsk-[A-Za-z0-9_-]{20,})/i.test(current.value)
        || /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(current.value)
        || /https:\/\/(?:web-production-08455\.up\.railway\.app|systems-mapping\.ailab-452\.workers\.dev)\/p\/[A-Za-z0-9_-]{20,64}(?:[/?#\s]|$)/.test(current.value)) fail('credential_content');
    } else if (current.value && typeof current.value === 'object') {
      for (const [key, child] of Object.entries(current.value)) {
        const normalized = normalizeKey(key);
        if (['__proto__', 'prototype', 'constructor'].includes(key) || FORBIDDEN_KEYS.has(normalized)) fail('credential_fields');
        if (CAPABILITY_KEYS.has(normalized) && !['[redacted]', '[unavailable]'].includes(child)) fail('capability_fields');
        stack.push({ value: child, depth: current.depth + 1 });
      }
    } else if (typeof current.value === 'number' && !Number.isFinite(current.value)) fail('invalid_number');
  }
}

function parseUnambiguousJson(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('invalid_payload_json'); }
  // JSON.parse discards duplicate keys. Check the encoded input too so a
  // redaction marker cannot conceal an earlier credential-bearing value.
  const stack = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') index += 2;
        else if (text[index] === '"') break;
        else index += 1;
      }
      const parent = stack.at(-1);
      if (parent?.type === 'object' && parent.expectKey) {
        const key = JSON.parse(text.slice(start, index + 1));
        if (parent.keys.has(key)) fail('duplicate_json_key');
        parent.keys.add(key);
        parent.expectKey = false;
      }
    } else if (character === '{' || character === '[') {
      stack.push(character === '{' ? { type: 'object', keys: new Set(), expectKey: true } : { type: 'array' });
      if (stack.length > LEGACY_ARCHIVE_LIMITS.depth) fail('payload_complexity');
    } else if (character === '}' || character === ']') stack.pop();
    else if (character === ',' && stack.at(-1)?.type === 'object') stack.at(-1).expectKey = true;
  }
  return parsed;
}

function sourceIdentity(source) {
  exactKeys(source, ['origin', 'snapshotId']);
  if (source.origin !== LEGACY_ARCHIVE_ORIGIN || typeof source.snapshotId !== 'string' || !HASH.test(source.snapshotId)) fail('invalid_source');
  return { datasetId: hash(source.origin), snapshotId: source.snapshotId, origin: source.origin };
}

export function legacySourceId(table, originalKey) {
  if (!Object.hasOwn(TABLE_COLUMNS, table) || !['string', 'number'].includes(typeof originalKey)
    || !String(originalKey).length || String(originalKey).length > 256
    || typeof originalKey === 'number' && !Number.isSafeInteger(originalKey)) fail('invalid_source_key');
  // The source key can be an old bearer capability hash or review capability.
  // Hash it again with a table-specific domain; never retain it as a new token.
  return hash(`systems-mapping-legacy-source-v1\n${table}\n${originalKey}`);
}

function redactProjectCapabilities(value) {
  const stack = [value];
  let work = 0;
  while (stack.length) {
    const item = stack.pop();
    if (++work > LEGACY_ARCHIVE_LIMITS.work) fail('payload_complexity');
    if (!item || typeof item !== 'object') continue;
    for (const [key, child] of Object.entries(item)) {
      if (CAPABILITY_KEYS.has(normalizeKey(key))) item[key] = '[redacted]';
      else if (child && typeof child === 'object') stack.push(child);
    }
  }
  return value;
}

function validatePayload(table, payload) {
  const columns = TABLE_COLUMNS[table];
  if (!columns) fail('table_not_allowed');
  exactKeys(payload, columns);
  scanSafeJson(payload);
  for (const [key, value] of Object.entries(payload)) {
    if (value === null && !NULLABLE_COLUMNS[table].includes(key)) fail('invalid_null_column');
    if (key.endsWith('_json')) {
      if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value))) fail('invalid_json_column');
      if (value === null && !['source_record_json', 'runtime_metadata_json'].includes(key)) fail('invalid_json_column');
    } else if (INTEGER_COLUMNS.has(key) && !['accounts', 'teaching_profiles', 'prompt_modules'].includes(table)) {
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) fail('invalid_integer_column');
    } else if (INTEGER_COLUMNS.has(key) && !['created_at', 'updated_at'].includes(key)) {
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) fail('invalid_integer_column');
    } else if (value !== null && typeof value !== 'string') fail('invalid_text_column');
    if (typeof value === 'string' && bytes(value) > LEGACY_ARCHIVE_LIMITS.payloadBytes) fail('payload_too_large');
  }
  if (Object.hasOwn(payload, 'revision') && (!Number.isSafeInteger(payload.revision) || payload.revision < 1)) fail('invalid_revision');
  if (Object.hasOwn(payload, 'fingerprint') && !HASH.test(payload.fingerprint)) fail('invalid_fingerprint');
  if (Object.hasOwn(payload, 'submission_ref') && !HASH.test(payload.submission_ref)) fail('invalid_source_key');
  if (Object.hasOwn(payload, 'submission_ref_hash') && !HASH.test(payload.submission_ref_hash)) fail('invalid_source_key');
  const statuses = table === 'teaching_profiles' ? ['draft', 'active', 'retired'] : ['pending', 'approved', 'rejected'];
  if (Object.hasOwn(payload, 'status') && !statuses.includes(payload.status)) fail('invalid_status');
  if (Object.hasOwn(payload, 'decision') && payload.decision !== null && !['approve', 'revise_and_approve', 'reject'].includes(payload.decision)) fail('invalid_decision');
  if (Object.hasOwn(payload, 'active_scale') && !['micro', 'meso', 'exosphere', 'macrosphere', 'macro', 'integration'].includes(payload.active_scale)) fail('invalid_scale');
  if (Object.hasOwn(payload, 'action') && !['created', 'updated', 'published', 'retired'].includes(payload.action)) fail('invalid_action');
  if (Object.hasOwn(payload, 'config_kind') && !['preflight', 'builder'].includes(payload.config_kind)) fail('invalid_config_kind');
  if (Object.hasOwn(payload, 'module_key') && !['purpose', 'evidence', 'privacy', 'scale_rubric', 'interaction', 'output'].includes(payload.module_key)) fail('invalid_module_key');
  if (Object.hasOwn(payload, 'scale') && !['global', 'micro', 'meso', 'exosphere', 'macrosphere', 'macro', 'integration'].includes(payload.scale)) fail('invalid_scale');
  if (Object.hasOwn(payload, 'from_revision') && (!Number.isSafeInteger(payload.from_revision) || payload.from_revision < 1 || payload.to_revision !== payload.from_revision + 1)) fail('invalid_revision');
  if (['saved_projects', 'preflight_submissions'].includes(table)) {
    if (!Number.isSafeInteger(payload.created_at) || !Number.isSafeInteger(payload.updated_at) || payload.updated_at < payload.created_at) fail('invalid_time');
    if (payload.expires_at != null && payload.expires_at <= payload.created_at || payload.revoked_at != null && payload.revoked_at < payload.created_at
      || payload.reviewed_at != null && payload.reviewed_at < payload.created_at) fail('invalid_time');
  }
  if (['accounts', 'teaching_profiles', 'teaching_profile_events', 'prompt_modules', 'prompt_module_history'].includes(table)) {
    for (const key of ['created_at', 'updated_at', 'published_at', 'occurred_at', 'changed_at']) {
      if (Object.hasOwn(payload, key) && payload[key] !== null && (typeof payload[key] !== 'string' || !Number.isFinite(Date.parse(payload[key])))) fail('invalid_time');
    }
  }
  if (table === 'accounts' && (typeof payload.id !== 'string' || !payload.id.trim() || payload.id.length > 200
    || typeof payload.display_name !== 'string' || !payload.display_name.trim() || payload.display_name.length > 160)) fail('invalid_attribution');
  if (table === 'saved_projects' && (typeof payload.project_id !== 'string' || !payload.project_id.length || payload.project_id.length > 200)) fail('invalid_source_key');
  if (table === 'preflight_submissions') {
    const pending = payload.status === 'pending';
    if (pending && [payload.decision, payload.reviewed_at, payload.reviewing_teacher_id, payload.instructor_annotation, payload.revised_suggestion].some(value => value !== null)
      || !pending && (payload.reviewed_at === null || !payload.reviewing_teacher_id || !payload.instructor_annotation
        || payload.status === 'approved' && !['approve', 'revise_and_approve'].includes(payload.decision)
        || payload.status === 'rejected' && payload.decision !== 'reject')
      || payload.decision === 'revise_and_approve' && !payload.revised_suggestion
      || payload.decision !== 'revise_and_approve' && payload.revised_suggestion !== null) fail('invalid_decision_state');
  }
  if (table === 'preflight_review_events' && (!payload.reviewing_teacher_id || !payload.instructor_annotation
    || payload.decision === 'revise_and_approve' && !payload.revised_suggestion
    || payload.decision !== 'revise_and_approve' && payload.revised_suggestion !== null)) fail('invalid_decision_state');
}

/** Explicit export projection; raw authentication tables are never supported. */
export function sanitizeLegacySourceRow(table, row) {
  const columns = TABLE_COLUMNS[table];
  if (!columns) fail('table_not_allowed');
  const optional = columns.filter(key => OPTIONAL_COLUMNS.has(key));
  exactKeys(row, columns.filter(key => !optional.includes(key) && key !== 'submission_ref'), [...optional, ...(RAW_ONLY_COLUMNS[table] ?? [])]);
  const rawId = table === 'saved_projects' ? row.token_hash : row.id;
  if (rawId === undefined) fail('invalid_source_key');
  const payload = {};
  for (const key of columns) {
    let value = row[key];
    if (key === 'submission_ref') value = legacySourceId('preflight_submissions', row.submission_id);
    if (value === undefined) {
      if (key === 'revision') value = 1;
      else if (optional.includes(key)) value = null;
      else fail('missing_source_column');
    }
    if (key.endsWith('_json') && value !== null) {
      try { value = parseUnambiguousJson(typeof value === 'string' ? value : JSON.stringify(value)); }
      catch { fail('invalid_json_column'); }
      value = redactProjectCapabilities(value);
    } else if (value instanceof Date) value = value.toISOString();
    else if (INTEGER_COLUMNS.has(key) && value !== null && /^\d+$/.test(String(value))) value = Number(value);
    payload[key] = value;
  }
  validatePayload(table, payload);
  const payloadJson = JSON.stringify(payload);
  if (bytes(payloadJson) > LEGACY_ARCHIVE_LIMITS.payloadBytes) fail('payload_too_large');
  return { table, sourceId: legacySourceId(table, rawId), payloadJson };
}

function validateRecord(record) {
  exactKeys(record, ['table', 'sourceId', 'payloadJson']);
  if (!Object.hasOwn(TABLE_COLUMNS, record.table)) fail('table_not_allowed');
  if (typeof record.sourceId !== 'string' || !HASH.test(record.sourceId)) fail('invalid_source_key');
  if (typeof record.payloadJson !== 'string' || bytes(record.payloadJson) > LEGACY_ARCHIVE_LIMITS.payloadBytes) fail('payload_too_large');
  const payload = parseUnambiguousJson(record.payloadJson);
  validatePayload(record.table, payload);
  return { ...record, payloadHash: hash(record.payloadJson) };
}

const manifestChecksum = records => hash(JSON.stringify(records.map(record => [record.table, record.sourceId, record.payloadHash])
  .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))));

/** Build a bounded transport object from already projected rows. */
export function prepareLegacyArchiveBatch({ source, batchId, records }) {
  sourceIdentity(source);
  if (typeof batchId !== 'string' || !BATCH_ID.test(batchId) || !Array.isArray(records) || records.length < 1 || records.length > LEGACY_ARCHIVE_LIMITS.records) fail('invalid_batch');
  const validated = records.map(validateRecord);
  if (new Set(validated.map(record => `${record.table}:${record.sourceId}`)).size !== records.length) fail('duplicate_record');
  const batch = { schemaVersion: 1, source, batchId, records, checksum: manifestChecksum(validated) };
  if (bytes(JSON.stringify(batch)) > LEGACY_ARCHIVE_LIMITS.batchBytes) fail('batch_too_large');
  return batch;
}

export function initializeLegacyArchive(db) {
  if (db.dialect === 'postgres') fail('sqlite_required');
  db.exec(`
    CREATE TABLE IF NOT EXISTS legacy_archive_snapshots (
      dataset_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, source_origin TEXT NOT NULL,
      access_state TEXT NOT NULL DEFAULT 'unassigned' CHECK(access_state='unassigned'),
      created_at TEXT NOT NULL, PRIMARY KEY(dataset_id,snapshot_id)
    );
    CREATE TABLE IF NOT EXISTS legacy_archive_records (
      dataset_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, source_table TEXT NOT NULL,
      source_id TEXT NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
      PRIMARY KEY(dataset_id,snapshot_id,source_table,source_id),
      FOREIGN KEY(dataset_id,snapshot_id) REFERENCES legacy_archive_snapshots(dataset_id,snapshot_id)
    );
    CREATE TABLE IF NOT EXISTS legacy_archive_batches (
      dataset_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, batch_id TEXT NOT NULL,
      checksum TEXT NOT NULL, received_count INTEGER NOT NULL, inserted_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL, PRIMARY KEY(dataset_id,snapshot_id,batch_id),
      FOREIGN KEY(dataset_id,snapshot_id) REFERENCES legacy_archive_snapshots(dataset_id,snapshot_id)
    );
    CREATE TABLE IF NOT EXISTS legacy_archive_manifests (
      dataset_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, checksum TEXT NOT NULL,
      counts_json TEXT NOT NULL, sealed_at TEXT NOT NULL, PRIMARY KEY(dataset_id,snapshot_id),
      FOREIGN KEY(dataset_id,snapshot_id) REFERENCES legacy_archive_snapshots(dataset_id,snapshot_id)
    );
    CREATE TRIGGER IF NOT EXISTS legacy_archive_records_no_sealed_insert BEFORE INSERT ON legacy_archive_records
      WHEN EXISTS(SELECT 1 FROM legacy_archive_manifests WHERE dataset_id=NEW.dataset_id AND snapshot_id=NEW.snapshot_id)
      BEGIN SELECT RAISE(ABORT,'legacy archive snapshot is sealed'); END;
  `);
  for (const table of ['legacy_archive_snapshots', 'legacy_archive_records', 'legacy_archive_batches', 'legacy_archive_manifests']) {
    for (const action of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()}
      BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'legacy archive is immutable'); END;`);
  }
}

/** Internal storage primitive, not an authentication or course-access boundary. */
export async function importLegacyArchiveBatch(db, input, { now = () => new Date().toISOString() } = {}) {
  exactKeys(input, ['schemaVersion', 'source', 'batchId', 'records', 'checksum']);
  if (input.schemaVersion !== 1) fail('invalid_version');
  const batch = prepareLegacyArchiveBatch(input);
  if (input.checksum !== batch.checksum) fail('checksum_mismatch');
  const source = sourceIdentity(batch.source);
  const at = now();
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) fail('invalid_time');
  return inTransaction(db, () => {
    const prior = db.prepare('SELECT checksum,received_count AS receivedCount,inserted_count AS insertedCount FROM legacy_archive_batches WHERE dataset_id=? AND snapshot_id=? AND batch_id=?')
      .get(source.datasetId, source.snapshotId, batch.batchId);
    if (prior) {
      if (prior.checksum !== batch.checksum) fail('batch_conflict');
      return { checksum: prior.checksum, receivedCount: prior.receivedCount, insertedCount: 0, replayed: true };
    }
    if (db.prepare('SELECT 1 AS sealed FROM legacy_archive_manifests WHERE dataset_id=? AND snapshot_id=?').get(source.datasetId, source.snapshotId)) fail('snapshot_sealed');
    db.prepare('INSERT OR IGNORE INTO legacy_archive_snapshots(dataset_id,snapshot_id,source_origin,created_at) VALUES (?,?,?,?)')
      .run(source.datasetId, source.snapshotId, source.origin, at);
    let insertedCount = 0;
    for (const raw of batch.records) {
      const record = validateRecord(raw);
      const priorRecord = db.prepare('SELECT payload_hash AS payloadHash,payload_json AS payloadJson FROM legacy_archive_records WHERE dataset_id=? AND snapshot_id=? AND source_table=? AND source_id=?')
        .get(source.datasetId, source.snapshotId, record.table, record.sourceId);
      if (priorRecord) {
        if (priorRecord.payloadHash !== record.payloadHash || priorRecord.payloadJson !== record.payloadJson) fail('record_conflict');
        continue;
      }
      db.prepare('INSERT INTO legacy_archive_records VALUES (?,?,?,?,?,?)').run(source.datasetId, source.snapshotId, record.table, record.sourceId, record.payloadJson, record.payloadHash);
      insertedCount += 1;
    }
    db.prepare('INSERT INTO legacy_archive_batches VALUES (?,?,?,?,?,?,?)').run(source.datasetId, source.snapshotId, batch.batchId, batch.checksum, batch.records.length, insertedCount, at);
    return { checksum: batch.checksum, receivedCount: batch.records.length, insertedCount, replayed: false };
  });
}

export function legacyArchiveSummary(db, source) {
  const { datasetId, snapshotId } = sourceIdentity(source);
  const records = db.prepare('SELECT source_table AS "table",source_id AS sourceId,payload_hash AS payloadHash FROM legacy_archive_records WHERE dataset_id=? AND snapshot_id=? ORDER BY source_table,source_id').all(datasetId, snapshotId);
  const counts = Object.fromEntries(LEGACY_ARCHIVE_TABLES.map(table => [table, 0]));
  for (const record of records) counts[record.table] += 1;
  return { counts, recordCount: records.length, checksum: manifestChecksum(records), accessState: 'unassigned',
    sealed: Boolean(db.prepare('SELECT 1 AS sealed FROM legacy_archive_manifests WHERE dataset_id=? AND snapshot_id=?').get(datasetId, snapshotId)) };
}

export async function sealLegacyArchiveSnapshot(db, { source, expectedCounts, expectedChecksum }, { now = () => new Date().toISOString() } = {}) {
  const { datasetId, snapshotId } = sourceIdentity(source);
  exactKeys(expectedCounts, LEGACY_ARCHIVE_TABLES);
  if (Object.values(expectedCounts).some(count => !Number.isSafeInteger(count) || count < 0) || !HASH.test(expectedChecksum)) fail('invalid_manifest');
  const at = now();
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) fail('invalid_time');
  return inTransaction(db, () => {
    if (!db.prepare('SELECT 1 AS found FROM legacy_archive_snapshots WHERE dataset_id=? AND snapshot_id=?').get(datasetId, snapshotId)) fail('snapshot_not_found');
    const summary = legacyArchiveSummary(db, source);
    if (summary.checksum !== expectedChecksum || LEGACY_ARCHIVE_TABLES.some(table => summary.counts[table] !== expectedCounts[table])) fail('manifest_mismatch');
    db.prepare('INSERT OR IGNORE INTO legacy_archive_manifests VALUES (?,?,?,?,?)').run(datasetId, snapshotId, expectedChecksum, JSON.stringify(summary.counts), at);
    return { ...summary, sealed: true };
  });
}
