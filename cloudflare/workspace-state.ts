import { createHash } from 'node:crypto';

const MAX_VALUE_BYTES = 1_800_000;
const MAX_OWNER_BYTES = 16 * 1024 * 1024;
const MAX_WORKSPACE_ROWS = 512;
const MAX_CONFLICT_ROWS = 512;
const MAX_OPERATION_ROWS = 8192;
const OPERATION_TTL_MS = 60 * 60 * 1000;
const CONFLICT_PAGE_SIZE = 50;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_ID = /^[a-zA-Z0-9_-]{1,200}$/;
const SCALES = new Set(['micro', 'meso', 'exosphere', 'macrosphere']);

export type WorkspaceStateKind = 'preference' | 'memo-draft' | 'relationship-draft';
export type WorkspaceStateWrite = {
  kind: WorkspaceStateKind;
  key: string;
  revision: number;
  operationId: string;
  value: string | null;
};

type WorkspaceRow = { kind: WorkspaceStateKind; state_key: string; revision: number; value: string; deleted: number; updated_at: string };

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function projectIdFromEncoded(value: string): string | null {
  try {
    const id = decodeURIComponent(value);
    return PROJECT_ID.test(id) && encodeURIComponent(id) === value ? id : null;
  } catch { return null; }
}

function validMemoDraft(key: string, value: string): boolean {
  const id = projectIdFromEncoded(key.slice('systems-mapping-studio.memo-draft.v1.'.length));
  if (!id) return false;
  try {
    const entry = JSON.parse(value);
    return isObject(entry) && entry.version === 1 && entry.projectId === id
      && typeof entry.submissionId === 'string' && typeof entry.createdAt === 'string'
      && typeof entry.baseFingerprint === 'string' && isObject(entry.draft)
      && isObject(entry.draft.submission)
      && entry.draft.submission.id === entry.submissionId;
  } catch { return false; }
}

function validRelationshipDraft(key: string, value: string): boolean {
  const match = /^systems-mapping\.relationship-draft\.v1\.([^.]*)\.(micro|meso|exosphere|macrosphere)$/.exec(key);
  if (!match || !SCALES.has(match[2])) return false;
  const id = projectIdFromEncoded(match[1]);
  if (!id) return false;
  try {
    const entry = JSON.parse(value);
    return isObject(entry) && entry.version === 1 && entry.projectId === id
      && typeof entry.createdAt === 'string' && entry.scale === match[2] && isObject(entry.draft)
      && typeof entry.draft.id === 'string' && typeof entry.draft.source === 'string'
      && typeof entry.draft.target === 'string' && typeof entry.draft.verb === 'string'
      && entry.draft.verb.length <= 100;
  } catch { return false; }
}

export function validateWorkspaceStateWrite(input: unknown): WorkspaceStateWrite | null {
  if (!isObject(input) || Object.keys(input).sort().join(',') !== 'key,kind,operationId,revision,value') return null;
  const { kind, key, revision, operationId, value } = input;
  if (!['preference', 'memo-draft', 'relationship-draft'].includes(String(kind))
    || typeof key !== 'string' || key.length > 260
    || !Number.isSafeInteger(revision) || (revision as number) < 0
    || typeof operationId !== 'string' || !UUID_V4.test(operationId)
    || value !== null && typeof value !== 'string') return null;
  const typedKind = kind as WorkspaceStateKind;
  if (value !== null) {
    const raw = value as string;
    if (bytes(raw) > MAX_VALUE_BYTES) return null;
    if (typedKind === 'preference') {
      if (key === 'systems-mapping.theme') { if (!['light', 'dark'].includes(raw)) return null; }
      else if (key === 'systems-mapping.sidebar-width') { if (!/^(?:0|[1-9]\d{0,2})$/.test(raw) || Number(raw) < 200 || Number(raw) > 520) return null; }
      else if (key === 'systems-mapping.map-tools-width') { if (!/^(?:0|[1-9]\d{0,2})$/.test(raw) || Number(raw) < 240 || Number(raw) > 480) return null; }
      else if (key === 'account-navigation') {
        try {
          const nav = JSON.parse(raw);
          if (!isObject(nav) || Object.keys(nav).sort().join(',') !== 'open,tab' || typeof nav.open !== 'boolean' || !['overview', 'instructor'].includes(nav.tab as string)) return null;
        } catch { return null; }
      } else return null;
    } else if (typedKind === 'memo-draft') {
      if (!key.startsWith('systems-mapping-studio.memo-draft.v1.') || !validMemoDraft(key, raw)) return null;
    } else if (!validRelationshipDraft(key, raw)) return null;
  } else if (typedKind === 'preference') return null;
  else if (typedKind === 'memo-draft' && !validMemoDraftKey(key)) return null;
  else if (typedKind === 'relationship-draft' && !validRelationshipDraftKey(key)) return null;
  return { kind: typedKind, key, revision: revision as number, operationId, value: value as string | null };
}

