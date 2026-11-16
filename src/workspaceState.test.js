import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createWorkspaceStateSync } from './workspaceState.js';

const adapter = cacheKey => {
  const prefix = `systems-mapping.account.${cacheKey}.`;
  const keys = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(key => key?.startsWith(prefix));
  return {
    prefix, cacheKey, courseSelection: { kind: 'course', id: 'course-a' },
    get length() { return keys().length; }, key: index => keys()[index]?.slice(prefix.length) ?? null,
    getItem: key => localStorage.getItem(prefix + key),
    setItem: (key, value) => localStorage.setItem(prefix + key, value),
    removeItem: key => localStorage.removeItem(prefix + key),
  };
};

const testSync = (storage, request, isCurrent, options = {}) => createWorkspaceStateSync(storage, request, isCurrent, {
  idleDelayMs: 0, maxWaitMs: 0, minIntervalMs: 0, ...options,
});

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

test('remote-only preferences hydrate into the exact account namespace before application defaults', async () => {
  const storage = adapter('opaque-alice-key');
  const request = vi.fn(async () => ({ records: [{ kind: 'preference', key: 'systems-mapping.theme', revision: 3, value: 'dark', deleted: 0 }], conflicts: [] }));
  const sync = testSync(storage, request, captured => captured === storage);
  await expect(sync.hydrate()).resolves.toBe(true);
  expect(storage.getItem('systems-mapping.theme')).toBe('dark');
  expect(request).toHaveBeenCalledTimes(1);
  sync.close();
});

test('source-origin browser preferences seed only after an exact server account namespace is established', async () => {
  const storage = adapter('opaque-alice-key');
  localStorage.setItem('systems-mapping.sidebar-width', '344');
  const request = vi.fn(async () => ({ records: [], conflicts: [] }));
  const sync = testSync(storage, request, captured => captured === storage);
  await sync.hydrate();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(storage.getItem('systems-mapping.sidebar-width')).toBe('344');
  const seed = request.mock.calls.find(([, options]) => options.method === 'PUT');
  expect(seed[2]).toBe(storage);
  expect(JSON.parse(seed[1].body)).toMatchObject({ kind: 'preference', key: 'systems-mapping.sidebar-width', revision: 0, value: '344' });
  sync.close();
});

test('a current account sidebar preference replaces an older browser cache without writing the stale value back', async () => {
  const storage = adapter('opaque-alice-key');
  const key = 'systems-mapping.sidebar-width';
  storage.setItem(key, '304');
  const request = vi.fn(async () => ({ records: [{ kind: 'preference', key, revision: 7, value: '272', deleted: 0 }], conflicts: [] }));
  const sync = testSync(storage, request, captured => captured === storage);
  await expect(sync.hydrate()).resolves.toBe(true);
  expect(storage.getItem(key)).toBe('272');
  expect(request).toHaveBeenCalledTimes(1);
  const archived = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter(name => name.startsWith('local-conflict.v1.'));
  expect(archived).toHaveLength(1);
  expect(storage.getItem(archived[0])).toBe('304');
  sync.close();
});

test('a current account preference does not overwrite an explicit pending local edit', async () => {
  const storage = adapter('opaque-alice-key');
  const key = 'systems-mapping.sidebar-width';
  const operationId = '8e494716-8e88-4aab-b3fc-205f5beec17a';
  storage.setItem(key, '304');
  storage.setItem(`workspace-state-pending.v1.${encodeURIComponent(key)}`, JSON.stringify({
    version: 1, key, operationId, baseRevision: 6, valueKind: 'current', status: 'pending',
  }));
  const request = vi.fn(async (_path, options) => {
    if (!options.method) return { records: [{ kind: 'preference', key, revision: 7, value: '272', deleted: 0 }], conflicts: [] };
    return { status: 409, current: { revision: 7, value: '272', deleted: 0 } };
  });
  const sync = testSync(storage, request, captured => captured === storage);
  await sync.hydrate();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(storage.getItem(key)).toBe('304');
  expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ revision: 6, value: '304' });
  expect(JSON.parse(storage.getItem(`workspace-state-pending.v1.${encodeURIComponent(key)}`))).toMatchObject({ status: 'conflict' });
  expect(Array.from({ length: storage.length }, (_, index) => storage.key(index)).some(name => name.startsWith('local-conflict.v1.'))).toBe(false);
  sync.close();
});

