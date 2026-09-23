let accountStorage = null;

export function projectStorage() {
  return accountStorage || window.localStorage;
}

export function institutionalLoginUrl() {
  const path = window.location.pathname;
  return /^\/p\/[A-Za-z0-9_-]{20,64}\/?$/.test(path) ? `/auth/start?returnTo=${encodeURIComponent(path)}` : '/auth/start';
}

export function useAccountStorage(cacheKey, onProjectSaved) {
  const prefix = `systems-mapping.account.${cacheKey}.`;
  const keys = () => Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter(key => key?.startsWith(prefix));
  accountStorage = {
    prefix,
    cacheKey,
    get length() { return keys().length; },
    key: (index) => keys()[index]?.slice(prefix.length) ?? null,
    getItem: (key) => window.localStorage.getItem(prefix + key),
    setItem: (key, value) => window.localStorage.setItem(prefix + key, value),
    removeItem: (key) => window.localStorage.removeItem(prefix + key),
    onProjectSaved,
  };
  return accountStorage;
}

export function releaseAccountStorage() { accountStorage = null; }
