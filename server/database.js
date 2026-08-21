import { AsyncLocalStorage } from 'node:async_hooks';
import { chmodSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_TEACHING_PROFILE,
  LEGACY_DEFAULT_MODULE_FINGERPRINTS,
  moduleSeeds,
  teachingProfileFingerprint,
  upgradeSystemsMappingTeachingProfile,
} from './config.js';
import { openPostgresDatabase } from './postgres.js';

const require = createRequire(import.meta.url);

const ACCOUNT_SEEDS = [
  { id: 'zach-muhlbauer', displayName: 'Zach Muhlbauer' },
  { id: 'maria-mavrides-calderon', displayName: 'Maria Mavrides Calderon' },
];
const sqliteTransactionStates = new WeakMap();
const LEGACY_SCALE_IDS = Object.freeze({
  macro: 'exosphere',
  integration: 'macrosphere',
});
const SCALE_SCALAR_KEYS = new Set(['scale', 'activeScale']);
const SCALE_COLLECTION_KEYS = new Set(['scaleIds', 'releasedScales', 'completedScales']);
const LEGACY_PROMPT_MODULE_ID = /^(preflight|builder)\.(macro|integration)\.(purpose|evidence|privacy|scale_rubric|interaction|output)$/;

function migratePromptModuleId(value) {
  if (typeof value !== 'string' || !LEGACY_PROMPT_MODULE_ID.test(value)) return value;
  return value.replace('.macro.', '.exosphere.').replace('.integration.', '.macrosphere.');
}

function migrateScaleIds(value, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((item) => SCALE_COLLECTION_KEYS.has(parentKey) && typeof item === 'string'
      ? LEGACY_SCALE_IDS[item] ?? item
      : migrateScaleIds(item));
  }
  if (!value || typeof value !== 'object') {
    if (parentKey === 'id') return migratePromptModuleId(value);
    return SCALE_SCALAR_KEYS.has(parentKey) && typeof value === 'string'
      ? LEGACY_SCALE_IDS[value] ?? value
      : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateScaleIds(item, key)]));
}

function migrateScaleIdsJson(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  const original = JSON.stringify(parsed);
  const migrated = JSON.stringify(migrateScaleIds(parsed));
  return typeof value === 'string' && migrated === original ? value : migrated;
}

function sqliteTransactionState(db) {
  let state = sqliteTransactionStates.get(db);
  if (!state) {
    state = {
      active: false,
      queue: [],
      savepointCounter: 0,
      storage: new AsyncLocalStorage(),
    };
    sqliteTransactionStates.set(db, state);
  }
  return state;
}

function releaseSqliteTransaction(db, state) {
  state.active = false;
  const next = state.queue.shift();
  if (!next) return;
  let result;
  try {
    result = runSqliteTopLevelTransaction(db, state, next.callback);
  } catch (error) {
    next.reject(error);
    return;
  }
  Promise.resolve(result).then(next.resolve, next.reject);
}

function runSqliteTopLevelTransaction(db, state, callback) {
  db.exec('BEGIN IMMEDIATE');
  state.active = true;
  let result;
  try {
    result = state.storage.run({ db }, callback);
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } finally {
      releaseSqliteTransaction(db, state);
    }
    throw error;
  }
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).then((value) => {
      try {
        db.exec('COMMIT');
      } finally {
        releaseSqliteTransaction(db, state);
      }
      return value;
    }, (error) => {
      try {
        db.exec('ROLLBACK');
      } finally {
        releaseSqliteTransaction(db, state);
      }
      throw error;
    });
  }
  try {
    db.exec('COMMIT');
  } finally {
    releaseSqliteTransaction(db, state);
  }
  return result;
}