test('a remote preference tombstone preserves the cached value as a local conflict and clears it', async () => {
  const storage = adapter('opaque-alice-key');
  const key = 'systems-mapping.sidebar-width';
  storage.setItem(key, '304');
  const request = vi.fn(async () => ({ records: [{ kind: 'preference', key, revision: 8, value: '', deleted: 1 }], conflicts: [] }));
  const sync = testSync(storage, request, captured => captured === storage);
  await sync.hydrate();
  expect(storage.getItem(key)).toBeNull();
  const archived = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter(name => name.startsWith('local-conflict.v1.'));
  expect(archived).toHaveLength(1);
  expect(storage.getItem(archived[0])).toBe('304');
  expect(request).toHaveBeenCalledTimes(1);
  sync.close();
});

test('an invalid remote preference value is ignored without replacing the local setting', async () => {
  const storage = adapter('opaque-alice-key');
  const key = 'systems-mapping.sidebar-width';
  storage.setItem(key, '304');
  const request = vi.fn(async () => ({ records: [{ kind: 'preference', key, revision: 9, value: 'wide', deleted: 0 }], conflicts: [] }));
  const sync = testSync(storage, request, captured => captured === storage);
  await sync.hydrate();
  expect(storage.getItem(key)).toBe('304');
  expect(request).toHaveBeenCalledTimes(1);
  sync.close();
});

test('a divergent local draft seeds as a stale CAS, preserving both variants before an explicit edit can save', async () => {
  const storage = adapter('opaque-alice-key');
  const key = 'systems-mapping.relationship-draft.v1.shared-project.micro';
  const local = JSON.stringify({ version: 1, projectId: 'shared-project', createdAt: '2026-11-16T00:00:00.000Z', scale: 'micro', draft: { id: 'edge', source: 'a', target: 'b', verb: 'local wording' } });
  storage.setItem(key, local);
  const current = { kind: 'relationship-draft', key, revision: 5, value: local.replace('local wording', 'server wording'), deleted: 0 };
  const request = vi.fn(async (_path, options) => {
    if (!options.method) return { records: [current], conflicts: [] };
    if (JSON.parse(options.body).revision === 0) throw Object.assign(new Error('conflict'), { status: 409, payload: { status: 409, current } });
    return { status: 200, revision: 6 };
  });
  const sync = testSync(storage, request, captured => captured === storage);
  await sync.hydrate();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(JSON.parse(request.mock.calls[1][1].body).revision).toBe(0);
  expect(storage.getItem(key)).toBe(local);
  storage.setItem(key, local.replace('local wording', 'new explicit wording'));
  sync.write(key, storage.getItem(key));
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(JSON.parse(request.mock.calls[2][1].body)).toMatchObject({ revision: 5, value: expect.stringContaining('new explicit wording') });
  sync.close();
});

test('a server tombstone prevents a stale local draft from being reseeded and retains it in its scoped journal', async () => {
  const storage = adapter('opaque-alice-key');
  const key = 'systems-mapping-studio.memo-draft.v1.shared-project';
  const stale = '{"private":"draft"}';
  storage.setItem(key, stale);
  const request = vi.fn(async () => ({ records: [{ kind: 'memo-draft', key, revision: 8, value: '', deleted: 1 }], conflicts: [] }));
  const sync = testSync(storage, request, captured => captured === storage);
  await sync.hydrate();
  expect(storage.getItem(key)).toBeNull();
  const remainingKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  expect(remainingKeys).toHaveLength(1);
  expect(remainingKeys[0]).toMatch(/^local-conflict\.v1\./);
  expect(storage.getItem(remainingKeys[0])).toBe(stale);
  expect(request).toHaveBeenCalledTimes(1);
  sync.close();
});

test('an account switch fences an in-flight hydrate from writing into the old namespace', async () => {
  const storage = adapter('opaque-alice-key');
  let isCurrent = true;
  let finish;
  const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const sync = testSync(storage, request, captured => isCurrent && captured === storage);
  const pending = sync.hydrate();
  isCurrent = false;
  finish({ records: [{ kind: 'preference', key: 'systems-mapping.theme', revision: 1, value: 'dark', deleted: 0 }], conflicts: [] });
  await pending;
  expect(storage.getItem('systems-mapping.theme')).toBeNull();
  sync.close();
});

