import { afterEach, expect, it, vi } from 'vitest';
import { parseProject, stableId } from './domain.js';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';
import { deletedProjects, forgetDeletedProject, preserveDeletedProject } from './projectRecovery.js';
import { loadDurableProject, loadProjectLibrary, PROJECT_LIBRARY_KEY, removeLibraryProject, saveProjectToLibrary } from './projectLibrary.js';
import { releaseAccountStorage, useAccountStorage } from './accountStorage.js';

afterEach(()=>{releaseAccountStorage();window.localStorage.clear();vi.restoreAllMocks();});
it('keeps both divergent full copies recoverable after removal and reload, isolated by account',()=>{
  const storage=useAccountStorage('synthetic-a',null),project=buildEastHarlemDisabilityProject();
  project.reflection='Current private notes';project.levelProgress.micro.reflection='Earlier notes';
  const remote=structuredClone(project);remote.submission.text='Different account memo';remote.submission.fingerprint=stableId('src',remote.submission.text);
  saveProjectToLibrary(storage,project,[],{makeActive:true});
  const entry=preserveDeletedProject(storage,project,remote);
  removeLibraryProject(storage,project.id);
  expect(loadDurableProject(storage,project.id)).toBeNull();
  expect(loadProjectLibrary(storage,null,false)).toEqual([]);
  const reopened=useAccountStorage('synthetic-a',null),[recovery]=deletedProjects(reopened);
  expect(recovery.key).toBe(entry.key);
  const restored=parseProject(recovery.project);
  expect(restored.graph).toEqual(project.graph);expect(restored.reflection).toBe(project.reflection);expect(restored.levelProgress).toEqual(project.levelProgress);expect(restored.submission.text).toBe(project.submission.text);
  expect(parseProject(recovery.remoteProject).submission.text).toBe(remote.submission.text);
  expect(deletedProjects(useAccountStorage('synthetic-b',null))).toEqual([]);
  saveProjectToLibrary(reopened,restored,[],{makeActive:true});
  expect(loadDurableProject(reopened,project.id).graph).toEqual(project.graph);
  forgetDeletedProject(reopened,entry.key);expect(deletedProjects(reopened)).toEqual([]);
});
it('stops before deletion when recovery storage cannot be verified',()=>{
  const storage=useAccountStorage('synthetic-a',null),project=buildEastHarlemDisabilityProject();
  saveProjectToLibrary(storage,project,[],{makeActive:true});
  const faulty={...storage,setItem(){throw new DOMException('Quota exceeded','QuotaExceededError');}};
  expect(()=>preserveDeletedProject(faulty,project)).toThrow('Quota exceeded');
  expect(loadDurableProject(storage,project.id).graph).toEqual(project.graph);
});
it('keeps a verified recovery and original project after an index-write failure',()=>{
  const storage=useAccountStorage('synthetic-a',null),project=buildEastHarlemDisabilityProject();
  saveProjectToLibrary(storage,project,[],{makeActive:true});preserveDeletedProject(storage,project);
  const faulty={...storage,setItem(key,value){if(key===PROJECT_LIBRARY_KEY)throw Error('Synthetic index failure');storage.setItem(key,value);}};
  expect(()=>removeLibraryProject(faulty,project.id)).toThrow('Synthetic index failure');
  expect(loadDurableProject(storage,project.id).graph).toEqual(project.graph);expect(deletedProjects(storage)).toHaveLength(1);
});
