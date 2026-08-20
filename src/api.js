export class ApiError extends Error {
  constructor(message, status, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new ApiError(payload?.error || `Request failed (${response.status})`, response.status, payload);
  return payload;
}

export function getPublicConfiguration(configKind, scale, stageId) {
  const params = new URLSearchParams({ configKind, scale, ...(stageId ? { stageId } : {}) });
  return apiRequest(`/api/config/public?${params}`);
}

export function getStudentSession() {
  return apiRequest('/api/student/session');
}

export function requestStudentAccess(code) {
  return apiRequest('/api/student/access', { method: 'POST', body: { code } });
}

export function endStudentAccess() {
  return apiRequest('/api/student/logout', { method: 'POST' });
}

export function createPreflightEvaluation(payload) {
  return apiRequest('/api/preflight/evaluations', { method: 'POST', body: payload });
}

export function suggestMapConnections(payload) {
  return apiRequest('/api/map/connections', { method: 'POST', body: payload });
}

export function createProjectLink(project) {
  return apiRequest('/api/projects', { method: 'POST', body: { project } });
}

export function fetchProjectLink(token) {
  return apiRequest(`/api/projects/${encodeURIComponent(token)}`);
}

export function updateProjectLink(token, project) {
  return apiRequest(`/api/projects/${encodeURIComponent(token)}`, { method: 'PUT', body: { project } });
}

export function recordPrototypeEvent(event, stage, metadata = undefined) {
  return apiRequest('/api/prototype/events', {
    method: 'POST',
    body: { event, ...(stage ? { stage } : {}), ...(metadata ? { metadata } : {}) },
  });
}