function runSqliteSavepoint(db, state, callback) {
  const savepoint = `systems_mapping_${state.savepointCounter += 1}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = callback();
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result).then((value) => {
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return value;
      }, (error) => {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      });
    }
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  }
}

export function openDatabase(dbPath = 'data/systems-mapping.sqlite') {
  const { DatabaseSync } = require('node:sqlite');
  const resolvedPath = dbPath === ':memory:' ? dbPath : resolve(dbPath);
  if (resolvedPath !== ':memory:') mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA secure_delete = ON');
  if (resolvedPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  migrate(db);
  seed(db);
  assertDatabaseIntegrity(db);
  if (resolvedPath !== ':memory:') protectDatabaseFiles(resolvedPath);
  db.dialect = 'sqlite';
  db.ready = Promise.resolve();
  db.healthCheck = () => db.prepare('SELECT 1 AS ok').get()?.ok === 1;
  return db;
}

export function openDataStore({ databaseUrl, dbPath, postgres = {} } = {}) {
  return databaseUrl
    ? openPostgresDatabase(databaseUrl, postgres)
    : openDatabase(dbPath);
}

function protectDatabaseFiles(resolvedPath) {
  chmodSync(dirname(resolvedPath), 0o700);
  for (const path of [resolvedPath, `${resolvedPath}-wal`, `${resolvedPath}-shm`]) {
    try {
      chmodSync(path, 0o600);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function migrate(db) {
  inTransaction(db, () => db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      passphrase_hash BLOB,
      passphrase_salt BLOB,
      claimed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS teacher_bootstrap_uses (
      token_hash TEXT PRIMARY KEY,
      used_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teacher_password_resets (
      token_hash TEXT PRIMARY KEY CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
      used_at INTEGER CHECK(used_at IS NULL OR used_at >= created_at)
    );

    CREATE INDEX IF NOT EXISTS teacher_password_resets_account_idx
      ON teacher_password_resets(account_id, expires_at);

    CREATE TABLE IF NOT EXISTS student_sessions (
      token_hash TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL CHECK(expires_at > created_at)
    );

    CREATE INDEX IF NOT EXISTS student_sessions_expiry_idx ON student_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS prompt_modules (
      id TEXT PRIMARY KEY,
      config_kind TEXT NOT NULL CHECK(config_kind IN ('preflight', 'builder')),
      scale TEXT NOT NULL CHECK(scale IN ('global', 'micro', 'meso', 'exosphere', 'macrosphere')),
      module_key TEXT NOT NULL CHECK(module_key IN ('purpose', 'evidence', 'privacy', 'scale_rubric', 'interaction', 'output')),
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      content TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      fingerprint TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT REFERENCES accounts(id),
      UNIQUE(config_kind, scale, module_key)
    );

    CREATE TABLE IF NOT EXISTS prompt_module_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id TEXT NOT NULL REFERENCES prompt_modules(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      content TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      change_note TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by TEXT REFERENCES accounts(id),
      UNIQUE(module_id, revision)
    );

    CREATE INDEX IF NOT EXISTS prompt_history_changed_idx ON prompt_module_history(changed_at DESC);

    CREATE TABLE IF NOT EXISTS teaching_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
      status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'retired')),
      revision INTEGER NOT NULL CHECK(revision >= 1),
      profile_json TEXT NOT NULL CHECK(
        length(profile_json) BETWEEN 2 AND 65536
        AND json_valid(profile_json) AND json_type(profile_json) = 'object'
      ),
      fingerprint TEXT NOT NULL CHECK(length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
      parent_id TEXT REFERENCES teaching_profiles(id),
      created_at TEXT NOT NULL,
      created_by TEXT REFERENCES accounts(id),
      updated_at TEXT NOT NULL,
      updated_by TEXT REFERENCES accounts(id),
      published_at TEXT,
      published_by TEXT REFERENCES accounts(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS teaching_profiles_one_active_idx
      ON teaching_profiles(status) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS teaching_profiles_updated_idx ON teaching_profiles(updated_at DESC);

    CREATE TABLE IF NOT EXISTS teaching_profile_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL REFERENCES teaching_profiles(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK(action IN ('created', 'updated', 'published', 'retired')),
      revision INTEGER NOT NULL CHECK(revision >= 1),
      profile_json TEXT NOT NULL CHECK(
        length(profile_json) BETWEEN 2 AND 65536
        AND json_valid(profile_json) AND json_type(profile_json) = 'object'
      ),
      fingerprint TEXT NOT NULL CHECK(length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
      note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 3 AND 500),
      actor_id TEXT REFERENCES accounts(id),
      occurred_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS teaching_profile_events_profile_idx
      ON teaching_profile_events(profile_id, id DESC);

    CREATE TRIGGER IF NOT EXISTS teaching_profile_events_no_update
    BEFORE UPDATE ON teaching_profile_events
    BEGIN
      SELECT RAISE(ABORT, 'teaching_profile_events are append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS teaching_profile_events_no_delete
    BEFORE DELETE ON teaching_profile_events
    BEGIN
      SELECT RAISE(ABORT, 'teaching_profile_events are append-only');
    END;

    CREATE TABLE IF NOT EXISTS prototype_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_kind TEXT NOT NULL CHECK(session_kind IN ('student', 'access_attempt')),
      session_ref TEXT NOT NULL CHECK(length(session_ref) = 16),
      event_name TEXT NOT NULL CHECK(event_name IN (
        'class_access_succeeded', 'class_access_failed',
        'project_started', 'project_resumed', 'stage_viewed', 'stage_completed',
        'node_moved', 'viewport_changed', 'annotation_saved',
        'project_exported', 'project_imported', 'recovery_exported'
      )),
      stage INTEGER CHECK(stage IS NULL OR (stage >= 0 AND stage <= 6)),
      metadata_json TEXT NOT NULL CHECK(length(metadata_json) <= 1024),
      recorded_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS prototype_events_recorded_idx ON prototype_events(recorded_at DESC);

    CREATE TABLE IF NOT EXISTS preflight_evaluations (
      id TEXT PRIMARY KEY CHECK(length(id) = 32),
      student_session_ref TEXT NOT NULL CHECK(length(student_session_ref) = 16),
      project_metadata_json TEXT NOT NULL
        CHECK(length(project_metadata_json) BETWEEN 2 AND 4096)
        CHECK(json_valid(project_metadata_json) AND json_type(project_metadata_json) = 'object'),
      active_scale TEXT NOT NULL CHECK(active_scale IN ('micro', 'meso', 'exosphere', 'macrosphere')),
      inquiry TEXT NOT NULL CHECK(length(inquiry) BETWEEN 1 AND 8000),
      source_record_json TEXT NOT NULL
        CHECK(length(source_record_json) BETWEEN 2 AND 16384)
        CHECK(json_valid(source_record_json) AND json_type(source_record_json) = 'object'),
      source_material TEXT NOT NULL CHECK(length(source_material) BETWEEN 1 AND 500000),
      project_overlay_json TEXT NOT NULL
        CHECK(length(project_overlay_json) BETWEEN 2 AND 65536)
        CHECK(json_valid(project_overlay_json) AND json_type(project_overlay_json) = 'object'),
      suggestion_json TEXT NOT NULL
        CHECK(length(suggestion_json) BETWEEN 2 AND 65536)
        CHECK(json_valid(suggestion_json) AND json_type(suggestion_json) = 'object'),
      config_snapshot_json TEXT NOT NULL
        CHECK(length(config_snapshot_json) BETWEEN 2 AND 65536)
        CHECK(json_valid(config_snapshot_json) AND json_type(config_snapshot_json) = 'object'),
      runtime_metadata_json TEXT NOT NULL
        CHECK(length(runtime_metadata_json) BETWEEN 2 AND 4096)
        CHECK(json_valid(runtime_metadata_json) AND json_type(runtime_metadata_json) = 'object'),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
      consumed_at INTEGER CHECK(consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS preflight_evaluations_expiry_idx
      ON preflight_evaluations(expires_at, id);
    CREATE INDEX IF NOT EXISTS preflight_evaluations_session_idx
      ON preflight_evaluations(student_session_ref, consumed_at, expires_at);

    CREATE TABLE IF NOT EXISTS preflight_submissions (
      id TEXT PRIMARY KEY CHECK(length(id) = 32),
      student_session_ref TEXT NOT NULL CHECK(length(student_session_ref) = 16),
      project_metadata_json TEXT NOT NULL
        CHECK(length(project_metadata_json) BETWEEN 2 AND 4096)
        CHECK(json_valid(project_metadata_json) AND json_type(project_metadata_json) = 'object'),
      active_scale TEXT NOT NULL CHECK(active_scale IN ('micro', 'meso', 'exosphere', 'macrosphere')),
      inquiry TEXT NOT NULL CHECK(length(inquiry) BETWEEN 1 AND 8000),
      source_material TEXT NOT NULL CHECK(length(source_material) BETWEEN 1 AND 500000),
      source_record_json TEXT
        CHECK(source_record_json IS NULL OR (
          length(source_record_json) BETWEEN 2 AND 16384
          AND json_valid(source_record_json) AND json_type(source_record_json) = 'object'
        )),
      student_annotation TEXT NOT NULL CHECK(length(student_annotation) <= 4000),
      suggestion_json TEXT NOT NULL
        CHECK(length(suggestion_json) BETWEEN 2 AND 65536)
        CHECK(json_valid(suggestion_json) AND json_type(suggestion_json) = 'object'),
      config_snapshot_json TEXT NOT NULL
        CHECK(length(config_snapshot_json) BETWEEN 2 AND 65536)
        CHECK(json_valid(config_snapshot_json) AND json_type(config_snapshot_json) = 'object'),
      runtime_metadata_json TEXT
        CHECK(runtime_metadata_json IS NULL OR (
          length(runtime_metadata_json) BETWEEN 2 AND 4096
          AND json_valid(runtime_metadata_json) AND json_type(runtime_metadata_json) = 'object'
        )),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      decision TEXT CHECK(decision IN ('approve', 'revise_and_approve', 'reject')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
      reviewed_at INTEGER CHECK(reviewed_at IS NULL OR reviewed_at >= created_at),
      reviewing_teacher_id TEXT REFERENCES accounts(id),
      instructor_annotation TEXT CHECK(instructor_annotation IS NULL OR length(instructor_annotation) BETWEEN 1 AND 8000),
      revised_suggestion TEXT
        CHECK(revised_suggestion IS NULL OR length(revised_suggestion) BETWEEN 1 AND 20000),
      CHECK(
        (status = 'pending' AND decision IS NULL AND reviewed_at IS NULL
          AND reviewing_teacher_id IS NULL AND instructor_annotation IS NULL
          AND revised_suggestion IS NULL)
        OR
        (status = 'approved' AND decision IN ('approve', 'revise_and_approve')
          AND reviewed_at IS NOT NULL AND reviewing_teacher_id IS NOT NULL
          AND instructor_annotation IS NOT NULL
          AND ((decision = 'approve' AND revised_suggestion IS NULL)
            OR (decision = 'revise_and_approve' AND revised_suggestion IS NOT NULL)))
        OR
        (status = 'rejected' AND decision = 'reject'
          AND reviewed_at IS NOT NULL AND reviewing_teacher_id IS NOT NULL
          AND instructor_annotation IS NOT NULL AND revised_suggestion IS NULL)
      )
    ) STRICT;

    CREATE INDEX IF NOT EXISTS preflight_submissions_student_idx
      ON preflight_submissions(student_session_ref, created_at DESC);
    CREATE INDEX IF NOT EXISTS preflight_submissions_queue_idx
      ON preflight_submissions(status, created_at, id);
    CREATE INDEX IF NOT EXISTS preflight_submissions_reviewer_idx
      ON preflight_submissions(reviewing_teacher_id);

    CREATE TABLE IF NOT EXISTS preflight_review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id TEXT NOT NULL REFERENCES preflight_submissions(id) ON DELETE RESTRICT,
      decision TEXT NOT NULL CHECK(decision IN ('approve', 'revise_and_approve', 'reject')),
      from_revision INTEGER NOT NULL CHECK(from_revision >= 1),
      to_revision INTEGER NOT NULL CHECK(to_revision = from_revision + 1),
      instructor_annotation TEXT NOT NULL CHECK(length(instructor_annotation) BETWEEN 1 AND 8000),
      revised_suggestion TEXT
        CHECK(revised_suggestion IS NULL OR length(revised_suggestion) BETWEEN 1 AND 20000),
      decided_at INTEGER NOT NULL,
      reviewing_teacher_id TEXT NOT NULL REFERENCES accounts(id),
      CHECK(
        (decision = 'revise_and_approve' AND revised_suggestion IS NOT NULL)
        OR (decision IN ('approve', 'reject') AND revised_suggestion IS NULL)
      ),
      UNIQUE(submission_id, to_revision)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS preflight_review_events_submission_idx
      ON preflight_review_events(submission_id, id);
    CREATE INDEX IF NOT EXISTS preflight_review_events_reviewer_idx
      ON preflight_review_events(reviewing_teacher_id);

    CREATE TABLE IF NOT EXISTS saved_projects (
      token_hash TEXT PRIMARY KEY
        CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
      project_id TEXT NOT NULL CHECK(length(project_id) BETWEEN 1 AND 200),
      project_json TEXT NOT NULL CHECK(
        length(project_json) BETWEEN 2 AND 2000000
        AND json_valid(project_json) AND json_type(project_json) = 'object'
      ),
      created_session_ref TEXT NOT NULL CHECK(length(created_session_ref) = 16),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS saved_projects_updated_idx ON saved_projects(updated_at DESC);

    CREATE TABLE IF NOT EXISTS preflight_retention_purge_guard (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      reason TEXT NOT NULL CHECK(reason = 'retention')
    ) STRICT;

    CREATE TABLE IF NOT EXISTS preflight_retention_purges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_ref_hash TEXT NOT NULL UNIQUE
        CHECK(length(submission_ref_hash) = 64)
        CHECK(submission_ref_hash NOT GLOB '*[^0-9a-f]*'),
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
      decision TEXT CHECK(decision IN ('approve', 'revise_and_approve', 'reject')),
      purged_at INTEGER NOT NULL,
      purged_by TEXT NOT NULL CHECK(purged_by = 'retention'),
      CHECK(
        (status = 'pending' AND decision IS NULL)
        OR (status = 'approved' AND decision IN ('approve', 'revise_and_approve'))
        OR (status = 'rejected' AND decision = 'reject')
      )
    ) STRICT;

    CREATE INDEX IF NOT EXISTS preflight_retention_purges_time_idx
      ON preflight_retention_purges(purged_at DESC);

    CREATE TRIGGER IF NOT EXISTS preflight_review_events_no_update
    BEFORE UPDATE ON preflight_review_events
    BEGIN
      SELECT RAISE(ABORT, 'preflight_review_events are append-only');
    END;

    DROP TRIGGER IF EXISTS preflight_review_events_no_delete;
    CREATE TRIGGER preflight_review_events_no_delete
    BEFORE DELETE ON preflight_review_events
    WHEN NOT EXISTS (
      SELECT 1 FROM preflight_retention_purge_guard
      WHERE singleton = 1 AND reason = 'retention'
    )
    BEGIN
      SELECT RAISE(ABORT, 'preflight_review_events are append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS preflight_submissions_no_delete
    BEFORE DELETE ON preflight_submissions
    WHEN NOT EXISTS (
      SELECT 1 FROM preflight_retention_purge_guard
      WHERE singleton = 1 AND reason = 'retention'
    )
    BEGIN
      SELECT RAISE(ABORT, 'preflight_submissions are retention-managed');
    END;

    CREATE TRIGGER IF NOT EXISTS preflight_retention_purges_no_update
    BEFORE UPDATE ON preflight_retention_purges
    BEGIN
      SELECT RAISE(ABORT, 'preflight_retention_purges are append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS preflight_retention_purges_no_delete
    BEFORE DELETE ON preflight_retention_purges
    BEGIN
      SELECT RAISE(ABORT, 'preflight_retention_purges are append-only');
    END;
  `));
  const submissionColumns = new Set(db.prepare('PRAGMA table_info(preflight_submissions)').all().map(({ name }) => name));
  if (!submissionColumns.has('source_record_json')) {
    db.exec(`
      ALTER TABLE preflight_submissions ADD COLUMN source_record_json TEXT
      CHECK(source_record_json IS NULL OR (
        length(source_record_json) BETWEEN 2 AND 16384
        AND json_valid(source_record_json) AND json_type(source_record_json) = 'object'
      ))
    `);
  }
  if (!submissionColumns.has('runtime_metadata_json')) {
    db.exec(`
      ALTER TABLE preflight_submissions ADD COLUMN runtime_metadata_json TEXT
      CHECK(runtime_metadata_json IS NULL OR (
        length(runtime_metadata_json) BETWEEN 2 AND 4096
        AND json_valid(runtime_metadata_json) AND json_type(runtime_metadata_json) = 'object'
      ))
    `);
  }
  migrateEcologicalScaleIds(db);
  upgradeStoredTeachingProfiles(db);
}

