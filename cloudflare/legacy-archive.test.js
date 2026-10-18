// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LEGACY_ARCHIVE_ORIGIN, LEGACY_ARCHIVE_LIMITS, LEGACY_ARCHIVE_TABLES,
  initializeLegacyArchive, importLegacyArchiveBatch, legacyArchiveSummary,
  legacySourceId, prepareLegacyArchiveBatch, sanitizeLegacySourceRow, sealLegacyArchiveSnapshot,
} from './legacy-archive.js';

const source = { origin: LEGACY_ARCHIVE_ORIGIN, snapshotId: 'a'.repeat(64) };
const at = '2026-10-03T17:00:00.000Z';
const account = (id = 'zach-muhlbauer') => ({ id, display_name: id === 'zach-muhlbauer' ? 'Zach Muhlbauer' : 'Maria Mavrides Calderon', created_at: at,
  passphrase_hash: Buffer.from('do-not-migrate-password-hash'), passphrase_salt: Buffer.from('do-not-migrate-password-salt'), claimed_at: at });
const profile = () => ({ id: 'systems-mapping-default', name: 'Railway course settings', status: 'active', revision: 2,
  profile_json: { parts: { first: { guidance: 'Compare the evidence' } } }, fingerprint: 'b'.repeat(64), parent_id: null,
  created_at: at, created_by: 'maria-mavrides-calderon', updated_at: at, updated_by: 'zach-muhlbauer', published_at: at, published_by: 'maria-mavrides-calderon' });
const saved = () => ({ token_hash: 'c'.repeat(64), project_id: 'rosa-map', project_json: JSON.stringify({ schemaVersion: 7, id: 'rosa-map', title: 'Rosa map',
  submission: { text: 'Rosa asks Denise for help' }, graph: { nodes: [{ id: 'rosa', label: 'Rosa' }], edges: [] },
  preflight: { evaluation: { evaluationId: 'e'.repeat(32), runtime: { provider: 'ollama-cloud' } } } }),
  created_session_ref: 'd'.repeat(16), created_at: 100, updated_at: 300, revision: 4, expires_at: null, revoked_at: 300 });
const submission = () => ({ id: 'e'.repeat(32), student_session_ref: 'f'.repeat(16), project_metadata_json: { projectId: 'rosa-map' }, active_scale: 'micro',
  inquiry: 'What supports Rosa?', source_material: 'Rosa asks Denise for help', source_record_json: null, student_annotation: '',
  suggestion_json: { guidance: [], nodes: [], connections: [], example: '', readiness: '' }, config_snapshot_json: { revision: 2 }, runtime_metadata_json: null,
  status: 'approved', decision: 'approve', revision: 2, created_at: 100, updated_at: 200, reviewed_at: 200,
  reviewing_teacher_id: 'maria-mavrides-calderon', instructor_annotation: 'Identify supporting evidence', revised_suggestion: null });
const rows = () => [
  ['accounts', account()], ['accounts', account('maria-mavrides-calderon')], ['teaching_profiles', profile()],
  ['teaching_profile_events', { id: 11, profile_id: 'systems-mapping-default', action: 'published', revision: 2, profile_json: profile().profile_json,
    fingerprint: 'b'.repeat(64), note: 'Course settings revised', actor_id: 'maria-mavrides-calderon', occurred_at: at }],
  ['preflight_submissions', submission()],
  ['preflight_review_events', { id: 12, submission_id: 'e'.repeat(32), decision: 'approve', from_revision: 1, to_revision: 2,
    instructor_annotation: 'Identify supporting evidence', revised_suggestion: null, decided_at: 200, reviewing_teacher_id: 'maria-mavrides-calderon' }],
  ['saved_projects', saved()],
  ['prompt_modules', { id: 'preflight.micro.purpose', config_kind: 'preflight', scale: 'micro', module_key: 'purpose', label: 'Purpose', description: 'Code-owned rules',
    content: 'Keep evidence distinct from interpretation', revision: 1, fingerprint: 'b'.repeat(64), updated_at: at, updated_by: null }],
  ['prompt_module_history', { id: 13, module_id: 'preflight.micro.purpose', revision: 1, content: 'Keep evidence distinct from interpretation',
    fingerprint: 'b'.repeat(64), change_note: 'Starting configuration', changed_at: at, changed_by: 'zach-muhlbauer' }],
  ['preflight_retention_purges', { id: 14, submission_ref_hash: 'f'.repeat(64), status: 'approved', decision: 'approve', purged_at: 400, purged_by: 'retention' }],
];
const prepare = (records, batchId = 'batch-1', sourceValue = source) => prepareLegacyArchiveBatch({ source: sourceValue, batchId, records });
const errorCode = code => ({ code });

