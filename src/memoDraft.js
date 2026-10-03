import { createDefaultProject, stableId, validateProject } from './domain.js';

export const MEMO_DRAFT_PREFIX = 'systems-mapping-studio.memo-draft.v1.';
const MAX_DRAFT_CHARACTERS = 2_000_000;
const DRAFT_FIELDS = ['title', 'participantName', 'inquiry', 'activeScale', 'releasedScales', 'completedScales', 'stage', 'furthestStage', 'levelProgress', 'sharingTier', 'updatedAt', 'submission', 'reflection'];

export const memoDraftKey = projectId => `${MEMO_DRAFT_PREFIX}${encodeURIComponent(projectId)}`;

function draftFields(project) {
  return Object.fromEntries(DRAFT_FIELDS.filter(field => project[field] !== undefined).map(field => [field, project[field]]));
}

function stateFingerprint(project) {
  const { updatedAt, ...fields } = draftFields(project);
  return stableId('memo-state', JSON.stringify(fields));
}

function validateDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('Invalid memo draft');
  if (Object.keys(draft).some(field => !DRAFT_FIELDS.includes(field))) throw new Error('Invalid memo draft');
  if (!Number.isFinite(Date.parse(draft.updatedAt))) throw new Error('Invalid memo draft');
  // Validate editable fields separately from an unfinished graph record.
  const validationBase = createDefaultProject();
  validationBase.instructor.maxSharingTier = 'public';
  validateProject({ ...validationBase, ...draft });
  return draft;
}

function readDraft(storage, project) {
  try {
    const raw = storage.getItem(memoDraftKey(project.id));
    if (!raw || raw.length > MAX_DRAFT_CHARACTERS) return null;
    const value = JSON.parse(raw);
    if (value.version !== 1 || value.projectId !== project.id || value.submissionId !== project.submission.id || value.draft?.submission?.id !== value.submissionId || value.createdAt !== project.createdAt) return null;
    if (Object.keys(value).some(field => !['version', 'projectId', 'submissionId', 'createdAt', 'baseFingerprint', 'draft'].includes(field))) return null;
    if (typeof value.baseFingerprint !== 'string' || value.baseFingerprint.length > 200) return null;
    validateDraft(value.draft);
    return value;
  } catch {
    // Leave unreadable bytes untouched; never show private draft text in errors.
    return null;
  }
}

/** A small local journal, not another graph or a cloud-authoritative save. */
export function cacheMemoDraft(storage, project, savedBase = project) {
  const draft = draftFields(project);
  validateDraft(draft);
  const key = memoDraftKey(project.id);
  const raw = storage.getItem(key);
  const previous = readDraft(storage, project);
  if (raw && !previous) return false;
  if (previous && Date.parse(previous.draft.updatedAt) > Date.parse(draft.updatedAt)) return false;
  if (previous && stateFingerprint(previous.draft) === stateFingerprint(project)) return true;
  if (previous && previous.draft.updatedAt === draft.updatedAt) return false;
  const baseFingerprint = previous?.baseFingerprint || stateFingerprint(savedBase);
  const serialized = JSON.stringify({ version: 1, projectId: project.id, submissionId: project.submission.id, createdAt: project.createdAt, baseFingerprint, draft });
  if (serialized.length > MAX_DRAFT_CHARACTERS) throw new Error('Memo draft exceeds cache limit');
  if (storage.getItem(key) !== serialized) storage.setItem(key, serialized);
  return true;
}

export function restoreMemoDraft(storage, project) {
  const entry = readDraft(storage, project);
  const draft = entry?.draft;
  if (!draft || Date.parse(draft.updatedAt) < Date.parse(project.updatedAt)) return project;
  if (![entry.baseFingerprint, stateFingerprint(draft)].includes(stateFingerprint(project))) return project;
  try {
    const restored = { ...project, ...draft };
    validateProject(restored);
    return restored;
  } catch {
    return project;
  }
}

/** Only a successful full save of this exact latest draft can remove it. */
export function clearSavedMemoDraft(storage, project) {
  const draft = readDraft(storage, project)?.draft;
  if (!draft || stateFingerprint(draft) !== stateFingerprint(project) || Date.parse(project.updatedAt) < Date.parse(draft.updatedAt)) return;
  try { storage.removeItem(memoDraftKey(project.id)); } catch { /* A duplicate recovery copy is safe to retain. */ }
}
