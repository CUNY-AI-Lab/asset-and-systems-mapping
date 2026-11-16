import { parseProject, serializeProject, CLAIM_STATES, PROJECT_LIMITS } from './domain.js';
import { STORAGE_KEY, LEGACY_STORAGE_KEYS, PROJECT_BODY_PREFIX, PROJECT_LIBRARY_KEY, LINK_STORAGE_KEY, LINKS_STORAGE_KEY, summarizeProject } from './projectLibrary.js';
import { MEMO_DRAFT_PREFIX, restoreMemoDraft } from './memoDraft.js';
import { projectDigest, serializeCloudProject } from './cloudSync.js';
import { readRelationshipDraft, relationshipDraftKey } from './relationshipDraft.js';
import { relationshipProcessIssue } from '../shared/relationship-process.js';

export const RECOVERY_PREFIX = 'systems-mapping.browser-recovery.v1.';
export const MAX_RECOVERY_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const deviceKeys = ['systems-mapping.theme', 'systems-mapping.sidebar-width', 'systems-mapping.map-tools-width'];
const exactKeys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS, PROJECT_LIBRARY_KEY, LINK_STORAGE_KEY, LINKS_STORAGE_KEY, 'account-navigation', 'systems-mapping.theme'];
const families = [
  /^systems-mapping-studio\.project-body\.v1\.[0-9a-f]{4,800}$/,
  /^systems-mapping\.deleted-project\.[0-9a-f-]{36}$/,
  /^systems-mapping-studio\.recovery\.[0-9]{1,16}$/,
];
const projectId = id => Boolean(id.trim()) && id.length <= 200;
function rawProjectKey(key) {
  for (const prefix of ['systems-mapping.cloud-sync.', 'systems-mapping.pending-guidance.']) {
    if (key.startsWith(prefix)) return projectId(key.slice(prefix.length));
  }
  const guidance = /^systems-mapping\.guidance\.[A-Za-z0-9_-]{1,100}\./.exec(key);
  return Boolean(guidance && projectId(key.slice(guidance[0].length)));
}
function encodedProjectKey(key, prefix, suffix = '') {
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return false;
  const encoded = key.slice(prefix.length, suffix ? -suffix.length : undefined);
  // A valid imported project ID has at most 200 UTF-16 code units. A BMP
  // character can expand to nine URI characters; punctuation can stay literal.
  if (!encoded || encoded.length > 1800) return false;
  try {
    const id = decodeURIComponent(encoded);
    return projectId(id) && encodeURIComponent(id) === encoded;
  } catch { return false; }
}
const draftKey = key => encodedProjectKey(key, MEMO_DRAFT_PREFIX)
  || ['micro', 'meso', 'exosphere', 'macrosphere'].some(scale => encodedProjectKey(key, 'systems-mapping.relationship-draft.v1.', `.${scale}`));
export const allowedRecoveryKey = (scope, key) => typeof key === 'string' && (scope === 'device'
  ? deviceKeys.includes(key) : scope === 'account' && (exactKeys.includes(key) || draftKey(key) || rawProjectKey(key) || families.some(pattern => pattern.test(key))));
const failure = () => new Error('This browser backup could not be read safely. The original copies remain unchanged.');
export const recoveryNonce = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
export async function recoveryFingerprint(raw) {
  const bytes = new TextEncoder().encode(raw);
  if (bytes.length > MAX_RECOVERY_BYTES) throw failure();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Independent of the editor's global storage adapter: creating this view has no
// autosave, account-navigation, theme, cloud-save or pending-guidance effects.
export function recoveryStorage(rawStorage, cacheKey) {
  if (!/^[0-9a-f-]{36}$/.test(cacheKey)) throw failure();
  const prefix = `systems-mapping.account.${cacheKey}.`;
  const keys = () => Array.from({ length: rawStorage.length }, (_, index) => rawStorage.key(index)).filter(key => key?.startsWith(prefix));
  return { prefix, cacheKey, get length() { return keys().length; }, key: index => keys()[index]?.slice(prefix.length) ?? null,
    getItem: key => rawStorage.getItem(prefix + key), setItem: (key, value) => rawStorage.setItem(prefix + key, value), removeItem: key => rawStorage.removeItem(prefix + key) };
}

export function parseBrowserSnapshot(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_RECOVERY_BYTES || new TextEncoder().encode(raw).length > MAX_RECOVERY_BYTES) throw failure();
  let snapshot;
  try { snapshot = JSON.parse(raw); } catch { throw failure(); }
  if (!snapshot || Object.keys(snapshot).sort().join(',') !== 'entries,version' || snapshot.version !== 1
    || !Array.isArray(snapshot.entries) || snapshot.entries.length > MAX_ENTRIES) throw failure();
  const seen = new Set();
  for (const entry of snapshot.entries) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'key,scope,value' || !allowedRecoveryKey(entry.scope, entry.key)
      || typeof entry.value !== 'string' || entry.value.length > 2 * 1024 * 1024 || seen.has(`${entry.scope}:${entry.key}`)) throw failure();
    seen.add(`${entry.scope}:${entry.key}`);
  }
  return snapshot;
}

