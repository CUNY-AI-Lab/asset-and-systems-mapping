import { parseProject, serializeProject } from './domain.js';
import { loadDurableProject } from './projectLibrary.js';

const syncKey = (id) => `systems-mapping.cloud-sync.${id}`;
export function serializeCloudProject(project) {
  const value = JSON.parse(serializeProject(project));
  // Export timestamps describe downloads, not edits. They must not trigger a
  // cloud write or make an unchanged recovery copy appear to be a conflict.
  delete value.exportedAt;
  const stable = item => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, stable(item[key])])) : item;
  return JSON.stringify(stable(value));
}
export async function projectDigest(serialized) {
  const value = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeCloudProject(parseProject(serialized))));
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function rememberCloudSave(storage, id, revision, serialized) {
  storage.setItem(syncKey(id), JSON.stringify({ revision, digest: await projectDigest(serialized) }));
}

/** Preserve unsynced work. Divergence requires an explicit recovery export. */
export async function reconcileCloudProject(storage, id, remote) {
  const local = loadDurableProject(storage, id);
  if (!remote) return { project: local, conflict: false };
  const project = parseProject(remote.project);
  if (!local) return { project, conflict: false };
  const localDigest = await projectDigest(serializeProject(local));
  const remoteDigest = await projectDigest(serializeProject(project));
  if (localDigest === remoteDigest) return { project, conflict: false };
  let last;
  try { last = JSON.parse(storage.getItem(syncKey(id)) || 'null'); } catch { /* Unknown means conflict, never overwrite. */ }
  if (last?.digest === localDigest) return { project, conflict: false };
  if (last?.revision === remote.revision && last?.digest === remoteDigest) return { project: local, conflict: false };
  return { project: local, conflict: true };
}
