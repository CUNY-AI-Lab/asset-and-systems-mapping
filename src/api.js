import { projectStorage, institutionalLoginUrl } from './accountStorage.js';
export class ApiError extends Error {
  constructor(message, status, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export async function apiRequest(path, options = {}) {
  const { body, headers: suppliedHeaders, ...requestOptions } = options;
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...requestOptions,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(projectStorage()?.cacheKey ? { 'x-systems-account-cache': projectStorage().cacheKey } : {}), ...(suppliedHeaders || {}) },
    body: body && typeof body !== 'string' ? JSON.stringify(body) : body,
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const requestId = payload?.details?.requestId;
    const support = typeof requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId) ? ` Support ID: ${requestId}` : '';
    if (response.status === 401 && projectStorage()?.prefix && ['authentication_required', 'session_invalid'].includes(payload?.details?.code)) window.location.assign(institutionalLoginUrl());
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

export function createPreflightEvaluation(payload, options = {}) {
  return apiRequest('/api/preflight/evaluations', { ...options, method: 'POST', body: payload });
}

export function suggestMapConnections(payload, options = {}) {
  return apiRequest('/api/map/connections', { ...options, method: 'POST', body: payload });
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
