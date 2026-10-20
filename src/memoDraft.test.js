import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultProject, serializeProject, stableId, validateProject } from './domain.js';
import { cacheMemoDraft, clearSavedMemoDraft, memoDraftKey, restoreMemoDraft } from './memoDraft.js';
import { loadDurableProject, saveProjectToLibrary, STORAGE_KEY } from './projectLibrary.js';
import { releaseAccountStorage, useAccountStorage } from './accountStorage.js';
import { reconcileCloudProject, rememberCloudSave } from './cloudSync.js';
import { webcrypto } from 'node:crypto';

const project = () => {
  const value = createDefaultProject();
  value.id = 'memo-draft-project';
  value.createdAt = value.updatedAt = '2026-10-03T16:00:00.000Z';
  return value;
};
const revise = (original, text = 'Revised student memo', stage = 1) => {
  const value = structuredClone(original);
  value.submission.text = text;
  value.submission.revision = (original.submission.revision || 1) + 1;
  value.submission.fingerprint = stableId('src', text);
  value.stage = stage;
  value.furthestStage = Math.max(stage, value.furthestStage || 0);
  value.levelProgress[value.activeScale].stage = stage;
  value.updatedAt = '2026-10-03T16:00:01.000Z';
  return value;
};

beforeEach(() => {
  window.localStorage.clear();
  releaseAccountStorage();
  Object.defineProperty(crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
});
afterEach(() => releaseAccountStorage());

describe('project-scoped memo journal', () => {
  it('recovers Field Notes before the full project save without overwriting another scale', () => {
    const original = project();
    original.levelProgress.meso.reflection = 'Keep this earlier linkage observation.';
    saveProjectToLibrary(window.localStorage, original, [], { makeActive: true });
    const edited = revise(original);
    edited.reflection = 'A missing direct relationship needs a conversation with the home attendant.';
    edited.levelProgress[edited.activeScale].reflection = edited.reflection;
    cacheMemoDraft(window.localStorage, edited, original);
    const recovered = loadDurableProject(window.localStorage, original.id);
    expect(recovered.reflection).toBe(edited.reflection);
    expect(recovered.levelProgress[edited.activeScale].reflection).toBe(edited.reflection);
    expect(recovered.levelProgress.meso.reflection).toBe(original.levelProgress.meso.reflection);
    expect(recovered.graph).toEqual(original.graph);
  });

  it('restores an immediate memo and current-step edit before the full save runs', () => {
    const original = project();
    saveProjectToLibrary(window.localStorage, original, [], { makeActive: true });
    const edited = revise(original);
    cacheMemoDraft(window.localStorage, edited, original);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).submission.text).toBe(original.submission.text);
    expect(loadDurableProject(window.localStorage, original.id)).toMatchObject({
      submission: edited.submission, stage: 1, levelProgress: edited.levelProgress, graph: original.graph,
    });
  });

  it('caches a memo independently when an unrelated unfinished map item prevents a full save', () => {
    const original = project();
    saveProjectToLibrary(window.localStorage, original, [], { makeActive: true });
    const edited = revise(original);
    edited.graph.nodes.push({ id: 'unfinished-node', label: '' });
    expect(() => validateProject(edited)).toThrow();
    expect(() => cacheMemoDraft(window.localStorage, edited, original)).not.toThrow();
    const recovered = loadDurableProject(window.localStorage, original.id);
    expect(recovered.submission).toEqual(edited.submission);
    expect(recovered.graph).toEqual(original.graph);
    expect(() => validateProject(recovered)).not.toThrow();
  });

  it('does not remove a newer journal when an older snapshot or failed write is saved', () => {
    const original = project();
    saveProjectToLibrary(window.localStorage, original, [], { makeActive: true });
    const edited = revise(original);
    cacheMemoDraft(window.localStorage, edited, original);
    saveProjectToLibrary(window.localStorage, original, [], { makeActive: true });
    expect(window.localStorage.getItem(memoDraftKey(original.id))).not.toBeNull();
    clearSavedMemoDraft(window.localStorage, original);
    expect(restoreMemoDraft(window.localStorage, original).submission).toEqual(edited.submission);
    const failing = { getItem: key => window.localStorage.getItem(key), setItem: () => { throw new DOMException('Storage unavailable'); }, removeItem: key => window.localStorage.removeItem(key) };
    expect(() => saveProjectToLibrary(failing, edited, [], { makeActive: true })).toThrow();
    expect(window.localStorage.getItem(memoDraftKey(original.id))).not.toBeNull();
    saveProjectToLibrary(window.localStorage, edited, [], { makeActive: true });
    expect(window.localStorage.getItem(memoDraftKey(original.id))).toBeNull();
  });

  it('rejects delayed cache writes without replacing the latest draft', () => {
    const original = project();
    const latest = revise(original, 'Latest student memo');
    latest.updatedAt = '2026-10-03T16:00:02.000Z';
    cacheMemoDraft(window.localStorage, latest, original);
    const recoveryBytes = window.localStorage.getItem(memoDraftKey(original.id));
    expect(cacheMemoDraft(window.localStorage, revise(original, 'Delayed older edit'), original)).toBe(false);
    expect(window.localStorage.getItem(memoDraftKey(original.id))).toBe(recoveryBytes);
    expect(restoreMemoDraft(window.localStorage, original).submission.text).toBe(latest.submission.text);
  });

  it('does not replay equal-time or future-dated drafts over a deliberately replaced memo', () => {
    const original = project();
    const edited = revise(original);
    cacheMemoDraft(window.localStorage, edited, original);
    const replaced = revise(original, 'Deliberately imported replacement');
    expect(restoreMemoDraft(window.localStorage, replaced)).toBe(replaced);
    const future = revise(original, 'Future-dated recovery draft');
    future.updatedAt = '2030-01-01T00:00:00.000Z';
    cacheMemoDraft(window.localStorage, future, original);
    expect(restoreMemoDraft(window.localStorage, replaced)).toBe(replaced);
  });

  it('does not rewrite an unchanged memo on map-only changes and clears it after the later full save', () => {
    const original = project();
    const edited = revise(original);
    cacheMemoDraft(window.localStorage, edited, original);
    const recoveryBytes = window.localStorage.getItem(memoDraftKey(original.id));
    const mapOnly = structuredClone(edited);
    mapOnly.viewport = { ...mapOnly.viewport, x: 20 };
    mapOnly.updatedAt = '2026-10-03T16:00:02.000Z';
    expect(cacheMemoDraft(window.localStorage, mapOnly, original)).toBe(true);
    expect(window.localStorage.getItem(memoDraftKey(original.id))).toBe(recoveryBytes);
    clearSavedMemoDraft(window.localStorage, mapOnly);
    expect(window.localStorage.getItem(memoDraftKey(original.id))).toBeNull();
  });

  it('anchors later edits to a newer saved replacement rather than a retained older journal', () => {
    const original = project();
    cacheMemoDraft(window.localStorage, revise(original, 'Older unsaved memo'), original);
    const replaced = revise(original, 'Deliberately saved replacement');
    replaced.updatedAt = '2026-10-03T16:00:02.000Z';
    saveProjectToLibrary(window.localStorage, replaced, [], { makeActive: true });
    expect(window.localStorage.getItem(memoDraftKey(original.id))).not.toBeNull();
    const edited = revise(replaced, 'Newest edit after replacement');
    edited.updatedAt = '2026-10-03T16:00:03.000Z';
    expect(cacheMemoDraft(window.localStorage, edited, replaced)).toBe(true);
    expect(loadDurableProject(window.localStorage, replaced.id).submission.text).toBe(edited.submission.text);
  });

  it('recovers the next edit when a successful full save cannot clear its journal', () => {
    const storage = {
      getItem: key => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: () => { throw new DOMException('Storage cleanup unavailable'); },
    };
    const original = project();
    saveProjectToLibrary(storage, original, [], { makeActive: true });
    const saved = revise(original, 'First saved edit');
    cacheMemoDraft(storage, saved, original);
    saveProjectToLibrary(storage, saved, [], { makeActive: true });
    expect(storage.getItem(memoDraftKey(saved.id))).not.toBeNull();
    const edited = revise(saved, 'Next edit after failed cleanup');
    edited.updatedAt = '2026-10-03T16:00:02.000Z';
    expect(cacheMemoDraft(storage, edited, saved)).toBe(true);
    expect(loadDurableProject(storage, saved.id).submission.text).toBe(edited.submission.text);
  });

  it('never overlays a stale journal on newer full or cloud work', async () => {
    const storage = useAccountStorage('alice', null);
    const original = project();
    saveProjectToLibrary(storage, original, [], { makeActive: true });
    await rememberCloudSave(storage, original.id, 1, serializeProject(original));
    const edited = revise(original);
    cacheMemoDraft(storage, edited, original);
    const newer = revise(original, 'Newer saved memo', 0);
    newer.updatedAt = '2026-10-03T16:00:02.000Z';
    expect(restoreMemoDraft(storage, newer)).toBe(newer);
    const conflict = await reconcileCloudProject(storage, original.id, { project: serializeProject(newer), revision: 2 });
    expect(conflict).toMatchObject({ conflict: true, project: { submission: { text: edited.submission.text } } });
    saveProjectToLibrary(storage, newer, [], { makeActive: true });
    expect(loadDurableProject(storage, original.id).submission.text).toBe(newer.submission.text);
  });

  it('keeps journals separate for accounts and newly created projects', () => {
    const alice = useAccountStorage('alice', null), original = project();
    saveProjectToLibrary(alice, original, [], { makeActive: true });
    const edited = revise(original);
    cacheMemoDraft(alice, edited, original);
    const bob = useAccountStorage('bob', null);
    expect(restoreMemoDraft(bob, original)).toBe(original);
    const another = { ...original, id: 'another-project' };
    expect(restoreMemoDraft(alice, another)).toBe(another);
    const recreated = { ...original, createdAt: '2026-10-03T16:00:03.000Z' };
    expect(restoreMemoDraft(alice, recreated)).toBe(recreated);
    const newMemo = { ...original, submission: { ...original.submission, id: 'another-memo' } };
    expect(restoreMemoDraft(alice, newMemo)).toBe(newMemo);
    // A captured old adapter still writes only to its original account prefix.
    const captured = revise(original, 'Captured account memo');
    captured.updatedAt = '2026-10-03T16:00:02.000Z';
    cacheMemoDraft(alice, captured, original);
    expect(bob.getItem(memoDraftKey(original.id))).toBeNull();
    expect(restoreMemoDraft(alice, original).submission.text).toBe('Captured account memo');
  });

  it.each(['not JSON', JSON.stringify({ version: 1, draft: { updatedAt: 'bad' } })])('leaves malformed recovery bytes untouched', raw => {
    const original = project();
    window.localStorage.setItem(memoDraftKey(original.id), raw);
    expect(restoreMemoDraft(window.localStorage, original)).toBe(original);
    expect(cacheMemoDraft(window.localStorage, revise(original), original)).toBe(false);
    expect(window.localStorage.getItem(memoDraftKey(original.id))).toBe(raw);
  });

  it('rejects mismatched submission IDs and unexpected draft fields', () => {
    const original = project();
    cacheMemoDraft(window.localStorage, revise(original), original);
    const key = memoDraftKey(original.id);
    const value = JSON.parse(window.localStorage.getItem(key));
    value.draft.submission.id = 'not-the-memo';
    window.localStorage.setItem(key, JSON.stringify(value));
    expect(restoreMemoDraft(window.localStorage, original)).toBe(original);
    value.draft.submission.id = original.submission.id;
    value.draft.graph = { nodes: [], edges: [] };
    window.localStorage.setItem(key, JSON.stringify(value));
    expect(restoreMemoDraft(window.localStorage, original)).toBe(original);
  });

  it.each(['CUNY', 'public'])('caches schema-valid %s drafts without weakening the actual restore ceiling', sharingTier => {
    const original = project();
    original.instructor.maxSharingTier = 'public';
    const edited = revise(original);
    edited.sharingTier = sharingTier;
    expect(() => validateProject(edited)).not.toThrow();
    expect(() => cacheMemoDraft(window.localStorage, edited, original)).not.toThrow();
    expect(restoreMemoDraft(window.localStorage, original).sharingTier).toBe(sharingTier);
    const restricted = { ...original, instructor: { ...original.instructor, maxSharingTier: 'course' } };
    expect(restoreMemoDraft(window.localStorage, restricted)).toBe(restricted);
  });
});
