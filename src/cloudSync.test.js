import { beforeEach, expect, test } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createDefaultProject, serializeProject } from './domain.js';
import { saveProjectToLibrary, loadDurableProject, loadProjectLibrary } from './projectLibrary.js';
import { reconcileCloudProject, rememberCloudSave } from './cloudSync.js';
import { useAccountStorage, releaseAccountStorage } from './accountStorage.js';

beforeEach(() => { window.localStorage.clear(); releaseAccountStorage(); Object.defineProperty(crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); });
const project = () => { const value = createDefaultProject(); value.id = 'cloud-test'; value.title = 'Initial map'; return value; };
const put = (storage, value) => saveProjectToLibrary(storage, value, [], { makeActive: true });

test('newer unsynced work survives reopening and can resume only against its original revision', async () => {
  const storage = useAccountStorage('alice', null), original = project();
  put(storage, original); await rememberCloudSave(storage, original.id, 1, serializeProject(original));
  const local = { ...original, title: 'Unsynced work' }; put(storage, local);
  const remote = { project: serializeProject(original), revision: 1 };
  expect(await reconcileCloudProject(storage, original.id, remote)).toMatchObject({ project: { title: 'Unsynced work' }, conflict: false });
  remote.revision = 2; remote.project = serializeProject({ ...original, title: 'Other device work' });
  expect(await reconcileCloudProject(storage, original.id, remote)).toMatchObject({ project: { title: 'Unsynced work' }, conflict: true });
  expect(loadDurableProject(storage, original.id).title).toBe('Unsynced work');
});
test('a clean cache accepts the current server revision, including a recovered response after a successful save', async () => {
  const storage = useAccountStorage('alice', null), original = project();
  put(storage, original); await rememberCloudSave(storage, original.id, 1, serializeProject(original));
  const remote = { project: serializeProject({ ...original, title: 'Server update' }), revision: 2 };
  expect(await reconcileCloudProject(storage, original.id, remote)).toMatchObject({ project: { title: 'Server update' }, conflict: false });
  put(storage, JSON.parse(remote.project));
  expect((await reconcileCloudProject(storage, original.id, remote)).conflict).toBe(false);
});
test('accounts have separate enumerable project and recovery caches', async () => {
  const alice = useAccountStorage('alice', null), original = project(); put(alice, original);
  const bob = useAccountStorage('bob', null);
  expect(loadDurableProject(bob, original.id)).toBeNull(); expect(loadProjectLibrary(bob, null, false)).toEqual([]);
  expect(bob.length).toBe(0); expect(alice.length).toBeGreaterThan(0);
  expect((await reconcileCloudProject(alice, original.id, null)).project.title).toBe('Initial map');
});
