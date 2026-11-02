import { useMemo, useRef, useState } from 'react';
import { projectStorage } from './accountStorage.js';
import { stableId } from './domain.js';

const prefix = 'systems-mapping.relationship-draft.v1.';
export const relationshipDraftKey = project => `${prefix}${encodeURIComponent(project.id)}.${project.activeScale}`;

export function readRelationshipDraft(storage, project) {
  try {
    const raw = storage.getItem(relationshipDraftKey(project));
    if (!raw || raw.length > 20000) return null;
    const entry = JSON.parse(raw);
    if (entry.version !== 1 || entry.projectId !== project.id || entry.createdAt !== project.createdAt || entry.scale !== project.activeScale) return null;
    const draft = entry.draft;
    if (!draft || typeof draft.id !== 'string' || typeof draft.source !== 'string' || typeof draft.target !== 'string' || typeof draft.verb !== 'string' || draft.verb.length > 100) return null;
    return draft;
  } catch { return null; }
}

export function writeRelationshipDraft(storage, project, draft) {
  storage.setItem(relationshipDraftKey(project), JSON.stringify({ version: 1, projectId: project.id, createdAt: project.createdAt, scale: project.activeScale, draft }));
}

// Uses the same account/course-scoped storage as project recovery. Completing
// keeps the journal until the committed edge is durable: a failed project save
// can therefore recover the draft after reload. Only Discard removes it.
export function useRelationshipDraft(project, onError) {
  const storage = projectStorage();
  const scope = `${storage.prefix || 'local'}:${project.id}:${project.createdAt}:${project.activeScale}`;
  const restored = useMemo(() => readRelationshipDraft(storage, project), [storage, scope]);
  const [state, setState] = useState({ scope, draft: restored });
  const draft = state.scope === scope ? state.draft : restored;
  const current = useRef(draft);
  current.current = draft;
  const setDraft = value => {
    const next = typeof value === 'function' ? value(current.current) : value;
    current.current = next;
    setState({ scope, draft: next });
    try { writeRelationshipDraft(storage, project, next); }
    catch { onError('This relationship draft could not be saved on this device. Keep this page open and try again.', 'error'); }
  };
  const discard = () => {
    try { storage.removeItem(relationshipDraftKey(project)); }
    catch { onError('The saved relationship draft could not be discarded. Try again.', 'error'); return false; }
    current.current = null; setState({ scope, draft: null }); return true;
  };
  const active = draft && !project.graph.edges.some(edge => edge.id === draft.id) ? draft : null;
  const start = source => {
    if (active) return active;
    const next = { id: stableId('edge', `${project.id}:${Date.now()}:${Math.random()}`), source: source || '', target: '', verb: '', evidence: '', claimState: 'research lead', relationshipProcess: { direction: 'not yet known' } };
    setDraft(next); return next;
  };
  return { draft: active, setDraft, discard, start };
}
