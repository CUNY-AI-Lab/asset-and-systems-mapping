// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import { workspaceStateConflictsGet, workspaceStateGet, workspaceStatePut } from './workspace-state.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE cloud_workspace_state (
    owner TEXT NOT NULL,kind TEXT NOT NULL,state_key TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,deleted INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,kind,state_key));
    CREATE TABLE cloud_workspace_state_conflicts (
    owner TEXT NOT NULL,kind TEXT NOT NULL,state_key TEXT NOT NULL,operation_id TEXT NOT NULL,variant TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,value_hash TEXT NOT NULL,deleted INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner,kind,state_key,operation_id,variant));
    CREATE UNIQUE INDEX cloud_workspace_state_conflict_versions ON cloud_workspace_state_conflicts(owner,kind,state_key,variant,value_hash);
    CREATE TABLE cloud_workspace_state_operations (
    owner TEXT NOT NULL,operation_id TEXT NOT NULL,kind TEXT NOT NULL,state_key TEXT NOT NULL,value_hash TEXT NOT NULL,base_revision INTEGER NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner,operation_id));`);
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { all: (...values) => statement.all(...values), get: (...values) => statement.get(...values), run: (...values) => statement.run(...values) };
    },
    close: () => sqlite.close(),
  };
}

const write = (operationId, revision, value) => ({ kind: 'preference', key: 'systems-mapping.theme', operationId, revision, value });
const owner = 'owner-hash';
afterEach(() => { vi.useRealTimers(); });

test('expired idempotency receipts are bounded and stale replays still fail CAS', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-16T12:00:00.000Z'));
  const db = database();
  try {
    const operationId = '21f8da7c-7661-45ca-a768-188f146280a3';
    expect(workspaceStatePut(db, owner, write(operationId, 0, 'dark'))).toMatchObject({ status: 200, revision: 1 });
    vi.setSystemTime(new Date('2026-11-16T13:01:00.000Z'));
    expect(workspaceStatePut(db, owner, write('a52bbaf4-8737-461e-a7bb-7d875b92b23d', 1, 'light'))).toMatchObject({ status: 200, revision: 2 });
    expect(workspaceStatePut(db, owner, write(operationId, 0, 'dark'))).toMatchObject({ status: 409 });
    expect(workspaceStateGet(db, owner).records).toEqual([expect.objectContaining({ revision: 2, value: 'light' })]);
  } finally { db.close(); }
});

test('repeat conflicts deduplicate identical immutable variants and ordinary reads omit them', () => {
  const db = database();
  try {
    expect(workspaceStatePut(db, owner, write('21f8da7c-7661-45ca-a768-188f146280a3', 0, 'dark')).status).toBe(200);
    expect(workspaceStatePut(db, owner, write('a52bbaf4-8737-461e-a7bb-7d875b92b23d', 0, 'light')).status).toBe(409);
    expect(workspaceStatePut(db, owner, write('f0230c64-76f6-4fe3-bb9f-56e8f188ee46', 0, 'light')).status).toBe(409);
    expect(workspaceStateGet(db, owner)).not.toHaveProperty('conflicts');
    expect(workspaceStateConflictsGet(db, owner).conflicts).toHaveLength(2);
  } finally { db.close(); }
});

test('operation IDs cannot be reused with a different base revision', () => {
  const db = database();
  try {
    const operationId = '21f8da7c-7661-45ca-a768-188f146280a3';
    expect(workspaceStatePut(db, owner, write(operationId, 0, 'dark')).status).toBe(200);
    expect(workspaceStatePut(db, owner, write(operationId, 1, 'dark')).status).toBe(409);
  } finally { db.close(); }
});

test('conflict history is deduplicated and exposed in bounded pages', () => {
  const db = database();
  try {
    const key = 'systems-mapping.relationship-draft.v1.map.micro';
    const value = verb => JSON.stringify({ version: 1, projectId: 'map', createdAt: '2026-11-16T00:00:00.000Z', scale: 'micro', draft: { id: 'edge', source: 'a', target: 'b', verb } });
    const relation = (operationId, revision, verb) => ({ kind: 'relationship-draft', key, operationId, revision, value: value(verb) });
    expect(workspaceStatePut(db, owner, relation('00000000-0000-4000-8000-999999999999', 0, 'server')).status).toBe(200);
    for (let index = 1; index <= 51; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      expect(workspaceStatePut(db, owner, relation(id, 0, `local ${index}`)).status).toBe(409);
    }
    const firstPage = workspaceStateConflictsGet(db, owner);
    expect(firstPage.conflicts).toHaveLength(50);
    expect(firstPage.nextCursor).toBe('50');
    const secondPage = workspaceStateConflictsGet(db, owner, Number(firstPage.nextCursor));
    expect(secondPage.conflicts).toHaveLength(2);
    expect(secondPage.nextCursor).toBeNull();
  } finally { db.close(); }
});
