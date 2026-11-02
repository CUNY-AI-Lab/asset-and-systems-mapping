import { parseProject, serializeProject } from './domain.js';

const PREFIX = 'systems-mapping.deleted-project.';

// These keys are written through the existing account/course-scoped adapter.
// A recovery write must finish before any delete request is sent.
export function preserveDeletedProject(storage, project, remoteProject = null) {
  const key = PREFIX + crypto.randomUUID();
  const entry = { version: 1, deletedAt: new Date().toISOString(), project: serializeProject(project), remoteProject: remoteProject ? serializeProject(remoteProject) : null };
  const raw = JSON.stringify(entry);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error('A recovery copy could not be verified. The project was not deleted.');
  return { key, ...entry };
}

export function deletedProjects(storage) {
  const entries = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const entry = JSON.parse(storage.getItem(key));
      if (entry.version !== 1 || typeof entry.deletedAt !== 'string') continue;
      const project = parseProject(entry.project);
      if (entry.remoteProject) parseProject(entry.remoteProject);
      entries.push({ key, ...entry, title: project.title, projectId: project.id });
    } catch { /* Keep malformed bytes for recovery; do not mutate them. */ }
  }
  return entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export function forgetDeletedProject(storage, key) {
  if (!key?.startsWith(PREFIX)) throw new Error('Invalid recovery selection.');
  storage.removeItem(key);
}