test('an offline explicit clear stays pending across reload and does not restore the old server draft', async () => {
  const storage = adapter('opaque-alice-key');
  const key = 'systems-mapping.relationship-draft.v1.shared-project.micro';
  const draft = JSON.stringify({ version: 1, projectId: 'shared-project', createdAt: '2026-11-16T00:00:00.000Z', scale: 'micro', draft: { id: 'edge', source: 'a', target: 'b', verb: 'old wording' } });
  storage.setItem(key, draft);
  const saved = { kind: 'relationship-draft', key, revision: 4, value: draft, deleted: 0 };
  const firstRequest = vi.fn(async (_path, options) => {
    if (!options.method) return { records: [saved] };
    throw new Error('network offline');
  });
  const firstSync = testSync(storage, firstRequest, captured => captured === storage);
  await firstSync.hydrate();
  storage.removeItem(key); firstSync.write(key, null);
  await vi.waitFor(() => expect(firstRequest).toHaveBeenCalledTimes(2));
  const markerKey = Array.from({ length: storage.length }, (_, index) => storage.key(index)).find(name => name.startsWith('workspace-state-pending.v1.'));
  const firstOperationId = JSON.parse(storage.getItem(markerKey)).operationId;
  firstSync.close();

  const secondRequest = vi.fn(async (_path, options) => {
    if (!options.method) return { records: [saved] };
    return { status: 200, revision: 5 };
  });
  const secondSync = testSync(storage, secondRequest, captured => captured === storage);
  await secondSync.hydrate();
  await vi.waitFor(() => expect(secondRequest).toHaveBeenCalledTimes(2));
  const retry = JSON.parse(secondRequest.mock.calls[1][1].body);
  expect(retry).toMatchObject({ operationId: firstOperationId, revision: 4, value: null });
  expect(storage.getItem(key)).toBeNull();
  expect(storage.getItem(markerKey)).toBeNull();
  secondSync.close();
});

test('a lost acknowledgment replays the same operation idempotently', async () => {
  const storage = adapter('opaque-alice-key');
  const key = 'systems-mapping-studio.memo-draft.v1.shared-project';
  const saved = { kind: 'memo-draft', key, revision: 2, value: '{"draft":"old"}', deleted: 0 };
  storage.setItem(key, '{"draft":"old"}');
  let serverRow = saved;
  let appliedOperation;
  const firstRequest = vi.fn(async (_path, options) => {
    if (!options.method) return { records: [serverRow] };
    const operation = JSON.parse(options.body);
    appliedOperation = operation.operationId;
    serverRow = { ...serverRow, revision: 3, value: '', deleted: 1 };
    throw new Error('response lost after commit');
  });
  const firstSync = testSync(storage, firstRequest, captured => captured === storage);
  await firstSync.hydrate();
  storage.removeItem(key); firstSync.write(key, null);
  await vi.waitFor(() => expect(firstRequest).toHaveBeenCalledTimes(2));
  firstSync.close();

  const secondRequest = vi.fn(async (_path, options) => {
    if (!options.method) return { records: [serverRow] };
    const replay = JSON.parse(options.body);
    expect(replay.operationId).toBe(appliedOperation);
    return { status: 200, revision: 3, idempotent: true };
  });
  const secondSync = testSync(storage, secondRequest, captured => captured === storage);
  await secondSync.hydrate();
  await vi.waitFor(() => expect(secondRequest).toHaveBeenCalledTimes(2));
  expect(secondRequest).toHaveBeenCalledTimes(2);
  expect(storage.getItem(key)).toBeNull();
  secondSync.close();
});

test.each(['edit', 'clear'])('a local %s while initial read is pending is not overwritten by the late server seed', async mode => {
  const storage = adapter('opaque-alice-key');
  const key = 'systems-mapping.relationship-draft.v1.shared-project.micro';
  const remote = JSON.stringify({ version: 1, projectId: 'shared-project', createdAt: '2026-11-16T00:00:00.000Z', scale: 'micro', draft: { id: 'edge', source: 'a', target: 'b', verb: 'server version' } });
  let finishRead;
  const request = vi.fn(async (_path, options) => {
    if (!options.method) return new Promise(resolve => { finishRead = resolve; });
    throw Object.assign(new Error('revision conflict'), { status: 409, payload: { status: 409, current: { revision: 7 } } });
  });
  const sync = testSync(storage, request, captured => captured === storage);
  const hydration = sync.hydrate();
  const local = remote.replace('server version', 'new local version');
  if (mode === 'edit') storage.setItem(key, local);
  else storage.setItem(key, remote);
  if (mode === 'clear') storage.removeItem(key);
  sync.write(key, mode === 'clear' ? null : local);
  finishRead({ records: [{ kind: 'relationship-draft', key, revision: 7, value: remote, deleted: 0 }] });
  await hydration;
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(storage.getItem(key)).toBe(mode === 'clear' ? null : local);
  sync.close();
});

test('a hung private-state read has a finite deadline', async () => {
  const storage = adapter('opaque-alice-key');
  const sync = testSync(storage, () => new Promise(() => {}), captured => captured === storage, { requestTimeoutMs: 10 });
  await expect(sync.hydrate()).rejects.toMatchObject({ name: 'TimeoutError' });
  sync.close();
});

