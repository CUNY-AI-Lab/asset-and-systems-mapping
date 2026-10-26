import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, TimeoutError } from './api.js';
import { INSTITUTIONAL_SESSION_TIMEOUT_MS, readInstitutionalSession } from './studentSession.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('institutional session deadline', () => {
  it('bounds a transport that ignores cancellation and aborts its signal', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const result = readInstitutionalSession();
    const assertion = expect(result).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(INSTITUTIONAL_SESSION_TIMEOUT_MS);
    await assertion;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('includes response parsing in its deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: () => new Promise(() => {}) })));
    const assertion = expect(readInstitutionalSession()).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(INSTITUTIONAL_SESSION_TIMEOUT_MS);
    await assertion;
  });

  it('cancels immediately without waiting for the transport', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const result = readInstitutionalSession({ signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each(['2000-01-01T00:00:00.000Z', 'not a timestamp', undefined])('rejects expired or invalid grants: %s', async (expiresAt) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access: { expiresAt } }), { headers: { 'content-type': 'application/json' } })));
    await expect(readInstitutionalSession()).rejects.toBeInstanceOf(ApiError);
  });

  it('returns a current server grant without extending it', async () => {
    const access = { expiresAt: new Date(Date.now() + 5000).toISOString() };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access }), { headers: { 'content-type': 'application/json' } })));
    await expect(readInstitutionalSession()).resolves.toEqual({ access });
    expect(fetch).toHaveBeenCalledWith('/api/student/session', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }));
  });
});
