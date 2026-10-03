import { cancelBody, withDeadline, withSignal } from './bounded.js';
import { GUIDANCE_WORKER_TIMEOUT_MS } from '../src/guidanceLimits.js';

export const GUIDANCE_DEADLINE_MS = GUIDANCE_WORKER_TIMEOUT_MS;
const GUIDANCE_PATHS = new Set(['/api/preflight/evaluations', '/api/map/connections']);

export function isGuidanceRequest(request) {
  return request.method === 'POST' && GUIDANCE_PATHS.has(new URL(request.url).pathname);
}

// Covers authentication, course startup/dispatch, generation, and validation.
// Stop waiting even if an RPC ignores cancellation. The course still owns its
// in-flight permit until its operation settles; this boundary never releases it
// or automatically starts another potentially billable request.
export async function boundedGuidanceRequest(request, handle, timeoutMs = GUIDANCE_DEADLINE_MS) {
  return withDeadline(async signal => {
    signal.throwIfAborted();
    // A locally-created AbortSignal cannot cross the course RPC boundary at
    // the deployed compatibility settings. Keep it local and forward the
    // original request; do not claim that timing out cancelled remote work.
    const pending = Promise.resolve(handle(request));
    try { return await withSignal(pending, signal); }
    catch (error) {
      void pending.then(response => cancelBody(response.body), () => {});
      throw error;
    }
  }, request.signal, timeoutMs);
}
