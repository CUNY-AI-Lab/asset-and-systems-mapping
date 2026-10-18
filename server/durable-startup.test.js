// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemsMappingApp } from './app.js';
import { openDatabase } from './database.js';

describe('Durable SQLite startup readiness', () => {
  let db;

  afterEach(() => db?.close());

  it('waits for database initialization and asynchronous cleanup before becoming ready', async () => {
    db = openDatabase(':memory:');
    db.prepare(`INSERT INTO prototype_events
      (session_kind, session_ref, event_name, stage, metadata_json, recorded_at)
      VALUES ('student', '0123456789abcdef', 'project_started', 0, '{}', 1)
    `).run();
    db.dialect = 'durable-sqlite';
    let initialize;
    let releaseCleanup;
    db.ready = new Promise(resolve => { initialize = resolve; });
    const cleanupGate = new Promise(resolve => { releaseCleanup = resolve; });
    db.transaction = vi.fn(async callback => {
      await cleanupGate;
      return callback();
    });

    const system = createSystemsMappingApp({ db });
    const becameReady = vi.fn();
    void system.ready.then(becameReady);
    await Promise.resolve();
    expect(db.transaction).not.toHaveBeenCalled();

    initialize();
    await Promise.resolve();
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(becameReady).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) AS n FROM prototype_events').get().n).toBe(1);

    releaseCleanup();
    await system.ready;
    expect(becameReady).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM prototype_events').get().n).toBe(0);
  });

  it('rejects readiness when asynchronous startup cleanup fails', async () => {
    db = openDatabase(':memory:');
    db.dialect = 'durable-sqlite';
    const failure = new Error('Synthetic startup transaction failure');
    db.transaction = vi.fn(async () => { throw failure; });

    const system = createSystemsMappingApp({ db });
    await expect(system.ready).rejects.toBe(failure);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
