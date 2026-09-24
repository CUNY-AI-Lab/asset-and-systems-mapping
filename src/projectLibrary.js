import { parseProject, serializeProject } from './domain.js';

// Keep the durable browser key stable. Schema-v6 projects stored here are
// migrated in place by parseProject; changing the key would strand active work
// in clients that have not yet opened the v7 bundle.
export const STORAGE_KEY = 'systems-mapping-studio.project.v6';
export const LEGACY_STORAGE_KEYS = [
  'systems-mapping-studio.project.v5',
  'systems-mapping-studio.project.v4',
  'systems-mapping-studio.project.v3',
  'systems-mapping-studio.project.v2',
  'systems-mapping-studio.project.v1',
];
export const PROJECT_LIBRARY_KEY = 'systems-mapping-studio.projects.v1';
export const PROJECT_BODY_PREFIX = 'systems-mapping-studio.project-body.v1.';
export const LINK_STORAGE_KEY = 'systems-mapping-studio.link.v1';
export const LINKS_STORAGE_KEY = 'systems-mapping-studio.links.v2';

function safeLinkTimestamp(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))) return value;
  return undefined;
}

function normalizeStoredLink(link) {
  if (!link || typeof link !== 'object') return null;
  if (typeof link.token !== 'string' || !link.token || link.token.length > 512) return null;
  if (typeof link.projectId !== 'string' || !link.projectId || link.projectId.length > 200) return null;
  const normalized = { token: link.token, projectId: link.projectId };
  if (Number.isSafeInteger(link.revision) && link.revision >= 1) normalized.revision = link.revision;
  for (const key of ['updatedAt', 'expiresAt', 'revokedAt', 'lastSyncedAt']) {
    const timestamp = safeLinkTimestamp(link[key]);
    if (timestamp !== undefined) normalized[key] = timestamp;
  }
  return normalized;
}

function projectBodyKey(projectId) {
  let encodedId = '';
  for (let index = 0; index < projectId.length; index += 1) {
    encodedId += projectId.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return `${PROJECT_BODY_PREFIX}${encodedId}`;
}

export function loadDurableProject(storage, projectId) {
  const candidates = [];
  [projectBodyKey(projectId), STORAGE_KEY].forEach((key) => {
    try {
      const raw = storage.getItem(key);
      if (!raw) return;
      const project = parseProject(raw);
      if (project.id === projectId) candidates.push(project);
    } catch {
      // Try the other durable copy.
    }
  });
  return candidates.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))[0] || null;
}

export function reconcileActiveProject(storage, activeProject) {
  const storedProject = loadDurableProject(storage, activeProject.id);
  if (!storedProject) return activeProject;
  return Date.parse(storedProject.updatedAt || 0) > Date.parse(activeProject.updatedAt || 0)
    ? storedProject
    : activeProject;
}

function hasMemo(project) {
  return Boolean(project.submission?.text?.trim() || project.submission?.title?.trim());
}

export function summarizeProject(project) {
  return {
    id: project.id,
    storageKey: projectBodyKey(project.id),
    title: project.title?.trim() || 'Untitled systems map',
    participantName: project.participantName?.trim() || '',
    activeScale: project.activeScale,
    stage: project.stage,
    memoCount: hasMemo(project) ? 1 : 0,
    updatedAt: project.updatedAt,
  };
}

function isLibraryRecord(record) {
  return Boolean(
    record
    && typeof record.id === 'string'
    && typeof record.storageKey === 'string'
    && record.storageKey === projectBodyKey(record.id)
    && typeof record.title === 'string'
    && typeof record.activeScale === 'string'
    && Number.isInteger(record.stage)
    && typeof record.updatedAt === 'string',
  );
}

function upsertRecord(records, record) {
  const next = records.filter((candidate) => candidate.id !== record.id);
  next.push(record);
  return next.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
}

function mergeRecords(...recordGroups) {
  let merged = [];
  recordGroups.flat().forEach((record) => {
    if (!isLibraryRecord(record)) return;
    const existing = merged.find((candidate) => candidate.id === record.id);
    if (!existing || Date.parse(record.updatedAt || 0) >= Date.parse(existing.updatedAt || 0)) {
      merged = upsertRecord(merged, record);
    }
  });
  return merged;
}

function readLibraryIndex(storage) {
  try {
    const raw = storage.getItem(PROJECT_LIBRARY_KEY);
    if (!raw) return { activeProjectId: null, projects: [] };
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.projects)) return { activeProjectId: null, projects: [] };
    return {
      activeProjectId: typeof parsed.activeProjectId === 'string' ? parsed.activeProjectId : null,
      projects: parsed.projects.filter(isLibraryRecord),
    };
  } catch {
    return { activeProjectId: null, projects: [] };
  }
}

export function loadProjectLibrary(storage, activeProject, activeSaved) {
  const resolvedActiveProject = activeSaved ? reconcileActiveProject(storage, activeProject) : activeProject;
  let records = readLibraryIndex(storage).projects.filter((record) => {
    if (activeSaved && record.id === resolvedActiveProject.id) return true;
    try {
      return storage.getItem(record.storageKey) !== null;
    } catch {
      return false;
    }
  });

  // Recover a project body that was written just before an interrupted index
  // update. A corrupt inactive body is ignored without affecting other work.
  try {
    const knownKeys = new Set(records.map((record) => record.storageKey));
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(PROJECT_BODY_PREFIX) || knownKeys.has(key)) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      try {
        const recovered = parseProject(raw);
        const recoveredRecord = summarizeProject(recovered);
        if (recoveredRecord.storageKey !== key) continue;
        records = upsertRecord(records, recoveredRecord);
        knownKeys.add(key);
      } catch {
        // Keep the invalid bytes in place for manual recovery; do not list them.
      }
    }
  } catch {
    // The active project can still be used when catalog enumeration is blocked.
  }

  if (activeSaved) records = upsertRecord(records, summarizeProject(resolvedActiveProject));
  return records;
}