function validMemoDraftKey(key: string) {
  return key.startsWith('systems-mapping-studio.memo-draft.v1.')
    && Boolean(projectIdFromEncoded(key.slice('systems-mapping-studio.memo-draft.v1.'.length)));
}
function validRelationshipDraftKey(key: string) {
  const match = /^systems-mapping\.relationship-draft\.v1\.([^.]*)\.(micro|meso|exosphere|macrosphere)$/.exec(key);
  return Boolean(match && projectIdFromEncoded(match[1]));
}

export function workspaceStateGet(db: any, owner: string) {
  const records = db.prepare('SELECT kind,state_key AS key,revision,value,deleted,updated_at AS updatedAt FROM cloud_workspace_state WHERE owner=? ORDER BY kind,state_key').all(owner);
  return { records };
}

export function workspaceStateConflictsGet(db: any, owner: string, cursor = 0) {
  const offset = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  const rows = db.prepare(`SELECT kind,state_key AS key,operation_id AS operationId,variant,revision,value,deleted,created_at AS createdAt
    FROM cloud_workspace_state_conflicts WHERE owner=? ORDER BY created_at,kind,state_key,variant,operation_id LIMIT ${CONFLICT_PAGE_SIZE + 1} OFFSET ${offset}`).all(owner) as any[];
  const hasNext = rows.length > CONFLICT_PAGE_SIZE;
  return { conflicts: hasNext ? rows.slice(0, CONFLICT_PAGE_SIZE) : rows,
    nextCursor: hasNext ? String(offset + CONFLICT_PAGE_SIZE) : null };
}

