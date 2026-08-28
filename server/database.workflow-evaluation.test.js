// @vitest-environment node

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, studentWorkflowEvaluationReport } from './database.js';

describe('student workflow evaluation SQLite migration', () => {
  let directory;
  let database;

  afterEach(() => {
    database?.close();
    database = null;
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('preserves existing prototype events while adding the closed workflow vocabulary', () => {
    directory = mkdtempSync(join(tmpdir(), 'systems-mapping-workflow-evaluation-'));
    const path = join(directory, 'legacy.sqlite');
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE prototype_events (
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
      CREATE INDEX prototype_events_recorded_idx ON prototype_events(recorded_at DESC);
      INSERT INTO prototype_events
        (session_kind, session_ref, event_name, stage, metadata_json, recorded_at)
      VALUES ('student', '0123456789abcdef', 'stage_viewed', 1, '{"stageIndex":1}', 1000);
    `);
    legacy.close();

    database = openDatabase(path);
    expect(database.prepare('SELECT event_name AS event FROM prototype_events ORDER BY id').all())
      .toEqual([{ event: 'stage_viewed' }]);
    expect(() => database.prepare(`
      INSERT INTO prototype_events
        (session_kind, session_ref, event_name, stage, metadata_json, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'student',
      '0123456789abcdef',
      'workflow_observed',
      1,
      JSON.stringify({
        taskCode: 'classify_micro',
        taskOutcome: 'completed_independently',
        classificationExplanation: 'relational_with_evidence',
        revisionQuality: 'not_applicable',
        recoveryOutcome: 'not_needed',
      }),
      2000,
    )).not.toThrow();
    expect(studentWorkflowEvaluationReport(database)).toMatchObject({
      observationCount: 1,
      discardedObservationCount: 0,
      measures: { taskCompletion: { overall: { completed_independently: 1 } } },
    });
  });
});
