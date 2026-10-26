import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultProject, parseProject, serializeProject } from './domain.js';
import {
  LINKS_STORAGE_KEY,
  LINK_STORAGE_KEY,
  PROJECT_LIBRARY_KEY,
  PROJECT_BODY_PREFIX,
  STORAGE_KEY,
  forgetStoredLink,
  loadLibraryProject,
  loadProjectLibrary,
  loadStoredLink,
  mirrorActiveLink,
  rememberStoredLink,
  saveProjectToLibrary,
} from './projectLibrary.js';

function namedProject(id, title) {
  const project = createDefaultProject();
  project.id = id;
  project.title = title;
  project.submission.text = `${title} memo`;
  return project;
}

class TestStorage {
  constructor() {
    this.values = new Map();
    this.failKey = null;
  }

  get length() { return this.values.size; }

  key(index) { return [...this.values.keys()][index] ?? null; }

  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }

  setItem(key, value) {
    if (key === this.failKey) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.values.set(key, String(value));
  }

  removeItem(key) { this.values.delete(key); }
}

class QuotaStorage extends TestStorage {
  constructor(limit) {
    super();
    this.limit = limit;
  }

  setItem(key, value) {
    const next = new Map(this.values);
    next.set(key, String(value));
    const size = [...next].reduce((total, [entryKey, entryValue]) => total + entryKey.length + entryValue.length, 0);
    if (size > this.limit) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.values = next;
  }
}

