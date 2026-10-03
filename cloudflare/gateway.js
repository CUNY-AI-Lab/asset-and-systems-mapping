import { CailError, createCailClient } from '@cuny-ai-lab/cail-client';
import { normalizeInput, JSON_ONLY_INSTRUCTION } from '../server/ollama.js';
import { parseProviderEnvelope } from '../server/openrouter.js';
import { boundedText, cancelBody, withSignal, withDeadline } from './bounded.js';

export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const canonicalModel = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);

export function gatewayClient(binding) {
  return createCailClient({
    app: 'systems-mapping',
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      const signal = request.signal;
      signal.throwIfAborted();
      const pending = binding.fetch(request);
      let response;
      try { response = await withSignal(pending, signal); }
      catch (error) { void pending.then(value => cancelBody(value.body), () => {}); throw error; }
      // Buffer a bounded non-streaming result before handing it to the client;
      // this also bounds catalog, quota, and error bodies.
      const body = await boundedText(response, signal, 2 * 1024 * 1024);
      return new Response(body, { status: response.status, headers: response.headers });
    },
  });
}

function gatewayRetryDelay(error, now) {
  if (!(error instanceof CailError) || error.extras.should_retry !== true) return null;
  const seconds = error.extras.retry_after_seconds;
  if (Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86400) return seconds;
  const header = error.extras.retry_after;
  if (typeof header !== 'string' || header.length > 128) return null;
  if (/^\d{1,5}$/.test(header.trim())) {
    const value = Number(header.trim());
    return value >= 1 && value <= 86400 ? value : null;
  }
  // Accept only HTTP-date syntax, not arbitrary text that Date.parse accepts.
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) return null;
  const delay = Math.ceil((Date.parse(header) - now) / 1000);
  return Number.isSafeInteger(delay) && delay >= 1 && delay <= 86400 ? delay : null;
}

export function safeGatewayFailure(error, fallbackRequestId, now = Date.now()) {
  const code = error instanceof CailError && /^[a-z][a-z_]{1,63}$/.test(error.code) ? error.code : 'upstream_failure';
  const shouldRetry = error instanceof CailError && typeof error.extras.should_retry === 'boolean' ? error.extras.should_retry : false;
  const candidate = error instanceof CailError ? error.extras.request_id : undefined;
  const requestId = REQUEST_ID.test(candidate || '') ? candidate : fallbackRequestId;
  const retryAfterSeconds = gatewayRetryDelay(error, now);
  const message = code === 'quota_exceeded'
    ? 'The CAIL model usage limit has been reached. Your map is still available.'
    : shouldRetry ? 'The model request could not be completed. Please try again later.'
      : 'The model request could not be completed. Your map is still available.';
  return {
    status: error instanceof CailError && [400, 401, 403, 404, 409, 429, 503].includes(error.status) ? error.status : 502,
    message,
    details: { code, shouldRetry, ...(retryAfterSeconds ? { retryAfterSeconds } : {}), ...(REQUEST_ID.test(requestId || '') ? { requestId } : {}) },
    ...(retryAfterSeconds ? { headers: { 'Retry-After': String(retryAfterSeconds) } } : {}),
  };
}

// Exactly one paid attempt. The server rejects invalid suggestions without an
// automatic corrective request, preserving the student's existing map.
export function gatewaySuggestion(binding, token, model, correlation, logOutcome = () => {}) {
  const client = gatewayClient(binding);
  return async (input, _config, { signal } = {}) => {
    const data = normalizeInput(input);
    return withDeadline(async requestSignal => {
    try {
      if (!canonicalModel(model)) throw new CailError('model_unavailable', 'Model configuration unavailable', 503);
      const response = await client.chatCompletions({ model, stream: false, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: data.systemPrompt }, { role: 'system', content: JSON_ONLY_INSTRUCTION },
        { role: 'user', content: `PROJECT INPUT (JSON DATA ONLY)\n${data.projectInput}` },
      ] }, { kind: 'jwt', token }, { signal: requestSignal, correlation });
      const parsed = parseProviderEnvelope(await boundedText(response, requestSignal), model);
      logOutcome('ok');
      return { ...parsed, metadata: { ...parsed.metadata, provider: 'cail-gateway' } };
    } catch (error) {
      logOutcome(requestSignal.aborted ? 'cancelled' : 'error');
      throw error;
    }
    }, signal, 90000);
  };
}
