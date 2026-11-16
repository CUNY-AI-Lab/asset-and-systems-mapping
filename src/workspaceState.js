const PREFERENCE_KEYS = new Set([
  'systems-mapping.theme', 'systems-mapping.sidebar-width', 'systems-mapping.map-tools-width', 'account-navigation',
]);
const MEMO_PREFIX = 'systems-mapping-studio.memo-draft.v1.';
const RELATIONSHIP_PREFIX = 'systems-mapping.relationship-draft.v1.';
const JOURNAL_PREFIX = 'workspace-state-pending.v1.';
const LOCAL_CONFLICT_PREFIX = 'local-conflict.v1.';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function workspaceStateKind(key) {
  if (PREFERENCE_KEYS.has(key)) return 'preference';
  if (key.startsWith(MEMO_PREFIX)) return 'memo-draft';
  if (key.startsWith(RELATIONSHIP_PREFIX)) return 'relationship-draft';
  return null;
}

function journalKey(key) { return JOURNAL_PREFIX + encodeURIComponent(key); }

function readJournal(storage, key) {
  try {
    const entry = JSON.parse(storage.getItem(journalKey(key)) || 'null');
    if (entry?.version !== 1 || entry.key !== key || !UUID_V4.test(entry.operationId)
      || !Number.isSafeInteger(entry.baseRevision) || entry.baseRevision < 0
      || !['current', 'deleted'].includes(entry.valueKind)
      || !['pending', 'conflict', 'rejected'].includes(entry.status)) return null;
    return entry;
  } catch { return null; }
}

function writeJournal(storage, key, journal) {
  try { storage.setItem(journalKey(key), JSON.stringify(journal)); } catch { /* The actual local draft remains available in its normal key. */ }
}

function legacyPreferences(storage, remote) {
  for (const key of ['systems-mapping.theme', 'systems-mapping.sidebar-width', 'systems-mapping.map-tools-width']) {
    if (remote.has(key) || storage.getItem(key) !== null) continue;
    try {
      const legacy = window.localStorage.getItem(key);
      if (legacy !== null) storage.setItem(key, legacy);
    } catch { /* A browser preference may be unavailable; remote state still loads. */ }
  }
}

function validPreferenceValue(key, value) {
  if (typeof value !== 'string') return false;
  if (key === 'systems-mapping.theme') return value === 'light' || value === 'dark';
  if (key === 'systems-mapping.sidebar-width') return /^(?:0|[1-9]\d{0,2})$/.test(value) && Number(value) >= 200 && Number(value) <= 520;
  if (key === 'systems-mapping.map-tools-width') return /^(?:0|[1-9]\d{0,2})$/.test(value) && Number(value) >= 240 && Number(value) <= 480;
  if (key === 'account-navigation') {
    try {
      const navigation = JSON.parse(value);
      return navigation && typeof navigation === 'object' && !Array.isArray(navigation)
        && Object.keys(navigation).sort().join(',') === 'open,tab'
        && typeof navigation.open === 'boolean' && ['overview', 'instructor'].includes(navigation.tab);
    } catch { return false; }
  }
  return false;
}