function migrateEcologicalScaleIds(db) {
  const constrainedTables = ['prompt_modules', 'preflight_evaluations', 'preflight_submissions'];
  const hasLegacyConstraints = constrainedTables.some((table) => {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    return /\b(?:macro|integration)\b/.test(row?.sql || '');
  });

  if (hasLegacyConstraints) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      inTransaction(db, () => db.exec(`
        DROP TABLE IF EXISTS prompt_modules_ecological_migration;
        DROP TABLE IF EXISTS prompt_module_history_ecological_migration;
        DROP TABLE IF EXISTS preflight_evaluations_ecological_migration;
        DROP TABLE IF EXISTS preflight_submissions_ecological_migration;

        CREATE TABLE prompt_modules_ecological_migration (
          id TEXT PRIMARY KEY,
          config_kind TEXT NOT NULL CHECK(config_kind IN ('preflight', 'builder')),
          scale TEXT NOT NULL CHECK(scale IN ('global', 'micro', 'meso', 'exosphere', 'macrosphere')),
          module_key TEXT NOT NULL CHECK(module_key IN ('purpose', 'evidence', 'privacy', 'scale_rubric', 'interaction', 'output')),
          label TEXT NOT NULL,
          description TEXT NOT NULL,
          content TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          fingerprint TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT REFERENCES accounts(id),
          UNIQUE(config_kind, scale, module_key)
        );

        CREATE TABLE prompt_module_history_ecological_migration (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          module_id TEXT NOT NULL REFERENCES prompt_modules_ecological_migration(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          content TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          change_note TEXT NOT NULL,
          changed_at TEXT NOT NULL,
          changed_by TEXT REFERENCES accounts(id),
          UNIQUE(module_id, revision)
        );

        INSERT INTO prompt_modules_ecological_migration (
          id, config_kind, scale, module_key, label, description, content,
          revision, fingerprint, updated_at, updated_by
        )
        SELECT
          CASE
            WHEN scale = 'macro' THEN replace(id, '.macro.', '.exosphere.')
            WHEN scale = 'integration' THEN replace(id, '.integration.', '.macrosphere.')
            ELSE id
          END,
          config_kind,
          CASE scale WHEN 'macro' THEN 'exosphere' WHEN 'integration' THEN 'macrosphere' ELSE scale END,
          module_key, label, description, content, revision, fingerprint, updated_at, updated_by
        FROM prompt_modules;

        INSERT INTO prompt_module_history_ecological_migration (
          id, module_id, revision, content, fingerprint, change_note, changed_at, changed_by
        )
        SELECT
          id,
          replace(replace(module_id, '.macro.', '.exosphere.'), '.integration.', '.macrosphere.'),
          revision, content, fingerprint, change_note, changed_at, changed_by
        FROM prompt_module_history;

        CREATE TABLE preflight_evaluations_ecological_migration (
          id TEXT PRIMARY KEY CHECK(length(id) = 32),
          student_session_ref TEXT NOT NULL CHECK(length(student_session_ref) = 16),
          project_metadata_json TEXT NOT NULL
            CHECK(length(project_metadata_json) BETWEEN 2 AND 4096)
            CHECK(json_valid(project_metadata_json) AND json_type(project_metadata_json) = 'object'),
          active_scale TEXT NOT NULL CHECK(active_scale IN ('micro', 'meso', 'exosphere', 'macrosphere')),
          inquiry TEXT NOT NULL CHECK(length(inquiry) BETWEEN 1 AND 8000),
          source_record_json TEXT NOT NULL
            CHECK(length(source_record_json) BETWEEN 2 AND 16384)
            CHECK(json_valid(source_record_json) AND json_type(source_record_json) = 'object'),
          source_material TEXT NOT NULL CHECK(length(source_material) BETWEEN 1 AND 500000),
          project_overlay_json TEXT NOT NULL
            CHECK(length(project_overlay_json) BETWEEN 2 AND 65536)
            CHECK(json_valid(project_overlay_json) AND json_type(project_overlay_json) = 'object'),
          suggestion_json TEXT NOT NULL
            CHECK(length(suggestion_json) BETWEEN 2 AND 65536)
            CHECK(json_valid(suggestion_json) AND json_type(suggestion_json) = 'object'),
          config_snapshot_json TEXT NOT NULL
            CHECK(length(config_snapshot_json) BETWEEN 2 AND 65536)
            CHECK(json_valid(config_snapshot_json) AND json_type(config_snapshot_json) = 'object'),
          runtime_metadata_json TEXT NOT NULL
            CHECK(length(runtime_metadata_json) BETWEEN 2 AND 4096)
            CHECK(json_valid(runtime_metadata_json) AND json_type(runtime_metadata_json) = 'object'),
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
          consumed_at INTEGER CHECK(consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at))
        ) STRICT;

        INSERT INTO preflight_evaluations_ecological_migration (
          id, student_session_ref, project_metadata_json, active_scale, inquiry,
          source_record_json, source_material, project_overlay_json, suggestion_json,
          config_snapshot_json, runtime_metadata_json, created_at, expires_at, consumed_at
        )
        SELECT
          id, student_session_ref, project_metadata_json,
          CASE active_scale WHEN 'macro' THEN 'exosphere' WHEN 'integration' THEN 'macrosphere' ELSE active_scale END,
          inquiry, source_record_json, source_material, project_overlay_json, suggestion_json,
          config_snapshot_json, runtime_metadata_json, created_at, expires_at, consumed_at
        FROM preflight_evaluations;

        CREATE TABLE preflight_submissions_ecological_migration (
          id TEXT PRIMARY KEY CHECK(length(id) = 32),
          student_session_ref TEXT NOT NULL CHECK(length(student_session_ref) = 16),
          project_metadata_json TEXT NOT NULL
            CHECK(length(project_metadata_json) BETWEEN 2 AND 4096)
            CHECK(json_valid(project_metadata_json) AND json_type(project_metadata_json) = 'object'),
          active_scale TEXT NOT NULL CHECK(active_scale IN ('micro', 'meso', 'exosphere', 'macrosphere')),
          inquiry TEXT NOT NULL CHECK(length(inquiry) BETWEEN 1 AND 8000),
          source_material TEXT NOT NULL CHECK(length(source_material) BETWEEN 1 AND 500000),
          source_record_json TEXT
            CHECK(source_record_json IS NULL OR (
              length(source_record_json) BETWEEN 2 AND 16384
              AND json_valid(source_record_json) AND json_type(source_record_json) = 'object'
            )),
          student_annotation TEXT NOT NULL CHECK(length(student_annotation) <= 4000),
          suggestion_json TEXT NOT NULL
            CHECK(length(suggestion_json) BETWEEN 2 AND 65536)
            CHECK(json_valid(suggestion_json) AND json_type(suggestion_json) = 'object'),
          config_snapshot_json TEXT NOT NULL
            CHECK(length(config_snapshot_json) BETWEEN 2 AND 65536)
            CHECK(json_valid(config_snapshot_json) AND json_type(config_snapshot_json) = 'object'),
          runtime_metadata_json TEXT
            CHECK(runtime_metadata_json IS NULL OR (
              length(runtime_metadata_json) BETWEEN 2 AND 4096
              AND json_valid(runtime_metadata_json) AND json_type(runtime_metadata_json) = 'object'
            )),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
          decision TEXT CHECK(decision IN ('approve', 'revise_and_approve', 'reject')),
          revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
          reviewed_at INTEGER CHECK(reviewed_at IS NULL OR reviewed_at >= created_at),
          reviewing_teacher_id TEXT REFERENCES accounts(id),
          instructor_annotation TEXT CHECK(instructor_annotation IS NULL OR length(instructor_annotation) BETWEEN 1 AND 8000),
          revised_suggestion TEXT
            CHECK(revised_suggestion IS NULL OR length(revised_suggestion) BETWEEN 1 AND 20000),
          CHECK(
            (status = 'pending' AND decision IS NULL AND reviewed_at IS NULL
              AND reviewing_teacher_id IS NULL AND instructor_annotation IS NULL
              AND revised_suggestion IS NULL)
            OR
            (status = 'approved' AND decision IN ('approve', 'revise_and_approve')
              AND reviewed_at IS NOT NULL AND reviewing_teacher_id IS NOT NULL
              AND instructor_annotation IS NOT NULL
              AND ((decision = 'approve' AND revised_suggestion IS NULL)
                OR (decision = 'revise_and_approve' AND revised_suggestion IS NOT NULL)))
            OR
            (status = 'rejected' AND decision = 'reject'
              AND reviewed_at IS NOT NULL AND reviewing_teacher_id IS NOT NULL
              AND instructor_annotation IS NOT NULL AND revised_suggestion IS NULL)
          )
        ) STRICT;

        INSERT INTO preflight_submissions_ecological_migration (
          id, student_session_ref, project_metadata_json, active_scale, inquiry,
          source_material, source_record_json, student_annotation, suggestion_json,
          config_snapshot_json, runtime_metadata_json, status, decision, revision,
          created_at, updated_at, reviewed_at, reviewing_teacher_id,
          instructor_annotation, revised_suggestion
        )
        SELECT
          id, student_session_ref, project_metadata_json,
          CASE active_scale WHEN 'macro' THEN 'exosphere' WHEN 'integration' THEN 'macrosphere' ELSE active_scale END,
          inquiry, source_material, source_record_json, student_annotation, suggestion_json,
          config_snapshot_json, runtime_metadata_json, status, decision, revision,
          created_at, updated_at, reviewed_at, reviewing_teacher_id,
          instructor_annotation, revised_suggestion
        FROM preflight_submissions;

        DROP TRIGGER IF EXISTS preflight_submissions_no_delete;
        DROP TABLE prompt_module_history;
        DROP TABLE prompt_modules;
        DROP TABLE preflight_evaluations;
        DROP TABLE preflight_submissions;

        ALTER TABLE prompt_modules_ecological_migration RENAME TO prompt_modules;
        ALTER TABLE prompt_module_history_ecological_migration RENAME TO prompt_module_history;
        ALTER TABLE preflight_evaluations_ecological_migration RENAME TO preflight_evaluations;
        ALTER TABLE preflight_submissions_ecological_migration RENAME TO preflight_submissions;

        CREATE INDEX prompt_history_changed_idx ON prompt_module_history(changed_at DESC);
        CREATE INDEX preflight_evaluations_expiry_idx ON preflight_evaluations(expires_at, id);
        CREATE INDEX preflight_evaluations_session_idx
          ON preflight_evaluations(student_session_ref, consumed_at, expires_at);
        CREATE INDEX preflight_submissions_student_idx
          ON preflight_submissions(student_session_ref, created_at DESC);
        CREATE INDEX preflight_submissions_queue_idx
          ON preflight_submissions(status, created_at, id);
        CREATE INDEX preflight_submissions_reviewer_idx
          ON preflight_submissions(reviewing_teacher_id);

        CREATE TRIGGER preflight_submissions_no_delete
        BEFORE DELETE ON preflight_submissions
        WHEN NOT EXISTS (
          SELECT 1 FROM preflight_retention_purge_guard
          WHERE singleton = 1 AND reason = 'retention'
        )
        BEGIN
          SELECT RAISE(ABORT, 'preflight_submissions are retention-managed');
        END;
      `));
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  const evaluationRows = db.prepare(`
    SELECT id, project_overlay_json AS projectOverlay, suggestion_json AS suggestion,
      config_snapshot_json AS configSnapshot
    FROM preflight_evaluations
  `).all();
  const submissionRows = db.prepare(`
    SELECT id, suggestion_json AS suggestion, config_snapshot_json AS configSnapshot
    FROM preflight_submissions
  `).all();
  const savedProjectRows = db.prepare(`
    SELECT token_hash AS tokenHash, project_json AS projectJson FROM saved_projects
  `).all();
  const updateEvaluation = db.prepare(`
    UPDATE preflight_evaluations
    SET project_overlay_json = ?, suggestion_json = ?, config_snapshot_json = ?
    WHERE id = ?
  `);
  const updateSubmission = db.prepare(`
    UPDATE preflight_submissions SET suggestion_json = ?, config_snapshot_json = ? WHERE id = ?
  `);
  const updateSavedProject = db.prepare(`
    UPDATE saved_projects SET project_json = ? WHERE token_hash = ?
  `);
  inTransaction(db, () => {
    for (const row of evaluationRows) {
      const projectOverlay = migrateScaleIdsJson(row.projectOverlay);
      const suggestion = migrateScaleIdsJson(row.suggestion);
      const configSnapshot = migrateScaleIdsJson(row.configSnapshot);
      if (projectOverlay !== row.projectOverlay || suggestion !== row.suggestion || configSnapshot !== row.configSnapshot) {
        updateEvaluation.run(projectOverlay, suggestion, configSnapshot, row.id);
      }
    }
    for (const row of submissionRows) {
      const suggestion = migrateScaleIdsJson(row.suggestion);
      const configSnapshot = migrateScaleIdsJson(row.configSnapshot);
      if (suggestion !== row.suggestion || configSnapshot !== row.configSnapshot) {
        updateSubmission.run(suggestion, configSnapshot, row.id);
      }
    }
    for (const row of savedProjectRows) {
      const projectJson = migrateScaleIdsJson(row.projectJson);
      if (projectJson !== row.projectJson) updateSavedProject.run(projectJson, row.tokenHash);
    }
  });
}