test('closing an account scope aborts in-flight writes and retains their local journal', async () => {
  const storage = adapter('opaque-alice-key');
  const key = 'systems-mapping.theme';
  let finishWrite;
  let writeSignal;
  const request = vi.fn(async (_path, options) => {
    if (!options.method) return { records: [] };
    writeSignal = options.signal;
    return new Promise(resolve => { finishWrite = resolve; });
  });
  const sync = testSync(storage, request, captured => captured === storage);
  await sync.hydrate();
  storage.setItem(key, 'dark'); sync.write(key, 'dark');
  await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'));
  const markerKey = Array.from({ length: storage.length }, (_, index) => storage.key(index)).find(name => name.startsWith('workspace-state-pending.v1.'));
  sync.close();
  expect(writeSignal.aborted).toBe(true);
  finishWrite({ status: 200, revision: 1 });
  await Promise.resolve();
  expect(storage.getItem(markerKey)).not.toBeNull();
});

test('a successful in-flight save rebases only its newer queued edit to the acknowledged revision', async () => {
  const storage = adapter('opaque-alice-key');
  let settleFirst;
  const writes = [];
  const request = vi.fn(async (_path, options) => {
    if (!options.method) return { records: [] };
    const body = JSON.parse(options.body); writes.push(body);
    if (writes.length === 1) return new Promise(resolve => { settleFirst = resolve; });
    return { status: 200, revision: 2 };
  });
  const sync = testSync(storage, request, captured => captured === storage);
  await sync.hydrate();
  storage.setItem('systems-mapping.theme', 'light'); sync.write('systems-mapping.theme', 'light');
  await vi.waitFor(() => expect(settleFirst).toBeTypeOf('function'));
  storage.setItem('systems-mapping.theme', 'dark'); sync.write('systems-mapping.theme', 'dark');
  settleFirst({ status: 200, revision: 1 });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(writes[1].revision).toBe(1));
  expect(writes[1].value).toBe('dark');
  const pendingKey = Array.from({ length: storage.length }, (_, index) => storage.key(index)).find(name => name.startsWith('workspace-state-pending.v1.'));
  await vi.waitFor(() => expect(storage.getItem(pendingKey)).toBeNull());
  sync.close();
});

test('an old rejected response cannot mark a newer queued edit as rejected', async () => {
  const storage = adapter('opaque-alice-key');
  let rejectFirst;
  const writes = [];
  const request = vi.fn(async (_path, options) => {
    if (!options.method) return { records: [] };
    const body = JSON.parse(options.body); writes.push(body);
    if (writes.length === 1) return new Promise((_resolve, reject) => { rejectFirst = reject; });
    return { status: 200, revision: 1 };
  });
  const sync = testSync(storage, request, captured => captured === storage);
  await sync.hydrate();
  storage.setItem('systems-mapping.theme', 'light'); sync.write('systems-mapping.theme', 'light');
  await vi.waitFor(() => expect(rejectFirst).toBeTypeOf('function'));
  storage.setItem('systems-mapping.theme', 'dark'); sync.write('systems-mapping.theme', 'dark');
  rejectFirst(Object.assign(new Error('invalid old payload'), { status: 400, payload: { status: 400 } }));
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(writes[1].value).toBe('dark'));
  const pendingKey = Array.from({ length: storage.length }, (_, index) => storage.key(index)).find(name => name.startsWith('workspace-state-pending.v1.'));
  await vi.waitFor(() => expect(storage.getItem(pendingKey)).toBeNull());
  sync.close();
});

test('a typing burst keeps a durable journal but sends one paced update with the latest value', async () => {
  vi.useFakeTimers();
  const storage = adapter('opaque-alice-key');
  const sent = [];
  const request = vi.fn(async (_path, options) => {
    if (!options.method) return { records: [] };
    sent.push(JSON.parse(options.body));
    return { status: 200, revision: 1 };
  });
  const sync = createWorkspaceStateSync(storage, request, captured => captured === storage, {
    idleDelayMs: 30, maxWaitMs: 80, minIntervalMs: 50,
  });
  await sync.hydrate();
  let markerKey;
  for (let index = 0; index < 8; index += 1) {
    const value = index % 2 === 0 ? 'light' : 'dark';
    storage.setItem('systems-mapping.theme', value);
    sync.write('systems-mapping.theme', value);
    if (index === 0) {
      markerKey = Array.from({ length: storage.length }, (_, item) => storage.key(item)).find(name => name.startsWith('workspace-state-pending.v1.'));
      expect(markerKey).toBeTruthy();
      expect(JSON.parse(storage.getItem(markerKey))).toMatchObject({ status: 'pending' });
    }
    await vi.advanceTimersByTimeAsync(10);
  }
  await vi.advanceTimersByTimeAsync(200);
  await Promise.resolve();
  expect(sent).toHaveLength(1);
  expect(sent[0].value).toBe('dark');
  expect(storage.getItem(markerKey)).toBeNull();
  sync.close();
});