export function captureBrowserSnapshot(storage, deviceStorage) {
  const capture = () => {
    const entries = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (allowedRecoveryKey('account', key)) {
        const value = storage.getItem(key);
        if (value !== null) entries.push({ scope: 'account', key, value });
      }
    }
    for (const key of deviceKeys) {
      const value = deviceStorage.getItem(key);
      if (value !== null) entries.push({ scope: 'device', key, value });
    }
    return JSON.stringify({ version: 1, entries: entries.sort((a, b) => `${a.scope}:${a.key}`.localeCompare(`${b.scope}:${b.key}`)) });
  };
  const raw = capture();
  parseBrowserSnapshot(raw);
  // Refuse a moving snapshot; never flush or write the source editor's cache.
  if (capture() !== raw) throw new Error('The original workspace is still saving. Wait for it to finish, then try again.');
  return raw;
}

export async function reviewBrowserSnapshot(raw, storage, deviceStorage) {
  const snapshot = parseBrowserSnapshot(raw);
  const entries = new Map(snapshot.entries.filter(entry => entry.scope === 'account').map(entry => [entry.key, entry.value]));
  const incoming = { getItem: key => entries.get(key) ?? null };
  const projects = [], seen = new Set(), unreadable = [];
  const add = async (serialized, key, variant) => {
    const project = parseProject(serialized);
    if (key.startsWith(PROJECT_BODY_PREFIX) && summarizeProject(project).storageKey !== key) throw failure();
    const fingerprint = await projectDigest(serializeProject(project));
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    projects.push({ project, fingerprint, key, variant });
    const restored = restoreMemoDraft(incoming, project);
    const restoredFingerprint = await projectDigest(serializeProject(restored));
    if (!seen.has(restoredFingerprint)) {
      seen.add(restoredFingerprint);
      projects.push({ project: restored, fingerprint: restoredFingerprint, key, variant: 'Memo draft with matching base' });
    }
  };
  for (const entry of snapshot.entries) {
    if (entry.scope !== 'account') continue;
    try {
      if ([STORAGE_KEY, ...LEGACY_STORAGE_KEYS].includes(entry.key) || entry.key.startsWith(PROJECT_BODY_PREFIX)) await add(entry.value, entry.key, 'Browser copy');
      else if (entry.key.startsWith('systems-mapping.deleted-project.')) {
        const deleted = JSON.parse(entry.value);
        if (deleted.version !== 1) throw failure();
        await add(deleted.project, entry.key, 'Earlier recovery');
        if (deleted.remoteProject) await add(deleted.remoteProject, entry.key, 'Earlier account backup');
      } else if (entry.key.startsWith('systems-mapping-studio.recovery.')) await add(entry.value, entry.key, 'Earlier recovery');
    } catch { unreadable.push(entry.key); }
  }
  const comparisons = snapshot.entries.map(entry => {
    const current = (entry.scope === 'account' ? storage : deviceStorage).getItem(entry.key);
    return { ...entry, current, status: current === null ? 'missing' : current === entry.value ? 'same' : 'conflict' };
  });
  return { snapshot, projects, unreadable, comparisons, archived: snapshot.entries.filter(entry =>
    entry.key.startsWith(MEMO_DRAFT_PREFIX) || /pending-guidance|guidance\.|relationship-draft|\.link[s]?\./.test(entry.key)).length };
}

export async function stageBrowserSnapshot(raw, storage, deviceStorage, { assertCurrent = () => {} } = {}) {
  const review = await reviewBrowserSnapshot(raw, storage, deviceStorage);
  const fingerprint = await recoveryFingerprint(raw);
  const conflicts = review.comparisons.filter(entry => entry.status === 'conflict').map(({ key, scope, current }) => ({ key, scope, value: current }));
  // The destination may have changed since an earlier import of the same source.
  // Include its conflicting bytes in the identity so a later restore never
  // overwrites a version that was omitted from the immutable recovery record.
  const key = RECOVERY_PREFIX + fingerprint + '.' + await recoveryFingerprint(JSON.stringify(conflicts));
  const previous = storage.getItem(key);
  assertCurrent();
  if (previous !== null) {
    let record;
    try { record = JSON.parse(previous); } catch { throw failure(); }
    if (!record || Object.keys(record).sort().join(',') !== 'conflicts,raw,receivedAt,version' || record.version !== 1
      || typeof record.receivedAt !== 'string' || !Number.isFinite(Date.parse(record.receivedAt))
      || record.raw !== raw || JSON.stringify(record.conflicts) !== JSON.stringify(conflicts)) throw failure();
    return { key, review, fingerprint }; // Verified immutable, content-addressed recovery.
  }
  const record = JSON.stringify({ version: 1, receivedAt: new Date().toISOString(), raw, conflicts });
  storage.setItem(key, record); // localStorage writes are atomic, including quota failures.
  if (storage.getItem(key) !== record) throw new Error('The backup could not be saved on this device. Download it before closing this page.');
  return { key, review, fingerprint };
}