function upgradeStoredTeachingProfiles(db) {
  const rows = db.prepare(`
    SELECT id, revision, profile_json AS profileJson, fingerprint
    FROM teaching_profiles
  `).all();
  if (!rows.length) return;
  const update = db.prepare(`
    UPDATE teaching_profiles SET profile_json = ?, fingerprint = ? WHERE id = ?
  `);
  const record = db.prepare(`
    INSERT INTO teaching_profile_events
      (profile_id, action, revision, profile_json, fingerprint, note, actor_id, occurred_at)
    SELECT ?, 'updated', ?, ?, ?, ?, NULL, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM teaching_profile_events WHERE profile_id = ? AND fingerprint = ? AND note = ?
    )
  `);
  const occurredAt = new Date().toISOString();
  inTransaction(db, () => {
    for (const row of rows) {
      const current = JSON.parse(row.profileJson);
      const upgraded = upgradeSystemsMappingTeachingProfile(current);
      const serialized = JSON.stringify(upgraded);
      const profileFingerprint = teachingProfileFingerprint(upgraded);
      if (profileFingerprint === row.fingerprint) continue;
      update.run(serialized, profileFingerprint, row.id);
      const note = 'Grouped course settings into two parts';
      record.run(
        row.id,
        row.revision,
        serialized,
        profileFingerprint,
        note,
        occurredAt,
        row.id,
        profileFingerprint,
        note,
      );
    }
  });
}