describe('offline immutable legacy archive', () => {
  let db;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    initializeLegacyArchive(db);
  });
  afterEach(() => db.close());

  it('projects supported source tables without moving authentication or bearer capabilities', async () => {
    const records = rows().map(([table, row]) => sanitizeLegacySourceRow(table, row));
    const batch = prepare(records);
    const receipt = await importLegacyArchiveBatch(db, batch);
    expect(receipt).toEqual({ checksum: batch.checksum, receivedCount: 10, insertedCount: 10, replayed: false });
    const transported = JSON.stringify(batch);
    for (const forbidden of ['passphrase_hash', 'passphrase_salt', 'claimed_at', 'student_session_ref', 'created_session_ref', 'token_hash', 'e'.repeat(32), 'do-not-migrate']) expect(transported).not.toContain(forbidden);
    const archivedSubmission = JSON.parse(records.find(record => record.table === 'preflight_submissions').payloadJson);
    expect(archivedSubmission.reviewing_teacher_id).toBe('maria-mavrides-calderon');
    const archivedReview = JSON.parse(records.find(record => record.table === 'preflight_review_events').payloadJson);
    expect(archivedReview.submission_ref).toBe(legacySourceId('preflight_submissions', submission().id));
    expect(JSON.parse(records.find(record => record.table === 'saved_projects').payloadJson).project_json.preflight.evaluation.evaluationId).toBe('[redacted]');
    expect(legacyArchiveSummary(db, source)).toMatchObject({ recordCount: 10, counts: { accounts: 2, saved_projects: 1 }, accessState: 'unassigned', sealed: false });
  });

  it('stores exact sanitized payload bytes and their checksum without rewriting graph content', async () => {
    const record = sanitizeLegacySourceRow('saved_projects', saved());
    const payload = JSON.parse(record.payloadJson);
    payload.project_json.graph.nodes.push({ id: 'old-clause', label: 'Rosa could not attend because the van was late' });
    record.payloadJson = JSON.stringify(payload, null, 2);
    await importLegacyArchiveBatch(db, prepare([record]));
    const stored = db.prepare('SELECT payload_json,payload_hash FROM legacy_archive_records').get();
    expect(stored.payload_json).toBe(record.payloadJson);
    expect(stored.payload_hash).toBe(createHash('sha256').update(record.payloadJson).digest('hex'));
    expect(stored.payload_json).toContain('Rosa could not attend because the van was late');
  });

  it('leaves existing private maps and active Worker configuration untouched', async () => {
    db.exec("CREATE TABLE cloud_projects(owner TEXT,id TEXT,project TEXT); INSERT INTO cloud_projects VALUES('private-owner','rosa-map','private account map'); CREATE TABLE teaching_profiles(id TEXT,status TEXT,profile_json TEXT); INSERT INTO teaching_profiles VALUES('systems-mapping-default','active','worker configuration');");
    await importLegacyArchiveBatch(db, prepare([sanitizeLegacySourceRow('teaching_profiles', profile()), sanitizeLegacySourceRow('saved_projects', saved())]));
    expect(db.prepare('SELECT * FROM cloud_projects').all()).toEqual([{ owner: 'private-owner', id: 'rosa-map', project: 'private account map' }]);
    expect(db.prepare('SELECT * FROM teaching_profiles').all()).toEqual([{ id: 'systems-mapping-default', status: 'active', profile_json: 'worker configuration' }]);
    expect(db.prepare('SELECT access_state FROM legacy_archive_snapshots').get().access_state).toBe('unassigned');
  });

  it('replays identical batches and deduplicates identical records in later batches', async () => {
    const record = sanitizeLegacySourceRow('accounts', account());
    const batch = prepare([record]);
    await importLegacyArchiveBatch(db, batch);
    expect(await importLegacyArchiveBatch(db, batch)).toMatchObject({ insertedCount: 0, replayed: true });
    expect(await importLegacyArchiveBatch(db, prepare([record], 'batch-2'))).toMatchObject({ insertedCount: 0, replayed: false });
    expect(legacyArchiveSummary(db, source).recordCount).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM legacy_archive_batches').get().n).toBe(2);
  });

  it('rejects changed batch content without overwriting its receipt', async () => {
    const record = sanitizeLegacySourceRow('accounts', account());
    await importLegacyArchiveBatch(db, prepare([record]));
    const changed = sanitizeLegacySourceRow('accounts', { ...account(), display_name: 'Changed author label' });
    await expect(importLegacyArchiveBatch(db, prepare([changed]))).rejects.toMatchObject(errorCode('batch_conflict'));
    expect(JSON.parse(db.prepare('SELECT payload_json FROM legacy_archive_records').get().payload_json).display_name).toBe('Zach Muhlbauer');
  });

  it('rolls back all inserts in a batch when any source record conflicts', async () => {
    const record = sanitizeLegacySourceRow('accounts', account());
    await importLegacyArchiveBatch(db, prepare([record]));
    const changed = sanitizeLegacySourceRow('accounts', { ...account(), display_name: 'Changed author label' });
    await expect(importLegacyArchiveBatch(db, prepare([sanitizeLegacySourceRow('teaching_profiles', profile()), changed], 'batch-2'))).rejects.toMatchObject(errorCode('record_conflict'));
    expect(legacyArchiveSummary(db, source).counts.teaching_profiles).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM legacy_archive_batches').get().n).toBe(1);
    expect(legacyArchiveSummary(db, source).recordCount).toBe(1);
  });

  it('preserves differing versions in separate snapshots rather than updating old records', async () => {
    await importLegacyArchiveBatch(db, prepare([sanitizeLegacySourceRow('accounts', account())]));
    const nextSource = { ...source, snapshotId: 'b'.repeat(64) };
    await importLegacyArchiveBatch(db, prepare([sanitizeLegacySourceRow('accounts', { ...account(), display_name: 'Updated author label' })], 'batch-1', nextSource));
    expect(legacyArchiveSummary(db, source).recordCount).toBe(1);
    expect(legacyArchiveSummary(db, nextSource).recordCount).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM legacy_archive_records').get().n).toBe(2);
  });

  it('retains revoked and legacy no-expiry metadata without activating project links', async () => {
    const record = sanitizeLegacySourceRow('saved_projects', saved());
    await importLegacyArchiveBatch(db, prepare([record]));
    const payload = JSON.parse(db.prepare('SELECT payload_json FROM legacy_archive_records').get().payload_json);
    expect(payload).toMatchObject({ revision: 4, expires_at: null, revoked_at: 300 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_projects'").get()).toBeUndefined();
  });

  it('normalizes PostgreSQL Date/BIGINT values and preserves both instructors as source attribution', () => {
    const record = sanitizeLegacySourceRow('teaching_profiles', { ...profile(), revision: '2', created_at: new Date(at), updated_at: new Date(at) });
    expect(JSON.parse(record.payloadJson)).toMatchObject({ revision: 2, created_at: at, created_by: 'maria-mavrides-calderon', updated_by: 'zach-muhlbauer' });
  });

  it('accepts known legacy optional source columns without inventing expiry or ownership', () => {
    const raw = saved();
    delete raw.revision; delete raw.expires_at; delete raw.revoked_at;
    expect(JSON.parse(sanitizeLegacySourceRow('saved_projects', raw).payloadJson)).toMatchObject({ revision: 1, expires_at: null, revoked_at: null });
  });

  it.each(['sessions', 'student_sessions', 'teacher_password_resets', 'teacher_bootstrap_uses', 'preflight_evaluations', 'cloud_projects'])('rejects unsupported or authentication table %s', table => {
    expect(() => sanitizeLegacySourceRow(table, { id: 'private-value' })).toThrowError('table_not_allowed');
    expect(() => prepare([{ table, sourceId: 'a'.repeat(64), payloadJson: '{}' }])).toThrowError('table_not_allowed');
  });

  it.each(['passphrase_hash', 'passphrase_salt', 'password', 'apiKey', 'authorization', 'cookie', 'sessionToken', 'token_hash', 'student_session_ref', 'created_session_ref', 'gatewayJwt'])('rejects credential field %s in imported payloads', key => {
    const record = sanitizeLegacySourceRow('saved_projects', saved());
    const payload = JSON.parse(record.payloadJson);
    payload.project_json[key] = 'should-not-enter-archive';
    record.payloadJson = JSON.stringify(payload);
    expect(() => prepare([record])).toThrowError('credential_fields');
  });

  it.each([
    'Authorization: Bearer this-is-a-private-token',
    '-----BEGIN PRIVATE KEY-----',
    'sk-this-is-an-api-key-at-least-twenty-characters',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.c2lnbmF0dXJl',
    `${LEGACY_ARCHIVE_ORIGIN}/p/${'x'.repeat(32)}`,
  ])('rejects credential-bearing string content', value => {
    const record = sanitizeLegacySourceRow('saved_projects', saved());
    const payload = JSON.parse(record.payloadJson);
    payload.project_json.memo = value;
    record.payloadJson = JSON.stringify(payload);
    expect(() => prepare([record])).toThrowError('credential_content');
  });

  it('rejects raw evaluation capabilities and rejects duplicate keys hiding an earlier capability', () => {
    const record = sanitizeLegacySourceRow('saved_projects', saved());
    record.payloadJson = record.payloadJson.replace('"evaluationId":"[redacted]"', `"evaluationId":"${'e'.repeat(32)}"`);
    expect(() => prepare([record])).toThrowError('capability_fields');
    record.payloadJson = record.payloadJson.replace(`"evaluationId":"${'e'.repeat(32)}"`, `"evaluationId":"${'e'.repeat(32)}","evaluation\\u0049d":"[redacted]"`);
    expect(() => prepare([record])).toThrowError('duplicate_json_key');
  });

  it('rejects ambiguous encoded JSON in source export instead of silently selecting a duplicate value', () => {
    expect(() => sanitizeLegacySourceRow('saved_projects', { ...saved(), project_json: '{"id":"first","id":"second"}' })).toThrowError('invalid_json_column');
  });

  it('rejects extra source fields rather than silently dropping newly added sensitive columns', () => {
    expect(() => sanitizeLegacySourceRow('accounts', { ...account(), email: 'never-transport@example.test' })).toThrowError('invalid_fields');
  });

  it('rejects unknown payload columns, incorrect source origins, duplicate records, and bad hashes', () => {
    const record = sanitizeLegacySourceRow('accounts', account());
    expect(() => prepare([{ ...record, payloadJson: JSON.stringify({ ...JSON.parse(record.payloadJson), role: 'instructor' }) }])).toThrowError('invalid_fields');
    expect(() => prepare([record], 'batch-1', { ...source, origin: 'https://other.example.test' })).toThrowError('invalid_source');
    expect(() => prepare([record, record])).toThrowError('duplicate_record');
    expect(() => prepare([{ ...record, sourceId: 'original-token' }])).toThrowError('invalid_source_key');
  });

  it('rejects tampered checksums, future envelope fields, versions, and invalid metadata', async () => {
    const batch = prepare([sanitizeLegacySourceRow('accounts', account())]);
    await expect(importLegacyArchiveBatch(db, { ...batch, checksum: 'b'.repeat(64) })).rejects.toMatchObject(errorCode('checksum_mismatch'));
    await expect(importLegacyArchiveBatch(db, { ...batch, courseId: 'not-an-authorization-grant' })).rejects.toMatchObject(errorCode('invalid_fields'));
    await expect(importLegacyArchiveBatch(db, { ...batch, schemaVersion: 2 })).rejects.toMatchObject(errorCode('invalid_version'));
    await expect(importLegacyArchiveBatch(db, batch, { now: () => 'not-a-date' })).rejects.toMatchObject(errorCode('invalid_time'));
    expect(legacyArchiveSummary(db, source).recordCount).toBe(0);
  });

  it('bounds record count, encoded record/batch sizes, and nesting', () => {
    const record = sanitizeLegacySourceRow('accounts', account());
    expect(() => prepare(Array.from({ length: LEGACY_ARCHIVE_LIMITS.records + 1 }, () => record))).toThrowError('invalid_batch');
    expect(() => prepare([{ ...record, payloadJson: 'x'.repeat(LEGACY_ARCHIVE_LIMITS.payloadBytes + 1) }])).toThrowError('payload_too_large');
    const large = saved();
    large.project_json = JSON.stringify({ id: 'rosa-map', memo: 'x'.repeat(1_100_000) });
    const first = sanitizeLegacySourceRow('saved_projects', large);
    const second = sanitizeLegacySourceRow('saved_projects', { ...large, token_hash: 'd'.repeat(64) });
    expect(() => prepare([first, second])).toThrowError('batch_too_large');
    const payload = JSON.parse(record.payloadJson);
    payload.project_json = Array.from({ length: 30 }).reduce(value => ({ nested: value }), {});
    const projectRecord = { ...sanitizeLegacySourceRow('saved_projects', saved()), payloadJson: JSON.stringify({ ...JSON.parse(sanitizeLegacySourceRow('saved_projects', saved()).payloadJson), project_json: payload.project_json }) };
    expect(() => prepare([projectRecord])).toThrowError('payload_complexity');
  });

  it('checks typed revisions, decision states, timing, and author metadata', () => {
    expect(() => sanitizeLegacySourceRow('teaching_profiles', { ...profile(), revision: 0 })).toThrowError('invalid_revision');
    expect(() => sanitizeLegacySourceRow('preflight_submissions', { ...submission(), status: 'pending' })).toThrowError('invalid_decision_state');
    expect(() => sanitizeLegacySourceRow('preflight_review_events', { ...rows().find(([table]) => table === 'preflight_review_events')[1], to_revision: 4 })).toThrowError('invalid_revision');
    expect(() => sanitizeLegacySourceRow('saved_projects', { ...saved(), expires_at: 50 })).toThrowError('invalid_time');
    expect(() => sanitizeLegacySourceRow('accounts', { ...account(), display_name: '' })).toThrowError('invalid_attribution');
    expect(() => sanitizeLegacySourceRow('accounts', { ...account(), created_at: null })).toThrowError('invalid_null_column');
    expect(() => sanitizeLegacySourceRow('teaching_profiles', { ...profile(), id: null })).toThrowError('invalid_null_column');
    expect(() => sanitizeLegacySourceRow('preflight_review_events', { ...rows().find(([table]) => table === 'preflight_review_events')[1], decision: 'revise_and_approve' })).toThrowError('invalid_decision_state');
  });

  it('redacts old submission capabilities inside JSON metadata without discarding source content', () => {
    const raw = submission();
    raw.project_metadata_json = { projectId: 'rosa-map', submissionId: 'e'.repeat(32), note: 'Preserve the student reflection' };
    const record = sanitizeLegacySourceRow('preflight_submissions', raw);
    expect(JSON.parse(record.payloadJson).project_metadata_json).toEqual({ projectId: 'rosa-map', submissionId: '[redacted]', note: 'Preserve the student reflection' });
  });

  it('verifies full counts and checksum before sealing and prevents further additions', async () => {
    const batch = prepare(rows().map(([table, row]) => sanitizeLegacySourceRow(table, row)));
    await importLegacyArchiveBatch(db, batch);
    const summary = legacyArchiveSummary(db, source);
    const different = { ...summary.counts, accounts: 3 };
    await expect(sealLegacyArchiveSnapshot(db, { source, expectedCounts: different, expectedChecksum: summary.checksum })).rejects.toMatchObject(errorCode('manifest_mismatch'));
    await expect(sealLegacyArchiveSnapshot(db, { source, expectedCounts: summary.counts, expectedChecksum: '0'.repeat(64) })).rejects.toMatchObject(errorCode('manifest_mismatch'));
    expect(legacyArchiveSummary(db, source).sealed).toBe(false);
    expect(await sealLegacyArchiveSnapshot(db, { source, expectedCounts: summary.counts, expectedChecksum: summary.checksum })).toEqual({ ...summary, sealed: true });
    expect(await sealLegacyArchiveSnapshot(db, { source, expectedCounts: summary.counts, expectedChecksum: summary.checksum })).toEqual({ ...summary, sealed: true });
    expect(await importLegacyArchiveBatch(db, batch)).toMatchObject({ replayed: true, insertedCount: 0 });
    await expect(importLegacyArchiveBatch(db, prepare([sanitizeLegacySourceRow('accounts', { ...account(), id: 'new-author' })], 'new-batch'))).rejects.toMatchObject(errorCode('snapshot_sealed'));
    expect(Object.keys(summary.counts)).toEqual(LEGACY_ARCHIVE_TABLES);
    expect(summary).not.toHaveProperty('records');
  });

  it('produces the same snapshot checksum across import order and batch boundaries', async () => {
    const records = rows().map(([table, row]) => sanitizeLegacySourceRow(table, row));
    await importLegacyArchiveBatch(db, prepare(records.slice(0, 4)));
    await importLegacyArchiveBatch(db, prepare(records.slice(4), 'batch-2'));
    const secondSource = { ...source, snapshotId: 'c'.repeat(64) };
    await importLegacyArchiveBatch(db, prepare([...records].reverse(), 'batch-all', secondSource));
    expect(legacyArchiveSummary(db, source).checksum).toBe(legacyArchiveSummary(db, secondSource).checksum);
    expect(legacyArchiveSummary(db, source).counts).toEqual(legacyArchiveSummary(db, secondSource).counts);
  });

  it('enforces immutability in SQL rather than relying only on the importer', async () => {
    await importLegacyArchiveBatch(db, prepare([sanitizeLegacySourceRow('accounts', account())]));
    const summary = legacyArchiveSummary(db, source);
    await sealLegacyArchiveSnapshot(db, { source, expectedCounts: summary.counts, expectedChecksum: summary.checksum });
    for (const table of ['legacy_archive_snapshots', 'legacy_archive_records', 'legacy_archive_batches', 'legacy_archive_manifests']) {
      expect(() => db.exec(`DELETE FROM ${table}`)).toThrowError('immutable');
      const column = table === 'legacy_archive_snapshots' ? 'access_state' : table === 'legacy_archive_records' ? 'payload_hash' : 'checksum';
      expect(() => db.exec(`UPDATE ${table} SET ${column}=${column}`)).toThrowError('immutable');
    }
    expect(() => db.prepare('INSERT INTO legacy_archive_records VALUES (?,?,?,?,?,?)').run(createHash('sha256').update(source.origin).digest('hex'), source.snapshotId, 'accounts', '0'.repeat(64), '{}', '0'.repeat(64))).toThrowError('sealed');
  });

  it('initializes idempotently and rejects applying the archive schema to PostgreSQL', () => {
    initializeLegacyArchive(db);
    expect(() => initializeLegacyArchive({ dialect: 'postgres' })).toThrowError('sqlite_required');
  });
});
