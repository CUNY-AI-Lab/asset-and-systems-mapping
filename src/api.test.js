import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiRequest,
  ApiError,
  createPreflightEvaluation,
  deleteProjectLink,
  GUIDANCE_REQUEST_TIMEOUT_MS,
  revokeProjectLink,
  suggestMapConnections,
  TimeoutError,
  updateProjectLink,
} from './api.js';

function successfulFetch() {
  return vi.fn(async () => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ accepted: true }),
  }));
}

describe('project link API helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the expected revision in the request body and If-Match header', async () => {
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);

    await updateProjectLink('token/with punctuation', '{"id":"project_1"}', 7);

    expect(fetch).toHaveBeenCalledWith('/api/projects/token%2Fwith%20punctuation', expect.objectContaining({
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"7"',
      },
      body: JSON.stringify({ project: '{"id":"project_1"}', expectedRevision: 7 }),
    }));
  });

  it('keeps existing two-argument updates backward compatible', async () => {
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);

    await updateProjectLink('token', '{"id":"project_1"}');

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ project: '{"id":"project_1"}' });
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('supports distinct revoke and delete operations with optimistic revisions', async () => {
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);

    await revokeProjectLink('token', 3);
    await deleteProjectLink('token', 4);

    expect(fetch.mock.calls[0][0]).toBe('/api/projects/token/revoke');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ expectedRevision: 3 });
    expect(fetch.mock.calls[1][0]).toBe('/api/projects/token');
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ expectedRevision: 4 });
  });

  it('rejects invalid expected revisions before issuing a request', () => {
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);

    expect(() => updateProjectLink('token', '{}', 0)).toThrow('positive integer');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('bounded guidance requests', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const helpers = [
    ['memo guidance', createPreflightEvaluation, '/api/preflight/evaluations'],
    ['connection guidance', suggestMapConnections, '/api/map/connections'],
  ];

  it.each(helpers)('times out hanging %s fetches even when transport ignores Abort', async (_, request, path) => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const pending = request({ inquiry: 'Access' }, { timeoutMs: 25 });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError', timeoutMs: 25 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(path);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetch.mock.calls[0][1].signal.reason).toBeInstanceOf(TimeoutError);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(helpers)('includes hanging %s response-body parsing within the same deadline', async (_, request) => {
    vi.useFakeTimers();
    const json = vi.fn(() => new Promise(() => {}));
    const fetch = vi.fn(async () => ({ ok: true, headers: { get: () => 'application/json' }, json }));
    vi.stubGlobal('fetch', fetch);
    const pending = request({}, { timeoutMs: 25 });
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(0);
    expect(json).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the bounded 100-second default', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const pending = createPreflightEvaluation({});
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError', timeoutMs: 100_000 });
    expect(GUIDANCE_REQUEST_TIMEOUT_MS).toBe(100_000);
    await vi.advanceTimersByTimeAsync(99_999);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps typed timeout errors when an abort-aware transport rejects with AbortError', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_, options) => new Promise((__, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const assertion = expect(createPreflightEvaluation({}, { timeoutMs: 25 })).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it.each(helpers)('cancels %s immediately when the external signal aborts, even if fetch ignores Abort', async (_, request) => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const external = new AbortController();
    const add = vi.spyOn(external.signal, 'addEventListener');
    const remove = vi.spyOn(external.signal, 'removeEventListener');
    const pending = request({}, { signal: external.signal });
    const reason = new DOMException('Project changed', 'AbortError');
    const assertion = expect(pending).rejects.toBe(reason);
    external.abort(reason);
    await assertion;
    expect(fetch.mock.calls[0][1].signal.reason).toBe(reason);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a hanging JSON body without waiting for the deadline', async () => {
    vi.useFakeTimers();
    const json = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: { get: () => 'application/json' }, json })));
    const external = new AbortController();
    const pending = createPreflightEvaluation({}, { signal: external.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(json).toHaveBeenCalledTimes(1);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    external.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(helpers)('does not issue %s fetches for an already aborted signal', async (_, request) => {
    vi.useFakeTimers();
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);
    const external = new AbortController();
    const reason = new DOMException('Project closed', 'AbortError');
    external.abort(reason);
    await expect(request({}, { signal: external.signal })).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(helpers)('cleans up timers and external listeners after successful %s requests', async (_, request) => {
    vi.useFakeTimers();
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);
    const external = new AbortController();
    const add = vi.spyOn(external.signal, 'addEventListener');
    const remove = vi.spyOn(external.signal, 'removeEventListener');
    await expect(request({ inquiry: 'Access' }, { signal: external.signal, timeoutMs: 25 })).resolves.toEqual({ accepted: true });
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ inquiry: 'Access' }) });
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    external.abort();
    await vi.advanceTimersByTimeAsync(25);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it('preserves ApiError failures and cleans up the request boundary', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 503, headers: { get: () => 'application/json' },
      json: async () => ({ error: 'Guidance unavailable' }),
    })));
    const external = new AbortController();
    const remove = vi.spyOn(external.signal, 'removeEventListener');
    const pending = createPreflightEvaluation({}, { signal: external.signal });
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    await expect(pending).rejects.toMatchObject({ status: 503, payload: { error: 'Guidance unavailable' } });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, 1.5, Infinity, NaN, 100_001])('rejects an invalid deadline %s before starting a request', async (timeoutMs) => {
    vi.useFakeTimers();
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);
    await expect(createPreflightEvaluation({}, { timeoutMs })).rejects.toBeInstanceOf(RangeError);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not impose the guidance deadline on ordinary API calls', async () => {
    vi.useFakeTimers();
    let resolveFetch;
    const fetch = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const pending = apiRequest('/api/student/session');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('signal');
    resolveFetch({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ access: null }) });
    await expect(pending).resolves.toEqual({ access: null });
  });
});
