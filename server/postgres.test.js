// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { COURSE_PROGRESSION_SCHEMA_VERSION } from '../shared/educator-resource-contract.js';
import { teachingProfileFingerprint } from './config.js';
import { compilePostgresSql, PostgresDatabase, validatePostgresUrl } from './postgres.js';

function fakePool({ clientQuery } = {}) {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ target: 'client', text, values });
      const custom = await clientQuery?.(text, values);
      if (custom) return custom;
      if (/SELECT .* AS "displayName"/i.test(text)) {
        return { rows: [{ id: 'teacher', displayName: 'Teacher', changedAt: new Date('2026-01-01T00:00:00Z') }], rowCount: 1 };
      }
      return { rows: [], rowCount: /UPDATE/i.test(text) ? 1 : 0 };
    },
    release: vi.fn(),
  };
  const pool = {
    on: vi.fn(),
    async query(text, values = []) {
      calls.push({ target: 'pool', text, values });
      return { rows: [{ ok: 1 }], rowCount: 1 };
    },
    async connect() {
      calls.push({ target: 'pool', text: 'CONNECT', values: [] });
      return client;
    },
    end: vi.fn(async () => {}),
  };
  return { pool, client, calls };
}

describe('PostgreSQL persistence adapter', () => {
  it('validates PostgreSQL URLs without exposing their contents', () => {
    expect(validatePostgresUrl('postgresql://app@db.internal/systems_mapping').protocol).toBe('postgresql:');
    expect(() => validatePostgresUrl('https://db.invalid/systems_mapping')).toThrow('postgres:// or postgresql://');
    expect(() => validatePostgresUrl('not a url')).toThrow('valid PostgreSQL connection URL');
  });

  it('parameterizes placeholders and preserves camel-case result aliases', () => {
    expect(compilePostgresSql(`
      SELECT display_name AS displayName FROM accounts
      WHERE id = ? AND claimed_at > ? LIMIT -1 OFFSET ?
    `)).toContain('AS "displayName"');
    expect(compilePostgresSql('SELECT * FROM accounts WHERE id = ? AND display_name = ?'))
      .toContain('id = $1 AND display_name = $2');
    expect(compilePostgresSql('SELECT id FROM sessions LIMIT -1 OFFSET ?')).toContain('OFFSET $1');
  });

  it('installs the constrained review queue, indexes, append-only triggers, and migration marker', async () => {
    const fake = fakePool();
    const database = new PostgresDatabase('postgres://app@db.internal/systems_mapping', {
      pool: fake.pool,
      initialize: true,
    });
    await database.ready;
    const migration = fake.calls.find(({ text }) => text.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))?.text;
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS preflight_evaluations');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS preflight_submissions');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS preflight_review_events');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS preflight_retention_purges');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS teaching_profiles');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS teaching_profile_events');
    expect(migration).toContain('teaching_profile_events_no_update');
    expect(migration).toContain('teaching_profile_events_no_delete');
    expect(migration).toContain('preflight_evaluations_expiry_idx');
    expect(migration).toContain('preflight_evaluations_session_idx');
    expect(migration).toContain('preflight_submissions_queue_idx');
    expect(migration).toContain('preflight_review_events_submission_idx');
    expect(migration).toContain('preflight_retention_purges_time_idx');
    expect(migration).toContain('preflight_review_events_no_update');
    expect(migration).toContain('preflight_review_events_no_delete');
    expect(migration).toContain('preflight_retention_purges_no_delete');
    expect(migration).toContain("status IN ('pending', 'approved', 'rejected')");
    expect(migration).toContain("decision = 'revise_and_approve' AND revised_suggestion IS NOT NULL");
    expect(migration).toContain('pg_column_size(project_metadata_json) <= 8192');
    expect(migration).toContain('pg_column_size(source_record_json) <= 32768');
    expect(migration).toContain('pg_column_size(config_snapshot_json) <= 131072');
    expect(migration).toContain('pg_column_size(runtime_metadata_json) <= 8192');
    expect(migration).toContain('revision INTEGER NOT NULL DEFAULT 1');
    expect(migration).toContain('expires_at BIGINT');
    expect(migration).toContain('revoked_at BIGINT');
    expect(fake.calls.some(({ text }) => /schema_migrations \(version\) VALUES \(5\)/.test(text))).toBe(true);
    expect(fake.calls.some(({ text }) => /schema_migrations \(version\) VALUES \(10\)/.test(text))).toBe(true);
    expect(fake.calls.some(({ text }) => /schema_migrations \(version\) VALUES \(11\)/.test(text))).toBe(true);
    expect(fake.calls.some(({ text }) => /schema_migrations \(version\) VALUES \(12\)/.test(text))).toBe(true);
    const mapViewVocabularyMigration = fake.calls.find(({ text }) => (
      text.includes('ADD CONSTRAINT prototype_events_event_name_check')
      && text.includes("'map_arranged'")
    ))?.text;
    for (const event of ['workflow_observed', 'map_arranged', 'map_previewed', 'map_preview_closed']) {
      expect(migration).toContain(`'${event}'`);
      expect(mapViewVocabularyMigration).toContain(`'${event}'`);
    }
    expect(fake.calls.at(-1)?.text).toBe('COMMIT');
    await database.close();
  });

  it('does not rerun the map-view vocabulary migration after version 12 is recorded', async () => {
    const fake = fakePool({
      clientQuery(text) {
        if (/SELECT version FROM schema_migrations WHERE version = (11|12|13)/.test(text)) {
          return { rows: [{ version: Number(text.match(/version = (\d+)/)?.[1]) }], rowCount: 1 };
        }
        return null;
      },
    });
    const database = new PostgresDatabase('postgres://app@db.internal/systems_mapping', {
      pool: fake.pool,
      initialize: true,
    });
    await database.ready;
    expect(fake.calls.some(({ text }) => text.includes('WHERE version = 12'))).toBe(true);
    expect(fake.calls.some(({ text }) => (
      text.includes('ADD CONSTRAINT prototype_events_event_name_check')
      && text.includes("'map_arranged'")
    ))).toBe(false);
    expect(fake.calls.some(({ text }) => /schema_migrations \(version\) VALUES \(12\)/.test(text))).toBe(false);
    await database.close();
  });

  it('atomically increments a legacy teaching profile and records the matching PostgreSQL event', async () => {
    const legacyProfile = {
      schemaVersion: 'cuny.teaching-profile.v1',
      focus: 'Keep attention on how institutions affect access.',
      evidence: 'Require a memo passage for each proposal.',
      questions: 'Ask one question that returns the student to the memo.',
      privacy: 'Keep sensitive details out of shared exports.',
      contextAdjustments: {
        micro: 'Attend to direct encounters.',
        meso: 'Attend to immediate settings.',
        macro: 'Attend to institutions and policy.',
        integration: 'Compare mapped levels.',
      },
    };
    const state = {
      id: 'legacy-profile',
      revision: 7,
      profile: legacyProfile,
      fingerprint: 'a'.repeat(64),
    };
    const upgradeEvents = [];
    const fake = fakePool({
      clientQuery(text, values) {
        const compact = text.replace(/\s+/g, ' ').trim();
        if (compact === 'SELECT id, revision, profile_json, fingerprint FROM teaching_profiles') {
          return {
            rows: [{
              id: state.id,
              revision: state.revision,
              profile_json: state.profile,
              fingerprint: state.fingerprint,
            }],
            rowCount: 1,
          };
        }
        if (compact.startsWith('UPDATE teaching_profiles SET profile_json = $1::jsonb')) {
          expect(values.slice(4)).toEqual([state.id, state.revision, state.fingerprint]);
          state.profile = JSON.parse(values[0]);
          state.fingerprint = values[1];
          state.revision = values[2];
          return { rows: [{ revision: state.revision }], rowCount: 1 };
        }
        if (compact.startsWith('INSERT INTO teaching_profile_events') && values[4] === 'Updated default scale semantics') {
          upgradeEvents.push(values);
          return { rows: [], rowCount: 1 };
        }
        return null;
      },
    });

    const database = new PostgresDatabase('postgres://app@db.internal/systems_mapping', {
      pool: fake.pool,
      initialize: true,
    });
    await database.ready;

    expect(state.revision).toBe(8);
    expect(state.profile.schemaVersion).toBe(COURSE_PROGRESSION_SCHEMA_VERSION);
    expect(state.fingerprint).toBe(teachingProfileFingerprint(state.profile));
    expect(upgradeEvents).toHaveLength(1);
    expect(upgradeEvents[0].slice(0, 5)).toEqual([
      state.id,
      state.revision,
      JSON.stringify(state.profile),
      state.fingerprint,
      'Updated default scale semantics',
    ]);
    const beginIndex = fake.calls.findIndex(({ text }) => text === 'BEGIN');
    const updateIndex = fake.calls.findIndex(({ text }) => /UPDATE teaching_profiles\s+SET profile_json = \$1::jsonb/.test(text));
    const eventIndex = fake.calls.findIndex(({ text, values }) => text.includes('INSERT INTO teaching_profile_events') && values[4] === 'Updated default scale semantics');
    const commitIndex = fake.calls.findIndex(({ text }) => text === 'COMMIT');
    expect([beginIndex, updateIndex, eventIndex, commitIndex]).toEqual([...new Set([beginIndex, updateIndex, eventIndex, commitIndex])].sort((left, right) => left - right));

    await database.close();
  });

  it('uses a bounded pool and one client for short nested transactions', async () => {
    const fake = fakePool();
    const database = new PostgresDatabase('postgres://app@db.internal/systems_mapping', {
      pool: fake.pool,
      initialize: false,
      statementTimeoutMs: 2000,
      transactionIdleTimeoutMs: 1000,
    });

    const result = await database.transaction(async () => {
      const row = await database.prepare('SELECT id, display_name AS displayName FROM accounts WHERE id = ?').get('teacher');
      await database.transaction(async () => {
        await database.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run('Teacher', 'teacher');
      });
      return row;
    });

    expect(result).toEqual({ id: 'teacher', displayName: 'Teacher', changedAt: '2026-01-01T00:00:00.000Z' });
    expect(fake.calls.map(({ target, text }) => `${target}:${text.split(/\s+/).filter(Boolean).slice(0, 2).join(' ')}`)).toEqual([
      'pool:CONNECT',
      'client:BEGIN',
      'client:SET LOCAL',
      'client:SET LOCAL',
      'client:SELECT id,',
      'client:SAVEPOINT systems_mapping_1',
      'client:UPDATE accounts',
      'client:RELEASE SAVEPOINT',
      'client:COMMIT',
    ]);
    expect(fake.client.release).toHaveBeenCalledOnce();
    await database.close();
    expect(fake.pool.end).toHaveBeenCalledOnce();
  });

  it('rolls back both a nested savepoint and its outer transaction on failure', async () => {
    const fake = fakePool();
    const database = new PostgresDatabase('postgres://app@db.internal/systems_mapping', {
      pool: fake.pool,
      initialize: false,
    });
    await expect(database.transaction(async () => {
      await database.transaction(async () => {
        throw new Error('injected failure');
      });
    })).rejects.toThrow('injected failure');
    const sql = fake.calls.map(({ text }) => text);
    expect(sql.some((text) => text.startsWith('ROLLBACK TO SAVEPOINT'))).toBe(true);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    await database.close();
  });
});