export function createWorkspaceStateSync(storage, request, isCurrent, {
  requestTimeoutMs = 5000, idleDelayMs = 750, maxWaitMs = 2000, minIntervalMs = 1000,
} = {}) {
  const revisions = new Map();
  const conflicted = new Set();
  const queues = new Map();
  const generations = new Map();
  const controllers = new Set();
  const pendingJobs = new Map();
  let closed = false;
  let globalQueue = Promise.resolve();
  let lastRequestAt = 0;
  const current = captured => !closed && isCurrent(captured) && captured === storage;
  const keys = () => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(key => typeof key === 'string');

  const boundedRequest = async (path, options, captured) => {
    const controller = new AbortController();
    controllers.add(controller);
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const failure = Object.assign(new Error('Private workspace state request timed out'), { name: 'TimeoutError' });
        controller.abort(failure);
        reject(failure);
      }, requestTimeoutMs);
    });
    try {
      return await Promise.race([
        request(path, { ...options, signal: controller.signal }, captured),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  };

  const send = async (key, proposedJournal, capturedGeneration, expectedRevision = null) => {
    const kind = workspaceStateKind(key);
    if (!kind || closed) return;
    const captured = storage;
    const previous = queues.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => {
      const globalTask = globalQueue.catch(() => {}).then(async () => {
      const cadenceWait = Math.max(0, lastRequestAt + minIntervalMs - Date.now());
      if (cadenceWait) await new Promise(resolve => setTimeout(resolve, cadenceWait));
      if (!current(captured) || capturedGeneration !== (generations.get(key) || 0)) return;
      const journal = readJournal(captured, key) || proposedJournal;
      if (!journal || journal.status !== 'pending' || journal.operationId !== proposedJournal.operationId) return;
      const value = journal.valueKind === 'deleted' ? null : captured.getItem(key);
      if (journal.valueKind === 'current' && value === null) return;
      lastRequestAt = Date.now();
      let result;
      try {
        result = await boundedRequest('/api/cloud/workspace-state', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, key, revision: expectedRevision ?? journal.baseRevision, operationId: journal.operationId, value }),
        }, captured);
      } catch (error) {
        if (error?.status === 409) result = error.payload;
        else if (error?.status === 400) {
          if (current(captured) && capturedGeneration === (generations.get(key) || 0)) {
            writeJournal(captured, key, { ...journal, status: 'rejected' });
          }
          return;
        } else throw error;
      }
      if (!current(captured)) return;
      if (capturedGeneration !== (generations.get(key) || 0)) {
        // A successful earlier request in this same serialized scope advances
        // only the next unsent local journal based on its exact old revision.
        // It cannot rebase another tab's or an unrelated account's write.
        const newer = readJournal(captured, key);
        if (result?.status !== 409 && Number.isSafeInteger(result?.revision)
          && newer?.status === 'pending' && newer.operationId !== journal.operationId
          && newer.baseRevision === journal.baseRevision) {
          revisions.set(key, result.revision);
          writeJournal(captured, key, { ...newer, baseRevision: result.revision });
        }
        return;
      }
      if (result?.status === 409) {
        conflicted.add(key);
        if (Number.isSafeInteger(result.current?.revision)) revisions.set(key, result.current.revision);
        writeJournal(captured, key, { ...journal, status: 'conflict', baseRevision: result.current?.revision ?? journal.baseRevision });
        return;
      }
      if (Number.isSafeInteger(result.revision)) revisions.set(key, result.revision);
      conflicted.delete(key);
      const currentJournal = readJournal(captured, key);
      if (currentJournal?.operationId === journal.operationId) captured.removeItem(journalKey(key));
      });
      globalQueue = globalTask.catch(() => {});
      return globalTask;
    });
    queues.set(key, task);
    await task;
  };

  const scheduleSend = (key, journal, generation) => {
    const now = Date.now();
    let job = pendingJobs.get(key);
    if (job?.timer) clearTimeout(job.timer);
    if (!job) job = { firstAt: now, journal, generation, timer: null };
    job.journal = journal; job.generation = generation;
    pendingJobs.set(key, job);
    const dueAt = Math.min(now + idleDelayMs, job.firstAt + maxWaitMs);
    const delay = Math.max(0, dueAt - Date.now());
    job.timer = setTimeout(() => {
      const currentJob = pendingJobs.get(key);
      if (currentJob !== job || closed) return;
      pendingJobs.delete(key);
      void send(key, job.journal, job.generation).catch(() => {});
    }, delay);
  };

  const startWrite = (key, value, baseRevision, generation) => {
    const journal = {
      version: 1, key, operationId: crypto.randomUUID(), baseRevision,
      valueKind: value === null ? 'deleted' : 'current', status: 'pending',
    };
    writeJournal(storage, key, journal);
    scheduleSend(key, journal, generation);
    return journal;
  };

  const hydrate = async () => {
    const captured = storage;
    const response = await boundedRequest('/api/cloud/workspace-state', {}, captured);
    if (!current(captured)) return false;
    const records = Array.isArray(response.records) ? response.records : [];
    const remote = new Map(records.filter(row => typeof row?.key === 'string' && workspaceStateKind(row.key))
      .map(row => [row.key, row]));
    legacyPreferences(storage, remote);
    for (const key of new Set([...keys(), ...remote.keys()])) {
      if (!current(captured)) return false;
      const kind = workspaceStateKind(key);
      if (!kind) continue;
      const localValue = storage.getItem(key);
      const saved = remote.get(key);
      if (kind === 'preference' && saved && !saved.deleted && !validPreferenceValue(key, saved.value)) continue;
      if (saved && Number.isSafeInteger(saved.revision) && saved.revision >= 1) revisions.set(key, saved.revision);
      const journal = readJournal(storage, key);
      if (journal) {
        if (journal.status === 'pending') scheduleSend(key, journal, generations.get(key) || 0);
        else conflicted.add(key);
        continue;
      }
      if (!saved) {
        if (localValue !== null) startWrite(key, localValue, 0, generations.get(key) || 0);
        continue;
      }
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 1) continue;
      if (saved.deleted) {
        if (localValue !== null) {
          try {
            storage.setItem(LOCAL_CONFLICT_PREFIX + encodeURIComponent(key) + '.' + Date.now(), localValue);
            storage.removeItem(key);
          } catch { /* Keep the original local bytes when local conflict storage is unavailable. */ }
        }
      } else if (typeof saved.value === 'string' && localValue === null) {
        try { storage.setItem(key, saved.value); } catch { /* Server copy remains available on the next load. */ }
      } else if (typeof saved.value === 'string' && localValue !== saved.value) {
        if (kind === 'preference') {
          // A stale browser cache has no write journal and cannot supersede a
          // current account preference. Keep its old value privately before
          // applying the server revision. Explicit pending edits took the
          // journal path above and still retain their conflict semantics.
          try {
            storage.setItem(LOCAL_CONFLICT_PREFIX + encodeURIComponent(key) + '.' + Date.now(), localValue);
            storage.setItem(key, saved.value);
          } catch { /* Preserve the local value if the conflict copy cannot be stored. */ }
        } else {
          // Preserve divergent drafts on both sides; only an explicit edit can
          // advance the server revision after a conflict.
          startWrite(key, localValue, 0, generations.get(key) || 0);
        }
      }
    }
    return current(captured);
  };

  return {
    hydrate,
    write(key, value) {
      if (!workspaceStateKind(key) || closed) return;
      const generation = (generations.get(key) || 0) + 1;
      generations.set(key, generation);
      conflicted.delete(key);
      startWrite(key, value, revisions.get(key) || 0, generation);
    },
    close() {
      closed = true;
      for (const [key, generation] of generations) generations.set(key, generation + 1);
      for (const job of pendingJobs.values()) clearTimeout(job.timer);
      pendingJobs.clear();
      for (const controller of controllers) controller.abort(new DOMException('Workspace scope changed', 'AbortError'));
    },
  };
}