/** CAS state writes archive both sides of every losing draft attempt, without logging values. */
export function workspaceStatePut(db: any, owner: string, write: WorkspaceStateWrite) {
  const now = new Date();
  db.prepare('DELETE FROM cloud_workspace_state_operations WHERE owner=? AND created_at<?').run(owner, new Date(now.getTime() - OPERATION_TTL_MS).toISOString());
  const value = write.value ?? '';
  const deleted = write.value === null ? 1 : 0;
  const existingOperation = db.prepare('SELECT kind,state_key,base_revision,revision,value_hash,status FROM cloud_workspace_state_operations WHERE owner=? AND operation_id=?').get(owner, write.operationId);
  const valueHash = `${deleted}:${value.length}:${createHash('sha256').update(value).digest('hex')}`;
  if (existingOperation) {
    if (existingOperation.kind !== write.kind || existingOperation.state_key !== write.key || existingOperation.base_revision !== write.revision || existingOperation.value_hash !== valueHash) return { status: 409 as const, current: null, error: 'This workspace update was already used for different data.' };
    if (existingOperation.status === 'applied') return { status: 200 as const, revision: existingOperation.revision, idempotent: true };
    if (existingOperation.status === 'conflict') return { status: 409 as const, current: null, error: 'This workspace update was already preserved as a conflict.' };
  }
  if (!existingOperation) {
    const operations = db.prepare('SELECT count(*) AS count FROM cloud_workspace_state_operations WHERE owner=?').get(owner).count as number;
    if (operations >= MAX_OPERATION_ROWS) return { status: 409 as const, current: null, error: 'This workspace has reached its saved-state limit.' };
  }
  const current = db.prepare('SELECT revision,value,deleted,updated_at AS updatedAt FROM cloud_workspace_state WHERE owner=? AND kind=? AND state_key=?').get(owner, write.kind, write.key) as Omit<WorkspaceRow,'kind'|'state_key'> | undefined;
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== write.revision) {
    const conflicts = db.prepare('SELECT count(*) AS count FROM cloud_workspace_state_conflicts WHERE owner=?').get(owner).count as number;
    const conflictBytes = db.prepare('SELECT coalesce(sum(length(CAST(value AS BLOB))),0) AS bytes FROM cloud_workspace_state_conflicts WHERE owner=?').get(owner).bytes as number;
    const activeBytes = db.prepare('SELECT coalesce(sum(length(CAST(value AS BLOB))),0) AS bytes FROM cloud_workspace_state WHERE owner=?').get(owner).bytes as number;
    const addServer = Boolean(current && !existingOperation && !hasConflictVariant(db, owner, write, 'server', current.value, Boolean(current.deleted)));
    const addLocal = !existingOperation && !hasConflictVariant(db, owner, write, 'local', value, Boolean(deleted));
    const newConflicts = Number(addServer) + Number(addLocal);
    const newConflictBytes = (addServer && current ? bytes(current.value) : 0) + (addLocal ? bytes(value) : 0);
    if (conflicts + newConflicts > MAX_CONFLICT_ROWS || activeBytes + conflictBytes + newConflictBytes > MAX_OWNER_BYTES) return { status: 409 as const, current: current ? { ...current, deleted: Boolean(current.deleted) } : null, error: 'Saved versions are full; this local version remains on this device.' };
    if (current && !existingOperation) archiveConflict(db, owner, write, 'server', current.revision, current.value, Boolean(current.deleted));
    if (!existingOperation) archiveConflict(db, owner, write, 'local', write.revision, value, Boolean(deleted));
    db.prepare(`INSERT INTO cloud_workspace_state_operations(owner,operation_id,kind,state_key,value_hash,base_revision,revision,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,operation_id) DO NOTHING`)
      .run(owner, write.operationId, write.kind, write.key, valueHash, write.revision, currentRevision, 'conflict', now.toISOString());
    return { status: 409 as const, current: current ? { ...current, deleted: Boolean(current.deleted) } : null, error: 'A newer saved draft was found. Both versions were preserved.' };
  }
  if (current && current.value === value && Boolean(current.deleted) === Boolean(deleted)) {
    db.prepare(`INSERT INTO cloud_workspace_state_operations(owner,operation_id,kind,state_key,value_hash,base_revision,revision,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,operation_id) DO NOTHING`)
      .run(owner, write.operationId, write.kind, write.key, valueHash, write.revision, currentRevision, 'applied', now.toISOString());
    return { status: 200 as const, revision: currentRevision, idempotent: true };
  }
  const ownerBytes = db.prepare(`SELECT coalesce(sum(length(CAST(value AS BLOB))),0) AS bytes FROM cloud_workspace_state WHERE owner=?`).get(owner).bytes as number;
  const conflictBytes = db.prepare(`SELECT coalesce(sum(length(CAST(value AS BLOB))),0) AS bytes FROM cloud_workspace_state_conflicts WHERE owner=?`).get(owner).bytes as number;
  const priorBytes = current ? bytes(current.value) : 0;
  if (ownerBytes - priorBytes + bytes(value) + conflictBytes > MAX_OWNER_BYTES) return { status: 409 as const, current: current ? { ...current, deleted: Boolean(current.deleted) } : null, error: 'This workspace has reached its saved-state limit.' };
  if (!current) {
    const count = db.prepare('SELECT count(*) AS count FROM cloud_workspace_state WHERE owner=?').get(owner).count as number;
    if (count >= MAX_WORKSPACE_ROWS) return { status: 409 as const, current: null, error: 'This workspace has reached its saved-state limit.' };
  }
  const revision = currentRevision + 1;
  const updatedAt = now.toISOString();
  db.prepare(`INSERT INTO cloud_workspace_state(owner,kind,state_key,revision,value,deleted,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(owner,kind,state_key) DO UPDATE SET revision=excluded.revision,value=excluded.value,deleted=excluded.deleted,updated_at=excluded.updated_at`)
    .run(owner, write.kind, write.key, revision, value, deleted, updatedAt);
  db.prepare(`INSERT INTO cloud_workspace_state_operations(owner,operation_id,kind,state_key,value_hash,base_revision,revision,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,operation_id) DO UPDATE SET revision=excluded.revision,status='applied'`)
    .run(owner, write.operationId, write.kind, write.key, valueHash, write.revision, revision, 'applied', updatedAt);
  return { status: 200 as const, revision, idempotent: false };
}

function archiveConflict(db: any, owner: string, write: WorkspaceStateWrite, variant: 'server'|'local', revision: number, value: string, deleted: boolean) {
  const valueHash = `${deleted ? 1 : 0}:${value.length}:${createHash('sha256').update(value).digest('hex')}`;
  db.prepare(`INSERT OR IGNORE INTO cloud_workspace_state_conflicts(owner,kind,state_key,operation_id,variant,revision,value,value_hash,deleted,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(owner, write.kind, write.key, write.operationId, variant, revision, value, valueHash, deleted ? 1 : 0, new Date().toISOString());
}

function hasConflictVariant(db: any, owner: string, write: WorkspaceStateWrite, variant: 'server'|'local', value: string, deleted: boolean) {
  const valueHash = `${deleted ? 1 : 0}:${value.length}:${createHash('sha256').update(value).digest('hex')}`;
  return Boolean(db.prepare(`SELECT 1 AS found FROM cloud_workspace_state_conflicts WHERE owner=? AND kind=? AND state_key=? AND variant=? AND value_hash=?`)
    .get(owner, write.kind, write.key, variant, valueHash));
}