function seed(db) {
  const now = new Date().toISOString();
  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO accounts (id, display_name, created_at)
    VALUES (?, ?, ?)
  `);
  inTransaction(db, () => {
    for (const account of ACCOUNT_SEEDS) insertAccount.run(account.id, account.displayName, now);

    const insertModule = db.prepare(`
      INSERT OR IGNORE INTO prompt_modules
        (id, config_kind, scale, module_key, label, description, content, revision, fingerprint, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertHistory = db.prepare(`
      INSERT OR IGNORE INTO prompt_module_history
        (module_id, revision, content, fingerprint, change_note, changed_at, changed_by)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `);
    const currentModules = moduleSeeds();
    for (const module of currentModules) {
      insertModule.run(
        module.id,
        module.configKind,
        module.scale,
        module.moduleKey,
        module.label,
        module.description,
        module.content,
        module.revision,
        module.fingerprint,
        now,
      );
      insertHistory.run(module.id, module.revision, module.content, module.fingerprint, 'Starting configuration', now);
    }

    const readModule = db.prepare(`
      SELECT revision, fingerprint FROM prompt_modules WHERE id = ?
    `);
    const updateUntouchedModule = db.prepare(`
      UPDATE prompt_modules
      SET content = ?, revision = 2, fingerprint = ?, updated_at = ?, updated_by = NULL
      WHERE id = ? AND revision = 1 AND fingerprint = ?
    `);
    for (const module of currentModules) {
      const legacyFingerprint = LEGACY_DEFAULT_MODULE_FINGERPRINTS[module.id];
      if (!legacyFingerprint) continue;
      const row = readModule.get(module.id);
      if (row?.revision !== 1 || row.fingerprint !== legacyFingerprint) continue;
      const result = updateUntouchedModule.run(module.content, module.fingerprint, now, module.id, legacyFingerprint);
      if (result.changes === 1) {
        insertHistory.run(module.id, 2, module.content, module.fingerprint, 'Updated default for ecological levels', now);
      }
    }

    const profileJson = JSON.stringify(DEFAULT_TEACHING_PROFILE);
    const profileFingerprint = teachingProfileFingerprint(DEFAULT_TEACHING_PROFILE);
    db.prepare(`
      INSERT OR IGNORE INTO teaching_profiles
        (id, name, status, revision, profile_json, fingerprint, parent_id,
          created_at, created_by, updated_at, updated_by, published_at, published_by)
      VALUES (?, ?, 'active', 1, ?, ?, NULL, ?, NULL, ?, NULL, ?, NULL)
    `).run('systems-mapping-default', 'Course profile', profileJson, profileFingerprint, now, now, now);
    db.prepare(`
      INSERT INTO teaching_profile_events
        (profile_id, action, revision, profile_json, fingerprint, note, actor_id, occurred_at)
      SELECT ?, 'published', 1, ?, ?, ?, NULL, ?
      WHERE NOT EXISTS (SELECT 1 FROM teaching_profile_events WHERE profile_id = ?)
    `).run(
      'systems-mapping-default',
      profileJson,
      profileFingerprint,
      'Starting course settings',
      now,
      'systems-mapping-default',
    );
  });
}

