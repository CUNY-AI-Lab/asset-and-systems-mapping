import { apiRequest, ApiError, TimeoutError } from './api.js';

export const INSTITUTIONAL_SESSION_TIMEOUT_MS = 10_000;

// A deadline includes response parsing, even if the transport ignores abort.
export async function readInstitutionalSession({ signal } = {}) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Request cancelled', 'AbortError');
  const controller = new AbortController();
  let timer;
  let cancel;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new TimeoutError(INSTITUTIONAL_SESSION_TIMEOUT_MS);
      reject(error);
      controller.abort(error);
    }, INSTITUTIONAL_SESSION_TIMEOUT_MS);
    cancel = () => {
      const error = signal.reason ?? new DOMException('Request cancelled', 'AbortError');
      reject(error);
      controller.abort(error);
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
  try {
    const result = await Promise.race([apiRequest('/api/student/session', { signal: controller.signal }), deadline]);
    if (result?.access) {
      const expiresAt = Date.parse(result.access.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new ApiError('Sign-in ended', 401);
    }
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
