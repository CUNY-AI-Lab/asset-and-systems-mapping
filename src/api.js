import { projectStorage, institutionalLoginUrl } from './accountStorage.js';
import { courseRequestHeaders, initialApiCourseSelection } from './courseContext.js';
import { GUIDANCE_REQUEST_TIMEOUT_MS } from './guidanceLimits.js';
import { durableGuidance } from './durableGuidance.js';
export { GUIDANCE_REQUEST_TIMEOUT_MS } from './guidanceLimits.js';
export class ApiError extends Error {
  constructor(message, status, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export class TimeoutError extends Error {
  constructor(timeoutMs = GUIDANCE_REQUEST_TIMEOUT_MS) {
    super('Guidance request timed out');
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export async function apiRequest(path, options = {}) {
  const { body, headers: suppliedHeaders, workspace = projectStorage(), ...requestOptions } = options;
  // Capture the workspace once, before any asynchronous work. Supplied headers
  // cannot redirect a pending request into a different account or course.
  const selection = workspace?.courseSelection || initialApiCourseSelection();
  const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(suppliedHeaders || {}) };
  for (const name of Object.keys(headers)) {
    if (['x-systems-account-cache', 'x-systems-course'].includes(name.toLowerCase())) delete headers[name];
  }
  Object.assign(headers, courseRequestHeaders(selection), workspace?.cacheKey ? { 'x-systems-account-cache': workspace.cacheKey } : {});
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...requestOptions,
    headers,
    body: body && typeof body !== 'string' ? JSON.stringify(body) : body,
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const requestId = payload?.details?.requestId;
    const support = typeof requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId) ? ` Support ID: ${requestId}` : '';
    if (response.status === 401 && workspace?.cacheKey && ['authentication_required', 'session_invalid'].includes(payload?.details?.code)) window.location.assign(institutionalLoginUrl(selection));
    throw new ApiError((payload?.error || `Request failed (${response.status})`) + support, response.status, payload);
  }
  return payload;
}

export function getPublicConfiguration(configKind, scale, stageId) {
  const params = new URLSearchParams({ configKind, scale, ...(stageId ? { stageId } : {}) });
  return apiRequest(`/api/config/public?${params}`);
}

export function getStudentSession() {
  return apiRequest('/api/student/session');
}

export function resetTeacherPassword(token, passphrase) {
  return apiRequest('/api/auth/reset-password', { method: 'POST', body: { token, passphrase } });
}

export function requestStudentAccess(code) {
  return apiRequest('/api/student/access', { method: 'POST', body: { code } });
}

export function endStudentAccess() {
  return apiRequest('/api/student/logout', { method: 'POST' });
}

async function guidanceRequest(path, payload, options = {}) {
  const { timeoutMs = GUIDANCE_REQUEST_TIMEOUT_MS, signal, ...requestOptions } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > GUIDANCE_REQUEST_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be an integer from 1 to ${GUIDANCE_REQUEST_TIMEOUT_MS}`);
  }
  const abortReason = () => signal.reason ?? new DOMException('Request cancelled', 'AbortError');
  if (signal?.aborted) throw abortReason();
  const controller = new AbortController();
  let timer;
  let onAbort;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new TimeoutError(timeoutMs);
      // Settle the deadline first so an abort-aware fetch cannot replace the
      // typed timeout with a generic AbortError.
      reject(error);
      controller.abort(error);
    }, timeoutMs);
    if (signal) {
      onAbort = () => {
        const reason = abortReason();
        reject(reason);
        controller.abort(reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    // apiRequest includes body parsing; the deadline covers both phases and
    // still settles if a transport or body reader ignores cancellation.
    return await Promise.race([
      apiRequest(path, { ...requestOptions, method: 'POST', body: payload, signal: controller.signal }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export function createPreflightEvaluation(payload, options = {}) {
  if (options.durable) return durableGuidance(apiRequest, (message, status, result) => new ApiError(message, status, result), 'memo', payload, { ...options, storage: projectStorage() });
  return guidanceRequest('/api/preflight/evaluations', payload, options);
}

export function suggestMapConnections(payload, options = {}) {
  if (options.durable) return durableGuidance(apiRequest, (message, status, result) => new ApiError(message, status, result), 'connections', payload, { ...options, storage: projectStorage() });
  return guidanceRequest('/api/map/connections', payload, options);
}

export function createProjectLink(project) {
  return apiRequest('/api/projects', { method: 'POST', body: { project } });
}

export function fetchProjectLink(token) {
  return apiRequest(`/api/projects/${encodeURIComponent(token)}`);
}

function expectedRevisionRequest(expectedRevision, body = {}) {
  if (expectedRevision === undefined || expectedRevision === null) return { body };
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new TypeError('expectedRevision must be a positive integer.');
  }
  return {
    headers: { 'If-Match': `"${expectedRevision}"` },
    body: { ...body, expectedRevision },
  };
}

export function updateProjectLink(token, project, expectedRevision) {
  return apiRequest(`/api/projects/${encodeURIComponent(token)}`, {
    method: 'PUT',
    ...expectedRevisionRequest(expectedRevision, { project }),
  });
}

export function revokeProjectLink(token, expectedRevision) {
  return apiRequest(`/api/projects/${encodeURIComponent(token)}/revoke`, {
    method: 'POST',
    ...expectedRevisionRequest(expectedRevision),
  });
}

export function deleteProjectLink(token, expectedRevision) {
  return apiRequest(`/api/projects/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    ...expectedRevisionRequest(expectedRevision),
  });
}

export function recordPrototypeEvent(event, stage, metadata = undefined) {
  return apiRequest('/api/prototype/events', {
    method: 'POST',
    body: { event, ...(stage ? { stage } : {}), ...(metadata ? { metadata } : {}) },
  });
}
