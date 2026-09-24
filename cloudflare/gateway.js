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

export function safeGatewayFailure(error, fallbackRequestId) {
  const code = error instanceof CailError && /^[a-z][a-z_]{1,63}$/.test(error.code) ? error.code : 'upstream_failure';
  const shouldRetry = error instanceof CailError && typeof error.extras.should_retry === 'boolean' ? error.extras.should_retry : false;
  const candidate = error instanceof CailError ? error.extras.request_id : undefined;
  const requestId = REQUEST_ID.test(candidate || '') ? candidate : fallbackRequestId;
  const message = code === 'quota_exceeded'
    ? 'The CAIL model usage limit has been reached. Your map is still available.'
    : shouldRetry ? 'The model request could not be completed. Please try again later.'
      : 'The model request could not be completed. Your map is still available.';
  return {
    status: error instanceof CailError && [400, 401, 403, 404, 409, 429, 503].includes(error.status) ? error.status : 502,
    message,
    details: { code, shouldRetry, ...(REQUEST_ID.test(requestId || '') ? { requestId } : {}) },
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
