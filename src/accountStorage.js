import { courseWorkspacePath, initialApiCourseSelection, instructorWorkspacePath, parseCourseSelection, parseWorkspaceView } from './courseContext.js';
import { appMount, appPathname } from './appPath.js';

let accountStorage = null;

export function projectStorage() {
  return accountStorage || window.localStorage;
}

export function institutionalLoginUrl(selection = accountStorage?.courseSelection || initialApiCourseSelection()) {
  const path = appPathname();
  const returnTo = path === '/' && parseWorkspaceView(window.location.search) === 'instructor'
    ? instructorWorkspacePath(selection)
    : courseWorkspacePath(/^\/p\/[A-Za-z0-9_-]{20,64}\/?$/.test(path) ? path : '/', selection);
  // Doorway signs in before serving this exact mounted page, preserving its
  // course, instructor view and shared-project path through the callback.
  if (appMount()) return returnTo;
  return returnTo === '/' ? '/auth/start' : `/auth/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function useAccountStorage(cacheKey, onProjectSaved, courseSelection = parseCourseSelection()) {
  const prefix = `systems-mapping.account.${cacheKey}.`;
  const keys = () => Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter(key => key?.startsWith(prefix));
  accountStorage = Object.freeze({
    prefix,
    cacheKey,
    courseSelection: Object.freeze({ ...courseSelection }),
    get length() { return keys().length; },
    key: (index) => keys()[index]?.slice(prefix.length) ?? null,
    getItem: (key) => window.localStorage.getItem(prefix + key),
    setItem: (key, value) => window.localStorage.setItem(prefix + key, value),
    removeItem: (key) => window.localStorage.removeItem(prefix + key),
    onProjectSaved,
  });
  return accountStorage;
}

export function releaseAccountStorage() { accountStorage = null; }
