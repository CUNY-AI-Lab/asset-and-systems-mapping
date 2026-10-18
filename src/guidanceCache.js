import { GUIDANCE_CONTRACT_VERSION } from '../shared/student-judgments.js';

const MAX_ENTRIES = 6;
const MAX_AGE_MS = 30 * 60 * 1000;
const cacheKey = (projectId) => `systems-mapping.guidance.${GUIDANCE_CONTRACT_VERSION}.${projectId}`;

function entries(storage, projectId, now) {
  try {
    const stored = JSON.parse(storage.getItem(cacheKey(projectId)) || '[]');
    return Array.isArray(stored) ? stored.filter((entry) => entry && typeof entry.key === 'string' && Number.isFinite(entry.createdAt)
      && now - entry.createdAt >= 0 && now - entry.createdAt < MAX_AGE_MS
      && Date.parse(entry.response?.evaluation?.expiresAt) > now).slice(-MAX_ENTRIES) : [];
  } catch { return []; }
}

export function readGuidanceCache(storage, projectId, key, now = Date.now()) {
  return entries(storage, projectId, now).find((entry) => entry.key === key)?.response || null;
}

export function removeGuidanceCacheEntry(storage, projectId, key, now = Date.now()) {
  try { storage.setItem(cacheKey(projectId), JSON.stringify(entries(storage, projectId, now).filter((entry) => entry.key !== key))); }
  catch { /* Generation can proceed without optional reuse. */ }
}

export function writeGuidanceCache(storage, projectId, key, response, now = Date.now()) {
  try {
    const next = entries(storage, projectId, now).filter((entry) => entry.key !== key);
    storage.setItem(cacheKey(projectId), JSON.stringify([...next, { key, response, createdAt: now }].slice(-MAX_ENTRIES)));
  } catch { /* Optional reuse must never block generation or project saving. */ }
}