function writeLibraryIndex(storage, records, activeProjectId) {
  storage.setItem(PROJECT_LIBRARY_KEY, JSON.stringify({
    version: 1,
    activeProjectId,
    projects: records,
  }));
}

function storedActiveProject(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? { raw, project: parseProject(raw) } : null;
  } catch {
    return null;
  }
}

export function saveProjectToLibrary(storage, project, records, { makeActive = false } = {}) {
  const serialized = serializeProject(project);
  const currentIndex = readLibraryIndex(storage);
  const activeStored = storedActiveProject(storage);
  let nextRecords = mergeRecords(currentIndex.projects, records);

  if (makeActive) {
    // The active project has one full durable copy. Keeping a second copy here
    // would halve the effective browser quota for existing large projects.
    const targetBodyKey = projectBodyKey(project.id);
    const displaced = activeStored?.project.id !== project.id ? activeStored : null;
    let previousTargetBody = null;

    if (displaced) {
      try { previousTargetBody = storage.getItem(targetBodyKey); } catch { /* Continue with the in-memory project. */ }
      try { storage.removeItem(targetBodyKey); } catch { /* A stale target copy is safe to retain. */ }
      try {
        storage.setItem(projectBodyKey(displaced.project.id), displaced.raw);
      } catch (error) {
        if (previousTargetBody !== null) {
          try { storage.setItem(targetBodyKey, previousTargetBody); } catch { /* The active singleton remains intact. */ }
        }
        throw error;
      }
      nextRecords = upsertRecord(nextRecords, summarizeProject(displaced.project));
    }

    try {
      storage.setItem(STORAGE_KEY, serialized);
    } catch (error) {
      if (displaced) {
        try { storage.removeItem(projectBodyKey(displaced.project.id)); } catch { /* The duplicate remains recoverable. */ }
        if (previousTargetBody !== null) {
          try { storage.setItem(targetBodyKey, previousTargetBody); } catch { /* The caller reports the persistence failure. */ }
        }
      }
      throw error;
    }
    nextRecords = upsertRecord(nextRecords, summarizeProject(project));
    writeLibraryIndex(storage, nextRecords, project.id);
    try { storage.removeItem(targetBodyKey); } catch { /* A stale duplicate is safe to retain. */ }
  } else {
    storage.setItem(projectBodyKey(project.id), serialized);
    nextRecords = upsertRecord(nextRecords, summarizeProject(project));
    writeLibraryIndex(storage, nextRecords, currentIndex.activeProjectId || activeStored?.project.id || null);
  }
  storage.onProjectSaved?.(project);
  return nextRecords;
}

export function loadLibraryProject(storage, record) {
  if (!isLibraryRecord(record)) throw new Error('This saved project entry is invalid.');
  const raw = storage.getItem(record.storageKey);
  if (!raw) throw new Error('This saved project is no longer available on this device.');
  return parseProject(raw);
}

function readStoredLinks(storage) {
  const links = Object.create(null);
  try {
    const raw = storage.getItem(LINKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if ([1, 2].includes(parsed?.version) && parsed.links && typeof parsed.links === 'object') {
        Object.values(parsed.links).forEach((link) => {
          const normalized = normalizeStoredLink(link);
          if (normalized) links[normalized.projectId] = normalized;
        });
      }
    }
  } catch {
    // A malformed registry must not prevent migration of the legacy link below.
  }
  try {
    const legacyRaw = storage.getItem(LINK_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = normalizeStoredLink(JSON.parse(legacyRaw));
      if (legacy && !links[legacy.projectId]) {
        links[legacy.projectId] = legacy;
      }
    }
  } catch {
    // Keep any valid v2 associations.
  }
  return links;
}

export function loadStoredLink(storage, projectId) {
  const links = readStoredLinks(storage);
  return Object.hasOwn(links, projectId) ? links[projectId] : null;
}

export function rememberStoredLink(storage, link) {
  try {
    const links = readStoredLinks(storage);
    const normalized = normalizeStoredLink({ ...links[link?.projectId], ...link });
    if (!normalized) return;
    links[normalized.projectId] = normalized;
    storage.setItem(LINKS_STORAGE_KEY, JSON.stringify({ version: 2, links }));
    storage.setItem(LINK_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The link still works for this visit even when browser storage is unavailable.
  }
}

export function mirrorActiveLink(storage, link) {
  try {
    const normalized = normalizeStoredLink(link);
    if (normalized) storage.setItem(LINK_STORAGE_KEY, JSON.stringify(normalized));
    else storage.removeItem(LINK_STORAGE_KEY);
  } catch {
    // The active association remains in memory for this visit.
  }
}

export function forgetStoredLink(storage, projectId) {
  try {
    const links = readStoredLinks(storage);
    delete links[projectId];
    storage.setItem(LINKS_STORAGE_KEY, JSON.stringify({ version: 2, links }));
    const active = normalizeStoredLink(JSON.parse(storage.getItem(LINK_STORAGE_KEY) || 'null'));
    if (active?.projectId === projectId) storage.removeItem(LINK_STORAGE_KEY);
  } catch {
    // An unavailable registry must not interrupt the rest of the project workflow.
  }
}
