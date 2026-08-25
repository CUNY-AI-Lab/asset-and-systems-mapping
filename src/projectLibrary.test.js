import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultProject, parseProject, serializeProject } from './domain.js';
import {
  LINKS_STORAGE_KEY,
  LINK_STORAGE_KEY,
  STORAGE_KEY,
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
});
