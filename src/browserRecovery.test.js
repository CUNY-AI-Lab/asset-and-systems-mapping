import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createDefaultProject, serializeProject, stableId } from './domain.js';
import { cacheMemoDraft, memoDraftKey } from './memoDraft.js';
import { STORAGE_KEY, summarizeProject, saveProjectToLibrary, rememberStoredLink } from './projectLibrary.js';
import { serializeCloudProject, rememberCloudSave } from './cloudSync.js';
import { preserveDeletedProject } from './projectRecovery.js';
import { writeGuidanceCache } from './guidanceCache.js';
import { durableGuidance } from './durableGuidance.js';
import { allowedRecoveryKey, captureBrowserSnapshot, parseBrowserSnapshot, recoveryStorage, stageBrowserSnapshot, stagedBrowserSnapshots, reviewBrowserSnapshot, applyRecoveryPreference, recoverableRelationshipDrafts, restoreRecoveryRelationships, RECOVERY_PREFIX } from './browserRecovery.js';
import { writeRelationshipDraft, readRelationshipDraft, relationshipDraftKey } from './relationshipDraft.js';

const memory = () => {
  const map = new Map();
  return { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null,
    setItem: vi.fn((k, v) => map.set(k, String(v))), removeItem: k => map.delete(k) };
};
const key = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
beforeEach(() => { Object.defineProperty(crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());
test('source capture is read-only, account-scoped and excludes sibling apps and other recovery archives', () => {
  const raw = memory(), source = recoveryStorage(raw, key), project = createDefaultProject();
  source.setItem(STORAGE_KEY, serializeProject(project));
  source.setItem('systems-mapping.pending-guidance.' + project.id, '{"requestToken":"fixture"}');
  source.setItem(RECOVERY_PREFIX + 'a'.repeat(64), 'old backup');
  raw.setItem('systems-mapping.account.bob.' + STORAGE_KEY, 'other account');
  raw.setItem('stem-private-draft', 'another app');
  raw.setItem('systems-mapping.theme', 'dark');
  raw.setItem(STORAGE_KEY, 'unscoped legacy data');
  raw.setItem.mockClear();
  const snapshot = parseBrowserSnapshot(captureBrowserSnapshot(source, raw));
  expect(snapshot.entries).toHaveLength(3);
  expect(JSON.stringify(snapshot)).not.toMatch(/other account|another app|old backup|unscoped legacy/);
  expect(raw.setItem).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
test('a changing source snapshot is rejected without flushing or changing its tab', () => {
  const raw = memory(), source = recoveryStorage(raw, key);
  source.setItem(STORAGE_KEY, 'first');
  const get = source.getItem;
  let count = 0;
  source.getItem = name => name === STORAGE_KEY && ++count > 1 ? 'later' : get(name);
  raw.setItem.mockClear();
  expect(() => captureBrowserSnapshot(source, raw)).toThrow(/still saving/);
  expect(raw.setItem).not.toHaveBeenCalled();
});
test.each(["memo!~*'()draft", '学生'.repeat(100), 'draft / with % punctuation'])('preserves canonical memo and relationship journals for imported project ID %s', id => {
  const source = memory(), original = createDefaultProject(); original.id = id;
  // These are supported imported IDs, even if a cloud save requires a new ID.
  serializeProject(original);
  cacheMemoDraft(source, original);
  writeRelationshipDraft(source, original, { id: 'edge_draft', source: '', target: '', verb: 'Saved browser wording', evidence: '', claimState: 'research lead' });
  const raw = captureBrowserSnapshot(source, memory()), snapshot = parseBrowserSnapshot(raw);
  expect(snapshot.entries.map(entry => entry.key).sort()).toEqual([memoDraftKey(id), relationshipDraftKey(original)].sort());
  expect(snapshot.entries.find(entry => entry.key === memoDraftKey(id)).value).toBe(source.getItem(memoDraftKey(id)));
  expect(recoverableRelationshipDrafts(raw, original)[0].draft.verb).toBe('Saved browser wording');
});
test.each(['%21', '%2f', '%', '%C0%AF', '%20', 'x'.repeat(201), encodeURIComponent('学'.repeat(201))])('rejects noncanonical or out-of-bounds draft ID suffix %s', suffix => {
  expect(allowedRecoveryKey('account', 'systems-mapping-studio.memo-draft.v1.' + suffix)).toBe(false);
  expect(allowedRecoveryKey('account', 'systems-mapping.relationship-draft.v1.' + suffix + '.micro')).toBe(false);
});
test.each(["map!~*'() draft/%", '学'.repeat(200)])('captures every current storage writer for imported ID %s without replaying work', async id => {
  const source = memory(), project = createDefaultProject(); project.id = id;
  saveProjectToLibrary(source, project, [], { makeActive: true });
  saveProjectToLibrary(source, { ...project, id: 'other' }, [], { makeActive: true });
  cacheMemoDraft(source, project);
  writeRelationshipDraft(source, project, { id: 'edge_draft', source: '', target: '', verb: 'Draft wording', evidence: '', claimState: 'research lead' });
  await rememberCloudSave(source, id, 1, serializeProject(project));
  writeGuidanceCache(source, id, 'request-fixture', { evaluation: { id: 'fixture', expiresAt: new Date(Date.now() + 60000).toISOString() } });
  const controller = new AbortController(); controller.abort();
  const request = vi.fn();
  await expect(durableGuidance(request, message => new Error(message), 'memo', {}, { signal: controller.signal, storage: source, projectId: id, requestKey: 'fixture' })).rejects.toThrow();
  preserveDeletedProject(source, project);
  rememberStoredLink(source, { projectId: id, token: 'fixture-private-link', revision: 1 });
  source.setItem('systems-mapping-studio.recovery.1234', 'unreadable retained bytes');
  source.setItem('account-navigation', JSON.stringify({ open: true, tab: 'overview' }));
  source.setItem('systems-mapping.theme', 'dark');
  const raw = captureBrowserSnapshot(source, memory());
  expect(parseBrowserSnapshot(raw).entries.map(entry => entry.key).sort()).toEqual(Array.from({ length: source.length }, (_, i) => source.key(i)).sort());
  const destination = memory(); await stageBrowserSnapshot(raw, destination, memory());
  expect(destination.getItem('systems-mapping.pending-guidance.' + id)).toBeNull();
  expect(request).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
test.each(['', ' ', 'x'.repeat(201)])('rejects out-of-domain raw ID suffix %j', id => {
  for (const prefix of ['systems-mapping.cloud-sync.', 'systems-mapping.pending-guidance.', 'systems-mapping.guidance.memo-workspace-exo-evidence-v26.']) {
    expect(allowedRecoveryKey('account', prefix + id)).toBe(false);
  }
});
test('project parsing and memo fingerprints preserve base, pending memo and divergent destination copies', async () => {
  const source = memory(), destination = memory(), device = memory();
  const project = createDefaultProject(); project.id = 'fixture'; project.createdAt = project.updatedAt = '2026-11-16T12:00:00.000Z';
  source.setItem(STORAGE_KEY, serializeProject(project));
  const draft = structuredClone(project); draft.submission.text = 'Private pending source memo';
  draft.submission.revision = 2; draft.submission.fingerprint = stableId('src', draft.submission.text); draft.updatedAt = '2026-11-16T12:00:01.000Z';
  cacheMemoDraft(source, draft, project);
  source.setItem('systems-mapping.pending-guidance.fixture', '{"jobId":"retained-only"}');
  source.setItem('systems-mapping.relationship-draft.v1.fixture.micro', '{"draft":{"verb":"draft wording"}}');
  source.setItem('systems-mapping-studio.links.v2', '{"version":2,"links":[{"token":"private-bearer"}]}');
  destination.setItem(STORAGE_KEY, serializeProject({ ...project, title: 'Destination map' }));
  const originalDestination = destination.getItem(STORAGE_KEY);
  const raw = captureBrowserSnapshot(source, device);
  const result = await stageBrowserSnapshot(raw, destination, device);
  expect(result.review.projects.map(item => item.variant)).toEqual(['Browser copy', 'Memo draft with matching base']);
  expect(result.review.projects[1].project.submission.text).toBe(draft.submission.text);
  expect(result.review.comparisons.filter(item => item.status === 'conflict')).toHaveLength(1);
  expect(destination.getItem(STORAGE_KEY)).toBe(originalDestination);
  expect(destination.getItem('systems-mapping.pending-guidance.fixture')).toBeNull();
  expect(destination.getItem(memoDraftKey(project.id))).toBeNull();
  const saved = stagedBrowserSnapshots(destination)[0];
  expect(saved.raw).toBe(raw); expect(saved.conflicts[0].value).toBe(originalDestination);
  expect(fetch).not.toHaveBeenCalled();
  await stageBrowserSnapshot(raw, destination, device);
  expect(stagedBrowserSnapshots(destination)).toHaveLength(1);
  destination.setItem(STORAGE_KEY, serializeProject({ ...project, title: 'Later destination edit' }));
  await stageBrowserSnapshot(raw, destination, device);
  expect(stagedBrowserSnapshots(destination)).toHaveLength(2);
});
test('mismatched draft identity and malformed map bytes remain archived without becoming maps', async () => {
  const source = memory(), project = createDefaultProject(); project.id = 'fixture';
  source.setItem(STORAGE_KEY, serializeProject(project));
  source.setItem(memoDraftKey(project.id), JSON.stringify({ version: 1, projectId: 'different', draft: { title: 'wrong draft' } }));
  source.setItem(summarizeProject({ ...project, id: 'different' }).storageKey, serializeProject(project));
  source.setItem('systems-mapping-studio.recovery.1234', '{invalid json');
  const raw = captureBrowserSnapshot(source, memory());
  const result = await reviewBrowserSnapshot(raw, memory(), memory());
  expect(result.projects).toHaveLength(1); expect(result.unreadable).toHaveLength(2);
  expect(result.snapshot.entries).toHaveLength(4);
});
test('quota failure never changes source or existing destination and the received bytes remain exportable', async () => {
  const source = memory(), destination = memory(), device = memory();
  source.setItem(STORAGE_KEY, serializeProject(createDefaultProject()));
  destination.setItem('systems-mapping.theme', 'light');
  const raw = captureBrowserSnapshot(source, device), before = [...Array(destination.length)].map((_, i) => [destination.key(i), destination.getItem(destination.key(i))]);
  destination.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  await expect(stageBrowserSnapshot(raw, destination, device)).rejects.toThrow('Full');
  expect([...Array(destination.length)].map((_, i) => [destination.key(i), destination.getItem(destination.key(i))])).toEqual(before);
  expect(parseBrowserSnapshot(raw).entries).toHaveLength(1);
});
test.each(['', 'broken JSON', 'wrong raw', 'wrong conflict'])('refuses a damaged existing archive (%s) without overwriting it or destination conflicts', async damage => {
  const destination = memory(), device = memory(); device.setItem('systems-mapping.theme', 'light');
  const raw = JSON.stringify({ version: 1, entries: [{ scope: 'device', key: 'systems-mapping.theme', value: 'dark' }] });
  const { key } = await stageBrowserSnapshot(raw, destination, device);
  const record = JSON.parse(destination.getItem(key));
  const corrupted = damage === 'wrong raw' ? JSON.stringify({ ...record, raw: '{}' }) : damage === 'wrong conflict'
    ? JSON.stringify({ ...record, conflicts: [] }) : damage;
  destination.setItem(key, corrupted); destination.setItem.mockClear();
  await expect(stageBrowserSnapshot(raw, destination, device)).rejects.toThrow();
  expect(destination.getItem(key)).toBe(corrupted); expect(destination.setItem).not.toHaveBeenCalled();
  expect(device.getItem('systems-mapping.theme')).toBe('light');
  expect(parseBrowserSnapshot(raw).entries[0].value).toBe('dark');
});
test.each([
  { scope: 'account', key: '__proto__', value: 'x' },
  { scope: 'device', key: STORAGE_KEY, value: 'x' },
  { scope: 'account', key: 'systems-mapping.pending-guidance.x', value: 'x'.repeat(2 * 1024 * 1024 + 1) },
])('rejects forbidden or oversized entries', entry => {
  expect(() => parseBrowserSnapshot(JSON.stringify({ version: 1, entries: [entry] }))).toThrow();
});
test('preference restore is explicit, validated and refuses changes made during review', () => {
  const device = memory(), account = memory(); device.setItem('systems-mapping.theme', 'light');
  const entry = { scope: 'device', key: 'systems-mapping.theme', current: 'light', value: 'dark' };
  applyRecoveryPreference(entry, account, device); expect(device.getItem(entry.key)).toBe('dark');
  expect(() => applyRecoveryPreference(entry, account, device)).toThrow(/changed during review/);
  expect(() => applyRecoveryPreference({ ...entry, current: 'dark', value: 'script' }, account, device)).toThrow();
  expect(() => applyRecoveryPreference({ scope: 'account', key: 'systems-mapping.pending-guidance.x', value: '{}', current: null }, account, device)).toThrow();
});
test('relationship drafts restore only on an explicit new-copy action and preserve destination conflicts', () => {
  const original = createDefaultProject(), source = memory(), destination = memory();
  const draft = { id: 'edge_pending', source: '', target: '', verb: 'unfinished wording', evidence: '', claimState: 'research lead', relationshipProcess: { direction: 'not yet known' } };
  writeRelationshipDraft(source, original, draft);
  const raw = captureBrowserSnapshot(source, memory());
  const recovered = JSON.parse(serializeCloudProject({ ...original, id: 'recovered_fixture' }));
  expect(recoverableRelationshipDrafts(raw, original)).toHaveLength(1);
  expect(readRelationshipDraft(destination, recovered)).toBeNull();
  expect(() => restoreRecoveryRelationships(raw, original, original, destination)).toThrow();
  expect(restoreRecoveryRelationships(raw, original, recovered, destination)).toBe(1);
  expect(readRelationshipDraft(destination, recovered)).toEqual(draft);
  const later = { ...draft, verb: 'Later destination wording' };
  writeRelationshipDraft(destination, recovered, later);
  expect(() => restoreRecoveryRelationships(raw, original, recovered, destination)).toThrow(/different relationship draft/);
  expect(readRelationshipDraft(destination, recovered)).toEqual(later);
  expect(readRelationshipDraft(source, original)).toEqual(draft);
  expect(fetch).not.toHaveBeenCalled();
});
test('stale relationships and malformed process fields stay archival and partial quota failure rolls back new journals', () => {
  const original = createDefaultProject(), source = memory(), destination = memory();
  const draft = { id: 'edge_pending', source: '', target: '', verb: '', evidence: '', claimState: 'research lead' };
  writeRelationshipDraft(source, original, { ...draft, source: 'missing-node' });
  expect(recoverableRelationshipDrafts(captureBrowserSnapshot(source, memory()), original)).toEqual([]);
  writeRelationshipDraft(source, original, { ...draft, relationshipProcess: { direction: 123 } });
  expect(recoverableRelationshipDrafts(captureBrowserSnapshot(source, memory()), original)).toEqual([]);
  writeRelationshipDraft(source, original, draft);
  writeRelationshipDraft(source, { ...original, activeScale: 'meso' }, draft);
  const raw = captureBrowserSnapshot(source, memory()), recovered = { ...original, id: 'recovered_fixture' };
  const set = destination.setItem;
  destination.setItem = (key, value) => { if (key.endsWith('.meso')) throw new Error('Full'); set(key, value); };
  expect(() => restoreRecoveryRelationships(raw, original, recovered, destination)).toThrow('Full');
  expect(destination.getItem(relationshipDraftKey(recovered))).toBeNull();
  expect(source.length).toBe(2);
});
