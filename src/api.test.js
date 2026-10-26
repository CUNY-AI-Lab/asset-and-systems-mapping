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
import { releaseAccountStorage, useAccountStorage } from './accountStorage.js';
import { parseCourseSelection } from './courseContext.js';
import { readInstitutionalSession } from './studentSession.js';

function successfulFetch() {
  return vi.fn(async () => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ accepted: true }),
  }));
}

describe('authentication redirect ordering', () => {
  afterEach(() => {
    releaseAccountStorage();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  const navigationSpy = () => {
    const assign = vi.fn();
    vi.stubGlobal('window', {
      localStorage: window.localStorage,
      location: { pathname: '/', search: '', assign },
    });
    return assign;
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it.each(['session_invalid', 'authentication_required'])('does not navigate for an older %s 401 after a newer verified Systems grant', async code => {
    const workspace = useAccountStorage('transport-ordering-a', null, parseCourseSelection('?course=course-a'));
    const assign = navigationSpy();
    let rejectOlder;
    vi.stubGlobal('fetch', vi.fn(path => String(path) === '/api/student/session'
      ? Promise.resolve(json({ access: { expiresAt: new Date(Date.now() + 60_000).toISOString() } }))
      : new Promise(resolve => { rejectOlder = () => resolve(json({ error: 'Old sign-in failure', details: { code } }, 401)); })));
    const older = apiRequest('/api/prototype/events', { method: 'POST', body: { event: 'synthetic' }, workspace });
    const failure = expect(older).rejects.toMatchObject({ status: 401, payload: { details: { code } } });
    await readInstitutionalSession({ workspace });
    rejectOlder();
    await failure;
    expect(assign).not.toHaveBeenCalled();
  });

  it.each(['session_invalid', 'authentication_required'])('retains the current %s 401 redirect and rejection after verification', async code => {
    const workspace = useAccountStorage('transport-current', null, parseCourseSelection('?course=course-a'));
    const assign = navigationSpy();
    vi.stubGlobal('fetch', vi.fn(async path => String(path) === '/api/student/session'
      ? json({ access: { expiresAt: new Date(Date.now() + 60_000).toISOString() } })
      : json({ error: 'Current sign-in failure', details: { code } }, 401)));
    await readInstitutionalSession({ workspace });
    await expect(apiRequest('/api/prototype/events', { workspace })).rejects.toMatchObject({ status: 401, payload: { details: { code } } });
    expect(assign).toHaveBeenCalledExactlyOnceWith('/auth/start?returnTo=%2F%3Fcourse%3Dcourse-a');
  });

  it('preserves a current 403 as a denied request rather than converting it into success', async () => {
    const workspace = useAccountStorage('transport-forbidden', null, parseCourseSelection('?course=course-a'));
    const assign = navigationSpy();
    vi.stubGlobal('fetch', vi.fn(async path => String(path) === '/api/student/session'
      ? json({ access: { expiresAt: new Date(Date.now() + 60_000).toISOString() } })
      : json({ error: 'Access required', details: { code: 'admission_required' } }, 403)));
    await readInstitutionalSession({ workspace });
    await expect(apiRequest('/api/prototype/events', { workspace })).rejects.toMatchObject({ status: 403, payload: { details: { code: 'admission_required' } } });
    expect(assign).not.toHaveBeenCalled();
  });

  it.each(['identity', 'empty', 'expired', 'invalid', 'unavailable'])('does not treat a newer %s response as a verified Systems grant', async kind => {
    const workspace = useAccountStorage('transport-unverified', null, parseCourseSelection('?course=course-a'));
    const assign = navigationSpy();
    let rejectOlder;
    vi.stubGlobal('fetch', vi.fn(path => {
      if (String(path) === '/api/auth/me') return Promise.resolve(json({ user: { id: 'recognized-synthetic-user' } }));
      if (String(path) === '/api/student/session') return Promise.resolve(kind === 'unavailable' ? json({ error: 'Unavailable' }, 503)
        : json({ access: kind === 'empty' ? null : { expiresAt: kind === 'expired' ? new Date(Date.now() - 1).toISOString() : 'invalid' } }));
      return new Promise(resolve => { rejectOlder = () => resolve(json({ error: 'Sign-in required', details: { code: 'session_invalid' } }, 401)); });
    }));
    const older = apiRequest('/api/prototype/events', { workspace });
    const failure = expect(older).rejects.toMatchObject({ status: 401 });
    if (kind === 'identity') await apiRequest('/api/auth/me', { workspace });
    else if (kind === 'empty') await expect(readInstitutionalSession({ workspace })).resolves.toEqual({ access: null });
    else await expect(readInstitutionalSession({ workspace })).rejects.toBeInstanceOf(ApiError);
    rejectOlder();
    await failure;
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('does not redirect a new account for an older account rejection', async () => {
    const workspace = useAccountStorage('transport-account-a', null, parseCourseSelection('?course=course-a'));
    const assign = navigationSpy();
    let rejectOlder;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { rejectOlder = () => resolve(json({ error: 'Old account denied', details: { code: 'session_invalid' } }, 401)); })));
    const older = apiRequest('/api/cloud/projects', { workspace });
    const failure = expect(older).rejects.toMatchObject({ status: 401 });
    useAccountStorage('transport-account-b', null, parseCourseSelection('?course=course-b'));
    rejectOlder();
    await failure;
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not use another course grant to suppress a current course denial', async () => {
    const workspace = useAccountStorage('transport-course-scope', null, parseCourseSelection('?course=course-a'));
    const assign = navigationSpy();
    let rejectOlder;
    vi.stubGlobal('fetch', vi.fn(path => String(path) === '/api/student/session'
      ? Promise.resolve(json({ access: { expiresAt: new Date(Date.now() + 60_000).toISOString() } }))
      : new Promise(resolve => { rejectOlder = () => resolve(json({ error: 'Course A denied', details: { code: 'session_invalid' } }, 401)); })));
    const older = apiRequest('/api/prototype/events', { workspace });
    const failure = expect(older).rejects.toMatchObject({ status: 401 });
    await readInstitutionalSession({ workspace: { ...workspace, courseSelection: parseCourseSelection('?course=course-b') } });
    rejectOlder();
    await failure;
    expect(assign).toHaveBeenCalledExactlyOnceWith('/auth/start?returnTo=%2F%3Fcourse%3Dcourse-a');
  });

  it('does not navigate for an aborted request whose transport later returns a coded 401', async () => {
    const workspace = useAccountStorage('transport-aborted', null, parseCourseSelection('?course=course-a'));
    const assign = navigationSpy();
    const controller = new AbortController();
    let rejectOlder;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { rejectOlder = () => resolve(json({ error: 'Abandoned denial', details: { code: 'session_invalid' } }, 401)); })));
    const older = apiRequest('/api/prototype/events', { workspace, signal: controller.signal });
    const failure = expect(older).rejects.toMatchObject({ status: 401 });
    controller.abort();
    rejectOlder();
    await failure;
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('course API scope', () => {
  afterEach(() => {
    releaseAccountStorage();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('keeps public Node requests unchanged even when the URL contains a course', async () => {
    vi.stubEnv('VITE_ACCOUNT_WORKSPACE', 'false');
    window.history.replaceState(null, '', '/?course=course-a');
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);
    await apiRequest('/api/config/public');
    expect(fetch.mock.calls[0][1].headers).toEqual({});
  });

  it('sends the selected course on every Cloudflare request before bootstrap', async () => {
    vi.stubEnv('VITE_ACCOUNT_WORKSPACE', 'true');
    window.history.replaceState(null, '', '/?course=course-a');
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);
    await apiRequest('/api/cloud/account');
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'x-systems-course': 'course-a' });
  });

  it('rejects invalid and duplicate Cloudflare selections without a general request', async () => {
    vi.stubEnv('VITE_ACCOUNT_WORKSPACE', 'true');
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);
    for (const search of ['?course=', '?course=a&course=a']) {
      window.history.replaceState(null, '', `/${search}`);
      await expect(apiRequest('/api/cloud/account')).rejects.toMatchObject({ status: 403, payload: { details: { code: 'course_invalid' } } });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('pins requests to their account adapter despite URL or global storage changes', async () => {
    const original = useAccountStorage('server-cache-a', null, parseCourseSelection('?course=course-a'));
    window.history.replaceState(null, '', '/?course=course-b');
    useAccountStorage('server-cache-b', null, parseCourseSelection('?course=course-b'));
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);
    await apiRequest('/api/cloud/projects/map-a', {
      method: 'PUT', body: { project: '{}' }, workspace: original,
      headers: { 'X-Systems-Course': 'course-b', 'x-systems-account-cache': 'server-cache-b' },
    });
    expect(fetch.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json', 'x-systems-course': 'course-a', 'x-systems-account-cache': 'server-cache-a',
    });
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('workspace');
  });

  it('keeps all ordinary child APIs in the established course after URL changes', async () => {
    useAccountStorage('server-cache-a', null, parseCourseSelection('?course=course-a'));
    window.history.replaceState(null, '', '/?course=course-b');
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);
    await apiRequest('/api/student/session');
    await updateProjectLink('token', '{}', 1);
    await createPreflightEvaluation({});
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [, options] of fetch.mock.calls) {
      expect(options.headers['x-systems-course']).toBe('course-a');
      expect(options.headers['x-systems-account-cache']).toBe('server-cache-a');
    }
  });
});

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

  it('ends the complete action at 30 seconds', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const pending = createPreflightEvaluation({});
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError', timeoutMs: 30_000 });
    expect(GUIDANCE_REQUEST_TIMEOUT_MS).toBe(30_000);
    await vi.advanceTimersByTimeAsync(29_999);
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