export function stagedBrowserSnapshots(storage) {
  const found = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(RECOVERY_PREFIX)) continue;
    try {
      const entry = JSON.parse(storage.getItem(key));
      if (entry.version === 1 && typeof entry.receivedAt === 'string') { parseBrowserSnapshot(entry.raw); found.push({ key, ...entry }); }
    } catch { /* Keep unreadable recovery bytes untouched. */ }
  }
  return found.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function applyRecoveryPreference(entry, storage, deviceStorage) {
  const { key, value, current, scope } = entry;
  if (!allowedRecoveryKey(scope, key) || !(deviceKeys.includes(key) || key === 'account-navigation')) throw failure();
  if (key === 'systems-mapping.theme' && !['light', 'dark'].includes(value)) throw failure();
  if (key.endsWith('-width') && (!/^\d{3}$/.test(value) || Number(value) < (key.includes('sidebar') ? 200 : 240) || Number(value) > (key.includes('sidebar') ? 520 : 480))) throw failure();
  if (key === 'account-navigation') {
    const nav = JSON.parse(value);
    if (!nav || Object.keys(nav).sort().join(',') !== 'open,tab' || typeof nav.open !== 'boolean' || !['overview', 'instructor'].includes(nav.tab)) throw failure();
  }
  const target = scope === 'account' ? storage : deviceStorage;
  if (target.getItem(key) !== current) throw new Error('This preference changed during review. Read the backup again before replacing it.');
  target.setItem(key, value);
}

export function recoverableRelationshipDrafts(raw, project) {
  const entries = new Map(parseBrowserSnapshot(raw).entries.filter(entry => entry.scope === 'account').map(entry => [entry.key, entry.value]));
  const source = { getItem: key => entries.get(key) ?? null };
  const nodes = new Set(project.graph.nodes.filter(node => !['rejected', 'removed'].includes(node.status) && node.claimState !== 'retired').map(node => node.id));
  const edges = new Set(project.graph.edges.filter(edge => !['rejected', 'removed'].includes(edge.status) && edge.claimState !== 'retired' && edge.scale === 'meso').map(edge => edge.id));
  const ids = new Set([...project.graph.nodes, ...project.graph.edges].map(item => item.id));
  return ['micro', 'meso', 'exosphere', 'macrosphere'].flatMap(scale => {
    const draft = readRelationshipDraft(source, { ...project, activeScale: scale });
    if (!draft || Object.keys(draft).some(key => !['id', 'source', 'target', 'verb', 'evidence', 'claimState', 'relationshipProcess', 'relationshipIds'].includes(key))
      || !/^[A-Za-z0-9_-]{1,200}$/.test(draft.id) || ids.has(draft.id)
      || draft.source && !nodes.has(draft.source) || draft.target && !nodes.has(draft.target)
      || typeof draft.evidence !== 'string' || draft.evidence.length > PROJECT_LIMITS.noteText || !CLAIM_STATES.includes(draft.claimState)
      || draft.relationshipProcess !== undefined && relationshipProcessIssue(draft.relationshipProcess)
      || draft.relationshipIds !== undefined && (!['exosphere', 'macrosphere'].includes(scale) || !Array.isArray(draft.relationshipIds)
        || draft.relationshipIds.length > 24 || new Set(draft.relationshipIds).size !== draft.relationshipIds.length || draft.relationshipIds.some(id => !edges.has(id)))) return [];
    return [{ scale, draft }];
  });
}

export function restoreRecoveryRelationships(raw, original, recovered, storage) {
  // This is only for the newly created copy, never an existing original map.
  if (!recovered.id.startsWith('recovered_') || recovered.id === original.id || recovered.createdAt !== original.createdAt
    || serializeCloudProject(recovered) !== serializeCloudProject({ ...original, id: recovered.id, title: recovered.title, sharingTier: recovered.sharingTier })) throw failure();
  const writes = recoverableRelationshipDrafts(raw, original).map(({ scale, draft }) => ({
    key: relationshipDraftKey({ ...recovered, activeScale: scale }),
    value: JSON.stringify({ version: 1, projectId: recovered.id, createdAt: recovered.createdAt, scale, draft }),
  }));
  if (writes.some(({ key, value }) => storage.getItem(key) !== null && storage.getItem(key) !== value)) throw new Error('The new map already has a different relationship draft. Both copies are preserved.');
  const applied = [];
  try {
    for (const entry of writes) {
      if (storage.getItem(entry.key) === entry.value) continue;
      storage.setItem(entry.key, entry.value); applied.push(entry);
      if (storage.getItem(entry.key) !== entry.value) throw failure();
    }
  } catch (error) {
    for (const { key, value } of applied) if (storage.getItem(key) === value) { try { storage.removeItem(key); } catch { /* Original backup remains intact. */ } }
    throw error;
  }
  return writes.length;
}
