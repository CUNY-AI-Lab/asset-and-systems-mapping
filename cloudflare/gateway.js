import { CailError, createCailClient } from '@cuny-ai-lab/cail-client';
import { normalizeInput, JSON_ONLY_INSTRUCTION } from '../server/ollama.js';
import { parseProviderEnvelope } from '../server/openrouter.js';
import { boundedText, cancelBody, withSignal, withDeadline } from './bounded.js';
import { GUIDANCE_MODEL_TIMEOUT_MS } from '../src/guidanceLimits.js';

export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const canonicalModel = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);

export function parseGatewayEnvelope(body, selectedModel) {
  const envelope = JSON.parse(body);
  // Gateway accepts canonical request IDs but deliberately preserves successful
  // provider bodies. Workers AI returns @cf/vendor/model in that envelope.
  // Only the exact requested variant may be normalized; never accept a silent
  // substitution or weaken the separate Railway/OpenRouter parser.
  const nativeModel = typeof envelope?.model === 'string'
    ? /^@cf\/[a-z0-9_-]+\/([a-z0-9][a-z0-9._-]{0,127})$/.exec(envelope.model)?.[1]
    : undefined;
  if (envelope?.model !== selectedModel && nativeModel !== selectedModel) {
    throw new CailError('invalid_response', 'Unexpected model response', 502);
  }
  return parseProviderEnvelope(JSON.stringify({ ...envelope, model: selectedModel }), selectedModel);
}

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
  if (error?.name === 'TimeoutError') return {
    status: 504,
    message: 'Couldn’t generate guidance — Try again',
    details: { code: 'guidance_timeout', shouldRetry: false, requestId: fallbackRequestId },
  };
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

// DeepSeek remains available for explicit acceptance probes but did not pass
// the 25-second full-memo budget. Do not advertise an unqualified backup.
export const GUIDANCE_FALLBACK_MODELS = Object.freeze(['gpt-oss-20b']);
const AVAILABILITY_FAILURES = new Set(['upstream_rate_limited', 'upstream_unavailable', 'model_unavailable']);

function backoff(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// The student-requested backup is a new, fully admitted Gateway call, not a
// claim that different models are equivalent. Only a known pre-inference
// availability refusal permits it. Never replay ambiguous timeouts, quota
// denials, partial responses or invalid completed output.
export function gatewaySuggestion(binding, token, model, correlation, logOutcome = () => {}, fallbackModels = GUIDANCE_FALLBACK_MODELS) {
  const client = gatewayClient(binding);
  return async (input, _config, { signal } = {}) => {
    const data = normalizeInput(input);
    return withDeadline(async requestSignal => {
    try {
      const models = [...new Set([model, ...fallbackModels])];
      if (models.length > 2 || !models.every(canonicalModel)) throw new CailError('model_unavailable', 'Model configuration unavailable', 503);
      const messages = [
        { role: 'system', content: data.systemPrompt }, { role: 'system', content: `${JSON_ONLY_INSTRUCTION}\nFollow the supplied JSON field names and types exactly. For a memo review, return at most one guidance point, six nodes, and four connections, or fewer under the active-scale rules. Use brief evidence and only the clearest supported items; do not fill a quota. Guidance, when required by the contract, is an array of objects, not a paragraph or an object. For a connections-only request, return only the required connections object.` },
        { role: 'user', content: `PROJECT INPUT (JSON DATA ONLY)\n${data.projectInput}` },
      ];
      for (const [index, selectedModel] of models.entries()) {
        requestSignal.throwIfAborted();
        let response;
        try {
          response = await client.chatCompletions({ model: selectedModel, stream: false,
            reasoning_effort: selectedModel === 'deepseek-v4-flash-0731' ? 'none' : 'low', max_completion_tokens: 4096,
            response_format: { type: 'json_object' }, messages,
          }, { kind: 'jwt', token }, { signal: requestSignal, correlation, sessionId: 'systems-mapping-guidance' });
        } catch (error) {
          if (requestSignal.aborted || index === models.length - 1 || !(error instanceof CailError)
            || !AVAILABILITY_FAILURES.has(error.code) || error.extras.should_retry !== true) throw error;
          await backoff((gatewayRetryDelay(error, Date.now()) ?? 1) * 1000, requestSignal);
          continue;
        }
        const parsed = parseGatewayEnvelope(await boundedText(response, requestSignal), selectedModel);
        logOutcome('ok');
        return { ...parsed, metadata: { ...parsed.metadata, requestedModel: model, provider: 'cail-gateway' } };
      }
    } catch (error) {
      logOutcome(requestSignal.aborted ? 'cancelled' : 'error');
      throw error;
    }
    }, signal, GUIDANCE_MODEL_TIMEOUT_MS);
  };
}