export function inTransaction(db, callback) {
  if (db.dialect === 'postgres') return db.transaction(callback);
  const state = sqliteTransactionState(db);
  if (state.storage.getStore()?.db === db) return runSqliteSavepoint(db, state, callback);
  if (!state.active) return runSqliteTopLevelTransaction(db, state, callback);
  return new Promise((resolve, reject) => state.queue.push({ callback, resolve, reject }));
}

export function assertDatabaseIntegrity(db) {
  const checks = db.prepare('PRAGMA quick_check').all();
  if (checks.length !== 1 || checks[0].quick_check !== 'ok') {
    throw new Error('The local Systems Mapping database did not pass its integrity check.');
  }
  const foreignKeyFailures = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyFailures.length > 0) {
    throw new Error('The local Systems Mapping database contains invalid references.');
  }
  return true;
}

export function prototypeEventAudit(db) {
  const summary = db.prepare(`
    SELECT COUNT(*) AS rowCount, COUNT(DISTINCT session_ref) AS correlationCount,
      MIN(recorded_at) AS oldestAt, MAX(recorded_at) AS newestAt
    FROM prototype_events
  `).get();
  const eventCounts = db.prepare(`
    SELECT event_name AS event, COUNT(*) AS count
    FROM prototype_events GROUP BY event_name ORDER BY event_name
  `).all();
  const format = ([resolvedSummary, resolvedCounts]) => ({
    rowCount: resolvedSummary.rowCount,
    correlationCount: resolvedSummary.correlationCount,
    oldestAt: resolvedSummary.oldestAt ?? null,
    newestAt: resolvedSummary.newestAt ?? null,
    eventCounts: resolvedCounts,
  });
  if (summary && typeof summary.then === 'function') return Promise.all([summary, eventCounts]).then(format);
  return format([summary, eventCounts]);
}
