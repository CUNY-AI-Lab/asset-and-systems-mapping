import { describe, expect, it } from 'vitest';
import { readGuidanceCache, removeGuidanceCacheEntry, writeGuidanceCache } from './guidanceCache.js';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), values };
};
const response = (now, id = 'review') => ({ evaluation: { id, expiresAt: new Date(now + 3600000).toISOString() } });

describe('bounded guidance reuse', () => {
  it('reuses a matching request only inside its project and validity window', () => {
    const s = storage(), now = Date.now(), result = response(now);
    writeGuidanceCache(s, 'project-one', 'memo-and-choices', result, now);
    expect(readGuidanceCache(s, 'project-one', 'memo-and-choices', now + 1)).toEqual(result);
    expect(readGuidanceCache(s, 'project-two', 'memo-and-choices', now + 1)).toBeNull();
    expect(readGuidanceCache(s, 'project-one', 'changed-choices', now + 1)).toBeNull();
    expect(readGuidanceCache(s, 'project-one', 'memo-and-choices', now + 1800000)).toBeNull();
  });
  it('does not reuse an expired server evaluation or more than six requests', () => {
    const s = storage(), now = Date.now();
    for (let i = 0; i < 8; i++) writeGuidanceCache(s, 'p', String(i), response(now, String(i)), now + i);
    expect(readGuidanceCache(s, 'p', '0', now + 20)).toBeNull();
    expect(readGuidanceCache(s, 'p', '7', now + 20)).toBeTruthy();
    writeGuidanceCache(s, 'p', 'expired', { evaluation: { expiresAt: new Date(now).toISOString() } }, now);
    expect(readGuidanceCache(s, 'p', 'expired', now + 20)).toBeNull();
    removeGuidanceCacheEntry(s, 'p', '7', now + 20);
    expect(readGuidanceCache(s, 'p', '7', now + 21)).toBeNull();
  });
  it('handles malformed data and unavailable storage without blocking the app', () => {
    const s = storage(), now = Date.now();
    writeGuidanceCache(s, 'p', 'key', response(now), now);
    s.setItem([...s.values.keys()][0], '{broken');
    expect(readGuidanceCache(s, 'p', 'key', now)).toBeNull();
    const unavailable = { getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } };
    expect(readGuidanceCache(unavailable, 'p', 'key', now)).toBeNull();
    expect(() => writeGuidanceCache(unavailable, 'p', 'key', response(now), now)).not.toThrow();
    expect(() => removeGuidanceCacheEntry(unavailable, 'p', 'key', now)).not.toThrow();
  });
});