describe('local project library', () => {
  beforeEach(() => window.localStorage.clear());

  it.each([false, true])('preserves the full displaced same-ID version across reload (inactive target: %s)', inactive => {
    const storage = new TestStorage();
    const current = namedProject('same-id', 'Current work');
    current.reflection = 'NEW current notes';
    current.levelProgress.micro.reflection = 'NEW archived notes';
    let records = saveProjectToLibrary(storage, current, [], { makeActive: true });
    records = saveProjectToLibrary(storage, current, records);
    if (inactive) records = saveProjectToLibrary(storage, namedProject('other-id', 'Other work'), records, { makeActive: true });
    const imported = structuredClone(current);
    imported.submission.text = 'OLD memo';
    imported.reflection = 'OLD notes';
    records = saveProjectToLibrary(storage, imported, records, { makeActive: true, preserveReplaced: true });
    const active = parseProject(storage.getItem(STORAGE_KEY));
    expect(active.submission.text).toBe('OLD memo');
    const reloaded = loadProjectLibrary(storage, active, true);
    const recoveryRecord = reloaded.find(record => record.id.startsWith('recovery_'));
    expect(recoveryRecord).toBeDefined();
    const recovery = loadLibraryProject(storage, recoveryRecord);
    const { id, exportedAt, ...body } = recovery;
    const { id: priorId, exportedAt: priorExport, ...prior } = parseProject(serializeProject(current));
    expect(body).toEqual(prior);
    records = saveProjectToLibrary(storage, recovery, reloaded, { makeActive: true });
    expect(parseProject(storage.getItem(STORAGE_KEY)).reflection).toBe('NEW current notes');
    const importedRecord = loadProjectLibrary(storage, recovery, true).find(record => record.id === imported.id);
    expect(loadLibraryProject(storage, importedRecord).submission.text).toBe('OLD memo');
  });

  it.each(['recovery', 'index', 'active'])('leaves the old project intact when import fails at %s', failure => {
    const storage = new TestStorage();
    const current = namedProject('same-id', 'Unsynced latest work');
    let records = saveProjectToLibrary(storage, current, [], { makeActive: true });
    records = saveProjectToLibrary(storage, current, records);
    const before = new Map(storage.values);
    const write = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if ((failure === 'recovery' && key.startsWith(PROJECT_BODY_PREFIX) && !before.has(key))
        || (failure === 'index' && key === PROJECT_LIBRARY_KEY)
        || (failure === 'active' && key === STORAGE_KEY)) throw new Error('Synthetic write failure');
      write(key, value);
    };
    const imported = structuredClone(current);
    imported.submission.text = 'Older memo';
    expect(() => saveProjectToLibrary(storage, imported, records, { makeActive: true, preserveReplaced: true })).toThrow('Synthetic write failure');
    expect(parseProject(storage.getItem(STORAGE_KEY)).submission.text).toBe(current.submission.text);
    const reloaded = loadProjectLibrary(storage, current, true);
    expect(reloaded.some(record => record.id === current.id)).toBe(true);
    expect([...storage.values.values()].some(raw => raw.includes('Older memo'))).toBe(false);
  });

  it('keeps independently loadable project bodies while changing the active project', () => {
    const first = namedProject('project_first', 'First project');
    const second = namedProject('project_second', 'Second project');
    let records = saveProjectToLibrary(window.localStorage, first, [], { makeActive: true });
    records = saveProjectToLibrary(window.localStorage, first, records);
    records = saveProjectToLibrary(window.localStorage, second, records, { makeActive: true });

    expect(parseProject(window.localStorage.getItem(STORAGE_KEY)).id).toBe(second.id);
    expect(records.map((record) => record.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(loadLibraryProject(window.localStorage, records.find((record) => record.id === first.id))).toMatchObject({
      id: first.id,
      title: first.title,
      submission: { text: first.submission.text },
    });
  });

  it('archives a project displaced by an autosave from another open tab', () => {
    const storage = new TestStorage();
    const first = namedProject('project_first', 'First project');
    const second = namedProject('project_second', 'Second project');
    const staleFirstTabRecords = saveProjectToLibrary(storage, first, [], { makeActive: true });
    saveProjectToLibrary(storage, second, staleFirstTabRecords, { makeActive: true });

    const recordsAfterStaleAutosave = saveProjectToLibrary(
      storage,
      first,
      staleFirstTabRecords,
      { makeActive: true },
    );

    expect(parseProject(storage.getItem(STORAGE_KEY)).id).toBe(first.id);
    expect(recordsAfterStaleAutosave.map((record) => record.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(loadLibraryProject(
      storage,
      recordsAfterStaleAutosave.find((record) => record.id === second.id),
    )).toMatchObject({ id: second.id, title: second.title });
  });

  it('leaves the previous active project intact if the final compatibility write fails', () => {
    const storage = new TestStorage();
    const first = namedProject('project_first', 'First project');
    const second = namedProject('project_second', 'Second project');
    let firstRecords = saveProjectToLibrary(storage, first, [], { makeActive: true });
    firstRecords = saveProjectToLibrary(storage, second, firstRecords);

    storage.failKey = STORAGE_KEY;
    expect(() => saveProjectToLibrary(storage, second, firstRecords, { makeActive: true })).toThrow('Quota exceeded');
    expect(parseProject(storage.getItem(STORAGE_KEY)).id).toBe(first.id);
    expect(loadProjectLibrary(storage, first, true).map((record) => record.id)).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it('keeps active-project saving within a one-body quota', () => {
    const original = namedProject('project_same', 'Original title');
    const storage = new QuotaStorage(Math.ceil(serializeProject(original).length * 1.45));
    const originalRecords = saveProjectToLibrary(storage, original, [], { makeActive: true });
    const revised = structuredClone(original);
    revised.title = 'Revised title';
    revised.updatedAt = new Date(Date.parse(original.updatedAt) + 1000).toISOString();

    saveProjectToLibrary(storage, revised, originalRecords, { makeActive: true });

    expect(parseProject(storage.getItem(STORAGE_KEY)).title).toBe(revised.title);
    expect([...storage.values.keys()].filter((key) => key.startsWith('systems-mapping-studio.project-body.'))).toHaveLength(0);
  });

  it.each(['archive', 'index', 'active'])('preserves the old active map and every existing body when the %s write fails', failure => {
    const storage = new TestStorage();
    const first = namedProject('project_first', 'First project');
    const second = namedProject('project_second', 'Second project');
    let records = saveProjectToLibrary(storage, first, [], { makeActive: true });
    records = saveProjectToLibrary(storage, second, records);
    // A preexisting recovery body may be newer than the active singleton.
    records = saveProjectToLibrary(storage, { ...first, title: 'Preserve this recovery copy' }, records);
    const before = new Map(storage.values);
    const archiveKey = [...before.keys()].find(key => key.startsWith(PROJECT_BODY_PREFIX) && JSON.parse(before.get(key)).id === first.id);
    storage.failKey = { archive: archiveKey, index: PROJECT_LIBRARY_KEY, active: STORAGE_KEY }[failure];
    expect(() => saveProjectToLibrary(storage, second, records, { makeActive: true })).toThrow('Quota exceeded');
    expect(storage.values).toEqual(before);
    expect(parseProject(storage.getItem(STORAGE_KEY)).id).toBe(first.id);
  });

  it('keeps the previous active map after a real quota refusal during catalog growth', () => {
    const first = namedProject('first', 'First');
    const second = namedProject('second', 'Second');
    const storage = new QuotaStorage(Infinity);
    const records = saveProjectToLibrary(storage, first, [], { makeActive: true });
    const before = new Map(storage.values);
    // Permit archiving the old body, but leave no space for catalog growth.
    const archiveKey = PROJECT_BODY_PREFIX + [...first.id].map(character => character.charCodeAt(0).toString(16).padStart(4, '0')).join('');
    storage.limit = [...before].reduce((size, [key, value]) => size + key.length + value.length, 0) + archiveKey.length + serializeProject(first).length;
    expect(() => saveProjectToLibrary(storage, second, records, { makeActive: true })).toThrow('Quota exceeded');
    expect(storage.values).toEqual(before);
  });

  it('does not replace the active snapshot when a same-ID update cannot write its catalog', () => {
    const storage = new TestStorage();
    const project = namedProject('same', 'Saved title');
    const records = saveProjectToLibrary(storage, project, [], { makeActive: true });
    const before = new Map(storage.values);
    storage.failKey = PROJECT_LIBRARY_KEY;
    expect(() => saveProjectToLibrary(storage, { ...project, title: 'Unsaved title' }, records, { makeActive: true })).toThrow('Quota exceeded');
    expect(storage.values).toEqual(before);
  });

  it('uses collision-free body keys for distinct imported project ids', () => {
    const first = namedProject('project_113u2uw_15u2', 'First colliding hash project');
    const second = namedProject('project_v1cg2i_219c', 'Second colliding hash project');
    let records = saveProjectToLibrary(window.localStorage, first, []);
    records = saveProjectToLibrary(window.localStorage, second, records);

    expect(loadLibraryProject(window.localStorage, records.find((record) => record.id === first.id)).title).toBe(first.title);
    expect(loadLibraryProject(window.localStorage, records.find((record) => record.id === second.id)).title).toBe(second.title);
  });

  it('keeps a separate project link association for each saved project', () => {
    const firstLink = { projectId: 'project_first', token: 'first_project_token_12345' };
    const secondLink = { projectId: 'project_second', token: 'second_project_token_1234' };

    rememberStoredLink(window.localStorage, firstLink);
    rememberStoredLink(window.localStorage, secondLink);
    mirrorActiveLink(window.localStorage, null);

    expect(loadStoredLink(window.localStorage, firstLink.projectId)).toEqual(firstLink);
    expect(loadStoredLink(window.localStorage, secondLink.projectId)).toEqual(secondLink);
  });

  it('stores links for arbitrary valid project ids without prototype-key collisions', () => {
    const link = { projectId: '__proto__', token: 'prototype_project_token_1' };
    rememberStoredLink(window.localStorage, link);
    expect(loadStoredLink(window.localStorage, link.projectId)).toEqual(link);
  });

  it('migrates a valid legacy link even when the newer registry is malformed', () => {
    const link = { projectId: 'project_legacy', token: 'legacy_project_token_123' };
    window.localStorage.setItem(LINKS_STORAGE_KEY, '{bad json');
    window.localStorage.setItem(LINK_STORAGE_KEY, JSON.stringify(link));
    expect(loadStoredLink(window.localStorage, link.projectId)).toEqual(link);
  });

  it('persists sync, revision, expiry, and revocation metadata per project link', () => {
    const link = {
      projectId: 'project_metadata',
      token: 'metadata_project_token_123',
      revision: 4,
      updatedAt: 1_787_956_800_000,
      expiresAt: '2026-09-27T12:00:00.000Z',
      lastSyncedAt: '2026-08-28T12:00:00.000Z',
    };
    rememberStoredLink(window.localStorage, link);
    rememberStoredLink(window.localStorage, {
      projectId: link.projectId,
      token: link.token,
      revision: 5,
      revokedAt: 1_787_956_900_000,
    });

    expect(loadStoredLink(window.localStorage, link.projectId)).toEqual({
      ...link,
      revision: 5,
      revokedAt: 1_787_956_900_000,
    });
    expect(JSON.parse(window.localStorage.getItem(LINKS_STORAGE_KEY)).version).toBe(2);
  });

  it('drops malformed link metadata and can forget only the selected project link', () => {
    const first = {
      projectId: 'project_first',
      token: 'first_project_token_12345',
      revision: -4,
      expiresAt: { unsafe: true },
    };
    const second = { projectId: 'project_second', token: 'second_project_token_1234', revision: 2 };
    rememberStoredLink(window.localStorage, first);
    rememberStoredLink(window.localStorage, second);
    mirrorActiveLink(window.localStorage, first);

    expect(loadStoredLink(window.localStorage, first.projectId)).toEqual({
      projectId: first.projectId,
      token: first.token,
    });
    forgetStoredLink(window.localStorage, first.projectId);

    expect(loadStoredLink(window.localStorage, first.projectId)).toBeNull();
    expect(loadStoredLink(window.localStorage, second.projectId)).toEqual(second);
    expect(window.localStorage.getItem(LINK_STORAGE_KEY)).toBeNull();
  });
});
