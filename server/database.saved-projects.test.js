// @vitest-environment node

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';

describe('saved project SQLite metadata migration', () => {
  it('adds revision, expiry, and revocation metadata without changing legacy rows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'systems-mapping-saved-projects-'));
    const path = join(directory, 'legacy.sqlite');
    const tokenHash = 'a'.repeat(64);
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE saved_projects (
        token_hash TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_json TEXT NOT NULL,
        created_session_ref TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
    `);
    legacy.prepare(`
      INSERT INTO saved_projects (
        token_hash, project_id, project_json, created_session_ref, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(tokenHash, 'project_legacy', '{"id":"project_legacy"}', 'b'.repeat(16), 100, 100);
    legacy.close();

    let migrated;
    try {
      migrated = openDatabase(path);
      const columns = migrated.prepare('PRAGMA table_info(saved_projects)').all().map(({ name }) => name);
      expect(columns).toEqual(expect.arrayContaining(['revision', 'expires_at', 'revoked_at']));
      expect(migrated.prepare(`
        SELECT project_id AS projectId, revision, expires_at AS expiresAt, revoked_at AS revokedAt
        FROM saved_projects WHERE token_hash = ?
      `).get(tokenHash)).toEqual({
        projectId: 'project_legacy',
        revision: 1,
        expiresAt: null,
        revokedAt: null,
      });
    } finally {
      migrated?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
